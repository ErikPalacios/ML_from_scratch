"""Tests de select_for_labeling.py: presupuesto, prioridad de lab C, estratos, tope por slide."""

from __future__ import annotations

import csv
import io
import sys
from collections import Counter
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import select_for_labeling as S  # noqa: E402


def regions(lab, scanner, n_slides, per_slide, score=0.5, minutes=1.5, prefix=None):
    """n_slides × per_slide regiones con incertidumbre decreciente dentro de cada slide."""
    prefix = prefix or f"{lab}{scanner}"
    return [S.Region(f"{prefix}-s{s}", lab, scanner, f"r{i}", i * 512, 0,
                     round(score - 0.001 * i - 0.0001 * s, 6), minutes)
            for s in range(n_slides) for i in range(per_slide)]


def test_twenty_hours_at_1_5_min_is_800_regions():
    pool = regions("A", "X1", 200, 10) + regions("B", "X2", 200, 10)
    sel = S.select(pool, budget_minutes=20 * 60)
    assert len(sel.regions) == 800  # 1,200 min ÷ 1.5
    assert sel.minutes == pytest.approx(1200)


def test_lab_c_goes_first_up_to_its_share():
    pool = regions("A", "X1", 300, 10, score=0.9) + regions("C", "Y1", 300, 10, score=0.3)
    sel = S.select(pool, 1200, priority_labs=("C",), priority_max_share=0.5)
    phases = [ph for _, ph in sel.regions]
    # C entra primero aunque A sea más incierto: la mitad del presupuesto (400 regiones) es suya...
    assert phases[:400] == ["priority"] * 400 and phases[400:] == ["stratified"] * 400
    # ...y en la fase 2 C es un estrato más: con 2 estratos, la mitad de las 400 restantes
    assert Counter(r.lab for r, _ in sel.regions) == {"C": 600, "A": 200}


def test_default_takes_all_of_lab_c_first():
    # Mientras C está en silent mode, todo lo de C va primero (el tope por slide igual reparte)
    pool = regions("A", "X1", 300, 10, score=0.9) + regions("C", "Y1", 300, 10, score=0.3)
    sel = S.select(pool, 930)  # 15.5 h
    assert len(sel.regions) == 620 and {r.lab for r, _ in sel.regions} == {"C"}
    assert max(Counter(r.slide_id for r, _ in sel.regions).values()) == 5


def test_small_lab_c_is_taken_whole_and_the_rest_goes_to_others():
    pool = regions("A", "X1", 300, 10) + regions("C", "Y1", 6, 5)  # C: 30 regiones, todas caben
    sel = S.select(pool, 1200)
    c = [r for r, _ in sel.regions if r.lab == "C"]
    assert len(c) == 30 and len(sel.regions) == 800


def test_cap_per_slide_forces_diversity():
    pool = regions("A", "X1", 3, 50, score=0.99) + regions("A", "X1", 100, 3, score=0.2, prefix="low")
    sel = S.select(pool, 1200, max_per_slide=5)
    per_slide = Counter(r.slide_id for r, _ in sel.regions)
    assert max(per_slide.values()) == 5
    assert len(per_slide) == 3 + 100  # los 3 slides "muy inciertos" no se comen la lista


def test_strata_are_balanced_round_robin():
    # Un escáner con incertidumbre alta no acapara: los tres estratos reciben lo mismo (± 1)
    pool = (regions("A", "X1", 200, 5, score=0.95) + regions("A", "X2", 200, 5, score=0.4)
            + regions("B", "X3", 200, 5, score=0.2))
    sel = S.select(pool, 300, priority_labs=())  # 200 regiones
    counts = Counter((r.lab, r.scanner) for r, _ in sel.regions)
    assert sorted(counts.values()) in ([66, 67, 67], [66, 66, 68], [67, 67, 66])
    assert max(counts.values()) - min(counts.values()) <= 1


def test_excluded_slides_never_selected():
    pool = regions("A", "X1", 10, 5)
    golden = frozenset({"AX1-s0", "AX1-s3"})
    sel = S.select(pool, 1200, exclude_slides=golden)
    assert not {r.slide_id for r, _ in sel.regions} & golden


def test_region_cost_column_and_budget_never_exceeded():
    pool = [S.Region("s1", "A", "X", "big", 0, 0, 0.9, 50.0),
            S.Region("s2", "A", "X", "small", 0, 0, 0.8, 1.5),
            S.Region("s3", "A", "X", "small2", 0, 0, 0.7, 1.5)]
    sel = S.select(pool, 10, priority_labs=())
    assert [r.region_id for r, _ in sel.regions] == ["small", "small2"]  # la de 50 min no cabe
    assert sel.minutes <= 10


def _csv(tmp_path, rows, header=("slide_id", "lab", "scanner", "region_id", "x", "y", "mean_entropy")):
    p = tmp_path / "c.csv"
    with open(p, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)
    return p


def test_margin_score_is_one_near_the_threshold(tmp_path):
    p = _csv(tmp_path, [["s1", "A", "X", "r1", 0, 0, "0.02"], ["s1", "A", "X", "r2", 0, 0, "0.45"]],
             header=("slide_id", "lab", "scanner", "region_id", "x", "y", "margin"))
    regs = S.load_candidates(p, "margin", 1.5)
    assert [round(r.score, 2) for r in regs] == [0.96, 0.1]


def test_bad_rows_fail_loudly_with_the_line(tmp_path):
    p = _csv(tmp_path, [["s1", "A", "X", "r1", 0, 0, "0.3"], ["s1", "A", "X", "r2", 0, 0, "1.7"]])
    with pytest.raises(ValueError, match=r"c\.csv:3"):
        S.load_candidates(p, "entropy", 1.5)
    with pytest.raises(ValueError, match="faltan columnas"):
        S.load_candidates(p, "margin", 1.5)


def test_duplicate_regions_count_once(tmp_path):
    p = _csv(tmp_path, [["s1", "A", "X", "r1", 0, 0, "0.3"], ["s1", "A", "X", "r1", 0, 0, "0.9"]])
    assert len(S.load_candidates(p, "entropy", 1.5)) == 1


def test_cli_end_to_end(tmp_path, capsys):
    rows = [[f"s{i}", "C" if i < 3 else "A", "Y" if i < 3 else "X", f"r{j}", j * 512, 0,
             f"{0.9 - 0.01 * j:.2f}"] for i in range(10) for j in range(8)]
    p = _csv(tmp_path, rows)
    golden = tmp_path / "golden.txt"
    golden.write_text("s9\n")
    out = tmp_path / "lista.csv"
    rc = S.main([str(p), "--hours", "1", "--exclude-slides", str(golden), "-o", str(out)])
    assert rc == 0
    listed = list(csv.DictReader(open(out)))
    assert len(listed) == 40  # 60 min ÷ 1.5
    assert listed[0]["lab"] == "C" and listed[0]["phase"] == "priority"
    assert "s9" not in {r["slide_id"] for r in listed}
    assert float(listed[-1]["cum_minutes"]) == 60.0
    assert "40 regiones" in capsys.readouterr().err


def test_cli_rejects_broken_csv(tmp_path):
    p = _csv(tmp_path, [["s1", "A", "X", "r1", "no-es-numero", 0, "0.3"]])
    assert S.main([str(p)]) == 2
