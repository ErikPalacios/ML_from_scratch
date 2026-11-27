"""La API de la estación 8 (ya hecha: es su solución). POST /v1/ask recibe una pregunta, sabe quién pregunta por su llave, recupera el top-8 con
sus permisos, aparta lo sospechoso, arma el prompt, pide la respuesta al LLM local en streaming y la manda por SSE
con cada cita revisada. La arranca mundo/api.py (uvicorn en 127.0.0.1:9932).

Contrato (todo sale de config.yaml, que se lee en cada pregunta):
- app: la aplicación FastAPI. GET /health → {"status": "ok"}. POST /v1/ask con {"pregunta": "…"} (de 1 a 500
  caracteres; si no, 422) y la cabecera «Authorization: Bearer <llave>». La persona sale de la llave
  (almacen/tokens.json), nunca del cuerpo: sin llave o con una que no existe, 401. Contesta text/event-stream.
  Con la cabecera «Cache-Control: no-cache» no lee el top de la cache (lo recupera otra vez): es lo que usa la
  estación 9 para que un examen mida el retrieval de hoy y no el de hace 5 minutos. Es una convención de esta API (en
  HTTP, no-cache pide revalidar lo guardado); en producción se limitaría a las llaves de evaluación, porque cualquiera
  podría forzar recuperaciones caras.
- persona_de(authorization) → el correo de quien pregunta, o HTTPException 401.
- Cache(): guarda el top-k del retrieval por api.cache.clave (los campos de la pregunta que forman la llave:
  pregunta y persona) durante api.cache.ttl_s segundos, hasta api.cache.max entradas. .llave(pregunta, persona),
  .leer(llave) → el top o None, .guardar(llave, top).
- responder(pregunta, persona, llm=None, recuperador=None, cache=None) → genera los eventos SSE (texto). Sin
  argumentos usa el LLM de servidor.env, el recuperador de la estación 6 y la cache de la API; verificar.py le
  pasa los suyos. Los eventos, en este orden:
    fuentes: {"contexto": [{"n", "chunk_id", "titulo"}], "recortados", "apartados", "descartados", "de_cache"}
    token:   {"texto"}   (uno o más; las citas ya revisadas)
    fin:     {"respuesta", "citas", "invalidas", "no_se", "completa", "fin", "tokens": {"prompt", "salida"},
              "ms": {"buscar", "reranker", "prompt", "ttft", "total"}}
  o, si algo falla después de empezar, error: {"motivo", "mensaje", "ms"} en lugar de fin. Siempre termina con
  exactamente uno de los dos: fin o error.
  descartados = chunks del top que la persona no puede ver (tiene que ser 0; si no, se quitan antes del prompt).
  Sin fuentes suficientes (guardas.suficiente con respuesta.umbral) contesta NO_SE_TEXTO sin llamar al LLM. Si el
  modelo empieza con NO_SE, también. motivo de error: "contexto" (no cupo), "llm" (el LLM no contesta o da error),
  "cortada" (el flujo del LLM terminó sin su finish_reason), "limite" (pasó llm.limite_s).
  ms.ttft = de que llega la pregunta al primer evento token.
"""
from __future__ import annotations

import sys
import time
from collections import OrderedDict
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _comun import TOKENS, config, corpus, directorio, leer_json, principals, puede_ver  # noqa: E402
import citas  # noqa: E402
import guardas  # noqa: E402
import llm as llm_  # noqa: E402
import prompt as prompt_  # noqa: E402
from sse import evento  # noqa: E402

app = FastAPI(title="rag-api", version="1.0")
_abiertos: dict = {}


class Pregunta(BaseModel):
    pregunta: str = Field(min_length=1, max_length=500)


def _recuperador():
    if "rec" not in _abiertos:
        from recuperar import abrir

        _abiertos["rec"] = abrir()
    return _abiertos["rec"]


def _cache():
    if "cache" not in _abiertos:
        _abiertos["cache"] = Cache()
    return _abiertos["cache"]


