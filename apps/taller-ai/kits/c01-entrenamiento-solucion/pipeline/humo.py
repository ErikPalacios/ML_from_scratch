"""Paso 2 · Prueba de humo: sobreajustar un solo batch antes de gastar una hora de GPU.

Uso:    python pipeline/humo.py --snapshot ds-2026-09-01 [--lr X]
Entra:  receta.yaml                    lr, weight_decay y semilla (los de la corrida de verdad: se prueba ESA receta)
        el snapshot, con cargar() de pipeline/datos.py: las primeras 32 fotos de train, en su orden
Sale:   imprime la pérdida del primer paso junto a ln(K), y la pérdida y los aciertos al final.
        Código de salida 0 si pasa, 1 si no (así el orquestador no sigue al entrenamiento).
Reglas: la red desde cero (pesos al azar, sin champion), sin augmentation, AdamW con el lr de la receta
        (o el de --lr, para probar), hasta 150 pasos sobre el mismo batch.
        Pasa si la pérdida final es menor que 0.05 y acierta las 32.
"""
from __future__ import annotations

import argparse
import math
import sys

import torch
import torch.nn.functional as F
from _comun import CLASES, receta
from datos import cargar
from mundo.arquitectura import construir_modelo

ap = argparse.ArgumentParser()
ap.add_argument("--snapshot", required=True)
ap.add_argument("--lr", type=float)
a = ap.parse_args()
r = receta()
lr = r["lr"] if a.lr is None else a.lr

train, _, _ = cargar(a.snapshot)
x, y = train.x[:32], train.y[:32]
torch.manual_seed(r["semilla"])
modelo = construir_modelo(len(CLASES))
opt = torch.optim.AdamW(modelo.parameters(), lr=lr, weight_decay=r["weight_decay"])
modelo.train()
for paso in range(150):
    perdida = F.cross_entropy(modelo(x), y)
    if paso == 0:
        print(f"paso 0 · pérdida {perdida.item():.3f} · ln(K) = ln({len(CLASES)}) = {math.log(len(CLASES)):.3f}")
    opt.zero_grad()
    perdida.backward()
    opt.step()
with torch.no_grad():
    logits = modelo(x)
    final, aciertos = F.cross_entropy(logits, y).item(), int((logits.argmax(1) == y).sum())
ok = final < 0.05 and aciertos == 32
print(f"paso {paso + 1} · pérdida {final:.4f} · aciertos {aciertos}/32 · lr {lr} → {'✓ el código aprende' if ok else '✗ no memoriza 32 fotos: algo está roto'}")
sys.exit(0 if ok else 1)
