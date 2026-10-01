"""Lee un barrido de `vllm bench serve` (un JSON por punto) y elige la concurrencia máxima que cumple los SLOs.

Para qué: el "≈ 6 rps por réplica" del caso no sale de una hoja de datos. Sale de esto: se corre el benchmark
contra UNA réplica con la mezcla real (≈ 2,000 tokens de prompt con ≈ 1,000 compartidos, ≈ 250 de salida),
subiendo la concurrencia, y se toma el último punto donde el p95 de TTFT y de TPOT siguen dentro del SLO
(TTFT p95 ≤ 1,000 ms, TPOT p95 ≤ 50 ms). El throughput de ESE punto es la capacidad; se planea al 70 %.

Ejemplo con los fixtures sintéticos de tests/fixtures (NO son mediciones: tienen la forma de las de verdad):

  concurrencia   rps    TTFT p95   TPOT p95   veredicto
       64       5.72    860 ms     47.0 ms    ok
       72       6.06    970 ms     49.6 ms    ok   ← la elegida: capacidad ≈ 6.1 rps, planeada ≈ 4.2
       80       6.19   1340 ms     53.8 ms    TTFT y TPOT fuera
       96       6.38   2400 ms     64.0 ms    fuera: +5 % de throughput a cambio de 2.5× de TTFT

Pasado el codo, más concurrencia casi no da throughput y sí da cola: es la rodilla de la curva (#m03).

Formato que lee (verificado contra el código de vLLM v0.30.0, vllm/benchmarks/serve.py): el archivo de
`--save-result` es un JSON plano con, entre otros, "max_concurrency", "request_rate" ("inf" si no se fijó),
"completed", "failed", "request_throughput" (req/s), "output_throughput" (tokens/s), "request_goodput"
(solo con --goodput) y, por cada métrica de --percentile-metrics, "mean_<m>_ms", "median_<m>_ms",
"std_<m>_ms" y "p<P>_<m>_ms" por cada P de --metric-percentiles.
TRAMPA: el default de --metric-percentiles es "99". Sin `--metric-percentiles 50,95,99` no existe
"p95_ttft_ms" y este script se niega a adivinar (no reemplaza p95 por p99 en silencio).

TPOT de vLLM = (latencia − TTFT) ÷ (tokens de salida − 1) por request; los requests de 1 token no entran.

Solo biblioteca estándar. Uso:
  python pick_concurrency.py results/*.json --ttft-ms 1000 --tpot-ms 50 --percentile 95
"""

from __future__ import annotations  # anotaciones como texto

import argparse  # CLI
import json  # los resultados de vllm bench serve
import math  # isfinite para request_rate
import sys  # códigos de salida
from dataclasses import dataclass, field  # filas y resultado
from pathlib import Path  # rutas de los JSON


@dataclass(frozen=True)
class SLO:
    """Los SLOs del caso (interactivo, streaming) y las reglas para confiar en un punto del barrido."""

    ttft_ms: float = 1_000.0  # TTFT p95 ≤ 1.0 s
    tpot_ms: float = 50.0  # TPOT p95 ≤ 50 ms (≈ 20 tokens/s por usuario)
    percentile: int = 95  # qué percentil se compara contra el SLO
    max_failed_fraction: float = 0.0  # un punto con errores no "cumple", aunque sus percentiles se vean bien
    min_completed: int = 500  # con menos requests, el p95 es ruido (25 requests en la cola de 500)


@dataclass(frozen=True)
class Run:
    """Un punto del barrido: un archivo de --save-result."""

    path: str
    x: float  # max_concurrency (barrido cerrado) o request_rate (barrido abierto)
    completed: int
    failed: int
    request_throughput: float  # req/s completados
    output_throughput: float  # tokens de salida/s
    ttft_ms: float  # percentil pedido de TTFT
    tpot_ms: float  # percentil pedido de TPOT
    goodput: float | None  # req/s que cumplen el SLO por request (solo si se corrió con --goodput)


@dataclass
class Choice:
    chosen: Run | None  # el último punto bueno antes del primer punto malo
    verdicts: list[tuple[Run, list[str]]]  # cada punto con sus razones de falla (vacía = cumple)
    warnings: list[str] = field(default_factory=list)


def _x_of(data: dict, path: str) -> tuple[str, float]:
    """Eje del barrido: concurrencia si se fijó; si no, request rate. Mezclar los dos no tiene sentido."""
    if data.get("max_concurrency") is not None:
        return "max_concurrency", float(data["max_concurrency"])
    rate = data.get("request_rate")
    if rate in (None, "inf") or not math.isfinite(float(rate)):
        raise ValueError(f"{path}: sin max_concurrency ni request_rate finito: no es un punto de un barrido")
    return "request_rate", float(rate)


def load_run(path: str | Path, slo: SLO) -> tuple[str, Run]:
    """Lee un JSON y extrae lo que importa. Falla con un mensaje claro si falta un percentil."""
    data = json.loads(Path(path).read_text())
    axis, x = _x_of(data, str(path))
    p = slo.percentile
    keys = (f"p{p}_ttft_ms", f"p{p}_tpot_ms")
    missing = [k for k in keys if k not in data]
    if missing:
        have = sorted(k for k in data if k.endswith("_ttft_ms") and k.startswith("p"))
        raise ValueError(
            f"{path}: faltan {missing} (hay {have}). Corre vllm bench serve con "
            f"--percentile-metrics ttft,tpot,itl,e2el --metric-percentiles 50,{p},99"
        )
    return axis, Run(
        path=str(path),
        x=x,
        completed=int(data["completed"]),
        failed=int(data.get("failed", 0)),
        request_throughput=float(data["request_throughput"]),
        output_throughput=float(data["output_throughput"]),
        ttft_ms=float(data[keys[0]]),
        tpot_ms=float(data[keys[1]]),
        goodput=None if data.get("request_goodput") is None else float(data["request_goodput"]),
    )


