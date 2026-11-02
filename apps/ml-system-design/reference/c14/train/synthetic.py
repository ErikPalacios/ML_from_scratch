"""Datos SINTÉTICOS de ventas de supermercado para los tests y la demo (caso c14). No es un simulador
de retail: es lo mínimo para que los efectos del caso existan y los tests puedan medirlos.

Qué trae, y por qué cada cosa:
- Patrón semanal (más venta viernes a domingo) y quincenas (+20 % el día de pago, +10 % el siguiente):
  un seasonal naive captura lo primero y no lo segundo, así que el modelo tiene algo que ganarle.
- Promociones planeadas (≈ 10 % de los días, 10–30 % de descuento) con elasticidad 3: −30 % → ×1.9.
- Feriados y eventos del calendario real de México (calendar_mx): víspera de feriado ×1.15, Buen Fin ×1.3
  en abarrotes y limpieza, Nochebuena ×1.5, Navidad y Año Nuevo ×0.6.
- Demanda sobredispersa (Gamma-Poisson) y ≈ 60 % de series con menos de 1 unidad/día (el caso).
- AGOTADOS correlacionados con la demanda: un periodo de 1–4 días empieza con más probabilidad durante
  una promoción (×3), y en esos días se vende solo una fracción (10–70 %) de la demanda. Esa correlación es
  la que hace caro ignorar la censura: los días que el modelo ve "bajos" son justo los de demanda alta.
- La demanda VERDADERA (`truth`), que en la vida real nunca se observa en los días agotados: los tests la
  usan para medir el sesgo de entrenar con o sin máscara.
Todos los multiplicadores son inventados para el ejemplo; no son elasticidades ni patrones medidos.
"""

from __future__ import annotations  # anotaciones como texto

import datetime as dt  # fechas
from dataclasses import dataclass  # el paquete de tablas

import numpy as np  # generador aleatorio con semilla
import pandas as pd  # tablas con los esquemas de build_features

from calendar_mx import calendar_table  # feriados, quincenas y eventos reales del calendario

WEEKLY = np.array([0.90, 0.85, 0.95, 0.95, 1.10, 1.30, 1.15])  # lunes…domingo (inventado)
CATEGORIES = {  # categoría → (perecedero, vida de anaquel en días)
    "frutas_verduras": (True, 5), "salchichoneria": (True, 10), "carnes": (True, 3),
    "abarrotes": (False, 365), "limpieza": (False, 730),
}
FORMATS = {"hiper": 1.6, "super": 1.0, "express": 0.5}  # multiplicador de volumen por formato
REGIONS = ("norte", "centro", "sur")


@dataclass
class SyntheticData:
    sales: pd.DataFrame  # store_id, sku_id, date, units (solo días con venta, como un POS)
    stock: pd.DataFrame  # store_id, sku_id, date, oos_flag (todos los días)
    promo: pd.DataFrame  # store_id, sku_id, date, price, regular_price, promo_flag (solo días de promo)
    series: pd.DataFrame  # store_id, sku_id, listed_date
    store_attrs: pd.DataFrame  # store_id, format, region
    sku_attrs: pd.DataFrame  # sku_id, category, perishable, shelf_life_days, regular_price
    truth: pd.DataFrame  # store_id, sku_id, date, demand (la verdad, sin censura)
    calendar: pd.DataFrame  # calendar_table del periodo + 14 días


