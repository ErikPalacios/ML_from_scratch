"""Features point-in-time para el pronóstico directo multi-horizonte (caso c14).

Una fila = (serie tienda×SKU, run_date, horizonte h). run_date es el ÚLTIMO día de ventas cerrado: la noche
del 15 al 16 de octubre el job corre con run_date = 15 y pronostica target_date = run_date + h, h = 1…14
(del 16 al 29). "Directo" quiere decir que no se alimenta el pronóstico de mañana para sacar el de pasado
mañana (recursivo): cada horizonte es una fila con su h como feature y el mismo modelo global los aprende
todos. El error no se acumula de un día al siguiente y la noche corre en un solo predict.

Las 4 reglas del archivo, cada una con la trampa que evita:

1. Nada de ventas ni inventario después de run_date: `build_panel` y `Panel.until` cortan ahí, y es el
   ÚNICO lugar. Trampa: el "lag 7" de un target a 10 días es run_date + 3, que todavía no pasó. Por eso los
   lags son del mismo día de la semana que el target, el más reciente que ya pasó (`sw_lag_1…4`): para
   h ≤ 7 coinciden con los lags 7/14/21/28 del caso; para h = 8…14 son 14/21/28/35. El test cambia todas
   las ventas posteriores a run_date y exige features idénticas.
2. Los días agotados (oos_flag) NO son demanda: sus ventas son una cota inferior (se vendió lo que había).
   Se vuelven NaN antes de calcular lags y promedios (el GBDT trata NaN como faltante), `oos_days_7/28`
   dice cuántos días se perdieron, y como target se excluyen. Trampa: entrenar con ellos enseña que
   agotado = poca demanda → pedidos más chicos → más agotados (el lazo del caso).
3. Lo que se conoce del FUTURO sí se usa, pero solo lo que se conocía esa noche: el calendario del
   target_date (calendar_mx) y el plan de promociones publicado a más tardar esa noche (`promo_as_of`).
   Trampa: usar el precio que SE COBRÓ ese día (incluye rebajas de última hora que nadie conocía).
4. Un faltante no es un cero: un día sin renglón de venta de una tienda que reportó = 0 unidades (el POS
   solo registra ventas); un día de una tienda que NO reportó = NaN (no sabemos). Para run_date, el job
   imputa esa tienda con su mismo día de la semana pasada y la marca `imputed_input` (`impute_missing`).
   Y un día ANTES de que la serie se listara también es NaN: no se vendía, así que no es demanda 0. En su
   promedio de 28 días, un producto listado hace 10 días promedia sus 11 días de venta, no esos 11 más 17
   ceros que nunca existieron (`build_panel`; `attach_targets` ya lo hacía con los targets).

Por qué un panel denso (series × días) en numpy: con la ventana de features (≈ 10 semanas) los lags son
índices y los promedios son `nanmean` sobre un rango de columnas, sin joins por fila. En producción es el
mismo cálculo en Spark (window functions por serie) o en un nodo grande con Polars/DuckDB: 4.8 M series ×
70 días ≈ 336 M celdas ≈ 1.3 GB en float32 (estimación, sin contar índices).

Esquemas (columna `date` como datetime64 a medianoche, día local de la tienda):
  sales      store_id, sku_id, date, units (netas de devoluciones; un negativo se recorta a 0)
  stock      store_id, sku_id, date, oos_flag
  promo      store_id, sku_id, date, price, regular_price, promo_flag [, published_at]
  series     store_id, sku_id, listed_date   (surtido activo: qué se pronostica)
  store_attrs store_id, format, region · sku_attrs sku_id, category, perishable, shelf_life_days
"""

from __future__ import annotations  # anotaciones como texto

import datetime as dt  # fechas de entrada
import warnings  # nanmean de una ventana vacía avisa; aquí es esperado (serie nueva)
from dataclasses import dataclass, replace  # Panel inmutable; until() devuelve uno nuevo

import numpy as np  # el panel denso
import pandas as pd  # tablas de entrada y salida

from calendar_mx import CALENDAR_FEATURES  # columnas del calendario que entran al modelo

