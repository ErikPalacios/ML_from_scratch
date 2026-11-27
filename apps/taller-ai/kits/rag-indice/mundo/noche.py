"""Lo que corre la empresa cada noche, después de la re-ingesta: construye un índice nuevo al lado del vigente con tu
pipeline (construir.py lo revisa al final), corre la búsqueda de prueba con el golden set (prueba.py) y mueve el alias
(alias.py, que lo vuelve a revisar). Si algo falla, el alias se queda donde estaba.

    python mundo/noche.py
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent

if __name__ == "__main__":
    py = sys.executable
    r = subprocess.run([py, "pipeline/construir.py"], cwd=RAIZ, capture_output=True, text=True)
    print(r.stdout.strip() or r.stderr.strip().splitlines()[-1])
    if r.returncode != 0:
        sys.exit("✗ la construcción de esta noche falló: el alias se queda donde estaba")
    nombre = r.stdout.split("indices/", 1)[1].split("/", 1)[0]
    r = subprocess.run([py, "pipeline/prueba.py", "--indice", nombre], cwd=RAIZ, capture_output=True, text=True)
    print("\n".join(l for l in r.stdout.splitlines() if "recall@8" in l) or r.stderr.strip())
    if r.returncode != 0:
        sys.exit("✗ la búsqueda de prueba falló: el alias se queda donde estaba")
    r = subprocess.run([py, "pipeline/alias.py", "cambiar", "c11", nombre], cwd=RAIZ, capture_output=True, text=True)
    print((r.stdout + r.stderr).strip())
    sys.exit(r.returncode)
