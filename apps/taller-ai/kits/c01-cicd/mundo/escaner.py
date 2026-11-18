"""El escáner de imágenes del dojo (como Trivy). Se usa; no se toca.

    python mundo/escaner.py image <imagen> [--severity CRITICAL[,HIGH…]] [--ignore-unfixed] [--exit-code N]
                                           [--ignorefile .trivyignore.yaml] [--format table|cyclonedx] [--output f]

Hace el inventario de la imagen (su SBOM: los paquetes de Python con pip y los del sistema con dpkg, corriendo la
imagen sin red) y lo cruza con una base de avisos congelada (mundo/avisos.json, avisos DE EJEMPLO). Los flags son los
de Trivy: --severity filtra qué severidades cuentan, --ignore-unfixed calla lo que aún no tiene parche, --exit-code es
el código de salida si queda algún hallazgo (0 por omisión: solo informa) y --ignorefile lee las excepciones
(vulnerabilities: [{id, statement, expired_at}]); una excepción vencida ya no calla nada.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import yaml  # noqa: E402

from mundo.comun import KIT, docker  # noqa: E402

ORDEN = ["UNKNOWN", "LOW", "MEDIUM", "HIGH", "CRITICAL"]


def version(v: str) -> tuple:
    return tuple(int(x) for x in re.findall(r"\d+", v)[:4])


def afecta(regla: str, v: str) -> bool:
    if regla == "*":
        return True
    m = re.match(r"(<=|<|>=|>|==)(.+)", regla)
    op, lim = m.groups()
    a, b = version(v), version(lim)
    return {"<": a < b, "<=": a <= b, ">": a > b, ">=": a >= b, "==": a == b}[op]


def inventario(imagen: str) -> list[dict]:
    r = docker("run", "--rm", "--network", "none", "--entrypoint", "sh", imagen, "-c",
               "python -m pip list --format=json 2>/dev/null; echo '@@@'; dpkg-query -W -f='${Package} ${Version}\\n'",
               timeout=120)
    if r.returncode != 0:
        sys.exit(f"✗ no pude correr la imagen {imagen} para hacer su inventario: {r.stderr.strip()[-300:]}")
    py, deb = r.stdout.split("@@@")
    pk = [{"tipo": "python", "nombre": p["name"].lower(), "version": p["version"]} for p in json.loads(py)]
    pk += [{"tipo": "debian", "nombre": n, "version": v} for n, v in (ln.split(" ", 1) for ln in deb.strip().splitlines())]
    return pk


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("modo", choices=["image"])
    ap.add_argument("imagen")
    ap.add_argument("--severity", default=",".join(ORDEN))
    ap.add_argument("--ignore-unfixed", action="store_true")
    ap.add_argument("--exit-code", type=int, default=0)
    ap.add_argument("--ignorefile")
    ap.add_argument("--format", default="table", choices=["table", "cyclonedx"])
    ap.add_argument("--output")
    a = ap.parse_args()

    pk = inventario(a.imagen)
    if a.format == "cyclonedx":
        sbom = {"bomFormat": "CycloneDX", "specVersion": "1.6", "metadata": {"component": {"type": "container", "name": a.imagen}},
                "components": [{"type": "library", "name": p["nombre"], "version": p["version"],
                                "purl": f"pkg:{'pypi' if p['tipo'] == 'python' else 'deb/debian'}/{p['nombre']}@{p['version']}"} for p in pk]}
        texto = json.dumps(sbom, indent=1)
        Path(a.output).write_text(texto) if a.output else print(texto)
        print(f"SBOM: {len(pk)} paquetes ({sum(p['tipo'] == 'python' for p in pk)} de Python, "
              f"{sum(p['tipo'] == 'debian' for p in pk)} del sistema)", file=sys.stderr)
        return
    base = json.loads((KIT / "mundo" / "avisos.json").read_text())
    severidades = {s.strip().upper() for s in a.severity.split(",")}
    excepciones = {}
    if a.ignorefile:
        f = Path(a.ignorefile)
        datos = yaml.safe_load(f.read_text()) if f.exists() else None
        for x in (datos or {}).get("vulnerabilities") or []:
            excepciones[x["id"]] = x
    hallazgos, callados = [], []
    for av in base["avisos"]:
        for p in pk:
            if p["tipo"] == av["tipo"] and p["nombre"] == av["paquete"] and afecta(av["afecta"], p["version"]):
                h = {**av, "instalada": p["version"]}
                if av["severidad"] not in severidades:
                    continue
                if a.ignore_unfixed and not av["corregida"]:
                    continue
                ex = excepciones.get(av["id"])
                if ex:
                    vence = ex.get("expired_at")
                    if vence and date.fromisoformat(str(vence)) < date.today():
                        h["nota"] = f"la excepción venció el {vence}"
                    else:
                        callados.append((h, ex))
                        continue
                hallazgos.append(h)
    print(f"{a.imagen} · {len(pk)} paquetes · base de avisos del {base['actualizada']} · severidades {','.join(sorted(severidades, key=ORDEN.index))}"
          f"{' · sin las que no tienen parche' if a.ignore_unfixed else ''}")
    for h in hallazgos:
        print(f"  {h['severidad']:<8} {h['id']}  {h['paquete']} {h['instalada']} → {h['corregida'] or 'sin parche'}  {h['titulo']}"
              f"{'  (' + h['nota'] + ')' if h.get('nota') else ''}")
    for h, ex in callados:
        print(f"  callado  {h['id']}  {h['paquete']} {h['instalada']} · excepción hasta {ex.get('expired_at', 'SIN FECHA')}: {ex.get('statement', '')}")
    print(f"Total: {len(hallazgos)}" + (f" · {len(callados)} con excepción" if callados else ""))
    sys.exit(a.exit_code if hallazgos else 0)


if __name__ == "__main__":
    main()
