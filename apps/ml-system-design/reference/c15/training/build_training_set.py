"""Set de entrenamiento del modelo de CTR (caso c15): impresiones VISIBLES + clicks, sin fugas ni sesgos.

Entradas (en producción, particiones diarias del tópico ad-events en el lake; aquí, listas de dicts para
poder probarlo). Los tres tipos los escribe serving/ad_api.py:
  serves       evento "serve": request_id, ts, context (section, device, geo, hour, dow), interests (solo
               con consentimiento), model_version y, por slot vendido: imp_id, slot, atributos del anuncio,
               pctr, price, src (model | explore | fallback), propensity y eligible (exploración, para IPS)
  impressions  beacon de impresión VISIBLE (la página lo manda con ≥ 50 % de píxeles en pantalla ≥ 1 s):
               imp_id, ts
  clicks       click con token válido: imp_id, ts, price; `invalid` = True si después lo marcó el filtro de
               tráfico inválido (IVT)
Etiqueta: label = 1 si hay un click de esa impresión entre el serve y 30 min después de que fue visible.

Ejemplo con las 3 impresiones de un request servido a las 12:00:00 y una de otro request (build a las
13:30, ventana 30 min, gracia 30 min):
  top           visible 12:00:02, click 12:00:20           → positiva
  in_article    visible 12:01:00, sin click                 → negativa (si el muestreo la conserva)
  bottom        nunca visible                               → NO es fila (nadie la vio)
  otro request  visible 13:20:00                            → pendiente: su ventana cierra a las 13:50 (+ gracia)

Reglas (cada una evita un error que no da ningún mensaje):
  1. SOLO VISIBLES. Una impresión servida que nadie vio (el slot de abajo en una nota que nadie scrolleó)
     no es un negativo: no hubo oportunidad de click. Si entrara, el modelo aprendería que el slot de abajo
     "no funciona" cuando en realidad no se ve, y la calibración se movería con la tasa de visibilidad.
     Excepción, la regla de interacción del MRC (Viewable Ad Impression Measurement Guidelines, 2014): un
     click válido cuenta como visible aunque el beacon no haya llegado (bloqueado, perdido, o el click fue
     antes del segundo de visibilidad). El precio de la regla: si el beacon se pierde por algo que no depende
     del click (la red), de esas impresiones solo entran las que tuvieron click, y el CTR del set sube
     ≈ pérdida ÷ (1 − pérdida) (≈ 3 % con 3 % de beacons perdidos, medido en el mundo sintético). La
     calibración en tiempo real del ad-api cuenta solo clicks de impresiones con beacon, así que lo ve: el
     modelo entrenado con este set marca ≈ 0.97 ahí. Por eso se marca `viewable_by_click`, para medirlo aparte.
  2. DEDUPE. Los eventos llegan at-least-once (reintentos de la página y del productor): por event_id, y
     por imp_id: el segundo beacon o el segundo click de la misma impresión no son otra impresión ni otro
     positivo.
  3. VENTANA documentada: click en [serve, visible + 30 min]. Un click a las 2 h se cobra (es facturable)
     pero aquí es negativo: la ventana es parte de la DEFINICIÓN de lo que predice el modelo, y cambiarla
     cambia el modelo. Esos clicks se cuentan (`late_clicks`) para saber cuánto deja afuera.
  4. MADUREZ. Una impresión entra solo cuando su ventana cerró: as_of ≥ visible + 30 min + gracia para
     eventos tardíos. Antes está PENDIENTE, no es negativa: entrenar con las impresiones de los últimos
     minutos como negativas le enseña al modelo que lo reciente no recibe clicks.
  5. TRÁFICO INVÁLIDO: si el click quedó marcado como IVT, la fila entera sale (un bot que "vio" y "dio
     click" no es un positivo ni un negativo de una persona).
  6. SUBMUESTREO DE NEGATIVOS determinista: todos los clicks y una fracción w de los no-clicks, elegida por
     hash del imp_id (no random()): reconstruir el día da el mismo set. Cada fila guarda neg_rate = w
     (las positivas también): el modelo corrige con q = p / (p + (1 − p) / w) (serving/model.py) y
     train_logreg.py no mezcla filas con distintas w (cambiar w a mitad de la ventana de 14 días dejaría
     días con escalas distintas en el mismo set).
  7. HOLDOUT SIN SUBMUESTREAR para medir calibración: neg_rate = 1 y, si hace falta achicarlo,
     `uniform_rate` (muestra uniforme de las DOS clases: no cambia el CTR). Cada muestreador usa su propia
     sal en el hash; con la misma sal, los negativos del holdout serían siempre los mismos del training.
  8. FEATURES DEL LOG: el registro crudo de cada fila sale del evento serve (features.make_raw): los valores
     que vio el modelo en el request, no un recálculo con los datos de hoy.
La columna `pctr_served` (lo que predijo el modelo que estaba en producción) NO es una feature: meterla
copia los errores del modelo viejo. Se guarda para evaluar y para la calibración por slice.
En producción es el mismo join en Spark/SQL, diario; aquí, Python puro para leerlo y probarlo.
"""

