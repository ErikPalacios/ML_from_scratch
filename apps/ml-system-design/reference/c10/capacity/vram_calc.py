"""VRAM de un LLM servido (caso c10): pesos + KV cache por token → cuántas secuencias caben por réplica.

La cuenta del caso, a mano, con la arquitectura de Llama 3.x 70B (la de #m04) y los números del caso:

  KV por token  = 2 (K y V) × 80 capas × 8 KV heads × 128 dims × 2 B (BF16)  = 327,680 B = 320 KiB
                  (en FP8: 1 B por elemento → 160 KiB)
  pesos en FP8  = 70.6 B params × 1 B                                        ≈ 70.6 GB
  una réplica   = 2 × H100 (80 GB cada una) con tensor parallelism 2 (TP=2)
  lugar para KV = 0.90 × 160 GB − 70.6 GB − ≈ 5 GB (runtime, activaciones, CUDA graphs; est.) ≈ 68.4 GB
  una secuencia = 2,000 tokens de prompt + 250 de salida = 2,250 tokens × 320 KiB ≈ 0.737 GB
  secuencias    = 68.4 ÷ 0.737 ≈ 92.8 → 92 enteras (el caso dice "≈ 93": es el cociente redondeado)
                  con KV en FP8, el doble: ≈ 185

Por qué importa: en un LLM el cómputo casi nunca es lo primero que se acaba. Lo primero es la VRAM que
queda para el KV cache, y eso fija cuántas conversaciones atiende una réplica a la vez (#m04.vram).

Tres cosas que esta cuenta NO hace, a propósito:
  * No reemplaza el número que imprime vLLM al arrancar ("GPU KV cache size: N tokens" y la concurrencia
    máxima para max_model_len). Ese es el real: vLLM perfila la memoria con tu modelo, tu versión y tus
    CUDA graphs. Esta cuenta sirve para decidir el hardware ANTES de tenerlo y para detectar un error de
    órdenes de magnitud después.
  * "80 GB" es el nominal de la hoja de datos. nvidia-smi muestra 81,559 MiB (≈ 85.5 GB) en una H100 SXM,
    y gpu_memory_utilization se aplica sobre lo que reporta la GPU: en la práctica queda MÁS lugar
    (≈ 78 GB en vez de 68; ver test_reported_h100_memory_gives_more_room). El caso usa el nominal porque es
    conservador y porque no mezcla GB de hoja de datos con MiB de nvidia-smi.
  * No cuenta el reuso de prefijos: con prefix caching, los bloques del system prompt compartido existen
    una vez y no una por secuencia (kv_tokens_with_shared_prefix). Es una palanca, no la base del plan.

Solo biblioteca estándar. Unidades: bytes en todos lados; GB = 10^9 B, GiB/KiB = 2^30/2^10 B.
"""

from __future__ import annotations  # anotaciones como texto (no evalúa tipos al importar)

import math  # floor/ceil explícitos: media secuencia no existe
from dataclasses import dataclass  # configuraciones inmutables y legibles

GB = 10**9  # gigabyte decimal: el de las hojas de datos y de AWS
KIB = 2**10  # kibibyte: el del KV cache por token (#m04 usa 128 KiB y 320 KiB)
GIB = 2**30  # gibibyte: el de nvidia-smi y PyTorch
MIB = 2**20  # mebibyte: nvidia-smi reporta la memoria total en MiB


@dataclass(frozen=True)
class ModelConfig:
    """Lo que hace falta de un LLM para la cuenta de memoria (sale del config.json del modelo)."""

    name: str  # solo para los mensajes
    params: float  # parámetros totales (70.6e9): define el peso de los pesos
    layers: int  # num_hidden_layers: cada capa guarda su propio K y V
    kv_heads: int  # num_key_value_heads: con GQA son menos que los heads de atención (8 contra 64)
    head_dim: int  # dimensión por head (hidden_size ÷ num_attention_heads = 8192 ÷ 64 = 128)
    weight_bytes_per_param: float = 2.0  # 2 = BF16, 1 = FP8/INT8, 0.5 = INT4 (sin contar escalas)
    kv_bytes_per_elem: float = 2.0  # dtype del KV cache: 2 = BF16 (default de vLLM: "auto"), 1 = FP8
    high_precision_params: float = 0.0  # params que un checkpoint cuantizado deja en BF16 (embeddings, lm_head)

    def __post_init__(self) -> None:
        # Validar al construir: una config absurda debe fallar aquí y no dar un número absurdo después
        if self.params <= 0 or self.layers <= 0 or self.kv_heads <= 0 or self.head_dim <= 0:
            raise ValueError(f"{self.name}: params, layers, kv_heads y head_dim deben ser > 0")
        if not 0 <= self.high_precision_params < self.params:
            raise ValueError(f"{self.name}: high_precision_params debe estar entre 0 y params")


