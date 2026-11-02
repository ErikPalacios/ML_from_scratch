"""Chunker de audio en streaming (caso c13): frames de 20 ms → chunks de 160 ms + VAD + endpointing.

Qué hace, en el orden en que llega el audio de UN participante (una pista, un stream):

  bytes PCM16 (16 kHz, mono, little-endian)
    → Reframer        corta en frames de 20 ms (320 muestras, 640 bytes), aunque lleguen paquetes de otro tamaño
    → EnergyVAD       ¿este frame es voz? energía contra un piso de ruido adaptativo, con onset y hangover
    → StreamChunker   durante una utterance junta 8 frames = 160 ms → Chunk (lo que recibe el modelo);
                      con ≥ 600 ms de silencio después de la última voz → EndOfUtterance (el modelo da el final)

Por qué existe esta pieza (y por qué corre en CPU, en el asr-gateway):
  * Con VAD solo las pistas con voz gastan GPU: de ≈ 4 participantes, en promedio ≈ 1.2 hablan a la vez
    (estimación del caso). Sin VAD mandarías ≈ 3.3× más audio a la GPU para transcribir silencio.
  * El endpointing decide CUÁNDO hay texto final: es la mitad de la latencia del final (600 ms de silencio
    de los ≤ 1.5 s del p95). Bajarlo a 300 ms da finales más rápidos y corta frases en cada pausa para pensar.
  * 160 ms por chunk es el compromiso del caso (estimación): chunks más chicos = partials más rápidos pero más
    pasos de GPU por segundo de audio (más overhead); más grandes = menos pasos y más espera para el primer
    partial. El tamaño real lo fija el modelo (su lookahead/right context): mídelo con el modelo de verdad.

Límites del VAD por energía (es la LÍNEA BASE, no lo que pondría en producción sin medir):
  * Confunde ruido fuerte con voz (teclado, música, una puerta) y pierde voz baja en ambientes ruidosos.
  * Una TV de fondo ES voz: ningún VAD la distingue del participante (eso es un problema de producto).
  * WebRTC VAD (modelo estadístico sobre bandas de frecuencia; frames de 10, 20 o 30 ms; modos 0–3 de
    agresividad) es el siguiente paso barato. Silero VAD (red neuronal, licencia MIT; su README reporta
    < 1 ms por chunk de 30+ ms en un hilo de CPU) es mucho mejor con ruido. Elige con TU audio: precisión y
    recall de "voz" por slice (ruido, dispositivo) contra un set etiquetado, no por intuición.

Todo es lógica pura (numpy, sin I/O): se prueba con señales sintéticas en tests/test_chunker.py.
"""

from __future__ import annotations  # anotaciones como texto: sintaxis moderna sin costo en runtime

import math  # log10 para pasar energía a dB
from collections import deque  # historial acotado de frames (contexto izquierdo y pre-roll)
from dataclasses import dataclass, field  # contratos internos simples e inmutables

import numpy as np  # el audio es un arreglo de int16; numpy hace la energía en microsegundos

SAMPLE_RATE = 16_000  # Hz. El SFU recibe Opus a 48 kHz; el fork de audio decodifica y remuestrea a 16 kHz
FRAME_MS = 20  # = el frame típico de Opus en WebRTC; también uno de los tamaños que acepta WebRTC VAD
FRAME_SAMPLES = SAMPLE_RATE * FRAME_MS // 1000  # 320 muestras por frame
FRAME_BYTES = FRAME_SAMPLES * 2  # 640 bytes: PCM16 = 2 bytes por muestra
_EPS = 1e-10  # evita log10(0) en silencio digital perfecto (→ -100 dB)


def frame_energy_db(frame: np.ndarray) -> float:
    """Energía media del frame en dBFS (0 dB = onda cuadrada a escala completa).

    Ejemplo: un seno de amplitud 0.1 (≈ 3,277 en int16) tiene potencia 0.1²/2 = 0.005 → ≈ -23 dBFS;
    ruido de fondo de una oficina tranquila en un micrófono de laptop suele quedar en -60 a -45 dBFS
    (orden de magnitud, varía por dispositivo y por el AGC del cliente: mídelo).
    """
    x = frame.astype(np.float32) / 32768.0  # int16 → [-1, 1): la escala no depende del formato
    return 10.0 * math.log10(float(np.mean(x * x)) + _EPS)


