"""Revisa los criterios de «listo» de la estación, uno por check. No cambia nada.

    python verificar.py                    # todos (≈ 15 s)
    python verificar.py triton pdb         # algunos

Necesita el mundo arriba (python mundo/crear.py). No hace falta venv: usa la biblioteca estándar y kubectl.
Lo que revisa es lo que corre en el clúster (y que sea lo mismo que dice k8s/ en git), no solo lo que escribiste.
"""
from __future__ import annotations

import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mundo.comun import (GATEWAY, GPU, NODOS, NS, REGISTRO, corto, foto, http, imagenes, kjson, listo,  # noqa: E402
                         nodos, pods, sh)

DRENADO = {"triton": 30, "gateway": 20}   # lo que cada programa se da para acabar después de SIGTERM (s)
PRESTOP = {"triton": 10, "gateway": 15}   # lo que el balanceador tarda en dejar de mandarle (s)


class Falla(Exception):
    pass


def exige(cond, msg: str) -> None:
    if not cond:
        raise Falla(msg)


def bytes_de(q: str | None) -> float:
    if not q:
        return 0
    m = re.fullmatch(r"([\d.]+)([KMGTE]i?|[kmgte]?)", str(q))
    if not m:
        return 0
    n, u = float(m.group(1)), m.group(2)
    mult = {"": 1, "k": 1e3, "K": 1e3, "M": 1e6, "G": 1e9, "T": 1e12, "Ki": 2**10, "Mi": 2**20, "Gi": 2**30, "Ti": 2**40}
    return n * mult.get(u, 1)


def nucleos(q: str | None) -> float:
    if q is None:
        return 0
    q = str(q)
    return float(q[:-1]) / 1000 if q.endswith("m") else float(q)


def deploy(nombre: str) -> dict:
    d = kjson("deployment", nombre, "-n", NS)
    exige(d, f"no existe el Deployment {nombre} en el namespace {NS}: kubectl apply -k k8s/")
    return d


def contenedor(d: dict) -> dict:
    cs = d["spec"]["template"]["spec"]["containers"]
    exige(len(cs) == 1, f"{d['metadata']['name']}: se esperaba un solo contenedor")
    return cs[0]


def rollout_completo(d: dict) -> bool:
    s, st = d["spec"], d.get("status", {})
    r = s.get("replicas", 1)
    return (st.get("observedGeneration", 0) >= d["metadata"]["generation"] and st.get("updatedReplicas", 0) == r
            and st.get("replicas", 0) == r and st.get("availableReplicas", 0) == r)


def condicion(d: dict, tipo: str) -> dict:
    return next((c for c in d.get("status", {}).get("conditions", []) if c["type"] == tipo), {})


def por_que_no(sel: str) -> str:
    """El primer motivo visible de un pod que no está listo: lo que verías con kubectl describe pod."""
    for p in pods(sel):
        if listo(p):
            continue
        nombre = p["metadata"]["name"]
        for c in p.get("status", {}).get("conditions", []):
            if c["type"] == "PodScheduled" and c["status"] == "False":
                return f"{nombre} Pending: {c.get('message', '')[:160]}"
        for cs in p.get("status", {}).get("containerStatuses", []):
            w = cs.get("state", {}).get("waiting")
            if w:
                return f"{nombre} {w.get('reason')}" + (f" (último fin: {cs['lastState']['terminated']['reason']})"
                                                     if cs.get("lastState", {}).get("terminated") else "")
            if cs.get("state", {}).get("running"):
                return f"{nombre} corre pero no está listo (readiness; {cs.get('restartCount', 0)} reinicios)"
    return ""


def manifiesto(url: str) -> int:
    """HEAD del manifiesto, aceptando los formatos que sube docker (índice OCI, lista o manifiesto simple)."""
    import urllib.error
    import urllib.request
    req = urllib.request.Request(url, method="HEAD", headers={"Accept": ", ".join([
        "application/vnd.oci.image.index.v1+json", "application/vnd.oci.image.manifest.v1+json",
        "application/vnd.docker.distribution.manifest.list.v2+json", "application/vnd.docker.distribution.manifest.v2+json"])})
    try:
        with urllib.request.urlopen(req, timeout=3) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except OSError:
        return 0


