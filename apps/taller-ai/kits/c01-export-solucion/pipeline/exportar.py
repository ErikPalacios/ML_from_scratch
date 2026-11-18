"""Paso «exportar»: el checkpoint que aprobó el gate se vuelve un archivo ONNX, y se revisa ahí mismo con tres chequeos.

    python pipeline/exportar.py                          # el challenger de corrida.yaml
    python pipeline/exportar.py --exportador dynamo      # una prueba con el exportador nuevo (va a artefactos/v4-dynamo/)

Contrato:
- engine.yaml está en un commit y su sha256 es una de las revisiones aprobadas (mundo/revisiones.json). Si no, se detiene.
- La versión es la de corrida.yaml, por número. Tiene que decir gate=passed, su labels.json tiene que ser
  entrada/categorias.json y la huella de sus pesos tiene que ser su tag pesos_sha256. Si algo no cuadra, se detiene.
- El modelo se exporta en eval(), con el opset de engine.yaml, la entrada y la salida con los nombres del contrato del
  servidor (mundo/servidor/classifier.yaml) y el eje 0 (batch) dinámico.
- Tres chequeos, y si uno falla, código 1: (1) onnx.checker con full_check; (2) el opset ESCRITO en el archivo es el
  pedido; (3) ONNX Runtime contra PyTorch, FP32 contra FP32, con las primeras fotos_paridad fotos del golden set
  (manifest con su huella), en batch 1 y en batch_max: mismo top-1 en todas y diferencia máxima ≤ export.d_max.
- Deja artefactos/v<N>/model.onnx y export.json (versión, huellas, opset, exportador y los dos chequeos de paridad).
"""
from __future__ import annotations

import argparse
import io
import json
import logging
import sys
import warnings

import numpy as np
import onnx
import torch
from _comun import (CLASES, MODELO, RAIZ, bajar, carpeta, contrato, corrida, escribir_json, git, huella_pesos, manifest,
                    mlflow_cliente, receta, revisiones, s3, sesion, sha256, sha_archivo, tensores)

from mundo.arquitectura import construir_modelo

ap = argparse.ArgumentParser()
ap.add_argument("--exportador", choices=["clasico", "dynamo"])
a = ap.parse_args()

# 1 · La receta: revisada y en un commit
r, cfg, firma = receta(), corrida(), contrato()
receta_sha = sha256((RAIZ / "engine.yaml").read_bytes())
if git("status", "--porcelain", "--", "engine.yaml"):
    sys.exit("✗ engine.yaml tiene cambios sin commit: la receta de un artefacto que se va a servir tiene que estar en git")
if receta_sha not in {x["engine_yaml_sha256"] for x in revisiones()}:
    sys.exit(f"✗ engine.yaml ({receta_sha[:12]}…) no es ninguna versión revisada (mundo/revisiones.json): git log -p engine.yaml")
exportador = a.exportador or r["export"]["exportador"]
version = cfg["challenger"]

# 2 · La versión aprobada, por número, con sus huellas
c = mlflow_cliente()
mv = c.get_model_version(MODELO, str(version))
if mv.tags.get("gate") != "passed":
    sys.exit(f"✗ {MODELO} v{version} no tiene gate=passed: nadie aprobó ese modelo")
if json.loads(bajar(mv.run_id, "modelo/labels.json")) != CLASES:
    sys.exit(f"✗ el labels.json de v{version} no es entrada/categorias.json: la salida 0 dejaría de ser «{CLASES[0]}»")
pesos = torch.load(io.BytesIO(bajar(mv.run_id, "modelo/pesos.pt")), map_location="cpu", weights_only=True)
huella = huella_pesos(pesos)
if huella != mv.tags.get("pesos_sha256"):
    sys.exit(f"✗ los pesos de v{version} tienen huella {huella[:12]}… y la versión dice {mv.tags.get('pesos_sha256', '?')[:12]}…: "
             "no es el modelo que aprobó el gate")
