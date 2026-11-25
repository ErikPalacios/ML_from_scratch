"""Pasos 7 y 8 · La ingestión: de cada fuente, lo que cambió; se parsea solo lo que es contenido nuevo y se guarda
por su hash, con su ACL.

    python pipeline/ingestar.py                    # incremental, desde los cursores (la primera vez: todo)
    python pipeline/ingestar.py --barrido          # reconciliación: lo visible contra el catálogo, y las ACL al día
    python pipeline/ingestar.py --doc wiki:1002    # vuelve a traer y parsear un documento
    python pipeline/ingestar.py --fuente wiki      # solo una fuente (se combina con las de arriba)

Contrato (main, la línea de comandos y el resumen, viene dado; tú escribes procesar e incremental en el paso 7 y
barrido en el paso 8):
- Por cada documento que te da el conector (procesar):
  1. Si el catálogo ya tiene esa versión (y no está borrado), no lo traes: «sin_cambios».
  2. Si no, lo traes (traer). None → lápida con motivo «ya no se puede leer» («borrados»).
  3. h = sha256(crudo) («descargados»). Si almacen.tiene_texto(h), no se vuelve a parsear («saltados»);
     si no, parsear y guardar_texto («parseados»). Después, registrar en el catálogo (versión, hash y ACL nuevos).
- Incremental: cambios(cursor) de cada conector; los borrados que trae van a lápida. El cursor de una fuente se
  guarda en almacen/cursores.json SOLO si esa fuente terminó bien.
- --barrido: por fuente, listar() completo. Lo que está vivo en el catálogo y ya no aparece → lápida con motivo
  «ya no está en la fuente», salvo que sean más de freno.max_borrado de los vivos de esa fuente: entonces no borra
  nada de esa fuente y anota «frenado» (casi siempre es un permiso o un token, no media fuente borrada).
  Lo que tiene otra versión se procesa; lo que tiene la misma, se le vuelve a pedir la ACL y se actualiza si cambió
  («acl_cambiadas»). El barrido no mueve los cursores.
- FuenteSinAcceso en una fuente: se anota su error y se sigue con las demás.
- Cada corrida deja almacen/corridas/<fecha>.json: {"inicio", "fin", "modo", "fuentes": {fuente: {las cuentas,
  "llamadas", "esperas_429", "segundos", "error"?, "frenado"?}}}. Sale con código 1 si alguna fuente tuvo error o freno.
"""
from __future__ import annotations

import argparse
import sys
import time
from collections import Counter
from datetime import datetime

from _comun import CORRIDAS, CURSORES, FuenteSinAcceso, ahora, config, escribir_json, leer_json, sha256
import almacen
from conectores import drive, jira, politicas, wiki
from conectores.http import ESPERAS, LLAMADAS
from parsing import parsear

CONECTORES = {"wiki": wiki, "drive": drive, "jira": jira, "politicas": politicas}
CUENTAS = ["vistos", "sin_cambios", "descargados", "parseados", "saltados", "borrados", "acl_cambiadas"]


def procesar(c: dict, con, ref: dict, cuenta: Counter, forzar: bool = False) -> None:
    prev = c.get(ref["doc_id"])
    if prev and not forzar and not prev.get("borrado") and prev["version"] == ref["version"]:
        cuenta["sin_cambios"] += 1
        return
    doc = con.traer(ref)
    if doc is None:
        cuenta["borrados"] += almacen.borrar(c, ref["doc_id"], "ya no se puede leer")
        return
    h = sha256(doc["crudo"])
    cuenta["descargados"] += 1
    if almacen.tiene_texto(h):
        cuenta["saltados"] += 1
        ocr = almacen.leer_texto(h)["necesita_ocr"]
    else:
        p = parsear(doc)
        almacen.guardar_texto(h, p)
        cuenta["parseados"] += 1
        ocr = p["necesita_ocr"]
    almacen.registrar(c, doc, h, ocr)


