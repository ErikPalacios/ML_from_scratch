"""decision-engine del caso c06: de scores de la cascada a UNA acción explicable y auditable.

Entrada: lo que produjo cada etapa para un ítem (post o comentario).
  - etapa 0 `hash-match`: coincidencias contra listas de hashes (siempre local, nunca falta)
  - etapa 1 (síncrona, en el gateway): `stage1_text` y `stage1_image`, P(viola) por política
  - etapa 2 (asíncrona, `deep-scorer`): `stage2`, modelo multimodal más grande, solo ≈ 3 % de ítems
Salida: `Decision` = acción + política + severidad + scores + versiones + statement of reasons +
¿necesita revisión humana? + ¿va a la etapa 2? + si hubo fail-open y por qué.

Reglas (todas vienen de policies.yaml, versionado):
1. Hash de una lista conocida → acción inmediata (block_prepublish antes de publicar, remove después).
   Cualquier coincidencia válida con una política S0, venga de la lista que venga, escala al equipo
   especializado: la escalación sale de la SEVERIDAD, no de qué lista ganó.
2. Scores por política: en el síncrono, el MAX entre texto e imagen (el post viola si viola el texto
   O la imagen). En el asíncrono, el score de la etapa 2 REEMPLAZA al de la etapa 1 para las políticas
   que cubre: es el mejor modelo y ve texto + imagen juntos (un meme donde ninguno de los dos viola
   solo). Si se usara max(etapa 1, etapa 2), la etapa 2 nunca podría corregir un falso positivo.
3. Umbrales por política × superficie (× región) → la acción más fuerte cuyo umbral se alcanza.
4. Entre políticas: gana la ACCIÓN más fuerte; con empate, la política más severa; luego el score.
   Por qué no "la severidad primero": spam con 0.99 (remove) y violencia con 0.72 (review) → si
   mandara la severidad, el spam obvio quedaría publicado.
5. Fail-open: si falta una etapa remota, el ítem se publica con lo que haya y va a la etapa 2 con la
   prioridad de lo que quedó SIN EVALUAR. Qué quedó sin evaluar se calcula por ETAPA (stage_policies):
   si vence el modelo de texto, "violence" queda sin evaluar aunque el de imagen la haya puntuado
   (la imagen no ve una amenaza escrita), y las reglas de respaldo de texto se aplican. S0 no admite
   fail-open: si falta el hash, `decide` lanza `HashCheckMissing` (y por eso el hash es local).
6. Excepciones: un hash de la lista de clústeres benignos (un meme o un trend que el modelo confunde,
   confirmado por una persona) anula las acciones del MODELO para esa política. Nunca anula un hash.
7. Políticas en `mode: shadow` (una política nueva, o umbrales nuevos a medir): se calcula su acción y
   queda en `shadow_actions`, pero no se aplica ni cuenta para revisión.

Funciones puras (sin I/O salvo `load_config`): se prueban sin red, sin Triton y sin Kafka.
"""

from __future__ import annotations  # anotaciones como texto: sintaxis moderna sin costo en runtime

import hashlib  # decision_id determinista
import re  # reglas de respaldo (fallback_rules) del fail-open de S1
from collections.abc import Iterable, Mapping  # tipos de entrada
from dataclasses import asdict, dataclass, field  # resultados inmutables / serializables
from pathlib import Path  # ruta del YAML

import yaml  # PyYAML: safe_load, nunca load (un YAML no debe poder instanciar objetos de Python)

