"""Revisa los criterios de «listo» de la estación, uno por check. No cambia nada (sí manda unas requests por el ALB).

    python verificar.py                    # todos (≈ 15 s)
    python verificar.py mundo request-id   # algunos

Necesita el mundo arriba (python mundo/crear.py) y el venv del kit. Lo que revisa es lo que corre (los pods, Prometheus,
Fluent Bit, S3), no solo lo que escribiste: un archivo bien escrito que no se recargó no pasa.
"""
from __future__ import annotations

import gzip
import importlib.util
import io
import json
import re
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mundo.comun import (ALB, ALB_METRICAS, BUCKET, CALLERS_JSON, CRUDO, FLUENT, FOTOS, PREDICCIONES, PROMETHEUS,  # noqa: E402
                         RAIZ, TRITON, VIGIA, compose, docker_env, http, leer_json, lineas_nodo, objetos, pods, prom, prom_api,
                         s3, sh)

CAMPOS = {"request_id", "caller", "source", "model_version", "ms", "status"}
NOMBRES = {   # nombre → (tipo, etiquetas, bordes)
    "classifier_requests_total": ("counter", {"code", "source", "model_version"}, None),
    "classifier_request_seconds": ("histogram", {"source", "model_version"}, "MS"),
    "classifier_preprocess_seconds": ("histogram", {"model_version"}, "MS"),
    "classifier_inference_seconds": ("histogram", {"model_version"}, "MS"),
    "classifier_top1_score": ("histogram", {"model_version"}, "SCORE"),
    "classifier_image_bytes": ("histogram", {"source"}, "BYTES"),
    "classifier_top1_label_total": ("counter", {"label"}, None),
    "classifier_requests_in_flight": ("gauge", set(), None),
}
PROHIBIDAS = {"request_id", "sha256", "caller", "trace_id", "id", "foto"}
TOPE_SERIES = 400            # por pod (la cuenta del contrato da ≈ 260)
ALERTAS = {"ClassifierHigh5xxRate", "ClassifierP99Alto", "GatewaySinLectura", "LogsStale", "ALB5xx"}
REGLAS = {"classifier:requests:rate1m", "classifier:errores_servidor:ratio_rate1m", "classifier:latencia:p99_1m"}
FRESCO_S = 180               # 3 × el upload_timeout de 1 min


class Falla(Exception):
    pass


def exige(cond, msg: str) -> None:
    if not cond:
        raise Falla(msg)


def token(caller: str = "backend-publicaciones") -> str:
    from mundo.carga import token as t

    return t(caller, leer_json(CALLERS_JSON))


def foto(i: int = 3) -> bytes:
    return sorted(FOTOS.glob("*.jpg"))[i].read_bytes()


def por_alb(headers: dict | None = None, metodo: str = "POST", body: bytes | None = None) -> tuple[int, bytes, dict]:
    h = {"Content-Type": "image/jpeg", "Authorization": f"Bearer {token()}", **(headers or {})}
    return http(f"{ALB}/v1/classify", metodo=metodo, datos=foto() if body is None and metodo == "POST" else body,
                headers=h, timeout=5)


def familias(url: str) -> dict:
    from prometheus_client.parser import text_string_to_metric_families

    st, b, _ = http(url, timeout=3)
    exige(st == 200, f"{url} no contesta ({st or 'sin respuesta'})")
    return {f.name: f for f in text_string_to_metric_families(b.decode())}


def valor(fams: dict, nombre: str, muestra: str, **etq) -> float:
    base = nombre.removesuffix("_total") if nombre.endswith("_total") else nombre
    f = fams.get(base) or fams.get(nombre)
    if not f:
        return 0.0
    return sum(s.value for s in f.samples if s.name == muestra and all(s.labels.get(k) == v for k, v in etq.items()))


def suma_pods(nombre: str, muestra: str, **etq) -> float:
    return sum(valor(familias(f"http://localhost:{p['puerto_host']}/metrics"), nombre, muestra, **etq) for p in pods())


