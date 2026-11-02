"""Tests del estabilizador: el ejemplo del docstring, "lo congelado no cambia", palabras que el modelo
parte, junta o inserta (sin duplicados), y la métrica.
"""

import random

from stabilizer import Stabilizer, Word, revision_stats


def W(text, start, end):
    return Word(text, start, end)


# El ejemplo del docstring de stabilizer.py, paso a paso
STEPS = [
    (480, [W("el", 0, 200), W("gato", 200, 480)]),
    (1120, [W("el", 0, 200), W("pato", 200, 480), W("se", 600, 900)]),
    (1600, [W("el", 0, 200), W("plato", 200, 480), W("se", 600, 900), W("sentó", 900, 1400)]),
]
FINAL = [W("el", 0, 200), W("gato", 200, 480), W("se", 600, 900), W("sentó", 900, 1400)]


def test_docstring_example():
    st = Stabilizer(freeze_after_ms=800)
    d1, d2, d3 = (st.partial(words, audio) for audio, words in STEPS)
    assert (d1.frozen, d1.tentative) == ((), ("el", "gato"))
    assert (d2.frozen, d2.tentative) == (("el",), ("pato", "se"))
    # "plato" ya terminó hace > 800 ms: se congela lo que estaba en pantalla ("pato"), no lo nuevo
    assert (d3.frozen, d3.tentative) == (("el", "pato"), ("se", "sentó"))
    final, corrections = st.final(FINAL)
    assert final.text == "el gato se sentó" and final.is_final
    assert corrections == 1  # el final corrige la palabra congelada "pato"


def test_stabilized_display_flickers_less_than_raw_hypotheses():
    raw = [tuple(w.text for w in words) for _, words in STEPS] + [tuple(w.text for w in FINAL)]
    st = Stabilizer(800)
    shown = [st.partial(words, audio).words for audio, words in STEPS] + [st.final(FINAL)[0].words]
    r, s = revision_stats(raw), revision_stats(shown)
    assert (r.revisions, r.final_words, r.revision_rate) == (3, 4, 0.75)  # gato→pato→plato→gato
    assert (s.revisions, s.revision_rate) == (2, 0.5)  # gato→pato y la corrección del final


def test_frozen_prefix_only_grows_under_random_flicker():
    rng = random.Random(7)
    vocab = ["hola", "ola", "a", "todos", "todas", "buenos", "días", "dias"]
    st = Stabilizer(freeze_after_ms=600)
    prev_frozen = ()
    for step in range(1, 60):
        audio = step * 160
        # Una palabra cada 300 ms de audio; cada palabra puede cambiar en cada paso (peor caso de flicker)
        words = [W(rng.choice(vocab), k * 300, k * 300 + 250) for k in range(audio // 300 + 1)]
        d = st.partial(words, audio)
        assert d.frozen[: len(prev_frozen)] == prev_frozen  # nada congelado se reescribe
        # y todo lo congelado terminó hace al menos freeze_after_ms
        assert all(k * 300 + 250 <= audio - 600 for k in range(len(d.frozen)))
        prev_frozen = d.frozen


def test_freeze_zero_freezes_every_finished_word():
    st = Stabilizer(freeze_after_ms=0)
    d = st.partial([W("uno", 0, 300), W("dos", 300, 700)], audio_ms=640)
    assert d.frozen == ("uno",) and d.tentative == ("dos",)  # "dos" termina después del audio procesado


def test_revision_stats_rules():
    # Agregar al final no es revisión; quitar una palabra mostrada sí
    assert revision_stats([("a",), ("a", "b"), ("a", "b", "c")]).revisions == 0
    assert revision_stats([("a", "b", "c"), ("a", "b")]).revisions == 1
    assert revision_stats([]).revision_rate == 0.0


def test_model_splits_a_shown_word_freezes_what_was_shown_once():
    # En pantalla: "el | pato se". El modelo parte "pato" en "pa" + "to" y agrega "sentó". Por índice se
    # congelaría "pato" en el lugar de "pa" y "se" (lo que había en la posición 1) en el de "to": "el pato se
    # se sentó", con un "se" congelado y duplicado hasta el final. Por tiempo: "pato" una vez, y "to" (que
    # cae adentro de "pato") se descarta.
    st = Stabilizer(800)
    d1 = st.partial([W("el", 0, 200), W("pato", 200, 480), W("se", 600, 900)], 1000)
    assert (d1.frozen, d1.tentative) == (("el",), ("pato", "se"))
    d2 = st.partial([W("el", 0, 200), W("pa", 200, 300), W("to", 300, 480), W("se", 600, 900),
                     W("sentó", 900, 1400)], 1300)
    assert (d2.frozen, d2.tentative) == (("el", "pato"), ("se", "sentó"))
    assert len(d2.words) == len(set(d2.words))


def test_model_merges_or_inserts_words_without_duplicates():
    # Junta: en pantalla "pa to", el modelo dice "pato" → se congela lo que se vio, "pa to"
    st = Stabilizer(800)
    st.partial([W("el", 0, 200), W("pa", 200, 300), W("to", 300, 480)], 900)
    d = st.partial([W("el", 0, 200), W("pato", 200, 480), W("se", 600, 900)], 1300)
    assert (d.frozen, d.tentative) == (("el", "pa", "to"), ("se",))
    # Inserta: en pantalla "el pato se"; el modelo mete "y" entre "pato" y "se" → "y" se congela tal cual
    # (nadie la había visto), y "se" sigue una sola vez
    st = Stabilizer(800)
    st.partial([W("el", 0, 200), W("pato", 200, 480), W("se", 600, 900)], 1000)
    d = st.partial([W("el", 0, 200), W("pato", 200, 480), W("y", 480, 600), W("se", 600, 900),
                    W("sentó", 900, 1400)], 1450)
    assert (d.frozen, d.tentative) == (("el", "pato", "y"), ("se", "sentó"))
    d = st.partial([W("el", 0, 200), W("pato", 200, 480), W("y", 480, 600), W("se", 600, 900),
                    W("sentó", 900, 1400)], 1800)
    assert d.frozen == ("el", "pato", "y", "se") and d.words.count("se") == 1
