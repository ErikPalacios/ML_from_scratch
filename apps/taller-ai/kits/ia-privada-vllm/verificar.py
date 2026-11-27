"""Revisa los criterios de «listo» de la estación, uno por check. Solo lee: no cambia tus archivos ni tu servidor.

    python3 verificar.py                  # todos
    python3 verificar.py servidor clave   # algunos

Los checks hablan con el servidor de LLM_URL (servidor.env): en tu Mac, el vLLM del dojo (simulado); en la sesión de
GPU, el vLLM de verdad en el pod. Cada línea dice contra cuál corrió. Solo usa la biblioteca estándar de Python.
"""
from __future__ import annotations

import json
import math
import random
import signal
import sys
import threading
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ))
sys.path.insert(0, str(RAIZ / "pipeline"))
from mundo.comun import ENV, GPU_ENV, RESULTADOS, info_cache, leer_env, leer_json, metricas, motor, peticion, remoto  # noqa: E402

CARGA = RAIZ / "carga.env"
CORTA = [{"role": "system", "content": "Contesta en una frase."}, {"role": "user", "content": "¿Qué es un contrato de arrendamiento?"}]
DISENO = 8              # conversaciones a la vez de diseño (la ficha del despacho)
LARGO_TIPICO = 6500     # tokens de una conversación típica: ≈ 6,000 de entrada + ≈ 500 de salida
TASA_DOJO = 0.07        # una copia de las 3 del despacho: 0.21 ÷ 3


class Falla(Exception):
    pass


def exige(cond, msg) -> None:
    if not cond:
        raise Falla(msg() if callable(msg) else msg)


def llamar(fn, *a, segundos: int = 120, **k):
    def alarma(*_):
        raise Falla(f"{getattr(fn, '__qualname__', fn)} no terminó en {segundos} s")

    signal.signal(signal.SIGALRM, alarma)
    signal.alarm(segundos)
    try:
        return fn(*a, **k)
    except NotImplementedError as e:
        raise Falla(f"{getattr(fn, '__qualname__', '')} todavía es el esqueleto ({e or 'NotImplementedError'})")
    finally:
        signal.alarm(0)


def env() -> dict:
    e = leer_env()
    vacias = [k for k in ("MODELO", "NOMBRE", "HOST", "PUERTO", "MAX_MODEL_LEN", "MAX_NUM_SEQS", "CLAVE", "LLM_URL") if not e.get(k)]
    exige(not vacias, f"servidor.env: faltan {', '.join(vacias)} (paso 1)")
    return e


def carga_env() -> dict:
    c = leer_env(CARGA)
    vacias = [k for k in ("TASA", "PETICIONES", "CERRADA_A_LA_VEZ", "CERRADA_PETICIONES", "MAX_TOKENS", "SEMILLA", "TTFT_MS", "TPOT_MS") if not c.get(k)]
    exige(not vacias, f"carga.env: faltan {', '.join(vacias)} (paso 3)")
    return c


def directo(ruta: str, cuerpo: dict | None = None, clave: str | None = None) -> tuple[int, object]:
    try:
        return peticion(ruta, cuerpo, clave)
    except OSError as err:
        raise Falla(f"nadie contesta en {ruta} ({getattr(err, 'reason', err)}): python3 mundo/servidor.py arrancar (y mira su log)")


def resultado(tipo: str) -> dict:
    d = leer_json(RESULTADOS / f"{tipo}.json")
    exige(d, f"falta resultados/{tipo}.json: python3 pipeline/carga.py {tipo}")
    return d


def dondes() -> str:
    return "pod (vLLM de verdad)" if remoto() else ("vLLM real" if motor()[0] == "vllm" else "simulado")


