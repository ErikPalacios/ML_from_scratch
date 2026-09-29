"""Tests del loop del worker: qué pasa con el MENSAJE en cada camino (borrar, devolver, dejar que
reaparezca) y qué queda escrito. La cola y el storage son dobles con semántica de SQS/S3
(conftest.py); al final, una prueba de integración con boto3 contra moto y OpenSlide real."""

from __future__ import annotations

import copy
import json
import re
import time
from pathlib import Path

import numpy as np
import pytest
import yaml

import worker as W
from conftest import BASE_SPEC, ColorThresholdModel

HERE = Path(__file__).resolve().parent


def metric(worker, name, **labels):
    v = worker.registry.get_sample_value(name, labels)
    return v or 0.0


# ---------------------------------------------------------------------------- camino feliz
def test_happy_path_writes_result_then_deletes(env):
    body = env.add_slide(available_at=env.queue.now - 600)  # disponible hace 10 min
    w = env.make_worker()
    w.run(max_receives=1)

    assert env.queue.msgs == {} and len(env.queue.deleted) == 1  # borrado SOLO al final
    s = env.summary()
    assert s["status"] == "ok"
    assert s["tumor_mm2"] == pytest.approx(0.64, rel=0.01)  # 0.8 mm × 0.8 mm
    assert s["tumor_pct_of_tissue"] == pytest.approx(25.0, abs=0.3)  # 0.64 / 2.56
    assert s["tissue_mm2"] == pytest.approx(2.56, rel=0.01)
    assert s["read_plan"] == {"level": 0, "level_mpp": 0.25, "read_px": 1024}
    # Trazabilidad completa en cada resultado
    for k in ("model_version", "container_digest", "training_data_version",
              "preprocessing_config_hash", "input_sha256"):
        assert s[k] and s[k] != "unknown"
    assert s["input_sha256"] == body["sha256"]
    assert s["turnaround_s"] == pytest.approx(600, abs=1)
    # summary.json es la ÚLTIMA escritura: el commit marker
    assert env.storage.writes[-1] == env.summary_key()
    assert set(s["artifacts"].values()) >= {k for k in env.storage.writes[:-1]}
    assert env.index.calls == 1
    # Métricas del contrato con alerts.yml
    assert metric(w, "seg_slides_processed_total", lab="A", scanner="A-X-01", status="ok") == 1
    assert metric(w, "seg_tiles_total", lab="A", scanner="A-X-01") == s["tiles"] > 0
    assert metric(w, "seg_turnaround_seconds_bucket", lab="A", le="900.0") == 1
    assert (Path(env.cfg.work_dir) / "S-0001.svs").exists() is False  # el WSI no queda en el NVMe


def test_geojson_is_in_level0_pixels(env):
    env.add_slide()
    env.make_worker().run(max_receives=1)
    s = env.summary()
    geo = json.loads(env.storage.objects[s["artifacts"]["tumor_geojson"]])
    assert len(geo["features"]) == 1
    ring = np.array(geo["features"][0]["geometry"]["coordinates"][0])
    assert (ring[0] == ring[-1]).all()  # anillo cerrado
    # El tumor está en [1600, 4800) px de nivel 0; el contorno pasa por el centro de los pixeles
    # del borde del mapa (16 px de nivel 0 cada uno): de 1608 a 4792
    assert ring[:, 0].min() == pytest.approx(1608) and ring[:, 0].max() == pytest.approx(4792)
    x, y = ring[:, 0], ring[:, 1]
    area = 0.5 * abs(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1)))
    assert area == pytest.approx(3200**2, rel=0.02)  # ≈ el área de pixeles (−1 % por el borde)


# ---------------------------------------------------------------------------- idempotencia
def test_redelivery_after_commit_is_skipped_without_gpu(env):
    body = env.add_slide()
    w = env.make_worker()
    w.run(max_receives=1)
    calls = env.model.calls
    # El worker murió entre summary.json y DeleteMessage: SQS vuelve a entregar el mismo evento
    env.queue.send(body)
    w.run(max_receives=1)
    assert env.model.calls == calls  # ni un tile a la GPU
    assert metric(w, "seg_slides_processed_total", lab="A", scanner="A-X-01", status="duplicate") == 1
    assert env.queue.msgs == {}
    assert env.index.calls == 2  # el upsert se repite: por si el índice era lo que faltaba


