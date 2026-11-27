"""Paso 3: el juez. Un LLM (otro, más grande que el de la API) lee la pregunta, la respuesta de referencia del golden
set y la respuesta de tu API, y dice si la respuesta es correcta. Antes de creerle se calibra: se le dan respuestas que
ya calificaron dos personas del equipo y se mide cuánto se parece a ellas (kappa de Cohen y falso pase).

    python pipeline/juez.py calibrar      # contra almacen/calificaciones.jsonl; escribe corridas/calibracion.json
    python pipeline/juez.py calibrar --url http://127.0.0.1:9931/v1   # lo mismo con otro servidor (aquí, el LLM de la API)
    python pipeline/juez.py base          # califica la corrida base; escribe corridas/base/juicio.jsonl

Contrato (todo sale de la sección juez de config.yaml):
- RUBRICA: las instrucciones del juez. SCHEMA: el JSON que tiene que contestar: {"error": true|false}.
- Juez(url=None): habla con el servidor de url (por omisión, juez.url; la llave es CLAVE de juez.env). .identidad() → {"modelo": el nombre del
  archivo que sirve ese servidor (GET /props, model_path), "parametros": n_params de GET /v1/models}. .calificar(
  pregunta, referencia, respuesta) → True si es correcta. Con juez.temperatura y juez.max_tokens. Guarda cada
  veredicto en cache/juez/<sha256>.json, con la llave hecha del modelo, la rúbrica, la pregunta, la referencia y la
  respuesta: la misma respuesta no se vuelve a calificar, y un juez o una rúbrica nuevos no reusan lo viejo.
- veredicto(fila, x, juez) → ("correcta" | "incorrecta", "regla" | "juez"). Sin llamar al juez: una fila con error es
  incorrecta; un «no sé» es correcto en sin_respuesta y prohibida, e incorrecto en directa y varias. Lo demás, el juez.
- kappa(pares) → la kappa de Cohen de una lista de pares (humano, juez) de 1 y 0: (p_o − p_e) ÷ (1 − p_e). Si
  p_e = 1, 0.
- calibrar(juez=None) → dict {"n", "acuerdo", "kappa", "falso_pase" (fracción de las que las personas reprobaron y
  el juez aprobó), "reprobadas" (cuántas reprobaron las personas), "falso_rechazo", "juez": identidad(), "rubrica":
  sha256 de RUBRICA, "pasa"}. pasa = kappa ≥ juez.kappa_min y falso_pase ≤ juez.falso_pase_max. Lo escribe en
  corridas/calibracion.json.
- juzgar(carpeta, juez=None) → la lista de {"id", "veredicto", "por"} de cada fila; la escribe en <carpeta>/juicio.jsonl
  con el juez y la rúbrica en <carpeta>/juicio.json.
"""

from __future__ import annotations
import hashlib
import json
import sys
import time
from pathlib import Path
from _comun import ALMACEN, GOLDEN, RAIZ, config, escribir_json, escribir_jsonl, leer_json, leer_jsonl
import llm
from mundo.comun import leer_env

CACHE_JUEZ = RAIZ / "cache" / "juez"

CALIFICACIONES = ALMACEN / "calificaciones.jsonl"

CALIBRACION = RAIZ / "corridas" / "calibracion.json"

RUBRICA = (
    "Comparas la respuesta de un asistente con la respuesta de referencia, que escribió una experta y es la correcta.\n"
    "La respuesta tiene un error si:\n"
    "- da un dato distinto o contrario a la referencia: otro número, otro plazo, otro monto, otra persona, «sí» en vez de «no»;\n"
    "- contesta algo cuando la referencia dice que no está en los documentos;\n"
    "- dice que no sabe, o no contesta, cuando la referencia sí tiene la respuesta.\n"
    "Si solo le faltan detalles secundarios o lo dice con otras palabras, NO es un error.\n"
    "Contesta en JSON: {\"error\": true} o {\"error\": false}."
)

SCHEMA = {"type": "object", "properties": {"error": {"type": "boolean"}}, "required": ["error"]}


class Juez:

    def __init__(self, url: str | None = None):
        raise NotImplementedError("paso 3: Juez.__init__")

    def identidad(self) -> dict:
        raise NotImplementedError("paso 3: Juez.identidad")

    def calificar(self, pregunta: str, referencia: str, respuesta: str) -> bool:
        raise NotImplementedError("paso 3: Juez.calificar")


def veredicto(fila: dict, x: dict, juez: Juez) -> tuple[str, str]:
    raise NotImplementedError("paso 3: veredicto")


def kappa(pares: list[tuple[int, int]]) -> float:
    raise NotImplementedError("paso 3: kappa")


def calibrar(juez: Juez | None = None) -> dict:
    raise NotImplementedError("paso 3: calibrar")


def juzgar(carpeta: Path, juez: Juez | None = None) -> list[dict]:
    raise NotImplementedError("paso 3: juzgar")


if __name__ == "__main__":
    que = sys.argv[1] if len(sys.argv) > 1 else sys.exit("uso: python pipeline/juez.py calibrar | <corrida>")
    t0 = time.perf_counter()
    if que == "calibrar":
        r = calibrar(Juez(sys.argv[3]) if sys.argv[2:3] == ["--url"] else None)
        c = config()["juez"]
        print(f"{'✓' if r['pasa'] else '✗'} juez {r['juez']['modelo']} contra {r['n']} calificaciones de personas: acuerdo {r['acuerdo']:.1%} · "
              f"kappa {r['kappa']:.2f} (mínimo {c['kappa_min']}) · falso pase {r['falso_pase']:.1%} de {r['reprobadas']} reprobadas "
              f"(máximo {c['falso_pase_max']:.0%}) · falso rechazo {r['falso_rechazo']:.1%} · {time.perf_counter() - t0:.0f} s")
    else:
        v = juzgar(RAIZ / "corridas" / que)
        ok = sum(x["veredicto"] == "correcta" for x in v)
        print(f"✓ corridas/{que}/juicio.jsonl: {ok}/{len(v)} correctas ({sum(x['por'] == 'juez' for x in v)} por el juez, "
              f"{sum(x['por'] == 'regla' for x in v)} por regla) · {time.perf_counter() - t0:.0f} s")
