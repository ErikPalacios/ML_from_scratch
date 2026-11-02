"""Tests de las citas: válidas, inventadas, prohibidas, oraciones sin cita y lo que NO se detecta."""

from acl import OPEN
from citations import validate
from prompt_builder import Source

SOP = {"acl_0": ("group:google:soporte@acme.com",), "acl_1": (OPEN,), "acl_2": (OPEN,)}
FIN = {"acl_0": ("group:google:finanzas@acme.com",), "acl_1": (OPEN,), "acl_2": (OPEN,)}
ANA = frozenset({OPEN, "user:ana@acme.com", "group:google:soporte@acme.com"})


def src(n, doc, fields=SOP):
    return Source(n, f"{doc}#c", doc, f"Título {doc}", "Plazo", f"https://w/{doc}", "2026-07-01", "texto", fields)


SOURCES = [src(1, "confluence:2001"), src(2, "policies:macro-15"), src(3, "drive:3001", FIN)]


def test_valid_citations_are_returned_once_in_order():
    r = validate("El plazo es de 30 días [1]. El reembolso llega en 5 a 10 días hábiles [2][1].", SOURCES, ANA)
    assert [c.n for c in r.citations] == [1, 2] and r.cited_doc_ids == ["confluence:2001", "policies:macro-15"]
    assert r.invalid == [] and r.uncited_sentences == []
    assert r.text == "El plazo es de 30 días [1]. El reembolso llega en 5 a 10 días hábiles [2][1]."


def test_invented_number_is_removed_and_reported():
    r = validate("El plazo es de 30 días [7].", SOURCES, ANA)
    assert r.invalid == [(7, "not_retrieved")] and r.citations == [] and r.text == "El plazo es de 30 días."


def test_citation_to_a_forbidden_source_is_removed():
    # No debería pasar (la fuente 3 nunca llegaría al prompt de ana), pero si pasa, su título y URL no salen
    r = validate("El bono se paga el último viernes [3].", SOURCES, ANA)
    assert r.invalid == [(3, "not_allowed")] and r.citations == []


def test_grouped_markers_keep_only_valid_numbers():
    r = validate("Dos fuentes lo dicen [1, 9, 2].", SOURCES, ANA)
    assert r.text == "Dos fuentes lo dicen [1, 2]." and r.invalid == [(9, "not_retrieved")]


def test_years_in_brackets_are_not_citations():
    r = validate("La versión [2024] fue reemplazada [1].", SOURCES, ANA)
    assert "[2024]" in r.text and r.invalid == []


def test_uncited_factual_sentence_is_flagged_but_short_ones_and_list_intros_are_not():
    answer = ("Claro, te ayudo. Los pasos son:\nEl comprador abre una disputa desde la app en su pedido.\n"
              "Plazo de 30 días [1].")
    r = validate(answer, SOURCES, ANA)
    assert r.uncited_sentences == ["El comprador abre una disputa desde la app en su pedido."]


def test_what_this_does_not_catch_a_valid_cite_that_says_something_else():
    # [1] existe y se puede ver, pero la fuente 1 dice 30 días, no 90: eso lo mide el juez (eval/groundedness.py)
    r = validate("El plazo es de 90 días [1].", SOURCES, ANA)
    assert r.invalid == [] and [c.n for c in r.citations] == [1]


def test_citation_after_the_period_belongs_to_the_previous_sentence():
    r = validate("El plazo es de 30 días naturales desde la entrega. [1] El reembolso llega al medio de pago en días "
                 "hábiles. [2]", SOURCES, ANA)
    assert r.uncited_sentences == [] and [c.n for c in r.citations] == [1, 2]
