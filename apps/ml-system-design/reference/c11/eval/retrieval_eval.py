"""Evaluación del retrieval (caso c11): recall@k y MRR por slice, y CERO fugas de permisos, desde un golden JSONL.

Por qué evaluar el retrieval aparte de la respuesta (#m14.rag): si el documento correcto no está en los 8 chunks
del prompt, ningún cambio de prompt ni de modelo lo arregla. Primero recall; después groundedness
(eval/groundedness.py).

Golden set del caso: ≈ 600 preguntas escritas con expertos de cada área, con los documentos que las contestan y
una respuesta de referencia; incluye preguntas sin respuesta en el corpus y PRUEBAS DE PERMISOS: la misma pregunta
hecha por personas con distinto acceso. Una línea del JSONL:

  {"qid": "p-07", "question": "¿Cómo se calcula el bono trimestral de Finanzas?", "user": "ana@acme.com",
   "slice": "finanzas", "kind": "permission", "expected_doc_ids": [], "forbidden_doc_ids": ["drive:3001"]}

  kind: answerable (expected_doc_ids no vacío) · unanswerable (nada en el corpus lo contesta) ·
        permission (la respuesta existe pero esta persona NO puede verla: expected vacío, forbidden no vacío)
  forbidden_doc_ids se puede poner en CUALQUIER tipo: "este documento no debe aparecer para esta persona".

Métricas, a nivel DOCUMENTO (lo que se cita es un documento; dos chunks del mismo documento no son dos aciertos):
  - docs@k = documentos de los primeros k chunks, en orden de primera aparición.
  - recall@k = |esperados ∩ docs@k| / |esperados|  (solo answerable)
  - MRR@k = 1 / posición del primer documento esperado en docs@k (0 si no aparece)  (solo answerable)
  - fugas = documentos prohibidos en lo devuelto, en CUALQUIER posición. Tolerancia cero: una fuga bloquea.
  - vacío en unanswerable/permission: qué fracción no devuelve nada (útil, no obligatorio: un chunk parecido
    puede salir y el modelo debe decir "no sé"; eso lo mide la evaluación de respuestas).

Ejemplo a mano (k = 8): esperados {A, B}; docs@8 = [C, A, D] → recall@8 = 1/2 = 0.5; MRR = 1/2 = 0.5.

Con ≈ 600 preguntas en ≈ 6–10 áreas quedan ≈ 60–100 por slice: un recall de 0.80 con 60 preguntas tiene un
intervalo de confianza ancho (± ≈ 0.1). Por eso el gate se pone sobre el total y los slices chicos se reportan sin
bloquear (min_slice_n).

Biblioteca estándar. `retrieve` es cualquier función async (pregunta, email) → [doc_id] en orden; en los tests es
el HybridRetriever real sobre el corpus ficticio.
"""

from __future__ import annotations  # anotaciones como texto

import json  # el JSONL
from collections import defaultdict  # agregación por slice
from collections.abc import Awaitable, Callable, Iterable, Sequence  # tipos
from dataclasses import dataclass, field  # items y reporte
from pathlib import Path  # leer el archivo

KINDS = ("answerable", "unanswerable", "permission")


@dataclass(frozen=True)
class GoldenItem:
    qid: str
    question: str
    user: str
    slice: str
    kind: str
    expected_doc_ids: tuple[str, ...] = ()
    forbidden_doc_ids: tuple[str, ...] = ()


def load_golden(lines: Iterable[str]) -> list[GoldenItem]:
    items: list[GoldenItem] = []
    seen: set[str] = set()
    for i, line in enumerate(lines, 1):
        if not line.strip():
            continue
        d = json.loads(line)
        item = GoldenItem(d["qid"], d["question"], d["user"], d["slice"], d["kind"],
                          tuple(d.get("expected_doc_ids", ())), tuple(d.get("forbidden_doc_ids", ())))
        # Un golden set con errores mide mal en silencio: se valida al cargar
        if item.qid in seen:
            raise ValueError(f"línea {i}: qid repetido {item.qid}")
        if item.kind not in KINDS:
            raise ValueError(f"línea {i}: kind inválido {item.kind}")
        if (item.kind == "answerable") != bool(item.expected_doc_ids):
            raise ValueError(f"línea {i}: answerable ⇔ expected_doc_ids no vacío")
        if item.kind == "permission" and not item.forbidden_doc_ids:
            raise ValueError(f"línea {i}: un caso de permisos necesita forbidden_doc_ids")
        if set(item.expected_doc_ids) & set(item.forbidden_doc_ids):
            raise ValueError(f"línea {i}: un documento no puede ser esperado y prohibido a la vez")
        seen.add(item.qid)
        items.append(item)
    return items


def docs_at_k(doc_ids: Sequence[str], k: int) -> list[str]:
    """Documentos de los primeros k chunks, sin repetir, en orden de primera aparición."""
    return list(dict.fromkeys(doc_ids[:k]))


