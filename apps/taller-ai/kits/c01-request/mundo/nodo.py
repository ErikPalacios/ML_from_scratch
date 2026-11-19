"""El kubelet del dojo: arranca, para y revisa los pods y lo de alrededor.

    python mundo/nodo.py arrancar             # todo: Triton, los pods del gateway, el ALB, el vigía de S3 y el tráfico
    python mundo/nodo.py arrancar gateway     # o una parte: triton | gateway | alb | vigia | trafico
    python mundo/nodo.py reiniciar gateway    # después de cambiar tu rastro.py: un pod tras otro, como un rollout
    python mundo/nodo.py matar a              # mata el contenedor del pod del nodo a; su runtime lo vuelve a arrancar
    python mundo/nodo.py logs a [n]           # las últimas n líneas del log del pod del nodo a, tal como están en su disco
    python mundo/nodo.py parar [parte]
    python mundo/nodo.py estado

Cada pod del gateway corre en su nodo (los contenedores nodo-a y nodo-b de compose.yaml), dentro de mundo/runtime.py,
que escribe su stdout en el disco de ese nodo (/var/log/…), donde lo lee el Fluent Bit del mismo nodo. Triton, el ALB,
el vigía y el tráfico de siempre (5 fotos/s de los tres callers: producción nunca está quieta) son procesos de tu Mac y
escriben en logs/.
Al arrancar o parar algo publica la lista de pods en nodo/descubrimiento/pods.json y servicios.json: lo que la API de
Kubernetes le contesta a Prometheus (kubernetes_sd_configs con role: pod y role: endpoints), con los mismos nombres de
etiquetas __meta_kubernetes_*. Prometheus lee esos archivos con file_sd_configs.
"""
from __future__ import annotations

import json
import os
import re
import signal
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import (ALB, DESCUBRIMIENTO, LOGS, NS, RAIZ, VIGIA, compose, en_nodo, escribir_json, http,  # noqa: E402
                         igual_en, plataforma)

PY = sys.executable
HOST = "host.docker.internal"          # cómo llega Prometheus (en un contenedor) a un proceso de tu Mac


def etiqueta(k: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_]", "_", k)


def pod(nodo_o_nombre: str) -> dict:
    for p in plataforma()["pods"]:
        if p["tipo"] == "gateway" and nodo_o_nombre in (p["nodo"], p["nombre"], f"nodo-{p['nodo']}"):
            return p
    sys.exit(f"no hay un pod del gateway «{nodo_o_nombre}»: a | b")


def procesos() -> dict[str, dict]:
    """Lo que corre en tu Mac."""
    tr = next(p for p in plataforma()["pods"] if p["tipo"] == "triton")
    return {
        "triton": {"cmd": [PY, "mundo/triton_dojo/servidor.py", "--model-repository=model_repository",
                           f"--http-port={tr['puerto']}", "--model-control-mode=none", "--strict-readiness=true",
                           "--exit-on-error=true", "--exit-timeout-secs=30", "--disable-auto-complete-config"],
                   "salud": f"http://localhost:{tr['puerto']}/v2/health/ready", "log": LOGS / "triton.log"},
        "alb": {"cmd": [PY, "mundo/alb.py"], "salud": f"{ALB}/_dojo/salud", "log": LOGS / "alb-proceso.log"},
        "vigia": {"cmd": [PY, "mundo/vigia_s3.py"], "salud": f"{VIGIA}/metrics", "log": LOGS / "vigia.log"},
        "trafico": {"cmd": [PY, "mundo/carga.py", "--siempre", "--tasa", "5", "--basura", "0.02", "--semilla", "5"],
                    "salud": None, "log": LOGS / "trafico.log"},
    }


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


def nodos_arriba() -> set[str]:
    r = compose("ps", "--format", "json", "nodo-a", "nodo-b", timeout=30)
    out = set()
    for linea in r.stdout.splitlines():
        try:
            d = json.loads(linea)
        except json.JSONDecodeError:
            continue
        if d.get("State") == "running":
            out.add(d["Service"].removeprefix("nodo-"))
    return out


