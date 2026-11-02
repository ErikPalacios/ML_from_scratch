"""Matemática PURA de un whole-slide image (caso c04): nada de I/O, GPU, colas ni red.

Qué resuelve este archivo, en el orden en que lo usa worker.py:
  1. validar el mpp (micrones por pixel) antes de confiar en él          → check_mpp
  2. elegir de qué nivel de la pirámide leer para trabajar a 0.5 µm/px   → choose_read_plan
  3. máscara de tejido sobre un nivel de baja resolución                  → choose_mask_level, tissue_mask
  4. grilla de tiles de 512 px con 64 px de overlap (stride 448)         → plan_tiles
  5. reescalar lo leído al tamaño del modelo                             → resize_to
  6. coser (stitch) los mapas de probabilidad con blending, sin costuras → Stitcher
  7. números del reporte: mm² de tumor y % del tejido                    → summarize

Por qué separado del worker: todo esto se prueba con arrays pequeños en milisegundos, sin AWS, sin
GPU y sin un WSI de 1 GB. Y es exactamente la parte donde un error NO lanza excepción: un mpp mal
leído o un stitch sin normalizar producen un número plausible y equivocado en el reporte.

Unidades (la fuente más común de bugs en patología digital):
  - "level-0 px": pixeles del nivel de máxima resolución del archivo (40× ≈ 0.25 µm/px). Las
    coordenadas de read_region y del GeoJSON final están en este sistema.
  - "model px": pixeles a target_mpp (20× ≈ 0.5 µm/px), la resolución a la que se entrenó el modelo.
    La grilla de tiles vive aquí.
  - "map px": pixeles del mapa cosido, model px / out_downsample (8 → 4 µm/px).
Solo depende de numpy.
"""

from __future__ import annotations  # anotaciones como texto (list[str] | None también en 3.9)

import hashlib  # hash de la config de preprocesamiento (parte de la clave de idempotencia)
import json  # serialización canónica de la config antes de hashearla
import math  # ceil/floor en conversiones de coordenadas
from dataclasses import asdict, dataclass  # config inmutable y serializable

import numpy as np


