"""search-api (caso c07): búsqueda híbrida del marketplace por texto o por foto.

POST /v1/search
  texto: Content-Type: application/json   body {"q": "chamarra de mezclilla vintage talla M"}
  foto:  Content-Type: image/jpeg|png|webp  body = los bytes de la foto ("algo como esto")
  filtros y página, IGUALES en los dos modos, en la query string:
         ?category_id=812&price_max=900&city=GDL&condition=good&ships_nationwide=true&page=0
  Por qué bytes crudos y no base64 en JSON: base64 agrega 33 % y otro paso de decodificación.

Camino de una consulta de texto (SLO p99 ≤ 300 ms server-side; presupuesto del caso, estimado):
  ┌ BM25 (OpenSearch, filtros nativos) ............................. ≈ 40 ms  (timeout 120 ms)
  └ encode texto (GPU ≈ 10 ms) → ANN en 4 shards EN PARALELO (≈ 20 ms c/u) (timeouts 50 + 80 ms)
  → RRF (k = 60) → filtros (defensa) → tombstones (≤ 20 ms) → rerank top-30 (≈ 60 ms, timeout 100 ms)
Foto (SLO p99 ≤ 600 ms): decode + encode imagen (timeout 300 ms) → ANN; sin BM25 ni rerank de texto.

Fallbacks (cada uno se cuenta en search_degraded_total{reason} y va en la respuesta, en `degraded`):
  ANN vence o falla (encoder o todos los shards) → solo BM25        (texto)  · foto → 503
  algunos shards vencen                          → resultados parciales (ann_partial)
  BM25 falla                                     → solo ANN
  los dos fallan                                 → 503 con Retry-After (la app muestra "intenta de nuevo")
  tombstones no responden                        → se sirve igual y se cuenta (SoldItemsServed lo ve)
  reranker vence                                 → se queda el orden de RRF

Interfaces (Protocol) para todo lo externo: QueryEncoder (GPU), AnnShard (los 4 shards), KeywordIndex
(OpenSearch), TombstoneStore (Redis-class), Reranker (cross-encoder en GPU). Los tests usan fakes
(search/fakes.py); los adaptadores reales no están aquí porque no se pudieron probar (ver README).

Endpoints: POST /v1/search · GET /healthz · GET /readyz · GET /metrics
"""

from __future__ import annotations  # anotaciones como texto

import asyncio  # gather + wait_for: fuentes en paralelo, cada una con su timeout
import json  # una línea JSON por búsqueda (log)
import logging  # a stdout
import os  # configuración por variables de entorno
import sys  # stdout explícito para el logger
import time  # perf_counter para el desglose de latencia
import uuid  # request_id si el caller no manda uno
from collections.abc import Awaitable, Sequence  # tipos
from dataclasses import dataclass, field  # Settings, Deps, Hit
from typing import Annotated, Literal, Protocol  # interfaces sin herencia

from fastapi import FastAPI, Query, Request, Response  # framework ASGI
from fastapi.responses import JSONResponse  # errores con headers (Retry-After)
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest  # /metrics
from pydantic import BaseModel, Field, ValidationError, model_validator  # filtros y body

from fusion import rrf  # Reciprocal Rank Fusion (k = 60)


