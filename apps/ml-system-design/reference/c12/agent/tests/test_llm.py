"""Tests de agent/llm.py: el cliente del llm-gateway contra un gateway falso (httpx2.MockTransport)."""

import json

import httpx2
import pytest

from agent.llm import GatewayChatModel, LLMRequest, LLMResponse, LLMUnavailable


def sse(*objs, done=True):
    lines = [f"data: {json.dumps(o)}\n\n" for o in objs] + (["data: [DONE]\n\n"] if done else [])
    return "".join(lines).encode()


def chunk(delta=None, finish=None, usage=None):
    o = {"object": "chat.completion.chunk", "choices": [] if delta is None and finish is None else
         [{"index": 0, "delta": delta or {}, "finish_reason": finish}]}
    if usage:
        o["usage"] = usage
    return o


def model_with(handler):
    return GatewayChatModel("http://llm-gateway", "sk-test", transport=httpx2.MockTransport(handler))


async def drain(model, req):
    deltas, final = [], None
    async for item in model.stream(req):
        if isinstance(item, LLMResponse):
            final = item
        else:
            deltas.append(item)
    await model.aclose()
    return deltas, final


REQ = LLMRequest(messages=[{"role": "user", "content": "¿y mi pedido A-1029?"}],
                 tools=[{"type": "function", "function": {"name": "get_order", "parameters": {}}}], user="u_abc")


def test_request_body_and_tool_call_assembled_from_pieces(h):
    seen = {}

    async def handler(request: httpx2.Request) -> httpx2.Response:
        seen["auth"] = request.headers["authorization"]
        seen["body"] = json.loads(request.content)
        # la tool call llega en pedazos: id y nombre primero, argumentos en dos deltas
        body = sse(chunk({"role": "assistant"}),
                   chunk({"tool_calls": [{"index": 0, "id": "call_9", "type": "function",
                                          "function": {"name": "get_order", "arguments": ""}}]}),
                   chunk({"tool_calls": [{"index": 0, "function": {"arguments": "{\"order_id\": "}}]}),
                   chunk({"tool_calls": [{"index": 0, "function": {"arguments": "\"A-1029\"}"}}]}),
                   chunk(finish="tool_calls"),
                   chunk(usage={"prompt_tokens": 2400, "completion_tokens": 18}))
        return httpx2.Response(200, headers={"content-type": "text/event-stream"}, content=body)

    deltas, final = h.run(drain(model_with(handler), REQ))
    b = seen["body"]
    assert seen["auth"] == "Bearer sk-test"
    assert (b["model"], b["tool_choice"], b["parallel_tool_calls"], b["temperature"]) == \
        ("chat-default", "auto", False, 0)
    assert b["stream"] is True and b["stream_options"] == {"include_usage": True} and b["user"] == "u_abc"
    assert deltas == []
    assert [(c.id, c.name, json.loads(c.arguments)) for c in final.tool_calls] == \
        [("call_9", "get_order", {"order_id": "A-1029"})]
    assert (final.usage.prompt_tokens, final.usage.completion_tokens, final.finish_reason) == \
        (2400, 18, "tool_calls")


def test_text_is_streamed_as_deltas(h):
    async def handler(request):
        return httpx2.Response(200, content=sse(chunk({"content": "Tu pedido "}), chunk({"content": "llegó."}),
                                                chunk(finish="stop")))

    deltas, final = h.run(drain(model_with(handler), REQ))
    assert deltas == ["Tu pedido ", "llegó."] and final.content == "Tu pedido llegó." and final.tool_calls == []


def test_no_tools_means_no_tool_choice(h):
    m = GatewayChatModel("http://x", "k")
    b = m.body(LLMRequest(messages=[], tools=[]))
    h.run(m.aclose())
    assert "tools" not in b and "tool_choice" not in b and "parallel_tool_calls" not in b


@pytest.mark.parametrize("status,retry_after", [(429, "3"), (503, "1"), (502, None)])
def test_gateway_refusals_become_llm_unavailable(h, status, retry_after):
    async def handler(request):
        headers = {"retry-after": retry_after} if retry_after else {}
        return httpx2.Response(status, headers=headers, json={"error": {"message": "x"}})

    with pytest.raises(LLMUnavailable) as e:
        h.run(drain(model_with(handler), REQ))
    assert e.value.status == status
    assert e.value.retry_after == (float(retry_after) if retry_after else None)


def test_error_event_mid_stream(h):
    async def handler(request):
        return httpx2.Response(200, content=sse(chunk({"content": "Hola"}), {"error": {"type": "upstream"}},
                                                done=False))

    with pytest.raises(LLMUnavailable) as e:
        h.run(drain(model_with(handler), REQ))
    assert e.value.status == "stream_error"


def test_abort_without_text_is_a_failure(h):
    async def handler(request):  # defensivo: un abort sin texto (el gateway del C10 ya lo da como 502)
        return httpx2.Response(200, content=sse(chunk({"role": "assistant"}), chunk(finish="abort")))

    with pytest.raises(LLMUnavailable):
        h.run(drain(model_with(handler), REQ))


def test_connection_error(h):
    async def handler(request):
        raise httpx2.ConnectError("refused")

    with pytest.raises(LLMUnavailable) as e:
        h.run(drain(model_with(handler), REQ))
    assert e.value.status == "connect"
