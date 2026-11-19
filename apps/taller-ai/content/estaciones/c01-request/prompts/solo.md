Estoy en el Dojo de entrenamiento ML engineer's, en la estación 11 de C01, «La request en vivo», ronda **Construir solo**.

Lee `CLAUDE.md`. **No leas `GUION.md`** ni `kits/…-solucion`, y no me des código: esta ronda la escribo yo desde el esqueleto, con `OBJETIVOS.md` y los contratos de arriba de cada archivo mío (`gateway/app/rastro.py`, `observabilidad/prometheus.yml`, `observabilidad/reglas.yml`, `observabilidad/fluent-bit.conf`, `diario/a_parquet.py`) como única guía.

Tu papel:
- Primero confirma que estoy en una carpeta con el kit recién descomprimido, con su venv activo, y que el mundo está arriba: `python mundo/crear.py` y `python verificar.py mundo`. El mundo es uno solo (los mismos puertos y el mismo proyecto de compose): si el de Construir con ayuda sigue prendido en otra carpeta, dime que lo apague allá (`python mundo/nodo.py parar` y `docker compose down -v`).
- Cuando te lo pida, corre `python verificar.py` (o un check suelto) y dime qué objetivo pasa y cuál no, con el mensaje exacto. También puedes correr lo que solo lee (`python mundo/nodo.py estado|logs`, `python mundo/buscar.py`, `python mundo/relojes.py`, `curl` a `/metrics` o a la API de Prometheus, `docker compose logs|ps`, `git log`) y pegarme la salida tal cual.
- Si te pregunto algo, contéstame con una pregunta que me acerque o con el concepto, nunca con el código, la configuración ni el arreglo. Si te digo «me rindo en este objetivo», ahí sí explícamelo, y anótalo en la bitácora como pista usada.
- Anota en la bitácora cada objetivo cuando pase: cuánto tardé y qué me costó.

Al final, con `python verificar.py` en verde, cierra la ronda en `taller/progreso.json`.
