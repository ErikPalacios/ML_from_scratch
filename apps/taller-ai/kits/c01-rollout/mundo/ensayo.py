"""El Triton del ensayo: un modelo roto A PROPÓSITO para ensayar el aborto del canary (en C01, Alba lo hace en staging,
el namespace classifier-staging). Lo prende y lo apaga el equipo de plataforma; no está en k8s/ ni en git.

    python3 mundo/ensayo.py prender     # triton-ensayo (1 pod, una T4) + Service + ConfigMap classifier-modelo-ensayo
    python3 mundo/ensayo.py apagar      # lo borra

El modelo del ensayo (model_version «ensayo-roto») contesta la misma categoría que la versión 15, pero con poca
confianza. Para ensayar, el gateway de la release del ensayo apunta a triton-ensayo:8000 y monta
classifier-modelo-ensayo, con classifier/modelo: "ensayo". No es parte de lo que escribes.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import NS, RAIZ, imagenes, kubectl  # noqa: E402

PLANTILLA = RAIZ / "mundo" / "esqueleto" / "k8s" / "triton-v14.yaml"


def manifiesto(nombre: str, etiqueta: str, imagen: str) -> str:
    t = PLANTILLA.read_text()
    t = t[t.index("apiVersion"):].replace("image: classifier-triton-v14 ", f"image: {imagen} ").replace("triton-v14", nombre).replace('classifier/modelo: "14"', f'classifier/modelo: "{etiqueta}"')
    t = t.replace("  replicas: 2\n", "  replicas: 1\n").replace("  minAvailable: 1 ", "  minAvailable: 0 ")
    return t.replace("\nmetadata:\n", f"\nmetadata:\n  namespace: {NS}\n")


def ficha(clave: str, etiqueta: str) -> str:
    from mundo.crear import ficha as f
    return json.dumps(f(clave), ensure_ascii=False, indent=2) + "\n"


def prender(clave: str = "ensayo", nombre: str = "triton-ensayo", etiqueta: str = "ensayo", cm: str = "classifier-modelo-ensayo") -> None:
    img = imagenes()["triton"][clave]
    apagar(nombre, cm)                  # siempre de cero: un pod viejo atascado no debe quedarse con la T4
    kubectl("apply", "-f", "-", entrada=manifiesto(nombre, etiqueta, img))
    cmy = kubectl("-n", NS, "create", "configmap", cm, f"--from-literal=modelo.json={ficha(clave, etiqueta)}",
                  "--dry-run=client", "-o", "yaml")
    kubectl("apply", "-f", "-", entrada=cmy)
    kubectl("-n", NS, "label", "configmap", cm, "--overwrite", "app.kubernetes.io/name=gateway")
    kubectl("-n", NS, "rollout", "status", f"deploy/{nombre}", "--timeout=300s", timeout=330)


def apagar(nombre: str = "triton-ensayo", cm: str = "classifier-modelo-ensayo") -> None:
    for k in (f"deploy/{nombre}", f"service/{nombre}", f"pdb/{nombre}", f"configmap/{cm}"):
        kubectl("-n", NS, "delete", k, "--ignore-not-found", timeout=120)


if __name__ == "__main__":
    accion = sys.argv[1] if len(sys.argv) > 1 else ""
    if accion == "prender":
        prender()
        print("✓ triton-ensayo listo (1 pod). En el template del gateway: TRITON_URL=triton-ensayo:8000, "
              "configMap classifier-modelo-ensayo, classifier/modelo: \"ensayo\"")
    elif accion == "apagar":
        apagar()
        print("✓ triton-ensayo borrado")
    else:
        sys.exit("uso: python3 mundo/ensayo.py prender|apagar")
