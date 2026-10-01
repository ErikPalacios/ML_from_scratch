"""Contadores de velocidad en el request (caso c09): ventanas por buckets con TTL, idempotentes por pago.

Por qué en el request y no en Flink: un ataque de card testing (un bot prueba cientos de tarjetas
robadas con compras de US$1) dura minutos. Si "intentos de esta tarjeta en 60 s" llega por el stream con
20 s de lag, el contador dice 0 mientras el bot ya hizo 30 intentos. Las features del tier `sync` de
definitions.py se LEEN y se ACTUALIZAN aquí, dentro de los 20 ms que el servicio de scoring les da
(COUNTERS_TIMEOUT_MS).

Cómo se guardan (una llave por entidad, feature y bucket; ejemplo con card_count_60s, buckets de 10 s):

    {card:tok_9f2}:card_count_60s:172800003   → 2      (TTL 70 s)
    {card:tok_9f2}:card_count_60s:172800004   → 1      (TTL 70 s)

Leer la ventana = MGET de los 6 buckets y sumar. Actualizar = INCRBY del bucket actual + EXPIRE. Un
distinct guarda un SET por bucket (SADD) y la ventana es el tamaño de la unión (SUNION).

Tres decisiones de diseño, con su porqué:

1. IDEMPOTENCIA por payment_id. El orquestador reintenta el scoring si no recibió respuesta (timeout de
   red, pod reiniciado). Sin guardia, el reintento cuenta dos veces el mismo intento y una persona que
   reintenta su compra parece un bot. Lo mismo con la SEGUNDA llamada al scoring después de 3-D Secure
   (mismo payment_id). Antes de sumar, se escribe `{card:tok}:seen:<payment_id>` con SET NX EX (solo si
   no existe, con TTL), y como VALOR de la guardia los valores que se leyeron: si ya existía, no se suma
   nada y se devuelven esos valores, los que vio la primera llamada. Si no, el reintento leería su propio
   intento ("1 previo" donde la primera vio "0") y la feature cambiaría entre dos llamadas del mismo pago.
   La guardia es POR ENTIDAD,
   vive en el mismo hash slot que sus contadores (ver 2) y se escribe en el mismo paso atómico que
   ellos, así que un crash a mitad de camino se repara solo: el reintento suma en las entidades que
   faltaron y en ninguna otra.

2. ATOMICIDAD por entidad. Leer, chequear la guardia y sumar son tres pasos. En Redis van en UN script
   Lua (EVALSHA) por entidad: un solo round trip y nadie se mete en medio. MULTI/EXEC solo no alcanza,
   porque la escritura depende de lo que se leyó (la guardia); con WATCH habría que reintentar. En Redis
   Cluster un script solo puede tocar llaves del mismo hash slot: por eso todas las llaves de una entidad
   llevan el mismo hash tag `{card:tok_9f2}`.
   Las entidades de un pago son scripts en pipeline (en paralelo a los shards que toquen; aquí 3
   entidades en el tier sync: tarjeta, dispositivo, IP). El fake de este archivo es de un solo hilo.
   El adaptador real de Redis NO está aquí porque no se pudo probar sin un Redis (ver README).

3. DISTINCT EXACTO con un SET chico por bucket. Para "comercios distintos de la tarjeta en 1 h" los
   valores son pocos (una tarjeta normal: 1–3; una en card testing: decenas) y el SET es exacto. Para
   ventanas largas o cardinalidades grandes (IPs distintas de un comercio en 7 días) el SET crece sin
   límite; ahí se usa HyperLogLog (Redis PFADD/PFCOUNT: ≈ 12 KB por llave en su forma densa y error
   estándar de 0.81 % según la documentación de Redis; PFCOUNT con varias llaves da la unión). El costo
   es que deja de ser exacto: el backfill tiene que usar el MISMO estimador o aceptar esa diferencia.

Qué se lee primero: el valor de la ventana se lee ANTES de sumar el evento actual. La transacción no entra
en su propio agregado (definitions.WindowedFeature.include_current = False), igual que offline.
"""

