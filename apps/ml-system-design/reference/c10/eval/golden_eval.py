"""Golden sets del caso c10: extracción (JSON válido, F1 por campo) y chat (juez pareado con cambio de posición) + gate.

Qué se decide con esto: si una revisión del modelo (`chat-70b-fp8-2026-09-28`) puede reemplazar a la actual
(el vendor, al principio; después, la revisión anterior) para UN tenant. Se corre por tenant y por revisión, y
el resultado va al model registry como eval report. Sin un gate que pase, el alias no se mueve.

1) Extracción (catalog-enrichment): el modelo devuelve un JSON de atributos por publicación.
   Ejemplo, una publicación con 3 campos en el oro:
     oro        {"marca": "Nike", "talla": "27", "color": "negro"}
     predicho   {"marca": "nike ", "talla": "27.5", "material": "piel"}
     → marca correcta (normalizada) = TP; talla mal = FP + FN; color faltante = FN; material sobra = FP
     → precision 1/3, recall 1/3, F1 0.33; y el JSON era válido
   Se reporta la tasa de JSON válido APARTE: un modelo que no devuelve JSON parseable rompe el pipeline
   aunque los campos que sí devuelve sean perfectos. (Las structured outputs del servidor bajan esto casi a
   cero; medirlo igual detecta cuando alguien las apaga.)

2) Chat (soporte, vendedores): no hay "respuesta correcta". Un juez (un LLM con una rúbrica, calibrado contra
   humanos) compara la respuesta CANDIDATA con la de REFERENCIA (la del sistema actual) para el mismo prompt.
   Sesgos conocidos de un LLM-as-judge (Zheng et al., "Judging LLM-as-a-Judge with MT-Bench and Chatbot
   Arena", NeurIPS 2023): de POSICIÓN (prefiere la primera o la segunda), de VERBOSIDAD (prefiere la más larga)
   y de AUTO-PREFERENCIA (prefiere respuestas de su propio modelo). Aquí se controla la de posición: cada par se
   juzga DOS veces con el orden cambiado; si el juez cambia de opinión al cambiar el orden, cuenta como empate
   (y se reporta la tasa de consistencia: un juez inconsistente no sirve para decidir). La de verbosidad se
   vigila con la rúbrica y comparando largos; la de auto-preferencia, no usando como juez el mismo modelo que
   se evalúa.

3) Gate de NO-INFERIORIDAD: queremos saber si el modelo propio "no es peor" que el actual, no si es mejor.
   Win rate = (victorias + ½ empates) ÷ pares. Con 1,000 conversaciones y un win rate de 0.50, el intervalo
   de Wilson al 95 % es ≈ [0.469, 0.531]: su borde inferior pasa un margen de 0.45 (no es peor por más de
   5 puntos). Con 100 conversaciones el mismo 0.50 da ≈ [0.404, 0.596] y NO pasa: no hay evidencia suficiente.
   Y 0.48 con 1,000 da ≈ [0.449, 0.511]: no pasa por una milésima. Un gate es un gate: no se redondea a favor.
   Por eso el golden set de soporte tiene ≈ 1,000 conversaciones y no 50.

El juez real (una llamada al gateway con un prompt de rúbrica) no está aquí: se inyecta como interfaz. Los
tests usan un juez falso con sesgos programados para probar que el cambio de posición los neutraliza.

Solo biblioteca estándar.
"""

from __future__ import annotations  # anotaciones como texto

import json  # parsear la salida del modelo
import math  # Wilson
import unicodedata  # normalización NFC
from collections.abc import Iterable  # tipos
from dataclasses import dataclass, field  # resultados
from typing import Protocol  # interfaz del juez


# =============================================================================== extracción
def normalize_value(v: object) -> object:
    """Comparación justa: NFC, minúsculas, espacios colapsados; números como números ("27" == 27)."""
    if isinstance(v, bool) or v is None:
        return v
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        s = " ".join(unicodedata.normalize("NFC", v).casefold().split())
        try:
            return float(s.replace(",", ""))  # "1,200" → 1200.0 (separador de miles del caso)
        except ValueError:
            return s
    if isinstance(v, list):
        return sorted(str(normalize_value(x)) for x in v)  # listas como conjuntos ordenados
    return json.dumps(v, sort_keys=True, ensure_ascii=False)


def parse_json_object(text: str) -> dict | None:
    """El JSON del modelo, o None si no es un objeto válido. No "repara" nada: medir es medir."""
    try:
        obj = json.loads(text)
    except (ValueError, TypeError):
        return None
    return obj if isinstance(obj, dict) else None


