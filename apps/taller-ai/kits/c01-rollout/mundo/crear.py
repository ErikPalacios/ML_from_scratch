"""Levanta el mundo de la estación 10 (≈ 4 min la primera vez; baja ≈ 1.5 GB de imágenes):

    python3 mundo/crear.py            # crea lo que falte; si ya existe, lo deja como está
    python3 mundo/crear.py --de-cero  # borra el clúster y el registro y empieza otra vez (tus archivos se quedan)

Qué deja:
- El «ECR» del dojo: registry:2.8.3 en localhost:5910 (contenedor dojo-rollout-registro).
- El clúster dojo-rollout: el de la estación 9 (Kubernetes 1.35.5 en kind, 1 control plane + 6 nodos: cpu-a, cpu-b y
  cuatro «T4» en dos zonas). La llave queda en .kube/config.
- Argo Rollouts v1.10.2 (su manifiesto oficial, mundo/argo-rollouts.yaml), el «ALB» del dojo en localhost:8910 y
  Prometheus v3.15.1 en localhost:9910 (mundo/plataforma.yaml).
- Las imágenes, por digest (mundo/imagenes.json): el gateway (construido de esta carpeta), un Triton por versión de
  modelo (14, 15, el del ensayo y el 16), y el ALB.
- Esta carpeta como el repositorio de despliegue (git) y la release 14 corriendo: triton-v14 (2 pods, uno por zona),
  el gateway (3 pods, un Deployment) y el Ingress. El registro de modelos con v14 @champion y v15 @challenger.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import (CLUSTER, GATEWAY, GPU, IMAGEN_NODO, IMAGENES, K8S, KUBECONFIG, NODOS, NS, PROMETHEUS,  # noqa: E402
                         RAIZ, REGISTRO, REGISTRO_CONT, escribir_json, esperar, git, http, kubectl, nombre_nodo,
                         referencia, sh)
from mundo import modelos  # noqa: E402

PLATAFORMA = {"GIT_AUTHOR_NAME": "Equipo de plataforma", "GIT_AUTHOR_EMAIL": "plataforma@c01.test",
              "GIT_COMMITTER_NAME": "Equipo de plataforma", "GIT_COMMITTER_EMAIL": "plataforma@c01.test"}
INICIALES = ["triton-v14.yaml", "gateway.yaml", "ingress.yaml", "triton-v15.yaml", "analisis.yaml"]
# Los modelos de juguete por versión: (carpeta en mundo/modelos, número en el registro, model_version)
VERSIONES = {"v14": ("v14", "14", "resnet50-2026-10-01"), "v15": ("v15", "15", "resnet50-2026-11-01"),
             "ensayo": ("dudoso", "ensayo", "ensayo-roto"), "v16": ("sesgado", "16", "resnet50-2026-11-15")}


def paso(msg: str) -> None:
    print(f"· {msg}", flush=True)


def docker_env() -> dict:
    """Un DOCKER_CONFIG sin credsStore: en esta Mac, el ayudante de credenciales de Docker Desktop se cuelga al bajar
    imágenes públicas. Los plugins (buildx) se ven por un symlink a la carpeta original."""
    d = RAIZ / ".taller" / "docker"
    d.mkdir(parents=True, exist_ok=True)
    (d / "config.json").write_text("{}\n")
    plug = d / "cli-plugins"
    origen = Path.home() / ".docker" / "cli-plugins"
    if not plug.exists() and origen.is_dir():
        plug.symlink_to(origen, target_is_directory=True)
    return {"DOCKER_CONFIG": str(d)}


def revisar_herramientas() -> None:
    for h, como in (("docker", "Docker Desktop"), ("kind", "brew install kind"), ("kubectl", "brew install kubectl"),
                    ("git", "xcode-select --install"),
                    ("kubectl-argo-rollouts", "brew install argoproj/tap/kubectl-argo-rollouts")):
        if not shutil.which(h):
            sys.exit(f"✗ falta {h}: {como}")
    r = sh("docker", "info", "--format", "{{json .}}")
    if r.returncode != 0:
        sys.exit("✗ Docker no contesta: abre Docker Desktop")
    info = json.loads(r.stdout)
    if info.get("NCPU", 0) < 6 or info.get("MemTotal", 0) < 7.5 * 2**30:
        sys.exit(f"✗ Docker tiene {info.get('NCPU')} CPU y {info.get('MemTotal', 0) / 2**30:.1f} GiB: "
                 "el mundo necesita ≥ 6 CPU y ≥ 8 GiB (Docker Desktop → Settings → Resources)")
    otros = [c for c in sh("kind", "get", "clusters").stdout.split() if c != CLUSTER]
    if otros:
        print(f"  ⚠ hay otro clúster de kind corriendo ({', '.join(otros)}): dos clústeres a la vez no caben bien en "
              f"8 GiB. Apágalo con: docker stop $(docker ps -q --filter name={otros[0]}-)")


def registro() -> None:
    r = sh("docker", "inspect", "-f", "{{.State.Running}}", REGISTRO_CONT)
    if r.returncode != 0:
        paso(f"el registro ({REGISTRO})")
        sh("docker", "run", "-d", "--restart=always", "-p", f"127.0.0.1:{REGISTRO.split(':')[1]}:5000",
           "-e", "REGISTRY_STORAGE_DELETE_ENABLED=true", "--name", REGISTRO_CONT, "registry:2.8.3",
           check=True, extra=docker_env(), timeout=600)
    elif r.stdout.strip() != "true":
        sh("docker", "start", REGISTRO_CONT, check=True)


def cluster() -> None:
    if CLUSTER in sh("kind", "get", "clusters").stdout.split():
        paso(f"el clúster {CLUSTER} ya existe")
        sh("kind", "export", "kubeconfig", "--name", CLUSTER, "--kubeconfig", str(KUBECONFIG), check=True)
        return
    ncpu = json.loads(sh("docker", "info", "--format", "{{json .}}").stdout)["NCPU"]
    cfg = (RAIZ / "mundo" / "kind.yaml").read_text().replace("cpu=6,", f"cpu={max(ncpu - 4, 0)},")
    KUBECONFIG.parent.mkdir(exist_ok=True)
    tmp = KUBECONFIG.parent / "kind.yaml"
    tmp.write_text(cfg)
    paso(f"el clúster {CLUSTER}: Kubernetes {IMAGEN_NODO.split(':')[1]}, 1 control plane + {len(NODOS)} nodos (≈ 1–3 min)")
    sh("kind", "create", "cluster", "--image", IMAGEN_NODO, "--config", str(tmp), "--kubeconfig", str(KUBECONFIG),
       "--wait", "120s", check=True, timeout=900, extra=docker_env())


def conectar_registro() -> None:
    """El patrón «local registry» de kind: el registro en la red de kind y un hosts.toml en cada nodo."""
    redes = sh("docker", "inspect", "-f", "{{json .NetworkSettings.Networks}}", REGISTRO_CONT).stdout
    if '"kind"' not in redes:
        sh("docker", "network", "connect", "kind", REGISTRO_CONT, check=True)
    toml = f'[host."http://{REGISTRO_CONT}:5000"]\n'
    for n in sh("kind", "get", "nodes", "--name", CLUSTER).stdout.split():
        d = f"/etc/containerd/certs.d/{REGISTRO}"
        sh("docker", "exec", n, "mkdir", "-p", d, check=True)
        sh("docker", "exec", "-i", n, "cp", "/dev/stdin", f"{d}/hosts.toml", entrada=toml, check=True)


def nodos() -> None:
    paso("las zonas, los tipos de máquina, las T4 y su taint")
    for i, (apodo, tipo, wl, zona) in enumerate(NODOS):
        n = nombre_nodo(i)
        kubectl("label", "node", n, "--overwrite", f"topology.kubernetes.io/zone={zona}", "topology.kubernetes.io/region=us-east-1",
                f"node.kubernetes.io/instance-type={tipo}", f"workload={wl}", f"dojo/apodo={apodo}")
        if wl == "gpu-t4":
            kubectl("taint", "node", n, "--overwrite", f"{GPU}=present:NoSchedule")
            kubectl("patch", "node", n, "--subresource=status", "--type=json",
                    "-p", json.dumps([{"op": "add", "path": "/status/capacity/nvidia.com~1gpu", "value": "1"}]))


def construir(nombre: str, tag: str, dockerfile: str, contexto: str, args: dict, env: dict) -> str:
    ref = f"{REGISTRO}/{nombre}:{tag}"
    cmd = ["docker", "build", "-q", "-f", dockerfile, "-t", ref]
    for k, v in args.items():
        cmd += ["--build-arg", f"{k}={v}"]
    sh(*cmd, contexto, check=True, timeout=900, extra=env)
    out = sh("docker", "push", ref, check=True, timeout=600, extra=env).stdout
    m = re.search(r"digest: (sha256:[0-9a-f]{64})", out)
    if not m:
        raise RuntimeError(f"no vi el digest al subir {ref}: {out[-300:]}")
    return f"{REGISTRO}/{nombre}@{m.group(1)}"


def imagenes() -> None:
    paso("las imágenes: se construyen y se suben al registro (≈ 1–2 min la primera vez)")
    env = docker_env()
    img = {"gateway": {}, "triton": {}}
    img["gateway"]["actual"] = construir("classifier-gateway", "2026-11-01-9c3e7a1", "gateway/Dockerfile", ".",
                                         {"REVISION": "9c3e7a1"}, env)
    for clave, (carpeta, _num, mv) in VERSIONES.items():
        img["triton"][clave] = construir("classifier-triton", mv, "mundo/triton_dojo/Dockerfile", "mundo",
                                         {"CARGA_S": "20", "MODELO": mv, "MODELO_DIR": carpeta}, env)
    img["alb"] = construir("dojo-alb", "1", "mundo/alb/Dockerfile", "mundo/alb", {}, env)
    escribir_json(IMAGENES, {"nota": "Lo que publicó el CI (estación 8). En C01: 123456789012.dkr.ecr.us-east-1.amazonaws.com/…",
                             **img})


def plataforma() -> None:
    paso("Argo Rollouts v1.10.2, el «ALB» del dojo y Prometheus")
    kubectl("apply", "-f", str(K8S / "namespace.yaml"))
    kubectl("create", "namespace", "argo-rollouts", check=False)
    kubectl("apply", "--server-side", "--force-conflicts", "-n", "argo-rollouts", "-f", "mundo/argo-rollouts.yaml", timeout=300)
    alb = json.loads(IMAGENES.read_text())["alb"]
    kubectl("apply", "-f", "-", entrada=(RAIZ / "mundo" / "plataforma.yaml").read_text().replace("{{ALB_IMAGEN}}", alb))
    for ns, d in (("argo-rollouts", "argo-rollouts"), ("dojo-alb", "alb"), ("monitoreo", "prometheus")):
        kubectl("-n", ns, "rollout", "status", f"deploy/{d}", "--timeout=300s", timeout=330)


KUSTOMIZATION = """# El repositorio de despliegue de classifier: lo que Argo CD aplica al namespace classifier en C01. Aquí lo aplicas
# tú: kubectl apply -k k8s/
# Es del equipo de plataforma; lo tuyo son los archivos de «resources» que dicen TUYO.
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: classifier
resources:
  - namespace.yaml
  - triton-v14.yaml    # TUYO: el Triton de la versión 14 (Deployment, Service y PDB)
  - triton-v15.yaml    # TUYO: el Triton de la versión 15
  - gateway.yaml       # TUYO: el gateway (un Deployment; en el paso 5, un Rollout) y sus Services
  - ingress.yaml       # TUYO: la entrada del ALB
  - analisis.yaml      # TUYO: el AnalysisTemplate del canary