from __future__ import annotations  # anotaciones como texto

import heapq  # expiración activa del fake: las llaves que vencen primero, arriba
import json  # valor de la guardia: lo que vio la primera llamada
import time  # reloj por defecto del fake
from collections.abc import Callable, Iterable, Sequence  # tipos de las interfaces
from dataclasses import dataclass  # resultado de una lectura+actualización
from typing import Protocol  # interfaz sin herencia: el fake y el adaptador real solo cumplen la forma

import definitions as d  # la ÚNICA definición de cada feature (features/definitions.py)

# Cuánto vive la guardia de idempotencia: 15 min. Cubre los reintentos del orquestador (segundos) y la
# segunda llamada después de 3-D Secure (un desafío dura minutos). Más largo protege reintentos tardíos y
# cuesta memoria: a 2,000 TPS × 3 entidades sync × 900 s ≈ 5.4 M guardias vivas en el pico (est.; mídelo
# con INFO memory y MEMORY USAGE). Un reintento después de que la guardia expira SÍ cuenta doble; la
# idempotency key de la API del orquestador es la primera defensa, esta es la segunda.
DEFAULT_DEDUPE_TTL_S = 900


# --------------------------------------------------------------------------------------------- interfaz
@dataclass(frozen=True)
class Op:
    """Una escritura: INCRBY (kind="incr") o SADD (kind="add"), seguida de EXPIRE con `ttl_s`."""

    kind: str  # "incr" | "add"
    key: str
    value: int | str  # centavos o conteo (enteros: INCRBY, no INCRBYFLOAT) · o el miembro del SET
    ttl_s: int


class KeyValue(Protocol):
    """Lo mínimo que necesitan los contadores. Cada método dice a qué comando de Redis corresponde."""

    def get_many(self, keys: Sequence[str]) -> list[int | None]: ...  # MGET

    def union_size(self, keys: Sequence[str]) -> int: ...  # SUNION + len (o PFCOUNT si es HLL)

    def contains_any(self, keys: Sequence[str], member: str) -> bool: ...  # SISMEMBER en cada llave

    # SET guard <payload> NX EX ttl y, SOLO si lo creó, cada Op (INCRBY/SADD + EXPIRE). Todo o nada: en
    # Redis es un script Lua; un crash a mitad no deja la guardia escrita sin sus contadores.
    # Devuelve None si era nuevo, o el payload guardado por la primera llamada si ya existía.
    def apply_if_new(self, guard_key: str, guard_ttl_s: int, ops: Sequence[Op], payload: str) -> str | None: ...


