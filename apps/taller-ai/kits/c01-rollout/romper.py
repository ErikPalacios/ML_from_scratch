"""Mete una falla en el mundo, la configuración o la infraestructura. Nunca toca lo que escribes (k8s/triton-v15.yaml,
gateway.yaml, ingress.yaml, analisis.yaml, gateway/app/sombra.py, sombra/reporte.py, ci/promover.py ni RUNBOOK.md):
lo que cambia lo cambia otro equipo, en el clúster, en el registro de modelos o en k8s/kustomization.yaml.

    python3 romper.py                       # una falla al azar, escondida (ronda Romper solo)
    python3 romper.py --mostrar             # al azar, y dice cuál fue (ronda Romper con ayuda; lo lee Claude)
    python3 romper.py --mostrar --falla X   # una falla concreta
    python3 romper.py --verificar           # ¿ya quedó? corre verificar.py; si todo pasa, dice cuál era y restaura
    python3 romper.py --revelar             # me rindo: explica la falla y restaura
    python3 romper.py --restaurar           # deshace la falla activa y deja todo sano

Antes de romper, todo tiene que pasar verificar.py (el final del Guiado: la release 15 al 100 %, en su bake). La falla
activa se guarda como un hash en .taller/: ni tú ni Claude la pueden leer ahí. Una falla trae su propio canary con
carga: romper.py espera hasta ≈ 6 min a que el canary termine antes de devolverte la terminal.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import secrets
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mundo.comun import (IMAGENES, K8S, NS, RAIZ, TALLER, escribir_json, git, imagenes, kjson, kubectl,  # noqa: E402
                         leer_json, sh)
from mundo import modelos  # noqa: E402

ESTADO = TALLER / "romper.json"
RESPALDO = TALLER / "respaldo"
KZ = K8S / "kustomization.yaml"
PLATAFORMA = {"GIT_AUTHOR_NAME": "Equipo de plataforma", "GIT_AUTHOR_EMAIL": "plataforma@c01.test",
              "GIT_COMMITTER_NAME": "Equipo de plataforma", "GIT_COMMITTER_EMAIL": "plataforma@c01.test"}
CI = {"GIT_AUTHOR_NAME": "CI de classifier", "GIT_AUTHOR_EMAIL": "ci@c01.test",
      "GIT_COMMITTER_NAME": "CI de classifier", "GIT_COMMITTER_EMAIL": "ci@c01.test"}


def aplicar() -> None:
    sh("kubectl", "apply", "-k", "k8s/", check=True, timeout=120)


def esperar_sano(_e: dict | None = None) -> None:
    for d in kjson("deployments", "-n", NS, "-l", "app.kubernetes.io/name=triton").get("items", []):
        sh("kubectl", "-n", NS, "rollout", "status", f"deploy/{d['metadata']['name']}", "--timeout=300s", timeout=330)
    sh("kubectl-argo-rollouts", "-n", NS, "status", "gateway", "--timeout", "300s", timeout=330)


# ---------------------------------------------------------------- cambios en kustomization.yaml (otro equipo)
def cambiar_kz(e: dict, nuevo_txt: str, msg: str, quien: dict) -> None:
    RESPALDO.mkdir(parents=True, exist_ok=True)
    shutil.copy(KZ, RESPALDO / "kustomization.yaml")
    KZ.write_text(nuevo_txt)
    git("commit", "-q", "-m", msg, "--", "k8s/kustomization.yaml", extra=quien)
    e["commit"] = git("rev-parse", "HEAD")
    aplicar()


def deshacer_kz(e: dict) -> None:
    if git("log", "--format=%H", f"{e['commit']}..HEAD", "--grep", e["commit"][:7], check=False):
        aplicar()                                   # ya lo revertiste tú
        return
    r = sh("git", "revert", "--no-edit", e["commit"], extra=PLATAFORMA)
    if r.returncode != 0:                           # si ya lo tocaste encima, se regresa el archivo de antes
        sh("git", "revert", "--abort")
        shutil.copy(RESPALDO / "kustomization.yaml", KZ)
        if git("status", "--porcelain", "--", "k8s/kustomization.yaml"):
            git("commit", "-q", "-m", "plataforma: regresa kustomization.yaml", "--", "k8s/kustomization.yaml", extra=PLATAFORMA)
    aplicar()


PARCHE = """
patches:              # {nota}
  - target: {{kind: {kind}, name: {nombre}}}
    patch: |-
{ops}
"""


def con_parche(nota: str, kind: str, nombre: str, ops: list[dict]) -> str:
    cuerpo = "\n".join("      " + ln for ln in json.dumps(ops, ensure_ascii=False, indent=2).splitlines())
    return KZ.read_text().rstrip("\n") + "\n" + PARCHE.format(nota=nota, kind=kind, nombre=nombre, ops=cuerpo)


def version_estable() -> str:
    ro = kjson("rollout", "gateway", "-n", NS)
    return ro["spec"]["template"]["metadata"]["labels"]["classifier/modelo"]


def cargar(segundos: int) -> None:
    """Carga de fondo, desprendida de esta terminal (como el tráfico de la app: no para cuando termina romper.py)."""
    TALLER.mkdir(exist_ok=True)
    with open(TALLER / "carga-falla.log", "w") as f:
        subprocess.Popen([sys.executable, str(RAIZ / "mundo" / "carga.py"), "--por-segundo", "40", "--segundos", str(segundos),
                          "--cada", "60"], stdout=f, stderr=subprocess.STDOUT, start_new_session=True, cwd=RAIZ)


def parar_carga() -> None:
    sh("pkill", "-f", f"{RAIZ}/mundo/carga.py")


# ---------------------------------------------------------------- las fallas
def peso_fantasma(e: dict) -> None:
    ops = [{"op": "replace", "path": "/spec/rules/0/http/paths/0/backend/service/port", "value": {"number": 8080}}]
    cambiar_kz(e, con_parche("plataforma: puertos explícitos en todos los Ingress (ticket PLAT-4412)", "Ingress", "gateway", ops),
               "plataforma: Ingress con puerto explícito (PLAT-4412)", PLATAFORMA)


def bake_corto(e: dict) -> None:
    ops = [{"op": "replace", "path": "/spec/strategy/canary/scaleDownDelaySeconds", "value": 30}]
    cambiar_kz(e, con_parche("finops: no pagar gateways que no atienden (FIN-207)", "Rollout", "gateway", ops),
               "finops: scaleDownDelaySeconds a 30 s (FIN-207)", PLATAFORMA)


def alias_atrasado(e: dict) -> None:
    reg = modelos.leer()
    e["champion"] = reg["alias"]["champion"]
    e["tags"] = reg["versiones"][e["champion"]]["tags"]
    ant = [h["de"] for h in reg["historia"] if h["alias"] == "champion" and h.get("de")]
    modelos.mover("champion", ant[-1] if ant else "14", {}, quien="restauración del respaldo de las 02:00")


def alias_de_vuelta(e: dict) -> None:
    modelos.mover("champion", e["champion"], e["tags"], quien="romper.py --restaurar")


def imagen_parche() -> str:
    img = imagenes()
    if "v15-parche" not in img["triton"]:
        from mundo.crear import construir, docker_env
        print("  (construyendo una imagen, ≈ 20 s)…", flush=True)
        img["triton"]["v15-parche"] = construir("classifier-triton", "resnet50-2026-11-01-p1", "mundo/triton_dojo/Dockerfile",
                                                "mundo", {"CARGA_S": "20", "MODELO": "resnet50-2026-11-01",
                                                          "MODELO_DIR": "v15", "FALLA_PCT": "4"}, docker_env())
        escribir_json(IMAGENES, img)
    return img["triton"]["v15-parche"]


def fuga_en_el_bake(e: dict) -> None:
    from mundo.publicar import poner
    ref = imagen_parche()
    RESPALDO.mkdir(parents=True, exist_ok=True)
    shutil.copy(KZ, RESPALDO / "kustomization.yaml")
    poner("classifier-triton-v15", ref)
    git("commit", "-q", "-m", "ci: classifier-triton-v15 reconstruida con el parche de seguridad de la imagen base (CVE-2026-31337)",
        "--", "k8s/kustomization.yaml", extra=CI)
    e["commit"] = git("rev-parse", "HEAD")
    e["champion"] = modelos.leer()["alias"]["champion"]
    aplicar()
    sh("kubectl", "-n", NS, "rollout", "status", "deploy/triton-v15", "--timeout=300s", timeout=330)
    cargar(240)
    print("  esperando a que las alertas junten evidencia (≈ 60 s)…", flush=True)
    time.sleep(60)


def alias_a_la_estable() -> None:
    """@champion a la release que atiende el 100 %, con su run y el digest de su Triton (lo que haría ci/promover.py)."""
    v = version_estable()
    d = kjson("deployment", f"triton-v{v}", "-n", NS)
    dig = d["spec"]["template"]["spec"]["containers"][0]["image"].split("@")[-1]
    reg = modelos.leer()
    if reg["alias"].get("champion") != v or reg["versiones"][v]["tags"].get("digest") != dig:
        modelos.mover("champion", v, {"run": reg["versiones"][v]["run"], "digest": dig}, quien="romper.py --restaurar")


def fuga_deshacer(e: dict) -> None:
    parar_carga()
    deshacer_kz(e)          # la imagen buena de triton-v15 otra vez; la release que quedó de estable se queda
    esperar_sano()
    alias_a_la_estable()


def canary_dudoso(e: dict) -> None:
    from mundo import ensayo
    ensayo.prender("v16", "triton-v16", "16", "classifier-modelo-16")
    reg = modelos.leer()
    reg["versiones"]["16"] = {"model_version": "resnet50-2026-11-15", "run": "run-2026-11-15-e901", "tags": {}}
    escribir_json(modelos.MODELOS, reg)
    modelos.mover("challenger", "16", {}, quien="pipeline de reentrenamiento")
    tpl = "/spec/template"
    ops = [{"op": "replace", "path": f"{tpl}/metadata/labels/classifier~1modelo", "value": "16"},
           {"op": "replace", "path": f"{tpl}/spec/containers/0/env/0/value", "value": "triton-v16:8000"},
           {"op": "replace", "path": f"{tpl}/spec/volumes/0/configMap/name", "value": "classifier-modelo-16"}]
    cargar(540)
    time.sleep(5)
    cambiar_kz(e, con_parche("ci: release 16 (reentrenamiento de emergencia por la campaña de bolsas)", "Rollout", "gateway", ops),
               "ci: release 16, resnet50-2026-11-15 (reentrenamiento de emergencia; sin sombra por la campaña)", CI)
    print("  el canary de la 16 está corriendo; esperando a que termine (≈ 5 min)…", flush=True)
    fin = time.time() + 420
    while time.time() < fin:
        st = kjson("rollout", "gateway", "-n", NS).get("status", {})
        if st.get("abort") or (st.get("phase") == "Healthy" and st.get("stableRS") == st.get("currentPodHash")
                               and time.time() > fin - 360):
            break
        time.sleep(10)


def canary_dudoso_deshacer(e: dict) -> None:
    parar_carga()
    deshacer_kz(e)
    esperar_sano()
    canary_dudoso_limpiar(e)


def canary_dudoso_limpiar(_e: dict) -> None:
    from mundo import ensayo
    if version_estable() == "16":
        return
    ensayo.apagar("triton-v16", "classifier-modelo-16")
    reg = modelos.leer()
    if reg["alias"].get("challenger") == "16":
        modelos.mover("challenger", "15", {}, quien="limpieza de la release 16")


def par_cruzado(e: dict) -> None:
    img = imagenes()["triton"]
    txt = KZ.read_text()
    repo, dig = img["v14"].split("@")
    import re
    nuevo = re.sub(r"(  - name: classifier-triton-v15\n    newName: )\S+(\n    digest: )\S+", rf"\g<1>{repo}\g<2>{dig}", txt)
    cambiar_kz(e, nuevo, "plataforma: una sola imagen base de Triton para todas las versiones (PLAT-4520)", PLATAFORMA)
    sh("kubectl", "-n", NS, "rollout", "status", "deploy/triton-v15", "--timeout=300s", timeout=330)


FALLAS = {
    "peso-fantasma": dict(
        tipo="config", titulo="Puertos explícitos",
        historia="Plataforma cerró el ticket PLAT-4412: «todos los Ingress con puerto explícito, nada de nombres mágicos». Producción contesta; el próximo canary sale mañana.",
        explica="Un patch en k8s/kustomization.yaml (commit de plataforma) cambió el backend del Ingress gateway de port name: use-annotation a port number: 8080. Con un puerto normal, el ALB (en C01, el AWS Load Balancer Controller) manda todo a gateway-stable e ignora la anotación actions.gateway-stable que escribe Argo Rollouts: el próximo canary «al 5 %» recibiría 0 %, el análisis no juntaría su n mínimo y, al terminar los pasos, la release nueva pasaría al 100 % de golpe, sin evidencia. Hoy no se ve nada: todo contesta 200. Arreglo: python3 verificar.py reparto, kubectl -n classifier get ingress gateway -o yaml (el backend), el /dojo/pesos del ALB (fuente: backend sin anotación), git log -p k8s/kustomization.yaml, git revert del commit y kubectl apply -k k8s/.",
        aplicar=peso_fantasma, deshacer=deshacer_kz),
    "bake-corto": dict(
        tipo="config", titulo="El ahorro de FinOps",
        historia="FinOps (FIN-207) vio en la factura gateways «que no atienden a nadie» durante horas después de cada release y los quitó. Producción contesta normal.",
        explica="Un patch en k8s/kustomization.yaml puso scaleDownDelaySeconds: 30 en el Rollout. Es el valor por omisión de Argo Rollouts: 30 s después de llegar al 100 %, el ReplicaSet anterior del gateway se apaga. Si la release nueva falla en el bake, volver ya no es un cambio de ruteo a algo prendido: hay que levantar pods otra vez. El ahorro es de centavos (pods de CPU) contra el seguro de volver en segundos. Arreglo: python3 verificar.py rollout, kubectl -n classifier get rollout gateway -o jsonpath='{.spec.strategy.canary.scaleDownDelaySeconds}', git log -p k8s/kustomization.yaml, git revert y kubectl apply -k k8s/. Y explicarle a FinOps el costo con la cuenta de la escalera.",
        aplicar=bake_corto, deshacer=deshacer_kz),
    "alias-atrasado": dict(
        tipo="mundo", titulo="El respaldo de las 2 a. m.",
        historia="Anoche se cayó el disco del registro de modelos y lo restauraron del respaldo de las 02:00. Dicen que «no se perdió nada importante». El job de reentrenamiento del mes que entra lee @champion para comparar.",
        explica="El respaldo era de antes de la promoción: @champion volvió a la versión anterior, aunque la que atiende el 100 % es la nueva. Nada se ve en producción (ningún servidor lee el alias), pero el gate del próximo mes compararía el candidato contra el modelo equivocado, y el runbook regresaría a la versión equivocada. Arreglo: python3 verificar.py alias, python3 mundo/modelos.py ver, kubectl argo rollouts -n classifier get rollout gateway (qué release es la estable) y python3 ci/promover.py, que es idempotente: mueve champion a la estable con su run y su digest.",
        aplicar=alias_atrasado, deshacer=alias_de_vuelta),
    "fuga-en-el-bake": dict(
        tipo="infra", titulo="El parche de seguridad",
        historia="Llegó la alerta a las 3 a. m.: «classifier 5xx > 0.5 %». Eres la persona de guardia. La release 15 llegó al 100 % hace rato y la 14 sigue en su bake. Hay carga corriendo.",
        explica="El CI reconstruyó la imagen de triton-v15 con un parche de la imagen base (commit «ci: … CVE-2026-31337») y el cambio se aplicó como un rolling update del Deployment, sin canary: el Triton nuevo truena en ≈ 4 % de las requests. Es exactamente lo que el runbook cubre: revertir sin diagnosticar. La 14 sigue viva (el bake), así que volver es un cambio de ruteo: git revert del commit de la release 15 en k8s/gateway.yaml, kubectl apply -k k8s/ (con rollbackWindow va directo al 100 % de la 14, en segundos) y python3 ci/promover.py --esperar 0 (regresa @champion a la 14, la que quedó de estable, con su run y su digest; modelos.py alias champion 14 movería el alias sin etiquetas). Confirmas con python3 verificar.py servicio alias. Después, con calma, encuentras la causa (git log -p k8s/kustomization.yaml: el digest de triton-v15 cambió) y congelas despliegues. Revertir solo el commit del CI también arregla, pero toma más (un rolling update de Triton) y exige diagnosticar primero.",
        aplicar=fuga_en_el_bake, deshacer=fuga_deshacer),
    "canary-dudoso": dict(
        tipo="config", titulo="La campaña de bolsas",
        historia="Marketing lanzó la campaña de bolsas y el equipo de modelos reentrenó de emergencia: el CI publicó la release 16 y la aplicó. «Sin sombra, no hay tiempo». Hay carga corriendo. romper.py espera a que el canary termine.",
        explica="La versión 16 (resnet50-2026-11-15) se lleva a «bolsas» fotos que eran de otras categorías: confía igual que la 15 (la baja confianza no cambia) y no truena (cero 5xx), pero el PSI de las categorías que predice pasa de 0.1 (≈ 0.19). El análisis del canary la atrapó al 5 % y Argo Rollouts abortó solo: el tráfico ya volvió a la 15. Lo que falta es Git: el repositorio sigue pidiendo la 16, así que el Rollout se queda Degraded. Arreglo: python3 verificar.py rollout, kubectl argo rollouts -n classifier get rollout gateway, kubectl -n classifier get analysisrun (cuál métrica falló y con qué valor), git log (el commit del CI), git revert del commit y kubectl apply -k k8s/; @champion nunca se movió (python3 mundo/modelos.py ver). Sin el PSI, ninguna otra regla la habría frenado.",
        aplicar=canary_dudoso, deshacer=canary_dudoso_deshacer, limpiar=canary_dudoso_limpiar),
    "par-cruzado": dict(
        tipo="config", titulo="Una sola imagen base",
        historia="Plataforma (PLAT-4520) quiere «una sola imagen base de Triton para todas las versiones, menos cosas que parchar». Ya está aplicado; todo contesta 200 y el log dice resnet50-2026-11-01.",
        explica="El commit de plataforma puso en k8s/kustomization.yaml el digest de la imagen de la versión 14 en la entrada classifier-triton-v15. En el dojo (y en C01) la imagen de Triton trae el engine adentro: triton-v15 ahora sirve el modelo de octubre detrás del nombre de la 15. El gateway escribe model_version resnet50-2026-11-01 en cada log porque eso dice su ConfigMap: dos modelos distintos detrás del mismo nombre, y ninguna métrica sabe a cuál culpar. Arreglo: python3 verificar.py par (la huella del engine en triton-v15 es la de la 14), kubectl -n classifier get deploy triton-v14 triton-v15 -o jsonpath='{..image}', git log -p k8s/kustomization.yaml, git revert y kubectl apply -k k8s/.",
        aplicar=par_cruzado, deshacer=lambda e: (deshacer_kz(e), esperar_sano(e))),
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
        sys.exit("✗ ya hay una falla activa: python3 romper.py --verificar (o --restaurar)")
    print("  revisando que todo esté sano (≈ 30 s)…")
    malos = verificar()
    if malos:
        sys.exit(f"✗ antes de romper, todo tiene que pasar verificar.py (falla: {', '.join(malos)})")
    if cual and cual not in FALLAS:
        sys.exit(f"✗ no existe la falla «{cual}». Hay: {', '.join(FALLAS)}")
    falla = cual or secrets.choice(list(FALLAS))
    e = {"sal": secrets.token_hex(8), "inicio": datetime.now(timezone.utc).isoformat(), "mostrada": mostrar}
    e["hash"] = h(e["sal"], falla)
    f = FALLAS[falla]
    escribir_json(ESTADO, e)
    f["aplicar"](e)
    escribir_json(ESTADO, e)
    if mostrar:
        print(f"\n[solo para Claude] falla: {falla} · tipo: {f['tipo']} · {f['titulo']}\n  {f['explica']}\n")
    print(f"⚠ Historia: {f['historia']}")
    print(f"\nEmpezó: {datetime.now():%H:%M}. Tu turno: python3 verificar.py, y a diagnosticar.")


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
    elif f.get("limpiar"):
        f["limpiar"](e)
    parar_carga()
    ESTADO.unlink()
    shutil.rmtree(RESPALDO, ignore_errors=True)
    malos = verificar()
    print("✓ listo para otra falla" if not malos else f"⚠ falla: {', '.join(malos)} (corre python3 verificar.py)")


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
