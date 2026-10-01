"""Etapa 0 de la cascada (`hash-match`, caso c06): ¿este contenido ya lo conocemos como violatorio?

Tres índices en memoria, todos locales al proceso del `mod-gateway` (sin llamadas remotas):

1. `PdqIndex` — hashes perceptuales PDQ de imágenes (256 bits). Una foto recomprimida, redimensionada
   o con un borde agregado cambia sus bytes (el sha256 ya no coincide) pero su PDQ cambia pocos bits.
   "Coincide" = distancia de Hamming ≤ 31, el umbral que recomienda la implementación de referencia
   de Meta (README de pdq en facebook/ThreatExchange). Esa misma página recomienda descartar hashes
   con calidad ≤ 49 (imágenes casi planas: su hash no discrimina y daría falsos positivos).
2. `TextHashSet` — texto normalizado + sha256: atrapa el mismo texto copiado con trucos baratos
   (mayúsculas, espacios, caracteres de ancho cero, algunos homoglifos). NO es near-duplicate real.
3. `DomainBlocklist` — dominios de spam/phishing y sus subdominios.

Por qué es local y no un servicio: la verificación S0 (CSAM, terrorismo) NO puede depender de que una
llamada remota responda a tiempo. Si el modelo de la etapa 1 se cae, el gateway publica "fail open"
para S1–S3, pero un hash conocido de S0 se sigue bloqueando porque esta búsqueda corre en el mismo
proceso (ver gateway/main.py).

Búsqueda: multi-index hashing (MIH). Partimos los 256 bits en 16 "slots" de 16 bits. Pigeonhole: si
dos hashes están a distancia d, la suma de las distancias de sus 16 slots es d, así que AL MENOS UN
slot está a distancia ≤ floor(d / 16). Ejemplos:
  - umbral 15 → algún slot es IDÉNTICO (floor(15/16) = 0): una búsqueda exacta por slot basta.
  - umbral 31 → algún slot está a ≤ 1 bit (floor(31/16) = 1): por slot buscamos el valor exacto y sus
    16 vecinos a 1 bit (17 consultas por slot, 272 en total). Más barato que partir en 32 slots de 8 bits
    con búsqueda exacta: cada bucket de 8 bits tendría N/256 hashes (con 10 M, ≈ 39k por slot y
    ≈ 1.25 M candidatos por consulta).
Es el mismo esquema del índice MIH256 de la implementación C++ de Meta (16 slots de 16 bits, radio
por slot = floor(d/16)). Los candidatos se verifican con la distancia completa: el índice nunca
devuelve algo a más de `threshold`.

Cuántos candidatos (con hashes ALEATORIOS, uniformes): cada consulta de slot toca N × 17 / 65,536
hashes → 16 slots ≈ N × 0.0042. Con N = 1 M ≈ 4.2k candidatos por imagen, verificados con numpy.
Hashes reales NO son uniformes (fotos parecidas → bits parecidos), así que hay más candidatos: mídelo
con tus listas (`python match.py --bench`).

Medido con `--bench` (1 M hashes aleatorios, Mac Apple Silicon, un proceso): consulta MIH ≈ 0.5–2 ms,
escaneo lineal ≈ 35 ms (no cabe con 10 imágenes en 120 ms); carga + compactación ≈ 3 s; pico de memoria
del proceso ≈ 600 MB (incluye los datos de prueba). Memoria del índice por hash: 32 B del hash + 64 B
de los 16 arreglos de filas + el id (string) y su entrada en el dict. Esta versión es para enseñar y
para listas de hasta unos pocos millones; con decenas de millones usarías la implementación C++ de
Meta (pdq/cpp/index) o un índice binario de faiss, y lo medirías igual.
"""

from __future__ import annotations  # anotaciones como texto: sintaxis moderna sin costo en runtime

import hashlib  # sha256 del texto normalizado
import re  # colapsar espacios
import unicodedata  # NFKC: unifica formas Unicode "equivalentes" (ｆｕｌｌｗｉｄｔｈ → fullwidth)
from dataclasses import dataclass  # resultados inmutables y legibles
from urllib.parse import urlsplit  # extraer el host de una URL sin regex frágiles

