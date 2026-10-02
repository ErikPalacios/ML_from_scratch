"""Piezas comunes de los tests del agente: reloj falso, backend con pedidos de ejemplo y armado del loop."""

import asyncio
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from agent.backend import InMemoryCommerceBackend, demo_orders
from agent.llm import ScriptedChatModel
from agent.loop import AgentLoop, LoopLimits
from agent.policy import AuthContext
from agent.state import StepLog
from agent.tools import ToolExecutor

NOW = datetime(2026, 10, 1, 15, 0, tzinfo=UTC)  # un jueves a las 9:00 de CDMX
ME = AuthContext("cust-1")


class FakeClock:
    """Reloj monotónico falso: el modelo con guion "tarda" avanzándolo, sin dormir de verdad."""

    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t

    def advance(self, s: float) -> None:
        self.t += s


def run(coro):
    return asyncio.run(coro)


async def collect(agen):
    return [ev async for ev in agen]


class Recorder:
    """Observer que guarda todo lo que el loop reporta (en lugar de Prometheus)."""

    def __init__(self) -> None:
        self.calls: list[tuple] = []

    def __getattr__(self, name):
        return lambda *a, **k: self.calls.append((name, *a))

    def of(self, name):
        return [c[1:] for c in self.calls if c[0] == name]


@pytest.fixture
def backend():
    return InMemoryCommerceBackend(demo_orders(NOW), now=NOW, hang_s=1.0)


@pytest.fixture
def clock():
    return FakeClock()


@pytest.fixture
def make_loop(backend, clock, tmp_path):
    """make_loop(script, **kw) → (loop, llm, store, recorder). Mismo archivo SQLite si se llama dos veces."""
    db = str(tmp_path / "steps.db")
    opened: list[StepLog] = []

    def _make(script, *, limits=None, crash_hook=None, store=None, timeout_s=0.2):
        llm = ScriptedChatModel(script, advance=clock.advance)
        rec = Recorder()
        if store is None:
            store = StepLog(db, durable=False)  # NORMAL: alcanza para simular que muere el proceso
            opened.append(store)
        loop = AgentLoop(llm, ToolExecutor(backend, backoff_s=0.0, timeout_override_s=timeout_s), store,
                         limits=limits or LoopLimits(), observer=rec, clock=clock, now=lambda: NOW,
                         crash_hook=crash_hook)
        return loop, llm, store, rec

    yield _make
    for st in opened:
        st.close()


def call(name, **args):
    return {"tool_calls": [{"name": name, "arguments": args}]}


def say(text, **kw):
    return {"content": text, **kw}


def types(events):
    return [e.type for e in events]


@pytest.fixture
def h():
    """Atajos para los tests (con --import-mode=importlib, conftest no se importa como módulo)."""
    return SimpleNamespace(NOW=NOW, ME=ME, run=run, collect=collect, call=call, say=say, types=types)
