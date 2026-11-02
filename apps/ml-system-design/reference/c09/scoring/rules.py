"""Motor de reglas (caso c09): lista negra, límites duros de velocidad y reglas por comercio. En proceso.

Por qué sigue habiendo reglas con un modelo:
  - son el FALLBACK: si el modelo o el feature store no contestan, las reglas deciden solas;
  - cubren lo que el modelo no puede aprender a tiempo: una tarjeta que ayer confirmaste robada va a la
    lista negra hoy; el modelo la vería en el próximo reentrenamiento;
  - expresan contratos de negocio ("este comercio no vende a tal país") que no son una probabilidad.

El costo de tenerlas: ≈ 400 reglas escritas a mano (el sistema actual del caso) se contradicen y nadie
sabe cuáles siguen sirviendo. Aquí hay pocas, cada una con su reason code y su contador
(fraud_rule_hits_total{rule}): una regla que no dispara en 90 días se revisa; una que dispara en el 5 %
del tráfico probablemente declina gente buena.

Cada regla se evalúa en su propio try/except: una regla rota (un campo que cambió de tipo) se salta, se
cuenta en fraud_rule_errors_total{rule} y dispara RulesEngineErrors; las demás reglas y el modelo siguen.
Es fail-open POR REGLA a propósito: que una regla rota tumbe todas las decisiones es peor (un bug en el
lookup de la lista negra, tratado como "disparada", declinaría el 100 % de los pagos). La alerta es la
defensa. La alternativa, que un límite duro roto cuente como disparado (fail-closed), rechaza de más
mientras dura: es una decisión de riesgo que se documenta, no un default.
"""

from __future__ import annotations  # anotaciones como texto

import time  # default de generated_at (en los tests y la demo)
from collections.abc import Callable  # tipo de una regla
from dataclasses import dataclass, field  # resultados

from policy import Policy  # límites duros y reglas por comercio vienen de policy.yaml


@dataclass(frozen=True)
class RuleHit:
    rule: str  # nombre de la regla (label `rule` de las métricas: cardinalidad acotada)
    action: str  # approve | step_up | review | decline
    reason_code: str  # lo que se loguea y se le explica a operaciones


@dataclass
class Blocklists:
    """Lista negra cargada en memoria desde el batch nocturno (tamaño: mídelo; aquí, sets de Python).

    En memoria y no en Redis: se consulta en CADA pago, incluso con Redis caído (es parte del fallback).
    `generated_at` es cuándo el job nocturno GENERÓ la lista (viene en el artefacto), no cuándo este pod
    la cargó: un pod que reinicia hoy y carga la lista de hace 3 días tiene una lista de hace 3 días.
    Se exporta como gauge y RulesEngineErrors avisa cuando pasa de 30 h.
    """

    card: frozenset[str] = frozenset()
    device: frozenset[str] = frozenset()
    ip: frozenset[str] = frozenset()
    email: frozenset[str] = frozenset()
    generated_at: float = field(default_factory=time.time)


@dataclass
class RulesResult:
    hits: list[RuleHit]
    errors: list[str]  # nombres de las reglas que fallaron (se saltaron)

    def actions(self) -> list[tuple[str, str]]:
        return [(h.action, h.reason_code) for h in self.hits]


Rule = Callable[[dict, dict], list[RuleHit]]


class RulesEngine:
    def __init__(self, policy: Policy, blocklists: Blocklists) -> None:
        self.policy = policy
        self.blocklists = blocklists
        # Orden fijo y nombres estables: son labels de métricas y aparecen en el log de decisiones.
        # Un límite duro por feature: si uno se rompe, los demás siguen.
        self.rules: list[tuple[str, Rule]] = [("blocklist", self._blocklist)]
        self.rules += [(f"hard_limit_{feature}", self._hard_limit(feature)) for feature in policy.hard_limits]
        self.rules += [("merchant_max_ticket", self._merchant_max_ticket),
                       ("merchant_blocked_country", self._merchant_blocked_country)]

    def evaluate(self, txn: dict, velocity: dict[str, float | None]) -> RulesResult:
        """`velocity`: las features sync (del KV store o, en el fallback, del contador local del pod)."""
        hits: list[RuleHit] = []
        errors: list[str] = []
        for name, rule in self.rules:
            try:
                hits.extend(rule(txn, velocity))
            except Exception:  # noqa: BLE001 — a propósito: una regla rota no tumba la decisión
                errors.append(name)
        return RulesResult(hits, errors)

    # ---------------------------------------------------------------------------------------- reglas
    def _blocklist(self, txn: dict, _: dict) -> list[RuleHit]:
        out = []
        for entity, fieldname in (("card", "card_token"), ("device", "device_hash"),
                                  ("ip", "ip_hash"), ("email", "email_hash")):
            value = txn.get(fieldname)
            if value and value in getattr(self.blocklists, entity):
                out.append(RuleHit("blocklist", "decline", f"BLOCKLIST_{entity.upper()}"))
        return out

    def _hard_limit(self, feature: str) -> Rule:
        lim = self.policy.hard_limits[feature]
        name = f"hard_limit_{feature}"

        def rule(_: dict, velocity: dict) -> list[RuleHit]:
            value = velocity.get(feature)
            # Sin valor (entidad faltante, o contador caído sin respaldo local) la regla NO dispara: no hay
            # dato, que es distinto de una regla rota. Por eso el fallback usa el contador local del pod.
            if value is not None and float(value) >= lim.at_least:
                return [RuleHit(name, lim.action, lim.reason)]
            return []

        return rule

    def _merchant_max_ticket(self, txn: dict, _: dict) -> list[RuleHit]:
        m = self.policy.merchant(txn["merchant_id"])
        if m.max_ticket_cents is not None and int(txn["amount_cents"]) > m.max_ticket_cents:
            return [RuleHit("merchant_max_ticket", m.over_max_action, "MERCHANT_MAX_TICKET")]
        return []

    def _merchant_blocked_country(self, txn: dict, _: dict) -> list[RuleHit]:
        m = self.policy.merchant(txn["merchant_id"])
        if txn.get("ip_country") and txn["ip_country"] in m.blocked_ip_countries:
            return [RuleHit("merchant_blocked_country", "decline", "MERCHANT_BLOCKED_COUNTRY")]
        return []
