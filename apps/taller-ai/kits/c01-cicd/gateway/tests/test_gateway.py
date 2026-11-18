"""Las pruebas del gateway: la tabla de códigos, los topes, el plazo, la salud, el log y las métricas.

    python -m pytest -q          # desde la carpeta del kit; ≈ 5 s, sin Triton

Contrato:
- Cada fila de la tabla de códigos tiene al menos una prueba: 200, 400, 405, 413 (header, al leer y por píxeles),
  415, 422, 499, 500, 503 (en vuelo, Triton con error, sin conexión) y 504.
- Revisan lo que le llega a Triton (nombre, tipo y forma del tensor) y lo que sale en el log y en /metrics.
- Ninguna necesita Triton ni red: usan TritonFalso (conftest.py).
"""
from __future__ import annotations

import asyncio
import json
import time

import aiohttp
import httpx
import numpy as np
import pytest
from fastapi.testclient import TestClient
from tritonclient.utils import InferenceServerException

from app.main import crear_app, leer_reglas
from conftest import TritonFalso, foto, png_solo_encabezado

JPEG = {"Content-Type": "image/jpeg"}


def cliente(reglas, modelo, **kw):
    t = TritonFalso(**kw)
    return TestClient(crear_app(triton=t, reglas=reglas, modelo=modelo)), t


def lineas(capsys) -> list[dict]:
    return [json.loads(x) for x in capsys.readouterr().out.splitlines() if x.startswith("{")]


# ---------------------------------------------------------------- 200
def test_200_top5_con_su_contrato(reglas, modelo, capsys):
    c, t = cliente(reglas, modelo)
    with c:
        r = c.post("/v1/classify", content=foto(), headers={**JPEG, "X-Request-ID": "abc123", "X-Client-Source": "mobile"})
    assert r.status_code == 200
    cuerpo = r.json()
    assert cuerpo["model_version"] == "miniresnet-2026-10-01"
    assert [p["label"] for p in cuerpo["predictions"]] == ["tenis", "botines", "sandalias", "playeras", "camisas"]
    assert abs(cuerpo["predictions"][0]["score"] - 0.512) < 1e-4
    assert r.headers["X-Request-ID"] == "abc123"
    assert t.vistos == [("input", "FP32", [1, 3, 32, 32], "abc123")]      # lo que le llega a Triton
    (ln,) = lineas(capsys)
    assert ln["status"] == 200 and ln["source"] == "mobile" and ln["top5"][0] == [7, 0.512]
    assert set(ln["ms"]) == {"pre", "triton", "post", "total"} and len(ln["sha256"]) == 12


@pytest.mark.parametrize("k", [1, 3, 10])
def test_top_k(reglas, modelo, k):
    c, _ = cliente(reglas, modelo)
    with c:
        p = c.post(f"/v1/classify?top_k={k}", content=foto(), headers=JPEG).json()["predictions"]
    assert len(p) == k and [x["score"] for x in p] == sorted((x["score"] for x in p), reverse=True)


@pytest.mark.parametrize("formato,tipo", [("PNG", "image/png"), ("WEBP", "image/webp")])
def test_200_png_y_webp(reglas, modelo, formato, tipo):
    c, _ = cliente(reglas, modelo)
    with c:
        assert c.post("/v1/classify", content=foto(formato), headers={"Content-Type": tipo}).status_code == 200


def test_request_id_nuevo_si_no_viene(reglas, modelo):
    c, _ = cliente(reglas, modelo)
    with c:
        a = c.post("/v1/classify", content=foto(), headers=JPEG).headers["X-Request-ID"]
        b = c.post("/v1/classify", content=foto(), headers=JPEG).headers["X-Request-ID"]
    assert a and b and a != b


def test_softmax_estable_con_logits_enormes(reglas, modelo):
    c, _ = cliente(reglas, modelo, logits=[1000.0 + x for x in [0.5, 0.1, 0.2, 0.0, 0.3, 1.0, 0.4, 3.0, 0.2, 2.0]])
    with c:
        r = c.post("/v1/classify", content=foto(), headers=JPEG)
    assert r.status_code == 200 and abs(r.json()["predictions"][0]["score"] - 0.512) < 1e-4


