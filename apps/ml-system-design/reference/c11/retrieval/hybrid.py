"""Retrieval híbrido con permisos (caso c11): BM25 + vectores, filtro de ACL ANTES del top-k, RRF, reranker, top-8.

Camino de una pregunta (presupuesto del caso: retrieval + rerank p95 ≤ 700 ms; tiempos estimados, mídelos):
  principales de la persona (ingest/acl.py) → AclFilter
  ┌ BM25 (keyword: nombres de políticas, códigos, "PAG-1234")  top-50 YA FILTRADO por ACL    (timeout 300 ms)
  └ encode de la pregunta (GPU) → kNN (semántica)              top-50 YA FILTRADO por ACL    (timeout 300 ms)
  → RRF (k = 60, el mismo de #c07) → 50 candidatos → re-chequeo de ACL (defensa en profundidad)
  → cross-encoder sobre los 50 (GPU, timeout 400 ms; si falla, queda el orden de RRF)
  → máximo 3 chunks por documento → top-8 al prompt (answer/prompt_builder.py)

Por qué el filtro va ANTES del top-k y no después (la trampa del post-filtering, igual que en #c07):
  Si buscas los 50 más parecidos de los 12 M chunks y DESPUÉS sacas los que la persona no puede ver, una persona de
  soporte que pregunta por "bonos" recibe 50 chunks de Finanzas y RH, los filtra y se queda con 0 o 2. Peor que
  pocos resultados: lo que queda depende de cuántos documentos ajenos hay, no de la relevancia. Con el filtro
  DENTRO de la búsqueda, los 50 son los 50 mejores ENTRE LO QUE PUEDE VER. Los tests lo muestran con números.
  Y la forma más grave del error, filtrar después de GENERAR, no existe aquí: el texto prohibido jamás llega al LLM.

En OpenSearch (el índice real del caso):
  - BM25: `bool` con `must: match` y `filter: <filtro de ACL>`; el filtro no cambia el score, solo excluye.
  - kNN: el filtro va DENTRO de la cláusula knn ("efficient filtering": motor faiss con HNSW desde 2.9, lucene
    desde 2.4; el mapping de opensearch_index.json usa faiss con vectores en FP16). El motor decide entre búsqueda
    exacta sobre los filtrados y ANN con el filtro aplicado durante la búsqueda, según cuántos documentos pasan.
    Un `post_filter` o un filtro booleano FUERA de la cláusula knn es post-filtering: justo el error de arriba.
  - Alternativa: una sola consulta `hybrid` con `filter` de nivel superior (3.0+, lo aplica a cada subconsulta) y
    un search pipeline con `score-ranker-processor` (RRF, 2.19+, rank_constant 60 por defecto). Ver
    opensearch_hybrid_body(). Aquí la fusión se hace en el servicio, como en #c07: cada lista tiene su timeout y
    su fallback (solo BM25 si el kNN no contesta) y el log guarda en qué posición venía cada chunk en cada lista.

Interfaces (Protocol, async) para lo externo: KeywordSearch y VectorSearch (OpenSearch), QueryEncoder (modelo de
embeddings en GPU), Reranker (cross-encoder en GPU). InMemoryIndex implementa las dos búsquedas (y la escritura
que usa ingest/incremental.py) con la MISMA regla de ACL que el filtro de OpenSearch (acl.fields_allow); los
fakes de encoder y reranker están en fakes.py. Los adaptadores reales a OpenSearch no están: no se pudieron
probar sin un cluster (ver README).
"""

from __future__ import annotations  # anotaciones como texto

import asyncio  # las dos listas en paralelo, cada una con su timeout
import heapq  # top-k sin ordenar todo
import math  # idf de BM25
import re  # tokenización simple de BM25
import time  # perf_counter para el desglose de latencia
import unicodedata  # quitar acentos: "política" y "politica" son la misma palabra para BM25
from collections import Counter, defaultdict  # frecuencias de términos y postings
from collections.abc import Mapping, Sequence  # tipos
from dataclasses import dataclass, field  # registros y resultados
from typing import Protocol  # interfaces sin herencia

import numpy as np  # coseno en memoria (el índice en memoria; en producción lo hace OpenSearch)

from acl import MAX_CLAUSES, fields_allow, opensearch_filter  # la regla de permisos: una sola fuente

DEFAULT_RRF_K = 60  # el k del paper de RRF (Cormack et al., SIGIR 2009) y de #c07


