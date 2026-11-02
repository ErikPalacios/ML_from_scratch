"""Elige el umbral de rechazo con recall mínimo por tipo y el presupuesto de FP del caso (caso c03).

Por qué no "el umbral que maximiza F1": en esta línea los errores no cuestan lo mismo. Un falso
negativo (defecto que llega a la armadora) cuesta ≈ US$2,000–10,000 por incidente; un falso positivo
(pieza buena a inspección manual) ≈ US$0.05–0.10. Entonces:
  1. Restricción dura: recall >= 99.5 % en CADA tipo de defecto (no en promedio: un tipo raro con
     recall bajo se esconde en el promedio).
  2. FP <= objetivo de 1.5 % (el punto B del caso) y NUNCA sobre el tope de capacidad: los rechazos
     no pueden superar lo que el inspector manual procesa (1 pieza cada 15 s en 16 h = 3,840/día).
  3. Entre los que cumplen, el umbral MÁS BAJO: con un FN 20,000× más caro que un FP, el FP que
     sobra hasta el objetivo se gasta en margen de recall.
  4. Si ninguno cabe en el objetivo: el de menor costo esperado dentro del tope, marcado "SOBRE el
     objetivo". Si tampoco: código 3.

Por qué no simplemente "el de menor costo en validación": ese umbral queda EXACTAMENTE en el defecto
más bajo del tipo que limita. Debajo de él el recall de validación ya es 100 %, así que bajar más no
ahorra nada EN VALIDACIÓN y el costo no ve razón para gastar el presupuesto. Pero un defecto nuevo de
ese tipo cae debajo del más bajo de n con probabilidad ≈ 1/(n + 1): con 75 por tipo, ≈ 1.3 %, un
recall esperado de ≈ 98.7 %, por debajo del 99.5 % exigido. El reporte muestra ese umbral y su riesgo.

Varias cabezas: decision.py rechaza si CUALQUIER score dispara (la anomalía o una de las 4 cabezas
del clasificador), así que objetivo y tope son de la UNIÓN. Los defaults (1.5 % y ≈ 2.85 %) son el
presupuesto ENTERO: correcto solo si decide la anomalía sola (`defects: {}` en config.yaml). Con
clasificador, pasa a cada cabeza su parte con --target-fp-rate/--max-fp-rate (p. ej. 0.003 y 0.0057
cada una: la anomalía + 4 cabezas = 1.5 % y 2.85 %, o menos por el solape) y verifica la unión sobre
validación (p. ej. con decision.py y todos los umbrales) antes de escribir config.yaml: esta
herramienta evalúa UNA columna a la vez. Con --defect-type ambas tasas son obligatorias.

Entrada: CSV con una fila por imagen de VALIDACIÓN (nunca las de entrenamiento):
    score,is_defect,defect_type
    0.12,0,
    0.87,1,crack
El score es el que compara decision.py (score >= umbral → REJECT). Cuando exista el clasificador
supervisado, cada cabeza se elige con --defect-type sobre su propia columna de scores.

Uso:  python choose_threshold.py val_scores.csv [--target-fp-rate 0.015] [--c-fn 2000 --c-fp 0.10] [--json]
      python choose_threshold.py crack_scores.csv --defect-type crack --target-fp-rate 0.003 --max-fp-rate 0.0057
Sale con 0 si hay umbral (aunque quede SOBRE el objetivo: el reporte y --json lo dicen), 1 si la
entrada es inválida y 3 si NINGÚN umbral cumple recall y tope (útil como gate de CI).
Solo biblioteca estándar: corre en cualquier máquina del equipo, sin instalar nada.
"""

from __future__ import annotations  # anotaciones modernas también en Python 3.10

import argparse  # CLI con los números del caso como defaults
import csv  # lectura del CSV de validación
import json  # salida --json para que un pipeline escriba config.yaml
import math  # log, lgamma, ceil e isfinite
import sys  # códigos de salida
from dataclasses import dataclass  # filas y candidatos inmutables

