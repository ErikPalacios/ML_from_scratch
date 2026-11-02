"""Tests de search/api.py con fakes: cada test es un modo de falla o una regla del caso.

Sin GPU, sin shards reales, sin OpenSearch, sin Redis. Los fakes (search/fakes.py) simulan latencia y
errores. Las métricas son globales (como en producción): los tests miden DIFERENCIAS.
"""

import json
import logging
import re
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from prometheus_client import REGISTRY

import api
import fakes

JPEG = b"\xff\xd8\xff" + "chamarra de mezclilla".encode()  # "foto" de juguete: firma JPEG + texto


def client(deps=None, raise_server_exceptions=True, **settings):
    return TestClient(api.create_app(deps or fakes.demo_deps(), api.Settings(**settings)),
                      raise_server_exceptions=raise_server_exceptions)


def text(c, q, **params):
    return c.post("/v1/search", params=params, json={"q": q})


def metric(name, **labels):
    return REGISTRY.get_sample_value(name, labels) or 0.0


# ---------------------------------------------------------------------------- camino feliz
def test_texto_hibrido_con_desglose_de_latencia_y_version():
    r = text(client(), "chamarra de mezclilla talla M")
    assert r.status_code == 200
    body = r.json()
    assert body["model_version"] == "2026-09-15-clip-ft-v7"
    assert body["query_type"] == "text" and body["degraded"] == []
    assert {"encode", "ann", "bm25", "fusion", "tombstones", "texts", "rerank", "total"} <= set(body["latency_ms"])
    top = body["results"][0]
    assert top["listing_id"] in {"L1", "L11"}  # las chamarras de mezclilla
    assert set(top["sources"]) == {"ann", "bm25"}  # salió en las dos listas: RRF lo premia
    assert [x["rank"] for x in body["results"]] == list(range(1, len(body["results"]) + 1))


def test_vendido_no_aparece_aunque_siga_en_el_indice():
    before = metric("search_tombstoned_results_total")
    ids = [x["listing_id"] for x in text(client(), "chamarra de mezclilla Levi's").json()["results"]]
    assert "L2" not in ids  # L2 está en el índice y en BM25, pero tiene tombstone
    assert metric("search_tombstoned_results_total") > before


def test_filtros_viajan_a_los_motores_y_se_cumplen():
    deps = fakes.demo_deps()
    body = text(client(deps), "chamarra vintage", city="GDL", price_max=1000).json()
    assert body["results"] and all(fakes.DEMO[int(x["listing_id"][1:]) - 1][4] == "GDL" for x in body["results"])
    k, f = deps.shards[0].requests[0]
    assert f == {"city": "GDL", "price_max": 1000.0} and k == 200  # filtro DENTRO de la búsqueda, k normal


def test_filtro_sin_resultados_devuelve_pagina_vacia_y_se_cuenta():
    before = metric("search_zero_results_total", query_type="text")
    r = text(client(), "chamarra", category_id=999)
    assert r.status_code == 200
    assert r.json()["results"] == [] and r.json()["has_more"] is False
    assert metric("search_zero_results_total", query_type="text") == before + 1


def test_condicion_multiple_en_query_string():
    r = client().post("/v1/search?condition=new&condition=like_new", json={"q": "chamarra iphone funda"})
    conds = {fakes.DEMO[int(x["listing_id"][1:]) - 1][5] for x in r.json()["results"]}
    assert conds and conds <= {"new", "like_new"}


# ---------------------------------------------------------------------------- fallbacks
def test_encoder_lento_cae_a_solo_bm25_dentro_del_presupuesto():
    deps = fakes.demo_deps()
    deps.encoder.delay_s = 2.0  # GPU saturada
    t0 = time.perf_counter()
    r = text(client(deps), "chamarra de mezclilla")
    assert time.perf_counter() - t0 < 0.5  # cortó en el timeout (50 ms), no esperó 2 s
    body = r.json()
    assert r.status_code == 200 and body["results"]
    assert "encode_timeout" in body["degraded"] and "ann_unavailable" in body["degraded"]
    assert body["model_version"] is None  # no se usó ningún embedding
    assert all(set(x["sources"]) == {"bm25"} for x in body["results"])


def test_shards_lentos_no_pasan_del_timeout():
    deps = fakes.demo_deps()
    for sh in deps.shards:
        sh.delay_s = 1.0
    t0 = time.perf_counter()
    body = text(client(deps), "chamarra").json()
    assert time.perf_counter() - t0 < 0.5  # 4 shards en PARALELO con timeout 80 ms, no 4 × 1 s
    assert "ann_unavailable" in body["degraded"]


