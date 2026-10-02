"""Los sistemas internos que el agente opera (pedidos, envíos, reembolsos, devoluciones, centro de ayuda,
tickets), detrás de UNA interfaz pequeña, y un backend falso en memoria para tests y para la evaluación.

Por qué una interfaz: el orquestador no sabe si habla con el servicio real de pedidos o con este falso; los tests
y los ≈ 400 escenarios de evaluación (#c12.evaluacion) corren sin red y sin tocar dinero real.

Tres reglas que el backend aplica SIEMPRE, aunque la política del agente ya las haya revisado (defensa en
profundidad: la política puede tener un bug; el servicio de pedidos es el último que puede decir que no):
  1. Dueño: cada llamada trae el AuthContext de la sesión; un pedido ajeno es NotFound (igual que uno que no
     existe). El modelo nunca pasa un customer_id: no hay de dónde sacarlo.
  2. Idempotencia en toda escritura: la misma idempotency key con los mismos parámetros devuelve el MISMO
     resultado sin repetir el efecto; con otros parámetros es un conflicto (como la API de Stripe). Así un
     reintento después de un timeout, o la reanudación después de una caída, no paga dos veces.
  3. Estado de una operación por su key (`get_operation`): después de un timeout en una escritura, el agente
     pregunta "¿esto pasó?" en lugar de reintentar a ciegas.

El falso permite inyectar fallas por operación (latencia, timeout antes o después de aplicar el efecto, 503,
operación colgada) para probar justo los casos que rompen agentes en producción. Y guarda un registro de
auditoría de cada efecto (`audit`), que la evaluación usa como ORÁCULO independiente de la política.
"""

from __future__ import annotations  # anotaciones como texto

import asyncio  # latencias y "cuelgues" simulados
import hashlib  # hash de parámetros para detectar reuso de una key con otros datos
import json  # serialización canónica de parámetros
from collections import deque  # fallas inyectadas en orden por operación
from dataclasses import dataclass, field, replace  # modelos del dominio falso
from datetime import UTC, datetime  # fechas con zona (nunca naive)
from decimal import Decimal  # dinero
from typing import Any, Protocol  # interfaz

from agent.policy import AuthContext, OrderFacts, ShipmentFacts  # tipos puros compartidos con la política


# ------------------------------------------------------------------ errores (lo que el executor distingue)
class NotFound(Exception):
    """No existe o no es del cliente. No se reintenta."""


class BusinessRuleError(Exception):
    """El backend se negó por una regla propia (p. ej. el pedido ya salió). No se reintenta."""


class TransientError(Exception):
    """Falla pasajera (503, conexión). En una lectura se reintenta; en una escritura se pregunta el estado."""


class IdempotencyConflict(Exception):
    """La misma key con OTROS parámetros: es un bug del cliente, nunca se "arregla" reintentando."""


class OperationInProgress(Exception):
    """La key ya está en curso (otra llamada con la misma key no terminó). Estado desconocido por ahora."""


# ------------------------------------------------------------------ la interfaz
class CommerceBackend(Protocol):
    """Lo que el agente puede hacer en los sistemas internos. Todo recibe el AuthContext de la sesión."""

    async def get_order(self, auth: AuthContext, order_id: str) -> dict[str, Any]: ...
    async def get_order_facts(self, auth: AuthContext, order_id: str) -> OrderFacts | None: ...
    async def list_recent_orders(self, auth: AuthContext, limit: int = 10) -> list[str]: ...
    async def get_shipment_tracking(self, auth: AuthContext, order_id: str) -> dict[str, Any]: ...
    async def search_help_center(self, query: str, language: str = "es") -> list[dict[str, Any]]: ...
    async def update_shipping_address(self, auth: AuthContext, order_id: str, address: dict, *,
                                      key: str) -> dict[str, Any]: ...
    async def cancel_order(self, auth: AuthContext, order_id: str, reason: str, *, key: str,
                           confirmation_id: str | None) -> dict[str, Any]: ...
    async def create_return_label(self, auth: AuthContext, order_id: str, item_ids: list[str], reason: str, *,
                                  key: str) -> dict[str, Any]: ...
    async def issue_refund(self, auth: AuthContext, order_id: str, amount: Decimal, currency: str, reason: str,
                           *, key: str, confirmation_id: str | None,
                           approval_id: str | None) -> dict[str, Any]: ...
    async def create_ticket(self, auth: AuthContext, conversation_id: str, reason: str, summary: str, *,
                            key: str) -> dict[str, Any]: ...
    async def get_operation(self, auth: AuthContext, key: str) -> dict[str, Any]: ...


