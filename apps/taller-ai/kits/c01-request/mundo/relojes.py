"""Los tres relojes de las últimas requests de mundo/carga.py, unidos por request_id (no es parte de lo que escribes).

    python mundo/relojes.py            # las últimas 500 que mandó el backend con 200

Para cada request junta lo que midió el backend (logs/backend.log), el ALB (TargetResponseTime, logs/alb.log) y el
gateway (ms.total de su línea, en el disco de los nodos), y da el p50 y el p99 de cada reloj y de las diferencias.
Es un join por request_id: sin un nombre común, serían tres montones de números imposibles de casar.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import LOGS, en_nodo, pods  # noqa: E402


def pct(xs: list[float], q: float) -> float:
    s = sorted(xs)
    return s[min(len(s) - 1, int(q * len(s)))] if s else float("nan")


def main() -> None:
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 500
    bk = {}
    for linea in (LOGS / "backend.log").read_text().splitlines()[-20000:]:
        d = json.loads(linea)
        if d["status"] == 200 and d["request_id"] != "-":
            bk[d["request_id"]] = d["ms_backend"]
    ids = list(bk)[-n:]
    alb = {}
    for linea in (LOGS / "alb.log").read_text().splitlines()[-40000:]:
        d = json.loads(linea)
        if d.get("x_request_id") in bk and d.get("target_processing_time", -1) >= 0:
            alb[d["x_request_id"]] = d["target_processing_time"] * 1000
    gw = {}
    codigo = ("import glob,json\nout={}\n"
              "for f in glob.glob('/var/log/pods/*/gateway/*.log'):\n"
              "  for l in open(f,errors='replace').read().splitlines()[-40000:]:\n"
              "    p=l.split(' ',3)\n"
              "    if len(p)==4 and p[3].startswith('{'):\n"
              "      try: d=json.loads(p[3])\n"
              "      except Exception: continue\n"
              "      if isinstance(d.get('ms'),dict) and 'total' in d['ms']: out[d['request_id']]=d['ms']['total']\n"
              "print(json.dumps(out))\n")
    for p in pods():
        r = en_nodo(p["nodo"], codigo, timeout=60)
        if r.returncode == 0 and r.stdout.strip():
            gw.update(json.loads(r.stdout))
    tres = [i for i in ids if i in alb and i in gw]
    if not tres:
        sys.exit("no encontré requests con los tres relojes: corre antes python mundo/carga.py (y que tu rastro.py escriba la línea)")
    filas = [("backend", [bk[i] for i in tres]), ("ALB (TargetResponseTime)", [alb[i] for i in tres]),
             ("gateway (ms.total)", [gw[i] for i in tres]),
             ("backend − ALB (red y ALB)", [bk[i] - alb[i] for i in tres]),
             ("ALB − gateway (red al pod y lo que el gateway no ve)", [alb[i] - gw[i] for i in tres])]
    print(f"{len(tres)} requests con los tres relojes (de las últimas {len(ids)} del backend con 200)\n")
    print(f"{'reloj':<52} {'p50':>8} {'p99':>8}")
    for nombre, xs in filas:
        print(f"{nombre:<52} {pct(xs, 0.5):7.1f}  {pct(xs, 0.99):7.1f}  ms")


if __name__ == "__main__":
    main()
