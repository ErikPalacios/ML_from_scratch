"""La forja: el GitHub del dojo para el repositorio dojo/classifier (el `origin` de esta carpeta). Se usa; no se toca.

    git push origin <rama>                                     # como en GitHub: primero subes tu rama
    python mundo/forja.py pr abrir <rama> --titulo "…"          # abre el PR (o lo actualiza) y corre los workflows del PR
    python mundo/forja.py pr ver <N>                            # sus checks y si se puede juntar
    python mundo/forja.py pr merge <N>                          # lo junta a main si los checks obligatorios pasaron,
                                                                # y corre los workflows de push a main
    python mundo/forja.py corridas                              # las últimas corridas
    python mundo/forja.py corrida <id> [--job <job>]            # el detalle o el log de un job
    python mundo/forja.py aprobar <id> --como revisora          # aprueba el ambiente que espera (produccion)
    python mundo/forja.py rerun <id>                            # vuelve a correr una corrida (el mismo commit)

Las reglas de main y de los ambientes están en mundo/forja.yaml. Los workflows se leen del commit que se prueba, como
en GitHub, y los corre mundo/acciones.py (el runner). Los logs quedan en .forja/corridas/<id>/<job>.log.
"""
from __future__ import annotations

import argparse
import shutil
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import yaml  # noqa: E402

from mundo import acciones  # noqa: E402
from mundo.comun import (FORJA, FORJA_YAML, KIT, ORIGEN, PERSONA, REPOSITORIO, ahora, escribir_json, git,  # noqa: E402
                         leer_json, sh)

ESTADO = FORJA / "estado.json"
ICONO = {"success": "✓", "failure": "✗", "skipped": "–", "esperando": "⏸", "pendiente": "·", "corriendo": "▶"}


def estado() -> dict:
    return leer_json(ESTADO, {"prs": {}, "corridas": {}, "siguiente_pr": 1, "siguiente_corrida": 1})


def guardar(e: dict) -> None:
    escribir_json(ESTADO, e)


def reglas() -> dict:
    return yaml.safe_load(FORJA_YAML.read_text())


def token_oidc(corrida: dict, job: str, ambiente: str | None) -> str:
    from mundo.nube import firmar
    if ambiente:
        sub = f"repo:{REPOSITORIO}:environment:{ambiente}"
    elif corrida["evento"] == "pull_request":
        sub = f"repo:{REPOSITORIO}:pull_request"
    else:
        sub = f"repo:{REPOSITORIO}:ref:{corrida['ref']}"
    return firmar({"iss": "https://token.actions.githubusercontent.com", "aud": "sts.amazonaws.com", "sub": sub,
                   "repository": REPOSITORIO, "ref": corrida["ref"], "event_name": corrida["evento"],
                   "environment": ambiente or "", "job": job, "run_id": corrida["id"], "exp": int(time.time()) + 300})


def og(*args: str) -> str:
    return git(f"--git-dir={ORIGEN}", *args, cwd=KIT)


def archivos_cambiados(antes: str, despues: str) -> list[str]:
    return og("diff", "--name-only", antes, despues).split()


# ------------------------------------------------------------------ corridas
def crear_corridas(evento: str, sha: str, ref: str, actor: str, archivos: list[str], **extra) -> list[int]:
    e = estado()
    rama = extra.get("rama") if evento == "pull_request" else ref.split("/")[-1]
    base_rama = "main" if evento == "pull_request" else rama
    ids = []
    for ruta, wf in acciones.workflows_en(sha).items():
        if "_error" in wf:
            print(f"  ✗ {ruta}: {wf['_error']}")
            continue
        if not acciones.se_dispara(wf, evento, base_rama, archivos):
            continue
        cid = e["siguiente_corrida"]
        e["siguiente_corrida"] += 1
        jobs = wf.get("jobs") or {}
        e["corridas"][str(cid)] = {"id": cid, "workflow": ruta, "nombre": wf.get("name", ruta), "evento": evento, "sha": sha,
                                   "ref": ref, "actor": actor, "creada": ahora(), "estado": "en_curso", **extra,
                                   "jobs": {j: {"result": "pendiente", "outputs": {}} for j in jobs}}
        ids.append(cid)
    guardar(e)
    if not ids:
        print(f"  ningún workflow se dispara con {evento} ({len(archivos)} archivos cambiados)")
    return ids


