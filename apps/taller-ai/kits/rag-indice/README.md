# Dojo · RAG · Estación 5: Embeddings e índice híbrido

Un mini-proyecto para practicar la quinta estación del entrenamiento RAG (caso C11) en tu Mac: el **índice** donde el asistente busca. Conviertes cada chunk en un **embedding** con un modelo local chico (multilingual-e5-small, con su revisión y su sha256 anotados), no vuelves a embeber lo que ya embebiste (**cache** por modelo y texto), escribes **BM25** (el buscador de palabras) y un **índice de vectores** sobre los mismos chunks, con la **ACL** de cada uno como filtro antes de elegir el top-8, **construyes cada índice al lado** del que está sirviendo, lo mides con el **golden set** de la estación 4 (cada mitad por separado) y cambias el **alias** sin cortar la API, con forma de **volver atrás**. Lo construyes con Claude, lo rehaces tú solo, lo rompes con ayuda y lo rompes solo.

La guía completa (conceptos, paso a paso, fallas y los prompts de cada ronda) está en el Dojo: https://dojo.trueml.app/rag/indice/

## Arranque

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python mundo/modelos.py          # una vez: ≈ 578 MB de Hugging Face, cada archivo con su sha256
python mundo/crear.py
python verificar.py mundo
```

Sin Docker, sin GPU y sin internet después de `pip install` y `mundo/modelos.py` (onnxruntime, numpy, tokenizers y pyyaml). Después abre Claude Code en esta carpeta y pega el prompt de la ronda en la que vas.

## Qué hay aquí

| | |
|---|---|
| `mundo/` | El corpus del 22, el directorio y el golden set (`entrada/`), el catálogo de modelos (`modelos.json`) y lo que los baja (`modelos.py`), lo que arma el almacén y el índice del piloto (`crear.py`), la API de búsqueda (`servicio.py`), el tráfico (`trafico.py`), el job de cada noche (`noche.py`), el monitor de calidad (`evaluar.py`) y la verdad (`referencia.py`, la usa `verificar.py`). No se toca. |
| `almacen/` y `modelo/` | La entrada y los dos modelos. Los escribe el mundo. No se tocan. |
| `pipeline/` | Tu código: `embeber.py`, `bm25.py`, `vectores.py`, `construir.py`, `buscar.py`, `prueba.py` y `alias.py`. Cada archivo trae arriba su contrato. `_comun.py` viene dado. |
| `config.yaml` | El modelo, la dimensión y la similitud del índice, k1 y b de BM25 y lo de la API. |
| `cache/` e `indices/` | Lo que produce tu pipeline: los embeddings ya hechos, cada índice con su manifiesto y `indices/alias.json`. |
| `verificar.py` / `romper.py` | Los 11 checks de la estación y las 6 fallas. |
| `GUION.md` / `OBJETIVOS.md` | El paso a paso de la ronda Construir con ayuda y solo los objetivos para Construir solo. |
| `CLAUDE.md` | Las reglas para Claude Code en este proyecto. |
| `BITACORA.md`, `taller/progreso.json` | Tu registro. `verificar.py` y `romper.py` anotan solos en `progreso.json`; impórtalo en «Tu tablero» del Dojo: https://dojo.trueml.app/tablero/ |

Para empezar la ronda Construir solo desde el esqueleto: `python mundo/reiniciar.py`.

## Créditos

Todo el contenido es ficticio: el marketplace, las personas, los documentos y las preguntas. Los modelos son de sus autores: [intfloat/multilingual-e5-small](https://huggingface.co/intfloat/multilingual-e5-small) (MIT) y [sentence-transformers/all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) (Apache-2.0).
