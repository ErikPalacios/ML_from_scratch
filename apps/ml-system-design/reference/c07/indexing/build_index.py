"""Benchmark de índices ANN con FAISS sobre vectores SINTÉTICOS (caso c07). Corre en CPU.

Qué responde (con números medidos en TU máquina, no copiados de un blog):
  1. ¿Cuánto recall pierdo contra la búsqueda exacta?   recall@10 y recall@100 vs IndexFlatIP (brute force)
  2. ¿Cuánta memoria por vector?                          bytes medidos (serializando el índice) vs fórmula
  3. ¿Cuánto tarda construirlo y consultarlo?             build en s, latencia por consulta (1 hilo)
  4. ¿Qué pasa con un filtro selectivo?                   post-filtro vs filtro DENTRO de la búsqueda vs exacto
Y extrapola la memoria a los 100 M de listings del caso con las fórmulas (no con el benchmark).

Índices que compara (d = 512, producto interno sobre vectores L2-normalizados = coseno):
  HNSW-Flat   grafo HNSW (M = 32) + vectores float32            ≈ 4d + 2·M·4 bytes por vector
  HNSW-SQ8    grafo HNSW + vectores int8 (scalar quantization)  ≈ d + 2·M·4 bytes   ← la decisión del caso
  + refine    lo anterior + re-score EXACTO de 200 candidatos con los float32 (en producción, en EBS + page cache)
  IVF-PQ      nlist listas invertidas + códigos PQ de 64 bytes  ≈ 64 + 8 (id) bytes ← la alternativa barata
  IVF-Flat    las mismas listas con los float32 completos       ≈ 4d + 8 bytes: separa la pérdida de IVF de la de PQ
(fórmulas de la wiki de FAISS, "Guidelines to choose an index"; el benchmark las verifica midiendo)

AVISO: el recall de vectores sintéticos NO es el recall de tus embeddings. Los embeddings reales tienen
otra estructura (dimensión intrínseca, clusters desbalanceados, duplicados) y el recall de HNSW depende
de eso. Este script sirve para entender las perillas y la memoria; el número que vale es el del canary
set con vectores reales (ver eval/offline_eval.py: knn_recall_at_k, y la alerta ANNRecallDrop).

Uso:
  python build_index.py                           # 200k × 512: ≈ 2 min medidos en una laptop de 10 núcleos
  python build_index.py --n 50000 --queries 300   # versión rápida: ≈ 20 s
"""

from __future__ import annotations  # anotaciones como texto

import argparse  # CLI
import math  # sqrt para nlist
import time  # build y latencia
from dataclasses import dataclass  # filas de la tabla

import faiss  # faiss-cpu: los índices
import numpy as np  # datos sintéticos y recall

GB = 1e9  # GB decimales, como en el caso (100 M × 512 × 4 B = 204.8 GB)


# ---------------------------------------------------------------------------- fórmulas (sin FAISS)
def memory_per_vector(kind: str, d: int = 512, M: int = 32, pq_bytes: int = 64) -> int:
    """Bytes por vector según la wiki de FAISS. Sin los costos fijos (centroides, tablas de PQ), que
    con 100 M de vectores son despreciables.

    Ejemplo (d = 512, M = 32): flat 2,048 · sq8 512 · grafo HNSW nivel 0: 2 × 32 × 4 = 256.
    """
    graph = 2 * M * 4  # nivel 0 del grafo: 2·M vecinos × int32. Los niveles altos suman poco (medido abajo)
    return {
        "flat": 4 * d,  # float32
        "fp16": 2 * d,
        "sq8": d,  # 1 byte por dimensión
        "pq": pq_bytes,  # solo el código
        "hnsw_flat": 4 * d + graph,
        "hnsw_sq8": d + graph,
        "ivf_pq": pq_bytes + 8,  # código + id int64 en la lista invertida
    }[kind]


def extrapolate(n: int, d: int = 512, M: int = 32, pq_bytes: int = 64, shards: int = 4) -> dict[str, float]:
    """GB totales a n vectores (y por shard para la decisión del caso)."""
    out = {k: n * memory_per_vector(k, d, M, pq_bytes) / GB
           for k in ("flat", "fp16", "sq8", "pq", "hnsw_flat", "hnsw_sq8", "ivf_pq")}
    out["graph"] = n * 2 * M * 4 / GB
    out["hnsw_sq8_per_shard"] = out["hnsw_sq8"] / shards
    return out


