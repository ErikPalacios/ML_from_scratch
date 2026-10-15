"""Tests del ad-api: filtros, consentimiento, presupuesto, fallbacks, subasta, tokens, beacons, clicks y el
contrato de métricas con alerts.yml. Todo con fakes en memoria salvo el modelo (conftest.py).
"""

import asyncio
import re
import statistics
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import numpy as np
import pytest
from fastapi.testclient import TestClient
from prometheus_client.parser import text_string_to_metric_families

import ad_api
import build_training_set as BTS
import features as F
import synthetic
import tokens as T
from ad_api import (Ad, BufferedEventLog, CampaignBudget, Deps, InMemoryBudgetStore, InMemoryDedupeStore,
                    InMemoryFrequencyStore, InMemoryTargetingIndex, Settings, SmoothedCTR, StaticUserFeatureStore,
                    create_app)

ALERTS = Path(__file__).resolve().parents[2] / "monitoring" / "alerts.yml"
T0 = datetime(2026, 10, 15, 14, 0, tzinfo=timezone.utc).timestamp()  # jueves 08:00 en la Ciudad de México
KEYS = {"t1": b"llave-de-prueba-de-32-bytes-1234"}
PRIORS = {"top": 0.010, "in_article": 0.008, "bottom": 0.005}


# ------------------------------------------------------------------------------------------ fakes
class Clock:
    def __init__(self, t=T0):
        self.t = t

    def __call__(self):
        return self.t


class SlowModel:
    """Modelo que tarda (CPU ocupada, no un sleep async): así se ve un pod saturado."""

    def __init__(self, inner, delay=0.05):
        self.inner, self.delay, self.version = inner, delay, "slow"

    def predict_slots(self, rows, formats, slots):
        time.sleep(self.delay)
        return self.inner.predict_slots(rows, formats, slots)


class GarbageModel:
    def __init__(self, value):
        self.value, self.version = value, "garbage"

    def predict_slots(self, rows, formats, slots):
        return np.full((len(rows), len(slots)), self.value)


class SlowUsers(StaticUserFeatureStore):
    async def get(self, user_id):
        await asyncio.sleep(0.05)
        return await super().get(user_id)


class BrokenFreq(InMemoryFrequencyStore):
    async def counts(self, user_id, campaign_ids, day):
        raise ConnectionError("redis")


class FlakyBudget(InMemoryBudgetStore):
    broken = False

    async def status(self, campaign_ids):
        if self.broken:
            raise ConnectionError("redis")
        return await super().status(campaign_ids)


class FailingClickLog(BufferedEventLog):
    async def publish_and_wait(self, record):
        raise TimeoutError("kafka sin ack")


def open_budgets(ads):
    """Todas las campañas con presupuesto de sobra y sin throttling (serve_rate 1)."""
    return {a.campaign_id: CampaignBudget(0.0, 1_000.0, 1.0) for a in ads}


@pytest.fixture
def make_client(world, trained_model):
    opened = []

    def factory(ads=None, model="trained", users=None, freq=None, budget=None, events=None, clock=None,
                fallback=None, **settings_kw):
        ads = ads if ads is not None else [Ad(**a) for a in world.ads]
        deps = Deps(
            index=InMemoryTargetingIndex(ads), freq=freq or InMemoryFrequencyStore(clock or Clock()),
            budget=budget or InMemoryBudgetStore(open_budgets(ads)), users=users or StaticUserFeatureStore(),
            model=trained_model if model == "trained" else model,
            fallback_ctr=fallback or SmoothedCTR({}, PRIORS), dedupe=InMemoryDedupeStore(clock or Clock()),
            events=events or BufferedEventLog(), clock=clock or Clock(),
            settings=Settings(token_keys=KEYS, token_kid="t1",
                              exploration_rate=settings_kw.pop("exploration_rate", 0.0), **settings_kw))
        client = TestClient(create_app(deps))  # `with`: UN event loop vivo, como uvicorn
        client.__enter__()
        opened.append(client)
        return client, deps

    yield factory
    for c in opened:
        c.__exit__(None, None, None)


def ask(client, **kw):
    r = client.post("/v1/ads", json={"section": "deportes", "device": "mobile", "geo": "MX-NLE", **kw})
    assert r.status_code == 200, r.text
    return r.json()


def token_of(url):
    return parse_qs(urlparse(url).query)["t"][0]


