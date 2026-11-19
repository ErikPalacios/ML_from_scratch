"""Revisa los criterios de «listo» de la estación, uno por check. No cambia nada (sí manda una alerta de prueba a
Alertmanager y vuelve a correr tu disparador sobre ayer, que no debe abrir nada nuevo).

    python verificar.py                    # todos (≈ 1 min)
    python verificar.py mundo reglas       # algunos

Necesita el mundo arriba (python mundo/crear.py) y el venv del kit. Lo que revisa es lo que corre (Prometheus,
Alertmanager, la Pushgateway, S3, el buscapersonas), no solo lo que escribiste: un archivo bien escrito que no se
recargó no pasa. Las reglas se prueban con promtool sobre días simulados, con pruebas que no ves.
"""
from __future__ import annotations

import json
import math
import subprocess
import sys
import tempfile
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mundo.comun import (ALERTMANAGER, BUCKET, BUSCAPERSONAS, ETIQUETADO, EVENTOS, LOGS, MONITOREO, NODO, OBS,  # noqa: E402
                         PREDICCIONES, amtool, ayer, compose, descargar, etiquetas, examen, http,
                         leer_json, objetos, plataforma, prom, prom1, prom_api, promtool, s3, sh)

RECORDING = ["classifier:error_ratio:rate5m", "classifier:error_ratio:rate30m", "classifier:error_ratio:rate1h",
             "classifier:error_ratio:rate6h", "classifier:low_confidence_share:rate30m"]
ALERTAS = {"ClassifierErrorBudgetFastBurn": "page", "ClassifierErrorBudgetSlowBurn": "ticket",
           "ClassifierLowConfidenceSpike": "ticket", "MonitoringJobStale": "ticket", "Watchdog": "none"}
SLO = {"slo": "disponibilidad"}   # las dos alertas del presupuesto lo llevan: la inhibición las junta por él
PRIMER_DIA = 32              # el primer día con 28 días de referencia: la historia tiene 60
PRIMER_DISPARO = 19          # el primer día con 14 días de resúmenes


class Falla(Exception):
    pass


def exige(cond, msg: str) -> None:
    if not cond:
        raise Falla(msg)


# ---------------------------------------------------------------- pruebas ocultas de promtool
def probar_reglas(pruebas: str) -> tuple[bool, str]:
    """Corre unas pruebas de promtool contra TU observabilidad/reglas.yml. (ok, lo que falló)."""
    (NODO / "pruebas").mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=NODO / "pruebas") as tmp:
        (Path(tmp) / "p.yml").write_text("rule_files: [/o/reglas.yml]\nevaluation_interval: 2m\n" + pruebas)
        r = promtool("test", "rules", "/t/p.yml", montajes={str(OBS): "/o", tmp: "/t"})
    texto = (r.stdout + r.stderr).strip()
    malos = [l.strip() for l in texto.splitlines() if l.strip().startswith(("name:", "alertname:", "expr:", "rule:"))
             or "error" in l.lower()]
    return r.returncode == 0, " | ".join(malos[:4]) or texto[-300:]


def sin_anotaciones(nombre: str) -> str:
    """Las pruebas de promtool comparan también las anotaciones; las ocultas usan las tuyas, tal como están."""
    for g in yaml.safe_load((OBS / "reglas.yml").read_text()).get("groups") or []:
        for x in g.get("rules") or []:
            if x.get("alert") == nombre:
                return json.dumps(x.get("annotations") or {}, ensure_ascii=False)
    return "{}"


def prueba_alerta(nombre: str, casos: list[tuple[str, str | None, dict | None]], entradas: str, intervalo: str) -> str:
    anot = sin_anotaciones(nombre)
    out = f"  - interval: {intervalo}\n    input_series:\n{entradas}    alert_rule_test:\n"
    for t, sev, extra in casos:
        if sev is None:
            out += f"      - {{eval_time: {t}, alertname: {nombre}, exp_alerts: []}}\n"
        else:
            etq = json.dumps({"severity": sev, **(extra or {})})
            out += (f"      - eval_time: {t}\n        alertname: {nombre}\n"
                    f"        exp_alerts: [{{exp_labels: {etq}, exp_annotations: {anot}}}]\n")
    return out


def serie(nombre: str, valores: str) -> str:
    return f"      - series: '{nombre}'\n        values: '{valores}'\n"


