"""Piezas compartidas del mundo, de verificar.py y de romper.py (estación 9). No es parte de lo que escribes.

No lo leas para resolver un paso: el contrato de cada herramienta está arriba de ella.
"""
from __future__ import annotations

import json
import os
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
TALLER = RAIZ / ".taller"                 # estado de romper.py (git lo ignora)
KUBECONFIG = RAIZ / ".kube" / "config"    # la llave del clúster del dojo; tu ~/.kube/config no se toca
IMAGENES = RAIZ / "mundo" / "imagenes.json"   # lo que crear.py publicó en el registro, con su digest
K8S = RAIZ / "k8s"                        # el repositorio de despliegue: lo que tú escribes vive aquí

CLUSTER = "dojo-k8s"                      # el clúster de kind (Kubernetes en contenedores de Docker)
VERSION_K8S = "v1.35.5"                   # la de EKS en C01, noviembre de 2026
IMAGEN_NODO = "kindest/node:v1.35.5"
NS = "classifier"                         # el namespace de producción
REGISTRO = "localhost:5900"               # el «ECR» del dojo: registry:2 en tu Mac (el 5000 lo ocupa AirPlay)
REGISTRO_CONT = "dojo-k8s-registro"       # su contenedor, conectado también a la red «kind»
GATEWAY = "http://localhost:8901"         # el «ALB interno»: el NodePort 30901 del gateway, publicado en tu Mac
NODEPORT = 30901
GPU = "nvidia.com/gpu"                    # el recurso que anuncia el device plugin de NVIDIA en cada T4

# Los seis nodos de trabajo, en el orden en que kind los nombra (dojo-k8s-worker, -worker2, …).
NODOS = [
    # (apodo, tipo de máquina en C01, workload, zona)
    ("cpu-a", "c6i.xlarge", "cpu", "us-east-1a"),
    ("cpu-b", "c6i.xlarge", "cpu", "us-east-1b"),
    ("t4-a1", "g4dn.xlarge", "gpu-t4", "us-east-1a"),
    ("t4-b1", "g4dn.xlarge", "gpu-t4", "us-east-1b"),
    ("t4-a2", "g4dn.xlarge", "gpu-t4", "us-east-1a"),
    ("t4-b2", "g4dn.xlarge", "gpu-t4", "us-east-1b"),
]


def nombre_nodo(i: int) -> str:
    return f"{CLUSTER}-worker" + ("" if i == 0 else str(i + 1))


def env() -> dict:
    return {**os.environ, "KUBECONFIG": str(KUBECONFIG)}


def sh(*cmd: str, check: bool = False, timeout: float = 600, entrada: str | None = None, cwd: Path | None = None,
       extra: dict | None = None) -> subprocess.CompletedProcess:
    r = subprocess.run(cmd, cwd=cwd or RAIZ, capture_output=True, text=True, timeout=timeout, input=entrada,
                       env={**env(), **(extra or {})})
    if check and r.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd[:4])}…: {(r.stderr or r.stdout).strip()[-600:]}")
    return r


def kubectl(*a: str, check: bool = True, timeout: float = 120, entrada: str | None = None) -> str:
    return sh("kubectl", *a, check=check, timeout=timeout, entrada=entrada).stdout


def kjson(*a: str) -> dict:
    """kubectl get … -o json, ya leído. Si no existe, {}."""
    r = sh("kubectl", "get", *a, "-o", "json", timeout=60)
    if r.returncode != 0:
        if "NotFound" in r.stderr or "not found" in r.stderr:
            return {}
        raise RuntimeError(r.stderr.strip()[-400:])
    return json.loads(r.stdout)


def git(*a: str, check: bool = True, extra: dict | None = None) -> str:
    return sh("git", *a, check=check, extra=extra).stdout.strip()


def leer_json(p: Path, defecto=None):
    try:
        return json.loads(p.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return defecto


def escribir_json(p: Path, d) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n")


def http(url: str, datos: bytes | None = None, tipo: str = "image/jpeg", timeout: float = 5) -> tuple[int, bytes]:
    req = urllib.request.Request(url, data=datos, method="POST" if datos is not None else "GET")
    if datos is not None:
        req.add_header("Content-Type", tipo)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except (urllib.error.URLError, OSError, TimeoutError):
        return 0, b""


def esperar(cond, segundos: float, paso: float = 1.0) -> bool:
    fin = time.time() + segundos
    while time.time() < fin:
        try:
            if cond():
                return True
        except Exception:  # noqa: BLE001
            pass
        time.sleep(paso)
    return False


def foto(nombre: str = "foto.jpg") -> bytes:
    return (RAIZ / "mundo" / nombre).read_bytes()


def nodos() -> dict[str, dict]:
    """Los nodos de trabajo por nombre, con su apodo, zona, workload y si se puede agendar en ellos."""
    out = {}
    for n in kjson("nodes").get("items", []):
        lb = n["metadata"].get("labels", {})
        if "node-role.kubernetes.io/control-plane" in lb:
            continue
        listo = any(c["type"] == "Ready" and c["status"] == "True" for c in n["status"].get("conditions", []))
        out[n["metadata"]["name"]] = {"apodo": lb.get("dojo/apodo", "?"), "zona": lb.get("topology.kubernetes.io/zone"),
                                      "workload": lb.get("workload"), "listo": listo,
                                      "acordonado": bool(n["spec"].get("unschedulable")),
                                      "gpu": n["status"].get("allocatable", {}).get(GPU, "0")}
    return out


def pods(selector: str) -> list[dict]:
    return kjson("pods", "-n", NS, "-l", selector).get("items", [])


def listo(p: dict) -> bool:
    return p.get("metadata", {}).get("deletionTimestamp") is None and any(
        c["type"] == "Ready" and c["status"] == "True" for c in p.get("status", {}).get("conditions", []))


def imagenes() -> dict:
    return leer_json(IMAGENES, {})


def corto(img: str) -> str:
    """repo@sha256:abcdef… → repo@sha256:abcdef123456"""
    if "@sha256:" in img:
        a, d = img.split("@sha256:")
        return f"{a.rsplit('/', 1)[-1]}@sha256:{d[:12]}"
    return img
