"""Model server liviano: sirve un ONNX con onnxruntime y habla el protocolo KServe v2.

Es el mismo protocolo que Triton, así que el gateway no sabe (ni le importa) cuál de los dos
tiene atrás: cambiar a Triton después es cambiar la imagen en el compose.

Lee el modelo de: $MODEL_REPOSITORY/<MODEL_NAME>/<MODEL_VERSION>/model.onnx
"""

import math
import os
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
import onnxruntime as ort
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

MODEL_REPOSITORY = Path(os.getenv("MODEL_REPOSITORY", "../model_repository"))
MODEL_NAME = os.getenv("MODEL_NAME", "iris")
MODEL_VERSION = os.getenv("MODEL_VERSION", "1")
MAX_BATCH_SIZE = int(os.getenv("MAX_BATCH_SIZE", "64"))
# 1 hilo por defecto: en un contenedor con límite de CPU, más hilos que cores solo pelean entre sí.
ORT_THREADS = int(os.getenv("ORT_THREADS", "1"))

# Tipos del protocolo v2 → numpy. Este modelo solo usa FP32.
V2_TO_NUMPY = {"FP32": np.float32}
ONNX_TO_V2 = {"tensor(float)": "FP32"}


class InferInput(BaseModel):
    name: str
    shape: list[int]
    datatype: str
    data: list[float]  # tensor aplanado (row-major), como lo manda el cliente


class RequestedOutput(BaseModel):
    name: str


class InferRequest(BaseModel):
    inputs: list[InferInput]
    outputs: list[RequestedOutput] | None = None  # None = devolver todas


def load_session() -> ort.InferenceSession:
    path = MODEL_REPOSITORY / MODEL_NAME / MODEL_VERSION / "model.onnx"
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = ORT_THREADS
    return ort.InferenceSession(str(path), opts, providers=["CPUExecutionProvider"])


@asynccontextmanager
async def lifespan(app: FastAPI):
    # El modelo se carga UNA vez al arrancar, no por request.
    # Si el archivo no existe, el proceso muere aquí: fail fast, el orquestador lo ve en seguida.
    app.state.session = load_session()
    yield


app = FastAPI(title="iris-model-server", lifespan=lifespan)


def _check_model(name: str) -> ort.InferenceSession:
    if name != MODEL_NAME:
        raise HTTPException(404, f"modelo '{name}' no existe; este server sirve '{MODEL_NAME}'")
    return app.state.session


@app.get("/v2/health/live")
def live():
    return {"live": True}


@app.get("/v2/health/ready")
def ready():
    # Si llegamos aquí, lifespan ya cargó el modelo (si no, el proceso no estaría vivo).
    return {"ready": True}


@app.get("/v2/models/{name}/ready")
def model_ready(name: str):
    _check_model(name)
    return {"name": name, "ready": True}


@app.get("/v2/models/{name}")
def model_metadata(name: str):
    """Qué espera y qué devuelve el modelo: útil para depurar desde curl."""
    sess = _check_model(name)

    def describe(t):
        return {"name": t.name, "datatype": ONNX_TO_V2.get(t.type, t.type), "shape": [-1 if not isinstance(d, int) else d for d in t.shape]}

    return {
        "name": MODEL_NAME,
        "versions": [MODEL_VERSION],
        "platform": "onnxruntime_onnx",
        "inputs": [describe(t) for t in sess.get_inputs()],
        "outputs": [describe(t) for t in sess.get_outputs()],
    }


# `def` (no `async def`): onnxruntime bloquea mientras calcula; FastAPI corre los `def` en su
# threadpool, así el event loop sigue atendiendo /health mientras hay un forward en curso.
@app.post("/v2/models/{name}/infer")
def infer(name: str, req: InferRequest):
    sess = _check_model(name)
    expected = {t.name for t in sess.get_inputs()}

    feeds = {}
    for inp in req.inputs:
        if inp.name not in expected:
            raise HTTPException(400, f"input '{inp.name}' desconocido; el modelo espera {sorted(expected)}")
        if inp.datatype not in V2_TO_NUMPY:
            raise HTTPException(400, f"datatype '{inp.datatype}' no soportado; usa {list(V2_TO_NUMPY)}")
        if len(inp.data) != math.prod(inp.shape):
            raise HTTPException(400, f"shape {inp.shape} pide {math.prod(inp.shape)} valores y llegaron {len(inp.data)}")
        if inp.shape and inp.shape[0] > MAX_BATCH_SIZE:
            raise HTTPException(400, f"batch {inp.shape[0]} > max_batch_size {MAX_BATCH_SIZE}")
        feeds[inp.name] = np.asarray(inp.data, dtype=V2_TO_NUMPY[inp.datatype]).reshape(inp.shape)

    if missing := expected - feeds.keys():
        raise HTTPException(400, f"faltan inputs: {sorted(missing)}")

    out_names = [o.name for o in req.outputs] if req.outputs else [t.name for t in sess.get_outputs()]
    try:
        results = sess.run(out_names, feeds)
    except Exception as e:  # p. ej. dims incorrectas: onnxruntime explica qué esperaba
        raise HTTPException(400, f"onnxruntime: {e}")

    return {
        "model_name": MODEL_NAME,
        "model_version": MODEL_VERSION,
        "outputs": [
            {"name": n, "datatype": "FP32", "shape": list(r.shape), "data": r.ravel().tolist()}
            for n, r in zip(out_names, results)
        ],
    }
