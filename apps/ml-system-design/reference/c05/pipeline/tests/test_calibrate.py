"""Tests de calibrate_thresholds.py con datos cuyo resultado se puede calcular a mano."""

import csv
import math

import pytest
import yaml

import calibrate_thresholds as cal


# ------------------------------------------------------------------------------------------ Wilson
def test_wilson_ejemplos_del_docstring():
    assert cal.wilson_lower(1000, 1000) == pytest.approx(1000 / (1000 + 1.96**2))  # ≈ 0.9962
    assert cal.wilson_lower(990, 1000) == pytest.approx(0.98166, abs=1e-4)
    assert cal.wilson_lower(0, 0) == 0.0


def test_wilson_cero_errores_es_n_sobre_n_mas_z2():
    for n in (10, 765, 3838):
        assert cal.wilson_lower(n, n) == pytest.approx(n / (n + 1.96**2))


def test_minimos_sin_errores():
    assert cal.min_n_zero_errors(0.995) == 765
    assert cal.min_n_zero_errors(0.999) == 3838
    # Coherencia: con ese n la cota alcanza el objetivo; con uno menos, no.
    assert cal.wilson_lower(765, 765) >= 0.995 > cal.wilson_lower(764, 764)
    assert cal.wilson_lower(3838, 3838) >= 0.999 > cal.wilson_lower(3837, 3837)


def test_la_aproximacion_normal_engania_con_cero_errores():
    # Normal: p ± z·√(p(1−p)/n) con p = 1 → margen 0 → "100 %" con 10 ejemplos. Wilson no.
    p, n = 1.0, 10
    normal_lower = p - 1.96 * math.sqrt(p * (1 - p) / n)
    assert normal_lower == 1.0 and cal.wilson_lower(10, 10) < 0.73


# --------------------------------------------------------------------------------- elegir umbral
def rows(spec, doc_type="ine", field="curp", source="gold"):
    """spec = [(confianza, n_correctos, n_incorrectos), …] → filas con doc_id únicos."""
    out, i = [], 0
    for conf, ok, bad in spec:
        for correct in [True] * ok + [False] * bad:
            out.append(cal.Row(f"d{i}", doc_type, field, conf, correct, source))
            i += 1
    return out


def test_elige_el_umbral_mas_bajo_que_pasa():
    # 900 aciertos a 0.99 → cota ≈ 0.9957 ≥ 0.995: pasa con umbral 0.99.
    # + 100 a 0.90 con 5 errores → 995/1000, cota ≈ 0.9884: falla. El umbral queda en 0.99.
    data = rows([(0.99, 900, 0), (0.90, 95, 5)])
    t, n, k = cal.choose_threshold(data, 0.995, 1.96, 50)
    assert (t, n, k) == (0.99, 900, 900)


def test_no_cruza_una_franja_mala():
    # Bajo 0.99 hay una franja de 0.95 con 10 % de error; más abajo, 3,000 aciertos a 0.93 harían que
    # el conjunto completo vuelva a pasar (3,990/4,000, cota ≈ 0.9954). La regla no la cruza.
    data = rows([(0.99, 900, 0), (0.95, 90, 10), (0.93, 3000, 0)])
    assert cal.wilson_lower(3990, 4000) >= 0.995  # el conjunto completo "pasaría"…
    t, _, _ = cal.choose_threshold(data, 0.995, 1.96, 50)
    assert t == 0.99  # …pero el umbral no baja de la franja mala


def test_sin_datos_suficientes_queda_en_null():
    data = rows([(0.999, 500, 0)])  # 500 < 765: ni con cero errores alcanza 99.5 %
    res = cal.calibrate(data, 0.995, 0.999, set())
    assert res[0].threshold is None and res[0].status == "sin_datos"


def test_campo_critico_usa_el_objetivo_estricto():
    data = rows([(0.999, 2000, 0)])  # alcanza 99.5 % (≥ 765) pero no 99.9 % (< 3,838)
    assert cal.calibrate(data, 0.995, 0.999, set())[0].threshold == 0.999
    crit = cal.calibrate(data, 0.995, 0.999, {"curp"})[0]
    assert crit.threshold is None and crit.target == 0.999


def test_cobertura():
    data = rows([(0.99, 900, 0), (0.90, 95, 5)])
    r = cal.calibrate(data, 0.995, 0.999, set())[0]
    assert r.coverage == pytest.approx(0.9) and r.accuracy == 1.0


def test_holdout_confirma_o_anula():
    data = rows([(0.99, 4000, 0)])
    r = cal.calibrate(data, 0.995, 0.999, set(), confirm_frac=0.3)[0]
    assert r.status == "ok" and 1000 < r.confirm_n < 1400 and r.confirm_accuracy == 1.0
    # Si los errores se concentran en los documentos del split de confirmación, se anula.
    bad = [cal.Row(x.doc_id, x.doc_type, x.field, x.confidence, not cal.in_confirm_split(x.doc_id, 0.3), x.label_source)
           for x in data]
    r2 = cal.calibrate(bad, 0.995, 0.999, set(), confirm_frac=0.3)[0]
    assert r2.status == "no_confirmado" and r2.threshold is None


def test_el_split_es_por_documento():
    a = cal.in_confirm_split("doc-7", 0.3)
    assert all(cal.in_confirm_split("doc-7", 0.3) == a for _ in range(5))


# ------------------------------------------------------------------------------------ CSV y CLI
def write_csv(path, rows_, extra=None):
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["doc_id", "doc_type", "field", "confidence", "correct", "label_source"])
        for r in rows_:
            w.writerow([r.doc_id, r.doc_type, r.field, r.confidence, int(r.correct), r.label_source])
        for e in extra or []:
            w.writerow(e)


def test_las_correcciones_de_revision_se_ignoran_por_defecto(tmp_path):
    p = tmp_path / "e.csv"
    write_csv(p, rows([(0.99, 10, 0)]) + rows([(0.5, 0, 10)], source="review"))
    got = cal.read_rows(p, {"gold", "audit"})
    assert len(got) == 10 and all(r.label_source == "gold" for r in got)


@pytest.mark.parametrize("bad_row,msg", [
    (["x", "ine", "curp", "alta", "1", "gold"], "línea 2: confidence no numérica"),
    (["x", "ine", "curp", "1.5", "1", "gold"], "fuera de"),
    (["x", "ine", "curp", "0.9", "quizá", "gold"], "correct inválido"),
])
def test_csv_roto_falla_con_numero_de_linea(tmp_path, bad_row, msg):
    p = tmp_path / "e.csv"
    write_csv(p, [], extra=[bad_row])
    with pytest.raises(ValueError, match=msg):
        cal.read_rows(p, {"gold"})


def test_cli_escribe_yaml_compatible_con_routing(tmp_path, capsys):
    p, out = tmp_path / "e.csv", tmp_path / "u.yaml"
    write_csv(p, rows([(0.99, 900, 0), (0.90, 95, 5)]) + rows([(0.97, 800, 0)], field="nombre_completo"))
    rc = cal.main([str(p), "--confirm-frac", "0", "--critical-fields", "curp", "-o", str(out)])
    assert rc == 0
    y = yaml.safe_load(out.read_text(encoding="utf-8"))
    # curp es crítico: 900 aciertos no alcanzan 99.9 % → null. nombre_completo: 800 ≥ 765 → 0.97.
    assert y["thresholds"]["ine"] == {"curp": None, "nombre_completo": 0.97}
    err = capsys.readouterr().err
    assert "765 para 0.995" in err and "3838 para 0.999" in err