# ---------------------------------------------------------------------------- datos sintéticos
def synthetic(n: int, d: int, n_clusters: int, n_queries: int, noise: float, seed: int = 0):
    """Mezcla de gaussianas sobre la esfera: centros al azar + ruido, todo L2-normalizado.

    Los listings se agrupan (muchas "chamarras de mezclilla" parecidas), así que un conjunto uniforme
    sería demasiado fácil… o demasiado difícil: ninguno de los dos es real. Las queries salen de la
    misma mezcla pero NO están en la base.
    """
    rng = np.random.default_rng(seed)
    centers = rng.normal(size=(n_clusters, d)).astype(np.float32)
    centers /= np.linalg.norm(centers, axis=1, keepdims=True)
    cluster_of = rng.integers(0, n_clusters, n)
    xb = centers[cluster_of] + rng.normal(scale=noise, size=(n, d)).astype(np.float32)
    xb /= np.linalg.norm(xb, axis=1, keepdims=True)
    q_cluster = rng.integers(0, n_clusters, n_queries)
    xq = centers[q_cluster] + rng.normal(scale=noise, size=(n_queries, d)).astype(np.float32)
    xq /= np.linalg.norm(xq, axis=1, keepdims=True)
    return xb.astype(np.float32), xq.astype(np.float32)


def exact_topk(xb: np.ndarray, xq: np.ndarray, k: int) -> np.ndarray:
    """Ground truth: brute force con IndexFlatIP (exacto). Es lo que el ANN intenta aproximar."""
    flat = faiss.IndexFlatIP(xb.shape[1])
    flat.add(xb)
    return flat.search(xq, k)[1]


def knn_recall(approx: np.ndarray, exact: np.ndarray, k: int) -> float:
    """|top-k ANN ∩ top-k exacto| / k, promediado sobre queries. Mismo cálculo que eval/offline_eval.py."""
    return float(np.mean([len(set(a[:k]) & set(e[:k]) - {-1}) / k for a, e in zip(approx, exact)]))


# ---------------------------------------------------------------------------- índices
def build_hnsw(xb: np.ndarray, M: int, ef_construction: int, sq8: bool) -> faiss.Index:
    d = xb.shape[1]
    if sq8:
        # SQ8: entrena min/max por dimensión y guarda 1 byte por dimensión (4× menos que float32)
        idx = faiss.IndexHNSWSQ(d, faiss.ScalarQuantizer.QT_8bit, M, faiss.METRIC_INNER_PRODUCT)
        idx.train(xb)
    else:
        idx = faiss.IndexHNSWFlat(d, M, faiss.METRIC_INNER_PRODUCT)
    # efConstruction: cuántos candidatos explora al insertar. Más = mejor grafo, build más lento.
    idx.hnsw.efConstruction = ef_construction
    idx.add(xb)  # HNSW no necesita entrenamiento del grafo, pero se construye insertando uno por uno
    return idx


def build_ivfpq(xb: np.ndarray, nlist: int, pq_bytes: int) -> faiss.Index:
    d = xb.shape[1]
    quantizer = faiss.IndexFlatIP(d)  # los nlist centroides (k-means): a qué lista va cada vector
    # pq_bytes subcuantizadores × 8 bits: el vector de 512 dims se parte en 64 trozos de 8 dims y cada
    # trozo se reemplaza por el id (1 byte) de su centroide más cercano → 64 bytes por vector.
    idx = faiss.IndexIVFPQ(quantizer, d, nlist, pq_bytes, 8, faiss.METRIC_INNER_PRODUCT)
    idx.train(xb)  # k-means de las listas + los codebooks de PQ: necesita ≥ 30 × nlist vectores
    idx.add(xb)
    return idx


def build_ivfflat(xb: np.ndarray, nlist: int) -> faiss.Index:
    """Las mismas listas invertidas que IVF-PQ pero con los vectores completos: sirve para ver qué parte
    del recall pierde IVF (no visitar la lista correcta) y qué parte pierde PQ (la compresión)."""
    d = xb.shape[1]
    idx = faiss.IndexIVFFlat(faiss.IndexFlatIP(d), d, nlist, faiss.METRIC_INNER_PRODUCT)
    idx.train(xb)  # solo el k-means de las listas
    idx.add(xb)
    return idx


