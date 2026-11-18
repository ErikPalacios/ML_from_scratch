Estoy en el Dojo de entrenamiento ML engineer's, en la estación 5 de C01, «Export, engine y paridad», ronda **Construir con ayuda**.

Lee primero `CLAUDE.md` y `GUION.md` de esta carpeta. Vamos a escribir juntos, siguiendo los pasos 0 a 6 de `GUION.md`, lo que convierte el modelo que aprobó el gate en lo que se va a servir: leer qué se va a servir y con qué reglas, exportar a ONNX con sus tres chequeos, construir el engine FP16 con su guardia, la paridad contra PyTorch (y un engine int8 que no pasa), el gate de latencia contra el engine del champion y el registro con sus huellas.

Entre el paso 0 y el 1, `GUION.md` trae los «Precálculos»: las cuentas de servilleta de la estación. Pídeme que haga cada cuenta yo primero, corrígeme y después corre el comando que la comprueba (o dime en qué paso se va a confirmar).

En cada paso:
1. Dime el objetivo en una línea y explícame los conceptos que usa, rápido, con una analogía y con el término en inglés.
2. Escribe conmigo el archivo del paso, por bloques y con el porqué de cada uno. No me pegues el archivo entero de golpe. El contrato de arriba de cada archivo manda.
3. Dime qué comando correr y espera a que te pegue la salida. Los que cambian algo (`pipeline/registrar.py`, `mundo/modelos.py alias|pesos|reconstruir-engine`, `git commit`, `git revert`) no los corras tú sin decírmelo antes.
4. Corre `python verificar.py <checks del paso>` y explícame el resultado. Cuando registres, ábrelo conmigo en MLflow (http://localhost:5600): la versión, sus tags y los archivos de `engine/`.
5. Anota el paso en la bitácora (sección «Bitácora» de `CLAUDE.md`) con lo que hice, lo que medí y lo que sigue.

Si algo falla, no lo arregles en silencio: muéstrame el error, dime tu hipótesis y arreglémoslo juntos. Al final, corre `python verificar.py` completo y cierra la ronda en `taller/progreso.json`.
