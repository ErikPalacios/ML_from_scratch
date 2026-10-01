"""Tests de los contadores del request: ventana por buckets, idempotencia, TTL y datos faltantes."""

import definitions as d
import pytest
from online_counters import DEFAULT_DEDUPE_TTL_S, InMemoryKV, OnlineCounters

T0 = 1_000_000_000  # múltiplo de 10 y de 60: los bordes de bucket caen en números redondos


class Clock:
    """Reloj manual: los tests mueven el tiempo sin dormir."""

    def __init__(self, t: float = T0) -> None:
        self.t = t

    def __call__(self) -> float:
        return self.t


def ev(pid, card="tok_a", device="dev_1", ip="ip_1", merchant="m_1", amount=3000, **kw):
    """Un intento de pago mínimo (amount en centavos de USD)."""
    return {"payment_id": pid, "card_token": card, "device_hash": device, "ip_hash": ip, "email_hash": "em_1",
            "merchant_id": merchant, "amount_cents": amount, "ip_country": "MX", "card_bin_country": "MX", **kw}


@pytest.fixture
def setup():
    clock = Clock()
    kv = InMemoryKV(clock)
    return clock, kv, OnlineCounters(kv)


def step(clock, counters, event, t):
    """Lo que hace el servicio: fija el reloj al momento del request y lee+actualiza."""
    clock.t = t
    return counters.read_and_update(event, t)


def test_current_transaction_is_not_in_its_own_aggregate(setup):
    clock, _, c = setup
    first = step(clock, c, ev("p1"), T0)
    second = step(clock, c, ev("p2"), T0 + 5)
    # el primer pago de la tarjeta ve 0 intentos previos, no 1
    assert first.values["card_count_60s"] == 0
    assert second.values["card_count_60s"] == 1
    assert second.values["card_amount_1h"] == 3000  # solo el monto del primero


def test_window_is_a_set_of_buckets_not_an_exact_60_seconds(setup):
    """El docstring de WindowedFeature: con buckets de 10 s, la ventana de "60 s" ve entre 50 y 60 s."""
    clock, _, c = setup
    step(clock, c, ev("p1"), T0)  # bucket [T0, T0+10)
    step(clock, c, ev("p2"), T0 + 9)  # mismo bucket
    # a T0 + 55: la ventana son los buckets [T0, T0+60) → ve los dos
    assert c.read(ev("x"), T0 + 55)["card_count_60s"] == 2
    # a T0 + 60: el bucket de T0 salió de la ventana. p2 pasó hace solo 51 s y TAMPOCO cuenta
    assert c.read(ev("x"), T0 + 60)["card_count_60s"] == 0


def test_retry_of_the_same_payment_does_not_double_count(setup):
    clock, _, c = setup
    step(clock, c, ev("p1"), T0)
    retry = step(clock, c, ev("p1"), T0 + 1)  # el orquestador no recibió respuesta y reintenta
    assert retry.duplicate is True
    assert retry.values["card_count_60s"] == 0  # lo mismo que vio la primera llamada, no "1 previo"
    nxt = step(clock, c, ev("p2"), T0 + 2)
    assert nxt.values["card_count_60s"] == 1  # p1 una sola vez
    assert nxt.values["card_amount_1h"] == 3000


class CrashOnDevice(InMemoryKV):
    """Simula un pod que muere a mitad del request: falla justo antes de escribir el dispositivo, una vez."""

    def __init__(self, clock):
        super().__init__(clock)
        self.crashed = False

    def _before_write(self, guard_key, ops):
        if guard_key.startswith("{device:") and not self.crashed:
            self.crashed = True
            raise ConnectionError("pod reiniciado")


def test_crash_halfway_is_repaired_by_the_retry_without_double_counting():
    clock = Clock()
    kv = CrashOnDevice(clock)
    c = OnlineCounters(kv)
    with pytest.raises(ConnectionError):
        step(clock, c, ev("p1"), T0)  # la tarjeta ya sumó; el dispositivo y la IP no
    retry = step(clock, c, ev("p1"), T0 + 1)  # el orquestador reintenta el mismo pago
    assert retry.duplicate is True  # la tarjeta lo reconoce y no suma de nuevo
    nxt = step(clock, c, ev("p2", card="tok_b"), T0 + 2)
    assert nxt.values["device_distinct_cards_1h"] == 1  # el dispositivo sumó p1 en el reintento, una vez
    assert nxt.values["ip_count_60s"] == 1  # la IP también
    assert c.read(ev("x"), T0 + 3)["card_count_60s"] == 1  # y la tarjeta no la contó doble


