"""Arranca, para y revisa tu API: uvicorn con pipeline/api.py en segundo plano, con su log en .taller/api.log.

    python mundo/api.py arrancar   # uvicorn api:app en api.host:api.puerto (config.yaml); espera a /health (hasta 60 s)
    python mundo/api.py parar
    python mundo/api.py estado
    python mundo/api.py log        # las últimas 40 líneas del log

Es lo que en C11 harían el contenedor y su orquestador: tener el proceso vivo y su log en un lugar. Tú escribes
pipeline/api.py; esto solo lo lanza. Después de cambiar tu código, vuelve a arrancarla (config.yaml no: se lee en
cada pregunta).
"""
from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import API_LOG, API_PID, CONFIG, RAIZ, TALLER  # noqa: E402


def dir_api() -> tuple[str, int]:
    a = yaml.safe_load(CONFIG.read_text())["api"]
    return a["host"], int(a["puerto"])


def url() -> str:
    h, p = dir_api()
    return f"http://{h}:{p}"


def vivo() -> int | None:
    try:
        pid = int(API_PID.read_text())
        os.kill(pid, 0)
        return pid
    except (FileNotFoundError, ValueError, ProcessLookupError, PermissionError):
        return None


def salud(timeout: float = 2) -> str | None:
    try:
        with urllib.request.urlopen(f"{url()}/health", timeout=timeout) as r:
            return r.read().decode()
    except Exception:  # noqa: BLE001
        return None


def parar() -> None:
    pid = vivo()
    if pid:
        try:
            os.killpg(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        for _ in range(50):
            if not vivo():
                break
            time.sleep(0.1)
        print(f"■ API parada (pid {pid})")
    API_PID.unlink(missing_ok=True)


def arrancar() -> None:
    if vivo():
        parar()
    TALLER.mkdir(exist_ok=True)
    h, p = dir_api()
    log = open(API_LOG, "w")
    cmd = [sys.executable, "-m", "uvicorn", "api:app", "--app-dir", "pipeline", "--host", h, "--port", str(p), "--log-level", "info"]
    proc = subprocess.Popen(cmd, cwd=RAIZ, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    API_PID.write_text(str(proc.pid))
    for _ in range(120):
        if proc.poll() is not None:
            cola = API_LOG.read_text().strip().splitlines()[-8:]
            sys.exit("✗ la API terminó sola (código %s). Lo último del log:\n  %s" % (proc.returncode, "\n  ".join(cola)))
        if salud() and '"ok"' in salud():
            print(f"▶ API arriba (pid {proc.pid}) en {url()} · POST /v1/ask · log en .taller/api.log")
            return
        time.sleep(0.5)
    sys.exit("✗ la API no contestó /health en 60 s: python mundo/api.py log")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "estado"
    if cmd == "arrancar":
        arrancar()
    elif cmd == "parar":
        parar()
    elif cmd == "log":
        print("\n".join(API_LOG.read_text().splitlines()[-40:]) if API_LOG.exists() else "(sin log todavía)")
    else:
        pid = vivo()
        print(f"{'▶ corriendo, pid ' + str(pid) if pid else '■ parada'} · {url()}/health: {salud() or 'sin respuesta'}")
