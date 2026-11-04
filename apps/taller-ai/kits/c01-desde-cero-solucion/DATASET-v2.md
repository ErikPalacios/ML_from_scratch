# Ficha del dataset · c01-categorias

| | |
|---|---|
| **Versión** | `dataset-v2` |
| **Para qué** | Entrenar y evaluar el clasificador de categorías de las fotos del marketplace. |
| **Fotos** | 18 PNG de 112 × 112 px, en `data/crudo/` (DVC, remoto `s3://datasets/c01`). |
| **Clases** | `playera` 5 · `tenis` 7 · `bolsa` 6 |
| **Splits** | train 12 · val 3 · test 3. El test de v1 sigue igual; `bolsa` estrena 1 de val y 1 de test. |
| **Labels** | `data/labels.csv`: lote `inicial` con la guía v1 y lote `2026-11` con la guía v2. |
| **Fuente** | `inicial`: Fashion-MNIST. `2026-11`: publicaciones del marketplace elegidas por `scripts/seleccionar.py` (nueva, desacuerdo, azar). |
| **Datos personales** | Ninguno: solo entran al dataset las fotos elegidas para etiquetar; el resto se queda en `prod/`. |

## Límites conocidos

- `bolsa` tiene 4 fotos de train: según el precálculo, el modelo reconocería ≈ 3 de cada 4 bolsas nuevas.
- La cola del mes viene de lo que el modelo v1 vio en producción: no es una muestra uniforme. El cupo al azar existe para medir eso.

## Cambios

- `dataset-v2` (2026-11): +8 fotos de producción, clase nueva `bolsa`, guía v2.
- `dataset-v1`: versión inicial.
