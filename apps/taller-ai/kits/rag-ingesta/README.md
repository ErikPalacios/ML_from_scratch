# Dojo · RAG · Estación 1: Conectores y parsing

Un mini-proyecto para practicar la primera estación del entrenamiento RAG (caso C11) en tu Mac: traer los documentos de cuatro fuentes (una wiki, un Drive, un Jira y el repositorio de políticas), sacar su texto limpio, **guardarlo por el hash de su contenido** para no volver a procesar lo que no cambió, y anotar la **ACL** de cada uno. Lo construyes con Claude, lo rehaces tú solo, lo rompes con ayuda y lo rompes solo.

La guía completa (conceptos, paso a paso, fallas y los prompts de cada ronda) está en el Dojo: https://dojo.trueml.app/rag/ingesta/

## Arranque

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python mundo/crear.py
python mundo/fuentes.py arrancar
python verificar.py mundo
```

Sin Docker y sin internet después del `pip install`. Después abre Claude Code en esta carpeta y pega el prompt de la ronda en la que vas.

## Qué hay aquí

| | |
|---|---|
| `mundo/` | La empresa ficticia: crea las fuentes (`crear.py`), las sirve por HTTP (`fuentes.py`), hace pasar un día (`avanzar.py`) y sabe la verdad (`referencia.py`, la usa `verificar.py`). No se toca. |
| `fuentes/` | El estado del mundo: lo escribe `mundo/crear.py`. No se toca. |
| `pipeline/` | Tu ingestión: los conectores, el parsing, el almacén y `ingestar.py`. Cada archivo trae arriba su contrato. `_comun.py` viene dado. |
| `config.yaml` | URLs, tokens, reintentos, la regla del link compartido y el freno de borrado. |
| `almacen/` | Lo que produce tu ingestión: `texto/<hash>.json`, `catalogo.json`, `cursores.json` y `corridas/`. |
| `verificar.py` / `romper.py` | Los 11 checks de la estación y las 6 fallas. |
| `GUION.md` / `OBJETIVOS.md` | El paso a paso de la ronda Construir con ayuda y solo los objetivos para Construir solo. |
| `CLAUDE.md` | Las reglas para Claude Code en este proyecto. |
| `BITACORA.md`, `taller/progreso.json` | Tu registro. `verificar.py` y `romper.py` anotan solos en `progreso.json`; impórtalo en «Tu tablero» del Dojo: https://dojo.trueml.app/tablero/ |

## Puertos

| Servicio | Dirección |
|---|---|
| Las cuatro fuentes (wiki, Drive, Jira, políticas) | http://localhost:8120 |

Para apagarlas: `python mundo/fuentes.py parar`. Para empezar la ronda Construir solo desde el esqueleto: `python mundo/reiniciar.py`.

## Créditos

Todo es ficticio: el marketplace, las personas, los documentos y las APIs (imitan la forma de las de verdad, en chico). Los PDFs los escribe `mundo/pdf.py`, sin dependencias.
