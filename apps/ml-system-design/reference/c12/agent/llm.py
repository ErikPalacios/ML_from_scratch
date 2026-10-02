"""El modelo detrás de una interfaz: el cliente real del llm-gateway de #c10 (Chat Completions compatible con
OpenAI, con tools y streaming) y dos falsos: uno con guion (tests y evaluación) y uno por reglas (la demo).

Lo que el orquestador necesita del modelo es poco: dados los mensajes y las herramientas permitidas, un stream
de texto (para mostrar mientras se genera) y al final la respuesta completa: texto, tool calls y usage.

Un request al gateway (tenant `support-assistant`, alias `chat-default`):
  POST {LLM_GATEWAY_URL}/v1/chat/completions
  {"model": "chat-default", "messages": [...], "tools": [...], "tool_choice": "auto",
   "parallel_tool_calls": false, "max_tokens": 400, "temperature": 0, "stream": true,
   "stream_options": {"include_usage": true}, "user": "<id seudónimo del cliente>"}
Por qué cada campo:
  * tool_choice "auto": el modelo decide entre contestar o llamar una herramienta (con "required" estaría
    obligado a llamar una siempre y nunca podría responder).
  * parallel_tool_calls false: una herramienta por paso. El orquestador decide la política de cada una antes de
    la siguiente, y el parser de Llama 3 en vLLM no soporta llamadas en paralelo (docs de tool calling de
    vLLM v0.30.0); con false, vLLM v0.30.0 se queda solo con la primera si el modelo emite varias. El
    orquestador igual acepta una lista y las procesa en orden, por si otro modelo las manda.
  * temperature 0: un agente que mueve dinero se quiere lo más repetible posible (no es determinista del todo:
    #m14.evaluacion).
  * stream + include_usage: texto mientras se genera, y los tokens reales al final para el presupuesto de 40k.
  * user: un id SEUDÓNIMO (hash con sal) del cliente. El gateway lo usa para fijar canarios por % de usuarios;
    nunca el id real ni el correo (PII mínima: #m15.pii-privacidad).
Del lado de vLLM (no está en este archivo): el servidor necesita `--enable-auto-tool-choice` y un
`--tool-call-parser` de la familia del modelo (para Llama 3.x, `llama3_json` con su chat template de
tool calling); sin esos flags, un request con tool_choice "auto" se rechaza.
"""

from __future__ import annotations  # anotaciones como texto

import asyncio  # demoras simuladas
import json  # SSE y argumentos
import math  # estimación de tokens
import re  # reglas de la demo
from collections.abc import AsyncIterator, Callable  # tipos
from dataclasses import dataclass, field  # mensajes de respuesta
from typing import Any, Protocol  # interfaz

import httpx2  # cliente HTTP async (API de httpx); MockTransport en tests


@dataclass
class ToolCall:
    id: str  # "call_…": el mensaje role=tool de la respuesta tiene que llevar este mismo id
    name: str
    arguments: str  # JSON como TEXTO, tal cual lo devuelve la API (puede venir mal formado: se valida después)


@dataclass
class Usage:
    prompt_tokens: int = 0
    completion_tokens: int = 0


@dataclass
class LLMResponse:
    content: str
    tool_calls: list[ToolCall] = field(default_factory=list)
    usage: Usage = field(default_factory=Usage)
    finish_reason: str = "stop"


@dataclass
class LLMRequest:
    messages: list[dict[str, Any]]
    tools: list[dict[str, Any]]
    max_tokens: int = 400  # tope por llamada (el gateway de c10 permite hasta 1,024 a este tenant)
    user: str | None = None


class LLMUnavailable(Exception):
    """El gateway no pudo atender (429 cuota, 503 plataforma llena, 5xx, timeout o stream cortado)."""

    def __init__(self, status: int | str, retry_after: float | None = None):
        super().__init__(f"llm unavailable: {status}")
        self.status = status
        self.retry_after = retry_after


class ChatModel(Protocol):
    def stream(self, req: LLMRequest) -> AsyncIterator[str | LLMResponse]:
        """Produce deltas de texto (str) y, como ÚLTIMO elemento, la respuesta completa (LLMResponse)."""
        ...


def estimate_tokens(req: LLMRequest) -> int:
    """Estimación pesimista (caracteres ÷ 3, como el gateway de #c10) de TODO lo que entra: mensajes, argumentos
    de tool calls y schemas de herramientas. Solo para decidir ANTES de llamar; el presupuesto usa `usage`."""
    chars = len(json.dumps(req.tools, ensure_ascii=False))
    for m in req.messages:
        chars += len(m.get("content") or "")
        for tc in m.get("tool_calls") or []:
            chars += len(tc["function"]["arguments"]) + len(tc["function"]["name"])
    return math.ceil(chars / 3) + 4 * len(req.messages)


