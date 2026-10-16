"""Tests de auction.py con ejemplos calculados a mano (reserva US$0.80 de eCPM, incremento US$0.01)."""

import random
from collections import Counter

import pytest

import auction as A

SLOTS = ("top", "in_article", "bottom")
FACTOR = {"top": 1.0, "in_article": 0.8, "bottom": 0.5}  # efecto de posición de los ejemplos (ilustrativo)


def bid(ad, adv, cpc, ctr_top, boost=1.0):
    """pCTR separable: calidad × efecto de posición (como asumen EOS 2007 y Varian 2007)."""
    return A.Bid(ad, "c-" + ad, adv, cpc, {s: ctr_top * f for s, f in FACTOR.items()}, boost)


def test_docstring_example_one_slot():
    bids = [bid("A", "vA", 0.50, 0.006), bid("B", "vB", 1.20, 0.002), bid("C", "vC", 0.10, 0.004)]
    [p] = A.run_auction(bids, ["top"], seed="r1")
    # eCPM: A = 3.00, B = 2.40, C = 0.40 (no pasa la reserva). A paga 2.40 / (1000 × 0.006) + 0.01
    assert (p.ad_id, p.ecpm, p.price, p.price_source, p.runner_up) == ("A", 3.0, 0.41, "next_ad", "B")
    # El publisher espera 0.41 × 6 clicks por 1,000 impresiones = US$2.46 ≈ el eCPM del segundo
    assert round(p.price * p.pctr * 1000, 2) == 2.46


def test_three_slots_reserve_and_programmatic():
    bids = [bid("A", "vA", 0.50, 0.006), bid("B", "vB", 1.20, 0.002), bid("C", "vC", 0.10, 0.004)]
    out = {p.slot: p for p in A.run_auction(bids, SLOTS, seed="r1")}
    assert out["top"].ad_id == "A" and out["top"].price == 0.41
    # in_article: B solo (A ya tiene slot; C = 0.10 × 0.0032 × 1000 = 0.32 < 0.80). Sin siguiente → reserva:
    # 0.80 / (1000 × 0.0016) + 0.01 = 0.50 + 0.01 = 0.51. B ofrecía 1.20 por click y paga 0.51
    assert (out["in_article"].ad_id, out["in_article"].price, out["in_article"].price_source) == ("B", 0.51, "reserve")
    assert "bottom" not in out  # nadie vale la reserva: el slot va al programático


def test_price_is_capped_at_the_bid():
    # D: 0.30 × 1 % → eCPM 3.00; E: 0.2999 × 1 % → 2.999. Sin tope: 2.999 / 10 + 0.01 = 0.3099 > 0.30
    [p] = A.run_auction([bid("D", "vD", 0.30, 0.01), bid("E", "vE", 0.2999, 0.01)], ["top"], seed="x")
    assert (p.ad_id, p.price) == ("D", 0.30)


def test_one_ad_per_advertiser_and_its_second_ad_never_sets_its_price():
    bids = [bid("X1", "vX", 1.00, 0.003),  # eCPM 3.0
            bid("X2", "vX", 0.97, 0.003),  # eCPM 2.91: mismo anunciante
            bid("Y1", "vY", 1.00, 0.002)]  # eCPM 2.0
    out = {p.slot: p for p in A.run_auction(bids, SLOTS, seed="s")}
    assert out["top"].ad_id == "X1" and out["top"].runner_up == "Y1"
    # Precio contra Y1 (2.0 / 3 + 0.01 = 0.676667), no contra X2 (2.91 / 3 + 0.01 = 0.98: pagaría contra sí mismo)
    assert out["top"].price == pytest.approx(2.0 / 3 + 0.01, abs=1e-6)
    assert out["in_article"].ad_id == "Y1"  # X2 no aparece: un anuncio por anunciante en la página
    assert all(p.ad_id != "X2" for p in out.values())


def test_ties_are_deterministic_per_request_and_fair_across_requests():
    bids = [bid("T1", "v1", 0.50, 0.004), bid("T2", "v2", 0.50, 0.004)]  # eCPM idéntico
    assert A.run_auction(bids, ["top"], seed="r-7")[0].ad_id == A.run_auction(bids, ["top"], seed="r-7")[0].ad_id
    wins = Counter(A.run_auction(bids, ["top"], seed=f"r-{i}")[0].ad_id for i in range(2000))
    assert 0.45 < wins["T1"] / 2000 < 0.55  # ordenar por ad_id le daría el 100 % a T1


def test_separable_ctr_matches_varian_prices():
    """Con pCTR = calidad × posición, greedy por slot = ordenar una vez por bid × calidad, y cada uno paga
    b_siguiente × e_siguiente / e_propio + 0.01 (Varian 2007, ec. 20), con tope y piso de reserva."""
    rng = random.Random(3)
    for trial in range(300):
        bids = [bid(f"a{i}", f"v{i}", round(rng.uniform(0.05, 1.5), 2), rng.uniform(0.001, 0.015))
                for i in range(rng.randint(2, 8))]
        out = A.run_auction(bids, SLOTS, seed=str(trial))
        order = sorted(bids, key=lambda b: (-b.bid * b.pctr["top"], A._tie_key(str(trial), b.ad_id)))
        for k, p in enumerate(out):
            assert p.slot == SLOTS[k] and p.ad_id == order[k].ad_id
            e_w = order[k].pctr[p.slot]
            nxt = order[k + 1] if k + 1 < len(order) else None
            floor = 0.80 / (1000 * e_w)
            if nxt is not None and nxt.bid * nxt.pctr[p.slot] * 1000 >= 0.80:
                floor = max(floor, nxt.bid * nxt.pctr[p.slot] / e_w)  # b_(s+1) × e_(s+1) / e_s
            assert p.price == pytest.approx(min(order[k].bid, floor + 0.01), abs=1e-6)
            assert p.price <= p.bid + 1e-12  # nunca más que el bid


