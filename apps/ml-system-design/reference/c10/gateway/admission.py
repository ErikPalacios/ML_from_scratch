"""Admisión por prioridad en el llm-gateway: cuántos requests mandamos a la flota a la vez, y quién pasa primero.

Por qué hace falta (y no alcanza con el autoscaling): un nodo p5 nuevo tarda ≈ 5–10 min en servir (est.), así
que un pico de 1 minuto no se resuelve escalando. Se resuelve decidiendo en la puerta:
  * Tope de requests EN VUELO hacia la flota (`max_inflight`). Pasado ese número, vLLM solo encolaría por
    dentro: los requests esperarían igual, pero sin que nadie decida quién espera ni hasta cuándo.
  * Dos clases: `interactive` (soporte, asistente de vendedores; un humano mirando el cursor) y `batch`
    (enriquecimiento de catálogo; nadie espera en vivo). Cuando se libera un lugar, pasa primero un
    interactivo. Dentro de cada clase, FIFO.
  * Lugares RESERVADOS para interactive (`interactive_reserved`): batch nunca ocupa más de
    max_inflight − reservados. Sin reserva, de noche el batch llena todos los lugares con requests largos y el
    primer usuario de las 7:00 espera a que termine uno (aquí no hay preemption; vLLM sí puede desalojar de
    la GPU a los de prioridad baja con --scheduling-policy priority, pero eso es dentro de la réplica).
  * Colas ACOTADAS por clase, con espera máxima. Una cola sin tope convierte un pico en minutos de espera
    para todos; acotada, el que no entra recibe un rechazo honesto con Retry-After (503 en llm_gateway.py) y
    el cliente decide: reintentar, degradar o (si el tenant puede) ir al vendor.

Números del caso (por réplica del gateway, con 4 réplicas; ILUSTRATIVOS): el tope sale de lo que la flota aguanta
DENTRO del SLO, no de la carga planeada. 16 réplicas de vLLM × 72 en vuelo (el último punto del barrido que cumple
TTFT y TPOT) ≈ 1,150 en la flota → 288 por réplica del gateway. En el pico de diseño (60 rps × 10.5 s ≈ 630) se usa
≈ 55 %: el margen del 70 % planeado queda disponible para picos. Si el tope fuera lo planeado (≈ 40 por réplica de
vLLM), el gateway daría 503 desde ≈ 61 rps con GPUs de sobra. 72 reservados para interactive (1/4); cola
interactiva de 64 con espera ≤ 0.5 s (el SLO de TTFT es 1 s: esperar más ya lo rompe); cola batch de 256 con
espera ≤ 30 s (el batch-runner reintenta). Lo ideal es que el tope siga a las réplicas listas (12 × 72 con un nodo
caído); aquí es fijo.

Solo asyncio. Un objeto por proceso; se usa con `async with admission.slot("interactive"):`.
"""

from __future__ import annotations  # anotaciones como texto

import asyncio  # futures y timeouts
from collections import deque  # colas FIFO por clase
from contextlib import asynccontextmanager  # slot() como context manager
from dataclasses import dataclass  # configuración

PRIORITIES = ("interactive", "batch")  # orden = prioridad: el primero pasa antes


class Overloaded(Exception):
    """No hay lugar: cola llena o se esperó demasiado. Lleva el Retry-After sugerido."""

    def __init__(self, priority: str, reason: str, retry_after_s: float):
        super().__init__(f"{priority}: {reason}")
        self.priority = priority
        self.reason = reason  # "queue_full" | "queue_timeout"
        self.retry_after_s = retry_after_s


@dataclass(frozen=True)
class AdmissionConfig:
    max_inflight: int = 288  # requests en vuelo hacia la flota desde ESTE proceso (16 × 72 medidos ÷ 4)
    interactive_reserved: int = 72  # lugares que batch no puede ocupar
    queue_max: tuple[tuple[str, int], ...] = (("interactive", 64), ("batch", 256))
    max_wait_s: tuple[tuple[str, float], ...] = (("interactive", 0.5), ("batch", 30.0))
    retry_after_s: tuple[tuple[str, float], ...] = (("interactive", 2.0), ("batch", 60.0))

    def __post_init__(self) -> None:
        if not 0 <= self.interactive_reserved < self.max_inflight:
            raise ValueError("interactive_reserved debe estar en [0, max_inflight)")
        for table in (self.queue_max, self.max_wait_s, self.retry_after_s):
            if {k for k, _ in table} != set(PRIORITIES):
                raise ValueError(f"faltan clases en {table}: se esperan {PRIORITIES}")