# ---------------------------------------------------------------- 1. el mundo
def check_mundo() -> str:
    r = compose("ps", "--format", "{{.Service}} {{.State}} {{.Health}}", timeout=30)
    estado = {l.split()[0]: l.split()[1:] for l in r.stdout.splitlines() if l.strip()}
    for s in ("s3", "prometheus", "alertmanager", "pushgateway"):
        exige(estado.get(s, ["?"])[0] == "running", f"el contenedor {s} no corre: python mundo/crear.py (o docker compose start {s})")
    from mundo.servicios import ORDEN, pid_de
    parados = [n for n in ORDEN if not pid_de(n)]
    exige(not parados, f"no corren: {', '.join(parados)} → python mundo/servicios.py arrancar")
    ups = {x["metric"].get("job"): ups_ for x in prom("up") if (ups_ := x["value"][1])}
    abajo = [x["metric"].get("pod", x["metric"].get("job")) for x in prom("up == 0")]
    exige(not abajo, f"Prometheus no puede leer: {', '.join(abajo)} (http://localhost:9962/targets)")
    for j in ("gateway", "triton", "pushgateway", "buscapersonas", "alertmanager", "prometheus"):
        exige(j in ups, f"Prometheus no tiene el objetivo {j} (http://localhost:9962/targets)")
    n = prom1('min(count_over_time(classifier_top1_score_count[8d]))', 0)
    exige(n > 9000, f"Prometheus tiene {n:.0f} muestras de los últimos 8 días por pod; la historia trae ≈ 11,500: python mundo/crear.py")
    d1 = ayer()
    faltan = [d for k in range(60) if not objetos(f"{PREDICCIONES}dt={(d := d1 - timedelta(days=k))}/")]
    exige(not faltan, f"faltan días de logs en S3 ({len(faltan)}, p. ej. {(faltan or [''])[0]}): python mundo/crear.py")
    return f"4 contenedores y 5 procesos arriba · 7 objetivos en Prometheus · 8 días de métricas · 60 días de logs hasta {d1}"


# ---------------------------------------------------------------- 2. las reglas cargadas
def check_reglas() -> str:
    exige((OBS / "reglas.yml").exists(), "falta observabilidad/reglas.yml")
    r = promtool("check", "rules", "/o/reglas.yml")
    exige(r.returncode == 0, f"promtool rechaza observabilidad/reglas.yml: {(r.stdout + r.stderr).strip()[-300:]}")
    grupos = prom_api("rules").get("data", {}).get("groups", [])
    cargadas = {x.get("name"): x for g in grupos for x in g["rules"]}
    faltan = [x for x in RECORDING if x not in cargadas]
    exige(not faltan, f"Prometheus no tiene cargadas estas recording rules: {', '.join(faltan)}. ¿Las escribiste con "
                      "ese nombre y corriste python mundo/recargar.py prometheus?")
    for n, sev in ALERTAS.items():
        exige(n in cargadas and cargadas[n]["type"] == "alerting", f"Prometheus no tiene cargada la alerta {n}")
        etq = cargadas[n].get("labels") or {}
        exige(etq.get("severity") == sev, f"{n} tiene severity «{etq.get('severity')}» y le toca «{sev}»")
        if n != "Watchdog":
            exige((cargadas[n].get("annotations") or {}).get("runbook_url"),
                  f"{n} no trae runbook_url: quien la recibe tiene que saber qué hacer")
    malas = [x["name"] for x in cargadas.values() if x.get("health") not in (None, "ok", "unknown")]
    exige(not malas, f"reglas con error al evaluarse: {', '.join(malas)} (http://localhost:9962/rules)")
    import hashlib
    r = compose("exec", "-T", "prometheus", "sha256sum", "/etc/prometheus/reglas.yml", timeout=20)
    exige(r.stdout.split()[:1] == [hashlib.sha256((OBS / "reglas.yml").read_bytes()).hexdigest()],
          "Prometheus ve otro reglas.yml que el tuyo: python mundo/recargar.py prometheus")
    return f"promtool OK · {len(RECORDING)} recording rules y {len(ALERTAS)} alertas cargadas, con severity y runbook"


