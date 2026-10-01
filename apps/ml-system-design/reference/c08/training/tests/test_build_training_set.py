"""Tests del set de entrenamiento con líneas de tiempo que se pueden seguir a mano.

T0 = momento de la vista. Horas relativas: H(25) = T0 + 25 h.
"""

import pytest

import build_training_set as bts

T0 = 1_790_000_000.0


def H(h):
    return T0 + h * 3600


def imp(request_id="r1", user="u1", items=("A",), path="ranked", ts=T0 - 1):
    return {
        "request_id": request_id, "user_id": user, "ts": ts, "page": 1, "path": path,
        "model_version": "ranker-2026-09-30", "feature_set_version": "fs-2026-09-28",
        "user_features": [0.1, 0.2], "context_features": [0.0, 1.0, 1.0],
        "items": [{"item_id": it, "position": i + 1, "source": "two_tower", "sources": ["two_tower"],
                   "exploration": False, "propensity": None, "features": [float(i), 0.03],
                   "features_defaulted": False} for i, it in enumerate(items)],
    }


def view(item="A", request_id="r1", ts=T0, eid=None):
    return {"event_id": eid or f"v-{request_id}-{item}-{ts}", "request_id": request_id, "item_id": item, "ts": ts}


def click(item="A", request_id="r1", ts=T0 + 60, eid=None):
    return {"event_id": eid or f"c-{request_id}-{item}-{ts}", "request_id": request_id, "item_id": item, "ts": ts}


def contact(item="A", user="u1", ts=H(2), eid=None):
    return {"event_id": eid or f"k-{user}-{item}-{ts}", "user_id": user, "item_id": item, "ts": ts}


def run(impressions, views, clicks=(), contacts=(), as_of=H(48), sold=(), **cfg):
    return bts.build(impressions, views, clicks, contacts, as_of, bts.LabelConfig(**cfg) if cfg else None, sold=sold)


# ---------------------------------------------------------------------------- la trampa: madurez
def test_young_example_is_pending_not_negative():
    # Vista a las T0, contacto a las T0 + 20 h. Entrenando a las T0 + 10 h: el contacto todavía no pasó.
    rows, st = run([imp()], [view()], contacts=[contact(ts=H(20))], as_of=H(10))
    assert rows == [] and st.pending == 1  # NO un negativo
    # A las T0 + 25 h (24 h de ventana + 1 h de gracia) la ventana cerró: es positivo
    rows, st = run([imp()], [view()], contacts=[contact(ts=H(20))], as_of=H(25))
    assert len(rows) == 1 and rows[0]["label_contact"] == 1


def test_window_closes_only_after_grace_period():
    rows, st = run([imp()], [view()], as_of=H(24.5))  # 24 h pasaron, pero el contacto puede llegar tarde
    assert st.pending == 1 and rows == []
    rows, _ = run([imp()], [view()], as_of=H(25))
    assert rows[0]["label_contact"] == 0  # ahora sí: negativo


def test_contact_after_24h_or_before_view_is_negative():
    rows, _ = run([imp()], [view()], contacts=[contact(ts=H(24.01))])
    assert rows[0]["label_contact"] == 0
    rows, _ = run([imp()], [view()], contacts=[contact(ts=H(-1))])  # contactó ANTES de ver la impresión
    assert rows[0]["label_contact"] == 0


# ---------------------------------------------------------------------------- qué es un ejemplo
def test_served_but_not_viewed_is_not_an_example():
    rows, st = run([imp(items=("A", "B", "C"))], [view("A")])
    assert [r["item_id"] for r in rows] == ["A"]
    assert st.served == 3 and st.not_viewed == 2


def test_fallback_paths_are_excluded():
    rows, st = run([imp(path="popular"), imp("r2", path="heuristic")], [view(), view(request_id="r2")])
    assert rows == [] and st.skipped_path == 2 and st.by_path == {"popular": 1, "heuristic": 1}


def test_features_come_from_the_snapshot_and_position_is_kept():
    rows, _ = run([imp(items=("A", "B"))], [view("A"), view("B")])
    b = next(r for r in rows if r["item_id"] == "B")
    assert b["item_features"] == [1.0, 0.03]  # lo que vio el ranker, no "lo de hoy"
    assert b["position"] == 2 and b["model_version"] == "ranker-2026-09-30"
    assert b["user_features"] == [0.1, 0.2] and b["feature_set_version"] == "fs-2026-09-28"


# ---------------------------------------------------------------------------- etiquetas
def test_click_label_same_request_within_session():
    rows, _ = run([imp(items=("A", "B"))], [view("A"), view("B")],
                  clicks=[click("A", ts=T0 + 120), click("B", ts=T0 + 31 * 60)])
    lab = {r["item_id"]: r["label_click"] for r in rows}
    assert lab == {"A": 1, "B": 0}  # el click en B fue a los 31 min: fuera de la sesión


