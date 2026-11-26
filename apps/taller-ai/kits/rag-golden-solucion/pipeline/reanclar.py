"""Paso 7 · Reanclar: después de una re-ingesta, cada fuente del golden set vuelve a apuntar al chunk que tiene su texto.

    python pipeline/reanclar.py

Una re-ingesta puede correr la numeración de los chunks (una sección nueva arriba), juntar o partir chunks (otro tamaño
de chunk), cambiar un texto o borrar un documento. Un chunk_id que sigue existiendo no prueba nada: puede tener otro
texto. Por eso cada fuente del golden guarda la huella (sha) del texto que leyó el experto.

Contrato:
- mapa(viejo, nuevo) -> {chunk_id_viejo: {"a": chunk_id_nuevo o None, "por": ...}} para cada chunk del corpus viejo,
  buscando solo entre los chunks del mismo documento en el nuevo, en este orden:
  · "sha": un chunk con exactamente el mismo texto (el primero por chunk_id);
  · "contenido": un chunk cuyo texto contiene el cuerpo del viejo (cuerpo() de _comun.py: sin la ruta de títulos), por
    ejemplo porque se juntó con otro (el primero por chunk_id);
  · "cambio" (a = None): el documento sigue, pero ningún chunk tiene ese texto: alguien lo editó;
  · "borrado" (a = None): el documento ya no está.
- main(): el corpus del que salió el último paso de golden/anclas.json (o el de la versión vigente, si no hay pasos)
  contra el corpus vigente. Si son el mismo, no hace nada. Si no, agrega el paso {"de", "a", "chunks": mapa(...)} a
  golden/anclas.json, dice cuántos chunks se movieron de cada forma y cuántas preguntas de la vigente tocan, y llama a
  armar.main() para publicar la versión siguiente con las fuentes nuevas.
"""
from __future__ import annotations

import armar
from _comun import ANCLAS, GOLDEN, corpus, corpus_version, cuerpo, escribir_json, leer_json, leer_jsonl
from publicar import vigente


def mapa(viejo: dict, nuevo: dict) -> dict:
    por_doc: dict[str, list] = {}
    for k in sorted(nuevo["chunks"]):
        por_doc.setdefault(nuevo["chunks"][k]["doc_id"], []).append(k)
    out = {}
    for k, x in sorted(viejo["chunks"].items()):
        candidatos = por_doc.get(x["doc_id"], [])
        igual = next((n for n in candidatos if nuevo["chunks"][n]["texto"] == x["texto"]), None)
        dentro = next((n for n in candidatos if cuerpo(x["texto"]) in nuevo["chunks"][n]["texto"]), None)
        if igual:
            out[k] = {"a": igual, "por": "sha"}
        elif dentro:
            out[k] = {"a": dentro, "por": "contenido"}
        else:
            out[k] = {"a": None, "por": "cambio" if candidatos else "borrado"}
    return out


def main() -> str | None:
    c = corpus()
    anclas = leer_json(ANCLAS, {"pasos": []})
    vig = vigente()
    if anclas["pasos"]:
        ultimo = anclas["pasos"][-1]["a"]
    elif vig:
        ultimo = leer_json(GOLDEN / vig / "manifiesto.json")["corpus"]
    else:
        raise SystemExit("✗ todavía no hay golden publicado: python pipeline/armar.py")
    if ultimo == c["version"]:
        print(f"= el golden ya está anclado a {c['version']}: nada que reanclar")
        return None
    m = mapa(corpus_version(ultimo), c)
    anclas["pasos"].append({"de": ultimo, "a": c["version"], "chunks": m})
    escribir_json(ANCLAS, anclas)
    cuenta = {}
    for x in m.values():
        cuenta[x["por"]] = cuenta.get(x["por"], 0) + 1
    movidos = {k for k, x in m.items() if not (x["por"] == "sha" and x["a"] == k)}
    tocadas = [x["id"] for x in leer_jsonl(GOLDEN / vig / "preguntas.jsonl") if any(f["chunk_id"] in movidos for f in x["fuentes"])] if vig else []
    print(f"anclas {ultimo} → {c['version']}: {len(m)} chunks · " + " · ".join(f"{k} {v}" for k, v in sorted(cuenta.items())) +
          f" · {len(movidos)} cambiaron de id o de texto")
    print(f"  preguntas de {vig} que apuntan a uno de esos: {len(tocadas)} ({', '.join(tocadas)})")
    return armar.main(motivo=f"reanclaje {ultimo} → {c['version']}")


if __name__ == "__main__":
    main()