def lineas_de(rid: str, espera: float = 3.0) -> list[tuple[str, str]]:
    """(archivo en el disco del nodo, línea) de las líneas de log que traen ese id, en los dos nodos."""
    t0 = time.time()
    while True:
        out = [(f"nodo-{p['nodo']}:{f}", l) for p in pods() for f, l in lineas_nodo(p["nodo"], rid)]
        if out or time.time() - t0 > espera:
            return out
        time.sleep(0.3)


def rastro_mod():
    spec = importlib.util.spec_from_file_location("rastro_persona", RAIZ / "gateway" / "app" / "rastro.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


# ---------------------------------------------------------------- los checks
def check_mundo() -> str:
    r = compose("ps", "--format", "json", timeout=30)
    svcs = {}
    for linea in r.stdout.splitlines():
        try:
            d = json.loads(linea)
        except json.JSONDecodeError:
            continue
        svcs[d["Service"]] = d.get("State")
    faltan = [s for s in ("s3", "prometheus", "nodo-a", "nodo-b", "fluent-bit-a", "fluent-bit-b") if svcs.get(s) != "running"]
    exige(not faltan, f"no corren: {', '.join(faltan)} (docker compose ps). python mundo/crear.py los levanta")
    exige(http(f"{TRITON}/v2/health/ready", timeout=2)[0] == 200, "Triton no está listo: python mundo/nodo.py estado")
    for p in pods():
        exige(http(f"http://localhost:{p['puerto_host']}/readyz", timeout=2)[0] == 200,
              f"el pod {p['nombre']} no está listo: python mundo/nodo.py estado")
    exige(http(f"{ALB_METRICAS}/metrics", timeout=2)[0] == 200, "el ALB no corre: python mundo/nodo.py arrancar alb")
    exige(http(f"{VIGIA}/metrics", timeout=2)[0] == 200, "el vigía de S3 no corre: python mundo/nodo.py arrancar vigia")
    exige(http(f"{PROMETHEUS}/-/ready", timeout=2)[0] == 200, "Prometheus no contesta en :9952")
    st, b, h = por_alb()
    exige(st == 200, f"una foto por el ALB da {st}: {b[:160].decode(errors='replace')}")
    return f"S3, Prometheus, 2 nodos con su pod y su Fluent Bit, Triton, ALB y vigía arriba · una foto por el ALB: 200 ({json.loads(b)['model_version']})"


def check_request_id() -> str:
    mio = str(uuid.uuid4())
    st, _, h = por_alb({"X-Request-ID": mio})
    exige(st == 200, f"la foto con X-Request-ID dio {st}")
    exige(h.get("x-request-id") == mio, f"mandé X-Request-ID {mio} y volvió {h.get('x-request-id')}: el id sano del caller se respeta")
    st, _, h = por_alb()
    nuevo = h.get("x-request-id", "")
    try:
        u = uuid.UUID(nuevo)
    except ValueError:
        u = None
    exige(u is not None and u.version == 4 and len(nuevo) == 36,
          f"sin X-Request-ID el gateway tiene que inventar un UUID versión 4 de 36 caracteres; dio «{nuevo}»")
    for malo in ("x" * 80, "con espacios adentro", "corto"):
        st, _, h = por_alb({"X-Request-ID": malo})
        exige(h.get("x-request-id") != malo, f"X-Request-ID «{malo[:20]}…» no es un id sano y volvió igual: hay que reemplazarlo")
    otro = str(uuid.uuid4())
    st, _, h = por_alb({"X-Request-ID": otro, "Content-Type": "text/plain"})
    exige(st == 415 and h.get("x-request-id") == otro, f"un 415 también lleva el X-Request-ID del caller (dio {st}, {h.get('x-request-id')})")
    exige(lineas_de(mio), f"el id {mio} no aparece en el disco de ningún nodo: ¿tu anotar() escribe la línea con ese request_id?")
    return "respeta el id del caller (también en el 415), inventa un UUID v4 si falta y reemplaza los que no son sanos; el id está en el log"


def check_linea_log() -> str:
    rid = str(uuid.uuid4())
    st, _, _ = por_alb({"X-Request-ID": rid, "X-Client-Source": "mobile"})
    exige(st == 200, f"la foto dio {st}")
    ls = lineas_de(rid)
    exige(len(ls) == 1, f"la request {rid} dejó {len(ls)} líneas en los nodos: tiene que ser exactamente una")
    log, linea = ls[0]
    partes = linea.split(" ", 3)
    exige(len(partes) == 4 and partes[1] == "stdout" and partes[2] == "F",
          f"la línea no está en stdout completa ({' '.join(partes[1:3])}): escribe con sys.stdout, una línea por request")
    texto = partes[3]
    try:
        ev = json.loads(texto)
    except json.JSONDecodeError:
        raise Falla(f"la línea no es JSON: {texto[:120]}") from None
    faltan = CAMPOS - set(ev)
    exige(not faltan, f"a la línea le faltan: {', '.join(sorted(faltan))}")
    exige(ev["status"] == 200 and isinstance(ev["ms"], dict) and {"pre", "triton", "post", "total"} <= set(ev["ms"]),
          f"status y ms {{pre, triton, post, total}}: {ev.get('status')} {ev.get('ms')}")
    exige(not ({"hora", "time", "ts", "timestamp", "foto", "imagen"} & set(ev)),
          "la línea no lleva hora (la pone el runtime del nodo) ni la foto")
    exige(" " not in texto.split('"request_id"')[0] and ", " not in texto and ": " not in texto,
          "JSON compacto (separators=(',', ':')): cada byte se paga 10 millones de veces al día")
    b = len(texto.encode()) + 1
    exige(b <= 400, f"la línea pesa {b} B: en C01 ≈ 300 B")
    st, _, _ = por_alb({"X-Request-ID": (r2 := str(uuid.uuid4())), "X-Client-Source": "iOS-17.2 Beta"})
    l2 = lineas_de(r2)
    exige(l2 and json.loads(l2[0][1].split(" ", 3)[3]).get("source") == "iOS-17.2 Beta",
          "el log guarda el X-Client-Source tal como llegó (la etiqueta lo reduce; el log no)")
    return f"una línea de JSON compacto en stdout ({b} B), con request_id, ms y status, sin hora ni foto · {log}"


def check_metricas() -> str:
    fams = familias(f"http://localhost:{pods()[0]['puerto_host']}/metrics")
    m = rastro_mod()
    bordes = {"MS": m.MS, "SCORE": m.SCORE, "BYTES": m.BYTES}
    for nombre, (tipo, etqs, b) in NOMBRES.items():
        base = nombre.removesuffix("_total") if tipo == "counter" else nombre
        f = fams.get(base)
        exige(f is not None, f"falta {nombre} en /metrics (los nombres no se cambian: las alertas y el canary los buscan así)")
        exige(f.type == tipo, f"{nombre} es {f.type} y tiene que ser {tipo}")
        muestras = [s for s in f.samples if not s.name.endswith("_created")]
        if muestras:
            vistas = set(muestras[0].labels) - {"le"}
            exige(vistas == etqs, f"{nombre} tiene las etiquetas {sorted(vistas)} y el contrato dice {sorted(etqs)}")
        if b and muestras:
            les = sorted({float(s.labels["le"]) for s in muestras if s.name.endswith("_bucket") and s.labels["le"] != "+Inf"})
            exige(les == sorted(bordes[b]), f"{nombre}: bordes {les}; el contrato dice {b} = {list(bordes[b])}")
    labels = {s.labels["label"] for s in fams["classifier_top1_label"].samples if s.name.endswith("_total")}
    exige(len(labels) == 10, f"classifier_top1_label_total tiene que existir para las 10 categorías desde el arranque ({len(labels)})")
    return f"las {len(NOMBRES)} métricas del contrato, con sus tipos, etiquetas y bordes"


class TritonFalso:
    """Un Triton de mentira, en el mismo proceso: así la prueba no se mezcla con el tráfico que esté corriendo."""

    async def get_model_metadata(self, _m):
        return {"inputs": [{"name": "input", "shape": [-1, 3, 32, 32]}], "outputs": [{"name": "logits", "shape": [-1, 10]}]}

    async def is_model_ready(self, _m):
        return True

    async def infer(self, *_a, **_k):
        import numpy as np

        class R:
            def as_numpy(self, _n):
                return np.linspace(0, 3, 10, dtype=np.float32)[None]
        return R()

    async def close(self):
        pass


def app_de_prueba():
    sys.path.insert(0, str(RAIZ / "gateway"))
    for m in [m for m in sys.modules if m == "app" or m.startswith("app.")]:
        del sys.modules[m]
    from fastapi.testclient import TestClient
    from app.main import crear_app

    return TestClient(crear_app(triton=TritonFalso()))


def check_reglas_de_conteo() -> str:
    from prometheus_client.parser import text_string_to_metric_families

    import contextlib
    import warnings

    warnings.filterwarnings("ignore", message=".*httpx2.*")
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()), app_de_prueba() as cli:
        def fams():
            return {f.name: f for f in text_string_to_metric_families(cli.get("/metrics").text)}

        def cuenta(nombre, muestra, **etq):
            return valor(fams(), nombre, muestra, **etq)

        img = {"Content-Type": "image/jpeg"}
        for _ in range(3):
            cli.post("/v1/classify", content=foto(), headers={**img, "X-Client-Source": "web"})
        for _ in range(10):
            cli.post("/v1/classify", content=b"hola", headers={"Content-Type": "text/plain", "X-Client-Source": "web"})
        n415 = cuenta("classifier_requests_total", "classifier_requests_total", code="415")
        exige(n415 == 10, f"10 requests con 415 sumaron {n415:.0f} al contador con code=\"415\"")
        lat = cuenta("classifier_request_seconds", "classifier_request_seconds_count")
        exige(lat == 3, f"3 fotos con 200 y 10 con 415 dejaron {lat:.0f} observaciones de latencia: tienen que ser 3 "
                        "(los 4xx cuentan, pero no entran a la latencia: un 415 tarda microsegundos y baja el p99)")
        cli.post("/v1/classify", content=foto(), headers={**img, "X-Client-Source": "iOS-17.2"})
        cli.post("/v1/classify", content=foto(), headers={**img, "X-Client-Source": " Mobile "})
        cli.post("/v1/classify", content=foto(), headers=img)
        o = cuenta("classifier_requests_total", "classifier_requests_total", source="other", code="200")
        mo = cuenta("classifier_requests_total", "classifier_requests_total", source="mobile", code="200")
        exige(o == 2 and mo == 1, f"«iOS-17.2» y sin header cuentan como other (dio {o:.0f}) y « Mobile » como mobile "
                                  f"(dio {mo:.0f}): minúsculas, sin espacios, y lo demás es other")
        pre = cuenta("classifier_preprocess_seconds", "classifier_preprocess_seconds_count")
        exige(pre == 6, f"6 fotos con 200 dejaron {pre:.0f} observaciones de preproceso (rastro.pre)")
        b = cuenta("classifier_image_bytes", "classifier_image_bytes_count", source="web")
        exige(b == 3, f"las 3 fotos de web dejaron {b:.0f} observaciones de bytes (rastro.bytes, con su source)")
        vuelo = cuenta("classifier_requests_in_flight", "classifier_requests_in_flight")
        exige(vuelo == 0, f"en reposo, classifier_requests_in_flight vale {vuelo:.0f}: tiene que volver a 0")
    m = rastro_mod()
    ids = [f"{i:08x}-prueba" for i in range(4000)]
    elegidos = [r for r in ids if m.se_traza(r, 0.01)]
    exige(20 <= len(elegidos) <= 70, f"se_traza(…, 0.01) eligió {len(elegidos)} de 4,000 ids: tiene que ser ≈ 1 %")
    import hashlib
    ref = [r for r in ids if int(hashlib.sha256(r.encode()).hexdigest()[:8], 16) < 0.01 * 2**32]
    exige(elegidos == ref, "se_traza: los primeros 8 caracteres hex del sha256 del id, como número, < fracción × 2³² "
                           "(la misma request siempre cae del mismo lado)")
    return "los 4xx cuentan pero no entran a la latencia · source reducido a 4 valores · se_traza ≈ 1 % y determinista"


