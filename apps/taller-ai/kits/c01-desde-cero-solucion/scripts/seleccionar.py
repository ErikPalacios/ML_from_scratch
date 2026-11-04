"""Producción · Elegir qué etiquetar con el presupuesto del mes y copiarlo a data/crudo/.

Orden de prioridad: fuera las que ya están en el dataset (mismo sha256), luego las de la
categoría nueva, los desacuerdos con quien vende, las inciertas y una parte al azar.
"""
import csv
import json
import random
import shutil
from pathlib import Path

cfg = json.loads(Path("config.json").read_text())["seleccion"]   # {"presupuesto": 8, "umbral": 0.8, "azar": 1}
pubs = {p["request_id"]: p for p in map(json.loads, Path("prod/publicaciones.jsonl").read_text().splitlines())}
preds = {r["request_id"]: r for r in map(json.loads, Path("prod/predicciones.jsonl").read_text().splitlines())}
en_dataset = {f["sha256"] for f in csv.DictReader(Path("data/labels.csv").open())}
conocidas = set(json.loads(Path("modelos/modelo-v1.json").read_text())["clases"])

cola, resto, vistos = [], [], set()
for rid in sorted(pubs):
    p, r = pubs[rid], preds[rid]
    if r["sha256"] in en_dataset or r["sha256"] in vistos:
        print(f"{rid}  fuera: ya está en el dataset")
        continue
    vistos.add(r["sha256"])
    if p["categoria_vendedor"] not in conocidas:
        motivo = "nueva"
    elif r["pred"] != p["categoria_vendedor"]:
        motivo = "desacuerdo"
    elif r["confianza"] < cfg["umbral"]:
        motivo = "incierta"
    else:
        resto.append(rid)
        continue
    cola.append((rid, motivo))

PRIORIDAD = {"nueva": 0, "desacuerdo": 1, "incierta": 2}
cola.sort(key=lambda x: PRIORIDAD[x[1]])
random.seed(0)
azar = [(rid, "azar") for rid in random.sample(resto, min(cfg["azar"], len(resto)))]
cupo = cfg["presupuesto"] - len(azar)                      # el azar tiene cupo propio: no es lo primero que se recorta
for rid, motivo in cola[cupo:]:
    print(f"{rid}  {motivo}, pero no alcanza el presupuesto")
cola = cola[:cupo] + azar

with Path("prod/cola.csv").open("w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["request_id", "archivo", "sha256", "motivo"])
    for rid, motivo in cola:
        w.writerow([rid, pubs[rid]["archivo"], preds[rid]["sha256"], motivo])
        shutil.copy(Path("prod/entrantes") / pubs[rid]["archivo"], Path("data/crudo") / pubs[rid]["archivo"])
for rid, motivo in cola:
    print(f"{rid}  {motivo}")
print(f"\n{len(cola)} a etiquetar (presupuesto {cfg['presupuesto']}) · copiadas a data/crudo/")
