"""Los callers: el backend de publicaciones, moderación y búsqueda, mandando fotos por el ALB (no es parte de lo que
escribes). Cada caller pide su token al proveedor de identidad (mundo/callers.json) y espera hasta 300 ms (su timeout).

    python mundo/carga.py --una                    # una foto, contada con detalle: los tres relojes y su request_id
    python mundo/carga.py --tasa 40 --segundos 60  # tráfico abierto (Poisson): 40 fotos/s durante un minuto
    python mundo/carga.py … --basura 0.05          # el 5 % con Content-Type equivocado (415) o GET (405)
    python mundo/carga.py … --fuente-loca          # un caller con un bug: un X-Client-Source distinto en cada request
    python mundo/carga.py … --sin-token            # requests sin token (el ALB contesta 401)
    python mundo/carga.py --siempre --tasa 5       # el tráfico de siempre (lo arranca mundo/nodo.py: producción nunca está quieta)

Cada request queda en logs/backend.log (una línea JSON: request_id que mandó o que le tocó, caller, código, ms del
backend). Al final imprime cuántas hubo por código y el p50/p99 que midió el backend.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import hmac
import json
import os
import random
import sys
import time
import uuid
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import ALB, CALLERS_JSON, FOTOS, LOGS, leer_json, lineas_nodo, pods  # noqa: E402

TIMEOUT_S = 0.300


def b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def token(caller: str, idp: dict) -> str:
    h = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    ahora = int(time.time())
    p = b64(json.dumps({"iss": idp["emisor"], "aud": idp["audiencia"], "sub": caller, "iat": ahora,
                        "exp": ahora + 900, "scope": "classify"}).encode())
    f = b64(hmac.new(idp["llave"].encode(), f"{h}.{p}".encode(), hashlib.sha256).digest())
    return f"{h}.{p}.{f}"


def p_(xs: list[float], q: float) -> float:
    if not xs:
        return float("nan")
    s = sorted(xs)
    return s[min(len(s) - 1, int(q * len(s)))]


class Callers:
    def __init__(self, args):
        self.idp = leer_json(CALLERS_JSON)
        self.args = args
        self.rng = random.Random(args.semilla)
        self.fotos = [p.read_bytes() for p in sorted(FOTOS.glob("*.jpg"))]
        self.tokens, self.desde = {c: token(c, self.idp) for c in self.idp["callers"]}, time.time()
        self.nombres = list(self.idp["callers"])
        self.pesos = [self.idp["callers"][c]["peso"] for c in self.nombres]

    def una(self) -> tuple[str, dict, str, bytes, dict]:
        r = self.rng
        if time.time() - self.desde > 600:          # el token dura 15 min: cada caller pide otro antes
            self.tokens, self.desde = {c: token(c, self.idp) for c in self.idp["callers"]}, time.time()
        caller = r.choices(self.nombres, self.pesos)[0]
        cfg = self.idp["callers"][caller]
        fuente = r.choices(list(cfg["fuentes"]), list(cfg["fuentes"].values()))[0]
        if self.args.fuente_loca and caller == "busqueda":
            fuente = f"web-{uuid.uuid4().hex[:8]}"                   # el bug: un texto distinto en cada request
        hdr = {"Content-Type": "image/jpeg", "X-Client-Source": fuente}
        if not self.args.sin_token:
            hdr["Authorization"] = f"Bearer {self.tokens[caller]}"
        if cfg["manda_request_id"]:
            hdr["X-Request-ID"] = str(uuid.uuid4())
        metodo, body = "POST", r.choice(self.fotos)
        if r.random() < self.args.basura:
            if r.random() < 0.8:
                hdr["Content-Type"] = "text/plain"                   # 415
            else:
                metodo, body = "GET", b""                            # 405
        return caller, hdr, metodo, body, cfg


async def mandar(cli: httpx.AsyncClient, cs: Callers, log, res: dict) -> None:
    caller, hdr, metodo, body, _ = cs.una()
    t0 = time.monotonic()
    try:
        r = await cli.request(metodo, f"{ALB}/v1/classify", content=body or None, headers=hdr, timeout=TIMEOUT_S)
        code, rid = r.status_code, r.headers.get("x-request-id", hdr.get("X-Request-ID", "-"))
    except httpx.TimeoutException:
        code, rid = "timeout", hdr.get("X-Request-ID", "-")
    except httpx.HTTPError as e:
        code, rid = type(e).__name__, hdr.get("X-Request-ID", "-")
    ms = (time.monotonic() - t0) * 1000
    res["codigos"][str(code)] = res["codigos"].get(str(code), 0) + 1
    if code == 200:
        res["ms"].append(ms)
    log.write(json.dumps({"request_id": rid, "caller": caller, "status": code, "ms_backend": round(ms, 1)}) + "\n")


async def trafico(args) -> None:
    cs = Callers(args)
    res = {"codigos": {}, "ms": []}
    LOGS.mkdir(exist_ok=True)
    lim = httpx.Limits(max_connections=100, max_keepalive_connections=50)
    with open(os.devnull if args.siempre else LOGS / "backend.log", "a", buffering=1) as log:
        async with httpx.AsyncClient(limits=lim) as cli:
            tareas, t0, n = set(), time.monotonic(), 0
            prox = t0
            while args.siempre or time.monotonic() - t0 < args.segundos:
                prox += cs.rng.expovariate(args.tasa)
                espera = prox - time.monotonic()
                if espera > 0:
                    await asyncio.sleep(espera)
                t = asyncio.create_task(mandar(cli, cs, log, res))
                tareas.add(t)
                t.add_done_callback(tareas.discard)
                n += 1
            await asyncio.gather(*tareas)
    total = sum(res["codigos"].values())
    print(f"{total} requests en {args.segundos:.0f} s ({total / args.segundos:.1f}/s) · códigos: "
          + ", ".join(f"{k}: {v}" for k, v in sorted(res["codigos"].items())))
    if res["ms"]:
        print(f"el backend midió (solo 200): p50 {p_(res['ms'], 0.5):.1f} ms · p99 {p_(res['ms'], 0.99):.1f} ms")


def ultima_linea(rid: str) -> tuple[str, dict] | None:
    for p in pods():
        for f, linea in reversed(lineas_nodo(p["nodo"], rid)):
            hora, flujo, _marca, texto = linea.split(" ", 3)
            try:
                return f"nodo-{p['nodo']}:{f}", {"hora": hora, "flujo": flujo, **json.loads(texto)}
            except json.JSONDecodeError:
                return f"nodo-{p['nodo']}:{f}", {"hora": hora, "texto": texto}
    return None


def ultima_alb(rid: str) -> dict | None:
    p = LOGS / "alb.log"
    if not p.exists():
        return None
    for linea in reversed(p.read_text().splitlines()[-400:]):
        d = json.loads(linea)
        if d.get("x_request_id") == rid:
            return d
    return None


def una(args) -> None:
    cs = Callers(args)
    idp = cs.idp
    caller = "backend-publicaciones"
    rid = str(uuid.uuid4())
    hdr = {"Content-Type": "image/jpeg", "X-Client-Source": "mobile", "X-Request-ID": rid,
           "Authorization": f"Bearer {token(caller, idp)}"}
    foto = cs.fotos[args.foto]
    with httpx.Client() as cli:
        cli.post(f"{ALB}/v1/classify", content=foto, headers={**hdr, "X-Request-ID": str(uuid.uuid4())},
                 timeout=2)                                                       # calienta la conexión
        t0 = time.monotonic()
        r = cli.post(f"{ALB}/v1/classify", content=foto, headers=hdr, timeout=2)
        ms = (time.monotonic() - t0) * 1000
    LOGS.mkdir(exist_ok=True)
    with open(LOGS / "backend.log", "a") as log:
        log.write(json.dumps({"request_id": rid, "caller": caller, "status": r.status_code, "ms_backend": round(ms, 1)}) + "\n")
    print(f"→ POST {ALB}/v1/classify  ({len(foto):,} B, caller {caller}, X-Request-ID {rid})")
    print(f"← {r.status_code} · X-Request-ID: {r.headers.get('x-request-id')} · X-Amzn-Trace-Id: {r.headers.get('x-amzn-trace-id')}")
    print(f"   {r.text[:200]}")
    time.sleep(0.3)
    alb = ultima_alb(rid)
    gw = ultima_linea(rid)
    print("\nlos tres relojes de la misma request:")
    print(f"  backend (lo que esperó, timeout 300 ms) ......... {ms:6.1f} ms")
    if alb and alb.get("target_processing_time", -1) >= 0:
        print(f"  ALB, TargetResponseTime (logs/alb.log) .......... {alb['target_processing_time'] * 1000:6.1f} ms")
    else:
        print("  ALB: no encontré la línea en logs/alb.log")
    if gw and isinstance(gw[1].get("ms"), dict):
        m = gw[1]["ms"]
        print(f"  gateway, ms.total (su línea de log) ............. {m.get('total', float('nan')):6.1f} ms   "
              f"pre {m.get('pre')} · triton {m.get('triton')} · post {m.get('post')}")
        print(f"\nla línea del gateway, en {gw[0]} (la hora la puso el runtime del nodo):\n  {json.dumps(gw[1], ensure_ascii=False)}")
    else:
        print("  gateway: no encontré su línea en el disco de ningún nodo (¿tu rastro.py ya escribe la línea?)")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--una", action="store_true")
    ap.add_argument("--foto", type=int, default=7)
    ap.add_argument("--tasa", type=float, default=30)
    ap.add_argument("--segundos", type=float, default=30)
    ap.add_argument("--basura", type=float, default=0.03)
    ap.add_argument("--fuente-loca", action="store_true")
    ap.add_argument("--sin-token", action="store_true")
    ap.add_argument("--semilla", type=int, default=11)
    ap.add_argument("--siempre", action="store_true")
    a = ap.parse_args()
    una(a) if a.una else asyncio.run(trafico(a))


if __name__ == "__main__":
    main()
