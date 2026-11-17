"""Paso 7 · ¿Regresión o ruido? Compara dos corridas contra el ruido que ya sabes que hay entre semillas.

Uso:    python pipeline/comparar.py <corrida A> <corrida B> [--json]
Entra:  MLflow: las dos corridas (por su tag corrida) y las «semillas» de A: las corridas terminadas con los mismos
        ingredientes que A (rows_sha256, receta_sha256, champion_version y entorno_sha256) y otra semilla
Sale:   Δ = val_top1(B) − val_top1(A), en puntos porcentuales; σ, la desviación estándar (con n − 1) del val_top1 de
        las semillas, en puntos; τ = 3 × σ; el veredicto: «ruido» si |Δ| ≤ τ, «revisar» si no. Con «revisar»,
        los ingredientes que cambian entre A y B. Con --json imprime solo un JSON con las llaves
        a, b, delta, sigma, tau, n_semillas, veredicto, distintos.
Reglas: σ necesita al menos 3 semillas distintas; con menos, se detiene y dice cuántas faltan.
"""
from __future__ import annotations

import json
import statistics
import sys

from _comun import EXPERIMENTO, mlflow_cliente

INGREDIENTES = ["snapshot", "rows_sha256", "receta_sha256", "champion_version", "entorno_sha256", "commit", "pillow"]
MISMA_RECETA = ["rows_sha256", "receta_sha256", "champion_version", "entorno_sha256"]

args = [x for x in sys.argv[1:] if not x.startswith("--")]
if len(args) != 2:
    sys.exit(__doc__)
cliente = mlflow_cliente()
exp = cliente.get_experiment_by_name(EXPERIMENTO)
terminadas = cliente.search_runs([exp.experiment_id], filter_string="attributes.status = 'FINISHED'", max_results=500)


def corrida(nombre: str):
    rs = [x for x in terminadas if x.data.tags.get("corrida") == nombre]
    if not rs:
        sys.exit(f"✗ no hay una corrida terminada con el tag corrida = {nombre}")
    return rs[0]


A, Bc = corrida(args[0]), corrida(args[1])
semillas = {}
for x in terminadas:
    if all(x.data.tags.get(k) == A.data.tags.get(k) for k in MISMA_RECETA):
        semillas.setdefault(x.data.params["semilla"], x.data.metrics["val_top1"] * 100)   # una por semilla
if len(semillas) < 3:
    sys.exit(f"✗ hay {len(semillas)} semilla(s) con la receta de {args[0]}: σ necesita al menos 3 (faltan {3 - len(semillas)})")
sigma = statistics.stdev(semillas.values())
delta = (Bc.data.metrics["val_top1"] - A.data.metrics["val_top1"]) * 100
tau = 3 * sigma
veredicto = "ruido" if abs(delta) <= tau else "revisar"
distintos = [k for k in INGREDIENTES if A.data.tags.get(k) != Bc.data.tags.get(k)]
if A.data.params.get("semilla") != Bc.data.params.get("semilla"):
    distintos.append("semilla")
r = {"a": args[0], "b": args[1], "delta": round(delta, 4), "sigma": round(sigma, 4), "tau": round(tau, 4),
     "n_semillas": len(semillas), "veredicto": veredicto, "distintos": distintos}
if "--json" in sys.argv:
    print(json.dumps(r, ensure_ascii=False))
    sys.exit(0)
print(f"A {args[0]}: {A.data.metrics['val_top1'] * 100:.2f} % · B {args[1]}: {Bc.data.metrics['val_top1'] * 100:.2f} %")
print(f"Δ = {delta:+.2f} puntos · σ de {len(semillas)} semillas = {sigma:.2f} · τ = 3σ = {tau:.2f}")
print(f"→ {'ruido: |Δ| ≤ τ, la misma receta con otro azar' if veredicto == 'ruido' else 'revisar: |Δ| > τ, algo más que el azar cambió'}"
      f" · cambia entre A y B: {', '.join(distintos) or 'nada'}")