import numpy as np  # XOR + popcount vectorizados: verificar miles de candidatos en microsegundos

# ---------------------------------------------------------------------------- constantes PDQ
PDQ_BITS = 256  # PDQ produce 256 bits (64 caracteres hex)
PDQ_BYTES = PDQ_BITS // 8  # 32 bytes por hash: 10 M hashes ≈ 320 MB, más ≈ 640 MB del índice y los ids
PDQ_MATCH_THRESHOLD = 31  # distancia ≤ 31 = match (recomendación del README de PDQ en ThreatExchange)
PDQ_MIN_QUALITY = 50  # calidad ≤ 49 → descartar el hash (misma fuente): no se indexa ni se consulta
SLOTS = 16  # 16 slots de 16 bits: el diseño de MIH256
SLOT_BITS = PDQ_BITS // SLOTS  # 16 bits por slot → 65,536 valores posibles por bucket

# Tabla de popcount para 1 byte: POPCOUNT8[x] = cantidad de bits en 1 de x (0..8).
# Indexar una tabla de 256 entradas con un arreglo uint8 es una sola operación de numpy.
POPCOUNT8 = np.array([bin(i).count("1") for i in range(256)], dtype=np.uint8)


def hex_to_hash(hex_str: str) -> np.ndarray:
    """'f3a0…' (64 hex) → arreglo uint8[32]. Valida largo y caracteres: un hash truncado no debe 'casi coincidir'."""
    s = hex_str.strip().lower()
    if len(s) != PDQ_BYTES * 2:  # 64 caracteres exactos
        raise ValueError(f"un hash PDQ tiene {PDQ_BYTES * 2} caracteres hex, llegaron {len(s)}")
    try:
        raw = bytes.fromhex(s)  # falla con caracteres que no son hex
    except ValueError as exc:
        raise ValueError("hash PDQ con caracteres no hexadecimales") from exc
    return np.frombuffer(raw, dtype=np.uint8).copy()  # copy: frombuffer devuelve una vista de solo lectura


def hash_to_hex(h: np.ndarray) -> str:
    """Inversa de hex_to_hash (para logs y para exportar listas)."""
    return bytes(np.asarray(h, dtype=np.uint8)).hex()


def hamming(a: np.ndarray, b: np.ndarray) -> int:
    """Distancia de Hamming entre dos hashes uint8[32]: cuántos de los 256 bits difieren."""
    return int(POPCOUNT8[np.bitwise_xor(a, b)].sum())  # XOR marca los bits distintos; popcount los cuenta


def hamming_many(query: np.ndarray, matrix: np.ndarray) -> np.ndarray:
    """Distancia de `query` (uint8[32]) a cada fila de `matrix` (uint8[N, 32]) → int[N].

    Alternativa equivalente: np.unpackbits(xor, axis=1).sum(axis=1). La tabla evita materializar
    N × 256 bytes intermedios (8× más memoria que N × 32).
    """
    return POPCOUNT8[np.bitwise_xor(matrix, query)].sum(axis=1, dtype=np.int32)


def slot_values(h: np.ndarray) -> list[int]:
    """Los 16 slots de 16 bits de un hash, como enteros 0..65535 (big-endian, igual que el hex)."""
    pairs = np.asarray(h, dtype=np.uint16).reshape(SLOTS, 2)  # 32 bytes → 16 pares de bytes
    return ((pairs[:, 0] << 8) | pairs[:, 1]).tolist()  # byte alto, byte bajo


def neighbors_within(value: int, radius: int, bits: int = SLOT_BITS) -> list[int]:
    """`value` y todos los valores a distancia ≤ radius (radius 0 → 1 valor; 1 → 17; 2 → 137)."""
    out = [value]
    frontier = [(value, -1)]  # (valor, último bit volteado): volteamos bits en orden creciente, sin repetir
    for _ in range(radius):
        nxt = []
        for v, last in frontier:
            for b in range(last + 1, bits):
                w = v ^ (1 << b)
                out.append(w)
                nxt.append((w, b))
        frontier = nxt
    return out


