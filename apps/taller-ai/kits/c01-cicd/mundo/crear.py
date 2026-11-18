"""Crea el mundo de la estación 8. Se corre una vez, después de `docker compose up -d --wait --build`. ≈ 2 min.

    python mundo/crear.py

Deja:
- Esta carpeta como repositorio de git (si no lo era) con el commit «kit recién descomprimido», y su `origin` en la
  forja: .forja/classifier.git (el GitHub del dojo, con las reglas de mundo/forja.yaml).
- El repositorio de despliegue, .forja/despliegue.git, con staging/gateway.yaml y produccion/gateway.yaml, y su hook:
  cada push a su main corre `mundo/gitops.py sincronizar`.
- El ECR del dojo con el repositorio classifier-gateway (tags que se pueden mover: así nace un repositorio en ECR) y su
  historia: las imágenes de las últimas semanas, de commits que este kit no trae, y dos que perdieron su tag.
- La imagen del commit de hoy construida, subida y corriendo en staging (localhost:8801) y en producción
  (localhost:8802), por digest. El despliegue anterior de producción es otra imagen: con ella se practica el rollback.
"""
from __future__ import annotations

import json
import secrets
import shutil
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import (DESPLIEGUE, FORJA, IMAGEN_GW, NUBE, ORIGEN, RAIZ, REGISTRO, REPO_GW, TRITON, corto, docker,  # noqa: E402
                         docker_env, escribir_json, esperar, git, leer_json, sh)

t0 = time.time()


def paso(msg: str) -> None:
    print(f"[{time.time() - t0:5.1f} s] {msg}", flush=True)


def salir(msg: str) -> None:
    sys.exit(f"✗ {msg}")


# 0 · lo que tiene que estar arriba
if not esperar(f"http://{REGISTRO}/v2/", 5, ok=(401,)):
    salir(f"el ECR del dojo no contesta en {REGISTRO}: docker compose up -d --wait --build")
if not esperar(f"{TRITON}/v2/health/ready", 5):
    salir(f"Triton no contesta en {TRITON}: docker compose up -d --wait --build")
if FORJA.exists() and "--de-nuevo" not in sys.argv:
    salir("el mundo ya existe (.forja/). Para crearlo otra vez: python mundo/crear.py --de-nuevo")
shutil.rmtree(FORJA, ignore_errors=True)
for p in ("secreto", "ecr.json", "empujes.json"):
    (NUBE / p).unlink(missing_ok=True)
for amb in ("staging", "produccion"):
    docker("rm", "-f", f"taller-c01-cicd-gw-{amb}")

# 1 · la nube: el secreto de las firmas y el repositorio de ECR (vacío por dentro: el registro de abajo puede traer
#     imágenes de una vez anterior; se borran)
NUBE.mkdir(exist_ok=True)
(NUBE / "secreto").write_bytes(secrets.token_bytes(32))
escribir_json(NUBE / "ecr.json", {"repos": {REPO_GW: {"inmutable": False, "retencion": None}}})
escribir_json(NUBE / "empujes.json", [])
from mundo.nube import borrar_imagen, cabecera, imagenes, tags, token_interno  # noqa: E402
for t in tags(REPO_GW, token_interno()):
    from mundo.nube import digest_de
    d = digest_de(REPO_GW, t, token_interno())
    if d:
        borrar_imagen(REPO_GW, d)
paso(f"ECR del dojo: {REGISTRO}/{REPO_GW} creado (tags que se pueden mover, como nace un repositorio en ECR)")

# 2 · git: esta carpeta y su origin en la forja
if not (RAIZ / ".git").exists():
    sh("git", "init", "-q", "-b", "main", check=True)
nombre = git("config", "user.name")
if not nombre:
    sh("git", "config", "user.name", "tu", check=True)
    sh("git", "config", "user.email", "tu@dojo", check=True)
if not git("rev-parse", "HEAD"):
    sh("git", "add", "-A", check=True)
    sh("git", "commit", "-qm", "kit recién descomprimido", check=True)
sh("git", "branch", "-M", "main")
FORJA.mkdir(parents=True)
sh("git", "init", "-q", "--bare", "-b", "main", str(ORIGEN), check=True)
sh("git", f"--git-dir={ORIGEN}", "config", "uploadpack.allowAnySHA1InWant", "true")
sh("git", "remote", "remove", "origin")
sh("git", "remote", "add", "origin", str(ORIGEN), check=True)
sh("git", "push", "-q", "-u", "origin", "main", check=True)
sha = git("rev-parse", "HEAD")
paso(f"forja: dojo/classifier con main en {sha[:7]} · origin = .forja/classifier.git")

# 3 · credenciales de quien opera la nube para subir la historia (tú no las usas: el CI tiene su rol)
denv = docker_env()
r = sh("docker", "login", "--username", "AWS", "--password-stdin", REGISTRO, entrada=token_interno("admin", 3600), env=denv)
if r.returncode != 0:
    salir(f"docker login al ECR del dojo falló: {r.stderr.strip()}")


def subir(ref: str) -> str:
    r = docker("push", "-q", ref, timeout=900)
    if r.returncode != 0:
        salir(f"no pude subir {ref}: {r.stderr.strip()[-300:]}")
    r = docker("buildx", "imagetools", "inspect", ref, "--format", "{{json .Manifest}}")
    return json.loads(r.stdout)["digest"]