# ---------------------------------------------------------------------------- vocabulario fijo
# Acciones de la más fuerte a la más débil. El orden ES la regla de monotonía de los umbrales.
ACTIONS = ("block_prepublish", "remove", "age_gate", "interstitial", "reduce", "review", "none")
STRENGTH = {a: len(ACTIONS) - i for i, a in enumerate(ACTIONS)}  # block_prepublish = 7 … none = 1
SEVERITIES = ("S0", "S1", "S2", "S3")
SEV_RANK = {"S0": 3, "S1": 2, "S2": 1, "S3": 0}  # mayor = más grave
SURFACES = ("post", "comment")
STAGE1 = ("stage1_text", "stage1_image")  # etapas síncronas (remotas: Triton)
STAGE2 = "stage2"  # deep-scorer
S0_ESCALATION = "s0_specialist_team"  # flujo especializado (y reporte legal), fuera de la cola general
SYNC_ONLY = {"block_prepublish"}  # solo tiene sentido antes de publicar
ASYNC_ONLY = {"remove"}  # solo tiene sentido después de publicar
# Acciones que restringen el contenido de alguien → llevan statement of reasons (DSA art. 17 incluye
# también la "democión": reducir distribución cuenta).
RESTRICTIVE = {"block_prepublish", "remove", "age_gate", "interstitial", "reduce"}
ACTION_ES = {  # "Decisión sobre tu publicación: <esto>."
    "block_prepublish": "no se publicó",
    "remove": "se eliminó",
    "age_gate": "se restringió a personas adultas",
    "interstitial": "se muestra detrás de una pantalla de advertencia",
    "reduce": "se redujo su distribución",
}
SCOPE_ES = {
    "block_prepublish": "el contenido no se publicó y nadie puede verlo",
    "remove": "el contenido ya no es visible para nadie",
    "age_gate": "el contenido solo es visible para personas adultas",
    "interstitial": "el contenido sigue visible detrás de una pantalla de advertencia",
    "reduce": "el contenido sigue visible para quien lo busque o te siga, pero no se recomienda",
}
SURFACE_ES = {"post": "publicación", "comment": "comentario"}


class ConfigError(ValueError):
    """policies.yaml inválido. Se lanza al cargar: una config rota nunca llega a decidir."""


class HashCheckMissing(RuntimeError):
    """Falta el resultado de hash-match: sin él no hay garantía S0, así que no hay decisión."""


@dataclass(frozen=True)
class HashHit:
    """Una coincidencia de hash-match (el gateway convierte las de hashing/match.py a esto)."""

    entry_id: str
    list_name: str  # industry_csam · industry_terror · own_removed …
    policy: str  # política de la entrada (se usa con `policy: from_entry`)
    distance: int  # Hamming para PDQ; 0 para texto exacto o dominio


@dataclass(frozen=True)
class StageResult:
    """Scores de una etapa de modelos para UN ítem."""

    stage: str  # stage1_text · stage1_image · stage2
    model_version: str  # queda en la decisión: cada acción se puede atribuir a un modelo exacto
    scores: Mapping[str, float]  # política → P(viola) calibrada


@dataclass
class Decision:
    item_id: str
    surface: str
    path: str  # sync (pre-publicación, en el gateway) · async (deep-scorer, reportes, viralidad)
    action: str
    policy: str | None
    severity: str | None
    source: str  # hash · model · fallback_rule · none
    scores: dict[str, float]  # score final por política (el que se comparó contra los umbrales)
    config_version: str
    policy_definitions_version: str
    model_versions: dict[str, str]
    needs_review: bool
    review_policies: list[str] = field(default_factory=list)  # por qué se revisa, de más a menos grave
    fail_open: bool = False
    fail_open_reasons: list[str] = field(default_factory=list)  # p. ej. "stage1_text:timeout"
    send_to_deep_scorer: bool = False
    deep_scoring_priority: str | None = None  # high · normal
    escalation: str | None = None  # s0_specialist_team: fuera de la cola general
    hash_match: dict | None = None  # la coincidencia que decidió la acción
    # TODAS las coincidencias válidas (no solo la ganadora): el flujo especializado necesita, por
    # ejemplo, el id de la entrada de la lista de la industria aunque haya ganado una de own_removed
    hash_matches: list[dict] = field(default_factory=list)
    # Dónde aplica la acción: "global", o el código de región si fue un override regional (ley local)
    # lo que la cambió. enforcement la aplica solo ahí.
    territorial_scope: str = "global"
    legal_ground: str | None = None  # base legal del override regional (la cita el statement of reasons)
    # Políticas en modo shadow: qué acción HABRÍAN tomado (se mide, no se aplica)
    shadow_actions: dict[str, str] = field(default_factory=dict)
    # Políticas cuyo score de modelo se ignoró por una excepción (hash de un clúster benigno conocido)
    suppressed_by_exception: list[str] = field(default_factory=list)
    # Id determinista (ítem + camino + versión de config + versiones de modelo): una re-entrega de Kafka
    # produce el MISMO id, y enforcement deduplica por él (sin sanciones dobles)
    decision_id: str = ""
    statement_of_reasons: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)


