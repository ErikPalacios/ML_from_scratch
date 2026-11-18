"""La red del dojo: una ResNet chica para fotos de 32×32. En C01: torchvision.models.resnet50(weights=None, num_classes=500).

Viene dada, como en C01 viene de torchvision: tú no la escribes, la construyes con construir_modelo().
La forma es la misma idea que la ResNet-50 (un tallo, bloques residuales con atajo y una cabeza lineal), con
≈ 44 mil parámetros en lugar de ≈ 25.6 millones, para que una época tarde segundos en la CPU de tu Mac.
"""
from __future__ import annotations

import torch.nn as nn
import torch.nn.functional as F

ANCHO = 12   # canales del primer bloque; luego 24 y 48


class Bloque(nn.Module):
    """Un bloque residual: dos convoluciones y un atajo que suma la entrada a la salida."""

    def __init__(self, entra: int, sale: int, paso: int):
        super().__init__()
        self.c1 = nn.Conv2d(entra, sale, 3, paso, 1, bias=False)
        self.b1 = nn.BatchNorm2d(sale)
        self.c2 = nn.Conv2d(sale, sale, 3, 1, 1, bias=False)
        self.b2 = nn.BatchNorm2d(sale)
        self.atajo = nn.Sequential() if paso == 1 and entra == sale else nn.Sequential(
            nn.Conv2d(entra, sale, 1, paso, bias=False), nn.BatchNorm2d(sale))

    def forward(self, x):
        return F.relu(self.b2(self.c2(F.relu(self.b1(self.c1(x))))) + self.atajo(x))


class MiniResNet(nn.Module):
    def __init__(self, num_clases: int = 10, ancho: int = ANCHO):
        super().__init__()
        self.tallo = nn.Sequential(nn.Conv2d(3, ancho, 3, 1, 1, bias=False), nn.BatchNorm2d(ancho), nn.ReLU())
        self.capas = nn.Sequential(Bloque(ancho, ancho, 1), Bloque(ancho, 2 * ancho, 2), Bloque(2 * ancho, 4 * ancho, 2))
        self.fc = nn.Linear(4 * ancho, num_clases)   # la cabeza: un logit por categoría

    def forward(self, x):
        return self.fc(F.adaptive_avg_pool2d(self.capas(self.tallo(x)), 1).flatten(1))


def construir_modelo(num_clases: int = 10) -> MiniResNet:
    """La red con pesos al azar (los decide la semilla de torch). Para arrancar del champion, carga sus pesos encima."""
    return MiniResNet(num_clases)