def test_un_shard_caido_da_resultados_parciales():
    deps = fakes.demo_deps()
    deps.shards[1].fail = True
    before = metric("search_ann_shard_errors_total", shard="shard-1", reason="error")
    body = text(client(deps), "chamarra").json()
    assert "ann_partial:shard-1" in body["degraded"] and body["results"]
    assert body["model_version"] is not None
    assert metric("search_ann_shard_errors_total", shard="shard-1", reason="error") == before + 1


def test_bm25_caido_sirve_solo_ann():
    deps = fakes.demo_deps()
    deps.keyword.fail = True
    body = text(client(deps), "chamarra de mezclilla").json()
    assert "bm25_error" in body["degraded"] and body["results"]
    assert all(set(x["sources"]) == {"ann"} for x in body["results"])


def test_todo_caido_es_503_con_retry_after():
    deps = fakes.demo_deps()
    deps.keyword.fail = True
    deps.encoder.fail = True
    r = text(client(deps), "chamarra")
    assert r.status_code == 503 and r.headers["retry-after"] == "2"


def test_tombstones_caidos_se_sirve_igual_y_se_cuenta():
    deps = fakes.demo_deps()
    deps.tombstones.fail = True
    before = metric("search_tombstone_checks_total", outcome="failed")
    body = text(client(deps), "chamarra de mezclilla Levi's").json()
    assert "tombstones_unchecked" in body["degraded"]
    assert "L2" in [x["listing_id"] for x in body["results"]]  # el vendido se coló: por eso hay alerta
    assert metric("search_tombstone_checks_total", outcome="failed") == before + 1


# ---------------------------------------------------------------------------- versiones de modelo
def test_shard_con_otro_modelo_se_descarta():
    deps = fakes.demo_deps()
    deps.shards[0].model_version = "2026-06-01-clip-ft-v6"  # quedó apuntando al índice viejo
    before = metric("search_ann_shard_errors_total", shard="shard-0", reason="model_version_mismatch")
    body = text(client(deps), "chamarra").json()
    assert "ann_partial:shard-0" in body["degraded"]
    assert metric("search_ann_shard_errors_total", shard="shard-0", reason="model_version_mismatch") == before + 1


def test_readyz_es_local_y_no_depende_de_versiones_ni_de_dependencias():
    # Si /readyz mirara versiones o dependencias compartidas, un swap del alias (o Triton caído) sacaría a
    # TODOS los pods del Service a la vez, y con ellos el camino de BM25 que sí funcionaba.
    deps = fakes.demo_deps()
    deps.shards[2].model_version = "otro"
    deps.encoder.fail = True
    r = client(deps).get("/readyz")
    assert r.status_code == 200 and r.json()["ready"] is True


def test_la_version_sale_del_alias_y_se_pide_al_encoder():
    deps = fakes.demo_deps()
    body = text(client(deps), "chamarra").json()
    assert body["model_version"] == fakes.V7 and deps.encoder.calls == [fakes.V7]


def test_swap_del_alias_cambia_la_version_pedida_sin_reiniciar():
    deps = fakes.demo_deps()
    deps.encoder.versions = {fakes.V7, "v8"}  # durante el cambio, Triton tiene las dos cargadas
    c = client(deps, alias_cache_s=0)  # sin caché: el test no espera 5 s
    assert text(c, "chamarra").json()["model_version"] == fakes.V7
    deps.alias.version = "v8"  # swap atómico del alias: los shards ya contestan desde listings-vec-v8
    for sh in deps.shards:
        sh.model_version = "v8"
    body = text(c, "chamarra").json()
    assert body["model_version"] == "v8" and deps.encoder.calls[-1] == "v8"
    assert body["degraded"] == []


def test_encoder_sin_la_version_del_alias_cae_a_bm25():
    deps = fakes.demo_deps()
    deps.alias.version = "v8"  # el alias ya apunta a v8, pero Triton todavía no la cargó
    before = metric("search_degraded_total", reason="encoder_version_unavailable")
    body = text(client(deps), "chamarra de mezclilla").json()
    assert "encoder_version_unavailable" in body["degraded"] and body["model_version"] is None
    assert body["results"] and all(set(x["sources"]) == {"bm25"} for x in body["results"])
    assert metric("search_degraded_total", reason="encoder_version_unavailable") == before + 1
    r = client(deps).post("/v1/search", content=JPEG, headers={"content-type": "image/jpeg"})
    assert r.status_code == 503  # la foto no tiene fallback


def test_alias_que_no_contesta_usa_la_ultima_version_conocida():
    deps = fakes.demo_deps()
    c = client(deps, alias_cache_s=0)
    assert text(c, "chamarra").json()["model_version"] == fakes.V7
    deps.alias.fail = True
    assert text(c, "chamarra").json()["model_version"] == fakes.V7  # última conocida
    # Sin ninguna conocida (pod recién arrancado): no se adivina, solo BM25
    deps2 = fakes.demo_deps()
    deps2.alias.fail = True
    body = text(client(deps2), "chamarra").json()
    assert "alias_unavailable" in body["degraded"] and body["model_version"] is None


