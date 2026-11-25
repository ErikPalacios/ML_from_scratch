"""Lo que comparte el mundo (crear, fuentes, avanzar, referencia, verificar y romper). No es parte de tu pipeline.

El mundo es el marketplace del caso, en chico: cuatro fuentes de documentos (una wiki, un Drive, un Jira y el
repositorio de políticas) que viven en fuentes/estado.json y que sirve mundo/fuentes.py por HTTP en el puerto 8120.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
FUENTES = RAIZ / "fuentes"            # el estado del mundo: lo escriben crear.py, avanzar.py y romper.py
ESTADO = FUENTES / "estado.json"
TALLER = RAIZ / ".taller"
CONFIG = RAIZ / "config.yaml"
PUERTO = 8120
BASE = f"http://localhost:{PUERTO}"
DOMINIO = "marketplace.test"
CONECTOR = f"user:conector-rag@{DOMINIO}"    # la cuenta de servicio con la que leen los conectores
ZONA_JIRA = timezone(timedelta(hours=-6))    # la zona del perfil de la cuenta de servicio en el Jira (Ciudad de México)


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def blob_sha(b: bytes) -> str:
    """El id de un archivo en git (objeto blob): sha1 de «blob <tamaño>\\0» + contenido."""
    return hashlib.sha1(b"blob %d\0" % len(b) + b).hexdigest()


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


def estado() -> dict:
    e = leer_json(ESTADO)
    if e is None:
        raise SystemExit("✗ no existe fuentes/estado.json: python mundo/crear.py")
    return e


def guardar(e: dict) -> None:
    escribir_json(ESTADO, e)


def iso(d: datetime) -> str:
    return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def utc(s: str) -> datetime:
    s = re.sub(r"([+-]\d\d)(\d\d)$", r"\1:\2", str(s).replace("Z", "+00:00"))
    d = datetime.fromisoformat(s)
    if d.tzinfo is None:
        raise ValueError(f"«{s}» no dice su zona horaria")
    return d.astimezone(timezone.utc)


def jira_fecha(d: datetime) -> str:
    """Cómo escribe Jira la fecha de un ticket: 2026-11-20T09:15:02.000-0600 (en la zona de quien consulta)."""
    return d.astimezone(ZONA_JIRA).strftime("%Y-%m-%dT%H:%M:%S.000%z")


# ---------------------------------------------------------------- reglas del mundo (las usan el servidor y la referencia)
def ancestros(e: dict, pid: str) -> list[str]:
    """Los ids de los ancestros de una página de la wiki, de la raíz a su padre."""
    out, p = [], e["wiki"]["paginas"][pid].get("padre")
    while p:
        out.insert(0, p)
        p = e["wiki"]["paginas"][p].get("padre")
    return out


def wiki_visible(e: dict, pid: str) -> bool:
    """¿La cuenta del conector puede leer la página? No, si está borrada o si ella o un ancestro la cerró «solo para mí»."""
    p = e["wiki"]["paginas"].get(pid)
    if not p or p.get("borrada"):
        return False
    return not any(e["wiki"]["paginas"][x].get("sin_conector") for x in ancestros(e, pid) + [pid])


def drive_visible(e: dict, fid: str) -> bool:
    f = e["drive"]["archivos"].get(fid)
    if not f or f.get("papelera"):
        return False
    if f.get("unidad") == "compartida" and not e["acceso"].get("drive_compartida", True):
        return False      # a la cuenta del conector la sacaron de la unidad compartida
    return True
