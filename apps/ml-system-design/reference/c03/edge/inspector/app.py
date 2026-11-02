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
  Camera.grab(timeout_s) → imagen numpy (mono uint8, 2048 × 2448) COMPLETA, o lanza
  Engine.infer(image)    → {"anomaly_score": float, "defects": {"crack": float, ...}} (np.float32 vale)
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
import datetime as dt  # hora de pared de la planta: inicio de turno para vencer el golden check
import json  # una línea JSON por pieza: la ingesta y las consultas no necesitan parsers
import logging  # stdout del contenedor; Docker rota el archivo (ver docker-compose.yml)
import os  # os._exit en el watchdog y tras errores seguidos del engine
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
# TODAS las razones posibles de un DIVERT: cada una es una serie de inspection_divert_total, creada
# en 0 al arrancar. Sin esa métrica, un estrobo muerto (100 % bad_image) desvía la línea entera en
# silencio: el loop sigue avanzando, el golden check ya pasó y ninguna otra alerta mira la razón.
DIVERT_REASONS = ("deadline", "camera_timeout", "camera_error", "bad_image", "engine_error",
                  "invalid_scores", "internal_error", "plc_error", "golden_pending", "golden_failed")
# Errores del engine SEGUIDOS antes de salir (20 piezas = 10 s a 2 piezas/s). Uno suelto es DIVERT
# y sigue; muchos seguidos suelen ser un error "pegajoso" de CUDA (p. ej. illegal address): el
# contexto queda roto y solo un proceso nuevo lo recupera. El watchdog no lo ve: el loop avanza.
MAX_ENGINE_ERRORS_IN_A_ROW = 20
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


class IncompleteFrame(Exception):
    """El buffer de la cámara llegó incompleto (paquetes GVSP perdidos). Es camera_error: DIVERT."""


class BadImage(Exception):
    """La foto llegó pero no sirve para decidir (estrobo que no disparó, lente tapado, sobreexpuesta)."""


class PLCError(Exception):
    """La escritura al PLC falló. El PLC desvía la pieza por default."""


