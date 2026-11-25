"""Las cuatro fuentes del marketplace por HTTP, en http://localhost:8120. Es el mundo: no lo modificas.

    python mundo/fuentes.py arrancar     # en segundo plano; espera a que responda
    python mundo/fuentes.py parar
    python mundo/fuentes.py estado       # ¿responde? y el resumen del mundo
    python mundo/fuentes.py token wiki   # el token vigente de una fuente (lo que te daría su administrador)
    python mundo/fuentes.py unidad on    # TI vuelve a dar acceso a la cuenta del conector en la unidad compartida
    python mundo/fuentes.py log          # las últimas llamadas que recibió

Cada fuente tiene su propia forma, como en la vida real (las de verdad están en la guía, «Nube vs. local»):
- Wiki:      GET /wiki/api/paginas?espacio=SOP&inicio=0&limite=10[&desde=ISO]   (paginado: «siguiente» trae la ruta de la página que sigue)
             GET /wiki/api/paginas/<id> · /wiki/api/paginas/<id>/restricciones · /wiki/api/espacios/<clave>/permisos
             Límite: 10 llamadas por segundo por token; si te pasas, 429 con Retry-After.
- Drive:     GET /drive/v3/changes/startPageToken · /drive/v3/changes?pageToken=N
             GET /drive/v3/files?pageToken= · /drive/v3/files/<id>[?alt=media] · /drive/v3/files/<id>/permissions
- Jira:      GET /jira/api/buscar?jql=…&maxResults=20[&nextPageToken=…] · /jira/api/ticket/<clave>
             GET /jira/api/proyecto/<clave>/permisos · /jira/api/nivel/<id>
- Políticas: GET /repo/politicas/arbol · /repo/politicas/crudo/<ruta>
Todas piden «Authorization: Bearer <token>»; sin token o con uno vencido, 401.
"""
from __future__ import annotations

import json
import os
import re
import signal
import subprocess
import sys
import threading
import time
from collections import deque
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import (BASE, FUENTES, PUERTO, TALLER, ZONA_JIRA, ancestros, blob_sha, drive_visible, estado,  # noqa: E402
                         guardar, jira_fecha, utc, wiki_visible)

PID = TALLER / "fuentes.pid"
LOG = TALLER / "fuentes.log"
LLAMADAS: deque = deque(maxlen=400)
_cubetas: dict[str, list[float]] = {}
_candado = threading.Lock()


def _permitida(token: str, limite: int) -> float:
    """Cubeta de fichas (token bucket): `limite` por segundo, ráfaga de `limite`. Devuelve 0 o los segundos de espera."""
    with _candado:
        ahora = time.monotonic()
        fichas, antes = _cubetas.get(token, [float(limite), ahora])
        fichas = min(float(limite), fichas + (ahora - antes) * limite)
        if fichas >= 1:
            _cubetas[token] = [fichas - 1, ahora]
            return 0.0
        _cubetas[token] = [fichas, ahora]
        return (1 - fichas) / limite


# ---------------------------------------------------------------- wiki
def wiki(e, partes, q):
    ps = e["wiki"]["paginas"]
    if partes[:1] == ["paginas"] and len(partes) == 1:
        esp = (q.get("espacio") or [""])[0]
        if esp not in e["wiki"]["espacios"]:
            return 400, {"error": f"espacio desconocido «{esp}»"}
        inicio, limite = int((q.get("inicio") or ["0"])[0]), min(int((q.get("limite") or ["10"])[0]), 10)
        desde = (q.get("desde") or [None])[0]
        sel = sorted((p for p in ps.values() if p["espacio"] == esp and wiki_visible(e, p["id"])
                      and (not desde or utc(p["actualizado"]) >= utc(desde))), key=lambda p: p["id"])
        res = [{"id": p["id"], "titulo": p["titulo"], "espacio": esp, "version": p["version"], "actualizado": p["actualizado"],
                "ancestros": ancestros(e, p["id"])} for p in sel[inicio:inicio + limite]]
        sig = None
        if inicio + limite < len(sel):
            sig = f"/paginas?espacio={esp}&inicio={inicio + limite}&limite={limite}" + (f"&desde={quote(desde)}" if desde else "")
        return 200, {"resultados": res, "siguiente": sig}
    if partes[:1] == ["paginas"] and len(partes) in (2, 3):
        pid = partes[1]
        if not wiki_visible(e, pid):
            return 404, {"error": f"no existe la página {pid} o no tienes permiso de verla"}
        p = ps[pid]
        if len(partes) == 3 and partes[2] == "restricciones":
            return 200, {"leer": p["restricciones"]}
        if len(partes) == 2:
            return 200, {k: p[k] for k in ("id", "titulo", "espacio", "version", "actualizado", "autor", "cuerpo")} | {"ancestros": ancestros(e, pid)}
    if partes[:1] == ["espacios"] and len(partes) == 3 and partes[2] == "permisos":
        s = e["wiki"]["espacios"].get(partes[1])
        return (200, {"leer": s["leer"]}) if s else (404, {"error": "no existe el espacio"})
    return 404, {"error": "ruta desconocida"}