def check_prometheus_lee() -> str:
    t = prom_api("targets?state=active")
    exige(t, "Prometheus no contesta su API en :9952")
    gw = [x for x in t["data"]["activeTargets"] if x["labels"].get("job") == "gateway"]
    exige(gw, "Prometheus no tiene ningún objetivo con job=\"gateway\": falta el job en observabilidad/prometheus.yml "
              "(y curl -X POST localhost:9952/-/reload)")
    urls = [x["scrapeUrl"] for x in gw]
    exige(len(urls) == len(set(urls)), f"cada pod se lee más de una vez ({len(urls)} lecturas para {len(set(urls))} pods): "
                                       "las sumas saldrían al doble. Lee los pods, no los Services")
    nombres = {p["nombre"] for p in pods()}
    vistos = {x["labels"].get("pod") for x in gw}
    exige(vistos == nombres, f"el job gateway tiene pod={sorted(v or '—' for v in vistos)}; los pods son {sorted(nombres)}")
    exige(all(x["labels"].get("nodo") and x["labels"].get("hash") for x in gw), "cada objetivo lleva las etiquetas nodo y hash")
    abajo = [x["labels"]["pod"] for x in gw if x["health"] != "up"]
    exige(not abajo, f"Prometheus no puede leer: {abajo} ({gw[0].get('lastError', '')[:100]})")
    up = prom('up{job="gateway"} == 1')
    exige(len(up) == len(nombres), f"up{{job=\"gateway\"}} == 1 da {len(up)} series y hay {len(nombres)} pods (espera unos segundos tras recargar)")
    return f"los {len(nombres)} pods del gateway, una vez cada uno, con pod, nodo y hash · up = 1"


