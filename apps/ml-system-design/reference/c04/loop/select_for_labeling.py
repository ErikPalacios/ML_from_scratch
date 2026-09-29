"""Active learning con presupuesto de HORAS de patólogo (caso c04): qué regiones etiquetar este mes.

El recurso escaso no es la GPU, es el patólogo: 20 h/mes a ≈ US$200/h (est.) ≈ US$4k, el costo más
grande del sistema. No todas esas horas son de active learning: con el reparto del caso, ≈ 2 h van a
la auditoría aleatoria de láminas firmadas (automation bias) y ≈ 2.5 h al set temporal del mes, y esas
láminas se eligen AL AZAR, no con este script. Quedan ≈ 15.5 h (el default de --hours). Etiquetar una
región toma ≈ 1–2 min (est.): con 1.5 min (default), 15.5 × 60 ÷ 1.5 = 620 regiones.

Cómo elige (en este orden):
  1. Descarta slides prohibidos (--exclude-slides): el golden set y los sets de evaluación. Una región
     de un slide del golden set que entra a training contamina la métrica que decide los deploys.
  2. Puntaje = incertidumbre del modelo en la región (la produce un job que corre el modelo sobre los
     slides del mes y resume cada región candidata):
       --score entropy: entropía binaria media por pixel, en bits (0 = seguro, 1 = p = 0.5 en todo)
       --score margin:  1 − 2 × margen, con margen = media de |p − 0.5| (0 = seguro, 1 = en el umbral)
  3. Labs prioritarios primero (--priority-labs, default C: el lab que el modelo nunca vio), por
     incertidumbre, hasta --priority-max-share del presupuesto. Default 1.0: TODO lo de C va primero
     mientras C esté en silent mode (el tope por slide igual reparte). Cuando C ya esté validado,
     bájalo (p. ej. 0.5): si no, un mes con miles de regiones de C se come las horas y A/B no reciben
     nada, aunque también deriven.
  4. El resto, estratificado por (lab, escáner) en round-robin: en cada vuelta, la región más incierta
     que queda de cada estrato (C sigue siendo un estrato más). Así un escáner con muchas regiones
     inciertas no acapara la lista.
  5. En todo momento, como mucho --max-per-slide regiones por slide (default 5): diez regiones del
     mismo slide enseñan casi lo mismo que una (y el patólogo abre un slide, no una región).
Entrada: CSV con slide_id, lab, scanner, region_id, x, y (nivel 0) y mean_entropy o margin; opcional
minutes (costo propio de la región, p. ej. regiones más grandes). Salida: CSV ordenado para el
patólogo + resumen por lab en stderr.

Uso: python select_for_labeling.py candidates.csv --hours 15.5 --exclude-slides golden.txt -o lista.csv
Solo biblioteca estándar.
"""

from __future__ import annotations

import argparse
import csv
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

REQUIRED = ("slide_id", "lab", "scanner", "region_id", "x", "y")


@dataclass(frozen=True)
class Region:
    slide_id: str
    lab: str
    scanner: str
    region_id: str
    x: int  # esquina de la región en px de nivel 0 (lo que abre el visor)
    y: int
    score: float  # incertidumbre en [0, 1]: más alto = más útil etiquetarla
    minutes: float  # costo estimado de etiquetarla


@dataclass
class Selection:
    regions: list[tuple[Region, str]] = field(default_factory=list)  # (región, fase)
    minutes: float = 0.0


def load_candidates(path: Path, score: str, default_minutes: float) -> list[Region]:
    """Lee y valida el CSV. Un error dice la línea: un CSV roto no debe convertirse en una lista vacía."""
    col = {"entropy": "mean_entropy", "margin": "margin"}[score]
    out, seen = [], set()
    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        missing = [c for c in REQUIRED + (col,) if c not in (reader.fieldnames or [])]
        if missing:
            raise ValueError(f"faltan columnas: {missing}")
        for line, row in enumerate(reader, start=2):
            try:
                raw = float(row[col])
                if score == "entropy":
                    if not 0.0 <= raw <= 1.0:  # entropía binaria en bits
                        raise ValueError("mean_entropy fuera de [0, 1]")
                    s = raw
                else:
                    if not 0.0 <= raw <= 0.5:
                        raise ValueError("margin fuera de [0, 0.5]")
                    s = 1.0 - 2.0 * raw
                minutes = float(row["minutes"]) if row.get("minutes") else default_minutes
                if minutes <= 0:
                    raise ValueError("minutes debe ser > 0")
                r = Region(row["slide_id"], row["lab"], row["scanner"], row["region_id"],
                           int(row["x"]), int(row["y"]), s, minutes)
            except (ValueError, TypeError) as e:
                raise ValueError(f"{path}:{line}: {e}") from None
            key = (r.slide_id, r.region_id)
            if key in seen:  # la misma región dos veces: se cuenta una
                continue
            seen.add(key)
            out.append(r)
    return out


def _order(regions: list[Region]) -> list[Region]:
    """Más incierta primero; empates por ids para que la lista sea reproducible."""
    return sorted(regions, key=lambda r: (-r.score, r.slide_id, r.region_id))


