"""El buscapersonas del dojo (no es parte de lo que escribes): lo que en C01 son PagerDuty (los page), Slack (los
warning), la cola de tickets del equipo de ML y un «dead man's switch» (el servicio externo que espera el latido).

    python mundo/servicios.py arrancar buscapersonas      # escucha en :8966 (lo arranca mundo/crear.py)

Recibe:
- POST /alertmanager/<receptor>   el webhook de Alertmanager (formato versión 4), en guardia, canal, tickets o latido.
  Cada notificación queda en logs/avisos.jsonl. Una alerta que dispara en «tickets» abre un ticket en la cola
  (id «am-<alertname>-<startsAt>»). En «latido», solo anota la hora: si pasan más de latido_max_s (plataforma.yaml)
  sin latido, avisa en logs/avisos.jsonl que se perdió y /metrics lo dice.
- POST /api/tickets                un ticket de un job (tu disparador): JSON con id, titulo, regla, slice y lo que
  quieras agregar. 201 si lo abre; 409 si ese id ya existe (la llave es el id: mandar el mismo dos veces no duplica).
- POST /api/tickets/<id>/decision  {accion, nota, quien}: lo que decidió una persona (mundo/tickets.py decidir).
- GET  /api/tickets · /api/avisos · /estado · /metrics
"""
from __future__ import annotations

import json
import sys
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import LOGS, escribir_json, leer_json, plataforma  # noqa: E402

TICKETS = LOGS / "tickets.json"
AVISOS = LOGS / "avisos.jsonl"
CANDADO = threading.Lock()
ESTADO = {"latido": None, "latidos": 0, "perdido_desde": None, "avisos": {}}
RECEPTORES = {"guardia", "canal", "tickets", "latido"}
ACCIONES = {"rollback", "avisar-dueno", "etiquetar", "reentrenar", "nada"}


def ahora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def anotar(x: dict) -> None:
    LOGS.mkdir(exist_ok=True)
    with AVISOS.open("a") as f:
        f.write(json.dumps({"recibido": ahora(), **x}, ensure_ascii=False) + "\n")


def tickets() -> list[dict]:
    return leer_json(TICKETS, [])


def abrir(t: dict) -> tuple[int, dict]:
    with CANDADO:
        ts = tickets()
        if any(x["id"] == t["id"] for x in ts):
            return 409, {"error": f"ya existe el ticket {t['id']}", "id": t["id"]}
        t = {**t, "abierto": ahora(), "estado": "abierto", "decision": None}
        ts.append(t)
        escribir_json(TICKETS, ts)
    anotar({"receptor": "tickets", "ticket": t["id"], "titulo": t.get("titulo", "")})
    print(f"🎫 ticket {t['id']}: {t.get('titulo', '')}", flush=True)
    return 201, t


def alertmanager(receptor: str, d: dict) -> None:
    if receptor == "latido":
        with CANDADO:
            ESTADO["latido"], ESTADO["latidos"] = time.time(), ESTADO["latidos"] + 1
            if ESTADO["perdido_desde"]:
                anotar({"receptor": "latido", "estado": "volvió", "perdido_desde": ESTADO["perdido_desde"]})
                print(f"💓 volvió el latido (se había perdido desde {ESTADO['perdido_desde']})", flush=True)
            ESTADO["perdido_desde"] = None
        return
    alertas = [{"alertname": a["labels"].get("alertname"), "severity": a["labels"].get("severity"), "status": a["status"],
                "startsAt": a.get("startsAt"), "labels": a["labels"],
                "summary": (a.get("annotations") or {}).get("summary", "")} for a in d.get("alerts", [])]
    ESTADO["avisos"][receptor] = ESTADO["avisos"].get(receptor, 0) + 1
    anotar({"receptor": receptor, "status": d.get("status"), "groupKey": d.get("groupKey"),
            "grupo": d.get("groupLabels", {}), "alertas": alertas})
    quien = plataforma()["buscapersonas"]["guardia"]
    nombres = ", ".join(sorted({f"{a['alertname']} ({a['status']})" for a in alertas}))
    marca = {"guardia": f"📟 PAGE a {quien}", "canal": "💬 canal del equipo", "tickets": "🎫 cola de tickets"}[receptor]
    print(f"{marca}: {nombres}", flush=True)
    if receptor == "tickets":
        for a in alertas:
            if a["status"] == "firing":
                abrir({"id": f"am-{a['alertname']}-{a['startsAt']}", "titulo": a["summary"] or a["alertname"],
                       "regla": a["alertname"], "slice": None, "origen": "alertmanager", "labels": a["labels"]})


