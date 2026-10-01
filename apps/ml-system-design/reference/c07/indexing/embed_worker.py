"""embed-worker (caso c07): mantiene el índice vectorial al día con el catálogo del marketplace.

Consume el tópico de Kafka `listing-events` (key = listing_id) que publica listing-service:
  created / updated → embedding (CLIP-class, d = 512, L2-normalizado) → upsert al índice con model_version
  sold / removed    → TOMBSTONE en un store rápido (lo lee search-api en cada consulta) + borrado en el índice

Promesas del caso (§ requisitos):
  - un listing nuevo es buscable en p95 ≤ 5 min  → embed_worker_index_freshness_seconds{op="upsert"}
  - un vendido o removido desaparece en ≤ 1 min  → tombstone PRIMERO; el índice se limpia después.
    Por qué: borrar de un grafo HNSW es caro (FAISS ni siquiera implementa remove_ids para HNSW; otros
    motores marcan el nodo como borrado y lo limpian al reconstruir o compactar). El tombstone en un
    key-value store tarda milisegundos y search-api filtra con él.

Garantías de este worker:
  1. Idempotente por (listing_id, event_version). Kafka entrega at-least-once: el mismo evento puede
     llegar dos veces (reintentos, rebalanceo) y un evento viejo puede llegar DESPUÉS de uno nuevo (un
     outbox que re-publica, un backfill). Se aplica solo si event_version > la última aplicada. Así un
     `updated` v4 atrasado nunca resucita un listing `sold` v5. Un listing solo vuelve si llega una
     versión MÁS NUEVA que lo reactiva (p. ej. un `updated` después de ganar una apelación de moderación).
  2. Nunca mezcla versiones de modelo: cada batch de vectores llega con el model_version que de verdad
     lo calculó (Triton lo devuelve en cada respuesta de inferencia). Si no es el del índice, el worker
     se niega a escribir y se cae (sin commitear offsets: no se pierde nada). Vectores de dos modelos
     distintos no viven en el mismo espacio: el coseno entre ellos no significa nada.
  3. Re-embeber solo si cambió lo que entra al embedding (título, atributos de texto, foto principal).
     Un cambio de precio o de ciudad (la mayoría de los `updated`) solo actualiza los atributos de filtro.
  4. Offsets se commitean DESPUÉS de escribir todo el batch. Un mensaje envenenado (JSON roto, vector
     NaN) va a la dead-letter queue y no frena la partición; un error transitorio (GPU, índice) se
     reintenta y, si sigue, el worker se cae SIN commitear (Kubernetes lo reinicia; la alerta
     EmbedWorkerBacklog lo ve).

Un worker = un índice = un model_version. Durante un cambio de modelo (blue/green) corren dos workers, cada
uno con su consumer group (`embed-worker-<model_version>`) y su índice. Por eso el estado de versiones es
POR ÍNDICE (el worker de green tiene que aplicar lo que el de blue ya aplicó), y los tombstones son
COMPARTIDOS (que un listing se vendió no depende del modelo).

Interfaces (Protocol) para todo lo externo: Consumer (Kafka), Embedder (GPU / Triton), VectorIndex (los
shards ANN), TombstoneStore y StateStore (Redis-class), DeadLetter. Los tests usan fakes; los adaptadores
reales no están aquí porque no se pudieron probar sin esos servicios (ver README).
"""

from __future__ import annotations  # anotaciones como texto

import hashlib  # content_hash: ¿cambió lo que entra al embedding?
import json  # los eventos llegan como JSON
import logging  # a stdout: en un contenedor los logs son un stream
import time  # timestamps de frescura y backoff
from collections.abc import Callable, Sequence  # tipos
from dataclasses import dataclass, field  # eventos y estado inmutables
from typing import Literal, Protocol  # interfaces sin herencia

import numpy as np  # validar los vectores antes de escribirlos
from prometheus_client import REGISTRY, CollectorRegistry, Counter, Gauge, Histogram  # métricas

