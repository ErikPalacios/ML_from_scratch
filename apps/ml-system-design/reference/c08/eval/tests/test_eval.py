"""Tests de eval/: tamaño de muestra contra un cálculo a mano y métricas offline con ejemplos chicos."""

import math
import random

import pytest

import ab_sample_size as ab
import offline_metrics as om


# ---------------------------------------------------------------------------- tamaño de muestra
def test_users_per_arm_matches_hand_computation():
    # A mano: z = 1.959964 + 0.841621 = 2.801585; z² = 7.848880
    # n = 2 × 7.848880 × 2.0² / (0.01 × 0.6)² = 62.79104 / 0.000036 = 1,744,195.5 → 1,744,196
    assert ab.users_per_arm(0.6, 2.0, 0.01) == 1_744_196


def test_halving_the_lift_needs_four_times_the_users():
    n1 = ab.users_per_arm(0.6, 2.0, 0.02)
    n2 = ab.users_per_arm(0.6, 2.0, 0.01)
    assert n2 / n1 == pytest.approx(4, rel=1e-4)


def test_cuped_reduces_variance_by_one_minus_rho_squared():
    base = ab.users_per_arm(0.6, 2.0, 0.01)
    with_cuped = ab.users_per_arm(0.6, 2.0, 0.01, cuped_rho=0.5)
    assert with_cuped / base == pytest.approx(0.75, rel=1e-4)


def test_mde_is_the_inverse():
    n = ab.users_per_arm(0.6, 2.0, 0.01)
    assert ab.mde(0.6, 2.0, n) == pytest.approx(0.01, rel=1e-4)


def test_formula_by_simulation():
    """Con n por brazo y un efecto real de +δ, la potencia empírica ≈ 80 %."""
    rng = random.Random(3)
    mean, sd, lift = 1.0, 1.0, 0.10
    n = ab.users_per_arm(mean, sd, lift)  # 1,570 por brazo
    z_crit, hits, trials = 1.959964, 0, 400
    for _ in range(trials):
        a = [rng.gauss(mean, sd) for _ in range(n)]
        b = [rng.gauss(mean * (1 + lift), sd) for _ in range(n)]
        ma, mb = sum(a) / n, sum(b) / n
        va = sum((x - ma) ** 2 for x in a) / (n - 1)
        vb = sum((x - mb) ** 2 for x in b) / (n - 1)
        hits += abs(mb - ma) / math.sqrt(va / n + vb / n) > z_crit
    assert 0.73 < hits / trials < 0.87


def test_delta_method_for_contacts_per_active_day():
    # Y = contactos del usuario, X = días activos: R = 0.6 / 6 = 0.1 contactos por día activo
    r, sd = ab.delta_method_sd(mean_x=6.0, mean_y=0.6, var_x=16.0, var_y=4.0, cov_xy=2.0)
    assert r == pytest.approx(0.1)
    # σ_y² − 2R σ_xy + R² σ_x² = 4 − 0.4 + 0.16 = 3.76 → sd efectiva = sqrt(3.76) / 6 = 0.3232
    assert sd == pytest.approx(math.sqrt(3.76) / 6, rel=1e-9)


def test_days_needed_counts_distinct_users_and_rounds_to_weeks():
    # Usuarios distintos acumulados (ilustrativo): casi todos vuelven, la curva se aplana
    cum = [30_000_000, 38_000_000, 43_000_000, 46_000_000, 48_000_000, 49_500_000, 51_000_000,
           52_000_000, 53_000_000, 53_800_000, 54_500_000, 55_100_000, 55_600_000, 56_000_000]
    n = 1_744_196
    assert ab.days_needed(n, cum, share_per_arm=0.04) == 7  # 0.04 × 46 M = 1.84 M el día 4 → semana completa
    assert ab.days_needed(n, cum, share_per_arm=0.033) == 14  # 0.033 × 53 M = 1.749 M el día 9 → 2 semanas
    assert ab.days_needed(n, cum, share_per_arm=0.02) is None  # con 2 % no alcanza en 14 días (1.12 M)
    assert ab.share_needed(n, cum[-1]) == pytest.approx(0.031146, abs=1e-6)


