"""Lo que comparten los pasos del pipeline. Viene dado: no tienes que escribirlo, pero sí entenderlo.

Trae las rutas, la lectura y escritura de archivos (siempre de un jalón), el catálogo de modelos (mundo/modelos.json),
las palabras de un texto (para BM25) y lo que ya construiste en la estación 3: principals con grupos anidados y
puede_ver con la ACL en cláusulas.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import unicodedata
from pathlib import Path

import yaml

RAIZ = Path(__file__).resolve().parent.parent
ALMACEN = RAIZ / "almacen"                        # lo que llega de antes: no se toca
CORPUS = ALMACEN / "corpus" / "vigente.json"      # los chunks de la estación 3, con su texto, su ruta de títulos y su ACL
DIRECTORIO = ALMACEN / "directorio.json"          # la copia del directorio de la empresa (personas y grupos)
GOLDEN = ALMACEN / "golden"                       # el golden set de la estación 4 (golden/VIGENTE dice cuál versión)
MODELOS = RAIZ / "mundo" / "modelos.json"         # el catálogo: repositorio, revisión y sha256 de cada modelo
MODELO = RAIZ / "modelo"                          # los archivos de cada modelo, bajados por mundo/modelos.py
CACHE = RAIZ / "cache" / "embeddings"             # lo que tu pipeline ya embebió, por modelo y por texto
INDICES = RAIZ / "indices"                        # lo que produce tu pipeline: una carpeta por índice y alias.json
ALIAS = INDICES / "alias.json"                    # a qué índice apunta cada alias
TOKENS = ALMACEN / "tokens.json"                  # la llave de cada persona (lo que manda en Authorization: Bearer …)

VACIAS = {"que", "del", "los", "las", "una", "uno", "por", "para", "con", "sin", "como", "cual", "cuando", "donde", "cuanto",
          "cuantos", "cuantas", "hay", "tengo", "puedo", "esta", "este", "son", "pasa", "hace", "sobre", "mas"}


def config() -> dict:
    """config.yaml como diccionario (se lee cada vez: romper.py lo puede cambiar entre corridas)."""
    return yaml.safe_load((RAIZ / "config.yaml").read_text())


def ahora() -> str:
    """La hora del mundo (UTC), no la de tu Mac."""
    return json.loads((ALMACEN / "mundo.json").read_text())["reloj"]


def leer_json(p: Path, defecto=None):
    try:
        return json.loads(Path(p).read_text())
    except FileNotFoundError:
        return defecto


def escribir_json(p: Path, d) -> None:
    """Escribe de un jalón: a un .tmp y luego os.replace. Si el proceso muere a la mitad, el archivo viejo sigue entero,
    y quien lo lea en ese momento ve el viejo o el nuevo, nunca uno a medias."""
    p = Path(p)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(p.name + ".tmp")
    tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1, sort_keys=True) + "\n")
    os.replace(tmp, p)


def leer_jsonl(p: Path) -> list[dict]:
    try:
        return [json.loads(l) for l in Path(p).read_text().splitlines() if l.strip()]
    except FileNotFoundError:
        return []


def escribir_jsonl(p: Path, filas: list[dict]) -> None:
    p = Path(p)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(p.name + ".tmp")
    tmp.write_text("".join(json.dumps(f, ensure_ascii=False, sort_keys=True) + "\n" for f in filas))
    os.replace(tmp, p)


def sha256_archivo(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def sha_texto(texto: str) -> str:
    """La huella de un texto: los primeros 16 caracteres del sha256. La misma que usó la estación 4 para las fuentes."""
    return hashlib.sha256(texto.encode()).hexdigest()[:16]


def corpus() -> dict:
    """El corpus vigente: {"version", "fecha", "chunks": {chunk_id: {"doc_id", "titulo", "texto", "acl", "url"}}}.
    El texto de cada chunk empieza con su ruta de títulos (estación 2): «Documento › Sección», una línea en blanco y el cuerpo."""
    c = leer_json(CORPUS)
    if c is None:
        raise SystemExit("✗ no hay almacen/corpus/vigente.json: python mundo/crear.py")
    return c


def directorio() -> dict:
    return leer_json(DIRECTORIO)


def golden() -> tuple[str, list[dict]]:
    """La versión vigente del golden set de la estación 4 y sus preguntas."""
    v = (GOLDEN / "VIGENTE").read_text().strip()
    return v, leer_jsonl(GOLDEN / v / "preguntas.jsonl")


def modelos() -> dict:
    """El catálogo de modelos: {clave: {"repo", "revision", "archivos", "dim", "max_tokens", "prefijo_consulta", ...}}."""
    return json.loads(MODELOS.read_text())


def palabras(texto: str) -> list[str]:
    """Las palabras de un texto: minúsculas, sin acentos, de 3 letras o más y sin las vacías («que», «para», «cuanto»…).
    Es la misma de la estación 4. Para BM25 importan las repetidas: por eso es una lista y no un conjunto."""
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
