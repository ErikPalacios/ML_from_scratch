"""Tests del home-api con fakes: fuentes lentas o caídas, feature store incompleto, Triton que falla, Kafka colgado.

Las métricas de prometheus_client son globales al proceso: los tests miden DIFERENCIAS (antes/después).
"""

import asyncio
import json
import re
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from prometheus_client import REGISTRY

import home_api as h

C08 = Path(__file__).resolve().parents[2]
SCHEMA = h.FeatureSchema("fs-2026-09-28", user_defaults=(0.0, 0.0, 0.0, 0.0),
                         item_defaults=(0.0, 0.0, 0.02, 0.0, 0.0, 0.0))  # 0.02 = prior global de CTR


def item(i: int) -> h.Candidate:
    """Catálogo sintético: 300 vendedores, 40 categorías; 1 de cada 10 ítems en otra ciudad sin envíos."""
    return h.Candidate(
        item_id=f"i{i}", seller_id=f"s{i % 300}", category=f"c{i % 40}",
        city="gdl" if i % 10 == 9 else "cdmx", ships=i % 10 != 9, age_h=float(i % 72),
        seller_is_new=(i % 300) % 50 == 0, retrieval_score=1.0 / (1 + i),
    )


class FakeUsers:
    def __init__(self, ctx=None, delay=0.0, exc=None):
        self.ctx = ctx or h.UserContext(user_id="u1", city="cdmx", recent_items=("i1", "i2"))
        self.delay, self.exc, self.served = delay, exc, {}

    async def get(self, user_id):
        await asyncio.sleep(self.delay)
        if self.exc:
            raise self.exc
        served = frozenset(self.served.get(user_id, ()))
        return h.UserContext(**{**self.ctx.__dict__, "user_id": user_id,
                                "served_this_session": self.ctx.served_this_session | served})

    async def add_served(self, user_id, item_ids):
        self.served.setdefault(user_id, set()).update(item_ids)


class FakeSource:
    def __init__(self, name, ids, delay=0.0, exc=None):
        self.name, self.ids, self.delay, self.exc, self.calls = name, list(ids), delay, exc, 0

    async def fetch(self, user, k):
        self.calls += 1
        await asyncio.sleep(self.delay)
        if self.exc:
            raise self.exc
        return [item(i) for i in self.ids[:k]]


class FakeAvailability:
    def __init__(self, sold=(), delay=0.0):
        self.sold, self.delay = set(sold), delay

    async def unavailable(self, item_ids):
        await asyncio.sleep(self.delay)
        return {i for i in item_ids if i in self.sold}


class FakeFeatures:
    def __init__(self, missing=(), delay=0.0, version=SCHEMA.version, user_missing=False, broken=False,
                 unavailable=()):
        self.missing, self.delay, self.version, self.unavailable = set(missing), delay, version, set(unavailable)
        self.user_missing, self.broken, self.calls = user_missing, broken, []

    async def get(self, user_id, item_ids):
        self.calls.append(len(item_ids))
        await asyncio.sleep(self.delay)
        items = {i: [float(int(i[1:]) % 7), 1.0, 0.03, 0.0, 0.5, 1.0] for i in item_ids if i not in self.missing}
        return h.FeatureBatch(self.version, None if self.user_missing else [0.1, 0.2, 0.3, 0.4],
                              ["no", "es", "un", "dict"] if self.broken else items,
                              unavailable={i for i in item_ids if i in self.unavailable})


class FakeRanker:
    def __init__(self, delay=0.0, exc=None, wrong_shape=False):
        self.delay, self.exc, self.wrong_shape, self.calls = delay, exc, wrong_shape, 0

    async def score(self, user, context, items):
        self.calls += 1
        await asyncio.sleep(self.delay)
        if self.exc:
            raise self.exc
        n = len(items) - (1 if self.wrong_shape else 0)
        # P(click) depende de la primera feature del ítem: los defaults (0.0) quedan abajo
        return h.RankerOutput("ranker-2026-09-30", [0.01 + 0.02 * items[j][0] for j in range(n)],
                              [0.1] * n)


class FakePopular:
    def __init__(self, loaded=True):
        self._loaded = loaded
        self.lists = {"cdmx": [item(i) for i in range(2000, 2200)], "_national": [item(i) for i in range(3000, 3200)]}

    def get(self, city):
        return self.lists.get(city, [])

    def loaded(self):
        return self._loaded