KEYS = ["store_id", "sku_id"]
HORIZONS = tuple(range(1, 15))  # 14 días, diario (el caso)
N_SW_LAGS = 4  # últimos 4 mismos días de la semana
NEW_ITEM_DAYS = 28  # una serie listada hace menos de 4 semanas es "nueva" (flag new_item del caso)
# Ventana mínima de historia que necesitan las features: lag 35 (h = 8…14, 4.º mismo día) + margen.
HISTORY_DAYS = 70

LAG_FEATURES = [
    "sw_lag_1", "sw_lag_2", "sw_lag_3", "sw_lag_4",  # mismo día de la semana que el target, ya pasados
    "sw_mean_4",  # su promedio (sin días agotados): la base del seasonal naive con más ruido filtrado
    "roll_mean_7", "roll_mean_28",  # nivel reciente y nivel del mes (sin días agotados)
    "zero_share_28",  # fracción de días con 0 ventas: separa series intermitentes de las rápidas
    "oos_days_7", "oos_days_28",  # cuántos días de la ventana estaban agotados: la "bandera" de los lags
    "series_age_days",  # días desde que la serie se listó (tope 365): productos nuevos
    "cat_store_mean_28",  # nivel de la categoría en la tienda: lo único que tiene un producto nuevo
]
PROMO_FEATURES = ["promo_flag", "discount_depth", "price_ratio"]  # del target_date, plan conocido
ATTR_NUMERIC = ["perishable", "shelf_life_days"]
CATEGORICAL = ["format", "region", "category"]  # pocas categorías: el modelo NO recibe store_id ni sku_id
FEATURE_COLUMNS = ["horizon"] + LAG_FEATURES + list(CALENDAR_FEATURES) + PROMO_FEATURES + ATTR_NUMERIC + CATEGORICAL


def _ts(d) -> pd.Timestamp:
    """Cualquier fecha (date, str, Timestamp) → Timestamp a medianoche: un solo tipo para comparar."""
    return pd.Timestamp(d).normalize()


@dataclass(frozen=True)
class Panel:
    """Ventas y agotados de todas las series, una columna por día, de `start` a `end` (inclusive)."""

    series: pd.DataFrame  # store_id, sku_id, listed_date: la fila i del panel es la serie i
    start: pd.Timestamp  # primer día (columna 0)
    units: np.ndarray  # (S, T) ventas netas observadas; NaN = la tienda no reportó ese día
    oos: np.ndarray  # (S, T) bool: agotado al cierre
    imputed: np.ndarray  # (S,) bool: la tienda de la serie no reportó el último día y se imputó

    @property
    def end(self) -> pd.Timestamp:
        return self.start + pd.Timedelta(days=self.units.shape[1] - 1)

    def demand(self, mask_oos: bool = True) -> np.ndarray:
        """La demanda que el modelo ve: las ventas, con los días agotados como NaN (regla 2)."""
        d = self.units.astype(float, copy=True)
        if mask_oos:
            d[self.oos] = np.nan
        return d

    def until(self, day) -> Panel:
        """El panel tal como se veía la noche de `day`: columnas posteriores, fuera (regla 1)."""
        n = (_ts(day) - self.start).days + 1
        if n <= 0:
            raise ValueError(f"{day} es anterior al inicio del panel ({self.start.date()})")
        return replace(self, units=self.units[:, :n], oos=self.oos[:, :n])


