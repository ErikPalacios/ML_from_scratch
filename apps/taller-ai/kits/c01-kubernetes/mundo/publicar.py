"""El último paso del CI de la estación 8: escribe el digest de una imagen publicada en k8s/kustomization.yaml y lo
sube como commit al repositorio de despliegue. No aplica nada: en C01 eso lo hace Argo CD; aquí, tú, con
kubectl apply -k k8s/

    python mundo/publicar.py gateway nueva     # el gateway del commit b71e05d (semana del 8 de octubre)
    python mundo/publicar.py gateway actual    # el de hoy (4f2a9c1)
    python mundo/publicar.py --lista           # lo que hay en mundo/imagenes.json

No es parte de lo que escribes.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import K8S, corto, git, imagenes  # noqa: E402

CI = {"GIT_AUTHOR_NAME": "CI de classifier", "GIT_AUTHOR_EMAIL": "ci@c01.test",
      "GIT_COMMITTER_NAME": "CI de classifier", "GIT_COMMITTER_EMAIL": "ci@c01.test"}


def poner(app: str, ref: str) -> bool:
    """Cambia el digest de classifier-<app> en kustomization.yaml. True si cambió algo."""
    kz = K8S / "kustomization.yaml"
    txt = kz.read_text()
    repo, dig = ref.split("@")
    patron = re.compile(rf"(  - name: classifier-{app}\n    newName: )\S+(\n    digest: )\S+")
    nuevo, n = patron.subn(rf"\g<1>{repo}\g<2>{dig}", txt)
    if not n:
        sys.exit(f"✗ kustomization.yaml no tiene la entrada de classifier-{app} en images:")
    if nuevo == txt:
        return False
    kz.write_text(nuevo)
    return True


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("app", nargs="?", choices=["gateway", "triton"])
    ap.add_argument("cual", nargs="?")
    ap.add_argument("--lista", action="store_true")
    a = ap.parse_args()
    img = imagenes()
    if a.lista or not a.app:
        for app in ("gateway", "triton"):
            for k, v in img[app].items():
                print(f"{app:8} {k:7} {corto(v)}")
        return
    if a.cual not in img[a.app]:
        sys.exit(f"✗ no hay «{a.cual}» para {a.app}: {', '.join(img[a.app])}")
    ref = img[a.app][a.cual]
    if not poner(a.app, ref):
        print(f"kustomization.yaml ya tiene {corto(ref)}: nada que publicar")
        return
    git("commit", "-q", "-m", f"ci: classifier-{a.app} → {corto(ref)}", "--", "k8s/kustomization.yaml", extra=CI)
    print(f"✓ commit «ci: classifier-{a.app} → {corto(ref)}». Para que corra: kubectl apply -k k8s/")


if __name__ == "__main__":
    main()
