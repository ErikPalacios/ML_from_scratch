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
REPORTES = RAIZ / "reportes"      # lo que deja cada evaluación y cada gate, por candidato (git la ignora)
FOTOS, DATOS = "fotos", "ml-datos"   # el bucket del producto y el de ML (snapshots y golden set)
MLFLOW = "http://localhost:5500"
EXP_ENTRENAMIENTO, EXP_GATE, MODELO = "c01-entrenamiento", "c01-gate", "classifier"   # los candidatos viven en el primero; tus gates, en el segundo
CLASES = json.loads((RAIZ / "entrada" / "categorias.json").read_text())   # el orden ES el label_id: 0 = playeras…


def corrida() -> dict:
    """corrida.yaml: los parámetros de esta noche, ya resueltos (candidato, champion, hace_3_meses, examen)."""
    return yaml.safe_load((RAIZ / "corrida.yaml").read_text())


def gate() -> dict:
    """gate.yaml: los umbrales del gate, escritos antes de la corrida."""
    return yaml.safe_load((RAIZ / "gate.yaml").read_text())


def revisiones() -> list[dict]:
    """Las versiones de gate.yaml que pasaron revisión (los PR aprobados del equipo): su sha256, quién y cuándo."""
    return json.loads((RAIZ / "mundo" / "revisiones.json").read_text())["aprobadas"]


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def s3():
    """El cliente de S3 apuntando al S3 local (RustFS en el puerto 9500). En C01 es Amazon S3, con un rol de IAM."""
    return boto3.client(
        "s3", endpoint_url="http://localhost:9500", aws_access_key_id="taller", aws_secret_access_key="taller-secreto",
        region_name="us-east-1",
        config=Config(s3={"addressing_style": "path"}, signature_version="s3v4", max_pool_connections=32),
    )


def mlflow_cliente():
    """Apunta mlflow al servidor del mundo (localhost:5500) y devuelve un MlflowClient. En C01, la URL del MLflow del equipo."""
    import mlflow
    from mlflow import MlflowClient

    mlflow.set_tracking_uri(MLFLOW)
    return MlflowClient(MLFLOW)


def git(*args: str) -> str:
    r = subprocess.run(["git", *args], cwd=RAIZ, capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else ""


def huella_pesos(estado: dict) -> str:
    """El sha256 de un state_dict, tensor por tensor: dos modelos iguales bit a bit dan la misma huella."""
    h = hashlib.sha256()
    for k, t in estado.items():
        h.update(k.encode())
        h.update(t.detach().cpu().contiguous().numpy().tobytes())
    return h.hexdigest()
