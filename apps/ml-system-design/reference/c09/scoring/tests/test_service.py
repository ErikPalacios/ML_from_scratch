"""Tests del servicio: presupuesto, fallbacks, reintentos, PAN, log de decisiones y contrato de métricas.

Todo con fakes salvo el modelo: un GBDT de sklearn de verdad, entrenado aquí con datos sintéticos.
"""

import asyncio
import hashlib
import os
import pickle
import re
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import definitions as d
import numpy as np
import pytest
import synthetic
from fastapi.testclient import TestClient
from online_counters import InMemoryKV, OnlineCounters
from policy import load_policy
from rules import Blocklists
from service import (BufferedDecisionLog, Deps, InMemoryDecisionCache, LocalCounterStore, Settings, SklearnModel,
                     StaticFeatureFetcher, _model_thread_init, create_app)

HERE = Path(__file__).resolve().parents[1]
ALERTS = HERE.parent / "monitoring" / "alerts.yml"
T0 = 1_760_000_000.0


# ------------------------------------------------------------------------------------------ fixtures
@pytest.fixture(scope="session")
def model_artifact(tmp_path_factory):
    """Entrena el GBDT, lo serializa como lo haría el pipeline de training y devuelve (ruta, sha256)."""
    X, y = synthetic.make_training_data(20000)
    path = tmp_path_factory.mktemp("model") / "model.pkl"
    path.write_bytes(pickle.dumps(synthetic.train_model(X, y)))
    return path, hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.fixture(scope="session")
def model(model_artifact):
    path, sha = model_artifact
    return SklearnModel.load(path, sha, version="hgb-test")


class Clock:
    def __init__(self, t=T0):
        self.t = t

    def __call__(self):
        return self.t


class SlowCounters:
    """KV store que no contesta a tiempo (Redis saturado o caído)."""

    def __init__(self, delay=0.5, error=False):
        self.delay, self.error = delay, error

    async def read_and_update(self, event, ts):
        await asyncio.sleep(self.delay)
        if self.error:
            raise ConnectionError("redis")


class Fetcher(StaticFeatureFetcher):
    """Online store falso configurable: lento, con error o sin algún grupo."""

    def __init__(self, delay=0.0, error=False, drop=()):
        super().__init__({"card_age_days": 300.0, "email_age_days": 500.0,
                          "merchant_chargeback_bps_90d": 5.0, "device_linked_accounts_30d": 1.0})
        self.delay, self.error, self.drop = delay, error, drop

    async def fetch(self, event):
        await asyncio.sleep(self.delay)
        if self.error:
            raise ConnectionError("online store")
        out = await super().fetch(event)
        return {k: v for k, v in out.items() if k not in self.drop}


class FakeModel:
    def __init__(self, value=0.001, delay=0.0, error=False):
        self.value, self.delay, self.error, self.version = value, delay, error, "fake"

    def predict(self, row):
        time.sleep(self.delay)  # CPU ocupada (no un sleep async): así se ve un modelo lento de verdad
        if self.error:
            raise RuntimeError("modelo")
        return self.value


class BrokenCache(InMemoryDecisionCache):
    async def get(self, payment_id):
        raise ConnectionError("cache")

    async def put(self, payment_id, response, ttl_s):
        raise ConnectionError("cache")


@pytest.fixture
def make_client():
    """Fábrica de clientes. `with TestClient` mantiene UN event loop vivo, como uvicorn: sin eso, cada
    request abre y cierra su loop, y el cierre espera a los threads (un modelo lento parecería bloquear)."""
    opened = []

    def factory(model=None, counters=None, fetcher=None, cache=None, clock=None, blocklists=None):
        clock = clock or Clock()
        policy = load_policy(HERE / "policy.yaml")
        log = BufferedDecisionLog()
        deps = Deps(policy=policy, model=model,
                    counters=counters or LocalCounterStore(OnlineCounters(InMemoryKV(clock))),
                    fetcher=fetcher or Fetcher(), cache=cache or InMemoryDecisionCache(clock),
                    decision_log=log, blocklists=blocklists or Blocklists(), settings=Settings(), clock=clock)
        client = TestClient(create_app(deps))
        client.__enter__()
        opened.append(client)
        return client, log

    yield factory
    for c in opened:
        c.__exit__(None, None, None)


