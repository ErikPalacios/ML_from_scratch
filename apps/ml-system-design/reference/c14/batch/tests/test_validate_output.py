"""Tests del gate: cada regla dispara exactamente en su borde, y el fallback solo pasa por la estructura."""

import numpy as np
import pandas as pd
import pytest

from validate_output import GateContext, validate

RUN = pd.Timestamp("2026-10-15")


def forecast(n_series=100, p50=1.0, p90=2.0):
    """n_series SKUs en una tienda × 14 horizontes; la mitad lácteos y la mitad abarrotes."""
    rows = [{"run_date": RUN, "store_id": "T1", "sku_id": f"P{i:03d}", "target_date": RUN + pd.Timedelta(days=h),
             "horizon": h, "p50": p50, "p90": p90, "model_version": "m1", "imputed_input": False,
             "fallback": False, "new_item": False} for i in range(n_series) for h in range(1, 15)]
    return pd.DataFrame(rows)


def ctx(n_series=100, ref=None, explained=frozenset(), imputed=0.0, **kw):
    cats = pd.DataFrame({"sku_id": [f"P{i:03d}" for i in range(n_series)],
                         "category": ["lacteos" if i % 2 else "abarrotes" for i in range(n_series)]})
    # referencia por defecto = exactamente lo pronosticado: 50 SKUs × 7 días × 1.0 = 350 por categoría
    ref = ref if ref is not None else pd.DataFrame({"category": ["lacteos", "abarrotes"], "ref_7d": [350.0, 350.0]})
    return GateContext(expected_series=n_series, sku_category=cats, category_reference=ref,
                       explained_categories=frozenset(explained), imputed_store_share=imputed, **kw)


def test_a_clean_night_passes_every_rule():
    res = validate(forecast(), ctx())
    assert res.ok and res.failed == []
    assert {c.name for c in res.checks} == {"row_count", "unique_keys", "nulls", "negatives", "quantile_order",
                                            "category_band", "imputed_stores"}


def test_row_count_tolerance_is_half_a_percent():
    fc = forecast()  # 1,400 filas esperadas
    assert validate(fc.iloc[7:], ctx()).ok  # faltan 7 = 0.5 %: dentro
    res = validate(fc.iloc[8:], ctx())  # faltan 8 = 0.57 %: fuera
    assert res.failed == ["row_count"] and "1392 filas vs 1400" in res.checks[4].detail


def test_duplicates_nulls_negatives_and_crossed_quantiles():
    fc = forecast()
    dup = pd.concat([fc, fc.iloc[[0]]])  # misma (tienda, SKU, día) dos veces: el ERP pediría doble
    assert "unique_keys" in validate(dup, ctx()).failed
    nul = fc.copy()
    nul.loc[3, "p50"] = np.nan
    assert validate(nul, ctx()).failed == ["nulls"]
    neg = fc.copy()
    neg.loc[5, ["p50", "p90"]] = [-1.0, 0.5]
    assert validate(neg, ctx()).failed == ["negatives"]
    crossed = fc.copy()
    crossed.loc[9, "p90"] = 0.5  # p90 < p50 = 1.0
    res = validate(crossed, ctx())
    assert res.failed == ["quantile_order"] and next(c for c in res.checks if c.name == "quantile_order").failures == 1


def test_category_band_is_plus_minus_30_percent():
    # lácteos pronostica 350 en 7 días; con referencia 270 → 1.296× (dentro); con 269 → 1.301× (fuera)
    inside = pd.DataFrame({"category": ["lacteos", "abarrotes"], "ref_7d": [270.0, 350.0]})
    outside = pd.DataFrame({"category": ["lacteos", "abarrotes"], "ref_7d": [269.0, 350.0]})
    assert validate(forecast(), ctx(ref=inside)).ok
    res = validate(forecast(), ctx(ref=outside))
    assert res.failed == ["category_band"] and "lacteos: 1.30×" in res.checks[5].detail
    low = pd.DataFrame({"category": ["lacteos", "abarrotes"], "ref_7d": [350.0, 520.0]})  # 0.67×
    assert validate(forecast(), ctx(ref=low)).failed == ["category_band"]


def test_a_promo_or_holiday_widens_the_band_but_does_not_remove_it():
    buen_fin = pd.DataFrame({"category": ["lacteos", "abarrotes"], "ref_7d": [140.0, 350.0]})  # 2.5×
    assert validate(forecast(), ctx(ref=buen_fin)).failed == ["category_band"]
    res = validate(forecast(), ctx(ref=buen_fin, explained={"lacteos"}))
    assert res.ok and "explicadas por promo o calendario: lacteos" in res.checks[5].detail
    # piezas contra cajas (10×) bloquea aunque la categoría esté "explicada"
    cases = pd.DataFrame({"category": ["lacteos", "abarrotes"], "ref_7d": [35.0, 350.0]})
    assert validate(forecast(), ctx(ref=cases, explained={"lacteos"})).failed == ["category_band"]
    tenth = pd.DataFrame({"category": ["lacteos", "abarrotes"], "ref_7d": [3500.0, 350.0]})
    assert validate(forecast(), ctx(ref=tenth, explained={"lacteos"})).failed == ["category_band"]


def test_category_without_reference_does_not_vote():
    only_one = pd.DataFrame({"category": ["abarrotes"], "ref_7d": [350.0]})  # lácteos es nueva
    assert validate(forecast(), ctx(ref=only_one)).ok


def test_imputed_store_share_limit_is_five_percent():
    assert validate(forecast(), ctx(imputed=0.05)).ok
    assert validate(forecast(), ctx(imputed=0.0525)).failed == ["imputed_stores"]  # 21 de 400 tiendas


def test_fallback_only_checks_structure():
    fc = forecast().iloc[100:]  # le faltan filas (p. ej. sin el día 14 del naive)
    loose = GateContext(expected_series=100, imputed_store_share=0.5, structural_only=True)
    assert validate(fc, loose).ok
    broken = fc.copy()
    broken.loc[broken.index[0], "p50"] = np.nan
    assert validate(broken, loose).failed == ["nulls"]  # ni el fallback se publica roto


@pytest.mark.parametrize("col", ["p50", "p90", "store_id", "target_date", "model_version"])
def test_any_null_key_or_value_blocks(col):
    fc = forecast()
    fc[col] = fc[col].astype(object)
    fc.loc[0, col] = None
    assert "nulls" in validate(fc, ctx()).failed
