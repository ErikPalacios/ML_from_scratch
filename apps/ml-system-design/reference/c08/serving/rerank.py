"""Re-ranker del home (caso c08): del orden del ranker a la página de 50 que ve la persona.

El ranker ordena por valor esperado de CADA ítem por separado. Una página no es una suma de ítems
independientes: 10 chamarras del mismo vendedor arriba "maximizan" el score y son una mala primera
pantalla. Este paso, barato (≈ 10 ms del presupuesto, est.; aquí es Python puro sobre ≈ 1,000 ítems),
aplica en orden:

  1. freshness boost   score × (1 + 0.15 × 0.5^(edad_h / 24)): un ítem recién publicado sube hasta 15 %
                       y el empujón se reduce a la mitad cada 24 h. Compensa que un ítem nuevo tiene
                       contadores en cero (el ranker lo subestima: cold start).
  2. diversity caps    en las primeras 10 posiciones (≈ la primera pantalla): ≤ 3 por categoría y ≤ 1
                       por vendedor; en toda la página, ≤ 3 por vendedor. Greedy: se toma el mejor que
                       no rompa un tope. Si NINGÚN candidato cumple, se relaja el tope (una página
                       completa con repeticiones es mejor que una página corta).
  3. regla de negocio  al menos 1 ítem de un vendedor nuevo en las primeras 10 si hay alguno elegible
                       (guardrail "new-seller exposure": sin esto, el ranker, que aprende de contactos
                       pasados, casi nunca le da una primera impresión a quien acaba de llegar).
  4. exploration       cada posición, con probabilidad 5 %, recibe un candidato elegido AL AZAR (uniforme)
                       entre los que quedaron fuera de la página. Se inserta (lo demás baja un lugar) y se
                       marca exploration=True con su propensity (la probabilidad con la que se eligió):
                       son los datos sin el sesgo del modelo actual que el entrenamiento necesita para
                       estimar el efecto de la posición y evaluar políticas nuevas off-policy.

Determinista: el azar sale de un RNG con semilla = hash del request_id. El mismo request da la misma
página (se puede reproducir un bug o un reclamo), y dos requests distintos exploran distinto.
Puro: sin I/O ni dependencias; lo llama serving/home_api.py y lo prueban serving/tests/test_rerank.py.
"""

from __future__ import annotations  # anotaciones como texto: sintaxis moderna sin costo en runtime

import hashlib  # semilla estable entre procesos (hash() de Python cambia por proceso: PYTHONHASHSEED)
import random  # RNG con semilla propia: no toca el estado global
from collections import Counter  # conteos por categoría y por vendedor
from dataclasses import dataclass, field  # entradas, config y salida inmutables o simples


@dataclass(frozen=True)
class Scored:
    """Un candidato que ya pasó los filtros, con su score (del ranker o heurístico) y su metadata."""

    item_id: str
    score: float  # valor esperado del ranker: P(click) × (P(contact|click) + w), ver home_api.combine
    category: str  # categoría hoja (las 500 del c01)
    seller_id: str
    age_h: float  # horas desde que se publicó (no desde que se indexó)
    seller_is_new: bool  # vendedor con ≤ 30 días en el marketplace (lo calcula el feature pipeline)
    source: str  # fuente principal que lo trajo (two_tower, covisitation, trending_city, followed)


@dataclass(frozen=True)
class RerankConfig:
    page_size: int = 50  # ítems por respuesta (la primera pantalla muestra ≈ 10; el scroll pide más)
    top_k: int = 10  # "primera pantalla": donde los topes son más estrictos
    max_per_category_top_k: int = 3  # en las primeras 10, ≤ 3 de la misma categoría
    max_per_seller_top_k: int = 1  # en las primeras 10, ≤ 1 por vendedor (un vendedor con 200
    #                                publicaciones parecidas no puede llenar la primera pantalla)
    max_per_seller_page: int = 3  # en toda la página
    freshness_boost: float = 0.15  # empujón máximo de un ítem recién publicado (ilustrativo: se ajusta con A/B)
    freshness_half_life_h: float = 24.0  # el empujón se reduce a la mitad cada 24 h
    new_seller_min_top_k: int = 1  # regla de negocio: ≥ 1 vendedor nuevo en la primera pantalla
    exploration_rate: float = 0.05  # ≈ 5 % de las posiciones (SPEC del caso)
    explore: bool = True  # el home_api lo apaga en los caminos de fallback (ver allí por qué)


