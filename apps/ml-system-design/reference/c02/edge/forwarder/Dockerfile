# syntax=docker/dockerfile:1
# Imagen del forwarder de la caja edge (caso c02). Multi-stage como el gateway del caso 1: la etapa
# "builder" arma el venv y la final copia solo el venv, el código y ffmpeg.
# No necesita GPU: la GPU es de DeepStream. Esto es Python con I/O (MQTT, HTTP, SQLite, ffmpeg).

# ---------------------------------------------------------------- etapa 1: builder
# Misma versión de Python que en los tests; en producción fija además el digest (@sha256:…)
FROM python:3.13-slim AS builder
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
# Solo requirements.txt primero: esta capa queda en cache mientras no cambien las dependencias
COPY requirements.txt .
# Solo wheels precompilados: si falta uno, el build falla aquí en vez de necesitar gcc en silencio
RUN pip install --only-binary=:all: -r requirements.txt

# ---------------------------------------------------------------- etapa 2: runtime
FROM python:3.13-slim AS runtime
# ffmpeg copia el stream principal de la cámara para el clip (-c copy: sin decodificar, casi sin CPU).
# --no-install-recommends y borrar las listas de apt: la imagen viaja por el enlace del sitio en cada OTA.
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*
# Sin .pyc (filesystem de código de solo lectura) y logs sin buffer (si el proceso muere, no se pierden)
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    DATA_DIR=/var/lib/forwarder
# Usuario sin privilegios con UID fijo. Es dueño SOLO del directorio de datos (cola SQLite + spool)
RUN groupadd --system --gid 10001 app && \
    useradd --system --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app && \
    mkdir -p /var/lib/forwarder && chown app:app /var/lib/forwarder
WORKDIR /srv
COPY --from=builder /opt/venv /opt/venv
# Código con dueño root: el proceso lo lee pero no puede modificarlo
COPY app.py rules.py ./
USER 10001
# Sin HEALTHCHECK de Docker a propósito: no hay puerto que consultar. La salud real se ve desde la nube:
# el heartbeat cada 30 s (alerta EdgeBoxOffline) y los fps por cámara (CameraStreamDown).
CMD ["python", "app.py"]
