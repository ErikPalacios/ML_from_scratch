"""review-router del caso c06: QUÉ revisa una persona primero y CUÁNTO mandamos a revisión.

Los ≈ 600 puestos de moderación cubiertos cada día son el recurso más caro y escaso del sistema (≈ 216k
revisiones/día, ≈ US$900k/mes, est.). Tres decisiones viven aquí:

1. Prioridad por DAÑO ESPERADO, no por orden de llegada:
       prioridad = P(viola) × peso de severidad × vistas esperadas en las próximas horas
   Ejemplo: un post de acoso (S2, peso 10) con P = 0.7 que hoy recibe 1,200 vistas/h → ≈ 3,900 vistas
   esperadas en 6 h → 0.7 × 10 × 3,900 ≈ 27,000. Un post de autolesiones (S1, peso 100) con P = 0.5 y
   20 vistas/h → ≈ 65 vistas → 0.5 × 100 × 65 ≈ 3,250. El de acoso va primero: lo van a ver miles de
   personas antes de que alguien lo revise. Y si el de autolesiones empieza a viralizarse, su prioridad
   sube sola (por eso las vistas se miden con la velocidad ACTUAL, no con las acumuladas).
2. SLA aging: un ítem viejo sube con el tiempo, y los SLA "duros" (S0 y reportes de usuarios S1:
   p90 ≤ 1 h) pasan a un carril prioritario cuando consumieron el 75 % de su SLA. Sin aging, un ítem
   con pocas vistas no se revisa nunca (starvation).
3. Routing según capacidad: elegir los umbrales de la banda de revisión de modo que lo que LLEGA por
   día quepa en lo que el equipo puede revisar, con margen (utilización objetivo ≈ 93 %: con colas, una
   utilización cerca de 100 % hace explotar la espera; ver M3). S0 y S1 están protegidos: su umbral
   nunca sube por falta de capacidad. El resto comparte un mismo "valor marginal": el último ítem que
   entra a revisión vale lo mismo (score × peso) sea de la política que sea.

Y el bienestar de quien modera es parte del diseño: tope de contenido gráfico por turno, imágenes
borrosas/en gris por defecto, S0 solo para el equipo especializado, idiomas que la persona domina.

Puro (solo biblioteca estándar): lo usa el servicio review-router, que no está en esta carpeta, y sus
gauges `review_queue_oldest_age_seconds` y `review_queue_depth` salen de `queue_stats`.
No incluido: la agrupación de near-duplicates en clústeres (una decisión por clúster, reversión en
lote) se describe en el caso; aquí cada ReviewItem es un ítem.
"""

from __future__ import annotations  # anotaciones como texto: sintaxis moderna sin costo en runtime

import bisect  # siguiente valor distinto de λ (empates)
import math  # ln 2 para la vida media de las vistas
from collections.abc import Iterable, Mapping  # tipos de entrada
from dataclasses import dataclass, field  # ítems y moderadores

