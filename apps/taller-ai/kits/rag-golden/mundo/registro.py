"""El registro del golden set: el bucket donde cada versión se publica una sola vez (en C11, S3 con Object Lock).

    python mundo/registro.py listar             # qué versiones tiene, con su sha256
    python mundo/registro.py bajar golden-v2    # vuelve a poner golden/golden-v2/ como está en el registro

bajar no publica nada: copia del registro a tu carpeta golden/. Es lo que se hace cuando alguien pisó una versión en
su disco: la copia buena es la del registro.
"""
from __future__ import annotations

import argparse
import hashlib
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import ALMACEN, GOLDEN, leer_json  # noqa: E402

REG = ALMACEN / "registro" / "golden"

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("accion", choices=["listar", "bajar"])
    ap.add_argument("version", nargs="?")
    a = ap.parse_args()
    if a.accion == "listar":
        vs = sorted(REG.glob("golden-v*"), key=lambda p: int(p.name.split("v")[-1])) if REG.exists() else []
        for p in vs:
            m = leer_json(p / "manifiesto.json")
            print(f"{p.name}  sha256 {hashlib.sha256((p / 'preguntas.jsonl').read_bytes()).hexdigest()[:12]}  {m['n']} preguntas  {m['creado']}")
        print(f"{len(vs)} versión(es) en el registro")
        sys.exit(0)
    if not a.version or not (REG / a.version).exists():
        sys.exit(f"✗ el registro no tiene {a.version}")
    destino = GOLDEN / a.version
    shutil.rmtree(destino, ignore_errors=True)
    shutil.copytree(REG / a.version, destino)
    for f in destino.iterdir():
        f.chmod(0o644)
    print(f"✓ golden/{a.version}/ otra vez como en el registro (sha256 {hashlib.sha256((destino / 'preguntas.jsonl').read_bytes()).hexdigest()[:12]})")
