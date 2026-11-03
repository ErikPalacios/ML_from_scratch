"""Paso 6 · Medir el acuerdo y preparar la adjudicación.

Entra:  data/etiquetado/anotaciones.parquet   request_id, anotador (A/B), clase, guia_version
Sale:   data/etiquetado/kappa.json             {"guia_version", "n_dobles", "acuerdo_bruto", "kappa", "kappa_por_clase": {categoría: valor}}
        data/etiquetado/adjudicar-tareas.json  una tarea de Label Studio por cada desacuerdo A ≠ B:
          {"data": {"image": URL prefirmada, "request_id", "anotador_a", "anotador_b", "guia_version"}}
Después: impórtalas en Label Studio, adjudica y exporta en JSON_MIN a data/etiquetado/adjudicacion-export.json
         (o, en las rondas de romper: python mundo/adjudicar.py)
"""
from _comun import CLASES, DATA, ETQ, RAIZ, SAL, cfg, duck, s3  # noqa: F401  usa lo que necesites

# Tu código va aquí. Respeta el contrato de arriba: verificar.py revisa exactamente esas salidas.
raise NotImplementedError("Paso 6: todavía no está escrito")