# ---------------------------------------------------------------- 4xx
@pytest.mark.parametrize("cuerpo,headers,codigo", [
    (b"%PDF-1.4", {"Content-Type": "application/pdf"}, 415),
    (b"x" * (10 * 1024 * 1024 + 1), JPEG, 413),            # el Content-Length lo delata
    (b"", JPEG, 400),
    (png_solo_encabezado(8000, 6000), {"Content-Type": "image/png"}, 413),   # 48 MP en ≈ 60 B
    (png_solo_encabezado(1, 4000), {"Content-Type": "image/png"}, 400),      # más alargada que 1:8
    (foto()[:20] + bytes(2000), JPEG, 400),                 # corrupta
    (foto()[: len(foto()) // 2], JPEG, 400),                # cortada
])
def test_rechazos(reglas, modelo, capsys, cuerpo, headers, codigo):
    c, t = cliente(reglas, modelo)
    with c:
        r = c.post("/v1/classify", content=cuerpo, headers=headers)
    assert r.status_code == codigo and r.headers["X-Request-ID"]
    assert t.vistos == []                                    # nada de eso llega a Triton
    assert lineas(capsys)[-1]["status"] == codigo


def test_413_sin_content_length_se_corta_al_leer(reglas, modelo):
    def trozos():
        for _ in range(11):
            yield b"x" * (1024 * 1024)
    c, _ = cliente(reglas, modelo)
    with c:
        r = c.post("/v1/classify", content=trozos(), headers=JPEG)    # un generador: va sin Content-Length
    assert r.status_code == 413


def test_422_top_k_fuera_de_rango_deja_su_linea(reglas, modelo, capsys):
    c, _ = cliente(reglas, modelo)
    with c:
        r = c.post("/v1/classify?top_k=50", content=foto(), headers=JPEG)
    assert r.status_code == 422 and r.headers["X-Request-ID"]
    assert lineas(capsys)[-1]["status"] == 422


def test_405_get(reglas, modelo, capsys):
    c, _ = cliente(reglas, modelo)
    with c:
        r = c.get("/v1/classify")
    assert r.status_code == 405 and r.headers["X-Request-ID"]
    assert lineas(capsys)[-1]["status"] == 405


def test_499_quien_llama_se_va(reglas, modelo, capsys):
    app = crear_app(triton=TritonFalso(), reglas=reglas, modelo=modelo)
    enviados = []

    async def correr():
        mensajes = iter([{"type": "http.request", "body": b"\xff\xd8" + b"x" * 100, "more_body": True},
                         {"type": "http.disconnect"}])

        async def recibir():
            return next(mensajes)

        async def enviar(m):
            enviados.append(m)

        alcance = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "POST", "scheme": "http",
                   "path": "/v1/classify", "raw_path": b"/v1/classify", "query_string": b"", "root_path": "",
                   "headers": [(b"content-type", b"image/jpeg"), (b"content-length", b"5000")],
                   "client": ("127.0.0.1", 1), "server": ("127.0.0.1", 8701)}
        async with app.router.lifespan_context(app):
            await app(alcance, recibir, enviar)

    asyncio.run(correr())
    assert lineas(capsys)[-1]["status"] == 499


# ---------------------------------------------------------------- 5xx
def test_500_logits_no_finitos(reglas, modelo, capsys):
    c, _ = cliente(reglas, modelo, logits=[float("nan")] + [0.0] * 9)
    with c:
        r = c.post("/v1/classify", content=foto(), headers=JPEG)
    assert r.status_code == 500
    assert lineas(capsys)[-1]["status"] == 500                # el log dice lo mismo que la respuesta


def test_503_triton_con_error(reglas, modelo):
    c, _ = cliente(reglas, modelo, error=InferenceServerException("Request timeout expired", status="503"))
    with c:
        assert c.post("/v1/classify", content=foto(), headers=JPEG).status_code == 503


def test_503_sin_conexion_con_retry_after(reglas, modelo):
    c, _ = cliente(reglas, modelo, error=aiohttp.ClientConnectionError("Connection refused"))
    with c:
        r = c.post("/v1/classify", content=foto(), headers=JPEG)
    assert r.status_code == 503 and r.headers["Retry-After"] == "1"


def test_504_triton_lento_se_corta_a_los_150_ms(reglas, modelo):
    c, _ = cliente(reglas, modelo, demora=2.0)
    with c:
        t = time.monotonic()
        r = c.post("/v1/classify", content=foto(), headers=JPEG)
        dt = time.monotonic() - t
    assert r.status_code == 504 and 0.14 < dt < 0.4


def test_503_la_17_en_vuelo(reglas, modelo):
    app = crear_app(triton=TritonFalso(demora=0.1), reglas=reglas, modelo=modelo)

    async def correr():
        async with app.router.lifespan_context(app):
            transporte = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transporte, base_url="http://gw") as c:
                rs = await asyncio.gather(*(c.post("/v1/classify", content=foto(), headers=JPEG) for _ in range(20)))
        return [r.status_code for r in rs], [r.headers.get("Retry-After") for r in rs if r.status_code == 503]

    codigos, retry = asyncio.run(correr())
    assert sorted(codigos) == [200] * 16 + [503] * 4 and retry == ["1"] * 4


