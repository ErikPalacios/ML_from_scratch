"""Tests del runner de golden sets: extracción calculada a mano, juez falso con sesgos programados, Wilson y gates."""

import pytest  # runner

from golden_eval import (
    GateThresholds,
    PairwiseReport,
    cohens_kappa,
    evaluate_extraction,
    gate_extraction,
    gate_pairwise,
    judge_pairwise,
    normalize_value,
    wilson_interval,
)


# ------------------------------------------------------------------ extracción
def test_docstring_example_by_hand():
    rep = evaluate_extraction([({"marca": "Nike", "talla": "27", "color": "negro"},
                                '{"marca": "nike ", "talla": "27.5", "material": "piel"}')])
    assert (rep.tp, rep.fp, rep.fn) == (1, 2, 2)  # marca TP; talla FP+FN; color FN; material FP
    assert rep.precision == pytest.approx(1 / 3) and rep.recall == pytest.approx(1 / 3)
    assert rep.json_validity == 1.0 and rep.exact_match == 0


def test_invalid_json_counts_all_gold_as_missed():
    rep = evaluate_extraction([({"marca": "Nike", "talla": "27"}, "Claro, aquí está el JSON: {marca: Nike}")])
    assert rep.json_validity == 0.0 and (rep.tp, rep.fp, rep.fn) == (0, 0, 2)


def test_normalization_numbers_case_unicode_and_nulls():
    assert normalize_value("27") == normalize_value(27) == normalize_value(" 27.0 ")
    assert normalize_value("1,200") == 1200.0
    assert normalize_value("Algodón") == normalize_value("algodón")  # NFC: ó compuesta = o + acento
    rep = evaluate_extraction([({"marca": "Adidas", "color": None}, '{"marca": "ADIDAS", "color": null}')])
    assert rep.exact_match == 1 and rep.f1 == 1.0  # null en ambos = no aplica, no es un error


def test_per_field_f1_and_list_values():
    pairs = [
        ({"marca": "A", "tallas": ["S", "M"]}, '{"marca": "A", "tallas": ["m", "s"]}'),
        ({"marca": "B"}, '{"marca": "C"}'),
    ]
    rep = evaluate_extraction(pairs)
    assert rep.field_f1("tallas") == 1.0  # listas como conjuntos, sin importar orden ni mayúsculas
    assert rep.field_f1("marca") == pytest.approx(2 * 1 / (2 * 1 + 1 + 1))  # 1 TP, 1 FP, 1 FN


def test_extraction_gate():
    good = evaluate_extraction([({"a": 1}, '{"a": 1}')] * 99 + [({"a": 1}, "no json")])
    res = gate_extraction(good, GateThresholds(), baseline_f1=0.995)
    assert res.passed, res.reasons  # 99 % de JSON válido y F1 ≈ 0.995
    bad = evaluate_extraction([({"a": 1}, '{"a": 1}')] * 97 + [({"a": 1}, "x")] * 3)
    res = gate_extraction(bad, GateThresholds(), baseline_f1=0.995)
    assert not res.passed
    assert any("JSON válido" in r for r in res.reasons) and any("F1 cae" in r for r in res.reasons)


# ------------------------------------------------------------------ juez pareado
class FirstSlotJudge:
    """Juez con sesgo de posición puro: siempre prefiere la primera respuesta."""

    def compare(self, prompt, first, second):
        return "first"

    def score(self, prompt, answer):
        return 3.0


class LengthJudge:
    """Juez que prefiere la respuesta más larga (sesgo de verbosidad), sin sesgo de posición."""

    def compare(self, prompt, first, second):
        return "first" if len(first) > len(second) else "second" if len(second) > len(first) else "tie"

    def score(self, prompt, answer):
        return min(5.0, len(answer) / 10)


def test_position_swap_neutralizes_position_bias():
    rep = judge_pairwise(FirstSlotJudge(), [("p", "corta", "una respuesta más larga")] * 10)
    # Sin el cambio de orden, el candidato "ganaría" 10 de 10 por estar primero
    assert (rep.wins, rep.losses, rep.ties) == (0, 0, 10)
    assert rep.win_rate == 0.5 and rep.position_consistency == 0.0
    res = gate_pairwise(rep, GateThresholds(min_pairs=1), judge_kappa=0.8)
    assert not res.passed and any("consistencia de posición" in r for r in res.reasons)


def test_verbosity_bias_is_not_fixed_by_swapping():
    # El cambio de posición NO arregla la verbosidad: el juez es consistente y aun así premia lo largo
    rep = judge_pairwise(LengthJudge(), [("p", "respuesta larguísima y con relleno", "corta")] * 10)
    assert rep.wins == 10 and rep.position_consistency == 1.0  # por eso la rúbrica y la calibración humana


def test_wilson_examples_from_docstring():
    assert [round(x, 3) for x in wilson_interval(500, 1000)] == [0.469, 0.531]
    assert [round(x, 3) for x in wilson_interval(50, 100)] == [0.404, 0.596]
    assert [round(x, 3) for x in wilson_interval(480, 1000)] == [0.449, 0.511]
    assert wilson_interval(0, 0) == (0.0, 1.0)


def test_pairwise_gate_non_inferiority():
    t = GateThresholds()
    ok = PairwiseReport(pairs=1000, wins=420, losses=420, ties=160)  # win rate 0.50
    assert gate_pairwise(ok, t, judge_kappa=0.7).passed
    small = PairwiseReport(pairs=100, wins=42, losses=42, ties=16)  # el mismo 0.50 con 100 pares
    res = gate_pairwise(small, t, judge_kappa=0.7)
    assert not res.passed and any("solo 100 pares" in r for r in res.reasons) and any("borde inferior" in r for r in res.reasons)
    assert not gate_pairwise(ok, t, judge_kappa=0.4).passed  # juez sin calibrar: no se decide con él


def test_cohens_kappa():
    human = ["cand", "ref", "tie", "cand", "ref", "cand"]
    assert cohens_kappa(human, human) == 1.0
    judge = ["cand", "ref", "cand", "cand", "ref", "ref"]  # 4 de 6 de acuerdo
    # po = 4/6; pe = (3/6·3/6) + (2/6·3/6) + (1/6·0) = 15/36 → κ = (24/36 − 15/36) ÷ (21/36) = 9/21
    assert cohens_kappa(human, judge) == pytest.approx(9 / 21)
    with pytest.raises(ValueError):
        cohens_kappa([], [])
