"""Paso 1 · Contar tokens como los cuenta el modelo de embeddings.

Contrato:
- contar(texto) -> int: cuántos tokens ve multilingual-e5-small cuando le pasas ese texto como pasaje, es decir
  config modelo.prefijo («passage: ») + el texto, con los tokens especiales que agrega el tokenizer (<s> al
  principio y </s> al final). Sin truncar: si el texto pasa del límite, contar() dice cuánto pasa.
- tokens_texto(texto) -> int: los tokens del texto solo, sin prefijo ni especiales: contar(texto) - contar("").
  Sirve para medir un pedazo (el traslape, una fila).
- LIMITE: config modelo.limite (512), lo que el modelo alcanza a leer.
- El tokenizer se carga una sola vez, de config modelo.tokenizer, con la librería tokenizers.
"""
from __future__ import annotations

from functools import lru_cache

from tokenizers import Tokenizer

from _comun import RAIZ, config

LIMITE = config()["modelo"]["limite"]


@lru_cache(maxsize=1)
def tokenizer() -> Tokenizer:
    return Tokenizer.from_file(str(RAIZ / config()["modelo"]["tokenizer"]))


def contar(texto: str) -> int:
    return len(tokenizer().encode(config()["modelo"]["prefijo"] + texto).ids)


def tokens_texto(texto: str) -> int:
    return contar(texto) - contar("")
