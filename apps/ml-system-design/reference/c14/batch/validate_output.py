"""El gate antes de publicar (caso c14): reglas sobre lo que QUEDÓ ESCRITO en la partición de la noche.

Por qué un gate y no "confiar en el modelo": el ERP corre a las 04:00 y pide lo que diga
`forecast_current`. Un pronóstico roto no truena nada: genera 400 pedidos equivocados en silencio. Estas
reglas son baratas, tontas a propósito y se leen en voz alta en la entrevista:

| regla              | qué atrapa                                                    | umbral (caso)            |
|--------------------|---------------------------------------------------------------|--------------------------|
| row_count          | series perdidas en un join, un horizonte que no se generó     | series × 14, ± 0.5 %     |
| unique_keys        | la misma (tienda, SKU, día) dos veces: el ERP pediría doble   | 0 duplicados             |
| nulls              | un p50 vacío se vuelve 0 en muchos ERPs: no pedir nada        | 0 nulos                  |
| negatives          | demanda negativa                                              | 0 negativos              |
| quantile_order     | P90 < P50: inventario de seguridad negativo                   | 0 filas                  |
| category_band      | escala rota (unidades vs cajas, un feature que se fue a 0)    | ±30 % vs los últimos 4 mismos días de la semana; con promo o feriado, entre 1/3× y 3× |
| imputed_stores     | demasiadas tiendas sin datos de anoche                        | ≤ 5 % de las tiendas     |

Se valida la partición LEÍDA de vuelta, no el DataFrame en memoria: así también se atrapan los errores
de escritura (un tipo que cambió, una columna que el writer tiró). Cada regla devuelve su detalle, y la
lista de reglas que fallan es la etiqueta `check` de la métrica `forecast_validation_failed_checks`.

La banda por categoría compara medianas con medianas. Trampa que la primera versión de este gate pisó:
los cuantiles no se suman. El P50 de una serie que vende 0.3 piezas al día es 0 (la mayoría de los días
no vende nada); en una que vende 4, el P50 suele quedar abajo de la media (la demanda es asimétrica).
Contra el PROMEDIO de las últimas 4 semanas, Σ P50 de 7 días daba 0× en una categoría de productos
lentos y entre 0.62× y 1.0× en las demás (medido en 5 noches de dos conjuntos sintéticos), y el
gate bloqueaba noches buenas. La referencia que arma run_forecast es del mismo tipo que el P50: por serie
y día, la MEDIANA de sus últimos 4 mismos días de la semana, sumada por categoría
(`category_reference.ref_7d`); con ella, las mismas noches quedan entre 0.73× y 1.06×. Una categoría cuya
referencia es casi 0 (puros productos lentos) no vota: su cociente es ruido. Por la misma razón, el
planeador del centro de distribución no debe sumar P50 de tiendas: el agregado necesita la media (un
tercer modelo, o un pronóstico del agregado).

El fallback pasa por las reglas de ESTRUCTURA (`structural_only=True`): nunca se publica basura, pero un
fallback no se bloquea por la banda de categoría (es un pronóstico viejo a propósito: el ERP siempre recibe
algo) ni por las tiendas imputadas (es justo para cuando no hay datos).
"""

from __future__ import annotations  # anotaciones como texto

from dataclasses import dataclass, field  # contexto y resultado del gate

import pandas as pd  # la partición escrita

KEY = ["store_id", "sku_id", "target_date"]


@dataclass(frozen=True)
class GateContext:
    """Lo que el gate necesita saber de la noche, además del pronóstico."""

    expected_series: int  # series activas en el surtido de esa noche
    horizons: int = 14
    sku_category: pd.DataFrame | None = None  # sku_id, category (para la banda por categoría)
    category_reference: pd.DataFrame | None = None  # category, ref_7d: Σ medianas de los últimos 4 mismos días
    min_reference: float = 20.0  # piezas en 7 días: con menos, la categoría no vota (ILUSTRATIVO)
    explained_categories: frozenset[str] = frozenset()  # promo o feriado/evento explican la desviación
    imputed_store_share: float = 0.0
    row_tolerance: float = 0.005  # ± 0.5 %
    category_band: float = 0.30  # ± 30 %
    # "Explicado" ensancha la banda, no la quita: entre 1/3× y 3× (ILUSTRATIVO). Un Buen Fin de +150 %
    # pasa; un error de piezas contra cajas (10× o 1/10×) bloquea aunque haya promo.
    explained_factor: float = 3.0
    max_imputed_share: float = 0.05  # 5 % de las tiendas
    structural_only: bool = False  # True para el fallback


@dataclass(frozen=True)
class Check:
    name: str
    ok: bool
    detail: str
    failures: int = 0  # cuántas filas / categorías / tiendas fallaron (el valor de la métrica)