@dataclass(frozen=True)
class GPU:
    """Una GPU por su memoria. La cuenta la usa en bytes."""

    name: str
    vram_bytes: float  # memoria total de UNA GPU


# Arquitectura de Llama 3 8B / 3.1 8B (la de #m04): 8.03 B params, 32 capas, 8 KV heads × 128.
LLAMA3_8B = ModelConfig("Llama 3 8B", params=8.03e9, layers=32, kv_heads=8, head_dim=128)
# Arquitectura de Llama 3.x 70B (3, 3.1 y 3.3 comparten forma): 70.6 B params, 80 capas, 8 KV heads × 128.
LLAMA3_70B = ModelConfig("Llama 3.x 70B", params=70.6e9, layers=80, kv_heads=8, head_dim=128)

H100_80GB = GPU("H100 SXM 80 GB (nominal)", 80 * GB)  # el número del caso y de #m04
H100_REPORTED = GPU("H100 SXM (nvidia-smi)", 81_559 * MIB)  # lo que reporta la GPU: ≈ 85.5 GB
L4_24GB = GPU("L4 24 GB (nominal)", 24 * GB)  # el ejemplo C de #m04


def with_dtypes(m: ModelConfig, weight_bytes: float, kv_bytes: float, high_precision_params: float = 0.0) -> ModelConfig:
    """La misma arquitectura con otros dtypes: comparar BF16 contra FP8 sin copiar la config."""
    return ModelConfig(m.name, m.params, m.layers, m.kv_heads, m.head_dim, weight_bytes, kv_bytes, high_precision_params)


def weight_bytes(m: ModelConfig) -> float:
    """Bytes de los pesos: params × bytes por param (+ la parte que el checkpoint deja en BF16).

    Un checkpoint FP8 real suele dejar embeddings y lm_head en BF16: en un 70B con vocabulario de
    128,256 son ≈ 2 × 128,256 × 8,192 ≈ 2.1 B params → ≈ 2 GB más que "70.6 GB". Mide el tamaño de los
    safetensors que vas a servir en lugar de confiar en la cuenta.
    """
    quantized = m.params - m.high_precision_params  # lo que sí está en el dtype reducido
    return quantized * m.weight_bytes_per_param + m.high_precision_params * 2.0  # el resto en BF16 (2 B)


def kv_bytes_per_token(m: ModelConfig) -> float:
    """2 (K y V) × capas × KV heads × head_dim × bytes. No depende de los parámetros del modelo."""
    return 2 * m.layers * m.kv_heads * m.head_dim * m.kv_bytes_per_elem


def kv_bytes_per_sequence(m: ModelConfig, tokens: int) -> float:
    """KV de una secuencia de `tokens` (prompt + salida): crece lineal con el largo."""
    if tokens <= 0:
        raise ValueError("tokens debe ser > 0")
    return kv_bytes_per_token(m) * tokens


def kv_room_per_replica(
    m: ModelConfig,
    gpu: GPU,
    tensor_parallel: int,
    gpu_memory_utilization: float,
    overhead_bytes: float,
) -> float:
    """Bytes que quedan para KV cache en UNA réplica (tensor_parallel GPUs que sirven juntas un modelo).

    gpu_memory_utilization: fracción de la VRAM que vLLM se permite usar (pesos + activaciones + KV). El
      default es 0.92 desde vLLM v0.20 (0.9 hasta v0.19): el caso fija 0.90 explícito en el manifest para
      que la capacidad no cambie con un upgrade.
    overhead_bytes: activaciones del forward, workspace, CUDA graphs y buffers de NCCL, sumados en la
      réplica. Es una estimación (≈ 5 GB en el caso); vLLM la mide al arrancar con un forward de prueba.
    """
    if tensor_parallel < 1:
        raise ValueError("tensor_parallel debe ser >= 1")
    if not 0 < gpu_memory_utilization <= 1:
        raise ValueError("gpu_memory_utilization debe estar en (0, 1]")
    if m.kv_heads % tensor_parallel != 0:
        # Con TP, cada GPU guarda los K/V de SUS KV heads. Si no se dividen exacto, el runtime replica heads
        # y la cuenta de abajo (KV total repartido sin duplicar) deja de valer: mejor fallar que mentir.
        raise ValueError(f"{m.kv_heads} KV heads no se dividen entre TP={tensor_parallel}")
    budget = tensor_parallel * gpu.vram_bytes * gpu_memory_utilization  # lo que vLLM puede usar en total
    room = budget - weight_bytes(m) - overhead_bytes  # los pesos se reparten entre las GPUs (TP), no se copian
    if room <= 0:
        raise ValueError(
            f"{m.name} no cabe: presupuesto {budget / GB:.1f} GB, pesos {weight_bytes(m) / GB:.1f} GB, "
            f"overhead {overhead_bytes / GB:.1f} GB"
        )
    return room


