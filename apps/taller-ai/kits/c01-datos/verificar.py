"""Revisa los criterios de «listo» de la estación, uno por check. Solo lee: no cambia nada.

    python verificar.py                 # todos
    python verificar.py senales debil   # algunos

Usa la verdad del simulador (data/.mundo) para medir lo que en una empresa real medirías con auditorías:
por ejemplo, cuántos labels débiles están mal.
"""
from __future__ import annotations

import hashlib
import io
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mundo.comun import CLASES, DATA, OCULTO, PARES_AMBIGUOS, RAIZ, config, s3  # noqa: E402

SAL, ETQ = DATA / "pipeline", DATA / "etiquetado"
MAX_CONTAMINACION = 0.03


class Falla(Exception):
    pass


def leer(p: Path) -> pd.DataFrame:
    if not p.exists():
        raise Falla(f"no existe {p.relative_to(RAIZ)}")
    return pd.read_parquet(p)


def exige(cond: bool, msg: str) -> None:
    if not cond:
        raise Falla(msg)


def verdad() -> pd.DataFrame:
    return pd.read_parquet(OCULTO / "verdad.parquet")


def ultima_correccion() -> pd.DataFrame:
    c = pd.read_parquet(DATA / "producto" / "correcciones.parquet")
    return c.sort_values("ts_correccion").groupby("request_id").tail(1)


def anonimo(url: str) -> int:
    try:
        return urllib.request.urlopen(url, timeout=5).status
    except urllib.error.HTTPError as e:
        return e.code


# ---------------------------------------------------------------- checks
def check_mundo() -> str:
    c = config()
    try:
        urllib.request.urlopen(c["s3"]["endpoint"] + "/health", timeout=5)
    except Exception:
        raise Falla(f"el S3 local no responde en {c['s3']['endpoint']}: ¿corriste docker compose up -d?")
    try:
        urllib.request.urlopen("http://localhost:8090/health", timeout=5)
    except Exception:
        raise Falla("Label Studio no responde en http://localhost:8090: ¿corriste docker compose up -d?")
    for p in ["producto/publicaciones.parquet", "producto/correcciones.parquet", "golden/manifest.parquet"]:
        exige((DATA / p).exists(), f"falta data/{p}: corre python mundo/simular.py")
    exige(s3().list_objects_v2(Bucket="producto-fotos", MaxKeys=1).get("KeyCount", 0) > 0, "s3://producto-fotos está vacío")
    return "S3, Label Studio y los datos del mundo están arriba"


def check_senales() -> str:
    s = leer(SAL / "senales.parquet")
    n_pub = len(pd.read_parquet(DATA / "producto" / "publicaciones.parquet"))
    faltan = {"request_id", "top1", "top1_score", "margen", "categoria_final", "eleccion", "categoria_corregida", "ts_publicacion"} - set(s.columns)
    exige(not faltan, f"a senales.parquet le faltan columnas: {sorted(faltan)}")
    exige(s.request_id.is_unique, f"hay request_id repetidos ({s.request_id.duplicated().sum()}): el join multiplicó filas")
    exige(len(s) == n_pub, f"se unieron {len(s):,} de {n_pub:,} publicaciones ({len(s) / n_pub:.1%})")
    u = ultima_correccion().set_index("request_id").categoria_corregida
    m = s.set_index("request_id").categoria_corregida.reindex(u.index)
    malas = (m != u).sum()
    exige(malas == 0, f"{malas} requests no tienen su corrección más reciente")
    return f"{len(s):,} requests, una fila cada uno, con la última corrección"