@dataclass
class GateResult:
    checks: list[Check] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return all(c.ok for c in self.checks)

    @property
    def failed(self) -> list[str]:
        return [c.name for c in self.checks if not c.ok]


def check_row_count(fc: pd.DataFrame, ctx: GateContext) -> Check:
    expected = ctx.expected_series * ctx.horizons
    diff = abs(len(fc) - expected) / max(expected, 1)
    return Check("row_count", diff <= ctx.row_tolerance,
                 f"{len(fc)} filas vs {expected} esperadas ({diff:.2%})", abs(len(fc) - expected))


def check_unique_keys(fc: pd.DataFrame) -> Check:
    dup = int(fc.duplicated(KEY).sum())
    return Check("unique_keys", dup == 0, f"{dup} llaves repetidas", dup)


def check_nulls(fc: pd.DataFrame) -> Check:
    cols = KEY + ["p50", "p90", "horizon", "model_version"]
    n = int(fc[cols].isna().any(axis=1).sum())
    return Check("nulls", n == 0, f"{n} filas con nulos en {cols}", n)


def _num(s: pd.Series) -> pd.Series:
    """A número; lo que no lo es queda NaN (y ya lo cuenta `nulls`): una regla no truena por un dato malo."""
    return pd.to_numeric(s, errors="coerce")


def check_negatives(fc: pd.DataFrame) -> Check:
    n = int(((_num(fc["p50"]) < 0) | (_num(fc["p90"]) < 0)).sum())
    return Check("negatives", n == 0, f"{n} filas con p50 o p90 negativo", n)


def check_quantile_order(fc: pd.DataFrame) -> Check:
    n = int((_num(fc["p90"]) < _num(fc["p50"])).sum())
    return Check("quantile_order", n == 0, f"{n} filas con p90 < p50", n)


def category_totals(fc: pd.DataFrame, sku_category: pd.DataFrame) -> pd.DataFrame:
    """Σ p50 de los horizontes 1–7 por categoría: los próximos 7 días, una semana completa de días."""
    week = fc[_num(fc["horizon"]).between(1, 7)].merge(sku_category, on="sku_id", how="left")
    week = week.assign(p50=_num(week["p50"]))
    return week.groupby("category", as_index=False)["p50"].sum().rename(columns={"p50": "next_7d"})


def check_category_band(fc: pd.DataFrame, ctx: GateContext) -> Check:
    """Cada categoría: Σ P50 de los próximos 7 días vs Σ de las medianas de los últimos 4 mismos días, ±30 %.

    Los 7 días cubren cada día de la semana una vez, así que la referencia es "una semana típica de las
    últimas 4", medida con medianas como el P50 (docstring del módulo). Una categoría con promo o un
    feriado/evento en la ventana (o en las 4 semanas de referencia) queda "explicada": su banda se ensancha
    a [1/3×, 3×] y se reporta aparte. Sin referencia (nueva) o con referencia casi 0, no vota.
    """
    if ctx.sku_category is None or ctx.category_reference is None:
        return Check("category_band", True, "sin referencia: no se evaluó")
    t = category_totals(fc, ctx.sku_category).merge(ctx.category_reference, on="category", how="left")
    t = t[t["ref_7d"] >= ctx.min_reference].copy()  # sin referencia o casi 0: no vota
    t["ratio"] = t["next_7d"] / t["ref_7d"]
    t["explained"] = t["category"].isin(ctx.explained_categories)
    normal_out = ~t["explained"] & ((t["ratio"] - 1).abs() > ctx.category_band)
    f = ctx.explained_factor
    explained_out = t["explained"] & ((t["ratio"] > f) | (t["ratio"] < 1 / f))
    blocking = t[normal_out | explained_out]
    soft = t[t["explained"] & ((t["ratio"] - 1).abs() > ctx.category_band) & ~explained_out]
    detail = "; ".join(f"{r.category}: {r.ratio:.2f}×" for r in blocking.itertuples()) or "todas dentro de la banda"
    if len(soft):
        detail += " (fuera de ±30 % pero explicadas por promo o calendario: " + ", ".join(soft["category"]) + ")"
    return Check("category_band", blocking.empty, detail, len(blocking))


def check_imputed_share(ctx: GateContext) -> Check:
    return Check("imputed_stores", ctx.imputed_store_share <= ctx.max_imputed_share,
                 f"{ctx.imputed_store_share:.1%} de las tiendas imputadas (máx. {ctx.max_imputed_share:.0%})")


def validate(fc: pd.DataFrame, ctx: GateContext) -> GateResult:
    """Todas las reglas; `ok` solo si pasan todas. Nunca lanza por un dato malo: lo reporta."""
    res = GateResult([check_unique_keys(fc), check_nulls(fc), check_negatives(fc), check_quantile_order(fc)])
    if not ctx.structural_only:
        res.checks += [check_row_count(fc, ctx), check_category_band(fc, ctx), check_imputed_share(ctx)]
    return res
