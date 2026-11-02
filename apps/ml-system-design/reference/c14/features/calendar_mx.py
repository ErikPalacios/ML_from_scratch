"""Calendario de México para el pronóstico de demanda (caso c14).

Por qué existe este archivo: la mitad de los "picos raros" de un supermercado mexicano no son ruido, son
calendario. La quincena, el puente del lunes, el Buen Fin o la semana antes de Día de Muertos mueven la
demanda de forma predecible, y el modelo solo puede aprender ese efecto si cada día trae la etiqueta
correcta. Un calendario mal hecho es leakage al revés: el modelo ve un pico, no tiene con qué explicarlo y
lo reparte como ruido entre todas las features.

Tres tipos de fechas, tres fuentes distintas (y por eso tres funciones distintas):

1. Días de descanso obligatorio: Ley Federal del Trabajo, art. 74 (texto vigente consultado en la versión
   de la Cámara de Diputados, última reforma DOF 14-05-2026). Tienen regla fija:
     I    1 de enero
     II   primer lunes de febrero (conmemora el 5 de febrero)
     III  tercer lunes de marzo (conmemora el 21 de marzo)
     IV   1 de mayo
     V    16 de septiembre
     VI   tercer lunes de noviembre (conmemora el 20 de noviembre)
     VII  1 de octubre de cada seis años, cuando hay transmisión del Poder Ejecutivo Federal
          (fracción reformada DOF 30-09-2024: antes decía 1 de diciembre; el primero con la regla nueva
          fue el 1 de octubre de 2024, y cae dentro de la historia de 2 años del caso)
     VIII 25 de diciembre
     IX   el día de la jornada electoral que fijen las leyes electorales (federales y locales), en
          elecciones ordinarias → no tiene regla aquí: va en la configuración por año.
   Trampa: Jueves y Viernes Santo NO están en el art. 74. Para la venta sí importan (mucha gente sale de
   vacaciones), así que van como EVENTO comercial (punto 2), no como día de descanso.
   Otra: el supermercado abre en los días de descanso. Lo que cambia es CÓMO compra la gente (puentes,
   viajes, reuniones), no si la tienda vende.

2. Eventos comerciales con regla fija (se calculan): Día de Muertos (1 y 2 de noviembre), Semana Santa
   (jueves y viernes antes del domingo de Pascua, que se calcula), Día de las Madres (10 de mayo en
   México), Nochebuena (24 de diciembre) y fin de año (31 de diciembre).

3. Eventos con fecha ANUNCIADA cada año (Buen Fin, Hot Sale): ninguna ley fija la fecha; la anuncian los
   organizadores (el Buen Fin, la Secretaría de Economía con el sector privado; el Hot Sale, la AMVO). Por
   eso viven en retail_events.yaml, no en el código, y si las features del horizonte tocan su ventana
   típica (los targets y los 30 días que mira hacia adelante `days_to_<evento>`) y el año no está
   configurado, `require_event_dates` falla EN VOZ ALTA: tratar el Buen Fin como un fin de semana normal
   es peor que no correr (el fallback cubre la noche; un pronóstico 30 % abajo, no).

Quincenas: los días 15 y último de cada mes (supuesto del caso). La LFT (art. 88) solo pone el plazo
máximo de pago (una semana para trabajo material, quince días para los demás), no qué día se paga cuando
la fecha cae en fin de semana. SUPUESTO de este archivo: se paga el día hábil anterior (lunes a viernes que
no sea día de descanso obligatorio), que es lo que hacen muchos empleadores. Verifícalo con TUS datos: el
pico de ventas dice qué día cobró la gente. `payday_rule="nominal"` desactiva el corrimiento.

Funciones puras (sin I/O) salvo `load_events`, que lee el YAML.
"""

from __future__ import annotations  # anotaciones como texto (tipos de Python 3.10+ en cualquier versión)

import calendar  # monthrange: último día de cada mes
import datetime as dt  # todas las fechas son datetime.date (días locales de la tienda, sin hora)
from collections.abc import Iterable  # tipos de los argumentos
from pathlib import Path  # ruta del YAML

import numpy as np  # distancias en días, vectorizadas
import pandas as pd  # la tabla de calendario que consume build_features
import yaml  # retail_events.yaml (safe_load: el YAML es dato, nunca código)

# Hasta cuántos días adelante/atrás miramos un feriado o un evento. Más allá, "lejos" (el valor tope).
# 30 cubre el horizonte (14) más la semana previa a un evento; un tope fijo hace la feature estable.
CAP_DAYS = 30

