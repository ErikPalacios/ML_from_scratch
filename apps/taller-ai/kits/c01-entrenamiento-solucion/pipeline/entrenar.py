"""Pasos 3 a 5 · El job de entrenamiento: receta + snapshot + champion → checkpoint candidato con su corrida en MLflow.

Uso:    python pipeline/entrenar.py --snapshot ds-2026-09-01 --champion 1 --corrida <id> [--semilla N]
Entra:  receta.yaml                         la receta (arranque, épocas, batch, lr, semilla, ckpt_cada_pasos…)
        el snapshot, con cargar() de pipeline/datos.py
        classifier versión <N> en MLflow    los pesos y el labels.json del champion: una VERSIÓN (un número), nunca el alias
Sale:   s3://ml-ckpt/c01/<snapshot>/<corrida>/ultimo.pt   el estado completo, cada ckpt_cada_pasos pasos
        una corrida en MLflow, experimento c01-entrenamiento, con run_name = corrida y el tag corrida:
          parámetros: los de la receta (con la semilla que se usó), snapshot, champion_version y corrida
          métricas por época (step = época, desde 0): train_loss, val_loss, val_top1
          tags: corrida, snapshot, rows_sha256, commit, arbol_limpio, entorno_sha256, preprocess_sha256, pillow,
                champion_version, receta_sha256, reanudado_desde_paso y, al final, pesos_sha256
          artefactos: modelo/pesos.pt (el state_dict) y modelo/labels.json
Reglas: solo desde un commit con el árbol limpio (pipeline/, receta.yaml, pipeline.yaml).
        Antes de gastar cómputo comprueba MLflow, el champion y los datos: si algo falta, se detiene en segundos.
        El labels.json del champion tiene que ser igual a entrada/categorias.json; si no, se detiene.
        Semilla y algoritmos deterministas: mismos ingredientes = mismos pesos, bit por bit (en CPU).
        Si ya hay un checkpoint de esta corrida, reanuda desde él, en la misma corrida de MLflow, solo si es de los
        mismos ingredientes (snapshot, receta, semilla, champion y commit); si no, se detiene.
"""
from __future__ import annotations

import argparse
import io
import json
import math
import re
import sys
import tempfile
import time
from pathlib import Path

# _comun va antes que mlflow: ajusta sus avisos y sus reintentos al importarse
from _comun import (CKPT, CLASES, EXPERIMENTO, MODELO, RAIZ, git, huella_entorno, huella_pesos, mlflow_cliente,
                    receta, s3, sha256)
import mlflow
import PIL
import torch
import torch.nn.functional as F
from datos import cargar
from mundo.arquitectura import construir_modelo

ap = argparse.ArgumentParser()
ap.add_argument("--snapshot", required=True)
ap.add_argument("--champion", required=True, help="la versión de classifier (un número)")
ap.add_argument("--corrida", required=True, help="el id de esta corrida; un reintento usa el mismo")
ap.add_argument("--semilla", type=int)
a = ap.parse_args()
if not re.fullmatch(r"\d+", a.champion):
    sys.exit(f"✗ --champion «{a.champion}»: tiene que ser un número de versión. El alias se resuelve una vez, en el "
             "orquestador; si lo resuelve cada reintento, un alias que se movió a media corrida mezcla dos modelos")
if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", a.corrida):
    sys.exit("✗ --corrida: minúsculas, números y guiones")
r = receta()
semilla = r["semilla"] if a.semilla is None else a.semilla

# 1 · El código: un commit, sin cambios a medias
commit = git("rev-parse", "HEAD")
sucio = git("status", "--porcelain", "--", "pipeline", "receta.yaml", "pipeline.yaml")
if not commit or sucio:
    sys.exit(f"✗ hay cambios sin commit ({sucio.splitlines()[0].strip() if sucio else 'no hay commits'}): "
             "la corrida no podría decir con qué código y qué receta se entrenó")

# 2 · MLflow y el champion, antes de gastar cómputo
cliente = mlflow_cliente()
try:
    exp = cliente.get_experiment_by_name(EXPERIMENTO)
