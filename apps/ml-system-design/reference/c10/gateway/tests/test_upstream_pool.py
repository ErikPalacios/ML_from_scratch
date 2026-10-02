"""El pool de conexiones REAL del gateway (sin MockTransport) contra un servidor uvicorn local.

Los demás tests usan httpx2.MockTransport, que no tiene pool de conexiones: no pueden ver que el default de
httpx2 (100 conexiones) deja esperando al request 101 de una réplica del gateway hasta un PoolTimeout. Este sí:
abre `max_inflight` streams a la vez (los 288 de tenants.yaml), como en el pico, y exige cero fallas.
"""

import asyncio  # concurrencia
import resource  # subir el límite de archivos abiertos (macOS trae 256 por defecto)
import socket  # puerto libre para el servidor de prueba
from pathlib import Path  # tenants.yaml

import pytest  # runner
import uvicorn  # servidor HTTP real
from starlette.applications import Starlette  # un "vLLM" mínimo
from starlette.responses import StreamingResponse
from starlette.routing import Route

from llm_gateway import HttpUpstream, UpstreamUnavailable, load_config

HERE = Path(__file__).resolve().parent.parent


@pytest.fixture
def anyio_backend():
    return "asyncio"


def _raise_fd_limit(needed: int) -> None:
    soft, hard = resource.getrlimit(resource.RLIMIT_NOFILE)
    if soft != resource.RLIM_INFINITY and soft < needed:
        target = needed if hard == resource.RLIM_INFINITY else min(needed, hard)
        resource.setrlimit(resource.RLIMIT_NOFILE, (target, hard))


@pytest.mark.anyio
async def test_max_inflight_concurrent_streams_fit_in_the_pool_and_connections_are_not_reused():
    limits = load_config(HERE / "tenants.yaml").limits
    n = limits.max_inflight  # 288: lo que la admisión deja pasar a la vez desde UNA réplica del gateway
    _raise_fd_limit(4 * n + 256)  # cliente y servidor en el mismo proceso: 2 sockets por stream

    release = asyncio.Event()
    peak = {"open": 0, "max": 0}

    async def chat(request):
        async def gen():
            peak["open"] += 1
            peak["max"] = max(peak["max"], peak["open"])
            try:
                yield b'data: {"choices":[{"index":0,"delta":{"content":"x"}}]}\n\n'
                await release.wait()  # una generación larga: el stream retiene su conexión
                yield b"data: [DONE]\n\n"
            finally:
                peak["open"] -= 1
        return StreamingResponse(gen(), media_type="text/event-stream")

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(Starlette(routes=[Route("/v1/chat/completions", chat, methods=["POST"])]),
                                           log_level="warning", backlog=2048, lifespan="off"))
    serve = asyncio.create_task(server.serve(sockets=[sock]))
    while not server.started:
        await asyncio.sleep(0.01)

    up = HttpUpstream("vllm-70b", f"http://127.0.0.1:{port}/v1", "self", limits)  # transport real (con pool)
    opened = 0
    all_open = asyncio.Event()

    async def one():
        nonlocal opened
        try:
            stream = await up.open_stream({"model": "m", "messages": [], "stream": True})
        except UpstreamUnavailable as e:
            return f"falló: {e}"
        try:
            await stream.next_event()
            opened += 1
            if opened == n:
                all_open.set()
            await release.wait()
            while await stream.next_event() is not None:
                pass
            return "ok"
        finally:
            await stream.aclose()

    try:
        tasks = [asyncio.create_task(one()) for _ in range(n)]
        await asyncio.wait_for(all_open.wait(), 20)  # con el pool default (100) esto no llega nunca: PoolTimeout
        assert peak["max"] == n  # los n streams vivos A LA VEZ en el servidor
        release.set()
        results = await asyncio.gather(*tasks)
        assert results == ["ok"] * n
        # Sin keep-alive hacia vLLM: terminado el stream, la conexión se cierra (el próximo request abre otra y
        # kube-proxy la manda a un pod listo; una reusada seguiría yendo a un pod que ya salió de los endpoints)
        assert up.client._transport._pool.connections == []
    finally:
        release.set()
        await up.aclose()
        server.should_exit = True
        await serve