# ---------------------------------------------------------------- drive
def meta_drive(f):
    return {k: f[k] for k in ("id", "name", "mimeType", "modifiedTime", "version", "trashed")} | {"md5Checksum": f.get("md5")}


def drive(e, partes, q):
    fs = e["drive"]["archivos"]
    if partes == ["changes", "startPageToken"]:
        return 200, {"startPageToken": str(len(e["drive"]["cambios"]))}
    if partes == ["changes"]:
        tok = (q.get("pageToken") or [None])[0]
        if tok is None or not tok.isdigit() or int(tok) > len(e["drive"]["cambios"]):
            return 400, {"error": "pageToken inválido"}
        n, tam = int(tok), min(int((q.get("pageSize") or ["10"])[0]), 10)
        lote = e["drive"]["cambios"][n:n + tam]
        out = []
        for c in lote:
            vis = drive_visible(e, c["fileId"])
            out.append({"fileId": c["fileId"], "time": c["time"], "removed": not vis} | ({"file": meta_drive(fs[c["fileId"]])} if vis else {}))
        fin = n + len(lote)
        return 200, {"changes": out} | ({"nextPageToken": str(fin)} if fin < len(e["drive"]["cambios"]) else {"newStartPageToken": str(fin)})
    if partes == ["files"]:
        vis = sorted(f for f in fs if drive_visible(e, f) and not fs[f]["trashed"])
        n = int((q.get("pageToken") or ["0"])[0] or 0)
        out = {"files": [meta_drive(fs[f]) for f in vis[n:n + 10]]}
        return 200, out | ({"nextPageToken": str(n + 10)} if n + 10 < len(vis) else {})
    if partes[:1] == ["files"] and len(partes) in (2, 3):
        fid = partes[1]
        if not drive_visible(e, fid):
            return 404, {"error": f"File not found: {fid}."}
        f = fs[fid]
        if len(partes) == 3 and partes[2] == "permissions":
            return 200, {"permissions": f["permissions"]}
        if len(partes) == 2:
            if (q.get("alt") or [""])[0] == "media":
                return 200, ((FUENTES / f["bytes"]).read_bytes(), f["mimeType"])
            return 200, meta_drive(f)
    return 404, {"error": "ruta desconocida"}


# ---------------------------------------------------------------- jira
JQL = re.compile(r'^project\s+(?:=\s*(?P<uno>[A-Z]+)|in\s*\((?P<varios>[A-Z ,]+)\))'
                 r'(?:\s+AND\s+updated\s*>=\s*"(?P<desde>\d{4}[-/]\d\d[-/]\d\d \d\d:\d\d)")?'
                 r'(?:\s+ORDER\s+BY\s+updated\s+ASC)?\s*$', re.I)


