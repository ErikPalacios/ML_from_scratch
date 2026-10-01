"""asr-worker (caso c13): una sesión de captions por WebSocket, de audio PCM a partials y finales.

Una conexión = una SESIÓN = la pista de UN participante, conectada toda la reunión (silencios incluidos).
Un STREAM ACTIVO es una sesión con una utterance abierta: solo entonces el modelo tiene una secuencia en la
GPU. Son dos contadores distintos y no se mezclan (caso: ≈ 200k sesiones y ≈ 60k streams activos en el pico):
  asr_sessions        sesiones conectadas: tope de admisión MAX_SESSIONS; el router reparte sesiones
  asr_active_streams  sesiones hablando: tope MAX_STREAMS; KEDA escala por esta (objetivo 350 por GPU)
Lo que pasa adentro:

  handshake JSON  {"type": "start", "session_id", "language", "sample_rate": 16000, "encoding": "pcm_s16le",
                   "reconnect_attempt": 0, "reconnect_reason": null}  → {"type": "ready", …}
  frames binarios PCM16 (20 ms = 640 bytes, o hasta ≈ 2 s por mensaje: se re-encuadra)
  {"type": "keepalive"} (opcional) → cualquier mensaje reinicia MAX_IDLE_S (ver abajo)
    → chunker (VAD + chunks de 160 ms + endpointing a 600 ms de silencio)     streaming/chunker.py
    → cola de entrada ACOTADA → modelo streaming (estado por sesión)           ASRModel (fake en los tests)
    → estabilizador (lo congelado no parpadea)                                 streaming/stabilizer.py
    → cola de salida ACOTADA → {"type": "partial" | "final", "utterance", "seq", "text", "stable_words",
                                "start_ms", "end_ms"}
  {"type": "stop"} → se cierra la utterance abierta, sale su final y se cierra con 1000.

Dónde corre cada cosa en producción (y por qué aquí está todo junto): el caso pone VAD y chunking en el
asr-gateway (CPU, ≈ 200k pistas conectadas) y el modelo en el asr-worker (GPU, ≈ 60k streams activos en el
pico). Esta referencia los junta en un proceso para poder probar el camino completo con TestClient. Partirlo
cambia UNA cosa: con el VAD en el gateway, un participante callado no manda nada al worker (el gateway
manda Chunk y EndOfUtterance, por gRPC streaming bidireccional o este mismo WebSocket). Entonces el gateway
tiene que mandar un keepalive mientras la pista calla (p. ej. cada 10 s), o el límite de inactividad tiene
que mirar el ping del transporte y no el audio. Si no, MAX_IDLE_S cierra a cada persona que se queda
callada 30 s, y la sesión deja de ser "sticky toda la reunión" para reconectarse sin parar.

Lo que un worker hace por su cuenta (y por qué):
  * Backpressure en los DOS sentidos. Entrada: si el modelo va > INBOUND_MAX_CHUNKS chunks atrás (≈ 2 s de
    audio), la GPU no da abasto en tiempo real: se cierra con 1013 (try again later) para que el gateway
    reabra la sesión en otro worker, en lugar de acumular segundos de retraso en silencio. Desde ese
    momento el modelo no procesa nada más de esa sesión (la GPU ya está saturada) y no sale ningún partial
    después del error. Excepción acotada: una reconexión puede traer de golpe la frase en curso, y ese
    atraso (hasta MAX_UTTERANCE_MS) se admite una vez por sesión. Mientras va atrás, se saltan los partials
    intermedios (el modelo procesa todo el audio, pero solo se muestra el último). Salida: si quien consume no lee, se descartan los partials más viejos (los reemplaza uno más
    nuevo); un final no se descarta nunca: si no cabe ni descartando partials, se cierra con 1013.
  * Admisión: con MAX_SESSIONS sesiones, o con MAX_STREAMS streams activos (la GPU ya está en su tope),
    /readyz da 503 y el handshake responde 1013 "capacity". A las sesiones que ya tiene no las corta por
    empezar a hablar: si eso satura la GPU, actúa el backpressure de entrada.
  * Límites por sesión: MAX_SESSION_S (4 h: una reunión larga reabre sesión, el gateway lo hace solo),
    MAX_IDLE_S (30 s sin un solo mensaje, audio o keepalive: la pista murió y la sesión se libera) y el
    ritmo del audio: más de MAX_AUDIO_RATE × el tiempo transcurrido + AUDIO_BURST_MS (+ MAX_UTTERANCE_MS en
    una reconexión, por el reenvío de la frase en curso) cierra con 1008. Un gateway con un bug que manda
    audio sin pausa no puede tener ocupado el event loop que comparten todas las sesiones del worker. El
    tamaño de cada mensaje lo acota uvicorn (--ws-max-size 65536 ≈ 2 s de audio; más grande → 1009).
  * Drain: POST /admin/drain (solo desde localhost: lo llama el preStop de k8s/asr-worker.yaml). /readyz
    pasa a 503 (el router deja de asignar), y cada sesión, en su próximo límite de utterance (después del
    final; si la frase siguiente ya empezó, después del final de esa, una sola vez), recibe
    {"type": "migrate"} y se cierra con 1012: el gateway la reabre en otro worker sin perder texto, porque
    entre utterances no hay estado que perder.
  * Métricas Prometheus en /metrics (los nombres los usan monitoring/alerts.yml y el autoscaling).
  * Privacidad: nunca se loguea texto ni audio. El log por sesión tiene ids, duraciones y contadores.

Endpoints: WS /v1/stream · GET /healthz · GET /readyz · GET /metrics · POST /admin/drain · GET /admin/status
Demo local con el modelo falso: `uvicorn --factory asr_server:demo_app --port 8080` y, en otra terminal,
`python asr_server.py demo-client` (manda ≈ 4.75 s de audio sintético a ritmo real e imprime lo que vuelve).
"""

from __future__ import annotations  # anotaciones como texto: sintaxis moderna sin costo en runtime

