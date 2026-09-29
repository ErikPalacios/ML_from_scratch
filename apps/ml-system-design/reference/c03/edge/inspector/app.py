"""Inspector de UNA línea de producción (caso c03): trigger → foto → modelo → decisión → PLC.

Corre en el Jetson Orin NX de cada estación (4 líneas = 4 procesos en 4 dispositivos). Cada pieza
pasa por la cámara a 2 piezas/s; desde que el photo-eye dispara hasta la compuerta de rechazo hay
500 ms (0.3 m a 0.6 m/s). Presupuesto nominal: adquisición ≈ 50 ms, preprocesamiento ≈ 20 ms,
inferencia ≤ 120 ms (estimado: se mide con trtexec en el dispositivo), PLC ≈ 10 ms. La decisión debe
estar escrita en el PLC antes de deadline_ms = 350 ms desde el trigger; los 150 ms restantes son
del PLC y la compuerta.

Principio de diseño (el que un entrevistador busca): ante CUALQUIER duda la pieza se DESVÍA al
contenedor de inspección manual; nunca se deja pasar.
  - Tiempo: si la foto, la inferencia o la escritura no caben antes del deadline → DIVERT.
  - Fallas: cámara, foto inútil (estrobo que no disparó), modelo, scores inválidos (NaN) o PLC
    con error → DIVERT.
  - Y la garantía dura NO vive en este proceso: Python no puede interrumpir una llamada de TensorRT
    colgada ni escribir nada si el proceso murió. Por eso el PLC (el componente de tiempo real de
    la línea) desvía por default cualquier pieza que no recibió un PASS válido a tiempo. Este
    programa hace su mejor esfuerzo y mide; el PLC hace cumplir.

Interfaces (lo que el loop necesita del hardware; todo inyectable para probar sin hardware):
  Camera.grab(timeout_s) → imagen numpy (mono uint8, 2048 × 2448)
  Engine.infer(image)    → {"anomaly_score": float, "defects": {"crack": float, ...}}
  PLC.write(part_id, decision, timeout_s)
  clock()                → segundos monotónicos (en los tests, un reloj falso que avanza a mano)

Qué está implementado de verdad: el loop, el fail-safe, métricas, logs, golden check, ModbusPLC
(pymodbus, probado contra el servidor Modbus TCP de pymodbus) y un modo --simulate. Cámara GigE
Vision y engine TensorRT quedan detrás de su interfaz (ver build_hardware): sin el hardware no se
pueden probar, y código de hardware sin probar no se publica como referencia.

Uso:  python app.py --config config.yaml --simulate --max-parts 20    (sin hardware)
      python app.py --config /config/config.yaml                       (en el Jetson)
"""

from __future__ import annotations  # anotaciones como texto: sintaxis moderna también en Python 3.10

import argparse  # CLI mínima: --config, --simulate
import json  # una línea JSON por pieza: la ingesta y las consultas no necesitan parsers
import logging  # stdout del contenedor; Docker rota el archivo (ver docker-compose.yml)
import os  # os._exit en el watchdog
import queue  # la cola de triggers entre la fuente de triggers y el loop
import random  # solo para el modo --simulate
import signal  # SIGTERM de `docker stop`: terminar la pieza en curso y salir limpio
import sys  # stdout como destino explícito del log
import threading  # watchdog, fuente de triggers simulada, servidor de métricas
import time  # monotonic para medir; time.time solo para la marca de hora del log
from dataclasses import dataclass  # config y eventos tipados
from pathlib import Path  # archivo de heartbeat para el healthcheck de Docker
from typing import Callable, Optional, Protocol  # interfaces del hardware

import numpy as np  # la imagen viaja como ndarray entre cámara y modelo
import yaml  # config.yaml
from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram, start_http_server

from decision import PASS, REJECT, Decision, InvalidScores, Thresholds, decide  # lógica pura

DIVERT = "DIVERT"  # sin decisión confiable: la pieza va a inspección manual (el fail-safe)
# Códigos que se escriben en el registro del PLC. El 0 queda reservado para "sin decisión":
# el PLC desvía toda pieza cuyo registro no tenga un PASS válido cuando llega a la compuerta.
PLC_CODES = {PASS: 1, REJECT: 2, DIVERT: 3}
# Razones que cuentan como deadline miss: el tiempo se acabó (no la cámara rota ni el modelo con error)
DEADLINE_REASONS = {"deadline", "camera_timeout"}
MIN_GRAB_TIMEOUT_S = 0.005  # aunque ya no haya tiempo, se consume el frame de ESTE trigger (ver inspect)