class FakeKafka:
    def __init__(self, delay=0.0):
        self.sent, self.delay = [], delay

    async def publish(self, topic, key, value):
        await asyncio.sleep(self.delay)
        self.sent.append((topic, key, json.loads(value)))


def make(**over):
    srcs = over.pop("sources", None) or [
        FakeSource("two_tower", range(0, 500)),
        FakeSource("covisitation", range(300, 600)),  # 300–499 repetidos con two_tower: dedupe
        FakeSource("trending_city", range(600, 700)),
        FakeSource("followed", range(700, 800)),
    ]
    deps = h.Deps(
        users=over.pop("users", FakeUsers()), sources=srcs,
        availability=over.pop("availability", FakeAvailability()),
        features=over.pop("features", FakeFeatures()), ranker=over.pop("ranker", FakeRanker()),
        popular=over.pop("popular", FakePopular()), impressions=over.pop("kafka", FakeKafka()),
        schema=SCHEMA,
    )
    return deps, h.create_app(deps, h.Settings())


def val(name, **labels):
    return REGISTRY.get_sample_value(name, labels) or 0.0


def flush(client):
    """Espera a que el publicador vacíe el buffer (corre en el loop del TestClient)."""
    st = client.app.state.st
    for _ in range(200):
        if st.queue.qsize() == 0:
            time.sleep(0.01)
            return
        time.sleep(0.01)


def get(client, **params):
    params.setdefault("user_id", "u1")
    return client.get("/v1/home", params=params, headers={"x-request-id": params.pop("rid", "req-1")})


# ---------------------------------------------------------------------------- camino feliz
def test_happy_path_50_items_with_snapshot_logged():
    deps, app = make()
    with TestClient(app) as c:
        r = get(c)
        flush(c)
    assert r.status_code == 200
    body = r.json()
    assert body["request_id"] == "req-1" and body["path"] == "ranked" and body["fallback_reason"] is None
    assert body["model_version"] == "ranker-2026-09-30"
    ids = [it["item_id"] for it in body["items"]]
    assert len(ids) == 50 and len(set(ids)) == 50
    assert [it["position"] for it in body["items"]] == list(range(1, 51))
    # Lo que se rankeó: los 800 únicos (dedupe de 300–499) menos los 80 de otra ciudad sin envíos
    assert deps.features.calls == [720]
    # El registro de impresión: request_id, posición, fuente, versión del modelo y el SNAPSHOT
    (topic, key, rec), = deps.impressions.sent
    assert topic == "home-impressions" and key == "u1"
    assert rec["request_id"] == "req-1" and rec["model_version"] == "ranker-2026-09-30"
    assert rec["feature_set_version"] == SCHEMA.version and rec["user_features"] == [0.1, 0.2, 0.3, 0.4]
    assert rec["filtered"] == {"geo": 80}
    logged = {e["item_id"]: e for e in rec["items"]}
    assert set(logged) == set(ids)
    for e in rec["items"]:
        assert len(e["features"]) == 6 and e["features_defaulted"] is False
        assert e["source"] in h.SOURCES and e["source"] == e["sources"][0]
        assert 0 <= e["p_click"] <= 1 and e["position"] >= 1


def test_duplicates_keep_every_source():
    merged, sources, best = h.merge_candidates({
        "two_tower": [item(1), item(2)], "covisitation": [item(2), item(3)], "followed": [item(2)]})
    assert [c.item_id for c in merged] == ["i1", "i2", "i3"]
    assert sources["i2"] == ["two_tower", "covisitation", "followed"]  # la fuente principal va primero
    assert best["i2"] == 0  # 1° en covisitation y en followed, 2° en two_tower → mejor rank 0


def test_combine_is_expected_contact_plus_small_click_weight():
    assert h.combine(0.10, 0.20, 0.05) == pytest.approx(0.10 * 0.25)
    # Un ítem muy clickeable que casi nunca genera contacto pierde contra uno menos clickeable que sí
    assert h.combine(0.30, 0.01, 0.05) < h.combine(0.10, 0.30, 0.05)