DEFAULT_CONFIG = AdmissionConfig()  # los números del docstring


class PriorityAdmission:
    """Semáforo con dos clases, reserva para interactive y colas acotadas con espera máxima."""

    def __init__(self, cfg: AdmissionConfig = DEFAULT_CONFIG):
        self.cfg = cfg
        self._queue_max = dict(cfg.queue_max)
        self._max_wait = dict(cfg.max_wait_s)
        self._retry_after = dict(cfg.retry_after_s)
        self._inflight = {p: 0 for p in PRIORITIES}  # requests en vuelo por clase
        self._waiters: dict[str, deque[asyncio.Future]] = {p: deque() for p in PRIORITIES}

    # ---- lecturas para métricas (llm_gateway.py las publica como gauges)
    def inflight(self, priority: str) -> int:
        return self._inflight[priority]

    def queue_depth(self, priority: str) -> int:
        return sum(1 for f in self._waiters[priority] if not f.done())

    # ---- reglas
    def _has_room(self, priority: str) -> bool:
        total = sum(self._inflight.values())
        if total >= self.cfg.max_inflight:
            return False
        if priority == "batch":  # batch no entra en los lugares reservados
            return self._inflight["batch"] < self.cfg.max_inflight - self.cfg.interactive_reserved
        return True

    def _ahead_of(self, priority: str) -> bool:
        """¿Hay alguien de igual o mayor prioridad esperando? Entonces no se puede saltar la fila."""
        for p in PRIORITIES[: PRIORITIES.index(priority) + 1]:
            if self.queue_depth(p):
                return True
        return False

    def _grant_waiters(self) -> None:
        """Al liberarse un lugar: primero interactive, después batch; dentro de cada clase, FIFO."""
        for p in PRIORITIES:
            q = self._waiters[p]
            while q and self._has_room(p):
                fut = q.popleft()
                if fut.done():  # se canceló (timeout o cliente que se fue): no ocupa lugar
                    continue
                self._inflight[p] += 1  # el lugar se pasa ANTES de despertar: nadie se lo puede robar
                fut.set_result(None)
            if q and any(not f.done() for f in q) and p == "interactive":
                return  # quedan interactivos esperando: batch no pasa adelante

    async def acquire(self, priority: str) -> None:
        if priority not in PRIORITIES:
            raise ValueError(f"prioridad desconocida: {priority}")
        if not self._ahead_of(priority) and self._has_room(priority):
            self._inflight[priority] += 1  # camino rápido: hay lugar y nadie esperando delante
            return
        if self.queue_depth(priority) >= self._queue_max[priority]:
            raise Overloaded(priority, "queue_full", self._retry_after[priority])
        fut = asyncio.get_running_loop().create_future()
        self._waiters[priority].append(fut)
        try:
            await asyncio.wait_for(fut, self._max_wait[priority])
        except asyncio.TimeoutError:
            self._abandon(priority, fut)
            raise Overloaded(priority, "queue_timeout", self._retry_after[priority]) from None
        except asyncio.CancelledError:
            self._abandon(priority, fut)  # el cliente se fue mientras esperaba
            raise

    def _abandon(self, priority: str, fut: asyncio.Future) -> None:
        if fut.done() and not fut.cancelled():
            # Le dieron el lugar justo cuando vencía el timeout (o la cancelación): devolverlo
            self.release(priority)
        else:
            fut.cancel()
            try:
                self._waiters[priority].remove(fut)
            except ValueError:
                pass

    def release(self, priority: str) -> None:
        if self._inflight[priority] <= 0:
            raise RuntimeError(f"release sin acquire en {priority}")
        self._inflight[priority] -= 1
        self._grant_waiters()

    @asynccontextmanager
    async def slot(self, priority: str):
        await self.acquire(priority)
        try:
            yield
        finally:
            self.release(priority)