log = logging.getLogger("inspector")  # logger propio a stdout, sin duplicar en el root
log.addHandler(logging.StreamHandler(sys.stdout))
log.setLevel(logging.INFO)
log.propagate = False


def log_json(record: dict) -> None:
    """Una línea JSON compacta por evento: Docker la guarda y el agente de la DMZ la reenvía."""
    log.info(json.dumps(record, separators=(",", ":")))


# ---------------------------------------------------------------------------- eventos y errores
@dataclass(frozen=True)
class Trigger:
    """Un flanco del photo-eye. Lo produce la fuente de triggers (fuera de este archivo).

    part_id: contador de piezas del PLC (el que usa su registro de seguimiento hasta la compuerta).
    t_trigger: time.monotonic() del Jetson en el flanco. Todo el presupuesto se mide desde aquí;
    la demora entre el photo-eye real y este sello se come margen: mídela una vez en la línea.
    """

    part_id: int
    t_trigger: float


@dataclass(frozen=True)
class GoldenCheckRequest:
    """Pedido de golden check (botón en el HMI al inicio de turno). El PLC está en modo golden."""


class CameraTimeout(Exception):
    """El frame del trigger no llegó a tiempo."""


class BadImage(Exception):
    """La foto llegó pero no sirve para decidir (estrobo que no disparó, lente tapado, sobreexpuesta)."""


class PLCError(Exception):
    """La escritura al PLC falló. El PLC desvía la pieza por default."""


# ---------------------------------------------------------------------------- interfaces
class Camera(Protocol):
    def grab(self, timeout_s: float) -> np.ndarray:
        """Devuelve el frame de ESTE trigger o lanza CameraTimeout.

        La cámara dispara por hardware (línea del photo-eye cableada a su entrada de trigger),
        así que el frame existe aunque el software llegue tarde. La implementación real debe
        emparejar frame y pieza por FrameID o timestamp del buffer y descartar frames viejos:
        si no, una pieza que llega tarde deja su frame en el buffer y la siguiente pieza se
        juzga con la foto de otra.
        """


class Engine(Protocol):
    def infer(self, image: np.ndarray) -> dict:
        """Preprocesa e infiere una pieza. Scores por pieza, normalizados a [0, 1].

        Preprocesamiento = el MISMO código que en training: recorte de la región de la pieza,
        normalización y 20 tiles de 512 × 512 en un batch de shape fijo (la imagen no se reduce:
        un defecto de 0.2 mm son ≈ 3 px). El score de la pieza es el máximo sobre sus tiles, por
        tipo: un defecto en cualquier tile rechaza la pieza.
        """


class PLC(Protocol):
    def write(self, part_id: int, decision: str, timeout_s: float) -> None:
        """Escribe la decisión; debe terminar (o fallar) dentro de timeout_s."""

    def close(self) -> None:
        """Cierra la conexión al apagar."""


# ---------------------------------------------------------------------------- config
@dataclass(frozen=True)
class PLCConfig:
    host: str  # IP del PLC en la VLAN OT
    port: int = 502  # puerto estándar de Modbus TCP
    register: int = 100  # primer holding register del par [part_id, código]
    unit_id: int = 1  # unit id Modbus (en pymodbus 3.15 se pasa como device_id)
    timeout_ms: int = 20  # timeout de la respuesta del PLC (mídelo: round trip + ciclo de scan del PLC)


@dataclass(frozen=True)
class GoldenPart:
    name: str  # la pieza física, etiquetada y guardada junto a la estación
    expect: str  # PASS o REJECT


@dataclass(frozen=True)
class GoldenConfig:
    parts: tuple[GoldenPart, ...]
    gate_production: bool = True  # sin golden check aprobado en este proceso, ninguna pieza recibe PASS
    good_margin: float = 0.15  # una golden buena debe quedar al menos esto por debajo del umbral
    grab_timeout_s: float = 20.0  # el operador pone cada pieza a mano
    max_age_h: float = 8.0  # un turno: la aprobación vence y el turno siguiente corre su propio check


@dataclass(frozen=True)
class ImageCheck:
    """Brillo medio aceptable de la foto (0–255). Se calibra con las piezas golden, no se inventa."""

    min_mean: float = 40.0  # por debajo: el estrobo no disparó o el lente está tapado
    max_mean: float = 215.0  # por encima: sobreexposición, reflejo o luz ambiente entrando