# ---------------------------------------------------------------- 3. el burn rate
def check_burn_rate() -> str:
    ok_, err = "classifier_requests_total{code=\"200\"}", "classifier_requests_total{code=\"503\"}"
    cuatro = "classifier_requests_total{code=\"429\"}"
    p = "tests:\n"
    # el incidente de la lección: 0.1 % de fondo y 3 % del minuto 60 al 99
    p += prueba_alerta("ClassifierErrorBudgetFastBurn", [("86m", None, None), ("88m", "page", SLO),
                                                          ("106m", None, None)],
                       serie(ok_, "0+999x60 59940+970x40 98740+999x100") + serie(err, "0+1x60 60+30x40 1260+1x100")
                       + serie(cuatro, "0+400x200"), "1m")
    # 0.7 % durante 7 h: ticket, no page
    p += prueba_alerta("ClassifierErrorBudgetSlowBurn", [("420m", "ticket", SLO)],
                       serie(ok_, "0+993x420") + serie(err, "0+7x420"), "1m")
    p += prueba_alerta("ClassifierErrorBudgetFastBurn", [("420m", None, None)], serie(ok_, "0+993x420") + serie(err, "0+7x420"), "1m")
    # 0.5 %: β = 5, nada
    p += prueba_alerta("ClassifierErrorBudgetSlowBurn", [("420m", None, None)], serie(ok_, "0+995x420") + serie(err, "0+5x420"), "1m")
    # los 4xx no son culpa del servidor: un pico de 4xx no suena
    p += prueba_alerta("ClassifierErrorBudgetFastBurn", [("90m", None, None)],
                       serie(ok_, "0+999x90") + serie(err, "0+1x90") + serie(cuatro, "0+50x30 1500+5000x60"), "1m")
    # sin ningún 5xx, la fracción vale 0 (no «vacío»)
    p += ("  - interval: 1m\n    input_series:\n" + serie(ok_, "0+1000x20") + "    promql_expr_test:\n"
          + "".join(f"      - {{expr: 'classifier:error_ratio:rate{w}', eval_time: 20m, exp_samples: "
                    f"[{{labels: 'classifier:error_ratio:rate{w}', value: 0}}]}}\n" for w in ("5m", "30m", "1h", "6h")))
    ok, que = probar_reglas(p)
    exige(ok, f"las pruebas del burn rate no pasan con tus reglas: {que}. Pistas: el page es 14.4× en 1 h Y en 5 min, "
              "sin for; el ticket 6× en 6 h Y en 30 min; los 4xx no cuentan ni arriba ni abajo; sin 5xx la fracción vale 0")
    v = prom1("classifier:error_ratio:rate1h")
    exige(v is not None, "classifier:error_ratio:rate1h no tiene valor en vivo (¿hay tráfico? ¿recargaste? sin 5xx vale 0)")
    sonando = prom('ALERTS{alertname="ClassifierErrorBudgetFastBurn", alertstate="firing"}')
    exige(not sonando, "ClassifierErrorBudgetFastBurn está sonando ahora: hay un incendio (python mundo/capas.py)")
    return f"el 3 % de la lección suena entre el min 27 y 28 y se apaga ≈ 2 min después del arreglo · 0.7 % → ticket · 0.5 % → nada · sin 5xx vale 0 · en vivo {v / 0.001:.1f}× en 1 h, sin page"


# ---------------------------------------------------------------- 4. la baja confianza
def check_baja_confianza() -> str:
    b, c = "classifier_top1_score_bucket{le=\"0.3\"}", "classifier_top1_score_count"
    p = "tests:\n"
    p += prueba_alerta("ClassifierLowConfidenceSpike", [("7d", None, None), ("7d40m", None, None), ("7d1h50m", "ticket", None)],
                       serie(b, "0+240x2016 483840+600x24") + serie(c, "0+3000x2040"), "5m")
    p += prueba_alerta("ClassifierLowConfidenceSpike", [("7d1h50m", None, None)],
                       serie(b, "0+12x2016 24192+30x24") + serie(c, "0+150x2040"), "5m")
    p += prueba_alerta("ClassifierLowConfidenceSpike", [("7d1h50m", "ticket", None)],
                       serie(b, "0+240x1000 240000x12 240000+240x1004 481920+600x24")
                       + serie(c, "0+3000x1000 3000000x12 3000000+3000x1028"), "5m")
    ok, que = probar_reglas(p)
    exige(ok, f"las pruebas de la baja confianza no pasan con tus reglas: {que}. Pistas: el doble del promedio de 7 días "
              "de la regla grabada, más de 1 foto/s, for 30m, y que un rato sin tráfico no guarde NaN")
    n = prom1("count_over_time(classifier:low_confidence_share:rate30m[7d])", 0)
    exige(n >= 9000, f"la regla grabada tiene {n:.0f} muestras en 7 días: su promedio de 7 días es el de un rato. "
                     "Rellena su historia: python mundo/promtool.py rellenar")
    viejo = prom1("time() - min_over_time(timestamp(classifier:low_confidence_share:rate30m)[8d:10m])", 0)
    exige(viejo / 86400 >= 6.9, f"la regla grabada empieza hace {viejo / 86400:.1f} días; la alerta promedia 7")
    m = prom1("avg_over_time(classifier:low_confidence_share:rate30m[7d])")
    exige(m is not None and not math.isnan(m), "el promedio de 7 días de la regla es NaN: algún 0/0 quedó grabado")
    exige(0.04 < m < 0.15, f"el promedio de 7 días es {m:.3f}; la historia dice ≈ 0.087")
    return f"promtool: dobla → suena a los 30 min; poco tráfico → nada; 1 h sin tráfico no la rompe · 7 días grabados, promedio {m:.1%}"


# ---------------------------------------------------------------- 5. tus pruebas
def check_pruebas_propias() -> str:
    f = OBS / "pruebas.yml"
    exige(f.exists(), "falta observabilidad/pruebas.yml")
    r = promtool("test", "rules", "/o/pruebas.yml")
    exige(r.returncode == 0, f"tus pruebas no pasan: {(r.stdout + r.stderr).strip()[-400:]}")
    d = yaml.safe_load(f.read_text())
    probadas, vacias = set(), 0
    for t in d.get("tests") or []:
        for a in t.get("alert_rule_test") or []:
            probadas.add(a["alertname"])
            vacias += not a.get("exp_alerts")
    faltan = sorted({"ClassifierErrorBudgetFastBurn", "ClassifierErrorBudgetSlowBurn", "ClassifierLowConfidenceSpike",
                     "MonitoringJobStale"} - probadas)
    exige(not faltan, f"tus pruebas no prueban: {', '.join(faltan)}")
    exige(vacias >= 3, f"solo {vacias} casos esperan que NO suene: prueba también lo que no debe despertar a nadie")
    return f"{len(d['tests'])} pruebas pasan · prueban {len(probadas)} alertas · {vacias} casos de «no suena»"


