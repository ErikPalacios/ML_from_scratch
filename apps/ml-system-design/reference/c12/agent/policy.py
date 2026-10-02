"""Política del agente de soporte (caso c12): funciones PURAS que deciden si una acción propuesta por el modelo
se ejecuta, se niega, espera la confirmación del cliente o espera la aprobación de una persona.

La regla de oro del caso: la política vive en CÓDIGO, no en el prompt. El system prompt puede decir "no
reembolses más de US$50", pero eso es una sugerencia que compite con cualquier texto inyectado en una
descripción de producto o en un mensaje del vendedor (#m14.guardrails). Aquí está la regla que se cumple
aunque el modelo "decida" otra cosa.

Qué decide `evaluate()` (en este orden, y el primer "no" gana):
  1. ¿La herramienta está permitida para este tipo de conversación? (lista permitida: tools.TOOLSETS)
  2. Dueño: el pedido es del cliente AUTENTICADO. El customer_id sale del contexto de autenticación (la sesión
     del chat), nunca de los argumentos del modelo: el schema de las herramientas ni siquiera tiene ese campo.
     Un pedido ajeno se contesta igual que uno inexistente ("order_not_found") para no confirmar que existe.
  3. Estado del pedido: dirección y cancelación solo antes del envío; etiqueta de devolución solo entregado y
     dentro de la ventana; reembolso solo con un motivo elegible para el estado real del pedido y del envío.
  4. Límites de dinero: monto ≤ total − ya reembolsado, misma moneda del pedido, y máximo 1 reembolso del
     agente por pedido (el segundo lo decide una persona).
  5. Confirmación: toda acción de dinero o irreversible (issue_refund, cancel_order) necesita que el cliente la
     confirme en la UI con un botón atado a ESA acción exacta (action_id = hash de los argumentos). Que el
     modelo diga "el cliente confirmó" no es una confirmación.
  6. Aprobación: un reembolso > US$50 equivalentes (o cualquier reembolso en una conversación con señales de
     inyección) va a la cola de aprobación humana; la conversación espera (SLA 4 horas hábiles).

Pura = sin I/O, sin reloj (recibe `now`), sin base de datos: los hechos (OrderFacts) los trae el orquestador
con una lectura del backend justo antes de decidir, y se vuelven a leer después de una espera larga (una
aprobación puede llegar horas después, cuando el pedido ya cambió). Por eso se prueba con tablas de casos.

Números ILUSTRATIVOS (salen del caso o son ejemplos; en producción vienen de la configuración de negocio):
límite automático US$50, ventana de devolución 30 días, 7 días de gracia para "no llegó", tasas de cambio.
"""

from __future__ import annotations  # anotaciones como texto (tipos modernos sin costo en runtime)

from collections.abc import Mapping  # tabla de tasas de cambio (solo lectura)
from dataclasses import dataclass, field  # hechos y decisiones inmutables
from datetime import datetime, timedelta  # ventanas de devolución y de "no llegó"
from decimal import ROUND_HALF_UP, Decimal  # dinero SIEMPRE en Decimal: 0.1 + 0.2 != 0.3 en float
from enum import StrEnum  # veredictos legibles en logs y métricas

# Estados de pedido antes del envío: lo único que todavía se puede cambiar o cancelar sin logística inversa.
PRE_SHIPMENT = frozenset({"paid", "preparing"})

# Acciones de dinero o irreversibles: necesitan confirmación explícita del cliente (SPEC §8m).
CONFIRMATION_REQUIRED = frozenset({"issue_refund", "cancel_order"})

# Herramientas que operan sobre un pedido: la política necesita sus hechos (dueño, estado, montos).
ORDER_SCOPED = frozenset({
    "get_order", "get_shipment_tracking", "update_shipping_address",
    "cancel_order", "create_return_label", "issue_refund",
})


@dataclass(frozen=True)
class AuthContext:
    """Quién está del otro lado del chat, según la SESIÓN autenticada (no según lo que escriba nadie)."""

    customer_id: str  # id interno del cliente: lo pone el servicio a partir del token, nunca el modelo
    role: str = "buyer"  # "buyer" o "seller": cambia qué herramientas tiene (aquí solo se usa buyer)


@dataclass(frozen=True)
class ShipmentFacts:
    """Lo que la política necesita del envío (no la lista completa de eventos del transportista)."""

    status: str  # "label_created" | "in_transit" | "delivered" | "lost"
    expected_delivery: datetime | None  # fecha prometida; base para "no llegó"


