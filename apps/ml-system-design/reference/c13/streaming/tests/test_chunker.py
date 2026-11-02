"""Tests del chunker con señales sintéticas: tonos (≈ "voz"), ruido y silencio, con tiempos calculables a mano.

Un tono de 300 Hz con amplitud 0.1 tiene ≈ -23 dBFS; el ruido de fondo de los tests, ≈ -70 dBFS. Los
tiempos esperados salen de las reglas del chunker: onset de 2 frames, pre-roll de 100 ms (5 frames),
endpoint con 600 ms (30 frames) de silencio después de la última voz cruda.
"""

import numpy as np
import pytest

from chunker import (
    FRAME_BYTES,
    FRAME_SAMPLES,
    SAMPLE_RATE,
    Chunk,
    ChunkerConfig,
    EndOfUtterance,
    EnergyVAD,
    Reframer,
    StreamChunker,
    frame_energy_db,
)

RNG = np.random.default_rng(13)  # semilla fija: los tests no dependen de la suerte


def tone(ms: int, amp: float = 0.1, hz: float = 300.0) -> np.ndarray:
    t = np.arange(SAMPLE_RATE * ms // 1000) / SAMPLE_RATE
    return (amp * np.sin(2 * np.pi * hz * t) * 32767).astype(np.int16)


def noise(ms: int, dbfs: float = -70.0) -> np.ndarray:
    std = 10 ** (dbfs / 20)  # potencia del ruido gaussiano = std²
    return np.clip(RNG.normal(0, std, SAMPLE_RATE * ms // 1000) * 32768, -32768, 32767).astype(np.int16)


def frames_of(signal: np.ndarray) -> list[np.ndarray]:
    n = len(signal) // FRAME_SAMPLES
    return [signal[i * FRAME_SAMPLES:(i + 1) * FRAME_SAMPLES] for i in range(n)]


def run(signal: np.ndarray, cfg: ChunkerConfig | None = None, flush: bool = True):
    ch = StreamChunker(cfg)
    events = []
    for f in frames_of(signal):
        events.extend(ch.feed(f))
    if flush:
        events.extend(ch.flush())
    return ch, [e for e in events if isinstance(e, Chunk)], [e for e in events if isinstance(e, EndOfUtterance)]


# ---------------------------------------------------------------------------- reframer y energía
def test_reframer_keeps_the_remainder_including_odd_bytes():
    r = Reframer()
    data = np.arange(1000, dtype="<i2").tobytes()  # 2,000 bytes = 3 frames (1,920) + 80 de resto
    assert len(r.push(data[:1001])) == 1  # 1,001 bytes: 1 frame y 361 pendientes (con un byte impar)
    assert r.pending_bytes == 1001 - FRAME_BYTES
    frames = r.push(data[1001:])
    assert len(frames) == 2 and r.pending_bytes == 80
    # Nada se perdió ni se desordenó al partir el paquete en un byte impar: el 2º frame empieza en la muestra 320
    assert np.array_equal(frames[0][:10], np.arange(320, 330))


def test_energy_of_a_known_sine():
    # Seno de amplitud 0.1 → potencia 0.1² / 2 = 0.005 → 10·log10(0.005) ≈ -23.0 dBFS
    assert frame_energy_db(tone(20)) == pytest.approx(-23.0, abs=0.1)
    assert frame_energy_db(np.zeros(FRAME_SAMPLES, dtype=np.int16)) == pytest.approx(-100.0)


# ---------------------------------------------------------------------------- VAD
def test_vad_onset_and_hangover():
    vad = EnergyVAD()
    sig = np.concatenate([noise(500), tone(1000), noise(1000)])
    decisions = [vad.process(f).is_speech for f in frames_of(sig)]
    first = decisions.index(True)
    last = len(decisions) - 1 - decisions[::-1].index(True)
    assert first == 26  # el tono empieza en el frame 25 (500 ms); el onset pide 2 frames → 26
    assert last == 74 + 10  # el tono termina en el frame 74; 200 ms (10 frames) de hangover


def test_vad_ignores_a_20ms_click():
    vad = EnergyVAD()
    sig = np.concatenate([noise(500), tone(20), noise(500), tone(20), noise(500)])
    assert not any(vad.process(f).is_speech for f in frames_of(sig))


def test_vad_floor_adapts_to_a_new_stationary_noise():
    # Ruido de -70 dBFS y, de golpe, un ventilador a -40 dBFS (+30 dB) durante 12 s. Al principio es "voz"
    # (supera piso + 10 dB). El piso sube 2 dB/s; deja de ser voz cuando el piso pasa -50 dBFS:
    # ≈ (−50 − (−70)) / 2 = 10 s. Después, un tono a -23 dBFS se sigue detectando.
    vad = EnergyVAD()
    sig = np.concatenate([noise(2000), noise(12000, dbfs=-40.0), tone(1000)])
    raw = [vad.process(f).raw_speech for f in frames_of(sig)]
    fan = raw[100:700]  # frames del ventilador
    stop = fan.index(False)  # primer frame del ventilador que ya no es voz cruda
    assert 8.5 <= stop * 0.02 <= 11.5
    assert sum(fan[stop + 50:]) == 0  # y queda así (salvo el arranque, ningún frame vuelve a ser voz)
    assert all(raw[705:750])  # el tono posterior sí es voz


# ---------------------------------------------------------------------------- chunker
def test_one_utterance_chunks_and_endpoint_times():
    # 500 ms de ruido, 1 s de "voz" (frames 25–74), 1 s de ruido.
    _, chunks, eous = run(np.concatenate([noise(500), tone(1000), noise(1000)]))
    assert len(eous) == 1
    eou = eous[0]
    # Abre en el frame 26 (onset) con pre-roll: 5 frames + el frame anterior del onset → empieza en el 20
    assert eou.start_ms == 400 and chunks[0].start_ms == 400
    assert eou.speech_end_ms == 1500  # fin del frame 74
    assert eou.detected_ms == 2100  # 600 ms de silencio después: 1,500 + 600
    assert eou.reason == "silence"
    # Frames 20 a 104 = 85 frames = 10 chunks de 8 + uno de 5 (el resto, marcado last)
    assert [c.end_ms - c.start_ms for c in chunks] == [160] * 10 + [100]
    assert [c.last for c in chunks] == [False] * 10 + [True]
    assert all(a.end_ms == b.start_ms for a, b in zip(chunks, chunks[1:]))  # contiguos, sin huecos ni solapes
    assert [c.seq for c in chunks] == list(range(11))


def test_silence_sends_nothing_to_the_model():
    ch, chunks, eous = run(noise(3000))
    assert chunks == [] and eous == []
    assert ch.frames_total == 150 and ch.speech_frames == 0


def test_short_pause_stays_in_the_same_utterance_long_pause_splits():
    # Pausa de 400 ms (< 600): una utterance. Pausa de 800 ms: dos.
    _, _, eous = run(np.concatenate([noise(300), tone(1000), noise(400), tone(1000), noise(1000)]))
    assert len(eous) == 1
    _, chunks, eous = run(np.concatenate([noise(300), tone(1000), noise(800), tone(1000), noise(1000)]))
    assert len(eous) == 2
    assert {c.utterance for c in chunks} == {0, 1}


def test_left_context_repeats_previous_audio_and_marks_it():
    sig = np.concatenate([noise(500), tone(1000), noise(1000)])
    _, chunks, _ = run(sig, ChunkerConfig(left_context_ms=320))
    c1 = chunks[1]  # audio nuevo: frames 28–35; contexto: los 16 frames anteriores (12–27)
    assert c1.context_samples == 16 * FRAME_SAMPLES
    assert len(c1.samples) == 24 * FRAME_SAMPLES
    assert np.array_equal(c1.samples, sig[12 * FRAME_SAMPLES:36 * FRAME_SAMPLES])
    # El audio NUEVO de todos los chunks, concatenado, es exactamente el tramo de la utterance (sin repetir)
    new = np.concatenate([c.samples[c.context_samples:] for c in chunks])
    assert np.array_equal(new, sig[20 * FRAME_SAMPLES:105 * FRAME_SAMPLES])


def test_max_utterance_splits_a_monologue_without_duplicating_audio():
    sig = np.concatenate([noise(300), tone(5000), noise(1000)])
    _, chunks, eous = run(sig, ChunkerConfig(max_utterance_ms=2000))
    assert [e.reason for e in eous] == ["max_length", "max_length", "silence"]
    new = np.concatenate([c.samples[c.context_samples:] for c in chunks])
    starts = [c.start_ms for c in chunks]
    assert starts == sorted(starts) and len(set(starts)) == len(starts)  # ningún tramo se manda dos veces
    assert len(new) == (eous[-1].detected_ms - eous[0].start_ms) * SAMPLE_RATE // 1000  # todo, contiguo


def test_flush_closes_an_open_utterance():
    _, chunks, eous = run(np.concatenate([noise(300), tone(500)]))  # el stream termina hablando
    assert [e.reason for e in eous] == ["stream_end"]
    assert chunks[-1].last


def test_wrong_frame_size_is_rejected():
    with pytest.raises(ValueError):
        StreamChunker().feed(np.zeros(160, dtype=np.int16))
    with pytest.raises(ValueError):
        StreamChunker(ChunkerConfig(chunk_ms=150))  # no es múltiplo de 20 ms
