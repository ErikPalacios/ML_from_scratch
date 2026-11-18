"""Arranca, para y revisa los dos procesos que sirven: el servidor de modelos (Triton del dojo) y tu gateway.

    python mundo/servicios.py arrancar            # los dos: primero Triton, luego el gateway
    python mundo/servicios.py arrancar triton     # o solo uno (triton | gateway)
    python mundo/servicios.py reiniciar gateway   # después de cambiar tu código o gateway.yaml
    python mundo/servicios.py parar               # los dos (o uno)
    python mundo/servicios.py estado              # qué corre, con qué PID, si está vivo, listo… o congelado

Cada proceso escribe su salida en logs/: logs/triton.log y logs/gateway.log (las líneas de JSON de tu gateway).
En C01 esto lo hace Kubernetes: arranca cada copia, le pregunta /healthz y /readyz, y la reinicia o la saca del reparto.
"""
from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import GW, LOGS, RAIZ, TRITON, arriba  # noqa: E402

PY = sys.executable
COMANDOS = {
    "triton": [PY, "mundo/triton_dojo/servidor.py", "--model-repository=model_repository", "--http-port=8700",
               "--model-control-mode=none", "--strict-readiness=true", "--exit-on-error=true",
               "--exit-timeout-secs=30", "--disable-auto-complete-config"],
    "gateway": [PY, "-m", "uvicorn", "app.main:app", "--app-dir", "gateway", "--host", "127.0.0.1", "--port", "8701",
                "--workers", "1", "--timeout-keep-alive", "75", "--timeout-graceful-shutdown", "20", "--no-access-log"],
}
SALUD = {"triton": (f"{TRITON}/v2/health/live", f"{TRITON}/v2/health/ready"),
         "gateway": (f"{GW}/healthz", f"{GW}/readyz")}
ESPERA = {"triton": 60, "gateway": 20}


def pid_de(nombre: str) -> int | None:
    p = LOGS / f"{nombre}.pid"
    if not p.exists():
        return None
    pid = int(p.read_text())
    try:
        os.kill(pid, 0)
        return pid
    except ProcessLookupError:
        p.unlink()
        return None


def estado_ps(pid: int) -> str:
    r = subprocess.run(["ps", "-o", "stat=", "-p", str(pid)], capture_output=True, text=True)
    return r.stdout.strip()


def cola(nombre: str, n: int = 12) -> str:
    p = LOGS / f"{nombre}.log"
    return "\n".join(p.read_text(errors="replace").splitlines()[-n:]) if p.exists() else "(sin log)"


def arrancar(nombre: str) -> bool:
    if pid := pid_de(nombre):
        print(f"  {nombre} ya corre (PID {pid}): python mundo/servicios.py reiniciar {nombre}")
        return True
    LOGS.mkdir(exist_ok=True)
    log = LOGS / f"{nombre}.log"
    if log.exists():
        log.replace(LOGS / f"{nombre}.anterior.log")
    print(f"  $ {' '.join(['python'] + COMANDOS[nombre][1:])}")
    with open(log, "wb") as f:
        pr = subprocess.Popen(COMANDOS[nombre], cwd=RAIZ, stdout=f, stderr=subprocess.STDOUT, start_new_session=True,
                              env={**os.environ, "PYTHONUNBUFFERED": "1"})
    (LOGS / f"{nombre}.pid").write_text(str(pr.pid))
    vivo, listo = SALUD[nombre]
    t0 = time.time()
    while time.time() - t0 < ESPERA[nombre]:
        if pr.poll() is not None:
            (LOGS / f"{nombre}.pid").unlink(missing_ok=True)
            print(f"✗ {nombre} terminó al arrancar (código {pr.returncode}). Lo último de logs/{nombre}.log:\n{cola(nombre)}")
            return False
        if arriba(listo, 1) == 200:
            print(f"✓ {nombre} listo en {time.time() - t0:.1f} s (PID {pr.pid}) · log: logs/{nombre}.log")
            return True
        time.sleep(0.2)
    print(f"⚠ {nombre} corre (PID {pr.pid}) pero no dice «listo» después de {ESPERA[nombre]} s: "
          f"vivo {arriba(vivo, 1)}, listo {arriba(listo, 1)}. Lo último de logs/{nombre}.log:\n{cola(nombre)}")
    return False


def parar(nombre: str) -> None:
    pid = pid_de(nombre)
    if not pid:
        print(f"  {nombre} no corre")
        return
    os.kill(pid, signal.SIGCONT)          # si estaba congelado, primero lo despierta para que pueda apagarse
    os.kill(pid, signal.SIGTERM)
    for _ in range(100):
        time.sleep(0.1)
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            break
    else:
        os.kill(pid, signal.SIGKILL)
    (LOGS / f"{nombre}.pid").unlink(missing_ok=True)
    print(f"  {nombre} parado (PID {pid})")


def estado() -> None:
    for nombre in ("triton", "gateway"):
        pid = pid_de(nombre)
        if not pid:
            print(f"{nombre:<8} no corre")
            continue
        st = estado_ps(pid)
        congelado = st.startswith("T")
        vivo, listo = SALUD[nombre]
        v, l = arriba(vivo, 1), arriba(listo, 1)
        ruta = lambda u: "/" + u.split("/", 3)[-1]  # noqa: E731
        print(f"{nombre:<8} PID {pid} · ps {st}{' (congelado: SIGSTOP)' if congelado else ''} · "
              f"{ruta(vivo)} {v or 'sin respuesta en 1 s'} · {ruta(listo)} {l or 'sin respuesta en 1 s'}")


def main(a: list[str]) -> None:
    if not a or a[0] not in ("arrancar", "parar", "reiniciar", "estado"):
        sys.exit(__doc__)
    if a[0] == "estado":
        return estado()
    nombres = [a[1]] if len(a) > 1 else ["triton", "gateway"]
    if any(n not in COMANDOS for n in nombres):
        sys.exit(__doc__)
    ok = True
    if a[0] in ("parar", "reiniciar"):
        for n in reversed(nombres):
            parar(n)
    if a[0] in ("arrancar", "reiniciar"):
        for n in nombres:
            ok = arrancar(n) and ok
            if not ok:
                break
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main(sys.argv[1:])
