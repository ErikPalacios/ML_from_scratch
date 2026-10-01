"""Tests de routing.py con la configuración real (routing.yaml)."""

import copy
import datetime as dt
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
import yaml

import routing
from validators import ValidationResult

CONFIG_PATH = Path(__file__).resolve().parents[1] / "routing.yaml"
CFG = routing.load_config(CONFIG_PATH)
MX = ZoneInfo("America/Mexico_City")
# Miércoles 30 de septiembre de 2026, 10:00 en CDMX (UTC−6 todo el año desde 2022) = 16:00 UTC.
RECEIVED = dt.datetime(2026, 9, 30, 16, 0, tzinfo=dt.timezone.utc)


def fv(value, conf, source="ocr_printed", page=1):
    return {"value": value, "confidence": conf, "source": source, "page": page, "bbox": [0.1, 0.2, 0.4, 0.25]}


def ine_doc(**overrides):
    fields = {
        "nombre_completo": fv("JUANA PEREZ GOMEZ", 0.99),
        "curp": fv("PEGJ800101MDFRMN07", 0.999),
        "fecha_nacimiento": fv("01/01/1980", 0.99),
        "vigencia": fv("2031", 0.995),
    }
    fields.update(overrides)
    return {"document_id": "doc-1", "doc_type": "ine", "fields": fields}


def passing(doc_type, cfg=CFG):
    """Las validaciones requeridas de ese tipo, todas aprobadas (lo que manda una etapa validate sana)."""
    return [ValidationResult(c, True) for c in cfg.doc_types[doc_type].required_checks]


def decide(doc, validations=None, stage="evaluacion", received=RECEIVED, cfg=CFG):
    if validations is None:
        validations = passing(doc["doc_type"], cfg) if doc["doc_type"] in cfg.doc_types else []
    return routing.decide(doc, list(validations), cfg, loan_stage=stage, received_at=received)


def test_stp_cuando_todo_pasa():
    d = decide(ine_doc())
    assert d.decision == "stp" and d.review_task is None and d.config_version == CFG.version
    assert d.thresholds_version == CFG.doc_types["ine"].thresholds_version


# ------------------------------------------------------------------------------ falla cerrada
@pytest.mark.parametrize("conf", [float("nan"), float("inf"), "0.999", 1.5, -0.1, True])
def test_confianza_invalida_nunca_se_auto_acepta(conf):
    # nan < 0.995 es False: con el guard ingenuo (conf < umbral) un NaN pasaría a STP.
    d = decide(ine_doc(curp=fv("PEGJ800101MDFRMN07", conf)))
    assert d.decision == "review"
    flagged = d.review_task["flagged_fields"]
    assert [f["field"] for f in flagged] == ["curp"] and "inválida" in flagged[0]["reasons"][0]


def test_sin_confianza_va_a_revision():
    d = decide(ine_doc(curp=fv("PEGJ800101MDFRMN07", None)))
    assert d.decision == "review" and d.review_task["flagged_fields"][0]["reasons"][0].startswith("Sin confianza")


def test_lista_de_validaciones_vacia_no_es_todo_paso():
    d = decide(ine_doc(), validations=[])
    assert d.decision == "review" and d.review_task["flagged_fields"] == []
    assert d.review_task["doc_flags"] == [f"Falta la validación {c}." for c in CFG.doc_types["ine"].required_checks]


def test_falta_una_validacion_requerida_de_la_factura():
    fields = {k: fv(v, 1.0, source="xml", page=None) for k, v in {
        "uuid": "6F1D1A3C-0B5E-4C7A-9E2B-1A2B3C4D5E6F", "emisor_rfc": "EKU9003173C9",
        "receptor_rfc": "PSI200101AB3", "fecha": "2026-09-15", "subtotal": "10000.00", "total": "10901.25"}.items()}
    doc = {"document_id": "doc-5", "doc_type": "factura", "fields": fields}
    sin_sat = [r for r in passing("factura") if r.check != "sat_estatus"]
    d = decide(doc, sin_sat)
    assert d.decision == "review" and d.review_task["doc_flags"] == ["Falta la validación sat_estatus."]