def check_consultas() -> str:
    g = prom_api("rules?type=record")
    exige(g, "Prometheus no contesta /api/v1/rules")
    vistas = {r["name"]: r for gr in g["data"]["groups"] for r in gr["rules"]}
    faltan = REGLAS - set(vistas)
    exige(not faltan, f"faltan recording rules en observabilidad/reglas.yml: {', '.join(sorted(faltan))}")
    malas = [n for n in REGLAS if vistas[n].get("health") != "ok"]
    errores = [f"{n} ({vistas[n].get('lastError', '')})" for n in malas]
    exige(not malas, f"reglas con error: {', '.join(errores)}")
    e = prom("classifier:errores_servidor:ratio_rate1m")
    exige(len(e) == 1, "classifier:errores_servidor:ratio_rate1m no da un número (sin 5xx también tiene que dar 0, no vacío)")
    q = vistas["classifier:errores_servidor:ratio_rate1m"]["query"]
    exige("5.." in q, "la fracción de errores cuenta los 5xx (code=~\"5..\")")
    exige("4.." in q, "la fracción de errores divide entre las requests que NO son 4xx (code!~\"4..\")")
    p99 = prom("classifier:latencia:p99_1m")
    exige(p99 and all("model_version" in r["metric"] for r in p99), "classifier:latencia:p99_1m tiene que salir por model_version")
    exige("rate(" in vistas["classifier:requests:rate1m"]["query"] and
          vistas["classifier:requests:rate1m"]["query"].index("rate(") > vistas["classifier:requests:rate1m"]["query"].find("sum"),
          "primero rate y después sum: sum(rate(…)), nunca rate(sum(…))")
    v = float(p99[0]["value"][1])
    return f"3 recording rules sanas · errores {float(e[0]['value'][1]):.2%} · p99 {v * 1000:.1f} ms ({p99[0]['metric']['model_version']})"