def body(pid="p1", **kw):
    return {"payment_id": pid, "merchant_id": "m_shop", "mcc": "5411", "amount_cents": 2500, "currency": "MXN",
            "card_token": "tok_9f2c1a77e0", "card_bin_country": "MX", "ip_hash": "ip_1", "ip_country": "MX",
            "device_hash": "dev_1", "email_hash": "em_1", **kw}


def metric(client, name, labels=""):
    """Valor de una serie en /metrics (0 si no existe)."""
    text = client.get("/metrics").text
    m = re.search(rf"^{re.escape(name)}{re.escape(labels)} ([0-9.e+-]+)$", text, re.M)
    return float(m.group(1)) if m else 0.0


# ------------------------------------------------------------------------------------------ camino feliz
def test_happy_path_scores_with_the_model(make_client, model):
    client, log = make_client(model=model)
    r = client.post("/v1/score", json=body())
    assert r.status_code == 200
    out = r.json()
    assert out["path"] == "model" and out["fallback_reason"] is None and out["groups_defaulted"] == []
    assert out["decision"] == "approve" and 0 <= out["score"] < 0.034  # pago normal, ticket bajo
    assert out["segment"] == "retail_low" and out["policy_version"] == "policy-2026-10-01"
    assert out["latency_ms"] < 80
    assert metric(client, "fraud_decisions_total", '{decision="approve",segment="retail_low"}') == 1


def test_model_latency_on_cpu_is_milliseconds(model):
    """Lo que el caso supone (≈ 1–2 ms por predicción en CPU): aquí se MIDE con el modelo real, en un thread
    como los del servicio, con y sin el límite de 1 thread de OpenMP (_model_thread_init)."""
    X, _ = synthetic.make_training_data(500, seed=9)

    def p50_p99(pool):
        times = []
        for row in X:
            t = time.perf_counter()
            pool.submit(model.predict, list(row)).result()
            times.append(time.perf_counter() - t)
        return float(np.median(times) * 1000), float(np.percentile(times, 99) * 1000)

    with ThreadPoolExecutor(1) as plain, ThreadPoolExecutor(1, initializer=_model_thread_init) as limited:
        default_ms, one_ms = p50_p99(plain), p50_p99(limited)
    print(f"\npredict 1 fila: OpenMP por defecto p50={default_ms[0]:.2f} ms p99={default_ms[1]:.2f} ms · "
          f"1 thread p50={one_ms[0]:.2f} ms p99={one_ms[1]:.2f} ms ({os.cpu_count()} cores en este equipo)")
    assert one_ms[1] < 5  # holgado a propósito: el número real depende de la CPU


def test_wrong_model_checksum_refuses_to_load(model_artifact):
    path, _ = model_artifact
    with pytest.raises(ValueError):
        SklearnModel.load(path, "0" * 64, version="x")


# ------------------------------------------------------------------------------------------ velocidad
def test_card_testing_burst_is_declined_on_the_sixth_attempt(make_client, model):
    clock = Clock()
    client, _ = make_client(model=model, clock=clock)
    decisions = []
    for i in range(6):
        clock.t = T0 + i * 3  # 6 intentos en 15 s con la misma tarjeta
        decisions.append(client.post("/v1/score", json=body(f"ct{i}", amount_cents=100)).json())
    assert decisions[5]["decision"] == "decline"
    assert "VELOCITY_CARD_60S" in decisions[5]["reason_codes"]


def test_retry_gets_the_same_answer_and_does_not_double_count(make_client, model):
    clock = Clock()
    client, log = make_client(model=model, clock=clock)
    first = client.post("/v1/score", json=body("r1")).json()
    retry = client.post("/v1/score", json=body("r1")).json()
    assert retry["replayed"] is True and retry["decision"] == first["decision"] and retry["score"] == first["score"]
    assert metric(client, "fraud_idempotent_replays_total") == 1
    assert len(log.records) == 1  # el reintento no genera otra decisión en el log
    client.post("/v1/score", json=body("r2"))
    assert log.records[-1]["features"]["card_count_60s"] == 1.0  # r1 una vez, no dos


