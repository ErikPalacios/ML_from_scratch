"""El job monitoreo-diario, primera parte: del log crudo de un día a Parquet. LO ESCRIBES TÚ (paso 8).

    python diario/a_parquet.py                  # ayer (UTC), como el job de la 01:00
    python diario/a_parquet.py --dia 2026-11-18

Contrato:
- Lee todos los objetos de s3://ml-datos/logs/crudo/AAAA/MM/DD/ (las 24 carpetas de hora) del día, en UTC, y los de
  la hora 00 del día siguiente (un archivo subido a las 00:00:40 trae líneas de las 23:59). Cada uno es un .gz con una línea JSON por registro de Fluent Bit: time (la hora del runtime), stream, _p, log (el texto que
  escribió el gateway) y nodo.
- Se queda con las de stdout cuyo log es un JSON con request_id; las demás (stderr, texto suelto) son «ignoradas».
- Fluent Bit entrega al menos una vez: si sube un archivo dos veces, hay registros repetidos. Se quitan los repetidos
  por (request_id, time).
- Una fila por request, con hora (timestamp UTC), nodo, request_id, caller, source, model_version, status, top1 y score
  (la primera sugerencia, o nulos), ms_pre, ms_triton, ms_post, ms_total, bytes, sha256 y error. Solo las de ese día.
- Escribe s3://ml-datos/logs/predicciones/dt=AAAA-MM-DD/model_version=<v>/parte-0.parquet, una carpeta por versión,
  después de borrar lo que hubiera en dt=AAAA-MM-DD/: correrlo dos veces da lo mismo (idempotente).
- Imprime cuántos objetos y registros leyó, cuántos repetidos e ignorados quitó y cuántas filas quedaron por versión.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import BUCKET, CRUDO, PREDICCIONES, objetos, s3  # noqa: E402,F401  — lo que da el mundo para S3


def main() -> None:
    sys.exit("diario/a_parquet.py: todavía no está escrito (paso 8)")


if __name__ == "__main__":
    main()
