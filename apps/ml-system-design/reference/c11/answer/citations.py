"""Validación de citas (caso c11): cada [n] de la respuesta tiene que ser una fuente recuperada Y permitida.

Qué hace con la respuesta completa del modelo:
  1. Encuentra las marcas [n] y [n, m] (n de 1 a 99; "[2024]" no es una cita y no se toca).
  2. Cada n se valida: ¿existe la fuente n en ESTE prompt? (si no, el modelo inventó el número) ¿y la persona
     puede ver ese chunk? (se vuelve a aplicar la regla de ACL: si alguna vez falla, es un bug aguas arriba, y una
     cita a un documento prohibido revelaría su título y su URL). Las inválidas se BORRAN del texto y se reportan.
  3. Marca como "sin cita" las oraciones que parecen afirmar algo (≥ 6 palabras) y no tienen ninguna cita válida.
  4. Devuelve la lista de citas válidas con título, sección, fecha y URL para que la interfaz las muestre.

Lo que esto NO verifica (y dónde se mide): que la fuente citada RESPALDE lo que dice la oración. Una cita válida
puede apuntar a un chunk que dice otra cosa. Eso es groundedness / citation precision y lo mide un juez calibrado
contra personas (eval/groundedness.py), no una regex. La heurística de "oración sin cita" también falla: no ve
afirmaciones partidas en dos oraciones, ni sabe que "Hola, te ayudo con eso." no necesita cita (por eso el umbral
de 6 palabras y las frases de cortesía cortas pasan).

Streaming: la persona ve el texto mientras se genera, con las marcas tal como las escribió el modelo. El evento
final trae el texto LIMPIO y las citas válidas; la interfaz convierte en enlace solo las del evento final y
reemplaza el texto. Si una cita era inválida, desaparece al terminar (y se cuenta en rag_citations_total).

Puro: sin I/O.
"""

from __future__ import annotations  # anotaciones como texto

import re  # marcas y oraciones
from collections.abc import Sequence  # tipos
from dataclasses import dataclass, field  # resultado

from acl import fields_allow  # la misma regla de permisos del índice
from prompt_builder import Source  # las fuentes numeradas del prompt

_CITE_RE = re.compile(r"\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]")  # [3] · [1, 4] · (y [1][2] son dos marcas seguidas)
_SENTENCE_RE = re.compile(r"(?<=[.!?…])\s+|\n+")
_WORD_RE = re.compile(r"\w+", re.UNICODE)


@dataclass(frozen=True)
class Citation:
    n: int
    doc_id: str
    chunk_id: str
    title: str
    section: str
    url: str
    updated_at: str


@dataclass
class CitationReport:
    text: str  # la respuesta con las marcas inválidas borradas
    citations: list[Citation] = field(default_factory=list)  # válidas, en orden de primera aparición
    invalid: list[tuple[int, str]] = field(default_factory=list)  # (n, "not_retrieved" | "not_allowed")
    uncited_sentences: list[str] = field(default_factory=list)

    @property
    def cited_doc_ids(self) -> list[str]:
        return list(dict.fromkeys(c.doc_id for c in self.citations))


_LEADING_CITES_RE = re.compile(r"^((?:\[\d{1,2}(?:\s*,\s*\d{1,2})*\]\s*)+)")


def _sentences(text: str) -> list[str]:
    """Oraciones, con las citas que el modelo puso DESPUÉS del punto ("…hábiles. [1] Otra…") devueltas a la
    oración anterior: si no, "…hábiles." quedaría como oración sin cita y "[1] Otra…" como citada."""
    out: list[str] = []
    for seg in _SENTENCE_RE.split(text):
        m = _LEADING_CITES_RE.match(seg.strip())
        if m and out:
            out[-1] += " " + m.group(1).strip()
            seg = seg.strip()[m.end():]
        if seg.strip():
            out.append(seg)
    return out


def validate(answer: str, sources: Sequence[Source], principals: frozenset[str],
             min_words: int = 6) -> CitationReport:
    by_n = {s.n: s for s in sources}
    report = CitationReport(text="")
    seen: set[int] = set()

    def check(n: int) -> bool:
        s = by_n.get(n)
        if s is None:
            report.invalid.append((n, "not_retrieved"))
            return False
        if not fields_allow(s.acl_fields, principals):
            report.invalid.append((n, "not_allowed"))
            return False
        if n not in seen:
            seen.add(n)
            report.citations.append(Citation(n, s.doc_id, s.chunk_id, s.title, s.section, s.url, s.updated_at))
        return True

    def replace(m: re.Match) -> str:
        ok = [n for n in (int(x) for x in m.group(1).split(",")) if check(n)]
        return "[" + ", ".join(str(n) for n in ok) + "]" if ok else ""

    cleaned = _CITE_RE.sub(replace, answer)
    cleaned = re.sub(r"[ \t]+([.,;:])", r"\1", cleaned)  # "dato [9]." → "dato ." → "dato."
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned).strip()
    report.text = cleaned

    for sentence in _sentences(cleaned):
        s = sentence.strip()
        if not s or s.endswith(":"):
            continue  # vacía o introducción de una lista ("Los pasos son:")
        if _CITE_RE.search(s):
            continue
        if len(_WORD_RE.findall(s)) >= min_words:
            report.uncited_sentences.append(s)
    return report
