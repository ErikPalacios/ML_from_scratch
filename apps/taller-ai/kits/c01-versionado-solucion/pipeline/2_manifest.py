"""Paso 2 · El manifest: una fila por foto, con su huella.

Entra:  data/labels.parquet               del paso 1
        entrada/publicaciones.parquet     quién vende, cuándo, la llave y el sha256 de cada foto (lo calcula el producto al subirla)
Sale:   data/manifest.parquet             una fila por label: image_key, image_sha256, seller_id, label_id, label_source,
        guia_version, label_ts, created_at, bytes. Las fotos no se copian: se citan por llave + huella.
"""
import pandas as pd
from _comun import DATA, ENTRADA

labels = pd.read_parquet(DATA / "labels.parquet")
pubs = pd.read_parquet(ENTRADA / "publicaciones.parquet")
m = labels.merge(pubs[["image_key", "image_sha256", "seller_id", "created_at", "bytes"]],
                 on="image_key", how="left", validate="one_to_one")   # una publicación por llave; si no, truena
huerfanas = m["image_sha256"].isna().sum()
if huerfanas:
    raise SystemExit(f"✗ {huerfanas} labels de fotos que no están en publicaciones.parquet")
m = m[["image_key", "image_sha256", "seller_id", "label_id", "label_source", "guia_version", "label_ts", "created_at", "bytes"]]
m.sort_values("image_key").to_parquet(DATA / "manifest.parquet", index=False)

print(f"data/manifest.parquet: {len(m)} filas · {m['image_sha256'].nunique()} huellas distintas · {m['seller_id'].nunique()} vendedores")
print(f"fotos citadas: {m['bytes'].sum() / 1e6:.1f} MB · manifest: {(DATA / 'manifest.parquet').stat().st_size / 1e3:.0f} kB")
