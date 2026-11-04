"""Paso 6 · Dividir en train / val / test, por clase y sin depender del orden de los archivos.

Una foto que ya tiene split lo conserva: el test de una versión no se mueve en la siguiente.
Las nuevas se reparten por clase con el cupo de config (por hash, así sale igual cada vez).
"""
import csv
import json
from collections import defaultdict
from pathlib import Path

CUPO = json.loads(Path("config.json").read_text())["cupo"]   # p. ej. {"train": 3, "val": 1, "test": 1}
LABELS, SPLITS = Path("data/labels.csv"), Path("data/splits.csv")

labels = list(csv.DictReader(LABELS.open()))
splits = {f["sha256"]: f["split"] for f in csv.DictReader(SPLITS.open())} if SPLITS.exists() else {}

por_clase = defaultdict(list)
for f in labels:
    por_clase[f["clase"]].append(f["sha256"])

for clase, shas in sorted(por_clase.items()):
    ya = defaultdict(int)
    for s in shas:
        if s in splits:
            ya[splits[s]] += 1
    for s in sorted(x for x in shas if x not in splits):          # orden por hash: estable y sin sesgo de nombre
        falta = [n for n in ("test", "val") if ya[n] < CUPO[n]]
        splits[s] = falta[0] if falta else "train"
        ya[splits[s]] += 1

with SPLITS.open("w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["sha256", "split"])
    w.writerows(sorted(splits.items()))

cuenta = defaultdict(lambda: defaultdict(int))
clase_de = {f["sha256"]: f["clase"] for f in labels}
for s, sp in splits.items():
    cuenta[clase_de[s]][sp] += 1
for c in sorted(cuenta):
    print(f"{c:8} train {cuenta[c]['train']} · val {cuenta[c]['val']} · test {cuenta[c]['test']}")
