"""Lo que comparten entrenar.py y evaluar.py: leer una versión del dataset por su tag.

dvc.api lee de git (labels.csv, splits.csv) y del caché o del remoto de DVC (las fotos)
tal como estaban en ese tag, sin tocar tu carpeta de trabajo.
"""
import csv
import io

import dvc.api
import numpy as np
from PIL import Image


def cargar(tag: str, split: str):
    labels = list(csv.DictReader(io.StringIO(dvc.api.read("data/labels.csv", rev=tag))))
    splits = {f["sha256"]: f["split"] for f in csv.DictReader(io.StringIO(dvc.api.read("data/splits.csv", rev=tag)))}
    filas = [f for f in labels if splits[f["sha256"]] == split]
    X = np.array([vector(dvc.api.read(f"data/crudo/{f['archivo']}", rev=tag, mode="rb")) for f in filas])
    return X, np.array([f["clase"] for f in filas])


def vector(png: bytes) -> np.ndarray:
    """La foto como 784 números entre 0 y 1 (28 × 28 px), igual en entrenamiento y en producción."""
    return np.asarray(Image.open(io.BytesIO(png)).resize((28, 28)), float).ravel() / 255
