"""WER y latencias de captions (caso c13): cómo se mide la calidad sin engañarse.

WER (word error rate) = (S + D + I) / N
  S = sustituciones, D = borrados, I = inserciones, N = palabras de la REFERENCIA (la transcripción humana).
  Se cuentan con la alineación de mínimo costo (distancia de Levenshtein por palabras).

Ejemplo a mano:  referencia  "el gato se sentó"      (N = 4)
                 hipótesis   "el pato se sentó en"
                 gato→pato = 1 S, "en" sobra = 1 I  →  WER = (1 + 0 + 1) / 4 = 0.50
El WER puede pasar de 1.0 (con muchas inserciones): no es un "porcentaje de palabras mal".

Tres cosas cambian el número sin que el modelo cambie (por eso van en el reporte, no en la cabeza):
  1. Normalización. "¿Está listo?" contra "esta listo" son 2 errores sin normalizar (mayúscula + signos
     pegados, y la tilde), 1 normalizando mayúsculas y puntuación, 0 plegando tildes. Los números igual:
     "2026" contra "dos mil veintiséis" es 1 S + 2 I si no se normalizan. Regla: la MISMA normalización a
     referencia e hipótesis, versionada, y reportar con y sin plegado de tildes (en español la tilde cambia
     el significado: esta/está, solo/sólo, mas/más; para leer captions a veces importa, para buscar no).
  2. Agregación. WER del corpus = Σ errores / Σ palabras de referencia. NO el promedio del WER de cada
     utterance: ese promedio pesa igual un "sí" de 1 palabra que una explicación de 99 (ver corpus_wer).
  3. Slices. Un WER global de 11 % puede esconder 25 % en un acento o con ruido. Se reporta por idioma,
     acento/región, ruido, dispositivo y habla superpuesta, cada uno con cuántas palabras lo sostienen
     (`min_ref_words`): un slice con 300 palabras es una anécdota, no un número.

Latencias: los percentiles salen de TODOS los eventos juntos (los logs muestreados de asr_server.py),
nunca del promedio de los p95 de cada sesión (ver latency_percentiles).

Biblioteca estándar, sin I/O salvo read_latency_log. Tests con casos calculados a mano en tests/test_wer.py.
`python eval/wer.py` imprime los ejemplos de este docstring.
"""

from __future__ import annotations  # anotaciones como texto

import json  # los logs de latencia son JSON por línea
import math  # ceil para el percentil nearest-rank
import re  # separadores de miles
import unicodedata  # NFC/NFD, categorías de caracteres (puntuación, símbolos, marcas)
from collections import defaultdict  # agregación por slice
from dataclasses import dataclass  # contadores sumables
from typing import Iterable

# ---------------------------------------------------------------------------- números en español
_UNITS = ("cero uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince "
          "dieciséis diecisiete dieciocho diecinueve veinte veintiuno veintidós veintitrés veinticuatro "
          "veinticinco veintiséis veintisiete veintiocho veintinueve").split()
_TENS = {3: "treinta", 4: "cuarenta", 5: "cincuenta", 6: "sesenta", 7: "setenta", 8: "ochenta", 9: "noventa"}
_HUNDREDS = {1: "ciento", 2: "doscientos", 3: "trescientos", 4: "cuatrocientos", 5: "quinientos",
             6: "seiscientos", 7: "setecientos", 8: "ochocientos", 9: "novecientos"}


def _below_100(n: int) -> str:
    if n < 30:
        return _UNITS[n]
    tens, unit = divmod(n, 10)
    return _TENS[tens] + ("" if unit == 0 else " y " + _UNITS[unit])


def _below_1000(n: int) -> str:
    if n < 100:
        return _below_100(n)
    if n == 100:
        return "cien"  # 100 es "cien"; 101 ya es "ciento uno"
    hundreds, rest = divmod(n, 100)
    return _HUNDREDS[hundreds] + ("" if rest == 0 else " " + _below_100(rest))


