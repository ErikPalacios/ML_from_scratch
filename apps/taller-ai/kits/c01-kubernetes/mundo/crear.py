"""Levanta el mundo de la estación 9 (≈ 3 min la primera vez; baja ≈ 1.3 GB de la imagen de los nodos):

    python mundo/crear.py            # crea lo que falte; si ya existe, lo deja como está
    python mundo/crear.py --de-cero  # borra el clúster y el registro y empieza otra vez (tus k8s/*.yaml se quedan)

Qué deja:
- El «ECR» del dojo: registry:2.8.3 en localhost:5900 (contenedor dojo-k8s-registro).
- El clúster dojo-k8s: Kubernetes 1.35.5 en kind, con un control plane y seis nodos de trabajo (mundo/kind.yaml):
  cpu-a y cpu-b (como c6i.xlarge) y t4-a1, t4-b1, t4-a2, t4-b2 (como g4dn.xlarge, una «T4» cada uno), en las zonas
  us-east-1a y us-east-1b. La llave queda en .kube/config: tu ~/.kube/config no se toca.
- Cada nodo T4 anuncia nvidia.com/gpu: 1 (lo que haría el device plugin de NVIDIA) y tiene la taint
  nvidia.com/gpu=present:NoSchedule, como el node group de GPU de C01.
- metrics-server (para el HPA), del manifiesto oficial (mundo/metrics-server.yaml).
- Cinco imágenes publicadas por digest (mundo/imagenes.json): el gateway de hoy, el de la semana que entra y uno que
  no arranca; Triton con el modelo de juguete, y Triton con un engine «grande» que tarda más en cargar.
- Esta carpeta como el repositorio de despliegue (git), con k8s/kustomization.yaml, k8s/namespace.yaml y
  k8s/modelo.json del equipo de plataforma, y el esqueleto de lo que escribes (k8s/triton.yaml, gateway.yaml,
  pdb.yaml, hpa.yaml) si todavía no existe.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import (CLUSTER, GPU, IMAGEN_NODO, IMAGENES, K8S, KUBECONFIG, NODOS, RAIZ, REGISTRO,  # noqa: E402
                         REGISTRO_CONT, escribir_json, esperar, git, kubectl, nombre_nodo, sh)

PLATAFORMA = {"GIT_AUTHOR_NAME": "Equipo de plataforma", "GIT_AUTHOR_EMAIL": "plataforma@c01.test",
              "GIT_COMMITTER_NAME": "Equipo de plataforma", "GIT_COMMITTER_EMAIL": "plataforma@c01.test"}
TUYOS = ["triton.yaml", "gateway.yaml", "pdb.yaml", "hpa.yaml"]


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
    for h in ("docker", "kind", "kubectl", "git"):
        if not shutil.which(h):
            sys.exit(f"✗ falta {h}: brew install {'kind' if h == 'kind' else 'kubectl' if h == 'kubectl' else h}")
    r = sh("docker", "info", "--format", "{{json .}}")
    if r.returncode != 0:
        sys.exit("✗ Docker no contesta: abre Docker Desktop")
    info = json.loads(r.stdout)
    if info.get("NCPU", 0) < 6 or info.get("MemTotal", 0) < 7.5 * 2**30:
        sys.exit(f"✗ Docker tiene {info.get('NCPU')} CPU y {info.get('MemTotal', 0) / 2**30:.1f} GiB: "
                 "el mundo necesita ≥ 6 CPU y ≥ 8 GiB (Docker Desktop → Settings → Resources)")
    v = json.loads(sh("kubectl", "version", "--client", "-o", "json").stdout)["clientVersion"]
    menor = int(re.sub(r"\D", "", v["minor"]))
    if not 34 <= menor <= 36:
        print(f"  ⚠ tu kubectl es {v['gitVersion']}: con un servidor 1.35, lo soportado es 1.34–1.36 (±1 versión menor)")


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
    """El patrón «local registry» de la documentación de kind: el registro en la red de kind y, en cada nodo, un
    hosts.toml que manda localhost:5900 a ese contenedor."""
    redes = sh("docker", "inspect", "-f", "{{json .NetworkSettings.Networks}}", REGISTRO_CONT).stdout
    if '"kind"' not in redes:
        sh("docker", "network", "connect", "kind", REGISTRO_CONT, check=True)
    toml = f'[host."http://{REGISTRO_CONT}:5000"]\n'
    for n in sh("kind", "get", "nodes", "--name", CLUSTER).stdout.split():
        d = f"/etc/containerd/certs.d/{REGISTRO}"
        sh("docker", "exec", n, "mkdir", "-p", d, check=True)
        sh("docker", "exec", "-i", n, "cp", "/dev/stdin", f"{d}/hosts.toml", entrada=toml, check=True)
    kubectl("apply", "-f", "-", entrada=f"""apiVersion: v1