@dataclass(frozen=True)
class OrderFacts:
    """Hechos del pedido leídos del backend JUSTO antes de decidir (nunca los que "recuerda" el modelo)."""

    order_id: str
    customer_id: str  # dueño real del pedido, para compararlo con AuthContext
    status: str  # "paid" | "preparing" | "shipped" | "delivered" | "cancelled"
    currency: str  # moneda del pedido (ISO 4217): el reembolso va en la misma
    total: Decimal  # total cobrado
    refunded_total: Decimal = Decimal("0")  # ya reembolsado (por personas o por el agente)
    agent_refunds: int = 0  # reembolsos que hizo el AGENTE en este pedido (máximo 1)
    delivered_at: datetime | None = None  # para la ventana de devolución
    shipment: ShipmentFacts | None = None  # None si todavía no se creó el envío


@dataclass(frozen=True)
class ConversationFacts:
    """Lo que la política sabe de la conversación: tipo, qué confirmó el cliente y qué aprobó una persona."""

    conversation_type: str  # "order_support" | "general_question" (define la lista permitida)
    allowed_tools: frozenset[str]  # tools.TOOLSETS[conversation_type]: se pasa para que esto siga siendo puro
    confirmed_action_ids: frozenset[str] = frozenset()  # action_ids confirmados con el botón de la UI
    approved_action_ids: frozenset[str] = frozenset()  # action_ids aprobados en la cola humana
    injection_flagged: bool = False  # alguna señal de inyección en esta conversación (guardrails/untrusted.py)


@dataclass(frozen=True)
class PolicyConfig:
    """Parámetros de negocio. Todos ILUSTRATIVOS: en producción vienen de configuración versionada."""

    auto_refund_limit_usd: Decimal = Decimal("50")  # SPEC: reembolso automático ≤ US$50 equivalentes
    # USD por unidad de moneda local. Ilustrativas (≈ 18.2 MXN por dólar): en producción, la tasa del día del
    # servicio de FX, guardada con la decisión para poder auditarla después.
    usd_per_unit: Mapping[str, Decimal] = field(default_factory=lambda: {
        "USD": Decimal("1"),
        "MXN": Decimal("0.055"),
        "BRL": Decimal("0.18"),
        "COP": Decimal("0.00025"),
        "CLP": Decimal("0.00105"),
    })
    return_window_days: int = 30  # ventana de devolución desde la entrega (ilustrativa)
    not_received_grace_days: int = 7  # días después de la fecha prometida para aceptar "no llegó" (ilustrativo)
    # Ruteo de aprobaciones por monto en USD: (tope inclusivo, cola). La última fila (None) atrapa el resto.
    approval_routes: tuple[tuple[Decimal | None, str], ...] = (
        (Decimal("200"), "refunds-tier1"),  # supervisores de soporte
        (None, "refunds-tier2"),  # montos grandes: equipo de riesgo / finanzas
    )
    approval_sla_business_hours: int = 4  # SPEC: la conversación espera hasta 4 horas hábiles
    # Kill switch (escalón de la escalera de degradación): toda acción de dinero o irreversible va a aprobación
    # humana. Se prende con AgentPolicyViolation o RefundAmountAnomaly sin explicar; es configuración, no un deploy.
    money_to_humans: bool = False


class Verdict(StrEnum):
    """Los cuatro resultados posibles. StrEnum: se escriben tal cual en el step log y en las métricas."""

    ALLOW = "allow"  # ejecutar ya
    DENY = "deny"  # no ejecutar; el motivo vuelve al modelo como observación
    NEEDS_CONFIRMATION = "needs_confirmation"  # pedir al cliente que confirme ESTA acción exacta en la UI
    NEEDS_APPROVAL = "needs_approval"  # crear una aprobación en la cola humana y esperar


@dataclass(frozen=True)
class Decision:
    """Resultado de evaluar una acción: veredicto + motivo estable (código, va a métricas) + detalle (texto)."""

    verdict: Verdict
    reason: str  # código corto y estable: "already_shipped", "over_auto_limit"… (label de métricas)
    detail: str = ""  # explicación para el modelo y para la persona que revisa
    amount_usd: Decimal | None = None  # monto en USD (solo reembolsos), para auditoría y métricas
    approval_queue: str | None = None  # a qué cola va (solo NEEDS_APPROVAL)

    @property
    def allowed(self) -> bool:
        return self.verdict is Verdict.ALLOW


