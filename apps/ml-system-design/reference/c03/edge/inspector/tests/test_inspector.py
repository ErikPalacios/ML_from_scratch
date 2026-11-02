"""Tests del inspector SIN cámara, GPU ni PLC físico (caso c03).

Cómo se prueba un sistema de tiempo real sin esperar tiempo real: un reloj falso (FakeClock) que
los componentes falsos avanzan a mano. Una "inferencia de 400 ms" dura microsegundos en el test y
el inspector ve exactamente 400 ms. El PLC se prueba dos veces: con un doble (FakePLC) para la
lógica y con un servidor Modbus TCP REAL de pymodbus en localhost para el protocolo.
Correr (desde edge/inspector):  pip install -r requirements.txt pytest==9.1.1 && pytest -q tests
"""

import asyncio  # el servidor Modbus de pymodbus es asyncio: corre en su propio hilo con su loop
import datetime as dt  # inicio de turno: vencimiento del golden check
import math  # NaN, el score que un fail-safe mal hecho dejaría pasar
import socket  # puertos libres para el servidor Modbus y /metrics
import struct  # tramas Modbus TCP a mano para el PLC que resetea la conexión
import sys  # para importar app.py y decision.py desde la carpeta de arriba
import threading  # main() de punta a punta corre en un hilo mientras el test lee /metrics
import time  # esperas cortas en el test de punta a punta
import urllib.request  # GET /metrics como lo haría Prometheus
from pathlib import Path  # rutas relativas a este archivo: los tests corren desde cualquier cwd

import numpy as np  # imágenes falsas
import pytest
import yaml  # variantes inválidas de config.yaml
from prometheus_client import CollectorRegistry, generate_latest  # leer las métricas expuestas
from prometheus_client.parser import text_string_to_metric_families  # parsear el formato de texto

HERE = Path(__file__).resolve().parent  # edge/inspector/tests
sys.path.insert(0, str(HERE.parent))  # app.py y decision.py se importan igual que en el contenedor

import app  # noqa: E402  (después de ajustar sys.path)
from app import (  # noqa: E402
    DIVERT, CameraTimeout, GoldenCheckRequest, Inspector, ModbusPLC, PLCConfig, PLCError, Trigger,
    load_config)
from decision import PASS, REJECT, InvalidScores, Thresholds, decide  # noqa: E402

CONFIG = HERE.parent / "config.yaml"  # la config real del repo: si alguien la rompe, falla aquí
GOOD = {"anomaly_score": 0.20, "defects": {"crack": 0.01, "burr": 0.02, "missing_hole": 0.0, "deformation": 0.03}}
CRACK = {"anomaly_score": 0.30, "defects": {"crack": 0.93, "burr": 0.02, "missing_hole": 0.0, "deformation": 0.03}}


# ---------------------------------------------------------------------------- dobles de prueba
class FakeClock:
    """Reloj monotónico controlado por el test."""

    def __init__(self, t: float = 1000.0):
        self.t = t

    def __call__(self) -> float:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += seconds


class FakeCamera:
    """Cámara que "tarda" delay_s en el reloj falso. fail: None | 'timeout' | 'error' | 'incomplete'."""

    def __init__(self, clock, delay_s=0.05, fail=None, brightness=120):
        self.clock, self.delay_s, self.fail = clock, delay_s, fail
        self.brightness = brightness  # 120 = gris medio; 5 = estrobo que no disparó
        self.timeouts = []  # qué timeout pidió el inspector en cada grab

    def grab(self, timeout_s):
        self.timeouts.append(timeout_s)
        if self.fail == "timeout":
            self.clock.advance(timeout_s)  # esperó todo el timeout y no llegó nada
            raise CameraTimeout("sin frame")
        if self.fail == "error":
            raise OSError("GVSP: stream perdido")
        if self.fail == "incomplete":  # la regla del contrato: un buffer incompleto LANZA
            self.clock.advance(self.delay_s)
            raise app.IncompleteFrame("status MISSING_PACKETS: 37 paquetes GVSP perdidos")
        self.clock.advance(self.delay_s)
        return np.full((2048, 2448), self.brightness, dtype=np.uint8)  # 5 MP mono


class FakeEngine:
    """Modelo que tarda delay_s. `script`: scores a devolver en orden (el último se repite)."""

    def __init__(self, clock, delay_s=0.10, script=(GOOD,), error=False):
        self.clock, self.delay_s, self.script, self.error = clock, delay_s, list(script), error
        self.calls = 0

    def infer(self, image):
        self.calls += 1
        self.clock.advance(self.delay_s)
        if self.error:
            raise RuntimeError("CUDA error: an illegal memory access was encountered")
        return self.script.pop(0) if len(self.script) > 1 else self.script[0]


