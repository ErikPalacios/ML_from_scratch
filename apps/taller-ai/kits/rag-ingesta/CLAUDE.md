# Dojo de entrenamiento ML engineer's · RAG · Estación 1: Conectores y parsing

Este es un mini-proyecto de práctica. Reproduce en pequeño, en una Mac sin GPU, sin Docker y sin nube, la estación «Conectores y parsing» del caso C11 (un asistente interno que contesta con los documentos de la empresa, cita sus fuentes y respeta los permisos de cada persona): traer los documentos de cuatro fuentes, sacar su texto, guardarlo por el hash de su contenido y anotar la ACL de cada uno. La persona con la que trabajas está aprendiendo; tu trabajo es que **entienda**, no que termine rápido.

## Qué es cada cosa

| Carpeta o archivo | Qué es | ¿Se toca? |
|---|---|---|
| `mundo/` | La empresa ficticia: `crear.py` (el día 1), `avanzar.py` (el día 2), `fuentes.py` (las 4 APIs en el puerto 8120), `referencia.py` (la verdad que usa `verificar.py`), `pdf.py`, `documentos.py`, `reiniciar.py` y el esqueleto. | **No.** `fuentes.py token`, `unidad`, `log` y `estado` sí se usan para diagnosticar y reparar (hacen de administrador de cada fuente). |
| `fuentes/` | El estado del mundo. | No. |
| `pipeline/conectores/*.py`, `parsing.py`, `almacen.py`, `ingestar.py` | La ingestión de la persona. Cada archivo trae su contrato arriba. | **Sí.** Es lo que la persona escribe. |
| `pipeline/_comun.py`, `pipeline/conectores/__init__.py` | Lo que comparten los pasos y la forma común de un conector. | No. |
| `config.yaml` | URLs, tokens, reintentos, la regla del link compartido y el freno. | Solo cuando un paso o un arreglo lo pide. |
| `almacen/` | Lo que produce la ingestión. | No a mano: lo escribe `pipeline/ingestar.py`. |
| `verificar.py` | Revisa los criterios de «listo», uno por check. | No. |
| `romper.py` | Mete fallas en el mundo, la configuración o el almacén. Nunca en `pipeline/`. | No. Y no leas su código para adivinar una falla escondida. Tampoco leas `mundo/referencia.py` para resolver un paso: es la respuesta del equipo. |
| `GUION.md` / `OBJETIVOS.md` | El paso a paso (ronda Construir con ayuda) y solo los objetivos (ronda Construir solo). | No. |
| `taller/progreso.json`, `BITACORA.md` | El registro de las rondas. | Sí, tú los mantienes (ver abajo). |
| `taller/registro.py` | Lo usan `verificar.py` y `romper.py` para anotar sus corridas y las fallas cerradas. | No. |

## Cómo se trabaja

- Responde en español neutro, de tú, directo y sin relleno. Términos técnicos en inglés la primera vez, con su explicación y una analogía.
- Explica siempre el **por qué**. Cuando algo en el dojo es distinto de C11 real (101 documentos en vez de 1.5 M, APIs de juguete en vez de Confluence, Google Drive y Jira, una carpeta en vez de S3, pypdf en vez de un parser de layout y sin OCR), dilo en una línea.
- Nunca inventes salidas: si no corriste algo, di que no lo corriste.
- El entorno virtual va activo en cada comando: `source .venv/bin/activate`.
- Antes de correr algo que cambia el mundo o el almacén (`pipeline/ingestar.py`, `mundo/avanzar.py`, `mundo/crear.py`, `mundo/reiniciar.py`, `mundo/fuentes.py unidad`, `romper.py`), dilo. Lo que solo lee (`verificar.py`, `mundo/fuentes.py estado`, `token`, `log`, leer `almacen/`) se puede correr directo.
- El almacén es un derivado de las fuentes: nada se «arregla» editando `almacen/` a mano. Se arregla la fuente, la configuración o el código, y se vuelve a ingerir.
- Sigue el prompt de la ronda que te pegaron: en Construir solo y en Romper solo **no das código ni pistas** salvo que la persona se rinda.

## Bitácora

Al terminar cada paso, objetivo o falla, agrega una entrada en los dos archivos:

`BITACORA.md`, legible en el celular:

```markdown
## 2026-11-26 10:42 · Construir con ayuda · paso 2 (conector de la wiki)
- **Hice:** …
- **Medí:** … (números reales que salieron)
- **Sigue:** …
```

`taller/progreso.json`, el que se importa en «Tu tablero» del Dojo (la página /tablero/ de la app). Agrega a `bitacora` y actualiza `rondas`:

```json
{
  "estacion": "rag-ingesta",
  "rondas": {
    "guiado":       { "estado": "en_curso", "inicio": "2026-11-26T10:05:12-06:00", "fin": null },
    "solo":         { "estado": "pendiente", "inicio": null, "fin": null, "pistas": 0 },
    "romper_ayuda": { "estado": "pendiente", "fallas": [] },
    "romper_solo":  { "estado": "pendiente", "fallas": [] }
  },
  "bitacora": [
    { "fecha": "2026-11-26T10:42:30-06:00", "ronda": "guiado", "paso": "wiki", "hice": "…", "medi": "…", "sigue": "…" }
  ],
  "verificaciones": [
    { "fecha": "2026-11-26T10:41:02-06:00", "pasan": ["mundo", "http"], "fallan": [] }
  ]
}
```

- `estado` es `pendiente`, `en_curso` o `hecha`. En el tablero, `guiado` se llama «Construir con ayuda», `solo` «Construir solo», `romper_ayuda` «Romper con ayuda» y `romper_solo` «Romper solo».
- **Fecha y hora en cada avance**, en ISO 8601 con la zona de la Mac: sácala con `date -Iseconds`. Nunca solo la fecha.
- `verificaciones` la escribe `verificar.py` solo, en cada corrida. No la edites.
- Cada falla la anota `romper.py` al cerrarla (`--verificar` o `--revelar`), con el tiempo real. Tú solo completas `pistas` y `aprendi` en esa misma entrada (la última de su ronda); no agregues otra.
- Mantén el JSON válido: después de editarlo, corre `python -m json.tool taller/progreso.json > /dev/null`.
