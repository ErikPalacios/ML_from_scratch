"""Deja el kit como recién descomprimido.

    python mundo/reiniciar.py --pipeline   # para la ronda Construir solo: el esqueleto en pipeline/ y pipeline.yaml vacío
    python mundo/reiniciar.py --todo       # además vuelve a correr mundo/crear.py (no borra lo que ya existe)

Respalda tus archivos (pipeline/datos.py, humo.py, entrenar.py, comparar.py y pipeline.yaml) en .respaldo/, pone el
esqueleto en su lugar, devuelve receta.yaml a la de fábrica y borra tus corridas de MLflow, tus checkpoints, el historial
del orquestador y el estado de romper.py. El champion y su corrida (son del equipo), los snapshots y tu historia de
git se quedan.
"""
from __future__ import annotations

import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import CKPT, HISTORIAL, RAIZ, TALLER, corridas, llaves, mlflow_arriba, mlflow_cliente, s3  # noqa: E402

ESQ = Path(__file__).resolve().parent / "esqueleto"
TUYOS = [f"pipeline/{n}.py" for n in ("datos", "humo", "entrenar", "comparar")] + ["pipeline.yaml", "receta.yaml"]

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
    print("  esqueleto en su lugar: pipeline/ con su contrato, pipeline.yaml vacío y receta.yaml de fábrica")
    if not mlflow_arriba():
        sys.exit("✗ MLflow no responde en localhost:5400: docker compose up -d --wait, y vuelve a correr esto")
    c = mlflow_cliente()
    borradas = 0
    for estado in ("FINISHED", "RUNNING", "FAILED", "KILLED"):
        for r in corridas(c, estado):
            c.delete_run(r.info.run_id)
            borradas += 1
    s = s3()
    ckpts = llaves(s, CKPT)
    for o in ckpts:
        s.delete_object(Bucket=CKPT, Key=o["Key"])
    shutil.rmtree(HISTORIAL, ignore_errors=True)
    shutil.rmtree(TALLER, ignore_errors=True)
    print(f"  {borradas} corridas tuyas en MLflow, {len(ckpts)} checkpoints, historial/ y el estado de romper.py: borrados")
    print("✓ listo. Haz git commit del esqueleto antes de empezar: git add -A && git commit -m «ronda Construir solo»")
