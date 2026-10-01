"""Validaciones deterministas de la etapa `validate` (caso c05: captura de documentos para créditos PyME).

Por qué existe este archivo: la confianza del modelo dice "qué tan seguro estoy de haber LEÍDO bien";
estas reglas dicen "lo que leí tiene sentido". Son baratas, no se equivocan de la misma forma que el
OCR y atrapan errores que la confianza no ve (un 8 leído como 3 con 0.99 de confianza rompe el
dígito verificador o la suma del CFDI). Son la segunda llave de la puerta STP.

Regla de diseño: una validación que falla NUNCA rechaza al cliente. Marca el campo y el documento va a
revisión humana con el motivo. El que decide es una persona; el código solo evita que un error pase
en silencio.

Todo es puro (sin I/O): la consulta de estatus al SAT vive en el worker, detrás de una interfaz, y
aquí solo llega su resultado.

Contenido:
  - CURP: formato, entidad, fecha y dígito verificador (posición 18).
  - RFC: persona física (13) y moral (12), fecha y dígito verificador (mod 11).
  - CLABE: 18 dígitos, pesos 3-7-1, dígito de control.
  - Montos en formato mexicano y la cuadratura del CFDI (SubTotal − Descuento + traslados − retenciones).
  - Fechas impresas ("15/03/2026", "15-MAR-2026", "15 de marzo de 2026") y antigüedad máxima.
  - Comparación de nombres entre documentos (INE contra solicitud).
"""

from __future__ import annotations

import datetime as dt
import re
import unicodedata
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from difflib import SequenceMatcher


@dataclass(frozen=True)
class ValidationResult:
    """Resultado de UNA regla. `fields` dice qué campos marcar en la tarea de revisión."""

    check: str  # nombre estable de la regla (va a métricas y a la tarea de revisión)
    ok: bool
    fields: tuple[str, ...] = ()  # campos implicados; vacío = regla a nivel documento
    reason: str = ""  # texto para el revisor (español, sin datos personales)
    detail: dict = field(default_factory=dict)  # números para depurar (ej. diferencia de montos)


def _ok(check: str, fields: tuple[str, ...] = (), **detail) -> ValidationResult:
    return ValidationResult(check=check, ok=True, fields=fields, detail=detail)


def _fail(check: str, fields: tuple[str, ...], reason: str, **detail) -> ValidationResult:
    return ValidationResult(check=check, ok=False, fields=fields, reason=reason, detail=detail)


# --------------------------------------------------------------------------------------------- CURP
# 18 caracteres: 4 letras (apellidos y nombre) + AAMMDD + sexo (H/M) + entidad (2) + 3 consonantes
# internas + diferenciador (dígito si nació antes de 2000, letra desde 2000) + dígito verificador.
# El sexo admite H y M, como python-stdnum. Si RENAPO agrega otro valor, se actualiza aquí: mientras
# tanto un CURP con otro valor va a revisión, nunca se rechaza al cliente.
CURP_RE = re.compile(r"^[A-Z]{4}\d{6}[HM][A-Z]{2}[B-DF-HJ-NP-TV-Z]{3}[0-9A-Z]\d$")

# Entidades de nacimiento válidas en la CURP (32 entidades + NE = nacido en el extranjero).
# Es la misma lista que usa python-stdnum (stdnum/mx/curp.py). Ciudad de México sigue siendo DF.
CURP_STATES = frozenset(
    "AS BC BS CC CH CL CM CS DF DG GR GT HG JC MC MN MS NE NL NT OC PL QR QT "
    "SL SP SR TC TL TS VZ YN ZS".split()
)

# Tabla de valores del dígito verificador: 0–9 valen 0–9, A=10 … N=23, Ñ/&=24, O=25 … Z=36.
# En una CURP nunca aparece Ñ (se escribe X), así que da igual qué carácter ocupe el 24.
_CURP_ALPHABET = "0123456789ABCDEFGHIJKLMN&OPQRSTUVWXYZ"


