# syntax=docker/dockerfile:1
# Imagen de seg-worker (caso c04): lee un WSI, infiere tiles en una L4 con TensorRT y escribe el
# resultado. Corre en nodos g6.2xlarge (1× L4 = Ada Lovelace, compute capability 8.9 / sm_89).
# Una sola etapa: todas las dependencias de pip son wheels (nada que compilar) y lo pesado
# (CUDA + TensorRT) ya viene en la base.

# ---------------------------------------------------------------- base
# nvcr.io/nvidia/tensorrt:26.08-py3 = Ubuntu 24.04 + CUDA 13.4.1 + TensorRT 11.2.1.2 + Python 3.12
# (leído de la configuración de la imagen en el registry de NGC y de las release notes de 26.08).
# REGLA: el engine (.plan) se construye con trtexec DENTRO DE ESTA MISMA IMAGEN y EN una L4. Un engine
# no es portable entre versiones de TensorRT ni entre arquitecturas de GPU: si subes la base a 26.09
# (TensorRT 11.3), reconstruyes y revalidas el engine; si el nodo cambia a otra GPU, también.
# El driver lo pone el nodo, no la imagen: CUDA 13.x necesita un driver de la rama R580 o más nueva
# (verifícalo en la guía de compatibilidad de CUDA para tu AMI).
# Tamaño: ≈ 6.8 GB comprimida (amd64, medido en el manifiesto del registry): trae compiladores, samples y
# herramientas que el worker no usa. Pesa en el cold start de cada nodo nuevo (KEDA escala desde 0).
# Alternativa a medir, NO construida aquí: una base CUDA runtime + el wheel tensorrt-cu13 de la MISMA
# versión que construyó el engine. En producción fija también el digest (@sha256:…).
FROM nvcr.io/nvidia/tensorrt:26.08-py3

# PYTHONDONTWRITEBYTECODE: sin .pyc (el root filesystem del pod es de solo lectura)
# PYTHONUNBUFFERED: cada línea de log sale al instante (si no, se pierde en un OOMKill o un SIGKILL)
# PIP_NO_CACHE_DIR: el cache de pip dentro de una imagen solo pesa
# La base ya define PIP_BREAK_SYSTEM_PACKAGES=1, por eso pip puede instalar en el Python del sistema
# de Ubuntu 24.04 (PEP 668 lo bloquearía). Si pip avisa conflictos con paquetes que trae la base (p. ej.
# numpy), resuélvelos antes de publicar la imagen: aquí no se construyó.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app
# Primero SOLO requirements.txt: la capa de dependencias queda en cache mientras no cambien, y editar
# worker.py no reinstala nada
COPY requirements.txt .
# --only-binary: si falta un wheel para Python 3.12 + manylinux x86_64, el build falla aquí en vez de
# intentar compilar. OpenSlide llega como wheel (openslide-bin): no hace falta apt-get install libopenslide.
RUN python3 -m pip install --only-binary=:all: -r requirements.txt

# Usuario sin privilegios con UID fijo (el mismo que runAsUser en k8s/seg-worker.yaml). La GPU no
# necesita root: el device plugin de NVIDIA monta /dev/nvidia* en el contenedor con permisos para el pod.
RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin seg
# Código con dueño root: el proceso no puede modificarse a sí mismo
COPY tiling.py worker.py ./
# El engine va HORNEADO, como en el c01: el digest de la imagen identifica código + TensorRT + modelo,
# y ese digest queda en cada summary.json (container_digest). Tag de la imagen = MODEL_VERSION.
# No se versiona en git (≈ 60 MB: ≈ 30 M params × 2 bytes en FP16, estimado): el pipeline lo construye
# con trtexec en una L4, dentro de esta misma imagen base, y lo deja en model/ antes del docker build.
COPY model/model.plan /models/model.plan
# Falla el BUILD si falta el engine: mejor aquí que 4 pods en CrashLoop a las 8 de la mañana
RUN test -s /models/model.plan
USER 10001
# Documenta el puerto de /metrics (no lo publica): lo lee el PodMonitor
EXPOSE 9100
# El ENTRYPOINT de la base (/opt/nvidia/nvidia_entrypoint.sh) imprime el banner y hace exec del CMD:
# python queda como el proceso que recibe el SIGTERM del kubelet, y worker.py lo maneja (deja de pedir
# mensajes y devuelve a la cola el slide en curso). La config (worker.yaml) y las credenciales NO van
# en la imagen: la config es un ConfigMap y AWS se accede con el rol IAM del pod (IRSA).
CMD ["python3", "worker.py"]