import asyncio  # una tarea lectora, una que procesa y una que escribe por sesión
import hashlib  # muestreo determinista de sesiones para el log de latencias (hash() cambia entre procesos)
import json  # protocolo de control y logs
import logging  # a stdout: en un contenedor los logs son un stream
import os  # configuración por variables de entorno
import sys  # stdout explícito y argv del modo CLI (drain / demo-client)
import time  # monotonic para latencias y límites (no salta con NTP)
from collections import deque  # cola de salida con descarte selectivo
from dataclasses import dataclass, field  # configuración y contratos simples
from typing import Any, Callable, Protocol  # interfaces sin herencia: el fake y el real solo cumplen la forma

from fastapi import FastAPI, Request, Response, WebSocket  # framework ASGI (WebSocket vía Starlette)
from fastapi.responses import JSONResponse  # 503 de readiness y 403 de admin
from prometheus_client import (  # /metrics
    CONTENT_TYPE_LATEST,
    CollectorRegistry,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
)
from starlette.websockets import WebSocketDisconnect, WebSocketState  # fin de conexión del lado del cliente

from chunker import Chunk, ChunkerConfig, EndOfUtterance, Reframer, StreamChunker  # streaming/chunker.py
from stabilizer import Stabilizer, Word  # streaming/stabilizer.py

log = logging.getLogger("asr_server")

# Códigos de cierre de WebSocket. 1000, 1008 y 1011 son de la RFC 6455; 1012 y 1013 están en el registro
# de IANA. El gateway decide qué hacer según el código, así que son parte del contrato.
CLOSE_NORMAL = 1000  # stop del cliente, límite de duración o de inactividad
CLOSE_POLICY = 1008  # handshake inválido o audio más rápido que el tiempo real: reintentar igual no sirve
CLOSE_INTERNAL = 1011  # el modelo falló: reabrir en otro worker
CLOSE_SERVICE_RESTART = 1012  # drain / apagado: reabrir en otro worker (esperado, no es una falla)
CLOSE_TRY_AGAIN = 1013  # sin capacidad, sobrecargado o consumidor lento: reabrir en otro worker


# ---------------------------------------------------------------------------- configuración
@dataclass
class Settings:
    # Idiomas de lanzamiento del caso (BCP 47): español de Latinoamérica, inglés de EE. UU., portugués de
    # Brasil. Se valida contra esta lista porque el idioma es label de métricas (cardinalidad acotada).
    languages: tuple[str, ...] = tuple(os.getenv("ASR_LANGUAGES", "es-419,en-US,pt-BR").split(","))
    # Tope de STREAMS ACTIVOS por worker (sesiones con una utterance abierta = secuencias en la GPU). Caso:
    # ≈ 500 por L4 (estimación, mídelo con el modelo real y chunks de 160 ms); 450 = 90 % de eso. El
    # autoscaling apunta a 350 en promedio (70 % de ≈ 500): la diferencia hasta 450 es el colchón para la
    # rampa de la mañana mientras llegan nodos. Llegar a 450 deja al worker fuera de la rotación (readyz 503).
    max_streams: int = int(os.getenv("MAX_STREAMS", "450"))
    # Tope de SESIONES conectadas (la capacidad que usa el router). Solo ≈ 30 % de las pistas tiene voz en
    # un momento dado (≈ 60k de ≈ 200k en el pico): 450 ÷ 0.3 = 1,500 (ilustrativo). En régimen, cada worker
    # tiene ≈ 1,170 sesiones para ≈ 350 streams activos. Una sesión callada cuesta CPU y memoria (≈ KB del
    # chunker), no GPU.
    max_sessions: int = int(os.getenv("MAX_SESSIONS", "1500"))
    max_session_s: float = float(os.getenv("MAX_SESSION_S", "14400"))  # 4 h; ver docstring
    max_idle_s: float = float(os.getenv("MAX_IDLE_S", "30"))  # sin NINGÚN mensaje (audio o keepalive)
    # Ritmo máximo del audio (ilustrativo): hasta 2× el tiempo real más 2 s de ráfaga (jitter de red). En una
    # reconexión se suma MAX_UTTERANCE_MS una vez: el gateway reenvía la frase en curso desde su buffer.
    max_audio_rate: float = float(os.getenv("MAX_AUDIO_RATE", "2.0"))
    audio_burst_ms: int = int(os.getenv("AUDIO_BURST_MS", "2000"))
    handshake_timeout_s: float = float(os.getenv("HANDSHAKE_TIMEOUT_S", "5"))
    inbound_max_chunks: int = int(os.getenv("INBOUND_MAX_CHUNKS", "12"))  # 12 × 160 ms ≈ 2 s de audio atrasado
    outbound_max_messages: int = int(os.getenv("OUTBOUND_MAX_MESSAGES", "32"))
    freeze_after_ms: int = int(os.getenv("FREEZE_AFTER_MS", "800"))  # estabilizador (ilustrativo)
    drain_timeout_s: float = float(os.getenv("DRAIN_TIMEOUT_S", "60"))  # el preStop (modo CLI `drain`) espera esto
    # Fracción de sesiones que loguean la latencia de CADA mensaje (eval/wer.py calcula percentiles con
    # esos logs). 1 %: con ≈ 60k streams en el pico alcanza para p99 por idioma sin inundar los logs.
    latency_log_rate: float = float(os.getenv("LATENCY_LOG_RATE", "0.01"))
    chunker: ChunkerConfig = field(default_factory=lambda: ChunkerConfig(
        chunk_ms=int(os.getenv("CHUNK_MS", "160")),
        left_context_ms=int(os.getenv("LEFT_CONTEXT_MS", "0")),  # 0: el modelo cache-aware guarda su contexto
        endpoint_silence_ms=int(os.getenv("ENDPOINT_SILENCE_MS", "600")),
        max_utterance_ms=int(os.getenv("MAX_UTTERANCE_MS", "20000")),
    ))


