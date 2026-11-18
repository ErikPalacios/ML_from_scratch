"""Revisa los criterios de «listo» de la estación, uno por check. No cambia nada.

    python verificar.py                    # todos (≈ 15 s)
    python verificar.py workflow pr        # algunos

Necesita el entorno virtual activo (source .venv/bin/activate) y el mundo arriba (docker compose up -d --wait y
python mundo/crear.py). Lo que revisa es lo que ya pasó: el workflow que está en main de la forja, las corridas, el
ECR del dojo, el repositorio de despliegue y lo que corre en cada ambiente.
"""
from __future__ import annotations

import json
import re
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import yaml  # noqa: E402

from mundo import acciones  # noqa: E402
from mundo.comun import (AMBIENTES, CONFIANZA, DESPLIEGUE, FORJA_YAML, IMAGEN_GW, ORIGEN, RAIZ, REGISTRO,  # noqa: E402
                         REPO_GW, ROL_CI, TRITON, corto, es_digest, esperar, git, historia_despliegue, http,
                         leer_despliegue, leer_json, valida_revision)

TUS_ARCHIVOS = [".github/workflows/", "ci/", "infra/ecr-retencion.json", ".trivyignore.yaml"]


class Falla(Exception):
    pass


def exige(cond, msg: str) -> None:
    if not cond:
        raise Falla(msg)


def forja() -> dict:
    return leer_json(RAIZ / ".forja" / "estado.json", {"prs": {}, "corridas": {}})


def workflow_main() -> tuple[str, dict]:
    sha = git(f"--git-dir={ORIGEN}", "rev-parse", "refs/heads/main")
    wfs = acciones.workflows_en(sha)
    exige(wfs, "no hay ningún workflow en main de la forja (.github/workflows/*.yml): escríbelo en una rama, PR y merge")
    for ruta, wf in wfs.items():
        exige("_error" not in wf, f"{ruta}: {wf.get('_error')}")
        if any(n in (wf.get("jobs") or {}) for n in ("imagen", "pruebas")):
            return ruta, wf
    raise Falla(f"ningún workflow en main tiene los jobs pruebas e imagen (hay: {', '.join(wfs)})")


def corrida_falsa(evento: str, jobs: dict) -> dict:
    ref = "refs/pull/1/merge" if evento == "pull_request" else "refs/heads/main"
    return {"id": 0, "sha": "0" * 40, "ref": ref, "evento": evento, "actor": "tu", "pr": 1, "rama": "x", "titulo": "x",
            "jobs": {j: {"result": "success", "outputs": {}} for j in jobs}}


def push_runs() -> list[dict]:
    return [c for c in forja()["corridas"].values() if c["evento"] == "push" and c["ref"] == "refs/heads/main"]


def ultima_buena() -> dict:
    """La última corrida de main que llegó a producción."""
    buenas = [c for c in push_runs() if c["jobs"].get("produccion", {}).get("result") == "success"]
    exige(buenas, "ninguna corrida de main llegó a producción todavía (merge a main y aprobar el ambiente produccion)")
    return buenas[-1]


# ---------------------------------------------------------------- los checks
def check_mundo() -> str:
    exige(esperar(f"http://{REGISTRO}/v2/", 3, ok=(401,)), f"el ECR del dojo no contesta en {REGISTRO}: docker compose ps")
    exige(esperar(f"{TRITON}/v2/health/ready", 3), f"Triton no contesta en {TRITON}: docker compose ps")
    exige(ORIGEN.exists() and DESPLIEGUE.exists(), "falta la forja (.forja/): python mundo/crear.py")
    exige(git("remote", "get-url", "origin") == str(ORIGEN), "el origin de esta carpeta no es la forja (.forja/classifier.git)")
    for amb, puerto in AMBIENTES.items():
        st, cuerpo = http(f"http://localhost:{puerto}/readyz", timeout=3)
        exige(st == 200, f"{amb} no está listo en localhost:{puerto}: python mundo/gitops.py estado")
    return f"ECR {REGISTRO}, Triton, la forja y los dos ambientes (8801, 8802) arriba"


