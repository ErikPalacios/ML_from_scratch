"""Ingesta incremental (caso c11): un evento de cambio → lo mínimo que hay que tocar en el índice.

Volumen del caso (#c11.datos): ≈ 1.5 M documentos, ≈ 1 % cambia por día (≈ 15k). Re-indexar todo cada noche
re-embebería ≈ 12 M chunks para cambiar ≈ 120k, y dejaría respuestas de hasta 24 h de antigüedad. El objetivo es
otro: una página editada se puede contestar en p95 ≤ 15 min y una revocación de permiso aplica en ≤ 5 min.

De dónde salen los eventos (los conectores no están aquí; verifica cada API):
  - Drive: changes.list desde un startPageToken guardado (y changes.watch para enterarse antes de la próxima
    consulta); un archivo borrado o al que ya no tenemos acceso llega como cambio `removed`.
  - Confluence y Jira: webhooks donde la instancia los permita y, como red de seguridad, consultas periódicas por
    fecha de modificación. OJO: cambiar las RESTRICCIONES de una página de Confluence no cambia su contenido; no
    asumas que trae una versión nueva. Por eso el orden se decide con (version, observed_at), no solo con version.
  - Permisos: un poller por fuente pide los cambios de permisos desde su último cursor y los manda como eventos
    kind="acl" (su último éxito: rag_acl_sync_last_success_timestamp_seconds). Un barrido COMPLETO de ACLs es la red
    de seguridad nocturna, no el camino de las revocaciones: recorrer 1.5 M documentos cada 5 min serían ≈ 5,000
    lecturas por segundo (1.5 M ÷ 300 s) contra APIs con límites de uso (verifica los de cada una). Si una fuente
    no expone cambios de permisos, la promesa de ≤ 5 min no se cumple para ella: se dice y se mide
    (rag_ingest_lag_seconds{kind="acl"}), no se asume.

Qué decide apply() para cada evento (en este orden):
  1. ¿Es viejo? (version, observed_at) ≤ lo ya aplicado → `stale`. La cola entrega at-least-once y puede
     desordenar: un evento repetido o atrasado no hace nada. Así un replay es idempotente.
  2. ¿Es un borrado? → se borran los chunks y queda un TOMBSTONE con su clave: un "upsert" atrasado de una versión
     anterior no resucita el documento. Uno con versión nueva (restaurado de la papelera) sí entra.
  3. ¿Nadie tiene permiso explícito (AclResult.acl None) o la ACL no entra en el índice (AclTooComplex)? → se
     sacan sus chunks (falla cerrado) y se recuerda por qué (`unindexed_*`).
  4. ¿El contenido es el mismo (hash) y solo cambió la ACL? → `acl_updated`: se re-escriben los campos acl_i de
     sus chunks, SIN re-embeber. Es el camino de las revocaciones: barato y rápido.
  5. ¿Mismo contenido y misma ACL? → `unchanged` (se guarda la clave nueva y nada más).
  6. Contenido nuevo → chunking; los chunks cuyo id (doc_id + hash del texto) ya existían conservan su vector y solo
     se les actualizan metadatos; se embeben los nuevos; se borran los que desaparecieron. Orden: escribir lo nuevo
     ANTES de borrar lo viejo (nunca hay un instante con el documento sin chunks).

Un índice = un modelo de embeddings. Si el estado dice que un documento se embebió con otro modelo, apply() se
niega (ModelMismatch): cambiar de modelo es construir OTRO índice con su propia ingesta y cambiar un alias
(blue/green, como #c07), nunca mezclar vectores de dos modelos en un índice.

Freno de borrado masivo (MassDeletionGuard): si en una ventana se van a borrar más del 2 % de los documentos de
una fuente, se frena esa fuente y se avisa (IndexDocCountDrop). La causa típica no es que alguien borró 30k páginas:
es un token del conector vencido o un cambio de permisos de la cuenta de servicio, y la fuente "parece vacía".

Interfaces (Protocol): Embedder (GPU), IndexWriter (OpenSearch), StateStore (en producción una tabla con una fila
por documento y escritura condicional sobre la clave, para que dos workers no se pisen). Fakes en los tests;
retrieval/hybrid.InMemoryIndex implementa IndexWriter.
"""

from __future__ import annotations  # anotaciones como texto

import hashlib  # hash del contenido
import json  # forma canónica del documento para el hash
import time  # reloj por defecto (inyectable)
from collections.abc import Callable, Sequence  # tipos
from dataclasses import asdict, dataclass, field, replace  # estado y resultados
from typing import Protocol  # interfaces