def spanish_number(n: int) -> str:
    """0 ≤ n ≤ 999,999 escrito como se dice: 2026 → "dos mil veintiséis", 21000 → "veintiún mil".

    Cubre lo que más aparece en reuniones (años, cantidades, montos redondos). Decimales (3,5), horas (3:30),
    ordinales (1.º), montos con símbolo ($500) y millones no se expanden: normalize() los deja como UN token
    literal, igual en referencia e hipótesis (así "3:30" contra "tres y media" es un error visible, no un
    "tres treinta" inventado). Si importan, se normalizan con reglas propias y se versiona. Para inglés y
    portugués hace falta su propia función (normalize deja sus dígitos tal cual).
    """
    if not 0 <= n <= 999_999:
        raise ValueError("fuera de rango (0–999,999)")
    if n < 1000:
        return _below_1000(n)
    thousands, rest = divmod(n, 1000)
    if thousands == 1:
        head = "mil"  # "mil", no "un mil"
    else:
        head = _below_1000(thousands)
        # Apócope delante de "mil": veintiuno → veintiún, treinta y uno → treinta y un
        if head.endswith("veintiuno"):
            head = head[: -len("veintiuno")] + "veintiún"
        elif head.endswith("uno"):
            head = head[:-3] + "un"
        head += " mil"
    return head + ("" if rest == 0 else " " + _below_1000(rest))


# ---------------------------------------------------------------------------- normalización
# Separador de miles: en español y portugués se usan "." y "," (1,500 en México, 1.500 en Argentina o
# Brasil); en inglés solo "," ("3.141" es un decimal). Un grupo de 3 dígitos exactos; 3,5 y 1.25 no se tocan.
_THOUSANDS_SEP = {
    "es": re.compile(r"(?<=\d)[,.](?=\d{3}(?!\d))"),
    "pt": re.compile(r"(?<=\d)[,.](?=\d{3}(?!\d))"),
    "en": re.compile(r"(?<=\d),(?=\d{3}(?!\d))"),
}
_PERCENT = {"es": " por ciento ", "pt": " por cento ", "en": " percent "}
# Números que NO se expanden ni se parten en la puntuación: quedan como un token literal
_DIGITS_WITH_PUNCT = re.compile(r"^\d+(?:[.,:]\d+)+$")  # 3,5 · 3:30 · 3.141 (ya sin separador de miles)
_ORDINAL = re.compile(r"^\d+\.?[ºª°]$")  # 1.º · 2ª
_CURRENCY = re.compile(r"[$€£¥]\d|\d[$€£¥]")  # $500 · us$500 · 500€


def _literal_number(token: str, lang: str) -> str | None:
    """El token, sin la puntuación de los bordes, si es un número que se deja literal; si no, None."""
    core = token
    while core and unicodedata.category(core[0])[0] == "P":  # ¿ ¡ « ( …
        core = core[1:]
    while core and unicodedata.category(core[-1])[0] == "P":  # . , ? » ) % …
        core = core[:-1]
    sep = _THOUSANDS_SEP.get(lang)
    if sep is not None:
        core = sep.sub("", core)
    if _DIGITS_WITH_PUNCT.match(core) or _ORDINAL.match(core) or _CURRENCY.search(core):
        return core
    return None


def _fold_accents(text: str) -> str:
    """á→a, é→e, ü→u… pero ñ se queda: "año" y "ano" son palabras distintas, no la misma con o sin tilde."""
    out = []
    for ch in unicodedata.normalize("NFD", text):
        if unicodedata.category(ch) == "Mn":  # marca diacrítica combinante
            if ch == "̃" and out and out[-1] in "nN":  # la virgulilla de la ñ
                out.append(ch)
            continue
        out.append(ch)
    return unicodedata.normalize("NFC", "".join(out))


