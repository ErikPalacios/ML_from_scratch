"""Tests de tiling.py: la matemática que, si está mal, NO lanza excepción (da un número falso)."""

from __future__ import annotations

import dataclasses

import numpy as np
import pytest

import tiling as T


# ---------------------------------------------------------------------------- nivel de lectura
def test_svs_40x_reads_1024_at_level0_and_halves(cfg):
    # El ejemplo del caso: 0.25 µm/px, pirámide [1, 4, 16] → no hay 20×: 1024 px del nivel 0 → 512
    plan = T.choose_read_plan(0.25, [1, 4, 16], cfg)
    assert (plan.level, plan.level_mpp, plan.read_px, plan.model_to_level0) == (0, 0.25, 1024, 2.0)


def test_pyramid_with_a_20x_level_reads_it_directly(cfg):
    plan = T.choose_read_plan(0.25, [1, 2, 8], cfg)  # nivel 1 = 0.5 µm/px exacto
    assert (plan.level, plan.read_px) == (1, 512)


def test_scan_at_20x_needs_no_resampling(cfg):
    plan = T.choose_read_plan(0.5, [1, 4, 16], cfg)
    assert (plan.level, plan.read_px, plan.model_to_level0) == (0, 512, 1.0)


def test_non_integer_mpp_reads_non_integer_region(cfg):
    # Un escáner de 0.2527 µm/px: 512 × 0.5 / 0.2527 = 1013.06 → 1013 px (factor no entero)
    assert T.choose_read_plan(0.2527, [1, 4, 16], cfg).read_px == 1013


def test_refuses_to_upsample(cfg):
    with pytest.raises(ValueError):
        T.choose_read_plan(1.0, [1, 4], cfg)  # 10×: no hay detalle de 20× que recuperar


def test_mask_level_is_the_coarsest_under_8_um(cfg):
    assert T.choose_mask_level(0.25, [1, 4, 16], cfg) == 2  # 4 µm/px
    assert T.choose_mask_level(0.25, [1, 4, 16, 64], cfg) == 2  # 16 µm/px > 8: no sirve
    assert T.choose_mask_level(0.25, [1, 4], cfg) is None  # el más grueso es 1 µm/px: no cabe en RAM


# ---------------------------------------------------------------------------- mpp
@pytest.mark.parametrize("mx,my,nominal,flags", [
    (0.25, 0.25, 0.25, []),
    (0.2527, 0.2527, 0.25, []),  # dentro de ±10 % del mpp registrado
    (None, 0.25, 0.25, ["missing_mpp"]),
    (0.0, 0.0, 0.25, ["odd_mpp"]),
    (25.0, 25.0, 0.25, ["odd_mpp"]),  # 25: unidades mal convertidas
    (1.0, 1.0, None, ["odd_mpp"]),  # 10×: más grueso que el modelo
    (0.25, 0.30, 0.25, ["anisotropic_mpp"]),
    (0.5, 0.5, 0.25, ["mpp_mismatch"]),  # el archivo dice 20×, el escáner es 40×
])
def test_check_mpp(cfg, mx, my, nominal, flags):
    assert T.check_mpp(mx, my, nominal, cfg) == flags


# ---------------------------------------------------------------------------- grilla
def test_expected_tiles_matches_case_estimate(cfg):
    assert cfg.stride_px == 448
    assert T.expected_tiles(150.0, cfg) == pytest.approx(2989.5, abs=0.1)  # 1.5 cm² → ≈ 2,990


def test_grid_starts_cover_the_axis(cfg):
    assert T.grid_starts(1000, cfg) == [0, 448, 896]
    assert T.grid_starts(512, cfg) == [0]
    assert T.grid_starts(40, cfg) == [0]
    for length in range(1, 5000, 37):  # cada pixel del eje queda dentro de al menos un tile
        starts = T.grid_starts(length, cfg)
        covered = np.zeros(length, bool)
        for s in starts:
            covered[s:s + cfg.tile_px] = True
        assert covered.all()


def _thumb(h=400, w=600, tissue=(100, 100, 300, 400), color=(220, 150, 190)):
    img = np.full((h, w, 3), 240, np.uint8)
    y0, x0, y1, x1 = tissue
    img[y0:y1, x0:x1] = color
    return img


def test_tissue_mask_otsu_on_saturation(cfg):
    img = _thumb()
    img[0:20, :] = 5  # borde negro del escáner: no es tejido
    m = T.tissue_mask(img, cfg)
    assert m[100:300, 100:400].all()
    assert m.sum() == 200 * 300


def test_blank_slide_has_no_tissue(cfg):
    rng = np.random.default_rng(0)
    img = np.clip(240 + rng.normal(0, 2, (300, 300, 3)), 0, 255).astype(np.uint8)  # ruido del vidrio
    assert T.tissue_mask(img, cfg).sum() == 0  # sat_floor evita que Otsu corte en el ruido