def correr(cid: int) -> dict:
    """Avanza la corrida todo lo que se pueda: corre los jobs listos; se detiene si uno espera aprobación."""
    e = estado()
    c = e["corridas"][str(cid)]
    wf = acciones.workflows_en(c["sha"])[c["workflow"]]
    jobs = wf.get("jobs") or {}
    carpeta = FORJA / "corridas" / str(cid)
    carpeta.mkdir(parents=True, exist_ok=True)
    if c["estado"] == "en_curso" and all(j["result"] == "pendiente" for j in c["jobs"].values()):
        print(f"corrida {cid} · {c['workflow']} · {c['evento']}{' #' + str(c['pr']) if c.get('pr') else ''} · commit {c['sha'][:7]}")
    try:
        orden = acciones.orden_jobs(jobs)
    except ValueError as ex:
        print(f"  ✗ {ex}")
        c["estado"] = "falla"
        guardar(e)
        return c
    for nombre in orden:
        j = c["jobs"][nombre]
        if j["result"] not in ("pendiente", "esperando"):
            continue
        if any(c["jobs"][n]["result"] in ("pendiente", "esperando", "corriendo") for n in acciones.necesita(jobs[nombre])):
            continue
        decision = acciones.decidir_job(c, nombre, jobs[nombre])
        if decision:
            j["result"] = decision
            print(f"  {ICONO[decision]} {nombre:<12} {decision}")
            guardar(e)
            continue
        amb = acciones.nombre_ambiente(jobs[nombre])
        revisores = ((reglas().get("ambientes") or {}).get(amb) or {}).get("revisores") or [] if amb else []
        if revisores and not j.get("aprobado_por"):
            j["result"] = "esperando"
            j["ambiente"] = amb
            print(f"  ⏸ {nombre:<12} espera aprobación del ambiente «{amb}» ({', '.join(revisores)}): "
                  f"python mundo/forja.py aprobar {cid} --como {revisores[0]}")
            guardar(e)
            continue
        j["result"] = "corriendo"
        guardar(e)
        with open(carpeta / f"{nombre}.log", "w") as f:
            def log(t, f=f):
                f.write(t + "\n")
                f.flush()
            r = acciones.correr_job(c, nombre, wf, log, print)
        e = estado()
        c = e["corridas"][str(cid)]
        j = c["jobs"][nombre]
        j.update({"result": r["result"], "outputs": r["outputs"], "pasos": r["pasos"], "seg": round(r["fin"] - r["inicio"], 1)})
        sal = "".join(f" · {k}={v[:19] + '…' if len(v) > 20 else v}" for k, v in r["outputs"].items())
        print(f"  {ICONO[r['result']]} {nombre:<12} {r['result']} en {j['seg']} s{sal}")
        if r["result"] == "failure":
            print(f"      el log: python mundo/forja.py corrida {cid} --job {nombre}")
        guardar(e)
    resultados = [j["result"] for j in c["jobs"].values()]
    if "esperando" in resultados:
        c["estado"] = "esperando"
    elif "failure" in resultados:
        c["estado"] = "falla"
    elif all(r in acciones.ESTADOS_OK for r in resultados):
        c["estado"] = "exito"
    c["actualizada"] = ahora()
    guardar(e)
    return c


# ------------------------------------------------------------------ PRs
def pr_abrir(rama: str, titulo: str, actor: str) -> None:
    head = og("rev-parse", f"refs/heads/{rama}")
    if not head:
        sys.exit(f"✗ la rama «{rama}» no está en la forja: git push origin {rama}")
    e = estado()
    n = next((int(k) for k, p in e["prs"].items() if p["rama"] == rama and p["estado"] == "abierto"), None)
    if n is None:
        n = e["siguiente_pr"]
        e["siguiente_pr"] += 1
        e["prs"][str(n)] = {"numero": n, "rama": rama, "titulo": titulo, "autor": actor, "estado": "abierto", "creado": ahora()}
    p = e["prs"][str(n)]
    p["titulo"] = titulo or p["titulo"]
    base = og("rev-parse", "refs/heads/main")
    with tempfile.TemporaryDirectory() as tmp:          # el merge de prueba: tu rama juntada con main, en ningún lado más
        sh("git", "clone", "-q", str(ORIGEN), tmp, check=True)
        r = sh("git", "-c", "user.name=forja", "-c", "user.email=forja@dojo", "merge", "--no-ff", "-q", "-m",
               f"Merge {head[:7]} into {base[:7]}", f"origin/{rama}", cwd=Path(tmp))
        if r.returncode != 0:
            p["estado_merge"] = "conflictos"
            guardar(e)
            sys.exit(f"✗ PR #{n}: la rama tiene conflictos con main; ningún workflow corre hasta que se resuelvan")
        merge = sh("git", "rev-parse", "HEAD", cwd=Path(tmp)).stdout.strip()
        sh("git", "push", "-q", "-f", "origin", f"HEAD:refs/pull/{n}/merge", cwd=Path(tmp), check=True)
    p.update({"head": head, "base": base, "merge": merge, "estado_merge": "limpio"})
    guardar(e)
    archivos = archivos_cambiados(base, head)
    print(f"PR #{n} «{p['titulo']}» · {rama} → main · {len(archivos)} archivos · merge de prueba {merge[:7]}")
    ids = crear_corridas("pull_request", merge, f"refs/pull/{n}/merge", actor, archivos, pr=n, rama=rama, titulo=p["titulo"])
    e = estado()
    e["prs"][str(n)].setdefault("corridas", []).extend(ids)
    guardar(e)
    for cid in ids:
        correr(cid)
    pr_ver(n)


