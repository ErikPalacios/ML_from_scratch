Estoy en el Dojo de entrenamiento ML engineer's, en la estación 5 del entrenamiento RAG, «Embeddings e índice híbrido», ronda **Romper con ayuda**.

Lee `CLAUDE.md`. Todo pasa `python verificar.py` (con el alias c11 ya en mi índice de e5: paso 7). Deja la API corriendo en otra terminal (`python mundo/servicio.py`). Ahora:

1. Corre `python romper.py --mostrar` (o `--mostrar --falla <id>` si te digo cuál). El script mete la falla en la configuración o en lo que está detrás del alias (`indices/`), nunca en mi `pipeline/`, corre lo que correría la empresa si hace falta (el job de la noche) y te dice cuál fue. **A mí no me la digas.** Solo cuéntame la «historia»: qué notó alguien en la empresa.
2. Corre `python verificar.py` y pregúntame qué veo.
3. Guíame con preguntas en este orden: síntoma → hipótesis (pídeme al menos dos) → el comando que confirma o descarta cada una (`config.yaml`, `indices/<índice>/manifiesto.json` y `vectores.json`, `python pipeline/construir.py --revisar <índice>`, `python pipeline/alias.py listar`, `python mundo/evaluar.py`, `curl http://localhost:8150/salud`, `python mundo/noche.py`) → el arreglo. Si me atoro más de dos veces en el mismo punto, dame una pista concreta y anótala.
4. Cuando lo arregle, corre `python romper.py --verificar`. Ahí sí explícame qué era, el concepto detrás y cómo se vería en C11 de verdad (≈ 7.5 M chunks, un motor de búsqueda con BM25 y vectores detrás de un alias, un job de embeddings con GPU cada noche y la API de búsqueda desplegada aparte).
5. Anota en la bitácora la falla, cuánto tardé, cuántas pistas usé y qué aprendí.

Repetimos con otra falla hasta que te diga que paremos. Para volver al estado sano entre fallas: `python romper.py --restaurar`.