from acl import AclResult, AclTooComplex  # ACL normalizada de la fuente
from chunker import Chunker, Document  # estructura → chunks
from hybrid import ChunkRecord  # el esquema del registro en el índice


# ---------------------------------------------------------------------------- interfaces
class Embedder(Protocol):
    model_version: str

    def embed(self, texts: Sequence[str]) -> list[tuple[float, ...]]: ...


class IndexWriter(Protocol):
    def upsert(self, records: Sequence[ChunkRecord]) -> None: ...

    def update_fields(self, chunk_ids: Sequence[str], **changes) -> None: ...

    def delete(self, chunk_ids: Sequence[str]) -> None: ...


@dataclass(frozen=True)
class DocState:
    key: tuple[int, float]  # (version, observed_at) del último evento aplicado
    content_hash: str = ""
    acl_fp: str = ""  # huella de la ACL ("" = sin ACL indexable)
    chunk_ids: tuple[str, ...] = ()
    embed_model: str = ""
    tombstone: bool = False


class StateStore(Protocol):
    def get(self, doc_id: str) -> DocState | None: ...

    def put(self, doc_id: str, state: DocState) -> None: ...


class InMemoryState:
    def __init__(self):
        self.rows: dict[str, DocState] = {}

    def get(self, doc_id: str) -> DocState | None:
        return self.rows.get(doc_id)

    def put(self, doc_id: str, state: DocState) -> None:
        self.rows[doc_id] = state


# ---------------------------------------------------------------------------- eventos y resultados
@dataclass(frozen=True)
class ChangeEvent:
    source: str  # confluence | drive | jira | policies
    doc_id: str
    version: int  # versión monotónica de la fuente (versión de página, `version` de Drive, `updated` de Jira en ms)
    observed_at: float  # epoch s en que el conector LEYÓ el estado: desempata eventos con la misma versión
    deleted: bool = False
    document: Document | None = None  # parseado (None si deleted)
    acl: AclResult | None = None  # normalizada (None si deleted)
    url: str = ""
    updated_at: str = ""  # ISO 8601 de la edición en la fuente (va al prompt)
    changed_at: float | None = None  # epoch s del cambio en la fuente, si la fuente lo da: de aquí sale el lag
    kind: str = "content"  # "content" | "acl": qué detectó el conector (para el lag por tipo)


@dataclass(frozen=True)
class Outcome:
    action: str  # stale | tombstoned | unindexed_no_access | unindexed_acl_too_complex | unchanged |
    #              acl_updated | created | reindexed
    embedded: int = 0  # chunks embebidos en GPU (lo que cuesta)
    kept: int = 0  # chunks que conservaron su vector
    deleted: int = 0  # chunks borrados del índice
    lag_s: float | None = None  # aplicado − cambio en la fuente (o − observado si la fuente no da la hora)


class ModelMismatch(RuntimeError):
    """El documento se embebió con otro modelo: esta ingesta escribe en el índice de OTRO modelo (blue/green)."""


class MassDeletionSuspected(RuntimeError):
    def __init__(self, source: str, deletes: int, docs: int):
        super().__init__(f"{source}: {deletes} borrados de {docs} documentos — frenado hasta que alguien revise")
        self.source, self.deletes, self.docs = source, deletes, docs


