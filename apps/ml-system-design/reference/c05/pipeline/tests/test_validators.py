"""Tests de validators.py. Los dígitos verificadores se comprueban contra ejemplos conocidos y contra
python-stdnum, una implementación independiente, en miles de cadenas al azar."""

import datetime as dt
import random
import string
from decimal import Decimal

import pytest
from stdnum.mx import curp as std_curp
from stdnum.mx import rfc as std_rfc

import validators as v

RNG = random.Random(20260930)  # semilla fija: el test es reproducible


# ------------------------------------------------------------------------------------------- CURP
def test_curp_ejemplo_stdnum():
    # Ejemplo de la documentación de python-stdnum (nacido en el extranjero en 1931: ficticio).
    assert v.curp_check_digit("BOXW310820HNERXN0") == "9"
    r = v.validate_curp("boxw310820hnerxn09 ")  # minúsculas y espacios: el OCR los produce
    assert r.ok and r.detail["birth_date"] == "1931-08-20"


def test_curp_sintetica_y_digito_incorrecto():
    assert v.validate_curp("PEGJ800101MDFRMN07").ok  # inventada, con dígito calculado
    bad = v.validate_curp("PEGJ800101MDFRMN08")
    assert not bad.ok and "dígito verificador" in bad.reason and bad.fields == ("curp",)


def _random_curp_body() -> str:
    letters = "".join(RNG.choice(string.ascii_uppercase) for _ in range(4))
    date = dt.date(1940, 1, 1) + dt.timedelta(days=RNG.randrange(0, 365 * 80))
    state = RNG.choice(sorted(v.CURP_STATES))
    cons = "".join(RNG.choice("BCDFGHJKLMNPQRSTVWXYZ") for _ in range(3))
    diff = RNG.choice(string.digits) if date.year < 2000 else RNG.choice(string.ascii_uppercase)
    return f"{letters}{date:%y%m%d}{RNG.choice('HM')}{state}{cons}{diff}"


def test_curp_coincide_con_stdnum_en_2000_al_azar():
    for _ in range(2000):
        body = _random_curp_body()
        assert v.curp_check_digit(body) == std_curp.calc_check_digit(body)


def test_curp_siglo_por_el_caracter_17():
    assert v.curp_birth_date("PEGJ800101MDFRMN07") == dt.date(1980, 1, 1)  # '0' → 19xx
    assert v.curp_birth_date("PEGJ050101MDFRMNA7") == dt.date(2005, 1, 1)  # 'A' → 20xx


@pytest.mark.parametrize("value", [
    "PEGJ800101MDFRMN0",     # 17 caracteres
    "PEGJ800101MZZRMN07",    # entidad inexistente
    "PEGJ801301MDFRMN07",    # mes 13
    "PEGJ800101MDFAMN07",    # vocal donde va consonante interna
])
def test_curp_invalidas(value):
    assert not v.validate_curp(value).ok


def test_el_digito_de_la_curp_no_ve_un_error_en_la_posicion_9():
    """La posición 9 (primer dígito del día) pesa 10 ≡ 0 mod 10: cambiarla NO cambia el dígito.
    Por eso existe el cruce con la fecha de nacimiento impresa."""
    good = "PEGJ800101MDFRMN07"
    misread = good[:8] + "2" + good[9:]  # día 01 → 21: un error de lectura plausible
    assert v.curp_check_digit(misread[:17]) == v.curp_check_digit(good[:17])
    assert v.validate_curp(misread).ok  # el dígito no lo atrapa…
    cross = v.check_curp_matches_birth_date(misread, dt.date(1980, 1, 1))
    assert not cross.ok and set(cross.fields) == {"curp", "fecha_nacimiento"}  # …el cruce sí


def test_tampoco_ve_8_por_3_en_el_anio():
    """Peso par × diferencia múltiplo de 5 ≡ 0 (mod 10): 8↔3 en la posición 5 (peso 14) pasa igual.
    1980 leído como 1930: el dígito sigue siendo 7. El cruce con la fecha impresa lo atrapa."""
    misread = "PEGJ300101MDFRMN07"
    assert v.validate_curp(misread).ok
    assert not v.check_curp_matches_birth_date(misread, dt.date(1980, 1, 1)).ok


