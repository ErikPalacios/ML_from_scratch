"""Tests de agent/policy.py: tablas de casos sobre funciones puras (sin backend, sin modelo, sin reloj real)."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest

from agent import policy as pol

NOW = datetime(2026, 10, 1, 15, 0, tzinfo=UTC)
ME = pol.AuthContext("cust-1")
ALL = frozenset({"get_order", "get_shipment_tracking", "search_help_center", "update_shipping_address",
                 "cancel_order", "create_return_label", "issue_refund", "escalate_to_human"})


def order(**kw):
    base = dict(order_id="A-1029", customer_id="cust-1", status="delivered", currency="MXN",
                total=Decimal("2400.00"), delivered_at=NOW - timedelta(days=3),
                shipment=pol.ShipmentFacts("delivered", NOW - timedelta(days=4)))
    base.update(kw)
    return pol.OrderFacts(**base)


def conv(**kw):
    base = dict(conversation_type="order_support", allowed_tools=ALL)
    base.update(kw)
    return pol.ConversationFacts(**base)


def refund(amount, reason="damaged", currency="MXN"):
    return {"order_id": "A-1029", "amount": amount, "currency": currency, "reason": reason}


def ev(tool, args, o=None, c=None, aid="act_1"):
    return pol.evaluate(tool, args, auth=ME, order=o if o is not None else order(), conv=c or conv(),
                        action_id=aid, now=NOW)


# ---------------------------------------------------------------- dueño y lista permitida
def test_order_of_another_customer_looks_like_not_found():
    other = order(customer_id="cust-2")
    d1 = pol.evaluate("get_order", {"order_id": "A-1029"}, auth=ME, order=other, conv=conv(), action_id="a",
                      now=NOW)
    d2 = pol.evaluate("get_order", {"order_id": "A-9999"}, auth=ME, order=None, conv=conv(), action_id="a", now=NOW)
    # misma respuesta para "ajeno" e "inexistente": el agente no sirve para adivinar pedidos de otros
    assert d1 == d2
    assert d1.verdict is pol.Verdict.DENY and d1.reason == "order_not_found"


def test_tool_outside_conversation_toolset_is_denied():
    c = conv(conversation_type="general_question", allowed_tools=frozenset({"search_help_center"}))
    d = ev("issue_refund", refund(100.0), c=c)
    assert (d.verdict, d.reason) == (pol.Verdict.DENY, "tool_not_allowed")


# ---------------------------------------------------------------- estado del pedido
@pytest.mark.parametrize("status,verdict", [
    ("paid", pol.Verdict.ALLOW), ("preparing", pol.Verdict.ALLOW),
    ("shipped", pol.Verdict.DENY), ("delivered", pol.Verdict.DENY), ("cancelled", pol.Verdict.DENY),
])
def test_address_change_only_before_shipment(status, verdict):
    d = ev("update_shipping_address", {"order_id": "A-1029", "address": {}}, o=order(status=status))
    assert d.verdict is verdict


def test_cancel_before_shipment_needs_confirmation_then_allows():
    o = order(status="preparing", delivered_at=None, shipment=None)
    first = ev("cancel_order", {"order_id": "A-1029", "reason": "changed_mind"}, o=o)
    assert first.verdict is pol.Verdict.NEEDS_CONFIRMATION
    confirmed = ev("cancel_order", {"order_id": "A-1029", "reason": "changed_mind"}, o=o,
                   c=conv(confirmed_action_ids=frozenset({"act_1"})))
    assert confirmed.verdict is pol.Verdict.ALLOW


def test_return_label_window():
    assert ev("create_return_label", {}, o=order(delivered_at=NOW - timedelta(days=30))).allowed
    late = ev("create_return_label", {}, o=order(delivered_at=NOW - timedelta(days=31)))
    assert late.reason == "outside_window"


# ---------------------------------------------------------------- reembolsos: monto, moneda, uno por pedido
def test_small_refund_needs_confirmation_first_then_allows():
    # 450 MXN × 0.055 = 24.75 USD ≤ 50 → automático, pero SIEMPRE con confirmación del cliente
    d = ev("issue_refund", refund(450.0))
    assert d.verdict is pol.Verdict.NEEDS_CONFIRMATION and d.amount_usd == Decimal("24.75")
    d = ev("issue_refund", refund(450.0), c=conv(confirmed_action_ids=frozenset({"act_1"})))
    assert d.verdict is pol.Verdict.ALLOW


@pytest.mark.parametrize("amount,usd,verdict", [
    (909.09, "50.00", pol.Verdict.ALLOW),  # 49.99995 → 50.00 (HALF_UP): el límite es inclusivo
    (909.10, "50.00", pol.Verdict.ALLOW),  # 50.0005 → 50.00
    (909.20, "50.01", pol.Verdict.NEEDS_APPROVAL),  # 50.006 → 50.01 > 50
    (2400.0, "132.00", pol.Verdict.NEEDS_APPROVAL),
])
def test_auto_refund_limit_in_usd(amount, usd, verdict):
    d = ev("issue_refund", refund(amount), c=conv(confirmed_action_ids=frozenset({"act_1"})))
    assert d.amount_usd == Decimal(usd)
    assert d.verdict is verdict


def test_approval_routing_by_amount():
    cfg = pol.PolicyConfig()
    assert pol.route_approval(Decimal("132.00"), cfg) == "refunds-tier1"
    assert pol.route_approval(Decimal("200.00"), cfg) == "refunds-tier1"
    assert pol.route_approval(Decimal("200.01"), cfg) == "refunds-tier2"


def test_large_refund_needs_approval_and_then_allows():
    c = conv(confirmed_action_ids=frozenset({"act_1"}))
    d = ev("issue_refund", refund(2400.0), c=c)
    assert d.verdict is pol.Verdict.NEEDS_APPROVAL and d.approval_queue == "refunds-tier1"
    c = conv(confirmed_action_ids=frozenset({"act_1"}), approved_action_ids=frozenset({"act_1"}))
    assert ev("issue_refund", refund(2400.0), c=c).allowed


def test_approval_is_for_one_exact_action():
    # aprobaron act_1 (2,400); el modelo propone otro monto → otra acción (act_2) → otra vez confirmación
    c = conv(confirmed_action_ids=frozenset({"act_1"}), approved_action_ids=frozenset({"act_1"}))
    d = ev("issue_refund", refund(2300.0), c=c, aid="act_2")
    assert d.verdict is pol.Verdict.NEEDS_CONFIRMATION


@pytest.mark.parametrize("o,args,reason", [
    (order(), refund(2400.01), "amount_exceeds_order"),
    (order(refunded_total=Decimal("2000")), refund(500.0), "amount_exceeds_order"),
    (order(), refund(100.0, currency="USD"), "currency_mismatch"),
    (order(agent_refunds=1, refunded_total=Decimal("100")), refund(100.0), "agent_refund_limit"),
    (order(status="cancelled"), refund(100.0), "order_cancelled"),
])
def test_refund_denials(o, args, reason):
    c = conv(confirmed_action_ids=frozenset({"act_1"}), approved_action_ids=frozenset({"act_1"}))
    d = ev("issue_refund", args, o=o, c=c)
    # ni la confirmación ni la aprobación saltan una regla dura
    assert (d.verdict, d.reason) == (pol.Verdict.DENY, reason)


@pytest.mark.parametrize("o,reason,expected", [
    (order(delivered_at=NOW - timedelta(days=40)), "damaged", "outside_window"),
    (order(status="shipped", delivered_at=None, shipment=pol.ShipmentFacts("in_transit", NOW - timedelta(days=2))),
     "damaged", "not_delivered"),
    (order(), "not_received", "marked_delivered"),
    (order(status="shipped", delivered_at=None, shipment=pol.ShipmentFacts("in_transit", NOW - timedelta(days=3))),
     "not_received", "not_late_yet"),
])
def test_refund_reason_must_match_reality(o, reason, expected):
    d = ev("issue_refund", refund(100.0, reason=reason), o=o)
    assert d.reason == expected


@pytest.mark.parametrize("ship", [
    pol.ShipmentFacts("lost", NOW + timedelta(days=1)),
    pol.ShipmentFacts("in_transit", NOW - timedelta(days=8)),  # 8 > 7 días de gracia
])
def test_not_received_eligible_when_lost_or_very_late(ship):
    o = order(status="shipped", delivered_at=None, shipment=ship)
    assert ev("issue_refund", refund(100.0, reason="not_received"), o=o).verdict is pol.Verdict.NEEDS_CONFIRMATION


def test_injection_flag_sends_even_small_refunds_to_a_human():
    c = conv(confirmed_action_ids=frozenset({"act_1"}), injection_flagged=True)
    d = ev("issue_refund", refund(450.0), c=c)
    assert (d.verdict, d.reason) == (pol.Verdict.NEEDS_APPROVAL, "injection_flagged")


def test_unknown_currency_fails_loudly():
    with pytest.raises(ValueError):
        pol.to_usd(Decimal("10"), "XYZ", pol.PolicyConfig())


# ---------------------------------------------------------------- tope por cliente y score de riesgo
@pytest.mark.parametrize("facts,reason", [
    (dict(agent_refunds_last_90d=1), "customer_refund_cap"),  # 2.º reclamo, OTRO pedido, monto chico
    (dict(risk_score=0.93), "risk_score"),
])
def test_customer_level_signals_send_a_small_refund_to_people(facts, reason):
    d = ev("issue_refund", refund(Decimal("450.00")), o=order(**facts), c=conv(confirmed_action_ids={"act_1"}))
    assert d.verdict is pol.Verdict.NEEDS_APPROVAL and d.reason == reason


def test_customer_level_signals_below_threshold_stay_automatic():
    d = ev("issue_refund", refund(Decimal("450.00")), o=order(agent_refunds_last_90d=0, risk_score=0.2),
           c=conv(confirmed_action_ids={"act_1"}))
    assert d.verdict is pol.Verdict.ALLOW