# ---------------------------------------------------------------------------- config
def load_config(path: str | Path) -> dict:
    """Lee y valida policies.yaml. Lanza ConfigError con TODOS los problemas, no solo el primero."""
    cfg = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    errors = validate_config(cfg)
    if errors:
        raise ConfigError("policies.yaml inválido:\n- " + "\n- ".join(errors))
    return cfg


def _check_thresholds(where: str, thr: Mapping, errors: list[str]) -> None:
    """Acciones conocidas, valores en [0, 1] y monotonía: más fuerte ⇒ umbral ≥."""
    if not isinstance(thr, Mapping) or not thr:
        errors.append(f"{where}: umbrales vacíos o con formato inválido")
        return
    for action, value in thr.items():
        if action not in ACTIONS or action == "none":
            errors.append(f"{where}: acción desconocida '{action}'")
        elif not isinstance(value, (int, float)) or isinstance(value, bool) or not 0.0 <= value <= 1.0:
            errors.append(f"{where}.{action}: umbral fuera de [0, 1]: {value!r}")
    known = [(a, float(thr[a])) for a in ACTIONS if a in thr and isinstance(thr[a], (int, float))]
    for (a1, v1), (a2, v2) in zip(known, known[1:]):
        if v1 < v2:  # a1 es más fuerte que a2 y pide MENOS evidencia: config incoherente
            errors.append(f"{where}: '{a1}' ({v1}) no puede tener umbral menor que '{a2}' ({v2})")


