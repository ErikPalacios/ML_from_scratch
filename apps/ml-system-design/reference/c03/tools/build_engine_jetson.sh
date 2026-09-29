#!/usr/bin/env bash
# Compila modelo.onnx → engine TensorRT FP16 EN el Jetson de la línea (caso c03) y mide su latencia.
#
# Por qué en el dispositivo: un engine de TensorRT queda atado a la GPU (Orin = Ampere, sm_87) y a
# la versión EXACTA de TensorRT. Se construye con la misma imagen base que el inspector
# (edge/Dockerfile): así el TensorRT que compila es el mismo que después carga el engine.
# Compilarlo en tu laptop o en un servidor con otra GPU da un engine que no carga o que corre con
# kernels elegidos para otro hardware. Si construyes en un Jetson de laboratorio, que sea el
# mismo módulo (Orin NX 16GB) con el mismo JetPack que los de la línea.
#
# Uso (en el Jetson, con Docker y el runtime nvidia configurado):
#   EXPECTED_POWER_MODE=25W bash build_engine_jetson.sh modelo.onnx 2026-09-22-bracket-anomaly-v3-fp16
# Deja /opt/inspector/models/<version>.plan, el log de trtexec y un .json con las huellas para el
# model registry. El engine anterior se queda en la carpeta: el rollback no necesita red.
set -euo pipefail  # -e: aborta al primer error · -u: variable sin definir = error · pipefail: falla si falla un pipe

ONNX="${1:?uso: build_engine_jetson.sh modelo.onnx <model_version>}"
VERSION="${2:?falta model_version (el mismo string que irá en config.yaml)}"
# MISMA etiqueta que el FROM de edge/Dockerfile: TensorRT 10.3 (el de JetPack 6.2.x)
BASE_IMAGE="${BASE_IMAGE:-nvcr.io/nvidia/l4t-tensorrt:r10.3.0-runtime}"
EXPECTED_L4T="${EXPECTED_L4T:-R36}"  # JetPack 6.x = Jetson Linux (L4T) r36
MODELS_DIR="${MODELS_DIR:-/opt/inspector/models}"  # la carpeta que docker-compose.yml monta en /models
PLAN="$MODELS_DIR/$VERSION.plan"

# ---- 1. ¿Es un Jetson con el JetPack esperado? --------------------------------------------------
if [[ ! -f /etc/nv_tegra_release ]]; then
  echo "No es un Jetson (falta /etc/nv_tegra_release). El engine se construye en el dispositivo." >&2
  exit 1
fi
l4t="$(head -n1 /etc/nv_tegra_release)"  # p. ej. "# R36 (release), REVISION: 4.4, ..."
if [[ "$l4t" != *"$EXPECTED_L4T"* ]]; then
  echo "L4T detectada: '$l4t'. Se esperaba $EXPECTED_L4T (JetPack 6). Otro JetPack = otro TensorRT." >&2
  exit 1
fi
if [[ -e "$PLAN" ]]; then  # nunca pisar un engine que quizás está en producción
  echo "Ya existe $PLAN: usa otra versión. Las versiones son inmutables." >&2
  exit 1
fi

# ---- 2. Modo de energía y clocks: medir como en producción --------------------------------------
# La latencia cambia con el modo de nvpmodel (tope de watts y clocks) y con la temperatura: el
# mismo modelo da números distintos en 15W, 25W y MAXN, y otra vez a la hora 3 de un turno caluroso.
# Los números de modo cambian por módulo y por versión de JetPack: consulta /etc/nvpmodel.conf
# (o `nvpmodel -q --verbose`) y cambia el modo a mano ANTES de correr esto. Algunos cambios de
# modo piden reiniciar.
mode="$(sudo nvpmodel -q)"
echo "Modo de energía: $mode"
if [[ -n "${EXPECTED_POWER_MODE:-}" && "$mode" != *"$EXPECTED_POWER_MODE"* ]]; then
  echo "El modo no es '$EXPECTED_POWER_MODE' (el de producción). Cámbialo con: sudo nvpmodel -m <id>" >&2
  exit 1