def check_reglas() -> str:
    for p in (FORJA_YAML, CONFIANZA):
        exige(valida_revision(p), f"{p.relative_to(RAIZ)} cambió sin revisión (su huella no está en mundo/revisiones.json): "
                                  f"git log -p {p.relative_to(RAIZ)}")
    from mundo.nube import firmar, roles, condicion_cumple
    rol = next(r for r in roles().values() if r["arn"] == ROL_CI)
    st = rol["trust_policy"]["Statement"][0]
    pr = {"sub": "repo:dojo/classifier:pull_request", "aud": "sts.amazonaws.com"}
    main = {"sub": "repo:dojo/classifier:ref:refs/heads/main", "aud": "sts.amazonaws.com"}
    exige(not condicion_cumple(st.get("Condition", {}), pr), "la trust policy del rol del CI acepta tokens de un PR: un PR podría subir imágenes")
    exige(condicion_cumple(st.get("Condition", {}), main), "la trust policy del rol del CI no acepta el token de main")
    del firmar
    return "forja.yaml y la trust policy son las revisadas; un PR no puede asumir el rol que sube imágenes"


def check_workflow() -> str:
    ruta, wf = workflow_main()
    jobs = wf.get("jobs") or {}
    for j in ("lint", "pruebas", "imagen", "staging", "produccion"):
        exige(j in jobs, f"{ruta}: falta el job «{j}» (los nombres los buscan el check obligatorio y verificar.py)")
    exige(acciones.se_dispara(wf, "pull_request", "main", ["README.md"]),
          f"{ruta} no corre en un PR que solo cambia README.md: «pruebas» es obligatorio y ese PR se quedaría esperando para siempre")
    exige(acciones.se_dispara(wf, "push", "main", ["gateway/app/main.py"]), f"{ruta} no corre con un push a main")
    exige(not acciones.se_dispara(wf, "push", "otra-rama", ["gateway/app/main.py"]),
          f"{ruta} corre con un push a cualquier rama: la imagen sale solo de main")
    en_pr = corrida_falsa("pull_request", jobs)
    en_main = corrida_falsa("push", jobs)
    exige(acciones.decidir_job(en_pr, "pruebas", jobs["pruebas"]) is None, "el job pruebas no corre en un PR")
    exige(acciones.decidir_job(en_pr, "imagen", jobs["imagen"]) == "skipped",
          "el job imagen corre en un PR: en un PR, GITHUB_SHA es el merge de prueba y ninguna imagen debe salir de ahí")
    exige(acciones.decidir_job(en_main, "imagen", jobs["imagen"]) is None, "el job imagen no corre después del merge a main")
    exige(set(acciones.necesita(jobs["imagen"])) >= {"lint", "pruebas"}, "imagen tiene que esperar a lint y pruebas (needs)")
    exige("imagen" in acciones.necesita(jobs["staging"]), "staging tiene que esperar a imagen (needs) para leer su digest")
    exige({"imagen", "staging"} <= set(acciones.necesita(jobs["produccion"])), "produccion tiene que esperar a imagen y a staging")
    exige(acciones.nombre_ambiente(jobs["produccion"]) == "produccion", "el job produccion no usa environment: produccion (sin aprobación)")
    exige("digest" in (jobs["imagen"].get("outputs") or {}), "el job imagen no declara outputs.digest")
    for j in ("staging", "produccion"):
        texto = json.dumps(jobs[j].get("steps"))
        exige("needs.imagen.outputs.digest" in texto, f"el job {j} no usa needs.imagen.outputs.digest: ¿despliega un tag?")
    return f"{ruta}: PR = lint + pruebas; main = imagen → staging → produccion (aprobado), con el digest como salida"


