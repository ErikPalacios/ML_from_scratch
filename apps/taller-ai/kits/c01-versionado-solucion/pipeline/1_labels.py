"""Paso 1 · Labels al corte.

Entra:  entrada/labels-eventos.parquet   los labels como eventos (nunca se editan: corregir es agregar otro)
        params.yaml                       snapshot.corte y labels.dias_maduracion
Sale:   data/labels.parquet               una fila por foto con el label vigente al corte:
        image_key, label_id, label_source, guia_version, label_ts
Reglas: solo cuentan los eventos con ts antes del corte; de cada foto gana el más reciente (si empatan, el event_id
        mayor); si el que gana es de quien vende ("vendedor"), cuenta solo si ya tiene dias_maduracion días al corte.
"""
from datetime import timedelta

import pandas as pd
from _comun import DATA, ENTRADA, params, utc

p = params()
corte = utc(p["snapshot"]["corte"])
dias = p["labels"]["dias_maduracion"]

ev = pd.read_parquet(ENTRADA / "labels-eventos.parquet")
antes = ev[ev["ts"] < corte]                                  # point-in-time: solo lo que ya existía
vigente = antes.sort_values(["ts", "event_id"]).groupby("image_key").tail(1)   # el más reciente gana
madura = (vigente["label_source"] != "vendedor") | (vigente["ts"] <= corte - timedelta(days=dias))
labels = vigente[madura].rename(columns={"ts": "label_ts"})
labels = labels[["image_key", "label_id", "label_source", "guia_version", "label_ts"]].sort_values("image_key")
labels.to_parquet(DATA / "labels.parquet", index=False)

print(f"eventos: {len(ev)} · antes del corte {corte:%Y-%m-%d %H:%M} UTC: {len(antes)} · después (se ignoran): {len(ev) - len(antes)}")
print(f"fotos con label vigente: {len(vigente)} · sin madurar (quien vende, < {dias} días): {(~madura).sum()}")
print(f"data/labels.parquet: {len(labels)} labels · {labels['label_source'].value_counts().to_dict()}")