def validate_config(cfg) -> list[str]:
    """Todas las reglas que una config debe cumplir antes de decidir sobre millones de posts."""
    errors: list[str] = []
    if not isinstance(cfg, Mapping):
        return ["el archivo no es un mapa YAML"]
    for key in ("version", "policy_definitions_version"):
        if not isinstance(cfg.get(key), str) or not cfg.get(key):
            errors.append(f"falta '{key}' (string): cada decisión debe poder atribuirse a una versión")
    surfaces = cfg.get("surfaces") or []
    if not set(surfaces) <= set(SURFACES) or not surfaces:
        errors.append(f"surfaces debe ser un subconjunto no vacío de {SURFACES}")

    fo = cfg.get("fail_open") or {}
    for sev in SEVERITIES:
        if not isinstance(fo.get(sev), Mapping):
            errors.append(f"fail_open.{sev} es obligatorio (al menos deep_scoring_priority)")
    for sev, conf in fo.items():
        if sev not in SEVERITIES or not isinstance(conf, Mapping):
            errors.append(f"fail_open.{sev}: severidad desconocida o formato inválido")
            continue
        # Claves conocidas y nada más: una perilla que el motor no lee (p. ej. un viejo "allowed") sería
        # una config que promete algo que no pasa
        for key in set(conf) - {"deep_scoring_priority", "fallback_rules"}:
            errors.append(f"fail_open.{sev}.{key}: clave desconocida (el motor no la usa)")
        if conf.get("deep_scoring_priority", "normal") not in ("high", "normal"):
            errors.append(f"fail_open.{sev}.deep_scoring_priority debe ser high o normal")

    policies = cfg.get("policies") or {}
    if not isinstance(policies, Mapping) or not policies:
        errors.append("no hay políticas")
        policies = {}
    for name, p in policies.items():
        where = f"policies.{name}"
        if not isinstance(p, Mapping):
            errors.append(f"{where}: formato inválido")
            continue
        if p.get("mode", "enforce") not in ("enforce", "shadow"):
            errors.append(f"{where}.mode debe ser enforce o shadow")
        if p.get("severity") not in SEVERITIES:
            errors.append(f"{where}.severity debe ser uno de {SEVERITIES}")
        for key in ("title", "clause"):
            if not p.get(key):
                errors.append(f"{where}.{key} es obligatorio (lo usa el statement of reasons)")
        if p.get("hash_only"):
            if p.get("thresholds"):
                errors.append(f"{where}: hash_only no lleva umbrales de modelo")
            continue
        thr_all = p.get("thresholds") or {}
        if not thr_all:
            errors.append(f"{where}: sin umbrales (o marca hash_only: true)")
        lows = []
        for surface, thr in thr_all.items():
            if surface not in surfaces:
                errors.append(f"{where}.thresholds: superficie desconocida '{surface}'")
                continue
            _check_thresholds(f"{where}.thresholds.{surface}", thr, errors)
            if isinstance(thr, Mapping):
                lows += [v for v in thr.values() if isinstance(v, (int, float))]
                for a in p.get("review_confirms") or []:
                    if a not in ACTIONS or a in ("review", "none"):
                        errors.append(f"{where}.review_confirms: '{a}' no es una acción automática")
        trig = p.get("deep_scoring_trigger")
        if not isinstance(trig, (int, float)) or not 0.0 <= trig <= 1.0:
            errors.append(f"{where}.deep_scoring_trigger debe estar en [0, 1]")
        elif lows and trig > min(lows):
            # Un ítem en la banda de revisión (o con acción automática) debe pasar por la etapa 2
            errors.append(f"{where}.deep_scoring_trigger ({trig}) mayor que su umbral más bajo ({min(lows)})")

    stage_pols = cfg.get("stage_policies") or {}
    if not isinstance(stage_pols, Mapping) or set(stage_pols) != set(STAGE1):
        errors.append(f"stage_policies debe tener exactamente {STAGE1}: sin eso no se sabe qué quedó sin evaluar")
    else:
        for st, pols in stage_pols.items():
            for pol in pols or []:
                if pol not in policies or (policies[pol] or {}).get("hash_only"):
                    errors.append(f"stage_policies.{st}: '{pol}' no es una política con modelo")
        covered = {pol for pols in stage_pols.values() for pol in pols or []}
        for name, p in policies.items():
            if isinstance(p, Mapping) and not p.get("hash_only") and name not in covered:
                errors.append(f"stage_policies: ningún modelo de la etapa 1 cubre '{name}'")

    for lname, lconf in (cfg.get("hash_lists") or {}).items():
        where = f"hash_lists.{lname}"
        if not isinstance(lconf, Mapping):
            errors.append(f"{where}: formato inválido")
            continue
        if lconf.get("policy") != "from_entry" and lconf.get("policy") not in policies:
            errors.append(f"{where}.policy desconocida: {lconf.get('policy')!r}")
        if lconf.get("action") not in ACTIONS:
            errors.append(f"{where}.action inválida: {lconf.get('action')!r}")
        elif (lconf.get("action") == "none") != bool(lconf.get("suppress_model_actions")):
            errors.append(f"{where}: action none va con suppress_model_actions: true (y solo ahí)")
        if "escalation" in lconf and (not isinstance(lconf["escalation"], str) or not lconf["escalation"]):
            errors.append(f"{where}.escalation (override opcional) debe ser un texto no vacío")
        md = lconf.get("max_distance")
        if not isinstance(md, int) or not 0 <= md <= 31:
            errors.append(f"{where}.max_distance debe ser un entero en [0, 31] (el índice no devuelve más)")

    text_pols = set((stage_pols.get("stage1_text") or []) if isinstance(stage_pols, Mapping) else [])
    for i, rule in enumerate(cfg.get("fallback_rules") or []):
        where = f"fallback_rules[{i}]"
        if rule.get("policy") not in policies:
            errors.append(f"{where}.policy desconocida")
        elif rule.get("policy") not in text_pols:
            errors.append(f"{where}: las reglas son de TEXTO y '{rule.get('policy')}' no está en stage_policies.stage1_text")
        if rule.get("action") not in ACTIONS or rule.get("action") in ("none", "block_prepublish", "remove"):
            errors.append(f"{where}.action debe ser suave (reduce, interstitial, review…): una regex no elimina")
        try:
            re.compile(rule.get("pattern") or "")
        except re.error as exc:
            errors.append(f"{where}.pattern no compila: {exc}")

    for region, overrides in (cfg.get("regions") or {}).items():
        for pname, by_surface in (overrides or {}).items():
            if pname not in policies:
                errors.append(f"regions.{region}: política desconocida '{pname}'")
                continue
            for surface, thr in (by_surface or {}).items():
                if surface == "legal_ground":
                    if not isinstance(thr, str) or not thr:
                        errors.append(f"regions.{region}.{pname}.legal_ground debe ser un texto no vacío")
                    continue
                base = ((policies[pname] or {}).get("thresholds") or {}).get(surface)
                if base is None:
                    errors.append(f"regions.{region}.{pname}: la superficie '{surface}' no tiene umbrales globales")
                    continue
                _check_thresholds(f"regions.{region}.{pname}.{surface}", {**base, **(thr or {})}, errors)

    sor = cfg.get("statement_of_reasons") or {}
    for key in ("norms_name", "appeal_url", "appeal_window"):
        if not sor.get(key):
            errors.append(f"statement_of_reasons.{key} es obligatorio")
    return errors


