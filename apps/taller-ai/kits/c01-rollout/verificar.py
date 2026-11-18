"""Revisa los criterios de «listo» de la estación, uno por check. No cambia nada.

    python3 verificar.py                    # todos (≈ 30 s; sombra-codigo corre una prueba en un contenedor)
    python3 verificar.py par rollout        # algunos

Necesita el mundo arriba (python3 mundo/crear.py). No hace falta venv: usa la biblioteca estándar, kubectl y docker.
Lo que revisa es lo que corre en el clúster (y que sea lo mismo que dice k8s/ en git), no solo lo que escribiste.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mundo.comun import (GATEWAY, NODOS, NS, PROMETHEUS, RAIZ, REGISTRO, fotos, http, imagenes, kjson, listo,  # noqa: E402
                         nodos, pods, prom, referencia, sh)
from mundo import modelos  # noqa: E402

DEJA_VIVA_S = 300          # el bake más corto que aceptamos en el dojo (C01: 24–48 h)
METRICAS = ["errores-relativo", "errores-tope", "p99-relativo", "p99-tope", "baja-confianza", "psi"]


class Falla(Exception):
    pass


def exige(cond, msg: str) -> None:
    if not cond:
        raise Falla(msg)


def rollout() -> dict:
    ro = kjson("rollout", "gateway", "-n", NS)
    exige(ro, "no existe el Rollout gateway: el paso 5 convierte el Deployment en un Rollout (kubectl apply -k k8s/)")
    return ro


def contenedor(obj: dict) -> dict:
    return obj["spec"]["template"]["spec"]["containers"][0]


def env(c: dict) -> dict:
    return {e["name"]: e.get("value") for e in c.get("env", [])}


def cm_del(tpl: dict) -> str:
    return next((v["configMap"]["name"] for v in tpl["spec"].get("volumes", []) if "configMap" in v), "")


def tritons() -> dict[str, dict]:
    return {d["metadata"]["name"]: d for d in kjson("deployments", "-n", NS, "-l", "app.kubernetes.io/name=triton").get("items", [])}


def huella_en(dep: str) -> str:
    r = sh("kubectl", "-n", NS, "exec", f"deploy/{dep}", "--", "python", "-c",
           "import hashlib;print(hashlib.sha256(open('/models/classifier/1/model.onnx','rb').read()).hexdigest())", timeout=30)
    return r.stdout.strip()


def ficha_cm(nombre: str) -> dict:
    cm = kjson("configmap", nombre, "-n", NS)
    exige(cm, f"no existe el ConfigMap {nombre}")
    return json.loads(cm["data"]["modelo.json"])


def alb() -> dict:
    r = sh("kubectl", "-n", "dojo-alb", "exec", "deploy/alb", "--", "python", "-c",
           "import urllib.request as u;print(u.urlopen('http://localhost:8081',timeout=3).read().decode())", timeout=20)
    exige(r.returncode == 0, f"no pude leer el ALB del dojo: {r.stderr.strip()[-200:]}")
    return json.loads(r.stdout)


# ---------------------------------------------------------------- los checks
def check_mundo() -> str:
    ns = nodos()
    exige(len(ns) == len(NODOS), f"el clúster tiene {len(ns)} nodos de trabajo y se esperaban {len(NODOS)}: python3 mundo/crear.py")
    exige(all(v["listo"] for v in ns.values()), "hay nodos que no están Ready (kubectl get nodes)")
    st, _ = http(f"http://{REGISTRO}/v2/", timeout=3)
    exige(st == 200, f"el registro no contesta en {REGISTRO}: python3 mundo/cluster.py estado")
    for ns_, d in (("argo-rollouts", "argo-rollouts"), ("dojo-alb", "alb"), ("monitoreo", "prometheus")):
        dep = kjson("deployment", d, "-n", ns_)
        exige(dep and dep.get("status", {}).get("readyReplicas", 0) >= 1,
              f"{ns_}/{d} no está listo: kubectl -n {ns_} get pods (python3 mundo/crear.py lo vuelve a aplicar)")
    st, _ = http(f"{PROMETHEUS}/-/ready", timeout=3)
    exige(st == 200, f"Prometheus no contesta en {PROMETHEUS}")
    exige(modelos.leer(), "no hay registro de modelos: python3 mundo/crear.py")
    v = sh("kubectl-argo-rollouts", "version", "--short").stdout.strip()
    return f"6 nodos, registro, Argo Rollouts (plugin {v or '?'}), ALB en {GATEWAY}, Prometheus y el registro de modelos"


def check_sincronia() -> str:
    sucio = sh("git", "status", "--porcelain", "--", "k8s").stdout.strip()
    exige(not sucio, f"k8s/ tiene cambios sin commit (lo que corre sale de git):\n{sucio}")
    r = sh("kubectl", "diff", "-k", "k8s/", timeout=90)
    exige(r.returncode != 2 and r.returncode <= 1, f"kubectl diff falló: {r.stderr.strip()[-300:]}")
    cambios = sorted(set(re.findall(r"^\+\+\+ \S+/([^/\s]+)", r.stdout, re.M)))
    exige(r.returncode == 0, f"el clúster no es lo que dice k8s/: {', '.join(cambios) or 'hay diferencias'} "
                             "(kubectl diff -k k8s/; si es lo que quieres: kubectl apply -k k8s/)")
    viejo = kjson("deployment", "gateway", "-n", NS)
    exige(not viejo, "todavía existe el Deployment gateway de la estación 9: kubectl -n classifier delete deploy/gateway")
    return f"k8s/ en git = lo que corre (HEAD {sh('git', 'rev-parse', '--short', 'HEAD').stdout.strip()})"


def check_par() -> str:
    ts = tritons()
    exige("triton-v15" in ts, "no existe el Deployment triton-v15: paso 2 (k8s/triton-v15.yaml)")
    ref = referencia()["modelos"]
    huellas = {m["engine_sha256"]: n for n, m in ref.items()}
    vistos = []
    for nombre, d in sorted(ts.items()):
        lb = d["spec"]["template"]["metadata"]["labels"]
        n = lb.get("classifier/modelo")
        exige(n and nombre == f"triton-{'v' + n if n.isdigit() else n}",
              f"{nombre}: su etiqueta classifier/modelo ({n}) no es la de su nombre")
        ficha = ficha_cm(f"classifier-modelo-{n}")
        h = huella_en(nombre)
        exige(h, f"{nombre}: no pude leer la huella de su engine (¿pod listo? kubectl -n {NS} get pods -l classifier/modelo={n})")
        exige(h == ficha["engine_sha256"],
              f"{nombre} sirve el engine {h[:12]}… ({huellas.get(h, '?')}) y la versión {n} es {ficha['engine_sha256'][:12]}…: "
              "dos modelos detrás del mismo nombre")
        svc = kjson("service", nombre, "-n", NS)
        exige(svc and svc["spec"]["selector"].get("classifier/modelo") == n,
              f"el Service {nombre} tiene que ver solo los pods de la versión {n} (selector classifier/modelo: \"{n}\")")
        pdb = kjson("pdb", nombre, "-n", NS)
        exige(pdb, f"falta el PodDisruptionBudget {nombre}")
        rep, mina = d["spec"].get("replicas", 1), pdb["spec"].get("minAvailable")
        exige((rep == 1 and mina == 0) or (rep >= 2 and mina == 1),
              f"{nombre}: {rep} pod(s) y su PDB pide minAvailable {mina} (con 1 pod, 0; con 2 o más, 1)")
        vistos.append(f"{nombre} ({rep})")
    ro = kjson("rollout", "gateway", "-n", NS)
    tpls = []
    if ro:
        tpls.append(("el template del Rollout", ro["spec"]["template"]))
        for rs in kjson("replicasets", "-n", NS, "-l", "app.kubernetes.io/name=gateway").get("items", []):
            if rs["spec"].get("replicas", 0) > 0:
                tpls.append((f"el ReplicaSet {rs['metadata']['name']}", rs["spec"]["template"]))
    for donde, tpl in tpls:
        n = tpl["metadata"]["labels"].get("classifier/modelo")
        e = env(tpl["spec"]["containers"][0])
        host = (e.get("TRITON_URL") or "").split(":")[0]
        objetivo = f"triton-{'v' + n if n and n.isdigit() else n}"
        exige(host == objetivo, f"{donde}: classifier/modelo {n} y TRITON_URL={e.get('TRITON_URL')}: la release {n} habla con {objetivo}")
        exige(cm_del(tpl) == f"classifier-modelo-{n}", f"{donde}: monta {cm_del(tpl)} y es la release {n}")
    return f"cada Triton sirve el engine de su versión: {', '.join(vistos)}; cada release del gateway habla con el suyo"


def check_sombra_codigo() -> str:
    from mundo.crear import docker_env
    img = imagenes().get("gateway", {}).get("actual")
    exige(img, "no hay imagen del gateway: python3 mundo/crear.py")
    r = sh("docker", "run", "--rm", "-v", f"{RAIZ}/gateway/app:/srv/gateway/app:ro", "-v", f"{RAIZ}/mundo:/srv/mundo:ro",
           img, "python", "/srv/mundo/prueba_sombra.py", timeout=120, extra=docker_env())
    out = (r.stdout + r.stderr).strip().splitlines()
    exige(r.returncode == 0 and out and out[-1].startswith("OK"),
          "gateway/app/sombra.py: " + (next((ln for ln in out if ln.startswith("FALLA")), None) or (out[-1] if out else "sin salida"))[:300])
    return "gateway/app/sombra.py: " + "; ".join(out[:-1])[:260]


def check_sombra() -> str:
    rp, ev = RAIZ / "sombra" / "reporte.json", RAIZ / "sombra" / "evidencia.jsonl"
    exige(rp.exists() and ev.exists(), "falta sombra/reporte.json o sombra/evidencia.jsonl: paso 4 (python3 sombra/reporte.py …)")
    rep = json.loads(rp.read_text())
    champ, som = {}, {}
    for ln in ev.read_text().splitlines():
        try:
            e = json.loads(ln)
        except json.JSONDecodeError:
            continue
        if e.get("status") != 200 or not e.get("top5"):
            continue
        (som if e.get("shadow") else champ)[e["request_id"]] = e["top5"][0][0]
    pares = [r for r in som if r in champ]
    exige(pares, "sombra/evidencia.jsonl no tiene pares (request_id con línea del champion y de la sombra)")
    acuerdo = sum(champ[r] == som[r] for r in pares) / len(pares)
    exige(rep.get("pares") == len(pares), f"el reporte dice {rep.get('pares')} pares y la evidencia tiene {len(pares)}")
    exige(abs(rep.get("acuerdo_top1", -1) - acuerdo) < 0.001,
          f"el reporte dice acuerdo {rep.get('acuerdo_top1')} y la evidencia da {acuerdo:.4f}")
    exige(rep.get("challenger") == "resnet50-2026-11-01", f"el reporte es del challenger {rep.get('challenger')}, no de la versión 15")
    u = json.loads((RAIZ / "sombra" / "umbrales.json").read_text())
    exige(len(pares) >= u["pares_min"], f"{len(pares)} pares: el umbral pide ≥ {u['pares_min']} (más minutos de sombra con carga)")
    exige(rep.get("veredicto") == "sigue", f"el reporte dice «{rep.get('veredicto')}»: {'; '.join(rep.get('fallan', []))}")
    return (f"{len(pares):,} pares, acuerdo top-1 {acuerdo:.1%}, p99 × {rep.get('p99_razon')}, "
            f"{rep.get('caidas')} caídas: la 15 sigue al canary")


def check_rollout() -> str:
    ro = rollout()
    s = ro["spec"]
    c = s.get("strategy", {}).get("canary")
    exige(c, "el Rollout no usa strategy.canary")
    exige(c.get("stableService") == "gateway-stable" and c.get("canaryService") == "gateway-canary",
          "stableService: gateway-stable y canaryService: gateway-canary")
    for svc in ("gateway-stable", "gateway-canary"):
        exige(kjson("service", svc, "-n", NS), f"falta el Service {svc}")
    alb_ = c.get("trafficRouting", {}).get("alb", {})
    exige(alb_.get("ingress") == "gateway", "trafficRouting.alb.ingress: gateway (quien reparte es el ALB, con pesos)")
    pasos = c.get("steps", [])
    pesos = [p["setWeight"] for p in pasos if "setWeight" in p]
    exige(pesos[:2] == [5, 25], f"los pesos del canary son {pesos}: primero 5 y después 25")
    pausas = [p["pause"] for p in pasos if "pause" in p]
    exige(len(pausas) >= 2 and all("duration" in p for p in pausas),
          "cada pausa con duration: nadie aprieta un botón para pasar de 5 a 25 ni de 25 a 100")
    an = c.get("analysis", {})
    exige(any(t.get("templateName") == "canary-vs-estable" for t in an.get("templates", [])),
          "strategy.canary.analysis (de fondo) con el template canary-vs-estable")
    args = {a["name"]: a.get("valueFrom", {}).get("podTemplateHashValue") for a in an.get("args", [])}
    exige(args.get("canary-hash") == "Latest" and args.get("stable-hash") == "Stable",
          "args canary-hash (podTemplateHashValue: Latest) y stable-hash (Stable)")
    sd = c.get("scaleDownDelaySeconds", 30)
    exige(sd >= DEJA_VIVA_S, f"scaleDownDelaySeconds es {sd}: la release anterior se apagaría a los {sd} s (el bake pide ≥ {DEJA_VIVA_S})")
    rw = s.get("rollbackWindow", {}).get("revisions", 0)
    exige(rw >= 2, "rollbackWindow: {revisions: 3}: volver a una release reciente se salta los pasos")
    st = ro.get("status", {})
    exige(not st.get("abort"), f"el Rollout está abortado: {st.get('message', '')} (python3 verificar.py par; mira el AnalysisRun)")
    exige(st.get("phase") in ("Healthy", "Progressing", "Paused"), f"el Rollout está {st.get('phase')}: {st.get('message', '')}")
    return f"canary {pesos} con pausas de {', '.join(p['duration'] for p in pausas)}, análisis de fondo, bake {sd} s, {st.get('phase')}"


def check_analisis() -> str:
    at = kjson("analysistemplate", "canary-vs-estable", "-n", NS)
    exige(at, "no existe el AnalysisTemplate canary-vs-estable: paso 6 (k8s/analisis.yaml)")
    ms = {m["name"]: m for m in at["spec"].get("metrics", [])}
    faltan = [m for m in METRICAS if m not in ms]
    exige(not faltan, f"faltan métricas: {', '.join(faltan)}")
    for n, m in ms.items():
        exige(m.get("failureCondition"), f"{n}: sin failureCondition nunca revierte")
        q = m.get("provider", {}).get("prometheus", {}).get("query", "")
        exige("{{args.canary-hash}}" in q, f"{n}: la consulta no usa {{{{args.canary-hash}}}}")
        if n.endswith("relativo") or n in ("baja-confianza", "psi"):
            exige("{{args.stable-hash}}" in q, f"{n}: compara contra el estable en la misma ventana ({{{{args.stable-hash}}}})")
    ro = kjson("rollout", "gateway", "-n", NS)
    estable = ro.get("status", {}).get("stableRS", "") if ro else ""
    malas = []
    if estable:                     # una release contra sí misma no debe fallar: la regla no es ruido
        for n, m in ms.items():
            q = m["provider"]["prometheus"]["query"].replace("{{args.canary-hash}}", estable).replace("{{args.stable-hash}}", estable)
            try:
                r = prom(q)
            except RuntimeError as e:
                raise Falla(f"{n}: Prometheus no acepta la consulta ({str(e)[:160]})") from None
            v = float(r[0]["value"][1]) if r else None
            fc = m["failureCondition"]
            if v is not None and v >= 0 and evaluar(fc, v):
                malas.append(f"{n}={v:.3g}")
    exige(not malas, f"con el estable contra sí mismo ya fallan: {', '.join(malas)} (la regla daría falsas alarmas)")
    runs = kjson("analysisruns", "-n", NS).get("items", [])
    fases = [r.get("status", {}).get("phase") for r in runs]
    exige("Failed" in fases, "todavía ningún canary abortado por el análisis: el ensayo del paso 7 (con el modelo roto)")
    exige("Successful" in fases, "todavía ningún canary que pasó el análisis completo: el paso 8 (la release 15)")
    return f"{len(ms)} métricas contra el estable; el estable contra sí mismo no falla; AnalysisRuns: " + \
           ", ".join(f"{fases.count(f)} {f}" for f in sorted(set(fases)))


def evaluar(cond: str, v: float) -> bool:
    """Las condiciones del template son de la forma «result[0] > 1.2» (con && entre varias)."""
    ok = True
    for parte in cond.split("&&"):
        m = re.fullmatch(r"\s*result\[0\]\s*(>=|<=|>|<|==)\s*([-\d.e]+)\s*", parte)
        if not m:
            return False
        a, b = v, float(m.group(2))
        ok &= {">=": a >= b, "<=": a <= b, ">": a > b, "<": a < b, "==": a == b}[m.group(1)]
    return ok


def check_reparto() -> str:
    ing = kjson("ingress", "gateway", "-n", NS)
    exige(ing, "no existe el Ingress gateway")
    back = ing["spec"]["rules"][0]["http"]["paths"][0]["backend"]["service"]
    exige(back.get("name") == "gateway-stable" and back.get("port", {}).get("name") == "use-annotation",
          f"el backend del Ingress es {back.get('name')}:{back.get('port')}: con un puerto normal, el ALB ignora los pesos "
          "(gateway-stable, port name: use-annotation)")
    a = alb()
    exige(a["fuente"].startswith("anotación"), f"el ALB reparte por «{a['fuente']}», no por los pesos de Argo Rollouts")
    pesos = {d["service"]: d["peso"] for d in a["destinos"]}
    ro = rollout()
    w = ro.get("status", {}).get("canary", {}).get("weights", {}).get("canary", {}).get("weight", 0)
    exige(pesos.get("gateway-canary", 0) == w, f"el Rollout pide {w} % al canary y el ALB le da {pesos.get('gateway-canary', 0)} %")
    return f"el ALB aplica los pesos del Rollout: canary {pesos.get('gateway-canary', 0)} %, estable {pesos.get('gateway-stable', 0)} %"


def check_alias() -> str:
    ro = rollout()
    st = ro.get("status", {})
    exige(st.get("phase") == "Healthy" and st.get("stableRS") == st.get("currentPodHash"),
          f"el Rollout no está sano al 100 % ({st.get('phase')}): el alias se mueve al final")
    n = ro["spec"]["template"]["metadata"]["labels"].get("classifier/modelo")
    reg = modelos.leer()
    ch = reg["alias"].get("champion")
    exige(ch == n, f"@champion es v{ch} y lo que atiende al 100 % es la release {n}: python3 ci/promover.py")
    tags = reg["versiones"][n]["tags"]
    d = kjson("deployment", f"triton-v{n}", "-n", NS)
    dig = contenedor(d)["image"].split("@")[-1] if d else ""
    exige(tags.get("run") == reg["versiones"][n]["run"] and tags.get("digest") == dig,
          f"v{n} necesita las etiquetas run={reg['versiones'][n]['run']} y digest={dig[:19]}… (tiene "
          + (", ".join(f"{k}={v[:19] + '…' if len(v) > 24 else v}" for k, v in tags.items()) or "ninguna") + ")")
    return f"@champion = v{n} ({reg['versiones'][n]['model_version']}), con run y digest de su Triton"


def check_bake() -> str:
    reg = modelos.leer()
    movs = [h for h in reg.get("historia", []) if h["alias"] == "champion" and h.get("de") and h["de"] != h["a"]]
    exige(movs, "todavía no promueves ninguna versión (python3 ci/promover.py después del canary)")
    ant, act = movs[-1]["de"], reg["alias"]["champion"]
    ts = tritons()
    exige(f"triton-v{ant}" in ts, f"triton-v{ant} ya no existe: durante el bake la release anterior sigue viva para volver sin levantar nada")
    da, dn = ts[f"triton-v{ant}"], ts.get(f"triton-v{act}", {})
    vuelta = act.isdigit() and ant.isdigit() and int(act) < int(ant)   # el runbook regresó a la anterior
    exige((da["spec"].get("replicas") == 1 or vuelta) and da.get("status", {}).get("readyReplicas", 0) >= 1,
          f"triton-v{ant} en el bake: 1 pod listo (tiene {da['spec'].get('replicas')} y {da.get('status', {}).get('readyReplicas', 0)} listos)")
    exige(dn and (dn["spec"].get("replicas", 0) >= 2 or vuelta),
          f"triton-v{act} atiende todo: 2 pods, uno por zona (tiene {dn.get('spec', {}).get('replicas') if dn else 0})")
    ro = rollout()
    sd = ro["spec"]["strategy"]["canary"].get("scaleDownDelaySeconds", 30)
    viejos = [rs for rs in kjson("replicasets", "-n", NS, "-l", "app.kubernetes.io/name=gateway").get("items", [])
              if rs["metadata"]["labels"].get("rollouts-pod-template-hash") != ro["status"].get("stableRS")
              and rs.get("status", {}).get("readyReplicas", 0) > 0]
    return (f"triton-v{ant} vivo ({da['spec'].get('replicas')} pod(s)) y triton-v{act} con {dn['spec'].get('replicas')}"
            + (" (volviste a la anterior)" if vuelta else "") + f"; el gateway anterior se apaga a los {sd} s "
            f"({'todavía prendido' if viejos else 'ya apagado'}); rollbackWindow lo trae de vuelta sin pasos")


def check_runbook() -> str:
    p = RAIZ / "RUNBOOK.md"
    t = p.read_text() if p.exists() else ""
    titulos = ["Detectar", "Revertir", "Confirmar", "Congelar", "Comunicar", "Investigar"]
    faltan = [f"## {i}. {x}" for i, x in enumerate(titulos, 1) if not re.search(rf"^## {i}\. {x}", t, re.M)]
    exige(not faltan, f"RUNBOOK.md: faltan las secciones {', '.join(faltan)}")
    rev = re.search(r"^## 2\. Revertir(.*?)^## 3\.", t, re.M | re.S)
    cuerpo = rev.group(1) if rev else ""
    for frase, por in (("git revert", "el revert en git"), ("kubectl apply -k", "cómo se aplica"),
                       ("promover.py|modelos.py alias champion", "cómo regresa @champion"), ("bake", "qué hacer en el bake")):
        exige(re.search(frase, cuerpo), f"RUNBOOK.md, «Revertir»: falta {por} («{frase.split('|')[0]}»)")
    return "RUNBOOK.md: las 6 secciones y, en Revertir, el revert, el apply y el alias por fase"


def check_servicio() -> str:
    fs = fotos()
    exige(fs, "no hay fotos en mundo/fotos")
    malos, versiones = [], {}
    for i in range(200):
        st, cuerpo = http(f"{GATEWAY}/v1/classify", fs[i % len(fs)].read_bytes(), timeout=5)
        if st != 200:
            malos.append(st)
        else:
            v = json.loads(cuerpo)["model_version"]
            versiones[v] = versiones.get(v, 0) + 1
    exige(len(malos) <= 1, f"de 200 fotos por el ALB, {len(malos)} no dieron 200 ({sorted(set(malos))}; 0 = sin respuesta)")
    return f"200 fotos por {GATEWAY}: " + ", ".join(f"{v} {n}" for v, n in sorted(versiones.items()))


CHECKS = {
    "mundo": check_mundo, "sincronia": check_sincronia, "par": check_par, "sombra-codigo": check_sombra_codigo,
    "sombra": check_sombra, "rollout": check_rollout, "analisis": check_analisis, "reparto": check_reparto,
    "alias": check_alias, "bake": check_bake, "runbook": check_runbook, "servicio": check_servicio,
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
            print(f"{'✓' if ok else '✗'} {i:<13} {msg}", flush=True)
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
