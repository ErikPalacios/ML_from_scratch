"""Tests de indexing/embed_worker.py con fakes de Kafka, GPU, índice y stores.

Cada test es una situación real: duplicados, desorden, vendido que no resucita, cambio de precio que
no re-embebe, veneno en la DLQ, modelo distinto, GPU que falla.
"""

import json
from pathlib import Path

import numpy as np
import pytest
from prometheus_client import CollectorRegistry

import embed_worker as ew

DIM = 8


# ---------------------------------------------------------------------------- fakes
class FakeConsumer:
    def __init__(self, batches):
        self.batches = list(batches)
        self.committed = []

    def poll(self, max_records, timeout_s):
        return self.batches.pop(0) if self.batches else []

    def commit(self, messages):
        self.committed.extend(m.offset for m in messages)

    def backlog(self):
        return sum(len(b) for b in self.batches)


class FakeEmbedder:
    def __init__(self, version="v1", fail_times=0, bad_ids=()):
        self.model_version, self.dim = version, DIM
        self.calls = []
        self.fail_times = fail_times
        self.bad = set(bad_ids)  # textos que devuelven NaN (simula un bug de preprocesamiento)

    def embed(self, texts, photo_uris):
        if self.fail_times:
            self.fail_times -= 1
            raise TimeoutError("GPU ocupada")
        self.calls.append(list(texts))
        rng = np.random.default_rng(len(texts))
        v = rng.normal(size=(len(texts), DIM)).astype(np.float32)
        v /= np.linalg.norm(v, axis=1, keepdims=True)
        for i, t in enumerate(texts):
            if any(b in t for b in self.bad):
                v[i] = np.nan
        return v


class FakeIndex:
    def __init__(self, version="v1"):
        self.model_version, self.dim = version, DIM
        self.vectors, self.attrs, self.deleted = {}, {}, set()

    def upsert(self, ids, vectors, attrs, model_version):
        assert model_version == self.model_version  # el adaptador real también lo verifica
        for i, v, a in zip(ids, vectors, attrs):
            self.vectors[i], self.attrs[i] = v, a
            self.deleted.discard(i)

    def update_attributes(self, listing_id, attrs):
        self.attrs[listing_id] = attrs

    def mark_deleted(self, ids):
        self.deleted.update(ids)


class FakeTombstones:
    def __init__(self):
        self.ids = {}

    def add(self, ids_ts):
        self.ids.update(ids_ts)

    def discard(self, ids):
        for i in ids:
            self.ids.pop(i, None)


class FakeStates:
    def __init__(self):
        self.s = {}

    def get_many(self, ids):
        return {i: self.s[i] for i in ids if i in self.s}

    def put_many(self, states):
        for k, v in states.items():
            if k not in self.s or v.version > self.s[k].version:  # compare-and-set
                self.s[k] = v


class FakeDLQ:
    def __init__(self):
        self.sent = []

    def send(self, message, reason):
        self.sent.append((message.offset, reason))


_offset = iter(range(10**6))


def msg(listing_id, version, type_, ts=1000.0, **kw):
    body = {"listing_id": listing_id, "event_version": version, "type": type_, "ts": ts, **kw}
    if type_ in ("created", "updated"):
        body.setdefault("title", f"chamarra {listing_id}")
    return ew.Message(partition=0, offset=next(_offset), value=json.dumps(body).encode())


def make(batches, embedder=None, index=None, now=1030.0):
    reg = CollectorRegistry()
    w = ew.Worker(
        consumer=FakeConsumer(batches), embedder=embedder or FakeEmbedder(), index=index or FakeIndex(),
        tombstones=FakeTombstones(), states=FakeStates(), dlq=FakeDLQ(), metrics=ew.Metrics(reg),
        clock=lambda: now, sleep=lambda s: None,
    )
    return w, reg


def val(reg, name, **labels):
    return reg.get_sample_value(name, labels) or 0.0


# ---------------------------------------------------------------------------- tests
def test_created_embebe_y_hace_upsert_con_atributos_de_filtro():
    w, reg = make([[msg("L1", 1, "created", attributes={"price": 500, "city": "GDL", "brand": "Levi's"})]])
    assert w.run_once() == 1
    assert "L1" in w.index.vectors
    assert w.index.attrs["L1"] == {"price": 500, "city": "GDL"}  # brand va al texto, no a los filtros
    assert "brand: Levi's" in w.embedder.calls[0][0]
    assert w.consumer.committed  # commit DESPUÉS de escribir
    assert val(reg, "embed_worker_upserts_total") == 1
    assert val(reg, "embed_worker_index_freshness_seconds_count", op="upsert") == 1
    assert val(reg, "embed_worker_event_lag_seconds") == 30.0


def test_duplicado_no_reprocesa():
    m = msg("L1", 1, "created")
    w, reg = make([[m], [m]])
    w.run_once()
    w.run_once()
    assert len(w.embedder.calls) == 1
    assert val(reg, "embed_worker_events_total", type="created", outcome="stale") == 1


def test_updated_atrasado_no_resucita_un_vendido():
    w, _ = make([[msg("L1", 1, "created")], [msg("L1", 5, "sold")], [msg("L1", 4, "updated", title="otro")]])
    for _ in range(3):
        w.run_once()
    assert "L1" in w.tombstones.ids  # sigue oculto
    assert "L1" in w.index.deleted
    assert w.states.s["L1"] == ew.ListingState(5, "gone")
    assert len(w.embedder.calls) == 1  # el v4 atrasado ni siquiera llegó a la GPU


