"""Gate de paridad: ¿el modelo optimizado predice lo mismo que el de PyTorch? (caso c01)

Por qué existe: exportar a ONNX y compilar a TensorRT FP16 cambia la aritmética. Casi siempre la
diferencia es ruido, pero un export roto (modo train, opset mal convertido, preprocesamiento
distinto, capa no soportada) degrada accuracy SIN lanzar errores. Este script es el paso de CI que
bloquea la promoción del modelo si el candidato no coincide con la referencia en PyTorch FP32.

Backends a comparar contra PyTorch:
  --backend ort     ONNX Runtime en CPU (corre en cualquier máquina; valida el export)
  --backend triton  el engine TensorRT FP16 real servido por Triton (en la máquina con la T4)
Alternativa sin Triton en la máquina con GPU: `polygraphy run classifier.onnx --trt --fp16 --onnxrt`.

Uso:
  python parity_check.py --onnx classifier.onnx --images /data/eval_sample --n 2000
  python parity_check.py --backend triton --triton-url localhost:8000 --images /data/eval_sample
Sin --images genera imágenes sintéticas (sirve para probar el script, no como gate real).
Exit code 0 = pasa; 1 = no pasa (el pipeline se detiene).
"""

from __future__ import annotations  # anotaciones modernas sin coste en runtime

import argparse  # umbrales configurables: el mismo script para ORT FP32 y para TensorRT FP16
import io  # las imágenes sintéticas se codifican a JPEG en memoria
import sys  # exit code para CI y sys.path para importar el preprocesamiento compartido
from pathlib import Path  # rutas relativas a este archivo, no al directorio actual

import numpy as np
import torch
from PIL import Image  # solo para generar imágenes sintéticas

# El MISMO preprocesamiento del gateway: la paridad se mide sobre lo que de verdad verá el modelo
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "gateway"))
from app.preprocess import preprocess  # noqa: E402 (import después de ajustar sys.path, a propósito)
from export_onnx import INPUT_NAME, MAX_BATCH, OUTPUT_NAME, build_model  # noqa: E402 (misma construcción del modelo)


def load_images(folder: str | None, n: int) -> np.ndarray:
    """Devuelve [N,3,224,224] float32 ya preprocesado."""
    if folder:
        exts = {".jpg", ".jpeg", ".png", ".webp"}  # los formatos que acepta el gateway
        files = sorted(p for p in Path(folder).rglob("*") if p.suffix.lower() in exts)[:n]  # orden fijo: reproducible
        return np.stack([preprocess(p.read_bytes()) for p in files])
    # Sintéticas: gradientes + ruido, codificadas como JPEG para pasar por el decoder real
    rng = np.random.default_rng(0)  # semilla fija: dos corridas dan los mismos números
    out = []
    for _ in range(n):
        h, w = rng.integers(300, 1200, size=2)
        y, x = np.mgrid[0:h, 0:w]
        img = np.stack([x / w, y / h, (x + y) / (w + h)], -1) * 255 * rng.random(3) + rng.normal(0, 25, (h, w, 3))
        buf = io.BytesIO()
        Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(buf, "JPEG", quality=90)
        out.append(preprocess(buf.getvalue()))
    return np.stack(out)


def run_torch(model: torch.nn.Module, x: np.ndarray) -> np.ndarray:
    """Referencia: PyTorch FP32, el modelo tal como se evaluó offline."""
    outs = []
    with torch.inference_mode():  # sin autograd
        for i in range(0, len(x), MAX_BATCH):  # batches de 32: memoria acotada
            outs.append(model(torch.from_numpy(x[i : i + MAX_BATCH])).numpy())
    return np.concatenate(outs)


def run_ort(onnx_path: str, x: np.ndarray) -> np.ndarray:
    """Candidato 1: el .onnx en ONNX Runtime (CPU)."""
    import onnxruntime as ort  # import local: el backend triton no necesita onnxruntime

    session = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
    outs = [session.run([OUTPUT_NAME], {INPUT_NAME: x[i : i + MAX_BATCH]})[0] for i in range(0, len(x), MAX_BATCH)]
    return np.concatenate(outs)


