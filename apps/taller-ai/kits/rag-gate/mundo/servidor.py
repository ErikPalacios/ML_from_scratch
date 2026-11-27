"""Arranca, para y revisa los dos servidores de modelos: el LLM de tu API (servir.sh con servidor.env, puerto 9931) y
el juez (servir-juez.sh con juez.env, puerto 9933). Cada uno corre en segundo plano con su log en .taller/.

    python mundo/servidor.py arrancar          # los dos; espera a que cada /health diga ok (hasta 90 s cada uno)
    python mundo/servidor.py arrancar juez     # solo uno: llm o juez
    python mundo/servidor.py parar [llm|juez]
    python mundo/servidor.py estado
    python mundo/servidor.py log [llm|juez]    # las últimas 40 líneas del log

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
from mundo.comun import RAIZ, TALLER, leer_env  # noqa: E402

SERVIDORES = {
    "llm": {"env": RAIZ / "servidor.env", "script": "servir.sh", "log": TALLER / "servidor.log", "pid": TALLER / "servidor.pid", "puerto": 9931},
    "juez": {"env": RAIZ / "juez.env", "script": "servir-juez.sh", "log": TALLER / "juez.log", "pid": TALLER / "juez.pid", "puerto": 9933},
}
LOG = SERVIDORES["llm"]["log"]   # lo usan romper.py y verificar.py
PID = SERVIDORES["llm"]["pid"]


def vivo(s: str = "llm") -> int | None:
    try:
        pid = int(SERVIDORES[s]["pid"].read_text())
        os.kill(pid, 0)
        return pid
    except (FileNotFoundError, ValueError, ProcessLookupError, PermissionError):
        return None


def salud(s: str = "llm", timeout: float = 2) -> str | None:
    e = leer_env(SERVIDORES[s]["env"])
    try:
        with urllib.request.urlopen(f"http://{e.get('HOST') or '127.0.0.1'}:{e.get('PUERTO') or SERVIDORES[s]['puerto']}/health", timeout=timeout) as r:
            return r.read().decode()
    except Exception:  # noqa: BLE001
        return None


def parar(s: str = "llm") -> None:
    pid = vivo(s)
    if pid:
        try:
            os.killpg(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        for _ in range(50):
            if not vivo(s):
                break
            time.sleep(0.1)
        print(f"■ {s} parado (pid {pid})")
    SERVIDORES[s]["pid"].unlink(missing_ok=True)


def arrancar(s: str = "llm") -> None:
    x = SERVIDORES[s]
    if vivo(s):
        parar(s)
    TALLER.mkdir(exist_ok=True)
    log = open(x["log"], "w")
    p = subprocess.Popen(["bash", x["script"]], cwd=RAIZ, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    x["pid"].write_text(str(p.pid))
    for _ in range(180):
        if p.poll() is not None:
            cola = x["log"].read_text().strip().splitlines()[-8:]
            sys.exit(f"✗ {x['script']} terminó solo (código {p.returncode}). Lo último del log:\n  " + "\n  ".join(cola))
        if salud(s) and '"ok"' in salud(s):
            e = leer_env(x["env"])
            print(f"▶ {s} arriba (pid {p.pid}) en http://{e.get('HOST')}:{e.get('PUERTO')} con {Path(e.get('MODELO', '')).name} · log en .taller/{x['log'].name}")
            return
        time.sleep(0.5)
    sys.exit(f"✗ {s} no contestó /health en 90 s: python mundo/servidor.py log {s}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "estado"
    cuales = [sys.argv[2]] if len(sys.argv) > 2 else list(SERVIDORES)
    if any(c not in SERVIDORES for c in cuales):
        sys.exit(f"✗ no conozco «{cuales[0]}»: llm o juez")
    for s in cuales:
        if cmd == "arrancar":
            arrancar(s)
        elif cmd == "parar":
            parar(s)
        elif cmd == "log":
            x = SERVIDORES[s]["log"]
            print(f"--- {s}\n" + ("\n".join(x.read_text().splitlines()[-40:]) if x.exists() else "(sin log todavía)"))
        else:
            pid = vivo(s)
            print(f"{s:<5} {'▶ corriendo, pid ' + str(pid) if pid else '■ parado'} · /health: {salud(s) or 'sin respuesta'}")
