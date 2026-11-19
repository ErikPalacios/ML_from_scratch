"""Piezas compartidas del mundo, de verificar.py y de romper.py (estación 11). No es parte de lo que escribes.

No lo leas para resolver un paso: el contrato de cada archivo está arriba de él.
"""
from __future__ import annotations

import json
import os
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import yaml

RAIZ = Path(__file__).resolve().parent.parent
MUNDO = RAIZ / "mundo"
TALLER = RAIZ / ".taller"                 # estado de romper.py
LOGS = RAIZ / "logs"                      # lo que escriben Triton, el ALB, el backend y el vigía (git lo ignora)
NODO = RAIZ / "nodo"                      # el disco de cada nodo: /var/log, los buffers de Fluent Bit (git lo ignora)
DESCUBRIMIENTO = NODO / "descubrimiento"  # lo que «la API de Kubernetes» le dice a Prometheus (file_sd)
FOTOS = MUNDO / "fotos"
PLATAFORMA_YAML = MUNDO / "plataforma.yaml"
CALLERS_JSON = MUNDO / "callers.json"     # el proveedor de identidad: los callers y la llave con que firman sus tokens
OBS = RAIZ / "observabilidad"

ALB = "http://localhost:8950"             # la entrada: lo único que ven los callers
ALB_METRICAS = "http://localhost:8957"    # lo que en C01 publica el ALB en CloudWatch
TRITON = "http://localhost:8955"
VIGIA = "http://localhost:8956"
S3, LLAVE, SECRETO = "http://localhost:9950", "taller", "taller-secreto"
PROMETHEUS = "http://localhost:9952"
FLUENT = {"a": "http://localhost:9953", "b": "http://localhost:9954"}
BUCKET = "ml-datos"
CRUDO, PREDICCIONES = "logs/crudo/", "logs/predicciones/"
NS = "classifier"


def plataforma() -> dict:
    return yaml.safe_load(PLATAFORMA_YAML.read_text())


def pods(tipo: str | None = "gateway") -> list[dict]:
    return [p for p in plataforma()["pods"] if tipo is None or p["tipo"] == tipo]


def leer_json(p: Path, defecto=None):
    try:
        return json.loads(Path(p).read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return defecto


def escribir_json(p: Path, x) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(x, ensure_ascii=False, indent=2) + "\n")
    tmp.replace(p)


def sh(*cmd: str, check: bool = False, timeout: float = 600, cwd: Path = RAIZ, env: dict | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, check=check, timeout=timeout,
                          env={**os.environ, **(env or {})})


def git(*args: str, extra: dict | None = None) -> str:
    r = sh("git", *args, env=extra)
    return r.stdout.strip() if r.returncode == 0 else ""


def http(url: str, metodo: str = "GET", datos: bytes | None = None, headers: dict | None = None,
         timeout: float = 5) -> tuple[int, bytes, dict]:
    """(status, body, headers); status 0 si no hubo respuesta."""
    req = urllib.request.Request(url, data=datos, method=metodo, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(), {k.lower(): v for k, v in r.headers.items()}
    except urllib.error.HTTPError as e:
        return e.code, e.read(), {k.lower(): v for k, v in e.headers.items()}
    except (urllib.error.URLError, OSError, TimeoutError):
        return 0, b"", {}


def prom(consulta: str, timeout: float = 10) -> list[dict]:
    """El resultado de una consulta instantánea de PromQL (lista de {metric, value}); [] si no hay o falla."""
    st, b, _ = http(f"{PROMETHEUS}/api/v1/query?" + urllib.parse.urlencode({"query": consulta}), timeout=timeout)
    if st != 200:
        return []
    return json.loads(b)["data"]["result"]


def prom_api(ruta: str, timeout: float = 10) -> dict:
    st, b, _ = http(f"{PROMETHEUS}/api/v1/{ruta}", timeout=timeout)
    return json.loads(b) if st == 200 else {}


def s3():
    import boto3
    from botocore.config import Config
    return boto3.client("s3", endpoint_url=S3, aws_access_key_id=LLAVE, aws_secret_access_key=SECRETO,
                        region_name="us-east-1",
                        config=Config(connect_timeout=3, read_timeout=10, retries={"max_attempts": 1}))


def objetos(prefijo: str) -> list[dict]:
    c, out, tok = s3(), [], None
    while True:
        kw = {"Bucket": BUCKET, "Prefix": prefijo, **({"ContinuationToken": tok} if tok else {})}
        r = c.list_objects_v2(**kw)
        out += r.get("Contents", [])
        if not r.get("IsTruncated"):
            return out
        tok = r["NextContinuationToken"]


def en_nodo(nodo: str, codigo: str, timeout: float = 20) -> subprocess.CompletedProcess:
    """Corre un pedazo de Python dentro del contenedor de un nodo (como entrar por SSH al nodo en C01)."""
    return compose("exec", "-T", f"nodo-{nodo}", "python", "-c", codigo, timeout=timeout)


def lineas_nodo(nodo: str, patron: str, kb: int = 400) -> list[tuple[str, str]]:
    """(archivo, línea) del disco del nodo que contienen `patron`, en lo último de cada log del gateway."""
    codigo = (
        "import glob,os,json,sys\n"
        f"p={patron!r}\n"
        "out=[]\n"
        "for f in glob.glob('/var/log/pods/*/gateway/*.log'):\n"
        "  with open(f,'rb') as h:\n"
        f"    h.seek(max(0,os.path.getsize(f)-{kb * 1024}))\n"
        "    out+=[(f,l) for l in h.read().decode(errors='replace').splitlines() if p in l]\n"
        "print(json.dumps(out))\n")
    r = en_nodo(nodo, codigo)
    return [tuple(x) for x in json.loads(r.stdout)] if r.returncode == 0 and r.stdout.strip() else []


def igual_en(servicio: str, local: Path, remoto: str, segundos: float = 15) -> bool:
    """Espera a que el contenedor vea `local` igual que tu Mac (la misma sha256). Docker Desktop guarda unos segundos lo
    que ya leyó de una carpeta compartida: sin esto, un proceso podría leer un archivo a medias."""
    import hashlib
    import time

    quiero = hashlib.sha256(Path(local).read_bytes()).hexdigest()
    t0 = time.time()
    while time.time() - t0 < segundos:
        r = compose("exec", "-T", servicio, "sha256sum", remoto, timeout=20)
        if r.returncode == 0 and r.stdout.split()[:1] == [quiero]:
            return True
        time.sleep(0.5)
    return False


def docker_env() -> dict:
    """Docker en esta Mac: un DOCKER_CONFIG sin credsStore (si no, `docker pull` se cuelga en el llavero)."""
    cfg = RAIZ / ".docker"
    if not (cfg / "config.json").exists():
        cfg.mkdir(exist_ok=True)
        (cfg / "config.json").write_text("{}\n")
        plugins = Path("/Applications/Docker.app/Contents/Resources/cli-plugins")
        if plugins.is_dir() and not (cfg / "cli-plugins").exists():
            (cfg / "cli-plugins").symlink_to(plugins, target_is_directory=True)
    return {"DOCKER_CONFIG": str(cfg)}


def compose(*args: str, timeout: float = 600) -> subprocess.CompletedProcess:
    return sh("docker", "compose", *args, timeout=timeout, env=docker_env())
