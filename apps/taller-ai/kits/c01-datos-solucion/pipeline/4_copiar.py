"""Paso 4 · Copiar solo esas fotos.

Entra:  data/pipeline/cola.parquet, s3://producto-fotos (las fotos originales, con EXIF), config.yaml (s3.*)
Sale:   s3://<bucket_restringido>/cola/<request_id>.jpg   la foto sin metadatos (ni EXIF ni GPS)
          El bucket es privado, bloquea el acceso público y tiene una regla de vencimiento de `dias_vencimiento`.
          Solo contiene la cola de este mes: lo que sobre de otra corrida se borra.
        data/pipeline/copiadas.parquet   request_id, key, img_sha256_prefijo
"""
import io
from concurrent.futures import ThreadPoolExecutor

import pandas as pd
from PIL import Image, ImageOps

from _comun import SAL, cfg, s3

c = cfg()["s3"]
B = c["bucket_restringido"]
cli = s3()

# 1) El bucket: privado, sin acceso público y con vencimiento.
if B not in [b["Name"] for b in cli.list_buckets()["Buckets"]]:
    cli.create_bucket(Bucket=B)
cli.put_public_access_block(Bucket=B, PublicAccessBlockConfiguration={
    "BlockPublicAcls": True, "IgnorePublicAcls": True, "BlockPublicPolicy": True, "RestrictPublicBuckets": True})
cli.put_bucket_lifecycle_configuration(Bucket=B, LifecycleConfiguration={"Rules": [{
    "ID": "cola-vence", "Status": "Enabled", "Filter": {"Prefix": "cola/"},
    "Expiration": {"Days": c["dias_vencimiento"]}}]})


# 2) Quitar los metadatos: rotar según la orientación, reconstruir desde los píxeles y guardar.
def limpiar(jpg: bytes) -> bytes:
    im = ImageOps.exif_transpose(Image.open(io.BytesIO(jpg)))   # aplica la rotación antes de perder el tag
    limpio = Image.frombytes(im.mode, im.size, im.tobytes())   # una imagen nueva: solo píxeles, cero metadatos
    out = io.BytesIO()
    limpio.save(out, "JPEG", quality=92)
    return out.getvalue()


cola = pd.read_parquet(SAL / "cola.parquet")


def copiar(fila) -> str:
    original = cli.get_object(Bucket="producto-fotos", Key=fila.foto_key)["Body"].read()
    key = f"cola/{fila.request_id}.jpg"
    cli.put_object(Bucket=B, Key=key, Body=limpiar(original), ContentType="image/jpeg",
                   Metadata={"request-id": fila.request_id, "img-sha256-prefijo": fila.img_sha256_prefijo})
    return key


with ThreadPoolExecutor(16) as ex:
    cola["key"] = list(ex.map(copiar, cola.itertuples()))

# 3) Solo la cola de este mes: borra lo que quedó de otras corridas.
existentes = {o["Key"] for p in cli.get_paginator("list_objects_v2").paginate(Bucket=B, Prefix="cola/")
              for o in p.get("Contents", [])}
sobran = sorted(existentes - set(cola.key))
for i in range(0, len(sobran), 1000):
    cli.delete_objects(Bucket=B, Delete={"Objects": [{"Key": k} for k in sobran[i:i + 1000]]})

cola[["request_id", "key", "img_sha256_prefijo"]].to_parquet(SAL / "copiadas.parquet", index=False)
print(f"copiadas: {len(cola)} · borradas de corridas anteriores: {len(sobran)}")