# ---------------------------------------------------------------------------- modelo (interfaz + fake)
class ASRModel(Protocol):
    """Lo único que el server sabe del modelo. `model_version` va en el mensaje "ready" (el adaptador real lo
    lee de MODEL_VERSION, el tag de la imagen): cada transcript queda atado al modelo que lo produjo. El
    adaptador real (Riva/NeMo/Triton con sequence batching) cumple esta forma; el fake de abajo también.

    En la GPU real, step() de MUCHAS sesiones se junta en un batch (el estado de cada una entra y sale del
    batch): eso es lo que hace caber ≈ 500 streams en una L4. Aquí cada sesión llama step() por su cuenta;
    el batching vive dentro del adaptador o del servidor de inferencia, no en este archivo.
    """

    model_version: str

    # Una SECUENCIA POR UTTERANCE (el diseño del caso): la caché del modelo en la GPU existe entre el primer
    # step() de una utterance y su finalize(). Entre utterances la sesión no ocupa GPU, y por eso puede
    # migrar a otro worker sin perder nada.
    def open_stream(self, language: str) -> Any: ...  # estado de la sesión del lado del adaptador (idioma, ids)

    async def step(self, state: Any, chunk: Chunk) -> list[Word]: ...  # hipótesis actual de la utterance

    async def finalize(self, state: Any) -> list[Word]: ...  # hipótesis final; cierra la secuencia en la GPU

    def close_stream(self, state: Any) -> None: ...  # liberar lo que quede (también si la sesión falló)


class FakeStreamingASR:
    """Modelo falso y determinista: una palabra por chunk; la última de cada partial sale "a medias"
    (sin su última letra) para que haya flicker que estabilizar. NO es un modelo: sirve para probar el
    camino del server (tiempos, colas, límites, drain), no la calidad."""

    VOCAB = ("hola", "a", "todos", "hoy", "vamos", "a", "revisar", "el", "plan", "de", "la", "semana")

    def __init__(self, step_delay_s: float = 0.0, flicker: bool = True, fail_at_step: int | None = None,
                 model_version: str = "fake-streaming-asr") -> None:
        self.step_delay_s = step_delay_s  # simula el tiempo de GPU (o una GPU saturada)
        self.flicker = flicker
        self.fail_at_step = fail_at_step  # para probar el cierre con 1011
        self.model_version = model_version
        self.open_streams = 0  # los tests verifican que cada estado se libera

    def open_stream(self, language: str) -> dict:
        self.open_streams += 1
        return {"language": language, "words": [], "steps": 0}

    async def step(self, state: dict, chunk: Chunk) -> list[Word]:
        if self.step_delay_s:
            await asyncio.sleep(self.step_delay_s)
        state["steps"] += 1
        if self.fail_at_step is not None and state["steps"] >= self.fail_at_step:
            raise RuntimeError("fallo simulado del modelo")
        k = len(state["words"])
        text = self.VOCAB[(chunk.utterance * 7 + k) % len(self.VOCAB)]
        state["words"].append(Word(text, chunk.start_ms, chunk.end_ms))
        words = list(state["words"])
        if self.flicker and len(words[-1].text) > 1:
            last = words[-1]
            words[-1] = Word(last.text[:-1], last.start_ms, last.end_ms)  # todavía "no se decide"
        return words

    async def finalize(self, state: dict) -> list[Word]:
        words, state["words"] = state["words"], []
        return words

    def close_stream(self, state: dict) -> None:
        self.open_streams -= 1


# ---------------------------------------------------------------------------- métricas
class Metrics:
    """Un registry por app: los tests crean varias apps sin chocar con el registry global."""

    def __init__(self, registry: CollectorRegistry | None = None) -> None:
        r = self.registry = registry or CollectorRegistry()
        # Señal de autoscaling: streams activos AHORA en este worker = sesiones con una utterance abierta (lo
        # que ocupa la GPU). No son las sesiones conectadas ni requests por segundo.
        self.active = Gauge("asr_active_streams", "Sesiones con una utterance abierta (secuencias en la GPU)",
                            registry=r)
        # Capacidad que este worker ofrece: MAX_STREAMS, o 0 si está drenando (no recibe sesiones nuevas)
        self.capacity = Gauge("asr_stream_capacity", "Streams que este worker acepta (0 si drena)", registry=r)
        # Sesiones conectadas (habla o no) y su tope: lo que reparte el router y lo que espera el drain
        self.sessions = Gauge("asr_sessions", "Sesiones conectadas en este worker", registry=r)
        self.session_capacity = Gauge("asr_session_capacity", "Sesiones que este worker acepta (0 si drena)",
                                      registry=r)
        self.draining = Gauge("asr_draining", "1 si el worker está drenando", registry=r)
        self.started = Counter("asr_sessions_started_total", "Sesiones aceptadas", ["language"], registry=r)
        self.ended = Counter("asr_sessions_ended_total", "Sesiones terminadas", ["reason"], registry=r)
        self.rejected = Counter("asr_sessions_rejected_total", "Sesiones rechazadas en el handshake",
                                ["reason"], registry=r)
        # Reconexiones: el handshake dice si es un reintento y por qué (worker_lost, network, migrate,
        # max_duration). La alerta separa las planeadas (migrate, max_duration) de las otras.
        self.reconnects = Counter("asr_reconnects_total", "Handshakes que reabren una sesión existente",
                                  ["reason"], registry=r)
        # Latencias SERVER-SIDE (ver docstring de StreamSession): buckets exactos en los umbrales de alerta
        self.partial_latency = Histogram(
            "asr_partial_latency_seconds", "Chunk completo → partial escrito al socket", ["language"],
            buckets=(0.025, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.5, 1.0, 2.5), registry=r)
        self.final_latency = Histogram(
            "asr_final_latency_seconds", "Último frame con voz → final escrito al socket", ["language"],
            buckets=(0.6, 0.7, 0.8, 0.9, 1.0, 1.2, 1.5, 2.0, 3.0, 5.0), registry=r)
        # Tiempo de un paso del modelo. Si se acerca a la duración del chunk (160 ms), el worker deja de
        # ir en tiempo real: GPUStreamSaturation mira el p95 contra 128 ms (80 %).
        self.step = Histogram(
            "asr_model_step_seconds", "Duración de un paso del modelo por chunk",
            buckets=(0.005, 0.01, 0.02, 0.04, 0.06, 0.08, 0.1, 0.128, 0.16, 0.25, 0.5), registry=r)
        self.dropped = Counter("asr_dropped_messages_total", "Mensajes no enviados", ["type", "reason"],
                               registry=r)
        # Frames por decisión del VAD: VADActiveRatioShift compara la fracción de voz con la semana pasada
        self.vad_frames = Counter("asr_vad_frames_total", "Frames de 20 ms por decisión del VAD", ["decision"],
                                  registry=r)


