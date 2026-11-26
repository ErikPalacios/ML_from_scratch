# Dojo · RAG · Estación 4: Golden set

Un mini-proyecto para practicar la cuarta estación del entrenamiento RAG (caso C11) en tu Mac: el **examen fijo** con el que se va a medir todo el asistente. Revisas las preguntas que mandaron los expertos con un **JSON Schema** y con reglas por tipo (directa, con varias fuentes, sin respuesta y prohibida para quien pregunta), quitas las **casi iguales**, repartes en **dev y test con un hash** para que nada cambie de lado, aplicas la **regla de contaminación** contra lo que afina el equipo del prompt, publicas **versiones que nunca se pisan** (con su sha256 en un registro de solo lectura) y, cuando el corpus se re-ingesta, **reanclas** cada fuente al chunk que tiene su texto. Lo construyes con Claude, lo rehaces tú solo, lo rompes con ayuda y lo rompes solo.

La guía completa (conceptos, paso a paso, fallas y los prompts de cada ronda) está en el Dojo: https://dojo.trueml.app/rag/golden/

## Arranque

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python mundo/crear.py
python verificar.py mundo
```

Sin Docker, sin GPU y sin internet después del `pip install` (pyyaml y jsonschema). Después abre Claude Code en esta carpeta y pega el prompt de la ronda en la que vas.

## Qué hay aquí

| | |
|---|---|
| `mundo/` | El corpus que dejó la estación 3 y el de las dos re-ingestas siguientes, el directorio, las preguntas de los expertos y los ejemplos de afinado (`entrada/`), lo que lo copia a `almacen/` (`crear.py`), la re-ingesta de la noche (`avanzar.py`), el registro (`registro.py`), un adelanto del gate (`evaluar.py`) y la verdad (`referencia.py`, la usa `verificar.py`). No se toca. |
| `almacen/` | La entrada y el registro donde se publica cada versión. Lo escribe el mundo. No se toca. |
| `esquema/` y `pipeline/` | Tu código: el JSON Schema y `esquema.py`, `parecidas.py`, `splits.py`, `contaminacion.py`, `publicar.py`, `armar.py` y `reanclar.py`. Cada archivo trae arriba su contrato. `_comun.py` viene dado. |
| `config.yaml` | El umbral de parecidas, cómo se reparten los splits y las cuotas de cada tipo. |
| `golden/` | Lo que produce tu pipeline: cada versión con su manifiesto, `versiones.jsonl`, `VIGENTE` y `anclas.json`. |
| `verificar.py` / `romper.py` | Los 11 checks de la estación y las 6 fallas. |
| `GUION.md` / `OBJETIVOS.md` | El paso a paso de la ronda Construir con ayuda y solo los objetivos para Construir solo. |
| `CLAUDE.md` | Las reglas para Claude Code en este proyecto. |
| `BITACORA.md`, `taller/progreso.json` | Tu registro. `verificar.py` y `romper.py` anotan solos en `progreso.json`; impórtalo en «Tu tablero» del Dojo: https://dojo.trueml.app/tablero/ |

Para empezar la ronda Construir solo desde el esqueleto: `python mundo/reiniciar.py`.

## Créditos

Todo el contenido es ficticio: el marketplace, las personas, los documentos y las preguntas.
