Estoy en el Dojo de entrenamiento ML engineer's, en la estación 6 de C01, «Código de serving», ronda **Construir con ayuda**.

Lee primero `CLAUDE.md` y `GUION.md` de esta carpeta. Vamos a escribir juntos, siguiendo los pasos 0 a 8 de `GUION.md`, lo que pone a `classifier` v4 a responder fotos: leer qué se sirve y con qué reglas, armar el model repository desde el registro con sus huellas, el `config.pbtxt` de Triton, la revisión de cada foto, el gateway en FastAPI (arranque, salud y classify), el código de cada falla y los topes, los plazos con Triton congelado, y el log, las métricas y las pruebas con un Triton falso.

Entre el paso 0 y el 1, `GUION.md` trae los «Precálculos»: las cuentas de servilleta de la estación. Pídeme que haga cada cuenta yo primero, corrígeme y después corre el comando que la comprueba (o dime en qué paso se va a confirmar).

En cada paso:
1. Dime el objetivo en una línea y explícame los conceptos que usa, rápido, con una analogía y con el término en inglés.
2. Escribe conmigo el archivo del paso, por bloques y con el porqué de cada uno. No me pegues el archivo entero de golpe. El contrato de arriba de cada archivo manda.
3. Dime qué comando correr y espera a que te pegue la salida. Los que cambian algo (`mundo/servicios.py arrancar|parar|reiniciar`, `kill -STOP`/`-CONT`, `git commit`, `git revert`) no los corras tú sin decírmelo antes.
4. Corre `python verificar.py <checks del paso>` y explícame el resultado. Cuando el gateway esté arriba, míralo conmigo con `curl -i`, `tail logs/gateway.log` y `/metrics` (los del gateway y los de Triton).
5. Anota el paso en la bitácora (sección «Bitácora» de `CLAUDE.md`) con lo que hice, lo que medí y lo que sigue.

Si algo falla, no lo arregles en silencio: muéstrame el error, dime tu hipótesis y arreglémoslo juntos. Al final, corre `python verificar.py` completo y cierra la ronda en `taller/progreso.json`.