# ---------------------------------------------------------------------------- transporte
class Transport(Protocol):
    """Lo que la sesión necesita del socket. El adaptador de Starlette está abajo; los tests usan fakes."""

    async def receive(self) -> bytes | str | None: ...  # None = el cliente se fue

    async def send_json(self, msg: dict) -> None: ...

    async def close(self, code: int, reason: str) -> None: ...


class StarletteTransport:
    def __init__(self, ws: WebSocket) -> None:
        self.ws = ws

    async def receive(self) -> bytes | str | None:
        msg = await self.ws.receive()  # mensaje ASGI crudo: binario, texto o desconexión
        if msg["type"] == "websocket.disconnect":
            return None
        return msg["bytes"] if msg.get("bytes") is not None else msg.get("text", "")

    async def send_json(self, msg: dict) -> None:
        await self.ws.send_text(json.dumps(msg, ensure_ascii=False, separators=(",", ":")))

    async def close(self, code: int, reason: str) -> None:
        if self.ws.application_state != WebSocketState.DISCONNECTED:
            await self.ws.close(code=code, reason=reason)


class OutboundBuffer:
    """Cola de salida acotada que sabe qué se puede tirar: partials sí (uno nuevo reemplaza al viejo),
    finales y mensajes de control no."""

    def __init__(self, maxsize: int) -> None:
        self.maxsize = maxsize
        self._q: deque[dict] = deque()
        self._ready = asyncio.Event()

    def offer(self, msg: dict) -> tuple[bool, int]:
        """Encola. Devuelve (cabe, partials descartados). (False, n) = ni descartando partials cabe."""
        dropped = 0
        while len(self._q) >= self.maxsize:
            idx = next((i for i, m in enumerate(self._q) if m.get("type") == "partial"), None)
            if idx is None:
                if msg.get("type") == "partial":
                    return True, dropped + 1  # el partial nuevo es el que sobra (lo reemplazará otro)
                return False, dropped  # solo hay finales/control: quien consume no está leyendo
            del self._q[idx]  # el partial más viejo pierde: el texto nuevo lo incluye
            dropped += 1
        self._q.append(msg)
        self._ready.set()
        return True, dropped

    def append_control(self, msg: dict) -> None:
        """Marcador interno de cierre: entra aunque la cola esté llena (no es un mensaje al cliente)."""
        self._q.append(msg)
        self._ready.set()

    async def get(self) -> dict:
        while not self._q:
            self._ready.clear()
            await self._ready.wait()
        return self._q.popleft()

    def __len__(self) -> int:
        return len(self._q)


# ---------------------------------------------------------------------------- sesión
_END, _DRAIN = object(), object()  # marcadores internos de la cola de entrada
# Motivos de cierre en los que ya no hay a quién mostrarle nada (o la GPU no da abasto): el procesador deja de
# llamar al modelo en lugar de gastar hasta ≈ 2 s de GPU en chunks que nadie va a ver.
_ABORT = frozenset({"overloaded", "slow_consumer", "client_gone", "error", "audio_too_fast"})