@dataclass(frozen=True)
class HashMatch:
    """Un hit: qué entrada de qué lista, a qué distancia."""

    entry_id: str  # id de la entrada en la lista (para auditar y para quitarla si fue un error)
    list_name: str  # "industry_csam", "industry_terror", "own_removed"…: decide la acción en el motor
    policy: str  # política a la que pertenece el contenido conocido
    distance: int  # 0 = la misma imagen; ≤ 31 = la misma imagen con transformaciones leves


class PdqIndex:
    """Índice PDQ en memoria: multi-index estático (CSR por slot) + un "delta" chico + tombstones.

    Por qué esta forma: las listas cambian todo el día (contenido que acabamos de remover, entradas
    retiradas por apelación) y no queremos reconstruir 10 M filas por cada cambio. Entonces:
    - add() agrega la fila al DELTA (filas nuevas aún sin indexar), que se escanea linealmente;
    - remove() marca la fila como muerta (tombstone): deja de coincidir al instante;
    - compact() reconstruye el índice estático con todo lo vivo (lo llama add() cuando el delta pasa
      de `delta_max`, o un job periódico). Es la idea de un LSM: escribir barato, ordenar en lote.
    Memoria del índice estático: por slot, un arreglo int32 de filas ordenadas por valor (4 B × N) y
    un arreglo de offsets de 65,537 posiciones. 16 slots → 64 B por hash, más 32 B del hash y el id.
    """

    def __init__(self, threshold: int = PDQ_MATCH_THRESHOLD, delta_max: int = 20_000):
        if not 0 <= threshold < PDQ_BITS:
            raise ValueError("umbral fuera de rango")
        self.threshold = threshold
        # Radio por slot: pigeonhole (ver docstring del módulo). Con 31 → 1; con 15 → 0.
        self.slot_radius = threshold // SLOTS
        # 20k filas en el delta ≈ 0.6 MB: escanearlas cuesta < 1 ms (est.; mídelo con --bench)
        self.delta_max = delta_max
        self._rows = np.zeros((0, PDQ_BYTES), dtype=np.uint8)  # un hash por fila (viva o muerta)
        self._alive = np.zeros(0, dtype=bool)  # tombstones: False = quitada
        self._list = np.zeros(0, dtype=np.uint8)  # código de lista por fila (≤ 256 listas)
        self._policy = np.zeros(0, dtype=np.uint8)  # código de política por fila
        self._ids: list[str] = []  # fila → entry_id
        self._row_of: dict[str, int] = {}  # entry_id → fila (solo vivas)
        self._names: list[str] = []  # código → nombre (listas y políticas comparten la tabla)
        self._code: dict[str, int] = {}
        self._n = 0  # filas usadas
        self._indexed = 0  # filas [0, _indexed) están en el índice estático; [_indexed, _n) son el delta
        # Índice estático en CSR, los 16 slots apilados (así una consulta es pura aritmética de numpy):
        self._sorted_rows = np.zeros((SLOTS, 0), dtype=np.int32)  # [slot, k] = filas ordenadas por valor del slot
        self._offsets = np.zeros((SLOTS, (1 << SLOT_BITS) + 1), dtype=np.int64)  # [slot, v]..[slot, v+1] = rango con valor v
        # Máscaras XOR para "el valor y sus vecinos a ≤ slot_radius bits" (1 + 16 = 17 con radio 1)
        self._flips = np.array(neighbors_within(0, self.slot_radius), dtype=np.int64)

    def __len__(self) -> int:
        return len(self._row_of)  # entradas vivas

    def _intern(self, name: str) -> int:
        if name not in self._code:
            if len(self._names) >= 256:
                raise ValueError("demasiados nombres de lista/política para uint8")
            self._code[name] = len(self._names)
            self._names.append(name)
        return self._code[name]

    def _grow(self, need: int) -> None:
        cap = len(self._rows)
        if need <= cap:
            return
        new_cap = max(1024, cap * 2, need)  # crecer ×2: add amortizado O(1)
        for attr, shape in (("_rows", (new_cap, PDQ_BYTES)), ("_alive", (new_cap,)),
                            ("_list", (new_cap,)), ("_policy", (new_cap,))):
            old = getattr(self, attr)
            grown = np.zeros(shape, dtype=old.dtype)
            grown[: self._n] = old[: self._n]
            setattr(self, attr, grown)

    def add(self, entry_id: str, hash_hex: str, list_name: str, policy: str, quality: int | None = None) -> bool:
        """Agrega una entrada. Devuelve False (y no indexa) si la calidad es baja o el id ya existe."""
        if quality is not None and quality < PDQ_MIN_QUALITY:
            return False  # un hash de baja calidad "coincide" con demasiadas imágenes planas
        if entry_id in self._row_of:
            return False  # idempotente: la misma actualización puede llegar dos veces (at-least-once)
        h = hex_to_hash(hash_hex)
        self._grow(self._n + 1)
        row = self._n
        self._rows[row] = h
        self._alive[row] = True
        self._list[row] = self._intern(list_name)
        self._policy[row] = self._intern(policy)
        self._ids.append(entry_id)
        self._row_of[entry_id] = row
        self._n += 1
        if self._n - self._indexed > self.delta_max:
            self.compact()  # el delta creció: ordenar en lote
        return True

    def add_many(self, entries) -> int:
        """Carga masiva (snapshot al arrancar): agrega todo y compacta UNA vez. Devuelve cuántas entraron."""
        saved, self.delta_max = self.delta_max, 1 << 62  # sin compactar en el medio
        try:
            added = sum(self.add(*e) for e in entries)
        finally:
            self.delta_max = saved
        self.compact()
        return added

    def remove(self, entry_id: str) -> bool:
        """Quita una entrada (p. ej. una apelación ganada: ese contenido NO era violatorio)."""
        row = self._row_of.pop(entry_id, None)
        if row is None:
            return False
        self._alive[row] = False  # deja de coincidir ya; el espacio se recupera en compact()
        return True

    def compact(self) -> None:
        """Reconstruye el índice estático con las filas vivas (descarta las muertas). ≈ 1 s por millón (medido, ver README)."""
        live = np.nonzero(self._alive[: self._n])[0]
        self._rows = self._rows[live].copy()
        self._alive = np.ones(len(live), dtype=bool)
        self._list = self._list[live].copy()
        self._policy = self._policy[live].copy()
        self._ids = [self._ids[r] for r in live.tolist()]
        self._row_of = {eid: i for i, eid in enumerate(self._ids)}
        self._n = self._indexed = len(live)
        # Valores de los 16 slots de todas las filas a la vez: ver los 32 bytes como 16 uint16 big-endian
        slots = self._rows[: self._n].view(">u2").reshape(self._n, SLOTS).astype(np.int64)
        self._sorted_rows = np.empty((SLOTS, self._n), dtype=np.int32)
        self._offsets = np.zeros((SLOTS, (1 << SLOT_BITS) + 1), dtype=np.int64)
        for i in range(SLOTS):
            self._sorted_rows[i] = np.argsort(slots[:, i], kind="stable")
            counts = np.bincount(slots[:, i], minlength=1 << SLOT_BITS)
            np.cumsum(counts, out=self._offsets[i, 1:])  # CSR: filas con valor v = sorted[offsets[v]:offsets[v+1]]

    def candidates(self, h: np.ndarray) -> np.ndarray:
        """Filas vivas que comparten al menos un slot a distancia ≤ slot_radius, más todo el delta.

        Superconjunto de los matches: query() verifica cada candidato con la distancia completa.
        """
        static = np.zeros(0, dtype=np.int64)
        if self._indexed:
            vals = np.array(slot_values(h), dtype=np.int64)  # 16 valores
            want = vals[:, None] ^ self._flips[None, :]  # [16, 17]: cada valor y sus vecinos a 1 bit
            slot = np.repeat(np.arange(SLOTS), want.shape[1])
            a = self._offsets[slot, want.ravel()]  # inicio de cada rango en el arreglo ordenado del slot
            b = self._offsets[slot, want.ravel() + 1]
            lens = b - a
            total = int(lens.sum())
            if total:
                # Concatenar los 272 rangos sin un loop de Python: posición k-ésima de cada rango
                flat_start = a + slot * self._indexed  # posición en sorted_rows aplanado
                first = np.cumsum(lens) - lens  # dónde empieza cada rango en la salida
                pos = np.repeat(flat_start - first, lens) + np.arange(total)
                static = self._sorted_rows.ravel()[pos].astype(np.int64)
        delta = np.arange(self._indexed, self._n, dtype=np.int64)  # el delta, completo
        rows = np.unique(np.concatenate([static, delta]))  # una fila puede coincidir en varios slots
        return rows[self._alive[rows]]  # sin tombstones

    def query(self, hash_hex: str, quality: int | None = None) -> list[HashMatch]:
        """Matches a distancia ≤ threshold, ordenados por distancia. Vacío si la calidad es baja."""
        if quality is not None and quality < PDQ_MIN_QUALITY:
            return []  # el gateway lo registra como "no verificable por hash", no como "limpio"
        h = hex_to_hash(hash_hex)
        rows = self.candidates(h)
        if len(rows) == 0:
            return []
        dist = hamming_many(h, self._rows[rows])  # verificación exacta de todos los candidatos
        keep = dist <= self.threshold
        hits = [self._hit(int(r), int(d)) for r, d in zip(rows[keep], dist[keep])]
        return sorted(hits, key=lambda m: (m.distance, m.entry_id))

    def query_linear(self, hash_hex: str) -> list[HashMatch]:
        """Búsqueda lineal (todas las filas): la referencia contra la que se prueba `query`."""
        h = hex_to_hash(hash_hex)
        dist = hamming_many(h, self._rows[: self._n])
        ok = (dist <= self.threshold) & self._alive[: self._n]
        hits = [self._hit(r, int(dist[r])) for r in np.nonzero(ok)[0].tolist()]
        return sorted(hits, key=lambda m: (m.distance, m.entry_id))

    def _hit(self, row: int, distance: int) -> HashMatch:
        return HashMatch(self._ids[row], self._names[self._list[row]], self._names[self._policy[row]], distance)


