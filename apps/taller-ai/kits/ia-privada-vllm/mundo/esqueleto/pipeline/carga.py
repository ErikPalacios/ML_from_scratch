"""El generador de carga: manda las preguntas del despacho a vLLM y mide cada una desde el lado del cliente.

    python3 pipeline/carga.py humo       # 1 pregunta: ¿funciona la medición?
    python3 pipeline/carga.py cerrada    # CERRADA_A_LA_VEZ conversaciones a la vez, hasta CERRADA_PETICIONES (carga.env)
    python3 pipeline/carga.py abierta    # PETICIONES llegadas al azar a TASA por segundo, sin tope en el cliente

Contrato (lo revisa verificar.py):
- `una(pregunta, max_tokens)` → `Medida`: una petición en streaming (stream_options include_usage) a
  /v1/chat/completions. ttft_s = del envío al primer pedazo con texto; tpot_s = (e2e_s − ttft_s) ÷ (tokens_salida − 1);
  itl_s = los huecos entre pedazos con texto; tokens_* = el usage del servidor. Un error no truena: queda en la Medida.
- `llegadas(n, tasa, semilla)` → los segundos de llegada: suma de random.Random(semilla).expovariate(tasa), n veces.
- `cerrada(preguntas, a_la_vez, max_tokens)` y `abierta(preguntas, tasa, max_tokens, semilla)` → list[Medida], cada
  una con `programada` (cuándo tocaba mandarla) e `inicio` (cuándo salió), en segundos desde el arranque de la prueba.
- `correr(tipo)` → cada prueba con sus propias preguntas (abierta: semilla; cerrada: semilla + 1; humo: semilla + 2),
  para que el prefix cache no traiga de una prueba a otra prompts ya leídos; escribe resultados/<tipo>.json: {"meta": {...}, "medidas": [...], "metricas": {...}}; metricas
  junta lo que dijo /metrics del servidor durante la prueba (picos de running y waiting, KV cache máximo, preemptions).
Solo usa la biblioteca estándar.
"""
from __future__ import annotations

import json
import random
import sys
import threading
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))
from mundo.comun import RESULTADOS, base_url, escribir_json, leer_env, metricas, motor  # noqa: E402
from mundo.dataset import preguntas as preguntas_despacho  # noqa: E402


@dataclass
class Medida:
    id: str
    ok: bool = False
    status: int = 0
    error: str = ""
    tokens_prompt: int = 0
    tokens_salida: int = 0
    ttft_s: float | None = None
    tpot_s: float | None = None
    e2e_s: float | None = None
    itl_s: list[float] = field(default_factory=list)
    programada: float = 0.0
    inicio: float = 0.0
    fin: str | None = None


def una(pregunta: dict, max_tokens: int, timeout: float = 600) -> Medida:
    raise NotImplementedError("paso 4: una")


def llegadas(n: int, tasa: float, semilla: int) -> list[float]:
    raise NotImplementedError("paso 5: llegadas")


class Muestreo(threading.Thread):
    """Lee /metrics cada segundo mientras dura la prueba: lo que el cliente no ve (la fila y la memoria del motor)."""

    def __init__(self):
        super().__init__(daemon=True)
        self.alto = threading.Event()
        self.pico_running = self.pico_waiting = self.kv_max = 0.0
        self.antes = self.despues = {}

    def leer(self) -> dict:
        try:
            return metricas()
        except Exception:  # noqa: BLE001
            return {}

    def run(self) -> None:
        self.antes = self.leer()
        while not self.alto.wait(1.0):
            x = self.leer()
            self.pico_running = max(self.pico_running, x.get("vllm:num_requests_running", 0))
            self.pico_waiting = max(self.pico_waiting, x.get("vllm:num_requests_waiting", 0))
            self.kv_max = max(self.kv_max, x.get("vllm:kv_cache_usage_perc", 0))

    def resumen(self) -> dict:
        self.alto.set()
        self.join()
        self.despues = self.leer()
        d = lambda k: self.despues.get(k, 0) - self.antes.get(k, 0)  # noqa: E731
        return {"pico_running": self.pico_running, "pico_waiting": self.pico_waiting, "kv_max": round(self.kv_max, 4),
                "preemptions": d("vllm:num_preemptions_total"), "tokens_prompt": d("vllm:prompt_tokens_total"),
                "tokens_cache": d("vllm:prefix_cache_hits_total"), "tokens_salida": d("vllm:generation_tokens_total")}