def build_panel(sales: pd.DataFrame, stock: pd.DataFrame, series: pd.DataFrame, start, end,
                missing_store_days: pd.DataFrame | None = None) -> Panel:
    """Arma el panel denso con los datos entre `start` y `end`. Lo posterior a `end` se ignora AQUÍ."""
    start, end = _ts(start), _ts(end)
    sales = sales.assign(date=pd.to_datetime(sales["date"]))  # un solo tipo de fecha (y tablas vacías)
    stock = stock.assign(date=pd.to_datetime(stock["date"]))
    sales = sales[(sales["date"] >= start) & (sales["date"] <= end)]  # el corte point-in-time
    stock = stock[(stock["date"] >= start) & (stock["date"] <= end)]
    series = series.reset_index(drop=True)
    n_s, n_t = len(series), (end - start).days + 1
    rows = series[KEYS].assign(_row=np.arange(n_s))  # serie → fila del panel
    units = np.zeros((n_s, n_t))  # sin renglón de venta = 0 unidades (el POS solo registra ventas)
    s = sales.merge(rows, on=KEYS, how="inner")  # series fuera del surtido activo: se ignoran
    np.add.at(units, (s["_row"].to_numpy(), (s["date"] - start).dt.days.to_numpy()),
              np.clip(s["units"].to_numpy(dtype=float), 0, None))  # neto negativo (devoluciones) → 0
    if "listed_date" in series:  # regla 4: antes del alta no se vendía; NaN, no demanda 0
        first = (pd.to_datetime(series["listed_date"]) - start).dt.days.to_numpy(dtype=float)  # NaT → NaN
        units[np.arange(n_t)[None, :] < first[:, None]] = np.nan  # sin fecha de alta: serie vieja, nada
    oos = np.zeros((n_s, n_t), dtype=bool)  # sin snapshot de inventario = no sabemos de agotado: False
    o = stock[stock["oos_flag"].astype(bool)].merge(rows, on=KEYS, how="inner")
    oos[o["_row"].to_numpy(), (o["date"] - start).dt.days.to_numpy()] = True
    if missing_store_days is not None and len(missing_store_days):  # regla 4: no reportó ≠ vendió 0
        m = missing_store_days.assign(date=pd.to_datetime(missing_store_days["date"]))
        m = m[(m["date"] >= start) & (m["date"] <= end)]
        hit = series[["store_id"]].assign(_row=np.arange(n_s)).merge(m, on="store_id")
        units[hit["_row"].to_numpy(), (hit["date"] - start).dt.days.to_numpy()] = np.nan
    return Panel(series=series, start=start, units=units, oos=oos, imputed=np.zeros(n_s, dtype=bool))


def impute_missing(panel: Panel) -> Panel:
    """Imputa el ÚLTIMO día de las tiendas que no reportaron con su mismo día de la semana pasada.

    Regla 4. Se copian venta Y agotado de hace 7 días (si ese día estaba agotado, sigue enmascarado) y la
    serie queda marcada: el flag `imputed_input` viaja hasta forecast_daily y el gate cuenta las tiendas.
    """
    units, oos = panel.units.copy(), panel.oos.copy()
    last = units.shape[1] - 1
    miss = np.isnan(units[:, last])  # la tienda no reportó run_date
    if miss.any() and last >= 7:
        units[miss, last] = units[miss, last - 7]
        oos[miss, last] = oos[miss, last - 7]
    return replace(panel, units=units, oos=oos, imputed=panel.imputed | miss)


def promo_as_of(promo: pd.DataFrame, run_date) -> pd.DataFrame:
    """El plan de promociones como se conocía la noche de `run_date` (regla 3).

    Si la tabla trae `published_at` (cuándo se publicó cada versión del plan), se queda con la última
    versión publicada ANTES de que terminara run_date. Sin esa columna, se confía en que el warehouse ya
    entrega la versión de esa noche (el adaptador real debe hacerlo: es un as-of join, como en M9).
    """
    if "published_at" in promo.columns:
        known = promo[pd.to_datetime(promo["published_at"]) < _ts(run_date) + pd.Timedelta(days=1)]
        known = known.sort_values("published_at").drop_duplicates(KEYS + ["date"], keep="last")
    else:
        known = promo
    if known.duplicated(KEYS + ["date"]).any():  # dos precios para el mismo día: contrato de datos roto
        raise ValueError("plan de promociones con más de un renglón por (tienda, SKU, día)")
    return known.assign(date=pd.to_datetime(known["date"]))


def row_nanmean(a: np.ndarray) -> np.ndarray:
    """Promedio por fila sin NaN (días agotados, sin reporte o antes del alta)."""
    with warnings.catch_warnings():  # ventana toda NaN (serie sin días conocidos) → NaN, sin aviso
        warnings.simplefilter("ignore", RuntimeWarning)
        return np.nanmean(a, axis=1)


