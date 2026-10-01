"""Tests de WER y latencias con casos calculados a mano."""

import json
import math

import pytest

from wer import (
    ErrorCounts,
    align,
    by_slice,
    corpus_wer,
    latency_percentiles,
    normalize,
    percentile,
    read_latency_log,
    spanish_number,
    utterance_errors,
)


# ---------------------------------------------------------------------------- alineación
def test_docstring_example_one_substitution_one_insertion():
    c = utterance_errors("el gato se sentó", "el pato se sentó en")
    assert (c.substitutions, c.deletions, c.insertions, c.ref_words) == (1, 0, 1, 4)
    assert c.wer == 0.5


def test_deletion_and_wer_above_one():
    assert align("a b c d".split(), "a c d".split()) == ErrorCounts(0, 1, 0, 4, 1)
    c = utterance_errors("sí", "eh sí claro que")  # 3 inserciones sobre 1 palabra
    assert c.insertions == 3 and c.wer == 3.0


def test_empty_reference_or_hypothesis():
    assert utterance_errors("", "hola").wer == math.inf  # WER indefinido: solo tiene sentido en el corpus
    assert utterance_errors("", "").wer == 0.0
    c = utterance_errors("buenos días", "")
    assert c.deletions == 2 and c.wer == 1.0


# ---------------------------------------------------------------------------- normalización
def test_normalization_changes_the_number_not_the_model():
    ref, hyp = "¿Está listo el reporte de 2026?", "esta listo el reporte de dos mil veintiséis"
    # Sin números: "2026" vs "dos mil veintiséis" = 1 S + 2 I, más está/esta = 1 S → 4 / 6
    raw = utterance_errors(ref, hyp, numbers=False)
    assert (raw.substitutions, raw.insertions, raw.ref_words) == (2, 2, 6)
    # Con números en palabras: solo queda la tilde → 1 / 8
    assert utterance_errors(ref, hyp).wer == 1 / 8
    # Plegando tildes: 0
    assert utterance_errors(ref, hyp, fold_accents=True).wer == 0.0


def test_fold_accents_keeps_enie():
    assert normalize("Año ÚNICO pingüino", fold_accents=True) == ["año", "unico", "pinguino"]
    assert normalize("año") != normalize("ano")


def test_unicode_composed_and_decomposed_are_equal():
    composed = "canción"  # ó como un solo carácter
    decomposed = "canción"  # o + acento combinante (así llega a veces desde otro sistema)
    assert composed != decomposed
    assert utterance_errors(composed, decomposed).wer == 0.0


def test_punctuation_thousands_and_percent():
    assert normalize("¡Hola, mundo!… «sí» — no") == ["hola", "mundo", "sí", "no"]
    assert normalize("Vendimos 1,500 unidades") == ["vendimos", "mil", "quinientos", "unidades"]
    assert normalize("subió 30%") == ["subió", "treinta", "por", "ciento"]
    assert normalize("it's 30%", language="en-US") == ["its", "30", "percent"]  # inglés: dígitos tal cual


@pytest.mark.parametrize("text,language,words", [
    ("3,5 por ciento", "es-419", ["3,5", "por", "ciento"]),  # decimal: un token, no "tres cinco"
    ("subió 3,5%", "es-419", ["subió", "3,5", "por", "ciento"]),
    ("a las 3:30.", "es-419", ["a", "las", "3:30"]),  # hora: no "tres treinta"
    ("cuesta $500", "es-419", ["cuesta", "$500"]),  # monto: el símbolo no desaparece en silencio
    ("1.º lugar", "es-419", ["1.º", "lugar"]),  # ordinal: no "uno º"
    ("pi is 3.141", "en-US", ["pi", "is", "3.141"]),  # en inglés "." es decimal, no separador de miles
    ("we sold 1,500", "en-US", ["we", "sold", "1500"]),
    ("Vendimos 1.500 unidades.", "es-419", ["vendimos", "mil", "quinientos", "unidades"]),
])
def test_decimals_times_ordinals_and_money_stay_literal(text, language, words):
    assert normalize(text, language=language) == words


def test_literal_numbers_are_visible_errors_not_invented_words():
    # Antes "3:30" se partía en "tres treinta": un error que nadie dijo. Ahora es 1 S + 2 I, visible en el
    # reporte, y si importa se escribe una regla para horas (versionada)
    c = utterance_errors("son las 3:30", "son las tres y media")
    assert (c.substitutions, c.insertions, c.ref_words) == (1, 2, 3)
    assert utterance_errors("son las 3:30", "son las 3:30").wer == 0.0