def test_rescan_with_new_sha_replaces_result_atomically(env):
    env.add_slide()
    env.make_worker().run(max_receives=1)
    first = env.summary()
    spec = copy.deepcopy(BASE_SPEC)
    spec["tumors"] = [[1600, 1600, 6400, 4800]]  # reescaneo: otro archivo, otro sha
    env.add_slide(spec)
    env.make_worker().run(max_receives=1)
    second = env.summary()
    assert second["input_sha256"] != first["input_sha256"]
    assert second["tumor_mm2"] > first["tumor_mm2"]
    # Los artefactos de cada corrida viven en su propio prefijo: el summary nuevo apunta a los suyos
    assert second["artifacts"]["heatmap_png"] != first["artifacts"]["heatmap_png"]
    assert first["artifacts"]["heatmap_png"] in env.storage.objects


# ---------------------------------------------------------------------------- errores y DLQ
def test_transient_error_is_retried_with_backoff(env):
    env.add_slide()
    w = env.make_worker(model=ColorThresholdModel(fail_times=1))
    w.run(max_receives=1)
    assert env.queue.deleted == [] and env.storage.objects == {}  # ni borrado ni resultado
    assert env.queue.visibility_calls[-1] == 60  # backoff: vuelve en 60 s, no en 300
    w.run(max_receives=1)
    assert env.queue.msgs  # todavía invisible
    env.queue.advance(61)
    w.run(max_receives=1)
    assert env.summary()["status"] == "ok" and env.summary()["attempt"] == 2
    assert metric(w, "seg_redeliveries_total", lab="A") == 1
    assert metric(w, "seg_slides_processed_total", lab="A", scanner="A-X-01", status="error") == 1


def test_poison_message_ends_in_dlq_after_three_attempts(env):
    env.add_slide()
    w = env.make_worker(model=ColorThresholdModel(fail_times=10**6))
    for _ in range(4):
        w.run(max_receives=1)
        env.queue.advance(3600)
    assert env.queue.msgs == {} and len(env.queue.dlq) == 1  # el 4.º receive lo movió a la DLQ
    assert env.queue.dlq[0]["count"] == 3
    assert env.storage.objects == {}  # nunca hubo un resultado a medias
    assert metric(w, "seg_slides_processed_total", lab="A", scanner="A-X-01", status="error") == 3


def test_bad_message_is_not_deleted(env):
    env.queue.send("esto no es json")
    env.queue.send({"slide_id": "../../etc", "uri": "s3://a/b", "sha256": "0" * 64, "lab": "A",
                    "scanner": "A-X-01"})
    w = env.make_worker()
    w.run(max_receives=2)
    assert len(env.queue.msgs) == 2 and env.queue.deleted == []  # a la DLQ tras 3 entregas
    assert metric(w, "seg_slides_processed_total", lab="unknown", scanner="unknown", status="error") == 2


def test_sha256_mismatch_is_an_integrity_error(env):
    env.add_slide(sha="f" * 64)
    w = env.make_worker()
    w.run(max_receives=1)
    assert env.queue.deleted == [] and env.storage.objects == {} and env.model.calls == 0
    assert metric(w, "seg_qc_flags_total", lab="A", scanner="A-X-01", flag="sha256_mismatch") == 1


def test_nan_from_the_model_is_an_error_not_no_tumor(env):
    env.add_slide()
    nan = ColorThresholdModel(output=lambda b: np.full(b.shape[:3], np.nan, np.float32))
    env.make_worker(model=nan).run(max_receives=1)
    assert env.storage.objects == {} and env.queue.deleted == []


def test_failed_summary_write_leaves_no_result_and_retries(env):
    env.add_slide()
    env.storage.fail_puts.add(env.summary_key())
    w = env.make_worker()
    w.run(max_receives=1)
    # Los artefactos quedaron en su prefijo de corrida, pero SIN summary.json no hay resultado visible
    assert env.summary_key() not in env.storage.objects
    assert any(k.endswith("heatmap.png") for k in env.storage.objects)
    assert env.queue.deleted == []
    env.queue.advance(61)
    w.run(max_receives=1)
    assert env.summary()["status"] == "ok" and env.queue.msgs == {}