class StreamSession:
    """Una sesión: tres tareas (leer, procesar, escribir) conectadas por colas acotadas.

    Latencias que mide (server-side; el SLO del caso es de punta a punta y suma red, caption-bus y cliente):
      partial: desde que llegó el último frame del chunk hasta que el partial se escribió al socket
               (cola + paso del modelo + cola de salida). No incluye esperar a que el chunk se llene.
      final:   desde que llegó el último frame CON voz hasta que el final se escribió: incluye los 600 ms de
               silencio del endpointing, que son la mayor parte.
    """

    def __init__(self, session_id: str, language: str, transport: Transport, model: ASRModel,
                 settings: Settings, metrics: Metrics, log_latency: bool = False,
                 clock: Callable[[], float] = time.monotonic, reconnect: bool = False,
                 on_active_change: Callable[[int], None] | None = None) -> None:
        self.session_id, self.language = session_id, language
        self.t, self.model, self.s, self.m = transport, model, settings, metrics
        self.clock = clock
        self.log_latency = log_latency
        self.reconnect = reconnect  # una reconexión puede traer de golpe la frase en curso (ritmo del audio)
        # Y esa frase (hasta MAX_UTTERANCE_MS) llega más rápido de lo que el modelo la procesa: la cola de
        # entrada puede pasarse de INBOUND_MAX_CHUNKS por esa cantidad de chunks, UNA vez por sesión. Sin esto,
        # el reenvío que promete el caso cerraría la sesión nueva con 1013 "overloaded".
        self.replay_chunks = settings.chunker.max_utterance_ms // settings.chunker.chunk_ms if reconnect else 0
        self.on_active_change = on_active_change  # la app suma ±1 a asr_active_streams
        self._active = False  # ¿esta sesión es un stream activo (utterance abierta)?
        self.audio_bytes = 0  # audio recibido: el límite de ritmo lo compara con el reloj
        self.reframer = Reframer()
        self.chunker = StreamChunker(settings.chunker)
        self.inbound: asyncio.Queue = asyncio.Queue()  # sin maxsize: el límite se aplica solo a chunks (abajo)
        self.outbound = OutboundBuffer(settings.outbound_max_messages)
        self.queued_chunks = 0  # chunks esperando al modelo (el backpressure de entrada mira esto)
        self.seq = 0  # número de mensaje en la sesión: el consumidor descarta duplicados y desordenados
        self.end_reason: str | None = None
        self.close_code = CLOSE_NORMAL
        self.client_gone = False
        self.utterances = self.partials = self.finals = 0
        self._last_speech_wall = 0.0
        self._utt_open = False  # ¿el modelo tiene una utterance a medias? (drain espera a que cierre)
        self._migrate_after_final = False
        self._boundaries_waited = 0  # finales en los que el drain no pudo migrar (la frase siguiente ya empezó)

    # -- API para la app
    def request_drain(self) -> None:
        self.inbound.put_nowait(_DRAIN)

    def _finish(self, reason: str, code: int) -> None:
        if self.end_reason is None:  # la primera causa gana (p. ej. idle y luego desconexión)
            self.end_reason, self.close_code = reason, code

    @property
    def active(self) -> bool:
        """Stream activo = hay una utterance abierta: en el chunker (llega audio con voz) o en el modelo
        (falta su finalize). Entre utterances la sesión sigue conectada, pero no ocupa GPU."""
        return self.chunker.in_utterance or self._utt_open

    def _update_active(self, force_off: bool = False) -> None:
        now = False if force_off else self.active
        if now != self._active:
            self._active = now
            if self.on_active_change is not None:
                self.on_active_change(1 if now else -1)

    def _aborted(self) -> bool:
        return self.end_reason in _ABORT

    async def run(self) -> None:
        reader = asyncio.create_task(self._read_loop())
        writer = asyncio.create_task(self._write_loop())
        state = self.model.open_stream(self.language)
        try:
            await self._process_loop(state)
        except Exception:  # el modelo u otra cosa falló: la sesión se cierra, el worker sigue vivo
            log.exception("session %s failed", self.session_id)
            self._finish("error", CLOSE_INTERNAL)
            self.outbound.offer({"type": "error", "code": "internal", "message": "ASR failure"})
        finally:
            self.model.close_stream(state)  # liberar memoria de GPU pase lo que pase
            reader.cancel()
            self._update_active(force_off=True)  # la sesión deja de contar como stream activo
            self.outbound.append_control({"type": "_close"})  # el writer termina después de vaciar la cola
            try:
                await asyncio.wait_for(writer, timeout=2.0)  # dar tiempo a que salga el último final
            except (asyncio.TimeoutError, asyncio.CancelledError):
                writer.cancel()
            if not self.client_gone:
                await self.t.close(self.close_code, self.end_reason or "")
            self._log_summary()

    # -- lectura: audio → chunker → cola de entrada
    async def _read_loop(self) -> None:
        started = self.clock()
        try:
            while True:
                remaining = self.s.max_session_s - (self.clock() - started)
                if remaining <= 0:
                    self._finish("max_duration", CLOSE_NORMAL)
                    break
                try:
                    msg = await asyncio.wait_for(self.t.receive(), timeout=min(self.s.max_idle_s, remaining))
                except asyncio.TimeoutError:
                    if self.clock() - started >= self.s.max_session_s:
                        self._finish("max_duration", CLOSE_NORMAL)
                    else:
                        self._finish("idle", CLOSE_NORMAL)  # ni un mensaje en MAX_IDLE_S: liberar la sesión
                    break
                if msg is None:
                    self.client_gone = True
                    self._finish("client_gone", CLOSE_NORMAL)
                    break
                if isinstance(msg, bytes):
                    # Ritmo ANTES de procesar: un mensaje enorme o una ráfaga sin fin no llega al chunker (que
                    # corre en el event loop de todas las sesiones). 16 kHz × 2 bytes = 32 bytes por ms.
                    self.audio_bytes += len(msg)
                    elapsed_ms = (self.clock() - started) * 1000
                    allowed_ms = (self.s.max_audio_rate * elapsed_ms + self.s.audio_burst_ms
                                  + (self.s.chunker.max_utterance_ms if self.reconnect else 0))
                    if self.audio_bytes / 32 > allowed_ms:
                        self._finish("audio_too_fast", CLOSE_POLICY)
                        self.outbound.offer({"type": "error", "code": "audio_too_fast",
                                             "message": "audio faster than real time"})
                        break
                    ok = self._on_audio(msg)
                    self._update_active()
                    if not ok:
                        break  # sobrecargado: ya se marcó el cierre
                else:
                    try:
                        ctrl = json.loads(msg)
                    except ValueError:
                        ctrl = {}
                    if isinstance(ctrl, dict) and ctrl.get("type") == "stop":
                        self._finish("normal", CLOSE_NORMAL)
                        break
                    # Cualquier otro texto ({"type": "keepalive"} o tipos que este worker no conoce) se ignora,
                    # pero ya reinició el plazo de MAX_IDLE_S: el gateway con VAD propio lo usa en los silencios
        except WebSocketDisconnect:
            self.client_gone = True
            self._finish("client_gone", CLOSE_NORMAL)
        finally:
            if not self.client_gone and self.end_reason not in ("overloaded", "audio_too_fast"):
                for ev in self.chunker.flush():  # cerrar la utterance abierta: su final sí sale
                    self._enqueue(ev, force=True)
            self.inbound.put_nowait(_END)

    def _on_audio(self, data: bytes) -> bool:
        now = self.clock()
        for frame in self.reframer.push(data):
            events = self.chunker.feed(frame)
            d = self.chunker.last_decision
            self.m.vad_frames.labels("speech" if d.is_speech else "silence").inc()
            if d.raw_speech:
                self._last_speech_wall = now  # desde aquí se mide la latencia del final
            for ev in events:
                if not self._enqueue(ev, force=False):
                    self._finish("overloaded", CLOSE_TRY_AGAIN)
                    self.outbound.offer({"type": "error", "code": "overloaded",
                                         "message": "worker behind real time; reconnect"})
                    return False
        return True

    def _enqueue(self, ev: Chunk | EndOfUtterance, force: bool) -> bool:
        if isinstance(ev, Chunk):
            if not force and self.queued_chunks >= self.s.inbound_max_chunks:
                if self.replay_chunks <= 0:
                    return False  # el modelo va ≈ 2 s atrás: no acumular más retraso
                self.replay_chunks -= 1  # el reenvío de una reconexión: atraso esperado y acotado
            self.queued_chunks += 1
            self.inbound.put_nowait((ev, self.clock()))
        else:
            self.inbound.put_nowait((ev, self._last_speech_wall))
        return True

    # -- proceso: cola de entrada → modelo → estabilizador → cola de salida
    async def _process_loop(self, state: Any) -> None:
        stab = Stabilizer(self.s.freeze_after_ms)
        while True:
            item = await self.inbound.get()
            if item is _END or self._aborted():
                return  # sobrecarga, consumidor lento o cliente ido: lo que queda en la cola no lo ve nadie
            if item is _DRAIN:
                # Entre utterances (ni el modelo ni el chunker tienen una abierta) no hay nada que perder:
                # migrar ya. Si alguien está hablando, migrar después de su final.
                if not self._utt_open and not self.chunker.in_utterance and self.queued_chunks == 0:
                    self._migrate()
                    return
                self._migrate_after_final = True
                continue
            ev, t_ref = item
            if isinstance(ev, Chunk):
                self.queued_chunks -= 1
                t0 = self.clock()
                words = await self.model.step(state, ev)
                self.m.step.observe(self.clock() - t0)
                self._utt_open = True
                self._update_active()
                if self._aborted():
                    return  # se decidió cerrar mientras el modelo trabajaba: ni un partial después del error
                if self.queued_chunks > 0:
                    # Vamos atrás: el modelo procesa todo el audio (su estado lo necesita), pero solo se
                    # muestra el partial del chunk más nuevo. Los intermedios no pasan por el estabilizador:
                    # la pantalla no cambió, así que no hay nada nuevo que congelar; el partial del chunk más
                    # nuevo sí pasa.
                    self.m.dropped.labels("partial", "behind").inc()
                    continue
                display = stab.partial(words, ev.end_ms)
                self._emit({"type": "partial", "utterance": ev.utterance, "text": display.text,
                            "stable_words": len(display.frozen),
                            "start_ms": words[0].start_ms if words else ev.start_ms, "end_ms": ev.end_ms}, t_ref)
                self.partials += 1
            else:  # EndOfUtterance
                words = await self.model.finalize(state)
                display, _ = stab.final(words)
                stab = Stabilizer(self.s.freeze_after_ms)  # la utterance siguiente empieza de cero
                self._utt_open = False
                self._update_active()  # la secuencia salió de la GPU (salvo que el chunker ya abrió otra)
                self.utterances += 1
                if self._aborted():
                    return
                if words:  # una utterance sin palabras (un ruido que pasó el VAD) no genera final vacío
                    self._emit({"type": "final", "utterance": ev.utterance, "text": display.text,
                                "start_ms": words[0].start_ms, "end_ms": words[-1].end_ms}, t_ref)
                    self.finals += 1
                # Migrar solo si tampoco empezó la utterance SIGUIENTE (un corte por el tope de 20 s con la
                # persona hablando): su pre-roll y su comienzo están en el chunker y se perderían. Si empezó,
                # se espera a su final, UNA vez: 20.6 + 20.6 s caben en el drain de 60 s. Un monólogo que se
                # encadena otra vez migra en el segundo final y pierde a lo sumo ese comienzo (< 160 ms: si
                # hubiera un chunk entero, estaría en la cola), no la frase entera que cortaría el SIGTERM.
                if self._migrate_after_final:
                    if self.queued_chunks == 0 and (not self.chunker.in_utterance or self._boundaries_waited):
                        self._migrate()
                        return
                    self._boundaries_waited += 1

    def _migrate(self) -> None:
        self._finish("migrate", CLOSE_SERVICE_RESTART)
        self._emit({"type": "migrate", "reason": "draining"}, None)

    def _emit(self, msg: dict, t_ref: float | None) -> None:
        self.seq += 1
        msg["seq"] = self.seq
        if t_ref is not None:
            msg["_t"] = t_ref  # interno: se quita antes de enviar (latencia hasta el socket)
        ok, dropped = self.outbound.offer(msg)
        if dropped:
            self.m.dropped.labels("partial", "slow_consumer").inc(dropped)
        if not ok:
            # Ni descartando partials cabe un final: quien consume no lee. Cerrar y que reabra en otro lado.
            self.m.dropped.labels(msg["type"], "slow_consumer").inc()
            self._finish("slow_consumer", CLOSE_TRY_AGAIN)
            self.inbound.put_nowait(_END)

    # -- escritura: cola de salida → socket
    async def _write_loop(self) -> None:
        while True:
            msg = await self.outbound.get()
            if msg.get("type") == "_close":
                return
            t_ref = msg.pop("_t", None)
            try:
                await self.t.send_json(msg)
            except Exception:  # socket cerrado del otro lado: no hay a quién escribirle
                self.client_gone = True
                self._finish("client_gone", CLOSE_NORMAL)
                self.inbound.put_nowait(_END)
                return
            if t_ref is None:
                continue
            latency = self.clock() - t_ref
            if msg["type"] == "partial":
                self.m.partial_latency.labels(self.language).observe(latency)
            elif msg["type"] == "final":
                self.m.final_latency.labels(self.language).observe(latency)
            if self.log_latency:  # el formato que lee eval/wer.py:latency_percentiles
                log.info(json.dumps({"event": "caption_latency", "session_id": self.session_id,
                                     "language": self.language, "type": msg["type"],
                                     "latency_ms": round(latency * 1000, 1)}))

    def _log_summary(self) -> None:
        # Sin texto ni audio: ids, idioma, contadores. El transcript vive en otro lado y solo si el host lo pidió.
        log.info(json.dumps({"event": "session_end", "session_id": self.session_id, "language": self.language,
                             "reason": self.end_reason, "utterances": self.utterances,
                             "partials": self.partials, "finals": self.finals,
                             "vad_speech_ratio": round(self.chunker.speech_frames / max(self.chunker.frames_total, 1), 3)}))