# Defaults = números del caso (SPEC del caso c03); cámbialos con flags, no editando el código
PARTS_PER_DAY = 115_200  # 2 piezas/s × 3,600 s × 16 h por línea
DEFECT_RATE = 0.005  # ≈ 0.5 % de piezas con defecto → ≈ 576/día por línea
INSPECTOR_CAPACITY = 3_840  # 1 pieza cada 15 s × 16 h, un inspector por línea
# Costos: los extremos del rango que MENOS favorecen atrapar defectos (FN barato, FP caro). Si el
# umbral elegido se sostiene con estos, con un FN de US$10,000 se sostiene con más razón.
C_FN = 2_000.0  # US$ por defecto escapado: extremo bajo del rango (2,000–10,000); ver --c-fn
C_FP = 0.10  # US$ por pieza buena re-inspeccionada: extremo alto del rango (0.05–0.10)
MIN_RECALL = 0.995  # por tipo de defecto
TARGET_FP_RATE = 0.015  # objetivo del caso; el máximo duro sale de la capacidad del inspector
CONFIDENCE = 0.95  # para la cota de la advertencia estadística


def pct(x: float, decimals: int = 1) -> str:
    """0.995 → '99.5 %' (con espacio, como el resto del caso)."""
    return f"{x * 100:.{decimals}f} %"


@dataclass(frozen=True)
class Row:
    score: float
    is_defect: bool
    defect_type: str  # "" en piezas buenas


@dataclass(frozen=True)
class Candidate:
    threshold: float  # REJECT si score >= threshold
    caught: dict  # tipo → defectos de validación con score >= threshold
    totals: dict  # tipo → defectos de validación de ese tipo
    fp: int  # piezas buenas de validación con score >= threshold
    n_good: int

    @property
    def recall_by_type(self) -> dict:
        return {t: self.caught[t] / self.totals[t] for t in self.totals}

    @property
    def fp_rate(self) -> float:  # FP / piezas buenas (la definición estándar)
        return self.fp / self.n_good

    @property
    def miss_rate(self) -> float:  # defectos no detectados sobre el total (mezcla de validación)
        return 1 - sum(self.caught.values()) / sum(self.totals.values())


def read_scores(path: str) -> list[Row]:
    """Lee y valida el CSV. Un dato raro aquí es un umbral equivocado en la línea: se falla fuerte."""
    rows = []
    with open(path, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        missing = {"score", "is_defect", "defect_type"} - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"faltan columnas: {sorted(missing)}")
        for line, rec in enumerate(reader, start=2):  # línea 1 = encabezado
            try:
                score = float(rec["score"])
            except ValueError:
                raise ValueError(f"línea {line}: score no numérico {rec['score']!r}") from None
            if not math.isfinite(score) or not 0.0 <= score <= 1.0:  # mismo rango que decision.py
                raise ValueError(f"línea {line}: score fuera de [0, 1]: {score}")
            flag = rec["is_defect"].strip().lower()
            if flag not in {"0", "1", "true", "false"}:
                raise ValueError(f"línea {line}: is_defect debe ser 0/1, llegó {rec['is_defect']!r}")
            is_defect = flag in {"1", "true"}
            defect_type = (rec["defect_type"] or "").strip()
            if is_defect and not defect_type:  # sin tipo no se puede exigir recall por tipo
                raise ValueError(f"línea {line}: defecto sin defect_type")
            rows.append(Row(score, is_defect, defect_type if is_defect else ""))
    if not any(r.is_defect for r in rows) or all(r.is_defect for r in rows):
        raise ValueError("el CSV necesita piezas buenas Y defectos")
    return rows


def sweep(rows: list[Row]) -> list[Candidate]:
    """Todos los umbrales útiles (cada score distinto), de mayor a menor, en O(n log n)."""
    totals: dict = {}
    for r in rows:
        if r.is_defect:
            totals[r.defect_type] = totals.get(r.defect_type, 0) + 1
    n_good = sum(1 for r in rows if not r.is_defect)
    ordered = sorted(rows, key=lambda r: r.score, reverse=True)
    caught = {t: 0 for t in totals}
    fp, i, out = 0, 0, []
    while i < len(ordered):
        threshold = ordered[i].score
        # Entran TODAS las filas con este mismo score: con ">=" un empate cae del mismo lado
        while i < len(ordered) and ordered[i].score == threshold:
            if ordered[i].is_defect:
                caught[ordered[i].defect_type] += 1
            else:
                fp += 1
            i += 1
        out.append(Candidate(threshold, dict(caught), dict(totals), fp, n_good))
    return out


