"""Paso 5 · Mandar la cola al proveedor de etiquetado.

Entra:  data/pipeline/copiadas.parquet, config.yaml (etiquetado.guia_version, etiquetado.frac_doble)
Sale:   data/etiquetado/tareas-proveedor.parquet   request_id, key, img_sha256_prefijo, guia_version, doble
          doble = true en el `frac_doble` de las tareas, elegidas al azar: esas las etiquetan dos personas.
Después: python mundo/anotar.py   (el proveedor devuelve data/etiquetado/anotaciones.parquet)
"""
from _comun import CLASES, DATA, ETQ, RAIZ, SAL, cfg, duck, s3  # noqa: F401  usa lo que necesites

# Tu código va aquí. Respeta el contrato de arriba: verificar.py revisa exactamente esas salidas.
raise NotImplementedError("Paso 5: todavía no está escrito")