log = logging.getLogger("embed-worker")

EventType = Literal["created", "updated", "sold", "removed"]
LIVE_TYPES = ("created", "updated")  # producen o actualizan un vector
GONE_TYPES = ("sold", "removed")  # producen un tombstone

# Atributos que entran al TEXTO que se embebe (título + estos). Cambian el vector.
EMBEDDED_ATTRS = ("brand", "model", "size", "color", "material")
# Atributos que solo sirven para FILTRAR en la búsqueda (no cambian el vector).
FILTER_ATTRS = ("category_id", "price", "city", "condition", "ships_nationwide")


# ---------------------------------------------------------------------------- datos
class InvalidEvent(ValueError):
    """Evento que nunca se va a poder procesar (va a la dead-letter queue)."""


class ModelVersionMismatch(RuntimeError):
    """El embedder y el índice tienen modelos distintos. No es reintentable: hay que arreglar el deploy."""


@dataclass(frozen=True)
class ListingEvent:
    listing_id: str
    # Versión de la fila del listing en listing-service (sube en cada cambio). La pone la FUENTE, no el
    # worker: es lo único que ordena eventos que llegan desordenados.
    event_version: int
    type: EventType
    # Momento del commit en listing-service (epoch, s): desde aquí se mide la frescura de punta a punta.
    ts: float
    title: str = ""
    attributes: dict = field(default_factory=dict)
    main_photo_uri: str | None = None  # la foto la guarda media-service; aquí solo viaja la referencia

    @classmethod
    def from_json(cls, raw: bytes) -> ListingEvent:
        try:
            d = json.loads(raw)
            ev = cls(
                listing_id=str(d["listing_id"]),
                event_version=int(d["event_version"]),
                type=d["type"],
                ts=float(d["ts"]),
                title=str(d.get("title") or ""),
                attributes=dict(d.get("attributes") or {}),
                main_photo_uri=d.get("main_photo_uri"),
            )
        except (ValueError, KeyError, TypeError) as e:  # JSON roto o campo faltante: veneno
            raise InvalidEvent(f"evento ilegible: {e}") from e
        if ev.type not in LIVE_TYPES + GONE_TYPES:
            raise InvalidEvent(f"tipo desconocido: {ev.type!r}")
        if ev.type in LIVE_TYPES and not (ev.title or ev.main_photo_uri):
            raise InvalidEvent("created/updated sin título ni foto: no hay qué embeber")
        return ev

    def embedding_text(self) -> str:
        """Lo que ve la torre de texto: título + atributos de texto en un orden fijo."""
        parts = [self.title] + [f"{k}: {self.attributes[k]}" for k in EMBEDDED_ATTRS if self.attributes.get(k)]
        return " | ".join(parts)

    def content_hash(self) -> str:
        """Huella de lo que entra al embedding. Igual → el vector sería el mismo → no se recalcula."""
        return hashlib.sha256(f"{self.embedding_text()}\x00{self.main_photo_uri or ''}".encode()).hexdigest()

    def filter_attrs(self) -> dict:
        return {k: self.attributes[k] for k in FILTER_ATTRS if k in self.attributes}


@dataclass(frozen=True)
class ListingState:
    """Lo último que se aplicó de un listing EN UN ÍNDICE (vive en el StateStore, por índice; lo comparten
    las réplicas del worker de ese índice)."""

    version: int
    status: Literal["live", "gone"]
    content_hash: str = ""


@dataclass(frozen=True)
class Message:
    """Un mensaje de Kafka tal como lo entrega el consumer (lo que importa para commitear y depurar)."""

    partition: int
    offset: int
    value: bytes