# ---------------------------------------------------------------- checks
def check_mundo() -> str:
    exige(sys.version_info >= (3, 10), f"Python {sys.version.split()[0]}: el kit pide 3.10 o más nuevo")
    for f in ("mundo/vllm_dojo.py", "mundo/dataset.py", "mundo/gpu.py", "mundo/modelos.json", "mundo/gpus.json", "mundo/proveedores.json"):
        exige((RAIZ / f).exists(), f"falta {f}: vuelve a descomprimir el kit")
    from mundo.dataset import preguntas

    a, b = preguntas(3, 11), preguntas(3, 11)
    exige(a == b, "las preguntas del dataset no salen iguales con la misma semilla")
    exige(a[0]["messages"][0] == a[1]["messages"][0], "las preguntas no empiezan con las mismas instrucciones")
    return f"Python {sys.version.split()[0]} · {motor()[1]} · dataset determinista (semilla 11)"


def check_config() -> str:
    e = env()
    exige(e["MODELO"] == "Qwen/Qwen3-32B-AWQ", f"MODELO={e['MODELO']}: el del despacho es Qwen/Qwen3-32B-AWQ")
    exige(e["PUERTO"].isdigit(), f"PUERTO={e['PUERTO']} no es un número")
    exige(e["HOST"] == "127.0.0.1", f"HOST={e['HOST']}: en tu Mac, solo 127.0.0.1 (en el pod, gpu.py receta pone 0.0.0.0 para el proxy)")
    local, pod = f"http://127.0.0.1:{e['PUERTO']}/v1", f"-{e['PUERTO']}.proxy.runpod.net/v1"
    exige(e["LLM_URL"] == local or (e["LLM_URL"].startswith("https://") and e["LLM_URL"].endswith(pod)),
          lambda: f"LLM_URL={e['LLM_URL']}: tiene que ser {local} (tu Mac) o https://<POD_ID>{pod} (el pod)")
    exige(e["MAX_MODEL_LEN"].isdigit() and int(e["MAX_MODEL_LEN"]) >= 8192, f"MAX_MODEL_LEN={e['MAX_MODEL_LEN']}: el prompt del despacho (≈ 6,000) más la respuesta (500) pide ≥ 8,192")
    exige(e["MAX_NUM_SEQS"] == str(DISENO), f"MAX_NUM_SEQS={e['MAX_NUM_SEQS']}: las conversaciones a la vez de diseño del despacho son {DISENO}")
    exige(len(e["CLAVE"]) >= 12, "CLAVE: pon una de 12 caracteres o más (en el pod, el proxy es público)")
    from mundo.gpu import args_de_servir

    try:
        a = args_de_servir()
    except SystemExit as x:
        raise Falla(str(x).lstrip("✗ "))
    exige(a[:2] == ["serve", e["MODELO"]], f"servir.sh corre `vllm {' '.join(a[:2])}`: tiene que ser `vllm serve $MODELO` (paso 2)")
    return f"{e['NOMBRE']} ({e['MODELO']}) en {e['LLM_URL']} · {int(e['MAX_MODEL_LEN']):,} tokens · {e['MAX_NUM_SEQS']} a la vez · servir.sh corre vllm serve"


def check_prueba() -> str:
    c = carga_env()
    exige(c["TASA"] == str(TASA_DOJO), f"TASA={c['TASA']}: una copia de las 3 del despacho recibe 0.21 ÷ 3 = {TASA_DOJO} preguntas por segundo")
    exige(int(c["PETICIONES"]) >= 30, f"PETICIONES={c['PETICIONES']}: con menos de 30 el p95 es casi el máximo")
    exige(c["CERRADA_A_LA_VEZ"] == str(DISENO), f"CERRADA_A_LA_VEZ={c['CERRADA_A_LA_VEZ']}: la cerrada se hace con las {DISENO} de diseño")
    exige(int(c["CERRADA_PETICIONES"]) >= 3 * DISENO, f"CERRADA_PETICIONES={c['CERRADA_PETICIONES']}: por lo menos 3 vueltas de {DISENO}")
    exige(int(c["MAX_TOKENS"]) == 500, f"MAX_TOKENS={c['MAX_TOKENS']}: el tope de salida del plan es 500 (con menos, el TPOT y el e2e salen mejores de lo que son)")
    exige(c["TTFT_MS"] == "2000" and c["TPOT_MS"] == "50", f"TTFT_MS={c['TTFT_MS']}, TPOT_MS={c['TPOT_MS']}: el criterio del despacho es 2000 y 50")
    n = int(c["PETICIONES"])
    return f"abierta {n} a {c['TASA']}/s (≈ {n / float(c['TASA']) / 60:.1f} min) · cerrada {c['CERRADA_PETICIONES']} con {c['CERRADA_A_LA_VEZ']} a la vez · salida ≤ {c['MAX_TOKENS']}"


