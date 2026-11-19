"""El «ALB interno» del dojo: la puerta de entrada de los callers (en C01: un Application Load Balancer de AWS).

    python mundo/nodo.py arrancar alb     # escucha en :8950; sus métricas («CloudWatch») en :8957/metrics

No es parte de lo que escribes y no lo leas para resolver un paso. Se porta como el ALB en lo que la estación usa:
- Verifica el token del caller (Authorization: Bearer <JWT>): firma, emisor, audiencia y caducidad, con lo que dice
  mundo/plataforma.yaml (alb.jwt). Si no sirve, contesta 401 él mismo: la request nunca llega a un pod.
- Solo deja pasar la ruta de la API (alb.regla.ruta_exacta); lo demás es 404 del ALB.
- El target group: un pod está registrado mientras está listo (GET /readyz cada alb.salud.intervalo_s; entra tras
  `sanos` respuestas 200 seguidas, sale tras `enfermos` fallas). En C01 eso lo hace el AWS Load Balancer Controller: un
  pod que falla su readiness sale de los Endpoints y el controlador lo da de baja del target group. Reparte entre los
  registrados (round robin). Si no queda ninguno registrado, contesta 503 él mismo. (Ojo: si los destinos siguen
  registrados pero todos fallan el health check del propio ALB, el ALB de AWS «abre el paso» y les manda tráfico a
  todos; eso el dojo no lo imita.)
- Antes de reiniciar un pod, mundo/nodo.py lo da de baja (logs/alb-drenar/<pod>): deja de mandarle requests nuevas y
  el pod termina las que tiene. En C01: el controlador da de baja el destino al empezar a terminar el pod y el ALB
  espera su deregistration delay; el preStop del pod da tiempo a que eso pase antes del SIGTERM.
- Le quita al request el X-Caller-Id que traiga y pone el client_id del token (sub); el X-Request-ID pasa sin tocar.
  Agrega X-Amzn-Trace-Id, como el ALB.
- Mide TargetResponseTime: desde que manda la request al pod hasta que llegan los headers de la respuesta.
- Escribe su access log en logs/alb.log (una línea JSON por request, como los access logs del ALB que van a S3).
- Publica sus números en :8957/metrics con nombres de CloudWatch (AWS/ApplicationELB), para que Prometheus los lea:
    alb_request_count_total                        RequestCount: las requests para las que eligió un pod
    alb_httpcode_target_total{code}                HTTPCode_Target_2XX/4XX/5XX_Count: lo que contestaron los pods
    alb_httpcode_elb_total{code}                   HTTPCode_ELB_4XX/5XX_Count: lo que contestó el ALB mismo
    alb_target_response_time_seconds               TargetResponseTime (histograma)
    alb_healthy_host_count / alb_unhealthy_host_count   (aquí: registrados / dados de baja)
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import itertools
import json
import os
import secrets
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import uvicorn
from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram, start_http_server
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import LOGS, plataforma, pods  # noqa: E402

DRENAR = LOGS / "alb-drenar"   # mundo/nodo.py deja aquí el nombre del pod que va a reiniciar (la baja antes de apagarlo)
REG = CollectorRegistry()
REQUESTS = Counter("alb_request_count", "RequestCount: requests para las que el ALB eligió un pod", registry=REG)
TARGET = Counter("alb_httpcode_target", "HTTPCode_Target_*_Count: códigos que contestaron los pods", ["code"], registry=REG)
ELB = Counter("alb_httpcode_elb", "HTTPCode_ELB_*_Count: códigos que contestó el ALB mismo", ["code"], registry=REG)
TRT = Histogram("alb_target_response_time_seconds", "TargetResponseTime",
                buckets=(0.005, 0.01, 0.02, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 1.0, 2.5), registry=REG)
SANOS = Gauge("alb_healthy_host_count", "HealthyHostCount", registry=REG)
ENFERMOS = Gauge("alb_unhealthy_host_count", "UnHealthyHostCount", registry=REG)
for c in ("401", "404", "502", "503", "504"):
    ELB.labels(c)


def b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def verificar_jwt(tok: str, cfg: dict) -> str | None:
    """El client_id (sub) si el token sirve; None si no."""
    try:
        h, p, f = tok.split(".")
        esperada = hmac.new(cfg["llave"].encode(), f"{h}.{p}".encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(esperada, b64d(f)):
            return None
        if json.loads(b64d(h)).get("alg") != "HS256":
            return None
        c = json.loads(b64d(p))
        if c.get("iss") != cfg["emisor"] or c.get("aud") != cfg["audiencia"] or c.get("exp", 0) < time.time():
            return None
        return c.get("sub")
    except Exception:  # noqa: BLE001
        return None


class Grupo:
    """El target group: los pods del gateway y su salud."""

    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.pods = {p["nombre"]: {"url": f"http://127.0.0.1:{p['puerto_host']}", "sano": False, "racha": 0} for p in pods()}
        self.rr = itertools.count()

    def sanos(self) -> list[str]:
        return [n for n, v in self.pods.items() if v["sano"]]

    def elegir(self) -> str | None:
        s = [n for n in self.sanos() if not (DRENAR / n).exists()]   # dado de baja a propósito: ya no recibe nuevas
        return s[next(self.rr) % len(s)] if s else None

    async def revisar(self, cliente: httpx.AsyncClient) -> None:
        sc = self.cfg["salud"]
        while True:
            for n, v in self.pods.items():
                try:
                    ok = (await cliente.get(v["url"] + sc["ruta"], timeout=sc["timeout_s"])).status_code == 200
                except httpx.HTTPError:
                    ok = False
                if ok == v["sano"]:
                    v["racha"] = 0
                    continue
                v["racha"] += 1
                if v["racha"] >= (sc["sanos"] if ok else sc["enfermos"]):
                    v["sano"], v["racha"] = ok, 0
                    print(f"alb: {n} {'registrado' if ok else 'DADO DE BAJA (no está listo)'}", file=sys.stderr, flush=True)
            SANOS.set(len(self.sanos()))
            ENFERMOS.set(len(self.pods) - len(self.sanos()))
            await asyncio.sleep(sc["intervalo_s"])


def crear() -> Starlette:
    cfg = plataforma()["alb"]
    grupo = Grupo(cfg)
    log = open(LOGS / "alb.log", "a", buffering=1)

    def acceso(**kw) -> None:
        log.write(json.dumps(kw, ensure_ascii=False, separators=(",", ":")) + "\n")

    @asynccontextmanager
    async def lifespan(app):
        app.state.cliente = httpx.AsyncClient(limits=httpx.Limits(max_connections=200, max_keepalive_connections=64),
                                              timeout=httpx.Timeout(60.0))
        tarea = asyncio.create_task(grupo.revisar(app.state.cliente))
        yield
        tarea.cancel()
        await app.state.cliente.aclose()

    async def salud(_r: Request):
        return JSONResponse({"sanos": grupo.sanos()})

    async def entrada(request: Request):
        t_llega = time.monotonic()
        traza = f"Root=1-{int(time.time()):08x}-{secrets.token_hex(12)}"
        rid = request.headers.get("x-request-id", "-")
        base = {"time": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + f".{int(time.time() * 1e6) % 1_000_000:06d}Z",
                "request": f"{request.method} {request.url.path}", "x_request_id": rid, "trace_id": traza}

        def propia(code: int, motivo: str):
            ELB.labels(str(code)).inc()
            acceso(**base, elb_status_code=code, target="-", target_status_code="-", target_processing_time=-1,
                   request_processing_time=round(time.monotonic() - t_llega, 4), error_reason=motivo)
            return JSONResponse({"error": motivo}, code, headers={"X-Amzn-Trace-Id": traza})

        if request.url.path != cfg["regla"]["ruta_exacta"]:
            return propia(404, "ninguna regla del oyente coincide con la ruta")
        aut = request.headers.get("authorization", "")
        caller = verificar_jwt(aut.removeprefix("Bearer ").strip(), cfg["jwt"]) if aut.startswith("Bearer ") else None
        if not caller:
            return propia(401, "token ausente o inválido (firma, emisor, audiencia o caducidad)")
        destino = grupo.elegir()
        if not destino:
            return propia(503, "el target group no tiene destinos registrados")
        body = await request.body()
        hdr = {k: v for k, v in request.headers.items()
               if k.lower() not in ("host", "authorization", "x-caller-id", "content-length", "connection")}
        hdr.update({"x-caller-id": caller, "x-amzn-trace-id": traza, "x-forwarded-for": request.client.host if request.client else "-"})
        REQUESTS.inc()
        t_manda = time.monotonic()
        try:
            r = await request.app.state.cliente.request(request.method, grupo.pods[destino]["url"] + request.url.path,
                                                        params=request.query_params, content=body, headers=hdr)
        except httpx.HTTPError as e:
            ELB.labels("502").inc()
            acceso(**base, elb_status_code=502, target=destino, target_status_code="-", target_processing_time=-1,
                   request_processing_time=round(t_manda - t_llega, 4), error_reason=type(e).__name__)
            return JSONResponse({"error": "el destino cerró la conexión"}, 502, headers={"X-Amzn-Trace-Id": traza})
        trt = time.monotonic() - t_manda
        TRT.observe(trt)
        TARGET.labels(str(r.status_code)).inc()
        acceso(**base, elb_status_code=r.status_code, target=destino, target_status_code=r.status_code,
               request_processing_time=round(t_manda - t_llega, 4), target_processing_time=round(trt, 4),
               caller=caller)
        fuera = {k: v for k, v in r.headers.items() if k.lower() not in ("content-length", "connection", "transfer-encoding")}
        fuera["x-amzn-trace-id"] = traza
        return Response(r.content, r.status_code, headers=fuera)

    rutas = [Route("/_dojo/salud", salud), Route("/{ruta:path}", entrada, methods=["GET", "POST", "PUT", "DELETE"])]
    return Starlette(routes=rutas, lifespan=lifespan)


def main() -> None:
    cfg = plataforma()["alb"]
    start_http_server(8957, addr="0.0.0.0", registry=REG)
    uvicorn.run(crear(), host="127.0.0.1", port=cfg["oyente"], log_level="warning", access_log=False)


if __name__ == "__main__":
    os.chdir(Path(__file__).resolve().parent.parent)
    main()
