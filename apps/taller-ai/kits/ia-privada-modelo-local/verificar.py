"""Revisa los criterios de «listo» de la estación, uno por check. Solo lee: no cambia servidor.env ni tu código.

    python verificar.py                  # todos
    python verificar.py servidor clave   # algunos

Los checks hablan con tu servidor de verdad (python mundo/servidor.py arrancar) y con tu cliente (pipeline/llm.py).
No hace falta entorno virtual: el kit solo usa la biblioteca estándar de Python.
"""
from __future__ import annotations

import json
import signal
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ))
sys.path.insert(0, str(RAIZ / "pipeline"))
from mundo.comun import CATALOGO, ENV, LLAMA_MIN, MUNDO, leer_env, ruta_modelo, sha256_archivo, version_llama  # noqa: E402

PRUEBA = [{"role": "system", "content": "Contesta en una frase."}, {"role": "user", "content": "¿Qué es un contrato de arrendamiento?"}]
TOKENS_PRUEBA = 33   # lo que mide la plantilla de Qwen3 (ChatML, sin razonamiento) para PRUEBA: ni uno más, ni uno menos
CONTEXTO_MIN = 8192  # el del despacho: instrucciones + 6 fragmentos + la pregunta ≈ 6,000 tokens, más la respuesta


class Falla(Exception):
    pass


def exige(cond, msg) -> None:
    if not cond:
        raise Falla(msg() if callable(msg) else msg)


def llamar(fn, *a, **k):
    def alarma(*_):
        raise Falla(f"{getattr(fn, '__qualname__', fn)} no terminó en 60 s")

    signal.signal(signal.SIGALRM, alarma)
    signal.alarm(60)
    try:
        return fn(*a, **k)
    except NotImplementedError as e:
        raise Falla(f"{getattr(fn, '__qualname__', '')} todavía es el esqueleto ({e or 'NotImplementedError'})")
    finally:
        signal.alarm(0)


def env() -> dict:
    e = leer_env()
    vacias = [k for k in ("MODELO", "ALIAS", "HOST", "PUERTO", "CONTEXTO", "PARALELO", "RAZONAMIENTO", "CLAVE", "LLM_URL") if not e.get(k)]
    exige(not vacias, f"servidor.env: faltan {', '.join(vacias)} (paso 1)")
    return e


def directo(ruta: str, cuerpo: dict | None = None, clave: str | None = None) -> tuple[int, dict]:
    """Una petición a la raíz del servidor, sin tu cliente: lo que ve cualquiera en la red."""
    e = leer_env()
    h = {"Content-Type": "application/json"}
    if clave:
        h["Authorization"] = f"Bearer {clave}"
    url = f"http://{e.get('HOST') or '127.0.0.1'}:{e.get('PUERTO') or 9931}{ruta}"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, json.dumps(cuerpo).encode() if cuerpo else None, h), timeout=60) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as err:
        try:
            return err.code, json.loads(err.read())
        except json.JSONDecodeError:
            return err.code, {}
    except (urllib.error.URLError, ConnectionError, TimeoutError) as err:
        raise Falla(f"nadie contesta en {url} ({getattr(err, 'reason', err)}): python mundo/servidor.py arrancar (y mira su log)")


def cliente():
    try:
        import llm
    except ModuleNotFoundError as e:
        raise Falla(f"no puedo importar pipeline/llm.py: {e}")
    return llm, llamar(llm.Cliente)


# ---------------------------------------------------------------- checks
def check_mundo() -> str:
    v, linea = version_llama()
    exige(v, "no encuentro llama-server: brew install llama.cpp (paso 0)")
    exige(v >= LLAMA_MIN, f"llama.cpp {linea}: el kit se probó con {'.'.join(map(str, LLAMA_MIN))} o más nuevo (brew upgrade llama.cpp)")
    m = CATALOGO["qwen3-0.6b-q8"]
    p = ruta_modelo()
    exige(p.exists(), "falta el modelo: python mundo/modelos.py")
    exige(sha256_archivo(p) == m["sha256"], "el sha256 de modelo/ no es el del catálogo: bórralo y python mundo/modelos.py")
    return f"llama.cpp {linea} · {m['archivo']} ({m['bytes'] / 1e6:.0f} MB, sha256 {m['sha256'][:12]}…)"


