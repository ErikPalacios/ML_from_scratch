"""Paso «evaluar» del gate: el candidato, el champion y el de hace 3 meses, sobre el mismo examen, foto por foto.

    python pipeline/evaluar.py                          # los parámetros de corrida.yaml
    python pipeline/evaluar.py --candidato <corrida>    # otro candidato, con el mismo champion y el mismo examen

Contrato:
- Los modelos entran por NÚMERO de versión (corrida.yaml), nunca por alias: el alias puede moverse a media corrida.
- El examen es golden-v1: su manifest tiene que tener la huella que dice gate.yaml, y cada foto la suya. Si algo no
  coincide, se detiene: un examen que cambió no compara nada.
- Ninguna foto del examen puede estar en el snapshot con que se entrenó el candidato (fuga = examen contaminado).
- Cada modelo: sus pesos tienen la huella que anotó su corrida, y su labels.json es entrada/categorias.json.
- Las fotos pasan por el preprocess del gateway (mundo/gateway/preprocess.py), el mismo de producción.
- Deja reportes/<candidato>/pares.parquet (una fila por foto: label, slice y, por modelo, su top-5 y su confianza)
  y reportes/<candidato>/evaluacion.json (qué se evaluó, con sus huellas).
"""
from __future__ import annotations

import argparse
import io
import json
import sys
import tempfile
from pathlib import Path

import numpy as np
import torch

from _comun import (CLASES, DATOS, EXP_ENTRENAMIENTO, FOTOS, MODELO, REPORTES, corrida, gate, huella_pesos,  # noqa: F401
                    mlflow_cliente, s3, sha256)
from mundo.arquitectura import construir_modelo
from mundo.gateway.preprocess import preprocess

ap = argparse.ArgumentParser()
ap.add_argument("--candidato")
a = ap.parse_args()
cfg, g = corrida(), gate()
candidato = a.candidato or cfg["candidato"]
s = s3()

# 1 · El examen, con sus huellas
examen = g["examen"]
if cfg["examen"] != examen["id"]:
    sys.exit(f"✗ corrida.yaml pide el examen {cfg['examen']} y gate.yaml dice {examen['id']}")
man_b = s.get_object(Bucket=DATOS, Key=f"golden/{examen['id']}/manifest.json")["Body"].read()
if sha256(man_b) != examen["manifest_sha256"]:
    sys.exit(f"✗ el manifest de {examen['id']} cambió: su sha256 es {sha256(man_b)[:12]}… y gate.yaml congeló "
             f"{examen['manifest_sha256'][:12]}…. Un examen que cambió no compara nada: no evalúo")
fotos = json.loads(man_b)["fotos"]
x = []
for f in fotos:
    b = s.get_object(Bucket=DATOS, Key=f["image_key"])["Body"].read()
    if sha256(b) != f["image_sha256"]:
        sys.exit(f"✗ la foto {f['id']} del examen no es la que se congeló (su sha256 no coincide): no evalúo")
    x.append(preprocess(b))
x = torch.from_numpy(np.stack(x))
y = np.array([f["label_id"] for f in fotos])
print(f"[examen] {examen['id']}: {len(fotos)} fotos · manifest {sha256(man_b)[:12]}… = gate.yaml · cada foto con su huella")

# 2 · Los tres modelos, por número, con sus huellas
import mlflow  # noqa: E402

c = mlflow_cliente()
exp = c.get_experiment_by_name(EXP_ENTRENAMIENTO)
rs = c.search_runs([exp.experiment_id], filter_string=f"tags.corrida = '{candidato}' and attributes.status = 'FINISHED'", max_results=1)
if not rs:
    sys.exit(f"✗ no hay una corrida terminada que se llame {candidato} en {EXP_ENTRENAMIENTO}")
run_cand = rs[0]


