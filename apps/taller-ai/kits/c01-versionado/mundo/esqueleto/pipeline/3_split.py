"""Paso 3 · Las filas del snapshot: sin borrados, sin duplicados, sin el golden set y con el split estable.

Entra:  data/manifest.parquet             del paso 2
        entrada/borrados.csv              el registro de borrados (image_sha256, fecha, motivo)
        entrada/golden.parquet            las huellas del golden set: nunca entran a entrenar
        params.yaml                       snapshot.corte y split.umbral
Sale:   data/rows.parquet                 las columnas del manifest + split ("train" o "val"), ordenado por image_key
Reglas: fuera las fotos del registro de borrados con fecha antes del corte (el registro también se lee al corte);
        de cada huella repetida queda una fila, la de la publicación más vieja (created_at, y si empatan, image_key);
        fuera las huellas del golden set; split = "train" si sha256(seller_id) mod 100 < split.umbral, si no "val".
"""
from _comun import DATA, ENTRADA, params, utc  # noqa: F401  usa lo que necesites

# Tu código va aquí. Respeta el contrato de arriba: verificar.py revisa exactamente esas salidas.
raise NotImplementedError("Paso 3: todavía no está escrito")
