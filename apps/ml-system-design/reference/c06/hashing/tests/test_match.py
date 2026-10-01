"""Tests de hashing/match.py con hashes sintéticos: aleatorios + bits volteados a distancia conocida."""

import numpy as np
import pytest

import match as m


def flip_bits(h: np.ndarray, k: int, rng: np.random.Generator) -> np.ndarray:
    """Copia de h con exactamente k bits distintos (posiciones al azar, sin repetir)."""
    out = h.copy()
    for bit in rng.choice(m.PDQ_BITS, size=k, replace=False):
        out[bit // 8] ^= 1 << (7 - bit % 8)
    return out


def flip_one_per_slot(h: np.ndarray, per_slot: int) -> np.ndarray:
    """El peor caso del pigeonhole: `per_slot` bits distintos en CADA uno de los 16 slots."""
    out = h.copy()
    for slot in range(m.SLOTS):
        for j in range(per_slot):
            bit = slot * m.SLOT_BITS + j
            out[bit // 8] ^= 1 << (7 - bit % 8)
    return out


@pytest.fixture
def rng():
    return np.random.default_rng(42)


@pytest.fixture
def index(rng):
    """5,000 hashes aleatorios ya compactados (índice estático), como después de cargar un snapshot."""
    idx = m.PdqIndex()
    data = rng.integers(0, 256, size=(5000, m.PDQ_BYTES), dtype=np.uint8)
    idx.add_many((f"e{i}", m.hash_to_hex(data[i]), "own_removed", "spam_scams") for i in range(5000))
    return idx, data


def test_hex_roundtrip_and_validation():
    h = "f" * 64
    assert m.hash_to_hex(m.hex_to_hash(h)) == h
    with pytest.raises(ValueError):
        m.hex_to_hash("abc")  # truncado: no debe "casi coincidir" con nada
    with pytest.raises(ValueError):
        m.hex_to_hash("z" * 64)


def test_hamming_counts_bits(rng):
    a = rng.integers(0, 256, size=m.PDQ_BYTES, dtype=np.uint8)
    for k in (0, 1, 7, 31, 32, 128, 256):
        assert m.hamming(a, flip_bits(a, k, rng)) == k


def test_hamming_many_matches_unpackbits(rng):
    q = rng.integers(0, 256, size=m.PDQ_BYTES, dtype=np.uint8)
    mat = rng.integers(0, 256, size=(100, m.PDQ_BYTES), dtype=np.uint8)
    expected = np.unpackbits(np.bitwise_xor(mat, q), axis=1).sum(axis=1)  # la forma "obvia"
    assert np.array_equal(m.hamming_many(q, mat), expected)


def test_two_random_hashes_are_far_apart(rng):
    """Por qué 31 es un umbral seguro: dos hashes independientes difieren en ≈ 128 bits (binomial(256, 0.5))."""
    a = rng.integers(0, 256, size=(2000, m.PDQ_BYTES), dtype=np.uint8)
    b = rng.integers(0, 256, size=(2000, m.PDQ_BYTES), dtype=np.uint8)
    d = np.array([m.hamming(x, y) for x, y in zip(a, b)])
    assert 120 < d.mean() < 136
    assert d.min() > 31  # en 2,000 pares, ninguno cae cerca del umbral (σ = 8 bits: 31 está a 12 σ)


def test_neighbors_within():
    assert m.neighbors_within(0, 0) == [0]
    n1 = m.neighbors_within(0b1010, 1)
    assert len(n1) == 17 and len(set(n1)) == 17  # el valor + 16 vecinos a 1 bit
    assert len(set(m.neighbors_within(0, 2))) == 1 + 16 + 120  # + C(16, 2)


def test_slot_radius_follows_pigeonhole():
    assert m.PdqIndex(threshold=31).slot_radius == 1
    assert m.PdqIndex(threshold=15).slot_radius == 0
    assert m.PdqIndex(threshold=47).slot_radius == 2


@pytest.mark.parametrize("k", [0, 1, 5, 16, 30, 31])
def test_finds_near_duplicates_up_to_threshold(index, rng, k):
    idx, data = index
    q = flip_bits(data[77], k, rng)
    hits = idx.query(m.hash_to_hex(q))
    assert hits and hits[0].entry_id == "e77" and hits[0].distance == k


@pytest.mark.parametrize("k", [32, 40, 64])
def test_does_not_match_beyond_threshold(index, rng, k):
    idx, data = index
    q = flip_bits(data[77], k, rng)
    assert all(h.entry_id != "e77" for h in idx.query(m.hash_to_hex(q)))


def test_worst_case_spread_31_bits_still_found(index):
    """31 bits repartidos para que 15 slots tengan 2 bits distintos y 1 slot tenga 1: solo ese slot
    queda a radio ≤ 1. Es exactamente el caso que el pigeonhole garantiza encontrar."""
    idx, data = index
    q = flip_one_per_slot(data[3], 2)  # 2 bits en cada slot = 32 bits
    q[0] ^= 0b0100_0000  # devolver 1 bit del primer slot → 31 bits, slot 0 a distancia 1
    assert m.hamming(q, data[3]) == 31
    assert [h.entry_id for h in idx.query(m.hash_to_hex(q))] == ["e3"]


def test_two_bits_in_every_slot_is_out_of_reach_and_beyond_threshold(index):
    """32 bits, 2 por slot: ningún slot a ≤ 1, y tampoco es match (32 > 31). El índice no pierde nada."""
    idx, data = index
    q = flip_one_per_slot(data[3], 2)
    assert m.hamming(q, data[3]) == 32
    assert idx.query(m.hash_to_hex(q)) == []
    assert idx.query_linear(m.hash_to_hex(q)) == []


def test_index_equals_linear_scan_on_random_queries(index, rng):
    idx, data = index
    for _ in range(200):
        base = data[rng.integers(0, len(data))]
        q = flip_bits(base, int(rng.integers(0, 45)), rng)
        qh = m.hash_to_hex(q)
        assert idx.query(qh) == idx.query_linear(qh)


def test_candidates_are_a_small_fraction(index, rng):
    """≈ N × 16 × 17 / 65,536 ≈ 0.4 % de las filas con hashes uniformes: el índice filtra de verdad."""
    idx, _ = index
    q = rng.integers(0, 256, size=m.PDQ_BYTES, dtype=np.uint8)
    assert len(idx.candidates(q)) < 0.02 * len(idx)


def test_low_quality_hash_is_not_indexed_nor_queried(rng):
    idx = m.PdqIndex()
    h = m.hash_to_hex(rng.integers(0, 256, size=m.PDQ_BYTES, dtype=np.uint8))
    assert idx.add("bad", h, "own_removed", "spam_scams", quality=49) is False
    assert idx.add("ok", h, "own_removed", "spam_scams", quality=50) is True
    assert idx.query(h, quality=10) == []  # el gateway lo cuenta como "no verificable", no como limpio
    assert idx.query(h, quality=90)[0].entry_id == "ok"


def test_add_is_idempotent_and_delta_is_searchable_before_compact(index, rng):
    idx, _ = index
    new = rng.integers(0, 256, size=m.PDQ_BYTES, dtype=np.uint8)
    assert idx.add("fresh", m.hash_to_hex(new), "own_removed", "hate_harassment")
    assert not idx.add("fresh", m.hash_to_hex(new), "own_removed", "hate_harassment")  # repetida
    hits = idx.query(m.hash_to_hex(flip_bits(new, 9, rng)))  # está en el delta, no en el índice estático
    assert [(h.entry_id, h.policy, h.distance) for h in hits] == [("fresh", "hate_harassment", 9)]


def test_remove_takes_effect_immediately_and_survives_compact(index, rng):
    idx, data = index
    qh = m.hash_to_hex(flip_bits(data[10], 4, rng))
    assert idx.query(qh)[0].entry_id == "e10"
    assert idx.remove("e10") and not idx.remove("e10")
    assert idx.query(qh) == []  # tombstone: sin esperar a compactar
    n = len(idx)
    idx.compact()
    assert len(idx) == n and idx.query(qh) == []
    assert idx.query(m.hash_to_hex(data[11]))[0].entry_id == "e11"  # las demás siguen


def test_auto_compact_when_delta_grows(rng):
    idx = m.PdqIndex(delta_max=50)
    data = rng.integers(0, 256, size=(120, m.PDQ_BYTES), dtype=np.uint8)
    for i in range(120):
        idx.add(f"x{i}", m.hash_to_hex(data[i]), "industry_terror", "violent_extremism")
    assert idx._indexed >= 100  # compactó al menos dos veces
    for i in (0, 60, 119):
        assert idx.query(m.hash_to_hex(data[i]))[0].entry_id == f"x{i}"


def test_text_normalization_defeats_cheap_tricks():
    base = "Gana dinero desde casa"
    variants = [
        "GANA   dinero desde casa",
        "Gana​ dinero desde‍ casa",  # ancho cero
        "Gаna dinero desde cаsa",  # 'а' cirílica
        "Ｇａｎａ dinero desde casa",  # fullwidth
    ]
    assert all(m.text_hash(v) == m.text_hash(base) for v in variants)
    assert m.text_hash("G a n a   dinero desde casa") == m.text_hash(base)  # letras sueltas se pegan
    assert m.normalize_text("voy a y o") == "voy a y o"  # menos de 4 sueltas: no se toca
    assert m.text_hash("G-a-n-a dinero desde casa") != m.text_hash(base)  # límite conocido: eso es del modelo


def test_text_hash_set():
    s = m.TextHashSet()
    s.add("t1", "Compra seguidores YA", "own_removed", "spam_scams")
    assert s.query("compra  SEGUIDORES ya").entry_id == "t1"
    assert s.query("otra cosa") is None


def test_domain_blocklist_suffix_not_substring():
    b = m.DomainBlocklist()
    b.add("bad.example", "phishing", "spam_scams")
    assert b.query("https://bad.example/login").entry_id == "bad.example"
    assert b.query("http://a.b.BAD.example:8080/x").entry_id == "bad.example"
    assert b.query("bad.example/promo") is not None  # sin esquema
    assert b.query("https://notbad.example/") is None  # sufijo de string, no de dominio
    assert b.query("https://bad.example.evil.test/") is None
