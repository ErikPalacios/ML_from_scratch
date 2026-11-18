"""Mete una falla en el mundo, la configuración o la infraestructura. Nunca toca lo que escribes (k8s/triton.yaml,
gateway.yaml, pdb.yaml ni hpa.yaml): lo que cambia lo cambia otro equipo, en el clúster o en k8s/kustomization.yaml.

    python romper.py                       # una falla al azar, escondida (ronda Romper solo)
    python romper.py --mostrar             # al azar, y dice cuál fue (ronda Romper con ayuda; lo lee Claude)
    python romper.py --mostrar --falla X   # una falla concreta
    python romper.py --verificar           # ¿ya quedó? corre verificar.py; si todo pasa, dice cuál era y restaura
    python romper.py --revelar             # me rindo: explica la falla y restaura
    python romper.py --restaurar           # deshace la falla activa y deja todo sano

Antes de romper, todo tiene que pasar verificar.py. La falla activa se guarda como un hash en .taller/:
ni tú ni Claude la pueden leer ahí. Algunas fallas tardan en verse (un pod tiene que intentar arrancar): romper.py
espera lo necesario antes de devolverte la terminal.
"""
from __future__ import annotations

import argparse
import hashlib
import secrets
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mundo.comun import (K8S, NS, REGISTRO_CONT, TALLER, escribir_json, git, imagenes, kubectl, leer_json,  # noqa: E402
                         listo, nodos, pods, sh)

ESTADO = TALLER / "romper.json"
RESPALDO = TALLER / "respaldo"
KZ = K8S / "kustomization.yaml"
PLATAFORMA = {"GIT_AUTHOR_NAME": "Equipo de plataforma", "GIT_AUTHOR_EMAIL": "plataforma@c01.test",
              "GIT_COMMITTER_NAME": "Equipo de plataforma", "GIT_COMMITTER_EMAIL": "plataforma@c01.test"}
CI = {"GIT_AUTHOR_NAME": "CI de classifier", "GIT_AUTHOR_EMAIL": "ci@c01.test",
      "GIT_COMMITTER_NAME": "CI de classifier", "GIT_COMMITTER_EMAIL": "ci@c01.test"}


def aplicar() -> None:
    sh("kubectl", "apply", "-k", "k8s/", check=True, timeout=120)


def esperar_poco(seg: float, msg: str) -> None:
    print(f"  {msg} (≈ {seg:.0f} s)…", flush=True)
    time.sleep(seg)


# ---------------------------------------------------------------- cambios en kustomization.yaml (otro equipo)
def cambiar_kz(e: dict, nuevo_txt: str, msg: str, quien: dict) -> None:
    RESPALDO.mkdir(parents=True, exist_ok=True)
    shutil.copy(KZ, RESPALDO / "kustomization.yaml")
    KZ.write_text(nuevo_txt)
    git("commit", "-q", "-m", msg, "--", "k8s/kustomization.yaml", extra=quien)
    e["commit"] = git("rev-parse", "HEAD")
    aplicar()


def deshacer_kz(e: dict) -> None:
    r = sh("git", "revert", "--no-edit", e["commit"], extra=PLATAFORMA)
    if r.returncode != 0:                       # si ya lo tocaste encima, se regresa el archivo de antes
        sh("git", "revert", "--abort")
        shutil.copy(RESPALDO / "kustomization.yaml", KZ)
        git("commit", "-q", "-m", "plataforma: regresa kustomization.yaml", "--", "k8s/kustomization.yaml", extra=PLATAFORMA)
    aplicar()


PARCHE = """
patches:              # {nota}
  - target: {{kind: {kind}, name: {nombre}}}
    patch: |-
{ops}
"""


def con_parche(nota: str, kind: str, nombre: str, ops: str) -> str:
    return KZ.read_text().rstrip("\n") + "\n" + PARCHE.format(nota=nota, kind=kind, nombre=nombre,
                                                               ops="\n".join("      " + ln for ln in ops.strip().splitlines()))


def memoria_corta(e: dict) -> None:
    cambiar_kz(e, con_parche("FinOps: requests al tamaño medido (kubectl top)", "Deployment", "gateway", """
- op: replace
  path: /spec/template/spec/containers/0/resources/requests/memory
  value: 48Mi
- op: replace
  path: /spec/template/spec/containers/0/resources/limits/memory
  value: 48Mi"""), "finops: el gateway usa ≈ 60 MiB según kubectl top; requests de memoria a la mediana", PLATAFORMA)
    esperar_poco(40, "el pod nuevo intenta arrancar")


