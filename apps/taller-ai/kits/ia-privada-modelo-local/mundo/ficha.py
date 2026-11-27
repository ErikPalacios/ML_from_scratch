"""Lee la ficha de un archivo GGUF (su encabezado: metadatos y lista de tensores) sin cargar los pesos.

    python3 mundo/ficha.py                       # el modelo del catálogo
    python3 mundo/ficha.py modelo/otro.gguf      # cualquier GGUF
    python3 mundo/ficha.py --tipos               # además, cuántos pesos hay de cada tipo (Q8_0, F32, …)

GGUF es el formato de llama.cpp: un encabezado con pares llave-valor (arquitectura, capas, cabezas, plantilla de chat,
tokenizer) y la lista de tensores (nombre, forma, tipo), y después los pesos. Solo biblioteca estándar.
"""
from __future__ import annotations

import math
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import RAIZ, ruta_modelo  # noqa: E402

ESCALARES = {0: "<B", 1: "<b", 2: "<H", 3: "<h", 4: "<I", 5: "<i", 6: "<f", 7: "<?", 10: "<Q", 11: "<q", 12: "<d"}
# tipos de tensor de ggml: (nombre, pesos por bloque, bytes por bloque)
TIPOS = {0: ("F32", 1, 4), 1: ("F16", 1, 2), 2: ("Q4_0", 32, 18), 3: ("Q4_1", 32, 20), 6: ("Q5_0", 32, 22), 7: ("Q5_1", 32, 24),
         8: ("Q8_0", 32, 34), 10: ("Q2_K", 256, 84), 11: ("Q3_K", 256, 110), 12: ("Q4_K", 256, 144), 13: ("Q5_K", 256, 176),
         14: ("Q6_K", 256, 210), 15: ("Q8_K", 256, 292), 30: ("BF16", 1, 2)}


def _leer(f, fmt):
    return struct.unpack(fmt, f.read(struct.calcsize(fmt)))[0]


def _texto(f) -> str:
    return f.read(_leer(f, "<Q")).decode("utf-8", errors="replace")


def _valor(f, t):
    if t in ESCALARES:
        return _leer(f, ESCALARES[t])
    if t == 8:
        return _texto(f)
    if t == 9:
        tt, n = _leer(f, "<I"), _leer(f, "<Q")
        if tt in ESCALARES and n > 64:          # listas largas (el vocabulario): se saltan, solo se cuentan
            f.seek(n * struct.calcsize(ESCALARES[tt]), 1)
            return f"<{n:,} valores>"
        vals = [_valor(f, tt) for _ in range(n)]
        return vals if n <= 64 else f"<{n:,} valores>"
    raise ValueError(f"tipo GGUF desconocido: {t}")


def ficha(p: Path) -> tuple[dict, list[tuple[str, list[int], int]]]:
    with open(p, "rb") as f:
        if f.read(4) != b"GGUF":
            raise ValueError(f"{p} no es un GGUF")
        version, n_t, n_kv = _leer(f, "<I"), _leer(f, "<Q"), _leer(f, "<Q")
        meta = {"gguf.version": version}
        for _ in range(n_kv):
            k = _texto(f)
            meta[k] = _valor(f, _leer(f, "<I"))
        tensores = []
        for _ in range(n_t):
            nombre = _texto(f)
            forma = [_leer(f, "<Q") for _ in range(_leer(f, "<I"))]
            tipo = _leer(f, "<I")
            _leer(f, "<Q")
            tensores.append((nombre, forma, tipo))
    return meta, tensores


def resumen(p: Path) -> dict:
    """Lo que dice el encabezado: arquitectura, capas, cabezas, pesos y bytes por tipo de cuantización."""
    meta, tens = ficha(p)
    a = meta["general.architecture"]
    por = {}
    for _, s, t in tens:
        k = math.prod(s)
        nom, bloque, bytes_ = TIPOS.get(t, (f"tipo {t}", 1, 0))
        c = por.setdefault(nom, {"tensores": 0, "pesos": 0, "bytes": 0})
        c["tensores"] += 1
        c["pesos"] += k
        c["bytes"] += k // bloque * bytes_
    n, b = sum(c["pesos"] for c in por.values()), sum(c["bytes"] for c in por.values())
    return {"arquitectura": a, "capas": meta[f"{a}.block_count"], "cabezas_kv": meta[f"{a}.attention.head_count_kv"],
            "pesos": n, "bytes_pesos": b, "bits_por_peso": round(b * 8 / n, 3), "tipos": por}


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    p = Path(args[0]) if args else ruta_modelo()
    p = p if p.is_absolute() or p.exists() else RAIZ / p
    if not p.exists():
        sys.exit(f"✗ no está {p}: python3 mundo/modelos.py")
    meta, tens = ficha(p)
    a = meta["general.architecture"]
    capas, cab, cab_kv = meta[f"{a}.block_count"], meta[f"{a}.attention.head_count"], meta[f"{a}.attention.head_count_kv"]
    dim = meta.get(f"{a}.attention.key_length", meta[f"{a}.embedding_length"] // cab)
    n = sum(math.prod(s) for _, s, _ in tens)
    print(f"{p.name}: {meta.get('general.name', '?')} · arquitectura {a} · GGUF v{meta['gguf.version']}")
    print(f"  {capas} capas · {cab} cabezas de atención, {cab_kv} de K/V, de {dim} · embedding {meta[f'{a}.embedding_length']:,} · contexto de entrenamiento {meta[f'{a}.context_length']:,}")
    print(f"  {len(tens)} tensores · {n:,} pesos · plantilla de chat: {'sí, ' + str(len(meta['tokenizer.chat_template'])) + ' caracteres' if 'tokenizer.chat_template' in meta else 'no'}")
    kv = 2 * capas * cab_kv * dim * 2
    print(f"  KV cache en f16: 2 × {capas} × {cab_kv} × {dim} × 2 B = {kv:,} B por token ({kv / 1024:.0f} KiB)")
    if "--tipos" in sys.argv:
        por = {}
        for _, s, t in tens:
            k = math.prod(s)
            nom, bloque, bytes_ = TIPOS.get(t, (f"tipo {t}", 1, 0))
            c = por.setdefault(nom, [0, 0, 0])
            c[0] += 1; c[1] += k; c[2] += k // bloque * bytes_
        tot = sum(c[2] for c in por.values())
        for nom, (nt, k, b) in sorted(por.items(), key=lambda x: -x[1][1]):
            print(f"  {nom:<6} {nt:>4} tensores · {k:>13,} pesos ({k / n:6.1%}) · {b / 1e6:8.1f} MB · {b * 8 / k:5.2f} bits por peso")
        print(f"  total  {tot / 1e6:,.1f} MB de pesos · {tot * 8 / n:.2f} bits por peso en promedio")