# ---------------------------------------------------------------------------- hash del contenido
def content_hash(doc: Document, url: str) -> str:
    """Hash de lo que entra al chunk (título, bloques) y de la URL que se cita. La fecha NO entra: una edición
    que no cambia el texto (el autor guardó sin cambios) no re-embebe nada."""
    payload = json.dumps({"title": doc.title, "url": url,
                          "blocks": [[type(b).__name__, asdict(b)] for b in doc.blocks]},
                         ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------- el aplicador
class Ingestor:
    def __init__(self, chunker: Chunker, embedder: Embedder, index: IndexWriter, state: StateStore,
                 clock: Callable[[], float] = time.time):
        self.chunker, self.embedder, self.index, self.state, self.clock = chunker, embedder, index, state, clock

    def apply(self, ev: ChangeEvent) -> Outcome:
        st = self.state.get(ev.doc_id)
        key = (ev.version, ev.observed_at)
        if st is not None and key <= st.key:
            return Outcome("stale")  # repetido o atrasado: no se toca nada (idempotencia)
        lag = self.clock() - (ev.changed_at if ev.changed_at is not None else ev.observed_at)
        live = st is not None and not st.tombstone

        # -- 2. borrado → tombstone
        if ev.deleted:
            if live:
                self.index.delete(st.chunk_ids)
            self.state.put(ev.doc_id, DocState(key, tombstone=True))
            return Outcome("tombstoned", deleted=len(st.chunk_ids) if live else 0, lag_s=lag)

        if ev.document is None or ev.acl is None:
            raise ValueError("un evento que no es borrado trae documento y ACL")
        if live and st.embed_model and st.embed_model != self.embedder.model_version:
            raise ModelMismatch(f"{ev.doc_id}: {st.embed_model} ≠ {self.embedder.model_version}")

        # -- 3. sin permisos indexables → fuera del índice (cerrado)
        fields = None
        reason = "unindexed_no_access"
        if ev.acl.acl is not None:
            try:
                fields = ev.acl.acl.index_fields()
            except AclTooComplex:
                reason = "unindexed_acl_too_complex"
        if fields is None:
            if live:
                self.index.delete(st.chunk_ids)
            # content_hash vacío: cuando vuelva a tener permisos, se re-chunkea y se re-embebe desde cero
            self.state.put(ev.doc_id, DocState(key))
            return Outcome(reason, deleted=len(st.chunk_ids) if live else 0, lag_s=lag)

        chash = content_hash(ev.document, ev.url)
        fp = ev.acl.acl.fingerprint()
        meta = {"title": ev.document.title, "url": ev.url, "updated_at": ev.updated_at, "source": ev.source}

        # -- 4 y 5. mismo contenido
        if live and st.content_hash == chash and st.chunk_ids:
            if st.acl_fp == fp:
                self.state.put(ev.doc_id, replace(st, key=key))
                return Outcome("unchanged", kept=len(st.chunk_ids), lag_s=lag)
            self.index.update_fields(st.chunk_ids, acl_fields=fields, updated_at=ev.updated_at)
            self.state.put(ev.doc_id, replace(st, key=key, acl_fp=fp))
            return Outcome("acl_updated", kept=len(st.chunk_ids), lag_s=lag)

        # -- 6. contenido nuevo: solo se embebe lo que no existía
        chunks = self.chunker.chunk(ev.document)
        old = set(st.chunk_ids) if live else set()
        new_chunks = [c for c in chunks if c.chunk_id not in old]
        kept_ids = [c.chunk_id for c in chunks if c.chunk_id in old]
        vectors = self.embedder.embed([c.text for c in new_chunks]) if new_chunks else []
        records = [
            ChunkRecord(c.chunk_id, ev.doc_id, ev.source, meta["title"], ev.url, ev.updated_at, c.heading_path,
                        c.text, fields, v, self.embedder.model_version)
            for c, v in zip(new_chunks, vectors, strict=True)
        ]
        self.index.upsert(records)  # primero lo nuevo…
        if kept_ids:
            # los que no cambiaron conservan el vector; la ACL, la fecha o la URL pueden haber cambiado igual
            self.index.update_fields(kept_ids, acl_fields=fields, updated_at=ev.updated_at, url=ev.url)
        gone = sorted(old - {c.chunk_id for c in chunks})
        if gone:
            self.index.delete(gone)  # …después lo que desapareció
        self.state.put(ev.doc_id, DocState(key, chash, fp, tuple(c.chunk_id for c in chunks),
                                           self.embedder.model_version))
        return Outcome("reindexed" if live else "created", embedded=len(new_chunks), kept=len(kept_ids),
                       deleted=len(gone), lag_s=lag)


# ---------------------------------------------------------------------------- freno de borrado masivo
@dataclass
class MassDeletionGuard:
    """Antes de aplicar un lote, cuenta los borrados por fuente. Más de max_fraction → no se aplica NADA del lote
    de esa fuente: se levanta MassDeletionSuspected (métrica rag_ingest_mass_delete_blocked_total)."""

    docs_per_source: dict[str, int]  # documentos vivos por fuente (del estado o del índice)
    max_fraction: float = 0.02  # 2 % ≈ 30k documentos de 1.5 M: el doble de lo que cambia en un día normal
    min_deletes: int = 50  # una fuente chica (las políticas: cientos de docs) no se frena por 5 borrados
    blocked: dict[str, int] = field(default_factory=dict)

    def check(self, events: Sequence[ChangeEvent]) -> None:
        deletes: dict[str, int] = {}
        for e in events:
            if e.deleted:
                deletes[e.source] = deletes.get(e.source, 0) + 1
        for source, n in deletes.items():
            docs = max(1, self.docs_per_source.get(source, 0))
            if n >= self.min_deletes and n / docs > self.max_fraction:
                self.blocked[source] = n
                raise MassDeletionSuspected(source, n, docs)