# ---------------------------------------------------------------- los checks
def check_mundo() -> str:
    ns = nodos()
    exige(len(ns) == len(NODOS), f"el clúster tiene {len(ns)} nodos de trabajo y se esperaban {len(NODOS)}: python mundo/crear.py")
    caidos = [v["apodo"] for v in ns.values() if not v["listo"]]
    exige(not caidos, f"nodos que no están Ready: {', '.join(caidos)} (kubectl get nodes)")
    t4 = [v for v in ns.values() if v["workload"] == "gpu-t4"]
    exige(all(v["gpu"] == "1" for v in t4), "algún nodo T4 no anuncia nvidia.com/gpu: 1: python mundo/crear.py")
    st, _ = http(f"http://{REGISTRO}/v2/", timeout=3)
    exige(st == 200, f"el registro no contesta en {REGISTRO}: python mundo/cluster.py estado")
    r = sh("kubectl", "get", "--raw", "/apis/metrics.k8s.io/v1beta1/nodes", timeout=20)
    exige(r.returncode == 0, "metrics-server no contesta (el HPA no tendría números): kubectl -n kube-system get pods")
    return f"Kubernetes con {len(ns)} nodos listos ({len(t4)} con T4), el registro y metrics-server"


def check_sincronia() -> str:
    r = sh("kubectl", "kustomize", "k8s/", timeout=30)
    exige(r.returncode == 0, f"k8s/ no se arma: {r.stderr.strip()[-200:]}")
    st = sh("git", "status", "--porcelain", "--", "k8s/").stdout.strip()
    exige(not st, "hay cambios en k8s/ sin commit: lo que corre debe salir de git (git add k8s/ && git commit)")
    d = sh("kubectl", "diff", "-k", "k8s/", timeout=60)
    exige(d.returncode in (0, 1), f"kubectl diff falló: {d.stderr.strip()[-200:]}")
    if d.returncode == 1:
        objs = sorted(set(re.findall(r"^diff -u -N \S+/(\S+?)\.\S+ ", d.stdout, re.M)))
        raise Falla(f"lo que corre no es lo que dice k8s/ ({', '.join(objs) or 'ver kubectl diff -k k8s/'}): "
                    "kubectl diff -k k8s/ y kubectl apply -k k8s/")
    return "lo que corre en el clúster es exactamente lo que dice k8s/ en git (kubectl diff vacío)"


def check_imagenes() -> str:
    img = imagenes()
    validas = {v for app in ("gateway", "triton") for v in img[app].values()}
    vistas = set()
    for app in ("gateway", "triton"):
        ref = contenedor(deploy(app))["image"]
        exige("@sha256:" in ref, f"{app} pide su imagen por tag ({ref}): un tag se puede mover; va el digest (kustomization.yaml)")
        exige(ref in validas, f"{app} pide {corto(ref)}, que no está en mundo/imagenes.json")
        vistas.add(ref)
        repo, dig = ref.split("@")
        st = manifiesto(f"http://{REGISTRO}/v2/{repo.split('/', 1)[1]}/manifests/{dig}")
        exige(st == 200, f"el registro no sirve {corto(ref)} (HTTP {st}): un pod nuevo no podría bajarla")
    for p in pods("app.kubernetes.io/name in (gateway,triton)"):
        for cs in p.get("status", {}).get("containerStatuses", []):
            w = (cs.get("state", {}).get("waiting") or {}).get("reason", "")
            exige(w not in ("ImagePullBackOff", "ErrImagePull"), f"{p['metadata']['name']}: {w} (no puede bajar su imagen)")
    return "gateway y Triton por digest, publicados por el CI, y el registro los sirve: " + ", ".join(corto(v) for v in sorted(vistas))


