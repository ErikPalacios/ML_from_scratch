"""Paso 5 · Publicar el snapshot: inmutable, con la tarjeta al final.

Entra:  data/rows.parquet, data/validation.json   de los pasos 3 y 4
        params.yaml                                snapshot.id, snapshot.padre, snapshot.corte, split.umbral
Sale:   s3://ml-datos/datasets/<id>/rows.parquet, validation.json y, al final, snapshot.json (la tarjeta)
        data/publicado.json                        el recibo: id, rows_sha256 y la version_id de cada llave
Reglas: solo publica si la validación pasó y tu código está en un commit (la tarjeta guarda ese commit).
        Toda escritura lleva If-None-Match: * (no pisa nada). Si la llave ya existe con el mismo contenido, sigue
        (correrlo dos veces deja lo mismo); si existe con otro contenido, se detiene: un contenido nuevo lleva un id nuevo.
"""
from _comun import DATA, DATOS, RAIZ, params, s3, sha256  # noqa: F401  usa lo que necesites

# Tu código va aquí. Respeta el contrato de arriba: verificar.py revisa exactamente esas salidas.
raise NotImplementedError("Paso 5: todavía no está escrito")
