# Dojo · RAG · Estación 8: La API con citas

Un mini-proyecto para practicar la octava estación del entrenamiento RAG (caso C11) en tu Mac: la **API** que usa la app de chat de la empresa. `POST /v1/ask` recibe una pregunta, sabe **quién pregunta** por su llave, recupera el **top-8** de la estación 6 con sus permisos, aparta los documentos que traen **instrucciones para el modelo**, arma el **prompt** con los chunks numerados dentro de la **ventana** del modelo, le pide la respuesta al **LLM local** de la estación 7 (Qwen3 0.6B en llama-server) en **streaming** y la manda por **SSE** con cada **cita revisada** contra lo que de verdad recibió esa persona. Sin fuentes suficientes, dice que no sabe. Lo construyes con Claude, lo rehaces tú solo, lo rompes con ayuda y lo rompes solo.

La guía completa (conceptos, paso a paso, fallas y los prompts de cada ronda) está en el Dojo: https://dojo.trueml.app/rag/rag-api/

## Arranque

```bash
brew install llama.cpp                 # llama-server 1.1.0 o más nuevo (estación 7)
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python mundo/modelos.py                # una vez: ≈ 1.4 GB de Hugging Face, cada archivo con su sha256
python mundo/crear.py
python mundo/servidor.py arrancar      # el LLM en 127.0.0.1:9931
python verificar.py mundo
```

Sin Docker, sin GPU y sin internet después de `pip install` y `mundo/modelos.py` (onnxruntime, numpy, tokenizers, pyyaml, fastapi y uvicorn). Después abre Claude Code en esta carpeta y pega el prompt de la ronda en la que vas.

## Qué hay aquí

| | |
|---|---|
| `mundo/` | El corpus del 22 (con un documento envenenado en Drive), el directorio y el golden set (`entrada/`), el catálogo de modelos y lo que los baja, lo que arma el almacén, las llaves y el índice (`crear.py`), y lo que arranca el LLM (`servidor.py`) y tu API (`api.py`). No se toca. |
| `almacen/` y `modelo/` | La entrada, las llaves de cada persona y los tres modelos (e5, el reranker y el LLM). Los escribe el mundo. |
| `servidor.env`, `servir.sh` | Cómo se sirve el LLM: lo de la estación 7. |
| `pipeline/` | Tu código: `prompt.py`, `citas.py`, `guardas.py` y `api.py`. Cada archivo trae arriba su contrato. El retrieval de la estación 6, el cliente del LLM de la estación 7, `sse.py` y `preguntar.py` vienen dados. |
| `config.yaml` | Lo de las estaciones 5 y 6 y, desde `api`, todo lo de esta: la cache, el LLM, el prompt, las citas, el «no sé», las fuentes que se revisan y el presupuesto del primer token. |
| `verificar.py` / `romper.py` | Los 11 checks de la estación y las 6 fallas. |
| `GUION.md` / `OBJETIVOS.md` | El paso a paso de la ronda Construir con ayuda y solo los objetivos para Construir solo. |
| `CLAUDE.md` | Las reglas para Claude Code en este proyecto. |
| `BITACORA.md`, `taller/progreso.json` | Tu registro. `verificar.py` y `romper.py` anotan solos en `progreso.json`; impórtalo en «Tu tablero» del Dojo: https://dojo.trueml.app/tablero/ |

Para empezar la ronda Construir solo desde el esqueleto: `python mundo/reiniciar.py`.

## Créditos

Todo el contenido es ficticio: el marketplace, las personas, los documentos y las preguntas. Los modelos son de sus autores: [intfloat/multilingual-e5-small](https://huggingface.co/intfloat/multilingual-e5-small) (MIT), [cross-encoder/mmarco-mMiniLMv2-L12-H384-v1](https://huggingface.co/cross-encoder/mmarco-mMiniLMv2-L12-H384-v1) (Apache-2.0) y [Qwen/Qwen3-0.6B](https://huggingface.co/Qwen/Qwen3-0.6B) (Apache-2.0), en la conversión a GGUF de [ggml-org/Qwen3-0.6B-GGUF](https://huggingface.co/ggml-org/Qwen3-0.6B-GGUF). El servidor del LLM es [llama.cpp](https://github.com/ggml-org/llama.cpp) (MIT); la API usa [FastAPI](https://fastapi.tiangolo.com) y [uvicorn](https://www.uvicorn.org) (BSD).
