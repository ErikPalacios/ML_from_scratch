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
    raise NotImplementedError("paso 7: mapa")


def main() -> str | None:
    raise NotImplementedError("paso 7: main")


if __name__ == "__main__":
    main()