# ---------------------------------------------------------------- 6. Alertmanager
def check_alertmanager() -> str:
    f = OBS / "alertmanager.yml"
    exige(f.exists(), "falta observabilidad/alertmanager.yml")
    r = amtool("check-config", "/etc/alertmanager/dojo/alertmanager.yml")
    exige(r.returncode == 0, f"amtool rechaza tu alertmanager.yml: {(r.stdout + r.stderr).strip()[-300:]}")
    cfg = yaml.safe_load(f.read_text())
    url_de = {}
    for rc in cfg.get("receivers") or []:
        for w in rc.get("webhook_configs") or []:
            url_de[rc["name"]] = Path(w.get("url_file", w.get("url", ""))).stem
    casos = {"severity=page alertname=X slo=disponibilidad": "guardia", "severity=warning alertname=X": "canal",
             "severity=ticket alertname=X": "tickets", "severity=none alertname=Watchdog": "latido",
             "alertname=Y": "tickets"}
    for etq, quiero in casos.items():
        r = amtool("config", "routes", "test", "--config.file=/etc/alertmanager/dojo/alertmanager.yml", *etq.split())
        recv = r.stdout.strip().split(",")[0]
        exige(url_de.get(recv) == quiero, f"una alerta con {etq} llega al receptor «{recv}», que avisa a "
                                          f"«{url_de.get(recv)}»; le toca la integración {quiero}.url")
    inh = cfg.get("inhibit_rules") or []
    exige(any("severity=\"page\"" in str(x.get("source_matchers")) and "severity=\"ticket\"" in str(x.get("target_matchers"))
              and "slo" in (x.get("equal") or []) for x in inh),
          "falta la inhibición: un page de un SLO calla el ticket del mismo SLO (equal: [slo])")
    st, b, _ = http(f"{ALERTMANAGER}/api/v2/status")
    exige(st == 200, "Alertmanager no contesta en :9963 (docker compose ps)")
    vivo = yaml.safe_load(json.loads(b)["config"]["original"])
    exige(sorted(x["name"] for x in vivo.get("receivers") or []) == sorted(url_de) and
          len(vivo.get("inhibit_rules") or []) == len(inh) and
          len((vivo.get("route") or {}).get("routes") or []) == len((cfg.get("route") or {}).get("routes") or []),
          "Alertmanager tiene cargada otra configuración que tu archivo: python mundo/recargar.py alertmanager")
    # una alerta de prueba directo a Alertmanager: tiene que sonarle a la guardia
    nombre = f"DojoPrueba{uuid.uuid4().hex[:6]}"
    alerta_ = [{"labels": {"alertname": nombre, "severity": "page", "slo": "prueba"},
                "annotations": {"summary": "prueba de verificar.py: ignórala"}}]
    st, _, _ = http(f"{ALERTMANAGER}/api/v2/alerts", "POST", json.dumps(alerta_).encode(), {"Content-Type": "application/json"})
    exige(st == 200, f"Alertmanager no aceptó una alerta de prueba ({st})")
    t0, llego = time.time(), False
    while time.time() - t0 < 40 and not llego:
        time.sleep(2)
        st, b, _ = http(f"{BUSCAPERSONAS}/api/avisos")
        llego = st == 200 and any(x.get("receptor") == "guardia" and any(a["alertname"] == nombre for a in x.get("alertas", []))
                                  for x in json.loads(b))
    seg = time.time() - t0
    alerta_[0]["endsAt"] = datetime.now(timezone.utc).isoformat()
    http(f"{ALERTMANAGER}/api/v2/alerts", "POST", json.dumps(alerta_).encode(), {"Content-Type": "application/json"})
    exige(llego, "una alerta page de prueba no le llegó a la guardia en 40 s (python mundo/tickets.py avisos; "
                 "docker compose logs alertmanager)")
    # el latido: Prometheus → Alertmanager → buscapersonas
    st, b, _ = http(f"{BUSCAPERSONAS}/estado")
    e = json.loads(b) if st == 200 else {}
    hace = e.get("latido_hace_s")
    maximo = plataforma()["buscapersonas"]["latido_max_s"]
    exige(hace is not None and hace <= maximo,
          f"el latido no llega al buscapersonas ({'nunca llegó' if hace is None else f'el último hace {hace:.0f} s'}): "
          "si el Watchdog no llega, ninguna otra alerta está llegando. Mira http://localhost:9962/alerts, "
          "prometheus_notifications_errors_total y el alerting de Prometheus")
    errs = prom1("sum(increase(prometheus_notifications_errors_total[1m]))", 0)
    exige(errs < 0.5, f"Prometheus tuvo {errs:.0f} errores mandando alertas en el último minuto (prometheus_notifications_errors_total)")
    return f"amtool OK · page→guardia, warning→canal, ticket→tickets, Watchdog→latido · inhibición page→ticket por slo · prueba en {seg:.0f} s · latido hace {hace:.0f} s"


