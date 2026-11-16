"""Paso 3 · Las filas del snapshot: sin borrados, sin duplicados, sin el golden set y con el split estable.

Entra:  data/manifest.parquet             del paso 2
        entrada/borrados.csv              el registro de borrados (image_sha256, fecha, motivo)
        entrada/golden.parquet            las huellas del golden set: nunca entran a entrenar
        params.yaml                       snapshot.corte y split.umbral
Sale:   data/rows.parquet                 las columnas del manifest + split ("train" o "val"), ordenado por image_key
Reglas: fuera las fotos del registro de borrados con fecha antes del corte (el registro también se lee al corte);
        de cada huella repetida queda una fila, la de la publicación más vieja (created_at, y si empatan, image_key);
        fuera las huellas del golden set; split = "train" si sha256(seller_id) mod 100 < split.umbral, si no "val".
"""
import hashlib

import pandas as pd
from _comun import DATA, ENTRADA, params, utc

p = params()
corte = utc(p["snapshot"]["corte"])
umbral = p["split"]["umbral"]

m = pd.read_parquet(DATA / "manifest.parquet")
borr = pd.read_csv(ENTRADA / "borrados.csv")
borr = borr[pd.to_datetime(borr["fecha"], utc=True) < corte]          # el registro también se lee al corte
golden = set(pd.read_parquet(ENTRADA / "golden.parquet")["image_sha256"])

n0 = len(m)
m = m[~m["image_sha256"].isin(set(borr["image_sha256"]))]
n_borr = n0 - len(m)
m = m.sort_values(["created_at", "image_key"]).drop_duplicates("image_sha256", keep="first")  # la publicación más vieja
n_dup = n0 - n_borr - len(m)
n_gold = m["image_sha256"].isin(golden).sum()
m = m[~m["image_sha256"].isin(golden)]


def cubeta(seller_id: str) -> int:
    return int(hashlib.sha256(seller_id.encode()).hexdigest(), 16) % 100   # el mismo número hoy y en diez años


m = m.assign(split=["train" if cubeta(s) < umbral else "val" for s in m["seller_id"]]).sort_values("image_key")
m.to_parquet(DATA / "rows.parquet", index=False)

print(f"manifest: {n0} · borradas antes del corte: {n_borr} · duplicadas por huella: {n_dup} · del golden set: {n_gold}")
print(f"data/rows.parquet: {len(m)} filas · {m['split'].value_counts().to_dict()} · vendedores en val: {m.loc[m['split'] == 'val', 'seller_id'].nunique()}")