# ---------------------------------------------------------------------------- configuración
@dataclass(frozen=True)
class PreprocConfig:
    """Todo lo que cambia el RESULTADO de un slide. Su hash va en summary.json y en la clave de
    idempotencia: si cambias un número de aquí, los resultados viejos dejan de contar como "ya
    procesado" y el slide se reprocesa. Lo que NO cambia el resultado (hilos, timeouts, la cola)
    vive en worker.py y no entra al hash.
    """

    target_mpp: float = 0.5  # 20×: la resolución con la que se entrenó el modelo (µm/px)
    level_tolerance: float = 0.05  # se acepta un nivel hasta 5 % más grueso que el objetivo
    tile_px: int = 512  # entrada del modelo (512×512 RGB)
    overlap_px: int = 64  # overlap entre tiles vecinos → stride 448: el borde de un tile es su peor zona
    min_tissue_frac: float = 0.10  # un tile con < 10 % de tejido no se infiere (fondo: GPU tirada)
    mask_max_mpp: float = 8.0  # máscara en el nivel más grueso con ≤ 8 µm/px (≈ 4 µm en el SVS de X)
    mask_min_mpp: float = 2.0  # si el más grueso es más fino que esto, leerlo entero no cabe en RAM
    sat_floor: float = 0.08  # saturación mínima para "tejido" aunque Otsu diga menos (slide casi vacío)
    dark_floor: float = 0.10  # brillo máximo < 10 % = negro (bordes del escáner, basura): no es tejido
    out_downsample: int = 8  # el mapa cosido va a 0.5 × 8 = 4 µm/px: el slide entero cabe en RAM
    tumor_threshold: float = 0.5  # probabilidad → máscara de tumor (sale de la validación, no se inventa)
    blur_lapvar_min: float = 25.0  # varianza del Laplaciano bajo esto = tile borroso (CALIBRAR por escáner)
    blur_min_tissue_frac: float = 0.5  # el blur solo se mide en tiles con ≥ 50 % de tejido (el fondo es "liso")
    mpp_min: float = 0.1  # fuera de [0.1, 2.0] µm/px el metadato es basura, no un escáner raro
    mpp_max: float = 2.0
    mpp_anisotropy_max: float = 0.02  # mpp-x y mpp-y que difieren > 2 %: metadato roto (o X/Y invertidos)
    mpp_nominal_tolerance: float = 0.10  # ±10 % contra el mpp registrado para ESE escáner
    color_bins: int = 16  # histograma de color del tejido por canal (lo usa el job diario de PSI)

    @property
    def stride_px(self) -> int:
        """Paso entre tiles: 512 − 64 = 448 model px (224 µm a 0.5 µm/px)."""
        return self.tile_px - self.overlap_px

    @property
    def out_mpp(self) -> float:
        """Resolución del mapa cosido: 0.5 × 8 = 4 µm/px."""
        return self.target_mpp * self.out_downsample

    def validate(self) -> None:
        """Falla al arrancar, no a mitad de un slide."""
        if not 0 <= self.overlap_px < self.tile_px:
            raise ValueError("overlap_px debe estar en [0, tile_px)")
        # El stitcher trabaja en map px: tile y stride deben caer en pixeles enteros del mapa
        if self.tile_px % self.out_downsample or self.stride_px % self.out_downsample:
            raise ValueError("tile_px y stride_px deben ser múltiplos de out_downsample")
        if not 0 < self.tumor_threshold < 1:
            raise ValueError("tumor_threshold debe estar en (0, 1)")

    def hash(self) -> str:
        """sha256 de la config en JSON canónico (claves ordenadas): el mismo dict → el mismo hash
        en cualquier máquina y en cualquier orden de declaración."""
        canon = json.dumps(asdict(self), sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(canon.encode()).hexdigest()


def expected_tiles(tissue_mm2: float, cfg: PreprocConfig) -> float:
    """Tiles esperados para un área de tejido: área ÷ (stride en µm)².
    1.5 cm² = 150 mm² → 150e6 µm² ÷ (448 × 0.5 µm)² = 150e6 ÷ 50,176 ≈ 2,990 tiles.
    Es una cota inferior: los tiles del borde del tejido también entran si tienen ≥ 10 %."""
    stride_um = cfg.stride_px * cfg.target_mpp
    return tissue_mm2 * 1e6 / stride_um**2


# ---------------------------------------------------------------------------- 1. mpp
def check_mpp(mpp_x: float | None, mpp_y: float | None, nominal_mpp: float | None,
              cfg: PreprocConfig) -> list[str]:
    """Flags BLOQUEANTES del metadato de resolución. Lista vacía = se puede usar.

    Por qué bloquea en vez de adivinar: con el mpp equivocado, TODO se escala mal y nada falla.
    Un slide de 40× leído como 20× hace que el modelo vea el tejido 2× más grande (predice basura
    plausible) y que los mm² del reporte salgan 4× más grandes. El patólogo vería un número falso
    con cara de verdadero. Sin resultado ("sin resultado de IA") es mejor que un resultado falso.
    """
    if mpp_x is None or mpp_y is None:
        return ["missing_mpp"]  # sin mpp no hay física: ni nivel correcto ni mm²
    flags = []
    if not (cfg.mpp_min <= mpp_x <= cfg.mpp_max and cfg.mpp_min <= mpp_y <= cfg.mpp_max):
        flags.append("odd_mpp")  # 0, negativo, 25 (unidades en cm/pulgada mal convertidas)…
    elif abs(mpp_x - mpp_y) / min(mpp_x, mpp_y) > cfg.mpp_anisotropy_max:
        flags.append("anisotropic_mpp")  # pixeles no cuadrados: casi siempre un metadato roto
    elif mpp_x > cfg.target_mpp * (1 + cfg.level_tolerance):
        flags.append("odd_mpp")  # escaneado más grueso que 20×: habría que INVENTAR detalle (upsampling)
    if not flags and nominal_mpp is not None:
        # El escáner está registrado con su mpp calibrado: si el archivo dice otra cosa, el archivo
        # miente (firmware, conversión de formato, un DICOM con X/Y invertidos…). No se le cree.
        if abs(mpp_x - nominal_mpp) / nominal_mpp > cfg.mpp_nominal_tolerance:
            flags.append("mpp_mismatch")
    return flags


# ---------------------------------------------------------------------------- 2. nivel de lectura
@dataclass(frozen=True)
class ReadPlan:
    """Cómo leer UN tile de model px desde el archivo.

    Ejemplo del caso (escáner X): mpp nivel 0 = 0.25, downsamples [1, 4, 16] → mpp por nivel
    [0.25, 1.0, 4.0]. El objetivo es 0.5: el nivel 1 (1.0 µm/px) es demasiado grueso (perdería
    detalle), así que se lee del nivel 0 una región de 512 × 0.5 / 0.25 = 1024 px y se reduce 2×.
    Cuesta 4× decodificar (1024² en vez de 512² pixeles) por cada tile: ese es el "detalle senior".
    """

    level: int  # nivel de la pirámide del que se lee
    level_mpp: float  # µm/px de ese nivel
    read_px: int  # lado de la región leída, en px de ese nivel (1024 en el ejemplo)
    model_to_level0: float  # model px → level-0 px (0.5 / 0.25 = 2.0)


def choose_read_plan(level0_mpp: float, level_downsamples: list[float] | tuple[float, ...],
                     cfg: PreprocConfig) -> ReadPlan:
    """El nivel MÁS GRUESO que todavía es tan fino como el objetivo (con 5 % de tolerancia).

    Por qué el más grueso: menos bytes que decodificar por tile. Por qué no uno más grueso que el
    objetivo: reescalar hacia arriba no recupera el detalle que el modelo vio en training.
    """
    limit = cfg.target_mpp * (1 + cfg.level_tolerance)
    candidates = [(i, level0_mpp * ds) for i, ds in enumerate(level_downsamples)
                  if level0_mpp * ds <= limit]
    if not candidates:
        # check_mpp ya lo marca como odd_mpp; esto protege a quien llame sin validar
        raise ValueError(f"ningún nivel llega a {cfg.target_mpp} µm/px (nivel 0 = {level0_mpp})")
    level, level_mpp = max(candidates, key=lambda c: c[1])
    read_px = round(cfg.tile_px * cfg.target_mpp / level_mpp)  # 512 × 0.5 / 0.25 = 1024
    return ReadPlan(level=level, level_mpp=level_mpp, read_px=read_px,
                    model_to_level0=cfg.target_mpp / level0_mpp)


def choose_mask_level(level0_mpp: float, level_downsamples, cfg: PreprocConfig) -> int | None:
    """Nivel para la máscara de tejido: el más grueso con mpp ≤ mask_max_mpp. None si ni el más
    grueso baja de mask_min_mpp (leer un nivel de 1 µm/px entero son decenas de GB en RAM)."""
    usable = [(i, level0_mpp * ds) for i, ds in enumerate(level_downsamples)
              if level0_mpp * ds <= cfg.mask_max_mpp]
    if not usable:
        return None
    level, mpp = max(usable, key=lambda c: c[1])
    return level if mpp >= cfg.mask_min_mpp else None


# ---------------------------------------------------------------------------- 3. máscara de tejido
def otsu_threshold(values: np.ndarray, bins: int = 256) -> float:
    """Umbral de Otsu sobre valores en [0, 1]: el corte que maximiza la varianza ENTRE clases."""
    hist, edges = np.histogram(values, bins=bins, range=(0.0, 1.0))
    total = hist.sum()
    if total == 0:
        return 1.0
    p = hist / total
    centers = (edges[:-1] + edges[1:]) / 2
    omega = np.cumsum(p)  # peso de la clase "abajo del corte"
    mu = np.cumsum(p * centers)  # media acumulada
    denom = omega * (1 - omega)
    with np.errstate(divide="ignore", invalid="ignore"):
        sigma_b = np.where(denom > 0, (mu[-1] * omega - mu) ** 2 / denom, 0.0)
    return float(edges[int(np.argmax(sigma_b)) + 1])


def tissue_mask(rgb: np.ndarray, cfg: PreprocConfig) -> np.ndarray:
    """Máscara booleana de tejido sobre un thumbnail RGB uint8 (H, W, 3).

    BASELINE, documentado como tal: en H&E el fondo del vidrio es blanco o gris (saturación ≈ 0)
    y el tejido está teñido (rosa/morado, saturado). Otsu sobre la saturación separa las dos
    modas; sat_floor evita que en un slide casi vacío Otsu corte en medio del ruido del fondo.
    Lo que este baseline hace mal (y por qué QC y un humano lo miran): marcas de plumón azul/verde
    (saturadas → cuentan como tejido), burbujas y pliegues, tejido muy pálido (grasa). En
    producción se suele agregar limpieza morfológica o un modelo pequeño de tejido; se mide
    contra máscaras hechas a mano, como cualquier otro modelo.
    """
    f = rgb.astype(np.float32) / 255.0
    mx = f.max(axis=-1)  # "value" de HSV
    mn = f.min(axis=-1)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0.0)  # saturación de HSV
    thr = max(otsu_threshold(sat), cfg.sat_floor)
    return (sat > thr) & (mx > cfg.dark_floor)