# 4 · la imagen del commit de hoy (la receta del repositorio), y la historia: imágenes de commits anteriores
paso("construyendo la imagen del gateway del commit de hoy (la primera vez baja la base e instala, ≈ 1 min)")
tag = sha[:7]
r = docker("build", "-q", "-f", "gateway/Dockerfile", "--build-arg", f"REVISION={sha}", "-t", f"{IMAGEN_GW}:{tag}", ".", timeout=1200)
if r.returncode != 0:
    salir(f"docker build falló: {r.stderr.strip()[-600:]}")
hoy = datetime.now(timezone.utc).replace(microsecond=0)
historia = []
with tempfile.TemporaryDirectory() as tmp:
    for i in range(34):                      # 34 merges a main en ≈ 6 semanas
        falso = format(int.from_bytes(secrets.token_bytes(4), "big"), "08x")[:7]
        Path(tmp, "Dockerfile").write_text(f"FROM {IMAGEN_GW}:{tag}\nLABEL org.opencontainers.image.revision={falso}\n")
        docker("build", "-q", "-t", f"{IMAGEN_GW}:{falso}", tmp, check=True)
        historia.append((falso, subir(f"{IMAGEN_GW}:{falso}"), hoy - timedelta(days=45 - i * 1.3, hours=3)))
    # dos tags que alguien volvió a subir con otra imagen (cuando el repositorio dejaba mover tags): la vieja quedó sin tag
    for falso, _, cuando in historia[5:7]:
        Path(tmp, "Dockerfile").write_text(f"FROM {IMAGEN_GW}:{falso}\nLABEL dojo.reconstruida=si\n")
        docker("build", "-q", "-t", f"{IMAGEN_GW}:{falso}", tmp, check=True)
        subir(f"{IMAGEN_GW}:{falso}")
digest_hoy = subir(f"{IMAGEN_GW}:{tag}")
# las fechas de push de la historia (en ECR, las pone el servicio al subir)
emp = leer_json(NUBE / "empujes.json", [])
fechas = {d: c for _, d, c in historia}
reconstruidas = {f for f, _, _ in historia[5:7]}
vistos: dict[str, int] = {}
for e in emp:
    if e["digest"] in fechas:
        e["fecha"] = fechas[e["digest"]].strftime("%Y-%m-%dT%H:%M:%SZ")
    elif e["tag"] in reconstruidas:
        e["fecha"] = (fechas[next(d for f, d, _ in historia if f == e["tag"])] + timedelta(hours=5)).strftime("%Y-%m-%dT%H:%M:%SZ")
    elif e["tag"] == tag:
        e["fecha"] = (hoy - timedelta(hours=20)).strftime("%Y-%m-%dT%H:%M:%SZ")
    e["rol"] = "gha-classifier-gateway"
escribir_json(NUBE / "empujes.json", emp)
docker("logout", REGISTRO)
paso(f"ECR: {len(imagenes(REPO_GW))} imágenes (34 de la historia, 2 sin tag y la de hoy: {tag} → {corto(digest_hoy)})")

# 5 · el repositorio de despliegue: antes producción corría la última de la historia; ayer pasó a la de hoy
sh("git", "init", "-q", "--bare", "-b", "main", str(DESPLIEGUE), check=True)
hook = DESPLIEGUE / "hooks" / "post-receive"
hook.write_text(f"#!/bin/sh\n# Como Argo CD: cada cambio en main se aplica.\nunset GIT_DIR\ncd '{RAIZ}' && '{sys.executable}' mundo/gitops.py sincronizar\n")
hook.chmod(0o755)
anterior = historia[-1]
with tempfile.TemporaryDirectory() as tmp:
    d = Path(tmp)
    g = lambda *a: sh("git", "-c", "user.name=equipo-ml", "-c", "user.email=ml@dojo", *a, cwd=d, check=True)  # noqa: E731
    g("clone", "-q", str(DESPLIEGUE), ".")
    (d / "README.md").write_text("# despliegue\n\nQué imagen corre en cada ambiente de classifier. Un cambio aquí es un despliegue: "
                                 "mundo/gitops.py lo aplica en cuanto llega a main.\nLa imagen va siempre por digest.\n")
    for amb in ("staging", "produccion"):
        (d / amb).mkdir()

    def escribir(img: str, rev: str) -> None:
        for amb in ("staging", "produccion"):
            (d / amb / "gateway.yaml").write_text(
                f"# El gateway en {amb}. Lo cambia el pipeline (o un rollback); lo aplica mundo/gitops.py.\n"
                f"imagen: {IMAGEN_GW}@{img}   # commit {rev}\n"
                f"env:\n  TRITON_URL: triton:8000\n")
    escribir(anterior[1], anterior[0])
    g("add", "-A")
    g("commit", "-qm", f"gateway {anterior[0]} en staging y produccion")
    escribir(digest_hoy, tag)
    g("add", "-A")
    g("commit", "-qm", f"gateway {tag} en staging y produccion")
    r = sh("git", "push", "-q", "origin", "main", cwd=d)
    print(r.stdout + r.stderr, end="")
paso("despliegue: staging y producción piden la imagen de hoy por digest; la anterior queda en la historia de git")

ok = all(esperar(f"http://localhost:{p}/readyz", 30) for p in (8801, 8802))
if not ok:
    salir("los gateways no quedaron listos: python mundo/gitops.py estado")
paso("listo. Sigue: python verificar.py mundo")
