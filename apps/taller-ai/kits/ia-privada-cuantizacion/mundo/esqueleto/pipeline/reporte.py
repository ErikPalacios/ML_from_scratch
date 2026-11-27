"""Paso 6: las tres cuantizaciones lado a lado, y la decisión. Lee resultados/velocidad.json y calidad.json.

    python3 pipeline/reporte.py       # imprime la tabla y la escribe en resultados/reporte.md

Regla de la decisión (la del despacho, en chico): la cuantización más chica cuya perplejidad no suba más de 5 % contra
el f16 y que no falle más de una pregunta del examen en ninguna vuelta.
"""
from __future__ import annotations

import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))
from mundo.comun import CATALOGO, RESULTADOS, leer_json  # noqa: E402

TOPE_PPL, TOPE_FALLAS = 0.05, 1

if __name__ == "__main__":
    v, c, m = leer_json(RESULTADOS / "velocidad.json"), leer_json(RESULTADOS / "calidad.json"), leer_json(RAIZ / "cuantizados" / "manifiesto.json")
    if not (v and c and m):
        sys.exit("✗ faltan resultados: corre pipeline/cuantizar.py, medir.py y calidad.py")
    f16 = c["f16"]["ppl"]
    filas = ["| Cuantización | MB | Bits por peso | Escribe (tokens/s) | Lee (tokens/s) | TTFT corto | TTFT largo | Perplejidad | Examen |",
             "|---|---:|---:|---:|---:|---:|---:|---:|---:|", f"| f16 (referencia) | {CATALOGO['qwen3-0.6b-f16']['bytes'] / 1e6:,.0f} | 16.00 | | | | | {f16:.2f} | |"]
    buenas = []
    for t in m:
        x, med, q = m[t], v["cuantizaciones"][t]["mediana"], c["cuantizaciones"][t]
        ppl, ex = q["perplejidad"]["ppl"], q["examen"]
        peor = min(e["aciertos"] for e in ex)
        filas.append(f"| {t} | {x['bytes'] / 1e6:,.0f} | {x['bits_por_peso']:.2f} | {med['corto']['decode_tps']:.0f} | {med['largo']['prefill_tps']:,.0f} | "
                     f"{med['corto']['ttft_ms']:.0f} ms | {med['largo']['ttft_ms']:,.0f} ms | {ppl:.2f} ({ppl / f16 - 1:+.1%}) | {peor}/{ex[0]['total']} |")
        if ppl / f16 - 1 <= TOPE_PPL and ex[0]["total"] - peor <= TOPE_FALLAS:
            buenas.append((x["bytes"], t))
    dec = f"**Decisión:** {min(buenas)[1]}, la más chica que no pierde más de {TOPE_PPL:.0%} de perplejidad ni más de {TOPE_FALLAS} pregunta del examen." if buenas else "**Decisión:** ninguna pasa la regla."
    texto = "\n".join(filas) + "\n\n" + dec + "\n"
    (RESULTADOS / "reporte.md").write_text("# Medir y cuantizar · Qwen3-0.6B\n\n" + texto)
    print(texto, end="")
