"""Tests de search/fusion.py: números verificables a mano (k = 60)."""

import pytest

from fusion import DEFAULT_K, rrf


def test_k_del_paper_es_60():
    assert DEFAULT_K == 60


def test_ejemplo_del_docstring_a_mano():
    # A: 1.º ANN, 3.º BM25 · B: 1.º solo BM25 · C: 20.º en las dos
    ann = ["A"] + [f"x{i}" for i in range(18)] + ["C"]
    bm25 = ["B", "y0", "A"] + [f"y{i}" for i in range(1, 17)] + ["C"]
    out = {f.doc_id: f for f in rrf({"ann": ann, "bm25": bm25})}
    assert out["A"].score == pytest.approx(1 / 61 + 1 / 63)  # 0.032266
    assert out["B"].score == pytest.approx(1 / 61)  # 0.016393
    assert out["C"].score == pytest.approx(2 / 80)  # 0.025: el acuerdo le gana al 1.º de una sola lista
    assert out["A"].ranks == {"ann": 1, "bm25": 3}
    order = [f.doc_id for f in rrf({"ann": ann, "bm25": bm25})]
    assert order.index("A") < order.index("C") < order.index("B")


def test_lista_faltante_o_vacia_devuelve_el_orden_de_la_otra():
    ann = ["a", "b", "c"]
    for missing in (None, []):
        assert [f.doc_id for f in rrf({"ann": ann, "bm25": missing})] == ann


def test_sin_listas_devuelve_vacio():
    assert rrf({}) == []
    assert rrf({"ann": None, "bm25": []}) == []


def test_empates_son_deterministas():
    # "p" y "q" están 1.º en listas distintas: mismo score, mismo mejor rank, una lista cada uno → por id
    r1 = rrf({"ann": ["q", "z"], "bm25": ["p", "z"]})
    r2 = rrf({"bm25": ["p", "z"], "ann": ["q", "z"]})  # mismo contenido, otro orden del dict
    assert [f.doc_id for f in r1] == [f.doc_id for f in r2]
    assert [f.doc_id for f in r1][:2] == ["z", "p"]  # z está en las dos (2/62 > 1/61); luego p antes que q
    assert r1[1].score == r1[2].score


def test_duplicado_en_la_misma_lista_cuenta_una_vez_con_su_mejor_rank():
    out = {f.doc_id: f for f in rrf({"ann": ["a", "b", "a", "c"]})}
    assert out["a"].score == pytest.approx(1 / 61)
    assert out["c"].ranks == {"ann": 3}  # el duplicado no empuja a "c" al 4.º lugar


def test_pesos_y_limit():
    out = rrf({"ann": ["a"], "bm25": ["b"]}, weights={"bm25": 2.0}, limit=1)
    assert [f.doc_id for f in out] == ["b"]
    assert out[0].score == pytest.approx(2 / 61)


def test_k_invalido():
    with pytest.raises(ValueError):
        rrf({"ann": ["a"]}, k=0)


def test_k_cambia_el_orden_es_un_hiperparametro():
    # "solo": 1.º en ANN y ausente en BM25. "ambos": 5.º en las dos listas.
    ann = ["solo", "a1", "a2", "a3", "ambos"]
    bm25 = ["b0", "b1", "b2", "b3", "ambos"]
    # k = 1:  solo = 1/2 = 0.5   ·  ambos = 2/6 ≈ 0.333  → gana "solo" (el 1.º lugar pesa mucho)
    pos = lambda k: [f.doc_id for f in rrf({"ann": ann, "bm25": bm25}, k=k)]  # noqa: E731
    assert pos(1).index("solo") < pos(1).index("ambos")
    # k = 60: solo = 1/61 ≈ 0.0164 · ambos = 2/65 ≈ 0.0308 → gana "ambos" (el acuerdo pesa más)
    assert pos(60)[0] == "ambos"
