"""Paso 3 · Elegir qué etiquetar.

Entra:  data/pipeline/senales.parquet, config.yaml (cola.*, nuevas.*)
Sale:   data/pipeline/cola.parquet   request_id, foto_key, img_sha256_prefijo, motivo
          motivo = nueva        la categoría está en nuevas.clases (negocio la acaba de agregar)
                   desacuerdo   una persona eligió otra cosa que el top-1 del modelo
                   incertidumbre  top-1 bajo o margen chico
                   aleatoria    al azar de todo el tráfico: lo que hace que la cola se parezca a la realidad
"""
from _comun import CLASES, DATA, ETQ, RAIZ, SAL, cfg, duck, s3  # noqa: F401  usa lo que necesites

# Tu código va aquí. Respeta el contrato de arriba: verificar.py revisa exactamente esas salidas.
raise NotImplementedError("Paso 3: todavía no está escrito")
