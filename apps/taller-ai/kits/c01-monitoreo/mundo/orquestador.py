"""El orquestador del pipeline (no es parte de lo que escribes): lo que en C01 es Argo Workflows con el CronWorkflow
reentreno-mensual (estaciones 2 a 5). Aquí no entrena: anota la corrida y dice lo que pasaría.

    python mundo/orquestador.py submit --from cronwf/reentreno-mensual --ticket <id>   # adelantar la corrida del mes
    python mundo/orquestador.py lista

Un reentrenamiento adelantado lo lanza una persona, por un ticket que ella misma decidió con «reentrenar»
(mundo/tickets.py decidir). Sin eso, el orquestador se niega: el monitoreo no despliega ni reentrena solo.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import BUSCAPERSONAS, LOGS, escribir_json, http, leer_json  # noqa: E402

CORRIDAS = LOGS / "orquestador.json"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("accion", choices=["submit", "lista"])
    ap.add_argument("--from", dest="origen")
    ap.add_argument("--ticket")
    a = ap.parse_args()
    corridas = leer_json(CORRIDAS, [])
    if a.accion == "lista":
        for c in corridas or [{"nombre": "(ninguna)", "ticket": "", "corte": "", "creada": ""}]:
            print(f"{c['nombre']}  ticket {c['ticket']}  snapshot ds-{c['corte']}  {c['creada']}")
        return
    if a.origen != "cronwf/reentreno-mensual":
        sys.exit("✗ solo existe el CronWorkflow reentreno-mensual: --from cronwf/reentreno-mensual")
    if not a.ticket:
        sys.exit("✗ ¿por qué ticket? Una corrida adelantada siempre dice qué la pidió: --ticket <id>")
    st, b, _ = http(f"{BUSCAPERSONAS}/api/tickets")
    t = next((x for x in (json.loads(b) if st == 200 else []) if x["id"] == a.ticket), None)
    if not t:
        sys.exit(f"✗ no hay ticket {a.ticket} (python mundo/tickets.py)")
    if (t.get("decision") or {}).get("accion") != "reentrenar":
        sys.exit(f"✗ el ticket {a.ticket} no está decidido con «reentrenar» (está: "
                 f"{(t.get('decision') or {}).get('accion', 'sin decidir')}). Primero diagnostica y decide: "
                 "python mundo/tickets.py decidir …")
    if any(c["ticket"] == a.ticket for c in corridas):
        sys.exit(f"✗ ya hay una corrida por {a.ticket}: python mundo/orquestador.py lista")
    ahora = datetime.now(timezone.utc)
    c = {"nombre": f"reentreno-mensual-adelantado-{ahora:%Y%m%d%H%M}", "ticket": a.ticket, "slice": t.get("slice"),
         "corte": f"{ahora:%Y-%m-%d}", "creada": ahora.isoformat(timespec="seconds")}
    corridas.append(c)
    escribir_json(CORRIDAS, corridas)
    print(f"✓ {c['nombre']} (por {a.ticket}). En C01, a partir de aquí:\n"
          f"  1. snapshot ds-{c['corte']} con los labels vigentes hoy, más la tanda extra de {c['slice']} cuando llegue\n"
          "  2. entrenamiento (≈ 4–5 h, ≈ US$3–4 de GPU)\n"
          "  3. el mismo gate contra el champion, la paridad del engine, shadow, canary 5 % → 25 % → 100 % y bake\n"
          "  La corrida del día 1 sigue igual.")


if __name__ == "__main__":
    main()
