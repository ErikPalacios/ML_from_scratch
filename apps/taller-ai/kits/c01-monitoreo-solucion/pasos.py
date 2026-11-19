"""Las versiones de lo que escribe la persona en cada paso del Guiado, sacadas de la solución (probar.sh las usa).

    python pasos.py reglas 1      # paso 1: las 4 recording rules del error y las dos alertas de burn rate
    python pasos.py reglas 3      # paso 3: + la baja confianza (su recording rule y ClassifierLowConfidenceSpike)
    python pasos.py reglas 4      # paso 4: + MonitoringJobStale y Watchdog (= observabilidad/reglas.yml de la solución)
    python pasos.py pruebas 2     # paso 2: las pruebas del burn rate
    python pasos.py pruebas 4     # paso 4: todas (= observabilidad/pruebas.yml de la solución)
"""
import sys
from pathlib import Path


SOL = Path(__file__).resolve().parent
OBS = SOL / "observabilidad"


def cabeza(texto: str) -> str:
    return "".join(l + "\n" for l in texto.splitlines() if l.startswith("#"))


def reglas(n: int) -> str:
    texto = (OBS / "reglas.yml").read_text()
    if n >= 4:
        return texto
    grupos = {"classifier-slo"} | ({"classifier-modelo"} if n >= 3 else set())
    # se corta el texto por grupos para conservar los comentarios
    partes = texto.split("\n  - name: ")
    out = partes[0]
    for p in partes[1:]:
        if p.split("\n", 1)[0].strip() in grupos:
            out += "\n  - name: " + p
    return out.rstrip() + "\n"


def pruebas(n: int) -> str:
    texto = (OBS / "pruebas.yml").read_text()
    if n >= 4:
        return texto
    i = texto.index("  # 3. La baja confianza")
    return texto[:i].rstrip() + "\n"


if __name__ == "__main__":
    que, n = sys.argv[1], int(sys.argv[2])
    print({"reglas": reglas, "pruebas": pruebas}[que](n), end="")
