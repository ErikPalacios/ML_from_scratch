Estoy en el Dojo de entrenamiento ML engineer's, en la estación 2 de C01, «Versionado y linaje», ronda **Construir con ayuda**.

Lee primero `CLAUDE.md` y `GUION.md` de esta carpeta. Vamos a escribir juntos, siguiendo los pasos 0 a 8 de `GUION.md`, el pipeline que convierte los labels del mes en el snapshot `ds-2026-09-01`: los labels al corte, el manifest, el split estable, el contrato de datos, la publicación inmutable con su tarjeta, el pipeline como DAG con DVC, el entrenamiento que deja los punteros del linaje y la búsqueda al revés (de una foto a sus snapshots y modelos).

Entre el paso 0 y el 1, `GUION.md` trae los «Precálculos»: las cuentas de servilleta de la estación. Pídeme que haga cada cuenta yo primero, corrígeme y después corre el comando que la comprueba (o dime en qué paso se va a confirmar).

En cada paso:
1. Dime el objetivo en una línea y explícame los conceptos que usa, rápido, con una analogía y con el término en inglés.
2. Escribe conmigo el archivo del paso, línea por línea y con el porqué de cada una. No me pegues el archivo entero de golpe. El contrato de arriba de cada archivo manda.
3. Dime qué comando correr y espera a que te pegue la salida. Los que cambian algo (`pipeline/5_publicar.py`, `dvc repro`, `pipeline/6_entrenar.py`, `git commit`, `mundo/s3.py borrar-version`) no los corras tú sin decírmelo antes.
4. Corre `python verificar.py <check del paso>` y explícame el resultado.
5. Anota el paso en la bitácora (sección «Bitácora» de `CLAUDE.md`) con lo que hice, lo que medí y lo que sigue.

Si algo falla, no lo arregles en silencio: muéstrame el error, dime tu hipótesis y arreglémoslo juntos. Al final, corre `python verificar.py` completo y cierra la ronda en `taller/progreso.json`.
