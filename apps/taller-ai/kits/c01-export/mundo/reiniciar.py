"""Deja el kit como recién descomprimido.

    python mundo/reiniciar.py --pipeline   # para la ronda Construir solo: el esqueleto en pipeline/
    python mundo/reiniciar.py --todo       # además vuelve a correr mundo/crear.py (no borra lo que ya existe)

Respalda tus archivos (pipeline/exportar.py, construir.py, paridad.py, latencia.py y registrar.py) en .respaldo/, pone
el esqueleto en su lugar, borra artefactos/ y el estado de romper.py, y deja a v4 otra vez con engine=pendiente (le
quita los tags del engine; los archivos de engine/ que subiste se reemplazan la próxima vez que registres).
El registro (v1–v4 y sus alias), el engine del champion, el examen y tu historia de git se quedan.
"""
from __future__ import annotations

import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import ARTEFACTOS, MODELO, RAIZ, TALLER, mlflow_arriba, mlflow_cliente  # noqa: E402

ESQ = Path(__file__).resolve().parent / "esqueleto"
TUYOS = [f"pipeline/{n}.py" for n in ("exportar", "construir", "paridad", "latencia", "registrar")]
TAGS_ENGINE = ["engine_sha256", "onnx_sha256", "engine_yaml_sha256", "onnxruntime", "maquina", "precision", "opset",
               "paridad_a1", "paridad_o5", "paridad_d", "latencia_p99_600", "latencia_p99_1200"]

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
    print("  esqueleto en su lugar: pipeline/exportar.py, construir.py, paridad.py, latencia.py y registrar.py con su contrato")
    if not mlflow_arriba():
        sys.exit("✗ MLflow no responde en localhost:5600: docker compose up -d --wait, y vuelve a correr esto")
    c = mlflow_cliente()
    tags = c.get_model_version(MODELO, "4").tags
    quitados = [k for k in TAGS_ENGINE if k in tags]
    for k in quitados:
        c.delete_model_version_tag(MODELO, "4", k)
    c.set_model_version_tag(MODELO, "4", "engine", "pendiente")
    c.set_registered_model_alias(MODELO, "champion", "3")
    c.set_registered_model_alias(MODELO, "challenger", "4")
    shutil.rmtree(ARTEFACTOS, ignore_errors=True)
    shutil.rmtree(TALLER, ignore_errors=True)
    print(f"  v4: {len(quitados)} tags del engine quitados, engine=pendiente · artefactos/ y el estado de romper.py: borrados")
    print("✓ listo. Haz git commit del esqueleto antes de empezar: git add -A && git commit -m «ronda Construir solo»")
