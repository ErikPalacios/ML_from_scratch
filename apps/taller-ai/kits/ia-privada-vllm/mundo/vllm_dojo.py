"""El vLLM del dojo: imita a `vllm serve` en una Mac sin GPU, para practicar la estación antes de pagar una GPU.

    python3 mundo/vllm_dojo.py serve Qwen/Qwen3-32B-AWQ --max-model-len 8192 --max-num-seqs 8 --api-key …
    (o `vllm serve …` con mundo/bin en el PATH: lo pone mundo/servidor.py cuando no hay vLLM instalado)

**No es vLLM y no mide nada.** Hace, paso por paso y en tiempo real, la cuenta de servilleta de una GPU (la de
gpu.env, por omisión una L40S) sirviendo el modelo de mundo/modelos.json:

- **Memoria.** KV cache = memoria × --gpu-memory-utilization (sin el flag, toda: el KV cache extensible de la 0.34)
  − pesos − ≈ 2 GiB del programa, en bloques de 16 tokens.
- **Un paso del motor** (continuous batching con chunked prefill, como el scheduler V1 de vLLM): un token para
  cada conversación que ya escribe, y con lo que sobre del presupuesto (--max-num-batched-tokens) un pedazo del
  prompt de las que leen. Entran conversaciones nuevas mientras haya lugar (--max-num-seqs) y bloques libres.
- **Lo que tarda ese paso** = el mayor de: leer pesos + KV de memoria (÷ 0.7 del ancho de banda) y hacer
  2 × parámetros × tokens del paso FLOPs (÷ 0.5 de los FLOPs pico). Las eficiencias son las de la ficha del despacho.
- **Si se acaban los bloques**, saca a la última conversación que entró (preemption) y la vuelve a leer después.
- **Prefix caching**: los bloques de prompt que ya leyó (las instrucciones comunes) no se vuelven a calcular.

Habla la misma API que vLLM (/v1/models, /v1/chat/completions con streaming, /tokenize, /health, /metrics con los
nombres vllm:…), con sus errores. El texto que escribe es relleno: lo que importa aquí es el tiempo, la memoria y la
fila, no la respuesta. El tokenizer es aproximado (no el de Qwen3). Solo usa la biblioteca estándar de Python.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import sys
import threading
import time
import uuid
from collections import deque
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MUNDO = Path(__file__).resolve().parent
VERSION = "0.34.0"          # la versión de vLLM que imita (la del despacho)
BLOQUE = 16                 # tokens por bloque del KV cache
PROGRAMA_GIB = 2.0          # lo que se come el programa además de pesos y KV (activaciones, CUDA graphs…)
GIB = 2**30
VOCAB = 151_936             # el tamaño del vocabulario de Qwen3 (los ids del tokenizer aproximado caen ahí)
CUBETAS_TTFT = [0.001, 0.005, 0.01, 0.02, 0.04, 0.06, 0.08, 0.1, 0.25, 0.5, 0.75, 1.0, 2.5, 5.0, 7.5, 10.0, 20.0, 40.0, 80.0, 160.0, 640.0, 2560.0]
CUBETAS_ITL = [0.01, 0.025, 0.05, 0.075, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.75, 1.0, 2.5, 5.0, 7.5, 10.0, 20.0, 40.0, 80.0]
CUBETAS_E2E = [0.3, 0.5, 0.8, 1.0, 1.5, 2.0, 2.5, 5.0, 10.0, 15.0, 20.0, 30.0, 40.0, 50.0, 60.0, 120.0, 240.0, 480.0, 960.0, 1920.0, 7680.0]
RELLENO = ("la cláusula establece que el arrendatario pagará la renta pactada dentro de los primeros cinco días de cada mes "
           "y que cualquier modificación al contrato deberá constar por escrito firmada por ambas partes ante dos testigos "
           "conforme a lo dispuesto en el código civil aplicable al lugar de celebración").split()
PENSAR = ("okay so the user is asking about this clause let me think about what the contract says and which fragment "
          "applies here first I should check the parties then the dates wait maybe").split()


# ---------------------------------------------------------------- el log, con el formato de vLLM
def log(texto: str, nivel: str = "INFO", archivo: str = "api_server.py:1", proc: str = "APIServer") -> None:
    print(f"({proc} pid={os.getpid()}) {nivel} {datetime.now():%m-%d %H:%M:%S} [{archivo}] {texto}", flush=True)


# ---------------------------------------------------------------- tokens (aproximados)
PIEZA = re.compile(r"\w{1,6}|[^\w\s]")


def tokenizar(texto: str) -> list[int]:
    """Un tokenizer de juguete: pedazos de hasta 6 letras y cada signo aparte. Da ≈ los mismos tokens que Qwen3 en español."""
    return [int.from_bytes(hashlib.blake2b(p.encode(), digest_size=4).digest(), "big") % VOCAB for p in PIEZA.findall(texto)]


def plantilla(mensajes: list[dict], pensar: bool) -> list[int]:
    """La plantilla ChatML de Qwen3: <|im_start|>rol\\n…<|im_end|>\\n por mensaje y el inicio de la respuesta."""
    ids: list[int] = []
    for m in mensajes:
        contenido = m.get("content") or ""
        if isinstance(contenido, list):
            contenido = " ".join(c.get("text", "") for c in contenido if isinstance(c, dict))
        ids += [151644, *tokenizar(m.get("role", "user")), 198, *tokenizar(contenido), 151645, 198]
    ids += [151644, 77091, 198]
    if not pensar:   # enable_thinking=False: la plantilla abre y cierra un <think> vacío
        ids += [151667, 271, 151668, 271]
    return ids


# ---------------------------------------------------------------- métricas (formato de Prometheus)
class Histograma:
    def __init__(self, cubetas):
        self.cubetas, self.cuentas, self.suma, self.n = cubetas, [0] * len(cubetas), 0.0, 0

    def obs(self, v: float) -> None:
        self.suma += v
        self.n += 1
        for i, c in enumerate(self.cubetas):
            if v <= c:
                self.cuentas[i] += 1

    def texto(self, nombre: str, etiquetas: str) -> list[str]:
        out = [f'{nombre}_bucket{{{etiquetas},le="{c}"}} {float(n)}' for c, n in zip(self.cubetas, self.cuentas)]
        return out + [f'{nombre}_bucket{{{etiquetas},le="+Inf"}} {float(self.n)}', f"{nombre}_count{{{etiquetas}}} {float(self.n)}",
                      f"{nombre}_sum{{{etiquetas}}} {self.suma}"]


# ---------------------------------------------------------------- el motor
class Peticion:
    def __init__(self, prompt: list[int], max_tokens: int, natural: int, ignore_eos: bool, razonar: int = 0):
        self.id = f"chatcmpl-{uuid.uuid4().hex}"
        self.prompt = prompt                 # lo que hay que leer (si hubo preemption, prompt + lo ya escrito)
        self.n_prompt = len(prompt)          # el prompt original, para usage
        self.max_tokens, self.natural, self.ignore_eos = max_tokens, natural + razonar, ignore_eos
        self.razonar = razonar               # con el razonamiento prendido, los primeros tokens son «pensar» (en inglés)
        self.computados = 0                  # tokens de self.prompt ya en el KV cache
        self.escritos: list[str] = []
        self.bloques = 0
        self.llegada = time.monotonic()
        self.primer: float | None = None
        self.ultimo: float | None = None
        self.eventos: deque = deque()
        self.cv = threading.Condition()
        self.cancelada = False
        self.fin: str | None = None
        self.admitida: float | None = None

    def objetivo(self) -> int:
        return self.max_tokens if self.ignore_eos else min(self.max_tokens, self.natural)

    def contexto(self) -> int:
        return self.computados if self.computados < len(self.prompt) else len(self.prompt) + len(self.escritos) - self._recomputados()

    def _recomputados(self) -> int:
        return len(self.prompt) - self.n_prompt   # lo escrito antes de una preemption ya va dentro de self.prompt

    def emitir(self, ev) -> None:
        with self.cv:
            self.eventos.append(ev)
            self.cv.notify()


class Motor(threading.Thread):
    def __init__(self, a, gpu: dict, modelo: dict, efi: dict):
        super().__init__(daemon=True)
        self.a, self.gpu, self.modelo = a, gpu, modelo
        self.efi_m, self.efi_c = efi["memoria"], efi["computo"]
        self.kv_token = 2 * modelo["capas"] * modelo["cabezas_kv"] * modelo["dim_cabeza"] * modelo["bytes_kv"]
        uso = 1.0 if a.gpu_memory_utilization is None else a.gpu_memory_utilization   # extensible: toda la memoria libre
        libre = gpu["vram_gib"] * GIB * uso - modelo["bytes_pesos"] - PROGRAMA_GIB * GIB
        self.kv_bytes = max(0.0, libre)
        self.total_bloques = int(self.kv_bytes // (self.kv_token * BLOQUE))
        self.libres = self.total_bloques
        self.espera: deque[Peticion] = deque()
        self.corriendo: list[Peticion] = []
        self.cache: dict[bytes, float] = {}           # bloques de prompt ya leídos (prefix caching), con su último uso
        self.cv = threading.Condition()
        self.cont = dict(prompt=0, generacion=0, preempciones=0, consultas_cache=0, aciertos_cache=0, pasos=0)
        self.exitos = {"stop": 0, "length": 0, "abort": 0}
        self.h_ttft, self.h_itl, self.h_e2e = Histograma(CUBETAS_TTFT), Histograma(CUBETAS_ITL), Histograma(CUBETAS_E2E)
        self.h_tpot, self.h_cola = Histograma(CUBETAS_ITL), Histograma(CUBETAS_E2E)

    # -- memoria
    def tokens_kv(self) -> int:
        return self.total_bloques * BLOQUE

    def bloques_para(self, tokens: int) -> int:
        return math.ceil(tokens / BLOQUE)

    def liberar(self, p: Peticion) -> None:
        self.libres += p.bloques
        p.bloques = 0

    def hashes(self, ids: list[int]) -> list[bytes]:
        out, h = [], b""
        for i in range(0, len(ids) - BLOQUE + 1, BLOQUE):
            h = hashlib.blake2b(h + str(ids[i:i + BLOQUE]).encode(), digest_size=8).digest()
            out.append(h)
        return out

    # -- lo que llega
    def agregar(self, p: Peticion) -> None:
        with self.cv:
            self.espera.append(p)
            self.cv.notify()

    def cancelar(self, p: Peticion) -> None:
        with self.cv:
            p.cancelada = True

    # -- un paso del scheduler
    def planear(self) -> list[tuple[Peticion, int]]:
        presupuesto = self.a.max_num_batched_tokens
        plan: list[tuple[Peticion, int]] = []
        for p in [x for x in self.corriendo if x.cancelada]:
            self.corriendo.remove(p)
            self.terminar(p, "abort")
        i = 0
        while i < len(self.corriendo) and presupuesto > 0:
            p = self.corriendo[i]
            falta = len(p.prompt) - p.computados
            n = 1 if falta <= 0 else min(falta, presupuesto)
            necesita = self.bloques_para(p.contexto() + n) - p.bloques
            while necesita > self.libres:      # no cabe: preemption de la última que entró
                victima = self.corriendo.pop()
                self.preemptar(victima)
                if victima is p:
                    break
            if p not in self.corriendo:
                continue
            self.libres -= max(0, necesita)
            p.bloques += max(0, necesita)
            plan.append((p, n))
            presupuesto -= n
            i += 1
        while self.espera and presupuesto > 0 and len(self.corriendo) < self.a.max_num_seqs:
            p = self.espera[0]
            if p.cancelada:
                self.espera.popleft()
                self.terminar(p, "abort")
                continue
            if p.computados == 0 and self.a.enable_prefix_caching:
                hs = self.hashes(p.prompt[:-1])         # siempre queda al menos un token por leer
                aciertos = 0
                for h in hs:
                    if h not in self.cache:
                        break
                    aciertos += 1
                self.cont["consultas_cache"] += len(p.prompt)
                self.cont["aciertos_cache"] += aciertos * BLOQUE
                self.cont["cache_prompt"] = self.cont.get("cache_prompt", 0) + aciertos * BLOQUE
                p.computados = aciertos * BLOQUE
            n = min(len(p.prompt) - p.computados, presupuesto)
            necesita = self.bloques_para(p.computados + n)
            if necesita > self.libres:
                p.computados = 0
                break
            self.espera.popleft()
            if p.admitida is None:
                p.admitida = time.monotonic()
                self.cont["prompt"] += p.n_prompt          # como vLLM: todo el prompt, venga o no del prefix cache
                self.h_cola.obs(p.admitida - p.llegada)
            self.libres -= necesita
            p.bloques = necesita
            self.corriendo.append(p)
            plan.append((p, n))
            presupuesto -= n
        return plan

    def preemptar(self, p: Peticion) -> None:
        self.liberar(p)
        p.prompt = p.prompt[:p.n_prompt] + tokenizar(" ".join(p.escritos))[:len(p.escritos)]
        p.prompt += [0] * (p.n_prompt + len(p.escritos) - len(p.prompt))
        p.computados = 0
        self.espera.appendleft(p)
        self.cont["preempciones"] += 1

    def duracion(self, plan: list[tuple[Peticion, int]]) -> float:
        tokens = sum(n for _, n in plan)
        kv_leido = sum(p.contexto() for p, _ in plan) * self.kv_token
        t_mem = (self.modelo["bytes_pesos"] + kv_leido) / (self.efi_m * self.gpu["ancho_banda_gbs"] * 1e9)
        t_cal = 2 * self.modelo["parametros"] * tokens / (self.efi_c * self.gpu["fp16_tflops_denso"] * 1e12)
        return max(t_mem, t_cal) + 0.002

    def aplicar(self, plan: list[tuple[Peticion, int]]) -> None:
        ahora = time.monotonic()
        self.cont["pasos"] += 1
        for p, n in plan:
            if p.cancelada or p not in self.corriendo:
                continue
            if p.computados < len(p.prompt):            # leía el prompt
                p.computados += n
                if p.computados < len(p.prompt):
                    continue
                if self.a.enable_prefix_caching and len(p.prompt) == p.n_prompt:
                    for h in self.hashes(p.prompt):
                        self.cache[h] = ahora
                    if len(self.cache) > 4 * self.total_bloques:
                        for h, _ in sorted(self.cache.items(), key=lambda x: x[1])[: len(self.cache) // 4]:
                            del self.cache[h]
            pensando = len(p.escritos) < p.razonar
            palabra = PENSAR[len(p.escritos) % len(PENSAR)] if pensando else RELLENO[(len(p.escritos) + p.n_prompt) % len(RELLENO)]
            token = (" " if p.escritos and len(p.escritos) != p.razonar else "") + palabra
            p.escritos.append(token)
            self.cont["generacion"] += 1
            if p.primer is None:
                p.primer = ahora
                self.h_ttft.obs(ahora - p.llegada)
            else:
                self.h_itl.obs(ahora - p.ultimo)
            p.ultimo = ahora
            p.emitir(("razon" if pensando else "token", token))
            if len(p.escritos) >= p.objetivo():
                self.corriendo.remove(p)
                self.terminar(p, "length" if len(p.escritos) >= p.max_tokens else "stop")

    def terminar(self, p: Peticion, razon: str) -> None:
        self.liberar(p)
        p.fin = razon
        self.exitos[razon] = self.exitos.get(razon, 0) + 1
        if razon != "abort":
            self.h_e2e.obs(time.monotonic() - p.llegada)
            if len(p.escritos) > 1:
                self.h_tpot.obs((p.ultimo - p.primer) / (len(p.escritos) - 1))
        p.emitir(("fin", razon))

    def run(self) -> None:
        while True:
            with self.cv:
                while not self.corriendo and not self.espera:
                    self.cv.wait()
                plan = self.planear()
                dt = self.duracion(plan) if plan else 0.01
            time.sleep(dt)
            with self.cv:
                self.aplicar(plan)

    def metricas(self, nombre: str) -> str:
        et = f'engine="0",model_name="{nombre}"'
        with self.cv:
            usados = 1 - self.libres / self.total_bloques if self.total_bloques else 0.0
            filas = [
                "# HELP vllm:cache_config_info Information of the LLMEngine CacheConfig", "# TYPE vllm:cache_config_info gauge",
                f'vllm:cache_config_info{{block_size="{BLOQUE}",cache_dtype="auto",enable_prefix_caching="{self.a.enable_prefix_caching}",engine="0",'
                f'gpu_memory_utilization="{self.a.gpu_memory_utilization if self.a.gpu_memory_utilization is not None else 1.0}",num_gpu_blocks="{self.total_bloques}"}} 1.0',
                "# HELP vllm:num_requests_running Number of requests in model execution batches.", "# TYPE vllm:num_requests_running gauge",
                f"vllm:num_requests_running{{{et}}} {float(len(self.corriendo))}",
                "# HELP vllm:num_requests_waiting Number of requests waiting to be processed.", "# TYPE vllm:num_requests_waiting gauge",
                f"vllm:num_requests_waiting{{{et}}} {float(len(self.espera))}",
                "# HELP vllm:kv_cache_usage_perc KV-cache usage. 1 means 100 percent usage.", "# TYPE vllm:kv_cache_usage_perc gauge",
                f"vllm:kv_cache_usage_perc{{{et}}} {usados}",
                "# HELP vllm:num_preemptions_total Cumulative number of preemption from the engine.", "# TYPE vllm:num_preemptions_total counter",
                f"vllm:num_preemptions_total{{{et}}} {float(self.cont['preempciones'])}",
                "# HELP vllm:prompt_tokens_total Number of prefill tokens processed.", "# TYPE vllm:prompt_tokens_total counter",
                f"vllm:prompt_tokens_total{{{et}}} {float(self.cont['prompt'])}",
                "# HELP vllm:generation_tokens_total Number of generation tokens processed.", "# TYPE vllm:generation_tokens_total counter",
                f"vllm:generation_tokens_total{{{et}}} {float(self.cont['generacion'])}",
                "# HELP vllm:prefix_cache_queries_total Prefix cache queries, in terms of number of queried tokens.", "# TYPE vllm:prefix_cache_queries_total counter",
                f"vllm:prefix_cache_queries_total{{{et}}} {float(self.cont['consultas_cache'])}",
                "# HELP vllm:prefix_cache_hits_total Prefix cache hits, in terms of number of cached tokens.", "# TYPE vllm:prefix_cache_hits_total counter",
                f"vllm:prefix_cache_hits_total{{{et}}} {float(self.cont['aciertos_cache'])}",
                "# HELP vllm:prompt_tokens_cached_total Number of cached prompt tokens (local prefix cache hits).", "# TYPE vllm:prompt_tokens_cached_total counter",
                f"vllm:prompt_tokens_cached_total{{{et}}} {float(self.cont.get('cache_prompt', 0))}",
                "# HELP vllm:request_success_total Count of successfully processed requests.", "# TYPE vllm:request_success_total counter",
                *[f'vllm:request_success_total{{{et},finished_reason="{r}"}} {float(n)}' for r, n in self.exitos.items()],
                "# HELP vllm:time_to_first_token_seconds Histogram of time to first token in seconds.", "# TYPE vllm:time_to_first_token_seconds histogram",
                *self.h_ttft.texto("vllm:time_to_first_token_seconds", et),
                "# HELP vllm:inter_token_latency_seconds Histogram of inter-token latency in seconds.", "# TYPE vllm:inter_token_latency_seconds histogram",
                *self.h_itl.texto("vllm:inter_token_latency_seconds", et),
                "# HELP vllm:e2e_request_latency_seconds Histogram of e2e request latency in seconds.", "# TYPE vllm:e2e_request_latency_seconds histogram",
                *self.h_e2e.texto("vllm:e2e_request_latency_seconds", et),
                "# HELP vllm:request_time_per_output_token_seconds Histogram of time_per_output_token_seconds per request.", "# TYPE vllm:request_time_per_output_token_seconds histogram",
                *self.h_tpot.texto("vllm:request_time_per_output_token_seconds", et),
                "# HELP vllm:request_queue_time_seconds Histogram of time spent in WAITING phase for request.", "# TYPE vllm:request_queue_time_seconds histogram",
                *self.h_cola.texto("vllm:request_queue_time_seconds", et),
            ]
        return "\n".join(filas) + "\n"


# ---------------------------------------------------------------- la API
def error(code: int, mensaje: str, tipo: str, param: str | None = None) -> tuple[int, dict]:
    return code, {"error": {"message": mensaje, "type": tipo, "param": param, "code": code}}


class API(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    a = motor = None
    nombres: list[str] = []

    def log_message(self, fmt, *args) -> None:  # una línea por petición, como uvicorn
        if "/metrics" not in self.path and "/health" not in self.path:
            print(f"(APIServer pid={os.getpid()}) INFO:     {self.client_address[0]}:{self.client_address[1]} - \"{self.command} {self.path} HTTP/1.1\" {args[1] if len(args) > 1 else ''}", flush=True)

    def responder(self, code: int, cuerpo, tipo: str = "application/json") -> None:
        datos = cuerpo.encode() if isinstance(cuerpo, str) else json.dumps(cuerpo).encode()
        self.send_response(code)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(datos)))
        self.end_headers()
        self.wfile.write(datos)

    def autorizado(self) -> bool:
        if not self.a.api_key or not self.path.startswith(("/v1", "/v2", "/inference")):
            return True
        if self.headers.get("Authorization", "") in [f"Bearer {k}" for k in self.a.api_key]:
            return True
        self.responder(401, {"error": "Unauthorized"})
        return False

    def do_GET(self) -> None:
        if self.path == "/health":
            return self.responder(200, "", "text/plain")
        if self.path == "/metrics":
            return self.responder(200, self.motor.metricas(self.nombres[0]), "text/plain; version=0.0.4; charset=utf-8")
        if not self.autorizado():
            return
        if self.path == "/v1/models":
            return self.responder(200, {"object": "list", "data": [{"id": n, "object": "model", "created": int(time.time()), "owned_by": "vllm",
                                                                       "root": self.a.model, "parent": None, "max_model_len": self.a.max_model_len} for n in self.nombres]})
        if self.path == "/version":
            return self.responder(200, {"version": VERSION})
        self.responder(404, {"detail": "Not Found"})

    def leer(self) -> dict | None:
        try:
            return json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        except json.JSONDecodeError:
            self.responder(*error(400, "El cuerpo no es JSON válido.", "BadRequestError"))
            return None

    def do_POST(self) -> None:
        if not self.autorizado():
            return
        d = self.leer()
        if d is None:
            return
        if self.path == "/tokenize":
            ids = plantilla(d["messages"], pensar(self.a, d)) if "messages" in d else tokenizar(d.get("prompt", ""))
            return self.responder(200, {"count": len(ids), "max_model_len": self.a.max_model_len, "tokens": ids, "token_strs": None})
        if self.path != "/v1/chat/completions":
            return self.responder(404, {"detail": "Not Found"})
        if d.get("model") not in self.nombres:
            return self.responder(*error(404, f"The model `{d.get('model')}` does not exist.", "NotFoundError", "model"))
        prompt = plantilla(d.get("messages") or [], pensar(self.a, d))
        n = len(prompt)
        if n >= self.a.max_model_len:   # vLLM 0.34 solo rechaza si el prompt solo ya no cabe
            return self.responder(*error(400, f"This model's maximum context length is {self.a.max_model_len} tokens. However, your prompt contains {n} "
                                              "input tokens, which exceeds this limit even without any output tokens. Please reduce the length of the input prompt.",
                                         "BadRequestError", "input_tokens"))
        maxt = min(d.get("max_completion_tokens") or d.get("max_tokens") or self.a.max_model_len, self.a.max_model_len - n)   # y recorta max_tokens
        natural = 60 + int.from_bytes(hashlib.blake2b(str(prompt[-64:]).encode(), digest_size=2).digest(), "big") % 340
        razonar = 250 + natural % 200 if pensar(self.a, d) else 0
        p = Peticion(prompt, maxt, natural, bool(d.get("ignore_eos")), razonar)
        self.motor.agregar(p)
        nombre, creado = d["model"], int(time.time())
        if d.get("stream"):
            return self.stream(p, nombre, creado, bool((d.get("stream_options") or {}).get("include_usage")))
        while True:
            ev = self.siguiente(p)
            if ev[0] == "fin":
                break
        razon, texto = "".join(p.escritos[:p.razonar]), "".join(p.escritos[p.razonar:])
        if p.razonar and not self.a.reasoning_parser:   # sin parser, el razonamiento sale dentro del texto
            texto, razon = f"<think>{razon}</think>\n\n{texto}", ""
        self.responder(200, {"id": p.id, "object": "chat.completion", "created": creado, "model": nombre,
                             "choices": [{"index": 0, "message": {"role": "assistant", "content": texto or None, "reasoning": razon or None, "tool_calls": []},
                                          "finish_reason": p.fin, "stop_reason": None}],
                             "usage": {"prompt_tokens": p.n_prompt, "total_tokens": p.n_prompt + len(p.escritos), "completion_tokens": len(p.escritos)}})

    def siguiente(self, p: Peticion):
        with p.cv:
            while not p.eventos:
                p.cv.wait()
            return p.eventos.popleft()

    def stream(self, p: Peticion, nombre: str, creado: int, uso: bool) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()

        def mandar(obj) -> None:
            datos = ("data: " + (obj if isinstance(obj, str) else json.dumps(obj, ensure_ascii=False)) + "\n\n").encode()
            self.wfile.write(f"{len(datos):x}\r\n".encode() + datos + b"\r\n")
            self.wfile.flush()

        base = {"id": p.id, "object": "chat.completion.chunk", "created": creado, "model": nombre}
        try:
            mandar({**base, "choices": [{"index": 0, "delta": {"role": "assistant", "content": ""}, "logprobs": None, "finish_reason": None}]})
            while True:
                ev = self.siguiente(p)
                if ev[0] in ("token", "razon"):
                    campo = "reasoning" if ev[0] == "razon" and self.a.reasoning_parser else "content"
                    mandar({**base, "choices": [{"index": 0, "delta": {campo: ev[1]}, "logprobs": None, "finish_reason": None}]})
                else:
                    mandar({**base, "choices": [{"index": 0, "delta": {}, "logprobs": None, "finish_reason": ev[1], "stop_reason": None}]})
                    break
            if uso:
                mandar({**base, "choices": [], "usage": {"prompt_tokens": p.n_prompt, "total_tokens": p.n_prompt + len(p.escritos), "completion_tokens": len(p.escritos)}})
            mandar("[DONE]")
            self.wfile.write(b"0\r\n\r\n")
        except (BrokenPipeError, ConnectionResetError):
            self.motor.cancelar(p)


def pensar(a, d: dict) -> bool:
    kw = {**(a.default_chat_template_kwargs or {}), **(d.get("chat_template_kwargs") or {})}
    return bool(kw.get("enable_thinking", True))


# ---------------------------------------------------------------- arranque
def args(argv: list[str]):
    ap = argparse.ArgumentParser(prog="vllm", description="El vLLM del dojo (simulado): imita `vllm serve`.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("serve")
    s.add_argument("model")
    s.add_argument("--host", default=None)
    s.add_argument("--port", type=int, default=8000)
    s.add_argument("--max-model-len", type=int, default=None)
    s.add_argument("--max-num-seqs", type=int, default=None)
    s.add_argument("--max-num-batched-tokens", type=int, default=None)
    s.add_argument("--gpu-memory-utilization", type=float, default=None)   # sin el flag: KV cache extensible, con la memoria libre
    s.add_argument("--served-model-name", nargs="+", default=None)
    s.add_argument("--api-key", nargs="+", default=[os.environ["VLLM_API_KEY"]] if os.environ.get("VLLM_API_KEY") else None)
    s.add_argument("--reasoning-parser", default=None)
    s.add_argument("--default-chat-template-kwargs", type=json.loads, default=None)
    s.add_argument("--enable-prefix-caching", action=argparse.BooleanOptionalAction, default=True)
    s.add_argument("--tensor-parallel-size", type=int, default=1)
    s.add_argument("--generation-config", default=None)
    s.add_argument("--disable-log-requests", action="store_true")
    s.add_argument("--version", action="version", version=VERSION)
    sub.add_parser("--version")
    return ap.parse_args(argv)


def main(argv: list[str]) -> None:
    if argv[:1] in (["--version"], ["-v"]):
        print(VERSION)
        return
    a = args(argv)
    modelos = json.loads((MUNDO / "modelos.json").read_text())
    gpus = json.loads((MUNDO / "gpus.json").read_text())
    clave_gpu = (os.environ.get("DOJO_GPU") or "l40s").lower()
    if a.model not in modelos:
        sys.exit(f"El vLLM del dojo solo conoce {', '.join(k for k in modelos if '/' in k)} (mundo/modelos.json); pediste {a.model}.")
    if clave_gpu not in gpus["gpus"]:
        sys.exit(f"DOJO_GPU={clave_gpu}: el vLLM del dojo imita {', '.join(gpus['gpus'])} (mundo/gpus.json).")
    m, g = modelos[a.model], gpus["gpus"][clave_gpu]
    a.max_model_len = a.max_model_len or m["contexto_max"]
    grande = g["vram_gib"] >= 70
    a.max_num_seqs = a.max_num_seqs or (1024 if grande else 256)
    a.max_num_batched_tokens = a.max_num_batched_tokens or (8192 if grande else 2048)
    nombres = a.served_model_name or [a.model]
    log(f"vLLM del dojo: SIMULADO, sin GPU. Imita `vllm serve` {VERSION} con una {g['nombre']} de {g['vram_gb']} GB (DOJO_GPU={clave_gpu}). "
        "Los tiempos salen de la cuenta de servilleta, no de una medición.", "WARNING", "vllm_dojo.py:1")
    log(f"vLLM API server version {VERSION}", archivo="api_server.py:1885")
    log(f"non-default args: {{'model': '{a.model}', 'max_model_len': {a.max_model_len}"
        + (f", 'max_num_seqs': {a.max_num_seqs}" if "--max-num-seqs" in argv else "")
        + (f", 'gpu_memory_utilization': {a.gpu_memory_utilization}" if a.gpu_memory_utilization is not None else "")
        + (f", 'served_model_name': {nombres}" if a.served_model_name else "")
        + (", 'api_key': ['…']" if a.api_key else "") + "}", archivo="utils.py:328")
    uso = 1.0 if a.gpu_memory_utilization is None else a.gpu_memory_utilization
    if m["bytes_pesos"] / GIB > g["vram_gib"] * uso:
        log(f"CUDA out of memory. Tried to allocate the model weights ({m['bytes_pesos'] / GIB:.2f} GiB) on a GPU with "
            f"{g['vram_gib'] * uso:.2f} GiB allowed.", "ERROR", "core.py:1112", "EngineCore_DP0")
        sys.exit(1)
    log(f"Chunked prefill is enabled with max_num_batched_tokens={a.max_num_batched_tokens}.", archivo="scheduler.py:355")
    log("Loading weights took 41.27 seconds (simulado: no se baja ni se carga nada)", archivo="default_loader.py:544", proc="EngineCore_DP0")
    log(f"Model loading took {m['bytes_pesos'] / GIB:.2f} GiB memory and 44.832105 seconds", archivo="model_runner.py:442", proc="EngineCore_DP0")
    motor = Motor(a, g, m, gpus["eficiencias"])
    kv_gib = motor.kv_bytes / GIB
    log(f"Available KV cache memory: {kv_gib:.2f} GiB" + (" (KV cache extensible: sin --gpu-memory-utilization)" if a.gpu_memory_utilization is None else ""),
        archivo="gpu_worker.py:796", proc="EngineCore_DP0")
    necesita = math.ceil(a.max_model_len / BLOQUE) * BLOQUE * motor.kv_token / GIB
    if motor.tokens_kv() < a.max_model_len:
        estimado = motor.tokens_kv()
        log(f"ValueError: To serve at least one request with the model's max seq len ({a.max_model_len}), ({necesita:.2f} GiB KV cache is needed, "
            f"which is larger than the available KV cache memory ({kv_gib:.2f} GiB). "
            + (f"Based on the available memory, the estimated maximum model length is {estimado}. " if estimado > 0 else "")
            + "Try increasing `gpu_memory_utilization` when initializing the engine. Decreasing `max_model_len` also reduces what is needed. "
            "See https://docs.vllm.ai/en/latest/configuration/conserving_memory/ for more details.", "ERROR", "core.py:1112", "EngineCore_DP0")
        sys.exit(1)
    log(f"GPU KV cache size: {motor.tokens_kv():,} tokens, Maximum concurrency for {a.max_model_len:,} tokens per request: "
        f"{motor.tokens_kv() / a.max_model_len:.2f}x", archivo="kv_cache_utils.py:1169", proc="EngineCore_DP0")
    log(f"El dojo usará max_num_seqs={a.max_num_seqs}, max_num_batched_tokens={a.max_num_batched_tokens}, prefix caching "
        f"{'on' if a.enable_prefix_caching else 'off'}", archivo="vllm_dojo.py:2", proc="EngineCore_DP0")
    motor.start()
    API.a, API.motor, API.nombres = a, motor, nombres
    host = a.host or "0.0.0.0"
    srv = ThreadingHTTPServer((host, a.port), API)
    srv.daemon_threads = True
    if not a.api_key:
        log("No API key: anyone who reaches this port can use the model (sin --api-key ni VLLM_API_KEY).", "WARNING", "vllm_dojo.py:3")
    log(f"Starting vLLM server on http://{host}:{a.port}", archivo="entry.py:139")
    print("INFO:     Application startup complete.", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main(sys.argv[1:])
