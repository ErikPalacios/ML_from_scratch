"""Pasos 4 y 5 · Buscar como una persona: el filtro de permisos antes del top-k, y otra vez antes del prompt.

    python pipeline/buscar.py --como diego.luna@marketplace.test "¿cuánto gana un líder de soporte?"

Contrato:
- mis_principals(correo): principals() con la copia del directorio (indice/directorio.json) y config directorio.profundidad.
- visibles(correo) -> set de los chunk_id del índice que esa persona puede ver (puede_ver con la ACL de cada chunk).
  Lee el índice y la copia cada vez: nada de cachés entre llamadas.
- buscar(pregunta, correo, k=None) -> lista de {"chunk_id", "doc_id", "titulo", "texto", "acl", "puntaje"}, máximo k
  (si no se dice, config busqueda.k), solo con puntaje > 0, de mayor a menor puntaje y, en empate, por chunk_id.
  Con config busqueda.filtro "antes" (pre-filter): primero el filtro de permisos y después los k mejores.
  Con "despues" (post-filter, para comparar): los k mejores de todo el índice y después el filtro.
- contexto(resultados, correo) -> {"texto", "fuentes", "descartados"}: el último filtro antes del prompt. Vuelve a revisar
  cada resultado contra la ACL que tiene su chunk en el índice (nunca contra la que diga el resultado), con principals
  recién calculados. Lo que no pasa va a "descartados" (sus chunk_id) y no entra al texto. El texto: un bloque por fuente,
  "[n] <chunk_id>" y en la línea siguiente el texto del chunk, con una línea en blanco entre bloques.
"""
from __future__ import annotations

import argparse

from _comun import ARCHIVO_INDICE, config, leer_json, puntaje
from directorio import copia, principals
from permisos import puede_ver


def indice() -> dict:
    idx = leer_json(ARCHIVO_INDICE)
    if idx is None:
        raise SystemExit("✗ no hay índice: python pipeline/indexar.py")
    return idx


def mis_principals(correo: str) -> set[str]:
    return principals(correo, copia(), config()["directorio"]["profundidad"])


def visibles(correo: str) -> set[str]:
    ps = mis_principals(correo)
    return {cid for cid, c in indice()["chunks"].items() if puede_ver(c["acl"], ps)}


def buscar(pregunta: str, correo: str, k: int | None = None) -> list[dict]:
    cfg = config()["busqueda"]
    k = k or cfg["k"]
    ps = mis_principals(correo)
    chunks = indice()["chunks"]
    ordenar = lambda ids: sorted(((puntaje(pregunta, chunks[i]["texto"]), i) for i in ids), key=lambda x: (-x[0], x[1]))  # noqa: E731
    if cfg["filtro"] == "antes":            # pre-filter: el top-k se elige solo entre lo que la persona puede ver
        mejores = [x for x in ordenar(i for i, c in chunks.items() if puede_ver(c["acl"], ps)) if x[0] > 0][:k]
    else:                                   # post-filter: el top-k de todo y luego se tira lo ajeno
        mejores = [x for x in ordenar(chunks)[:k] if x[0] > 0 and puede_ver(chunks[x[1]]["acl"], ps)]
    return [{"chunk_id": i, "doc_id": chunks[i]["doc_id"], "titulo": chunks[i]["titulo"], "texto": chunks[i]["texto"],
             "acl": chunks[i]["acl"], "puntaje": s} for s, i in mejores]


def contexto(resultados: list[dict], correo: str) -> dict:
    ps = mis_principals(correo)                 # frescos: si alguien perdió un grupo hace un segundo, ya cuenta
    chunks = indice()["chunks"]
    fuentes, descartados, bloques = [], [], []
    for r in resultados:
        c = chunks.get(r.get("chunk_id"))
        if c is None or not puede_ver(c["acl"], ps):    # la ACL que manda es la del índice, no la que trae el resultado
            descartados.append(r.get("chunk_id"))
            continue
        fuentes.append(r["chunk_id"])
        bloques.append(f"[{len(fuentes)}] {r['chunk_id']}\n{c['texto']}")
    return {"texto": "\n\n".join(bloques), "fuentes": fuentes, "descartados": descartados}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--como", required=True, help="el correo de la persona que pregunta")
    ap.add_argument("pregunta")
    ap.add_argument("-k", type=int)
    a = ap.parse_args()
    rs = buscar(a.pregunta, a.como, a.k)
    ctx = contexto(rs, a.como)
    print(f"{a.como} pregunta «{a.pregunta}» · ve {len(visibles(a.como))} de {len(indice()['chunks'])} chunks · "
          f"filtro {config()['busqueda']['filtro']} del top-{a.k or config()['busqueda']['k']}")
    for r in rs:
        print(f"  {r['puntaje']}  {r['chunk_id']:<20} {r['titulo'][:48]}")
    if not rs:
        print("  (nada que pueda ver: el asistente contestaría «no encontré información»)")
    print(f"  al prompt: {len(ctx['fuentes'])} fuentes" + (f" · descartados en el último filtro: {ctx['descartados']}" if ctx["descartados"] else ""))


if __name__ == "__main__":
    main()