def sin_requests(e: dict) -> None:
    cambiar_kz(e, con_parche("plataforma: más gateways por nodo", "Deployment", "gateway", """
- op: remove
  path: /spec/template/spec/containers/0/resources/requests/cpu"""),
               "plataforma: quitar el request de CPU del gateway (solo caben 3 por nodo y casi no usan CPU)", PLATAFORMA)
    sh("kubectl", "-n", NS, "rollout", "status", "deploy/gateway", "--timeout=180s", timeout=200)
    esperar_poco(45, "el HPA hace sus cuentas")


def sin_endpoints(e: dict) -> None:
    cambiar_kz(e, con_parche("plataforma: nombres de app homogéneos (classifier-*)", "Service", "gateway", """
- op: replace
  path: /spec/selector
  value: {app.kubernetes.io/name: classifier-gateway}"""),
               "plataforma: etiquetas classifier-* (empezamos por los Services)", PLATAFORMA)
    esperar_poco(5, "el Service se actualiza")


def arranque_lento(e: dict) -> None:
    sys.path.insert(0, str(Path(__file__).resolve().parent / "mundo"))
    from mundo.publicar import poner

    RESPALDO.mkdir(parents=True, exist_ok=True)
    shutil.copy(KZ, RESPALDO / "kustomization.yaml")
    poner("triton", imagenes()["triton"]["grande"])
    git("commit", "-q", "-m", "ci: classifier-triton → engine juguete-2026-11-01 (más capas, mejor top-5)",
        "--", "k8s/kustomization.yaml", extra=CI)
    e["commit"] = git("rev-parse", "HEAD")
    aplicar()
    esperar_poco(90, "el Triton nuevo intenta arrancar")


def acordonar(e: dict) -> None:
    ns = nodos()
    zona_b = [n for n, v in ns.items() if v["workload"] == "gpu-t4" and v["zona"] == "us-east-1b"]
    e["acordonados"] = zona_b
    kubectl("cordon", *zona_b)
    tb = next(p for p in pods("app.kubernetes.io/name=triton") if p["spec"].get("nodeName") in zona_b)
    sh("kubectl", "drain", tb["spec"]["nodeName"], "--ignore-daemonsets", "--delete-emptydir-data", "--timeout=120s", timeout=150)
    esperar_poco(10, "el scheduler busca dónde poner el Triton desalojado")


def desacordonar(e: dict) -> None:
    kubectl("uncordon", *e.get("acordonados", []))


def registro_caido(e: dict) -> None:
    sh("docker", "stop", REGISTRO_CONT, check=True)
    ns = nodos()
    for n, v in ns.items():
        if v["workload"] == "cpu":
            ids = sh("docker", "exec", n, "crictl", "images", "-q", "localhost:5900/classifier-gateway").stdout.split()
            for i in ids:
                sh("docker", "exec", n, "crictl", "rmi", i)
    victima = next(p for p in pods("app.kubernetes.io/name=gateway") if listo(p))
    kubectl("-n", NS, "delete", "pod", victima["metadata"]["name"], "--wait=false")
    esperar_poco(20, "el reemplazo intenta bajar su imagen")


def registro_arriba(e: dict) -> None:
    sh("docker", "start", REGISTRO_CONT, check=True)
    time.sleep(3)
    for p in pods("app.kubernetes.io/name=gateway"):
        if not listo(p):
            kubectl("-n", NS, "delete", "pod", p["metadata"]["name"], "--wait=false")
    sh("kubectl", "-n", NS, "rollout", "status", "deploy/gateway", "--timeout=120s", timeout=150)


def esperar_sano(_e: dict) -> None:
    for d in ("triton", "gateway"):
        sh("kubectl", "-n", NS, "rollout", "status", f"deploy/{d}", "--timeout=300s", timeout=330)


