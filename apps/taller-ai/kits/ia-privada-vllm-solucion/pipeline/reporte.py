"""El reporte de la prueba de carga: percentiles con su intervalo, goodput y el veredicto contra el criterio del despacho.

    python3 pipeline/reporte.py          # lee resultados/abierta.json y resultados/cerrada.json, escribe resultados/reporte.json

Contrato (lo revisa verificar.py contra su propia cuenta):
- `percentil(xs, q)`: el de rango más cercano. Ordena xs y toma el de la posición ceil(q/100 × n) (contando desde 1).
- `intervalo(xs, q)` → (bajo, alto, rango_bajo, rango_alto, cerrado): dónde cae el percentil verdadero con 95 % de
  confianza. Rangos = n·p ∓ 1.96·√(n·p·(1−p)), redondeados hacia afuera y recortados a [1, n]; cerrado es False si el
  de arriba se recortó (con tan pocas peticiones, el p95 no tiene techo: el más alto es lo más que sabes).
- `goodput(medidas, ttft_ms, tpot_ms, segundos)`: peticiones por segundo que cumplen las dos cosas (vllm bench serve --goodput).
- `veredicto(abierta, cerrada, criterio)` → [{"que", "pasa": True | False | None, "detalle"}]; None = no se sabe con estas
  peticiones (el intervalo cruza el objetivo).
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))
from mundo.comun import RESULTADOS, escribir_json, leer_env  # noqa: E402

Z95 = 1.96


def percentil(xs: list[float], q: float) -> float:
    s = sorted(xs)
    return s[max(1, math.ceil(q / 100 * len(s))) - 1]


def intervalo(xs: list[float], q: float) -> tuple[float, float, int, int, bool]:
    s, n, p = sorted(xs), len(xs), q / 100
    d = Z95 * math.sqrt(n * p * (1 - p))
    bajo, alto = math.floor(n * p - d), math.ceil(n * p + d)
    cerrado = alto <= n
    bajo, alto = max(1, bajo), min(n, alto)
    return s[bajo - 1], s[alto - 1], bajo, alto, cerrado


def goodput(medidas: list[dict], ttft_ms: float, tpot_ms: float, segundos: float) -> float:
    buenas = [m for m in medidas if m["ok"] and m["ttft_s"] * 1000 <= ttft_ms and (m["tpot_s"] or 0) * 1000 <= tpot_ms]
    return len(buenas) / segundos


def metrica(medidas: list[dict], campo: str) -> dict:
    xs = [m[campo] * 1000 for m in medidas if m["ok"] and m[campo] is not None]
    bajo, alto, rb, ra, cerrado = intervalo(xs, 95)
    return {"n": len(xs), "p50": percentil(xs, 50), "p95": percentil(xs, 95), "p99": percentil(xs, 99), "max": max(xs),
            "p95_intervalo": [bajo, alto], "p95_rangos": [rb, ra], "p95_cerrado": cerrado}


def resumen(d: dict, criterio: dict) -> dict:
    ms, meta = d["medidas"], d["meta"]
    ok = [m for m in ms if m["ok"]]
    r = {"tipo": meta["tipo"], "peticiones": len(ms), "errores": len(ms) - len(ok), "duracion_s": meta["duracion_s"],
         "ttft_ms": metrica(ms, "ttft_s"), "tpot_ms": metrica(ms, "tpot_s"), "e2e_ms": metrica(ms, "e2e_s"),
         "tokens_prompt_promedio": sum(m["tokens_prompt"] for m in ok) / len(ok), "tokens_salida_promedio": sum(m["tokens_salida"] for m in ok) / len(ok),
         "salida_tok_s": sum(m["tokens_salida"] for m in ok) / meta["duracion_s"],
         "goodput": goodput(ms, criterio["ttft_ms"], criterio["tpot_ms"], meta["duracion_s"]),
         "retraso_max_s": max(m["inicio"] - m["programada"] for m in ms), "metricas": d["metricas"]}
    if meta["tipo"] == "abierta":
        r["tasa_pedida"] = meta["tasa"]
    return r


def contra(m: dict, objetivo: float) -> bool | None:
    bajo, alto = m["p95_intervalo"]
    if bajo > objetivo:
        return False
    return True if alto <= objetivo and m["p95_cerrado"] else None


def veredicto(a: dict, c: dict, criterio: dict) -> list[dict]:
    ttft, tpot = a["ttft_ms"], c["tpot_ms"]
    v = [
        {"que": f"TTFT p95 ≤ {criterio['ttft_ms']:.0f} ms, abierta a {a['tasa_pedida']}/s", "pasa": contra(ttft, criterio["ttft_ms"]),
         "detalle": f"p95 {ttft['p95']:,.0f} ms (entre {ttft['p95_intervalo'][0]:,.0f} y {ttft['p95_intervalo'][1]:,.0f}{'' if ttft['p95_cerrado'] else ', sin techo'}; {ttft['n']} peticiones)"},
        {"que": f"TPOT p95 ≤ {criterio['tpot_ms']:.0f} ms, cerrada de {c['a_la_vez']} a la vez", "pasa": contra(tpot, criterio["tpot_ms"]),
         "detalle": f"p95 {tpot['p95']:,.1f} ms (entre {tpot['p95_intervalo'][0]:,.1f} y {tpot['p95_intervalo'][1]:,.1f}{'' if tpot['p95_cerrado'] else ', sin techo'}; {tpot['n']} peticiones)"},
        {"que": "sin errores", "pasa": a["errores"] == 0 and c["errores"] == 0, "detalle": f"abierta {a['errores']} · cerrada {c['errores']}"},
        {"que": "cada pregunta salió a su hora (la tasa pedida, no la que aguantó el cliente)", "pasa": a["retraso_max_s"] < 1.0,
         "detalle": f"el mayor retraso al mandar: {a['retraso_max_s']:.2f} s"},
        {"que": "sin preemptions", "pasa": a["metricas"]["preemptions"] == 0 and c["metricas"]["preemptions"] == 0,
         "detalle": f"abierta {a['metricas']['preemptions']:.0f} · cerrada {c['metricas']['preemptions']:.0f}"},
    ]
    return v


def main() -> None:
    c = leer_env(RAIZ / "carga.env")
    criterio = {"ttft_ms": float(c["TTFT_MS"]), "tpot_ms": float(c["TPOT_MS"])}
    da, dc = (json.loads((RESULTADOS / f"{t}.json").read_text()) for t in ("abierta", "cerrada"))
    a, ce = resumen(da, criterio), resumen(dc, criterio)
    ce["a_la_vez"] = dc["meta"]["a_la_vez"]
    v = veredicto(a, ce, criterio)
    escribir_json(RESULTADOS / "reporte.json", {"criterio": criterio, "abierta": a, "cerrada": ce, "veredicto": v, "motor": da["meta"]["motor"]})
    print(f"Motor: {da['meta']['motor']}")
    for r in (a, ce):
        t, p, e = r["ttft_ms"], r["tpot_ms"], r["e2e_ms"]
        print(f"\n{r['tipo']}: {r['peticiones']} peticiones, {r['errores']} errores, {r['duracion_s']:.0f} s"
              + (f" a {r['tasa_pedida']}/s" if "tasa_pedida" in r else f", {r['a_la_vez']} a la vez")
              + f" · ≈ {r['tokens_prompt_promedio']:,.0f} tokens de entrada y {r['tokens_salida_promedio']:.0f} de salida")
        print(f"  {'':5} {'p50':>9} {'p95':>9} {'p99':>9}   p95 entre (95 %)")
        for nombre, m in (("TTFT", t), ("TPOT", p), ("e2e", e)):
            print(f"  {nombre:5} {m['p50']:>9,.1f} {m['p95']:>9,.1f} {m['p99']:>9,.1f}   {m['p95_intervalo'][0]:,.1f} – {m['p95_intervalo'][1]:,.1f}{'' if m['p95_cerrado'] else ' (sin techo)'}  ms")
        x = r["metricas"]
        print(f"  goodput {r['goodput']:.3f}/s · salida {r['salida_tok_s']:.1f} tokens/s · a la vez hasta {x['pico_running']:.0f}, en fila hasta {x['pico_waiting']:.0f}"
              f" · KV hasta {x['kv_max']:.0%} · preemptions {x['preemptions']:.0f}")
    print("\nVeredicto contra el criterio del despacho:")
    for r in v:
        marca = {True: "✓", False: "✗", None: "?"}[r["pasa"]]
        print(f"  {marca} {r['que']}: {r['detalle']}")


if __name__ == "__main__":
    main()
