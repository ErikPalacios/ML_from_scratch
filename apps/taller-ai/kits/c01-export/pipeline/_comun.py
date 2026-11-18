"""Lo que todos los pasos del pipeline comparten. Viene dado: no tienes que escribirlo, pero sí entenderlo."""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
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
ARTEFACTOS = RAIZ / "artefactos"  # lo que fabrica y mide cada paso, por versión: artefactos/v4/ (git la ignora)
DATOS = "ml-datos"                # el bucket de ML: el golden set y el set de calibración
MLFLOW = "http://localhost:5600"
MODELO = "classifier"
CLASES = json.loads((RAIZ / "entrada" / "categorias.json").read_text())   # el orden ES el label_id: 0 = playeras…


def corrida() -> dict:
    """corrida.yaml: los parámetros de esta noche, ya resueltos (challenger, champion y examen, por número)."""
    return yaml.safe_load((RAIZ / "corrida.yaml").read_text())


def receta() -> dict:
    """engine.yaml: la receta del export y del engine, y los umbrales de paridad y latencia, escritos antes."""
    return yaml.safe_load((RAIZ / "engine.yaml").read_text())


def revisiones() -> list[dict]:
    """Las versiones de engine.yaml que pasaron revisión (los PR aprobados del equipo): su sha256, quién y cuándo."""
    return json.loads((RAIZ / "mundo" / "revisiones.json").read_text())["aprobadas"]


def contrato() -> dict:
    """mundo/servidor/classifier.yaml: cómo espera el servidor la entrada y la salida (en C01, el config.pbtxt de Triton)."""
    return yaml.safe_load((RAIZ / "mundo" / "servidor" / "classifier.yaml").read_text())


def runtime_servidor() -> str:
    """La versión de onnxruntime que corre el servidor (mundo/servidor/requirements.txt). En C01, la release de Triton."""
    m = re.search(r"^onnxruntime==(\S+)", (RAIZ / "mundo" / "servidor" / "requirements.txt").read_text(), re.M)
    return m.group(1) if m else "?"


def carpeta(version, prueba: str | None = None) -> Path:
    """Dónde quedan los archivos de una versión: artefactos/v4/ (o artefactos/v4-int8/ para una prueba aparte)."""
    p = ARTEFACTOS / (f"v{version}" + (f"-{prueba}" if prueba else ""))
    p.mkdir(parents=True, exist_ok=True)
    return p


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def sha_archivo(p: Path) -> str:
    return sha256(Path(p).read_bytes())


def leer_json(p: Path):
    return json.loads(Path(p).read_text()) if Path(p).exists() else None


def escribir_json(p: Path, x) -> None:
    Path(p).write_text(json.dumps(x, ensure_ascii=False, indent=2) + "\n")


def s3():
    """El cliente de S3 apuntando al S3 local (RustFS en el puerto 9600). En C01 es Amazon S3, con un rol de IAM."""
    return boto3.client(
        "s3", endpoint_url="http://localhost:9600", aws_access_key_id="taller", aws_secret_access_key="taller-secreto",
        region_name="us-east-1",
        config=Config(s3={"addressing_style": "path"}, signature_version="s3v4", max_pool_connections=32),
    )


def mlflow_cliente():
    """Apunta mlflow al servidor del mundo (localhost:5600) y devuelve un MlflowClient. En C01, la URL del MLflow del equipo."""
    import mlflow
    from mlflow import MlflowClient

    mlflow.set_tracking_uri(MLFLOW)
    return MlflowClient(MLFLOW)


def bajar(run_id: str, ruta: str) -> bytes:
    """Los bytes de un artefacto de una corrida de MLflow (por ejemplo «modelo/pesos.pt» o «engine/engine.onnx»)."""
    import mlflow

    with tempfile.TemporaryDirectory() as d:
        return Path(mlflow.artifacts.download_artifacts(run_id=run_id, artifact_path=ruta, dst_path=d)).read_bytes()


def manifest(s, llave: str) -> tuple[bytes, list[dict]]:
    """Un manifest de s3://ml-datos (el del golden o el de calibración): sus bytes (para la huella) y sus fotos."""
    b = s.get_object(Bucket=DATOS, Key=llave)["Body"].read()
    return b, json.loads(b)["fotos"]


def tensores(s, fotos: list[dict]):
    """Baja las fotos de un manifest, comprueba la huella de cada una y las pasa por el preprocess del gateway:
    float32 [N, 3, 32, 32], en el orden del manifest. Es la misma entrada que recibe el servidor."""
    from concurrent.futures import ThreadPoolExecutor

    import numpy as np

    from mundo.gateway.preprocess import preprocess

    with ThreadPoolExecutor(16) as ex:
        datos = list(ex.map(lambda f: s.get_object(Bucket=DATOS, Key=f["image_key"])["Body"].read(), fotos))
    malas = [f["id"] for f, b in zip(fotos, datos) if sha256(b) != f["image_sha256"]]
    if malas:
        sys.exit(f"✗ {len(malas)} fotos no son las del manifest (por ejemplo {malas[0]}): no se usan")
    return np.stack([preprocess(b) for b in datos])


def sesion(ruta: Path):
    """Abre un archivo ONNX como lo abre el servidor: ONNX Runtime en CPU, con 1 hilo (en C01, Triton en una T4)."""
    import onnxruntime as ort

    so = ort.SessionOptions()
    so.intra_op_num_threads = 1
    so.inter_op_num_threads = 1
    so.log_severity_level = 3
    return ort.InferenceSession(str(ruta), so, providers=["CPUExecutionProvider"])


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
