"""Pasos 3 a 5 · Los chunks de un documento.

Contrato:
- CHUNKER: la versión de cómo se parte. Súbela cuando cambies este archivo: con eso se vuelve a partir todo.
- chunks(texto, titulo, cfg) -> list[dict] en orden, cada uno {"ruta": [str], "texto": str, "tokens": int,
  "traslape": int}. cfg es config()["chunking"]; titulo, el del catálogo.
- Estrategia "estructura" (paso 3):
  - La ruta de títulos: el título del documento (su primera línea si es «# », si no el título del catálogo sin su
    extensión) y los títulos «#», «##» y «###» vigentes donde empieza el contenido del chunk.
  - El texto de un chunk es « › ».join(ruta) + "\\n\\n" + sus líneas unidas con "\\n", y contar(texto) ≤ objetivo,
    siempre. "tokens" es ese contar().
  - Se llena con bloques enteros, en orden. Un título va pegado al bloque que le sigue (un chunk nunca termina en un
    título). Un título «#» o «##» siempre empieza un chunk nuevo; un «###» no: las subsecciones de una sección se
    juntan mientras quepan. Así un chunk nunca mezcla dos secciones y su ruta es cierta para todo lo que trae.
  - Paso 4: un bloque que no cabe ni en un chunk vacío se parte: un párrafo por oraciones, una lista por ítems,
    una tabla por filas. Cada pedazo de una tabla de barras empieza con su encabezado (bloque["encabezado"]). Una
    tabla que cabe en un chunk vacío nunca se parte: si no cabe en lo que queda, empieza un chunk nuevo.
- Paso 5, traslape: cuando un corte cae dentro de una sección (no en un título) y no en una tabla, el chunk
  siguiente empieza con las últimas oraciones del anterior, hasta cfg["traslape"] tokens (tokens_texto), en su propia
  línea. "traslape" dice cuántos tokens repite (0 si ninguno).
- Estrategia "fija": ventanas de cfg["fija_caracteres"] caracteres que se traslapan cfg["fija_traslape"], sin ruta
  (ruta []) y sin mirar la estructura. Es la de muchos tutoriales: está para comparar (paso 3).
"""
from __future__ import annotations

import re

from bloques import bloques
from tokens import contar, tokens_texto

CHUNKER = "v1"
ORACION = re.compile(r"(?<=[.!?])\s+")
EXTENSION = re.compile(r"\.(md|pdf|txt|docx)$", re.I)


def oraciones(linea: str) -> list[str]:
    return [o for o in ORACION.split(linea) if o]


def texto_chunk(ruta: list[str], lineas: list[str]) -> str:
    return " › ".join(ruta) + "\n\n" + "\n".join(lineas)


class _Armado:
    """El chunk que se está llenando y la lista de los ya cerrados."""

    def __init__(self, cfg: dict):
        self.obj, self.tras = cfg["objetivo"], cfg["traslape"]
        self.out: list[dict] = []
        self.ruta: list[str] = []
        self.lineas: list[str] = []
        self.traslape = 0
        self.ultimo = None          # tipo del último bloque que entró: decide si un corte lleva traslape
        self.tabla = None           # id de la tabla cuyo encabezado ya va en este chunk
        self.abierta = False        # la última línea es un pedazo de párrafo que puede seguir creciendo

    def cabe(self, lineas: list[str], ruta=None) -> bool:
        return contar(texto_chunk(ruta or self.ruta, lineas)) <= self.obj

    def vacio(self) -> bool:
        return len(self.lineas) == (1 if self.traslape else 0)

    def tokens(self) -> int:
        return contar(texto_chunk(self.ruta, self.lineas))

    def cerrar(self) -> list[str]:
        """Cierra el chunk y devuelve el traslape que le toca al siguiente, si el corte es dentro de una sección."""
        if self.vacio():
            return []
        t = texto_chunk(self.ruta, self.lineas)
        self.out.append({"ruta": list(self.ruta), "texto": t, "tokens": contar(t), "traslape": self.traslape})
        cola = []
        if self.ultimo in ("parrafo", "lista"):
            for o in reversed(oraciones(self.lineas[-1])):
                if tokens_texto(" ".join([o] + cola)) > self.tras:
                    break
                cola.insert(0, o)
        self.lineas, self.traslape, self.tabla, self.abierta = [], 0, None, False
        return [" ".join(cola)] if cola else []

    def empezar(self, ruta: list[str], traslape: list[str]) -> None:
        self.ruta, self.lineas = ruta, list(traslape)
        self.traslape = tokens_texto(traslape[0]) if traslape else 0


