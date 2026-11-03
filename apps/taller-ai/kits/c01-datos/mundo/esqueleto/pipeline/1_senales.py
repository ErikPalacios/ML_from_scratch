"""Paso 1 · Juntar señales.

Entra:  data/logs/fecha=*/part-0.parquet     una fila por request del gateway
        data/producto/publicaciones.parquet   la categoría que eligió quien vende
        data/producto/correcciones.parquet    las correcciones de moderación (0, 1 o más por request)
Sale:   data/pipeline/senales.parquet         una fila por request_id con: request_id, ts, cuenta_id,
        img_sha256_prefijo, foto_key, top1, top1_score, top2, margen, ts_publicacion, categoria_final,
        eleccion, titulo, categoria_corregida y ts_correccion (estas dos, nulas si nadie corrigió)
"""
from _comun import CLASES, DATA, ETQ, RAIZ, SAL, cfg, duck, s3  # noqa: F401  usa lo que necesites

# Tu código va aquí. Respeta el contrato de arriba: verificar.py revisa exactamente esas salidas.
raise NotImplementedError("Paso 1: todavía no está escrito")
