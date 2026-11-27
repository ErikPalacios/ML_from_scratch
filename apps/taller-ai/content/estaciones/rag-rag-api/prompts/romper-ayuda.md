Estoy en el Dojo de entrenamiento ML engineer's, en la estación 8 del entrenamiento RAG, «La API con citas», ronda **Romper con ayuda**.

Lee `CLAUDE.md`. Todo pasa `python verificar.py` (con el LLM y mi API arriba). Ahora:

1. Corre `python romper.py --mostrar` (o `--mostrar --falla <id>` si te digo cuál). El script mete la falla en `config.yaml` o en `servidor.env` (y vuelve a arrancar el LLM si hace falta), nunca en mi `pipeline/`, y te dice cuál fue. **A mí no me la digas.** Solo cuéntame la «historia»: qué notó alguien en la empresa.
2. Corre `python verificar.py` y pregúntame qué veo.
3. Guíame con preguntas en este orden: síntoma → hipótesis (pídeme al menos dos) → el comando que confirma o descarta cada una (`config.yaml`, `servidor.env`, `python pipeline/preguntar.py --eventos --persona … "…"`, `python mundo/servidor.py log`, `python verificar.py <check>`) → el arreglo. Si me atoro más de dos veces en el mismo punto, dame una pista concreta y anótala.
4. Cuando lo arregle, corre `python romper.py --verificar`. Ahí sí explícame qué era, el concepto detrás y cómo se vería en C11 de verdad (≈ 25k preguntas al día, el LLM de la plataforma de modelos de la empresa, el SSO, una cache compartida, ≈ 1.5 M documentos con su ACL y el primer token en ≤ 2.5 s p95).
5. Anota en la bitácora la falla, cuánto tardé, cuántas pistas usé y qué aprendí.

Repetimos con otra falla hasta que te diga que paremos. Para volver al estado sano entre fallas: `python romper.py --restaurar`.
