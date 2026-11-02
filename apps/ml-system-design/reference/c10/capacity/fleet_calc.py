"""Flota y costo del caso c10: tráfico → réplicas → GPUs → nodos → US$/mes, contra la factura del vendor.

La cuenta del caso, a mano (todas son estimaciones del caso; cámbialas por las tuyas):

  interactivo  1.5 M requests/día ÷ 86,400 s ≈ 17.4 rps promedio; pico ≈ 3× ≈ 52 rps → se diseña para 60
  capacidad    ≈ 6 rps de ESTA mezcla por réplica dentro de los SLOs (medido con `vllm bench serve`:
               bench/pick_concurrency.py) × 70 % planeado = 4.2 rps
  réplicas     60 ÷ 4.2 = 14.3 → 15 necesarias × 2 GPUs = 30 GPUs → 4 nodos p5.48xlarge (8 H100 cada uno)
               → con 4 nodos caben 16 réplicas: se despliegan 16 (las GPUs ya están pagas)
  costo        4 nodos × US$55/h × 730 h ≈ US$160.6k/mes on-demand, prendidos todo el mes
  vendor       90 B × US$2.5/M + 11.25 B × US$10/M + 50 % × (48 B × 2.5 + 9 B × 10) ≈ US$442.5k/mes
               (precios ILUSTRATIVOS de un modelo propietario de gama media; el batch API cuesta −50 %)
  →            ≈ 2.8× más barato en GPU pura. No es "órdenes de magnitud": a ≈ 1/5 del volumen ya no conviene.

Por qué se redondea a nodos y no a GPUs: AWS vende la H100 de a 8 (p5.48xlarge). Pagar 4 nodos y usar 30 de
32 GPUs sería tirar 2: se despliegan 16 réplicas y la sobra es margen.

Por qué hay un mínimo de nodos (min_nodes=2): con un solo nodo, una falla de hardware es una caída total del
servicio. A volumen chico el piso de 2 nodos (US$80.3k/mes) domina el costo; por eso el break-even existe.

Lo que esta cuenta NO incluye y el caso sí menciona: el equipo que opera la flota (2–4 personas con on-call),
CPU del gateway, almacenamiento y observabilidad. Entran como `fixed_monthly` y `team_monthly`, en cero por
defecto para que el número de GPU no se mezcle con supuestos de sueldos. break_even_scale muestra cuánto
mueven el punto de equilibrio. Con los supuestos del caso (≈ US$10k de infra y ≈ US$60k de 3 personas, ambos
ilustrativos): piso propio = 2 nodos (US$80.3k) + 70k ≈ US$150k/mes → equilibrio en ≈ 34 % del volumen de hoy
(150.3 ÷ 442.5); solo con GPUs, en ≈ 18 %. Por debajo, gana el vendor.

Solo biblioteca estándar. Montos en US$; tokens en unidades (no millones) salvo donde el nombre lo dice.
"""

from __future__ import annotations  # anotaciones como texto

import math  # ceil: media réplica o medio nodo no existen
from dataclasses import dataclass  # parámetros explícitos e inmutables

DAYS_PER_MONTH = 30  # la factura de tokens del caso usa 30 días
HOURS_PER_MONTH = 730  # horas facturables de una instancia prendida todo el mes (convención de AWS)


@dataclass(frozen=True)
class Workload:
    """Un tipo de tráfico: cuántos requests por día y cuántos tokens cada uno."""

    name: str
    requests_per_day: float
    prompt_tokens: float  # promedio de tokens de entrada (system prompt + historia + contexto)
    output_tokens: float  # promedio de tokens generados
    batch: bool = False  # True = puede ir por el batch API del vendor (−50 %) o a la noche en la flota propia

    def avg_rps(self) -> float:
        """Requests por segundo en promedio del día."""
        return self.requests_per_day / 86_400

    def monthly_input_tokens(self) -> float:
        return self.requests_per_day * self.prompt_tokens * DAYS_PER_MONTH

    def monthly_output_tokens(self) -> float:
        return self.requests_per_day * self.output_tokens * DAYS_PER_MONTH