def check_alertas() -> str:
    g = prom_api("rules?type=alert")
    vistas = {r["name"]: r for gr in g.get("data", {}).get("groups", []) for r in gr["rules"]}
    faltan = ALERTAS - set(vistas)
    exige(not faltan, f"faltan alertas en observabilidad/reglas.yml: {', '.join(sorted(faltan))}")
    exige(all(vistas[n].get("health") != "unknown" for n in ALERTAS), "Prometheus todavía no evalúa las alertas (cada 5 s): vuelve a correr el check")
    malas = [n for n in ALERTAS if vistas[n].get("health") != "ok"]
    exige(not malas, f"alertas con error: {', '.join(malas)}")
    exige("alb_httpcode_elb" in vistas["ALB5xx"]["query"], "ALB5xx mira los 5xx que pone el ALB mismo (alb_httpcode_elb_total)")
    exige("dojo_s3_ultimo_objeto" in vistas["LogsStale"]["query"], "LogsStale mira cuándo llegó el último archivo (dojo_s3_ultimo_objeto_timestamp_seconds)")
    exige("up" in vistas["GatewaySinLectura"]["query"] and "absent" in vistas["GatewaySinLectura"]["query"],
          "GatewaySinLectura tiene que sonar también cuando no hay ninguna serie up del gateway (absent)")
    prendidas = [n for n in ALERTAS if vistas[n]["state"] == "firing"]
    estados = [f"{n} ({vistas[n]['state']})" for n in prendidas]
    exige(not prendidas, f"con el mundo sano hay alertas {', '.join(estados)}: algo está mal (o una regla está mal escrita)")
    pend = [n for n in ALERTAS if vistas[n]["state"] == "pending"]
    return f"las {len(ALERTAS)} alertas cargadas, sanas y sin sonar" + (f" ({', '.join(pend)} en pending: su condición se cumple ahora, pero no lleva su «for»)" if pend else "")