def curp_check_digit(first17: str) -> str:
    """Dígito 18 de la CURP a partir de los primeros 17 caracteres.

    Fórmula: suma = Σ valor(c_i) × (18 − i) para i = 0…16; dígito = (10 − suma mod 10) mod 10.
    Ejemplo: la CURP de ejemplo de la documentación de python-stdnum, BOXW310820HNERXN09, da 9.
    Coincide con python-stdnum en 2,000 cadenas al azar (test). RENAPO no publica el algoritmo en un
    documento de texto que hayamos podido citar; por eso la verificación es contra una implementación
    independiente y ejemplos conocidos.

    Ojo: el peso de la posición 9 (índice 8) es 10 ≡ 0 (mod 10). Cambiar ESE carácter (el primer
    dígito del día de nacimiento) no cambia el dígito verificador: el check digit no ve ese error.
    Por eso además se cruza la fecha de la CURP con la fecha de nacimiento impresa en la INE.
    """
    if len(first17) != 17:
        raise ValueError("se esperan 17 caracteres")
    total = sum(_CURP_ALPHABET.index(c) * (18 - i) for i, c in enumerate(first17))
    return str((10 - total % 10) % 10)


def curp_birth_date(curp: str) -> dt.date | None:
    """Fecha de nacimiento codificada en la CURP. El siglo sale del carácter 17: dígito → 19xx."""
    try:
        yy, mm, dd = int(curp[4:6]), int(curp[6:8]), int(curp[8:10])
        century = 1900 if curp[16].isdigit() else 2000
        return dt.date(century + yy, mm, dd)
    except (ValueError, IndexError):
        return None


def validate_curp(value: str) -> ValidationResult:
    """Valida formato, entidad, fecha y dígito verificador. No consulta a RENAPO (eso es el KYC)."""
    check, f = "curp", ("curp",)
    curp = (value or "").strip().upper()
    if not CURP_RE.match(curp):
        return _fail(check, f, "La CURP no tiene el formato de 18 caracteres esperado.")
    if curp[11:13] not in CURP_STATES:
        return _fail(check, f, f"Entidad de nacimiento desconocida en la CURP: {curp[11:13]}.")
    birth = curp_birth_date(curp)
    if birth is None:
        return _fail(check, f, "La fecha codificada en la CURP no existe.")
    expected = curp_check_digit(curp[:17])
    if curp[17] != expected:
        # No mostramos la CURP en el motivo: el revisor la ve en el recorte de la imagen.
        return _fail(check, f, "El dígito verificador de la CURP no coincide (posible error de lectura).")
    return _ok(check, f, birth_date=birth.isoformat())


def check_curp_matches_birth_date(curp: str, birth_date: dt.date | None) -> ValidationResult:
    """Cruce CURP ↔ fecha de nacimiento impresa (INE). Atrapa lo que el dígito verificador no ve."""
    check, f = "curp_fecha_nacimiento", ("curp", "fecha_nacimiento")
    coded = curp_birth_date((curp or "").strip().upper())
    if coded is None or birth_date is None:
        return _fail(check, f, "No se pudo comparar la CURP con la fecha de nacimiento.")
    if coded != birth_date:
        return _fail(check, f, "La fecha de la CURP no coincide con la fecha de nacimiento impresa.")
    return _ok(check, f)


# ---------------------------------------------------------------------------------------------- RFC
# Persona física: 4 letras + AAMMDD + homoclave (2) + dígito verificador = 13.
# Persona moral:  3 letras + AAMMDD + homoclave (2) + dígito verificador = 12.
# Las letras admiten Ñ y & (razones sociales con "&"). El dígito verificador es 0–9 o A.
RFC_FISICA_RE = re.compile(r"^[A-ZÑ&]{4}\d{6}[A-Z0-9]{2}[0-9A]$")
RFC_MORAL_RE = re.compile(r"^[A-ZÑ&]{3}\d{6}[A-Z0-9]{2}[0-9A]$")

# RFC genéricos del SAT: público en general y residentes en el extranjero. Son válidos en un CFDI pero
# NO identifican a nadie, y su último carácter no es el dígito que da el algoritmo (lo comprueba un test).
RFC_GENERICOS = frozenset({"XAXX010101000", "XEXX010101000"})

# Tabla del dígito verificador del RFC: 0–9 → 0–9, A=10 … N=23, &=24, O=25 … Z=36, espacio=37, Ñ=38.
_RFC_ALPHABET = "0123456789ABCDEFGHIJKLMN&OPQRSTUVWXYZ Ñ"


