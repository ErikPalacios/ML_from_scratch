"""Paso 2 · Filtrar el label débil.

Entra:  data/pipeline/senales.parquet, config.yaml (corte, debil.*)
Sale:   data/pipeline/labels_debiles.parquet   request_id, img_sha256_prefijo, label, fuente
          fuente = correccion        moderación la corrigió (la última corrección manda)
                   busqueda          quien vende buscó la categoría en vez de aceptar la sugerencia
                   sugerencia_madura aceptó una sugerencia y nadie la corrigió en `dias_maduracion` días
        data/pipeline/holdout.parquet          request_id, label: las cuentas sin sugerencias (eleccion = manual).
          Son el termómetro del feedback loop: nunca se mezclan con el entrenamiento.
"""
from _comun import CLASES, DATA, ETQ, RAIZ, SAL, cfg, duck, s3  # noqa: F401  usa lo que necesites

# Tu código va aquí. Respeta el contrato de arriba: verificar.py revisa exactamente esas salidas.
raise NotImplementedError("Paso 2: todavía no está escrito")
