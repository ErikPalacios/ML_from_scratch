"""Tests de groundedness: el juez falso, los agregados, kappa a mano y la trampa del juez que siempre aprueba."""

import math

import pytest

from groundedness import KeywordJudge, Verdict, agreement, aggregate, cohen_kappa, prometheus_text

SOURCES = {1: "Un comprador puede pedir el reembolso hasta 30 días naturales después de la entrega confirmada.",
           2: "El reembolso vuelve al mismo medio de pago en 5 a 10 días hábiles."}


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_keyword_judge_on_supported_and_unsupported_claims():
    j = KeywordJudge()
    v = await j.judge("q", "El comprador puede pedir reembolso después de la entrega [1]. "
                           "El reembolso vuelve al medio de pago [2].", SOURCES)
    assert (v.supported_claims, v.total_claims, v.supporting_citations, v.total_citations) == (2, 2, 2, 2)
    v = await j.judge("q", "El vendedor paga el envío de regreso con una etiqueta prepagada [1].", SOURCES)
    assert v.supported_claims == 0 and not v.grounded


@pytest.mark.anyio
async def test_keyword_judge_limit_changed_number_passes():
    # "15 días" contra una fuente que dice "30 días": comparten casi todas las palabras. El juez falso lo aprueba;
    # un juez real tampoco es infalible: por eso se mide su falso pase contra personas.
    v = await KeywordJudge().judge("q", "Un comprador puede pedir el reembolso hasta 15 días naturales después "
                                        "de la entrega confirmada [1].", SOURCES)
    assert v.grounded


def test_aggregate():
    rep = aggregate([Verdict(2, 2, 2, 2), Verdict(1, 2, 1, 3), Verdict(0, 0, 0, 0)])
    assert rep.n == 3 and rep.faithfulness == pytest.approx((1.0 + 0.5) / 2)  # la de 0 afirmaciones no promedia
    assert rep.grounded_rate == pytest.approx(1 / 3) and rep.citation_precision == pytest.approx(3 / 5)


def test_kappa_matches_the_docstring_example():
    # 80 (bien, bien), 10 (mal, mal), 5 (bien, mal), 5 (mal, bien)
    judge = [True] * 80 + [False] * 10 + [True] * 5 + [False] * 5
    human = [True] * 80 + [False] * 10 + [False] * 5 + [True] * 5
    assert cohen_kappa(judge, human) == pytest.approx(0.155 / 0.255)  # ≈ 0.61
    a = agreement(judge, human)
    assert a.raw_agreement == 0.9 and a.false_pass_rate == pytest.approx(5 / 15)
    ok, reasons = a.gate(min_n=50)
    assert not ok and any("falso pase" in r for r in reasons)  # kappa alcanza; deja pasar 1/3 de las malas


def test_trap_a_judge_that_always_says_grounded():
    human = [True] * 90 + [False] * 10
    a = agreement([True] * 100, human)
    assert a.raw_agreement == 0.9  # "90 % de acuerdo"…
    assert a.kappa == 0.0 and a.false_pass_rate == 1.0  # …sin mirar nada: deja pasar TODAS las malas
    assert not a.gate(min_n=50)[0]


def test_kappa_undefined_when_both_raters_are_constant():
    assert math.isnan(cohen_kappa([True] * 5, [True] * 5))
    with pytest.raises(ValueError):
        cohen_kappa([True], [True, False])


def test_prometheus_text_for_the_canary_alert():
    txt = prometheus_text("canary", aggregate([Verdict(2, 2, 2, 2)] * 3 + [Verdict(0, 1, 0, 1)]), 0.9, 1790000000.0)
    assert 'rag_eval_groundedness{suite="canary"} 0.75' in txt
    assert 'rag_eval_items{suite="canary"} 4' in txt
    assert 'rag_eval_last_run_timestamp_seconds{suite="canary"} 1.79e+09' in txt
