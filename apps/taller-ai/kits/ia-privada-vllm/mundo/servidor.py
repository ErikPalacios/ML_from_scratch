"""Arranca, para y revisa tu servidor: corre ./servir.sh en segundo plano y guarda su log en .taller/servidor.log.

    python3 mundo/servidor.py arrancar   # ./servir.sh en segundo plano; espera a que /health conteste
    python3 mundo/servidor.py parar
    python3 mundo/servidor.py estado
    python3 mundo/servidor.py log        # las últimas 40 líneas del log

Si no hay vLLM instalado (tu Mac), pone mundo/bin en el PATH: `vllm serve …` corre el vLLM del dojo (simulado).
En la GPU rentada, con vLLM instalado, corre el de verdad: el mismo servir.sh sirve en los dos lados.
Es lo que en el despacho haría systemd (o el contenedor): tener el proceso vivo y su log en un lugar.
"""
from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import GPU_ENV, LOG, MUNDO, PID, RAIZ, TALLER, base_url, leer_env, motor  # noqa: E402

ESPERA_S = 900   # la primera vez en la GPU, vLLM baja ≈ 19 GB y compila: puede tardar minutos


def vivo() -> int | None:
    try:
        pid = int(PID.read_text())
        os.kill(pid, 0)
        return pid
    except (FileNotFoundError, ValueError, ProcessLookupError, PermissionError):
        return None


def salud(timeout: float = 2) -> int | None:
    try:
        with urllib.request.urlopen(base_url() + "/health", timeout=timeout) as r:
            return r.status
    except Exception:  # noqa: BLE001
        return None


def parar() -> None:
    pid = vivo()
    if pid:
        try:
            os.killpg(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        for _ in range(150):
            if not vivo():
                break
            time.sleep(0.2)
        else:
            try:
                os.killpg(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        print(f"■ servidor parado (pid {pid})")
    PID.unlink(missing_ok=True)


def arrancar() -> None:
    if vivo():
        parar()
    TALLER.mkdir(exist_ok=True)
    tipo, linea = motor()
    env = dict(os.environ)
    if tipo == "simulado":
        env["PATH"] = f"{MUNDO / 'bin'}{os.pathsep}{env.get('PATH', '')}"
        env["DOJO_GPU"] = (leer_env(GPU_ENV).get("GPU") or "l40s").lower()
    log = open(LOG, "w")
    p = subprocess.Popen(["bash", "servir.sh"], cwd=RAIZ, stdout=log, stderr=subprocess.STDOUT, start_new_session=True, env=env)
    PID.write_text(str(p.pid))
    t0 = time.monotonic()
    while time.monotonic() - t0 < ESPERA_S:
        if p.poll() is not None:
            cola = LOG.read_text().strip().splitlines()[-6:]
            sys.exit("✗ servir.sh terminó solo (código %s). Lo último del log:\n  %s" % (p.returncode, "\n  ".join(cola)))
        if salud() == 200:
            print(f"▶ servidor arriba (pid {p.pid}) en {base_url()} en {time.monotonic() - t0:.0f} s · {linea} · log en .taller/servidor.log")
            return
        time.sleep(1)
    sys.exit(f"✗ el servidor no contestó /health en {ESPERA_S} s: python3 mundo/servidor.py log")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "estado"
    if cmd == "arrancar":
        arrancar()
    elif cmd == "parar":
        parar()
    elif cmd == "log":
        print("\n".join(LOG.read_text().splitlines()[-40:]) if LOG.exists() else "(sin log todavía)")
    else:
        pid = vivo()
        print(f"{'▶ corriendo, pid ' + str(pid) if pid else '■ parado'} · /health: {salud() or 'sin respuesta'} · {motor()[1]}")