def checks_de(n: int) -> dict[str, str]:
    """El último resultado de cada job en las corridas del commit actual del PR."""
    e = estado()
    p = e["prs"][str(n)]
    checks: dict[str, str] = {}
    for cid in p.get("corridas", []):
        c = e["corridas"][str(cid)]
        if c["sha"] == p.get("merge"):
            for j, r in c["jobs"].items():
                checks[j] = r["result"]
    return checks


def pr_ver(n: int) -> bool:
    e = estado()
    p = e["prs"].get(str(n))
    if not p:
        sys.exit(f"✗ no hay PR #{n}")
    checks = checks_de(n)
    obligatorios = reglas()["main"].get("checks_obligatorios", [])
    print(f"PR #{n} «{p['titulo']}» · {p['estado']}")
    for j, r in checks.items():
        print(f"  {ICONO.get(r, '?')} {j}{'  (obligatorio)' if j in obligatorios else ''}")
    faltan = []
    for o in obligatorios:
        r = checks.get(o)
        if r is None:
            faltan.append(f"«{o}»: esperando su resultado (ningún workflow de este PR lo reportó)")
        elif r not in acciones.ESTADOS_OK:
            faltan.append(f"«{o}»: {r}")
    if p["estado"] == "abierto":
        print("  se puede juntar" if not faltan else "  no se puede juntar: " + "; ".join(faltan))
    return not faltan


def pr_merge(n: int, actor: str) -> None:
    e = estado()
    p = e["prs"].get(str(n))
    if not p or p["estado"] != "abierto":
        sys.exit(f"✗ PR #{n} no está abierto")
    if og("rev-parse", f"refs/heads/{p['rama']}") != p["head"]:
        sys.exit(f"✗ la rama {p['rama']} cambió desde la última corrida: python mundo/forja.py pr abrir {p['rama']} --titulo …")
    if not pr_ver(n):
        sys.exit("✗ la protección de main no deja juntarlo (mundo/forja.yaml)")
    antes = og("rev-parse", "refs/heads/main")
    with tempfile.TemporaryDirectory() as tmp:
        sh("git", "clone", "-q", str(ORIGEN), tmp, check=True)
        r = sh("git", "-c", f"user.name={actor}", "-c", f"user.email={actor}@dojo", "merge", "--no-ff", "-q", "-m",
               f"Merge pull request #{n} from {p['rama']}\n\n{p['titulo']}", f"origin/{p['rama']}", cwd=Path(tmp))
        if r.returncode != 0:
            sys.exit("✗ conflictos con main")
        sh("git", "push", "-q", "origin", "HEAD:main", cwd=Path(tmp), check=True)
    despues = og("rev-parse", "refs/heads/main")
    e = estado()
    e["prs"][str(n)].update({"estado": "juntado", "juntado_por": actor, "commit": despues, "juntado": ahora()})
    guardar(e)
    print(f"✓ PR #{n} juntado a main: {despues[:7]} (git pull para traerlo a tu carpeta)")
    disparar_push("refs/heads/main", antes, despues, actor)


def disparar_push(ref: str, antes: str, despues: str, actor: str) -> list[int]:
    archivos = archivos_cambiados(antes, despues)
    ids = crear_corridas("push", despues, ref, actor, archivos, antes=antes,
                         mensaje=og("log", "-1", "--format=%s", despues))
    for cid in ids:
        correr(cid)
    return ids


# ------------------------------------------------------------------ la línea de comandos
def mostrar_corrida(cid: int, job: str | None) -> None:
    c = estado()["corridas"].get(str(cid))
    if not c:
        sys.exit(f"✗ no hay corrida {cid}")
    if job:
        f = FORJA / "corridas" / str(cid) / f"{job}.log"
        print(f.read_text() if f.exists() else f"(el job {job} no corrió: {c['jobs'].get(job, {}).get('result')})")
        return
    print(f"corrida {cid} · {c['workflow']} · {c['evento']}{' #' + str(c['pr']) if c.get('pr') else ''} · commit {c['sha'][:7]} · {c['estado']} · por {c['actor']}")
    for j, r in c["jobs"].items():
        extra = f" en {r['seg']} s" if "seg" in r else ""
        apr = f" · aprobó {r['aprobado_por']}" if r.get("aprobado_por") else ""
        sal = "".join(f" · {k}={v}" for k, v in r.get("outputs", {}).items())
        print(f"  {ICONO.get(r['result'], '?')} {j:<12} {r['result']}{extra}{apr}{sal}")
        for p in r.get("pasos", []):
            print(f"      {ICONO.get(p['result'], '?')} {p['paso'][:70]}{' · ' + str(p['seg']) + ' s' if 'seg' in p else ''}")


