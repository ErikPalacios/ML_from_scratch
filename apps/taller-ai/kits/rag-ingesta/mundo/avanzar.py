"""Pasa un día en el marketplace: del 20 al 21 de noviembre (9:00 de Ciudad de México). Siempre los mismos cambios.

    python mundo/avanzar.py

Lo que pasa ese día (en la guía, paso 8, está la lista para comparar con lo que ve tu ingestión):
- Wiki: se edita «Devoluciones» (electrónica pasa de 15 a 30 días); alguien vuelve a publicar «Proveedores
  logísticos» sin cambiar nada; se borra la macro «cupón no aplicó»; nace «Caso Envíos Express» dentro de
  «Litigios»; y «Alta de vendedores» queda restringida a líderes de operaciones (sin versión nueva).
- Drive: versión nueva del «Calendario de pagos»; una minuta va a la papelera; «Política de viajes» deja de ser
  de todo el dominio; y «Lineamientos de fotos» solo cambia de nombre (los mismos bytes).
- Jira: 3 tickets con comentarios nuevos, 2 tickets nuevos y uno que pasa a «Solo líderes».
- Políticas: cambia devoluciones.md y llega regalos.md.
Solo se puede avanzar una vez: el día 2 es el último del mundo (para volver al día 1: python mundo/crear.py).
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo import documentos as doc  # noqa: E402
from mundo.comun import DOMINIO, estado, guardar  # noqa: E402
from mundo.crear import bytes_archivo, commit_politicas, guardar_bytes  # noqa: E402

RELOJ = "2026-11-21T15:00:00Z"


def avanzar(e: dict) -> dict:
    w = e["wiki"]["paginas"]
    # wiki: una edición de verdad, una republicación idéntica, un borrado, una página nueva y una restricción nueva
    bloques = [list(b) for b in doc.DEVOLUCIONES]
    bloques[2][2] = [list(f) for f in bloques[2][2]]
    bloques[2][2][0][1] = "30 días"
    bloques.append(["p", "Cambio del 21 de noviembre: electrónica pasa a 30 días, igual que las demás categorías."])
    w["1002"] |= {"version": w["1002"]["version"] + 1, "actualizado": "2026-11-21T14:05:00Z",
                  "cuerpo": doc.html_pagina("SOP", "Devoluciones", "ana.ruiz", [tuple(b) for b in bloques])}
    w["2005"] |= {"version": w["2005"]["version"] + 1, "actualizado": "2026-11-21T14:10:00Z"}
    w["1012"]["borrada"] = True
    w["3006"] = {"id": "3006", "espacio": "LEG", "padre": "3003", "titulo": "Caso Envíos Express", "autor": f"irene.sol@{DOMINIO}",
                 "version": 1, "actualizado": "2026-11-21T14:20:00Z", "restricciones": {"grupos": [], "usuarios": []},
                 "cuerpo": doc.html_pagina("LEG", "Caso Envíos Express", "irene.sol", [
                     ("p", "Reclamación de Envíos Express por penalizaciones de octubre que el marketplace no reconoce."),
                     ("h2", "Estado"), ("p", "En revisión con el área de operaciones; audiencia de conciliación el 3 de diciembre.")])}
    w["2003"]["restricciones"] = {"grupos": [f"group:operaciones-lideres@{DOMINIO}"], "usuarios": []}

    # drive
    fs, cambios = e["drive"]["archivos"], e["drive"]["cambios"]

    def cambio(fid, hora, **campos):
        f = fs[fid]
        f |= campos | {"version": f["version"] + 1, "modifiedTime": f"2026-11-21T{hora}Z"}
        cambios.append({"fileId": fid, "time": f"2026-11-21T{hora}Z"})

    _, nombre, tipo, *_ = next(a for a in doc.ARCHIVOS if a[0] == "d07")
    nuevo = bytes_archivo(tipo, nombre, [["# Calendario de pagos", "Desde diciembre, los pagos a vendedores salen los lunes y los jueves.",
                                          "Si el día de pago es festivo, el pago sale el día hábil siguiente."],
                                         ["# Retenciones", "Se retiene el pago de ventas con una devolución abierta hasta que se cierre."]])
    cambio("d07", "14:30:00", bytes=guardar_bytes("d07", fs["d07"]["version"] + 1, nuevo))
    cambio("d13", "14:32:00", trashed=True)
    fs["d01"]["permissions"] = [p for p in fs["d01"]["permissions"] if p["type"] != "domain"] + [
        {"type": "group", "emailAddress": f"rh@{DOMINIO}", "role": "reader"}]
    cambio("d01", "14:35:00")
    cambio("d08", "14:40:00", name="Lineamientos de fotos de producto (vigente).pdf")

    # jira
    ts = e["jira"]["tickets"]
    for k, hora in (("SOP-3", "14:41"), ("SOP-7", "14:43"), ("SEG-2", "14:44")):
        ts[k]["comentarios"].append({"autor": f"paula.vega@{DOMINIO}", "texto": "La persona confirmó que ya quedó resuelto.", "fecha": f"2026-11-21T{hora}:00Z"})
        ts[k]["actualizado"] = f"2026-11-21T{hora}:00Z"
    ts["SOP-20"] |= {"nivel": "10001", "actualizado": "2026-11-21T14:46:00Z"}
    for n, (titulo, desc) in enumerate([("Reembolso no aparece en la tarjeta", "Pasaron 12 días hábiles y no ve el reembolso."),
                                        ("Paquete entregado en otra dirección", "La guía dice entregado y la persona no lo recibió.")], 41):
        ts[f"SOP-{n}"] = {"key": f"SOP-{n}", "proyecto": "SOP", "titulo": titulo, "descripcion": desc + doc.FIRMA.format(nombre="Paula Vega", n=n),
                          "resolucion": "", "reportero": f"paula.vega@{DOMINIO}", "nivel": None,
                          "creado": f"2026-11-21T14:{n + 7}:00Z", "actualizado": f"2026-11-21T14:{n + 9}:00Z", "comentarios": []}

    # políticas
    a = e["politicas"]["archivos"]
    a["devoluciones.md"] = a["devoluciones.md"].replace("Electrónica: 15 días. Moda, Hogar y Juguetes: 30 días", "Todas las categorías: 30 días")
    a["regalos.md"] = "# Política de regalos\n\nUn pedido marcado como regalo no muestra el precio en el empaque. La devolución la puede pedir quien lo recibe.\n"
    e["politicas"]["commit"] = commit_politicas(a, e["politicas"]["commit"])

    from datetime import datetime, timezone

    e["reloj"], e["dia"] = RELOJ, 2
    e["avanzado_en"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")   # la hora real de tu Mac: verificar.py la usa
    return e


if __name__ == "__main__":
    e = estado()
    if e["dia"] != 1:
        sys.exit("✗ el mundo ya está en el día 2 (para volver al día 1: python mundo/crear.py y vuelve a ingestar)")
    guardar(avanzar(e))
    print(f"✓ pasó un día: el mundo está al {RELOJ}")
    print("  wiki 5 cambios · drive 4 · jira 6 · políticas 2 (la lista está en la guía, paso 8)")
