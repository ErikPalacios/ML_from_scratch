"""El job monitoreo-diario, segunda parte: del Parquet de un día a sus señales del modelo y del negocio (solución de
referencia).

    python diario/monitoreo.py                                   # ayer (mundo.comun.ayer()), como el job de la 01:00
    python diario/monitoreo.py --dia 2026-11-18
    python diario/monitoreo.py --desde 2026-10-28 --hasta 2026-11-18   # varios días, del más viejo al más nuevo

Contrato:
- Lee de s3://ml-datos/ (con mundo.comun.descargar, que reusa lo ya bajado) el Parquet de predicciones del día
  (logs/predicciones/dt=AAAA-MM-DD/, todas las versiones) y el de los 28 días anteriores (la referencia del PSI), y los
  eventos del backend del día (eventos/publicaciones/dt=AAAA-MM-DD/). Solo cuentan las filas con status 200.
- Si el día no tiene filas, o falta alguno de los 28 días de referencia, termina con error (código ≠ 0) y no escribe ni
  publica nada: un job que publica un PSI calculado sobre nada es peor que uno que truena.
- Calcula, y escribe en s3://ml-datos/monitoreo/diario/dt=AAAA-MM-DD/resumen.json (lo reemplaza: idempotente):
    dia, filas (con status 200), versiones {model_version: filas},
    psi: el PSI de la categoría predicha (top1) del día contra la de los 28 días anteriores juntos, con las 10
         categorías como bins: suma de (p − q) · ln(p / q); una proporción 0 se cuenta como 0.0001. Redondeado a 4.
    psi_por_categoria: {categoría: su término de la suma}, para saber qué la movió.
    baja_confianza: {total, mobile, web, internal}: la fracción con score < 0.3.
    bytes_mediana: {mobile, web, internal}.
    aceptacion: {slice: {n, aceptadas}} con los slices total, source=mobile, source=web y categoria=<cada una>
         (la categoría que eligió quien vende). n = publicaciones con la sugerencia mostrada y fuera del holdout,
         unidas al log por request_id; aceptadas = las que eligieron por la vía «sugerencia».
    holdout: {n, aciertos}: las publicaciones del holdout (nunca ven sugerencias) y en cuántas el top1 es lo que eligió.
    apps: {versión de la app: publicaciones} (del evento).
- Empuja a la Pushgateway (job="monitoreo-diario", con PUT: reemplaza el grupo) los gauges
  classifier_monitoreo_psi, classifier_monitoreo_baja_confianza{source}, classifier_monitoreo_aceptacion{slice}
  (aceptadas ÷ n) y classifier_monitoreo_dia_timestamp_seconds (a qué día corresponden). La Pushgateway agrega sola
  push_time_seconds: de ahí sale MonitoringJobStale.
- Imprime una línea por día: filas, PSI, baja confianza y aceptación total.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import (BUCKET, EVENTOS, MONITOREO, PREDICCIONES, PUSHGATEWAY, ayer as mundo_ayer, descargar,  # noqa: E402
                         etiquetas, s3)

REFERENCIA_DIAS = 28
UMBRAL_BAJA = 0.3
EPS = 1e-4


def archivos(prefijo: str, c) -> list[str]:
    return [str(p) for p in descargar(prefijo, c) if p.suffix == ".parquet"]


def resumen(d: date, c) -> dict:
    labs = etiquetas()
    hoy_ = archivos(f"{PREDICCIONES}dt={d}/", c)
    if not hoy_:
        raise SystemExit(f"✗ {d}: no hay Parquet en s3://{BUCKET}/{PREDICCIONES}dt={d}/ (¿corrió el job de la estación 11?)")
    ref = []
    for k in range(1, REFERENCIA_DIAS + 1):
        x = archivos(f"{PREDICCIONES}dt={d - timedelta(days=k)}/", c)
        if not x:
            raise SystemExit(f"✗ {d}: falta el día {d - timedelta(days=k)} de la referencia (necesito los {REFERENCIA_DIAS} días anteriores)")
        ref += x
    ev = archivos(f"{EVENTOS}dt={d}/", c)
    con = duckdb.connect()
    con.execute(f"CREATE VIEW p AS SELECT * FROM read_parquet({hoy_!r}) WHERE status = 200")
    filas = con.execute("SELECT count(*) FROM p").fetchall()[0][0]
    if filas == 0:
        raise SystemExit(f"✗ {d}: el día no tiene requests con status 200")
    versiones = dict(con.execute("SELECT model_version, count(*) FROM p GROUP BY 1 ORDER BY 1").fetchall())
    cuenta = dict(con.execute("SELECT top1, count(*) FROM p GROUP BY 1").fetchall())
    cuenta_ref = dict(con.execute(f"SELECT top1, count(*) FROM read_parquet({ref!r}) WHERE status = 200 GROUP BY 1").fetchall())
    n, nr = sum(cuenta.values()), sum(cuenta_ref.values())
    terminos = {}
    for i, lb in enumerate(labs):
        p = max(cuenta.get(i, 0) / n, EPS)
        q = max(cuenta_ref.get(i, 0) / nr, EPS)
        terminos[lb] = (p - q) * math.log(p / q)
    baja = {"total": con.execute(f"SELECT avg((score < {UMBRAL_BAJA})::int) FROM p").fetchall()[0][0]}
    baja.update(con.execute(f"SELECT source, avg((score < {UMBRAL_BAJA})::int) FROM p GROUP BY 1").fetchall())
    byts = dict(con.execute("SELECT source, median(bytes) FROM p GROUP BY 1").fetchall())
    acept, holdout, apps = {}, {"n": 0, "aciertos": 0}, {}
    if ev:
        con.execute(f"CREATE VIEW e AS SELECT * FROM read_parquet({ev!r})")
        con.execute("CREATE VIEW j AS SELECT e.*, p.source, p.top1 FROM e JOIN p USING (request_id)")
        filas_slice = con.execute("""
            SELECT 'total' AS s, count(*), sum((via = 'sugerencia')::int) FROM j WHERE mostrada AND NOT holdout
            UNION ALL SELECT 'source=' || source, count(*), sum((via = 'sugerencia')::int) FROM j
                WHERE mostrada AND NOT holdout GROUP BY source
            UNION ALL SELECT 'cat:' || elegida, count(*), sum((via = 'sugerencia')::int) FROM j
                WHERE mostrada AND NOT holdout GROUP BY elegida""").fetchall()
        for s, nn, k in filas_slice:
            nombre = f"categoria={labs[int(s[4:])]}" if s.startswith("cat:") else s
            acept[nombre] = {"n": int(nn), "aceptadas": int(k or 0)}
        h = con.execute("SELECT count(*), sum((top1 = elegida)::int) FROM j WHERE holdout").fetchall()[0]
        holdout = {"n": int(h[0]), "aciertos": int(h[1] or 0)}
        apps = dict(con.execute("SELECT app, count(*) FROM e GROUP BY 1 ORDER BY 1").fetchall())
    return {"dia": str(d), "filas": int(filas), "versiones": versiones, "psi": round(sum(terminos.values()), 4),
            "psi_por_categoria": {k: round(v, 4) for k, v in terminos.items()},
            "baja_confianza": {k: round(float(v), 4) for k, v in baja.items()},
            "bytes_mediana": {k: float(v) for k, v in byts.items()},
            "aceptacion": dict(sorted(acept.items())), "holdout": holdout, "apps": apps}


def publicar(r: dict) -> None:
    from prometheus_client import CollectorRegistry, Gauge, push_to_gateway

    reg = CollectorRegistry()
    Gauge("classifier_monitoreo_psi", "PSI de las categorías predichas del día contra los 28 anteriores", registry=reg).set(r["psi"])
    g = Gauge("classifier_monitoreo_baja_confianza", "Fracción con score < 0.3 en el día", ["source"], registry=reg)
    for k, v in r["baja_confianza"].items():
        g.labels(k).set(v)
    g = Gauge("classifier_monitoreo_aceptacion", "Aceptación del día (aceptadas ÷ mostradas)", ["slice"], registry=reg)
    for k, v in r["aceptacion"].items():
        g.labels(k).set(v["aceptadas"] / v["n"] if v["n"] else float("nan"))
    dia = datetime.fromisoformat(r["dia"]).replace(tzinfo=timezone.utc).timestamp()
    Gauge("classifier_monitoreo_dia_timestamp_seconds", "El día que describen estos números", registry=reg).set(dia)
    url = os.environ.get("PUSHGATEWAY_URL", PUSHGATEWAY).removeprefix("http://")
    push_to_gateway(url, job="monitoreo-diario", registry=reg)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dia")
    ap.add_argument("--desde")
    ap.add_argument("--hasta")
    a = ap.parse_args()
    ayer = mundo_ayer()
    if a.desde:
        d0, d1 = date.fromisoformat(a.desde), date.fromisoformat(a.hasta) if a.hasta else ayer
    else:
        d0 = d1 = date.fromisoformat(a.dia) if a.dia else ayer
    c = s3()
    d = d0
    while d <= d1:
        r = resumen(d, c)
        c.put_object(Bucket=BUCKET, Key=f"{MONITOREO}dt={d}/resumen.json",
                     Body=json.dumps(r, ensure_ascii=False, indent=1).encode())
        publicar(r)
        t = r["aceptacion"].get("total", {"n": 0, "aceptadas": 0})
        print(f"{d}  filas {r['filas']:>6,}  PSI {r['psi']:.4f}  baja confianza {r['baja_confianza']['total']:.1%}  "
              f"aceptación {t['aceptadas'] / max(t['n'], 1):.1%} (n {t['n']:,})", flush=True)
        d += timedelta(days=1)


if __name__ == "__main__":
    main()
