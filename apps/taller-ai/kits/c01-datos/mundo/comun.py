"""Piezas compartidas del mundo, de verificar.py y de romper.py. No es parte de tu pipeline."""
from __future__ import annotations

import json
from pathlib import Path

import yaml

RAIZ = Path(__file__).resolve().parent.parent
DATA = RAIZ / "data"
OCULTO = DATA / ".mundo"          # la verdad del simulador: verificar.py la usa, tu pipeline no
TALLER = RAIZ / ".taller"         # estado de romper.py

# Fashion-MNIST, con nombres de categorías de un marketplace. La 8 (Bolsas) es la categoría nueva.
CLASES = ["playeras", "pantalones", "sueteres", "vestidos", "abrigos",
          "sandalias", "camisas", "tenis", "bolsas", "botines"]
NUEVA = 8
# Pares que se confunden de verdad en Fashion-MNIST; la guía necesita una regla para cada uno.
PARES_AMBIGUOS = {"camisas-vs-playeras": (6, 0), "camisas-vs-sueteres": (6, 2), "sueteres-vs-abrigos": (2, 4)}


def config() -> dict:
    return yaml.safe_load((RAIZ / "config.yaml").read_text())


def guardar_config(c: dict) -> None:
    (RAIZ / "config.yaml").write_text(yaml.safe_dump(c, sort_keys=False, allow_unicode=True))


def s3():
    import boto3
    from botocore.config import Config

    c = config()["s3"]
    return boto3.client(
        "s3", endpoint_url=c["endpoint"], aws_access_key_id=c["access_key"],
        aws_secret_access_key=c["secret_key"], region_name=c.get("region", "us-east-1"),
        config=Config(s3={"addressing_style": "path"}, retries={"max_attempts": 3}),
    )


def leer_json(p: Path, defecto=None):
    return json.loads(p.read_text()) if p.exists() else defecto


def escribir_json(p: Path, x) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(x, ensure_ascii=False, indent=2))