# ------------------------------------------------------------------ el real: llm-gateway de c10
class GatewayChatModel:
    """Cliente del llm-gateway (#c10.arquitectura). `transport` permite tests sin red (httpx2.MockTransport)."""

    def __init__(self, base_url: str, api_key: str, *, model: str = "chat-default",
                 transport: httpx2.AsyncBaseTransport | None = None, connect_timeout_s: float = 2.0,
                 read_timeout_s: float = 15.0):
        self.model = model
        self.client = httpx2.AsyncClient(
            base_url=base_url, transport=transport,
            headers={"Authorization": f"Bearer {api_key}"},
            # read = tiempo máximo ENTRE dos bytes del stream; el tope del turno (20 s) lo pone el orquestador
            timeout=httpx2.Timeout(connect=connect_timeout_s, read=read_timeout_s, write=5.0, pool=2.0))

    def body(self, req: LLMRequest) -> dict[str, Any]:
        b: dict[str, Any] = {"model": self.model, "messages": req.messages, "max_tokens": req.max_tokens,
                             "temperature": 0, "stream": True, "stream_options": {"include_usage": True}}
        if req.tools:  # sin herramientas (p. ej. solo redactar), no se mandan tools ni tool_choice
            b.update(tools=req.tools, tool_choice="auto", parallel_tool_calls=False)
        if req.user:
            b["user"] = req.user
        return b

    async def stream(self, req: LLMRequest) -> AsyncIterator[str | LLMResponse]:
        content: list[str] = []
        calls: dict[int, dict[str, str]] = {}  # tool calls armadas por `index` (llegan en pedazos)
        usage = Usage()
        finish = "stop"
        try:
            async with self.client.stream("POST", "/v1/chat/completions", json=self.body(req)) as resp:
                if resp.status_code != 200:
                    ra = resp.headers.get("retry-after")
                    raise LLMUnavailable(resp.status_code, float(ra) if ra else None)
                async for line in resp.aiter_lines():
                    if not line.startswith("data:"):
                        continue  # comentarios ": ping" y líneas vacías
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    obj = json.loads(data)
                    if "error" in obj:  # el gateway de c10 manda un evento de error si el upstream cae a mitad
                        raise LLMUnavailable("stream_error")
                    if obj.get("usage"):
                        usage = Usage(obj["usage"].get("prompt_tokens", 0), obj["usage"].get("completion_tokens", 0))
                    for ch in obj.get("choices") or []:
                        delta = ch.get("delta") or {}
                        if delta.get("content"):
                            content.append(delta["content"])
                            yield delta["content"]
                        for tc in delta.get("tool_calls") or []:
                            slot = calls.setdefault(tc.get("index", 0), {"id": "", "name": "", "arguments": ""})
                            slot["id"] = tc.get("id") or slot["id"]
                            fn = tc.get("function") or {}
                            slot["name"] += fn.get("name") or ""
                            slot["arguments"] += fn.get("arguments") or ""
                        if ch.get("finish_reason"):
                            finish = ch["finish_reason"]
        except httpx2.TimeoutException as e:
            raise LLMUnavailable("timeout") from e
        except httpx2.TransportError as e:
            raise LLMUnavailable("connect") from e
        if finish == "abort":  # un pod de vLLM en drain aborta sin texto (ver #c10.archivos)
            raise LLMUnavailable("abort")
        yield LLMResponse("".join(content), [ToolCall(c["id"], c["name"], c["arguments"])
                                             for _, c in sorted(calls.items())], usage, finish)

    async def aclose(self) -> None:
        await self.client.aclose()


# ------------------------------------------------------------------ el falso con guion (tests y evaluación)
class ScriptExhausted(AssertionError):
    """El orquestador pidió más llamadas al modelo de las que el guion tenía: el test debe fallar fuerte."""


