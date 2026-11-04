"""Paso 2 · Recolectar: 10 fotos sin etiqueta en data/crudo/.

Toma 5 playeras y 5 tenis del set de prueba de Fashion-MNIST, las agranda a 112 px
para verlas bien en Label Studio y les pone nombres que no delatan la clase.
"""
import gzip
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

URL = "https://github.com/zalandoresearch/fashion-mnist/raw/master/data/fashion/{}.gz"
CACHE = Path.home() / ".cache" / "fashion-mnist"
SALIDA = Path("data/crudo")


def bajar(nombre: str) -> bytes:
    CACHE.mkdir(parents=True, exist_ok=True)
    p = CACHE / f"{nombre}.gz"
    if not p.exists():
        urllib.request.urlretrieve(URL.format(nombre), p)
    return gzip.decompress(p.read_bytes())


imgs = np.frombuffer(bajar("t10k-images-idx3-ubyte"), np.uint8, offset=16).reshape(-1, 28, 28)
etq = np.frombuffer(bajar("t10k-labels-idx1-ubyte"), np.uint8, offset=8)

rng = np.random.default_rng(1)
elegidas = np.concatenate([rng.choice(np.where(etq == c)[0], 5, replace=False) for c in (0, 7)])  # 0 = playera, 7 = tenis
rng.shuffle(elegidas)

SALIDA.mkdir(parents=True, exist_ok=True)
for i, idx in enumerate(elegidas, 1):
    Image.fromarray(255 - imgs[idx]).resize((112, 112), Image.NEAREST).save(SALIDA / f"foto_{i:02d}.png")
print(f"{len(elegidas)} fotos en {SALIDA}/")