def with_refine(base: faiss.Index, xb: np.ndarray, k_factor: int) -> faiss.Index:
    """Re-score exacto: el índice base devuelve k × k_factor candidatos y se re-ordenan con float32.

    Es el "top-200 re-scored con los vectores exactos" del caso (k = 100, k_factor = 2). Aquí los float32
    viven en RAM (un IndexFlatIP); en producción viven en EBS (gp3) y se sirven desde el page cache del
    nodo (la r7i no tiene disco local). En frío serían 200 lecturas aleatorias de 2 KB por consulta,
    ≈ 175k lecturas/s por máquina: más de 4× el techo de 40k IOPS de EBS de una r7i.4xlarge. Por eso una
    copia nueva o reiniciada se precalienta (lee sus ≈ 51 GB al page cache) antes de recibir tráfico. Un
    NVMe local (p. ej. r6id, con instance store) es la alternativa que quita el precalentamiento.
    """
    exact = faiss.IndexFlatIP(xb.shape[1])
    exact.add(xb)  # mismo orden de ids que el base: IndexRefine exige el mismo ntotal
    ref = faiss.IndexRefine(base, exact)  # el wrapper de Python guarda referencias a los dos índices
    ref.k_factor = k_factor
    return ref


def index_bytes(idx: faiss.Index) -> int:
    """Tamaño serializado ≈ memoria del índice (sin overhead del allocator)."""
    return int(faiss.serialize_index(idx).size)


def latency_ms(idx: faiss.Index, xq: np.ndarray, k: int, n: int = 200) -> tuple[float, float]:
    """p50 y p99 de UNA consulta a la vez con 1 hilo: así llega cada búsqueda online."""
    prev = faiss.omp_get_max_threads()
    faiss.omp_set_num_threads(1)
    try:
        ts = []
        for q in xq[:n]:
            t0 = time.perf_counter()
            idx.search(q[None, :], k)
            ts.append((time.perf_counter() - t0) * 1000)
        return float(np.percentile(ts, 50)), float(np.percentile(ts, 99))
    finally:
        faiss.omp_set_num_threads(prev)


@dataclass
class Row:
    name: str
    params: str
    r10: float
    r100: float
    build_s: float
    bytes_per_vec: float
    p50_ms: float
    p99_ms: float


def evaluate(name, params, idx, xq, gt, build_s, nbytes, n) -> Row:
    approx = idx.search(xq, 100)[1]  # recall con todos los hilos (más rápido); latencia aparte con 1 hilo
    p50, p99 = latency_ms(idx, xq, 100)
    return Row(name, params, knn_recall(approx, gt, 10), knn_recall(approx, gt, 100), build_s, nbytes / n, p50, p99)


