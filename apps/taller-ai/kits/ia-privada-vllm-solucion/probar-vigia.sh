#!/usr/bin/env bash
# Prueba mundo/gpu.py (vigilar, estado, apagar) contra una API falsa de RunPod en la Mac, sin cuenta ni costo: que
# mande las peticiones de la API v2 con la llave, que el vigía termine el pod al tope y que apagar lo confirme.
# Uso: bash probar-vigia.sh <carpeta de probar.sh>
set -uo pipefail
SOL="$(cd "$(dirname "$0")" && pwd)"
D="$1"; cd "$D"
cp "$SOL/gpu.env" gpu.env
python3 - <<'PY' &
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
vivos = {"falso123": "RUNNING", "falso456": "RUNNING"}
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def r(self, code, body=None):
        d = json.dumps(body).encode() if body is not None else b""
        self.send_response(code); self.send_header("Content-Length", str(len(d))); self.end_headers(); self.wfile.write(d)
    def ok(self): return self.headers.get("Authorization") == "Bearer llave-falsa"
    def do_GET(self):
        pid = self.path.split("/")[-1]
        if not self.ok(): return self.r(401, {"error": "unauthorized"})
        return self.r(200, {"id": pid, "status": vivos[pid]}) if pid in vivos else self.r(404, {"error": "not found"})
    def do_POST(self):
        pid = self.path.split("/")[-2]
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        print(f"API falsa: POST {self.path} {body} · llave {'bien' if self.ok() else 'MAL'}", flush=True)
        if self.ok() and pid in vivos and body == {"action": "terminate"}:
            del vivos[pid]; return self.r(204)
        return self.r(409, {"error": "no"})
HTTPServer(("127.0.0.1", 8765), H).serve_forever()
PY
API=$!; sleep 1
export RUNPOD_API_URL=http://127.0.0.1:8765/v2 RUNPOD_API_KEY=llave-falsa
sed -i '' 's/^POD_ID=.*/POD_ID=falso123/; s/^MINUTOS=.*/MINUTOS=0.1/' gpu.env
python3 mundo/gpu.py estado
python3 mundo/gpu.py vigilar
sleep 9; cat .taller/vigia.log; python3 mundo/gpu.py estado
sed -i '' 's/^POD_ID=.*/POD_ID=falso456/; s/^MINUTOS=.*/MINUTOS=90/' gpu.env
python3 mundo/gpu.py vigilar; python3 mundo/gpu.py estado; python3 mundo/gpu.py apagar; python3 mundo/gpu.py estado
RUNPOD_API_KEY= python3 mundo/gpu.py estado
kill $API; cp "$SOL/gpu.env" gpu.env