def test_cuantas_sustituciones_de_un_caracter_no_ve_el_digito():
    """El número del docstring: de las sustituciones de UN carácter que dejan una CURP bien formada
    (formato, entidad y fecha válidos), ≈ 1 de cada 5 sigue validando."""
    good = "PEGJ800101MDFRMN07"
    alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    total = undetected = 0
    for i in range(17):
        for c in alphabet:
            s = good[:i] + c + good[i + 1:]
            if c == good[i] or not v.CURP_RE.match(s) or s[11:13] not in v.CURP_STATES or v.curp_birth_date(s) is None:
                continue
            total += 1
            undetected += v.validate_curp(s).ok
    assert (undetected, total) == (50, 235)


def test_curp_etiquetada_con_su_campo():
    r = v.validate_curp_field("curp_representante", "PEGJ800101MDFRMN07")
    assert r.ok and r.check == "curp:curp_representante" and r.fields == ("curp_representante",)
    assert not v.validate_curp_field("curp_representante", "PEGJ800101MDFRMN08").ok


# -------------------------------------------------------------------------------------------- RFC
@pytest.mark.parametrize("rfc", ["EKU9003173C9", "PSI200101AB3", "PEGJ800101AB6", "GODE561231GR8", "MAB9307148T4"])
def test_rfc_validos(rfc):
    r = v.validate_rfc(rfc)
    assert r.ok, r.reason
    assert r.detail["kind"] == ("moral" if len(rfc) == 12 else "fisica")


def test_rfc_coincide_con_stdnum_en_2000_al_azar():
    alphabet = string.ascii_uppercase + "&Ñ"
    for i in range(2000):
        n = 3 if i % 2 else 4
        body = "".join(RNG.choice(alphabet) for _ in range(n)) + "800101" + RNG.choice(string.ascii_uppercase) + RNG.choice(string.digits)
        assert v.rfc_check_digit(body) == std_rfc.calc_check_digit(body), body


def test_rfc_digito_incorrecto_marca_pero_con_motivo():
    r = v.validate_rfc("EKU9003173C8")
    assert not r.ok and "dígito verificador" in r.reason
    assert v.validate_rfc("EKU9003173C8", check_digit=False).ok  # formato y fecha sí son válidos


def test_rfc_generico_no_pasa_su_propio_digito_y_se_trata_aparte():
    # El RFC de público en general no cumple el algoritmo: por eso es un caso especial, no un error.
    assert v.rfc_check_digit("XAXX01010100") != "0"
    r = v.validate_rfc("XAXX010101000")
    assert not r.ok and r.detail["generic"] is True and "genérico" in r.reason


@pytest.mark.parametrize("value", ["EKU9013173C9", "EK9003173C9", "EKU9003173C", "EKU-900317-3C9X"])
def test_rfc_invalidos(value):
    assert not v.validate_rfc(value).ok


def test_rfc_field_etiqueta_el_campo():
    r = v.validate_rfc_field("receptor_rfc", "PSI200101AB4")
    assert not r.ok and r.fields == ("receptor_rfc",) and r.check == "rfc:receptor_rfc"


# ------------------------------------------------------------------------------------------ CLABE
def test_clabe_ejemplo_wikipedia():
    assert v.clabe_check_digit("03218000011835971") == "9"
    r = v.validate_clabe("032 180 00011835971 9")  # con espacios, como se imprime a veces
    assert r.ok and r.detail["bank_code"] == "032"


def test_clabe_detecta_todo_error_de_un_digito():
    good = "032180000118359719"
    for pos in range(17):
        for d in "0123456789":
            if d == good[pos]:
                continue
            bad = good[:pos] + d + good[pos + 1:]
            assert not v.validate_clabe(bad).ok, (pos, d)


def test_clabe_formato():
    assert not v.validate_clabe("03218000011835971").ok  # 17 dígitos
    assert not v.validate_clabe("03218000011835971X").ok


# ------------------------------------------------------------------------------- montos y CFDI
@pytest.mark.parametrize("text,expected", [
    ("$12,345.67", Decimal("12345.67")), ("10901.25", Decimal("10901.25")), ("1,000", Decimal("1000")),
    ("-118.75", Decimal("-118.75")), ("12.345,67", None), ("1,23", None), ("", None), ("abc", None),
])
def test_parse_monto(text, expected):
    assert v.parse_monto(text) == expected


