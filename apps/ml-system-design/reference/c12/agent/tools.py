"""Registro de las 8 herramientas del agente de soporte (caso c12) y el executor que las corre con timeout,
reintentos según su clase de efecto e idempotency keys.

Cada herramienta tiene:
  * un modelo pydantic de ARGUMENTOS → su JSON Schema va al LLM en el formato `tools` de la API compatible con
    OpenAI (la que expone el llm-gateway de #c10). El mismo modelo VALIDA lo que el modelo propone: el schema
    no es documentación, es el contrato. Ninguna herramienta tiene `customer_id`: el cliente sale de la sesión.
  * una clase de efecto (SPEC §8m):
      READ   get_order, get_shipment_tracking, search_help_center → 1 reintento con backoff si falla
      WRITE  update_shipping_address, create_return_label, escalate_to_human → idempotency key; NUNCA reintento
             a ciegas: después de un timeout se pregunta el estado por la key
      MONEY  issue_refund, cancel_order (dinero o irreversible) → lo de WRITE + confirmación del cliente y
             política (agent/policy.py)
  * timeout de 3 s (SPEC) y un texto de estado para la UI ("Consultando tu pedido…").

Formato de una herramienta para el LLM (Chat Completions, compatible con OpenAI):
  {"type": "function", "function": {"name": "get_order", "description": "...", "parameters": {JSON Schema},
   "strict": true}}
`strict: true` + schema "estilo strict" (additionalProperties false y TODOS los campos en required; lo opcional
se expresa con null): en vLLM v0.30.0, con tool_choice "auto", eso activa el decoding restringido de los
argumentos si el parser de la familia del modelo lo soporta (el de Llama 3, `llama3_json`, lo declara). Sin
`strict`, los argumentos se extraen del texto y a veces vienen mal formados: por eso se validan SIEMPRE aquí.

La idempotency key = hash(conversation_id, herramienta, argumentos normalizados): determinística a propósito.
Una key aleatoria por intento (uuid4) no sirve para reanudar después de una caída: el proceso nuevo no sabe
qué uuid había usado el anterior. Con el hash, la misma acción de la misma conversación produce la misma key.
"""

from __future__ import annotations  # anotaciones como texto

import asyncio  # timeouts por herramienta
import hashlib  # idempotency keys
import json  # forma canónica de los argumentos
import random  # jitter del backoff
import re  # normalización de espacios
import time  # latencia medida
import unicodedata  # normalización Unicode (NFKC) antes de hashear
from collections.abc import Awaitable, Callable  # tipos del dispatch
from dataclasses import dataclass  # ToolSpec y ToolOutcome
from decimal import Decimal  # montos
from enum import StrEnum  # clase de efecto
from typing import Annotated, Any, Literal  # tipos de los argumentos

from pydantic import BaseModel, ConfigDict, Field, field_validator  # schemas y validación

from agent.backend import (  # la interfaz de los sistemas internos y sus errores
    BusinessRuleError,
    CommerceBackend,
    IdempotencyConflict,
    NotFound,
    OperationInProgress,
    TransientError,
)
from agent.policy import AuthContext  # identidad de la sesión


class SideEffect(StrEnum):
    READ = "read"  # sin efectos: reintentar es gratis
    WRITE = "write"  # con efectos reversibles: idempotency key y consulta de estado
    MONEY = "money"  # dinero o irreversible: lo anterior + confirmación + política


