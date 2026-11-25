"""Lo que comparten los pasos del pipeline. Viene dado: no tienes que escribirlo, pero sí entenderlo."""
from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

import yaml

RAIZ = Path(__file__).resolve().parent.parent
ALMACEN = RAIZ / "almacen"                 # lo que dejó la estación 1 (en C11, un bucket de S3): no se toca
CATALOGO = ALMACEN / "catalogo.json"       # doc_id → registro: versión, hash, ACL, título, url, tipo, borrado…
TEXTO = ALMACEN / "texto"                  # texto/<hash>.json: {"texto", "sha256_texto", "necesita_ocr", …}
CHUNKS = RAIZ / "chunks"                   # lo que produce tu chunking
DOCS = CHUNKS / "docs"                     # un JSON por documento, con todos sus chunks
CORRIDAS = CHUNKS / "corridas"             # un JSON por corrida de pipeline/chunkear.py, con sus cuentas


@lru_cache(maxsize=1)
def config() -> dict:
    """config.yaml como diccionario (se lee una vez por proceso): config()["chunking"]["objetivo"]…"""
    return yaml.safe_load((RAIZ / "config.yaml").read_text())


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def ahora() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def leer_json(p: Path, defecto=None):
    try:
        return json.loads(Path(p).read_text())
    except FileNotFoundError:
        return defecto


def escribir_json(p: Path, d) -> None:
    """Escribe de un jalón: a un .tmp y luego os.replace. Si el proceso muere a la mitad, el archivo viejo sigue entero."""
    p = Path(p)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1, sort_keys=True) + "\n")
    os.replace(tmp, p)


def archivo_doc(doc_id: str) -> Path:
    """Dónde viven los chunks de un documento: chunks/docs/wiki__1002.json (el «:» no va en nombres de archivo)."""
    return DOCS / f"{doc_id.replace(':', '__')}.json"
