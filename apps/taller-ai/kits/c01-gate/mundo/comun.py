"""Piezas compartidas del mundo, de verificar.py y de romper.py (estación 4). No es parte de tu pipeline.

No lo leas para resolver un paso: el contrato de cada paso está arriba de su archivo en pipeline/.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
from pathlib import Path

import yaml

os.environ.setdefault("MLFLOW_DISABLE_AGENT_HINT", "1")      # MLflow imprime avisos para agentes al importarse: aquí no
os.environ.setdefault("GIT_PYTHON_REFRESH", "quiet")         # MLflow busca git para sus propios tags; sin él no avisa
os.environ.setdefault("MLFLOW_HTTP_REQUEST_MAX_RETRIES", "1")  # si MLflow no está, que se sepa en segundos, no en minutos
os.environ.setdefault("MLFLOW_HTTP_REQUEST_TIMEOUT", "20")

RAIZ = Path(__file__).resolve().parent.parent
ENTRADA = RAIZ / "entrada"        # lo que dejaron las estaciones anteriores (categorías)
DATA = RAIZ / "data"              # caché local: las fotos bajadas y Fashion-MNIST (git lo ignora)
REPORTES = RAIZ / "reportes"      # lo que deja tu evaluar.py y tu gate.py de cada candidato (git lo ignora)
TALLER = RAIZ / ".taller"         # estado de romper.py
GATE_YAML = RAIZ / "gate.yaml"    # los umbrales del gate (del equipo; cambian solo con una revisión)
CORRIDA_YAML = RAIZ / "corrida.yaml"   # los parámetros de la corrida de esta noche (los resolvió el orquestador)
REVISIONES = RAIZ / "mundo" / "revisiones.json"   # las revisiones aprobadas de gate.yaml (los PR del equipo)
GATEWAY = RAIZ / "mundo" / "gateway"

ENDPOINT, LLAVE, SECRETO = "http://localhost:9500", "taller", "taller-secreto"
MLFLOW = "http://localhost:5500"
FOTOS, DATOS = "fotos", "ml-datos"                 # el bucket del producto y el de ML
EXP_ENTRENAMIENTO, EXP_GATE, MODELO = "c01-entrenamiento", "c01-gate", "classifier"
EXPERIMENTO = EXP_ENTRENAMIENTO
GOLDEN = "golden-v1"                                # el examen congelado: s3://ml-datos/golden/golden-v1/
CANDIDATO = "cand-2026-10-01"                       # el candidato de octubre (lo dejó la estación 3)
PROVEEDOR = "cand-2026-10-01-proveedor"             # otro candidato: el mismo mes, con un lote de etiquetas malo
SNAPSHOT = "ds-2026-09-01"

CLASES = ["playeras", "pantalones", "sueteres", "vestidos", "abrigos",
          "sandalias", "camisas", "tenis", "bolsas", "botines"]


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


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


def gateway_pillow() -> str:
    """La versión de Pillow que fija el gateway (mundo/gateway/requirements.txt)."""
    m = re.search(r"^pillow==(\S+)", (GATEWAY / "requirements.txt").read_text(), re.M | re.I)
    return m.group(1) if m else "?"


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


def mlflow_arriba(timeout: float = 3) -> bool:
    import urllib.request

    try:
        with urllib.request.urlopen(f"{MLFLOW}/health", timeout=timeout) as r:
            return r.status == 200
    except Exception:  # noqa: BLE001
        return False


def huella_entorno() -> str:
    """El sha256 de la lista de paquetes instalados (nombre==versión). En C01: el digest de la imagen de entrenamiento."""
    from importlib.metadata import distributions

    paquetes = sorted({f"{d.metadata['Name'].lower()}=={d.version}" for d in distributions() if d.metadata["Name"]})
    return sha256("\n".join(paquetes).encode())


def huella_pesos(estado: dict) -> str:
    """El sha256 de los pesos (state_dict), tensor por tensor en su orden: dos modelos iguales bit a bit dan la misma."""
    h = hashlib.sha256()
    for k, t in estado.items():
        h.update(k.encode())
        h.update(t.detach().cpu().contiguous().numpy().tobytes())
    return h.hexdigest()


def tarjeta(s, sid: str) -> dict | None:
    try:
        return json.loads(s.get_object(Bucket=DATOS, Key=f"datasets/{sid}/snapshot.json")["Body"].read())
    except s.exceptions.NoSuchKey:
        return None


def filas(s, sid: str):
    import io

    import pandas as pd

    return pd.read_parquet(io.BytesIO(s.get_object(Bucket=DATOS, Key=f"datasets/{sid}/rows.parquet")["Body"].read()))


def llaves(s, bucket: str, prefijo: str = "") -> list[dict]:
    out = []
    for pag in s.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefijo):
        out += pag.get("Contents", [])
    return out


def corridas(cliente, estado: str | None = "FINISHED", tuyas: bool = True, experimento: str = EXP_GATE) -> list:
    """Las corridas de un experimento (las más nuevas primero). tuyas=True deja fuera las del equipo."""
    exp = cliente.get_experiment_by_name(experimento)
    if not exp:
        return []
    filtro = f"attributes.status = '{estado}'" if estado else ""
    rs = cliente.search_runs([exp.experiment_id], filter_string=filtro, max_results=500, order_by=["attributes.start_time DESC"])
    return [r for r in rs if not (tuyas and r.data.tags.get("equipo") == "true")]


def gate_yaml() -> dict:
    return yaml.safe_load(GATE_YAML.read_text())


def corrida_yaml() -> dict:
    return yaml.safe_load(CORRIDA_YAML.read_text())


def golden_manifest(s) -> tuple[bytes, list[dict]]:
    b = s.get_object(Bucket=DATOS, Key=f"golden/{GOLDEN}/manifest.json")["Body"].read()
    return b, json.loads(b)["fotos"]


def corrida_por_nombre(cliente, nombre: str, experimento: str = EXP_ENTRENAMIENTO):
    exp = cliente.get_experiment_by_name(experimento)
    rs = cliente.search_runs([exp.experiment_id], filter_string=f"tags.corrida = '{nombre}'", max_results=5,
                             order_by=["attributes.start_time DESC"]) if exp else []
    return rs[0] if rs else None