# Eventos comerciales. El orden es el de las columnas ev_<nombre> y days_to_<nombre> del calendario.
FIXED_EVENTS = ("dia_de_muertos", "semana_santa", "dia_de_las_madres", "nochebuena", "fin_de_anio")
ANNOUNCED_EVENTS = ("buen_fin", "hot_sale")
EVENT_NAMES = ANNOUNCED_EVENTS + FIXED_EVENTS

# Primer año con la fracción VII nueva (1 de octubre). Antes: 1 de diciembre de cada seis años.
OCT1_REFORM_YEAR = 2024


class MissingEventDates(RuntimeError):
    """Lo que miran las features del horizonte (o de la historia) toca la ventana típica de un evento
    anunciado sin fechas configuradas."""


# ------------------------------------------------------------------------------- reglas de fechas
def nth_weekday(year: int, month: int, weekday: int, n: int) -> dt.date:
    """El n-ésimo `weekday` (0 = lunes) del mes. Ej.: tercer lunes de marzo de 2026 → 16 de marzo."""
    first = dt.date(year, month, 1)
    offset = (weekday - first.weekday()) % 7  # días hasta el primer `weekday` del mes
    return first + dt.timedelta(days=offset + 7 * (n - 1))


def easter_sunday(year: int) -> dt.date:
    """Domingo de Pascua (calendario gregoriano), algoritmo "anónimo" de Meeus/Jones/Butcher.

    Aritmética entera pura: no depende de ninguna librería ni tabla. Los tests lo comparan con fechas
    conocidas (2024-03-31, 2025-04-20, 2026-04-05, 2027-03-28).
    """
    a = year % 19  # posición en el ciclo lunar de 19 años
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30  # epacta: edad de la luna
    i, k = divmod(c, 4)
    l = (32 + 2 * e + 2 * i - h - k) % 7  # noqa: E741 (nombre del algoritmo original)
    m = (a + 11 * h + 22 * l) // 451
    month, day = divmod(h + l - 7 * m + 114, 31)
    return dt.date(year, month, day + 1)


def federal_holidays(year: int, election_days: Iterable[dt.date] = ()) -> dict[dt.date, str]:
    """Días de descanso obligatorio del art. 74 de la LFT para `year` → {fecha: nombre}."""
    out = {
        dt.date(year, 1, 1): "anio_nuevo",  # I
        nth_weekday(year, 2, 0, 1): "constitucion",  # II: primer lunes de febrero
        nth_weekday(year, 3, 0, 3): "natalicio_juarez",  # III: tercer lunes de marzo
        dt.date(year, 5, 1): "dia_del_trabajo",  # IV
        dt.date(year, 9, 16): "independencia",  # V
        nth_weekday(year, 11, 0, 3): "revolucion",  # VI: tercer lunes de noviembre
        dt.date(year, 12, 25): "navidad",  # VIII
    }
    # VII: transmisión del Ejecutivo cada seis años. Con la regla vigente, 2024, 2030, 2036…; antes de la
    # reforma de 2024 era el 1 de diciembre (2018, 2012…). Solo importa si tu historia llega hasta allá.
    if year >= OCT1_REFORM_YEAR and (year - OCT1_REFORM_YEAR) % 6 == 0:
        out[dt.date(year, 10, 1)] = "transmision_ejecutivo"
    elif year < OCT1_REFORM_YEAR and (OCT1_REFORM_YEAR - year) % 6 == 0:
        out[dt.date(year, 12, 1)] = "transmision_ejecutivo"
    for d in election_days:  # IX: lo que diga la configuración (jornadas electorales ordinarias)
        if d.year == year:
            out[d] = "jornada_electoral"
    return out


def paydays(year: int, holidays: Iterable[dt.date] = (), rule: str = "previous_business_day") -> set[dt.date]:
    """Quincenas de `year`: días 15 y último de cada mes, corridas según `rule`.

    "previous_business_day" (SUPUESTO, ver el docstring del módulo): si cae en sábado, domingo o día de
    descanso obligatorio, se paga el día hábil anterior. "nominal": sin corrimiento.
    Ejemplo: febrero de 2026 → el 15 es domingo y el 28 es sábado: se pagan el viernes 13 y el viernes 27.
    """
    if rule not in ("previous_business_day", "nominal"):
        raise ValueError(f"payday rule desconocida: {rule!r}")
    hol = set(holidays)
    out = set()
    for month in range(1, 13):
        last = calendar.monthrange(year, month)[1]  # 28, 29, 30 o 31
        for day in (15, last):
            d = dt.date(year, month, day)
            if rule == "previous_business_day":
                while d.weekday() >= 5 or d in hol:  # 5 = sábado, 6 = domingo
                    d -= dt.timedelta(days=1)
            out.add(d)
    return out