def test_click_from_another_request_does_not_count():
    rows, _ = run([imp()], [view()], clicks=[click(request_id="otro", ts=T0 + 60)])
    assert rows[0]["label_click"] == 0


def test_duplicate_events_are_counted_once():
    rows, st = run([imp()], [view(), view()], clicks=[click(eid="c1"), click(eid="c1")],
                   contacts=[contact(eid="k1"), contact(eid="k1")])
    assert len(rows) == 1 and rows[0]["label_click"] == 1 and rows[0]["label_contact"] == 1
    assert st.duplicate_events == 3


def test_contact_goes_to_the_last_view_only():
    # Vio el ítem A en dos homes (T0 y T0 + 5 h) y contactó a las T0 + 6 h: un contacto, un positivo
    imps = [imp("r1", ts=T0 - 1), imp("r2", ts=H(5) - 1)]
    rows, st = run(imps, [view(request_id="r1", ts=T0), view(request_id="r2", ts=H(5))],
                   contacts=[contact(ts=H(6))], as_of=H(40))
    lab = {r["request_id"]: r["label_contact"] for r in rows}
    assert lab == {"r1": 0, "r2": 1} and st.positives_contact == 1


def test_first_view_counts_when_the_user_scrolls_back():
    rows, _ = run([imp()], [view(ts=T0), view(ts=T0 + 600)], clicks=[click(ts=T0 + 25 * 60)])
    assert rows[0]["view_ts"] == T0 and rows[0]["label_click"] == 1


def test_exploration_and_propensity_are_carried():
    rec = imp()
    rec["items"][0] |= {"exploration": True, "propensity": 0.05 / 950}
    rows, _ = run([rec], [view()])
    assert rows[0]["exploration"] is True and rows[0]["propensity"] == pytest.approx(0.05 / 950)


def test_stats_on_a_small_day():
    imps = [imp("r1", items=("A", "B", "C")), imp("r2", user="u2", items=("A", "D"), ts=H(30))]
    views = [view("A"), view("B"), view("A", "r2", ts=H(30)), view("D", "r2", ts=H(30))]
    rows, st = run(imps, views, clicks=[click("B")], contacts=[contact("B")], as_of=H(40))
    # r1: A y B maduros (C no visto); r2: vistos a las T0 + 30 h → pendientes hasta las T0 + 55 h
    assert st.examples == 2 and st.pending == 2 and st.not_viewed == 1
    assert st.positives_click == 1 and st.positives_contact == 1


# ---------------------------------------------------------------------------- censura y submuestreo
def sold(item="A", ts=H(2), eid=None):
    return {"event_id": eid or f"s-{item}-{ts}", "item_id": item, "ts": ts}


def test_item_sold_to_someone_else_censors_the_negative():
    rows, st = run([imp()], [view()], sold=[sold(ts=H(2))])
    assert rows[0]["label_contact"] == 0 and rows[0]["contact_censored"] == 1
    assert rows[0]["contact_window_s"] == 2 * 3600 and st.censored == 1


def test_contact_before_the_sale_is_a_positive_not_censored():
    rows, _ = run([imp()], [view()], contacts=[contact(ts=H(1))], sold=[sold(ts=H(2))])
    assert rows[0]["label_contact"] == 1 and rows[0]["contact_censored"] == 0


def test_sale_after_the_window_does_not_censor():
    rows, _ = run([imp()], [view()], sold=[sold(ts=H(30))])
    assert rows[0]["contact_censored"] == 0 and rows[0]["contact_window_s"] == 24 * 3600


def test_negative_subsampling_keeps_positives_and_exploration_and_reweights():
    items = [f"x{i}" for i in range(2000)]
    rec = imp(items=items)
    rec["items"][5]["exploration"] = True  # x5: exploración, sin interacción
    views = [view(it) for it in items]
    rows, st = run([rec], views, clicks=[click("x7")], contacts=[contact("x8")], neg_sample_rate=0.1)
    by = {r["item_id"]: r for r in rows}
    assert by["x7"]["weight"] == 1.0 and by["x8"]["weight"] == 1.0  # positivos: todos, peso 1
    assert by["x5"]["weight"] == 1.0  # exploración: no se submuestrea
    negs = [r for r in rows if not (r["label_click"] or r["label_contact"] or r["exploration"])]
    assert all(r["weight"] == pytest.approx(10.0) for r in negs)
    assert 150 < len(negs) < 250  # ≈ 10 % de 1,997 negativos
    assert st.negatives_dropped == 1997 - len(negs)
    # Determinista: el mismo día da el mismo set
    rows2, _ = run([rec], views, clicks=[click("x7")], contacts=[contact("x8")], neg_sample_rate=0.1)
    assert [r["item_id"] for r in rows2] == [r["item_id"] for r in rows]
