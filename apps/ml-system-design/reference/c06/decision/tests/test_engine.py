"""Tests del decision-engine contra el policies.yaml real (y variantes rotas a propósito)."""

import copy
from pathlib import Path

import pytest
import yaml

import engine as e

CFG_PATH = Path(__file__).resolve().parents[1] / "policies.yaml"


@pytest.fixture(scope="module")
def cfg():
    return e.load_config(CFG_PATH)


def raw():
    return yaml.safe_load(CFG_PATH.read_text(encoding="utf-8"))


def s1(text=None, image=None, version="txt-1"):
    """Resultados de etapa 1: dicts política → score."""
    out = []
    if text is not None:
        out.append(e.StageResult("stage1_text", version, text))
    if image is not None:
        out.append(e.StageResult("stage1_image", "img-1", image))
    return out


def decide(cfg, **kw):
    kw.setdefault("item_id", "p1")
    kw.setdefault("surface", "post")
    kw.setdefault("path", "sync")
    kw.setdefault("hash_hits", [])
    return e.decide(cfg, **kw)


# ---------------------------------------------------------------------------- config
def test_real_config_is_valid_and_has_7_policies(cfg):
    assert len(cfg["policies"]) == 7
    sevs = {p["severity"] for p in cfg["policies"].values()}
    assert sevs == {"S0", "S1", "S2", "S3"}


@pytest.mark.parametrize(
    "mutate, msg",
    [
        (lambda c: c["policies"]["hate_harassment"]["thresholds"]["post"].update(remove=0.5), "no puede tener umbral menor"),
        (lambda c: c["policies"]["spam_scams"]["thresholds"]["post"].update(delete=0.9), "acción desconocida"),
        (lambda c: c["policies"]["violence"]["thresholds"]["post"].update(review=1.5), r"fuera de \[0, 1\]"),
        (lambda c: c["fail_open"]["S1"].update(deep_scoring_priority="urgente"), "high o normal"),
        (lambda c: c["fail_open"]["S0"].update(allowed=True), "clave desconocida"),  # perilla que no existe
        (lambda c: c["stage_policies"]["stage1_image"].remove("adult_nudity"), "ningún modelo"),
        (lambda c: c["fallback_rules"][0].update(policy="adult_nudity"), "reglas son de TEXTO"),
        (lambda c: c["policies"]["self_harm"].update(deep_scoring_trigger=0.9), "deep_scoring_trigger"),
        (lambda c: c["hash_lists"]["own_removed"].update(max_distance=40), "max_distance"),
        (lambda c: c["regions"]["DE"]["hate_harassment"]["post"].update(remove=0.7), "no puede tener umbral menor"),
        (lambda c: c["fallback_rules"][0].update(action="remove"), "una regex no elimina"),
        (lambda c: c["fallback_rules"][0].update(pattern="(sin cerrar"), "no compila"),
        (lambda c: c.pop("version"), "version"),
        (lambda c: c["policies"]["violence"].pop("clause"), "clause"),
    ],
)
def test_broken_configs_are_rejected(tmp_path, mutate, msg):
    c = raw()
    mutate(c)
    p = tmp_path / "bad.yaml"
    p.write_text(yaml.safe_dump(c, allow_unicode=True), encoding="utf-8")
    with pytest.raises(e.ConfigError, match=msg):
        e.load_config(p)


def test_region_override_merges_only_changed_keys(cfg):
    assert e.thresholds_for(cfg, "hate_harassment", "post")["remove"] == 0.95
    de = e.thresholds_for(cfg, "hate_harassment", "post", region="DE")
    assert de["remove"] == 0.90 and de["reduce"] == 0.80  # lo demás, global


# ---------------------------------------------------------------------------- umbrales
@pytest.mark.parametrize(
    "score, path, expected",
    [
        (0.995, "sync", "block_prepublish"),
        (0.97, "sync", "reduce"),  # remove no aplica antes de publicar
        (0.97, "async", "remove"),
        (0.995, "async", "remove"),  # block_prepublish no aplica después de publicar
        (0.85, "async", "reduce"),
        (0.65, "async", "review"),
        (0.30, "async", "none"),
    ],
)
def test_action_for_score(cfg, score, path, expected):
    thr = e.thresholds_for(cfg, "hate_harassment", "post")
    assert e.action_for_score(thr, score, path) == expected