def color_histograms(rgb: np.ndarray, mask: np.ndarray, bins: int) -> dict[str, list[int]]:
    """Conteos por canal (R, G, B) de los pixeles de TEJIDO, en bins fijos sobre 0–255.

    Bins fijos (no cuantiles por slide) para poder SUMAR slides de un día y compararlos con la
    referencia de training: eso hace el job diario de PSI (monitoring/stain_psi.py)."""
    px = rgb[mask]
    return {ch: np.histogram(px[:, i], bins=bins, range=(0, 256))[0].astype(int).tolist()
            for i, ch in enumerate("rgb")}


# ---------------------------------------------------------------------------- 4. grilla de tiles
@dataclass(frozen=True)
class Tile:
    """Un tile en model px (esquina superior izquierda) y su fracción de tejido."""

    x: int
    y: int
    tissue_frac: float


def grid_starts(length_px: int, cfg: PreprocConfig) -> list[int]:
    """Orígenes de tiles a lo largo de un eje para cubrirlo entero con stride 448.
    Ejemplo: 1000 px → ceil((1000 − 64) / 448) = 3 tiles en 0, 448 y 896; el último se sale
    del slide y se rellena con blanco (fondo) al leer."""
    if length_px <= cfg.overlap_px:
        return [0]
    n = math.ceil((length_px - cfg.overlap_px) / cfg.stride_px)
    return [i * cfg.stride_px for i in range(n)]


