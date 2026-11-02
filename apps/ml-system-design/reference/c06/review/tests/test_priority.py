"""Tests de review/priority.py: prioridad por daño, aging, bienestar y routing según capacidad."""

import random

import pytest

import priority as p

NOW = 1_800_000_000.0


def item(i, policy="hate_harassment", sev="S2", prob=0.7, vph=100.0, age_s=0.0, source="proactive", **kw):
    return p.ReviewItem(f"i{i}", policy, sev, prob, vph, NOW - age_s, source=source, **kw)


def test_expected_views_example_from_docstring():
    assert p.expected_views(1200) == pytest.approx(3895, rel=1e-3)
    assert p.expected_views(0) == p.expected_views(p.MIN_VIEWS_PER_H)  # piso para posts recién creados
    # Horizonte infinito → v · h½ / ln 2 (todas las vistas que le quedan)
    assert p.expected_views(100, horizon_h=1e6) == pytest.approx(100 * 3 / 0.6931, rel=1e-3)


def test_viral_s2_outranks_quiet_s1_and_flips_when_s1_goes_viral():
    harass = item(1, prob=0.7, vph=1200)
    selfharm = item(2, policy="self_harm", sev="S1", prob=0.5, vph=20)
    assert p.harm_priority(harass) == pytest.approx(27_265, rel=1e-3)
    assert p.harm_priority(selfharm) == pytest.approx(3_246, rel=1e-3)
    assert p.priority_key(harass, NOW) > p.priority_key(selfharm, NOW)
    selfharm.views_last_hour = 500  # empieza a viralizarse
    assert p.priority_key(selfharm, NOW) > p.priority_key(harass, NOW)


def test_hard_sla_at_risk_jumps_the_queue():
    viral = item(1, prob=0.9, vph=50_000)
    report = item(2, policy="violence", sev="S1", prob=0.3, vph=5, age_s=46 * 60, source="user_report")
    assert p.sla_fraction(report, NOW) == pytest.approx(46 / 60)
    assert p.priority_key(report, NOW) > p.priority_key(viral, NOW)  # 77 % del SLA de 1 h: carril prioritario
    report.enqueued_at = NOW - 40 * 60  # 67 %: todavía no
    assert p.priority_key(report, NOW) < p.priority_key(viral, NOW)


def test_soft_sla_only_ages_and_does_not_block_viral_items():
    old_spam = item(1, policy="spam_scams", sev="S3", prob=0.85, vph=5, age_s=70 * 3600)
    viral = item(2, prob=0.7, vph=1200)
    assert p.priority_key(old_spam, NOW)[0] == 0  # S3 no tiene carril prioritario
    assert p.priority_key(viral, NOW) > p.priority_key(old_spam, NOW)
    fresh = item(3, policy="spam_scams", sev="S3", prob=0.85, vph=5)
    assert p.priority_key(old_spam, NOW) > p.priority_key(fresh, NOW)  # pero lo viejo sube (aging)


def test_wellbeing_graphic_cap_and_s0_specialists():
    pending = [item(i, policy="violence", sev="S1", graphic=True, vph=1000 - i) for i in range(5)]
    pending += [item(10 + i, vph=10) for i in range(5)]
    pending.append(item(99, policy="violent_extremism", sev="S0", prob=0.9, vph=10_000))
    mod = p.Moderator("m1", {"es"}, graphic_seen_this_shift=p.GRAPHIC_CAP_PER_SHIFT - 2)
    batch = p.next_batch(pending, mod, NOW, n=6)
    assert sum(i.graphic for i in batch) == 2  # le quedaban 2 en el turno
    assert all(i.severity != "S0" for i in batch)  # S0 solo especialistas
    specialist = p.Moderator("m2", {"es"}, s0_specialist=True)
    assert p.next_batch(pending, specialist, NOW, n=1)[0].item_id == "i99"
    assert all(p.blur_by_default(i) for i in pending if i.graphic)


