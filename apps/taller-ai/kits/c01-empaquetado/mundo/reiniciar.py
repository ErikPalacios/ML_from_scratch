"""Deja el kit como recién descomprimido, para la ronda Solo.

    python3 mundo/reiniciar.py

Respalda tus archivos (Dockerfiles, .dockerignore, requirements, los compose.yaml) en .respaldo/, pone el
esqueleto en su lugar, baja las dos pilas de compose (la del kit y la del servidor) y borra las imágenes iris-*,
sus etiquetas del registry y los contenedores registry e iris-volumen. La imagen base python:3.13-slim se queda: no hace falta volver a bajarla.
"""
from __future__ import annotations

import shutil
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import IMG_GW, IMG_MS, IMG_MS_SIN, RAIZ, REGISTRY, SERVIDOR, TALLER, VOLUMEN, sh  # noqa: E402

ESQ = Path(__file__).resolve().parent / "esqueleto"
TUYOS = ["gateway/Dockerfile", "gateway/.dockerignore", "gateway/requirements.in", "gateway/requirements.txt",
         "model_server/Dockerfile", "model_server/Dockerfile.dockerignore", "model_server/requirements.in",
         "model_server/requirements.txt", "compose.yaml", "model_server/Dockerfile.volumen",
         "servidor/compose.yaml", "servidor/config.env"]

if __name__ == "__main__":
    resp = RAIZ / ".respaldo" / f"archivos-{datetime.now():%Y%m%d-%H%M%S}"
    for rel in TUYOS:
        p = RAIZ / rel
        if p.exists():
            (resp / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(p, resp / rel)
    if resp.exists():
        print(f"  tu versión anterior quedó respaldada en {resp.relative_to(RAIZ)}/")
    if (SERVIDOR / "compose.yaml").exists():
        sh("docker", "compose", "down", timeout=120, cwd=SERVIDOR)
        print("  servidor: docker compose down")
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
    print("  esqueleto en su lugar: Dockerfiles, .dockerignore, requirements.in y los compose.yaml con su contrato")
    sh("docker", "rm", "-f", "registry", VOLUMEN)
    sh("docker", "rmi", IMG_GW, IMG_MS, IMG_MS_SIN, f"{REGISTRY}/{IMG_GW}", f"{REGISTRY}/{IMG_MS}")
    print("  imágenes iris-*, sus etiquetas del registry y los contenedores registry e iris-volumen: borrados")
    shutil.rmtree(TALLER, ignore_errors=True)
    print("✓ listo")