def test_distinct_counts_values_once_and_ignores_missing(setup):
    clock, _, c = setup
    step(clock, c, ev("p1", merchant="m_1"), T0)
    step(clock, c, ev("p2", merchant="m_1"), T0 + 60)
    step(clock, c, ev("p3", merchant="m_2"), T0 + 120)
    r = step(clock, c, ev("p4", merchant="m_3"), T0 + 180)
    assert r.values["card_distinct_merchants_1h"] == 2  # m_1 (dos veces) y m_2


def test_device_with_many_cards_is_the_card_testing_signal(setup):
    clock, _, c = setup
    for i in range(6):
        r = step(clock, c, ev(f"p{i}", card=f"tok_{i}", device="dev_bot"), T0 + i * 3)
    assert r.values["device_distinct_cards_1h"] == 5  # 5 tarjetas ANTES de la sexta


def test_missing_entity_is_none_not_zero(setup):
    clock, _, c = setup
    r = step(clock, c, ev("p1", device=None), T0)
    # sin SDK de dispositivo: faltante (NaN en el vector), no "0 tarjetas" (que diría bajo riesgo)
    assert r.values["device_distinct_cards_1h"] is None
    assert d.vector(r.values)[d.FEATURE_ORDER.index("device_distinct_cards_1h")] != 0


def test_ttl_bounds_memory_and_the_guard_expires(setup):
    clock, kv, c = setup
    for i in range(50):
        step(clock, c, ev(f"p{i}", card=f"tok_{i}"), T0 + i)
    alive = kv.live_keys()
    clock.t = T0 + 49 + 3600 + 60 + 1  # pasó la ventana más larga del tier sync + un bucket
    assert kv.live_keys() < alive
    # las guardias (TTL 15 min) también expiraron a esta altura
    assert kv.live_keys() == 0
    # Consecuencia documentada: un reintento que llega después del TTL de la guardia SÍ cuenta doble
    clock.t = T0
    step(clock, c, ev("q1"), T0)
    late = step(clock, c, ev("q1"), T0 + DEFAULT_DEDUPE_TTL_S + 1)
    assert late.duplicate is False


def test_active_expiry_frees_keys_nobody_touches_again(setup):
    """El contador local del pod corre en cada request: las tarjetas que no vuelven no pueden quedarse
    para siempre. Sin `live_keys()` (que toca, y por eso borra, cada llave): solo el barrido activo."""
    clock, kv, c = setup
    for i in range(2000):
        step(clock, c, ev(f"p{i}", card=f"tok_{i}", device=f"dev_{i}", ip=f"ip_{i}"), T0 + i * 0.05)
    assert len(kv._data) > 10_000  # buckets y guardias de 2,000 tarjetas, dispositivos e IPs
    # pasa la ventana más larga (1 h) + un bucket, y el TTL de la guardia (15 min): una sola escritura más
    step(clock, c, ev("last", card="tok_last", device="dev_last", ip="ip_last"), T0 + 2 * 3600)
    # solo quedan las del último pago: 5 buckets (uno por feature sync) + 3 guardias (tarjeta, dispositivo, IP)
    assert len(kv._data) == 8
    assert len(kv._heap) == 8  # y el heap no acumula entradas viejas


def test_keys_share_a_hash_tag_per_entity():
    """Redis Cluster: un script Lua solo toca llaves del mismo slot. Todo lo de una entidad lleva {…}."""
    f = d.SYNC_FEATURES[0]
    assert OnlineCounters.bucket_key(f, "tok_a", 7).startswith("{card:tok_a}:")
    assert OnlineCounters.guard_key("card", "tok_a", "p1").startswith("{card:tok_a}:")


def test_include_current_variant_adds_the_event_itself():
    clock = Clock()
    kv = InMemoryKV(clock)
    incl = d.WindowedFeature("card_count_60s_incl", "card", 60, 10, "count", "sync", include_current=True)
    c = OnlineCounters(kv, features=(incl,))
    assert step(clock, c, ev("p1"), T0).values["card_count_60s_incl"] == 1
    assert step(clock, c, ev("p2"), T0 + 1).values["card_count_60s_incl"] == 2


def test_definitions_reject_inconsistent_windows():
    with pytest.raises(ValueError):
        d.WindowedFeature("bad", "card", 65, 10, "count", "sync")  # 65 no es múltiplo de 10
    with pytest.raises(ValueError):
        d.WindowedFeature("bad", "card", 60, 10, "sum", "sync")  # sum sin campo
