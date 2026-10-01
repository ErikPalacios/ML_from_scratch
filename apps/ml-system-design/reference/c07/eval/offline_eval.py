"""Evaluación offline de la búsqueda (caso c07): NDCG@10 con etiquetas graduadas y recall@k.

Dos preguntas DISTINTAS que se confunden en entrevistas:
  1. ¿Los resultados son buenos para la persona?     → NDCG@10 y recall@k contra etiquetas HUMANAS (0–3)
  2. ¿El ANN encuentra lo mismo que la búsqueda exacta? → knn_recall_at_k: ANN vs brute force, SIN humanos
     (la meta del caso: ≥ 0.95 a k = 100 en el canary set). Un ANN perfecto con embeddings malos
     tiene knn-recall 1.0 y NDCG malo; son dos alertas distintas.

Etiquetas (qrels): cada (query, listing) juzgado por personas con un grado:
  0 = no relevante · 1 = algo relacionado · 2 = relevante · 3 = justo lo que buscaba

NDCG@k (ganancia exponencial, la de Burges et al. 2005; la original de Järvelin y Kekäläinen 2002 es lineal):
    DCG@k  = Σ_{i=1..k} (2^grado_i − 1) / log2(i + 1)        i = posición, empieza en 1
    IDCG@k = DCG@k del orden IDEAL: todos los grados JUZGADOS de esa query ordenados de mayor a menor
             (no solo los que el sistema recuperó: si no, un sistema que no encuentra el "3" no se castiga)
    NDCG@k = DCG@k / IDCG@k ∈ [0, 1]
  Ejemplo a mano: juzgados {A: 3, B: 2}; el sistema devuelve [X, A] con X sin juzgar (= 0):
    DCG = 0 + 7/log2(3) = 4.4165 · IDCG = 7/log2(2) + 3/log2(3) = 7 + 1.8928 = 8.8928 → NDCG = 0.4966
  Query sin ningún grado > 0: IDCG = 0 → NDCG indefinido → se EXCLUYE del promedio y se cuenta aparte.

Trampa de los no juzgados: un sistema NUEVO recupera listings que nadie etiquetó; contarlos como 0 lo
castiga aunque sean buenos. Por eso se reporta judged@10 (qué fracción del top-10 tiene etiqueta): si
el sistema nuevo tiene judged@10 mucho menor que el actual, etiqueta esos huecos antes de concluir.

Intervalo: bootstrap por QUERIES (se remuestrean queries, no resultados) con percentiles. Para comparar
dos sistemas, bootstrap PAREADO de la diferencia (mismas queries remuestreadas para los dos): mucho más
angosto que comparar dos intervalos separados.

Solo biblioteca estándar. CLI: python offline_eval.py qrels.jsonl run.jsonl [--baseline run_a.jsonl]
"""

from __future__ import annotations  # anotaciones como texto

import argparse  # CLI mínima
import json  # qrels y runs en JSONL
import math  # log2
import random  # bootstrap con semilla (reproducible)
from collections import defaultdict  # agrupar por query / segmento
from collections.abc import Mapping, Sequence  # tipos
from dataclasses import dataclass  # resultado con intervalo

RELEVANT_MIN_GRADE = 2  # para recall@k: "relevante" = grado ≥ 2 (el 1 es "algo relacionado")


# ---------------------------------------------------------------------------- métricas por query
def dcg_at_k(grades_in_order: Sequence[int], k: int) -> float:
    """DCG con ganancia exponencial. grades_in_order = grado de cada posición (0 si no está juzgado)."""
    return sum((2**g - 1) / math.log2(i + 1) for i, g in enumerate(grades_in_order[:k], start=1))


def ndcg_at_k(ranked: Sequence[str], judged: Mapping[str, int], k: int = 10) -> float | None:
    """NDCG@k de UNA query. judged = {listing_id: grado} (todos los juzgados de esa query).

    Devuelve None si la query no tiene ningún grado > 0 (no hay nada que encontrar: indefinido).
    """
    ideal = dcg_at_k(sorted(judged.values(), reverse=True), k)
    if ideal == 0:
        return None
    return dcg_at_k([judged.get(d, 0) for d in _dedupe(ranked)], k) / ideal


