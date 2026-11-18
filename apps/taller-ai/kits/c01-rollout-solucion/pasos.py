"""Las versiones de k8s/gateway.yaml de cada paso del Guiado, sacadas de los archivos de la solución (probar.sh las usa).

    python3 pasos.py sombra    # paso 3: el Deployment de la estación 9 con la sombra prendida (release 14 → triton-v15)
    python3 pasos.py rollout   # paso 5: el Rollout, todavía con la release 14 y la sombra
    python3 pasos.py ensayo    # paso 7: la release del ensayo (triton-ensayo)
    python3 pasos.py final     # paso 8: la release 15 (= k8s/gateway.yaml de la solución)
"""
import sys
from pathlib import Path

SOL = Path(__file__).resolve().parent
KIT = SOL.parent / "c01-rollout"
SOMBRA = '''            - {name: SOMBRA_URL, value: "triton-v15:8000"}         # la sombra: copia el 10 % al challenger
            - {name: SOMBRA_VERSION, value: "resnet50-2026-11-01"}
            - {name: SOMBRA_FRACCION, value: "0.10"}
'''


def release(t: str, de: str, a: str) -> str:
    return (t.replace(f'classifier/modelo: "{de}"', f'classifier/modelo: "{a}"')
             .replace(f"triton-v{de}:8000", f"triton-{a if not a.isdigit() else 'v' + a}:8000")
             .replace(f"classifier-modelo-{de}}}   # los labels y la versión de la {de}",
                      f"classifier-modelo-{a}}}   # los labels y la versión de la {a}"))


def con_sombra(t: str) -> str:
    ancla = "   # el Triton de SU versión, y solo ese\n"
    assert ancla in t
    return t.replace(ancla, ancla + SOMBRA, 1)


def main() -> None:
    cual = sys.argv[1] if len(sys.argv) > 1 else ""
    final = (SOL / "k8s" / "gateway.yaml").read_text()
    if cual == "sombra":
        print(con_sombra((KIT / "mundo" / "esqueleto" / "k8s" / "gateway.yaml").read_text()), end="")
    elif cual == "rollout":                  # sin el análisis: su AnalysisTemplate llega en el paso 6
        r = release(final, "15", "14")
        i, j = r.index("      analysis:"), r.index("      steps:")
        print(con_sombra(r[:i] + r[j:]), end="")
    elif cual == "ensayo":
        print(release(final, "15", "ensayo"), end="")
    elif cual == "final":
        print(final, end="")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
