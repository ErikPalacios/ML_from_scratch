"""Tests de la admisión por prioridad: orden, reserva, colas acotadas, timeouts y cancelaciones."""

import asyncio  # tareas concurrentes

import pytest  # runner

from admission import AdmissionConfig, Overloaded, PriorityAdmission


@pytest.fixture
def anyio_backend():
    return "asyncio"  # el plugin de anyio corre estos tests en asyncio (sin pytest-asyncio)


def cfg(**kw):
    base = dict(max_inflight=4, interactive_reserved=1, queue_max=(("interactive", 3), ("batch", 3)),
                max_wait_s=(("interactive", 0.2), ("batch", 0.2)), retry_after_s=(("interactive", 2.0), ("batch", 60.0)))
    base.update(kw)
    return AdmissionConfig(**base)


@pytest.mark.anyio
async def test_batch_cannot_take_reserved_slots():
    adm = PriorityAdmission(cfg())
    for _ in range(3):
        await adm.acquire("batch")  # 3 = 4 − 1 reservado
    with pytest.raises(Overloaded) as e:
        await adm.acquire("batch")  # espera 0.2 s y se rinde
    assert e.value.reason == "queue_timeout" and e.value.retry_after_s == 60.0
    await adm.acquire("interactive")  # el reservado sigue libre para un humano
    assert adm.inflight("batch") == 3 and adm.inflight("interactive") == 1


@pytest.mark.anyio
async def test_interactive_goes_first_when_a_slot_frees():
    adm = PriorityAdmission(cfg(max_wait_s=(("interactive", 2.0), ("batch", 2.0))))
    for _ in range(4):
        await adm.acquire("interactive")
    order = []

    async def wait(p):
        await adm.acquire(p)
        order.append(p)

    tb = asyncio.create_task(wait("batch"))  # llega PRIMERO
    await asyncio.sleep(0.01)
    ti = asyncio.create_task(wait("interactive"))
    await asyncio.sleep(0.01)
    assert adm.queue_depth("batch") == 1 and adm.queue_depth("interactive") == 1
    adm.release("interactive")  # un lugar: pasa el interactivo aunque el batch esperaba antes
    await asyncio.sleep(0.01)
    assert order == ["interactive"]
    adm.release("interactive")
    await asyncio.wait_for(tb, 1)
    await ti
    assert order == ["interactive", "batch"]


@pytest.mark.anyio
async def test_fifo_within_a_class_and_no_queue_jumping():
    adm = PriorityAdmission(cfg(max_wait_s=(("interactive", 2.0), ("batch", 2.0))))
    for _ in range(4):
        await adm.acquire("interactive")
    order = []

    async def wait(tag):
        await adm.acquire("interactive")
        order.append(tag)

    t1 = asyncio.create_task(wait("a"))
    await asyncio.sleep(0.01)
    t2 = asyncio.create_task(wait("b"))
    await asyncio.sleep(0.01)
    adm.release("interactive")
    adm.release("interactive")
    await asyncio.gather(t1, t2)
    assert order == ["a", "b"]


@pytest.mark.anyio
async def test_queue_full_is_immediate():
    adm = PriorityAdmission(cfg(max_wait_s=(("interactive", 5.0), ("batch", 5.0))))
    for _ in range(4):
        await adm.acquire("interactive")
    waiters = [asyncio.create_task(adm.acquire("interactive")) for _ in range(3)]
    await asyncio.sleep(0.01)
    with pytest.raises(Overloaded) as e:
        await adm.acquire("interactive")  # la cola (3) está llena: no espera, rechaza ya
    assert e.value.reason == "queue_full"
    for w in waiters:
        w.cancel()
    await asyncio.gather(*waiters, return_exceptions=True)
    assert adm.queue_depth("interactive") == 0  # los cancelados no quedan ocupando la cola


@pytest.mark.anyio
async def test_cancelled_waiter_does_not_leak_a_slot():
    adm = PriorityAdmission(cfg(max_wait_s=(("interactive", 5.0), ("batch", 5.0))))
    for _ in range(4):
        await adm.acquire("interactive")
    t = asyncio.create_task(adm.acquire("interactive"))
    await asyncio.sleep(0.01)
    t.cancel()  # el cliente se fue mientras esperaba
    await asyncio.gather(t, return_exceptions=True)
    for _ in range(4):
        adm.release("interactive")
    assert adm.inflight("interactive") == 0  # nadie recibió un lugar fantasma


@pytest.mark.anyio
async def test_slot_context_manager_releases_on_error():
    adm = PriorityAdmission(cfg())
    with pytest.raises(RuntimeError):
        async with adm.slot("interactive"):
            raise RuntimeError("falla el upstream")
    assert adm.inflight("interactive") == 0


def test_release_without_acquire_is_a_bug():
    with pytest.raises(RuntimeError):
        PriorityAdmission(cfg()).release("batch")


def test_config_validation():
    with pytest.raises(ValueError):
        AdmissionConfig(max_inflight=4, interactive_reserved=4)
    with pytest.raises(ValueError):
        AdmissionConfig(queue_max=(("interactive", 1),))