@dataclass(frozen=True)
class Config:
    line_id: str
    model_version: str
    engine_path: str
    deadline_ms: int
    plc_write_reserve_ms: int
    min_inference_budget_ms: int
    thresholds: Thresholds
    plc: PLCConfig
    golden: GoldenConfig
    image_check: ImageCheck = ImageCheck()
    metrics_addr: str = "0.0.0.0"
    metrics_port: int = 9310
    heartbeat_file: Optional[str] = None
    watchdog_s: float = 30.0

    # Los tiempos se configuran en ms (como se hablan en planta) y se usan en segundos
    @property
    def deadline_s(self) -> float:
        return self.deadline_ms / 1000

    @property
    def plc_write_reserve_s(self) -> float:
        return self.plc_write_reserve_ms / 1000

    @property
    def min_inference_budget_s(self) -> float:
        return self.min_inference_budget_ms / 1000


def load_config(path: str) -> Config:
    """Lee y VALIDA config.yaml. Una config peligrosa no arranca: falla aquí, no en la línea."""
    raw = yaml.safe_load(Path(path).read_text(encoding="utf-8"))  # safe_load: sin objetos arbitrarios
    # El fail-safe no es configurable a propósito. Si existiera "pass", alguien lo pondría durante
    # un incidente para "bajar el scrap" y mandaría piezas sin inspeccionar al cliente.
    if raw.get("fail_safe") != "divert":
        raise ValueError(f"fail_safe debe ser 'divert' (llegó {raw.get('fail_safe')!r})")
    plc = PLCConfig(**raw["plc"])
    golden_raw = raw.get("golden") or {}
    parts = tuple(GoldenPart(**p) for p in golden_raw.get("parts", []))
    golden = GoldenConfig(parts=parts, **{k: v for k, v in golden_raw.items() if k != "parts"})
    metrics = raw.get("metrics") or {}
    cfg = Config(
        line_id=str(raw["line_id"]),
        model_version=str(raw["model_version"]),
        engine_path=str(raw["engine_path"]),
        deadline_ms=int(raw["deadline_ms"]),
        plc_write_reserve_ms=int(raw["plc_write_reserve_ms"]),
        min_inference_budget_ms=int(raw["min_inference_budget_ms"]),
        thresholds=Thresholds.from_config(raw["thresholds"]),
        plc=plc,
        golden=golden,
        image_check=ImageCheck(**(raw.get("image_check") or {})),
        metrics_addr=str(metrics.get("addr", "0.0.0.0")),
        metrics_port=int(metrics.get("port", 9310)),
        heartbeat_file=raw.get("heartbeat_file"),
        watchdog_s=float(raw.get("watchdog_s", 30)),
    )
    # Coherencia de tiempos: la reserva debe cubrir reconectar + escribir (2 timeouts del PLC)
    if 2 * plc.timeout_ms > cfg.plc_write_reserve_ms:
        raise ValueError("plc_write_reserve_ms debe ser >= 2 × plc.timeout_ms (reconexión + escritura)")
    if cfg.plc_write_reserve_ms + cfg.min_inference_budget_ms >= cfg.deadline_ms:
        raise ValueError("deadline_ms no alcanza para inferir y escribir: revisa los tiempos")
    if golden.gate_production:
        expects = {p.expect for p in parts}
        if not {PASS, REJECT} <= expects:  # sin una buena y una mala, el check no prueba nada
            raise ValueError("golden.parts necesita al menos una pieza PASS y una REJECT")
    if not all(p.expect in (PASS, REJECT) for p in parts):
        raise ValueError("golden.parts[].expect debe ser PASS o REJECT")
    if cfg.watchdog_s <= golden.grab_timeout_s:  # el golden check espera al operador sin matar el proceso
        raise ValueError("watchdog_s debe ser mayor que golden.grab_timeout_s")
    if golden.max_age_h <= 0:
        raise ValueError("golden.max_age_h debe ser positivo")
    if not 0 <= cfg.image_check.min_mean < cfg.image_check.max_mean <= 255:
        raise ValueError("image_check: se necesita 0 <= min_mean < max_mean <= 255")
    return cfg


