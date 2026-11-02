"""Tests de quality.py con imágenes sintéticas: un "documento" con texto falso sobre una mesa lisa,
y sus versiones borrosa, con reflejo, de baja resolución y cortada."""

import numpy as np
import pytest

import quality as q

RNG = np.random.default_rng(7)


def fake_document(h=1500, w=2000, doc_box=(0.15, 0.15, 0.85, 0.85), table=90, paper=200) -> np.ndarray:
    """Mesa gris lisa + rectángulo claro (la tarjeta) con "renglones de texto": bloques oscuros
    irregulares que dan bordes nítidos, como las letras."""
    img = np.full((h, w), table, dtype=np.float32)
    y0, x0, y1, x1 = int(doc_box[0] * h), int(doc_box[1] * w), int(doc_box[2] * h), int(doc_box[3] * w)
    img[y0:y1, x0:x1] = paper
    for row in range(y0 + 20, y1 - 30, 40):  # un renglón cada 40 px
        for col in range(x0 + 20, x1 - 30, 24):  # "letras" de 12–18 px
            if RNG.random() < 0.8:
                cw = int(RNG.integers(10, 18))
                img[row:row + 18, col:col + cw] = 30
    img += RNG.normal(0, 2, img.shape)  # ruido de sensor leve
    return np.clip(img, 0, 255).astype(np.uint8)


def box_blur(img: np.ndarray, k: int) -> np.ndarray:
    """Desenfoque de caja k×k con sumas acumuladas (simula una foto movida/desenfocada)."""
    f = img.astype(np.float64)
    pad = k // 2
    p = np.pad(f, pad, mode="edge")
    c = p.cumsum(0).cumsum(1)
    c = np.pad(c, ((1, 0), (1, 0)))
    s = c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]
    return (s / (k * k))[: img.shape[0], : img.shape[1]].astype(np.uint8)


INE = q.PROFILES["ine"]


def test_documento_nitido_completo_pasa():
    r = q.assess(fake_document(), INE)
    assert r.ok, (r.reasons, r.metrics)
    assert r.metrics["laplacian_var"] > INE.min_laplacian_var


def test_borrosa():
    r = q.assess(box_blur(fake_document(), 15), INE)
    assert "borrosa" in r.reasons
    assert r.metrics["laplacian_var"] < q.laplacian_variance(q.downscale(q.to_gray(fake_document())))


def test_reflejo_solo_cuenta_en_la_ine():
    img = fake_document()
    img[500:800, 700:1100] = 255  # mancha saturada: ≈ 4 % de la imagen
    r = q.assess(img, INE)
    assert "reflejo" in r.reasons and r.metrics["glare_frac"] > 0.02
    # En papel (max_glare_frac=None) la misma mancha no se evalúa: el papel blanco también satura.
    assert "reflejo" not in q.assess(img, q.PROFILES["comprobante_domicilio"]).reasons


def test_limitacion_conocida_ine_sobre_fondo_blanco_da_reflejo():
    """Documenta el límite del baseline: el reflejo se mide en TODA la foto. Una INE perfecta sobre una
    hoja blanca (fondo saturado) sale como "reflejo". La versión seria mide dentro del contorno."""
    img = fake_document(table=255)  # la "mesa" es una hoja blanca
    r = q.assess(img, INE)
    assert r.reasons == ["reflejo"] and r.metrics["glare_frac"] > 0.4
    assert q.assess(fake_document(), INE).ok  # la misma credencial sobre una mesa gris pasa


def test_baja_resolucion():
    small = fake_document(h=360, w=480)
    r = q.assess(small, INE)
    assert "baja_resolucion" in r.reasons
    assert r.metrics["dpi"] == pytest.approx(480 / (85.60 / 25.4), rel=1e-3)  # ≈ 142 DPI


def test_dpi_ejemplos_del_docstring():
    assert q.effective_dpi(4000, 3000, q.ID1_CARD_MM) == pytest.approx(1186.9, abs=0.1)
    assert q.effective_dpi(480, 640, q.ID1_CARD_MM) == pytest.approx(189.9, abs=0.1)  # orientación da igual
    assert q.effective_dpi(1275, 1650, q.LETTER_MM) == pytest.approx(150.0, abs=0.1)  # carta a 150 DPI


def test_cortado():
    # La tarjeta se sale por la derecha: el texto llega al borde de la foto.
    r = q.assess(fake_document(doc_box=(0.15, 0.30, 0.85, 1.0)), INE)
    assert "cortado" in r.reasons, r.metrics


def test_varios_motivos_a_la_vez():
    img = box_blur(fake_document(h=360, w=480, doc_box=(0.1, 0.4, 0.9, 1.0)), 9)
    r = q.assess(img, INE)
    assert {"borrosa", "baja_resolucion"} <= set(r.reasons) and not r.ok


def test_rgb_y_gris_dan_lo_mismo():
    g = fake_document()
    rgb = np.stack([g, g, g], axis=-1)
    a, b = q.assess(rgb, INE).metrics, q.assess(g, INE).metrics
    assert a.keys() == b.keys() and all(a[k] == pytest.approx(b[k], rel=1e-4) for k in a)


def test_laplaciano_de_imagen_plana_es_cero():
    assert q.laplacian_variance(np.full((100, 100), 128.0)) == 0.0


def test_downscale_factor_entero_y_promedio():
    img = np.arange(16, dtype=np.float32).reshape(4, 4)
    out = q.downscale(img, long_side=2)
    assert out.shape == (2, 2) and out[0, 0] == pytest.approx((0 + 1 + 4 + 5) / 4)
    same = np.zeros((500, 300), dtype=np.float32)
    assert q.downscale(same) is same  # ya es chica: no se toca


def test_downscale_lado_largo_exacto_con_factor_no_entero():
    # 1500 × 2000 → 768 × 1024 (factor 1.953…): la escala de análisis es la misma para cualquier foto.
    img = RNG.uniform(0, 255, (1500, 2000)).astype(np.float32)
    out = q.downscale(img)
    assert out.shape == (768, 1024)
    assert float(out.mean()) == pytest.approx(float(img.mean()), rel=1e-4)  # el promedio por área conserva la media


def test_la_nitidez_no_depende_de_la_resolucion_de_la_foto():
    # La MISMA escena con el mismo desenfoque óptico, capturada a 3000 px y a 1500 px de ancho. A la
    # resolución nativa, el desenfoque ocupa el doble de pixeles en la foto grande y su varianza del
    # Laplaciano sale ≈ 5× menor: "borrosa" solo por tener más megapixeles. Medida a 1024 px, ≈ igual.
    big = q.to_gray(box_blur(fake_document(h=2250, w=3000), 6))
    small = q.downscale(big, long_side=1500)  # la misma escena con un sensor de la mitad de resolución
    raw_ratio = q.laplacian_variance(small) / q.laplacian_variance(big)
    norm_ratio = q.laplacian_variance(q.downscale(small)) / q.laplacian_variance(q.downscale(big))
    assert raw_ratio > 3
    assert 0.75 < norm_ratio < 1.25


def test_source_size_para_imagenes_decodificadas_reducidas():
    img = fake_document(h=750, w=1000)  # como si el decodificador JPEG la hubiera bajado a 1/4
    r = q.assess(img, INE, source_size=(4000, 3000))
    assert r.metrics["dpi"] == pytest.approx(1186.9, abs=0.1)
