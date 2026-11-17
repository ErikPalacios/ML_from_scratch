"""Lo que todos los pasos del pipeline comparten. Viene dado: no tienes que escribirlo, pero sí entenderlo."""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

os.environ.setdefault("MLFLOW_DISABLE_AGENT_HINT", "1")
os.environ.setdefault("GIT_PYTHON_REFRESH", "quiet")
os.environ.setdefault("MLFLOW_HTTP_REQUEST_MAX_RETRIES", "1")     # si MLflow no está, que se sepa en segundos, no en minutos
os.environ.setdefault("MLFLOW_HTTP_REQUEST_TIMEOUT", "20")

import boto3  # noqa: E402
import yaml  # noqa: E402
from botocore.config import Config  # noqa: E402

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))     # para importar mundo.gateway.preprocess y mundo.arquitectura, como en C01 se importan
DATA = RAIZ / "data"              # caché local (git la ignora): data/cache/ guarda cada foto bajada, por su huella
FOTOS, DATOS, CKPT = "fotos", "ml-datos", "ml-ckpt"   # el bucket del producto, el de ML y el de checkpoints
MLFLOW = "http://localhost:5400"
EXPERIMENTO, MODELO = "c01-entrenamiento", "classifier"
CLASES = json.loads((RAIZ / "entrada" / "categorias.json").read_text())   # el orden ES el label_id: 0 = playeras…


def receta() -> dict:
    """receta.yaml como diccionario: receta()["lr"], receta()["epocas"]…"""
    return yaml.safe_load((RAIZ / "receta.yaml").read_text())


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def s3():
    """El cliente de S3 apuntando al S3 local (RustFS en el puerto 9400). En C01 es Amazon S3, con un rol de IAM."""
    return boto3.client(
        "s3", endpoint_url="http://localhost:9400", aws_access_key_id="taller", aws_secret_access_key="taller-secreto",
        region_name="us-east-1",
        config=Config(s3={"addressing_style": "path"}, signature_version="s3v4", max_pool_connections=32),
    )


def mlflow_cliente():
    """Apunta mlflow al servidor del mundo (localhost:5400) y devuelve un MlflowClient. En C01, la URL del MLflow del equipo."""
    import mlflow
    from mlflow import MlflowClient

    mlflow.set_tracking_uri(MLFLOW)
    return MlflowClient(MLFLOW)


def git(*args: str) -> str:
    r = subprocess.run(["git", *args], cwd=RAIZ, capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else ""


def huella_entorno() -> str:
    """El sha256 de la lista de paquetes instalados (nombre==versión). En C01: el digest de la imagen de entrenamiento."""
    from importlib.metadata import distributions

    paquetes = sorted({f"{d.metadata['Name'].lower()}=={d.version}" for d in distributions() if d.metadata["Name"]})
    return sha256("\n".join(paquetes).encode())


def huella_pesos(estado: dict) -> str:
    """El sha256 de un state_dict, tensor por tensor: dos modelos iguales bit a bit dan la misma huella."""
    h = hashlib.sha256()
    for k, t in estado.items():
        h.update(k.encode())
        h.update(t.detach().cpu().contiguous().numpy().tobytes())
    return h.hexdigest()
