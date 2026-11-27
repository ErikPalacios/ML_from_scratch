"""Deja el kit como recién descomprimido, para la ronda Construir solo.

    python3 mundo/reiniciar.py

Respalda tu pipeline/ en .respaldo/, pone el esqueleto en su lugar (con su contrato), devuelve medicion.json de
fábrica y borra cuantizados/ y resultados/. El f16 de modelo/ se queda.
"""
from __future__ import annotations

import shutil
from datetime import datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ESQ = RAIZ / "mundo" / "esqueleto"

if __name__ == "__main__":
    resp = RAIZ / ".respaldo" / f"tuyo-{datetime.now():%Y%m%d-%H%M%S}"
    for p in sorted((RAIZ / "pipeline").glob("*.py")):
        (resp / "pipeline").mkdir(parents=True, exist_ok=True)
        shutil.copy(p, resp / "pipeline" / p.name)
    if resp.exists():
        print(f"  tu versión anterior quedó respaldada en {resp.relative_to(RAIZ)}/")
    for f in ESQ.rglob("*"):
        if f.is_file():
            (RAIZ / f.relative_to(ESQ)).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(f, RAIZ / f.relative_to(ESQ))
    print("  esqueleto en su lugar: pipeline/ con su contrato, y medicion.json de fábrica")
    for d in ("cuantizados", "resultados", ".taller/respaldo"):
        shutil.rmtree(RAIZ / d, ignore_errors=True)
    (RAIZ / ".taller" / "romper.json").unlink(missing_ok=True)
    (RAIZ / "mundo" / "entrada" / "prompts-rapidos.json").unlink(missing_ok=True)
    print("  cuantizados/, resultados/ y el estado de romper.py: borrados (el f16 de modelo/ se queda)")
    print("✓ listo para la ronda Construir solo: python3 verificar.py te dice qué objetivo sigue")
