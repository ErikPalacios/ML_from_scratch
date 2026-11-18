"""Prueba gateway/app/sombra.py contra su contrato, dentro de la imagen del gateway (la usa verificar.py sombra-codigo):

    docker run --rm -v $PWD/gateway/app:/srv/gateway/app:ro -v $PWD/mundo:/srv/mundo:ro <imagen> \
        python /srv/mundo/prueba_sombra.py

Un Triton falso, sin red: uno que contesta al instante y otro que tarda 1 s. Imprime una línea por prueba y, al final,
«OK n» o el primer «FALLA …». No es parte de lo que escribes.
"""
import asyncio
import contextlib
import io
import json
import sys
import time

import numpy as np

sys.path.insert(0, "/srv/gateway")
from app.sombra import Sombra  # noqa: E402


class Res:
    def __init__(self, z):
        self.z = z

    def as_numpy(self, _nombre):
        return self.z


class Falso:
    def __init__(self, tarda=0.0):
        self.tarda, self.llamadas = tarda, 0

    async def infer(self, modelo, entradas, outputs=None, request_id=""):
        self.llamadas += 1
        await asyncio.sleep(self.tarda)
        return Res(np.arange(10, dtype=np.float32)[None])

    async def close(self):
        pass


def nueva(cliente, **kw):
    cuenta = {}
    args = dict(url="falso:8000", modelo="classifier", entrada="input", salida="logits", version="resnet50-2026-11-01",
                fraccion=0.10, cola=64, plazo_ms=150, trabajadores=2,
                contar=lambda r: cuenta.__setitem__(r, cuenta.get(r, 0) + 1), cliente=cliente)
    args.update(kw)
    return Sombra(**args), cuenta


def falla(msg):
    print(f"FALLA {msg}")
    sys.exit(1)


async def main():
    x = np.zeros((3, 32, 32), dtype=np.float32)
    s, _ = nueva(Falso())
    ids = [f"r-{i:06d}" for i in range(20_000)]
    n = sum(s.a_la_sombra(r) for r in ids)
    if not 1_900 <= n <= 2_100:
        falla(f"fraccion=0.10 copió {n} de 20,000 (se esperan ≈ 2,000)")
    if any(s.a_la_sombra(r) != s.a_la_sombra(r) for r in ids[:500]):
        falla("la misma request_id no da siempre la misma decisión")
    print(f"muestra: {n} de 20,000 ({n / 200:.1f} %), la misma request siempre igual")

    s, cuenta = nueva(Falso(), cola=2)                  # sin arrancar: nadie vacía la fila
    dentro = [r for r in ids if s.a_la_sombra(r)][:3]
    t = time.perf_counter()
    r = [s.copiar(x, rid) for rid in dentro]
    ms = (time.perf_counter() - t) * 1000
    if r != [True, True, False] or cuenta.get("llena") != 1:
        falla(f"con la fila de 2 llena, copiar() dio {r} y contó {cuenta}: la tercera se tira y cuenta «llena»")
    if ms > 20:
        falla(f"tres copiar() tardaron {ms:.0f} ms: copiar() no debe esperar")
    fuera = next(rid for rid in ids if not s.a_la_sombra(rid))
    if s.copiar(x, fuera):
        falla("copiar() aceptó una request que no es de la muestra")
    print(f"fila acotada: la tercera copia se tira («llena»), tres copiar() en {ms:.2f} ms")

    for nombre, cliente, plazo, status in (("rápido", Falso(), 150, 200), ("lento", Falso(tarda=1.0), 50, 504)):
        s, cuenta = nueva(cliente, plazo_ms=plazo)
        salida = io.StringIO()
        with contextlib.redirect_stdout(salida):
            await s.arrancar()
            t = time.perf_counter()
            s.copiar(x, dentro[0])
            while not salida.getvalue() and time.perf_counter() - t < 2:
                await asyncio.sleep(0.01)
            ms = (time.perf_counter() - t) * 1000
            await s.parar()
        lineas = [json.loads(ln) for ln in salida.getvalue().splitlines() if ln.startswith("{")]
        if len(lineas) != 1:
            falla(f"Triton {nombre}: se esperaba 1 línea de JSON en stdout y hubo {len(lineas)}")
        ev = lineas[0]
        if ev.get("request_id") != dentro[0] or ev.get("shadow") is not True or ev.get("model_version") != "resnet50-2026-11-01":
            falla(f"Triton {nombre}: la línea necesita request_id, shadow: true y model_version del challenger: {ev}")
        if ev.get("status") != status:
            falla(f"Triton {nombre} (plazo {plazo} ms): status {ev.get('status')} y se esperaba {status}")
        if status == 200 and ev.get("top5", [[None]])[0][0] != 9:
            falla(f"Triton rápido: top5 debería empezar por la categoría 9: {ev.get('top5')}")
        if status == 504 and ms > plazo + 300:
            falla(f"Triton lento: la copia tardó {ms:.0f} ms en rendirse con plazo de {plazo} ms")
        if "ms" not in ev or "triton" not in ev["ms"]:
            falla(f"Triton {nombre}: falta ms.triton en la línea")
        print(f"Triton {nombre}: status {ev['status']} en {ms:.0f} ms, cuenta {cuenta}")
    print("OK 4")


asyncio.run(main())
