"""Chunking por estructura (caso c11): de un documento con títulos, párrafos, listas y tablas a chunks de ≈ 400 tokens.

Por qué no "cortar cada 400 tokens" y ya:
  - Un corte ciego parte una respuesta a la mitad ("Los días de vacaciones son" | "12 el primer año"). El chunk
    que tiene el número ya no dice de qué es el número, y el retrieval no lo encuentra.
  - Una tabla cortada a la mitad de una fila produce un chunk con "| 3 años | 16 |" sin encabezado: nadie (ni el
    modelo) sabe qué columna es cuál.
  - Un párrafo bajo "Política de viajes > Viáticos > Colombia" casi nunca repite "Colombia" ni "viáticos": el
    contexto está en los TÍTULOS. Por eso cada chunk empieza con su ruta de títulos.

Qué hace (en orden):
  1. Recorre los bloques del documento manteniendo la ruta de títulos (título del doc > H1 > H2 …).
  2. Cada título abre un chunk nuevo (una sección no se mezcla con la siguiente), salvo que el chunk actual sea
     muy chico (< min_tokens) y el título nuevo sea una SUBsección: ahí sigue en el mismo chunk, con la ruta del
     padre. Si esa subsección no termina en ese chunk, los chunks que siguen llevan SU ruta (la más profunda).
  3. Junta "unidades" (un párrafo, una oración si el párrafo no cabe, un ítem de lista) hasta ≈ target_tokens.
  4. Al cerrar un chunk por tamaño (no por título), el siguiente arranca con la(s) última(s) unidad(es) ENTERA(S)
     del anterior (un párrafo, un ítem, o una oración si el párrafo era más largo que un chunk) si caben en
     overlap_tokens. Con párrafos de más de 50 tokens no hay overlap, y casi no hace falta: los cortes caen
     entre párrafos, no dentro de una idea.
  5. Tablas: entera si cabe; si no cabe en un chunk, se parte POR FILAS repitiendo el encabezado en cada parte.
     Una fila nunca se corta. Una sola fila más grande que un chunk sale sola y marcada `oversized` (el armado
     del prompt la ve y la cuenta con su tamaño real).

Números del caso (#c11.datos): chunks de ≈ 400 tokens; 1.5 M documentos → ≈ 12 M chunks (≈ 4.8 B tokens).
target_tokens = 400 es el objetivo y max_tokens = 512 el techo duro (8 chunks × 512 = 4,096 tokens: el peor caso
todavía entra en el presupuesto de 8k del prompt, ver answer/prompt_builder.py).

Tokens: TokenCounter es una interfaz. En producción se cuenta con el tokenizer DEL MODELO DE EMBEDDINGS (el
límite que importa al embeber es el suyo; el del LLM lo cuida prompt_builder.py), por ejemplo con
`AutoTokenizer.from_pretrained(<modelo>)` y `len(tok.encode(texto, add_special_tokens=False))`. Aquí se usa
RegexTokenCounter (palabras y signos): no necesita descargar nada, pero NO es el tokenizer real; los tokenizers
de subpalabras suelen dar MÁS tokens que palabras en español. Mide la razón con tu corpus antes de fijar
target_tokens.

Qué NO hace (y quién lo hace): sacar texto y estructura de la fuente. Confluence entrega XHTML ("storage
format"), Drive exporta Docs a HTML/texto, los PDFs necesitan un parser que respete el layout y los escaneados,
OCR. Cada conector convierte a este modelo de documento (Heading, Paragraph, ListBlock, Table); `from_markdown`
es un convertidor mínimo para tests y demos. Tampoco quita encabezados y pies de página repetidos de los PDFs:
eso va en el parser (si no, aparecen en cientos de chunks y ensucian el BM25).

Puro: biblioteca estándar, sin I/O.
"""

from __future__ import annotations  # anotaciones como texto (sintaxis moderna sin costo en runtime)

