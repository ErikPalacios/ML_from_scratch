# Dojo de entrenamiento ML engineer's · RAG · Estación 3: Permisos en cada chunk

Este es un mini-proyecto de práctica. Reproduce en pequeño, en una Mac sin GPU, sin Docker y sin nube, la estación «Permisos en cada chunk» del caso C11 (un asistente interno que contesta con los documentos de la empresa, cita sus fuentes y respeta los permisos de cada persona): la ACL dentro de cada chunk, un filtro de permisos que corre antes de que un chunk llegue al prompt, una prueba de que nadie recibe un chunk ajeno y un carril rápido que aplica cada revocación en ≤ 5 min. La persona con la que trabajas está aprendiendo; tu trabajo es que **entienda**, no que termine rápido.

## Qué es cada cosa

| Carpeta o archivo | Qué es | ¿Se toca? |
|---|---|---|
| `mundo/` | `entrada/` (los chunks que dejó la estación 2, el directorio y los eventos de la mañana), `crear.py`, `avanzar.py` (la mañana del 21, de 9:00 a 10:30), `referencia.py` (la verdad que usa `verificar.py`), `reiniciar.py` y el esqueleto. | **No.** `crear.py --rechunkear` y `crear.py --suscribir` sí se usan para reparar: hacen del chunking de la estación 2 corrido otra vez y de renovar las suscripciones a los avisos. |
| `almacen/` | La entrada: `docs/<doc>.json`, `directorio.json`, `eventos.jsonl` (la cola), `suscripciones.json` (de qué fuentes llegan avisos), `mundo.json` (el reloj) y `manana.json` (lo que midió el mundo en la mañana). | No: lo escribe el mundo. |
| `pipeline/directorio.py`, `permisos.py`, `indexar.py`, `buscar.py`, `revocar.py` | El pipeline de la persona. Cada archivo trae su contrato arriba. | **Sí.** Es lo que la persona escribe. |
| `pipeline/_comun.py` | Lo que comparten los pasos, con el buscador de juguete (`puntaje`). | No. |
| `config.yaml` | Profundidad de grupos, `sin_acl`, top-k y filtro, periodo del carril rápido. | Solo cuando un paso o un arreglo lo pide. |
| `indice/` | Lo que produce el pipeline. | No a mano: lo escriben `pipeline/indexar.py` y `pipeline/revocar.py`. |
| `verificar.py` | Revisa los criterios de «listo», uno por check. | No. |
| `romper.py` | Mete fallas en la configuración, en el almacén o en los archivos de estado de `indice/`. Nunca en `pipeline/`. | No. Y no leas su código para adivinar una falla escondida. Tampoco leas `mundo/referencia.py` para resolver un paso: es la respuesta del equipo. |
| `GUION.md` / `OBJETIVOS.md` | El paso a paso (ronda Construir con ayuda) y solo los objetivos (ronda Construir solo). | No. |
| `taller/progreso.json`, `BITACORA.md` | El registro de las rondas. | Sí, tú los mantienes (ver abajo). |
| `taller/registro.py` | Lo usan `verificar.py` y `romper.py` para anotar sus corridas y las fallas cerradas. | No. |

## Cómo se trabaja

- Responde en español neutro, de tú, directo y sin relleno. Términos técnicos en inglés la primera vez, con su explicación y una analogía.
- Explica siempre el **por qué**. Cuando algo en el dojo es distinto de C11 real (105 documentos en vez de 1.5 M, 14 personas en vez de miles, un buscador de juguete en vez de BM25 y vectores, un reloj simulado en vez de un worker que corre solo, una carpeta en vez de un índice vectorial), dilo en una línea.
- Nunca inventes salidas: si no corriste algo, di que no lo corriste.
- El entorno virtual va activo en cada comando: `source .venv/bin/activate`.
- Antes de correr algo que cambia el almacén o el índice (`pipeline/indexar.py`, `pipeline/revocar.py`, `mundo/avanzar.py`, `mundo/crear.py`, `mundo/reiniciar.py`, `romper.py`), dilo. Lo que solo lee (`verificar.py`, `pipeline/buscar.py`, leer `almacen/` o `indice/`) se puede correr directo.
- Un permiso nunca se «arregla» editando `indice/` a mano: se arregla la entrada, la configuración o el código, y se vuelve a correr.
- Sigue el prompt de la ronda que te pegaron: en Construir solo y en Romper solo **no das código ni pistas** salvo que la persona se rinda.

## Bitácora

Al terminar cada paso, objetivo o falla, agrega una entrada en los dos archivos:

`BITACORA.md`, legible en el celular:

```markdown
## 2026-11-27 10:42 · Construir con ayuda · paso 4 (filtro)
- **Hice:** …
- **Medí:** … (números reales que salieron)
- **Sigue:** …
```

`taller/progreso.json`, el que se importa en «Tu tablero» del Dojo (la página /tablero/ de la app). Agrega a `bitacora` y actualiza `rondas`:

```json
{
  "estacion": "rag-permisos",
  "rondas": {
    "guiado":       { "estado": "en_curso", "inicio": "2026-11-27T10:05:12-06:00", "fin": null },
    "solo":         { "estado": "pendiente", "inicio": null, "fin": null, "pistas": 0 },
    "romper_ayuda": { "estado": "pendiente", "fallas": [] },
    "romper_solo":  { "estado": "pendiente", "fallas": [] }
  },
  "bitacora": [
    { "fecha": "2026-11-27T10:42:30-06:00", "ronda": "guiado", "paso": "filtro", "hice": "…", "medi": "…", "sigue": "…" }
  ],
  "verificaciones": [
    { "fecha": "2026-11-27T10:41:02-06:00", "pasan": ["mundo", "principals"], "fallan": [] }
  ]
}
```

- `estado` es `pendiente`, `en_curso` o `hecha`. En el tablero, `guiado` se llama «Construir con ayuda», `solo` «Construir solo», `romper_ayuda` «Romper con ayuda» y `romper_solo` «Romper solo».
- **Fecha y hora en cada avance**, en ISO 8601 con la zona de la Mac: sácala con `date -Iseconds`. Nunca solo la fecha.
- `verificaciones` la escribe `verificar.py` solo, en cada corrida. No la edites.
- Cada falla la anota `romper.py` al cerrarla (`--verificar` o `--revelar`), con el tiempo real. Tú solo completas `pistas` y `aprendi` en esa misma entrada (la última de su ronda); no agregues otra.
- Mantén el JSON válido: después de editarlo, corre `python -m json.tool taller/progreso.json > /dev/null`.