# ---------------------------------------------------------------------------- QC
@pytest.mark.parametrize("mutate,scanner,flags", [
    (lambda s: s.update(mpp=None), "A-X-01", ["missing_mpp"]),
    (lambda s: s.update(mpp=[0.5, 0.5]), "A-X-01", ["mpp_mismatch"]),  # el archivo dice 20×
    (lambda s: s.update(mpp=[0.25, 0.3]), "A-X-01", ["anisotropic_mpp"]),
    (lambda s: None, "C-Y-99", ["unknown_scanner"]),
    (lambda s: s.update(downsamples=[1, 4]), "A-X-01", ["no_low_res_level"]),
])
def test_qc_blocks_without_numbers(env, mutate, scanner, flags):
    spec = copy.deepcopy(BASE_SPEC)
    mutate(spec)
    env.add_slide(spec, scanner=scanner, lab="C" if scanner.startswith("C") else "A")
    w = env.make_worker()
    w.run(max_receives=1)
    s = env.summary()
    assert s["status"] == "qc_blocked" and s["qc"]["flags"] == flags
    assert s["tumor_mm2"] is None and s["tumor_pct_of_tissue"] is None  # "sin resultado de IA"
    assert env.model.calls == 0 and env.queue.msgs == {}  # decidido: se borra, no se reintenta
    lab = "C" if scanner.startswith("C") else "A"
    label_scanner = scanner if scanner in env.cfg.scanners else "unknown"
    assert metric(w, "seg_qc_flags_total", lab=lab, scanner=label_scanner, flag=flags[0]) == 1


def test_low_tissue_is_blocked(env):
    spec = copy.deepcopy(BASE_SPEC)
    spec["tissue"], spec["tumors"] = [800, 800, 2800, 2800], []  # 0.5 mm × 0.5 mm = 0.25 mm²
    env.add_slide(spec)
    env.make_worker().run(max_receives=1)
    assert env.summary()["qc"]["flags"] == ["low_tissue"]


def test_qc_blocked_is_reevaluated_after_the_scanner_is_registered(env):
    body = env.add_slide(scanner="C-Y-02", lab="C")
    env.make_worker().run(max_receives=1)
    assert env.summary()["status"] == "qc_blocked"
    env.cfg.scanners["C-Y-02"] = 0.25  # alguien registró y validó el escáner nuevo
    env.queue.send(body)  # re-enviar el evento
    env.make_worker().run(max_receives=1)
    assert env.summary()["status"] == "ok"


def test_blurry_slide_is_flagged_but_not_blocked(env):
    spec = copy.deepcopy(BASE_SPEC)
    spec["texture"] = False  # colores planos: el Laplaciano es ≈ 0 en todos los tiles
    env.add_slide(spec)
    w = env.make_worker()
    w.run(max_receives=1)
    s = env.summary()
    assert s["status"] == "ok" and s["qc"]["flags"] == ["blurry"]
    # No el 100 %: los tiles que cruzan el borde tejido/tumor o tejido/vidrio tienen un borde nítido
    assert s["qc"]["blurry_tile_frac"] > 0.5
    assert metric(w, "seg_blurry_tiles_total", lab="A", scanner="A-X-01") > 0


def test_textured_slide_is_not_blurry(env):
    env.add_slide()
    env.make_worker().run(max_receives=1)
    assert env.summary()["qc"]["blurry_tile_frac"] == 0.0


# ---------------------------------------------------------------------------- SIGTERM y heartbeat
def test_sigterm_mid_slide_returns_the_message_to_the_queue(env):
    env.add_slide()
    w = None

    def stop_on_first_batch(model):
        if model.calls == 1:
            w.request_stop()  # llega SIGTERM mientras la GPU procesa el primer batch

    model = ColorThresholdModel(on_predict=stop_on_first_batch)
    w = env.make_worker(model=model)
    w.run()  # sin max_receives: debe salir solo
    assert model.calls == 1  # abortó en el siguiente punto de control, no al final del slide
    assert env.storage.objects == {} and env.queue.deleted == []
    m = next(iter(env.queue.msgs.values()))
    assert m["visible_at"] == env.queue.now  # visibilidad 0: disponible YA, no en 5 min
    assert metric(w, "seg_slides_processed_total", lab="A", scanner="A-X-01", status="interrupted") == 1
    # Otro worker lo toma de inmediato y termina
    env.make_worker().run(max_receives=1)
    assert env.summary()["status"] == "ok" and env.summary()["attempt"] == 2


