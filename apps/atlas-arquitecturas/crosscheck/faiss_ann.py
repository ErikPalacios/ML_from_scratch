"""FAISS para el cross-check del modelo `ann` (lo llama retrieval.py en un proceso aparte: torch y faiss-cpu traen cada uno su
libomp y no se pueden cargar juntos en macOS). Índices REALES chicos (N = 20,000, d = 64, datos gaussianos, semilla 0): bytes de
cada parte (arreglos internos y serialize_index) y distancias por query (hnsw_stats / indexIVF_stats); y atributos a tamaño real
sin entrenar (nb_neighbors del nivel 0, code_size, tamaño de los codebooks de PQ). Uso: python faiss_ann.py '<config json>'.
"""
import json
import sys

import numpy as np
import faiss

SMALL = dict(N=20000, d=64)


def small_checks(c):
    """Índices FAISS reales y chicos: bytes (arreglos internos + serialize_index) y distancias por query."""
    rng = np.random.default_rng(0)
    N, d = SMALL["N"], SMALL["d"]
    x = rng.standard_normal((N, d)).astype("float32")
    q = rng.standard_normal((200, d)).astype("float32")
    ser = lambda ix: int(faiss.serialize_index(ix).size)   # noqa: E731
    ann_checks, range_checks, measured = [], [], {}
    if c["kind"] == "flat":
        for bits, ix in ((32, faiss.IndexFlatIP(d)), (16, faiss.IndexScalarQuantizer(d, faiss.ScalarQuantizer.QT_fp16)),
                         (8, faiss.IndexScalarQuantizer(d, faiss.ScalarQuantizer.QT_8bit))):
            if not ix.is_trained:
                ix.train(x)
            ix.add(x)
            codes = N * (d if bits == 32 else ix.code_size) * (4 if bits == 32 else 1)
            trained = 0 if bits >= 16 else int(faiss.vector_to_array(ix.sq.trained).size) * 4
            ann_checks.append({"what": f"flat {bits} bits: vectores (N = {N}, d = {d})", "fn": "flat_bytes", "args": {"N": N, "d": d, "bits": bits}, "key": "vectors", "ref": codes, "tol": 0})
            ann_checks.append({"what": f"flat {bits} bits: rango entrenado del SQ", "fn": "flat_bytes", "args": {"N": N, "d": d, "bits": bits}, "key": "sqTrained", "ref": trained, "tol": 0})
            ann_checks.append({"what": f"flat {bits} bits: serialize_index (con cabecera)", "fn": "flat_bytes", "args": {"N": N, "d": d, "bits": bits}, "key": "total", "ref": ser(ix), "tol": 0.001})
        fl = faiss.IndexFlatIP(d)
        fl.add(x)
        measured["flat_ndis"] = N
    elif c["kind"] == "hnsw":
        for M in (16, 32):
            ix = faiss.IndexHNSWFlat(d, M)
            ix.hnsw.efConstruction = 200
            ix.add(x)
            nb = faiss.vector_to_array(ix.hnsw.neighbors).size
            args = {"N": N, "d": d, "M": M}
            ann_checks += [
                {"what": f"HNSW M = {M}: vectores", "fn": "hnsw_bytes", "args": args, "key": "vectors", "ref": N * d * 4, "tol": 0},
                {"what": f"HNSW M = {M}: enlaces int32 (esperanza N·(2M + M/(M−1)), ≈)", "fn": "hnsw_bytes", "args": args, "key": "links", "ref": 4 * int(nb), "tol": 0.01},
                {"what": f"HNSW M = {M}: levels (int32)", "fn": "hnsw_bytes", "args": args, "key": "levels", "ref": 4 * int(faiss.vector_to_array(ix.hnsw.levels).size), "tol": 0},
                {"what": f"HNSW M = {M}: offsets (size_t, N + 1)", "fn": "hnsw_bytes", "args": args, "key": "offsets", "ref": 8 * int(faiss.vector_to_array(ix.hnsw.offsets).size), "tol": 0},
                {"what": f"HNSW M = {M}: serialize_index (con cabecera)", "fn": "hnsw_bytes", "args": args, "key": "total", "ref": ser(ix), "tol": 0.005},
                {"what": f"HNSW M = {M}: regla del wiki (d·4 + M·2·4) por vector", "fn": "hnsw_bytes", "args": args, "key": "wiki", "ref": N * (d * 4 + M * 2 * 4), "tol": 0},
            ]
            for ef in (16, 64, 256):
                ix.hnsw.efSearch = ef
                faiss.cvar.hnsw_stats.reset()
                ix.search(q, 10)
                ndis = faiss.cvar.hnsw_stats.ndis / q.shape[0]
                range_checks.append({"what": f"HNSW M = {M}, efSearch = {ef}: distancias por query medidas / cota ≈ del calculador",
                                     "calc_overrides": {"N": N, "d": d, "M": M, "efSearch": ef, "encode": 0}, "metric": "distanceComputations",
                                     "ref": ndis, "min_ratio": 0.3, "max_ratio": 1.2})
        h = faiss.IndexHNSWFlat(d, 32)
        measured["faiss_defaults"] = {"M_ctor": 32, "efConstruction": int(h.hnsw.efConstruction), "efSearch": int(h.hnsw.efSearch)}
    else:
        for nlist, m, nbits in ((64, 8, 8), (128, 16, 8), (64, 8, 4)):
            qz = faiss.IndexFlatL2(d)
            ix = faiss.IndexIVFPQ(qz, d, nlist, m, nbits)
            ix.train(x)
            ix.add(x)
            args = {"N": N, "d": d, "nlist": nlist, "m": m, "nbits": nbits}
            inv = ix.invlists
            n_ids = sum(inv.list_size(i) for i in range(nlist))
            ann_checks += [
                {"what": f"IVFPQ n_list {nlist}, m {m}, {nbits} bits: códigos (code_size = {ix.code_size} B)", "fn": "ivfpq_bytes", "args": args, "key": "codes", "ref": n_ids * ix.code_size, "tol": 0},
                {"what": f"IVFPQ n_list {nlist}, m {m}, {nbits} bits: ids int64 en las listas", "fn": "ivfpq_bytes", "args": args, "key": "ids", "ref": 8 * n_ids, "tol": 0},
                {"what": f"IVFPQ n_list {nlist}, m {m}, {nbits} bits: centroides del cuantizador", "fn": "ivfpq_bytes", "args": args, "key": "centroids", "ref": 4 * qz.ntotal * d, "tol": 0},
                {"what": f"IVFPQ n_list {nlist}, m {m}, {nbits} bits: codebooks de PQ", "fn": "ivfpq_bytes", "args": args, "key": "codebooks", "ref": 4 * int(faiss.vector_to_array(ix.pq.centroids).size), "tol": 0},
                {"what": f"IVFPQ n_list {nlist}, m {m}, {nbits} bits: tabla precalculada (RAM)", "fn": "ivfpq_bytes", "args": args, "key": "precomputedTable", "ref": 4 * int(ix.precomputed_table.size()), "tol": 0},
                {"what": f"IVFPQ n_list {nlist}, m {m}, {nbits} bits: serialize_index (con cabecera)", "fn": "ivfpq_bytes", "args": args, "key": "total", "ref": ser(ix), "tol": 0.005},
            ]
            for nprobe in (1, 4, 16):
                ix.nprobe = nprobe
                faiss.cvar.indexIVF_stats.reset()
                ix.search(q, 10)
                ndis = faiss.cvar.indexIVF_stats.ndis / q.shape[0]
                range_checks.append({"what": f"IVFPQ n_list {nlist}, m {m}, {nbits} bits, n_probe {nprobe}: vectores recorridos por query medidos / n_probe·N/n_list",
                                     "calc_overrides": {"N": N, "d": d, "nlist": nlist, "nprobe": nprobe, "m": m, "nbits": nbits, "encode": 0}, "metric": "scannedVectors",
                                     "ref": ndis, "min_ratio": 0.7, "max_ratio": 1.3})
        cp = faiss.ClusteringParameters()
        q8 = faiss.IndexFlatL2(8)
        i8 = faiss.IndexIVFPQ(q8, 8, 4, 2, 8)
        measured["faiss_defaults"] = {"ivf_cp_niter": int(i8.cp.niter), "pq_cp_niter": int(i8.pq.cp.niter),
                                      "max_points_per_centroid": int(cp.max_points_per_centroid), "precomputed_table_max_bytes": int(faiss.cvar.precomputed_table_max_bytes)}
    return ann_checks, range_checks, measured




def full_attrs(c):
    d = c["d"]
    out = {"d": d, "precomputed_table_max_bytes": int(faiss.cvar.precomputed_table_max_bytes)}
    if c["kind"] == "hnsw":
        h = faiss.IndexHNSWFlat(d, c["M"])   # (variable: el índice temporal se liberaría antes de leer .hnsw)
        out["nb_neighbors0"] = int(h.hnsw.nb_neighbors(0))
    if c["kind"] == "ivfpq":
        qz = faiss.IndexFlatL2(d)
        ix = faiss.IndexIVFPQ(qz, d, c["nlist"], c["m"], c["nbits"])
        out.update({"code_size": int(ix.code_size), "pq_centroids": int(faiss.vector_to_array(ix.pq.centroids).size), "nlist": int(ix.nlist)})
    return out


if __name__ == "__main__":
    c = json.loads(sys.argv[1])
    a, r, m = small_checks(c)
    json.dump({"ann_checks": a, "range_checks": r, "measured": m, "full": full_attrs(c), "faiss_version": faiss.__version__}, sys.stdout)
