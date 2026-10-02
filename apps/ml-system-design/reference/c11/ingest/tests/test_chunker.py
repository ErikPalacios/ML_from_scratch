"""Tests del chunker: tamaños, ruta de títulos, tablas que no se parten a mitad de fila, overlap e ids estables."""

import pytest

from chunker import (Chunker, ChunkerConfig, Document, Heading, Paragraph, RegexTokenCounter, Table,
                     from_markdown)

COUNT = RegexTokenCounter()


def words(n, word="dato"):
    """Un párrafo de n "tokens" (n palabras, sin puntos)."""
    return " ".join([word] * n)


def sentences(n_sentences, words_each=9):
    """n oraciones de words_each palabras + el punto = words_each + 1 tokens cada una."""
    return " ".join(f"{words(words_each, f'o{i}')}." for i in range(n_sentences))


def test_regex_counter_counts_words_and_punctuation():
    assert COUNT.count("Hasta 30 días, ¿no?") == 7  # Hasta · 30 · días · , · ¿ · no · ?


def test_heading_path_is_prefixed_and_kept_as_metadata():
    doc = from_markdown("d1", "Política de viajes", "# Viáticos\n## Colombia\nUS$55 por día.")
    [c] = Chunker().chunk(doc)
    assert c.text.startswith("Política de viajes > Viáticos > Colombia\n")
    assert c.heading_path == ("Política de viajes", "Viáticos", "Colombia")
    # El cuerpo NO dice "Colombia" ni "viáticos": sin la ruta, la pregunta "viáticos Colombia" no lo encontraría
    assert "US$55 por día." in c.text


def test_every_chunk_respects_max_tokens_and_targets_400():
    doc = Document("d1", "Manual", (Heading(1, "Uno"), Paragraph(sentences(120))))  # ≈ 1,200 tokens
    chunks = Chunker().chunk(doc)
    assert len(chunks) >= 3
    assert all(c.tokens <= 512 and not c.oversized for c in chunks)
    assert all(c.tokens <= 400 + 10 for c in chunks[:-1])  # cerrados cerca del objetivo (overlap incluido)


def test_overlap_repeats_whole_units_only():
    cfg = ChunkerConfig(target_tokens=60, max_tokens=80, overlap_tokens=20, min_tokens=10)
    doc = Document("d1", "T", (Paragraph(sentences(12)),))  # 12 oraciones de 10 tokens
    chunks = Chunker(config=cfg).chunk(doc)
    first_body = chunks[0].text.split("\n")[1:]
    second_body = chunks[1].text.split("\n")[1:]
    # las últimas oraciones del chunk 1 abren el chunk 2, ENTERAS (cada línea es una oración)
    assert second_body[0] in first_body
    assert all(line.endswith(".") for line in second_body)


def test_no_overlap_when_disabled():
    cfg = ChunkerConfig(target_tokens=60, max_tokens=80, overlap_tokens=0, min_tokens=10)
    chunks = Chunker(config=cfg).chunk(Document("d1", "T", (Paragraph(sentences(12)),)))
    bodies = [set(c.text.split("\n")[1:]) for c in chunks]
    assert all(not (a & b) for a, b in zip(bodies, bodies[1:], strict=False))


def test_new_section_starts_a_new_chunk():
    md = "# Plazo\n" + sentences(10) + "\n\n# Monto\n" + sentences(10)
    chunks = Chunker().chunk(from_markdown("d1", "Reembolsos", md))
    assert [c.heading_path[-1] for c in chunks] == ["Plazo", "Monto"]


def test_tiny_section_merges_with_its_subsections():
    md = "# Viáticos\nResumen corto.\n## México\nUS$60 por día.\n## Colombia\nUS$55 por día."
    chunks = Chunker().chunk(from_markdown("d1", "Guía", md))
    # "Viáticos" tiene 3 tokens: México se suma a su chunk; Colombia ya no (solo se junta un nivel)
    assert chunks[0].heading_path == ("Guía", "Viáticos")
    assert "México:" in chunks[0].text and "US$60" in chunks[0].text


def test_chunks_after_a_merged_one_carry_the_subsection_path():
    # Viáticos (enano) + Colombia larga: el primer chunk lleva la ruta del padre; los que siguen son SOLO de
    # Colombia y deben decirlo (si no, un párrafo que nunca repite "Colombia" no se encuentra ni se cita bien).
    paras = tuple(Paragraph(f"Regla {i}: " + sentences(6)) for i in range(12))  # ≈ 63 tokens cada uno
    doc = Document("d2", "Política de viajes", (Heading(1, "Viáticos"), Paragraph("Intro corta."),
                                                Heading(2, "Colombia"), *paras))
    chunks = Chunker().chunk(doc)
    assert len(chunks) >= 2
    assert chunks[0].heading_path == ("Política de viajes", "Viáticos") and "Colombia:" in chunks[0].text
    for c in chunks[1:]:
        assert c.heading_path[-1] == "Colombia"
        assert c.text.startswith("Política de viajes > Viáticos > Colombia\n")
        assert c.tokens <= 512


