Estoy en el Dojo de entrenamiento ML engineer's, en la estación 12 de C01, «Monitoreo y reentrenamiento», ronda **Romper con ayuda**.

Lee `CLAUDE.md`. Todo pasa `python verificar.py` (las reglas, Alertmanager, el job diario, los tickets decididos y la cola del mes). Ahora:

1. Corre `python romper.py --mostrar` (o `--mostrar --falla <id>` si te digo cuál). El script mete la falla en el mundo, la configuración o la infraestructura, nunca en mis archivos, y te dice cuál fue. **A mí no me la digas.** Solo cuéntame la «historia»: qué notó alguien en el equipo. Algunas fallas tardan unos minutos en verse (las ventanas de 3 min de las señales en vivo, o el latido, que tarda ≈ 6 min en perderse).
2. Corre `python verificar.py` y pregúntame qué veo.
3. Guíame con preguntas en este orden: síntoma → hipótesis (pídeme al menos dos) → el comando que confirma o descarta cada una (`python mundo/capas.py`, http://localhost:9962/alerts y /status, `prometheus_notifications_errors_total`, `curl -s localhost:8966/estado`, `python mundo/tickets.py avisos`, `python mundo/cron.py estado`, `curl -s localhost:9964/metrics`, `count_over_time(…[7d])` en Prometheus, `git log -p` de `mundo/`, `compose.yaml` y `gateway/`) → el arreglo. Si me atoro más de dos veces en el mismo punto, dame una pista concreta y anótala.
4. Cuando lo arregle, corre `python romper.py --verificar`. Ahí sí explícame qué era, el concepto detrás y cómo se vería en C01 de verdad (kube-prometheus-stack, el dead man's switch fuera del clúster, el CronWorkflow de Argo con su rol de IAM, el equipo dueño de cada app, la guardia).
5. Anota en la bitácora la falla, cuánto tardé, cuántas pistas usé y qué aprendí.

Repetimos con otra falla hasta que te diga que paremos. Para volver al estado sano entre fallas: `python romper.py --restaurar`. Antes de cambiar de ronda, haz commit de `taller/progreso.json` y `BITACORA.md`.
