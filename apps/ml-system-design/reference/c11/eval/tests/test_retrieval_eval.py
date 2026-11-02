"""Tests de la evaluación del retrieval: métricas a mano, validación del golden, fugas y el corpus ficticio completo."""

import json
from pathlib import Path

import pytest

from fakes import OverlapReranker
from fixture_loader import build_demo, load_identity
from hybrid import AclFilter, HybridRetriever
from retrieval_eval import GoldenItem, docs_at_k, evaluate, format_report, load_golden

GOLDEN = Path(__file__).resolve().parents[1] / "fixtures" / "golden_sample.jsonl"


@pytest.fixture
def anyio_backend():
    return "asyncio"


def fixed(results):
    async def retrieve(question, user):
        return results[(question, user)]
    return retrieve


def test_docs_at_k_dedupes_chunks_of_the_same_document():
    assert docs_at_k(["A", "A", "B", "C", "A"], 3) == ["A", "B"]


@pytest.mark.anyio
async def test_recall_and_mrr_by_hand():
    items = [GoldenItem("q1", "p", "u", "s1", "answerable", ("A", "B")),
             GoldenItem("q2", "p2", "u", "s2", "answerable", ("D",))]
    rep = await evaluate(items, fixed({("p", "u"): ["C", "A", "D"], ("p2", "u"): ["X", "Y"]}), k=8)
    assert rep.by_slice["s1"].recall == 0.5 and rep.by_slice["s1"].mrr == 0.5  # el ejemplo del docstring
    assert rep.by_slice["s2"].recall == 0.0 and rep.misses == ["q2"]
    assert rep.overall.recall == 0.25 and rep.overall.mrr == 0.25


@pytest.mark.anyio
async def test_a_leak_anywhere_blocks_even_with_perfect_recall():
    items = [GoldenItem("q1", "p", "ana", "s", "answerable", ("A",), ("SECRET",))]
    rep = await evaluate(items, fixed({("p", "ana"): ["A", "B", "C", "D", "E", "F", "G", "H", "SECRET"]}), k=8)
    assert rep.overall.recall == 1.0
    ok, reasons = rep.gate()
    assert not ok and rep.leaks == [("q1", "SECRET")] and "fuga" in reasons[0]  # en la posición 9 también cuenta


@pytest.mark.anyio
async def test_gate_ignores_tiny_slices_but_not_the_total():
    items = [GoldenItem(f"q{i}", f"p{i}", "u", "chico" if i < 3 else "grande", "answerable", ("A",))
             for i in range(40)]
    res = {(f"p{i}", "u"): ([] if i < 3 else ["A"]) for i in range(40)}
    rep = await evaluate(items, fixed(res))
    ok, reasons = rep.gate(min_recall=0.9, min_slice_recall=0.7, min_slice_n=30)
    assert ok, reasons  # el slice "chico" tiene recall 0 con n = 3: se reporta, no bloquea; el total es 0.925


@pytest.mark.parametrize("line", [
    {"qid": "x", "question": "q", "user": "u", "slice": "s", "kind": "answerable"},  # sin expected
    {"qid": "x", "question": "q", "user": "u", "slice": "s", "kind": "unanswerable", "expected_doc_ids": ["A"]},
    {"qid": "x", "question": "q", "user": "u", "slice": "s", "kind": "permission"},  # sin forbidden
    {"qid": "x", "question": "q", "user": "u", "slice": "s", "kind": "otro"},
    {"qid": "x", "question": "q", "user": "u", "slice": "s", "kind": "answerable", "expected_doc_ids": ["A"],
     "forbidden_doc_ids": ["A"]},
])
def test_golden_validation_rejects_inconsistent_lines(line):
    with pytest.raises(ValueError):
        load_golden([json.dumps(line)])


def test_duplicate_qid_is_rejected():
    line = json.dumps({"qid": "x", "question": "q", "user": "u", "slice": "s", "kind": "unanswerable"})
    with pytest.raises(ValueError):
        load_golden([line, line])


@pytest.mark.anyio
async def test_sample_golden_on_the_fictitious_corpus_passes_with_zero_leaks():
    index, embedder, data, _ = build_demo()
    ident = load_identity(data, 0.0)
    retriever = HybridRetriever(index, index, embedder, OverlapReranker())

    async def retrieve(question, email):
        res = await retriever.retrieve(question, AclFilter(ident.principals_for(email)))
        return [c.record.doc_id for c in res.chunks]

    items = load_golden(GOLDEN.read_text(encoding="utf-8").splitlines())
    rep = await evaluate(items, retrieve)
    assert rep.leaks == []
    assert rep.overall.recall == 1.0 and rep.overall.n == 8
    ok, reasons = rep.gate(min_slice_n=1)
    assert ok, reasons
    assert "fugas de permisos: 0" in format_report(rep)
