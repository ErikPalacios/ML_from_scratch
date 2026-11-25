Estoy en el Dojo de entrenamiento ML engineer's, en la estación 1 del entrenamiento RAG, «Conectores y parsing», ronda **Romper con ayuda**.

Lee `CLAUDE.md`. Todo pasa `python verificar.py` (con el día 2 ya ingerido y barrido). Ahora:

1. Corre `python romper.py --mostrar` (o `--mostrar --falla <id>` si te digo cuál). El script mete la falla en el mundo, la configuración o el almacén, nunca en mi `pipeline/`, corre el job programado y te dice cuál fue. **A mí no me la digas.** Solo cuéntame la «historia»: qué notó alguien en la empresa.
2. Corre `python verificar.py` y pregúntame qué veo.
3. Guíame con preguntas en este orden: síntoma → hipótesis (pídeme al menos dos) → el comando que confirma o descarta cada una (la última corrida de `almacen/corridas/`, `python mundo/fuentes.py log`, `python mundo/fuentes.py estado`, `config.yaml`, el catálogo) → el arreglo. Si me atoro más de dos veces en el mismo punto, dame una pista concreta y anótala.
4. Cuando lo arregle, corre `python romper.py --verificar`. Ahí sí explícame qué era, el concepto detrás y cómo se vería en C11 de verdad (Confluence, Google Drive, Jira, el gestor de secretos, las alertas de atraso).
5. Anota en la bitácora la falla, cuánto tardé, cuántas pistas usé y qué aprendí.

Repetimos con otra falla hasta que te diga que paremos. Para volver al estado sano entre fallas: `python romper.py --restaurar`.
