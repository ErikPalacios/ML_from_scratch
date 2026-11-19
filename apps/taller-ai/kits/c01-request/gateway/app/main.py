"""El gateway de classifier, release 15 (el de las estaciones 6 a 10). Viene dado: aquí no se escribe código del gateway,
salvo su rastro (gateway/app/rastro.py), que escribes tú.

    python mundo/nodo.py arrancar        # corre dos copias (pods), gateway-a en el nodo a y gateway-b en el nodo b

Lo que cambia en la estación 11: todo lo que la request deja escrito sale de rastro.py. main.py le pide:
- request_id(header) y fuente(header, fuentes) al empezar cada request (también el 422, el 404 y el 405);
- un Rastro(registro, reglas) por app, con sus métricas en ese registro;
- rastro.en_vuelo (un Gauge) al entrar y al salir; rastro.bytes(n, fuente), rastro.pre(s), rastro.inferencia(s)
  (también cuando Triton no contesta a tiempo o no está: un timeout es la inferencia más lenta, no una que falta),
  rastro.top1(score, label);
- rastro.anotar(ev, status, fuente, t0) en un finally: la línea de log y la cuenta de la request.

Contrato del resto (estación 6): /healthz, /readyz (Triton listo en listo_timeout_ms), /metrics (texto de Prometheus u
OpenMetrics si quien lee lo pide, que es el que lleva exemplars), POST /v1/classify con revisión, semáforo, plazos,
504/503/500/499 y X-Request-ID en toda respuesta. TRITON_URL cambia el Triton; POD y NODO dicen quién es (para el
log de arranque, no para las métricas: esas etiquetas las pone Prometheus al leer).
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import sys
import time
import warnings
from contextlib import asynccontextmanager
from pathlib import Path

import aiohttp
import numpy as np
import yaml
from fastapi import FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from prometheus_client import CollectorRegistry
from prometheus_client import exposition, openmetrics
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.requests import ClientDisconnect
from tritonclient.http.aio import InferenceServerClient, InferInput, InferRequestedOutput
from tritonclient.utils import InferenceServerException

from .rastro import Rastro, fuente, request_id
from .revision import Rechazo, leer_body, preparar, revisar_imagen, revisar_largo, revisar_tipo

RAIZ = Path(__file__).resolve().parents[2]


def leer_reglas(p: Path = RAIZ / "gateway.yaml") -> dict:
    r = yaml.safe_load(p.read_text())
    pl = r["plazos_ms"]
    if not pl["app"] > pl["gateway"] > pl["triton"] > pl["fila_triton"] > 0:
        raise RuntimeError(f"gateway.yaml: la cadena de plazos tiene que bajar (app > gateway > triton > fila_triton) "
                           f"y es {pl['app']} > {pl['gateway']} > {pl['triton']} > {pl['fila_triton']}")
    return r


def leer_modelo(p: Path = RAIZ / "servir" / "modelo.json") -> dict:
    m = json.loads(p.read_text())
    huella = hashlib.sha256((json.dumps(m["labels"], ensure_ascii=False) + "\n").encode()).hexdigest()
    if huella != m["labels_sha256"]:
        raise RuntimeError(f"servir/modelo.json: los labels tienen huella {huella[:12]}… y la ficha dice {m['labels_sha256'][:12]}…")
    return m


def crear_app(triton=None, reglas: dict | None = None, modelo: dict | None = None) -> FastAPI:
    r = reglas or leer_reglas()
    lim, pl, tr, ct = r["limites"], r["plazos_ms"], r["triton"], r["contrato"]
    fuentes = r["rastro"]["fuentes"]
    url_triton = os.environ.get("TRITON_URL", tr["url"])
    from PIL import Image

    Image.MAX_IMAGE_PIXELS = lim["max_pixeles"]
    warnings.simplefilter("ignore", Image.DecompressionBombWarning)

    m0 = modelo or leer_modelo()
    registro = CollectorRegistry()                       # uno por app: las pruebas crean varias en el mismo proceso
    rastro = Rastro(registro, r, m0)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        cliente = triton or InferenceServerClient(url=url_triton, conn_limit=tr["conexiones"])
        try:
            meta = await cliente.get_model_metadata(tr["modelo"])
        except Exception as e:  # noqa: BLE001
            await cliente.close()
            raise RuntimeError(f"no pude leer la metadata de '{tr['modelo']}' en Triton ({url_triton}): {e}") from None
        ent, sal = meta["inputs"][0], meta["outputs"][0]
        if ent["name"] != m0["entrada"]["nombre"] or ent["shape"] != m0["entrada"]["forma"] or sal["name"] != m0["salida"]["nombre"]:
            await cliente.close()
            raise RuntimeError(f"Triton sirve {ent['name']} {ent['shape']} → {sal['name']} y la ficha dice "
                               f"{m0['entrada']['nombre']} {m0['entrada']['forma']} → {m0['salida']['nombre']}")
        app.state.modelo, app.state.triton = m0, cliente
        app.state.cpu = asyncio.Semaphore(lim["decodes"])
        app.state.en_vuelo = 0
        print(f"gateway listo · {os.environ.get('POD', 'local')} en {os.environ.get('NODO', 'tu Mac')} · "
              f"{m0['model_version']} · Triton {url_triton}", file=sys.stderr, flush=True)
        yield
        await cliente.close()

    app = FastAPI(lifespan=lifespan, title="classifier gateway")
    version = m0["model_version"]

    def contexto(request: Request) -> tuple[str, dict, str]:
        rid = request_id(request.headers.get("x-request-id"))
        cruda = request.headers.get("x-client-source")
        etiqueta = fuente(cruda, fuentes)
        largo = r["rastro"]["largo_fuente_log"]
        ev = {"request_id": rid, "caller": request.headers.get("x-caller-id", "desconocido"),
              "source": cruda[:largo] if cruda else "unknown", "model_version": version}
        return rid, ev, etiqueta

    @app.exception_handler(RequestValidationError)
    async def invalida(request: Request, exc: RequestValidationError):        # el 422 pasa antes de classify
        t0 = time.monotonic()
        rid, ev, etiqueta = contexto(request)
        ev["error"] = "; ".join(f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors())
        rastro.anotar(ev, 422, etiqueta, t0)
        return JSONResponse({"error": ev["error"], "request_id": rid}, 422, headers={"X-Request-ID": rid})

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException):      # 404, 405
        t0 = time.monotonic()
        rid, ev, etiqueta = contexto(request)
        ev["error"] = str(exc.detail)
        rastro.anotar(ev, exc.status_code, etiqueta, t0)
        return JSONResponse({"error": exc.detail, "request_id": rid}, exc.status_code,
                            headers={"X-Request-ID": rid, **(exc.headers or {})})

    @app.get("/healthz")
    async def healthz():
        return {"status": "ok"}

    @app.get("/readyz")
    async def readyz(request: Request):
        try:
            listo = await asyncio.wait_for(request.app.state.triton.is_model_ready(tr["modelo"]), tr["listo_timeout_ms"] / 1000)
        except Exception:  # noqa: BLE001
            listo = False
        return JSONResponse({"status": "ready" if listo else "not ready"}, 200 if listo else 503)

    @app.get("/metrics")
    async def metrics(request: Request):
        if "application/openmetrics-text" in request.headers.get("accept", ""):   # Prometheus lo pide: lleva exemplars
            return Response(openmetrics.exposition.generate_latest(registro),
                            media_type=openmetrics.exposition.CONTENT_TYPE_LATEST)
        return Response(exposition.generate_latest(registro), media_type=exposition.CONTENT_TYPE_LATEST)

    @app.post(ct["ruta"])
    async def classify(request: Request,
                       top_k: int = Query(ct["top_k"]["defecto"], ge=ct["top_k"]["min"], le=ct["top_k"]["max"])):
        t0 = time.monotonic()
        st = request.app.state
        rid, ev, etiqueta = contexto(request)
        hdr = {"X-Request-ID": rid}
        ms = ev["ms"] = {}
        if st.en_vuelo >= lim["en_vuelo"]:
            ev["error"] = f"{lim['en_vuelo']} requests en vuelo"
            rastro.anotar(ev, 503, etiqueta, t0)
            return JSONResponse({"error": ev["error"], "request_id": rid}, 503, headers={**hdr, "Retry-After": "1"})
        st.en_vuelo += 1
        rastro.en_vuelo.inc()
        status = 500
        try:
            revisar_tipo(request.headers.get("content-type"), ct["tipos"])
            revisar_largo(request.headers.get("content-length"), lim["max_bytes"])
            data = await leer_body(request, lim["max_bytes"])
            ev["bytes"], ev["sha256"] = len(data), hashlib.sha256(data).hexdigest()[:12]
            rastro.bytes(len(data), etiqueta)
            revisar_imagen(data, lim["max_pixeles"], lim["max_proporcion"])
            try:
                await asyncio.wait_for(st.cpu.acquire(), lim["espera_cpu_ms"] / 1000)
            except TimeoutError:
                raise Rechazo(503, f"sin lugar de decode en {lim['espera_cpu_ms']} ms", reintentar=True) from None
            try:
                t = time.monotonic()
                x = await run_in_threadpool(preparar, data)
                ms["pre"] = round((time.monotonic() - t) * 1000, 1)
                rastro.pre(time.monotonic() - t)
            finally:
                st.cpu.release()
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
                rastro.inferencia(time.monotonic() - t)       # también en el 504 y el 503: es la inferencia más lenta
            t = time.monotonic()
            z = res.as_numpy(salida)[0].astype(np.float64)
            if not np.all(np.isfinite(z)):
                raise Rechazo(500, "logits no finitos")
            e = np.exp(z - z.max())
            p = e / e.sum()
            orden = np.argsort(-p, kind="stable")
            labels = st.modelo["labels"]
            ev["top5"] = [[int(i), round(float(p[i]), 4)] for i in orden[:5]]
            rastro.top1(float(p[orden[0]]), labels[orden[0]])
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
        except Exception as e:  # noqa: BLE001
            status, ev["error"] = 500, f"{type(e).__name__}: {str(e)[:200]}"
            return JSONResponse({"error": "error interno", "request_id": rid}, 500, headers=hdr)
        finally:
            st.en_vuelo -= 1
            rastro.en_vuelo.dec()
            rastro.anotar(ev, status, etiqueta, t0)

    return app


app = crear_app()