class ScriptedChatModel:
    """Devuelve respuestas fijas, en orden. Cada paso del guion es un dict:
        {"tool_calls": [{"name": "get_order", "arguments": {"order_id": "A-1029"}}]}
        {"content": "Tu pedido llegó el 12 de septiembre."}
        opcional: "delay_s" (tiempo que "tarda" el modelo; avanza el reloj falso si se pasa `advance`),
                  "usage": {"prompt_tokens": …, "completion_tokens": …} (si no, se estima),
                  "raw_arguments": "…" (argumentos como texto crudo, para probar JSON mal formado).
    Guarda cada request en `self.requests` para que los tests verifiquen qué vio el modelo.
    No es un modelo: sirve para probar que el ORQUESTADOR y la POLÍTICA aguantan lo que un modelo real puede
    hacer, incluido obedecer una inyección.
    """

    def __init__(self, script: list[dict[str, Any]], *, advance: Callable[[float], None] | None = None):
        self.script = list(script)
        self.requests: list[LLMRequest] = []
        self.advance = advance
        self._n = 0

    async def stream(self, req: LLMRequest) -> AsyncIterator[str | LLMResponse]:
        self.requests.append(req)
        if not self.script:
            raise ScriptExhausted(f"el guion no tiene la llamada #{len(self.requests)}")
        step = self.script.pop(0)
        if step.get("delay_s"):
            if self.advance:
                self.advance(step["delay_s"])
            else:
                await asyncio.sleep(step["delay_s"])
        if step.get("fail"):
            raise LLMUnavailable(step["fail"])
        text = step.get("content") or ""
        for word in re.findall(r"\S+\s*", text):  # un delta por palabra, como un stream de verdad
            yield word
        calls = []
        for c in step.get("tool_calls") or []:
            self._n += 1
            args = c.get("raw_arguments") or json.dumps(c.get("arguments", {}), ensure_ascii=False)
            calls.append(ToolCall(c.get("id", f"call_{self._n}"), c["name"], args))
        u = step.get("usage")
        usage = Usage(u["prompt_tokens"], u["completion_tokens"]) if u else Usage(
            estimate_tokens(req), math.ceil(len(text + "".join(c.arguments for c in calls)) / 3) + 5)
        yield LLMResponse(text, calls, usage, "tool_calls" if calls else "stop")


# ------------------------------------------------------------------ el falso por reglas (solo para la demo)
class DemoChatModel:
    """Reglas fijas para que la demo del servicio se pueda probar con curl. NO es un modelo ni lo imita bien:
    reconoce un id de pedido y palabras como "roto" o "reembolso", y nada más."""

    _ORDER = re.compile(r"\bA-[0-9]{4,10}\b")

    async def stream(self, req: LLMRequest) -> AsyncIterator[str | LLMResponse]:
        msgs = req.messages
        last = msgs[-1]
        user_text = next((m["content"] for m in reversed(msgs) if m["role"] == "user"), "")
        resp = self._decide(last, user_text, msgs)
        for word in re.findall(r"\S+\s*", resp.content):
            yield word
        resp.usage = Usage(estimate_tokens(req), 40)
        yield resp

    def _decide(self, last: dict[str, Any], user_text: str, msgs: list[dict[str, Any]]) -> LLMResponse:
        def call(name: str, **args: Any) -> LLMResponse:
            return LLMResponse("", [ToolCall(f"call_demo_{len(msgs)}", name, json.dumps(args))])

        if last["role"] == "tool":
            prev = next(m for m in reversed(msgs) if m["role"] == "assistant" and m.get("tool_calls"))
            name = prev["tool_calls"][-1]["function"]["name"]
            body = last["content"]
            if name == "get_order" and re.search(r"roto|dañad|reembols", user_text, re.I) and '"delivered"' in body:
                order = json.loads(prev["tool_calls"][-1]["function"]["arguments"])["order_id"]
                price = re.search(r'"price":\s*"([0-9.]+)"', body)
                currency = re.search(r'"currency":\s*"([A-Z]{3})"', body)
                if price and currency:
                    return call("issue_refund", order_id=order, amount=float(price.group(1)),
                                currency=currency.group(1), reason="damaged")
            if name == "get_order":
                status = re.search(r'"status":\s*"([a-z_]+)"', body)
                return LLMResponse(f"Revisé tu pedido: su estado es {status.group(1) if status else 'desconocido'}.")
            if name == "issue_refund":
                if "pending_human_approval" in body:
                    return LLMResponse("Tu reembolso quedó en revisión con una persona del equipo. "
                                       "Te avisamos en cuanto se apruebe.")
                if '"issued"' in body:
                    return LLMResponse("Listo: emitimos tu reembolso. Lo verás en 5 a 10 días hábiles.")
                return LLMResponse("No pude emitir ese reembolso. ¿Quieres que te comunique con una persona?")
            if name == "search_help_center":
                snippet = re.search(r'"snippet":\s*"([^"]+)"', body)
                return LLMResponse(snippet.group(1) if snippet else "No encontré un artículo sobre eso.")
            return LLMResponse("Listo.")
        m = self._ORDER.search(user_text)
        if m:
            return call("get_order", order_id=m.group(0))
        return call("search_help_center", query=user_text[:200] or "ayuda", language="es")
