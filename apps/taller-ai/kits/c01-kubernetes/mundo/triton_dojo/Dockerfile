# La imagen de Triton del dojo: el servidor de la estación 6 con el modelo de juguete adentro (contrato de classifier
# v4: «input» [3, 32, 32] FP32 → «logits» [10]). La construye mundo/crear.py; no se toca. En C01: la imagen de Triton
# con el engine de TensorRT adentro (≈ 9.2 GB), que corre en una T4.
# Se construye desde mundo/:  docker build -f triton_dojo/Dockerfile --build-arg CARGA_S=20 .
FROM python:3.13-slim
RUN pip install --no-cache-dir numpy==2.5.4 onnxruntime==1.32.0 starlette==1.0.0 uvicorn==0.54.0
COPY triton_dojo/servidor.py /app/
COPY triton /models
WORKDIR /app
# Lo que tarda en cargar el engine antes de abrir el puerto (en la T4 de C01: ≈ 10–60 s). Es de la imagen, no del pod.
ARG CARGA_S=20
ARG MODELO=juguete-2026-10-01
ENV TRITON_HOST=0.0.0.0 TRITON_DOJO_CARGA_S=$CARGA_S
LABEL org.opencontainers.image.version=$MODELO
USER nobody
EXPOSE 8000
CMD ["python", "servidor.py", "--model-repository=/models", "--http-port=8000", "--model-control-mode=none", "--strict-readiness=true", "--exit-on-error=true", "--exit-timeout-secs=30", "--disable-auto-complete-config"]
