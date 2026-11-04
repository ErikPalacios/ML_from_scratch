"""Gateway: la puerta de entrada del sistema.

Cliente --JSON--> gateway (valida, arma el tensor) --HTTP v2--> model server (forward) --> gateway (etiqueta) --> cliente

El gateway NO carga el modelo: no necesita onnxruntime ni numpy. Eso lo hace el model server.
"""

import os
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

# Config por variables de entorno: la misma imagen corre en la laptop, en compose o en k8s.
MODEL_SERVER_URL = os.getenv("MODEL_SERVER_URL", "http://localhost:8000")
MODEL_NAME = os.getenv("MODEL_NAME", "iris")
MODEL_SERVER_TIMEOUT_S = float(os.getenv("MODEL_SERVER_TIMEOUT_S", "2.0"))

CLASSES = ["setosa", "versicolor", "virginica"]


class Flower(BaseModel):
    # Rangos físicos razonables en cm: rechazamos basura antes de gastar un forward.
    sepal_length: float = Field(gt=0, lt=20)
    sepal_width: float = Field(gt=0, lt=20)
    petal_length: float = Field(gt=0, lt=20)
    petal_width: float = Field(gt=0, lt=20)


class PredictRequest(BaseModel):
    flowers: list[Flower] = Field(min_length=1, max_length=64)  # 64 = MAX_BATCH_SIZE del model server


class Prediction(BaseModel):
    label: str
    score: float
    probabilities: dict[str, float]


class PredictResponse(BaseModel):
    model: str
    predictions: list[Prediction]


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Un solo cliente HTTP para toda la vida del proceso: reutiliza conexiones (keep-alive).
    app.state.client = httpx.AsyncClient(base_url=MODEL_SERVER_URL, timeout=MODEL_SERVER_TIMEOUT_S)
    yield
    await app.state.client.aclose()


app = FastAPI(title="iris-gateway", lifespan=lifespan)


@app.get("/healthz")
async def healthz():
    """Liveness: el proceso está vivo. No depende del model server (si no, k8s reiniciaría el gateway por culpa de otro)."""
    return {"status": "ok"}


@app.get("/readyz")
async def readyz():
    """Readiness: ¿puedo recibir tráfico? Solo si el model server tiene el modelo cargado."""
    try:
        r = await app.state.client.get(f"/v2/models/{MODEL_NAME}/ready")
    except httpx.HTTPError as e:
        raise HTTPException(503, f"model server no responde en {MODEL_SERVER_URL}: {type(e).__name__}")
    if r.status_code != 200:
        raise HTTPException(503, f"modelo '{MODEL_NAME}' no está listo en el model server")
    return {"status": "ready", "model_server": MODEL_SERVER_URL, "model": MODEL_NAME}


@app.post("/v1/predict", response_model=PredictResponse)
async def predict(req: PredictRequest):
    rows = [[f.sepal_length, f.sepal_width, f.petal_length, f.petal_width] for f in req.flowers]

    # Protocolo KServe v2 (el que hablan Triton y nuestro model server): tensor aplanado + shape + dtype.
    payload = {
        "inputs": [
            {
                "name": "input",
                "shape": [len(rows), 4],
                "datatype": "FP32",
                "data": [x for row in rows for x in row],
            }
        ],
        "outputs": [{"name": "probs"}],
    }

    try:
        r = await app.state.client.post(f"/v2/models/{MODEL_NAME}/infer", json=payload)
    except httpx.TimeoutException:
        raise HTTPException(504, "el model server tardó demasiado")
    except httpx.HTTPError as e:
        raise HTTPException(503, f"model server no disponible: {type(e).__name__}")
    if r.status_code != 200:
        # 502: el que falló fue el servicio de atrás, no el cliente.
        raise HTTPException(502, f"model server respondió {r.status_code}: {r.text[:200]}")

    out = r.json()["outputs"][0]
    n_classes = out["shape"][1]
    flat = out["data"]

    predictions = []
    for i in range(len(rows)):
        probs = flat[i * n_classes : (i + 1) * n_classes]
        best = max(range(n_classes), key=probs.__getitem__)
        predictions.append(
            Prediction(
                label=CLASSES[best],
                score=round(probs[best], 4),
                probabilities={c: round(p, 4) for c, p in zip(CLASSES, probs)},
            )
        )
    return PredictResponse(model=MODEL_NAME, predictions=predictions)
