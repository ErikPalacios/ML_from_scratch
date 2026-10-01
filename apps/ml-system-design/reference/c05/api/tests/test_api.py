"""Tests de docs-api con TestClient y fakes: cada test es un camino que el entrevistador puede preguntar."""

import json
import logging
import re
import threading
import time
from pathlib import Path

import pytest
import yaml
from conftest import blur, document_image, jpeg, pdf, png
from fastapi.testclient import TestClient

import main

APP = "app-000123"


def post(client, files, doc_type="ine", application_id=APP):
    parts = [("files", (name, data, ctype)) for name, data, ctype in files]
    return client.post("/v1/documents", data={"application_id": application_id, "doc_type": doc_type}, files=parts)


def ine_files(ine_jpegs):
    # El nombre del archivo trae datos personales a propósito: no debe aparecer en ningún log.
    return [("INE_Juana_Perez_frente.jpg", ine_jpegs[0], "image/jpeg"),
            ("INE_Juana_Perez_reverso.jpg", ine_jpegs[1], "image/jpeg")]


# ------------------------------------------------------------------------------ camino feliz
def test_ine_dos_fotos_202_guarda_y_arranca(ctx, ine_jpegs, caplog):
    client, repo, store, starter, *_ = ctx
    caplog.set_level(logging.DEBUG)
    r = post(client, ine_files(ine_jpegs))
    assert r.status_code == 202, r.text
    doc_id = r.json()["document_id"]
    assert r.json() == {"document_id": doc_id, "status": "processing", "status_url": f"/v1/documents/{doc_id}"}
    keys = sorted(store.objects)
    assert len(keys) == 2 and all(re.match(rf"raw/{doc_id}/0[12]-[0-9a-f]{{16}}\.jpg$", k) for k in keys)
    # Una ejecución, con name = document_id y solo referencias en el input (nada de bytes ni campos).
    assert [c[0] for c in starter.calls] == [doc_id]
    payload = starter.calls[0][1]
    assert [p["key"] for p in payload["pages"]] == keys and payload["declared_type"] == "ine"
    assert len(json.dumps(payload).encode()) < 256 * 1024
    assert repo.get(doc_id).status == "processing"
    assert "Juana" not in caplog.text and "Perez" not in caplog.text


def test_status_y_aislamiento_entre_clientes(ctx, ine_jpegs):
    client, *_ = ctx
    doc_id = post(client, ine_files(ine_jpegs)).json()["document_id"]
    ok = client.get(f"/v1/documents/{doc_id}", params={"application_id": APP})
    assert ok.status_code == 200 and ok.json()["status"] == "processing"
    # Otro cliente que adivina el id recibe 404, no 403: no confirmamos que exista.
    assert client.get(f"/v1/documents/{doc_id}", params={"application_id": "app-999999"}).status_code == 404
    assert client.get("/v1/documents/no-existe", params={"application_id": APP}).status_code == 404


# ----------------------------------------------------------------------------------- dedupe
def test_mismo_archivo_dos_veces_mismo_id_una_sola_ejecucion(ctx, ine_jpegs):
    client, _, store, starter, *_ = ctx
    first = post(client, ine_files(ine_jpegs))
    again = post(client, ine_files(ine_jpegs))
    assert again.status_code == 200
    assert again.json()["document_id"] == first.json()["document_id"] and again.json()["duplicate"] is True
    assert len(starter.calls) == 1 and len(store.objects) == 2


def test_dedupe_por_cliente_no_global(ctx, ine_jpegs):
    # El mismo archivo de OTRO cliente es otro documento: un dedupe global le diría al cliente B que
    # alguien ya subió esa INE (fuga de información). El cruce entre clientes es una señal de fraude
    # interna, no una respuesta de la API.
    client, *_ = ctx
    a = post(client, ine_files(ine_jpegs)).json()["document_id"]
    b = post(client, ine_files(ine_jpegs), application_id="app-000456")
    assert b.status_code == 202 and b.json()["document_id"] != a