# ---------------------------------------------------------------------------- filtros
def filtered_experiment(hnsw: faiss.Index, xb, xq, n_values: int, k: int = 48,
                        candidates: int = 200, ef: int = 128, seed: int = 1) -> dict[str, float]:
    """Filtro por un atributo que NO depende del contenido (como la ciudad o un rango de precio): cada
    listing recibe uno de n_values valores al azar y cada query filtra por uno. Selectividad = 1/n_values.
    k = 48 (una página).

    post-filtro : ANN top-`candidates` y DESPUÉS filtrar → ¿cuántos de los 48 quedan?  (la trampa)
    in-search   : el filtro dentro del recorrido del grafo (IDSelector de FAISS)
    exacto      : brute force sobre el subconjunto que cumple el filtro (barato si el subconjunto es chico)
    """
    rng = np.random.default_rng(seed)
    value = rng.integers(0, n_values, len(xb))  # el atributo de cada listing
    wanted = rng.integers(0, n_values, len(xq))  # el filtro de cada query
    hnsw.hnsw.efSearch = ef
    post_counts, ins_counts, ins_recall, exact_ms = [], [], [], []
    base_ids = hnsw.search(xq, candidates)[1]
    for i, q in enumerate(xq):
        ok = np.flatnonzero(value == wanted[i])
        # post-filtro
        post_counts.append(int(np.isin(base_ids[i], ok).sum()))
        # exacto sobre el subconjunto
        t0 = time.perf_counter()
        sims = xb[ok] @ q
        exact = ok[np.argsort(-sims)[:k]]
        exact_ms.append((time.perf_counter() - t0) * 1000)
        # in-search: el grafo se recorre como siempre (también pasa por nodos que no cumplen), pero solo
        # los ids permitidos cuentan como resultado. Con un filtro muy selectivo, la búsqueda termina
        # (efSearch) antes de juntar 48 que cumplan: por eso el exacto sobre el subconjunto le gana.
        sel = faiss.IDSelectorBatch(ok.astype(np.int64))
        got = hnsw.search(q[None, :], k, params=faiss.SearchParametersHNSW(sel=sel, efSearch=ef))[1][0]
        got = got[got >= 0]
        ins_counts.append(len(got))
        ins_recall.append(len(set(got) & set(exact)) / max(1, min(k, len(ok))))
    return {
        "selectivity": 1 / n_values,
        "post_filter_avg_results": float(np.mean(post_counts)),
        "post_filter_empty_pages": float(np.mean(np.array(post_counts) == 0)),
        "in_search_avg_results": float(np.mean(ins_counts)),
        "in_search_recall": float(np.mean(ins_recall)),
        "exact_subset_ms": float(np.median(exact_ms)),
        "subset_size": float(len(xb) / n_values),
    }


