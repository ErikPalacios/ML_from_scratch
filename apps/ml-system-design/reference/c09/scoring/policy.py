"""Política de decisión (caso c09): de (score, reglas, segmento) a approve / step_up / review / decline.

Lógica pura, sin I/O ni FastAPI: se prueba con tablas de casos y la usa service.py. La política vive en
policy.yaml (umbrales por segmento, exploración, límites duros, reglas por comercio).

Orden de severidad: approve < step_up < review < decline. La decisión final es la MÁS severa entre la del
modelo (o la del fallback) y la de las reglas: una regla de lista negra no la "deshace" un score bajo,
y un score alto no se ignora porque ninguna regla disparó.

Cada decisión lleva sus reason codes (por qué), porque:
  - operaciones y soporte a comercios tienen que poder explicar un decline sin abrir el modelo;
  - en una disputa (≈ 120 días después, según la red y el motivo) hay que reconstruir qué se decidió y con
    qué política y modelo;
  - el monitoreo cuenta decisiones por motivo: un salto en VELOCITY_CARD_60S es un ataque; un salto en
    MODEL_HIGH_RISK sin cambio de tráfico es un modelo o un umbral mal desplegado.
"""

from __future__ import annotations  # anotaciones como texto

import hashlib  # sorteo determinista de la exploración
from dataclasses import dataclass, field  # política y decisión inmutables
from pathlib import Path  # ruta del YAML

import yaml  # PyYAML: safe_load, nunca load (un YAML con tags de Python ejecuta código)

SEVERITY = {"approve": 0, "step_up": 1, "review": 2, "decline": 3}
ACTIONS = tuple(SEVERITY)


@dataclass(frozen=True)
class SegmentPolicy:
    typical_ticket_usd: float  # documenta de dónde salieron los umbrales (ver choose_thresholds.py)
    step_up: float  # score ≥ step_up → step-up
    decline: float  # score ≥ decline → decline
    fallback: str  # acción sin modelo cuando ninguna regla disparó: approve | step_up
    no_3ds_decline: float  # sin 3-D Secure disponible: decline si score ≥ esto, si no approve
    fallback_no_3ds: str  # sin modelo Y sin 3-D Secure, lo que iba a step-up: approve | decline


@dataclass(frozen=True)
class HardLimit:
    at_least: float
    action: str
    reason: str


@dataclass(frozen=True)
class MerchantRules:
    delayed_capture: bool = False
    max_ticket_cents: int | None = None
    over_max_action: str = "review"
    blocked_ip_countries: frozenset[str] = frozenset()


@dataclass(frozen=True)
class Policy:
    version: str
    ticket_band_cents: int
    mcc_groups: dict[str, frozenset[str]]
    segments: dict[str, SegmentPolicy]
    decline_rate_cap: float
    exploration_share: float
    exploration_max_score: float
    exploration_salt: str
    degraded_groups_allowed: frozenset[str]
    hard_limits: dict[str, HardLimit]
    merchants: dict[str, MerchantRules] = field(default_factory=dict)

    def merchant(self, merchant_id: str) -> MerchantRules:
        return self.merchants.get(merchant_id, MerchantRules())


@dataclass(frozen=True)
class Decision:
    decision: str
    reason_codes: tuple[str, ...]
    exploration: bool = False
    propensity: float | None = None  # P(exploración | región explorable): para pesar la fila al entrenar


def load_policy(path: str | Path) -> Policy:
    """Lee y VALIDA policy.yaml. Una política inválida no arranca el pod (falla en el deploy, no a las 3 a.m.)."""
    raw = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    segments = {name: SegmentPolicy(**cfg) for name, cfg in raw["segments"].items()}
    for name, s in segments.items():
        if not 0 < s.step_up < s.decline < 1:
            raise ValueError(f"{name}: hace falta 0 < step_up < decline < 1")
        if s.fallback not in ("approve", "step_up"):
            raise ValueError(f"{name}: fallback debe ser approve o step_up")
        if not 0 < s.no_3ds_decline < 1:
            raise ValueError(f"{name}: no_3ds_decline fuera de (0, 1)")
        if s.fallback_no_3ds not in ("approve", "decline"):
            raise ValueError(f"{name}: fallback_no_3ds debe ser approve o decline")
    groups = {g: frozenset(map(str, mccs)) for g, mccs in raw["segmentation"]["mcc_groups"].items()}
    for g in [*groups, "retail"]:  # cada grupo × banda necesita sus umbrales
        for band in ("low", "high"):
            if f"{g}_{band}" not in segments:
                raise ValueError(f"falta el segmento {g}_{band}")
    limits = {k: HardLimit(**v) for k, v in raw.get("hard_limits", {}).items()}
    for k, lim in limits.items():
        if lim.action not in ACTIONS:
            raise ValueError(f"hard_limits.{k}: acción desconocida {lim.action}")
    merchants = {}
    for mid, cfg in (raw.get("merchants") or {}).items():
        cfg = dict(cfg)
        cfg["blocked_ip_countries"] = frozenset(cfg.get("blocked_ip_countries", ()))
        merchants[str(mid)] = MerchantRules(**cfg)
    exp = raw["exploration"]
    if not 0 <= exp["share"] <= 0.05:
        # explorar es caro (se deja pasar a step-up lo que el modelo quería declinar): más de 5 % es un error
        raise ValueError("exploration.share fuera de [0, 0.05]")
    return Policy(
        version=str(raw["version"]),
        ticket_band_cents=int(raw["segmentation"]["ticket_band_cents"]),
        mcc_groups=groups,
        segments=segments,
        decline_rate_cap=float(raw["decline_rate_cap"]),
        exploration_share=float(exp["share"]),
        exploration_max_score=float(exp["max_score"]),
        exploration_salt=str(exp["salt"]),
        degraded_groups_allowed=frozenset(raw.get("degraded_groups_allowed", [])),
        hard_limits=limits,
        merchants=merchants,
    )


