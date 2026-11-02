"""Tests de la redacción de PII: qué atrapa, qué NO atrapa (a propósito, para que los límites queden escritos)."""

import json  # los argumentos de una tool call son JSON en texto

from pii import Redactor, clabe_ok, luhn_ok


def test_docstring_example():
    r = Redactor()
    out = r.redact("Soy Ana, mi correo es ana.p@mail.com y mi tel 55 1234 5678; la CLABE 002010077777777771")
    assert out == "Soy Ana, mi correo es [EMAIL_1] y mi tel [PHONE_1]; la CLABE [CLABE_1]"
    assert dict(r.counts) == {"EMAIL": 1, "PHONE": 1, "CLABE": 1}


def test_card_needs_luhn():
    r = Redactor()
    assert r.redact("tarjeta 4111 1111 1111 1111") == "tarjeta [CARD_1]"  # número de prueba que pasa Luhn
    assert r.redact("SKU 4111111111111112") == "SKU 4111111111111112"  # no pasa Luhn: se deja
    assert luhn_ok("4111111111111111") and not luhn_ok("4111111111111112")


def test_clabe_checksum():
    assert clabe_ok("002010077777777771")
    assert not clabe_ok("002010077777777772")


def test_curp_rfc_and_phone_with_country_code():
    r = Redactor()
    out = r.redact("CURP GODE561231HDFRRN09, RFC GODE561231GR8, cel +52 (55) 1234-5678")
    assert out == "CURP [CURP_1], RFC [RFC_1], cel [PHONE_1]"


def test_same_value_same_marker_coreference():
    r = Redactor()
    out = r.redact("escribe a ana@x.mx o a beto@x.mx; repito: ANA@x.mx")
    assert out == "escribe a [EMAIL_1] o a [EMAIL_2]; repito: [EMAIL_1]"  # el mismo correo, el mismo marcador


def test_limits_names_addresses_and_spelled_out_pii_pass_through():
    # Esto es lo que una regex NO hace. Si tu tenant tiene este tipo de PII, la regex no alcanza.
    r = Redactor()
    text = "Me llamo Ana Pérez, vivo en Av. Reforma 123, mi correo es ana punto p arroba mail punto com"
    assert r.redact(text) == text
    assert not r.counts


def test_order_number_is_over_redacted_as_phone():
    # Falla hacia el lado seguro (sobre-redacta), pero baja la calidad: medirlo es parte del trabajo
    assert Redactor().redact("pedido 5512345678") == "pedido [PHONE_1]"


def test_messages_text_parts_and_name_field():
    r = Redactor()
    msgs = [
        {"role": "user", "name": "ana_perez", "content": "mi correo: ana@x.mx"},
        {"role": "user", "content": [{"type": "text", "text": "tel 55 1234 5678"}, {"type": "image_url", "image_url": {"url": "u"}}]},
    ]
    out = r.redact_messages(msgs)
    assert out[0] == {"role": "user", "content": "mi correo: [EMAIL_1]"}  # sin "name"
    assert out[1]["content"][0]["text"] == "tel [PHONE_1]"
    assert out[1]["content"][1] == msgs[1]["content"][1]
    assert msgs[0]["content"] == "mi correo: ana@x.mx"  # el original no se toca


def test_tool_call_arguments_are_redacted_and_unknown_message_keys_dropped():
    # Lista PERMITIDA dentro de cada mensaje: los argumentos de una tool call suelen traer correos y teléfonos, y
    # un campo propio que agregue un cliente ("customer_id") no sale de la VPC
    r = Redactor()
    msgs = [
        {"role": "assistant", "content": None, "customer_id": "C-981", "tool_calls": [
            {"id": "1", "type": "function",
             "function": {"name": "buscar", "arguments": '{"email": "ana.p@mail.com", "tel": "5512345678"}'}}]},
        {"role": "tool", "tool_call_id": "1", "content": "pedido de ana.p@mail.com: enviado"},
    ]
    out = r.redact_messages(msgs)
    assert set(out[0]) == {"role", "content", "tool_calls"}
    args = json.loads(out[0]["tool_calls"][0]["function"]["arguments"])  # sigue siendo JSON válido
    assert args == {"email": "[EMAIL_1]", "tel": "[PHONE_1]"}
    assert out[0]["tool_calls"][0]["function"]["name"] == "buscar" and out[0]["tool_calls"][0]["id"] == "1"
    assert out[1] == {"role": "tool", "tool_call_id": "1", "content": "pedido de [EMAIL_1]: enviado"}
