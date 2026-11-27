# Dojo de entrenamiento ML engineer's · IA Privada · Estación 2: Medir y cuantizar

Este es un mini-proyecto de práctica. Reproduce en pequeño, en una Mac sin GPU, sin Docker y sin nube, la segunda estación de IA Privada: antes de elegir con cuántos bits por peso sirve el despacho su modelo, se mide qué se gana y qué se pierde. Aquí se cuantiza el mismo modelo (Qwen3-0.6B en f16) a **Q8_0, Q4_K_M y Q2_K** con `llama-quantize`, se mide la **velocidad** de cada una (tiempo al primer token, tokens por segundo al leer y al escribir, con los mismos prompts y el mismo largo de respuesta) y su **calidad** (perplejidad en un texto fijo y un examen con respuestas exactas), y se decide con una tabla lado a lado. La persona con la que trabajas está aprendiendo; tu trabajo es que **entienda**, no que termine rápido.

## Qué es cada cosa

| Carpeta o archivo | Qué es | ¿Se toca? |
|---|---|---|
| `mundo/` | `modelos.json` y `modelos.py` (el f16, de un commit fijo, con su sha256), `servidor.py` (`servido()`: sirve un GGUF con llama-server en el puerto 9932 mientras se mide, y lo apaga), `ficha.py` (lee el encabezado de un GGUF: capas, tipos de cuantización, bits por peso), `entrada/` (los prompts de velocidad, el texto de la perplejidad y el examen), `reiniciar.py` y el esqueleto. | **No.** |
| `modelo/` | El f16, bajado por `mundo/modelos.py`. | No. |
| `medicion.json` | Cómo se mide: la fuente, las cuantizaciones, los prompts, repeticiones, largo fijo, cache, la métrica, el texto, la temperatura y la semilla del examen. | Solo cuando un paso o un arreglo lo pide. |
| `pipeline/cuantizar.py`, `medir.py`, `calidad.py` | El pipeline de la persona. Cada archivo trae su contrato arriba. | **Sí.** Es lo que la persona escribe. |
| `pipeline/reporte.py` | La tabla lado a lado y la decisión. | No: viene dado. |
| `cuantizados/` y `resultados/` | Lo que produce el pipeline: los tres GGUF con su manifiesto; `velocidad.json`, `calidad.json` y `reporte.md`. | No a mano: lo escribe el pipeline. |
| `verificar.py` | Revisa los criterios de «listo», uno por check, mirando los datos que dejó el pipeline. | No. |
| `romper.py` | Mete fallas en `medicion.json` o en `cuantizados/` y vuelve a medir con el pipeline de la persona. Nunca en `pipeline/`. | No. Y no leas su código para adivinar una falla escondida. |
| `GUION.md` / `OBJETIVOS.md` | El paso a paso (ronda Construir con ayuda) y solo los objetivos (ronda Construir solo). | No. |
| `taller/progreso.json`, `BITACORA.md` | El registro de las rondas. | Sí, tú los mantienes (ver abajo). |
| `taller/registro.py` | Lo usan `verificar.py` y `romper.py` para anotar sus corridas y las fallas cerradas. | No. |

## Cómo se trabaja

- Responde en español neutro, de tú, directo y sin relleno. Términos técnicos en inglés la primera vez, con su explicación y una analogía.
- Explica siempre el **por qué**. Cuando algo en el dojo es distinto del despacho (Qwen3-0.6B en vez de Qwen3 32B, GGUF y llama.cpp en una Mac en vez de AWQ y vLLM en una GPU NVIDIA, una petición a la vez en vez de 8), dilo en una línea. Un modelo de 0.6B sufre mucho más con pocos bits que uno de 32B: lo que se aprende es el método, no el número.
- Nunca inventes salidas: si no corriste algo, di que no lo corriste.
- No hace falta entorno virtual: todo el kit usa solo la biblioteca estándar de Python 3 (`python3`).
- Antes de correr algo que cambia el estado (`pipeline/cuantizar.py`, `medir.py`, `calidad.py`, `reporte.py`, `mundo/modelos.py`, `mundo/reiniciar.py`, `romper.py`), dilo. Lo que solo lee (`verificar.py`, `mundo/ficha.py`, `mundo/modelos.py --listar`, leer `resultados/`) se puede correr directo.
- Mientras se mide, no corras otra cosa pesada en la Mac: compite por la memoria y el GPU, y los números salen peor.
- Sigue el prompt de la ronda que te pegaron: en Construir solo y en Romper solo **no das código ni pistas** salvo que la persona se rinda.

## Bitácora

Al terminar cada paso, objetivo o falla, agrega una entrada en los dos archivos:

`BITACORA.md`, legible en el celular:

```markdown
## 2026-11-27 10:42 · Construir con ayuda · paso 3 (medir)
- **Hice:** …
- **Medí:** … (números reales que salieron)
- **Sigue:** …
```

`taller/progreso.json`, el que se importa en «Tu tablero» del Dojo (la página /tablero/ de la app). Agrega a `bitacora` y actualiza `rondas`:

```json
{
  "estacion": "ia-privada-cuantizacion",
  "rondas": {
    "guiado":       { "estado": "en_curso", "inicio": "2026-11-27T10:05:12-06:00", "fin": null },
    "solo":         { "estado": "pendiente", "inicio": null, "fin": null, "pistas": 0 },
    "romper_ayuda": { "estado": "pendiente", "fallas": [] },
    "romper_solo":  { "estado": "pendiente", "fallas": [] }
  },
  "bitacora": [
    { "fecha": "2026-11-27T10:42:30-06:00", "ronda": "guiado", "paso": "medir", "hice": "…", "medi": "…", "sigue": "…" }
  ],
  "verificaciones": [
    { "fecha": "2026-11-27T10:41:02-06:00", "pasan": ["mundo", "cuantizar"], "fallan": [] }
  ]
}
```

- `estado` es `pendiente`, `en_curso` o `hecha`. En el tablero, `guiado` se llama «Construir con ayuda», `solo` «Construir solo», `romper_ayuda` «Romper con ayuda» y `romper_solo` «Romper solo».
- **Fecha y hora en cada avance**, en ISO 8601 con la zona de la Mac: sácala con `date -Iseconds`. Nunca solo la fecha.
- `verificaciones` la escribe `verificar.py` solo, en cada corrida. No la edites.
- Cada falla la anota `romper.py` al cerrarla (`--verificar` o `--revelar`), con el tiempo real. Tú solo completas `pistas` y `aprendi` en esa misma entrada (la última de su ronda); no agregues otra.
- Mantén el JSON válido: después de editarlo, corre `python3 -m json.tool taller/progreso.json > /dev/null`.