# ---------------------------------------------------------------------------- parámetros (est.)
# Peso relativo del daño de UNA vista según la severidad. Ilustrativo: lo fija Trust & Safety, y es
# una decisión de producto, no de ML. Lo que importa es el ORDEN de magnitud entre severidades.
SEVERITY_WEIGHT = {"S0": 1000.0, "S1": 100.0, "S2": 10.0, "S3": 1.0}
SEV_RANK = {"S0": 3, "S1": 2, "S2": 1, "S3": 0}
# SLA de revisión (segundos) por (severidad, origen). Del caso: reportes S1 p90 ≤ 1 h. El resto, est.
SLA_S = {
    ("S0", "user_report"): 30 * 60,
    ("S0", "proactive"): 30 * 60,
    ("S1", "user_report"): 60 * 60,  # SLO del caso: p90 ≤ 1 h
    ("S1", "proactive"): 4 * 3600,
    ("S2", "user_report"): 24 * 3600,
    ("S2", "proactive"): 24 * 3600,
    ("S3", "user_report"): 72 * 3600,
    ("S3", "proactive"): 72 * 3600,
}
# SLA "duros": al consumir AT_RISK del SLA pasan al carril prioritario. Los de S2/S3 solo envejecen
# (aging): si no, un backlog de spam viejo pasaría delante de un post S1 que se está viralizando.
HARD_SLA = {("S0", "user_report"), ("S0", "proactive"), ("S1", "user_report")}
AT_RISK = 0.75
# Curva de vistas: la velocidad de un post decae con vida media ≈ 3 h (est.: mídela con los logs de
# vistas por edad del post; cambia por superficie y por tamaño de la audiencia del autor).
VIEW_HALF_LIFE_H = 3.0
HORIZON_H = 6.0  # "próximas horas": lo que tarda, como mucho, un ítem normal en ser revisado
MIN_VIEWS_PER_H = 5.0  # piso: un post recién creado (0 vistas aún) no tiene prioridad 0
# Bienestar: máximo de ítems gráficos por persona por turno. Ilustrativo: el número lo fija el
# programa de bienestar (con psicología ocupacional), no este código.
GRAPHIC_CAP_PER_SHIFT = 40


@dataclass
class ReviewItem:
    item_id: str
    policy: str
    severity: str  # S0–S3 de la política
    p_violation: float  # score calibrado de la cascada (etapa 2 si existe)
    views_last_hour: float  # velocidad actual (de los contadores de vistas)
    enqueued_at: float  # epoch segundos
    source: str = "proactive"  # proactive · user_report
    language: str = "es"
    graphic: bool = False  # violencia gráfica, autolesiones con imagen…: borroso por defecto y con tope


@dataclass
class Moderator:
    moderator_id: str
    languages: set[str]
    s0_specialist: bool = False  # solo el equipo especializado ve S0
    graphic_seen_this_shift: int = 0
    graphic_cap: int = GRAPHIC_CAP_PER_SHIFT
    skip_items: set[str] = field(default_factory=set)  # p. ej. ítems que esta persona ya decidió (apelaciones: otra persona)


# ---------------------------------------------------------------------------- prioridad
def expected_views(views_last_hour: float, horizon_h: float = HORIZON_H, half_life_h: float = VIEW_HALF_LIFE_H) -> float:
    """Vistas esperadas en las próximas `horizon_h` horas si la velocidad decae exponencialmente.

    ∫₀ᴴ v · 2^(−t/h½) dt = v · h½/ln 2 · (1 − 2^(−H/h½)).
    Ejemplo: v = 1,200/h, h½ = 3 h, H = 6 h → 1,200 × 4.328 × 0.75 ≈ 3,895.
    """
    v = max(views_last_hour, MIN_VIEWS_PER_H)
    return v * half_life_h / math.log(2) * (1.0 - 2.0 ** (-horizon_h / half_life_h))


def harm_priority(item: ReviewItem) -> float:
    """P(viola) × peso de severidad × vistas esperadas: el daño que evitamos revisándolo AHORA."""
    return item.p_violation * SEVERITY_WEIGHT[item.severity] * expected_views(item.views_last_hour)


def sla_fraction(item: ReviewItem, now: float) -> float:
    """Qué fracción de su SLA ya consumió (1.0 = vencido)."""
    return max(0.0, now - item.enqueued_at) / SLA_S[(item.severity, item.source)]


def priority_key(item: ReviewItem, now: float) -> tuple:
    """Clave de orden (mayor = antes).

    Carril 1: SLA duros en riesgo (≥ 75 % consumido), primero los más vencidos.
    Carril 0: todo lo demás por daño × aging; aging = 1 + fracción del SLA consumida (×2 al vencer, ×3
    con el doble de tiempo): basta para que lo viejo termine pasando, sin tapar a lo viral.
    """
    frac = sla_fraction(item, now)
    if (item.severity, item.source) in HARD_SLA and frac >= AT_RISK:
        return (1, frac, harm_priority(item))
    return (0, harm_priority(item) * (1.0 + min(frac, 2.0)), 0.0)


