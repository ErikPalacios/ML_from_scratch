"""Lo que va a medir el gate (estación 9), con el buscador de juguete de la estación 3: un adelanto, para ver qué tan
fino es tu golden set. Solo lee: no cambia nada.

    python mundo/evaluar.py                     # recall@8 y permisos en test, con el filtro de permisos
    python mundo/evaluar.py --sin-filtro        # lo mismo con un buscador que se olvidó de los permisos
    python mundo/evaluar.py --comparar          # el buscador de siempre contra uno que compara raíces (las primeras 5 letras)

recall@8: de las fuentes de cada pregunta directa o con varias fuentes, qué fracción llega entre los 8 chunks que
devuelve el buscador; luego el promedio. El ± es el margen al 95 %: 1.96 × desviación estándar / √n.
Permisos: ninguna pregunta prohibida puede recibir una de sus fuentes, y nadie puede recibir un chunk que no ve.
"""
from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import ALMACEN, GOLDEN, leer_json, leer_jsonl, vigente  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "pipeline"))
from _comun import palabras, principals, puede_ver  # noqa: E402

K = 8


def puntaje(pregunta: str, texto: str, raices: bool = False) -> int:
    """El buscador de juguete de la estación 3: cuántas palabras distintas de la pregunta aparecen en el chunk. Con
    raices=True compara las primeras 5 letras («reembolsa» y «reembolso» cuentan igual): un cambio chico, para comparar."""
    corta = (lambda w: w[:5]) if raices else (lambda w: w)
    ws = {corta(w) for w in palabras(texto)}
    return sum(1 for w in {corta(w) for w in palabras(pregunta)} if w in ws)


def buscar(pregunta, persona, chunks, d, filtro=True, raices=False):
    ps = principals(persona, d)
    rs = []
    for k, c in chunks.items():
        if filtro and not puede_ver(c["acl"], ps):
            continue
        s = puntaje(pregunta, c["texto"], raices)
        if s > 0:
            rs.append((-s, k))
    return [k for _, k in sorted(rs)[:K]]


def media(xs):
    n = len(xs)
    m = sum(xs) / n
    sd = math.sqrt(sum((x - m) ** 2 for x in xs) / (n - 1)) if n > 1 else 0.0
    return m, 1.96 * sd / math.sqrt(n)


def medir(items, chunks, d, **kw):
    rec, fugas, ajenos = [], 0, 0
    for x in items:
        top = buscar(x["pregunta"], x["persona"], chunks, d, **kw)
        ps = principals(x["persona"], d)
        ajenos += sum(1 for k in top if not puede_ver(chunks[k]["acl"], ps))
        fs = {f["chunk_id"] for f in x["fuentes"]}
        if x["tipo"] in ("directa", "varias"):
            rec.append(len(fs & set(top)) / len(fs))
        if x["tipo"] == "prohibida" and fs & set(top):
            fugas += 1
    return rec, fugas, ajenos


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", default="test", choices=["test", "dev"])
    ap.add_argument("--sin-filtro", action="store_true")
    ap.add_argument("--comparar", action="store_true")
    a = ap.parse_args()
    v = vigente()
    if not v:
        sys.exit("✗ no hay golden vigente: python pipeline/armar.py")
    items = [x for x in leer_jsonl(GOLDEN / v / "preguntas.jsonl") if x["split"] == a.split]
    chunks = leer_json(ALMACEN / "corpus" / "vigente.json")["chunks"]
    d = leer_json(ALMACEN / "directorio.json")
    pro = sum(x["tipo"] == "prohibida" for x in items)
    rec, fugas, ajenos = medir(items, chunks, d, filtro=not a.sin_filtro)
    m, e = media(rec)
    print(f"{v} · {a.split}: {len(items)} preguntas ({len(rec)} con fuentes que buscar, {pro} prohibidas, "
          f"{sum(x['tipo'] == 'sin_respuesta' for x in items)} sin respuesta)")
    print(f"  recall@8 = {m:.1%} ± {e:.1%}   (de {m - e:.1%} a {m + e:.1%})")
    print(f"  permisos: {pro - fugas} de {pro} prohibidas sin fuga · {ajenos} chunks ajenos entregados" +
          ("" if a.sin_filtro else " · las sin respuesta se miden con el LLM (estación 9)"))
    if a.comparar:
        rec2, _, _ = medir(items, chunks, d, raices=True)
        m2, e2 = media(rec2)
        dif, edif = media([y - x for x, y in zip(rec, rec2)])
        print(f"  con raíces de 5 letras: recall@8 = {m2:.1%} ± {e2:.1%}")
        print(f"  diferencia (pareada, las mismas preguntas): {dif:+.1%} ± {edif:.1%} → " +
              ("no se distingue del ruido" if abs(dif) <= edif else "es una diferencia real con estas preguntas"))
