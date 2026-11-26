"""Lo que comparte el mundo (crear, avanzar, tokenizador, referencia, verificar y romper). No es parte de tu pipeline.

El mundo es lo que dejó la estación 1: el almacén con el texto de cada documento guardado por su hash y el catálogo
con su ACL, el día 1 (20 de noviembre) y el día 2 (21 de noviembre). Vive en mundo/entrada/ y crear.py lo copia a almacen/.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ENTRADA = RAIZ / "mundo" / "entrada"   # las fotos del almacén de la estación 1: dia1.json, dia2.json y texto/
ALMACEN = RAIZ / "almacen"             # lo que lee tu chunking (en C11, el bucket que deja la ingestión)
MUNDO = ALMACEN / "mundo.json"         # qué día es en el mundo y cuándo avanzó
CHUNKS = RAIZ / "chunks"               # lo que produce tu chunking
TALLER = RAIZ / ".taller"
CONFIG = RAIZ / "config.yaml"
MODELO = RAIZ / "modelo"

# El tokenizer de intfloat/multilingual-e5-small, el modelo de embeddings del dojo, fijado a un commit de Hugging Face.
REPO = "intfloat/multilingual-e5-small"
REVISION = "614241f622f53c4eeff9890bdc4f31cfecc418b3"
TOKENIZER = MODELO / "tokenizer.json"
TOKENIZER_SHA256 = "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39"
TOKENIZER_URL = f"https://huggingface.co/{REPO}/resolve/{REVISION}/tokenizer.json"


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def leer_json(p: Path, defecto=None):
    try:
        return json.loads(Path(p).read_text())
    except FileNotFoundError:
        return defecto


def escribir_json(p: Path, d) -> None:
    p = Path(p)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1, sort_keys=True) + "\n")
    os.replace(tmp, p)


def mundo() -> dict:
    m = leer_json(MUNDO)
    if m is None:
        raise SystemExit("✗ no existe almacen/mundo.json: python mundo/crear.py")
    return m


def entrada(dia: int) -> dict:
    """El catálogo que dejó la estación 1 ese día: doc_id → registro (con su hash, su ACL y si es lápida)."""
    return leer_json(ENTRADA / f"dia{dia}.json")["catalogo"]


def texto_entrada(h: str) -> dict:
    return leer_json(ENTRADA / "texto" / f"{h}.json")


def tokenizer_sano() -> bool:
    return TOKENIZER.exists() and sha256(TOKENIZER.read_bytes()) == TOKENIZER_SHA256