# ---------------------------------------------------------------------------- reframer
class Reframer:
    """Bytes que llegan en paquetes de cualquier tamaño → frames exactos de 320 muestras.

    El cliente (o el fork del SFU) puede mandar 20 ms, 40 ms o un paquete partido a la mitad por la red.
    El VAD y el chunker asumen 20 ms exactos: aquí se guarda el resto (incluido un byte impar) para el
    siguiente paquete en lugar de descartarlo (descartar = clics y palabras cortadas).
    """

    def __init__(self) -> None:
        self._buf = bytearray()  # bytes pendientes de completar un frame

    def push(self, data: bytes) -> list[np.ndarray]:
        self._buf.extend(data)
        n = len(self._buf) // FRAME_BYTES  # cuántos frames completos hay
        frames = [
            # '<i2' = int16 little-endian, explícito: no depende de la arquitectura de la máquina
            np.frombuffer(bytes(self._buf[i * FRAME_BYTES:(i + 1) * FRAME_BYTES]), dtype="<i2")
            for i in range(n)
        ]
        del self._buf[: n * FRAME_BYTES]  # se queda solo el resto incompleto
        return frames

    @property
    def pending_bytes(self) -> int:
        return len(self._buf)


# ---------------------------------------------------------------------------- VAD
@dataclass(frozen=True)
class VADConfig:
    margin_db: float = 10.0  # voz = energía > piso de ruido + 10 dB (ilustrativo: ajústalo con audio etiquetado)
    min_speech_db: float = -50.0  # y además > -50 dBFS: en un cuarto en silencio el piso baja mucho y
    #                               cualquier respiración superaría "piso + margen"
    initial_floor_db: float = -60.0  # piso de partida, antes de haber visto audio
    floor_fall_alpha: float = 0.3  # el piso BAJA rápido (30 % del camino por frame): el silencio real se
    #                                aprende en ≈ 10 frames (200 ms)
    floor_rise_db_per_s: float = 2.0  # y SUBE despacio (2 dB/s, también durante "voz"): un ventilador nuevo
    #                                   (+20 dB) deja de ser "voz" en ≈ 5 s; un pico de voz no arrastra el piso
    onset_frames: int = 2  # 2 frames seguidos (40 ms) para empezar: un clic de 20 ms no abre una utterance
    hangover_ms: int = 200  # después de la última voz se sigue diciendo "voz" 200 ms: no corta colas de
    #                         palabra ni consonantes débiles (s, f) que tienen poca energía


@dataclass(frozen=True)
class VADDecision:
    raw_speech: bool  # ¿este frame, solo, supera el umbral?
    is_speech: bool  # decisión con onset y hangover (la que usa el chunker para abrir utterances)
    energy_db: float
    floor_db: float


class EnergyVAD:
    """VAD por energía con piso de ruido adaptativo, onset y hangover (ver límites en el docstring del módulo)."""

    def __init__(self, cfg: VADConfig | None = None) -> None:
        self.cfg = cfg or VADConfig()
        self.floor_db = self.cfg.initial_floor_db
        self._rise_per_frame = self.cfg.floor_rise_db_per_s * FRAME_MS / 1000  # 0.04 dB por frame
        self._hang_frames = self.cfg.hangover_ms // FRAME_MS  # 10 frames
        self._run = 0  # frames seguidos con voz cruda (para el onset)
        self._hang_left = 0  # frames de hangover que quedan
        self.in_speech = False

    def process(self, frame: np.ndarray) -> VADDecision:
        e = frame_energy_db(frame)
        threshold = max(self.floor_db + self.cfg.margin_db, self.cfg.min_speech_db)
        raw = e > threshold
        # Piso adaptativo: baja rápido hacia la energía actual, sube despacio y nunca más que la energía.
        # Se actualiza DESPUÉS de decidir, para que el frame no se compare contra sí mismo.
        if e < self.floor_db:
            self.floor_db += self.cfg.floor_fall_alpha * (e - self.floor_db)
        else:
            self.floor_db += min(self._rise_per_frame, e - self.floor_db)
        self.floor_db = max(self.floor_db, -100.0)  # silencio digital: no bajar sin límite
        # Onset + hangover: la decisión "limpia" que abre y cierra voz
        if raw:
            self._run += 1
            if self._run >= self.cfg.onset_frames:
                self.in_speech = True
                self._hang_left = self._hang_frames  # cada frame de voz recarga el hangover
        else:
            self._run = 0
            if self.in_speech:
                if self._hang_left > 0:
                    self._hang_left -= 1
                else:
                    self.in_speech = False
        return VADDecision(raw_speech=raw, is_speech=self.in_speech, energy_db=e, floor_db=self.floor_db)