# ------------------------------------------------------------------ dominio del backend falso
@dataclass
class Item:
    item_id: str  # "I-1"
    title: str
    price: Decimal
    description: str = ""  # texto del VENDEDOR: no confiable (puede traer instrucciones inyectadas)


@dataclass
class Shipment:
    carrier: str
    status: str  # "label_created" | "in_transit" | "delivered" | "lost"
    expected_delivery: datetime | None
    events: list[tuple[datetime, str]] = field(default_factory=list)


@dataclass
class Order:
    order_id: str  # "A-1029"
    customer_id: str  # dueño
    status: str  # "paid" | "preparing" | "shipped" | "delivered" | "cancelled"
    currency: str
    items: list[Item]
    created_at: datetime
    address: dict[str, Any]
    delivered_at: datetime | None = None
    shipment: Shipment | None = None
    seller_note: str = ""  # mensaje del vendedor al comprador: no confiable

    @property
    def total(self) -> Decimal:
        return sum((i.price for i in self.items), Decimal("0"))


@dataclass
class Operation:
    """Registro de idempotencia: una key → parámetros (hash), estado y resultado."""

    params_hash: str
    customer_id: str  # para que get_operation también respete al dueño
    status: str  # "in_progress" | "succeeded" | "failed"
    result: dict[str, Any] | None = None