def thresholds_for(cfg: Mapping, policy: str, surface: str, region: str | None = None) -> dict[str, float]:
    """Umbrales efectivos: globales de la política y superficie + override de la región, si hay."""
    base = dict(((cfg["policies"][policy].get("thresholds") or {}).get(surface)) or {})
    if region:
        base.update((((cfg.get("regions") or {}).get(region) or {}).get(policy) or {}).get(surface) or {})
    return base


def _regional_rule(cfg: Mapping, policy: str, region: str | None) -> Mapping:
    return (((cfg.get("regions") or {}).get(region) or {}).get(policy) or {}) if region else {}


def action_for_score(thr: Mapping[str, float], score: float, path: str) -> str:
    """La acción más fuerte cuyo umbral alcanza `score`, saltando las que no aplican a este camino.

    Ejemplo (hate_harassment, post): {block_prepublish: .99, remove: .95, reduce: .80, review: .60}
      async, 0.97 → remove · sync, 0.97 → reduce (remove no aplica antes de publicar; la etapa 2 decide)
      sync, 0.995 → block_prepublish · 0.65 → review · 0.30 → none
    """
    skip = ASYNC_ONLY if path == "sync" else SYNC_ONLY
    for action in ACTIONS:  # de la más fuerte a la más débil
        if action in skip or action not in thr:
            continue
        if score >= thr[action]:
            return action
    return "none"


def _hash_action(action: str, path: str) -> str:
    """'remove' de una lista de hashes = no publicar (sync) o eliminar (async)."""
    if action == "remove" and path == "sync":
        return "block_prepublish"
    return action


