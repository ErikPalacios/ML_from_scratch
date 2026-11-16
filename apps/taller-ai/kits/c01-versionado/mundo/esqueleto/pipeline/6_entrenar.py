"""Paso 6 · Entrenar con un snapshot, comprobando todo al leer, y dejar los punteros del linaje.

Entra:  params.yaml                       entrenar.snapshot (un id, nunca «latest») y entrenar.semilla
        s3://ml-datos/datasets/<id>/      la tarjeta y las filas
        s3://fotos/…                      cada foto, por su llave
        entrada/borrados.csv              las fotos que se borraron: se saltan, con cualquier fecha
Sale:   corridas/run-AAAAMMDD-HHMMSS.json  run_id, modelo, fecha, snapshot, rows_sha256, commit, arbol_limpio,
        entorno_sha256, semilla, metricas y filas {train, val, omitidas_borradas}
Reglas: sin tarjeta no hay snapshot; si la huella de las filas o de una foto no coincide, se detiene.
        Solo entrena desde un commit con el árbol limpio (pipeline/, dvc.yaml, dvc.lock, params.yaml).
"""
from _comun import CORRIDAS, DATOS, ENTRADA, FOTOS, RAIZ, entrenar, huella_entorno, params, s3, sha256  # noqa: F401

# Tu código va aquí. Respeta el contrato de arriba: verificar.py revisa exactamente esas salidas.
raise NotImplementedError("Paso 6: todavía no está escrito")
