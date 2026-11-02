"""Definiciones de features como código (caso c09): UNA fuente para el camino online y para el backfill.

Por qué existe este archivo: la causa más común de training-serving skew en fraude no es un bug "grande",
es que la misma feature tiene DOS definiciones. Online, "intentos de la tarjeta en el último minuto" lo
calcula un contador en Redis; offline, un analista escribe un SQL con `BETWEEN ts - 60 s AND ts`. Una
versión incluye la transacción actual y la otra no; una usa una ventana deslizante exacta y la otra
buckets de 10 s. El modelo aprende con una distribución y en producción ve otra, sin ningún error.

Aquí cada feature se define una vez, con todo lo que cambia su valor:
  - la ENTIDAD por la que se agrupa (tarjeta, dispositivo, IP, email, comercio),
  - la VENTANA y el tamaño del BUCKET (la ventana real es un conjunto de buckets, ver `bucket_range`),
  - la AGREGACIÓN (count, sum, distinct) y sobre qué campo,
  - si la transacción actual entra o no (por defecto NO: es la trampa clásica),
  - el TIER: quién la calcula online (sync = en el request; stream = Flink; batch = job diario).

`online_counters.py` (online) y `point_in_time.py` (offline) importan este módulo y nada más define
features. Los tests de `features/tests/test_point_in_time.py` reproducen un stream con los dos caminos y
exigen el mismo valor, transacción por transacción.

En producción el job de Flink está en Java/SQL o PyFlink: lo que comparte con este módulo es la definición
(exportada a JSON con `export_definitions()` y validada en CI), no el código. Aquí se prueba la semántica.
"""

from __future__ import annotations  # anotaciones como texto: sintaxis moderna sin costo en runtime

import math  # log1p del monto
from dataclasses import asdict, dataclass  # definiciones inmutables y fáciles de exportar
from typing import Literal  # valores permitidos explícitos (el linter y el lector los ven)

# Campo del evento que identifica cada entidad. Ninguno es dato de tarjeta en claro: el PAN se tokeniza
# ANTES de llegar aquí (bóveda PCI DSS del PSP), y IP y dispositivo llegan como hash con llave (HMAC)
# hecho por el orquestador de pagos. Así el sistema de fraude queda fuera del alcance PCI y no guarda
# IPs en claro como llaves de Redis.
ENTITY_FIELDS: dict[str, str] = {
    "card": "card_token",  # token estable de la tarjeta (mismo PAN → mismo token)
    "device": "device_hash",  # huella del dispositivo (SDK del checkout), con HMAC
    "ip": "ip_hash",  # IP con HMAC: sirve para contar, no para geolocalizar
    "email": "email_hash",  # email normalizado (minúsculas, sin espacios) y con HMAC
    "merchant": "merchant_id",  # el comercio; ojo: es una llave CALIENTE (ver merchant_count_1h)
}

Entity = Literal["card", "device", "ip", "email", "merchant"]
Agg = Literal["count", "sum", "distinct"]
Tier = Literal["sync", "stream"]


@dataclass(frozen=True)
class WindowedFeature:
    """Un agregado por ventana de tiempo sobre los eventos de una entidad.

    Ejemplo numérico de la ventana (bucket_s = 10, window_s = 60): un evento a las 12:00:37 cae en el
    bucket que empieza a las 12:00:30. La feature suma los 6 buckets que terminan en el actual:
    12:00:30, :20, :10, :00, 11:59:50 y 11:59:40. O sea, ve entre 50 y 60 s hacia atrás según en qué
    punto del bucket actual caiga el evento. No es una ventana deslizante exacta: es la que se puede
    mantener en Redis con un costo fijo por request. Lo importante es que offline se calcula IGUAL.
    """

    name: str  # nombre estable: es la columna del set de entrenamiento y la posición en el vector
    entity: Entity  # por qué entidad se agrupa
    window_s: int  # largo nominal de la ventana
    bucket_s: int  # resolución: 10 s para ventanas de 1 min, 60 s para 1 h, 3,600 s para 24 h y 7 d
    agg: Agg  # count = intentos; sum = monto; distinct = cuántos valores distintos de `field`
    tier: Tier  # sync: se actualiza en el request (Redis); stream: la calcula Flink desde txn-events
    field: str | None = None  # sum: "amount_cents"; distinct: "merchant_id", "card_token", "ip_country"
    # ¿La transacción actual entra en su propio agregado? Por defecto NO: online la feature se lee ANTES
    # de sumar el evento, y offline se cuentan solo eventos estrictamente anteriores. Si un lado la
    # incluye y el otro no, "1 intento en 60 s" en training es "0" en serving: skew silencioso.
    include_current: bool = False

    def __post_init__(self) -> None:
        # Validaciones baratas al importar: una definición inválida no debe llegar a producción.
        if self.window_s % self.bucket_s:
            raise ValueError(f"{self.name}: window_s debe ser múltiplo de bucket_s")
        if self.agg in ("sum", "distinct") and not self.field:
            raise ValueError(f"{self.name}: {self.agg} necesita `field`")
        if self.entity not in ENTITY_FIELDS:
            raise ValueError(f"{self.name}: entidad desconocida {self.entity}")

    @property
    def n_buckets(self) -> int:
        """Cuántos buckets cubre la ventana (60 s / 10 s = 6)."""
        return self.window_s // self.bucket_s

    @property
    def ttl_s(self) -> int:
        """TTL de cada bucket en el KV store: la ventana + un bucket de margen.

        Un bucket deja de servir cuando sale de la ventana; vivir un bucket más cubre el desfase entre el
        reloj del pod y el de Redis. Sin TTL, Redis crece sin límite (≈ 10 M tarjetas distintas por mes).
        """
        return self.window_s + self.bucket_s