def test_language_and_skip_items():
    pending = [item(1, language="pt"), item(2, language="es")]
    mod = p.Moderator("m1", {"es"}, skip_items={"i2"})
    assert p.next_batch(pending, mod, NOW) == []  # no habla portugués; i2 ya lo decidió (apelación → otra persona)


def test_queue_stats_sees_stuck_items():
    pending = [item(1, sev="S1", policy="violence", source="user_report", age_s=3000), item(2, age_s=10)]
    st = p.queue_stats(pending, NOW)
    assert st[("S1", "user_report")] == {"depth": 1, "oldest_age_s": 3000.0}


def test_capacity_from_case_numbers():
    assert p.review_capacity_per_day() == 216_000


def test_plan_thresholds_fits_capacity_and_equalizes_marginal_value():
    rng = random.Random(0)
    # Muestra del 1 % de un día: scores de etapa 1 ya filtrados (los que pasaron hash y no son triviales)
    scores = {
        "spam_scams": [rng.random() for _ in range(40_000)],
        "hate_harassment": [rng.random() for _ in range(20_000)],
        "violence": [rng.random() ** 3 for _ in range(300)],  # pocos y casi todos con score bajo
    }
    sev = {"spam_scams": "S3", "hate_harassment": "S2", "violence": "S1"}
    reserved = {"user_reports": 50_000, "appeals": 15_000, "prevalence_sample": 10_000, "qa_double_review": 5_000}
    plan = p.plan_review_thresholds(
        scores, sev, p.review_capacity_per_day(), sample_fraction=0.01, reserved_per_day=reserved
    )
    assert plan["expected_arrivals"]["violence"] == pytest.approx(100 * sum(1 for x in scores["violence"] if x >= 0.3))
    assert plan["expected_total"] <= 216_000 * 0.93  # ≤ ≈ 200k/día con todo lo reservado
    assert plan["expected_total"] > 216_000 * 0.93 - 1_000  # y usa la capacidad (no deja horas ociosas)
    t = plan["thresholds"]
    # S1 entra completa desde el piso (0.30); S2 llena el resto; S3 no entra: con peso 1, ningún spam
    # vale lo que el último post de odio admitido. Su revisión llega por lo reservado (QA, apelaciones).
    assert t["violence"] == 0.30
    assert 0.9 < t["hate_harassment"] < 1.0
    assert t["spam_scams"] == 1.0 and plan["expected_arrivals"]["spam_scams"] == 0
    assert t["hate_harassment"] * 10 == pytest.approx(plan["lambda"], rel=1e-3)  # mismo valor marginal


def test_plan_respects_min_threshold_when_capacity_is_plenty():
    scores = {"violence": [0.1, 0.2, 0.5, 0.9]}
    plan = p.plan_review_thresholds(scores, {"violence": "S1"}, 1e6)
    assert plan["thresholds"]["violence"] == 0.30  # sobra capacidad, pero no revisamos ruido
    assert plan["expected_arrivals"]["violence"] == 2


def test_plan_fails_loudly_when_reserved_exceeds_capacity():
    with pytest.raises(ValueError, match="faltan personas"):
        p.plan_review_thresholds({"violence": [0.9]}, {"violence": "S1"}, 1000, reserved_per_day={"reports": 5000})


def test_s1_threshold_never_rises_for_lack_of_capacity():
    """Con poca capacidad sube el umbral de S2/S3, nunca el de S1 (aunque λ / 100 lo subiría)."""
    scores = {"violence": [0.35] * 100 + [0.9] * 100, "hate_harassment": [0.5] * 1000 + [0.95] * 100}
    sev = {"violence": "S1", "hate_harassment": "S2"}
    plan = p.plan_review_thresholds(scores, sev, capacity_per_day=400 / 0.93)
    assert plan["thresholds"]["violence"] == 0.30 and plan["expected_arrivals"]["violence"] == 200
    assert plan["thresholds"]["hate_harassment"] > 0.5  # solo entran los 100 de 0.95
    assert plan["expected_total"] <= 400 + 1e-9
    with pytest.raises(ValueError, match="faltan personas"):
        p.plan_review_thresholds(scores, sev, capacity_per_day=150 / 0.93)  # ni S1 cabe
