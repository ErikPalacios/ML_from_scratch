"""Tests del token bucket y de la estimación de tokens (reloj falso: nada duerme)."""

import pytest  # runner

from quota import TokenBucket, estimate_prompt_tokens


class FakeClock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


def test_estimate_counts_text_and_parts():
    msgs = [{"role": "system", "content": "a" * 300}, {"role": "user", "content": [{"type": "text", "text": "b" * 30}]}]
    assert estimate_prompt_tokens(msgs) == 110 + 8  # 330 caracteres ÷ 3 + 4 por mensaje


def test_take_until_empty_and_retry_after():
    clock = FakeClock()
    b = TokenBucket(capacity=1_350_000, refill_per_s=22_500, clock=clock)  # soporte en una de 4 réplicas
    assert b.try_take(1_000_000) == (True, 0.0)
    ok, wait = b.try_take(400_000)  # quedan 350,000: faltan 50,000 a 22,500/s
    assert not ok and wait == pytest.approx(50_000 / 22_500)
    clock.t += 2.3  # pasa el tiempo: se recarga
    assert b.try_take(400_000)[0]


def test_refill_never_exceeds_capacity():
    clock = FakeClock()
    b = TokenBucket(100, 10, clock)
    clock.t += 1_000
    b.try_take(0)
    assert b.tokens == 100


def test_settle_refunds_overcharge_example_from_docstring():
    clock = FakeClock()
    b = TokenBucket(1_350_000, 22_500, clock)
    b.try_take(3_024)  # 2,000 de prompt estimado + max_tokens 1,024
    b.settle(charged=3_024, actual=2_250)  # usó 2,000 + 250
    assert b.tokens == 1_350_000 - 2_250  # solo queda cobrado lo real


def test_settle_can_go_negative_when_estimate_was_short():
    clock = FakeClock()
    b = TokenBucket(1_000, 10, clock)
    b.try_take(1_000)
    b.settle(charged=1_000, actual=1_500)  # el prompt tenía más tokens que la estimación
    assert b.tokens == -500
    ok, wait = b.try_take(10)
    assert not ok and wait == pytest.approx(51.0)  # paga la deuda antes de volver a pasar


def test_request_larger_than_bucket_is_an_error_not_a_wait():
    with pytest.raises(ValueError, match="no entra"):
        TokenBucket(100, 1, FakeClock()).try_take(101)
