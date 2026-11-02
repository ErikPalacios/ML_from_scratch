"""Tests de contrato de statemachine.asl.json (solo biblioteca estándar + pytest).

asl-validator revisa la sintaxis de ASL. Estos tests revisan lo que un validador de sintaxis no ve y
que en producción se descubre con un documento atascado: que todo camino termine en un estado final,
que ningún error deje caer un documento, que cada ruta "$.x" que un estado lee exista en ESE camino,
y cuántas transiciones (= costo) tiene cada recorrido.
"""

import json
from pathlib import Path

import pytest

ASL_PATH = Path(__file__).resolve().parents[1] / "statemachine.asl.json"
ASL = json.loads(ASL_PATH.read_text(encoding="utf-8"))
STATES = ASL["States"]
MANUAL = "ToManualCapture"


def targets(state: dict) -> list[str]:
    out = [state[k] for k in ("Next", "Default") if k in state]
    out += [c["Next"] for c in state.get("Choices", [])]
    out += [c["Next"] for c in state.get("Catch", [])]
    return out


def test_tipo_standard_y_jsonpath():
    # waitForTaskToken no existe en Express; QueryLanguage explícito evita sorpresas si cambia el default.
    assert ASL["QueryLanguage"] == "JSONPath" and ASL["StartAt"] == "Init"


def test_todos_los_destinos_existen_y_todo_es_alcanzable():
    seen, todo = set(), [ASL["StartAt"]]
    while todo:
        name = todo.pop()
        if name in seen:
            continue
        assert name in STATES, f"destino inexistente: {name}"
        seen.add(name)
        todo += targets(STATES[name])
    assert seen == set(STATES), f"estados inalcanzables: {set(STATES) - seen}"


def test_los_unicos_finales_son_done_y_captura_manual():
    finals = {n for n, s in STATES.items() if s["Type"] in ("Succeed", "Fail") or s.get("End")}
    assert finals == {"Done", "SentToManualCapture"}


@pytest.mark.parametrize("name", [n for n, s in STATES.items() if s["Type"] == "Task" and n != MANUAL])
def test_ningun_error_tira_el_documento(name):
    catch = STATES[name]["Catch"]
    # States.ALL al final y hacia la captura manual; States.DataLimitExceeded EXPLÍCITO, porque
    # States.ALL no lo atrapa (documentado por AWS): sin esa línea, un estado de más de 256 KiB
    # hace fallar la ejecución sin pasar por ningún Catch.
    assert catch[-1] == {"ErrorEquals": ["States.ALL"], "ResultPath": "$.error", "Next": MANUAL}
    assert any(c["ErrorEquals"] == ["States.DataLimitExceeded"] for c in catch)


@pytest.mark.parametrize("name", [n for n, s in STATES.items() if s.get("Resource", "").endswith(".waitForTaskToken")])
def test_cada_callback_lleva_su_token_y_un_timeout(name):
    st = STATES[name]
    assert st["Parameters"]["MessageBody"]["task_token.$"] == "$$.Task.Token"
    assert st["TimeoutSeconds"] > 0  # sin timeout, un mensaje perdido espera hasta el límite de 1 año


@pytest.mark.parametrize("name", [n for n, s in STATES.items() if "Retry" in s and n != MANUAL])
def test_errores_permanentes_no_se_reintentan_y_no_hay_retry_ciego(name):
    retry = STATES[name]["Retry"]
    assert retry[0] == {"ErrorEquals": ["Doc.Unreadable", "Doc.InvalidInput"], "MaxAttempts": 0}
    assert all("States.ALL" not in r["ErrorEquals"] for r in retry)
    for r in retry[1:]:
        assert r.get("MaxAttempts", 3) <= 6 and r.get("BackoffRate", 2.0) >= 1.0


def test_revision_humana_heartbeat_y_timeout():
    hr = STATES["HumanReview"]
    assert hr["Resource"] == "arn:aws:states:::sqs:sendMessage.waitForTaskToken"
    assert hr["HeartbeatSeconds"] == 2 * 3600 and hr["TimeoutSeconds"] == 5 * 24 * 3600
    assert hr["HeartbeatSeconds"] < hr["TimeoutSeconds"]
    # La documentación de AWS nombra el vencimiento del heartbeat como States.HeartbeatTimeout y, en
    # otra parte, como States.Timeout: los dos van al mismo destino.
    assert hr["Catch"][0]["ErrorEquals"] == ["States.HeartbeatTimeout", "States.Timeout"]
    assert "Retry" not in hr  # reintentar = mandar OTRA tarea a la fila; mejor escalar a captura manual


def test_choices_con_default():
    for name, st in STATES.items():
        if st["Type"] == "Choice":
            assert "Default" in st, name


def test_sat_caido_degrada_y_no_cicla():
    v = STATES["Validate"]
    assert v["Catch"][0] == {"ErrorEquals": ["Sat.Unavailable"], "ResultPath": "$.sat_error", "Next": "SatUnverified"}
    sat_retry = next(r for r in v["Retry"] if r["ErrorEquals"] == ["Sat.Unavailable"])
    # 30 + 60 + 120 = 210 s como máximo antes de degradar (con jitter FULL, menos en promedio).
    assert sum(sat_retry["IntervalSeconds"] * sat_retry["BackoffRate"] ** i for i in range(sat_retry["MaxAttempts"])) == 210
    su = STATES["SatUnverified"]
    assert su["Result"] == "skip" and su["ResultPath"] == "$.opts.sat_mode" and su["Next"] == "Validate"