def publicar() -> None:
    """Lo que vería Prometheus en la API de Kubernetes: los pods que corren y los Services del gateway."""
    arriba = nodos_arriba()
    pods_sd, servicios = [], []
    for p in plataforma()["pods"]:
        if p["tipo"] == "gateway" and p["nodo"] not in arriba:
            continue
        if p["tipo"] == "triton" and not pid_de("triton"):
            continue
        destino = f"nodo-{p['nodo']}:{p['puerto']}" if p["tipo"] == "gateway" else f"{HOST}:{p['puerto']}"
        meta = {"__meta_kubernetes_namespace": NS, "__meta_kubernetes_pod_name": p["nombre"],
                "__meta_kubernetes_pod_node_name": f"nodo-{p['nodo']}", "__meta_kubernetes_pod_uid": p["uid"],
                "__meta_kubernetes_pod_container_name": p["tipo"],
                "__meta_kubernetes_pod_container_port_name": "metrics" if p["tipo"] == "triton" else "http",
                "__meta_kubernetes_pod_container_port_number": str(p["puerto"])}
        for k, v in (p.get("etiquetas") or {}).items():
            meta[f"__meta_kubernetes_pod_label_{etiqueta(k)}"] = str(v)
            meta[f"__meta_kubernetes_pod_labelpresent_{etiqueta(k)}"] = "true"
        pods_sd.append({"targets": [destino], "labels": meta})
        if p["tipo"] == "gateway":     # el Rollout tiene dos Services; fuera de un canary los dos eligen los mismos pods
            for svc in ("gateway-stable", "gateway-canary"):
                servicios.append({"targets": [destino], "labels": {**meta, "__meta_kubernetes_service_name": svc,
                                                                    "__meta_kubernetes_endpoint_port_name": "http"}})
    escribir_json(DESCUBRIMIENTO / "pods.json", pods_sd)
    escribir_json(DESCUBRIMIENTO / "servicios.json", servicios)


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


def arrancar_proceso(nombre: str) -> bool:
    v = procesos()[nombre]
    if pid := pid_de(nombre):
        print(f"  {nombre} ya corre (PID {pid})")
        return True
    LOGS.mkdir(exist_ok=True)
    with open(v["log"], "ab") as f:
        pr = subprocess.Popen(v["cmd"], cwd=RAIZ, stdout=f, stderr=subprocess.STDOUT, start_new_session=True,
                              env={**os.environ, "PYTHONUNBUFFERED": "1"})
    pidfile(nombre).write_text(str(pr.pid))
    t0 = time.time()
    if v["salud"]:
        ok = esperar(v["salud"], 60, lambda: pid_de(nombre) is not None)
    else:                                    # sin endpoint de salud: basta con que siga vivo
        time.sleep(1.5)
        ok = pid_de(nombre) is not None
    publicar()
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
    publicar()
    print(f"  {nombre} parado")


def esperar_pod(p: dict, segundos: float = 90) -> bool:
    t0 = time.time()
    if esperar(f"http://localhost:{p['puerto_host']}/readyz", segundos):
        print(f"✓ {p['nombre']} (nodo-{p['nodo']}) listo en {time.time() - t0:.1f} s")
        return True
    print(f"⚠ {p['nombre']} (nodo-{p['nodo']}) no dice «listo» en {segundos:.0f} s. Lo último de su log "
          f"(python mundo/nodo.py logs {p['nodo']}):\n{texto_logs(p['nodo'], 12)}")
    return False


def arrancar_gateway(reiniciar: bool = False) -> bool:
    ok = True
    for p in [x for x in plataforma()["pods"] if x["tipo"] == "gateway"]:
        if reiniciar:                        # que el nodo vea tu código completo antes de arrancar el pod
            for f in ("gateway/app/rastro.py", "gateway/app/main.py", "gateway.yaml"):
                igual_en(f"nodo-{p['nodo']}", RAIZ / f, f"/kit/{f}")
        baja = LOGS / "alb-drenar" / p["nombre"]
        if reiniciar:                        # la baja del target group antes de apagarlo: sin requests cortadas (502)
            baja.parent.mkdir(parents=True, exist_ok=True)
            baja.touch()
            time.sleep(1.5)
        r = compose("restart" if reiniciar else "up", *([] if reiniciar else ["-d", "--no-deps"]), f"nodo-{p['nodo']}",
                    timeout=300)
        if r.returncode != 0:
            print(f"✗ nodo-{p['nodo']}: {r.stderr.strip()[-400:]}")
            ok = False
            continue
        ok = esperar_pod(p) and ok           # uno tras otro: el otro pod sigue atendiendo
        if reiniciar:
            time.sleep(4.5)                  # que el ALB lo vea listo otra vez (2 revisiones cada 2 s) antes de soltarlo
            baja.unlink(missing_ok=True)
    publicar()
    return ok