# ---------------------------------------------------------------------------- lo que vive en el índice
@dataclass(frozen=True)
class ChunkRecord:
    """Un chunk indexado: el texto, sus metadatos para citar y su ACL en campos acl_0..acl_2."""

    chunk_id: str
    doc_id: str
    source: str  # confluence | drive | jira | policies
    title: str
    url: str  # enlace a la fuente (y a la sección si la fuente lo permite): lo que abre la cita
    updated_at: str  # ISO 8601 de la última edición en la fuente: el prompt la muestra para resolver conflictos
    heading_path: tuple[str, ...]
    text: str
    acl_fields: Mapping[str, tuple[str, ...]]
    vector: tuple[float, ...] = ()  # L2-normalizado; vacío solo en tests que no usan kNN
    embed_model: str = ""  # versión del modelo que calculó el vector: un índice = un modelo (blue/green)


@dataclass(frozen=True)
class AclFilter:
    """Los principales de quien pregunta. Se pasa a CADA búsqueda; nunca se aplica después del top-k.

    excluded_sources: fuentes cuyos permisos están desactualizados (su poller de cambios de permisos no tiene un
    éxito en más de 5 min): salen del retrieval hasta que se pongan al día. Falla cerrado POR FUENTE: si Drive
    se atrasa, Confluence y Jira siguen contestando.
    """

    principals: frozenset[str]
    max_clauses: int = MAX_CLAUSES
    excluded_sources: frozenset[str] = frozenset()

    def matches(self, record: ChunkRecord) -> bool:
        return (record.source not in self.excluded_sources
                and fields_allow(record.acl_fields, self.principals, self.max_clauses))

    def to_opensearch(self) -> dict:
        f = opensearch_filter(self.principals, self.max_clauses)
        if self.excluded_sources and "bool" in f:
            f["bool"]["must_not"] = [{"terms": {"source": sorted(self.excluded_sources)}}]
        return f


@dataclass(frozen=True)
class Hit:
    record: ChunkRecord
    score: float


class KeywordSearch(Protocol):
    async def search(self, query: str, k: int, acl: AclFilter) -> list[Hit]: ...


class VectorSearch(Protocol):
    async def knn(self, vector: np.ndarray, k: int, acl: AclFilter) -> list[Hit]: ...


class QueryEncoder(Protocol):
    model_version: str

    async def encode(self, text: str) -> np.ndarray: ...


class Reranker(Protocol):
    async def rerank(self, query: str, texts: Sequence[str]) -> list[float]: ...


# ---------------------------------------------------------------------------- índice en memoria (tests y demo)
_WORD_RE = re.compile(r"\w+", re.UNICODE)


def analyze(text: str) -> list[str]:
    """Analizador de BM25: minúsculas + sin acentos + palabras. En OpenSearch: un analyzer con lowercase y
    asciifolding (y, si lo justifica la evaluación, stemming de español); sin stopwords a propósito: "no" importa."""
    folded = unicodedata.normalize("NFKD", text.lower())
    folded = "".join(ch for ch in folded if not unicodedata.combining(ch))
    return _WORD_RE.findall(folded)


