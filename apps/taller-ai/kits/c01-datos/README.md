# Dojo · C01 · Estación 1: Datos y etiquetas

Un mini-proyecto para practicar la primera estación del caso C01 en tu Mac: de los logs de producción a los labels del mes. Lo construyes con Claude, lo rehaces tú solo, lo rompes con ayuda y lo rompes solo.

La guía completa (conceptos, paso a paso, fallas y los prompts de cada ronda) está en la app del Dojo, en «C01 · Datos y etiquetas».

## Arranque

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
docker compose up -d
python mundo/reiniciar.py --todo
python verificar.py mundo
```

Después abre Claude Code en esta carpeta y pega el prompt de la ronda en la que vas (están en la app).

## Qué hay aquí

| | |
|---|---|
| `mundo/` | La empresa ficticia: simulador, modelo, proveedor de etiquetado, experto simulado, el job del mes y el reinicio. No se toca. |
| `pipeline/` | Tus 7 pasos. Cada archivo trae arriba su contrato: qué entra y qué sale. |
| `config.yaml` | Los parámetros del pipeline. |
| `guia/` | La guía de etiquetado (la v1 viene dada; la v2 la escribes tú) y la interfaz de Label Studio. |
| `verificar.py` | Los 12 checks de la estación. |
| `romper.py` | Las 10 fallas. |
| `GUION.md` / `OBJETIVOS.md` | El paso a paso de la ronda Guiado y solo los objetivos para la ronda Solo. |
| `CLAUDE.md` | Las reglas para Claude Code en este proyecto. |
| `BITACORA.md`, `taller/progreso.json` | Tu registro. `verificar.py` y `romper.py` anotan solos en `progreso.json` (con `taller/registro.py`); impórtalo en «Tu tablero» del Dojo: https://dojo.trueml.app/tablero/ |

## Servicios

| Servicio | Dirección | Usuario de prueba |
|---|---|---|
| S3 local (RustFS), API | http://localhost:9100 | `taller` / `taller-secreto` |
| S3 local, consola web | http://localhost:9101 | `taller` / `taller-secreto` |
| Label Studio | http://localhost:8090 | `taller@ejemplo.com` / `taller-etiquetas` |

Son credenciales de prueba que solo existen en tu Mac. Si un puerto está ocupado, cambia el número de la izquierda en `compose.yaml` y el endpoint en `config.yaml`.

Para apagar todo: `docker compose down` (los datos se quedan en los volúmenes). Para borrar también los volúmenes: `docker compose down -v`.

## Créditos

Fashion-MNIST © 2017 Zalando SE, licencia MIT (https://github.com/zalandoresearch/fashion-mnist).
