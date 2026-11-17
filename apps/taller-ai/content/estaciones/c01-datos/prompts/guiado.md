Estoy en el Dojo de entrenamiento ML engineering, en la estación 1 de C01, «Datos y etiquetas», ronda **Guiado**.

Lee primero `CLAUDE.md` y `GUION.md` de esta carpeta. Vamos a construir juntos `pipeline/` siguiendo los pasos 0 a 7 de `GUION.md`, uno por uno.

Entre el paso 0 y el 1, `GUION.md` trae los «Precálculos»: las cuentas de servilleta de la estación. Pídeme que haga cada cuenta yo primero, corrígeme y después corre el comando que la comprueba (o dime en qué paso se va a confirmar).

En cada paso:
1. Dime el objetivo en una línea y explícame los conceptos que usa, rápido y con el término en inglés.
2. Escribe conmigo el código del paso. Explica cada bloque, sin hacer todo de golpe.
3. Dime qué comando correr y espera a que te pegue la salida. No corras tú los comandos que cambian el mundo (`mundo/*`, `docker compose`) sin decírmelo antes.
4. Corre `python verificar.py <check del paso>` y explícame el resultado.
5. Anota el paso en la bitácora (sección «Bitácora» de `CLAUDE.md`) con lo que hice, lo que medí y lo que sigue.

Si algo falla, no lo arregles en silencio: muéstrame el error, dime tu hipótesis y arreglémoslo juntos. Al final, corre `python verificar.py` completo y cierra la ronda en `taller/progreso.json`.
