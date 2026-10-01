"""Quality gate de imágenes (solo numpy): ¿esta foto se puede leer, o le pedimos otra AHORA?

Por qué existe: ≈ 50 % de las INE y comprobantes de domicilio llegan como fotos de teléfono. Una foto
borrosa, con reflejo o cortada no la arregla ningún modelo: termina en revisión humana (45 s) o en
"vuelve a subirlo" por correo un día después, con el crédito detenido. Decírselo al cliente en ≤ 3 s,
mientras todavía tiene el documento en la mano, es la optimización más barata de todo el pipeline.

Las mismas funciones corren en `docs-api` (síncrono, con el cliente esperando) y en el pipeline (para
PDFs escaneados, cuyas páginas no se rasterizan en el gate). Un solo archivo = una sola definición de
"foto legible": sin skew entre el gate y lo que el pipeline espera.

Medidas (todas baratas, ≈ milisegundos sobre una imagen reducida a 1024 px):
  - Nitidez: varianza del Laplaciano. Un borde nítido produce segundas derivadas grandes; el desenfoque
    las aplana. Se mide SIEMPRE a la misma escala (lado largo 1024 px): la varianza depende de la
    resolución, y comparar una foto de 12 MP con una de 2 MP sin normalizar no significa nada.
  - Reflejo (glare): fracción de pixeles saturados (≥ 250). Solo para la INE: en un papel blanco bien
    expuesto el fondo también está saturado y esta medida no distingue reflejo de papel. Y se mide en
    TODA la foto: en este baseline sin detector de contorno, un fondo blanco alrededor de la INE (una
    hoja, una mesa clara) también cuenta y da falsos rechazos por "reflejo". La versión seria lo mide
    dentro del contorno detectado del documento.
  - Resolución: DPI efectivos = pixeles del lado largo ÷ pulgadas del lado largo del documento. Ancla
    documentada: Textract no detecta texto de menos de 15 px de alto (≈ letra de 8 pt a 150 DPI).
  - Documento cortado: densidad de bordes en la franja exterior de la foto. Si el texto llega al borde
    de la imagen, probablemente una orilla del documento quedó fuera.

Los umbrales de PROFILES son ilustrativos: se calibran con fotos reales que los revisores marcaron
como ilegibles (¿qué valor separa las fotos que el OCR leyó bien de las que no?) y se vigilan con
QualityGateRejectSpike. Un umbral demasiado
estricto rechaza clientes que tenían una foto suficiente; uno demasiado laxo manda basura a revisión.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

# Medidas físicas del documento (lado largo, lado corto) en mm, para estimar DPI.
ID1_CARD_MM = (85.60, 53.98)  # formato ID-1 (ISO/IEC 7810): el de la INE y las tarjetas bancarias
LETTER_MM = (279.4, 215.9)  # carta, el papel habitual de recibos y estados de cuenta en México

ANALYSIS_LONG_SIDE = 1024  # escala fija para la nitidez y los bordes
SATURATED_LEVEL = 250


@dataclass(frozen=True)
class QualityProfile:
    doc_size_mm: tuple[float, float]
    min_laplacian_var: float  # nitidez mínima a 1024 px (ilustrativo: calibrar)
    min_dpi: float  # DPI efectivos mínimos
    max_glare_frac: float | None  # None = no se evalúa (papel blanco)
    check_cropped: bool = True


# Umbrales ILUSTRATIVOS. min_dpi: carta a 150 DPI deja la letra de 8 pt en ≈ 15 px (el mínimo de
# Textract); la INE tiene letra más chica (estimado ≈ 6 pt), así que pedimos ≈ 200.
PROFILES: dict[str, QualityProfile] = {
    "ine": QualityProfile(ID1_CARD_MM, min_laplacian_var=100.0, min_dpi=200.0, max_glare_frac=0.02),
    "comprobante_domicilio": QualityProfile(LETTER_MM, min_laplacian_var=60.0, min_dpi=150.0, max_glare_frac=None),
    "estado_cuenta": QualityProfile(LETTER_MM, min_laplacian_var=60.0, min_dpi=150.0, max_glare_frac=None),
    "solicitud": QualityProfile(LETTER_MM, min_laplacian_var=60.0, min_dpi=150.0, max_glare_frac=None),
    "factura": QualityProfile(LETTER_MM, min_laplacian_var=60.0, min_dpi=150.0, max_glare_frac=None),
}


@dataclass
class QualityReport:
    ok: bool
    reasons: list[str] = field(default_factory=list)  # códigos estables: borrosa, reflejo, baja_resolucion, cortado
    metrics: dict[str, float] = field(default_factory=dict)


def to_gray(img: np.ndarray) -> np.ndarray:
    """RGB uint8 → luminancia float32 (pesos BT.601). Si ya es 2D, solo cambia el tipo."""
    if img.ndim == 2:
        return img.astype(np.float32)
    if img.ndim == 3 and img.shape[2] >= 3:
        rgb = img[..., :3].astype(np.float32)
        return rgb @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    raise ValueError(f"forma de imagen no soportada: {img.shape}")


def _area_resize_axis(a: np.ndarray, n_out: int, axis: int) -> np.ndarray:
    """Promedio por área a lo largo de un eje, con bordes fraccionarios (la idea de INTER_AREA de OpenCV al
    reducciones): cada pixel de salida promedia exactamente su tramo de entrada. Sumas acumuladas →
    O(n), sin bucles en Python.

    float32 y no float64: con una foto grande, el float64 duplica la memoria de cada copia, y en
    docs-api eso es lo que tumba un pod (el llamador además ya redujo en Pillow, en uint8, a ≤ 2× el
    tamaño de análisis). La suma acumulada en float32 pierde algo de precisión: medido con una imagen
    al azar de 6,000 × 10,000 (sin reducir antes), la diferencia contra float64 es ≤ 0.03 niveles de
    gris y la varianza del Laplaciano cambia en la sexta cifra. Irrelevante para un umbral."""
    a = np.moveaxis(a, axis, 0).astype(np.float32, copy=False)
    n_in = a.shape[0]
    cs = np.concatenate([np.zeros((1,) + a.shape[1:], dtype=np.float32), np.cumsum(a, axis=0, dtype=np.float32)], axis=0)
    edges = np.linspace(0.0, n_in, n_out + 1)
    i = np.floor(edges).astype(int)
    frac = (edges - i).astype(np.float32).reshape(-1, *([1] * (a.ndim - 1)))
    cum = cs[i] + frac * a[np.minimum(i, n_in - 1)]  # suma acumulada en una posición fraccionaria
    widths = np.diff(edges).astype(np.float32).reshape(-1, *([1] * (a.ndim - 1)))
    return np.moveaxis((cum[1:] - cum[:-1]) / widths, 0, axis)


def downscale(gray: np.ndarray, long_side: int = ANALYSIS_LONG_SIDE) -> np.ndarray:
    """Reduce (por área) hasta que el lado largo mida EXACTAMENTE `long_side`: la nitidez y la densidad
    de bordes se miden siempre a la misma escala, sea la foto de 2 MP o de 50 MP. Si la imagen ya es
    chica, no se toca (agrandar no agrega detalle; esa foto la frena la regla de resolución)."""
    h, w = gray.shape[:2]
    if max(h, w) <= long_side:
        return gray
    scale = long_side / max(h, w)
    nh, nw = max(1, round(h * scale)), max(1, round(w * scale))
    return _area_resize_axis(_area_resize_axis(gray, nh, 0), nw, 1).astype(np.float32)


def laplacian_variance(gray: np.ndarray) -> float:
    """Varianza del Laplaciano de 4 vecinos [[0,1,0],[1,-4,1],[0,1,0]], en la región válida (sin bordes).

    Ejemplo: un tablero de cuadros nítido da miles; el mismo tablero promediado en ventanas de 9×9 baja
    a decenas. Lo que importa no es el número absoluto sino el umbral calibrado con TUS documentos.
    """
    g = gray.astype(np.float32)
    if g.shape[0] < 3 or g.shape[1] < 3:
        return 0.0
    lap = g[:-2, 1:-1] + g[2:, 1:-1] + g[1:-1, :-2] + g[1:-1, 2:] - 4.0 * g[1:-1, 1:-1]
    return float(lap.var())


def glare_fraction(gray: np.ndarray, level: int = SATURATED_LEVEL) -> float:
    """Fracción de pixeles saturados. En una INE (fondo de color, no blanco) un reflejo del flash o de
    una lámpara aparece como una mancha casi blanca que tapa datos.

    Ojo: se mide en TODA la foto, fondo incluido. Una INE fotografiada sobre una hoja blanca o una mesa
    clara da "reflejo" aunque la credencial esté perfecta (el test lo documenta), y el mensaje al
    cliente ("aléjate de la luz") no le sirve. Baseline: la versión seria mide solo dentro del contorno
    del documento, detectado con un modelo pequeño (el mismo que mejoraría el detector de "cortado")."""
    return float((gray >= level).mean())


def effective_dpi(width_px: int, height_px: int, doc_size_mm: tuple[float, float]) -> float:
    """DPI efectivos SUPONIENDO que el documento llena la foto (cota superior: si ocupa la mitad del
    encuadre, los DPI reales son la mitad). Lado largo con lado largo, para que la orientación no importe.

    Ejemplo: INE fotografiada a 4000 × 3000 px llenando el encuadre → 4000 ÷ (85.6 mm ÷ 25.4) ≈ 1,187 DPI.
    Una captura de 640 × 480 → ≈ 190 DPI: por debajo de 200, se pide otra.
    """
    long_px = max(width_px, height_px)
    long_in = max(doc_size_mm) / 25.4
    return long_px / long_in


def border_edge_ratio(gray: np.ndarray, strip_frac: float = 0.03) -> float:
    """Máxima densidad de bordes en las 4 franjas exteriores ÷ densidad de bordes del interior.

    Documento completo sobre una mesa: las franjas son mesa lisa → ratio ≈ 0. Documento cortado: el
    texto llega hasta el borde de la foto → la franja de ese lado tiene tanta "tinta" como el interior.
    Es un baseline heurístico: un fondo muy texturizado (una mesa de madera) da falsos positivos. La
    versión seria detecta el contorno del documento (sus 4 esquinas) con un modelo pequeño.
    """
    g = gray.astype(np.float32)
    gx = np.abs(np.diff(g, axis=1))[:-1, :]
    gy = np.abs(np.diff(g, axis=0))[:, :-1]
    edges = (gx + gy) > 40.0  # un salto de 40 niveles de gris entre vecinos = borde de letra o de objeto
    h, w = edges.shape
    sh, sw = max(1, int(h * strip_frac)), max(1, int(w * strip_frac))
    inner = edges[2 * sh: h - 2 * sh, 2 * sw: w - 2 * sw]
    inner_density = float(inner.mean()) if inner.size else 0.0
    if inner_density == 0.0:
        return 0.0  # nada que leer en el interior: lo atrapa otra regla (borrosa / en blanco)
    strips = [edges[:sh, :], edges[-sh:, :], edges[:, :sw], edges[:, -sw:]]
    return max(float(s.mean()) for s in strips) / inner_density


def assess(
    img: np.ndarray,
    profile: QualityProfile,
    source_size: tuple[int, int] | None = None,
    cropped_ratio_max: float = 0.5,
) -> QualityReport:
    """Evalúa una imagen (array HxW o HxWx3 uint8, ya con la orientación EXIF aplicada).

    source_size = (ancho, alto) ORIGINALES, si el llamador decodificó la imagen ya reducida (docs-api
    usa el modo draft de JPEG para decodificar a 1/2, 1/4… y cumplir los 3 s): los DPI se calculan con
    el tamaño real, no con el del array.

    Devuelve TODOS los motivos, no solo el primero: si la foto está borrosa y cortada, el cliente
    debe saber las dos cosas antes de volver a tomarla.
    """
    w, h = source_size if source_size else (img.shape[1], img.shape[0])
    gray_full = to_gray(img)
    gray = downscale(gray_full)
    m = {
        "laplacian_var": laplacian_variance(gray),
        "dpi": effective_dpi(w, h, profile.doc_size_mm),
        "glare_frac": glare_fraction(gray),
        "border_edge_ratio": border_edge_ratio(gray) if profile.check_cropped else 0.0,
    }
    reasons = []
    if m["laplacian_var"] < profile.min_laplacian_var:
        reasons.append("borrosa")
    if profile.max_glare_frac is not None and m["glare_frac"] > profile.max_glare_frac:
        reasons.append("reflejo")
    if m["dpi"] < profile.min_dpi:
        reasons.append("baja_resolucion")
    if profile.check_cropped and m["border_edge_ratio"] > cropped_ratio_max:
        reasons.append("cortado")
    return QualityReport(ok=not reasons, reasons=reasons, metrics={k: round(v, 4) for k, v in m.items()})
