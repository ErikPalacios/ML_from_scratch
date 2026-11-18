"""Paso «paridad»: ¿el engine que se va a servir responde lo mismo que el checkpoint que aprobó el gate?

    python pipeline/paridad.py                 # el engine de artefactos/v4/
    python pipeline/paridad.py --prueba int8   # el de artefactos/v4-int8/

Contrato:
- engine.yaml revisado y en un commit. El engine.onnx tiene que ser el de su engine.json (misma huella), construido con
  el runtime del servidor.
- El contrato con el servidor (mundo/servidor/classifier.yaml): una entrada con ese nombre, float32, forma
  [batch, 3, 32, 32] con el batch variable; una salida con ese nombre, [batch, 10]; y el engine acepta hasta
  max_batch_size fotos juntas. Si no cuadra, se detiene: el servidor no podría cargarlo.
- La referencia es PyTorch FP32 en eval(), con los pesos de la versión (huella = la de engine.json).
- El examen es el golden set completo de engine.yaml (manifest con su huella). El engine corre en lotes de max_batch_size.
- Tres números contra los umbrales de engine.yaml: a1 (acuerdo top-1), o5 (solapamiento top-5) y d (diferencia
  máxima de logits). Si alguno no pasa, código 1 y el motivo.
- Deja paridad.json: los tres números, los umbrales, pasa, el motivo y las fotos que cambiaron de top-1.
"""
from __future__ import annotations

import argparse
import io
import sys

import numpy as np
import torch
from _comun import (CLASES, MODELO, RAIZ, bajar, carpeta, contrato, corrida, escribir_json, git, huella_pesos, leer_json,
                    manifest, mlflow_cliente, receta, revisiones, runtime_servidor, s3, sesion, sha256, sha_archivo, tensores)

from mundo.arquitectura import construir_modelo

ap = argparse.ArgumentParser()
ap.add_argument("--prueba")
a = ap.parse_args()

# 1 · La receta y el engine, con sus huellas
r, cfg, firma = receta(), corrida(), contrato()
receta_sha = sha256((RAIZ / "engine.yaml").read_bytes())
if git("status", "--porcelain", "--", "engine.yaml") or receta_sha not in {x["engine_yaml_sha256"] for x in revisiones()}:
    sys.exit("✗ engine.yaml no es una versión revisada y en un commit: git status, git log -p engine.yaml")
version = cfg["challenger"]
d_ = carpeta(version, a.prueba)
info = leer_json(d_ / "engine.json")
if not info or not (d_ / "engine.onnx").exists():
    sys.exit(f"✗ falta {d_.name}/engine.onnx con su engine.json: corre pipeline/construir.py")
if sha_archivo(d_ / "engine.onnx") != info["engine_sha256"]:
    sys.exit("✗ engine.onnx no es el de engine.json (otra huella): vuelve a construirlo")
if info["onnxruntime"] != runtime_servidor():
    sys.exit(f"✗ el engine se construyó con onnxruntime {info['onnxruntime']} y el servidor corre {runtime_servidor()}: reconstrúyelo")

# 2 · El contrato con el servidor
ses = sesion(d_ / "engine.onnx")
e, o = ses.get_inputs(), ses.get_outputs()
esperado = f"{firma['entrada']['nombre']} float32 [batch, {', '.join(map(str, firma['entrada']['forma']))}] → " \
           f"{firma['salida']['nombre']} float32 [batch, {', '.join(map(str, firma['salida']['forma']))}]"
tiene = f"{e[0].name} {e[0].type} {e[0].shape} → {o[0].name} {o[0].type} {o[0].shape}"
if (len(e), len(o)) != (1, 1) or e[0].name != firma["entrada"]["nombre"] or o[0].name != firma["salida"]["nombre"] \
        or e[0].type != "tensor(float)" or o[0].type != "tensor(float)" or not isinstance(e[0].shape[0], str) \
        or e[0].shape[1:] != firma["entrada"]["forma"] or o[0].shape[1:] != firma["salida"]["forma"] \
        or info["batch_max"] < firma["max_batch_size"]:
    sys.exit(f"✗ el engine no cumple el contrato del servidor (mundo/servidor/classifier.yaml)\n  espera: {esperado} · "
             f"hasta {firma['max_batch_size']} fotos\n  tiene:  {tiene} · batch_max {info['batch_max']}")