# ---------------------------------------------------------------------------- fuentes
def test_slow_source_is_dropped_and_counted_not_waited_for():
    slow = FakeSource("two_tower", range(0, 500), delay=0.5)
    srcs = [slow, FakeSource("covisitation", range(300, 600)), FakeSource("trending_city", range(600, 700)),
            FakeSource("followed", range(700, 800))]
    before = val("home_source_timeouts_total", source="two_tower")
    deps, app = make(sources=srcs)
    with TestClient(app) as c:
        t = time.perf_counter()
        r = get(c)
        elapsed = time.perf_counter() - t
        flush(c)
    assert r.status_code == 200 and r.json()["path"] == "ranked"
    assert elapsed < 0.2  # no esperó los 500 ms de la fuente lenta
    assert val("home_source_timeouts_total", source="two_tower") == before + 1
    rec = deps.impressions.sent[0][2]
    assert rec["sources_failed"] == {"two_tower": "timeout"}
    assert all(it["source"] != "two_tower" for it in r.json()["items"])


def test_all_sources_down_serves_popular_in_city():
    srcs = [FakeSource(n, [], exc=ConnectionError()) for n in h.SOURCES]
    before = val("home_fallback_total", reason="no_candidates")
    deps, app = make(sources=srcs)
    with TestClient(app) as c:
        body = get(c).json()
        flush(c)
    assert body["path"] == "popular" and body["fallback_reason"] == "no_candidates"
    assert [it["item_id"] for it in body["items"]][:3] == ["i2000", "i2001", "i2002"]  # la lista de cdmx
    assert len(body["items"]) == 50 and not any(it["exploration"] for it in body["items"])
    assert val("home_fallback_total", reason="no_candidates") == before + 1
    rec = deps.impressions.sent[0][2]
    assert rec["path"] == "popular" and rec["user_features"] is None  # sin snapshot: no es un ejemplo de training


def test_user_context_down_serves_national_popular():
    deps, app = make(users=FakeUsers(exc=ConnectionError()))
    with TestClient(app) as c:
        body = get(c).json()
    assert body["path"] == "popular" and body["fallback_reason"] == "user_context_unavailable"
    assert body["items"][0]["item_id"] == "i3000"


# ---------------------------------------------------------------------------- features y ranker
def test_missing_item_features_use_defaults_and_are_counted():
    missing = {f"i{i}" for i in range(0, 100)}
    before = val("home_feature_defaults_total", entity="item")
    deps, app = make(features=FakeFeatures(missing=missing))
    with TestClient(app) as c:
        get(c)
        flush(c)
    n_missing = len([i for i in range(0, 100) if i % 10 != 9])  # los de otra ciudad ya se filtraron
    assert val("home_feature_defaults_total", entity="item") == before + n_missing
    rec = deps.impressions.sent[0][2]
    for e in rec["items"]:  # lo logueado es EXACTAMENTE lo que vio el ranker, defaults incluidos
        if e["item_id"] in missing:
            assert e["features_defaulted"] and e["features"] == list(SCHEMA.item_defaults)


def test_missing_user_features_use_defaults():
    deps, app = make(features=FakeFeatures(user_missing=True))
    with TestClient(app) as c:
        get(c)
        flush(c)
    rec = deps.impressions.sent[0][2]
    assert rec["user_features"] == list(SCHEMA.user_defaults) and rec["user_features_defaulted"] is True


def test_feature_schema_version_mismatch_does_not_rank():
    deps, app = make(features=FakeFeatures(version="fs-2026-08-01"))
    with TestClient(app) as c:
        body = get(c).json()
    assert body["path"] == "heuristic" and body["fallback_reason"] == "features_unavailable"
    assert deps.ranker.calls == 0


def test_slow_feature_store_falls_back_to_heuristic_order():
    deps, app = make(features=FakeFeatures(delay=0.3))
    with TestClient(app) as c:
        t = time.perf_counter()
        body = get(c).json()
        assert time.perf_counter() - t < 0.2
    assert body["path"] == "heuristic" and body["fallback_reason"] == "features_unavailable"


