"""Manda fotos al gateway por el «ALB» del dojo (localhost:8910), a un ritmo fijo, y cuenta lo que vuelve.

    python3 mundo/carga.py --por-segundo 40 --segundos 600 --cada 30    # 40 fotos/s por 10 min, un renglón cada 30 s
    python3 mundo/carga.py --por-segundo 40 --segundos 0                # hasta que la pares (Ctrl-C)

Cada foto sale al azar de las 300 de mundo/fotos/, con su propio X-Request-ID (c-<número>). Carga abierta: las fotos
salen a su hora aunque las anteriores no hayan vuelto (así llega el tráfico real), hasta 64 en vuelo.
Cada renglón dice cuántas contestó cada versión del modelo (el model_version de la respuesta): así ves el reparto del
canary. Al final: por código HTTP (0 = no hubo respuesta) y por versión, con p50 y p99 de las 200.
No es parte de lo que escribes. En C01: el tráfico de la app, que entra por el ALB.
"""
from __future__ import annotations

import argparse
import json
import random
import sys
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import GATEWAY, fotos  # noqa: E402

import urllib.error  # noqa: E402
import urllib.request  # noqa: E402


def percentil(xs: list[float], p: float) -> float:
    if not xs:
        return float("nan")
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(p / 100 * (len(xs) - 1))))]


def mandar(datos: bytes, rid: str) -> tuple[int, str]:
    req = urllib.request.Request(f"{GATEWAY}/v1/classify", data=datos, method="POST",
                                 headers={"Content-Type": "image/jpeg", "X-Request-ID": rid, "X-Client-Source": "mobile"})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, json.loads(r.read()).get("model_version", "?")
    except urllib.error.HTTPError as e:
        return e.code, ""
    except (urllib.error.URLError, OSError, TimeoutError, ValueError):
        return 0, ""


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--por-segundo", type=float, default=40)
    ap.add_argument("--segundos", type=float, default=60, help="0 = hasta Ctrl-C")
    ap.add_argument("--cada", type=float, default=0, help="un renglón de avance cada N segundos")
    ap.add_argument("--semilla", type=int, default=None)
    a = ap.parse_args()
    fs = [p.read_bytes() for p in fotos()]
    rnd = random.Random(a.semilla)
    base = f"c-{int(time.time()) % 100000:05d}"
    codigos, versiones, lat = Counter(), Counter(), {}
    tramo = Counter()
    lock = threading.Lock()
    en_vuelo = threading.Semaphore(64)

    def una(i: int) -> None:
        t = time.perf_counter()
        st, v = mandar(rnd.choice(fs), f"{base}-{i:07d}")
        ms = (time.perf_counter() - t) * 1000
        with lock:
            codigos[st] += 1
            if st == 200:
                versiones[v] += 1
                tramo[v] += 1
                lat.setdefault(v, []).append(ms)
            else:
                tramo[f"código {st}"] += 1
        en_vuelo.release()

    import signal
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt))   # kill: igual que Ctrl-C
    t0 = time.time()
    sig = t0 + a.cada if a.cada else None
    i = 0
    try:
        with ThreadPoolExecutor(max_workers=64) as ex:
            while not a.segundos or time.time() - t0 < a.segundos:
                hora = t0 + i / a.por_segundo
                if hora > time.time():
                    time.sleep(max(0.0, hora - time.time()))
                if not en_vuelo.acquire(timeout=0):
                    with lock:
                        codigos["sin lugar"] += 1
                else:
                    ex.submit(una, i)
                i += 1
                if sig and time.time() >= sig:
                    with lock:
                        tot = sum(tramo.values()) or 1
                        txt = " · ".join(f"{k} {n} ({n / tot:.0%})" for k, n in sorted(tramo.items()))
                        tramo.clear()
                    print(f"  {time.time() - t0:5.0f} s  {txt}", flush=True)
                    sig += a.cada
    except KeyboardInterrupt:
        pass
    dur = time.time() - t0
    print(f"{i} fotos en {dur:.0f} s ({i / max(dur, 1e-9):.1f}/s) por {GATEWAY}")
    print("  por código: " + " · ".join(f"{k}: {n}" for k, n in sorted(codigos.items(), key=lambda x: str(x[0]))))
    for v, n in sorted(versiones.items()):
        print(f"  {v}: {n} ({n / max(sum(versiones.values()), 1):.1%}) · p50 {percentil(lat[v], 50):.0f} ms · "
              f"p99 {percentil(lat[v], 99):.0f} ms")


if __name__ == "__main__":
    main()