# ---------------------------------------------------------------------------- texto
# Homoglifos frecuentes (cirílico/griego que se ven latinos). Lista CORTA e ilustrativa: la tabla
# completa es el archivo confusables.txt de Unicode (UTS #39); en producción se usa esa.
_HOMOGLYPHS = str.maketrans({
    "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "х": "x", "у": "y", "і": "i",  # cirílico
    "ο": "o", "α": "a", "ε": "e", "ι": "i", "κ": "k", "ν": "v", "τ": "t",  # griego
})
_ZERO_WIDTH = dict.fromkeys(map(ord, "​‌‍⁠﻿­"), None)  # ZWSP, ZWNJ, ZWJ, WJ, BOM, soft hyphen
_SPACES = re.compile(r"\s+")
# 4 o más caracteres sueltos separados por un espacio ("G a n a") → se pegan ("Gana"). Con 4 como
# mínimo, frases reales de palabras de una letra ("y a") no se tocan; el costo de un falso pegado es
# bajo: solo cambia el hash, que después tiene que coincidir EXACTO con un texto conocido.
_SPACED_LETTERS = re.compile(r"(?<!\w)(?:\w ){3,}\w(?!\w)")


def normalize_text(text: str) -> str:
    """Normalización ANTES de hashear: lo que un humano lee igual debe dar el mismo hash.

    'G a n a  dinero' y 'gana dinero' quedan iguales (letras sueltas separadas por espacios se pegan).
    'G-a-n-a dinero' o una paráfrasis NO: eso es trabajo del modelo de texto o de un near-duplicate de
    verdad (MinHash/SimHash), no de este hash.
    """
    t = unicodedata.normalize("NFKC", text)  # ｆｕｌｌｗｉｄｔｈ y ligaduras → su forma básica
    t = t.translate(_ZERO_WIDTH)  # caracteres invisibles insertados para romper hashes exactos
    t = t.casefold()  # casefold > lower: también unifica ß/ss y otros casos
    t = t.translate(_HOMOGLYPHS)
    t = _SPACES.sub(" ", t).strip()
    return _SPACED_LETTERS.sub(lambda m: m.group(0).replace(" ", ""), t)


