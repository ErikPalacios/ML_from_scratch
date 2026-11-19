"""Piezas compartidas del mundo, de verificar.py, de romper.py y de tus jobs (estación 12). No es parte de lo que
escribes, pero tus jobs usan s3(), descargar(), etiquetas() y las constantes de abajo.

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
LOGS = RAIZ / "logs"                      # lo que escriben los procesos de tu Mac (git lo ignora)
NODO = RAIZ / "nodo"                      # lo que comparten tu Mac y los contenedores (git lo ignora)
CACHE = NODO / "cache"                    # copias locales de los Parquet de S3 (descargar() las reusa)
FOTOS = MUNDO / "fotos"
PLATAFORMA_YAML = MUNDO / "plataforma.yaml"
MODELO_JSON = RAIZ / "servir" / "modelo.json"
OBS = RAIZ / "observabilidad"

S3, LLAVE, SECRETO = "http://localhost:9960", "taller", "taller-secreto"
PROMETHEUS = "http://localhost:9962"
ALERTMANAGER = "http://localhost:9963"
PUSHGATEWAY = "http://localhost:9964"
BUSCAPERSONAS = "http://localhost:8966"
TRITON = "http://localhost:8965"
PODS = {"a": "http://localhost:8961", "b": "http://localhost:8962"}
BUCKET = "ml-datos"
PREDICCIONES = "logs/predicciones/"       # dt=AAAA-MM-DD/model_version=<v>/parte-0.parquet (el job de la estación 11)
EVENTOS = "eventos/publicaciones/"        # dt=AAAA-MM-DD/parte-0.parquet (el backend de publicaciones)
MONITOREO = "monitoreo/diario/"           # dt=AAAA-MM-DD/resumen.json (lo escribe tu job)
ETIQUETADO = "etiquetado/"                # cola-AAAA-MM/tareas.json (lo escribe tu muestras.py; lo lee la estación 1)
NS = "classifier"


def plataforma() -> dict:
    return yaml.safe_load(PLATAFORMA_YAML.read_text())


def ayer():
    """El último día completo del mundo (UTC): el día anterior a cuando nació (mundo/crear.py). Si pasa la medianoche
    mientras trabajas, el mundo no se mueve: tus jobs siguen sobre el mismo «ayer»."""
    from datetime import date, datetime, timedelta, timezone

    m = leer_json(NODO / "historia" / "mundo.json")
    hoy = date.fromisoformat(m["hoy"]) if m else datetime.now(timezone.utc).date()
    return hoy - timedelta(days=1)


def examen() -> str:
    """Dónde está la lista de fotos del examen fijo (sha256 completos, una por línea): mundo/plataforma.yaml."""
    return plataforma()["examen"]


def etiquetas() -> list[str]:
    """Las 10 categorías del modelo, en el orden de sus índices (el top1 del Parquet es un índice de esta lista)."""
    return json.loads(MODELO_JSON.read_text())["labels"]


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


def prom1(consulta: str, defecto: float | None = None) -> float | None:
    """El primer valor de una consulta, como número (o `defecto` si no hay)."""
    r = prom(consulta)
    return float(r[0]["value"][1]) if r else defecto


def prom_api(ruta: str, timeout: float = 10) -> dict:
    st, b, _ = http(f"{PROMETHEUS}/api/v1/{ruta}", timeout=timeout)
    return json.loads(b) if st == 200 else {}


def s3():
    """Un cliente de S3. Usa AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY si están (así corre el job programado, con su
    propia cuenta: mundo/cron.py), y si no, las credenciales del dojo."""
    import boto3
    from botocore.config import Config
    return boto3.client("s3", endpoint_url=S3, aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID", LLAVE),
                        aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY", SECRETO), region_name="us-east-1",
                        config=Config(connect_timeout=3, read_timeout=20, retries={"max_attempts": 1}))


def objetos(prefijo: str, cliente=None) -> list[dict]:
    c, out, tok = cliente or s3(), [], None
    while True:
        kw = {"Bucket": BUCKET, "Prefix": prefijo, **({"ContinuationToken": tok} if tok else {})}
        r = c.list_objects_v2(**kw)
        out += r.get("Contents", [])
        if not r.get("IsTruncated"):
            return out
        tok = r["NextContinuationToken"]


def descargar(prefijo: str, cliente=None) -> list[Path]:
    """Baja (o reusa de nodo/cache/) todos los objetos bajo `prefijo` y devuelve sus rutas locales. Reusa la copia si
    S3 dice el mismo ETag: correr el job para muchos días no vuelve a bajar lo mismo."""
    c = cliente or s3()
    out = []
    for o in objetos(prefijo, c):
        local = CACHE / o["Key"]
        marca = local.with_name(local.name + ".etag")
        if not (local.exists() and marca.exists() and marca.read_text() == o["ETag"]):
            local.parent.mkdir(parents=True, exist_ok=True)
            c.download_file(BUCKET, o["Key"], str(local))
            marca.write_text(o["ETag"])
        out.append(local)
    return out


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


def promtool(*args: str, montajes: dict[str, str] | None = None, timeout: float = 300) -> subprocess.CompletedProcess:
    """promtool en un contenedor nuevo (la imagen de Prometheus lo trae). `montajes`: {carpeta de tu Mac: ruta adentro}.
    Un contenedor nuevo ve el archivo como está ahora (no el que leyó hace rato un contenedor que ya corría)."""
    v = []
    for local, adentro in (montajes or {str(OBS): "/o"}).items():
        v += ["-v", f"{local}:{adentro}:ro"]
    return sh("docker", "run", "--rm", *v, "--entrypoint", "promtool", "prom/prometheus:v3.15.1", *args,
              timeout=timeout, env=docker_env())


def amtool(*args: str, timeout: float = 120) -> subprocess.CompletedProcess:
    """amtool en un contenedor nuevo, con observabilidad/ y lo de plataforma montados donde los ve Alertmanager."""
    return sh("docker", "run", "--rm", "-v", f"{OBS}:/etc/alertmanager/dojo:ro",
              "-v", f"{MUNDO / 'alertmanager'}:/etc/alertmanager/plataforma:ro", "--entrypoint", "amtool",
              "prom/alertmanager:v0.34.2", *args, timeout=timeout, env=docker_env())


def igual_en(servicio: str, local: Path, remoto: str, segundos: float = 15) -> bool:
    """Espera a que el contenedor vea `local` igual que tu Mac (la misma sha256). Docker Desktop guarda unos segundos lo
    que ya leyó de una carpeta compartida: sin esto, un proceso podría leer un archivo a medias (estación 11)."""
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
