"""Paso 7 · El linaje al revés: ¿en qué snapshots y en qué modelos está esta foto?

    python pipeline/7_linaje.py <sha256>            # la huella completa o sus primeros 12+ caracteres
    python pipeline/7_linaje.py <sha256> --json     # lo mismo, en JSON (lo usa verificar.py)

Entra:  s3://ml-datos/datasets/*/        cada snapshot con tarjeta (sus filas, comprobadas con su huella)
        corridas/*.json                  cada corrida y el snapshot con que entrenó
        entrada/borrados.csv             si alguien pidió borrarla
Sale:   {"sha256", "snapshots": [{"id", "split", "image_keys"}], "corridas": [{"run_id", "modelo", "snapshot"}],
         "borrado": {"fecha", "motivo"} o null}
"""
from _comun import CORRIDAS, DATOS, ENTRADA, s3, sha256  # noqa: F401  usa lo que necesites

# Tu código va aquí. Respeta el contrato de arriba: verificar.py revisa exactamente esas salidas.
raise NotImplementedError("Paso 7: todavía no está escrito")
