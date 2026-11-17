"""Cómo entrenó el equipo el champion de septiembre (lo usa mundo/crear.py). No es parte de tu pipeline y no lo
leas para resolver un paso: el contrato de cada paso está en pipeline/.
"""
from __future__ import annotations

import math
import sys

import numpy as np
import torch
import torch.nn.functional as F

from mundo.arquitectura import construir_modelo
from mundo.comun import CLASES, FOTOS, filas, huella_pesos
from mundo.gateway.preprocess import preprocess


def tensores(s, sid: str):
    from concurrent.futures import ThreadPoolExecutor

    f = filas(s, sid)
    with ThreadPoolExecutor(16) as ex:
        x = list(ex.map(lambda k: preprocess(s.get_object(Bucket=FOTOS, Key=k)["Body"].read()), f["image_key"]))
    x = torch.from_numpy(np.stack(x))
    y = torch.tensor(f["label_id"].to_numpy(), dtype=torch.int64)
    m = torch.from_numpy((f["split"] == "train").to_numpy().copy())
    return x[m], y[m], x[~m], y[~m]


def entrenar_equipo(s, sid: str, epocas: int = 4, semilla: int = 7):
    xt, yt, xv, yv = tensores(s, sid)
    torch.manual_seed(semilla)
    torch.use_deterministic_algorithms(True)
    m = construir_modelo(len(CLASES))
    pasos = math.ceil(len(yt) / 64)
    opt = torch.optim.AdamW(m.parameters(), lr=0.003, weight_decay=0.0001)
    prog = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=0.003, total_steps=pasos * epocas)
    g = torch.Generator().manual_seed(semilla)
    metricas = []
    for _ in range(epocas):
        m.train()
        orden, suma = torch.randperm(len(yt), generator=g), 0.0
        for i in range(pasos):
            idx = orden[i * 64:(i + 1) * 64]
            xb = xt[idx]
            xb = torch.where((torch.rand(len(idx), generator=g) < 0.5)[:, None, None, None], xb.flip(3), xb)
            p = F.cross_entropy(m(xb), yt[idx])
            opt.zero_grad()
            p.backward()
            opt.step()
            prog.step()
            suma += p.item() * len(idx)
        m.eval()
        with torch.no_grad():
            lo = m(xv)
        metricas.append({"train_loss": suma / len(yt), "val_loss": F.cross_entropy(lo, yv).item(),
                         "val_top1": (lo.argmax(1) == yv).float().mean().item()})
        print(f"    época {len(metricas)}/{epocas} · val_top1 {metricas[-1]['val_top1']:.4f}", file=sys.stderr)
    pesos = m.state_dict()
    return pesos, metricas, huella_pesos(pesos)