# ---------------------------------------------------------------------------- app
def _sampled(session_id: str, rate: float) -> bool:
    """Muestreo determinista por session_id: una sesión reconectada sigue (o no) en la muestra."""
    h = int.from_bytes(hashlib.sha256(session_id.encode()).digest()[:8], "big")
    return h / 2**64 < rate


def create_app(model: ASRModel, settings: Settings | None = None, metrics: Metrics | None = None) -> FastAPI:
    s = settings or Settings()
    m = metrics or Metrics()
    sessions: set[StreamSession] = set()
    state = {"draining": False, "active": 0}  # active = streams activos (sesiones con una utterance abierta)
    m.capacity.set(s.max_streams)
    m.session_capacity.set(s.max_sessions)
    # Sin lógica de apagado propia, a propósito: con SIGTERM, uvicorn 0.54 cierra cada WebSocket abierto con
    # 1012 ANTES del lifespan shutdown (en su código: protocols/websockets/*_impl.py, shutdown(); y probado
    # con la demo: kill -TERM al server y el cliente recibe 1012). Lo que da un corte limpio es el drain del
    # preStop; lo que quede abierto al vencer DRAIN_TIMEOUT_S recibe ese 1012, el gateway reabre la sesión
    # en otro worker y se pierden los partials de ≈ 1–2 s y el final de la utterance que estaba abierta.
    app = FastAPI(title="asr-worker")
    app.state.sessions, app.state.metrics, app.state.flags = sessions, m, state

    def on_active_change(delta: int) -> None:
        state["active"] += delta
        m.active.set(state["active"])

    def full() -> bool:
        # Lleno si la GPU ya está en su tope de streams activos O no entran más sesiones. Las dos cosas sacan
        # al worker de la rotación (readyz 503) y rechazan handshakes nuevos con 1013.
        return state["active"] >= s.max_streams or len(sessions) >= s.max_sessions

    def counts() -> dict:
        return {"sessions": len(sessions), "active_streams": state["active"]}

    def start_drain() -> None:
        if state["draining"]:
            return
        state["draining"] = True
        m.draining.set(1)
        m.capacity.set(0)  # el fleet deja de contar este worker como capacidad libre
        m.session_capacity.set(0)
        for sess in list(sessions):
            sess.request_drain()

    @app.websocket("/v1/stream")
    async def stream(ws: WebSocket) -> None:
        await ws.accept()  # aceptar primero para poder explicar un rechazo con un mensaje JSON
        transport = StarletteTransport(ws)

        async def reject(reason: str, code: int, message: str) -> None:
            m.rejected.labels(reason).inc()
            try:
                await transport.send_json({"type": "error", "code": reason, "message": message})
                await transport.close(code, reason)
            except Exception:  # el cliente ya se fue: no hay a quién explicarle
                pass

        try:
            raw = await asyncio.wait_for(ws.receive_text(), timeout=s.handshake_timeout_s)
            hs = json.loads(raw)
            if not isinstance(hs, dict):
                raise ValueError("handshake must be a JSON object")
        except WebSocketDisconnect:
            return  # se fue antes del handshake: nada que contar como sesión
        except (asyncio.TimeoutError, ValueError, KeyError, RuntimeError):
            # KeyError: llegó un frame binario antes del JSON (receive_text no lo acepta)
            return await reject("bad_handshake", CLOSE_POLICY, "send a JSON start message first")
        sid, lang = hs.get("session_id"), hs.get("language")
        if not (hs.get("type") == "start" and isinstance(sid, str) and 0 < len(sid) <= 128):
            return await reject("bad_handshake", CLOSE_POLICY, "start message needs a session_id")
        if lang not in s.languages:
            return await reject("bad_handshake", CLOSE_POLICY, f"language must be one of {list(s.languages)}")
        if hs.get("sample_rate") != 16000 or hs.get("encoding", "pcm_s16le") != "pcm_s16le":
            # El fork del SFU decodifica Opus (48 kHz) y remuestrea a 16 kHz mono: otra cosa es un bug del cliente
            return await reject("bad_handshake", CLOSE_POLICY, "audio must be pcm_s16le at 16000 Hz mono")
        if state["draining"]:
            # El router no debería mandar aquí (readyz ya da 503), pero puede haber una carrera
            return await reject("draining", CLOSE_TRY_AGAIN, "worker draining; reconnect elsewhere")
        if full():
            return await reject("capacity", CLOSE_TRY_AGAIN, "worker full; reconnect elsewhere")
        attempt = hs.get("reconnect_attempt") or 0
        reconnect = isinstance(attempt, int) and attempt > 0
        if reconnect:
            reason = str(hs.get("reconnect_reason") or "unknown")
            known = {"worker_lost", "network", "migrate", "max_duration", "overloaded"}
            m.reconnects.labels(reason if reason in known else "unknown").inc()  # label acotado

        sess = StreamSession(sid, lang, transport, model, s, m, log_latency=_sampled(sid, s.latency_log_rate),
                             reconnect=reconnect, on_active_change=on_active_change)
        sessions.add(sess)
        m.sessions.set(len(sessions))  # una sesión nueva está callada: todavía no es un stream activo
        m.started.labels(lang).inc()
        try:
            await transport.send_json({"type": "ready", "session_id": sid, "model_version": model.model_version,
                                       "chunk_ms": s.chunker.chunk_ms, "max_session_s": s.max_session_s})
            await sess.run()
        finally:
            sessions.discard(sess)
            m.sessions.set(len(sessions))
            m.ended.labels(sess.end_reason or "unknown").inc()

    @app.get("/healthz")
    async def healthz() -> dict:
        return {"status": "ok"}  # liveness: el proceso responde (el modelo cargado lo dice readyz)

    @app.get("/readyz")
    async def readyz() -> Response:
        if state["draining"]:
            return JSONResponse({"ready": False, "reason": "draining"}, status_code=503)
        limits = {**counts(), "max_sessions": s.max_sessions, "max_streams": s.max_streams}
        if full():
            # 503 sin drenar: el pod sale del Service headless mientras está lleno y vuelve solo cuando baja
            return JSONResponse({"ready": False, "reason": "full", **limits}, status_code=503)
        return JSONResponse({"ready": True, **limits})

    def local_only(request: Request) -> bool:
        # El drain lo dispara el preStop DENTRO del pod. Desde afuera nadie debería poder vaciar un worker.
        return request.client is not None and request.client.host in ("127.0.0.1", "::1")

    @app.post("/admin/drain")
    async def drain(request: Request) -> Response:
        if not local_only(request):
            return JSONResponse({"error": "forbidden"}, status_code=403)
        start_drain()
        return JSONResponse({"draining": True, **counts()})

    @app.get("/admin/status")
    async def status(request: Request) -> Response:
        if not local_only(request):
            return JSONResponse({"error": "forbidden"}, status_code=403)
        return JSONResponse({"draining": state["draining"], **counts()})

    @app.get("/metrics")
    async def metrics() -> Response:
        return Response(generate_latest(m.registry), media_type=CONTENT_TYPE_LATEST)

    return app


