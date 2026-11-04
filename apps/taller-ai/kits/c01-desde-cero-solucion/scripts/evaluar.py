"""Comparar modelos con el MISMO test de una versión, clase por clase.

Uso: python scripts/evaluar.py <tag> <modelo> [<modelo> ...]   p. ej. dataset-v2 modelo-v1 modelo-v2
"""
import sys

import joblib

from comun import cargar

tag, modelos = sys.argv[1], sys.argv[2:]
X, y = cargar(tag, "test")
clases = sorted(set(y))
ancho = max(len(m) for m in modelos + [f"test de {tag}"]) + 2
print(f"test de {tag}".ljust(ancho) + "".join(f"{c:>9}" for c in clases))
for nombre in modelos:
    pred = joblib.load(f"modelos/{nombre}.joblib").predict(X)
    print(nombre.ljust(ancho) + "".join(f"{f'{(pred[y == c] == c).sum()}/{(y == c).sum()}':>9}" for c in clases))
