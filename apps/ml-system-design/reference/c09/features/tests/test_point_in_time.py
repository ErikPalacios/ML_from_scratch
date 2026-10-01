"""Tests del set de entrenamiento: paridad online == offline, madurez, autorizados y as-of join."""

import math

import definitions as d
import numpy as np
import pandas as pd
import pytest
from online_counters import InMemoryKV, OnlineCounters
from point_in_time import DAY_S, build_training_set, compute_windowed, join_batch

T0 = 1_700_000_400  # múltiplo de 3,600: buckets redondos


def synthetic_log(n=1500, seed=7, days=3):
    """Un log realista en lo que importa: entidades que se repiten, ráfagas, faltantes y reintentos."""
    rng = np.random.default_rng(seed)
    rows, t = [], float(T0)
    for i in range(n):
        # ráfagas: 20 % de los eventos a < 5 s del anterior (card testing, reintentos humanos)
        t += float(rng.uniform(0, 5)) if rng.random() < 0.2 else float(rng.exponential(days * DAY_S / n))
        rows.append({
            "payment_id": f"p{i}",
            "event_time": round(t, 3),
            "card_token": f"tok_{rng.integers(30)}",
            "device_hash": None if rng.random() < 0.1 else f"dev_{rng.integers(15)}",
            "ip_hash": f"ip_{rng.integers(10)}",
            "email_hash": f"em_{rng.integers(20)}",
            "merchant_id": f"m_{rng.integers(5)}",
            "amount_cents": int(rng.integers(100, 30000)),
            "ip_country": None if rng.random() < 0.1 else str(rng.choice(["MX", "CO", "BR", "US"])),
            "card_bin_country": "MX",
            "decision": str(rng.choice(["approve", "approve", "approve", "decline"])),
        })
        if rng.random() < 0.05:  # el orquestador reintenta el mismo pago 1–3 s después
            retry = dict(rows[-1], event_time=round(t + float(rng.uniform(1, 3)), 3))
            rows.append(retry)
    log = pd.DataFrame(rows).sort_values("event_time", kind="stable").reset_index(drop=True)
    log["seq"] = np.arange(len(log))  # el offset de Kafka: orden de llegada
    return log


def replay_online(log, features):
    """Pasa el log por los contadores ONLINE en orden de llegada y guarda lo que vio cada pago."""
    clock = {"t": 0.0}
    counters = OnlineCounters(InMemoryKV(lambda: clock["t"]), features=features)
    seen = {}
    for row in log.sort_values(["event_time", "seq"]).to_dict("records"):
        clock["t"] = row["event_time"]
        res = counters.read_and_update(row, row["event_time"])
        seen.setdefault(row["payment_id"], res.values)  # el reintento no pisa lo del primer intento
    return seen


def assert_parity(log, features):
    offline, _ = compute_windowed(log, features)
    online = replay_online(log, features)
    for f in features:
        off = offline[f.name].to_numpy(dtype=float)
        on = np.array([np.nan if online[p][f.name] is None else online[p][f.name] for p in offline["payment_id"]])
        assert np.allclose(off, on, equal_nan=True), f"{f.name}: online y offline difieren"


def test_online_equals_offline_on_a_replayed_stream():
    """LA prueba del archivo: 1,500 pagos (+ reintentos), las 10 features por ventana, valor por valor."""
    log = synthetic_log()
    assert log["payment_id"].duplicated().sum() > 0  # el log trae reintentos de verdad
    assert_parity(log, d.WINDOWED_FEATURES)


def test_parity_holds_for_the_include_current_variant_too():
    incl = tuple(d.WindowedFeature(f.name + "_incl", f.entity, f.window_s, f.bucket_s, f.agg, f.tier,
                                   field=f.field, include_current=True) for f in d.SYNC_FEATURES)
    assert_parity(synthetic_log(n=600, seed=3, days=1), incl)


def test_the_classic_trap_sql_between_includes_the_payment_itself():
    """Un SQL "ingenuo" (eventos con ts entre ts − 60 y ts, inclusive) no es la feature que vio el modelo."""
    log = synthetic_log(n=800, seed=11, days=1)
    offline, _ = compute_windowed(log)
    naive = []
    for row in offline.itertuples():
        same = offline[(offline.card_token == row.card_token)
                       & (offline.event_time >= row.event_time - 60) & (offline.event_time <= row.event_time)]
        naive.append(len(same))
    mismatches = int((np.array(naive) != offline["card_count_60s"].to_numpy()).sum())
    # TODAS difieren: el propio pago siempre entra en el BETWEEN (más el borde de los buckets)
    assert mismatches == len(offline)


def labels_for(log, frauds, delay_days):
    """Etiquetas: chargeback `delay_days` después de cada pago de `frauds`."""
    t = log.drop_duplicates("payment_id").set_index("payment_id")["event_time"]
    return pd.DataFrame({"payment_id": frauds, "label_time": [t[p] + delay_days * DAY_S for p in frauds],
                         "source": "chargeback"})


def test_immature_rows_are_dropped_not_labeled_negative():
    log = synthetic_log(n=400, seed=5, days=3)
    approved = log[log.decision == "approve"].drop_duplicates("payment_id")
    as_of = float(log.event_time.max()) + 90 * DAY_S - 1.5 * DAY_S  # los últimos ≈ 1.5 días aún no maduran
    rows, report = build_training_set(log, labels_for(log, [], 0), as_of=as_of, maturity_days=90)
    young = (approved.event_time + 90 * DAY_S > as_of).sum()
    assert report.n_immature == young > 0
    assert len(rows) == len(approved) - young
    assert set(rows.payment_id).isdisjoint(set(approved[approved.event_time + 90 * DAY_S > as_of].payment_id))


