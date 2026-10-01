"""Tests del mod-gateway con fakes: modelos lentos o caídos, Kafka falso, listas de hashes sintéticas.

Las métricas de prometheus_client son globales al proceso: los tests miden DIFERENCIAS (antes/después).
"""

import asyncio
import json
import re
import time
from pathlib import Path

import numpy as np
import pytest
import yaml
from fastapi.testclient import TestClient
from prometheus_client import REGISTRY

import engine
import main
import match

C06 = Path(__file__).resolve().parents[2]
RNG = np.random.default_rng(7)
CSAM_HASH = match.hash_to_hex(RNG.integers(0, 256, size=32, dtype=np.uint8))
OWN_HASH = match.hash_to_hex(RNG.integers(0, 256, size=32, dtype=np.uint8))
CLEAN_HASH = match.hash_to_hex(RNG.integers(0, 256, size=32, dtype=np.uint8))


def near(hex_hash: str, k: int) -> str:
    """El mismo hash con k bits volteados: la misma foto recomprimida o recortada."""
    h = match.hex_to_hash(hex_hash)
    for bit in range(k):
        h[bit // 8] ^= 1 << (7 - bit % 8)
    return match.hash_to_hex(h)


SNAPSHOT = [
    {"kind": "pdq", "id": "ncmec-1", "value": CSAM_HASH, "list": "industry_csam", "policy": "csam", "quality": 90},
    {"kind": "pdq", "id": "own-7", "value": OWN_HASH, "list": "own_removed", "policy": "hate_harassment", "quality": 80},
    {"kind": "text_sha256", "id": "spam-1", "value": match.text_hash("Gana US$500 al día desde casa"),
     "list": "own_removed", "policy": "spam_scams"},
    {"kind": "domain", "value": "phish.example", "list": "own_removed", "policy": "spam_scams"},
    {"kind": "heartbeat", "list": "industry_csam", "ts": 1_790_000_000},
    {"kind": "heartbeat", "list": "own_removed", "ts": 1_790_000_500},
]


class FakeText:
    def __init__(self, scores=None, delay=0.0, exc=None):
        self.scores, self.delay, self.exc, self.calls = scores or {}, delay, exc, 0

    async def score(self, text, surface):
        self.calls += 1
        await asyncio.sleep(self.delay)
        if self.exc:
            raise self.exc
        return engine.StageResult("stage1_text", "txt-distil-2026-09", dict(self.scores))


class FakeImage(FakeText):
    async def score(self, media_ids):
        self.calls += 1
        await asyncio.sleep(self.delay)
        if self.exc:
            raise self.exc
        return engine.StageResult("stage1_image", "img-light-2026-08", dict(self.scores))


class FakeKafka:
    def __init__(self, fail_times=0):
        self.sent, self.fail_times = [], fail_times

    async def publish(self, topic, key, value):
        if self.fail_times > 0:
            self.fail_times -= 1
            raise ConnectionError("broker no disponible")
        self.sent.append((topic, key, json.loads(value)))


class FakeUpdates:
    """Stream de novedades controlado por el test."""

    def __init__(self):
        self.q = asyncio.Queue()

    def __aiter__(self):
        return self

    async def __anext__(self):
        return await self.q.get()


def client(text=None, image=None, kafka=None, entries=SNAPSHOT, updates=None, **settings):
    deps = main.Deps(text or FakeText(), image or FakeImage(), kafka or FakeKafka(),
                     hash_updates=updates, hash_entries=entries)
    return TestClient(main.create_app(deps, main.Settings(**settings)))


def metric(name, **labels):
    return REGISTRY.get_sample_value(name, labels) or 0.0


def post(c, **kw):
    body = {"item_id": "p-1", "surface": "post", "text": "hola", "images": []} | kw
    return c.post("/v1/moderate", json=body)


def img(pdq, quality=80, media_id="m-1"):
    return {"media_id": media_id, "pdq": pdq, "pdq_quality": quality}


def wait_for(cond, timeout=2.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if cond():
            return True
        time.sleep(0.01)
    return False


# ---------------------------------------------------------------------------- camino feliz
def test_clean_post_publishes_and_emits_event():
    kafka = FakeKafka()
    with client(text=FakeText({"hate_harassment": 0.02}), kafka=kafka) as c:
        r = post(c, images=[img(CLEAN_HASH)])
        assert r.status_code == 200
        d = r.json()
        assert d["action"] == "none" and not d["fail_open"]
        assert d["config_version"] == "2026-10-01.1"
        assert d["model_versions"] == {"stage1_text": "txt-distil-2026-09", "stage1_image": "img-light-2026-08"}
        assert d["latency_ms"] > 0  # el número exacto depende de la máquina: el presupuesto se prueba abajo
        assert wait_for(lambda: len(kafka.sent) == 1)
    topic, key, ev = kafka.sent[0]
    assert (topic, key, ev["action"]) == ("mod-events", "p-1", "none")
    assert "text" not in ev and ev["media_ids"] == ["m-1"]  # Kafka no guarda el contenido


def test_models_run_in_parallel():
    """80 ms cada modelo: en serie (160 ms) se pasarían del presupuesto de 120 ms; en paralelo, no."""
    t, i = FakeText(delay=0.08), FakeImage(delay=0.08)
    with client(text=t, image=i) as c:
        d = post(c, images=[img(CLEAN_HASH)]).json()
    assert not d["fail_open"] and t.calls == i.calls == 1


def test_model_block_prepublish_with_statement_of_reasons():
    with client(image=FakeImage({"adult_nudity": 0.995})) as c:
        d = post(c, images=[img(CLEAN_HASH)]).json()
    assert (d["action"], d["policy"]) == ("block_prepublish", "adult_nudity")
    assert d["statement_of_reasons"].startswith("Decisión sobre tu publicación: no se publicó.")


# ---------------------------------------------------------------------------- hashes
def test_csam_hash_blocks_even_when_both_models_time_out():
    before = metric("mod_fail_open_total", reason="stage1_text_timeout")
    with client(text=FakeText(delay=3.0), image=FakeImage(delay=3.0)) as c:
        t0 = time.perf_counter()
        d = post(c, images=[img(near(CSAM_HASH, 20))]).json()
        elapsed = time.perf_counter() - t0
    assert (d["action"], d["policy"], d["source"]) == ("block_prepublish", "csam", "hash")
    assert d["escalation"] == "s0_specialist_team" and d["hash_match"]["distance"] == 20
    assert elapsed < 1.0  # el presupuesto cortó a los modelos: no esperamos 3 s
    assert metric("mod_fail_open_total", reason="stage1_text_timeout") == before + 1


def test_own_removed_list_is_stricter_than_industry():
    with client() as c:
        assert post(c, images=[img(near(OWN_HASH, 10))]).json()["action"] == "block_prepublish"
        assert post(c, images=[img(near(OWN_HASH, 25))]).json()["action"] == "none"  # > 16 para esta lista


def test_text_and_domain_hashes():
    with client() as c:
        d = post(c, text="GANA US$500   al día desde casa").json()
        assert (d["action"], d["policy"]) == ("block_prepublish", "spam_scams")
        d = post(c, text="mira esto", urls=["https://login.phish.example/x"]).json()
        assert d["action"] == "block_prepublish"


def test_low_quality_pdq_is_unverifiable_not_clean():
    before = metric("mod_hash_unverifiable_total")
    with client() as c:
        d = post(c, images=[img(CSAM_HASH, quality=30)]).json()
    assert d["action"] == "none"  # no se puede afirmar nada con ese hash…
    assert d["send_to_deep_scorer"] and d["hash_unverifiable_images"] == 1  # …así que la etapa 2 la mira
    assert metric("mod_hash_unverifiable_total") == before + 1


def test_missing_or_bad_pdq_is_rejected():
    with client() as c:
        assert c.post("/v1/moderate", json={"item_id": "x", "surface": "post",
                                            "images": [{"media_id": "m"}]}).status_code == 422
        assert post(c, images=[img("z" * 64)]).status_code == 422
        assert post(c, surface="story").status_code == 422  # fuera de alcance


def test_hash_updates_apply_live_and_move_watermark():
    upd = FakeUpdates()
    fresh = match.hash_to_hex(RNG.integers(0, 256, size=32, dtype=np.uint8))
    with client(updates=upd) as c:
        assert post(c, images=[img(fresh)]).json()["action"] == "none"
        c.portal.call(upd.q.put, {"kind": "pdq", "id": "own-99", "value": fresh, "list": "own_removed",
                                  "policy": "violence", "quality": 70, "ts": 1_790_001_000})
        assert wait_for(lambda: metric("mod_hash_list_watermark_timestamp_seconds", list="own_removed") == 1_790_001_000)
        assert post(c, images=[img(near(fresh, 3))]).json()["action"] == "block_prepublish"
        c.portal.call(upd.q.put, {"kind": "remove", "id": "own-99", "list": "own_removed", "ts": 1_790_001_100})
        assert wait_for(lambda: metric("mod_hash_list_watermark_timestamp_seconds", list="own_removed") == 1_790_001_100)
        assert post(c, images=[img(fresh)]).json()["action"] == "none"  # apelación ganada: deja de coincidir
        c.portal.call(upd.q.put, {"kind": "heartbeat", "list": "own_removed", "ts": 1_790_000_000})
        time.sleep(0.05)
        assert metric("mod_hash_list_watermark_timestamp_seconds", list="own_removed") == 1_790_001_100  # no retrocede


# ---------------------------------------------------------------------------- fail-open
def test_text_timeout_fails_open_within_budget():
    before = metric("mod_fail_open_requests_total", surface="comment")
    with client(text=FakeText({"violence": 0.99}, delay=3.0)) as c:
        t0 = time.perf_counter()
        d = post(c, surface="comment", text="cualquier cosa").json()
        elapsed = time.perf_counter() - t0
    assert d["action"] == "none" and d["fail_open"]
    assert d["fail_open_reasons"] == ["stage1_text:timeout"]
    assert d["send_to_deep_scorer"] and d["deep_scoring_priority"] == "high"
    # Se cortó en el presupuesto (120 ms − 5 ms de reserva), no a los 3 s del modelo. El techo es holgado
    # para que el test no dependa de la carga de la máquina.
    assert 0.11 < elapsed < 1.0
    assert metric("mod_fail_open_requests_total", surface="comment") == before + 1


def test_model_error_fails_open_and_fallback_rule_applies():
    with client(text=FakeText(exc=ConnectionError("triton caído"))) as c:
        d = post(c, text="te voy a matar mañana").json()
    assert d["fail_open_reasons"] == ["stage1_text:error"]
    assert (d["action"], d["source"], d["needs_review"]) == ("reduce", "fallback_rule", True)


def test_image_timeout_keeps_text_decision():
    with client(text=FakeText({"spam_scams": 0.995}), image=FakeImage(delay=3.0)) as c:
        d = post(c, images=[img(CLEAN_HASH)]).json()
    assert d["action"] == "block_prepublish" and d["fail_open_reasons"] == ["stage1_image:timeout"]


def test_budget_already_spent_skips_models():
    t = FakeText({"violence": 0.99})
    with client(text=t, budget_s=0.0) as c:
        d = post(c).json()
    assert d["fail_open_reasons"] == ["stage1_text:budget_exhausted"] and t.calls == 0  # ni siquiera se llamó


def test_engine_bug_still_blocks_s0_hash(monkeypatch):
    def boom(*a, **k):
        raise KeyError("bug")

    monkeypatch.setattr(main.engine, "decide", boom)
    with client() as c:
        d = post(c, images=[img(CSAM_HASH)]).json()
        assert (d["action"], d["policy"]) == ("block_prepublish", "csam")
        d = post(c, text="hola").json()
        assert d["action"] == "none" and "engine:error" in d["fail_open_reasons"]


# ---------------------------------------------------------------------------- kafka
def test_kafka_retry_then_success_and_drop_when_buffer_full():
    kafka = FakeKafka(fail_times=2)
    with client(kafka=kafka) as c:
        post(c)
        assert wait_for(lambda: len(kafka.sent) == 1)  # 2 fallos + éxito al tercer intento
    before = metric("mod_events_dropped_total")
    stuck = FakeKafka()

    async def never(topic, key, value):
        await asyncio.sleep(10)

    stuck.publish = never
    with client(kafka=stuck, event_buffer=2, shutdown_flush_s=0.1) as c:
        for i in range(5):
            assert post(c, item_id=f"p{i}").status_code == 200  # Kafka colgado NO frena los posts
        assert metric("mod_events_dropped_total") >= before + 2


# ---------------------------------------------------------------------------- operación
def test_readiness_requires_hash_index():
    with client(entries=[]) as c:
        assert c.get("/healthz").status_code == 200
        r = c.get("/readyz")
        assert r.status_code == 503 and r.json()["ready"] is False
    with client() as c:
        assert c.get("/readyz").json() == {"ready": True, "config_version": "2026-10-01.1", "pdq_entries": 2}


def test_invalid_policy_config_prevents_startup(tmp_path):
    cfg = yaml.safe_load((C06 / "decision" / "policies.yaml").read_text(encoding="utf-8"))
    cfg["fail_open"]["S0"]["allowed"] = True
    bad = tmp_path / "p.yaml"
    bad.write_text(yaml.safe_dump(cfg), encoding="utf-8")
    with pytest.raises(engine.ConfigError):
        with client(policies_path=str(bad)):
            pass


def test_snapshot_file_loading(tmp_path):
    snap = tmp_path / "hashes.jsonl"
    snap.write_text("\n".join(json.dumps(e) for e in SNAPSHOT) + "\n", encoding="utf-8")
    with client(entries=[], hash_snapshot_path=str(snap)) as c:
        assert c.get("/readyz").json()["pdq_entries"] == 2


def test_metrics_used_by_alerts_exist_in_gateway():
    """Contrato: cada métrica mod_* que usan las alertas existe aquí (salvo las de otros servicios)."""
    with client() as c:
        post(c)
        exposed = c.get("/metrics").text
    rules = (C06 / "monitoring" / "alerts.yml").read_text(encoding="utf-8")
    used = set(re.findall(r"\b(mod_[a-z0-9_]+)", rules))
    used = {re.sub(r"_(bucket|count|sum)$", "", m) for m in used}
    assert used, "alerts.yml no usa métricas mod_*?"
    for name in sorted(used):
        assert re.search(rf"^{name}(_bucket|_count|_sum|_total)?[{{ ]", exposed, re.M), name