def daily(c: Candidate, parts_per_day: int, defect_rate: float, c_fn: float, c_fp: float) -> dict:
    """Pasa las tasas de validación a piezas y dólares por día de UNA línea."""
    defects = parts_per_day * defect_rate
    good = parts_per_day - defects
    fn, fp = defects * c.miss_rate, good * c.fp_rate
    return {"fn_per_day": fn, "fp_per_day": fp, "to_manual_per_day": defects - fn + fp,
            "cost_per_day": fn * c_fn + fp * c_fp}


def max_threshold_by_type(cands: list[Candidate], min_recall: float) -> dict:
    """Para cada tipo, el umbral más ALTO que aún cumple su recall. El menor de todos manda."""
    limits = {}
    for c in cands:  # de mayor a menor umbral: el primero que cumple es el más alto
        for t, r in c.recall_by_type.items():
            if t not in limits and r >= min_recall:
                limits[t] = c.threshold
    return limits


def miss_rate_upper_bound(n: int, misses: int, confidence: float = CONFIDENCE) -> float:
    """Cota superior (Clopper-Pearson, una cola) de la tasa de fallas real con `misses` de `n`.

    Con 0 fallas es 1 − (1 − confidence)^(1/n) ≈ 3/n (la "regla de 3"). Por bisección sobre la
    CDF binomial, para no depender de scipy.
    """
    if misses >= n:
        return 1.0
    alpha = 1 - confidence

    def cdf(p: float) -> float:  # P(X <= misses) con X ~ Binomial(n, p), en log para n grandes
        return sum(math.exp(math.lgamma(n + 1) - math.lgamma(k + 1) - math.lgamma(n - k + 1)
                            + k * math.log(p) + (n - k) * math.log1p(-p)) for k in range(misses + 1))

    lo, hi = 0.0, 1.0
    for _ in range(60):  # 60 bisecciones: precisión muy por debajo de la que importa
        mid = (lo + hi) / 2
        if cdf(mid) > alpha:
            lo = mid
        else:
            hi = mid
    return hi


def defects_needed(min_recall: float, confidence: float = CONFIDENCE) -> int:
    """Defectos de un tipo, SIN fallas, para afirmar recall >= min_recall con esa confianza."""
    return math.ceil(math.log(1 - confidence) / math.log(min_recall))


def choose(rows: list[Row], *, min_recall: float, target_fp_rate: float, max_fp_rate: float,
           parts_per_day: int, defect_rate: float, c_fn: float, c_fp: float) -> dict:
    """El umbral MÁS BAJO con FP dentro del objetivo; si no hay, el de menor costo dentro del tope.

    `chosen` es None si ningún umbral cumple recall y tope. `on_target` dice cuál de los dos casos
    fue. `min_cost` es el umbral de menor costo en validación, para compararlo en el reporte.
    """
    cands = sweep(rows)
    viable = [c for c in cands
              if min(c.recall_by_type.values()) >= min_recall and c.fp_rate <= max_fp_rate]
    # Menor costo en validación; en empate, el umbral más alto (menos piezas a inspección manual)
    min_cost = min(viable, key=lambda c: (daily(c, parts_per_day, defect_rate, c_fn, c_fp)["cost_per_day"],
                                          -c.threshold), default=None)
    # El más bajo que cabe en el objetivo: el FP que sobra se convierte en margen bajo los defectos
    on_target = [c for c in viable if c.fp_rate <= target_fp_rate]
    best = min(on_target, key=lambda c: c.threshold, default=None)
    return {"chosen": best or min_cost, "on_target": best is not None, "min_cost": min_cost,
            "limits": max_threshold_by_type(cands, min_recall), "n_candidates": len(cands)}