kind: ConfigMap
metadata: {{name: local-registry-hosting, namespace: kube-public}}
data:
  localRegistryHosting.v1: |
    host: "{REGISTRO}"
    help: "https://kind.sigs.k8s.io/docs/user/local-registry/"
""")


def nodos() -> None:
    paso("las zonas, los tipos de máquina, las T4 y su taint")
    for i, (apodo, tipo, wl, zona) in enumerate(NODOS):
        n = nombre_nodo(i)
        kubectl("label", "node", n, "--overwrite", f"topology.kubernetes.io/zone={zona}", "topology.kubernetes.io/region=us-east-1",
                f"node.kubernetes.io/instance-type={tipo}", f"workload={wl}", f"dojo/apodo={apodo}")
        if wl == "gpu-t4":
            kubectl("taint", "node", n, "--overwrite", f"{GPU}=present:NoSchedule")
            # Lo que hace el device plugin de NVIDIA al registrarse: anunciar las GPU en la capacidad del nodo.
            kubectl("patch", "node", n, "--subresource=status", "--type=json",
                    "-p", json.dumps([{"op": "add", "path": "/status/capacity/nvidia.com~1gpu", "value": "1"}]))


def metricas() -> None:
    paso("metrics-server (la CPU de cada pod, para el HPA)")
    kubectl("apply", "-f", "mundo/metrics-server.yaml")
    kubectl("-n", "kube-system", "rollout", "status", "deploy/metrics-server", "--timeout=300s", timeout=330)


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
    paso("las imágenes: se construyen y se suben al registro (≈ 1 min la primera vez)")
    env = docker_env()
    img = {"gateway": {}, "triton": {}}
    img["gateway"]["actual"] = construir("classifier-gateway", "2026-10-01-4f2a9c1", "gateway/Dockerfile", ".",
                                         {"REVISION": "4f2a9c1"}, env)
    img["gateway"]["nueva"] = construir("classifier-gateway", "2026-10-08-b71e05d", "gateway/Dockerfile", ".",
                                        {"REVISION": "b71e05d"}, env)
    # La que no arranca: trae un gateway.yaml que pide el modelo «classifier-v5», que este Triton no sirve.
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        for p in ("gateway", "servir", "gateway.yaml", ".dockerignore"):
            (shutil.copytree if (RAIZ / p).is_dir() else shutil.copy)(RAIZ / p, t / p)
        g = t / "gateway.yaml"
        g.write_text(g.read_text().replace("  modelo: classifier\n", "  modelo: classifier-v5\n"))
        img["gateway"]["mala"] = construir("classifier-gateway", "2026-10-09-e03d8aa", "gateway/Dockerfile", str(t),
                                           {"REVISION": "e03d8aa"}, env)
    img["triton"]["actual"] = construir("classifier-triton", "juguete-2026-10-01", "mundo/triton_dojo/Dockerfile", "mundo",
                                        {"CARGA_S": "20", "MODELO": "juguete-2026-10-01"}, env)
    img["triton"]["grande"] = construir("classifier-triton", "juguete-2026-11-01", "mundo/triton_dojo/Dockerfile", "mundo",
                                        {"CARGA_S": "75", "MODELO": "juguete-2026-11-01"}, env)
    escribir_json(IMAGENES, {"nota": "Lo que publicó el CI (estación 8). En C01: 123456789012.dkr.ecr.us-east-1.amazonaws.com/…",
                             **img, "carga_s": {img["triton"]["actual"]: 20, img["triton"]["grande"]: 75}})


KUSTOMIZATION = """# El repositorio de despliegue de classifier: lo que Argo CD aplica al namespace classifier en C01. Aquí lo aplicas
# tú: kubectl apply -k k8s/
# Es del equipo de plataforma; lo tuyo son los archivos de «resources» que dicen TUYO.
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: classifier
resources:
  - namespace.yaml
  - triton.yaml        # TUYO: Deployment + Service de Triton
  - gateway.yaml       # TUYO: Deployment + Service del gateway
  - pdb.yaml           # TUYO: el PodDisruptionBudget de Triton
  - hpa.yaml           # TUYO: el HPA del gateway