def vigilar_latido() -> None:
    maximo = plataforma()["buscapersonas"]["latido_max_s"]
    while True:
        time.sleep(5)
        with CANDADO:
            ultimo = ESTADO["latido"]
            if ultimo and not ESTADO["perdido_desde"] and time.time() - ultimo > maximo:
                ESTADO["perdido_desde"] = datetime.fromtimestamp(ultimo, timezone.utc).isoformat(timespec="seconds")
                anotar({"receptor": "latido", "estado": "perdido", "ultimo": ESTADO["perdido_desde"]})
                print(f"🚨 SIN LATIDO: el último Watchdog llegó a las {ESTADO['perdido_desde']} (más de {maximo} s): "
                      "Prometheus o Alertmanager no están avisando", flush=True)


def metricas() -> str:
    m = ["# HELP buscapersonas_ultimo_latido_timestamp_seconds Cuándo llegó el último Watchdog",
         "# TYPE buscapersonas_ultimo_latido_timestamp_seconds gauge",
         f"buscapersonas_ultimo_latido_timestamp_seconds {ESTADO['latido'] or 0}",
         "# HELP buscapersonas_latido_perdido 1 si pasó latido_max_s sin Watchdog",
         "# TYPE buscapersonas_latido_perdido gauge",
         f"buscapersonas_latido_perdido {1 if ESTADO['perdido_desde'] else 0}",
         "# HELP buscapersonas_notificaciones_total Notificaciones recibidas por receptor",
         "# TYPE buscapersonas_notificaciones_total counter"]
    m += [f'buscapersonas_notificaciones_total{{receptor="{r}"}} {ESTADO["avisos"].get(r, 0)}' for r in sorted(RECEPTORES - {"latido"})]
    m += ["# TYPE buscapersonas_tickets_abiertos gauge",
          f"buscapersonas_tickets_abiertos {sum(1 for t in tickets() if t['estado'] == 'abierto')}"]
    return "\n".join(m) + "\n"


class Manejador(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def responder(self, st: int, cuerpo, tipo: str = "application/json") -> None:
        b = cuerpo.encode() if isinstance(cuerpo, str) else json.dumps(cuerpo, ensure_ascii=False, indent=1).encode()
        self.send_response(st)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if self.path == "/metrics":
            return self.responder(200, metricas(), "text/plain; version=0.0.4")
        if self.path == "/api/tickets":
            return self.responder(200, tickets())
        if self.path.startswith("/api/avisos"):
            lineas = AVISOS.read_text().splitlines() if AVISOS.exists() else []
            return self.responder(200, [json.loads(x) for x in lineas[-200:]])
        if self.path in ("/", "/estado"):
            ult = ESTADO["latido"]
            return self.responder(200, {"latido_hace_s": round(time.time() - ult, 1) if ult else None,
                                        "latidos": ESTADO["latidos"], "latido_perdido_desde": ESTADO["perdido_desde"],
                                        "notificaciones": ESTADO["avisos"],
                                        "tickets_abiertos": sum(1 for t in tickets() if t["estado"] == "abierto")})
        return self.responder(404, {"error": "no existe"})

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        try:
            d = json.loads(self.rfile.read(n) or b"{}")
        except json.JSONDecodeError:
            return self.responder(400, {"error": "el cuerpo no es JSON"})
        partes = self.path.strip("/").split("/")
        if len(partes) == 2 and partes[0] == "alertmanager":
            if partes[1] not in RECEPTORES:
                return self.responder(404, {"error": f"no hay receptor {partes[1]}: {sorted(RECEPTORES)}"})
            alertmanager(partes[1], d)
            return self.responder(200, {"ok": True})
        if partes == ["api", "tickets"]:
            faltan = [k for k in ("id", "titulo", "regla") if not d.get(k)]
            if faltan:
                return self.responder(400, {"error": f"al ticket le falta {', '.join(faltan)}"})
            return self.responder(*abrir(d))
        if len(partes) == 4 and partes[:2] == ["api", "tickets"] and partes[3] == "decision":
            if d.get("accion") not in ACCIONES:
                return self.responder(400, {"error": f"accion tiene que ser una de {sorted(ACCIONES)}"})
            with CANDADO:
                ts = tickets()
                t = next((x for x in ts if x["id"] == partes[2]), None)
                if not t:
                    return self.responder(404, {"error": f"no hay ticket {partes[2]}"})
                t["decision"] = {"accion": d["accion"], "nota": d.get("nota", ""), "quien": d.get("quien", ""), "fecha": ahora()}
                t["estado"] = "decidido"
                escribir_json(TICKETS, ts)
            anotar({"receptor": "tickets", "ticket": t["id"], "decision": t["decision"]})
            return self.responder(200, t)
        return self.responder(404, {"error": "no existe"})


def main() -> None:
    puerto = plataforma()["buscapersonas"]["puerto"]
    threading.Thread(target=vigilar_latido, daemon=True).start()
    s = ThreadingHTTPServer(("0.0.0.0", puerto), Manejador)
    print(f"buscapersonas en :{puerto} · guardia: {plataforma()['buscapersonas']['guardia']}", flush=True)
    s.serve_forever()


if __name__ == "__main__":
    main()