def segment_of(policy: Policy, mcc: str, amount_cents: int) -> str:
    """`retail_low`, `digital_high`… Cardinalidad 6: sirve como label de Prometheus sin explotar."""
    group = next((g for g, mccs in policy.mcc_groups.items() if mcc in mccs), "retail")
    band = "high" if amount_cents >= policy.ticket_band_cents else "low"
    return f"{group}_{band}"


def exploration_draw(salt: str, payment_id: str) -> float:
    """Número en [0, 1) que depende SOLO de (sal, payment_id).

    Determinista a propósito: un reintento del mismo pago tiene que recibir la misma decisión, y la
    auditoría tiene que poder reproducir por qué este pago se exploró. sha256 y no `hash()`: el hash de
    Python cambia entre procesos (PYTHONHASHSEED), así que cada pod sortearía distinto.
    """
    digest = hashlib.sha256(f"{salt}:{payment_id}".encode()).digest()
    return int.from_bytes(digest[:8], "big") / 2**64


def decide(policy: Policy, segment: str, score: float | None, rule_actions: list[tuple[str, str]],
           merchant_id: str, three_ds_available: bool, payment_id: str,
           three_ds_result: str | None = None) -> Decision:
    """La decisión final. `score` None = sin modelo (fallback rules-only). `rule_actions` = [(acción, código)].

    `three_ds_result` llega en la SEGUNDA llamada del mismo pago, después del desafío, y es DECISIVO: la
    segunda llamada aplica el resultado del desafío a la decisión de la primera (que fue step-up); no
    vuelve a correr el modelo ni sus bandas, ni el fallback, ni la exploración. Por qué: minutos después,
    las features stream ya incluirían al propio pago (Flink lo contó), y un modelo caído en ese momento
    no puede convertir un desafío FALLIDO en un approve. "failed" → decline. "authenticated" → approve,
    salvo que una regla diga review o decline (p. ej., la tarjeta entró a la lista negra entre las dos
    llamadas): ahí gana la regla.
    """
    seg = policy.segments[segment]
    merchant = policy.merchant(merchant_id)
    codes: list[str] = []
    exploration, propensity = False, None

    # 0) Segunda llamada, con el resultado del desafío: decide aquí y no sigue
    if three_ds_result is not None:
        rule_action = max((a for a, _ in rule_actions), key=SEVERITY.__getitem__, default="approve")
        codes.extend(code for _, code in rule_actions)
        if three_ds_result == "failed":
            return Decision("decline", (*codes, "STEP_UP_FAILED"))
        if SEVERITY[rule_action] >= SEVERITY["review"]:
            return Decision(rule_action, tuple(codes))
        return Decision("approve", (*codes, "STEP_UP_AUTHENTICATED"))

    # 1) Lo que dice el modelo (o el fallback del segmento si no hay modelo)
    if score is None:
        model_action = seg.fallback
        codes.append("FALLBACK_RULES_ONLY")
    elif score >= seg.decline:
        model_action = "decline"
        codes.append("MODEL_HIGH_RISK")
    elif score >= seg.step_up:
        model_action = "step_up"
        codes.append("MODEL_MEDIUM_RISK")
    else:
        model_action = "approve"

    # 2) Lo que dicen las reglas (siempre se evaluaron, con o sin modelo)
    rule_action = max((a for a, _ in rule_actions), key=SEVERITY.__getitem__, default="approve")
    codes.extend(code for _, code in rule_actions)

    # 3) Comercio con captura diferida: el decline DEL MODELO pasa a revisión manual (hay tiempo para que
    #    una persona mire antes de cobrar, y un falso decline en un pedido de US$2,000 es caro). Las
    #    reglas duras siguen declinando: una tarjeta en lista negra no necesita una persona.
    if model_action == "decline" and merchant.delayed_capture:
        model_action = "review"
        codes.append("MANUAL_REVIEW_DELAYED_CAPTURE")

    # 4) Exploración: una fracción conocida de los declines del modelo de riesgo MEDIO va a step-up.
    #    Sin esto, lo que el modelo bloquea nunca tiene etiqueta y el siguiente modelo no puede aprender
    #    de sus propios errores (sesgo de selección). No se explora lo que una regla declina ni lo extremo.
    if (model_action == "decline" and score is not None and score < policy.exploration_max_score
            and SEVERITY[rule_action] < SEVERITY["decline"] and three_ds_available
            and exploration_draw(policy.exploration_salt, payment_id) < policy.exploration_share):
        model_action = "step_up"
        exploration, propensity = True, policy.exploration_share
        codes.append("EXPLORATION_STEP_UP")

    final = max(model_action, rule_action, key=SEVERITY.__getitem__)

    # 5) Step-up imposible (la tarjeta o el emisor no soportan 3-D Secure): quedan approve o decline, con
    #    otro corte (el de no_3ds_decline). Sin score (fallback), decide `fallback_no_3ds` del segmento:
    #    en digital_high es decline, porque "step-up a todo" sin 3DS sería aprobar a ciegas justo ahí.
    if final == "step_up" and not three_ds_available:
        codes.append("STEP_UP_UNAVAILABLE")
        # Vale también si el step-up venía de una regla (VELOCITY_IP_60S): el código queda en el log
        if score is None:
            final = seg.fallback_no_3ds
        else:
            final = "decline" if score >= seg.no_3ds_decline else "approve"

    if final == "approve" and not codes:
        codes.append("APPROVED_LOW_RISK")
    return Decision(final, tuple(codes), exploration, propensity)
