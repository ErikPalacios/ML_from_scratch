"""Piezas compartidas del mundo, de verificar.py y de romper.py (estación 6). No es parte de lo que escribes.

No lo leas para resolver un paso: el contrato de cada archivo está arriba de él.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path

import yaml

os.environ.setdefault("MLFLOW_DISABLE_AGENT_HINT", "1")      # MLflow imprime avisos para agentes al importarse: aquí no
os.environ.setdefault("GIT_PYTHON_REFRESH", "quiet")         # MLflow busca git para sus propios tags; sin él no avisa
os.environ.setdefault("MLFLOW_HTTP_REQUEST_MAX_RETRIES", "1")  # si MLflow no está, que se sepa en segundos, no en minutos
os.environ.setdefault("MLFLOW_HTTP_REQUEST_TIMEOUT", "20")
os.environ.setdefault("ORT_LOGGING_LEVEL", "3")

RAIZ = Path(__file__).resolve().parent.parent
DATA = RAIZ / "data"                    # caché local: Fashion-MNIST (git lo ignora)
TALLER = RAIZ / ".taller"               # estado de romper.py
LOGS = RAIZ / "logs"                    # lo que escriben el servidor de modelos y tu gateway (git lo ignora)
RARAS = RAIZ / "fotos-raras"            # las fotos de prueba que crea mundo/crear.py (git lo ignora)
REPO = RAIZ / "model_repository"        # el model repository de Triton
GATEWAY = RAIZ / "gateway"
GATEWAY_YAML = RAIZ / "gateway.yaml"    # las reglas del gateway (del equipo de serving; cambian solo con una revisión)
SERVIR_YAML = RAIZ / "servir.yaml"      # qué versión se sirve (lo resolvió el orquestador)
MODELO_JSON = RAIZ / "servir" / "modelo.json"   # lo que deja tu servir/armar.py: versión, huellas y labels
REVISIONES = RAIZ / "mundo" / "revisiones.json"

ENDPOINT, LLAVE, SECRETO = "http://localhost:9700", "taller", "taller-secreto"
MLFLOW = "http://localhost:5700"
TRITON = "http://localhost:8700"
GW = "http://localhost:8701"
DATOS, CKPT = "ml-datos", "ml-ckpt"
EXP_ENTRENAMIENTO, MODELO = "c01-entrenamiento", "classifier"
GOLDEN = "golden-v1"
CANDIDATO = "cand-2026-10-01"

CLASES = ["playeras", "pantalones", "sueteres", "vestidos", "abrigos",
          "sandalias", "camisas", "tenis", "bolsas", "botines"]


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def sha_archivo(p: Path) -> str:
    return sha256(Path(p).read_bytes())


def leer_json(p: Path, defecto=None):
    return json.loads(p.read_text()) if p.exists() else defecto


def escribir_json(p: Path, x) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(x, ensure_ascii=False, indent=2) + "\n")


def sh(*cmd: str, check: bool = False, timeout: float = 600, cwd: Path = RAIZ, env: dict | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, check=check, timeout=timeout,
                          env={**os.environ, **(env or {})})


def git(*args: str) -> str:
    r = sh("git", *args)
    return r.stdout.strip() if r.returncode == 0 else ""


def editar_yaml(p: Path, llave: str, valor) -> None:
    """Cambia una sola línea de un YAML (llave: valor) y conserva los comentarios. La llave puede tener sangría."""
    texto = p.read_text()
    nuevo = yaml.safe_dump(valor, default_flow_style=True).strip().removesuffix("...").strip()
    texto2, n = re.subn(rf"^([ \t]*{re.escape(llave)}:[ \t]*)([^#\n]*?)([ \t]*(#.*)?)$", lambda m: m.group(1) + nuevo + m.group(3), texto, count=1, flags=re.M)
    if not n:
        raise KeyError(llave)
    p.write_text(texto2)


def gateway_yaml() -> dict:
    return yaml.safe_load(GATEWAY_YAML.read_text())


def servir_yaml() -> dict:
    return yaml.safe_load(SERVIR_YAML.read_text())


def s3():
    import boto3
    from botocore.config import Config

    return boto3.client("s3", endpoint_url=ENDPOINT, aws_access_key_id=LLAVE, aws_secret_access_key=SECRETO,
                        region_name="us-east-1",
                        config=Config(s3={"addressing_style": "path"}, signature_version="s3v4",
                                      retries={"max_attempts": 3}, max_pool_connections=32))


def mlflow_cliente():
    import mlflow
    from mlflow import MlflowClient

    mlflow.set_tracking_uri(MLFLOW)
    return MlflowClient(MLFLOW)


def arriba(url: str, timeout: float = 3) -> int | None:
    """El código HTTP de un GET, o None si nadie contesta a tiempo."""
    import urllib.error
    import urllib.request

    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:  # noqa: BLE001
        return None


def mlflow_arriba(timeout: float = 3) -> bool:
    return arriba(f"{MLFLOW}/health", timeout) == 200


def huella_pesos(estado: dict) -> str:
    """El sha256 de los pesos (state_dict), tensor por tensor en su orden: dos modelos iguales bit a bit dan la misma."""
    h = hashlib.sha256()
    for k, t in estado.items():
        h.update(k.encode())
        h.update(t.detach().cpu().contiguous().numpy().tobytes())
    return h.hexdigest()


def labels_sha(labels: list) -> str:
    """La huella de un labels.json tal como lo guarda el equipo: la lista en JSON, una línea."""
    return sha256((json.dumps(labels, ensure_ascii=False) + "\n").encode())


def golden_manifest(s) -> tuple[bytes, list[dict]]:
    b = s.get_object(Bucket=DATOS, Key=f"golden/{GOLDEN}/manifest.json")["Body"].read()
    return b, json.loads(b)["fotos"]


def golden_fotos(s, fotos: list[dict]) -> list[bytes]:
    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(16) as ex:
        return list(ex.map(lambda f: s.get_object(Bucket=DATOS, Key=f["image_key"])["Body"].read(), fotos))


def artefacto(run_id: str, ruta: str) -> bytes | None:
    """Los bytes de un artefacto de una corrida de MLflow (o None si no está)."""
    import mlflow

    with tempfile.TemporaryDirectory() as d:
        try:
            return Path(mlflow.artifacts.download_artifacts(run_id=run_id, artifact_path=ruta, dst_path=d)).read_bytes()
        except Exception:  # noqa: BLE001
            return None


def pesos_de(run_id: str) -> dict:
    import io

    import torch

    b = artefacto(run_id, "modelo/pesos.pt")
    return torch.load(io.BytesIO(b), map_location="cpu", weights_only=True)
