"""Levanta el mundo de la estación 11 (≈ 1 min). Se puede correr otra vez: deja todo como al principio, salvo tu código.

    python mundo/crear.py

1. Revisa Docker y el venv, y vuelve la carpeta del kit un repositorio de git (si no lo es): los cambios de la
   plataforma llegan como commits, y se deshacen con git revert.
2. Levanta compose.yaml: el S3 local (RustFS), Prometheus y un Fluent Bit por nodo del gateway, y construye la imagen
   de los nodos (Python y lo que pide gateway/requirements.txt).
3. Crea el bucket ml-datos y deja el log de AYER ya subido en logs/crudo/ (≈ 12,000 requests de los dos nodos, con el
   rollout de la 14 a la 15 a las 16:00 UTC, dos archivos subidos dos veces y unas líneas de stderr), para tu job diario.
4. Arranca, con mundo/nodo.py, Triton (en tu Mac), los dos pods del gateway (uno en cada nodo), el ALB y el vigía de S3,
   y recarga Prometheus.
"""
from __future__ import annotations

import gzip
import json
import random
import shutil
import subprocess
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import (BUCKET, CRUDO, DESCUBRIMIENTO, LOGS, PROMETHEUS, RAIZ, compose, git, http, objetos,  # noqa: E402
                         plataforma, s3, sh)

AUTOR = {"GIT_AUTHOR_NAME": "Equipo de classifier", "GIT_AUTHOR_EMAIL": "classifier@c01.test",
         "GIT_COMMITTER_NAME": "Equipo de classifier", "GIT_COMMITTER_EMAIL": "classifier@c01.test"}
VERSIONES = ("resnet50-2026-10-01", "resnet50-2026-11-01")     # la 14 y la 15


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
        sh("git", "commit", "-q", "-m", "classifier: release 15 al 100 % (la estación 10)", check=True, env=AUTOR)
        print("✓ la carpeta del kit es un repositorio de git (main)")
    else:
        print(f"✓ repositorio de git: {git('rev-parse', '--abbrev-ref', 'HEAD')} @ {git('rev-parse', '--short', 'HEAD')}")


def carpetas() -> None:
    shutil.rmtree(LOGS / "alb-drenar", ignore_errors=True)    # una baja que quedó de un reinicio interrumpido
    DESCUBRIMIENTO.mkdir(parents=True, exist_ok=True)
    for f in ("pods.json", "servicios.json"):
        if not (DESCUBRIMIENTO / f).exists():
            (DESCUBRIMIENTO / f).write_text("[]\n")
    LOGS.mkdir(exist_ok=True)


def linea_ayer(rng: random.Random, hora: datetime, version: str) -> dict:
    caller = rng.choices(["backend-publicaciones", "moderacion", "busqueda"], [0.7, 0.2, 0.1])[0]
    fuente = {"backend-publicaciones": rng.choices(["mobile", "web"], [0.6, 0.4])[0], "moderacion": "internal",
              "busqueda": "web"}[caller]
    status = rng.choices([200, 415, 405, 503, 504], [0.965, 0.02, 0.005, 0.006, 0.004])[0]
    ev = {"request_id": str(uuid.UUID(int=rng.getrandbits(128), version=4)), "caller": caller, "source": fuente,
          "model_version": version}
    if status in (415, 405):
        ev.update(ms={"total": round(rng.uniform(0.3, 1.2), 1)}, error="tipo no soportado" if status == 415 else "Method Not Allowed")
    else:
        pre, tri = round(rng.lognormvariate(1.1, 0.35), 1), round(rng.lognormvariate(1.6, 0.4), 1)
        ev.update(bytes=rng.randint(1800, 2600), sha256=f"{rng.getrandbits(48):012x}")
        if status == 200:
            s = sorted((rng.random() for _ in range(5)), reverse=True)
            tot = sum(s) + 0.3
            ev.update(top5=[[i, round(x / tot, 4)] for i, x in zip(rng.sample(range(10), 5), s)],
                      ms={"pre": pre, "triton": tri, "post": 0.2, "total": round(pre + tri + 0.2 + rng.uniform(0.5, 2), 1)})
        else:
            tri = 150.0 if status == 504 else round(rng.uniform(0.5, 3), 1)
            ev.update(ms={"pre": pre, "triton": tri, "total": round(pre + tri + 1, 1)},
                      error="Triton no contestó en 150 ms" if status == 504 else "sin conexión con Triton (ClientConnectorError)")
    ev["status"] = status
    return ev


def registro(hora: datetime, texto: str, nodo: str, stream: str = "stdout") -> str:
    t = hora.strftime("%Y-%m-%dT%H:%M:%S.%f") + "000Z"
    return json.dumps({"date": hora.strftime("%Y-%m-%dT%H:%M:%S.%fZ"), "time": t, "stream": stream, "_p": "F",
                       "log": texto, "nodo": nodo}, ensure_ascii=False, separators=(",", ":"))


