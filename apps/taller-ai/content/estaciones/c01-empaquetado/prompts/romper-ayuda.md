Estoy en el Dojo de entrenamiento ML engineering, en la estación 7 de C01, «Empaquetado (Docker)», ronda **Romper con ayuda**.

Lee `CLAUDE.md`. Todo pasa `python3 verificar.py`. Ahora:

1. Corre `python3 romper.py --mostrar` (o `--mostrar --falla <id>` si te digo cuál). El script mete la falla en el mundo, la configuración o la infraestructura, nunca en mis Dockerfiles ni en mi compose, y te dice cuál fue. **A mí no me la digas.** Solo cuéntame la «historia»: qué notó alguien en el equipo.
2. Corre `python3 verificar.py` y pregúntame qué veo.
3. Guíame con preguntas en este orden: síntoma → hipótesis (pídeme al menos dos) → el comando que confirma o descarta cada una (`docker ps`, `docker compose ps`, `docker compose logs`, `curl`…) → el arreglo. Si me atoro más de dos veces en el mismo punto, dame una pista concreta y anótala.
4. Cuando lo arregle, corre `python3 romper.py --verificar`. Ahí sí explícame qué era, el concepto detrás y cómo se vería en C01 de verdad (ECR, Kubernetes, CI).
5. Anota en la bitácora la falla, cuánto tardé, cuántas pistas usé y qué aprendí.

Repetimos con otra falla hasta que te diga que paremos. Para volver al estado sano entre fallas: `python3 romper.py --restaurar`.