def main() -> None:
    ap = argparse.ArgumentParser(description="La forja (el GitHub del dojo).")
    sub = ap.add_subparsers(dest="cmd", required=True)
    pr = sub.add_parser("pr").add_subparsers(dest="op", required=True)
    a = pr.add_parser("abrir")
    a.add_argument("rama")
    a.add_argument("--titulo", default="")
    a.add_argument("--como", default=PERSONA)
    pr.add_parser("ver").add_argument("n", type=int)
    m = pr.add_parser("merge")
    m.add_argument("n", type=int)
    m.add_argument("--como", default=PERSONA)
    pr.add_parser("lista")
    sub.add_parser("corridas")
    c = sub.add_parser("corrida")
    c.add_argument("id", type=int)
    c.add_argument("--job")
    ap_ = sub.add_parser("aprobar")
    ap_.add_argument("id", type=int)
    ap_.add_argument("--como", required=True)
    sub.add_parser("rerun").add_argument("id", type=int)
    x = ap.parse_args()

    if x.cmd == "pr" and x.op == "abrir":
        pr_abrir(x.rama, x.titulo, x.como)
    elif x.cmd == "pr" and x.op == "ver":
        pr_ver(x.n)
    elif x.cmd == "pr" and x.op == "merge":
        pr_merge(x.n, x.como)
    elif x.cmd == "pr" and x.op == "lista":
        for n, p in estado()["prs"].items():
            print(f"#{n} {p['estado']:<8} {p['rama']:<24} {p['titulo']}")
    elif x.cmd == "corridas":
        for cid, c in list(estado()["corridas"].items())[-15:]:
            jobs = " ".join(f"{ICONO.get(r['result'], '?')}{j}" for j, r in c["jobs"].items())
            print(f"{cid:>3} {c['estado']:<9} {c['evento']:<12} {c['sha'][:7]} {c['workflow'].split('/')[-1]:<14} {jobs}")
    elif x.cmd == "corrida":
        mostrar_corrida(x.id, x.job)
    elif x.cmd == "aprobar":
        e = estado()
        c = e["corridas"].get(str(x.id))
        if not c:
            sys.exit(f"✗ no hay corrida {x.id}")
        espera = [j for j, r in c["jobs"].items() if r["result"] == "esperando"]
        if not espera:
            sys.exit(f"✗ la corrida {x.id} no espera ninguna aprobación")
        for j in espera:
            amb = c["jobs"][j]["ambiente"]
            regla = reglas()["ambientes"][amb]
            if x.como not in regla.get("revisores", []):
                sys.exit(f"✗ {x.como} no puede aprobar «{amb}»: los revisores son {', '.join(regla['revisores'])}")
            if regla.get("prohibir_autoaprobacion") and x.como == c["actor"]:
                sys.exit(f"✗ {x.como} disparó esta corrida y no puede aprobar su propio despliegue a «{amb}»")
            c["jobs"][j].update({"result": "pendiente", "aprobado_por": x.como, "aprobado": ahora()})
            print(f"✓ {x.como} aprobó «{amb}» para el job {j} de la corrida {x.id}")
        guardar(e)
        correr(x.id)
    elif x.cmd == "rerun":
        e = estado()
        v = e["corridas"].get(str(x.id))
        if not v:
            sys.exit(f"✗ no hay corrida {x.id}")
        cid = e["siguiente_corrida"]
        e["siguiente_corrida"] += 1
        nueva = {**v, "id": cid, "creada": ahora(), "estado": "en_curso", "rerun_de": x.id,
                 "jobs": {j: {"result": "pendiente", "outputs": {}} for j in v["jobs"]}}
        e["corridas"][str(cid)] = nueva
        if v.get("pr"):
            e["prs"][str(v["pr"])].setdefault("corridas", []).append(cid)
        guardar(e)
        print(f"rerun de la corrida {x.id} (el mismo commit {v['sha'][:7]})")
        correr(cid)


if __name__ == "__main__":
    shutil.os.environ.setdefault("PYTHONUNBUFFERED", "1")
    main()
