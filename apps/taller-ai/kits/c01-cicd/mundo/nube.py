"""El «AWS» del dojo: credenciales por OIDC y el ECR del dojo (localhost:5800). Se usa; no se toca.

    python mundo/nube.py ecr get-login-password --role-arn <arn>   # dentro de un job: cambia el token OIDC del job por
                                                                     # una contraseña de ECR (usuario AWS) que vence en 12 h
    python mundo/nube.py ecr crear-repo <repo> [--inmutable]
    python mundo/nube.py ecr configurar <repo> --inmutable|--mutable # = aws ecr put-image-tag-mutability
    python mundo/nube.py ecr describir <repo>                        # tags inmutables, regla de retención, cuántas imágenes
    python mundo/nube.py ecr imagenes <repo>                         # tag, digest, fecha de push y en qué ambiente corre
    python mundo/nube.py ecr politica-retencion <repo> <archivo.json> # = aws ecr put-lifecycle-policy
    python mundo/nube.py ecr retencion <repo> --vista-previa|--aplicar # = start-lifecycle-policy-preview / la corrida diaria

Igual que AWS: la trust policy de cada rol (mundo/nube/confianza.json, del equipo de nube) dice qué tokens OIDC puede
cambiar por credenciales, comparando el claim `sub` (repo:<dueño>/<repo>:ref:refs/heads/main, :pull_request o
:environment:<nombre>) y `aud` (sts.amazonaws.com). El formato de la regla de retención es el de ECR (rules con
rulePriority, selection y action expire; ECR además tiene sinceImagePulled y el paso a archive). Distinto: el token
OIDC lo firma la forja con un secreto compartido (en GitHub, con su llave pública), y la retención corre cuando la
pides (en ECR, una imagen se borra dentro de las 24 h siguientes a cumplir la regla).
"""
from __future__ import annotations

import argparse
import base64
import fnmatch
import hashlib
import hmac
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import (AMBIENTES, CONFIANZA, NUBE, REGISTRO, corto, escribir_json, historia_despliegue,  # noqa: E402
                         http, leer_despliegue, leer_json)

SECRETO = NUBE / "secreto"
ECR = NUBE / "ecr.json"
EMPUJES = NUBE / "empujes.json"
ACEPTA = ", ".join(["application/vnd.oci.image.index.v1+json", "application/vnd.docker.distribution.manifest.list.v2+json",
                    "application/vnd.oci.image.manifest.v1+json", "application/vnd.docker.distribution.manifest.v2+json"])


# ------------------------------------------------------------------ firmas (el mismo formato para OIDC y para ECR)
def firmar(claims: dict) -> str:
    cuerpo = base64.urlsafe_b64encode(json.dumps(claims, separators=(",", ":")).encode()).decode().rstrip("=")
    return cuerpo + "." + hmac.new(SECRETO.read_bytes(), cuerpo.encode(), hashlib.sha256).hexdigest()


def leer_firmado(token: str) -> dict | None:
    try:
        cuerpo, firma = token.strip().rsplit(".", 1)
        if not hmac.compare_digest(firma, hmac.new(SECRETO.read_bytes(), cuerpo.encode(), hashlib.sha256).hexdigest()):
            return None
        return json.loads(base64.urlsafe_b64decode(cuerpo + "=="))
    except Exception:
        return None


def roles() -> dict:
    return json.loads(CONFIANZA.read_text())["roles"]


def rol_por_arn(arn: str) -> tuple[str, dict]:
    for nombre, r in roles().items():
        if r["arn"] == arn:
            return nombre, r
    sys.exit(f"An error occurred (NoSuchEntity): The role with name {arn.split('/')[-1]} cannot be found.")


def condicion_cumple(cond: dict, claims: dict) -> bool:
    for operador, pares in cond.items():
        for llave, esperado in pares.items():
            valor = claims.get(llave.split(":")[-1], "")
            opciones = esperado if isinstance(esperado, list) else [esperado]
            if operador == "StringEquals" and valor not in opciones:
                return False
            if operador == "StringLike" and not any(fnmatch.fnmatchcase(valor, o) for o in opciones):
                return False
            if operador not in ("StringEquals", "StringLike"):
                return False
    return True