# ---------------------------------------------------------------------------- interfaces
class Camera(Protocol):
    def grab(self, timeout_s: float) -> np.ndarray:
        """Devuelve el frame COMPLETO de ESTE trigger, o lanza (CameraTimeout si no llegó a tiempo).

        La cámara dispara por hardware (línea del photo-eye cableada a su entrada de trigger),
        así que el frame existe aunque el software llegue tarde. La implementación real debe
        emparejar frame y pieza por FrameID o timestamp del buffer y descartar frames viejos:
        si no, una pieza que llega tarde deja su frame en el buffer y la siguiente pieza se
        juzga con la foto de otra.

        Regla: si el buffer no está completo (cualquier status distinto de SUCCESS, p. ej.
        paquetes GVSP perdidos), grab() LANZA una excepción (IncompleteFrame → camera_error,
        DIVERT); nunca devuelve un frame parcial. Los buffers se reciclan, así que las filas
        perdidas pueden traer datos de otra pieza, y el chequeo de brillo medio no lo detecta si
        falta solo una franja: el modelo juzgaría una foto que no es de esta pieza.
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
    # La aprobación vence al INICIAR el turno siguiente (hora local de la planta), no tras N horas:
    # con "8 h desde el check", uno hecho a las 05:50 vencería a las 13:50, antes de que acabe su
    # turno, y los últimos 10 min (≈ 1,200 piezas) irían a un contenedor que procesa 1 cada 15 s.
    shift_starts: tuple[dt.time, ...] = (dt.time(6, 0), dt.time(14, 0))
    early_check_min: int = 30  # un check hecho hasta 30 min antes de un inicio cuenta para ESE turno


def approval_expiry(approved_at: dt.datetime, shift_starts, early_check_min: int) -> dt.datetime:
    """Hasta cuándo vale un golden check aprobado a la hora `approved_at` (hora local de la planta).

    Vence en el primer inicio de turno que quede a más de `early_check_min` del check. Con turnos a
    las 06:00 y 14:00: un check a las 05:50 cuenta para el turno de 06:00 y vence a las 14:00; uno a
    las 06:10 también; uno a las 22:30 (línea parada) vence a las 06:00, y el turno de la mañana
    corre el suyo.
    """
    earliest = approved_at + dt.timedelta(minutes=early_check_min)
    for day in range(3):  # con al menos un inicio por día, siempre hay uno en las próximas 48 h
        for start in sorted(shift_starts):
            candidate = dt.datetime.combine(approved_at.date() + dt.timedelta(days=day), start)
            if candidate > earliest:
                return candidate
    raise ValueError("golden.shift_starts vacío")


def _parse_shift_start(value) -> dt.time:
    """'06:00' → time(6, 0). Exige texto: sin comillas, YAML 1.1 (PyYAML) lee 14:00 como 840 (base 60)."""
    if not isinstance(value, str):
        raise ValueError(f"golden.shift_starts: usa 'HH:MM' entre comillas (llegó {value!r}; "
                         "sin comillas, YAML lee 14:00 como el número 840)")
    return dt.datetime.strptime(value, "%H:%M").time()


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
    golden_raw = dict(raw.get("golden") or {})
    parts = tuple(GoldenPart(**p) for p in golden_raw.pop("parts", []))
    if "shift_starts" in golden_raw:  # hora local de la planta, 'HH:MM'
        golden_raw["shift_starts"] = tuple(_parse_shift_start(v) for v in golden_raw["shift_starts"])
    golden = GoldenConfig(parts=parts, **golden_raw)
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
    if not golden.shift_starts:
        raise ValueError("golden.shift_starts necesita al menos un inicio de turno")
    if not 0 <= golden.early_check_min <= 60:
        raise ValueError("golden.early_check_min debe estar entre 0 y 60")
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
        self._diverts = Counter(  # POR QUÉ se desvió: sin esto, "100 % DIVERT por bad_image" no dispara nada
            "inspection_divert", "Piezas desviadas por razón", ["line", "reason"], registry=registry)
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
        for r in DIVERT_REASONS:  # las 10 razones, fijas: cardinalidad acotada y series desde el arranque
            self._diverts.labels(line, r)
        self.golden_ok.set(0)

    def decision(self, decision: str, reason: str) -> None:
        self._decisions.labels(self.line, decision).inc()
        if decision == DIVERT:
            self._diverts.labels(self.line, reason).inc()


# ---------------------------------------------------------------------------- el inspector
class Inspector:
    """El loop de una línea. Secuencial a propósito: a 2 piezas/s y ≈ 200 ms nominales por pieza
    sobran ≈ 300 ms por ciclo; un pipeline concurrente agregaría errores de emparejar foto y pieza."""

    def __init__(self, cfg: Config, camera: Camera, engine: Engine, plc: PLC, *,
                 clock: Callable[[], float] = time.monotonic,
                 wall_clock: Callable[[], dt.datetime] = dt.datetime.now,
                 registry: Optional[CollectorRegistry] = None,
                 emit: Optional[Callable[[dict], None]] = None,
                 exit_process: Callable[[int], None] = os._exit) -> None:
        self.cfg, self.camera, self.engine, self.plc = cfg, camera, engine, plc
        self.clock = clock  # inyectable: los tests simulan una inferencia de 400 ms sin esperar 400 ms
        # Hora local de la planta, solo para el inicio de turno. En el contenedor, docker-compose.yml
        # monta /etc/localtime del host: sin eso el contenedor vive en UTC y "06:00" serían las 00:00.
        self.wall_clock = wall_clock
        self.thresholds = cfg.thresholds
        self.metrics = Metrics(registry or CollectorRegistry(), cfg.line_id)
        self.emit = emit or log_json  # inyectable: los tests guardan los registros en una lista
        self.exit_process = exit_process  # inyectable: en los tests no se mata pytest
        self.golden_ok: Optional[bool] = None  # None = no se corrió en este proceso o ya venció
        self.golden_valid_until: Optional[float] = None  # clock() en que vence la aprobación
        self.engine_errors_in_a_row = 0
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
        """La aprobación vale hasta el inicio del turno siguiente. Vencida, vuelve a "pendiente"."""
        if self.golden_ok is True and self.golden_valid_until is not None and \
                self.clock() >= self.golden_valid_until:
            self.golden_ok, self.golden_valid_until = None, None
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
        # BadImage (estrobo, lente, exposición) o un frame malformado (None, un buffer 1-D): no se
        # confía en los tipos que devuelve la capa de hardware; nada de esto infiere ni tumba el loop
        except Exception as exc:
            return DIVERT, "bad_image", None, None, exc
        # ¿Cabe la inferencia? Si no, ni lo intentes: el loop se pone al día en vez de atrasar
        # también a la pieza siguiente (load shedding aplicado a una línea de producción).
        if left() - cfg.plc_write_reserve_s < cfg.min_inference_budget_s:
            return DIVERT, "deadline", None, None, None
        try:
            scores = self.engine.infer(image)
        except Exception as exc:  # CUDA, engine corrupto, memoria: DIVERT y que lo vea la alerta
            self.engine_errors_in_a_row += 1  # inspect() sale tras MAX_ENGINE_ERRORS_IN_A_ROW seguidos
            return DIVERT, "engine_error", None, None, exc
        self.engine_errors_in_a_row = 0
        try:
            model = decide(scores, self.thresholds)
        # InvalidScores (NaN, falta un tipo, fuera de rango) o cualquier otra cosa que el Engine
        # devuelva y decide() no sepa leer: nunca un PASS, nunca una excepción que escape
        except Exception as exc:
            return DIVERT, "invalid_scores", scores, None, exc
        if left() < cfg.plc_write_reserve_s:  # el modelo tardó: ya no alcanza a escribir a tiempo
            return DIVERT, "deadline", scores, model, None
        gate = self._gate_reason()
        if model.decision == PASS and gate:  # un REJECT sí se respeta: va a revisión de todas formas
            return DIVERT, gate, scores, model, None
        return model.decision, model.reason, scores, model, None

    def inspect(self, trig: Trigger) -> dict:
        """Una pieza de punta a punta. Siempre devuelve (y loguea) una decisión; nunca lanza.

        Nunca lanza porque una excepción aquí tumba el proceso: Docker lo reinicia, la compuerta
        del golden check arranca cerrada y la línea ENTERA va a inspección manual hasta que el
        operador corra el check. Una pieza rara debe costar una pieza, no un turno.
        """
        cfg = self.cfg
        deadline = trig.t_trigger + cfg.deadline_s  # todo se mide desde el photo-eye, no desde "ahora"

        def left() -> float:  # segundos que quedan del presupuesto de esta pieza
            return deadline - self.clock()

        try:
            decision, reason, scores, model, error = self._model_decision(trig, left)
        except Exception as exc:  # un bug o un caso que nadie previó: DIVERT, y el loop sigue
            decision, reason, scores, model, error = DIVERT, "internal_error", None, None, exc
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
        elif decision != DIVERT:
            # El reloj cruzó la reserva entre el chequeo de _model_decision y este (un log lento,
            # una pausa del GC): no se escribió nada, así que el PLC la desvía. El registro dice
            # lo que pasó FÍSICAMENTE con la pieza, no lo que el modelo alcanzó a decidir.
            decision, reason = DIVERT, "deadline"
        latency = self.clock() - trig.t_trigger
        if reason in DEADLINE_REASONS:
            self.metrics.deadline_miss.inc()
        self.metrics.decision(decision, reason)
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
        if self.engine_errors_in_a_row >= MAX_ENGINE_ERRORS_IN_A_ROW:
            # Contexto CUDA roto: salir y que `restart: unless-stopped` levante un proceso nuevo.
            # os._exit y no sys.exit: liberar la GPU al salir con el contexto roto puede colgarse.
            # Mientras tanto el PLC desvía todo; tras el reinicio hace falta el golden check.
            self.emit({"event": "engine_error_exit", "ts": round(time.time(), 3), "line": cfg.line_id,
                       "errors_in_a_row": self.engine_errors_in_a_row})
            self.exit_process(4)
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
        self.golden_valid_until, valid_until = None, None
        if ok:
            # La hora de pared se lee UNA vez, aquí; el vencimiento se vigila con el reloj
            # monotónico, así un ajuste de NTP a media jornada no lo adelanta ni lo atrasa.
            now = self.wall_clock()
            expires = approval_expiry(now, self.cfg.golden.shift_starts, self.cfg.golden.early_check_min)
            self.golden_valid_until = self.clock() + (expires - now).total_seconds()
            valid_until = expires.isoformat(timespec="minutes")  # el operador ve hasta cuándo vale
        self.metrics.golden_ok.set(1 if ok else 0)
        self.emit({"event": "golden_check", "ts": round(time.time(), 3), "line": self.cfg.line_id,
                   "model_version": self.cfg.model_version, "ok": ok, "valid_until": valid_until,
                   "results": results})
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

    Dos trampas clásicas de integración (van en el contrato con el integrador, README):
      - Direcciones: register 100 es la dirección de PROTOCOLO (base 0) = 40101 en la notación
        4xxxx (base 1) que usan muchos integradores. Con un corrimiento de 1, el PLC leería nuestro
        part_id como si fuera el código. Confírmalo con el integrador.
      - Consumo: el PLC toma el par al deadline de SU pieza y pone el código en 0 (una decisión se
        usa una sola vez). Si no, el par se queda en los registros cuando este proceso deja de
        escribir, y como el part_id es de 16 bits y se repite cada 65,536 piezas (≈ 9.1 h, o antes
        si el contador se reinicia), un PASS viejo podría aplicarse a una pieza sin inspeccionar.
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
            if not self.client.connected:  # sin socket (arranque o error anterior): reconectar
                if timeout_s < 2 * self.timeout_s or not self.client.connect():
                    raise PLCError("sin conexión con el PLC")
            # part_id & 0xFFFF: un registro Modbus es de 16 bits; el PLC solo compara la pieza en curso
            reply = self.client.write_registers(
                self.cfg.register, [part_id & 0xFFFF, PLC_CODES[decision]], device_id=self.cfg.unit_id)
        except (ModbusException, OSError) as exc:
            # Timeout, conexión rechazada o reseteada. Ojo: si el PLC se reinicia y manda un RST,
            # pymodbus lanza el OSError crudo (BrokenPipeError, ConnectionResetError) y deja el
            # socket puesto: `connected` solo mira `socket is not None` y seguiría en True para
            # siempre. Cerrar aquí obliga a reconectar en la escritura siguiente; si no, cada pieza
            # sería plc_error hasta reiniciar el contenedor a mano, y el watchdog no lo ve.
            self.client.close()
            raise PLCError(f"Modbus: {exc!r}") from exc
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
        no llegó → CameraTimeout). REGLA, no sugerencia: si buffer.get_status() !=
        Aravis.BufferStatus.SUCCESS (p. ej. MISSING_PACKETS), devuelve el buffer al stream con
        push_buffer y LANZA IncompleteFrame; nunca pases un frame parcial al modelo.
      - o harvesters 1.4 (pip) + el productor GenTL (.cti) del fabricante de la cámara:
        h.add_file(cti); h.update(); ia = h.create(); ia.start(); with ia.fetch(timeout=s) as buf.
        La misma regla: un buffer que el productor GenTL marca como incompleto no se usa (cómo lo
        expone depende de la versión de harvesters y del productor: confírmalo, no se probó).
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
