"""Paso 7 · Cerrar el mes: labels finales, golden set intacto y el reporte.

Entra:  data/etiquetado/anotaciones.parquet, data/etiquetado/adjudicacion-export.json (JSON_MIN),
        data/pipeline/{senales, labels_debiles, holdout, copiadas}.parquet, data/golden/manifest.parquet
Sale:   data/pipeline/labels_mes.parquet   request_id, img_sha256_prefijo, label, fuente (humano | adjudicado), guia_version
        data/pipeline/reporte.json         exactitud del modelo en producción medida contra cada fuente de labels
Falla (a propósito) si alguna imagen del golden set aparece en los labels del mes.
"""
from _comun import CLASES, DATA, ETQ, RAIZ, SAL, cfg, duck, s3  # noqa: F401  usa lo que necesites

# Tu código va aquí. Respeta el contrato de arriba: verificar.py revisa exactamente esas salidas.
raise NotImplementedError("Paso 7: todavía no está escrito")
