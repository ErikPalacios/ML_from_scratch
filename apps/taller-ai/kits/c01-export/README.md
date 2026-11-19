# Dojo · C01 · Estación 5: Export, engine y paridad

Un mini-proyecto para practicar la quinta estación del caso C01 en tu Mac: convertir el modelo que aprobó el gate en lo que de verdad se va a servir y demostrar que **sigue siendo el mismo modelo** y que **no se volvió más lento**. Exportas el checkpoint de `classifier` v4 a ONNX con tres chequeos, construyes un engine FP16 atado a esta máquina y a este runtime, comparas sus respuestas con PyTorch sobre el examen congelado, ves cómo un engine int8 más rápido no pasa, mides su latencia contra el engine del champion y dejas todo en el registro con sus huellas. Lo construyes con Claude, lo rehaces tú solo, lo rompes con ayuda y lo rompes solo.

La guía completa (conceptos, paso a paso, fallas y los prompts de cada ronda) está en el Dojo, en «C01 · Export, engine y paridad».

## Arranque

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
docker compose up -d --wait
python mundo/crear.py
git init && git add -A && git commit -m "kit recién descomprimido"
python verificar.py mundo
```

Después abre Claude Code en esta carpeta y pega el prompt de la ronda en la que vas (están en el Dojo).

## Qué hay aquí

| | |
|---|---|
| `mundo/` | La empresa ficticia: crea el examen `golden-v1`, el set de calibración, el registro v1–v4 (v3 `@champion` con su engine, v4 `@challenger`) y los checkpoints (`crear.py`); la red, el preprocess del gateway, el contrato y el runtime del servidor (`servidor/`), las herramientas para mirar MLflow y el S3, las revisiones de `engine.yaml` y el reinicio. No se toca. |
| `pipeline/` | Tus 5 archivos: `exportar.py`, `construir.py`, `paridad.py`, `latencia.py` y `registrar.py`. Cada uno trae arriba su contrato. `_comun.py` viene dado. |
| `engine.yaml` | La receta del export y del engine, y los umbrales de paridad y latencia, del equipo. |
| `corrida.yaml` | Los parámetros de esta noche, ya resueltos: challenger = 4, champion = 3. Lo crea `mundo/crear.py`. |
| `artefactos/` | Lo que fabrican y miden tus pasos: `model.onnx`, `engine.onnx` y sus reportes, por versión. |
| `verificar.py` / `romper.py` | Los 10 checks de la estación y las 6 fallas. |
| `GUION.md` / `OBJETIVOS.md` | El paso a paso de Construir con ayuda y solo los objetivos para Construir solo. |
| `CLAUDE.md` | Las reglas para Claude Code en este proyecto. |
| `BITACORA.md`, `taller/progreso.json` | Tu registro. `verificar.py` y `romper.py` anotan solos en `progreso.json` (con `taller/registro.py`); impórtalo en «Tu tablero» del Dojo: https://dojo.trueml.app/tablero/ |

## Puertos

| Servicio | Dirección |
|---|---|
| S3 local (RustFS), API | http://localhost:9600 |
| S3 local, consola web | http://localhost:9601 (usuario `taller`, contraseña `taller-secreto`) |
| MLflow (interfaz y API) | http://localhost:5600 |

Para apagarlo: `docker compose down`. Para empezar Construir solo desde el esqueleto: `python mundo/reiniciar.py --pipeline`.

## Créditos

Las fotos son las 10,000 de prueba de Fashion-MNIST (Zalando Research, licencia MIT), con las mismas categorías de marketplace de las estaciones 1 a 4. `mundo/crear.py` las baja una vez (≈ 4.4 MB).
