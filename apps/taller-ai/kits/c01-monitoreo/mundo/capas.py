"""Las cinco capas, en vivo (no es parte de lo que escribes): lo que en C01 son los dashboards de Grafana, en una
tabla. Compara los últimos 3 minutos con los últimos 7 días, en Prometheus.

    python mundo/capas.py

- Infraestructura: los pods y Triton que Prometheus puede leer.
- Servicio: la fracción de 5xx y su burn rate; el p99 del gateway.
- Datos: los bytes medios de la foto por source.
- Modelo: la fracción de fotos dudosas (score < 0.3) y el PSI de las categorías que va primero.
- Negocio: la aceptación de ayer, del resumen de tu job diario (llega con un día de retraso).
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import BUCKET, MONITOREO, prom, prom1, s3  # noqa: E402

V = "3m"           # la ventana corta: lo de ahora
R = "7d"           # la referencia


def senales() -> dict:
    """Los números de cada capa (None si Prometheus no tiene el dato)."""
    out = {"arriba": {x["metric"].get("job", "?") + ":" + x["metric"].get("pod", x["metric"].get("instance", "")): int(float(x["value"][1]))
                      for x in prom('up{job=~"gateway|triton"}')}}
    err = prom1(f'(sum(rate(classifier_requests_total{{code=~"5.."}}[{V}])) or vector(0))'
                f' / sum(rate(classifier_requests_total{{code!~"4.."}}[{V}]))')
    out["errores"] = err
    out["burn"] = err / 0.001 if err is not None else None
    out["p99_ms"] = (v * 1000) if (v := prom1(f"histogram_quantile(0.99, sum by (le) (rate(classifier_request_seconds_bucket[{V}])))")) else None
    out["bytes"] = {}
    for f in ("mobile", "web", "internal"):
        q = lambda w: prom1(f'sum(rate(classifier_image_bytes_sum{{source="{f}"}}[{w}])) / sum(rate(classifier_image_bytes_count{{source="{f}"}}[{w}]))')
        out["bytes"][f] = (q(V), q(R))
    baja = lambda w: prom1(f'sum(rate(classifier_top1_score_bucket{{le="0.3"}}[{w}])) / sum(rate(classifier_top1_score_count[{w}]))')
    out["baja"] = (baja(V), baja(R))
    ahora = {x["metric"]["label"]: float(x["value"][1]) for x in prom(f"sum by (label) (increase(classifier_top1_label_total[{V}]))")}
    antes = {x["metric"]["label"]: float(x["value"][1]) for x in prom(f"sum by (label) (increase(classifier_top1_label_total[{R}]))")}
    n, m = sum(ahora.values()), sum(antes.values())
    if n > 0 and m > 0:
        psi = 0.0
        for k in antes:
            p, q = max(ahora.get(k, 0) / n, 1e-4), max(antes[k] / m, 1e-4)
            psi += (p - q) * math.log(p / q)
        out["psi"] = psi
        out["top_ahora"] = max(ahora, key=ahora.get)
    else:
        out["psi"], out["top_ahora"] = None, None
    out["n_ventana"] = n
    try:
        c = s3()
        dias = sorted(o["Key"] for o in c.list_objects_v2(Bucket=BUCKET, Prefix=MONITOREO).get("Contents", []))
        r = json.loads(c.get_object(Bucket=BUCKET, Key=dias[-1])["Body"].read()) if dias else None
    except Exception:  # noqa: BLE001
        r = None
    out["negocio"] = r
    return out


def fmt(x, f="{:.3f}"):
    return "—" if x is None else f.format(x)


def main() -> None:
    s = senales()
    print(f"Infraestructura  {' · '.join(f'{k} {v}' for k, v in sorted(s['arriba'].items()))}")
    print(f"Servicio         5xx {fmt(s['errores'], '{:.3%}')} (burn {fmt(s['burn'], '{:.1f}')}×) · p99 {fmt(s['p99_ms'], '{:.0f}')} ms")
    print("Datos            bytes medios (3 min / 7 días): " + " · ".join(
        f"{f} {fmt(a, '{:.0f}')} / {fmt(b, '{:.0f}')}" for f, (a, b) in s["bytes"].items()))
    a, b = s["baja"]
    print(f"Modelo           baja confianza {fmt(a, '{:.1%}')} / {fmt(b, '{:.1%}')}"
          f" ({fmt(a / b if a is not None and b else None, '{:.2f}')}×) · PSI de categorías 3 min vs 7 días {fmt(s['psi'])}"
          f" (n {s['n_ventana']:.0f}; va primero: {s['top_ahora']})")
    r = s["negocio"]
    if r:
        t = r["aceptacion"].get("total", {"n": 0, "aceptadas": 0})
        print(f"Negocio          {r['dia']}: aceptación {t['aceptadas'] / max(t['n'], 1):.1%} (n {t['n']:,}) · PSI del día {r['psi']}")
    else:
        print("Negocio          — (todavía no hay resúmenes de tu job diario)")


if __name__ == "__main__":
    main()
