"""Dobles de prueba compartidos: cola con semántica de SQS, storage en memoria, un WSI sintético
"analítico" (se calcula pixel a pixel, nunca se guarda entero) y un modelo que umbraliza el color.

Por qué dobles propios y no mocks genéricos: lo que se prueba es la SEMÁNTICA (visibilidad,
conteo de entregas, redrive a la DLQ, orden de escritura). Un mock que devuelve lo que le pides
no puede fallar por las razones por las que falla SQS.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from pathlib import Path

import numpy as np
import pytest

import tiling
import worker as W


# ---------------------------------------------------------------------------- cola
class FakeQueue:
    """Emula lo que importa de SQS estándar, con un reloj manual (sin sleeps en los tests):
    - receive: solo mensajes visibles; suma ApproximateReceiveCount; receipt nuevo por entrega;
      queda invisible `visibility_s`.
    - redrive: si un mensaje ya se entregó max_receive_count veces y vuelve a estar visible, el
      siguiente receive lo mueve a la DLQ en vez de entregarlo (así lo hace SQS).
    - extend_visibility / release / delete: solo con el receipt de la ÚLTIMA entrega.
    """

    def __init__(self, max_receive_count: int = 3, visibility_s: int = 300):
        self.now = 1_790_000_000.0
        self.max_receive_count, self.visibility_s = max_receive_count, visibility_s
        self.msgs: dict[str, dict] = {}
        self.dlq: list[dict] = []
        self.deleted: list[str] = []
        self.visibility_calls: list[int] = []

    def send(self, body: dict | str, sent_at: float | None = None) -> str:
        mid = str(uuid.uuid4())
        self.msgs[mid] = {"body": body if isinstance(body, str) else json.dumps(body),
                          "count": 0, "visible_at": self.now, "receipt": None,
                          "sent_at": sent_at if sent_at is not None else self.now}
        return mid

    def advance(self, seconds: float) -> None:
        self.now += seconds

    def receive(self, wait_s: int):
        for mid in list(self.msgs):
            m = self.msgs[mid]
            if m["visible_at"] > self.now:
                continue
            if m["count"] >= self.max_receive_count:
                self.dlq.append(self.msgs.pop(mid))  # redrive: no se entrega, se mueve
                continue
            m["count"] += 1
            m["receipt"] = str(uuid.uuid4())
            m["visible_at"] = self.now + self.visibility_s
            return W.Message(body=m["body"], receipt=m["receipt"], receive_count=m["count"],
                             sent_at=m["sent_at"], message_id=mid)
        return None

    def _find(self, msg: W.Message) -> dict:
        m = self.msgs.get(msg.message_id)
        if m is None or m["receipt"] != msg.receipt:
            raise RuntimeError("ReceiptHandleIsInvalid")
        return m

    def extend_visibility(self, msg, seconds: int) -> None:
        self.visibility_calls.append(seconds)
        self._find(msg)["visible_at"] = self.now + seconds

    def release(self, msg) -> None:
        self.extend_visibility(msg, 0)

    def delete(self, msg) -> None:
        self._find(msg)
        del self.msgs[msg.message_id]
        self.deleted.append(msg.message_id)


# ---------------------------------------------------------------------------- storage
class FakeStorage:
    """Archivo digital (sources, por uri) + bucket de resultados (objects, por key).
    `writes` registra el ORDEN de escritura; `fail_puts` hace fallar una key una sola vez."""

    def __init__(self):
        self.sources: dict[str, bytes] = {}
        self.objects: dict[str, bytes] = {}
        self.writes: list[str] = []
        self.fail_puts: set[str] = set()

    def add_source(self, uri: str, data: bytes) -> str:
        self.sources[uri] = data
        return hashlib.sha256(data).hexdigest()

    def download(self, uri: str, dest: Path) -> None:
        dest.write_bytes(self.sources[uri])

    def exists(self, key: str) -> bool:
        return key in self.objects

    def read(self, key: str):
        return self.objects.get(key)

    def put(self, key: str, data: bytes, content_type: str) -> None:
        if key in self.fail_puts:
            self.fail_puts.discard(key)
            raise OSError(f"falla simulada al escribir {key}")
        self.objects[key] = data
        self.writes.append(key)

    def put_atomic(self, key: str, data: bytes, content_type: str) -> None:
        self.put(key, data, content_type)


# ---------------------------------------------------------------------------- WSI sintético
BACKGROUND = np.array([240, 240, 240])  # vidrio
TISSUE = np.array([220, 150, 190])  # H&E rosa (estroma)
TUMOR = np.array([120, 60, 140])  # morado oscuro: el fake model lo reconoce por R < 170


class SyntheticSlide:
    """WSI descrito por rectángulos en coordenadas de nivel 0. read_region calcula el color de
    cada pixel por su centro (nada se guarda entero: un slide de 2 mm a 0.25 µm/px serían 200 MB).
    `texture` agrega un patrón ±16 para que el detector de blur tenga bordes que medir."""

    def __init__(self, spec: dict):
        self.spec = spec
        w, h = spec["w"], spec["h"]
        self.dimensions = (w, h)
        self.level_downsamples = tuple(float(d) for d in spec.get("downsamples", [1, 4, 16]))
        self.level_dimensions = tuple((int(w // d), int(h // d)) for d in self.level_downsamples)
        mpp = spec.get("mpp")
        self.mpp = (mpp[0], mpp[1]) if mpp else (None, None)
        self.closed = False

    def read_region(self, x0, y0, level, w, h):
        d = self.level_downsamples[level]
        xs = x0 + (np.arange(w) + 0.5) * d  # centro de cada pixel en coordenadas de nivel 0
        ys = y0 + (np.arange(h) + 0.5) * d

        def inside(r):  # rectángulo como producto de dos máscaras 1D (barato)
            return ((ys >= r[1]) & (ys < r[3]))[:, None] & ((xs >= r[0]) & (xs < r[2]))[None, :]

        out = np.empty((h, w, 3), np.int16)
        out[:] = BACKGROUND
        t = inside(self.spec["tissue"])
        out[t] = TISSUE
        for r in self.spec.get("tumors", []):
            out[inside(r)] = TUMOR
        if self.spec.get("texture", True):
            noise = ((xs // 2).astype(np.int64) * 7)[None, :] + ((ys // 2).astype(np.int64) * 13)[:, None]
            out += np.where(t, (noise % 9 - 4) * 4, 0).astype(np.int16)[..., None]
        out[:, xs >= self.dimensions[0]] = 255  # fuera del escaneo
        out[ys >= self.dimensions[1], :] = 255
        return np.clip(out, 0, 255).astype(np.uint8)

    def close(self):
        self.closed = True


class SyntheticReader:
    """El "archivo" descargado es el JSON del spec: así el sha256 y la descarga son reales."""

    def open(self, path: Path) -> SyntheticSlide:
        return SyntheticSlide(json.loads(Path(path).read_text()))


# 2 mm × 2 mm a 0.25 µm/px; tejido 1.6 × 1.6 mm; tumor 0.8 × 0.8 mm (múltiplos de 16 px de
# nivel 0, alineados con el mapa de 4 µm/px) → 0.64 mm² de tumor en 2.56 mm² de tejido = 25 %.
BASE_SPEC = {"w": 8000, "h": 8000, "mpp": [0.25, 0.25], "downsamples": [1, 4, 16],
             "tissue": [800, 800, 7200, 7200], "tumors": [[1600, 1600, 4800, 4800]]}


class ColorThresholdModel:
    """"Modelo" que marca tumor donde el canal rojo < 170. Cuenta llamadas y puede fallar."""

    def __init__(self, fail_times: int = 0, output=None, on_predict=None):
        self.calls = 0
        self.fail_times, self.output, self.on_predict = fail_times, output, on_predict

    def predict(self, batch: np.ndarray) -> np.ndarray:
        self.calls += 1
        if self.on_predict:
            self.on_predict(self)
        if self.calls <= self.fail_times:
            raise RuntimeError("CUDA error simulado")
        if self.output is not None:
            return self.output(batch)
        return (batch[..., 0] < 170).astype(np.float32)


class RecordingIndex:
    def __init__(self):
        self.rows: dict[tuple, dict] = {}
        self.calls = 0

    def upsert(self, summary: dict) -> None:
        self.calls += 1
        self.rows[(summary["slide_id"], summary["model_version"])] = summary


# ---------------------------------------------------------------------------- fixtures
SCANNERS = {"A-X-01": 0.25, "B-X-01": 0.25, "C-Y-01": 0.25}


@pytest.fixture
def env(tmp_path):
    """Un worker completo con dobles. `env.add_slide(spec)` sube el slide y encola su mensaje."""

    class Env:
        pass

    e = Env()
    e.queue, e.storage, e.index = FakeQueue(), FakeStorage(), RecordingIndex()
    e.model = ColorThresholdModel()
    e.cfg = W.WorkerConfig(model_version="2026-09-01-unet-fp16", container_digest="sha256:abc",
                           training_data_version="ds-2026-08", work_dir=tmp_path / "scratch",
                           receive_wait_s=0, scanners=dict(SCANNERS), reader_threads=4,
                           batch_size=8, liveness_file=tmp_path / "alive")

    def make_worker(**kw):
        return W.Worker(queue=e.queue, storage=e.storage, reader=SyntheticReader(),
                        model=kw.pop("model", e.model), cfg=kw.pop("cfg", e.cfg), index=e.index,
                        clock=lambda: e.queue.now, **kw)

    def add_slide(spec=None, slide_id="S-0001", scanner="A-X-01", lab="A", sha=None, **msg):
        data = json.dumps(spec or BASE_SPEC).encode()
        uri = f"s3://archive/{slide_id}-{hashlib.sha1(data).hexdigest()[:6]}.svs"
        real_sha = e.storage.add_source(uri, data)
        body = {"slide_id": slide_id, "uri": uri, "sha256": sha or real_sha, "lab": lab,
                "scanner": scanner, **msg}
        e.queue.send(body)
        return body

    e.make_worker, e.add_slide = make_worker, add_slide
    e.summary_key = lambda slide_id="S-0001": f"results/{slide_id}/2026-09-01-unet-fp16/summary.json"
    e.summary = lambda slide_id="S-0001": json.loads(e.storage.objects[e.summary_key(slide_id)])
    return e


@pytest.fixture
def cfg():
    return tiling.PreprocConfig()
