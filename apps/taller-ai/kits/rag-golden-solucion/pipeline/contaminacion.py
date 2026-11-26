"""Paso 5 · La regla de contaminación: lo que está en test nunca se usa para afinar.

    python pipeline/contaminacion.py       # qué preguntas de test del golden vigente se parecen a lo que se afina

El equipo del prompt afina con ejemplos (almacen/afinado/ejemplos.jsonl: los few-shot que van dentro del prompt y las
preguntas con las que prueba a mano). Si uno de esos ejemplos es una pregunta de test, el examen ya no mide si el
sistema sabe: mide si se acuerda. Dev sí se puede usar para afinar; test no.

Contrato:
- contaminadas(items, ejemplos, umbral) -> lista de (id, id_del_ejemplo, similitud), ordenada por id, de los items con
  split "test" cuya pregunta se parece (similitud() de parecidas.py ≥ umbral) a la pregunta de algún ejemplo.
  Un item aparece una sola vez, con el ejemplo más parecido (en empate, el de id menor). Los de dev no cuentan.
"""
from __future__ import annotations

from _comun import AFINADO, GOLDEN, VIGENTE, config, leer_jsonl
from parecidas import similitud


def contaminadas(items: list[dict], ejemplos: list[dict], umbral: float) -> list[tuple[str, str, float]]:
    out = []
    for x in sorted(items, key=lambda i: i["id"]):
        if x.get("split") != "test":
            continue
        mejor = None
        for e in sorted(ejemplos, key=lambda e: e["id"]):
            s = similitud(x["pregunta"], e["pregunta"])
            if mejor is None or s > mejor[0]:
                mejor = (s, e["id"])
        if mejor and mejor[0] >= umbral:
            out.append((x["id"], mejor[1], round(mejor[0], 3)))
    return out


if __name__ == "__main__":
    if not VIGENTE.exists():
        raise SystemExit("✗ todavía no hay golden vigente: python pipeline/armar.py")
    v = VIGENTE.read_text().strip()
    items = leer_jsonl(GOLDEN / v / "preguntas.jsonl")
    ej = leer_jsonl(AFINADO)
    cs = contaminadas(items, ej, config()["parecidas"]["umbral"])
    for i, e, s in cs:
        print(f"✗ {i} (test) se parece {s:.2f} al ejemplo {e} de afinado")
    print(f"{v}: {sum(x['split'] == 'test' for x in items)} preguntas de test contra {len(ej)} ejemplos de afinado · {len(cs)} contaminada(s)")