def test_ranker_error_serves_real_candidates_without_exploration():
    before = val("home_fallback_total", reason="ranker_error")
    deps, app = make(ranker=FakeRanker(exc=RuntimeError("triton 503")))
    with TestClient(app) as c:
        body = get(c).json()
        flush(c)
    assert body["path"] == "heuristic" and body["fallback_reason"] == "ranker_error"
    assert len(body["items"]) == 50 and not any(it["exploration"] for it in body["items"])
    assert val("home_fallback_total", reason="ranker_error") == before + 1
    # Orden heurístico: intercala el 1° de cada fuente (los scores de retrieval no se comparan entre fuentes).
    # i300 e i600 también son 1° de su fuente, pero son del vendedor s0 como i0: el tope de 1 por vendedor
    # en la primera pantalla los baja. Los topes del re-rank se aplican también en el fallback.
    assert [it["item_id"] for it in body["items"][:3]] == ["i0", "i700", "i1"]
    rec = deps.impressions.sent[0][2]
    assert rec["model_version"] is None and "features" not in rec["items"][0]


def test_slow_ranker_times_out_inside_the_budget():
    deps, app = make(ranker=FakeRanker(delay=1.0))
    with TestClient(app) as c:
        t = time.perf_counter()
        body = get(c).json()
        elapsed = time.perf_counter() - t
    assert body["fallback_reason"] == "ranker_timeout" and elapsed < 0.2


def test_ranker_with_wrong_output_shape_is_not_trusted():
    deps, app = make(ranker=FakeRanker(wrong_shape=True))
    with TestClient(app) as c:
        body = get(c).json()
    assert body["fallback_reason"] == "ranker_error"


def test_pipeline_bug_still_answers_with_popular():
    before = val("home_fallback_total", reason="internal_error")
    deps, app = make(features=FakeFeatures(broken=True))  # items no es un dict → AttributeError
    with TestClient(app) as c:
        r = get(c)
    assert r.status_code == 200 and r.json()["fallback_reason"] == "internal_error"
    assert val("home_fallback_total", reason="internal_error") == before + 1


# ---------------------------------------------------------------------------- filtros
def test_filters_sold_blocked_own_geo_seen():
    ctx = h.UserContext(user_id="s5", city="cdmx", blocked_sellers=frozenset({"s7"}),
                        seen_counts={"i11": 3, "i12": 2})
    deps, app = make(users=FakeUsers(ctx), availability=FakeAvailability(sold={"i0", "i1", "i2"}))
    with TestClient(app) as c:
        get(c, user_id="s5")
        flush(c)
    rec = deps.impressions.sent[0][2]
    f = rec["filtered"]
    # s5 vende i5, i305 (dentro de 0–799: i5, i305, i605) → own_listing; s7 → i7, i307, i607 bloqueados
    assert f["own_listing"] == 3 and f["blocked"] == 3 and f["seen_cap"] == 1 and f["sold"] == 3
    shown = {e["item_id"] for e in rec["items"]}
    assert not shown & {"i0", "i1", "i2", "i5", "i7", "i11", "i9"}


def test_tombstone_store_down_uses_the_status_from_the_feature_store():
    # El store de tombstones no contesta; el feature store dice que i6 e i13 están vendidos (i6 e i13
    # tienen el score más alto del fake: estarían arriba)
    before = val("home_filtered_total", reason="availability_check_failed")
    deps, app = make(availability=FakeAvailability(sold={"i0"}, delay=0.5),
                     features=FakeFeatures(unavailable={"i6", "i13"}))
    with TestClient(app) as c:
        t = time.perf_counter()
        body = get(c).json()
        assert time.perf_counter() - t < 0.2
        flush(c)
    assert body["path"] == "ranked"
    shown = {it["item_id"] for it in body["items"]}
    assert "i6" not in shown and "i13" not in shown
    assert deps.impressions.sent[0][2]["filtered"]["sold"] == 2
    assert val("home_filtered_total", reason="availability_check_failed") == before + 1


def test_candidates_are_logged_for_a_sample_of_requests():
    deps, _ = make()
    s = h.Settings()
    s.candidate_log_rate = 1.0  # en producción 1 %: aquí todos, para verlo
    app = h.create_app(deps, s)
    with TestClient(app) as c:
        get(c)
        flush(c)
    cands = deps.impressions.sent[0][2]["candidates"]
    assert len(cands) == 800  # TODOS los únicos, antes de filtrar: recall@k por fuente se mide contra esto
    by_id = {x["item_id"]: x["sources"] for x in cands}
    assert by_id["i350"] == ["two_tower", "covisitation"] and by_id["i9"] == ["two_tower"]
    deps2, _ = make()
    s.candidate_log_rate = 0.0
    with TestClient(h.create_app(deps2, s)) as c:
        get(c)
        flush(c)
    assert deps2.impressions.sent[0][2]["candidates"] is None


