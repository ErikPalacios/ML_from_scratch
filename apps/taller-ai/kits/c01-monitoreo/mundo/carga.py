"""Los callers (no es parte de lo que escribes): el backend de publicaciones (las apps mobile y web), moderación y
búsqueda mandando fotos a los dos pods del gateway. En C01 pasan por el ALB; aquí van directo a los pods.

    python mundo/carga.py --tasa 20 --segundos 60     # tráfico abierto (Poisson): 20 fotos/s durante un minuto
    python mundo/carga.py --siempre --tasa 5          # el tráfico de siempre (lo arranca mundo/servicios.py)

Cómo procesa la foto cada app sale de mundo/callers.json, que se relee cada 5 s: cuando el equipo de una app saca una
versión nueva, su tráfico cambia sin que nadie reinicie nada (como en producción). Al final imprime cuántas hubo por
código y por source.
"""
from __future__ import annotations

import argparse
import asyncio
import io
import json
import random
import sys
import time
import uuid
from collections import Counter
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import FOTOS, MUNDO, PODS, leer_json  # noqa: E402

CALLERS = MUNDO / "callers.json"
TIMEOUT_S = 0.300


def procesar(data: bytes, proceso: dict | None) -> bytes:
    """Lo que hace la app con la foto antes de mandarla (contraste, compresión)."""
    if not proceso:
        return data
    from PIL import Image, ImageEnhance

    im = Image.open(io.BytesIO(data)).convert("RGB")
    if proceso.get("contraste", 1) != 1:
        im = ImageEnhance.Contrast(im).enhance(proceso["contraste"])
    b = io.BytesIO()
    im.save(b, "JPEG", quality=proceso.get("calidad", 90))
    return b.getvalue()


class Callers:
    def __init__(self, semilla: int):
        self.rng = random.Random(semilla)
        self.fotos = [p.read_bytes() for p in sorted(FOTOS.glob("*.jpg"))]
        self.cfg, self.leido, self.cache = {}, 0.0, {}
        self.cuenta = Counter()

    def config(self) -> dict:
        if time.time() - self.leido > 5:
            nuevo = leer_json(CALLERS, self.cfg) or self.cfg
            if nuevo != self.cfg:
                self.cache = {}
            self.cfg, self.leido = nuevo, time.time()
        return self.cfg

    def foto(self, fuente: str) -> bytes:
        i = self.rng.randrange(len(self.fotos))
        app = self.config().get("apps", {}).get(fuente) or {}
        clave = (fuente, i)
        if clave not in self.cache:
            self.cache[clave] = procesar(self.fotos[i], app.get("proceso"))
        return self.cache[clave]

    def elegir(self) -> tuple[str, str]:
        caller = self.rng.choices(["backend-publicaciones", "moderacion", "busqueda"], [0.7, 0.2, 0.1])[0]
        fuente = {"backend-publicaciones": self.rng.choices(["mobile", "web"], [0.6, 0.4])[0],
                  "moderacion": "internal", "busqueda": "web"}[caller]
        return caller, fuente

    async def una(self, cli: httpx.AsyncClient, n: int) -> None:
        caller, fuente = self.elegir()
        url = list(PODS.values())[n % len(PODS)]
        try:
            r = await cli.post(f"{url}/v1/classify", content=self.foto(fuente), timeout=TIMEOUT_S,
                               headers={"Content-Type": "image/jpeg", "X-Caller-Id": caller, "X-Client-Source": fuente,
                                        "X-Request-ID": str(uuid.uuid4())})
            self.cuenta[(r.status_code, fuente)] += 1
        except httpx.TimeoutException:
            self.cuenta[("timeout", fuente)] += 1
        except httpx.HTTPError:
            self.cuenta[("sin conexión", fuente)] += 1


async def correr(a) -> None:
    c = Callers(a.semilla)
    tareas, n = set(), 0
    fin = None if a.siempre else time.monotonic() + a.segundos
    async with httpx.AsyncClient(limits=httpx.Limits(max_connections=64)) as cli:
        while fin is None or time.monotonic() < fin:
            await asyncio.sleep(c.rng.expovariate(a.tasa))
            t = asyncio.create_task(c.una(cli, n))
            tareas.add(t)
            t.add_done_callback(tareas.discard)
            n += 1
        await asyncio.gather(*tareas)
    total = sum(c.cuenta.values())
    print(f"{total} requests en {a.segundos} s")
    for (cod, f), k in sorted(c.cuenta.items(), key=lambda x: (str(x[0][0]), x[0][1])):
        print(f"  {cod} {f:<9} {k}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--tasa", type=float, default=20)
    ap.add_argument("--segundos", type=float, default=30)
    ap.add_argument("--siempre", action="store_true")
    ap.add_argument("--semilla", type=int, default=None)
    asyncio.run(correr(ap.parse_args()))


if __name__ == "__main__":
    main()
