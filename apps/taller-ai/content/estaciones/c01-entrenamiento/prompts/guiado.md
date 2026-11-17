Estoy en el Dojo de entrenamiento ML engineer's, en la estación 3 de C01, «Entrenamiento», ronda **Construir con ayuda**.

Lee primero `CLAUDE.md` y `GUION.md` de esta carpeta. Vamos a escribir juntos, siguiendo los pasos 0 a 7 de `GUION.md`, el job que convierte el snapshot `ds-2026-09-01` en un checkpoint candidato con su corrida en MLflow: leer el snapshot con el preprocess del gateway, la prueba de humo, el entrenamiento con semilla y MLflow, el arranque desde el champion, los checkpoints para reanudar después de una caída, el pipeline en el orquestador y la regla para saber si una diferencia es regresión o ruido.

Entre el paso 0 y el 1, `GUION.md` trae los «Precálculos»: las cuentas de servilleta de la estación. Pídeme que haga cada cuenta yo primero, corrígeme y después corre el comando que la comprueba (o dime en qué paso se va a confirmar).

En cada paso:
1. Dime el objetivo en una línea y explícame los conceptos que usa, rápido, con una analogía y con el término en inglés.
2. Escribe conmigo el archivo del paso, por bloques y con el porqué de cada uno. No me pegues el archivo entero de golpe. El contrato de arriba de cada archivo manda.
3. Dime qué comando correr y espera a que te pegue la salida. Los que cambian algo (`pipeline/entrenar.py`, `mundo/orquestador.py`, `git commit`, `git revert`) no los corras tú sin decírmelo antes, y avísame cuánto tardan.
4. Corre `python verificar.py <checks del paso>` y explícame el resultado. Cuando haya una corrida nueva, ábrela conmigo en MLflow (http://localhost:5400): parámetros, curva por época, tags y artefactos.
5. Anota el paso en la bitácora (sección «Bitácora» de `CLAUDE.md`) con lo que hice, lo que medí y lo que sigue.

Si algo falla, no lo arregles en silencio: muéstrame el error, dime tu hipótesis y arreglémoslo juntos. Al final, corre `python verificar.py` completo y cierra la ronda en `taller/progreso.json`.
