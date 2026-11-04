# Ficha del dataset · c01-categorias

| | |
|---|---|
| **Versión** | `dataset-v1` |
| **Para qué** | Entrenar y evaluar el clasificador de categorías de las fotos del marketplace. |
| **Fotos** | 10 PNG de 112 × 112 px, en `data/crudo/` (DVC, remoto `s3://datasets/c01`). |
| **Clases** | `playera` 5 · `tenis` 5 |
| **Splits** | train 6 · val 2 · test 2, por clase y por hash (`data/splits.csv`). El test no se mueve en versiones futuras. |
| **Labels** | `data/labels.csv`: una persona, con la guía v1 (`guia/guia-v1.md`), en Label Studio. |
| **Fuente** | Fashion-MNIST (set de prueba), © 2017 Zalando SE, licencia MIT. |
| **Datos personales** | Ninguno: fotos de producto sin personas ni metadatos. |

## Límites conocidos

- Con 1 foto de test por clase, cada foto vale 50 puntos de exactitud: el test solo dice si el pipeline funciona, no qué tan bueno es el modelo.
- Un solo anotador: no hay medida de acuerdo.

## Cambios

- `dataset-v1`: versión inicial.