def check_debil() -> str:
    c = config()
    d = leer(SAL / "labels_debiles.parquet")
    exige(set(d.fuente) <= {"correccion", "busqueda", "sugerencia_madura"}, f"fuentes desconocidas: {set(d.fuente)}")
    exige(leer(SAL / "holdout.parquet").shape[0] > 0, "holdout.parquet está vacío")
    # El oráculo: las mismas reglas, con las horas reales (UTC) que guarda el simulador.
    v = verdad()
    p = pd.read_parquet(DATA / "producto" / "publicaciones.parquet")[["request_id", "categoria_final", "eleccion"]]
    o = v.merge(p, on="request_id").merge(ultima_correccion()[["request_id", "categoria_corregida"]], on="request_id", how="left")
    corte = pd.Timestamp(c["corte"])
    madura = o.ts_publicacion <= corte - pd.Timedelta(days=c["debil"]["dias_maduracion"])
    if c["debil"]["excluir_sugerencias_desde"]:
        madura &= o.ts_publicacion < pd.Timestamp(c["debil"]["excluir_sugerencias_desde"])
    corr = o.categoria_corregida.notna()
    ok = (o.eleccion != "manual") & (corr | (o.eleccion == "busqueda") | (o.eleccion.str.startswith("sugerencia") & madura))
    o = o[ok]
    esperado = set(o.request_id)
    tuyo = set(d.request_id.str.lower())
    sobran, faltan = len(tuyo - esperado), len(esperado - tuyo)
    exige(not (sobran or faltan), f"{sobran} labels de más y {faltan} de menos contra las reglas de la estación")
    mal = d.assign(request_id=d.request_id.str.lower()).merge(v, on="request_id")
    tasa = float((mal.label != mal.clase_real).mean())
    exige(tasa <= MAX_CONTAMINACION,
          f"auditoría: el {tasa:.1%} de los labels débiles está mal (máximo {MAX_CONTAMINACION:.0%}); "
          f"por fuente: {mal.groupby('fuente').apply(lambda g: round(float((g.label != g.clase_real).mean()), 3)).to_dict()}")
    return f"{len(d):,} labels débiles, {tasa:.1%} mal según la auditoría"


def check_cola_mezcla() -> str:
    k = config()["cola"]
    q = leer(SAL / "cola.parquet")
    s = leer(SAL / "senales.parquet")
    exige(q.request_id.is_unique, "hay request_id repetidos en la cola")
    exige(abs(len(q) - k["tamano"]) <= k["tamano"] * 0.01, f"la cola tiene {len(q)} (se pidieron {k['tamano']})")
    exige(set(q.motivo) <= {"nueva", "desacuerdo", "incertidumbre", "aleatoria"}, f"motivos desconocidos: {set(q.motivo)}")
    exige(q.request_id.isin(s.request_id).all(), "hay ids en la cola que no están en senales")
    manual = set(s.request_id[s.eleccion == "manual"])
    exige(not (set(q.request_id) & manual), "la cola trae requests del holdout: el holdout no se etiqueta ni se toca")
    al = float((q.motivo == "aleatoria").mean())
    exige(0.20 <= al <= 0.30, f"la parte aleatoria de la cola es {al:.0%} (criterio de la estación: 20–30 %)")
    return " · ".join(f"{m} {n}" for m, n in q.motivo.value_counts().items())


def check_cola_nuevas() -> str:
    c = config()
    q = leer(SAL / "cola.parquet")
    v = verdad().set_index("request_id").clase_real
    nuevas = c["nuevas"]["clases"]
    disponibles = int(v.isin(nuevas).sum())
    cupo = min(round(c["cola"]["tamano"] * c["cola"]["frac_nuevas"]), disponibles)
    n = q[q.motivo == "nueva"]
    reales = int(v.reindex(n.request_id.str.lower()).isin(nuevas).sum())
    exige(reales >= 0.9 * cupo,
          f"la cola trae {reales} ejemplos reales de categorías nuevas ({', '.join(CLASES[i] for i in nuevas)}); el cupo es {cupo}")
    exige(len(n) == 0 or reales / len(n) >= 0.8, f"solo {reales} de {len(n)} marcados como «nueva» lo son de verdad")
    return f"{reales} ejemplos de {', '.join(CLASES[i] for i in nuevas)} (cupo {cupo})"


def check_copia_exif() -> str:
    from PIL import Image

    c = config()["s3"]
    q = leer(SAL / "cola.parquet")
    cli = s3()
    try:
        objs = {o["Key"] for p in cli.get_paginator("list_objects_v2").paginate(Bucket=c["bucket_restringido"], Prefix="cola/")
                for o in p.get("Contents", [])}
    except cli.exceptions.NoSuchBucket:
        raise Falla(f"no existe el bucket {c['bucket_restringido']}")
    esperadas = {f"cola/{r}.jpg" for r in q.request_id}
    exige(objs == esperadas, f"el bucket tiene {len(objs - esperadas)} fotos de más y le faltan {len(esperadas - objs)}")
    con_exif = []
    for k in sorted(objs):
        im = Image.open(io.BytesIO(cli.get_object(Bucket=c["bucket_restringido"], Key=k)["Body"].read()))
        if len(im.getexif()) or "exif" in im.info:
            con_exif.append(k)
    exige(not con_exif, f"{len(con_exif)} fotos del bucket restringido todavía traen EXIF (ej.: {con_exif[0]})" if con_exif else "")
    return f"{len(objs)} fotos, todas sin metadatos"