class FakePLC:
    """PLC que tarda delay_s y guarda cada escritura."""

    def __init__(self, clock, delay_s=0.003, fail=False):
        self.clock, self.delay_s, self.fail = clock, delay_s, fail
        self.writes = []

    def write(self, part_id, decision, timeout_s):
        self.clock.advance(self.delay_s)
        if self.fail:
            raise PLCError("Modbus: No response received")
        self.writes.append((part_id, decision, timeout_s))

    def close(self):
        pass


@pytest.fixture
def cfg():
    return load_config(str(CONFIG))


def make(cfg, *, camera=None, engine=None, plc=None, golden_ok=True):
    """Inspector con dobles y reloj falso. golden_ok=True: el golden check ya pasó (compuerta abierta)."""
    clock = FakeClock()
    camera = camera or FakeCamera(clock)
    engine = engine or FakeEngine(clock)
    plc = plc or FakePLC(clock)
    for part in (camera, engine, plc):
        if hasattr(part, "clock"):
            part.clock = clock  # todos comparten el mismo reloj
    records = []
    registry = CollectorRegistry()
    insp = Inspector(cfg, camera, engine, plc, clock=clock, registry=registry, emit=records.append)
    insp.golden_ok = golden_ok
    return insp, clock, camera, engine, plc, records, registry


def metric(registry, name, **labels):
    """Valor de una muestra de métrica en el registro (None si no existe)."""
    return registry.get_sample_value(name, labels or None)


# ---------------------------------------------------------------------------- decision.py (lógica pura)
TH = Thresholds(anomaly=0.62, defects={"crack": 0.5, "burr": 0.55, "missing_hole": 0.45, "deformation": 0.6})


def test_pass_when_every_score_is_below_its_threshold():
    d = decide(GOOD, TH)
    assert d.decision == PASS and d.reason == "ok"


def test_reject_by_defect_type_and_by_anomaly_with_reasons():
    assert decide(CRACK, TH).reasons == ("defect:crack",)
    both = {"anomaly_score": 0.9, "defects": dict(CRACK["defects"], burr=0.7)}
    d = decide(both, TH)
    assert d.decision == REJECT and d.reason == "anomaly+defect:burr+defect:crack"


def test_score_equal_to_threshold_is_reject():
    # El mismo ">=" que usa tools/choose_threshold.py para medir recall
    assert decide({"anomaly_score": 0.62, "defects": GOOD["defects"]}, TH).decision == REJECT


@pytest.mark.parametrize("bad", [math.nan, math.inf, -0.1, 1.5, True, np.bool_(True), "0.3", None,
                                 np.float32("nan")])
def test_invalid_anomaly_score_raises_instead_of_passing(bad):
    # NaN >= 0.62 es False: sin la validación, un NaN sería PASS
    with pytest.raises(InvalidScores):
        decide({"anomaly_score": bad, "defects": GOOD["defects"]}, TH)


def test_numpy_float32_scores_are_valid(cfg):
    # Lo que devuelve con naturalidad un wrapper de TensorRT: out.max() es np.float32, no float.
    # Rechazarlo haría fallar el primer golden check en el hardware real y desviaría todo.
    f32 = {"anomaly_score": np.float32(0.41),
           "defects": {k: np.float32(v) for k, v in GOOD["defects"].items()}}
    assert decide(f32, TH).decision == PASS
    insp, clock, *_ = make(cfg, engine=FakeEngine(None, script=(f32,)))
    rec = insp.inspect(Trigger(20, clock()))
    assert rec["decision"] == PASS and rec["scores"]["anomaly"] == 0.41


def test_missing_defect_score_is_invalid_not_zero():
    scores = {"anomaly_score": 0.1, "defects": {"crack": 0.1, "burr": 0.1, "deformation": 0.1}}
    with pytest.raises(InvalidScores, match="missing_hole"):
        decide(scores, TH)


def test_anomaly_only_mode_ignores_classifier_scores():
    # Al arrancar el proyecto no hay clasificador: defects vacío, decide solo la anomalía
    th = Thresholds(anomaly=0.62)
    assert decide({"anomaly_score": 0.3}, th).decision == PASS
    assert decide({"anomaly_score": 0.7, "defects": {"crack": 0.99}}, th).reasons == ("anomaly",)


@pytest.mark.parametrize("bad", [0, 1.2, -0.5, "0.5"])
def test_threshold_out_of_range_is_rejected_at_load(bad):
    with pytest.raises(ValueError):
        Thresholds(anomaly=bad)


