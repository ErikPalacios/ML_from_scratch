"""Groundedness y citation precision con un juez LLM, y cuánto se parece ese juez a las personas (caso c11).

Dos preguntas distintas sobre una respuesta ya generada:
  - Faithfulness / groundedness: de las afirmaciones de la respuesta, ¿qué fracción está respaldada por las fuentes
    del prompt? = afirmaciones respaldadas / afirmaciones. (Es la misma idea que la métrica "faithfulness" de RAGAS;
    revisa su definición vigente si vas a comparar números con esa biblioteca.)
  - Citation precision: de las citas [n], ¿qué fracción apunta a una fuente que de verdad respalda la oración donde
    está? Una cita válida en answer/citations.py solo dice "esa fuente existe y la puedes ver"; aquí se pregunta si
    DICE lo que la oración afirma.

Quién lo juzga: un LLM con una rúbrica (JUDGE_RUBRIC), llamado por el llm-gateway como un tenant de evaluación. No
se le cree por defecto: antes de usarlo como gate se mide su acuerdo con ≈ 200 respuestas calificadas por personas
(el caso, #c11.evaluacion), con Cohen's kappa y, sobre todo, con la tasa de FALSO PASE (el juez dice "respaldada" y
la persona dice que no): ese es el error caro, una alucinación que la evaluación deja pasar.

Por qué kappa y no "% de acuerdo": si el 90 % de las respuestas están bien, un juez que SIEMPRE dice "bien" acuerda
el 90 % de las veces sin mirar nada. Kappa descuenta el acuerdo esperado por azar:
    κ = (p_o − p_e) / (1 − p_e)
  Ejemplo a mano (100 respuestas): juez y persona dicen "bien" en 80, "mal" en 10, y discrepan en 10 (5 y 5).
    p_o = 0.90; juez "bien" = 85 %, persona "bien" = 85 % → p_e = 0.85² + 0.15² = 0.745
    κ = (0.90 − 0.745) / (1 − 0.745) = 0.155 / 0.255 ≈ 0.61
  El juez que siempre dice "bien" con 90 % de respuestas buenas: p_o = 0.90, p_e = 0.90 → κ = 0.
El umbral (κ ≥ 0.6 y falso pase ≤ 10 %) es ILUSTRATIVO: fíjalo con tu primera calibración y no lo bajes para pasar.

El job de evaluación publica sus resultados como métricas (prometheus_text) para GroundednessCanaryRegression:
la suite "canary" (≈ 100 preguntas del golden set, permisos incluidos) corre cada 4 h contra producción (el índice,
el prompt y el modelo de verdad) y la suite "full" (las ≈ 600) en cada cambio de modelo, prompt, chunking o índice.

Biblioteca estándar. Judge es una interfaz; KeywordJudge es un juez FALSO de solapamiento de palabras para tests.
"""

from __future__ import annotations  # anotaciones como texto

import math  # nan
import re  # oraciones y citas
from collections.abc import Mapping, Sequence  # tipos
from dataclasses import dataclass  # veredictos y reportes
from typing import Protocol  # interfaz del juez

JUDGE_RUBRIC = """Recibes una pregunta, fuentes numeradas y una respuesta con citas [n].
1. Parte la respuesta en afirmaciones atómicas (un hecho cada una).
2. Para cada afirmación, decide si las fuentes la respaldan (sí / no). Respaldada = se deduce del texto de alguna
   fuente sin conocimiento externo. Una afirmación de "no encontré información" está respaldada si ninguna fuente
   contesta la pregunta.
3. Para cada cita [n], decide si la fuente n respalda la oración donde aparece.
Devuelve JSON: {"claims": [{"text": ..., "supported": true|false}],
               "citations": [{"n": ..., "supports": true|false}]}"""

_SENTENCE_RE = re.compile(r"(?<=[.!?…])\s+|\n+")
_CITE_RE = re.compile(r"\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]")
_WORD_RE = re.compile(r"\w+", re.UNICODE)


@dataclass(frozen=True)
class Verdict:
    supported_claims: int
    total_claims: int
    supporting_citations: int
    total_citations: int

    @property
    def grounded(self) -> bool:
        """Etiqueta binaria para comparar con personas: TODAS las afirmaciones respaldadas."""
        return self.total_claims > 0 and self.supported_claims == self.total_claims


class Judge(Protocol):
    async def judge(self, question: str, answer: str, sources: Mapping[int, str]) -> Verdict: ...


