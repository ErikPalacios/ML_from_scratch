# Imagen del mod-gateway (caso c06). Contexto de build = reference/c06 (necesita decision/ y hashing/):
#   docker build -f gateway/Dockerfile -t mod-gateway:<versión> .
# Sin GPU: el gateway solo hace hashes, llama a Triton por red y decide. Por eso la base es una imagen
# slim de Python y no una de CUDA (≈ 43 MB comprimida para amd64, leído del registry, contra varios GB:
# cold starts más rápidos al escalar).

# Versión exacta de Python y de Debian (trixie). El tag se vuelve a publicar con parches de Debian, así
# que en producción fija además el digest (@sha256:…) y actualízalo con Renovate/Dependabot.
FROM python:3.13.15-slim-trixie

# Sin .pyc en la imagen y logs sin buffer (cada línea JSON sale al instante a stdout)
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Dependencias ANTES que el código: esta capa solo se reconstruye si cambia el lock.
# --only-binary: todos los paquetes tienen wheel para cp313 manylinux x86_64 (verificado); sin
# compiladores en la imagen, y un paquete sin wheel falla el build en vez de compilarse en silencio.
COPY gateway/requirements.txt ./requirements.txt
RUN pip install --only-binary=:all: -r requirements.txt

# El motor y el índice son los MISMOS archivos que usa deep-scorer: una regla, un intérprete.
COPY decision/engine.py hashing/match.py gateway/main.py ./

# Config por defecto. En el cluster, un ConfigMap versionado se monta encima de /config: cambiar un
# umbral no requiere una imagen nueva, pero sí un rollout (y la versión queda en cada decisión).
COPY decision/policies.yaml /config/policies.yaml
ENV POLICIES_PATH=/config/policies.yaml

# Usuario sin privilegios: si alguien explota el parser de JSON, no es root dentro del contenedor.
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin app
USER 10001

EXPOSE 8080

# Un proceso uvicorn por contenedor: se escala con réplicas (HPA por CPU), no con --workers (las métricas
# de prometheus_client y el índice de hashes en memoria son por proceso).
# build_app lanza NotImplementedError hasta conectar los adaptadores reales de Triton y Kafka (README).
CMD ["uvicorn", "--factory", "main:build_app", "--host", "0.0.0.0", "--port", "8080", "--no-access-log"]