# ---------------------------------------------------------------------------- inspector: camino feliz
def test_pass_writes_plc_and_logs_one_json_record(cfg):
    insp, clock, cam, eng, plc, records, reg = make(cfg)
    rec = insp.inspect(Trigger(part_id=42, t_trigger=clock()))
    assert rec["decision"] == PASS and rec["reason"] == "ok"
    assert plc.writes[0][:2] == (42, PASS)
    # 50 ms foto + 100 ms modelo + 3 ms PLC
    assert rec["latency_ms"] == pytest.approx(153.0)
    for key in ("part_id", "line", "model_version", "scores", "decision", "latency_ms", "reason"):
        assert key in rec
    assert rec["line"] == "L1" and rec["scores"]["anomaly"] == 0.2
    assert cam.timeouts[0] == pytest.approx(0.35 - 0.05 - 0.14)  # deadline − reserva PLC − inferencia
    assert records == [rec]


def test_reject_is_written_with_its_reason(cfg):
    insp, clock, _, _, plc, _, reg = make(cfg, engine=FakeEngine(None, script=(CRACK,)))
    rec = insp.inspect(Trigger(7, clock()))
    assert (rec["decision"], rec["reason"]) == (REJECT, "defect:crack")
    assert plc.writes[0][1] == REJECT
    assert metric(reg, "inspection_decisions_total", line="L1", decision="REJECT") == 1


# ---------------------------------------------------------------------------- fail-safe: tiempo
def test_slow_inference_misses_deadline_and_diverts_without_late_write(cfg):
    insp, clock, _, _, plc, _, reg = make(cfg, engine=FakeEngine(None, delay_s=0.40))
    rec = insp.inspect(Trigger(1, clock()))
    assert (rec["decision"], rec["reason"]) == (DIVERT, "deadline")
    assert rec["model_decision"] == PASS  # el modelo sí dijo PASS, pero tarde
    assert plc.writes == []  # sin tiempo no se escribe: el PLC desvía por default
    assert metric(reg, "inspection_deadline_miss_total", line="L1") == 1
    assert rec["latency_ms"] == pytest.approx(450.0)


def test_slow_acquisition_skips_inference_and_diverts(cfg):
    insp, clock, _, eng, plc, _, reg = make(cfg, camera=FakeCamera(None, delay_s=0.20))
    rec = insp.inspect(Trigger(2, clock()))
    assert (rec["decision"], rec["reason"]) == (DIVERT, "deadline")
    assert eng.calls == 0  # no se gasta GPU en una pieza que ya no alcanza
    assert plc.writes[0][1] == DIVERT  # quedaba tiempo para escribir el DIVERT
    assert metric(reg, "inspection_deadline_miss_total", line="L1") == 1


def test_late_trigger_still_consumes_its_frame(cfg):
    insp, clock, cam, eng, _, _, _ = make(cfg)
    trig = Trigger(3, clock() - 0.5)  # llegó con el presupuesto vencido (loop atrasado)
    rec = insp.inspect(trig)
    assert rec["decision"] == DIVERT
    assert len(cam.timeouts) == 1 and cam.timeouts[0] == app.MIN_GRAB_TIMEOUT_S  # 1 trigger = 1 frame
    assert eng.calls == 0


def test_camera_timeout_diverts_and_counts_as_deadline_miss(cfg):
    insp, clock, _, _, plc, _, reg = make(cfg, camera=FakeCamera(None, fail="timeout"))
    rec = insp.inspect(Trigger(4, clock()))
    assert (rec["decision"], rec["reason"]) == (DIVERT, "camera_timeout")
    assert plc.writes[0][1] == DIVERT
    assert metric(reg, "inspection_deadline_miss_total", line="L1") == 1


def test_late_plc_write_is_logged_as_divert(cfg):
    # Modelo a los 280 ms, escritura de 80 ms: termina a los 360 ms, después del deadline
    insp, clock, _, _, _, _, _ = make(cfg, engine=FakeEngine(None, delay_s=0.23),
                                      plc=FakePLC(None, delay_s=0.08))
    rec = insp.inspect(Trigger(5, clock()))
    assert (rec["decision"], rec["reason"]) == (DIVERT, "deadline")