def test_shard_de_otro_modelo_invalida_el_cache_del_alias():
    deps = fakes.demo_deps()
    c = client(deps)  # caché de 5 s
    text(c, "chamarra")
    reads = deps.alias.reads
    deps.shards[0].model_version = "v8"
    text(c, "chamarra")  # shard-0 contesta con otro modelo → se descarta y se invalida el caché
    text(c, "chamarra")
    assert deps.alias.reads == reads + 1  # releyó el alias sin esperar los 5 s


# ---------------------------------------------------------------------------- filtros: la trampa
def test_shard_que_solo_post_filtra_recibe_overfetch_y_se_filtra_aqui():
    deps = fakes.demo_deps()
    for sh in deps.shards:
        sh.supports_inline_filter = False
    before = sum(metric("search_postfilter_underfilled_total", shard=sh.name) for sh in deps.shards)
    body = text(client(deps), "chamarra", city="MER").json()
    k, f = deps.shards[0].requests[0]
    assert k == 800 and f == {}  # 200 × overfetch 4, sin filtro: el motor no sabe filtrar
    assert [x["listing_id"] for x in body["results"]] == ["L11"]  # la única chamarra en Mérida
    after = sum(metric("search_postfilter_underfilled_total", shard=sh.name) for sh in deps.shards)
    assert after == before + 4  # 1 resultado de 200 pedidos: el post-filtro no alcanza (y se ve)


def test_adaptador_que_ignora_el_filtro_no_llega_a_la_persona():
    deps = fakes.demo_deps()

    class Buggy(fakes.FakeShard):
        async def search(self, vector, k, filters):  # dice que filtra, pero ignora el filtro
            return await super().search(vector, k, {})

    deps.shards = [Buggy(sh.name, sh.items) for sh in deps.shards]
    before = metric("search_filter_violations_total")
    body = text(client(deps), "chamarra", city="QRO").json()
    assert {fakes.DEMO[int(x["listing_id"][1:]) - 1][4] for x in body["results"]} == {"QRO"}
    assert metric("search_filter_violations_total") > before


# ---------------------------------------------------------------------------- rerank
def test_el_reranker_lee_textos_del_cache_aunque_las_fuentes_no_traigan_titulo():
    # Los hits del ANN y de BM25 traen id, score y atributos, no títulos (como un índice que llena
    # embed-worker). Si el reranker leyera Hit.title, re-ordenaría pares (consulta, "") al azar.
    deps = fakes.demo_deps()
    text(client(deps), "chamarra de mezclilla talla M")
    assert deps.reranker.texts and all(t.strip() for t in deps.reranker.texts[0])
    assert "Chamarra de mezclilla vintage talla M" in deps.reranker.texts[0]


def test_cache_de_textos_caido_conserva_el_orden_de_rrf():
    deps = fakes.demo_deps()
    plain = [x["listing_id"] for x in text(client(deps, rerank_top_n=0), "chamarra vintage").json()["results"]]
    deps.texts.fail = True
    body = text(client(deps), "chamarra vintage").json()
    assert "texts_error" in body["degraded"] and "rerank_skipped" in body["degraded"]
    assert [x["listing_id"] for x in body["results"]] == plain and deps.reranker.seen == []


def test_sin_texto_en_el_cache_se_queda_en_su_lugar():
    deps = fakes.demo_deps()
    plain = [x["listing_id"] for x in text(client(deps, rerank_top_n=0), "chamarra vintage talla").json()["results"]]
    deps.texts.missing = {plain[0]}
    before = metric("search_rerank_missing_text_total")
    body = text(client(deps), "chamarra vintage talla").json()
    assert body["results"][0]["listing_id"] == plain[0]  # no se re-ordenó: no hay con qué
    assert "rerank_score" not in body["results"][0]
    assert metric("search_rerank_missing_text_total") == before + 1


def test_rerank_solo_top_30_y_solo_pagina_0():
    deps = fakes.demo_deps()
    c = client(deps, rerank_top_n=3)
    body = text(c, "chamarra de mezclilla talla M").json()
    assert deps.reranker.seen == [3]
    assert sum("rerank_score" in x for x in body["results"]) == 3
    text(c, "chamarra", page=1)
    assert deps.reranker.seen == [3]  # la página 1 no cambia con el rerank del top-3: no se paga GPU