def test_label_must_arrive_within_the_maturity_window():
    log = synthetic_log(n=300, seed=9, days=1)
    approved = log[log.decision == "approve"].drop_duplicates("payment_id").payment_id.tolist()
    late, inside = approved[:3], approved[3:6]
    labels = pd.concat([labels_for(log, inside, 40), labels_for(log, late, 100)])  # 100 > 90 días
    as_of = float(log.event_time.max()) + 200 * DAY_S
    rows, report = build_training_set(log, labels, as_of=as_of, maturity_days=90)
    pos = set(rows.loc[rows.label == 1, "payment_id"])
    assert pos == set(inside)  # el chargeback del día 100 queda fuera de la ventana de 90
    assert report.n_positive == 3
    # La ventana de madurez DEFINE la etiqueta: con 30 días, los chargebacks del día 40 no cuentan
    rows_30, _ = build_training_set(log, labels, as_of=as_of, maturity_days=30)
    assert rows_30.label.sum() == 0


def test_declined_attempts_count_in_features_but_are_not_rows():
    """Card testing: 4 intentos declinados y luego uno aprobado. El aprobado VE los 4; los declinados no
    son filas (nunca tendrán chargeback: no hay etiqueta posible)."""
    base = {"device_hash": "dev_1", "ip_hash": "ip_1", "email_hash": "em_1", "merchant_id": "m_1",
            "amount_cents": 100, "ip_country": "MX", "card_bin_country": "MX", "card_token": "tok_x"}
    log = pd.DataFrame([dict(base, payment_id=f"d{i}", event_time=T0 + i * 5, decision="decline") for i in range(4)]
                       + [dict(base, payment_id="ok", event_time=T0 + 25, decision="approve")])
    rows, report = build_training_set(log, labels_for(log, [], 0), as_of=T0 + 100 * DAY_S, maturity_days=90)
    assert list(rows.payment_id) == ["ok"]
    assert rows.loc[0, "card_count_60s"] == 4
    assert report.n_not_authorized == 4


def test_exploration_rows_carry_inverse_propensity_weight():
    base = {"device_hash": None, "ip_hash": "ip_1", "email_hash": None, "merchant_id": "m_1",
            "amount_cents": 5000, "ip_country": "MX", "card_bin_country": "MX"}
    log = pd.DataFrame([dict(base, payment_id="a", card_token="t1", event_time=T0, authorized=True, propensity=None),
                        dict(base, payment_id="e", card_token="t2", event_time=T0 + 1, authorized=True, propensity=0.01)])
    rows, _ = build_training_set(log, labels_for(log, ["e"], 10), as_of=T0 + 100 * DAY_S)
    w = dict(zip(rows.payment_id, rows.weight))
    assert w == {"a": 1.0, "e": pytest.approx(100.0)}  # 1 explorado representa ≈ 100 que se habrían declinado


def test_batch_snapshot_is_joined_by_publication_time_strictly_before():
    base = {"device_hash": None, "ip_hash": "ip_1", "email_hash": "em_1", "merchant_id": "m_1",
            "amount_cents": 1000, "ip_country": "MX", "card_bin_country": "MX", "decision": "approve"}
    log = pd.DataFrame([dict(base, payment_id="p1", card_token="t1", event_time=T0 + 3600),  # 01:00
                        dict(base, payment_id="p2", card_token="t1", event_time=T0 + 4 * 3600),  # 04:00
                        dict(base, payment_id="p3", card_token="t1", event_time=T0 + 3 * 3600)])  # 03:00 exacto
    log["seq"] = range(3)
    # snapshot del día anterior publicado a las 03:00 (available_at), con card_age_days = 10
    snaps = {"card": pd.DataFrame({"entity_id": ["t1"], "available_at": [T0 + 3 * 3600], "card_age_days": [10.0]})}
    rows, _ = compute_windowed(log)
    out = join_batch(rows, snaps).set_index("payment_id")
    assert math.isnan(out.loc["p1", "card_age_days"])  # a la 01:00 todavía no estaba publicado
    assert math.isnan(out.loc["p3", "card_age_days"])  # publicado en el mismo segundo: tampoco
    assert out.loc["p2", "card_age_days"] == 10.0


def test_report_shows_class_balance_by_count_and_by_value():
    base = {"device_hash": None, "ip_hash": "ip_1", "email_hash": "em_1", "merchant_id": "m_1",
            "ip_country": "MX", "card_bin_country": "MX", "decision": "approve"}
    # 9 pagos de US$10 legítimos y 1 de US$90 fraudulento: 10 % por conteo, 50 % por monto
    log = pd.DataFrame([dict(base, payment_id=f"g{i}", card_token=f"t{i}", event_time=T0 + i, amount_cents=1000)
                        for i in range(9)] + [dict(base, payment_id="f", card_token="tf", event_time=T0 + 9,
                                                   amount_cents=9000)])
    _, report = build_training_set(log, labels_for(log, ["f"], 5), as_of=T0 + 100 * DAY_S)
    assert report.positive_rate == pytest.approx(0.10)
    assert report.positive_value_rate == pytest.approx(0.50)


def test_feature_vector_order_is_the_single_schema():
    assert len(d.FEATURE_ORDER) == len(set(d.FEATURE_ORDER)) == 16
    v = d.vector({"card_count_60s": 3})
    assert v[d.FEATURE_ORDER.index("card_count_60s")] == 3 and math.isnan(v[0])
    exported = d.export_definitions()
    assert {e["name"] for e in exported} == set(d.FEATURE_ORDER) - set(d.REQUEST_FEATURES)