def asumir_con_oidc(arn: str, token_oidc: str) -> dict:
    """sts:AssumeRoleWithWebIdentity + ecr:GetAuthorizationToken: si la trust policy del rol acepta el token, una
    contraseña de ECR que vale 12 h (en AWS, las credenciales del rol duran 1 h por omisión y la contraseña de ECR 12 h)."""
    nombre, r = rol_por_arn(arn)
    claims = leer_firmado(token_oidc)
    if not claims:
        sys.exit("An error occurred (InvalidIdentityToken): Couldn't verify the token signature")
    if claims.get("exp", 0) < time.time():
        sys.exit("An error occurred (ExpiredTokenException): Token expired")
    for st in r["trust_policy"]["Statement"]:
        if (st.get("Effect") == "Allow" and st.get("Action") == "sts:AssumeRoleWithWebIdentity"
                and condicion_cumple(st.get("Condition", {}), claims)):
            return {"rol": nombre, "permisos": r["permisos"], "vence": int(time.time()) + 12 * 3600, "sub": claims["sub"]}
    sys.exit(f"An error occurred (AccessDenied) when calling the AssumeRoleWithWebIdentity operation: "
             f"Not authorized to perform sts:AssumeRoleWithWebIdentity (sub del token: {claims.get('sub')})")


def token_interno(rol: str = "admin", segundos: int = 600) -> str:
    """Las credenciales de quien opera la nube (tú, en tu terminal; o los nodos): no pasan por OIDC."""
    if rol == "admin":
        permisos = {repo: ["bajar", "subir", "borrar"] for repo in leer_json(ECR, {"repos": {}})["repos"]}
    else:
        permisos = roles()[rol]["permisos"]
    return firmar({"rol": rol, "permisos": permisos, "vence": int(time.time()) + segundos})


def cabecera(token: str) -> dict:
    return {"Authorization": "Basic " + base64.b64encode(f"AWS:{token}".encode()).decode()}


# ------------------------------------------------------------------ el registro
def config() -> dict:
    return leer_json(ECR, {"repos": {}})


def guardar_config(c: dict) -> None:
    escribir_json(ECR, c)


def repo_o_salir(repo: str) -> dict:
    c = config()
    if repo not in c["repos"]:
        sys.exit(f"An error occurred (RepositoryNotFoundException): The repository with name '{repo}' does not exist")
    return c


def tags(repo: str, tk: str) -> list[str]:
    st, cuerpo = http(f"http://{REGISTRO}/v2/{repo}/tags/list", headers=cabecera(tk))
    if st != 200:
        return []
    return json.loads(cuerpo).get("tags") or []


def digest_de(repo: str, ref: str, tk: str) -> str | None:
    import urllib.request
    req = urllib.request.Request(f"http://{REGISTRO}/v2/{repo}/manifests/{ref}", method="HEAD",
                                 headers={**cabecera(tk), "Accept": ACEPTA})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.headers.get("Docker-Content-Digest")
    except Exception:
        return None


def imagenes(repo: str) -> list[dict]:
    """Cada imagen (un digest), con sus tags y la fecha de su último push, de la más nueva a la más vieja."""
    tk = token_interno()
    empujes = [e for e in leer_json(EMPUJES, []) if e["repo"] == repo]
    vivos: dict[str, dict] = {}
    for t in tags(repo, tk):
        d = digest_de(repo, t, tk)
        if d:
            vivos.setdefault(d, {"digest": d, "tags": [], "fecha": ""})["tags"].append(t)
    for e in empujes:                                    # la fecha de push: la última vez que se subió ese digest
        if e["digest"] in vivos:
            vivos[e["digest"]]["fecha"] = max(vivos[e["digest"]]["fecha"], e["fecha"])
        elif digest_de(repo, e["digest"], tk):            # un digest que perdió su tag: imagen sin tag
            vivos[e["digest"]] = {"digest": e["digest"], "tags": [], "fecha": e["fecha"]}
    return sorted(vivos.values(), key=lambda i: i["fecha"], reverse=True)


def en_uso() -> dict[str, str]:
    """digest → ambientes donde corre ahora (lo que dice el repositorio de despliegue)."""
    uso: dict[str, list] = {}
    for amb in AMBIENTES:
        img = leer_despliegue(amb).get("imagen", "")
        if "@" in img:
            uso.setdefault(img.split("@")[1], []).append(amb)
    return {d: ", ".join(a) for d, a in uso.items()}


