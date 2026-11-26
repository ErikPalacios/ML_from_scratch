"""Deja el kit como recién descomprimido, para la ronda Construir solo.

    python mundo/reiniciar.py

Respalda tus archivos de pipeline/ (todo menos _comun.py) en .respaldo/, pone el esqueleto en su lugar (con su
contrato), devuelve config.yaml de fábrica, borra chunks/ y vuelve a crear el mundo en el día 1.
El tokenizer (modelo/) se queda: no hace falta volver a bajarlo.
"""
from __future__ import annotations

import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ESQ = RAIZ / "mundo" / "esqueleto"

if __name__ == "__main__":
    resp = RAIZ / ".respaldo" / f"pipeline-{datetime.now():%Y%m%d-%H%M%S}"
    for p in sorted((RAIZ / "pipeline").rglob("*.py")):
        if p.name != "_comun.py":
            (resp / p.relative_to(RAIZ)).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(p, resp / p.relative_to(RAIZ))
    if resp.exists():
        print(f"  tu versión anterior quedó respaldada en {resp.relative_to(RAIZ)}/")
    for f in ESQ.rglob("*"):
        if f.is_file():
            destino = RAIZ / f.relative_to(ESQ)
            destino.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(f, destino)
    print("  esqueleto en su lugar: pipeline/ con su contrato y config.yaml de fábrica")
    shutil.rmtree(RAIZ / "chunks", ignore_errors=True)
    shutil.rmtree(RAIZ / ".taller" / "respaldo", ignore_errors=True)
    (RAIZ / ".taller" / "romper.json").unlink(missing_ok=True)
    print("  chunks/ y el estado de romper.py: borrados")
    subprocess.run([sys.executable, str(RAIZ / "mundo" / "crear.py")], check=True)
    print("✓ listo para la ronda Construir solo: python verificar.py te dice qué objetivo sigue")
