"""Estabilizador de partials (caso c13): qué texto se muestra mientras el modelo todavía cambia de opinión.

Un modelo streaming emite una hipótesis NUEVA de toda la utterance en cada chunk (cada 160 ms). Las palabras
del final cambian seguido ("el gato" → "el pato se" → "el plato se sentó"): para quien lee, eso es
parpadeo (flicker) y cansa más que esperar un poco. La regla de esta referencia:

  * Una palabra se CONGELA cuando terminó hace más de `freeze_after_ms` de audio (800 ms por defecto,
    ilustrativo) y todas las anteriores ya están congeladas (el prefijo estable solo crece).
  * Lo congelado no se reescribe aunque la hipótesis nueva diga otra cosa. Solo el FINAL puede corregirlo
    (y eso se cuenta aparte: `final_corrections`).
  * Lo que todavía no se congeló es "tentativo": el cliente lo muestra (p. ej. en gris) y puede cambiar.
  * Qué se mostró en cada lugar se busca por TIEMPO, no por posición: la palabra del modelo que se congela
    toma el texto de la(s) palabra(s) en pantalla que se superponen con ella (mismo inicio, o más de la mitad
    de la más corta). Si el modelo parte "pato" en "pa" + "to", o junta "pa" + "to" en "pato", o mete una
    palabra en el medio, las posiciones se corren y los tiempos no. Cada palabra en pantalla se congela una
    sola vez, y lo que el modelo puso adentro de una palabra ya congelada se descarta: nunca hay duplicados.

Ejemplo (freeze_after_ms = 800), con la hipótesis en cada paso y el audio procesado hasta `audio_ms`:

  audio_ms   hipótesis del modelo          se muestra (congelado | tentativo)
  480        el(0–200) gato(200–480)       | el gato
  1,120      el pato(200–480) se(600–900)  el | pato se        ← "el" terminó a 200 ≤ 1,120 − 800
  1,600      el plato(200–480) se(600–900)  el pato | se sentó   ← "plato" termina a 480 ≤ 1,600 − 800: se
             sentó(900–1,400)                                     congela lo que YA estaba en pantalla en esa
                                                                  posición ("pato"), así que no parpadea
  final      el gato se sentó              el gato se sentó     ← el final corrige "pato" → 1 corrección

  Revisiones (tests/test_stabilizer.py): mostrando las hipótesis crudas, 3 (gato→pato, pato→plato,
  plato→gato) sobre 4 palabras = 0.75; con el estabilizador, 2 (gato→pato y la corrección del final) = 0.5.

El costo de congelar: si el modelo "se arrepiente" de una palabra congelada, el partial muestra la versión
vieja hasta el final. Por eso `freeze_after_ms` se elige con datos: tasa de revisiones (flicker) contra
correcciones del final, por idioma. La otra regla común es el prefijo común de las últimas K hipótesis
(se congela lo que no cambió en K pasos); con timestamps por palabra, la regla por tiempo es más simple de
explicar y de acotar ("nada que tenga más de 800 ms cambia").

`revision_stats` mide las dos cosas sobre una secuencia de pantallas: es la métrica de estabilidad del caso
(tasa de revisiones = palabras que se mostraron y después cambiaron o desaparecieron ÷ palabras del final).
Lógica pura, sin I/O: se prueba en tests/test_stabilizer.py.
"""

from __future__ import annotations  # anotaciones como texto

from dataclasses import dataclass  # contratos simples e inmutables


@dataclass(frozen=True)
class Word:
    text: str
    start_ms: int  # tiempo de stream (mismo reloj que Chunk.start_ms del chunker)
    end_ms: int


@dataclass(frozen=True)
class Display:
    frozen: tuple[str, ...]  # no cambia más (salvo el final)
    tentative: tuple[str, ...]  # puede cambiar en el próximo partial
    is_final: bool = False

    @property
    def words(self) -> tuple[str, ...]:
        return self.frozen + self.tentative

    @property
    def text(self) -> str:
        return " ".join(self.words)


