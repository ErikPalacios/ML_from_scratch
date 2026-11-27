Estoy en el Dojo de entrenamiento ML engineer's, en la estación 3 de IA Privada, «Servir con vLLM bajo carga», ronda **Construir con ayuda**.

Lee primero `CLAUDE.md` y `GUION.md` de esta carpeta. Vamos a hacer juntos, siguiendo los pasos 0 a 6 de `GUION.md`, lo que el despacho necesita antes de firmar una promesa de velocidad: Qwen3 32B en AWQ servido con vLLM (con clave, 8,192 tokens, 8 conversaciones a la vez y sin razonamiento), una prueba de carga honesta (cerrada con 8 a la vez y abierta con llegadas de Poisson a la tasa de una copia) y un reporte con percentiles, su intervalo, goodput y el veredicto contra el criterio. Los pasos 0 a 5 corren en mi Mac con el vLLM del dojo (simulado: sus tiempos son la cuenta de servilleta, no una medición). El paso 6 es la sesión en la GPU rentada.

Entre el paso 0 y el 1, `GUION.md` trae los «Precálculos»: las cuentas de servilleta, en el despacho y en el dojo. Pídeme que haga cada cuenta yo primero, corrígeme y después corre el comando que la comprueba (o dime en qué paso se confirma).

En cada paso:
1. Dime el objetivo en una línea y explícame desde cero los conceptos que usa, con una analogía y con el término en inglés.
2. Escribe conmigo el archivo del paso, línea por línea o función por función, con el porqué de cada decisión. No me pegues el archivo entero de golpe. El contrato de arriba de cada archivo manda.
3. Dime qué comando correr y espera a que te pegue la salida. Los que cambian algo (`python3 mundo/servidor.py arrancar|parar`, `python3 pipeline/carga.py …`) no los corras tú sin decírmelo antes. Cada vez que leas un número, dime si viene del simulador o de una GPU de verdad.
4. Corre `python3 verificar.py <check del paso>` y explícame el resultado.
5. Anota el paso en la bitácora (sección «Bitácora» de `CLAUDE.md`) con lo que hice, lo que medí y lo que sigue.

**El paso 6 cuesta dinero.** Antes de rentar nada, corre `python3 mundo/gpu.py plan` y dime el tiempo y el costo. Nunca abras cuentas, nunca metas datos de pago y nunca lances ni apagues un pod sin que yo te lo diga: eso lo hago yo en la consola de RunPod. En cuanto el pod diga Running, recuérdame correr `python3 mundo/gpu.py vigilar`, y al terminar `python3 mundo/gpu.py apagar` y `python3 mundo/gpu.py estado` hasta ver que ya no existe.

Si algo falla, no lo arregles en silencio: muéstrame el error, dime tu hipótesis y arreglémoslo juntos. Al final, corre `python3 verificar.py` completo, para el servidor (`python3 mundo/servidor.py parar`) y cierra la ronda en `taller/progreso.json`.