def check_permisos() -> str:
    ruta, wf = workflow_main()
    arriba = wf.get("permissions")
    exige(isinstance(arriba, dict) and arriba.get("contents") == "read" and "id-token" not in arriba,
          f"{ruta}: arriba, permissions tiene que ser lo mínimo (contents: read), sin id-token")
    con_token = [j for j, job in (wf.get("jobs") or {}).items() if (acciones.permisos(wf, job).get("id-token") == "write")]
    exige(con_token == ["imagen"], f"id-token: write lo tiene que pedir solo el job imagen (lo piden: {con_token or 'ninguno'})")
    return "contents: read para todos; id-token: write solo en imagen"


PELIGROSOS = re.compile(r"\$\{\{\s*(github\.event\.(pull_request\.(title|body|head\.ref|head\.label)|head_commit\.message|commits)|github\.head_ref)")


def check_inyeccion() -> str:
    ruta, wf = workflow_main()
    for j, job in (wf.get("jobs") or {}).items():
        for p in job.get("steps") or []:
            exige(not PELIGROSOS.search(str(p.get("run", ""))),
                  f"{ruta}, job {j}: un run usa texto que escribe alguien de fuera (título, rama, mensaje) dentro de ${{{{ }}}}: "
                  f"pásalo por env y úsalo como \"$VARIABLE\"")
    return "ningún run pega texto de fuera (título del PR, nombre de rama, mensaje) dentro del comando"


def check_pr() -> str:
    f = forja()
    juntados = [p for p in f["prs"].values() if p["estado"] == "juntado"]
    exige(juntados, "todavía no se juntó ningún PR (python mundo/forja.py pr abrir … y pr merge …)")
    prs = [c for c in f["corridas"].values() if c["evento"] == "pull_request"]
    exige(prs, "no hay corridas de PR")
    c = prs[-1]
    exige(c["jobs"].get("pruebas", {}).get("result") == "success", f"en la última corrida de PR ({c['id']}) pruebas no pasó")
    publicaron = [x["id"] for x in prs if x["jobs"].get("imagen", {}).get("result") not in ("skipped", None, "pendiente")]
    exige(not publicaron, f"el job imagen corrió en un PR (corridas {publicaron}): solo después del merge")
    return f"{len(juntados)} PR juntados; en los PR solo corren lint y pruebas (última corrida de PR: {c['id']})"


def check_imagen() -> str:
    runs = push_runs()
    exige(runs, "no hay corridas de main todavía")
    del_ultimo = [r for r in runs if r["sha"] == runs[-1]["sha"]]          # un rerun que choca con el tag no borra la buena
    buenas = [r for r in del_ultimo if r["estado"] in ("exito", "esperando")]
    c = buenas[-1] if buenas else del_ultimo[-1]
    exige(c["estado"] in ("exito", "esperando"), f"la última corrida de main ({c['id']}, commit {c['sha'][:7]}) terminó en {c['estado']}: "
                                                 f"python mundo/forja.py corrida {c['id']}")
    out = c["jobs"]["imagen"].get("outputs", {})
    exige(re.fullmatch(r"sha256:[0-9a-f]{64}", out.get("digest", "")), f"la corrida {c['id']} no dejó un digest válido como salida de imagen")
    from mundo.nube import digest_de, token_interno
    tag = c["sha"][:7]
    en_ecr = digest_de(REPO_GW, tag, token_interno())
    exige(en_ecr, f"el tag {tag} (el commit de main) no está en el ECR")
    exige(en_ecr == out["digest"], f"el tag {tag} apunta a {corto(en_ecr)} y el job imagen dijo {corto(out['digest'])}: alguien movió el tag")
    pasos = [p["paso"] for p in c["jobs"]["imagen"].get("pasos", [])]
    i_push = next((i for i, p in enumerate(pasos) if "push" in p.lower()), None)
    for antes in ("humo", "escaneo"):
        i = next((k for k, p in enumerate(pasos) if antes in p.lower()), None)
        exige(i is not None, f"el job imagen no tiene un paso que se llame «{antes}»")
        exige(i_push is None or i < i_push, f"el paso {antes} va después del push: lo que se sube ya tiene que estar probado")
    return f"main {tag} → {IMAGEN_GW}:{tag} = {corto(en_ecr)}; humo y escaneo antes del push"


