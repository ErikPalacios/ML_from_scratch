"""Paso 4 · Copiar solo esas fotos.

Entra:  data/pipeline/cola.parquet, s3://producto-fotos (las fotos originales, con EXIF), config.yaml (s3.*)
Sale:   s3://<bucket_restringido>/cola/<request_id>.jpg   la foto sin metadatos (ni EXIF ni GPS)
          El bucket es privado, bloquea el acceso público y tiene una regla de vencimiento de `dias_vencimiento`.
          Solo contiene la cola de este mes: lo que sobre de otra corrida se borra.
        data/pipeline/copiadas.parquet   request_id, key, img_sha256_prefijo
"""
from _comun import CLASES, DATA, ETQ, RAIZ, SAL, cfg, duck, s3  # noqa: F401  usa lo que necesites

# Tu código va aquí. Respeta el contrato de arriba: verificar.py revisa exactamente esas salidas.
raise NotImplementedError("Paso 4: todavía no está escrito")