# ------------------------------------------------------------------ argumentos (lo que el modelo puede pasar)
class _Args(BaseModel):
    """Base: rechaza campos de más (un `customer_id` "agregado" por el modelo no pasa) y recorta espacios."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


# Id de pedido con formato estricto: el modelo no puede "inventar" un id con texto arbitrario adentro
OrderId = Annotated[str, Field(pattern=r"^A-[0-9]{4,10}$", description="Order id, e.g. A-1029")]


class GetOrderArgs(_Args):
    order_id: OrderId


class GetShipmentTrackingArgs(_Args):
    order_id: OrderId


class SearchHelpCenterArgs(_Args):
    query: str = Field(min_length=3, max_length=200, description="Short search query in the customer's language")
    language: Literal["es", "pt", "en"]  # el centro de ayuda tiene una versión por idioma


class Address(_Args):
    street: str = Field(min_length=3, max_length=120, description="Street and number")
    interior: str | None = Field(max_length=20, description="Apartment or interior number, or null")
    city: str = Field(min_length=2, max_length=60)
    state: str = Field(min_length=2, max_length=60)
    postal_code: str = Field(pattern=r"^[0-9]{5}$", description="5-digit Mexican postal code")
    country: Literal["MX"]  # el ejemplo es México; otros países llevan su propio modelo de dirección


class UpdateShippingAddressArgs(_Args):
    order_id: OrderId
    address: Address


class CancelOrderArgs(_Args):
    order_id: OrderId
    reason: Literal["changed_mind", "ordered_by_mistake", "delivery_too_slow", "other"]


class CreateReturnLabelArgs(_Args):
    order_id: OrderId
    item_ids: list[Annotated[str, Field(pattern=r"^I-[0-9]{1,6}$")]] = Field(min_length=1, max_length=20)
    reason: Literal["damaged", "wrong_item", "not_as_described"]


class IssueRefundArgs(_Args):
    order_id: OrderId
    # float en el schema (es lo que un LLM escribe bien: 450.0), Decimal en el código (ver `amount_decimal`)
    amount: float = Field(gt=0, le=1_000_000, description="Amount in the order currency, max 2 decimals")
    currency: Literal["MXN", "BRL", "COP", "CLP", "USD"]
    reason: Literal["damaged", "wrong_item", "not_as_described", "not_received"]

    @field_validator("amount")
    @classmethod
    def _two_decimals(cls, v: float) -> float:
        # 450.005 no es un monto: se rechaza en lugar de redondear en silencio a favor de alguien
        if Decimal(str(v)).as_tuple().exponent < -2:
            raise ValueError("amount must have at most 2 decimals")
        return v

    @property
    def amount_decimal(self) -> Decimal:
        return Decimal(str(self.amount)).quantize(Decimal("0.01"))


class EscalateToHumanArgs(_Args):
    reason: Literal["customer_request", "policy_exception", "cannot_resolve", "sensitive_topic", "other"]
    summary: str = Field(min_length=10, max_length=600, description="What the customer needs and what was done")


# ------------------------------------------------------------------ registro
@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str  # en inglés: el system prompt también; suele costar menos tokens (mídelo con tu tokenizer)
    args_model: type[_Args]
    side_effect: SideEffect
    status_text: str  # lo que ve el cliente mientras corre (la "primera respuesta visible" de #c12.serving)
    timeout_s: float = 3.0  # SPEC: 3 s por herramienta
    # "conversation": la acción se aplica UNA vez por conversación (dinero, cancelación, ticket).
    # "turn": se puede repetir legítimamente en otro turno con los mismos datos (dirección A → B → A).
    key_scope: Literal["conversation", "turn"] | None = None
    # Qué argumentos entran a la key. None = todos. () = ninguno: UNA vez por conversación sin importar el texto
    # (escalate_to_human: dos resúmenes distintos del modelo no deben abrir dos tickets).
    key_fields: tuple[str, ...] | None = None

    @property
    def read_retries(self) -> int:
        return 1 if self.side_effect is SideEffect.READ else 0  # SPEC: lecturas, 1 reintento


REGISTRY: dict[str, ToolSpec] = {s.name: s for s in [
    ToolSpec("get_order", "Get the customer's order: status, items, totals, delivery date. Only the "
             "authenticated customer's orders are visible.", GetOrderArgs, SideEffect.READ,
             "Consultando tu pedido…"),
    ToolSpec("get_shipment_tracking", "Get carrier tracking for one of the customer's orders.",
             GetShipmentTrackingArgs, SideEffect.READ, "Consultando el envío…"),
    ToolSpec("search_help_center", "Search the public help center. Use it for policies and how-to questions.",
             SearchHelpCenterArgs, SideEffect.READ, "Buscando en el centro de ayuda…"),
    ToolSpec("update_shipping_address", "Change the delivery address. Only possible before the order ships.",
             UpdateShippingAddressArgs, SideEffect.WRITE, "Actualizando la dirección…", key_scope="turn"),
    ToolSpec("cancel_order", "Cancel an order that has not shipped yet. Irreversible; the customer must confirm.",
             CancelOrderArgs, SideEffect.MONEY, "Preparando la cancelación…", key_scope="conversation"),
    ToolSpec("create_return_label", "Create a return shipping label for delivered items.",
             CreateReturnLabelArgs, SideEffect.WRITE, "Generando la etiqueta de devolución…",
             key_scope="conversation"),
    ToolSpec("issue_refund", "Refund part or all of an order. The customer must confirm; large amounts need "
             "human approval.", IssueRefundArgs, SideEffect.MONEY, "Revisando el reembolso…",
             key_scope="conversation"),
    ToolSpec("escalate_to_human", "Hand the conversation to a human agent with a short summary.",
             EscalateToHumanArgs, SideEffect.WRITE, "Pasando tu caso a una persona…", key_scope="conversation",
             key_fields=()),
]}

# Lista permitida por tipo de conversación (OWASP LLM06): una pregunta general no tiene herramientas de escritura.
TOOLSETS: dict[str, frozenset[str]] = {
    "order_support": frozenset(REGISTRY),
    "general_question": frozenset({"search_help_center", "escalate_to_human"}),
}


def _strict_schema(node: Any, defs: dict[str, Any]) -> Any:
    """JSON Schema de pydantic → estilo strict: sin $ref (inlined), sin "title", todo en required."""
    if isinstance(node, dict):
        if "$ref" in node:  # {"$ref": "#/$defs/Address"} → el schema de Address, inline
            return _strict_schema(defs[node["$ref"].split("/")[-1]], defs)
        out = {k: _strict_schema(v, defs) for k, v in node.items() if k not in {"title", "$defs"}}
        if out.get("type") == "object" and "properties" in out:
            out["required"] = list(out["properties"])  # strict: todos requeridos (lo opcional admite null)
            out["additionalProperties"] = False
        return out
    if isinstance(node, list):
        return [_strict_schema(v, defs) for v in node]
    return node


def openai_tool(spec: ToolSpec) -> dict[str, Any]:
    """Una herramienta en el formato `tools` de Chat Completions (OpenAI y vLLM)."""
    raw = spec.args_model.model_json_schema()
    return {"type": "function", "function": {
        "name": spec.name, "description": spec.description,
        "parameters": _strict_schema(raw, raw.get("$defs", {})), "strict": True}}


def openai_tools(names: frozenset[str] | set[str]) -> list[dict[str, Any]]:
    """Las herramientas permitidas, en orden FIJO: el prefijo del prompt tiene que ser idéntico entre requests
    para que el prefix caching de vLLM acierte (#m14.batching-caching). Un set iterado en otro orden lo rompe."""
    return [openai_tool(REGISTRY[n]) for n in sorted(names)]


# ------------------------------------------------------------------ idempotency keys
def _normalize(v: Any) -> Any:
    """Forma canónica: NFKC, espacios colapsados, minúsculas en texto; listas de texto ordenadas; montos a 2 dec."""
    if isinstance(v, str):
        return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", v)).strip().casefold()
    if isinstance(v, float):
        return f"{Decimal(str(v)):.2f}"  # 450 y 450.0 son el mismo monto
    if isinstance(v, dict):
        return {k: _normalize(x) for k, x in v.items()}
    if isinstance(v, list):
        items = [_normalize(x) for x in v]
        return sorted(items) if all(isinstance(x, str) for x in items) else items
    return v


def canonical_args(args: BaseModel, fields: tuple[str, ...] | None = None) -> str:
    data = args.model_dump(mode="python")
    if fields is not None:
        data = {k: v for k, v in data.items() if k in fields}
    return json.dumps(_normalize(data), sort_keys=True, separators=(",", ":"))


def idempotency_key(conversation_id: str, tool: str, args: BaseModel, *, turn_id: str | None = None) -> str:
    """hash(conversation_id, acción, argumentos normalizados) [+ turno si la acción es repetible por turno].

    Sin datos personales en claro (la key viaja a otros servicios y a logs): solo un sha256. 52 caracteres,
    debajo de los 255 que acepta, por ejemplo, la API de Stripe.
    """
    spec = REGISTRY[tool]
    scope = turn_id if spec.key_scope == "turn" else ""
    raw = f"{conversation_id}|{tool}|{scope}|{canonical_args(args, spec.key_fields)}"
    return "c12_" + hashlib.sha256(raw.encode()).hexdigest()[:48]


def action_id(conversation_id: str, tool: str, args: BaseModel, *, turn_id: str | None = None) -> str:
    """Id corto de la acción para la UI ("confirmar act_…") y la cola de aprobación: deriva de la key."""
    return "act_" + idempotency_key(conversation_id, tool, args, turn_id=turn_id)[4:20]


# ------------------------------------------------------------------ ejecución
@dataclass
class ToolOutcome:
    """Resultado de correr una herramienta, tal como lo registra el step log y lo cuentan las métricas."""

    tool: str
    status: Literal["ok", "not_found", "rejected", "error", "timeout", "unknown", "conflict"]
    result: dict[str, Any] | list[Any] | None = None
    error: str | None = None
    attempts: int = 1
    idempotency_key: str | None = None
    recovered: bool = False  # True si el resultado salió de la consulta de estado tras un timeout
    latency_s: float = 0.0


class ToolExecutor:
    """Corre UNA herramienta con su timeout y su regla de reintento. No decide política (eso es policy.py).

    Lecturas: timeout o falla pasajera → backoff → 1 reintento.
    Escrituras y dinero, después de un timeout o un 503 (no sabes si se aplicó):
      1. get_operation(key) → "succeeded": devuelves ESE resultado (el efecto pasó; no se repite);
      2. "not_found": el request nunca llegó → reenvío UNA vez con la MISMA key (si el original llega tarde, el
         backend lo deduplica: misma key, mismos parámetros);
      3. "in_progress" o la consulta también falla → "unknown": el orquestador NO sigue; pasa a una persona
         con la operación marcada para conciliar. Nunca un reintento a ciegas con otra key.
    """

    def __init__(self, backend: CommerceBackend, *, backoff_s: float = 0.2, timeout_override_s: float | None = None,
                 rng: random.Random | None = None):
        self.backend = backend
        self.backoff_s = backoff_s
        self.timeout_override_s = timeout_override_s  # tests: 0.05 s en lugar de 3 s
        self.rng = rng or random.Random(0)

    def _timeout(self, spec: ToolSpec) -> float:
        return self.timeout_override_s if self.timeout_override_s is not None else spec.timeout_s

    def _call(self, spec: ToolSpec, args: _Args, auth: AuthContext, key: str | None, conversation_id: str,
              confirmation_id: str | None, approval_id: str | None) -> Callable[[], Awaitable[Any]]:
        """Traduce (herramienta, argumentos validados) a la llamada del backend. El AuthContext lo pone el
        orquestador desde la sesión: el modelo no tiene forma de cambiarlo."""
        b, a = self.backend, args
        match spec.name:
            case "get_order":
                return lambda: b.get_order(auth, a.order_id)
            case "get_shipment_tracking":
                return lambda: b.get_shipment_tracking(auth, a.order_id)
            case "search_help_center":
                return lambda: b.search_help_center(a.query, a.language)
            case "update_shipping_address":
                return lambda: b.update_shipping_address(auth, a.order_id, a.address.model_dump(), key=key)
            case "cancel_order":
                return lambda: b.cancel_order(auth, a.order_id, a.reason, key=key, confirmation_id=confirmation_id)
            case "create_return_label":
                return lambda: b.create_return_label(auth, a.order_id, list(a.item_ids), a.reason, key=key)
            case "issue_refund":
                return lambda: b.issue_refund(auth, a.order_id, a.amount_decimal, a.currency, a.reason, key=key,
                                              confirmation_id=confirmation_id, approval_id=approval_id)
            case "escalate_to_human":
                return lambda: b.create_ticket(auth, conversation_id, a.reason, a.summary, key=key)
        raise KeyError(spec.name)

    async def execute(self, tool: str, args: _Args, *, auth: AuthContext, conversation_id: str, turn_id: str,
                      confirmation_id: str | None = None, approval_id: str | None = None) -> ToolOutcome:
        spec = REGISTRY[tool]
        key = idempotency_key(conversation_id, tool, args, turn_id=turn_id) \
            if spec.side_effect is not SideEffect.READ else None
        call = self._call(spec, args, auth, key, conversation_id, confirmation_id, approval_id)
        t0 = time.monotonic()
        attempts = 0
        resent = False
        while True:
            attempts += 1
            try:
                result = await asyncio.wait_for(call(), timeout=self._timeout(spec))
                return ToolOutcome(tool, "ok", result, attempts=attempts, idempotency_key=key,
                                   latency_s=time.monotonic() - t0)
            except NotFound:
                return ToolOutcome(tool, "not_found", error="not_found", attempts=attempts, idempotency_key=key,
                                   latency_s=time.monotonic() - t0)
            except BusinessRuleError as e:
                return ToolOutcome(tool, "rejected", error=str(e), attempts=attempts, idempotency_key=key,
                                   latency_s=time.monotonic() - t0)
            except IdempotencyConflict:
                # Misma key con otros parámetros: nunca debería pasar (la key ES el hash de los parámetros).
                # Si pasa, es un bug: se para todo y se avisa; reintentar no lo arregla.
                return ToolOutcome(tool, "conflict", error="idempotency_conflict", attempts=attempts,
                                   idempotency_key=key, latency_s=time.monotonic() - t0)
            except OperationInProgress:
                return ToolOutcome(tool, "unknown", error="operation_in_progress", attempts=attempts,
                                   idempotency_key=key, latency_s=time.monotonic() - t0)
            except (TimeoutError, TransientError) as e:
                failure = "timeout" if isinstance(e, TimeoutError) else "error"
                if spec.side_effect is SideEffect.READ:
                    if attempts <= spec.read_retries:
                        # backoff con jitter: si el backend está saturado, que los reintentos no lleguen juntos
                        await asyncio.sleep(self.backoff_s * (1 + self.rng.random()))
                        continue
                    return ToolOutcome(tool, failure, error=str(e) or failure, attempts=attempts,
                                       latency_s=time.monotonic() - t0)
                # Escritura: ¿se aplicó? Se pregunta por la key en lugar de adivinar.
                status = await self._status(auth, key)
                if status.get("status") == "succeeded":
                    return ToolOutcome(tool, "ok", status.get("result"), attempts=attempts, idempotency_key=key,
                                       recovered=True, latency_s=time.monotonic() - t0)
                if status.get("status") == "failed":
                    return ToolOutcome(tool, "rejected", error=str((status.get("result") or {}).get("error")),
                                       attempts=attempts, idempotency_key=key, latency_s=time.monotonic() - t0)
                if status.get("status") == "not_found" and not resent:
                    resent = True  # nunca llegó: reenvío UNA vez con la MISMA key
                    continue
                return ToolOutcome(tool, "unknown", error=f"{failure}; status={status.get('status')}",
                                   attempts=attempts, idempotency_key=key, latency_s=time.monotonic() - t0)

    async def _status(self, auth: AuthContext, key: str | None) -> dict[str, Any]:
        """Consulta de estado por key: es una LECTURA, así que tiene su timeout y un reintento."""
        for attempt in range(2):
            try:
                return await asyncio.wait_for(self.backend.get_operation(auth, key or ""), timeout=3.0
                                              if self.timeout_override_s is None else self.timeout_override_s)
            except (TimeoutError, TransientError):
                if attempt == 0:
                    await asyncio.sleep(self.backoff_s)
        return {"status": "status_check_failed"}
