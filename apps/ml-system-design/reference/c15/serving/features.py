"""Features del modelo de CTR (caso c15): UNA definición para training y serving.

Este archivo decide, para un par (página, anuncio), qué features ve el modelo y en qué índice cae cada una.
Lo importan el ad-api (serving/ad_api.py, en el request) y el job de entrenamiento (training/, sobre el log).
Si cada lado tuviera su copia, el primer cambio en un lado (un cruce nuevo, otro separador, otra forma de
escribir "política") movería los índices sin ningún error: el modelo vería otra cosa que en el
entrenamiento y nadie se enteraría (training-serving skew, #m09.skew).

Ejemplo, antes de la notación. Página de deportes en un celular de Nuevo León a las 8 a. m. de un martes;
la persona dio consentimiento y en 30 días leyó deportes y autos; el anuncio es de autos, formato nativo:
  features simples   "section=deportes" "device=mobile" "geo=mx-nle" "hour=8" "dow=1"
                     "interest=autos" "interest=deportes"
                     "ad_id=a123" "campaign_id=c45" "advertiser_id=v9" "ad_category=autos" "ad_format=native"
  cruces             "section=deportes|ad_category=autos"        (¿esta sección y esta categoría?)
                     "interest=autos|ad_category=autos"          (¿le interesa lo que anuncia?)
                     "interest=deportes|ad_category=autos"
                     "hour=8|section=deportes"                   (la mañana del lector de deportes)
                     "device=mobile|ad_format=native"            (el formato que funciona en cada pantalla)
                     "geo=mx-nle|advertiser_id=v9"               (anunciantes locales)
  cada string        → blake2b de 8 bytes → entero → módulo → un índice entre 128 y 2^24 − 1
  la posición        → índices RESERVADOS 0–127 (ver abajo): nunca comparte bucket con otra feature
El modelo (serving/model.py) es una regresión logística: logit = sesgo + Σ peso[índice]. Un anuncio con
20 features activas suma 20 pesos de un arreglo de 16,777,216: no hay vocabulario que mantener ni
"feature desconocida": un anuncio nuevo de ayer ya tiene índices (con peso 0 hasta que el modelo aprenda).

Las tres decisiones de diseño:
  1. HASH ESTABLE. hashlib (blake2b), nunca hash() de Python: hash() de str usa una semilla aleatoria por
     proceso (PYTHONHASHSEED), así que el job de entrenamiento y cada pod del ad-api pondrían la misma
     feature en buckets distintos. Un test lo demuestra con dos procesos.
  2. COLISIONES. 2^24 ≈ 16.8 M buckets para del orden de 10^5 features distintas activas (est.: anuncios,
     campañas, cruces sección × categoría, geo × anunciante…): casi no chocan, y cuando chocan, dos
     features raras comparten un peso. Lo que NO puede chocar es la posición, porque de su peso sale el
     ajuste por slot: por eso va en índices reservados, fuera del hash.
  3. POSICIÓN (position bias). El slot donde se mostró el anuncio es una feature de ENTRENAMIENTO: así el
     modelo separa "le dieron click porque estaba arriba" de "le dieron click porque es bueno". En serving,
     el score base del anuncio se calcula SIN los términos de posición (posición de referencia neutra) y
     cada slot suma después su término aprendido: pCTR(anuncio, slot) sale de UN solo scoring por
     candidato (ver model.HashedLogisticModel.predict_slots), y es exactamente lo que daría el modelo con
     la fila de ese slot (un test lo exige).
"""

from __future__ import annotations  # anotaciones como texto: sintaxis moderna sin costo en runtime

import functools  # lru_cache: los strings calientes (secciones, anuncios) no se re-hashean
import hashlib  # blake2b: hash ESTABLE entre procesos, máquinas y versiones de Python
import unicodedata  # NFC: "política" con la tilde combinada o precompuesta es lo mismo; NFKD: quitar tildes
from collections.abc import Iterable, Mapping, Sequence  # tipos de entrada
from datetime import datetime  # hora y día local del request
from zoneinfo import ZoneInfo  # zona horaria del publisher (requiere tzdata en imágenes mínimas)

import numpy as np  # índices como arreglos int64: el modelo los usa para indexar sus pesos