class Stabilizer:
    """Estado de UNA utterance. El server crea uno por utterance y lo descarta con el final."""

    def __init__(self, freeze_after_ms: int = 800) -> None:
        self.freeze_after_ms = freeze_after_ms
        self._frozen: list[Word] = []  # palabras congeladas, con el texto que se MOSTRÓ (no el último del modelo)
        # Lo tentativo del último partial, CON sus tiempos: para congelar lo que se vio en ese lugar del audio
        self._shown_tail: tuple[Word, ...] = ()

    @property
    def frozen_end_ms(self) -> int:
        return self._frozen[-1].end_ms if self._frozen else -1

    def partial(self, words: list[Word], audio_ms: int) -> Display:
        """Nueva hipótesis parcial del modelo, con el audio procesado hasta `audio_ms`."""
        cutoff = audio_ms - self.freeze_after_ms
        used: set[int] = set()  # índices de _shown_tail ya congelados (cada uno, una vez)
        rest: list[Word] = []
        freezing = True
        for w in words:
            # Solo palabras posteriores a lo ya congelado. Por tiempo, no por índice: si el modelo junta o
            # parte palabras viejas, el índice se corre y el tiempo no. Esto también descarta el "to" de un
            # "pa" + "to" cuando "pato" (lo que estaba en pantalla) ya se congeló hasta 480 ms.
            if w.start_ms < self.frozen_end_ms:
                continue
            if freezing and w.end_ms <= cutoff:
                # Congelar con el texto que estaba EN PANTALLA en ese tramo de audio, si existía: congelar
                # significa "lo que viste no cambia", no "lo último que dijo el modelo".
                shown = [k for k, sw in enumerate(self._shown_tail) if k not in used and _same_place(sw, w)]
                if shown:
                    used.update(shown)
                    for k in shown[:-1]:
                        self._frozen.append(self._shown_tail[k])
                    last = self._shown_tail[shown[-1]]
                    self._frozen.append(Word(last.text, last.start_ms, max(last.end_ms, w.end_ms)))
                else:
                    self._frozen.append(w)  # nadie lo vio todavía (palabra nueva o insertada): la del modelo
            else:
                freezing = False  # el prefijo congelado es contiguo: después de la primera tentativa, nada más
                rest.append(w)
        self._shown_tail = tuple(rest)
        return Display(frozen=tuple(w.text for w in self._frozen), tentative=tuple(w.text for w in rest))

    def final(self, words: list[Word]) -> tuple[Display, int]:
        """El final reemplaza todo. Devuelve la pantalla y cuántas palabras CONGELADAS corrigió."""
        final_words = tuple(w.text for w in words)
        frozen = tuple(w.text for w in self._frozen)
        corrections = sum(1 for k, t in enumerate(frozen) if k >= len(final_words) or final_words[k] != t)
        self._frozen = []
        self._shown_tail = ()
        return Display(frozen=final_words, tentative=(), is_final=True), corrections


def _same_place(a: Word, b: Word) -> bool:
    """¿Las dos palabras ocupan el mismo lugar del audio? Mismo inicio, o se superponen más de la mitad de
    la más corta ("pa" 200–300 y "pato" 200–480 sí; "pato" 200–480 y "se" 600–900 no)."""
    overlap = min(a.end_ms, b.end_ms) - max(a.start_ms, b.start_ms)
    shorter = min(a.end_ms - a.start_ms, b.end_ms - b.start_ms)
    return a.start_ms == b.start_ms or (overlap > 0 and 2 * overlap > shorter)


@dataclass(frozen=True)
class RevisionStats:
    revisions: int  # palabras que se mostraron y en la pantalla siguiente cambiaron o desaparecieron
    final_words: int
    revision_rate: float  # revisions ÷ final_words (0 = nada parpadeó)
    displays: int  # cuántas pantallas (partials + final)


def revision_stats(displays: list[tuple[str, ...]]) -> RevisionStats:
    """Cuenta revisiones entre pantallas consecutivas de UNA utterance (la última debe ser el final).

    Una revisión es una posición que estaba en pantalla y en la siguiente muestra otra palabra o ya no
    está. Agregar palabras al final NO es revisión (es el texto avanzando). Ejemplo: ("el","gato") →
    ("el","pato","se") = 1 revisión (gato → pato).
    """
    if not displays:
        return RevisionStats(0, 0, 0.0, 0)
    revisions = 0
    for prev, cur in zip(displays, displays[1:]):
        for k, word in enumerate(prev):
            if k >= len(cur) or cur[k] != word:
                revisions += 1
    n_final = len(displays[-1])
    rate = revisions / n_final if n_final else 0.0
    return RevisionStats(revisions, n_final, rate, len(displays))