@dataclass
class SliceStats:
    n: int = 0  # preguntas answerable
    recall_sum: float = 0.0
    rr_sum: float = 0.0

    @property
    def recall(self) -> float:
        return self.recall_sum / self.n if self.n else float("nan")

    @property
    def mrr(self) -> float:
        return self.rr_sum / self.n if self.n else float("nan")


@dataclass
class RetrievalReport:
    k: int
    overall: SliceStats = field(default_factory=SliceStats)
    by_slice: dict[str, SliceStats] = field(default_factory=lambda: defaultdict(SliceStats))
    leaks: list[tuple[str, str]] = field(default_factory=list)  # (qid, doc_id prohibido que apareció)
    misses: list[str] = field(default_factory=list)  # qids answerable con recall 0 (para revisar uno por uno)
    empty_when_no_answer: float = float("nan")  # fracción de unanswerable/permission sin resultados
    n_items: int = 0

    def gate(self, min_recall: float = 0.85, min_slice_recall: float = 0.70, min_slice_n: int = 30
             ) -> tuple[bool, list[str]]:
        """Umbrales ILUSTRATIVOS: se fijan con la primera medición y se suben, nunca se bajan para que pase."""
        reasons: list[str] = []
        if self.leaks:
            reasons.append(f"{len(self.leaks)} fuga(s) de permisos: {self.leaks[:3]}")
        if not self.overall.recall >= min_recall:  # `not >=` también atrapa NaN (cero preguntas answerable)
            reasons.append(f"recall@{self.k} = {self.overall.recall:.3f} < {min_recall}")
        for name, st in sorted(self.by_slice.items()):
            if st.n >= min_slice_n and st.recall < min_slice_recall:
                reasons.append(f"slice {name}: recall@{self.k} = {st.recall:.3f} < {min_slice_recall} (n={st.n})")
        return (not reasons), reasons


async def evaluate(items: Sequence[GoldenItem], retrieve: Callable[[str, str], Awaitable[list[str]]],
                   k: int = 8) -> RetrievalReport:
    rep = RetrievalReport(k=k, n_items=len(items))
    no_answer = empty = 0
    for it in items:
        returned = await retrieve(it.question, it.user)  # doc_id por chunk, en el orden del prompt
        for d in dict.fromkeys(returned):
            if d in it.forbidden_doc_ids:
                rep.leaks.append((it.qid, d))
        if it.kind != "answerable":
            no_answer += 1
            empty += not returned
            continue
        top = docs_at_k(returned, k)
        expected = set(it.expected_doc_ids)
        recall = len(expected & set(top)) / len(expected)
        rr = next((1.0 / i for i, d in enumerate(top, 1) if d in expected), 0.0)
        for st in (rep.overall, rep.by_slice[it.slice]):
            st.n += 1
            st.recall_sum += recall
            st.rr_sum += rr
        if recall == 0:
            rep.misses.append(it.qid)
    rep.empty_when_no_answer = empty / no_answer if no_answer else float("nan")
    return rep


def format_report(rep: RetrievalReport) -> str:
    lines = [f"preguntas: {rep.n_items} · answerable: {rep.overall.n}",
             f"recall@{rep.k}: {rep.overall.recall:.3f} · MRR@{rep.k}: {rep.overall.mrr:.3f}",
             f"fugas de permisos: {len(rep.leaks)}",
             f"sin resultados cuando no hay respuesta: {rep.empty_when_no_answer:.2f}"]
    for name, st in sorted(rep.by_slice.items()):
        lines.append(f"  {name:<12} n={st.n:<3} recall@{rep.k}={st.recall:.3f} MRR={st.mrr:.3f}")
    ok, reasons = rep.gate(min_slice_n=1)
    lines.append("gate: PASA" if ok else "gate: NO PASA — " + "; ".join(reasons))
    return "\n".join(lines)


def main() -> None:
    """Corre el golden de ejemplo contra el corpus ficticio (índice en memoria, fakes). Desde reference/c11:
    PYTHONPATH=ingest:retrieval python eval/retrieval_eval.py"""
    import asyncio  # solo para el CLI

    from fakes import OverlapReranker
    from fixture_loader import build_demo, load_identity
    from hybrid import AclFilter, HybridRetriever

    index, embedder, data, _ = build_demo()
    ident = load_identity(data, taken_at=0.0)
    retriever = HybridRetriever(index, index, embedder, OverlapReranker())

    async def retrieve(question: str, email: str) -> list[str]:
        res = await retriever.retrieve(question, AclFilter(ident.principals_for(email)))
        return [c.record.doc_id for c in res.chunks]

    golden = Path(__file__).resolve().parent / "fixtures" / "golden_sample.jsonl"
    items = load_golden(golden.read_text(encoding="utf-8").splitlines())
    print(format_report(asyncio.run(evaluate(items, retrieve))))


if __name__ == "__main__":
    main()
