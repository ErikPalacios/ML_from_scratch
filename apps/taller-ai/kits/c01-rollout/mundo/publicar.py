"""El CI de la estación 8, en corto: construye la imagen del gateway con el código de esta carpeta, la sube al registro y
escribe su digest en k8s/kustomization.yaml en un commit. No aplica nada: en C01 eso lo hace Argo CD; aquí, tú, con
kubectl apply -k k8s/

    python3 mundo/publicar.py gateway     # gateway/ + gateway.yaml del commit actual → classifier-gateway@sha256:…
    python3 mundo/publicar.py --lista     # lo que hay en mundo/imagenes.json (los Triton de cada versión)

Antes de construir, gateway/ tiene que estar en un commit (la imagen se nombra con ese commit: lo que corre sale de git).
No es parte de lo que escribes.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import IMAGENES, K8S, corto, escribir_json, git, imagenes  # noqa: E402
from mundo.crear import construir, docker_env  # noqa: E402

CI = {"GIT_AUTHOR_NAME": "CI de classifier", "GIT_AUTHOR_EMAIL": "ci@c01.test",
      "GIT_COMMITTER_NAME": "CI de classifier", "GIT_COMMITTER_EMAIL": "ci@c01.test"}


def poner(nombre: str, ref: str) -> bool:
    """Cambia el digest de <nombre> en kustomization.yaml. True si cambió algo."""
    kz = K8S / "kustomization.yaml"
    txt = kz.read_text()
    repo, dig = ref.split("@")
    patron = re.compile(rf"(  - name: {re.escape(nombre)}\n    newName: )\S+(\n    digest: )\S+")
    nuevo, n = patron.subn(rf"\g<1>{repo}\g<2>{dig}", txt)
    if not n:
        sys.exit(f"✗ kustomization.yaml no tiene la entrada de {nombre} en images:")
    if nuevo == txt:
        return False
    kz.write_text(nuevo)
    return True


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("app", nargs="?", choices=["gateway"])
    ap.add_argument("--lista", action="store_true")
    a = ap.parse_args()
    img = imagenes()
    if a.lista or not a.app:
        for app in ("gateway", "triton"):
            for k, v in img[app].items():
                print(f"{app:8} {k:7} {corto(v)}")
        return
    sucio = git("status", "--porcelain", "--", "gateway", "gateway.yaml")
    if sucio:
        sys.exit(f"✗ hay cambios sin commit en el gateway:\n{sucio}\n  git add gateway && git commit -m '…' y otra vez")
    rev = git("rev-parse", "--short=7", "HEAD")
    print(f"· construyendo classifier-gateway:{rev} (≈ 20 s)…", flush=True)
    ref = construir("classifier-gateway", rev, "gateway/Dockerfile", ".", {"REVISION": rev}, docker_env())
    img["gateway"][rev] = ref
    escribir_json(IMAGENES, img)
    if not poner("classifier-gateway", ref):
        print(f"kustomization.yaml ya tiene {corto(ref)}: nada que publicar")
        return
    git("commit", "-q", "-m", f"ci: classifier-gateway → {corto(ref)} ({rev})", "--", "k8s/kustomization.yaml", extra=CI)
    print(f"✓ commit «ci: classifier-gateway → {corto(ref)}». Para que corra: kubectl apply -k k8s/")


if __name__ == "__main__":
    main()
