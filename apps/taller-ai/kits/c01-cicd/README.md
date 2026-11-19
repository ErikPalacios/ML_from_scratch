# Dojo · C01 · Estación 8: CI/CD y registro de imágenes

Un mini-proyecto para practicar la octava estación del caso C01 en tu Mac: el camino de un commit a una imagen probada, inmutable y corriendo en producción. Escribes el **workflow de GitHub Actions** del gateway (lint y pruebas en cada PR; después del merge, la imagen una sola vez, con humo y escaneo antes de subirla), el **push a ECR** con credenciales por OIDC que vencen solas, el **despliegue por GitOps** a staging y a producción (con una persona que aprueba), siempre por **digest**, y la **regla de retención** del registro. Al final haces un rollback en segundos. Lo construyes con Claude, lo rehaces tú solo, lo rompes con ayuda y lo rompes solo.

La guía completa (conceptos, paso a paso, fallas y los prompts de cada ronda) está en el Dojo, en «C01 · CI/CD y registro de imágenes».

## Arranque

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
docker compose up -d --wait --build
python mundo/crear.py
python verificar.py mundo reglas
```

`mundo/crear.py` hace de esta carpeta un repositorio de git (si no lo es) con su `origin` en la forja, el GitHub del dojo. Después abre Claude Code en esta carpeta y pega el prompt de la ronda en la que vas (están en el Dojo).

## Qué hay aquí

| | |
|---|---|
| `mundo/` | La empresa ficticia. **La forja** (`forja.py`: PRs, merges, corridas y aprobaciones; `acciones.py` corre tu workflow como GitHub Actions), **la nube** (`nube.py`: credenciales por OIDC y el ECR del dojo; `nube/confianza.json`, los roles), **el GitOps** (`gitops.py`: pone a correr en staging y producción lo que dice el repositorio de despliegue), **el escáner** (`escaner.py`, como Trivy, con una base de avisos de ejemplo), el ECR del dojo y el Triton del dojo (en contenedores), `forja.yaml` (la protección de main y los ambientes) y `crear.py`. No se toca. |
| `gateway/` | El gateway de la estación 6, con su `Dockerfile` (la receta de la estación 7) y sus 30 pruebas. Viene dado: aquí no se escribe código del gateway. |
| `.github/workflows/gateway.yml` | Tuyo: el workflow. |
| `ci/` | Tuyos: `humo.sh`, `escaneo.sh`, `push.sh` y `desplegar.sh`. `foto.py` viene dado (la foto de prueba). |
| `infra/ecr-retencion.json` | Tuyo: la regla de retención del repositorio de ECR. |
| `.trivyignore.yaml` | Tuyo: las excepciones del escaneo, con motivo y fecha de vencimiento. |
| `verificar.py` / `romper.py` | Los 12 checks de la estación y las 6 fallas. |
| `GUION.md` / `OBJETIVOS.md` | El paso a paso de Construir con ayuda y solo los objetivos para Construir solo. |
| `CLAUDE.md` | Las reglas para Claude Code en este proyecto. |
| `BITACORA.md`, `taller/progreso.json` | Tu registro. `verificar.py` y `romper.py` anotan solos en `progreso.json`; impórtalo en «Tu tablero» del Dojo: https://dojo.trueml.app/tablero/ |

## Puertos y lugares

| Qué | Dónde |
|---|---|
| ECR del dojo (registro de imágenes) | `localhost:5800` (pide credenciales: `python mundo/nube.py ecr imagenes classifier-gateway` para mirarlo) |
| Triton del dojo | http://localhost:8800 (`/v2/models/classifier`) |
| El gateway en staging | http://localhost:8801 (`/healthz`, `/readyz`, `/v1/classify`) |
| El gateway en producción | http://localhost:8802 |
| La forja | `.forja/classifier.git` (el `origin`), `.forja/despliegue.git` (el repositorio de despliegue) y `.forja/corridas/` (los logs) |

Para apagarlo: `docker rm -f taller-c01-cicd-gw-staging taller-c01-cicd-gw-produccion` y `docker compose down -v`. Para Construir solo: apágalo, descomprime el kit en una carpeta nueva y vuelve a hacer el arranque.

## Lo que es distinto de C01

La forja corre tu workflow en tu Mac y no en máquinas de GitHub (mismo YAML, mismas reglas de `needs`, `if`, `outputs`, `permissions` y `environment`); el ECR del dojo es un proxy con las reglas de ECR delante de `registry:2`; el token OIDC lo firma la forja con un secreto compartido; el GitOps es un hook de git y no Argo CD; los ambientes son dos contenedores y no un clúster; la imagen se construye para tu Mac (arm64) y no para `linux/amd64`; el Triton tiene un modelo de juguete con el contrato de classifier v4, y la base de avisos del escáner es de ejemplo.
