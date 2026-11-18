# Dojo · C01 · Estación 9: Kubernetes

Un mini-proyecto para practicar la novena estación del caso C01 en tu Mac: convertir las dos imágenes publicadas (el gateway y Triton) en pods que corren en un clúster de Kubernetes **de verdad**. Escribes los manifiestos: qué pide cada pod (CPU, memoria y una T4), cuándo está listo y cuándo está muerto (las tres probes), dónde cae (Triton en una T4, uno por zona; el gateway nunca en una T4), cómo cambia de versión sin bajar de capacidad, cómo se apaga sin cortar requests, qué lo protege del mantenimiento (el PDB) y cómo crece solo (el HPA). Lo construyes con Claude, lo rehaces tú solo, lo rompes con ayuda y lo rompes solo.

La guía completa (conceptos, paso a paso, fallas y los prompts de cada ronda) está en el Dojo, en «C01 · Kubernetes».

## Necesitas

- Docker Desktop con ≥ 6 CPU y ≥ 8 GiB (Settings → Resources).
- kind y kubectl: `brew install kind kubectl` (kubectl 1.34, 1.35 o 1.36: el clúster es 1.35).
- Python 3.11 o más nuevo. No hace falta venv: todo usa la biblioteca estándar.

## Arranque

```bash
python3 mundo/crear.py
export KUBECONFIG=$PWD/.kube/config
python3 verificar.py mundo
```

`mundo/crear.py` (≈ 3 min la primera vez) crea el registro, el clúster `dojo-k8s` (Kubernetes 1.35.5 en kind: un control plane y seis nodos), publica las imágenes y hace de esta carpeta el repositorio de despliegue (git). La llave del clúster queda en `.kube/config`: tu `~/.kube/config` no se toca, por eso el `export` en cada terminal nueva. Después abre Claude Code en esta carpeta y pega el prompt de la ronda en la que vas (están en el Dojo).

## Qué hay aquí

| | |
|---|---|
| `mundo/` | La empresa ficticia: el clúster (`kind.yaml`, `crear.py`, `cluster.py`), metrics-server, el Triton del dojo (`triton_dojo/`, con el modelo de juguete de `triton/`), `publicar.py` (el último paso del CI de la estación 8: escribe el digest en el repositorio de despliegue), `carga.py` (tráfico de fotos por el «ALB») y `foto.jpg`. No se toca. |
| `gateway/`, `gateway.yaml`, `servir/modelo.json` | El gateway de la estación 6 y su receta de Docker. Viene dado, ya construido y publicado. |
| `k8s/kustomization.yaml`, `k8s/namespace.yaml`, `k8s/modelo.json` | Del equipo de plataforma: qué se aplica, el namespace, los labels del modelo (un ConfigMap) y los digests que escribe el CI. |
| `k8s/triton.yaml`, `k8s/gateway.yaml`, `k8s/pdb.yaml`, `k8s/hpa.yaml` | Tuyos. Cada uno trae su contrato arriba, comentado. |
| `verificar.py` / `romper.py` | Los 12 checks de la estación y las 6 fallas. |
| `GUION.md` / `OBJETIVOS.md` | El paso a paso de Construir con ayuda y solo los objetivos para Construir solo. |
| `CLAUDE.md` | Las reglas para Claude Code en este proyecto. |
| `BITACORA.md`, `taller/progreso.json` | Tu registro. `verificar.py` y `romper.py` anotan solos en `progreso.json`; impórtalo en «Tu tablero» del Dojo: https://taller-ai-engineer.vercel.app/tablero/ |

## Puertos y lugares

| Qué | Dónde |
|---|---|
| El «ALB interno» (el Service NodePort del gateway) | http://localhost:8901 (`/v1/classify`, `/readyz`, `/healthz`) |
| El registro (el «ECR» del dojo) | `localhost:5900` |
| El clúster | `kubectl` con `KUBECONFIG=$PWD/.kube/config`; `python3 mundo/cluster.py estado` lo resume |

## Apagar y volver

`python3 mundo/cluster.py apagar` libera la memoria de tu Mac (≈ 3 GB); `python3 mundo/cluster.py prender` lo regresa en ≈ 1 min. `python3 mundo/cluster.py borrar` lo quita todo; `python3 mundo/crear.py` lo vuelve a crear (tus `k8s/*.yaml` se quedan).
