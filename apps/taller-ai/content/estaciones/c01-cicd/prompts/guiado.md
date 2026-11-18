Estoy en el Dojo de entrenamiento ML engineer's, en la estación 8 de C01, «CI/CD y registro de imágenes», ronda **Construir con ayuda**.

Lee primero `CLAUDE.md` y `GUION.md` de esta carpeta. Vamos a escribir juntos, siguiendo los pasos 0 a 8 de `GUION.md`, el camino de un commit a producción: mirar el registro, los tags, los digests y lo que corre en cada ambiente; prender los tags inmutables; el workflow del PR (lint y pruebas, sin filtro de carpetas, con permisos mínimos y sin inyección); construir, probar (humo) y escanear la imagen; subirla con credenciales por OIDC; el workflow completo con staging y producción por digest y la aprobación de otra persona; la regla de retención, y un rollback en segundos.

Entre el paso 0 y el 1, `GUION.md` trae los «Precálculos»: las cuentas de servilleta de la estación. Pídeme que haga cada cuenta yo primero, corrígeme y después corre el comando que la comprueba (o dime en qué paso se va a confirmar).

En cada paso:
1. Dime el objetivo en una línea y explícame los conceptos que usa, rápido, con una analogía y con el término en inglés.
2. Escribe conmigo el archivo del paso, por bloques y con el porqué de cada uno. No me pegues el archivo entero de golpe. El contrato de arriba de cada archivo manda.
3. Dime qué comando correr y espera a que te pegue la salida. Los que cambian algo (`forja.py pr merge`, `forja.py aprobar`, `forja.py rerun`, `nube.py ecr configurar|politica-retencion`, un push al repositorio de despliegue, `git commit`, `git push`, `git revert`) no los corras tú sin decírmelo antes.
4. Corre `python verificar.py <checks del paso>` y explícame el resultado. Mira conmigo cada corrida con `python mundo/forja.py corrida <id>` (y `--job <job>` para el log), el registro con `python mundo/nube.py ecr imagenes classifier-gateway` y los ambientes con `python mundo/gitops.py estado`.
5. Anota el paso en la bitácora (sección «Bitácora» de `CLAUDE.md`) con lo que hice, lo que medí y lo que sigue.

Si algo falla, no lo arregles en silencio: muéstrame el error, dime tu hipótesis y arreglémoslo juntos. Al final, corre `python verificar.py` completo y cierra la ronda en `taller/progreso.json`.