print(f"  {MODELO} v{version} · gate=passed · pesos {huella[:12]}… = el tag de la versión · labels.json en orden")

# 3 · Exportar, en eval()
modelo = construir_modelo(len(CLASES))
modelo.load_state_dict(pesos)
modelo.eval()
destino = carpeta(version, None if exportador == r["export"]["exportador"] else exportador)
ruta = destino / "model.onnx"
ent, sal = firma["entrada"]["nombre"], firma["salida"]["nombre"]
for nombre in ("onnxscript", "torch.onnx._internal.exporter._registration"):   # ruido del exportador nuevo
    logging.getLogger(nombre).setLevel(logging.CRITICAL)
with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    torch.onnx.export(modelo, (torch.zeros(1, *firma["entrada"]["forma"]),), str(ruta), dynamo=exportador == "dynamo",
                      opset_version=r["export"]["opset"], input_names=[ent], output_names=[sal],
                      dynamic_axes={ent: {0: "batch"}, sal: {0: "batch"}})
m = onnx.load(str(ruta))
forma = lambda v: [d.dim_param or d.dim_value for d in v.type.tensor_type.shape.dim]   # noqa: E731
print(f"[export] opset={next(o.version for o in m.opset_import if o.domain in ('', 'ai.onnx'))} "
      f"input={m.graph.input[0].name}{forma(m.graph.input[0])} output={m.graph.output[0].name}{forma(m.graph.output[0])} · "
      f"{ruta.stat().st_size / 1e3:.0f} kB · exportador {exportador}")

# 4 · Los tres chequeos
onnx.checker.check_model(m, full_check=True)
print("  1 · onnx.checker (full_check): el grafo es válido")
opset = next(o.version for o in m.opset_import if o.domain in ("", "ai.onnx"))
if opset != r["export"]["opset"]:
    sys.exit(f"✗ 2 · se pidió opset {r['export']['opset']} y el archivo dice opset {opset}: el contrato cambió sin que nadie lo pidiera")
print(f"  2 · el archivo dice opset {opset}, el que pide engine.yaml")
s = s3()
b, fotos = manifest(s, f"golden/{r['paridad']['examen']}/manifest.json")
if sha256(b) != r["paridad"]["manifest_sha256"]:
    sys.exit("✗ el manifest del golden set no es el que congeló engine.yaml")
x = tensores(s, fotos[:r["export"]["fotos_paridad"]])
with torch.no_grad():
    ref = modelo(torch.from_numpy(x)).numpy()
ses = sesion(ruta)
chequeos = {}
for lote in (1, r["export"]["batch_max"]):
    out = np.concatenate([ses.run(None, {ent: x[i:i + lote]})[0] for i in range(0, len(x), lote)])
    iguales = int((out.argmax(1) == ref.argmax(1)).sum())
    d = float(np.abs(out - ref).max())
    chequeos[f"batch_{lote}"] = {"fotos": len(x), "top1_iguales": iguales, "d": d}
    print(f"  3 · ONNX Runtime vs PyTorch (FP32), batch {lote:>2}: top-1 igual en {iguales}/{len(x)} · diferencia máxima {d:.2e}")
    if iguales != len(x) or d > r["export"]["d_max"]:
        sys.exit(f"✗ el export no responde como el checkpoint en batch {lote} (FP32 contra FP32 solo puede diferir en los "
                 f"últimos decimales, ≤ {r['export']['d_max']}): revisa eval(), el opset y el exportador")

escribir_json(destino / "export.json", {
    "version": str(version), "pesos_sha256": huella, "onnx_sha256": sha_archivo(ruta), "opset": opset,
    "exportador": exportador, "torch": torch.__version__, "onnx": onnx.__version__, "engine_yaml_sha256": receta_sha,
    "examen": r["paridad"]["examen"], "paridad_fp32": chequeos})
print(f"✓ {destino.name}/model.onnx · sha256 {sha_archivo(ruta)[:12]}… · los tres chequeos en verde")
