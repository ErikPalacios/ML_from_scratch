"""Tests de pick_concurrency con fixtures SINTÉTICOS (tests/fixtures/sweep-c*.json).

Los fixtures tienen un SUBCONJUNTO de las claves que escribe `vllm bench serve --save-result` en v0.30.0 con
`--percentile-metrics ttft,tpot,itl,e2el --metric-percentiles 50,95,99 --goodput ttft:1000 tpot:50`: las de la
configuración, las de throughput y las de TTFT, TPOT e ITL, que son las que lee pick_concurrency. Faltan las de
e2el (mean/median/std/p50/p95/p99_e2el_ms), max_output_tokens_per_s, max_concurrent_requests, rtfx y las listas
latencies y queue_times (un valor por request); las de client_queue_time solo aparecen si se piden en
--percentile-metrics. Los números los inventamos para que el codo caiga en ≈ 6 rps (el supuesto del caso): no
son mediciones.
"""

import json  # para fabricar puntos raros
from pathlib import Path  # rutas de los fixtures

import pytest  # runner

from pick_concurrency import SLO, Run, load_run, load_sweep, main, pick, render

FIX = Path(__file__).parent / "fixtures"
SWEEP = sorted(str(p) for p in FIX.glob("sweep-c*.json"))


def test_fixture_has_the_real_vllm_keys():
    data = json.loads((FIX / "sweep-c072.json").read_text())
    for key in ("max_concurrency", "request_rate", "completed", "failed", "request_throughput",
                "output_throughput", "request_goodput", "p95_ttft_ms", "p95_tpot_ms", "p99_itl_ms"):
        assert key in data
    assert data["request_rate"] == "inf"  # así lo escribe vLLM cuando no se fija la tasa


def test_picks_72_the_last_point_before_the_knee():
    slo = SLO()
    choice = pick(load_sweep(SWEEP, slo), slo)
    assert choice.chosen.x == 72
    assert choice.chosen.request_throughput == pytest.approx(6.06, abs=0.01)  # ≈ 6 rps: el supuesto del caso
    assert choice.chosen.request_throughput * 0.7 == pytest.approx(4.24, abs=0.01)  # ≈ 4.2 planeado
    bad = {r.x: why for r, why in choice.verdicts if why}
    assert set(bad) == {80, 96}
    assert any("TTFT" in w for w in bad[80]) and any("TPOT" in w for w in bad[80])
    assert choice.warnings == []


def test_render_shows_capacity_and_goodput():
    slo = SLO()
    out = render(pick(load_sweep(SWEEP, slo), slo), slo, 0.7)
    assert "← elegida" in out
    assert "planeada al 70%: 4.24 req/s" in out
    assert "goodput: 95% de los requests" in out


def test_stricter_slo_moves_the_choice_down():
    slo = SLO(ttft_ms=700, tpot_ms=45)  # un producto más exigente
    assert pick(load_sweep(SWEEP, slo), slo).chosen.x == 48


def test_p99_only_results_are_rejected_with_the_fix():
    # El default de --metric-percentiles es "99": no hay p95 y el script no lo inventa
    with pytest.raises(ValueError, match="--metric-percentiles 50,95,99"):
        load_run(FIX / "p99-only.json", SLO())


def test_p99_only_results_work_if_you_ask_for_p99():
    _, run = load_run(FIX / "p99-only.json", SLO(percentile=99))
    assert run.ttft_ms == pytest.approx(1161.0)  # 860 × 1.35 en el generador del fixture


def _run(x, ttft, tpot, completed=1000, failed=0):
    return Run(f"x{x}", x, completed, failed, x / 10, x * 25, ttft, tpot, None)


def test_a_later_passing_point_is_treated_as_noise():
    runs = [_run(16, 300, 30), _run(32, 1200, 40), _run(48, 900, 45)]  # 32 falla, 48 "cumple"
    choice = pick(runs, SLO())
    assert choice.chosen.x == 16
    assert any("repite esos puntos" in w for w in choice.warnings)


def test_failed_requests_disqualify_a_point():
    choice = pick([_run(16, 300, 30), _run(32, 400, 35, completed=990, failed=10)], SLO())
    assert choice.chosen.x == 16
    assert "10 de 1000 requests fallaron" in choice.verdicts[1][1]


def test_too_few_requests_and_unfinished_sweep_warn():
    choice = pick([_run(16, 300, 30, completed=120), _run(32, 400, 35)], SLO())
    assert choice.chosen.x == 32
    assert any("ruido" in w for w in choice.warnings)
    assert any("extiende el barrido" in w for w in choice.warnings)


def test_nothing_passes():
    choice = pick([_run(16, 1500, 30)], SLO())
    assert choice.chosen is None
    assert "ningún punto cumple" in render(choice, SLO(), 0.7)


def test_mixed_sweeps_are_rejected(tmp_path):
    a = json.loads((FIX / "sweep-c016.json").read_text())
    b = dict(a, max_concurrency=None, request_rate=4.2)  # un punto de barrido abierto
    (tmp_path / "a.json").write_text(json.dumps(a))
    (tmp_path / "b.json").write_text(json.dumps(b))
    with pytest.raises(ValueError, match="mezcla"):
        load_sweep([str(tmp_path / "a.json"), str(tmp_path / "b.json")], SLO())


def test_cli_exit_codes(capsys):
    assert main(SWEEP) == 0
    assert "x=72" in capsys.readouterr().out
    assert main([str(FIX / "p99-only.json")]) == 2  # entrada inválida
    assert main(SWEEP + ["--ttft-ms", "100"]) == 1  # ningún punto cumple