def test_clean_post_publishes_without_review(cfg):
    d = decide(cfg, stages=s1(text={"hate_harassment": 0.02, "spam_scams": 0.01}))
    assert (d.action, d.policy, d.needs_review, d.send_to_deep_scorer) == ("none", None, False, False)
    assert d.statement_of_reasons is None
    assert d.config_version == cfg["version"]


def test_review_band_publishes_and_goes_to_stage2(cfg):
    d = decide(cfg, stages=s1(text={"hate_harassment": 0.70}))
    assert d.action == "review" and d.needs_review and d.review_policies == ["hate_harassment"]
    assert d.send_to_deep_scorer and d.deep_scoring_priority == "normal"


def test_soft_action_confirmed_by_review(cfg):
    d = decide(cfg, stages=s1(text={"hate_harassment": 0.85}))
    assert d.action == "reduce" and d.needs_review  # review_confirms: [reduce]
    assert "se redujo su distribución" in d.statement_of_reasons


def test_text_or_image_max(cfg):
    d = decide(cfg, stages=s1(text={"adult_nudity": 0.1}, image={"adult_nudity": 0.995}))
    assert (d.action, d.policy) == ("block_prepublish", "adult_nudity")
    assert d.model_versions == {"stage1_text": "txt-1", "stage1_image": "img-1"}


def test_strongest_action_wins_over_severity(cfg):
    """Spam a 0.995 (block) y violencia a 0.6 (review): gana el bloqueo del spam."""
    d = decide(cfg, stages=s1(text={"spam_scams": 0.995, "violence": 0.6}))
    assert (d.action, d.policy, d.severity) == ("block_prepublish", "spam_scams", "S3")
    assert d.review_policies == []  # ya no se publica: nada que revisar


def test_same_action_more_severe_policy_wins(cfg):
    d = decide(cfg, path="async", stages=s1(text={"hate_harassment": 0.70, "self_harm": 0.45}))
    assert (d.action, d.policy) == ("review", "self_harm")
    assert d.review_policies == ["self_harm", "hate_harassment"]  # de más a menos grave


def test_surface_specific_thresholds(cfg):
    # adult_nudity no tiene umbrales para comentarios
    d = decide(cfg, surface="comment", stages=s1(text={"adult_nudity": 0.999}))
    assert d.action == "none"
    d = decide(cfg, surface="comment", stages=s1(text={"spam_scams": 0.985}))
    assert d.action == "block_prepublish"  # comentarios: 0.98 (posts: 0.99)


def test_region_override_changes_action(cfg):
    st = s1(text={"hate_harassment": 0.92})
    assert decide(cfg, path="async", stages=st).action == "reduce"
    assert decide(cfg, path="async", stages=st, region="DE").action == "remove"


# ---------------------------------------------------------------------------- hashes
def test_csam_hash_blocks_and_escalates_even_without_models(cfg):
    hit = e.HashHit("ncmec-1", "industry_csam", "csam", 12)
    d = decide(cfg, hash_hits=[hit], failed_stages={"stage1_text": "timeout", "stage1_image": "timeout"})
    assert (d.action, d.policy, d.severity, d.source) == ("block_prepublish", "csam", "S0", "hash")
    assert d.escalation == "s0_specialist_team" and not d.needs_review  # nunca a la cola general
    assert not d.send_to_deep_scorer
    assert d.hash_match == {"list": "industry_csam", "entry_id": "ncmec-1", "distance": 12}


def test_s0_escalation_comes_from_severity_not_from_the_list(cfg):
    """La re-subida de un CSAM que removimos NOSOTROS (own_removed) también va al equipo especializado."""
    own = e.HashHit("own-9", "own_removed", "csam", 2)
    d = decide(cfg, hash_hits=[own])
    assert (d.action, d.policy, d.escalation, d.needs_review) == ("block_prepublish", "csam", "s0_specialist_team", False)
    # Industria a distancia 30 + own_removed más cercano: gana own_removed, pero la escalación no se pierde
    # y el flujo especializado ve las dos entradas (el reporte legal necesita la de la industria)
    ind = e.HashHit("ncmec-1", "industry_csam", "csam", 30)
    for path in ("sync", "async"):
        d = decide(cfg, path=path, hash_hits=[ind, own])
        assert d.escalation == "s0_specialist_team" and d.hash_match["list"] == "own_removed"
        assert [h["entry_id"] for h in d.hash_matches] == ["own-9", "ncmec-1"]
    # Un hash S2 de own_removed no escala
    assert decide(cfg, hash_hits=[e.HashHit("own-1", "own_removed", "hate_harassment", 3)]).escalation is None