def metric(client, name, **labels):
    total = 0.0
    for fam in text_string_to_metric_families(client.get("/metrics").text):
        for s in fam.samples:
            if s.name == name and all(s.labels.get(k) == v for k, v in labels.items()):
                total += s.value
    return total


def served_ads(out):
    return [s for s in out["slots"] if s["fill"] == "ad"]


# ------------------------------------------------------------------------------------------ el request
def test_fills_three_slots_one_ad_per_advertiser_signed_prices(make_client):
    users = StaticUserFeatureStore({"u1": {"interests": ["autos", "politica"]}})
    client, deps = make_client(users=users)
    out = ask(client, request_id="req-00000001", user_id="u1", consent=True)
    assert out["path"] == "model" and out["model_version"] == "lr-test"
    assert [s["slot"] for s in out["slots"]] == list(F.SLOTS)  # en el orden de la página
    ads = served_ads(out)
    assert len(ads) == 3
    assert len({deps.index.get(s["ad_id"]).advertiser_id for s in ads}) == 3  # un anuncio por anunciante
    for s in ads:
        assert token_of(s["click_url"]) == token_of(s["impression_url"])
        p = T.verify(token_of(s["click_url"]), KEYS, now=T0, max_age_s=60)
        bid = deps.index.get(p["ad"]).bid
        assert p["src"] == "model" and 0 < p["p"] < 1 and p["px"] <= bid
        assert p["px"] * p["p"] * 1000 >= 0.80 - 1e-9  # el ingreso esperado por mil pasa la reserva
    serve = deps.events.records[-1]
    assert serve["type"] == "serve" and serve["interests"] == ["autos"]  # "politica" nunca entra al perfil
    assert (serve["context"]["hour"], serve["context"]["dow"]) == (8, 3)  # hora LOCAL, logueada
    assert out["latency_ms"] < 40


def test_without_consent_the_user_id_does_not_exist(make_client, world):
    # bid alto (fuera del rango del caso) para que, si participa, gane: el test mira el FILTRO, no la subasta
    targeted = Ad("seg", "c-seg", "v-seg", 5.0, "autos", "native", target_interests=frozenset({"autos"}))
    users = StaticUserFeatureStore({"u1": {"interests": ["autos"]}})
    ads = [Ad(**a) for a in world.ads] + [targeted]
    client, deps = make_client(ads=ads, users=users)
    out = ask(client, request_id="req-noconsent", user_id="u1", consent=False)
    assert users.calls == 0  # ni se consulta el perfil
    assert deps.events.records[-1]["user_id"] is None and deps.events.records[-1]["interests"] == []
    assert "seg" not in {s["ad_id"] for s in served_ads(out)}
    assert metric(client, "ad_filtered_total", reason="interest") == 1
    # Con consentimiento e interés, el anuncio segmentado sí compite (y con su bid, gana)
    out = ask(client, request_id="req-consent1", user_id="u1", consent=True)
    assert "seg" in {s["ad_id"] for s in served_ads(out)}
    assert metric(client, "ad_filtered_total", reason="interest") == 1  # no se volvió a filtrar


def test_frequency_cap_per_user_per_local_day(make_client):
    solo = Ad("solo", "c-solo", "v-solo", 1.0, "autos", "native", freq_cap_per_day=2)
    clock = Clock()
    client, _ = make_client(ads=[solo], clock=clock)
    for i in range(2):  # el cap se suma DESPUÉS de responder (BackgroundTasks); TestClient lo espera
        assert served_ads(ask(client, request_id=f"req-fc-{i:04d}", user_id="u1", consent=True))[0]["ad_id"] == "solo"
    assert ask(client, request_id="req-fc-0002", user_id="u1", consent=True)["path"] == "no_fill"
    assert metric(client, "ad_filtered_total", reason="freq_cap") == 1
    assert served_ads(ask(client, request_id="req-fc-0003", user_id="u2", consent=True))  # otra persona
    clock.t += 86_400  # otro día local: la llave es por fecha
    assert served_ads(ask(client, request_id="req-fc-0004", user_id="u1", consent=True))


def test_frequency_store_down_fails_open(make_client):
    client, _ = make_client(freq=BrokenFreq())
    out = ask(client, request_id="req-freqdown", user_id="u1", consent=True)
    assert out["path"] == "model" and served_ads(out)
    assert metric(client, "ad_dependency_errors_total", dependency="freq_caps", kind="error") == 1