def test_sigterm_during_long_poll_does_not_start_a_slide(env):
    env.add_slide()
    w = env.make_worker()
    real_receive = env.queue.receive

    def receive_then_sigterm(wait_s):
        msg = real_receive(wait_s)
        w.request_stop()  # SIGTERM llegó mientras esperábamos
        return msg

    env.queue.receive = receive_then_sigterm
    w.run()
    assert env.model.calls == 0
    assert next(iter(env.queue.msgs.values()))["visible_at"] == env.queue.now


def test_heartbeat_extends_visibility_while_processing(env):
    env.add_slide()
    slow = ColorThresholdModel(on_predict=lambda m: time.sleep(0.03))
    cfg = W.WorkerConfig(**{**env.cfg.__dict__, "heartbeat_s": 0.01})
    env.make_worker(model=slow, cfg=cfg).run(max_receives=1)
    assert env.queue.visibility_calls.count(300) >= 2  # renovó a 300 s varias veces
    assert env.summary()["status"] == "ok"


# ---------------------------------------------------------------------------- contrato de métricas
def test_every_seg_metric_in_alerts_exists_in_the_worker(env):
    alerts = (HERE / ".." / ".." / "monitoring" / "alerts.yml").resolve()
    rules = yaml.safe_load(alerts.read_text())
    exprs = " ".join(r["expr"] for g in rules["groups"] for r in g["rules"])
    used = set(re.findall(r"\b(seg_[a-z_]+)", exprs))
    assert {"seg_turnaround_seconds_bucket", "seg_slides_processed_total", "seg_qc_flags_total",
            "seg_blurry_tiles_total", "seg_blur_checked_tiles_total"} <= used
    w = env.make_worker()
    exposed = set()
    for fam in w.registry.collect():
        exposed.add(fam.name)
        exposed.update({fam.name + s for s in ("_total", "_bucket", "_count", "_sum")})
    # seg_stain_psi* las expone el job diario de PSI, no el worker
    missing = {m for m in used if m not in exposed and not m.startswith("seg_stain_psi")}
    assert not missing, f"alerts.yml usa métricas que el worker no expone: {missing}"