def fixed_event_days(year: int) -> dict[str, set[dt.date]]:
    """Eventos comerciales con regla fija (se calculan; no hace falta configurarlos)."""
    easter = easter_sunday(year)
    return {
        "dia_de_muertos": {dt.date(year, 11, 1), dt.date(year, 11, 2)},
        "semana_santa": {easter - dt.timedelta(days=3), easter - dt.timedelta(days=2)},  # jueves y viernes
        "dia_de_las_madres": {dt.date(year, 5, 10)},
        "nochebuena": {dt.date(year, 12, 24)},
        "fin_de_anio": {dt.date(year, 12, 31)},
    }


# ------------------------------------------------------------------------- configuración (YAML)
def load_events(path: str | Path) -> dict:
    """Lee retail_events.yaml (la única función con I/O del archivo). Valida forma y fechas."""
    cfg = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    for name in ANNOUNCED_EVENTS:
        ev = cfg["announced"][name]  # KeyError si falta el evento entero: mejor fallar aquí
        for year, span in (ev.get("dates") or {}).items():
            start, end = span["start"], span["end"]
            if not (isinstance(start, dt.date) and isinstance(end, dt.date) and start <= end):
                raise ValueError(f"{name} {year}: fechas inválidas {span!r}")
            if start.year != int(year):
                raise ValueError(f"{name} {year}: la fecha de inicio es de otro año ({start})")
    cfg.setdefault("election_days", [])
    cfg.setdefault("school_vacations", [])
    return cfg


def _window_for(name: str, cfg: dict, year: int) -> tuple[dt.date, dt.date]:
    """Ventana típica (mes-día) de un evento anunciado en `year`, p. ej. el Buen Fin: 1–30 de noviembre."""
    win = cfg["announced"][name]["typical_window"]
    m1, d1 = (int(x) for x in str(win["from"]).split("-"))
    m2, d2 = (int(x) for x in str(win["to"]).split("-"))
    return dt.date(year, m1, d1), dt.date(year, m2, d2)


def require_event_dates(cfg: dict, start: dt.date, end: dt.date) -> None:
    """Falla si lo que miran las features de [start, end] toca la ventana típica de un evento anunciado
    cuyo año no está configurado.

    Lo que miran llega CAP_DAYS después de `end`: `days_to_<evento>` de un target cuenta hasta 30 días
    hacia adelante, y sin las fechas del año diría "lejos" (30) en vez de la distancia real, sin error.
    El job nocturno la llama con el horizonte (run_date + 1 … run_date + 14) y el entrenamiento con toda
    la historia. Así, en enero de 2027 el job NO exige el Buen Fin de 2027 (todavía no se anuncia), pero
    desde mediados de septiembre (run_date + 14 + 30 llega al 1 de noviembre, inicio de la ventana) sí.
    """
    look_to = end + dt.timedelta(days=CAP_DAYS)  # hasta dónde mira days_to_<evento> del último target
    missing = []
    for name in ANNOUNCED_EVENTS:
        configured = {int(y) for y in (cfg["announced"][name].get("dates") or {})}
        for year in range(start.year, look_to.year + 1):
            w0, w1 = _window_for(name, cfg, year)
            if w0 <= look_to and start <= w1 and year not in configured:  # los intervalos se cruzan
                missing.append(f"{name} {year}")
    if missing:
        raise MissingEventDates(
            "faltan fechas en retail_events.yaml para: " + ", ".join(missing)
            + f" (el rango {start}…{end}, con los {CAP_DAYS} días que mira days_to_<evento>, toca su"
            " ventana típica)"
        )


def event_days(years: Iterable[int], cfg: dict) -> dict[str, set[dt.date]]:
    """Todos los días de cada evento (fijos + anunciados) en `years`."""
    out: dict[str, set[dt.date]] = {name: set() for name in EVENT_NAMES}
    for year in years:
        for name, days in fixed_event_days(year).items():
            out[name] |= days
        for name in ANNOUNCED_EVENTS:
            span = (cfg["announced"][name].get("dates") or {}).get(year)
            if span:
                n = (span["end"] - span["start"]).days + 1
                out[name] |= {span["start"] + dt.timedelta(days=i) for i in range(n)}
    return out


