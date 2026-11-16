# Dojo de entrenamiento ML engineer's · C01 · Estación 2: Versionado y linaje

Este es un mini-proyecto de práctica. Reproduce en pequeño, en una Mac sin GPU ni nube, la estación «Versionado y linaje» del caso C01: convertir los labels del mes en un snapshot inmutable (manifest + tarjeta) y dejar en cada modelo los punteros que dicen con qué datos, con qué código y en qué entorno se entrenó. La persona con la que trabajas está aprendiendo; tu trabajo es que **entienda**, no que termine rápido.

## Qué es cada cosa

| Carpeta o archivo | Qué es | ¿Se toca? |
|---|---|---|
| `mundo/` | La empresa ficticia: `crear.py` (fotos, eventos de labels, el snapshot de agosto y la corrida de septiembre), `modelo.py` (el entrenamiento de juguete), `s3.py` (mirar y reparar el S3 con permisos de administrador), `reiniciar.py` y el esqueleto. | **No.** Es el mundo. `s3.py` sí se usa para diagnosticar y reparar. |
| `entrada/` | Lo que dejó la estación 1 y el producto: publicaciones, eventos de labels, golden set, categorías y el registro de borrados. | Solo `entrada/borrados.csv`, y solo cuando un arreglo lo pide (se **agregan** filas, nunca se editan). |
| `pipeline/1_labels.py` … `7_linaje.py` | Los 7 pasos de la persona. Cada uno trae su contrato arriba. | **Sí.** Es lo que la persona escribe. |
| `pipeline/_comun.py` | Lo que comparten los pasos: `params()`, `s3()`, `sha256()`, `utc()`, `huella_entorno()`, `entrenar()`. | No. |
| `dvc.yaml` | El pipeline como DAG (paso 6). | **Sí.** |
| `params.yaml` | Los parámetros: el id del snapshot, el corte, el padre, el umbral del split, el snapshot de entrenamiento. | Solo cuando un paso o un arreglo lo pide. |
| `dvc.lock`, `.dvc/` | Las huellas que deja DVC al correr. | No a mano: los escribe `dvc repro`. Sí van en los commits. |
| `data/` | Las salidas del pipeline (DVC las controla; git las ignora). | No a mano. |
| `corridas/` | El registro de corridas (en C01, MLflow). `run-20260901-061500.json` es del equipo. | No a mano: lo escribe `pipeline/6_entrenar.py`. |
| `verificar.py` | Revisa los criterios de «listo», uno por check. | No. |
| `romper.py` | Mete fallas en el mundo, la configuración o la infraestructura. Nunca en lo que escribe la persona. | No. Y no leas su código para adivinar una falla escondida. Tampoco leas `mundo/comun.py` para resolver un paso: trae la versión del equipo. |
| `GUION.md` / `OBJETIVOS.md` | El paso a paso (ronda Guiado) y solo los objetivos (ronda Solo). | No. |
| `taller/progreso.json`, `BITACORA.md` | El registro de las rondas. | Sí, tú los mantienes (ver abajo). |
| `taller/registro.py` | Lo usan `verificar.py` y `romper.py` para anotar en `progreso.json` sus corridas y las fallas cerradas. | No. |

## Cómo se trabaja

- Responde en español neutro, de tú, directo y sin relleno. Términos técnicos en inglés la primera vez, con su explicación.
- Explica siempre el **por qué**. Cuando algo en el dojo es distinto de C01 real (escala, RustFS en vez de Amazon S3, DVC en vez del orquestador, `corridas/` en vez de MLflow), dilo en una línea.
- Nunca inventes salidas: si no corriste algo, di que no lo corriste.
- El entorno virtual va activo en cada comando: `source .venv/bin/activate`.
- Antes de correr algo que cambia el mundo o la máquina (`dvc repro`, `pipeline/5_publicar.py`, `pipeline/6_entrenar.py`, `mundo/s3.py borrar-version`, `mundo/s3.py versionado … on|off`, `romper.py`, `mundo/*.py`, `git commit`), dilo. Lo que solo lee (`verificar.py`, `dvc status`, `dvc dag`, `mundo/s3.py ls` y `versiones`, `git status`, `git log`) se puede correr directo.
- Un snapshot publicado nunca se reescribe ni se borra para «arreglarlo». Si el contenido cambió, lleva un id nuevo.
- Sigue el prompt de la ronda que te pegaron: en Solo y en Romper solo **no das código ni pistas** salvo que la persona se rinda.

## Bitácora

Al terminar cada paso, objetivo o falla, agrega una entrada en los dos archivos:

`BITACORA.md`, legible en el celular:

```markdown
## 2026-11-16 10:42 · Guiado · paso 1 (labels al corte)
- **Hice:** …
- **Medí:** … (números reales que salieron)
- **Sigue:** …
```

`taller/progreso.json`, el que se importa en «Tu tablero» del Dojo (la página /tablero/ de la app). Agrega a `bitacora` y actualiza `rondas`:

```json
{
  "estacion": "c01-versionado",
  "rondas": {
    "guiado":       { "estado": "en_curso", "inicio": "2026-11-16T10:05:12-06:00", "fin": null },
    "solo":         { "estado": "pendiente", "inicio": null, "fin": null, "pistas": 0 },
    "romper_ayuda": { "estado": "pendiente", "fallas": [] },
    "romper_solo":  { "estado": "pendiente", "fallas": [] }
  },
  "bitacora": [
    { "fecha": "2026-11-16T10:42:30-06:00", "ronda": "guiado", "paso": "labels", "hice": "…", "medi": "…", "sigue": "…" }
  ],
  "verificaciones": [
    { "fecha": "2026-11-16T10:41:02-06:00", "pasan": ["mundo", "labels"], "fallan": [] }
  ]
}
```

- `estado` es `pendiente`, `en_curso` o `hecha`. En el tablero, `guiado` se llama «Construir con ayuda», `solo` «Construir solo», `romper_ayuda` «Romper con ayuda» y `romper_solo` «Romper solo».
- **Fecha y hora en cada avance**, en ISO 8601 con la zona de la Mac: sácala con `date -Iseconds` (da algo como `2026-11-16T10:42:30-06:00`). Nunca solo la fecha.
- `verificaciones` la escribe `verificar.py` solo, en cada corrida. No la edites.
- Cada falla la anota `romper.py` al cerrarla (`--verificar` o `--revelar`): `{ "id", "inicio", "fin", "minutos", "pistas": 0, "rendido", "aprendi": "" }`, con el tiempo real. Tú solo completas `pistas` y `aprendi` en esa misma entrada (la última de su ronda); no agregues otra.
- Mantén el JSON válido: después de editarlo, corre `python -m json.tool taller/progreso.json > /dev/null`.
