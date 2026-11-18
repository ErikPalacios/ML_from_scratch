"""Fabrica los modelos de juguete y las fotos del mundo de la estación 10 (no viaja en el kit; sus salidas sí).

    <venv con onnx, numpy==2.5.4, pillow==13.0.0, onnxruntime==1.32.0>/python fabricar.py

Escribe en kits/c01-rollout/mundo/:
- modelos/<nombre>/model.onnx: el contrato de classifier v4 («input» [-1, 3, 32, 32] FP32 → «logits» [-1, 10]):
  AveragePool 8×8 (16 zonas de color) → 48 números → Gemm a 10 logits. Determinista (semillas fijas).
    v14       resnet50-2026-10-01  el champion
    v15       resnet50-2026-11-01  el challenger: los pesos de v14 más un mes de «aprendizaje» (≈ 94 % de acuerdo)
    dudoso    v15 con los logits × 0.3: misma primera categoría, poca confianza (el ensayo del canary)
    sesgado   v15 con +2.2 en «bolsas»: confía, pero se lleva fotos de otras categorías (la de la falla)
- fotos/f-000.jpg … f-299.jpg: 300 fotos de 64 × 64, cada una con 16 zonas de color (lo único que ve el modelo).
- modelos/referencia.json: la huella de cada engine y, por modelo, su top-1 y su score con cada foto (verificar.py los
  usa para saber qué modelo contestó).
"""
import hashlib
import io
import json
import sys
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
from onnx import TensorProto, helper, numpy_helper
from PIL import Image

KIT = Path(__file__).resolve().parent.parent / "c01-rollout"
sys.path.insert(0, str(KIT / "gateway"))
from app.preprocess import preprocess  # noqa: E402  — el preproceso único del gateway

MUNDO = KIT / "mundo"
import os
ESCALA, MES, DUDA, SESGO = (float(x) for x in os.environ.get("DOJO_PARAMS", "0.4 0.035 0.4 1.5").split())
LABELS = json.loads((KIT / "servir" / "modelo.json").read_text())["labels"]


def modelo(W: np.ndarray, b: np.ndarray, nombre: str) -> bytes:
    g = helper.make_graph(
        [helper.make_node("AveragePool", ["input"], ["p"], kernel_shape=[8, 8], strides=[8, 8]),
         helper.make_node("Flatten", ["p"], ["f"], axis=1),
         helper.make_node("Gemm", ["f", "W", "b"], ["logits"], transB=1)],
        nombre,
        [helper.make_tensor_value_info("input", TensorProto.FLOAT, ["batch", 3, 32, 32])],
        [helper.make_tensor_value_info("logits", TensorProto.FLOAT, ["batch", 10])],
        [numpy_helper.from_array(W.astype(np.float32), "W"), numpy_helper.from_array(b.astype(np.float32), "b")])
    m = helper.make_model(g, opset_imports=[helper.make_opsetid("", 17)], producer_name="dojo-c01")
    m.ir_version = 9
    onnx.checker.check_model(m)
    return m.SerializeToString()


def fotos(n: int = 300) -> list[bytes]:
    rng = np.random.default_rng(10)
    out = []
    for _ in range(n):
        zonas = rng.uniform(0, 255, size=(4, 4, 3))
        base = rng.uniform(0, 255, size=3)
        zonas = 0.55 * zonas + 0.45 * base                 # una foto tiene un color dominante, como una prenda
        im = np.kron(zonas, np.ones((16, 16, 1))) + rng.normal(0, 6, size=(64, 64, 3))
        b = io.BytesIO()
        Image.fromarray(np.clip(im, 0, 255).astype(np.uint8)).save(b, "JPEG", quality=90)
        out.append(b.getvalue())
    return out


def main() -> None:
    rng = np.random.default_rng(14)
    W14 = rng.normal(0, ESCALA, size=(10, 48))
    b14 = rng.normal(0, 0.3, size=10)
    W15 = W14 + np.random.default_rng(15).normal(0, MES, size=W14.shape)
    b15 = b14.copy()
    sesgo = np.zeros(10)
    sesgo[LABELS.index("bolsas")] = SESGO
    mods = {"v14": (W14, b14), "v15": (W15, b15), "dudoso": (W15 * DUDA, b15 * DUDA), "sesgado": (W15, b15 + sesgo)}
    fs = fotos()
    X = np.stack([preprocess(f) for f in fs])
    (MUNDO / "fotos").mkdir(parents=True, exist_ok=True)
    for i, f in enumerate(fs):
        (MUNDO / "fotos" / f"f-{i:03d}.jpg").write_bytes(f)
    ref = {"labels": LABELS, "modelos": {}}
    top = {}
    for nombre, (W, b) in mods.items():
        crudo = modelo(W, b, nombre)
        d = MUNDO / "modelos" / nombre
        d.mkdir(parents=True, exist_ok=True)
        (d / "model.onnx").write_bytes(crudo)
        z = ort.InferenceSession(crudo).run(None, {"input": X})[0].astype(np.float64)
        p = np.exp(z - z.max(1, keepdims=True))
        p /= p.sum(1, keepdims=True)
        top[nombre] = p.argmax(1)
        ref["modelos"][nombre] = {"engine_sha256": hashlib.sha256(crudo).hexdigest(), "top1": p.argmax(1).tolist(),
                                  "score": np.round(p.max(1), 4).tolist()}
        mezcla = np.bincount(p.argmax(1), minlength=10) / len(fs)
        print(f"{nombre:8} {len(crudo)} B · baja confianza (top-1 < 0.3) {np.mean(p.max(1) < 0.3):.1%} · "
              f"mezcla {' '.join(f'{x:.2f}' for x in mezcla)}")
    for n in ("v15", "dudoso", "sesgado"):
        print(f"acuerdo top-1 v14 vs {n}: {np.mean(top['v14'] == top[n]):.1%}")
    (MUNDO / "modelos" / "referencia.json").write_text(json.dumps(ref, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
