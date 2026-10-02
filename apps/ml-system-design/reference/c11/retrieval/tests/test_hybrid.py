"""Tests del retrieval: el filtro de ACL antes del top-k (y el anti-patrón), RRF, reranker, degradación y top-8."""

import random

import numpy as np
import pytest

from acl import OPEN, DocumentACL
from fakes import HashingEmbedder, OverlapReranker
from fixture_loader import build_demo, load_identity
from hybrid import (AclFilter, ChunkRecord, Hit, HybridRetriever, InMemoryIndex, RetrievalConfig,
                    RetrievalUnavailable, opensearch_hybrid_body, post_filtered, rrf)


@pytest.fixture
def anyio_backend():
    return "asyncio"


EMB = HashingEmbedder()


def rec(cid, doc, text, clause):
    fields = DocumentACL.from_clauses([clause]).index_fields()
    return ChunkRecord(cid, doc, "confluence", doc, f"https://w/{doc}", "2026-01-01", (doc,), text, fields,
                       EMB.embed([text])[0], EMB.model_version)


def acl_of(*principals):
    return AclFilter(frozenset({OPEN, *principals}))


SOPORTE = "group:google:soporte@acme.com"
FINANZAS = "group:google:finanzas@acme.com"


@pytest.fixture
def skewed_index():
    """60 chunks de Finanzas que hablan MUCHO de bonos y 3 de Soporte que también los mencionan."""
    idx = InMemoryIndex()
    idx.upsert([rec(f"f{i}", f"fin-{i}", f"bono trimestral bono anual bono de Finanzas cierre {i}", {FINANZAS})
                for i in range(60)])
    idx.upsert([rec(f"s{i}", f"sop-{i}", f"el bono de reconocimiento para agentes de soporte nivel {i}", {SOPORTE})
                for i in range(3)])
    return idx


# ---------------------------------------------------------------- la trampa del post-filtering
def test_post_filtering_starves_restricted_users(skewed_index):
    ana = acl_of(SOPORTE)
    top50_unfiltered = skewed_index._bm25("bono", 50, None, prefilter=False)
    assert len(post_filtered(top50_unfiltered, ana)) == 0  # los 50 mejores eran de Finanzas: a ana no le queda nada
    pre = skewed_index._bm25("bono", 50, ana, prefilter=True)
    assert [h.record.chunk_id for h in pre] == ["s0", "s1", "s2"]  # con pre-filtro: lo que SÍ puede ver
    vec = EMB._vec("bono")
    assert len(post_filtered(skewed_index._knn(vec, 50, None, prefilter=False), ana)) == 0
    assert len(skewed_index._knn(vec, 50, ana, prefilter=True)) == 3


def test_prefilter_never_leaks_on_random_acls():
    rng = random.Random(7)
    groups = [f"group:google:g{i}@acme.com" for i in range(6)]
    idx = InMemoryIndex()
    words = ["reembolso", "viático", "bono", "pago", "oxxo", "llave", "rotación", "plazo"]
    records = []
    for i in range(300):
        clauses = [set(rng.sample(groups, rng.randint(1, 2))) for _ in range(rng.randint(1, 3))]
        text = " ".join(rng.choices(words, k=12))
        records.append(ChunkRecord(f"c{i}", f"d{i}", "drive", "t", "u", "", ("t",), text,
                                   DocumentACL.from_clauses(clauses).index_fields(), EMB.embed([text])[0], "hash-v1"))
    idx.upsert(records)
    for _ in range(40):
        principals = frozenset({OPEN, *rng.sample(groups, rng.randint(0, 3))})
        acl = AclFilter(principals)
        q = " ".join(rng.choices(words, k=3))
        for h in idx._bm25(q, 50, acl, True) + idx._knn(EMB._vec(q), 50, acl, True):
            # la regla escrita a mano, independiente de fields_allow: cada cláusula comparte un principal
            assert all(set(v) & principals for v in h.record.acl_fields.values())


# ---------------------------------------------------------------- RRF
def _hits(ids):
    return [Hit(ChunkRecord(i, i, "s", "t", "u", "", (), "", {}), 0.0) for i in ids]


