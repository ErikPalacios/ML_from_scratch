"""Paso 5: las guardas. Antes de armar el prompt: apartar los chunks que traen instrucciones para el modelo
(inyección de instrucciones) y decidir si hay fuentes suficientes para contestar; si no, se dice que no se sabe
sin llamar al LLM.

Contrato:
- PATRONES: expresiones regulares de frases que le hablan al modelo («ignora las instrucciones anteriores»,
  «instrucción para el asistente», un turno de chat como «<|im_start|>», «system:» al principio de una línea…).
  Son una red, no un muro: atrapan lo obvio y se revisan con los documentos reales (ninguno del corpus de hoy
  las trae, salvo el que sí es un ataque).
- sospechoso(texto) → la frase que encontró (str) o None. Sin acentos ni mayúsculas importan.
- revisar(chunks, fuentes) → (limpios, apartados). chunks = [{"chunk_id", "titulo", "texto"}]; fuentes = la lista
  de seguridad.revisar_fuentes (wiki, jira, drive, politicas): la fuente de un chunk es lo de antes de «:» en su
  chunk_id. Solo se revisan los de esas fuentes; los demás pasan sin revisar. apartados = [{"chunk_id", "motivo"}].
  Los limpios conservan su orden.
- suficiente(puntajes, umbral) → bool: hay fuentes suficientes si hay al menos un chunk y el mejor puntaje del
  reranker llega a respuesta.umbral.
- NO_SE_TEXTO: lo que la API contesta cuando no sabe.
"""

from __future__ import annotations
import re
import unicodedata

NO_SE_TEXTO = "No encontré eso en los documentos que puedes ver."

PATRONES = [
    r"ignora\w*\s+(?:\w+\s+){0,3}(?:instrucciones|reglas|indicaciones)",
    r"olvida\w*\s+(?:\w+\s+){0,3}(?:instrucciones|reglas|indicaciones)",
    r"instruccion(?:es)?\s+para\s+(?:el|la)\s+(?:asistente|modelo|ia|bot|chatbot)",
    r"<\s*\|\s*im_(?:start|end)\s*\|\s*>",
    r"(?m)^\s*(?:system|sistema|assistant)\s*:",
    r"a partir de ahora\s+(?:eres|actua|responde)",
    r"no (?:cites|menciones|muestres)\s+(?:\w+\s+){0,2}(?:fuentes|documentos|reglas)",
]


def sospechoso(texto: str) -> str | None:
    raise NotImplementedError("paso 3: sospechoso")


def revisar(chunks: list[dict], fuentes: list[str]) -> tuple[list[dict], list[dict]]:
    raise NotImplementedError("paso 3: revisar")


def suficiente(puntajes: list[float], umbral: float) -> bool:
    raise NotImplementedError("paso 3: suficiente")


if __name__ == "__main__":
    # python pipeline/guardas.py  → revisa los chunks del corpus vigente y dice cuáles aparta
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from _comun import config, corpus

    ch = [{"chunk_id": k, **v} for k, v in corpus()["chunks"].items()]
    fuentes = config()["seguridad"]["revisar_fuentes"]
    limpios, apartados = revisar(ch, fuentes)
    print(f"{len(ch)} chunks · revisando {', '.join(fuentes)} · {len(apartados)} apartado(s)")
    for a in apartados:
        print(f"  ✗ {a['chunk_id']}: {a['motivo']}")
