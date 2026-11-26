Estoy en el Dojo de entrenamiento ML engineer's, en la estación 3 del entrenamiento RAG, «Permisos en cada chunk», ronda **Romper con ayuda**.

Lee `CLAUDE.md`. Todo pasa `python verificar.py` (con la mañana ya pasada: `python mundo/avanzar.py`). Ahora:

1. Corre `python romper.py --mostrar` (o `--mostrar --falla <id>` si te digo cuál). El script mete la falla en la configuración o en el almacén, nunca en mi `pipeline/`, corre lo que correría la empresa (el reindexado o otra mañana) y te dice cuál fue. **A mí no me la digas.** Solo cuéntame la «historia»: qué notó alguien en la empresa.
2. Corre `python verificar.py` y pregúntame qué veo.
3. Guíame con preguntas en este orden: síntoma → hipótesis (pídeme al menos dos) → el comando que confirma o descarta cada una (`config.yaml`, `python pipeline/buscar.py --como <correo> "<pregunta>"`, `indice/indice.json`, `almacen/manana.json`, los chunks de un documento en `almacen/docs/`) → el arreglo. Si me atoro más de dos veces en el mismo punto, dame una pista concreta y anótala.
4. Cuando lo arregle, corre `python romper.py --verificar`. Ahí sí explícame qué era, el concepto detrás y cómo se vería en C11 de verdad (1.5 M de documentos con su ACL, miles de personas en el directorio, el filtro dentro del índice vectorial y el SLO de ≤ 5 min para revocar).
5. Anota en la bitácora la falla, cuánto tardé, cuántas pistas usé y qué aprendí.

Repetimos con otra falla hasta que te diga que paremos. Para volver al estado sano entre fallas: `python romper.py --restaurar`.