def test_second_call_after_3ds_is_a_new_decision_without_new_counts(make_client):
    """Step-up → desafío → el orquestador llama otra vez con el MISMO payment_id y el resultado."""
    clock = Clock()
    client, log = make_client(model=FakeModel(value=0.10), clock=clock)  # retail_low: banda de step-up
    first = client.post("/v1/score", json=body("s1")).json()
    assert first["decision"] == "step_up"
    clock.t = T0 + 40  # 40 s resolviendo el desafío
    second = client.post("/v1/score", json=body("s1", three_ds_result="authenticated")).json()
    assert second["replayed"] is False  # no es un reintento: es otra etapa del pago
    assert second["decision"] == "approve" and "STEP_UP_AUTHENTICATED" in second["reason_codes"]
    # las features de la segunda llamada son las de la primera: el pago no se contó a sí mismo
    assert log.records[1]["features"]["card_count_60s"] == log.records[0]["features"]["card_count_60s"] == 0.0
    failed = client.post("/v1/score", json=body("s2", three_ds_result="failed")).json()
    assert failed["decision"] == "decline" and "STEP_UP_FAILED" in failed["reason_codes"]


def test_retry_with_the_cache_down_is_still_counted_once(make_client, model):
    clock = Clock()
    store = OnlineCounters(InMemoryKV(clock))
    client, _ = make_client(model=model, clock=clock, counters=LocalCounterStore(store), cache=BrokenCache())
    client.post("/v1/score", json=body("x1"))
    retry = client.post("/v1/score", json=body("x1")).json()
    assert retry["replayed"] is False  # sin caché no hay respuesta guardada…
    assert metric(client, "fraud_counter_duplicates_total") == 1  # …pero la guardia de los contadores lo vio
    assert store.read(body("x2"), T0)["card_count_60s"] == 1  # y la tarjeta tiene 1 intento, no 2
    assert metric(client, "fraud_decision_cache_errors_total") >= 2


# ------------------------------------------------------------------------------------------ fallbacks
@pytest.mark.parametrize("counters,reason", [(SlowCounters(0.5), "counters_timeout"),
                                             (SlowCounters(0.0, error=True), "counters_error")])
def test_counters_down_means_rules_only_within_budget(make_client, model, counters, reason):
    client, _ = make_client(model=model, counters=counters)
    t = time.perf_counter()
    out = client.post("/v1/score", json=body()).json()
    assert (time.perf_counter() - t) < 0.1  # el KV store tarda 500 ms; el pago, no
    assert out["path"] == "rules_only" and out["fallback_reason"] == reason and out["score"] is None
    assert out["decision"] == "approve"  # retail_low: fallback approve
    assert metric(client, "fraud_fallback_total", f'{{reason="{reason}"}}') == 1


def test_with_redis_down_the_local_counter_still_stops_card_testing(make_client, model):
    clock = Clock()
    client, _ = make_client(model=model, counters=SlowCounters(0.5), clock=clock)
    outs = []
    for i in range(6):
        clock.t = T0 + i
        outs.append(client.post("/v1/score", json=body(f"l{i}")).json())
    assert all(o["path"] == "rules_only" for o in outs)
    assert outs[5]["decision"] == "decline" and "VELOCITY_CARD_60S" in outs[5]["reason_codes"]


def test_stream_features_timeout_falls_back_but_missing_batch_uses_defaults(make_client, model):
    slow, _ = make_client(model=model, fetcher=Fetcher(delay=0.5))
    out = slow.post("/v1/score", json=body()).json()
    assert out["fallback_reason"] == "features_timeout"
    no_batch, log = make_client(model=model, fetcher=Fetcher(drop=("batch",)))
    out = no_batch.post("/v1/score", json=body()).json()
    assert out["path"] == "model"  # batch está en degraded_groups_allowed: NaN y el modelo decide
    assert out["groups_defaulted"] == ["batch"]
    assert metric(no_batch, "fraud_feature_defaults_total", '{group="batch"}') == 1
    assert log.records[-1]["groups_defaulted"] == ["batch"]
    assert log.records[-1]["features"]["card_age_days"] is None  # NaN → null en el log
    no_stream, _ = make_client(model=model, fetcher=Fetcher(drop=("stream",)))
    assert no_stream.post("/v1/score", json=body()).json()["fallback_reason"] == "features_missing"