# ---------------------------------------------------------------- 7. las señales en vivo
def check_en_vivo() -> str:
    from mundo.capas import senales
    s = senales()
    exige(s["n_ventana"] and s["n_ventana"] > 300, f"hay {s['n_ventana']:.0f} fotos en los últimos 3 min: ¿corre el tráfico de siempre?")
    exige(s["burn"] is not None, "Prometheus no tiene la fracción de 5xx de los últimos 3 min")
    exige(s["burn"] < 14.4, f"los 5xx de los últimos 3 min queman el presupuesto a {s['burn']:.1f}×")
    a, b = s["baja"]
    exige(a is not None and b, "Prometheus no tiene la baja confianza de ahora o de 7 días")
    exige(a / b > 0.5, f"la fracción de fotos dudosas de los últimos 3 min es {a:.1%}, {a / b:.2f}× la de 7 días ({b:.1%}): "
                       "un modelo seguro de todo de repente también es una alarma (python mundo/capas.py)")
    exige(a / b < 1.5, f"la fracción de fotos dudosas de los últimos 3 min es {a:.1%}, {a / b:.1f}× la de 7 días ({b:.1%}). "
                       "Algo cambió en el modelo o en lo que le llega: mira las cinco capas (python mundo/capas.py)")
    exige(s["psi"] is not None, "Prometheus no tiene las categorías de los últimos 3 min (classifier_top1_label_total)")
    exige(s["psi"] < 0.1, f"el PSI de las categorías de los últimos 3 min contra 7 días es {s['psi']:.2f}: "
                                                    "la mezcla de lo que el modelo contesta cambió (python mundo/capas.py)")
    for f, (x, y) in s["bytes"].items():
        if x and y:
            exige(abs(x / y - 1) < 0.10, f"las fotos de {f} pesan {x:.0f} B en promedio y en 7 días {y:.0f} B "
                                         f"({x / y - 1:+.0%}): cambió lo que manda quien llama")
    return f"5xx {s['burn']:.1f}× · dudosas {a:.1%} vs {b:.1%} · PSI {s['psi']:.3f} · bytes como siempre en las 3 fuentes"


# ---------------------------------------------------------------- 8. el job diario, contra una cuenta de referencia
def referencia(d) -> dict:
    import duckdb
    c = s3()
    labs = etiquetas()
    hoy_ = [str(p) for p in descargar(f"{PREDICCIONES}dt={d}/", c) if p.suffix == ".parquet"]
    ref = [str(p) for k in range(1, 29) for p in descargar(f"{PREDICCIONES}dt={d - timedelta(days=k)}/", c) if p.suffix == ".parquet"]
    ev = [str(p) for p in descargar(f"{EVENTOS}dt={d}/", c) if p.suffix == ".parquet"]
    con = duckdb.connect()
    a = dict(con.execute(f"SELECT top1, count(*) FROM read_parquet({hoy_!r}) WHERE status=200 GROUP BY 1").fetchall())
    b = dict(con.execute(f"SELECT top1, count(*) FROM read_parquet({ref!r}) WHERE status=200 GROUP BY 1").fetchall())
    na, nb = sum(a.values()), sum(b.values())
    psi = sum((max(a.get(i, 0) / na, 1e-4) - max(b.get(i, 0) / nb, 1e-4))
              * math.log(max(a.get(i, 0) / na, 1e-4) / max(b.get(i, 0) / nb, 1e-4)) for i in range(len(labs)))
    baja = con.execute(f"SELECT avg((score < 0.3)::int) FROM read_parquet({hoy_!r}) WHERE status=200").fetchall()[0][0]
    acc = {}
    for s, n, k in con.execute(f"""
        SELECT p.source, count(*), sum((e.via='sugerencia')::int) FROM read_parquet({ev!r}) e
        JOIN read_parquet({hoy_!r}) p USING (request_id) WHERE p.status=200 AND e.mostrada AND NOT e.holdout GROUP BY 1""").fetchall():
        acc[f"source={s}"] = (n, k)
    for el, n, k in con.execute(f"""
        SELECT e.elegida, count(*), sum((e.via='sugerencia')::int) FROM read_parquet({ev!r}) e
        JOIN read_parquet({hoy_!r}) p USING (request_id) WHERE p.status=200 AND e.mostrada AND NOT e.holdout GROUP BY 1""").fetchall():
        acc[f"categoria={labs[el]}"] = (n, k)
    acc["total"] = (sum(v[0] for k, v in acc.items() if k.startswith("source=")),
                    sum(v[1] for k, v in acc.items() if k.startswith("source=")))
    h = con.execute(f"""SELECT count(*), sum((p.top1=e.elegida)::int) FROM read_parquet({ev!r}) e
        JOIN read_parquet({hoy_!r}) p USING (request_id) WHERE p.status=200 AND e.holdout""").fetchall()[0]
    return {"psi": psi, "baja": baja, "acc": acc, "holdout": h, "filas": na}


