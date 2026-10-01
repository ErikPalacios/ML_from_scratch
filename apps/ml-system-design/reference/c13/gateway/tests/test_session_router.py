"""Tests del session router: capacidad en sesiones y tope de streams, sticky, reconexión a otro worker, drain,
pérdida de un worker y rebalanceo."""

import pytest

from session_router import Move, NoCapacity, SessionRouter


def fleet(n=3, cap=4, strategy="spread"):
    r = SessionRouter(strategy)
    for i in range(1, n + 1):
        r.add_worker(f"w{i}", cap)
    return r


def counts(r):
    return {wid: len(w.sessions) for wid, w in sorted(r.workers.items())}


def test_spread_fills_evenly_pack_fills_one_first():
    r = fleet()
    for i in range(6):
        r.assign(f"s{i}")
    assert counts(r) == {"w1": 2, "w2": 2, "w3": 2}
    p = fleet(strategy="pack")
    for i in range(6):
        p.assign(f"s{i}")
    assert counts(p) == {"w1": 4, "w2": 2, "w3": 0}  # w3 queda vacío: se puede apagar sin migrar a nadie


def test_sticky_for_the_life_of_the_session():
    r = fleet()
    a = r.assign("meeting-1/ana")
    for i in range(5):
        r.assign(f"other-{i}")
    b = r.assign("meeting-1/ana")
    assert b.worker_id == a.worker_id and b.sticky and not a.sticky


def test_reconnect_after_overload_goes_to_another_worker():
    # Dos workers de 1,500 sesiones con 200 cada uno. El worker de s0 cerró con 1013 (su GPU no daba abasto):
    # al liberar s0 queda con un lugar más que el otro, y "spread" lo elegiría de nuevo. No vuelve ahí.
    r = fleet(n=2, cap=1500)
    for i in range(400):
        r.assign(f"s{i}")
    first = r.session_worker["s0"]
    again = r.assign("s0", reconnect=True)
    assert again.worker_id != first and again.reconnects == 1
    # El gateway puede nombrar el worker que falló aunque la sesión ya no figure en él
    assert r.assign("nueva", reconnect=True, exclude="w1").worker_id == "w2"
    # Con un solo worker con lugar, mejor el mismo que sin captions
    solo = fleet(n=1, cap=10)
    solo.assign("a")
    assert solo.assign("a", reconnect=True).worker_id == "w1"


def test_capacity_is_in_sessions_and_a_gpu_at_its_stream_cap_gets_nothing_new():
    # 1,500 sesiones por worker (≈ 30 % hablando → ≈ 450 streams). w1 reporta su GPU en el tope de streams:
    # tiene lugares de sesión, pero no recibe nada hasta que reporte menos.
    r = fleet(n=2, cap=1500)
    r.report_streams("w1", active_streams=450, stream_capacity=450)
    r.report_streams("w2", active_streams=100, stream_capacity=450)
    assert {r.assign(f"s{i}").worker_id for i in range(10)} == {"w2"}
    r.report_streams("w1", active_streams=300, stream_capacity=450)
    assert r.assign("s10").worker_id == "w1"  # más lugares de sesión libres
    # Empate en sesiones → el de menos streams activos
    t = fleet(n=2, cap=1500)
    t.report_streams("w1", active_streams=400, stream_capacity=450)
    t.report_streams("w2", active_streams=50, stream_capacity=450)
    assert t.assign("x").worker_id == "w2"


def test_no_capacity_is_an_explicit_error():
    r = fleet(n=2, cap=2)
    for i in range(4):
        r.assign(f"s{i}")
    with pytest.raises(NoCapacity):
        r.assign("s4")
    assert r.utilization() == 1.0