def check_config() -> str:
    e = env()
    exige(e["MODELO"] == f"modelo/{CATALOGO['qwen3-0.6b-q8']['archivo']}", f"MODELO={e['MODELO']}: tiene que ser el del catálogo, en modelo/")
    exige(e["HOST"] == "127.0.0.1", f"HOST={e['HOST']}: en la Mac el servidor escucha solo en 127.0.0.1; abrirlo a la red es una decisión (con clave y firewall)")
    exige(e["PUERTO"].isdigit(), f"PUERTO={e['PUERTO']} no es un número")
    exige(e["LLM_URL"] == f"http://{e['HOST']}:{e['PUERTO']}/v1", lambda: f"LLM_URL={e['LLM_URL']} no apunta a tu servidor: tiene que ser http://{e['HOST']}:{e['PUERTO']}/v1 (host, puerto y /v1)")
    exige(e["CONTEXTO"].isdigit() and int(e["CONTEXTO"]) >= CONTEXTO_MIN, f"CONTEXTO={e['CONTEXTO']}: el prompt del despacho pide ≥ {CONTEXTO_MIN:,} tokens")
    exige(e["RAZONAMIENTO"] == "off", f"RAZONAMIENTO={e['RAZONAMIENTO']}: el despacho lo quiere apagado (off)")
    exige(len(e["CLAVE"]) >= 8, "CLAVE: pon una de 8 caracteres o más")
    return f"{e['ALIAS']} en {e['LLM_URL']} · contexto {int(e['CONTEXTO']):,} · {e['PARALELO']} a la vez · razonamiento {e['RAZONAMIENTO']}"


def check_servidor() -> str:
    e = env()
    st, d = directo("/health")
    exige(st == 200 and d.get("status") == "ok", f"/health contesta {st} {d}")
    st, p = directo("/props", clave=e["CLAVE"])
    exige(st == 200, f"/props contesta {st}")
    exige(p.get("model_alias") == e["ALIAS"], f"el servidor sirve «{p.get('model_alias')}» y servidor.env dice ALIAS={e['ALIAS']}: ¿arrancaste con otro servir.sh?")
    exige(Path(p.get("model_path", "")).name == CATALOGO["qwen3-0.6b-q8"]["archivo"], f"el servidor cargó {p.get('model_path')}")
    st, m = directo("/v1/models", clave=e["CLAVE"])
    ctx = next((x.get("meta", {}).get("n_ctx") for x in m.get("data", []) if x["id"] == e["ALIAS"]), None)
    exige(ctx == int(e["CONTEXTO"]), f"el servidor cargó un contexto de {ctx} tokens y servidor.env dice {e['CONTEXTO']}: vuelve a arrancarlo")
    return f"/health ok · {p.get('model_alias')} ({p.get('model_ftype')}) · contexto {ctx:,} · build {p.get('build_info')}"


def check_clave() -> str:
    e = env()
    st, _ = directo("/v1/models")
    exige(st == 401, f"sin clave, /v1/models contesta {st}: cualquiera que llegue al puerto usa tu modelo (falta --api-key)")
    st, _ = directo("/v1/models", clave="otra-clave")
    exige(st == 401, f"con una clave equivocada contesta {st}")
    st, _ = directo("/v1/models", clave=e["CLAVE"])
    exige(st == 200, f"con la clave de servidor.env contesta {st}")
    return "sin clave → 401 · clave equivocada → 401 · tu clave → 200 (/health sigue abierto: solo dice si está vivo)"