def check_recursos() -> str:
    for app, cpu_min, mem_min in (("gateway", 0.5, 768 * 2**20), ("triton", 1, 4 * 2**30)):
        c = contenedor(deploy(app))
        req, lim = c.get("resources", {}).get("requests", {}), c.get("resources", {}).get("limits", {})
        exige(nucleos(req.get("cpu")) >= cpu_min, f"{app}: falta el request de CPU (o es menor de {cpu_min} núcleos): sin él no se "
                                                  "agenda bien y el HPA no tiene contra qué medir")
        exige("cpu" not in lim, f"{app}: tiene límite de CPU ({lim.get('cpu')}): en los picos lo frena el throttling")
        exige(bytes_de(req.get("memory")) >= mem_min, f"{app}: el request de memoria ({req.get('memory')}) no alcanza para su peor momento")
        exige(bytes_de(lim.get("memory")) == bytes_de(req.get("memory")), f"{app}: el techo de memoria tiene que ser igual al request")
    c = contenedor(deploy("triton"))
    r = c["resources"]
    exige(str(r.get("requests", {}).get(GPU)) == "1" and str(r.get("limits", {}).get(GPU)) == "1",
          "triton: cada pod pide una T4 entera (nvidia.com/gpu: 1 en requests y limits)")
    exige("gpu" not in json.dumps(contenedor(deploy("gateway")).get("resources", {})), "el gateway no usa GPU")
    return "requests de CPU y memoria, techo de memoria = request, sin techo de CPU; Triton con su T4"


def check_triton() -> str:
    d = deploy("triton")
    s = d["spec"]
    ru = s.get("strategy", {}).get("rollingUpdate", {})
    exige(str(ru.get("maxUnavailable")) == "0", "triton: al cambiar de versión puede quedar con menos de 2 listos (maxUnavailable ≠ 0)")
    spread = [t for t in s["template"]["spec"].get("topologySpreadConstraints", []) if t["topologyKey"] == "topology.kubernetes.io/zone"]
    exige(spread and spread[0].get("whenUnsatisfiable") == "DoNotSchedule" and spread[0].get("maxSkew") == 1,
          "triton: falta repartir por zona con maxSkew 1 y DoNotSchedule")
    ps = [p for p in pods("app.kubernetes.io/name=triton") if listo(p)]
    exige(len(ps) >= 2, f"triton: {len(ps)} pod(s) listos de 2. {por_que_no('app.kubernetes.io/name=triton')}")
    ns = nodos()
    zonas = set()
    for p in ps:
        n = ns.get(p["spec"].get("nodeName"), {})
        exige(n.get("workload") == "gpu-t4", f"{p['metadata']['name']} corre en {n.get('apodo')}, que no tiene T4")
        zonas.add(n.get("zona"))
    exige(len(zonas) == 2, f"los Tritons listos están todos en {', '.join(zonas)}: si esa zona cae, no queda GPU")
    exige(rollout_completo(d), f"triton: el cambio de versión no ha terminado. {por_que_no('app.kubernetes.io/name=triton')}")
    return f"2 Tritons listos, cada uno en una T4, uno por zona ({', '.join(sorted(zonas))})"


def check_gateway() -> str:
    d = deploy("gateway")
    ru = d["spec"].get("strategy", {}).get("rollingUpdate", {})
    exige(str(ru.get("maxUnavailable")) == "0", "gateway: maxUnavailable ≠ 0 (al cambiar de versión bajaría la capacidad)")
    exige(d["spec"].get("progressDeadlineSeconds", 600) <= 300, "gateway: progressDeadlineSeconds de más de 5 min para un pod que arranca en segundos")
    env = {e["name"]: e.get("value") for e in contenedor(d).get("env", [])}
    exige(str(env.get("TRITON_URL", "")).split(":")[0].startswith("triton"), "gateway: TRITON_URL no apunta al Service de Triton")
    ps = [p for p in pods("app.kubernetes.io/name=gateway") if listo(p)]
    exige(len(ps) >= 3, f"gateway: {len(ps)} pod(s) listos (mínimo 3). {por_que_no('app.kubernetes.io/name=gateway')}")
    ns = nodos()
    for p in pods("app.kubernetes.io/name=gateway"):
        n = ns.get(p["spec"].get("nodeName") or "", {})
        exige(not n or n.get("workload") == "cpu", f"{p['metadata']['name']} cayó en {n.get('apodo')}: el gateway nunca va en una T4")
    exige(rollout_completo(d), f"gateway: el cambio de versión no ha terminado ({condicion(d, 'Progressing').get('reason', '')}). "
                               f"{por_que_no('app.kubernetes.io/name=gateway')}")
    rs = kjson("rs", "-n", NS, "-l", "app.kubernetes.io/name=gateway").get("items", [])
    return f"{len(ps)} gateways listos en nodos de CPU; {len(rs)} ReplicaSets guardados para volver atrás"


