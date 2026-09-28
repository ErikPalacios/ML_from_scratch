# syntax=docker/dockerfile:1
# Imagen del gateway (caso c01). Multi-stage: la etapa "builder" instala dependencias en un venv y
# la final copia SOLO ese venv y el código. Resultado: sin pip cache, sin compiladores ni headers,
# menos superficie de ataque y una imagen más chica que se descarga rápido al escalar.

# ---------------------------------------------------------------- etapa 1: builder
# Misma versión de Python que en los tests (3.13); en producción fija además el digest (@sha256:…)
FROM python:3.13-slim AS builder
# PIP_NO_CACHE_DIR: el cache de pip no sirve dentro de una imagen, solo pesa
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
# venv en ruta fija: se copia entero a la etapa final y el PATH lo encuentra
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
# Primero SOLO requirements.txt: esta capa queda en cache mientras no cambien las dependencias,
# así editar main.py no reinstala numpy y Pillow en cada build
COPY requirements.txt .
# --only-binary: solo wheels precompilados; si falta uno, el build falla aquí en vez de intentar
# compilar (y necesitar gcc) en silencio. Verificado: los 37 paquetes tienen wheel cp313 manylinux x86_64.
RUN pip install --only-binary=:all: -r requirements.txt

# ---------------------------------------------------------------- etapa 2: runtime
FROM python:3.13-slim AS runtime
# PYTHONDONTWRITEBYTECODE: no escribe .pyc (el filesystem será read-only en k8s)
# PYTHONUNBUFFERED: cada línea de log sale al instante a stdout (si no, se pierde en un crash)
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH"
# Usuario sin privilegios con UID numérico fijo: k8s puede verificar runAsNonRoot con un UID
# (con un nombre de usuario no puede) y un escape del proceso no es root en el nodo
RUN groupadd --system --gid 10001 app && \
    useradd --system --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app
WORKDIR /srv
# Solo el venv ya resuelto: pip, compiladores y caches de la etapa builder se quedan atrás
COPY --from=builder /opt/venv /opt/venv
# El código queda con dueño root y solo lectura para "app": el proceso no puede modificarse
COPY app/ ./app/
USER 10001
# Documenta el puerto (no lo publica): el Service de k8s y compose apuntan aquí
EXPOSE 8080
# HEALTHCHECK lo usan `docker run`/compose. Kubernetes lo IGNORA: allá mandan liveness/readiness
# probes. Sin curl en la imagen slim, se usa Python (stdlib) para pegarle a /healthz.
HEALTHCHECK --interval=10s --timeout=2s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=1)"]
# 1 proceso por contenedor (--workers 1): en k8s escalas con réplicas (HPA), cada pod con su
# request de CPU, su métrica de /metrics y su probe. Varios workers en un pod esconden fallas,
# duplican memoria y rompen prometheus_client sin modo multiproceso.
#   --timeout-keep-alive 75   mayor que el idle timeout del ALB (60 s): si el backend cierra primero,
#                             el ALB reusa una conexión muerta y el cliente ve 502 esporádicos
#   --no-access-log           el gateway ya escribe una línea JSON por request; el access log duplicaría
#   --timeout-graceful-shutdown 20  en SIGTERM termina los requests en curso (< terminationGracePeriodSeconds)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", \
     "--timeout-keep-alive", "75", "--no-access-log", "--timeout-graceful-shutdown", "20"]