class InMemoryIndex:
    """BM25 + kNN exacto sobre los mismos registros, con el filtro de ACL aplicado ANTES de elegir el top-k.

    También implementa la escritura que usa la ingesta (upsert / update_fields / delete). No es para producción:
    el kNN es fuerza bruta (exacto) y BM25 recalcula estadísticas en cada escritura.
    """

    def __init__(self, k1: float = 1.2, b: float = 0.75):
        self.k1, self.b = k1, b  # los defaults de BM25 en Lucene/OpenSearch
        self.records: dict[str, ChunkRecord] = {}
        self._dirty = True
        self.fail_keyword = self.fail_vector = False  # para simular fallas en tests
        self.delay_keyword_s = self.delay_vector_s = 0.0  # para simular lentitud en tests

    # -- escritura (ingest/incremental.py)
    def upsert(self, records: Sequence[ChunkRecord]) -> None:
        for r in records:
            self.records[r.chunk_id] = r
        self._dirty = True

    def update_fields(self, chunk_ids: Sequence[str], **changes) -> None:
        # En OpenSearch: _update (o _update_by_query por doc_id) de campos sueltos. Sin re-embeber: el vector queda.
        for cid in chunk_ids:
            r = self.records.get(cid)
            if r is not None:
                self.records[cid] = ChunkRecord(**{**r.__dict__, **changes})
        self._dirty = True

    def delete(self, chunk_ids: Sequence[str]) -> None:
        for cid in chunk_ids:
            self.records.pop(cid, None)
        self._dirty = True

    def count_documents(self) -> int:
        return len({r.doc_id for r in self.records.values()})

    # -- estadísticas (perezosas)
    def _rebuild(self) -> None:
        if not self._dirty:
            return
        self._ids = list(self.records)
        self._tf = [Counter(analyze(self.records[i].text)) for i in self._ids]
        self._len = np.array([sum(tf.values()) for tf in self._tf], dtype=float)
        self._avglen = float(self._len.mean()) if len(self._len) else 0.0
        self._df: Counter = Counter()
        self._postings: dict[str, list[int]] = defaultdict(list)
        for row, tf in enumerate(self._tf):
            for term in tf:
                self._df[term] += 1
                self._postings[term].append(row)
        vecs = [self.records[i].vector for i in self._ids]
        dim = max((len(v) for v in vecs), default=0)
        self._mat = np.array([v if len(v) == dim else [0.0] * dim for v in vecs], dtype=np.float32)
        self._dirty = False

    # -- búsquedas
    async def search(self, query: str, k: int, acl: AclFilter) -> list[Hit]:
        if self.delay_keyword_s:
            await asyncio.sleep(self.delay_keyword_s)
        if self.fail_keyword:
            raise ConnectionError("BM25 no disponible (simulado)")
        return self._bm25(query, k, acl, prefilter=True)

    def _bm25(self, query: str, k: int, acl: AclFilter | None, prefilter: bool) -> list[Hit]:
        self._rebuild()
        n = len(self._ids)
        scores: dict[int, float] = defaultdict(float)
        allowed_cache: dict[int, bool] = {}
        for term in set(analyze(query)):
            df = self._df.get(term, 0)
            if not df:
                continue
            idf = math.log(1 + (n - df + 0.5) / (df + 0.5))  # la idf de Lucene: nunca negativa
            for row in self._postings[term]:
                if prefilter and acl is not None:
                    ok = allowed_cache.get(row)
                    if ok is None:
                        ok = allowed_cache[row] = acl.matches(self.records[self._ids[row]])
                    if not ok:
                        continue  # PRE-filtro: lo que no puede ver ni siquiera compite por el top-k
                tf = self._tf[row][term]
                norm = self.k1 * (1 - self.b + self.b * self._len[row] / self._avglen)
                scores[row] += idf * tf * (self.k1 + 1) / (tf + norm)
        best = heapq.nlargest(k, scores.items(), key=lambda kv: (kv[1], -kv[0]))
        return [Hit(self.records[self._ids[row]], float(s)) for row, s in best]

    async def knn(self, vector: np.ndarray, k: int, acl: AclFilter) -> list[Hit]:
        if self.delay_vector_s:
            await asyncio.sleep(self.delay_vector_s)
        if self.fail_vector:
            raise ConnectionError("kNN no disponible (simulado)")
        return self._knn(vector, k, acl, prefilter=True)

    def _knn(self, vector: np.ndarray, k: int, acl: AclFilter | None, prefilter: bool) -> list[Hit]:
        self._rebuild()
        if not self._ids:
            return []
        rows = np.arange(len(self._ids))
        if prefilter and acl is not None:
            mask = np.array([acl.matches(self.records[i]) for i in self._ids], dtype=bool)
            rows = rows[mask]  # PRE-filtro: el coseno solo se calcula sobre lo permitido
        if rows.size == 0:
            return []
        sims = self._mat[rows] @ np.asarray(vector, dtype=np.float32)  # coseno: los vectores ya están normalizados
        top = min(k, rows.size)
        part = np.argpartition(-sims, top - 1)[:top]
        order = part[np.lexsort((rows[part], -sims[part]))]  # score ↓ y, en empate, fila ↑ (determinista)
        return [Hit(self.records[self._ids[rows[i]]], float(sims[i])) for i in order]


def post_filtered(hits: Sequence[Hit], acl: AclFilter) -> list[Hit]:
    """El ANTI-patrón, para mostrarlo en tests: top-k sin filtro y después sacar lo prohibido."""
    return [h for h in hits if acl.matches(h.record)]


# ---------------------------------------------------------------------------- fusión
@dataclass(frozen=True)
class Fused:
    record: ChunkRecord
    rrf: float
    ranks: dict[str, int]  # lista → posición (1-based): para el log y para depurar "¿por qué salió esto?"