def check_servidor() -> str:
    e = env()
    st, _ = directo("/health")
    exige(st == 200, f"/health contesta {st}")
    st, m = directo("/v1/models", clave=e["CLAVE"])
    exige(st == 200, f"/v1/models contesta {st}: {m}")
    ids = [x["id"] for x in m.get("data", [])]
    exige(e["NOMBRE"] in ids, f"el servidor anuncia {ids} y servidor.env dice NOMBRE={e['NOMBRE']}: ¿arrancaste con otro servir.sh?")
    x = next(x for x in m["data"] if x["id"] == e["NOMBRE"])
    exige(x.get("max_model_len") == int(e["MAX_MODEL_LEN"]), f"el servidor cargó max_model_len {x.get('max_model_len')} y servidor.env dice {e['MAX_MODEL_LEN']}: vuelve a arrancarlo")
    exige(x.get("root") == e["MODELO"], f"el servidor sirve {x.get('root')}")
    st, r = directo("/v1/chat/completions", {"model": e["NOMBRE"], "messages": CORTA, "max_tokens": 16}, e["CLAVE"])
    exige(st == 200, f"una pregunta corta con model={e['NOMBRE']} contesta {st}: {r}")
    return f"/health 200 · {e['NOMBRE']} → {x['root']} · max_model_len {x['max_model_len']:,} · {dondes()}"


def check_clave() -> str:
    e = env()
    st, _ = directo("/v1/models")
    exige(st == 401, f"sin clave, /v1/models contesta {st}: cualquiera que llegue al puerto usa tu modelo (falta --api-key)")
    st, _ = directo("/v1/models", clave="otra-clave-123")
    exige(st == 401, f"con una clave equivocada contesta {st}")
    st, _ = directo("/v1/models", clave=e["CLAVE"])
    exige(st == 200, f"con la clave de servidor.env contesta {st}")
    return "sin clave → 401 · clave equivocada → 401 · tu clave → 200 (/health y /metrics quedan abiertos)"


def check_memoria() -> str:
    env()
    try:
        i = info_cache()
    except OSError as err:
        raise Falla(f"no pude leer /metrics: {err}")
    exige(i.get("num_gpu_blocks"), "/metrics no trae vllm:cache_config_info con num_gpu_blocks")
    tokens = int(i["num_gpu_blocks"]) * int(i["block_size"])
    exige(tokens >= DISENO * LARGO_TIPICO, f"el KV cache tiene lugar para {tokens:,} tokens y las {DISENO} conversaciones típicas piden {DISENO} × {LARGO_TIPICO:,} = "
                                           f"{DISENO * LARGO_TIPICO:,}: habrá preemptions (¿--gpu-memory-utilization? ¿otra GPU?)")
    return f"KV cache: {int(i['num_gpu_blocks']):,} bloques de {i['block_size']} = {tokens:,} tokens · {tokens / (DISENO * LARGO_TIPICO):.1f}× las {DISENO} típicas · {dondes()}"


