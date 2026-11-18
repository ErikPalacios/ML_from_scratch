"""El gateway de classifier: recibe la foto, la revisa, la prepara, le pide los logits a Triton con plazo y contesta.

    En la estación 8 corre dentro de su imagen (gateway/Dockerfile). Viene dado: aquí no se escribe código del gateway.
    La imagen es la misma en todos los ambientes; lo único que cambia es la configuración: TRITON_URL (variable de
    entorno) le dice a qué Triton hablar y, si no está, usa la url de gateway.yaml.

Contrato:
- crear_app(triton=None, reglas=None, modelo=None) devuelve la app; `app = crear_app()` es la que corre uvicorn.
  Las pruebas le pasan un Triton falso, sus reglas y su ficha del modelo.
- Las reglas salen de gateway.yaml (al crear la app). Si la cadena de plazos no va de mayor a menor
  (app > gateway > triton > fila_triton), no arranca.
- El lifespan, una vez y antes de atender: lee servir/modelo.json y revisa la huella de sus labels; crea UN cliente de
  Triton para todo el proceso (tritonclient.http.aio, con el pool de gateway.yaml); le pide a Triton la metadata del
  modelo y revisa que la entrada y la salida sean las de la ficha y que haya tantos logits como labels. Si algo no
  cuadra, el proceso no arranca. Al apagarse, cierra el cliente.
- GET /healthz: {"status": "ok"} si el proceso responde. No le pregunta a nadie más.
- GET /readyz: 200 si Triton dice que el modelo está listo dentro de listo_timeout_ms; si no, 503.
- GET /metrics: las métricas de Prometheus, con estos nombres (las alertas y el análisis del canary los buscan así):
  classifier_requests_total{code, source, model_version}, classifier_request_seconds (sin los 4xx),
  classifier_preprocess_seconds, classifier_inference_seconds, classifier_top1_score, classifier_image_bytes,
  classifier_requests_in_flight, classifier_top1_label_total{label} (estación 10: para el PSI) y
  classifier_shadow_total{resultado} (estación 10: ok, plazo, error, llena).
- Estación 10, la sombra: si hay SOMBRA_URL (y SOMBRA_VERSION, SOMBRA_FRACCION), el lifespan crea un Sombra
  (gateway/app/sombra.py, lo escribes tú) con la sección «sombra» de gateway.yaml y lo arranca; después del preproceso,
  classify llama sombra.copiar(x, request_id) y sigue sin esperar. Al apagarse, sombra.parar().
- POST /v1/classify?top_k=N (N de gateway.yaml; fuera de rango, 422 de FastAPI), con los bytes de la foto:
  · request_id del header X-Request-ID o uno nuevo; X-Client-Source (mobile, web, internal u other) solo para métricas;
    X-Caller-Id (en C01 sale del token que verificó el ALB).
  · La 17 en vuelo (en_vuelo de gateway.yaml) recibe 503 + Retry-After: 1 al instante, sin leer el body.
  · La revisión de revision.py, en orden: 415, 413 por header, 413 al leer, 400 vacía, 413 por píxeles, 400 por forma.
  · El decode, en un hilo, con un semáforo de `decodes` lugares; quien espera más de espera_cpu_ms recibe 503 +
    Retry-After: 1. Si el decode falla, 400.
  · Triton con plazo min(triton, lo que le queda a la request de su plazo gateway); si ya no queda, 504 sin llamar.
    Se corta con asyncio.wait_for (el `timeout` de infer() es otra cosa: un tiempo para la fila del servidor).
    Triton no contesta a tiempo: 504. Sin conexión: 503 + Retry-After: 1. Triton contesta con error: 503. Sin reintentos.
  · Logits no finitos: 500, nunca un 200 con basura. Softmax estable (restando el máximo), top_k y labels.
  · 200: {"model_version", "predictions": [{"label", "score" (4 decimales)}], "latency_ms"}.
  · Quien llama se fue a media subida: 499.
- Toda respuesta lleva X-Request-ID (también los errores, el 422 y el 405).
- Una línea de JSON por request en stdout (en un finally), también para el 422, el 499 y el 405: request_id, caller,
  source, model_version, top5 [[índice, score]], ms {pre, triton, post, total}, bytes, sha256 (12 caracteres), status y,
  si falló, error. Nunca la foto.
"""
from __future__ import annotations

import asyncio
import os
import hashlib
import json
import sys
import time
import uuid
import warnings
from contextlib import asynccontextmanager
from pathlib import Path

import aiohttp
import numpy as np
import yaml
from fastapi import FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from prometheus_client import CONTENT_TYPE_LATEST, CollectorRegistry, Counter, Gauge, Histogram, generate_latest
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.requests import ClientDisconnect
from tritonclient.http.aio import InferenceServerClient, InferInput, InferRequestedOutput
from tritonclient.utils import InferenceServerException