@dataclass(frozen=True)
class BatchFeature:
    """Feature lenta que calcula un job diario (edad de la cuenta, riesgo del comercio, grafo).

    Online se lee del online store; offline se une con un as-of join sobre `available_at` (la hora en que
    el snapshot quedó publicado), NO sobre la fecha del snapshot: el snapshot "del 14" se publica el 15 a
    las 03:00, y una transacción del 15 a la 01:00 todavía no podía verlo.
    """

    name: str
    entity: Entity


# ------------------------------------------------------------------------------------------------ features
# Tier SYNC: se leen y actualizan dentro del request (≈ 190 llaves por request entre las 5 features, en
# un script por entidad; est.). Son las que un lag de Flink de segundos haría inútiles: un ataque de card
# testing manda decenas de intentos en un minuto, y si la feature llega 20 s tarde el ataque ya terminó.
SYNC_FEATURES: tuple[WindowedFeature, ...] = (
    WindowedFeature("card_count_60s", "card", 60, 10, "count", "sync"),
    WindowedFeature("card_amount_1h", "card", 3600, 60, "sum", "sync", field="amount_cents"),
    WindowedFeature("card_distinct_merchants_1h", "card", 3600, 60, "distinct", "sync", field="merchant_id"),
    WindowedFeature("device_distinct_cards_1h", "device", 3600, 60, "distinct", "sync", field="card_token"),
    WindowedFeature("ip_count_60s", "ip", 60, 10, "count", "sync"),
)

# Tier STREAM: Flink las calcula desde el tópico `txn-events` y las escribe en el online store. Toleran
# segundos o minutos de retraso (FeatureFreshnessLag vigila cuánto). Ventanas largas = muchos buckets:
# en Flink es estado del operador, no 168 llaves leídas por request.
STREAM_FEATURES: tuple[WindowedFeature, ...] = (
    WindowedFeature("card_count_24h", "card", 86400, 3600, "count", "stream"),
    WindowedFeature("card_distinct_countries_7d", "card", 604800, 3600, "distinct", "stream", field="ip_country"),
    WindowedFeature("email_distinct_cards_7d", "email", 604800, 3600, "distinct", "stream", field="card_token"),
    WindowedFeature("ip_distinct_cards_24h", "ip", 86400, 3600, "distinct", "stream", field="card_token"),
    # El comercio NO va en el tier sync aunque la ventana sea corta: un comercio grande en Hot Sale manda
    # cientos de TPS, y un contador por comercio en Redis sería una llave caliente (todo el tráfico de ese
    # comercio al mismo shard). Flink lo agrega en memoria y escribe un valor por minuto.
    WindowedFeature("merchant_count_1h", "merchant", 3600, 60, "count", "stream"),
)

WINDOWED_FEATURES: tuple[WindowedFeature, ...] = SYNC_FEATURES + STREAM_FEATURES

# Tier BATCH: snapshot diario en el online store.
BATCH_FEATURES: tuple[BatchFeature, ...] = (
    BatchFeature("card_age_days", "card"),  # días desde que vimos la tarjeta por primera vez
    BatchFeature("email_age_days", "email"),
    BatchFeature("merchant_chargeback_bps_90d", "merchant"),  # riesgo histórico del comercio
    BatchFeature("device_linked_accounts_30d", "device"),  # grafo: cuentas que comparten el dispositivo
)

# Features del propio request: no necesitan store.
REQUEST_FEATURES: tuple[str, ...] = ("amount_usd_log", "is_cross_border")

