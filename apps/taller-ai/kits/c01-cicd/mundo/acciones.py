"""El runner de la forja: corre workflows de GitHub Actions (.github/workflows/*.yml) en tu Mac. No se toca.

No lo leas para resolver un paso: se porta como GitHub Actions en lo que la estación usa, y lo que no conoce lo dice.

Lo que hace igual que GitHub Actions:
- `on`: pull_request y push, con branches, paths y paths-ignore. En un PR, el commit que se prueba es el merge de
  prueba de tu rama con main (refs/pull/N/merge), y GITHUB_SHA es ese commit.
- jobs con needs, if (con success(), failure(), always(), startsWith, contains, ==, !=, &&, ||, !), outputs,
  timeout-minutes, env, permissions y environment. Un job cuyo if da falso queda «skipped», y los que lo necesitan
  también (salvo always()). Un `if` sin success()/failure()/always() lleva un success() && implícito.
- steps con run (bash -e -o pipefail), id, if, env, working-directory, y uses: actions/checkout (el único `uses` del
  dojo; los demás se escriben como run). $GITHUB_OUTPUT, $GITHUB_ENV y $GITHUB_STEP_SUMMARY.
- Cada ${{ … }} se sustituye en el texto ANTES de correr el paso (por eso un título de PR dentro de un run es código).
- Cada job corre en una carpeta nueva que se borra al terminar: nada pasa de un job a otro salvo sus outputs.
- permissions: id-token: write le da al job un token OIDC (DOJO_OIDC_TOKEN) con sub = repo:<repo>:pull_request,
  repo:<repo>:ref:refs/heads/<rama> o repo:<repo>:environment:<ambiente>, y aud = sts.amazonaws.com.
- environment con revisores: el job espera a que alguien de la lista lo apruebe (`python mundo/forja.py aprobar`).
Lo distinto: no hay máquinas virtuales (los jobs corren en tu Mac, con el Python del kit ya instalado y el Docker de tu
Mac, con su caché), runs-on se lee pero no elige máquina, y no hay matrices, servicios, concurrency ni caché de Actions.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

import yaml

from mundo.comun import FORJA, KIT, ORIGEN, REPOSITORIO, docker_host, path_sin_llavero, sh

ESTADOS_OK = ("success", "skipped")


# ------------------------------------------------------------------ expresiones ${{ … }}
TOKEN = re.compile(r"\s*(?:(?P<s>'(?:[^']|'')*')|(?P<n>\d+(?:\.\d+)?)|(?P<op>==|!=|<=|>=|&&|\|\||[!()<>,])|(?P<id>[A-Za-z_][\w\-]*(?:\.[\w\-*]+|\[[^\]]+\])*))")


class Expr:
    def __init__(self, texto: str, ctx: dict):
        self.t, self.i, self.ctx = [], 0, ctx
        pos = 0
        texto = texto.strip()
        while pos < len(texto):
            m = TOKEN.match(texto, pos)
            if not m or m.end() == pos:
                raise ValueError(f"no entiendo la expresión: {texto!r} (cerca de {texto[pos:pos + 15]!r})")
            pos = m.end()
            self.t.append(next((k, v) for k, v in m.groupdict().items() if v is not None))

    def ver(self):
        return self.t[self.i] if self.i < len(self.t) else (None, None)

    def tomar(self):
        x = self.ver()
        self.i += 1
        return x

    def valor(self):
        v = self.o()
        if self.i != len(self.t):
            raise ValueError(f"sobra algo en la expresión: {self.t[self.i:]}")
        return v

    def o(self):
        v = self.y()
        while self.ver() == ("op", "||"):
            self.tomar()
            d = self.y()
            v = v if verdad(v) else d
        return v

    def y(self):
        v = self.comp()
        while self.ver() == ("op", "&&"):
            self.tomar()
            d = self.comp()
            v = d if verdad(v) else v
        return v

    def comp(self):
        v = self.unario()
        while self.ver()[0] == "op" and self.ver()[1] in ("==", "!=", "<", ">", "<=", ">="):
            op = self.tomar()[1]
            d = self.unario()
            a, b = norm(v), norm(d)
            v = {"==": a == b, "!=": a != b, "<": a < b, ">": a > b, "<=": a <= b, ">=": a >= b}[op]
        return v

    def unario(self):
        if self.ver() == ("op", "!"):
            self.tomar()
            return not verdad(self.unario())
        return self.prim()

    def prim(self):
        k, v = self.tomar()
        if k == "s":
            return v[1:-1].replace("''", "'")
        if k == "n":
            return float(v) if "." in v else int(v)
        if (k, v) == ("op", "("):
            x = self.o()
            self.tomar()
            return x
        if k == "id":
            if self.ver() == ("op", "("):
                self.tomar()
                args = []
                while self.ver() != ("op", ")"):
                    args.append(self.o())
                    if self.ver() == ("op", ","):
                        self.tomar()
                self.tomar()
                return funcion(v, args, self.ctx)
            if v in ("true", "false", "null"):
                return {"true": True, "false": False, "null": None}[v]
            return buscar(self.ctx, v)
        raise ValueError(f"no entiendo {v!r} en la expresión")


def norm(x):
    return x.lower() if isinstance(x, str) else ("" if x is None else x)


def verdad(x) -> bool:
    return x not in (None, False, 0, "")


def buscar(ctx: dict, ruta: str):
    partes = re.findall(r"[^.\[\]]+|\[[^\]]+\]", ruta)
    x = ctx
    for p in partes:
        p = p.strip("[]'\"")
        if isinstance(x, dict):
            x = x.get(p)
        else:
            return None
    return x


def funcion(nombre: str, args: list, ctx: dict):
    n = nombre.lower()
    if n == "success":
        return ctx["_estado"] == "success"
    if n == "failure":
        return ctx["_estado"] == "failure"
    if n == "always":
        return True
    if n == "cancelled":
        return False
    if n == "startswith":
        return str(norm(args[0])).startswith(str(norm(args[1])))
    if n == "endswith":
        return str(norm(args[0])).endswith(str(norm(args[1])))
    if n == "contains":
        return str(norm(args[1])) in (str(norm(args[0])) if not isinstance(args[0], list) else [norm(a) for a in args[0]])
    if n == "format":
        return re.sub(r"\{(\d+)\}", lambda m: str(args[int(m.group(1)) + 1]), str(args[0]))
    if n == "tojson":
        import json
        return json.dumps(args[0])
    raise ValueError(f"la función {nombre}() no existe en el dojo")


def texto(x) -> str:
    if x is True:
        return "true"
    if x is False:
        return "false"
    return "" if x is None else str(x)


def sustituir(s, ctx: dict):
    if isinstance(s, (int, float, bool)) or s is None:
        return s
    return re.sub(r"\$\{\{(.*?)\}\}", lambda m: texto(Expr(m.group(1), ctx).valor()), str(s), flags=re.S)


def condicion(s, ctx: dict) -> bool:
    if s is None:
        s = "success()"
    if isinstance(s, bool):
        return s
    s = str(s).strip()
    if s.startswith("${{") and s.endswith("}}"):
        s = s[3:-2]
    if not re.search(r"\b(success|failure|always|cancelled)\s*\(", s):
        s = f"success() && ({s})"
    return verdad(Expr(s, ctx).valor())


# ------------------------------------------------------------------ disparadores
def glob_re(patron: str) -> re.Pattern:
    r = ""
    i = 0
    while i < len(patron):
        if patron.startswith("**", i):
            r += ".*"
            i += 2
        elif patron[i] == "*":
            r += "[^/]*"
            i += 1
        elif patron[i] == "?":
            r += "[^/]"
            i += 1
        else:
            r += re.escape(patron[i])
            i += 1
    return re.compile(r + "$")


def coincide(nombre: str, patrones: list[str]) -> bool:
    return any(glob_re(p).match(nombre) for p in patrones)


def disparadores(wf: dict) -> dict:
    on = wf.get("on", wf.get(True))
    if isinstance(on, str):
        return {on: {}}
    if isinstance(on, list):
        return {e: {} for e in on}
    return {k: (v or {}) for k, v in (on or {}).items()}


def se_dispara(wf: dict, evento: str, rama: str, archivos: list[str]) -> bool:
    d = disparadores(wf)
    if evento not in d:
        return False
    f = d[evento]
    if "branches" in f and not coincide(rama, f["branches"]):
        return False
    if "paths" in f and not any(coincide(a, f["paths"]) for a in archivos):
        return False
    if "paths-ignore" in f and all(coincide(a, f["paths-ignore"]) for a in archivos):
        return False
    return True


def workflows_en(sha: str, repo: Path = ORIGEN) -> dict[str, dict]:
    r = sh("git", f"--git-dir={repo}", "ls-tree", "--name-only", sha, ".github/workflows/")
    out = {}
    for ruta in r.stdout.split():
        if ruta.endswith((".yml", ".yaml")):
            txt = sh("git", f"--git-dir={repo}", "show", f"{sha}:{ruta}").stdout
            try:
                out[ruta] = yaml.safe_load(txt) or {}
            except yaml.YAMLError as e:
                out[ruta] = {"_error": f"YAML inválido: {e}"}
    return out


def orden_jobs(jobs: dict) -> list[str]:
    hechos, orden = set(), []
    while len(orden) < len(jobs):
        listos = [j for j in jobs if j not in hechos and all(n in hechos for n in necesita(jobs[j]))]
        if not listos:
            raise ValueError("needs forma un ciclo o nombra un job que no existe: " +
                             ", ".join(f"{j} → {necesita(jobs[j])}" for j in jobs if j not in hechos))
        for j in listos:
            hechos.add(j)
            orden.append(j)
    return orden


def necesita(job: dict) -> list[str]:
    n = (job or {}).get("needs", [])
    return [n] if isinstance(n, str) else list(n)


def nombre_ambiente(job: dict) -> str | None:
    e = job.get("environment")
    return e.get("name") if isinstance(e, dict) else e


def permisos(wf: dict, job: dict) -> dict:
    p = job.get("permissions", wf.get("permissions"))
    if p is None:
        return {"contents": "write"}            # el token por omisión de un repositorio (sin id-token)
    if p in ("read-all", "write-all"):
        return {"*": p.split("-")[0]}
    return p or {}


# ------------------------------------------------------------------ correr un job
def correr_job(corrida: dict, nombre: str, wf: dict, log, eco) -> dict:
    """Corre un job en una carpeta nueva y regresa {result, outputs, pasos}."""
    from mundo.forja import token_oidc
    job = wf["jobs"][nombre]
    res = {"result": "success", "outputs": {}, "pasos": [], "inicio": time.time()}
    base = FORJA / "runner" / f"{corrida['id']}-{nombre}"
    shutil.rmtree(base, ignore_errors=True)
    ws, tmp, dcfg = base / "classifier", base / "_temp", base / "_docker"
    for d in (ws, tmp, dcfg):
        d.mkdir(parents=True)
    plugins = Path.home() / ".docker" / "cli-plugins"
    if plugins.is_dir():
        (dcfg / "cli-plugins").symlink_to(plugins, target_is_directory=True)
    (dcfg / "config.json").write_text('{"auths": {}}\n')
    env_base = {
        "PATH": path_sin_llavero(),
        "HOME": str(base), "LANG": "C.UTF-8", "CI": "true", "GITHUB_ACTIONS": "true",
        "GITHUB_REPOSITORY": REPOSITORIO, "GITHUB_SHA": corrida["sha"], "GITHUB_REF": corrida["ref"],
        "GITHUB_REF_NAME": corrida["ref"].split("/")[-1] if corrida["evento"] == "push" else f"{corrida.get('pr')}/merge",
        "GITHUB_EVENT_NAME": corrida["evento"], "GITHUB_ACTOR": corrida["actor"], "GITHUB_RUN_ID": str(corrida["id"]),
        "GITHUB_JOB": nombre, "GITHUB_WORKSPACE": str(ws), "RUNNER_TEMP": str(tmp), "DOCKER_CONFIG": str(dcfg),
        "DOJO_KIT": str(KIT), "PYTHONPATH": str(ws), "PYTHONUNBUFFERED": "1", "PIP_DISABLE_PIP_VERSION_CHECK": "1",
        "DOJO_DESPLIEGUE_URL": str(FORJA / "despliegue.git"),
    }
    if corrida["evento"] == "pull_request":
        env_base |= {"GITHUB_HEAD_REF": corrida["rama"], "GITHUB_BASE_REF": "main"}
    if docker_host():
        env_base["DOCKER_HOST"] = docker_host()
    perms = permisos(wf, job)
    ambiente = nombre_ambiente(job)
    if perms.get("id-token") == "write" or perms.get("*") == "write":
        env_base["DOJO_OIDC_TOKEN"] = token_oidc(corrida, nombre, ambiente)
    ctx = contexto(corrida)
    ctx["needs"] = {n: corrida["jobs"][n] for n in necesita(job)}
    ctx["steps"], ctx["_estado"] = {}, "success"
    ctx["env"] = {}
    env_extra: dict[str, str] = {}
    try:
        for capa in (wf.get("env") or {}, job.get("env") or {}):
            for k, v in capa.items():
                ctx["env"][k] = texto(sustituir(v, ctx))
    except ValueError as e:
        log(f"✗ {e}")
        res["result"] = "failure"
        return res
    limite = time.time() + 60 * float(job.get("timeout-minutes", 360))
    for i, paso in enumerate(job.get("steps") or []):
        etiqueta = paso.get("name") or (paso.get("uses") or paso.get("run", "").strip().splitlines()[0] if paso.get("run") or paso.get("uses") else f"paso {i + 1}")
        try:
            corre = condicion(paso.get("if"), ctx)
        except ValueError as e:
            log(f"✗ if del paso «{etiqueta}»: {e}")
            res["result"], ctx["_estado"] = "failure", "failure"
            break
        if not corre:
            res["pasos"].append({"paso": etiqueta, "result": "skipped"})
            log(f"– {etiqueta} (skipped)")
            continue
        t0 = time.time()
        salida_f, env_f, resumen_f = tmp / f"output-{i}", tmp / f"env-{i}", tmp / f"summary-{i}"
        for f in (salida_f, env_f):
            f.write_text("")
        log(f"▶ {etiqueta}")
        eco(f"    ▶ {etiqueta}")
        codigo = 0
        try:
            env = {**env_base, **ctx["env"], **env_extra, "GITHUB_OUTPUT": str(salida_f), "GITHUB_ENV": str(env_f),
                   "GITHUB_STEP_SUMMARY": str(resumen_f)}
            for k, v in (paso.get("env") or {}).items():
                env[k] = texto(sustituir(v, {**ctx, "env": {**ctx["env"], **env_extra}}))
            if "uses" in paso:
                accion = paso["uses"].split("@")[0]
                if accion != "actions/checkout":
                    raise ValueError(f"la acción {paso['uses']} no existe en el dojo: escribe ese paso como run")
                r = subprocess.run(["bash", "-c", f"git init -q . && git fetch -q --depth=1 '{ORIGEN}' {corrida['sha']} && git checkout -q FETCH_HEAD && git log -1 --format='HEAD %h %s'"],
                                   cwd=ws, capture_output=True, text=True, env=env)
                log(r.stdout + r.stderr)
                codigo = r.returncode
            elif "run" in paso:
                script = sustituir(paso["run"], {**ctx, "env": {**ctx["env"], **env_extra}})
                (tmp / f"paso-{i}.sh").write_text(script)
                cwd = ws / sustituir(paso.get("working-directory", "."), ctx)
                restante = limite - time.time()
                p = subprocess.Popen(["bash", "--noprofile", "--norc", "-eo", "pipefail", str(tmp / f"paso-{i}.sh")],
                                     cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
                try:
                    for linea in p.stdout:
                        log(linea.rstrip("\n"))
                        if time.time() > limite:
                            raise subprocess.TimeoutExpired(p.args, restante)
                    codigo = p.wait(timeout=max(1, limite - time.time()))
                except subprocess.TimeoutExpired:
                    p.kill()
                    log(f"✗ el job pasó de timeout-minutes ({job.get('timeout-minutes')}) y se canceló")
                    codigo = 124
            else:
                raise ValueError("un paso lleva run o uses")
        except ValueError as e:
            log(f"✗ {e}")
            codigo = 1
        sal = leer_archivo_kv(salida_f)
        env_extra |= leer_archivo_kv(env_f)
        if resumen_f.exists():
            log("[resumen] " + resumen_f.read_text().strip()) if resumen_f.read_text().strip() else None
        estado = "success" if codigo == 0 else "failure"
        if paso.get("id"):
            ctx["steps"][paso["id"]] = {"outputs": sal, "outcome": estado, "conclusion": estado}
        res["pasos"].append({"paso": etiqueta, "result": estado, "seg": round(time.time() - t0, 1)})
        if codigo != 0:
            log(f"✗ terminó con código {codigo}")
            eco(f"      ✗ terminó con código {codigo}")
            res["result"], ctx["_estado"] = "failure", "failure"
    try:
        for k, v in (job.get("outputs") or {}).items():
            res["outputs"][k] = texto(sustituir(v, {**ctx, "env": {**ctx["env"], **env_extra}}))
    except ValueError as e:
        log(f"✗ outputs: {e}")
        res["result"] = "failure"
    res["fin"] = time.time()
    if not os.environ.get("DOJO_GUARDAR_RUNNER"):
        shutil.rmtree(base, ignore_errors=True)          # la máquina del job se borra: solo quedan sus outputs
    return res


def leer_archivo_kv(f: Path) -> dict:
    out: dict[str, str] = {}
    if not f.exists():
        return out
    lineas = f.read_text().splitlines()
    i = 0
    while i < len(lineas):
        ln = lineas[i]
        m = re.match(r"^([^=<]+)<<(.+)$", ln)
        if m:
            k, fin, val = m.group(1), m.group(2), []
            i += 1
            while i < len(lineas) and lineas[i] != fin:
                val.append(lineas[i])
                i += 1
            out[k] = "\n".join(val)
        elif "=" in ln:
            k, v = ln.split("=", 1)
            out[k] = v
        i += 1
    return out


def contexto(corrida: dict) -> dict:
    ev = {"pull_request": {"number": corrida.get("pr"), "title": corrida.get("titulo"),
                           "head": {"ref": corrida.get("rama")}, "base": {"ref": "main"}}} if corrida["evento"] == "pull_request" else \
         {"before": corrida.get("antes"), "after": corrida["sha"], "head_commit": {"message": corrida.get("mensaje", "")}}
    return {"github": {"sha": corrida["sha"], "ref": corrida["ref"], "event_name": corrida["evento"], "actor": corrida["actor"],
                       "repository": REPOSITORIO, "run_id": corrida["id"], "head_ref": corrida.get("rama", ""),
                       "base_ref": "main" if corrida["evento"] == "pull_request" else "", "event": ev,
                       "ref_name": corrida["ref"].split("/")[-1]},
            "runner": {"os": "macOS", "temp": ""}, "vars": {}, "secrets": {}, "inputs": {}}


def decidir_job(corrida: dict, nombre: str, job: dict) -> str | None:
    """Antes de correr: «skipped» si sus needs no salieron bien o su if da falso; None si corre."""
    ctx = contexto(corrida)
    ctx["needs"] = {n: corrida["jobs"][n] for n in necesita(job)}
    estados = [corrida["jobs"][n]["result"] for n in necesita(job)]
    ctx["_estado"] = "success" if all(e == "success" for e in estados) else "failure"
    try:
        return None if condicion(job.get("if"), ctx) else "skipped"
    except ValueError as e:
        print(f"    ✗ if del job {nombre}: {e}", file=sys.stderr)
        return "failure"