def test_umbrales_de_otro_modelo_no_aplican():
    doc = ine_doc()
    doc["model_version"] = "ine-2026-10-01"  # un extractor nuevo con los umbrales del anterior
    d = decide(doc)
    assert d.decision == "review" and "Umbrales calibrados para" in d.review_task["doc_flags"][0]
    doc["model_version"] = CFG.doc_types["ine"].model_version
    assert decide(doc).decision == "stp"


# ------------------------------------------------------------------- versiones por tipo de documento
def test_cada_tipo_reporta_su_version_de_umbrales():
    versions = {t: c.thresholds_version for t, c in CFG.doc_types.items()}
    assert len(set(versions.values())) == len(versions)  # una por tipo, no una global
    assert versions["estado_cuenta"] == "edo-cta-umbrales-v7"  # el ejemplo de campo.json del caso
    review = decide(ine_doc(curp=fv("PEGJ800101MDFRMN07", 0.9)))
    assert review.review_task["thresholds_version"] == versions["ine"] != review.config_version


def test_revertir_un_tipo_no_toca_a_los_demas():
    raw = yaml.safe_load(CONFIG_PATH.read_text(encoding="utf-8"))
    rolled = copy.deepcopy(raw)
    rolled["doc_types"]["estado_cuenta"]["thresholds_version"] = "edo-cta-umbrales-v6"
    rolled["doc_types"]["estado_cuenta"]["thresholds"]["clabe"] = 0.999
    cfg2 = routing.parse_config(rolled)
    for doc in (ine_doc(), ine_doc(curp=fv("PEGJ800101MDFRMN07", 0.9))):
        a, b = decide(doc, cfg=CFG), decide(doc, cfg=cfg2)
        assert (a.decision, a.thresholds_version, a.review_task) == (b.decision, b.thresholds_version, b.review_task)
    assert cfg2.doc_types["estado_cuenta"].thresholds_version == "edo-cta-umbrales-v6"


@pytest.mark.parametrize("key", ["thresholds_version", "model_version", "required_checks"])
def test_config_sin_version_por_tipo_falla(key):
    raw = yaml.safe_load(CONFIG_PATH.read_text(encoding="utf-8"))
    del raw["doc_types"]["ine"][key]
    with pytest.raises(ValueError, match=key):
        routing.parse_config(raw)


def test_un_campo_bajo_umbral_va_a_revision_solo_con_ese_campo():
    d = decide(ine_doc(fecha_nacimiento=fv("01/01/1980", 0.95)))
    assert d.decision == "review"
    flagged = d.review_task["flagged_fields"]
    assert [f["field"] for f in flagged] == ["fecha_nacimiento"]
    assert flagged[0]["reasons"] == ["Confianza 0.950 < umbral 0.980."]
    assert flagged[0]["bbox"] == [0.1, 0.2, 0.4, 0.25] and flagged[0]["page"] == 1  # para el recorte


def test_ejemplo_del_docstring_confianza_y_cruce():
    cross = ValidationResult("curp_fecha_nacimiento", False, ("curp", "fecha_nacimiento"),
                             "La fecha de la CURP no coincide con la fecha de nacimiento impresa.")
    d = decide(ine_doc(fecha_nacimiento=fv("01/01/1980", 0.95)),
               [r for r in passing("ine") if r.check != "curp_fecha_nacimiento"] + [cross])
    flagged = {f["field"]: f for f in d.review_task["flagged_fields"]}
    assert set(flagged) == {"curp", "fecha_nacimiento"}
    assert len(flagged["fecha_nacimiento"]["reasons"]) == 2  # confianza + cruce, sin duplicar
    assert flagged["curp"]["critical"] is True
    assert d.review_task["flagged_fields"][0]["field"] == "curp"  # críticos primero


