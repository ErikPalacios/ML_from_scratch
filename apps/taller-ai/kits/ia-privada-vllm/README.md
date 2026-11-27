# Dojo · IA Privada · Estación 3: Servir con vLLM bajo carga

Un mini-proyecto para practicar la tercera estación de IA Privada: servir **Qwen3 32B en AWQ** con **vLLM** (con su clave, 8,192 tokens, 8 conversaciones a la vez y sin razonamiento), escribir un **generador de carga** honesto (cerrada con 8 a la vez y abierta con llegadas de Poisson) y un **reporte** con percentiles, su intervalo de confianza, goodput y el veredicto contra el criterio del despacho (TTFT p95 ≤ 2 s, TPOT p95 ≤ 50 ms). Lo construyes con Claude, lo rehaces tú solo, lo rompes con ayuda y lo rompes solo.

La guía completa (conceptos, paso a paso, fallas y los prompts de cada ronda) está en el Dojo: https://dojo.trueml.app/ia-privada/vllm/

## Dónde corre

- **En tu Mac (pasos 0 a 5 y las rondas de romper):** con el **vLLM del dojo**, un simulador que habla la API de vLLM 0.34.0 y hace en tiempo real la cuenta de servilleta de una L40S. No baja el modelo, no usa GPU y no mide nada: sirve para escribir y probar todo tu código gratis.
- **En una GPU rentada (paso 6):** una L40S en RunPod, ≈ 40 minutos, con tope de 90 (≈ US$1.65, ≈ MXN 32 con el tope). `python3 mundo/gpu.py plan` te dice el tiempo y el costo antes de rentar, y `python3 mundo/gpu.py vigilar` la apaga sola al tope.

## Arranque

```bash
python3 verificar.py mundo
```

Sin Docker, sin GPU, sin entorno virtual (solo la biblioteca estándar de Python 3.10+) y sin internet en la Mac. Después abre Claude Code en esta carpeta y pega el prompt de la ronda en la que vas.

## Qué hay aquí

| | |
|---|---|
| `mundo/` | El vLLM del dojo (`vllm_dojo.py`, `bin/vllm`), lo que arranca y para tu servidor (`servidor.py`), las preguntas del despacho (`dataset.py`), la sesión de GPU (`gpu.py`, `proveedores.json`), el modelo y las GPUs (`modelos.json`, `gpus.json`), `reiniciar.py` y el esqueleto. No se toca. |
| `servidor.env` y `servir.sh` | Cómo se sirve el modelo, y el comando que lo arranca. Los escribes tú. |
| `carga.env`, `pipeline/carga.py` y `pipeline/reporte.py` | La prueba de carga, su generador y su reporte. Los escribes tú. |
| `gpu.env` | La sesión en la GPU rentada. La llave de RunPod va en la terminal, nunca aquí. |
| `verificar.py` / `romper.py` | Los 13 checks de la estación y las 6 fallas. |
| `GUION.md` / `OBJETIVOS.md` | El paso a paso de la ronda Construir con ayuda y solo los objetivos para Construir solo. |
| `CLAUDE.md` | Las reglas para Claude Code en este proyecto. |
| `BITACORA.md`, `taller/progreso.json` | Tu registro. Impórtalo en «Tu tablero» del Dojo: https://dojo.trueml.app/tablero/ |

Para empezar la ronda Construir solo desde el esqueleto: `python3 mundo/reiniciar.py`.

## Créditos

Todo el contenido es ficticio: el despacho, los expedientes y los contratos. El modelo es [Qwen/Qwen3-32B-AWQ](https://huggingface.co/Qwen/Qwen3-32B-AWQ) (Apache-2.0). El servidor es [vLLM](https://github.com/vllm-project/vllm) (Apache-2.0); el vLLM del dojo es un simulador escrito para este kit, que imita su API y sus nombres de métricas.