def test_draining_worker_gets_no_new_sessions_and_its_sessions_migrate():
    r = fleet(n=2, cap=10)
    for i in range(4):
        r.assign(f"s{i}")  # 2 y 2
    to_move = r.drain("w1")
    assert to_move == sorted(r.workers["w1"].sessions) and len(to_move) == 2
    for i in range(4, 8):
        assert r.assign(f"s{i}").worker_id == "w2"  # nada nuevo va a w1
    assert r.assign(to_move[0]).worker_id == "w1"  # sticky hasta su límite de utterance…
    moved = r.assign(to_move[0], reconnect=True)  # … y ahí el worker manda "migrate"
    assert moved.worker_id == "w2" and moved.reconnects == 1
    r.assign(to_move[1], reconnect=True)
    assert not r.workers["w1"].sessions
    r.remove_worker("w1")  # drenado y vacío: el scale-in termina
    assert counts(r) == {"w2": 8}


def test_worker_loss_reassigns_everything_it_can():
    r = fleet(n=3, cap=5)
    for i in range(9):
        r.assign(f"s{i}")  # 3, 3, 3: quedan 2 lugares libres en cada uno
    lost = sorted(r.workers["w2"].sessions)
    res = r.worker_lost("w2")
    assert sorted(res.moved) == lost and res.unplaced == []
    assert set(res.moved.values()) <= {"w1", "w3"}
    assert all(r.reconnects[s] == 1 for s in lost)
    assert counts(r) == {"w1": 5, "w3": 4}
    # Otra pérdida sin lugar: las sesiones quedan sin worker (captions no disponibles hasta que haya)
    res = r.worker_lost("w3")
    assert res.moved == {} and len(res.unplaced) == 4
    assert r.worker_lost("w-desconocido").moved == {}


def test_release_frees_the_slot_and_forgets_reconnects():
    r = fleet(n=1, cap=1)
    r.assign("s1")
    r.release("s1")
    assert r.assign("s2").worker_id == "w1"
    assert "s1" not in r.reconnects


def test_rebalance_after_scale_out_moves_a_bounded_number_at_boundaries():
    # Dos workers llevan horas llenos (20 de 20); el autoscaler agrega w3 (vacío). Las sesiones nuevas ya
    # irían a w3 por "spread", pero las reuniones duran horas: sin rebalanceo, w1 y w2 siguen al tope.
    r = SessionRouter()
    r.add_worker("w1", 20)
    r.add_worker("w2", 20)
    for i in range(40):
        r.assign(f"s{i}")
    r.add_worker("w3", 20)
    plan = r.plan_rebalance(high=0.9, low=0.6, max_moves=3)
    assert len(plan) == 3 and {m.to_worker for m in plan} == {"w3"}
    assert counts(r) == {"w1": 20, "w2": 20, "w3": 0}  # planear no mueve nada
    assert all(r.apply_move(m) for m in plan)
    assert counts(r) == {"w1": 19, "w2": 18, "w3": 3}  # alterna donantes: siempre el más cargado
    # Sin cota, el plan se detiene cuando nadie pasa del 90 % (18 de 20): falta 1 movimiento de w1
    rest = r.plan_rebalance(high=0.9, low=0.6, max_moves=100)
    assert [(m.from_worker, m.to_worker) for m in rest] == [("w1", "w3")]


def test_apply_move_is_skipped_when_the_world_changed():
    r = fleet(n=2, cap=10)
    r.assign("s1")
    m = Move("s1", r.session_worker["s1"], "w2" if r.session_worker["s1"] == "w1" else "w1")
    r.release("s1")
    assert r.apply_move(m) is False  # la sesión terminó antes de su límite de utterance
    r.assign("s2")
    m2 = Move("s2", r.session_worker["s2"], "w9")
    assert r.apply_move(m2) is False  # el destino ya no existe


def test_utilization_counts_draining_load_but_not_its_capacity():
    r = fleet(n=2, cap=10)
    for i in range(10):
        r.assign(f"s{i}")  # 5 y 5
    assert r.utilization() == 0.5
    r.drain("w1")
    assert r.utilization() == 1.0  # 10 activos ÷ 10 de capacidad que acepta: no hay colchón


def test_unknown_strategy():
    with pytest.raises(ValueError):
        SessionRouter("random")
