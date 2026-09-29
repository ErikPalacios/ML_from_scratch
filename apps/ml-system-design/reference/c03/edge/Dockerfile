# syntax=docker/dockerfile:1
# Imagen del inspector de línea (caso c03) para Jetson Orin NX 16GB con JetPack 6.2.x
# (Jetson Linux / L4T r36.4–r36.5). Se construye EN el Jetson o con buildx para linux/arm64.
# Una sola etapa a propósito: las 4 dependencias de pip son wheels (no hay nada que compilar) y
# lo pesado (CUDA + TensorRT) ya viene en la base; un multi-stage no quitaría casi nada.

# ---------------------------------------------------------------- base
# l4t-tensorrt:r10.3.0-runtime (NGC) = Ubuntu 22.04 + runtime de CUDA 12.6 + TensorRT 10.3 con sus
# bindings de Python 3.10 (python3-libnvinfer) y trtexec. Es el TensorRT de JetPack 6.2.x.
# Por qué no l4t-jetpack:r36.4.0: trae el JetPack entero (≈ 5.6 GB comprimida contra ≈ 1.6 GB):
# compiladores, VPI, multimedia, nada que el inspector use.
# Por qué no l4t-base: desde JetPack 5 no monta CUDA ni TensorRT del host; habría que instalarlos.
# NVIDIA no publica una etiqueta por cada 36.x (no hay l4t-jetpack r36.5.0): la regla es mismo
# JetPack mayor y mismo TensorRT que el dispositivo; verifícala en la línea con un engine real.
# En producción fija también el digest (@sha256:…): una etiqueta se puede volver a publicar.
FROM nvcr.io/nvidia/l4t-tensorrt:r10.3.0-runtime

# PYTHONDONTWRITEBYTECODE: sin .pyc (el filesystem del contenedor es de solo lectura)
# PYTHONUNBUFFERED: cada línea de log sale al instante (si no, se pierde en un crash)
# PIP_NO_CACHE_DIR: el cache de pip no sirve dentro de una imagen, solo pesa
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# La cámara GigE Vision real (build_hardware en app.py) usaría Aravis vía PyGObject. Los paquetes
# existen en Ubuntu 22.04 para arm64; esta línea queda comentada porque el código de referencia no
# los importa todavía:
# RUN apt-get update && apt-get install -y --no-install-recommends gir1.2-aravis-0.8 python3-gi && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# Primero SOLO requirements.txt: esta capa queda en cache mientras no cambien las dependencias,
# así editar app.py no reinstala numpy en cada build (importa: el build corre en un Jetson)
COPY inspector/requirements.txt .
# --only-binary: solo wheels; si falta uno para aarch64 + Python 3.10, el build falla aquí en vez
# de intentar compilar sin compilador. pip del sistema: Ubuntu 22.04 lo permite (sin PEP 668).
RUN python3 -m pip install --only-binary=:all: -r requirements.txt

# Usuario sin privilegios con UID fijo, en el grupo video (GID 44 en Ubuntu 22.04, igual que en el
# host L4T): los nodos de la GPU integrada (/dev/nvmap, /dev/nvhost-*) suelen ser de ese grupo.
# OJO, no verificado aquí: en JetPack 6 hay reportes de CUDA que falla como no-root dentro del
# contenedor (error 801). Pruébalo en el dispositivo con `ls -ln /dev/nvmap /dev/nvhost-*` y un
# engine real; si falla, alinea los GID con group_add en compose antes de pensar en root.
RUN useradd --system --uid 10001 --gid video --no-create-home --shell /usr/sbin/nologin inspector
# Código con dueño root y solo lectura para "inspector": el proceso no puede modificarse
COPY inspector/app.py inspector/decision.py ./
USER 10001
# Documenta el puerto de /metrics (no lo publica): con red host no hay mapeo de puertos
EXPOSE 9310
# El ENTRYPOINT de la base (/opt/nvidia/nvidia_entrypoint.sh) imprime el banner y hace `exec "$@"`:
# python reemplaza al shell y recibe el SIGTERM de `docker stop`; app.py lo maneja y termina la
# pieza en curso. Sin `init: true` (docker-compose.yml) python sería el PID 1, que ignora SIGTERM
# si no hay handler: por eso el handler existe aunque haya init.
# La config y el engine NO van en la imagen: se montan (docker-compose.yml). Un cambio de
# umbrales o de modelo no obliga a mandar una imagen de ≈ 1.6 GB por la DMZ.
CMD ["python3", "app.py", "--config", "/config/config.yaml"]