def campos_jira(e, t, completos: bool):
    f = {"summary": t["titulo"], "updated": jira_fecha(utc(t["actualizado"])), "created": jira_fecha(utc(t["creado"])),
         "project": {"key": t["proyecto"]}, "reporter": {"emailAddress": t["reportero"]},
         "security": ({"id": t["nivel"], "name": e["jira"]["niveles"][t["nivel"]]["nombre"]} if t["nivel"] else None)}
    if completos:
        f |= {"description": t["descripcion"], "resolution": t["resolucion"] or None,
              "comment": {"comments": [{"author": {"emailAddress": c["autor"]}, "body": c["texto"], "created": jira_fecha(utc(c["fecha"]))}
                                       for c in t["comentarios"]]}}
    return f


def jira(e, partes, q):
    ts = e["jira"]["tickets"]
    if partes == ["buscar"]:
        m = JQL.match((q.get("jql") or [""])[0].strip())
        if not m:
            return 400, {"errorMessages": ["El JQL del dojo acepta: project in (SOP, SEG) [AND updated >= \"aaaa-mm-dd hh:mm\"] [ORDER BY updated ASC]"]}
        proys = [m["uno"]] if m["uno"] else [x.strip() for x in m["varios"].split(",")]
        sel = [t for t in ts.values() if t["proyecto"] in proys and not t.get("borrado")]
        if m["desde"]:   # minutos, en la zona de la cuenta que consulta: lo que caiga en ese minuto también entra
            d = datetime.strptime(m["desde"].replace("/", "-"), "%Y-%m-%d %H:%M").replace(tzinfo=ZONA_JIRA)
            sel = [t for t in sel if utc(t["actualizado"]).replace(second=0) >= d]
        sel.sort(key=lambda t: (t["actualizado"], t["key"]))
        n, tam = int((q.get("nextPageToken") or ["0"])[0] or 0), min(int((q.get("maxResults") or ["20"])[0]), 20)
        lote = sel[n:n + tam]
        ultimo = n + tam >= len(sel)
        return 200, {"issues": [{"key": t["key"], "fields": campos_jira(e, t, False)} for t in lote], "isLast": ultimo} | ({} if ultimo else {"nextPageToken": str(n + tam)})
    if partes[:1] == ["ticket"] and len(partes) == 2:
        t = ts.get(partes[1])
        if not t or t.get("borrado"):
            return 404, {"errorMessages": ["Issue does not exist or you do not have permission to see it."]}
        return 200, {"key": t["key"], "fields": campos_jira(e, t, True)}
    if partes[:1] == ["proyecto"] and len(partes) == 3 and partes[2] == "permisos":
        p = e["jira"]["proyectos"].get(partes[1])
        return (200, {"ver": p["ver"]}) if p else (404, {"errorMessages": ["No project"]})
    if partes[:1] == ["nivel"] and len(partes) == 2:
        n = e["jira"]["niveles"].get(partes[1])
        return (200, n) if n else (404, {"errorMessages": ["No level"]})
    return 404, {"errorMessages": ["ruta desconocida"]}


# ---------------------------------------------------------------- políticas
def politicas(e, partes, q):
    a = e["politicas"]["archivos"]
    if partes == ["arbol"]:
        return 200, {"commit": e["politicas"]["commit"], "archivos": [{"ruta": r, "sha": blob_sha(t.encode())} for r, t in sorted(a.items())]}
    if partes[:1] == ["crudo"]:
        r = unquote("/".join(partes[1:]))
        return (200, (a[r].encode(), "text/markdown")) if r in a else (404, {"error": "no existe"})
    return 404, {"error": "ruta desconocida"}


RUTAS = {"wiki": ("wiki", "api", wiki), "drive": ("drive", "v3", drive), "jira": ("jira", "api", jira), "politicas": ("repo", "politicas", politicas)}