def test_hash_after_publication_is_remove(cfg):
    hit = e.HashHit("t-9", "industry_terror", "violent_extremism", 0)
    assert decide(cfg, path="async", hash_hits=[hit]).action == "remove"


def test_own_removed_list_is_stricter(cfg):
    near = e.HashHit("own-1", "own_removed", "hate_harassment", 12)
    far = e.HashHit("own-2", "own_removed", "hate_harassment", 25)  # ≤ 31 global, > 16 de esta lista
    assert decide(cfg, hash_hits=[near]).action == "block_prepublish"
    assert decide(cfg, hash_hits=[far]).action == "none"


def test_missing_hash_result_raises(cfg):
    with pytest.raises(e.HashCheckMissing):
        decide(cfg, hash_hits=None, stages=s1(text={"spam_scams": 0.1}))


# ---------------------------------------------------------------------------- fail-open
def test_fail_open_publishes_and_forces_stage2_with_high_priority(cfg):
    d = decide(cfg, failed_stages={"stage1_text": "timeout"}, text="hola")
    assert d.action == "none" and d.fail_open
    assert d.fail_open_reasons == ["stage1_text:timeout"]
    assert d.send_to_deep_scorer and d.deep_scoring_priority == "high"  # quedaron sin score S0/S1


def test_partial_failure_uses_available_scores(cfg):
    d = decide(cfg, stages=s1(image={"adult_nudity": 0.995}), failed_stages={"stage1_text": "error"})
    assert d.action == "block_prepublish" and d.fail_open


def test_fallback_rule_only_when_stage1_missing(cfg):
    text = "Mañana te voy a matar"
    d = decide(cfg, failed_stages={"stage1_text": "timeout"}, text=text)
    assert (d.action, d.policy, d.source) == ("reduce", "violence", "fallback_rule")
    assert d.needs_review and d.deep_scoring_priority == "high"
    d = decide(cfg, stages=s1(text={"violence": 0.05}), text=text)
    assert d.action == "none"  # con el modelo funcionando, manda el modelo (contexto: un chiste, una cita)


def test_fail_open_coverage_is_per_stage_not_per_policy(cfg):
    """Vence el modelo de TEXTO; el de imagen puntuó violencia gráfica baja. La amenaza escrita no la
    evaluó nadie: la regla de respaldo actúa y la prioridad sale de lo que cubría el texto (S1 → alta)."""
    img = s1(image={"violence": 0.02, "adult_nudity": 0.01})
    d = decide(cfg, stages=img, failed_stages={"stage1_text": "timeout"}, text="te voy a matar mañana")
    assert (d.action, d.policy, d.source) == ("reduce", "violence", "fallback_rule")
    assert d.review_policies == ["violence"] and d.deep_scoring_priority == "high"
    # Vence solo la imagen: el texto sí se evaluó, así que la regex de texto NO actúa
    d = decide(cfg, stages=s1(text={"violence": 0.05}), failed_stages={"stage1_image": "timeout"},
               text="te voy a matar mañana")
    assert d.action == "none" and d.fail_open and d.deep_scoring_priority == "high"  # quedó S1 de imagen sin ver


def test_async_stage2_replaces_stage1(cfg):
    """La etapa 1 vio odio a 0.85 (reduce); la 2, multimodal, ve que no: 0.10 → se levanta la restricción."""
    st = s1(text={"hate_harassment": 0.85}) + [e.StageResult("stage2", "deep-3", {"hate_harassment": 0.10})]
    d = decide(cfg, path="async", stages=st)
    assert d.action == "none" and d.scores["hate_harassment"] == 0.10
    assert not d.fail_open and not d.send_to_deep_scorer  # ya estamos en la etapa 2


