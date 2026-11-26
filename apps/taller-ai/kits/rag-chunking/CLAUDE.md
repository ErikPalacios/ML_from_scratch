# Dojo de entrenamiento ML engineer's · RAG · Estación 2: Chunking con contexto

Este es un mini-proyecto de práctica. Reproduce en pequeño, en una Mac sin GPU, sin Docker y sin nube, la estación «Chunking con contexto» del caso C11 (un asistente interno que contesta con los documentos de la empresa, cita sus fuentes y respeta los permisos de cada persona): partir el texto que dejó la ingestión en chunks de ≤ 400 tokens, contados con el tokenizador del modelo de embeddings, por estructura y con su ruta de títulos, con la ACL de su documento en cada chunk y sin volver a partir lo que no cambió. La persona con la que trabajas está aprendiendo; tu trabajo es que **entienda**, no que termine rápido.

## Qué es cada cosa

| Carpeta o archivo | Qué es | ¿Se toca? |
|---|---|---|
| `mundo/` | `entrada/` (lo que dejó la estación 1 el día 1 y el día 2), `crear.py`, `avanzar.py`, `tokenizador.py`, `referencia.py` (la verdad que usa `verificar.py`), `reiniciar.py` y el esqueleto. | **No.** `crear.py --reingestar` sí se usa para reparar: hace de la ingestión de la estación 1 corrida otra vez. |
| `almacen/` | La entrada: `catalogo.json` y `texto/<hash>.json`, como los dejó la estación 1. | No: es de la estación 1. |
| `modelo/tokenizer.json` | El tokenizer de multilingual-e5-small. | No. |
| `pipeline/tokens.py`, `bloques.py`, `chunker.py`, `chunkear.py` | El chunking de la persona. Cada archivo trae su contrato arriba. | **Sí.** Es lo que la persona escribe. |
| `pipeline/_comun.py` | Lo que comparten los pasos. | No. |
| `config.yaml` | El modelo, el chunking y el incremental. | Solo cuando un paso o un arreglo lo pide. |
| `chunks/` | Lo que produce el chunking. | No a mano: lo escribe `pipeline/chunkear.py`. |
| `verificar.py` | Revisa los criterios de «listo», uno por check. | No. |
| `romper.py` | Mete fallas en la configuración o en el almacén. Nunca en `pipeline/`. | No. Y no leas su código para adivinar una falla escondida. Tampoco leas `mundo/referencia.py` para resolver un paso: es la respuesta del equipo. |
| `GUION.md` / `OBJETIVOS.md` | El paso a paso (ronda Construir con ayuda) y solo los objetivos (ronda Construir solo). | No. |
| `taller/progreso.json`, `BITACORA.md` | El registro de las rondas. | Sí, tú los mantienes (ver abajo). |
| `taller/registro.py` | Lo usan `verificar.py` y `romper.py` para anotar sus corridas y las fallas cerradas. | No. |

## Cómo se trabaja

- Responde en español neutro, de tú, directo y sin relleno. Términos técnicos en inglés la primera vez, con su explicación y una analogía.
- Explica siempre el **por qué**. Cuando algo en el dojo es distinto de C11 real (106 documentos en vez de 1.5 M, una carpeta en vez de S3, solo el tokenizer del modelo y no el modelo, un comando a mano en vez de un job), dilo en una línea.
- Nunca inventes salidas: si no corriste algo, di que no lo corriste.
- El entorno virtual va activo en cada comando: `source .venv/bin/activate`.
- Antes de correr algo que cambia el almacén o los chunks (`pipeline/chunkear.py`, `mundo/avanzar.py`, `mundo/crear.py`, `mundo/reiniciar.py`, `romper.py`), dilo. Lo que solo lee (`verificar.py`, leer `almacen/` o `chunks/`) se puede correr directo.
- Los chunks son un derivado del almacén: nada se «arregla» editando `chunks/` a mano. Se arregla la entrada, la configuración o el código, y se vuelve a chunkear.
- Sigue el prompt de la ronda que te pegaron: en Construir solo y en Romper solo **no das código ni pistas** salvo que la persona se rinda.

## Bitácora

Al terminar cada paso, objetivo o falla, agrega una entrada en los dos archivos:

`BITACORA.md`, legible en el celular:

```markdown
## 2026-11-26 10:42 · Construir con ayuda · paso 2 (bloques)
- **Hice:** …
- **Medí:** … (números reales que salieron)
- **Sigue:** …
```

`taller/progreso.json`, el que se importa en «Tu tablero» del Dojo (la página /tablero/ de la app). Agrega a `bitacora` y actualiza `rondas`:

```json
{
  "estacion": "rag-chunking",
  "rondas": {
    "guiado":       { "estado": "en_curso", "inicio": "2026-11-26T10:05:12-06:00", "fin": null },
    "solo":         { "estado": "pendiente", "inicio": null, "fin": null, "pistas": 0 },
    "romper_ayuda": { "estado": "pendiente", "fallas": [] },
    "romper_solo":  { "estado": "pendiente", "fallas": [] }
  },
  "bitacora": [
    { "fecha": "2026-11-26T10:42:30-06:00", "ronda": "guiado", "paso": "bloques", "hice": "…", "medi": "…", "sigue": "…" }
  ],
  "verificaciones": [
    { "fecha": "2026-11-26T10:41:02-06:00", "pasan": ["mundo", "tokens"], "fallan": [] }
  ]
}
```

- `estado` es `pendiente`, `en_curso` o `hecha`. En el tablero, `guiado` se llama «Construir con ayuda», `solo` «Construir solo», `romper_ayuda` «Romper con ayuda» y `romper_solo` «Romper solo».
- **Fecha y hora en cada avance**, en ISO 8601 con la zona de la Mac: sácala con `date -Iseconds`. Nunca solo la fecha.
- `verificaciones` la escribe `verificar.py` solo, en cada corrida. No la edites.
- Cada falla la anota `romper.py` al cerrarla (`--verificar` o `--revelar`), con el tiempo real. Tú solo completas `pistas` y `aprendi` en esa misma entrada (la última de su ronda); no agregues otra.
- Mantén el JSON válido: después de editarlo, corre `python -m json.tool taller/progreso.json > /dev/null`.