def test_rrf_matches_hand_computation():
    fused = rrf({"bm25": _hits(["A", "B"]), "vector": _hits(["A"])}, k=60)
    assert fused[0].record.chunk_id == "A" and fused[0].rrf == pytest.approx(1 / 61 + 1 / 61)  # 1.º en las dos
    # el ejemplo de #c07: 20.º en las dos listas le gana al 1.º de una sola
    filler = [f"x{i}" for i in range(19)]
    fused = rrf({"a": _hits(["B", *filler[:18], "C"]), "b": _hits([*filler, "C"])}, k=60)
    scores = {f.record.chunk_id: f.rrf for f in fused}
    assert scores["C"] == pytest.approx(1 / 80 + 1 / 80)  # 20.º en las dos = 0.025
    assert scores["B"] == pytest.approx(1 / 61)  # 1.º en una sola = 0.0164
    assert scores["C"] > scores["B"]


def test_rrf_counts_duplicates_once_and_rejects_bad_k():
    fused = rrf({"bm25": _hits(["A", "A", "B"])}, k=60)
    assert [(f.record.chunk_id, f.ranks) for f in fused] == [("A", {"bm25": 1}), ("B", {"bm25": 2})]
    with pytest.raises(ValueError):
        rrf({}, k=0)


# ---------------------------------------------------------------- el retriever completo (corpus ficticio)
@pytest.fixture
def demo():
    index, embedder, data, outcomes = build_demo()
    ident = load_identity(data, taken_at=0.0)
    return index, embedder, ident, outcomes


@pytest.mark.anyio
async def test_end_to_end_answers_and_respects_permissions(demo):
    index, embedder, ident, _ = demo
    r = HybridRetriever(index, index, embedder, OverlapReranker())
    q = "¿Cómo se calcula el bono trimestral del equipo de Finanzas?"
    luis = await r.retrieve(q, AclFilter(ident.principals_for("luis@acme.com")))
    ana = await r.retrieve(q, AclFilter(ident.principals_for("ana@acme.com")))
    assert luis.chunks[0].record.doc_id == "drive:3001"
    assert "drive:3001" not in {c.record.doc_id for c in ana.chunks}
    assert ana.acl_violations == 0 and luis.acl_violations == 0
    assert len(luis.chunks) <= 8


@pytest.mark.anyio
async def test_link_only_document_was_never_indexed(demo):
    index, _, _, outcomes = demo
    assert outcomes["drive:3003"].action == "unindexed_no_access"
    assert not any(r.doc_id == "drive:3003" for r in index.records.values())


@pytest.mark.anyio
async def test_unknown_person_gets_nothing(demo):
    index, embedder, ident, _ = demo
    r = HybridRetriever(index, index, embedder)
    res = await r.retrieve("reembolso", AclFilter(ident.principals_for("nadie@acme.com")))
    assert res.chunks == [] and res.empty_reason == "no_candidates"


@pytest.mark.anyio
async def test_max_chunks_per_document():
    idx = InMemoryIndex()
    idx.upsert([rec(f"a{i}", "doc-a", f"reembolso plazo días parte {i}", {SOPORTE}) for i in range(6)])
    idx.upsert([rec(f"b{i}", f"doc-b{i}", f"reembolso plazo {i}", {SOPORTE}) for i in range(6)])
    res = await HybridRetriever(idx, idx, EMB, config=RetrievalConfig(max_per_doc=3)).retrieve(
        "reembolso plazo días", acl_of(SOPORTE))
    docs = [c.record.doc_id for c in res.chunks]
    assert len(docs) == 8 and docs.count("doc-a") == 3


@pytest.mark.anyio
async def test_degrades_to_one_list_and_fails_when_both_fail(demo):
    index, embedder, ident, _ = demo
    acl = AclFilter(ident.principals_for("ana@acme.com"))
    r = HybridRetriever(index, index, embedder)
    index.fail_vector = True
    res = await r.retrieve("viático diario Colombia", acl)
    assert res.degraded == ["bm25_only"] and res.chunks[0].record.doc_id == "drive:3002"
    index.fail_vector, index.fail_keyword = False, True
    res = await r.retrieve("viático diario Colombia", acl)
    assert res.degraded == ["vector_only"] and res.chunks
    index.fail_vector = True
    with pytest.raises(RetrievalUnavailable):
        await r.retrieve("viático diario Colombia", acl)


