"""Pasa la mañana del 21 de noviembre, de las 9:00 a las 10:30 (Ciudad de México), con tu índice y tu carril rápido.

    python mundo/avanzar.py

Lo que pasa (es el paso 8 de la guía):
- 9:00   El mundo vuelve a la foto de las 9:00 (el directorio y la cola vacía) y corre tu
         python pipeline/indexar.py --desde-cero.
- Seis cambios de permisos que avisan las fuentes. Cada aviso (un webhook) tarda 20 s en llegar a almacen/eventos.jsonl:
         9:07:20 drive · 9:18:40 directorio · 9:25:00 directorio (un alta) · 9:31:10 jira · 9:44:30 wiki · 9:52:00 directorio.
- Tu carril rápido (python pipeline/revocar.py) corre cada revocacion.cada_segundos de config.yaml, contados desde las
  9:00, cuando hay algo nuevo en la cola (si no lo hay, una pasada no haría nada).
- 10:00  El reindexado de cada hora: tu python pipeline/indexar.py, desde almacen/docs/, que todavía trae las ACL que
         leyó la ingestión a las 9:05 (la siguiente ingestión, la de las 11:00, ya no cae en la mañana).
Después de cada corrida de tu código, el mundo le pregunta a tu pipeline/buscar.py (visibles) qué ve cada persona y lo
compara con la verdad. Así mide cuánto tiempo pudo ver alguien un documento que ya no debía (la exposición) y lo deja
en almacen/manana.json, que lee verificar.py. Se puede correr las veces que quieras: siempre empieza a las 9:00.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo import referencia as ref  # noqa: E402
from mundo.comun import (ALMACEN, CONFIG, ENTRADA, ENTREGA, FIN, INICIO, RAIZ, REINDEXADO, SLO, dur, escribir_json,  # noqa: E402
                         hora, leer_json, mas, poner_reloj, t)

VER = ("import json, sys; sys.path.insert(0, 'pipeline'); import buscar; "
       "print(json.dumps({p: sorted(buscar.visibles(p)) for p in sys.argv[1:]}))")
CAMPOS = ("n", "ocurrio", "entregado", "fuente", "tipo", "doc_id", "acl", "grupo", "miembro", "accion")


def correr(*a: str) -> str:
    r = subprocess.run([sys.executable, *a], cwd=RAIZ, capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        sys.exit(f"✗ {' '.join(a[:2])} salió con código {r.returncode}:\n{r.stdout[-1500:]}{r.stderr[-1500:]}")
    return r.stdout


def ver() -> dict[str, set]:
    """Lo que tu pipeline/buscar.py dice que ve cada persona, ahora."""
    return {p: set(v) for p, v in json.loads(correr("-c", VER, *ref.personas())).items()}


def docs_de(ids: set) -> set:
    return {ref.doc_de(c) for c in ids}


def main() -> None:
    cada = max(1, int(yaml.safe_load(CONFIG.read_text())["revocacion"]["cada_segundos"]))
    evs = [dict(e, entregado=mas(e["ocurrio"], ENTREGA)) for e in ref.eventos()]
    escribir_json(ALMACEN / "directorio.json", leer_json(ENTRADA / "directorio.json"))
    (ALMACEN / "eventos.jsonl").write_text("")
    (ALMACEN / "manana.json").unlink(missing_ok=True)
    poner_reloj(INICIO)
    corridas = []                                   # (hora, qué corrió, lo que ve cada persona después)
    correr("pipeline/indexar.py", "--desde-cero")
    corridas.append((INICIO, "indexar.py --desde-cero", ver()))

    agenda, i = [(REINDEXADO, 0, "reindex")], 1
    while (x := mas(INICIO, cada * i)) <= FIN:
        agenda.append((x, 1, "carril"))
        i += 1
    puestos = aplicados = 0
    for T, _, que in sorted(agenda):
        poner_reloj(T)
        escribir_json(ALMACEN / "directorio.json", ref.directorio(T))      # el directorio de verdad siempre está al día
        nuevos = [e for e in evs[puestos:] if e["entregado"] <= T]
        if nuevos:
            with open(ALMACEN / "eventos.jsonl", "a") as f:
                for e in nuevos:
                    f.write(json.dumps({k: e[k] for k in CAMPOS if k in e}, ensure_ascii=False) + "\n")
            puestos += len(nuevos)
        if que == "reindex":
            correr("pipeline/indexar.py")
            corridas.append((T, "indexar.py (el reindexado de cada hora)", ver()))
        elif puestos > aplicados:
            correr("pipeline/revocar.py")
            aplicados = puestos
            corridas.append((T, "revocar.py", ver()))
    poner_reloj(FIN)
    escribir_json(ALMACEN / "directorio.json", ref.directorio(FIN))

    # ------------------------------------------------ la exposición: tramo por tramo, lo que ves contra la verdad
    cortes = sorted({c[0] for c in corridas} | {e["ocurrio"] for e in evs} | {FIN})
    fugas: dict[tuple, list] = {}
    verdad = {}
    for a, b in zip(cortes, cortes[1:]):
        v = [c for c in corridas if c[0] <= a][-1][2]
        for p in ref.personas():
            ok = verdad.setdefault((p, a), ref.permitidos(p, a))
            for d in docs_de(v.get(p, set()) - ok):
                fugas.setdefault((p, d), []).append((a, b))
    segs = lambda iv: sum((t(b) - t(a)).total_seconds() for a, b in iv)  # noqa: E731

    def tramos(iv):                                  # junta los tramos seguidos
        out = []
        for a, b in sorted(iv):
            if out and out[-1][1] == a:
                out[-1] = (out[-1][0], b)
            else:
                out.append((a, b))
        return out

    reporte, atribuidas = [], set()
    print(f"✓ la mañana del 21, de {hora(INICIO)} a {hora(FIN)} · tu carril rápido corre cada {dur(cada)} · el reindexado, a las {hora(REINDEXADO)}")
    linea_corrida = {c[0]: c[1] for c in corridas}
    hechos = sorted([(c[0], "c", c[1]) for c in corridas] + [(e["ocurrio"], "e", e) for e in evs], key=lambda x: (x[0], x[1]))
    for T, k, x in hechos:
        if k == "c":
            extra = ""
            if T == REINDEXADO:
                volvieron = sorted({pd for pd, iv in fugas.items() if any(a == REINDEXADO for a, _ in tramos(iv)) and any(b < REINDEXADO for _, b in iv)})
                extra = (" · ⚠ deshizo revocaciones: " + ", ".join(f"{p.split('@')[0]} vuelve a ver {d}" for p, d in volvieron[:4])) if volvieron else " · ninguna revocación volvió"
            print(f"  {hora(T):>8}  {linea_corrida[T]}{extra}")
            continue
        e = x
        antes = mas(e["ocurrio"], -1)
        perdieron = sorted((p, d) for p in ref.personas() for d in docs_de(ref.permitidos(p, antes)) - docs_de(ref.permitidos(p, e["ocurrio"])))
        ganaron = sorted((p, d) for p in ref.personas() for d in docs_de(ref.permitidos(p, e["ocurrio"])) - docs_de(ref.permitidos(p, antes)))
        atribuidas |= set(perdieron)
        expo = max((segs([iv for iv in fugas.get(pd, []) if iv[0] >= e["ocurrio"]]) for pd in perdieron), default=0)
        reaparece = sorted(pd for pd in perdieron if len(tramos([iv for iv in fugas.get(pd, []) if iv[0] >= e["ocurrio"]])) > 1)
        aplicado = None
        if perdieron:
            aplicado = mas(e["ocurrio"], max((segs(tramos([iv for iv in fugas.get(pd, []) if iv[0] >= e["ocurrio"]])[:1]) for pd in perdieron), default=0))
        elif ganaron:
            aplicado = next((c[0] for c in corridas if c[0] >= e["ocurrio"] and all(any(ref.doc_de(cid) == d for cid in c[2].get(p, ())) for p, d in ganaron)), None)
        que = (f"{e['doc_id']} «{ref.docs()[e['doc_id']]['titulo']}»: ACL nueva" if e["tipo"] == "acl" else
               f"{e['miembro'].split(':')[1].split('@')[0]} {'sale de' if e['accion'] == 'quitar' else 'entra a'} {e['grupo'].split(':')[1].split('@')[0]}")
        quien = (f"{len({p for p, _ in perdieron})} persona(s) dejan de poder ver {len({d for _, d in perdieron})} documento(s)" if perdieron else
                 f"{len({p for p, _ in ganaron})} persona(s) empiezan a ver {len({d for _, d in ganaron})} documento(s)")
        print(f"  {hora(e['ocurrio']):>8}  {e['fuente']} · {que} · {quien}")
        if perdieron:
            marca = "✓" if expo <= SLO and not reaparece else "✗"
            print(f"            {marca} tu carril lo aplicó a las {hora(aplicado)}: {dur(expo)} de exposición" + (" (y volvió a verse después)" if reaparece else ""))
        elif ganaron:
            print(f"            {'✓ ya lo ven desde las ' + hora(aplicado) if aplicado else '✗ al final de la mañana todavía no lo ven'}")
        reporte.append({"n": e["n"], "tipo": e["tipo"], "fuente": e["fuente"], "ocurrio": e["ocurrio"], "que": e["que"],
                        "perdieron": perdieron, "ganaron": ganaron, "exposicion": expo, "aplicado": aplicado, "reaparece": reaparece})
    print(f"  {hora(FIN):>8}  fin de la mañana · el detalle quedó en almacen/manana.json")
    otras = sorted(({"persona": p, "doc_id": d, "segundos": segs(iv)} for (p, d), iv in fugas.items() if (p, d) not in atribuidas), key=lambda x: (x["persona"], x["doc_id"]))
    escribir_json(ALMACEN / "manana.json", {"cada_segundos": cada, "corridas": [{"t": c[0], "que": c[1]} for c in corridas],
                                             "eventos": reporte, "otras_fugas": otras})
    revs = [r for r in reporte if r["perdieron"]]
    peor = max(revs, key=lambda r: r["exposicion"])
    malas = [r for r in revs if r["exposicion"] > SLO or r["reaparece"]]
    print(("✓ ninguna revocación pasó de 5 min" if not malas else f"✗ {len(malas)} de {len(revs)} revocaciones pasaron de 5 min o volvieron a verse")
          + f" (la peor: {dur(peor['exposicion'])}, a las {hora(peor['ocurrio'])})"
          + (f" · ⚠ {len(otras)} fuga(s) que no vienen de ninguna revocación: {otras[0]['persona']} ve {otras[0]['doc_id']}" if otras else " · ninguna otra fuga"))
    print("  siguiente: python verificar.py revocacion")


if __name__ == "__main__":
    main()
