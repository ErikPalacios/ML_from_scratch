"""Tests de agent/state.py: el step log durable, reanudar después de una caída y efectos exactly-once."""

import pytest

from agent.loop import SimulatedCrash
from agent.state import NotOwner, StepLog


def conf_id(events):
    return next(e.data["action_id"] for e in events if e.type == "confirmation_required")


def turn(h, loop, text, mid, **kw):
    return h.run(h.collect(loop.run_turn(conversation_id="conv-1", auth=h.ME, message_id=mid, text=text, **kw)))


def crash_at(point, tool=None):
    def hook(p, info):
        if p == point and (tool is None or info.get("tool") == tool):
            raise SimulatedCrash(p)
    return hook


# ---------------------------------------------------------------- el store solo
def test_step_ids_messages_and_owner(tmp_path):
    st = StepLog(str(tmp_path / "s.db"))
    st.open_conversation("c1", "cust-1", "order_support")
    assert st.register_message("c1", "m1") and not st.register_message("c1", "m1")  # dedupe de la entrada
    assert [st.append_step("c1", "m1", "note", {}) for _ in range(3)] == [1, 2, 3]
    with pytest.raises(NotOwner):
        st.open_conversation("c1", "cust-2", "order_support")  # la conversación de otro: no se abre
    st.close()


def test_compare_and_set_on_actions(tmp_path):
    st = StepLog(str(tmp_path / "s.db"))
    st.upsert_action("act_1", "c1", "issue_refund", {"amount": 1}, "m1", "pending_approval")
    assert st.set_action_status("act_1", "approved", expected=("pending_approval",), decided_by="sup")
    # el segundo webhook (reintento del sistema de aprobaciones) ya no encuentra la acción pendiente
    assert not st.set_action_status("act_1", "approved", expected=("pending_approval",), decided_by="sup")
    st.close()


# ---------------------------------------------------------------- caídas y reanudación
def test_crash_after_the_refund_but_before_logging_it_resumes_without_paying_twice(make_loop, backend, h):
    loop, *_ = make_loop([
        h.call("issue_refund", order_id="A-1029", amount=450.0, currency="MXN", reason="damaged")],
        crash_hook=crash_at("after_tool_before_log", "issue_refund"))
    ev1 = turn(h, loop, "A-1029 llegó roto", "m1")
    with pytest.raises(SimulatedCrash):
        turn(h, loop, "confirmo", "m2", confirm_action_id=conf_id(ev1))
    # el efecto pasó en el backend, pero el step log quedó con el paso "started": no sabemos el resultado
    assert len(backend.refunds) == 1

    # Otro proceso (otra instancia, el mismo archivo) retoma el turno incompleto
    loop2, llm2, store2, _ = make_loop([h.say("Listo, tu reembolso está emitido.")])
    assert store2.incomplete_turn("conv-1") == "m2"
    events = h.run(h.collect(loop2.resume("conv-1")))
    assert events[-1].data["outcome"] == "answered"
    assert len(backend.refunds) == 1  # exactly-once: el reenvío con la misma key devolvió el resultado guardado
    assert backend.calls.count("issue_refund") == 2
    step = [s for s in store2.steps("conv-1") if s.kind == "tool_call" and s.payload["name"] == "issue_refund"][-1]
    assert step.status == "completed" and step.payload["result"]["idempotent_replay"] is True
    assert store2.incomplete_turn("conv-1") is None


def test_crash_after_the_model_answered_does_not_ask_the_model_again(make_loop, backend, h):
    loop, *_ = make_loop([h.call("get_order", order_id="A-1029")], crash_hook=crash_at("after_llm_logged"))
    with pytest.raises(SimulatedCrash):
        turn(h, loop, "¿y A-1029?", "m1")
    loop2, llm2, store2, _ = make_loop([h.say("Tu pedido fue entregado.")])
    events = h.run(h.collect(loop2.resume("conv-1")))
    # la tool call registrada se ejecutó desde el log; el modelo solo se llamó para la respuesta final
    assert len(llm2.requests) == 1 and llm2.requests[0].messages[-1]["role"] == "tool"
    assert [e.type for e in events][-2:] == ["message", "done"]


def test_waiting_for_approval_survives_a_restart(make_loop, backend, h):
    loop, *_ = make_loop([
        h.call("issue_refund", order_id="A-1031", amount=2400.0, currency="MXN", reason="damaged"),
        h.say("Quedó en revisión.")])
    ev1 = turn(h, loop, "A-1031 llegó roto", "m1")
    ev2 = turn(h, loop, "confirmo", "m2", confirm_action_id=conf_id(ev1))
    aid = next(e for e in ev2 if e.type == "approval_pending").data["approval_id"]
    # horas después, en otro pod (nadie esperó en memoria): llega el webhook
    loop2, llm2, store2, _ = make_loop([])
    out = h.run(loop2.decide_approval(aid, approved=True, approver="sup-3"))
    assert out[-1].data["outcome"] == "answered" and len(backend.refunds) == 1
    assert llm2.requests == []  # el aviso es una plantilla: no se llamó al modelo


def test_business_seconds_for_the_approval_sla():
    from datetime import UTC, datetime

    from agent.state import business_seconds_between

    fri_5pm = datetime(2026, 10, 2, 23, 0, tzinfo=UTC)  # viernes 17:00 CDMX
    mon_10am = datetime(2026, 10, 5, 16, 0, tzinfo=UTC)  # lunes 10:00 CDMX
    assert business_seconds_between(fri_5pm, mon_10am) == 2 * 3600  # 1 h el viernes + 1 h el lunes
    thu_9am = datetime(2026, 10, 1, 15, 0, tzinfo=UTC)
    assert business_seconds_between(thu_9am, thu_9am.replace(hour=19)) == 4 * 3600  # 9:00 → 13:00
    assert business_seconds_between(mon_10am, fri_5pm) == 0.0


def test_next_message_finishes_a_crashed_turn_with_the_same_key(make_loop, backend, h):
    # Nadie llama a resume "a mano": el siguiente mensaje termina primero el turno caído, con su turn_id, así que
    # la key de update_shipping_address (que incluye el turno) es la misma y el efecto no se repite
    addr = {"street": "Calle 5", "interior": None, "city": "Cholula", "state": "PUE", "postal_code": "72760", "country": "MX"}
    loop, *_ = make_loop([h.call("update_shipping_address", order_id="A-1030", address=addr)],
                         crash_hook=crash_at("after_tool_before_log", "update_shipping_address"))
    with pytest.raises(SimulatedCrash):
        turn(h, loop, "Cambia la dirección de A-1030 a Cholula", "m1")
    loop2, llm2, store2, _ = make_loop([h.say("Listo, la dirección quedó en Cholula."), h.say("De nada.")])
    turn(h, loop2, "Gracias", "m2")
    keys = [a["key"] for a in backend.audit if a["op"] == "update_shipping_address"]
    assert len(set(keys)) == 1 and len(keys) == 1
    assert store2.incomplete_turn("conv-1") is None