def _params_hash(op: str, params: dict[str, Any]) -> str:
    """Hash canónico de operación + parámetros (orden de claves fijo, Decimal como texto)."""
    blob = json.dumps({"op": op, **params}, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(blob.encode()).hexdigest()


HELP_CENTER: list[dict[str, str]] = [
    # El centro de ayuda PÚBLICO (en el caso, recuperado con la técnica de #c11). Aquí, 4 artículos de juguete.
    {"article_id": "hc-101", "title": "Cómo cambiar la dirección de entrega",
     "body": "Puedes cambiar la dirección mientras el pedido no haya salido del almacén. Después del envío, "
             "contacta al transportista con tu número de guía."},
    {"article_id": "hc-102", "title": "Reembolsos: plazos y métodos",
     "body": "Los reembolsos a tarjeta tardan de 5 a 10 días hábiles en verse en tu estado de cuenta, según tu "
             "banco. A saldo de la cuenta, son inmediatos."},
    {"article_id": "hc-103", "title": "Devoluciones: cómo generar tu etiqueta",
     "body": "Tienes 30 días desde la entrega para devolver un producto dañado, equivocado o distinto a la "
             "descripción. Genera la etiqueta desde tu pedido y llévalo a una sucursal del transportista."},
    {"article_id": "hc-104", "title": "Mi pedido no llega",
     "body": "Si pasaron 7 días de la fecha prometida y el envío no avanza, podemos reembolsarte o reenviarlo."},
]


class InMemoryCommerceBackend:
    """Backend FALSO: pedidos, envíos, reembolsos, etiquetas y tickets en memoria, con fallas inyectables.

    `faults[op]` es una cola de fallas que se consumen una por llamada a esa operación:
      "timeout_before_commit"  cuelga ANTES de aplicar el efecto: el request "nunca llegó" (no queda registro)
      "timeout_after_commit"   aplica el efecto y DESPUÉS cuelga: el caso peligroso (pagó, pero no te enteraste)
      "stuck_in_progress"      registra la key como en curso y cuelga para siempre (servidor que murió a mitad)
      "error"                  TransientError (un 503) sin aplicar nada
      "slow:<s>"               latencia de <s> segundos y después responde normal
    "Colgar" = dormir `hang_s` (10 s por defecto): el timeout del executor (3 s, o menos en tests) lo corta.
    """

    def __init__(self, orders: list[Order] | None = None, *, now: datetime | None = None, hang_s: float = 10.0,
                 base_latency_s: float = 0.0):
        self.orders: dict[str, Order] = {o.order_id: o for o in (orders or [])}
        self.refunds: list[dict[str, Any]] = []  # libro de reembolsos (de personas y del agente)
        self.labels: list[dict[str, Any]] = []  # etiquetas de devolución creadas
        self.tickets: list[dict[str, Any]] = []  # tickets de hand-off a humanos
        self.audit: list[dict[str, Any]] = []  # cada EFECTO aplicado, con quién, key, confirmación y aprobación
        self.ops: dict[str, Operation] = {}  # registro de idempotencia (en producción: tabla con TTL ≥ 7 días)
        self.faults: dict[str, deque[str]] = {}
        self.calls: list[str] = []  # cada llamada recibida (también las que fallaron): para los tests
        self.hang_s = hang_s
        self.base_latency_s = base_latency_s
        self._now = now  # reloj fijo para tests reproducibles; None = reloj real

    # ---------------------------------------------------------- utilidades
    def now(self) -> datetime:
        return self._now or datetime.now(UTC)

    def inject(self, op: str, *faults: str) -> None:
        """Encola fallas para las próximas llamadas a `op` (una por llamada, en orden)."""
        self.faults.setdefault(op, deque()).extend(faults)

    async def _pre(self, op: str) -> str | None:
        """Latencia base + la próxima falla de `op`. Devuelve la falla que se aplica DESPUÉS del efecto."""
        self.calls.append(op)
        if self.base_latency_s:
            await asyncio.sleep(self.base_latency_s)
        fault = self.faults.get(op, deque()).popleft() if self.faults.get(op) else None
        if fault is None:
            return None
        if fault == "timeout_before_commit":
            await asyncio.sleep(self.hang_s)  # el executor corta antes: no se aplica nada
            raise TransientError("hang before commit")  # solo si nadie cortó (hang_s corto en un test)
        if fault == "error":
            raise TransientError("503 Service Unavailable")
        if fault.startswith("slow:"):
            await asyncio.sleep(float(fault.split(":", 1)[1]))
            return None
        return fault  # "timeout_after_commit" y "stuck_in_progress" se resuelven en _idempotent

    def _owned(self, auth: AuthContext, order_id: str) -> Order:
        """Regla 1: el pedido existe Y es del cliente autenticado; si no, NotFound (no se distingue)."""
        order = self.orders.get(order_id)
        if order is None or order.customer_id != auth.customer_id:
            raise NotFound(order_id)
        return order

    async def _idempotent(self, op: str, auth: AuthContext, key: str, params: dict[str, Any], fault: str | None,
                          apply) -> dict[str, Any]:
        """Regla 2: aplica `apply()` una sola vez por key. Mismo key + mismos parámetros → mismo resultado."""
        h = _params_hash(op, params)
        prev = self.ops.get(key)
        if prev is not None:
            if prev.params_hash != h:
                raise IdempotencyConflict(key)  # misma key, otros datos: bug, nunca se reintenta
            if prev.status == "in_progress":
                raise OperationInProgress(key)
            if prev.status == "succeeded":
                return {**(prev.result or {}), "idempotent_replay": True}  # el efecto NO se repite
            # "failed": un fallo definitivo también se recuerda (como Stripe guarda incluso los 500)
            raise BusinessRuleError((prev.result or {}).get("error", "failed"))
        self.ops[key] = Operation(h, auth.customer_id, "in_progress")
        if fault == "stuck_in_progress":
            await asyncio.sleep(self.hang_s)  # el servidor "murió" con la operación a medias
            raise TransientError("stuck")
        try:
            result = apply()  # el efecto en sí (síncrono y atómico en este falso)
        except BusinessRuleError as e:
            self.ops[key] = Operation(h, auth.customer_id, "failed", {"error": str(e)})
            raise
        self.ops[key] = Operation(h, auth.customer_id, "succeeded", result)
        if fault == "timeout_after_commit":
            await asyncio.sleep(self.hang_s)  # el efecto YA se aplicó; la respuesta no llega a tiempo
        return result

    def _audit(self, op: str, auth: AuthContext, order_id: str, key: str, **extra: Any) -> None:
        self.audit.append({"op": op, "customer_id": auth.customer_id, "order_id": order_id, "key": key,
                           "at": self.now().isoformat(), **extra})

    # ---------------------------------------------------------- lecturas
    async def get_order(self, auth: AuthContext, order_id: str) -> dict[str, Any]:
        await self._pre("get_order")
        o = self._owned(auth, order_id)
        # Vista MINIMIZADA para el modelo: ciudad y estado, no calle ni teléfono (PII mínima en el prompt)
        return {
            "order_id": o.order_id, "status": o.status, "currency": o.currency, "total": str(o.total),
            "created_at": o.created_at.date().isoformat(),
            "delivered_at": o.delivered_at.date().isoformat() if o.delivered_at else None,
            "ship_to": {"city": o.address.get("city"), "state": o.address.get("state")},
            "items": [{"item_id": i.item_id, "title": i.title, "price": str(i.price),
                       "description": i.description} for i in o.items],
            "seller_note": o.seller_note or None,
            "refunded_total": str(self._refunded(o.order_id)),
        }

    def _refunded(self, order_id: str) -> Decimal:
        return sum((r["amount"] for r in self.refunds if r["order_id"] == order_id), Decimal("0"))

    async def get_order_facts(self, auth: AuthContext, order_id: str) -> OrderFacts | None:
        """Hechos para la POLÍTICA (no para el modelo). None si no existe o no es del cliente."""
        await self._pre("get_order_facts")
        try:
            o = self._owned(auth, order_id)
        except NotFound:
            return None
        ship = o.shipment
        return OrderFacts(
            order_id=o.order_id, customer_id=o.customer_id, status=o.status, currency=o.currency, total=o.total,
            refunded_total=self._refunded(o.order_id),
            agent_refunds=sum(1 for r in self.refunds if r["order_id"] == o.order_id and r["by"] == "agent"),
            delivered_at=o.delivered_at,
            shipment=ShipmentFacts(ship.status, ship.expected_delivery) if ship else None,
        )

    async def list_recent_orders(self, auth: AuthContext, limit: int = 10) -> list[str]:
        """Ids de los pedidos recientes del cliente (para validar que un order_id propuesto es real)."""
        await self._pre("list_recent_orders")
        mine = sorted((o for o in self.orders.values() if o.customer_id == auth.customer_id),
                      key=lambda o: o.created_at, reverse=True)
        return [o.order_id for o in mine[:limit]]

    async def get_shipment_tracking(self, auth: AuthContext, order_id: str) -> dict[str, Any]:
        await self._pre("get_shipment_tracking")
        o = self._owned(auth, order_id)
        if o.shipment is None:
            return {"order_id": order_id, "status": "not_shipped"}
        s = o.shipment
        return {"order_id": order_id, "carrier": s.carrier, "status": s.status,
                "expected_delivery": s.expected_delivery.date().isoformat() if s.expected_delivery else None,
                "last_events": [{"at": t.isoformat(), "text": txt} for t, txt in s.events[-3:]]}

    async def search_help_center(self, query: str, language: str = "es") -> list[dict[str, Any]]:
        await self._pre("search_help_center")
        # El falso solo tiene artículos en español; el real filtra por `language`
        # Búsqueda de juguete por palabras en común; en el caso es retrieval híbrido como en #c11/#c07
        words = {w for w in query.lower().split() if len(w) > 3}
        scored = []
        for a in HELP_CENTER:
            text = (a["title"] + " " + a["body"]).lower()
            score = sum(1 for w in words if w in text)
            if score:
                scored.append((score, a))
        scored.sort(key=lambda s: -s[0])
        return [{"article_id": a["article_id"], "title": a["title"], "snippet": a["body"][:300],
                 "url": f"https://ayuda.marketplace.example/articulos/{a['article_id']}"} for _, a in scored[:3]]

    async def get_operation(self, auth: AuthContext, key: str) -> dict[str, Any]:
        """Regla 3: "¿esta key se aplicó?" → not_found | in_progress | succeeded (+ resultado) | failed."""
        await self._pre("get_operation")
        op = self.ops.get(key)
        if op is None or op.customer_id != auth.customer_id:
            return {"status": "not_found"}
        return {"status": op.status, "result": op.result}

    # ---------------------------------------------------------- escrituras (todas idempotentes por key)
    async def update_shipping_address(self, auth: AuthContext, order_id: str, address: dict, *,
                                      key: str) -> dict[str, Any]:
        fault = await self._pre("update_shipping_address")
        o = self._owned(auth, order_id)

        def apply() -> dict[str, Any]:
            if o.status not in {"paid", "preparing"}:
                raise BusinessRuleError("already_shipped")  # el backend también lo revisa
            o.address = dict(address)
            self._audit("update_shipping_address", auth, order_id, key, order_status=o.status)
            return {"order_id": order_id, "updated": True, "ship_to_city": address.get("city")}

        return await self._idempotent("update_shipping_address", auth, key,
                                      {"order_id": order_id, "address": address}, fault, apply)

    async def cancel_order(self, auth: AuthContext, order_id: str, reason: str, *, key: str,
                           confirmation_id: str | None) -> dict[str, Any]:
        fault = await self._pre("cancel_order")
        o = self._owned(auth, order_id)

        def apply() -> dict[str, Any]:
            if o.status not in {"paid", "preparing"}:
                raise BusinessRuleError("already_shipped")
            o.status = "cancelled"  # el pago se anula completo (el procesador lo hace; aquí, implícito)
            self._audit("cancel_order", auth, order_id, key, confirmation_id=confirmation_id,
                        amount=str(o.total), currency=o.currency)
            return {"order_id": order_id, "cancelled": True, "refund_of_payment": str(o.total),
                    "currency": o.currency}

        return await self._idempotent("cancel_order", auth, key, {"order_id": order_id, "reason": reason},
                                      fault, apply)

    async def create_return_label(self, auth: AuthContext, order_id: str, item_ids: list[str], reason: str, *,
                                  key: str) -> dict[str, Any]:
        fault = await self._pre("create_return_label")
        o = self._owned(auth, order_id)

        def apply() -> dict[str, Any]:
            known = {i.item_id for i in o.items}
            if not set(item_ids) <= known:
                raise BusinessRuleError("unknown_item")
            label = {"label_id": f"RL-{len(self.labels) + 1:05d}", "order_id": order_id,
                     "item_ids": sorted(item_ids), "carrier": "Paquetería Demo"}
            self.labels.append(label)
            self._audit("create_return_label", auth, order_id, key)
            return label

        return await self._idempotent("create_return_label", auth, key,
                                      {"order_id": order_id, "item_ids": sorted(item_ids), "reason": reason},
                                      fault, apply)

    async def issue_refund(self, auth: AuthContext, order_id: str, amount: Decimal, currency: str, reason: str,
                           *, key: str, confirmation_id: str | None,
                           approval_id: str | None) -> dict[str, Any]:
        fault = await self._pre("issue_refund")
        o = self._owned(auth, order_id)

        def apply() -> dict[str, Any]:
            # El servicio de pagos revisa lo que NO puede ser falso nunca: moneda y techo del pedido.
            # Los límites del agente (US$50, 1 por pedido, confirmación) viven en la política: si un bug los
            # rompe, la evaluación lo detecta con el registro de auditoría (eval/run_scenarios.py).
            if currency != o.currency:
                raise BusinessRuleError("currency_mismatch")
            if amount > o.total - self._refunded(order_id):
                raise BusinessRuleError("amount_exceeds_order")
            refund = {"refund_id": f"RF-{len(self.refunds) + 1:05d}", "order_id": order_id, "amount": amount,
                      "currency": currency, "reason": reason, "by": "agent"}
            self.refunds.append(refund)
            self._audit("issue_refund", auth, order_id, key, amount=str(amount), currency=currency,
                        confirmation_id=confirmation_id, approval_id=approval_id)
            return {"refund_id": refund["refund_id"], "order_id": order_id, "amount": str(amount),
                    "currency": currency, "status": "issued"}

        return await self._idempotent("issue_refund", auth, key,
                                      {"order_id": order_id, "amount": str(amount), "currency": currency,
                                       "reason": reason}, fault, apply)

    async def create_ticket(self, auth: AuthContext, conversation_id: str, reason: str, summary: str, *,
                            key: str) -> dict[str, Any]:
        fault = await self._pre("create_ticket")

        def apply() -> dict[str, Any]:
            ticket = {"ticket_id": f"T-{len(self.tickets) + 1:05d}", "conversation_id": conversation_id,
                      "reason": reason, "summary": summary}
            self.tickets.append(ticket)
            self._audit("create_ticket", auth, "", key)
            return {"ticket_id": ticket["ticket_id"], "queue": "support-humans"}

        # Un ticket por conversación: los parámetros de la key son solo la conversación (no el motivo ni el texto)
        return await self._idempotent("create_ticket", auth, key, {"conversation_id": conversation_id}, fault,
                                      apply)


def demo_orders(now: datetime) -> list[Order]:
    """Pedidos de ejemplo (los usan la demo del servicio y algunos tests). Moneda MXN, montos ilustrativos."""
    from datetime import timedelta  # solo aquí

    addr = {"street": "Av. Siempre Viva 742", "city": "Puebla", "state": "PUE", "postal_code": "72000",
            "country": "MX"}
    return [
        Order("A-1029", "cust-1", "delivered", "MXN",
              [Item("I-1", "Audífonos inalámbricos", Decimal("450.00"), "Audífonos con estuche de carga.")],
              now - timedelta(days=12), addr, delivered_at=now - timedelta(days=3),
              shipment=Shipment("Paquetería Demo", "delivered", now - timedelta(days=4))),
        Order("A-1030", "cust-1", "preparing", "MXN",
              [Item("I-1", "Licuadora", Decimal("1299.00"))], now - timedelta(days=1), addr),
        Order("A-1031", "cust-1", "delivered", "MXN",
              [Item("I-1", "Monitor 27 pulgadas", Decimal("2400.00"))], now - timedelta(days=10), addr,
              delivered_at=now - timedelta(days=2),
              shipment=Shipment("Paquetería Demo", "delivered", now - timedelta(days=3))),
        Order("A-2002", "cust-2", "delivered", "MXN",  # de OTRO cliente: el agente de cust-1 no lo ve
              [Item("I-1", "Bicicleta", Decimal("5200.00"))], now - timedelta(days=20), addr,
              delivered_at=now - timedelta(days=15)),
    ]


def clone(order: Order, **changes: Any) -> Order:
    """Copia de un pedido con cambios (para armar escenarios sin compartir estado entre ellos)."""
    return replace(order, **changes)