@dataclass(frozen=True)
class VendorPrices:
    """Precios de lista por MILLÓN de tokens (ilustrativos: verifica los vigentes de tu proveedor)."""

    input_per_m: float = 2.50
    output_per_m: float = 10.00
    batch_discount: float = 0.50  # OpenAI Batch API y Anthropic Message Batches: −50 % (verifica)
    cached_input_per_m: float | None = None  # prompt caching del vendor: precio del input leído de caché
    cached_input_fraction: float = 0.0  # fracción del input que el vendor cobra como caché (0 en el caso)


@dataclass(frozen=True)
class ReplicaPlan:
    """Lo que rinde una réplica, MEDIDO con la mezcla real (no la hoja de datos)."""

    measured_rps: float  # máximo de requests/s de la mezcla dentro de los SLOs (pick_concurrency.py)
    planned_utilization: float = 0.70  # margen para picos, réplicas caídas y deploys
    gpus_per_replica: int = 2  # TP=2 en el caso


@dataclass(frozen=True)
class NodeType:
    name: str = "p5.48xlarge"
    gpus: int = 8  # 8 × H100 por nodo
    price_per_hour: float = 55.0  # on-demand us-east-1, ≈ US$6.88 por H100-hora (ref-numeros; verifica)


P5 = NodeType()  # el nodo del caso (default de las funciones de abajo)


@dataclass(frozen=True)
class Fleet:
    replicas_needed: int  # las que pide la cuenta de capacidad
    nodes: int  # nodos que hay que pagar
    gpus: int  # GPUs pagas (nodes × 8)
    replicas_deployed: int  # las que caben en esos nodos (≥ replicas_needed)


def vendor_monthly_cost(workloads: list[Workload], p: VendorPrices) -> float:
    """Factura mensual del vendor: input y output por millón; los batch, con descuento."""
    total = 0.0
    for w in workloads:
        cached = w.monthly_input_tokens() * p.cached_input_fraction if p.cached_input_per_m is not None else 0.0
        fresh = w.monthly_input_tokens() - cached  # input que se cobra a precio completo
        cost = (
            fresh / 1e6 * p.input_per_m
            + cached / 1e6 * (p.cached_input_per_m or 0.0)
            + w.monthly_output_tokens() / 1e6 * p.output_per_m
        )
        total += cost * (1 - p.batch_discount) if w.batch else cost  # el batch API cuesta la mitad
    return total


def replicas_needed(design_rps: float, plan: ReplicaPlan) -> int:
    """ceil(rps de diseño ÷ (capacidad medida × utilización planeada))."""
    if plan.measured_rps <= 0 or not 0 < plan.planned_utilization <= 1:
        raise ValueError("measured_rps > 0 y planned_utilization en (0, 1]")
    usable = plan.measured_rps * plan.planned_utilization  # 6 × 0.7 = 4.2 rps por réplica
    return max(1, math.ceil(design_rps / usable - 1e-9))  # −1e-9: 60 ÷ 4.0 = 15 exacto no se vuelve 16


