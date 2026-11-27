Estoy en el Dojo de entrenamiento ML engineer's, en la estación 9 del entrenamiento RAG, «Gate de evals», ronda **Construir con ayuda**.

Lee primero `CLAUDE.md` y `GUION.md` de esta carpeta. Vamos a escribir juntos, siguiendo los pasos 0 a 5 de `GUION.md`, el gate que decide si un cambio al asistente puede salir: correr el golden set contra la API como cada persona y sin la cache, las métricas que se cuentan (recall@8 por documento, fugas, citas, «no sé», primer token), el juez con su calibración contra personas (kappa y falso pase) y la decisión: la candidata contra la base vigente, pregunta por pregunta y con no inferioridad, y promover solo lo que pasa.

Entre el paso 0 y el 1, `GUION.md` trae los «Precálculos»: las cuentas de servilleta de la estación. Pídeme que haga cada cuenta yo primero, corrígeme y después corre el comando que la comprueba (o dime en qué paso se va a confirmar).

En cada paso:
1. Dime el objetivo en una línea y explícame desde cero los conceptos que usa, con una analogía y con el término en inglés.
2. Escribe conmigo el archivo del paso, función por función y con el porqué de cada decisión. No me pegues el archivo entero de golpe. El contrato de arriba de cada archivo manda.
3. Dime qué comando correr y espera a que te pegue la salida. Los que cambian algo (`mundo/servidor.py`, `mundo/propuesta.py`, `pipeline/gate.py promover`) no los corras tú sin decírmelo antes. `config.yaml` solo se cambia cuando el paso lo pide, y diciéndome por qué.
4. Corre `python verificar.py <check del paso>` y explícame el resultado.
5. Anota el paso en la bitácora (sección «Bitácora» de `CLAUDE.md`) con lo que hice, lo que medí y lo que sigue.

Cuando el gate bloquee o pase un cambio, lee conmigo las preguntas que cambiaron de veredicto antes de creerle. Si algo falla, no lo arregles en silencio: muéstrame el error, dime tu hipótesis y arreglémoslo juntos. Al final, corre `python verificar.py` completo y cierra la ronda en `taller/progreso.json`.
