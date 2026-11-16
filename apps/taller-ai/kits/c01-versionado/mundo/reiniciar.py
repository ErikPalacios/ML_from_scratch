"""Deja el kit como recién descomprimido.

    python mundo/reiniciar.py --pipeline   # para la ronda Solo: esqueleto vacío en pipeline/, dvc.yaml y params.yaml
    python mundo/reiniciar.py --todo       # además vuelve a crear el mundo (mundo/crear.py)

Respalda tus archivos (pipeline/1…7, dvc.yaml, dvc.lock, params.yaml) en .respaldo/, pone el esqueleto en su lugar,
borra data/, tus corridas y los snapshots que publicaste (deja el de agosto, que es del equipo). Tu historia de
git y la carpeta .dvc/ se quedan.
"""
from __future__ import annotations

import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import CORRIDAS, DATA, DATOS, PADRE, RAIZ, TALLER, borrar_todo, s3, snapshots  # noqa: E402

ESQ = Path(__file__).resolve().parent / "esqueleto"
TUYOS = [f"pipeline/{n}.py" for n in ("1_labels", "2_manifest", "3_split", "4_validar", "5_publicar", "6_entrenar", "7_linaje")]
TUYOS += ["dvc.yaml", "dvc.lock", "params.yaml"]

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
    print("  esqueleto en su lugar: pipeline/1…7 con su contrato, dvc.yaml vacío y params.yaml de fábrica")
    shutil.rmtree(DATA, ignore_errors=True)
    s = s3()
    for sid in snapshots(s):
        if sid != PADRE:
            borrar_todo(s, DATOS, f"datasets/{sid}/")
            print(f"  s3://{DATOS}/datasets/{sid}/: borrado (todas sus versiones)")
    for c in CORRIDAS.glob("*.json"):
        if not c.name.startswith("run-20260901-"):
            c.unlink()
    shutil.rmtree(TALLER, ignore_errors=True)
    print("  data/, tus corridas y el estado de romper.py: borrados")
    print("✓ listo. Haz git commit del esqueleto antes de empezar: git add -A && git commit -m «ronda Solo»")
