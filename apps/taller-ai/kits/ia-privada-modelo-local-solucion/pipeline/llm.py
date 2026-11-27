"""Paso 3 a 6: un cliente chico para cualquier API compatible con OpenAI (aquí, tu llama-server).

Contrato (lo usa también la estación 8 del entrenamiento RAG, la API con citas):
- Cliente(url=None, clave=None, modelo=None, timeout=60): sin argumentos, toma LLM_URL, CLAVE y ALIAS de servidor.env.
  url es la base con /v1 al final (http://127.0.0.1:9931/v1).
- Cliente.modelos() → lista de ids de GET {url}/models.
- Cliente.contar_tokens(texto) → int, con POST /tokenize del servidor (en la raíz, sin /v1).
- Cliente.chat(mensajes, max_tokens=256, temperatura=0.0, semilla=7, formato=None) → Respuesta: POST
  {url}/chat/completions sin stream. formato es un JSON schema (dict) o None.
- Cliente.chat_stream(mensajes, ...) → generador de pedazos de texto (stream=True, eventos SSE «data: …»); al terminar
  deja la Respuesta completa en Cliente.ultima, con ttft_s (segundos hasta el primer pedazo con texto).
- Cliente.chat_json(mensajes, schema, ...) → dict: chat() con formato=schema y la respuesta ya leída como JSON.
- Errores: SinConexion (no hay servidor en esa URL o no contesta a tiempo), NoAutorizado (401), ContextoExcedido
  (el prompt no cabe: lleva n_prompt y n_ctx) y ErrorLLM para lo demás (con el código HTTP y el mensaje).
Solo biblioteca estándar: así se ve lo que viaja por HTTP. El SDK de openai hace lo mismo con base_url=url.
"""
from __future__ import annotations

import json
import socket
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))
from mundo.comun import leer_env  # noqa: E402


class ErrorLLM(Exception):
    def __init__(self, msg: str, codigo: int | None = None):
        super().__init__(msg)
        self.codigo = codigo


class SinConexion(ErrorLLM):
    pass


class NoAutorizado(ErrorLLM):
    pass


class ContextoExcedido(ErrorLLM):
    def __init__(self, msg: str, n_prompt: int, n_ctx: int):
        super().__init__(msg, 400)
        self.n_prompt, self.n_ctx = n_prompt, n_ctx


@dataclass
class Respuesta:
    texto: str
    tokens_prompt: int
    tokens_salida: int
    fin: str                       # "stop" (terminó solo) o "length" (se cortó en max_tokens)
    segundos: float                # de la petición a la última palabra, medido aquí
    ttft_s: float | None = None    # solo en stream: hasta el primer pedazo con texto
    razonamiento: str = ""         # si el modelo «pensó» (reasoning_content), aquí queda
    tiempos: dict = field(default_factory=dict)   # los timings que reporta llama-server


