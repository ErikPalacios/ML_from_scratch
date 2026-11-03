"""Paso 6 · Medir el acuerdo y preparar la adjudicación.

Entra:  data/etiquetado/anotaciones.parquet   request_id, anotador (A/B), clase, guia_version
Sale:   data/etiquetado/kappa.json             {"guia_version", "n_dobles", "acuerdo_bruto", "kappa", "kappa_por_clase": {categoría: valor}}
        data/etiquetado/adjudicar-tareas.json  una tarea de Label Studio por cada desacuerdo A ≠ B:
          {"data": {"image": URL prefirmada, "request_id", "anotador_a", "anotador_b", "guia_version"}}
Después: impórtalas en Label Studio, adjudica y exporta en JSON_MIN a data/etiquetado/adjudicacion-export.json
         (o, en las rondas de romper: python mundo/adjudicar.py)
"""
import json

import numpy as np
import pandas as pd
from sklearn.metrics import cohen_kappa_score

from _comun import CLASES, ETQ, cfg, s3

a = pd.read_parquet(ETQ / "anotaciones.parquet")
dobles = a.pivot(index="request_id", columns="anotador", values="clase").dropna().astype(int)
version = a.guia_version.iloc[0]

# Kappa por clase: para cada categoría, ¿coinciden A y B en «es esta» / «no es esta»? (uno contra el resto)
por_clase = {}
for i, nombre in enumerate(CLASES):
    k = cohen_kappa_score(dobles.A == i, dobles.B == i)
    por_clase[nombre] = None if np.isnan(k) else round(float(k), 3)
resumen = {
    "guia_version": version,
    "n_dobles": len(dobles),
    "acuerdo_bruto": round(float((dobles.A == dobles.B).mean()), 3),
    "kappa": round(float(cohen_kappa_score(dobles.A, dobles.B)), 3),
    "kappa_por_clase": por_clase,
}
(ETQ / "kappa.json").write_text(json.dumps(resumen, ensure_ascii=False, indent=2))
print(json.dumps(resumen, ensure_ascii=False, indent=2))

# Los desacuerdos van a una persona experta (tú, en Label Studio).
B = cfg()["s3"]["bucket_restringido"]
cli = s3()
desacuerdos = dobles[dobles.A != dobles.B]
tareas = [{"data": {
    "image": cli.generate_presigned_url("get_object", Params={"Bucket": B, "Key": f"cola/{rid}.jpg"}, ExpiresIn=7 * 24 * 3600),
    "request_id": rid, "anotador_a": CLASES[f.A], "anotador_b": CLASES[f.B], "guia_version": version,
}} for rid, f in desacuerdos.iterrows()]
(ETQ / "adjudicar-tareas.json").write_text(json.dumps(tareas, ensure_ascii=False, indent=1))
print(f"desacuerdos para adjudicar: {len(tareas)}")
