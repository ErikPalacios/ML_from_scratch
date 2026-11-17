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
from _comun import EXPERIMENTO, mlflow_cliente  # noqa: F401

# Tu código va aquí. Respeta el contrato de arriba: verificar.py revisa exactamente eso.
raise NotImplementedError("Paso 7: todavía no está escrito")
