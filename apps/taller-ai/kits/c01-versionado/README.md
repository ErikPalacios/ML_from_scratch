# Dojo · C01 · Estación 2: Versionado y linaje

Un mini-proyecto para practicar la segunda estación del caso C01 en tu Mac: de los labels del mes a un **snapshot inmutable** con su manifest y su tarjeta, y de cada modelo a los datos exactos con que se entrenó. Lo construyes con Claude, lo rehaces tú solo, lo rompes con ayuda y lo rompes solo.

La guía completa (conceptos, paso a paso, fallas y los prompts de cada ronda) está en el Dojo, en «C01 · Versionado y linaje».

## Arranque

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
docker compose up -d --wait
python mundo/crear.py
git init && git add -A && git commit -m "kit recién descomprimido"
dvc init && git commit -m "dvc init"
python verificar.py mundo
```

Después abre Claude Code en esta carpeta y pega el prompt de la ronda en la que vas (están en el Dojo).

## Qué hay aquí

| | |
|---|---|
| `mundo/` | La empresa ficticia: crea las fotos, los eventos de labels y el snapshot de agosto (`crear.py`), el entrenamiento de juguete (`modelo.py`), la herramienta del S3 (`s3.py`) y el reinicio. No se toca. |
| `entrada/` | Lo que dejó la estación 1 y el producto: publicaciones, eventos de labels, golden set, registro de borrados y categorías. Lo crea `mundo/crear.py`. |
| `pipeline/` | Tus 7 pasos. Cada archivo trae arriba su contrato: qué entra, qué sale y sus reglas. `_comun.py` viene dado. |
| `dvc.yaml` | El pipeline como DAG (lo escribes en el paso 6). `dvc.lock` lo escribe DVC. |
| `params.yaml` | Los parámetros del pipeline: el id del snapshot, el corte, el padre, el umbral del split. |
| `corridas/` | El registro de corridas (en C01, MLflow). Trae la del modelo de septiembre. |
| `verificar.py` / `romper.py` | Los 12 checks de la estación y las 7 fallas. |
| `GUION.md` / `OBJETIVOS.md` | El paso a paso de la ronda Guiado y solo los objetivos para la ronda Solo. |
| `CLAUDE.md` | Las reglas para Claude Code en este proyecto. |
| `BITACORA.md`, `taller/progreso.json` | Tu registro. `verificar.py` y `romper.py` anotan solos en `progreso.json` (con `taller/registro.py`); impórtalo en «Tu tablero» del Dojo: https://taller-ai-engineer.vercel.app/tablero/ |

## Puertos

| Servicio | Dirección |
|---|---|
| S3 local (RustFS), API | http://localhost:9300 |
| S3 local, consola web | http://localhost:9301 (usuario `taller`, contraseña `taller-secreto`) |

Para apagarlo: `docker compose down`. Para empezar la ronda Solo desde el esqueleto: `python mundo/reiniciar.py --pipeline` (con `--todo` también vuelve a crear el mundo).

## Créditos

Las categorías son las de Fashion-MNIST (Zalando Research, MIT) con nombres de marketplace, como en la estación 1. Las fotos son de juguete: las genera `mundo/crear.py` con una semilla fija.