def check_probes() -> str:
    t = contenedor(deploy("triton"))
    for k, ruta in (("startupProbe", "/v2/health/ready"), ("readinessProbe", "/v2/health/ready"), ("livenessProbe", "/v2/health/live")):
        exige(k in t, f"triton: falta la {k}")
        exige(t[k].get("httpGet", {}).get("path") == ruta, f"triton: la {k} pregunta a {t[k].get('httpGet', {}).get('path')} (va {ruta})")
    sp = t["startupProbe"]
    presupuesto = sp.get("periodSeconds", 10) * sp.get("failureThreshold", 3)
    carga = imagenes().get("carga_s", {}).get(t["image"], 20)
    exige(presupuesto >= 1.5 * carga, f"triton: la startup da {presupuesto} s y el engine de esta imagen tarda ≈ {carga} s en cargar "
                                      f"(se pide ≥ 1.5 × {carga} = {1.5 * carga:.0f} s)")
    g = contenedor(deploy("gateway"))
    exige(g.get("readinessProbe", {}).get("httpGet", {}).get("path") == "/readyz", "gateway: la readiness va a /readyz")
    exige(g.get("livenessProbe", {}).get("httpGet", {}).get("path") == "/healthz",
          "gateway: la liveness va a /healthz (no le pregunta a Triton: si Triton cae, no hay que reiniciar los gateways)")
    rd = t["readinessProbe"]
    return (f"startup de Triton: {presupuesto} s para un engine de ≈ {carga} s; sale del reparto en "
            f"≈ {rd.get('periodSeconds', 10) * rd.get('failureThreshold', 3)} s; gateway /readyz y /healthz")


def check_apagado() -> str:
    out = []
    for app in ("triton", "gateway"):
        d = deploy(app)
        c = contenedor(d)
        cmd = c.get("lifecycle", {}).get("preStop", {})
        seg = cmd.get("sleep", {}).get("seconds")
        if seg is None:
            m = re.search(r"sleep\D*(\d+)", json.dumps(cmd.get("exec", {})))
            seg = int(m.group(1)) if m else 0
        exige(seg >= PRESTOP[app], f"{app}: el preStop espera {seg} s (se piden ≥ {PRESTOP[app]})")
        g = d["spec"]["template"]["spec"].get("terminationGracePeriodSeconds", 30)
        exige(g > seg + DRENADO[app], f"{app}: el plazo de gracia ({g} s) no alcanza para preStop ({seg}) + drenado ({DRENADO[app]}) + margen")
        out.append(f"{app} {seg} + {DRENADO[app]} < {g} s")
    return "apagado ordenado: " + " · ".join(out)


def check_pdb() -> str:
    p = kjson("pdb", "triton", "-n", NS)
    exige(p, "no existe el PodDisruptionBudget triton")
    st = p.get("status", {})
    exige(st.get("expectedPods", 0) >= 2, f"el PDB cubre {st.get('expectedPods', 0)} pods: ¿su selector es el de Triton?")
    exige(st.get("disruptionsAllowed", 0) == 1 or st.get("currentHealthy", 0) < 2,
          f"el PDB deja sacar {st.get('disruptionsAllowed')} Tritons a la vez (con 2 sanos, va 1: ni 0, que traba todo drain, ni 2)")
    return f"el PDB cubre {st['expectedPods']} Tritons y deja sacar {st.get('disruptionsAllowed')} a la vez"


