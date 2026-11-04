"""Piezas compartidas del mundo, de verificar.py y de romper.py. No es parte de lo que escribes.

Solo usa la biblioteca estándar de Python y el CLI de Docker: el kit no necesita un entorno virtual.
"""
from __future__ import annotations

import fnmatch
import hashlib
import json
import re
import subprocess
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
TALLER = RAIZ / ".taller"                 # estado de romper.py
MODELO = RAIZ / "model_repository" / "iris" / "1" / "model.onnx"
MODELO_SHA = "8b9afbe09d0d405b12a6a14e670146765f90a58b9c928d11be4e653dbd9ca53e"   # el model.onnx bueno

GATEWAY, MODEL_SERVER, REGISTRY = "http://localhost:8080", "http://localhost:9000", "localhost:5050"
IMG_GW, IMG_MS = "iris-gateway:0.1", "iris-model-server:0.1"
FLORES = {"flowers": [
    {"sepal_length": 5.1, "sepal_width": 3.5, "petal_length": 1.4, "petal_width": 0.2},
    {"sepal_length": 5.9, "sepal_width": 3.0, "petal_length": 4.2, "petal_width": 1.5},
    {"sepal_length": 6.7, "sepal_width": 3.0, "petal_length": 5.2, "petal_width": 2.3},
]}
ESPERADO = ["setosa", "versicolor", "virginica"]


def sh(*cmd: str, check: bool = False, timeout: float = 120) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=RAIZ, capture_output=True, text=True, check=check, timeout=timeout)


def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def leer_json(p: Path, defecto=None):
    return json.loads(p.read_text()) if p.exists() else defecto


def escribir_json(p: Path, x) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(x, ensure_ascii=False, indent=2))


def imagen(ref: str) -> dict | None:
    r = sh("docker", "image", "inspect", ref)
    return json.loads(r.stdout)[0] if r.returncode == 0 else None


def compose_json() -> list[dict]:
    """Los contenedores del proyecto de compose (docker compose ps), uno por servicio."""
    r = sh("docker", "compose", "ps", "--all", "--format", "json")
    if r.returncode != 0:
        return []
    t = r.stdout.strip()
    return json.loads(t) if t.startswith("[") else [json.loads(x) for x in t.splitlines() if x.strip()]


# ---------------------------------------------------------------- el build context, como lo arma Docker
def _patron(p: str) -> re.Pattern:
    """Un patrón de .dockerignore a regex: * no cruza carpetas, ** sí, ? es un carácter."""
    p = p.strip().lstrip("/").rstrip("/")
    out, i = "", 0
    while i < len(p):
        if p.startswith("**/", i):
            out += "(?:.*/)?"
            i += 3
        elif p.startswith("**", i):
            out += ".*"
            i += 2
        elif p[i] == "*":
            out += "[^/]*"
            i += 1
        elif p[i] == "?":
            out += "[^/]"
            i += 1
        else:
            out += re.escape(p[i])
            i += 1
    return re.compile(out + r"\Z")


def contexto(raiz: Path, ignore: Path | None) -> tuple[int, int, list[str]]:
    """Archivos y bytes que viajarían al builder con ese .dockerignore (la última regla que coincide gana).

    Una regla que coincide con una carpeta aplica a todo lo de adentro, como en Docker.
    """
    reglas = []
    if ignore and ignore.exists():
        for linea in ignore.read_text().splitlines():
            linea = linea.strip()
            if not linea or linea.startswith("#"):
                continue
            neg = linea.startswith("!")
            reglas.append((neg, _patron(linea[1:] if neg else linea)))
    n, total, grandes = 0, 0, []
    for f in sorted(raiz.rglob("*")):
        if not f.is_file():
            continue
        rel = f.relative_to(raiz).as_posix()
        partes = rel.split("/")
        candidatos = ["/".join(partes[: k + 1]) for k in range(len(partes))]
        fuera = False
        for neg, rx in reglas:
            if any(rx.match(c) for c in candidatos):
                fuera = not neg
        if not fuera:
            n += 1
            total += f.stat().st_size
            if f.stat().st_size > 1_000_000:
                grandes.append(rel)
    return n, total, grandes


def humano(b: int) -> str:
    for u in ("B", "kB", "MB", "GB"):
        if b < 1000:
            return f"{b:.0f} {u}" if u == "B" else f"{b:.1f} {u}"
        b /= 1000
    return f"{b:.1f} TB"


def fnmatch_any(nombre: str, patrones: list[str]) -> bool:
    return any(fnmatch.fnmatch(nombre, p) for p in patrones)