def validar_politica(p: dict) -> None:
    reglas = p.get("rules")
    if not isinstance(reglas, list) or not reglas:
        sys.exit("InvalidParameterException: Lifecycle policy validation failure: 'rules' es una lista de reglas")
    prioridades = [r.get("rulePriority") for r in reglas]
    if len(set(prioridades)) != len(prioridades) or not all(isinstance(x, int) and x > 0 for x in prioridades):
        sys.exit("InvalidParameterException: cada regla lleva un rulePriority entero, positivo y único")
    for r in sorted(reglas, key=lambda r: r["rulePriority"]):
        s = r.get("selection", {})
        if s.get("tagStatus") not in ("tagged", "untagged", "any"):
            sys.exit(f"InvalidParameterException: regla {r['rulePriority']}: tagStatus es tagged, untagged o any")
        if s["tagStatus"] == "tagged" and not (s.get("tagPrefixList") or s.get("tagPatternList")):
            sys.exit(f"InvalidParameterException: regla {r['rulePriority']}: con tagStatus tagged hace falta tagPrefixList o tagPatternList")
        if s["tagStatus"] == "any" and r["rulePriority"] != max(prioridades):
            sys.exit("InvalidParameterException: la regla con tagStatus any tiene que ser la de prioridad más baja (el número más alto)")
        if s.get("countType") not in ("imageCountMoreThan", "sinceImagePushed"):
            sys.exit(f"InvalidParameterException: regla {r['rulePriority']}: countType es imageCountMoreThan o sinceImagePushed")
        if s["countType"] == "sinceImagePushed" and s.get("countUnit") != "days":
            sys.exit(f"InvalidParameterException: regla {r['rulePriority']}: con sinceImagePushed, countUnit es days")
        if not isinstance(s.get("countNumber"), int) or s["countNumber"] < 1:
            sys.exit(f"InvalidParameterException: regla {r['rulePriority']}: countNumber es un entero ≥ 1")
        if r.get("action", {}).get("type") != "expire":
            sys.exit(f"InvalidParameterException: regla {r['rulePriority']}: action.type es expire")


def evaluar_retencion(repo: str, ahora: datetime | None = None) -> list[dict]:
    """Lo que borraría la regla hoy: [{digest, tags, fecha, regla}]. Cada imagen la decide la primera regla que la toma."""
    pol = config()["repos"][repo].get("retencion")
    if not pol:
        return []
    ahora = ahora or datetime.now(timezone.utc)
    imgs = imagenes(repo)
    decididas: set[str] = set()
    borrar = []
    for r in sorted(pol["rules"], key=lambda r: r["rulePriority"]):
        s = r["selection"]

        def toma(i):
            if s["tagStatus"] == "untagged":
                return not i["tags"]
            if s["tagStatus"] == "any":
                return True
            pats = [p + "*" for p in s.get("tagPrefixList", [])] + s.get("tagPatternList", [])
            return bool(i["tags"]) and any(fnmatch.fnmatchcase(t, p) for t in i["tags"] for p in pats)
        candidatas = [i for i in imgs if i["digest"] not in decididas and toma(i)]
        if s["countType"] == "imageCountMoreThan":
            sobran = candidatas[s["countNumber"]:]
        else:
            limite = ahora - timedelta(days=s["countNumber"])
            sobran = [i for i in candidatas if datetime.fromisoformat(i["fecha"].replace("Z", "+00:00")) < limite]
        for i in candidatas:
            decididas.add(i["digest"])
        borrar += [{**i, "regla": r["rulePriority"]} for i in sobran]
    return borrar


def borrar_imagen(repo: str, digest: str) -> bool:
    st, _ = http(f"http://{REGISTRO}/v2/{repo}/manifests/{digest}", metodo="DELETE", headers=cabecera(token_interno()))
    return st == 202


