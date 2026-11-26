# Dojo · RAG · Estación 2: Chunking con contexto

Un mini-proyecto para practicar la segunda estación del entrenamiento RAG (caso C11) en tu Mac: partir el texto que dejó la ingestión en **chunks de ≤ 400 tokens**, contados con el tokenizador del modelo de embeddings, **por estructura** (títulos, párrafos, listas y tablas), con la **ruta de títulos** dentro de cada chunk, traslape solo donde hace falta, la **ACL** de su documento en cada chunk y sin volver a partir lo que no cambió. Lo construyes con Claude, lo rehaces tú solo, lo rompes con ayuda y lo rompes solo.

La guía completa (conceptos, paso a paso, fallas y los prompts de cada ronda) está en el Dojo: https://dojo.trueml.app/rag/chunking/

## Arranque

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python mundo/tokenizador.py
python mundo/crear.py
python verificar.py mundo
```

Sin Docker y sin internet después de bajar el tokenizer (17 MB, una vez). Después abre Claude Code en esta carpeta y pega el prompt de la ronda en la que vas.

## Qué hay aquí

| | |
|---|---|
| `mundo/` | Lo que dejó la estación 1 (`entrada/`), lo que lo copia a `almacen/` (`crear.py`), el día 2 (`avanzar.py`), el tokenizer (`tokenizador.py`) y la verdad (`referencia.py`, la usa `verificar.py`). No se toca. |
| `almacen/` | La entrada: el texto de cada documento por su hash y el catálogo con su ACL. Lo escribe `mundo/crear.py`. No se toca. |
| `modelo/` | El tokenizer de multilingual-e5-small, fijado a un commit y comprobado por sha256. |
| `pipeline/` | Tu chunking: `tokens.py`, `bloques.py`, `chunker.py` y `chunkear.py`. Cada archivo trae arriba su contrato. `_comun.py` viene dado. |
| `config.yaml` | El modelo (tokenizer, prefijo, límite), el chunking (estrategia, objetivo, traslape) y el incremental. |
| `chunks/` | Lo que produce tu chunking: `docs/<doc>.json` (los chunks de cada documento) y `corridas/`. |
| `verificar.py` / `romper.py` | Los 10 checks de la estación y las 4 fallas. |
| `GUION.md` / `OBJETIVOS.md` | El paso a paso de la ronda Construir con ayuda y solo los objetivos para Construir solo. |
| `CLAUDE.md` | Las reglas para Claude Code en este proyecto. |
| `BITACORA.md`, `taller/progreso.json` | Tu registro. `verificar.py` y `romper.py` anotan solos en `progreso.json`; impórtalo en «Tu tablero» del Dojo: https://dojo.trueml.app/tablero/ |

Para empezar la ronda Construir solo desde el esqueleto: `python mundo/reiniciar.py`.

## Créditos

Todo el contenido es ficticio: el marketplace, las personas y los documentos. El tokenizer es el de [intfloat/multilingual-e5-small](https://huggingface.co/intfloat/multilingual-e5-small) (licencia MIT), que el kit baja de Hugging Face; se usa con la librería [tokenizers](https://github.com/huggingface/tokenizers) (Apache 2.0).
