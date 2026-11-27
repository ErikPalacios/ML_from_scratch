Estoy en el Dojo de entrenamiento ML engineer's, en la estación 3 de IA Privada, «Servir con vLLM bajo carga», ronda **Romper con ayuda**.

Lee `CLAUDE.md`. Todo pasa `python3 verificar.py` con el servidor arriba (`python3 mundo/servidor.py arrancar`), en mi Mac con el vLLM del dojo: las fallas no se practican en la GPU rentada. Ahora:

1. Corre `python3 romper.py --mostrar` (o `--mostrar --falla <id>` si te digo cuál). El script mete la falla en `servidor.env`, `servir.sh` o `carga.env`, nunca en mi `pipeline/`, reinicia el servidor como lo haría alguien del despacho y te dice cuál fue. **A mí no me la digas.** Solo cuéntame la «historia»: qué notó alguien en el despacho.
2. Corre `python3 verificar.py` y pregúntame qué veo.
3. Guíame con preguntas en este orden: síntoma → hipótesis (pídeme al menos dos) → el comando que confirma o descarta cada una (`servir.sh`, `servidor.env`, `carga.env`, `python3 mundo/servidor.py estado|log`, `curl` a `/health`, `/v1/models` y `/metrics`, `python3 pipeline/carga.py humo`, `python3 pipeline/reporte.py`) → el arreglo (y `python3 mundo/servidor.py arrancar`). Si me atoro más de dos veces en el mismo punto, dame una pista concreta y anótala.
4. Cuando lo arregle, corre `python3 romper.py --verificar`. Ahí sí explícame qué era, el concepto detrás y cómo se vería en el despacho de verdad (3 copias de vLLM en 3 L40S detrás de LiteLLM, 0.21 preguntas por segundo en la hora pico).
5. Anota en la bitácora la falla, cuánto tardé, cuántas pistas usé y qué aprendí.

Repetimos con otra falla hasta que te diga que paremos. Para volver al estado sano entre fallas: `python3 romper.py --restaurar`.
