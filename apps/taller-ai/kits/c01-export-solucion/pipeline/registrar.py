"""Paso «registrar»: el engine que pasó la paridad y la latencia queda en la versión del registro, con sus huellas.

    python pipeline/registrar.py

Contrato:
- engine.yaml revisado y en un commit. Los cuatro reportes de artefactos/v<N>/ (export, engine, paridad y latencia)
  son del MISMO engine (la misma huella, que es la del archivo) y de la misma receta; la paridad y la latencia pasaron;
  el engine se construyó con el runtime del servidor. Si algo no cuadra, se detiene y no registra nada.
- La versión es la de corrida.yaml, y los alias siguen donde los dejó el orquestador: challenger = esa versión y
  champion = el de corrida.yaml. Si alguien los movió, se detiene.
- Sube model.onnx, engine.onnx y los cuatro reportes a la corrida de la versión (artefactos engine/) y le pone sus
  tags: engine=listo, las huellas (onnx, engine, receta), onnxruntime, máquina, precisión, opset, los tres números de
  la paridad y el p99 de cada tasa.
- No mueve ningún alias: el despliegue (estaciones 8 a 10) toma el challenger desde aquí.
- Correrlo dos veces no cambia nada. Si la versión ya tiene OTRO engine, se detiene: el engine de una versión no cambia.
"""
from __future__ import annotations

import sys

from _comun import (MODELO, RAIZ, carpeta, corrida, git, leer_json, mlflow_cliente, receta, revisiones, runtime_servidor,
                    sha256, sha_archivo)

r, cfg = receta(), corrida()
receta_sha = sha256((RAIZ / "engine.yaml").read_bytes())
if git("status", "--porcelain", "--", "engine.yaml") or receta_sha not in {x["engine_yaml_sha256"] for x in revisiones()}:
    sys.exit("✗ engine.yaml no es una versión revisada y en un commit: git status, git log -p engine.yaml")
version = str(cfg["challenger"])
d_ = carpeta(version)
rep = {k: leer_json(d_ / f"{k}.json") for k in ("export", "engine", "paridad", "latencia")}
faltan = [k for k, v in rep.items() if not v]
if faltan or not (d_ / "engine.onnx").exists():
    sys.exit(f"✗ faltan reportes en artefactos/v{version}/: {faltan or ['engine.onnx']}. Corre los pasos anteriores")
e = rep["engine"]
if sha_archivo(d_ / "engine.onnx") != e["engine_sha256"] or sha_archivo(d_ / "model.onnx") != rep["export"]["onnx_sha256"]:
    sys.exit("✗ engine.onnx o model.onnx no son los de sus reportes (otra huella): vuelve a construir y a medir")
if {rep["paridad"]["engine_sha256"], rep["latencia"]["engine_sha256"]} != {e["engine_sha256"]} or e["onnx_sha256"] != rep["export"]["onnx_sha256"]:
    sys.exit("✗ la paridad o la latencia son de otro engine: vuelve a medir el de hoy")
if {x["engine_yaml_sha256"] for x in rep.values()} != {receta_sha}:
    sys.exit("✗ algún reporte se hizo con otra versión de engine.yaml")
if not rep["paridad"]["pasa"] or not rep["latencia"]["pasa"]:
    sys.exit(f"✗ no pasó: paridad {rep['paridad']['motivo'] or 'pasa'} · latencia {rep['latencia']['motivo'] or 'pasa'}")
if e["onnxruntime"] != runtime_servidor():
    sys.exit(f"✗ el engine es de onnxruntime {e['onnxruntime']} y el servidor corre {runtime_servidor()}: reconstrúyelo")

c = mlflow_cliente()
aliases = c.get_registered_model(MODELO).aliases
if str(aliases.get("challenger")) != version or str(aliases.get("champion")) != str(cfg["champion"]):
    sys.exit(f"✗ los alias se movieron: @challenger = v{aliases.get('challenger')} y @champion = v{aliases.get('champion')}; "
             f"la corrida es de v{version} contra v{cfg['champion']}. python mundo/modelos.py versiones")
mv = c.get_model_version(MODELO, version)
ya = mv.tags.get("engine_sha256")
if ya == e["engine_sha256"]:
    print(f"  v{version} ya tiene este engine ({ya[:12]}…): nada que hacer")
elif ya:
    sys.exit(f"✗ v{version} ya tiene otro engine ({ya[:12]}…): el engine de una versión no cambia")
else:
    for f in ("model.onnx", "engine.onnx", "export.json", "engine.json", "paridad.json", "latencia.json"):
        c.log_artifact(mv.run_id, str(d_ / f), "engine")
    tags = {"engine_sha256": e["engine_sha256"], "onnx_sha256": e["onnx_sha256"], "engine_yaml_sha256": receta_sha,
            "onnxruntime": e["onnxruntime"], "maquina": e["maquina"], "precision": e["precision"], "opset": str(e["opset"]),
            "paridad_a1": f"{rep['paridad']['a1']:.4f}", "paridad_o5": f"{rep['paridad']['o5']:.4f}",
            "paridad_d": f"{rep['paridad']['d']:.4f}",
            **{f"latencia_p99_{t}": f"{x['p99_challenger']:.3f}" for t, x in rep["latencia"]["tasas"].items()},
            "engine": "listo"}                      # al final: si algo de arriba falla, la versión sigue «pendiente»
    for k, v in tags.items():
        c.set_model_version_tag(MODELO, version, k, v)
    print(f"  v{version}: 6 archivos en engine/ y {len(tags)} tags")
print(f"✓ {MODELO} v{version} @challenger · engine {e['engine_sha256'][:12]}… · paridad a1 {rep['paridad']['a1']:.1%} · "
      f"latencia " + ", ".join(f"{t}/s {x['p99_challenger']:.2f} ms" for t, x in rep["latencia"]["tasas"].items()) +
      f" · champion sigue en v{cfg['champion']}")
