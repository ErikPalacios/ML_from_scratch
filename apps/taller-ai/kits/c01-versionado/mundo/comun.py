"""Piezas compartidas del mundo, de verificar.py y de romper.py. No es parte de tu pipeline.

Aquí también vive la «verdad» del mundo: cómo armó el equipo el snapshot de agosto. verificar.py la usa para
comparar tus salidas. No la leas para resolver un paso: el contrato de cada paso está en pipeline/.
"""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

import yaml

RAIZ = Path(__file__).resolve().parent.parent
ENTRADA = RAIZ / "entrada"        # lo que dejó la estación 1 (y el producto)
DATA = RAIZ / "data"              # lo que produce tu pipeline (DVC lo controla)
CORRIDAS = RAIZ / "corridas"      # el registro de corridas (en C01, MLflow)
TALLER = RAIZ / ".taller"         # estado de romper.py
PARAMS = RAIZ / "params.yaml"

ENDPOINT, LLAVE, SECRETO = "http://localhost:9300", "taller", "taller-secreto"
FOTOS, DATOS = "fotos", "ml-datos"   # el bucket del producto y el de ML
PADRE = "ds-2026-08-01"
ID_RX = re.compile(r"^ds-\d{4}-\d{2}-\d{2}(-r\d+)?$")   # ds-2026-09-01, o ds-2026-09-01-r2 si se reemitió

# Las mismas 10 categorías de la estación 1 (Fashion-MNIST con nombres de marketplace).
CLASES = ["playeras", "pantalones", "sueteres", "vestidos", "abrigos",
          "sandalias", "camisas", "tenis", "bolsas", "botines"]


def params() -> dict:
    return yaml.safe_load(PARAMS.read_text())


def editar_params(ruta: str, valor) -> None:
    """Cambia una sola línea de params.yaml (ruta = "seccion.llave") y conserva los comentarios."""
    a, b = ruta.split(".")
    texto = PARAMS.read_text()
    m = re.search(rf"^{a}:[ \t]*\n((?:[ \t]+.*\n?)*)", texto, re.M)
    if not m:
        raise KeyError(ruta)
    nuevo = yaml.safe_dump(valor, default_flow_style=True).strip().removesuffix("...").strip()
    bloque = re.sub(rf"^([ \t]+{b}:[ \t]*)([^#\n]*?)([ \t]*(#.*)?)$", lambda x: x.group(1) + nuevo + x.group(3), m.group(1), count=1, flags=re.M)
    PARAMS.write_text(texto[: m.start(1)] + bloque + texto[m.end(1):])
    if params()[a][b] != valor:
        raise KeyError(ruta)


def s3():
    import boto3
    from botocore.config import Config

    return boto3.client("s3", endpoint_url=ENDPOINT, aws_access_key_id=LLAVE, aws_secret_access_key=SECRETO,
                        region_name="us-east-1",
                        config=Config(s3={"addressing_style": "path"}, signature_version="s3v4",
                                      retries={"max_attempts": 3}, max_pool_connections=32))


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def leer_json(p: Path, defecto=None):
    return json.loads(p.read_text()) if p.exists() else defecto


def escribir_json(p: Path, x) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(x, ensure_ascii=False, indent=2) + "\n")


def sh(*cmd: str, check: bool = False, timeout: float = 300, cwd: Path = RAIZ) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, check=check, timeout=timeout)


def utc(s: str) -> datetime:
    """Una fecha ISO 8601 a datetime en UTC. Sin zona explícita es un error: nunca se adivina."""
    d = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    if d.tzinfo is None:
        raise ValueError(f"«{s}» no dice su zona horaria (termina en Z o en +00:00)")
    return d.astimezone(timezone.utc)


def cubeta(seller_id: str) -> int:
    return int(hashlib.sha256(seller_id.encode()).hexdigest(), 16) % 100


# ---------------------------------------------------------------- la verdad del mundo (el pipeline del equipo)
def ref_labels(eventos, corte: datetime, dias: int):
    """Para cada foto, el evento más reciente antes del corte; una elección de quien vende cuenta si ya maduró."""
    e = eventos[eventos["ts"] < corte].sort_values(["ts", "event_id"])
    v = e.groupby("image_key", as_index=False).tail(1)
    madura = (v["label_source"] != "vendedor") | (v["ts"] <= corte - timedelta(days=dias))
    return v[madura].rename(columns={"ts": "label_ts"})[["image_key", "label_id", "label_source", "guia_version", "label_ts"]]


def ref_filas(labels, pubs, golden, borrados, corte: datetime, umbral: int):
    """Manifest → filas del snapshot: sin borrados al corte, una fila por huella (la publicación más vieja),
    sin el golden set, y el split por vendedor con hash."""
    m = labels.merge(pubs[["image_key", "image_sha256", "seller_id", "created_at", "bytes"]], on="image_key", how="inner")
    fuera = set(borrados.loc[borrados["fecha"] < corte, "image_sha256"])
    m = m[~m["image_sha256"].isin(fuera)]
    m = m.sort_values(["created_at", "image_key"]).drop_duplicates("image_sha256", keep="first")
    m = m[~m["image_sha256"].isin(set(golden["image_sha256"]))]
    m = m.assign(split=["train" if cubeta(s) < umbral else "val" for s in m["seller_id"]])
    return m.sort_values("image_key").reset_index(drop=True)


def leer_entrada():
    import pandas as pd

    ev = pd.read_parquet(ENTRADA / "labels-eventos.parquet")
    pubs = pd.read_parquet(ENTRADA / "publicaciones.parquet")
    golden = pd.read_parquet(ENTRADA / "golden.parquet")
    borr = pd.read_csv(ENTRADA / "borrados.csv")
    borr["fecha"] = pd.to_datetime(borr["fecha"], utc=True)
    return ev, pubs, golden, borr


def git(*args: str) -> str:
    r = sh("git", *args)
    return r.stdout.strip() if r.returncode == 0 else ""


def huella_entorno() -> str:
    """El sha256 de la lista de paquetes instalados (nombre==versión). En C01: el digest de la imagen de entrenamiento."""
    from importlib.metadata import distributions

    paquetes = sorted({f"{d.metadata['Name'].lower()}=={d.version}" for d in distributions() if d.metadata["Name"]})
    return sha256("\n".join(paquetes).encode())


def versiones(s, bucket: str, prefijo: str) -> tuple[list[dict], list[dict]]:
    """Todas las versiones y marcas de borrado bajo un prefijo (con paginación)."""
    vs, ms = [], []
    for pag in s.get_paginator("list_object_versions").paginate(Bucket=bucket, Prefix=prefijo):
        vs += pag.get("Versions", [])
        ms += pag.get("DeleteMarkers", [])
    return vs, ms


def llaves(s, bucket: str, prefijo: str = "") -> list[str]:
    out = []
    for pag in s.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefijo):
        out += [o["Key"] for o in pag.get("Contents", [])]
    return out


def snapshots(s) -> list[str]:
    """Los ids que tienen algo en datasets/ (con tarjeta o sin ella)."""
    r = s.list_objects_v2(Bucket=DATOS, Prefix="datasets/", Delimiter="/")
    return sorted(p["Prefix"].split("/")[1] for p in r.get("CommonPrefixes", []))


def borrar_todo(s, bucket: str, prefijo: str) -> int:
    """Borra de verdad: cada versión y cada marca de borrado (lo que un borrado por ley exige con versiones)."""
    vs, ms = versiones(s, bucket, prefijo)
    for v in vs + ms:
        s.delete_object(Bucket=bucket, Key=v["Key"], VersionId=v["VersionId"])
    return len(vs)