class Cliente:
    def __init__(self, url: str | None = None, clave: str | None = None, modelo: str | None = None, timeout: float = 60):
        e = leer_env()
        self.url = (url or e.get("LLM_URL", "")).rstrip("/")
        self.clave = clave if clave is not None else e.get("CLAVE", "")
        self.modelo = modelo or e.get("ALIAS", "")
        self.timeout = timeout
        self.ultima: Respuesta | None = None

    # ---------------------------------------------------------------- HTTP
    def _pedir(self, metodo: str, url: str, cuerpo: dict | None = None):
        h = {"Content-Type": "application/json"}
        if self.clave:
            h["Authorization"] = f"Bearer {self.clave}"
        datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
        try:
            return urllib.request.urlopen(urllib.request.Request(url, datos, h, method=metodo), timeout=self.timeout)
        except urllib.error.HTTPError as err:
            texto = err.read().decode(errors="replace")
            try:
                e = json.loads(texto).get("error", {})
            except json.JSONDecodeError:
                e = {"message": texto[:200]}
            msg = f"HTTP {err.code} en {url}: {e.get('message', texto[:200])}"
            if err.code == 401:
                raise NoAutorizado(msg, 401) from None
            if e.get("type") == "exceed_context_size_error":
                raise ContextoExcedido(msg, e.get("n_prompt_tokens", 0), e.get("n_ctx", 0)) from None
            raise ErrorLLM(msg, err.code) from None
        except (urllib.error.URLError, ConnectionError, socket.timeout, TimeoutError) as err:
            raise SinConexion(f"sin respuesta de {url}: {getattr(err, 'reason', err)}") from None

    def _json(self, metodo: str, url: str, cuerpo: dict | None = None) -> dict:
        with self._pedir(metodo, url, cuerpo) as r:
            return json.load(r)

    def _cuerpo(self, mensajes, max_tokens, temperatura, semilla, formato, stream=False) -> dict:
        c = {"model": self.modelo, "messages": mensajes, "max_tokens": max_tokens, "temperature": temperatura, "seed": semilla}
        if formato is not None:
            c["response_format"] = {"type": "json_schema", "json_schema": {"name": "respuesta", "schema": formato}}
        if stream:
            c["stream"], c["stream_options"] = True, {"include_usage": True}
        return c

    # ---------------------------------------------------------------- API
    def modelos(self) -> list[str]:
        return [m["id"] for m in self._json("GET", f"{self.url}/models")["data"]]

    def contar_tokens(self, texto: str) -> int:
        raiz = self.url.removesuffix("/v1")
        return len(self._json("POST", f"{raiz}/tokenize", {"content": texto})["tokens"])

    def chat(self, mensajes: list[dict], max_tokens: int = 256, temperatura: float = 0.0, semilla: int = 7, formato: dict | None = None) -> Respuesta:
        t0 = time.perf_counter()
        d = self._json("POST", f"{self.url}/chat/completions", self._cuerpo(mensajes, max_tokens, temperatura, semilla, formato))
        c, u = d["choices"][0], d.get("usage", {})
        self.ultima = Respuesta(c["message"].get("content") or "", u.get("prompt_tokens", 0), u.get("completion_tokens", 0), c.get("finish_reason", ""),
                                time.perf_counter() - t0, None, c["message"].get("reasoning_content") or "", d.get("timings", {}))
        return self.ultima

    def chat_stream(self, mensajes: list[dict], max_tokens: int = 256, temperatura: float = 0.0, semilla: int = 7):
        t0, ttft, partes, razon, fin, u, tiempos = time.perf_counter(), None, [], [], "", {}, {}
        with self._pedir("POST", f"{self.url}/chat/completions", self._cuerpo(mensajes, max_tokens, temperatura, semilla, None, stream=True)) as r:
            for linea in r:
                linea = linea.decode().strip()
                if not linea.startswith("data: ") or linea == "data: [DONE]":
                    continue
                d = json.loads(linea[6:])
                u, tiempos = d.get("usage") or u, d.get("timings") or tiempos
                for c in d.get("choices", []):
                    fin = c.get("finish_reason") or fin
                    razon.append(c["delta"].get("reasoning_content") or "")
                    pedazo = c["delta"].get("content") or ""
                    if pedazo:
                        if ttft is None:
                            ttft = time.perf_counter() - t0
                        partes.append(pedazo)
                        yield pedazo
        self.ultima = Respuesta("".join(partes), u.get("prompt_tokens", 0), u.get("completion_tokens", 0), fin,
                                time.perf_counter() - t0, ttft, "".join(razon), tiempos)

    def chat_json(self, mensajes: list[dict], schema: dict, max_tokens: int = 256, temperatura: float = 0.0, semilla: int = 7) -> dict:
        r = self.chat(mensajes, max_tokens, temperatura, semilla, formato=schema)
        try:
            return json.loads(r.texto)
        except json.JSONDecodeError as e:
            raise ErrorLLM(f"la respuesta no es JSON válido ({e}): {r.texto[:120]!r}") from None