def test_budget_exhausted_and_pacing(make_client):
    spent = Ad("gasto", "c-gasto", "v1", 1.0, "autos", "native")
    paced = Ad("pace", "c-pace", "v2", 1.0, "retail", "native")
    budget = InMemoryBudgetStore({"c-gasto": CampaignBudget(100.0, 100.0, 1.0),
                                  "c-pace": CampaignBudget(0.0, 100.0, 0.3)})
    client, _ = make_client(ads=[spent, paced], budget=budget)
    served = [ask(client, request_id=f"req-pace-{i:05d}") for i in range(600)]
    ids = [s["ad_id"] for out in served for s in served_ads(out)]
    assert "gasto" not in ids
    assert 0.24 < ids.count("pace") / 600 < 0.36  # participa en ≈ 30 % de los requests (serve_rate)
    assert metric(client, "ad_filtered_total", reason="budget_exhausted") == 600


def test_budget_store_down_uses_last_good_reading_then_fails_closed(make_client, world):
    ads = [Ad(**a) for a in world.ads]
    clock = Clock()
    budget = FlakyBudget(open_budgets(ads))
    client, _ = make_client(ads=ads, budget=budget, clock=clock)
    assert ask(client, request_id="req-bud-0001")["path"] == "model"  # lectura buena a las T0
    budget.broken = True
    clock.t = T0 + 30
    assert ask(client, request_id="req-bud-0002")["path"] == "model"  # 30 s: sirve con la última lectura
    assert metric(client, "ad_budget_stale_total") == 1
    clock.t = T0 + 120
    assert ask(client, request_id="req-bud-0003")["path"] == "no_fill"  # 2 min: no sabe, no cobra de más
    assert metric(client, "ad_dependency_errors_total", dependency="budget", kind="error") == 2


def test_slow_user_features_mean_context_only(make_client, world):
    targeted = Ad("seg", "c-seg", "v-seg", 5.0, "autos", "native", target_interests=frozenset({"autos"}))
    client, _ = make_client(ads=[Ad(**a) for a in world.ads] + [targeted],
                            users=SlowUsers({"u1": {"interests": ["autos"]}}))
    out = ask(client, request_id="req-slowuser", user_id="u1", consent=True)
    assert out["path"] == "model" and "seg" not in {s["ad_id"] for s in served_ads(out)}
    assert out["latency_ms"] < 40  # el online store tardó 50 ms; el request no lo esperó
    assert metric(client, "ad_user_feature_defaults_total", reason="timeout") == 1


# ------------------------------------------------------------------------------------------ fallbacks
def test_slow_model_falls_back_to_smoothed_ctr(make_client, trained_model, world):
    client, _ = make_client(model=SlowModel(trained_model))
    out = ask(client, request_id="req-slowmodel")
    assert out["path"] == "fallback" and out["model_version"] is None and served_ads(out)
    assert all(T.verify(token_of(s["click_url"]), KEYS, now=T0, max_age_s=60)["src"] == "fallback"
               for s in served_ads(out))
    assert out["latency_ms"] < 40
    assert metric(client, "ad_fallback_total", reason="model_timeout") == 1


@pytest.mark.parametrize("value", [np.nan, 1.5, -0.1])
def test_garbage_scores_fall_back(make_client, value):
    client, _ = make_client(model=GarbageModel(value))
    assert ask(client, request_id="req-garbage")["path"] == "fallback"
    assert metric(client, "ad_fallback_total", reason="model_error") == 1


def test_no_model_is_not_ready_but_still_serves(make_client):
    client, _ = make_client(model=None)
    assert client.get("/readyz").status_code == 503
    assert ask(client, request_id="req-nomodel")["path"] == "fallback"
    assert metric(client, "ad_fallback_total", reason="model_unavailable") == 1


def test_fallback_ranks_by_bid_times_smoothed_ctr(make_client):
    # Sin modelo: A (0.50 × 1.2 %) vence a B (1.00 × 0.4 %): 6.0 vs 4.0 de eCPM con los CTR suavizados
    a = Ad("A", "cA", "vA", 0.50, "autos", "native")
    b = Ad("B", "cB", "vB", 1.00, "retail", "native")
    table = {("A", "top"): (120.0, 9_000.0), ("B", "top"): (36.0, 9_000.0)}  # (clicks + 10) / 10,000
    client, _ = make_client(ads=[a, b], model=None, fallback=SmoothedCTR(table, PRIORS, strength=1000.0))
    assert served_ads(ask(client, request_id="req-fb-rank"))[0]["ad_id"] == "A"


