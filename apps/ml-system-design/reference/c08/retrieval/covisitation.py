"""Co-visitación ítem-ítem (caso c08): "quienes vieron esto también vieron…", calculada offline.

Es la fuente `covisitation` del home (≈ 300 de los ≈ 1,000 candidatos): a partir de lo que la persona
vio hace poco, trae los ítems que otras personas vieron EN LA MISMA SESIÓN y cerca en el tiempo. No
necesita entrenar nada, reacciona a las tendencias en horas y explica bien sus resultados. Es el
baseline que cualquier two-tower tiene que superar, y una fuente que sigue sumando al lado del two-tower.

El cálculo, con un ejemplo antes de la notación (sesiones de HOY: sin decaimiento; soporte mínimo 1):
  sesión 1: chamarra_A → chamarra_B → botas_C        sesión 2: chamarra_A → chamarra_B
  sesión 3: chamarra_A → iphone                      sesión 4..100: iphone (solo)
  pares en la misma sesión (dentro de la ventana): A–B en 2 sesiones, A–C, B–C y A–iphone en 1
  n(A) = 3 sesiones, n(B) = 2, n(iphone) = 98
  P(·|A) "crudo" = c(A,x) / n(A):  B = 0.67, C = 0.33, iphone = 0.33 → el iphone empata con las botas
  coseno = c(A,x) / sqrt(n(A) × n(x)): B = 0.82, C = 0.58, iphone = 0.06 → lo popular deja de colarse
El parámetro `beta` va de 0 (probabilidad condicional: premia lo popular) a 1 (castiga mucho lo popular);
0.5 es el coseno. Se ajusta con recall@k offline (eval/offline_metrics.py) y con A/B.

Decisiones que un entrevistador pregunta:
  - Un par cuenta UNA vez por sesión: alguien que abre 20 veces la misma pareja no pesa 20 veces.
  - Ventana de tiempo (1 h): dos vistas a 5 horas en la misma "sesión" larga no dicen que se parezcan.
  - Tope de largo de sesión (50 ítems): los pares crecen como L²; un bot o un scroll infinito con 2,000
    vistas generaría 2 M de pares de ruido. Se queda con las ÚLTIMAS 50.
  - Decaimiento por edad (vida media 7 días): el marketplace cambia rápido; lo de hace un mes pesa poco.
  - Soporte mínimo (2 sesiones): un par visto una sola vez es casi siempre casualidad.
Escala: aquí es Python puro para poder leerlo y probarlo; en producción es el mismo cálculo como job de
Spark sobre ≈ 30 días de sesiones, que escribe el top-k de cada ítem en el KV store que lee el home-api.
"""

from __future__ import annotations  # anotaciones como texto: sintaxis moderna sin costo en runtime

import heapq  # top-k sin ordenar listas enteras
import math  # sqrt / pow para la normalización
from collections import defaultdict  # acumuladores dispersos (la mayoría de los pares no existe)
from collections.abc import Iterable  # el input puede ser un generador (no cabe todo en memoria en prod)
from dataclasses import dataclass  # el evento de entrada

DAY_S = 86_400.0


@dataclass(frozen=True)
class View:
    """Una vista de un ítem (abrir la publicación). La sesión la define el cliente: ≥ 30 min sin
    actividad = sesión nueva (convención habitual de analytics; elige la tuya y fíjala)."""

    session_id: str
    item_id: str
    ts: float  # epoch en segundos (event time, no processing time)


@dataclass(frozen=True)
class CovisConfig:
    window_s: float = 3600.0  # solo pares a ≤ 1 h de distancia dentro de la sesión
    half_life_days: float = 7.0  # un par de hace 7 días pesa la mitad que uno de hoy
    max_session_len: int = 50  # últimas 50 vistas únicas por sesión (anti-bot, anti-L²)
    min_sessions: int = 2  # soporte mínimo: sesiones distintas donde aparece el par
    beta: float = 0.5  # 0 = P(b|a), 0.5 = coseno, 1 = c/n(b): cuánto se castiga lo popular
    top_k: int = 100  # vecinos guardados por ítem (≈ 100 × 12 B ≈ 1.2 KB por ítem en el KV store, est.)