def check_bucket_seguro() -> str:
    c = config()["s3"]
    B = c["bucket_restringido"]
    cli = s3()
    try:
        pab = cli.get_public_access_block(Bucket=B)["PublicAccessBlockConfiguration"]
    except Exception:
        pab = {}
    exige(pab and all(pab.values()), f"el bloqueo de acceso público de {B} no está completo: {pab or 'no existe'}")
    try:
        pol = json.loads(cli.get_bucket_policy(Bucket=B)["Policy"])
        publica = any(st.get("Effect") == "Allow" and st.get("Principal") in ("*", {"AWS": "*"}, {"AWS": ["*"]})
                      for st in pol.get("Statement", []))
        exige(not publica, f"{B} tiene una política que permite leer a cualquiera (Principal: *)")
    except Falla:
        raise
    except Exception:
        pass   # sin política: bien
    try:
        reglas = cli.get_bucket_lifecycle_configuration(Bucket=B)["Rules"]
    except Exception:
        reglas = []
    exige(any(r.get("Status") == "Enabled" and r.get("Expiration", {}).get("Days") == c["dias_vencimiento"] for r in reglas),
          f"{B} no tiene una regla de vencimiento activa de {c['dias_vencimiento']} días")
    una = cli.list_objects_v2(Bucket=B, Prefix="cola/", MaxKeys=1).get("Contents", [])
    if una:
        codigo = anonimo(f"{c['endpoint']}/{B}/{una[0]['Key']}")
        exige(codigo == 403, f"una foto del bucket se puede bajar sin credenciales (HTTP {codigo})")
    return "privado, sin acceso público y con vencimiento de " + str(c["dias_vencimiento"]) + " días"


def check_guia() -> str:
    v = config()["etiquetado"]["guia_version"]
    p = RAIZ / "guia" / f"{v}.md"
    exige(p.exists(), f"no existe guia/{v}.md")
    t = p.read_text().lower()
    sin_def = [c for c in CLASES if not re.search(rf"^##\s+{c}\s*$", t, re.M)]
    sin_regla = [par for par in PARES_AMBIGUOS if not re.search(rf"regla:\s*{par}\b", t)]
    exige(not sin_def, f"{v} no define: {', '.join(sin_def)}")
    exige(not sin_regla, f"{v} no trae regla para: {', '.join(sin_regla)}")
    return f"{v}: las {len(CLASES)} categorías y los {len(PARES_AMBIGUOS)} casos límite"


def check_acuerdo() -> str:
    from sklearn.metrics import cohen_kappa_score

    a = leer(ETQ / "anotaciones.parquet")
    kp = ETQ / "kappa.json"
    exige(kp.exists(), "no existe data/etiquetado/kappa.json")
    k = json.loads(kp.read_text())
    d = a.pivot(index="request_id", columns="anotador", values="clase").dropna().astype(int)
    exige(len(d) > 0, "no hay tareas con doble anotación")
    bajas = []
    for i, c in enumerate(CLASES):
        pos = int(((d.A == i) | (d.B == i)).sum())
        real = cohen_kappa_score(d.A == i, d.B == i) if pos else np.nan
        tuyo = (k.get("kappa_por_clase") or {}).get(c)
        if not np.isnan(real):
            exige(tuyo is not None and abs(tuyo - real) < 0.01, f"kappa.json dice {tuyo} para {c}; con las anotaciones da {real:.3f}")
            if pos >= 10 and real < 0.6:
                bajas.append(f"{c} {real:.2f}")
    exige(not bajas, f"acuerdo bajo (kappa < 0.6) en: {', '.join(bajas)} · guía usada: {a.guia_version.iloc[0]}")
    return f"kappa global {k.get('kappa')} con {len(d)} dobles · guía {a.guia_version.iloc[0]}"


