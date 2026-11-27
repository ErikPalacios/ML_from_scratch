"""Rutas y utilidades que comparten el mundo, verificar.py y romper.py. No es parte de tu pipeline."""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import urllib.error
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
MUNDO = RAIZ / "mundo"
TALLER = RAIZ / ".taller"
RESULTADOS = RAIZ / "resultados"
ENV = RAIZ / "servidor.env"
GPU_ENV = RAIZ / "gpu.env"
LOG = TALLER / "servidor.log"
PID = TALLER / "servidor.pid"
MODELOS = json.loads((MUNDO / "modelos.json").read_text())
GPUS = json.loads((MUNDO / "gpus.json").read_text())
VLLM_VERSION = "0.34.0"   # la versión con la que se escribió el kit (la del despacho)


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


def leer_env(p: Path = ENV) -> dict[str, str]:
    """servidor.env y gpu.env: líneas CLAVE=valor (servir.sh lee servidor.env con `source`)."""
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


def vllm_real() -> str | None:
    """El vLLM de verdad, si está instalado (en la GPU rentada). En la Mac no hay: se usa el del dojo."""
    exe = shutil.which("vllm")
    return exe if exe and Path(exe).resolve() != (MUNDO / "bin" / "vllm").resolve() else None


def motor() -> tuple[str, str]:
    """(«vllm» o «simulado», la línea que lo describe)."""
    exe = vllm_real()
    if exe and not os.environ.get("DOJO_SIMULAR"):
        r = subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=120)
        v = (r.stdout.strip().splitlines() or ["?"])[-1]
        return "vllm", f"vLLM {v} (de verdad) en {exe}"
    g = GPUS["gpus"].get((leer_env(GPU_ENV).get("GPU") or "l40s").lower(), GPUS["gpus"]["l40s"])
    return "simulado", f"el vLLM del dojo (SIMULADO, imita vLLM {VLLM_VERSION} en una {g['nombre']}): sin GPU, los tiempos son la cuenta de servilleta"


def base_url() -> str:
    """La raíz del servidor (sin /v1), de LLM_URL: en tu Mac el vLLM del dojo; en la sesión de GPU, el proxy del pod."""
    e = leer_env()
    url = e.get("LLM_URL") or f"http://127.0.0.1:{e.get('PUERTO') or 8000}/v1"
    return url.rstrip("/").removesuffix("/v1")


def remoto() -> bool:
    """¿LLM_URL apunta a otra máquina (la GPU rentada) y no a esta?"""
    return not re.match(r"^http://(127\.0\.0\.1|localhost)[:/]", base_url() + "/")


def info_cache(timeout: float = 5) -> dict[str, str]:
    """Las etiquetas de vllm:cache_config_info en /metrics: block_size, num_gpu_blocks… (lo que el motor reservó)."""
    with urllib.request.urlopen(base_url() + "/metrics", timeout=timeout) as r:
        for linea in r.read().decode().splitlines():
            if linea.startswith("vllm:cache_config_info{"):
                return dict(re.findall(r'(\w+)="([^"]*)"', linea))
    return {}


def metricas(timeout: float = 5) -> dict[str, float]:
    """GET /metrics del servidor: {«vllm:num_requests_waiting»: 0.0, …}, sumando etiquetas (una sola réplica)."""
    with urllib.request.urlopen(base_url() + "/metrics", timeout=timeout) as r:
        texto = r.read().decode()
    out: dict[str, float] = {}
    for linea in texto.splitlines():
        m = re.match(r"^(vllm:[\w:]+)(?:\{[^}]*\})?\s+([-\d.eE+]+|NaN)$", linea)
        if m and "_bucket" not in m.group(1):
            out[m.group(1)] = out.get(m.group(1), 0.0) + float(m.group(2))
    return out


def peticion(ruta: str, cuerpo: dict | None = None, clave: str | None = None, timeout: float = 60) -> tuple[int, object]:
    """Una petición directa al servidor (sin tu pipeline): lo que ve cualquiera que llega al puerto."""
    h = {"Content-Type": "application/json"}
    if clave:
        h["Authorization"] = f"Bearer {clave}"
    req = urllib.request.Request(base_url() + ruta, json.dumps(cuerpo).encode() if cuerpo is not None else None, h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            datos = r.read()
            return r.status, json.loads(datos) if datos.strip() else {}
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except json.JSONDecodeError:
            return e.code, {}
