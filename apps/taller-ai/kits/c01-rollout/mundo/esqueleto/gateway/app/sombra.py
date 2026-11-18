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


class Sombra:
    def __init__(self, *a, **kw):
        raise NotImplementedError("gateway/app/sombra.py: todavía no la escribes (paso 3 del Guiado)")
