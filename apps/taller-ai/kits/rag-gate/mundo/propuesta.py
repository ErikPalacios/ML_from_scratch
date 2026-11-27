"""Los cambios que propone el equipo: cada uno toca una línea de config.yaml, y el gate decide si sale.

    python mundo/propuesta.py                  # cuáles hay y cuál está puesta
    python mundo/propuesta.py umbral-bajo      # la pone (respalda config.yaml en .taller/)
    python mundo/propuesta.py quitar           # deja config.yaml como estaba

La API lee config.yaml en cada pregunta: no hay que volver a arrancarla. Es lo que en C11 sería un pull request que
cambia la configuración del rag-api: el gate corre el golden set con el cambio y decide.
"""
from __future__ import annotations

import json
import re
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import CONFIG, TALLER  # noqa: E402

PUESTA = TALLER / "propuesta.json"
RESPALDO = TALLER / "propuesta-config.yaml"
PROPUESTAS = {
    "umbral-bajo": {"quien": "Diego Luna", "cambios": {"umbral": "-4.0"},
                    "historia": "Dos agentes se quejaron de que el asistente dice «no sé» a preguntas que sí están en los documentos (los cupones y la tarifa a Sonora). "
                                "Diego propone bajar respuesta.umbral de −1.0 a −4.0 para que conteste más."},
    "k-2": {"quien": "Sofía Leal", "cambios": {"k": "2"},
            "historia": "Para bajar el primer token, Sofía propone mandar al prompt solo los 2 mejores chunks del reranker en vez de 8 (retrieval.k de 8 a 2): "
                        "«el bueno casi siempre viene primero»."},
}


def editar(clave: str, valor: str) -> None:
    s = CONFIG.read_text()
    s2 = re.sub(rf"(?m)^(\s*{clave}:\s*)(\S+)", lambda m: m.group(1) + valor, s, count=1)
    if s2 == s:
        raise SystemExit(f"no encontré {clave} en config.yaml")
    CONFIG.write_text(s2)


if __name__ == "__main__":
    que = sys.argv[1] if len(sys.argv) > 1 else None
    puesta = json.loads(PUESTA.read_text())["nombre"] if PUESTA.exists() else None
    if que is None:
        for n, p in PROPUESTAS.items():
            print(f"{'▶' if n == puesta else ' '} {n:<12} {p['quien']}: {p['historia']}")
        sys.exit(0)
    if que == "quitar":
        if not puesta:
            sys.exit("No hay ninguna propuesta puesta.")
        shutil.copy(RESPALDO, CONFIG)
        PUESTA.unlink()
        print(f"✓ quitada «{puesta}»: config.yaml como estaba")
        sys.exit(0)
    if que not in PROPUESTAS:
        sys.exit(f"✗ no existe «{que}». Hay: {', '.join(PROPUESTAS)}")
    if puesta:
        sys.exit(f"✗ ya está puesta «{puesta}»: python mundo/propuesta.py quitar")
    TALLER.mkdir(exist_ok=True)
    shutil.copy(CONFIG, RESPALDO)
    for k, v in PROPUESTAS[que]["cambios"].items():
        editar(k, v)
    PUESTA.write_text(json.dumps({"nombre": que}))
    print(f"▶ propuesta «{que}» ({PROPUESTAS[que]['quien']}): {', '.join(f'{k}: {v}' for k, v in PROPUESTAS[que]['cambios'].items())} en config.yaml")
    print(f"  {PROPUESTAS[que]['historia']}")
