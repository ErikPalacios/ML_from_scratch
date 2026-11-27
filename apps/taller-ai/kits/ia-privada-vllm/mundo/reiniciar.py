"""Deja el kit como recién descomprimido, para la ronda Construir solo.

    python3 mundo/reiniciar.py

Para el servidor, respalda tus archivos (servidor.env, servir.sh, carga.env, gpu.env, pipeline/ y resultados/) en
.respaldo/ y pone el esqueleto en su lugar, con su contrato.
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
    subprocess.run([sys.executable, str(RAIZ / "mundo" / "servidor.py"), "parar"], check=False)
    resp = RAIZ / ".respaldo" / f"tuyo-{datetime.now():%Y%m%d-%H%M%S}"
    for f in ESQ.rglob("*"):
        if f.is_file():
            rel = f.relative_to(ESQ)
            if (RAIZ / rel).exists():
                (resp / rel).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy(RAIZ / rel, resp / rel)
            (RAIZ / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(f, RAIZ / rel)
    if (RAIZ / "resultados").exists():
        shutil.copytree(RAIZ / "resultados", resp / "resultados", dirs_exist_ok=True)
        shutil.rmtree(RAIZ / "resultados")
    if resp.exists():
        print(f"  tu versión anterior quedó respaldada en {resp.relative_to(RAIZ)}/")
    print("  esqueleto en su lugar: servidor.env, carga.env y gpu.env vacíos; servir.sh y pipeline/ con su contrato; resultados/ vacío")
    shutil.rmtree(RAIZ / ".taller" / "respaldo", ignore_errors=True)
    (RAIZ / ".taller" / "romper.json").unlink(missing_ok=True)
    print("  el estado de romper.py: borrado")
    print("✓ listo para la ronda Construir solo: python3 verificar.py te dice qué objetivo sigue")
