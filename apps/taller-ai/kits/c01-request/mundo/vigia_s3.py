"""El vigía de S3: cuándo llegó el último archivo de log de cada nodo (en C01: las métricas de S3 en CloudWatch o un
job chico que lista el prefijo). Lo arranca mundo/nodo.py; publica en :8956/metrics, cada 10 s:

    dojo_s3_ultimo_objeto_timestamp_seconds{prefijo="logs/crudo/", nodo}   hora Unix del último archivo de ese nodo
    dojo_s3_objetos{prefijo="logs/crudo/", nodo}                           archivos de hoy y de ayer (UTC)
    dojo_s3_lectura_ok                                                     1 si pudo listar el bucket; 0 si no

El nodo sale del nombre del archivo (<nodo>-<uuid>.gz, el s3_key_format de Fluent Bit). No es parte de lo que escribes.
"""
from __future__ import annotations

import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from prometheus_client import CollectorRegistry, Gauge, start_http_server

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import CRUDO, objetos  # noqa: E402

REG = CollectorRegistry()
ULTIMO = Gauge("dojo_s3_ultimo_objeto_timestamp_seconds", "Hora Unix del último archivo de log de cada nodo",
               ["prefijo", "nodo"], registry=REG)
CUANTOS = Gauge("dojo_s3_objetos", "Archivos de log de hoy y de ayer (UTC)", ["prefijo", "nodo"], registry=REG)
OK = Gauge("dojo_s3_lectura_ok", "1 si el vigía pudo listar el bucket", registry=REG)


def una_vuelta() -> None:
    hoy = datetime.now(timezone.utc)
    vistos: dict[str, list[float]] = {}
    for d in (hoy - timedelta(days=1), hoy):
        for o in objetos(f"{CRUDO}{d:%Y/%m/%d}/"):
            nodo = o["Key"].rsplit("/", 1)[-1].split("-", 1)[0]
            vistos.setdefault(nodo, []).append(o["LastModified"].timestamp())
    for nodo, ts in vistos.items():
        ULTIMO.labels(CRUDO, nodo).set(max(ts))
        CUANTOS.labels(CRUDO, nodo).set(len(ts))


def main() -> None:
    start_http_server(8956, addr="0.0.0.0", registry=REG)
    while True:
        try:
            una_vuelta()
            OK.set(1)
        except Exception as e:  # noqa: BLE001 — S3 caído: lo último que vio se queda igual, y se nota en lectura_ok
            OK.set(0)
            print(f"vigía: no pude listar S3: {type(e).__name__}", file=sys.stderr, flush=True)
        time.sleep(10)


if __name__ == "__main__":
    main()
