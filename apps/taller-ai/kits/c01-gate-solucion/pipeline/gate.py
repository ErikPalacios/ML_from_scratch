"""Paso «gate»: aplica las reglas de gate.yaml a los pares que dejó evaluar.py y decide. Si no pasa, FALLA.

    python pipeline/gate.py                          # el candidato de corrida.yaml
    python pipeline/gate.py --candidato <corrida>    # otro (después de evaluarlo)

Contrato:
- Las reglas son las de gate.yaml, y gate.yaml tiene que ser una versión revisada (su sha256 en mundo/revisiones.json)
  y estar en el último commit, sin cambios pendientes. Si no, se detiene antes de calcular nada.
- Los pares tienen que ser de esta corrida: mismo champion y mismo examen que corrida.yaml.
- Contra cada modelo de comparar_contra, en top-1 y en top-5: no inferioridad pareada, Δmin = Δ − 1.96 × SE ≥ −margen.
- Por categoría (contra el champion): falla si el recall cae más de caida_max_puntos Y la caída es significativa
  (McNemar exacto con las discrepancias de esa categoría, corregido con Holm sobre las 10).
- Por slice (contra el champion): no inferioridad pareada con el margen de los slices.
- Calibración del candidato: ECE (15 cubetas de confianza) ≤ ece_max.
- Deja reportes/<candidato>/reporte.json y una corrida en MLflow (experimento c01-gate) con el veredicto, el motivo,
  las métricas y los punteros. Si no pasa, la corrida queda FAILED y el proceso sale con código 1: el pipeline se
  pone en rojo y no sigue. Nunca «devuelve false» y deja seguir.
"""
from __future__ import annotations

import argparse
import json
import math
import sys

import numpy as np
import pandas as pd

from _comun import CLASES, EXP_GATE, RAIZ, REPORTES, corrida, gate, git, mlflow_cliente, revisiones, sha256

ap = argparse.ArgumentParser()
ap.add_argument("--candidato")
a = ap.parse_args()
cfg, g = corrida(), gate()
candidato = a.candidato or cfg["candidato"]

# 1 · Las reglas: revisadas y en un commit
if git("status", "--porcelain", "--", "gate.yaml", "corrida.yaml"):
    sys.exit("✗ gate.yaml o corrida.yaml tienen cambios sin commit: el veredicto no podría decir con qué reglas se tomó")
gate_sha = sha256((RAIZ / "gate.yaml").read_bytes())
if gate_sha not in {r["gate_yaml_sha256"] for r in revisiones()}:
    sys.exit(f"✗ gate.yaml ({gate_sha[:12]}…) no es ninguna versión revisada de mundo/revisiones.json: alguien cambió las "
             "reglas sin PR. No juzgo con reglas que nadie aprobó")

# 2 · Los pares de esta corrida
carpeta = REPORTES / candidato
ev = json.loads((carpeta / "evaluacion.json").read_text())
if str(ev["champion_version"]) != str(cfg["champion"]) or ev["examen"] != g["examen"]["id"]:
    sys.exit(f"✗ los pares de {candidato} son contra champion v{ev['champion_version']} con {ev['examen']}, y esta corrida pide "
             f"v{cfg['champion']} con {g['examen']['id']}: vuelve a correr evaluar.py")
if sha256((carpeta / "pares.parquet").read_bytes()) != ev["pares_sha256"]:
    sys.exit("✗ pares.parquet no es el que dejó evaluar.py (su huella cambió)")
p = pd.read_parquet(carpeta / "pares.parquet")
y, N = p["label_id"].to_numpy(), len(p)


def acierta(quien: str, k: int) -> np.ndarray:
    return np.array([t in top[:k] for t, top in zip(y, p[f"{quien}_top5"])])


def pareada(nuevo: np.ndarray, viejo: np.ndarray, margen: float) -> dict:
    b, c, n = int((nuevo & ~viejo).sum()), int((~nuevo & viejo).sum()), len(nuevo)
    d, se = (b - c) / n * 100, math.sqrt(b + c) / n * 100
    return {"b": b, "c": c, "n": n, "delta": round(d, 4), "se": round(se, 4), "delta_min": round(d - 1.96 * se, 4),
            "pasa": bool(d - 1.96 * se >= -margen)}


def mcnemar(b: int, c: int) -> float:
    """McNemar exacto, de dos colas: si los dos modelos fueran igual de buenos, cada discrepancia es un volado."""
    n = b + c
    return 1.0 if n == 0 else min(1.0, 2 * sum(math.comb(n, i) for i in range(min(b, c) + 1)) / 2 ** n)


motivos, r = [], {"candidato": candidato, "champion_version": ev["champion_version"],
                  "hace_3_meses_version": ev["hace_3_meses_version"], "examen": ev["examen"], "gate_yaml_sha256": gate_sha}

# 3 · No inferioridad, top-1 y top-5, contra cada modelo de comparar_contra
m = g["top1_top5"]["margen_puntos"]
r["no_inferioridad"] = {}
for ref in g["comparar_contra"]:
    for k in (1, 5):
        x = pareada(acierta("candidato", k), acierta(ref, k), m)
        r["no_inferioridad"][f"{ref}_top{k}"] = x
        print(f"[no inferioridad] vs {ref:<12} top-{k}: b {x['b']:>3} · c {x['c']:>3} · Δ {x['delta']:+.2f} · "
              f"SE {x['se']:.2f} · Δmin {x['delta_min']:+.2f} {'≥' if x['pasa'] else '<'} −{m} → {'pasa' if x['pasa'] else 'NO PASA'}")
        if not x["pasa"]:
            motivos.append(f"top-{k} contra {ref}: Δmin {x['delta_min']:+.2f} < −{m}")

