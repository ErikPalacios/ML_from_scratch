"""Tests de indexing/build_index.py: las fórmulas contra los números del caso y FAISS con N chico."""

import faiss
import numpy as np
import pytest

import build_index as bi


def test_formulas_coinciden_con_el_caso():
    e = bi.extrapolate(100_000_000, d=512, M=32, pq_bytes=64)
    assert e["flat"] == pytest.approx(204.8)  # 100 M × 512 × 4 B
    assert e["fp16"] == pytest.approx(102.4)
    assert e["sq8"] == pytest.approx(51.2)
    assert e["pq"] == pytest.approx(6.4)
    assert e["graph"] == pytest.approx(25.6)  # 2 × 32 × 4 B = 256 B por vector
    assert e["hnsw_sq8"] == pytest.approx(76.8)
    assert e["hnsw_sq8_per_shard"] == pytest.approx(19.2)  # el "≈ 19 GB por shard" del caso
    assert e["ivf_pq"] == pytest.approx(7.2)  # 64 B de código + 8 B de id


@pytest.fixture(scope="module")
def data():
    xb, xq = bi.synthetic(n=4000, d=32, n_clusters=8, n_queries=50, noise=0.15, seed=0)
    return xb, xq, bi.exact_topk(xb, xq, 100)


def test_datos_normalizados_y_reproducibles(data):
    xb, xq, _ = data
    assert np.allclose(np.linalg.norm(xb, axis=1), 1, atol=1e-5)
    xb2, _ = bi.synthetic(n=4000, d=32, n_clusters=8, n_queries=50, noise=0.15, seed=0)
    assert np.array_equal(xb, xb2)


def test_hnsw_flat_recall_alto_y_memoria_segun_formula(data):
    xb, xq, gt = data
    h = bi.build_hnsw(xb, M=16, ef_construction=64, sq8=False)
    h.hnsw.efSearch = 128
    assert bi.knn_recall(h.search(xq, 100)[1], gt, 10) > 0.95
    per_vec = bi.index_bytes(h) / len(xb)
    formula = bi.memory_per_vector("hnsw_flat", d=32, M=16)  # 128 + 128 = 256 B
    # Los niveles altos del grafo y los offsets suman algo más que el nivel 0: hasta +25 % con d chico
    assert formula <= per_vec < formula * 1.25


def test_sq8_usa_menos_memoria_que_flat(data):
    xb, _, _ = data
    flat = bi.index_bytes(bi.build_hnsw(xb, 16, 64, sq8=False))
    sq8 = bi.index_bytes(bi.build_hnsw(xb, 16, 64, sq8=True))
    assert sq8 < flat


def test_hnsw_no_soporta_borrar():
    # Por esto el caso usa tombstones + rebuild: FAISS ni siquiera implementa remove_ids en HNSW.
    h = faiss.IndexHNSWFlat(8, 8)
    h.add(np.random.default_rng(0).random((10, 8), dtype=np.float32))
    with pytest.raises(RuntimeError, match="not implemented"):
        h.remove_ids(np.array([1], dtype=np.int64))


def test_ivfpq_y_refine_recuperan_recall(data):
    xb, xq, gt = data
    ivf = bi.build_ivfpq(xb, nlist=16, pq_bytes=8)  # d=32 → 8 trozos de 4 dims
    ivf.nprobe = 16  # todas las listas: el error que queda es de PQ, no de IVF
    plain = bi.knn_recall(ivf.search(xq, 100)[1], gt, 10)
    refined = bi.knn_recall(bi.with_refine(ivf, xb, k_factor=4).search(xq, 100)[1], gt, 10)
    assert refined > plain  # re-score con float32: lo que el caso hace con los 200 candidatos
    assert refined > 0.9


def test_filtro_selectivo_post_filtro_deja_paginas_vacias(data):
    xb, xq, _ = data
    h = bi.build_hnsw(xb, 16, 64, sq8=False)
    f = bi.filtered_experiment(h, xb, xq, n_values=200, k=10, candidates=20)  # 0.5 %: 20 vectores
    # 20 candidatos × 0.5 % = 0.1 esperados: casi todas las páginas quedan vacías
    assert f["post_filter_avg_results"] < 1
    assert f["post_filter_empty_pages"] > 0.8


def test_latencia_devuelve_percentiles(data):
    xb, xq, _ = data
    flat = faiss.IndexFlatIP(xb.shape[1])
    flat.add(xb)
    p50, p99 = bi.latency_ms(flat, xq, 10, n=20)
    assert 0 < p50 <= p99


def test_cli_corre_con_n_chico(capsys):
    assert bi.main(["--n", "3000", "--d", "32", "--queries", "30", "--ef-construction", "32",
                    "--pq-bytes", "8", "--filter-values", "100"]) == 0
    out = capsys.readouterr().out
    assert "HNSW-SQ8+refine" in out and "IVF-PQ8+refine" in out and "76.8 GB" in out