from __future__ import annotations  # anotaciones como texto: sintaxis moderna sin costo en runtime

import hashlib  # muestreo determinista por imp_id
from collections.abc import Iterable  # entradas como iterables (en producción no caben en memoria)
from dataclasses import dataclass  # configuración y estadísticas

import features as F  # serving/features.py: el MISMO armado del registro crudo que usa el ad-api

MINUTE_S = 60.0


@dataclass(frozen=True)
class LabelConfig:
    # Dato del caso: click ≤ 30 min desde la impresión visible. El ad-api usa la MISMA ventana para la
    # calibración en tiempo real (ad_api.Settings.click_window_s; un test exige que sean iguales)
    click_window_s: float = 30 * MINUTE_S
    # Gracia para el retraso de llegada de ad-events al lake (productor con buffer, consumer atrasado,
    # particiones que cierran tarde). Mide su p99 y ponlo aquí; 30 min es ilustrativo. No cubre beacons
    # viejos: el ad-api rechaza los de más de IMP_MAX_AGE_S desde el serve y esos nunca llegan al log.
    late_grace_s: float = 30 * MINUTE_S
    neg_rate: float = 0.05  # w: fracción de no-clicks que se conserva (dato del caso: 5 %)
    uniform_rate: float = 1.0  # < 1 solo para achicar un holdout (las dos clases por igual)


@dataclass
class BuildStats:
    served: int = 0  # slots vendidos en los eventos serve
    duplicate_events: int = 0  # mismo event_id dos veces (at-least-once)
    duplicate_beacons: int = 0  # segundo beacon de la misma impresión
    duplicate_clicks: int = 0  # segundo click de la misma impresión (doble click, recarga)
    orphan_impressions: int = 0  # beacon sin serve (el evento serve se perdió): sin features, no es fila
    orphan_clicks: int = 0
    not_viewable: int = 0  # servidas que nadie vio: NO son negativas
    viewable_by_click: int = 0  # visibles por la regla de interacción (click sin beacon)
    pending: int = 0  # ventana abierta en as_of: entran mañana
    invalid_traffic: int = 0  # filas descartadas por IVT
    late_clicks: int = 0  # clicks fuera de la ventana (facturados, negativos aquí)
    negatives_dropped: int = 0  # por el submuestreo de negativos
    uniform_dropped: int = 0  # por el submuestreo uniforme
    examples: int = 0
    positives: int = 0


def _unit(salt: str, key: str) -> float:
    """[0, 1) determinista por (sal, llave): la misma impresión cae siempre del mismo lado."""
    digest = hashlib.blake2b(f"{salt}|{key}".encode(), digest_size=8).digest()
    return int.from_bytes(digest, "big") / 2**64


def _dedupe(events: Iterable[dict], st: BuildStats) -> list[dict]:
    seen: set[str] = set()
    out = []
    for e in events:
        if e["event_id"] in seen:
            st.duplicate_events += 1
            continue
        seen.add(e["event_id"])
        out.append(e)
    return out


