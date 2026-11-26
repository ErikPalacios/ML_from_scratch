"""Lo que comparte el mundo (crear, avanzar, registro, evaluar, referencia, verificar y romper). No es parte de tu pipeline.

El mundo es el marketplace del 21 de noviembre por la tarde, cuando ya pasó la mañana de la estación 3: el índice con
la ACL en cada chunk (el corpus), el directorio de la empresa con los cambios de la mañana, las preguntas que
escribieron los expertos de cada equipo y los ejemplos con los que afina el equipo del prompt. Vive en mundo/entrada/
y crear.py lo copia a almacen/.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ENTRADA = RAIZ / "mundo" / "entrada"
ALMACEN = RAIZ / "almacen"
MUNDO = ALMACEN / "mundo.json"
GOLDEN = RAIZ / "golden"
TALLER = RAIZ / ".taller"
CONFIG = RAIZ / "config.yaml"

DIAS = {  # cada re-ingesta: el corpus que deja y la hora del mundo (UTC)
    "21": ("corpus-2026-11-21", "2026-11-21T17:00:00Z"),
    "22": ("corpus-2026-11-22", "2026-11-22T15:00:00Z"),
    "23": ("corpus-2026-11-23", "2026-11-23T15:00:00Z"),
}


def leer_json(p: Path, defecto=None):
    try:
        return json.loads(Path(p).read_text())
    except FileNotFoundError:
        return defecto


def leer_jsonl(p: Path) -> list[dict]:
    try:
        return [json.loads(l) for l in Path(p).read_text().splitlines() if l.strip()]
    except FileNotFoundError:
        return []


def escribir_json(p: Path, d) -> None:
    p = Path(p)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1, sort_keys=True) + "\n")
    os.replace(tmp, p)


def hora(iso_: str) -> str:
    """La fecha y hora en Ciudad de México (UTC-6): 21 nov 11:00."""
    d = datetime.fromisoformat(iso_.replace("Z", "+00:00")) - timedelta(hours=6)
    return f"{d.day} nov {d.hour}:{d:%M}"


def mundo() -> dict:
    m = leer_json(MUNDO)
    if m is None:
        raise SystemExit("✗ no existe almacen/mundo.json: python mundo/crear.py")
    return m


def vigente() -> str | None:
    p = GOLDEN / "VIGENTE"
    return p.read_text().strip() if p.exists() else None
