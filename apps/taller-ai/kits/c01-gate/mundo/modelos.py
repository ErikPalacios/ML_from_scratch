"""Mirar y reparar el registro de modelos de MLflow, con permisos de administrador. En C01: la UI de MLflow o MlflowClient.

    python mundo/modelos.py versiones                 # cada versión de classifier: mes, aliases, gate y labels.json
    python mundo/modelos.py alias <alias> <versión>   # mueve un alias (por ejemplo: alias champion 3)
    python mundo/modelos.py quitar <alias>            # borra un alias
    python mundo/modelos.py candidatos                # las corridas de entrenamiento (candidatos y modelos del equipo)
    python mundo/modelos.py gates                     # tus corridas de gate: candidato, champion, veredicto y motivo
    python mundo/modelos.py labels <corrida>          # vuelve a subir el labels.json de entrada/categorias.json a esa corrida

En C01, mover champion lo hace el pipeline de CD al terminar el canary, no una persona (estación 10).
Aquí se usa solo para diagnosticar y reparar.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import CLASES, EXP_ENTRENAMIENTO, EXP_GATE, MODELO, mlflow_arriba, mlflow_cliente  # noqa: E402


def main(a: list[str]) -> None:
    if not a or a[0] in ("-h", "--help"):
        sys.exit(__doc__)
    if not mlflow_arriba():
        sys.exit("✗ MLflow no responde en localhost:5500")
    import mlflow

    c = mlflow_cliente()
    if a[0] == "versiones":
        aliases = c.get_registered_model(MODELO).aliases
        for mv in sorted(c.search_model_versions(f"name = '{MODELO}'"), key=lambda v: int(v.version)):
            with tempfile.TemporaryDirectory() as d:
                labels = json.loads((Path(mlflow.artifacts.download_artifacts(artifact_uri=mv.source, dst_path=d)) / "labels.json").read_text())
            run = c.get_run(mv.run_id)
            suyos = [k for k, v in aliases.items() if str(v) == str(mv.version)]
            print(f"v{mv.version}  {' '.join('@' + s for s in suyos) or '—':<12} mes {mv.tags.get('mes', '?')} · corrida "
                  f"{run.data.tags.get('corrida', run.info.run_name)} · gate {mv.tags.get('gate', '—')} · "
                  f"labels.json {'en orden' if labels == CLASES else 'EN OTRO ORDEN: ' + str(labels[:3])}")
    elif a[0] == "alias" and len(a) == 3:
        c.set_registered_model_alias(MODELO, a[1], a[2])
        print(f"{MODELO}@{a[1]} → v{a[2]}")
    elif a[0] == "quitar" and len(a) == 2:
        c.delete_registered_model_alias(MODELO, a[1])
        print(f"{MODELO}@{a[1]}: borrado")
    elif a[0] == "labels" and len(a) == 2:
        from mundo.comun import corrida_por_nombre

        r = corrida_por_nombre(c, a[1])
        if not r:
            sys.exit(f"✗ no hay una corrida {a[1]}")
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "labels.json").write_text(json.dumps(CLASES, ensure_ascii=False) + "\n")
            c.log_artifact(r.info.run_id, str(Path(d) / "labels.json"), "modelo")
        print(f"{a[1]}: modelo/labels.json = entrada/categorias.json")
    elif a[0] in ("candidatos", "gates"):
        exp = c.get_experiment_by_name(EXP_ENTRENAMIENTO if a[0] == "candidatos" else EXP_GATE)
        if not exp:
            sys.exit("(todavía no hay corridas)")
        for r in c.search_runs([exp.experiment_id], max_results=200, order_by=["attributes.start_time ASC"]):
            t = r.data.tags
            if a[0] == "candidatos":
                print(f"{r.info.status:<9} {t.get('corrida', r.info.run_name):<28} {t.get('snapshot', ''):<14} "
                      f"val_top1 {r.data.metrics.get('val_top1', 0):.4f}  pesos {t.get('pesos_sha256', '—')[:12]}")
            else:
                print(f"{r.info.status:<9} {datetime.fromtimestamp(r.info.start_time / 1000):%H:%M}  "
                      f"{t.get('candidato', '?'):<28} vs v{t.get('champion_version', '?')} · {t.get('veredicto', '?')} · {t.get('motivo', '')[:150]}")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
