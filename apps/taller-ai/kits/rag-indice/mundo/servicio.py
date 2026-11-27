"""La API de búsqueda de C11, en chiquito: lo que llama el asistente para traer chunks. Usa tu pipeline/buscar.py.

    python mundo/servicio.py            # en otra terminal (o en segundo plano); Ctrl+C para pararla
    curl 'http://localhost:8150/buscar?persona=elena.cruz@marketplace.test&indice=vectores&q=plazo+para+devolver'
    curl http://localhost:8150/salud

Nunca nombra un índice: en cada petición lee a dónde apunta el alias (config servicio.alias). Si cambió (o cambió el
manifiesto de ese índice, o servicio.modelo_consulta: es como un despliegue nuevo de la API), abre el índice con tu
abrir() mientras sigue contestando con el anterior, y cuando ya cargó, cambia. Si no lo puede abrir
(está a medio construir, o su modelo no es el de la consulta), contesta 503 con el motivo: un error visible es mejor
que resultados de basura. Cada respuesta dice qué índice contestó.
"""
from __future__ import annotations

import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "pipeline"))
import buscar  # noqa: E402
from _comun import config  # noqa: E402
from alias import resolver  # noqa: E402

_lock = threading.Lock()    # una búsqueda a la vez (el modelo se comparte)
_carga = threading.Lock()   # una carga de índice a la vez
_actual = {"nombre": None, "b": None, "error": None, "intentado": None}


def buscador():
    """El Buscador del alias. Si el alias cambió, abre el nuevo; mientras carga, las demás peticiones siguen con el
    viejo. Si no lo puede abrir, deja de contestar con el viejo y da el error: el alias dice que el vigente es otro."""
    s = config()["servicio"]
    nombre = resolver(s["alias"])
    man = RAIZ / "indices" / str(nombre) / "manifiesto.json"
    llave = (nombre, s["modelo_consulta"], man.stat().st_mtime_ns if man.exists() else None)   # qué abrir, y con qué
    if llave == _actual["nombre"] and _actual["b"]:
        return _actual["b"], None
    if llave == _actual["intentado"] and _actual["error"]:
        return None, _actual["error"]
    if _carga.acquire(blocking=_actual["b"] is None):
        try:
            if llave != _actual["nombre"]:
                try:
                    b = buscar.abrir()
                    _actual.update(nombre=llave, b=b, error=None, intentado=llave)
                    print(f"[servicio] {time.strftime('%H:%M:%S')} ahora contesta {b.nombre}", flush=True)
                except Exception as e:  # noqa: BLE001
                    _actual.update(nombre=None, b=None, error=f"{type(e).__name__}: {e}", intentado=llave)
                    print(f"[servicio] {time.strftime('%H:%M:%S')} ✗ no puedo abrir {nombre}: {e}", flush=True)
        finally:
            _carga.release()
    return _actual["b"], _actual["error"]


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def responder(self, codigo: int, d: dict) -> None:
        b = json.dumps(d, ensure_ascii=False).encode()
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        b, err = buscador()
        if u.path == "/salud":
            return self.responder(200 if b else 503, {"indice": b.nombre if b else None, "error": err})
        if u.path != "/buscar":
            return self.responder(404, {"error": "solo /buscar y /salud"})
        if not b:
            return self.responder(503, {"error": err})
        lado = q.get("indice", "vectores")
        if lado not in ("bm25", "vectores") or not q.get("q") or not q.get("persona"):
            return self.responder(400, {"error": "faltan q y persona, o indice no es bm25 ni vectores"})
        t = time.perf_counter()
        with _lock:
            r = getattr(b, lado)(q["q"], q["persona"], int(q.get("k", 8)))
        self.responder(200, {"indice": b.nombre, "lado": lado, "ms": round((time.perf_counter() - t) * 1000, 1),
                             "resultados": [{"chunk_id": c, "puntaje": round(s, 4)} for c, s in r]})


if __name__ == "__main__":
    p = config()["servicio"]["puerto"]
    s = ThreadingHTTPServer(("127.0.0.1", p), H)
    b, err = buscador()
    print(f"[servicio] escuchando en http://localhost:{p} · alias {config()['servicio']['alias']} → {b.nombre if b else err}", flush=True)
    try:
        s.serve_forever()
    except KeyboardInterrupt:
        pass
