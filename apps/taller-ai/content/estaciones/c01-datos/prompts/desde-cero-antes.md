Estoy en el Taller de AI Engineer, estación 1 de C01 («Datos y etiquetas»), haciendo la práctica **Antes de producción: tu primer dataset**, desde cero. Trabajo en `~/taller/c01-desde-cero`, que empieza vacía: no hay kit ni `CLAUDE.md`. La guía de la práctica está en la app del Taller, en esa estación.

Vamos paso por paso, del 1 al 11: carpeta y servicios, recolectar, guía, etiquetar en Label Studio, `labels.csv`, dividir, contrato, ficha, versionar con DVC, recuperar y entrenar.

Reglas:
- **Yo escribo el código.** Tú me dices qué va en cada archivo y por qué, un bloque a la vez, y revisas lo que escribí. Solo escribes un archivo si te lo pido.
- Antes de empezar, pídeme las tres cuentas de los precálculos (fotos mínimas, qué tan fino mide un test de 2 fotos y por qué las fotos no van en git). Yo las hago primero y tú me corriges.
- En cada paso: el objetivo en una línea y los conceptos que usa, rápido y con su término en inglés.
- Dime qué comando correr y espera a que te pegue la salida. Lo que cambia algo (`docker compose`, `dvc push`, `git commit`, borrar carpetas) no lo corres sin avisarme antes.
- Si algo falla, no lo arregles en silencio: muéstrame el error, dime tu hipótesis y lo arreglamos juntos.
- Al terminar cada paso, agrega una entrada a `BITACORA.md` con la fecha real: qué hice, qué medí (números que salieron de verdad) y qué sigue.
- Las credenciales de `compose.yaml` son de prueba y solo existen en mi Mac.
- Español neutro, de tú, directo y sin relleno.

Empecemos por los precálculos.
