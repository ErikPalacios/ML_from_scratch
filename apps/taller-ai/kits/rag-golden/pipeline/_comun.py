"""Lo que comparten los pasos del pipeline. Viene dado: no tienes que escribirlo, pero sí entenderlo.

Trae lo que ya construiste en la estación 3 (principals con grupos anidados y puede_ver con la ACL en cláusulas),
las rutas, la lectura y escritura de archivos, las palabras de un texto y el «bucket» del registro (almacen/registro/),
donde cada versión del golden set se escribe una sola vez.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import unicodedata
from pathlib import Path

import yaml

RAIZ = Path(__file__).resolve().parent.parent
ALMACEN = RAIZ / "almacen"                        # lo que llega de antes: no se toca
CORPUS = ALMACEN / "corpus" / "vigente.json"      # el índice de la estación 3: cada chunk con su texto y su ACL
HISTORIAL = ALMACEN / "corpus" / "historial"      # cada versión del corpus que ha existido (el bucket con versiones)
DIRECTORIO = ALMACEN / "directorio.json"          # la copia del directorio de la empresa (personas y grupos)
CANDIDATOS = ALMACEN / "candidatos"               # las preguntas que escriben los expertos: un .jsonl por lote
AFINADO = ALMACEN / "afinado" / "ejemplos.jsonl"  # los ejemplos con los que el equipo del prompt afina (few-shot)
REGISTRO = ALMACEN / "registro"                   # el bucket del golden set: cada versión se escribe una vez
ESQUEMA = RAIZ / "esquema" / "candidata.schema.json"
GOLDEN = RAIZ / "golden"                          # lo que produce tu pipeline
VERSIONES = GOLDEN / "versiones.jsonl"            # una línea por versión publicada, en orden
VIGENTE = GOLDEN / "VIGENTE"                      # el nombre de la versión que usa el gate (como un alias)
ANCLAS = GOLDEN / "anclas.json"                   # cómo se movió cada chunk de una versión del corpus a la siguiente

VACIAS = {"que", "del", "los", "las", "una", "uno", "por", "para", "con", "sin", "como", "cual", "cuando", "donde", "cuanto",
          "cuantos", "cuantas", "hay", "tengo", "puedo", "esta", "este", "son", "pasa", "hace", "sobre", "mas"}


class YaExiste(Exception):
    """El registro ya tiene esa versión: una versión publicada no se vuelve a escribir."""


def config() -> dict:
    """config.yaml como diccionario (se lee cada vez: romper.py lo puede cambiar entre corridas)."""
    return yaml.safe_load((RAIZ / "config.yaml").read_text())


def ahora() -> str:
    """La hora del mundo (UTC), no la de tu Mac: el mundo la mueve cuando hay una re-ingesta (mundo/avanzar.py)."""
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
    """Un JSON por línea. Si no existe, lista vacía."""
    try:
        return [json.loads(l) for l in Path(p).read_text().splitlines() if l.strip()]
    except FileNotFoundError:
        return []


def escribir_jsonl(p: Path, filas: list[dict]) -> None:
    """Un JSON por línea, con las llaves ordenadas: el mismo contenido da siempre los mismos bytes (y el mismo sha256)."""
    p = Path(p)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text("".join(json.dumps(f, ensure_ascii=False, sort_keys=True) + "\n" for f in filas))
    os.replace(tmp, p)


def sha256_archivo(p: Path) -> str:
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def sha_texto(texto: str) -> str:
    """La huella de un chunk: los primeros 16 caracteres del sha256 de su texto. Si cambia una letra, cambia la huella."""
    return hashlib.sha256(texto.encode()).hexdigest()[:16]


def cuerpo(texto: str) -> str:
    """El texto de un chunk sin su ruta de títulos (la primera línea y la línea en blanco que le pone la estación 2)."""
    return texto.split("\n\n", 1)[1] if "\n\n" in texto else texto


def corpus() -> dict:
    """El corpus vigente: {"version", "fecha", "chunks": {chunk_id: {"doc_id", "titulo", "texto", "acl", "url"}}}."""
    c = leer_json(CORPUS)
    if c is None:
        raise SystemExit("✗ no hay almacen/corpus/vigente.json: python mundo/crear.py")
    return c


def corpus_version(version: str) -> dict:
    """Una versión vieja del corpus, del historial (para reanclar)."""
    c = leer_json(HISTORIAL / f"{version}.json")
    if c is None:
        raise SystemExit(f"✗ no está {version} en almacen/corpus/historial/")
    return c


def directorio() -> dict:
    return leer_json(DIRECTORIO)


def palabras(texto: str) -> list[str]:
    """Las palabras de un texto: minúsculas, sin acentos, de 3 letras o más y sin las vacías («que», «para», «cuanto»…)."""
    t = "".join(c for c in unicodedata.normalize("NFD", texto.lower()) if unicodedata.category(c) != "Mn")
    return [w for w in re.findall(r"[a-z0-9]+", t) if len(w) >= 3 and w not in VACIAS]


# ---------------------------------------------------------------- lo de la estación 3
def principals(correo: str, d: dict, profundidad: int = 10) -> set[str]:
    """Estación 3: el usuario, el dominio de su correo y todos sus grupos, también los de adentro, sin colgarse en un ciclo."""
    if correo not in d["personas"]:
        return set()
    padres: dict[str, set] = {}
    for g, x in d["grupos"].items():
        for m in x["miembros"]:
            padres.setdefault(m, set()).add(g)
    out = {f"user:{correo}", "domain:" + correo.split("@", 1)[1]}
    frontera = {f"user:{correo}"}
    for _ in range(profundidad):
        nuevos = {g for m in frontera for g in padres.get(m, ())} - out
        if not nuevos:
            break
        out |= nuevos
        frontera = nuevos
    return out


def puede_ver(acl, ps: set) -> bool:
    """Estación 3: AND entre cláusulas, OR dentro de cada una; vacía, rota o ausente = nadie (fail-closed)."""
    ok = isinstance(acl, list) and acl and all(
        isinstance(c, list) and c and all(isinstance(p, str) and p.split(":")[0] in ("user", "group", "domain") for p in c) for c in acl)
    return bool(ok) and all(any(p in ps for p in c) for c in acl)


# ---------------------------------------------------------------- el registro (el bucket)
def subir(carpeta: Path, version: str) -> None:
    """Copia la carpeta de una versión al registro. Si el registro ya tiene esa versión, no la toca y levanta YaExiste
    (en S3 es un PUT con «If-None-Match: *» o un bucket con Object Lock). Los archivos quedan de solo lectura."""
    destino = REGISTRO / "golden" / version
    if destino.exists():
        raise YaExiste(f"el registro ya tiene {version}: una versión publicada no se vuelve a escribir")
    destino.parent.mkdir(parents=True, exist_ok=True)
    tmp = destino.with_name(destino.name + ".subiendo")
    shutil.rmtree(tmp, ignore_errors=True)
    shutil.copytree(carpeta, tmp)
    for f in tmp.iterdir():
        f.chmod(0o444)
    os.replace(tmp, destino)


def en_registro(version: str) -> Path | None:
    """La carpeta de esa versión en el registro, o None si no está."""
    p = REGISTRO / "golden" / version
    return p if p.exists() else None
