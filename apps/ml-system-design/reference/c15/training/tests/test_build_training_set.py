"""Tests de build_training_set.py con eventos escritos a mano (cada regla, un caso)."""

import pytest

import build_training_set as B
import features as F

T = 1_000_000.0  # serve a las T
CTX = {"section": "deportes", "device": "mobile", "geo": "MX-NLE", "hour": 8, "dow": 3}
AD = {"ad_id": "a1", "campaign_id": "c1", "advertiser_id": "v1", "ad_category": "autos", "ad_format": "native"}
LATE = T + 10 * 3600  # un build que corre horas después: todas las ventanas cerradas
NO_SAMPLING = B.LabelConfig(neg_rate=1.0)


def serve(rid="r1", slots=("top", "in_article", "bottom"), ts=T, interests=("autos",)):
    return {"type": "serve", "event_id": f"s-{rid}", "request_id": rid, "ts": ts, "context": CTX,
            "interests": list(interests), "model_version": "m1",
            "placements": [{"imp_id": f"{rid}:{s}", "slot": s, **AD, "pctr": 0.01, "price": 0.3,
                            "src": "model", "propensity": 1.0} for s in slots]}


def imp(rid, slot, ts, eid=None):
    return {"type": "impression", "event_id": eid or f"i-{rid}-{slot}-{ts}", "imp_id": f"{rid}:{slot}", "ts": ts}


def click(rid, slot, ts, eid=None, invalid=False):
    return {"type": "click", "event_id": eid or f"k-{rid}-{slot}-{ts}", "imp_id": f"{rid}:{slot}", "ts": ts,
            "price": 0.3, "invalid": invalid}


def by_slot(rows):
    return {r["slot"]: r for r in rows}


def test_docstring_example():
    # top visible y con click a los 20 s; in_article visible sin click; bottom nunca visible
    rows, st = B.build([serve()], [imp("r1", "top", T + 2), imp("r1", "in_article", T + 60)],
                       [click("r1", "top", T + 20)], as_of=LATE, cfg=NO_SAMPLING)
    got = by_slot(rows)
    assert got["top"]["label"] == 1 and got["in_article"]["label"] == 0
    assert "bottom" not in got and st.not_viewable == 1  # nadie la vio: no es un negativo
    assert got["top"]["raw"] == F.make_raw(CTX, ["autos"], AD)  # las features del log, armadas por features.py


def test_pending_rows_are_not_negatives():
    # visible a las T + 1 h 20 min; el build corre a las T + 1 h 30 min: la ventana (30 min + 30 de gracia)
    # sigue abierta
    rows, st = B.build([serve(slots=("top",))], [imp("r1", "top", T + 80 * 60)], [], as_of=T + 90 * 60,
                       cfg=NO_SAMPLING)
    assert rows == [] and st.pending == 1
    rows, _ = B.build([serve(slots=("top",))], [imp("r1", "top", T + 80 * 60)], [], as_of=T + 141 * 60,
                      cfg=NO_SAMPLING)
    assert rows[0]["label"] == 0  # ya maduró: ahora sí es negativo


def test_label_window_is_thirty_minutes_after_viewable():
    rows, st = B.build([serve(slots=("top", "in_article"))],
                       [imp("r1", "top", T + 5), imp("r1", "in_article", T + 5)],
                       [click("r1", "top", T + 5 + 29 * 60), click("r1", "in_article", T + 5 + 31 * 60)],
                       as_of=LATE, cfg=NO_SAMPLING)
    got = by_slot(rows)
    assert got["top"]["label"] == 1
    assert got["in_article"]["label"] == 0 and st.late_clicks == 1  # se facturó, pero aquí es negativo


def test_click_without_beacon_counts_as_viewable():
    # El beacon se perdió (o el click fue antes del segundo de visibilidad): regla de interacción del MRC
    rows, st = B.build([serve(slots=("top",))], [], [click("r1", "top", T + 0.6)], as_of=LATE, cfg=NO_SAMPLING)
    assert rows[0]["label"] == 1 and rows[0]["viewable_by_click"] == 1 and st.viewable_by_click == 1