def log_de_ayer() -> None:
    hoy = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    ayer = hoy - timedelta(days=1)
    c = s3()
    try:
        c.create_bucket(Bucket=BUCKET)
    except c.exceptions.BucketAlreadyOwnedByYou:
        pass
    except Exception as e:  # noqa: BLE001
        if "BucketAlreadyExists" not in str(e) and "AlreadyOwned" not in str(e):
            raise
    viejos = objetos(f"{CRUDO}{ayer:%Y/%m/%d}/") + objetos(f"{CRUDO}{hoy:%Y/%m/%d}/00/")
    for o in viejos:
        c.delete_object(Bucket=BUCKET, Key=o["Key"])
    rng = random.Random(20261111)
    archivos: dict[str, list[str]] = {}
    n = 0
    for nodo in ("a", "b"):
        t = ayer + timedelta(seconds=rng.uniform(0, 20))
        while t < hoy + timedelta(seconds=20):
            # cada request entra al archivo de la subida en curso (Fluent Bit sube cada 5 min en C01; en este día, igual)
            subida = t.replace(second=0, microsecond=0) + timedelta(minutes=5 - t.minute % 5)
            if t >= hoy:                         # lo de después de medianoche ya es de hoy: no lo genera
                break
            version = VERSIONES[0] if t.hour < 16 else VERSIONES[1]
            llave = f"{CRUDO}{subida:%Y/%m/%d/%H}/{nodo}-{uuid.UUID(int=rng.getrandbits(128)).hex[:8]}"
            llave = archivos.setdefault(f"{nodo}{subida:%Y%m%d%H%M}", [llave])[0]
            archivos.setdefault(llave, []).append(registro(t, json.dumps(linea_ayer(rng, t, version), ensure_ascii=False,
                                                                       separators=(",", ":")), nodo))
            n += 1
            if t.hour == 16 and t.minute == 0 and rng.random() < 0.05:     # los pods nuevos avisan al arrancar
                archivos[llave].append(registro(t, f"gateway listo · {version} · Triton triton-v15:8000", nodo, "stderr"))
            # ≈ 116 req/s en C01; aquí, un día chico: ≈ 6,000 por nodo
            t += timedelta(seconds=rng.expovariate(1 / 14.4))
    llaves = [k for k in archivos if k.startswith(CRUDO)]
    for k in llaves:
        c.put_object(Bucket=BUCKET, Key=f"{k}.gz", Body=gzip.compress(("\n".join(archivos[k]) + "\n").encode()))
    dobles = sorted(llaves)[100:102]             # Fluent Bit reintentó y los subió dos veces (al menos una vez)
    for k in dobles:
        otro = k.rsplit("-", 1)[0] + f"-{uuid.UUID(int=rng.getrandbits(128)).hex[:8]}.gz"
        c.put_object(Bucket=BUCKET, Key=otro, Body=gzip.compress(("\n".join(archivos[k]) + "\n").encode()))
    print(f"✓ log de ayer ({ayer:%Y-%m-%d}) en s3://{BUCKET}/{CRUDO}{ayer:%Y/%m/%d}/: {n:,} requests en "
          f"{len(llaves) + len(dobles)} archivos ({len(dobles)} subidos dos veces); los de las 23:55 en adelante, en "
          f"{CRUDO}{hoy:%Y/%m/%d}/00/")


def main() -> None:
    t0 = time.time()
    paso("Docker, el venv y git")
    revisar()
    repositorio()
    carpetas()
    paso("compose: S3, Prometheus, los dos nodos del gateway y su Fluent Bit (la primera vez construye la imagen del nodo, ≈ 1 min)")
    sh(sys.executable, "mundo/nodo.py", "parar")
    r = compose("up", "-d", "--build", "--wait", "s3", "prometheus", "fluent-bit-a", "fluent-bit-b", timeout=900)
    if r.returncode != 0:
        sys.exit(f"✗ docker compose up falló:\n{r.stderr[-2000:]}")
    r = compose("build", "nodo-a", timeout=900)
    if r.returncode != 0:
        sys.exit(f"✗ no pude construir la imagen del nodo:\n{r.stderr[-2000:]}")
    print("✓ s3 :9950 · prometheus :9952 · fluent-bit-a :9953 · fluent-bit-b :9954 · imagen dojo-c01-nodo:11")
    paso("El log de ayer, ya subido")
    log_de_ayer()
    paso("Los procesos: Triton, los pods del gateway, el ALB y el vigía")
    r = subprocess.run([sys.executable, "mundo/nodo.py", "arrancar"], cwd=RAIZ)
    if r.returncode != 0:
        sys.exit("✗ algo no arrancó: mira el mensaje de arriba")
    http(f"{PROMETHEUS}/-/reload", metodo="POST")
    pl = plataforma()
    print(f"\n✓ el mundo está arriba en {time.time() - t0:.0f} s. La entrada es el ALB: http://localhost:{pl['alb']['oyente']}"
          "\n  Sigue con: python verificar.py mundo")


if __name__ == "__main__":
    main()