# ---------------------------------------------------------------------------- chunker + endpointing
@dataclass(frozen=True)
class ChunkerConfig:
    chunk_ms: int = 160  # audio NUEVO por chunk (estimación del caso; lo fija el modelo)
    # Contexto izquierdo: audio YA enviado que se repite delante de cada chunk. Un modelo cache-aware
    # guarda su propio estado (su caché) entre pasos y no lo necesita: 0. Un modelo sin estado entre
    # llamadas (chunked/buffered inference) necesita ver audio previo para no equivocarse en el borde del
    # chunk: ahí se configura (p. ej. 320 ms o más; cuesta cómputo proporcional, mídelo).
    left_context_ms: int = 0
    preroll_ms: int = 100  # al abrir una utterance se incluye el audio de antes del onset: el VAD
    #                        reacciona tarde (onset de 40 ms) y la primera sílaba es débil
    endpoint_silence_ms: int = 600  # silencio después de la última voz cruda → fin de utterance (caso: 500–700)
    max_utterance_ms: int = 20_000  # tope: un monólogo sin pausas igual produce un final cada 20 s
    #                                (el transcript se guarda y el drain de un worker no espera para siempre)
    vad: VADConfig = field(default_factory=VADConfig)


@dataclass(frozen=True)
class Chunk:
    utterance: int  # índice de la utterance dentro del stream (0, 1, 2…)
    seq: int  # índice del chunk dentro de la utterance
    samples: np.ndarray  # int16: [contexto izquierdo | audio nuevo]
    context_samples: int  # cuántas muestras del principio son contexto (el modelo no debe re-emitirlas)
    start_ms: int  # tiempo de stream del primer frame NUEVO (ms desde el inicio de la sesión)
    end_ms: int  # tiempo de stream del final del último frame nuevo
    last: bool  # ¿es el último chunk de la utterance? (puede ser más corto que 160 ms)


@dataclass(frozen=True)
class EndOfUtterance:
    utterance: int
    start_ms: int  # inicio de la utterance (incluye pre-roll)
    speech_end_ms: int  # fin del último frame con voz cruda: desde aquí se mide la latencia del final
    detected_ms: int  # cuando se detectó el fin (= speech_end_ms + silencio de endpoint, o el tope)
    reason: str  # "silence" | "max_length" | "stream_end"