def texto_logs(nodo: str, n: int = 20) -> str:
    codigo = ("import glob,os\n"
              "fs=sorted(glob.glob('/var/log/pods/*/gateway/*.log'),key=os.path.getmtime)\n"
              "f=fs[-1] if fs else None\n"
              f"print(f);print(''.join(open(f,errors='replace').readlines()[-{n}:]) if f else '(sin log)')\n")
    r = en_nodo(nodo, codigo)
    return r.stdout.strip() if r.returncode == 0 else f"(no pude entrar al nodo-{nodo}: {r.stderr.strip()[-200:]})"


def matar(nodo: str) -> None:
    p = pod(nodo)
    codigo = ("import json,os,signal\n"
              f"e=json.load(open('/var/lib/dojo/{p['nombre']}.json'))\n"
              "os.kill(e['pid'],signal.SIGKILL);print(e['pid'],e['reinicios'])\n")
    r = en_nodo(p["nodo"], codigo)
    if r.returncode != 0:
        sys.exit(f"no pude matar el contenedor de {p['nombre']}: {r.stderr.strip()[-300:]}")
    pid, n = r.stdout.split()
    print(f"  contenedor de {p['nombre']} (PID {pid} en nodo-{p['nodo']}) muerto con SIGKILL; su runtime lo vuelve a arrancar")
    time.sleep(1.5)
    if esperar_pod(p):
        print(f"  reinicios: {int(n) + 1}")


def estado() -> None:
    for nombre, v in procesos().items():
        pid = pid_de(nombre)
        salud = (http(v["salud"], timeout=1)[0] or "sin respuesta") if v["salud"] else "vivo"
        print(f"{nombre:<28} " + (f"PID {pid} · salud {salud}" if pid else "no corre"))
    arriba = nodos_arriba()
    for p in [x for x in plataforma()["pods"] if x["tipo"] == "gateway"]:
        if p["nodo"] not in arriba:
            print(f"{p['nombre']:<28} nodo-{p['nodo']} apagado")
            continue
        r = en_nodo(p["nodo"], f"import json;print(json.dumps(json.load(open('/var/lib/dojo/{p['nombre']}.json'))))")
        e = json.loads(r.stdout) if r.returncode == 0 and r.stdout.strip() else {}
        listo = http(f"http://localhost:{p['puerto_host']}/readyz", timeout=1)[0] or "sin respuesta"
        print(f"{p['nombre']:<28} nodo-{p['nodo']} · /readyz {listo} · reinicios {e.get('reinicios', '?')} · {e.get('archivo', '')}")


def main() -> None:
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    accion, parte = args[0], (args[1] if len(args) > 1 else None)
    todas = ["triton", "gateway", "alb", "vigia", "trafico"]
    partes = todas if parte in (None, "todo") else [parte]
    if any(x not in todas for x in partes) and accion in ("arrancar", "parar", "reiniciar"):
        sys.exit(f"no conozco «{parte}»: {' | '.join(todas)}")
    if accion == "arrancar":
        ok = all([arrancar_gateway() if x == "gateway" else arrancar_proceso(x) for x in partes])
        sys.exit(0 if ok else 1)
    elif accion == "parar":
        for x in reversed(partes):
            if x == "gateway":
                compose("stop", "nodo-a", "nodo-b", timeout=120)
                publicar()
                print("  nodo-a y nodo-b parados")
            else:
                parar_proceso(x)
    elif accion == "reiniciar":
        for x in partes:
            if x == "gateway":
                ok = arrancar_gateway(reiniciar=True)
            else:
                parar_proceso(x)
                ok = arrancar_proceso(x)
            if not ok:
                sys.exit(1)
    elif accion == "matar":
        matar(parte or "")
    elif accion == "logs":
        print(texto_logs(pod(parte or "a")["nodo"], int(args[2]) if len(args) > 2 else 20))
    elif accion == "estado":
        estado()
    elif accion == "publicar":
        publicar()
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