def test_smoothed_ctr_numbers_from_the_docstring():
    s = SmoothedCTR({("x", "top"): (50.0, 10_000.0), ("z", "top"): (0.0, 5_000.0)}, {"top": 0.0035}, 1000.0)
    assert s.ctr("x", "top") == pytest.approx(53.5 / 11_000)  # ≈ 0.49 %
    assert s.ctr("nuevo", "top") == pytest.approx(0.0035)  # sin historia: el prior
    assert s.ctr("z", "top") == pytest.approx(3.5 / 6_000)  # ≈ 0.06 %


# ------------------------------------------------------------------------------------------ subasta y exploración
def test_an_advertiser_never_takes_two_slots(make_client):
    big = [Ad(f"big{i}", f"cb{i}", "v-big", 1.5, "autos", "native") for i in range(3)]
    others = [Ad("o1", "co1", "v-o1", 0.4, "retail", "native"), Ad("o2", "co2", "v-o2", 0.4, "viajes", "native")]
    client, deps = make_client(ads=big + others)
    adv = [deps.index.get(s["ad_id"]).advertiser_id for s in served_ads(ask(client, request_id="req-onead"))]
    assert adv.count("v-big") == 1 and len(adv) == len(set(adv))


def test_exploration_requests_are_random_at_reserve_price_with_propensity(make_client):
    client, deps = make_client(exploration_rate=1.0)
    out = ask(client, request_id="req-explore")
    assert out["exploration"] is True
    for pl in deps.events.records[-1]["placements"]:
        assert pl["src"] == "explore" and pl["price_source"] == "reserve" and 0 < pl["propensity"] < 1
        assert pl["price"] == pytest.approx(min(pl["bid"], 0.80 / (1000 * pl["pctr"]) + 0.01), abs=1e-6)
    assert metric(client, "ad_exploration_requests_total") == 1


def test_exploration_share_is_about_one_percent():
    ids = [f"req-{i:06d}" for i in range(20_000)]
    share = sum(ad_api._unit(f"explore|{rid}") < 0.01 for rid in ids) / len(ids)
    assert 0.008 < share < 0.012  # determinista por request: re-jugar un request da la misma decisión


def test_new_ads_get_the_boost_only_with_the_model(make_client, world, trained_model):
    ads = [Ad(**{**a, "lifetime_impressions": 100 if i % 2 else 50_000}) for i, a in enumerate(world.ads)]
    client, deps = make_client(ads=ads)
    ask(client, request_id="req-boost-1")
    for pl in deps.events.records[-1]["placements"]:
        new = deps.index.get(pl["ad_id"]).lifetime_impressions < 10_000
        assert pl["boost"] == (1.2 if new else 1.0)
    client, deps = make_client(ads=ads, model=SlowModel(trained_model))
    ask(client, request_id="req-boost-2")
    assert all(pl["boost"] == 1.0 for pl in deps.events.records[-1]["placements"])  # fallback: sin boost


# ------------------------------------------------------------------------------------------ beacon y click
def test_viewable_beacon_counts_once_with_expected_clicks(make_client):
    clock = Clock()
    client, deps = make_client(clock=clock)
    s = served_ads(ask(client, request_id="req-imp-0001"))[0]
    tok = token_of(s["impression_url"])
    p = T.verify(tok, KEYS, now=T0, max_age_s=60)
    clock.t = T0 + 2
    assert client.get("/v1/imp", params={"t": tok}).status_code == 204
    assert client.get("/v1/imp", params={"t": tok}).status_code == 204  # el beacon repetido…
    assert metric(client, "ad_viewable_impressions_total", slot=p["slot"], src="model") == 1  # …cuenta una vez
    assert metric(client, "ad_expected_clicks_total", slot=p["slot"]) == pytest.approx(p["p"])
    assert metric(client, "ad_impression_duplicates_total") == 1
    imps = [e for e in deps.events.records if e["type"] == "impression"]
    assert len(imps) == 1 and imps[0]["imp_id"] == "req-imp-0001:" + p["slot"]
    clock.t = T0 + 11 * 60  # 11 min después del serve: beacon vencido
    other = token_of(served_ads(ask(client, request_id="req-imp-0002"))[0]["impression_url"])
    clock.t += 11 * 60
    client.get("/v1/imp", params={"t": other})
    assert metric(client, "ad_impressions_rejected_total", reason="expired") == 1