@dataclass
class ExtractionReport:
    items: int = 0
    json_valid: int = 0
    exact_match: int = 0  # todos los campos correctos y ninguno de más
    tp: int = 0
    fp: int = 0
    fn: int = 0
    per_field: dict = field(default_factory=dict)  # campo → [tp, fp, fn]

    @property
    def json_validity(self) -> float:
        return self.json_valid / self.items if self.items else 0.0

    @property
    def precision(self) -> float:
        return self.tp / (self.tp + self.fp) if self.tp + self.fp else 0.0

    @property
    def recall(self) -> float:
        return self.tp / (self.tp + self.fn) if self.tp + self.fn else 0.0

    @property
    def f1(self) -> float:
        p, r = self.precision, self.recall
        return 2 * p * r / (p + r) if p + r else 0.0

    def field_f1(self, name: str) -> float:
        tp, fp, fn = self.per_field.get(name, (0, 0, 0))
        return 2 * tp / (2 * tp + fp + fn) if tp + fp + fn else 0.0


def evaluate_extraction(pairs: Iterable[tuple[dict, str]]) -> ExtractionReport:
    """pairs = (oro, salida cruda del modelo). F1 micro por campo; un JSON inválido cuenta todo el oro como FN."""
    rep = ExtractionReport()
    for gold, raw in pairs:
        rep.items += 1
        pred = parse_json_object(raw)
        gold = {k: v for k, v in gold.items() if v is not None}  # null en el oro = "no aplica"
        if pred is None:
            for k in gold:
                rep.fn += 1
                rep.per_field.setdefault(k, [0, 0, 0])[2] += 1
            continue
        rep.json_valid += 1
        pred = {k: v for k, v in pred.items() if v is not None}
        all_ok = True
        for k in set(gold) | set(pred):
            counts = rep.per_field.setdefault(k, [0, 0, 0])
            in_gold, in_pred = k in gold, k in pred
            if in_gold and in_pred and normalize_value(gold[k]) == normalize_value(pred[k]):
                rep.tp += 1
                counts[0] += 1
                continue
            all_ok = False
            if in_pred:  # predijo algo que no está o está mal: falso positivo
                rep.fp += 1
                counts[1] += 1
            if in_gold:  # el valor correcto no apareció: falso negativo
                rep.fn += 1
                counts[2] += 1
        rep.exact_match += all_ok
    return rep


# =============================================================================== juez pareado
class Judge(Protocol):
    """Lo que el runner necesita de un juez. El real llama al LLM juez por el gateway con una rúbrica."""

    def compare(self, prompt: str, first: str, second: str) -> str:
        """Devuelve "first", "second" o "tie": cuál de las dos respuestas, EN ESE ORDEN, es mejor."""
        ...

    def score(self, prompt: str, answer: str) -> float:
        """Puntaje pointwise en [1, 5] según la rúbrica (para seguir tendencias, no para decidir pares)."""
        ...


@dataclass
class PairwiseReport:
    pairs: int = 0
    wins: int = 0  # candidato mejor en ambos órdenes
    losses: int = 0  # referencia mejor en ambos órdenes
    ties: int = 0  # empate en ambos órdenes o el juez cambió de opinión al cambiar el orden
    inconsistent: int = 0  # cuántos de esos empates son por inconsistencia (sesgo de posición)

    @property
    def win_rate(self) -> float:
        return (self.wins + 0.5 * self.ties) / self.pairs if self.pairs else 0.0

    @property
    def position_consistency(self) -> float:
        return 1 - self.inconsistent / self.pairs if self.pairs else 0.0


def judge_pairwise(judge: Judge, items: Iterable[tuple[str, str, str]]) -> PairwiseReport:
    """items = (prompt, respuesta candidata, respuesta de referencia). Cada par se juzga en los dos órdenes."""
    rep = PairwiseReport()
    for prompt, cand, ref in items:
        rep.pairs += 1
        a = judge.compare(prompt, cand, ref)  # candidato primero
        b = judge.compare(prompt, ref, cand)  # referencia primero
        va = {"first": "cand", "second": "ref", "tie": "tie"}[a]
        vb = {"first": "ref", "second": "cand", "tie": "tie"}[b]
        if va == vb == "cand":
            rep.wins += 1
        elif va == vb == "ref":
            rep.losses += 1
        else:
            rep.ties += 1
            if va != vb:
                # El veredicto cambió con el orden: p. ej. "gana el primero" las dos veces (eligió la POSICIÓN,
                # no la respuesta), o empate en un orden y victoria en el otro
                rep.inconsistent += 1
    return rep


def wilson_interval(successes: float, n: int, z: float = 1.96) -> tuple[float, float]:
    """Intervalo de Wilson (95 % con z = 1.96). Con empates como ½ es una aproximación: los pares no son
    exactamente Bernoulli. Para decisiones finas, bootstrap sobre conversaciones."""
    if n == 0:
        return 0.0, 1.0
    p = successes / n
    denom = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return max(0.0, center - half), min(1.0, center + half)


