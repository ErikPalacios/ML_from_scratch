# Dojo · RAG · Estación 9: Gate de evals

Un mini-proyecto para practicar la novena estación del entrenamiento RAG (caso C11) en tu Mac: el **gate** que decide si un cambio al asistente puede salir. Corre el **golden set** de la estación 4 contra la **API** de la estación 8, pregunta por pregunta y con la **llave de cada persona**, sin la cache; mide lo que se puede contar (**recall@8**, **fugas de permisos**, **citas**, **«no sé»** y el **primer token**); califica cada respuesta con un **juez** (un LLM más grande que el de la API) que antes se **calibra** contra respuestas que ya calificaron personas (**kappa de Cohen** y **falso pase**); y compara el cambio con la **base vigente** en las mismas preguntas (**prueba pareada** y **no inferioridad**). Si se cuela un chunk ajeno, si el juez no está calibrado o si el cambio pierde más de lo que el examen deja ver, **bloquea**. Lo construyes con Claude, lo rehaces tú solo, lo rompes con ayuda y lo rompes solo.

La guía completa (conceptos, paso a paso, fallas y los prompts de cada ronda) está en el Dojo: https://dojo.trueml.app/rag/gate/

## Arranque

```bash
brew install llama.cpp                 # llama-server 1.1.0 o más nuevo (estación 7)
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python mundo/modelos.py                # una vez: ≈ 3.9 GB de Hugging Face, cada archivo con su sha256
python mundo/crear.py
python mundo/servidor.py arrancar      # el LLM de la API en 127.0.0.1:9931 y el juez en 127.0.0.1:9933
python mundo/api.py arrancar           # la API de la estación 8 en 127.0.0.1:9932
python verificar.py mundo
```

Sin Docker, sin GPU y sin internet después de `pip install` y `mundo/modelos.py`. Los dos modelos juntos usan ≈ 4 GB de memoria. Después abre Claude Code en esta carpeta y pega el prompt de la ronda en la que vas.

## Qué hay aquí

| | |
|---|---|
| `mundo/` | El corpus del 22, el directorio, el golden set y las **68 calificaciones de personas** para calibrar al juez (`entrada/`), el catálogo de modelos y lo que los baja, lo que arma el almacén y el índice (`crear.py`), lo que arranca los dos servidores (`servidor.py`) y la API (`api.py`), y los cambios que propone el equipo (`propuesta.py`). No se toca. |
| `almacen/` y `modelo/` | La entrada, las llaves y los cuatro modelos (e5, el reranker, el LLM de la API y el juez). Los escribe el mundo. |
| `servidor.env` / `juez.env` | Cómo se sirve cada modelo: el de la API (Qwen3 0.6B) y el juez (Qwen3 4B). |
| `pipeline/` | Tu código: `correr.py`, `metricas.py`, `juez.py` y `gate.py`. Cada archivo trae arriba su contrato. La API de la estación 8 (`api.py`, `prompt.py`, `citas.py`, `guardas.py`), el retrieval de la estación 6 y el cliente del LLM vienen dados. |
| `corridas/` | Lo que produce tu examen: una carpeta por corrida (respuestas, manifiesto, juicio, métricas y la decisión del gate), `VIGENTE` y su historial. |
| `config.yaml` | Lo de las estaciones 5 a 8 y, desde `evals`, todo lo de esta: el examen, el juez y las reglas del gate. |
| `verificar.py` / `romper.py` | Los 8 checks de la estación y las 6 fallas. |
| `GUION.md` / `OBJETIVOS.md` | El paso a paso de la ronda Construir con ayuda y solo los objetivos para Construir solo. |
| `CLAUDE.md` | Las reglas para Claude Code en este proyecto. |
| `BITACORA.md`, `taller/progreso.json` | Tu registro. `verificar.py` y `romper.py` anotan solos en `progreso.json`; impórtalo en «Tu tablero» del Dojo: https://dojo.trueml.app/tablero/ |

Para empezar la ronda Construir solo desde el esqueleto: `python mundo/reiniciar.py`.

## Créditos

Todo el contenido es ficticio: el marketplace, las personas, los documentos, las preguntas y las calificaciones. Los modelos son de sus autores: [intfloat/multilingual-e5-small](https://huggingface.co/intfloat/multilingual-e5-small) (MIT), [cross-encoder/mmarco-mMiniLMv2-L12-H384-v1](https://huggingface.co/cross-encoder/mmarco-mMiniLMv2-L12-H384-v1) (Apache-2.0), [Qwen/Qwen3-0.6B](https://huggingface.co/Qwen/Qwen3-0.6B) y [Qwen/Qwen3-4B](https://huggingface.co/Qwen/Qwen3-4B) (Apache-2.0), en las conversiones a GGUF de [ggml-org](https://huggingface.co/ggml-org). El servidor de los modelos es [llama.cpp](https://github.com/ggml-org/llama.cpp) (MIT); la API usa [FastAPI](https://fastapi.tiangolo.com) y [uvicorn](https://www.uvicorn.org) (BSD).
