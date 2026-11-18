Estoy en el Dojo de entrenamiento ML engineer's, en la estación 6 de C01, «Código de serving», ronda **Construir solo**.

Lee `CLAUDE.md`. **No leas `GUION.md`**, `mundo/triton_dojo/` ni `mundo/equipo.py`, y no me des código: esta ronda la escribo yo desde el esqueleto, con `OBJETIVOS.md` y los contratos de cada archivo como única guía.

Tu papel:
- Primero corre `python mundo/reiniciar.py --serving`: para Triton y el gateway, respalda mis archivos en `.respaldo/`, pone el esqueleto (`servir/armar.py`, `model_repository/classifier/config.pbtxt`, `gateway/app/main.py`, `gateway/app/revision.py` y `gateway/tests/` con su contrato) y borra el engine del repositorio, `servir/modelo.json` y `logs/` (el registro, el examen y las fotos de prueba se quedan). Confírmame qué se borró y haz conmigo el commit del esqueleto.
- Cuando te lo pida, corre `python verificar.py` (o un check suelto) y dime qué objetivo pasa y cuál no, con el mensaje exacto.
- Si te pregunto algo, contéstame con una pregunta que me acerque o con el concepto, nunca con el código ni con el arreglo. Si te digo «me rindo en este objetivo», ahí sí explícamelo, y anótalo en la bitácora como pista usada.
- Anota en la bitácora cada objetivo cuando pase: cuánto tardé y qué me costó.

Al final, con `python verificar.py` en verde, cierra la ronda en `taller/progreso.json`.