def normalize(text: str, language: str = "es-419", fold_accents: bool = False, numbers: bool = True) -> list[str]:
    """Texto → lista de palabras comparables. Se aplica IGUAL a referencia e hipótesis.

    Números: los enteros en dígitos se escriben en palabras (solo español, 0–999,999). Decimales, horas,
    ordinales y montos con símbolo quedan como un token literal ("3,5", "3:30", "1.º", "$500"): ver
    spanish_number.
    """
    lang = language.split("-")[0].lower()
    t = unicodedata.normalize("NFC", text)  # "é" compuesta y "e"+"´" combinante son lo mismo: sin esto, son S
    t = t.lower()
    sep = _THOUSANDS_SEP.get(lang)
    words: list[str] = []
    for tok in t.split():
        # Antes de quitar la puntuación: "3,5" o "3:30" partidos serían dos números ("tres cinco")
        lit = _literal_number(tok, lang)
        if lit is not None:
            words.append(lit)
            if "%" in tok:
                words.extend(_PERCENT.get(lang, "").split())
            continue
        if sep is not None:
            tok = sep.sub("", tok)
        tok = tok.replace("%", _PERCENT.get(lang, " "))
        tok = tok.replace("'", "").replace("’", "")  # don't → dont, en las dos: no parte la palabra
        # Puntuación (P*) y símbolos (S*) → espacio. Incluye ¿ ¡ « » — … y el "-" de "e-mail"
        words.extend("".join(" " if unicodedata.category(ch)[0] in "PS" else ch for ch in tok).split())
    if numbers and lang == "es":
        expanded: list[str] = []
        for w in words:
            if w.isdigit() and int(w) <= 999_999:
                expanded.extend(spanish_number(int(w)).split())
            else:
                expanded.append(w)
        words = expanded
    if fold_accents:
        words = [_fold_accents(w) for w in words]
    return words


# ---------------------------------------------------------------------------- alineación y WER
@dataclass(frozen=True)
class ErrorCounts:
    substitutions: int = 0
    deletions: int = 0
    insertions: int = 0
    ref_words: int = 0
    utterances: int = 0

    @property
    def errors(self) -> int:
        return self.substitutions + self.deletions + self.insertions

    @property
    def wer(self) -> float:
        # Referencia vacía: WER indefinido. Con inserciones es infinito; sin errores, 0. En un corpus no pasa.
        if self.ref_words == 0:
            return math.inf if self.errors else 0.0
        return self.errors / self.ref_words

    def __add__(self, other: "ErrorCounts") -> "ErrorCounts":
        return ErrorCounts(self.substitutions + other.substitutions, self.deletions + other.deletions,
                           self.insertions + other.insertions, self.ref_words + other.ref_words,
                           self.utterances + other.utterances)


def align(ref: list[str], hyp: list[str]) -> ErrorCounts:
    """Levenshtein por palabras con backtrace para separar S, D e I.

    Con empates de costo, prefiere coincidencia/sustitución, luego borrado, luego inserción: el TOTAL es
    el mismo con cualquier desempate; el reparto S/D/I puede variar entre herramientas (compáralas por total).
    O(N × M) en tiempo y memoria: bien para utterances de captions (decenas de palabras).
    """
    n, m = len(ref), len(hyp)
    d = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        d[i][0] = i  # todo borrado
    for j in range(m + 1):
        d[0][j] = j  # todo insertado
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            sub = d[i - 1][j - 1] + (ref[i - 1] != hyp[j - 1])
            d[i][j] = min(sub, d[i - 1][j] + 1, d[i][j - 1] + 1)
    s = de = ins = 0
    i, j = n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0 and d[i][j] == d[i - 1][j - 1] + (ref[i - 1] != hyp[j - 1]):
            s += ref[i - 1] != hyp[j - 1]
            i, j = i - 1, j - 1
        elif i > 0 and d[i][j] == d[i - 1][j] + 1:
            de += 1
            i -= 1
        else:
            ins += 1
            j -= 1
    return ErrorCounts(s, de, ins, n, 1)


def utterance_errors(ref: str, hyp: str, **norm) -> ErrorCounts:
    return align(normalize(ref, **norm), normalize(hyp, **norm))


def corpus_wer(pairs: Iterable[tuple[str, str]], **norm) -> ErrorCounts:
    """Σ errores / Σ palabras de referencia (el WER que se reporta).

    La trampa: el promedio de los WER por utterance. Con A = 1 palabra y 1 error (100 %) y B = 99 palabras
    y 0 errores (0 %), el promedio da 50 %; el corpus da 1 / 100 = 1 %. En captions abundan las utterances
    cortas ("sí", "ajá", "ok"), así que el promedio exagera el peso de las que menos texto tienen.
    """
    total = ErrorCounts()
    for ref, hyp in pairs:
        total = total + utterance_errors(ref, hyp, **norm)
    return total


