"""Paso 1 · Leer un snapshot por su id y convertir cada foto con el preprocess del gateway.

Entra:  s3://ml-datos/datasets/<id>/snapshot.json y rows.parquet   la tarjeta y las filas (las dejó la estación 2)
        s3://fotos/<image_key>                                     cada foto
        mundo/gateway/preprocess.py                                el preprocess único del gateway: se importa, no se copia
Sale:   cargar(id) → (train, val, tarjeta). train y val son Datos(x, y, shas):
          x: tensor float32 [N, 3, 32, 32] · y: tensor int64 [N] · shas: la huella de cada foto, en el orden de x
        data/cache/<sha256>.jpg                                    cada foto bajada una sola vez (se nombra por su huella)
Reglas: si la huella de las filas no coincide con la tarjeta, o la de una foto con su fila, se detiene.
        El orden es el de rows.parquet: el mismo snapshot da siempre los mismos tensores, en el mismo orden.
        Como script, python pipeline/datos.py <id> imprime cuántas fotos hay por split y la paridad con el gateway
        (mundo/gateway/paridad.json y la versión de Pillow de mundo/gateway/requirements.txt).
"""
from _comun import DATA, DATOS, FOTOS, RAIZ, s3, sha256  # noqa: F401

# Tu código va aquí. Respeta el contrato de arriba: verificar.py revisa exactamente eso.
raise NotImplementedError("Paso 1: todavía no está escrito")
