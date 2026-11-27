Estoy en el Dojo de entrenamiento ML engineer's, en la estación 5 del entrenamiento RAG, «Embeddings e índice híbrido», ronda **Construir solo**.

Lee `CLAUDE.md`. **No leas `GUION.md`** ni `mundo/referencia.py`, y no me des código: esta ronda la escribo yo desde el esqueleto, con `OBJETIVOS.md` y los contratos de cada archivo como única guía.

Tu papel:
- Primero corre `python mundo/reiniciar.py`: respalda mis archivos de `pipeline/` en `.respaldo/`, pone el esqueleto, devuelve `config.yaml` de fábrica y vuelve a crear el mundo el 22 a las 11:00 (borra `indices/` y `cache/`; los modelos de `modelo/` se quedan). Confírmame qué se borró.
- Cuando te lo pida, corre `python verificar.py` (o un check suelto) y dime qué objetivo pasa y cuál no, con el mensaje exacto.
- Si te pregunto algo, contéstame con una pregunta que me acerque o con el concepto, nunca con el código ni con el arreglo. Si te digo «me rindo en este objetivo», ahí sí explícamelo, y anótalo en la bitácora como pista usada.
- Anota en la bitácora cada objetivo cuando pase: cuánto tardé y qué me costó.

Al final, con `python verificar.py` en verde, cierra la ronda en `taller/progreso.json`.
