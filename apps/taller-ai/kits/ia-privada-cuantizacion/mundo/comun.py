"""Rutas y utilidades que comparten el mundo, verificar.py y romper.py. No es parte de tu pipeline."""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import unicodedata
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
MUNDO = RAIZ / "mundo"
ENTRADA = MUNDO / "entrada"
MODELO = RAIZ / "modelo"
CUANTIZADOS = RAIZ / "cuantizados"
RESULTADOS = RAIZ / "resultados"
TALLER = RAIZ / ".taller"
MEDICION = RAIZ / "medicion.json"
CATALOGO = json.loads((MUNDO / "modelos.json").read_text())
LLAMA_MIN = (1, 1, 0)   # la versión con la que se probó el kit
PUERTO = 9932           # el de esta estación (la 1 usa 9931): pueden convivir


def leer_json(p: Path, defecto=None):
    try:
        return json.loads(Path(p).read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return defecto


def escribir_json(p: Path, d) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n")
    os.replace(tmp, p)


def sha256_archivo(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def sha256_texto(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def normalizar(s: str) -> str:
    """minúsculas y sin acentos: para calificar el examen."""
    return "".join(c for c in unicodedata.normalize("NFD", s.lower()) if unicodedata.category(c) != "Mn")


def herramienta(nombre: str) -> str | None:
    return shutil.which(nombre)


def version_llama() -> tuple[tuple[int, ...], str]:
    """(versión, línea completa) de `llama-server --version`: «version: 1.1.0 (build 12774, commit 171527522)»."""
    exe = herramienta("llama-server")
    if not exe:
        return (), ""
    r = subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=30)
    linea = next((l for l in (r.stdout + r.stderr).splitlines() if l.startswith("version:")), "")
    try:
        v = tuple(int(x) for x in linea.split()[1].split("."))
    except (IndexError, ValueError):
        v = ()
    return v, linea.removeprefix("version: ")


def ruta_modelo(clave: str = "qwen3-0.6b-f16") -> Path:
    return MODELO / CATALOGO[clave]["archivo"]


def medicion() -> dict:
    return leer_json(MEDICION, {})
