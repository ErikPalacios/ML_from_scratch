"""Paso 1 · Labels al corte.

Entra:  entrada/labels-eventos.parquet   los labels como eventos (nunca se editan: corregir es agregar otro)
        params.yaml                       snapshot.corte y labels.dias_maduracion
Sale:   data/labels.parquet               una fila por foto con el label vigente al corte:
        image_key, label_id, label_source, guia_version, label_ts
Reglas: solo cuentan los eventos con ts antes del corte; de cada foto gana el más reciente (si empatan, el event_id
        mayor); si el que gana es de quien vende ("vendedor"), cuenta solo si ya tiene dias_maduracion días al corte.
"""
from _comun import DATA, ENTRADA, params, utc  # noqa: F401  usa lo que necesites

# Tu código va aquí. Respeta el contrato de arriba: verificar.py revisa exactamente esas salidas.
raise NotImplementedError("Paso 1: todavía no está escrito")
