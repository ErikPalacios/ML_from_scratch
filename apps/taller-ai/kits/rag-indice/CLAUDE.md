# Dojo de entrenamiento ML engineer's · RAG · Estación 5: Embeddings e índice híbrido

Este es un mini-proyecto de práctica. Reproduce en pequeño, en una Mac sin GPU, sin Docker y sin nube, la estación «Embeddings e índice híbrido» del caso C11 (un asistente interno que contesta con los documentos de la empresa, cita sus fuentes y respeta los permisos de cada persona): convertir cada chunk en un vector con un modelo de embeddings local, guardar qué modelo y qué versión lo hizo, armar un índice BM25 y uno de vectores sobre los mismos chunks con la ACL de cada uno, construir cada índice nuevo al lado del vigente y cambiar el alias sin cortar el servicio, con forma de volver atrás. La persona con la que trabajas está aprendiendo; tu trabajo es que **entienda**, no que termine rápido.

## Qué es cada cosa

| Carpeta o archivo | Qué es | ¿Se toca? |
|---|---|---|
| `mundo/` | `entrada/` (el corpus del 22, el directorio y el golden set de la estación 4, en `registro-golden/`), `modelos.json` (el catálogo: repositorio, revisión y sha256 de cada modelo), `modelos.py` (los baja), `crear.py` (copia la entrada y hace el índice del piloto), `servicio.py` (la API de búsqueda), `trafico.py`, `noche.py` (el job de cada noche), `evaluar.py` (el monitor de calidad), `referencia.py` (la verdad que usa `verificar.py`), `reiniciar.py` y el esqueleto. | **No.** `crear.py --golden` sí se usa para reparar. |
| `almacen/` | La entrada: `corpus/vigente.json`, `directorio.json`, `golden/` y `mundo.json` (el reloj). | No: lo escribe el mundo. |
| `modelo/` | Los archivos de los dos modelos (`e5` y `minilm`), bajados por `mundo/modelos.py`. | No. |
| `pipeline/embeber.py`, `bm25.py`, `vectores.py`, `construir.py`, `buscar.py`, `prueba.py`, `alias.py` | El pipeline de la persona. Cada archivo trae su contrato arriba. | **Sí.** Es lo que la persona escribe. |
| `pipeline/_comun.py` | Lo que comparten los pasos: rutas, lectura y escritura de un jalón, el catálogo, `palabras()` y lo de la estación 3 (`principals`, `puede_ver`). | No. |
| `config.yaml` | El modelo de embeddings, la dimensión y la similitud del índice, k1 y b de BM25, y lo de la API (alias, modelo de la consulta, puerto). | Solo cuando un paso o un arreglo lo pide. |
| `cache/` e `indices/` | Lo que produce el pipeline: los embeddings ya hechos (por modelo y texto), una carpeta por índice y `indices/alias.json`. | No a mano: lo escriben `pipeline/construir.py` y `pipeline/alias.py`. |
| `verificar.py` | Revisa los criterios de «listo», uno por check. | No. |
| `romper.py` | Mete fallas en la configuración o en lo que está detrás del alias (`indices/`). Nunca en `pipeline/`. | No. Y no leas su código para adivinar una falla escondida. Tampoco leas `mundo/referencia.py` para resolver un paso: es la respuesta del equipo. |
| `GUION.md` / `OBJETIVOS.md` | El paso a paso (ronda Construir con ayuda) y solo los objetivos (ronda Construir solo). | No. |
| `taller/progreso.json`, `BITACORA.md` | El registro de las rondas. | Sí, tú los mantienes (ver abajo). |
| `taller/registro.py` | Lo usan `verificar.py` y `romper.py` para anotar sus corridas y las fallas cerradas. | No. |

## Cómo se trabaja

- Responde en español neutro, de tú, directo y sin relleno. Términos técnicos en inglés la primera vez, con su explicación y una analogía.
- Explica siempre el **por qué**. Cuando algo en el dojo es distinto de C11 real (151 chunks en vez de ≈ 7.5 M, una carpeta con archivos en vez de un motor de búsqueda como OpenSearch o una base vectorial, búsqueda exacta con numpy en vez de un índice aproximado como HNSW, un servidor HTTP chiquito en vez de la API de búsqueda, una Mac sin GPU en vez de un job de embeddings con GPU), dilo en una línea.
- Nunca inventes salidas: si no corriste algo, di que no lo corriste.
- El entorno virtual va activo en cada comando: `source .venv/bin/activate`.
- Antes de correr algo que cambia `indices/`, `cache/` o el almacén (`pipeline/construir.py`, `pipeline/alias.py cambiar|volver`, `pipeline/prueba.py`, `mundo/noche.py`, `mundo/crear.py`, `mundo/reiniciar.py`, `romper.py`), dilo. Lo que solo lee (`verificar.py`, `pipeline/embeber.py "…"`, `pipeline/bm25.py "…"`, `pipeline/buscar.py`, `pipeline/construir.py --revisar`, `pipeline/alias.py listar`, `mundo/evaluar.py`, `mundo/modelos.py --listar`, `curl http://localhost:8150/…`) se puede correr directo.
- `mundo/servicio.py` y `mundo/trafico.py` corren en otra terminal (o en segundo plano): no los dejes colgados al terminar.
- Un índice listo nunca se arregla editándolo en `indices/`: se arregla la entrada, la configuración o el código, y se construye uno nuevo al lado.
- Sigue el prompt de la ronda que te pegaron: en Construir solo y en Romper solo **no das código ni pistas** salvo que la persona se rinda.

## Bitácora

Al terminar cada paso, objetivo o falla, agrega una entrada en los dos archivos:

`BITACORA.md`, legible en el celular:

```markdown
## 2026-11-27 10:42 · Construir con ayuda · paso 3 (BM25)
- **Hice:** …
- **Medí:** … (números reales que salieron)
- **Sigue:** …
```

`taller/progreso.json`, el que se importa en «Tu tablero» del Dojo (la página /tablero/ de la app). Agrega a `bitacora` y actualiza `rondas`:

```json
{
  "estacion": "rag-indice",
  "rondas": {
    "guiado":       { "estado": "en_curso", "inicio": "2026-11-27T10:05:12-06:00", "fin": null },
    "solo":         { "estado": "pendiente", "inicio": null, "fin": null, "pistas": 0 },
    "romper_ayuda": { "estado": "pendiente", "fallas": [] },
    "romper_solo":  { "estado": "pendiente", "fallas": [] }
  },
  "bitacora": [
    { "fecha": "2026-11-27T10:42:30-06:00", "ronda": "guiado", "paso": "bm25", "hice": "…", "medi": "…", "sigue": "…" }
  ],
  "verificaciones": [
    { "fecha": "2026-11-27T10:41:02-06:00", "pasan": ["mundo", "embeddings"], "fallan": [] }
  ]
}
```

- `estado` es `pendiente`, `en_curso` o `hecha`. En el tablero, `guiado` se llama «Construir con ayuda», `solo` «Construir solo», `romper_ayuda` «Romper con ayuda» y `romper_solo` «Romper solo».
- **Fecha y hora en cada avance**, en ISO 8601 con la zona de la Mac: sácala con `date -Iseconds`. Nunca solo la fecha.
- `verificaciones` la escribe `verificar.py` solo, en cada corrida. No la edites.
- Cada falla la anota `romper.py` al cerrarla (`--verificar` o `--revelar`), con el tiempo real. Tú solo completas `pistas` y `aprendi` en esa misma entrada (la última de su ronda); no agregues otra.
- Mantén el JSON válido: después de editarlo, corre `python -m json.tool taller/progreso.json > /dev/null`.
