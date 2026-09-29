"""Job diario: drift de color de tinción por lab/escáner con PSI (caso c04) → gauges en el Pushgateway.

Cada summary.json del worker trae qc.color_hist: conteos de pixeles de TEJIDO por canal (R, G, B) en
16 bins fijos sobre 0–255, medidos en el thumbnail de la máscara. Este job suma los slides del día por
(lab, escáner), los compara con la referencia (los slides de training, labs A/B) y calcula el PSI
por canal. monitoring/alerts.yml → StainDriftPerScanner dispara con PSI > 0.2 y ≥ 20 slides.

PSI (Population Stability Index), con p = proporción de hoy y q = proporción de referencia por bin:
    PSI = Σ (p_i − q_i) × ln(p_i / q_i)
Ejemplo con 4 bins: referencia [0.25, 0.25, 0.25, 0.25], hoy [0.10, 0.20, 0.30, 0.40]
    (−0.15)(ln 0.4) + (−0.05)(ln 0.8) + (0.05)(ln 1.2) + (0.15)(ln 1.6)
    = 0.1374 + 0.0112 + 0.0091 + 0.0705 ≈ 0.228  → sobre 0.2
Reglas empíricas usuales: < 0.1 estable, 0.1–0.2 moderado, > 0.2 cambio significativo. Son convención,
no estadística: calibra el umbral mirando días normales de cada escáner.
Un bin vacío haría ln(0): se usa un piso de 1e-4 en ambas distribuciones (lo usual en la práctica).

Por qué un job diario y no una métrica del worker: PSI compara DISTRIBUCIONES de muchos slides; un
slide solo no tiene "drift". Por qué el Pushgateway: es un job batch que termina; Prometheus no
alcanzaría a scrapearlo. Trampa: el Pushgateway conserva el último valor para siempre. Por eso el job
empuja UNA vez, al final y con todo calculado: el push_time_seconds que agrega el Pushgateway es la
hora de la última corrida exitosa, y alerts.yml → StainPsiJobStale avisa si pasa de 26 h.

Una sola referencia (training, labs A/B) para todos es la versión del día 1. Lab C sale alto desde el
primer día (otro vendor, otro color) y se silencia hasta validarlo. Después de validarlo, quitar el
silencio no alcanza: la alerta sonaría todos los días y un cambio real de color en C quedaría
escondido. Lab C (y cada escáner nuevo) recibe su propia referencia, construida con sus slides de
silent mode o de validación (`--write-reference` sobre esos summary.json), y cada (lab, escáner) se
compara con la suya; el PSI contra training queda como panel informativo. Esa selección de referencia
por (lab, escáner) no está implementada aquí: compute() recibe una sola.
Por qué RGB y no algo mejor: es el baseline más simple de explicar. La tinción H&E se separa mejor en
densidad óptica o con deconvolución de color (canales H y E); el esqueleto del job no cambia.

Uso:
  python stain_psi.py --summaries dia/ --reference referencia.json [--pushgateway pushgateway:9091]
  python stain_psi.py --summaries training/ --write-reference referencia.json
(dia/ = los summary.json del día, descargados antes; en producción se listan desde el índice en Postgres.)
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

CHANNELS = ("r", "g", "b")
EPS = 1e-4  # piso por bin: evita ln(0) y divisiones por 0


def psi(actual: list[float], expected: list[float]) -> float:
    """PSI entre dos histogramas (conteos o proporciones, del mismo largo)."""
    if len(actual) != len(expected) or not actual:
        raise ValueError("histogramas de distinto largo")
    ta, te = float(sum(actual)), float(sum(expected))
    if ta <= 0 or te <= 0:
        raise ValueError("histograma vacío")
    total = 0.0
    for a, e in zip(actual, expected):
        p = max(a / ta, EPS)
        q = max(e / te, EPS)
        total += (p - q) * math.log(p / q)
    return total


def load_summaries(folder: Path) -> list[dict]:
    """Todos los summary.json bajo la carpeta (recursivo). Solo status "ok": los qc_blocked no tienen
    histograma confiable (y su causa ya la alerta MissingMppMetadata)."""
    out = []
    for p in sorted(folder.rglob("*.json")):
        s = json.loads(p.read_text())
        if s.get("status") == "ok" and s.get("qc", {}).get("color_hist"):
            out.append(s)
    return out


def aggregate(summaries: list[dict]) -> dict[tuple[str, str], dict]:
    """(lab, escáner) → {"slides": n, "r": [conteos], "g": [...], "b": [...]} sumando slides."""
    agg: dict[tuple[str, str], dict] = {}
    for s in summaries:
        key = (s["lab"], s["scanner"])
        hist = s["qc"]["color_hist"]
        if key not in agg:
            agg[key] = {"slides": 0, **{c: [0] * len(hist[c]) for c in CHANNELS}}
        agg[key]["slides"] += 1
        for c in CHANNELS:
            if len(hist[c]) != len(agg[key][c]):
                raise ValueError(f"{s['slide_id']}: bins distintos en el canal {c}")
            agg[key][c] = [x + y for x, y in zip(agg[key][c], hist[c])]
    return agg


def build_reference(summaries: list[dict]) -> dict:
    """Referencia = TODOS los slides dados juntos (un solo histograma por canal): los de training, o
    los de silent mode/validación de un lab o escáner nuevo cuando se le construye la suya."""
    ref = {"slides": 0, **{c: None for c in CHANNELS}}
    for s in summaries:
        ref["slides"] += 1
        for c in CHANNELS:
            h = s["qc"]["color_hist"][c]
            ref[c] = h if ref[c] is None else [x + y for x, y in zip(ref[c], h)]
    return ref


def compute(agg: dict, reference: dict) -> list[dict]:
    rows = []
    for (lab, scanner), a in sorted(agg.items()):
        for c in CHANNELS:
            rows.append({"lab": lab, "scanner": scanner, "channel": c, "slides": a["slides"],
                         "psi": round(psi(a[c], reference[c]), 4)})
    return rows


def push(rows: list[dict], gateway: str, handler=None) -> None:
    """Gauges seg_stain_psi{lab,scanner,channel} y seg_stain_psi_slides{lab,scanner} al Pushgateway.
    Un solo grupo (job="stain-psi"): cada corrida REEMPLAZA la anterior entera."""
    from prometheus_client import CollectorRegistry, Gauge, push_to_gateway
    from prometheus_client.exposition import default_handler

    reg = CollectorRegistry()
    g_psi = Gauge("seg_stain_psi", "PSI del color del tejido vs training", ["lab", "scanner", "channel"],
                  registry=reg)
    g_n = Gauge("seg_stain_psi_slides", "Slides usados en el PSI del día", ["lab", "scanner"], registry=reg)
    for r in rows:
        g_psi.labels(r["lab"], r["scanner"], r["channel"]).set(r["psi"])
        g_n.labels(r["lab"], r["scanner"]).set(r["slides"])
    push_to_gateway(gateway, job="stain-psi", registry=reg, handler=handler or default_handler)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="PSI diario de color de tinción por lab/escáner")
    p.add_argument("--summaries", type=Path, required=True)
    p.add_argument("--reference", type=Path, help="JSON de referencia (training)")
    p.add_argument("--write-reference", type=Path, help="construye la referencia con --summaries")
    p.add_argument("--pushgateway", help="host:puerto del Pushgateway (sin esto solo imprime)")
    p.add_argument("--min-slides", type=int, default=20, help="debajo de esto el PSI se marca como ruido")
    a = p.parse_args(argv)
    summaries = load_summaries(a.summaries)
    if not summaries:
        print("error: no hay summary.json con status ok", file=sys.stderr)
        return 2
    if a.write_reference:
        a.write_reference.write_text(json.dumps(build_reference(summaries)))
        print(f"referencia con {len(summaries)} slides → {a.write_reference}", file=sys.stderr)
        return 0
    if not a.reference:
        p.error("falta --reference (o --write-reference)")
    rows = compute(aggregate(summaries), json.loads(a.reference.read_text()))
    for r in rows:
        mark = "  (pocos slides)" if r["slides"] < a.min_slides else ("  > 0.2" if r["psi"] > 0.2 else "")
        print(f"{r['lab']:>3} {r['scanner']:<10} {r['channel']}  n={r['slides']:<5} PSI={r['psi']:.3f}{mark}")
    if a.pushgateway:
        push(rows, a.pushgateway)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
