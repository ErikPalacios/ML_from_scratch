"""Levanta el mundo de la estación 12 (≈ 2 min; la primera vez, ≈ 4). Se puede correr otra vez: deja todo como al
principio, salvo tu código.

    python mundo/crear.py

1. Revisa Docker y el venv, y vuelve la carpeta del kit un repositorio de git (si no lo es): los cambios de otros
   equipos llegan como commits, y se deshacen con git revert.
2. Levanta compose.yaml: el S3 local (RustFS), Prometheus, Alertmanager y el Pushgateway. Prometheus nace con 8 días de
   métricas del gateway ya guardadas (mundo/historia.py metricas), como si llevara una semana leyendo.
3. Deja en S3 la historia: 60 días de logs en Parquet (el job de la estación 11), los eventos del backend, el golden
   set y el historial de despliegues (mundo/historia.py s3).
4. Arranca, con mundo/servicios.py, Triton, los dos pods del gateway, el buscapersonas y el tráfico de siempre.
"""
from __future__ import annotations

import shutil
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import CACHE, LOGS, NODO, PROMETHEUS, RAIZ, compose, git, http, prom, sh  # noqa: E402

AUTOR = {"GIT_AUTHOR_NAME": "Equipo de classifier", "GIT_AUTHOR_EMAIL": "classifier@c01.test",
         "GIT_COMMITTER_NAME": "Equipo de classifier", "GIT_COMMITTER_EMAIL": "classifier@c01.test"}


def paso(t: str) -> None:
    print(f"\n== {t}", flush=True)


def revisar() -> None:
    if sh("docker", "info", timeout=30).returncode != 0:
        sys.exit("✗ Docker no contesta: abre Docker Desktop y vuelve a correr python mundo/crear.py")
    faltan = []
    for m in ("fastapi", "uvicorn", "tritonclient", "prometheus_client", "onnxruntime", "boto3", "duckdb", "httpx"):
        try:
            __import__(m)
        except ImportError:
            faltan.append(m)
    if faltan:
        sys.exit(f"✗ faltan paquetes en este Python ({sys.executable}): {', '.join(faltan)}. "
                 "Activa el venv del kit: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt")


def repositorio() -> None:
    if not (RAIZ / ".git").exists():
        sh("git", "init", "-q", "-b", "main", check=True)
        sh("git", "add", "-A", check=True)
        sh("git", "commit", "-q", "-m", "classifier: release 15 con su rastro (la estación 11)", check=True, env=AUTOR)
        print("✓ la carpeta del kit es un repositorio de git (main)")
    else:
        print(f"✓ repositorio de git: {git('rev-parse', '--abbrev-ref', 'HEAD')} @ {git('rev-parse', '--short', 'HEAD')}")


def main() -> None:
    t0 = time.time()
    paso("Docker, el venv y git")
    revisar()
    repositorio()
    LOGS.mkdir(exist_ok=True)
    shutil.rmtree(NODO / "historia", ignore_errors=True)      # un mundo nuevo nace hoy, con su historia nueva
    (NODO / "historia").mkdir(parents=True, exist_ok=True)
    shutil.rmtree(CACHE, ignore_errors=True)
    for f in ("tickets.json", "avisos.jsonl", "orquestador.json", "cron.json"):
        (LOGS / f).unlink(missing_ok=True)
    paso("compose: S3, Alertmanager y el Pushgateway (Prometheus después, con su historia)")
    sh(sys.executable, "mundo/servicios.py", "parar")
    compose("rm", "-sf", "prometheus", "alertmanager", "pushgateway", timeout=120)
    for v in ("prom-monitoreo", "am-monitoreo", "pg-monitoreo"):
        sh("docker", "volume", "rm", "-f", f"taller-c01-monitoreo_{v}", timeout=60)
    r = compose("up", "-d", "--wait", "s3", "alertmanager", "pushgateway", timeout=900)
    if r.returncode != 0:
        sys.exit(f"✗ docker compose up falló:\n{r.stderr[-2000:]}")
    print("✓ s3 :9960 · alertmanager :9963 · pushgateway :9964")
    paso("La historia de S3: 60 días de logs y eventos")
    if subprocess.run([sys.executable, "mundo/historia.py", "s3"], cwd=RAIZ).returncode != 0:
        sys.exit("✗ no pude dejar la historia en S3")
    paso("Prometheus, con 8 días de métricas ya guardadas")
    if subprocess.run([sys.executable, "mundo/historia.py", "metricas"], cwd=RAIZ).returncode != 0:
        sys.exit("✗ no pude rellenar la historia de Prometheus")
    r = compose("up", "-d", "--wait", "prometheus", timeout=600)
    if r.returncode != 0:
        sys.exit(f"✗ Prometheus no arrancó:\n{r.stderr[-2000:]}")
    print("✓ prometheus :9962")
    paso("Los procesos: Triton, los pods del gateway, el buscapersonas y el tráfico")
    r = subprocess.run([sys.executable, "mundo/servicios.py", "arrancar"], cwd=RAIZ)
    if r.returncode != 0:
        sys.exit("✗ algo no arrancó: mira el mensaje de arriba")
    http(f"{PROMETHEUS}/-/reload", metodo="POST")
    for _ in range(40):                      # que Prometheus ya haya leído a todos al menos una vez
        if len(prom("up == 1")) >= 7:
            break
        time.sleep(1)
    print(f"\n✓ el mundo está arriba en {time.time() - t0:.0f} s. Sigue con: python verificar.py mundo")


if __name__ == "__main__":
    main()
