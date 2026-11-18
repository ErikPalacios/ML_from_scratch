"""El gateway de classifier: recibe la foto, la revisa, la prepara, le pide los logits a Triton con plazo y contesta.

    python mundo/servicios.py arrancar gateway       # uvicorn app.main:app --app-dir gateway --port 8701 --workers 1 …

Contrato:
- crear_app(triton=None, reglas=None, modelo=None) devuelve la app; `app = crear_app()` es la que corre uvicorn.
  Las pruebas le pasan un Triton falso, sus reglas y su ficha del modelo.
- Las reglas salen de gateway.yaml (al crear la app). Si la cadena de plazos no va de mayor a menor
  (app > gateway > triton > fila_triton), no arranca.
- El lifespan, una vez y antes de atender: lee servir/modelo.json y revisa la huella de sus labels; crea UN cliente de
  Triton para todo el proceso (tritonclient.http.aio, con el pool de gateway.yaml); le pide a Triton la metadata del
  modelo y revisa que la entrada y la salida sean las de la ficha y que haya tantos logits como labels. Si algo no
  cuadra, el proceso no arranca. Al apagarse, cierra el cliente.
- GET /healthz: {"status": "ok"} si el proceso responde. No le pregunta a nadie más.
- GET /readyz: 200 si Triton dice que el modelo está listo dentro de listo_timeout_ms; si no, 503.
- GET /metrics: las métricas de Prometheus, con estos nombres (las alertas los buscan así):
  classifier_requests_total{code, source, model_version}, classifier_request_seconds (sin los 4xx),
  classifier_preprocess_seconds, classifier_inference_seconds, classifier_top1_score, classifier_image_bytes y
  classifier_requests_in_flight.
- POST /v1/classify?top_k=N (N de gateway.yaml; fuera de rango, 422 de FastAPI), con los bytes de la foto:
  · request_id del header X-Request-ID o uno nuevo; X-Client-Source (mobile, web, internal u other) solo para métricas;
    X-Caller-Id (en C01 sale del token que verificó el ALB).
  · La 17 en vuelo (en_vuelo de gateway.yaml) recibe 503 + Retry-After: 1 al instante, sin leer el body.
  · La revisión de revision.py, en orden: 415, 413 por header, 413 al leer, 400 vacía, 413 por píxeles, 400 por forma.
  · El decode, en un hilo, con un semáforo de `decodes` lugares; quien espera más de espera_cpu_ms recibe 503 +
    Retry-After: 1. Si el decode falla, 400.
  · Triton con plazo min(triton, lo que le queda a la request de su plazo gateway); si ya no queda, 504 sin llamar.
    Se corta con asyncio.wait_for (el `timeout` de infer() es otra cosa: un tiempo para la fila del servidor).
    Triton no contesta a tiempo: 504. Sin conexión: 503 + Retry-After: 1. Triton contesta con error: 503. Sin reintentos.
  · Logits no finitos: 500, nunca un 200 con basura. Softmax estable (restando el máximo), top_k y labels.
  · 200: {"model_version", "predictions": [{"label", "score" (4 decimales)}], "latency_ms"}.
  · Quien llama se fue a media subida: 499.
- Toda respuesta lleva X-Request-ID (también los errores, el 422 y el 405).
- Una línea de JSON por request en stdout (en un finally), también para el 422, el 499 y el 405: request_id, caller,
  source, model_version, top5 [[índice, score]], ms {pre, triton, post, total}, bytes, sha256 (12 caracteres), status y,
  si falló, error. Nunca la foto.
"""
from __future__ import annotations

raise NotImplementedError("gateway/app/main.py todavía no está escrito (pasos 5 a 7 del GUION)")
