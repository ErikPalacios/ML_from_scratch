"""El ECR del dojo: un proxy delante de registry:2. Corre en su contenedor (`ecr` en compose.yaml) en localhost:5800.

No es parte de lo que escribes y no lo leas para resolver un paso: se porta como Amazon ECR en lo que la estación usa.

Lo que hace igual que ECR:
- Un repositorio existe solo si se creó (`python mundo/nube.py ecr crear-repo …`); un push a otro nombre falla.
- Pide credenciales en cada request (también para bajar). La contraseña la da `python mundo/nube.py ecr
  get-login-password` (usuario AWS) y vence; cada rol tiene sus permisos: el del CI sube y baja, el de los nodos solo baja.
- Tags inmutables por repositorio: si el tag ya nombra otro contenido, el push del manifest se rechaza con el mensaje
  de ECR (ImageTagAlreadyExistsException). El mismo contenido con el mismo tag pasa (ECR puede contestar
  ImageAlreadyExistsException: «no hubo cambios»).
- Anota cada push con tag (repositorio, tag, digest, fecha y rol) en .nube/empujes.json: de ahí salen la fecha de push
  y las imágenes sin tag que usa la regla de retención.
Lo distinto: el registro de abajo es registry:2 sin TLS (localhost), y el escaneo y la retención los hace
`mundo/nube.py` (en ECR son parte del servicio).
"""
import base64
import hashlib
import hmac
import json
import os
import re
import time
from pathlib import Path

import httpx
from starlette.applications import Starlette
from starlette.responses import JSONResponse, Response, StreamingResponse
from starlette.routing import Route

ARRIBA = os.environ.get("REGISTRO_ABAJO", "http://registro:5000")
NUBE = Path(os.environ.get("NUBE", "/nube"))
cliente = httpx.AsyncClient(timeout=None)


def error(status: int, code: str, msg: str, **headers) -> Response:
    return JSONResponse({"errors": [{"code": code, "message": msg}]}, status, headers=headers)


def config() -> dict:
    try:
        return json.loads((NUBE / "ecr.json").read_text())
    except FileNotFoundError:
        return {"repos": {}}


def credencial(req) -> dict | Response:
    """Revisa el header Authorization: Basic AWS:<token firmado por nube.py>."""
    h = req.headers.get("authorization", "")
    falta = error(401, "UNAUTHORIZED", "authentication required", **{"WWW-Authenticate": 'Basic realm="ECR del dojo"'})
    if not h.lower().startswith("basic "):
        return falta
    try:
        usuario, token = base64.b64decode(h[6:]).decode().split(":", 1)
        cuerpo, firma = token.rsplit(".", 1)
        secreto = (NUBE / "secreto").read_bytes()
        bien = hmac.compare_digest(firma, hmac.new(secreto, cuerpo.encode(), hashlib.sha256).hexdigest())
        claims = json.loads(base64.urlsafe_b64decode(cuerpo + "=="))
    except Exception:
        return falta
    if usuario != "AWS" or not bien:
        return falta
    if claims["vence"] < time.time():
        return error(403, "DENIED", "Your authorization token has expired. Reauthenticate and try again.")
    return claims


def anotar(repo: str, tag: str, digest: str, rol: str) -> None:
    p = NUBE / "empujes.json"
    try:
        datos = json.loads(p.read_text())
    except FileNotFoundError:
        datos = []
    datos.append({"repo": repo, "tag": tag, "digest": digest, "fecha": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "rol": rol})
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(datos, indent=1) + "\n")
    tmp.replace(p)


async def todo(req):
    ruta, q = req.url.path, req.url.query
    c = credencial(req)
    if isinstance(c, Response):
        return c
    if ruta in ("/v2/", "/v2"):
        return JSONResponse({}, headers={"Docker-Distribution-API-Version": "registry/2.0"})
    m = re.match(r"^/v2/(.+?)/(manifests|blobs|tags)/(.*)$", ruta)
    if not m:
        return error(404, "NAME_UNKNOWN", "not found")
    repo, tipo, ref = m.groups()
    repos = config()["repos"]
    if repo not in repos:
        return error(404, "NAME_UNKNOWN", f"The repository with name '{repo}' does not exist in the registry with id '000000000000'")
    escribe = req.method in ("POST", "PUT", "PATCH", "DELETE")
    accion = ("borrar" if req.method == "DELETE" else "subir") if escribe else "bajar"
    if accion not in c.get("permisos", {}).get(repo, []):
        return error(403, "DENIED", f"User: {c['rol']} is not authorized to perform: ecr:{ {'bajar': 'BatchGetImage', 'subir': 'PutImage', 'borrar': 'BatchDeleteImage'}[accion]} on resource: {repo}")
    cabeceras = [(k, v) for k, v in req.headers.items() if k.lower() not in ("host", "authorization", "content-length")]
    url = ARRIBA + ruta + ("?" + q if q else "")
    if req.method == "PUT" and tipo == "manifests":
        cuerpo = await req.body()
        digest = "sha256:" + hashlib.sha256(cuerpo).hexdigest()
        es_tag = not ref.startswith("sha256:")
        if es_tag and repos[repo].get("inmutable"):
            r = await cliente.head(ARRIBA + ruta, headers={"Accept": req.headers.get("content-type", "*/*")})
            antes = r.headers.get("docker-content-digest")
            if r.status_code == 200 and antes != digest:
                return error(400, "TAG_INVALID", f"The image tag '{ref}' already exists in the '{repo}' repository and cannot be overwritten because the repository is immutable.")
        r = await cliente.put(url, headers=cabeceras, content=cuerpo)
        if r.status_code < 300 and es_tag:
            anotar(repo, ref, digest, c["rol"])
        return Response(r.content, r.status_code, headers={k: v for k, v in r.headers.items() if k.lower() not in ("content-length", "transfer-encoding", "connection")})
    arriba = cliente.build_request(req.method, url, headers=cabeceras, content=req.stream() if escribe else None)
    r = await cliente.send(arriba, stream=True)
    h = {k: v for k, v in r.headers.items() if k.lower() not in ("transfer-encoding", "connection")}
    if "location" in h:
        h["location"] = re.sub(r"^https?://[^/]+", "", h["location"])
    return StreamingResponse(r.aiter_raw(), r.status_code, headers=h)


app = Starlette(routes=[Route("/{p:path}", todo, methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"])])