def failures(run: Run, slo: SLO) -> list[str]:
    """Por qué un punto NO cumple (lista vacía = cumple)."""
    why = []
    if run.ttft_ms > slo.ttft_ms:
        why.append(f"TTFT p{slo.percentile} {run.ttft_ms:.0f} ms > {slo.ttft_ms:.0f}")
    if run.tpot_ms > slo.tpot_ms:
        why.append(f"TPOT p{slo.percentile} {run.tpot_ms:.1f} ms > {slo.tpot_ms:.0f}")
    total = run.completed + run.failed
    if total and run.failed / total > slo.max_failed_fraction:
        why.append(f"{run.failed} de {total} requests fallaron")
    return why


def pick(runs: list[Run], slo: SLO) -> Choice:
    """Recorre de menor a mayor concurrencia y se queda con el último punto bueno ANTES del primero malo.

    Por qué no "el mayor punto que cumple": si 80 falla y 96 "cumple", lo más probable es ruido (pocos
    requests, un warmup, otro proceso en la GPU). Un plan de capacidad se apoya en el codo, no en un outlier.
    """
    ordered = sorted(runs, key=lambda r: r.x)
    verdicts = [(r, failures(r, slo)) for r in ordered]
    warnings = [
        f"{r.path}: solo {r.completed} requests completados (< {slo.min_completed}): el p{slo.percentile} es ruido"
        for r in ordered
        if r.completed < slo.min_completed
    ]
    chosen = None
    for i, (run, why) in enumerate(verdicts):
        if why:
            later_ok = [r.x for r, w in verdicts[i + 1:] if not w]
            if later_ok:
                warnings.append(f"cumplen después del primer punto malo ({run.x:g}): {later_ok}; repite esos puntos")
            break
        chosen = run
    if chosen is not None and chosen is ordered[-1]:
        warnings.append("el punto más alto del barrido todavía cumple: extiende el barrido para encontrar el codo")
    return Choice(chosen, verdicts, warnings)


def load_sweep(paths: list[str], slo: SLO) -> list[Run]:
    """Lee todos los puntos y exige que sean del mismo tipo de barrido."""
    loaded = [load_run(p, slo) for p in paths]
    axes = {a for a, _ in loaded}
    if len(axes) > 1:
        raise ValueError("el barrido mezcla puntos por concurrencia y por request rate: sepáralos")
    return [r for _, r in loaded]


def render(choice: Choice, slo: SLO, planned_utilization: float) -> str:
    """Tabla para la terminal y el resumen con la capacidad planeada."""
    p = slo.percentile
    lines = [f"{'x':>6} {'req/s':>7} {'tok/s':>8} {'TTFT p' + str(p):>10} {'TPOT p' + str(p):>10} {'goodput':>8}  veredicto"]
    for r, why in choice.verdicts:
        good = "—" if r.goodput is None else f"{r.goodput:.2f}"
        mark = "  ← elegida" if r is choice.chosen else ""
        lines.append(
            f"{r.x:>6g} {r.request_throughput:>7.2f} {r.output_throughput:>8.0f} {r.ttft_ms:>8.0f} ms "
            f"{r.tpot_ms:>7.1f} ms {good:>8}  {'; '.join(why) or 'ok'}{mark}"
        )
    if choice.chosen is None:
        lines.append("ningún punto cumple: ni la concurrencia más baja alcanza los SLOs (¿modelo, GPU o mezcla?)")
    else:
        c = choice.chosen
        lines.append(
            f"capacidad: {c.request_throughput:.2f} req/s a x={c.x:g}; planeada al {planned_utilization:.0%}: "
            f"{c.request_throughput * planned_utilization:.2f} req/s por réplica"
        )
        if c.goodput is not None and c.request_throughput > 0:
            lines.append(f"goodput: {c.goodput / c.request_throughput:.0%} de los requests cumplen el SLO uno por uno")
    lines += [f"AVISO: {w}" for w in choice.warnings]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("results", nargs="+", help="JSON de vllm bench serve --save-result (uno por punto)")
    ap.add_argument("--ttft-ms", type=float, default=SLO.ttft_ms)
    ap.add_argument("--tpot-ms", type=float, default=SLO.tpot_ms)
    ap.add_argument("--percentile", type=int, default=SLO.percentile)
    ap.add_argument("--min-completed", type=int, default=SLO.min_completed)
    ap.add_argument("--planned-utilization", type=float, default=0.70)
    args = ap.parse_args(argv)
    slo = SLO(args.ttft_ms, args.tpot_ms, args.percentile, 0.0, args.min_completed)
    try:
        choice = pick(load_sweep(args.results, slo), slo)
    except (ValueError, KeyError, json.JSONDecodeError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2  # entrada inválida: distinto de "ningún punto cumple"
    print(render(choice, slo, args.planned_utilization))
    return 0 if choice.chosen is not None else 1


if __name__ == "__main__":
    sys.exit(main())
