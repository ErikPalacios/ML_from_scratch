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
escaneo lineal ≈ 35 ms (no cabe con 10 imágenes en 120 ms); carga + compactación ≈ 3 s; compactación
sola ≈ 2 s; pico de memoria del proceso ≈ 600 MB (incluye los datos de prueba). Memoria del índice por
hash: 32 B del hash + 64 B de los 16 arreglos de filas + el id (string de Python) y su entrada en el
dict, ≈ 120 B más (medido con ids de 13 caracteres). Esta versión es para enseñar y para listas de
hasta unos pocos millones; con decenas de millones usarías la implementación C++ de Meta
(pdq/cpp/index) o un índice binario de faiss, con ids enteros en un arreglo, y lo medirías igual.
"""

from __future__ import annotations  # anotaciones como texto: sintaxis moderna sin costo en runtime

import hashlib  # sha256 del texto normalizado
import re  # colapsar espacios
import unicodedata  # NFKC: unifica formas Unicode "equivalentes" (ｆｕｌｌｗｉｄｔｈ → fullwidth)
from dataclasses import dataclass, field  # resultados inmutables y legibles
from urllib.parse import urlsplit  # extraer el host de una URL sin regex frágiles

import numpy as np  # XOR + popcount vectorizados: verificar miles de candidatos en microsegundos

# ---------------------------------------------------------------------------- constantes PDQ
PDQ_BITS = 256  # PDQ produce 256 bits (64 caracteres hex)
# 32 bytes por hash. Con 10 M hashes: ≈ 320 MB de hashes, ≈ 640 MB del CSR (16 slots × 4 B), más los ids
# como str de Python con su dict (≈ 1–1.5 GB; en producción, ids enteros en un arreglo)
PDQ_BYTES = PDQ_BITS // 8
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


@dataclass
class CompactionJob:
    """Foto de las filas al EMPEZAR una compactación (ver PdqIndex). La construcción corre en otro hilo."""

    n: int  # filas [0, n) entran a la reconstrucción; las que lleguen después quedan en el delta
    alive: np.ndarray  # COPIA de los tombstones a ese momento (los remove() posteriores van a `removed`)
    rows: np.ndarray  # referencias a los arreglos de ese momento: add() solo escribe filas >= n, y si
    lists: np.ndarray  # tiene que crecer crea arreglos NUEVOS, así que [0, n) no cambia bajo el hilo
    policies: np.ndarray
    ids: list[str]
    headroom: int  # capacidad libre que se reserva para el delta siguiente (crecer = copiar todo)
    removed: list[str] = field(default_factory=list)  # entry_ids quitados mientras se construía


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
    - add() agrega la fila al DELTA (filas nuevas aún sin indexar), que se escanea linealmente. add()
      NUNCA compacta: es O(1) y se puede llamar desde el event loop del gateway;
    - remove() marca la fila como muerta (tombstone): deja de coincidir al instante;
    - la compactación reconstruye el índice estático con todo lo vivo. Es la idea de un LSM: escribir
      barato, ordenar en lote.
    La compactación cuesta ≈ 2 s por millón de hashes (medido): en el event loop del gateway serían
    segundos sin atender NINGÚN request. Por eso tiene tres pasos, y solo el del medio es caro:
      1. begin_compaction()       (en el loop, ≈ ms) foto de las filas y copia de los tombstones
      2. build_compacted(job)     (en OTRO hilo: asyncio.to_thread) arma los arreglos nuevos
      3. finish_compaction(...)   (en el loop, O(lo que llegó mientras tanto)) aplica las bajas y las
                                  altas que llegaron durante el paso 2 y cambia los arreglos de una vez
    Medido con 1 M hashes: pasos 1 + 3 ≈ 5 ms en el loop, casi todo liberar el dict y la lista de ids
    viejos (con 10 M, ≈ 50 ms: otra razón para usar ids enteros en un arreglo, que se liberan de una vez).
    `compact()` hace los tres seguidos (carga inicial, tests). Ojo: el hilo comparte el GIL; numpy lo
    suelta en las operaciones grandes, pero la parte en Python (la lista y el dict de ids) lo alterna con
    el loop. Con decenas de millones, el índice va en C++ o en un proceso aparte.
    Memoria del índice estático: por slot, un arreglo int32 de filas ordenadas por valor (4 B × N) y
    un arreglo de offsets de 65,537 posiciones. 16 slots → 64 B por hash, más 32 B del hash y el id.
    Durante la compactación conviven los arreglos viejos y los nuevos: el pico es ≈ 2× el índice.
    """

    def __init__(self, threshold: int = PDQ_MATCH_THRESHOLD, delta_max: int = 5_000):
        if not 0 <= threshold < PDQ_BITS:
            raise ValueError("umbral fuera de rango")
        self.threshold = threshold
        # Radio por slot: pigeonhole (ver docstring del módulo). Con 31 → 1; con 15 → 0.
        self.slot_radius = threshold // SLOTS
        # Tamaño del delta a partir del cual conviene compactar (needs_compaction). El delta se escanea
        # COMPLETO en cada consulta: medido, 5k filas ≈ 0.7 ms y 20k ≈ 2 ms por imagen (una Mac M-series).
        # También es la capacidad libre que deja cada compactación, para no crecer (copiar) en caliente.
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
        self._job: CompactionJob | None = None  # compactación en curso (como mucho una)

    def __len__(self) -> int:
        return len(self._row_of)  # entradas vivas

    def delta_size(self) -> int:
        """Filas que todavía no están en el índice estático (se escanean en cada consulta)."""
        return self._n - self._indexed

    def needs_compaction(self) -> bool:
        return self._job is None and self.delta_size() >= self.delta_max

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
        self._append(hex_to_hash(hash_hex), self._intern(list_name), self._intern(policy), entry_id)
        return True  # sin compactar aquí: eso lo decide quien llama (needs_compaction)

    def _append(self, h: np.ndarray, list_code: int, policy_code: int, entry_id: str) -> None:
        self._grow(self._n + 1)
        row = self._n
        self._rows[row] = h
        self._alive[row] = True
        self._list[row] = list_code
        self._policy[row] = policy_code
        self._ids.append(entry_id)
        self._row_of[entry_id] = row
        self._n += 1

    def add_many(self, entries) -> int:
        """Carga masiva (snapshot al arrancar): agrega todo y compacta UNA vez. Devuelve cuántas entraron."""
        added = sum(self.add(*e) for e in entries)
        self.compact()
        return added

    def remove(self, entry_id: str) -> bool:
        """Quita una entrada (p. ej. una apelación ganada: ese contenido NO era violatorio)."""
        row = self._row_of.pop(entry_id, None)
        if row is None:
            return False
        self._alive[row] = False  # deja de coincidir ya; el espacio se recupera al compactar
        if self._job is not None:
            self._job.removed.append(entry_id)  # la compactación en curso la vio viva: se aplica al terminar
        return True

    # ------------------------------------------------------------------ compactación en tres pasos
    def compact(self) -> None:
        """Los tres pasos seguidos, en el hilo actual (≈ 2 s por millón, medido). Carga inicial y tests."""
        job = self.begin_compaction()
        self.finish_compaction(job, self.build_compacted(job))

    def begin_compaction(self) -> CompactionJob:
        """Paso 1 (barato): foto de las filas [0, n) y copia de los tombstones."""
        if self._job is not None:
            raise RuntimeError("ya hay una compactación en curso")
        n = self._n
        self._job = CompactionJob(
            n=n, alive=self._alive[:n].copy(), rows=self._rows, lists=self._list,
            policies=self._policy, ids=self._ids, headroom=max(1024, 2 * self.delta_max),
        )
        return self._job

    @staticmethod
    def build_compacted(job: CompactionJob) -> dict:
        """Paso 2 (caro, sin tocar el índice vivo): arreglos nuevos con las filas vivas de la foto."""
        live = np.nonzero(job.alive)[0]
        k = len(live)
        cap = k + job.headroom  # capacidad libre: las altas siguientes no obligan a copiar todo
        rows = np.zeros((cap, PDQ_BYTES), dtype=np.uint8)
        rows[:k] = job.rows[live]
        alive = np.zeros(cap, dtype=bool)
        alive[:k] = True
        lists = np.zeros(cap, dtype=np.uint8)
        lists[:k] = job.lists[live]
        policies = np.zeros(cap, dtype=np.uint8)
        policies[:k] = job.policies[live]
        ids = [job.ids[r] for r in live.tolist()]
        # Valores de los 16 slots de todas las filas a la vez: ver los 32 bytes como 16 uint16 big-endian
        slots = rows[:k].view(">u2").reshape(k, SLOTS).astype(np.int64)
        sorted_rows = np.empty((SLOTS, k), dtype=np.int32)
        offsets = np.zeros((SLOTS, (1 << SLOT_BITS) + 1), dtype=np.int64)
        for i in range(SLOTS):
            sorted_rows[i] = np.argsort(slots[:, i], kind="stable")
            counts = np.bincount(slots[:, i], minlength=1 << SLOT_BITS)
            np.cumsum(counts, out=offsets[i, 1:])  # CSR: filas con valor v = sorted[offsets[v]:offsets[v+1]]
        return {"n": k, "rows": rows, "alive": alive, "lists": lists, "policies": policies, "ids": ids,
                "row_of": {eid: i for i, eid in enumerate(ids)}, "sorted_rows": sorted_rows, "offsets": offsets}

    def finish_compaction(self, job: CompactionJob, built: dict) -> None:
        """Paso 3 (barato): cambia los arreglos y re-aplica lo que llegó durante el paso 2."""
        if self._job is not job:
            raise RuntimeError("esta compactación no es la que está en curso")
        # 1) bajas durante la construcción: la foto las vio vivas → tombstone en los arreglos nuevos
        for eid in job.removed:
            r = built["row_of"].pop(eid, None)
            if r is not None:
                built["alive"][r] = False
        # 2) altas durante la construcción: filas [job.n, n) de los arreglos viejos → delta de los nuevos
        old = (self._rows, self._alive, self._list, self._policy, self._ids, self._n)
        self._rows, self._alive = built["rows"], built["alive"]
        self._list, self._policy = built["lists"], built["policies"]
        self._ids, self._row_of = built["ids"], built["row_of"]
        self._n = self._indexed = built["n"]
        self._sorted_rows, self._offsets = built["sorted_rows"], built["offsets"]
        o_rows, o_alive, o_list, o_policy, o_ids, o_n = old
        for r in range(job.n, o_n):
            if o_alive[r]:
                self._append(o_rows[r], int(o_list[r]), int(o_policy[r]), o_ids[r])
        self._job = None

    def abort_compaction(self) -> None:
        """Si el paso 2 falló: se descarta la foto y el índice actual sigue sirviendo tal cual."""
        self._job = None

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
        self._hash_of: dict[str, str] = {}  # entry_id → hash: para poder quitar una entrada por su id

    def __len__(self) -> int:
        return len(self._by_hash)

    def add(self, entry_id: str, text: str, list_name: str, policy: str) -> None:
        self.add_hash(entry_id, text_hash(text), list_name, policy)

    def add_hash(self, entry_id: str, sha256_hex: str, list_name: str, policy: str) -> None:
        """Cuando la lista ya viene hasheada (no guardamos el texto original de un spam en el gateway)."""
        h = sha256_hex.lower()
        self._by_hash[h] = (entry_id, list_name, policy)
        self._hash_of[entry_id] = h

    def remove(self, entry_id: str) -> bool:
        """Quita una entrada (apelación ganada, entrada errónea). False si el id no existe."""
        h = self._hash_of.pop(entry_id, None)
        if h is None or self._by_hash.get(h, ("",))[0] != entry_id:
            return False
        del self._by_hash[h]
        return True

    def query(self, text: str) -> HashMatch | None:
        hit = self._by_hash.get(text_hash(text))
        return HashMatch(hit[0], hit[1], hit[2], 0) if hit else None