# Los labels y la versión de cada modelo (en C01: classifier-labels-14, classifier-labels-15). Un ConfigMap por versión,
# con nombre fijo: el gateway de cada release monta el de SU versión.
configMapGenerator:
  - name: classifier-modelo-14
    files: [modelo.json=modelo-14.json]
  - name: classifier-modelo-15
    files: [modelo.json=modelo-15.json]
generatorOptions:
  disableNameSuffixHash: true
  labels: {{app.kubernetes.io/name: gateway}}
# Lo escribe el CI al publicar (python3 mundo/publicar.py …): siempre un digest, nunca un tag.
# En tus manifiestos, la imagen se llama solo «classifier-gateway», «classifier-triton-v14» o «classifier-triton-v15».
images:
  - name: classifier-gateway
    newName: {gw_repo}
    digest: {gw_dig}
  - name: classifier-triton-v14
    newName: {t14_repo}
    digest: {t14_dig}
  - name: classifier-triton-v15
    newName: {t15_repo}
    digest: {t15_dig}
"""

NAMESPACE = """# El namespace de producción de classifier. Del equipo de plataforma.
apiVersion: v1
kind: Namespace
metadata:
  name: classifier
"""


def ficha(clave: str) -> dict:
    """El modelo.json de una versión: el de la estación 9 con su model_version, su número y la huella de su engine."""
    base = json.loads((RAIZ / "servir" / "modelo.json").read_text())
    carpeta, num, mv = VERSIONES[clave]
    base.update(version=num, model_version=mv, engine_sha256=referencia()["modelos"][carpeta]["engine_sha256"])
    return base


def repositorio() -> None:
    paso("esta carpeta como el repositorio de despliegue")
    K8S.mkdir(exist_ok=True)
    img = json.loads(IMAGENES.read_text())
    gw, t14, t15 = img["gateway"]["actual"].split("@"), img["triton"]["v14"].split("@"), img["triton"]["v15"].split("@")
    nuevo = not (RAIZ / ".git").exists()
    if nuevo:
        git("init", "-q", "-b", "main")
        git("config", "user.name", "tu")
        git("config", "user.email", "tu@c01.test")
    kz = K8S / "kustomization.yaml"
    if not kz.exists():
        kz.write_text(KUSTOMIZATION.format(gw_repo=gw[0], gw_dig=gw[1], t14_repo=t14[0], t14_dig=t14[1],
                                           t15_repo=t15[0], t15_dig=t15[1]))
    (K8S / "namespace.yaml").write_text(NAMESPACE)
    for clave in ("v14", "v15"):
        escribir_json(K8S / f"modelo-{clave[1:]}.json", ficha(clave))
    for f in INICIALES:
        if not (K8S / f).exists():
            shutil.copy(RAIZ / "mundo" / "esqueleto" / "k8s" / f, K8S / f)
    for f in ("gateway/app/sombra.py", "sombra/reporte.py", "ci/promover.py", "RUNBOOK.md"):
        if not (RAIZ / f).exists():
            (RAIZ / f).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(RAIZ / "mundo" / "esqueleto" / f, RAIZ / f)
    if nuevo:
        git("add", "-A")
        git("commit", "-q", "-m", "classifier: la release 14 en producción (lo que dejó la estación 9)", extra=PLATAFORMA)


def produccion() -> None:
    paso("la release 14 en producción: triton-v14 (≈ 30 s) y el gateway")
    kubectl("apply", "-k", "k8s/", timeout=120)
    kubectl("-n", NS, "rollout", "status", "deploy/triton-v14", "--timeout=300s", timeout=330)
    if kubectl("-n", NS, "get", "deploy", "gateway", "--ignore-not-found", "-o", "name", check=False).strip():
        kubectl("-n", NS, "rollout", "status", "deploy/gateway", "--timeout=300s", timeout=330)
    ok = esperar(lambda: http(f"{GATEWAY}/v1/classify", (RAIZ / "mundo" / "fotos" / "f-000.jpg").read_bytes())[0] == 200, 90, 2)
    if not ok:
        sys.exit(f"✗ el gateway no contesta por el ALB ({GATEWAY}): python3 mundo/cluster.py estado")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--de-cero", action="store_true")
    a = ap.parse_args()
    t0 = time.time()
    revisar_herramientas()
    if a.de_cero:
        paso("borrando el clúster, el registro y el registro de modelos")
        sh("kind", "delete", "cluster", "--name", CLUSTER, "--kubeconfig", str(KUBECONFIG))
        sh("docker", "rm", "-f", REGISTRO_CONT)
        modelos.MODELOS.unlink(missing_ok=True)
    registro()
    cluster()
    conectar_registro()
    nodos()
    if not IMAGENES.exists() or a.de_cero:
        imagenes()
    repositorio()
    plataforma()
    produccion()
    modelos.crear()
    st, _ = http(f"{PROMETHEUS}/-/ready")
    print(f"✓ el mundo está listo en {time.time() - t0:.0f} s" + ("" if st == 200 else " (Prometheus todavía no contesta)"))
    print("  Antes de usar kubectl en esta terminal:  export KUBECONFIG=$PWD/.kube/config")


if __name__ == "__main__":
    os.chdir(RAIZ)
    main()