def run_triton(url: str, model_name: str, x: np.ndarray) -> np.ndarray:
    """Candidato 2: el engine TensorRT FP16 detrás de Triton, llamado como lo llama el gateway."""
    import tritonclient.http as triton_http  # cliente síncrono: aquí no hace falta async

    client = triton_http.InferenceServerClient(url=url)
    outs = []
    for i in range(len(x)):  # de a una imagen, igual que en producción (Triton hace el batching)
        inp = triton_http.InferInput(INPUT_NAME, [1, 3, 224, 224], "FP32")
        inp.set_data_from_numpy(x[i : i + 1], binary_data=True)
        res = client.infer(model_name, [inp], outputs=[triton_http.InferRequestedOutput(OUTPUT_NAME)])
        outs.append(res.as_numpy(OUTPUT_NAME))
    return np.concatenate(outs)


def compare(ref: np.ndarray, got: np.ndarray) -> dict:
    """Métricas de paridad que importan para el producto (top-k), no solo diferencias numéricas."""
    top1 = float((ref.argmax(1) == got.argmax(1)).mean())  # ¿cambia la sugerencia principal?
    ref5 = np.argsort(-ref, 1)[:, :5]  # las 5 sugerencias que ve el vendedor
    got5 = np.argsort(-got, 1)[:, :5]
    overlap5 = float(np.mean([len(set(a) & set(b)) / 5 for a, b in zip(ref5, got5)]))  # orden dentro del top-5 no importa
    diff = np.abs(ref - got)
    return {"n": len(ref), "top1_agreement": top1, "top5_overlap": overlap5,
            "max_abs_diff": float(diff.max()), "mean_abs_diff": float(diff.mean())}


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--checkpoint", help="state_dict de PyTorch (sin él: pesos aleatorios, solo para probar)")
    p.add_argument("--backend", choices=["ort", "triton"], default="ort")
    p.add_argument("--onnx", default="classifier.onnx", help="para --backend ort")
    p.add_argument("--triton-url", default="localhost:8000", help="para --backend triton (host:puerto HTTP)")
    p.add_argument("--model-name", default="classifier")
    p.add_argument("--images", help="carpeta con una muestra del set de eval (recomendado ≥ 2,000 imágenes)")
    p.add_argument("--n", type=int, default=256, help="máximo de imágenes a comparar")
    p.add_argument("--min-top1", type=float, default=0.995, help="umbral del gate: acuerdo top-1 ≥ 99.5 %%")
    p.add_argument("--min-top5", type=float, default=0.99, help="solapamiento medio del top-5")
    # FP32 vs FP32 da ~1e-4; TensorRT FP16 da ~1e-2: el umbral depende del backend (ajústalo con datos)
    p.add_argument("--max-abs-diff", type=float, default=0.5, help="tope de |Δlogit| (atrapa exports rotos)")
    args = p.parse_args()

    x = load_images(args.images, args.n)
    ref = run_torch(build_model(args.checkpoint), x)
    got = run_ort(args.onnx, x) if args.backend == "ort" else run_triton(args.triton_url, args.model_name, x)
    m = compare(ref, got)
    print(f"[parity] backend={args.backend} n={m['n']} top1_agreement={m['top1_agreement']:.2%} "
          f"top5_overlap={m['top5_overlap']:.2%} max|Δlogit|={m['max_abs_diff']:.2e} mean|Δlogit|={m['mean_abs_diff']:.2e}")
    ok = (m["top1_agreement"] >= args.min_top1 and m["top5_overlap"] >= args.min_top5
          and m["max_abs_diff"] <= args.max_abs_diff)
    print("[parity] PASA" if ok else "[parity] NO PASA: no promuevas este artefacto")
    return 0 if ok else 1  # CI lee el exit code


if __name__ == "__main__":
    sys.exit(main())
