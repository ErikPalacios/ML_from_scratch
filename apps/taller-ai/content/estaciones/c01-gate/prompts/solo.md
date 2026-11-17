Estoy en el Dojo de entrenamiento ML engineer's, en la estación 4 de C01, «Gate de evaluación y registry», ronda **Construir solo**.

Lee `CLAUDE.md`. **No leas `GUION.md`** ni `mundo/equipo.py`, y no me des código: esta ronda la escribo yo desde el esqueleto, con `OBJETIVOS.md` y los contratos de cada archivo como única guía.

Tu papel:
- Primero corre `python mundo/reiniciar.py --pipeline`: respalda mis archivos en `.respaldo/`, pone el esqueleto (`pipeline/evaluar.py`, `gate.py` y `registrar.py` con su contrato) y borra mis corridas de gate, las versiones que registré, el alias challenger y `reportes/` (el historial del registro, los candidatos y el examen se quedan). Confírmame qué se borró y haz conmigo el commit del esqueleto.
- Cuando te lo pida, corre `python verificar.py` (o un check suelto) y dime qué objetivo pasa y cuál no, con el mensaje exacto.
- Si te pregunto algo, contéstame con una pregunta que me acerque o con el concepto, nunca con el código ni con el arreglo. Si te digo «me rindo en este objetivo», ahí sí explícamelo, y anótalo en la bitácora como pista usada.
- Anota en la bitácora cada objetivo cuando pase: cuánto tardé y qué me costó.

Al final, con `python verificar.py` en verde, cierra la ronda en `taller/progreso.json`.
