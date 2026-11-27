"""El tráfico del asistente contra la API de búsqueda (mundo/servicio.py): las preguntas del golden set, una tras
otra, con varias a la vez, durante unos segundos. Al final dice cuántas contestó cada índice y si alguna falló.

    python mundo/trafico.py --segundos 20          # mientras, en otra terminal: python pipeline/alias.py cambiar ...

Sirve para ver que cambiar el alias no corta el servicio: cada respuesta dice qué índice contestó.
"""
from __future__ import annotations

import argparse
import json
import sys
import threading
import time
from collections import Counter
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import ALMACEN, leer_jsonl  # noqa: E402

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--segundos", type=float, default=20)
    ap.add_argument("--hilos", type=int, default=4)
    ap.add_argument("--puerto", type=int, default=8150)
    a = ap.parse_args()
    v = (ALMACEN / "golden" / "VIGENTE").read_text().strip()
    qs = leer_jsonl(ALMACEN / "golden" / v / "preguntas.jsonl")
    cuenta, errores, linea = Counter(), Counter(), []
    lock = threading.Lock()
    fin = time.time() + a.segundos

    def trabajar(n: int) -> None:
        i = n
        while time.time() < fin:
            x = qs[i % len(qs)]
            i += a.hilos
            lado = "vectores" if i % 2 else "bm25"
            url = f"http://localhost:{a.puerto}/buscar?" + urlencode({"q": x["pregunta"], "persona": x["persona"], "indice": lado})
            try:
                with urlopen(url, timeout=10) as r:
                    nombre = json.loads(r.read())["indice"]
                with lock:
                    cuenta[nombre] += 1
                    if not linea or linea[-1][0] != nombre:
                        linea.append((nombre, time.strftime("%H:%M:%S")))
            except HTTPError as e:
                with lock:
                    errores[f"{e.code} {json.loads(e.read()).get('error', '')[:90]}"] += 1
            except URLError as e:
                with lock:
                    errores[f"sin conexión ({e.reason})"] += 1
            time.sleep(0.02)

    hs = [threading.Thread(target=trabajar, args=(n,)) for n in range(a.hilos)]
    for h in hs:
        h.start()
    for h in hs:
        h.join()
    total = sum(cuenta.values()) + sum(errores.values())
    print(f"{total} peticiones en {a.segundos:.0f} s · {sum(cuenta.values())} contestadas · {sum(errores.values())} con error")
    for nombre, n in cuenta.items():
        print(f"  {n:>5} contestó {nombre}")
    for e, n in errores.most_common():
        print(f"  {n:>5} error: {e}")
    if len(linea) > 1:
        print("  en orden: " + " → ".join(f"{n} (desde {h})" for n, h in linea))