# ---------------------------------------------------------------------------- decisión
def decide(
    cfg: Mapping,
    *,
    item_id: str,
    surface: str,
    path: str,
    hash_hits: Iterable[HashHit] | None,
    stages: Iterable[StageResult] = (),
    failed_stages: Mapping[str, str] | None = None,
    region: str | None = None,
    detection: str = "proactive",
    text: str | None = None,
) -> Decision:
    """Combina la cascada y devuelve la decisión. `failed_stages`: etapa → motivo (timeout, error…)."""
    if surface not in cfg["surfaces"]:
        raise ValueError(f"superficie desconocida: {surface}")
    if path not in ("sync", "async"):
        raise ValueError("path debe ser sync o async")
    if hash_hits is None:  # el hash no se puede saltar: sin él no hay garantía S0
        raise HashCheckMissing("falta el resultado de hash-match; S0 no admite fail-open")
    policies = cfg["policies"]
    failed = dict(failed_stages or {})
    stages = list(stages)
    model_versions = {s.stage: s.model_version for s in stages}

    # -- 1. scores por política
    stage1 = [s for s in stages if s.stage in STAGE1]
    stage2 = next((s for s in stages if s.stage == STAGE2), None)
    scores: dict[str, float] = {}
    for s in stage1:
        for pol, sc in s.scores.items():
            if pol in policies:  # un modelo que devuelve una política que la config no conoce: se ignora
                scores[pol] = max(scores.get(pol, 0.0), float(sc))
    if path == "async" and stage2 is not None:
        for pol, sc in stage2.scores.items():
            if pol in policies:
                scores[pol] = float(sc)  # REEMPLAZA a la etapa 1 (ver docstring, regla 2)

    # -- 2. candidatos: (acción, política, severidad, score, fuente)
    candidates: list[tuple[str, str, str, float, str]] = []
    best_hash, escalation, esc_rank = None, None, -1
    valid_hits: list[dict] = []
    suppressed: set[str] = set()
    for hit in hash_hits:
        lconf = (cfg.get("hash_lists") or {}).get(hit.list_name)
        if lconf is None or hit.distance > lconf["max_distance"]:
            continue  # lista desconocida, o demasiado lejos para ESTA lista (own_removed es más estricta)
        pol = hit.policy if lconf["policy"] == "from_entry" else lconf["policy"]
        if pol not in policies:
            continue
        if lconf.get("suppress_model_actions"):
            suppressed.add(pol)  # clúster benigno conocido: el MODELO no actúa sobre esta política
            continue
        sev = policies[pol]["severity"]
        valid_hits.append({"list": hit.list_name, "entry_id": hit.entry_id, "policy": pol, "distance": hit.distance})
        # Escalación por SEVERIDAD: un S0 escala aunque venga de own_removed o pierda contra otra
        # coincidencia más cercana. El override de la lista, si existe, solo cambia a quién.
        esc = lconf.get("escalation") or (S0_ESCALATION if sev == "S0" else None)
        if esc and SEV_RANK[sev] > esc_rank:
            escalation, esc_rank = esc, SEV_RANK[sev]
        key = (SEV_RANK[sev], -hit.distance)
        if best_hash is None or key > best_hash[0]:
            best_hash = (key, hit, pol, sev, _hash_action(lconf["action"], path))
    if best_hash is not None:
        _, hit, pol, sev, act = best_hash
        candidates.append((act, pol, sev, 1.0, "hash"))

    shadow: dict[str, str] = {}
    regional: dict[str, bool] = {}  # política → ¿el override regional cambió su acción?
    for pol, sc in scores.items():
        p = policies[pol]
        if p.get("hash_only") or pol in suppressed:
            continue
        act = action_for_score(thresholds_for(cfg, pol, surface, region), sc, path)
        if region:
            regional[pol] = act != action_for_score(thresholds_for(cfg, pol, surface), sc, path)
        if p.get("mode") == "shadow":
            shadow[pol] = act  # se registra para medir (cuántos ítems caerían en cada banda), no se aplica
        elif act != "none":
            candidates.append((act, pol, p["severity"], sc, "model"))

    # -- 3. fail-open: etapas que faltan
    fail_reasons = [f"{st}:{why}" for st, why in sorted(failed.items())]
    fail_open = bool(fail_reasons) and path == "sync"
    priority = None
    if fail_open:
        # Políticas que quedaron SIN EVALUAR: la unión de lo que cubría cada etapa que faltó. Por etapa y
        # no por política: si vence el texto, la imagen puede haber puntuado "violence" (violencia
        # gráfica), pero nadie miró la amenaza escrita. Una etapa desconocida → todo, por las dudas.
        stage_pols = cfg.get("stage_policies") or {}
        all_model = [n for n, p in policies.items() if not p.get("hash_only")]
        unscored: set[str] = set()
        for st in failed:
            unscored |= set(stage_pols.get(st, all_model))
        unscored = {n for n in unscored if n in policies and not policies[n].get("hash_only")}
        sevs = {policies[n]["severity"] for n in unscored} or {"S3"}
        prios = [(cfg["fail_open"].get(s) or {}).get("deep_scoring_priority", "normal") for s in sevs]
        priority = "high" if "high" in prios else "normal"
        # Las reglas de respaldo son regex de TEXTO: actúan cuando faltó el modelo de texto
        text_unscored = set(stage_pols.get("stage1_text", all_model)) if "stage1_text" in failed else set()
        for rule in cfg.get("fallback_rules") or []:
            pol = rule["policy"]
            sev = policies[pol]["severity"]
            if (text and pol in text_unscored and pol not in suppressed
                    and (cfg["fail_open"].get(sev) or {}).get("fallback_rules")):
                if re.search(rule["pattern"], text, flags=re.IGNORECASE):
                    candidates.append((rule["action"], pol, sev, 0.0, "fallback_rule"))

    # -- 4. ganadora: acción más fuerte → severidad → score
    candidates.sort(key=lambda c: (STRENGTH[c[0]], SEV_RANK[c[2]], c[3]), reverse=True)
    if candidates:
        action, policy, severity, _, source = candidates[0]
    else:
        action, policy, severity, source = "none", None, None, "none"

    # -- 5. revisión humana
    territorial_scope, legal_ground = "global", None
    if source == "model" and regional.get(policy):
        territorial_scope = region
        legal_ground = _regional_rule(cfg, policy, region).get("legal_ground")

    if action in ("block_prepublish", "remove"):
        review = []  # ya no es visible: los errores vuelven por apelación (otra persona revisa)
    else:
        review = []
        for act, pol, sev, _, src in candidates:
            confirms = policies[pol].get("review_confirms") or []
            if (act == "review" or act in confirms or src == "fallback_rule") and pol not in review:
                review.append(pol)  # ya ordenados de más a menos fuerte/grave
    if escalation:
        review = []  # S0 por hash: flujo especializado, nunca la cola general

    # -- 6. ¿etapa 2?
    send_deep = False
    if path == "sync" and action != "block_prepublish":
        triggered = any(
            sc >= policies[pol].get("deep_scoring_trigger", 1.0)
            for pol, sc in scores.items()
            if not policies[pol].get("hash_only") and policies[pol].get("mode") != "shadow"
        )
        send_deep = fail_open or triggered or bool(review)
        if send_deep and priority is None:
            worst = max((SEV_RANK[policies[p]["severity"]] for p in review), default=-1)
            priority = "high" if worst >= SEV_RANK["S1"] else "normal"
    if not send_deep:
        priority = None

    decision = Decision(
        item_id=item_id,
        surface=surface,
        path=path,
        action=action,
        policy=policy,
        severity=severity,
        source=source,
        scores={k: round(v, 4) for k, v in sorted(scores.items())},
        config_version=cfg["version"],
        policy_definitions_version=cfg["policy_definitions_version"],
        model_versions=model_versions,
        needs_review=bool(review),
        review_policies=review,
        fail_open=fail_open,
        fail_open_reasons=fail_reasons,
        send_to_deep_scorer=send_deep,
        deep_scoring_priority=priority,
        escalation=escalation,
        shadow_actions=shadow,
        suppressed_by_exception=sorted(suppressed),
        hash_match=(
            {"list": best_hash[1].list_name, "entry_id": best_hash[1].entry_id, "distance": best_hash[1].distance}
            if best_hash else None
        ),
        hash_matches=sorted(valid_hits, key=lambda h: (-SEV_RANK[policies[h["policy"]]["severity"]], h["distance"])),
        territorial_scope=territorial_scope,
        legal_ground=legal_ground,
    )
    decision.decision_id = hashlib.sha256(
        "|".join([item_id, path, cfg["version"], *(f"{k}={v}" for k, v in sorted(model_versions.items()))]).encode()
    ).hexdigest()[:24]
    if action in RESTRICTIVE:
        decision.statement_of_reasons = statement_of_reasons(cfg, decision, detection=detection)
    return decision