def rrf(lists: Mapping[str, Sequence[Hit]], k: int = DEFAULT_RRF_K) -> list[Fused]:
    """Reciprocal Rank Fusion: score(d) = Σ 1 / (k + rank). Solo posiciones: BM25 (0 a ~30) y coseno (−1 a 1) no
    están en la misma escala y no hay que calibrarlos. Misma definición y desempates que #c07 (search/fusion.py)."""
    if k <= 0:
        raise ValueError("k debe ser > 0")
    scores: dict[str, float] = defaultdict(float)
    ranks: dict[str, dict[str, int]] = defaultdict(dict)
    records: dict[str, ChunkRecord] = {}
    for name, hits in lists.items():
        rank = 0
        for h in hits:
            cid = h.record.chunk_id
            if name in ranks[cid]:
                continue  # duplicado dentro de la misma lista: cuenta una vez, con su mejor posición
            rank += 1
            scores[cid] += 1.0 / (k + rank)
            ranks[cid][name] = rank
            records[cid] = h.record
    fused = [Fused(records[c], s, dict(ranks[c])) for c, s in scores.items()]
    fused.sort(key=lambda f: (-f.rrf, min(f.ranks.values()), -len(f.ranks), f.record.chunk_id))
    return fused


# ---------------------------------------------------------------------------- el retriever
@dataclass(frozen=True)
class RetrievalConfig:
    candidates: int = 50  # por lista y después de fusionar: lo que ve el reranker (el caso: top-50)
    top_k: int = 8  # lo que entra al prompt (el caso: 8 chunks × ≈ 400 tokens)
    rrf_k: int = DEFAULT_RRF_K
    max_per_doc: int = 3  # un documento largo no se queda con los 8 lugares: diversidad de fuentes para citar
    min_rerank_score: float | None = None  # umbral de "esto no contesta": se CALIBRA con el golden set (por modelo)
    # Versión del modelo de embeddings del índice que sirve el alias (en producción se lee del alias, con caché de
    # segundos, como en #c07). Si el encoder de consultas tiene otra, sus vectores no se comparan con los del índice:
    # el kNN no se usa y se sigue con BM25 (degradado "encoder_version_mismatch"). None = no se chequea (tests).
    index_model_version: str | None = None
    keyword_timeout_s: float = 0.3  # techos, no tiempos esperados: ≈ 3× lo estimado de cada etapa
    vector_timeout_s: float = 0.3  # incluye el encode de la pregunta
    rerank_timeout_s: float = 0.4  # 50 pares (pregunta, chunk de 400 tokens) en el cross-encoder


@dataclass(frozen=True)
class Retrieved:
    record: ChunkRecord
    rrf: float
    rerank: float | None
    ranks: dict[str, int]


@dataclass
class RetrievalResult:
    chunks: list[Retrieved]
    # bm25_only, vector_only, encoder_version_mismatch, rerank_skipped
    degraded: list[str] = field(default_factory=list)
    empty_reason: str | None = None  # no_candidates | below_threshold (alimenta EmptyRetrievalRateHigh)
    acl_violations: int = 0  # candidatos que el re-chequeo sacó: DEBE ser 0; si no, el índice filtra mal
    timings_ms: dict[str, float] = field(default_factory=dict)


class EncoderVersionMismatch(RuntimeError):
    """El encoder de consultas y el índice usan modelos distintos: el coseno entre esos vectores no significa nada."""


class RetrievalUnavailable(RuntimeError):
    """Las dos listas fallaron: no hay evidencia y no se genera nada (el servicio contesta 503)."""


