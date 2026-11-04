"""Deja el kit como recién descomprimido, para la ronda Solo.

    python3 mundo/reiniciar.py

Respalda tus archivos (Dockerfiles, .dockerignore, requirements, compose.yaml) en .respaldo/, pone el esqueleto
en su lugar, baja la pila de compose y borra las imágenes iris-*, sus etiquetas del registry y el contenedor
registry. La imagen base python:3.13-slim se queda: no hace falta volver a bajarla.
"""
from __future__ import annotations

import shutil
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import IMG_GW, IMG_MS, RAIZ, REGISTRY, TALLER, sh  # noqa: E402

ESQ = Path(__file__).resolve().parent / "esqueleto"
TUYOS = ["gateway/Dockerfile", "gateway/.dockerignore", "gateway/requirements.in", "gateway/requirements.txt",
         "model_server/Dockerfile", "model_server/Dockerfile.dockerignore", "model_server/requirements.in",
         "model_server/requirements.txt", "compose.yaml"]

if __name__ == "__main__":
    resp = RAIZ / ".respaldo" / f"archivos-{datetime.now():%Y%m%d-%H%M%S}"
    for rel in TUYOS:
        p = RAIZ / rel
        if p.exists():
            (resp / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(p, resp / rel)
    if resp.exists():
        print(f"  tu versión anterior quedó respaldada en {resp.relative_to(RAIZ)}/")
    if (RAIZ / "compose.yaml").exists():
        sh("docker", "compose", "down", timeout=120)
        print("  docker compose down")
    for rel in TUYOS:
        (RAIZ / rel).unlink(missing_ok=True)
    for f in ESQ.rglob("*"):
        if f.is_file():
            destino = RAIZ / f.relative_to(ESQ)
            destino.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(f, destino)
    print("  esqueleto en su lugar: Dockerfiles, .dockerignore, requirements.in y compose.yaml con su contrato")
    sh("docker", "rm", "-f", "registry")
    sh("docker", "rmi", IMG_GW, IMG_MS, f"{REGISTRY}/{IMG_GW}", f"{REGISTRY}/{IMG_MS}")
    print("  imágenes iris-*, sus etiquetas del registry y el contenedor registry: borrados")
    shutil.rmtree(TALLER, ignore_errors=True)
    print("✓ listo")
