"""Las versiones de lo que escribe la persona en cada paso del Guiado, sacadas de la solución (probar.sh las usa).

    python pasos.py rastro 1     # paso 1: request_id y la línea de log, sin métricas (la etiqueta de fuente aún no)
    python pasos.py rastro 3     # paso 3: con las métricas; se_traza todavía apagado
    python pasos.py rastro 6     # paso 6: completo (= gateway/app/rastro.py de la solución)
    python pasos.py reglas 5     # paso 5: las recording rules y las dos alertas del servicio
    python pasos.py reglas 7     # paso 7: + LogsStale
    python pasos.py reglas 9     # paso 9: + GatewaySinLectura y ALB5xx (= observabilidad/reglas.yml de la solución)
"""
import sys
from pathlib import Path

import yaml

SOL = Path(__file__).resolve().parent


def rastro(n: int) -> str:
    t = (SOL / "gateway" / "app" / "rastro.py").read_text()
    if n >= 6:
        return t
    t = t.replace('def se_traza(rid: str, fraccion: float) -> bool:\n    return int(hashlib.sha256(rid.encode()).hexdigest()[:8], 16) < fraccion * 2**32',
                  'def se_traza(rid: str, fraccion: float) -> bool:\n    return False                         # paso 6')
    if n >= 3:
        return t
    t = t.replace('def fuente(header: str | None, fuentes: list[str]) -> str:\n    f = (header or "").strip().lower()\n    return f if f in fuentes else "other"',
                  'def fuente(header: str | None, fuentes: list[str]) -> str:\n    return "other"                       # paso 3')
    i, j = t.index("        v = self.version\n"), t.index("        self.en_vuelo = Gauge(")
    t = t[:i] + t[j:]
    for m in ("bytes", "pre", "inferencia", "top1"):
        a = t.index(f"    def {m}(")
        b = t.index("\n\n", a)
        firma = t[a:t.index("\n", a)]
        t = t[:a] + firma + "\n        pass" + t[b:]
    a = t.index("        self.requests.labels(str(status)")
    b = t.index("            self.latencia.labels(fuente_, self.version).observe(s, exemplar=ej)\n") + len(
        "            self.latencia.labels(fuente_, self.version).observe(s, exemplar=ej)\n")
    return t[:a] + "        # paso 3: las sumas\n" + t[b:]


def reglas(n: int) -> str:
    texto = (SOL / "observabilidad" / "reglas.yml").read_text()
    if n >= 9:
        return texto
    d = yaml.safe_load(texto)
    quitar = {"GatewaySinLectura", "ALB5xx"} | ({"LogsStale"} if n < 7 else set())
    for g in d["groups"]:
        g["rules"] = [r for r in g["rules"] if r.get("alert") not in quitar]
    cabeza = "".join(l + "\n" for l in texto.splitlines() if l.startswith("#"))
    return cabeza + yaml.safe_dump(d, allow_unicode=True, sort_keys=False, width=120)


if __name__ == "__main__":
    que, n = sys.argv[1], int(sys.argv[2])
    print({"rastro": rastro, "reglas": reglas}[que](n), end="")