# ---------------------------------------------------------------------------- métricas
class Metrics:
    """Métricas Prometheus del inspector. Los nombres son contrato con las alertas del caso."""

    def __init__(self, registry: CollectorRegistry, line: str) -> None:
        self.line = line
        self._decisions = Counter(  # el cliente agrega _total al exponer: inspection_decisions_total
            "inspection_decisions", "Piezas por decisión", ["line", "decision"], registry=registry)
        self.latency = Histogram(  # trigger → escritura al PLC; buckets alrededor del deadline de 350 ms
            "inspection_latency_seconds", "Latencia desde el trigger hasta la decisión escrita", ["line"],
            buckets=(0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 1.0), registry=registry).labels(line)
        self.deadline_miss = Counter(  # debería ser ≈ 0: cada uno es una pieza a inspección manual
            "inspection_deadline_miss", "Piezas sin decisión a tiempo", ["line"], registry=registry).labels(line)
        self.anomaly = Histogram(  # distribución del score: drift de iluminación, foco o material, sin labels
            "inspection_anomaly_score", "Score de anomalía por pieza", ["line"],
            buckets=tuple(round(0.05 * i, 2) for i in range(1, 21)), registry=registry).labels(line)
        self.golden_ok = Gauge(  # 1 = el último golden check pasó en este proceso; 0 = falló o no se corrió
            "golden_part_check_ok", "Resultado del último golden check", ["line"], registry=registry).labels(line)
        self.plc_errors = Counter(
            "plc_write_errors", "Escrituras al PLC fallidas", ["line"], registry=registry).labels(line)
        # Series creadas en 0 desde el arranque: rate() y las alertas funcionan antes del primer
        # REJECT. Una serie que no existe no dispara ninguna alerta: falla en silencio.
        for d in (PASS, REJECT, DIVERT):
            self._decisions.labels(line, d)
        self.golden_ok.set(0)

    def decision(self, decision: str) -> None:
        self._decisions.labels(self.line, decision).inc()


