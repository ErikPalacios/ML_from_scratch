"""Paso 4: el gate. Decide si un cambio (una corrida candidata) puede salir, comparándolo con la versión que hoy usa
la empresa (la base vigente), en las mismas preguntas. Bloquea si se cuela algo que la persona no puede ver, si el
juez no está calibrado, si el examen no es comparable o si el cambio pierde más de lo que el golden set deja ver.

    python pipeline/gate.py base-k2                 # decide (código de salida 1 si bloquea: así lo usa un CI)
    python pipeline/gate.py examen base-k2          # todo junto: correr, juzgar y decidir
    python pipeline/gate.py promover base           # la corrida pasa a ser la base vigente (corridas/VIGENTE)

Contrato (todo sale de la sección gate de config.yaml):
- base_de(candidata) → el nombre de la corrida contra la que se compara: con gate.base = vigente, la de corridas/VIGENTE
  (o None si todavía no hay); con gate.base = ultima, la corrida más reciente que no sea la candidata.
- no_inferior(base, cand, margen, z, pareado=True) → {"delta", "se", "cota", "pasa"}. base y cand: listas de valores
  por pregunta (1/0, o el recall de cada una), en el mismo orden. delta = media(cand) − media(base). Pareado: con
  d_i = cand_i − base_i, se = √(Σ (d_i − delta)²) ÷ n. Sin parear (como dos porcentajes sueltos): se = √(var_b ÷ n +
  var_c ÷ n), con var la varianza de cada lista (dividida entre n). cota = delta − z × se; pasa = cota ≥ −margen.
- decidir(candidata, base=None) → {"candidata", "base", "pasa", "reglas": [{"regla", "pasa", "detalle"}]}, y lo
  escribe en corridas/<candidata>/gate.json. Las reglas, en este orden:
    comparable  hay base, y las dos corridas tienen el mismo golden (versión y sha256), el mismo split y las mismas ids
    sin_cache   la candidata corrió sin cache: ninguna fila con de_cache (si no, mide el retrieval de antes)
    juez        corridas/calibracion.json pasa, y el juez y la rúbrica de esa calibración son los mismos que calificaron
                las dos corridas (juicio.json)
    permisos    fugas de la candidata ≤ gate.fugas_max (0: una sola bloquea)
    recall      recall de la candidata ≥ gate.recall_min, y no inferior a la base con gate.margen
    exactitud   las correctas (juicio.jsonl) no inferiores a la base con gate.margen, y la caída observada ≤ gate.caida_max
  pasa = todas pasan. d["info"] trae el primer token (p50 y p95) de la base y de la candidata: se muestra, pero no
  decide (el examen corre una pregunta a la vez; la latencia se prueba con carga). Si comparable o juez no pasan, las que dependen de ellas se dan por no pasadas. Con la regla
  exactitud evaluada, d["cambios"] lista las preguntas que cambiaron de veredicto: {"id", "antes", "despues",
  "respuesta"} (la respuesta de la candidata), para leerlas: la estadística no ve todo.
- promover(nombre) → escribe corridas/VIGENTE con ese nombre (de un jalón) y agrega una línea a corridas/historial.jsonl.
  Solo si su gate.json pasa contra la base vigente de ese momento; la primera base (sin VIGENTE) solo pide que su
  juicio exista y que no tenga fugas. Si no, ValueError.
"""

from __future__ import annotations
import json
import math
import os
import sys
import time
from datetime import datetime
from pathlib import Path
from _comun import RAIZ, config, escribir_json, leer_json, leer_jsonl
import metricas

CORRIDAS = RAIZ / "corridas"

VIGENTE = CORRIDAS / "VIGENTE"


def base_de(candidata: str) -> str | None:
    raise NotImplementedError("paso 4: base_de")


def no_inferior(base: list[float], cand: list[float], margen: float, z: float, pareado: bool = True) -> dict:
    raise NotImplementedError("paso 4: no_inferior")


def decidir(candidata: str, base: str | None = None) -> dict:
    raise NotImplementedError("paso 4: decidir")


def promover(nombre: str) -> None:
    raise NotImplementedError("paso 4: promover")


def texto(d: dict) -> str:
    lineas = [f"{'✓' if x['pasa'] else '✗'} {x['regla']:<11} {x['detalle']}" for x in d["reglas"]]
    i = d.get("info") or {}
    if i.get("ttft_p95"):
        f = lambda x: "—" if x is None else f"{x:.0f}"  # noqa: E731
        lineas.append(f"· primer token p50 {f(i['ttft_p50'][0])} → {f(i['ttft_p50'][1])} ms, p95 {f(i['ttft_p95'][0])} → {f(i['ttft_p95'][1])} ms "
                      "(se muestra, no decide: la latencia se prueba con carga)")
    if d.get("cambios"):
        lineas.append("\nCambiaron de veredicto:")
        lineas += [f"  {c['id']} {c['antes']} → {c['despues']}: «{c['respuesta'][:110]}»" for c in d["cambios"]]
    lineas.append(f"\n{'PASA' if d['pasa'] else 'BLOQUEA'}: {d['candidata']} contra {d['base']}")
    return "\n".join(lineas)


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a:
        sys.exit("uso: python pipeline/gate.py <candidata> | examen <nombre> | promover <nombre>")
    if a[0] == "promover":
        try:
            promover(a[1])
        except ValueError as e:
            sys.exit(f"✗ {e}")
        print(f"✓ corridas/VIGENTE → {a[1]}")
        sys.exit(0)
    t0 = time.perf_counter()
    if a[0] == "examen":
        import correr
        import juez

        correr.correr(a[1])
        juez.juzgar(CORRIDAS / a[1])
        a = a[1:]
    d = decidir(a[0])
    print(texto(d) + f" · {time.perf_counter() - t0:.0f} s")
    sys.exit(0 if d["pasa"] else 1)
