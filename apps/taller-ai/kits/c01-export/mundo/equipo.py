"""Cómo entrenó el equipo los modelos del registro y los candidatos de octubre (lo usan mundo/crear.py y romper.py).
No es parte de tu pipeline y no lo leas para resolver un paso: el contrato de cada paso está en pipeline/.

Es la misma receta de la estación 3 (AdamW + OneCycle, voltear, semilla fija, CPU determinista), comprimida.
"""
from __future__ import annotations

import json
import math
import sys
import tempfile
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F

from mundo.arquitectura import construir_modelo
from mundo.comun import CLASES, EXP_ENTRENAMIENTO, huella_pesos


def entrenar(xt, yt, xv, yv, epocas: int, semilla: int, lr: float = 0.003, inicio: dict | None = None):
    torch.manual_seed(semilla)
    torch.use_deterministic_algorithms(True)
    m = construir_modelo(len(CLASES))
    if inicio is not None:
        m.load_state_dict(inicio)
    pasos = math.ceil(len(yt) / 64)
    opt = torch.optim.AdamW(m.parameters(), lr=lr, weight_decay=0.0001)
    prog = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=lr, total_steps=pasos * epocas)
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


def anotar(cliente, nombre: str, params: dict, metricas: list, pesos: dict, huella: str, tags: dict, nota: str,
           labels: list | None = None) -> str:
    """Una corrida del experimento de entrenamiento con sus pesos y su labels.json, como la deja la estación 3."""
    import mlflow

    if not cliente.get_experiment_by_name(EXP_ENTRENAMIENTO):
        cliente.create_experiment(EXP_ENTRENAMIENTO)
    mlflow.set_experiment(EXP_ENTRENAMIENTO)
    with mlflow.start_run(run_name=nombre) as run:
        mlflow.log_params({**params, "corrida": nombre})
        for e, mt in enumerate(metricas):
            mlflow.log_metrics(mt, step=e)
        mlflow.set_tags({"corrida": nombre, "equipo": "true", "pesos_sha256": huella, "mlflow.note.content": nota, **tags})
        with tempfile.TemporaryDirectory() as d:
            torch.save(pesos, Path(d) / "pesos.pt")
            (Path(d) / "labels.json").write_text(json.dumps(labels or CLASES, ensure_ascii=False) + "\n")
            mlflow.log_artifacts(d, "modelo")
    return run.info.run_id


def tensores(fotos_por_key: dict, filas, preprocess):
    x = torch.from_numpy(np.stack([preprocess(fotos_por_key[k]) for k in filas["image_key"]]))
    y = torch.tensor(filas["label_id"].to_numpy(), dtype=torch.int64)
    m = torch.from_numpy((filas["split"] == "train").to_numpy().copy())
    return x[m], y[m], x[~m], y[~m]


def construir_engine(pesos: dict, carpeta: Path, opset: int = 17, batch_max: int = 32) -> dict:
    """Cómo construye el equipo un engine (la receta de engine.yaml): export clásico a ONNX con el eje 0 dinámico, pesos
    a FP16 y la optimización de ONNX Runtime guardada para esta máquina. Lo usa mundo/crear.py para el engine del
    champion. Mismos pesos + mismas versiones + misma máquina = el mismo archivo, byte por byte."""
    import os
    import platform
    import warnings

    import onnx
    import onnxruntime as ort
    from onnxruntime.transformers import float16

    from mundo.comun import sha_archivo

    carpeta.mkdir(parents=True, exist_ok=True)
    m = construir_modelo(len(CLASES))
    m.load_state_dict(pesos)
    m.eval()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        torch.onnx.export(m, (torch.zeros(1, 3, 32, 32),), str(carpeta / "model.onnx"), dynamo=False, opset_version=opset,
                          input_names=["input"], output_names=["logits"],
                          dynamic_axes={"input": {0: "batch"}, "logits": {0: "batch"}})
    fp16 = float16.convert_float_to_float16(onnx.load(str(carpeta / "model.onnx")), keep_io_types=True)
    with tempfile.TemporaryDirectory() as d:
        onnx.save(fp16, f"{d}/fp16.onnx")
        so = ort.SessionOptions()
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        so.optimized_model_filepath = str(carpeta / "engine.onnx")
        so.log_severity_level = 3
        ort.InferenceSession(f"{d}/fp16.onnx", so, providers=["CPUExecutionProvider"])
    info = {"onnx_sha256": sha_archivo(carpeta / "model.onnx"), "engine_sha256": sha_archivo(carpeta / "engine.onnx"),
            "pesos_sha256": huella_pesos(pesos), "opset": opset, "precision": "fp16", "optimizacion": "todas",
            "batch_max": batch_max, "onnxruntime": ort.__version__, "maquina": f"{platform.system()} {platform.machine()}",
            "cpu": os.popen("sysctl -n machdep.cpu.brand_string 2>/dev/null").read().strip() or platform.processor()}
    (carpeta / "engine.json").write_text(json.dumps(info, ensure_ascii=False, indent=2) + "\n")
    return info