def check_plantilla() -> str:
    e = env()
    st, d = directo("/v1/chat/completions", {"model": e["ALIAS"], "messages": PRUEBA, "temperature": 0, "seed": 7, "max_tokens": 120}, e["CLAVE"])
    exige(st == 200, f"/v1/chat/completions contesta {st}: {d}")
    u, c = d["usage"], d["choices"][0]
    exige(u["prompt_tokens"] == TOKENS_PRUEBA, f"la pregunta de prueba entró como {u['prompt_tokens']} tokens y con la plantilla de Qwen3 son {TOKENS_PRUEBA}: el servidor arma mal los mensajes (¿--chat-template?)")
    exige(not c["message"].get("reasoning_content"), lambda: f"el modelo razonó ({len(c['message']['reasoning_content'])} caracteres) antes de contestar: RAZONAMIENTO=off y --reasoning en servir.sh")
    exige(c["finish_reason"] == "stop", f"la respuesta no terminó sola (finish_reason {c['finish_reason']}, {u['completion_tokens']} tokens)")
    exige("arrend" in c["message"]["content"].lower(), f"la respuesta no habla de arrendamiento: {c['message']['content'][:80]!r}")
    return f"{u['prompt_tokens']} tokens de entrada (plantilla ChatML de Qwen3) · sin razonamiento · {u['completion_tokens']} de salida · terminó solo"


def check_cliente() -> str:
    llm, c = cliente()
    ms = llamar(c.modelos)
    exige(c.modelo in ms, f"modelos() da {ms} y servidor.env dice ALIAS={c.modelo}")
    n = llamar(c.contar_tokens, "Cláusula cuarta.")
    exige(n == 7, f"contar_tokens('Cláusula cuarta.') da {n} y son 7 (POST /tokenize en la raíz, sin /v1)")
    r1 = llamar(c.chat, PRUEBA, max_tokens=60)
    r2 = llamar(c.chat, PRUEBA, max_tokens=60)
    exige(isinstance(r1, llm.Respuesta), "chat() tiene que devolver una Respuesta")
    exige(r1.tokens_prompt == TOKENS_PRUEBA and r1.tokens_salida > 0, f"chat(): tokens_prompt {r1.tokens_prompt}, tokens_salida {r1.tokens_salida}")
    exige(r1.texto == r2.texto, "dos veces la misma pregunta con temperatura 0 y la misma semilla dieron textos distintos")
    exige(r1.fin in ("stop", "length"), f"fin = {r1.fin!r}")
    return f"modelos() {ms} · contar_tokens 7 · chat(): {r1.tokens_prompt} → {r1.tokens_salida} tokens en {r1.segundos:.2f} s, igual dos veces"


def check_stream() -> str:
    llm, c = cliente()
    partes = llamar(lambda: list(c.chat_stream(PRUEBA, max_tokens=60)))
    r = c.ultima
    exige(len(partes) > 3, f"chat_stream() dio {len(partes)} pedazo(s): tiene que ir soltando el texto conforme llega")
    exige(r is not None and r.ttft_s is not None, "chat_stream() no dejó la Respuesta con ttft_s en Cliente.ultima")
    exige(0 < r.ttft_s < r.segundos, f"ttft_s {r.ttft_s} tiene que ser mayor que 0 y menor que el total ({r.segundos})")
    exige(r.texto == "".join(partes) and r.tokens_salida > 0, "la Respuesta del stream no trae el texto completo o los tokens (stream_options include_usage)")
    return f"{len(partes)} pedazos · TTFT {r.ttft_s * 1000:.0f} ms de {r.segundos * 1000:.0f} ms · {r.tokens_salida} tokens"


