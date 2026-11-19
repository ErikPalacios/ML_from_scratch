# Dojo · C01 · Estación 11: La request en vivo

Un mini-proyecto para practicar la undécima estación del caso C01 en tu Mac. La release 15 ya atiende el 100 % del tráfico, pero, así como viene, no deja rastro: contesta bien y nadie podría decir mañana qué contestó, con qué versión ni qué tan rápido. Le das a cada request un **nombre** (su `request_id`, de punta a punta), una **línea de log** de ≈ 300 B y sus **sumas en las métricas** (contadores, un gauge e histogramas con nombres que no cambian). Haces que **Prometheus** las lea de cada pod una sola vez, escribes las consultas de todos los días y las alertas, y llevas el log del disco del nodo a **S3** con **Fluent Bit** y de ahí a **Parquet** con el job diario. Al final miras lo que el gateway no ve: el ALB contestando él mismo. Lo construyes con Claude, lo rehaces tú solo, lo rompes con ayuda y lo rompes solo.

La guía completa (conceptos, paso a paso, fallas y los prompts de cada ronda) está en el Dojo, en «C01 · La request en vivo».

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

`mundo/crear.py` (≈ 30 s; la primera vez ≈ 2 min, porque baja las imágenes y construye la del nodo) levanta el S3 local, Prometheus, los dos nodos del gateway con su Fluent Bit, Triton, el ALB del dojo, el vigía de S3 y el tráfico de siempre, y deja en S3 el log de ayer para tu job diario. Después abre Claude Code en esta carpeta y pega el prompt de la ronda en la que vas (están en el Dojo).

## Qué hay aquí

| | |
|---|---|
| `mundo/` | La empresa ficticia: los nodos (`nodo/Dockerfile`, `runtime.py`), el kubelet del dojo (`nodo.py`), el ALB (`alb.py`), Triton (`triton_dojo/`), el vigía de S3, los callers (`carga.py`), `buscar.py`, `relojes.py` y lo de plataforma (`plataforma.yaml`, `prometheus/`). No se toca. |
| `gateway/`, `gateway.yaml`, `servir/`, `model_repository/` | La release 15 de las estaciones 6 a 10. Tuyo es solo `gateway/app/rastro.py`. |
| `observabilidad/` | Tuyos: `prometheus.yml`, `reglas.yml` y `fluent-bit.conf`. |
| `diario/a_parquet.py` | Tuyo: el job diario, del log crudo a Parquet. |
| `verificar.py` / `romper.py` | Los 12 checks de la estación y las 6 fallas. |
| `GUION.md` / `OBJETIVOS.md` | El paso a paso de Construir con ayuda y solo los objetivos para Construir solo. |
| `CLAUDE.md` | Las reglas para Claude Code en este proyecto. |
| `BITACORA.md`, `taller/progreso.json` | Tu registro. Impórtalo en «Tu tablero» del Dojo: https://taller-ai-engineer.vercel.app/tablero/ |

## Puertos y lugares

| Qué | Dónde |
|---|---|
| El ALB del dojo (la entrada de los callers) | http://localhost:8950/v1/classify (con token: `mundo/carga.py` lo pide) |
| Lo que el ALB publica («CloudWatch») | http://localhost:8957/metrics · su access log: `logs/alb.log` |
| Los pods del gateway | http://localhost:8951 (nodo a) y http://localhost:8952 (nodo b): `/metrics`, `/readyz` |
| Prometheus | http://localhost:9952 (targets, alertas, consultas) |
| El S3 local (RustFS) | API en `localhost:9950`, consola en http://localhost:9951 (`taller` / `taller-secreto`) |
| Fluent Bit de cada nodo | http://localhost:9953 (a) y http://localhost:9954 (b): `/api/v2/metrics/prometheus` |
| Triton del dojo · vigía de S3 | http://localhost:8955 · http://localhost:8956/metrics |

## Apagar y volver

`python mundo/nodo.py parar` y `docker compose stop` liberan tu Mac; `python mundo/crear.py` lo regresa todo (tus archivos se quedan). `docker compose down -v` borra también lo guardado en S3 y Prometheus.
