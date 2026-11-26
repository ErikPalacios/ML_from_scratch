"""Paso 6 · Armar una versión del golden set con las candidatas de los expertos, y publicarla si cambió algo.

    python pipeline/armar.py

Contrato:
- traducir(fuentes, desde, anclas, hasta) -> (fuentes_nuevas, problema). Lleva los chunk_id de una pregunta escrita
  con el corpus `desde` al corpus `hasta`, siguiendo los pasos de anclas (golden/anclas.json, {"pasos": [{"de", "a",
  "chunks": {chunk_id_viejo: {"a": chunk_id_nuevo o None, "por": "sha" | "contenido" | "cambio" | "borrado"}}}]}),
  uno tras otro. Un chunk que no está en el mapa se queda como está (si no existía, reglas() lo dirá). Si un paso dice
  "borrado": problema "retirada: el documento de <chunk> ya no existe en <corpus>"; si dice "cambio": problema
  "revisar: el texto de <chunk> cambió en <corpus>: un experto revisa la respuesta". Sin repetidos, en orden.
  Si no hay pasos para llegar de `desde` a `hasta`, problema "no hay anclas de <desde> a <hasta>".
- main() -> la versión publicada, o None si no cambió nada. En orden:
  1. lee las candidatas (cada almacen/candidatos/*.jsonl, por nombre de archivo y en su orden), el corpus vigente,
     el directorio, los ejemplos de afinado, config.yaml y lo publicado (splits de todas las versiones, la vigente y
     sus quemadas);
  2. si alguna candidata viene de un corpus del que no hay anclas hasta el vigente, se detiene (SystemExit):
     «el corpus cambió de X a Y: python pipeline/reanclar.py»;
  3. por cada candidata: estructura(); id repetido (gana la primera); quemada (nunca vuelve); traducir(); reglas().
     La que falla va a rechazadas con {"id", "motivo", "detalle"};
  4. asigna splits (asignar(), con los de antes congelados); quita las casi iguales (quitar(), las ya publicadas
     ganan); y quema las de test que se parecen a un ejemplo de afinado (contaminadas()): salen y no vuelven;
  5. revisa las cuotas de config.yaml (fracción de cada tipo sobre el total): si falta, no publica (SystemExit);
  6. arma cada item como {"id", "pregunta", "respuesta", "tipo", "persona", "split", "origen", "autor",
     "fuentes": [{"chunk_id", "doc_id", "sha"}]} (sha = sha_texto() del texto del chunk) y, si es distinto de la
     vigente, publica con publicar() y meta {"corpus", "directorio", "quemadas", "config", "motivo"}.
"""

from __future__ import annotations
from _comun import AFINADO, ANCLAS, CANDIDATOS, GOLDEN, config, corpus, directorio, leer_json, leer_jsonl, sha_texto
from contaminacion import contaminadas
from esquema import estructura, reglas
from parecidas import quitar
from publicar import publicar, versiones, vigente
from splits import asignar

TIPOS = ("directa", "varias", "sin_respuesta", "prohibida")


def traducir(fuentes: list[str], desde: str, anclas: dict, hasta: str) -> tuple[list[str], str | None]:
    raise NotImplementedError("paso 6: traducir")


def candidatas() -> list[dict]:
    return [x for p in sorted(CANDIDATOS.glob("*.jsonl")) for x in leer_jsonl(p)]


def main(motivo: str = "candidatas") -> str | None:
    raise NotImplementedError("paso 6: main")


if __name__ == "__main__":
    main()