def _unidades(bs: list[dict], doc: str) -> list[dict]:
    """Cada bloque de contenido con los títulos que lo anteceden y la ruta vigente."""
    pila: dict[int, str] = {}
    out, pendientes = [], []
    for b in bs:
        if b["tipo"] == "titulo":
            if not b.get("es_doc"):
                pila = {n: t for n, t in pila.items() if n < b["nivel"]}
                pila[b["nivel"]] = b["texto"]
            pendientes.append(b)
            continue
        out.append({"titulos": pendientes, "bloque": b, "ruta": [doc] + [pila[n] for n in sorted(pila)]})
        pendientes = []
    if pendientes:
        out.append({"titulos": pendientes, "bloque": {"tipo": "parrafo", "lineas": []}, "ruta": [doc] + [pila[n] for n in sorted(pila)]})
    return out


def _pedazos(b: dict) -> list[str]:
    if b["tipo"] == "parrafo":
        return oraciones(b["lineas"][0]) if b["lineas"] else []
    if b["tipo"] == "tabla":
        return b["lineas"][len(b["encabezado"]):]
    return b["lineas"]                 # lista: un ítem por pedazo


def _partir(a: _Armado, u: dict) -> None:
    """Paso 4: mete un bloque que no cabe entero, pedazo por pedazo."""
    b, titulos = u["bloque"], [l for t in u["titulos"] for l in t["lineas"]]
    for i, p in enumerate(_pedazos(b)):
        previo = titulos if i == 0 else []
        while True:
            if b["tipo"] == "tabla":
                enc = [] if a.tabla == id(b) else b["encabezado"]
                cand = a.lineas + previo + enc + [p]
            elif b["tipo"] == "parrafo" and a.abierta and not previo:
                cand = a.lineas[:-1] + [a.lineas[-1] + " " + p]
            else:
                cand = a.lineas + previo + [p]
            if a.cabe(cand):
                a.lineas, a.ultimo = cand, b["tipo"]
                a.tabla = id(b) if b["tipo"] == "tabla" else None
                a.abierta = b["tipo"] == "parrafo"
                break
            if a.vacio() and not a.traslape:
                raise ValueError(f"un pedazo no cabe ni solo en un chunk de {a.obj} tokens: {p[:60]}…")
            tras = a.cerrar()
            a.empezar(u["ruta"], [] if b["tipo"] == "tabla" else tras)   # una tabla no se traslapa: repite su encabezado
            if a.traslape and not a.cabe(a.lineas + previo + [p]):
                a.empezar(u["ruta"], [])    # el traslape no deja lugar: mejor sin él


def chunks_estructura(texto: str, titulo: str, cfg: dict) -> list[dict]:
    bs = bloques(texto)
    doc = EXTENSION.sub("", titulo)
    if bs and bs[0]["tipo"] == "titulo" and bs[0]["nivel"] == 1:
        doc = bs[0]["texto"]
        bs[0] = bs[0] | {"es_doc": True}
    a = _Armado(cfg)
    a.empezar([doc], [])
    for u in _unidades(bs, doc):
        lineas = [l for t in u["titulos"] for l in t["lineas"]] + u["bloque"]["lineas"]
        if any(t["nivel"] <= 2 and not t.get("es_doc") for t in u["titulos"]) and not a.vacio():
            a.cerrar()
            a.empezar(u["ruta"], [])
        if a.vacio() and not a.traslape:
            a.ruta = u["ruta"]
        if a.cabe(a.lineas + lineas):
            a.lineas += lineas
            a.ultimo, a.tabla, a.abierta = u["bloque"]["tipo"], None, False
            continue
        if not a.vacio():
            corte_en_seccion = not u["titulos"] and u["bloque"]["tipo"] != "tabla" and a.ultimo != "tabla"
            tras = a.cerrar()
            a.empezar(u["ruta"], tras if corte_en_seccion else [])
            if a.cabe(a.lineas + lineas):
                a.lineas += lineas
                a.ultimo, a.tabla, a.abierta = u["bloque"]["tipo"], None, False
                continue
            if a.traslape and a.cabe(lineas, u["ruta"]):
                a.empezar(u["ruta"], [])
                a.lineas += lineas
                a.ultimo, a.tabla, a.abierta = u["bloque"]["tipo"], None, False
                continue
        _partir(a, u)
    a.cerrar()
    return a.out


def chunks_fijos(texto: str, cfg: dict) -> list[dict]:
    n, t = cfg["fija_caracteres"], cfg["fija_traslape"]
    out, i = [], 0
    while True:
        pedazo = texto[i:i + n]
        out.append({"ruta": [], "texto": pedazo, "tokens": contar(pedazo), "traslape": tokens_texto(texto[i:i + t]) if i else 0})
        if i + n >= len(texto):
            return out
        i += n - t


def chunks(texto: str, titulo: str, cfg: dict) -> list[dict]:
    if cfg["estrategia"] == "fija":
        return chunks_fijos(texto, cfg)
    if cfg["estrategia"] == "estructura":
        return chunks_estructura(texto, titulo, cfg)
    raise ValueError(f"estrategia desconocida: {cfg['estrategia']}")
