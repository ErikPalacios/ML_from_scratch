"""Rutas y utilidades que comparten el mundo, verificar.py y romper.py. No es parte de tu pipeline."""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
MUNDO = RAIZ / "mundo"
MODELO = RAIZ / "modelo"
TALLER = RAIZ / ".taller"
ENV = RAIZ / "servidor.env"
LOG = TALLER / "servidor.log"
PID = TALLER / "servidor.pid"
CATALOGO = json.loads((MUNDO / "modelos.json").read_text())
LLAMA_MIN = (1, 1, 0)   # la versión con la que se probó el kit


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


def leer_env(p: Path = ENV) -> dict[str, str]:
    """servidor.env: líneas CLAVE=valor (el mismo archivo lo lee servir.sh con `source`)."""
    out = {}
    if not p.exists():
        return out
    for linea in p.read_text().splitlines():
        linea = linea.split("#", 1)[0].strip()
        if "=" in linea:
            k, v = linea.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def editar_env(clave: str, valor: str, p: Path = ENV) -> None:
    lineas, hecho = p.read_text().splitlines(), False
    for i, l in enumerate(lineas):
        if l.split("=", 1)[0].strip() == clave:
            lineas[i], hecho = f"{clave}={valor}", True
    if not hecho:
        lineas.append(f"{clave}={valor}")
    p.write_text("\n".join(lineas) + "\n")


def llama_server() -> str | None:
    return shutil.which("llama-server")


def version_llama() -> tuple[tuple[int, ...], str]:
    """(versión, línea completa) de `llama-server --version`: «version: 1.1.0 (build 12774, commit 171527522)»."""
    exe = llama_server()
    if not exe:
        return (), ""
    r = subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=30)
    linea = next((l for l in (r.stdout + r.stderr).splitlines() if l.startswith("version:")), "")
    try:
        v = tuple(int(x) for x in linea.split()[1].split("."))
    except (IndexError, ValueError):
        v = ()
    return v, linea.removeprefix("version: ")


def ruta_modelo(clave: str = "qwen3-0.6b-q8") -> Path:
    return MODELO / CATALOGO[clave]["archivo"]