def rfc_check_digit(body: str) -> str:
    """Dígito verificador del RFC a partir de los 11 (moral) o 12 (física) caracteres previos.

    Algoritmo (el que el SAT entregó vía solicitud de transparencia y que implementa python-stdnum):
    se rellena a 12 caracteres con espacios a la izquierda (así una moral tiene un espacio al inicio),
    suma = Σ valor(c_i) × (13 − i), r = suma mod 11; dígito = "0" si r = 0, "A" si 11 − r = 10,
    si no 11 − r. Ejemplo: el RFC de pruebas del SAT EKU9003173C9 da 9.
    """
    if len(body) not in (11, 12):
        raise ValueError("se esperan 11 o 12 caracteres")
    padded = body.rjust(12)
    total = sum(_RFC_ALPHABET.index(c) * (13 - i) for i, c in enumerate(padded))
    return _RFC_ALPHABET[(11 - total % 11) % 11]


def validate_rfc(value: str, check_digit: bool = True) -> ValidationResult:
    """Valida formato, fecha y (por defecto) dígito verificador de un RFC.

    Por qué un dígito que no coincide marca y NO rechaza: python-stdnum desactiva esta verificación
    por defecto porque reporta RFC en uso con dígito inválido. Si el SAT emitió ese RFC, es real; lo
    decide una persona (o la constancia de situación fiscal), no esta regla.
    """
    check = "rfc"
    rfc = (value or "").strip().upper()
    if rfc in RFC_GENERICOS:
        # Factura a "público en general": válida para el SAT, inútil para identificar al acreditado.
        return _fail(check, (), "RFC genérico (público en general o extranjero): no identifica al contribuyente.",
                     generic=True)
    if RFC_FISICA_RE.match(rfc):
        date_part, kind = rfc[4:10], "fisica"
    elif RFC_MORAL_RE.match(rfc):
        date_part, kind = rfc[3:9], "moral"
    else:
        return _fail(check, (), "El RFC no tiene formato de persona física (13) ni moral (12).")
    try:
        # El siglo no está en el RFC: solo validamos que mes y día existan (año bisiesto: 2000 lo es).
        dt.date(2000 + int(date_part[:2]), int(date_part[2:4]), int(date_part[4:6]))
    except ValueError:
        return _fail(check, (), "La fecha codificada en el RFC no existe.")
    if check_digit and rfc[-1] != rfc_check_digit(rfc[:-1]):
        return _fail(check, (), "El dígito verificador del RFC no coincide (error de lectura o RFC antiguo).",
                     kind=kind)
    return _ok(check, (), kind=kind)


def validate_rfc_field(field_name: str, value: str) -> ValidationResult:
    """Igual que validate_rfc, pero etiquetado con el campo (emisor_rfc, receptor_rfc, rfc…)."""
    r = validate_rfc(value)
    return ValidationResult(check=f"rfc:{field_name}", ok=r.ok, fields=(field_name,), reason=r.reason,
                            detail=r.detail)


# -------------------------------------------------------------------------------------------- CLABE
# 18 dígitos: banco (3) + plaza (3) + cuenta (11) + dígito de control (1).
# Dígito de control: pesos 3, 7, 1 repetidos sobre los 17 primeros; se suma (dígito × peso) mod 10,
# y control = (10 − suma mod 10) mod 10. Como 3, 7 y 1 son coprimos con 10, CUALQUIER error en un
# solo dígito cambia el control: para la CLABE, el dígito verificador sí atrapa todo cambio de un dígito
# (no todas las transposiciones). Ejemplo de Wikipedia: 032180000118359719 → control 9.
CLABE_RE = re.compile(r"^\d{18}$")
_CLABE_WEIGHTS = (3, 7, 1) * 6


def clabe_check_digit(first17: str) -> str:
    if len(first17) != 17 or not first17.isdigit():
        raise ValueError("se esperan 17 dígitos")
    total = sum((int(d) * w) % 10 for d, w in zip(first17, _CLABE_WEIGHTS))
    return str((10 - total % 10) % 10)