# ---------------------------------------------------------------------------- interfaces
class Consumer(Protocol):
    """Consumer de Kafka del grupo `embed-worker-<model_version>` (enable.auto.commit=false: commit manual).
    Un grupo por versión: el worker de green relee desde el offset del snapshot sin mover el de blue."""

    def poll(self, max_records: int, timeout_s: float) -> list[Message]: ...

    def commit(self, messages: Sequence[Message]) -> None: ...  # offset + 1 del último de cada partición

    def backlog(self) -> int | None: ...  # mensajes pendientes (high watermark − posición); None si no sabe


class Embedder(Protocol):
    """Las dos torres del dual encoder en GPU. Devuelve UN vector por listing (foto + texto, promediados).

    Contrato de errores (importa para no frenar la partición):
      - error de UN ítem (la foto no baja, no se decodifica) → esa fila viene en NaN: va a la DLQ con su
        motivo y el resto del batch se escribe. El listing sigue buscable por BM25 y la DLQ se re-procesa.
      - error del SERVICIO (Triton caído, GPU sin memoria) → excepción: se reintenta y, si sigue, el
        worker se cae sin commitear. Si un ítem roto lanzara excepción, tumbaría el worker en bucle.
    """

    model_version: str  # la que el adaptador cree tener cargada, p. ej. "2026-09-15-clip-ft-v7" (chequeo al arrancar)
    dim: int  # 512

    # Devuelve (vectores (n, dim), model_version que los calculó). La versión sale de la RESPUESTA de
    # inferencia (el protocolo v2 de Triton/KServe trae model_version), no del atributo de arriba: si el
    # modelo se recargó en medio de la llamada, el atributo puede decir una cosa y los vectores ser de otra.
    def embed(self, texts: Sequence[str], photo_uris: Sequence[str | None]) -> tuple[np.ndarray, str]: ...


class VectorIndex(Protocol):
    """El índice ANN (los 4 shards; el adaptador rutea cada listing a su shard por hash del id)."""

    name: str  # p. ej. "listings-vec-v7": el índice concreto, nunca el alias de lectura
    model_version: str  # el modelo con el que se construyó; un índice = un modelo, siempre
    dim: int

    def upsert(self, ids: Sequence[str], vectors: np.ndarray, attrs: Sequence[dict], model_version: str) -> None: ...

    def update_attributes(self, listing_id: str, attrs: dict) -> None: ...  # precio, ciudad…: sin vector

    def mark_deleted(self, ids: Sequence[str]) -> None: ...  # barato: marca; la limpieza real es el rebuild


class TombstoneStore(Protocol):
    """Listings que NO deben mostrarse. Compartido por todos los workers e índices (un vendido está vendido
    en v7 y en v8).

    En Redis: UNA KEY POR LISTING, `SET tomb:{listing_id} <ts> EX 604800`, escritas en un pipeline. El TTL
    tiene que ser por listing, no por set: EXPIRE vence una key entera, y los miembros de un Redis Set no
    tienen vencimiento propio. Un set con TTL borraría TODOS los tombstones a la vez (y los vendidos de
    ayer volverían); sin TTL crecería para siempre (≈ 2.5 M por día). 7 días = más que la edad máxima de
    un snapshot de re-indexado: un vendido no puede reaparecer desde una copia vieja del índice.
    search-api los lee con un MGET de los ≤ 400 candidatos (ver search/api.py)."""

    def add(self, ids_ts: dict[str, float]) -> None: ...  # listing_id → momento del sold/removed

    def discard(self, ids: Sequence[str]) -> None: ...  # DEL: un listing reactivado con una versión más nueva


