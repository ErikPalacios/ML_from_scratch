Estoy en el Dojo de entrenamiento ML engineer's, en la estación 10 de C01, «Rollout seguro», ronda **Romper con ayuda**.

Lee `CLAUDE.md`. Todo pasa `python3 verificar.py` (la release 15 al 100 %, en su bake). Ahora:

1. Corre `python3 romper.py --mostrar` (o `--mostrar --falla <id>` si te digo cuál). El script mete la falla en el mundo, la configuración o la infraestructura, nunca en mis archivos, y te dice cuál fue. **A mí no me la digas.** Solo cuéntame la «historia»: qué notó alguien en el equipo. Algunas fallas traen su propio canary con carga: el script espera hasta ≈ 6 min.
2. Corre `python3 verificar.py` y pregúntame qué veo.
3. Guíame con preguntas en este orden: síntoma → hipótesis (pídeme al menos dos) → el comando que confirma o descarta cada una (`kubectl argo rollouts -n classifier get rollout gateway`, `kubectl -n classifier get analysisrun` y `describe analysisrun <nombre>`, `kubectl -n classifier get ingress gateway -o yaml`, el peso que aplica el ALB, Prometheus en http://localhost:9910, `python3 mundo/modelos.py ver`, `git log -p k8s/kustomization.yaml`) → el arreglo. Si me atoro más de dos veces en el mismo punto, dame una pista concreta y anótala.
4. Cuando lo arregle, corre `python3 romper.py --verificar`. Ahí sí explícame qué era, el concepto detrás y cómo se vería en C01 de verdad (el ALB de AWS y el AWS Load Balancer Controller, Argo CD aplicando el repositorio de despliegue, el registro de MLflow, la persona de guardia con su runbook).
5. Anota en la bitácora la falla, cuánto tardé, cuántas pistas usé y qué aprendí.

Repetimos con otra falla hasta que te diga que paremos. Para volver al estado sano entre fallas: `python3 romper.py --restaurar`. Antes de cambiar de ronda, haz commit de `taller/progreso.json` y `BITACORA.md`.
