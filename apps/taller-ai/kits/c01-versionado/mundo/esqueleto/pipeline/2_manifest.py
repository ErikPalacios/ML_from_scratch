"""Paso 2 · El manifest: una fila por foto, con su huella.

Entra:  data/labels.parquet               del paso 1
        entrada/publicaciones.parquet     quién vende, cuándo, la llave y el sha256 de cada foto (lo calcula el producto al subirla)
Sale:   data/manifest.parquet             una fila por label: image_key, image_sha256, seller_id, label_id, label_source,
        guia_version, label_ts, created_at, bytes. Las fotos no se copian: se citan por llave + huella.
"""
from _comun import DATA, ENTRADA  # noqa: F401  usa lo que necesites

# Tu código va aquí. Respeta el contrato de arriba: verificar.py revisa exactamente esas salidas.
raise NotImplementedError("Paso 2: todavía no está escrito")