def resumen_de(d, c=None) -> dict | None:
    c = c or s3()
    try:
        return json.loads(c.get_object(Bucket=BUCKET, Key=f"{MONITOREO}dt={d}/resumen.json")["Body"].read())
    except Exception:  # noqa: BLE001
        return None


def check_job_diario() -> str:
    d1 = ayer()
    c = s3()
    faltan = [str(d) for k in range(PRIMER_DIA) if resumen_de(d := d1 - timedelta(days=k), c) is None]
    exige(not faltan, f"faltan {len(faltan)} resúmenes en s3://{BUCKET}/{MONITOREO} (p. ej. {(faltan or [''])[-1]}). El disparador "
                      f"compara semanas: corre el job desde {d1 - timedelta(days=PRIMER_DIA - 1)} hasta {d1}")
    for k in (0, 8, 19):
        d = d1 - timedelta(days=k)
        r, ref = resumen_de(d, c), referencia(d)
        exige(r.get("filas") == ref["filas"], f"{d}: filas {r.get('filas')} y con status 200 hay {ref['filas']}")
        exige(abs((r.get("psi") or -1) - ref["psi"]) < 0.0006, f"{d}: tu PSI es {r.get('psi')} y la cuenta da {ref['psi']:.4f} "
                                                              "(top1 del día contra los 28 días anteriores juntos, 10 bins, 0 → 0.0001)")
        exige(abs((r.get("baja_confianza") or {}).get("total", -1) - ref["baja"]) < 0.0006,
              f"{d}: tu baja confianza total es {(r.get('baja_confianza') or {}).get('total')} y la cuenta da {ref['baja']:.4f}")
        for s, (n, k_) in ref["acc"].items():
            x = (r.get("aceptacion") or {}).get(s) or {}
            exige(x.get("n") == n and x.get("aceptadas") == k_,
                  f"{d}: aceptación de {s}: tienes n {x.get('n')} y {x.get('aceptadas')} aceptadas; la cuenta da {n} y {k_} "
                  "(mostradas, fuera del holdout, unidas al log por request_id)")
        h = r.get("holdout") or {}
        exige((h.get("n"), h.get("aciertos")) == tuple(ref["holdout"]), f"{d}: holdout {h} y la cuenta da {ref['holdout']}")
    r = resumen_de(d1, c)
    return (f"{PRIMER_DIA} resúmenes ({d1 - timedelta(days=PRIMER_DIA - 1)} a {d1}) · 3 días cuadran con la cuenta · "
            f"ayer: PSI {r['psi']}, dudosas {r['baja_confianza']['total']:.1%}, aceptación "
            f"{r['aceptacion']['total']['aceptadas'] / r['aceptacion']['total']['n']:.1%}")


# ---------------------------------------------------------------- 9. la frescura del job
def check_frescura() -> str:
    p = "tests:\n" + prueba_alerta("MonitoringJobStale", [("25h50m", None, None), ("26h10m", "ticket", {"job": "monitoreo-diario"})],
                                   serie('push_time_seconds{job="monitoreo-diario"}', "0x200"), "10m")
    ok, que = probar_reglas(p)
    exige(ok, f"MonitoringJobStale no se comporta: {que}. Pista: time() − push_time_seconds del job, más de 26 h")
    corridas = leer_json(LOGS / "cron.json", [])
    exige(corridas, "el job programado nunca corrió: python mundo/cron.py correr")
    u = corridas[-1]
    malo = next((x for x in u["pasos"] if x["codigo"] != 0), None)
    exige(u["ok"], f"la última corrida del job programado ({u['inicio']}) falló en {malo['paso'] if malo else '?'}: "
                   f"{' / '.join(malo['salida'][-2:]) if malo else ''}. Mira python mundo/cron.py estado")
    pt = prom1('push_time_seconds{job="monitoreo-diario"}')
    exige(pt, "la Pushgateway no tiene nada del job monitoreo-diario (http://localhost:9964)")
    inicio = datetime.fromisoformat(u["inicio"]).timestamp()
    exige(pt >= inicio - 1, "la Pushgateway tiene un push de antes de la última corrida: el job no publicó")
    dia = prom1('classifier_monitoreo_dia_timestamp_seconds{job="monitoreo-diario"}')
    quiero = datetime.combine(ayer(), datetime.min.time(), timezone.utc).timestamp()
    exige(dia == quiero, f"lo publicado es del {datetime.fromtimestamp(dia or 0, timezone.utc):%Y-%m-%d} y ayer es {ayer()}")
    return f"promtool: suena a las 26 h · última corrida OK ({u['inicio']}, {u['segundos']} s) · publicó ayer ({ayer()})"


