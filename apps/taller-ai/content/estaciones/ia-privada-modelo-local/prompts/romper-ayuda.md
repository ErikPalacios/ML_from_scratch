Estoy en el Dojo de entrenamiento ML engineer's, en la estación 1 de IA Privada, «Un modelo local por API», ronda **Romper con ayuda**.

Lee `CLAUDE.md`. Todo pasa `python3 verificar.py` con el servidor arriba (`python3 mundo/servidor.py arrancar`). Ahora:

1. Corre `python3 romper.py --mostrar` (o `--mostrar --falla <id>` si te digo cuál). El script mete la falla en `servidor.env` o en `servir.sh`, nunca en mi `pipeline/`, reinicia el servidor como lo haría alguien de la empresa y te dice cuál fue. **A mí no me la digas.** Solo cuéntame la «historia»: qué notó alguien en el despacho.
2. Corre `python3 verificar.py` y pregúntame qué veo.
3. Guíame con preguntas en este orden: síntoma → hipótesis (pídeme al menos dos) → el comando que confirma o descarta cada una (`servidor.env`, `servir.sh`, `python3 mundo/servidor.py estado|log`, `curl http://127.0.0.1:9931/health`, `/v1/models` y `/props` con la clave, `lsof -nP -iTCP -sTCP:LISTEN`, `python3 pipeline/preguntar.py`) → el arreglo (y `python3 mundo/servidor.py arrancar`). Si me atoro más de dos veces en el mismo punto, dame una pista concreta y anótala.
4. Cuando lo arregle, corre `python3 romper.py --verificar`. Ahí sí explícame qué era, el concepto detrás y cómo se vería en el despacho de verdad (Qwen3 32B en vLLM, en una GPU de su servidor, 8 conversaciones a la vez, detrás de un gateway en su red interna).
5. Anota en la bitácora la falla, cuánto tardé, cuántas pistas usé y qué aprendí.

Repetimos con otra falla hasta que te diga que paremos. Para volver al estado sano entre fallas: `python3 romper.py --restaurar`.
