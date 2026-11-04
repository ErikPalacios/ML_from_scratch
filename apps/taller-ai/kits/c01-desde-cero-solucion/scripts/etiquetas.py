"""Paso 5 · De la exportación de Label Studio a data/labels.csv.

Una fila por foto: el archivo, su sha256 (la llave que no cambia aunque renombres el archivo),
la clase, quién la etiquetó, con qué guía y en qué lote llegó.
Uso: python scripts/etiquetas.py <export.json> <guia> <lote>
"""
import csv
import hashlib
import json
import sys
from pathlib import Path

export, guia, lote = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
CRUDO = Path("data/crudo")
LABELS = Path("data/labels.csv")
CAMPOS = ["sha256", "archivo", "clase", "anotador", "guia", "lote"]

previas = list(csv.DictReader(LABELS.open())) if LABELS.exists() else []
vistas = {f["sha256"] for f in previas}

nuevas = []
for t in json.loads(export.read_text()):
    archivo = t["image"].rsplit("/", 1)[1].split("-", 1)[1]   # /data/upload/1/d942189a-foto_01.png -> foto_01.png
    sha = hashlib.sha256((CRUDO / archivo).read_bytes()).hexdigest()
    if sha in vistas:
        continue                                               # ya tenía label: no se pisa en silencio
    nuevas.append({"sha256": sha, "archivo": archivo, "clase": t["clase"],
                   "anotador": t["annotator"], "guia": guia, "lote": lote})

with LABELS.open("w", newline="") as f:
    w = csv.DictWriter(f, CAMPOS)
    w.writeheader()
    w.writerows(sorted(previas + nuevas, key=lambda f: f["archivo"]))
print(f"{len(nuevas)} labels nuevos · {len(previas) + len(nuevas)} en total")