import hashlib  # id de chunk derivado del contenido (estable entre re-ingestas)
import re  # contador de tokens de respaldo, oraciones y el parser de markdown mínimo
from dataclasses import dataclass, field  # bloques y chunks inmutables: fáciles de comparar en tests
from typing import Protocol  # interfaz del contador de tokens (sin herencia)


# ---------------------------------------------------------------------------- tokens
class TokenCounter(Protocol):
    """Cuenta tokens de un texto. Producción: el tokenizer del modelo de embeddings."""

    def count(self, text: str) -> int: ...


_TOKEN_RE = re.compile(r"\w+|[^\w\s]", re.UNICODE)  # una palabra o un signo suelto = 1 "token"


class RegexTokenCounter:
    """Respaldo para tests y demos: cuenta palabras y signos. Subestima a un tokenizer de subpalabras."""

    def count(self, text: str) -> int:
        return len(_TOKEN_RE.findall(text))


# ---------------------------------------------------------------------------- modelo de documento
@dataclass(frozen=True)
class Heading:
    level: int  # 1 = H1; el título del documento NO es un Heading (va en Document.title)
    text: str


@dataclass(frozen=True)
class Paragraph:
    text: str


@dataclass(frozen=True)
class ListBlock:
    items: tuple[str, ...]
    ordered: bool = False  # "1." en vez de "-": el orden de los pasos es información


@dataclass(frozen=True)
class Table:
    header: tuple[str, ...]  # se repite en cada parte si la tabla se parte
    rows: tuple[tuple[str, ...], ...]
    caption: str = ""


Block = Heading | Paragraph | ListBlock | Table


@dataclass(frozen=True)
class Document:
    doc_id: str  # id ESTABLE de la fuente (p. ej. "confluence:123456"): la clave de la ingesta incremental
    title: str
    blocks: tuple[Block, ...]


@dataclass(frozen=True)
class Chunk:
    chunk_id: str  # doc_id + hash del texto: un chunk que no cambió conserva su id (y su embedding)
    doc_id: str
    ordinal: int  # posición dentro del documento (para mostrar "sección 3 de 7" y para depurar)
    text: str  # lo que se embebe, se indexa en BM25 y entra al prompt: EMPIEZA con la ruta de títulos
    heading_path: tuple[str, ...]  # (título del doc, H1, H2, …): metadato para la cita ("Sección: …")
    tokens: int  # contado con el mismo TokenCounter
    kind: str = "text"  # "text" | "table"
    oversized: bool = False  # True solo si una unidad indivisible (una fila) no cabe en max_tokens


@dataclass(frozen=True)
class ChunkerConfig:
    target_tokens: int = 400  # objetivo del caso: se cierra el chunk antes de pasarlo
    max_tokens: int = 512  # techo duro (incluye la ruta de títulos); una unidad sola de hasta 512 cabe
    overlap_tokens: int = 50  # ≈ 12 %: repite la(s) última(s) unidad(es) enteras si caben (ver el paso 4 arriba)
    min_tokens: int = 80  # una sección más chica que esto se junta con sus subsecciones (chunks enanos rinden mal)

    def __post_init__(self) -> None:
        if not 0 < self.min_tokens < self.target_tokens <= self.max_tokens:
            raise ValueError("se espera 0 < min_tokens < target_tokens <= max_tokens")
        if not 0 <= self.overlap_tokens < self.target_tokens // 2:
            # overlap ≥ la mitad del chunk = cada texto se embebe dos veces o más: el índice crece sin ganar nada
            raise ValueError("overlap_tokens debe ser < target_tokens / 2")


# ---------------------------------------------------------------------------- chunker
_SENTENCE_RE = re.compile(r"(?<=[.!?…])\s+")  # corte de oración simple: suficiente para no partir frases


@dataclass
class _Unit:
    text: str
    tokens: int
    overlappable: bool = True  # las filas de tabla y los títulos no se repiten como overlap


