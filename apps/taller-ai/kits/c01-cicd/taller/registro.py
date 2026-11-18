"""Anota tu avance en taller/progreso.json, el archivo que importas en «Tu tablero» del Dojo.

verificar.py anota cada corrida (qué checks pasan y cuáles no) y romper.py cada falla que cierras, con su tiempo
real. Claude Code completa el resto (el estado de las rondas, la bitácora y lo que aprendiste de cada falla).
Las fechas van en ISO 8601 con la hora y la zona de tu Mac, por ejemplo 2026-11-15T10:20:31-06:00.
Si algo falla aquí, verificar.py y romper.py siguen igual: solo avisa.
"""
from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path

ESTACION = "c01-cicd"
PROGRESO = Path(__file__).resolve().parent / "progreso.json"
MAX_VERIFICACIONES = 30   # el tablero solo necesita las últimas
RONDA_DE_ROMPER = {True: "romper_ayuda", False: "romper_solo"}   # romper.py --mostrar es la ronda con ayuda


def ahora() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def local(iso: str) -> str:
    """Una fecha ISO cualquiera (romper.py guarda la suya en UTC) en la hora de tu Mac, sin microsegundos."""
    return datetime.fromisoformat(iso).astimezone().isoformat(timespec="seconds")


def _leer() -> dict:
    if PROGRESO.exists():
        return json.loads(PROGRESO.read_text())
    return {"estacion": ESTACION, "rondas": {
        "guiado": {"estado": "pendiente", "inicio": None, "fin": None},
        "solo": {"estado": "pendiente", "inicio": None, "fin": None, "pistas": 0},
        "romper_ayuda": {"estado": "pendiente", "fallas": []},
        "romper_solo": {"estado": "pendiente", "fallas": []},
    }, "bitacora": []}


def _escribir(p: dict) -> None:
    tmp = PROGRESO.with_suffix(".tmp")
    tmp.write_text(json.dumps(p, ensure_ascii=False, indent=2) + "\n")
    os.replace(tmp, PROGRESO)   # de un jalón: nunca queda un JSON a medias


def anotar_verificacion(resultados: dict[str, bool]) -> None:
    """Una corrida de verificar.py: la fecha y qué checks pasaron y cuáles no."""
    try:
        p = _leer()
        v = p.setdefault("verificaciones", [])
        v.append({"fecha": ahora(), "pasan": [k for k, ok in resultados.items() if ok], "fallan": [k for k, ok in resultados.items() if not ok]})
        del v[:-MAX_VERIFICACIONES]
        _escribir(p)
    except Exception as e:  # noqa: BLE001 — el registro nunca tumba la verificación
        print(f"  (no se pudo anotar en taller/progreso.json: {e})")


def anotar_falla(falla: str, inicio: str, mostrada: bool, rendido: bool) -> None:
    """Una falla cerrada con romper.py --verificar (arreglada) o --revelar (te rendiste), con sus minutos reales."""
    try:
        p = _leer()
        fin = ahora()
        minutos = (datetime.fromisoformat(fin) - datetime.fromisoformat(inicio)).total_seconds() / 60
        r = p.setdefault("rondas", {}).setdefault(RONDA_DE_ROMPER[bool(mostrada)], {"estado": "pendiente", "fallas": []})
        r.setdefault("fallas", []).append({"id": falla, "inicio": local(inicio), "fin": fin, "minutos": round(minutos, 1),
                                           "pistas": 0, "rendido": rendido, "aprendi": ""})
        if r.get("estado", "pendiente") == "pendiente":
            r["estado"] = "en_curso"
        _escribir(p)
    except Exception as e:  # noqa: BLE001
        print(f"  (no se pudo anotar en taller/progreso.json: {e})")
