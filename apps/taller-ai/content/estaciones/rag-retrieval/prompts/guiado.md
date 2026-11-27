Estoy en el Dojo de entrenamiento ML engineer's, en la estación 6 del entrenamiento RAG, «Retrieval y reranker», ronda **Construir con ayuda**.

Lee primero `CLAUDE.md` y `GUION.md` de esta carpeta. Vamos a escribir juntos, siguiendo los pasos 0 a 6 de `GUION.md`, el retrieval del asistente: los candidatos de BM25 y de vectores con los permisos antes de elegir, la fusión con RRF (y por qué no se suman los puntajes), un reranker local (un cross-encoder con su revisión y su sha256) que lee los mejores 20 y deja 8, y la medición con el golden set: recall@8 por tipo de pregunta en cuatro modos lado a lado, recall@3, MRR y la latencia del reranker, afinando con dev y reportando con test.

Entre el paso 0 y el 1, `GUION.md` trae los «Precálculos»: las cuentas de servilleta de la estación. Pídeme que haga cada cuenta yo primero, corrígeme y después corre el comando que la comprueba (o dime en qué paso se va a confirmar).

En cada paso:
1. Dime el objetivo en una línea y explícame desde cero los conceptos que usa, con una analogía y con el término en inglés.
2. Escribe conmigo el archivo del paso, función por función y con el porqué de cada decisión. No me pegues el archivo entero de golpe. El contrato de arriba de cada archivo manda.
3. Dime qué comando correr y espera a que te pegue la salida. Los que cambian algo (`pipeline/medir.py`, `mundo/crear.py`) no los corras tú sin decírmelo antes. `config.yaml` solo se cambia cuando el paso lo pide, y diciéndome por qué.
4. Corre `python verificar.py <check del paso>` y explícame el resultado.
5. Anota el paso en la bitácora (sección «Bitácora» de `CLAUDE.md`) con lo que hice, lo que medí y lo que sigue.

Si algo falla, no lo arregles en silencio: muéstrame el error, dime tu hipótesis y arreglémoslo juntos. Al final, corre `python verificar.py` completo y cierra la ronda en `taller/progreso.json`.