# Versión del ESQUEMA de features. Cambia si cambia cualquier cosa de este archivo que mueva índices
# (campos, cruces, normalización, hash, buckets reservados). El modelo guarda la versión con la que se
# entrenó y el ad-api se niega a cargar un modelo de otra versión (model.py): un modelo con índices de
# otro esquema no falla, predice basura.
FEATURE_SET_VERSION = "ctr-hash-v1"

N_BITS = 24  # 2^24 buckets (dato del caso)
N_BUCKETS = 1 << N_BITS  # 16,777,216 pesos float32 ≈ 64 MiB por pod: cabe sin pensarlo en un c7i.4xlarge

# Slots de la página, en el orden de la página (el orden de VALOR para la subasta vive en ad_api.Settings)
SLOTS = ("top", "in_article", "bottom")
# Formatos de creatividad que el ad server acepta. Vocabulario CERRADO a propósito: el cruce posición ×
# formato usa índices reservados, y un formato nuevo es un cambio de esquema (otra FEATURE_SET_VERSION).
FORMATS = ("banner", "native", "video")

# Índices reservados [0, 128): posición y posición × formato. Fuera del hash para que ninguna feature
# caiga ahí por casualidad. Con 10^5 features en 2^24 buckets, la probabilidad de que ALGO caiga en un
# bucket dado es 1 − e^(−10^5 / 2^24) ≈ 0.6 % (y con 10^6 features, ≈ 6 %, est.): poca, pero el ajuste
# por posición de TODOS los anuncios saldría contaminado por el peso de esa feature.
_MAX_SLOTS = 8  # margen para un slot nuevo sin cambiar el layout de abajo
_MAX_FORMATS = 8
RESERVED = 128
assert _MAX_SLOTS + _MAX_SLOTS * _MAX_FORMATS <= RESERVED  # el layout cabe en la zona reservada
assert len(SLOTS) <= _MAX_SLOTS and len(FORMATS) <= _MAX_FORMATS

# Campos del contexto de la página (vienen del request: los conoce el ad-api sin preguntarle a nadie)
CONTEXT_FIELDS = ("section", "device", "geo", "hour", "dow")
# Campos del anuncio (vienen del índice de anuncios en memoria)
AD_FIELDS = ("ad_id", "campaign_id", "advertiser_id", "ad_category", "ad_format")
# Cruces: pares de campos cuya COMBINACIÓN dice algo que cada campo solo no dice. Una regresión logística
# no aprende interacciones sola: si "deportes" y "autos" funcionan juntos, alguien tiene que darle la
# feature "deportes|autos". (Una DNN con embeddings tipo DCN/DeepFM las aprende; ver el caso.)
CROSSES = (
    ("section", "ad_category"),  # contexto × categoría del anuncio
    ("interest", "ad_category"),  # interés de la persona × categoría ("user-section × ad-category" del caso)
    ("hour", "section"),  # la hora cambia quién lee cada sección
    ("device", "ad_format"),  # un banner en celular no es un banner en escritorio
    ("geo", "advertiser_id"),  # anunciantes locales: la agencia de autos de Monterrey en Monterrey
)
MAX_INTERESTS = 5  # secciones leídas en 30 días que entran como features (las más leídas)
# Secciones que NUNCA entran al perfil de la persona (ni como feature ni para segmentar). El contexto de
# la página sí puede ser "salud" (es dónde aparece el anuncio, no quién es la persona). La lista la
# decide legal y la política del publisher; esto es un ejemplo, no asesoría legal. Se escriben SIN
# tildes y se comparan sin tildes (_fold): "Política", "POLÍTICA" y "politica" son la misma sección.
SENSITIVE_SECTIONS = frozenset({"salud", "religion", "politica"})
MISSING = "__none__"  # valor explícito de "no sé": aprende su propio peso (no es lo mismo que "nada")


# ------------------------------------------------------------------------------ normalización y hash
def norm(value: object) -> str:
    """Forma canónica de un valor: la misma en el request, en el log y en el entrenamiento.

    - NFC: "política" puede llegar con la tilde como carácter combinado (NFD) desde un CMS y precompuesta
      desde otro; son bytes distintos y, sin normalizar, buckets distintos (un test lo muestra).
    - minúsculas y sin espacios en los bordes: "Deportes " y "deportes" son la misma sección.
    - "=" y "|" son separadores de este archivo: un valor que los traiga podría fabricar otra feature
      ("deportes|ad_category=autos" como nombre de sección). Se reemplazan.
    """
    if value is None:
        return MISSING
    s = unicodedata.normalize("NFC", str(value)).strip().lower()
    s = s.replace("=", "_").replace("|", "_")
    return s or MISSING


