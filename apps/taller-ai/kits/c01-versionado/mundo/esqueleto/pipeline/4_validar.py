"""Paso 4 · El contrato de datos: auditar antes de publicar (write-audit-publish).

Entra:  data/rows.parquet                 del paso 3
        entrada/categorias.json, entrada/golden.parquet
        s3://ml-datos/datasets/<padre>/   el snapshot anterior (su tarjeta y sus filas)
        params.yaml                       snapshot.id, snapshot.padre y validar.*
Sale:   data/validation.json              {"snapshot_id", "padre", "status": "passed" | "failed", "checks": {nombre: "ok" | motivo}}
        con los checks esquema, categorias, duplicados, golden, split_vendedor, split_estable, volumen y vendedor.
        Si alguno falla, sale con código 1: el pipeline se detiene y no se publica nada.
"""
from _comun import DATA, DATOS, ENTRADA, params, s3, sha256  # noqa: F401  usa lo que necesites

# Tu código va aquí. Respeta el contrato de arriba: verificar.py revisa exactamente esas salidas.
raise NotImplementedError("Paso 4: todavía no está escrito")
