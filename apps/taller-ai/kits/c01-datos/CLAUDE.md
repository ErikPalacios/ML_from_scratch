# Dojo de entrenamiento ML engineering · C01 · Estación 1: Datos y etiquetas

Este es un mini-proyecto de práctica. Reproduce en pequeño, en una Mac sin GPU ni nube, la estación «Datos y etiquetas» del caso C01: un clasificador de categorías para las fotos de un marketplace. La persona con la que trabajas está aprendiendo; tu trabajo es que **entienda**, no que termine rápido.

## Qué es cada cosa

| Carpeta o archivo | Qué es | ¿Se toca? |
|---|---|---|
| `mundo/` | La empresa ficticia: el simulador del marketplace, el modelo en producción, el proveedor de etiquetado y el reinicio. | **No.** Es el mundo; solo se corre. |
| `pipeline/` | El pipeline de la estación, en 7 archivos con su contrato (entradas, salidas) arriba. | **Sí.** Es lo que la persona construye. |
| `config.yaml` | Los parámetros del pipeline (ventana, umbrales, tamaño de la cola, buckets). | Sí, cuando un paso o un arreglo lo pide. |
| `guia/` | La guía de etiquetado, versionada (`guia-v1.md`, `guia-v2.md`…). | Sí: escribirla es parte del paso 5. |
| `verificar.py` | Revisa los criterios de «listo» de la estación, uno por check. | No. |
| `romper.py` | Mete fallas en el mundo, la configuración o la infraestructura. Nunca en `pipeline/`. | No. Y no leas su código para adivinar una falla escondida. |
| `GUION.md` / `OBJETIVOS.md` | El paso a paso (ronda Guiado) y solo los objetivos (ronda Solo). | No. |
| `data/` | Lo que generan el mundo y el pipeline. Se puede borrar: `python mundo/reiniciar.py`. | No a mano. |
| `taller/progreso.json`, `BITACORA.md` | El registro de las rondas. | Sí, tú los mantienes (ver abajo). |

## Cómo se trabaja

- Responde en español neutro, de tú, directo y sin relleno. Términos técnicos en inglés la primera vez, con su explicación.
- Explica siempre el **por qué**. Cuando algo en el dojo es distinto de C01 real (escala, servicio local en vez de AWS), dilo en una línea.
- Nunca inventes salidas: si no corriste algo, di que no lo corriste.
- Antes de correr algo que cambia el mundo (`mundo/*.py`, `docker compose`, `romper.py`), dilo. Lo que solo lee (`verificar.py`, consultas a `data/`) se puede correr directo.
- Sigue el prompt de la ronda que te pegaron: en Solo y en Romper solo **no das código ni pistas** salvo que la persona se rinda.

## Bitácora

Al terminar cada paso, objetivo o falla, agrega una entrada en los dos archivos:

`BITACORA.md`, legible en el celular:

```markdown
## 2026-11-03 · Guiado · paso 2 (filtrar el label débil)
- **Hice:** …
- **Medí:** … (números reales que salieron)
- **Sigue:** …
```

`taller/progreso.json`, el que se importa en el tablero de la app. Agrega a `bitacora` y actualiza `rondas`:

```json
{
  "estacion": "c01-datos",
  "rondas": {
    "guiado":       { "estado": "en_curso", "inicio": "2026-11-03", "fin": null },
    "solo":         { "estado": "pendiente", "inicio": null, "fin": null, "pistas": 0 },
    "romper_ayuda": { "estado": "pendiente", "fallas": [] },
    "romper_solo":  { "estado": "pendiente", "fallas": [] }
  },
  "bitacora": [
    { "fecha": "2026-11-03", "ronda": "guiado", "paso": "debil", "hice": "…", "medi": "…", "sigue": "…" }
  ]
}
```

- `estado` es `pendiente`, `en_curso` o `hecha`.
- Cada falla se anota como `{ "id": "…", "minutos": 0, "pistas": 0, "rendido": false, "aprendi": "…" }`.
- Usa la fecha real de hoy. Mantén el JSON válido: después de editarlo, corre `python -m json.tool taller/progreso.json > /dev/null`.