def test_campo_requerido_faltante():
    doc = ine_doc()
    del doc["fields"]["vigencia"]
    d = decide(doc)
    assert d.decision == "review"
    assert d.review_task["flagged_fields"][0]["reasons"] == ["No se encontró el campo."]


def test_campo_opcional_bajo_umbral_no_bloquea_stp():
    d = decide(ine_doc(domicilio=fv("CALLE 1 COL CENTRO", 0.99), clave_elector=fv("PRGMJN80010109M100", 0.90)))
    assert d.decision == "stp"
    assert d.unverified_fields == ["clave_elector", "domicilio"]  # domicilio: umbral null


def test_manuscrito_nunca_se_auto_acepta():
    doc = {"document_id": "doc-2", "doc_type": "solicitud", "fields": {
        "razon_social": fv("PYME SINTETICA SA DE CV", 0.99),
        "rfc": fv("PSI200101AB3", 0.999),
        "curp_representante": fv("PEGJ800101MDFRMN07", 0.999),
        "monto_solicitado": fv("250,000.00", 0.999, source="ocr_handwriting"),
        "plazo_meses": fv("24", 0.99),
    }}
    d = decide(doc)
    assert d.decision == "review"
    assert [f["field"] for f in d.review_task["flagged_fields"]] == ["monto_solicitado"]
    assert "manuscrito" in d.review_task["flagged_fields"][0]["reasons"][0].lower()


def test_xml_pasa_umbrales_pero_no_se_salta_validaciones():
    fields = {k: fv(v, 1.0, source="xml", page=None) for k, v in {
        "uuid": "6F1D1A3C-0B5E-4C7A-9E2B-1A2B3C4D5E6F", "emisor_rfc": "EKU9003173C9",
        "receptor_rfc": "PSI200101AB3", "fecha": "2026-09-15", "subtotal": "10000.00", "total": "10901.25"}.items()}
    doc = {"document_id": "doc-3", "doc_type": "factura", "fields": fields}
    assert decide(doc).decision == "stp"
    cancelado = ValidationResult("sat_estatus", False, (), "El SAT reporta el CFDI como Cancelado.")
    d = decide(doc, [r for r in passing("factura") if r.check != "sat_estatus"] + [cancelado])
    assert d.decision == "review" and d.review_task["flagged_fields"] == []
    assert d.review_task["doc_flags"] == ["El SAT reporta el CFDI como Cancelado."]


def test_tipo_desconocido_va_a_revision():
    d = decide({"document_id": "doc-4", "doc_type": "pasaporte", "fields": {}})
    assert d.decision == "review" and "sin configuración" in d.review_task["doc_flags"][0]


# ------------------------------------------------------------------------------------------- SLA
def mx(y, m, d, h, mi=0):
    return dt.datetime(y, m, d, h, mi, tzinfo=MX)


@pytest.mark.parametrize("start,expected", [
    (mx(2026, 9, 30, 10), mx(2026, 9, 30, 14)),   # miércoles 10:00 → 14:00
    (mx(2026, 10, 2, 17), mx(2026, 10, 5, 11)),   # viernes 17:00 → lunes 11:00 (2 h + 2 h)
    (mx(2026, 10, 3, 12), mx(2026, 10, 5, 13)),   # sábado → el reloj arranca el lunes 09:00
    (mx(2026, 9, 30, 7, 30), mx(2026, 9, 30, 13)),  # antes de abrir → 09:00 + 4 h
    (mx(2026, 9, 30, 22), mx(2026, 10, 1, 13)),   # después de cerrar → mañana 09:00 + 4 h
])
def test_horas_habiles(start, expected):
    assert routing.add_business_hours(start, 4, CFG.sla) == expected


def test_dias_festivos_de_la_config():
    raw = yaml.safe_load(CONFIG_PATH.read_text(encoding="utf-8"))
    raw["review_sla"]["holidays"] = ["2026-11-16"]  # lunes
    cfg = routing.parse_config(raw)
    assert routing.add_business_hours(mx(2026, 11, 13, 17), 4, cfg.sla) == mx(2026, 11, 17, 11)


