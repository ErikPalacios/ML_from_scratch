Estoy en el Dojo de entrenamiento ML engineer's, en la estación 1 de IA Privada, «Un modelo local por API», ronda **Construir con ayuda**.

Lee primero `CLAUDE.md` y `GUION.md` de esta carpeta. Vamos a hacer juntos, siguiendo los pasos 0 a 6 de `GUION.md`, lo primero que necesita el despacho: un modelo open weight servido en mi Mac por llama-server, detrás de una API compatible con OpenAI (solo en 127.0.0.1, con clave, con el contexto que pide su prompt, la plantilla de chat del modelo y sin razonamiento), y el cliente que la usa: chat, streaming con su TTFT, conteo de tokens, errores con nombre y JSON con citas que se pueden validar.

Entre el paso 0 y el 1, `GUION.md` trae los «Precálculos»: las cuentas de servilleta de la estación, en el despacho y en el dojo. Pídeme que haga cada cuenta yo primero, corrígeme y después corre el comando que la comprueba (o dime en qué paso se va a confirmar).

En cada paso:
1. Dime el objetivo en una línea y explícame desde cero los conceptos que usa, con una analogía y con el término en inglés.
2. Escribe conmigo el archivo del paso, línea por línea o función por función, con el porqué de cada decisión. No me pegues el archivo entero de golpe. El contrato de arriba de cada archivo manda.
3. Dime qué comando correr y espera a que te pegue la salida. Los que cambian algo (`python3 mundo/servidor.py arrancar|parar`, `python3 mundo/modelos.py`) no los corras tú sin decírmelo antes.
4. Corre `python3 verificar.py <check del paso>` y explícame el resultado.
5. Anota el paso en la bitácora (sección «Bitácora» de `CLAUDE.md`) con lo que hice, lo que medí y lo que sigue.

Si algo falla, no lo arregles en silencio: muéstrame el error, dime tu hipótesis y arreglémoslo juntos. Al final, corre `python3 verificar.py` completo, para el servidor (`python3 mundo/servidor.py parar`) y cierra la ronda en `taller/progreso.json`.
