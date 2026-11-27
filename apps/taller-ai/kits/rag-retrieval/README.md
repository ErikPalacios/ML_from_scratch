# Dojo · RAG · Estación 6: Retrieval y reranker

Un mini-proyecto para practicar la sexta estación del entrenamiento RAG (caso C11) en tu Mac: el **retrieval**, lo que elige qué chunks lee el asistente. Le pides **candidatos** a los dos índices de la estación 5 (BM25 y vectores) con el **filtro de permisos antes** de elegir, los juntas con **RRF** (Reciprocal Rank Fusion: cuenta el lugar en cada lista, no el puntaje), dejas que un **reranker** local (un cross-encoder multilingüe de 119 MB, con su revisión y su sha256 anotados) reordene los mejores y entregas el **top-8** que la estación 7 le pone al LLM. Lo mides con el **golden set** de la estación 4: recall@8 por tipo de pregunta en cuatro modos lado a lado (BM25 solo, vectores solos, fusión y fusión + reranker), con lo que tarda el reranker; afinas con `dev` y reportas con `test`. Lo construyes con Claude, lo rehaces tú solo, lo rompes con ayuda y lo rompes solo.

La guía completa (conceptos, paso a paso, fallas y los prompts de cada ronda) está en el Dojo: https://dojo.trueml.app/rag/retrieval/

## Arranque

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python mundo/modelos.py          # una vez: ≈ 623 MB de Hugging Face, cada archivo con su sha256
python mundo/crear.py
python verificar.py mundo
```

Sin Docker, sin GPU y sin internet después de `pip install` y `mundo/modelos.py` (onnxruntime, numpy, tokenizers y pyyaml). Después abre Claude Code en esta carpeta y pega el prompt de la ronda en la que vas.

## Qué hay aquí

| | |
|---|---|
| `mundo/` | El corpus del 22, el directorio y el golden set (`entrada/`), el catálogo de modelos (`modelos.json`) y lo que los baja (`modelos.py`), lo que arma el almacén y el índice de la estación 5 (`crear.py`) y la verdad (`referencia.py`, la usan `verificar.py` y `romper.py`). No se toca. |
| `almacen/` y `modelo/` | La entrada y los dos modelos (e5 y el reranker). Los escribe el mundo. No se tocan. |
| `pipeline/` | Tu código: `fusion.py`, `recuperar.py`, `reranker.py` y `medir.py`. Cada archivo trae arriba su contrato. Lo de la estación 5 (`buscar.py` y lo que usa) y `_comun.py` vienen dados. |
| `config.yaml` | Candidatos por índice, filtro, fusión, `rrf_k`, `rerank_n` y `k`; el lote del reranker; y con qué split se mide y con cuál se afina. |
| `indices/` | El índice de la estación 5 detrás del alias `c11`, y tu reporte: `retrieval.json`. |
| `verificar.py` / `romper.py` | Los 8 checks de la estación y las 6 fallas. |
| `GUION.md` / `OBJETIVOS.md` | El paso a paso de la ronda Construir con ayuda y solo los objetivos para Construir solo. |
| `CLAUDE.md` | Las reglas para Claude Code en este proyecto. |
| `BITACORA.md`, `taller/progreso.json` | Tu registro. `verificar.py` y `romper.py` anotan solos en `progreso.json`; impórtalo en «Tu tablero» del Dojo: https://dojo.trueml.app/tablero/ |

Para empezar la ronda Construir solo desde el esqueleto: `python mundo/reiniciar.py`.

## Créditos

Todo el contenido es ficticio: el marketplace, las personas, los documentos y las preguntas. Los modelos son de sus autores: [intfloat/multilingual-e5-small](https://huggingface.co/intfloat/multilingual-e5-small) (MIT) y [cross-encoder/mmarco-mMiniLMv2-L12-H384-v1](https://huggingface.co/cross-encoder/mmarco-mMiniLMv2-L12-H384-v1) (Apache-2.0).