def statement_of_reasons(cfg: Mapping, d: Decision, *, detection: str = "proactive", human_reviewed: bool = False) -> str:
    """Texto para la persona afectada, en plantilla, con los elementos principales del art. 17 de la DSA:
    qué restricción y dónde, hechos, uso de medios automatizados, base contractual (y legal si un
    override regional decidió) y vías de reclamo. No es asesoría legal: el texto final lo aprueba legal.

    Para S0 el texto queda listo, pero CUÁNDO y SI se notifica lo decide el flujo especializado con
    legal: el motor no envía nada. La herramienta de revisión lo regenera con human_reviewed=True.
    """
    sor = cfg["statement_of_reasons"]
    p = cfg["policies"][d.policy]
    if detection == "user_report":
        # "analizamos", no "revisamos": sin human_reviewed, lo que actuó fue el sistema
        facts = "Lo analizamos después de un reporte de otra persona."
    else:
        facts = "Lo detectaron nuestros sistemas antes de que alguien lo reportara."
    if d.source == "hash":
        facts += " Coincide con contenido que ya habíamos identificado como contrario a esta política."
    automated = (
        "Una persona del equipo de revisión confirmó la decisión."
        if human_reviewed
        else "Esta decisión se tomó con medios automatizados, sin revisión humana previa."
    )
    where = "en todas las regiones" if d.territorial_scope == "global" else f"solo en la región {d.territorial_scope}"
    reason = (
        f"Motivo: incumple la política «{p['title']}» (cláusula {p['clause']}) de las {sor['norms_name']}, "
        f"versión {cfg['policy_definitions_version']}. "
    )
    if d.legal_ground:
        reason += f"Base legal en {d.territorial_scope}: {d.legal_ground}. "
    return (
        f"Decisión sobre tu {SURFACE_ES[d.surface]}: {ACTION_ES[d.action]}. Alcance: {SCOPE_ES[d.action]}, "
        f"{where}, mientras una apelación no revierta la decisión. "
        f"{reason}"
        f"Hechos: {facts} "
        f"{automated} "
        f"Cómo reclamar: puedes pedir que otra persona revise esta decisión en {sor['appeal_url']} "
        f"durante {sor['appeal_window']}. También puedes acudir a un órgano certificado de resolución "
        f"extrajudicial de litigios o a los tribunales. Referencia: {d.item_id} · config {d.config_version}."
    )
