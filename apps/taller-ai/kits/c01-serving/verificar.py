"""Revisa los criterios de «listo» de la estación, uno por check. No cambia nada (plazos congela a Triton 2 s y lo
despierta; topes corre tu gateway dentro del proceso, con un Triton falso).

    python verificar.py                    # todos (≈ 25 s)
    python verificar.py config triton      # algunos

Necesita el entorno virtual activo (source .venv/bin/activate), el mundo arriba (docker compose up -d --wait) y, desde
el paso 5, los dos procesos corriendo (python mundo/servicios.py arrancar).
"""
from __future__ import annotations

import asyncio
import hashlib
import importlib
import json
import os
import re
import signal
import socket
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mundo.comun import (CKPT, DATOS, GATEWAY, GATEWAY_YAML, GOLDEN, GW, LOGS, MODELO_JSON, RAIZ, RARAS, REPO,  # noqa: E402
                         REVISIONES, TRITON, arriba, artefacto, gateway_yaml, git, golden_fotos, golden_manifest,
                         labels_sha, leer_json, mlflow_arriba, mlflow_cliente, s3, servir_yaml, sha256)

TUS_ARCHIVOS = ["gateway", "servir/armar.py", "model_repository", "gateway.yaml", "servir.yaml"]
N_RESPONDE = 200
BASE_MIB = 150          # lo que ocupa el proceso del gateway sin requests (Python, FastAPI, numpy, Pillow), medido


class Falla(Exception):
    pass


def exige(cond, msg: str) -> None:
    if not cond:
        raise Falla(msg)


_cache: dict = {}


def cliente():
    exige(mlflow_arriba(), "MLflow no responde en localhost:5700: docker compose ps (¿está arriba el servicio mlflow?)")
    if "ml" not in _cache:
        _cache["ml"] = mlflow_cliente()
    return _cache["ml"]


def version():
    cfg = servir_yaml()
    return cfg, cliente().get_model_version(cfg["modelo"], str(cfg["version"]))


def ficha() -> dict:
    m = leer_json(MODELO_JSON)
    exige(m, "falta servir/modelo.json: python servir/armar.py (paso 2)")
    return m