def text_hash(text: str) -> str:
    """sha256 del texto normalizado (hex)."""
    return hashlib.sha256(normalize_text(text).encode("utf-8")).hexdigest()


class TextHashSet:
    """Textos conocidos (spam masivo, copypasta de una campaña) → política. Coincidencia exacta tras normalizar."""

    def __init__(self) -> None:
        self._by_hash: dict[str, tuple[str, str, str]] = {}  # hash → (entry_id, list_name, policy)

    def __len__(self) -> int:
        return len(self._by_hash)

    def add(self, entry_id: str, text: str, list_name: str, policy: str) -> None:
        self._by_hash[text_hash(text)] = (entry_id, list_name, policy)

    def add_hash(self, entry_id: str, sha256_hex: str, list_name: str, policy: str) -> None:
        """Cuando la lista ya viene hasheada (no guardamos el texto original de un spam en el gateway)."""
        self._by_hash[sha256_hex.lower()] = (entry_id, list_name, policy)

    def query(self, text: str) -> HashMatch | None:
        hit = self._by_hash.get(text_hash(text))
        return HashMatch(hit[0], hit[1], hit[2], 0) if hit else None


# ---------------------------------------------------------------------------- dominios
class DomainBlocklist:
    """Dominios bloqueados. 'bad.example' bloquea también 'x.bad.example', pero NO 'notbad.example'."""

    def __init__(self) -> None:
        self._domains: dict[str, tuple[str, str]] = {}  # dominio → (list_name, policy)

    def __len__(self) -> int:
        return len(self._domains)

    def add(self, domain: str, list_name: str, policy: str) -> None:
        self._domains[domain.lower().strip(".")] = (list_name, policy)

    def query(self, url: str) -> HashMatch | None:
        """Recorre el host de más específico a menos: a.b.bad.example → b.bad.example → bad.example → example."""
        host = (urlsplit(url if "//" in url else "//" + url).hostname or "").lower().strip(".")
        parts = host.split(".")
        for i in range(len(parts)):
            cand = ".".join(parts[i:])
            if cand in self._domains:
                list_name, policy = self._domains[cand]
                return HashMatch(cand, list_name, policy, 0)
        return None


