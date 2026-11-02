"""Tamaño de muestra del A/B del home (caso c08): usuarios por brazo y días para detectar +1 % de contactos.

Ejemplo numérico primero (los números del caso; los reales salen de tus logs):
  métrica por usuario: contactos con vendedores en las 2 semanas del experimento, de cualquier superficie
  línea base: media μ ≈ 1.3 (2.7 M contactos/día del home + 2.5 M de la búsqueda, × 14 días ÷ ≈ 55 M
  usuarios distintos) y desviación estándar σ ≈ 4.33 (supuesto: σ/μ ≈ 3.3, cola larga: la mayoría 0)
  efecto mínimo a detectar: +1 % relativo → δ = 0.013 contactos por usuario
  α = 0.05 (dos colas), potencia 80 % → z = 1.960 + 0.842 = 2.802 → z² = 7.849
  n por brazo = 2 × z² × σ² / δ² = 2 × 7.849 × 18.75 / 0.000169 ≈ 1,741,500 usuarios (≈ 1.74 M)
  con CUPED (ρ = 0.5 con la misma métrica de las 2 semanas anteriores, supuesto): × 0.75 ≈ 1.31 M
Con ≈ 55 M de usuarios distintos en 2 semanas sobran usuarios; lo que se discute es QUÉ fracción del
tráfico arriesgar y por cuántos días.

La fórmula (test z de dos muestras, medias, varianzas iguales):  n = 2 (z_{1−α/2} + z_{1−β})² σ² / δ²

Tres trampas que este archivo hace explícitas:
  1. UNIDAD DE ANÁLISIS = UNIDAD DE ALEATORIZACIÓN. Se aleatoriza por usuario, así que cada usuario
     aporta UN número. "Contactos por DAU" como total de contactos ÷ total de usuarios-día es un cociente
     de sumas: tratar cada usuario-día como independiente subestima la varianza (los días de una misma
     persona se parecen) y da p-values demasiado optimistas. Para el cociente: delta_method_sd().
  2. μ Y σ DEPENDEN DE LA VENTANA. La media y la SD de "contactos en 14 días" no son las de 7 días.
     Primero se fija la duración (semanas completas: el lunes no se parece al sábado), después se mide
     μ y σ de esa ventana en datos históricos, y recién ahí se calcula n.
  3. INTERFERENCIA. Compradores de los dos brazos compiten por los mismos vendedores y los mismos ítems:
     si el tratamiento manda más contactos a un ítem, el control encuentra ese ítem ya vendido. El A/B por
     usuario puede sobreestimar (o subestimar) el efecto. Diseños por clúster (ciudades, categorías) o
     del lado del vendedor reducen el sesgo a costa de mucha más varianza: esta fórmula NO los cubre.
     Para eso hace falta el design effect del clúster, que se mide con datos propios.
"""

from __future__ import annotations  # anotaciones como texto: sintaxis moderna sin costo en runtime

import math  # ceil, sqrt
from statistics import NormalDist  # cuantiles de la normal sin scipy

Z = NormalDist()  # normal estándar


def users_per_arm(mean: float, sd: float, rel_lift: float, alpha: float = 0.05, power: float = 0.8,
                  cuped_rho: float = 0.0) -> int:
    """Usuarios por brazo para detectar un cambio relativo `rel_lift` en la media de una métrica por usuario.

    cuped_rho: correlación entre la métrica en el experimento y la misma métrica ANTES del experimento
    (CUPED). La varianza efectiva baja a σ² (1 − ρ²): con ρ = 0.5, 25 % menos usuarios. ρ se mide en tus
    datos; 0 = sin CUPED.
    """
    if mean <= 0 or sd <= 0 or rel_lift <= 0:
        raise ValueError("mean, sd y rel_lift deben ser > 0")
    if not (0 < alpha < 1 and 0 < power < 1 and 0 <= cuped_rho < 1):
        raise ValueError("alpha, power en (0, 1); cuped_rho en [0, 1)")
    z = Z.inv_cdf(1 - alpha / 2) + Z.inv_cdf(power)
    var = sd**2 * (1 - cuped_rho**2)
    delta = rel_lift * mean
    return math.ceil(2 * z**2 * var / delta**2)


def mde(mean: float, sd: float, n_per_arm: int, alpha: float = 0.05, power: float = 0.8) -> float:
    """La pregunta al revés: con n usuarios por brazo, ¿qué cambio RELATIVO mínimo se puede detectar?"""
    z = Z.inv_cdf(1 - alpha / 2) + Z.inv_cdf(power)
    return z * math.sqrt(2 * sd**2 / n_per_arm) / mean


def delta_method_sd(mean_x: float, mean_y: float, var_x: float, var_y: float, cov_xy: float) -> tuple[float, float]:
    """Para un cociente de sumas R = ΣY / ΣX con aleatorización por usuario (Y = contactos del usuario,
    X = días activos del usuario): devuelve (R, σ_efectiva) para usar en users_per_arm como si fuera
    una métrica por usuario. Delta method: Var(R̂) ≈ (σ_y² − 2R σ_xy + R² σ_x²) / (n μ_x²)."""
    r = mean_y / mean_x
    v = var_y - 2 * r * cov_xy + r**2 * var_x
    if v <= 0:
        raise ValueError("varianza no positiva: revisa las entradas")
    return r, math.sqrt(v) / mean_x


def share_needed(n_per_arm: int, unique_users_in_window: int) -> float:
    """Fracción del tráfico POR BRAZO para juntar n usuarios distintos en la ventana del experimento."""
    return n_per_arm / unique_users_in_window


def days_needed(n_per_arm: int, cumulative_unique_users: list[int], share_per_arm: float,
                min_days: int = 7, whole_weeks: bool = True) -> int | None:
    """Primer día en que el brazo junta n usuarios DISTINTOS. cumulative_unique_users[d] = usuarios
    distintos que entraron al home en los primeros d + 1 días (se mide en logs pasados: NO es DAU × días,
    porque casi todos vuelven). Redondea a semanas completas. None si la curva no alcanza.

    Ojo con la trampa 2: si el resultado cambia la duración, μ y σ cambian; se recalcula con la ventana nueva.
    """
    for d, cum in enumerate(cumulative_unique_users, start=1):
        if cum * share_per_arm >= n_per_arm:
            days = max(d, min_days)
            return math.ceil(days / 7) * 7 if whole_weeks else days
    return None


if __name__ == "__main__":
    n = users_per_arm(1.3, 4.33, 0.01)
    print(f"usuarios por brazo (μ=1.3, σ=4.33, +1 %): {n:,}")
    print(f"con CUPED ρ=0.5: {users_per_arm(1.3, 4.33, 0.01, cuped_rho=0.5):,}")
    print(f"MDE con 1,000,000 por brazo: {mde(1.3, 4.33, 1_000_000):.2%}")
