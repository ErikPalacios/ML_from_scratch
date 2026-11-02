"""Tests de la política (umbrales, exploración, 3-D Secure) y del motor de reglas. Lógica pura, sin red."""

from pathlib import Path

import pytest
import yaml
from choose_thresholds import bayes_thresholds  # eval/choose_thresholds.py: de ahí salen los umbrales
from policy import decide, exploration_draw, load_policy, segment_of
from rules import Blocklists, RulesEngine
from service import looks_like_pan

POLICY_PATH = Path(__file__).resolve().parents[1] / "policy.yaml"


@pytest.fixture(scope="module")
def policy():
    return load_policy(POLICY_PATH)


def test_policy_thresholds_come_from_the_cost_formula(policy):
    """policy.yaml no inventa números: son bayes_thresholds() al ticket típico de cada segmento."""
    for name, seg in policy.segments.items():
        step, dec, no3ds = bayes_thresholds(seg.typical_ticket_usd)
        assert seg.step_up == pytest.approx(step, rel=0.02), name
        assert seg.decline == pytest.approx(dec, rel=0.02), name
        assert seg.no_3ds_decline == pytest.approx(no3ds, rel=0.02), name


def test_segments_by_mcc_group_and_ticket_band(policy):
    assert segment_of(policy, "5411", 2500) == "retail_low"  # supermercado, US$25
    assert segment_of(policy, "5816", 25000) == "digital_high"  # juegos digitales, US$250
    assert segment_of(policy, "4511", 10000) == "travel_high"  # aerolínea, exactamente US$100 → high


@pytest.mark.parametrize("score,expected,code", [
    (0.01, "approve", "APPROVED_LOW_RISK"),
    (0.10, "step_up", "MODEL_MEDIUM_RISK"),
    (0.95, "decline", "MODEL_HIGH_RISK"),  # ≥ max_score de exploración: nunca se explora
])
def test_model_bands(policy, score, expected, code):
    dec = decide(policy, "retail_low", score, [], "m_x", True, "p1")
    assert dec.decision == expected and code in dec.reason_codes


def test_the_same_score_means_different_actions_by_ticket(policy):
    # 0.2: step-up en un ticket de US$25, decline en uno de US$250 (con un id que no cae en exploración)
    pid = next(f"p{i}" for i in range(1000) if exploration_draw(policy.exploration_salt, f"p{i}") > 0.5)
    assert decide(policy, "retail_low", 0.2, [], "m_x", True, pid).decision == "step_up"
    assert decide(policy, "retail_high", 0.2, [], "m_x", True, pid).decision == "decline"


def test_rules_win_over_a_low_score(policy):
    dec = decide(policy, "retail_low", 0.001, [("decline", "BLOCKLIST_CARD")], "m_x", True, "p1")
    assert dec.decision == "decline" and "BLOCKLIST_CARD" in dec.reason_codes


def test_delayed_capture_merchant_gets_review_instead_of_model_decline(policy):
    dec = decide(policy, "travel_high", 0.5, [], "m_travel_001", True, "p1")
    assert dec.decision == "review" and "MANUAL_REVIEW_DELAYED_CAPTURE" in dec.reason_codes
    # una regla dura sigue declinando aunque el comercio tenga revisión manual
    hard = decide(policy, "travel_high", 0.5, [("decline", "BLOCKLIST_CARD")], "m_travel_001", True, "p1")
    assert hard.decision == "decline"


def test_fallback_action_is_per_segment(policy):
    assert decide(policy, "retail_low", None, [], "m_x", True, "p1").decision == "approve"
    assert decide(policy, "digital_high", None, [], "m_x", True, "p1").decision == "step_up"
    assert "FALLBACK_RULES_ONLY" in decide(policy, "retail_low", None, [], "m_x", True, "p1").reason_codes


def test_without_3ds_the_cut_is_approve_or_decline(policy):
    # retail_high: step-up desde 0.0053, sin 3DS se declina desde 0.0275
    low = decide(policy, "retail_high", 0.01, [], "m_x", False, "p1")
    high = decide(policy, "retail_high", 0.05, [], "m_x", False, "p1")
    assert low.decision == "approve" and "STEP_UP_UNAVAILABLE" in low.reason_codes
    assert high.decision == "decline"


def test_without_model_and_without_3ds_the_segment_decides(policy):
    """digital_high sin modelo hace step-up a todo; si la tarjeta no soporta 3DS, eso NO puede ser approve."""
    dh = decide(policy, "digital_high", None, [], "m_x", False, "p1")
    assert dh.decision == "decline" and "STEP_UP_UNAVAILABLE" in dh.reason_codes
    # en retail_high, una regla de step-up sin 3DS ni modelo se aprueba (fallback_no_3ds: approve)
    rh = decide(policy, "retail_high", None, [("step_up", "VELOCITY_IP_60S")], "m_x", False, "p1")
    assert rh.decision == "approve" and "VELOCITY_IP_60S" in rh.reason_codes