# ---------------------------------------------------------------------------- configuración
@dataclass
class Settings:
    # Timeouts por fuente: techos, no el tiempo esperado (≈ 2–4× el p50 de cada una). La suma del camino
    # más largo de texto (encode 50 + ANN 80 → 130; luego tombstones 20 y rerank 100) = 250 ms ≤ 300 ms.
    text_encode_timeout_s: float = float(os.getenv("TEXT_ENCODE_TIMEOUT_S", "0.05"))
    image_encode_timeout_s: float = float(os.getenv("IMAGE_ENCODE_TIMEOUT_S", "0.3"))  # incluye decode
    ann_shard_timeout_s: float = float(os.getenv("ANN_SHARD_TIMEOUT_S", "0.08"))
    bm25_timeout_s: float = float(os.getenv("BM25_TIMEOUT_S", "0.12"))
    tombstone_timeout_s: float = float(os.getenv("TOMBSTONE_TIMEOUT_S", "0.02"))
    rerank_timeout_s: float = float(os.getenv("RERANK_TIMEOUT_S", "0.1"))
    # Candidatos por fuente: 200 del ANN (ya re-scored con float32 dentro del shard) y 200 de BM25.
    candidates: int = int(os.getenv("CANDIDATES", "200"))
    # Cuántos re-ordena el cross-encoder. 30 y no 100: el reranker es el costo de GPU del caso
    # (top-100 a 1,660 QPS ≈ 24 L4; top-30 ≈ 8 L4, estimado). 0 = apagado.
    rerank_top_n: int = int(os.getenv("RERANK_TOP_N", "30"))
    page_size: int = int(os.getenv("PAGE_SIZE", "48"))  # una página del marketplace
    rrf_k: int = int(os.getenv("RRF_K", "60"))
    # Shards que solo saben post-filtrar: se les pide k × este factor y se filtra aquí (ver _shard_search)
    overfetch_factor: int = int(os.getenv("OVERFETCH_FACTOR", "4"))
    max_image_bytes: int = int(os.getenv("MAX_IMAGE_BYTES", str(10 * 1024 * 1024)))  # 10 MB, como el c01
    max_query_chars: int = int(os.getenv("MAX_QUERY_CHARS", "256"))
    retry_after_s: int = int(os.getenv("RETRY_AFTER_S", "2"))


# ---------------------------------------------------------------------------- datos
Condition = Literal["new", "like_new", "good", "fair"]


class Filters(BaseModel):
    """Filtros que la persona eligió. Se aplican DENTRO de la búsqueda cuando el motor puede."""

    category_id: int | None = Field(default=None, ge=0)
    price_min: float | None = Field(default=None, ge=0)
    price_max: float | None = Field(default=None, ge=0)
    city: str | None = Field(default=None, min_length=2, max_length=64)
    condition: list[Condition] | None = None
    ships_nationwide: bool | None = None
    page: int = Field(default=0, ge=0, le=20)  # va en la query string junto a los filtros

    @model_validator(mode="after")
    def _rango(self) -> Filters:
        if self.price_min is not None and self.price_max is not None and self.price_min > self.price_max:
            raise ValueError("price_min > price_max")  # 422: un rango vacío es un error del caller
        return self

    def active(self) -> dict:
        """Solo los filtros puestos (sin la página): es lo que viaja a los motores."""
        return self.model_dump(exclude_none=True, exclude={"page"})

    def matches(self, attrs: dict) -> bool:
        """Mismo criterio que los motores. Se usa para post-filtrar y como defensa final."""
        f = self.active()
        if "category_id" in f and attrs.get("category_id") != f["category_id"]:
            return False
        price = attrs.get("price")
        if "price_min" in f and (price is None or price < f["price_min"]):
            return False
        if "price_max" in f and (price is None or price > f["price_max"]):
            return False
        if "city" in f and attrs.get("city") != f["city"]:
            return False
        if "condition" in f and attrs.get("condition") not in f["condition"]:
            return False
        if "ships_nationwide" in f and attrs.get("ships_nationwide") != f["ships_nationwide"]:
            return False
        return True


class TextQuery(BaseModel):
    q: str = Field(min_length=1)


@dataclass(frozen=True)
class Hit:
    listing_id: str
    score: float  # coseno (ANN) o score BM25: NO comparables entre sí (por eso RRF usa posiciones)
    attrs: dict = field(default_factory=dict)  # los atributos de filtro (para post-filtrar y la defensa)
    title: str = ""  # lo que lee el reranker


@dataclass(frozen=True)
class ShardResult:
    hits: list[Hit]
    model_version: str  # con qué modelo se construyó el índice que contestó


# ---------------------------------------------------------------------------- interfaces
class QueryEncoder(Protocol):
    model_version: str

    async def encode_text(self, text: str) -> Sequence[float]: ...  # 512 floats, L2-normalizado

    # decode + resize en CPU (en este proceso, en un threadpool: no en el event loop) y la torre de
    # imagen en Triton. El timeout de 300 ms cubre las dos cosas.
    async def encode_image(self, data: bytes) -> Sequence[float]: ...


