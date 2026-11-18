"""Las pruebas del gateway: la tabla de códigos, los topes, el plazo, la salud, el log y las métricas.

    python -m pytest -q          # desde la carpeta del kit; ≈ 5 s, sin Triton

Contrato:
- Cada fila de la tabla de códigos tiene al menos una prueba: 200, 400, 405, 413 (header, al leer y por píxeles),
  415, 422, 499, 500, 503 (en vuelo, Triton con error, sin conexión) y 504.
- Revisan lo que le llega a Triton (nombre, tipo y forma del tensor) y lo que sale en el log y en /metrics.
- Ninguna necesita Triton ni red: usan TritonFalso (conftest.py).
"""
# Todavía no está escrito (paso 8 del GUION).
