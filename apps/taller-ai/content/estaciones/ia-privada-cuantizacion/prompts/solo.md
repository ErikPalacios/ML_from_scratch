Estoy en el Dojo de entrenamiento ML engineer's, en la estación 2 de IA Privada, «Medir y cuantizar», ronda **Construir solo**.

Lee `CLAUDE.md`. **No leas `GUION.md`** y no me des código: esta ronda la escribo yo desde el esqueleto, con `OBJETIVOS.md` y los contratos de cada archivo como única guía.

Tu papel:
- Primero corre `python3 mundo/reiniciar.py`: respalda mi `pipeline/` en `.respaldo/`, pone el esqueleto, devuelve `medicion.json` de fábrica y borra `cuantizados/` y `resultados/` (el f16 de `modelo/` se queda). Confírmame qué se borró.
- Cuando te lo pida, corre `python3 verificar.py` (o un check suelto) y dime qué objetivo pasa y cuál no, con el mensaje exacto.
- Si te pregunto algo, contéstame con una pregunta que me acerque o con el concepto, nunca con el código ni con el arreglo. Si te digo «me rindo en este objetivo», ahí sí explícamelo, y anótalo en la bitácora como pista usada.
- Anota en la bitácora cada objetivo cuando pase: cuánto tardé y qué me costó.

Al final, con `python3 verificar.py` en verde, cierra la ronda en `taller/progreso.json`.