except Exception as e:  # noqa: BLE001
    sys.exit(f"✗ MLflow no responde en localhost:5400 ({type(e).__name__}): sin registro no se entrena")
corrida_previa = cliente.search_runs([exp.experiment_id], filter_string=f"tags.corrida = '{a.corrida}'")
if corrida_previa and corrida_previa[0].info.status == "FINISHED":
    sys.exit(f"✗ la corrida {a.corrida} ya terminó: una corrida nueva lleva otro --corrida")
mv = cliente.get_model_version(MODELO, a.champion)
with tempfile.TemporaryDirectory() as d:
    carpeta = Path(mlflow.artifacts.download_artifacts(artifact_uri=mv.source, dst_path=d))
    labels = json.loads((carpeta / "labels.json").read_text())
    pesos_champion = torch.load(carpeta / "pesos.pt", map_location="cpu", weights_only=True)
if labels != CLASES:
    sys.exit(f"✗ el labels.json de {MODELO} v{a.champion} no tiene las categorías de entrada/categorias.json en el mismo "
             f"orden ({labels[:3]}… contra {CLASES[:3]}…): arrancar de ahí le enseñaría a la red otras clases")

# 3 · Los datos
train, val, tarjeta = cargar(a.snapshot)
receta_sha = sha256((RAIZ / "receta.yaml").read_bytes())
ingredientes = {"snapshot": a.snapshot, "rows_sha256": tarjeta["rows_sha256"], "receta_sha256": receta_sha,
                "semilla": semilla, "champion_version": a.champion, "commit": commit}

# 4 · Red, optimizador y programador, con la semilla fija
torch.manual_seed(semilla)
torch.use_deterministic_algorithms(True)
modelo = construir_modelo(len(CLASES))
if r["arranque"] == "champion":
    modelo.load_state_dict(pesos_champion)       # estricto: si una llave no coincide, falla aquí
B = r["batch"]
pasos_epoca = math.ceil(len(train) / B)
total = pasos_epoca * r["epocas"]
opt = torch.optim.AdamW(modelo.parameters(), lr=r["lr"], weight_decay=r["weight_decay"])
prog = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=r["lr"], total_steps=total)
g = torch.Generator().manual_seed(semilla)      # el orden de las fotos y la augmentation salen de aquí
epoca, i0, paso, orden, suma, n = 0, 0, 0, None, 0.0, 0

# 5 · ¿Hay checkpoint de esta corrida? Entonces se sigue, no se empieza otra
c3 = s3()
llave = f"c01/{a.snapshot}/{a.corrida}/ultimo.pt"
try:
    crudo = c3.get_object(Bucket=CKPT, Key=llave)["Body"].read()
except c3.exceptions.NoSuchKey:
    crudo = None
if crudo:
    ck = torch.load(io.BytesIO(crudo), map_location="cpu", weights_only=True)
    if ck["ingredientes"] != ingredientes:
        distintos = [k for k in ingredientes if ck["ingredientes"].get(k) != ingredientes[k]]
        sys.exit(f"✗ s3://{CKPT}/{llave} es de otros ingredientes ({', '.join(distintos)}): reanudar mezclaría dos corridas. "
                 "Usa otro --corrida")
    modelo.load_state_dict(ck["modelo"])
    opt.load_state_dict(ck["optimizador"])
    prog.load_state_dict(ck["programador"])
    g.set_state(ck["generador"])
    torch.set_rng_state(ck["rng"])
    epoca, i0, paso, orden, suma, n = ck["epoca"], ck["i"], ck["paso"], ck["orden"], ck["suma"], ck["n"]
    print(f"reanudo {a.corrida} desde el paso {paso} de {total} (época {epoca}, batch {i0}): s3://{CKPT}/{llave}")
desde = paso


def guardar() -> int:
    estado = {"modelo": modelo.state_dict(), "optimizador": opt.state_dict(), "programador": prog.state_dict(),
              "generador": g.get_state(), "rng": torch.get_rng_state(), "epoca": epoca, "i": i + 1, "paso": paso,
              "orden": orden, "suma": suma, "n": n, "ingredientes": ingredientes}
    b = io.BytesIO()
    torch.save(estado, b)
    c3.put_object(Bucket=CKPT, Key=llave, Body=b.getvalue())   # un PUT a S3 se escribe completo o no se escribe
    return len(b.getvalue())


