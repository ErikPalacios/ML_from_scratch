"""Tests de la ingesta incremental: qué se re-embebe, qué no, tombstones, replays, ACL-only y los frenos."""

import pytest
from prometheus_client import CollectorRegistry

from acl import AclResult, DocumentACL, drive_acl
from chunker import Chunker, from_markdown
from fakes import HashingEmbedder
from hybrid import AclFilter, InMemoryIndex
from incremental import (ChangeEvent, InMemoryState, Ingestor, MassDeletionGuard, MassDeletionSuspected,
                         ModelMismatch)
from metrics import IngestMetrics

SOPORTE = AclResult(DocumentACL.from_clauses([{"group:google:soporte@acme.com"}]))
FINANZAS = AclResult(DocumentACL.from_clauses([{"group:google:finanzas@acme.com"}]))
ANA = AclFilter(frozenset({"user:ana@acme.com", "group:google:soporte@acme.com", "acl:open"}))
BODY = ("# Plazo\nUn comprador puede pedir el reembolso hasta 30 días después de la entrega.\n\n"
        "# Monto\nEl monto máximo sin aprobación es US$50.\n\n# Pago\nVuelve al medio de pago en 5 a 10 días.")


def ev(version, body=BODY, acl=SOPORTE, observed_at=100.0, deleted=False, changed_at=None, url="https://w/1"):
    return ChangeEvent("confluence", "confluence:1", version, observed_at, deleted,
                       None if deleted else from_markdown("confluence:1", "Reembolsos", body),
                       None if deleted else acl, url, "2026-07-01T10:00:00Z", changed_at)


@pytest.fixture
def setup():
    index, emb = InMemoryIndex(), HashingEmbedder()
    ing = Ingestor(Chunker(), emb, index, InMemoryState(), clock=lambda: 160.0)
    return ing, index, emb


def test_create_then_replay_is_idempotent(setup):
    ing, index, emb = setup
    out = ing.apply(ev(1))
    assert out.action == "created" and out.embedded == 3 and len(index.records) == 3
    assert out.lag_s == 60.0  # 160 − observed_at (la fuente no dio la hora del cambio)
    assert ing.apply(ev(1)).action == "stale"  # el mismo evento otra vez (at-least-once)
    assert emb.calls == 3


def test_older_event_after_newer_is_ignored(setup):
    ing, index, _ = setup
    ing.apply(ev(2, body=BODY.replace("30 días", "45 días")))
    assert ing.apply(ev(1)).action == "stale"  # el v1 atrasado no pisa al v2
    assert any("45 días" in r.text for r in index.records.values())


def test_edit_reembeds_only_changed_chunks(setup):
    ing, index, emb = setup
    ing.apply(ev(1))
    out = ing.apply(ev(2, body=BODY.replace("US$50", "US$60")))
    assert out.action == "reindexed" and (out.embedded, out.kept, out.deleted) == (1, 2, 1)
    assert emb.calls == 3 + 1
    assert any("US$60" in r.text for r in index.records.values())
    assert not any("US$50" in r.text for r in index.records.values())


def test_acl_only_change_updates_metadata_without_embedding(setup):
    ing, index, emb = setup
    ing.apply(ev(1))
    assert len(index._knn(emb._vec("reembolso"), 10, ANA, prefilter=True)) == 3
    # Confluence: cambiar restricciones NO cambia la versión de la página → misma versión, observado después
    out = ing.apply(ev(1, acl=FINANZAS, observed_at=200.0))
    assert out.action == "acl_updated" and out.embedded == 0 and emb.calls == 3
    assert index._knn(emb._vec("reembolso"), 10, ANA, prefilter=True) == []  # revocado: ana ya no lo ve


def test_same_content_and_acl_is_unchanged(setup):
    ing, _, emb = setup
    ing.apply(ev(1))
    assert ing.apply(ev(2)).action == "unchanged"  # el autor guardó sin cambiar nada
    assert emb.calls == 3


def test_delete_leaves_a_tombstone_that_blocks_late_upserts(setup):
    ing, index, _ = setup
    ing.apply(ev(1))
    out = ing.apply(ev(2, deleted=True))
    assert out.action == "tombstoned" and out.deleted == 3 and index.records == {}
    assert ing.apply(ev(1, observed_at=300.0)).action == "stale"  # el upsert v1 que llegó tarde NO resucita
    assert ing.apply(ev(3)).action == "created"  # restaurado de la papelera con versión nueva: sí


def test_losing_every_grant_removes_the_document(setup):
    ing, index, _ = setup
    ing.apply(ev(1))
    link_only = drive_acl([{"type": "anyone", "role": "reader", "allowFileDiscovery": False}], "acme.com")
    out = ing.apply(ev(2, acl=link_only))
    assert out.action == "unindexed_no_access" and index.records == {}
    out = ing.apply(ev(3))  # vuelve a tener permisos: se re-chunkea y se re-embebe
    assert out.action == "reindexed" and out.embedded == 3


def test_acl_too_complex_fails_closed(setup):
    ing, index, _ = setup
    four = AclResult(DocumentACL.from_clauses([{f"user:{i}@acme.com"} for i in range(4)]))
    assert ing.apply(ev(1, acl=four)).action == "unindexed_acl_too_complex"
    assert index.records == {}


def test_url_change_reaches_kept_chunks(setup):
    ing, index, _ = setup
    ing.apply(ev(1))
    out = ing.apply(ev(2, url="https://w/1-movida"))
    assert out.action == "reindexed" and out.embedded == 0  # el texto no cambió: cero GPU
    assert {r.url for r in index.records.values()} == {"https://w/1-movida"}


def test_lag_uses_source_change_time_when_available(setup):
    ing, _, _ = setup
    assert ing.apply(ev(1, changed_at=40.0)).lag_s == 120.0


def test_refuses_to_mix_embedding_models(setup):
    ing, index, _ = setup
    ing.apply(ev(1))
    ing2 = Ingestor(Chunker(), HashingEmbedder(model_version="hash-v2"), index, ing.state)
    with pytest.raises(ModelMismatch):
        ing2.apply(ev(2, body=BODY + "\n\nOtro párrafo."))


def test_mass_deletion_guard():
    guard = MassDeletionGuard({"drive": 1000, "policies": 300})
    deletes = [ChangeEvent("drive", f"drive:{i}", 2, 1.0, deleted=True) for i in range(60)]
    with pytest.raises(MassDeletionSuspected) as e:
        guard.check(deletes)  # 6 % de la fuente en un lote: token vencido, no una limpieza
    assert e.value.source == "drive" and guard.blocked == {"drive": 60}
    guard.check(deletes[:15])  # 1.5 %: normal
    guard.check([ChangeEvent("policies", f"p:{i}", 2, 1.0, deleted=True) for i in range(10)])  # < min_deletes


def test_metrics_skip_stale_lag(setup):
    ing, _, _ = setup
    reg = CollectorRegistry()
    m = IngestMetrics(reg)
    m.observe("confluence", "content", ing.apply(ev(1)))
    m.observe("confluence", "content", ing.apply(ev(1)))  # replay
    assert reg.get_sample_value("rag_ingest_events_total", {"source": "confluence", "action": "created"}) == 1
    assert reg.get_sample_value("rag_ingest_events_total", {"source": "confluence", "action": "stale"}) == 1
    assert reg.get_sample_value("rag_ingest_lag_seconds_count", {"source": "confluence", "kind": "content"}) == 1
    assert reg.get_sample_value("rag_ingest_chunks_embedded_total", {"source": "confluence"}) == 3