def test_new_ad_boost_is_paid_by_the_publisher():
    new = bid("N", "vN", 0.52, 0.005, boost=1.2)  # eCPM real 2.60; puntuación 3.12
    old = bid("O", "vO", 0.50, 0.006)  # eCPM 3.00
    [p] = A.run_auction([new, old], ["top"], seed="b")
    assert p.ad_id == "N"
    # Precio = 3.00 / (1000 × 0.005 × 1.2) + 0.01 = 0.50 + 0.01 = 0.51. Sin boost necesitaría 0.60 + 0.01
    # para ganarle a O: el boost lo subsidia el publisher, el anunciante nuevo paga MENOS, nunca más
    assert p.price == pytest.approx(0.51, abs=1e-6) and p.ecpm == 2.6


def test_a_boosted_runner_up_never_raises_the_winners_price():
    winner = bid("W", "vW", 0.50, 0.0064)  # eCPM 3.20, sin boost
    boosted = bid("N", "vN", 0.52, 0.005, boost=1.2)  # eCPM real 2.60, puntuación 3.12
    [p] = A.run_auction([winner, boosted], ["top"], seed="b2")
    assert p.ad_id == "W" and p.runner_up == "N"
    # Contra el eCPM REAL de N: 2.60 / 6.4 + 0.01 = 0.41625 → 0.41625 (no 3.12 / 6.4 + 0.01 = 0.4975)
    assert p.price == pytest.approx(2.60 / 6.4 + 0.01, abs=1e-6)


def test_boosts_never_make_anyone_pay_more():
    rng = random.Random(9)
    for trial in range(300):
        base = [bid(f"a{i}", f"v{i}", round(rng.uniform(0.05, 1.5), 2), rng.uniform(0.001, 0.015))
                for i in range(rng.randint(2, 7))]
        boosted = [A.Bid(b.ad_id, b.campaign_id, b.advertiser_id, b.bid, b.pctr, rng.choice([1.0, 1.2]))
                   for b in base]
        plain = {p.ad_id: p.price for p in A.run_auction(base, ["top"], seed=str(trial))}
        for p in A.run_auction(boosted, ["top"], seed=str(trial)):
            if p.ad_id in plain:  # el mismo ganador, con y sin boosts en la subasta
                assert p.price <= plain[p.ad_id] + 1e-9


def test_boost_never_lets_an_ad_below_the_reserve_in():
    # eCPM real 0.75 (< 0.80): con boost 1.2 su puntuación es 0.90, pero la reserva mira el eCPM REAL
    assert A.run_auction([bid("N", "vN", 0.25, 0.003, boost=1.2)], ["top"], seed="z") == []


def test_exploration_is_uniform_priced_at_reserve_and_one_per_advertiser():
    bids = [bid("A", "vA", 0.50, 0.006), bid("B", "vB", 1.20, 0.002), bid("C", "vC", 1.00, 0.003),
            bid("C2", "vC", 1.00, 0.003), bid("L", "vL", 0.10, 0.004)]  # L no pasa la reserva en ningún slot
    firsts = Counter()
    for i in range(3000):
        out = A.run_exploration(bids, SLOTS, seed=f"e{i}")
        assert len({p.advertiser_id for p in out}) == len(out)  # un anuncio por anunciante
        top = out[0]
        assert top.slot == "top" and top.explored and top.propensity == pytest.approx(1 / 4)  # A, B, C, C2
        assert top.price == pytest.approx(min(top.bid, 0.80 / (1000 * top.pctr) + 0.01), abs=1e-6)
        firsts[top.ad_id] += 1
    assert "L" not in firsts
    assert all(0.21 < firsts[a] / 3000 < 0.29 for a in ("A", "B", "C", "C2"))  # ≈ 1/4 cada uno
    assert A.run_exploration(bids, SLOTS, seed="e1") == A.run_exploration(bids, SLOTS, seed="e1")  # re-jugable


def test_logged_propensity_is_conditional_and_the_marginal_is_one_over_eligible():
    # 3 anuncios de 3 anunciantes, los 3 sobre la reserva en los 3 slots (eCPM 10, 8 y 5)
    bids = [bid(x, "v" + x, 1.0, 0.01) for x in "ABC"]
    seen = Counter()
    for i in range(6000):
        out = A.run_exploration(bids, SLOTS, seed=f"m{i}")
        # Lo logueado es condicional: 1/3 arriba, 1/2 con uno ya colocado, 1 con dos colocados
        assert [round(p.propensity, 3) for p in out] == [0.333, 0.5, 1.0]
        assert all(p.eligible == 3 for p in out)
        seen.update((p.ad_id, p.slot) for p in out)
    # La marginal (la que pide IPS por slot) es 1/3 en los TRES slots = 1/eligible: cada orden es igual de
    # probable. Pesar el slot de abajo con 1/propensity = 1 en vez de 3 subestima 3 veces su ingreso
    assert all(0.30 < seen[(a, s)] / 6000 < 0.37 for a in "ABC" for s in SLOTS)


def test_nothing_above_reserve_means_no_placements():
    assert A.run_auction([bid("L", "vL", 0.05, 0.002)], SLOTS, seed="q") == []  # eCPM 0.10
