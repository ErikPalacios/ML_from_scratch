"""Lo que comparte el mundo (modelos, crear, servicio, tráfico, noche, referencia, verificar y romper). No es parte de tu pipeline.

El mundo es el marketplace del 22 de noviembre a las 11:00, después de la re-ingesta de la noche: el corpus con su ruta
de títulos y la ACL de cada chunk (estaciones 2 y 3), el directorio de la empresa y el golden set vigente (estación 4).
Detrás del alias c11 está el índice del piloto, hecho con el modelo del tutorial (all-MiniLM-L6-v2). Vive en
mundo/entrada/ y crear.py lo copia a almacen/.
"""
from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timedelta
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ENTRADA = RAIZ / "mundo" / "entrada"
ALMACEN = RAIZ / "almacen"
MUNDO = ALMACEN / "mundo.json"
MODELO = RAIZ / "modelo"
CATALOGO = RAIZ / "mundo" / "modelos.json"
CACHE = RAIZ / "cache"
INDICES = RAIZ / "indices"
ALIAS = INDICES / "alias.json"
TALLER = RAIZ / ".taller"
CONFIG = RAIZ / "config.yaml"
RELOJ = "2026-11-22T17:00:00Z"
PILOTO = "c11-minilm-2026-11-22"


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
    tmp = p.with_name(p.name + ".tmp")
    tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1, sort_keys=True) + "\n")
    os.replace(tmp, p)


def escribir_jsonl(p: Path, filas: list[dict]) -> None:
    p = Path(p)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("".join(json.dumps(f, ensure_ascii=False, sort_keys=True) + "\n" for f in filas))


def sha256_archivo(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def hora(iso_: str) -> str:
    """La fecha y hora en Ciudad de México (UTC-6): 22 nov 11:00."""
    d = datetime.fromisoformat(iso_.replace("Z", "+00:00")) - timedelta(hours=6)
    return f"{d.day} nov {d.hour}:{d:%M}"


def catalogo() -> dict:
    return json.loads(CATALOGO.read_text())


def modelos_faltantes() -> list[str]:
    """Los archivos de modelo que no están o cuyo sha256 no es el del catálogo (vacío = todo en su lugar).
    El sha256 de cada archivo se guarda junto a él (.sha256) con su tamaño y fecha: así no se vuelve a calcular cada vez."""
    malos = []
    for clave, m in catalogo().items():
        for nombre, a in m["archivos"].items():
            p = MODELO / clave / nombre
            if not p.exists() or p.stat().st_size != a["bytes"]:
                malos.append(f"modelo/{clave}/{nombre}")
                continue
            marca = p.with_name(nombre + ".sha256")
            firma = f"{p.stat().st_size} {p.stat().st_mtime_ns}"
            guardado = marca.read_text().split("\n") if marca.exists() else []
            if guardado[:1] != [firma]:
                guardado = [firma, sha256_archivo(p)]
                marca.write_text("\n".join(guardado))
            if guardado[1] != a["sha256"]:
                malos.append(f"modelo/{clave}/{nombre}")
    return malos


def alias() -> dict:
    return leer_json(ALIAS, {})


def vigente() -> str | None:
    return alias().get("c11", {}).get("actual")