def validate_clabe(value: str) -> ValidationResult:
    """Formato y dígito de control. No sabe si la cuenta existe ni de quién es: eso lo confirma el
    banco (por ejemplo, un depósito de prueba) fuera de este pipeline."""
    check, f = "clabe", ("clabe",)
    clabe = re.sub(r"[\s-]", "", value or "")
    if not CLABE_RE.match(clabe):
        return _fail(check, f, "La CLABE debe tener 18 dígitos.")
    if clabe[17] != clabe_check_digit(clabe[:17]):
        return _fail(check, f, "El dígito de control de la CLABE no coincide.")
    return _ok(check, f, bank_code=clabe[:3])


# ------------------------------------------------------------------------------------------- montos
_AMOUNT_RE = re.compile(r"^-?\d{1,3}(,\d{3})*(\.\d+)?$|^-?\d+(\.\d+)?$")


def parse_monto(text: str) -> Decimal | None:
    """'$12,345.67' → Decimal('12345.67'). Formato mexicano: coma de miles, punto decimal.

    Decimal, nunca float: 0.1 + 0.2 != 0.3 en float, y una diferencia de un centavo en una suma de
    impuestos no puede depender del redondeo binario. Devuelve None si el texto no es un monto limpio
    (mejor ir a revisión que adivinar si "1.234" es mil doscientos o uno punto dos).
    """
    if text is None:
        return None
    t = str(text).strip().replace("$", "").replace("MXN", "").replace(" ", "")
    if not _AMOUNT_RE.match(t):
        return None
    try:
        return Decimal(t.replace(",", ""))
    except InvalidOperation:
        return None


CENT = Decimal("0.01")


def check_cfdi_totals(
    subtotal: Decimal,
    total: Decimal,
    descuento: Decimal = Decimal("0"),
    trasladados: Decimal = Decimal("0"),
    retenidos: Decimal = Decimal("0"),
    locales_trasladados: Decimal = Decimal("0"),
    locales_retenidos: Decimal = Decimal("0"),
    tolerance: Decimal = CENT,
) -> ValidationResult:
    """Total = SubTotal − Descuento + TotalImpuestosTrasladados − TotalImpuestosRetenidos
    (+ traslados locales − retenciones locales, si la factura trae el complemento de impuestos locales).

    Ejemplo: 10,000.00 − 500.00 + 1,520.00 (IVA 16 % de 9,500) − 118.75 (retención) = 10,901.25.

    Por qué importa más en facturas leídas por OCR que en el XML: el PAC ya validó el XML al timbrarlo,
    pero un dígito mal leído en el PDF rompe la ecuación. Es el detector de errores más barato que hay.
    La tolerancia de un centavo absorbe redondeos por concepto; súbela solo si mides que hace falta.
    """
    check = "cfdi_totales"
    fields = ("subtotal", "descuento", "iva", "retenciones", "total")
    computed = (subtotal - descuento + trasladados - retenidos + locales_trasladados - locales_retenidos)
    computed = computed.quantize(CENT, rounding=ROUND_HALF_UP)
    diff = (total - computed).copy_abs()
    if diff > tolerance:
        return _fail(check, fields,
                     f"Los montos no cuadran: subtotal − descuento + impuestos − retenciones = {computed}, "
                     f"total leído = {total} (diferencia {diff}).",
                     computed=str(computed), diff=str(diff))
    return _ok(check, fields, computed=str(computed))


# ------------------------------------------------------------------------------------------- fechas
_MESES = {
    "ENE": 1, "ENERO": 1, "FEB": 2, "FEBRERO": 2, "MAR": 3, "MARZO": 3, "ABR": 4, "ABRIL": 4,
    "MAY": 5, "MAYO": 5, "JUN": 6, "JUNIO": 6, "JUL": 7, "JULIO": 7, "AGO": 8, "AGOSTO": 8,
    "SEP": 9, "SEPT": 9, "SEPTIEMBRE": 9, "SET": 9, "OCT": 10, "OCTUBRE": 10, "NOV": 11, "NOVIEMBRE": 11,
    "DIC": 12, "DICIEMBRE": 12,
}


