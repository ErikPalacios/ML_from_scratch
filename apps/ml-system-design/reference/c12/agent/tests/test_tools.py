"""Tests de agent/tools.py: schemas para el LLM, idempotency keys y el executor con fallas inyectadas."""

import json
from decimal import Decimal

import pytest
from pydantic import ValidationError

from agent.tools import (
    REGISTRY,
    GetOrderArgs,
    GetShipmentTrackingArgs,
    TOOLSETS,
    IssueRefundArgs,
    SideEffect,
    ToolExecutor,
    UpdateShippingAddressArgs,
    idempotency_key,
    openai_tool,
    openai_tools,
)


# ---------------------------------------------------------------- el contrato con el modelo
def test_the_eight_tools_of_the_case_with_their_side_effect_class():
    assert {n: s.side_effect.value for n, s in REGISTRY.items()} == {
        "get_order": "read", "get_shipment_tracking": "read", "search_help_center": "read",
        "update_shipping_address": "write", "create_return_label": "write", "escalate_to_human": "write",
        "cancel_order": "money", "issue_refund": "money"}
    assert all(s.timeout_s == 3.0 for s in REGISTRY.values())
    assert [n for n, s in REGISTRY.items() if s.read_retries] == ["get_order", "get_shipment_tracking",
                                                                  "search_help_center"]


def _walk(node):
    yield node
    if isinstance(node, dict):
        for v in node.values():
            yield from _walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from _walk(v)


@pytest.mark.parametrize("name", sorted(REGISTRY))
def test_schemas_are_openai_strict_style(name):
    tool = openai_tool(REGISTRY[name])
    assert tool["type"] == "function" and tool["function"]["strict"] is True
    params = tool["function"]["parameters"]
    for node in _walk(params):
        if isinstance(node, dict):
            assert "$ref" not in node and "title" not in node
            if node.get("type") == "object":
                assert node["additionalProperties"] is False
                assert set(node["required"]) == set(node["properties"])  # strict: todo requerido


def test_no_tool_lets_the_model_choose_the_customer():
    fields = {k for t in openai_tools(TOOLSETS["order_support"]) for node in _walk(t["function"]["parameters"])
              if isinstance(node, dict) for k in node.get("properties", {})}
    assert not {f for f in fields if "customer" in f or "user" in f}  # el cliente sale de la sesión
    assert "order_id" in fields


def test_optional_fields_are_nullable_not_missing():
    addr = openai_tool(REGISTRY["update_shipping_address"])["function"]["parameters"]["properties"]["address"]
    assert {"type": "null"} in addr["properties"]["interior"]["anyOf"]


def test_tool_order_is_stable_for_prefix_caching():
    a = openai_tools(set(TOOLSETS["order_support"]))
    b = openai_tools(frozenset(reversed(sorted(TOOLSETS["order_support"]))))
    assert json.dumps(a) == json.dumps(b)


def test_schema_size_estimate():
    # Los 8 schemas son parte del prefijo compartido de cada llamada. Tamaño en caracteres (÷ 4 ≈ tokens en
    # inglés con un tokenizer BPE típico; mídelo con el tokenizer real del modelo)
    chars = len(json.dumps(openai_tools(TOOLSETS["order_support"])))
    assert 3_000 < chars < 7_000


# ---------------------------------------------------------------- validación de argumentos
@pytest.mark.parametrize("bad", [
    {"order_id": "A-1029", "amount": 10.0, "currency": "MXN", "reason": "damaged", "customer_id": "cust-2"},
    {"order_id": "1029; DROP TABLE", "amount": 10.0, "currency": "MXN", "reason": "damaged"},
    {"order_id": "A-1029", "amount": -5.0, "currency": "MXN", "reason": "damaged"},
    {"order_id": "A-1029", "amount": 10.005, "currency": "MXN", "reason": "damaged"},
    {"order_id": "A-1029", "amount": 10.0, "currency": "MXN", "reason": "because I said so"},
])
def test_refund_args_rejected(bad):
    with pytest.raises(ValidationError):
        IssueRefundArgs.model_validate(bad)


def test_amount_is_decimal_inside_the_code():
    a = IssueRefundArgs.model_validate({"order_id": "A-1029", "amount": 450.1, "currency": "MXN",
                                        "reason": "damaged"})
    assert a.amount_decimal == Decimal("450.10")  # Decimal(str(450.1)), no Decimal(450.1) = 450.1000000000000227…
    assert Decimal(450.1) != Decimal("450.1")


# ---------------------------------------------------------------- idempotency keys
def _refund(amount=450.0, order="A-1029"):
    return IssueRefundArgs(order_id=order, amount=amount, currency="MXN", reason="damaged")


def test_same_action_same_key_across_processes():
    k1 = idempotency_key("conv-1", "issue_refund", _refund(450))
    k2 = idempotency_key("conv-1", "issue_refund", _refund(450.0))  # 450 y 450.0: el mismo monto
    assert k1 == k2 and k1.startswith("c12_") and len(k1) == 52
    assert idempotency_key("conv-1", "issue_refund", _refund(451)) != k1  # otro monto, otra acción
    assert idempotency_key("conv-2", "issue_refund", _refund(450)) != k1  # otra conversación
    assert "A-1029" not in k1 and "conv-1" not in k1  # sin datos legibles: solo un hash