def to_usd(amount: Decimal, currency: str, cfg: PolicyConfig) -> Decimal:
    """Convierte a USD para comparar contra el límite. Moneda desconocida → error (mejor fallar que adivinar)."""
    rate = cfg.usd_per_unit.get(currency)
    if rate is None:
        raise ValueError(f"sin tasa de cambio para {currency}: no se puede aplicar el límite")
    # Redondeo a centavos con HALF_UP (el de los humanos); el límite se compara con este valor
    return (amount * rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def route_approval(amount_usd: Decimal, cfg: PolicyConfig) -> str:
    """Elige la cola de aprobación por monto: montos chicos a supervisores, grandes a riesgo."""
    for cap, queue in cfg.approval_routes:
        if cap is None or amount_usd <= cap:
            return queue
    raise ValueError("approval_routes debe terminar con una fila sin tope (None)")


def check_ownership(auth: AuthContext, order: OrderFacts | None) -> Decision | None:
    """Ownership: None si el pedido es del cliente autenticado; si no, DENY idéntico a "no existe".

    Por qué la misma respuesta para "no existe" y "es de otra persona": si fueran distintas, el agente sería un
    oráculo para adivinar pedidos ajenos (IDOR, #m15.authn-authz). El backend aplica la misma regla en cada
    llamada (defensa en profundidad): esto evita la llamada; el backend es el que no se puede saltar.
    """
    if order is None or order.customer_id != auth.customer_id:
        return Decision(Verdict.DENY, "order_not_found", "No existe un pedido con ese id para este cliente.")
    return None


def refund_eligibility(order: OrderFacts, reason: str, now: datetime, cfg: PolicyConfig) -> Decision | None:
    """¿El MOTIVO del reembolso es compatible con el estado REAL del pedido? None = elegible; si no, DENY.

    El modelo elige el motivo a partir de lo que dice el cliente; la política lo contrasta con los hechos.
    "Llegó dañado" en un pedido que el transportista no entregó, o fuera de la ventana, no es elegible.
    """
    if order.status == "cancelled":
        return Decision(Verdict.DENY, "order_cancelled", "El pedido está cancelado: el pago ya se devolvió.")
    if reason in {"damaged", "wrong_item", "not_as_described"}:
        # Problemas con lo recibido: el pedido tiene que estar entregado y dentro de la ventana
        if order.status != "delivered" or order.delivered_at is None:
            return Decision(Verdict.DENY, "not_delivered", "El pedido no figura como entregado.")
        if now > order.delivered_at + timedelta(days=cfg.return_window_days):
            return Decision(Verdict.DENY, "outside_window",
                            f"Pasaron más de {cfg.return_window_days} días desde la entrega.")
        return None
    if reason == "not_received":
        ship = order.shipment
        if order.status == "delivered" or (ship is not None and ship.status == "delivered"):
            # "No me llegó" con entrega confirmada es un caso para una persona (posible fraude o error del
            # transportista): el agente no lo resuelve con dinero
            return Decision(Verdict.DENY, "marked_delivered",
                            "El transportista marcó el pedido como entregado: lo revisa una persona.")
        if ship is not None and ship.status == "lost":
            return None  # el transportista declaró el paquete perdido
        if ship is not None and ship.expected_delivery is not None and \
                now > ship.expected_delivery + timedelta(days=cfg.not_received_grace_days):
            return None  # muy pasado de la fecha prometida
        return Decision(Verdict.DENY, "not_late_yet",
                        "El envío todavía está dentro del plazo prometido más los días de gracia.")
    return Decision(Verdict.DENY, "reason_not_eligible", f"Motivo no elegible para reembolso: {reason}.")


def evaluate(
    tool: str,
    args: Mapping[str, object],
    *,
    auth: AuthContext,
    order: OrderFacts | None,
    conv: ConversationFacts,
    action_id: str,
    now: datetime,
    cfg: PolicyConfig | None = None,
) -> Decision:
    """Decide qué pasa con UNA tool call propuesta por el modelo (args ya validados contra su schema).

    `action_id` identifica la acción exacta (herramienta + argumentos normalizados): es lo que el cliente
    confirma y lo que una persona aprueba. Si el modelo cambia el monto, es otra acción y otra confirmación.
    """
    cfg = cfg or PolicyConfig()

    # 1. Lista permitida por tipo de conversación (OWASP LLM06, excessive agency: menos herramientas, menos daño)
    if tool not in conv.allowed_tools:
        return Decision(Verdict.DENY, "tool_not_allowed", f"La herramienta {tool} no está disponible aquí.")

    # 2. Dueño (solo herramientas que operan sobre un pedido)
    if tool in ORDER_SCOPED:
        denied = check_ownership(auth, order)
        if denied:
            return denied
    assert order is not None or tool not in ORDER_SCOPED  # para el lector: desde aquí, order existe si aplica

    # 3. Estado del pedido, herramienta por herramienta
    if tool in {"update_shipping_address", "cancel_order"} and order.status not in PRE_SHIPMENT:
        return Decision(Verdict.DENY, "already_shipped",
                        f"El pedido está en estado '{order.status}': ya no se puede cambiar ni cancelar.")
    if tool == "create_return_label":
        if order.status != "delivered" or order.delivered_at is None:
            return Decision(Verdict.DENY, "not_delivered", "Solo se devuelve un pedido entregado.")
        if now > order.delivered_at + timedelta(days=cfg.return_window_days):
            return Decision(Verdict.DENY, "outside_window",
                            f"Pasaron más de {cfg.return_window_days} días desde la entrega.")

    amount_usd: Decimal | None = None
    if tool == "issue_refund":
        # 4. Dinero: moneda, monto, uno por pedido, elegibilidad
        amount = Decimal(str(args["amount"]))  # str() primero: Decimal(0.1) arrastra el error del float
        currency = str(args["currency"])
        if currency != order.currency:
            return Decision(Verdict.DENY, "currency_mismatch",
                            f"El pedido se cobró en {order.currency}; el reembolso va en la misma moneda.")
        if amount <= 0:
            return Decision(Verdict.DENY, "invalid_amount", "El monto tiene que ser positivo.")
        remaining = order.total - order.refunded_total
        if amount > remaining:
            return Decision(Verdict.DENY, "amount_exceeds_order",
                            f"El monto supera lo que queda por reembolsar ({remaining} {order.currency}).")
        if order.agent_refunds >= 1:
            # SPEC: máximo 1 reembolso del agente por pedido. El segundo puede ser legítimo, pero lo decide una
            # persona: es exactamente el patrón de abuso ("pide otra vez, a ver si pasa")
            return Decision(Verdict.DENY, "agent_refund_limit",
                            "Este pedido ya tuvo un reembolso del asistente: lo revisa una persona.")
        not_eligible = refund_eligibility(order, str(args["reason"]), now, cfg)
        if not_eligible:
            return not_eligible
        amount_usd = to_usd(amount, currency, cfg)

    # 5. Confirmación explícita del cliente para lo que mueve dinero o no se puede deshacer
    if tool in CONFIRMATION_REQUIRED and action_id not in conv.confirmed_action_ids:
        return Decision(Verdict.NEEDS_CONFIRMATION, "needs_confirmation",
                        "El cliente tiene que confirmar esta acción en la aplicación.", amount_usd=amount_usd)

    # 6. Aprobación humana: kill switch prendido, sobre el límite automático, o con señales de inyección
    if tool in CONFIRMATION_REQUIRED and cfg.money_to_humans and action_id not in conv.approved_action_ids:
        return Decision(Verdict.NEEDS_APPROVAL, "kill_switch", "Las acciones de dinero están pasando por personas.",
                        amount_usd=amount_usd, approval_queue=route_approval(amount_usd or Decimal("0"), cfg))
    if tool == "issue_refund" and action_id not in conv.approved_action_ids:
        assert amount_usd is not None  # calculado arriba
        if amount_usd > cfg.auto_refund_limit_usd:
            return Decision(Verdict.NEEDS_APPROVAL, "over_auto_limit",
                            f"US${amount_usd} supera el límite automático de US${cfg.auto_refund_limit_usd}.",
                            amount_usd=amount_usd, approval_queue=route_approval(amount_usd, cfg))
        if conv.injection_flagged:
            # Las heurísticas de inyección no bloquean (tienen falsos positivos), pero SUBEN la exigencia: en una
            # conversación sospechosa, el dinero lo mira una persona aunque el monto sea chico
            return Decision(Verdict.NEEDS_APPROVAL, "injection_flagged",
                            "La conversación tiene señales de instrucciones inyectadas: revisa una persona.",
                            amount_usd=amount_usd, approval_queue=route_approval(amount_usd, cfg))

    return Decision(Verdict.ALLOW, "ok", amount_usd=amount_usd)