@pytest.mark.anyio
async def test_slow_list_times_out_and_is_dropped(demo):
    index, embedder, ident, _ = demo
    embedder.delay_s = 0.2
    r = HybridRetriever(index, index, embedder, config=RetrievalConfig(vector_timeout_s=0.05))
    res = await r.retrieve("viático Colombia", AclFilter(ident.principals_for("ana@acme.com")))
    assert res.degraded == ["bm25_only"] and res.chunks


@pytest.mark.anyio
async def test_reranker_failure_keeps_rrf_order(demo):
    index, embedder, ident, _ = demo
    acl = AclFilter(ident.principals_for("ana@acme.com"))
    base = await HybridRetriever(index, index, embedder).retrieve("reembolso plazo", acl)
    res = await HybridRetriever(index, index, embedder, OverlapReranker(fail=True)).retrieve("reembolso plazo", acl)
    assert res.degraded == ["rerank_skipped"]
    assert [c.record.chunk_id for c in res.chunks] == [c.record.chunk_id for c in base.chunks]
    slow = HybridRetriever(index, index, embedder, OverlapReranker(delay_s=0.2),
                           RetrievalConfig(rerank_timeout_s=0.05))
    assert (await slow.retrieve("reembolso plazo", acl)).degraded == ["rerank_skipped"]


@pytest.mark.anyio
async def test_rerank_threshold_can_empty_the_result(demo):
    index, embedder, ident, _ = demo
    r = HybridRetriever(index, index, embedder, OverlapReranker(), RetrievalConfig(min_rerank_score=0.9))
    res = await r.retrieve("código de vestimenta oficinas reembolso", AclFilter(ident.principals_for("ana@acme.com")))
    assert res.chunks == [] and res.empty_reason == "below_threshold"


@pytest.mark.anyio
async def test_a_leaky_index_is_caught_by_the_recheck(demo):
    index, embedder, ident, _ = demo

    class LeakyIndex:  # un índice con el filtro mal armado: ignora la ACL
        async def search(self, q, k, acl):
            return index._bm25(q, k, None, prefilter=False)

        async def knn(self, v, k, acl):
            return index._knn(v, k, None, prefilter=False)

    leaky = LeakyIndex()
    res = await HybridRetriever(leaky, leaky, embedder).retrieve(
        "bono trimestral Finanzas", AclFilter(ident.principals_for("ana@acme.com")))
    assert res.acl_violations > 0
    assert "drive:3001" not in {c.record.doc_id for c in res.chunks}


def test_opensearch_body_puts_the_acl_filter_inside_hybrid():
    acl = acl_of(SOPORTE)
    body = opensearch_hybrid_body("reembolso", np.zeros(4), acl, k=50)
    h = body["query"]["hybrid"]
    assert h["filter"] == acl.to_opensearch() and h["pagination_depth"] == 50
    assert [list(q) for q in h["queries"]] == [["match"], ["knn"]]
    assert "post_filter" not in body  # el anti-patrón


@pytest.mark.anyio
async def test_encoder_with_another_model_version_falls_back_to_bm25(demo):
    index, embedder, ident, _ = demo
    r = HybridRetriever(index, index, embedder, config=RetrievalConfig(index_model_version="hash-v2"))
    res = await r.retrieve("viático diario Colombia", AclFilter(ident.principals_for("ana@acme.com")))
    assert res.degraded == ["encoder_version_mismatch"] and res.chunks[0].record.doc_id == "drive:3002"


def test_excluded_sources_filter():
    acl = AclFilter(frozenset({OPEN, SOPORTE}), excluded_sources=frozenset({"drive"}))
    assert acl.to_opensearch()["bool"]["must_not"] == [{"terms": {"source": ["drive"]}}]
    r = rec("x", "doc-x", "texto", {SOPORTE})
    assert acl.matches(r) and not acl.matches(ChunkRecord(**{**r.__dict__, "source": "drive"}))