def test_invalid_inputs():
    with pytest.raises(ValueError):
        ab.users_per_arm(0, 1, 0.01)
    with pytest.raises(ValueError):
        ab.users_per_arm(1, 1, 0.01, cuped_rho=1.0)


# ---------------------------------------------------------------------------- métricas offline
def test_recall_at_k():
    assert om.recall_at_k(["a", "b", "c", "d"], {"b", "d", "z"}, k=2) == pytest.approx(1 / 3)
    assert om.recall_at_k(["a", "b", "c", "d"], {"b", "d", "z"}, k=4) == pytest.approx(2 / 3)
    assert om.recall_at_k(["a"], set(), k=10) is None  # indefinido, no 0


def test_ndcg_docstring_example():
    grades = {"contacto": 2, "click": 1, "nada": 0}
    v = om.ndcg_at_k(["contacto", "nada", "click"], grades, k=3)
    assert v == pytest.approx(3.5 / (3 + 1 / math.log2(3)), abs=1e-9)  # 0.964
    assert om.ndcg_at_k(["contacto", "click", "nada"], grades, k=3) == pytest.approx(1.0)


def test_ndcg_case_example_contact_in_position_2():
    # El ejemplo de la sección de evaluación del caso: [nada, contacto, click, nada, nada]
    grades = {"p2": 2, "p3": 1}
    v = om.ndcg_at_k(["p1", "p2", "p3", "p4", "p5"], grades, k=5)
    assert v == pytest.approx((3 / math.log2(3) + 1 / math.log2(4)) / (3 + 1 / math.log2(3)))  # 2.39 / 3.63
    assert round(v, 2) == 0.66


def test_ndcg_ideal_uses_all_labeled_items_not_just_the_top_k():
    # El modelo dejó el contacto fuera del top-2: no puede salir perfecto
    grades = {"x": 2, "a": 1}
    assert om.ndcg_at_k(["a", "b", "x"], grades, k=2) == pytest.approx(1 / (3 + 1 / math.log2(3)))
    assert om.ndcg_at_k(["a", "b"], {"a": 0}, k=2) is None


def test_auc_simple_and_with_ties():
    assert om.auc([0.9, 0.8, 0.3, 0.1], [1, 1, 0, 0]) == 1.0
    assert om.auc([0.1, 0.3, 0.8, 0.9], [1, 1, 0, 0]) == 0.0
    # 1 positivo (0.5) vs 2 negativos (0.5 y 0.2): gana a uno, empata con otro → (1 + 0.5) / 2
    assert om.auc([0.5, 0.5, 0.2], [1, 0, 0]) == pytest.approx(0.75)
    assert om.auc([0.4] * 6, [1, 0, 1, 0, 0, 1]) == pytest.approx(0.5)  # todo empatado = azar
    assert om.auc([0.1, 0.2], [0, 0]) is None


def test_auc_matches_pairwise_count():
    rng = random.Random(5)
    s = [round(rng.random(), 2) for _ in range(300)]  # redondeo: fuerza empates
    y = [int(rng.random() < 0.3) for _ in range(300)]
    pos = [a for a, l in zip(s, y) if l]
    neg = [a for a, l in zip(s, y) if not l]
    pairs = sum((p > n) + 0.5 * (p == n) for p in pos for n in neg) / (len(pos) * len(neg))
    assert om.auc(s, y) == pytest.approx(pairs, abs=1e-12)


def test_users_without_positives_are_excluded_and_counted():
    rows = [
        {"seg": "nuevo", "ranked": ["a", "b"], "rel": {"a"}},
        {"seg": "nuevo", "ranked": ["a", "b"], "rel": set()},  # no contactó nada: indefinido
        {"seg": "recurrente", "ranked": ["a", "b"], "rel": {"b"}},
    ]
    out = om.by_slice(rows, lambda r: r["seg"], lambda r: om.recall_at_k(r["ranked"], r["rel"], k=1))
    assert out == {"nuevo": (1.0, 1, 1), "recurrente": (0.0, 1, 0)}