def _first_by_imp(events: Iterable[dict], known: dict) -> tuple[dict[str, float], int, int]:
    """imp_id → primer ts; y cuántos eran huérfanos (sin serve) y cuántos repetidos (misma impresión)."""
    first: dict[str, float] = {}
    orphans = dups = 0
    for e in events:
        iid = e["imp_id"]
        if iid not in known:
            orphans += 1  # el serve se perdió: sin features no hay fila
        elif iid in first:
            dups += 1  # segundo beacon o segundo click: no es otra impresión ni otro positivo
            first[iid] = min(first[iid], e["ts"])
        else:
            first[iid] = e["ts"]
    return first, orphans, dups


def build(serves: Iterable[dict], impressions: Iterable[dict], clicks: Iterable[dict], *, as_of: float,
          cfg: LabelConfig | None = None) -> tuple[list[dict], BuildStats]:
    """Devuelve (filas, estadísticas). Una fila = una impresión visible, madura y válida, que sobrevivió el
    muestreo. `as_of` = cuándo corre el build (en producción, el inicio del job diario)."""
    cfg = cfg or LabelConfig()
    st = BuildStats()
    placements: dict[str, tuple[dict, dict]] = {}  # imp_id → (serve, placement)
    for sv in _dedupe(serves, st):
        for pl in sv["placements"]:
            placements[pl["imp_id"]] = (sv, pl)
            st.served += 1
    views, st.orphan_impressions, st.duplicate_beacons = _first_by_imp(_dedupe(impressions, st), placements)
    valid_clicks, invalid = [], set()
    for c in _dedupe(clicks, st):
        if c.get("invalid"):
            invalid.add(c["imp_id"])  # regla 5: la impresión entera sale
        else:
            valid_clicks.append(c)
    first_click, st.orphan_clicks, st.duplicate_clicks = _first_by_imp(valid_clicks, placements)

    rows = []
    for iid, (sv, pl) in placements.items():
        if iid in invalid:
            st.invalid_traffic += 1
            continue
        view_ts, click_ts = views.get(iid), first_click.get(iid)
        by_click = False
        if view_ts is None:
            if click_ts is None:
                st.not_viewable += 1  # regla 1: nadie la vio
                continue
            view_ts, by_click = click_ts, True  # regla de interacción: el click prueba que se vio
        if as_of < view_ts + cfg.click_window_s + cfg.late_grace_s:
            st.pending += 1  # regla 4: NO es un negativo
            continue
        label = int(click_ts is not None and sv["ts"] <= click_ts <= view_ts + cfg.click_window_s)
        if click_ts is not None and not label:
            st.late_clicks += 1  # regla 3
        st.viewable_by_click += by_click
        if cfg.uniform_rate < 1.0 and _unit("holdout", iid) >= cfg.uniform_rate:
            st.uniform_dropped += 1  # regla 7 (las dos clases)
            continue
        if not label and cfg.neg_rate < 1.0 and _unit("neg", iid) >= cfg.neg_rate:
            st.negatives_dropped += 1  # regla 6 (solo negativos)
            continue
        rows.append({
            "imp_id": iid, "request_id": sv["request_id"], "serve_ts": sv["ts"], "view_ts": view_ts,
            "click_ts": click_ts if label else None, "label": label, "slot": pl["slot"],
            "ad_id": pl["ad_id"], "campaign_id": pl["campaign_id"], "advertiser_id": pl["advertiser_id"],
            "src": pl["src"], "propensity": pl.get("propensity", 1.0), "eligible": pl.get("eligible", 0),
            "pctr_served": pl.get("pctr"),
            "model_version": sv.get("model_version"), "viewable_by_click": int(by_click),
            "raw": F.make_raw(sv["context"], sv.get("interests") or (), pl),  # regla 8
            "neg_rate": cfg.neg_rate, "uniform_rate": cfg.uniform_rate,
        })
        st.positives += label
    st.examples = len(rows)
    return rows, st


def single_neg_rate(rows: Iterable[dict]) -> float:
    """La w común a todas las filas. Mezclar tasas rompe la corrección (una sola w por modelo)."""
    rates = {r["neg_rate"] for r in rows}
    if len(rates) != 1:
        raise ValueError(f"filas con distintas neg_rate {sorted(rates)}: re-muestrea a una sola w "
                         "o entrena con peso 1/w por fila y SIN la corrección (nunca las dos cosas)")
    return rates.pop()
