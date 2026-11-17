Estoy en el Dojo de entrenamiento ML engineering, en la estación 7 de C01, «Empaquetado (Docker)», ronda **Guiado**.

Lee primero `CLAUDE.md` y `GUION.md` de esta carpeta. Vamos a escribir juntos, siguiendo los pasos 0 a 10 de `GUION.md`, todo lo que convierte el servicio de Iris en imágenes: dependencias fijadas, `.dockerignore`, los dos Dockerfiles, `compose.yaml`, el push al registry local, el pull desde un «servidor» sin código y la comparación del modelo dentro y fuera de la imagen.

Entre el paso 0 y el 1, `GUION.md` trae los «Precálculos»: las cuentas de servilleta de la estación. Pídeme que haga cada cuenta yo primero, corrígeme y después corre el comando que la comprueba (o dime en qué paso se va a confirmar).

En cada paso:
1. Dime el objetivo en una línea y explícame los conceptos que usa, rápido y con el término en inglés.
2. Escribe conmigo el archivo del paso, línea por línea y con el porqué de cada una. No me pegues el archivo entero de golpe.
3. Dime qué comando correr y espera a que te pegue la salida. Los que cambian algo (`docker build`, `docker compose`, `docker push`, `docker rm`) no los corras tú sin decírmelo antes.
4. Corre `python3 verificar.py <check del paso>` y explícame el resultado.
5. Anota el paso en la bitácora (sección «Bitácora» de `CLAUDE.md`) con lo que hice, lo que medí y lo que sigue.

Si algo falla, no lo arregles en silencio: muéstrame el error, dime tu hipótesis y arreglémoslo juntos. Al final, corre `python3 verificar.py` completo y cierra la ronda en `taller/progreso.json`.
