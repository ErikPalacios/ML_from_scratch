"""La cola de tickets y los avisos del buscapersonas, para la persona que decide (no es parte de lo que escribes).

    python mundo/tickets.py                      # los tickets: abiertos y decididos, con su acción sugerida
    python mundo/tickets.py ver <id>             # uno completo: evidencia y diagnóstico
    python mundo/tickets.py decidir <id> --accion avisar-dueno --nota "la app 5.2 comprime de más; avisé a su equipo"
    python mundo/tickets.py avisos [n]           # las últimas n notificaciones (page, canal, tickets, latido)

Acciones: rollback · avisar-dueno · etiquetar · reentrenar · nada. Decidir es de una persona: el disparador sugiere,
no decide. En C01 esto es la cola de Jira del equipo y PagerDuty.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import BUSCAPERSONAS, http  # noqa: E402


def lista() -> list[dict]:
    st, b, _ = http(f"{BUSCAPERSONAS}/api/tickets")
    if st != 200:
        sys.exit("✗ el buscapersonas no contesta: python mundo/servicios.py arrancar buscapersonas")
    return json.loads(b)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("accion", nargs="?", default="lista", choices=["lista", "ver", "decidir", "avisos"])
    ap.add_argument("id", nargs="?")
    ap.add_argument("--accion", dest="que")
    ap.add_argument("--nota", default="")
    a = ap.parse_args()
    if a.accion == "lista":
        ts = lista()
        if not ts:
            print("(no hay tickets)")
        for t in ts:
            sug = (t.get("accion_sugerida") or {}).get("accion", "—")
            dec = (t.get("decision") or {}).get("accion")
            print(f"{'✔' if dec else '·'} {t['id']}\n    {t['titulo']}\n    sugerida: {sug}"
                  + (f" · decidida: {dec} ({t['decision']['nota']})" if dec else " · sin decidir"))
    elif a.accion == "ver":
        t = next((x for x in lista() if x["id"] == a.id), None)
        if not t:
            sys.exit(f"no hay ticket {a.id}")
        print(json.dumps(t, ensure_ascii=False, indent=1))
    elif a.accion == "decidir":
        if not a.id or not a.que:
            sys.exit("uso: python mundo/tickets.py decidir <id> --accion <rollback|avisar-dueno|etiquetar|reentrenar|nada> --nota \"…\"")
        st, b, _ = http(f"{BUSCAPERSONAS}/api/tickets/{a.id}/decision", "POST",
                        json.dumps({"accion": a.que, "nota": a.nota, "quien": "tú"}, ensure_ascii=False).encode(),
                        {"Content-Type": "application/json"})
        if st != 200:
            sys.exit(f"✗ {st}: {b.decode(errors='replace')}")
        print(f"✓ {a.id}: {a.que}" + (f" · {a.nota}" if a.nota else ""))
        if a.que == "reentrenar":
            print("  Sigue: python mundo/orquestador.py submit --from cronwf/reentreno-mensual --ticket " + a.id)
    else:
        n = int(a.id or 15)
        st, b, _ = http(f"{BUSCAPERSONAS}/api/avisos")
        for x in (json.loads(b) if st == 200 else [])[-n:]:
            if "alertas" in x:
                print(f"{x['recibido']} {x['receptor']:<8} {x['status']:<9} "
                      + ", ".join(f"{y['alertname']} ({y['status']})" for y in x["alertas"]))
            else:
                print(f"{x['recibido']} {x['receptor']:<8} " + json.dumps({k: v for k, v in x.items() if k not in ('recibido', 'receptor')}, ensure_ascii=False))


if __name__ == "__main__":
    main()