def cargar(run_id: str, quien: str, huella: str | None):
    with tempfile.TemporaryDirectory() as d:
        carpeta = Path(mlflow.artifacts.download_artifacts(run_id=run_id, artifact_path="modelo", dst_path=d))
        pesos = torch.load(carpeta / "pesos.pt", map_location="cpu", weights_only=True)
        labels = json.loads((carpeta / "labels.json").read_text())
    if labels != CLASES:
        sys.exit(f"✗ el labels.json de {quien} no es entrada/categorias.json ({labels[:3]}…): la salida 0 no sería «{CLASES[0]}»")
    if huella_pesos(pesos) != huella:
        sys.exit(f"✗ los pesos de {quien} no tienen la huella que anotó su corrida: no sé qué estoy evaluando")
    m = construir_modelo(len(CLASES))
    m.load_state_dict(pesos)
    return m.eval(), huella


modelos = {"candidato": cargar(run_cand.info.run_id, candidato, run_cand.data.tags.get("pesos_sha256"))}
versiones = {"candidato": None}
for quien in ("champion", "hace_3_meses"):
    v = str(cfg[quien])
    if not v.isdigit():
        sys.exit(f"✗ corrida.yaml: {quien} = {v}. Entra como número de versión, no como alias")
    mv = c.get_model_version(MODELO, v)
    modelos[quien] = cargar(mv.run_id, f"{MODELO} v{v}", mv.tags.get("pesos_sha256"))
    versiones[quien] = v
print(f"[modelos] {candidato} · champion = v{versiones['champion']} · hace 3 meses = v{versiones['hace_3_meses']} · "
      "pesos con su huella y labels.json en orden")

# 3 · Fuga: ¿alguna foto del examen está en el snapshot del candidato?
sid = run_cand.data.tags["snapshot"]
import pandas as pd  # noqa: E402

filas = pd.read_parquet(io.BytesIO(s.get_object(Bucket=DATOS, Key=f"datasets/{sid}/rows.parquet")["Body"].read()))
vistas = set(filas["image_sha256"])
fuga = sum(f["origen_sha256"] in vistas or f["image_sha256"] in vistas for f in fotos)
if fuga:
    sys.exit(f"✗ {fuga} fotos del examen están en {sid}, el snapshot con que se entrenó {candidato}: el examen está "
             "contaminado y el candidato saldría mejor de lo que es. No evalúo")
print(f"[fuga] 0 de {len(fotos)} fotos del examen están en {sid} ({len(filas):,} filas)")

# 4 · Las predicciones, foto por foto
pares = pd.DataFrame({"id": [f["id"] for f in fotos], "label_id": y, "slice": [f["slice"] for f in fotos]})
with torch.no_grad():
    for quien, (m, _) in modelos.items():
        p = torch.softmax(m(x), 1).numpy()
        top5 = np.argsort(-p, 1, kind="stable")[:, :5]
        pares[f"{quien}_top5"] = top5.tolist()
        pares[f"{quien}_conf"] = p.max(1)
        print(f"  {quien:<13} top-1 {np.mean(top5[:, 0] == y):.2%} · top-5 {np.mean((top5 == y[:, None]).any(1)):.2%}")

out = REPORTES / candidato
out.mkdir(parents=True, exist_ok=True)
pares.to_parquet(out / "pares.parquet", index=False)
(out / "evaluacion.json").write_text(json.dumps({
    "candidato": candidato, "candidato_run_id": run_cand.info.run_id, "snapshot": sid,
    "champion_version": versiones["champion"], "hace_3_meses_version": versiones["hace_3_meses"],
    "pesos_sha256": {k: v[1] for k, v in modelos.items()},
    "examen": examen["id"], "manifest_sha256": sha256(man_b), "fuga": fuga,
    "pares_sha256": sha256((out / "pares.parquet").read_bytes())}, ensure_ascii=False, indent=2) + "\n")
print(f"✓ {len(pares)} pares en reportes/{candidato}/pares.parquet")