def test_duplicates_do_not_create_examples_or_positives():
    events_imp = [imp("r1", "top", T + 2, eid="e1"), imp("r1", "top", T + 2, eid="e1"),  # mismo event_id
                  imp("r1", "top", T + 3, eid="e2")]  # otro beacon de la MISMA impresión
    events_clk = [click("r1", "top", T + 10, eid="c1"), click("r1", "top", T + 11, eid="c2")]  # doble click
    rows, st = B.build([serve(slots=("top",)), serve(slots=("top",))], events_imp, events_clk, as_of=LATE,
                       cfg=NO_SAMPLING)
    assert len(rows) == 1 and rows[0]["label"] == 1 and rows[0]["view_ts"] == T + 2
    assert (st.duplicate_events, st.duplicate_beacons, st.duplicate_clicks) == (2, 1, 1)  # serve + beacon


def test_invalid_traffic_removes_the_whole_row():
    rows, st = B.build([serve(slots=("top",))], [imp("r1", "top", T + 2)], [click("r1", "top", T + 9, invalid=True)],
                       as_of=LATE, cfg=NO_SAMPLING)
    assert rows == [] and st.invalid_traffic == 1


def test_orphans_without_serve_are_counted_not_used():
    rows, st = B.build([], [imp("rX", "top", T)], [click("rX", "top", T + 3)], as_of=LATE, cfg=NO_SAMPLING)
    assert rows == [] and (st.orphan_impressions, st.orphan_clicks) == (1, 1)


def many(n=4000, ctr_every=50):
    serves = [serve(rid=f"r{i}", slots=("top",)) for i in range(n)]
    imps = [imp(f"r{i}", "top", T + 2) for i in range(n)]
    clicks = [click(f"r{i}", "top", T + 30) for i in range(0, n, ctr_every)]  # 2 % de CTR
    return serves, imps, clicks


def test_negative_downsampling_keeps_all_clicks_and_about_w_of_the_rest_deterministically():
    s, i, c = many()
    rows, st = B.build(s, i, c, as_of=LATE, cfg=B.LabelConfig(neg_rate=0.05))
    pos = [r for r in rows if r["label"]]
    assert len(pos) == 80  # todos los clicks
    assert 0.035 < (len(rows) - 80) / 3920 < 0.065  # ≈ 5 % de los 3,920 negativos
    assert all(r["neg_rate"] == 0.05 for r in rows)  # cada fila lleva su w
    again, _ = B.build(s, i, c, as_of=LATE, cfg=B.LabelConfig(neg_rate=0.05))
    assert [r["imp_id"] for r in again] == [r["imp_id"] for r in rows]  # reconstruir da lo mismo


def test_uniform_holdout_keeps_the_ctr_and_uses_its_own_salt():
    s, i, c = many(n=20_000)
    hold, _ = B.build(s, i, c, as_of=LATE, cfg=B.LabelConfig(neg_rate=1.0, uniform_rate=0.2))
    ctr = sum(r["label"] for r in hold) / len(hold)
    assert 0.2 * 0.8 < len(hold) / 20_000 < 0.2 * 1.2 and 0.012 < ctr < 0.028  # CTR ≈ 2 %: no cambia
    train, _ = B.build(s, i, c, as_of=LATE, cfg=B.LabelConfig(neg_rate=0.2))
    neg_h = {r["imp_id"] for r in hold if not r["label"]}
    neg_t = {r["imp_id"] for r in train if not r["label"]}
    # Con la misma sal serían el MISMO conjunto; con sales distintas se solapan ≈ 20 % × 20 %
    assert len(neg_h & neg_t) / len(neg_h) < 0.35


def test_mixed_neg_rates_are_refused():
    s, i, c = many(n=400)
    a, _ = B.build(s[:200], i[:200], c, as_of=LATE, cfg=B.LabelConfig(neg_rate=0.05))
    b, _ = B.build(s[200:], i[200:], c, as_of=LATE, cfg=B.LabelConfig(neg_rate=0.02))
    assert B.single_neg_rate(a) == 0.05
    with pytest.raises(ValueError, match="neg_rate"):
        B.single_neg_rate(a + b)


def test_sensitive_interests_are_cleaned_again_in_training():
    rows, _ = B.build([serve(slots=("top",), interests=("salud", "autos"))], [imp("r1", "top", T + 2)], [],
                      as_of=LATE, cfg=NO_SAMPLING)
    assert rows[0]["raw"]["interests"] == ["autos"]  # aunque el log trajera "salud", no entra al modelo
