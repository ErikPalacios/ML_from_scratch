# Dojo de entrenamiento ML engineer's · RAG · Estación 6: Retrieval y reranker

Este es un mini-proyecto de práctica. Reproduce en pequeño, en una Mac sin GPU, sin Docker y sin nube, la estación «Retrieval y reranker» del caso C11 (un asistente interno que contesta con los documentos de la empresa, cita sus fuentes y respeta los permisos de cada persona): pedirle candidatos a los dos índices de la estación 5 (BM25 y vectores) con los permisos como filtro, juntarlos con RRF (Reciprocal Rank Fusion), dejar que un reranker local (un cross-encoder chico) reordene los mejores y entregar el top-8 que la estación 7 le pone al LLM; y medirlo con el golden set de la estación 4, por tipo de pregunta, en cuatro modos lado a lado, con lo que tarda el reranker. La persona con la que trabajas está aprendiendo; tu trabajo es que **entienda**, no que termine rápido.

## Qué es cada cosa

| Carpeta o archivo | Qué es | ¿Se toca? |
|---|---|---|
| `mundo/` | `entrada/` (el corpus del 22, el directorio y el golden set de la estación 4, en `registro-golden/`), `modelos.json` (el catálogo: repositorio, revisión y sha256 de e5 y del reranker), `modelos.py` (los baja), `crear.py` (copia la entrada y construye el índice de la estación 5 con su propio código), `referencia.py` (la verdad que usan `verificar.py` y `romper.py`), `reiniciar.py` y el esqueleto. | **No.** `crear.py --golden` sí se usa para reparar. |
| `almacen/` | La entrada: `corpus/vigente.json`, `directorio.json`, `golden/` y `mundo.json` (el reloj). | No: lo escribe el mundo. |
| `modelo/` | Los archivos de los dos modelos (`e5` y `reranker`), bajados por `mundo/modelos.py`. | No. |
| `pipeline/fusion.py`, `recuperar.py`, `reranker.py`, `medir.py` | El pipeline de la persona. Cada archivo trae su contrato arriba. | **Sí.** Es lo que la persona escribe. |
| `pipeline/embeber.py`, `bm25.py`, `vectores.py`, `construir.py`, `alias.py`, `buscar.py`, `prueba.py` | Lo de la estación 5, ya hecho: el `Buscador` con `.bm25()` y `.vectores()`, cada uno con el filtro de permisos antes del top. | No. |
| `pipeline/_comun.py` | Lo que comparten los pasos: rutas, lectura y escritura de un jalón, el catálogo, `palabras()` y lo de la estación 3 (`principals`, `puede_ver`). | No. |
| `config.yaml` | Lo de la estación 5 y, en `retrieval`, `reranker` y `medicion`, todo lo de esta: candidatos por índice, filtro, fusión, `rrf_k`, `rerank_n`, `k`, y con qué split se mide y con cuál se afina. | Solo cuando un paso o un arreglo lo pide. |
| `indices/` | El índice de la estación 5 detrás del alias `c11`; ahí mismo `medir.py` guarda `retrieval.json` (el reporte) y `afinado.json`. | No a mano. |
| `verificar.py` | Revisa los criterios de «listo», uno por check. | No. |
| `romper.py` | Mete fallas en `config.yaml` o en el reporte. Nunca en `pipeline/`. | No. Y no leas su código para adivinar una falla escondida. Tampoco leas `mundo/referencia.py` para resolver un paso: es la respuesta del equipo. |
| `GUION.md` / `OBJETIVOS.md` | El paso a paso (ronda Construir con ayuda) y solo los objetivos (ronda Construir solo). | No. |
| `taller/progreso.json`, `BITACORA.md` | El registro de las rondas. | Sí, tú los mantienes (ver abajo). |
| `taller/registro.py` | Lo usan `verificar.py` y `romper.py` para anotar sus corridas y las fallas cerradas. | No. |

## Cómo se trabaja

- Responde en español neutro, de tú, directo y sin relleno. Términos técnicos en inglés la primera vez, con su explicación y una analogía.
- Explica siempre el **por qué**. Cuando algo en el dojo es distinto de C11 real (151 chunks en vez de ≈ 7.5 M, búsqueda exacta con numpy en vez de un motor de búsqueda con índice aproximado, el reranker cuantizado a int8 en el CPU de la Mac en vez de un servicio con GPU, 37 preguntas de test en vez de ≈ 600), dilo en una línea.
- Nunca inventes salidas: si no corriste algo, di que no lo corriste.
- El entorno virtual va activo en cada comando: `source .venv/bin/activate`.
- Antes de correr algo que cambia `indices/` o el almacén (`pipeline/medir.py`, `mundo/crear.py`, `mundo/reiniciar.py`, `romper.py`), dilo. Lo que solo lee (`verificar.py`, `pipeline/fusion.py`, `pipeline/reranker.py "…"`, `pipeline/recuperar.py`, `pipeline/buscar.py`, `mundo/modelos.py --listar`) se puede correr directo.
- El número que se reporta sale de `test`; `dev` es para afinar. Nunca al revés, y nunca se cambia `config.yaml` para que un número «salga mejor» sin decirlo.
- Sigue el prompt de la ronda que te pegaron: en Construir solo y en Romper solo **no das código ni pistas** salvo que la persona se rinda.

## Bitácora

Al terminar cada paso, objetivo o falla, agrega una entrada en los dos archivos:

`BITACORA.md`, legible en el celular:

```markdown
## 2026-11-27 10:42 · Construir con ayuda · paso 1 (fusión RRF)
- **Hice:** …
- **Medí:** … (números reales que salieron)
- **Sigue:** …
```

`taller/progreso.json`, el que se importa en «Tu tablero» del Dojo (la página /tablero/ de la app). Agrega a `bitacora` y actualiza `rondas`:

```json
{
  "estacion": "rag-retrieval",
  "rondas": {
    "guiado":       { "estado": "en_curso", "inicio": "2026-11-27T10:05:12-06:00", "fin": null },
    "solo":         { "estado": "pendiente", "inicio": null, "fin": null, "pistas": 0 },
    "romper_ayuda": { "estado": "pendiente", "fallas": [] },
    "romper_solo":  { "estado": "pendiente", "fallas": [] }
  },
  "bitacora": [
    { "fecha": "2026-11-27T10:42:30-06:00", "ronda": "guiado", "paso": "fusion", "hice": "…", "medi": "…", "sigue": "…" }
  ],
  "verificaciones": [
    { "fecha": "2026-11-27T10:41:02-06:00", "pasan": ["mundo", "fusion"], "fallan": [] }
  ]
}
```

- `estado` es `pendiente`, `en_curso` o `hecha`. En el tablero, `guiado` se llama «Construir con ayuda», `solo` «Construir solo», `romper_ayuda` «Romper con ayuda» y `romper_solo` «Romper solo».
- **Fecha y hora en cada avance**, en ISO 8601 con la zona de la Mac: sácala con `date -Iseconds`. Nunca solo la fecha.
- `verificaciones` la escribe `verificar.py` solo, en cada corrida. No la edites.
- Cada falla la anota `romper.py` al cerrarla (`--verificar` o `--revelar`), con el tiempo real. Tú solo completas `pistas` y `aprendi` en esa misma entrada (la última de su ronda); no agregues otra.
- Mantén el JSON válido: después de editarlo, corre `python -m json.tool taller/progreso.json > /dev/null`.
