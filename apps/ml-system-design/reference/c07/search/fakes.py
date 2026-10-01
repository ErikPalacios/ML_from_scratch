"""Fakes de search/api.py para los tests y la demo local. NO van a producción.

Un "embedding" de juguete: cada palabra es un vector pseudoaleatorio fijo (sha256 de la palabra) y el
texto es el promedio normalizado. No entiende nada (no sabe que "chamarra" ≈ "chaqueta"), pero da
vectores deterministas de verdad para probar el cableado: shards, filtros, versiones, timeouts.
Cada fake acepta `delay_s` y `fail` para simular la falla que quieras.
"""

from __future__ import annotations  # anotaciones como texto

import asyncio  # sleep: simula latencia de red
import hashlib  # vector determinista por palabra
import math  # norma
import re  # tokenizar
from collections.abc import Sequence  # tipos

from api import Deps, Filters, Hit, ShardResult  # tipos del contrato

DIM = 64  # chico a propósito: la demo no necesita 512


def _tokens(text: str) -> list[str]:
    return re.findall(r"[a-záéíóúñü0-9]+", text.lower())


def _word_vec(word: str) -> list[float]:
    h = hashlib.sha256(word.encode()).digest() * 2  # 64 bytes → 64 componentes
    return [(b - 127.5) / 127.5 for b in h[:DIM]]


def embed_text(text: str) -> list[float]:
    vs = [_word_vec(w) for w in _tokens(text)] or [_word_vec("")]
    v = [sum(c) / len(vs) for c in zip(*vs)]
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


def dot(a: Sequence[float], b: Sequence[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


class FakeEncoder:
    def __init__(self, model_version: str = "2026-09-15-clip-ft-v7", delay_s: float = 0.0, fail: bool = False):
        self.model_version, self.delay_s, self.fail = model_version, delay_s, fail
        self.calls = 0

    async def _go(self):
        self.calls += 1
        await asyncio.sleep(self.delay_s)
        if self.fail:
            raise RuntimeError("Triton no disponible")

    async def encode_text(self, text: str) -> list[float]:
        await self._go()
        return embed_text(text)

    async def encode_image(self, data: bytes) -> list[float]:
        await self._go()
        # "Foto" de juguete: el texto que viene después de la firma JPEG/PNG (la demo manda eso)
        return embed_text(data[3:].decode("utf-8", "ignore"))


class FakeShard:
    """Un shard en memoria con brute force exacto (el real es HNSW-SQ8 + re-score)."""

    def __init__(self, name: str, items: list[dict], model_version: str = "2026-09-15-clip-ft-v7",
                 supports_inline_filter: bool = True, delay_s: float = 0.0, fail: bool = False):
        self.name, self.items, self.model_version = name, items, model_version
        self.supports_inline_filter, self.delay_s, self.fail = supports_inline_filter, delay_s, fail
        self.requests: list[tuple[int, dict]] = []  # (k, filtros) que recibió: para los tests

    async def search(self, vector, k: int, filters: dict) -> ShardResult:
        self.requests.append((k, filters))
        await asyncio.sleep(self.delay_s)
        if self.fail:
            raise ConnectionError(f"{self.name} caído")
        f = Filters(**filters)
        pool = [it for it in self.items if f.matches(it["attrs"])] if filters else self.items
        scored = sorted(pool, key=lambda it: -dot(vector, it["vec"]))[:k]
        return ShardResult([Hit(it["id"], dot(vector, it["vec"]), it["attrs"], it["title"]) for it in scored],
                           self.model_version)


class FakeKeyword:
    """BM25 de juguete: cuenta palabras de la query presentes en el título. Filtros nativos."""

    def __init__(self, items: list[dict], delay_s: float = 0.0, fail: bool = False):
        self.items, self.delay_s, self.fail = items, delay_s, fail

    async def search(self, text: str, filters: dict, k: int) -> list[Hit]:
        await asyncio.sleep(self.delay_s)
        if self.fail:
            raise ConnectionError("OpenSearch caído")
        f = Filters(**filters)
        q = set(_tokens(text))
        scored = [(len(q & set(_tokens(it["title"]))), it) for it in self.items if f.matches(it["attrs"])]
        scored = sorted((s for s in scored if s[0] > 0), key=lambda s: (-s[0], s[1]["id"]))[:k]
        return [Hit(it["id"], float(s), it["attrs"], it["title"]) for s, it in scored]


class FakeTombstones:
    def __init__(self, ids: set[str] | None = None, delay_s: float = 0.0, fail: bool = False):
        self.ids, self.delay_s, self.fail = set(ids or ()), delay_s, fail

    async def contains_many(self, ids) -> set[str]:
        await asyncio.sleep(self.delay_s)
        if self.fail:
            raise ConnectionError("Redis caído")
        return self.ids & set(ids)


class FakeReranker:
    """Cross-encoder de juguete: fracción de palabras de la query en el título."""

    def __init__(self, delay_s: float = 0.0, fail: bool = False):
        self.delay_s, self.fail = delay_s, fail
        self.seen: list[int] = []  # cuántos pares recibió en cada llamada

    async def score(self, query: str, hits) -> list[float]:
        self.seen.append(len(hits))
        await asyncio.sleep(self.delay_s)
        if self.fail:
            raise RuntimeError("GPU del reranker ocupada")
        q = set(_tokens(query))
        return [len(q & set(_tokens(h.title))) / max(1, len(q)) for h in hits]


# ---------------------------------------------------------------------------- catálogo de juguete
DEMO = [
    ("L1", "Chamarra de mezclilla vintage talla M", 812, 650, "GDL", "good", True),
    ("L2", "Chamarra de mezclilla Levi's talla L", 812, 900, "CDMX", "like_new", True),
    ("L3", "Chaqueta de cuero negra talla M", 812, 1200, "GDL", "good", False),
    ("L4", "Sudadera vintage gris talla M", 812, 300, "MTY", "fair", True),
    ("L5", "iPhone 13 128 GB azul", 120, 7800, "CDMX", "good", True),
    ("L6", "Funda para iPhone 13 transparente", 121, 90, "GDL", "new", True),
    ("L7", "Bicicleta de montaña rodada 29", 330, 5200, "QRO", "good", False),
    ("L8", "Chamarra impermeable para bicicleta", 812, 750, "QRO", "like_new", True),
    ("L9", "Tenis Nike Air Max 270 talla 27", 815, 1400, "GDL", "good", True),
    ("L10", "Mesa de centro de madera vintage", 410, 1800, "MTY", "fair", False),
    ("L11", "Chamarra de mezclilla con borrego talla S", 812, 700, "MER", "good", True),
    ("L12", "Lámpara de escritorio vintage", 410, 400, "CDMX", "good", True),
]


def demo_items() -> list[dict]:
    return [{"id": i, "title": t, "vec": embed_text(t),
             "attrs": {"category_id": c, "price": p, "city": city, "condition": cond, "ships_nationwide": ship}}
            for i, t, c, p, city, cond, ship in DEMO]


def demo_deps(n_shards: int = 4, tombstoned: set[str] | None = None) -> Deps:
    """Reparte los listings en n shards por hash del id, como el adaptador real."""
    items = demo_items()
    shards = [FakeShard(f"shard-{s}", [it for it in items if int(hashlib.md5(it["id"].encode()).hexdigest(), 16)
                                       % n_shards == s]) for s in range(n_shards)]
    return Deps(encoder=FakeEncoder(), shards=shards, keyword=FakeKeyword(items),
                tombstones=FakeTombstones(tombstoned if tombstoned is not None else {"L2"}),
                reranker=FakeReranker())