def fleet_for(design_rps: float, plan: ReplicaPlan, node: NodeType = P5, min_nodes: int = 1) -> Fleet:
    """Réplicas → nodos enteros (las GPUs se compran de a 8) → réplicas que caben en esos nodos."""
    if node.gpus % plan.gpus_per_replica != 0:
        raise ValueError("una réplica no puede partirse entre dos nodos en este plan")  # TP dentro del nodo (NVLink)
    need = replicas_needed(design_rps, plan)
    nodes = max(min_nodes, math.ceil(need * plan.gpus_per_replica / node.gpus))
    return Fleet(need, nodes, nodes * node.gpus, nodes * node.gpus // plan.gpus_per_replica)


def gpu_monthly_cost(nodes: int, node: NodeType = P5, hours: float = HOURS_PER_MONTH) -> float:
    """Nodos prendidos todo el mes, on-demand. Se paga la hora encendida, no la hora ocupada."""
    return nodes * node.price_per_hour * hours


def request_seconds(ttft_s: float, output_tokens: float, tpot_s: float) -> float:
    """Duración de un request de streaming ≈ TTFT + tokens de salida × TPOT."""
    return ttft_s + output_tokens * tpot_s


def littles_law_concurrency(rps: float, seconds_per_request: float) -> float:
    """L = λ × W (#m03.little): secuencias vivas a la vez = llegadas por segundo × segundos que dura cada una."""
    return rps * seconds_per_request


def batch_window_load(w: Workload, window_hours: float, replicas: int) -> dict[str, float]:
    """Qué le pide el batch nocturno a cada réplica si se reparte parejo en la ventana."""
    items_per_s = w.requests_per_day / (window_hours * 3600) / replicas
    return {
        "items_per_s_per_replica": items_per_s,
        "prefill_tokens_per_s_per_replica": items_per_s * w.prompt_tokens,
        "output_tokens_per_s_per_replica": items_per_s * w.output_tokens,
    }


def self_hosted_monthly_cost(
    scale: float,
    base_design_rps: float,
    plan: ReplicaPlan,
    node: NodeType = P5,
    min_nodes: int = 2,
    fixed_monthly: float = 0.0,
    team_monthly: float = 0.0,
) -> float:
    """Costo propio si el volumen fuera `scale` × el de hoy (el pico escala igual que el promedio)."""
    f = fleet_for(base_design_rps * scale, plan, node, min_nodes)
    return gpu_monthly_cost(f.nodes, node) + fixed_monthly + team_monthly


def break_even_scale(
    workloads: list[Workload],
    prices: VendorPrices,
    base_design_rps: float,
    plan: ReplicaPlan,
    node: NodeType = P5,
    min_nodes: int = 2,
    fixed_monthly: float = 0.0,
    team_monthly: float = 0.0,
    step: float = 0.001,
    max_scale: float = 5.0,
) -> float | None:
    """Menor fracción del volumen de hoy en la que self-hosting cuesta ≤ que el vendor.

    El vendor escala lineal con los tokens; la flota propia, a saltos de un nodo y con un piso (min_nodes).
    Por eso se barre la escala en lugar de despejar una ecuación. None si no hay cruce hasta max_scale.
    """
    vendor_today = vendor_monthly_cost(workloads, prices)
    s = step
    while s <= max_scale + 1e-12:
        own = self_hosted_monthly_cost(s, base_design_rps, plan, node, min_nodes, fixed_monthly, team_monthly)
        if own <= vendor_today * s:  # la factura del vendor es proporcional al volumen
            return round(s, 6)
        s += step
    return None


# ---------------------------------------------------------------- los números del caso
CASE_WORKLOADS = [
    Workload("interactivo (soporte + vendedores)", 1_500_000, 2_000, 250),
    Workload("catálogo nocturno (batch)", 2_000_000, 800, 150, batch=True),
]
CASE_DESIGN_RPS = 60.0  # pico ≈ 52 rps con margen de spikes
CASE_PLAN = ReplicaPlan(measured_rps=6.0, planned_utilization=0.70, gpus_per_replica=2)


if __name__ == "__main__":
    inter, batch = CASE_WORKLOADS
    print(f"interactivo: {inter.avg_rps():.1f} rps promedio, pico ×3 = {inter.avg_rps() * 3:.1f}, diseño {CASE_DESIGN_RPS:.0f}")
    fl = fleet_for(CASE_DESIGN_RPS, CASE_PLAN)
    print(f"flota: {fl.replicas_needed} réplicas necesarias → {fl.nodes} nodos = {fl.gpus} GPUs → {fl.replicas_deployed} réplicas")
    own = gpu_monthly_cost(fl.nodes)
    vendor = vendor_monthly_cost(CASE_WORKLOADS, VendorPrices())
    print(f"GPU propia US${own:,.0f}/mes contra vendor US${vendor:,.0f}/mes → {vendor / own:.2f}×")
    secs = request_seconds(0.5, inter.output_tokens, 0.040)
    conc = littles_law_concurrency(CASE_DESIGN_RPS, secs)
    print(f"Little: {CASE_DESIGN_RPS:.0f} rps × {secs:.1f} s = {conc:.0f} secuencias vivas ≈ {conc / fl.replicas_deployed:.1f} por réplica")
    print("batch en 8 h:", {k: round(v, 1) for k, v in batch_window_load(batch, 8, fl.replicas_deployed).items()})
    for fixed, team in ((0.0, 0.0), (10_000.0, 60_000.0)):
        be = break_even_scale(CASE_WORKLOADS, VendorPrices(), CASE_DESIGN_RPS, CASE_PLAN,
                              fixed_monthly=fixed, team_monthly=team)
        print(f"break-even (infra US${fixed:,.0f} + equipo US${team:,.0f}/mes): {be:.3f} del volumen de hoy")