# ---------------------------------------------------------------------------- dominios
class DomainBlocklist:
    """Dominios bloqueados. 'bad.example' bloquea también 'x.bad.example', pero NO 'notbad.example'."""

    def __init__(self) -> None:
        self._domains: dict[str, tuple[str, str, str]] = {}  # dominio → (entry_id, list_name, policy)
        self._domain_of: dict[str, str] = {}  # entry_id → dominio

    def __len__(self) -> int:
        return len(self._domains)

    def add(self, domain: str, list_name: str, policy: str, entry_id: str | None = None) -> None:
        """`entry_id` por defecto es el propio dominio (así una baja puede nombrarlo directamente)."""
        d = domain.lower().strip(".")
        eid = entry_id or d
        self._domains[d] = (eid, list_name, policy)
        self._domain_of[eid] = d

    def remove(self, entry_id: str) -> bool:
        d = self._domain_of.pop(entry_id, None)
        if d is None or self._domains.get(d, ("",))[0] != entry_id:
            return False
        del self._domains[d]
        return True

    def query(self, url: str) -> HashMatch | None:
        """Recorre el host de más específico a menos: a.b.bad.example → b.bad.example → bad.example → example."""
        host = (urlsplit(url if "//" in url else "//" + url).hostname or "").lower().strip(".")
        parts = host.split(".")
        for i in range(len(parts)):
            cand = ".".join(parts[i:])
            if cand in self._domains:
                entry_id, list_name, policy = self._domains[cand]
                return HashMatch(entry_id, list_name, policy, 0)
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
    print(f"compact solo: {time.perf_counter() - t:.2f} s (en el gateway corre en otro hilo)")
    t = time.perf_counter()
    job = idx.begin_compaction()
    t_begin = time.perf_counter() - t
    built = PdqIndex.build_compacted(job)
    t = time.perf_counter()
    idx.finish_compaction(job, built)
    print(f"pasos 1 y 3 (los que corren en el event loop): {(t_begin + time.perf_counter() - t) * 1000:.1f} ms")
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