def test_click_bills_once_and_redirects_to_the_landing_from_the_index(make_client):
    client, deps = make_client()
    s = served_ads(ask(client, request_id="req-click-01"))[0]
    tok = token_of(s["click_url"])
    p = T.verify(tok, KEYS, now=T0, max_age_s=60)
    ad = deps.index.get(p["ad"])
    r = client.get("/v1/click", params={"t": tok}, follow_redirects=False)
    assert r.status_code == 302 and r.headers["location"] == ad.landing_url  # el destino sale del índice
    assert r.headers["cache-control"] == "no-store"  # 302 sin caché: el siguiente click también pasa por aquí
    r2 = client.get("/v1/click", params={"t": tok}, follow_redirects=False)  # doble click
    assert r2.status_code == 302
    clicks = [e for e in deps.events.records if e["type"] == "click"]
    assert len(clicks) == 1 and clicks[0]["price"] == p["px"]  # el precio de la SUBASTA, no uno nuevo
    assert deps.budget.spend_log == [(p["c"], p["px"], "2026-10-15")]  # el gasto cuenta una vez
    assert metric(client, "ad_click_duplicates_total") == 1
    assert metric(client, "ad_click_revenue_usd_total") == pytest.approx(p["px"])


def test_tampered_click_redirects_but_is_not_billed(make_client):
    client, deps = make_client()
    s = served_ads(ask(client, request_id="req-click-02"))[0]
    payload_b64, sig = token_of(s["click_url"]).split(".")
    forged = T._b64e(T._b64d(payload_b64).replace(b'"px":', b'"px":0.0001,"x":')) + "." + sig
    r = client.get("/v1/click", params={"t": forged}, follow_redirects=False)
    assert r.status_code == 302 and r.headers["location"] == deps.index.get(s["ad_id"]).landing_url
    assert not [e for e in deps.events.records if e["type"] == "click"] and deps.budget.spend_log == []
    assert metric(client, "ad_clicks_rejected_total", reason="bad_signature") == 1
    r = client.get("/v1/click", params={"t": "basura"}, follow_redirects=False)
    assert r.headers["location"] == "https://www.example.com"  # nunca a una URL que venga en el request


def test_click_on_an_ad_served_after_its_pause_is_not_billed(make_client, world):
    ads = [Ad(**a) for a in world.ads]
    clock = Clock(T0 + 10)
    client, deps = make_client(ads=ads, clock=clock)  # este pod todavía no se enteró de la pausa
    s = served_ads(ask(client, request_id="req-paused-1"))[0]
    paused = Ad(**{**next(a for a in world.ads if a["ad_id"] == s["ad_id"]), "paused_at": T0 + 5})
    deps.index = InMemoryTargetingIndex([a for a in ads if a.ad_id != paused.ad_id] + [paused], loaded_at=clock.t)
    r = client.get("/v1/click", params={"t": token_of(s["click_url"])}, follow_redirects=False)
    assert r.status_code == 302 and r.headers["location"] == paused.landing_url  # redirige igual
    [ck] = [e for e in deps.events.records if e["type"] == "click"]
    assert ck["billable"] is False and ck["price"] == 0.0 and deps.budget.spend_log == []
    assert metric(client, "ad_clicks_not_billed_total", reason="served_after_pause") == 1
    assert metric(client, "ad_click_revenue_usd_total") == 0
    assert paused.ad_id not in {a.ad_id for a in deps.index.candidates({"section": "deportes", "device": "mobile",
                                                                       "geo": "MX-NLE", "hour": 8})}


def test_click_after_a_later_pause_is_billed(make_client, world):
    ads = [Ad(**a) for a in world.ads]
    client, deps = make_client(ads=ads)  # serve a las T0
    s = served_ads(ask(client, request_id="req-paused-2"))[0]
    paused = Ad(**{**next(a for a in world.ads if a["ad_id"] == s["ad_id"]), "paused_at": T0 + 60})
    deps.index = InMemoryTargetingIndex([a for a in ads if a.ad_id != paused.ad_id] + [paused], loaded_at=T0)
    client.get("/v1/click", params={"t": token_of(s["click_url"])}, follow_redirects=False)
    [ck] = [e for e in deps.events.records if e["type"] == "click"]
    assert ck["billable"] is True and ck["price"] > 0  # la impresión fue legítima: se cobra


def test_index_age_is_exported(make_client, world):
    clock = Clock()
    client, deps = make_client(clock=clock)
    deps.index = InMemoryTargetingIndex([Ad(**a) for a in world.ads], loaded_at=T0 - 90)
    assert metric(client, "ad_index_age_seconds") == pytest.approx(90)