# Orden del vector que recibe el modelo. Cambiarlo es un cambio de ESQUEMA: se versiona junto con el
# modelo (FEATURE_SET_VERSION viaja en el log de decisiones y en el set de entrenamiento).
FEATURE_ORDER: tuple[str, ...] = (
    REQUEST_FEATURES
    + tuple(f.name for f in SYNC_FEATURES)
    + tuple(f.name for f in STREAM_FEATURES)
    + tuple(f.name for f in BATCH_FEATURES)
)
FEATURE_SET_VERSION = "fraud-fs-v3"  # ilustrativo; súbelo si cambia una definición o el orden

# Grupos para el fetch y para las métricas de defaults (label `group` de fraud_feature_defaults_total)
GROUPS: dict[str, tuple[str, ...]] = {
    "sync": tuple(f.name for f in SYNC_FEATURES),
    "stream": tuple(f.name for f in STREAM_FEATURES),
    "batch": tuple(f.name for f in BATCH_FEATURES),
}

# Valor por defecto cuando una feature no se pudo leer: NaN, es decir "faltante". El GBDT trata NaN como
# una rama propia que aprendió en entrenamiento (tarjetas nuevas sin historial, dispositivos sin SDK).
# Por qué no 0: un 0 en card_count_24h dice "esta tarjeta no compró nada hoy", que es una afirmación de
# BAJO riesgo; un timeout de Redis no sabe nada. Ojo: NaN solo es seguro si el modelo vio NaN en ese
# grupo durante el entrenamiento; por eso policy.yaml decide qué grupos pueden faltar sin ir al fallback.
DEFAULT_VALUE = float("nan")


def is_missing(value: object) -> bool:
    """None, "" o NaN. NaN importa: pandas representa los faltantes de una columna de texto como NaN, y
    str(NaN) == "nan" convertiría "sin dispositivo" en un dispositivo llamado "nan" con miles de tarjetas."""
    return value is None or value == "" or (isinstance(value, float) and math.isnan(value))


def entity_value(event: dict, entity: str) -> str | None:
    """El id de la entidad en este evento, o None si no vino (p. ej., checkout sin SDK de dispositivo)."""
    value = event.get(ENTITY_FIELDS[entity])
    return None if is_missing(value) else str(value)


def bucket_index(ts: float, bucket_s: int) -> int:
    """Índice del bucket que contiene `ts` (segundos epoch). floor, no round: el bucket [30, 40) es el 3."""
    return int(ts // bucket_s)


def bucket_range(ts: float, feature: WindowedFeature) -> range:
    """Los índices de bucket que forman la ventana de `feature` vista en el instante `ts`.

    Es LA definición de ventana: la usan el camino online y el offline. Incluye el bucket actual (parcial)
    y los n − 1 anteriores.
    """
    current = bucket_index(ts, feature.bucket_s)
    return range(current - feature.n_buckets + 1, current + 1)


def contribution(event: dict, feature: WindowedFeature) -> int | str | None:
    """Lo que un evento aporta a un agregado: 1 (count), el monto (sum) o el valor a contar (distinct).

    None = no aporta nada (un distinct de países sin país de IP no cuenta "desconocido" como un país más).
    """
    if feature.agg == "count":
        return 1
    value = event.get(feature.field)  # type: ignore[arg-type]
    if feature.agg == "sum":
        # Montos en CENTAVOS enteros: sumar floats de dinero acumula error y el online (Redis INCRBY,
        # entero) y el offline (pandas) divergirían en el último dígito.
        return int(value or 0)
    return None if is_missing(value) else str(value)


def request_features(event: dict) -> dict[str, float]:
    """Features que salen del propio request. Las mismas en serving y en el backfill."""
    amount_usd = int(event["amount_cents"]) / 100
    ip_country, bin_country = event.get("ip_country"), event.get("card_bin_country")
    ip_country = None if is_missing(ip_country) else ip_country
    bin_country = None if is_missing(bin_country) else bin_country
    return {
        # log1p: los montos van de US$1 a US$5,000; al árbol no le importa la escala, pero el log hace
        # legibles los histogramas de drift
        "amount_usd_log": math.log1p(amount_usd),
        # tarjeta emitida en un país y compra desde una IP de otro. Sin país de IP → faltante, no 0
        "is_cross_border": float(ip_country != bin_country) if ip_country and bin_country else DEFAULT_VALUE,
    }


def vector(values: dict[str, float | None]) -> list[float]:
    """Dict de features → lista en FEATURE_ORDER. Lo que falta (o es None) va como NaN."""
    out = []
    for name in FEATURE_ORDER:
        v = values.get(name)
        out.append(DEFAULT_VALUE if v is None else float(v))
    return out


def export_definitions() -> list[dict]:
    """Las definiciones como JSON: lo que consume el job de Flink (y lo que CI compara con su config)."""
    return [asdict(f) for f in WINDOWED_FEATURES] + [asdict(f) | {"tier": "batch"} for f in BATCH_FEATURES]