# ---------------------------------------------------------------------------- CLI
def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="HNSW vs IVF-PQ en vectores sintéticos")
    ap.add_argument("--n", type=int, default=200_000)
    ap.add_argument("--d", type=int, default=512)
    ap.add_argument("--queries", type=int, default=1000)
    # Por defecto n/500 clusters: el top-100 de una query cae dentro de su propio cluster. Con clusters
    # de 25 vectores, el puesto 100 sería un vecino "al azar" de otro cluster y recall@100 mediría ruido.
    ap.add_argument("--clusters", type=int, default=0, help="0 = n // 500")
    ap.add_argument("--noise", type=float, default=0.04, help="desvío por dimensión alrededor del centro")
    ap.add_argument("--M", type=int, default=32)
    ap.add_argument("--pq-bytes", type=int, default=64, help="bytes del código PQ (d debe ser múltiplo)")
    ap.add_argument("--ef-construction", type=int, default=100)
    ap.add_argument("--filter-values", type=int, nargs="+", default=[500, 10],
                    help="filtros a probar: 1 de 500 valores = 0.2 %% y 1 de 10 = 10 %% del catálogo")
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args(argv)
    a.clusters = a.clusters or max(10, a.n // 500)

    print(f"FAISS {faiss.__version__} · {a.n:,} vectores × {a.d} · {a.queries} queries · hilos {faiss.omp_get_max_threads()}")
    xb, xq = synthetic(a.n, a.d, a.clusters, a.queries, a.noise, a.seed)
    gt = exact_topk(xb, xq, 100)
    rows: list[Row] = []

    hnsw = {}
    for sq8 in (False, True):
        name = "HNSW-SQ8" if sq8 else "HNSW-Flat"
        t0 = time.perf_counter()
        hnsw[name] = h = build_hnsw(xb, a.M, a.ef_construction, sq8)
        build_s = time.perf_counter() - t0
        nb = index_bytes(h)
        for ef in (64, 128, 256):
            h.hnsw.efSearch = ef  # efSearch: candidatos explorados por consulta; la perilla recall ↔ latencia
            rows.append(evaluate(name, f"M={a.M} efS={ef}", h, xq, gt, build_s, nb, a.n))
    h = hnsw["HNSW-SQ8"]
    h.hnsw.efSearch = 128
    rows.append(evaluate("HNSW-SQ8+refine", "efS=128, 200 cand.", with_refine(h, xb, 2), xq, gt,
                         rows[-1].build_s, index_bytes(h), a.n))

    nlist = 2 ** round(math.log2(4 * math.sqrt(a.n)))  # wiki de FAISS: 4·√N a 16·√N listas
    t0 = time.perf_counter()
    ivf = build_ivfpq(xb, nlist, a.pq_bytes)
    build_s = time.perf_counter() - t0
    nb = index_bytes(ivf)
    # nprobe = cuántas listas se recorren por consulta: la perilla de IVF. Con pocas listas se pierden
    # vecinos que cayeron en una lista no visitada; cuando ya visitas las listas de los vecinos, subir
    # nprobe deja de ayudar y el techo lo pone PQ (compara con IVF-Flat, mismas listas sin compresión).
    for nprobe in (1, 4, 16, 64):
        ivf.nprobe = nprobe
        rows.append(evaluate(f"IVF-PQ{a.pq_bytes}", f"nlist={nlist} nprobe={nprobe}", ivf, xq, gt, build_s, nb, a.n))
    rows.append(evaluate(f"IVF-PQ{a.pq_bytes}+refine", "nprobe=64, 200 cand.", with_refine(ivf, xb, 2), xq, gt,
                         build_s, nb, a.n))
    t0 = time.perf_counter()
    ivf_flat = build_ivfflat(xb, nlist)
    ivf_flat.nprobe = 16
    rows.append(evaluate("IVF-Flat", f"nlist={nlist} nprobe=16", ivf_flat, xq, gt, time.perf_counter() - t0,
                         index_bytes(ivf_flat), a.n))
    del ivf_flat  # 4d bytes por vector: no tiene sentido tenerlo vivo durante el experimento de filtros

    print(f"\n{'índice':16s} {'parámetros':22s} {'R@10':>6s} {'R@100':>6s} {'build s':>8s} {'B/vector':>9s} {'p50 ms':>7s} {'p99 ms':>7s}")
    for r in rows:
        print(f"{r.name:16s} {r.params:22s} {r.r10:6.3f} {r.r100:6.3f} {r.build_s:8.1f} {r.bytes_per_vec:9.0f} {r.p50_ms:7.2f} {r.p99_ms:7.2f}")
    print("B/vector: tamaño serializado del índice ÷ n (en +refine, SIN los float32 del re-score, que van en EBS + page cache).")
    print("Latencia: 1 consulta a la vez, 1 hilo, k = 100, en esta máquina. No incluye red ni filtros.")

    for nv in a.filter_values:
        f = filtered_experiment(hnsw["HNSW-Flat"], xb, xq, nv)
        print(f"\nFiltro: {f['selectivity']:.1%} del catálogo ({f['subset_size']:,.0f} vectores), k = 48 (una página):")
        print(f"  post-filtro sobre 200 candidatos: {f['post_filter_avg_results']:.1f} resultados en promedio; "
              f"{f['post_filter_empty_pages']:.0%} de las páginas VACÍAS")
        print(f"  filtro dentro del HNSW (efSearch=128): {f['in_search_avg_results']:.1f} resultados, "
              f"recall vs exacto filtrado {f['in_search_recall']:.3f}")
        print(f"  exacto sobre el subconjunto: {f['exact_subset_ms']:.3f} ms (mediana, numpy)")
        print(f"  over-fetch que necesitaría el post-filtro: 48 ÷ {f['selectivity']:.3f} ≈ {48 / f['selectivity']:,.0f} candidatos")

    print("\nExtrapolación a 100 M listings (fórmulas, d = 512, M = 32, PQ de 64 B) — memoria, no recall:")
    e = extrapolate(100_000_000, 512, a.M)  # siempre con la d del caso, aunque el benchmark use otra
    for k, label in [("flat", "float32 solos"), ("fp16", "float16 solos"), ("sq8", "int8 solos"),
                     ("pq", "códigos PQ64 solos"), ("graph", "grafo HNSW nivel 0"),
                     ("hnsw_flat", "HNSW-Flat"), ("hnsw_sq8", "HNSW-SQ8 (decisión)"),
                     ("hnsw_sq8_per_shard", "  ÷ 4 shards"), ("ivf_pq", "IVF-PQ64 (+ ids)")]:
        print(f"  {label:22s} {e[k]:7.1f} GB")
    print("  + float32 para el re-score (EBS, servidos desde el page cache): 204.8 GB en total (51.2 GB por shard)")
    print("\nAVISO: recall sintético ≠ recall real. Mide con tus embeddings (canary set, ANNRecallDrop).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
