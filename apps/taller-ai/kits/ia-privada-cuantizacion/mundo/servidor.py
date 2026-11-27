"""Sirve un GGUF con llama-server mientras lo mides, y lo apaga al terminar.

    from mundo.servidor import servido
    with servido("cuantizados/Qwen3-0.6B-Q4_K_M.gguf") as url:     # url = http://127.0.0.1:9932/v1
        ...                                                         # aquí el servidor está arriba y contestando

    python3 mundo/servidor.py cuantizados/Qwen3-0.6B-Q4_K_M.gguf    # lo deja arriba hasta Ctrl+C (para probar a mano)

Lo arranca como en la estación 1 (solo en 127.0.0.1, una petición a la vez, sin razonamiento), en el puerto 9932,
con el contexto de medicion.json. Cada GGUF en su propio proceso: así nada de uno se queda en la memoria del otro.
Su log queda en .taller/servidor-<nombre>.log.
"""
from __future__ import annotations

import contextlib
import json
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import PUERTO, RAIZ, TALLER, herramienta, medicion  # noqa: E402


def _salud(timeout: float = 1) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{PUERTO}/health", timeout=timeout) as r:
            return json.load(r).get("status") == "ok"
    except Exception:  # noqa: BLE001
        return False


@contextlib.contextmanager
def servido(gguf: str | Path, contexto: int | None = None):
    gguf = Path(gguf) if Path(gguf).is_absolute() else RAIZ / gguf
    if not gguf.exists():
        raise FileNotFoundError(f"no está {gguf}")
    if _salud():
        raise RuntimeError(f"ya hay un servidor en el puerto {PUERTO}: páralo antes de medir")
    TALLER.mkdir(exist_ok=True)
    ctx = contexto or medicion().get("contexto", 8192)
    log = open(TALLER / f"servidor-{gguf.stem}.log", "w")
    p = subprocess.Popen([herramienta("llama-server") or "llama-server", "-m", str(gguf), "--host", "127.0.0.1", "--port", str(PUERTO),
                          "-c", str(ctx), "-np", "1", "--reasoning", "off", "--alias", gguf.stem],
                         stdout=log, stderr=subprocess.STDOUT)
    try:
        for _ in range(240):
            if p.poll() is not None:
                raise RuntimeError(f"llama-server terminó solo con {gguf.name}: mira .taller/servidor-{gguf.stem}.log")
            if _salud():
                break
            time.sleep(0.25)
        else:
            raise RuntimeError(f"llama-server no contestó /health en 60 s con {gguf.name}")
        yield f"http://127.0.0.1:{PUERTO}/v1"
    finally:
        p.send_signal(signal.SIGTERM)
        try:
            p.wait(10)
        except subprocess.TimeoutExpired:
            p.kill()
        log.close()


if __name__ == "__main__":
    with servido(sys.argv[1]) as url:
        print(f"▶ {sys.argv[1]} en {url} (Ctrl+C para parar)", flush=True)
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\n■ parado")
