"""Paso «registrar»: el candidato que pasó el gate se vuelve una versión de classifier con el alias challenger.

    python pipeline/registrar.py                          # el candidato de corrida.yaml
    python pipeline/registrar.py --candidato <corrida>

Contrato:
- Solo registra si hay una corrida de gate TERMINADA (FINISHED) para ese candidato, con veredicto «pasa», contra el
  champion de corrida.yaml, con un gate.yaml revisado y con el examen que dice gate.yaml. Si no, se detiene.
- Si champion ya no es la versión contra la que se evaluó, el veredicto es viejo: se detiene (hay que volver a evaluar).
- La versión apunta a los archivos de la corrida del candidato (runs:/<run_id>/modelo) y lleva sus tags: gate=passed,
  gate_run_id, mes, snapshot, pesos_sha256, labels_sha256 (el de entrada/categorias.json), examen, champion_version,
  y el Δmin contra el champion.
- Mueve challenger, nunca champion: champion lo mueve el despliegue cuando termina el canary (estación 10).
- Correrlo dos veces no crea dos versiones.
En C01 este paso va después de la estación 5 (paridad y latencia del engine). En el dojo no hay engine: registra aquí.
"""
from __future__ import annotations

import argparse
import json
import sys

from _comun import CLASES, EXP_GATE, MODELO, corrida, gate, mlflow_cliente, revisiones, sha256

ap = argparse.ArgumentParser()
ap.add_argument("--candidato")
a = ap.parse_args()
cfg, g = corrida(), gate()
candidato = a.candidato or cfg["candidato"]
c = mlflow_cliente()

exp = c.get_experiment_by_name(EXP_GATE)
rs = c.search_runs([exp.experiment_id], filter_string=f"tags.candidato = '{candidato}'", max_results=1,
                   order_by=["attributes.start_time DESC"]) if exp else []
if not rs:
    sys.exit(f"✗ {candidato} no tiene ninguna corrida de gate: corre evaluar.py y gate.py")
gr = rs[0]
t = gr.data.tags
if gr.info.status != "FINISHED" or t.get("veredicto") != "pasa":
    sys.exit(f"✗ el último gate de {candidato} no pasó ({gr.info.status} · {t.get('motivo', '?')}): no se registra")
if t.get("gate_yaml_sha256") not in {r["gate_yaml_sha256"] for r in revisiones()}:
    sys.exit("✗ ese gate se tomó con un gate.yaml que nadie revisó: no cuenta")
if t.get("examen") != g["examen"]["id"] or t.get("manifest_sha256") != g["examen"]["manifest_sha256"]:
    sys.exit("✗ ese gate usó otro examen que el de gate.yaml")
champion = c.get_model_version_by_alias(MODELO, "champion").version
if t.get("champion_version") != str(cfg["champion"]) or str(champion) != str(cfg["champion"]):
    sys.exit(f"✗ el gate comparó contra v{t.get('champion_version')}, y hoy champion es v{champion}: el veredicto es viejo. "
             "Vuelve a evaluar contra el champion de hoy")

run_id = t["candidato_run_id"]
cand = c.get_run(run_id)
ya = [mv for mv in c.search_model_versions(f"name = '{MODELO}'") if mv.run_id == run_id]
if ya:
    mv = ya[0]
    print(f"  {candidato} ya era {MODELO} v{mv.version}")
else:
    mv = c.create_model_version(MODELO, source=f"runs:/{run_id}/modelo", run_id=run_id, tags={
        "gate": "passed", "gate_run_id": gr.info.run_id, "mes": "2026-10", "snapshot": cand.data.tags["snapshot"],
        "pesos_sha256": cand.data.tags["pesos_sha256"], "labels_sha256": sha256((json.dumps(CLASES, ensure_ascii=False) + "\n").encode()),   # = el labels.json de la corrida
        "examen": t["examen"], "champion_version": t["champion_version"],
        "delta_min_champion_top1": str(gr.data.metrics["delta_min_champion_top1"])})
c.set_registered_model_alias(MODELO, "challenger", mv.version)
print(f"✓ {MODELO} v{mv.version} @challenger · gate {gr.info.run_id[:8]} · champion sigue en v{champion}")