def test_orden_de_las_paginas_importa(ctx, ine_jpegs):
    client, *_ = ctx
    a = post(client, ine_files(ine_jpegs)).json()["document_id"]
    swapped = list(reversed(ine_files(ine_jpegs)))
    assert post(client, swapped).json()["document_id"] != a


def test_carrera_dos_requests_identicos_simultaneos(ctx, ine_jpegs):
    client, repo, store, starter, settings, app = ctx
    results = []

    def go():
        results.append(post(TestClient(app), ine_files(ine_jpegs)))

    threads = [threading.Thread(target=go) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    codes = sorted(r.status_code for r in results)
    assert codes.count(202) == 1 and codes.count(200) == 3
    assert len({r.json()["document_id"] for r in results}) == 1 and len(starter.calls) == 1


# ------------------------------------------------------------------------------ quality gate
def test_foto_borrosa_422_con_motivo_y_no_se_guarda(ctx):
    client, _, store, starter, _, app = ctx
    r = post(client, [("ine.jpg", jpeg(blur(document_image())), "image/jpeg")])
    assert r.status_code == 422
    body = r.json()
    assert body["error"] == "calidad_insuficiente"
    assert body["reasons"][0]["code"] == "borrosa" and body["reasons"][0]["page"] == 1
    assert "borrosa" in body["reasons"][0]["message"]
    assert store.objects == {} and starter.calls == []
    m = client.get("/metrics").text
    assert 'docs_quality_rejections_total{doc_type="ine",reason="borrosa"} 1.0' in m
    assert 'docs_uploads_total{doc_type="ine",outcome="rejected_quality"} 1.0' in m


def test_motivos_por_pagina(ctx, ine_jpegs):
    client, *_ = ctx
    r = post(client, [("a.jpg", ine_jpegs[0], "image/jpeg"), ("b.png", png(document_image(h=360, w=480)), "image/png")])
    assert r.status_code == 422
    assert [(x["code"], x["page"]) for x in r.json()["reasons"]] == [("baja_resolucion", 2)]


def test_gate_dentro_de_3_segundos_con_foto_de_12_mp(ctx):
    client, *_ = ctx
    big = jpeg(document_image(h=3000, w=4000, seed=5))
    t0 = time.perf_counter()
    r = post(client, [("ine.jpg", big, "image/jpeg")])
    elapsed = time.perf_counter() - t0
    assert r.status_code == 202, r.text
    assert elapsed < 3.0  # medido en una laptop; en el pod se mide con docs_upload_seconds


def test_imagen_con_demasiados_pixeles(ctx):
    client, repo, store, starter, settings, app = ctx
    small_limit = main.create_app(main.Settings(max_image_pixels=1_000_000), repo, store, starter)
    r = post(TestClient(small_limit), [("ine.jpg", jpeg(document_image()), "image/jpeg")])
    assert r.status_code == 422 and r.json()["error"] == "imagen_demasiado_grande"


def test_imagen_danada(ctx, ine_jpegs):
    client, *_ = ctx
    truncated = ine_jpegs[0][:2000]  # empieza como JPEG y se corta
    r = post(client, [("ine.jpg", truncated, "image/jpeg")])
    assert r.status_code == 422 and r.json()["error"] == "imagen_danada"


# ------------------------------------------------------------------------------- PDF y XML
def test_pdf_estado_de_cuenta(ctx):
    client, _, store, *_ = ctx
    r = post(client, [("estado.pdf", pdf(8), "application/pdf")], doc_type="estado_cuenta")
    assert r.status_code == 202 and list(store.objects)[0].endswith(".pdf")


@pytest.mark.parametrize("data,code", [
    (pdf(3, password="rfc-del-cliente"), "pdf_protegido"),
    (pdf(51), "demasiadas_paginas"),
    (b"%PDF-1.7\nesto no es un PDF", "pdf_danado"),
])
def test_pdf_rechazados(ctx, data, code):
    client, *_ = ctx
    r = post(client, [("x.pdf", data, "application/pdf")], doc_type="estado_cuenta")
    assert r.status_code == 422 and r.json()["error"] == code


def test_xml_cfdi_valido(ctx, cfdi_xml):
    client, _, store, starter, *_ = ctx
    r = post(client, [("factura.xml", cfdi_xml, "text/xml")], doc_type="factura")
    assert r.status_code == 202 and list(store.objects)[0].endswith(".xml")


def test_xml_que_no_es_cfdi(ctx):
    client, *_ = ctx
    r = post(client, [("f.xml", b"<?xml version='1.0'?><factura/>", "text/xml")], doc_type="factura")
    assert r.status_code == 422 and r.json()["error"] == "xml_no_cfdi"


def test_xml_solo_para_facturas(ctx, cfdi_xml):
    client, *_ = ctx
    r = post(client, [("ine.xml", cfdi_xml, "text/xml")], doc_type="ine")
    assert r.status_code == 415


# ------------------------------------------------------------------------------- tipo y tamaño
def test_el_content_type_del_cliente_no_se_cree(ctx, ine_jpegs):
    client, *_ = ctx
    r = post(client, [("ine.pdf", ine_jpegs[0], "application/pdf")])  # dice PDF, es JPEG: manda el contenido
    assert r.status_code == 202


@pytest.mark.parametrize("data,code", [
    (b"\x00\x00\x00\x18ftypheic\x00\x00\x00\x00", "heic"),
    (b"MZ\x90\x00 ejecutable", "tipo_no_soportado"),
])
def test_tipos_no_soportados(ctx, data, code):
    client, *_ = ctx
    r = post(client, [("foto", data, "image/jpeg")])
    assert r.status_code == 415 and r.json()["error"] == code


def test_combinaciones_invalidas(ctx, ine_jpegs):
    client, *_ = ctx
    mixed = [("a.pdf", pdf(1), "application/pdf"), ("b.jpg", ine_jpegs[0], "image/jpeg")]
    assert post(client, mixed).json()["error"] == "combinacion_invalida"
    eleven = [(f"{i}.jpg", ine_jpegs[0], "image/jpeg") for i in range(11)]
    assert post(client, eleven).json()["error"] == "combinacion_invalida"


def test_archivo_demasiado_grande(ctx, ine_jpegs):
    client, repo, store, starter, settings, app = ctx
    tight = TestClient(main.create_app(main.Settings(max_file_bytes=len(ine_jpegs[0]) - 1), repo, store, starter))
    r = post(tight, [("ine.jpg", ine_jpegs[0], "image/jpeg")])
    assert r.status_code == 413


def test_request_demasiado_grande_se_corta_por_content_length(ctx, ine_jpegs):
    client, repo, store, starter, settings, app = ctx
    tight = TestClient(main.create_app(main.Settings(max_request_bytes=1000), repo, store, starter))
    r = post(tight, ine_files(ine_jpegs))
    assert r.status_code == 413 and r.json()["error"] == "archivo_muy_grande"


def test_campos_del_formulario_validados(ctx, ine_jpegs):
    client, *_ = ctx
    assert post(client, ine_files(ine_jpegs), application_id="x").status_code == 422  # patrón
    assert post(client, ine_files(ine_jpegs), doc_type="pasaporte").status_code == 422  # enum


# ------------------------------------------------------------------------- nunca perder nada
def test_falla_s3_503_y_el_reintento_reusa_el_id(ctx, ine_jpegs):
    client, repo, store, starter, *_ = ctx
    store.fail = True
    r = post(client, ine_files(ine_jpegs))
    assert r.status_code == 503 and r.headers["retry-after"] == "5"
    store.fail = False
    again = post(client, ine_files(ine_jpegs))
    assert again.status_code == 202
    assert repo.find(APP, repo.get(again.json()["document_id"]).sha256).status == "processing"
    assert len(starter.calls) == 1


def test_falla_start_execution_202_igual_y_el_barrido_lo_arranca(ctx, ine_jpegs):
    client, repo, store, starter, settings, app = ctx
    starter.fail = True
    r = post(client, ine_files(ine_jpegs))
    assert r.status_code == 202  # el documento ya está en S3 y en la base: no se pierde
    doc_id = r.json()["document_id"]
    assert repo.get(doc_id).status == "received" and starter.calls == []
    assert "docs_execution_start_failures_total 1.0" in client.get("/metrics").text
    starter.fail = False
    import datetime as dt
    n = main.resume_unstarted(repo, starter, app.state.metrics, min_age=dt.timedelta(0))
    assert n == 1 and repo.get(doc_id).status == "processing" and starter.calls[0][0] == doc_id


# ------------------------------------------------------------------------------------ operación
def test_health_ready_y_metricas_en_cero(ctx):
    client, *_ = ctx
    assert client.get("/healthz").json() == {"status": "ok"}
    assert client.get("/readyz").status_code == 200
    m = client.get("/metrics").text
    # Series creadas en 0 al arrancar: sin esto, increase() no ve el primer rechazo.
    assert 'docs_uploads_total{doc_type="factura",outcome="rejected_quality"} 0.0' in m
    assert 'docs_oldest_unfinished_age_seconds{phase="automatic"} 0.0' in m


def test_backlog_gauge_ve_documentos_atascados(ctx, ine_jpegs):
    client, repo, store, starter, *_ = ctx
    starter.fail = True  # quedó en "received": nadie lo procesa
    post(client, ine_files(ine_jpegs))
    time.sleep(0.05)
    m = client.get("/metrics").text
    age = float(re.search(r'docs_oldest_unfinished_age_seconds\{phase="automatic"\} ([0-9.e+-]+)', m).group(1))
    assert age > 0


# ------------------------------------------------------------------------- contrato con alertas
ALERTS = Path(__file__).resolve().parents[2] / "monitoring" / "alerts.yml"
# Métricas que publican OTROS componentes (no incluidos en esta carpeta): doc-worker, review-api y la
# herramienta de auditoría. Si una alerta usa una docs_* que no está ni aquí ni en docs-api, es un typo.
EXTERNAL = {
    "docs_stage_attempts_total",  # doc-worker
    "docs_routing_decisions_total",  # doc-worker (etapa route)
    "docs_ocr_word_confidence_bucket", "docs_ocr_word_confidence_count",  # doc-worker (etapa ocr)
    "docs_sat_requests_total",  # doc-worker (etapa validate)
    "docs_review_open_tasks",  # review-api
    "docs_audit_fields_total",  # herramienta de auditoría de QA
}


def test_cada_metrica_docs_de_las_alertas_existe(ctx):
    client, *_ = ctx
    exposed = set(re.findall(r"^(docs_[a-z_]+?)(?:\{| )", client.get("/metrics").text, flags=re.M))
    used = set()
    for group in yaml.safe_load(ALERTS.read_text(encoding="utf-8"))["groups"]:
        for rule in group["rules"]:
            used |= set(re.findall(r"\b(docs_[a-z_]+)\b", rule["expr"]))
    missing = used - exposed - EXTERNAL
    assert not missing, f"métricas usadas en alerts.yml que nadie publica: {missing}"
    assert {"docs_uploads_total", "docs_oldest_unfinished_age_seconds"} <= used


def test_input_de_la_ejecucion_coincide_con_el_contrato_de_init(ctx, ine_jpegs):
    """Init (statemachine.asl.json) reconstruye el estado con rutas '$.x' del input: si docs-api deja de
    mandar una, la ejecución falla en el primer estado. Este test amarra los dos lados."""
    client, repo, store, starter, *_ = ctx
    post(client, ine_files(ine_jpegs))
    payload = starter.calls[0][1]
    asl = json.loads((Path(__file__).resolve().parents[2] / "orchestration" / "statemachine.asl.json").read_text())
    expected = {v[2:] for k, v in asl["States"]["Init"]["Parameters"].items() if k.endswith(".$")}
    assert expected == set(payload)