# ---------------------------------------------------------------------------- el inspector
class Inspector:
    """El loop de una línea. Secuencial a propósito: a 2 piezas/s y ≈ 200 ms nominales por pieza
    sobran ≈ 300 ms por ciclo; un pipeline concurrente agregaría errores de emparejar foto y pieza."""

    def __init__(self, cfg: Config, camera: Camera, engine: Engine, plc: PLC, *,
                 clock: Callable[[], float] = time.monotonic,
                 registry: Optional[CollectorRegistry] = None,
                 emit: Optional[Callable[[dict], None]] = None) -> None:
        self.cfg, self.camera, self.engine, self.plc = cfg, camera, engine, plc
        self.clock = clock  # inyectable: los tests simulan una inferencia de 400 ms sin esperar 400 ms
        self.thresholds = cfg.thresholds
        self.metrics = Metrics(registry or CollectorRegistry(), cfg.line_id)
        self.emit = emit or log_json  # inyectable: los tests guardan los registros en una lista
        self.golden_ok: Optional[bool] = None  # None = no se corrió en este proceso o ya venció
        self.golden_ok_at: Optional[float] = None  # clock() de la última aprobación
        self.last_tick = time.monotonic()  # lo vigila el watchdog (reloj real, no el inyectado)

    def tick(self) -> None:
        """Heartbeat: el watchdog y el healthcheck de Docker ven que el loop sigue vivo."""
        self.last_tick = time.monotonic()
        if self.cfg.heartbeat_file:
            try:
                Path(self.cfg.heartbeat_file).touch()  # tmpfs: no desgasta la memoria flash
            except OSError:  # sin archivo el healthcheck marca unhealthy; la inspección NO se detiene por esto
                pass

    def _expire_golden(self) -> None:
        """La aprobación dura un turno (golden.max_age_h). Vencida, vuelve a "pendiente"."""
        if self.golden_ok is True and self.golden_ok_at is not None and \
                self.clock() - self.golden_ok_at > self.cfg.golden.max_age_h * 3600:
            self.golden_ok, self.golden_ok_at = None, None
            self.metrics.golden_ok.set(0)  # la alerta de golden check ve el turno sin chequeo
            self.emit({"event": "golden_expired", "ts": round(time.time(), 3), "line": self.cfg.line_id})

    def _gate_reason(self) -> Optional[str]:
        """Por qué NO se puede dar PASS ahora (golden check pendiente o fallido), o None."""
        self._expire_golden()
        if not self.cfg.golden.gate_production or self.golden_ok is True:
            return None
        return "golden_pending" if self.golden_ok is None else "golden_failed"

    def _check_image(self, image: np.ndarray) -> None:
        """Validar la entrada antes de inferir: una foto negra no es una pieza "sin defectos".

        Un clasificador puede no ver ningún defecto en una imagen oscura y dar PASS con toda
        confianza. El brillo medio de 1 de cada 8 píxeles por eje (≈ 78 mil de 5 M) cuesta
        microsegundos y convierte ese caso en DIVERT.
        """
        mean = float(image[::8, ::8].mean())
        if not self.cfg.image_check.min_mean <= mean <= self.cfg.image_check.max_mean:
            raise BadImage(f"brillo medio {mean:.1f} fuera de "
                           f"[{self.cfg.image_check.min_mean}, {self.cfg.image_check.max_mean}]")

    def _model_decision(self, trig: Trigger, left: Callable[[], float]):
        """Cámara → modelo → reglas. Devuelve (decisión, razón, scores, decisión del modelo, error)."""
        cfg = self.cfg
        # Timeout de la foto = lo que queda menos lo que necesitan inferencia y PLC. Se llama a
        # grab SIEMPRE, aunque ya no haya tiempo, para consumir el frame de esta pieza (1 trigger
        # = 1 frame) y no juzgar la siguiente con una foto vieja.
        grab_timeout = max(left() - cfg.plc_write_reserve_s - cfg.min_inference_budget_s, MIN_GRAB_TIMEOUT_S)
        try:
            image = self.camera.grab(grab_timeout)
        except CameraTimeout as exc:
            return DIVERT, "camera_timeout", None, None, exc
        except Exception as exc:  # cable, red, driver: cualquier falla de cámara es DIVERT
            return DIVERT, "camera_error", None, None, exc
        try:
            self._check_image(image)
        except BadImage as exc:  # estrobo, lente, exposición: no se infiere sobre una foto inútil
            return DIVERT, "bad_image", None, None, exc
        # ¿Cabe la inferencia? Si no, ni lo intentes: el loop se pone al día en vez de atrasar
        # también a la pieza siguiente (load shedding aplicado a una línea de producción).
        if left() - cfg.plc_write_reserve_s < cfg.min_inference_budget_s:
            return DIVERT, "deadline", None, None, None
        try:
            scores = self.engine.infer(image)
        except Exception as exc:  # CUDA, engine corrupto, memoria: DIVERT y que lo vea la alerta
            return DIVERT, "engine_error", None, None, exc
        try:
            model = decide(scores, self.thresholds)
        except InvalidScores as exc:  # NaN, falta un tipo de defecto, fuera de rango
            return DIVERT, "invalid_scores", scores, None, exc
        if left() < cfg.plc_write_reserve_s:  # el modelo tardó: ya no alcanza a escribir a tiempo
            return DIVERT, "deadline", scores, model, None
        gate = self._gate_reason()
        if model.decision == PASS and gate:  # un REJECT sí se respeta: va a revisión de todas formas
            return DIVERT, gate, scores, model, None
        return model.decision, model.reason, scores, model, None

    def inspect(self, trig: Trigger) -> dict:
        """Una pieza de punta a punta. Siempre devuelve (y loguea) una decisión; nunca lanza."""
        cfg = self.cfg
        deadline = trig.t_trigger + cfg.deadline_s  # todo se mide desde el photo-eye, no desde "ahora"

        def left() -> float:  # segundos que quedan del presupuesto de esta pieza
            return deadline - self.clock()

        decision, reason, scores, model, error = self._model_decision(trig, left)
        # Escribir SOLO si la escritura termina antes del deadline. Si no queda tiempo no se
        # escribe nada: el PLC ya desvía por default, y una escritura tardía no sirve.
        if left() >= cfg.plc_write_reserve_s:
            try:
                self.plc.write(trig.part_id, decision, timeout_s=left())
                if self.clock() > deadline and decision != DIVERT:
                    # Llegó tarde: el PLC ya la desvió por default (ignora decisiones tardías)
                    decision, reason = DIVERT, "deadline"
            except Exception as exc:
                self.metrics.plc_errors.inc()
                if decision != DIVERT:  # el PLC no recibió el PASS/REJECT: la desvía por default
                    decision, reason = DIVERT, "plc_error"
                error = error or exc
        latency = self.clock() - trig.t_trigger
        if reason in DEADLINE_REASONS:
            self.metrics.deadline_miss.inc()
        self.metrics.decision(decision)
        self.metrics.latency.observe(latency)
        if model is not None:  # solo scores que pasaron la validación de decision.py
            self.metrics.anomaly.observe(float(scores["anomaly_score"]))
        record = {
            "event": "decision",
            "ts": round(time.time(), 3),  # reloj de pared: para cruzar con el PLC y las fotos
            "part_id": trig.part_id,
            "line": cfg.line_id,
            "model_version": cfg.model_version,  # cada decisión queda atada a su modelo
            "scores": _round_scores(scores) if model is not None else None,
            "decision": decision,  # lo que pasó físicamente con la pieza
            "model_decision": model.decision if model is not None else None,  # lo que dijo el modelo
            "latency_ms": round(latency * 1000, 1),
            "reason": reason,
        }
        if error is not None:
            record["error"] = repr(error)[:200]  # acotado: un traceback entero no cabe en cada línea
        self.emit(record)
        return record

    def golden_check(self) -> bool:
        """Golden check de inicio de turno: piezas físicas conocidas pasan por la estación REAL.

        Prueba toda la cadena (iluminación, lente, foco, cámara, modelo, umbrales), no solo el
        modelo: con imágenes guardadas no detectarías un foco movido. No escribe al PLC (está en
        modo golden y desvía todo) ni cuenta en las métricas de producción.
        """
        results, ok = [], True
        for part in self.cfg.golden.parts:
            self.tick()  # el operador tarda en poner cada pieza: el watchdog no debe matarnos
            item = {"name": part.name, "expect": part.expect}
            try:
                image = self.camera.grab(self.cfg.golden.grab_timeout_s)
                self._check_image(image)  # una foto oscura también reprueba el golden check
                scores = self.engine.infer(image)
                model: Decision = decide(scores, self.thresholds)
            except Exception as exc:  # timeout, error de modelo o scores inválidos: el check falla
                item.update(ok=False, error=repr(exc)[:200])
                results.append(item)
                ok = False
                continue
            anomaly = float(scores["anomaly_score"])
            passed = model.decision == part.expect
            # Una golden buena que pasa "raspando" también es falla: la iluminación, el lente o el
            # foco se están moviendo y mañana serán falsos rechazos (o defectos que no se ven).
            if part.expect == PASS and anomaly > self.thresholds.anomaly - self.cfg.golden.good_margin:
                passed = False
            item.update(ok=passed, decision=model.decision, reason=model.reason,
                        anomaly_score=round(anomaly, 4))
            results.append(item)
            ok = ok and passed
        self.golden_ok = ok
        self.golden_ok_at = self.clock() if ok else None  # empieza a correr la validez de un turno
        self.metrics.golden_ok.set(1 if ok else 0)
        self.emit({"event": "golden_check", "ts": round(time.time(), 3), "line": self.cfg.line_id,
                   "model_version": self.cfg.model_version, "ok": ok, "results": results})
        return ok

    def run(self, events: "queue.Queue", stop: threading.Event, max_parts: Optional[int] = None) -> int:
        """Loop principal: una pieza a la vez hasta `stop` (SIGTERM) o `max_parts` (demo/tests)."""
        done = 0
        while not stop.is_set():
            self.tick()  # también sin piezas (línea parada): el watchdog mide el loop, no la línea
            try:
                event = events.get(timeout=0.25)
            except queue.Empty:
                continue
            if isinstance(event, GoldenCheckRequest):
                self.golden_check()
                continue
            self.inspect(event)
            done += 1
            if max_parts is not None and done >= max_parts:
                break
        return done


