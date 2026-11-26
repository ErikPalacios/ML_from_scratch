# Dojo · RAG · Estación 3: Permisos en cada chunk

Un mini-proyecto para practicar la tercera estación del entrenamiento RAG (caso C11) en tu Mac: que el asistente **nunca le dé a una persona un chunk que no puede abrir**. Resuelves quién es quién en el directorio de la empresa (con grupos dentro de grupos), revisas la **ACL dentro de cada chunk** (guardada como grupos, no como personas), filtras **antes** de elegir los mejores chunks y otra vez antes del prompt, pruebas a cada persona contra la verdad y armas un **carril rápido** que aplica cada revocación en ≤ 5 min sin esperar a reindexar. Lo construyes con Claude, lo rehaces tú solo, lo rompes con ayuda y lo rompes solo.

La guía completa (conceptos, paso a paso, fallas y los prompts de cada ronda) está en el Dojo: https://dojo.trueml.app/rag/permisos/

## Arranque

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python mundo/crear.py
python verificar.py mundo
```

Sin Docker, sin GPU y sin internet después del `pip install` (solo pyyaml). Después abre Claude Code en esta carpeta y pega el prompt de la ronda en la que vas.

## Qué hay aquí

| | |
|---|---|
| `mundo/` | Lo que dejó la estación 2 (`entrada/docs/`), el directorio de la empresa y los cambios de permisos de la mañana (`entrada/`), lo que lo copia a `almacen/` (`crear.py`), la mañana del 21 (`avanzar.py`) y la verdad (`referencia.py`, la usa `verificar.py`). No se toca. |
| `almacen/` | La entrada: los chunks de cada documento con su ACL, el directorio y la cola de eventos. Lo escribe el mundo. No se toca. |
| `pipeline/` | Tu código: `directorio.py`, `permisos.py`, `indexar.py`, `buscar.py` y `revocar.py`. Cada archivo trae arriba su contrato. `_comun.py` viene dado (con el buscador de juguete). |
| `config.yaml` | La profundidad de los grupos, qué hacer con un chunk sin ACL, el top-k y el filtro, y cada cuánto corre el carril rápido. |
| `indice/` | Lo que produce tu pipeline: el índice, la copia del directorio, el cursor y la bitácora del carril rápido. |
| `verificar.py` / `romper.py` | Los 9 checks de la estación y las 4 fallas. |
| `GUION.md` / `OBJETIVOS.md` | El paso a paso de la ronda Construir con ayuda y solo los objetivos para Construir solo. |
| `CLAUDE.md` | Las reglas para Claude Code en este proyecto. |
| `BITACORA.md`, `taller/progreso.json` | Tu registro. `verificar.py` y `romper.py` anotan solos en `progreso.json`; impórtalo en «Tu tablero» del Dojo: https://dojo.trueml.app/tablero/ |

Para empezar la ronda Construir solo desde el esqueleto: `python mundo/reiniciar.py`.

## Créditos

Todo el contenido es ficticio: el marketplace, las personas, los grupos y los documentos.
