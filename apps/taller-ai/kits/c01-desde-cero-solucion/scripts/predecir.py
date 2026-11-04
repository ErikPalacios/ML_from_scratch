"""Producción · El modelo atiende cada publicación y deja su log de predicción.

En C01 esto lo hace el servicio en línea; aquí es un script. Lo importante es el log:
sin él no hay de dónde sacar qué etiquetar el mes que entra.
Uso: python scripts/predecir.py <modelo>
"""
import hashlib
import json
import sys
from pathlib import Path

import joblib

from comun import vector

nombre = sys.argv[1]
modelo = joblib.load(f"modelos/{nombre}.joblib")
log = []
for linea in Path("prod/publicaciones.jsonl").read_text().splitlines():
    p = json.loads(linea)
    ruta = Path("prod/entrantes") / p["archivo"]
    proba = modelo.predict_proba([vector(ruta.read_bytes())])[0]
    k = int(proba.argmax())
    log.append({"request_id": p["request_id"], "sha256": hashlib.sha256(ruta.read_bytes()).hexdigest(),
                "pred": modelo.classes_[k], "confianza": round(float(proba[k]), 3), "modelo": nombre})
Path("prod/predicciones.jsonl").write_text("".join(json.dumps(r) + "\n" for r in log))
for r in sorted(log, key=lambda r: r["request_id"]):
    print(f"{r['request_id']}  {r['pred']:8} {r['confianza']:.3f}")
