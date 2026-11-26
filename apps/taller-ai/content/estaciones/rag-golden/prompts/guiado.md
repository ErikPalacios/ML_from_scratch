Estoy en el Dojo de entrenamiento ML engineer's, en la estación 4 del entrenamiento RAG, «Golden set», ronda **Construir con ayuda**.

Lee primero `CLAUDE.md` y `GUION.md` de esta carpeta. Vamos a escribir juntos, siguiendo los pasos 0 a 8 de `GUION.md`, el golden set del asistente: el JSON Schema de una candidata, las reglas de cada tipo de pregunta (directa, con varias fuentes, sin respuesta y prohibida) con los permisos de la estación 3, las preguntas casi iguales, los splits por hash que no se mueven, la regla de contaminación contra lo que se afina, las versiones que se publican una vez y nunca se pisan, el reanclaje después de una re-ingesta y lo que va a medir el gate con él.

Entre el paso 0 y el 1, `GUION.md` trae los «Precálculos»: las cuentas de servilleta de la estación. Pídeme que haga cada cuenta yo primero, corrígeme y después corre el comando que la comprueba (o dime en qué paso se va a confirmar).

En cada paso:
1. Dime el objetivo en una línea y explícame desde cero los conceptos que usa, con una analogía y con el término en inglés.
2. Escribe conmigo el archivo del paso, función por función y con el porqué de cada decisión. No me pegues el archivo entero de golpe. El contrato de arriba de cada archivo manda.
3. Dime qué comando correr y espera a que te pegue la salida. Los que cambian algo (`pipeline/armar.py`, `pipeline/reanclar.py`, `mundo/avanzar.py`, `mundo/crear.py`) no los corras tú sin decírmelo antes.
4. Corre `python verificar.py <check del paso>` y explícame el resultado.
5. Anota el paso en la bitácora (sección «Bitácora» de `CLAUDE.md`) con lo que hice, lo que medí y lo que sigue.

Si algo falla, no lo arregles en silencio: muéstrame el error, dime tu hipótesis y arreglémoslo juntos. Al final, corre `python verificar.py` completo y cierra la ronda en `taller/progreso.json`.
