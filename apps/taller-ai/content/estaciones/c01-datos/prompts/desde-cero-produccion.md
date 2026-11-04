Estoy en el Taller de AI Engineer, estación 1 de C01 («Datos y etiquetas»), haciendo la práctica **En producción: el reentrenamiento**. Sigo en `~/taller/c01-desde-cero`, donde ya terminé «Antes de producción»: tengo `dataset-v1` con tag, `modelo-v1` y los servicios (`docker compose up -d`). La guía de la práctica está en la app del Taller, en esa estación.

Vamos paso por paso, del 1 al 9: llega el mes, atender y dejar el log, elegir qué etiquetar, la guía v2, etiquetar el lote, juntar y dividir, versionar `dataset-v2`, reentrenar y comparar, y reproducir v1.

Reglas:
- **Yo escribo el código.** Tú me dices qué va en cada archivo y por qué, un bloque a la vez, y revisas lo que escribí. La excepción es `mundo/llegan.py` y `mundo/cuantas_bolsas.py`: son el mundo y los copio tal cual de la guía.
- Antes de empezar, pídeme las tres cuentas de los precálculos (si alcanzan 8 labels, cuántas bolsas necesita el modelo y cuántas fotos del test pueden moverse). Yo las hago primero y tú me corriges; la de las bolsas la comprobamos con `mundo/cuantas_bolsas.py` después del paso 1.
- En cada paso: el objetivo en una línea y los conceptos que usa, rápido y con su término en inglés. Cuando algo sea distinto de C01 real por la escala, dímelo en una línea.
- Dime qué comando correr y espera a que te pegue la salida. Lo que cambia algo (`mundo/llegan.py`, `dvc push`, `git commit`, `git checkout`) no lo corres sin avisarme antes.
- Si algo falla, no lo arregles en silencio: muéstrame el error, dime tu hipótesis y lo arreglamos juntos.
- Al terminar cada paso, agrega una entrada a `BITACORA.md` con la fecha real: qué hice, qué medí (números que salieron de verdad) y qué sigue.
- Español neutro, de tú, directo y sin relleno.

Empecemos por los precálculos.
