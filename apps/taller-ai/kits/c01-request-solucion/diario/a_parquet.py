"""El job monitoreo-diario, primera parte: del log crudo de un día a Parquet (solución de referencia).

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

import argparse
import gzip
import json
import sys
import tempfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import BUCKET, CRUDO, PREDICCIONES, objetos, s3  # noqa: E402

COLUMNAS = {"hora": "TIMESTAMP", "nodo": "VARCHAR", "request_id": "VARCHAR", "caller": "VARCHAR", "source": "VARCHAR",
            "model_version": "VARCHAR", "status": "INTEGER", "top1": "INTEGER", "score": "DOUBLE", "ms_pre": "DOUBLE",
            "ms_triton": "DOUBLE", "ms_post": "DOUBLE", "ms_total": "DOUBLE", "bytes": "BIGINT", "sha256": "VARCHAR",
            "error": "VARCHAR"}


def fila(reg: dict) -> dict | None:
    if reg.get("stream") != "stdout":
        return None
    try:
        ev = json.loads(reg.get("log", ""))
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(ev, dict) or "request_id" not in ev:
        return None
    ms, top5 = ev.get("ms") or {}, ev.get("top5") or []
    return {"hora": reg["time"], "nodo": reg.get("nodo"), "request_id": ev["request_id"], "caller": ev.get("caller"),
            "source": ev.get("source"), "model_version": ev.get("model_version"), "status": ev.get("status"),
            "top1": top5[0][0] if top5 else None, "score": top5[0][1] if top5 else None,
            "ms_pre": ms.get("pre"), "ms_triton": ms.get("triton"), "ms_post": ms.get("post"), "ms_total": ms.get("total"),
            "bytes": ev.get("bytes"), "sha256": ev.get("sha256"), "error": ev.get("error")}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dia", type=date.fromisoformat,
                    default=(datetime.now(timezone.utc) - timedelta(days=1)).date())
    dia = ap.parse_args().dia
    c = s3()
    # un archivo subido a las 00:00:40 trae líneas de las 23:59: también se lee la primera hora del día siguiente
    objs = objetos(f"{CRUDO}{dia:%Y/%m/%d}/") + objetos(f"{CRUDO}{dia + timedelta(days=1):%Y/%m/%d}/00/")
    vistos, filas, leidos, repetidos, ignorados = set(), [], 0, 0, 0
    for o in objs:
        texto = gzip.decompress(c.get_object(Bucket=BUCKET, Key=o["Key"])["Body"].read()).decode("utf-8", "replace")
        for linea in texto.splitlines():
            leidos += 1
            try:
                f = fila(json.loads(linea))
            except json.JSONDecodeError:
                f = None
            if f is None or not f["hora"].startswith(dia.isoformat()):
                ignorados += 1
                continue
            llave = (f["request_id"], f["hora"])
            if llave in vistos:
                repetidos += 1
                continue
            vistos.add(llave)
            filas.append(f)
    prefijo = f"{PREDICCIONES}dt={dia.isoformat()}/"
    for o in objetos(prefijo):
        c.delete_object(Bucket=BUCKET, Key=o["Key"])
    por_version: dict[str, int] = {}
    with tempfile.TemporaryDirectory() as tmp:
        ndjson = Path(tmp) / "filas.json"
        ndjson.write_text("".join(json.dumps(f) + "\n" for f in filas))
        con = duckdb.connect()
        cols = ", ".join(f"'{k}': '{v}'" for k, v in COLUMNAS.items())
        con.execute(f"CREATE TABLE t AS SELECT * FROM read_json('{ndjson}', format='newline_delimited', columns={{{cols}}})"
                    if filas else "CREATE TABLE t AS SELECT 1 WHERE false")
        for (v,) in con.execute("SELECT DISTINCT model_version FROM t ORDER BY 1").fetchall() if filas else []:
            destino = Path(tmp) / f"{v}.parquet"
            con.execute(f"COPY (SELECT * FROM t WHERE model_version = ? ORDER BY hora) TO '{destino}' (FORMAT parquet)", [v])
            c.upload_file(str(destino), BUCKET, f"{prefijo}model_version={v}/parte-0.parquet")
            por_version[v] = con.execute("SELECT count(*) FROM t WHERE model_version = ?", [v]).fetchone()[0]
    print(f"{dia}: {len(objs)} objetos · {leidos:,} registros · {repetidos:,} repetidos · {ignorados:,} ignorados")
    for v, n in por_version.items():
        print(f"  {prefijo}model_version={v}/parte-0.parquet  {n:,} filas")
    print(f"total: {sum(por_version.values()):,} filas")


if __name__ == "__main__":
    main()