def check_contexto() -> str:
    llm, c = cliente()
    e = env()
    largo = "cláusula " * (int(e["CONTEXTO"]) + 100)
    t0 = time.perf_counter()
    try:
        llamar(c.chat, [{"role": "user", "content": largo}], max_tokens=5)
        raise Falla("un prompt más largo que el contexto pasó sin error")
    except llm.ContextoExcedido as x:
        exige(x.n_ctx == int(e["CONTEXTO"]) and x.n_prompt > x.n_ctx, f"ContextoExcedido trae n_prompt {x.n_prompt} y n_ctx {x.n_ctx}")
        n_prompt, n_ctx = x.n_prompt, x.n_ctx
    except llm.ErrorLLM as x:
        raise Falla(f"un prompt que no cabe tiene que levantar ContextoExcedido, no {type(x).__name__}: {x}")
    despacho = llamar(c.contar_tokens, "cláusula " * 1500)
    return f"prompt de {n_prompt:,} tokens > contexto {n_ctx:,} → ContextoExcedido en {time.perf_counter() - t0:.2f} s · uno de ≈ 6,000 sí cabe ({despacho:,})"


def check_caido() -> str:
    llm, _ = cliente()
    e = env()
    t0 = time.perf_counter()
    try:
        llamar(llm.Cliente(url="http://127.0.0.1:9/v1", clave=e["CLAVE"], timeout=3).modelos)
        raise Falla("un servidor que no existe no dio error")
    except llm.SinConexion:
        pass
    except llm.ErrorLLM as x:
        raise Falla(f"sin servidor tiene que levantar SinConexion, no {type(x).__name__}")
    try:
        llamar(llm.Cliente(clave="otra-clave").modelos)
        raise Falla("con la clave equivocada no dio error")
    except llm.NoAutorizado:
        pass
    return f"sin servidor → SinConexion en {time.perf_counter() - t0:.2f} s · clave equivocada → NoAutorizado"


def check_citas() -> str:
    llm, c = cliente()
    d = json.loads((MUNDO / "entrada" / "clausulas.json").read_text())
    fr = d["fragmentos"]
    schema = {"type": "object", "properties": {"respuesta": {"type": "string"}, "citas": {"type": "array", "items": {"enum": list(fr)}, "minItems": 1}},
              "required": ["respuesta", "citas"]}
    ctx = "\n".join(f"[{k}] {v}" for k, v in fr.items())
    bien = 0
    for q in d["preguntas"]:
        r = llamar(c.chat_json, [{"role": "system", "content": "Contesta solo con los fragmentos y cita el id de cada fragmento que uses."},
                                 {"role": "user", "content": f"{ctx}\n\nPregunta: {q['pregunta']}"}], schema, max_tokens=150)
        exige(isinstance(r, dict) and set(r) >= {"respuesta", "citas"}, f"chat_json() dio {r!r}")
        exige(all(x in fr for x in r["citas"]), f"citó algo que no es un id: {r['citas']}")
        bien += q["cita"] in r["citas"]
    exige(bien == len(d["preguntas"]), f"solo {bien} de {len(d['preguntas'])} respuestas citaron el fragmento correcto")
    return f"{bien}/{len(d['preguntas'])} preguntas con la cita correcta · JSON válido con el schema (citas = enum de ids)"


CHECKS = {"mundo": check_mundo, "config": check_config, "servidor": check_servidor, "clave": check_clave, "plantilla": check_plantilla,
          "cliente": check_cliente, "stream": check_stream, "contexto": check_contexto, "caido": check_caido, "citas": check_citas}


def correr(ids: list[str], silencio: bool = False) -> dict[str, tuple[bool, str]]:
    out = {}
    for i in ids:
        try:
            ok, msg = True, CHECKS[i]()
        except Falla as e:
            ok, msg = False, str(e)
        except Exception as e:  # noqa: BLE001 — un error inesperado también es un check que no pasa
            ok, msg = False, f"{type(e).__name__}: {e}"
        out[i] = (ok, msg)
        if not silencio:
            print(f"{'✓' if ok else '✗'} {i:<10} {msg}", flush=True)
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
