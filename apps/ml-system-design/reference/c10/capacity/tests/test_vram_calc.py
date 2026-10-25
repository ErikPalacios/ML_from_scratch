"""Tests de vram_calc: reproducen los números de #m04 y del caso c10 (SPEC §8k) a mano."""

import pytest  # runner y aproximaciones numéricas

from vram_calc import (
    GB,
    GIB,
    H100_80GB,
    H100_REPORTED,
    KIB,
    L4_24GB,
    LLAMA3_70B,
    LLAMA3_8B,
    kv_bytes_per_sequence,
    kv_bytes_per_token,
    kv_room_per_replica,
    kv_tokens_with_shared_prefix,
    max_concurrent_sequences,
    max_kv_tokens,
    weight_bytes,
    with_dtypes,
)

FP8_WEIGHTS = with_dtypes(LLAMA3_70B, weight_bytes=1.0, kv_bytes=2.0)  # la config del caso: pesos FP8, KV BF16
FP8_ALL = with_dtypes(LLAMA3_70B, weight_bytes=1.0, kv_bytes=1.0)  # pesos y KV en FP8


# ---------------------------------------------------------------- #m04: KV por token y pesos
def test_llama3_8b_kv_per_token_is_128_kib():
    # 2 × 32 capas × 8 KV heads × 128 × 2 B = 131,072 B
    assert kv_bytes_per_token(LLAMA3_8B) == 131_072 == 128 * KIB


def test_llama3_70b_kv_per_token_is_320_kib_bf16_and_160_kib_fp8():
    # 2 × 80 × 8 × 128 × 2 B = 327,680 B; en FP8, la mitad
    assert kv_bytes_per_token(LLAMA3_70B) == 327_680 == 320 * KIB
    assert kv_bytes_per_token(FP8_ALL) == 160 * KIB


def test_weights_bf16_match_m04():
    assert weight_bytes(LLAMA3_8B) / GB == pytest.approx(16.06)  # "≈ 16 GB"
    assert weight_bytes(LLAMA3_70B) / GB == pytest.approx(141.2)  # "≈ 141 GB"


def test_weights_fp8_and_the_bf16_embeddings_caveat():
    assert weight_bytes(FP8_WEIGHTS) / GB == pytest.approx(70.6)  # la cuenta del caso
    # Un checkpoint FP8 que deja embeddings y lm_head (≈ 2.1 B params) en BF16 pesa ≈ 2.1 GB más
    real = with_dtypes(LLAMA3_70B, 1.0, 2.0, high_precision_params=2 * 128_256 * 8_192)
    assert weight_bytes(real) / GB == pytest.approx(72.7, abs=0.05)


def test_one_8k_sequence_of_llama3_8b_is_one_gib():
    assert kv_bytes_per_sequence(LLAMA3_8B, 8_192) == 1 * GIB  # #m04: "1 GiB (≈ 1.07 GB)"


# ---------------------------------------------------------------- caso c10 (SPEC §8k)
def test_case_kv_room_per_replica_is_about_68_gb():
    # 0.90 × 2 × 80 GB − 70.6 GB − 5 GB = 68.4 GB
    room = kv_room_per_replica(FP8_WEIGHTS, H100_80GB, tensor_parallel=2, gpu_memory_utilization=0.90,
                               overhead_bytes=5 * GB)
    assert room / GB == pytest.approx(68.4)


def test_case_sequences_of_2250_tokens_bf16_kv():
    room = kv_room_per_replica(FP8_WEIGHTS, H100_80GB, 2, 0.90, 5 * GB)
    seq = kv_bytes_per_sequence(FP8_WEIGHTS, 2_250)
    assert seq / GB == pytest.approx(0.73728)  # 2,250 × 327,680 B
    assert room / seq == pytest.approx(92.77, abs=0.01)  # el "≈ 93" del caso es este cociente
    assert max_concurrent_sequences(room, FP8_WEIGHTS, 2_250) == 92  # enteras, en su largo máximo


def test_fp8_kv_doubles_the_sequences():
    room = kv_room_per_replica(FP8_ALL, H100_80GB, 2, 0.90, 5 * GB)
    assert max_concurrent_sequences(room, FP8_ALL, 2_250) == 185  # ≈ 2× (185.5 → 185)