def test_fecha_sin_zona_falla():
    with pytest.raises(ValueError):
        routing.add_business_hours(dt.datetime(2026, 9, 30, 10), 4, CFG.sla)


def test_prioridad_por_etapa_del_credito():
    late = decide(ine_doc(curp=fv("PEGJ800101MDFRMN07", 0.9)), stage="onboarding")
    urgent = decide(ine_doc(curp=fv("PEGJ800101MDFRMN07", 0.9)), stage="desembolso",
                    received=RECEIVED + dt.timedelta(hours=1))
    # Llegó una hora después, pero bloquea un desembolso: queda antes en la fila (bono de 120 min).
    assert urgent.review_task["sort_at"] < late.review_task["sort_at"]
    assert urgent.review_task["deadline"] > late.review_task["deadline"]  # el SLA no cambia


# ------------------------------------------------------------------------------------- auditoría
def test_auditoria_reproducible_y_cerca_del_2_por_ciento():
    picks = [routing.select_for_audit(f"doc-{i}", 0.02) for i in range(20000)]
    assert 0.017 < sum(picks) / len(picks) < 0.023
    assert routing.select_for_audit("doc-42", 0.02) == routing.select_for_audit("doc-42", 0.02)
    assert not routing.select_for_audit("doc-42", 0.0)


# ------------------------------------------------------------------------------------ config rota
def test_config_rota_falla_al_cargar():
    raw = yaml.safe_load(CONFIG_PATH.read_text(encoding="utf-8"))
    bad = copy.deepcopy(raw)
    bad["doc_types"]["ine"]["thresholds"]["curp"] = 1.5
    with pytest.raises(ValueError, match="fuera de"):
        routing.parse_config(bad)
    bad = copy.deepcopy(raw)
    del bad["doc_types"]["ine"]["thresholds"]["curp"]
    with pytest.raises(ValueError, match="sin umbral"):
        routing.parse_config(bad)


def test_lo_que_vuelve_a_step_functions_no_trae_valores():
    """El historial de ejecuciones guarda la entrada y la salida de cada estado (90 días tras cerrar):
    a SendTaskSuccess va state_summary(), y la decisión completa (con valores) a S3."""
    import json
    d = decide(ine_doc(curp=fv("PEGJ800101MDFRMN07", 0.9)))
    full = json.dumps(d.as_dict())
    assert "PEGJ800101MDFRMN07" in full  # la decisión completa sí trae el valor del campo marcado…
    summary = json.dumps(d.state_summary("s3://docs-derived/doc-1/route/v1.json"))
    for value in ("PEGJ800101MDFRMN07", "JUANA", "01/01/1980", "2031", "0.9"):
        assert value not in summary  # …el resumen no: ni valores ni confianzas
    s = d.state_summary("s3://docs-derived/doc-1/route/v1.json")
    assert s["decision"] == "review" and s["flagged_fields"] == ["curp"] and s["review_task_key"].startswith("s3://")
    assert decide(ine_doc()).state_summary("s3://x")["review_task_key"] is None  # STP: no hay tarea
    assert len(summary.encode()) < 4 * 1024


def test_contrato_con_la_maquina_de_estados():
    """El Choice IsStp de orchestration/statemachine.asl.json lee $.route.decision: los valores que
    produce decide() deben ser exactamente los que la máquina espera (si no, cae al Default)."""
    import json
    asl = json.loads((Path(__file__).resolve().parents[2] / "orchestration" / "statemachine.asl.json").read_text())
    choices = {c["StringEquals"] for c in asl["States"]["IsStp"]["Choices"]}
    produced = {decide(ine_doc()).state_summary()["decision"], decide(ine_doc(curp=fv("X", 0.1))).state_summary()["decision"]}
    assert produced == choices == {"stp", "review"}