@pytest.mark.parametrize("fake,reason", [(FakeModel(delay=0.2), "model_timeout"),
                                         (FakeModel(error=True), "model_error"),
                                         (FakeModel(value=1.7), "model_error")])
def test_model_problems_fall_back(make_client, fake, reason):
    client, _ = make_client(model=fake)
    t = time.perf_counter()
    out = client.post("/v1/score", json=body(mcc="5816", amount_cents=25000)).json()
    assert (time.perf_counter() - t) < 0.1
    assert out["fallback_reason"] == reason
    assert out["decision"] == "step_up"  # digital_high sin modelo: step-up a todo (policy.yaml)


def test_a_model_that_fails_warm_up_never_becomes_ready(make_client):
    client, _ = make_client(model=FakeModel(error=True))
    assert client.get("/readyz").status_code == 503  # el rollout se detiene aquí, no en producción


def test_everything_slow_still_answers_inside_the_budget(make_client, model):
    client, _ = make_client(model=model, counters=SlowCounters(1.0), fetcher=Fetcher(delay=1.0))
    t = time.perf_counter()
    out = client.post("/v1/score", json=body()).json()
    assert (time.perf_counter() - t) < 0.1
    assert out["path"] == "rules_only"


def test_no_model_is_not_ready_and_decides_with_rules(make_client):
    client, _ = make_client(model=None, blocklists=Blocklists(card=frozenset({"tok_9f2c1a77e0"})))
    assert client.get("/readyz").status_code == 503
    assert client.get("/healthz").status_code == 200  # liveness no depende del modelo
    out = client.post("/v1/score", json=body()).json()
    assert out["fallback_reason"] == "model_unavailable" and out["decision"] == "decline"
    assert "BLOCKLIST_CARD" in out["reason_codes"]


# ------------------------------------------------------------------------------------------ datos
def test_a_pan_is_rejected_and_never_echoed(make_client, model):
    client, log = make_client(model=model)
    r = client.post("/v1/score", json=body(card_token="4111111111111111"))
    assert r.status_code == 422
    assert "4111111111111111" not in r.text  # FastAPI devolvería el `input` sin el handler propio
    assert len(log.records) == 0


def test_decision_log_carries_the_exact_feature_snapshot(make_client, model):
    clock = Clock()
    client, log = make_client(model=model, clock=clock)
    client.post("/v1/score", json=body("s1"))
    clock.t = T0 + 2
    client.post("/v1/score", json=body("s2"))
    rec = log.records[-1]
    assert rec["event_time"] == T0 + 2  # el reloj del servicio: el event_time del backfill
    assert rec["features"]["card_count_60s"] == 1.0  # lo que vio el modelo, no lo que hay hoy
    assert rec["features"]["card_count_24h"] == 0.0  # entidad presente sin historia: 0, no null
    assert rec["model_version"] == "hgb-test" and rec["feature_set_version"] == d.FEATURE_SET_VERSION
    assert set(rec["features"]) == set(d.FEATURE_ORDER)
    assert "pan" not in rec and not any(len(str(v)) >= 13 and str(v).isdigit() for v in rec.values())


def test_every_fraud_metric_in_the_alerts_exists_in_metrics(make_client, model):
    """Contrato: si una alerta mira una métrica que el servicio no exporta, la alerta nunca dispara."""
    external = {"fraud_feature_watermark_timestamp_seconds", "fraud_cohort_chargeback_bps"}  # otros jobs
    # (?<![\w:]): no confundir las recording rules (fraud:…) ni métricas de otros (payments:fraud_check_…)
    names = set(re.findall(r"(?<![\w:])(fraud_[a-z0-9_]+)", ALERTS.read_text()))
    assert len(names) >= 10  # el regex encontró las métricas (un test que no mira nada no prueba nada)
    client, _ = make_client(model=model)
    text = client.get("/metrics").text
    for name in sorted(names - external):
        base = re.sub(r"_(bucket|sum|count)$", "", name)
        assert f"# TYPE {base} " in text or f"# TYPE {base.removesuffix('_total')} " in text, name