def _fold(value: str) -> str:
    """Sin tildes ("política" → "politica"): SOLO para comparar contra SENSITIVE_SECTIONS.

    norm() conserva las tildes (cambiarlo movería los índices de todas las features: otra
    FEATURE_SET_VERSION). Pero un filtro que compara "política" contra "politica" deja pasar justo la
    forma en que se escribe en español. NFKD separa la letra de su tilde y se descarta la tilde.
    """
    return "".join(c for c in unicodedata.normalize("NFKD", value) if not unicodedata.combining(c))


@functools.lru_cache(maxsize=1 << 18)  # ≈ 262k strings (est. de las distintas activas: decenas de miles)
def bucket(feature: str) -> int:
    """Índice de una feature ("campo=valor"): blake2b de 8 bytes, módulo, desplazado sobre lo reservado.

    blake2b está en la biblioteca estándar, es rápido y da lo mismo en cualquier proceso, máquina o
    versión. El sesgo del módulo con un entero de 64 bits es despreciable (≈ 2^24 / 2^64).
    Trampa: hash(feature) de Python cambia en cada proceso (semilla aleatoria por defecto). Fijar
    PYTHONHASHSEED lo vuelve repetible, pero ata los índices a una variable de entorno en CADA proceso
    (training, serving, notebooks, Spark) y al ancho del entero de la plataforma (64 vs 32 bits).
    """
    digest = hashlib.blake2b(feature.encode("utf-8"), digest_size=8).digest()
    return RESERVED + int.from_bytes(digest, "little") % (N_BUCKETS - RESERVED)


def position_indices(slot: str, ad_format: str | None) -> np.ndarray:
    """Índices RESERVADOS de la posición: "pos=slot" y, si el formato es conocido, "pos=slot|fmt".

    El cruce posición × formato existe porque el efecto del slot depende del formato (un video rinde
    distinto en el cuerpo de la nota que arriba). Va en la zona reservada por la misma razón que la
    posición: de estos pesos sale el ajuste por slot de todos los anuncios.
    """
    s = SLOTS.index(slot)  # un slot desconocido es un bug del caller: ValueError, no un índice inventado
    idx = [s]
    f = norm(ad_format)
    if f in FORMATS:
        idx.append(_MAX_SLOTS + s * _MAX_FORMATS + FORMATS.index(f))
    return np.asarray(idx, dtype=np.int64)


# ------------------------------------------------------------------------------ contexto e intereses
def local_time(ts: float, tz: str) -> tuple[int, int, str]:
    """(hora 0–23, día de la semana 0 = lunes, fecha "AAAA-MM-DD") en la zona del publisher.

    El ad-api lo calcula UNA vez por request con su reloj y lo LOGUEA: el entrenamiento usa la hora
    logueada, no la recalcula (si la recalculara con otra zona u otro reloj, "hour=8" de training sería
    "hour=14" de serving). La fecha local es también la llave del frequency cap "por día".
    """
    dt = datetime.fromtimestamp(ts, ZoneInfo(tz))
    return dt.hour, dt.weekday(), dt.date().isoformat()


def clean_interests(sections: Iterable[object] | None) -> tuple[str, ...]:
    """Intereses que pueden entrar al modelo: normalizados, sin secciones sensibles, sin repetidos.

    Recibe las secciones leídas en 30 días, de la más a la menos leída (así las guarda el job de features
    del usuario). Se queda con las primeras MAX_INTERESTS que no son sensibles y las ordena (el orden no
    cambia los índices, pero un orden canónico hace comparables los logs). La limpieza se hace AQUÍ
    aunque el job ya filtre: es la última puerta antes del modelo, en training y en serving.
    Lo sensible se compara sin tildes: "Política" (o en NFD, o "POLÍTICA") no pasa la puerta.
    """
    out: list[str] = []
    for s in sections or ():
        v = norm(s)
        if v == MISSING or _fold(v) in SENSITIVE_SECTIONS or v in out:
            continue
        out.append(v)
        if len(out) == MAX_INTERESTS:
            break
    return tuple(sorted(out))


