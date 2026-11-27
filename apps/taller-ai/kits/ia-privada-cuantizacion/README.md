# Dojo · IA Privada · Estación 2: Medir y cuantizar

Un mini-proyecto para practicar la segunda estación de IA Privada en tu Mac: **cuantizar** el mismo modelo (Qwen3-0.6B en f16, de un commit fijo de Hugging Face y con su sha256) a **Q8_0, Q4_K_M y Q2_K** con `llama-quantize`, medir la **velocidad** de cada una (tiempo al primer token, tokens por segundo al leer y al escribir) con los mismos prompts y el mismo largo, su **calidad** (perplejidad en un texto fijo y un examen con respuestas exactas) y **decidir** con una tabla lado a lado. Lo construyes con Claude, lo rehaces tú solo, lo rompes con ayuda y lo rompes solo.

La guía completa (conceptos, paso a paso, fallas y los prompts de cada ronda) está en el Dojo: https://dojo.trueml.app/ia-privada/cuantizacion/

## Arranque

```bash
brew install llama.cpp           # 1.1.0 o más nuevo: llama-server, llama-quantize y llama-perplexity
python3 mundo/modelos.py         # una vez: ≈ 1.5 GB de Hugging Face, con su sha256
python3 verificar.py mundo
```

Sin Docker, sin GPU, sin entorno virtual (solo la biblioteca estándar de Python) y sin internet después de bajar el modelo. Las tres cuantizaciones ocupan ≈ 1.6 GB más. Después abre Claude Code en esta carpeta y pega el prompt de la ronda en la que vas.

## Qué hay aquí

| | |
|---|---|
| `mundo/` | El catálogo del f16 y lo que lo baja, `servidor.py` (sirve un GGUF mientras lo mides), `ficha.py` (lee el encabezado de un GGUF), los prompts, el texto y el examen (`entrada/`), `reiniciar.py` y el esqueleto. No se toca. |
| `medicion.json` | Cómo se mide. |
| `pipeline/` | Tu código: `cuantizar.py`, `medir.py` y `calidad.py`, cada uno con su contrato arriba. `reporte.py` viene dado. |
| `cuantizados/` y `resultados/` | Lo que produce tu pipeline. |
| `verificar.py` / `romper.py` | Los 6 checks de la estación y las 6 fallas. |
| `GUION.md` / `OBJETIVOS.md` | El paso a paso de la ronda Construir con ayuda y solo los objetivos para Construir solo. |
| `CLAUDE.md` | Las reglas para Claude Code en este proyecto. |
| `BITACORA.md`, `taller/progreso.json` | Tu registro. `verificar.py` y `romper.py` anotan solos en `progreso.json`; impórtalo en «Tu tablero» del Dojo: https://dojo.trueml.app/tablero/ |

Para empezar la ronda Construir solo desde el esqueleto: `python3 mundo/reiniciar.py`.

## Créditos

Todo el contenido es ficticio: el despacho, los expedientes del examen y los documentos del texto (las políticas del marketplace del entrenamiento RAG). El modelo es [Qwen/Qwen3-0.6B](https://huggingface.co/Qwen/Qwen3-0.6B) (Apache-2.0), en la conversión a GGUF de [ggml-org/Qwen3-0.6B-GGUF](https://huggingface.co/ggml-org/Qwen3-0.6B-GGUF). Las herramientas son de [llama.cpp](https://github.com/ggml-org/llama.cpp) (MIT).