def plan_tiles(width_model: int, height_model: int, mask: np.ndarray, mask_mpp: float,
               cfg: PreprocConfig) -> list[Tile]:
    """Tiles con ≥ min_tissue_frac de tejido según la máscara de baja resolución.

    La fracción de cada tile sale de una imagen integral (summed-area table): O(1) por tile en
    vez de sumar la ventana cada vez. El pedazo de tile que cae fuera del slide cuenta como fondo.
    """
    integral = np.pad(mask.astype(np.int64).cumsum(0).cumsum(1), ((1, 0), (1, 0)))
    scale = cfg.target_mpp / mask_mpp  # model px → mask px (0.5 / 4 = 1/8)
    full_area = (cfg.tile_px * scale) ** 2  # área del tile completo en mask px
    mh, mw = mask.shape
    tiles = []
    for y in grid_starts(height_model, cfg):
        y0 = min(mh, math.floor(y * scale))
        y1 = min(mh, math.ceil((y + cfg.tile_px) * scale))
        for x in grid_starts(width_model, cfg):
            x0 = min(mw, math.floor(x * scale))
            x1 = min(mw, math.ceil((x + cfg.tile_px) * scale))
            s = integral[y1, x1] - integral[y0, x1] - integral[y1, x0] + integral[y0, x0]
            frac = min(1.0, float(s) / full_area)
            if frac >= cfg.min_tissue_frac:
                tiles.append(Tile(x, y, frac))
    return tiles