def test_crossing_the_write_reserve_after_the_model_is_logged_as_divert(cfg):
    # El modelo termina con 50.5 ms libres (pasa el chequeo de la reserva de 50 ms) y el log del
    # golden gate consume 1 ms: ya no se escribe nada, el PLC la desvía y el registro debe decirlo
    class SlowGate(Inspector):
        def _gate_reason(self):
            self.clock.advance(0.001)
            return super()._gate_reason()

    clock = FakeClock()
    plc, records, reg = FakePLC(clock), [], CollectorRegistry()
    insp = SlowGate(cfg, FakeCamera(clock), FakeEngine(clock, delay_s=0.35 - 0.05 - 0.0505), plc,
                    clock=clock, registry=reg, emit=records.append)
    insp.golden_ok = True
    rec = insp.inspect(Trigger(22, clock()))
    assert plc.writes == []
    assert (rec["decision"], rec["reason"], rec["model_decision"]) == (DIVERT, "deadline", PASS)
    assert metric(reg, "inspection_deadline_miss_total", line="L1") == 1


# ---------------------------------------------------------------------------- fail-safe: fallas
def test_camera_error_diverts_but_is_not_a_deadline_miss(cfg):
    insp, clock, _, _, _, _, reg = make(cfg, camera=FakeCamera(None, fail="error"))
    rec = insp.inspect(Trigger(6, clock()))
    assert (rec["decision"], rec["reason"]) == (DIVERT, "camera_error")
    assert "GVSP" in rec["error"]
    assert metric(reg, "inspection_deadline_miss_total", line="L1") == 0


def test_incomplete_frame_is_camera_error_never_a_partial_image(cfg):
    # Paquetes GVSP perdidos: las filas que faltan pueden traer otra pieza. grab() lanza, no infiere
    insp, clock, _, eng, plc, _, _ = make(cfg, camera=FakeCamera(None, fail="incomplete"))
    rec = insp.inspect(Trigger(21, clock()))
    assert (rec["decision"], rec["reason"]) == (DIVERT, "camera_error")
    assert "MISSING_PACKETS" in rec["error"] and eng.calls == 0 and plc.writes[0][1] == DIVERT


@pytest.mark.parametrize("frame", [None, np.zeros(2048 * 2448, dtype=np.uint8)])  # sin imagen, buffer 1-D
def test_malformed_frame_diverts_instead_of_crashing_the_loop(cfg, frame):
    class OddCamera(FakeCamera):
        def grab(self, timeout_s):
            super().grab(timeout_s)
            return frame

    insp, clock, _, eng, plc, _, _ = make(cfg, camera=OddCamera(None))
    rec = insp.inspect(Trigger(23, clock()))  # antes: TypeError/IndexError fuera de inspect → crash
    assert (rec["decision"], rec["reason"]) == (DIVERT, "bad_image")
    assert eng.calls == 0 and plc.writes[0][1] == DIVERT


def test_unexpected_bug_is_divert_internal_error_not_a_crash(cfg):
    class Buggy(Inspector):
        def _gate_reason(self):
            raise RuntimeError("bug que nadie previó")

    clock = FakeClock()
    plc = FakePLC(clock)
    insp = Buggy(cfg, FakeCamera(clock), FakeEngine(clock), plc, clock=clock,
                 registry=CollectorRegistry(), emit=lambda r: None)
    rec = insp.inspect(Trigger(24, clock()))
    assert (rec["decision"], rec["reason"]) == (DIVERT, "internal_error") and plc.writes[0][1] == DIVERT


def test_dark_image_diverts_without_inference(cfg):
    # Estrobo que no disparó: un clasificador podría no ver defectos en una foto negra y dar PASS
    insp, clock, _, eng, plc, _, reg = make(cfg, camera=FakeCamera(None, brightness=5))
    rec = insp.inspect(Trigger(17, clock()))
    assert (rec["decision"], rec["reason"]) == (DIVERT, "bad_image")
    assert eng.calls == 0 and plc.writes[0][1] == DIVERT
    assert metric(reg, "inspection_deadline_miss_total", line="L1") == 0


def test_engine_error_diverts(cfg):
    insp, clock, _, _, plc, _, reg = make(cfg, engine=FakeEngine(None, error=True))
    rec = insp.inspect(Trigger(8, clock()))
    assert (rec["decision"], rec["reason"]) == (DIVERT, "engine_error")
    assert rec["scores"] is None and plc.writes[0][1] == DIVERT
    assert metric(reg, "inspection_decisions_total", line="L1", decision="DIVERT") == 1


