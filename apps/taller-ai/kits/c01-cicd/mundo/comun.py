"""Piezas compartidas del mundo, de verificar.py y de romper.py (estación 8). No es parte de lo que escribes.

No lo leas para resolver un paso: el contrato de cada herramienta está arriba de ella.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
# Dentro de un job, el código corre desde una copia limpia del repositorio; el estado del mundo (la forja, la nube)
# sigue en la carpeta del kit, y el runner la pasa en DOJO_KIT.
KIT = Path(os.environ.get("DOJO_KIT") or RAIZ)
FORJA = KIT / ".forja"                 # el «GitHub» del dojo: repositorios, PRs, corridas y sus logs (git lo ignora)
NUBE = KIT / ".nube"                   # el «AWS» del dojo: el estado de ECR y las credenciales (git lo ignora)
TALLER = KIT / ".taller"               # estado de romper.py
ORIGEN = FORJA / "classifier.git"       # el repositorio classifier, como lo tiene GitHub
DESPLIEGUE = FORJA / "despliegue.git"   # el repositorio de despliegue (GitOps): qué imagen corre en cada ambiente
CONFIANZA = KIT / "mundo" / "nube" / "confianza.json"   # las trust policies de los roles (del equipo de nube)
FORJA_YAML = KIT / "mundo" / "forja.yaml"               # reglas de la rama main y de los ambientes
REVISIONES = KIT / "mundo" / "revisiones.json"          # huellas aprobadas de la configuración de otros equipos

PROYECTO = "taller-c01-cicd"            # el proyecto de docker compose
RED = f"{PROYECTO}_default"             # la red donde viven Triton y los gateways
REGISTRO = "localhost:5800"             # el ECR del dojo
REPO_GW = "classifier-gateway"
IMAGEN_GW = f"{REGISTRO}/{REPO_GW}"
TRITON = "http://localhost:8800"
AMBIENTES = {"staging": 8801, "produccion": 8802}
REPOSITORIO = "dojo/classifier"         # el nombre del repositorio en la forja (el «owner/repo» de GitHub)
ROL_CI = "arn:aws:iam::000000000000:role/gha-classifier-gateway"
ROL_NODOS = "arn:aws:iam::000000000000:role/nodos-classifier"
PERSONA, REVISORA = "tu", "revisora"


def ahora() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def leer_json(p: Path, defecto=None):
    return json.loads(p.read_text()) if p.exists() else defecto


def escribir_json(p: Path, x) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(x, ensure_ascii=False, indent=2) + "\n")
    tmp.replace(p)


def sh(*cmd: str, check: bool = False, timeout: float = 900, cwd: Path = RAIZ, env: dict | None = None,
       entrada: str | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, check=check, timeout=timeout, input=entrada,
                          env={**os.environ, **(env or {})})


def git(*args: str, cwd: Path = RAIZ) -> str:
    r = sh("git", *args, cwd=cwd)
    return r.stdout.strip() if r.returncode == 0 else ""


def docker_env() -> dict:
    """Un DOCKER_CONFIG propio, sin credsStore (en esta Mac el llavero de Docker Desktop se puede trabar) y con buildx."""
    d = NUBE / "docker"
    d.mkdir(parents=True, exist_ok=True)
    plugins = d / "cli-plugins"
    if not plugins.exists():
        for cand in (Path.home() / ".docker" / "cli-plugins", Path("/Applications/Docker.app/Contents/Resources/cli-plugins")):
            if cand.is_dir():
                plugins.symlink_to(cand, target_is_directory=True)
                break
    cfg = d / "config.json"
    if not cfg.exists() or "credsStore" in cfg.read_text():
        cfg.write_text('{"auths": {}}\n')
    env = {"DOCKER_CONFIG": str(d), "PATH": path_sin_llavero()}
    host = docker_host()
    if host:
        env["DOCKER_HOST"] = host
    return env


def path_sin_llavero() -> str:
    """Un PATH con docker pero sin sus ayudantes de credenciales (docker-credential-osxkeychain/desktop): sin ellos,
    `docker login` guarda la credencial en el config.json de DOCKER_CONFIG, como en un runner de Linux, y no en el
    llavero de la Mac."""
    import shutil
    b = NUBE / "bin"
    b.mkdir(parents=True, exist_ok=True)
    if not (b / "docker").exists():
        real = shutil.which("docker") or "/usr/local/bin/docker"
        (b / "docker").symlink_to(Path(real).resolve())
    venv = KIT / ".venv" / "bin"
    return f"{venv}:{b}:/usr/bin:/bin:/usr/sbin:/sbin"


_HOST: list = []


def docker_host() -> str:
    if not _HOST:
        r = subprocess.run(["docker", "context", "inspect", "--format", "{{.Endpoints.docker.Host}}"],
                           capture_output=True, text=True)
        _HOST.append(r.stdout.strip() if r.returncode == 0 else os.environ.get("DOCKER_HOST", ""))
    return _HOST[0]


def docker(*args: str, check: bool = False, timeout: float = 900, env: dict | None = None) -> subprocess.CompletedProcess:
    return sh("docker", *args, check=check, timeout=timeout, env={**docker_env(), **(env or {})})


def http(url: str, metodo: str = "GET", datos: bytes | None = None, headers: dict | None = None, timeout: float = 5):
    """(status, body). status 0 = no contestó."""
    req = urllib.request.Request(url, data=datos, method=metodo, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except Exception:
        return 0, b""


def esperar(url: str, segundos: float = 30, ok=(200,)) -> bool:
    fin = time.time() + segundos
    while time.time() < fin:
        if http(url, timeout=2)[0] in ok:
            return True
        time.sleep(0.3)
    return False


def corto(digest: str) -> str:
    return digest.split(":")[-1][:12] if digest else "—"


def leer_despliegue(ambiente: str, ref: str = "main") -> dict:
    """Lo que dice el repositorio de despliegue para un ambiente, en un commit (por omisión, el último de main)."""
    import yaml
    r = sh("git", f"--git-dir={DESPLIEGUE}", "show", f"{ref}:{ambiente}/gateway.yaml")
    return yaml.safe_load(r.stdout) or {} if r.returncode == 0 else {}


def historia_despliegue(ambiente: str, n: int = 20) -> list[tuple[str, str]]:
    """[(commit, imagen)] del ambiente, del más nuevo al más viejo."""
    salida = git(f"--git-dir={DESPLIEGUE}", "log", f"-{n}", "--format=%h", "--", f"{ambiente}/gateway.yaml")
    return [(c, leer_despliegue(ambiente, c).get("imagen", "")) for c in salida.split()]


def valida_revision(p: Path) -> bool:
    """¿La versión actual de un archivo de otro equipo es una que se aprobó en una revisión?"""
    rev = leer_json(REVISIONES, {})
    clave = str(p.relative_to(KIT))
    return sha256(p.read_bytes()) in {r["sha256"] for r in rev.get(clave, [])}


def huella_revisada(p: Path, motivo: str) -> None:
    rev = leer_json(REVISIONES, {})
    clave = str(p.relative_to(KIT))
    h = sha256(p.read_bytes())
    if h not in {r["sha256"] for r in rev.get(clave, [])}:
        rev.setdefault(clave, []).append({"sha256": h, "motivo": motivo})
    escribir_json(REVISIONES, rev)


def es_digest(ref: str) -> bool:
    return bool(re.search(r"@sha256:[0-9a-f]{64}$", ref or ""))
