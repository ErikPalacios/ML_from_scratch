# Dojo de entrenamiento ML engineer's · RAG · Estación 8: La API con citas

Este es un mini-proyecto de práctica. Reproduce en pequeño, en una Mac sin GPU, sin Docker y sin nube, la estación «La API con citas» del caso C11 (un asistente interno que contesta con los documentos de la empresa, cita sus fuentes y respeta los permisos de cada persona): `POST /v1/ask` recibe la pregunta, sabe quién pregunta por su llave, recupera el top-8 de la estación 6 con sus permisos, aparta los documentos que traen instrucciones para el modelo, arma el prompt con los chunks numerados dentro de la ventana del modelo, pide la respuesta al LLM local de la estación 7 (Qwen3 0.6B en llama-server) en streaming y la manda por SSE con cada cita revisada contra lo que de verdad recibió esa persona. Sin fuentes suficientes, dice que no sabe. La persona con la que trabajas está aprendiendo; tu trabajo es que **entienda**, no que termine rápido.

## Qué es cada cosa

| Carpeta o archivo | Qué es | ¿Se toca? |
|---|---|---|
| `mundo/` | `entrada/` (el corpus del 22, con un documento envenenado en Drive, el directorio y el golden set de la estación 4), `modelos.json` (e5, el reranker y el GGUF del LLM, con su revisión y su sha256), `modelos.py`, `crear.py` (el almacén, las llaves y el índice de la estación 5), `servidor.py` (arranca el LLM con `servir.sh`), `api.py` (arranca tu API con uvicorn), `reiniciar.py` y el esqueleto. | **No.** |
| `almacen/` | El corpus, el directorio, el golden set y `tokens.json` (la llave de cada persona). | No: lo escribe el mundo. |
| `modelo/` | Los tres modelos, bajados por `mundo/modelos.py`. | No. |
| `servidor.env`, `servir.sh` | Cómo se sirve el LLM (lo de la estación 7). | Solo si un arreglo lo pide. |
| `pipeline/prompt.py`, `citas.py`, `guardas.py`, `api.py` | El código de la persona. Cada archivo trae su contrato arriba. | **Sí.** Es lo que la persona escribe. |
| `pipeline/recuperar.py`, `fusion.py`, `reranker.py`, `buscar.py` y lo de la estación 5 | El retrieval de la estación 6, ya hecho: `Recuperador.recuperar(pregunta, persona)` da el top-8 con los permisos aplicados. | No. |
| `pipeline/llm.py` | El cliente del LLM de la estación 7 (chat, streaming, tokens, `ventana()`, errores). | No. |
| `pipeline/sse.py`, `preguntar.py`, `_comun.py` | Cómo viaja un evento SSE, el cliente de terminal de la API, y lo común (rutas, ACL de la estación 3). | No. |
| `config.yaml` | Lo de las estaciones 5 y 6 y, desde `api`, todo lo de esta: la cache, el LLM (max_tokens, límite), la reserva del prompt, contra qué se validan las citas, el umbral del «no sé», qué fuentes se revisan y el presupuesto del primer token. | Solo cuando un paso o un arreglo lo pide. |
| `verificar.py` | Revisa los criterios de «listo», uno por check (11). | No. |
| `romper.py` | Mete fallas en `config.yaml` o en `servidor.env`. Nunca en `pipeline/`. | No. Y no leas su código para adivinar una falla escondida. |
| `GUION.md` / `OBJETIVOS.md` | El paso a paso (ronda Construir con ayuda) y solo los objetivos (ronda Construir solo). | No. |
| `taller/progreso.json`, `BITACORA.md` | El registro de las rondas. | Sí, tú los mantienes (ver abajo). |
| `taller/registro.py` | Lo usan `verificar.py` y `romper.py` para anotar sus corridas y las fallas cerradas. | No. |

## Cómo se trabaja

- Responde en español neutro, de tú, directo y sin relleno. Términos técnicos en inglés la primera vez, con su explicación y una analogía.
- Explica siempre el **por qué**. Cuando algo en el dojo es distinto de C11 real (un modelo de 0.6B en llama-server en vez del LLM de la plataforma de la empresa, llaves fijas en un archivo en vez del SSO, una cache en memoria en vez de Redis, 152 chunks en vez de ≈ 7.5 M), dilo en una línea.
- Nunca inventes salidas: si no corriste algo, di que no lo corriste. Las respuestas del modelo de 0.6B a veces citan el número equivocado o se confunden: dilo tal cual; medir si la respuesta es fiel a sus fuentes es la estación 9.
- El entorno virtual va activo en cada comando: `source .venv/bin/activate`. El LLM tiene que estar arriba (`python mundo/servidor.py arrancar`) y, para el check api y `preguntar.py`, tu API (`python mundo/api.py arrancar`; vuelve a arrancarla después de cambiar tu código).
- Antes de correr algo que cambia el almacén o los servidores (`mundo/crear.py`, `mundo/reiniciar.py`, `mundo/servidor.py`, `romper.py`), dilo. Lo que solo lee (`verificar.py`, `pipeline/preguntar.py`, `pipeline/prompt.py`, `pipeline/citas.py`, `pipeline/guardas.py`) se puede correr directo.
- Nunca se cambia `config.yaml` para que un check «pase» sin decirlo, y el umbral del «no sé» se elige con dev, no con test.
- Sigue el prompt de la ronda que te pegaron: en Construir solo y en Romper solo **no das código ni pistas** salvo que la persona se rinda.

## Bitácora

Al terminar cada paso, objetivo o falla, agrega una entrada en los dos archivos:

`BITACORA.md`, legible en el celular:

```markdown
## 2026-11-27 10:42 · Construir con ayuda · paso 1 (el prompt)
- **Hice:** …
- **Medí:** … (números reales que salieron)
- **Sigue:** …
```

`taller/progreso.json`, el que se importa en «Tu tablero» del Dojo (la página /tablero/ de la app). Agrega a `bitacora` y actualiza `rondas`:

```json
{
  "estacion": "rag-rag-api",
  "rondas": {
    "guiado":       { "estado": "en_curso", "inicio": "2026-11-27T10:05:12-06:00", "fin": null },
    "solo":         { "estado": "pendiente", "inicio": null, "fin": null, "pistas": 0 },
    "romper_ayuda": { "estado": "pendiente", "fallas": [] },
    "romper_solo":  { "estado": "pendiente", "fallas": [] }
  },
  "bitacora": [
    { "fecha": "2026-11-27T10:42:30-06:00", "ronda": "guiado", "paso": "prompt", "hice": "…", "medi": "…", "sigue": "…" }
  ],
  "verificaciones": [
    { "fecha": "2026-11-27T10:41:02-06:00", "pasan": ["mundo", "prompt"], "fallan": [] }
  ]
}
```

- `estado` es `pendiente`, `en_curso` o `hecha`. En el tablero, `guiado` se llama «Construir con ayuda», `solo` «Construir solo», `romper_ayuda` «Romper con ayuda» y `romper_solo` «Romper solo».
- **Fecha y hora en cada avance**, en ISO 8601 con la zona de la Mac: sácala con `date -Iseconds`. Nunca solo la fecha.
- `verificaciones` la escribe `verificar.py` solo, en cada corrida. No la edites.
- Cada falla la anota `romper.py` al cerrarla (`--verificar` o `--revelar`), con el tiempo real. Tú solo completas `pistas` y `aprendi` en esa misma entrada (la última de su ronda); no agregues otra.
- Mantén el JSON válido: después de editarlo, corre `python -m json.tool taller/progreso.json > /dev/null`.