def blur_by_default(item: ReviewItem) -> bool:
    """La herramienta muestra borroso y en gris lo gráfico: la persona decide si necesita verlo nítido."""
    return item.graphic or item.severity in ("S0", "S1")


def eligible(item: ReviewItem, mod: Moderator) -> bool:
    """¿Esta persona puede (y debe) revisar este ítem?"""
    if item.item_id in mod.skip_items:
        return False
    if item.severity == "S0" and not mod.s0_specialist:
        return False  # S0 solo lo ve el equipo especializado (con su propio soporte)
    if item.language not in mod.languages:
        return False  # revisar en un idioma que no dominas = etiquetas malas (y apelaciones ganadas)
    if item.graphic and mod.graphic_seen_this_shift >= mod.graphic_cap:
        return False  # tope de exposición del turno: le tocan ítems no gráficos
    return True


def next_batch(pending: Iterable[ReviewItem], mod: Moderator, now: float, n: int = 10) -> list[ReviewItem]:
    """Los `n` ítems de mayor prioridad que esta persona puede revisar, respetando su tope gráfico."""
    ranked = sorted((i for i in pending if eligible(i, mod)), key=lambda i: priority_key(i, now), reverse=True)
    out, graphic_left = [], mod.graphic_cap - mod.graphic_seen_this_shift
    for item in ranked:
        if item.graphic:
            if graphic_left <= 0:
                continue  # el tope cuenta también DENTRO del batch
            graphic_left -= 1
        out.append(item)
        if len(out) == n:
            break
    return out


def queue_stats(pending: Iterable[ReviewItem], now: float) -> dict[tuple[str, str], dict[str, float]]:
    """(severidad, origen) → {depth, oldest_age_s}: lo que exporta review-router como gauges
    `review_queue_depth{tier,source}` y `review_queue_oldest_age_seconds{tier,source}` (tier = S0–S3;
    no se llama `severity` porque ese es el label de las alertas y lo pisaría).

    La edad del más viejo ve lo que un histograma de "tiempo hasta decisión" NO ve: si nadie revisa,
    no hay decisiones y el histograma se queda callado (misma trampa que en el caso c04).
    """
    stats: dict[tuple[str, str], dict[str, float]] = {}
    for i in pending:
        s = stats.setdefault((i.severity, i.source), {"depth": 0, "oldest_age_s": 0.0})
        s["depth"] += 1
        s["oldest_age_s"] = max(s["oldest_age_s"], now - i.enqueued_at)
    return stats


# ---------------------------------------------------------------------------- capacidad
def review_capacity_per_day(moderators: int = 600, items_per_hour: float = 60.0, productive_hours: float = 6.0) -> float:
    """Del caso (est.): 600 × 60 ítems/h × 6 h productivas ≈ 216,000 revisiones por día."""
    return moderators * items_per_hour * productive_hours