def max_concurrent_sequences(room_bytes: float, m: ModelConfig, tokens_per_sequence: int) -> int:
    """Cuántas secuencias de ese largo caben a la vez, todas en su largo máximo (peor caso, entero)."""
    return math.floor(room_bytes / kv_bytes_per_sequence(m, tokens_per_sequence))


def max_kv_tokens(room_bytes: float, m: ModelConfig) -> int:
    """Tokens totales de KV que caben. Al arrancar vLLM imprime un poco menos como "GPU KV cache size": cuenta
    bloques ENTEROS de 16 tokens por GPU (con TP=2 cada GPU guarda la mitad de los KV heads de cada token). En el
    caso: 208,740 aquí; 13,046 bloques × 16 = 208,736 en el log de vLLM."""
    return math.floor(room_bytes / kv_bytes_per_token(m))


def kv_tokens_with_shared_prefix(
    sequences: int, tokens_per_sequence: int, shared_prefix_tokens: int, distinct_prefixes: int
) -> int:
    """Tokens de KV ocupados si `sequences` comparten `distinct_prefixes` prefijos (prefix caching).

    Ejemplo del caso: 40 secuencias por réplica, 2,250 tokens, ≈ 1,000 de system prompt compartido por
    producto (3 productos): 40 × 1,250 + 3 × 1,000 = 53,000 tokens en vez de 90,000. Supone que los
    prefijos están en caché (bloques completos y no desalojados): es el mejor caso, no la base del plan.
    """
    if not 0 <= shared_prefix_tokens <= tokens_per_sequence:
        raise ValueError("el prefijo compartido debe estar entre 0 y el largo de la secuencia")
    if distinct_prefixes < 0:
        raise ValueError("distinct_prefixes debe ser >= 0")
    if shared_prefix_tokens > 0 and distinct_prefixes == 0:
        raise ValueError("un prefijo compartido necesita al menos un prefijo distinto")
    unique = sequences * (tokens_per_sequence - shared_prefix_tokens)  # la parte propia de cada secuencia
    shared = distinct_prefixes * shared_prefix_tokens  # cada prefijo, una sola vez
    return unique + shared


def report(m: ModelConfig, gpu: GPU, tp: int, util: float, overhead: float, seq_tokens: int) -> str:
    """Resumen legible de la cuenta completa (lo que imprime `python vram_calc.py`)."""
    room = kv_room_per_replica(m, gpu, tp, util, overhead)
    return (
        f"{m.name} en {tp} × {gpu.name} (util {util:.2f}, overhead {overhead / GB:.1f} GB)\n"
        f"  pesos           {weight_bytes(m) / GB:8.1f} GB\n"
        f"  KV por token    {kv_bytes_per_token(m) / KIB:8.0f} KiB\n"
        f"  lugar para KV   {room / GB:8.1f} GB  ({max_kv_tokens(room, m):,} tokens)\n"
        f"  secuencias de {seq_tokens:,} tokens a la vez: {max_concurrent_sequences(room, m, seq_tokens)}"
    )


if __name__ == "__main__":
    # La cuenta del caso: 70B con pesos FP8, KV en BF16 y en FP8, 2 × H100, 0.90, ≈ 5 GB de overhead.
    fp8_weights = with_dtypes(LLAMA3_70B, weight_bytes=1.0, kv_bytes=2.0)
    print(report(fp8_weights, H100_80GB, tp=2, util=0.90, overhead=5 * GB, seq_tokens=2_250))
    print(report(with_dtypes(LLAMA3_70B, 1.0, 1.0), H100_80GB, tp=2, util=0.90, overhead=5 * GB, seq_tokens=2_250))
    # El ejemplo C de #m04: Llama 3 8B en BF16 en una L4, secuencias de 8k.
    print(report(LLAMA3_8B, L4_24GB, tp=1, util=0.90, overhead=2 * GB, seq_tokens=8_192))
