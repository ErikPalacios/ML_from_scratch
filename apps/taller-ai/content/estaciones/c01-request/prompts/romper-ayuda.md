Estoy en el Dojo de entrenamiento ML engineer's, en la estación 11 de C01, «La request en vivo», ronda **Romper con ayuda**.

Lee `CLAUDE.md`. Todo pasa `python verificar.py` (la release 15 con su rastro completo). Ahora:

1. Corre `python romper.py --mostrar` (o `--mostrar --falla <id>` si te digo cuál). El script mete la falla en el mundo, la configuración o la infraestructura, nunca en mis archivos, y te dice cuál fue. **A mí no me la digas.** Solo cuéntame la «historia»: qué notó alguien en el equipo. Algunas fallas tardan ≈ 1 min en verse en Prometheus (la ventana de las tasas).
2. Corre `python verificar.py` y pregúntame qué veo.
3. Guíame con preguntas en este orden: síntoma → hipótesis (pídeme al menos dos) → el comando que confirma o descarta cada una (http://localhost:9952/targets y /alerts, `curl -s localhost:8951/metrics`, `nodo/descubrimiento/pods.json`, `docker compose ps` y `docker compose logs fluent-bit-a`, `curl -s localhost:9953/api/v2/metrics/prometheus`, `curl -s localhost:8957/metrics` y `logs/alb.log`, `python mundo/nodo.py estado`, `git log -p mundo/plataforma.yaml gateway/app/main.py`) → el arreglo. Si me atoro más de dos veces en el mismo punto, dame una pista concreta y anótala.
4. Cuando lo arregle, corre `python romper.py --verificar`. Ahí sí explícame qué era, el concepto detrás y cómo se vería en C01 de verdad (kube-prometheus-stack con su PodMonitor, el DaemonSet de Fluent Bit, Amazon S3, el ALB de AWS con sus métricas en CloudWatch, la persona de guardia).
5. Anota en la bitácora la falla, cuánto tardé, cuántas pistas usé y qué aprendí.

Repetimos con otra falla hasta que te diga que paremos. Para volver al estado sano entre fallas: `python romper.py --restaurar`. Antes de cambiar de ronda, haz commit de `taller/progreso.json` y `BITACORA.md`.