configMapGenerator:    # los labels y la huella del modelo que sirve el gateway (en C01: classifier-labels-14)
  - name: classifier-modelo
    files: [modelo.json]
    options:
      labels: {{app.kubernetes.io/name: gateway}}   # la etiqueta del gateway, como el resto de sus objetos
# Lo escribe el CI de la estación 8 al publicar (python mundo/publicar.py …): siempre un digest, nunca un tag.
# En tus manifiestos, la imagen se llama solo «classifier-gateway» o «classifier-triton»; kustomize pone el resto.
images:
  - name: classifier-gateway
    newName: {gw_repo}
    digest: {gw_dig}
  - name: classifier-triton
    newName: {tr_repo}
    digest: {tr_dig}
"""

NAMESPACE = """# El namespace de producción de classifier. Del equipo de plataforma.
apiVersion: v1
kind: Namespace
metadata:
  name: classifier
"""


def repositorio() -> None:
    paso("esta carpeta como el repositorio de despliegue")
    K8S.mkdir(exist_ok=True)
    img = json.loads(IMAGENES.read_text())
    gw, tr = img["gateway"]["actual"].split("@"), img["triton"]["actual"].split("@")
    nuevo = not (RAIZ / ".git").exists()
    if nuevo:
        git("init", "-q", "-b", "main")
        git("config", "user.name", "tu")
        git("config", "user.email", "tu@c01.test")
    kz = K8S / "kustomization.yaml"
    if not kz.exists():
        kz.write_text(KUSTOMIZATION.format(gw_repo=gw[0], gw_dig=gw[1], tr_repo=tr[0], tr_dig=tr[1]))
    (K8S / "namespace.yaml").write_text(NAMESPACE)
    shutil.copy(RAIZ / "servir" / "modelo.json", K8S / "modelo.json")
    for f in TUYOS:
        if not (K8S / f).exists():
            shutil.copy(RAIZ / "mundo" / "esqueleto" / "k8s" / f, K8S / f)
    kubectl("apply", "-f", str(K8S / "namespace.yaml"))
    if nuevo:
        git("add", "-A")
        git("commit", "-q", "-m", "classifier: el repositorio de despliegue (estación 9)", extra=PLATAFORMA)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--de-cero", action="store_true")
    a = ap.parse_args()
    t0 = time.time()
    revisar_herramientas()
    if a.de_cero:
        paso("borrando el clúster y el registro")
        sh("kind", "delete", "cluster", "--name", CLUSTER, "--kubeconfig", str(KUBECONFIG))
        sh("docker", "rm", "-f", REGISTRO_CONT)
    registro()
    cluster()
    conectar_registro()
    nodos()
    metricas()
    if not IMAGENES.exists() or a.de_cero:
        imagenes()
    repositorio()
    ok = esperar(lambda: "metrics.k8s.io" in kubectl("api-resources", "--api-group=metrics.k8s.io", check=False)
                 and kubectl("top", "nodes", check=False).strip() != "", 120, 5)
    print(f"✓ el mundo está listo en {time.time() - t0:.0f} s" + ("" if ok else " (metrics-server todavía no da números)"))
    print("  Antes de usar kubectl en esta terminal:  export KUBECONFIG=$PWD/.kube/config")


if __name__ == "__main__":
    os.chdir(RAIZ)
    main()
