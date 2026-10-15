"""Tests del calendario: feriados del art. 74 de la LFT, quincenas con su supuesto, eventos y fechas faltantes."""

import datetime as dt
from pathlib import Path

import pytest

import calendar_mx as cm

D = dt.date
EVENTS = Path(__file__).resolve().parents[1] / "retail_events.yaml"


@pytest.fixture(scope="module")
def cfg():
    return cm.load_events(EVENTS)


def test_monday_holidays_follow_the_lft_rules():
    # 2026: primer lunes de febrero = 2, tercer lunes de marzo = 16, tercer lunes de noviembre = 16
    h = cm.federal_holidays(2026)
    assert h[D(2026, 2, 2)] == "constitucion"
    assert h[D(2026, 3, 16)] == "natalicio_juarez"
    assert h[D(2026, 11, 16)] == "revolucion"
    assert D(2026, 2, 5) not in h and D(2026, 3, 21) not in h and D(2026, 11, 20) not in h  # la fecha conmemorada no
    # 2027: el 1 de febrero y el 1 de marzo son lunes → 1 de febrero, 15 de marzo, 15 de noviembre
    h27 = cm.federal_holidays(2027)
    assert {D(2027, 2, 1), D(2027, 3, 15), D(2027, 11, 15)} <= set(h27)


def test_fixed_holidays_and_the_six_year_october_first():
    h24, h25 = cm.federal_holidays(2024), cm.federal_holidays(2025)
    assert D(2024, 10, 1) in h24  # fracción VII reformada en 2024: el primer 1 de octubre aplicado
    assert D(2025, 10, 1) not in h25  # solo cada seis años
    assert D(2030, 10, 1) in cm.federal_holidays(2030)
    assert D(2018, 12, 1) in cm.federal_holidays(2018)  # antes de la reforma: 1 de diciembre
    for d in (D(2025, 1, 1), D(2025, 5, 1), D(2025, 9, 16), D(2025, 12, 25)):
        assert d in h25
    assert len(h25) == 7  # año sin transmisión ni jornada electoral configurada


def test_holy_week_is_an_event_not_a_federal_holiday():
    assert cm.easter_sunday(2024) == D(2024, 3, 31)
    assert cm.easter_sunday(2025) == D(2025, 4, 20)
    assert cm.easter_sunday(2026) == D(2026, 4, 5)
    assert cm.easter_sunday(2027) == D(2027, 3, 28)
    assert cm.fixed_event_days(2026)["semana_santa"] == {D(2026, 4, 2), D(2026, 4, 3)}  # jueves y viernes
    assert D(2026, 4, 3) not in cm.federal_holidays(2026)  # trampa: no está en el art. 74


def test_election_day_comes_from_configuration():
    h = cm.federal_holidays(2027, election_days=[D(2027, 6, 6)])
    assert h[D(2027, 6, 6)] == "jornada_electoral"
    assert D(2027, 6, 6) not in cm.federal_holidays(2027)


def test_paydays_move_to_the_previous_business_day():
    pays = cm.paydays(2026, cm.federal_holidays(2026))
    assert D(2026, 2, 13) in pays and D(2026, 2, 15) not in pays  # el 15 es domingo → viernes 13
    assert D(2026, 2, 27) in pays and D(2026, 2, 28) not in pays  # el 28 es sábado → viernes 27
    assert D(2026, 10, 15) in pays  # jueves: sin cambio
    assert D(2026, 10, 30) in pays and D(2026, 10, 31) not in pays  # 31 sábado → 30
    assert len(pays) == 24
    # 2027: el 15 de marzo y el 15 de noviembre son lunes FERIADOS → viernes 12
    p27 = cm.paydays(2027, cm.federal_holidays(2027))
    assert D(2027, 3, 12) in p27 and D(2027, 3, 15) not in p27
    assert D(2027, 11, 12) in p27 and D(2027, 11, 15) not in p27
    # "nominal": sin corrimiento (para probar el supuesto contra tus ventas)
    assert D(2026, 2, 15) in cm.paydays(2026, rule="nominal")
    with pytest.raises(ValueError):
        cm.paydays(2026, rule="viernes")


def test_calendar_table_distances_and_events(cfg):
    cal = cm.calendar_table(D(2026, 11, 1), D(2026, 11, 30), cfg).set_index("date")
    nov = lambda d: cal.loc[f"2026-11-{d:02d}"]  # noqa: E731
    assert nov(16)["is_holiday"] == 1 and nov(16)["holiday_name"] == "revolucion"
    assert nov(13)["days_to_holiday"] == 3 and nov(17)["days_since_holiday"] == 1
    assert nov(13)["ev_buen_fin"] == 1 and nov(17)["ev_buen_fin"] == 1 and nov(18)["ev_buen_fin"] == 0
    assert nov(6)["days_to_buen_fin"] == 7
    assert nov(1)["ev_dia_de_muertos"] == 1 and nov(2)["ev_dia_de_muertos"] == 1
    assert nov(30)["is_payday"] == 1 and nov(30)["days_since_payday"] == 0
    assert nov(14)["days_since_payday"] == 1  # el 15 cae en domingo: se pagó el viernes 13
    assert nov(14)["dow"] == 5  # sábado (0 = lunes)
    # sin eventos cercanos, la distancia satura en el tope (estable para el modelo)
    jul = cm.calendar_table(D(2026, 7, 10), D(2026, 7, 10), cfg).iloc[0]
    assert jul["days_to_buen_fin"] == cm.CAP_DAYS


def test_year_boundary_does_not_cut_distances(cfg):
    cal = cm.calendar_table(D(2026, 12, 28), D(2026, 12, 31), cfg).set_index("date")
    assert cal.loc["2026-12-31", "days_to_holiday"] == 1  # 1 de enero de 2027, aunque la tabla acabe antes
    assert cal.loc["2026-12-31", "ev_fin_de_anio"] == 1


def test_missing_announced_dates_fail_loudly(cfg):
    # El horizonte de mediados de octubre de 2026 llega a noviembre: el Buen Fin 2026 está → pasa
    cm.require_event_dates(cfg, D(2026, 10, 20), D(2026, 11, 2))
    # En enero de 2027 todavía nadie anuncia el Buen Fin 2027: el horizonte no lo toca → pasa
    cm.require_event_dates(cfg, D(2027, 1, 10), D(2027, 1, 24))
    # Pero en noviembre de 2027 sin fechas configuradas → falla en voz alta
    with pytest.raises(cm.MissingEventDates, match="buen_fin 2027"):
        cm.require_event_dates(cfg, D(2027, 10, 25), D(2027, 11, 7))
    # Y entrenar con historia desde enero de 2024 exige el Hot Sale 2024 (no está a propósito)
    with pytest.raises(cm.MissingEventDates, match="hot_sale 2024"):
        cm.require_event_dates(cfg, D(2024, 1, 1), D(2026, 10, 15))
    # La historia del caso (2 años desde octubre de 2024) sí está completa
    cm.require_event_dates(cfg, D(2024, 10, 16), D(2026, 10, 29))


def test_event_config_is_validated(tmp_path):
    bad = tmp_path / "ev.yaml"
    bad.write_text(
        "announced:\n"
        "  buen_fin:\n    typical_window: {from: '11-01', to: '11-30'}\n"
        "    dates:\n      2026: {start: 2026-11-17, end: 2026-11-13}\n"  # al revés
        "  hot_sale:\n    typical_window: {from: '05-01', to: '06-15'}\n    dates: {}\n"
    )
    with pytest.raises(ValueError, match="buen_fin 2026"):
        cm.load_events(bad)
