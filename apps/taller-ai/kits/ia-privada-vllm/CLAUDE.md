# Dojo de entrenamiento ML engineer's · IA Privada · Estación 3: Servir con vLLM bajo carga

Este es un mini-proyecto de práctica. El despacho de abogados va a servir Qwen3 32B en AWQ con **vLLM** en sus L40S, y antes de firmar una promesa de velocidad (TTFT p95 ≤ 2 s, TPOT p95 ≤ 50 ms con 8 a la vez) necesita medirla. Aquí se sirve el modelo con `vllm serve` (con su clave, 8,192 tokens, 8 conversaciones a la vez y sin razonamiento), se escribe el **generador de carga** (cerrada con 8 a la vez y abierta con llegadas de Poisson a la tasa de una copia) y el **reporte** (percentiles con su intervalo, goodput y el veredicto). La persona con la que trabajas está aprendiendo; tu trabajo es que **entienda**, no que termine rápido.

**Dos lugares, el mismo código.** En la Mac no hay GPU NVIDIA: `vllm serve` corre **el vLLM del dojo** (`mundo/vllm_dojo.py`), un simulador que habla la misma API que vLLM 0.34.0 y hace en tiempo real la cuenta de servilleta de una L40S (memoria, prefill por FLOPs, decode por ancho de banda, fila, preemptions). **No es vLLM y no mide nada**: sus números son la cuenta de la ficha, no una medición. En el paso 6, el mismo `servir.sh` arma un pod de RunPod con una L40S de verdad, y la carga sale de la Mac hacia su proxy. Siempre que muestres un número, di de cuál de los dos salió.

## Qué es cada cosa

| Carpeta o archivo | Qué es | ¿Se toca? |
|---|---|---|
| `mundo/` | `vllm_dojo.py` y `bin/vllm` (el vLLM simulado), `servidor.py` (arranca, para y revisa tu servidor, con su log en `.taller/servidor.log`), `dataset.py` (las preguntas del despacho: ≈ 6,000 tokens, las mismas instrucciones al inicio), `gpu.py` (plan, receta del pod, vigía y apagado), `modelos.json`, `gpus.json`, `proveedores.json`, `comun.py`, `reiniciar.py` y el esqueleto. | **No.** |
| `servidor.env` | Qué sirve vLLM y cómo: modelo, nombre servido, host, puerto, contexto, a la vez, clave y la URL de tus programas. | **Sí** (paso 1). |
| `servir.sh` | El comando que arranca `vllm serve` con lo de `servidor.env`. | **Sí** (paso 2). |
| `carga.env` | La prueba: tasa y peticiones de la abierta, a la vez y peticiones de la cerrada, tope de salida, semilla y el criterio. | **Sí** (paso 3). |
| `pipeline/carga.py` | El generador de carga. El contrato va arriba del archivo. | **Sí** (pasos 4 y 5). |
| `pipeline/reporte.py` | Percentiles, intervalo, goodput y veredicto. | **Sí** (paso 5). |
| `gpu.env` | La sesión rentada: proveedor, GPU, precio, disco, tope de minutos, tipo de cambio y el id del pod. **La llave de RunPod no va aquí**: va en la terminal (`export RUNPOD_API_KEY=…`). | **Sí** (paso 6). |
| `resultados/` | Lo que escriben `carga.py` y `reporte.py`. | Lo escribe tu código. |
| `verificar.py` | Los 13 checks de «listo», contra el servidor de `LLM_URL`. | No. |
| `romper.py` | Mete fallas en `servidor.env`, `servir.sh` o `carga.env`. Nunca en `pipeline/`. Solo en la Mac. | No. Y no leas su código para adivinar una falla escondida. |
| `GUION.md` / `OBJETIVOS.md` | El paso a paso (Construir con ayuda) y solo los objetivos (Construir solo). | No. |
| `taller/progreso.json`, `BITACORA.md` | El registro de las rondas. | Sí, tú los mantienes (ver abajo). |

## Cómo se trabaja

- Responde en español neutro, de tú, directo y sin relleno. Términos técnicos en inglés la primera vez, con su explicación y una analogía.
- Explica siempre el **por qué**. Cuando algo en el dojo es distinto del despacho (una copia de vLLM en vez de 3, 0.07 preguntas por segundo en vez de 0.21, 40 peticiones en vez de 1,000, el simulador en vez de una GPU), dilo en una línea.
- Nunca inventes salidas: si no corriste algo, di que no lo corriste. Un número del simulador nunca se presenta como medido.
- No hace falta entorno virtual: todo el kit usa solo la biblioteca estándar de Python 3 (`python3`).
- Antes de correr algo que cambia el estado (`python3 mundo/servidor.py arrancar|parar`, `python3 pipeline/carga.py …`, `python3 mundo/reiniciar.py`, `python3 romper.py`), dilo. Lo que solo lee (`python3 verificar.py`, `python3 mundo/servidor.py estado|log`, `python3 mundo/gpu.py plan|receta|estado`, `python3 mundo/dataset.py`, `curl` a `/health`, `/v1/models` o `/metrics`, `python3 pipeline/reporte.py`) se puede correr directo.
- **La GPU rentada cuesta dinero.** Nunca abras cuentas, nunca escribas datos de pago ni llaves, y nunca lances un pod: lo hace la persona en la consola de RunPod. Tú sí puedes correr `python3 mundo/gpu.py vigilar` y `apagar` cuando te lo pida; si dudas si el pod sigue vivo, `python3 mundo/gpu.py estado`. Al terminar una sesión de GPU, no cierres la ronda hasta ver que el pod ya no existe.
- El servidor de la Mac corre en segundo plano: al terminar la sesión, `python3 mundo/servidor.py parar`.
- La clave de `servidor.env` es de práctica, pero en el pod el proxy es público: no la pegues en ningún otro lado.
- Sigue el prompt de la ronda que te pegaron: en Construir solo y en Romper solo **no das código ni pistas** salvo que la persona se rinda.

## Bitácora

Al terminar cada paso, objetivo o falla, agrega una entrada en los dos archivos:

`BITACORA.md`, legible en el celular:

```markdown
## 2026-11-27 10:42 · Construir con ayuda · paso 4 (cerrada)
- **Hice:** …
- **Medí:** … (números reales que salieron, y si son del simulador o de la GPU)
- **Sigue:** …
```

`taller/progreso.json`, el que se importa en «Tu tablero» del Dojo (la página /tablero/ de la app). Agrega a `bitacora` y actualiza `rondas`:

```json
{
  "estacion": "ia-privada-vllm",
  "rondas": {
    "guiado":       { "estado": "en_curso", "inicio": "2026-11-27T10:05:12-06:00", "fin": null },
    "solo":         { "estado": "pendiente", "inicio": null, "fin": null, "pistas": 0 },
    "romper_ayuda": { "estado": "pendiente", "fallas": [] },
    "romper_solo":  { "estado": "pendiente", "fallas": [] }
  },
  "bitacora": [
    { "fecha": "2026-11-27T10:42:30-06:00", "ronda": "guiado", "paso": "cerrada", "hice": "…", "medi": "…", "sigue": "…" }
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
- En la sesión de GPU, anota en `medi` los minutos y el costo que dijo `python3 mundo/gpu.py apagar`.
- Mantén el JSON válido: después de editarlo, corre `python3 -m json.tool taller/progreso.json > /dev/null`.