def incremental(c: dict, nombre: str, con, cursores: dict, cuenta: Counter) -> None:
    refs, borrados, nuevo = con.cambios(cursores.get(nombre))
    cuenta["vistos"] += len(refs)
    for d in borrados:
        cuenta["borrados"] += almacen.borrar(c, d, "la fuente lo borró")
    for r in refs:
        procesar(c, con, r, cuenta)
    cursores[nombre] = nuevo


def barrido(c: dict, nombre: str, con, cuenta: Counter) -> None:
    refs = con.listar()
    cuenta["vistos"] += len(refs)
    visibles = {r["doc_id"] for r in refs}
    vivos = [d for d, x in c.items() if x["fuente"] == nombre and not x.get("borrado")]
    sobran = [d for d in vivos if d not in visibles]
    if vivos and len(sobran) > config()["freno"]["max_borrado"] * len(vivos):
        cuenta["frenado"] = f"quería borrar {len(sobran)} de {len(vivos)} ({len(sobran) / len(vivos):.0%}); no borré nada"
        return
    for d in sobran:
        cuenta["borrados"] += almacen.borrar(c, d, "ya no está en la fuente")
    for r in refs:
        prev = c.get(r["doc_id"])
        if prev and not prev.get("borrado") and prev["version"] == r["version"]:
            nueva = con.acl(r)
            if nueva != prev["acl"]:
                prev["acl"] = nueva
                cuenta["acl_cambiadas"] += 1
            else:
                cuenta["sin_cambios"] += 1
        else:
            procesar(c, con, r, cuenta)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--barrido", action="store_true")
    ap.add_argument("--doc")
    ap.add_argument("--fuente", choices=list(CONECTORES))
    a = ap.parse_args()
    nombres = [a.doc.split(":", 1)[0]] if a.doc else ([a.fuente] if a.fuente else list(CONECTORES))
    modo = "doc" if a.doc else "barrido" if a.barrido else "incremental"
    c, cursores = almacen.catalogo(), leer_json(CURSORES, {})
    corrida = {"inicio": ahora(), "modo": modo, "fuentes": {}}
    for nombre in nombres:
        con, cuenta, t0 = CONECTORES[nombre], Counter(), time.perf_counter()
        try:
            if a.doc:
                ref = next((r for r in con.listar() if r["doc_id"] == a.doc), None)
                if ref is None:
                    cuenta["borrados"] += almacen.borrar(c, a.doc, "ya no está en la fuente")
                else:
                    cuenta["vistos"] += 1
                    procesar(c, con, ref, cuenta, forzar=True)
            elif a.barrido:
                barrido(c, nombre, con, cuenta)
            else:
                incremental(c, nombre, con, cursores, cuenta)
                escribir_json(CURSORES, cursores)
        except FuenteSinAcceso as e:
            cuenta["error"] = str(e)
        almacen.guardar_catalogo(c)
        corrida["fuentes"][nombre] = {k: cuenta[k] for k in CUENTAS} | {k: cuenta[k] for k in ("error", "frenado") if k in cuenta} | {
            "llamadas": LLAMADAS[nombre], "esperas_429": ESPERAS[nombre], "segundos": round(time.perf_counter() - t0, 2)}
    corrida["fin"] = ahora()
    p = CORRIDAS / f"{datetime.now():%Y%m%d-%H%M%S-%f}.json"
    escribir_json(p, corrida)

    print(f"{'fuente':<10}" + "".join(f"{k:>14}" for k in CUENTAS + ["llamadas", "esperas_429", "segundos"]))
    for n, f in corrida["fuentes"].items():
        print(f"{n:<10}" + "".join(f"{f[k]:>14}" for k in CUENTAS + ["llamadas", "esperas_429", "segundos"]))
        for k in ("error", "frenado"):
            if k in f:
                print(f"  ✗ {n}: {k}: {f[k]}")
    vivos = sum(1 for x in c.values() if not x.get("borrado"))
    print(f"catálogo: {vivos} documentos vivos, {len(c) - vivos} lápidas · corrida en {p.relative_to(CORRIDAS.parent.parent)}")
    return 1 if any("error" in f or "frenado" in f for f in corrida["fuentes"].values()) else 0


if __name__ == "__main__":
    sys.exit(main())
