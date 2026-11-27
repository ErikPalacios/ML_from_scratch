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

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _comun import RAIZ, config, escribir_json, leer_json, leer_jsonl  # noqa: E402
import metricas  # noqa: E402

CORRIDAS = RAIZ / "corridas"
VIGENTE = CORRIDAS / "VIGENTE"


def base_de(candidata: str) -> str | None:
    if config()["gate"]["base"] == "vigente":
        return VIGENTE.read_text().strip() if VIGENTE.exists() else None
    otras = [(leer_json(p / "manifiesto.json")["fecha"], p.name) for p in CORRIDAS.iterdir()
             if p.is_dir() and not p.name.startswith(".") and p.name != candidata and (p / "manifiesto.json").exists()]
    return max(otras)[1] if otras else None


def no_inferior(base: list[float], cand: list[float], margen: float, z: float, pareado: bool = True) -> dict:
    n = len(base)
    mb, mc = sum(base) / n, sum(cand) / n
    delta = mc - mb
    if pareado:
        d = [c - b for b, c in zip(base, cand)]
        se = math.sqrt(sum((x - delta) ** 2 for x in d)) / n
    else:
        vb = sum((x - mb) ** 2 for x in base) / n
        vc = sum((x - mc) ** 2 for x in cand) / n
        se = math.sqrt(vb / n + vc / n)
    cota = delta - z * se
    return {"delta": delta, "se": se, "cota": cota, "pasa": cota >= -margen}


def _juicio(nombre: str) -> tuple[dict, dict | None]:
    return {x["id"]: x["veredicto"] for x in leer_jsonl(CORRIDAS / nombre / "juicio.jsonl")}, leer_json(CORRIDAS / nombre / "juicio.json")


