"""Pasos 3, 4 y 6: la API. POST /v1/ask recibe una pregunta, sabe quién pregunta por su llave, recupera el top-8 con
sus permisos, aparta lo sospechoso, arma el prompt, pide la respuesta al LLM local en streaming y la manda por SSE
con cada cita revisada. La arranca mundo/api.py (uvicorn en 127.0.0.1:9932).

Contrato (todo sale de config.yaml, que se lee en cada pregunta):
- app: la aplicación FastAPI. GET /health → {"status": "ok"}. POST /v1/ask con {"pregunta": "…"} (de 1 a 500
  caracteres; si no, 422) y la cabecera «Authorization: Bearer <llave>». La persona sale de la llave
  (almacen/tokens.json), nunca del cuerpo: sin llave o con una que no existe, 401. Contesta text/event-stream.
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
from _comun import TOKENS, config, corpus, directorio, leer_json, principals, puede_ver
import citas
import guardas
import llm as llm_
import prompt as prompt_
from sse import evento

app = FastAPI(title="rag-api", version="1.0")


class Pregunta(BaseModel):
    pregunta: str = Field(min_length=1, max_length=500)


def persona_de(authorization: str | None) -> str:
    raise NotImplementedError("paso 4: persona_de")


class Cache:

    def __init__(self):
        raise NotImplementedError("paso 4: Cache.__init__")

    def llave(self, pregunta: str, persona: str) -> tuple:
        raise NotImplementedError("paso 4: Cache.llave")

    def leer(self, llave: tuple):
        raise NotImplementedError("paso 4: Cache.leer")

    def guardar(self, llave: tuple, top: list) -> None:
        raise NotImplementedError("paso 4: Cache.guardar")


def responder(pregunta: str, persona: str, llm=None, recuperador=None, cache=None):
    raise NotImplementedError("paso 4: responder")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/v1/ask")
def ask(q: Pregunta, authorization: str | None = Header(default=None)):
    persona = persona_de(authorization)
    return StreamingResponse(responder(q.pregunta, persona), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