# ------------------------------------------------------------------ la línea de comandos
def main() -> None:
    ap = argparse.ArgumentParser(description="El AWS del dojo (ECR y credenciales).")
    sub = ap.add_subparsers(dest="servicio", required=True)
    ecr = sub.add_parser("ecr").add_subparsers(dest="op", required=True)
    g = ecr.add_parser("get-login-password")
    g.add_argument("--role-arn", required=True)
    c = ecr.add_parser("crear-repo")
    c.add_argument("repo")
    c.add_argument("--inmutable", action="store_true")
    k = ecr.add_parser("configurar")
    k.add_argument("repo")
    m = k.add_mutually_exclusive_group(required=True)
    m.add_argument("--inmutable", action="store_true")
    m.add_argument("--mutable", action="store_true")
    for op in ("describir", "imagenes"):
        ecr.add_parser(op).add_argument("repo")
    p = ecr.add_parser("politica-retencion")
    p.add_argument("repo")
    p.add_argument("archivo")
    r = ecr.add_parser("retencion")
    r.add_argument("repo")
    m2 = r.add_mutually_exclusive_group(required=True)
    m2.add_argument("--vista-previa", action="store_true")
    m2.add_argument("--aplicar", action="store_true")
    a = ap.parse_args()

    if a.op == "get-login-password":
        token = os.environ.get("DOJO_OIDC_TOKEN")
        if not token:
            sys.exit("Error: no hay token de identidad (DOJO_OIDC_TOKEN). En la forja, el job lo recibe solo si pide "
                     "permissions: id-token: write.")
        cred = asumir_con_oidc(a.role_arn, token)
        print(firmar(cred))
        print(f"rol {cred['rol']} asumido para {cred['sub']} · la contraseña de ECR vence en 12 h", file=sys.stderr)
        return
    if a.op == "crear-repo":
        cfg = config()
        if a.repo in cfg["repos"]:
            sys.exit(f"An error occurred (RepositoryAlreadyExistsException): The repository with name '{a.repo}' already exists")
        cfg["repos"][a.repo] = {"inmutable": a.inmutable, "retencion": None}
        guardar_config(cfg)
        print(f"repositorio {REGISTRO}/{a.repo} · tags {'inmutables' if a.inmutable else 'que se pueden mover'}")
        return
    cfg = repo_o_salir(a.repo)
    rc = cfg["repos"][a.repo]
    if a.op == "configurar":
        rc["inmutable"] = bool(a.inmutable)
        guardar_config(cfg)
        print(f"{a.repo}: imageTagMutability = {'IMMUTABLE' if a.inmutable else 'MUTABLE'}")
    elif a.op == "describir":
        n = len(imagenes(a.repo))
        print(f"{REGISTRO}/{a.repo}")
        print(f"  tags: {'IMMUTABLE (un tag nunca cambia de contenido)' if rc['inmutable'] else 'MUTABLE (un push puede mover un tag)'}")
        print(f"  imágenes: {n}")
        print(f"  regla de retención: {json.dumps(rc['retencion'], ensure_ascii=False) if rc['retencion'] else 'ninguna'}")
    elif a.op == "imagenes":
        uso = en_uso()
        print(f"{'tag':<12} {'digest':<14} {'push (UTC)':<21} en uso")
        for i in imagenes(a.repo):
            print(f"{(', '.join(i['tags']) or '<sin tag>'):<12} {corto(i['digest']):<14} {i['fecha']:<21} {uso.get(i['digest'], '')}")
    elif a.op == "politica-retencion":
        pol = json.loads(Path(a.archivo).read_text())
        validar_politica(pol)
        rc["retencion"] = pol
        guardar_config(cfg)
        print(f"{a.repo}: regla de retención guardada ({len(pol['rules'])} reglas). ECR la aplica sola (dentro de las 24 h en que una imagen cumple la regla); mira qué haría "
              f"con: python mundo/nube.py ecr retencion {a.repo} --vista-previa")
    elif a.op == "retencion":
        if not rc["retencion"]:
            sys.exit(f"LifecyclePolicyNotFoundException: {a.repo} no tiene regla de retención")
        borrar = evaluar_retencion(a.repo)
        uso = en_uso()
        total = len(imagenes(a.repo))
        print(f"{'vista previa' if a.vista_previa else 'corrida'}: {len(borrar)} de {total} imágenes {'se borrarían' if a.vista_previa else 'borradas'}")
        for i in borrar:
            aviso = f"  ← CORRE EN {uso[i['digest']].upper()} (lo avisa el dojo: ECR no sabe qué corre)" if i["digest"] in uso else ""
            print(f"  regla {i['regla']}: {(', '.join(i['tags']) or '<sin tag>'):<10} {corto(i['digest'])} {i['fecha']}{aviso}")
            if a.aplicar:
                borrar_imagen(a.repo, i["digest"])
        previas = {img.split("@")[1] for amb in AMBIENTES for _, img in historia_despliegue(amb)[1:3] if "@" in img}
        perdidas = [i for i in borrar if i["digest"] in previas]
        if perdidas:
            print(f"  ojo: {len(perdidas)} de esas son la versión anterior de un ambiente: sin ellas no hay rollback en segundos")


if __name__ == "__main__":
    main()