def test_rerank_lento_conserva_el_orden_de_rrf():
    deps = fakes.demo_deps()
    plain = [x["listing_id"] for x in text(client(deps, rerank_top_n=0), "chamarra vintage").json()["results"]]
    deps.reranker.delay_s = 1.0
    body = text(client(deps), "chamarra vintage").json()
    assert "rerank_skipped" in body["degraded"]
    assert [x["listing_id"] for x in body["results"]] == plain


def test_paginacion():
    c = client(page_size=2)
    p0 = text(c, "chamarra vintage talla").json()
    p1 = text(c, "chamarra vintage talla", page=1).json()
    assert p0["has_more"] and [x["rank"] for x in p1["results"]] == [3, 4]
    assert not {x["listing_id"] for x in p0["results"]} & {x["listing_id"] for x in p1["results"]}


# ---------------------------------------------------------------------------- foto
def test_foto_va_solo_por_ann_sin_bm25_ni_rerank():
    deps = fakes.demo_deps()
    r = client(deps).post("/v1/search", content=JPEG, headers={"content-type": "image/jpeg"})
    body = r.json()
    assert r.status_code == 200 and body["query_type"] == "photo"
    assert body["results"] and all(set(x["sources"]) == {"ann"} for x in body["results"])
    assert deps.reranker.seen == []


def test_foto_sin_encoder_es_503():
    deps = fakes.demo_deps()
    deps.encoder.fail = True
    r = client(deps).post("/v1/search", content=JPEG, headers={"content-type": "image/jpeg"})
    assert r.status_code == 503  # una foto no tiene fallback de palabras clave


@pytest.mark.parametrize("content,ctype,status", [
    (b"no soy una imagen", "image/jpeg", 400),  # firma inválida: no se manda a la GPU
    (JPEG, "image/gif", 415),
    (b"\xff\xd8\xff" + b"0" * 2000, "image/jpeg", 413),  # max_image_bytes=1000 en este test
])
def test_errores_de_foto(content, ctype, status):
    r = client(max_image_bytes=1000).post("/v1/search", content=content, headers={"content-type": ctype})
    assert r.status_code == status


def test_errores_de_texto_y_filtros():
    c = client()
    assert text(c, "   ").status_code == 400
    assert text(c, "x" * 300).status_code == 400
    assert text(c, "chamarra", price_min=900, price_max=100).status_code == 422
    assert c.post("/v1/search", content=b"{", headers={"content-type": "application/json"}).status_code == 400


# ---------------------------------------------------------------------------- log sin PII
def test_scrub_pii_enmascara_telefonos_y_correos():
    q = "iphone 13 128 gb llámame al 33 1234 5678 o a ana.lopez+venta@example.com.mx"
    assert api.scrub_pii(q) == "iphone 13 128 gb llámame al [tel] o a [email]"
    assert api.scrub_pii("tenis nike talla 27 270") == "tenis nike talla 27 270"  # números cortos quedan
    assert api.scrub_pii("(33) 1234-5678") == "[tel]"


def test_el_log_de_busqueda_no_lleva_pii():
    lines = []

    class Grab(logging.Handler):
        def emit(self, record):
            lines.append(record.getMessage())

    h = Grab()
    api.log.addHandler(h)
    try:
        text(client(), "chamarra llámame 33 1234 5678 ana@example.com")
    finally:
        api.log.removeHandler(h)
    entry = json.loads(lines[-1])
    assert entry["q"] == "chamarra llámame [tel] [email]"
    assert "5678" not in lines[-1] and "example.com" not in lines[-1]


def test_error_inesperado_se_cuenta_como_500(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("bug")

    monkeypatch.setattr(api, "rrf", boom)
    before = metric("search_requests_total", query_type="text", status="500")
    r = text(client(raise_server_exceptions=False), "chamarra")
    assert r.status_code == 500
    assert metric("search_requests_total", query_type="text", status="500") == before + 1


def test_metricas_por_tipo_y_status():
    before = metric("search_requests_total", query_type="text", status="200")
    text(client(), "chamarra")
    assert metric("search_requests_total", query_type="text", status="200") == before + 1
    assert metric("search_request_duration_seconds_bucket", query_type="text", le="0.3") > 0


def test_contrato_de_metricas_con_alerts_yml():
    alerts = (Path(__file__).resolve().parents[2] / "monitoring" / "alerts.yml").read_text()
    # (?<![:\w]): ignora los nombres de recording rules (search:embed_worker_lag_seconds no es una métrica)
    used = set(re.findall(r"(?<![:\w])(search_[a-z0-9_]+?)(?:_bucket|_count|_sum)?\b", alerts))
    text(client(), "chamarra")  # crea las series con labels
    exported = {m.name for m in REGISTRY.collect()} | {m.name + "_total" for m in REGISTRY.collect()}
    assert used, "alerts.yml debería usar métricas de search-api"
    assert used <= exported, used - exported
