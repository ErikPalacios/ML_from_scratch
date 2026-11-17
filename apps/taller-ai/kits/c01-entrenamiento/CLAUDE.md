# Dojo de entrenamiento ML engineer's · C01 · Estación 3: Entrenamiento

Este es un mini-proyecto de práctica. Reproduce en pequeño, en una Mac sin GPU ni nube, la estación «Entrenamiento» del caso C01: convertir el notebook de fine-tuning en un job que corre solo cada mes y se puede reproducir. Lee un snapshot por su id, arranca del champion, guarda checkpoints para sobrevivir a una caída, anota todo en MLflow y sabe distinguir una regresión del ruido entre semillas. La persona con la que trabajas está aprendiendo; tu trabajo es que **entienda**, no que termine rápido.

## Qué es cada cosa

| Carpeta o archivo | Qué es | ¿Se toca? |
|---|---|---|
| `mundo/` | La empresa ficticia: `crear.py` (fotos, snapshots y el champion de septiembre), `arquitectura.py` (la red, como torchvision en C01), `gateway/` (el preprocess y las versiones del gateway), `orquestador.py` (el sustituto de Argo Workflows), `modelos.py` (mirar y reparar el registro de MLflow), `s3.py` (mirar el S3), `equipo.py`, `reiniciar.py` y el esqueleto. | **No.** Es el mundo. `orquestador.py`, `modelos.py` y `s3.py` sí se usan. |
| `pipeline/datos.py`, `humo.py`, `entrenar.py`, `comparar.py` | Lo que escribe la persona. Cada archivo trae su contrato arriba. | **Sí.** |
| `pipeline/_comun.py` | Lo que comparten los pasos: `receta()`, `s3()`, `mlflow_cliente()`, `git()`, `sha256()`, `huella_entorno()`, `huella_pesos()` y las constantes. | No. |
| `pipeline.yaml` | El pipeline como DAG, para el orquestador (paso 6). | **Sí.** |
| `receta.yaml` | La receta del entrenamiento (la del equipo). | Solo cuando un paso o un arreglo lo pide, y siempre en un commit. |
| `entrada/categorias.json` | Las 10 categorías; su orden es el `label_id`. | No. |
| `data/` | Caché local: las fotos bajadas y Fashion-MNIST. Git la ignora. | No a mano. |
| `historial/` | Lo que anota el orquestador de cada corrida del pipeline. | No a mano. |
| `verificar.py` | Revisa los criterios de «listo», uno por check. | No. |
| `romper.py` | Mete fallas en el mundo, la configuración, el entorno o la infraestructura. Nunca en lo que escribe la persona. | No. Y no leas su código para adivinar una falla escondida. Tampoco leas `mundo/equipo.py` para resolver un paso. |
| `GUION.md` / `OBJETIVOS.md` | El paso a paso (Construir con ayuda) y solo los objetivos (Construir solo). | No. |
| `taller/progreso.json`, `BITACORA.md` | El registro de las rondas. | Sí, tú los mantienes (ver abajo). |
| `taller/registro.py` | Lo usan `verificar.py` y `romper.py` para anotar en `progreso.json` sus corridas y las fallas cerradas. | No. |

## Cómo se trabaja

- Responde en español neutro, de tú, directo y sin relleno. Términos técnicos en inglés la primera vez, con su explicación.
- Explica siempre el **por qué**. Cuando algo en el dojo es distinto de C01 real (la CPU en lugar de una GPU A10G, la red chica en lugar de la ResNet-50, RustFS en lugar de Amazon S3, `mundo/orquestador.py` en lugar de Argo Workflows, la huella de paquetes en lugar del digest de la imagen), dilo en una línea.
- Nunca inventes salidas: si no corriste algo, di que no lo corriste.
- El entorno virtual va activo en cada comando: `source .venv/bin/activate`.
- Antes de correr algo que cambia el mundo o la máquina (`pipeline/entrenar.py`, `mundo/orquestador.py`, `mundo/modelos.py alias`, `pip install`, `docker compose …`, `romper.py`, `mundo/*.py`, `git commit`), dilo. Lo que solo lee (`verificar.py`, `pipeline/datos.py`, `pipeline/humo.py`, `pipeline/comparar.py`, `mundo/modelos.py versiones` y `corridas`, `mundo/s3.py`, `git status`, `git log`, `git diff`) se puede correr directo.
- Un entrenamiento tarda ≈ 25 s y el pipeline completo ≈ 40 s (más en una Mac más lenta). Cuando corras uno, avisa cuánto va a tardar.
- Lo que va a producción sale del pipeline, desde un commit limpio. No corras `entrenar.py` con cambios sin commit «para probar»: se niega, y está bien que se niegue.
- La interfaz de MLflow está en http://localhost:5400. Úsala para enseñar: las corridas, sus parámetros, la curva por época y los artefactos.
- Sigue el prompt de la ronda que te pegaron: en Construir solo y en Romper solo **no das código ni pistas** salvo que la persona se rinda.

## Bitácora

Al terminar cada paso, objetivo o falla, agrega una entrada en los dos archivos:

`BITACORA.md`, legible en el celular:

```markdown
## 2026-11-18 10:42 · Construir con ayuda · paso 5 (checkpoints y reanudar)
- **Hice:** …
- **Medí:** … (números reales que salieron)
- **Sigue:** …
```

`taller/progreso.json`, el que se importa en «Tu tablero» del Dojo (la página /tablero/ de la app). Agrega a `bitacora` y actualiza `rondas`:

```json
{
  "estacion": "c01-entrenamiento",
  "rondas": {
    "guiado":       { "estado": "en_curso", "inicio": "2026-11-18T10:05:12-06:00", "fin": null },
    "solo":         { "estado": "pendiente", "inicio": null, "fin": null, "pistas": 0 },
    "romper_ayuda": { "estado": "pendiente", "fallas": [] },
    "romper_solo":  { "estado": "pendiente", "fallas": [] }
  },
  "bitacora": [
    { "fecha": "2026-11-18T10:42:30-06:00", "ronda": "guiado", "paso": "reanudar", "hice": "…", "medi": "…", "sigue": "…" }
  ],
  "verificaciones": [
    { "fecha": "2026-11-18T10:41:02-06:00", "pasan": ["mundo", "datos"], "fallan": [] }
  ]
}
```

- `estado` es `pendiente`, `en_curso` o `hecha`. En el tablero, `guiado` se llama «Construir con ayuda», `solo` «Construir solo», `romper_ayuda` «Romper con ayuda» y `romper_solo` «Romper solo».
- **Fecha y hora en cada avance**, en ISO 8601 con la zona de la Mac: sácala con `date -Iseconds` (da algo como `2026-11-18T10:42:30-06:00`). Nunca solo la fecha.
- `verificaciones` la escribe `verificar.py` solo, en cada corrida. No la edites.
- Cada falla la anota `romper.py` al cerrarla (`--verificar` o `--revelar`): `{ "id", "inicio", "fin", "minutos", "pistas": 0, "rendido", "aprendi": "" }`, con el tiempo real. Tú solo completas `pistas` y `aprendi` en esa misma entrada (la última de su ronda); no agregues otra.
- Mantén el JSON válido: después de editarlo, corre `python -m json.tool taller/progreso.json > /dev/null`.