def http(metodo: str, ruta: str, cuerpo: bytes | None = None, headers: dict | None = None, timeout: float = 5,
         base: str = GW):
    """(código, headers, cuerpo) de una request; código None si nadie contesta a tiempo."""
    import urllib.error
    import urllib.request

    req = urllib.request.Request(base + ruta, data=cuerpo, method=metodo, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()
    except Exception:  # noqa: BLE001
        return None, {}, b""


def clasificar(foto: bytes, tipo: str = "image/jpeg", rid: str | None = None, consulta: str = "", timeout: float = 5):
    h = {"Content-Type": tipo, **({"X-Request-ID": rid} if rid else {}), "X-Caller-Id": "verificar"}
    return http("POST", f"/v1/classify{consulta}", foto, h, timeout)


def gateway_arriba() -> None:
    exige(arriba(f"{GW}/healthz", 2) == 200, "tu gateway no responde en localhost:8701: python mundo/servicios.py estado "
                                              "(y logs/gateway.log)")


def triton_pid() -> int | None:
    p = LOGS / "triton.pid"
    if not p.exists():
        return None
    pid = int(p.read_text())
    try:
        os.kill(pid, 0)
        return pid
    except ProcessLookupError:
        return None


def lineas_log() -> list[dict]:
    p = LOGS / "gateway.log"
    out = []
    for x in (p.read_text(errors="replace").splitlines() if p.exists() else []):
        if x.startswith("{"):
            try:
                out.append(json.loads(x))
            except json.JSONDecodeError:
                pass
    return out


def referencia() -> tuple[list[dict], list[bytes], "object"]:
    """Las primeras fotos del examen y los logits del engine APROBADO (con la huella de la ficha), corridos aquí."""
    if "ref" not in _cache:
        import numpy as np
        import onnxruntime as ort

        from gateway.app.preprocess import preprocess

        f = ficha()
        local = REPO / "classifier" / "1" / "model.onnx"
        if local.exists() and sha256(local.read_bytes()) == f["engine_sha256"]:
            b = local.read_bytes()          # el del repositorio, si es el que armar.py verificó contra el registro
        else:
            cfg, mv = version()
            b = artefacto(mv.run_id, "engine/engine.onnx")
            exige(b and sha256(b) == mv.tags.get("engine_sha256"), f"el engine de v{cfg['version']} en el registro no tiene su huella")
        so = ort.SessionOptions()
        so.log_severity_level = 3
        s = ort.InferenceSession(b, so, providers=["CPUExecutionProvider"])
        _, fotos = golden_manifest(s3())
        fotos = fotos[:N_RESPONDE]
        datos = golden_fotos(s3(), fotos)
        x = np.stack([preprocess(d) for d in datos])
        _cache["ref"] = (fotos, datos, s.run(None, {s.get_inputs()[0].name: x})[0])
    return _cache["ref"]


# ---------------------------------------------------------------- checks
def check_mundo() -> str:
    s = s3()
    try:
        hay = {b["Name"] for b in s.list_buckets()["Buckets"]}
    except Exception as e:  # noqa: BLE001
        raise Falla(f"el S3 local no responde en localhost:9700 ({type(e).__name__}): docker compose up -d --wait")
    exige({DATOS, CKPT} <= hay, f"faltan buckets ({sorted({DATOS, CKPT} - hay)}): python mundo/crear.py")
    try:
        golden_manifest(s)
    except Exception:  # noqa: BLE001
        raise Falla(f"falta el examen {GOLDEN} en s3://{DATOS}/: python mundo/crear.py")
    c = cliente()
    vs = c.search_model_versions("name = 'classifier'")
    exige(len(vs) >= 4, f"el registro tiene {len(vs)} versiones de classifier; se esperan 4: python mundo/crear.py")
    cfg, mv = version()
    exige(mv.tags.get("engine") == "listo" and mv.tags.get("gate") == "passed",
          f"v{cfg['version']} tiene gate={mv.tags.get('gate')} y engine={mv.tags.get('engine')}: python mundo/crear.py")
    exige((RARAS / "LEEME.txt").exists(), "falta fotos-raras/: python mundo/crear.py")
    exige(git("rev-parse", "--is-inside-work-tree") == "true", "esta carpeta no es un repositorio de git: git init (paso 0)")
    exige(git("rev-parse", "HEAD"), "el repositorio no tiene commits todavía: git add -A && git commit -m kit")
    al = c.get_registered_model("classifier").aliases
    return (f"S3 local ({GOLDEN}, checkpoints) · MLflow: classifier v1–v{len(vs)}, @champion = v{al.get('champion')}, "
            f"@challenger = v{al.get('challenger')} · servir.yaml: v{cfg['version']} (engine listo) · fotos-raras/ · git")


def check_reglas() -> str:
    sha = sha256(GATEWAY_YAML.read_bytes())
    ok = {r["gateway_yaml_sha256"]: r for r in json.loads(REVISIONES.read_text())["aprobadas"]}
    r = gateway_yaml()
    pl, lim = r["plazos_ms"], r["limites"]
    pico = (lim["en_vuelo"] * lim["max_bytes"] + lim["decodes"] * lim["max_pixeles"] * 8) / 2**20 + BASE_MIB
    malos = []
    if sha not in ok:
        malos.append(f"gateway.yaml ({sha[:12]}…) no es ninguna versión revisada (mundo/revisiones.json): git log -p gateway.yaml")
    if not pl["app"] > pl["gateway"] > pl["triton"] > pl["fila_triton"]:
        malos.append(f"la cadena de plazos no baja: {pl['app']} > {pl['gateway']} > {pl['triton']} > {pl['fila_triton']}")
    if pico > lim["memoria_mib"]:
        malos.append(f"en el peor momento una copia ocuparía ≈ {pico:,.0f} MiB y tiene {lim['memoria_mib']}")
    sucio = git("status", "--porcelain", "--", *TUS_ARCHIVOS)
    if sucio:
        malos.append(f"hay cambios sin commit ({(sucio.splitlines() or [''])[0].strip()}): git status, git diff")
    exige(not malos, " · ".join(malos))
    return (f"gateway.yaml = la revisión del PR #{ok[sha]['pr']} · plazos {pl['app']} > {pl['gateway']} > {pl['triton']} > "
            f"{pl['fila_triton']} ms · peor momento ≈ {pico:,.0f} MiB de {lim['memoria_mib']} · sin cambios pendientes")


def check_repositorio() -> str:
    cfg, mv = version()
    t = mv.tags
    lab = artefacto(mv.run_id, "modelo/labels.json")
    exige(lab and sha256(lab) == t.get("labels_sha256"),
          f"el labels.json de v{cfg['version']} en el registro no tiene la huella de su tag labels_sha256: python mundo/modelos.py labels {cfg['version']}")
    m = REPO / cfg["modelo"]
    versiones = sorted(d.name for d in m.iterdir() if d.is_dir()) if m.exists() else []
    exige(versiones == ["1"], f"model_repository/{cfg['modelo']}/ tiene las versiones {versiones}; se espera solo 1/: python servir/armar.py")
    eng = m / "1" / "model.onnx"
    exige(eng.exists(), f"falta model_repository/{cfg['modelo']}/1/model.onnx: python servir/armar.py")
    exige(sha256(eng.read_bytes()) == t["engine_sha256"],
          f"model_repository/{cfg['modelo']}/1/model.onnx tiene huella {sha256(eng.read_bytes())[:12]}… y v{cfg['version']} "
          f"dice {t['engine_sha256'][:12]}…: no es el engine aprobado")
    f = ficha()
    exige(f.get("version") == int(cfg["version"]) and f.get("model_version") == cfg["nombre"],
          f"servir/modelo.json es de v{f.get('version')} ({f.get('model_version')}); servir.yaml dice v{cfg['version']} ({cfg['nombre']})")
    exige(f.get("engine_sha256") == t["engine_sha256"], "servir/modelo.json no trae la huella del engine de la versión")
    exige(labels_sha(f.get("labels", [])) == t["labels_sha256"] == f.get("labels_sha256"),
          "los labels de servir/modelo.json no son los de la versión (orden o huella)")
    return (f"classifier v{cfg['version']} → model_repository/{cfg['modelo']}/1/model.onnx ({t['engine_sha256'][:12]}… = su tag) · "
            f"servir/modelo.json: {cfg['nombre']}, {len(f['labels'])} labels ({t['labels_sha256'][:12]}… = su tag)")


def config_pbtxt() -> dict:
    from mundo.triton_dojo.servidor import ErrorConfig, parsear_pbtxt

    p = REPO / "classifier" / "config.pbtxt"
    exige(p.exists(), "falta model_repository/classifier/config.pbtxt (paso 3)")
    try:
        return parsear_pbtxt(p.read_text())
    except ErrorConfig as e:
        raise Falla(f"config.pbtxt no se puede leer: {e}") from None


def check_config() -> str:
    c = config_pbtxt()
    f = ficha()
    exige(c.get("name") == "classifier" and c.get("platform") == "onnxruntime_onnx",
          f"name «{c.get('name')}» y platform «{c.get('platform')}»: se esperan classifier y onnxruntime_onnx")
    mb = c.get("max_batch_size", 0)
    bmax = int(version()[1].tags.get("batch_max", 32)) if mlflow_arriba() else 32   # el tag del engine (sin MLflow, el de la estación 5)
    exige(0 < mb <= bmax, f"max_batch_size {mb}: el engine acepta hasta {bmax}")
    for decl, real in [(c.get("input", [{}])[0], f["entrada"]), (c.get("output", [{}])[0], f["salida"])]:
        exige(decl.get("name") == real["nombre"], f"el config.pbtxt dice «{decl.get('name')}» y el engine «{real['nombre']}»")
        exige(decl.get("data_type") == "TYPE_FP32", f"{decl.get('name')}: data_type {decl.get('data_type')}; el engine es FP32")
        exige(list(decl.get("dims", [])) == real["forma"][1:],
              f"{decl.get('name')}: dims {decl.get('dims')}; el engine es {real['forma']} (dims va sin el eje del batch)")
    db = c.get("dynamic_batching")
    exige(db, "falta dynamic_batching")
    exige(0 < db.get("max_queue_delay_microseconds", 0) <= 5000,
          f"max_queue_delay_microseconds {db.get('max_queue_delay_microseconds')}: una ventana de hasta 5 ms (C01: 2,000 µs)")
    pol = db.get("default_queue_policy", {})
    fila = gateway_yaml()["plazos_ms"]["fila_triton"]
    exige(pol.get("timeout_action") == "REJECT" and pol.get("default_timeout_microseconds") == fila * 1000,
          f"la fila tiene que rechazar (REJECT) a los {fila * 1000} µs (plazos_ms.fila_triton de gateway.yaml); dice "
          f"{pol.get('timeout_action')} a los {pol.get('default_timeout_microseconds')} µs")
    ig = c.get("instance_group", [])
    copias = sum(g.get("count", 1) for g in ig)
    exige(ig and all(g.get("kind") == "KIND_CPU" for g in ig) and copias >= 2, f"instance_group: {copias} copia(s); se esperan 2, KIND_CPU")
    w = c.get("model_warmup", [])
    exige(w and w[0].get("batch_size") == mb, "model_warmup: un batch de ceros del tamaño máximo antes de decir «listo»")
    exige(c.get("version_policy", {}).get("latest", {}).get("num_versions") == 1, "version_policy: { latest { num_versions: 1 } }")
    exige(git("ls-files", "model_repository/classifier/config.pbtxt"), "config.pbtxt no está en git: git add y git commit")
    return (f"onnxruntime_onnx · batch hasta {mb} · {f['entrada']['nombre']} {f['entrada']['forma'][1:]} → "
            f"{f['salida']['nombre']} {f['salida']['forma'][1:]} · ventana {db['max_queue_delay_microseconds']} µs · "
            f"fila REJECT a los {fila} ms · {copias} copias · warmup · en git")


def check_triton() -> str:
    pid = triton_pid()
    exige(pid, "el servidor de modelos no corre: python mundo/servicios.py arrancar triton (y logs/triton.log)")
    st = arriba(f"{TRITON}/v2/health/ready", 1)
    exige(st == 200, f"Triton no dice «listo» (/v2/health/ready → {st or 'sin respuesta en 1 s'}): python mundo/servicios.py estado")
    _, _, b = http("GET", "/v2/models/classifier", base=TRITON)
    meta = json.loads(b or b"{}")
    f = ficha()
    exige(meta.get("inputs", [{}])[0].get("shape") == f["entrada"]["forma"] and meta.get("outputs", [{}])[0].get("shape") == f["salida"]["forma"],
          f"Triton sirve {meta.get('inputs')} → {meta.get('outputs')}; la ficha dice {f['entrada']} → {f['salida']}")
    _, _, b = http("GET", "/v2/models/classifier/config", base=TRITON)
    servida = {k: v for k, v in json.loads(b or b"{}").items() if k != "name"}
    exige(servida == {k: v for k, v in config_pbtxt().items() if k != "name"},
          "Triton corre con otro config.pbtxt del que está en disco: carga solo al arrancar (python mundo/servicios.py reiniciar triton)")
    log = (LOGS / "triton.log").read_text(errors="replace")
    cargados = re.findall(r"successfully loaded 'classifier' version (\d+) .*?model\.onnx sha256 ([0-9a-f]{12})", log)
    exige(cargados, "logs/triton.log no dice qué engine cargó")
    eng = REPO / "classifier" / "1" / "model.onnx"
    exige(cargados[-1][1] == sha256(eng.read_bytes())[:12] == f["engine_sha256"][:12],
          f"Triton cargó el engine {cargados[-1][1]}… y el aprobado es {f['engine_sha256'][:12]}…: "
          "python servir/armar.py y python mundo/servicios.py reiniciar triton")
    return f"PID {pid} · listo · classifier versión {cargados[-1][0]} con el engine {cargados[-1][1]}… · su config = la de disco"


def check_salud() -> str:
    gateway_arriba()
    st, _, b = http("GET", "/healthz")
    exige(json.loads(b or b"{}") == {"status": "ok"}, f"/healthz contesta {b[:80]!r}; se espera {{\"status\": \"ok\"}}")
    st, _, _ = http("GET", "/readyz", timeout=2)
    exige(st == 200, f"/readyz → {st}: Triton no está listo o tu gateway no lo sabe preguntar (python mundo/servicios.py estado)")
    _, _, m = http("GET", "/metrics")
    m = m.decode()
    faltan = [n for n in ("classifier_requests_total", "classifier_request_seconds", "classifier_preprocess_seconds",
                          "classifier_inference_seconds", "classifier_top1_score", "classifier_image_bytes") if n not in m]
    exige(not faltan, f"a /metrics le faltan {faltan}: las alertas buscan esos nombres")
    return "/healthz {\"status\": \"ok\"} · /readyz 200 · /metrics con sus 6 nombres"


def check_responde() -> str:
    import numpy as np

    gateway_arriba()
    fotos, datos, logits = referencia()
    cfg = servir_yaml()
    labels = ficha()["labels"]

    def una(i):
        rid = f"verificar-{i:04d}-{uuid.uuid4().hex[:6]}"
        st, h, b = clasificar(datos[i], rid=rid, consulta="?top_k=3")
        return st, h, b, rid

    t = time.time()
    with ThreadPoolExecutor(8) as ex:
        rs = list(ex.map(una, range(len(datos))))
    dt = time.time() - t
    malos = [(i, st) for i, (st, *_r) in enumerate(rs) if st != 200]
    exige(not malos, f"{len(malos)} de {len(datos)} fotos del examen no dieron 200 (la primera: {fotos[malos[0][0]]['id']} → {malos[0][1]})" if malos else "")
    distintos, dmax = [], 0.0
    for i, (st, h, b, rid) in enumerate(rs):
        r = json.loads(b)
        exige(h.get("X-Request-ID") == rid or h.get("x-request-id") == rid, "la respuesta no trae el X-Request-ID que se mandó")
        exige(r.get("model_version") == cfg["nombre"], f"model_version «{r.get('model_version')}»; servir.yaml dice {cfg['nombre']}")
        exige(len(r["predictions"]) == 3, "con top_k=3 se esperan 3 predicciones")
        z = logits[i].astype(np.float64)
        p = np.exp(z - z.max())
        p /= p.sum()
        if r["predictions"][0]["label"] != labels[int(p.argmax())]:
            distintos.append(fotos[i]["id"])
        dmax = max(dmax, abs(r["predictions"][0]["score"] - float(p.max())))
    exige(not distintos, f"{len(distintos)} de {len(datos)} fotos tienen otro top-1 que el engine aprobado (la primera: "
                         f"{distintos[0] if distintos else ''}): lo que sirves no es el modelo aprobado o no lo preparas igual")
    exige(dmax <= 1e-4 + 1e-6, f"el score del top-1 se separa {dmax:.5f} del engine aprobado (se espera ≤ 0.0001: 4 decimales)")
    st, h, _ = clasificar(datos[0])
    exige(st == 200 and (h.get("X-Request-ID") or h.get("x-request-id")), "sin X-Request-ID, el gateway tiene que generar uno")
    for k in (1, 10):
        _, _, b = clasificar(datos[0], consulta=f"?top_k={k}")
        exige(len(json.loads(b)["predictions"]) == k, f"con top_k={k} se esperan {k} predicciones")
    return (f"{len(datos)} fotos del examen por HTTP: 200, el mismo top-1 que el engine aprobado (score ± {dmax:.4f}) · "
            f"{cfg['nombre']} · X-Request-ID · top_k 1/3/10 · {len(datos) / dt:.0f} fotos/s con 8 a la vez")


def enviar_crudo(cabecera: bytes, trozos: list[bytes], cerrar_sin_leer: bool = False, timeout: float = 5) -> int | None:
    """Una request a mano por un socket: para mandar un body sin Content-Length o irse a media subida."""
    s = socket.create_connection(("127.0.0.1", 8701), timeout=timeout)
    try:
        s.sendall(cabecera)
        for t in trozos:
            try:
                s.sendall(t)
            except (BrokenPipeError, ConnectionResetError):
                break
        if cerrar_sin_leer:
            return None
        datos = b""
        try:
            while b"\r\n" not in datos:
                d = s.recv(4096)
                if not d:
                    break
                datos += d
        except (ConnectionResetError, TimeoutError):
            pass
        m = re.match(rb"HTTP/1\.1 (\d+)", datos)
        return int(m.group(1)) if m else None
    finally:
        s.close()


def check_rechazos() -> str:
    gateway_arriba()
    R = RARAS
    casos = [("tenis.jpg", "image/jpeg", 200), ("tenis.png", "image/png", 200), ("tenis.webp", "image/webp", 200),
             ("tenis-girada.jpg", "image/jpeg", 200), ("documento.pdf", "application/pdf", 415),
             ("vacia.jpg", "image/jpeg", 400), ("gigante.png", "image/png", 413), ("tira.png", "image/png", 400),
             ("corrupta.jpg", "image/jpeg", 400), ("cortada.jpg", "image/jpeg", 400)]
    malos = []
    for n, tipo, esperado in casos:
        st, h, b = clasificar((R / n).read_bytes(), tipo, rid=f"verificar-{n}")
        if st != esperado or not (h.get("X-Request-ID") or h.get("x-request-id")):
            malos.append(f"{n} → {st} (se espera {esperado}{', con X-Request-ID' if st == esperado else ''})")
    grande = 10 * 1024 * 1024 + 1        # el gateway contesta 413 con solo ver el header y cierra: no se manda el body entero
    st = enviar_crudo(b"POST /v1/classify HTTP/1.1\r\nHost: localhost\r\nContent-Type: image/jpeg\r\nContent-Length: %d\r\n"
                      b"X-Request-ID: verificar-11mib\r\n\r\n" % grande, [os.urandom(grande)])
    if st != 413:
        malos.append(f"11 MiB con Content-Length → {st} (se espera 413)")
    cab = (b"POST /v1/classify HTTP/1.1\r\nHost: localhost\r\nContent-Type: image/jpeg\r\nTransfer-Encoding: chunked\r\n"
           b"X-Request-ID: verificar-sin-largo\r\n\r\n")
    trozo = b"x" * (1024 * 1024)
    st = enviar_crudo(cab, [b"%x\r\n" % len(trozo) + trozo + b"\r\n"] * 11 + [b"0\r\n\r\n"])
    if st != 413:
        malos.append(f"11 MiB sin Content-Length → {st} (se espera 413: se corta al leer)")
    st, h, _ = clasificar((R / "tenis.jpg").read_bytes(), consulta="?top_k=50", rid="verificar-422")
    if st != 422:
        malos.append(f"top_k=50 → {st} (se espera 422)")
    st, _, _ = http("GET", "/v1/classify", headers={"X-Request-ID": "verificar-405"})
    if st != 405:
        malos.append(f"GET /v1/classify → {st} (se espera 405)")
    rid499 = f"verificar-499-{uuid.uuid4().hex[:6]}"
    enviar_crudo(b"POST /v1/classify HTTP/1.1\r\nHost: localhost\r\nContent-Type: image/jpeg\r\nContent-Length: 5000\r\n"
                 b"X-Request-ID: " + rid499.encode() + b"\r\n\r\n", [b"\xff\xd8" + b"x" * 98], cerrar_sin_leer=True)
    time.sleep(0.5)
    st499 = [ln.get("status") for ln in lineas_log() if ln.get("request_id") == rid499]
    if st499 != [499]:
        malos.append(f"quien llama se va a media subida → en el log {st499 or 'nada'} (se espera una línea con 499)")
    exige(not malos, "; ".join(malos))
    return "200 ×4 (jpeg, png, webp, girada) · 415 pdf · 400 vacía, tira, corrupta, cortada · 413 por píxeles, por header y al leer · 422 · 405 · 499 en el log"


def check_topes() -> str:
    """Tu gateway dentro de este proceso, con un Triton falso: la 17, Triton lento, con error, caído, logits NaN y /readyz."""
    import io

    import aiohttp
    import httpx
    import numpy as np
    from tritonclient.utils import InferenceServerException

    sys.path.insert(0, str(GATEWAY))
    for k in [k for k in sys.modules if k == "app" or k.startswith("app.")]:
        del sys.modules[k]
    try:
        main = importlib.import_module("app.main")
    except Exception as e:  # noqa: BLE001
        raise Falla(f"no pude importar gateway/app/main.py: {type(e).__name__}: {str(e)[:160]}") from None
    exige(hasattr(main, "crear_app"), "gateway/app/main.py no tiene crear_app(triton=…, reglas=…, modelo=…)")

    class Res:
        def __init__(self, y):
            self.y = y

        def as_numpy(self, _):
            return self.y

    class Falso:
        def __init__(self, demora=0.0, error=None, logits=None, demora_listo=0.0):
            self.demora, self.error, self.demora_listo = demora, error, demora_listo
            self.logits = np.array(logits or [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 2.0, 0.0, 1.0], np.float32)

        async def get_model_metadata(self, nombre):
            return {"name": nombre, "inputs": [{"name": "input", "datatype": "FP32", "shape": [-1, 3, 32, 32]}],
                    "outputs": [{"name": "logits", "datatype": "FP32", "shape": [-1, 10]}]}

        async def is_model_ready(self, _):
            await asyncio.sleep(self.demora_listo)
            return True

        async def infer(self, model_name, inputs, outputs=None, request_id="", **kw):
            await asyncio.sleep(self.demora)
            if self.error:
                raise self.error
            return Res(np.tile(self.logits, (list(inputs[0].shape())[0], 1)))

        async def close(self):
            pass

    from PIL import Image

    b = io.BytesIO()
    Image.new("RGB", (56, 56), (90, 90, 90)).save(b, "JPEG")
    foto = b.getvalue()
    fic = ficha()
    malos = []

    async def correr(triton, n=1, ruta="/v1/classify", metodo="POST"):
        app = main.crear_app(triton=triton, reglas=gateway_yaml(), modelo=fic)
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://gw", timeout=10) as c:
                t = time.monotonic()
                if metodo == "GET":
                    rs = [await c.get(ruta)]
                else:
                    rs = await asyncio.gather(*(c.post(ruta, content=foto, headers={"Content-Type": "image/jpeg"}) for _ in range(n)))
                return rs, time.monotonic() - t

    import contextlib

    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        lim = gateway_yaml()["limites"]["en_vuelo"]
        rs, _ = asyncio.run(correr(Falso(demora=0.1), n=lim + 4))
        cod = sorted(r.status_code for r in rs)
        if cod != [200] * lim + [503] * 4 or any(r.headers.get("retry-after") != "1" for r in rs if r.status_code == 503):
            malos.append(f"{lim + 4} a la vez → {dict((c, cod.count(c)) for c in set(cod))} (se esperan {lim} × 200 y 4 × 503 con Retry-After: 1)")
        rs, dt = asyncio.run(correr(Falso(demora=3.0)))
        if rs[0].status_code != 504 or not 0.12 < dt < 0.4:
            malos.append(f"Triton tarda 3 s → {rs[0].status_code} a los {dt * 1000:.0f} ms (se espera 504 a los ≈ 150)")
        rs, _ = asyncio.run(correr(Falso(error=InferenceServerException("Request timeout expired", status="503"))))
        if rs[0].status_code != 503:
            malos.append(f"Triton contesta con error → {rs[0].status_code} (se espera 503)")
        rs, _ = asyncio.run(correr(Falso(error=aiohttp.ClientConnectionError("Connection refused"))))
        if rs[0].status_code != 503 or rs[0].headers.get("retry-after") != "1":
            malos.append(f"Triton caído → {rs[0].status_code} {dict(rs[0].headers).get('retry-after')} (se espera 503 con Retry-After: 1)")
        rs, _ = asyncio.run(correr(Falso(logits=[float("nan")] + [0.0] * 9)))
        if rs[0].status_code != 500:
            malos.append(f"logits NaN → {rs[0].status_code} (se espera 500, nunca un 200 con basura)")
        rs, dt = asyncio.run(correr(Falso(demora_listo=5.0), ruta="/readyz", metodo="GET"))
        if rs[0].status_code != 503 or dt > 1.0:
            malos.append(f"Triton no contesta /ready → /readyz {rs[0].status_code} a los {dt:.1f} s (se espera 503 en ≤ 0.5 s)")
        rs, _ = asyncio.run(correr(Falso(demora_listo=5.0), ruta="/healthz", metodo="GET"))
        if rs[0].status_code != 200:
            malos.append(f"/healthz con Triton trabado → {rs[0].status_code} (se espera 200: no le pregunta a nadie)")
    exige(not malos, "; ".join(malos))
    return f"la {lim + 1} en vuelo → 503 al instante · Triton lento → 504 a los ≈ 150 ms · con error → 503 · caído → 503 + Retry-After · NaN → 500 · /readyz ≤ 0.5 s · /healthz no pregunta"


def check_plazos() -> str:
    """Congela de verdad al servidor de modelos 2 s (SIGSTOP) y lo despierta (SIGCONT)."""
    gateway_arriba()
    pid = triton_pid()
    exige(pid, "el servidor de modelos no corre: python mundo/servicios.py arrancar triton")
    exige(arriba(f"{TRITON}/v2/health/ready", 1) == 200, "Triton no está listo: python mundo/servicios.py estado")
    foto = (RARAS / "tenis.jpg").read_bytes()
    os.kill(pid, signal.SIGSTOP)
    try:
        t = time.monotonic()
        st, _, _ = clasificar(foto, rid="verificar-plazo", timeout=3)
        dt = time.monotonic() - t
        t = time.monotonic()
        st_listo, _, _ = http("GET", "/readyz", timeout=3)
        dt_listo = time.monotonic() - t
        st_vivo, _, _ = http("GET", "/healthz", timeout=3)
    finally:
        os.kill(pid, signal.SIGCONT)
    malos = []
    if st != 504 or not 0.12 < dt < 0.35:
        malos.append(f"con Triton congelado, classify → {st} a los {dt * 1000:.0f} ms (se espera 504 a los ≈ 150: plazo min(triton, lo que queda))")
    if st_listo != 503 or dt_listo > 1.0:
        malos.append(f"/readyz → {st_listo} a los {dt_listo:.2f} s (se espera 503 en ≤ listo_timeout_ms)")
    if st_vivo != 200:
        malos.append(f"/healthz → {st_vivo} (se espera 200: el gateway sigue vivo)")
    time.sleep(0.3)
    st2, _, _ = clasificar(foto)
    if st2 != 200:
        malos.append(f"al despertar a Triton, classify → {st2} (se espera 200)")
    exige(not malos, "; ".join(malos))
    return f"Triton congelado 2 s: classify 504 a los {dt * 1000:.0f} ms · /readyz 503 en {dt_listo * 1000:.0f} ms · /healthz 200 · al despertar, 200"


def check_log() -> str:
    gateway_arriba()
    _, _, m0 = http("GET", "/metrics")
    cnt = lambda m: float(re.search(rb"^classifier_request_seconds_count (\S+)$", m, re.M).group(1)) if re.search(rb"^classifier_request_seconds_count", m, re.M) else 0.0  # noqa: E731
    rids = {f"verificar-log-{k}-{uuid.uuid4().hex[:6]}": k for k in ("200", "415", "422")}
    foto = (RARAS / "tenis.jpg").read_bytes()
    for rid, k in rids.items():
        if k == "200":
            clasificar(foto, rid=rid)
        elif k == "415":
            clasificar(b"%PDF", "application/pdf", rid=rid)
        else:
            clasificar(foto, rid=rid, consulta="?top_k=0")
    time.sleep(0.3)
    _, _, m1 = http("GET", "/metrics")
    lineas = lineas_log()
    for rid, k in rids.items():
        mias = [ln for ln in lineas if ln.get("request_id") == rid]
        exige(len(mias) == 1, f"la request {k} dejó {len(mias)} líneas en logs/gateway.log (se espera exactamente 1)")
        ln = mias[0]
        exige(str(ln.get("status")) == k, f"la línea de la request {k} dice status {ln.get('status')}")
        faltan = [c for c in ("request_id", "caller", "source", "model_version", "ms", "status") if c not in ln]
        exige(not faltan, f"a la línea de la request {k} le faltan {faltan}")
        exige(len(json.dumps(ln)) < 600, f"la línea de la request {k} pesa {len(json.dumps(ln))} B: ¿lleva la foto?")
        if k == "200":
            faltan = [c for c in ("top5", "bytes", "sha256") if c not in ln] + [c for c in ("pre", "triton", "post", "total") if c not in ln["ms"]]
            exige(not faltan, f"a la línea del 200 le faltan {faltan}")
            exige(len(ln["sha256"]) == 12 and ln["caller"] == "verificar", "sha256 va con 12 caracteres y caller sale de X-Caller-Id")
        else:
            exige(ln.get("error"), f"la línea del {k} no dice el error")
    exige(cnt(m1) - cnt(m0) == 1, f"classifier_request_seconds contó {cnt(m1) - cnt(m0):.0f} requests de 3; se espera solo el 200 (sin los 4xx)")
    return "una línea de JSON por request (también el 422), con request_id, caller, source, model_version, ms y status; sin la foto · la latencia sin los 4xx"


def check_pruebas() -> str:
    import subprocess

    t = time.time()
    r = subprocess.run([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider"], cwd=RAIZ, capture_output=True,
                       text=True, timeout=180, env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
    dt = time.time() - t
    fin = (r.stdout.strip().splitlines() or [""])[-1]
    pasan = int(m.group(1)) if (m := re.search(r"(\d+) passed", fin)) else 0
    exige(r.returncode == 0, f"pytest no pasa: {fin or r.stderr.strip()[-200:]}")
    exige(pasan >= 15, f"{pasan} pruebas; se esperan al menos 15 (la tabla de códigos, los topes, la salud y el log)")
    return f"{pasan} pruebas en {dt:.1f} s, sin Triton"


CHECKS = {
    "mundo": check_mundo, "reglas": check_reglas, "repositorio": check_repositorio, "config": check_config,
    "triton": check_triton, "salud": check_salud, "responde": check_responde, "rechazos": check_rechazos,
    "topes": check_topes, "plazos": check_plazos, "log": check_log, "pruebas": check_pruebas,
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
            print(f"{'✓' if ok else '✗'} {i:<11} {msg}", flush=True)
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
