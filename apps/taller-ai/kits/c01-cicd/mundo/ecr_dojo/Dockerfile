# El ECR del dojo: un proxy delante de registry:2 (la implementación de referencia del protocolo de registros de OCI)
# que agrega lo que ECR tiene y registry:2 no: repositorios que hay que crear, credenciales que vencen, permisos por
# rol y tags inmutables. Lo construye `docker compose up`; no se toca.
FROM python:3.13-slim
RUN pip install --no-cache-dir starlette==1.0.0 uvicorn==0.54.0 httpx==0.28.1
COPY registro.py /app/
WORKDIR /app
USER nobody
CMD ["uvicorn", "registro:app", "--host", "0.0.0.0", "--port", "5000", "--log-level", "warning", "--no-access-log"]
