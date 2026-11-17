"""Deja el kit como recién descomprimido.

    python mundo/reiniciar.py --pipeline   # para la ronda Construir solo: el esqueleto en pipeline/
    python mundo/reiniciar.py --todo       # además vuelve a correr mundo/crear.py (no borra lo que ya existe)

Respalda tus archivos (pipeline/evaluar.py, gate.py y registrar.py) en .respaldo/, pone el esqueleto en su lugar, y
borra tus corridas de gate en MLflow, las versiones que registraste (y el alias challenger), reportes/ y el estado de
romper.py. El historial del registro (v1–v3), los candidatos, los snapshots, el examen y tu historia de git se quedan.
"""
from __future__ import annotations

import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import MODELO, RAIZ, REPORTES, TALLER, corridas, mlflow_arriba, mlflow_cliente  # noqa: E402

ESQ = Path(__file__).resolve().parent / "esqueleto"
TUYOS = [f"pipeline/{n}.py" for n in ("evaluar", "gate", "registrar")]

if __name__ == "__main__":
    if not {"--pipeline", "--todo"} & set(sys.argv):
        sys.exit(__doc__)
    if "--todo" in sys.argv:
        subprocess.run([sys.executable, str(RAIZ / "mundo" / "crear.py")], check=True)
    resp = RAIZ / ".respaldo" / f"archivos-{datetime.now():%Y%m%d-%H%M%S}"
    for rel in TUYOS:
        p = RAIZ / rel
        if p.exists():
            (resp / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(p, resp / rel)
            p.unlink()
    if resp.exists():
        print(f"  tu versión anterior quedó respaldada en {resp.relative_to(RAIZ)}/")
    for f in ESQ.rglob("*"):
        if f.is_file():
            destino = RAIZ / f.relative_to(ESQ)
            destino.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(f, destino)
    print("  esqueleto en su lugar: pipeline/evaluar.py, gate.py y registrar.py con su contrato")
    if not mlflow_arriba():
        sys.exit("✗ MLflow no responde en localhost:5500: docker compose up -d --wait, y vuelve a correr esto")
    c = mlflow_cliente()
    borradas = 0
    for estado in ("FINISHED", "RUNNING", "FAILED", "KILLED"):
        for r in corridas(c, estado, tuyas=False):
            c.delete_run(r.info.run_id)
            borradas += 1
    versiones = [mv for mv in c.search_model_versions(f"name = '{MODELO}'") if int(mv.version) > 3]
    if "challenger" in c.get_registered_model(MODELO).aliases:
        c.delete_registered_model_alias(MODELO, "challenger")
    for mv in versiones:
        c.delete_model_version(MODELO, mv.version)
    c.set_registered_model_alias(MODELO, "champion", "3")
    shutil.rmtree(REPORTES, ignore_errors=True)
    shutil.rmtree(TALLER, ignore_errors=True)
    print(f"  {borradas} corridas de gate, {len(versiones)} versiones registradas por ti, @challenger, reportes/ y el estado de romper.py: borrados")
    print("✓ listo. Haz git commit del esqueleto antes de empezar: git add -A && git commit -m «ronda Construir solo»")
