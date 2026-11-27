"""Arranca, para y revisa tu servidor: corre ./servir.sh en segundo plano y guarda su log en .taller/servidor.log.

    python mundo/servidor.py arrancar   # ./servir.sh en segundo plano; espera a que /health diga ok (hasta 90 s)
    python mundo/servidor.py parar
    python mundo/servidor.py estado
    python mundo/servidor.py log        # las últimas 40 líneas del log

Es lo que en el despacho haría systemd (o el contenedor): tener el proceso vivo y su log en un lugar. Tú escribes
servir.sh y servidor.env; esto solo lo lanza.
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
from mundo.comun import LOG, PID, RAIZ, TALLER, leer_env  # noqa: E402


def vivo() -> int | None:
    try:
        pid = int(PID.read_text())
        os.kill(pid, 0)
        return pid
    except (FileNotFoundError, ValueError, ProcessLookupError, PermissionError):
        return None


def salud(timeout: float = 2) -> str | None:
    e = leer_env()
    try:
        with urllib.request.urlopen(f"http://{e.get('HOST') or '127.0.0.1'}:{e.get('PUERTO') or 9931}/health", timeout=timeout) as r:
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
        print(f"■ servidor parado (pid {pid})")
    PID.unlink(missing_ok=True)


def arrancar() -> None:
    if vivo():
        parar()
    TALLER.mkdir(exist_ok=True)
    log = open(LOG, "w")
    p = subprocess.Popen(["bash", "servir.sh"], cwd=RAIZ, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    PID.write_text(str(p.pid))
    for _ in range(180):
        if p.poll() is not None:
            cola = LOG.read_text().strip().splitlines()[-8:]
            sys.exit("✗ servir.sh terminó solo (código %s). Lo último del log:\n  %s" % (p.returncode, "\n  ".join(cola)))
        if salud() and '"ok"' in salud():
            e = leer_env()
            print(f"▶ servidor arriba (pid {p.pid}) en http://{e.get('HOST')}:{e.get('PUERTO')} · log en .taller/servidor.log")
            return
        time.sleep(0.5)
    sys.exit("✗ el servidor no contestó /health en 90 s: python mundo/servidor.py log")


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
        print(f"{'▶ corriendo, pid ' + str(pid) if pid else '■ parado'} · /health: {salud() or 'sin respuesta'}")