from .revision import Rechazo, leer_body, preparar, revisar_imagen, revisar_largo, revisar_tipo
from .sombra import Sombra

RAIZ = Path(__file__).resolve().parents[2]
FUENTES = {"mobile", "web", "internal", "other"}


def leer_reglas(p: Path = RAIZ / "gateway.yaml") -> dict:
    r = yaml.safe_load(p.read_text())
    pl = r["plazos_ms"]
    if not pl["app"] > pl["gateway"] > pl["triton"] > pl["fila_triton"] > 0:
        raise RuntimeError(f"gateway.yaml: la cadena de plazos tiene que bajar (app > gateway > triton > fila_triton) "
                           f"y es {pl['app']} > {pl['gateway']} > {pl['triton']} > {pl['fila_triton']}")
    return r


def leer_modelo(p: Path = RAIZ / "servir" / "modelo.json") -> dict:
    if not p.exists():
        raise RuntimeError("falta servir/modelo.json: python servir/armar.py")
    m = json.loads(p.read_text())
    huella = hashlib.sha256((json.dumps(m["labels"], ensure_ascii=False) + "\n").encode()).hexdigest()
    if huella != m["labels_sha256"]:
        raise RuntimeError(f"servir/modelo.json: los labels tienen huella {huella[:12]}… y la ficha dice {m['labels_sha256'][:12]}…")
    return m


def metricas(registro: CollectorRegistry) -> dict:
    ms = (0.005, 0.01, 0.02, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.5, 1.0)
    return {
        "requests": Counter("classifier_requests_total", "Requests por código, fuente y versión del modelo",
                            ["code", "source", "model_version"], registry=registro),
        "latencia": Histogram("classifier_request_seconds", "Latencia total (sin los 4xx)", buckets=ms, registry=registro),
        "pre": Histogram("classifier_preprocess_seconds", "Decode y preprocess", buckets=ms, registry=registro),
        "inferencia": Histogram("classifier_inference_seconds", "La llamada a Triton", buckets=ms, registry=registro),
        "top1": Histogram("classifier_top1_score", "El score de la primera sugerencia",
                          buckets=(0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99), registry=registro),
        "bytes": Histogram("classifier_image_bytes", "Tamaño de la foto",
                           buckets=(1e3, 1e4, 1e5, 3e5, 1e6, 3e6, 1e7), registry=registro),
        "en_vuelo": Gauge("classifier_requests_in_flight", "Requests adentro ahora", registry=registro),
        "top1_label": Counter("classifier_top1_label_total", "Fotos por categoría que va primero (para el PSI)",
                              ["label"], registry=registro),
        "sombra": Counter("classifier_shadow_total", "Copias a la sombra por resultado", ["resultado"], registry=registro),
    }


