"""El job «promover» del pipeline: espera a que el Rollout del gateway esté sano al 100 % y mueve el alias champion del
registro de modelos a la versión que quedó de estable. Es el último paso de la escalera: el alias se mueve al final,
cuando ya es verdad.

    python3 ci/promover.py                 # espera hasta 15 min a que el Rollout termine; después, mueve champion
    python3 ci/promover.py --esperar 0     # no espera: si el Rollout no está sano al 100 %, sale con error

Contrato (lo revisa verificar.py alias):
- Lee el Rollout gateway (kubectl -n classifier get rollout gateway -o json). Sano al 100 % = status.phase «Healthy»,
  sin abortar, y el ReplicaSet estable (status.stableRS) es el del template actual (status.currentPodHash).
- Si el Rollout está «Degraded» o abortado, sale con 1 sin tocar nada: champion se queda donde estaba.
- La versión es la etiqueta classifier/modelo del template. Mueve champion a esa versión con python3 mundo/modelos.py
  y le pone dos etiquetas: run (el de esa versión en el registro) y digest (el digest de la imagen de su Triton, el
  Deployment triton-v<versión>).
- Si champion ya está ahí con esas etiquetas, no hace nada y sale con 0 (se puede correr dos veces).
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))
from mundo import modelos  # noqa: E402


def kget(*a: str) -> dict:
    r = subprocess.run(["kubectl", "-n", "classifier", "get", *a, "-o", "json"], capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"✗ kubectl get {' '.join(a)}: {r.stderr.strip()} (¿export KUBECONFIG=$PWD/.kube/config?)")
    return json.loads(r.stdout)


def estado() -> tuple[str, dict]:
    ro = kget("rollout", "gateway")
    st = ro.get("status", {})
    if st.get("abort") or st.get("phase") == "Degraded":
        return "malo", ro
    if (st.get("phase") == "Healthy" and st.get("stableRS") == st.get("currentPodHash")
            and st.get("observedGeneration") == str(ro["metadata"]["generation"])):
        return "sano", ro
    return "en curso", ro


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--esperar", type=int, default=900, help="segundos que espera a que el Rollout termine")
    a = ap.parse_args()
    fin = time.time() + a.esperar
    while True:
        e, ro = estado()
        if e != "en curso" or time.time() >= fin:
            break
        print(f"  el Rollout sigue: {ro.get('status', {}).get('message') or ro.get('status', {}).get('phase')}…", flush=True)
        time.sleep(10)
    if e != "sano":
        st = ro.get("status", {})
        sys.exit(f"✗ el Rollout no está sano al 100 % ({st.get('phase')}: {st.get('message', '')}): champion no se mueve")
    version = ro["spec"]["template"]["metadata"]["labels"]["classifier/modelo"]
    d = kget("deployment", f"triton-v{version}")
    digest = d["spec"]["template"]["spec"]["containers"][0]["image"].split("@")[-1]
    reg = modelos.leer()
    run = reg["versiones"][version]["run"]
    tags = {"run": run, "digest": digest}
    actual = reg["versiones"][version]["tags"]
    if reg["alias"].get("champion") == version and all(actual.get(k) == v for k, v in tags.items()):
        print(f"✓ @champion ya es v{version} ({reg['versiones'][version]['model_version']}): nada que hacer")
        return
    antes = reg["alias"].get("champion")
    modelos.mover("champion", version, tags, quien="ci/promover.py")
    print(f"✓ @champion: v{antes} → v{version} ({reg['versiones'][version]['model_version']}) · run {run} · "
          f"digest {digest[:19]}…")


if __name__ == "__main__":
    main()