@pytest.mark.parametrize("score", [None, 0.02, 0.10, 0.6])
def test_the_3ds_result_is_decisive_whatever_the_score(policy, score):
    """La 2.ª llamada aplica el desafío: ni un modelo caído ni un score que se movió lo cambian."""
    failed = decide(policy, "retail_low", score, [], "m_x", True, "p1", "failed")
    assert failed.decision == "decline" and failed.reason_codes[-1] == "STEP_UP_FAILED"
    ok = decide(policy, "retail_low", score, [], "m_x", True, "p1", "authenticated")
    assert ok.decision == "approve" and ok.reason_codes == ("STEP_UP_AUTHENTICATED",)
    assert not failed.exploration and not ok.exploration  # la exploración se contó en la 1.ª llamada
    # una regla de review o decline sigue ganando; una de step-up, no (el desafío ya se hizo)
    assert decide(policy, "retail_low", score, [("decline", "BLOCKLIST_CARD")], "m_x", True, "p1",
                  "authenticated").decision == "decline"
    assert decide(policy, "retail_low", score, [("step_up", "VELOCITY_IP_60S")], "m_x", True, "p1",
                  "authenticated").decision == "approve"


def test_exploration_is_about_one_percent_deterministic_and_logged(policy):
    decisions = [decide(policy, "retail_low", 0.6, [], "m_x", True, f"pay_{i}") for i in range(20000)]
    explored = [x for x in decisions if x.exploration]
    assert 0.008 <= len(explored) / 20000 <= 0.012
    assert all(x.decision == "step_up" and x.propensity == 0.01 for x in explored)
    # determinista: el reintento del mismo pago recibe la misma decisión
    again = [decide(policy, "retail_low", 0.6, [], "m_x", True, f"pay_{i}") for i in range(200)]
    assert [x.exploration for x in again] == [x.exploration for x in decisions[:200]]


def test_exploration_never_overrides_a_rule_decline(policy):
    pid = next(f"p{i}" for i in range(10000) if exploration_draw(policy.exploration_salt, f"p{i}") < 0.01)
    assert decide(policy, "retail_low", 0.6, [], "m_x", True, pid).exploration is True
    ruled = decide(policy, "retail_low", 0.6, [("decline", "VELOCITY_CARD_60S")], "m_x", True, pid)
    assert ruled.decision == "decline" and ruled.exploration is False


def test_invalid_policy_does_not_load(tmp_path):
    raw = yaml.safe_load(POLICY_PATH.read_text())
    raw["segments"]["retail_low"]["step_up"] = 0.9  # step_up > decline
    bad = tmp_path / "policy.yaml"
    bad.write_text(yaml.safe_dump(raw))
    with pytest.raises(ValueError):
        load_policy(bad)
    raw = yaml.safe_load(POLICY_PATH.read_text())
    raw["segments"]["digital_high"]["fallback_no_3ds"] = "step_up"  # sin 3DS, step-up no existe
    bad.write_text(yaml.safe_dump(raw))
    with pytest.raises(ValueError):
        load_policy(bad)


# ------------------------------------------------------------------------------------------ reglas
def txn(**kw):
    return {"payment_id": "p1", "card_token": "tok_a", "device_hash": "dev_1", "ip_hash": "ip_1",
            "email_hash": "em_1", "merchant_id": "m_x", "amount_cents": 3000, "ip_country": "MX", **kw}


def test_blocklist_and_hard_limits(policy):
    engine = RulesEngine(policy, Blocklists(card=frozenset({"tok_bad"})))
    r = engine.evaluate(txn(card_token="tok_bad"), {"card_count_60s": 5, "ip_count_60s": 3})
    codes = {h.reason_code for h in r.hits}
    assert codes == {"BLOCKLIST_CARD", "VELOCITY_CARD_60S"}
    # 4 intentos previos: todavía no (at_least 5); y sin valor (contador caído) la regla no dispara
    assert engine.evaluate(txn(), {"card_count_60s": 4}).hits == []
    assert engine.evaluate(txn(), {"card_count_60s": None}).hits == []


def test_merchant_rules(policy):
    engine = RulesEngine(policy, Blocklists())
    big = engine.evaluate(txn(merchant_id="m_travel_001", amount_cents=350000), {})
    assert [(h.action, h.reason_code) for h in big.hits] == [("review", "MERCHANT_MAX_TICKET")]
    blocked = engine.evaluate(txn(merchant_id="m_games_042", ip_country="KP"), {})
    assert blocked.hits[0].reason_code == "MERCHANT_BLOCKED_COUNTRY"


def test_a_broken_rule_is_skipped_and_reported(policy):
    engine = RulesEngine(policy, Blocklists(card=frozenset({"tok_bad"})))
    # amount_cents con un tipo inesperado rompe la regla de ticket del comercio, no las demás
    r = engine.evaluate(txn(card_token="tok_bad", merchant_id="m_travel_001", amount_cents="mucho"), {})
    assert r.errors == ["merchant_max_ticket"]
    assert [h.reason_code for h in r.hits] == ["BLOCKLIST_CARD"]


def test_a_broken_hard_limit_does_not_stop_the_others(policy):
    """Un límite roto se salta y se reporta; los otros límites siguen evaluándose."""
    engine = RulesEngine(policy, Blocklists())
    r = engine.evaluate(txn(), {"card_count_60s": "no-es-un-número", "device_distinct_cards_1h": 6})
    assert r.errors == ["hard_limit_card_count_60s"]
    assert [(h.action, h.reason_code) for h in r.hits] == [("decline", "DEVICE_MANY_CARDS_1H")]


def test_pan_detection_uses_luhn():
    assert looks_like_pan("4111111111111111")  # el número de prueba clásico de Visa (pasa Luhn)
    assert not looks_like_pan("4111111111111112")  # un dígito distinto: no pasa
    assert not looks_like_pan("tok_9f2c1a77e0")
