"""El reporte del shadow (en C01, el job diario): une las dos líneas de log de cada request_id y decide, con los umbrales
escritos antes (sombra/umbrales.json), si el challenger sigue al canary.

    python3 mundo/logs.py > sombra/evidencia.jsonl      # las líneas de log de todos los gateways
    python3 sombra/reporte.py sombra/evidencia.jsonl     # imprime el reporte y escribe sombra/reporte.json

Contrato (lo revisa verificar.py sombra):
- Lee las líneas de JSON del archivo. Una línea del champion tiene status 200 y no tiene «shadow»; una de la sombra
  tiene shadow: true. Un par es un request_id con las dos, las dos con status 200.
- Mide: pares; acuerdo top-1 (fracción de pares con la misma primera categoría); el p99 de ms.triton del challenger
  contra el del champion en esos mismos pares; las caídas del Triton del challenger (los reinicios de sus pods, con
  kubectl); las copias que no llegaron (status ≠ 200); y el acuerdo en las N categorías más grandes del champion.
- Escribe sombra/reporte.json con: champion, challenger (sus model_version), pares, acuerdo_top1, p99_champion_ms,
  p99_challenger_ms, p99_razon, caidas, copias_fallidas, por_categoria {label: acuerdo}, desacuerdos (hasta 20
  request_id para que los revise una persona), umbrales, fallan (lista de lo que no pasa) y veredicto «sigue» o «frena».
- Sale con 0 si sigue y con 1 si frena.
"""
from __future__ import annotations

import json
import math
import subprocess
import sys
from collections import Counter
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
LABELS = json.loads((RAIZ / "servir" / "modelo.json").read_text())["labels"]


def p99(xs: list[float]) -> float:
    xs = sorted(xs)
    return xs[max(0, math.ceil(0.99 * len(xs)) - 1)] if xs else float("nan")


def caidas(version: str) -> int:
    r = subprocess.run(["kubectl", "-n", "classifier", "get", "pods", "-l",
                        f"app.kubernetes.io/name=triton,classifier/modelo={version}", "-o", "json"],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"✗ kubectl: {r.stderr.strip()} (¿export KUBECONFIG=$PWD/.kube/config?)")
    return sum(cs.get("restartCount", 0) for p in json.loads(r.stdout)["items"]
               for cs in p.get("status", {}).get("containerStatuses", []))


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit("uso: python3 sombra/reporte.py sombra/evidencia.jsonl")
    u = json.loads((RAIZ / "sombra" / "umbrales.json").read_text())
    champ, sombra, fallidas = {}, {}, 0
    for ln in Path(sys.argv[1]).read_text().splitlines():
        try:
            ev = json.loads(ln)
        except json.JSONDecodeError:
            continue
        if "request_id" not in ev:
            continue
        if ev.get("shadow"):
            if ev.get("status") == 200:
                sombra[ev["request_id"]] = ev
            else:
                fallidas += 1
        elif ev.get("status") == 200 and ev.get("top5"):
            champ[ev["request_id"]] = ev
    pares = [(champ[r], sombra[r]) for r in sombra if r in champ]
    if not pares:
        sys.exit("✗ no hay pares: ¿la sombra está prendida y corrió la carga? (python3 mundo/logs.py --resumen)")
    v_champ, v_chall = pares[0][0]["model_version"], pares[0][1]["model_version"]
    iguales = [c["top5"][0][0] == s["top5"][0][0] for c, s in pares]
    acuerdo = sum(iguales) / len(pares)
    p_c = p99([c["ms"]["triton"] for c, _ in pares])
    p_s = p99([s["ms"]["triton"] for _, s in pares])
    grandes = [i for i, _ in Counter(c["top5"][0][0] for c, _ in pares).most_common(u["categorias_grandes"])]
    por_cat = {}
    for i in grandes:
        de_i = [ok for (c, _), ok in zip(pares, iguales) if c["top5"][0][0] == i]
        por_cat[LABELS[i]] = round(sum(de_i) / len(de_i), 4)
    num = v_chall_num = None
    for p in (RAIZ / "k8s").glob("modelo-*.json"):              # de model_version a número de versión
        if json.loads(p.read_text())["model_version"] == v_chall:
            v_chall_num = p.stem.split("-")[1]
    num = caidas(v_chall_num) if v_chall_num else 0
    fallan = []
    if len(pares) < u["pares_min"]:
        fallan.append(f"pares: {len(pares)} < {u['pares_min']}")
    if acuerdo < u["acuerdo_top1_min"]:
        fallan.append(f"acuerdo top-1: {acuerdo:.1%} < {u['acuerdo_top1_min']:.0%}")
    if p_s > u["p99_max_vs_champion"] * p_c:
        fallan.append(f"p99: {p_s:.1f} ms > {u['p99_max_vs_champion']} × {p_c:.1f} ms")
    if num > u["caidas_max"]:
        fallan.append(f"caídas del Triton del challenger: {num}")
    for lb, a in por_cat.items():
        if a < u["acuerdo_por_categoria_min"]:
            fallan.append(f"acuerdo en {lb}: {a:.1%} < {u['acuerdo_por_categoria_min']:.0%}")
    rep = {"champion": v_champ, "challenger": v_chall, "pares": len(pares), "acuerdo_top1": round(acuerdo, 4),
           "p99_champion_ms": p_c, "p99_challenger_ms": p_s, "p99_razon": round(p_s / p_c, 3) if p_c else None,
           "caidas": num, "copias_fallidas": fallidas, "por_categoria": por_cat,
           "desacuerdos": [c["request_id"] for (c, _), ok in zip(pares, iguales) if not ok][:20],
           "umbrales": u, "fallan": fallan, "veredicto": "frena" if fallan else "sigue"}
    (RAIZ / "sombra" / "reporte.json").write_text(json.dumps(rep, ensure_ascii=False, indent=2) + "\n")
    print(f"shadow {v_chall} contra {v_champ}")
    print(f"  pares            {len(pares):>8,}   (mínimo {u['pares_min']:,})")
    print(f"  acuerdo top-1    {acuerdo:>8.1%}   (mínimo {u['acuerdo_top1_min']:.0%})")
    print(f"  p99 de Triton    {p_s:>6.1f} ms   contra {p_c:.1f} ms del champion (máximo × {u['p99_max_vs_champion']})")
    print(f"  caídas           {num:>8}   (máximo {u['caidas_max']})")
    print(f"  copias fallidas  {fallidas:>8}")
    for lb, a in por_cat.items():
        print(f"  acuerdo {lb:<9}{a:>8.1%}   (mínimo {u['acuerdo_por_categoria_min']:.0%})")
    print(f"  a revisión       {len(rep['desacuerdos'])} desacuerdos: {', '.join(rep['desacuerdos'][:3])}…")
    print(("✗ FRENA: " + "; ".join(fallan)) if fallan else "✓ SIGUE al canary")
    sys.exit(1 if fallan else 0)


if __name__ == "__main__":
    main()
