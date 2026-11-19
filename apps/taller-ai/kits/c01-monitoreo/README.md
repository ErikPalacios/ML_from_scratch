# Dojo · C01 · Estación 12: Monitoreo y reentrenamiento

Un mini-proyecto para practicar la última estación del caso C01 en tu Mac. La release 15 atiende todo el tráfico y cada request ya deja sus tres rastros (la estación 11). Ahora los conviertes en **vigilancia y decisiones**: alertas que gastan el **presupuesto de errores** con burn rate, la **baja confianza** del modelo contra su promedio de 7 días, **pruebas** de esas reglas que simulan días en segundos, **Alertmanager** que despierta a la guardia solo cuando toca, un **job diario** que calcula el PSI y la aceptación desde el Parquet de S3, un **disparador** que abre un ticket por causa con su diagnóstico, y la **cola de etiquetado** que vuelve a la estación 1. Lo construyes con Claude, lo rehaces tú solo, lo rompes con ayuda y lo rompes solo.

La guía completa (conceptos, paso a paso, fallas y los prompts de cada ronda) está en el Dojo, en «C01 · Monitoreo y reentrenamiento».

## Necesitas

- Docker Desktop (≥ 4 GiB libres).
- Python 3.11 o más nuevo, con el venv del kit:

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
source .venv/bin/activate
```

## Arranque

```bash
python mundo/crear.py
python verificar.py mundo
```

`mundo/crear.py` (≈ 40 s; la primera vez ≈ 2 min, porque baja las imágenes) levanta el S3 local, Prometheus, Alertmanager y la Pushgateway, deja en S3 60 días de historia (los logs en Parquet, los eventos del backend, el examen fijo y los despliegues), le da a Prometheus 8 días de métricas como si llevara una semana leyendo, y arranca Triton, los dos pods del gateway, el buscapersonas y el tráfico de siempre. Después abre Claude Code en esta carpeta y pega el prompt de la ronda en la que vas (están en el Dojo).

## Qué hay aquí

| | |
|---|---|
| `mundo/` | La empresa ficticia: la historia (`historia.py`), los procesos (`servicios.py`), el buscapersonas, los tickets, el orquestador, el job programado (`cron.py`), las cinco capas en vivo (`capas.py`), `promtool.py`, `recargar.py` y lo de plataforma (`plataforma.yaml`, `prometheus/`, `alertmanager/`). No se toca. |
| `gateway/`, `gateway.yaml`, `servir/`, `model_repository/` | La release 15 con el rastro de la estación 11. No se toca. |
| `observabilidad/` | Tuyos: `reglas.yml`, `pruebas.yml` y `alertmanager.yml`. |
| `diario/` | Tuyos: `monitoreo.py` (el job diario), `disparador.py` (los tickets) y `muestras.py` (la cola de etiquetado). |
| `verificar.py` / `romper.py` | Los 12 checks de la estación y las 6 fallas. |
| `GUION.md` / `OBJETIVOS.md` | El paso a paso de Construir con ayuda y solo los objetivos para Construir solo. |
| `CLAUDE.md` | Las reglas para Claude Code en este proyecto. |
| `BITACORA.md`, `taller/progreso.json` | Tu registro. Impórtalo en «Tu tablero» del Dojo: https://dojo.trueml.app/tablero/ |

## Puertos y lugares

| Qué | Dónde |
|---|---|
| Prometheus | http://localhost:9962 (reglas, alertas, consultas) |
| Alertmanager | http://localhost:9963 |
| Pushgateway | http://localhost:9964 |
| El S3 local (RustFS) | API en `localhost:9960`, consola en http://localhost:9961 (`taller` / `taller-secreto`) |
| Los pods del gateway | http://localhost:8961 (nodo a) y http://localhost:8962 (nodo b): `/metrics`, `/readyz` |
| Triton del dojo · el buscapersonas | http://localhost:8965 · http://localhost:8966/estado |

## Apagar y volver

`python mundo/servicios.py parar` y `docker compose stop` liberan tu Mac; `python mundo/crear.py` lo regresa todo como al principio (tus archivos se quedan, pero la historia, los tickets y los resúmenes nacen otra vez). `docker compose down -v` borra también lo guardado en S3 y Prometheus.
