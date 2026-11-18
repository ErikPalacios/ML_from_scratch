"""Paso «repositorio»: arma el model repository de Triton y la ficha del modelo para el gateway, para la versión que
dice servir.yaml, con las huellas del registro.

    python servir/armar.py

Contrato:
- La versión sale de servir.yaml, por número (nunca de un alias leído al correr).
- En el registro, esa versión tiene gate=passed y engine=listo; si no, se detiene.
- Baja engine/engine.onnx de su corrida y solo lo usa si su sha256 es el tag engine_sha256 de la versión.
- Baja modelo/labels.json y solo lo usa si su sha256 es el tag labels_sha256.
- El engine se construyó con el runtime del servidor de modelos: el tag onnxruntime de la versión es la versión de
  onnxruntime instalada (la que corre mundo/triton_dojo/). Si no, se detiene.
- Escribe model_repository/classifier/1/model.onnx (la copia exacta del engine) y servir/modelo.json: modelo, version,
  model_version (el nombre de servir.yaml), engine_sha256, labels, labels_sha256, y el nombre y la forma de la entrada
  y la salida, leídos del engine. El config.pbtxt no lo escribe: es tuyo, y está en git.
- Correrlo dos veces no cambia nada: si el repositorio ya tiene ese engine, lo dice.
"""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))
import onnxruntime as ort  # noqa: E402

from mundo.comun import MODELO_JSON, REPO, mlflow_cliente, servir_yaml, sha256  # noqa: E402

# 1 · Qué se sirve: un número, no un alias
cfg = servir_yaml()
modelo, version = cfg["modelo"], str(cfg["version"])
c = mlflow_cliente()
try:
    mv = c.get_model_version(modelo, version)
except Exception as e:  # noqa: BLE001
    sys.exit(f"✗ no pude leer {modelo} v{version} del registro ({type(e).__name__}): ¿está arriba MLflow? docker compose ps")
t = mv.tags
if t.get("gate") != "passed" or t.get("engine") != "listo":
    sys.exit(f"✗ {modelo} v{version} tiene gate={t.get('gate')} y engine={t.get('engine')}: solo se sirve gate=passed y engine=listo")
if t.get("onnxruntime") != ort.__version__:
    sys.exit(f"✗ el engine de v{version} se construyó con onnxruntime {t.get('onnxruntime')} y el servidor corre "
             f"{ort.__version__}: un engine se sirve con el runtime que lo construyó")
print(f"  {modelo} v{version} · gate passed · engine listo ({t['engine_sha256'][:12]}… · onnxruntime {t['onnxruntime']})")

# 2 · Bajar el engine y los labels, y compararlos con las huellas del registro
with tempfile.TemporaryDirectory() as d:
    eng = Path(c.download_artifacts(mv.run_id, "engine/engine.onnx", d))
    lab = Path(c.download_artifacts(mv.run_id, "modelo/labels.json", d))
    if sha256(eng.read_bytes()) != t["engine_sha256"]:
        sys.exit(f"✗ engine/engine.onnx de la corrida tiene huella {sha256(eng.read_bytes())[:12]}… y v{version} dice "
                 f"{t['engine_sha256'][:12]}…: no es el engine que se registró. No lo sirvo")
    if sha256(lab.read_bytes()) != t["labels_sha256"]:
        sys.exit(f"✗ modelo/labels.json de la corrida tiene huella {sha256(lab.read_bytes())[:12]}… y v{version} dice "
                 f"{t['labels_sha256'][:12]}…: las categorías no son las del modelo. No lo sirvo")
    labels = json.loads(lab.read_text())

    # 3 · La entrada y la salida, leídas del engine (lo que el config.pbtxt tiene que declarar)
    s = ort.InferenceSession(str(eng), providers=["CPUExecutionProvider"])
    i, o = s.get_inputs()[0], s.get_outputs()[0]
    entrada = {"nombre": i.name, "forma": [d if isinstance(d, int) else -1 for d in i.shape]}
    salida = {"nombre": o.name, "forma": [d if isinstance(d, int) else -1 for d in o.shape]}
    if salida["forma"][-1] != len(labels):
        sys.exit(f"✗ el engine da {salida['forma'][-1]} logits y labels.json trae {len(labels)} categorías")

    # 4 · El model repository: <modelo>/1/model.onnx, la copia exacta
    destino = REPO / modelo / "1" / "model.onnx"
    if destino.exists() and sha256(destino.read_bytes()) == t["engine_sha256"]:
        print(f"  {destino.relative_to(RAIZ)} ya es el engine de v{version}: no cambio nada")
    else:
        destino.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(eng, destino)
        print(f"  {destino.relative_to(RAIZ)} · {destino.stat().st_size // 1000} kB · sha256 {t['engine_sha256'][:12]}…")

# 5 · La ficha del modelo para el gateway (en C01: el ConfigMap con labels.json y su huella)
ficha = {"modelo": modelo, "version": int(version), "model_version": cfg["nombre"], "engine_sha256": t["engine_sha256"],
         "labels": labels, "labels_sha256": t["labels_sha256"], "entrada": entrada, "salida": salida}
MODELO_JSON.parent.mkdir(exist_ok=True)
MODELO_JSON.write_text(json.dumps(ficha, ensure_ascii=False, indent=2) + "\n")
print(f"  servir/modelo.json · model_version {cfg['nombre']} · {len(labels)} labels ({t['labels_sha256'][:12]}…) · "
      f"entrada {entrada['nombre']} {entrada['forma']} → salida {salida['nombre']} {salida['forma']}")
print("✓ repositorio listo. Si Triton ya corría: python mundo/servicios.py reiniciar triton (carga solo al arrancar)")