def test_littles_law_concurrency_fits_the_kv_room():
    # 60 rps × ≈ 10.5 s ≈ 630 secuencias vivas en 16 réplicas ≈ 39.4 por réplica: caben en 92
    room = kv_room_per_replica(FP8_WEIGHTS, H100_80GB, 2, 0.90, 5 * GB)
    per_replica = 60 * 10.5 / 16
    assert per_replica == pytest.approx(39.375)
    assert per_replica < max_concurrent_sequences(room, FP8_WEIGHTS, 2_250)


def test_max_context_8k_sequences():
    # Lo que vLLM reporta como "Maximum concurrency for 8,192 tokens per request": secuencias de 8k
    room = kv_room_per_replica(FP8_WEIGHTS, H100_80GB, 2, 0.90, 5 * GB)
    assert max_kv_tokens(room, FP8_WEIGHTS) == 208_740  # tokens totales de KV (vLLM: 208,736, en bloques de 16)
    # 208,740 ÷ 8,192 = 25.48: vLLM imprime "25.48x" (con decimales); aquí se cuentan secuencias ENTERAS
    assert max_concurrent_sequences(room, FP8_WEIGHTS, 8_192) == 25


def test_reported_h100_memory_gives_more_room():
    # nvidia-smi: 81,559 MiB ≈ 85.5 GB por GPU → 0.9 × 171.04 − 70.6 − 5 ≈ 78.3 GB (vs 68.4 nominal)
    room = kv_room_per_replica(FP8_WEIGHTS, H100_REPORTED, 2, 0.90, 5 * GB)
    assert H100_REPORTED.vram_bytes / GB == pytest.approx(85.52, abs=0.01)
    assert room / GB == pytest.approx(78.3, abs=0.05)
    assert max_concurrent_sequences(room, FP8_WEIGHTS, 2_250) == 106


def test_bf16_70b_does_not_fit_in_one_h100():
    with pytest.raises(ValueError, match="no cabe"):
        kv_room_per_replica(LLAMA3_70B, H100_80GB, 1, 0.90, 5 * GB)  # 141 GB de pesos en 72 GB


def test_bf16_70b_in_two_h100_leaves_no_room_and_four_do():
    # 0.9 × 160 − 141.2 − 5 = −2.2 GB: en BF16 hacen falta 4 GPUs (TP=4) o pesos en FP8
    with pytest.raises(ValueError, match="no cabe"):
        kv_room_per_replica(LLAMA3_70B, H100_80GB, 2, 0.90, 5 * GB)
    room = kv_room_per_replica(LLAMA3_70B, H100_80GB, 4, 0.90, 5 * GB)  # 288 − 141.2 − 5 = 141.8 GB
    assert room / GB == pytest.approx(141.8)


# ---------------------------------------------------------------- #m04, ejemplo C (L4)
def test_m04_l4_example_three_or_four_8k_conversations():
    # 0.9 × 24 − 16.06 − 2 ≈ 3.5 GB → 3 secuencias de 8k (1.07 GB cada una)
    room = kv_room_per_replica(LLAMA3_8B, L4_24GB, 1, 0.90, 2 * GB)
    assert room / GB == pytest.approx(3.54, abs=0.01)
    assert max_concurrent_sequences(room, LLAMA3_8B, 8_192) == 3


# ---------------------------------------------------------------- prefix caching y validaciones
def test_shared_prefix_saves_kv():
    assert kv_tokens_with_shared_prefix(40, 2_250, 1_000, 3) == 53_000  # contra 90,000 sin compartir
    assert kv_tokens_with_shared_prefix(40, 2_250, 0, 0) == 90_000


def test_tp_must_divide_kv_heads():
    with pytest.raises(ValueError, match="no se dividen"):
        kv_room_per_replica(FP8_WEIGHTS, H100_80GB, 3, 0.90, 5 * GB)


@pytest.mark.parametrize("util", [0, 1.2, -0.1])
def test_invalid_utilization(util):
    with pytest.raises(ValueError):
        kv_room_per_replica(FP8_WEIGHTS, H100_80GB, 2, util, 5 * GB)
