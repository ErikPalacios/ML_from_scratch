# Dojo · C01 · Estación 4: Gate de evaluación y registry

Un mini-proyecto para practicar la cuarta estación del caso C01 en tu Mac: decidir **con reglas escritas antes** si el candidato de octubre puede reemplazar al modelo de producción. Evalúas a tres modelos foto por foto sobre un examen congelado, aplicas la no inferioridad pareada, revisas cada categoría y cada slice, frenas al candidato que rompe una categoría y registras al bueno como `challenger`. Lo construyes con Claude, lo rehaces tú solo, lo rompes con ayuda y lo rompes solo.

La guía completa (conceptos, paso a paso, fallas y los prompts de cada ronda) está en el Dojo, en «C01 · Gate de evaluación y registry».

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
| `mundo/` | La empresa ficticia: crea las fotos, los snapshots, el examen `golden-v1`, el historial del registro (v1–v3) y los dos candidatos de octubre (`crear.py`), la red, el preprocess del gateway, las herramientas para mirar MLflow y el S3, las revisiones de `gate.yaml` y el reinicio. No se toca. |
| `pipeline/` | Tus 3 archivos: `evaluar.py`, `gate.py` y `registrar.py`. Cada uno trae arriba su contrato. `_comun.py` viene dado. |
| `gate.yaml` | Las reglas del gate, del equipo: el examen y su huella, contra quién se compara y cuánto puede moverse cada cosa. |
| `corrida.yaml` | Los parámetros de esta noche, ya resueltos: candidato, champion y el de hace 3 meses, por número. Lo crea `mundo/crear.py`. |
| `reportes/` | Lo que dejan tu evaluación y tu gate de cada candidato. |
| `verificar.py` / `romper.py` | Los 10 checks de la estación y las 6 fallas. |
| `GUION.md` / `OBJETIVOS.md` | El paso a paso de Construir con ayuda y solo los objetivos para Construir solo. |
| `CLAUDE.md` | Las reglas para Claude Code en este proyecto. |
| `BITACORA.md`, `taller/progreso.json` | Tu registro. `verificar.py` y `romper.py` anotan solos en `progreso.json` (con `taller/registro.py`); impórtalo en «Tu tablero» del Dojo: https://taller-ai-engineer.vercel.app/tablero/ |

## Puertos

| Servicio | Dirección |
|---|---|
| S3 local (RustFS), API | http://localhost:9500 |
| S3 local, consola web | http://localhost:9501 (usuario `taller`, contraseña `taller-secreto`) |
| MLflow (interfaz y API) | http://localhost:5500 |

Para apagarlo: `docker compose down`. Para empezar Construir solo desde el esqueleto: `python mundo/reiniciar.py --pipeline`.

## Créditos

Las fotos son las 10,000 de prueba de Fashion-MNIST (Zalando Research, licencia MIT), con las mismas categorías de marketplace de las estaciones 1 a 3. `mundo/crear.py` las baja una vez (≈ 4.4 MB).
