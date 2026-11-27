# Dojo de entrenamiento ML engineer's · IA Privada · Estación 1: Un modelo local por API

Este es un mini-proyecto de práctica. Reproduce en pequeño, en una Mac sin GPU, sin Docker y sin nube, la primera estación de IA Privada: el despacho de abogados quiere un LLM que viva en su propio servidor, sin que un documento salga de su red. Aquí se levanta un modelo chico (Qwen3-0.6B, cuantizado a Q8_0) con **llama-server** de llama.cpp, detrás de una API compatible con OpenAI, con su clave, su contexto y su plantilla de chat bien puestos, y se escribe el cliente que la usa: chat, streaming con su TTFT, conteo de tokens, errores claros y JSON con citas validadas. La persona con la que trabajas está aprendiendo; tu trabajo es que **entienda**, no que termine rápido.

## Qué es cada cosa

| Carpeta o archivo | Qué es | ¿Se toca? |
|---|---|---|
| `mundo/` | `modelos.json` (el catálogo: repositorio, commit, tamaño y sha256 del modelo), `modelos.py` (lo baja), `servidor.py` (arranca, para y revisa tu servidor, con su log en `.taller/servidor.log`), `entrada/clausulas.json` (fragmentos ficticios de un contrato, para las citas), `reiniciar.py` y el esqueleto. | **No.** |
| `modelo/` | El archivo GGUF del modelo, bajado por `mundo/modelos.py`. | No. |
| `servidor.env` | Qué sirve llama-server y cómo: modelo, alias, host, puerto, contexto, peticiones a la vez, razonamiento, clave y la URL del cliente. | **Sí** (paso 1). |
| `servir.sh` | El comando que arranca llama-server con lo de `servidor.env`. | **Sí** (paso 2). |
| `pipeline/llm.py` | El cliente de la API: el contrato va arriba del archivo. | **Sí.** Es lo que la persona escribe (pasos 3 a 6). |
| `pipeline/preguntar.py`, `pipeline/citar.py` | Usan el cliente desde la terminal: una pregunta en stream; las preguntas con citas. | No: vienen dados. |
| `verificar.py` | Revisa los criterios de «listo», uno por check, contra el servidor de verdad. | No. |
| `romper.py` | Mete fallas en `servidor.env` o `servir.sh` y reinicia el servidor. Nunca en `pipeline/`. | No. Y no leas su código para adivinar una falla escondida. |
| `GUION.md` / `OBJETIVOS.md` | El paso a paso (ronda Construir con ayuda) y solo los objetivos (ronda Construir solo). | No. |
| `taller/progreso.json`, `BITACORA.md` | El registro de las rondas. | Sí, tú los mantienes (ver abajo). |
| `taller/registro.py` | Lo usan `verificar.py` y `romper.py` para anotar sus corridas y las fallas cerradas. | No. |

## Cómo se trabaja

- Responde en español neutro, de tú, directo y sin relleno. Términos técnicos en inglés la primera vez, con su explicación y una analogía.
- Explica siempre el **por qué**. Cuando algo en el dojo es distinto del despacho (Qwen3-0.6B en Q8_0 en vez de Qwen3 32B en AWQ, llama-server en una Mac en vez de vLLM en una GPU NVIDIA del servidor del despacho, una persona a la vez en vez de varias, 127.0.0.1 en vez de la red interna detrás de un gateway), dilo en una línea.
- Nunca inventes salidas: si no corriste algo, di que no lo corriste.
- No hace falta entorno virtual: todo el kit usa solo la biblioteca estándar de Python 3 (`python3`).
- Antes de correr algo que cambia el estado (`python3 mundo/servidor.py arrancar|parar`, `python3 mundo/modelos.py`, `python3 mundo/reiniciar.py`, `python3 romper.py`), dilo. Lo que solo lee (`python3 verificar.py`, `python3 mundo/servidor.py estado|log`, `python3 mundo/modelos.py --listar`, `curl http://127.0.0.1:9931/…`, `python3 pipeline/preguntar.py`, `python3 pipeline/citar.py`) se puede correr directo.
- El servidor corre en segundo plano (`mundo/servidor.py arrancar`): al terminar la sesión, `python3 mundo/servidor.py parar`.
- La clave de `servidor.env` es de práctica: no la pegues en ningún otro lado.
- Sigue el prompt de la ronda que te pegaron: en Construir solo y en Romper solo **no das código ni pistas** salvo que la persona se rinda.

## Bitácora

Al terminar cada paso, objetivo o falla, agrega una entrada en los dos archivos:

`BITACORA.md`, legible en el celular:

```markdown
## 2026-11-27 10:42 · Construir con ayuda · paso 2 (servir)
- **Hice:** …
- **Medí:** … (números reales que salieron)
- **Sigue:** …
```

`taller/progreso.json`, el que se importa en «Tu tablero» del Dojo (la página /tablero/ de la app). Agrega a `bitacora` y actualiza `rondas`:

```json
{
  "estacion": "ia-privada-modelo-local",
  "rondas": {
    "guiado":       { "estado": "en_curso", "inicio": "2026-11-27T10:05:12-06:00", "fin": null },
    "solo":         { "estado": "pendiente", "inicio": null, "fin": null, "pistas": 0 },
    "romper_ayuda": { "estado": "pendiente", "fallas": [] },
    "romper_solo":  { "estado": "pendiente", "fallas": [] }
  },
  "bitacora": [
    { "fecha": "2026-11-27T10:42:30-06:00", "ronda": "guiado", "paso": "servir", "hice": "…", "medi": "…", "sigue": "…" }
  ],
  "verificaciones": [
    { "fecha": "2026-11-27T10:41:02-06:00", "pasan": ["mundo", "config"], "fallan": [] }
  ]
}
```

- `estado` es `pendiente`, `en_curso` o `hecha`. En el tablero, `guiado` se llama «Construir con ayuda», `solo` «Construir solo», `romper_ayuda` «Romper con ayuda» y `romper_solo` «Romper solo».
- **Fecha y hora en cada avance**, en ISO 8601 con la zona de la Mac: sácala con `date -Iseconds`. Nunca solo la fecha.
- `verificaciones` la escribe `verificar.py` solo, en cada corrida. No la edites.
- Cada falla la anota `romper.py` al cerrarla (`--verificar` o `--revelar`), con el tiempo real. Tú solo completas `pistas` y `aprendi` en esa misma entrada (la última de su ronda); no agregues otra.
- Mantén el JSON válido: después de editarlo, corre `python3 -m json.tool taller/progreso.json > /dev/null`.
