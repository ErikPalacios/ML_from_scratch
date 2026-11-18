"""El tablero del clúster del dojo, y prender o apagar sus piezas.

    python mundo/cluster.py estado              # nodos (apodo, zona, T4, acordonado), pods por nodo y el registro
    python mundo/cluster.py registro arrancar   # el «ECR» del dojo (contenedor dojo-k8s-registro)
    python mundo/cluster.py registro parar
    python mundo/cluster.py apagar              # detiene los contenedores del clúster (libera memoria de tu Mac)
    python mundo/cluster.py prender             # los vuelve a arrancar (≈ 1 min hasta que todo está listo)
    python mundo/cluster.py borrar              # borra el clúster y el registro (python mundo/crear.py los recrea)

No es parte de lo que escribes. En C01: la consola de EKS y la de ECR.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import CLUSTER, KUBECONFIG, NS, REGISTRO, REGISTRO_CONT, kjson, nodos, sh  # noqa: E402


def estado() -> None:
    r = sh("docker", "inspect", "-f", "{{.State.Running}}", REGISTRO_CONT)
    print(f"registro {REGISTRO}: {'arriba' if r.stdout.strip() == 'true' else 'apagado' if r.returncode == 0 else 'no existe'}")
    ns = nodos()
    por_nodo: dict[str, list[str]] = {}
    for p in kjson("pods", "-n", NS).get("items", []):
        n = p["spec"].get("nodeName") or "(sin nodo: Pending)"
        por_nodo.setdefault(n, []).append(p["metadata"]["name"].rsplit("-", 2)[0])
    print(f"\n{'nodo':18} {'apodo':6} {'zona':11} {'T4':3} {'estado':22} pods de {NS}")
    for n, v in sorted(ns.items(), key=lambda x: x[1]["apodo"]):
        est = ("Ready" if v["listo"] else "NotReady") + (",SchedulingDisabled" if v["acordonado"] else "")
        lista = por_nodo.get(n, [])
        print(f"{n:18} {v['apodo']:6} {v['zona']:11} {v['gpu']:3} {est:22} {', '.join(sorted(lista)) or '—'}")
    if "(sin nodo: Pending)" in por_nodo:
        print(f"{'Pending':18} {'':6} {'':11} {'':3} {'':22} {', '.join(por_nodo['(sin nodo: Pending)'])}")


def main() -> None:
    a = sys.argv[1:]
    if a == ["estado"] or not a:
        return estado()
    if a[:1] == ["registro"] and a[1:] in (["arrancar"], ["parar"]):
        sh("docker", "start" if a[1] == "arrancar" else "stop", REGISTRO_CONT, check=True)
        print(f"registro: {'arriba' if a[1] == 'arrancar' else 'apagado'}")
        return
    nodos_docker = sh("kind", "get", "nodes", "--name", CLUSTER).stdout.split()
    if a == ["apagar"]:
        sh("docker", "stop", *nodos_docker, REGISTRO_CONT, check=True, timeout=300)
        print("clúster y registro apagados")
    elif a == ["prender"]:
        sh("docker", "start", REGISTRO_CONT, *nodos_docker, check=True, timeout=300)
        print("prendido: espera ≈ 1 min y corre python verificar.py")
    elif a == ["borrar"]:
        sh("kind", "delete", "cluster", "--name", CLUSTER, "--kubeconfig", str(KUBECONFIG), timeout=300)
        sh("docker", "rm", "-f", REGISTRO_CONT)
        print("borrados (python mundo/crear.py los vuelve a crear)")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