# ------------------------------------------------------------------------- nada de PII en el estado
# El historial de una ejecución Standard guarda la entrada y la salida de cada estado hasta 90 días
# después de cerrar (y CloudWatch Logs, si se activa includeExecutionData). Por eso los mensajes solo
# pueden leer estas rutas: llaves de S3, nombres, versiones y estados. Agregar una ruta nueva a esta
# lista es una decisión consciente ("¿esto puede traer un valor de campo?"), no un accidente.
ALLOWED_READS = {
    "$.document_id", "$.application_id", "$.declared_type", "$.received_at", "$.pages",
    "$.classify.doc_type", "$.text", "$.opts.sat_mode",
    "$.extract.fields_key", "$.validation.results_key",
    "$.route", "$.route.review_task_key", "$.review", "$.error",
}


def _reads(obj):
    if isinstance(obj, dict):
        for k, val in obj.items():
            if k.endswith(".$") and isinstance(val, str) and not val.startswith("$$."):
                yield k, val
            else:
                yield from _reads(val)
    elif isinstance(obj, list):
        for x in obj:
            yield from _reads(x)


@pytest.mark.parametrize("name", [n for n, s in STATES.items() if "MessageBody" in s.get("Parameters", {})])
def test_ningun_mensaje_lleva_valores_de_campos(name):
    reads = dict(_reads(STATES[name]["Parameters"]["MessageBody"]))
    assert "fields.$" not in reads and "state.$" not in reads and "review_task.$" not in reads
    assert "$" not in reads.values(), f"{name} manda el estado completo"
    extra = set(reads.values()) - ALLOWED_READS
    assert not extra, f"{name} lee rutas que pueden traer valores: {extra}"


def test_captura_manual_manda_referencias_y_no_el_estado():
    body = STATES[MANUAL]["Parameters"]["MessageBody"]
    assert set(body) == {"document_id.$", "execution.$", "pages.$", "error.$"}
    assert STATES["Init"]["Parameters"]["error"] is None  # existe en todos los caminos (también sin Catch)


# ------------------------------------------------------------------- flujo de datos por camino
def _paths_read(obj) -> set[str]:
    """Primer segmento de cada ruta '$.algo…' que un Parameters/MessageBody lee (no '$$.' del contexto)."""
    found = set()
    if isinstance(obj, dict):
        for k, val in obj.items():
            if k.endswith(".$") and isinstance(val, str) and val.startswith("$.") :
                found.add(val[2:].split(".")[0])
            else:
                found |= _paths_read(val)
    elif isinstance(obj, list):
        for x in obj:
            found |= _paths_read(x)
    return found


def walk(route: dict[str, str]) -> tuple[list[str], set[str]]:
    """Recorre la máquina eligiendo en cada Choice la rama de `route` y verifica que cada ruta leída
    exista en el estado en ese punto. Devuelve los estados visitados."""
    name, keys, visited = ASL["StartAt"], set(), []
    while True:
        st = STATES[name]
        visited.append(name)
        if name == "Init":
            keys = set(st["Parameters"])  # Init reconstruye el estado completo
            keys = {k[:-2] if k.endswith(".$") else k for k in keys}
        else:
            missing = _paths_read(st.get("Parameters", {})) - keys
            assert not missing, f"{name} lee rutas que no existen en este camino: {missing}"
        if st["Type"] in ("Succeed", "Fail"):
            return visited, keys
        if st["Type"] == "Choice":
            name = route[name]
            continue
        rp = st.get("ResultPath", "$")
        if rp and rp.startswith("$."):
            keys.add(rp[2:].split(".")[0])
        name = st["Next"]


ROUTES = {
    "xml_stp": {"AcquireText": "ReadCfdiXml", "IsStp": "Commit"},
    "texto_stp": {"AcquireText": "ReadTextLayer", "IsStp": "Commit"},
    "ocr_stp": {"AcquireText": "RunOcr", "IsStp": "Commit"},
    "ocr_revision": {"AcquireText": "RunOcr", "IsStp": "HumanReview"},
    "manual_desde_clasificacion": {"AcquireText": "ToManualCapture"},
    "ruta_desconocida": {"AcquireText": "RunOcr", "IsStp": "ToManualCapture"},
}


@pytest.mark.parametrize("label", ROUTES)
def test_cada_camino_lee_solo_rutas_que_existen(label):
    visited, _ = walk(ROUTES[label])
    assert visited[-1] in ("Done", "SentToManualCapture")


def test_transiciones_por_documento_y_costo():
    """Step Functions Standard cobra por transición de estado (≈ US$0.025 por 1,000; cada reintento
    cuenta). Cada estado visitado ≈ 1 transición: XML STP 9, OCR STP 10, OCR + revisión 11."""
    n = {k: len(walk(v)[0]) for k, v in ROUTES.items()}
    assert (n["xml_stp"], n["ocr_stp"], n["ocr_revision"]) == (9, 10, 11)
    monthly = 5000 * 30 * 10  # ≈ 10 por documento
    assert monthly == 1_500_000 and monthly / 1000 * 0.025 == pytest.approx(37.5)  # ≈ US$40/mes con reintentos


def test_xml_salta_extract():
    visited, _ = walk(ROUTES["xml_stp"])
    assert "Extract" not in visited and "RunOcr" not in visited  # el mejor modelo es el que no corres
