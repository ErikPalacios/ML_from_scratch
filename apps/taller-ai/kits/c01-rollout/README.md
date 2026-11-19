# Dojo · C01 · Estación 10: Rollout seguro

Un mini-proyecto para practicar la décima estación del caso C01 en tu Mac: llevar el modelo de noviembre (la versión 15, @challenger) frente al tráfico real sin que un error llegue a todos. Lo pones primero en la **sombra** (los gateways de la 14 le copian el 10 % de las fotos y nadie ve lo que contesta), lo mides con umbrales escritos antes, conviertes el gateway en un **Rollout de Argo Rollouts** que sube por peldaños (5 %, 25 %, 100 %) mientras un **análisis** lo compara contra el estable y lo revierte solo si empeora, ensayas ese aborto con un modelo roto a propósito, mueves @champion solo cuando ya es verdad y dejas la versión anterior viva (el **bake**) para volver en segundos. Lo construyes con Claude, lo rehaces tú solo, lo rompes con ayuda y lo rompes solo.

La guía completa (conceptos, paso a paso, fallas y los prompts de cada ronda) está en el Dojo, en «C01 · Rollout seguro».

## Necesitas

- Docker Desktop con ≥ 6 CPU y ≥ 8 GiB (Settings → Resources). Si tienes el clúster de la estación 9 (`dojo-k8s`), apágalo antes: dos no caben.
- kind, kubectl y el plugin de Argo Rollouts: `brew install kind kubectl argoproj/tap/kubectl-argo-rollouts`.
- Python 3.11 o más nuevo. No hace falta venv: todo usa la biblioteca estándar.

## Arranque

```bash
python3 mundo/crear.py
export KUBECONFIG=$PWD/.kube/config
python3 verificar.py mundo
```

`mundo/crear.py` (≈ 3–4 min la primera vez) crea el registro, el clúster `dojo-rollout`, instala Argo Rollouts, el «ALB» del dojo y Prometheus, publica las imágenes y deja corriendo la release 14 (lo que terminó la estación 9). Después abre Claude Code en esta carpeta y pega el prompt de la ronda en la que vas (están en el Dojo).

## Qué hay aquí

| | |
|---|---|
| `mundo/` | La empresa ficticia: el clúster, Argo Rollouts, el ALB del dojo (`alb/`), Prometheus, el registro de modelos (`modelos.py`), el CI (`publicar.py`), la carga (`carga.py`), los logs (`logs.py`) y el ensayo (`ensayo.py`). No se toca. |
| `gateway/`, `gateway.yaml`, `servir/` | El gateway de la estación 6. Tuyo es solo `gateway/app/sombra.py`. |
| `k8s/` | El repositorio de despliegue. De plataforma: `kustomization.yaml`, `namespace.yaml`, `modelo-*.json`. Tuyos: `triton-v14.yaml`, `triton-v15.yaml`, `gateway.yaml`, `ingress.yaml`, `analisis.yaml`. |
| `sombra/` | Los umbrales del shadow (`umbrales.json`, de antes) y tu reporte (`reporte.py`). |
| `ci/promover.py`, `RUNBOOK.md` | Tuyos: el job que mueve @champion y la receta de rollback. |
| `verificar.py` / `romper.py` | Los 12 checks de la estación y las 6 fallas. |
| `GUION.md` / `OBJETIVOS.md` | El paso a paso de Construir con ayuda y solo los objetivos para Construir solo. |
| `CLAUDE.md` | Las reglas para Claude Code en este proyecto. |
| `BITACORA.md`, `taller/progreso.json` | Tu registro. Impórtalo en «Tu tablero» del Dojo: https://dojo.trueml.app/tablero/ |

## Puertos y lugares

| Qué | Dónde |
|---|---|
| El «ALB» del dojo (la entrada al gateway) | http://localhost:8910 (`/v1/classify`, `/readyz`, `/healthz`) |
| Prometheus | http://localhost:9910 |
| El registro (el «ECR» del dojo) | `localhost:5910` |
| El clúster | `kubectl` con `KUBECONFIG=$PWD/.kube/config`; `python3 mundo/cluster.py estado` lo resume |

## Apagar y volver

`python3 mundo/cluster.py apagar` libera la memoria de tu Mac; `python3 mundo/cluster.py prender` lo regresa en ≈ 1 min. `python3 mundo/cluster.py borrar` lo quita todo; `python3 mundo/crear.py` lo vuelve a crear (tus archivos se quedan).
