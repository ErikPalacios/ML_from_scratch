#!/usr/bin/env bash
# Compila classifier.onnx → model.plan (engine TensorRT FP16) para Triton (caso c01).
# DEBE correr en una máquina con la MISMA GPU que producción (T4 → g4dn.xlarge) y con la MISMA
# versión de TensorRT que trae la imagen de Triton. Un engine no es portable: TensorRT elige
# kernels para una arquitectura (T4 = sm_75) y serializa en un formato atado a su versión; en otra
# GPU u otra versión, Triton no lo carga o lo carga con kernels malos.
# Uso (desde reference/c01):  bash model/build_engine.sh
set -euo pipefail  # -e: aborta al primer error · -u: variable sin definir = error · pipefail: falla si falla un pipe

# Mismo YY.MM que triton/Dockerfile (tritonserver:24.08-py3 ↔ tensorrt:24.08-py3 = mismo TensorRT)
NGC_RELEASE="${NGC_RELEASE:-24.08}"
EXPECTED_GPU="${EXPECTED_GPU:-T4}"  # la GPU donde correrá el engine
# Raíz de reference/c01 calculada desde este archivo: funciona sin importar desde dónde lo llames
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ONNX="${ONNX:-model/classifier.onnx}"  # salida de export_onnx.py (relativa a ROOT)
PLAN_DIR="triton/model_repository/classifier/1"  # versión 1 del modelo en el model repository

# Guardia: compilar en la GPU equivocada produce un engine que falla (o rinde mal) al servir
gpu="$(nvidia-smi --query-gpu=name --format=csv,noheader | head -n1)"
if [[ "$gpu" != *"$EXPECTED_GPU"* ]]; then
  echo "GPU detectada: '$gpu'. Este engine debe construirse en una $EXPECTED_GPU (la de producción)." >&2
  exit 1
fi

mkdir -p "$ROOT/$PLAN_DIR"  # el directorio de versión no se versiona en git (el .plan tampoco)

# trtexec viene dentro de la imagen oficial de TensorRT: no instalas nada en el host.
#   --gpus all            expone la GPU al contenedor (requiere NVIDIA Container Toolkit)
#   --user                el .plan queda con tu usuario, no como root
#   --fp16                habilita kernels FP16 (Tensor Cores de la T4); TensorRT deja en FP32 lo que no convenga.
#                         Es TensorRT 10 (NGC 24.08). En TensorRT 11 (NGC 26.06+) ya no existe: conviertes el
#                         ONNX a FP16 con ModelOpt AutoCast y construyes el engine sin flags de precisión.
#   --minShapes/opt/max   perfil de optimización del batch dinámico: 1 ≤ batch ≤ 32, afinado para 16
#                         (max = max_batch_size de config.pbtxt). Ojo: online los batches son de ≈ 1–4
#                         (ver config.pbtxt y c01 · Serving); opt 16 es un punto de partida pensado para
#                         picos y batches grandes, no "el batch típico". Compara con perf_analyzer contra
#                         un engine con --optShapes=input:4x3x224x224 y quédate con el de mejor p99 a
#                         250–500 req/s por GPU.
#   --shapes              batch con el que trtexec hace su benchmark rápido al terminar (sanity check;
#                         la medición seria es perf_analyzer contra Triton)
docker run --rm --gpus all \
  --user "$(id -u):$(id -g)" \
  -v "$ROOT:/work" -w /work \
  "nvcr.io/nvidia/tensorrt:${NGC_RELEASE}-py3" \
  trtexec \
    --onnx="$ONNX" \
    --saveEngine="$PLAN_DIR/model.plan" \
    --fp16 \
    --minShapes=input:1x3x224x224 \
    --optShapes=input:16x3x224x224 \
    --maxShapes=input:32x3x224x224 \
    --shapes=input:16x3x224x224

# Huellas para el model registry: qué ONNX produjo qué engine, en qué GPU y con qué release
echo "GPU=$gpu NGC_RELEASE=$NGC_RELEASE"
sha256sum "$ROOT/$ONNX" "$ROOT/$PLAN_DIR/model.plan"
# Siguiente paso: python model/parity_check.py --backend triton (gate FP16 vs PyTorch FP32)
