"""El experto simulado: adjudica los desacuerdos en lugar de que lo hagas tú en Label Studio.

    python mundo/adjudicar.py

Se usa en las rondas de romper (config: etiquetado.adjudicacion = experto_simulado), para no repetir el trabajo
manual cada vez. Lee las mismas tareas que importarías en Label Studio y escribe el mismo archivo que exportarías
en formato JSON_MIN, con la misma forma.

Entra:  data/etiquetado/adjudicar-tareas.json        [{"data": {"image": …, "request_id": …, …}}, …]
Sale:   data/etiquetado/adjudicacion-export.json     JSON_MIN: [{"image": …, "request_id": …, "categoria": …}, …]
"""
from __future__ import annotations

import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import CLASES, DATA, OCULTO  # noqa: E402


def main() -> None:
    tareas = json.loads((DATA / "etiquetado" / "adjudicar-tareas.json").read_text())
    v = pd.read_parquet(OCULTO / "verdad.parquet").set_index("request_id").clase_real
    ahora = datetime.now(timezone.utc).isoformat()
    out = []
    for i, t in enumerate(tareas, start=1):
        d = t["data"] if "data" in t else t
        r = np.random.default_rng(int(hashlib.sha256(d["request_id"].encode()).hexdigest()[:12], 16))
        clase = int(v[d["request_id"]]) if r.random() < 0.98 else int(r.integers(len(CLASES)))
        out.append({**d, "id": i, "categoria": CLASES[clase], "annotator": 1, "annotation_id": i,
                    "created_at": ahora, "updated_at": ahora, "lead_time": round(float(r.gamma(3, 2)), 1)})
    (DATA / "etiquetado" / "adjudicacion-export.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print(f"✓ el experto adjudicó {len(out)} desacuerdos")


if __name__ == "__main__":
    main()