class InMemoryKV:
    """Fake de un KV store con TTL y reloj inyectable (los tests mueven el tiempo sin dormir).

    Expira de las dos formas, como Redis: perezosa (una llave vencida se borra al tocarla) y ACTIVA (en
    cada escritura se barren las llaves ya vencidas, con un heap por hora de vencimiento). La activa no es
    opcional: este fake también es el contador LOCAL del pod para el fallback (service.py) y corre en
    cada request de producción. Solo con expiración perezosa, cada tarjeta que no vuelve deja sus
    buckets y su guardia para siempre: medido, ≈ 137 MB que no se liberan por cada 100,000 pagos de
    tarjetas distintas, y un pod ve ≈ 1.7 M pagos al día (10 M ÷ 6 pods; est.). Con el barrido, la
    memoria queda acotada por lo que vive dentro de las ventanas y del TTL de la guardia. Sin red, sin
    dependencias.
    """

    def __init__(self, clock: Callable[[], float] = time.time) -> None:
        self._clock = clock  # inyectable: el test de TTL avanza el reloj 2 minutos sin esperar
        self._data: dict[str, int | set[str]] = {}
        self._expires: dict[str, float] = {}
        # (vence_a, llave) por cada EXPIRE. Un EXPIRE que renueva deja la entrada vieja en el heap: al
        # salir se compara con _expires y se ignora si la llave se renovó. O(log n) por escritura.
        self._heap: list[tuple[float, str]] = []

    def _expire(self, key: str, at: float) -> None:
        self._expires[key] = at
        heapq.heappush(self._heap, (at, key))

    def _sweep(self, now: float) -> None:
        """Barrido activo: borra todo lo vencido hasta `now` (lo que Redis hace en segundo plano)."""
        while self._heap and self._heap[0][0] <= now:
            at, key = heapq.heappop(self._heap)
            if self._expires.get(key) == at:  # si no, la llave se renovó después: sigue viva
                self._data.pop(key, None)
                self._expires.pop(key, None)

    def _alive(self, key: str) -> bool:
        exp = self._expires.get(key)
        if exp is not None and self._clock() >= exp:
            # expiró: se borra al tocarla (lazy expiry)
            self._data.pop(key, None)
            self._expires.pop(key, None)
        return key in self._data

    def get_many(self, keys: Sequence[str]) -> list[int | None]:
        return [self._data[k] if self._alive(k) else None for k in keys]  # type: ignore[misc]

    def union_size(self, keys: Sequence[str]) -> int:
        members: set[str] = set()
        for k in keys:
            if self._alive(k):
                members |= self._data[k]  # type: ignore[operator]
        return len(members)

    def contains_any(self, keys: Sequence[str], member: str) -> bool:
        return any(self._alive(k) and member in self._data[k] for k in keys)  # type: ignore[operator]

    def apply_if_new(self, guard_key: str, guard_ttl_s: int, ops: Sequence[Op], payload: str) -> str | None:
        self._before_write(guard_key, ops)  # punto de inyección de fallas para los tests
        now = self._clock()
        self._sweep(now)
        if self._alive(guard_key):
            return self._data[guard_key]  # type: ignore[return-value]
        for op in ops:  # un solo hilo: nada se intercala (en Redis lo garantiza el script)
            if op.kind == "incr":
                current = self._data[op.key] if self._alive(op.key) else 0
                self._data[op.key] = int(current) + int(op.value)  # type: ignore[arg-type]
            else:
                if not self._alive(op.key):
                    self._data[op.key] = set()
                self._data[op.key].add(str(op.value))  # type: ignore[union-attr]
            # EXPIRE en cada escritura: el TTL corre desde la última y un bucket que recibe eventos no
            # expira. Basta con que dure la ventana + un bucket (WindowedFeature.ttl_s).
            self._expire(op.key, now + op.ttl_s)
        self._data[guard_key] = payload  # type: ignore[assignment]
        self._expire(guard_key, now + guard_ttl_s)
        return None

    def _before_write(self, guard_key: str, ops: Sequence[Op]) -> None:
        """No hace nada; un test lo redefine para simular que el pod muere ANTES de escribir."""

    def live_keys(self) -> int:
        """Cuántas llaves siguen vivas. OJO: toca cada llave, así que también las borra si vencieron; para
        probar el barrido activo, el test mira `len(kv._data)` sin llamar a esto."""
        return sum(1 for k in list(self._data) if self._alive(k))


# ---------------------------------------------------------------------------------------- contadores
@dataclass
class CounterResult:
    # feature → valor ANTES de sumar este evento (None = sin entidad). En un reintento: los de la 1.ª llamada
    values: dict[str, float | None]
    duplicate: bool  # True si al menos una entidad ya había visto este payment_id (reintento)