def test_plan_tiles_keeps_only_tissue(cfg):
    # Máscara a 4 µm/px: 1 mask px = 8 model px. Tejido en mask px [100:300, 100:400)
    mask = np.zeros((500, 800), bool)
    mask[100:300, 100:400] = True
    tiles = T.plan_tiles(800 * 8, 500 * 8, mask, 4.0, cfg)
    assert tiles and all(t.tissue_frac >= cfg.min_tissue_frac for t in tiles)
    # Casi todo el tejido queda cubierto, pero NO todo: el tile de la esquina (448, 448) solo tiene
    # (160/512)² ≈ 9.8 % de tejido y se descarta. Por eso summary.json reporta tissue_covered_frac.
    cov = np.zeros_like(mask)
    for t in tiles:
        cov[t.y // 8:(t.y + 512) // 8, t.x // 8:(t.x + 512) // 8] = True
    assert 0.99 < cov[mask].mean() < 1.0
    assert not cov[100:120, 100:120].all()  # la esquina superior izquierda del tejido quedó fuera
    # Y ningún tile cae lejos del tejido
    assert all(t.x // 8 < 400 and t.y // 8 < 300 and (t.x + 512) // 8 > 100 for t in tiles)


def test_tile_fraction_counts_outside_slide_as_background(cfg):
    # 70 mask px = 560 model px de lado → tiles en 0 y 448. El de 448 solo tiene 14 de sus 64
    # mask px dentro del slide: 14 × 64 / 64² = 0.219 (se queda); la esquina, 14² / 64² = 0.048 (no)
    mask = np.ones((70, 70), bool)
    tiles = T.plan_tiles(560, 560, mask, 4.0, cfg)
    assert sorted((t.x, t.y, round(t.tissue_frac, 5)) for t in tiles) == [
        (0, 0, 1.0), (0, 448, 0.21875), (448, 0, 0.21875)]


# ---------------------------------------------------------------------------- reescalado y blur
def test_resize_integer_factor_is_exact_block_mean():
    region = np.arange(16, dtype=np.uint8).reshape(4, 4)[..., None].repeat(3, axis=2)
    out = T.resize_to(region, 2)
    assert out[..., 0].tolist() == [[2, 4], [10, 12]]  # promedios 2×2 redondeados (2.5 → 2, banker's)


def test_resize_non_integer_keeps_mean_and_constants():
    rng = np.random.default_rng(1)
    region = rng.integers(0, 256, (1013, 1013, 3)).astype(np.uint8)
    out = T.resize_to(region, 512)
    assert out.shape == (512, 512, 3)
    assert abs(out.astype(float).mean() - region.astype(float).mean()) < 0.5
    const = np.full((1013, 1013, 3), 77, np.uint8)
    assert (T.resize_to(const, 512) == 77).all()


def test_laplacian_variance_detects_blur():
    rng = np.random.default_rng(2)
    sharp = rng.integers(100, 200, (256, 256, 3)).astype(np.uint8)
    k = 9  # box blur 9×9 (una lente fuera de foco, a grandes rasgos)
    pad = np.pad(sharp.astype(float), ((k // 2,) * 2, (k // 2,) * 2, (0, 0)), mode="edge")
    csum = pad.cumsum(0).cumsum(1)
    csum = np.pad(csum, ((1, 0), (1, 0), (0, 0)))
    blurred = (csum[k:, k:] - csum[:-k, k:] - csum[k:, :-k] + csum[:-k, :-k]) / k**2
    assert T.laplacian_variance(sharp) > 50 * T.laplacian_variance(blurred.astype(np.uint8))


# ---------------------------------------------------------------------------- stitching
def test_blend_window_is_a_partition_of_unity(cfg):
    n, ramp = cfg.tile_px // cfg.out_downsample, cfg.overlap_px // cfg.out_downsample  # 64, 8
    stride = n - ramp  # 56
    w = T.blend_window(n, ramp)
    total = np.zeros((3 * stride + ramp, 3 * stride + ramp))
    for i in range(3):
        for j in range(3):
            total[i * stride:i * stride + n, j * stride:j * stride + n] += w
    inner = total[ramp:-ramp, ramp:-ramp]  # donde siempre hay vecinos a ambos lados
    assert np.allclose(inner, 1.0)


def _stitch(cfg, width, height, tile_fn):
    st = T.Stitcher(width, height, cfg)
    for y in T.grid_starts(height, cfg):
        for x in T.grid_starts(width, cfg):
            st.add(x, y, tile_fn(x, y))
    return st.result()


def test_stitch_reproduces_a_smooth_field(cfg):
    H = W = 2000
    yy, xx = np.mgrid[0:H + 512, 0:W + 512].astype(np.float32)
    field = 0.5 + 0.4 * np.sin(xx / 300) * np.cos(yy / 200)
    prob, covered = _stitch(cfg, W, H, lambda x, y: field[y:y + 512, x:x + 512])
    ref = T.block_mean(field[:prob.shape[0] * 8, :prob.shape[1] * 8], 8)
    assert covered.all()
    assert np.abs(prob - ref).max() < 1e-5  # la normalización por Σ pesos no introduce sesgo


def _max_step(prob):
    return max(np.abs(np.diff(prob, axis=0)).max(), np.abs(np.diff(prob, axis=1)).max())


def test_no_seams_with_blending(cfg):
    # Cada tile predice una constante que alterna 0.4 / 0.6 (como un modelo que "sube" en un tile y
    # "baja" en el vecino por efecto de borde). La pregunta: ¿cuánto salta el mapa entre pixeles?
    def tile(x, y):
        v = 0.4 if ((x // cfg.stride_px) + (y // cfg.stride_px)) % 2 == 0 else 0.6
        return np.full((512, 512), v, np.float32)

    blended, _ = _stitch(cfg, 2000, 2000, tile)
    no_overlap_cfg = dataclasses.replace(cfg, overlap_px=0)

    def tile_no_overlap(x, y):
        v = 0.4 if ((x // 512) + (y // 512)) % 2 == 0 else 0.6
        return np.full((512, 512), v, np.float32)

    hard, _ = _stitch(no_overlap_cfg, 2000, 2000, tile_no_overlap)
    # Sin overlap: escalón de 0.2 en cada borde de tile (la costura que ve el patólogo)
    assert _max_step(hard) == pytest.approx(0.2, abs=1e-6)
    # Con rampas de 8 map px: la diferencia de 0.2 se reparte en 8 pasos de 0.025
    assert _max_step(blended) <= 0.2 / 8 + 1e-6


# ---------------------------------------------------------------------------- números del reporte
def test_summary_mm2_and_percent(cfg):
    # Mapa a 4 µm/px: tejido 750 × 750 px = 3 mm × 3 mm = 9 mm²; tumor 250 × 250 px = 1 mm²
    prob = np.zeros((800, 800), np.float32)
    tissue = np.zeros((800, 800), bool)
    tissue[25:775, 25:775] = True
    prob[100:350, 100:350] = 0.9
    covered = np.ones_like(tissue)
    numbers, tumor = T.summarize(prob, covered, tissue, cfg.out_mpp, cfg.tumor_threshold)
    assert numbers["tissue_mm2"] == pytest.approx(9.0)
    assert numbers["tumor_mm2"] == pytest.approx(1.0)
    assert numbers["tumor_pct_of_tissue"] == pytest.approx(11.11, abs=0.01)
    assert tumor.sum() == 62_500


def test_tumor_outside_tissue_does_not_count(cfg):
    prob = np.ones((100, 100), np.float32)  # el modelo "ve tumor" también en el vidrio
    tissue = np.zeros((100, 100), bool)
    tissue[:50] = True
    numbers, _ = T.summarize(prob, np.ones_like(tissue), tissue, cfg.out_mpp, 0.5)
    assert numbers["tumor_pct_of_tissue"] == 100.0
    assert numbers["tumor_mm2"] == pytest.approx(5000 * 16e-6)


def test_no_tissue_gives_none_not_zero_division(cfg):
    numbers, _ = T.summarize(np.zeros((10, 10)), np.ones((10, 10), bool), np.zeros((10, 10), bool),
                             cfg.out_mpp, 0.5)
    assert numbers["tumor_pct_of_tissue"] is None


def test_resample_mask_same_resolution_is_identity():
    m = np.random.default_rng(3).random((50, 70)) > 0.5
    assert (T.resample_mask(m, 4.0, 4.0, (50, 70)) == m).all()
    big = T.resample_mask(m, 4.0, 4.0, (55, 75))  # el mapa puede ser un poco más grande (último tile)
    assert not big[50:].any() and not big[:, 70:].any()


def test_color_histograms_count_only_tissue(cfg):
    img = _thumb()
    m = T.tissue_mask(img, cfg)
    h = T.color_histograms(img, m, cfg.color_bins)
    assert sum(h["r"]) == m.sum() and len(h["g"]) == 16
    assert h["r"][220 // 16] == m.sum()  # todo el tejido tiene R = 220


# ---------------------------------------------------------------------------- config
def test_config_hash_is_stable_and_sensitive(cfg):
    assert cfg.hash() == T.PreprocConfig().hash()
    assert cfg.hash() != dataclasses.replace(cfg, tumor_threshold=0.45).hash()
    assert len(cfg.hash()) == 64


@pytest.mark.parametrize("bad", [dict(overlap_px=512), dict(out_downsample=7), dict(tumor_threshold=1.0)])
def test_invalid_config_fails_fast(bad):
    with pytest.raises(ValueError):
        dataclasses.replace(T.PreprocConfig(), **bad).validate()