@dataclass
class Slot:
    """Una posición de la página: lo que se muestra y lo que se loguea para entrenar."""

    item_id: str
    position: int  # 1-based DENTRO de la página (home_api suma el offset de la página)
    score: float  # score del ranker sin ajustar (el que se loguea para calibración y RankerScoreShift)
    adjusted_score: float  # después del freshness boost
    source: str
    exploration: bool = False
    propensity: float | None = None  # P(este ítem en esta posición | exploración); None si no se exploró
    reasons: list[str] = field(default_factory=list)  # por qué está aquí: "freshness", "new_seller", "cap_relaxed"…


def seed_from_request(request_id: str) -> int:
    """Semilla de 64 bits a partir del request_id. sha256 y no hash(): hash() de str cambia entre procesos."""
    return int.from_bytes(hashlib.sha256(request_id.encode("utf-8")).digest()[:8], "big")


def freshness_multiplier(age_h: float, cfg: RerankConfig) -> float:
    """1 + boost × 0.5^(edad / vida media). Edad negativa (relojes desfasados) cuenta como 0."""
    age = max(0.0, age_h)
    return 1.0 + cfg.freshness_boost * 0.5 ** (age / cfg.freshness_half_life_h)


def _fits(c: Scored, pos: int, cats_top: Counter, sellers_top: Counter, sellers_page: Counter,
          cfg: RerankConfig) -> bool:
    """¿Cabe `c` en la posición `pos` (0-based) sin romper un tope?"""
    if sellers_page[c.seller_id] >= cfg.max_per_seller_page:
        return False
    if pos < cfg.top_k:
        if cats_top[c.category] >= cfg.max_per_category_top_k:
            return False
        if sellers_top[c.seller_id] >= cfg.max_per_seller_top_k:
            return False
    return True


def rerank(candidates: list[Scored], request_id: str, cfg: RerankConfig | None = None) -> list[Slot]:
    """Devuelve hasta cfg.page_size Slots en orden de presentación. Ver el docstring del módulo."""
    cfg = cfg or RerankConfig()
    if not candidates:
        return []

    # -- 1. freshness boost. Orden total: score ajustado desc y, a igualdad, item_id (determinista)
    adj = {c.item_id: c.score * freshness_multiplier(c.age_h, cfg) for c in candidates}
    remaining = sorted(candidates, key=lambda c: (-adj[c.item_id], c.item_id))

    # -- 2. topes de diversidad, greedy. O(page_size × N): 50 × 1,000 comparaciones baratas
    page: list[Slot] = []
    cats_top: Counter = Counter()
    sellers_top: Counter = Counter()
    sellers_page: Counter = Counter()
    while remaining and len(page) < cfg.page_size:
        pos = len(page)
        idx = next((i for i, c in enumerate(remaining)
                    if _fits(c, pos, cats_top, sellers_top, sellers_page, cfg)), None)
        reasons = []
        if idx is None:  # nadie cumple (catálogo chico en la ciudad, un solo vendedor…): se relaja
            idx = 0
            reasons.append("cap_relaxed")
        c = remaining.pop(idx)
        if c.age_h < cfg.freshness_half_life_h:
            reasons.append("freshness")
        page.append(Slot(c.item_id, pos + 1, c.score, adj[c.item_id], c.source, reasons=reasons))
        sellers_page[c.seller_id] += 1
        if pos < cfg.top_k:
            cats_top[c.category] += 1
            sellers_top[c.seller_id] += 1
    by_id = {c.item_id: c for c in candidates}

    # -- 3. regla de negocio: vendedor nuevo en la primera pantalla
    _ensure_new_seller(page, remaining, by_id, adj, cfg)

    # -- 4. exploration: inserta candidatos al azar (uniforme sobre los que quedaron fuera)
    if cfg.explore and cfg.exploration_rate > 0 and remaining:
        page = _explore(page, remaining, adj, request_id, cfg)

    for i, s in enumerate(page):  # posiciones finales 1..page_size
        s.position = i + 1
    return page


