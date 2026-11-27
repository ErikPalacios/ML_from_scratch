# Dojo · IA Privada · Estación 1: Un modelo local por API

Un mini-proyecto para practicar la primera estación de IA Privada en tu Mac: levantar un **modelo open weight** chico (Qwen3-0.6B en Q8_0, de un commit fijo de Hugging Face y con su sha256) con **llama-server** de llama.cpp, detrás de una **API compatible con OpenAI**, con su **clave**, su **contexto** y su **plantilla de chat** bien puestos, y escribir el **cliente** que la usa: chat, **streaming** con su TTFT, conteo de **tokens**, errores claros (sin servidor, sin permiso, contexto excedido) y **JSON con citas** que se pueden validar. Lo construyes con Claude, lo rehaces tú solo, lo rompes con ayuda y lo rompes solo.

La guía completa (conceptos, paso a paso, fallas y los prompts de cada ronda) está en el Dojo: https://dojo.trueml.app/ia-privada/modelo-local/

## Arranque

```bash
brew install llama.cpp           # llama-server 1.1.0 o más nuevo
python3 mundo/modelos.py         # una vez: ≈ 805 MB de Hugging Face, con su sha256
python3 verificar.py mundo
```

Sin Docker, sin GPU, sin entorno virtual (solo la biblioteca estándar de Python) y sin internet después de bajar el modelo. Después abre Claude Code en esta carpeta y pega el prompt de la ronda en la que vas.

## Qué hay aquí

| | |
|---|---|
| `mundo/` | El catálogo del modelo y lo que lo baja (`modelos.json`, `modelos.py`), lo que arranca y para tu servidor (`servidor.py`), los fragmentos ficticios de un contrato para las citas (`entrada/`), `reiniciar.py` y el esqueleto. No se toca. |
| `modelo/` | El GGUF del modelo. Lo escribe `mundo/modelos.py`. |
| `servidor.env` y `servir.sh` | Cómo se sirve el modelo, y el comando que lo arranca. Los escribes tú. |
| `pipeline/llm.py` | Tu cliente de la API, con su contrato arriba. `preguntar.py` y `citar.py` lo usan desde la terminal. |
| `verificar.py` / `romper.py` | Los 10 checks de la estación y las 6 fallas. |
| `GUION.md` / `OBJETIVOS.md` | El paso a paso de la ronda Construir con ayuda y solo los objetivos para Construir solo. |
| `CLAUDE.md` | Las reglas para Claude Code en este proyecto. |
| `BITACORA.md`, `taller/progreso.json` | Tu registro. `verificar.py` y `romper.py` anotan solos en `progreso.json`; impórtalo en «Tu tablero» del Dojo: https://dojo.trueml.app/tablero/ |

Para empezar la ronda Construir solo desde el esqueleto: `python3 mundo/reiniciar.py`.

## Créditos

Todo el contenido es ficticio: el despacho y el contrato. El modelo es [Qwen/Qwen3-0.6B](https://huggingface.co/Qwen/Qwen3-0.6B) (Apache-2.0), en la conversión a GGUF de [ggml-org/Qwen3-0.6B-GGUF](https://huggingface.co/ggml-org/Qwen3-0.6B-GGUF). El servidor es [llama.cpp](https://github.com/ggml-org/llama.cpp) (MIT).
