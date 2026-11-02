"""Set de entrenamiento del ranker (caso c08): impresiones + etiquetas, sin fuga de información.

Entradas (en producción, tablas particionadas por día; aquí, listas de dicts para poder probarlo):
  impressions  lo que logueó el home-api por request (serving/home_api.py): request_id, user_id, ts, path,
               model_version y, por ítem servido, posición, fuente, exploración, propensity y el
               FEATURE SNAPSHOT con el que se rankeó (log-and-wait: no se recalcula nada aquí)
  views        evento del cliente: el ítem estuvo EN PANTALLA (request_id, item_id, ts). Servido ≠ visto:
               de 50 servidos se ven ≈ 10; los otros 40 no son negativos, nadie los vio
  clicks       evento del cliente: abrió la publicación desde el home (request_id, item_id, ts)
  contacts     evento del servidor de mensajes: escribió al vendedor (user_id, item_id, ts). No trae
               request_id: el contacto puede ocurrir horas después, desde otra pantalla
  sold         evento del servicio de publicaciones: el ítem se vendió o se dio de baja (item_id, ts)

Etiquetas:
  label_click    = un click con el mismo request_id e item_id, dentro de 30 min desde la vista (la sesión)
  label_contact  = un contacto de esa persona con ese ítem dentro de 24 h desde la vista (etiqueta DEMORADA).
                   Si vio el mismo ítem en varias impresiones, el contacto se atribuye solo a la ÚLTIMA vista
                   anterior (last-touch): un contacto no puede convertirse en tres positivos

Reglas (cada una evita un error que no da ningún mensaje):
  1. MADUREZ. Un ejemplo entra solo si su ventana de etiqueta ya cerró: as_of ≥ vista + 24 h + 1 h de
     gracia (eventos que llegan tarde). La trampa: entrenar a las 00:00 con las impresiones de las 18:00
     y etiquetar como negativo lo que "todavía no tiene contacto". Esos ejemplos están PENDIENTES, no son
     negativos; tratarlos como negativos le enseña al modelo que lo reciente no convierte.
  2. FEATURES DEL SNAPSHOT. Las features salen del registro de impresión, tal como las vio el ranker
     (defaults incluidos). Unir con la tabla de features "de hoy" mete el futuro en el pasado: el
     contador de contactos del ítem ya incluye el contacto que estamos tratando de predecir.
  3. POSICIÓN COMO FEATURE. Se guarda `position`: el modelo separa "le gustó" de "estaba arriba". Al
     servir, la posición se fija en 1 (ver home_api.context_features). Los ejemplos de exploración traen
     su propensity para corregir con IPS o para evaluar off-policy.
  4. SOLO EL CAMINO RANKED. Lo servido por fallback (popular, heurístico) lo eligió otra política y no
     trae snapshot: mezclarlo sesga los datos hacia lo popular.
  5. DEDUPE POR event_id. Los eventos llegan at-least-once: un click repetido no es un segundo click.
  6. NEGATIVOS CENSURADOS. Si el ítem se vendió a otra persona 2 h después de la vista, esta persona tuvo
     2 h para contactar, no 24: `contact_censored` = 1 y `contact_window_s` = 7,200. La cabeza de
     contacto los excluye (o usa la ventana efectiva); si no, lo que se vende rápido (lo más deseado)
     aparece como "no convierte".
  7. SUBMUESTREO DE NEGATIVOS. Con ≈ 0.3 % de contactos, casi todo es negativo. Se guardan todos los
     positivos, todos los de exploración y una fracción `neg_sample_rate` de los negativos con
     weight = 1 / fracción en el loss: sin el peso, el modelo sale descalibrado (sobreestima). La
     elección es determinista por (request_id, item_id): reconstruir el día da el mismo set.
Por qué no hay un filtro extra de "eventos posteriores a as_of": la regla 1 garantiza que toda ventana de
etiqueta termina antes de as_of, así que ningún evento futuro puede entrar a una etiqueta.

En producción es el mismo join en Spark/SQL, diario e incremental. Aquí es Python puro para leerlo y probarlo.
"""

from __future__ import annotations  # anotaciones como texto: sintaxis moderna sin costo en runtime

import bisect  # buscar la última vista anterior a un contacto
import hashlib  # muestreo determinista de negativos
from collections import defaultdict  # índices por clave
from collections.abc import Iterable  # entradas como iterables (en prod no caben en memoria)
from dataclasses import dataclass, field  # config y estadísticas

HOUR_S = 3600.0


@dataclass(frozen=True)
class LabelConfig:
    click_window_s: float = 30 * 60  # click en la misma sesión: ≤ 30 min desde la vista
    contact_window_s: float = 24 * HOUR_S  # contacto ≤ 24 h desde la vista (SPEC del caso)
    late_grace_s: float = 1 * HOUR_S  # margen para eventos que llegan tarde (mide el tuyo: p99 del retraso)
    allowed_paths: frozenset[str] = frozenset({"ranked"})
    neg_sample_rate: float = 1.0  # en producción ≈ 0.1 (todos los positivos, 10 % de los negativos, peso 10)


@dataclass
class BuildStats:
    served: int = 0  # ítems servidos en los registros de impresión
    not_viewed: int = 0  # servidos que nunca estuvieron en pantalla (no son ejemplos)
    pending: int = 0  # vistos con la ventana de etiqueta abierta (NO negativos: entran mañana)
    skipped_path: int = 0  # servidos por un fallback
    duplicate_events: int = 0  # eventos repetidos (at-least-once)
    examples: int = 0
    positives_click: int = 0
    positives_contact: int = 0
    censored: int = 0  # negativos de contacto con la ventana cortada por una venta
    negatives_dropped: int = 0  # descartados por el submuestreo
    by_path: dict[str, int] = field(default_factory=dict)


