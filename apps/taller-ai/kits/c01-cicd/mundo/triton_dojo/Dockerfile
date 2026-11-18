# El Triton del dojo (el mismo servidor de la estación 6) en su contenedor, con un modelo de juguete del mismo
# contrato que classifier v4: entrada «input» [3, 32, 32] en FP32, salida «logits» [10]. Lo construye
# `docker compose up`; no se toca. En C01: la imagen de Triton con el engine de TensorRT, en la T4.
FROM python:3.13-slim
RUN pip install --no-cache-dir numpy==2.5.4 onnxruntime==1.32.0 starlette==1.0.0 uvicorn==0.54.0
COPY servidor.py /app/
WORKDIR /app
ENV TRITON_HOST=0.0.0.0
USER nobody
CMD ["python", "servidor.py", "--model-repository=/models", "--http-port=8000", "--model-control-mode=none", "--strict-readiness=true", "--exit-on-error=true", "--disable-auto-complete-config"]