def test_twenty_engine_errors_in_a_row_exit_for_a_fresh_cuda_context(cfg):
    insp, clock, _, eng, _, records, reg = make(cfg, engine=FakeEngine(None, error=True))
    exits = []
    insp.exit_process = exits.append  # en producción, os._exit(4)
    n = app.MAX_ENGINE_ERRORS_IN_A_ROW
    for i in range(n - 1):
        insp.inspect(Trigger(100 + i, clock()))
    eng.error = False
    insp.inspect(Trigger(200, clock()))  # una inferencia buena reinicia la cuenta: fue un error suelto
    eng.error = True
    for i in range(n - 1):
        insp.inspect(Trigger(300 + i, clock()))
    assert exits == []
    insp.inspect(Trigger(400, clock()))  # el 20.º seguido: error pegajoso de CUDA, hace falta otro proceso
    assert exits == [4] and records[-1]["event"] == "engine_error_exit"
    assert metric(reg, "inspection_divert_total", line="L1", reason="engine_error") == 2 * n - 1


def test_nan_score_diverts_never_passes(cfg):
    nan = {"anomaly_score": float("nan"), "defects": GOOD["defects"]}
    insp, clock, _, _, _, _, reg = make(cfg, engine=FakeEngine(None, script=(nan,)))
    rec = insp.inspect(Trigger(9, clock()))
    assert (rec["decision"], rec["reason"]) == (DIVERT, "invalid_scores")
    assert metric(reg, "inspection_anomaly_score_count", line="L1") == 0  # un NaN no ensucia el histograma


def test_plc_error_is_counted_and_part_is_diverted(cfg):
    insp, clock, _, _, _, _, reg = make(cfg, plc=FakePLC(None, fail=True))
    rec = insp.inspect(Trigger(10, clock()))
    assert (rec["decision"], rec["reason"], rec["model_decision"]) == (DIVERT, "plc_error", PASS)
    assert metric(reg, "plc_write_errors_total", line="L1") == 1


# ---------------------------------------------------------------------------- golden check
def test_no_pass_before_golden_check_but_reject_still_rejects(cfg):
    insp, clock, _, eng, _, _, _ = make(cfg, engine=FakeEngine(None, script=(GOOD, CRACK)), golden_ok=None)
    assert insp.inspect(Trigger(11, clock()))["reason"] == "golden_pending"
    assert insp.inspect(Trigger(12, clock()))["decision"] == REJECT


def test_golden_check_passes_opens_gate_and_sets_gauge(cfg):
    bad = {"anomaly_score": 0.91, "defects": GOOD["defects"]}
    script = [GOOD, GOOD, bad, bad, bad, bad, GOOD]  # 2 buenas + 4 malas del config, luego producción
    insp, clock, _, _, plc, records, reg = make(cfg, engine=FakeEngine(None, script=script), golden_ok=None)
    assert insp.golden_check() is True
    assert metric(reg, "golden_part_check_ok", line="L1") == 1
    assert plc.writes == []  # en modo golden no se escribe al PLC
    assert metric(reg, "inspection_decisions_total", line="L1", decision="PASS") == 0  # no cuenta como producción
    assert records[-1]["event"] == "golden_check" and len(records[-1]["results"]) == 6
    assert insp.inspect(Trigger(13, clock()))["decision"] == PASS


def at(text):
    return dt.datetime.strptime(text, "%Y-%m-%d %H:%M")


@pytest.mark.parametrize("approved, expires", [
    ("2026-09-29 05:50", "2026-09-29 14:00"),  # 10 min antes del turno de 06:00: cuenta para ESE turno
    ("2026-09-29 06:10", "2026-09-29 14:00"),
    ("2026-09-29 13:45", "2026-09-30 06:00"),  # 15 min antes del turno de 14:00: cuenta para ese
    ("2026-09-29 22:30", "2026-09-30 06:00"),  # línea parada: el turno de la mañana corre el suyo
])
def test_approval_expires_at_the_next_shift_start(approved, expires):
    assert app.approval_expiry(at(approved), (dt.time(6, 0), dt.time(14, 0)), 30) == at(expires)


def test_golden_check_before_the_shift_covers_the_whole_shift(cfg):
    # Con "8 h desde el check", un check a las 05:50 vencería a las 13:50 y los últimos 10 min del
    # turno (≈ 1,200 piezas) irían a inspección manual. Vence al iniciar el turno siguiente.
    bad = {"anomaly_score": 0.91, "defects": GOOD["defects"]}
    insp, clock, _, _, _, records, reg = make(
        cfg, engine=FakeEngine(None, script=[GOOD, GOOD, bad, bad, bad, bad, GOOD]), golden_ok=None)
    t0 = clock()
    insp.wall_clock = lambda: at("2026-09-29 05:50") + dt.timedelta(seconds=clock() - t0)
    assert insp.golden_check() is True
    assert records[-1]["valid_until"] == "2026-09-29T14:00"
    clock.advance(8.1 * 3600)  # 13:56: más de 8 h después del check, mismo turno → sigue aprobado
    assert insp.inspect(Trigger(18, clock()))["decision"] == PASS
    clock.advance(0.1 * 3600)  # 14:02: empezó el turno siguiente
    assert insp.inspect(Trigger(19, clock()))["reason"] == "golden_pending"
    assert metric(reg, "golden_part_check_ok", line="L1") == 0
    assert any(r["event"] == "golden_expired" for r in records)