def test_version_mas_nueva_reactiva_un_removido():
    # Moderación lo quitó (v2) y una apelación lo devolvió (v3)
    w, _ = make([[msg("L1", 1, "created")], [msg("L1", 2, "removed")], [msg("L1", 3, "updated")]])
    for _ in range(3):
        w.run_once()
    assert "L1" not in w.tombstones.ids and "L1" not in w.index.deleted
    assert w.states.s["L1"].status == "live"
    assert len(w.embedder.calls) == 2  # estaba "gone": se re-escribe aunque el contenido sea igual


def test_dentro_del_batch_gana_la_version_mas_alta():
    w, reg = make([[msg("L1", 1, "created"), msg("L1", 2, "sold")]])
    w.run_once()
    assert w.embedder.calls == []  # no se embebe algo que ya se vendió
    assert "L1" in w.tombstones.ids
    assert val(reg, "embed_worker_events_total", type="created", outcome="superseded") == 1


def test_cambio_de_precio_no_re_embebe():
    w, reg = make([[msg("L1", 1, "created", attributes={"price": 500})],
                   [msg("L1", 2, "updated", attributes={"price": 450})]])
    w.run_once()
    w.run_once()
    assert len(w.embedder.calls) == 1
    assert w.index.attrs["L1"] == {"price": 450}
    assert val(reg, "embed_worker_attribute_updates_total") == 1


def test_cambio_de_titulo_si_re_embebe():
    w, _ = make([[msg("L1", 1, "created")], [msg("L1", 2, "updated", title="chamarra de mezclilla talla M")]])
    w.run_once()
    w.run_once()
    assert len(w.embedder.calls) == 2


def test_tombstone_mide_su_propia_frescura():
    w, reg = make([[msg("L1", 1, "sold", ts=1000.0)]], now=1045.0)
    w.run_once()
    assert val(reg, "embed_worker_tombstones_total") == 1
    # 45 s cae en el bucket ≤ 60 (el SLO de vendidos) y no en el ≤ 30
    assert val(reg, "embed_worker_index_freshness_seconds_bucket", op="tombstone", le="60.0") == 1
    assert val(reg, "embed_worker_index_freshness_seconds_bucket", op="tombstone", le="30.0") == 0


def test_mensaje_envenenado_va_a_la_dlq_y_no_frena_el_batch():
    bad = ew.Message(0, next(_offset), b"{no es json")
    w, reg = make([[bad, msg("L2", 1, "created")]])
    w.run_once()
    assert w.dlq.sent[0][1].startswith("invalid_event")
    assert "L2" in w.index.vectors
    assert bad.offset in w.consumer.committed  # se commitea: no se reintenta para siempre
    assert val(reg, "embed_worker_dead_letter_total", reason="invalid_event") == 1


def test_vector_nan_va_a_la_dlq_y_el_resto_se_escribe():
    w, reg = make([[msg("L1", 1, "created", title="roto"), msg("L2", 1, "created")]],
                  embedder=FakeEmbedder(bad_ids=("roto",)))
    w.run_once()
    assert "L1" not in w.index.vectors and "L2" in w.index.vectors
    assert "L1" not in w.states.s  # sin estado: un evento futuro del L1 se va a procesar
    assert val(reg, "embed_worker_dead_letter_total", reason="invalid_vector") == 1


def test_modelo_distinto_no_arranca():
    with pytest.raises(ew.ModelVersionMismatch):
        make([[]], embedder=FakeEmbedder("v2"), index=FakeIndex("v1"))


def test_modelo_recargado_en_caliente_se_detecta_antes_de_escribir():
    emb = FakeEmbedder("v1")
    w, _ = make([[msg("L1", 1, "created")]], embedder=emb)
    emb.model_version = "v2"  # alguien recargó otro modelo en el pod
    with pytest.raises(ew.ModelVersionMismatch):
        w.run_once()
    assert w.index.vectors == {} and w.consumer.committed == []  # nada escrito, nada commiteado


def test_error_transitorio_de_gpu_se_reintenta():
    w, _ = make([[msg("L1", 1, "created")]], embedder=FakeEmbedder(fail_times=2))
    w.run_once()
    assert "L1" in w.index.vectors


def test_gpu_caida_no_commitea():
    w, _ = make([[msg("L1", 1, "created")]], embedder=FakeEmbedder(fail_times=10))
    with pytest.raises(TimeoutError):
        w.run_once()
    assert w.consumer.committed == []  # al reiniciar, Kafka lo vuelve a entregar
    assert w.states.s == {}


def test_backlog_se_publica():
    w, reg = make([[msg("L1", 1, "created")], [msg("L2", 1, "created")]])
    w.run_once()
    assert val(reg, "embed_worker_backlog_messages") == 1


def test_contrato_de_metricas_con_alerts_yml():
    # Cada métrica embed_worker_* que usan las alertas debe existir en el worker.
    import re

    alerts = (Path(__file__).resolve().parents[2] / "monitoring" / "alerts.yml").read_text()
    # (?<![:\w]): ignora los nombres de recording rules (search:embed_worker_lag_seconds no es una métrica)
    used = set(re.findall(r"(?<![:\w])(embed_worker_[a-z_]+?)(?:_bucket|_count|_sum)?\b", alerts))
    reg = CollectorRegistry()
    ew.Metrics(reg)
    exported = {m.name for m in reg.collect()} | {m.name + "_total" for m in reg.collect()}
    assert used, "alerts.yml debería usar métricas del worker"
    assert used <= exported, used - exported