# ---------------------------------------------------------------- 10. el disparador
def tickets() -> list[dict]:
    st, b, _ = http(f"{BUSCAPERSONAS}/api/tickets")
    exige(st == 200, "el buscapersonas no contesta: python mundo/servicios.py arrancar buscapersonas")
    return [t for t in json.loads(b) if not t["id"].startswith("am-")]


def esperados() -> dict[str, str]:
    d1 = ayer()
    return {f"aceptacion-source=mobile-{d1 - timedelta(days=10)}": "avisar-dueno",
            f"aceptacion-categoria=abrigos-{d1 - timedelta(days=4)}": "etiquetar|reentrenar",
            f"drift-psi-{d1 - timedelta(days=2)}": "reentrenar"}


def check_disparador() -> str:
    ts = tickets()
    ids = {t["id"] for t in ts}
    quiero = esperados()
    faltan = [i for i in quiero if i not in ids]
    exige(not faltan, f"faltan tickets: {', '.join(faltan)}. ¿Corriste el disparador sobre cada día, desde "
                      f"{ayer() - timedelta(days=PRIMER_DISPARO - 1)}? (python mundo/tickets.py)")
    sobran = sorted(ids - set(quiero))
    exige(not sobran, f"sobran tickets: {', '.join(sobran)} (un ticket por causa: ¿n chico? ¿arrastrada por un source?)")
    for t in ts:
        sug = (t.get("accion_sugerida") or {}).get("accion")
        exige(sug in quiero[t["id"]].split("|"), f"{t['id']} sugiere «{sug}»; con su diagnóstico, la tabla de la lección dice {quiero[t['id']]}")
        dg = t.get("diagnostico") or {}
        exige("despliegues" in dg and "fuentes" in dg, f"{t['id']} no trae el diagnóstico (despliegues y fuentes)")
        exige(t.get("slice"), f"{t['id']} no dice su slice")
    mob = next(t for t in ts if "source=mobile" in t["id"])
    exige((mob.get("accion_sugerida") or {}).get("dueno") == "equipo-app-mobile", "el ticket de mobile no dice a quién avisar (equipo-app-mobile)")
    antes = len(ts)
    r = sh(sys.executable, "diario/disparador.py", "--dia", str(ayer()), timeout=300)
    exige(r.returncode == 0, f"tu disparador truena sobre ayer: {(r.stdout + r.stderr).strip()[-300:]}")
    exige(len(tickets()) == antes, "correr el disparador otra vez sobre ayer abrió tickets nuevos: no es idempotente")
    return "3 tickets, uno por causa: mobile → avisar-dueno (equipo-app-mobile) · abrigos · drift → reentrenar · otra corrida no duplica"


# ---------------------------------------------------------------- 11. las muestras
def check_muestras() -> str:
    import duckdb
    c = s3()
    d1 = ayer()
    mes = (d1.replace(day=1) + timedelta(days=32)).strftime("%Y-%m")
    llave = f"{ETIQUETADO}cola-{mes}/tareas.json"
    try:
        tareas = json.loads(c.get_object(Bucket=BUCKET, Key=llave)["Body"].read())
    except Exception:  # noqa: BLE001
        raise Falla(f"no hay s3://{BUCKET}/{llave}: python diario/muestras.py") from None
    exige(isinstance(tareas, list) and all("data" in t and {"image", "sha256", "motivo", "request_id"} <= set(t["data"]) for t in tareas),
          "tareas.json no tiene el formato de importación de Label Studio ([{\"data\": {image, request_id, sha256, motivo, …}}])")
    d = [t["data"] for t in tareas]
    gold = {g[:12] for g in c.get_object(Bucket=BUCKET, Key=examen())["Body"].read().decode().split()}
    en_examen = [x["sha256"] for x in d if x["sha256"][:12] in gold]
    exige(not en_examen, f"{len(en_examen)} fotos de la cola están en el examen fijo ({examen()}): si se etiquetan y entran "
                         "al entrenamiento, el examen deja de medir")
    shas = [x["sha256"] for x in d]
    exige(len(shas) == len(set(shas)), f"hay {len(shas) - len(set(shas))} fotos repetidas en la cola")
    por = {}
    for x in d:
        por.setdefault(x["motivo"], []).append(x)
    exige(len(por.get("incertidumbre", [])) == 300 and len(por.get("azar", [])) == 200,
          f"la cola trae {len(por.get('incertidumbre', []))} por incertidumbre y {len(por.get('azar', []))} al azar; son 300 y 200")
    pr = [str(p) for k in range(30) for p in descargar(f"{PREDICCIONES}dt={d1 - timedelta(days=k)}/", c) if p.suffix == ".parquet"]
    con = duckdb.connect()
    con.register("g", {"sha": np.array(sorted(gold))})
    version = con.execute(f"SELECT max(model_version) FROM read_parquet({pr!r}) WHERE CAST(hora AS DATE) = DATE '{d1}'").fetchall()[0][0]
    ids = [x["request_id"] for x in d]
    con.register("elegidas", {"request_id": np.array(ids)})
    malas = con.execute(f"""SELECT count(*) FROM read_parquet({pr!r}) p JOIN elegidas USING (request_id)
                            WHERE p.status != 200 OR p.model_version != '{version}'""").fetchall()[0][0]
    exige(malas == 0, f"{malas} fotos de la cola no son de las requests con 200 de la versión que atiende ({version})")
    max_inc = max(x["score"] for x in por["incertidumbre"])
    con.register("ya", {"sha": np.array(shas)})
    menor = con.execute(f"""SELECT min(score) FROM (
                              SELECT * FROM read_parquet({pr!r}) WHERE status=200 AND model_version='{version}'
                              AND sha256 NOT IN (SELECT sha FROM g)
                              QUALIFY row_number() OVER (PARTITION BY sha256 ORDER BY hora) = 1)
                            WHERE sha256 NOT IN (SELECT sha FROM ya)""").fetchall()[0][0]
    exige(max_inc <= menor + 1e-9, f"las 300 por incertidumbre no son las de score más bajo: llegan a {max_inc} y hay otras con {menor}")
    decididos = sorted({t["slice"] for t in tickets() if (t.get("decision") or {}).get("accion") in ("reentrenar", "etiquetar")})
    extras = {k[6:]: v for k, v in por.items() if k.startswith("extra:")}
    exige(set(extras) == set(decididos), f"tandas extra: {sorted(extras) or 'ninguna'}; los tickets decididos con reentrenar o "
                                         f"etiquetar piden: {decididos or 'ninguna'}")
    for s, xs in extras.items():
        exige(len(xs) == 100, f"la tanda extra de {s} trae {len(xs)} fotos; son 100")
    return (f"cola-{mes}: 300 por incertidumbre (score ≤ {max_inc}) + 200 al azar" + "".join(f" + 100 de {s}" for s in extras)
            + f" · sin examen ni repetidas · formato de Label Studio")


