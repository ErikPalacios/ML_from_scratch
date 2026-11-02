"""Tests de choose_threshold.py con datos chicos calculables a mano (caso c03).

Correr (desde tools/):  pip install pytest==9.1.1 && pytest -q tests
Solo biblioteca estándar + pytest; uno de los tests importa decision.py del inspector para probar
que la herramienta y el runtime usan el MISMO criterio (score >= umbral).
"""

import csv  # CSVs de validación de prueba
import json  # salida --json
import math  # la CDF binomial para verificar la cota
import sys  # importar la herramienta y decision.py
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent  # tools/tests
sys.path.insert(0, str(HERE.parent))  # choose_threshold.py
sys.path.insert(0, str(HERE.parents[1] / "edge" / "inspector"))  # decision.py

import choose_threshold as ct  # noqa: E402
from decision import REJECT, Thresholds, decide  # noqa: E402

# 8 buenas, 2 grietas y 2 rebabas. La rebaba de 0.65 es la más baja: limita el umbral.
ROWS = ([(s, 0, "") for s in (0.05, 0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70)]
        + [(0.90, 1, "crack"), (0.80, 1, "crack"), (0.65, 1, "burr"), (0.95, 1, "burr")])


def write_csv(path, rows, header=("score", "is_defect", "defect_type")):
    with open(path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(header)
        writer.writerows(rows)
    return str(path)


@pytest.fixture
def small_csv(tmp_path):
    return write_csv(tmp_path / "val.csv", ROWS)


def test_limits_by_type_show_which_defect_binds(small_csv):
    rows = ct.read_scores(small_csv)
    limits = ct.max_threshold_by_type(ct.sweep(rows), 0.995)
    assert limits == {"crack": 0.80, "burr": 0.65}  # con 2 por tipo, 99.5 % exige atrapar los 2


def test_lowest_threshold_within_target_leaves_margin_below_the_lowest_defect(small_csv):
    # Objetivo 25 % = 2 de 8 buenas. El de menor costo (0.65) queda JUSTO en la rebaba más baja;
    # el elegido baja a 0.60 y gasta el FP que sobra en margen: una rebaba nueva de 0.62 se atrapa
    rows = ct.read_scores(small_csv)
    res = ct.choose(rows, min_recall=0.995, target_fp_rate=0.25, max_fp_rate=0.30, parts_per_day=115_200,
                    defect_rate=0.005, c_fn=2_000, c_fp=0.10)
    assert res["on_target"] is True and res["chosen"].threshold == 0.60
    assert res["chosen"].fp == 2 and res["min_cost"].threshold == 0.65


def test_falls_back_to_min_cost_when_no_threshold_meets_the_target(small_csv):
    # Con el objetivo del caso (1.5 %), ni 0.65 cabe (1 de 8 buenas = 12.5 %): se usa el de menor
    # costo dentro del tope y se marca SOBRE el objetivo
    rows = ct.read_scores(small_csv)
    res = ct.choose(rows, min_recall=0.995, target_fp_rate=0.015, max_fp_rate=0.2, parts_per_day=115_200,
                    defect_rate=0.005, c_fn=2_000, c_fp=0.10)
    best = res["chosen"]
    assert res["on_target"] is False and best.threshold == 0.65
    assert best.fp == 1 and best.fp_rate == 1 / 8  # la buena de 0.70 queda arriba del umbral
    day = ct.daily(best, 115_200, 0.005, 2_000, 0.10)
    assert day["fn_per_day"] == 0
    assert day["fp_per_day"] == pytest.approx(114_624 / 8)  # 14,328 buenas a revisión por día
    assert day["cost_per_day"] == pytest.approx(1_432.8)


def test_cheap_false_negatives_move_the_threshold_up(small_csv):
    # Si el FN costara centavos (no es el caso), el costo esperado prefiere un umbral más alto
    rows = ct.read_scores(small_csv)
    res = ct.choose(rows, min_recall=0.5, target_fp_rate=0.015, max_fp_rate=0.2, parts_per_day=115_200,
                    defect_rate=0.005, c_fn=0.01, c_fp=0.10)
    # 0.80: 0 FP a cambio de dejar pasar la rebaba de 0.65 (con FN caro, el de menor costo era 0.65)
    assert res["min_cost"].threshold == 0.80
    assert res["min_cost"].caught == {"crack": 2, "burr": 1} and res["min_cost"].fp == 0


def test_no_viable_threshold_returns_exit_code_3(small_csv, capsys):
    # A 0.65 hay 12.5 % de FP; con 10 % de capacidad no hay umbral viable: gate de CI rojo
    assert ct.main([small_csv, "--max-fp-rate", "0.10"]) == 3
    assert "NINGÚN umbral" in capsys.readouterr().out


def test_tie_at_threshold_counts_as_rejected(tmp_path):
    # Una buena con el MISMO score que la rebaba cae del mismo lado (>=): es un FP a ese umbral
    path = write_csv(tmp_path / "tie.csv", ROWS + [(0.65, 0, "")])
    rows = ct.read_scores(path)
    at = next(c for c in ct.sweep(rows) if c.threshold == 0.65)
    assert at.fp == 2 and at.caught["burr"] == 2


def test_runtime_uses_the_same_rule_as_the_tool(small_csv):
    rows = ct.read_scores(small_csv)
    best = ct.choose(rows, min_recall=0.995, target_fp_rate=0.015, max_fp_rate=0.2, parts_per_day=115_200,
                     defect_rate=0.005, c_fn=2_000, c_fp=0.10)["chosen"]
    # La rebaba con score EXACTAMENTE igual al umbral: la herramienta la cuenta como atrapada...
    assert best.caught["burr"] == 2
    # ...y decision.py (lo que corre en el Jetson) la rechaza
    assert decide({"anomaly_score": 0.65}, Thresholds(anomaly=best.threshold)).decision == REJECT


def test_json_output_for_pipelines(small_csv, capsys):
    assert ct.main([small_csv, "--max-fp-rate", "0.2", "--json"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["threshold"] == 0.65 and out["recall_by_type"] == {"burr": 1.0, "crack": 1.0}
    assert out["on_target"] is False and out["target_fp_rate"] == 0.015  # un pipeline no debería escribirlo solo


def test_defect_type_mode_ignores_other_types(small_csv, capsys):
    assert ct.main([small_csv, "--target-fp-rate", "0.1", "--max-fp-rate", "0.2",
                    "--defect-type", "crack", "--json"]) == 0
    out = json.loads(capsys.readouterr().out)
    # Sin rebabas en el análisis: 0.70 atrapa las 2 grietas con 1 de 8 buenas (12.5 %, sobre el 10 %)
    # y 0.80 con 0 FP; el objetivo solo admite 0.80
    assert out["threshold"] == 0.80 and list(out["recall_by_type"]) == ["crack"] and out["on_target"]


def test_defect_type_mode_requires_this_heads_share_of_the_fp_budget(small_csv, capsys):
    # Los defaults (1.5 % y 2.85 %) son el presupuesto de la UNIÓN: aplicados a cada una de las
    # 5 cabezas, la unión podría llegar a ≈ 14 %. Por eso con --defect-type no hay default
    assert ct.main([small_csv, "--defect-type", "crack"]) == 1
    assert ct.main([small_csv, "--defect-type", "crack", "--max-fp-rate", "0.0057"]) == 1
    assert "presupuesto de FP de esta cabeza" in capsys.readouterr().err


def test_default_fp_budget_comes_from_inspector_capacity(small_csv, capsys):
    ct.main([small_csv, "--json"])
    out = json.loads(capsys.readouterr().out)
    # (3,840 − 576) / (115,200 − 576) ≈ 2.85 %: el "≈ 2.8 %" del caso, medido sobre piezas buenas
    assert out["max_fp_rate"] == pytest.approx(3_264 / 114_624)


def test_report_mentions_binding_type_and_statistical_warning(small_csv, capsys):
    assert ct.main([small_csv, "--max-fp-rate", "0.2"]) == 0
    text = capsys.readouterr().out
    assert "burr" in text and "limita el umbral" in text and "SOBRE el objetivo" in text
    assert "≈ 598 defectos por tipo sin fallas" in text  # 2 defectos por tipo no demuestran nada
    # El umbral de menor costo queda justo sobre la rebaba más baja: 1 de cada 3 rebabas nuevas pasaría
    assert "(0 fallas + 1) / (2 + 1) = 33.3 %" in text


def test_upper_bound_rule_of_three():
    # 0 fallas en n: 1 − 0.05^(1/n) ≈ 3/n
    assert ct.miss_rate_upper_bound(600, 0) == pytest.approx(1 - 0.05 ** (1 / 600), rel=1e-6)
    assert ct.miss_rate_upper_bound(600, 0) < 0.005 < ct.miss_rate_upper_bound(500, 0)
    assert ct.miss_rate_upper_bound(75, 0) == pytest.approx(0.0392, abs=1e-4)  # 300 defectos / 4 tipos
    assert ct.miss_rate_upper_bound(10, 10) == 1.0
    assert ct.defects_needed(0.995) == 598


def test_upper_bound_with_misses_matches_binomial_cdf():
    n, misses = 100, 1
    p = ct.miss_rate_upper_bound(n, misses)
    cdf = sum(math.comb(n, k) * p ** k * (1 - p) ** (n - k) for k in range(misses + 1))
    assert cdf == pytest.approx(0.05, abs=1e-6)  # definición de la cota Clopper-Pearson a una cola
    assert p == pytest.approx(0.0466, abs=1e-4)


@pytest.mark.parametrize("rows, header, message", [
    (ROWS, ("score", "is_defect"), "faltan columnas"),
    ([(0.5, 1, "")] + ROWS, None, "defecto sin defect_type"),
    ([(1.5, 0, "")] + ROWS, None, "fuera de [0, 1]"),
    ([("nan", 0, "")] + ROWS, None, "fuera de [0, 1]"),
    ([(0.5, "yes", "")] + ROWS, None, "is_defect"),
    ([(0.1, 0, ""), (0.2, 0, "")], None, "buenas Y defectos"),
])
def test_invalid_csv_is_rejected_with_exit_code_1(tmp_path, capsys, rows, header, message):
    path = write_csv(tmp_path / "bad.csv", rows, header or ("score", "is_defect", "defect_type"))
    assert ct.main([path]) == 1
    assert message in capsys.readouterr().err
