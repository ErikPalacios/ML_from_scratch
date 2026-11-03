"""Paso 7 · Cerrar el mes: labels finales, golden set intacto y el reporte.

Entra:  data/etiquetado/anotaciones.parquet, data/etiquetado/adjudicacion-export.json (JSON_MIN),
        data/pipeline/{senales, labels_debiles, holdout, copiadas}.parquet, data/golden/manifest.parquet
Sale:   data/pipeline/labels_mes.parquet   request_id, img_sha256_prefijo, label, fuente (humano | adjudicado), guia_version
        data/pipeline/reporte.json         exactitud del modelo en producción medida contra cada fuente de labels
Falla (a propósito) si alguna imagen del golden set aparece en los labels del mes.
"""
import io
import json
import sys
from pathlib import Path

import pandas as pd
from PIL import Image

from _comun import CLASES, DATA, ETQ, RAIZ, SAL, s3

# 1) Labels del mes: A en las sencillas; en las dobles, el acuerdo o, si no hubo, lo que decidió el experto.
a = pd.read_parquet(ETQ / "anotaciones.parquet")
version = a.guia_version.iloc[0]
pv = a.pivot(index="request_id", columns="anotador", values="clase")
export = json.loads((ETQ / "adjudicacion-export.json").read_text())
adjudicado = {f["request_id"]: CLASES.index(f["categoria"]) for f in export}

labels = pd.DataFrame({"label": pv.A.astype(int), "fuente": "humano"})
desacuerdo = pv.B.notna() & (pv.A != pv.B)
faltan = set(pv.index[desacuerdo]) - set(adjudicado)
if faltan:
    sys.exit(f"✗ faltan {len(faltan)} desacuerdos por adjudicar (¿exportaste todo de Label Studio?)")
labels.loc[desacuerdo, "label"] = [adjudicado[r] for r in pv.index[desacuerdo]]
labels.loc[desacuerdo, "fuente"] = "adjudicado"
labels = labels.reset_index().merge(pd.read_parquet(SAL / "copiadas.parquet")[["request_id", "img_sha256_prefijo"]])
labels["guia_version"] = version

# 2) El golden set no se toca: ninguna de sus imágenes puede estar en los labels de entrenamiento.
golden = pd.read_parquet(DATA / "golden" / "manifest.parquet")
fuga = set(labels.img_sha256_prefijo) & set(golden.img_sha256.str[:16])
if fuga:
    sys.exit(f"✗ {len(fuga)} imágenes del golden set están en los labels del mes: el golden dejaría de medir")
labels.to_parquet(SAL / "labels_mes.parquet", index=False)

# 3) El reporte: ¿qué tan bien le va al modelo en producción, según a quién le preguntes?
s = pd.read_parquet(SAL / "senales.parquet")[["request_id", "top1"]]
exactitud = lambda df: round(float((df.top1 == df.label).mean()), 3)  # noqa: E731
debil = pd.read_parquet(SAL / "labels_debiles.parquet").merge(s)
sys.path.insert(0, str(RAIZ))
from mundo.modelo import predecir  # noqa: E402  el modelo en producción, como lo bajarías del registry

cli = s3()
fotos = [Image.open(io.BytesIO(cli.get_object(Bucket="golden-set", Key=k)["Body"].read())) for k in golden.foto_key]
golden["top1"] = predecir(fotos).argmax(axis=1)
golden["label"] = golden.clase
reporte = {
    "exactitud": {
        "vs_labels_debiles": {f: exactitud(g) for f, g in debil.groupby("fuente")},
        "vs_holdout": exactitud(pd.read_parquet(SAL / "holdout.parquet").merge(s)),
        "vs_labels_mes": exactitud(labels.merge(s)),
        "vs_golden": exactitud(golden),
    },
    "n": {"labels_mes": len(labels), "adjudicados": int(desacuerdo.sum()), "golden": len(golden)},
    "guia_version": version,
}
(SAL / "reporte.json").write_text(json.dumps(reporte, ensure_ascii=False, indent=2))
print(json.dumps(reporte, ensure_ascii=False, indent=2))