class AnnShard(Protocol):
    name: str  # "shard-0" … "shard-3" (label de métricas: cardinalidad 4)
    # True: el motor aplica el filtro DURANTE la búsqueda (filtered HNSW, o búsqueda exacta sobre el
    # subconjunto si es chico). False: solo sabe devolver el top-k y filtrar después (post-filtro).
    supports_inline_filter: bool

    async def search(self, vector: Sequence[float], k: int, filters: dict) -> ShardResult: ...


class KeywordIndex(Protocol):
    # BM25 con filtros nativos. Como los shards, devuelve los atributos de filtro de cada hit: la defensa
    # final (Filters.matches) quita un hit sin atributos cuando hay filtros activos.
    async def search(self, text: str, filters: dict, k: int) -> list[Hit]: ...


class TombstoneStore(Protocol):
    async def contains_many(self, ids: Sequence[str]) -> set[str]: ...  # cuáles están vendidos/removidos


class Reranker(Protocol):
    async def score(self, query: str, hits: Sequence[Hit]) -> list[float]: ...  # un score por hit


@dataclass
class Deps:
    encoder: QueryEncoder
    shards: list[AnnShard]
    keyword: KeywordIndex
    tombstones: TombstoneStore
    reranker: Reranker | None = None


# ---------------------------------------------------------------------------- métricas
# Nombres = contrato con monitoring/alerts.yml (un test lo verifica). Labels de cardinalidad acotada:
# nunca la query ni el listing_id como label.
REQUESTS = Counter("search_requests_total", "Búsquedas", ["query_type", "status"])
LATENCY = Histogram(  # buckets EXACTOS en 0.3 (SLO texto) y 0.6 (SLO foto)
    "search_request_duration_seconds", "Latencia server-side de /v1/search", ["query_type"],
    buckets=(0.025, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0, 2.0),
)
STAGE = Histogram(  # ¿qué etapa se come el presupuesto? encode, ann, bm25, fusion, tombstones, rerank
    "search_stage_duration_seconds", "Duración de cada etapa", ["stage"],
    buckets=(0.005, 0.01, 0.02, 0.04, 0.06, 0.08, 0.1, 0.12, 0.2, 0.3, 0.5),
)
ZERO = Counter("search_zero_results_total", "Búsquedas con la primera página vacía", ["query_type"])
DEGRADED = Counter("search_degraded_total", "Búsquedas servidas con un fallback", ["reason"])
SHARD_ERRORS = Counter("search_ann_shard_errors_total", "Fallas por shard", ["shard", "reason"])
TOMBSTONED = Counter("search_tombstoned_results_total", "Candidatos quitados por tombstone (vendidos/removidos)")
TOMBSTONE_CHECKS = Counter("search_tombstone_checks_total", "Consultas al store de tombstones", ["outcome"])
UNDERFILLED = Counter(  # post-filtro que, aun con over-fetch, no llenó lo pedido: el filtro es muy selectivo
    "search_postfilter_underfilled_total", "Shards post-filtrados que devolvieron menos de k", ["shard"],
)
FILTER_VIOLATIONS = Counter(  # un motor devolvió algo que no cumple el filtro: bug de un adaptador
    "search_filter_violations_total", "Resultados que no cumplían el filtro (quitados)",
)

log = logging.getLogger("search-api")
log.addHandler(logging.StreamHandler(sys.stdout))
log.setLevel(logging.INFO)
log.propagate = False

IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}


class SearchUnavailable(Exception):
    """Ninguna fuente pudo contestar: 503."""


def _sniff_image(data: bytes) -> bool:
    """Firma del archivo (magic bytes): rechazar basura ANTES de mandarla a la GPU (400 barato)."""
    return (data[:3] == b"\xff\xd8\xff" or data[:8] == b"\x89PNG\r\n\x1a\n"
            or (data[:4] == b"RIFF" and data[8:12] == b"WEBP"))


async def _timed(stage: str, aw: Awaitable, timeout: float, lat: dict[str, float]):
    """Corre aw con timeout. Devuelve (resultado | None, motivo de falla | None). Nunca lanza."""
    t0 = time.perf_counter()
    try:
        return await asyncio.wait_for(aw, timeout), None  # wait_for CANCELA la llamada al vencer
    except TimeoutError:
        return None, "timeout"
    except Exception:  # noqa: BLE001 — una fuente rota se degrada, no tumba la búsqueda
        log.warning("etapa %s falló", stage, exc_info=True)
        return None, "error"
    finally:
        ms = (time.perf_counter() - t0) * 1000
        lat[stage] = round(lat.get(stage, 0.0) + ms, 2)
        STAGE.labels(stage).observe(ms / 1000)