def recall_at_k(ranked: Sequence[str], judged: Mapping[str, int], k: int,
                min_grade: int = RELEVANT_MIN_GRADE) -> float | None:
    """Fracción de los relevantes JUZGADOS (grado ≥ min_grade) que aparecen en el top-k. None si no hay."""
    relevant = {d for d, g in judged.items() if g >= min_grade}
    if not relevant:
        return None
    return len(relevant & set(_dedupe(ranked)[:k])) / len(relevant)


def judged_at_k(ranked: Sequence[str], judged: Mapping[str, int], k: int = 10) -> float:
    """Qué fracción del top-k tiene etiqueta humana (la cobertura que hace creíble a NDCG)."""
    top = _dedupe(ranked)[:k]
    return sum(d in judged for d in top) / len(top) if top else 0.0


def knn_recall_at_k(approx: Sequence[str | int], exact: Sequence[str | int], k: int) -> float:
    """Recall del ANN contra brute force: |top-k aproximado ∩ top-k exacto| / k. No usa humanos.

    Ojo: si la query tiene menos de k vecinos posibles (filtro muy selectivo), el denominador es lo que
    el exacto encontró, no k.
    """
    truth = list(exact)[:k]
    if not truth:
        return 1.0  # nada que encontrar: el ANN no se equivocó
    return len(set(list(approx)[:k]) & set(truth)) / len(truth)


def _dedupe(ranked: Sequence[str]) -> list[str]:
    # Un id repetido en el run (bug de fusión) no debe sumar ganancia dos veces.
    seen: set[str] = set()
    return [d for d in ranked if not (d in seen or seen.add(d))]


# ---------------------------------------------------------------------------- agregados con intervalo
@dataclass(frozen=True)
class Estimate:
    mean: float
    low: float  # percentil 2.5 del bootstrap
    high: float  # percentil 97.5
    n: int  # queries que entran al promedio

    def __str__(self) -> str:
        return f"{self.mean:.4f} [{self.low:.4f}, {self.high:.4f}] (n={self.n})"


def bootstrap_mean(values: Sequence[float], n_boot: int = 2000, seed: int = 0,
                   alpha: float = 0.05) -> Estimate:
    """Media con intervalo bootstrap percentil. Remuestrea QUERIES con reemplazo."""
    vals = list(values)
    if not vals:
        return Estimate(float("nan"), float("nan"), float("nan"), 0)
    rng = random.Random(seed)  # semilla fija: el mismo reporte da el mismo intervalo
    n = len(vals)
    means = sorted(sum(rng.choice(vals) for _ in range(n)) / n for _ in range(n_boot))
    lo = means[int(alpha / 2 * n_boot)]
    hi = means[min(n_boot - 1, int((1 - alpha / 2) * n_boot))]
    return Estimate(sum(vals) / n, lo, hi, n)


def per_query(run: Mapping[str, Sequence[str]], qrels: Mapping[str, Mapping[str, int]],
              k_ndcg: int = 10, k_recall: int = 48) -> dict[str, dict[str, float | None]]:
    """Métricas por query. Solo cuentan las queries que tienen etiquetas (qrels).

    Una query etiquetada que el sistema no devolvió (falta en el run) cuenta como lista VACÍA (NDCG 0),
    no se salta: saltarla premiaría a un sistema que falla en las queries difíciles.
    k_recall = 48: una página de resultados del caso.
    """
    out = {}
    for qid, judged in qrels.items():
        ranked = run.get(qid, [])
        out[qid] = {
            "ndcg@10": ndcg_at_k(ranked, judged, k_ndcg),
            f"recall@{k_recall}": recall_at_k(ranked, judged, k_recall),
            "judged@10": judged_at_k(ranked, judged, 10),
        }
    return out