FALLAS = {
    "memoria-corta": dict(
        tipo="config", titulo="El ajuste de FinOps",
        historia="El equipo de FinOps corrió su script de «right-sizing»: miró kubectl top, vio que cada gateway usa ≈ 60 MiB y ajustó los requests. Dice que ahorra 3 GiB por nodo. Producción sigue contestando.",
        explica="Un patch en k8s/kustomization.yaml (commit de plataforma) bajó la memoria del gateway a 48Mi, request y techo. kubectl top mide un gateway en reposo; en su peor momento (2 decodes de fotos de 40 MP y 16 requests en vuelo) usa ≈ 880 MB. El pod nuevo pasa el techo al arrancar, el kernel lo mata (OOMKilled, código 137) y queda en CrashLoopBackOff. Como maxUnavailable es 0, los gateways viejos siguen atendiendo y el despliegue se queda a medias. Arreglo: python verificar.py, kubectl -n classifier get pods, kubectl -n classifier describe pod <el nuevo> (Last State: OOMKilled), git log -p k8s/kustomization.yaml, git revert del commit y kubectl apply -k k8s/. El tamaño se decide con el peor momento, no con la mediana.",
        aplicar=memoria_corta, deshacer=lambda e: (deshacer_kz(e), esperar_sano(e))),
    "sin-requests": dict(
        tipo="config", titulo="Más gateways por nodo",
        historia="Plataforma avisa: «quitamos el request de CPU del gateway; casi no usa CPU y así caben más de 3 por nodo». El despliegue terminó bien y todo contesta.",
        explica="Un patch en k8s/kustomization.yaml quitó requests.cpu del gateway. El HPA mide la CPU como porcentaje del request: sin request no tiene contra qué dividir, se queda en <unknown> (ScalingActive=False, FailedGetResourceMetric: missing request for cpu) y ya no sube con un pico. Además, el scheduler ya no reserva CPU: en un pico se amontonan gateways en un nodo que no los aguanta. Arreglo: python verificar.py hpa, kubectl -n classifier describe hpa gateway, git log -p k8s/kustomization.yaml, git revert y kubectl apply -k k8s/.",
        aplicar=sin_requests, deshacer=lambda e: (deshacer_kz(e), esperar_sano(e))),
    "sin-endpoints": dict(
        tipo="config", titulo="Nombres homogéneos",
        historia="Plataforma está poniendo nombres homogéneos (classifier-…) en todas las etiquetas. Empezaron por los Services. La app dice que las fotos no se clasifican; los pods están todos Running y listos.",
        explica="Un patch en k8s/kustomization.yaml cambió el selector del Service gateway a app.kubernetes.io/name: classifier-gateway, pero los pods siguen con la etiqueta gateway. Un Service reparte entre los pods que su selector encuentra: no encuentra ninguno, su EndpointSlice queda vacío y el NodePort no tiene a quién mandar. Los pods están sanos: el problema está en el cable, no en el programa. Arreglo: python verificar.py servicio, kubectl -n classifier get endpointslices -l kubernetes.io/service-name=gateway (sin direcciones), kubectl -n classifier get svc gateway -o yaml (el selector) contra kubectl -n classifier get pods --show-labels, git revert y kubectl apply -k k8s/.",
        aplicar=sin_endpoints, deshacer=deshacer_kz),
    "arranque-lento": dict(
        tipo="mundo", titulo="El engine nuevo",
        historia="El equipo de modelos publicó un engine nuevo (juguete-2026-11-01, «más capas, mejor top-5») y el CI ya lo subió al repositorio de despliegue. Producción sigue contestando con el modelo de octubre.",
        explica="La imagen nueva de Triton tarda ≈ 75 s en cargar su engine y tu startupProbe le da 60 s (5 × 12). A los 60 s el kubelet la mata, la vuelve a arrancar y otra vez: CrashLoopBackOff. Los dos Tritons viejos siguen sirviendo (maxUnavailable 0) y el despliegue se queda a medias. Arreglo: python verificar.py probes, kubectl -n classifier get pods (RESTARTS sube), kubectl -n classifier describe pod <el nuevo> (Startup probe failed … connection refused, y Killing) y kubectl -n classifier logs <el nuevo> (deserializando el engine ≈ 75 s); recalcula la startup con margen (≥ 1.5 × 75 s, por ejemplo 5 × 30 = 150 s) en k8s/triton.yaml, commit y kubectl apply -k k8s/. Lo que no se hace: quitar la startup ni subir la liveness.",
        aplicar=arranque_lento, deshacer=lambda e: (deshacer_kz(e), esperar_sano(e))),
    "zona-acordonada": dict(
        tipo="infra", titulo="El mantenimiento de la zona b",
        historia="Plataforma empezó a actualizar el driver de NVIDIA en los nodos T4 de la zona us-east-1b y se fue a comer. Producción contesta, pero el canal de alertas dice «triton: 1 de 2 listos».",
        explica="Los dos nodos T4 de us-east-1b están acordonados (cordon: nadie nuevo se agenda ahí) y el de su Triton se vació (drain; el PDB dejó sacar uno). El reemplazo no cabe en la zona b y en la zona a no puede ir: ya hay uno allá y DoNotSchedule con maxSkew 1 prefiere Pending a dos Tritons en la misma zona. Una sola T4 carga todo el tráfico. Arreglo: python verificar.py triton, kubectl -n classifier describe pod <el Pending> (didn't match pod topology spread constraints / node(s) were unschedulable), kubectl get nodes (SchedulingDisabled) y, al confirmar con plataforma que el mantenimiento acabó, kubectl uncordon de los dos nodos.",
        aplicar=acordonar, deshacer=lambda e: (desacordonar(e), esperar_sano(e))),
    "registro-caido": dict(
        tipo="infra", titulo="El registro que nadie mira",
        historia="Un nodo de CPU se recicló (imágenes borradas) y un gateway se movió. Todo lo demás sigue contestando; hay un pod que no arranca.",
        explica="El registro (dojo-k8s-registro, el ECR del dojo) está apagado y el nodo ya no tiene la imagen del gateway: el pod nuevo no la puede bajar (ErrImagePull, luego ImagePullBackOff, con esperas que crecen hasta 5 min). Los pods que ya corrían siguen bien: su imagen ya está en el nodo. Arreglo: python verificar.py imagenes, kubectl -n classifier describe pod <el que no arranca> (Failed to pull image … connection refused), python mundo/cluster.py estado (registro: apagado), python mundo/cluster.py registro arrancar y, para no esperar el backoff, kubectl -n classifier delete pod <el que no arranca>. En C01: un endpoint de VPC o un permiso de ECR que se cayó.",
        aplicar=registro_caido, deshacer=registro_arriba),
}


