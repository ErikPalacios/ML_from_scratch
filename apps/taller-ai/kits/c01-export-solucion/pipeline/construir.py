"""Paso «construir»: del model.onnx que pasó sus tres chequeos al engine que va a correr el servidor, atado a esta
máquina y a este runtime, con sus huellas.

    python pipeline/construir.py                     # la precisión de engine.yaml (fp16)
    python pipeline/construir.py --precision int8    # una prueba: int8 calibrado (va a artefactos/v4-int8/)

Contrato:
- engine.yaml revisado y en un commit (como en exportar.py).
- Parte de artefactos/v<N>/model.onnx, y solo si su sha256 es el de export.json: el ONNX que pasó los tres chequeos.
- La guardia del build: el onnxruntime con que construyes tiene que ser el que corre el servidor
  (mundo/servidor/requirements.txt). Si no, se detiene: un engine se construye con el runtime que lo va a servir.
- fp16: los pesos a FP16, con la entrada y la salida en FP32 (como pide el contrato del servidor).
  int8: cuantización estática, calibrada con el set de engine.yaml (fotos de train, con su manifest); nunca con el examen.
- Optimiza el grafo con ONNX Runtime (nivel de engine.yaml) y guarda el resultado: ese archivo es el engine.
- Deja engine.onnx y engine.json: versión, huellas (pesos, onnx, engine, receta), precisión, opset, batch_max,
  onnxruntime, máquina y CPU.
"""
from __future__ import annotations

import argparse
import os
import platform
import sys
import tempfile
import time
from collections import Counter
from pathlib import Path

import onnx
import onnxruntime as ort
from _comun import (DATOS, RAIZ, carpeta, corrida, escribir_json, git, leer_json, manifest, receta, revisiones,
                    runtime_servidor, s3, sha256, sha_archivo, tensores)

ap = argparse.ArgumentParser()
ap.add_argument("--precision", choices=["fp16", "int8"])
a = ap.parse_args()

# 1 · La receta y el ONNX que pasó sus chequeos
r, cfg = receta(), corrida()
receta_sha = sha256((RAIZ / "engine.yaml").read_bytes())
if git("status", "--porcelain", "--", "engine.yaml") or receta_sha not in {x["engine_yaml_sha256"] for x in revisiones()}:
    sys.exit("✗ engine.yaml no es una versión revisada y en un commit: git status, git log -p engine.yaml")
version = cfg["challenger"]
precision = a.precision or r["engine"]["precision"]
origen = carpeta(version)
exp = leer_json(origen / "export.json")
if not exp or not (origen / "model.onnx").exists():
    sys.exit(f"✗ falta artefactos/v{version}/model.onnx con su export.json: corre pipeline/exportar.py")
if sha_archivo(origen / "model.onnx") != exp["onnx_sha256"]:
    sys.exit("✗ model.onnx no es el que pasó los tres chequeos (su sha256 no es el de export.json): vuelve a exportar")

# 2 · La guardia del build: el runtime del servidor
if ort.__version__ != runtime_servidor():
    sys.exit(f"✗ construyes con onnxruntime {ort.__version__} y el servidor corre {runtime_servidor()} "
             "(mundo/servidor/requirements.txt): un engine se construye con el runtime que lo va a servir")
destino = carpeta(version, None if precision == r["engine"]["precision"] else precision)
t0 = time.time()

# 3 · Bajar la precisión
with tempfile.TemporaryDirectory() as d:
    intermedio = Path(d) / f"{precision}.onnx"
    if precision == "fp16":
        from onnxruntime.transformers import float16

        onnx.save(float16.convert_float_to_float16(onnx.load(str(origen / "model.onnx")), keep_io_types=True), str(intermedio))
    else:
        from onnxruntime.quantization import CalibrationDataReader, quantize_static

        s = s3()
        _, fotos = manifest(s, f"calibracion/{r['engine']['calibracion']}/manifest.json")
        x = tensores(s, fotos)

        class Lector(CalibrationDataReader):
            def __init__(self):
                self.it = iter([{"input": x[i:i + 1]} for i in range(len(x))])

            def get_next(self):
                return next(self.it, None)

        quantize_static(str(origen / "model.onnx"), str(intermedio), Lector())
        print(f"  int8 calibrado con {len(x)} fotos de {r['engine']['calibracion']} (s3://{DATOS}/calibracion/…)")
    pesos = Counter(onnx.TensorProto.DataType.Name(t.data_type) for t in onnx.load(str(intermedio)).graph.initializer)
    print(f"  {precision}: {intermedio.stat().st_size / 1e3:.0f} kB (el ONNX FP32 pesa {(origen / 'model.onnx').stat().st_size / 1e3:.0f} kB) · "
          f"pesos {dict(pesos)}")

    # 4 · Optimizar para esta máquina y guardar: eso es el engine
    so = ort.SessionOptions()
    so.graph_optimization_level = {"todas": ort.GraphOptimizationLevel.ORT_ENABLE_ALL,
                                   "extendidas": ort.GraphOptimizationLevel.ORT_ENABLE_EXTENDED}[r["engine"]["optimizacion"]]
    so.optimized_model_filepath = str(destino / "engine.onnx")
    ort.InferenceSession(str(intermedio), so, providers=["CPUExecutionProvider"])

g = onnx.load(str(destino / "engine.onnx")).graph
print(f"  engine.onnx: {(destino / 'engine.onnx').stat().st_size / 1e3:.0f} kB · {len(g.node)} nodos "
      f"{dict(Counter(n.op_type for n in g.node).most_common(4))} · {time.time() - t0:.1f} s")
info = {"version": str(version), "precision": precision, "optimizacion": r["engine"]["optimizacion"],
        "pesos_sha256": exp["pesos_sha256"], "onnx_sha256": exp["onnx_sha256"], "engine_sha256": sha_archivo(destino / "engine.onnx"),
        "engine_yaml_sha256": receta_sha, "opset": exp["opset"], "batch_max": r["export"]["batch_max"],
        "onnxruntime": ort.__version__, "maquina": f"{platform.system()} {platform.machine()}",
        "cpu": os.popen("sysctl -n machdep.cpu.brand_string 2>/dev/null").read().strip() or platform.processor()}
escribir_json(destino / "engine.json", info)
print(f"✓ {destino.name}/engine.onnx · sha256 {info['engine_sha256'][:12]}… · onnxruntime {info['onnxruntime']} · {info['cpu']}")
