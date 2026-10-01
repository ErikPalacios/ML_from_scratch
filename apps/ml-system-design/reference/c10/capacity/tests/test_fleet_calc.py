"""Tests de fleet_calc con los números del caso c10 (SPEC §8k), calculados a mano en cada comentario."""

import pytest  # runner y aproximaciones

from fleet_calc import (
    CASE_DESIGN_RPS,
    CASE_PLAN,
    CASE_WORKLOADS,
    NodeType,
    ReplicaPlan,
    VendorPrices,
    Workload,
    batch_window_load,
    break_even_scale,
    fleet_for,
    gpu_monthly_cost,
    littles_law_concurrency,
    replicas_needed,
    request_seconds,
    self_hosted_monthly_cost,
    vendor_monthly_cost,
)

INTER, BATCH = CASE_WORKLOADS


def test_traffic_and_monthly_tokens():
    assert INTER.avg_rps() == pytest.approx(17.36, abs=0.01)  # 1.5 M ÷ 86,400
    assert INTER.avg_rps() * 3 == pytest.approx(52.08, abs=0.01)  # pico ≈ 3× → se diseña para 60
    assert INTER.monthly_input_tokens() == 90e9  # 1.5 M × 2,000 × 30
    assert INTER.monthly_output_tokens() == 11.25e9  # 1.5 M × 250 × 30
    assert BATCH.monthly_input_tokens() == 48e9  # 2 M × 800 × 30
    assert BATCH.monthly_output_tokens() == 9e9  # 2 M × 150 × 30


def test_vendor_bill_is_442k():
    # 90 B × 2.5 + 11.25 B × 10 = 225k + 112.5k; batch: 0.5 × (120k + 90k) = 105k → 442.5k
    assert vendor_monthly_cost(CASE_WORKLOADS, VendorPrices()) == pytest.approx(442_500)


def test_vendor_prompt_caching_lowers_the_bill():
    # Si el vendor cobrara la mitad del input como caché a US$0.25/M (ilustrativo), baja el input
    p = VendorPrices(cached_input_per_m=0.25, cached_input_fraction=0.5)
    only_inter = vendor_monthly_cost([INTER], p)
    assert only_inter == pytest.approx(45e9 / 1e6 * 2.5 + 45e9 / 1e6 * 0.25 + 112_500)  # 112.5k + 11.25k + 112.5k


def test_replicas_nodes_and_the_16_replicas():
    assert replicas_needed(CASE_DESIGN_RPS, CASE_PLAN) == 15  # 60 ÷ 4.2 = 14.3 → 15
    fl = fleet_for(CASE_DESIGN_RPS, CASE_PLAN)
    assert (fl.nodes, fl.gpus, fl.replicas_deployed) == (4, 32, 16)  # 30 GPUs → 4 nodos → 16 réplicas


def test_exact_division_does_not_round_up():
    assert replicas_needed(60, ReplicaPlan(measured_rps=5.0, planned_utilization=0.8)) == 15  # 60 ÷ 4.0


def test_monthly_gpu_cost_and_ratio():
    own = gpu_monthly_cost(4)
    assert own == pytest.approx(160_600)  # 4 × 55 × 730
    assert NodeType().price_per_hour / NodeType().gpus == pytest.approx(6.875)  # ≈ US$6.88 por H100-hora
    assert vendor_monthly_cost(CASE_WORKLOADS, VendorPrices()) / own == pytest.approx(2.755, abs=0.001)


def test_littles_law_630_sequences():
    secs = request_seconds(ttft_s=0.5, output_tokens=250, tpot_s=0.040)
    assert secs == pytest.approx(10.5)
    assert littles_law_concurrency(60, secs) == pytest.approx(630)
    assert 630 / 16 == pytest.approx(39.375)  # ≈ 40 por réplica


def test_batch_fits_in_the_night():
    load = batch_window_load(BATCH, window_hours=8, replicas=16)
    assert load["items_per_s_per_replica"] == pytest.approx(4.34, abs=0.01)  # 2 M ÷ 28,800 s ÷ 16
    assert load["prefill_tokens_per_s_per_replica"] == pytest.approx(3_472, abs=1)  # ≈ 3.5k
    assert load["output_tokens_per_s_per_replica"] == pytest.approx(651, abs=1)  # ≈ 650


def test_min_nodes_dominates_at_small_scale():
    # A 1/5 del volumen: 12 rps → 3 réplicas → 1 nodo, pero el piso de disponibilidad es 2 nodos
    assert fleet_for(12, CASE_PLAN, min_nodes=1).nodes == 1
    assert self_hosted_monthly_cost(0.2, CASE_DESIGN_RPS, CASE_PLAN, min_nodes=2) == pytest.approx(80_300)


def test_break_even_gpu_only_is_about_one_fifth():
    # Solo GPU, piso de 2 nodos: 80.3k ≤ 442.5k × s → s ≥ 0.1815 → primer paso de 0.001 que cruza: 0.182
    be = break_even_scale(CASE_WORKLOADS, VendorPrices(), CASE_DESIGN_RPS, CASE_PLAN, min_nodes=2)
    assert be == pytest.approx(0.182)


def test_break_even_with_team_and_platform_moves_to_a_third():
    # + US$10k de infra + US$60k de 3 personas (ilustrativo): 150.3k ≤ 442.5k × s → s ≥ 0.3397
    be = break_even_scale(CASE_WORKLOADS, VendorPrices(), CASE_DESIGN_RPS, CASE_PLAN, min_nodes=2,
                          fixed_monthly=10_000, team_monthly=60_000)
    assert be == pytest.approx(0.34)
    # Solo con el equipo (sin el resto de la infra): 140.3k → ≈ 0.317
    assert break_even_scale(CASE_WORKLOADS, VendorPrices(), CASE_DESIGN_RPS, CASE_PLAN,
                            team_monthly=60_000) == pytest.approx(0.318)
    # A 1/5 del volumen el vendor gana: 88.5k contra 150.3k
    assert vendor_monthly_cost(CASE_WORKLOADS, VendorPrices()) * 0.2 < self_hosted_monthly_cost(
        0.2, CASE_DESIGN_RPS, CASE_PLAN, fixed_monthly=10_000, team_monthly=60_000)
    # Y a todo el volumen, propio con todo incluido: 160.6k + 70k = 230.6k contra 442.5k (≈ 1.9×)
    full = self_hosted_monthly_cost(1.0, CASE_DESIGN_RPS, CASE_PLAN, fixed_monthly=10_000, team_monthly=60_000)
    assert full == pytest.approx(230_600)


def test_no_break_even_when_vendor_is_cheap():
    cheap = VendorPrices(input_per_m=0.05, output_per_m=0.2)  # un vendor 50× más barato: nunca conviene
    assert break_even_scale(CASE_WORKLOADS, cheap, CASE_DESIGN_RPS, CASE_PLAN, max_scale=2.0) is None


def test_invalid_plan():
    with pytest.raises(ValueError):
        replicas_needed(60, ReplicaPlan(measured_rps=0))
    with pytest.raises(ValueError):
        fleet_for(60, ReplicaPlan(measured_rps=6, gpus_per_replica=3))  # 8 GPUs no se parten en réplicas de 3


def test_workload_dataclass_defaults():
    w = Workload("x", 86_400, 10, 1)
    assert w.avg_rps() == 1.0 and not w.batch