class StateStore(Protocol):
    """Última versión aplicada por listing, POR ÍNDICE: key `state:{index}:{listing_id}`.

    Por qué por índice: si v7 y v8 compartieran el estado, el worker de green (v8), que relee los eventos
    desde el offset del snapshot, vería cada evento que el de blue ya aplicó como `stale` y lo tiraría:
    green terminaría sin los listings creados o editados durante el catch-up. Los tombstones sí se
    comparten (ver TombstoneStore).

    put_many es CONDICIONAL: solo escribe si la versión es mayor (compare-and-set: un script Lua en Redis o
    un conditional write). Así dos réplicas que se pisan durante un rebalanceo de Kafka no pueden bajar la
    versión. Si el índice vectorial es OpenSearch, la versión externa del documento (version_type=external:
    solo indexa si la versión es mayor) cubre la mitad de esto; el estado live/gone y el content_hash igual
    hay que guardarlos en algún lado."""

    def get_many(self, index: str, ids: Sequence[str]) -> dict[str, ListingState]: ...

    def put_many(self, index: str, states: dict[str, ListingState]) -> None: ...


class DeadLetter(Protocol):
    """Tópico `listing-events-dlq`: lo que no se puede procesar nunca, con el motivo, para revisarlo."""

    def send(self, message: Message, reason: str) -> None: ...


# ---------------------------------------------------------------------------- métricas
class Metrics:
    """Nombres = contrato con monitoring/alerts.yml (un test lo verifica). Un registry por instancia
    para que los tests no compartan contadores; en producción, el REGISTRY global."""

    def __init__(self, registry: CollectorRegistry = REGISTRY):
        self.events = Counter(  # outcome: applied · attrs_only · stale · superseded · invalid
            "embed_worker_events_total", "Eventos de listing-events por tipo y resultado",
            ["type", "outcome"], registry=registry)
        self.upserts = Counter("embed_worker_upserts_total", "Vectores escritos en el índice", registry=registry)
        self.tombstones = Counter("embed_worker_tombstones_total", "Tombstones escritos (sold/removed)",
                                  registry=registry)
        self.attr_updates = Counter("embed_worker_attribute_updates_total",
                                    "Cambios solo de filtros (sin re-embeber)", registry=registry)
        self.dead_letters = Counter("embed_worker_dead_letter_total", "Mensajes enviados a la DLQ",
                                    ["reason"], registry=registry)
        # Frescura de punta a punta: commit en listing-service → escrito aquí. op = upsert | tombstone.
        # Buckets EXACTOS en 60 s (SLO de tombstones) y 300 s (SLO de nuevos): histogram_quantile
        # interpola dentro del bucket, y un borde en el umbral evita falsas alarmas.
        self.freshness = Histogram(
            "embed_worker_index_freshness_seconds", "Segundos desde el evento hasta escribirlo", ["op"],
            buckets=(1, 5, 15, 30, 60, 120, 180, 300, 600, 1800), registry=registry)
        self.event_lag = Gauge("embed_worker_event_lag_seconds",
                               "Edad del último evento procesado (ahora − ts del evento)", registry=registry)
        self.backlog = Gauge("embed_worker_backlog_messages", "Mensajes pendientes según el consumer",
                             registry=registry)
        self.embed_seconds = Histogram("embed_worker_embed_batch_seconds", "Duración de un batch en la GPU",
                                       buckets=(0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5), registry=registry)
        self.last_success = Gauge("embed_worker_last_success_timestamp_seconds",
                                  "Último batch commiteado", registry=registry)


