"""Las muestras para etiquetar: la cola del mes y las tandas extra que pidió una persona (solución de referencia). Con
esto el ciclo vuelve a la estación 1.

    python diario/muestras.py              # la cola del mes que viene, desde los últimos 30 días (hasta ayer)

Contrato:
- Lee el Parquet de predicciones de los últimos 30 días (logs/predicciones/, hasta ayer): solo status 200 y solo la
  versión que atiende hoy (la de las filas de ayer; si ayer hubo dos, la más nueva). Une los eventos del backend
  (eventos/publicaciones/) por request_id para saber la categoría que eligió quien vende.
- Quita las fotos del examen fijo (la lista está en S3, en la ruta que dice mundo.comun.examen(), de plataforma.yaml:
  sha256 completos; el log guarda los primeros 12 caracteres): una foto del examen que entra al entrenamiento deja de medir. Y quita las repetidas por
  sha256 (la misma foto subida otra vez): se queda la primera.
- La cola del mes, 500 fotos:
  · 300 por incertidumbre: las de score más bajo (las mismas que cuenta la baja confianza).
  · 200 al azar entre las que quedan (semilla: el mes de la cola), para no ver solo lo que el modelo ya sabe que duda.
- Más una tanda extra de 100 fotos al azar (de los últimos 7 días, sin repetir las de arriba) por cada slice de un
  ticket que una persona decidió con «reentrenar» o «etiquetar» (GET http://localhost:8966/api/tickets: campo
  decision.accion; el slice es el del ticket, p. ej. categoria=abrigos = las que quien vende eligió como abrigos;
  source=mobile = las de esa fuente). Un slice repetido en dos tickets da una sola tanda.
- Escribe s3://ml-datos/etiquetado/cola-AAAA-MM/tareas.json (AAAA-MM = el mes que viene; lo reemplaza: idempotente):
  una lista de tareas en el formato de importación de Label Studio, [{"data": {"image", "request_id", "sha256",
  "motivo", "score", "top1"}}], con image = s3://publicaciones/fotos/<sha256>.jpg y motivo = incertidumbre | azar |
  extra:<slice>. Imprime cuántas hay por motivo.
"""
from __future__ import annotations

import json
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import duckdb
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import (BUCKET, BUSCAPERSONAS, ETIQUETADO, EVENTOS, PREDICCIONES, ayer as mundo_ayer, descargar,  # noqa: E402
                         etiquetas, examen, http, s3)

DIAS, POR_INCERTIDUMBRE, AL_AZAR, EXTRA, DIAS_EXTRA = 30, 300, 200, 100, 7


def main() -> None:
    labs = etiquetas()
    c = s3()
    ayer = mundo_ayer()
    mes = (ayer.replace(day=1) + timedelta(days=32)).strftime("%Y-%m")
    dias = [ayer - timedelta(days=k) for k in range(DIAS)]
    pr = [str(p) for d in dias for p in descargar(f"{PREDICCIONES}dt={d}/", c) if p.suffix == ".parquet"]
    ev = [str(p) for d in dias for p in descargar(f"{EVENTOS}dt={d}/", c) if p.suffix == ".parquet"]
    golden = {g.strip()[:12] for g in c.get_object(Bucket=BUCKET, Key=examen())["Body"].read().decode().split()}
    con = duckdb.connect()
    version = con.execute(f"SELECT max(model_version) FROM read_parquet({pr!r}) WHERE CAST(hora AS DATE) = DATE '{ayer}'").fetchall()[0][0]
    con.register("golden", {"sha": np.array(sorted(golden))})
    con.execute(f"""
        CREATE TABLE f AS
        SELECT p.request_id, p.sha256, p.score, p.top1, p.source, CAST(p.hora AS DATE) AS dia, e.elegida
        FROM read_parquet({pr!r}) p LEFT JOIN read_parquet({ev!r}) e USING (request_id)
        WHERE p.status = 200 AND p.model_version = '{version}' AND p.sha256 NOT IN (SELECT sha FROM golden)
        QUALIFY row_number() OVER (PARTITION BY p.sha256 ORDER BY p.hora) = 1""")
    sacar = ["request_id", "sha256", "score", "top1"]
    elegidas: list[tuple] = []
    usados: set[str] = set()

    def tomar(filas, motivo):
        for r in filas:
            if r[0] not in usados:
                usados.add(r[0])
                elegidas.append((*r, motivo))

    cols = ", ".join(sacar)
    tomar(con.execute(f"SELECT {cols} FROM f ORDER BY score, request_id LIMIT {POR_INCERTIDUMBRE}").fetchall(), "incertidumbre")
    resto = con.execute(f"SELECT {cols} FROM f ORDER BY request_id").fetchall()
    rng = random.Random(mes)
    tomar(rng.sample([r for r in resto if r[0] not in usados], AL_AZAR), "azar")
    st, b, _ = http(f"{BUSCAPERSONAS}/api/tickets")
    tickets = json.loads(b) if st == 200 else []
    slices = sorted({t["slice"] for t in tickets
                     if t.get("slice") and (t.get("decision") or {}).get("accion") in ("reentrenar", "etiquetar")})
    desde = ayer - timedelta(days=DIAS_EXTRA - 1)
    for s in slices:
        campo, valor = s.split("=", 1)
        cond = f"elegida = {labs.index(valor)}" if campo == "categoria" else f"source = '{valor}'"
        filas = con.execute(f"SELECT {cols} FROM f WHERE {cond} AND dia >= DATE '{desde}' ORDER BY request_id").fetchall()
        filas = [r for r in filas if r[0] not in usados]
        tomar(rng.sample(filas, min(EXTRA, len(filas))), f"extra:{s}")
    tareas = [{"data": {"image": f"s3://publicaciones/fotos/{sha}.jpg", "request_id": rid, "sha256": sha,
                        "motivo": motivo, "score": round(float(score), 4), "top1": labs[int(top1)]}}
              for rid, sha, score, top1, motivo in elegidas]
    c.put_object(Bucket=BUCKET, Key=f"{ETIQUETADO}cola-{mes}/tareas.json",
                 Body=json.dumps(tareas, ensure_ascii=False, indent=1).encode())
    cuenta: dict[str, int] = {}
    for t in tareas:
        cuenta[t["data"]["motivo"]] = cuenta.get(t["data"]["motivo"], 0) + 1
    print(f"✓ s3://{BUCKET}/{ETIQUETADO}cola-{mes}/tareas.json: {len(tareas)} fotos de {version} "
          f"({con.execute('SELECT count(*) FROM f').fetchall()[0][0]:,} candidatas sin examen ni repetidas) · "
          + " · ".join(f"{k} {v}" for k, v in cuenta.items()))


if __name__ == "__main__":
    main()