@dataclass(frozen=True)
class SliceResult:
    counts: ErrorCounts
    enough_data: bool  # ¿tiene al menos min_ref_words? Si no, el número se reporta marcado

    @property
    def wer(self) -> float:
        return self.counts.wer


def by_slice(records: Iterable[dict], keys: tuple[str, ...] = ("language", "accent", "noise", "device", "overlap"),
             min_ref_words: int = 1000, **norm) -> dict[str, dict[str, SliceResult]]:
    """WER del corpus por cada valor de cada dimensión.

    records: dicts con "ref", "hyp" y las dimensiones (p. ej. {"language": "es-419", "accent": "mx-norte",
    "noise": "cafe", "device": "laptop", "overlap": "no", …}). La normalización usa el idioma de cada
    registro. Un registro sin una dimensión no entra a esa dimensión (no se inventa "desconocido").
    """
    acc: dict[str, dict[str, ErrorCounts]] = defaultdict(lambda: defaultdict(ErrorCounts))
    for r in records:
        opts = dict(norm)
        opts.setdefault("language", r.get("language", "es-419"))
        counts = utterance_errors(r["ref"], r["hyp"], **opts)
        for k in keys:
            if k in r:
                acc[k][str(r[k])] = acc[k][str(r[k])] + counts
    return {k: {v: SliceResult(c, c.ref_words >= min_ref_words) for v, c in sorted(vals.items())}
            for k, vals in acc.items()}


# ---------------------------------------------------------------------------- latencias
def percentile(values: list[float], p: float) -> float:
    """Nearest-rank: el valor en la posición ceil(p/100 × n) de la lista ordenada (sin interpolar)."""
    if not values:
        raise ValueError("sin datos")
    s = sorted(values)
    k = max(1, math.ceil(p / 100 * len(s)))
    return s[k - 1]


def latency_percentiles(events: Iterable[dict], group_by: tuple[str, ...] = ("type",),
                        ps: tuple[float, ...] = (50, 95, 99)) -> dict[tuple, dict[str, float]]:
    """Percentiles de latencia (ms) por grupo, sobre TODOS los eventos del grupo juntos.

    events: los registros "caption_latency" de asr_server.py ({"session_id", "language", "type": "partial" |
    "final", "latency_ms"}). La trampa: promediar el p95 de cada sesión. Con una sesión de 1,000 partials a
    100 ms y otra de 20 a 900 ms, el p95 de los eventos es 100 ms y el "promedio de p95" da 500 ms, un número
    que no describe la experiencia de nadie. El SLO ("p95 de los partials ≤ 500 ms") habla de eventos.
    """
    groups: dict[tuple, list[float]] = defaultdict(list)
    for e in events:
        groups[tuple(e[g] for g in group_by)].append(float(e["latency_ms"]))
    return {g: {"n": len(v), **{f"p{p:g}": percentile(v, p) for p in ps}} for g, v in sorted(groups.items())}


def read_latency_log(path: str) -> list[dict]:
    """Lee un log JSON por línea y se queda con los eventos caption_latency (ignora el resto del log)."""
    out = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            try:
                rec = json.loads(line)
            except ValueError:
                continue  # una línea que no es JSON (un traceback, un print) no rompe el reporte
            if isinstance(rec, dict) and rec.get("event") == "caption_latency":
                out.append(rec)
    return out


if __name__ == "__main__":
    ref, hyp = "¿Está listo el reporte de 2026?", "esta listo el reporte de dos mil veintiséis"
    for opts in ({"numbers": False}, {}, {"fold_accents": True}):
        c = utterance_errors(ref, hyp, **opts)
        print(f"{str(opts):24} WER = {c.wer:.3f}  (S={c.substitutions} D={c.deletions} I={c.insertions} N={c.ref_words})")
    pairs = [("sí", "no")] + [(" ".join(["palabra"] * 99), " ".join(["palabra"] * 99))]
    per_utt = [utterance_errors(r, h).wer for r, h in pairs]
    print(f"promedio por utterance = {sum(per_utt) / len(per_utt):.2%}   corpus = {corpus_wer(pairs).wer:.2%}")