def cerrada(preguntas: list[dict], a_la_vez: int, max_tokens: int) -> list[Medida]:
    """a_la_vez trabajadores; cada uno manda la siguiente pregunta en cuanto le contestan la anterior."""
    raise NotImplementedError("paso 4: cerrada")


def abierta(preguntas: list[dict], tasa: float, max_tokens: int, semilla: int) -> list[Medida]:
    """Cada pregunta sale a su hora (Poisson), conteste o no el servidor la anterior: sin tope en el cliente."""
    raise NotImplementedError("paso 5: abierta")


def correr(tipo: str) -> Path:
    c, e = leer_env(RAIZ / "carga.env"), leer_env()
    semilla, maxt = int(c["SEMILLA"]), int(c["MAX_TOKENS"])
    meta = {"tipo": tipo, "fecha": datetime.now().astimezone().isoformat(timespec="seconds"), "servidor": base_url(), "modelo": e["NOMBRE"],
            "motor": motor()[1], "max_tokens": maxt, "semilla": semilla, "max_num_seqs": int(e["MAX_NUM_SEQS"])}
    mu = Muestreo()
    mu.start()
    t0 = time.perf_counter()
    if tipo == "humo":
        medidas = [una(preguntas_despacho(1, semilla + 2)[0], 64)]
    elif tipo == "cerrada":
        meta["a_la_vez"] = int(c["CERRADA_A_LA_VEZ"])
        medidas = cerrada(preguntas_despacho(int(c["CERRADA_PETICIONES"]), semilla + 1), meta["a_la_vez"], maxt)
    elif tipo == "abierta":
        meta["tasa"] = float(c["TASA"])
        medidas = abierta(preguntas_despacho(int(c["PETICIONES"]), semilla), meta["tasa"], maxt, semilla)
    else:
        sys.exit(f"tipo desconocido: {tipo} (humo, cerrada o abierta)")
    meta["duracion_s"] = round(time.perf_counter() - t0, 2)
    salida = RESULTADOS / f"{tipo}.json"
    escribir_json(salida, {"meta": meta, "medidas": [asdict(m) for m in medidas], "metricas": mu.resumen()})
    return salida


if __name__ == "__main__":
    tipo = sys.argv[1] if len(sys.argv) > 1 else "humo"
    ruta = correr(tipo)
    d = json.loads(ruta.read_text())
    ok = [m for m in d["medidas"] if m["ok"]]
    print(f"{tipo}: {len(ok)}/{len(d['medidas'])} bien en {d['meta']['duracion_s']:.1f} s → {ruta.relative_to(RAIZ)}")
    if ok:
        m = ok[0]
        print(f"  la primera: {m['tokens_prompt']:,} tokens de entrada → {m['tokens_salida']} de salida · TTFT {m['ttft_s'] * 1000:,.0f} ms"
              + (f" · TPOT {m['tpot_s'] * 1000:.1f} ms" if m["tpot_s"] else "") + f" · total {m['e2e_s']:.1f} s")
    x = d["metricas"]
    print(f"  /metrics: a la vez hasta {x['pico_running']:.0f} · en fila hasta {x['pico_waiting']:.0f} · KV cache hasta {x['kv_max']:.0%}"
          f" · preemptions {x['preemptions']:.0f} · tokens del prompt desde el prefix cache {x['tokens_cache']:,.0f} de {x['tokens_prompt']:,.0f}")
    malos = [m for m in d["medidas"] if not m["ok"]]
    for m in malos[:3]:
        print(f"  ✗ {m['id']}: {m['status']} {m['error'][:120]}")