fi
# jetson_clocks fija CPU, GPU y memoria al máximo DEL MODO ACTUAL: sin escalado dinámico de
# frecuencia, la latencia es repetible. Ojo: el modo de nvpmodel persiste tras reiniciar, pero
# jetson_clocks NO. Si esta medición asume clocks fijos, producción también: una unidad de systemd
# lo aplica en cada arranque (README, "En el Jetson"). La latencia que importa es la de la línea.
sudo jetson_clocks
sudo jetson_clocks --show

# ---- 3. Build + benchmark con trtexec, dentro de la imagen base -----------------------------------
# /opt es de root: crear la carpeta con sudo y dejarla a tu usuario (el tee y el .json de abajo
# escriben como tú; el contenedor escribe como root y el chown de después devuelve los archivos)
sudo install -d -o "$(id -u)" -g "$(id -g)" -m 755 "$MODELS_DIR"
ONNX_DIR="$(cd "$(dirname "$ONNX")" && pwd)"
ONNX_FILE="$(basename "$ONNX")"
# --runtime nvidia     así se expone la GPU integrada del Jetson a un contenedor
# Corre como root dentro del contenedor: en Jetson, CUDA con un usuario no root puede fallar
#   según los permisos de /dev/nvmap y /dev/nvhost-*; es una herramienta de build de un solo uso
#   y al final los archivos se devuelven a tu usuario con chown.
# --fp16               kernels FP16 además de FP32; TensorRT deja en FP32 lo que no convenga.
#                      INT8 exige calibración con imágenes reales (M8); probar el DLA sería
#                      agregar --useDLACore=0 --allowGPUFallback y comparar la latencia.
# --timingCacheFile    guarda las mediciones de kernels: recompilar la versión siguiente es más rápido
# --warmUp/--duration  2 s de calentamiento y 30 s de medición: con menos, el p99 no significa nada
# --percentile=50,99   reporta p50 y p99 (el p99 es el que se compara con los 120 ms de inferencia)
# --useSpinWait        sincroniza activamente con la GPU: menos ruido de sincronización en la medición
# El ONNX se exporta con shape FIJO: los 20 tiles de 512 × 512 de UNA pieza forman el batch, y
# trtexec lo toma tal cual (un solo perfil, kernels elegidos para ese shape). Si tuviera ejes
# dinámicos, fija --minShapes, --optShapes y --maxShapes al mismo batch de 20: no se juntan piezas
# en un batch (la siguiente llega 500 ms después y rompería el deadline).
docker run --rm --runtime nvidia \
  -v "$ONNX_DIR:/in:ro" -v "$MODELS_DIR:/out" \
  "$BASE_IMAGE" \
  /usr/src/tensorrt/bin/trtexec \
    --onnx="/in/$ONNX_FILE" \
    --saveEngine="/out/$VERSION.plan" \
    --fp16 \
    --timingCacheFile=/out/timing.cache \
    --warmUp=2000 --duration=30 \
    --percentile=50,99 \
    --useSpinWait \
  | tee "$MODELS_DIR/$VERSION.build.log"
sudo chown "$(id -u):$(id -g)" "$PLAN" "$MODELS_DIR/timing.cache"

# ---- 4. Huellas para el model registry -------------------------------------------------------------
# Qué ONNX produjo qué engine, con qué TensorRT, en qué JetPack y en qué modo de energía.
# La línea "[TensorRT vNNNNNN]" la imprime trtexec al arrancar (v100300 = TensorRT 10.3.0).
trt_version="$(grep -o 'TensorRT v[0-9]*' "$MODELS_DIR/$VERSION.build.log" | head -n1)"
p99="$(grep -o 'percentile(99%) = [0-9.]* ms' "$MODELS_DIR/$VERSION.build.log" | head -n1)"
cat > "$MODELS_DIR/$VERSION.build.json" <<EOF
{"model_version": "$VERSION", "base_image": "$BASE_IMAGE", "tensorrt": "$trt_version",
 "l4t": "$l4t", "power_mode": "$(echo "$mode" | head -n1)", "latency": "$p99",
 "onnx_sha256": "$(sha256sum "$ONNX" | cut -d' ' -f1)", "plan_sha256": "$(sha256sum "$PLAN" | cut -d' ' -f1)"}
EOF
cat "$MODELS_DIR/$VERSION.build.json"
# Siguientes pasos: paridad FP16 vs FP32 sobre el golden set en ESTE dispositivo, latencia de punta
# a punta con app.py (foto + modelo + PLC), shadow mode un turno completo y recién ahí config.yaml.
