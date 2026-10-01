"""Set de entrenamiento point-in-time (caso c09): features "como se veían" en cada pago + etiqueta madura.

Entrada: el log de eventos de pago (un renglón por intento SCOREADO, aprobado o no: los contadores
online cuentan intentos, y un ataque de card testing está hecho de intentos declinados) y la tabla de
etiquetas (chargebacks por fraude y fraude confirmado). Salida: una fila por pago autorizado y maduro,
con las MISMAS features que vio el servicio de scoring.

Las 5 reglas, cada una con la trampa que evita:

1. Features con la definición de definitions.py y la misma ventana por buckets que online. Solo cuentan
   eventos ANTERIORES en el orden del log (event_time y, a igual event_time, el orden de llegada): el
   pago no entra en su propio agregado. Trampa: un `BETWEEN ts - 60 AND ts` en SQL incluye al propio
   pago, y "0 intentos previos" pasa a ser "1".
2. Duplicados por payment_id (reintentos del orquestador) se quedan una vez: el primero. Online la
   guardia de idempotencia hace lo mismo.
3. Features batch con un as-of join sobre `available_at` (cuándo se PUBLICÓ el snapshot), estrictamente
   antes del pago. Trampa: unir por fecha del snapshot le da al pago de la 01:00 un valor que se calculó
   esa madrugada con datos que incluyen al propio pago (leakage).
4. Etiqueta = chargeback por fraude o fraude confirmado con `label_time ≤ event_time + maturity_days`.
   Los pagos más jóvenes que `maturity_days` respecto de `as_of` NO son negativos: se DESCARTAN (y se
   cuentan). Trampa: con 30 días de antigüedad llegó ≈ 60 % de los chargebacks (estimación del caso); si
   los etiquetas como negativos, el modelo aprende que lo reciente es seguro, justo lo que el fraude
   nuevo aprovecha.
5. Solo los pagos AUTORIZADOS pueden recibir un chargeback. Los declinados (y los step-up abandonados)
   no tienen etiqueta: se usan para las features (cuentan como intentos) pero no como filas. Es el sesgo
   de selección del caso: el modelo nunca ve qué habría pasado con lo que bloqueó. Las filas de la
   exploración (≈ 1 % de lo que se iba a declinar, mandado a step-up) llevan peso 1/propensity.

En producción esto es un job de Spark/SQL sobre el data lake (window functions por entidad); aquí es
pandas para poder leerlo y probarlo. El test de paridad reproduce un stream por OnlineCounters y exige
el mismo valor que este archivo, pago por pago.
"""

from __future__ import annotations  # anotaciones como texto

from dataclasses import asdict, dataclass  # el reporte del build

import numpy as np  # searchsorted y cumsum por grupo
import pandas as pd  # el log de eventos es una tabla

import definitions as d  # la ÚNICA definición de cada feature

DAY_S = 86400


@dataclass
class BuildReport:
    """Lo que se imprime (y se guarda junto al dataset) en cada build: si cambia mucho, algo cambió arriba."""

    n_events: int  # intentos en el log (incluidos duplicados)
    n_duplicates: int  # reintentos descartados por payment_id
    n_not_authorized: int  # declinados o step-up no completado: sin etiqueta posible
    n_immature: int  # autorizados pero más jóvenes que maturity_days: NO son negativos
    n_rows: int  # filas finales
    n_positive: int
    positive_rate: float  # por conteo (el caso: ≈ 0.08 %)
    positive_value_rate: float  # por monto (el caso: ≈ 0.12 % = 12 bps; el fraude va a tickets más altos)

    def as_dict(self) -> dict:
        return asdict(self)


# ------------------------------------------------------------------------------------ paso 1 y 2
def order_and_dedupe(events: pd.DataFrame) -> tuple[pd.DataFrame, int]:
    """Orden del log + un renglón por payment_id (el primero). Devuelve (eventos, duplicados quitados)."""
    ev = events.copy()
    # `seq` = orden de llegada (offset de Kafka). Si no viene, el orden de las filas. Desempata pagos con
    # el mismo event_time exactamente como los vio el contador online: en el orden en que llegaron.
    if "seq" not in ev.columns:
        ev["seq"] = np.arange(len(ev))
    ev = ev.sort_values(["event_time", "seq"], kind="stable")
    before = len(ev)
    ev = ev.drop_duplicates("payment_id", keep="first").reset_index(drop=True)
    return ev, before - len(ev)