def cohens_kappa(a: list[str], b: list[str]) -> float:
    """Acuerdo juez-humano más allá del azar. Se usa para CALIBRAR el juez antes de confiar en él."""
    if len(a) != len(b) or not a:
        raise ValueError("listas del mismo largo y no vacías")
    labels = set(a) | set(b)
    n = len(a)
    po = sum(x == y for x, y in zip(a, b, strict=True)) / n
    pe = sum((a.count(lab) / n) * (b.count(lab) / n) for lab in labels)
    return 1.0 if pe == 1 else (po - pe) / (1 - pe)


# =============================================================================== gate
@dataclass(frozen=True)
class GateThresholds:
    """Umbrales ILUSTRATIVOS: los fija cada producto con su dueño. Se versionan con el código."""

    min_json_validity: float = 0.99  # extracción: 1 % de JSON roto ya es 20k items por noche (de 2 M)
    min_field_f1: float = 0.90  # extracción: piso absoluto
    max_f1_drop: float = 0.01  # extracción: contra la revisión actual (si se da baseline)
    min_win_rate_lower: float = 0.45  # chat: no-inferioridad con margen de 5 puntos (borde inferior de Wilson)
    min_position_consistency: float = 0.80  # chat: debajo de esto el juez decide por posición, no por calidad
    min_judge_kappa: float = 0.60  # chat: acuerdo juez-humano medido en la muestra de calibración
    min_pairs: int = 300  # chat: con menos, el intervalo es demasiado ancho para decidir


@dataclass
class GateResult:
    passed: bool
    reasons: list[str]  # por qué NO pasa (vacía si pasa)
    metrics: dict


def gate_extraction(rep: ExtractionReport, t: GateThresholds, baseline_f1: float | None = None) -> GateResult:
    reasons = []
    if rep.json_validity < t.min_json_validity:
        reasons.append(f"JSON válido {rep.json_validity:.3f} < {t.min_json_validity}")
    if rep.f1 < t.min_field_f1:
        reasons.append(f"F1 por campo {rep.f1:.3f} < {t.min_field_f1}")
    if baseline_f1 is not None and baseline_f1 - rep.f1 > t.max_f1_drop:
        reasons.append(f"F1 cae {baseline_f1 - rep.f1:.3f} contra la revisión actual (> {t.max_f1_drop})")
    return GateResult(not reasons, reasons, {"json_validity": rep.json_validity, "field_f1": rep.f1,
                                             "precision": rep.precision, "recall": rep.recall,
                                             "exact_match": rep.exact_match / rep.items if rep.items else 0.0})


def gate_pairwise(rep: PairwiseReport, t: GateThresholds, judge_kappa: float) -> GateResult:
    lo, hi = wilson_interval(rep.wins + 0.5 * rep.ties, rep.pairs)
    reasons = []
    if rep.pairs < t.min_pairs:
        reasons.append(f"solo {rep.pairs} pares (< {t.min_pairs})")
    if judge_kappa < t.min_judge_kappa:
        reasons.append(f"kappa juez-humano {judge_kappa:.2f} < {t.min_judge_kappa}: recalibra el juez antes de decidir")
    if rep.position_consistency < t.min_position_consistency:
        reasons.append(f"consistencia de posición {rep.position_consistency:.2f} < {t.min_position_consistency}")
    if lo < t.min_win_rate_lower:
        reasons.append(f"win rate {rep.win_rate:.3f}, IC95 [{lo:.3f}, {hi:.3f}]: el borde inferior no pasa {t.min_win_rate_lower}")
    return GateResult(not reasons, reasons, {"win_rate": rep.win_rate, "ci95": (lo, hi), "pairs": rep.pairs,
                                             "ties": rep.ties, "position_consistency": rep.position_consistency,
                                             "judge_kappa": judge_kappa})


if __name__ == "__main__":
    # Los ejemplos del docstring
    r = evaluate_extraction([({"marca": "Nike", "talla": "27", "color": "negro"},
                              '{"marca": "nike ", "talla": "27.5", "material": "piel"}')])
    print(f"extracción: P {r.precision:.2f} R {r.recall:.2f} F1 {r.f1:.2f} JSON válido {r.json_validity:.0%}")
    for wr, n in ((0.50, 1_000), (0.50, 100), (0.48, 1_000)):
        lo, hi = wilson_interval(wr * n, n)
        print(f"win rate {wr:.2f} con {n:,} pares: IC95 [{lo:.3f}, {hi:.3f}] → {'pasa' if lo >= 0.45 else 'no pasa'} 0.45")