# ---------------------------------------------------------------- salud, arranque, métricas
def test_healthz_no_pregunta_a_triton_y_readyz_si(reglas, modelo):
    c, _ = cliente(reglas, modelo, listo=False)
    with c:
        assert c.get("/healthz").status_code == 200
        assert c.get("/readyz").status_code == 503


def test_readyz_no_espera_mas_de_medio_segundo(reglas, modelo):
    c, _ = cliente(reglas, modelo, demora_listo=5.0)
    with c:
        t = time.monotonic()
        assert c.get("/readyz").status_code == 503
        assert time.monotonic() - t < 1.0


def test_no_arranca_si_los_labels_no_son_los_del_modelo(reglas, modelo):
    with pytest.raises(RuntimeError, match="logits"):
        with TestClient(crear_app(triton=TritonFalso(n_logits=9), reglas=reglas, modelo=modelo)):
            pass


def test_no_arranca_con_la_cadena_de_plazos_al_reves(tmp_path):
    from pathlib import Path

    import yaml

    r = yaml.safe_load((Path(__file__).resolve().parents[2] / "gateway.yaml").read_text())
    r["plazos_ms"]["triton"] = 400
    p = tmp_path / "gateway.yaml"
    p.write_text(yaml.safe_dump(r))
    with pytest.raises(RuntimeError, match="plazos"):
        leer_reglas(p)


def test_metricas_con_sus_nombres_y_sin_4xx_en_la_latencia(reglas, modelo):
    c, _ = cliente(reglas, modelo)
    with c:
        c.post("/v1/classify", content=foto(), headers=JPEG)
        for _ in range(3):
            c.post("/v1/classify", content=b"%PDF", headers={"Content-Type": "application/pdf"})
        m = c.get("/metrics").text
    for nombre in ("classifier_requests_total", "classifier_request_seconds", "classifier_preprocess_seconds",
                   "classifier_inference_seconds", "classifier_top1_score", "classifier_image_bytes"):
        assert nombre in m
    assert 'classifier_requests_total{code="415",model_version="miniresnet-2026-10-01",source="other"} 3.0' in m
    assert "classifier_request_seconds_count 1.0" in m       # solo el 200


def test_el_log_nunca_lleva_la_foto(reglas, modelo, capsys):
    c, _ = cliente(reglas, modelo)
    with c:
        c.post("/v1/classify", content=foto(), headers=JPEG)
    (ln,) = lineas(capsys)
    assert len(json.dumps(ln)) < 400 and "data" not in ln
    assert np.isclose(sum(s for _, s in ln["top5"]), 0.512 + 0.1883 + 0.0693 + 0.042 + 0.038, atol=1e-3)
