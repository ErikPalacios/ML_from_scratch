"""Lo que todos los pasos del pipeline comparten. Viene dado: no tienes que escribirlo, pero sí entenderlo."""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from pathlib import Path

import boto3
import yaml
from botocore.config import Config

RAIZ = Path(__file__).resolve().parent.parent
ENTRADA = RAIZ / "entrada"       # lo que dejó la estación 1 y el producto (solo se lee)
DATA = RAIZ / "data"             # lo que produce el pipeline; DVC lo controla, git no
CORRIDAS = RAIZ / "corridas"     # el registro de corridas (en C01, MLflow)
FOTOS, DATOS = "fotos", "ml-datos"   # el bucket del producto y el de ML
DATA.mkdir(exist_ok=True)


def params() -> dict:
    """params.yaml como diccionario: params()["snapshot"]["corte"], params()["split"]["umbral"]…"""
    return yaml.safe_load((RAIZ / "params.yaml").read_text())


def utc(s: str) -> datetime:
    """Una fecha ISO 8601 a datetime en UTC. Si no trae zona (Z o +00:00), es un error: nunca se adivina."""
    d = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    if d.tzinfo is None:
        raise ValueError(f"«{s}» no dice su zona horaria")
    return d.astimezone(timezone.utc)


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def s3():
    """El cliente de S3 apuntando al S3 local (RustFS en el puerto 9300). En C01 es Amazon S3, con un rol de IAM."""
    return boto3.client(
        "s3", endpoint_url="http://localhost:9300", aws_access_key_id="taller", aws_secret_access_key="taller-secreto",
        region_name="us-east-1",
        config=Config(s3={"addressing_style": "path"}, signature_version="s3v4", max_pool_connections=32),
    )


def huella_entorno() -> str:
    """El sha256 de la lista de paquetes instalados (nombre==versión). En C01: el digest de la imagen de entrenamiento."""
    from importlib.metadata import distributions

    paquetes = sorted({f"{d.metadata['Name'].lower()}=={d.version}" for d in distributions() if d.metadata["Name"]})
    return sha256("\n".join(paquetes).encode())


def entrenar(train: list[tuple[bytes, int]], val: list[tuple[bytes, int]], semilla: int) -> dict:
    """El entrenamiento de juguete del mundo (mundo/modelo.py). La estación 3 entrena de verdad."""
    import sys

    sys.path.insert(0, str(RAIZ))
    from mundo.modelo import entrenar as _entrenar

    return _entrenar(train, val, semilla)
