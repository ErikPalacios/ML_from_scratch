FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    MODEL_REPOSITORY=/models

WORKDIR /app

RUN groupadd --system --gid 10001 app && \
    useradd --system --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app

COPY model_server/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY model_repository/ /models/
COPY model_server/server.py .

USER 10001:10001

EXPOSE 8000
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