def test_golden_good_part_too_close_to_threshold_fails_check(cfg):
    # 0.55 < 0.62 (sería PASS), pero > 0.62 − 0.15: la iluminación o el foco se movieron
    close = {"anomaly_score": 0.55, "defects": GOOD["defects"]}
    bad = {"anomaly_score": 0.91, "defects": GOOD["defects"]}
    script = [close, GOOD, bad, bad, bad, bad, GOOD]
    insp, clock, _, _, _, records, reg = make(cfg, engine=FakeEngine(None, script=script), golden_ok=None)
    assert insp.golden_check() is False
    assert metric(reg, "golden_part_check_ok", line="L1") == 0
    assert records[-1]["results"][0]["ok"] is False
    assert insp.inspect(Trigger(14, clock()))["reason"] == "golden_failed"


def test_golden_check_request_in_the_queue_runs_the_check(cfg):
    import queue

    bad = {"anomaly_score": 0.91, "defects": GOOD["defects"]}
    insp, clock, _, _, _, records, reg = make(
        cfg, engine=FakeEngine(None, script=[GOOD, GOOD, bad, bad, bad, bad, GOOD]), golden_ok=None)
    events = queue.Queue()
    events.put(GoldenCheckRequest())  # el botón del HMI
    # Un trigger encolado ANTES del check: cuando le toca, el check ya consumió ≈ 0.9 s del reloj.
    # Vence y se desvía. En planta no pasa porque en modo golden el PLC no emite triggers de producción.
    events.put(Trigger(15, clock()))
    assert insp.run(events, threading.Event(), max_parts=1) == 1
    assert [r["event"] for r in records] == ["golden_check", "decision"]
    assert insp.golden_ok is True and metric(reg, "golden_part_check_ok", line="L1") == 1
    assert (records[-1]["decision"], records[-1]["reason"]) == (DIVERT, "deadline")


# ---------------------------------------------------------------------------- métricas y config
def test_all_metrics_are_exported_with_line_label(cfg):
    insp, clock, _, _, _, _, reg = make(cfg)
    insp.inspect(Trigger(16, clock()))
    families = {f.name: f for f in text_string_to_metric_families(generate_latest(reg).decode())}
    # El parser quita el sufijo _total de los counters: inspection_decisions_total → inspection_decisions
    for name in ("inspection_decisions", "inspection_latency_seconds", "inspection_deadline_miss",
                 "inspection_divert", "inspection_anomaly_score", "golden_part_check_ok", "plc_write_errors"):
        assert name in families, name
        assert all(s.labels.get("line") == "L1" for s in families[name].samples)
    # Las 3 decisiones existen desde el arranque (en 0): rate() y las alertas funcionan antes del primer REJECT
    assert metric(reg, "inspection_decisions_total", line="L1", decision="REJECT") == 0
    assert metric(reg, "inspection_latency_seconds_bucket", line="L1", le="0.35") == 1


def test_every_divert_is_counted_by_reason(cfg):
    # Estrobo muerto: todas las fotos negras. Sin la razón en una métrica, la línea entera va a
    # inspección manual en silencio (el loop avanza, el golden check ya pasó, no hay REJECTs)
    insp, clock, _, _, _, _, reg = make(cfg, camera=FakeCamera(None, brightness=5))
    for i in range(3):
        insp.inspect(Trigger(30 + i, clock()))
    assert metric(reg, "inspection_divert_total", line="L1", reason="bad_image") == 3
    # Las 10 razones existen en 0 desde el arranque: una alerta por razón funciona antes del primer DIVERT
    assert [metric(reg, "inspection_divert_total", line="L1", reason=r) for r in app.DIVERT_REASONS] == \
        [0, 0, 0, 3, 0, 0, 0, 0, 0, 0]


def test_repo_config_loads_with_case_numbers(cfg):
    assert cfg.line_id == "L1" and cfg.deadline_ms == 350
    assert cfg.thresholds.anomaly == 0.62 and set(cfg.thresholds.defects) == {
        "crack", "burr", "missing_hole", "deformation"}
    assert (cfg.plc.port, cfg.plc.register) == (502, 100)


