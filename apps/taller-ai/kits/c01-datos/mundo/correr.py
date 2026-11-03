"""El job del mes: corre tu pipeline de punta a punta, como lo haría el orquestador (en C01, Argo o Airflow).

    python mundo/correr.py          # pasos 1 → 7
    python mundo/correr.py 4        # desde el paso 4

Entre el 5 y el 6 llama al proveedor (mundo/anotar.py). Entre el 6 y el 7 hace falta adjudicar: si
config.yaml dice etiquetado.adjudicacion = experto_simulado, llama a mundo/adjudicar.py; si dice manual,
se detiene para que adjudiques en Label Studio y luego sigas con `python mundo/correr.py 7`.
Deja el registro completo en data/pipeline/corrida.log.
"""
from __future__ import annotations

import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import DATA, RAIZ, config  # noqa: E402

PASOS = [
    (1, ["pipeline/1_senales.py"]), (2, ["pipeline/2_debil.py"]), (3, ["pipeline/3_cola.py"]),
    (4, ["pipeline/4_copiar.py"]), (5, ["pipeline/5_proveedor.py", "mundo/anotar.py"]),
    (6, ["pipeline/6_acuerdo.py"]), (7, ["pipeline/7_cierre.py"]),
]


def correr(desde: int = 1, silencio: bool = False) -> tuple[bool, str]:
    """Devuelve (terminó bien, dónde se detuvo)."""
    log = DATA / "pipeline" / "corrida.log"
    log.parent.mkdir(parents=True, exist_ok=True)
    with open(log, "w") as f:
        f.write(f"# corrida del {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC, desde el paso {desde}\n")
        for n, scripts in PASOS:
            if n < desde:
                continue
            if n == 7:   # ¿hay desacuerdos nuevos sin adjudicar?
                export, tareas = DATA / "etiquetado" / "adjudicacion-export.json", DATA / "etiquetado" / "adjudicar-tareas.json"
                pendiente = not export.exists() or (tareas.exists() and export.stat().st_mtime < tareas.stat().st_mtime)
            if n == 7 and pendiente and config()["etiquetado"]["adjudicacion"] == "experto_simulado":
                scripts = ["mundo/adjudicar.py"] + scripts
            elif n == 7 and pendiente:
                msg = "paso 7: adjudica en Label Studio, exporta en JSON_MIN y corre python mundo/correr.py 7"
                f.write(msg + "\n")
                return False, msg
            for s in scripts:
                f.write(f"\n▶ {s}\n")
                f.flush()
                r = subprocess.run([sys.executable, s], cwd=RAIZ, stdout=f, stderr=subprocess.STDOUT)
                if r.returncode:
                    return False, f"paso {n} ({s}) terminó con error; el detalle está en data/pipeline/corrida.log"
                if not silencio:
                    print(f"  ✓ {s}")
    return True, "terminó sin errores"


if __name__ == "__main__":
    ok, msg = correr(int(sys.argv[1]) if len(sys.argv) > 1 else 1)
    print(("✓ " if ok else "✗ ") + msg)
    sys.exit(0 if ok else 1)
