Estoy en el Dojo de entrenamiento ML engineer's, en la estación 6 del entrenamiento RAG, «Retrieval y reranker», ronda **Romper con ayuda**.

Lee `CLAUDE.md`. Todo pasa `python verificar.py` (con el reporte ya medido: paso 6). Ahora:

1. Corre `python romper.py --mostrar` (o `--mostrar --falla <id>` si te digo cuál). El script mete la falla en la configuración o en el reporte de la semana (`indices/<índice>/retrieval.json`), nunca en mi `pipeline/`, corre lo que correría la empresa (el reporte de cada lunes) y te dice cuál fue. **A mí no me la digas.** Solo cuéntame la «historia»: qué notó alguien en la empresa.
2. Corre `python verificar.py` y pregúntame qué veo.
3. Guíame con preguntas en este orden: síntoma → hipótesis (pídeme al menos dos) → el comando que confirma o descarta cada una (`config.yaml`, `indices/<índice>/retrieval.json`, `python pipeline/recuperar.py --persona … "…"`, `python pipeline/medir.py`, `python verificar.py <check>`) → el arreglo. Si me atoro más de dos veces en el mismo punto, dame una pista concreta y anótala.
4. Cuando lo arregle, corre `python romper.py --verificar`. Ahí sí explícame qué era, el concepto detrás y cómo se vería en C11 de verdad (≈ 7.5 M chunks, la búsqueda híbrida del motor con RRF, un reranker como servicio con GPU, ≈ 25k preguntas al día y un golden set de ≈ 600).
5. Anota en la bitácora la falla, cuánto tardé, cuántas pistas usé y qué aprendí.

Repetimos con otra falla hasta que te diga que paremos. Para volver al estado sano entre fallas: `python romper.py --restaurar`.