@pytest.mark.parametrize("patch, match", [
    ({"fail_safe": "pass"}, "fail_safe"),
    ({"plc_write_reserve_ms": 30}, "2 × plc.timeout_ms"),
    ({"min_inference_budget_ms": 300}, "deadline_ms"),
    ({"golden": {"parts": [{"name": "G1", "expect": "PASS"}]}}, "PASS y una REJECT"),
    ({"image_check": {"min_mean": 200, "max_mean": 100}}, "image_check"),
    # Sin comillas, PyYAML lee 14:00 como 840 (base 60): mejor no arrancar que vencer a otra hora
    ({"golden": {"parts": [{"name": "G1", "expect": "PASS"}, {"name": "G3", "expect": "REJECT"}],
                 "shift_starts": ["06:00", 840]}}, "entre comillas"),
])
def test_dangerous_config_does_not_start(tmp_path, patch, match):
    raw = yaml.safe_load(CONFIG.read_text(encoding="utf-8"))
    raw.update(patch)
    path = tmp_path / "config.yaml"
    path.write_text(yaml.safe_dump(raw), encoding="utf-8")
    with pytest.raises(ValueError, match=match):
        load_config(str(path))


# ---------------------------------------------------------------------------- PLC real por Modbus TCP
def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
def modbus_server():
    """Un servidor Modbus TCP de verdad (el de pymodbus) haciendo de PLC en localhost."""
    from pymodbus.server import ModbusTcpServer
    from pymodbus.simulator import DataType, SimData, SimDevice

    port = free_port()
    device = SimDevice(id=1, simdata=[SimData(address=0, count=300, datatype=DataType.REGISTERS)])
    loop = asyncio.new_event_loop()
    holder = {}

    async def serve():
        holder["server"] = ModbusTcpServer(device, address=("127.0.0.1", port))
        await holder["server"].serve_forever()

    thread = threading.Thread(target=loop.run_until_complete, args=(serve(),), daemon=True)
    thread.start()
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:  # esperar a que escuche
        try:
            socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
            break
        except OSError:
            time.sleep(0.05)
    yield port
    asyncio.run_coroutine_threadsafe(holder["server"].shutdown(), loop).result(timeout=5)
    thread.join(timeout=5)
    loop.close()


def read_registers(port, address=100, count=2):
    from pymodbus.client import ModbusTcpClient

    client = ModbusTcpClient("127.0.0.1", port=port, timeout=1)
    client.connect()
    try:
        return client.read_holding_registers(address, count=count, device_id=1).registers
    finally:
        client.close()


def test_modbus_plc_writes_part_id_and_code_in_one_request(modbus_server):
    plc = ModbusPLC(PLCConfig(host="127.0.0.1", port=modbus_server, register=100, timeout_ms=200))
    plc.write(70_000, REJECT, timeout_s=1.0)
    assert read_registers(modbus_server) == [70_000 & 0xFFFF, 2]  # 16 bits: 70,000 → 4,464
    plc.write(4_465, PASS, timeout_s=1.0)
    assert read_registers(modbus_server) == [4_465, 1]
    plc.close()


def test_modbus_plc_refuses_a_write_that_cannot_finish_in_time(modbus_server):
    plc = ModbusPLC(PLCConfig(host="127.0.0.1", port=modbus_server, timeout_ms=20))
    with pytest.raises(PLCError, match="sin tiempo"):
        plc.write(1, PASS, timeout_s=0.01)
    plc.close()


def test_modbus_plc_down_raises_plc_error_fast():
    plc = ModbusPLC(PLCConfig(host="127.0.0.1", port=free_port(), timeout_ms=20))  # nadie escucha
    t0 = time.monotonic()
    with pytest.raises(PLCError):
        plc.write(1, PASS, timeout_s=0.05)
    assert time.monotonic() - t0 < 0.5
    plc.close()


def test_modbus_plc_that_never_answers_times_out():
    silent = socket.socket()  # acepta la conexión TCP y nunca responde (PLC colgado)
    silent.bind(("127.0.0.1", 0))
    silent.listen()
    port = silent.getsockname()[1]
    plc = ModbusPLC(PLCConfig(host="127.0.0.1", port=port, timeout_ms=20))
    t0 = time.monotonic()
    with pytest.raises(PLCError, match="Modbus"):
        plc.write(1, PASS, timeout_s=0.05)
    assert time.monotonic() - t0 < 0.5  # retries=0: falla en ≈ 1 timeout, no en 4
    plc.close()
    silent.close()