def check_series_acotadas() -> str:
    peor = 0
    for p in pods():
        st, b, _ = http(f"http://localhost:{p['puerto_host']}/metrics", timeout=3)
        exige(st == 200, f"{p['nombre']} no contesta /metrics")
        lineas = [x for x in b.decode().splitlines() if x.startswith("classifier_")]
        peor = max(peor, len(lineas))
        for x in lineas:
            etq = dict(re.findall(r'(\w+)="([^"]*)"', x.split("{", 1)[1].rsplit("}", 1)[0])) if "{" in x else {}
            malas = PROHIBIDAS & set(etq)
            exige(not malas, f"{p['nombre']}: {x.split('{')[0]} tiene la etiqueta {', '.join(malas)}: un valor por request es una serie "
                             "por request. Lo que identifica a una request va al log")
            exige(etq.get("source", "mobile") in ("mobile", "web", "internal", "other"), f"source=\"{etq.get('source')}\" fuera de la lista")
        exige(len(lineas) <= TOPE_SERIES, f"{p['nombre']} expone {len(lineas)} series classifier_* (tope {TOPE_SERIES}): algo crece sin techo")
    return f"≤ {peor} series classifier_* por pod (tope {TOPE_SERIES}) · ninguna etiqueta con un valor por request"


def check_log_en_s3() -> str:
    for n, url in FLUENT.items():
        exige(http(f"{url}/api/v1/uptime", timeout=2)[0] == 200, f"el Fluent Bit del nodo {n} no contesta (docker compose ps)")
        ins = compose("ps", "--format", "{{.ID}}", f"fluent-bit-{n}", timeout=30).stdout.split()
        desde = sh("docker", "inspect", "-f", "{{.State.StartedAt}}", *ins[:1], env=docker_env()).stdout.strip() if ins else ""
        if desde:
            perdidos = [x for x in compose("logs", "--since", desde, f"fluent-bit-{n}", timeout=30).stdout.splitlines()
                        if "moved to quarantine" in x]
            exige(not perdidos, f"el Fluent Bit del nodo {n} se rindió con {len(perdidos)} pedazo(s) de log y los mandó a cuarentena "
                                "(docker compose logs fluent-bit-{n} | grep quarantine): esas líneas no llegaron a S3. ¿Cuántos reintentos "
                                "le das (retry_limit)?".replace("{n}", n))
    try:
        s3().head_bucket(Bucket=BUCKET)
    except Exception as e:  # noqa: BLE001
        raise Falla(f"S3 no contesta en :9950 ({type(e).__name__}): el log se está quedando en el buffer de cada nodo") from None
    ahora = datetime.now(timezone.utc)
    objs = [o for d in (ahora - timedelta(hours=1), ahora) for o in objetos(f"{CRUDO}{d:%Y/%m/%d/%H}/")]
    patron = re.compile(r"^logs/crudo/\d{4}/\d{2}/\d{2}/\d{2}/([ab])-[A-Za-z0-9]{8}\.gz$")
    ultimo = {}
    for o in objs:
        m = patron.match(o["Key"])
        exige(m, f"{o['Key']}: el formato es logs/crudo/AAAA/MM/DD/HH/<nodo>-<uuid>.gz (s3_key_format con ${{NODO}} y $UUID)")
        ultimo[m.group(1)] = max(ultimo.get(m.group(1), 0), o["LastModified"].timestamp())
    for n in ("a", "b"):
        exige(n in ultimo, f"el nodo {n} no ha subido nada en la última hora (¿tu fluent-bit.conf lee y sube? docker compose logs fluent-bit-{n})")
        edad = ahora.timestamp() - ultimo[n]
        exige(edad <= FRESCO_S, f"lo último del nodo {n} llegó hace {edad:.0f} s (tope {FRESCO_S} s): LogsStale estaría sonando")
    k = max((o for o in objs), key=lambda o: o["LastModified"])["Key"]
    regs = [json.loads(x) for x in gzip.decompress(s3().get_object(Bucket=BUCKET, Key=k)["Body"].read()).decode().splitlines()]
    exige(regs and {"time", "stream", "log", "nodo"} <= set(regs[0]),
          f"cada registro en S3 trae time, stream, log y nodo (record_modifier); el de {k} trae {sorted(regs[0]) if regs else []}")
    return f"los dos nodos suben a S3 (lo último, hace {ahora.timestamp() - min(ultimo.values()):.0f} s y menos) · {k}"


