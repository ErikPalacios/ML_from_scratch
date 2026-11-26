Estoy en el Dojo de entrenamiento ML engineer's, en la estación 4 del entrenamiento RAG, «Golden set», ronda **Romper con ayuda**.

Lee `CLAUDE.md`. Todo pasa `python verificar.py` (con la re-ingesta del 22 ya reanclada: `python mundo/avanzar.py` y `python pipeline/reanclar.py`). Ahora:

1. Corre `python romper.py --mostrar` (o `--mostrar --falla <id>` si te digo cuál). El script mete la falla en la configuración o en el almacén, nunca en mi `pipeline/`, corre lo que correría la empresa (el armado de la noche o una re-ingesta) y te dice cuál fue. **A mí no me la digas.** Solo cuéntame la «historia»: qué notó alguien en la empresa.
2. Corre `python verificar.py` y pregúntame qué veo.
3. Guíame con preguntas en este orden: síntoma → hipótesis (pídeme al menos dos) → el comando que confirma o descarta cada una (`config.yaml`, `golden/<versión>/manifiesto.json` y `rechazadas.jsonl`, `python pipeline/publicar.py --comprobar`, `python pipeline/parecidas.py <lote>`, `python pipeline/contaminacion.py`, `python mundo/registro.py listar`, `python mundo/evaluar.py`) → el arreglo. Si me atoro más de dos veces en el mismo punto, dame una pista concreta y anótala.
4. Cuando lo arregle, corre `python romper.py --verificar`. Ahí sí explícame qué era, el concepto detrás y cómo se vería en C11 de verdad (≈ 600 preguntas escritas por expertos, un corpus de millones de chunks que se re-ingesta cada noche, el registro en S3 con Object Lock y el gate que mide recall@8, faithfulness, citas y permisos con este examen).
5. Anota en la bitácora la falla, cuánto tardé, cuántas pistas usé y qué aprendí.

Repetimos con otra falla hasta que te diga que paremos. Para volver al estado sano entre fallas: `python romper.py --restaurar`.