def evaluar() -> tuple[float, float]:
    modelo.eval()
    perdida, bien = 0.0, 0
    with torch.no_grad():
        for j in range(0, len(val), 512):
            lo = modelo(val.x[j:j + 512])
            perdida += F.cross_entropy(lo, val.y[j:j + 512], reduction="sum").item()
            bien += int((lo.argmax(1) == val.y[j:j + 512]).sum())
    return perdida / len(val), bien / len(val)


# 6 · La corrida en MLflow: la misma si es un reintento (corrida_previa se buscó en el bloque 2)
mlflow.set_experiment(EXPERIMENTO)
with mlflow.start_run(run_id=corrida_previa[0].info.run_id if corrida_previa else None, run_name=a.corrida) as run:
    if not corrida_previa:
        mlflow.log_params({**r, "semilla": semilla, "snapshot": a.snapshot, "champion_version": a.champion, "corrida": a.corrida})
        mlflow.set_tags({"corrida": a.corrida, "snapshot": a.snapshot, "rows_sha256": tarjeta["rows_sha256"], "commit": commit,
                         "arbol_limpio": "true", "entorno_sha256": huella_entorno(), "pillow": PIL.__version__,
                         "preprocess_sha256": sha256((RAIZ / "mundo" / "gateway" / "preprocess.py").read_bytes()),
                         "champion_version": a.champion, "receta_sha256": receta_sha})
    mlflow.set_tag("reanudado_desde_paso", desde)
    ya = {m.step for m in cliente.get_metric_history(run.info.run_id, "val_top1")}
    while epoca < r["epocas"]:
        t0, ckpts = time.time(), 0
        if orden is None:
            orden = torch.randperm(len(train), generator=g)
        modelo.train()
        for i in range(i0, pasos_epoca):
            idx = orden[i * B:(i + 1) * B]
            xb, yb = train.x[idx], train.y[idx]
            voltear = torch.rand(len(idx), generator=g) < r["voltear"]
            xb = torch.where(voltear[:, None, None, None], xb.flip(3), xb)
            with torch.autocast("cpu", dtype=torch.bfloat16, enabled=bool(r["amp"])):
                perdida = F.cross_entropy(modelo(xb), yb)
            opt.zero_grad()
            perdida.backward()
            opt.step()
            prog.step()
            paso += 1
            suma, n = suma + perdida.item() * len(idx), n + len(idx)
            if paso % r["ckpt_cada_pasos"] == 0:
                kb = guardar() / 1e3
                ckpts += 1
        val_loss, val_top1 = evaluar()
        if epoca not in ya:
            mlflow.log_metrics({"train_loss": suma / n, "val_loss": val_loss, "val_top1": val_top1}, step=epoca)
        print(f"época {epoca + 1}/{r['epocas']} · train_loss {suma / n:.4f} · val_loss {val_loss:.4f} · val_top1 {val_top1:.4f} · "
              f"{time.time() - t0:.1f} s · {ckpts} checkpoints" + (f" de {kb:.0f} kB" if ckpts else ""))
        epoca, i0, orden, suma, n = epoca + 1, 0, None, 0.0, 0
    pesos = modelo.state_dict()
    with tempfile.TemporaryDirectory() as d:
        torch.save(pesos, Path(d) / "pesos.pt")
        (Path(d) / "labels.json").write_text(json.dumps(CLASES, ensure_ascii=False) + "\n")
        mlflow.log_artifacts(d, "modelo")
    huella = huella_pesos(pesos)
    mlflow.set_tag("pesos_sha256", huella)
print(f"✓ {a.corrida} · val_top1 {val_top1:.4f} · pesos {huella[:12]}… · run {run.info.run_id[:8]} · {a.snapshot} · "
      f"champion v{a.champion} · commit {commit[:7]}" + (f" · reanudada desde el paso {desde}" if desde else ""))
