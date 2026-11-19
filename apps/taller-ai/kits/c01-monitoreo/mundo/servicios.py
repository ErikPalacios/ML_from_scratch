"""Arranca, para y revisa lo que corre en tu Mac: Triton, los dos pods del gateway, el buscapersonas y el tráfico.

    python mundo/servicios.py arrancar                 # todo
    python mundo/servicios.py arrancar triton          # o una parte: triton | gateway | buscapersonas | trafico
    python mundo/servicios.py arrancar triton --falla 30   # un Triton que truena en el 30 % de las inferencias
    python mundo/servicios.py reiniciar gateway        # un pod tras otro, como un rollout (después de un cambio)
    python mundo/servicios.py parar [parte]
    python mundo/servicios.py estado

Los pods del gateway son la release 15 con el rastro de la estación 11 (escriben su línea de log en logs/gateway-a.log
y logs/gateway-b.log). En C01 son pods de Kubernetes y Triton corre en una T4; aquí, procesos de tu Mac. El tráfico
de siempre son 5 fotos/s de los tres callers (C01: ≈ 116): producción nunca está quieta.
"""
from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import LOGS, RAIZ, compose, http, plataforma  # noqa: E402

PY = sys.executable
PARTES = {"triton": ["triton"], "gateway": ["gateway-a", "gateway-b"], "buscapersonas": ["buscapersonas"],
          "trafico": ["trafico"]}
ORDEN = ["triton", "gateway-a", "gateway-b", "buscapersonas", "trafico"]


def procesos() -> dict[str, dict]:
    pl = plataforma()
    tr = pl["triton"]
    out = {
        "triton": {"cmd": [PY, "mundo/triton_dojo/servidor.py", "--model-repository=model_repository",
                           f"--http-port={tr['puerto']}", "--model-control-mode=none", "--strict-readiness=true",
                           "--exit-on-error=true", "--exit-timeout-secs=30", "--disable-auto-complete-config"],
                   "salud": f"http://localhost:{tr['puerto']}/v2/health/ready", "env": {}},
        "buscapersonas": {"cmd": [PY, "mundo/buscapersonas.py"], "env": {},
                          "salud": f"http://localhost:{pl['buscapersonas']['puerto']}/estado"},
        "trafico": {"cmd": [PY, "mundo/carga.py", "--siempre", "--tasa", "5", "--semilla", "5"], "salud": None, "env": {}},
    }
    for p in pl["pods"]:
        out[f"gateway-{p['nodo']}"] = {
            "cmd": [PY, "-m", "uvicorn", "app.main:app", "--app-dir", "gateway", "--host", "127.0.0.1",
                    "--port", str(p["puerto"]), "--workers", "1", "--timeout-keep-alive", "75", "--no-access-log"],
            "salud": f"http://localhost:{p['puerto']}/readyz",
            "env": {"POD": p["nombre"], "NODO": f"nodo-{p['nodo']}", "TRITON_URL": f"localhost:{tr['puerto']}"}}
    for k, v in out.items():
        v["log"] = LOGS / f"{k}.log"
    return out


def pidfile(nombre: str) -> Path:
    return LOGS / f"{nombre}.pid"


def pid_de(nombre: str) -> int | None:
    p = pidfile(nombre)
    if not p.exists():
        return None
    pid = int(p.read_text())
    try:
        os.kill(pid, 0)
        return pid
    except ProcessLookupError:
        p.unlink()
        return None


def esperar(url: str, segundos: float, vivo=lambda: True) -> bool:
    t0 = time.time()
    while time.time() - t0 < segundos:
        if not vivo():
            return False
        if http(url, timeout=1)[0] == 200:
            return True
        time.sleep(0.3)
    return False


def cola(p: Path, n: int = 10) -> str:
    return "\n".join(p.read_text(errors="replace").splitlines()[-n:]) if p.exists() else "(sin log)"


def arrancar_proceso(nombre: str, extra_env: dict | None = None) -> bool:
    v = procesos()[nombre]
    if pid := pid_de(nombre):
        print(f"  {nombre} ya corre (PID {pid})")
        return True
    LOGS.mkdir(exist_ok=True)
    with open(v["log"], "ab") as f:
        pr = subprocess.Popen(v["cmd"], cwd=RAIZ, stdout=f, stderr=subprocess.STDOUT, start_new_session=True,
                              env={**os.environ, "PYTHONUNBUFFERED": "1", **v["env"], **(extra_env or {})})
    pidfile(nombre).write_text(str(pr.pid))
    t0 = time.time()
    if v["salud"]:
        ok = esperar(v["salud"], 60, lambda: pid_de(nombre) is not None)
    else:
        time.sleep(1.5)
        ok = pid_de(nombre) is not None
    if ok:
        print(f"✓ {nombre} listo en {time.time() - t0:.1f} s")
    else:
        print(f"⚠ {nombre} no dice «listo» en 60 s. Lo último de {v['log'].relative_to(RAIZ)}:\n{cola(v['log'])}")
    return ok


def parar_proceso(nombre: str) -> None:
    pid = pid_de(nombre)
    if not pid:
        print(f"  {nombre} no corre")
        return
    try:
        os.killpg(pid, signal.SIGCONT)
        os.killpg(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    for _ in range(150):
        time.sleep(0.1)
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            break
    else:
        try:
            os.killpg(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    pidfile(nombre).unlink(missing_ok=True)
    print(f"  {nombre} parado")


def nombres(parte: str | None) -> list[str]:
    if not parte:
        return ORDEN
    if parte in PARTES:
        return PARTES[parte]
    if parte in ORDEN:
        return [parte]
    sys.exit(f"no conozco «{parte}»: {' | '.join(PARTES)}")


def estado() -> None:
    for n in ORDEN:
        v = procesos()[n]
        pid = pid_de(n)
        salud = ""
        if pid and v["salud"]:
            salud = " · listo" if http(v["salud"], timeout=1)[0] == 200 else " · NO listo"
        print(f"{n:<14} {'corre (PID ' + str(pid) + ')' if pid else 'parado'}{salud}")
    r = compose("ps", "--all", "--format", "{{.Service}}\t{{.State}}\t{{.Status}}", timeout=30)
    print("\n" + (r.stdout.strip() or "(compose no tiene contenedores: python mundo/crear.py)"))


def main() -> None:
    import argparse

    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("accion", choices=["arrancar", "parar", "reiniciar", "estado"])
    ap.add_argument("parte", nargs="?")
    ap.add_argument("--falla", type=float, default=0, help="Triton: %% de inferencias que truenan")
    a = ap.parse_args()
    if a.accion == "estado":
        return estado()
    ns = nombres(a.parte)
    extra = {"TRITON_DOJO_FALLA_PCT": str(a.falla)} if a.falla else None
    ok = True
    if a.accion in ("parar", "reiniciar") and not (a.accion == "reiniciar" and a.parte == "gateway"):
        for n in reversed(ns):
            parar_proceso(n)
    if a.accion == "reiniciar" and a.parte == "gateway":
        for n in ns:                                 # uno tras otro: siempre hay un pod que contesta
            parar_proceso(n)
            ok &= arrancar_proceso(n)
    elif a.accion in ("arrancar", "reiniciar"):
        for n in ns:
            ok &= arrancar_proceso(n, extra if n == "triton" else None)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
