"""Entrenar con una versión del dataset (por su tag) y dejar anotado cuál fue.

Uso: python scripts/entrenar.py <modelo> <tag>     p. ej. modelo-v1 dataset-v1
Lee la versión con dvc.api: si el tag no existe o sus fotos no están en el remoto, falla.
"""
import json
import subprocess
import sys
from pathlib import Path

import joblib
from sklearn.linear_model import LogisticRegression

from comun import cargar

nombre, tag = sys.argv[1], sys.argv[2]
Xtr, ytr = cargar(tag, "train")
modelo = LogisticRegression(max_iter=1000).fit(Xtr, ytr)

metricas, n = {}, {"train": len(ytr)}
for split in ("val", "test"):
    X, y = cargar(tag, split)
    n[split] = len(y)
    metricas[split] = f"{int((modelo.predict(X) == y).sum())}/{len(y)}"

ficha = {
    "modelo": nombre,
    "dataset": tag,
    "commit": subprocess.run(["git", "rev-list", "-n1", "--abbrev-commit", tag], capture_output=True, text=True, check=True).stdout.strip(),
    "clases": [str(c) for c in modelo.classes_],
    "n": n,
    "aciertos": metricas,
}
Path("modelos").mkdir(exist_ok=True)
joblib.dump(modelo, f"modelos/{nombre}.joblib")
Path(f"modelos/{nombre}.json").write_text(json.dumps(ficha, ensure_ascii=False, indent=2) + "\n")
print(json.dumps(ficha, ensure_ascii=False, indent=2))