def same_weekday_lags(d: np.ndarray, r: int, h: int) -> np.ndarray:
    """(series, 4): la demanda de los últimos 4 mismos días de la semana que el target r + h, YA pasados.

    Columnas del panel `d` (r = run_date). Para h ≤ 7 son los lags 7/14/21/28 del target; para h = 8…14,
    14/21/28/35 (el target − 7 todavía no pasó). Los usan las features y el naive del fallback: una sola
    definición. Los 4 caen siempre en [r − 27, r]. Una columna antes del inicio del panel es NaN.
    """
    # El mismo día de la semana que el target más reciente que YA pasó: r + h − 7·⌈h/7⌉.
    last_same = r + h - 7 * int(np.ceil(h / 7))
    cols = [last_same - 7 * j for j in range(N_SW_LAGS)]
    return np.column_stack([d[:, c] if c >= 0 else np.full(len(d), np.nan) for c in cols])


def features_for_origin(panel: Panel, run_date, calendar: pd.DataFrame, promo: pd.DataFrame,
                        store_attrs: pd.DataFrame, sku_attrs: pd.DataFrame,
                        horizons=HORIZONS, mask_oos: bool = True) -> pd.DataFrame:
    """Las filas de inferencia (o de entrenamiento, sin target) de un origen: series × horizontes.

    `mask_oos=False` existe SOLO para que los tests muestren el costo de ignorar la censura.
    """
    run_date = _ts(run_date)
    p = panel.until(run_date)  # regla 1, otra vez: aunque te pasen un panel más largo
    if p.end != run_date:
        raise ValueError(f"el panel termina en {p.end.date()}, no en run_date {run_date.date()}")
    d = p.demand(mask_oos)
    oos = p.oos if mask_oos else np.zeros_like(p.oos)
    r = d.shape[1] - 1  # índice de run_date
    w7, w28 = slice(max(0, r - 6), r + 1), slice(max(0, r - 27), r + 1)
    known28 = (~np.isnan(d[:, w28])).sum(axis=1)
    base = p.series[KEYS].copy()
    base["roll_mean_7"] = row_nanmean(d[:, w7])
    base["roll_mean_28"] = row_nanmean(d[:, w28])
    with np.errstate(invalid="ignore", divide="ignore"):  # 0/0 → NaN en series sin días conocidos
        base["zero_share_28"] = np.where(known28 > 0, (d[:, w28] == 0).sum(axis=1) / known28, np.nan)
    base["oos_days_7"] = oos[:, w7].sum(axis=1)
    base["oos_days_28"] = oos[:, w28].sum(axis=1)
    listed = pd.to_datetime(p.series["listed_date"]) if "listed_date" in p.series else pd.Series(pd.NaT, index=p.series.index)
    age = (run_date - listed).dt.days
    base["series_age_days"] = age.fillna(365).clip(0, 365).to_numpy()  # sin fecha de alta = serie vieja
    base["new_item"] = base["series_age_days"] < NEW_ITEM_DAYS
    base["imputed_input"] = p.imputed
    # Nivel de la categoría en la tienda (promedio de roll_mean_28 de sus series): lo que hereda un
    # producto nuevo mientras junta historia. Mismo corte: solo datos ≤ run_date.
    cat = base[KEYS].merge(sku_attrs[["sku_id", "category"]], on="sku_id", how="left", validate="many_to_one")
    cat["v"] = base["roll_mean_28"].to_numpy()  # merge left conserva el orden de las filas del panel
    base["cat_store_mean_28"] = cat.groupby(["store_id", "category"])["v"].transform("mean").to_numpy()
    blocks = []
    for h in horizons:
        lags = same_weekday_lags(d, r, h)  # el mismo día de la semana que el target, ya pasado (regla 1)
        blk = base.copy()
        blk["horizon"] = h
        blk["target_date"] = run_date + pd.Timedelta(days=h)
        for j in range(N_SW_LAGS):
            blk[f"sw_lag_{j + 1}"] = lags[:, j]
        blk["sw_mean_4"] = row_nanmean(lags)
        blocks.append(blk)
    rows = pd.concat(blocks, ignore_index=True)
    rows.insert(0, "run_date", run_date)
    # Calendario del target_date: se conoce con meses de anticipación (regla 3)
    cal = calendar[["date", *CALENDAR_FEATURES]].rename(columns={"date": "target_date"})
    rows = rows.merge(cal, on="target_date", how="left")
    if rows["dow"].isna().any():  # un día sin calendario es un bug de configuración: fallar, no adivinar
        missing = sorted(rows.loc[rows["dow"].isna(), "target_date"].dt.date.unique())
        raise ValueError(f"el calendario no cubre: {missing[:3]}…")
    # Plan de promociones del target_date, como se conocía esa noche (regla 3)
    plan = promo_as_of(promo, run_date)[[*KEYS, "date", "price", "regular_price", "promo_flag"]]
    rows = rows.merge(plan.rename(columns={"date": "target_date"}), on=[*KEYS, "target_date"], how="left")
    rows["promo_flag"] = rows["promo_flag"].fillna(0).astype(int)  # sin renglón = sin promo
    ratio = rows["price"] / rows["regular_price"]
    rows["price_ratio"] = ratio.fillna(1.0)  # sin renglón = precio regular
    rows["discount_depth"] = (1.0 - rows["price_ratio"]).clip(lower=0.0)
    rows = rows.drop(columns=["price", "regular_price"])
    rows = rows.merge(store_attrs[["store_id", "format", "region"]], on="store_id", how="left")
    rows = rows.merge(sku_attrs[["sku_id", "category", "perishable", "shelf_life_days"]], on="sku_id", how="left")
    rows["perishable"] = rows["perishable"].astype(int)
    return rows


