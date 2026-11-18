"""Deja el kit como recién descomprimido.

    python mundo/reiniciar.py --serving    # para la ronda Construir solo: el esqueleto en su lugar
    python mundo/reiniciar.py --todo       # además vuelve a correr mundo/crear.py (no borra lo que ya existe)

Para Triton y el gateway, respalda tus archivos (servir/armar.py, model_repository/classifier/config.pbtxt,
gateway/app/main.py, gateway/app/revision.py y gateway/tests/) en .respaldo/, pone el esqueleto en su lugar y borra
lo que tus archivos dejaron: el engine del model repository, servir/modelo.json, logs/ y el estado de romper.py.
El registro, el examen, fotos-raras/ y tu historia de git se quedan.
"""
from __future__ import annotations

import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import LOGS, MODELO_JSON, RAIZ, REPO, TALLER  # noqa: E402

ESQ = Path(__file__).resolve().parent / "esqueleto"
TUYOS = ["servir/armar.py", "model_repository/classifier/config.pbtxt", "gateway/app/main.py", "gateway/app/revision.py",
         "gateway/tests/conftest.py", "gateway/tests/test_gateway.py"]

if __name__ == "__main__":
    if not {"--serving", "--todo"} & set(sys.argv):
        sys.exit(__doc__)
    if "--todo" in sys.argv:
        subprocess.run([sys.executable, str(RAIZ / "mundo" / "crear.py")], check=True)
    subprocess.run([sys.executable, str(RAIZ / "mundo" / "servicios.py"), "parar"], check=False)
    resp = RAIZ / ".respaldo" / f"archivos-{datetime.now():%Y%m%d-%H%M%S}"
    for rel in TUYOS + [str(p.relative_to(RAIZ)) for p in (RAIZ / "gateway" / "tests").glob("*.py") if str(p.relative_to(RAIZ)) not in TUYOS]:
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
    print("  esqueleto en su lugar: servir/armar.py, config.pbtxt, gateway/app/main.py, revision.py y gateway/tests/ con su contrato")
    for d in REPO.glob("*/[0-9]*"):
        shutil.rmtree(d, ignore_errors=True)
    MODELO_JSON.unlink(missing_ok=True)
    shutil.rmtree(LOGS, ignore_errors=True)
    shutil.rmtree(TALLER, ignore_errors=True)
    print("  el engine del model repository, servir/modelo.json, logs/ y el estado de romper.py: borrados")
    print("✓ listo. Haz git commit del esqueleto antes de empezar: git add -A && git commit -m «ronda Construir solo»")
