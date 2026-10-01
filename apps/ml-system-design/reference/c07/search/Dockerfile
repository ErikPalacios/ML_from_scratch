# Imagen de search-api (caso c07). Contexto de build = reference/c07/search:
#   docker build -t search-api:<versión> reference/c07/search
# Sin GPU: la API valida, llama al encoder (Triton), a los shards ANN, a OpenSearch y a Redis por red, y
# fusiona. Por eso la base es una imagen slim de Python y no una de CUDA (≈ 43 MB comprimida para amd64,
# leído del registry, contra varios GB): con 1,750 QPS de pico y HPA, los pods nuevos arrancan rápido.

# Versión exacta de Python y de Debian (trixie). El tag se vuelve a publicar con parches de Debian, así
# que en producción fija además el digest (@sha256:…) y actualízalo con Renovate/Dependabot.
FROM python:3.13.15-slim-trixie

# Sin .pyc en la imagen y logs sin buffer (cada línea JSON de búsqueda sale al instante a stdout)
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Dependencias ANTES que el código: esta capa solo se reconstruye si cambia el lock.
# --only-binary: sin compiladores en la imagen; un paquete sin wheel falla el build en vez de compilarse
# en silencio.
COPY requirements.txt ./
RUN pip install --only-binary=:all: -r requirements.txt

# Solo el código de producción: fakes.py y tests/ no entran a la imagen.
COPY api.py fusion.py ./

# Usuario sin privilegios: si alguien explota el parser de imágenes o de JSON, no es root.
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin app
USER 10001

EXPOSE 8080

# Un proceso uvicorn por contenedor: se escala con réplicas (HPA), no con --workers (las métricas de
# prometheus_client son por proceso). build_app lanza NotImplementedError hasta conectar los adaptadores
# reales del encoder, los shards, OpenSearch, Redis y el reranker (ver README).
CMD ["uvicorn", "--factory", "api:build_app", "--host", "0.0.0.0", "--port", "8080", "--no-access-log"]