def test_address_key_is_per_turn_so_a_back_and_forth_is_not_swallowed():
    addr_a = {"street": "Calle 1 #2", "interior": None, "city": "Puebla", "state": "PUE",
              "postal_code": "72000", "country": "MX"}
    args = UpdateShippingAddressArgs.model_validate({"order_id": "A-1030", "address": addr_a})
    t1 = idempotency_key("c", "update_shipping_address", args, turn_id="m1")
    t3 = idempotency_key("c", "update_shipping_address", args, turn_id="m3")
    # A en el turno 1, B en el turno 2, A otra vez en el turno 3: con key por conversación, el turno 3 recibiría
    # el resultado guardado del turno 1 y la dirección se quedaría en B
    assert t1 != t3
    assert t1 == idempotency_key("c", "update_shipping_address", args, turn_id="m1")  # reanudar el turno: igual
    normalized = UpdateShippingAddressArgs.model_validate(
        {"order_id": "A-1030", "address": dict(addr_a, street="  CALLE 1   #2 ")})
    assert idempotency_key("c", "update_shipping_address", normalized, turn_id="m1") == t1


# ---------------------------------------------------------------- executor: reintentos y estado por key
def test_read_is_retried_once_after_a_timeout(backend, h):
    backend.inject("get_order", "timeout_before_commit")
    ex = ToolExecutor(backend, backoff_s=0.0, timeout_override_s=0.05)
    out = h.run(ex.execute("get_order", GetOrderArgs(order_id="A-1029"), auth=h.ME, conversation_id="c",
                           turn_id="t"))
    assert out.status == "ok" and out.attempts == 2


def test_read_gives_up_after_one_retry(backend, h):
    backend.inject("get_shipment_tracking", "error", "error")
    ex = ToolExecutor(backend, backoff_s=0.0, timeout_override_s=0.05)
    out = h.run(ex.execute("get_shipment_tracking", GetShipmentTrackingArgs(order_id="A-1029"), auth=h.ME,
                           conversation_id="c", turn_id="t"))
    assert (out.status, out.attempts) == ("error", 2)


def test_write_timeout_after_commit_is_recovered_by_key_not_repeated(backend, h):
    backend.inject("issue_refund", "timeout_after_commit")
    ex = ToolExecutor(backend, backoff_s=0.0, timeout_override_s=0.05)
    out = h.run(ex.execute("issue_refund", _refund(), auth=h.ME, conversation_id="c", turn_id="t"))
    assert out.status == "ok" and out.recovered and out.result["status"] == "issued"
    assert len(backend.refunds) == 1  # el reembolso se hizo UNA vez
    assert backend.calls.count("issue_refund") == 1  # y no se volvió a mandar: se preguntó el estado


def test_write_that_never_landed_is_resent_once_with_the_same_key(backend, h):
    backend.inject("issue_refund", "timeout_before_commit")
    ex = ToolExecutor(backend, backoff_s=0.0, timeout_override_s=0.05)
    out = h.run(ex.execute("issue_refund", _refund(), auth=h.ME, conversation_id="c", turn_id="t"))
    assert out.status == "ok" and out.attempts == 2
    assert len(backend.refunds) == 1
    assert list(backend.ops) == [out.idempotency_key]


def test_write_stuck_in_progress_is_unknown_and_not_retried(backend, h):
    backend.inject("issue_refund", "stuck_in_progress")
    ex = ToolExecutor(backend, backoff_s=0.0, timeout_override_s=0.05)
    out = h.run(ex.execute("issue_refund", _refund(), auth=h.ME, conversation_id="c", turn_id="t"))
    assert out.status == "unknown"  # el orquestador pasa a una persona para conciliar
    assert backend.calls.count("issue_refund") == 1 and backend.refunds == []


def test_retry_of_a_completed_write_replays_the_result(backend, h):
    ex = ToolExecutor(backend, backoff_s=0.0, timeout_override_s=0.2)
    first = h.run(ex.execute("issue_refund", _refund(), auth=h.ME, conversation_id="c", turn_id="t"))
    again = h.run(ex.execute("issue_refund", _refund(), auth=h.ME, conversation_id="c", turn_id="t"))
    assert again.result["refund_id"] == first.result["refund_id"] and again.result["idempotent_replay"]
    assert len(backend.refunds) == 1


def test_another_customers_order_is_not_found_in_the_backend_too(backend, h):
    ex = ToolExecutor(backend, backoff_s=0.0, timeout_override_s=0.2)
    out = h.run(ex.execute("issue_refund", _refund(order="A-2002"), auth=h.ME, conversation_id="c",
                           turn_id="t"))
    assert out.status == "not_found" and backend.refunds == []


def test_backend_rejects_what_it_must_never_accept(backend, h):
    ex = ToolExecutor(backend, backoff_s=0.0, timeout_override_s=0.2)
    out = h.run(ex.execute("issue_refund", _refund(amount=999_999.0), auth=h.ME, conversation_id="c",
                           turn_id="t"))
    assert (out.status, out.error) == ("rejected", "amount_exceeds_order")


def test_side_effect_enum_values_are_stable():
    assert [e.value for e in SideEffect] == ["read", "write", "money"]