def windowed_values(ev: pd.DataFrame, feature: d.WindowedFeature) -> np.ndarray:
    """Valor de `feature` para cada fila de `ev` (ya ordenado y sin duplicados), contando solo lo anterior.

    Por grupo de entidad, los eventos están en orden de tiempo, así que su bucket no decrece: los que
    caen dentro de la ventana son un BLOQUE CONTIGUO que termina justo antes de la fila. `searchsorted`
    encuentra dónde empieza; contar y sumar son restas de sumas acumuladas. Es la versión vectorizada de
    lo que hace Spark con `RANGE BETWEEN` en una window function.
    """
    n = len(ev)
    out = np.full(n, d.DEFAULT_VALUE)  # sin entidad → NaN (faltante), igual que online
    col = d.ENTITY_FIELDS[feature.entity]
    if col not in ev.columns:
        return out
    # Mismo floor que definitions.bucket_index
    buckets = np.floor(ev["event_time"].to_numpy(dtype=float) / feature.bucket_s).astype(np.int64)
    lo = buckets - feature.n_buckets + 1  # primer bucket de la ventana de cada fila (bucket_range)
    keys = ev[col].map(lambda v: None if d.is_missing(v) else str(v))  # misma regla que online
    contrib = [d.contribution(row, feature) for row in ev.to_dict("records")]
    for _, idx in keys.groupby(keys, sort=False).indices.items():  # filas con entidad (NaN/None excluidos)
        idx = np.asarray(idx)  # posiciones en orden creciente = orden del log
        b = buckets[idx]
        start = np.searchsorted(b, lo[idx], side="left")  # primer evento del grupo dentro de la ventana
        k = np.arange(len(idx))  # la fila misma: la ventana es [start, k), estrictamente antes
        if feature.agg == "count":
            vals = (k - start).astype(float)
        elif feature.agg == "sum":
            amounts = np.array([int(contrib[i] or 0) for i in idx], dtype=np.int64)
            csum = np.concatenate([[0], np.cumsum(amounts)])  # csum[j] = suma de los primeros j
            vals = (csum[k] - csum[start]).astype(float)
        else:
            # distinct: conjunto de valores en [start, k). Exacto, como el SET de Redis. O(n · ventana):
            # suficiente aquí; Spark usaría collect_set o approx_count_distinct (HLL, ya no exacto).
            members = [contrib[i] for i in idx]
            vals = np.array([len({m for m in members[s:j] if m is not None})
                             for j, s in zip(k, start)], dtype=float)
        if feature.include_current:
            if feature.agg == "distinct":
                members = [contrib[i] for i in idx]
                vals = vals + np.array([1.0 if members[j] is not None and members[j] not in members[s:j] else 0.0
                                        for j, s in zip(k, start)])
            else:
                vals = vals + np.array([float(contrib[i] or 0) for i in idx])
        out[idx] = vals
    return out


def compute_windowed(events: pd.DataFrame, features=d.WINDOWED_FEATURES) -> tuple[pd.DataFrame, int]:
    """Todas las features por ventana + las del request. Devuelve (tabla, duplicados quitados)."""
    ev, n_dup = order_and_dedupe(events)
    for f in features:
        ev[f.name] = windowed_values(ev, f)
    req = pd.DataFrame([d.request_features(r) for r in ev.to_dict("records")], index=ev.index)
    return pd.concat([ev, req], axis=1), n_dup


