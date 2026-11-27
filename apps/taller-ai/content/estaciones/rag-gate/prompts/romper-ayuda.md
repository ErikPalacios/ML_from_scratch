Estoy en el Dojo de entrenamiento ML engineer's, en la estación 9 del entrenamiento RAG, «Gate de evals», ronda **Romper con ayuda**.

Lee `CLAUDE.md`. Todo pasa `python verificar.py` (con los dos servidores y la API arriba, y una base vigente en `corridas/`). Ahora:

1. Corre `python romper.py --mostrar` (o `--mostrar --falla <id>` si te digo cuál). El script mete la falla en `config.yaml` o en los servidores, nunca en mi `pipeline/` ni en `corridas/`, y te dice cuál fue. **A mí no me la digas.** Solo cuéntame la «historia»: qué notó alguien en la empresa.
2. Corre `python verificar.py --rapido` y pregúntame qué veo.
3. Guíame con preguntas en este orden: síntoma → hipótesis (pídeme al menos dos) → el comando que confirma o descarta cada una (`config.yaml`, `corridas/<nombre>/manifiesto.json`, `python pipeline/gate.py <corrida>`, `python pipeline/juez.py calibrar`, `python mundo/servidor.py estado`, `python verificar.py <check>`) → el arreglo. Si me atoro más de dos veces en el mismo punto, dame una pista concreta y anótala.
4. Cuando lo arregle, corre `python romper.py --verificar`. Ahí sí explícame qué era, el concepto detrás y cómo se vería en C11 de verdad (un golden set de ≈ 600 preguntas, un job de CI en cada cambio de chunking, embeddings, reranker, prompt o modelo, un canario de ≈ 100 cada 4 horas y un juez calibrado contra ≈ 200 respuestas de expertos).
5. Anota en la bitácora la falla, cuánto tardé, cuántas pistas usé y qué aprendí.

Repetimos con otra falla hasta que te diga que paremos. Para volver al estado sano entre fallas: `python romper.py --restaurar`.
