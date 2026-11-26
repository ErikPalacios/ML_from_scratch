"""La verdad del mundo: qué documentos están vivos hoy con qué texto y qué ACL (de mundo/entrada/, no de tu
almacén), dónde están sus tablas, qué ruta de títulos tiene cada línea y cuántos tokens cuenta el modelo.
La usa verificar.py. No la leas para resolver un paso: es la respuesta del equipo.
"""
from __future__ import annotations

import re
from functools import lru_cache

from mundo.comun import TOKENIZER, entrada, mundo, texto_entrada

PREFIJO = "passage: "
OBJETIVO, TRASLAPE, LIMITE = 400, 60, 512     # lo que decidió el equipo de C11 (y el modelo, el 512)
TITULO = re.compile(r"^(#{1,3}) (.+)$")
BARRAS = re.compile(r"^\|.*\|$")
FILA = re.compile(r"^([^:;|]{1,40}): [^;]*(?:; [^:;]{1,40}: .*)+$")
ORACION = re.compile(r"(?<=[.!?])\s+")
EXTENSION = re.compile(r"\.(md|pdf|txt|docx)$", re.I)


@lru_cache(maxsize=1)
def _tk():
    from tokenizers import Tokenizer

    return Tokenizer.from_file(str(TOKENIZER))


def contar(texto: str) -> int:
    return len(_tk().encode(PREFIJO + texto).ids)


def tokens_texto(texto: str) -> int:
    return contar(texto) - contar("")


def oraciones(linea: str) -> list[str]:
    return [o for o in ORACION.split(linea) if o]


def vivos(dia: int | None = None) -> dict:
    """doc_id → {titulo, acl, texto, sha256_texto, hash}: los vivos de ese día (hoy, si no se dice), según la estación 1."""
    out = {}
    for d, r in entrada(dia or mundo()["dia"]).items():
        if r["borrado"]:
            continue
        t = texto_entrada(r["hash"])
        out[d] = {"titulo": r["titulo"], "acl": r["acl"], "hash": r["hash"], "texto": t["texto"], "sha256_texto": t["sha256_texto"],
                  "url": r["url"], "version": r["version"]}
    return out


def tablas(texto: str) -> list[dict]:
    """Las tablas del texto: {"lineas", "encabezado"}. De barras (markdown) o de filas (la wiki)."""
    ls, out, i = texto.splitlines(), [], 0
    clave = lambda l: (m.group(1) if (m := FILA.match(l)) else None)  # noqa: E731
    while i < len(ls):
        j = i
        if BARRAS.match(ls[i]):
            while j < len(ls) and BARRAS.match(ls[j]):
                j += 1
            out.append({"lineas": ls[i:j], "encabezado": ls[i:i + 2]})
        elif (k := clave(ls[i])) and i + 1 < len(ls) and clave(ls[i + 1]) == k:
            while j < len(ls) and clave(ls[j]) == k:
                j += 1
            out.append({"lineas": ls[i:j], "encabezado": []})
        i = max(j, i + 1)
    return out


def rutas(texto: str, titulo: str) -> tuple[str, dict[int, list[str]], list[str]]:
    """El título del documento y, por cada línea con contenido (no título), su ruta de títulos."""
    ls = texto.splitlines()
    doc, ini = EXTENSION.sub("", titulo), 0
    if ls and (m := TITULO.match(ls[0])) and len(m.group(1)) == 1:
        doc, ini = m.group(2).strip(), 1
    pila, out = {}, {}
    for i, l in enumerate(ls):
        if i < ini or not l.strip():
            continue
        if m := TITULO.match(l):
            n = len(m.group(1))
            pila = {k: v for k, v in pila.items() if k < n} | {n: m.group(2).strip()}
        else:
            out[i] = [doc] + [pila[k] for k in sorted(pila)]
    return doc, out, ls


def cambios_dia2() -> dict[str, set]:
    """Lo que tenía que ver un chunking incremental al pasar del día 1 al día 2."""
    v1, v2 = vivos(1), vivos(2)
    con_texto = lambda v: {d for d, x in v.items() if x["texto"]}  # noqa: E731
    t1, t2 = con_texto(v1), con_texto(v2)
    return {
        "rechunkeados": {d for d in t2 if d not in t1 or any(v1[d][k] != v2[d][k] for k in ("sha256_texto", "titulo"))},
        "solo_meta": {d for d in t2 & t1 if all(v1[d][k] == v2[d][k] for k in ("sha256_texto", "titulo")) and
                      any(v1[d][k] != v2[d][k] for k in ("acl", "url", "version"))},
        "borrados": t1 - t2,
    }