def check_hpa() -> str:
    h = kjson("hpa", "gateway", "-n", NS)
    exige(h, "no existe el HPA gateway")
    s = h["spec"]
    exige(s.get("scaleTargetRef", {}).get("name") == "gateway", "el HPA no apunta al Deployment gateway")
    exige(s.get("minReplicas") == 3 and s.get("maxReplicas") == 12, f"el HPA va de {s.get('minReplicas')} a {s.get('maxReplicas')} (C01: 3 a 12)")
    m = next((x for x in s.get("metrics", []) if x.get("type") == "Resource" and x["resource"]["name"] == "cpu"), None)
    exige(m and m["resource"]["target"].get("averageUtilization") == 60, "el HPA no mide la CPU con objetivo de 60 %")
    sd = (s.get("behavior") or {}).get("scaleDown") or {}
    exige(sd.get("stabilizationWindowSeconds", 300) >= 300, "el HPA baja sin 5 min de calma")
    activo = next((c for c in h.get("status", {}).get("conditions", []) if c["type"] == "ScalingActive"), {})
    exige(activo.get("status") == "True", f"el HPA no puede calcular: {activo.get('reason', '')} {activo.get('message', '')[:160]}")
    actual = (h["status"].get("currentMetrics") or [{}])[0].get("resource", {}).get("current", {}).get("averageUtilization")
    return f"HPA activo: {h['status'].get('currentReplicas')} gateways, CPU al {actual} % de su request (objetivo 60 %)"


def check_servicio() -> str:
    datos = foto()
    lat, malos = [], []
    for _ in range(20):
        t = time.perf_counter()
        st, cuerpo = http(f"{GATEWAY}/v1/classify", datos, timeout=5)
        lat.append((time.perf_counter() - t) * 1000)
        if st != 200:
            malos.append(st)
    exige(not malos, f"de 20 fotos, {len(malos)} no dieron 200 ({sorted(set(malos))}; 0 = sin respuesta). "
                     f"kubectl -n {NS} get endpointslices -l kubernetes.io/service-name=gateway")
    r = json.loads(cuerpo)
    exige(len(r.get("predictions", [])) == 5, "la respuesta no trae el top-5")
    lat.sort()
    return f"20 fotos por localhost:8901 → 200, top-5 de {r['model_version']}; p50 {lat[9]:.0f} ms"


def check_estable() -> str:
    ahora = datetime.now(timezone.utc)
    for p in pods("app.kubernetes.io/name in (gateway,triton)"):
        nombre = p["metadata"]["name"]
        exige(p["status"].get("phase") != "Pending" or listo(p), por_que_no("app.kubernetes.io/name in (gateway,triton)") or f"{nombre} Pending")
        for cs in p["status"].get("containerStatuses", []):
            w = (cs.get("state", {}).get("waiting") or {}).get("reason")
            exige(not w, f"{nombre}: {w}")
            fin = (cs.get("lastState", {}).get("terminated") or {})
            if fin.get("finishedAt"):
                hace = (ahora - datetime.fromisoformat(fin["finishedAt"].replace("Z", "+00:00"))).total_seconds()
                exige(hace > 120, f"{nombre} se reinició hace {hace:.0f} s ({fin.get('reason')}, código {fin.get('exitCode')}): "
                                  f"kubectl -n {NS} logs {nombre} --previous")
    n = len(pods("app.kubernetes.io/name in (gateway,triton)"))
    return f"{n} pods corriendo, ninguno Pending ni reiniciado en los últimos 2 min"


CHECKS = {
    "mundo": check_mundo, "sincronia": check_sincronia, "imagenes": check_imagenes, "recursos": check_recursos,
    "triton": check_triton, "gateway": check_gateway, "probes": check_probes, "apagado": check_apagado,
    "pdb": check_pdb, "hpa": check_hpa, "servicio": check_servicio, "estable": check_estable,
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
            print(f"{'✓' if ok else '✗'} {i:<10} {msg}", flush=True)
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