def check_inmutable() -> str:
    from mundo.nube import ACEPTA, cabecera, config, digest_de, tags, token_interno
    exige(config()["repos"][REPO_GW]["inmutable"], f"el repositorio {REPO_GW} deja mover tags (MUTABLE): un tag puede cambiar de contenido")
    tk = token_interno()
    ts = tags(REPO_GW, tk)
    exige(len(ts) >= 2, "hacen falta al menos dos imágenes para probar la inmutabilidad")
    a, b = ts[0], ts[1]
    da, db = digest_de(REPO_GW, a, tk), digest_de(REPO_GW, b, tk)
    st, cuerpo = http(f"http://{REGISTRO}/v2/{REPO_GW}/manifests/{b}", headers={**cabecera(tk), "Accept": ACEPTA})
    tipo = json.loads(cuerpo).get("mediaType", "application/vnd.oci.image.index.v1+json")
    st, cuerpo = http(f"http://{REGISTRO}/v2/{REPO_GW}/manifests/{a}", metodo="PUT", datos=cuerpo,
                      headers={**cabecera(tk), "Content-Type": tipo})
    exige(st == 400 and b"immutable" in cuerpo, f"un push de otro contenido al tag {a} no se rechazó (código {st})")
    exige(digest_de(REPO_GW, a, tk) == da != db, "el tag cambió de contenido")
    return f"IMMUTABLE: subir otro contenido con el tag {a} se rechaza (ImageTagAlreadyExists)"


def check_digest() -> str:
    c = ultima_buena()
    d = c["jobs"]["imagen"]["outputs"]["digest"]
    from mundo.gitops import corriendo
    for amb in AMBIENTES:
        pide = leer_despliegue(amb).get("imagen", "")
        exige(es_digest(pide), f"despliegue/{amb}/gateway.yaml pide «{pide}»: tiene que ir por digest (…@sha256:…)")
        hay = corriendo(amb)
        exige(hay.get("imagen") == pide and hay.get("estado") == "running",
              f"{amb} pide {corto(pide)} y corre {corto(hay.get('imagen', ''))}: python mundo/gitops.py estado")
    prod = leer_despliegue("produccion")["imagen"].split("@")[1]
    exige(prod == d, f"producción corre {corto(prod)} y la última corrida que llegó a producción ({c['id']}) subió {corto(d)}")
    return f"staging y producción corren por digest; producción = el digest que construyó y probó la corrida {c['id']} ({corto(d)})"


def check_aprobacion() -> str:
    c = ultima_buena()
    j = c["jobs"]["produccion"]
    regla = yaml.safe_load(FORJA_YAML.read_text())["ambientes"]["produccion"]
    exige(j.get("aprobado_por") in regla["revisores"], f"el despliegue a producción de la corrida {c['id']} no lo aprobó un revisor")
    exige(j["aprobado_por"] != c["actor"], "quien disparó la corrida aprobó su propio despliegue")
    exige(c["jobs"]["staging"]["result"] == "success", "producción corrió sin que staging pasara")
    return f"producción (corrida {c['id']}) la aprobó {j['aprobado_por']}, no {c['actor']}, después de staging"


