"""Lo que comparten los pasos del pipeline. Viene dado: no tienes que escribirlo, pero sí entenderlo."""
from __future__ import annotations

import json
import os
import re
import unicodedata
from pathlib import Path

import yaml

RAIZ = Path(__file__).resolve().parent.parent
ALMACEN = RAIZ / "almacen"                    # lo que llega de antes: no se toca
DOCS = ALMACEN / "docs"                       # docs/<doc>.json: lo que dejó la estación 2, un archivo por documento
DIRECTORIO = ALMACEN / "directorio.json"      # el directorio de la empresa (en C11, el IdP): personas y grupos
COLA = ALMACEN / "eventos.jsonl"              # los cambios de permisos que avisan las fuentes, uno por línea
INDICE = RAIZ / "indice"                      # lo que produce tu pipeline
ARCHIVO_INDICE = INDICE / "indice.json"       # el índice: cada chunk con su texto y su ACL
ACL_VIGENTE = INDICE / "acl_vigente.json"     # las ACL que aplicó el carril rápido, para que el reindexado no las deshaga
COPIA = INDICE / "directorio.json"            # tu copia del directorio
CURSOR = INDICE / "cursor.json"               # hasta qué evento de la cola llegó el carril rápido
REVOCACIONES = INDICE / "revocaciones.jsonl"  # la bitácora del carril rápido: un evento aplicado por línea

VACIAS = {"que", "del", "los", "las", "una", "uno", "por", "para", "con", "sin", "como", "cual", "cuando", "donde", "cuanto",
          "cuantos", "cuantas", "hay", "tengo", "puedo", "esta", "este", "son", "pasa", "hace", "sobre", "mas"}


def config() -> dict:
    """config.yaml como diccionario (se lee cada vez: el mundo y romper.py lo pueden cambiar entre corridas)."""
    return yaml.safe_load((RAIZ / "config.yaml").read_text())


def ahora() -> str:
    """La hora del mundo (UTC), no la de tu Mac: el mundo la mueve cuando pasa la mañana (mundo/avanzar.py)."""
    return json.loads((ALMACEN / "mundo.json").read_text())["reloj"]


def leer_json(p: Path, defecto=None):
    try:
        return json.loads(Path(p).read_text())
    except FileNotFoundError:
        return defecto


def escribir_json(p: Path, d) -> None:
    """Escribe de un jalón: a un .tmp y luego os.replace. Si el proceso muere a la mitad, el archivo viejo sigue entero."""
    p = Path(p)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1, sort_keys=True) + "\n")
    os.replace(tmp, p)


def leer_jsonl(p: Path) -> list[dict]:
    """Un JSON por línea (la cola y la bitácora). Si no existe, lista vacía."""
    try:
        return [json.loads(l) for l in Path(p).read_text().splitlines() if l.strip()]
    except FileNotFoundError:
        return []


def palabras(texto: str) -> list[str]:
    """Las palabras de un texto para el buscador de juguete: minúsculas, sin acentos, de 3 letras o más y sin las vacías."""
    t = "".join(c for c in unicodedata.normalize("NFD", texto.lower()) if unicodedata.category(c) != "Mn")
    return [w for w in re.findall(r"[a-z0-9]+", t) if len(w) >= 3 and w not in VACIAS]


def puntaje(pregunta: str, texto: str) -> int:
    """El buscador de juguete de esta estación: cuántas palabras distintas de la pregunta aparecen en el chunk.
    En la estación 5 lo cambias por BM25 y embeddings; el filtro de permisos va igual."""
    ws = set(palabras(texto))
    return sum(1 for w in set(palabras(pregunta)) if w in ws)