def _round_scores(scores: dict) -> dict:
    """Scores redondeados para el log: 4 decimales bastan y la línea queda corta."""
    defects = {k: round(float(v), 4) for k, v in (scores.get("defects") or {}).items()}
    return {"anomaly": round(float(scores["anomaly_score"]), 4), "defects": defects}


# ---------------------------------------------------------------------------- PLC real
class ModbusPLC:
    """Escribe [part_id, código] en dos holding registers con UNA petición (función 16).

    Una sola trama: el PLC nunca ve el código nuevo junto al part_id viejo (confirma con el
    integrador que su PLC aplica la trama completa en el mismo ciclo). Probado con pymodbus 3.15
    contra su propio ModbusTcpServer (tests/test_inspector.py). Alternativa común: OPC UA, más
    rica en tipos y seguridad; Modbus TCP es lo que casi cualquier PLC habla sin licencias extra.
    """

    def __init__(self, cfg: PLCConfig) -> None:
        # Import aquí: el resto del loop (y sus tests) no depende de pymodbus
        from pymodbus.client import ModbusTcpClient

        self.cfg = cfg
        self.timeout_s = cfg.timeout_ms / 1000
        # retries=0: un reintento llegaría tarde; si falla, falla rápido y el PLC desvía la pieza.
        # El timeout de pymodbus se fija al crear el cliente (no por llamada); por eso app.py
        # reserva 2 × timeout (reconexión + escritura) antes del deadline.
        self.client = ModbusTcpClient(cfg.host, port=cfg.port, timeout=self.timeout_s, retries=0)

    def write(self, part_id: int, decision: str, timeout_s: float) -> None:
        from pymodbus.exceptions import ModbusException

        if timeout_s < self.timeout_s:  # no empieces una escritura que no puede terminar a tiempo
            raise PLCError("sin tiempo para escribir antes del deadline")
        try:
            if not self.client.connected:  # conexión caída (PLC reiniciado, cable): reconectar
                if timeout_s < 2 * self.timeout_s or not self.client.connect():
                    raise PLCError("sin conexión con el PLC")
            # part_id & 0xFFFF: un registro Modbus es de 16 bits; el PLC solo compara la pieza en curso
            reply = self.client.write_registers(
                self.cfg.register, [part_id & 0xFFFF, PLC_CODES[decision]], device_id=self.cfg.unit_id)
        except ModbusException as exc:  # timeout, conexión rechazada o reseteada
            raise PLCError(f"Modbus: {exc}") from exc
        if reply.isError():  # el PLC respondió con una excepción Modbus (registro inválido, etc.)
            raise PLCError(f"el PLC rechazó la escritura: {reply}")

    def close(self) -> None:
        self.client.close()