def check_plantilla() -> str:
    e = env()
    st, d = directo("/v1/chat/completions", {"model": e["NOMBRE"], "messages": CORTA, "max_tokens": 200, "temperature": 0}, e["CLAVE"])
    exige(st == 200, f"/v1/chat/completions contesta {st}: {d}")
    msg, u = d["choices"][0]["message"], d["usage"]
    exige(not msg.get("reasoning") and not msg.get("reasoning_content") and "<think>" not in (msg.get("content") or ""),
          lambda: f"el modelo razonó antes de contestar ({len(msg.get('reasoning') or msg.get('reasoning_content') or msg.get('content') or '')} caracteres): falta enable_thinking false")
    st, t = directo("/tokenize", {"model": e["NOMBRE"], "messages": CORTA}, e["CLAVE"])
    exige(st == 200 and t.get("count") == u["prompt_tokens"], f"/tokenize cuenta {t.get('count')} tokens y la respuesta dice {u['prompt_tokens']}: la plantilla no es la misma")
    return f"sin razonamiento · {u['prompt_tokens']} tokens de entrada (los mismos en /tokenize) · {u['completion_tokens']} de salida"


def check_lugares() -> str:
    """10 preguntas cortas a la vez: tienen que correr exactamente MAX_NUM_SEQS y esperar las demás."""
    e = env()
    picos = {"running": 0.0, "waiting": 0.0}
    alto = threading.Event()

    def muestrear():
        while not alto.is_set():
            try:
                x = metricas(timeout=2)
                picos["running"] = max(picos["running"], x.get("vllm:num_requests_running", 0))
                picos["waiting"] = max(picos["waiting"], x.get("vllm:num_requests_waiting", 0))
            except OSError:
                pass
            time.sleep(0.15)

    estados = []

    def una():
        st, _ = directo("/v1/chat/completions", {"model": e["NOMBRE"], "messages": CORTA, "max_tokens": 120, "ignore_eos": True}, e["CLAVE"])
        estados.append(st)

    m = threading.Thread(target=muestrear, daemon=True)
    m.start()
    hilos = [threading.Thread(target=una) for _ in range(DISENO + 2)]
    for h in hilos:
        h.start()
    for h in hilos:
        h.join(120)
    alto.set()
    exige(all(s == 200 for s in estados) and len(estados) == DISENO + 2, f"de {DISENO + 2} preguntas a la vez contestaron {estados}")
    exige(picos["running"] == DISENO, f"con {DISENO + 2} a la vez, el motor corrió hasta {picos['running']:.0f} juntas: tiene que ser {DISENO} (--max-num-seqs)")
    exige(picos["waiting"] >= 1, "con más preguntas que lugares, ninguna esperó en fila: ¿cuántos lugares tiene el motor?")
    return f"{DISENO + 2} a la vez → {picos['running']:.0f} corriendo y hasta {picos['waiting']:.0f} en fila (vllm:num_requests_running / waiting)"


