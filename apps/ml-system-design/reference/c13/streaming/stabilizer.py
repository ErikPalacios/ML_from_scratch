"""Estabilizador de partials (caso c13): qué texto se muestra mientras el modelo todavía cambia de opinión.

Un modelo streaming emite una hipótesis NUEVA de toda la utterance en cada chunk (cada 160 ms). Las palabras
del final cambian seguido ("el gato" → "el pato se" → "el plato se sentó"): para quien lee, eso es
parpadeo (flicker) y cansa más que esperar un poco. La regla de esta referencia:

  * Una palabra se CONGELA cuando terminó hace más de `freeze_after_ms` de audio (800 ms por defecto,
    ilustrativo) y todas las anteriores ya están congeladas (el prefijo estable solo crece).
  * Lo congelado no se reescribe aunque la hipótesis nueva diga otra cosa. Solo el FINAL puede corregirlo
    (y eso se cuenta aparte: `final_corrections`).
  * Lo que todavía no se congeló es "tentativo": el cliente lo muestra (p. ej. en gris) y puede cambiar.

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
        self._shown_tail: tuple[str, ...] = ()  # lo tentativo del último partial (para congelar lo que se vio)

    @property
    def frozen_end_ms(self) -> int:
        return self._frozen[-1].end_ms if self._frozen else -1

    def partial(self, words: list[Word], audio_ms: int) -> Display:
        """Nueva hipótesis parcial del modelo, con el audio procesado hasta `audio_ms`."""
        cutoff = audio_ms - self.freeze_after_ms
        # Solo palabras posteriores a lo ya congelado (por tiempo, no por índice: si el modelo junta o parte
        # palabras viejas, el índice se corre y el tiempo no)
        tail = [w for w in words if w.start_ms >= self.frozen_end_ms]
        # Congelar el prefijo de la cola que ya es viejo. Se congela con el texto que estaba EN PANTALLA en
        # esa posición si existía: congelar significa "lo que viste no cambia", no "lo último que dijo el modelo".
        n_new = 0
        for w in tail:
            if w.end_ms <= cutoff:
                n_new += 1
            else:
                break
        for k, w in enumerate(tail[:n_new]):
            shown = self._shown_tail[k] if k < len(self._shown_tail) else w.text
            self._frozen.append(Word(shown, w.start_ms, w.end_ms))
        rest = tail[n_new:]
        self._shown_tail = tuple(w.text for w in rest)
        return Display(frozen=tuple(w.text for w in self._frozen), tentative=self._shown_tail)

    def final(self, words: list[Word]) -> tuple[Display, int]:
        """El final reemplaza todo. Devuelve la pantalla y cuántas palabras CONGELADAS corrigió."""
        final_words = tuple(w.text for w in words)
        frozen = tuple(w.text for w in self._frozen)
        corrections = sum(1 for k, t in enumerate(frozen) if k >= len(final_words) or final_words[k] != t)
        self._frozen = []
        self._shown_tail = ()
        return Display(frozen=final_words, tentative=(), is_final=True), corrections


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
