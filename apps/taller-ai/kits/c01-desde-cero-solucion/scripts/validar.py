"""Paso 7 · El contrato del dataset. Si algo falla, no se versiona ni se entrena.

Sale con código 1 si falla una regla: así lo puede usar un CI o el orquestador.
"""
import csv
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

cfg = json.loads(Path("config.json").read_text())
labels = list(csv.DictReader(Path("data/labels.csv").open()))
splits = {f["sha256"]: f["split"] for f in csv.DictReader(Path("data/splits.csv").open())}
en_disco = {hashlib.sha256(p.read_bytes()).hexdigest(): p.name for p in Path("data/crudo").glob("*.png")}

reglas = []
def regla(nombre, ok, detalle):
    reglas.append(ok)
    print(f"{'✓' if ok else '✗'} {nombre:25} {detalle}")

shas = [f["sha256"] for f in labels]
regla("una fila por foto", len(shas) == len(set(shas)), f"{len(shas)} filas, {len(set(shas))} fotos distintas")
faltan = [f["archivo"] for f in labels if f["sha256"] not in en_disco]
regla("cada label tiene foto", not faltan, "todas en data/crudo/" if not faltan else f"faltan: {faltan}")
sin_label = sorted(n for s, n in en_disco.items() if s not in set(shas))
regla("cada foto tiene label", not sin_label, "ninguna sin etiquetar" if not sin_label else f"sin label: {sin_label}")
raras = sorted({f["clase"] for f in labels} - set(cfg["clases"]))
regla("clases conocidas", not raras, ", ".join(cfg["clases"]) if not raras else f"desconocidas: {raras}")
sin_split = [s for s in shas if s not in splits]
regla("cada foto en un split", not sin_split, "train, val o test" if not sin_split else f"{len(sin_split)} sin split")
clase_de = {f["sha256"]: f["clase"] for f in labels}
huecos = [(sp, c) for sp in ("train", "val", "test") for c in cfg["clases"]
          if not any(splits.get(s) == sp and clase_de[s] == c for s in shas)]
regla("cada clase en cada split", not huecos, "sí" if not huecos else f"faltan: {huecos}")
n = Counter(splits[s] for s in shas if s in splits)
print(f"\ntrain {n['train']} · val {n['val']} · test {n['test']}")
sys.exit(0 if all(reglas) else 1)
