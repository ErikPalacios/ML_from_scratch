"""La sombra (shadow) del gateway: copia una parte de las requests al Triton del challenger, guarda lo que contesta en el
log y lo tira. El usuario nunca espera a la copia ni ve su respuesta.

Contrato (lo usa gateway/app/main.py, que viene dado):
- Sombra(url, modelo, entrada, salida, version, fraccion, cola, plazo_ms, trabajadores, contar=None, cliente=None)
  · url: el Triton del challenger (SOMBRA_URL, p. ej. triton-v15:8000); version: su model_version (SOMBRA_VERSION).
  · fraccion: la parte de las requests que se copia (0.10 = 10 %); cola: lugares de la fila; plazo_ms: lo más que se
    espera a ese Triton por copia; trabajadores: tareas que vacían la fila.
  · contar(resultado): se llama una vez por request de la muestra con "ok", "plazo", "error" o "llena".
  · cliente: un cliente de Triton ya hecho (las pruebas pasan uno falso); si no, uno de tritonclient.http.aio.
- a_la_sombra(request_id) -> bool: True si la request es de la muestra. Por hash del request_id (sha256, los primeros
  8 hex como número, módulo 10,000, menor que fraccion × 10,000): la misma request da siempre lo mismo.
- copiar(x, request_id) -> bool: si es de la muestra, mete (x, request_id) en la fila SIN esperar y devuelve True; si
  la fila está llena, la tira, cuenta «llena» y devuelve False. Nunca bloquea: es una llamada síncrona.
- await arrancar(): crea el cliente (si no se lo dieron) y las tareas; await parar(): las cancela y cierra el cliente.
- Cada copia que sale de la fila: infer con asyncio.wait_for(plazo_ms) y una línea de JSON en stdout con request_id,
  model_version (la del challenger), shadow: true, top5 [[índice, score]], ms {triton}, status (200, o 504 por plazo,
  503 por error) y, si falló, error. Nada más: ni base de datos, ni caché, ni respuesta al usuario.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import time

import numpy as np


class Sombra:
    def __init__(self, url, modelo, entrada, salida, version, fraccion, cola, plazo_ms, trabajadores,
                 contar=None, cliente=None):
        self.url, self.modelo, self.entrada, self.salida = url, modelo, entrada, salida
        self.version, self.fraccion, self.plazo = version, fraccion, plazo_ms / 1000
        self.n_trabajadores = trabajadores
        self.fila: asyncio.Queue = asyncio.Queue(maxsize=cola)    # acotada: maxsize=0 sería infinita
        self.contar = contar or (lambda _res: None)
        self.cliente, self._propio = cliente, cliente is None
        self.tareas: list[asyncio.Task] = []

    def a_la_sombra(self, request_id: str) -> bool:
        h = int(hashlib.sha256(request_id.encode()).hexdigest()[:8], 16)
        return h % 10_000 < self.fraccion * 10_000

    def copiar(self, x, request_id: str) -> bool:
        if not self.a_la_sombra(request_id):
            return False
        try:
            self.fila.put_nowait((x, request_id))
            return True
        except asyncio.QueueFull:
            self.contar("llena")
            return False

    async def arrancar(self) -> None:
        if self.cliente is None:
            from tritonclient.http.aio import InferenceServerClient
            self.cliente = InferenceServerClient(url=self.url, conn_limit=self.n_trabajadores * 2)
        self.tareas = [asyncio.create_task(self._trabajar()) for _ in range(self.n_trabajadores)]

    async def parar(self) -> None:
        for t in self.tareas:
            t.cancel()
        await asyncio.gather(*self.tareas, return_exceptions=True)
        if self._propio and self.cliente is not None:
            await self.cliente.close()

    async def _trabajar(self) -> None:
        while True:
            x, rid = await self.fila.get()
            try:
                await self._una(x, rid)
            finally:
                self.fila.task_done()

    async def _una(self, x, rid: str) -> None:
        from tritonclient.http.aio import InferInput, InferRequestedOutput
        ev = {"request_id": rid, "model_version": self.version, "shadow": True}
        t = time.monotonic()
        try:
            ent = InferInput(self.entrada, [1, *x.shape], "FP32")
            ent.set_data_from_numpy(x[None], binary_data=True)
            res = await asyncio.wait_for(self.cliente.infer(self.modelo, [ent], outputs=[
                InferRequestedOutput(self.salida, binary_data=True)], request_id=rid), self.plazo)
            z = res.as_numpy(self.salida)[0].astype(np.float64)
            e = np.exp(z - z.max())
            p = e / e.sum()
            orden = np.argsort(-p, kind="stable")
            ev["top5"] = [[int(i), round(float(p[i]), 4)] for i in orden[:5]]
            ev["status"], resultado = 200, "ok"
        except TimeoutError:
            ev["status"], ev["error"], resultado = 504, f"la sombra no contestó en {self.plazo * 1000:.0f} ms", "plazo"
        except Exception as e:  # noqa: BLE001 — cualquier falla de la copia se anota y se tira
            ev["status"], ev["error"], resultado = 503, f"{type(e).__name__}: {str(e)[:160]}", "error"
        ev["ms"] = {"triton": round((time.monotonic() - t) * 1000, 1)}
        self.contar(resultado)
        print(json.dumps(ev, ensure_ascii=False), flush=True)