def decay(age_s: float, half_life_days: float) -> float:
    """0.5^(edad / vida media). Edad negativa (reloj desfasado) cuenta como 0."""
    return 0.5 ** (max(0.0, age_s) / (half_life_days * DAY_S))


def _sessions(views: Iterable[View], max_len: int) -> dict[str, list[tuple[str, float]]]:
    """Agrupa por sesión, ordena por tiempo, deja la PRIMERA vista de cada ítem y recorta a las
    últimas `max_len` (si alguien volvió a un ítem, cuenta cuando lo descubrió)."""
    by_s: dict[str, list[tuple[float, str]]] = defaultdict(list)
    for v in views:
        by_s[v.session_id].append((v.ts, v.item_id))
    out = {}
    for sid, evs in by_s.items():
        evs.sort()
        first: dict[str, float] = {}
        for ts, item in evs:
            first.setdefault(item, ts)
        seq = sorted(((ts, it) for it, ts in first.items()))[-max_len:]
        out[sid] = [(it, ts) for ts, it in seq]
    return out


def build_covisitation(views: Iterable[View], now: float, cfg: CovisConfig | None = None
                       ) -> dict[str, list[tuple[str, float]]]:
    """Tabla ítem → [(vecino, score)] ordenada por score desc (a igualdad, por id: determinista)."""
    cfg = cfg or CovisConfig()
    pair_w: dict[tuple[str, str], float] = defaultdict(float)  # (a, b) con a < b: peso decaído
    pair_n: dict[tuple[str, str], int] = defaultdict(int)  # sesiones distintas con el par (soporte)
    item_w: dict[str, float] = defaultdict(float)  # "popularidad" decaída: sesiones con el ítem

    for seq in _sessions(views, cfg.max_session_len).values():
        session_pairs: dict[tuple[str, str], float] = {}
        for it, ts in seq:
            item_w[it] += decay(now - ts, cfg.half_life_days)
        for i, (a, ta) in enumerate(seq):
            for b, tb in seq[i + 1:]:
                if tb - ta > cfg.window_s:
                    break  # seq está ordenada por tiempo: los siguientes están aún más lejos
                key = (a, b) if a < b else (b, a)
                w = decay(now - max(ta, tb), cfg.half_life_days)  # edad del par = la vista más reciente
                session_pairs[key] = max(session_pairs.get(key, 0.0), w)  # una vez por sesión
        for key, w in session_pairs.items():
            pair_w[key] += w
            pair_n[key] += 1

    neigh: dict[str, list[tuple[float, str]]] = defaultdict(list)
    for (a, b), w in pair_w.items():
        if pair_n[(a, b)] < cfg.min_sessions:
            continue
        # score(a → b) = c / (n(a)^(1−β) × n(b)^β): lo que se recomienda es b, así que β castiga su popularidad
        neigh[a].append((w / (math.pow(item_w[a], 1 - cfg.beta) * math.pow(item_w[b], cfg.beta)), b))
        neigh[b].append((w / (math.pow(item_w[b], 1 - cfg.beta) * math.pow(item_w[a], cfg.beta)), a))

    table = {}
    for it, lst in neigh.items():
        best = heapq.nsmallest(cfg.top_k, lst, key=lambda x: (-x[0], x[1]))
        table[it] = [(b, round(s, 6)) for s, b in best]
    return table


def candidates_from_history(table: dict[str, list[tuple[str, float]]], recent: list[tuple[str, float]],
                            now: float, k: int = 300, half_life_h: float = 24.0) -> list[tuple[str, float]]:
    """Lo que hace la fuente `covisitation` del home-api por request: suma los vecinos de lo que la
    persona vio hace poco, pesando cada vista por su recencia (vida media 24 h). No devuelve lo que ya vio.

    recent: [(item_id, ts)] de las últimas vistas (las últimas 50 acciones vienen del feature store).
    """
    seen = {it for it, _ in recent}
    acc: dict[str, float] = defaultdict(float)
    for it, ts in recent:
        w = 0.5 ** (max(0.0, now - ts) / (half_life_h * 3600))
        for b, s in table.get(it, []):
            if b not in seen:
                acc[b] += w * s
    return [(b, round(s, 6)) for s, b in heapq.nsmallest(k, ((s, b) for b, s in acc.items()),
                                                           key=lambda x: (-x[0], x[1]))]
