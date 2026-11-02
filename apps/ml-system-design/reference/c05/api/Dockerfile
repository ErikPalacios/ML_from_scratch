# Imagen de docs-api. Se construye desde reference/c05 (no desde api/) porque copia dos archivos de
# pipeline/: el gate usa EXACTAMENTE el mismo quality.py y cfdi.py que el pipeline.
#   docker build -f api/Dockerfile -t docs-api:<git-sha> .
# CPU pura: nada de CUDA ni de modelos. Es la parte del sistema que ve el cliente; tiene que arrancar
# rápido y pesar poco.

# Base slim con Python 3.12 (Debian). En producción, fija también el digest (@sha256:…): el tag se mueve.
FROM python:3.12-slim

# Sin .pyc en la imagen y logs sin buffer (se ven en kubectl logs al instante).
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Primero SOLO los requirements: esta capa se reutiliza mientras no cambien las dependencias, y
# cambiar main.py no reinstala todo. Todas tienen wheel para Linux x86_64 y Python 3.12: no hace
# falta compilador ni libjpeg del sistema (Pillow trae las suyas dentro del wheel).
COPY api/requirements.txt .
RUN pip install --only-binary=:all: -r requirements.txt

# El código: la API y las dos piezas compartidas con el pipeline, en el mismo directorio para que
# `import quality` y `import cfdi` funcionen igual que en los tests (pytest.ini: pythonpath = . ../pipeline).
COPY api/main.py pipeline/quality.py pipeline/cfdi.py ./

# Usuario sin privilegios: si alguien explota el parser de imágenes o de PDF, no es root dentro del contenedor.
RUN useradd --create-home --uid 10001 app
USER 10001

# 8080: puerto de la app (la misma convención de los otros casos). /healthz = liveness, /readyz = readiness.
EXPOSE 8080

# Un proceso uvicorn por contenedor: Kubernetes escala réplicas, no workers dentro del pod.
# --factory: uvicorn llama build_default_app() al arrancar (lee las variables de entorno en ese momento).
# Las variables (DOCS_BUCKET, DOCS_KMS_KEY_ID, STATE_MACHINE_ARN, límites…) vienen del Deployment.
# OJO: build_default_app usa InMemoryRepo (sin dedupe entre réplicas, se pierde al reiniciar): antes de
# producción se cambia por el repo de Postgres, que no está en esta referencia.
CMD ["uvicorn", "main:build_default_app", "--factory", "--host", "0.0.0.0", "--port", "8080"]
