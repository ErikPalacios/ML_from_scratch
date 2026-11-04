"""Deja el kit como nuevo.

    python mundo/reiniciar.py --pipeline   # para la ronda Solo: esqueleto vacío en pipeline/, config.yaml y guía
                                           # originales, sin salidas del pipeline ni bucket restringido.
                                           # El mundo (datos y fotos) se queda igual.
    python mundo/reiniciar.py --todo       # lo anterior + vuelve a generar el mundo (≈ 2 min)

La primera vez (paso 0) se usa --todo: crea pipeline/, config.yaml y el mundo.
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import DATA, RAIZ, TALLER  # noqa: E402

ESQ = Path(__file__).resolve().parent / "esqueleto"


def pipeline() -> None:
    previo = [f for f in (RAIZ / "pipeline").glob("*.py") if f.name != "_comun.py"]
    if previo:
        from datetime import datetime

        resp = RAIZ / ".respaldo" / f"pipeline-{datetime.now():%Y%m%d-%H%M%S}"
        resp.mkdir(parents=True)
        for f in previo + list((RAIZ / "guia").glob("guia-*.md")) + [RAIZ / "config.yaml"]:
            shutil.copy(f, resp / f.name)
        print(f"  tu versión anterior quedó respaldada en {resp.relative_to(RAIZ)}/")
    for f in (ESQ / "pipeline").glob("*.py"):
        shutil.copy(f, RAIZ / "pipeline" / f.name)
    print("  pipeline/: esqueleto de los 7 pasos")
    shutil.copy(ESQ / "config.yaml", RAIZ / "config.yaml")
    print("  config.yaml: valores originales")
    for g in (RAIZ / "guia").glob("guia-*.md"):
        if g.name != "guia-v1.md":
            g.unlink()
            print(f"  guia/{g.name}: borrada")
    for d in ["pipeline", "etiquetado"]:
        shutil.rmtree(DATA / d, ignore_errors=True)
    print("  data/pipeline y data/etiquetado: borrados")
    shutil.rmtree(TALLER, ignore_errors=True)
    from mundo.comun import config, s3

    cli, B = s3(), config()["s3"]["bucket_restringido"]
    try:
        for p in cli.get_paginator("list_objects_v2").paginate(Bucket=B):
            objs = [{"Key": o["Key"]} for o in p.get("Contents", [])]
            if objs:
                cli.delete_objects(Bucket=B, Delete={"Objects": objs})
        cli.delete_bucket(Bucket=B)
        print(f"  s3://{B}: borrado")
    except Exception:
        pass


if __name__ == "__main__":
    sys.stdout.reconfigure(line_buffering=True)   # que los mensajes salgan en orden con los del simulador
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--pipeline", action="store_true")
    g.add_argument("--todo", action="store_true")
    a = ap.parse_args()
    (RAIZ / "pipeline").mkdir(exist_ok=True)
    if not (RAIZ / "config.yaml").exists():
        shutil.copy(ESQ / "config.yaml", RAIZ / "config.yaml")
    pipeline()
    if a.todo:
        import subprocess

        subprocess.run([sys.executable, str(RAIZ / "mundo" / "simular.py")], check=True)
    print("✓ listo")