# ------------------------------------------------------------------------------ tabla de calendario
def _days_to_next(dates: np.ndarray, marks: np.ndarray) -> np.ndarray:
    """Días desde cada fecha hasta la siguiente marcada (0 si es ese día), con tope CAP_DAYS.

    `dates` y `marks` son arrays ordenados de enteros (días desde 1970). searchsorted encuentra la
    siguiente marca en O(log n) por fecha, sin loops por día.
    """
    if len(marks) == 0:
        return np.full(len(dates), CAP_DAYS)
    idx = np.searchsorted(marks, dates, side="left")  # primera marca ≥ fecha
    nxt = np.where(idx < len(marks), marks[np.minimum(idx, len(marks) - 1)], dates + CAP_DAYS)
    return np.minimum(nxt - dates, CAP_DAYS)


def _days_since_last(dates: np.ndarray, marks: np.ndarray) -> np.ndarray:
    """Días desde la última fecha marcada (0 si es ese día), con tope CAP_DAYS."""
    if len(marks) == 0:
        return np.full(len(dates), CAP_DAYS)
    idx = np.searchsorted(marks, dates, side="right") - 1  # última marca ≤ fecha
    prv = np.where(idx >= 0, marks[np.maximum(idx, 0)], dates - CAP_DAYS)
    return np.minimum(dates - prv, CAP_DAYS)


def calendar_table(start: dt.date, end: dt.date, cfg: dict, payday_rule: str = "previous_business_day") -> pd.DataFrame:
    """Una fila por día entre `start` y `end` con todo lo que el modelo sabe del calendario.

    Todo esto se conoce con meses de anticipación: por eso es legítimo usar el calendario del día que se
    pronostica (target_date), a diferencia de las ventas. Columnas:
      date, dow (0 = lunes), dom, month,
      is_holiday, holiday_name, days_to_holiday, days_since_holiday,
      is_payday, days_to_payday, days_since_payday,
      ev_<evento> (0/1) y days_to_<evento> para cada evento comercial, school_vacation.
    Se calculan los años vecinos para que "días al siguiente feriado" no se corte el 31 de diciembre.
    """
    years = range(start.year - 1, end.year + 2)
    elections = list(cfg.get("election_days") or [])
    hol: dict[dt.date, str] = {}
    pays: set[dt.date] = set()
    for y in years:
        h = federal_holidays(y, elections)
        hol.update(h)
        pays |= paydays(y, h.keys(), payday_rule)
    days = pd.date_range(start, end, freq="D")
    as_int = lambda ds: np.array(sorted(d.toordinal() for d in ds), dtype=np.int64)  # noqa: E731 (días como enteros)
    di = np.array([d.toordinal() for d in days.date], dtype=np.int64)
    hol_i, pay_i = as_int(hol.keys()), as_int(pays)
    out = pd.DataFrame({
        "date": days,  # datetime64 a medianoche, el mismo tipo de `date` en todas las tablas del caso
        "dow": days.dayofweek.to_numpy(),  # el patrón semanal es la señal más fuerte del retail
        "dom": days.day.to_numpy(),
        "month": days.month.to_numpy(),
        "is_holiday": np.isin(di, hol_i).astype(np.int8),
        "holiday_name": [hol.get(d) for d in days.date],
        "days_to_holiday": _days_to_next(di, hol_i),  # la compra del puente pasa ANTES del feriado
        "days_since_holiday": _days_since_last(di, hol_i),
        "is_payday": np.isin(di, pay_i).astype(np.int8),
        "days_to_payday": _days_to_next(di, pay_i),
        "days_since_payday": _days_since_last(di, pay_i),  # el gasto cae conforme pasa la quincena
    })
    evs = event_days(years, cfg)
    for name in EVENT_NAMES:
        ev_i = as_int(evs[name])
        out[f"ev_{name}"] = np.isin(di, ev_i).astype(np.int8)
        out[f"days_to_{name}"] = _days_to_next(di, ev_i)  # p. ej. pan de muerto: la venta sube antes
    vac = np.zeros(len(days), dtype=np.int8)
    for span in cfg.get("school_vacations") or []:  # periodos de la SEP, si los configuraste
        vac |= ((days.date >= span["start"]) & (days.date <= span["end"])).astype(np.int8)
    out["school_vacation"] = vac
    return out


# Columnas del calendario que entran al modelo (holiday_name es para leer, no para el modelo).
CALENDAR_FEATURES = (
    ["dow", "dom", "month", "is_holiday", "days_to_holiday", "days_since_holiday",
     "is_payday", "days_to_payday", "days_since_payday", "school_vacation"]
    + [f"ev_{n}" for n in EVENT_NAMES] + [f"days_to_{n}" for n in EVENT_NAMES]
)