def select(candidates: list[Region], budget_minutes: float, max_per_slide: int = 5,
           priority_labs: tuple[str, ...] = ("C",), priority_max_share: float = 1.0,
           exclude_slides: frozenset[str] = frozenset()) -> Selection:
    sel = Selection()
    per_slide: dict[str, int] = defaultdict(int)
    pool = [r for r in candidates if r.slide_id not in exclude_slides]

    def take(r: Region, phase: str, limit: float) -> bool:
        if per_slide[r.slide_id] >= max_per_slide or sel.minutes + r.minutes > limit + 1e-9:
            return False
        sel.regions.append((r, phase))
        sel.minutes += r.minutes
        per_slide[r.slide_id] += 1
        return True

    # Fase 1: labs prioritarios, por incertidumbre, hasta su tope del presupuesto
    prio_limit = budget_minutes * priority_max_share
    for r in _order([r for r in pool if r.lab in priority_labs]):
        take(r, "priority", prio_limit)
    taken = {(r.slide_id, r.region_id) for r, _ in sel.regions}

    # Fase 2: round-robin entre estratos (lab, escáner) con lo que queda (incluido lo que sobró de C)
    strata: dict[tuple[str, str], list[Region]] = defaultdict(list)
    for r in _order([r for r in pool if (r.slide_id, r.region_id) not in taken]):
        strata[(r.lab, r.scanner)].append(r)
    # El estrato con la región más incierta empieza cada vuelta (orden estable entre vueltas)
    keys = sorted(strata, key=lambda k: (-strata[k][0].score, k))
    cursor = {k: 0 for k in keys}
    progress = True
    while progress and sel.minutes < budget_minutes:
        progress = False
        for k in keys:
            lst = cursor[k]
            while lst < len(strata[k]):  # la mejor región de este estrato que todavía cabe
                r = strata[k][lst]
                lst += 1
                if take(r, "stratified", budget_minutes):
                    progress = True
                    break
            cursor[k] = lst
    return sel


def summarize(sel: Selection) -> dict[str, dict[str, float]]:
    by_lab: dict[str, dict[str, float]] = defaultdict(lambda: {"regions": 0, "minutes": 0.0, "slides": 0})
    slides: dict[str, set] = defaultdict(set)
    for r, _ in sel.regions:
        by_lab[r.lab]["regions"] += 1
        by_lab[r.lab]["minutes"] += r.minutes
        slides[r.lab].add(r.slide_id)
    for lab, s in slides.items():
        by_lab[lab]["slides"] = len(s)
    return dict(by_lab)


def write_csv(sel: Selection, out) -> None:
    w = csv.writer(out)
    w.writerow(["rank", "slide_id", "lab", "scanner", "region_id", "x", "y", "score", "minutes",
                "cum_minutes", "phase"])
    cum = 0.0
    for i, (r, phase) in enumerate(sel.regions, start=1):
        cum += r.minutes
        w.writerow([i, r.slide_id, r.lab, r.scanner, r.region_id, r.x, r.y, f"{r.score:.4f}",
                    f"{r.minutes:g}", f"{cum:.1f}", phase])


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("candidates", type=Path)
    p.add_argument("--hours", type=float, default=15.5,
                   help="horas de patólogo para active learning este mes (default 15.5 de las 20)")
    p.add_argument("--minutes-per-region", type=float, default=1.5, help="costo por región si no hay columna minutes")
    p.add_argument("--score", choices=("entropy", "margin"), default="entropy")
    p.add_argument("--max-per-slide", type=int, default=5)
    p.add_argument("--priority-labs", default="C", help="labs separados por coma; '' = ninguno")
    p.add_argument("--priority-max-share", type=float, default=1.0, help="tope de los labs prioritarios (0–1)")
    p.add_argument("--exclude-slides", type=Path, help="un slide_id por línea (golden set, sets de evaluación)")
    p.add_argument("-o", "--output", type=Path, help="CSV de salida (default: stdout)")
    a = p.parse_args(argv)
    if a.hours <= 0 or not 0 <= a.priority_max_share <= 1 or a.max_per_slide < 1:
        p.error("--hours > 0, --priority-max-share en [0, 1], --max-per-slide ≥ 1")
    exclude = frozenset()
    if a.exclude_slides:
        exclude = frozenset(l.strip() for l in a.exclude_slides.read_text().splitlines() if l.strip())
    try:
        cands = load_candidates(a.candidates, a.score, a.minutes_per_region)
    except (OSError, ValueError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    prio = tuple(x for x in a.priority_labs.split(",") if x)
    sel = select(cands, a.hours * 60, a.max_per_slide, prio, a.priority_max_share, exclude)
    if a.output:
        with open(a.output, "w", newline="") as f:
            write_csv(sel, f)
    else:
        write_csv(sel, sys.stdout)
    print(f"{len(sel.regions)} regiones, {sel.minutes:.0f} de {a.hours * 60:.0f} min "
          f"({len(cands)} candidatas, {len(exclude)} slides excluidos)", file=sys.stderr)
    for lab, s in sorted(summarize(sel).items()):
        print(f"  lab {lab}: {s['regions']} regiones en {s['slides']} slides, {s['minutes']:.0f} min",
              file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