@dataclass
class _Builder:
    """Estado mientras se arma un chunk de texto."""

    path: tuple[str, ...]
    units: list[_Unit] = field(default_factory=list)
    # Ruta de una subsección que se juntó con su padre enano: el chunk actual lleva la ruta del padre, pero el
    # SIGUIENTE (si la subsección sigue después de un corte por tamaño) debe llevar la de la subsección.
    next_path: tuple[str, ...] | None = None

    def body_tokens(self) -> int:
        return sum(u.tokens for u in self.units)

    def deepest(self) -> tuple[str, ...]:
        # La ruta más larga que puede tocarle al texto que llega: con ella se mide el espacio (conservador)
        return self.next_path or self.path

    def advance_path(self) -> None:
        # Después de cerrar el chunk mezclado, el texto que sigue es de la subsección: pasa a su ruta
        if self.next_path:
            self.path, self.next_path = self.next_path, None


class Chunker:
    def __init__(self, counter: TokenCounter | None = None, config: ChunkerConfig | None = None):
        self.counter = counter or RegexTokenCounter()
        self.cfg = config or ChunkerConfig()

    # -- API
    def chunk(self, doc: Document) -> list[Chunk]:
        out: list[Chunk] = []
        stack: list[Heading] = []  # títulos abiertos (H1 > H2 > …)
        cur = _Builder(path=(doc.title,))
        for block in doc.blocks:
            if isinstance(block, Heading):
                deeper = bool(stack) and block.level > stack[-1].level and len(cur.path) == len(stack) + 1
                while stack and stack[-1].level >= block.level:  # un H2 cierra el H2 anterior y sus H3
                    stack.pop()
                stack.append(block)
                new_path = (doc.title, *(h.text for h in stack))
                if cur.units and deeper and cur.body_tokens() < self.cfg.min_tokens:
                    # Sección enana con subsecciones: se queda en el mismo chunk, con el subtítulo como línea.
                    # La ruta del chunk sigue siendo la del padre (es la que describe a todo el chunk); los chunks
                    # que sigan, si la subsección no termina aquí, llevan la de la subsección (next_path).
                    cur.units.append(self._unit(block.text + ":", overlappable=False))
                    cur.next_path = new_path
                    continue
                self._flush(cur, doc, out)
                cur = _Builder(path=new_path)
            elif isinstance(block, Paragraph):
                for unit in self._paragraph_units(block.text, cur.deepest()):
                    self._add(unit, cur, doc, out)
            elif isinstance(block, ListBlock):
                for i, item in enumerate(block.items, 1):
                    bullet = f"{i}. " if block.ordered else "- "
                    for unit in self._paragraph_units(bullet + item, cur.deepest()):
                        self._add(unit, cur, doc, out)
            elif isinstance(block, Table):
                cur = self._table(block, cur, doc, out)
            else:  # un tipo de bloque nuevo que alguien agregó al parser sin enseñárselo al chunker
                raise TypeError(f"bloque desconocido: {type(block).__name__}")
        self._flush(cur, doc, out)
        return self._assign_ids(doc, out)

    # -- unidades de texto
    def _unit(self, text: str, overlappable: bool = True) -> _Unit:
        return _Unit(text, self.counter.count(text), overlappable)

    def _prefix(self, path: tuple[str, ...]) -> str:
        return " > ".join(p for p in path if p)  # "Política de viajes > Viáticos > Colombia"

    def _room(self, path: tuple[str, ...]) -> int:
        # La ruta de títulos cuenta contra el techo: el chunk ENTERO (ruta + cuerpo) va al embedding y al prompt
        return self.cfg.max_tokens - self.counter.count(self._prefix(path)) - 1

    def _paragraph_units(self, text: str, path: tuple[str, ...]) -> list[_Unit]:
        text = " ".join(text.split())  # espacios y saltos de línea repetidos no son información
        if not text:
            return []
        whole = self._unit(text)
        if whole.tokens <= self.cfg.target_tokens:
            return [whole]  # el caso común: el párrafo entero es una unidad
        units = [self._unit(s) for s in _SENTENCE_RE.split(text) if s]
        room = self._room(path)
        out: list[_Unit] = []
        for u in units:
            if u.tokens <= room:
                out.append(u)
                continue
            # Una "oración" de más de un chunk (un PDF mal parseado sin puntos, un log pegado): se parte por
            # palabras. Es el único lugar donde se corta texto a ciegas, y solo porque no queda otra.
            words = u.text.split(" ")
            piece: list[str] = []
            for w in words:
                if piece and self.counter.count(" ".join([*piece, w])) > room:
                    out.append(self._unit(" ".join(piece), overlappable=False))
                    piece = []
                piece.append(w)
            if piece:
                out.append(self._unit(" ".join(piece), overlappable=False))
        return out

    def _add(self, unit: _Unit, cur: _Builder, doc: Document, out: list[Chunk]) -> None:
        prefix_tokens = self.counter.count(self._prefix(cur.path)) + 1
        if cur.units and prefix_tokens + cur.body_tokens() + unit.tokens > self.cfg.target_tokens:
            tail = self._overlap_tail(cur)  # la(s) última(s) unidad(es) enteras pasan al chunk siguiente
            self._flush(cur, doc, out)
            cur.advance_path()  # tras un chunk mezclado, el siguiente lleva la ruta de la subsección
            prefix_tokens = self.counter.count(self._prefix(cur.path)) + 1
            cur.units = tail
            if tail and prefix_tokens + cur.body_tokens() + unit.tokens > self.cfg.max_tokens:
                cur.units = []  # el overlap no puede empujar al chunk siguiente sobre el techo: se sacrifica
        cur.units.append(unit)

    def _overlap_tail(self, cur: _Builder) -> list[_Unit]:
        if self.cfg.overlap_tokens == 0:
            return []
        tail: list[_Unit] = []
        total = 0
        for u in reversed(cur.units):
            if not u.overlappable or total + u.tokens > self.cfg.overlap_tokens:
                break  # unidades ENTERAS: si la última oración no cabe en el overlap, no hay overlap
            tail.insert(0, u)
            total += u.tokens
        if len(tail) == len(cur.units):
            return []  # el chunk entero cabría como overlap: repetirlo completo solo duplica
        return tail

    def _flush(self, cur: _Builder, doc: Document, out: list[Chunk]) -> None:
        if not cur.units:
            return
        body = "\n".join(u.text for u in cur.units)
        text = self._prefix(cur.path) + "\n" + body
        tokens = self.counter.count(text)
        out.append(Chunk("", doc.doc_id, len(out), text, cur.path, tokens, "text", tokens > self.cfg.max_tokens))
        cur.units = []

    # -- tablas
    @staticmethod
    def _row(cells: tuple[str, ...]) -> str:
        return "| " + " | ".join(" ".join(c.split()) for c in cells) + " |"

    def _table(self, table: Table, cur: _Builder, doc: Document, out: list[Chunk]) -> _Builder:
        head = [self._row(table.header), "| " + " | ".join("---" for _ in table.header) + " |"]
        if table.caption:
            head.insert(0, table.caption)
        rows = [self._row(r) for r in table.rows]
        whole = "\n".join(head + rows)
        whole_tokens = self.counter.count(whole)
        prefix_tokens = self.counter.count(self._prefix(cur.path)) + 1
        if cur.units and prefix_tokens + cur.body_tokens() + whole_tokens <= self.cfg.target_tokens:
            cur.units.append(_Unit(whole, whole_tokens, overlappable=False))  # cabe con el texto anterior
            return cur
        self._flush(cur, doc, out)  # la tabla no se mezcla a medias con el texto: chunk propio
        cur.advance_path()  # si venía de un chunk mezclado, la tabla es de la subsección
        room = self._room(cur.path)
        if whole_tokens <= room:
            self._emit_table(cur.path, whole, doc, out)
            return _Builder(path=cur.path)
        # No cabe: partes por FILAS, cada una con el encabezado repetido y la nota "(tabla, filas i–j de N)".
        n = len(rows)
        # Se reserva la nota del peor caso (los números más largos posibles), contada con el MISMO contador
        head_tokens = self.counter.count("\n".join(head)) + self.counter.count(f"(tabla, filas {n}–{n} de {n})")
        parts: list[list[int]] = [[]]
        used = head_tokens
        for i, r in enumerate(rows):
            t = self.counter.count(r)
            if parts[-1] and used + t > room:
                parts.append([])
                used = head_tokens
            parts[-1].append(i)
            used += t
        for idx in parts:
            note = f"(tabla, filas {idx[0] + 1}–{idx[-1] + 1} de {n})"
            text = "\n".join([*head, note, *(rows[i] for i in idx)])
            self._emit_table(cur.path, text, doc, out)
        return _Builder(path=cur.path)

    def _emit_table(self, path: tuple[str, ...], body: str, doc: Document, out: list[Chunk]) -> None:
        text = self._prefix(path) + "\n" + body
        tokens = self.counter.count(text)
        # oversized solo pasa con UNA fila más grande que un chunk: se acepta antes que cortar la fila
        out.append(Chunk("", doc.doc_id, len(out), text, path, tokens, "table", tokens > self.cfg.max_tokens))

    # -- ids
    @staticmethod
    def _assign_ids(doc: Document, chunks: list[Chunk]) -> list[Chunk]:
        # id = doc_id + sha256 del texto. Por qué no doc_id + posición: insertar un párrafo al principio correría
        # TODAS las posiciones y la ingesta incremental re-embebería el documento entero. Con el hash, los chunks
        # que no cambiaron conservan su id y su vector (ingest/incremental.py). Dos chunks idénticos en el mismo
        # documento (texto repetido) se distinguen con un sufijo.
        seen: dict[str, int] = {}
        out = []
        for c in chunks:
            h = hashlib.sha256(c.text.encode("utf-8")).hexdigest()[:16]
            n = seen.get(h, 0)
            seen[h] = n + 1
            cid = f"{doc.doc_id}#{h}" + (f"~{n}" if n else "")
            out.append(Chunk(cid, c.doc_id, c.ordinal, c.text, c.heading_path, c.tokens, c.kind, c.oversized))
        return out


