"""Tests de eval/offline_eval.py con casos que se calculan a mano."""

import json
import math

import pytest

import offline_eval as ev


def test_ndcg_orden_ideal_es_1():
    judged = {"a": 3, "b": 2, "c": 0}
    assert ev.ndcg_at_k(["a", "b", "c"], judged, 10) == pytest.approx(1.0)


def test_ndcg_ejemplo_del_docstring():
    # [X, A], juzgados {A: 3, B: 2}: DCG = 7/log2(3) = 4.4165; IDCG = 7 + 3/log2(3) = 8.8928
    v = ev.ndcg_at_k(["X", "A"], {"A": 3, "B": 2}, 10)
    assert v == pytest.approx((7 / math.log2(3)) / (7 + 3 / math.log2(3)))
    assert v == pytest.approx(0.4966, abs=1e-4)


def test_ndcg_ganancia_exponencial_no_lineal():
    # Con ganancia exponencial, poner el 3 arriba vale más que con ganancia lineal.
    judged = {"tres": 3, "uno": 1}
    swapped = ev.ndcg_at_k(["uno", "tres"], judged, 10)
    # DCG = 1 + 7/log2(3) = 5.4165 ; IDCG = 7 + 1/log2(3) = 7.6309
    assert swapped == pytest.approx((1 + 7 / math.log2(3)) / (7 + 1 / math.log2(3)))


def test_ndcg_idcg_usa_todos_los_juzgados_no_solo_los_recuperados():
    # El sistema devuelve solo el "2" y nunca encuentra el "3": NO debe dar 1.0
    v = ev.ndcg_at_k(["b"], {"a": 3, "b": 2}, 10)
    assert v == pytest.approx(3 / (7 + 3 / math.log2(3)))
    assert v < 0.5


def test_ndcg_corta_en_k():
    judged = {"z": 3}
    ranked = [f"x{i}" for i in range(10)] + ["z"]  # el relevante en la posición 11
    assert ev.ndcg_at_k(ranked, judged, 10) == 0.0


def test_query_sin_relevantes_es_indefinida():
    assert ev.ndcg_at_k(["a"], {"a": 0, "b": 0}, 10) is None
    assert ev.recall_at_k(["a"], {"a": 1}, 10) is None  # grado 1 < 2: no hay "relevantes"


def test_duplicados_en_el_run_no_suman_dos_veces():
    assert ev.ndcg_at_k(["a", "a"], {"a": 3, "b": 3}, 10) == pytest.approx(
        7 / (7 + 7 / math.log2(3)))


def test_recall_at_k_y_judged():
    judged = {"a": 3, "b": 2, "c": 1, "d": 0}
    assert ev.recall_at_k(["a", "x", "c"], judged, 3) == pytest.approx(0.5)  # 1 de {a, b}
    assert ev.judged_at_k(["a", "x", "c", "y"], judged, 4) == pytest.approx(0.5)


def test_knn_recall_contra_brute_force():
    assert ev.knn_recall_at_k([1, 2, 3, 9], [1, 2, 3, 4], 4) == pytest.approx(0.75)
    # filtro selectivo: el exacto solo encontró 2 → denominador 2, no k
    assert ev.knn_recall_at_k([1, 7], [1, 2], 100) == pytest.approx(0.5)
    assert ev.knn_recall_at_k([], [], 10) == 1.0


def test_query_ausente_del_run_cuenta_como_cero():
    pq = ev.per_query({}, {"q1": {"a": 3}})
    assert pq["q1"]["ndcg@10"] == 0.0


def test_bootstrap_constante_tiene_intervalo_cero_y_es_reproducible():
    e = ev.bootstrap_mean([0.5] * 50)
    assert (e.mean, e.low, e.high, e.n) == (0.5, 0.5, 0.5, 50)
    vals = [i / 100 for i in range(100)]
    assert ev.bootstrap_mean(vals, seed=1) == ev.bootstrap_mean(vals, seed=1)
    e2 = ev.bootstrap_mean(vals)
    assert e2.low < e2.mean < e2.high
    # error estándar ≈ 0.29/√100 ≈ 0.029 → ancho al 95 % ≈ 2 × 1.96 × 0.029 ≈ 0.11
    assert 0.08 < e2.high - e2.low < 0.14


def test_summarize_por_segmento_y_excluidas():
    qrels = {"q1": {"a": 3}, "q2": {"b": 2}, "q3": {"c": 0}}
    run = {"q1": ["a"], "q2": ["x", "b"], "q3": ["c"]}
    rep = ev.summarize(ev.per_query(run, qrels), {"q1": "head", "q2": "tail", "q3": "tail"})
    assert rep["all"]["ndcg@10"].n == 2 and rep["all"]["ndcg@10:excluded"] == 1
    assert rep["head"]["ndcg@10"].mean == pytest.approx(1.0)
    assert rep["tail"]["ndcg@10"].mean == pytest.approx(1 / math.log2(3))  # b en la posición 2


def test_diferencia_pareada():
    a = {f"q{i}": 0.5 for i in range(40)}
    b = {f"q{i}": 0.6 for i in range(40)}
    d = ev.paired_difference(a, b)
    assert d.mean == pytest.approx(0.1) and d.low == pytest.approx(0.1)  # mejora en TODAS: sin varianza


def test_cli_lee_jsonl(tmp_path, capsys):
    qrels = tmp_path / "qrels.jsonl"
    qrels.write_text("\n".join(json.dumps(r) for r in [
        {"query_id": "q1", "listing_id": "a", "grade": 3, "segment": "head"},
        {"query_id": "q1", "listing_id": "b", "grade": 0, "segment": "head"},
    ]) + "\n")
    run = tmp_path / "run.jsonl"
    run.write_text(json.dumps({"query_id": "q1", "ranked": ["a", "b"]}) + "\n")
    assert ev.main([str(qrels), str(run), "--baseline", str(run)]) == 0
    out = capsys.readouterr().out
    assert "ndcg@10" in out and "Δ NDCG@10" in out


def test_grado_fuera_de_rango_se_rechaza(tmp_path):
    p = tmp_path / "q.jsonl"
    p.write_text(json.dumps({"query_id": "q", "listing_id": "a", "grade": 5}) + "\n")
    with pytest.raises(ValueError):
        ev.load_qrels(str(p))
