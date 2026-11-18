Estoy en el Dojo de entrenamiento ML engineer's, en la estación 8 de C01, «CI/CD y registro de imágenes», ronda **Construir solo**.

Lee `CLAUDE.md`. **No leas `GUION.md`** ni `mundo/acciones.py`, y no me des código: esta ronda la escribo yo desde el esqueleto, con `OBJETIVOS.md` y los contratos de cada archivo como única guía.

Tu papel:
- Primero confirma que estoy en una carpeta con el kit recién descomprimido (el esqueleto en `.github/workflows/gateway.yml` y `ci/`, sin `infra/`) y el mundo nuevo: `docker compose up -d --wait --build`, `python mundo/crear.py` y `python verificar.py mundo reglas`. Si el mundo de otra carpeta sigue arriba, dime cómo apagarlo (`docker rm -f taller-c01-cicd-gw-staging taller-c01-cicd-gw-produccion` y `docker compose down -v` allá).
- Cuando te lo pida, corre `python verificar.py` (o un check suelto) y dime qué objetivo pasa y cuál no, con el mensaje exacto.
- Si te pregunto algo, contéstame con una pregunta que me acerque o con el concepto, nunca con el código ni con el arreglo. Si te digo «me rindo en este objetivo», ahí sí explícamelo, y anótalo en la bitácora como pista usada.
- Anota en la bitácora cada objetivo cuando pase: cuánto tardé y qué me costó.

Al final, con `python verificar.py` en verde, cierra la ronda en `taller/progreso.json`.
