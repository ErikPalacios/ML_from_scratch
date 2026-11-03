"""El mundo: un marketplace ficticio que lleva 60 días con el clasificador de categorías en producción.

    python mundo/simular.py            # genera todo (≈ 2–4 min la primera vez: descarga Fashion-MNIST y entrena)

Qué deja (lo que en C01 real existe antes de esta estación):
  data/logs/fecha=AAAA-MM-DD/part-0.parquet   una fila por request del gateway (top-k con scores, hash de la imagen)
  data/producto/publicaciones.parquet          la categoría que eligió quien vende y cómo la eligió
  data/producto/correcciones.parquet           las correcciones de moderación (puede haber varias por request)
  data/golden/manifest.parquet                 el golden set congelado (50 por categoría), solo para evaluar
  s3://producto-fotos/fotos/…                  la foto de cada publicación, con EXIF (incluye GPS)
  s3://golden-set/…                            las fotos del golden set

romper.py vuelve a llamar a este script con fallas (`--falla`). Tu pipeline nunca lo modifica.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import shutil
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
from PIL import Image

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import CLASES, DATA, NUEVA, OCULTO, config, s3  # noqa: E402

SEMILLA = 7
INICIO = datetime(2026, 9, 1, tzinfo=timezone.utc)
DIAS = 60
POR_DIA = 400
DIA_NUEVA = 30            # «negocio» agrega Bolsas al árbol el 1 de octubre
DIA_PRESELECCION = 15     # falla feedback-loop: la sugerencia empieza a venir preseleccionada
CUENTAS = 2000
HOLDOUT = 20              # 1 % de las cuentas: solo ven el selector manual, sin sugerencias
MODEL_VERSION = "clf-2026-08-25"
LOCAL = ZoneInfo("America/Mexico_City")

URL = "https://github.com/zalandoresearch/fashion-mnist/raw/master/data/fashion/{}.gz"
ARCHIVOS = ["train-images-idx3-ubyte", "train-labels-idx1-ubyte", "t10k-images-idx3-ubyte", "t10k-labels-idx1-ubyte"]

TITULOS = {
    0: ["Playera básica", "Blusa de algodón", "Top casual", "Playera estampada"],
    1: ["Pantalón de mezclilla", "Pantalón formal", "Jeans rectos", "Pants deportivo"],
    2: ["Suéter tejido", "Sudadera sin capucha", "Jersey de lana", "Suéter cuello redondo"],
    3: ["Vestido de verano", "Vestido largo", "Vestido de fiesta", "Vestido casual"],
    4: ["Abrigo largo", "Chamarra de invierno", "Gabardina", "Abrigo de paño"],
    5: ["Sandalias de piso", "Huaraches", "Sandalias con plataforma", "Chanclas de piel"],
    6: ["Camisa de vestir", "Camisa a cuadros", "Camisa manga larga", "Camisa de lino"],
    7: ["Tenis para correr", "Tenis blancos", "Sneakers urbanos", "Tenis deportivos"],
    8: ["Bolsa de mano", "Bolso de piel", "Mochila pequeña", "Bolsa tote"],
    9: ["Botines de piel", "Botas al tobillo", "Botines con tacón", "Botas chelsea"],
}
ADJ = ["negro", "azul", "nuevo", "seminuevo", "talla M", "original", "de marca", "en oferta"]
CIUDADES = [(19.43, -99.13), (20.67, -103.35), (25.69, -100.32), (21.16, -86.85), (19.04, -98.20)]


# ---------------------------------------------------------------- datos y modelo
def fashion_mnist() -> tuple[np.ndarray, np.ndarray]:
    cache = OCULTO / "fmnist"
    cache.mkdir(parents=True, exist_ok=True)
    for a in ARCHIVOS:
        p = cache / f"{a}.gz"
        if not p.exists():
            print(f"  descargando {a}…")
            with urllib.request.urlopen(URL.format(a), timeout=60) as r, open(p, "wb") as f:
                shutil.copyfileobj(r, f)
    leer = lambda a, off: np.frombuffer(gzip.open(cache / f"{a}.gz").read(), np.uint8, offset=off)  # noqa: E731
    X = np.concatenate([leer(ARCHIVOS[0], 16), leer(ARCHIVOS[2], 16)]).reshape(-1, 28, 28)
    y = np.concatenate([leer(ARCHIVOS[1], 8), leer(ARCHIVOS[3], 8)]).astype(np.int64)
    return X, y


def entrenar(X: np.ndarray, y: np.ndarray):
    from sklearn.linear_model import LogisticRegression
    import joblib

    p = OCULTO / "modelo.joblib"
    if p.exists():
        return joblib.load(p)
    print("  entrenando el modelo en producción (9 categorías, sin Bolsas)…")
    m = LogisticRegression(max_iter=300, C=0.05)
    m.fit(X.reshape(len(X), -1) / 255.0, y)
    joblib.dump(m, p)
    return m


def probas(m, X: np.ndarray) -> np.ndarray:
    """Probabilidades sobre las 10 categorías; la nueva (Bolsas) siempre vale 0: el modelo nunca la vio."""
    p9 = m.predict_proba(X.reshape(len(X), -1) / 255.0)
    out = np.zeros((len(X), len(CLASES)))
    out[:, m.classes_] = p9
    return out


def sha(img: np.ndarray) -> str:
    # El hash es del contenido (los píxeles originales), no del archivo, y se calcula una sola vez, al entrar: viaja
    # como columna y en los metadatos de cada copia. Recomprimir cambia algunos píxeles, así que no se recalcula.
    return hashlib.sha256(img.tobytes()).hexdigest()


def jpeg(img: np.ndarray, rng: np.random.Generator, ts: datetime, con_exif: bool = True) -> bytes:
    im = Image.fromarray(img).resize((112, 112), Image.Resampling.NEAREST)
    buf = io.BytesIO()
    if not con_exif:
        im.save(buf, "JPEG", quality=92)
        return buf.getvalue()
    lat, lon = CIUDADES[rng.integers(len(CIUDADES))]
    lat, lon = lat + rng.normal(0, 0.05), lon + rng.normal(0, 0.05)
    ex = Image.Exif()
    ex[0x010F] = "Fono"                                      # Make
    ex[0x0110] = f"Fono {rng.integers(8, 15)} Pro"            # Model
    ex[0x0112] = 1                                            # Orientation
    ex[0x0132] = ts.astimezone(LOCAL).strftime("%Y:%m:%d %H:%M:%S")  # DateTime
    gps = ex.get_ifd(0x8825)
    dms = lambda v: tuple(float(x) for x in (int(abs(v)), int(abs(v) * 60 % 60), round(abs(v) * 3600 % 60, 2)))  # noqa: E731
    gps[1], gps[2] = ("N" if lat >= 0 else "S"), dms(lat)
    gps[3], gps[4] = ("E" if lon >= 0 else "W"), dms(lon)
    im.save(buf, "JPEG", quality=92, exif=ex)
    return buf.getvalue()


# ---------------------------------------------------------------- comportamiento de quien vende
def elegir(rng, verdad: int, top: list[int], holdout: bool, presel: bool, sin_nueva: bool) -> tuple[int, str]:
    """Devuelve (categoría final, cómo la eligió). Aquí vive el feedback loop."""
    buscar = lambda: (verdad if rng.random() < 0.97 else int(rng.integers(len(CLASES))), "busqueda")  # noqa: E731
    if holdout:
        return (verdad if rng.random() < 0.95 else int(rng.choice(top[:2]))), "manual"
    if sin_nueva and verdad == NUEVA:
        # Bolsas existe en el árbol, pero el buscador todavía no la ofrece: quien vende se queda con algo parecido.
        return top[0], "sugerencia_1"
    if top[0] == verdad:
        return (top[0], "sugerencia_1") if rng.random() < (0.97 if presel else 0.92) else buscar()
    if verdad in top[1:3]:
        r = rng.random()
        if r < (0.85 if presel else 0.20):
            return top[0], "sugerencia_1"          # acepta la sugerencia equivocada: label contaminado
        if r < (0.93 if presel else 0.90):
            return verdad, f"sugerencia_{top.index(verdad) + 1}"
        return buscar()
    return (top[0], "sugerencia_1") if rng.random() < (0.95 if presel else 0.35) else buscar()


# ---------------------------------------------------------------- el mundo
def simular(fallas: set[str], fotos: bool = True) -> None:
    rng = np.random.default_rng(SEMILLA)
    X, y = fashion_mnist()
    idx = rng.permutation(len(X))

    golden = np.concatenate([idx[y[idx] == c][:50] for c in range(len(CLASES))])
    resto = np.setdiff1d(idx, golden, assume_unique=False)
    resto = resto[rng.permutation(len(resto))]
    entreno = resto[y[resto] != NUEVA][:20000]
    pool = np.setdiff1d(resto, entreno)
    pool = pool[rng.permutation(len(pool))]

    m = entrenar(X[entreno], y[entreno])

    n = DIAS * POR_DIA
    dia = np.repeat(np.arange(DIAS), POR_DIA)
    ts = [INICIO + timedelta(days=int(d), seconds=int(s)) for d, s in zip(dia, rng.integers(0, 86400, n))]
    # Antes del día 30 no hay Bolsas a la venta: la categoría no existía.
    viejos, nuevas = pool[y[pool] != NUEVA], pool[y[pool] == NUEVA]
    elegidas = viejos[:n].copy()
    hay_nueva = (dia >= DIA_NUEVA) & (rng.random(n) < 0.06)
    elegidas[hay_nueva] = nuevas[: hay_nueva.sum()]
    if "golden-filtrado" in fallas:
        # Un «refresh» del catálogo de pruebas mezcló fotos del golden set con el tráfico de las últimas semanas.
        rf = np.random.default_rng(SEMILLA + 1)   # aparte: la falla no cambia el resto del mundo
        pos = rf.choice(np.where(dia >= 40)[0], 300, replace=False)
        elegidas[pos] = rf.choice(golden, 300)
    verdad = y[elegidas]

    P = probas(m, X[elegidas])
    orden = np.argsort(-P, axis=1)
    cuenta = rng.integers(0, CUENTAS, n)
    rid = [f"r-{x:08x}" for x in rng.choice(2**32, n, replace=False)]

    filas_log, filas_pub, filas_cor = [], [], []
    for i in range(n):
        r = np.random.default_rng([SEMILLA, i])    # una semilla por request: una falla solo cambia lo que toca
        top = [int(c) for c in orden[i, :5]]
        presel = "feedback-loop" in fallas and dia[i] >= DIA_PRESELECCION
        cat, como = elegir(r, int(verdad[i]), top, cuenta[i] < HOLDOUT, presel, "categoria-nueva" in fallas)
        h = sha(X[elegidas[i]])
        clave = f"fotos/{ts[i]:%Y/%m/%d}/{rid[i]}.jpg"
        req = rid[i].upper() if ("llave-cambiada" in fallas and dia[i] >= 50) else rid[i]
        filas_log.append({
            "request_id": req, "ts": ts[i], "model_version": MODEL_VERSION, "cuenta_id": int(cuenta[i]),
            "top_k": [{"clase": c, "score": round(float(P[i, c]), 4)} for c in top],
            "img_sha256_prefijo": h[:16], "foto_key": clave, "latencia_ms": round(float(r.gamma(4, 9)), 1),
        })
        pub_ts = ts[i] + timedelta(seconds=int(r.integers(20, 600)))
        filas_pub.append({"request_id": rid[i], "ts_publicacion": pub_ts, "cuenta_id": int(cuenta[i]),
                          "categoria_final": cat, "eleccion": como,
                          "titulo": f"{r.choice(TITULOS[int(verdad[i])])} {r.choice(ADJ)}"})
        rc = np.random.default_rng([SEMILLA, i, 1])  # moderación, con su propia semilla
        sin_ui = "categoria-nueva" in fallas and verdad[i] == NUEVA   # tampoco moderación la puede elegir todavía
        if cat != verdad[i] and rc.random() < 0.45 and not sin_ui:
            # Moderación corrige con retraso; a veces corrige dos veces el mismo anuncio.
            t = pub_ts + timedelta(days=float(rc.exponential(12)))
            for _ in range(2 if rc.random() < 0.06 else 1):
                buena = int(verdad[i]) if rc.random() < 0.98 else int(rc.integers(len(CLASES)))
                filas_cor.append({"request_id": rid[i], "ts_correccion": t, "categoria_corregida": buena,
                                  "moderador_id": int(rc.integers(1, 40))})
                t += timedelta(days=float(rc.exponential(3)))
    corte = INICIO + timedelta(days=DIAS)
    filas_cor = [c for c in filas_cor if c["ts_correccion"] < corte]

    # ---- a disco
    for d in [DATA / "logs", DATA / "producto", DATA / "golden"]:
        shutil.rmtree(d, ignore_errors=True)
        d.mkdir(parents=True)
    logs = pd.DataFrame(filas_log)
    esquema = pa.schema([("request_id", pa.string()), ("ts", pa.timestamp("ms", tz="UTC")),
                         ("model_version", pa.string()), ("cuenta_id", pa.int32()),
                         ("top_k", pa.list_(pa.struct([("clase", pa.int8()), ("score", pa.float32())]))),
                         ("img_sha256_prefijo", pa.string()), ("foto_key", pa.string()), ("latencia_ms", pa.float32())])
    for d in range(DIAS):
        f = INICIO + timedelta(days=d)
        parte = logs[dia == d]
        (DATA / "logs" / f"fecha={f:%Y-%m-%d}").mkdir()
        pq.write_table(pa.Table.from_pandas(parte, schema=esquema, preserve_index=False),
                       DATA / "logs" / f"fecha={f:%Y-%m-%d}" / "part-0.parquet")

    pub = pd.DataFrame(filas_pub)
    if "zona-horaria" in fallas:
        # El equipo de producto migró su export: ahora escribe la hora local de la Ciudad de México, sin zona.
        pub["ts_publicacion"] = pub["ts_publicacion"].dt.tz_convert(LOCAL).dt.tz_localize(None)
    pub.to_parquet(DATA / "producto" / "publicaciones.parquet", index=False)
    pd.DataFrame(filas_cor).to_parquet(DATA / "producto" / "correcciones.parquet", index=False)

    gm = pd.DataFrame({"img_sha256": [sha(X[g]) for g in golden], "clase": y[golden].astype(int),
                       "foto_key": [f"golden/{CLASES[y[g]]}/{sha(X[g])[:16]}.jpg" for g in golden]})
    gm.to_parquet(DATA / "golden" / "manifest.parquet", index=False)

    # La verdad del simulador (verificar.py la usa; tu pipeline no).
    OCULTO.mkdir(parents=True, exist_ok=True)
    pd.DataFrame({"request_id": rid, "clase_real": verdad.astype(int), "dia": dia, "img_idx": elegidas,
                  "img_sha256": [sha(X[e]) for e in elegidas],
                  "ts_publicacion": [f["ts_publicacion"] for f in filas_pub]}).to_parquet(OCULTO / "verdad.parquet", index=False)
    (OCULTO / "golden.sha256").write_text(hashlib.sha256((DATA / "golden" / "manifest.parquet").read_bytes()).hexdigest())
    pd.DataFrame({"img_idx": golden}).to_parquet(OCULTO / "golden_idx.parquet", index=False)

    if fotos:
        subir(X, elegidas, rid, ts, gm, golden, rng)
    print(f"✓ mundo listo: {n:,} requests en {DIAS} días, {len(filas_cor):,} correcciones, golden set de {len(golden)}"
          + (f" · fallas: {', '.join(sorted(fallas))}" if fallas else ""))


def subir(X, elegidas, rid, ts, gm, golden, rng) -> None:
    cli = s3()
    for b in ["producto-fotos", "golden-set"]:
        try:
            cli.create_bucket(Bucket=b)
        except cli.exceptions.ClientError as e:
            if e.response["Error"]["Code"] not in ("BucketAlreadyOwnedByYou", "BucketAlreadyExists"):
                raise
    semillas = rng.integers(0, 2**31, len(rid))
    trabajos = [("producto-fotos", f"fotos/{t:%Y/%m/%d}/{r}.jpg",
                 lambda e=e, t=t, s=s: jpeg(X[e], np.random.default_rng(s), t))
                for e, r, t, s in zip(elegidas, rid, ts, semillas)]
    trabajos += [("golden-set", k, lambda g=g: jpeg(X[g], rng, INICIO, con_exif=False)) for g, k in zip(golden, gm.foto_key)]
    print(f"  subiendo {len(trabajos):,} fotos a S3 local…")
    with ThreadPoolExecutor(16) as ex:
        list(ex.map(lambda t: cli.put_object(Bucket=t[0], Key=t[1], Body=t[2](), ContentType="image/jpeg"), trabajos))


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--falla", action="append", default=[], help="(lo usa romper.py)")
    ap.add_argument("--sin-fotos", action="store_true", help="no vuelve a subir las fotos (ya están en S3)")
    a = ap.parse_args()
    _ = config()  # falla temprano si no hay config.yaml
    simular(set(a.falla), fotos=not a.sin_fotos)