def report(rows: list[Row], result: dict, args) -> str:
    """Texto para humanos: el umbral, qué tipo lo limita, costos y la advertencia estadística."""
    defects_day = args.parts_per_day * args.defect_rate
    totals = sweep(rows)[0].totals
    n_good = sum(1 for r in rows if not r.is_defect)
    lines = [
        f"Validación: {len(rows):,} filas · {n_good:,} buenas · {sum(totals.values()):,} defectos ("
        + ", ".join(f"{t} {n}" for t, n in sorted(totals.items())) + ")",
        f"Reglas: recall >= {pct(args.min_recall)} en CADA tipo · FP objetivo {pct(args.target_fp_rate, 2)} · "
        f"tope duro {pct(args.max_fp_rate, 2)} · FN US${args.c_fn:,.0f} · FP US${args.c_fp:.2f}",
        ("Cabeza " + args.defect_type + ": objetivo y tope son SU parte del presupuesto; verifica la unión de "
         "todas las cabezas sobre validación antes de escribir config.yaml." if args.defect_type else
         "Objetivo y tope son de la UNIÓN: correcto si decide la anomalía sola; con clasificador, pasa a "
         "cada cabeza (y a la anomalía) su parte y verifica la unión."),
        "Umbral más alto que cumple el recall, por tipo (el menor limita):",
    ]
    limits = result["limits"]
    binding = min(limits, key=limits.get) if len(limits) == len(totals) else None
    for t in sorted(totals):
        mark = "  ← limita el umbral" if t == binding else ""
        lines.append(f"  {t:<14} {limits[t]:.4f}{mark}" if t in limits else f"  {t:<14} ninguno lo cumple")
    best: Candidate = result["chosen"]
    if best is None:
        lines.append("NINGÚN umbral cumple recall por tipo y capacidad a la vez. No bajes el recall: mejora "
                     "iluminación, datos o modelo, o agrega capacidad de inspección manual.")
        return "\n".join(lines)
    d = daily(best, args.parts_per_day, args.defect_rate, args.c_fn, args.c_fp)
    target_ok = "OK" if result["on_target"] else "SOBRE el objetivo"
    how = ("el más bajo con FP dentro del objetivo" if result["on_target"] else
           "ninguno cabe en el objetivo: el de menor costo dentro del tope")
    lines += [
        f"Elegido: umbral {best.threshold:.4f} ({how}; score >= umbral → REJECT)",
        "  recall por tipo: " + " · ".join(f"{t} {pct(r)}" for t, r in sorted(best.recall_by_type.items())),
        f"  FP rate: {pct(best.fp_rate, 2)} (objetivo {pct(args.target_fp_rate, 2)}: {target_ok} · "
        f"tope {pct(args.max_fp_rate, 2)})",
        f"  Por línea y día ({args.parts_per_day:,} piezas, {defects_day:,.0f} defectos): "
        f"FN {d['fn_per_day']:.2f} · FP {d['fp_per_day']:,.0f} · "
        f"a inspección manual {d['to_manual_per_day']:,.0f} de {args.inspector_capacity:,}",
        f"  Costo esperado: US${d['cost_per_day']:,.2f}/día "
        f"(FN US${d['fn_per_day'] * args.c_fn:,.2f} + FP US${d['fp_per_day'] * args.c_fp:,.2f})",
    ]
    # El umbral de menor costo en validación, para comparar: se pega al defecto más bajo del tipo que
    # limita, y ahí un defecto nuevo de ese tipo cae debajo con probabilidad ≈ (fallas + 1)/(n + 1)
    cheap: Candidate = result["min_cost"]
    if binding is not None and cheap is not None and cheap.threshold == limits[binding]:
        n, misses = totals[binding], totals[binding] - cheap.caught[binding]
        risk = (misses + 1) / (n + 1)  # rango de un defecto nuevo entre n + 1 intercambiables
        lines.append(f"  Menor costo en validación: umbral {cheap.threshold:.4f} (FP {pct(cheap.fp_rate, 2)}), justo sobre "
                     f"un {binding} de validación: uno nuevo cae debajo con probabilidad ≈ ({misses} fallas + 1) / "
                     f"({n} + 1) = {pct(risk)} (recall esperado ≈ {pct(1 - risk)}).")
        if best.threshold < cheap.threshold:
            lines.append(f"  El elegido queda {cheap.threshold - best.threshold:.4f} por debajo: ese margen es lo que "
                         "compra el FP que sobra hasta el objetivo.")
    # Advertencia estadística: con pocos defectos, "0 fallas en validación" no demuestra 99.5 %
    need = defects_needed(args.min_recall)
    n_total = sum(totals.values())
    misses_total = n_total - sum(best.caught.values())
    pooled = miss_rate_upper_bound(n_total, misses_total)
    weak: dict = {}  # (defectos, fallas) → tipos: una línea por grupo, no una por tipo
    for t in sorted(totals):
        n, misses = totals[t], totals[t] - best.caught[t]
        if miss_rate_upper_bound(n, misses) > 1 - args.min_recall:
            weak.setdefault((n, misses), []).append(t)
    for (n, misses), types in weak.items():
        bound = miss_rate_upper_bound(n, misses)
        lines.append(f"  OJO {', '.join(types)}: {n} defectos por tipo y {misses} fallas → la tasa de fallas real "
                     f"podría llegar a {pct(bound)} ({pct(CONFIDENCE, 0)} de confianza). Para afirmar "
                     f"{pct(args.min_recall)} hacen falta ≈ {need} defectos por tipo sin fallas.")
    lines.append(f"  Con la cota al {pct(CONFIDENCE, 0)} de la tasa de fallas total ({pct(pooled, 2)}), el costo por FN "
                 f"podría llegar a US${defects_day * pooled * args.c_fn:,.0f}/día: el FN domina el costo.")
    return "\n".join(lines)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Umbral por costo esperado con recall mínimo por tipo (c03)")
    ap.add_argument("csv", help="CSV de validación: score,is_defect,defect_type")
    ap.add_argument("--min-recall", type=float, default=MIN_RECALL)
    ap.add_argument("--c-fn", type=float, default=C_FN, help="US$ por defecto escapado")
    ap.add_argument("--c-fp", type=float, default=C_FP, help="US$ por pieza buena re-inspeccionada")
    ap.add_argument("--parts-per-day", type=int, default=PARTS_PER_DAY)
    ap.add_argument("--defect-rate", type=float, default=DEFECT_RATE)
    ap.add_argument("--inspector-capacity", type=int, default=INSPECTOR_CAPACITY, help="piezas/día a mano")
    ap.add_argument("--max-fp-rate", type=float, default=None,
                    help="tope duro; default: (capacidad − defectos/día) / buenas/día (de la UNIÓN)")
    ap.add_argument("--target-fp-rate", type=float, default=None,
                    help=f"objetivo; default: {TARGET_FP_RATE} (de la UNIÓN de cabezas)")
    ap.add_argument("--defect-type", default=None,
                    help="solo este tipo (una cabeza del clasificador); exige --target-fp-rate y --max-fp-rate")
    ap.add_argument("--json", action="store_true", help="salida para un pipeline")
    args = ap.parse_args(argv)
    defects_day = args.parts_per_day * args.defect_rate
    if args.defect_type and (args.target_fp_rate is None or args.max_fp_rate is None):
        # Los defaults son el presupuesto ENTERO: aplicados a una sola cabeza, la unión se pasa
        print("error: con --defect-type pasa la parte del presupuesto de FP de esta cabeza con "
              "--target-fp-rate y --max-fp-rate, p. ej. 0.003 y 0.0057 (1/5 de 1.5 % y de 2.85 %)",
              file=sys.stderr)
        return 1
    if args.target_fp_rate is None:
        args.target_fp_rate = TARGET_FP_RATE
    # ≈ 2.85 % de las piezas BUENAS (= el ≈ 2.8 % del caso, que divide entre todas las piezas):
    # lo que cabe en la capacidad del inspector después de los defectos reales
    if args.max_fp_rate is None:
        args.max_fp_rate = (args.inspector_capacity - defects_day) / (args.parts_per_day - defects_day)
    try:
        rows = read_scores(args.csv)
        if args.defect_type:  # otros tipos no son FP de esta cabeza: se sacan del análisis
            rows = [r for r in rows if not r.is_defect or r.defect_type == args.defect_type]
            if not any(r.is_defect for r in rows):
                raise ValueError(f"no hay defectos de tipo {args.defect_type!r}")
    except (OSError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    result = choose(rows, min_recall=args.min_recall, target_fp_rate=args.target_fp_rate,
                    max_fp_rate=args.max_fp_rate, parts_per_day=args.parts_per_day,
                    defect_rate=args.defect_rate, c_fn=args.c_fn, c_fp=args.c_fp)
    best = result["chosen"]
    if args.json:
        payload = {"threshold": None if best is None else best.threshold,
                   "on_target": result["on_target"],  # False: el pipeline no debería escribirlo sin revisión
                   "min_cost_threshold": None if result["min_cost"] is None else result["min_cost"].threshold,
                   "limits_by_type": result["limits"], "target_fp_rate": args.target_fp_rate,
                   "max_fp_rate": args.max_fp_rate}
        if best is not None:
            payload.update(recall_by_type=best.recall_by_type, fp_rate=best.fp_rate,
                           **daily(best, args.parts_per_day, args.defect_rate, args.c_fn, args.c_fp))
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print(report(rows, result, args))
    return 0 if best is not None else 3


if __name__ == "__main__":
    sys.exit(main())