def test_click_without_kafka_ack_still_redirects_and_is_counted(make_client):
    client, _ = make_client(events=FailingClickLog())
    s = served_ads(ask(client, request_id="req-click-03"))[0]
    r = client.get("/v1/click", params={"t": token_of(s["click_url"])}, follow_redirects=False)
    assert r.status_code == 302
    assert metric(client, "ad_click_log_failures_total") == 1


# ------------------------------------------------------------------------------------------ contrato
def test_validation_error_does_not_echo_the_user_id(make_client):
    client, _ = make_client()
    r = client.post("/v1/ads", json={"section": "deportes", "device": "smart-tv", "user_id": "persona-secreta-123"})
    assert r.status_code == 422 and "persona-secreta-123" not in r.text
    assert metric(client, "ad_invalid_requests_total") == 1


def test_every_ad_metric_in_alerts_exists(make_client):
    client, _ = make_client()
    exposed = client.get("/metrics").text
    # Nombres de métricas del ad-api (terminan en _total, _bucket o _seconds; "ad_age" es un label)
    names = set(re.findall(r"\b(ad_[a-z_]+?_(?:total|bucket|seconds))\b", ALERTS.read_text()))
    assert len(names) >= 8
    base = {re.sub(r"_bucket$", "", n) for n in names}
    missing = [n for n in sorted(base) if f"# TYPE {n} " not in exposed]
    assert not missing, f"alerts.yml usa métricas que el ad-api no expone: {missing}"


def test_the_training_row_rebuilds_the_indices_the_model_scored(make_client):
    """Una definición de punta a punta: request → evento serve → build_training_set → features.py."""
    users = StaticUserFeatureStore({"u1": {"interests": ["autos", "salud", "deportes"]}})
    client, deps = make_client(users=users)
    out = ask(client, request_id="req-e2e-0001", user_id="u1", consent=True)
    s = served_ads(out)[0]
    serve = deps.events.records[-1]
    imp = {"type": "impression", "event_id": "i1", "imp_id": f"req-e2e-0001:{s['slot']}", "ts": T0 + 2}
    rows, _ = BTS.build([serve], [imp], [], as_of=T0 + 3 * 3600, cfg=BTS.LabelConfig(neg_rate=1.0))
    [row] = rows
    ad = deps.index.get(s["ad_id"])
    scored = F.encode_candidates(serve["context"], ["autos", "deportes"], [ad.attrs()])[0]
    assert np.array_equal(F.base_indices(row["raw"]), scored)
    assert np.array_equal(F.row_indices(row["raw"], row["slot"]),
                          np.concatenate([scored, F.position_indices(row["slot"], ad.ad_format)]))


def test_latency_and_candidates_with_2500_ads(trained_model):
    """Informativo: 2,500 anuncios con segmentación, presupuestos y pacing del mundo sintético."""
    big = synthetic.World(seed=5, n_ads=2500, n_advertisers=400, targeted=True)
    ads = [Ad(**a) for a in big.ads]
    events = BufferedEventLog()
    deps = Deps(index=InMemoryTargetingIndex(ads), freq=InMemoryFrequencyStore(Clock()),
                budget=InMemoryBudgetStore({c: CampaignBudget(**b) for c, b in big.budgets().items()}),
                users=StaticUserFeatureStore(), model=trained_model, fallback_ctr=SmoothedCTR({}, PRIORS),
                dedupe=InMemoryDedupeStore(Clock()), events=events, clock=Clock(),
                settings=Settings(token_keys=KEYS, token_kid="t1"))
    rng = np.random.default_rng(0)
    with TestClient(create_app(deps)) as client:
        lat = []
        for i in range(300):
            body = {"section": str(rng.choice(synthetic.SECTIONS)), "device": "mobile",
                    "geo": str(rng.choice(synthetic.GEOS)), "request_id": f"req-lat-{i:05d}"}
            lat.append(client.post("/v1/ads", json=body).json()["latency_ms"])
    cands = [e["candidates"] for e in events.records if e["type"] == "serve"]
    lat.sort()
    p50, p99 = lat[149], lat[296]
    print(f"\n2,500 anuncios: elegibles media {statistics.mean(cands):.0f} · latencia server p50 {p50:.1f} ms · "
          f"p99 {p99:.1f} ms (en esta máquina, todo en memoria)")
    assert 50 < statistics.mean(cands) < 300  # del orden de los ≈ 150 del caso
    assert p99 < 40