def check_parquet() -> str:
    import duckdb

    ayer = (datetime.now(timezone.utc) - timedelta(days=1)).date()
    pref = f"{PREDICCIONES}dt={ayer.isoformat()}/"
    objs = [o for o in objetos(pref) if o["Key"].endswith(".parquet")]
    exige(objs, f"no hay Parquet en s3://{BUCKET}/{pref}: python diario/a_parquet.py")
    # la cuenta independiente: lo que hay en el crudo de ayer (y la hora 00 de hoy), sin repetidos
    c, vistos, por_v = s3(), set(), {}
    hoy = ayer + timedelta(days=1)
    for o in objetos(f"{CRUDO}{ayer:%Y/%m/%d}/") + objetos(f"{CRUDO}{hoy:%Y/%m/%d}/00/"):
        for x in gzip.decompress(c.get_object(Bucket=BUCKET, Key=o["Key"])["Body"].read()).decode().splitlines():
            r = json.loads(x)
            if r.get("stream") != "stdout" or not r["time"].startswith(ayer.isoformat()):
                continue
            try:
                ev = json.loads(r["log"])
            except json.JSONDecodeError:
                continue
            if (ev.get("request_id"), r["time"]) in vistos:
                continue
            vistos.add((ev["request_id"], r["time"]))
            por_v[ev["model_version"]] = por_v.get(ev["model_version"], 0) + 1
    con = duckdb.connect()
    vistas = {}
    for o in objs:
        m = re.search(r"model_version=([^/]+)/", o["Key"])
        exige(m, f"{o['Key']}: la carpeta de cada versión es model_version=<v>/")
        raw = c.get_object(Bucket=BUCKET, Key=o["Key"])["Body"].read()
        tmp = Path(RAIZ / "logs" / ".verificar.parquet")
        tmp.write_bytes(raw)
        cols = {r[0]: r[1] for r in con.execute(f"DESCRIBE SELECT * FROM '{tmp}'").fetchall()}
        for col in ("hora", "request_id", "model_version", "status", "ms_total", "nodo"):
            exige(col in cols, f"{o['Key']}: falta la columna {col}")
        exige("TIMESTAMP" in cols["hora"], f"hora tiene que ser TIMESTAMP (es {cols['hora']})")
        n, rep, otra = con.execute(f"SELECT count(*), count(*) - count(DISTINCT (request_id, hora)), "
                                   f"count(*) FILTER (WHERE model_version <> ?) FROM '{tmp}'", [m.group(1)]).fetchone()
        exige(rep == 0, f"{o['Key']}: {rep} filas repetidas (Fluent Bit entrega al menos una vez: quita los repetidos)")
        exige(otra == 0, f"{o['Key']}: {otra} filas de otra versión en esta carpeta")
        vistas[m.group(1)] = vistas.get(m.group(1), 0) + n
        tmp.unlink()
    exige(vistas == por_v, f"filas por versión en el Parquet: {vistas}; en el crudo de ayer hay {por_v} "
                           "(incluye la hora 00 de hoy, sin repetidos ni stderr)")
    return f"dt={ayer} · " + " · ".join(f"{v}: {n:,} filas" for v, n in sorted(vistas.items())) + " · cuadra con el crudo"


