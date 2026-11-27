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

from mundo.comun import leer_env


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
    tiempos: dict = field(default_factory=dict)


class Cliente:
    def __init__(self, url: str | None = None, clave: str | None = None, modelo: str | None = None, timeout: float = 60):
        e = leer_env()
        self.url = (url or e.get("LLM_URL", "")).rstrip("/")
        self.clave = clave if clave is not None else e.get("CLAVE", "")
        self.modelo = modelo or e.get("ALIAS", "")
        self.timeout = timeout
        self.ultima: Respuesta | None = None

    def modelos(self) -> list[str]:
        raise NotImplementedError("paso 3: Cliente.modelos")

    def contar_tokens(self, texto: str) -> int:
        raise NotImplementedError("paso 3: Cliente.contar_tokens")

    def chat(self, mensajes: list[dict], max_tokens: int = 256, temperatura: float = 0.0, semilla: int = 7, formato: dict | None = None) -> Respuesta:
        raise NotImplementedError("paso 3: Cliente.chat")

    def chat_stream(self, mensajes: list[dict], max_tokens: int = 256, temperatura: float = 0.0, semilla: int = 7):
        raise NotImplementedError("paso 4: Cliente.chat_stream")

    def chat_json(self, mensajes: list[dict], schema: dict, max_tokens: int = 256, temperatura: float = 0.0, semilla: int = 7) -> dict:
        raise NotImplementedError("paso 6: Cliente.chat_json")
