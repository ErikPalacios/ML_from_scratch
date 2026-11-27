"""Paso 6: contestar con citas que se puedan validar. Le pasa al modelo los fragmentos de mundo/entrada/clausulas.json
y le pide JSON con un schema: la respuesta y los ids de los fragmentos que usó.

    python pipeline/citar.py            # citas = enum de los ids: el servidor solo deja escribir un id que exista
    python pipeline/citar.py --libre    # citas = cualquier texto: a ver qué escribe el modelo
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from llm import Cliente, ErrorLLM  # noqa: E402

DATOS = json.loads((Path(__file__).resolve().parent.parent / "mundo" / "entrada" / "clausulas.json").read_text())
SISTEMA = "Contesta solo con los fragmentos y cita el id de cada fragmento que uses."


def schema(ids: list[str] | None) -> dict:
    """ids=None: citas de texto libre. Con ids, cada cita tiene que ser uno de ellos."""
    item = {"type": "string"} if ids is None else {"enum": ids}
    return {"type": "object", "required": ["respuesta", "citas"],
            "properties": {"respuesta": {"type": "string"}, "citas": {"type": "array", "items": item, "minItems": 1}}}


if __name__ == "__main__":
    libre = "--libre" in sys.argv
    fr = DATOS["fragmentos"]
    ctx = "\n".join(f"[{k}] {v}" for k, v in fr.items())
    cli, bien = Cliente(), 0
    for q in DATOS["preguntas"]:
        try:
            r = cli.chat_json([{"role": "system", "content": SISTEMA}, {"role": "user", "content": f"{ctx}\n\nPregunta: {q['pregunta']}"}],
                              schema(None if libre else list(fr)), max_tokens=150)
        except ErrorLLM as e:
            sys.exit(f"✗ {type(e).__name__}: {e}")
        ok = q["cita"] in r["citas"]
        bien += ok
        print(f"{'✓' if ok else '✗'} {q['pregunta']}\n    {r['respuesta']}\n    citas: {r['citas']} (la buena: {q['cita']})")
    print(f"\n{bien}/{len(DATOS['preguntas'])} con la cita correcta" + (" · citas de texto libre" if libre else " · citas = enum de ids"))
