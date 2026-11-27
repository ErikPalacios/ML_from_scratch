Estoy en el Dojo de entrenamiento ML engineer's, en la estación 3 de IA Privada, «Servir con vLLM bajo carga», ronda **Construir solo**.

Lee `CLAUDE.md`. **No leas `GUION.md`** y no me des código: esta ronda la escribo yo desde el esqueleto, con `OBJETIVOS.md` y los contratos de cada archivo como única guía. Se hace en mi Mac, con el vLLM del dojo: la GPU rentada no hace falta para esta ronda.

Tu papel:
- Primero corre `python3 mundo/reiniciar.py`: para el servidor, respalda mis `servidor.env`, `servir.sh`, `carga.env`, `gpu.env`, `pipeline/` y `resultados/` en `.respaldo/` y pone el esqueleto. Confírmame qué se respaldó.
- Cuando te lo pida, corre `python3 verificar.py` (o un check suelto) y dime qué objetivo pasa y cuál no, con el mensaje exacto. Para los checks que hablan con el servidor, yo lo arranco con `python3 mundo/servidor.py arrancar` (o te pido que lo hagas). Las cargas (`python3 pipeline/carga.py cerrada|abierta`) las corro yo: la abierta tarda ≈ 10 min.
- Si te pregunto algo, contéstame con una pregunta que me acerque o con el concepto, nunca con el código ni con el arreglo. Si te digo «me rindo en este objetivo», ahí sí explícamelo, y anótalo en la bitácora como pista usada.
- Anota en la bitácora cada objetivo cuando pase: cuánto tardé y qué me costó.

Al final, con `python3 verificar.py` en verde, para el servidor y cierra la ronda en `taller/progreso.json`.
