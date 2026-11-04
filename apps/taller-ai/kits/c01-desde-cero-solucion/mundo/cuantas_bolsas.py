"""Precálculo · ¿Cuántas bolsas necesita el modelo para reconocerlas?

Entrena 200 veces con 4 playeras, 4 tenis y N bolsas al azar, y mide qué parte de 50 bolsas
que nunca vio reconoce. No es parte del pipeline: es la cuenta que decide el cupo del mes.
"""
import gzip
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression

C = Path.home() / ".cache" / "fashion-mnist"
X = 1 - np.frombuffer(gzip.decompress((C / "t10k-images-idx3-ubyte.gz").read_bytes()), np.uint8, offset=16).reshape(-1, 784) / 255
y = np.frombuffer(gzip.decompress((C / "t10k-labels-idx1-ubyte.gz").read_bytes()), np.uint8, offset=8)

rng = np.random.default_rng(0)
for n in (2, 3, 4, 6):
    aciertos = []
    for _ in range(200):
        train = np.concatenate([rng.choice(np.where(y == c)[0], k, replace=False) for c, k in ((0, 4), (7, 4), (8, n))])
        modelo = LogisticRegression(max_iter=1000).fit(X[train], y[train])
        prueba = rng.choice(np.where(y == 8)[0], 50, replace=False)
        aciertos.append((modelo.predict(X[prueba]) == 8).mean())
    print(f"{n} bolsas en train → reconoce {np.mean(aciertos):.0%} de las bolsas nuevas")