# ---------------------------------------------------------------------------- lógica
@dataclass
class Searcher:
    deps: Deps
    s: Settings

    async def _shard_search(self, shard: AnnShard, vec, filters: Filters, lat) -> list[Hit] | None:
        """Un shard, con su timeout, su chequeo de versión y el post-filtro si hace falta.

        TRAMPA del post-filtro: pedir top-200 y DESPUÉS filtrar. Con un filtro que cumple el 0.2 % del
        catálogo (una ciudad chica), de 200 candidatos quedan ≈ 0.4: páginas vacías aunque existan
        cientos de listings que sí cumplen (indexing/build_index.py lo mide). Por eso los filtros van
        DENTRO de la búsqueda. Si un shard no puede, se le pide k × overfetch_factor y se filtra aquí;
        sigue siendo insuficiente para filtros muy selectivos, y eso se cuenta (UNDERFILLED).
        """
        active = filters.active()
        inline = shard.supports_inline_filter or not active
        k = self.s.candidates if inline else self.s.candidates * self.s.overfetch_factor
        # El histograma de la etapa "ann" ve CADA shard; el desglose de la respuesta (lat) lo llena _ann
        # con el tiempo de pared del scatter-gather completo (el que de verdad suma al total).
        res, err = await _timed("ann", shard.search(vec, k, active if inline else {}),
                                self.s.ann_shard_timeout_s, {})
        if err:
            SHARD_ERRORS.labels(shard.name, err).inc()
            return None
        if res.model_version != self.deps.encoder.model_version:
            # Vectores de otro modelo: el coseno entre espacios distintos no significa nada. Pasa si el
            # swap del índice (blue/green) y el del encoder no ocurrieron juntos. Se descarta el shard.
            SHARD_ERRORS.labels(shard.name, "model_version_mismatch").inc()
            return None
        hits = res.hits
        if not inline:
            hits = [h for h in hits if filters.matches(h.attrs)]
            if len(hits) < self.s.candidates:
                UNDERFILLED.labels(shard.name).inc()
        return hits[: self.s.candidates]

    async def _ann(self, text: str | None, image: bytes | None, filters: Filters, lat, degraded):
        """encode → scatter-gather sobre los shards. Devuelve la lista de hits del ANN o None."""
        enc = self.deps.encoder
        if image is not None:
            vec, err = await _timed("encode", enc.encode_image(image), self.s.image_encode_timeout_s, lat)
        else:
            vec, err = await _timed("encode", enc.encode_text(text), self.s.text_encode_timeout_s, lat)
        if err:
            degraded.append(f"encode_{err}")
            return None
        t0 = time.perf_counter()
        per_shard = await asyncio.gather(*(self._shard_search(sh, vec, filters, lat) for sh in self.deps.shards))
        lat["ann"] = round((time.perf_counter() - t0) * 1000, 2)  # = el shard más lento (o su timeout)
        failed = [sh.name for sh, r in zip(self.deps.shards, per_shard) if r is None]
        if len(failed) == len(self.deps.shards):
            return None
        if failed:
            # Falta un 25 % del catálogo por shard caído: se sirve igual y se dice (mejor que un 503)
            degraded.append("ann_partial:" + ",".join(failed))
        merged: dict[str, Hit] = {}
        for hits in per_shard:
            for h in hits or []:
                if h.listing_id not in merged or h.score > merged[h.listing_id].score:
                    merged[h.listing_id] = h
        # Mismo modelo y re-score exacto en cada shard → los cosenos SÍ son comparables entre shards
        return sorted(merged.values(), key=lambda h: (-h.score, h.listing_id))[: self.s.candidates]

    async def search(self, text: str | None, image: bytes | None, filters: Filters) -> dict:
        lat: dict[str, float] = {}
        degraded: list[str] = []
        query_type = "photo" if image is not None else "text"
        # BM25 no necesita el embedding: arranca YA, en paralelo con encode + ANN
        bm25_aw = (_timed("bm25", self.deps.keyword.search(text, filters.active(), self.s.candidates),
                          self.s.bm25_timeout_s, lat) if text else None)
        if bm25_aw is not None:
            ann_hits, (bm25_hits, bm25_err) = await asyncio.gather(
                self._ann(text, None, filters, lat, degraded), bm25_aw)
        else:
            ann_hits, bm25_hits, bm25_err = await self._ann(None, image, filters, lat, degraded), None, None
        if ann_hits is None:
            if bm25_hits is None:
                raise SearchUnavailable("ni ANN ni BM25")  # foto sin ANN también termina aquí
            degraded.append("ann_unavailable")
        if bm25_err:
            degraded.append(f"bm25_{bm25_err}")

        t0 = time.perf_counter()
        info = {h.listing_id: h for h in (bm25_hits or [])} | {h.listing_id: h for h in (ann_hits or [])}
        fused = rrf({"ann": [h.listing_id for h in ann_hits or []],
                     "bm25": [h.listing_id for h in bm25_hits or []]}, k=self.s.rrf_k)
        # Defensa en profundidad: los motores ya filtraron, pero un adaptador con un bug no debe
        # mostrar un listing de otra ciudad. Barato (≤ 400 dicts) y se cuenta si alguna vez pasa.
        kept = [f for f in fused if filters.matches(info[f.doc_id].attrs)]
        if len(kept) < len(fused):
            FILTER_VIOLATIONS.inc(len(fused) - len(kept))
        lat["fusion"] = round((time.perf_counter() - t0) * 1000, 2)

        # Tombstones: el vendido hace ≤ 1 min sigue en el índice (borrar de HNSW es caro); aquí se quita.
        ids = [f.doc_id for f in kept]
        gone, err = await _timed("tombstones", self.deps.tombstones.contains_many(ids),
                                 self.s.tombstone_timeout_s, lat) if ids else (set(), None)
        if err:
            TOMBSTONE_CHECKS.labels("failed").inc()
            degraded.append("tombstones_unchecked")  # se sirve igual: la alerta SoldItemsServed lo ve
            gone = set()
        elif ids:
            TOMBSTONE_CHECKS.labels("ok").inc()
        if gone:
            TOMBSTONED.inc(len(gone))
        final = [f for f in kept if f.doc_id not in gone]

        page = filters.page
        rerank_scores: dict[str, float] = {}
        n = self.s.rerank_top_n
        # Rerank solo texto, solo página 0 (permuta dentro del top-30, que cae entero en la página 0:
        # las páginas siguientes no cambian) y solo si hay reranker.
        if text and page == 0 and n > 0 and self.deps.reranker and len(final) > 1:
            top = [info[f.doc_id] for f in final[:n]]
            scores, err = await _timed("rerank", self.deps.reranker.score(text, top), self.s.rerank_timeout_s, lat)
            if err or scores is None or len(scores) != len(top):
                degraded.append("rerank_skipped")
            else:
                order = sorted(range(len(top)), key=lambda i: (-scores[i], i))
                rerank_scores = {top[i].listing_id: float(scores[i]) for i in order}
                final = [final[i] for i in order] + final[n:]

        start = page * self.s.page_size
        page_items = final[start:start + self.s.page_size]
        if page == 0 and not page_items:
            ZERO.labels(query_type).inc()
        for reason in degraded:
            DEGRADED.labels(reason.split(":")[0]).inc()  # sin la lista de shards: cardinalidad acotada
        return {
            "model_version": self.deps.encoder.model_version if ann_hits is not None else None,
            "query_type": query_type,
            "page": page,
            "results": [
                {"listing_id": f.doc_id, "rank": start + i + 1, "sources": f.ranks,
                 **({"rerank_score": round(rerank_scores[f.doc_id], 4)} if f.doc_id in rerank_scores else {})}
                for i, f in enumerate(page_items)
            ],
            # Con 200 candidatos por fuente hay ≈ 4–8 páginas; más allá, la app ofrece afinar filtros.
            "has_more": len(final) > start + self.s.page_size,
            "degraded": degraded,
            # ms por etapa. encode + ann corren en paralelo con bm25: total ≈ max(encode + ann, bm25) + el resto
            "latency_ms": lat,
        }