class Manejador(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def responder(self, codigo, cuerpo, extra=None):
        if isinstance(cuerpo, tuple):
            b, tipo = cuerpo
        else:
            b, tipo = json.dumps(cuerpo, ensure_ascii=False).encode(), "application/json; charset=utf-8"
        self.send_response(codigo)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(b)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):  # noqa: N802
        u = urlparse(self.path)
        partes = [p for p in u.path.split("/") if p]
        if partes == ["salud"]:
            e = estado()
            return self.responder(200, {"ok": True, "reloj": e["reloj"], "dia": e["dia"]})
        e = estado()
        for fuente, (a, b, fn) in RUTAS.items():
            if partes[:2] == [a, b]:
                tok = self.headers.get("Authorization", "")
                LLAMADAS.append(f"{time.strftime('%H:%M:%S')} {fuente:<9} {u.path}")
                if tok != f"Bearer {e['tokens'][fuente]}":
                    LLAMADAS[-1] += " → 401"
                    return self.responder(401, {"error": "token inválido o vencido"})
                if fuente == "wiki":
                    espera = _permitida(tok, e["limite_wiki"])
                    if espera:
                        LLAMADAS[-1] += " → 429"
                        return self.responder(429, {"error": "demasiadas llamadas"}, {"Retry-After": str(max(1, round(espera + 0.5)))})
                try:
                    codigo, cuerpo = fn(e, partes[2:], parse_qs(u.query))
                except Exception as ex:  # noqa: BLE001
                    codigo, cuerpo = 500, {"error": f"{type(ex).__name__}: {ex}"}
                if codigo != 200:
                    LLAMADAS[-1] += f" → {codigo}"
                return self.responder(codigo, cuerpo)
        self.responder(404, {"error": "ruta desconocida"})


# ---------------------------------------------------------------- comandos
def responde() -> bool:
    try:
        return json.loads(urlopen(f"{BASE}/salud", timeout=1).read())["ok"]
    except Exception:  # noqa: BLE001
        return False


def arrancar() -> None:
    if responde():
        print(f"✓ las fuentes ya responden en {BASE}")
        return
    estado()
    TALLER.mkdir(exist_ok=True)
    with open(LOG, "ab") as log:
        p = subprocess.Popen([sys.executable, __file__, "servir"], stdout=log, stderr=log, start_new_session=True)
    PID.write_text(str(p.pid))
    for _ in range(50):
        if responde():
            print(f"✓ fuentes arriba en {BASE} (pid {p.pid}): wiki, drive, jira y políticas")
            return
        time.sleep(0.1)
    sys.exit(f"✗ las fuentes no respondieron; mira {LOG.relative_to(TALLER.parent)}")


def parar() -> None:
    if PID.exists():
        try:
            os.kill(int(PID.read_text()), signal.SIGTERM)
        except (ProcessLookupError, ValueError):
            pass
        PID.unlink()
    for _ in range(30):
        if not responde():
            break
        time.sleep(0.1)
    print("✓ fuentes apagadas")


def servir() -> None:
    srv = ThreadingHTTPServer(("127.0.0.1", PUERTO), Manejador)
    ThreadingHTTPServer.daemon_threads = True

    def log_srv():   # para «fuentes.py log»: el servidor escribe sus últimas llamadas cada segundo
        while True:
            time.sleep(1)
            (TALLER / "llamadas.txt").write_text("\n".join(LLAMADAS) + "\n")

    threading.Thread(target=log_srv, daemon=True).start()
    srv.serve_forever()


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "arrancar":
        arrancar()
    elif cmd == "parar":
        parar()
    elif cmd == "servir":
        servir()
    elif cmd == "estado":
        from mundo.crear import resumen

        e = estado()
        print(("✓ responden en " + BASE if responde() else "✗ no responden: python mundo/fuentes.py arrancar") + f" · reloj del mundo {e['reloj']} (día {e['dia']})")
        print("  " + resumen(e))
    elif cmd == "token" and len(sys.argv) == 3 and sys.argv[2] in RUTAS:
        print(estado()["tokens"][sys.argv[2]])
    elif cmd == "unidad" and len(sys.argv) == 3 and sys.argv[2] in ("on", "off"):
        e = estado()
        e["acceso"]["drive_compartida"] = sys.argv[2] == "on"
        guardar(e)
        print(f"✓ la cuenta del conector {'ya tiene' if sys.argv[2] == 'on' else 'ya no tiene'} acceso a la unidad compartida de operaciones")
    elif cmd == "log":
        p = TALLER / "llamadas.txt"
        print(p.read_text() if p.exists() else "(sin llamadas todavía)", end="")
    else:
        sys.exit(__doc__)
