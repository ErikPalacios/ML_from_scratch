"""Métricas del worker de ingesta (caso c11): lo que leen IngestionLagHigh, ACLSyncStale e IndexDocCountDrop.

El worker (consume la cola de cambios, llama a Ingestor.apply y expone /metrics) no está en estos archivos; esto es
lo que publica. Labels: fuente, acción y tipo de cambio. NUNCA doc_id ni usuario: 1.5 M documentos como label
serían 1.5 M series en Prometheus.
"""

from __future__ import annotations  # anotaciones como texto

from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram  # cliente oficial

from incremental import Outcome  # lo que devuelve Ingestor.apply

# Bordes del histograma de lag: 300 s (revocaciones, ≤ 5 min) y 900 s (ediciones, p95 ≤ 15 min) son bordes EXACTOS,
# así histogram_quantile no interpola alrededor del umbral de la alerta.
LAG_BUCKETS = (5, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600)


class IngestMetrics:
    def __init__(self, registry: CollectorRegistry):
        self.events = Counter("rag_ingest_events_total", "Eventos de cambio aplicados, por fuente y acción",
                              ["source", "action"], registry=registry)
        self.lag = Histogram("rag_ingest_lag_seconds",
                             "Desde el cambio en la fuente (o desde que se observó) hasta aplicado en el índice",
                             ["source", "kind"], buckets=LAG_BUCKETS, registry=registry)
        self.embedded = Counter("rag_ingest_chunks_embedded_total", "Chunks embebidos (costo de GPU)", ["source"],
                                registry=registry)
        self.documents = Gauge("rag_index_documents", "Documentos vivos en el índice, por fuente", ["source"],
                               registry=registry)
        self.acl_sync = Gauge("rag_acl_sync_last_success_timestamp_seconds",
                              "Último barrido de ACLs exitoso por fuente (epoch s)", ["source"], registry=registry)
        self.mass_delete = Counter("rag_ingest_mass_delete_blocked_total",
                                   "Lotes frenados por borrado masivo sospechoso", ["source"], registry=registry)

    def observe(self, source: str, kind: str, outcome: Outcome) -> None:
        self.events.labels(source, outcome.action).inc()
        if outcome.action != "stale" and outcome.lag_s is not None:
            # Un evento repetido no "tarda": su lag no se cuenta (inflaría el p95 con cada replay)
            self.lag.labels(source, kind).observe(max(0.0, outcome.lag_s))
        if outcome.embedded:
            self.embedded.labels(source).inc(outcome.embedded)
