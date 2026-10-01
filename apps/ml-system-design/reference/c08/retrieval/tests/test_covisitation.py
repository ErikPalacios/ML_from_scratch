"""Tests de la co-visitación con sesiones chicas que se pueden calcular a mano."""

import math

import pytest

import covisitation as cv

NOW = 1_790_000_000.0
NO_DECAY = cv.CovisConfig(half_life_days=1e9, min_sessions=1)


def sess(sid, items, t0=NOW - 600, step=60):
    """Una sesión: los ítems en orden, uno por minuto (dentro de la ventana de 1 h)."""
    return [cv.View(sid, it, t0 + i * step) for i, it in enumerate(items)]


def docstring_example():
    views = sess("s1", ["A", "B", "C"]) + sess("s2", ["A", "B"]) + sess("s3", ["A", "iphone"])
    for k in range(4, 101):
        views += sess(f"s{k}", ["iphone"])
    return views


def test_docstring_example_cosine():
    t = dict((b, s) for b, s in cv.build_covisitation(docstring_example(), NOW, NO_DECAY)["A"])
    assert t["B"] == pytest.approx(2 / math.sqrt(3 * 2), abs=1e-6)  # 0.816
    assert t["C"] == pytest.approx(1 / math.sqrt(3 * 1), abs=1e-6)  # 0.577
    assert t["iphone"] == pytest.approx(1 / math.sqrt(3 * 98), abs=1e-6)  # 0.058: lo popular no se cuela


def test_beta_zero_is_conditional_probability_and_lets_popular_items_in():
    cfg = cv.CovisConfig(half_life_days=1e9, min_sessions=1, beta=0.0)
    t = dict(cv.build_covisitation(docstring_example(), NOW, cfg)["A"])
    assert t["B"] == pytest.approx(2 / 3, abs=1e-6)
    assert t["iphone"] == pytest.approx(t["C"])  # empata con las botas: por eso beta > 0


def test_pair_counts_once_per_session():
    # Misma sesión, A y B alternados 10 veces: cuenta como 1 sesión, igual que verlos una vez
    loop = sess("s1", ["A", "B"] * 10)
    once = sess("s1", ["A", "B"])
    assert cv.build_covisitation(loop, NOW, NO_DECAY) == cv.build_covisitation(once, NOW, NO_DECAY)


def test_window_boundaries():
    views = [cv.View("s1", "A", NOW - 7200), cv.View("s1", "B", NOW - 3601), cv.View("s1", "C", NOW)]
    t = cv.build_covisitation(views, NOW, NO_DECAY)
    assert [b for b, _ in t["A"]] == ["B"]  # 3,599 s: dentro
    assert [b for b, _ in t["B"]] == ["A"]  # B–C a 3,601 s: fuera
    assert "C" not in t


def test_decay_halves_weight_every_half_life():
    cfg = cv.CovisConfig(half_life_days=7, min_sessions=1, beta=0.0)
    old = sess("s1", ["A", "B"], t0=NOW - 7 * 86400)  # hace exactamente una vida media
    new = sess("s2", ["A", "C"], t0=NOW - 60)
    t = dict(cv.build_covisitation(old + new, NOW, cfg)["A"])
    assert t["B"] / t["C"] == pytest.approx(0.5, rel=1e-3)


def test_min_support_drops_one_off_pairs():
    views = sess("s1", ["A", "B"]) + sess("s2", ["A", "B"]) + sess("s3", ["A", "Z"])
    t = cv.build_covisitation(views, NOW, cv.CovisConfig(half_life_days=1e9))  # min_sessions = 2
    assert [b for b, _ in t["A"]] == ["B"]


def test_long_sessions_are_capped_to_the_last_views():
    bot = sess("bot", [f"x{i}" for i in range(500)], t0=NOW - 3000, step=1)
    cfg = cv.CovisConfig(half_life_days=1e9, min_sessions=1, max_session_len=50)
    t = cv.build_covisitation(bot, NOW, cfg)
    assert len(t) == 50 and "x0" not in t and "x499" in t  # 50 × 49 / 2 pares, no 124,750


def test_top_k_and_deterministic_order():
    views = []
    for k in range(5):
        views += sess(f"s{k}", ["A", f"n{k}"])
    t = cv.build_covisitation(views, NOW, cv.CovisConfig(half_life_days=1e9, min_sessions=1, top_k=3))
    assert [b for b, _ in t["A"]] == ["n0", "n1", "n2"]  # empate en score → orden por id


def test_candidates_from_history_weights_recent_views_and_skips_seen():
    table = {"A": [("B", 0.8), ("C", 0.5)], "D": [("C", 0.9), ("A", 0.4)]}
    recent = [("A", NOW - 60), ("D", NOW - 24 * 3600)]  # D hace un día: pesa la mitad
    out = dict(cv.candidates_from_history(table, recent, NOW))
    assert "A" not in out and "D" not in out  # ya los vio
    assert out["B"] == pytest.approx(0.8 * 0.5 ** (60 / 86400), abs=1e-5)
    assert out["C"] == pytest.approx(0.5 * 0.5 ** (60 / 86400) + 0.9 * 0.5, abs=1e-5)
