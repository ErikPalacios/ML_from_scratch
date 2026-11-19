"""El job programado monitoreo-diario (no es parte de lo que escribes): lo que en C01 es el CronWorkflow de Argo
Workflows de la 01:00 UTC. Corre tus pasos sobre AYER, con la cuenta de servicio del job (mundo/plataforma.yaml), no
con la tuya.

    python mundo/cron.py correr      # como `argo submit --from cronwf/monitoreo-diario`: corre ahora
    python mundo/cron.py estado      # las últimas corridas: cuándo, cuánto tardó, si terminó bien

Cada corrida queda en logs/cron.json. Si un paso termina con error, los siguientes no corren.
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import LOGS, RAIZ, escribir_json, leer_json, plataforma  # noqa: E402

CORRIDAS = LOGS / "cron.json"


def correr() -> bool:
    job = plataforma()["jobs"]["monitoreo-diario"]
    env = {**os.environ, "AWS_ACCESS_KEY_ID": job["s3"]["llave"], "AWS_SECRET_ACCESS_KEY": job["s3"]["secreto"],
           "PUSHGATEWAY_URL": job["pushgateway"], "PYTHONUNBUFFERED": "1"}
    inicio = datetime.now(timezone.utc)
    t0 = time.time()
    pasos, ok = [], True
    for p in job["pasos"]:
        r = subprocess.run([sys.executable, p], cwd=RAIZ, capture_output=True, text=True, env=env, timeout=900)
        salida = (r.stdout + r.stderr).strip().splitlines()
        pasos.append({"paso": p, "codigo": r.returncode, "salida": salida[-6:]})
        print(f"{'✓' if r.returncode == 0 else '✗'} {p} (código {r.returncode})")
        for linea in salida[-6:]:
            print(f"    {linea}")
        if r.returncode != 0:
            ok = False
            break
    corridas = leer_json(CORRIDAS, [])
    corridas.append({"inicio": inicio.isoformat(timespec="seconds"), "segundos": round(time.time() - t0, 1),
                     "ok": ok, "pasos": pasos})
    escribir_json(CORRIDAS, corridas[-30:])
    print(f"{'✓ terminó bien' if ok else '✗ falló'} en {time.time() - t0:.1f} s (logs/cron.json)")
    return ok


def estado() -> None:
    for c in leer_json(CORRIDAS, [])[-10:] or [{"inicio": "(ninguna corrida)", "segundos": 0, "ok": None, "pasos": []}]:
        marca = {True: "✓", False: "✗", None: " "}[c["ok"]]
        print(f"{marca} {c['inicio']}  {c['segundos']} s  " + " · ".join(f"{p['paso']}={p['codigo']}" for p in c["pasos"]))


if __name__ == "__main__":
    que = sys.argv[1] if len(sys.argv) > 1 else ""
    if que == "correr":
        sys.exit(0 if correr() else 1)
    elif que == "estado":
        estado()
    else:
        sys.exit(__doc__)
