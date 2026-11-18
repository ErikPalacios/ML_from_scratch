"""El servidor de modelos del dojo: el sustituto de Triton Inference Server en tu Mac (sin GPU, sin imagen de ≈ 10 GB).

    python mundo/triton_dojo/servidor.py --model-repository=model_repository --http-port=8700 \
        --model-control-mode=none --strict-readiness=true --exit-on-error=true --disable-auto-complete-config

En la estación 8 corre en su contenedor (`triton` en compose.yaml), con un modelo de juguete del mismo contrato.
No es parte de lo que escribes y no lo leas para resolver un paso: se porta como Triton en lo que esta estación usa.

Lo que hace igual que Triton (lo que tu gateway y tu config.pbtxt necesitan):
- Lee el model repository: <modelo>/config.pbtxt (formato de texto de protobuf) y <modelo>/<versión>/model.onnx.
  Un campo que no existe en la configuración de Triton es un error, y no rellena lo que falta (auto-complete apagado).
- Revisa el config.pbtxt contra el modelo: nombres, tipos y formas de la entrada y la salida, con `dims` SIN el eje del
  batch cuando max_batch_size > 0 (Triton le antepone -1).
- Batching dinámico: max_queue_delay_microseconds, preferred_batch_size, la política de la fila
  (default_queue_policy: timeout_action REJECT y default_timeout_microseconds) y max_batch_size.
- instance_group: varias copias del modelo (aquí KIND_CPU; KIND_GPU no carga porque no hay GPU) y model_warmup antes de
  decir «listo».
- El protocolo HTTP/REST de KServe v2 que habla Triton: /v2/health/live, /v2/health/ready, /v2/models/<m>,
  /v2/models/<m>/ready, /v2/models/<m>/config, POST /v2/models/<m>/infer (JSON y la extensión binaria de Triton,
  con el header Inference-Header-Content-Length) y /metrics con nombres de Triton (nv_inference_*).

Lo que es distinto: corre el modelo con ONNX Runtime en la CPU (en C01: TensorRT en una T4), solo trae ese backend,
solo HTTP (sin gRPC) y solo los campos de configuración de arriba.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import numpy as np

os.environ.setdefault("ORT_LOGGING_LEVEL", "3")

# ---------------------------------------------------------------- el config.pbtxt (formato de texto de protobuf)
TIPOS = {"TYPE_FP32": (np.float32, "FP32"), "TYPE_FP16": (np.float16, "FP16"), "TYPE_INT64": (np.int64, "INT64"),
         "TYPE_INT32": (np.int32, "INT32"), "TYPE_UINT8": (np.uint8, "UINT8")}
DE_ORT = {"tensor(float)": "TYPE_FP32", "tensor(float16)": "TYPE_FP16", "tensor(int64)": "TYPE_INT64",
          "tensor(int32)": "TYPE_INT32", "tensor(uint8)": "TYPE_UINT8"}
DE_KSERVE = {v[1]: k for k, v in TIPOS.items()}

# Los campos que este servidor conoce, por tipo de mensaje (un subconjunto de inference.ModelConfig de Triton).
# «*» = se puede repetir. Un campo que no está aquí es un error, como en Triton.
ESQUEMA = {
    "ModelConfig": {"name": "s", "platform": "s", "backend": "s", "max_batch_size": "i", "input*": "ModelInput",
                    "output*": "ModelOutput", "version_policy": "ModelVersionPolicy", "dynamic_batching": "ModelDynamicBatching",
                    "instance_group*": "ModelInstanceGroup", "model_warmup*": "ModelWarmup", "default_model_filename": "s"},
    "ModelInput": {"name": "s", "data_type": "e", "dims*": "i", "format": "e", "reshape": "ModelTensorReshape"},
    "ModelOutput": {"name": "s", "data_type": "e", "dims*": "i", "label_filename": "s", "reshape": "ModelTensorReshape"},
    "ModelTensorReshape": {"shape*": "i"},
    "ModelVersionPolicy": {"latest": "Latest", "all": "All", "specific": "Specific"},
    "Latest": {"num_versions": "i"}, "All": {}, "Specific": {"versions*": "i"},
    "ModelDynamicBatching": {"preferred_batch_size*": "i", "max_queue_delay_microseconds": "i",
                             "preserve_ordering": "b", "default_queue_policy": "ModelQueuePolicy"},
    "ModelQueuePolicy": {"timeout_action": "e", "default_timeout_microseconds": "i", "allow_timeout_override": "b",
                         "max_queue_size": "i"},
    "ModelInstanceGroup": {"name": "s", "kind": "e", "count": "i", "gpus*": "i"},
    "ModelWarmup": {"name": "s", "batch_size": "i", "count": "i", "inputs*": "WarmupInputs"},
    "WarmupInputs": {"key": "s", "value": "WarmupInput"},
    "WarmupInput": {"data_type": "e", "dims*": "i", "zero_data": "b", "random_data": "b", "input_data_file": "s"},
}


class ErrorConfig(Exception):
    pass


def tokens(texto: str):
    patron = re.compile(r'\s+|#[^\n]*|"(?:[^"\\]|\\.)*"|\'(?:[^\'\\]|\\.)*\'|[{}\[\]:,;<>]|[^\s{}\[\]:,;<>#"\']+')
    pos, linea = 0, 1
    while pos < len(texto):
        m = patron.match(texto, pos)
        if not m:
            raise ErrorConfig(f"{linea}: carácter inesperado {texto[pos]!r}")
        t = m.group(0)
        if not (t.isspace() or t.startswith("#")):
            yield t, linea
        linea += t.count("\n")
        pos = m.end()


def parsear_pbtxt(texto: str) -> dict:
    toks = list(tokens(texto)) + [("", -1)]
    i = 0

    def ver():
        return toks[i][0]

    def tomar(esperado: str | None = None):
        nonlocal i
        t, ln = toks[i]
        if esperado is not None and t != esperado:
            raise ErrorConfig(f"{ln}: se esperaba «{esperado}» y vino «{t or 'el fin del archivo'}»")
        i += 1
        return t, ln

    def escalar(t: str, tipo: str, ln: int, campo: str):
        if tipo == "s":
            if not (t[:1] in "\"'" and t[-1:] == t[:1]):
                raise ErrorConfig(f"{ln}: {campo} espera un texto entre comillas y vino {t}")
            return t[1:-1]
        if tipo == "i":
            try:
                return int(t)
            except ValueError:
                raise ErrorConfig(f"{ln}: {campo} espera un número entero y vino {t}") from None
        if tipo == "b":
            if t not in ("true", "false"):
                raise ErrorConfig(f"{ln}: {campo} espera true o false y vino {t}")
            return t == "true"
        if tipo == "e":
            if not re.fullmatch(r"[A-Z][A-Z0-9_]*", t):
                raise ErrorConfig(f"{ln}: {campo} espera un valor como TYPE_FP32 y vino {t}")
            return t
        raise AssertionError(tipo)

    def mensaje(tipo: str, cierre: str | None) -> dict:
        out: dict = {}
        campos = ESQUEMA[tipo]
        while True:
            t, ln = toks[i]
            if cierre and t == cierre:
                tomar()
                return out
            if t == "":
                if cierre:
                    raise ErrorConfig(f"falta «{cierre}» al final del archivo")
                return out
            if t in (",", ";"):
                tomar()
                continue
            nombre, _ = tomar()
            rep = f"{nombre}*" in campos
            sub = campos.get(nombre) or campos.get(f"{nombre}*")
            if sub is None:
                raise ErrorConfig(f'{ln}: Message type "inference.{tipo}" has no field named "{nombre}"')
            if ver() == ":":
                tomar()
            valores = []
            if ver() == "[":
                tomar()
                while ver() != "]":
                    valores.append(valor(sub, nombre))
                    if ver() == ",":
                        tomar()
                tomar("]")
                if not rep:
                    raise ErrorConfig(f"{ln}: {nombre} no es una lista")
            else:
                valores.append(valor(sub, nombre))
            if rep:
                out.setdefault(nombre, []).extend(valores)
            else:
                if nombre in out:
                    raise ErrorConfig(f"{ln}: {nombre} aparece dos veces")
                out[nombre] = valores[0]

    def valor(sub: str, nombre: str):
        if sub in ESQUEMA:
            t, ln = tomar()
            if t not in ("{", "<"):
                raise ErrorConfig(f"{ln}: {nombre} es un mensaje: se esperaba «{{»")
            return mensaje(sub, "}" if t == "{" else ">")
        t, ln = tomar()
        return escalar(t, sub, ln, nombre)

    return mensaje("ModelConfig", None)


# ---------------------------------------------------------------- el modelo cargado
@dataclass
class Pedido:
    x: np.ndarray
    llegada: float
    futuro: asyncio.Future


@dataclass
class Modelo:
    nombre: str
    version: str
    cfg: dict
    ruta: Path
    sesiones: list = field(default_factory=list)
    entrada: str = ""
    salida: str = ""
    tipo_salida: str = "FP32"
    estado: str = "LOADING"
    motivo: str = ""
    fila: asyncio.Queue | None = None
    libres: asyncio.Queue | None = None
    pool: ThreadPoolExecutor | None = None
    m: dict = field(default_factory=lambda: {k: 0 for k in (
        "request_success", "request_failure", "count", "exec_count", "request_duration_us", "queue_duration_us",
        "compute_infer_duration_us")})


def cargar(repo: Path, nombre: str, auto_complete: bool) -> Modelo:
    import onnxruntime as ort

    base = repo / nombre
    p = base / "config.pbtxt"
    if not p.exists():
        raise ErrorConfig(f"no existe {p}")
    try:
        cfg = parsear_pbtxt(p.read_text())
    except ErrorConfig as e:
        raise ErrorConfig(f"Error parsing text-format inference.ModelConfig: {e}") from None
    if cfg.get("name", nombre) != nombre:
        raise ErrorConfig(f"el config.pbtxt se llama '{cfg['name']}' y su carpeta '{nombre}': tienen que coincidir")
    plat, back = cfg.get("platform", ""), cfg.get("backend", "")
    if not (plat == "onnxruntime_onnx" or back == "onnxruntime"):
        raise ErrorConfig(f"platform '{plat or back or '(vacío)'}': este servidor del dojo solo trae el backend de ONNX Runtime "
                          "(platform: \"onnxruntime_onnx\"); en C01, \"tensorrt_plan\" necesita TensorRT y una GPU")
    for k in ("max_batch_size", "input", "output"):
        if k not in cfg and not auto_complete:
            raise ErrorConfig(f"falta {k} en el config.pbtxt (--disable-auto-complete-config: no se rellena leyendo el modelo)")
    versiones = sorted((int(d.name) for d in base.iterdir() if d.is_dir() and d.name.isdigit()), reverse=True)
    if not versiones:
        raise ErrorConfig(f"no hay ninguna versión en {base} (una carpeta con número, como 1/)")
    pol = cfg.get("version_policy", {"latest": {"num_versions": 1}})
    if "latest" not in pol or pol["latest"].get("num_versions", 1) != 1:
        raise ErrorConfig("este servidor del dojo solo sirve version_policy { latest { num_versions: 1 } }")
    v = str(versiones[0])
    archivo = base / v / cfg.get("default_model_filename", "model.onnx")
    if not archivo.exists():
        raise ErrorConfig(f"no existe {archivo.relative_to(repo)}")
    grupos = cfg.get("instance_group", [{"kind": "KIND_CPU", "count": 1}])
    copias = 0
    for g in grupos:
        if g.get("kind", "KIND_GPU") != "KIND_CPU":
            raise ErrorConfig(f"instance_group con kind {g.get('kind', 'KIND_GPU (el valor por omisión)')}: no hay GPU en esta máquina")
        copias += g.get("count", 1)
    so = ort.SessionOptions()
    so.intra_op_num_threads = 1
    so.inter_op_num_threads = 1
    so.log_severity_level = 3
    try:
        sesiones = [ort.InferenceSession(str(archivo), so, providers=["CPUExecutionProvider"]) for _ in range(copias)]
    except Exception as e:  # noqa: BLE001
        raise ErrorConfig(f"ONNX Runtime no pudo abrir {archivo.relative_to(repo)}: {str(e).splitlines()[0][:200]}") from None
    s = sesiones[0]
    mb = cfg.get("max_batch_size", 0)
    ins, outs = cfg.get("input", []), cfg.get("output", [])
    mi, mo = s.get_inputs(), s.get_outputs()
    if len(ins) != len(mi) or len(outs) != len(mo):
        raise ErrorConfig(f"el modelo tiene {len(mi)} entrada(s) y {len(mo)} salida(s); el config.pbtxt declara {len(ins)} y {len(outs)}")
    for decl, real, que in [(ins[0], mi[0], "input"), (outs[0], mo[0], "output")]:
        if decl.get("name") != real.name:
            raise ErrorConfig(f"unable to find '{decl.get('name')}' in model: {que} del modelo se llama '{real.name}'")
        tipo = DE_ORT.get(real.type, real.type)
        if decl.get("data_type") != tipo:
            raise ErrorConfig(f"{que} '{real.name}': el modelo es {tipo} y el config.pbtxt dice {decl.get('data_type')}")
        forma = [d if isinstance(d, int) else -1 for d in real.shape]
        if mb > 0:
            if forma[0] != -1:
                raise ErrorConfig(f"{que} '{real.name}': max_batch_size > 0 pide un eje de batch variable y el modelo tiene {forma}")
            forma = forma[1:]
        if list(decl.get("dims", [])) != forma:
            sin = " (sin el eje del batch: Triton le antepone -1)" if mb > 0 else ""
            raise ErrorConfig(f"{que} '{real.name}': model expected the shape {forma}{sin} but the config.pbtxt says "
                              f"{list(decl.get('dims', []))}")
    if mb < 0:
        raise ErrorConfig("max_batch_size no puede ser negativo")
    db = cfg.get("dynamic_batching")
    if db is not None:
        if mb == 0:
            raise ErrorConfig("dynamic_batching necesita max_batch_size > 0")
        for t in db.get("preferred_batch_size", []):
            if t > mb:
                raise ErrorConfig(f"preferred_batch_size {t} es mayor que max_batch_size {mb}")
        pol = db.get("default_queue_policy", {})
        if pol.get("timeout_action", "REJECT") not in ("REJECT", "DELAY"):
            raise ErrorConfig(f"timeout_action {pol['timeout_action']}: los valores son REJECT o DELAY")
    for w in cfg.get("model_warmup", []):
        if w.get("batch_size", 1) > max(mb, 1):
            raise ErrorConfig(f"model_warmup '{w.get('name')}': batch_size {w.get('batch_size')} > max_batch_size {mb}")
        claves = {x.get("key") for x in w.get("inputs", [])}
        if claves != {mi[0].name}:
            raise ErrorConfig(f"model_warmup '{w.get('name')}': sus inputs son {sorted(claves)} y el modelo pide ['{mi[0].name}']")
    return Modelo(nombre, v, cfg, archivo, sesiones, mi[0].name, mo[0].name, TIPOS[DE_ORT.get(mo[0].type, "TYPE_FP32")][1])


def calentar(mod: Modelo) -> int:
    corridas = 0
    for w in mod.cfg.get("model_warmup", []):
        x = w["inputs"][0]["value"]
        tipo = TIPOS[x.get("data_type", "TYPE_FP32")][0]
        forma = [w.get("batch_size", 1)] + list(x.get("dims", [])) if mod.cfg.get("max_batch_size", 0) > 0 else list(x.get("dims", []))
        datos = (np.random.default_rng(0).random(forma).astype(tipo) if x.get("random_data") else np.zeros(forma, tipo))
        for s in mod.sesiones:
            for _ in range(w.get("count", 1)):
                s.run(None, {mod.entrada: datos})
                corridas += 1
    return corridas


# ---------------------------------------------------------------- el batcher dinámico
async def batcher(mod: Modelo) -> None:
    """Junta pedidos de la fila: espera hasta max_queue_delay desde el primero, o hasta llenar un tamaño preferido o el
    máximo, y manda el batch a la primera copia libre. Lo que esperó en la fila más que el plazo de la política, se
    rechaza (REJECT) sin entrar al modelo."""
    db = mod.cfg.get("dynamic_batching")
    mb = max(mod.cfg.get("max_batch_size", 0), 1)
    retraso = (db or {}).get("max_queue_delay_microseconds", 0) / 1e6
    preferidos = sorted((db or {}).get("preferred_batch_size", []))
    pol = (db or {}).get("default_queue_policy", {})
    plazo = pol.get("default_timeout_microseconds", 0) / 1e6
    accion = pol.get("timeout_action", "REJECT")
    loop = asyncio.get_running_loop()
    pendientes: list[Pedido] = []
    while True:
        if not pendientes:
            pendientes.append(await mod.fila.get())
        # sin dynamic_batching, Triton corre cada pedido solo, tal como llegó
        if db is not None:
            limite = pendientes[0].llegada + retraso
            while sum(len(p.x) for p in pendientes) < mb:
                n = sum(len(p.x) for p in pendientes)
                if preferidos and n in preferidos and n == preferidos[-1]:
                    break
                falta = limite - loop.time()
                if falta <= 0:
                    break
                try:
                    pendientes.append(await asyncio.wait_for(mod.fila.get(), falta))
                except TimeoutError:
                    break
        copia = await mod.libres.get()           # la primera copia del modelo que esté libre
        ahora = loop.time()
        lote, n = [], 0
        resto: list[Pedido] = []
        for p in pendientes:
            if p.futuro.done():
                continue
            if plazo and accion == "REJECT" and ahora - p.llegada > plazo:
                mod.m["request_failure"] += 1
                p.futuro.set_exception(ErrorInfer(503, "Request timeout expired"))
            elif n + len(p.x) <= mb and (db is not None or not lote):
                lote.append(p)
                n += len(p.x)
            else:
                resto.append(p)
        pendientes = resto
        if not lote:
            mod.libres.put_nowait(copia)
            continue
        asyncio.create_task(correr(mod, copia, lote, ahora))


async def correr(mod: Modelo, copia: int, lote: list[Pedido], inicio: float) -> None:
    loop = asyncio.get_running_loop()
    x = np.concatenate([p.x for p in lote])
    try:
        y = await loop.run_in_executor(mod.pool, lambda: mod.sesiones[copia].run([mod.salida], {mod.entrada: x})[0])
    except Exception as e:  # noqa: BLE001
        for p in lote:
            if not p.futuro.done():
                p.futuro.set_exception(ErrorInfer(500, f"onnxruntime: {str(e).splitlines()[0][:200]}"))
        mod.m["request_failure"] += len(lote)
        return
    finally:
        mod.libres.put_nowait(copia)
    fin = loop.time()
    mod.m["exec_count"] += 1
    mod.m["count"] += len(x)
    mod.m["compute_infer_duration_us"] += int((fin - inicio) * 1e6)
    i = 0
    for p in lote:
        mod.m["queue_duration_us"] += int((inicio - p.llegada) * 1e6)
        if not p.futuro.done():
            p.futuro.set_result(y[i:i + len(p.x)])
        i += len(p.x)


class ErrorInfer(Exception):
    def __init__(self, codigo: int, msg: str):
        super().__init__(msg)
        self.codigo, self.msg = codigo, msg


# ---------------------------------------------------------------- HTTP (KServe v2 + la extensión binaria de Triton)
def app_http(modelos: dict[str, Modelo], estricto: bool, puerto: int):
    from contextlib import asynccontextmanager

    from starlette.applications import Starlette
    from starlette.requests import Request
    from starlette.responses import JSONResponse, PlainTextResponse, Response
    from starlette.routing import Route

    def listo() -> bool:
        return all(m.estado == "READY" for m in modelos.values()) if estricto else any(m.estado == "READY" for m in modelos.values())

    def err(codigo: int, msg: str):
        return JSONResponse({"error": msg}, status_code=codigo)

    def modelo(req: Request) -> Modelo | None:
        return modelos.get(req.path_params["modelo"])

    async def vivo(_):
        return Response(status_code=200)

    async def preparado(_):
        return Response(status_code=200 if listo() else 400)

    async def meta_server(_):
        return JSONResponse({"name": "triton-del-dojo", "version": "2.60.0-dojo",
                             "extensions": ["classification", "binary_tensor_data", "model_configuration", "statistics"]})

    async def meta_modelo(req):
        m = modelo(req)
        if not m:
            return err(400, f"Request for unknown model: '{req.path_params['modelo']}' is not found")
        mb = m.cfg.get("max_batch_size", 0)
        def t(x):
            return {"name": x["name"], "datatype": TIPOS[x["data_type"]][1], "shape": ([-1] if mb > 0 else []) + list(x["dims"])}
        return JSONResponse({"name": m.nombre, "versions": [m.version], "platform": m.cfg.get("platform", "onnxruntime_onnx"),
                             "inputs": [t(x) for x in m.cfg["input"]], "outputs": [t(x) for x in m.cfg["output"]]})

    async def modelo_listo(req):
        m = modelo(req)
        return Response(status_code=200 if m and m.estado == "READY" else 400)

    async def config(req):
        m = modelo(req)
        if not m:
            return err(400, f"Request for unknown model: '{req.path_params['modelo']}' is not found")
        return JSONResponse({"name": m.nombre, **m.cfg})

    async def infer(req: Request):
        t0 = time.monotonic()
        m = modelo(req)
        if not m:
            return err(400, f"Request for unknown model: '{req.path_params['modelo']}' is not found")
        if m.estado != "READY":
            return err(400, f"Request for unknown model: '{m.nombre}' is not ready ({m.estado})")
        cuerpo = await req.body()
        largo = req.headers.get("inference-header-content-length")
        try:
            n = int(largo) if largo is not None else len(cuerpo)
            pedido = json.loads(cuerpo[:n])
            binario = memoryview(cuerpo)[n:]
            entradas = pedido.get("inputs") or []
            if len(entradas) != 1 or entradas[0].get("name") != m.cfg["input"][0]["name"]:
                nombres = [x.get("name") for x in entradas]
                raise ErrorInfer(400, f"[request id: {pedido.get('id', '<id_unknown>')}] unexpected inference input(s) "
                                      f"{nombres} for model '{m.nombre}': expected ['{m.cfg['input'][0]['name']}']")
            e = entradas[0]
            decl = m.cfg["input"][0]
            tipo_np, tipo_ks = TIPOS[decl["data_type"]]
            if e.get("datatype") != tipo_ks:
                raise ErrorInfer(400, f"inference input '{e.get('name')}' data-type is '{e.get('datatype')}', but model "
                                      f"'{m.nombre}' expects '{tipo_ks}'")
            forma = list(e.get("shape", []))
            mb = m.cfg.get("max_batch_size", 0)
            esperada = list(decl["dims"])
            if (mb > 0 and (len(forma) != len(esperada) + 1 or forma[1:] != esperada)) or (mb == 0 and forma != esperada):
                raise ErrorInfer(400, f"unexpected shape for input '{e['name']}' for model '{m.nombre}'. Expected "
                                      f"{([-1] if mb > 0 else []) + esperada}, got {forma}")
            if mb > 0 and forma[0] > mb:
                raise ErrorInfer(400, f"inference request batch-size must be <= {mb} for '{m.nombre}'")
            tam = (e.get("parameters") or {}).get("binary_data_size")
            if tam is not None:
                x = np.frombuffer(bytes(binario[:tam]), dtype=tipo_np).reshape(forma)
            else:
                x = np.asarray(e.get("data"), dtype=tipo_np).reshape(forma)
            if mb == 0:
                x = x[None]
        except ErrorInfer as ex:
            m.m["request_failure"] += 1
            return err(ex.codigo, ex.msg)
        except Exception as ex:  # noqa: BLE001
            m.m["request_failure"] += 1
            return err(400, f"failed to parse the request: {type(ex).__name__}: {str(ex)[:200]}")
        fut = asyncio.get_running_loop().create_future()
        await m.fila.put(Pedido(x, asyncio.get_running_loop().time(), fut))
        try:
            y = await fut
        except ErrorInfer as ex:
            return err(ex.codigo, ex.msg)
        except asyncio.CancelledError:
            raise
        if mb == 0:
            y = y[0]
        m.m["request_success"] += 1
        m.m["request_duration_us"] += int((time.monotonic() - t0) * 1e6)
        pedidas = pedido.get("outputs") or [{"name": m.salida}]
        bin_def = bool((pedido.get("parameters") or {}).get("binary_data_output", False))
        salidas, cola = [], b""
        for o in pedidas:
            if o.get("name") != m.salida:
                return err(400, f"unexpected inference output '{o.get('name')}' for model '{m.nombre}'")
            d = {"name": m.salida, "datatype": m.tipo_salida, "shape": list(y.shape)}
            if (o.get("parameters") or {}).get("binary_data", bin_def):
                b = np.ascontiguousarray(y).tobytes()
                d["parameters"] = {"binary_data_size": len(b)}
                cola += b
            else:
                d["data"] = y.reshape(-1).tolist()
            salidas.append(d)
        r = {"model_name": m.nombre, "model_version": m.version, "outputs": salidas}
        if "id" in pedido:
            r["id"] = pedido["id"]
        js = json.dumps(r).encode()
        if cola:
            return Response(js + cola, media_type="application/octet-stream",
                            headers={"Inference-Header-Content-Length": str(len(js))})
        return Response(js, media_type="application/json")

    async def metricas(_):
        lineas = []
        nombres = {"request_success": "counter", "request_failure": "counter", "count": "counter", "exec_count": "counter",
                   "request_duration_us": "counter", "queue_duration_us": "counter", "compute_infer_duration_us": "counter"}
        for k, tipo in nombres.items():
            lineas.append(f"# TYPE nv_inference_{k} {tipo}")
            for mod in modelos.values():
                lineas.append(f'nv_inference_{k}{{model="{mod.nombre}",version="{mod.version}"}} {mod.m[k]}')
        return PlainTextResponse("\n".join(lineas) + "\n")

    rutas = [Route("/v2/health/live", vivo), Route("/v2/health/ready", preparado), Route("/v2", meta_server),
             Route("/v2/models/{modelo}", meta_modelo), Route("/v2/models/{modelo}/ready", modelo_listo),
             Route("/v2/models/{modelo}/config", config),
             Route("/v2/models/{modelo}/infer", infer, methods=["POST"]),
             Route("/v2/models/{modelo}/versions/{v}/infer", infer, methods=["POST"]),
             Route("/metrics", metricas)]
    @asynccontextmanager
    async def lifespan(_):
        tareas = []
        for mod in modelos.values():
            if mod.estado == "READY":
                mod.fila, mod.libres = asyncio.Queue(), asyncio.Queue()
                for k in range(len(mod.sesiones)):
                    mod.libres.put_nowait(k)
                mod.pool = ThreadPoolExecutor(len(mod.sesiones), thread_name_prefix=f"{mod.nombre}-instancia")
                tareas.append(asyncio.create_task(batcher(mod)))
        log("I", f"Started HTTPService at 0.0.0.0:{puerto}")
        yield
        for t in tareas:
            t.cancel()
        log("I", "server stopped")

    return Starlette(routes=rutas, lifespan=lifespan)


# ---------------------------------------------------------------- arranque
def log(nivel: str, msg: str) -> None:
    print(f"{nivel}{datetime.now():%m%d %H:%M:%S.%f} {os.getpid()} servidor.py] {msg}", flush=True)


def tabla(modelos: dict[str, Modelo]) -> None:
    filas = [(m.nombre, m.version, "READY" if m.estado == "READY" else f"UNAVAILABLE: {m.motivo}") for m in modelos.values()]
    an = [max(len(str(f[i])) for f in filas + [("Model", "Version", "Status")]) for i in range(3)]
    sep = "+" + "+".join("-" * (a + 2) for a in an) + "+"
    print(sep)
    for f in [("Model", "Version", "Status"), *filas]:
        print("| " + " | ".join(str(c).ljust(a) for c, a in zip(f, an)) + " |")
        if f[0] == "Model":
            print(sep)
    print(sep, flush=True)


def sino(x: str) -> bool:
    return x.lower() in ("true", "1", "yes", "on")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--model-repository", required=True)
    ap.add_argument("--http-port", type=int, default=8000)
    ap.add_argument("--model-control-mode", default="none", choices=["none"])
    ap.add_argument("--strict-readiness", default="true")
    ap.add_argument("--exit-on-error", default="true")
    ap.add_argument("--exit-timeout-secs", type=int, default=30)
    ap.add_argument("--disable-auto-complete-config", action="store_true")
    a = ap.parse_args()
    repo = Path(a.model_repository).resolve()
    log("I", f"model repository: {repo}")
    modelos: dict[str, Modelo] = {}
    if not repo.is_dir():
        log("E", f"failed to stat model repository path {repo}")
        sys.exit(1)
    for d in sorted(p for p in repo.iterdir() if p.is_dir()):
        log("I", f"loading: {d.name}")
        try:
            mod = cargar(repo, d.name, not a.disable_auto_complete_config)
            t = time.time()
            n = calentar(mod)
            mod.estado = "READY"
            log("I", f"warmup de {d.name}: {n} corridas en {(time.time() - t) * 1000:.0f} ms")
            log("I", f"successfully loaded '{d.name}' version {mod.version} ({len(mod.sesiones)} instancia(s) KIND_CPU, "
                     f"model.onnx sha256 {__import__('hashlib').sha256(mod.ruta.read_bytes()).hexdigest()[:12]}…)")
        except ErrorConfig as e:
            mod = Modelo(d.name, "1", {}, d)
            mod.estado, mod.motivo = "UNAVAILABLE", str(e)
            log("E", f"failed to load '{d.name}': {e}")
        modelos[d.name] = mod
    tabla(modelos)
    if not modelos:
        log("E", "el model repository está vacío")
    if sino(a.exit_on_error) and any(m.estado != "READY" for m in modelos.values()):
        log("E", "exiting: one or more models failed to load (--exit-on-error=true)")
        sys.exit(1)

    import uvicorn

    app = app_http(modelos, sino(a.strict_readiness), a.http_port)

    logging.getLogger("uvicorn.error").setLevel(logging.WARNING)
    uvicorn.run(app, host=os.environ.get("TRITON_HOST", "127.0.0.1"), port=a.http_port, log_level="warning", access_log=False,
                timeout_graceful_shutdown=a.exit_timeout_secs)


if __name__ == "__main__":
    main()