@pytest.fixture
def resetting_plc():
    """PLC mínimo por Modbus TCP (solo función 16) que puede tirar la conexión con un RST, como
    uno que se reinicia. El servidor de pymodbus solo cierra en orden (FIN); aquí hace falta RST."""
    srv = socket.socket()
    srv.bind(("127.0.0.1", 0))
    srv.listen()
    srv.settimeout(0.05)
    reset, done, stop = threading.Event(), threading.Event(), threading.Event()

    def serve():
        while not stop.is_set():
            try:
                conn, _ = srv.accept()
            except socket.timeout:
                continue
            conn.settimeout(0.02)
            with conn:
                while not stop.is_set():
                    if reset.is_set():  # SO_LINGER 0 + close = RST, no un cierre ordenado
                        conn.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack("ii", 1, 0))
                        reset.clear()
                        done.set()
                        break
                    try:
                        req = conn.recv(260)
                    except socket.timeout:
                        continue
                    if not req:
                        break
                    tid, _, _, unit, fc, addr, qty = struct.unpack(">HHHBBHH", req[:12])
                    conn.sendall(struct.pack(">HHHBBHH", tid, 0, 6, unit, fc, addr, qty))  # eco de FC16

    thread = threading.Thread(target=serve, daemon=True)
    thread.start()

    def do_reset():
        done.clear()
        reset.set()
        assert done.wait(2)

    yield srv.getsockname()[1], do_reset
    stop.set()
    thread.join(timeout=2)
    srv.close()


def test_modbus_plc_reconnects_after_the_plc_resets_the_connection(resetting_plc):
    port, reset = resetting_plc
    plc = ModbusPLC(PLCConfig(host="127.0.0.1", port=port, timeout_ms=200))
    plc.write(1, PASS, timeout_s=1.0)
    reset()  # el PLC se reinicia: la conexión vieja recibe RST
    with pytest.raises(PLCError):  # antes: BrokenPipeError crudo y `connected` seguía en True
        plc.write(2, PASS, timeout_s=1.0)
    plc.write(3, REJECT, timeout_s=1.0)  # reconecta sola, sin reiniciar el contenedor
    plc.close()


def test_inspector_with_real_modbus_plc(cfg, modbus_server):
    clock = FakeClock()
    plc = ModbusPLC(PLCConfig(host="127.0.0.1", port=modbus_server, register=100, timeout_ms=20))
    insp = Inspector(cfg, FakeCamera(clock), FakeEngine(clock, script=(CRACK,)), plc, clock=clock,
                     registry=CollectorRegistry(), emit=lambda r: None)
    insp.golden_ok = True
    assert insp.inspect(Trigger(123, clock()))["decision"] == REJECT
    assert read_registers(modbus_server) == [123, 2]
    plc.close()


# ---------------------------------------------------------------------------- main() de punta a punta
def test_simulated_main_serves_metrics_and_heartbeat(tmp_path):
    raw = yaml.safe_load(CONFIG.read_text(encoding="utf-8"))
    port = free_port()
    raw["metrics"] = {"addr": "127.0.0.1", "port": port}
    raw["heartbeat_file"] = str(tmp_path / "heartbeat")
    path = tmp_path / "config.yaml"
    path.write_text(yaml.safe_dump(raw), encoding="utf-8")
    result = {}
    worker = threading.Thread(target=lambda: result.setdefault("rc", app.main(
        ["--config", str(path), "--simulate", "--max-parts", "8", "--sim-period-ms", "150"])))
    worker.start()
    samples, deadline = {}, time.monotonic() + 15
    while time.monotonic() < deadline:  # leer /metrics MIENTRAS corre, como Prometheus
        try:
            text = urllib.request.urlopen(f"http://127.0.0.1:{port}/metrics", timeout=1).read().decode()
        except OSError:  # todavía no escucha, o ya terminó
            time.sleep(0.1)
            continue
        samples = {(s.name, tuple(sorted(s.labels.items()))): s.value
                   for f in text_string_to_metric_families(text) for s in f.samples}
        if (samples.get(("inspection_decisions_total", (("decision", "PASS"), ("line", "L1")))) or 0) >= 3:
            break
        time.sleep(0.1)
    worker.join(timeout=20)
    assert result.get("rc") == 0
    assert samples[("golden_part_check_ok", (("line", "L1"),))] == 1  # el check simulado pasó
    assert samples[("inspection_decisions_total", (("decision", "PASS"), ("line", "L1")))] >= 3
    assert (tmp_path / "heartbeat").exists()  # lo que mira el healthcheck de docker-compose.yml
