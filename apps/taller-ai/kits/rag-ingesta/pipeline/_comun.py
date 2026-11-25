"""Lo que comparten los pasos del pipeline. Viene dado: no tienes que escribirlo, pero sí entenderlo."""
from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

import yaml

RAIZ = Path(__file__).resolve().parent.parent
ALMACEN = RAIZ / "almacen"                 # lo que produce tu ingestión (en C11, un bucket de S3)
TEXTO = ALMACEN / "texto"                  # un JSON por contenido parseado: texto/<sha256 del crudo>.json
CATALOGO = ALMACEN / "catalogo.json"       # un registro por documento: versión, hash, ACL, título, url…
CURSORES = ALMACEN / "cursores.json"       # hasta dónde leyó cada conector la vez pasada
CORRIDAS = ALMACEN / "corridas"            # un JSON por corrida de pipeline/ingestar.py, con sus cuentas


class FuenteSinAcceso(Exception):
    """La fuente contestó 401 o 403: el token venció o la cuenta del conector perdió el permiso. Nunca es «0 cambios»."""


def config() -> dict:
    """config.yaml como diccionario: config()["fuentes"]["wiki"]["token"], config()["http"]["reintentos"]…"""
    return yaml.safe_load((RAIZ / "config.yaml").read_text())


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def utc(s: str) -> datetime:
    """Una fecha ISO 8601 a datetime en UTC. Acepta «Z», «-06:00» y la forma de Jira, «-0600». Sin zona, es un error."""
    s = re.sub(r"([+-]\d\d)(\d\d)$", r"\1:\2", str(s).replace("Z", "+00:00"))
    d = datetime.fromisoformat(s)
    if d.tzinfo is None:
        raise ValueError(f"«{s}» no dice su zona horaria")
    return d.astimezone(timezone.utc)


def iso(d: datetime) -> str:
    """Un datetime a texto en UTC, con Z: 2026-11-20T15:00:00Z."""
    return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def ahora() -> str:
    return iso(datetime.now(timezone.utc))


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