class KeywordJudge:
    """Juez FALSO: una oración está respaldada si ≥ `threshold` de sus palabras de ≥ 4 letras están en alguna fuente
    citada. No entiende negaciones ni números cambiados ("30 días" vs "15 días" comparten "días"): justo por eso un
    juez de verdad se calibra contra personas. `always` fuerza un veredicto (para mostrar la trampa del kappa)."""

    def __init__(self, threshold: float = 0.6, always: bool | None = None):
        self.threshold, self.always = threshold, always

    async def judge(self, question: str, answer: str, sources: Mapping[int, str]) -> Verdict:
        claims = [s for s in _SENTENCE_RE.split(answer) if s.strip()]
        if self.always is not None:
            n = len(claims)
            cites = len(_CITE_RE.findall(answer))
            return Verdict(n if self.always else 0, n, cites if self.always else 0, cites)
        supported = cites_ok = cites_total = 0
        for c in claims:
            ns = [int(x) for m in _CITE_RE.findall(c) for x in m.split(",")]
            words = {w for w in _WORD_RE.findall(_CITE_RE.sub("", c).lower()) if len(w) >= 4}
            ok_any = False
            for n in ns:
                cites_total += 1
                src = set(_WORD_RE.findall(sources.get(n, "").lower()))
                ok = bool(words) and len(words & src) / len(words) >= self.threshold
                cites_ok += ok
                ok_any = ok_any or ok
            supported += ok_any
        return Verdict(supported, len(claims), cites_ok, cites_total)


# ---------------------------------------------------------------------------- agregados
@dataclass(frozen=True)
class GroundednessReport:
    n: int
    faithfulness: float  # promedio de supported/total por respuesta
    grounded_rate: float  # fracción de respuestas con TODO respaldado
    citation_precision: float  # Σ citas que respaldan / Σ citas


def aggregate(verdicts: Sequence[Verdict]) -> GroundednessReport:
    scored = [v for v in verdicts if v.total_claims > 0]
    cites = sum(v.total_citations for v in verdicts)
    return GroundednessReport(
        n=len(verdicts),
        faithfulness=sum(v.supported_claims / v.total_claims for v in scored) / len(scored) if scored else math.nan,
        grounded_rate=sum(v.grounded for v in verdicts) / len(verdicts) if verdicts else math.nan,
        citation_precision=sum(v.supporting_citations for v in verdicts) / cites if cites else math.nan,
    )


# ---------------------------------------------------------------------------- juez vs personas
def cohen_kappa(a: Sequence[bool], b: Sequence[bool]) -> float:
    """Kappa de Cohen para dos calificadores binarios. NaN si no está definido (los dos dicen siempre lo mismo)."""
    if len(a) != len(b) or not a:
        raise ValueError("se necesitan dos listas del mismo largo, no vacías")
    n = len(a)
    p_o = sum(x == y for x, y in zip(a, b, strict=True)) / n
    pa, pb = sum(a) / n, sum(b) / n
    p_e = pa * pb + (1 - pa) * (1 - pb)
    if p_e == 1:
        return math.nan
    return (p_o - p_e) / (1 - p_e)


@dataclass(frozen=True)
class Agreement:
    n: int
    raw_agreement: float
    kappa: float
    false_pass_rate: float  # de las que la PERSONA marcó como no respaldadas, qué fracción el juez dejó pasar
    false_fail_rate: float  # de las que la persona marcó como respaldadas, qué fracción el juez rechazó

    def gate(self, min_kappa: float = 0.6, max_false_pass: float = 0.10, min_n: int = 150) -> tuple[bool, list[str]]:
        reasons = []
        if self.n < min_n:
            reasons.append(f"solo {self.n} respuestas calificadas por personas (< {min_n})")
        if not self.kappa >= min_kappa:  # `not >=` atrapa NaN
            reasons.append(f"kappa {self.kappa:.2f} < {min_kappa}")
        if not self.false_pass_rate <= max_false_pass:
            reasons.append(f"falso pase {self.false_pass_rate:.2f} > {max_false_pass}")
        return (not reasons), reasons


def agreement(judge_labels: Sequence[bool], human_labels: Sequence[bool]) -> Agreement:
    pairs = list(zip(judge_labels, human_labels, strict=True))
    bad = [j for j, h in pairs if not h]
    good = [j for j, h in pairs if h]
    return Agreement(
        n=len(pairs),
        raw_agreement=sum(j == h for j, h in pairs) / len(pairs),
        kappa=cohen_kappa(judge_labels, human_labels),
        false_pass_rate=sum(bad) / len(bad) if bad else math.nan,
        false_fail_rate=sum(not j for j in good) / len(good) if good else math.nan,
    )


# ---------------------------------------------------------------------------- métricas para Prometheus
def prometheus_text(suite: str, report: GroundednessReport, recall_at_8: float, finished_at: float) -> str:
    """Formato de texto de Prometheus para el textfile collector o un Pushgateway (lo lee la alerta del canario)."""
    lines = []
    for name, value, help_ in (
        ("rag_eval_groundedness", report.grounded_rate, "Respuestas con todas las afirmaciones respaldadas"),
        ("rag_eval_citation_precision", report.citation_precision, "Citas que respaldan su oración / citas"),
        ("rag_eval_recall_at_8", recall_at_8, "Recall@8 a nivel documento de la suite"),
        ("rag_eval_items", float(report.n), "Preguntas evaluadas en la última corrida"),
        ("rag_eval_last_run_timestamp_seconds", finished_at, "Fin de la última corrida (epoch s)"),
    ):
        lines += [f"# HELP {name} {help_}", f"# TYPE {name} gauge", f'{name}{{suite="{suite}"}} {value:.6g}']
    return "\n".join(lines) + "\n"