def summarize(per_q: Mapping[str, Mapping[str, float | None]], segments: Mapping[str, str] | None = None,
              n_boot: int = 2000, seed: int = 0) -> dict[str, dict[str, Estimate | int]]:
    """Promedio + intervalo por métrica, total y por segmento (head/torso/tail).

    Por qué por segmento: el promedio lo dominan las queries head (muchas, fáciles); un cambio que
    mejora head y destruye tail puede subir el total. Las queries tail son justo donde la búsqueda
    semántica debía ayudar (vocabulario raro, cero resultados con BM25).
    """
    groups: dict[str, list[str]] = defaultdict(list)
    for qid in per_q:
        groups["all"].append(qid)
        if segments and qid in segments:
            groups[segments[qid]].append(qid)
    report: dict[str, dict[str, Estimate | int]] = {}
    for g, qids in groups.items():
        metrics = {m for q in qids for m in per_q[q]}
        rep: dict[str, Estimate | int] = {}
        for m in sorted(metrics):
            vals = [per_q[q][m] for q in qids if per_q[q][m] is not None]
            rep[m] = bootstrap_mean(vals, n_boot, seed)
            rep[m + ":excluded"] = sum(per_q[q][m] is None for q in qids)  # queries sin nada relevante
        report[g] = rep
    return report


def paired_difference(a: Mapping[str, float | None], b: Mapping[str, float | None],
                      n_boot: int = 2000, seed: int = 0) -> Estimate:
    """Diferencia media B − A sobre las MISMAS queries (las que tienen valor en las dos).

    Si el intervalo no cruza 0, la diferencia es consistente en este set de queries (no dice nada de
    queries que no están en el set: por eso el set sale de logs recientes y se renueva).
    """
    common = [q for q in a if q in b and a[q] is not None and b[q] is not None]
    return bootstrap_mean([b[q] - a[q] for q in common], n_boot, seed)


# ---------------------------------------------------------------------------- I/O (separado de la lógica)
def load_qrels(path: str) -> tuple[dict[str, dict[str, int]], dict[str, str]]:
    """JSONL: {"query_id", "listing_id", "grade" (0–3), "segment"?: "head"|"torso"|"tail"}."""
    qrels: dict[str, dict[str, int]] = defaultdict(dict)
    segments: dict[str, str] = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            r = json.loads(line)
            g = int(r["grade"])
            if not 0 <= g <= 3:
                raise ValueError(f"grado fuera de 0–3: {r}")  # un 5 inflaría DCG en silencio (2^5 − 1 = 31)
            qrels[r["query_id"]][r["listing_id"]] = g
            if r.get("segment"):
                segments[r["query_id"]] = r["segment"]
    return dict(qrels), segments


def load_run(path: str) -> dict[str, list[str]]:
    """JSONL: {"query_id", "ranked": [listing_id, ...]} — lo que devolvió el sistema, mejor primero."""
    with open(path, encoding="utf-8") as f:
        return {r["query_id"]: list(r["ranked"]) for r in map(json.loads, filter(str.strip, f))}


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="NDCG@10 / recall@48 con intervalo bootstrap")
    ap.add_argument("qrels")
    ap.add_argument("run")
    ap.add_argument("--baseline", help="run del sistema actual: imprime la diferencia pareada")
    args = ap.parse_args(argv)
    qrels, segments = load_qrels(args.qrels)
    pq = per_query(load_run(args.run), qrels)
    for g, rep in summarize(pq, segments).items():
        for m, v in rep.items():
            print(f"{g:6s} {m:24s} {v}")
    if args.baseline:
        base = per_query(load_run(args.baseline), qrels)
        diff = paired_difference({q: v["ndcg@10"] for q, v in base.items()},
                                 {q: v["ndcg@10"] for q, v in pq.items()})
        print(f"Δ NDCG@10 (run − baseline): {diff}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