def test_totales_cuadran():
    r = v.check_cfdi_totals(subtotal=Decimal("10000.00"), descuento=Decimal("500.00"), trasladados=Decimal("1520.00"),
                            retenidos=Decimal("118.75"), total=Decimal("10901.25"))
    assert r.ok and r.detail["computed"] == "10901.25"


def test_totales_un_digito_mal_leido():
    # El OCR leyó 10,961.25 en lugar de 10,901.25 (0 → 6): la confianza puede ser alta, la suma no miente.
    r = v.check_cfdi_totals(subtotal=Decimal("10000.00"), descuento=Decimal("500.00"), trasladados=Decimal("1520.00"),
                            retenidos=Decimal("118.75"), total=Decimal("10961.25"))
    assert not r.ok and r.detail["diff"] == "60.00" and "total" in r.fields


def test_totales_tolerancia_de_un_centavo_e_impuestos_locales():
    assert v.check_cfdi_totals(subtotal=Decimal("100.00"), trasladados=Decimal("16.00"), total=Decimal("116.01")).ok
    assert not v.check_cfdi_totals(subtotal=Decimal("100.00"), trasladados=Decimal("16.00"), total=Decimal("116.02")).ok
    # Con el complemento de impuestos locales (ej. 2 % local trasladado), sin sumarlo no cuadra.
    assert not v.check_cfdi_totals(subtotal=Decimal("100.00"), trasladados=Decimal("16.00"), total=Decimal("118.00")).ok
    assert v.check_cfdi_totals(subtotal=Decimal("100.00"), trasladados=Decimal("16.00"),
                               locales_trasladados=Decimal("2.00"), total=Decimal("118.00")).ok


# ----------------------------------------------------------------------------------------- fechas
@pytest.mark.parametrize("text,expected", [
    ("15/03/2026", dt.date(2026, 3, 15)), ("03/04/2026", dt.date(2026, 4, 3)),  # día/mes, siempre
    ("15-MAR-2026", dt.date(2026, 3, 15)), ("15 mar 2026", dt.date(2026, 3, 15)),
    ("15 de marzo de 2026", dt.date(2026, 3, 15)), ("1 de Septiembre de 2026", dt.date(2026, 9, 1)),
    ("2026-03-15", dt.date(2026, 3, 15)), ("2026-09-15T10:30:00", dt.date(2026, 9, 15)),
    ("31/02/2026", None), ("15/03/26", None), ("marzo 2026", None), ("", None),
])
def test_parse_fecha_mx(text, expected):
    assert v.parse_fecha_mx(text) == expected


def test_antiguedad_maxima_y_futuro():
    today = dt.date(2026, 9, 30)
    assert v.check_recent("fecha_emision", dt.date(2026, 7, 2), today, 90).ok  # 90 días justos
    old = v.check_recent("fecha_emision", dt.date(2026, 7, 1), today, 90)
    assert not old.ok and old.detail["age_days"] == 91
    assert "futuro" in v.check_recent("fecha_emision", dt.date(2027, 9, 1), today, 90).reason
    assert not v.check_recent("fecha_emision", None, today, 90).ok


def test_vigencia():
    today = dt.date(2026, 9, 30)
    assert v.check_vigencia_anual(2026, today).ok
    assert not v.check_vigencia_anual(2025, today).ok
    assert not v.check_vigencia_anual(2092, today).ok  # 2029 mal leído como 2092


# ---------------------------------------------------------------------------------------- nombres
def test_nombres_normalizacion_y_orden():
    assert v.normalize_name("  José  Pérez-Núñez ") == "JOSE PEREZ NUNEZ"
    assert v.check_names_match("nombre_completo", "PEREZ GOMEZ JUANA", "nombre_solicitante", "Juana Pérez Gómez").ok


def test_nombres_distintos_no_pasan():
    r = v.check_names_match("nombre_completo", "JUAN PEREZ GOMEZ", "nombre_solicitante", "MARIA LOPEZ RUIZ")
    assert not r.ok and r.detail["similarity"] < 0.9
