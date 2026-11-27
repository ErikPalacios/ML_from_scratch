Estoy en el Dojo de entrenamiento ML engineer's, en la estación 5 del entrenamiento RAG, «Embeddings e índice híbrido», ronda **Construir con ayuda**.

Lee primero `CLAUDE.md` y `GUION.md` de esta carpeta. Vamos a escribir juntos, siguiendo los pasos 0 a 7 de `GUION.md`, el índice del asistente: los embeddings con un modelo local (con su firma: qué modelo y qué revisión), el cache para no volver a embeber, BM25, el índice de vectores con la ACL como filtro antes del top-8, la construcción de un índice nuevo al lado del vigente con su manifiesto, la búsqueda de prueba con el golden set (BM25 y vectores por separado) y el alias que cambia sin cortar la API, con forma de volver atrás.

Entre el paso 0 y el 1, `GUION.md` trae los «Precálculos»: las cuentas de servilleta de la estación. Pídeme que haga cada cuenta yo primero, corrígeme y después corre el comando que la comprueba (o dime en qué paso se va a confirmar).

En cada paso:
1. Dime el objetivo en una línea y explícame desde cero los conceptos que usa, con una analogía y con el término en inglés.
2. Escribe conmigo el archivo del paso, función por función y con el porqué de cada decisión. No me pegues el archivo entero de golpe. El contrato de arriba de cada archivo manda.
3. Dime qué comando correr y espera a que te pegue la salida. Los que cambian algo (`pipeline/construir.py`, `pipeline/alias.py cambiar|volver`, `pipeline/prueba.py`, `mundo/noche.py`, `mundo/crear.py`) no los corras tú sin decírmelo antes. La API (`mundo/servicio.py`) y el tráfico (`mundo/trafico.py`) van en otra terminal.
4. Corre `python verificar.py <check del paso>` y explícame el resultado.
5. Anota el paso en la bitácora (sección «Bitácora» de `CLAUDE.md`) con lo que hice, lo que medí y lo que sigue.

Si algo falla, no lo arregles en silencio: muéstrame el error, dime tu hipótesis y arreglémoslo juntos. Al final, corre `python verificar.py` completo y cierra la ronda en `taller/progreso.json`.