print(f"  contrato: {tiene} · batch hasta {firma['max_batch_size']} = mundo/servidor/classifier.yaml")

# 3 · La referencia: PyTorch FP32 con los pesos de la versión
c = mlflow_cliente()
mv = c.get_model_version(MODELO, str(version))
pesos = torch.load(io.BytesIO(bajar(mv.run_id, "modelo/pesos.pt")), map_location="cpu", weights_only=True)
if huella_pesos(pesos) != info["pesos_sha256"] or info["pesos_sha256"] != mv.tags.get("pesos_sha256"):
    sys.exit(f"✗ los pesos de v{version} no son los que se exportaron (otra huella)")
modelo = construir_modelo(len(CLASES))
modelo.load_state_dict(pesos)
modelo.eval()

# 4 · El examen completo, en los dos
s = s3()
b, fotos = manifest(s, f"golden/{r['paridad']['examen']}/manifest.json")
if sha256(b) != r["paridad"]["manifest_sha256"]:
    sys.exit("✗ el manifest del golden set no es el que congeló engine.yaml")
x = tensores(s, fotos)
with torch.no_grad():
    ref = modelo(torch.from_numpy(x)).numpy()
lote = firma["max_batch_size"]
eng = np.concatenate([ses.run(None, {e[0].name: x[i:i + lote]})[0] for i in range(0, len(x), lote)])

# 5 · Los tres números
N = len(x)
igual = ref.argmax(1) == eng.argmax(1)
a1 = float(igual.mean())
t5r, t5e = np.argsort(-ref, 1)[:, :5], np.argsort(-eng, 1)[:, :5]
o5 = float(np.mean([len(set(p) & set(q)) / 5 for p, q in zip(t5r, t5e)]))
d = float(np.abs(ref - eng).max())
p = r["paridad"]
motivos = [m for m, mal in ((f"acuerdo top-1 {a1:.1%} < {p['a1_min']:.1%}", a1 < p["a1_min"]),
                            (f"solapamiento top-5 {o5:.2%} < {p['o5_min']:.0%}", o5 < p["o5_min"]),
                            (f"diferencia máxima de logits {d:.3f} > {p['d_max']}", d > p["d_max"])) if mal]
ordenados = np.sort(ref, 1)
cambios = [{"id": fotos[i]["id"], "ref": CLASES[int(ref[i].argmax())], "engine": CLASES[int(eng[i].argmax())],
            "margen_ref": round(float(ordenados[i, -1] - ordenados[i, -2]), 4)} for i in np.flatnonzero(~igual)]
print(f"  examen {r['paridad']['examen']}: {N} fotos · engine {info['precision']} vs PyTorch FP32")
print(f"  a1 = {a1:.1%} ({int(igual.sum())}/{N}, cambian {N - int(igual.sum())}; el límite deja {int(round((1 - p['a1_min']) * N))}) · "
      f"o5 = {o5:.2%} · d = {d:.4f}")
for x_ in cambios[:5]:
    print(f"    {x_['id']}: {x_['ref']} → {x_['engine']} (margen en FP32 entre los dos primeros logits: {x_['margen_ref']})")
escribir_json(d_ / "paridad.json", {
    "version": str(version), "engine_sha256": info["engine_sha256"], "precision": info["precision"],
    "examen": r["paridad"]["examen"], "manifest_sha256": r["paridad"]["manifest_sha256"], "engine_yaml_sha256": receta_sha,
    "n": N, "a1": a1, "o5": o5, "d": d, "umbrales": p, "pasa": not motivos, "motivo": "; ".join(motivos), "cambios": cambios})
if motivos:
    sys.exit(f"✗ paridad: NO pasa · {'; '.join(motivos)}. El engine no es el modelo que aprobó el gate: no se registra")
print(f"✓ paridad: pasa · a1 {a1:.1%} ≥ {p['a1_min']:.1%} · o5 {o5:.2%} ≥ {p['o5_min']:.0%} · d {d:.4f} ≤ {p['d_max']}")