@pytest.mark.parametrize("n,words", [
    (0, "cero"), (15, "quince"), (21, "veintiuno"), (26, "veintiséis"), (30, "treinta"),
    (31, "treinta y uno"), (100, "cien"), (101, "ciento uno"), (500, "quinientos"),
    (999, "novecientos noventa y nueve"), (1000, "mil"), (1999, "mil novecientos noventa y nueve"),
    (2026, "dos mil veintiséis"), (21000, "veintiún mil"), (31000, "treinta y un mil"),
    (101000, "ciento un mil"), (999999, "novecientos noventa y nueve mil novecientos noventa y nueve"),
])
def test_spanish_numbers(n, words):
    assert spanish_number(n) == words


# ---------------------------------------------------------------------------- corpus y slices
def test_corpus_wer_is_not_the_mean_of_utterance_wers():
    pairs = [("sí", "no"), (" ".join(["palabra"] * 99), " ".join(["palabra"] * 99))]
    per_utt = [utterance_errors(r, h).wer for r, h in pairs]
    assert sum(per_utt) / len(per_utt) == 0.5  # 50 %: lo que da promediar
    total = corpus_wer(pairs)
    assert (total.errors, total.ref_words, total.utterances) == (1, 100, 2)
    assert total.wer == 0.01  # 1 %: el WER del corpus


def test_by_slice_reports_each_value_with_its_support():
    records = [
        {"ref": "uno dos tres cuatro", "hyp": "uno dos tres cuatro", "language": "es-419", "noise": "clean"},
        {"ref": "uno dos tres cuatro", "hyp": "uno dos tres", "language": "es-419", "noise": "cafe"},
        {"ref": "one two", "hyp": "one too", "language": "en-US", "noise": "cafe"},
        {"ref": "dos", "hyp": "2", "language": "es-419"},  # sin "noise": no entra a esa dimensión
    ]
    out = by_slice(records, keys=("language", "noise"), min_ref_words=5)
    assert out["language"]["es-419"].counts.ref_words == 9 and out["language"]["es-419"].wer == 1 / 9
    assert out["language"]["en-US"].wer == 0.5 and not out["language"]["en-US"].enough_data
    assert out["noise"]["clean"].wer == 0.0
    assert out["noise"]["cafe"].counts.errors == 2 and out["noise"]["cafe"].counts.ref_words == 6
    assert out["language"]["es-419"].enough_data


# ---------------------------------------------------------------------------- latencias
def test_percentile_nearest_rank():
    v = list(range(1, 101))  # 1..100
    assert percentile(v, 50) == 50 and percentile(v, 95) == 95 and percentile(v, 99) == 99
    assert percentile([7.0], 99) == 7.0
    with pytest.raises(ValueError):
        percentile([], 50)


def test_pooled_percentiles_vs_mean_of_session_p95():
    events = ([{"session_id": "a", "type": "partial", "latency_ms": 100}] * 1000
              + [{"session_id": "b", "type": "partial", "latency_ms": 900}] * 20
              + [{"session_id": "a", "type": "final", "latency_ms": 1100}] * 10)
    out = latency_percentiles(events)
    assert out[("partial",)] == {"n": 1020, "p50": 100.0, "p95": 100.0, "p99": 900.0}
    per_session = latency_percentiles([e for e in events if e["type"] == "partial"], group_by=("session_id",))
    mean_of_p95 = sum(v["p95"] for v in per_session.values()) / len(per_session)
    assert mean_of_p95 == 500.0  # el número que no describe a nadie
    assert out[("final",)]["p95"] == 1100.0


def test_read_latency_log_skips_noise(tmp_path):
    p = tmp_path / "worker.log"
    lines = [
        json.dumps({"event": "caption_latency", "session_id": "s", "language": "es-419", "type": "final",
                    "latency_ms": 820.5}),
        "Traceback (most recent call last):",
        json.dumps({"event": "session_end", "session_id": "s"}),
    ]
    p.write_text("\n".join(lines), encoding="utf-8")
    events = read_latency_log(str(p))
    assert len(events) == 1 and latency_percentiles(events, ("language", "type"))[("es-419", "final")]["p50"] == 820.5
