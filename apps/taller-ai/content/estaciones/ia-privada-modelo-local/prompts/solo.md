Estoy en el Dojo de entrenamiento ML engineer's, en la estación 1 de IA Privada, «Un modelo local por API», ronda **Construir solo**.

Lee `CLAUDE.md`. **No leas `GUION.md`** y no me des código: esta ronda la escribo yo desde el esqueleto, con `OBJETIVOS.md` y los contratos de cada archivo como única guía.

Tu papel:
- Primero corre `python3 mundo/reiniciar.py`: para el servidor, respalda mis `servidor.env`, `servir.sh` y `pipeline/` en `.respaldo/` y pone el esqueleto (el modelo de `modelo/` se queda). Confírmame qué se respaldó.
- Cuando te lo pida, corre `python3 verificar.py` (o un check suelto) y dime qué objetivo pasa y cuál no, con el mensaje exacto. Para los checks que hablan con el servidor, yo lo arranco con `python3 mundo/servidor.py arrancar` (o te pido que lo hagas).
- Si te pregunto algo, contéstame con una pregunta que me acerque o con el concepto, nunca con el código ni con el arreglo. Si te digo «me rindo en este objetivo», ahí sí explícamelo, y anótalo en la bitácora como pista usada.
- Anota en la bitácora cada objetivo cuando pase: cuánto tardé y qué me costó.

Al final, con `python3 verificar.py` en verde, para el servidor y cierra la ronda en `taller/progreso.json`.