def plan_review_thresholds(
    daily_scores: Mapping[str, Iterable[float]],
    severity_of: Mapping[str, str],
    capacity_per_day: float,
    *,
    sample_fraction: float = 1.0,
    target_utilization: float = 0.93,
    reserved_per_day: Mapping[str, float] | None = None,
    min_threshold: float = 0.30,
    protected_tiers: Iterable[str] = ("S0", "S1"),
) -> dict:
    """Umbral de la banda de revisión por política para que las llegadas quepan en la capacidad.

    daily_scores: por política, los scores de un día (o de una muestra: `sample_fraction` dice qué
      fracción del día representa; cada score cuenta como 1 / sample_fraction ítems).
    reserved_per_day: revisiones que NO salen de estos umbrales y hay que restar primero: reportes de
      usuarios, apelaciones (las revisa OTRA persona), la muestra aleatoria para medir prevalencia y el
      control de calidad (doble revisión).
    protected_tiers: severidades cuyo umbral NUNCA sube por falta de capacidad: se quedan en
      `min_threshold` y sus llegadas se restan primero. Si ni así caben, el error lo dice: la respuesta
      es más personas (o mover personas), no dejar de revisar amenazas.

    Para el resto, un mismo λ (valor marginal): entra a revisión si score × peso ≥ λ, o sea
    umbral_p = λ / peso_p. Se elige el λ más bajo cuyas llegadas caben. Así no gastas una revisión en
    spam a 0.9 (0.9 × 1) mientras odio a 0.35 (0.35 × 10 = 3.5) espera.
    Consecuencia que hay que decir en voz alta: con pesos 1/10/100, el spam (S3) casi nunca entra a la
    banda; su calidad se mide con la muestra aleatoria y su revisión llega por reportes y apelaciones,
    que van en `reserved_per_day`. Si producto quiere un piso por política, también va ahí.
    `min_threshold`: por debajo de este score no se revisa aunque sobre capacidad (casi todo sería
    contenido limpio: desgasta a las personas y no mejora nada).
    """
    if not 0 < sample_fraction <= 1:
        raise ValueError("sample_fraction debe estar en (0, 1]")
    scale = 1.0 / sample_fraction
    daily_scores = {pol: list(scores) for pol, scores in daily_scores.items()}
    protected = {pol for pol in daily_scores if severity_of[pol] in set(protected_tiers)}
    reserved = sum((reserved_per_day or {}).values())
    protected_arrivals = sum(
        sum(1 for s in daily_scores[pol] if s >= min_threshold) * scale for pol in protected
    )
    budget = capacity_per_day * target_utilization - reserved - protected_arrivals
    if budget < 0:
        raise ValueError(
            "lo reservado (reportes, apelaciones, muestra) más S0/S1 ya consume toda la capacidad: "
            "faltan personas, no umbrales"
        )
    values = []  # (score × peso) de cada ítem NO protegido que podría entrar
    for pol, scores in daily_scores.items():
        if pol in protected:
            continue
        w = SEVERITY_WEIGHT[severity_of[pol]]
        values += [s * w for s in scores if s >= min_threshold]
    values.sort(reverse=True)
    k = int(budget // scale)  # cuántos ítems de la muestra caben
    lam = 0.0 if k >= len(values) else (values[k - 1] if k > 0 else math.inf)  # todo lo ≥ λ entra

    def thresholds_at(lam: float) -> dict[str, float]:
        out = {}
        for pol in daily_scores:
            w = SEVERITY_WEIGHT[severity_of[pol]]
            if pol in protected:
                t = min_threshold
            else:
                t = min(1.0, max(min_threshold, lam / w)) if lam != math.inf else 1.0
            # Redondear HACIA ARRIBA a 4 decimales (lo que se escribe en policies.yaml): redondear al
            # más cercano podría bajar el umbral y dejar entrar más de lo que cabe.
            out[pol] = min(1.0, math.ceil(t * 10_000 - 1e-9) / 10_000)
        return out

    def arrivals_at(th: dict[str, float]) -> dict[str, float]:
        return {pol: sum(1 for s in scores if s >= th[pol]) * scale for pol, scores in daily_scores.items()}

    # Empates: si muchos ítems tienen exactamente el valor λ, un umbral no puede admitir "la mitad".
    # Se sube λ al siguiente valor distinto hasta que lo NO protegido quepa.
    distinct = sorted(set(values))
    while True:
        thresholds = thresholds_at(lam)
        arrivals = arrivals_at(thresholds)
        if sum(v for pol, v in arrivals.items() if pol not in protected) <= budget or lam == math.inf:
            break
        i = bisect.bisect_right(distinct, lam)
        lam = distinct[i] if i < len(distinct) else math.inf
    return {
        "lambda": lam,
        "thresholds": thresholds,
        "expected_arrivals": arrivals,
        "expected_total": sum(arrivals.values()) + reserved,
        "budget_unprotected": budget,
    }
