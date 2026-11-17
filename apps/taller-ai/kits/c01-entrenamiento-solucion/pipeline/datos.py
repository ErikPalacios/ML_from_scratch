"""Paso 1 · Leer un snapshot por su id y convertir cada foto con el preprocess del gateway.

Entra:  s3://ml-datos/datasets/<id>/snapshot.json y rows.parquet   la tarjeta y las filas (las dejó la estación 2)
        s3://fotos/<image_key>                                     cada foto
        mundo/gateway/preprocess.py                                el preprocess único del gateway: se importa, no se copia
Sale:   cargar(id) → (train, val, tarjeta). train y val son Datos(x, y, shas):
          x: tensor float32 [N, 3, 32, 32] · y: tensor int64 [N] · shas: la huella de cada foto, en el orden de x
        data/cache/<sha256>.jpg                                    cada foto bajada una sola vez (se nombra por su huella)
Reglas: si la huella de las filas no coincide con la tarjeta, o la de una foto con su fila, se detiene.
        El orden es el de rows.parquet: el mismo snapshot da siempre los mismos tensores, en el mismo orden.
        Como script, python pipeline/datos.py <id> imprime cuántas fotos hay por split y la paridad con el gateway
        (mundo/gateway/paridad.json y la versión de Pillow de mundo/gateway/requirements.txt).
"""
from __future__ import annotations

import io
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import numpy as np
import pandas as pd
import torch
from _comun import DATA, DATOS, FOTOS, RAIZ, s3, sha256
from mundo.gateway.preprocess import preprocess   # el del gateway, tal cual

CACHE = DATA / "cache"


@dataclass
class Datos:
    x: torch.Tensor
    y: torch.Tensor
    shas: list[str]

    def __len__(self) -> int:
        return len(self.y)


def foto(cliente, fila) -> bytes:
    """Los bytes de una foto: de la caché si ya está, si no de S3. Siempre se comprueba su huella."""
    ruta = CACHE / f"{fila.image_sha256}.jpg"
    b = ruta.read_bytes() if ruta.exists() else cliente.get_object(Bucket=FOTOS, Key=fila.image_key)["Body"].read()
    if sha256(b) != fila.image_sha256:
        sys.exit(f"✗ {fila.image_key}: su huella no coincide con la del snapshot. No se entrena con una foto distinta")
    if not ruta.exists():
        ruta.write_bytes(b)
    return b


def cargar(sid: str) -> tuple[Datos, Datos, dict]:
    if not re.fullmatch(r"ds-\d{4}-\d{2}-\d{2}(-r\d+)?", sid):
        sys.exit(f"✗ «{sid}» no es un id de snapshot: se entrena con un id fijo, nunca con «latest»")
    cliente = s3()
    try:
        tarjeta = json.loads(cliente.get_object(Bucket=DATOS, Key=f"datasets/{sid}/snapshot.json")["Body"].read())
    except cliente.exceptions.NoSuchKey:
        sys.exit(f"✗ {sid} no tiene tarjeta: un snapshot sin tarjeta no existe")
    crudo = cliente.get_object(Bucket=DATOS, Key=f"datasets/{sid}/rows.parquet")["Body"].read()
    if sha256(crudo) != tarjeta["rows_sha256"]:
        sys.exit(f"✗ las filas de {sid} no coinciden con su tarjeta: alguien las reescribió")
    filas = pd.read_parquet(io.BytesIO(crudo))
    CACHE.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(16) as ex:
        tensores = list(ex.map(lambda f: preprocess(foto(cliente, f)), filas.itertuples()))
    x = torch.from_numpy(np.stack(tensores))
    y = torch.tensor(filas["label_id"].to_numpy(), dtype=torch.int64)
    partes = {}
    for split in ("train", "val"):
        m = (filas["split"] == split).to_numpy()
        t = torch.from_numpy(m.copy())
        partes[split] = Datos(x[t], y[t], filas.loc[m, "image_sha256"].tolist())
    return partes["train"], partes["val"], tarjeta


if __name__ == "__main__":
    import PIL

    sid = sys.argv[1] if len(sys.argv) > 1 else "ds-2026-09-01"
    train, val, tarjeta = cargar(sid)
    print(f"{sid} · rows_sha256 {tarjeta['rows_sha256'][:12]}… · train {len(train)} · val {len(val)} · x {tuple(train.x.shape[1:])} {train.x.dtype}")
    ref = json.loads((RAIZ / "mundo" / "gateway" / "paridad.json").read_text())
    todas = {h: t for d in (train, val) for h, t in zip(d.shas, d.x)}
    iguales = sum(sha256(todas[r["image_sha256"]].numpy().tobytes()) == r["tensor_sha256"] for r in ref["fotos"])
    pin = re.search(r"^pillow==(\S+)", (RAIZ / "mundo" / "gateway" / "requirements.txt").read_text(), re.M | re.I).group(1)
    print(f"paridad con el gateway: {iguales}/{len(ref['fotos'])} tensores idénticos · Pillow {PIL.__version__} aquí, {pin} en el gateway")
    if iguales < len(ref["fotos"]) or PIL.__version__ != pin:
        sys.exit("✗ el entrenamiento no ve las fotos como las ve el gateway (training-serving skew)")
