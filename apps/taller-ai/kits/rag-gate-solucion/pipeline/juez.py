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

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _comun import ALMACEN, GOLDEN, RAIZ, config, escribir_json, escribir_jsonl, leer_json, leer_jsonl  # noqa: E402
import llm  # noqa: E402
from mundo.comun import leer_env  # noqa: E402

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


def _sha(texto: str) -> str:
    return hashlib.sha256(texto.encode()).hexdigest()


class Juez:
    def __init__(self, url: str | None = None):
        self.cfg = config()["juez"]
        self.cliente = llm.Cliente(url=url or self.cfg["url"], clave=leer_env(RAIZ / "juez.env").get("CLAVE", ""), timeout=120)
        self._id = None

    def identidad(self) -> dict:
        if self._id is None:
            raiz = self.cliente.url.removesuffix("/v1")
            ruta = self.cliente._json("GET", f"{raiz}/props")["model_path"]
            meta = self.cliente._json("GET", f"{self.cliente.url}/models")["data"][0].get("meta", {})
            self._id = {"modelo": Path(ruta).name, "parametros": meta.get("n_params")}
        return self._id

    def calificar(self, pregunta: str, referencia: str, respuesta: str) -> bool:
        llave = _sha("\n".join([self.identidad()["modelo"], RUBRICA, str(self.cfg["temperatura"]), pregunta, referencia, respuesta]))
        p = CACHE_JUEZ / f"{llave}.json"
        guardado = leer_json(p)
        if guardado is not None:
            return guardado["correcta"]
        m = [{"role": "system", "content": RUBRICA},
             {"role": "user", "content": f"Pregunta: {pregunta}\nReferencia: {referencia}\nRespuesta del asistente: {respuesta}"}]
        v = self.cliente.chat_json(m, SCHEMA, max_tokens=self.cfg["max_tokens"], temperatura=self.cfg["temperatura"])
        correcta = not v["error"]
        escribir_json(p, {"correcta": correcta})
        return correcta


def veredicto(fila: dict, x: dict, juez: Juez) -> tuple[str, str]:
    if fila["error"]:
        return "incorrecta", "regla"
    if fila["no_se"]:
        return ("correcta" if x["tipo"] in ("sin_respuesta", "prohibida") else "incorrecta"), "regla"
    ok = juez.calificar(x["pregunta"], x["respuesta"], fila["respuesta"])
    return ("correcta" if ok else "incorrecta"), "juez"


def kappa(pares: list[tuple[int, int]]) -> float:
    n = len(pares)
    po = sum(a == b for a, b in pares) / n
    ph, pj = sum(a for a, _ in pares) / n, sum(b for _, b in pares) / n
    pe = ph * pj + (1 - ph) * (1 - pj)
    return 0.0 if pe == 1 else (po - pe) / (1 - pe)


def calibrar(juez: Juez | None = None) -> dict:
    juez = juez or Juez()
    cal = leer_jsonl(CALIFICACIONES)
    pares = [(int(c["etiqueta"] == "correcta"), int(juez.calificar(c["pregunta"], c["referencia"], c["respuesta"]))) for c in cal]
    reprobadas = sum(1 for h, _ in pares if h == 0)
    aprobadas = len(pares) - reprobadas
    fp = sum(1 for h, j in pares if h == 0 and j == 1) / reprobadas if reprobadas else 0.0
    fr = sum(1 for h, j in pares if h == 1 and j == 0) / aprobadas if aprobadas else 0.0
    k = kappa(pares)
    cfg = config()["juez"]
    r = {"n": len(pares), "acuerdo": sum(a == b for a, b in pares) / len(pares), "kappa": k, "falso_pase": fp, "reprobadas": reprobadas,
         "falso_rechazo": fr, "juez": juez.identidad(), "rubrica": _sha(RUBRICA),
         "pasa": k >= cfg["kappa_min"] and fp <= cfg["falso_pase_max"]}
    escribir_json(CALIBRACION, r)
    return r


def juzgar(carpeta: Path, juez: Juez | None = None) -> list[dict]:
    carpeta, juez = Path(carpeta), juez or Juez()
    m = leer_json(carpeta / "manifiesto.json")
    g = {x["id"]: x for x in leer_jsonl(GOLDEN / m["golden"]["version"] / "preguntas.jsonl")}
    out = []
    for f in leer_jsonl(carpeta / "respuestas.jsonl"):
        v, por = veredicto(f, g[f["id"]], juez)
        out.append({"id": f["id"], "veredicto": v, "por": por})
    escribir_jsonl(carpeta / "juicio.jsonl", out)
    escribir_json(carpeta / "juicio.json", {"juez": juez.identidad(), "rubrica": _sha(RUBRICA)})
    return out


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