# ---------------------------------------------------------------------------- 5. reescalar
def block_mean(a: np.ndarray, f: int) -> np.ndarray:
    """Promedio por bloques f×f (área exacta para factores enteros). Recorta el sobrante."""
    if f == 1:
        return a
    h, w = a.shape[0] // f * f, a.shape[1] // f * f
    shape = (h // f, f, w // f, f) + a.shape[2:]
    return a[:h, :w].reshape(shape).mean(axis=(1, 3))


def _area_weights(n_in: int, n_out: int) -> np.ndarray:
    """Matriz (n_out, n_in): cada pixel de salida promedia la fracción de pixeles de entrada que
    cubre. Es la interpolación "por área" para factores NO enteros (p. ej. 1012 → 512)."""
    s = n_in / n_out
    edges = np.arange(n_out + 1) * s
    j = np.arange(n_in)
    lo = np.maximum(edges[:-1, None], j[None, :])
    hi = np.minimum(edges[1:, None], j[None, :] + 1)
    return np.clip(hi - lo, 0, None) / s


def resize_to(region: np.ndarray, out_px: int) -> np.ndarray:
    """Región (read_px, read_px, 3) uint8 → (out_px, out_px, 3) uint8.

    Factor entero (1024 → 512, el caso normal): promedio 2×2 exacto y rápido. Factor no entero
    (un escáner de 0.2527 µm/px lee 1013 px): pesos por área, más lento pero correcto.
    TRAMPA (skew): este reescalado tiene que ser EL MISMO que se usó al generar los tiles de
    training. Si training usó cv2.INTER_AREA y aquí usas bilinear, el modelo ve otras texturas
    y nada lo avisa. Incluso "el mismo algoritmo" difiere: contra cv2.resize(INTER_AREA) en
    1024 → 512, este promedio da exactamente lo mismo salvo el redondeo de los .5 (np.rint
    redondea al par): 1 nivel de gris de diferencia en ≈ 12.5 % de los pixeles (medido con ruido
    uniforme). Se detecta con un test de paridad sobre tiles guardados de training.
    Velocidad (medida en una laptop Apple Silicon, numpy 2.5 y OpenCV 5.0): ≈ 30 ms por tile aquí
    contra ≈ 0.1 ms con cv2.resize, ≈ 300× más lento. A 200 tiles/s, esta versión sola ocuparía
    ≈ 6 núcleos, más que todo el presupuesto de CPU del caso (≈ 20 ms por tile). Es la versión de
    referencia legible; en producción va la implementación de training, con su test de paridad.
    """
    n = region.shape[0]
    if n == out_px:
        return region
    if n % out_px == 0:
        out = block_mean(region.astype(np.float32), n // out_px)
    else:
        wh = _area_weights(region.shape[0], out_px)
        ww = _area_weights(region.shape[1], out_px)
        tmp = np.tensordot(wh, region.astype(np.float32), axes=(1, 0))  # (out, w, 3)
        out = np.tensordot(tmp, ww, axes=(1, 1)).transpose(0, 2, 1)  # (out, out, 3)
    return np.clip(np.rint(out), 0, 255).astype(np.uint8)


def laplacian_variance(rgb: np.ndarray) -> float:
    """Nitidez de un tile: varianza del Laplaciano (4 vecinos) en escala de grises.
    Un tile fuera de foco pierde bordes → Laplaciano ≈ 0 → varianza baja. El umbral depende del
    escáner y de la compresión: se calibra con tiles que un patólogo marca como borrosos."""
    g = rgb.astype(np.float32) @ np.array([0.299, 0.587, 0.114], np.float32)
    lap = g[1:-1, :-2] + g[1:-1, 2:] + g[:-2, 1:-1] + g[2:, 1:-1] - 4 * g[1:-1, 1:-1]
    return float(lap.var())


# ---------------------------------------------------------------------------- 6. stitching
def blend_window(n: int, ramp: int) -> np.ndarray:
    """Peso 2D de un tile de n px con rampas lineales de `ramp` px en los 4 bordes.

    Con stride = n − ramp, la rampa de bajada de un tile y la de subida del vecino SUMAN 1 en
    cada pixel del overlap (partición de la unidad): la transición es lineal y no hay escalón.
    Ejemplo en map px (n = 64, ramp = 8): el tile A pesa 0.9375 … 0.0625 en sus 8 últimos px y el
    tile B pesa 0.0625 … 0.9375 en sus 8 primeros. Nunca llega a 0: en el borde del slide, donde
    hay un solo tile, la normalización devuelve su valor tal cual.
    """
    if ramp == 0:
        return np.ones((n, n), np.float32)
    i = np.arange(n, dtype=np.float32)
    r = np.minimum(1.0, np.minimum((i + 0.5) / ramp, (n - i - 0.5) / ramp))
    return np.outer(r, r).astype(np.float32)


class Stitcher:
    """Acumula mapas de probabilidad por tile en un mapa del slide a out_mpp (4 µm/px).

    El mapa cubre TODA el área escaneada (el rectángulo del nivel 0), no solo el tejido: un tile
    puede caer en cualquier parte. Ejemplo con un escaneo de ≈ 25 × 20 mm (100,000 × 80,000 px a
    0.25 µm/px; el tamaño real depende del escáner y del portaobjetos):
      - a 0.5 µm/px (resolución del modelo): 50,000 × 40,000 = 2,000 M px → 8 GB por arreglo float32.
      - a 4 µm/px: 6,250 × 5,000 ≈ 31 M px → ≈ 125 MB por arreglo. Con acc, wsum y prob (float32)
        más las máscaras bool (covered, tejido, tumor) son ≈ 0.5 GB: caben en los 16 GiB del pod.
    Si solo contaras los 1.5 cm² de tejido saldrían ≈ 37 MB por arreglo: 3–4× menos, y es el error
    de dimensionamiento típico. El reporte (mm², %, polígonos para el visor) no necesita más
    detalle que 4 µm/px.
    Resultado = Σ(peso × prob) ÷ Σ(peso). Sin dividir entre Σ(peso), los bordes del slide y las
    esquinas donde se cruzan 4 tiles tendrían otra escala: eso ES una costura.
    """

    def __init__(self, width_model: int, height_model: int, cfg: PreprocConfig):
        cfg.validate()
        self.d = cfg.out_downsample
        self.shape = (math.ceil(height_model / self.d), math.ceil(width_model / self.d))
        self.acc = np.zeros(self.shape, np.float32)  # Σ peso × prob
        self.wsum = np.zeros(self.shape, np.float32)  # Σ peso
        self.window = blend_window(cfg.tile_px // self.d, cfg.overlap_px // self.d)

    def add(self, x: int, y: int, prob: np.ndarray) -> None:
        """Suma un tile (tile_px × tile_px, en model px) con origen (x, y) en model px."""
        p = block_mean(prob.astype(np.float32), self.d)  # 512 → 64 map px
        oy, ox = y // self.d, x // self.d
        h = min(p.shape[0], self.shape[0] - oy)  # el último tile puede salirse del slide
        w = min(p.shape[1], self.shape[1] - ox)
        if h <= 0 or w <= 0:
            return
        win = self.window[:h, :w]
        self.acc[oy:oy + h, ox:ox + w] += win * p[:h, :w]
        self.wsum[oy:oy + h, ox:ox + w] += win

    def result(self) -> tuple[np.ndarray, np.ndarray]:
        """(prob, covered): probabilidad cosida y máscara de pixeles con al menos un tile."""
        covered = self.wsum > 0
        prob = np.zeros(self.shape, np.float32)
        np.divide(self.acc, self.wsum, out=prob, where=covered)
        return prob, covered


def resample_mask(mask: np.ndarray, src_mpp: float, dst_mpp: float,
                  dst_shape: tuple[int, int]) -> np.ndarray:
    """Vecino más cercano en coordenadas físicas: máscara de tejido (src_mpp) → grilla del mapa."""
    ratio = dst_mpp / src_mpp
    rows = np.clip(((np.arange(dst_shape[0]) + 0.5) * ratio).astype(int), 0, mask.shape[0] - 1)
    cols = np.clip(((np.arange(dst_shape[1]) + 0.5) * ratio).astype(int), 0, mask.shape[1] - 1)
    out = mask[np.ix_(rows, cols)]
    # Lo que cae fuera de la máscara original (el borde del último tile) no es tejido
    out[(np.arange(dst_shape[0]) + 0.5) * ratio >= mask.shape[0], :] = False
    out[:, (np.arange(dst_shape[1]) + 0.5) * ratio >= mask.shape[1]] = False
    return out


# ---------------------------------------------------------------------------- 7. números del reporte
def summarize(prob: np.ndarray, covered: np.ndarray, tissue: np.ndarray, out_mpp: float,
              threshold: float) -> tuple[dict, np.ndarray]:
    """(números, máscara de tumor): mm² de tumor y % del tejido a partir del mapa cosido.

    Ejemplo numérico: a 4 µm/px, 1 px = 16 µm² = 1.6e-5 mm². Un tumor de 1 mm × 1 mm son
    250 × 250 = 62,500 px → 1.0 mm²; en 9 mm² de tejido (562,500 px) → 11.1 %.
    El denominador es TODO el tejido de la máscara, también el de tiles descartados por tener
    < 10 % de tejido (no se infirieron: se reporta cuánto quedó sin cubrir).
    """
    px_mm2 = (out_mpp * 1e-3) ** 2  # µm → mm, al cuadrado
    tumor = (prob >= threshold) & tissue & covered  # tumor solo donde hay tejido Y predicción
    tissue_px = int(tissue.sum())
    tumor_px = int(tumor.sum())
    evaluated = tissue & covered
    conf = np.maximum(prob, 1 - prob)[evaluated]  # confianza = distancia a 0.5, en [0.5, 1]
    return {
        "tissue_mm2": round(tissue_px * px_mm2, 4),
        "tumor_mm2": round(tumor_px * px_mm2, 4),
        "tumor_pct_of_tissue": round(100.0 * tumor_px / tissue_px, 2) if tissue_px else None,
        "tissue_covered_frac": round(float(evaluated.sum()) / tissue_px, 4) if tissue_px else 0.0,
        "mean_confidence": round(float(conf.mean()), 4) if conf.size else None,
    }, tumor