def make_synthetic(n_stores: int = 6, n_skus: int = 20, start: str = "2025-01-06", days: int = 420,
                   seed: int = 0, events_cfg: dict | None = None, oos_hazard: float = 0.03,
                   new_skus: int = 2) -> SyntheticData:
    """Genera `days` días de ventas de `n_stores` × `n_skus` series. Determinista dada la semilla."""
    rng = np.random.default_rng(seed)
    start_d = pd.Timestamp(start)
    dates = pd.date_range(start_d, periods=days, freq="D")
    cfg = events_cfg or {"announced": {"buen_fin": {"dates": {}}, "hot_sale": {"dates": {}}}}
    cal = calendar_table(dates[0].date(), (dates[-1] + pd.Timedelta(days=14)).date(), cfg)
    c = cal.set_index("date").loc[dates]
    stores = pd.DataFrame({
        "store_id": [f"T{i:03d}" for i in range(n_stores)],
        "format": rng.choice(list(FORMATS), n_stores),
        "region": rng.choice(REGIONS, n_stores),
    })
    cats = rng.choice(list(CATEGORIES), n_skus)
    skus = pd.DataFrame({
        "sku_id": [f"P{i:05d}" for i in range(n_skus)],
        "category": cats,
        "perishable": [CATEGORIES[k][0] for k in cats],
        "shelf_life_days": [CATEGORIES[k][1] for k in cats],
        "regular_price": np.round(rng.uniform(15, 120, n_skus), 2),  # MXN, inventado
    })
    # Tasa base por SKU: lognormal con mediana 0.45/día → con los multiplicadores de tienda, ≈ 60 % de las
    # series vende < 1 unidad/día, como en el caso (un test lo mide)
    sku_base = rng.lognormal(np.log(0.45), 1.2, n_skus)
    store_mult = np.array([FORMATS[f] for f in stores["format"]]) * rng.lognormal(0, 0.2, n_stores)
    # Los últimos `new_skus` productos se lanzan a media historia: son los "nuevos" del caso
    launch = np.full(n_skus, 0)
    if new_skus:
        launch[-new_skus:] = rng.integers(days // 2, days - 60, new_skus)
    # Multiplicadores de calendario, comunes a todas las series
    cal_mult = WEEKLY[c["dow"].to_numpy()].copy()
    cal_mult *= np.where(c["is_payday"].to_numpy() == 1, 1.20, 1.0)
    cal_mult *= np.where(c["days_since_payday"].to_numpy() == 1, 1.10, 1.0)
    cal_mult *= np.where(c["days_to_holiday"].to_numpy() == 1, 1.15, 1.0)  # víspera del puente
    cal_mult *= np.where(c["ev_nochebuena"].to_numpy() == 1, 1.5, 1.0)
    closed_early = (c["holiday_name"].isin(["navidad", "anio_nuevo"])).to_numpy()
    cal_mult *= np.where(closed_early, 0.6, 1.0)
    buen_fin = c["ev_buen_fin"].to_numpy() == 1
    out_sales, out_stock, out_promo, out_truth, out_series = [], [], [], [], []
    for si, st in stores.iterrows():
        for ki, sk in skus.iterrows():
            lam = sku_base[ki] * store_mult[si] * cal_mult
            if sk["category"] in ("abarrotes", "limpieza"):
                lam = lam * np.where(buen_fin, 1.3, 1.0)
            # Promos planeadas: bloques de 7 días, ≈ 10 % de los días
            promo = np.zeros(days, dtype=bool)
            disc = np.zeros(days)
            for s0 in np.flatnonzero(rng.random(days) < 0.10 / 7):
                promo[s0:s0 + 7] = True
                disc[s0:s0 + 7] = rng.choice([0.10, 0.20, 0.30])
            lam = lam * (1 + 3.0 * disc * promo)  # elasticidad inventada: −30 % → ×1.9
            lam[: launch[ki]] = 0.0  # antes del lanzamiento no existe
            demand = rng.poisson(lam * rng.gamma(5.0, 1 / 5.0, days))  # Gamma-Poisson: sobredispersión
            # Agotados: periodos de 1–4 días; empiezan 3× más durante promos (más demanda que inventario)
            oos = np.zeros(days, dtype=bool)
            hazard = oos_hazard * np.where(promo, 3.0, 1.0)
            for s0 in np.flatnonzero(rng.random(days) < hazard):
                oos[s0:s0 + rng.integers(1, 5)] = True
            oos[: launch[ki]] = False
            sold = np.where(oos, np.floor(demand * rng.uniform(0.1, 0.7, days)), demand)  # censura
            key = {"store_id": st["store_id"], "sku_id": sk["sku_id"]}
            has = sold > 0
            out_sales.append(pd.DataFrame({**key, "date": dates[has], "units": sold[has]}))
            out_stock.append(pd.DataFrame({**key, "date": dates, "oos_flag": oos}))
            out_truth.append(pd.DataFrame({**key, "date": dates, "demand": demand.astype(float)}))
            price = np.round(sk["regular_price"] * (1 - disc), 2)
            out_promo.append(pd.DataFrame({**key, "date": dates[promo], "price": price[promo],
                                           "regular_price": sk["regular_price"], "promo_flag": 1}))
            out_series.append({**key, "listed_date": dates[launch[ki]]})
    return SyntheticData(
        sales=pd.concat(out_sales, ignore_index=True),
        stock=pd.concat(out_stock, ignore_index=True),
        promo=pd.concat(out_promo, ignore_index=True),
        series=pd.DataFrame(out_series),
        store_attrs=stores,
        sku_attrs=skus,
        truth=pd.concat(out_truth, ignore_index=True),
        calendar=cal,
    )


def as_date(ts) -> dt.date:
    """Timestamp → date (para imprimir y para los argumentos que piden date)."""
    return pd.Timestamp(ts).date()