# ---------------------------------------------------------------- 12. el ciclo cerrado
def check_ciclo_cerrado() -> str:
    ts = {t["id"]: t for t in tickets()}
    q = esperados()
    mob, abr, drf = list(q)
    for i in q:
        exige(i in ts, f"falta el ticket {i} (check disparador)")
    dec = {i: (ts[i].get("decision") or {}).get("accion") for i in q}
    exige(dec[mob] == "avisar-dueno", f"el ticket de mobile está decidido como «{dec[mob]}». ¿Qué cambió: el modelo o lo que "
                                      "manda la app? (python mundo/tickets.py ver …)")
    exige(dec[drf] == "reentrenar", f"el ticket de drift está decidido como «{dec[drf]}»")
    exige(dec[abr] in ("reentrenar", "etiquetar"), f"el ticket de abrigos está «{dec[abr] or 'sin decidir'}»")
    corridas = leer_json(LOGS / "orquestador.json", [])
    por = {c["ticket"] for c in corridas}
    exige(drf in por, "no hay una corrida adelantada por el ticket de drift: python mundo/orquestador.py submit …")
    exige(mob not in por, "hay una corrida de reentrenamiento por el ticket de mobile: reentrenar no arregla la app")
    return "mobile → avisar al equipo de la app (sin reentrenar) · drift → corrida adelantada · abrigos con su tanda extra"


CHECKS = {
    "mundo": check_mundo, "reglas": check_reglas, "burn-rate": check_burn_rate, "baja-confianza": check_baja_confianza,
    "pruebas-propias": check_pruebas_propias, "alertmanager": check_alertmanager, "en-vivo": check_en_vivo,
    "job-diario": check_job_diario, "frescura": check_frescura, "disparador": check_disparador,
    "muestras": check_muestras, "ciclo-cerrado": check_ciclo_cerrado,
}


def correr(ids: list[str], silencio: bool = False) -> dict[str, tuple[bool, str]]:
    out = {}
    for i in ids:
        try:
            ok, msg = True, CHECKS[i]()
        except Falla as e:
            ok, msg = False, str(e)
        except Exception as e:  # noqa: BLE001 — un error inesperado también es un check que no pasa
            ok, msg = False, f"{type(e).__name__}: {str(e).splitlines()[0][:200] if str(e) else ''}"
        out[i] = (ok, msg)
        if not silencio:
            print(f"{'✓' if ok else '✗'} {i:<16} {msg}", flush=True)
    return out


if __name__ == "__main__":
    pedidos = sys.argv[1:] or list(CHECKS)
    desconocidos = [p for p in pedidos if p not in CHECKS]
    if desconocidos:
        sys.exit(f"checks desconocidos: {desconocidos}. Hay: {', '.join(CHECKS)}")
    r = correr(pedidos)
    from taller.registro import anotar_verificacion  # la corrida queda en taller/progreso.json, para tu tablero

    anotar_verificacion({k: ok for k, (ok, _) in r.items()})
    malos = [k for k, (ok, _) in r.items() if not ok]
    print(f"\n{len(r) - len(malos)}/{len(r)} en verde" + (f" · falta: {', '.join(malos)}" if malos else ""))
    sys.exit(1 if malos else 0)