# ------------------------------------------------------------------------------------------ paso 3
def join_batch(rows: pd.DataFrame, snapshots: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """As-of join de los snapshots diarios: el último publicado ESTRICTAMENTE antes del pago.

    `snapshots[entity]` tiene columnas `entity_id`, `available_at` (epoch s en que el job lo publicó en
    el online store) y una columna por BatchFeature de esa entidad.
    """
    out = rows.sort_values("event_time", kind="stable")
    for entity, snap in snapshots.items():
        col = d.ENTITY_FIELDS[entity]
        names = [f.name for f in d.BATCH_FEATURES if f.entity == entity]
        right = snap[["entity_id", "available_at", *names]].sort_values("available_at")
        right = right.rename(columns={"entity_id": col})
        right[col] = right[col].astype(str)
        left = out.copy()
        left[col] = left[col].astype(str)
        # allow_exact_matches=False: publicado en el MISMO segundo del pago tampoco se veía
        merged = pd.merge_asof(left, right, left_on="event_time", right_on="available_at", by=col,
                               direction="backward", allow_exact_matches=False)
        out = merged.drop(columns=["available_at"])
        out[col] = rows.set_index("payment_id").loc[out["payment_id"], col].to_numpy()  # restaura None
    for f in d.BATCH_FEATURES:  # entidades sin snapshot → faltante
        if f.name not in out.columns:
            out[f.name] = d.DEFAULT_VALUE
    return out.sort_values(["event_time", "seq"], kind="stable").reset_index(drop=True)


# ------------------------------------------------------------------------------------------ paso 4 y 5
def label_and_filter(rows: pd.DataFrame, labels: pd.DataFrame, as_of: float,
                     maturity_days: int) -> tuple[pd.DataFrame, dict]:
    """Etiqueta madura + filas que pueden tener etiqueta. Devuelve (filas, conteos)."""
    maturity_s = maturity_days * DAY_S
    # 5) solo autorizados. `authorized` lo escribe el orquestador con el resultado final (aprobado por el
    #    emisor, step-up completado). Sin esa columna, se aproxima con la decisión: approve y review pasan;
    #    un step-up sin resultado no se puede saber, así que no entra.
    if "authorized" in rows.columns:
        authorized = rows["authorized"].astype(bool)
    else:
        authorized = rows["decision"].isin(["approve", "review"]) if "decision" in rows.columns \
            else pd.Series(True, index=rows.index)
    n_not_auth = int((~authorized).sum())
    rows = rows[authorized]
    # 4) madurez: event_time + maturity ≤ as_of; si no, la ventana de etiqueta sigue abierta
    mature = rows["event_time"] + maturity_s <= as_of
    n_immature = int((~mature).sum())
    rows = rows[mature].copy()
    # La etiqueta solo cuenta si llegó dentro de la ventana de madurez. El filtro por as_of es redundante
    # para filas maduras (event_time + maturity ≤ as_of), y se deja como defensa: reconstruir un dataset
    # viejo con la tabla de etiquetas de HOY no debe colar etiquetas que en esa fecha no existían.
    lab = labels[labels["label_time"] <= as_of].merge(rows[["payment_id", "event_time"]], on="payment_id")
    lab = lab[lab["label_time"] <= lab["event_time"] + maturity_s]
    rows["label"] = rows["payment_id"].isin(set(lab["payment_id"])).astype(int)
    # Peso: 1 en general; 1/propensity en la exploración (representa a todo lo que se habría declinado)
    if "propensity" in rows.columns:
        p = rows["propensity"].astype(float)
        rows["weight"] = np.where(p.notna() & (p > 0), 1.0 / p.where(p > 0, 1.0), 1.0)
    else:
        rows["weight"] = 1.0
    return rows, {"n_not_authorized": n_not_auth, "n_immature": n_immature}


def build_training_set(events: pd.DataFrame, labels: pd.DataFrame, as_of: float, maturity_days: int = 90,
                       batch_snapshots: dict[str, pd.DataFrame] | None = None) -> tuple[pd.DataFrame, BuildReport]:
    """Los 5 pasos. `as_of` = el instante del build (epoch s). maturity_days: 90 por defecto (el caso:
    ≈ 90 % de los chargebacks llega en 60 días; mídelo con eval/label_maturity.py)."""
    rows, n_dup = compute_windowed(events)  # 1 y 2: sobre TODOS los intentos (declinados incluidos)
    rows = join_batch(rows, batch_snapshots or {})  # 3
    rows, counts = label_and_filter(rows, labels, as_of, maturity_days)  # 4 y 5
    n = len(rows)
    pos = int(rows["label"].sum())
    value = rows["amount_cents"].sum()
    report = BuildReport(
        n_events=len(events), n_duplicates=n_dup, n_not_authorized=counts["n_not_authorized"],
        n_immature=counts["n_immature"], n_rows=n, n_positive=pos,
        positive_rate=pos / n if n else 0.0,
        positive_value_rate=float(rows.loc[rows["label"] == 1, "amount_cents"].sum() / value) if value else 0.0,
    )
    cols = ["payment_id", "event_time", *d.FEATURE_ORDER, "label", "weight", "amount_cents"]
    return rows[cols].reset_index(drop=True), report