# ---------------------------------------------------------------------------- markdown mínimo (tests y demo)
_HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")
_BULLET_RE = re.compile(r"^\s*(?:[-*]|(\d+)\.)\s+(.*)$")


def from_markdown(doc_id: str, title: str, text: str) -> Document:
    """Convierte markdown simple (# títulos, párrafos, - listas, 1. listas, | tablas |) al modelo de documento.

    No es un parser de markdown completo: es lo justo para escribir fixtures legibles. Los conectores reales
    convierten XHTML de Confluence, HTML de Drive o la salida de un parser de PDF a estos mismos bloques.
    """
    blocks: list[Block] = []
    para: list[str] = []
    items: list[str] = []
    ordered = False
    table: list[tuple[str, ...]] = []

    def close() -> None:
        nonlocal para, items, table
        if para:
            blocks.append(Paragraph(" ".join(para)))
            para = []
        if items:
            blocks.append(ListBlock(tuple(items), ordered))
            items = []
        if table:
            # fila 0 = encabezado; la fila de separadores (|---|) ya se descartó al leer
            blocks.append(Table(table[0], tuple(table[1:])))
            table = []

    for raw in text.splitlines():
        line = raw.rstrip()
        if not line.strip():
            close()
            continue
        if m := _HEADING_RE.match(line):
            close()
            blocks.append(Heading(len(m.group(1)), m.group(2).strip()))
        elif line.lstrip().startswith("|"):
            if para or items:
                close()
            cells = tuple(c.strip() for c in line.strip().strip("|").split("|"))
            if all(re.fullmatch(r":?-{3,}:?", c) for c in cells):
                continue  # |---|---| separa encabezado y filas
            table.append(cells)
        elif m := _BULLET_RE.match(line):
            if para or table:
                close()
            if not items:
                ordered = m.group(1) is not None
            items.append(m.group(2).strip())
        else:
            if items or table:
                close()
            para.append(line.strip())
    close()
    return Document(doc_id, title, tuple(blocks))
