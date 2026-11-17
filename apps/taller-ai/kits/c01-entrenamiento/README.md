# Dojo · C01 · Estación 3: Entrenamiento

Un mini-proyecto para practicar la tercera estación del caso C01 en tu Mac: del snapshot del mes a un **checkpoint candidato con su corrida en MLflow**, con un job que arranca del champion, sobrevive a la caída de su máquina sin empezar de cero y se puede reproducir bit por bit. Lo construyes con Claude, lo rehaces tú solo, lo rompes con ayuda y lo rompes solo.

La guía completa (conceptos, paso a paso, fallas y los prompts de cada ronda) está en el Dojo, en «C01 · Entrenamiento».

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
| `mundo/` | La empresa ficticia: crea las fotos, los snapshots y el champion (`crear.py`), la red (`arquitectura.py`), el preprocess del gateway (`gateway/`), el orquestador, las herramientas para mirar MLflow y el S3, y el reinicio. No se toca. |
| `entrada/categorias.json` | Las 10 categorías, en el orden de su `label_id`. Lo crea `mundo/crear.py`. |
| `pipeline/` | Tus 4 archivos: `datos.py`, `humo.py`, `entrenar.py` y `comparar.py`. Cada uno trae arriba su contrato. `_comun.py` viene dado. |
| `pipeline.yaml` | El pipeline como DAG, para el orquestador (lo escribes en el paso 6). |
| `receta.yaml` | La receta del entrenamiento: arranque, épocas, batch, learning rate, semilla y cada cuánto guardar. |
| `historial/` | Lo que anota el orquestador de cada corrida del pipeline. |
| `verificar.py` / `romper.py` | Los 12 checks de la estación y las 6 fallas. |
| `GUION.md` / `OBJETIVOS.md` | El paso a paso de Construir con ayuda y solo los objetivos para Construir solo. |
| `CLAUDE.md` | Las reglas para Claude Code en este proyecto. |
| `BITACORA.md`, `taller/progreso.json` | Tu registro. `verificar.py` y `romper.py` anotan solos en `progreso.json` (con `taller/registro.py`); impórtalo en «Tu tablero» del Dojo: https://taller-ai-engineer.vercel.app/tablero/ |

## Puertos

| Servicio | Dirección |
|---|---|
| S3 local (RustFS), API | http://localhost:9400 |
| S3 local, consola web | http://localhost:9401 (usuario `taller`, contraseña `taller-secreto`) |
| MLflow (interfaz y API) | http://localhost:5400 |

Para apagarlo: `docker compose down`. Para empezar Construir solo desde el esqueleto: `python mundo/reiniciar.py --pipeline`.

## Créditos

Las fotos son las 10,000 de prueba de Fashion-MNIST (Zalando Research, licencia MIT), con las mismas categorías de marketplace de las estaciones 1 y 2. `mundo/crear.py` las baja una vez (≈ 4.4 MB).
