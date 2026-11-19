# Un nodo del gateway (en C01: una máquina c6i.xlarge de EKS). Trae Python y lo que necesita el gateway; tu código no:
# compose monta la carpeta del kit en /kit (solo lectura), así que un cambio en rastro.py llega con un reinicio.
FROM python:3.14-slim
COPY gateway/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 LOG_RAIZ=/
WORKDIR /kit
