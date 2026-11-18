"""Junta las líneas de log (JSON) de todos los pods del gateway: lo que en C01 leería el job del shadow.

    python3 mundo/logs.py > sombra/evidencia.jsonl     # todas las líneas de todos los gateways vivos
    python3 mundo/logs.py --resumen                    # cuántas hay de cada versión, cuántas de la sombra y cuántos pares

Solo ve los pods que siguen vivos (como kubectl logs): un pod borrado se lleva su log. No es parte de lo que escribes.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import NS, pods, sh  # noqa: E402


def lineas() -> list[dict]:
    out = []
    for p in pods("app.kubernetes.io/name=gateway"):
        r = sh("kubectl", "-n", NS, "logs", p["metadata"]["name"], "--tail=-1", timeout=60)
        for ln in r.stdout.splitlines():
            if ln.startswith("{"):
                try:
                    out.append(json.loads(ln))
                except json.JSONDecodeError:
                    pass
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--resumen", action="store_true")
    a = ap.parse_args()
    ls = lineas()
    if not a.resumen:
        for ev in ls:
            print(json.dumps(ev, ensure_ascii=False))
        return
    c = Counter((ev.get("model_version"), bool(ev.get("shadow"))) for ev in ls)
    for (v, s), n in sorted(c.items(), key=lambda x: str(x)):
        print(f"{v:22} {'sombra' if s else 'atendió':8} {n:>7,}")
    ids = Counter(ev["request_id"] for ev in ls if ev.get("status") == 200 and "request_id" in ev)
    print(f"pares (request_id con dos líneas 200): {sum(1 for n in ids.values() if n == 2):,}")


if __name__ == "__main__":
    main()
