"""El «ALB» del dojo: el balanceador que reparte el tráfico del gateway con pesos, como lo hace el ALB de AWS en C01.
Corre como un pod del clúster (namespace dojo-alb) y lo crea mundo/crear.py; no se toca.

Lo que hace, igual que el AWS Load Balancer Controller + el ALB:
- Cada segundo lee el Ingress «gateway» del namespace classifier.
- Si su backend apunta a un puerto llamado «use-annotation», lee la anotación
  alb.ingress.kubernetes.io/actions.<nombre del backend>: un forward con TargetGroups (ServiceName, ServicePort,
  Weight). Es la que escribe Argo Rollouts en cada setWeight. Reparte cada request al azar con esos pesos.
- Si el backend apunta a un puerto normal (número o nombre de un puerto del Service), manda todo a ese Service e
  ignora la anotación, como el ALB de verdad.
- GET /dojo/pesos (en el puerto 8081, solo dentro del clúster y por kubectl port-forward): lo que está aplicando ahora.

Lo que no hace: TLS, reglas por header, health checks propios (confía en los Endpoints del Service, como el modo IP del
ALB confía en los pods listos).
"""
from __future__ import annotations

import http.client
import json
import os
import random
import ssl
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

NS, INGRESS = os.environ.get("ALB_NAMESPACE", "classifier"), os.environ.get("ALB_INGRESS", "gateway")
API = "https://kubernetes.default.svc"
SA = "/var/run/secrets/kubernetes.io/serviceaccount"
ESTADO = {"destinos": [], "fuente": "sin leer", "leido": 0.0, "error": ""}
BLOQUEO = threading.Lock()
SALTOS = {"connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade", "proxy-connection", "host"}


def leer_ingress() -> dict:
    token = open(f"{SA}/token").read()
    ctx = ssl.create_default_context(cafile=f"{SA}/ca.crt")
    req = urllib.request.Request(f"{API}/apis/networking.k8s.io/v1/namespaces/{NS}/ingresses/{INGRESS}",
                                 headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, context=ctx, timeout=3) as r:
        return json.loads(r.read())


def destinos(ing: dict) -> tuple[list[tuple[str, int, int]], str]:
    """[(service, puerto, peso)] y de dónde salió."""
    reglas = ing["spec"].get("rules") or [{}]
    rutas = (reglas[0].get("http") or {}).get("paths") or []
    back = (rutas[0]["backend"]["service"] if rutas else ing["spec"].get("defaultBackend", {}).get("service")) or {}
    nombre, puerto = back.get("name"), back.get("port", {})
    if puerto.get("name") == "use-annotation":
        acc = ing["metadata"].get("annotations", {}).get(f"alb.ingress.kubernetes.io/actions.{nombre}")
        if not acc:
            return [], f"el backend {nombre} pide use-annotation y no hay anotación actions.{nombre}"
        tg = json.loads(acc)["ForwardConfig"]["TargetGroups"]
        return [(g["ServiceName"], int(g["ServicePort"]), int(g.get("Weight", 0))) for g in tg], f"anotación actions.{nombre}"
    num = puerto.get("number") or 8080
    return [(nombre, int(num), 100)], f"backend {nombre}:{num} (sin anotación)"


def refrescar() -> None:
    while True:
        try:
            d, fuente = destinos(leer_ingress())
            with BLOQUEO:
                ESTADO.update(destinos=d, fuente=fuente, leido=time.time(), error="")
        except Exception as e:  # noqa: BLE001 — si no puede leer, se queda con lo último que leyó (como el ALB)
            with BLOQUEO:
                ESTADO["error"] = f"{type(e).__name__}: {e}"[:200]
        time.sleep(1)


def elegir() -> tuple[str, int] | None:
    with BLOQUEO:
        d = [x for x in ESTADO["destinos"] if x[2] > 0]
    if not d:
        return None
    s, p, _ = random.choices(d, weights=[x[2] for x in d])[0]
    return s, p


class Proxy(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _reenviar(self):
        largo = int(self.headers.get("Content-Length") or 0)
        cuerpo = self.rfile.read(largo) if largo else None
        dest = elegir()
        if not dest:
            return self._responder(503, b'{"error": "el ALB no tiene destinos con peso"}')
        s, p = dest
        try:
            c = http.client.HTTPConnection(f"{s}.{NS}.svc.cluster.local", p, timeout=5)
            hdr = {k: v for k, v in self.headers.items() if k.lower() not in SALTOS}
            c.request(self.command, self.path, body=cuerpo, headers=hdr)
            r = c.getresponse()
            datos = r.read()
            self.send_response(r.status)
            for k, v in r.getheaders():
                if k.lower() not in SALTOS and k.lower() != "content-length":
                    self.send_header(k, v)
            self.send_header("Content-Length", str(len(datos)))
            self.end_headers()
            self.wfile.write(datos)
            c.close()
        except OSError as e:                      # sin pods listos detrás o el pod se fue: 502, como el ALB
            self._responder(502, json.dumps({"error": f"502 del ALB: {s} ({type(e).__name__})"}).encode())

    def _responder(self, codigo: int, datos: bytes):
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(datos)))
        self.end_headers()
        self.wfile.write(datos)

    do_GET = do_POST = _reenviar


class Admin(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        with BLOQUEO:
            d = {"destinos": [{"service": s, "puerto": p, "peso": w} for s, p, w in ESTADO["destinos"]],
                 "fuente": ESTADO["fuente"], "hace_s": round(time.time() - ESTADO["leido"], 1), "error": ESTADO["error"]}
        datos = json.dumps(d, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(datos)))
        self.end_headers()
        self.wfile.write(datos)


if __name__ == "__main__":
    threading.Thread(target=refrescar, daemon=True).start()
    threading.Thread(target=ThreadingHTTPServer(("0.0.0.0", 8081), Admin).serve_forever, daemon=True).start()
    print(f"ALB del dojo: Ingress {NS}/{INGRESS} → :8080", file=sys.stderr, flush=True)
    ThreadingHTTPServer.daemon_threads = True
    ThreadingHTTPServer(("0.0.0.0", 8080), Proxy).serve_forever()