class OnlineCounters:
    """Ventanas por buckets sobre un KeyValue. Sin estado propio: todo vive en el store."""

    def __init__(self, kv: KeyValue, features: Iterable[d.WindowedFeature] = d.SYNC_FEATURES,
                 dedupe_ttl_s: int = DEFAULT_DEDUPE_TTL_S) -> None:
        self.kv = kv
        self.features = tuple(features)
        self.dedupe_ttl_s = dedupe_ttl_s
        # Agrupar por entidad: cada grupo es UN script Lua en producción (mismo hash slot)
        self._by_entity: dict[str, list[d.WindowedFeature]] = {}
        for f in self.features:
            self._by_entity.setdefault(f.entity, []).append(f)

    @staticmethod
    def bucket_key(feature: d.WindowedFeature, entity_id: str, bucket: int) -> str:
        # {entity:id} es el hash tag de Redis Cluster: solo lo que va entre llaves decide el slot
        return f"{{{feature.entity}:{entity_id}}}:{feature.name}:{bucket}"

    @staticmethod
    def guard_key(entity: str, entity_id: str, payment_id: str) -> str:
        return f"{{{entity}:{entity_id}}}:seen:{payment_id}"

    def _read_one(self, feature: d.WindowedFeature, entity_id: str, event: dict, ts: float) -> float:
        keys = [self.bucket_key(feature, entity_id, b) for b in d.bucket_range(ts, feature)]
        if feature.agg == "distinct":
            value = float(self.kv.union_size(keys))
            if feature.include_current:
                # la transacción actual suma 1 solo si su valor no estaba ya en algún bucket de la ventana
                member = d.contribution(event, feature)
                if member is not None and not self.kv.contains_any(keys, str(member)):
                    value += 1
            return value
        value = float(sum(v or 0 for v in self.kv.get_many(keys)))
        if feature.include_current:
            value += float(d.contribution(event, feature) or 0)
        return value

    def _ops(self, feats: list[d.WindowedFeature], entity_id: str, event: dict, ts: float) -> list[Op]:
        """Las escrituras de este evento para una entidad: una por feature, en el bucket actual."""
        ops = []
        for f in feats:
            value = d.contribution(event, f)
            if value is None:
                continue  # un distinct sin valor (p. ej., sin país de IP) no suma un "desconocido"
            key = self.bucket_key(f, entity_id, d.bucket_index(ts, f.bucket_s))
            ops.append(Op("add" if f.agg == "distinct" else "incr", key,
                          str(value) if f.agg == "distinct" else int(value), f.ttl_s))
        return ops

    def read(self, event: dict, ts: float) -> dict[str, float | None]:
        """Solo lectura (lo usa el backfill para comparar y el fallback local). No modifica nada."""
        out: dict[str, float | None] = {}
        for entity, feats in self._by_entity.items():
            entity_id = d.entity_value(event, entity)
            for f in feats:
                out[f.name] = None if entity_id is None else self._read_one(f, entity_id, event, ts)
        return out

    def read_and_update(self, event: dict, ts: float) -> CounterResult:
        """Lo que hace el request: por entidad, leer la ventana, chequear la guardia y sumar (si es nuevo).

        En producción cada iteración del loop de entidades es UN script Lua: lectura, guardia y escrituras
        en un round trip y sin nadie en medio. Aquí son dos llamadas al fake (leer y `apply_if_new`).
        `ts` lo pone el servicio (su reloj al recibir el request) y se loguea: es el event_time que usará
        el backfill. Si el backfill usara la hora del comercio, las ventanas no coincidirían.
        """
        values: dict[str, float | None] = {}
        duplicate = False
        payment_id = str(event["payment_id"])
        for entity, feats in self._by_entity.items():
            entity_id = d.entity_value(event, entity)
            if entity_id is None:
                # sin entidad (checkout sin SDK de dispositivo): feature faltante, nada que contar
                values.update({f.name: None for f in feats})
                continue
            # 1) leer ANTES de sumar: la transacción actual no entra en su propio agregado
            for f in feats:
                values[f.name] = self._read_one(f, entity_id, event, ts)
            # 2) y 3) guardia de idempotencia de ESTA entidad + sumar el evento, todo o nada. La guardia
            #    guarda lo que se leyó: un reintento recibe exactamente lo mismo que la primera llamada.
            guard = self.guard_key(entity, entity_id, payment_id)
            mine = {f.name: values[f.name] for f in feats}
            stored = self.kv.apply_if_new(guard, self.dedupe_ttl_s, self._ops(feats, entity_id, event, ts),
                                          json.dumps(mine))
            if stored is not None:
                duplicate = True  # reintento: ya sumamos este pago para esta entidad
                values.update(json.loads(stored))
        return CounterResult(values=values, duplicate=duplicate)