# ---------------------------------------------------------------------------- benchmark local
if __name__ == "__main__":  # python match.py --bench [N]: compara MIH contra el escaneo lineal
    import sys
    import time

    if "--bench" not in sys.argv:
        sys.exit("uso: python match.py --bench [N]")
    n = int(sys.argv[-1]) if sys.argv[-1].isdigit() else 1_000_000
    rng = np.random.default_rng(0)
    data = rng.integers(0, 256, size=(n, PDQ_BYTES), dtype=np.uint8)  # hashes ALEATORIOS (mejor caso para MIH)
    idx = PdqIndex()
    t = time.perf_counter()
    idx.add_many((f"e{i}", hash_to_hex(data[i]), "own_removed", "spam_scams") for i in range(n))
    print(f"carga + compact: {n:,} hashes en {time.perf_counter() - t:.1f} s")
    t = time.perf_counter()
    idx.compact()
    print(f"compact solo: {time.perf_counter() - t:.2f} s")
    q = data[123].copy()
    q[0] ^= 0b1111  # 4 bits distintos
    q[5] ^= 0xFF  # 8 más → distancia 12
    qh = hash_to_hex(q)
    for name, fn in (("MIH", idx.query), ("lineal", idx.query_linear)):
        t = time.perf_counter()
        for _ in range(20):
            res = fn(qh)
        print(f"{name}: {(time.perf_counter() - t) / 20 * 1000:.2f} ms/consulta, hits={len(res)}")
    print(f"candidatos MIH: {len(idx.candidates(q)):,}")
    try:
        import resource  # solo Unix

        rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss  # bytes en macOS, KB en Linux
        print(f"RSS máximo del proceso: {rss / (1 << 20 if sys.platform == 'darwin' else 1 << 10):,.0f} MB")
    except ImportError:
        pass