class HybridRetriever:
    def __init__(self, keyword: KeywordSearch, vector: VectorSearch, encoder: QueryEncoder,
                 reranker: Reranker | None = None, config: RetrievalConfig | None = None):
        self.keyword, self.vector, self.encoder, self.reranker = keyword, vector, encoder, reranker
        self.cfg = config or RetrievalConfig()

    async def _vector_list(self, query: str, acl: AclFilter) -> list[Hit]:
        expected = self.cfg.index_model_version
        if expected is not None and self.encoder.model_version != expected:
            raise EncoderVersionMismatch(f"encoder {self.encoder.model_version} ≠ índice {expected}")
        vec = await self.encoder.encode(query)
        return await self.vector.knn(vec, self.cfg.candidates, acl)

    async def retrieve(self, query: str, acl: AclFilter) -> RetrievalResult:
        t0 = time.perf_counter()
        timings: dict[str, float] = {}
        if not acl.principals:
            # Persona sin principales: ni se consulta el índice (y el servicio ya contestó 403 antes)
            return RetrievalResult([], empty_reason="no_candidates")

        async def timed(name: str, coro, timeout: float):
            t = time.perf_counter()
            try:
                return await asyncio.wait_for(coro, timeout)
            finally:
                timings[name] = round((time.perf_counter() - t) * 1000, 2)

        kw, vec = await asyncio.gather(
            timed("bm25", self.keyword.search(query, self.cfg.candidates, acl), self.cfg.keyword_timeout_s),
            timed("vector", self._vector_list(query, acl), self.cfg.vector_timeout_s),
            return_exceptions=True,
        )
        degraded: list[str] = []
        lists: dict[str, list[Hit]] = {}
        if isinstance(kw, BaseException):
            if isinstance(kw, asyncio.CancelledError):
                raise kw
            degraded.append("vector_only")
        else:
            lists["bm25"] = kw
        if isinstance(vec, BaseException):
            if isinstance(vec, asyncio.CancelledError):
                raise vec
            degraded.append("encoder_version_mismatch" if isinstance(vec, EncoderVersionMismatch) else "bm25_only")
        else:
            lists["vector"] = vec
        if not lists:
            raise RetrievalUnavailable("BM25 y kNN fallaron")

        fused = rrf(lists, self.cfg.rrf_k)[: self.cfg.candidates]
        # Defensa en profundidad: la misma regla, otra vez, en el servicio. Si algo se cuela es un bug del índice
        # (un mapping sin los campos acl_i, un filtro mal armado): se saca, se cuenta y se loguea fuerte.
        allowed = [f for f in fused if acl.matches(f.record)]
        violations = len(fused) - len(allowed)
        if not allowed:
            return RetrievalResult([], degraded, "no_candidates", violations, timings)

        scores: list[float] | None = None
        if self.reranker is not None:
            t = time.perf_counter()
            try:
                scores = await asyncio.wait_for(
                    self.reranker.rerank(query, [f.record.text for f in allowed]), self.cfg.rerank_timeout_s)
                if len(scores) != len(allowed):
                    raise ValueError("el reranker devolvió otra cantidad de scores")
            except (TimeoutError, ConnectionError, ValueError):
                scores = None
                degraded.append("rerank_skipped")  # queda el orden de RRF: peor, pero contesta
            finally:
                timings["rerank"] = round((time.perf_counter() - t) * 1000, 2)

        if scores is not None:
            order = sorted(range(len(allowed)), key=lambda i: (-scores[i], i))
            if self.cfg.min_rerank_score is not None:
                order = [i for i in order if scores[i] >= self.cfg.min_rerank_score]
                if not order:
                    return RetrievalResult([], degraded, "below_threshold", violations, timings)
        else:
            order = list(range(len(allowed)))

        picked: list[Retrieved] = []
        per_doc: Counter = Counter()
        for i in order:
            f = allowed[i]
            if per_doc[f.record.doc_id] >= self.cfg.max_per_doc:
                continue
            per_doc[f.record.doc_id] += 1
            picked.append(Retrieved(f.record, f.rrf, scores[i] if scores is not None else None, f.ranks))
            if len(picked) == self.cfg.top_k:
                break
        timings["total"] = round((time.perf_counter() - t0) * 1000, 2)
        return RetrievalResult(picked, degraded, None, violations, timings)


# ---------------------------------------------------------------------------- la misma consulta, en OpenSearch
def opensearch_hybrid_body(query: str, vector: Sequence[float], acl: AclFilter, k: int = 50) -> dict:
    """Cuerpo de una consulta `hybrid` con el filtro de ACL de nivel superior (OpenSearch 3.0+).

    Se manda a /<índice>/_search?search_pipeline=<pipeline con score-ranker-processor (rrf)>. Ojo con dos cosas
    de la documentación: cada subconsulta aporta sus resultados POR SHARD antes de fusionar, y la profundidad de
    la fusión la fija `pagination_depth` (si no, `size`). No se ejecutó contra un cluster: es la forma, para leer.
    """
    return {
        "size": k,
        "_source": {"excludes": ["embedding"]},  # el vector (1024 floats) no viaja de vuelta
        "query": {
            "hybrid": {
                "filter": acl.to_opensearch(),  # aplicado DENTRO de cada subconsulta: pre-filtering
                "pagination_depth": k,
                "queries": [
                    {"match": {"text": {"query": query}}},
                    {"knn": {"embedding": {"vector": list(vector), "k": k}}},
                ],
            }
        },
    }
