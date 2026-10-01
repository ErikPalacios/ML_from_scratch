"""Tests del re-ranker: topes de diversidad, freshness, vendedor nuevo y exploración determinista."""

from collections import Counter

import pytest

import rerank as rr


def cand(i, score, cat="c0", seller=None, age_h=1000.0, new=False, source="two_tower"):
    return rr.Scored(f"i{i}", score, cat, seller or f"s{i}", age_h, new, source)


NO_EXPLORE = rr.RerankConfig(explore=False, new_seller_min_top_k=0)


def test_freshness_multiplier_halves_every_24h():
    cfg = rr.RerankConfig()
    assert rr.freshness_multiplier(0, cfg) == pytest.approx(1.15)
    assert rr.freshness_multiplier(24, cfg) == pytest.approx(1.075)
    assert rr.freshness_multiplier(48, cfg) == pytest.approx(1.0375)
    assert rr.freshness_multiplier(-5, cfg) == pytest.approx(1.15)  # reloj desfasado: edad 0


def test_fresh_item_overtakes_slightly_better_old_one_but_not_a_much_better_one():
    old_good = cand(1, 0.100)
    fresh = cand(2, 0.090, age_h=0)  # 0.090 × 1.15 = 0.1035 > 0.100
    old_great = cand(3, 0.200)
    page = rr.rerank([old_good, fresh, old_great], "r", NO_EXPLORE)
    assert [s.item_id for s in page] == ["i3", "i2", "i1"]
    assert "freshness" in page[1].reasons and page[1].score == 0.090  # se loguea el score SIN ajustar


def test_category_cap_in_first_screen():
    # 20 ítems de la misma categoría con los mejores scores y 20 de otras categorías, peores
    same = [cand(i, 1.0 - i * 0.01, cat="chamarras") for i in range(20)]
    other = [cand(100 + i, 0.5 - i * 0.01, cat=f"c{i}") for i in range(20)]
    page = rr.rerank(same + other, "r", NO_EXPLORE)
    top10 = Counter(by_cat(page[:10], same + other))
    assert top10["chamarras"] == 3  # ≤ 3 por categoría en la primera pantalla
    assert [s.item_id for s in page[:3]] == ["i0", "i1", "i2"]  # los 3 mejores siguen arriba
    # Fuera de la primera pantalla el tope de categoría no aplica: vuelven en orden de score
    assert page[10].item_id == "i3"


def by_cat(slots, cands):
    cat = {c.item_id: c.category for c in cands}
    return [cat[s.item_id] for s in slots]


def test_seller_caps_first_screen_and_page():
    one_seller = [cand(i, 1.0 - i * 0.001, cat=f"c{i}", seller="big") for i in range(30)]
    others = [cand(100 + i, 0.5 - i * 0.001, cat=f"d{i}") for i in range(60)]
    page = rr.rerank(one_seller + others, "r", NO_EXPLORE)
    sellers = {c.item_id: c.seller_id for c in one_seller + others}
    assert sum(sellers[s.item_id] == "big" for s in page[:10]) == 1
    assert sum(sellers[s.item_id] == "big" for s in page) == 3
    assert len(page) == 50


def test_caps_relax_instead_of_returning_a_short_page():
    # Ciudad chica: 12 ítems, todos del mismo vendedor
    cands = [cand(i, 1.0 - i * 0.01, seller="solo") for i in range(12)]
    page = rr.rerank(cands, "r", NO_EXPLORE)
    assert len(page) == 12
    assert "cap_relaxed" in page[3].reasons


def test_new_seller_gets_a_first_screen_slot():
    cands = [cand(i, 1.0 - i * 0.01, cat=f"c{i}") for i in range(30)]
    cands.append(cand(99, 0.05, cat="x", new=True))  # vendedor nuevo, score bajo (sin historial)
    cfg = rr.RerankConfig(explore=False)
    page = rr.rerank(cands, "r", cfg)
    assert page[9].item_id == "i99" and "new_seller" in page[9].reasons  # posición 10: visible, no la 1
    assert [s.item_id for s in page[:9]] == [f"i{i}" for i in range(9)]


def test_new_seller_rule_does_nothing_when_one_is_already_on_top():
    cands = [cand(0, 1.0, new=True)] + [cand(i, 0.9 - i * 0.01, cat=f"c{i}") for i in range(1, 30)]
    page = rr.rerank(cands, "r", rr.RerankConfig(explore=False))
    assert page[0].item_id == "i0" and not any("new_seller" in s.reasons for s in page)


def test_exploration_rate_and_propensity():
    cands = [cand(i, 1.0 - i * 1e-4, cat=f"c{i % 50}") for i in range(1000)]
    cfg = rr.RerankConfig(new_seller_min_top_k=0)
    explored, total = 0, 0
    for k in range(200):
        page = rr.rerank(cands, f"req-{k}", cfg)
        assert len(page) == 50 and len({s.item_id for s in page}) == 50
        for s in page:
            total += 1
            if s.exploration:
                explored += 1
                # uniforme sobre el pool: 1,000 − 50 en la página (± los ya explorados)
                assert s.propensity == pytest.approx(0.05 / 950, rel=0.01)
                assert s.reasons == ["exploration"]
    assert 0.04 < explored / total < 0.06  # 10,000 posiciones, ε = 5 %


def test_exploration_is_deterministic_per_request_id():
    cands = [cand(i, 1.0 - i * 1e-3, cat=f"c{i % 50}") for i in range(500)]
    a = rr.rerank(cands, "req-42", rr.RerankConfig())
    b = rr.rerank(cands, "req-42", rr.RerankConfig())
    c = rr.rerank(cands, "req-43", rr.RerankConfig())
    assert [(s.item_id, s.exploration) for s in a] == [(s.item_id, s.exploration) for s in b]
    assert [s.item_id for s in a] != [s.item_id for s in c]


def test_exploration_inserts_and_pushes_only_the_last_out():
    cands = [cand(i, 1.0 - i * 1e-3, cat=f"c{i % 50}") for i in range(500)]
    base = [s.item_id for s in rr.rerank(cands, "x", rr.RerankConfig(explore=False, new_seller_min_top_k=0))]
    for k in range(30):
        page = rr.rerank(cands, f"q{k}", rr.RerankConfig(new_seller_min_top_k=0))
        ranked = [s.item_id for s in page if not s.exploration]
        n_exp = len(page) - len(ranked)
        assert ranked == base[: 50 - n_exp]  # mismo orden relativo: nada se reemplazó


def test_seed_is_stable_across_processes():
    # sha256, no hash(): este valor no cambia entre procesos ni versiones de Python
    assert rr.seed_from_request("req-1") == int.from_bytes(
        __import__("hashlib").sha256(b"req-1").digest()[:8], "big")


def test_empty_input():
    assert rr.rerank([], "r") == []