def test_small_table_stays_whole_with_its_header():
    md = "# Montos\n| Motivo | Monto |\n|---|---|\n| No recibido | US$50 |\n| Dañado | US$30 |"
    [c] = Chunker().chunk(from_markdown("d1", "Reembolsos", md))
    assert "| Motivo | Monto |" in c.text and "| Dañado | US$30 |" in c.text


def test_big_table_is_split_by_rows_with_header_repeated():
    rows = tuple((f"País {i}", f"US${50 + i}", words(20, "nota")) for i in range(60))
    doc = Document("d1", "Viáticos", (Heading(1, "Tabla"), Table(("País", "Viático", "Notas"), rows)))
    chunks = Chunker().chunk(doc)
    assert len(chunks) > 1
    seen_rows = []
    for c in chunks:
        assert c.kind == "table" and c.tokens <= 512
        assert "| País | Viático | Notas |" in c.text  # encabezado en CADA parte
        assert "(tabla, filas" in c.text
        body = [ln for ln in c.text.split("\n") if ln.startswith("| País ") and ln != "| País | Viático | Notas |"]
        seen_rows += body
    # cada fila aparece exactamente una vez y ENTERA (nunca partida entre dos chunks)
    assert seen_rows == [f"| País {i} | US${50 + i} | {words(20, 'nota')} |" for i in range(60)]


def test_no_multi_row_table_part_goes_over_the_ceiling():
    # Filas de tamaños variados: la reserva para la nota "(tabla, filas i–j de N)" debe ser la nota REAL
    import random
    rng = random.Random(1)
    for _ in range(40):
        rows = tuple(("f", words(rng.randint(1, 30), "x")) for _ in range(80))
        for c in Chunker().chunk(Document("d1", "T", (Table(("A", "B"), rows),))):
            n_rows = sum(1 for ln in c.text.split("\n") if ln.startswith("| f |"))
            if n_rows > 1:
                assert c.tokens <= 512 and not c.oversized


def test_single_row_bigger_than_a_chunk_is_flagged_not_cut():
    doc = Document("d1", "T", (Table(("A", "B"), (("x", words(600)),)),))
    [c] = Chunker().chunk(doc)
    assert c.oversized and c.tokens > 512  # se acepta y se marca: el prompt lo cuenta con su tamaño real


def test_huge_sentence_without_punctuation_is_split_by_words():
    doc = Document("d1", "T", (Paragraph(words(1300)),))  # un PDF mal parseado: 1,300 palabras sin un punto
    chunks = Chunker().chunk(doc)
    assert len(chunks) >= 3 and all(c.tokens <= 512 for c in chunks)


def test_chunk_ids_survive_an_insertion_at_the_top():
    base = "# A\n" + sentences(5) + "\n\n# B\n" + sentences(5, 7) + "\n\n# C\n" + sentences(5, 8)
    before = Chunker().chunk(from_markdown("d1", "T", base))
    after = Chunker().chunk(from_markdown("d1", "T", "# Nuevo\nUn párrafo nuevo al principio.\n\n" + base))
    # con ids por posición, TODO cambiaría; con ids por contenido, solo aparece uno nuevo
    assert {c.chunk_id for c in before} <= {c.chunk_id for c in after}
    assert len(after) == len(before) + 1


def test_identical_chunks_get_distinct_ids():
    doc = from_markdown("d1", "T", "# A\nTexto repetido.\n\n# A\nTexto repetido.")
    a, b = Chunker().chunk(doc)
    assert a.text == b.text and a.chunk_id != b.chunk_id


def test_markdown_parser_builds_the_document_model():
    md = "# H\nPárrafo uno\nsigue.\n\n- a\n- b\n\n1. paso\n2. paso\n\n| x | y |\n|---|---|\n| 1 | 2 |"
    doc = from_markdown("d1", "T", md)
    kinds = [type(b).__name__ for b in doc.blocks]
    assert kinds == ["Heading", "Paragraph", "ListBlock", "ListBlock", "Table"]
    assert doc.blocks[1].text == "Párrafo uno sigue."
    assert doc.blocks[3].ordered and not doc.blocks[2].ordered
    assert doc.blocks[4].header == ("x", "y") and doc.blocks[4].rows == (("1", "2"),)


def test_invalid_config_is_rejected():
    with pytest.raises(ValueError):
        ChunkerConfig(target_tokens=600, max_tokens=512)
    with pytest.raises(ValueError):
        ChunkerConfig(overlap_tokens=250)  # ≥ la mitad del chunk