# ---------------------------------------------------------------------------- app
def create_app(deps: Deps, settings: Settings | None = None) -> FastAPI:
    s = settings or Settings()
    searcher = Searcher(deps, s)
    app = FastAPI(title="search-api (c07)")

    @app.get("/healthz")
    async def healthz():  # liveness: el proceso responde. No mira dependencias (reiniciar no las arregla)
        return {"status": "ok"}

    @app.get("/readyz")
    async def readyz(response: Response):
        # Ready solo si los shards a los que apunta este pod sirven el MISMO modelo que su encoder. Un pod
        # con el encoder nuevo y el índice viejo (o al revés) daría resultados basura con 200 OK.
        versions = {getattr(sh, "model_version", None) for sh in deps.shards}
        ok = versions == {deps.encoder.model_version}
        response.status_code = 200 if ok else 503
        return {"ready": ok, "encoder": deps.encoder.model_version, "shards": sorted(map(str, versions))}

    @app.get("/metrics")
    async def metrics():
        return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

    @app.post("/v1/search")
    async def search(request: Request, filters: Annotated[Filters, Query()]):
        t0 = time.perf_counter()
        ctype = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
        query_type = "photo" if ctype in IMAGE_TYPES else "text"
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex
        status = 200
        try:
            body = await request.body()
            text, image = None, None
            if ctype == "application/json":
                try:
                    text = TextQuery.model_validate_json(body).q.strip()
                except ValidationError:
                    text = ""
                if not text or len(text) > s.max_query_chars:
                    status = 400
                    return JSONResponse({"error": f"q vacío o de más de {s.max_query_chars} caracteres"}, 400)
            elif ctype in IMAGE_TYPES:
                if len(body) > s.max_image_bytes:
                    status = 413
                    return JSONResponse({"error": "imagen demasiado grande"}, 413)
                if not _sniff_image(body):
                    status = 400
                    return JSONResponse({"error": "no es una imagen JPEG, PNG o WebP"}, 400)
                image = body
            else:
                status = 415
                return JSONResponse({"error": "usa application/json (texto) o image/jpeg|png|webp (foto)"}, 415)
            try:
                out = await searcher.search(text, image, filters)
            except SearchUnavailable:
                status = 503
                return JSONResponse({"error": "búsqueda no disponible"}, 503,
                                    headers={"Retry-After": str(s.retry_after_s)})
            total = (time.perf_counter() - t0) * 1000
            out["latency_ms"]["total"] = round(total, 2)
            out["request_id"] = rid
            # Una línea por búsqueda: la base de los eval sets (head/torso/tail), de la atribución de
            # clics y de la auditoría de vendidos servidos. Sin user_id; el texto de la query sí, porque
            # es el dato de evaluación (retención corta y acceso restringido: ver M15).
            log.info(json.dumps({
                "event": "search", "request_id": rid, "query_type": query_type,
                "q": text, "filters": filters.active(), "page": filters.page,
                "model_version": out["model_version"], "results": [r["listing_id"] for r in out["results"]],
                "degraded": out["degraded"], "latency_ms": out["latency_ms"],
            }, ensure_ascii=False))
            return out
        finally:
            REQUESTS.labels(query_type, str(status)).inc()
            LATENCY.labels(query_type).observe(time.perf_counter() - t0)

    return app


def build_app() -> FastAPI:  # pragma: no cover — requiere GPU, shards, OpenSearch y Redis reales
    """Adaptadores reales que faltan (no se pudieron probar aquí):
    - QueryEncoder: cliente de Triton para las torres de texto e imagen (mismo model_version que el índice).
    - AnnShard × 4: cliente del motor vectorial que se elija; cada uno con 2 réplicas detrás de un Service.
    - KeywordIndex: opensearch-py async contra el índice BM25 actual (filtros como bool/filter).
    - TombstoneStore: Redis (SMISMEMBER sobre ≤ 400 ids en una sola ida y vuelta).
    - Reranker: cliente de Triton para el cross-encoder (o None para apagarlo).
    """
    raise NotImplementedError("conecta los adaptadores reales (ver docstring y README)")


def demo_app() -> FastAPI:
    """Demo local con un catálogo de juguete y fakes (uvicorn --factory api:demo_app)."""
    import fakes  # solo para la demo y los tests

    return create_app(fakes.demo_deps())
