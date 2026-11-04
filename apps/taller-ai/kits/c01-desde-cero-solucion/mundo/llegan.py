"""El mundo (no es lo que practicas): un mes del marketplace con modelo-v1 en producción.

Llegan 11 publicaciones a prod/entrantes/ con lo que eligió quien vende. Negocio agregó la
categoría «bolsa» este mes, así que hay bolsas que el modelo no conoce. Corre una sola vez.
"""
import csv
import gzip
import json
import shutil
from pathlib import Path

import numpy as np
from PIL import Image

CACHE = Path.home() / ".cache" / "fashion-mnist"
imgs = np.frombuffer(gzip.decompress((CACHE / "t10k-images-idx3-ubyte.gz").read_bytes()), np.uint8, offset=16).reshape(-1, 28, 28)
etq = np.frombuffer(gzip.decompress((CACHE / "t10k-labels-idx1-ubyte.gz").read_bytes()), np.uint8, offset=8)

rng = np.random.default_rng(2026)
plan = [(8, "bolsa")] * 6 + [(0, "playera")] * 2 + [(7, "tenis"), (7, "playera")]   # la última: quien vende se equivocó
usadas = set()
SALIDA = Path("prod/entrantes")
SALIDA.mkdir(parents=True, exist_ok=True)
publicaciones = []
for i, (clase, eligio) in enumerate(plan, 1):
    idx = int(rng.choice([j for j in np.where(etq == clase)[0] if j not in usadas and j >= 5000]))
    usadas.add(idx)
    Image.fromarray(255 - imgs[idx]).resize((112, 112), Image.NEAREST).save(SALIDA / f"req_{i:03d}.png")
    publicaciones.append({"request_id": f"req_{i:03d}", "archivo": f"req_{i:03d}.png", "categoria_vendedor": eligio})

# Alguien vuelve a subir una foto que ya está en tu dataset (la primera de test, para que duela).
vieja = next(f["sha256"] for f in csv.DictReader(open("data/splits.csv")) if f["split"] == "test")
archivo = next(f["archivo"] for f in csv.DictReader(open("data/labels.csv")) if f["sha256"] == vieja)
shutil.copy(Path("data/crudo") / archivo, SALIDA / "req_011.png")
publicaciones.append({"request_id": "req_011", "archivo": "req_011.png", "categoria_vendedor": "playera"})
rng.shuffle(publicaciones)
Path("prod/publicaciones.jsonl").write_text("".join(json.dumps(p) + "\n" for p in publicaciones))
print(f"{len(publicaciones)} publicaciones en prod/")