def build_hardware(cfg: Config):
    """Cámara, modelo y PLC reales. Cámara y TensorRT se implementan en el dispositivo.

    GigE Vision (la cámara de 5 MP):
      - Aravis 0.8 (LGPL, apt: gir1.2-aravis-0.8 + python3-gi en Ubuntu 22.04) vía PyGObject:
        Aravis.Camera.new(id); camera.set_trigger("Line1") (FrameStart, flanco de subida);
        stream = camera.create_stream(None, None); stream.push_buffer(...) varias veces;
        camera.start_acquisition(); buffer = stream.timeout_pop_buffer(timeout_us) (µs, None si
        no llegó → CameraTimeout); revisar buffer.get_status() antes de usar los datos.
      - o harvesters 1.4 (pip) + el productor GenTL (.cti) del fabricante de la cámara:
        h.add_file(cti); h.update(); ia = h.create(); ia.start(); with ia.fetch(timeout=s) as buf.
      - En ambos: jumbo frames (p. ej. MTU 9000, si la cámara lo soporta) en su NIC y buffers de recepción grandes
        (sysctl net.core.rmem_max) en el HOST; con red host el contenedor no puede cambiarlos.
    TensorRT 10.3 (el de JetPack 6.2.x y de la imagen base):
      - runtime = trt.Runtime(trt.Logger(trt.Logger.WARNING));
        engine = runtime.deserialize_cuda_engine(Path(cfg.engine_path).read_bytes());
        context = engine.create_execution_context(); nombres de tensores con
        engine.get_tensor_name(i) para i < engine.num_io_tensors (entrada de shape fijo: 20
        tiles); context.set_tensor_address(nombre, puntero); context.execute_async_v3(stream).
        Memoria y stream con cuda-python, como los samples de TensorRT 10.3. En Jetson la
        memoria es unificada: evalúa buffers zero-copy.
      - El engine se construye EN el dispositivo con tools/build_engine_jetson.sh.
    """
    raise NotImplementedError(
        "Cámara y engine reales no incluidos en la referencia (ver el docstring de build_hardware). "
        "Para probar sin hardware: python app.py --config config.yaml --simulate")


# ---------------------------------------------------------------------------- modo --simulate
class SimCamera:
    """Cámara simulada: el píxel [0, 0] codifica la verdad (0 = buena, 1–4 = tipo de defecto)."""

    DEFECTS = ("crack", "burr", "missing_hole", "deformation")

    def __init__(self, seed: int = 7) -> None:
        self.rng = random.Random(seed)
        self.pending: list[int] = []  # piezas golden en fila (el operador las pone en orden)

    def queue_golden(self, parts) -> None:
        # Las golden "PASS" son piezas buenas; las "REJECT" recorren los 4 tipos de defecto en orden
        rejects = iter(range(len(parts)))
        self.pending = [0 if p.expect == PASS else 1 + next(rejects) % 4 for p in parts]

    def grab(self, timeout_s: float) -> np.ndarray:
        time.sleep(0.04)  # ≈ 40–45 ms de transferencia de 5 MB por 1 GigE
        truth = self.pending.pop(0) if self.pending else (
            self.rng.randint(1, 4) if self.rng.random() < 0.005 else 0)  # 0.5 % de defectos
        image = np.full((2048, 2448), 120, dtype=np.uint8)  # 5 MP mono, 1 B por píxel ≈ 5.0 MB; gris medio
        image[0, 0] = truth
        return image


class SimEngine:
    """Modelo simulado: scores plausibles según la verdad del píxel [0, 0]; tarda ≈ 80–110 ms."""

    def __init__(self, seed: int = 11) -> None:
        self.rng = random.Random(seed)

    def infer(self, image: np.ndarray) -> dict:
        time.sleep(self.rng.uniform(0.08, 0.11))
        truth = int(image[0, 0])
        defects = {d: round(self.rng.uniform(0.0, 0.1), 4) for d in SimCamera.DEFECTS}
        if truth:
            defects[SimCamera.DEFECTS[truth - 1]] = round(self.rng.uniform(0.8, 0.99), 4)
        anomaly = self.rng.uniform(0.7, 0.95) if truth else self.rng.uniform(0.05, 0.35)
        return {"anomaly_score": round(anomaly, 4), "defects": defects}