def persona_de(authorization: str | None) -> str:
    tipo, _, llave = (authorization or "").partition(" ")
    persona = (leer_json(TOKENS, {}) or {}).get(llave.strip()) if tipo.lower() == "bearer" else None
    if not persona:
        raise HTTPException(401, "falta la llave o no existe: Authorization: Bearer <llave>")
    return persona


class Cache:
    def __init__(self):
        self._d: OrderedDict = OrderedDict()

    def llave(self, pregunta: str, persona: str) -> tuple:
        campos = {"pregunta": pregunta.strip().lower(), "persona": persona}
        return tuple(campos[c] for c in config()["api"]["cache"]["clave"])

    def leer(self, llave: tuple):
        x = self._d.get(llave)
        if x is None or time.time() - x[0] > config()["api"]["cache"]["ttl_s"]:
            self._d.pop(llave, None)
            return None
        self._d.move_to_end(llave)
        return x[1]

    def guardar(self, llave: tuple, top: list) -> None:
        self._d[llave] = (time.time(), top)
        self._d.move_to_end(llave)
        while len(self._d) > config()["api"]["cache"]["max"]:
            self._d.popitem(last=False)


def _ms(t0: float) -> float:
    return round((time.perf_counter() - t0) * 1000, 1)


def responder(pregunta: str, persona: str, llm=None, recuperador=None, cache=None, usar_cache: bool = True):
    t0 = time.perf_counter()
    cfg = config()
    llm = llm or llm_.Cliente(timeout=cfg["llm"]["timeout_s"])
    recuperador = recuperador or _recuperador()
    cache = cache if cache is not None else _cache()
    ms = {"buscar": 0.0, "reranker": 0.0, "prompt": 0.0, "ttft": None, "total": None}
    try:
        # 1 · el top-k de la estación 6, de la cache si ya estaba
        llave = cache.llave(pregunta, persona)
        top, de_cache = (cache.leer(llave) if usar_cache else None), True
        if top is None:
            r = recuperador.recuperar(pregunta, persona, "completo")
            top, de_cache = r["top"], False
            ms["buscar"], ms["reranker"] = round(r["ms"]["buscar"], 1), round(r["ms"]["reranker"], 1)
            cache.guardar(llave, top)
        # 2 · lo que esta persona no puede ver no pasa, venga de donde venga; y se apartan los sospechosos
        ch = corpus()["chunks"]
        ps = principals(persona, directorio())
        ve = lambda cid: cid in ch and puede_ver(ch[cid]["acl"], ps)  # noqa: E731
        visibles = [(c, s) for c, s in top if ve(c)]
        descartados = len(top) - len(visibles)
        limpios, apartados = guardas.revisar([{"chunk_id": c, "titulo": ch[c]["titulo"], "texto": ch[c]["texto"]} for c, _ in visibles],
                                             cfg["seguridad"]["revisar_fuentes"])
        puntaje = dict(visibles)
        # 3 · sin fuentes suficientes, no se llama al LLM
        if not guardas.suficiente([puntaje[c["chunk_id"]] for c in limpios], cfg["respuesta"]["umbral"]):
            yield evento("fuentes", {"contexto": [], "recortados": [], "apartados": apartados, "descartados": descartados, "de_cache": de_cache})
            ms["ttft"] = _ms(t0)
            yield evento("token", {"texto": guardas.NO_SE_TEXTO})
            ms["total"] = _ms(t0)
            yield evento("fin", {"respuesta": guardas.NO_SE_TEXTO, "citas": [], "invalidas": [], "no_se": True, "completa": True,
                                 "fin": "sin_fuentes", "tokens": {"prompt": 0, "salida": 0}, "ms": ms})
            return
        # 4 · el prompt, en la ventana real del servidor
        t = time.perf_counter()
        p = prompt_.armar(pregunta, limpios, llm.contar_tokens, llm.ventana(), cfg["llm"]["max_tokens"], cfg["prompt"]["reserva"])
        ms["prompt"] = _ms(t)
        yield evento("fuentes", {"contexto": p["contexto"], "recortados": p["recortados"], "apartados": apartados,
                                 "descartados": descartados, "de_cache": de_cache})
    except ValueError as e:
        yield evento("error", {"motivo": "contexto", "mensaje": str(e), "ms": ms})
        return
    except llm_.ErrorLLM as e:
        yield evento("error", {"motivo": "llm", "mensaje": str(e), "ms": ms})
        return

    # 5 · la respuesta en streaming, con cada cita revisada antes de salir
    filtro = citas.Filtro(p["contexto"], ve, cfg["citas"]["contra"], cfg["retrieval"]["k"])
    salida, inicio, no_se = [], "", False
    limite = cfg["llm"]["limite_s"]
    flujo = llm.chat_stream(p["mensajes"], cfg["llm"]["max_tokens"], cfg["llm"]["temperatura"])
    t_llm = time.perf_counter()

    def mandar(texto):
        if texto:
            if ms["ttft"] is None:
                ms["ttft"] = _ms(t0)
            salida.append(texto)
            return evento("token", {"texto": texto})
        return None

    try:
        for pedazo in flujo:
            if time.perf_counter() - t_llm > limite:
                raise TimeoutError(f"el LLM no terminó en llm.limite_s = {limite} s")
            if not salida and not no_se and len((inicio + pedazo).lstrip()) < len(prompt_.NO_SE):
                inicio += pedazo                       # esperar a saber si empieza con NO_SE
                continue
            if not salida and not no_se:
                pedazo, inicio = inicio + pedazo, ""
                if pedazo.lstrip().startswith(prompt_.NO_SE):
                    no_se = True
                    break
            x = mandar(filtro.alimentar(pedazo))
            if x:
                yield x
        else:
            pedazo, inicio = inicio, ""
            if pedazo.lstrip().startswith(prompt_.NO_SE):
                no_se = True
            else:
                x = mandar(filtro.alimentar(pedazo))
                if x:
                    yield x
        if no_se:
            flujo.close()                              # deja de leer: el servidor deja de generar
            x = mandar(guardas.NO_SE_TEXTO)
            yield x
        else:
            x = mandar(filtro.cerrar())
            if x:
                yield x
            if not llm.ultima or not llm.ultima.fin:
                raise ConnectionError("el flujo del LLM terminó sin finish_reason: la respuesta quedó a la mitad")
    except TimeoutError as e:
        flujo.close()
        yield evento("error", {"motivo": "limite", "mensaje": str(e), "ms": ms | {"total": _ms(t0)}})
        return
    except llm_.ErrorLLM as e:
        yield evento("error", {"motivo": "llm", "mensaje": str(e), "ms": ms | {"total": _ms(t0)}})
        return
    except Exception as e:  # noqa: BLE001 — cualquier corte a la mitad cierra el flujo con un error
        yield evento("error", {"motivo": "cortada", "mensaje": f"{type(e).__name__}: {e}", "ms": ms | {"total": _ms(t0)}})
        return
    u = llm.ultima
    ms["total"] = _ms(t0)
    yield evento("fin", {"respuesta": "".join(salida), "citas": [] if no_se else filtro.validas, "invalidas": [] if no_se else filtro.invalidas,
                         "no_se": no_se, "completa": no_se or (u.fin == "stop"), "fin": "no_se" if no_se else u.fin,
                         "tokens": {"prompt": u.tokens_prompt if u else 0, "salida": u.tokens_salida if u else 0}, "ms": ms})


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/v1/ask")
def ask(q: Pregunta, authorization: str | None = Header(default=None), cache_control: str | None = Header(default=None)):
    persona = persona_de(authorization)
    usar = "no-cache" not in (cache_control or "").lower()
    return StreamingResponse(responder(q.pregunta, persona, usar_cache=usar), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