def medida_valida(m: dict, donde: str) -> None:
    exige(m.get("ok"), f"{donde}: {m.get('id')} no salió bien ({m.get('status')} {m.get('error', '')[:100]})")
    exige(0 < m["ttft_s"] < m["e2e_s"], f"{donde}: ttft_s {m['ttft_s']} tiene que estar entre 0 y e2e_s {m['e2e_s']}")
    exige(m["tokens_prompt"] > 1000 and m["tokens_salida"] > 1, f"{donde}: tokens {m['tokens_prompt']} → {m['tokens_salida']} (¿leíste el usage del último pedazo?)")
    esperado = (m["e2e_s"] - m["ttft_s"]) / (m["tokens_salida"] - 1)
    exige(m["tpot_s"] and abs(m["tpot_s"] - esperado) < 1e-6, f"{donde}: tpot_s {m['tpot_s']} y (e2e − ttft) ÷ (tokens − 1) = {esperado:.4f}")
    exige(len(m["itl_s"]) >= m["tokens_salida"] // 2, f"{donde}: itl_s trae {len(m['itl_s'])} huecos para {m['tokens_salida']} tokens: ¿cuentas los pedazos con texto?")


def check_humo() -> str:
    try:
        import carga
    except ModuleNotFoundError as e:
        raise Falla(f"no puedo importar pipeline/carga.py: {e}")
    from mundo.dataset import preguntas

    q = preguntas(1, 7)[0]
    m = llamar(carga.una, q, 32)
    from dataclasses import asdict, is_dataclass

    exige(is_dataclass(m), "una() tiene que devolver una Medida")
    m = asdict(m)
    medida_valida(m, "una()")
    exige(m["tokens_salida"] <= 32, f"una(q, 32) escribió {m['tokens_salida']} tokens: ¿mandas max_tokens?")
    h = llamar(carga.llegadas, 5, 0.5, 3)
    r, t, esperado = random.Random(3), 0.0, []
    for _ in range(5):
        t += r.expovariate(0.5)
        esperado.append(t)
    exige([round(x, 9) for x in h] == [round(x, 9) for x in esperado], f"llegadas(5, 0.5, 3) da {h}: suma de random.Random(3).expovariate(0.5)")
    return f"una(): {m['tokens_prompt']:,} tokens → {m['tokens_salida']} · TTFT {m['ttft_s'] * 1000:,.0f} ms · TPOT {m['tpot_s'] * 1000:.1f} ms · llegadas() como Poisson"


def check_cerrada() -> str:
    c, e = carga_env(), env()
    d = resultado("cerrada")
    ms, meta = d["medidas"], d["meta"]
    exige(meta.get("a_la_vez") == int(c["CERRADA_A_LA_VEZ"]) and len(ms) == int(c["CERRADA_PETICIONES"]),
          f"resultados/cerrada.json: {len(ms)} peticiones con {meta.get('a_la_vez')} a la vez; carga.env pide {c['CERRADA_PETICIONES']} con {c['CERRADA_A_LA_VEZ']}: córrela otra vez")
    exige(meta.get("max_tokens") == int(c["MAX_TOKENS"]) and meta.get("max_num_seqs") == int(e["MAX_NUM_SEQS"]), "resultados/cerrada.json es de otra configuración: córrela otra vez")
    for m in ms:
        medida_valida(m, "cerrada")
    x = d["metricas"]
    exige(x["pico_running"] == DISENO, f"durante la cerrada corrieron hasta {x['pico_running']:.0f} a la vez en el motor: tienen que ser {DISENO}")
    tpot = sorted(m["tpot_s"] for m in ms)
    return f"{len(ms)} bien · TPOT p50 {tpot[len(tpot) // 2] * 1000:.0f} ms · {x['pico_running']:.0f} a la vez en el motor · preemptions {x['preemptions']:.0f} · {meta['motor'][:40]}…"


def check_abierta() -> str:
    c = carga_env()
    d = resultado("abierta")
    ms, meta = d["medidas"], d["meta"]
    n, tasa, semilla = int(c["PETICIONES"]), float(c["TASA"]), int(c["SEMILLA"])
    exige(len(ms) == n and meta.get("tasa") == tasa and meta.get("semilla") == semilla and meta.get("max_tokens") == int(c["MAX_TOKENS"]),
          f"resultados/abierta.json: {len(ms)} a {meta.get('tasa')}/s (semilla {meta.get('semilla')}); carga.env pide {n} a {tasa}/s (semilla {semilla}): córrela otra vez")
    r, t = random.Random(semilla), 0.0
    for m in sorted(ms, key=lambda m: m["programada"]):
        t += r.expovariate(tasa)
        exige(abs(m["programada"] - t) < 1e-6, f"{m['id']} estaba programada a los {m['programada']:.2f} s y Poisson con la semilla dice {t:.2f} s")
        exige(m["inicio"] - m["programada"] < 1.0, f"{m['id']} salió {m['inicio'] - m['programada']:.1f} s tarde: el cliente esperó (¿un tope de hilos?)")
        medida_valida(m, "abierta")
    ttft = sorted(m["ttft_s"] for m in ms)
    return f"{len(ms)} bien a {tasa}/s (Poisson, semilla {semilla}) en {meta['duracion_s'] / 60:.1f} min · todas a su hora · TTFT p50 {ttft[len(ttft) // 2] * 1000:,.0f} ms"


def p_rango(xs: list[float], q: float) -> float:
    s = sorted(xs)
    return s[max(1, math.ceil(q / 100 * len(s))) - 1]


def intervalo_v(xs: list[float]) -> tuple[float, float, bool]:
    s, n = sorted(xs), len(xs)
    d = 1.96 * math.sqrt(n * 0.95 * 0.05)
    bajo, alto = math.floor(n * 0.95 - d), math.ceil(n * 0.95 + d)
    return s[max(1, bajo) - 1], s[min(n, alto) - 1], alto <= n


def check_reporte() -> str:
    try:
        import reporte
    except ModuleNotFoundError as e:
        raise Falla(f"no puedo importar pipeline/reporte.py: {e}")
    xs = [5.0, 1.0, 4.0, 2.0, 3.0, 9.0, 7.0, 8.0, 6.0, 10.0]
    exige(llamar(reporte.percentil, xs, 95) == 10.0 and llamar(reporte.percentil, xs, 50) == 5.0, "percentil(): el de rango más cercano (p50 de 1…10 = 5, p95 = 10)")
    mil = [float(i) for i in range(1, 1001)]
    bajo, alto, rb, ra, cerrado = llamar(reporte.intervalo, mil, 95)
    exige((rb, ra, cerrado) == (936, 964, True), f"intervalo() del p95 con 1,000: rangos {rb}–{ra} y tienen que ser 936–964 (950 ∓ 1.96 × √47.5)")
    _, _, rb, ra, cerrado = llamar(reporte.intervalo, mil[:40], 95)
    exige((rb, ra, cerrado) == (35, 40, False), f"intervalo() del p95 con 40: rangos {rb}–{ra}, cerrado {cerrado}; tiene que ser 35–40 sin techo")
    llamar(reporte.main, segundos=60)
    r = leer_json(RESULTADOS / "reporte.json")
    exige(r, "reporte.main() no escribió resultados/reporte.json")
    c = carga_env()
    da, dc = resultado("abierta"), resultado("cerrada")
    ttft = [m["ttft_s"] * 1000 for m in da["medidas"]]
    tpot = [m["tpot_s"] * 1000 for m in dc["medidas"]]
    exige(abs(r["abierta"]["ttft_ms"]["p95"] - p_rango(ttft, 95)) < 1e-6, "el TTFT p95 de la abierta no es el de rango más cercano de resultados/abierta.json")
    exige(abs(r["cerrada"]["tpot_ms"]["p95"] - p_rango(tpot, 95)) < 1e-6, "el TPOT p95 de la cerrada no es el de rango más cercano")
    buenas = sum(1 for m in da["medidas"] if m["ttft_s"] * 1000 <= float(c["TTFT_MS"]) and m["tpot_s"] * 1000 <= float(c["TPOT_MS"]))
    exige(abs(r["abierta"]["goodput"] - buenas / da["meta"]["duracion_s"]) < 1e-9, f"goodput de la abierta: {buenas} cumplen las dos ÷ {da['meta']['duracion_s']} s")
    v = r["veredicto"]
    exige(len(v) == 5 and v[0]["que"].startswith("TTFT p95") and v[1]["que"].startswith("TPOT p95"), "veredicto(): 5 renglones, el primero el TTFT p95 y el segundo el TPOT p95")
    for x, xs, obj in ((v[0], ttft, float(c["TTFT_MS"])), (v[1], tpot, float(c["TPOT_MS"]))):
        bajo, alto, cerrado = intervalo_v(xs)
        debe = False if bajo > obj else (True if alto <= obj and cerrado else None)
        exige(x["pasa"] is debe, f"veredicto «{x['que']}»: dice {x['pasa']} y con el intervalo {bajo:,.1f}–{alto:,.1f}{'' if cerrado else ' (sin techo)'} contra {obj:.0f} es {debe}")
    marcas = " · ".join(f"{'✓' if x['pasa'] else '✗' if x['pasa'] is False else '?'} {x['que'].split(',')[0]}" for x in r["veredicto"])
    return f"percentil, intervalo y goodput como la cuenta de verificar · {marcas}"


def check_gpu() -> str:
    g = leer_env(GPU_ENV)
    faltan = [k for k in ("PROVEEDOR", "GPU", "USD_HORA", "DISCO_GB", "MINUTOS", "TIPO_CAMBIO") if not g.get(k)]
    exige(not faltan, f"gpu.env: faltan {', '.join(faltan)} (paso 6)")
    from mundo.gpu import PROVEEDORES, fases

    p = PROVEEDORES["proveedores"].get(g["PROVEEDOR"])
    exige(p, f"PROVEEDOR={g['PROVEEDOR']}: no está en mundo/proveedores.json")
    precio = p["gpu"].get(g["GPU"])
    exige(precio is not None, f"{p['nombre']} no renta {g['GPU']} (mundo/proveedores.json)")
    exige(abs(float(g["USD_HORA"]) - precio) < 0.005, f"USD_HORA={g['USD_HORA']} y {p['nombre']} cobra US${precio}/h por la {g['GPU'].upper()} (consultado {PROVEEDORES['consultado']})")
    from mundo.comun import GPUS

    exige(g["GPU"] in GPUS["gpus"] and GPUS["gpus"][g["GPU"]]["vram_gb"] >= 48, f"GPU={g['GPU']}: Qwen3 32B en AWQ (19.3 GB) con 8 conversaciones pide una de 48 GB")
    total = sum(m for _, m in fases())
    exige(float(g["MINUTOS"]) >= total * 1.2, f"MINUTOS={g['MINUTOS']}: la sesión estimada es de {total:.0f} min; deja ≥ 20 % de margen ({math.ceil(total * 1.2)})")
    exige(float(g["MINUTOS"]) <= 180, f"MINUTOS={g['MINUTOS']}: una sesión de práctica no pasa de 3 horas")
    costo = float(g["MINUTOS"]) / 60 * float(g["USD_HORA"])
    return f"{p['nombre']}, {g['GPU'].upper()} a US${precio}/h · sesión ≈ {total:.0f} min, tope {g['MINUTOS']} min = US${costo:.2f} (≈ MXN {costo * float(g['TIPO_CAMBIO']):.0f})"


CHECKS = {"mundo": check_mundo, "config": check_config, "prueba": check_prueba, "servidor": check_servidor, "clave": check_clave,
          "memoria": check_memoria, "plantilla": check_plantilla, "lugares": check_lugares, "humo": check_humo, "cerrada": check_cerrada,
          "abierta": check_abierta, "reporte": check_reporte, "gpu": check_gpu}


def correr(ids: list[str], silencio: bool = False) -> dict[str, tuple[bool, str]]:
    out = {}
    for i in ids:
        try:
            ok, msg = True, CHECKS[i]()
        except Falla as e:
            ok, msg = False, str(e)
        except SystemExit as e:  # lo que sale de mundo/ con sys.exit (un .env a medias) también es un check que no pasa
            ok, msg = False, str(e).lstrip("✗ ")
        except Exception as e:  # noqa: BLE001 — un error inesperado también es un check que no pasa
            ok, msg = False, f"{type(e).__name__}: {e}"
        out[i] = (ok, msg)
        if not silencio:
            print(f"{'✓' if ok else '✗'} {i:<9} {msg}", flush=True)
    return out


if __name__ == "__main__":
    pedidos = sys.argv[1:] or list(CHECKS)
    desconocidos = [p for p in pedidos if p not in CHECKS]
    if desconocidos:
        sys.exit(f"checks desconocidos: {desconocidos}. Hay: {', '.join(CHECKS)}")
    if not ENV.exists():
        sys.exit("falta servidor.env (está en el kit: ¿lo borraste?)")
    r = correr(pedidos)
    from taller.registro import anotar_verificacion  # la corrida queda en taller/progreso.json, para tu tablero

    anotar_verificacion({k: ok for k, (ok, _) in r.items()})
    malos = [k for k, (ok, _) in r.items() if not ok]
    print(f"\n{len(r) - len(malos)}/{len(r)} en verde" + (f" · falta: {', '.join(malos)}" if malos else ""))
    sys.exit(1 if malos else 0)