def attach_targets(rows: pd.DataFrame, sales: pd.DataFrame, stock: pd.DataFrame, series: pd.DataFrame,
                   mask_oos: bool = True) -> pd.DataFrame:
    """Agrega el target a filas YA construidas: el único lugar que lee el futuro, y solo para el target.

    target = unidades del target_date; NaN si ese día estuvo agotado (regla 2) o si la serie todavía no
    estaba listada (no se vendía, no es demanda 0). `actual_units` y `target_oos` quedan para evaluar.
    """
    act = sales.assign(date=pd.to_datetime(sales["date"])).groupby([*KEYS, "date"], as_index=False)["units"].sum()
    act["units"] = act["units"].clip(lower=0)
    act = act.rename(columns={"date": "target_date", "units": "actual_units"})
    out = rows.merge(act, on=[*KEYS, "target_date"], how="left")
    out["actual_units"] = out["actual_units"].fillna(0.0)  # sin renglón = 0 (tienda que sí reportó)
    o = stock.loc[stock["oos_flag"].astype(bool), [*KEYS, "date"]].rename(columns={"date": "target_date"})
    o["target_date"] = pd.to_datetime(o["target_date"])
    out = out.merge(o.assign(target_oos=True), on=[*KEYS, "target_date"], how="left")
    out["target_oos"] = out["target_oos"].fillna(False).astype(bool)
    out["target"] = out["actual_units"].where(~out["target_oos"] | (not mask_oos))
    if "listed_date" in series:
        lst = series[[*KEYS, "listed_date"]]
        out = out.merge(lst, on=KEYS, how="left")
        out.loc[out["target_date"] < pd.to_datetime(out["listed_date"]), "target"] = np.nan
        out = out.drop(columns=["listed_date"])
    return out


def training_frame(panel: Panel, origins, calendar: pd.DataFrame, promo: pd.DataFrame,
                   store_attrs: pd.DataFrame, sku_attrs: pd.DataFrame, sales: pd.DataFrame,
                   stock: pd.DataFrame, horizons=HORIZONS, mask_oos: bool = True) -> pd.DataFrame:
    """Filas de entrenamiento de varios orígenes: features con `until(origin)` + target del futuro.

    El panel completo se arma una vez y se corta por origen: es equivalente a reconstruirlo con los datos
    ≤ origin (un test lo exige) y mucho más barato.
    """
    parts = []
    for origin in origins:
        f = features_for_origin(panel.until(origin), origin, calendar, promo, store_attrs, sku_attrs,
                                horizons=horizons, mask_oos=mask_oos)
        parts.append(attach_targets(f, sales, stock, panel.series, mask_oos=mask_oos))
    return pd.concat(parts, ignore_index=True)
