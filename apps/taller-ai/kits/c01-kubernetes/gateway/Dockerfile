# La imagen del gateway (la receta de la estación 7, para este gateway). Se construye desde la raíz del repositorio:
#   docker build -f gateway/Dockerfile -t <nombre> .
# Viene dada: en esta estación no se cambia la receta, se cambia cómo se construye, se prueba, se nombra y se publica.
FROM python:3.13-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /srv
COPY gateway/requirements.txt gateway/requirements.txt
RUN pip install --no-cache-dir -r gateway/requirements.txt
COPY gateway.yaml ./
COPY servir/modelo.json servir/
COPY gateway/app gateway/app
ARG REVISION=desconocida
LABEL org.opencontainers.image.revision=$REVISION org.opencontainers.image.source=dojo/classifier
RUN useradd --create-home --uid 10001 gateway
USER gateway
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s CMD python -c "import urllib.request as u; u.urlopen('http://localhost:8080/healthz', timeout=2)"
CMD ["uvicorn", "app.main:app", "--app-dir", "gateway", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", "--timeout-keep-alive", "75", "--timeout-graceful-shutdown", "20", "--no-access-log"]
