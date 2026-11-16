# Dojo · C01 · Estación 7: Empaquetado (Docker)

Un mini-proyecto para practicar la estación de empaquetado del caso C01 en tu Mac. El servicio es el clasificador de Iris del laboratorio de Docker: un gateway (FastAPI) y un model server (FastAPI + onnxruntime) que habla el protocolo v2 de Triton. Tú escribes todo lo que lo convierte en imágenes que corren en cualquier lado: dependencias fijadas, `.dockerignore`, Dockerfiles, `compose.yaml`, el push a un registry, el pull desde un «servidor» que no tiene el código y la versión del model server con el modelo fuera de la imagen.

La guía completa (conceptos, paso a paso, fallas y los prompts de cada ronda) está en el Dojo, en «C01 · Empaquetado (Docker)».

## Arranque

```bash
docker pull python:3.13-slim
python3 verificar.py mundo
```

No hace falta entorno virtual: `verificar.py` y `romper.py` solo usan Python y el CLI de Docker. Necesitas `uv` para fijar dependencias (`brew install uv`).

## Qué hay aquí

| | |
|---|---|
| `gateway/app.py`, `model_server/server.py` | El código de serving (la estación 6). No se toca. |
| `model_repository/iris/1/model.onnx` | El modelo exportado (1.3 KB). `training/train.py` es cómo se hizo; no hace falta correrlo. |
| `scripts/smoke.sh` | La prueba de punta a punta: model server directo y luego a través del gateway. |
| `config.env` | La configuración del gateway, que compose le pasa como variables de entorno. |
| `gateway/`, `model_server/` (Dockerfile, `.dockerignore`, requirements, `Dockerfile.volumen`), `compose.yaml`, `servidor/compose.yaml` | Lo que escribes tú. Vienen con su contrato en comentarios. |
| `verificar.py` / `romper.py` | Los 11 checks de la estación y las 6 fallas. |
| `mundo/` | El reinicio, el registro de modelos del mundo y el esqueleto. No se toca. |
| `GUION.md` / `OBJETIVOS.md` | El paso a paso de la ronda Guiado y solo los objetivos para la ronda Solo. |
| `CLAUDE.md` | Las reglas para Claude Code en este proyecto. |
| `BITACORA.md`, `taller/progreso.json` | Tu registro. `verificar.py` y `romper.py` anotan solos en `progreso.json` (con `taller/registro.py`); impórtalo en «Tu tablero» del Dojo: https://taller-ai-engineer.vercel.app/tablero/ |

## Puertos

| Servicio | Dirección |
|---|---|
| gateway | http://localhost:8080 |
| model server | http://localhost:9000 |
| registry local | localhost:5050 (el 5000 de macOS lo ocupa AirPlay) |
| gateway del servidor (paso 9) | http://localhost:8081 |
| model server con el modelo en un volumen (paso 10) | http://localhost:9001 |

Para apagar todo: `docker compose down`, `(cd servidor && docker compose down)` y `docker rm -f iris-volumen registry`. Para empezar la ronda Solo desde el esqueleto: `python3 mundo/reiniciar.py`.

## Créditos

Iris: R. A. Fisher (1936), vía scikit-learn. El laboratorio de Iris es el proyecto con el que aprendiste Docker; aquí sus archivos de servicio se usan tal cual.