def build_app() -> FastAPI:
    """Entrada de producción (k8s/asr-worker.yaml: `uvicorn --factory asr_server:build_app`).

    Falta el adaptador del modelo real, que no se pudo probar aquí: un cliente de NVIDIA Riva (gRPC
    StreamingRecognize), un modelo de NeMo cache-aware cargado en el proceso, o Triton con sequence
    batching. Cualquiera cumple ASRModel. No se publica código de red sin probar como referencia.
    """
    raise NotImplementedError("conecta un ASRModel real (ver docstring) y llama a create_app(model)")


def demo_app() -> FastAPI:
    """`uvicorn --factory asr_server:demo_app --port 8080`: el server completo con el modelo falso."""
    logging.basicConfig(level=logging.INFO, stream=sys.stdout, format="%(message)s")
    return create_app(FakeStreamingASR(step_delay_s=0.03), Settings(latency_log_rate=1.0))


# ---------------------------------------------------------------------------- CLI: drain y demo-client
def wait_for_drain(post_drain: Callable[[], dict], get_status: Callable[[], dict], timeout_s: float,
                   poll_s: float = 2.0, clock: Callable[[], float] = time.monotonic,
                   sleep: Callable[[float], None] = time.sleep) -> int:
    """Lo que corre el preStop: pedir drain y esperar a que no queden SESIONES o venza el plazo.

    Espera sesiones, no streams activos: una sesión callada no ocupa GPU, pero sigue conectada y tiene que
    migrar igual (lo hace al instante). Devuelve las sesiones que quedaban al salir (0 = drenado). Nunca lanza: si el server no contesta, el
    preStop termina y Kubernetes sigue con el SIGTERM (uvicorn cierra con 1012 lo que quede).
    """
    deadline = clock() + timeout_s
    try:
        left = int(post_drain().get("sessions", 0))
    except Exception:
        return -1
    while left > 0 and clock() < deadline:
        sleep(poll_s)
        try:
            left = int(get_status().get("sessions", 0))
        except Exception:
            return -1
    return left