# ---------------------------------------------------------------------------- integración real
def _write_svs(path: Path, mpp: float | None):
    """SVS sintético con la estructura de Aperio (3 niveles 1/4/16) escrito con tifffile."""
    tifffile = pytest.importorskip("tifffile")
    H, Wd = 4096, 6144
    img = np.full((H, Wd, 3), 240, np.uint8)
    img[1024:3072, 1024:5120] = (220, 150, 190)
    img[1536:2560, 2048:3072] = (120, 60, 140)
    yy, xx = np.mgrid[1024:3072, 1024:5120]
    img[1024:3072, 1024:5120, 0] += (((xx // 2) * 7 + (yy // 2) * 13) % 9 * 3).astype(np.uint8)
    desc = f"Aperio Image Library v12.0.0\r\n{Wd}x{H} [0,0 {Wd}x{H}] (256x256) RAW/RGB|AppMag = 40"
    if mpp is not None:
        desc += f"|MPP = {mpp:.4f}"
    with tifffile.TiffWriter(path) as tw:
        tw.write(img, tile=(256, 256), photometric="rgb", description=desc, metadata=None)
        for f in (4, 16):
            small = img.reshape(H // f, f, Wd // f, f, 3).mean(axis=(1, 3)).astype(np.uint8)
            tw.write(small, tile=(256, 256), photometric="rgb", metadata=None,
                     description=f"Aperio Image Library v12.0.0\r\n{Wd}x{H} -> {Wd // f}x{H // f}")


def test_openslide_reader_on_a_real_svs(tmp_path):
    pytest.importorskip("openslide")
    p = tmp_path / "s.svs"
    _write_svs(p, 0.25)
    s = W.OpenSlideReader().open(p)
    assert s.mpp == (0.25, 0.25) and s.level_downsamples == (1.0, 4.0, 16.0)
    px = s.read_region(2100, 1600, 0, 4, 4)[0, 0].tolist()
    assert px[1:] == [60, 140] and 120 <= px[0] <= 144  # tumor (+ la textura del canal R)
    assert (s.read_region(6100, 4000, 0, 100, 100)[-1, -1] == 255).all()  # fuera del escaneo = blanco
    s.close()
    _write_svs(p, None)
    s = W.OpenSlideReader().open(p)
    assert s.mpp == (None, None)  # sin "MPP =" no hay mpp: el worker lo bloquea (missing_mpp)
    s.close()


def test_end_to_end_with_boto3_moto_and_openslide(tmp_path):
    """SQS + S3 (moto) + OpenSlide real + el loop real. Solo el modelo es falso."""
    pytest.importorskip("openslide")
    moto = pytest.importorskip("moto")
    import boto3
    import hashlib

    svs = tmp_path / "S-9.svs"
    _write_svs(svs, 0.25)
    data = svs.read_bytes()
    with moto.mock_aws():
        s3 = boto3.client("s3", region_name="us-east-1")
        sqs = boto3.client("sqs", region_name="us-east-1")
        for b in ("archive", "results"):
            s3.create_bucket(Bucket=b)
        s3.put_object(Bucket="archive", Key="lab-a/S-9.svs", Body=data)
        dlq = sqs.create_queue(QueueName="slide-jobs-dlq")["QueueUrl"]
        arn = sqs.get_queue_attributes(QueueUrl=dlq, AttributeNames=["QueueArn"])["Attributes"]["QueueArn"]
        url = sqs.create_queue(QueueName="slide-jobs", Attributes={
            "VisibilityTimeout": "300",
            "RedrivePolicy": json.dumps({"deadLetterTargetArn": arn, "maxReceiveCount": "3"})})["QueueUrl"]
        msg = {"slide_id": "S-9", "uri": "s3://archive/lab-a/S-9.svs",
               "sha256": hashlib.sha256(data).hexdigest(), "lab": "A", "scanner": "A-X-01"}
        cfg = W.WorkerConfig(model_version="2026-09-01-unet-fp16", work_dir=tmp_path / "scratch",
                             receive_wait_s=0, retry_backoff_s=0, scanners={"A-X-01": 0.25},
                             min_tissue_mm2=0.1)

        def make(model):
            return W.Worker(W.SqsQueue(sqs, url), W.S3Storage(s3, "results"), W.OpenSlideReader(),
                            model, cfg)

        # 1) camino feliz: resultado en S3 y mensaje borrado
        sqs.send_message(QueueUrl=url, MessageBody=json.dumps(msg))
        make(ColorThresholdModel()).run(max_receives=1)
        s = json.loads(s3.get_object(Bucket="results",
                                     Key="results/S-9/2026-09-01-unet-fp16/summary.json")["Body"].read())
        assert s["status"] == "ok"
        assert s["tumor_mm2"] == pytest.approx(0.0655, rel=0.02)  # (1024 px × 0.25 µm = 0.256 mm)² ≈ 0.0655 mm²
        assert s["tumor_pct_of_tissue"] == pytest.approx(12.5, abs=0.3)  # 1024² / (2048 × 4096)
        attrs = sqs.get_queue_attributes(QueueUrl=url, AttributeNames=["All"])["Attributes"]
        assert attrs["ApproximateNumberOfMessages"] == "0" and attrs["ApproximateNumberOfMessagesNotVisible"] == "0"

        # 2) un slide que siempre falla termina en la DLQ tras 3 entregas (redrive de la cola)
        sqs.send_message(QueueUrl=url, MessageBody=json.dumps({**msg, "slide_id": "S-10"}))
        broken = make(ColorThresholdModel(fail_times=10**6))
        broken.run(max_receives=4)
        dl = sqs.receive_message(QueueUrl=dlq, MessageSystemAttributeNames=["ApproximateReceiveCount"])
        assert json.loads(dl["Messages"][0]["Body"])["slide_id"] == "S-10"
