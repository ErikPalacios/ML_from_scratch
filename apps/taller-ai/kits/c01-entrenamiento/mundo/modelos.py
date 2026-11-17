"""Mirar y reparar el registro de modelos de MLflow, con permisos de administrador. En C01: la UI de MLflow o MlflowClient.

    python mundo/modelos.py versiones                 # cada versión de classifier: su corrida, su labels.json y sus aliases
    python mundo/modelos.py alias <alias> <versión>   # mueve un alias (por ejemplo: alias champion 1)
    python mundo/modelos.py corridas                  # las corridas del experimento: estado, snapshot, semilla, val_top1

En C01, mover champion lo hace el pipeline de CD al terminar el canary, no una persona (estación 4 y 10).
Aquí se usa solo para diagnosticar y reparar.
"""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import CLASES, EXPERIMENTO, MODELO, mlflow_arriba, mlflow_cliente  # noqa: E402


def main(a: list[str]) -> None:
    if not a or a[0] in ("-h", "--help"):
        sys.exit(__doc__)
    if not mlflow_arriba():
        sys.exit("✗ MLflow no responde en localhost:5400")
    import mlflow

    c = mlflow_cliente()
    if a[0] == "versiones":
        aliases = c.get_registered_model(MODELO).aliases
        for mv in sorted(c.search_model_versions(f"name = '{MODELO}'"), key=lambda v: int(v.version)):
            with tempfile.TemporaryDirectory() as d:
                labels = json.loads((Path(mlflow.artifacts.download_artifacts(artifact_uri=mv.source, dst_path=d)) / "labels.json").read_text())
            run = c.get_run(mv.run_id)
            suyos = [k for k, v in aliases.items() if str(v) == str(mv.version)]
            print(f"v{mv.version}  {' '.join('@' + s for s in suyos) or '—':<12} corrida {run.data.tags.get('corrida', run.info.run_name)} · "
                  f"{run.data.tags.get('snapshot', '?')} · val_top1 {run.data.metrics.get('val_top1', 0):.4f}\n"
                  f"     labels.json: {labels} {'(= entrada/categorias.json)' if labels == CLASES else '(≠ entrada/categorias.json)'}")
    elif a[0] == "alias" and len(a) == 3:
        c.set_registered_model_alias(MODELO, a[1], a[2])
        print(f"{MODELO}@{a[1]} → v{a[2]}")
    elif a[0] == "corridas":
        exp = c.get_experiment_by_name(EXPERIMENTO)
        for r in c.search_runs([exp.experiment_id], max_results=200, order_by=["attributes.start_time ASC"]):
            t = r.data.tags
            print(f"{r.info.status:<9} {t.get('corrida', r.info.run_name):<22} {t.get('snapshot', ''):<14} semilla {r.data.params.get('semilla', '?'):<3} "
                  f"val_top1 {r.data.metrics.get('val_top1', 0):.4f}  reanudada desde {t.get('reanudado_desde_paso', '—')}  pesos {t.get('pesos_sha256', '—')[:12]}")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