def _dedupe(events: Iterable[dict], stats: BuildStats) -> list[dict]:
    seen, out = set(), []
    for e in events:
        if e["event_id"] in seen:
            stats.duplicate_events += 1
            continue
        seen.add(e["event_id"])
        out.append(e)
    return out


def _keep_negative(request_id: str, item_id: str, rate: float) -> bool:
    """Misma decisión siempre para el mismo ejemplo (sha256, no random): el set se puede reconstruir."""
    h = hashlib.sha256(f"{request_id}|{item_id}".encode()).digest()
    return int.from_bytes(h[:8], "big") / 2**64 < rate


def build(impressions: Iterable[dict], views: Iterable[dict], clicks: Iterable[dict],
          contacts: Iterable[dict], as_of: float, cfg: LabelConfig | None = None,
          sold: Iterable[dict] = ()) -> tuple[list[dict], BuildStats]:
    """Devuelve (ejemplos, estadísticas). Un ejemplo = un ítem VISTO en una impresión del camino ranked
    cuya ventana de etiqueta ya cerró en `as_of`."""
    cfg = cfg or LabelConfig()
    st = BuildStats()
    views, clicks, contacts = _dedupe(views, st), _dedupe(clicks, st), _dedupe(contacts, st)
    sold_at: dict[str, float] = {}
    for e in _dedupe(sold, st):
        sold_at[e["item_id"]] = min(sold_at.get(e["item_id"], e["ts"]), e["ts"])

    # Primera vista de cada (request_id, item_id): volver a pasar por el ítem al hacer scroll no es otra vista
    first_view: dict[tuple[str, str], float] = {}
    for v in views:
        k = (v["request_id"], v["item_id"])
        first_view[k] = min(first_view.get(k, v["ts"]), v["ts"])

    clicks_by_key: dict[tuple[str, str], list[float]] = defaultdict(list)
    for c in clicks:
        clicks_by_key[(c["request_id"], c["item_id"])].append(c["ts"])

    # Vistas por (usuario, ítem), ordenadas: para atribuir cada contacto a la ÚLTIMA vista anterior
    rows = []  # (request record, item entry, view_ts)
    views_by_ui: dict[tuple[str, str], list[float]] = defaultdict(list)
    for rec in impressions:
        for it in rec["items"]:
            st.served += 1
            st.by_path[rec["path"]] = st.by_path.get(rec["path"], 0) + 1
            if rec["path"] not in cfg.allowed_paths:
                st.skipped_path += 1
                continue
            vt = first_view.get((rec["request_id"], it["item_id"]))
            if vt is None:
                st.not_viewed += 1
                continue
            rows.append((rec, it, vt))
            views_by_ui[(rec["user_id"], it["item_id"])].append(vt)
    for lst in views_by_ui.values():
        lst.sort()

    # Contacto → la última vista con vista ≤ contacto ≤ vista + 24 h
    contacted: set[tuple[str, str, float]] = set()
    for c in contacts:
        lst = views_by_ui.get((c["user_id"], c["item_id"]))
        if not lst:
            continue
        i = bisect.bisect_right(lst, c["ts"]) - 1  # última vista con ts ≤ contacto
        if i >= 0 and c["ts"] - lst[i] <= cfg.contact_window_s:
            contacted.add((c["user_id"], c["item_id"], lst[i]))

    out = []
    for rec, it, vt in rows:
        if as_of < vt + cfg.contact_window_s + cfg.late_grace_s:
            st.pending += 1  # la trampa: NO es un negativo
            continue
        click = any(vt <= t <= vt + cfg.click_window_s for t in clicks_by_key.get((rec["request_id"], it["item_id"]), ()))
        contact = (rec["user_id"], it["item_id"], vt) in contacted
        window = cfg.contact_window_s
        sold_ts = sold_at.get(it["item_id"])
        censored = not contact and sold_ts is not None and vt <= sold_ts < vt + cfg.contact_window_s
        if censored:
            window = sold_ts - vt  # tuvo solo este tiempo para contactar
            st.censored += 1
        weight = 1.0
        if not (click or contact or it["exploration"]) and cfg.neg_sample_rate < 1.0:
            if not _keep_negative(rec["request_id"], it["item_id"], cfg.neg_sample_rate):
                st.negatives_dropped += 1
                continue
            weight = 1.0 / cfg.neg_sample_rate
        out.append({
            "request_id": rec["request_id"], "user_id": rec["user_id"], "item_id": it["item_id"],
            "view_ts": vt, "position": it["position"], "page": rec["page"],
            "source": it["source"], "sources": it["sources"],
            "exploration": it["exploration"], "propensity": it["propensity"],
            "model_version": rec["model_version"], "feature_set_version": rec["feature_set_version"],
            "user_features": rec["user_features"], "context_features": rec["context_features"],
            "item_features": it["features"], "features_defaulted": it["features_defaulted"],
            "label_click": int(click), "label_contact": int(contact),
            "contact_censored": int(censored), "contact_window_s": window, "weight": weight,
        })
        st.positives_click += int(click)
        st.positives_contact += int(contact)
    st.examples = len(out)
    return out, st
