"""Manda fotos al gateway por el «ALB interno» (localhost:8901), a un ritmo fijo, y cuenta lo que vuelve.

    python mundo/carga.py --por-segundo 40 --segundos 30          # carga abierta: 40 fotos por segundo, 30 s
    python mundo/carga.py --por-segundo 60 --segundos 180 --cada 30 --12mp   # fotos de celular, un renglón cada 30 s

La foto es mundo/foto.jpg (1,200 × 1,200 px, 99 KB: ya reducida por la app) o, con --12mp, mundo/foto-12mp.jpg
(4,000 × 3,000 px, 624 KB: tal cual sale del celular; decodificarla cuesta ≈ 10 veces más CPU). Carga abierta: las fotos
salen a su hora aunque las anteriores no hayan vuelto (así llega el tráfico real), hasta 64 en vuelo a la vez.
Al final: cuántas por código HTTP (0 = no hubo respuesta: conexión cortada o rechazada), p50 y p99 de las 200.
No es parte de lo que escribes. En C01: el tráfico de la app, que entra por el ALB.
"""
from __future__ import annotations

import argparse
import sys
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import GATEWAY, foto, http  # noqa: E402


def percentil(xs: list[float], p: float) -> float:
    if not xs:
        return float("nan")
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(p / 100 * (len(xs) - 1))))]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--por-segundo", type=float, default=20)
    ap.add_argument("--segundos", type=float, default=30)
    ap.add_argument("--cada", type=float, default=0, help="imprime un renglón parcial cada tantos segundos")
    ap.add_argument("--12mp", dest="grande", action="store_true", help="la foto de 12 MP en lugar de la de 1,200 px")
    a = ap.parse_args()
    datos = foto("foto-12mp.jpg" if a.grande else "foto.jpg")
    url = f"{GATEWAY}/v1/classify"
    codigos: Counter = Counter()
    lat: list[float] = []
    parcial: Counter = Counter()
    candado = threading.Lock()

    def una() -> None:
        t = time.perf_counter()
        st, _ = http(url, datos, timeout=5)
        dt = (time.perf_counter() - t) * 1000
        with candado:
            codigos[st] += 1
            parcial[st] += 1
            if st == 200:
                lat.append(dt)

    total = int(a.por_segundo * a.segundos)
    t0 = time.perf_counter()
    prox_reporte = a.cada
    print(f"carga: {a.por_segundo:g} fotos/s durante {a.segundos:g} s ({total} fotos) → {url}", flush=True)
    with ThreadPoolExecutor(64) as pool:
        for i in range(total):
            hora = t0 + i / a.por_segundo
            espera = hora - time.perf_counter()
            if espera > 0:
                time.sleep(espera)
            pool.submit(una)
            if a.cada and time.perf_counter() - t0 >= prox_reporte:
                with candado:
                    txt = " ".join(f"{k}:{v}" for k, v in sorted(parcial.items()))
                    parcial.clear()
                print(f"  t = {prox_reporte:4.0f} s  {txt}", flush=True)
                prox_reporte += a.cada
    dur = time.perf_counter() - t0
    resumen = " · ".join(f"{k if k else 'sin respuesta'}: {v}" for k, v in sorted(codigos.items()))
    print(f"{sum(codigos.values())} fotos en {dur:.1f} s · {resumen}")
    print(f"latencia de las 200: p50 {percentil(lat, 50):.0f} ms · p99 {percentil(lat, 99):.0f} ms")
    sys.exit(0 if set(codigos) == {200} else 1)


if __name__ == "__main__":
    main()