def _ensure_new_seller(page: list[Slot], remaining: list[Scored], by_id: dict[str, Scored],
                       adj: dict[str, float], cfg: RerankConfig) -> None:
    """Si en las primeras top_k no hay un vendedor nuevo, trae el mejor (por score ajustado) a la
    posición top_k (la última de la primera pantalla): visible, pero sin desplazar a los mejores."""
    if cfg.new_seller_min_top_k <= 0:
        return
    top = page[: cfg.top_k]
    have = sum(1 for s in top if by_id[s.item_id].seller_is_new)
    if have >= cfg.new_seller_min_top_k or len(page) < cfg.top_k:
        return
    top_sellers = {by_id[s.item_id].seller_id for s in top}
    # Primero dentro de la propia página (más abajo), después en lo que quedó fuera
    later = [i for i in range(cfg.top_k, len(page))
             if by_id[page[i].item_id].seller_is_new and by_id[page[i].item_id].seller_id not in top_sellers]
    if later:
        s = page.pop(later[0])
    else:
        j = next((i for i, c in enumerate(remaining)
                  if c.seller_is_new and c.seller_id not in top_sellers), None)
        if j is None:
            return  # no hay vendedores nuevos elegibles: la regla no inventa candidatos
        c = remaining.pop(j)
        s = Slot(c.item_id, 0, c.score, adj[c.item_id], c.source)
        if len(page) >= cfg.page_size:  # la página estaba llena: sale el último
            out = page.pop()
            remaining.insert(0, by_id[out.item_id])
    s.reasons.append("new_seller")
    page.insert(cfg.top_k - 1, s)


def _explore(page: list[Slot], remaining: list[Scored], adj: dict[str, float], request_id: str,
             cfg: RerankConfig) -> list[Slot]:
    """Cada posición se explora con probabilidad ε. El ítem explorado sale UNIFORME del pool (los
    candidatos filtrados que no entraron a la página) → propensity = ε × 1/|pool| en ese momento.

    Por qué uniforme y no "el 51, el 52…": con el siguiente del ranking, los datos de exploración
    siguen sesgados por el modelo actual. Uniforme da una propensity conocida y simple, que es lo que
    piden la evaluación off-policy (IPS) y la estimación del sesgo de posición.
    Por qué insertar y no reemplazar: reemplazar tira justo el ítem que el ranker eligió para esa
    posición; insertar solo empuja fuera de la página al último.
    Los topes de diversidad NO se aplican al explorado: si se aplicaran, la propensity ya no sería ε/|pool|.
    """
    rng = random.Random(seed_from_request(request_id))
    pool = list(remaining)  # copia: el orden del pool es determinista (viene ordenado)
    out: list[Slot] = []
    ranked = iter(page)
    while len(out) < cfg.page_size:
        if pool and rng.random() < cfg.exploration_rate:
            k = rng.randrange(len(pool))
            prop = cfg.exploration_rate / len(pool)
            c = pool.pop(k)
            out.append(Slot(c.item_id, 0, c.score, adj[c.item_id], c.source,
                            exploration=True, propensity=prop, reasons=["exploration"]))
            continue
        nxt = next(ranked, None)
        if nxt is None:
            break  # se acabaron los rankeados: página corta (catálogo chico); no se rellena con azar
        out.append(nxt)
    return out