# ---------------------------------------------------------------------------- statement of reasons
def test_statement_of_reasons_has_dsa_elements(cfg):
    d = decide(cfg, path="async", stages=s1(text={"hate_harassment": 0.97}), detection="user_report")
    sor = d.statement_of_reasons
    for piece in (
        "se eliminó",  # qué restricción
        "ya no es visible",  # alcance
        "Discurso de odio y acoso", "cláusula 3.1", cfg["policy_definitions_version"],  # motivo contractual
        "en todas las regiones",  # alcance territorial
        "Lo analizamos después de un reporte de otra persona",  # hechos (sin decir "revisamos": no hubo persona)
        "medios automatizados",  # automatización
        "revise esta decisión", "6 meses",  # reclamo interno
        "resolución extrajudicial", "tribunales",  # las otras vías
        cfg["version"],
    ):
        assert piece in sor, piece
    assert "Base legal" not in sor  # base contractual (las normas), no legal
    human = e.statement_of_reasons(cfg, d, detection="user_report", human_reviewed=True)
    assert "confirmó" in human and "medios automatizados" not in human


def test_regional_override_scopes_the_decision_and_cites_the_legal_ground(cfg):
    d = decide(cfg, path="async", stages=s1(text={"hate_harassment": 0.92}), region="DE")
    assert (d.action, d.territorial_scope) == ("remove", "DE")
    assert d.legal_ground and "solo en la región DE" in d.statement_of_reasons
    assert "Base legal en DE" in d.statement_of_reasons
    # A 0.97 se remueve igual sin el override: la base es contractual y el alcance, global
    d = decide(cfg, path="async", stages=s1(text={"hate_harassment": 0.97}), region="DE")
    assert (d.territorial_scope, d.legal_ground) == ("global", None)


def test_decision_is_serializable(cfg):
    import json

    d = decide(cfg, stages=s1(text={"violence": 0.9}))
    json.dumps(d.to_dict(), ensure_ascii=False)  # va a Kafka y al log tal cual


def test_unknown_policy_from_model_is_ignored(cfg):
    d = decide(cfg, stages=s1(text={"nueva_politica": 0.99}))
    assert d.action == "none" and "nueva_politica" not in d.scores


def test_config_not_mutated(cfg):
    before = copy.deepcopy(cfg)
    decide(cfg, region="DE", stages=s1(text={"hate_harassment": 0.92}))
    assert cfg == before


# ---------------------------------------------------------------------------- excepciones, shadow, id
def test_benign_exception_suppresses_model_but_not_hashes(cfg):
    exc = e.HashHit("meme-42", "benign_exceptions", "violence", 5)
    st = s1(text={"violence": 0.97})
    assert decide(cfg, path="async", stages=st).action == "remove"
    d = decide(cfg, path="async", stages=st, hash_hits=[exc])
    assert d.action == "none" and d.suppressed_by_exception == ["violence"]
    csam = e.HashHit("ncmec-1", "industry_csam", "csam", 0)
    assert decide(cfg, hash_hits=[exc, csam], stages=st).action == "block_prepublish"  # un hash nunca se anula


def test_shadow_policy_is_measured_not_enforced(cfg):
    c = copy.deepcopy(cfg)
    c["policies"]["spam_scams"]["mode"] = "shadow"
    d = decide(c, path="async", stages=s1(text={"spam_scams": 0.98}))
    assert d.action == "none" and d.shadow_actions == {"spam_scams": "remove"}
    assert not d.needs_review and d.statement_of_reasons is None


def test_exception_list_config_rules(tmp_path):
    c = raw()
    c["hash_lists"]["benign_exceptions"]["suppress_model_actions"] = False
    p = tmp_path / "bad.yaml"
    p.write_text(yaml.safe_dump(c, allow_unicode=True), encoding="utf-8")
    with pytest.raises(e.ConfigError, match="suppress_model_actions"):
        e.load_config(p)


def test_decision_id_is_deterministic(cfg):
    st = s1(text={"violence": 0.9})
    a, b = decide(cfg, stages=st), decide(cfg, stages=st)
    assert a.decision_id == b.decision_id and len(a.decision_id) == 24  # re-entrega → mismo id
    other = decide(cfg, stages=s1(text={"violence": 0.9}, version="txt-2"))
    assert other.decision_id != a.decision_id  # otro modelo → otra decisión
