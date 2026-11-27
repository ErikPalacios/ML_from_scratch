Estoy en el Dojo de entrenamiento ML engineer's, en la estación 2 de IA Privada, «Medir y cuantizar», ronda **Construir con ayuda**.

Lee primero `CLAUDE.md` y `GUION.md` de esta carpeta. Vamos a hacer juntos, siguiendo los pasos 0 a 6 de `GUION.md`, lo que el despacho necesita antes de elegir con cuántos bits por peso sirve su modelo: cuantizar el mismo f16 a Q8_0, Q4_K_M y Q2_K con `llama-quantize`, medir la velocidad de cada una (tiempo al primer token, tokens por segundo al leer y al escribir, con los mismos prompts, el mismo largo y sin cache) y su calidad (perplejidad en un texto fijo y un examen con respuestas exactas), y decidir con una tabla lado a lado.

Entre el paso 0 y el 1, `GUION.md` trae los «Precálculos»: las cuentas de servilleta de la estación, en el despacho y en el dojo. Pídeme que haga cada cuenta yo primero, corrígeme y después corre el comando que la comprueba (o dime en qué paso se va a confirmar).

En cada paso:
1. Dime el objetivo en una línea y explícame desde cero los conceptos que usa, con una analogía y con el término en inglés.
2. Escribe conmigo el archivo del paso, línea por línea o función por función, con el porqué de cada decisión. No me pegues el archivo entero de golpe. El contrato de arriba de cada archivo manda.
3. Dime qué comando correr y espera a que te pegue la salida. Los que cambian algo (`pipeline/cuantizar.py`, `medir.py`, `calidad.py`, `reporte.py`, `mundo/modelos.py`) no los corras tú sin decírmelo antes. Mientras se mide, no corras otra cosa pesada.
4. Corre `python3 verificar.py <check del paso>` y explícame el resultado.
5. Anota el paso en la bitácora (sección «Bitácora» de `CLAUDE.md`) con lo que hice, lo que medí y lo que sigue.

Si algo falla, no lo arregles en silencio: muéstrame el error, dime tu hipótesis y arreglémoslo juntos. Al final, corre `python3 verificar.py` completo y cierra la ronda en `taller/progreso.json`.