def crear_app(triton=None, reglas: dict | None = None, modelo: dict | None = None) -> FastAPI:
    r = reglas or leer_reglas()
    lim, pl, tr, ct = r["limites"], r["plazos_ms"], r["triton"], r["contrato"]
    url_triton = os.environ.get("TRITON_URL", tr["url"])     # lo que cambia entre ambientes: la configuración, no la imagen
    from PIL import Image

    Image.MAX_IMAGE_PIXELS = lim["max_pixeles"]          # la red de Pillow: avisa arriba de esto, se niega arriba del doble
    warnings.simplefilter("ignore", Image.DecompressionBombWarning)   # el aviso sobra: el paso de píxeles ya dio 413

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        m = modelo or leer_modelo()
        cliente = triton or InferenceServerClient(url=url_triton, conn_limit=tr["conexiones"])
        try:
            meta = await cliente.get_model_metadata(tr["modelo"])
        except Exception as e:  # noqa: BLE001
            await cliente.close()
            raise RuntimeError(f"no pude leer la metadata de '{tr['modelo']}' en Triton ({url_triton}): {e}") from None
        ent, sal = meta["inputs"][0], meta["outputs"][0]
        if ent["name"] != m["entrada"]["nombre"] or ent["shape"] != m["entrada"]["forma"] or sal["name"] != m["salida"]["nombre"]:
            await cliente.close()
            raise RuntimeError(f"Triton sirve {ent['name']} {ent['shape']} → {sal['name']} y la ficha dice "
                               f"{m['entrada']['nombre']} {m['entrada']['forma']} → {m['salida']['nombre']}")
        if sal["shape"][-1] != len(m["labels"]):
            await cliente.close()
            raise RuntimeError(f"el modelo da {sal['shape'][-1]} logits y hay {len(m['labels'])} labels")
        app.state.modelo, app.state.triton = m, cliente
        app.state.cpu = asyncio.Semaphore(lim["decodes"])
        app.state.en_vuelo = 0
        for lb in m["labels"]:                               # cada categoría existe desde el arranque, aunque valga 0
            mt["top1_label"].labels(lb)
        app.state.sombra = None
        if os.environ.get("SOMBRA_URL"):                     # estación 10: la copia al challenger (gateway/app/sombra.py)
            cs = r.get("sombra", {})
            app.state.sombra = Sombra(url=os.environ["SOMBRA_URL"], modelo=tr["modelo"], entrada=m["entrada"]["nombre"],
                                      salida=m["salida"]["nombre"], version=os.environ.get("SOMBRA_VERSION", "?"),
                                      fraccion=float(os.environ.get("SOMBRA_FRACCION", "0.10")),
                                      cola=cs.get("cola", 64), plazo_ms=cs.get("plazo_ms", 150),
                                      trabajadores=cs.get("trabajadores", 2), contar=lambda res: mt["sombra"].labels(res).inc())
            await app.state.sombra.arrancar()
            print(f"sombra prendida · {app.state.sombra.version} · {app.state.sombra.fraccion:.0%} · {os.environ['SOMBRA_URL']}",
                  file=sys.stderr, flush=True)
        print(f"gateway listo · {m['model_version']} · {len(m['labels'])} labels · Triton {url_triton}", file=sys.stderr, flush=True)
        yield
        if app.state.sombra:
            await app.state.sombra.parar()
        await cliente.close()

    app = FastAPI(lifespan=lifespan, title="classifier gateway")
    registro = CollectorRegistry()                       # uno por app: las pruebas crean varias en el mismo proceso
    mt = metricas(registro)

    def anotar(ev: dict, status: int, fuente: str, version: str, t0: float) -> None:
        ev["status"] = status
        ev.setdefault("ms", {})["total"] = round((time.monotonic() - t0) * 1000, 1)
        print(json.dumps(ev, ensure_ascii=False), flush=True)
        mt["requests"].labels(str(status), fuente, version).inc()
        if not 400 <= status < 500:                          # un 415 tarda microsegundos: no baja el p99 de nadie
            mt["latencia"].observe(time.monotonic() - t0)

    def contexto(request: Request) -> tuple[str, dict, str]:
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex
        fuente = request.headers.get("x-client-source", "other")
        fuente = fuente if fuente in FUENTES else "other"
        version = getattr(request.app.state, "modelo", {}).get("model_version", "?")
        ev = {"request_id": rid, "caller": request.headers.get("x-caller-id", "desconocido"), "source": fuente,
              "model_version": version}
        return rid, ev, fuente

    @app.exception_handler(RequestValidationError)
    async def invalida(request: Request, exc: RequestValidationError):        # el 422 pasa antes de classify
        t0 = time.monotonic()
        rid, ev, fuente = contexto(request)
        ev["error"] = "; ".join(f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors())
        anotar(ev, 422, fuente, ev["model_version"], t0)
        return JSONResponse({"error": ev["error"], "request_id": rid}, 422, headers={"X-Request-ID": rid})

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException):      # 404, 405
        t0 = time.monotonic()
        rid, ev, fuente = contexto(request)
        ev["error"] = str(exc.detail)
        anotar(ev, exc.status_code, fuente, ev["model_version"], t0)
        return JSONResponse({"error": exc.detail, "request_id": rid}, exc.status_code,
                            headers={"X-Request-ID": rid, **(exc.headers or {})})

    @app.get("/healthz")
    async def healthz():
        return {"status": "ok"}

    @app.get("/readyz")
    async def readyz(request: Request):
        try:
            listo = await asyncio.wait_for(request.app.state.triton.is_model_ready(tr["modelo"]), tr["listo_timeout_ms"] / 1000)
        except Exception:  # noqa: BLE001 — sin respuesta a tiempo o sin conexión: no listo
            listo = False
        return JSONResponse({"status": "ready" if listo else "not ready"}, 200 if listo else 503)

    @app.get("/metrics")
    async def metrics():
        return Response(generate_latest(registro), media_type=CONTENT_TYPE_LATEST)

    @app.post(ct["ruta"])
    async def classify(request: Request,
                       top_k: int = Query(ct["top_k"]["defecto"], ge=ct["top_k"]["min"], le=ct["top_k"]["max"])):
        t0 = time.monotonic()
        st = request.app.state
        rid, ev, fuente = contexto(request)
        version = st.modelo["model_version"]
        hdr = {"X-Request-ID": rid}
        ms = ev["ms"] = {}
        if st.en_vuelo >= lim["en_vuelo"]:                   # load shedding: rechazar cuesta microsegundos
            ev["error"] = f"{lim['en_vuelo']} requests en vuelo"
            anotar(ev, 503, fuente, version, t0)
            return JSONResponse({"error": ev["error"], "request_id": rid}, 503, headers={**hdr, "Retry-After": "1"})
        st.en_vuelo += 1
        mt["en_vuelo"].inc()
        status = 500
        try:
            revisar_tipo(request.headers.get("content-type"), ct["tipos"])
            revisar_largo(request.headers.get("content-length"), lim["max_bytes"])
            data = await leer_body(request, lim["max_bytes"])
            ev["bytes"], ev["sha256"] = len(data), hashlib.sha256(data).hexdigest()[:12]
            mt["bytes"].observe(len(data))
            revisar_imagen(data, lim["max_pixeles"], lim["max_proporcion"])
            try:
                await asyncio.wait_for(st.cpu.acquire(), lim["espera_cpu_ms"] / 1000)
            except TimeoutError:
                raise Rechazo(503, f"sin lugar de decode en {lim['espera_cpu_ms']} ms", reintentar=True) from None
            try:
                t = time.monotonic()
                x = await run_in_threadpool(preparar, data)      # en un hilo: el event loop sigue atendiendo
                ms["pre"] = round((time.monotonic() - t) * 1000, 1)
                mt["pre"].observe(time.monotonic() - t)
            finally:
                st.cpu.release()
            if st.sombra:                                    # la copia: nunca espera, nunca cambia lo que contesta
                st.sombra.copiar(x, rid)
            queda = pl["gateway"] / 1000 - (time.monotonic() - t0)
            if queda <= 0:
                raise Rechazo(504, f"se acabó el plazo de {pl['gateway']} ms antes de llamar a Triton")
            plazo = min(pl["triton"] / 1000, queda)
            entrada = InferInput(st.modelo["entrada"]["nombre"], [1, *x.shape], "FP32")
            entrada.set_data_from_numpy(x[None], binary_data=True)
            salida = st.modelo["salida"]["nombre"]
            t = time.monotonic()
            try:
                res = await asyncio.wait_for(
                    st.triton.infer(tr["modelo"], [entrada], outputs=[InferRequestedOutput(salida, binary_data=True)],
                                    request_id=rid), plazo)
            except TimeoutError:
                raise Rechazo(504, f"Triton no contestó en {plazo * 1000:.0f} ms") from None
            except InferenceServerException as e:
                raise Rechazo(503, f"Triton: {e.message()}") from None
            except (aiohttp.ClientError, OSError) as e:
                raise Rechazo(503, f"sin conexión con Triton ({type(e).__name__})", reintentar=True) from None
            finally:
                ms["triton"] = round((time.monotonic() - t) * 1000, 1)
            mt["inferencia"].observe(time.monotonic() - t)
            t = time.monotonic()
            z = res.as_numpy(salida)[0].astype(np.float64)
            if not np.all(np.isfinite(z)):
                raise Rechazo(500, "logits no finitos")
            e = np.exp(z - z.max())                               # softmax estable: restar el máximo no cambia nada
            p = e / e.sum()
            orden = np.argsort(-p, kind="stable")
            labels = st.modelo["labels"]
            ev["top5"] = [[int(i), round(float(p[i]), 4)] for i in orden[:5]]
            mt["top1"].observe(float(p[orden[0]]))
            mt["top1_label"].labels(labels[orden[0]]).inc()
            ms["post"] = round((time.monotonic() - t) * 1000, 1)
            status = 200
            return JSONResponse({"model_version": version,
                                 "predictions": [{"label": labels[i], "score": round(float(p[i]), 4)} for i in orden[:top_k]],
                                 "latency_ms": round((time.monotonic() - t0) * 1000, 1)}, headers=hdr)
        except Rechazo as e:
            status, ev["error"] = e.codigo, e.motivo
            return JSONResponse({"error": e.motivo, "request_id": rid}, e.codigo,
                                headers={**hdr, **({"Retry-After": "1"} if e.reintentar else {})})
        except ClientDisconnect:
            status, ev["error"] = 499, "quien llama cerró la conexión a media subida"
            return Response(status_code=499, headers=hdr)
        except Exception as e:  # noqa: BLE001 — un error del propio código: 500, y que quede en el log
            status, ev["error"] = 500, f"{type(e).__name__}: {str(e)[:200]}"
            return JSONResponse({"error": "error interno", "request_id": rid}, 500, headers=hdr)
        finally:
            st.en_vuelo -= 1
            mt["en_vuelo"].dec()
            anotar(ev, status, fuente, version, t0)

    return app


app = crear_app()