def check_de_punta_a_punta() -> str:
    st, b, h = por_alb({"X-Request-ID": (rid := str(uuid.uuid4()))})
    exige(st == 200, f"una foto por el ALB da {st} ({b[:120].decode(errors='replace')}): mira las métricas del ALB (curl localhost:8957/metrics) "
                     "y su access log (logs/alb.log); el gateway puede no haberla visto nunca")
    d = json.loads(b)
    exige(d.get("model_version") and h.get("x-request-id") == rid, "la respuesta trae model_version y el X-Request-ID")
    a = prom("sum(rate(alb_request_count_total[1m]))")
    g = prom('sum(rate(classifier_requests_total{code!="404"}[1m]))')
    elb = prom('sum(rate(alb_httpcode_elb_total{code=~"5..|401"}[1m]))')
    exige(a and g, "Prometheus no tiene la tasa del ALB y la del gateway (¿corre el tráfico de siempre? python mundo/nodo.py estado)")
    ta, tg = float(a[0]["value"][1]), float(g[0]["value"][1])
    exige(ta > 1, f"el ALB lleva {ta:.2f} requests/s al gateway y el tráfico de siempre son 5: python mundo/nodo.py arrancar trafico")
    exige(abs(ta - tg) <= max(0.15 * ta, 0.5), f"el ALB manda {ta:.1f} req/s a los pods y el gateway cuenta {tg:.1f}: algo se pierde o se cuenta doble")
    te = float(elb[0]["value"][1]) if elb else 0.0
    exige(te <= 0.05 * ta, f"el ALB contesta {te:.1f} req/s él mismo (401/5xx): esas requests nunca llegan al gateway")
    return f"200 con model_version y X-Request-ID · ALB {ta:.1f} req/s ≈ gateway {tg:.1f} req/s · el ALB no contesta por su cuenta"


CHECKS = {
    "mundo": check_mundo, "request-id": check_request_id, "linea-log": check_linea_log, "metricas": check_metricas,
    "reglas-de-conteo": check_reglas_de_conteo, "prometheus-lee": check_prometheus_lee, "consultas": check_consultas,
    "alertas": check_alertas, "series-acotadas": check_series_acotadas, "log-en-s3": check_log_en_s3,
    "parquet": check_parquet, "de-punta-a-punta": check_de_punta_a_punta,
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
            print(f"{'✓' if ok else '✗'} {i:<17} {msg}", flush=True)
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