# ---------------------------------------------------------------- comandos
def h(sal: str, falla: str) -> str:
    return hashlib.sha256(f"{sal}|{falla}".encode()).hexdigest()


def activa(e: dict) -> str | None:
    return next((f for f in FALLAS if h(e["sal"], f) == e["hash"]), None) if e else None


def verificar(silencio: bool = True) -> list[str]:
    import verificar as v

    r = v.correr(list(v.CHECKS), silencio=silencio)
    return [k for k, (ok, _) in r.items() if not ok]


def romper(mostrar: bool, cual: str | None) -> None:
    if leer_json(ESTADO):
        sys.exit("✗ ya hay una falla activa: python romper.py --verificar (o --restaurar)")
    print("  revisando que todo esté sano (≈ 10 s)…")
    malos = verificar()
    if malos:
        sys.exit(f"✗ antes de romper, todo tiene que pasar verificar.py (falla: {', '.join(malos)})")
    if cual and cual not in FALLAS:
        sys.exit(f"✗ no existe la falla «{cual}». Hay: {', '.join(FALLAS)}")
    falla = cual or secrets.choice(list(FALLAS))
    e = {"sal": secrets.token_hex(8), "inicio": datetime.now(timezone.utc).isoformat(), "mostrada": mostrar}
    e["hash"] = h(e["sal"], falla)
    f = FALLAS[falla]
    f["aplicar"](e)
    escribir_json(ESTADO, e)
    if mostrar:
        print(f"\n[solo para Claude] falla: {falla} · tipo: {f['tipo']} · {f['titulo']}\n  {f['explica']}\n")
    print(f"⚠ Historia: {f['historia']}")
    print(f"\nEmpezó: {datetime.now():%H:%M}. Tu turno: python verificar.py, y a diagnosticar.")


def cerrar(e: dict, falla: str, como: str) -> None:
    f = FALLAS[falla]
    if como != "Restaurada":
        from taller.registro import anotar_falla

        anotar_falla(falla, e["inicio"], e.get("mostrada", False), rendido=como == "Revelada")
    minutos = (datetime.now(timezone.utc) - datetime.fromisoformat(e["inicio"])).total_seconds() / 60
    print(f"{como}: era «{falla}» · {f['titulo']} · {minutos:.0f} min\n  {f['explica']}")
    if como != "✓ arreglado":
        print("  restaurando…")
        f["deshacer"](e)
    ESTADO.unlink()
    shutil.rmtree(RESPALDO, ignore_errors=True)
    malos = verificar()
    print("✓ listo para otra falla" if not malos else
          f"⚠ falla: {', '.join(malos)} (corre verificar.py; «estable» se pone en verde 2 min después del último reinicio)")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mostrar", action="store_true")
    ap.add_argument("--falla")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--verificar", action="store_true")
    g.add_argument("--revelar", action="store_true")
    g.add_argument("--restaurar", action="store_true")
    a = ap.parse_args()
    e = leer_json(ESTADO)
    if not (a.verificar or a.revelar or a.restaurar):
        return romper(a.mostrar, a.falla)
    falla = activa(e)
    if not falla:
        sys.exit("No hay ninguna falla activa.")
    if a.verificar:
        malos = verificar(silencio=False)
        if malos:
            sys.exit(f"\n✗ todavía no: {len(malos)} check(s) sin pasar")
        print()
        return cerrar(e, falla, "✓ arreglado")
    cerrar(e, falla, "Revelada" if a.revelar else "Restaurada")


if __name__ == "__main__":
    main()