class StreamChunker:
    """Un stream (una pista de un participante): frames de 20 ms → Chunk / EndOfUtterance.

    Reglas:
      * Fuera de una utterance no se manda nada al modelo (eso es lo que ahorra GPU).
      * Se abre una utterance cuando el VAD (con onset) dice voz; el primer chunk incluye pre-roll.
      * Dentro de la utterance va TODO el audio, también los silencios cortos entre palabras: el modelo
        necesita el audio de después de la última palabra para cerrarla.
      * Se cierra con endpoint_silence_ms de silencio después de la última voz cruda, al llegar al tope de
        duración, o al terminar el stream (flush).
    """

    def __init__(self, cfg: ChunkerConfig | None = None) -> None:
        self.cfg = cfg or ChunkerConfig()
        for name in ("chunk_ms", "left_context_ms", "preroll_ms", "endpoint_silence_ms", "max_utterance_ms"):
            if getattr(self.cfg, name) % FRAME_MS:
                raise ValueError(f"{name} debe ser múltiplo de {FRAME_MS} ms")
        self.vad = EnergyVAD(self.cfg.vad)
        self._chunk_frames = self.cfg.chunk_ms // FRAME_MS  # 8
        self._ctx_frames = self.cfg.left_context_ms // FRAME_MS
        self._preroll_frames = self.cfg.preroll_ms // FRAME_MS
        self._endpoint_frames = self.cfg.endpoint_silence_ms // FRAME_MS  # 30
        self._max_frames = self.cfg.max_utterance_ms // FRAME_MS
        # Historial acotado: contexto izquierdo + pre-roll + un chunk. Memoria fija por stream (≈ KB),
        # importante con ≈ 200k pistas conectadas en el pico.
        self._history: deque[tuple[int, np.ndarray]] = deque(
            maxlen=self._ctx_frames + self._preroll_frames + self._chunk_frames + 1)
        self._frame_idx = -1  # índice del último frame recibido
        self._last_sent = -1  # último frame que ya se mandó al modelo como audio nuevo (no repetir en pre-roll)
        self._in_utt = False
        self._utt = -1
        self._utt_start = 0  # frame donde empieza la utterance actual
        self._seq = 0
        self._pending: list[tuple[int, np.ndarray]] = []  # frames nuevos del chunk en curso
        self._last_speech = -1  # último frame con voz cruda
        # Contadores para métricas (el server los exporta como asr_vad_frames_total{decision})
        self.frames_total = 0
        self.speech_frames = 0
        self.last_decision: VADDecision | None = None

    @property
    def in_utterance(self) -> bool:
        return self._in_utt

    def feed(self, frame: np.ndarray) -> list[Chunk | EndOfUtterance]:
        """Procesa UN frame de 20 ms y devuelve los eventos que produjo (0, 1 o 2)."""
        if frame.shape != (FRAME_SAMPLES,):
            raise ValueError(f"se esperaban {FRAME_SAMPLES} muestras, llegaron {frame.shape}")
        self._frame_idx += 1
        i = self._frame_idx
        d = self.vad.process(frame)
        self.last_decision = d
        self.frames_total += 1
        self.speech_frames += int(d.is_speech)
        self._history.append((i, frame))
        if d.raw_speech:
            self._last_speech = i
        events: list[Chunk | EndOfUtterance] = []

        if not self._in_utt:
            # Fuera de utterance solo se abre con voz CRUDA confirmada por el onset: el hangover que queda
            # después de cortar una utterance por tope no abre otra hecha de silencio.
            if not (d.is_speech and d.raw_speech):
                return events  # silencio fuera de utterance: no se manda nada al modelo
            # Abrir utterance: pre-roll = frames recientes que todavía NO se mandaron
            self._in_utt = True
            self._utt += 1
            self._seq = 0
            first = max(i - self._preroll_frames - (self.cfg.vad.onset_frames - 1), self._last_sent + 1)
            self._pending = [(j, f) for j, f in self._history if j >= first]
            self._utt_start = self._pending[0][0]
        else:
            self._pending.append((i, frame))

        if len(self._pending) >= self._chunk_frames:
            events.append(self._emit_chunk(last=False))

        silence = i - self._last_speech  # frames desde la última voz cruda
        if silence >= self._endpoint_frames:
            events.extend(self._close("silence"))
        elif i - self._utt_start + 1 >= self._max_frames:
            events.extend(self._close("max_length"))
        return events

    def flush(self) -> list[Chunk | EndOfUtterance]:
        """Fin del stream (el participante se fue o la sesión se cierra): cierra la utterance abierta."""
        return self._close("stream_end") if self._in_utt else []

    # ------------------------------------------------------------------------ internos
    def _emit_chunk(self, last: bool) -> Chunk:
        new = self._pending[: self._chunk_frames]
        self._pending = self._pending[self._chunk_frames:]
        first_new = new[0][0]
        ctx = [f for j, f in self._history if first_new - self._ctx_frames <= j < first_new] if self._ctx_frames else []
        samples = np.concatenate(ctx + [f for _, f in new])
        self._last_sent = new[-1][0]
        chunk = Chunk(
            utterance=self._utt,
            seq=self._seq,
            samples=samples,
            context_samples=len(ctx) * FRAME_SAMPLES,
            start_ms=first_new * FRAME_MS,
            end_ms=(new[-1][0] + 1) * FRAME_MS,
            last=last,
        )
        self._seq += 1
        return chunk

    def _close(self, reason: str) -> list[Chunk | EndOfUtterance]:
        events: list[Chunk | EndOfUtterance] = []
        if self._pending:
            events.append(self._emit_chunk(last=True))  # el resto (< 160 ms) también va al modelo
        eou = EndOfUtterance(
            utterance=self._utt,
            start_ms=self._utt_start * FRAME_MS,
            speech_end_ms=(self._last_speech + 1) * FRAME_MS,
            detected_ms=(self._frame_idx + 1) * FRAME_MS,
            reason=reason,
        )
        events.append(eou)
        self._in_utt = False
        self._pending = []
        # Si fue por tope y el hablante sigue, la próxima utterance se abre con el siguiente frame de voz.
        # Su pre-roll no repite audio ya enviado: empieza después de _last_sent.
        return events