def test_page_two_continues_without_repeating_page_one():
    deps, app = make()
    with TestClient(app) as c:
        p1 = get(c, rid="r-p1").json()
        time.sleep(0.05)  # add_served corre en segundo plano
        p2 = get(c, page=2, rid="r-p2").json()
    ids1 = {it["item_id"] for it in p1["items"]}
    ids2 = {it["item_id"] for it in p2["items"]}
    assert not ids1 & ids2
    assert [it["position"] for it in p2["items"]][:2] == [51, 52]  # posición global en el scroll


# ---------------------------------------------------------------------------- exploración
def test_exploration_is_about_5_percent_and_deterministic_per_request():
    deps, app = make()
    explored = total = 0
    with TestClient(app) as c:
        for k in range(80):
            items = get(c, user_id=f"u{k}", rid=f"req-{k}").json()["items"]
            explored += sum(it["exploration"] for it in items)
            total += len(items)
        a = get(c, user_id="ux", rid="same").json()["items"]
        flush(c)
    # Mismo usuario y mismo request_id en un proceso nuevo (sin el estado de sesión que dejó `a`)
    with TestClient(make()[1]) as c2:
        b = get(c2, user_id="ux", rid="same").json()["items"]
    assert 0.03 < explored / total < 0.07  # 4,000 posiciones con ε = 5 %
    assert a == b  # mismo request_id → misma página (se puede reproducir un reclamo)
    rec = next(r for _, _, r in deps.impressions.sent if any(e["exploration"] for e in r["items"]))
    e = next(e for e in rec["items"] if e["exploration"])
    assert 0 < e["propensity"] < 0.05  # ε × 1/|pool|: lo que necesita la evaluación off-policy


# ---------------------------------------------------------------------------- Kafka y salud
def test_hanging_kafka_does_not_slow_requests():
    deps, app = make(kafka=FakeKafka(delay=10))
    with TestClient(app) as c:
        t = time.perf_counter()
        for k in range(5):
            assert get(c, rid=f"k-{k}").status_code == 200
        assert time.perf_counter() - t < 1.0
        assert c.app.state.st.queue.qsize() >= 4  # esperando en el buffer, no en el request
        c.app.state.st.queue = asyncio.Queue()  # para que el apagado no espere 5 s


def test_full_buffer_drops_and_counts():
    s = h.Settings()
    s.impression_buffer = 1
    deps, _ = make()
    deps.impressions = FakeKafka(delay=10)
    app = h.create_app(deps, s)
    before = val("home_impression_log_dropped_total")
    with TestClient(app) as c:
        for k in range(4):
            get(c, rid=f"d-{k}")
        c.app.state.st.queue = asyncio.Queue()
    assert val("home_impression_log_dropped_total") >= before + 2


def test_readiness_needs_the_popular_cache():
    _, app = make(popular=FakePopular(loaded=False))
    with TestClient(app) as c:
        assert c.get("/healthz").status_code == 200
        assert c.get("/readyz").status_code == 503
    _, app = make()
    with TestClient(app) as c:
        assert c.get("/readyz").status_code == 200


def test_every_metric_used_by_alerts_exists():
    """Contrato con monitoring/alerts.yml: cada home_* que usan las alertas existe en /metrics."""
    _, app = make()
    with TestClient(app) as c:
        get(c)
        exposed = c.get("/metrics").text
    rules = (C08 / "monitoring" / "alerts.yml").read_text(encoding="utf-8")
    rules = re.sub(r"^\s*#.*$", "", rules, flags=re.M)  # los comentarios citan archivos (home_api.py), no métricas
    used = set(re.findall(r"\b(home_[a-z_]+?)(?:_bucket|_count|_sum)?\b", rules))
    assert used, "alerts.yml debería usar métricas home_*"
    for m in sorted(used):
        assert re.search(rf"^{m}(_bucket|_count|_sum|_total)?[{{ ]", exposed, re.M), f"falta {m} en /metrics"