# ---------------------------------------------------------------------------- worker
@dataclass
class Worker:
    consumer: Consumer
    embedder: Embedder
    index: VectorIndex
    tombstones: TombstoneStore
    states: StateStore
    dlq: DeadLetter
    metrics: Metrics
    max_batch: int = 64  # ≈ lo que llena bien un batch de GPU sin esperar de más (a 90 eventos/s de pico)
    poll_timeout_s: float = 0.5  # cuánto esperar a que se junte un batch: suma ≤ 0.5 s a la frescura
    retries: int = 3  # intentos ante errores transitorios del embedder o del índice
    backoff_s: float = 0.5  # esperas de 0.5 y 1 s entre los 3 intentos; el total debe ser << max.poll.interval.ms
    clock: Callable[[], float] = time.time  # inyectable: los tests controlan el tiempo
    sleep: Callable[[float], None] = time.sleep
    _msg_of: dict[tuple[str, int], Message] = field(default_factory=dict, init=False, repr=False)

    def __post_init__(self) -> None:
        self._check_versions()  # mejor no arrancar que escribir un vector incompatible

    def _check_versions(self) -> None:
        if self.embedder.model_version != self.index.model_version:
            raise ModelVersionMismatch(
                f"embedder={self.embedder.model_version} índice={self.index.model_version}: "
                "cada índice se construye con UN modelo. Para un modelo nuevo se construye otro índice "
                "(blue/green) con su propio worker y consumer group.")
        if self.embedder.dim != self.index.dim:
            raise ModelVersionMismatch(f"dim embedder={self.embedder.dim} índice={self.index.dim}")

    # -------------------------------------------------------------- un ciclo
    def run_once(self) -> int:
        """Lee un batch, lo aplica y commitea. Devuelve cuántos mensajes procesó."""
        msgs = self.consumer.poll(self.max_batch, self.poll_timeout_s)
        backlog = self.consumer.backlog()
        if backlog is not None:
            self.metrics.backlog.set(backlog)
        if not msgs:
            return 0
        self.process(msgs)
        self.consumer.commit(msgs)  # DESPUÉS de escribir todo: si algo falló antes, se re-procesa
        self.metrics.last_success.set(self.clock())
        return len(msgs)

    def process(self, msgs: Sequence[Message]) -> None:
        events = self._parse(msgs)
        latest = self._collapse(events)
        if not latest:
            return
        prev = self.states.get_many(self.index.name, list(latest))
        to_embed: list[ListingEvent] = []
        attrs_only: list[ListingEvent] = []
        gone: list[ListingEvent] = []
        for lid, ev in latest.items():
            st = prev.get(lid)
            if st is not None and ev.event_version <= st.version:
                # Duplicado o desordenado: ya aplicamos algo igual o más nuevo. Es AQUÍ donde un
                # `updated` v4 que llega tarde no resucita al `sold` v5.
                self.metrics.events.labels(ev.type, "stale").inc()
                continue
            if ev.type in GONE_TYPES:
                gone.append(ev)
            elif st is not None and st.status == "live" and st.content_hash == ev.content_hash():
                attrs_only.append(ev)  # cambió precio, ciudad o condición: el vector sería el mismo
            else:
                to_embed.append(ev)  # nuevo, contenido distinto, o reactivado (estaba "gone")

        new_states: dict[str, ListingState] = {}
        self._apply_gone(gone, new_states)  # primero lo que tiene el SLO más corto (≤ 1 min)
        for ev in attrs_only:
            self._retry(lambda ev=ev: self.index.update_attributes(ev.listing_id, ev.filter_attrs()))
            new_states[ev.listing_id] = ListingState(ev.event_version, "live", ev.content_hash())
            self.metrics.attr_updates.inc()
            self.metrics.events.labels(ev.type, "attrs_only").inc()
        self._apply_live(to_embed, prev, new_states)
        self._retry(lambda: self.states.put_many(self.index.name, new_states))  # al final: si se cae antes, se re-aplica igual
        applied = gone + attrs_only + to_embed
        if applied:
            # Edad del evento MÁS NUEVO que se aplicó: si crece sin parar, el worker va atrasado o parado
            self.metrics.event_lag.set(max(0.0, self.clock() - max(ev.ts for ev in applied)))

    # -------------------------------------------------------------- pasos
    def _parse(self, msgs: Sequence[Message]) -> list[tuple[Message, ListingEvent]]:
        out = []
        for m in msgs:
            try:
                out.append((m, ListingEvent.from_json(m.value)))
            except InvalidEvent as e:
                # Veneno: reintentarlo para siempre bloquearía la partición (y todos los listings que caen
                # en ella). A la DLQ, se cuenta, y se sigue.
                self.dlq.send(m, f"invalid_event: {e}")
                self.metrics.dead_letters.labels("invalid_event").inc()
                self.metrics.events.labels("unknown", "invalid").inc()
        return out

    def _collapse(self, events: list[tuple[Message, ListingEvent]]) -> dict[str, ListingEvent]:
        """Dentro del batch, por listing gana la versión más alta (created v1 + sold v2 → solo sold v2)."""
        latest: dict[str, ListingEvent] = {}
        self._msg_of = {}  # (listing_id, versión) → mensaje: para mandar a la DLQ el mensaje original
        for m, ev in events:
            self._msg_of[(ev.listing_id, ev.event_version)] = m
            cur = latest.get(ev.listing_id)
            if cur is None or ev.event_version > cur.event_version:
                if cur is not None:
                    self.metrics.events.labels(cur.type, "superseded").inc()
                latest[ev.listing_id] = ev
            else:
                self.metrics.events.labels(ev.type, "superseded").inc()
        return latest

    def _apply_gone(self, gone: list[ListingEvent], new_states: dict[str, ListingState]) -> None:
        if not gone:
            return
        # 1) tombstone: desde aquí search-api ya no lo muestra (milisegundos). Durante un blue/green lo
        #    escriben los dos workers (es idempotente). Ojo: el de green, al releer desde el snapshot, puede
        #    re-aplicar una baja vieja de un listing que blue ya reactivó; queda oculto hasta que green llega
        #    al evento que lo reactiva (minutos). Es el lado seguro: ocultar de más, nunca mostrar un vendido.
        self._retry(lambda: self.tombstones.add({ev.listing_id: ev.ts for ev in gone}))
        now = self.clock()
        for ev in gone:
            self.metrics.freshness.labels("tombstone").observe(max(0.0, now - ev.ts))
            self.metrics.tombstones.inc()
            self.metrics.events.labels(ev.type, "applied").inc()
            new_states[ev.listing_id] = ListingState(ev.event_version, "gone")
        # 2) marcar borrado en el índice: barato, pero el espacio se recupera recién en el rebuild del shard
        self._retry(lambda: self.index.mark_deleted([ev.listing_id for ev in gone]))

    def _apply_live(self, evs: list[ListingEvent], prev: dict[str, ListingState],
                    new_states: dict[str, ListingState]) -> None:
        if not evs:
            return
        t0 = time.perf_counter()
        vecs, version = self._retry(lambda: self.embedder.embed([e.embedding_text() for e in evs],
                                                                [e.main_photo_uri for e in evs]))
        self.metrics.embed_seconds.observe(time.perf_counter() - t0)
        if version != self.index.model_version:
            # La versión que DE VERDAD calculó estos vectores (de la respuesta, no de un atributo): el
            # embedder recargó otro modelo en caliente. Nada se escribe ni se commitea.
            raise ModelVersionMismatch(f"el batch vino de {version}; el índice {self.index.name} es "
                                       f"{self.index.model_version}")
        vecs = np.asarray(vecs, dtype=np.float32)
        if vecs.shape != (len(evs), self.index.dim):
            # El adaptador devolvió otra cosa: es un bug del deploy, no de un listing → no reintentable
            raise RuntimeError(f"embedder devolvió {vecs.shape}, se esperaba {(len(evs), self.index.dim)}")
        ok = self._valid_rows(vecs)
        good = [e for e, v in zip(evs, ok) if v]
        for e, v in zip(evs, ok):
            if not v:
                # Fila NaN (la foto no bajó o no se decodificó: ver Embedder) o de norma ≠ 1: escribirla
                # envenena el índice (con producto interno, un NaN rompe el orden). Ese listing va a la DLQ
                # y sigue buscable por BM25; el resto del batch sigue.
                self.dlq.send(self._msg_of[(e.listing_id, e.event_version)], "invalid_vector")
                self.metrics.dead_letters.labels("invalid_vector").inc()
                self.metrics.events.labels(e.type, "invalid").inc()
        if not good:
            return
        self._retry(lambda: self.index.upsert([e.listing_id for e in good], vecs[ok],
                                              [e.filter_attrs() for e in good], version))
        revived = [e.listing_id for e in good if (st := prev.get(e.listing_id)) and st.status == "gone"]
        if revived:
            # Versión MÁS NUEVA que reactiva un listing (apelación ganada): se quita el tombstone DESPUÉS del
            # upsert, para que no haya un instante en que se muestre un vector viejo marcado como borrado.
            self._retry(lambda: self.tombstones.discard(revived))
        now = self.clock()
        for e in good:
            new_states[e.listing_id] = ListingState(e.event_version, "live", e.content_hash())
            self.metrics.freshness.labels("upsert").observe(max(0.0, now - e.ts))
            self.metrics.upserts.inc()
            self.metrics.events.labels(e.type, "applied").inc()

    @staticmethod
    def _valid_rows(v: np.ndarray, tol: float = 1e-3) -> np.ndarray:
        """Fila válida = finita y con norma ≈ 1 (el caso usa vectores L2-normalizados: producto interno = coseno)."""
        finite = np.isfinite(v).all(axis=1)
        norms = np.linalg.norm(np.where(np.isfinite(v), v, 0.0), axis=1)
        return finite & (np.abs(norms - 1.0) <= tol)

    def _retry(self, fn: Callable[[], object]) -> object:
        """Errores transitorios (GPU ocupada, shard reiniciando): reintento con backoff exponencial. Si
        sigue fallando, la excepción sube y el worker se cae SIN commitear: mejor atrasado que perdido.
        ModelVersionMismatch no se reintenta (no se arregla esperando)."""
        for attempt in range(self.retries):
            try:
                return fn()
            except ModelVersionMismatch:
                raise
            except Exception:  # noqa: BLE001 — cualquier error del adaptador es "transitorio" hasta agotar
                if attempt == self.retries - 1:
                    raise
                log.warning("reintento %d tras error", attempt + 1, exc_info=True)
                self.sleep(self.backoff_s * 2**attempt)
        raise AssertionError("inalcanzable")