def check_escaneo() -> str:
    f = RAIZ / ".trivyignore.yaml"
    excepciones = (yaml.safe_load(f.read_text()) or {}).get("vulnerabilities") or [] if f.exists() else []
    for x in excepciones:
        exige(x.get("statement"), f".trivyignore.yaml: la excepción {x.get('id')} no dice por qué (statement)")
        exige(x.get("expired_at"), f".trivyignore.yaml: la excepción {x.get('id')} no vence (expired_at)")
        exige(date.fromisoformat(str(x["expired_at"])) >= date.today(), f".trivyignore.yaml: la excepción {x['id']} ya venció")
    import subprocess
    img = leer_despliegue("produccion").get("imagen", "")
    r = subprocess.run([sys.executable, "mundo/escaner.py", "image", img, "--severity", "CRITICAL", "--ignore-unfixed",
                        "--exit-code", "1", "--ignorefile", str(f)], cwd=RAIZ, capture_output=True, text=True,
                       env={**__import__("os").environ, **__import__("mundo.comun", fromlist=["docker_env"]).docker_env()})
    exige(r.returncode == 0, "la imagen de producción tiene un aviso CRITICAL con parche: " +
          " ".join(ln.strip() for ln in r.stdout.splitlines() if "CRITICAL" in ln)[:200])
    return f"producción ({corto(img)}) sin avisos CRITICAL con parche; {len(excepciones)} excepción(es), con motivo y fecha"


def check_retencion() -> str:
    from mundo.nube import config, digest_de, evaluar_retencion, token_interno
    pol = config()["repos"][REPO_GW].get("retencion")
    exige(pol, f"{REPO_GW} no tiene regla de retención: python mundo/nube.py ecr politica-retencion {REPO_GW} infra/ecr-retencion.json")
    borra = {i["digest"] for i in evaluar_retencion(REPO_GW)}
    exige(borra, "la regla no borraría nada nunca: ¿limpia las imágenes sin tag y las viejas?")
    tk = token_interno()
    for amb in AMBIENTES:
        hist = [img.split("@")[1] for _, img in historia_despliegue(amb) if "@" in img]
        vistas = list(dict.fromkeys(hist))[:2]          # la que corre y la anterior (el rollback)
        for k, d in enumerate(vistas):
            nombre = "la que corre" if k == 0 else "la anterior (la del rollback)"
            exige(digest_de(REPO_GW, d, tk), f"{amb}: {nombre} ({corto(d)}) ya no está en el ECR")
            exige(d not in borra, f"{amb}: la regla de retención borraría {nombre} ({corto(d)}) en su próxima corrida")
    return f"la regla borraría {len(borra)} imágenes hoy y deja la actual y la anterior de cada ambiente"


CHECKS = {
    "mundo": check_mundo, "reglas": check_reglas, "workflow": check_workflow, "permisos": check_permisos,
    "inyeccion": check_inyeccion, "pr": check_pr, "imagen": check_imagen, "inmutable": check_inmutable,
    "digest": check_digest, "aprobacion": check_aprobacion, "escaneo": check_escaneo, "retencion": check_retencion,
}


def correr(ids: list[str], silencio: bool = False) -> dict[str, tuple[bool, str]]:
    out = {}
    for i in ids:
        try:
            ok, msg = True, CHECKS[i]()
        except Falla as e:
            ok, msg = False, str(e)
        except Exception as e:  # noqa: BLE001 — un error inesperado también es un check que no pasa
            ok, msg = False, f"{type(e).__name__}: {str(e).splitlines()[0][:200] if str(e) else ''}"
        out[i] = (ok, msg)
        if not silencio:
            print(f"{'✓' if ok else '✗'} {i:<11} {msg}", flush=True)
    return out


if __name__ == "__main__":
    pedidos = sys.argv[1:] or list(CHECKS)
    desconocidos = [p for p in pedidos if p not in CHECKS]
    if desconocidos:
        sys.exit(f"checks desconocidos: {desconocidos}. Hay: {', '.join(CHECKS)}")
    r = correr(pedidos)
    from taller.registro import anotar_verificacion  # la corrida queda en taller/progreso.json, para tu tablero

    anotar_verificacion({k: ok for k, (ok, _) in r.items()})
    malos = [k for k, (ok, _) in r.items() if not ok]
    print(f"\n{len(r) - len(malos)}/{len(r)} en verde" + (f" · falta: {', '.join(malos)}" if malos else ""))
    sys.exit(1 if malos else 0)
