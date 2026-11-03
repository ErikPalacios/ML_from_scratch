"""Lo que todos los pasos del pipeline comparten. Viene dado: no tienes que escribirlo, pero sí entenderlo."""
from pathlib import Path

import boto3
import duckdb
import yaml
from botocore.config import Config

RAIZ = Path(__file__).resolve().parent.parent
DATA = RAIZ / "data"
SAL = DATA / "pipeline"          # lo que produce el pipeline
ETQ = DATA / "etiquetado"        # lo que va y viene del etiquetado
SAL.mkdir(parents=True, exist_ok=True)
ETQ.mkdir(parents=True, exist_ok=True)
CLASES = ["playeras", "pantalones", "sueteres", "vestidos", "abrigos",
          "sandalias", "camisas", "tenis", "bolsas", "botines"]


def cfg() -> dict:
    return yaml.safe_load((RAIZ / "config.yaml").read_text())


def duck() -> duckdb.DuckDBPyConnection:
    con = duckdb.connect()
    # La zona de la sesión se fija a UTC a propósito: así el resultado no depende de la zona de tu laptop.
    con.execute("SET TimeZone = 'UTC'")
    return con


def s3():
    c = cfg()["s3"]
    return boto3.client(
        "s3", endpoint_url=c["endpoint"], aws_access_key_id=c["access_key"],
        aws_secret_access_key=c["secret_key"], region_name=c["region"],
        config=Config(s3={"addressing_style": "path"}),
    )
