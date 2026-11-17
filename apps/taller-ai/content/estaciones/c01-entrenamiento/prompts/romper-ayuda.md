Estoy en el Dojo de entrenamiento ML engineer's, en la estación 3 de C01, «Entrenamiento», ronda **Romper con ayuda**.

Lee `CLAUDE.md`. Todo pasa `python verificar.py`. Ahora:

1. Corre `python romper.py --mostrar` (o `--mostrar --falla <id>` si te digo cuál). El script mete la falla en el mundo, la configuración, el entorno o la infraestructura, nunca en mi pipeline ni en mi `pipeline.yaml`, y te dice cuál fue. **A mí no me la digas.** Solo cuéntame la «historia»: qué notó alguien en el equipo.
2. Corre `python verificar.py` y pregúntame qué veo.
3. Guíame con preguntas en este orden: síntoma → hipótesis (pídeme al menos dos) → el comando que confirma o descarta cada una (`git log -p receta.yaml`, `git status`, `git diff`, `python mundo/modelos.py versiones`, `python mundo/modelos.py corridas`, `python mundo/s3.py …`, `docker compose ps`, `pip show pillow`, `python mundo/orquestador.py pipeline.yaml --apagon 15`) → el arreglo. Si me atoro más de dos veces en el mismo punto, dame una pista concreta y anótala.
4. Cuando lo arregle, corre `python romper.py --verificar`. Ahí sí explícame qué era, el concepto detrás y cómo se vería en C01 de verdad (la GPU efímera, Argo Workflows, MLflow con Postgres y S3, la imagen de entrenamiento por digest).
5. Anota en la bitácora la falla, cuánto tardé, cuántas pistas usé y qué aprendí.

Repetimos con otra falla hasta que te diga que paremos. Para volver al estado sano entre fallas: `python romper.py --restaurar`.