class SimPLC:
    """PLC simulado: una escritura tarda ≈ 2 ms."""

    def write(self, part_id: int, decision: str, timeout_s: float) -> None:
        time.sleep(0.002)

    def close(self) -> None:
        pass


def _simulated_triggers(events: "queue.Queue", stop: threading.Event, period_s: float) -> None:
    """Fuente de triggers simulada. En producción la alimenta el photo-eye (vía PLC o GPIO)."""
    part_id = 0
    while not stop.wait(period_s):  # 2 piezas/s con el período por defecto (500 ms)
        part_id += 1
        try:
            events.put_nowait(Trigger(part_id, time.monotonic()))
        except queue.Full:  # el loop está atascado: se pierde el trigger y el PLC desvía la pieza
            log_json({"event": "trigger_dropped", "part_id": part_id})


# ---------------------------------------------------------------------------- main
def _start_watchdog(inspector: Inspector, watchdog_s: float, stop: threading.Event) -> None:
    """Si el loop no avanza en watchdog_s (p. ej. TensorRT colgado), mata el proceso.

    os._exit y no sys.exit: sys.exit en un hilo solo termina ese hilo, y el principal puede estar
    bloqueado dentro de una llamada en C. Con el proceso muerto, `restart: unless-stopped` lo
    levanta. Docker (sin Swarm) NO reinicia contenedores "unhealthy": el healthcheck solo informa.
    """
    def watch() -> None:
        while not stop.wait(1.0):
            stalled = time.monotonic() - inspector.last_tick
            if stalled > watchdog_s:
                log_json({"event": "watchdog_exit", "stalled_s": round(stalled, 1)})
                os._exit(3)

    threading.Thread(target=watch, name="watchdog", daemon=True).start()


def main(argv: Optional[list] = None) -> int:
    parser = argparse.ArgumentParser(description="Inspector de línea (caso c03)")
    parser.add_argument("--config", required=True, help="ruta a config.yaml")
    parser.add_argument("--simulate", action="store_true", help="cámara, modelo y PLC simulados")
    parser.add_argument("--max-parts", type=int, default=None, help="terminar tras N piezas (demo/tests)")
    parser.add_argument("--sim-period-ms", type=int, default=500, help="período entre piezas simuladas")
    args = parser.parse_args(argv)
    cfg = load_config(args.config)  # config inválida = no arranca (exit != 0)

    if args.simulate:
        camera, engine, plc = SimCamera(), SimEngine(), SimPLC()
    else:
        camera, engine, plc = build_hardware(cfg)
    registry = CollectorRegistry()  # registro propio: solo las métricas del inspector
    inspector = Inspector(cfg, camera, engine, plc, registry=registry)
    # /metrics en la IP de la VLAN OT (config), no en todas las interfaces: con red host el
    # puerto también quedaría abierto en la NIC de la cámara
    server, _ = start_http_server(cfg.metrics_port, addr=cfg.metrics_addr, registry=registry)

    stop = threading.Event()
    previous = {}
    if threading.current_thread() is threading.main_thread():
        for sig in (signal.SIGTERM, signal.SIGINT):  # docker stop manda SIGTERM; Ctrl+C manda SIGINT
            previous[sig] = signal.signal(sig, lambda *_: stop.set())
    _start_watchdog(inspector, cfg.watchdog_s, stop)
    events: queue.Queue = queue.Queue(maxsize=8)  # acotada: si el loop se atasca, no acumula piezas viejas
    log_json({"event": "start", "line": cfg.line_id, "model_version": cfg.model_version,
              "metrics": f"{cfg.metrics_addr}:{cfg.metrics_port}"})
    if args.simulate:
        # En planta el operador pide el golden check desde el HMI (GoldenCheckRequest en la cola)
        # con la línea en modo golden, sin triggers de producción. Aquí: primero el check, luego piezas.
        camera.queue_golden(cfg.golden.parts)
        inspector.golden_check()
        threading.Thread(target=_simulated_triggers, args=(events, stop, args.sim_period_ms / 1000),
                         name="triggers", daemon=True).start()
    try:
        inspector.run(events, stop, max_parts=args.max_parts)
    finally:
        stop.set()  # detiene watchdog y triggers
        plc.close()
        server.shutdown()  # termina el hilo de /metrics…
        server.server_close()  # …y libera el puerto
        for sig, handler in previous.items():
            signal.signal(sig, handler)
    log_json({"event": "stop", "line": cfg.line_id})
    return 0


if __name__ == "__main__":
    sys.exit(main())
