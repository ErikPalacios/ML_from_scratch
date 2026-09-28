"""Exporta el ResNet-50 entrenado (PyTorch) a ONNX, el formato del que se construye el engine TensorRT.

Por qué ONNX en medio: TensorRT no lee checkpoints de PyTorch; su parser lee ONNX. Además el .onnx
es un artefacto versionable que ONNX Runtime puede ejecutar en CPU para el gate de paridad.

Uso:
  python export_onnx.py --checkpoint resnet50_500.pt --out classifier.onnx   # el modelo real
  python export_onnx.py --out classifier.onnx                                # pesos aleatorios: solo prueba el pipeline
Al final verifica: onnx.checker, opset real del archivo, y ONNX Runtime con batch 1 y 32 vs PyTorch.
"""

from __future__ import annotations  # anotaciones modernas sin coste en runtime

import argparse  # CLI: el mismo script corre en tu laptop y en el job de CI
import sys  # exit code ≠ 0 si la verificación falla (CI se detiene)

import numpy as np  # comparación numérica de salidas
import onnx  # checker y lectura del opset/shapes del archivo exportado
import onnxruntime as ort  # ejecuta el .onnx en CPU: prueba que el grafo corre, sin GPU
import torch
import torchvision  # la arquitectura exacta del training (resnet50)

NUM_CLASSES = 500  # categorías hoja del marketplace: la capa fc se entrenó con 500 salidas
INPUT_NAME, OUTPUT_NAME = "input", "logits"  # contrato con config.pbtxt de Triton y con el gateway
MAX_BATCH = 32  # = max_batch_size de Triton = --maxShapes de trtexec


def build_model(checkpoint: str | None) -> torch.nn.Module:
    """Reconstruye la arquitectura del training y carga los pesos."""
    if not checkpoint:
        print("[model] AVISO: sin --checkpoint → pesos aleatorios (sirve para probar el pipeline, no para servir)")
        torch.manual_seed(0)  # aleatorios pero reproducibles: export y parity_check crean el MISMO modelo
    # weights=None: nada de descargar pesos de ImageNet; num_classes=500 crea la fc correcta
    model = torchvision.models.resnet50(weights=None, num_classes=NUM_CLASSES)
    if checkpoint:
        # weights_only=True: carga solo tensores, no ejecuta pickle arbitrario (un .pt es código)
        state = torch.load(checkpoint, map_location="cpu", weights_only=True)
        # strict (por defecto): si una llave no coincide, falla AQUÍ y no en producción con pesos al azar
        model.load_state_dict(state)
    # eval(): BatchNorm usa sus running stats y Dropout se apaga. Exportar en modo train es un bug
    # clásico: el grafo queda con el comportamiento de training y las predicciones cambian.
    return model.eval()


def export(model: torch.nn.Module, out: str, opset: int, dynamo: bool) -> None:
    """PyTorch → ONNX con eje de batch dinámico (Triton junta requests en batches de 1 a 32)."""
    # Ejemplo con batch 2 y no 1: con 1 algunos tracers especializan el eje y lo vuelven constante
    example = torch.randn(2, 3, 224, 224)
    if dynamo:
        # Exportador nuevo (torch.export). Verificado con torch 2.14: el eje dinámico se declara con
        # dynamic_shapes (la clave "x" es el nombre del argumento de ResNet.forward). OJO: si le
        # pides opset 17, intenta convertir hacia abajo, esa conversión falla con ReduceMean y el
        # archivo queda en opset 18 (solo imprime el error). Úsalo con --opset 18.
        batch = torch.export.Dim("batch", min=1, max=MAX_BATCH)
        torch.onnx.export(
            model, (example,), out, dynamo=True, opset_version=opset,
            input_names=[INPUT_NAME], output_names=[OUTPUT_NAME],
            dynamic_shapes={"x": {0: batch}},
            external_data=False,  # un solo archivo (~98 MB): trtexec y el registry no pierden el .data aparte
        )
    else:
        # Exportador TorchScript (legacy). torch ≥ 2.9 usa dynamo=True POR DEFECTO, así que hay que
        # pedirlo explícito: es el que produce opset 17 limpio (GlobalAveragePool) y respeta
        # dynamic_axes tal cual. Está deprecado ("will be removed"): fija la versión de torch del
        # job de export y planea migrar a --dynamo --opset 18.
        torch.onnx.export(
            model, (example,), out, dynamo=False, opset_version=opset,
            input_names=[INPUT_NAME], output_names=[OUTPUT_NAME],
            dynamic_axes={INPUT_NAME: {0: "batch"}, OUTPUT_NAME: {0: "batch"}},  # eje 0 = batch variable
            do_constant_folding=True,  # precalcula lo constante: grafo más simple para TensorRT
        )


def verify(model: torch.nn.Module, path: str, opset: int) -> bool:
    """Chequeos que en CI deciden si el artefacto sigue adelante."""
    proto = onnx.load(path)  # carga el grafo con sus pesos
    onnx.checker.check_model(proto, full_check=True)  # estructura válida + shape inference completa
    real_opset = next(o.version for o in proto.opset_import if o.domain in ("", "ai.onnx"))
    dims = [d.dim_param or d.dim_value for d in proto.graph.input[0].type.tensor_type.shape.dim]
    print(f"[export] opset={real_opset} input={proto.graph.input[0].name}{dims} output={proto.graph.output[0].name}")
    ok = real_opset == opset  # el opset pedido debe ser el real (ver la trampa del exportador dynamo)
    # ONNX Runtime en CPU: si el grafo corre con batch 1 y 32, el eje dinámico funciona de verdad
    session = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
    for bs in (1, MAX_BATCH):
        x = torch.randn(bs, 3, 224, 224)
        with torch.inference_mode():  # sin autograd: más rápido y sin memoria extra
            ref = model(x).numpy()
        got = session.run([OUTPUT_NAME], {INPUT_NAME: x.numpy()})[0]
        diff = float(np.abs(ref - got).max())  # FP32 vs FP32: esperamos diferencias ~1e-5
        same_top1 = float((ref.argmax(1) == got.argmax(1)).mean())
        print(f"[export] batch={bs:>2} shape={got.shape} max|Δlogit|={diff:.2e} top1_igual={same_top1:.0%}")
        ok &= got.shape == (bs, NUM_CLASSES) and diff < 1e-3 and same_top1 == 1.0
    return ok


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--checkpoint", help="state_dict del ResNet-50 con fc de 500 clases (.pt)")
    parser.add_argument("--out", default="classifier.onnx", help="archivo ONNX de salida")
    parser.add_argument("--opset", type=int, default=17, help="17 con el exportador TorchScript; 18 con --dynamo")
    parser.add_argument("--dynamo", action="store_true", help="usar el exportador nuevo basado en torch.export")
    args = parser.parse_args()
    model = build_model(args.checkpoint)
    export(model, args.out, args.opset, args.dynamo)
    ok = verify(model, args.out, args.opset)
    print("[export] OK" if ok else "[export] FALLÓ la verificación")
    return 0 if ok else 1  # exit code: lo que lee el pipeline de CI


if __name__ == "__main__":
    sys.exit(main())