def _strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def parse_fecha_mx(text: str) -> dt.date | None:
    """Fechas como se imprimen en México. Siempre día/mes/año: '03/04/2026' es 3 de abril.

    Acepta '15/03/2026', '15-03-2026', '15.03.2026', '15-MAR-2026', '15 MAR 2026',
    '15 de marzo de 2026' y la ISO '2026-03-15' (la del CFDI). Devuelve None si es ambigua o no existe:
    una fecha adivinada que pasa a STP es peor que una fecha que va a revisión.
    """
    if not text:
        return None
    t = _strip_accents(str(text)).upper().strip()
    t = re.sub(r"\s+DE\s+", " ", t)
    try:
        m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})(T.*)?", t)
        if m:
            return dt.date(int(m[1]), int(m[2]), int(m[3]))
        m = re.fullmatch(r"(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})", t)
        if m:
            return dt.date(int(m[3]), int(m[2]), int(m[1]))
        m = re.fullmatch(r"(\d{1,2})[\s/.-]+([A-Z]+)\.?[\s/.-]+(\d{4})", t)
        if m and m[2] in _MESES:
            return dt.date(int(m[3]), _MESES[m[2]], int(m[1]))
    except ValueError:  # 31/02/2026 y similares
        return None
    return None


def check_recent(field_name: str, doc_date: dt.date | None, today: dt.date, max_age_days: int) -> ValidationResult:
    """Antigüedad máxima (ej. comprobante de domicilio ≤ 90 días: es política del otorgante, configurable)
    y nunca en el futuro (una fecha futura casi siempre es un año mal leído)."""
    check, f = f"antiguedad:{field_name}", (field_name,)
    if doc_date is None:
        return _fail(check, f, "No se pudo leer la fecha del documento.")
    if doc_date > today:
        return _fail(check, f, "La fecha del documento está en el futuro (¿año mal leído?).")
    age = (today - doc_date).days
    if age > max_age_days:
        return _fail(check, f, f"El documento tiene {age} días; el máximo es {max_age_days}.", age_days=age)
    return _ok(check, f, age_days=age)


def check_vigencia_anual(vigencia_year: int | None, today: dt.date) -> ValidationResult:
    """Vigencia impresa como año (INE: 'VIGENCIA 2030'). Supuesto: vale hasta el 31 de diciembre de ese
    año. Confírmalo con el área de cumplimiento/KYC antes de usarlo: es política, no código."""
    check, f = "vigencia", ("vigencia",)
    if vigencia_year is None:
        return _fail(check, f, "No se pudo leer la vigencia.")
    if vigencia_year < today.year:
        return _fail(check, f, f"La identificación venció en {vigencia_year}.")
    if vigencia_year > today.year + 15:  # una INE no dura tanto: casi seguro un dígito mal leído
        return _fail(check, f, "La vigencia es implausible (¿año mal leído?).")
    return _ok(check, f)


# ------------------------------------------------------------------------------------------ nombres
def normalize_name(name: str) -> str:
    """Mayúsculas, sin acentos, sin puntuación, espacios colapsados. 'José  Pérez-Núñez' → 'JOSE PEREZ NUNEZ'."""
    s = _strip_accents(name or "").upper()
    s = re.sub(r"[^A-Z0-9Ñ ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def name_similarity(a: str, b: str) -> float:
    """Similitud 0–1 sin importar el orden de las palabras ('PEREZ GOMEZ JUANA' = 'JUANA PEREZ GOMEZ')."""
    ta, tb = sorted(normalize_name(a).split()), sorted(normalize_name(b).split())
    return SequenceMatcher(None, " ".join(ta), " ".join(tb)).ratio()


def check_names_match(field_a: str, name_a: str, field_b: str, name_b: str, threshold: float = 0.90) -> ValidationResult:
    """Cruce entre documentos: el nombre de la INE ≈ el nombre en la solicitud.

    0.90 es ilustrativo: calíbralo con pares reales (mismo titular / distinto titular) del gold set.
    Muy alto → cada segundo nombre omitido va a revisión; muy bajo → "JUAN PEREZ" pasa por "JUANA PEREZ".
    """
    check, f = f"nombre:{field_a}~{field_b}", (field_a, field_b)
    sim = name_similarity(name_a, name_b)
    if sim < threshold:
        return _fail(check, f, f"Los nombres no coinciden entre documentos (similitud {sim:.2f}).",
                     similarity=round(sim, 3))
    return _ok(check, f, similarity=round(sim, 3))