def decidir(candidata: str, base: str | None = None) -> dict:
    cfg = config()
    g = cfg["gate"]
    base = base or base_de(candidata)
    reglas = []

    def regla(nombre, pasa, detalle):
        reglas.append({"regla": nombre, "pasa": bool(pasa), "detalle": detalle})
        return pasa

    mc = leer_json(CORRIDAS / candidata / "manifiesto.json")
    rc = metricas.resumen(CORRIDAS / candidata)
    mb = leer_json(CORRIDAS / base / "manifiesto.json") if base else None
    if not mb:
        ok_comp = regla("comparable", False, "no hay base vigente: corre el examen con la versión de hoy y promuévela (python pipeline/gate.py promover <corrida>)")
    else:
        dif = [k for k, a, b in (("golden", mc["golden"], mb["golden"]), ("split", mc["split"], mb["split"]), ("preguntas", mc["ids"], mb["ids"])) if a != b]
        ok_comp = regla("comparable", not dif, f"contra {base}: mismo golden ({mc['golden']['version']}), split ({mc['split']}) y {mc['n']} preguntas"
                        if not dif else f"contra {base}: cambia {', '.join(dif)} ({mb['golden']['version']}/{mb['split']}/{mb['n']} → "
                        f"{mc['golden']['version']}/{mc['split']}/{mc['n']}): dos exámenes distintos no se comparan")
    regla("sin_cache", rc["de_cache"] == 0 and mc["sin_cache"], f"{rc['de_cache']} de {rc['n']} respuestas salieron de la cache de la API"
          + ("" if rc["de_cache"] == 0 and mc["sin_cache"] else ": la corrida midió el retrieval de antes, no el del cambio (evals.sin_cache)"))
    cal = leer_json(CORRIDAS / "calibracion.json")
    jc, ic = _juicio(candidata)
    jb, ib = _juicio(base) if base else ({}, None)
    if not cal:
        ok_juez = regla("juez", False, "no hay calibración: python pipeline/juez.py calibrar")
    else:
        mismo = all(i and i["juez"] == cal["juez"] and i["rubrica"] == cal["rubrica"] for i in ((ic, ib) if base else (ic,)))
        ok_juez = regla("juez", cal["pasa"] and mismo,
                        f"{cal['juez']['modelo']}: kappa {cal['kappa']:.2f} (≥ {cfg['juez']['kappa_min']}), falso pase {cal['falso_pase']:.0%} "
                        f"(≤ {cfg['juez']['falso_pase_max']:.0%})" + ("" if cal["pasa"] else " · no está calibrado: no se le cree")
                        + ("" if mismo else " · las corridas no las calificó este juez con esta rúbrica: vuelve a juzgarlas"))
    regla("permisos", rc["fugas"] <= g["fugas_max"], f"{rc['fugas']} pregunta(s) con un chunk que su persona no puede ver (máximo {g['fugas_max']})")
    z, margen = g["confianza_z"], g["margen"]
    if ok_comp:
        rb = metricas.resumen(CORRIDAS / base)
        ids = [i for i in mc["ids"] if rc["por_pregunta"][i]["recall"] is not None]
        r = no_inferior([rb["por_pregunta"][i]["recall"] for i in ids], [rc["por_pregunta"][i]["recall"] for i in ids], margen, z, g["pareado"])
        regla("recall", r["pasa"] and rc["recall"]["media"] >= g["recall_min"],
              f"{rb['recall']['media']:.1%} → {rc['recall']['media']:.1%} (mínimo {g['recall_min']:.0%}) · Δ {r['delta']:+.1%}, cota {r['cota']:+.1%} (≥ −{margen:.0%})")
    else:
        regla("recall", False, "sin una base comparable no hay contra qué")
    if ok_comp and ok_juez and set(jc) == set(mc["ids"]) and set(jb) == set(mc["ids"]):
        b = [int(jb[i] == "correcta") for i in mc["ids"]]
        c = [int(jc[i] == "correcta") for i in mc["ids"]]
        r = no_inferior(b, c, margen, z, g["pareado"])
        perdidas = sum(1 for x, y in zip(b, c) if x and not y)
        ganadas = sum(1 for x, y in zip(b, c) if y and not x)
        resp = {f["id"]: f["respuesta"] for f in leer_jsonl(CORRIDAS / candidata / "respuestas.jsonl")}
        cambios = [{"id": i, "antes": jb[i], "despues": jc[i], "respuesta": resp[i]} for i in mc["ids"] if jb[i] != jc[i]]
        regla("exactitud", r["pasa"] and -r["delta"] <= g["caida_max"],
              f"{sum(b)}/{len(b)} → {sum(c)}/{len(c)} correctas · pierde {perdidas}, gana {ganadas} · Δ {r['delta']:+.1%}, cota {r['cota']:+.1%} "
              f"(≥ −{margen:.0%}), caída máxima {g['caida_max']:.0%}")
    else:
        cambios = []
        regla("exactitud", False, "sin juez calibrado, base comparable y las dos corridas juzgadas, no se puede decir")
    rb_ = metricas.resumen(CORRIDAS / base) if mb else None
    info = {"ttft_p50": [rb_["ttft_p50"] if rb_ else None, rc["ttft_p50"]], "ttft_p95": [rb_["ttft_p95"] if rb_ else None, rc["ttft_p95"]]}
    d = {"candidata": candidata, "base": base, "pasa": all(x["pasa"] for x in reglas), "reglas": reglas, "cambios": cambios, "info": info,
         "fecha": datetime.now().astimezone().isoformat(timespec="seconds")}
    escribir_json(CORRIDAS / candidata / "gate.json", d)
    return d


def promover(nombre: str) -> None:
    actual = VIGENTE.read_text().strip() if VIGENTE.exists() else None
    if actual is None:
        if not (CORRIDAS / nombre / "juicio.jsonl").exists():
            raise ValueError(f"{nombre} no está juzgada: python pipeline/juez.py {nombre}")
        if metricas.resumen(CORRIDAS / nombre)["fugas"]:
            raise ValueError(f"{nombre} tiene fugas: no puede ser la base")
    else:
        d = leer_json(CORRIDAS / nombre / "gate.json")
        if not d or not d["pasa"] or d["base"] != actual:
            raise ValueError(f"{nombre} no pasó el gate contra la base vigente ({actual}): python pipeline/gate.py {nombre}")
    tmp = VIGENTE.with_name("VIGENTE.tmp")
    tmp.write_text(nombre + "\n")
    os.replace(tmp, VIGENTE)
    with open(CORRIDAS / "historial.jsonl", "a") as f:
        f.write(json.dumps({"fecha": datetime.now().astimezone().isoformat(timespec="seconds"), "vigente": nombre, "antes": actual},
                           ensure_ascii=False) + "\n")


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
