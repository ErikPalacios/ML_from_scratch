"""Lo que comparte el mundo (crear, avanzar, referencia, verificar y romper). No es parte de tu pipeline.

El mundo es la mañana del 21 de noviembre en el marketplace: lo que dejó la estación 2 (los chunks de cada documento,
con su ACL), el directorio de la empresa (personas y grupos, unos dentro de otros) y la cola de cambios de permisos que
avisan las fuentes. Vive en mundo/entrada/ y crear.py lo copia a almacen/.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ENTRADA = RAIZ / "mundo" / "entrada"   # docs/ (la salida de la estación 2), directorio.json y eventos.json
ALMACEN = RAIZ / "almacen"             # lo que lee tu índice (en C11: los chunks en la plataforma de datos, el IdP y la cola)
MUNDO = ALMACEN / "mundo.json"         # el reloj del mundo
INDICE = RAIZ / "indice"               # lo que produce tu pipeline
TALLER = RAIZ / ".taller"
CONFIG = RAIZ / "config.yaml"

INICIO = "2026-11-21T15:00:00Z"        # 9:00 en Ciudad de México
REINDEXADO = "2026-11-21T16:00:00Z"    # el reindexado de cada hora (10:00)
FIN = "2026-11-21T16:30:00Z"           # 10:30
ENTREGA = 20                           # segundos que tarda un webhook en llegar a la cola
SLO = 300                              # C11: una revocación se aplica en ≤ 5 min


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


def t(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def iso(d: datetime) -> str:
    return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def mas(iso_: str, segundos: float) -> str:
    return iso(t(iso_) + timedelta(seconds=segundos))


def hora(iso_: str) -> str:
    """La hora en Ciudad de México (UTC-6), como la ve la gente: 9:07:20."""
    d = t(iso_) - timedelta(hours=6)
    return f"{d.hour}:{d:%M}" + (f":{d:%S}" if d.second else "")


def dur(seg: float) -> str:
    seg = int(round(seg))
    return f"{seg} s" if seg < 60 else f"{seg // 60} min" + (f" {seg % 60} s" if seg % 60 else "")


def mundo() -> dict:
    m = leer_json(MUNDO)
    if m is None:
        raise SystemExit("✗ no existe almacen/mundo.json: python mundo/crear.py")
    return m


def poner_reloj(iso_: str, **extra) -> None:
    m = leer_json(MUNDO, {}) | extra
    m["reloj"] = iso_
    escribir_json(MUNDO, m)
