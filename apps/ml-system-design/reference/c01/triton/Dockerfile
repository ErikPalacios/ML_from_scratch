# Imagen de Triton con el modelo HORNEADO (caso c01): servidor + engine + config en una imagen
# inmutable. El tag de la imagen ES la versión del modelo: desplegar, hacer canary o rollback es
# cambiar un tag, y lo que probaste en staging es byte a byte lo que corre en producción.
# Alternativa: --model-repository=s3://bucket/models (Triton lee S3 directo, credenciales vía IRSA).
# Desacopla el modelo de la imagen (no reconstruyes para cambiarlo), a cambio de que el mismo tag
# pueda servir contenidos distintos y de descargar el engine en cada arranque.

# Release de NGC: DEBE ser el mismo YY.MM que la imagen tensorrt usada en model/build_engine.sh
# (misma versión de TensorRT). Un engine de otra versión no carga.
FROM nvcr.io/nvidia/tritonserver:24.08-py3

# El model repository completo: classifier/config.pbtxt + classifier/1/model.plan
COPY model_repository /models

# Falla el BUILD si falta el engine (no se versiona en git): mejor aquí que un pod en CrashLoop
RUN test -f /models/classifier/1/model.plan

# 8000 HTTP/REST (KServe v2, lo usa el gateway) · 8001 gRPC · 8002 métricas Prometheus (nv_*)
EXPOSE 8000 8001 8002

# Nota de seguridad: la imagen de NGC corre como root por defecto. En Kubernetes fija
# runAsUser/runAsNonRoot en el securityContext si tu política lo exige (ver k8s/triton.yaml).

# Flags de tritonserver (según la documentación de la release 24.08; no se ejecutó aquí:
# confírmalos con `docker run --rm <imagen> tritonserver --help`):
#   --model-control-mode=none         carga todo al arrancar y no cambia nada en caliente (imagen inmutable)
#   --disable-auto-complete-config    usa config.pbtxt tal cual; nada de configuración inferida
#   --exit-on-error=true              si el modelo no carga, el proceso muere → el pod reinicia y alerta
#   --strict-readiness=true           /v2/health/ready solo da 200 si TODOS los modelos están listos
#   --exit-timeout-secs=30            en SIGTERM espera hasta 30 s a que terminen las inferencias en curso
#   --log-format=ISO8601              timestamps parseables por el agente de logs
CMD ["tritonserver", \
     "--model-repository=/models", \
     "--model-control-mode=none", \
     "--disable-auto-complete-config", \
     "--exit-on-error=true", \
     "--strict-readiness=true", \
     "--http-port=8000", \
     "--grpc-port=8001", \
     "--metrics-port=8002", \
     "--exit-timeout-secs=30", \
     "--log-format=ISO8601"]
