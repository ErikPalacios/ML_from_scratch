"""Revisa los criterios de «listo» de la estación, uno por check. Solo lee: no cambia nada.

    python3 verificar.py                  # todos
    python3 verificar.py deps gateway     # algunos

Solo usa la biblioteca estándar y el CLI de Docker: no necesita entorno virtual.
"""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mundo.comun import (ESPERADO, FLORES, GATEWAY, IMG_GW, IMG_MS, MODELO, MODELO_SHA, RAIZ, REGISTRY,  # noqa: E402
                         compose_json, contexto, humano, imagen, sh, sha256)

MAX_CONTEXTO = 1_000_000   # 1 MB: con lo que copian los Dockerfiles alcanza de sobra


class Falla(Exception):
    pass


def exige(cond: bool, msg: str) -> None:
    if not cond:
        raise Falla(msg)


def http(url: str, datos: dict | None = None, metodo: str | None = None, headers: dict | None = None):
    req = urllib.request.Request(url, data=json.dumps(datos).encode() if datos else None, method=metodo,
                                 headers={"Content-Type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, r.read().decode(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(), dict(e.headers)


def dockerfile(p: Path) -> list[str]:
    exige(p.exists(), f"no existe {p.relative_to(RAIZ)}")
    lineas = [l.strip() for l in p.read_text().splitlines() if l.strip() and not l.strip().startswith("#")]
    exige(any(l.upper().startswith("FROM ") for l in lineas), f"{p.relative_to(RAIZ)} todavía no tiene un FROM")
    return lineas


def primera(lineas: list[str], rx: str) -> int:
    return next((i for i, l in enumerate(lineas) if re.match(rx, l, re.I)), -1)


def cmd_exec(lineas: list[str], quien: str) -> list[str]:
    cmd = [l for l in lineas if l.upper().startswith("CMD")]
    exige(cmd, f"{quien}: falta el CMD")
    texto = cmd[-1][3:].strip()
    exige(texto.startswith("["), f"{quien}: el CMD está en forma shell; en forma exec (con corchetes) uvicorn es el PID 1 y recibe SIGTERM")
    return json.loads(texto)


# ---------------------------------------------------------------- checks
def check_mundo() -> str:
    r = sh("docker", "version", "--format", "{{.Server.Version}}")
    exige(r.returncode == 0, "Docker no responde: abre Docker Desktop")
    exige(MODELO.exists(), "falta model_repository/iris/1/model.onnx")
    exige(sh("uv", "--version").returncode == 0, "falta uv: brew install uv (o curl -LsSf https://astral.sh/uv/install.sh | sh)")
    return f"Docker {r.stdout.strip()}, uv y el modelo en su lugar"


def check_deps() -> str:
    paquetes = {}
    for srv in ("gateway", "model_server"):
        p = RAIZ / srv / "requirements.txt"
        exige(p.exists(), f"falta {srv}/requirements.txt: sale de requirements.in con uv pip compile")
        lineas = [l.split("#")[0].strip() for l in p.read_text().splitlines()]
        lineas = [l for l in lineas if l and not l.startswith("-")]
        sueltas = [l for l in lineas if "==" not in l]
        exige(not sueltas, f"{srv}/requirements.txt tiene paquetes sin versión fija: {sueltas[:3]}")
        nombres = {re.split(r"[=\[;]", l)[0].strip().lower() for l in lineas}
        paquetes[srv] = (len(lineas), nombres)
    gw, ms = paquetes["gateway"][1], paquetes["model_server"][1]
    for n in ("fastapi", "uvicorn", "httpx"):
        exige(n in gw, f"al gateway le falta {n}")
    for n in ("fastapi", "uvicorn", "onnxruntime", "numpy"):
        exige(n in ms, f"al model server le falta {n}")
    sobra = gw & {"onnxruntime", "numpy", "torch"}
    exige(not sobra, f"el gateway no carga el modelo: le sobra {sorted(sobra)}")
    return f"gateway {paquetes['gateway'][0]} paquetes · model server {paquetes['model_server'][0]}, todos fijados"


def check_contexto() -> str:
    out = []
    for nombre, raiz, ignore in (("gateway", RAIZ / "gateway", RAIZ / "gateway" / ".dockerignore"),
                                 ("model server", RAIZ, RAIZ / "model_server" / "Dockerfile.dockerignore")):
        n, b, grandes = contexto(raiz, ignore)
        exige(b <= MAX_CONTEXTO, f"{nombre}: el build context pesa {humano(b)} ({n} archivos)"
              + (f"; lo más pesado: {', '.join(grandes[:3])}" if grandes else "") + ". Revisa su .dockerignore")
        out.append(f"{nombre} {n} archivos, {humano(b)}")
    return " · ".join(out)


def check_gateway() -> str:
    L = dockerfile(RAIZ / "gateway" / "Dockerfile")
    i_req, i_pip, i_app = primera(L, r"COPY .*requirements\.txt"), primera(L, r"RUN .*pip install"), primera(L, r"COPY .*app\.py")
    exige(i_req >= 0 and i_pip >= 0 and i_app >= 0, "el Dockerfile del gateway debe copiar requirements.txt, instalar y copiar app.py")
    exige(i_req < i_pip < i_app, "el orden importa para la caché: copia requirements.txt e instala ANTES de copiar app.py")
    cmd = cmd_exec(L, "gateway")
    exige("0.0.0.0" in cmd, "gateway: uvicorn tiene que escuchar en 0.0.0.0; con 127.0.0.1 nadie de fuera del contenedor entra")
    exige(imagen(IMG_GW), f"no existe la imagen {IMG_GW}: docker build -t {IMG_GW} gateway")
    dentro = sh("docker", "run", "--rm", "--entrypoint", "python", IMG_GW, "-c",
                "import hashlib;print(hashlib.sha256(open('/app/app.py','rb').read()).hexdigest())").stdout.strip()
    exige(dentro == sha256(RAIZ / "gateway" / "app.py"), f"el app.py dentro de {IMG_GW} no es el de gateway/: vuelve a construirla")
    uid = sh("docker", "run", "--rm", "--entrypoint", "id", IMG_GW, "-u").stdout.strip()
    exige(uid and uid != "0", f"{IMG_GW} corre como root (uid {uid or '?'}): agrega un usuario y USER")
    mb = imagen(IMG_GW)["Size"] / 1e6
    return f"{IMG_GW}: uid {uid}, CMD en forma exec en 0.0.0.0, caché bien ordenada · {mb:.0f} MB comprimida"


def check_model_server() -> str:
    exige(sha256(MODELO) == MODELO_SHA, "model_repository/iris/1/model.onnx no es el modelo bueno (sha256 distinto)")
    L = dockerfile(RAIZ / "model_server" / "Dockerfile")
    cmd = cmd_exec(L, "model server")
    exige("0.0.0.0" in cmd, "model server: uvicorn tiene que escuchar en 0.0.0.0")
    users = [l for l in L if l.upper().startswith("USER ")]
    exige(users and re.match(r"USER\s+[1-9]\d*(:\d+)?$", users[-1], re.I), "model server: USER con un UID numérico distinto de 0 (Kubernetes lo puede verificar)")
    exige(imagen(IMG_MS), f"no existe la imagen {IMG_MS}: docker build -f model_server/Dockerfile -t {IMG_MS} .")
    dentro = sh("docker", "run", "--rm", "--entrypoint", "python", IMG_MS, "-c",
                "import hashlib;print(hashlib.sha256(open('/models/iris/1/model.onnx','rb').read()).hexdigest())")
    exige(dentro.returncode == 0, f"{IMG_MS} no trae /models/iris/1/model.onnx")
    exige(dentro.stdout.strip() == MODELO_SHA, f"el modelo dentro de {IMG_MS} no es el bueno: reconstruye la imagen")
    uid = sh("docker", "run", "--rm", "--entrypoint", "id", IMG_MS, "-u").stdout.strip()
    mb = imagen(IMG_MS)["Size"] / 1e6
    return f"{IMG_MS}: modelo bueno dentro (/models), uid {uid} · {mb:.0f} MB comprimida"


def check_red() -> str:
    servicios = {c.get("Service"): c for c in compose_json()}
    exige(servicios, "no hay contenedores del proyecto de compose: docker compose up -d")
    for s in ("model-server", "gateway"):
        exige(s in servicios, f"falta el servicio {s} en compose.yaml")
        exige(servicios[s].get("State") == "running", f"{s} no está corriendo ({servicios[s].get('State')}): docker compose ps y docker compose logs {s}")
    publicado = [x for x in servicios["gateway"].get("Publishers") or [] if x.get("PublishedPort")]
    exige(publicado, "el gateway corre pero sin el puerto publicado (8080/tcp): se creó cuando el puerto estaba ocupado; "
                     "recréalo con docker compose up -d --force-recreate gateway")
    cfg = json.loads(sh("docker", "compose", "config", "--format", "json").stdout or "{}")
    gw = cfg.get("services", {}).get("gateway", {})
    exige(gw.get("environment", {}).get("MODEL_SERVER_URL"), "el gateway no recibe MODEL_SERVER_URL: usa env_file: config.env")
    for intento in range(10):   # si el gateway acaba de arrancar, dale unos segundos
        try:
            st, body, _ = http(GATEWAY + "/readyz")
            break
        except Exception as e:
            if intento == 9:
                raise Falla(f"el gateway no contesta en {GATEWAY}: {type(e).__name__}")
            time.sleep(1)
    exige(st == 200, f"/readyz del gateway da {st}: {body[:160]}")
    st, body, _ = http(GATEWAY + "/v1/predict", FLORES)
    exige(st == 200, f"/v1/predict da {st}: {body[:160]}")
    etiquetas = [p["label"] for p in json.loads(body)["predictions"]]
    exige(etiquetas == ESPERADO, f"las 3 flores salen {etiquetas}; se esperaba {ESPERADO}")
    return f"gateway → model-server por nombre: /readyz 200 y las 3 flores bien ({', '.join(etiquetas)})"


def check_salud() -> str:
    cfg = json.loads(sh("docker", "compose", "config", "--format", "json").stdout or "{}").get("services", {})
    ms, gw = cfg.get("model-server", {}), cfg.get("gateway", {})
    exige(ms.get("healthcheck", {}).get("test"), "el model server no tiene healthcheck en compose.yaml")
    cond = gw.get("depends_on", {}).get("model-server", {}).get("condition")
    exige(cond == "service_healthy", f"el gateway debe esperar a que el model server esté sano (condition: service_healthy; ahora: {cond})")
    estado = {c.get("Service"): c.get("Health") for c in compose_json()}
    exige(estado.get("model-server") == "healthy", f"el model server está «{estado.get('model-server') or 'sin estado'}», no healthy")
    return "model server healthy y el gateway espera a service_healthy"


def check_exec() -> str:
    out = []
    for ref in (IMG_GW, IMG_MS):
        im = imagen(ref)
        exige(im, f"no existe {ref}")
        cmd, ep = im["Config"].get("Cmd") or [], im["Config"].get("Entrypoint") or []
        exige(cmd[:2] != ["/bin/sh", "-c"] and ep[:2] != ["/bin/sh", "-c"],
              f"{ref}: el CMD quedó en forma shell (/bin/sh -c …): sh no reenvía SIGTERM y docker stop espera 10 s para matar")
        out.append(f"{ref.split(':')[0]} PID 1 = {(ep + cmd)[0]}")
    return " · ".join(out)


def check_registry() -> str:
    try:
        st, _, _ = http(f"http://{REGISTRY}/v2/")
    except Exception as e:
        raise Falla(f"el registry no responde en {REGISTRY}: {type(e).__name__}. ¿Está corriendo el contenedor registry?")
    exige(st == 200, f"el registry contesta {st} en /v2/")
    out = []
    for ref in (IMG_GW, IMG_MS):
        repo, tag = ref.split(":")
        st, body, h = http(f"http://{REGISTRY}/v2/{repo}/manifests/{tag}", metodo="HEAD", headers={"Accept": ", ".join([
            "application/vnd.oci.image.index.v1+json", "application/vnd.docker.distribution.manifest.list.v2+json",
            "application/vnd.oci.image.manifest.v1+json", "application/vnd.docker.distribution.manifest.v2+json"])})
        exige(st == 200, f"{REGISTRY}/{ref} no está en el registry: docker tag + docker push")
        remoto = {k.lower(): v for k, v in h.items()}.get("docker-content-digest", "")
        local = imagen(f"{REGISTRY}/{ref}")
        exige(local, f"no tienes la etiqueta local {REGISTRY}/{ref}")
        digests = [d.split("@")[1] for d in local.get("RepoDigests", []) if d.startswith(f"{REGISTRY}/{repo}@")]
        exige(remoto in digests, f"el tag {tag} de {repo} en el registry ya no es tu imagen (digest {remoto[:19]}…; el tuyo {digests[0][:19] if digests else '?'}…)")
        out.append(f"{repo} {remoto[:19]}…")
    return "en el registry y con tu digest: " + " · ".join(out)


CHECKS = {
    "mundo": check_mundo, "deps": check_deps, "contexto": check_contexto, "gateway": check_gateway,
    "model-server": check_model_server, "exec": check_exec, "red": check_red, "salud": check_salud,
    "registry": check_registry,
}


def correr(ids: list[str], silencio: bool = False) -> dict[str, tuple[bool, str]]:
    out = {}
    for i in ids:
        try:
            ok, msg = True, CHECKS[i]()
        except Falla as e:
            ok, msg = False, str(e)
        except Exception as e:  # un error inesperado también es un check que no pasa
            ok, msg = False, f"{type(e).__name__}: {e}"
        out[i] = (ok, msg)
        if not silencio:
            print(f"{'✓' if ok else '✗'} {i:<13} {msg}")
    return out


if __name__ == "__main__":
    pedidos = sys.argv[1:] or list(CHECKS)
    desconocidos = [p for p in pedidos if p not in CHECKS]
    if desconocidos:
        sys.exit(f"checks desconocidos: {desconocidos}. Hay: {', '.join(CHECKS)}")
    r = correr(pedidos)
    malos = [k for k, (ok, _) in r.items() if not ok]
    print(f"\n{len(r) - len(malos)}/{len(r)} en verde" + (f" · falta: {', '.join(malos)}" if malos else ""))
    sys.exit(1 if malos else 0)
