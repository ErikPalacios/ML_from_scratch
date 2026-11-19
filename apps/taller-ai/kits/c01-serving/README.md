# Dojo · C01 · Estación 6: Código de serving

Un mini-proyecto para practicar la sexta estación del caso C01 en tu Mac: el programa que pone a responder al modelo que aprobó el gate. Armas el **model repository** de Triton desde el registro (con sus huellas), escribes su `config.pbtxt` (batching dinámico, fila con plazo, dos copias y warmup) y escribes el **gateway** en FastAPI: revisa cada foto de lo barato a lo caro, la prepara con topes de memoria y de concurrencia, le pide los logits a Triton con un plazo que nunca pasa del que le queda, contesta con el código correcto y deja una línea de log y sus métricas. Con sus pruebas, que corren sin Triton. Lo construyes con Claude, lo rehaces tú solo, lo rompes con ayuda y lo rompes solo.

La guía completa (conceptos, paso a paso, fallas y los prompts de cada ronda) está en el Dojo, en «C01 · Código de serving».

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
| `mundo/` | La empresa ficticia: el registro v1–v4 con los engines de v3 y v4, el examen y las fotos de prueba (`crear.py`); el **servidor de modelos del dojo** (`triton_dojo/`, el sustituto de Triton: lee tu `config.pbtxt` y habla su protocolo HTTP); `servicios.py` (arranca, para y revisa Triton y tu gateway); las herramientas del registro, las revisiones de `gateway.yaml` y el reinicio. No se toca. |
| `servir/armar.py` | Tuyo: arma el model repository y la ficha del modelo desde el registro. |
| `model_repository/classifier/config.pbtxt` | Tuyo: cómo carga y atiende Triton el modelo. |
| `gateway/app/` | Tuyo: `main.py` (el gateway) y `revision.py` (la revisión de cada foto). `preprocess.py` viene dado: es el mismo del entrenamiento. |
| `gateway/tests/` | Tuyas: las pruebas, con un Triton falso. `python -m pytest`. |
| `gateway.yaml` | Las reglas del gateway (límites y plazos), del equipo de serving. |
| `servir.yaml` | Qué versión se sirve, ya resuelta: classifier v4. Lo crea `mundo/crear.py`. |
| `fotos-raras/` | Fotos buenas y malas para probar a mano. Las crea `mundo/crear.py`. |
| `verificar.py` / `romper.py` | Los 12 checks de la estación y las 6 fallas. |
| `GUION.md` / `OBJETIVOS.md` | El paso a paso de Construir con ayuda y solo los objetivos para Construir solo. |
| `CLAUDE.md` | Las reglas para Claude Code en este proyecto. |
| `BITACORA.md`, `taller/progreso.json` | Tu registro. `verificar.py` y `romper.py` anotan solos en `progreso.json`; impórtalo en «Tu tablero» del Dojo: https://dojo.trueml.app/tablero/ |

## Puertos

| Servicio | Dirección |
|---|---|
| S3 local (RustFS), API | http://localhost:9700 |
| S3 local, consola web | http://localhost:9701 (usuario `taller`, contraseña `taller-secreto`) |
| MLflow (interfaz y API) | http://localhost:5700 |
| Servidor de modelos (Triton del dojo) | http://localhost:8700 (`/v2/health/ready`, `/v2/models/classifier`, `/metrics`) |
| Tu gateway | http://localhost:8701 (`/v1/classify`, `/healthz`, `/readyz`, `/metrics`) |

Para apagarlo: `python mundo/servicios.py parar` y `docker compose down`. Para empezar Construir solo desde el esqueleto: `python mundo/reiniciar.py --serving`.

## Créditos

Las fotos son las 10,000 de prueba de Fashion-MNIST (Zalando Research, licencia MIT), con las mismas categorías de marketplace de las estaciones 1 a 5. `mundo/crear.py` las baja una vez (≈ 4.4 MB).