def make_raw(context: Mapping[str, object], interests: Sequence[str], ad: Mapping[str, object]) -> dict:
    """El registro CRUDO de un par (página, anuncio): lo que se loguea y lo que se hashea.

    El ad-api lo arma en el request y el log de serving guarda sus partes (contexto, intereses y
    atributos del anuncio); training/build_training_set.py lo vuelve a armar con ESTA función. Se loguean
    los valores, no los índices: un cruce nuevo se puede probar mañana sobre los logs de hoy.
    """
    raw = {f: context.get(f) for f in CONTEXT_FIELDS}
    raw["interests"] = list(clean_interests(interests))
    raw.update({f: ad.get(f) for f in AD_FIELDS})
    return raw


# ------------------------------------------------------------------------------ features e índices
def _context_strings(raw: Mapping[str, object]) -> list[str]:
    """Features que dependen solo de la página y de la persona (iguales para todos los candidatos)."""
    out = [f"{f}={norm(raw.get(f))}" for f in CONTEXT_FIELDS]
    interests = raw.get("interests") or ()
    # Sin intereses (sin consentimiento o sin historia): UNA feature explícita, no ninguna. Sin
    # distinguir entre los dos casos a propósito: el modelo no debe usar el consentimiento como señal.
    out += [f"interest={norm(i)}" for i in interests] or [f"interest={MISSING}"]
    return out


def _ad_strings(raw: Mapping[str, object]) -> list[str]:
    """Features del anuncio solo (iguales en todos los requests: el lru_cache de bucket las paga una vez)."""
    return [f"{f}={norm(raw.get(f))}" for f in AD_FIELDS]


def _cross_strings(raw: Mapping[str, object]) -> list[str]:
    """Cruces página × anuncio. "interest" es multivalor: un cruce por cada interés."""
    out = []
    for a, b in CROSSES:
        left = ([norm(i) for i in raw.get("interests") or ()] or [MISSING]) if a == "interest" else [norm(raw.get(a))]
        out += [f"{a}={va}|{b}={norm(raw.get(b))}" for va in left]
    return out


def feature_strings(raw: Mapping[str, object]) -> list[str]:
    """Todas las features SIN posición, como strings legibles (para depurar: "¿qué vio el modelo?")."""
    return _context_strings(raw) + _ad_strings(raw) + _cross_strings(raw)


def base_indices(raw: Mapping[str, object]) -> np.ndarray:
    """Índices de las features sin posición: el score base de un anuncio en una página.

    No se deduplican: si dos strings caen en el mismo bucket, ese peso cuenta dos veces, igual en
    training y en serving (lo que importa es que sea IGUAL).
    """
    return np.fromiter((bucket(s) for s in feature_strings(raw)), dtype=np.int64)


def row_indices(raw: Mapping[str, object], slot: str) -> np.ndarray:
    """Fila de ENTRENAMIENTO: features + la posición donde de verdad se mostró el anuncio."""
    return np.concatenate([base_indices(raw), position_indices(slot, raw.get("ad_format"))])


def encode_candidates(context: Mapping[str, object], interests: Sequence[str],
                      ads: Sequence[Mapping[str, object]]) -> list[np.ndarray]:
    """Índices base de ≈ 150 candidatos de un request, sin repetir el trabajo común.

    Mismo resultado que [base_indices(make_raw(context, interests, ad)) for ad in ads] (un test lo exige),
    pero las features de contexto se hashean una vez por request y las del anuncio salen del caché. Es la
    misma definición: las tres partes son las funciones de arriba.
    """
    shared = make_raw(context, interests, {})  # contexto + intereses limpios, sin anuncio
    ctx_idx = np.fromiter((bucket(s) for s in _context_strings(shared)), dtype=np.int64)
    rows = []
    for ad in ads:
        raw = {**shared, **{f: ad.get(f) for f in AD_FIELDS}}
        own = np.fromiter((bucket(s) for s in _ad_strings(raw) + _cross_strings(raw)), dtype=np.int64)
        rows.append(np.concatenate([ctx_idx, own]))
    return rows