def _http_json(method: str, url: str) -> dict:
    from urllib.request import Request as UrlRequest, urlopen  # stdlib: el preStop no instala nada
    with urlopen(UrlRequest(url, method=method), timeout=5) as resp:
        return json.loads(resp.read())


def _demo_client(url: str) -> None:
    """Manda ≈ 4.75 s de audio sintético (tonos = "voz", con pausas) a ritmo real e imprime lo que vuelve."""
    import numpy as np  # ya es dependencia del chunker
    from websockets.exceptions import ConnectionClosed  # cierre del server con su código
    from websockets.sync.client import connect  # websockets viene en requirements.txt (lo usa uvicorn)

    sr = 16000
    t = np.arange(sr) / sr
    voice = (0.1 * np.sin(2 * np.pi * 300 * t) * 32767).astype("<i2")
    silence = np.zeros(sr, dtype="<i2")
    audio = np.concatenate([silence[:4000], voice, voice[:8000], silence, voice, silence])  # ≈ 4.75 s
    with connect(url) as ws:
        ws.send(json.dumps({"type": "start", "session_id": "demo-1", "language": "es-419",
                            "sample_rate": sr, "encoding": "pcm_s16le"}))
        print(ws.recv())
        try:
            for i in range(0, len(audio), 320):  # 20 ms por mensaje, a ritmo real
                ws.send(audio[i:i + 320].tobytes())
                time.sleep(0.02)
                try:
                    while True:
                        print(ws.recv(timeout=0))
                except TimeoutError:
                    pass
            ws.send(json.dumps({"type": "stop"}))
            while True:
                print(ws.recv(timeout=3))
        except ConnectionClosed as e:  # el server cerró: stop (1000), migrate (1012), sobrecarga (1013)…
            print(json.dumps({"closed": e.rcvd.code if e.rcvd else None, "reason": e.rcvd.reason if e.rcvd else ""}))
        except TimeoutError:
            print(json.dumps({"closed": None, "reason": "sin respuesta en 3 s"}))

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "drain":
        # preStop: python /app/asr_server.py drain  (PORT y DRAIN_TIMEOUT_S por env)
        port = os.getenv("PORT", "8080")
        base = f"http://127.0.0.1:{port}"
        left = wait_for_drain(lambda: _http_json("POST", f"{base}/admin/drain"),
                              lambda: _http_json("GET", f"{base}/admin/status"),
                              timeout_s=Settings().drain_timeout_s)
        print(json.dumps({"event": "drain_done", "sessions_left": left}))
    elif cmd == "demo-client":
        _demo_client(sys.argv[2] if len(sys.argv) > 2 else "ws://127.0.0.1:8080/v1/stream")
    else:
        print("uso: python asr_server.py drain | demo-client [ws://host:puerto/v1/stream]")