# 4 · Por categoría: caída grande Y significativa (McNemar + Holm)
cg = g["categorias"]
nuevo, viejo = acierta("candidato", 1), acierta("champion", 1)
cats = []
for i, nombre in enumerate(CLASES):
    s = y == i
    b, c = int((nuevo & ~viejo & s).sum()), int((~nuevo & viejo & s).sum())
    cats.append({"categoria": nombre, "n": int(s.sum()), "recall_candidato": round(nuevo[s].mean() * 100, 2),
                 "recall_champion": round(viejo[s].mean() * 100, 2), "caida": round((viejo[s].mean() - nuevo[s].mean()) * 100, 2),
                 "b": b, "c": c, "p": mcnemar(b, c)})
orden = sorted(range(len(cats)), key=lambda i: cats[i]["p"])      # Holm: la p más chica contra α/10, la siguiente contra α/9…
maximo = 0.0
for rango, i in enumerate(orden):
    maximo = max(maximo, min(1.0, cats[i]["p"] * (len(cats) - rango)))   # p ajustada, nunca menor que la anterior
    cats[i]["p_holm"] = maximo
for x in cats:
    x["rota"] = bool(x["caida"] > cg["caida_max_puntos"] and x["p_holm"] < cg["alfa"])
    if x["rota"]:
        motivos.append(f"categoría {x['categoria']}: recall {x['recall_champion']:.1f} → {x['recall_candidato']:.1f} "
                       f"(−{x['caida']:.1f} puntos, p de Holm {x['p_holm']:.2g})")
r["categorias"] = cats
peor = max(cats, key=lambda x: x["caida"])
print(f"[categorías] la que más cae: {peor['categoria']} {peor['recall_champion']:.1f} → {peor['recall_candidato']:.1f} "
      f"(b {peor['b']} · c {peor['c']} · p de Holm {peor['p_holm']:.2g}) · rotas: {[x['categoria'] for x in cats if x['rota']] or 'ninguna'}")

# 5 · Slices
r["slices"] = {}
for nombre in g["slices"]["nombres"]:
    s = (p["slice"] == nombre).to_numpy()
    x = pareada(nuevo[s], viejo[s], g["slices"]["margen_puntos"])
    r["slices"][nombre] = x
    print(f"[slice] {nombre:<9} n {x['n']:>3} · Δ {x['delta']:+.2f} · Δmin {x['delta_min']:+.2f} → {'pasa' if x['pasa'] else 'NO PASA'}")
    if not x["pasa"]:
        motivos.append(f"slice {nombre}: Δmin {x['delta_min']:+.2f} < −{g['slices']['margen_puntos']}")

# 6 · Calibración: ¿su confianza dice la verdad?
conf = p["candidato_conf"].to_numpy()
cubeta = np.minimum((conf * 15).astype(int), 14)
ece = sum((cubeta == k).sum() / N * abs(nuevo[cubeta == k].mean() - conf[cubeta == k].mean()) for k in range(15) if (cubeta == k).any())
r["ece"] = round(float(ece), 4)
print(f"[calibración] ECE {ece:.4f} {'≤' if ece <= g['ece_max'] else '>'} {g['ece_max']}")
if ece > g["ece_max"]:
    motivos.append(f"ECE {ece:.4f} > {g['ece_max']}")

# 7 · El veredicto: en el reporte, en MLflow y en el código de salida
r["veredicto"], r["motivos"] = ("pasa" if not motivos else "no_pasa"), motivos
r["top1"] = {q: round(acierta(q, 1).mean() * 100, 2) for q in ("candidato", "champion", "hace_3_meses")}
(carpeta / "reporte.json").write_text(json.dumps(r, ensure_ascii=False, indent=2) + "\n")

import mlflow  # noqa: E402

c = mlflow_cliente()
if not c.get_experiment_by_name(EXP_GATE):
    c.create_experiment(EXP_GATE)
mlflow.set_experiment(EXP_GATE)
with mlflow.start_run(run_name=f"gate-{candidato}") as run:
    mlflow.log_params({"candidato": candidato, "champion_version": ev["champion_version"], "hace_3_meses_version": ev["hace_3_meses_version"],
                       "examen": ev["examen"], "margen_puntos": m})
    mlflow.log_metrics({f"delta_min_{k}": v["delta_min"] for k, v in r["no_inferioridad"].items()} | {"ece": r["ece"]} |
                       {f"top1_{q}": v for q, v in r["top1"].items()})
    mlflow.set_tags({"candidato": candidato, "candidato_run_id": ev["candidato_run_id"], "champion_version": str(ev["champion_version"]),
                     "examen": ev["examen"], "manifest_sha256": ev["manifest_sha256"], "gate_yaml_sha256": gate_sha,
                     "commit": git("rev-parse", "HEAD"), "veredicto": r["veredicto"], "motivo": "; ".join(motivos)[:4000] or "—"})
    mlflow.log_artifacts(str(carpeta), "reporte")
    if motivos:
        mlflow.end_run("FAILED")
if motivos:
    sys.exit("✗ NO PASA: " + " · ".join(motivos))
print(f"✓ PASA: {candidato} es no inferior a v{ev['champion_version']} y a v{ev['hace_3_meses_version']} · corrida gate-{candidato}")