def check_labels_mes() -> str:
    l = leer(SAL / "labels_mes.parquet")
    t = leer(ETQ / "tareas-proveedor.parquet")
    comunes = len(set(l.request_id) & set(t.request_id))
    exige(l.request_id.is_unique and comunes == len(l) == len(t),
          f"labels_mes no corresponde a las tareas actuales: coinciden {comunes} de {len(t)}")
    exige(l.label.between(0, len(CLASES) - 1).all(), "hay labels fuera de rango")
    for p in [ETQ / "anotaciones.parquet", ETQ / "adjudicacion-export.json"]:
        exige(not p.exists() or (SAL / "labels_mes.parquet").stat().st_mtime >= p.stat().st_mtime,
              f"labels_mes.parquet es más viejo que {p.name}: el paso 7 no terminó con los datos actuales")
    a = pd.read_parquet(ETQ / "anotaciones.parquet").pivot(index="request_id", columns="anotador", values="clase")
    n_des = int((a.B.notna() & (a.A != a.B)).sum())
    exige(int((l.fuente == "adjudicado").sum()) == n_des, f"hay {n_des} desacuerdos y {int((l.fuente == 'adjudicado').sum())} adjudicados")
    exige("guia_version" in l.columns, "a labels_mes le falta guia_version")
    return f"{len(l)} labels ({n_des} adjudicados) con {l.guia_version.iloc[0]}"


def check_golden() -> str:
    m = DATA / "golden" / "manifest.parquet"
    exige(hashlib.sha256(m.read_bytes()).hexdigest() == (OCULTO / "golden.sha256").read_text(),
          "el manifest del golden set cambió: el golden está congelado")
    g = set(pd.read_parquet(m).img_sha256.str[:16])
    for p in [SAL / "cola.parquet", SAL / "labels_mes.parquet"]:
        if p.exists():
            fuga = set(pd.read_parquet(p).img_sha256_prefijo) & g
            exige(not fuga, f"{len(fuga)} imágenes del golden set están en {p.name}")
    return f"{len(g)} imágenes congeladas, ninguna en la cola ni en los labels del mes"


def check_reporte() -> str:
    p = SAL / "reporte.json"
    exige(p.exists(), "no existe data/pipeline/reporte.json")
    exige(p.stat().st_mtime >= (SAL / "labels_mes.parquet").stat().st_mtime, "reporte.json es más viejo que labels_mes")
    r = json.loads(p.read_text())["exactitud"]
    s = pd.read_parquet(SAL / "senales.parquet")[["request_id", "top1"]]
    h = pd.read_parquet(SAL / "holdout.parquet").merge(s)
    real = round(float((h.top1 == h.label).mean()), 3)
    exige(abs(r.get("vs_holdout", -1) - real) < 0.002, f"vs_holdout dice {r.get('vs_holdout')}; con los datos da {real}")
    for k in ["vs_labels_debiles", "vs_labels_mes", "vs_golden"]:
        exige(k in r, f"al reporte le falta {k}")
    return f"holdout {r['vs_holdout']} · golden {r['vs_golden']} · labels del mes {r['vs_labels_mes']}"


CHECKS = {
    "mundo": check_mundo, "senales": check_senales, "debil": check_debil, "cola-mezcla": check_cola_mezcla,
    "cola-nuevas": check_cola_nuevas, "copia-exif": check_copia_exif, "bucket-seguro": check_bucket_seguro,
    "guia": check_guia, "acuerdo": check_acuerdo, "labels-mes": check_labels_mes, "golden": check_golden,
    "reporte": check_reporte,
}


def correr(ids: list[str], silencio: bool = False) -> dict[str, tuple[bool, str]]:
    out = {}
    for i in ids:
        try:
            ok, msg = True, CHECKS[i]()
        except Falla as e:
            ok, msg = False, str(e)
        except Exception as e:  # un error inesperado también es un check que no pasa
            ok, msg = False, f"{type(e).__name__}: {e}"
        out[i] = (ok, msg)
        if not silencio:
            print(f"{'✓' if ok else '✗'} {i:<14} {msg}")
    return out


if __name__ == "__main__":
    pedidos = sys.argv[1:] or list(CHECKS)
    desconocidos = [p for p in pedidos if p not in CHECKS]
    if desconocidos:
        sys.exit(f"checks desconocidos: {desconocidos}. Hay: {', '.join(CHECKS)}")
    r = correr(pedidos)
    malos = [k for k, (ok, _) in r.items() if not ok]
    print(f"\n{len(r) - len(malos)}/{len(r)} en verde" + (f" · falta: {', '.join(malos)}" if malos else ""))
    sys.exit(1 if malos else 0)