def run_forever(worker: Worker, should_stop: Callable[[], bool]) -> None:
    """Bucle principal. should_stop lo pone en True el handler de SIGTERM: termina el batch actual,
    commitea y sale (graceful shutdown dentro del terminationGracePeriodSeconds del pod)."""
    while not should_stop():
        worker.run_once()


def build_worker() -> Worker:  # pragma: no cover — requiere Kafka, GPU, shards y Redis reales
    """Conecta los adaptadores reales. No están en esta referencia porque no se pudieron probar aquí:
    - Consumer: confluent-kafka, group.id=embed-worker-<model_version> (p. ej. embed-worker-v7),
      enable.auto.commit=false, topic listing-events. Un grupo por versión; al retirar una versión, borra
      también su grupo (kafka-consumer-groups --delete), o su lag queda colgado en EmbedWorkerBacklog.
    - Embedder: cliente de Triton contra las dos torres; devuelve el model_version de cada respuesta.
    - VectorIndex: cliente de los 4 shards (rutea por hash(listing_id) % 4) apuntando al índice de ESTE
      model_version (listings-vec-v7, no el alias de lectura: durante un blue/green, cada índice tiene su worker).
    - TombstoneStore: Redis, una key por listing: SET tomb:{id} <ts> EX 604800 (pipeline); discard = DEL.
      Compartido por todos los workers.
    - StateStore: Redis, keys state:{index}:{listing_id} (por índice), con un script Lua para el
      compare-and-set de versiones.
    Métricas: prometheus_client.start_http_server(9100) antes de run_forever.
    """
    raise NotImplementedError("conecta los adaptadores reales (ver docstring y README)")
