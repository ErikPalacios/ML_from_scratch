"""Tests del job diario de PSI: la fórmula, la agregación por lab/escáner y lo que se empuja."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import stain_psi as P  # noqa: E402


def test_psi_worked_example_from_the_docstring():
    assert P.psi([10, 20, 30, 40], [25, 25, 25, 25]) == pytest.approx(0.2282, abs=1e-4)


def test_psi_is_zero_for_the_same_distribution_and_ignores_scale():
    assert P.psi([1, 2, 3], [100, 200, 300]) == pytest.approx(0.0)


def test_empty_bins_do_not_explode():
    v = P.psi([0, 0, 10, 10], [5, 5, 5, 5])
    assert 0 < v < 20


def _summary(slide, lab, scanner, r, status="ok"):
    return {"slide_id": slide, "lab": lab, "scanner": scanner, "status": status,
            "qc": {"color_hist": {"r": r, "g": [1, 1, 1, 1], "b": [1, 1, 1, 1]}}}


def test_aggregate_by_lab_and_scanner(tmp_path):
    for i, s in enumerate([_summary("s1", "A", "A-X-01", [1, 1, 0, 0]),
                           _summary("s2", "A", "A-X-01", [0, 0, 1, 1]),
                           _summary("s3", "C", "C-Y-01", [0, 0, 0, 4]),
                           _summary("s4", "C", "C-Y-01", [9, 9, 9, 9], status="qc_blocked")]):
        d = tmp_path / s["slide_id"]
        d.mkdir()
        (d / "summary.json").write_text(json.dumps(s))
    summaries = P.load_summaries(tmp_path)
    assert len(summaries) == 3  # el qc_blocked no entra
    agg = P.aggregate(summaries)
    assert agg[("A", "A-X-01")]["r"] == [1, 1, 1, 1] and agg[("A", "A-X-01")]["slides"] == 2
    ref = {"r": [1, 1, 1, 1], "g": [1, 1, 1, 1], "b": [1, 1, 1, 1]}
    rows = {(r["lab"], r["channel"]): r["psi"] for r in P.compute(agg, ref)}
    assert rows[("A", "r")] == 0.0  # A suma exactamente la referencia
    assert rows[("C", "r")] > 0.2  # C concentrado en un bin: drift fuerte


def test_reference_roundtrip_and_cli(tmp_path, capsys):
    train, day = tmp_path / "train", tmp_path / "day"
    train.mkdir()
    day.mkdir()
    for i in range(25):
        (train / f"t{i}.json").write_text(json.dumps(_summary(f"t{i}", "A", "A-X-01", [1, 2, 3, 4])))
        (day / f"d{i}.json").write_text(json.dumps(_summary(f"d{i}", "B", "B-X-01", [4, 3, 2, 1])))
    ref = tmp_path / "ref.json"
    assert P.main(["--summaries", str(train), "--write-reference", str(ref)]) == 0
    assert json.loads(ref.read_text())["slides"] == 25
    assert P.main(["--summaries", str(day), "--reference", str(ref)]) == 0
    out = capsys.readouterr().out
    assert "B-X-01" in out and "> 0.2" in out


def test_push_sends_the_gauges_the_alert_uses():
    sent = {}

    def handler(url, method, timeout, headers, data):
        def do():
            sent.update(url=url, method=method, body=data.decode())
        return do

    P.push([{"lab": "C", "scanner": "C-Y-01", "channel": "r", "slides": 40, "psi": 0.35}],
           "pushgateway:9091", handler=handler)
    assert sent["method"] == "PUT"  # PUT reemplaza el grupo entero: no quedan escáneres viejos
    assert sent["url"].endswith("/metrics/job/stain-psi")
    assert 'seg_stain_psi{channel="r",lab="C",scanner="C-Y-01"} 0.35' in sent["body"]
    assert 'seg_stain_psi_slides{lab="C",scanner="C-Y-01"} 40.0' in sent["body"]
