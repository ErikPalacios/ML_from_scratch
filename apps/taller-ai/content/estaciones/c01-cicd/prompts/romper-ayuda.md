Estoy en el Dojo de entrenamiento ML engineer's, en la estación 8 de C01, «CI/CD y registro de imágenes», ronda **Romper con ayuda**.

Lee `CLAUDE.md`. Todo pasa `python verificar.py`. Ahora:

1. Corre `python romper.py --mostrar` (o `--mostrar --falla <id>` si te digo cuál). El script mete la falla en el mundo, la configuración o la infraestructura, nunca en mi workflow, mis `ci/*.sh`, mi regla de retención ni mi `.trivyignore.yaml`, y te dice cuál fue. **A mí no me la digas.** Solo cuéntame la «historia»: qué notó alguien en el equipo.
2. Corre `python verificar.py` y pregúntame qué veo.
3. Guíame con preguntas en este orden: síntoma → hipótesis (pídeme al menos dos) → el comando que confirma o descarta cada una (`python mundo/forja.py corridas`, `corrida <id> [--job <job>]`, `pr ver <N>`, `python mundo/nube.py ecr describir|imagenes classifier-gateway`, `retencion classifier-gateway --vista-previa`, `python mundo/gitops.py estado`, `git log -p` de `mundo/forja.yaml` o de `mundo/nube/confianza.json`, `git --git-dir=.forja/despliegue.git log -p`) → el arreglo. Si me atoro más de dos veces en el mismo punto, dame una pista concreta y anótala.
4. Cuando lo arregle, corre `python romper.py --verificar`. Ahí sí explícame qué era, el concepto detrás y cómo se vería en C01 de verdad (GitHub Actions con su protección de rama, IAM con OIDC, ECR con Terraform, Argo CD sobre EKS con cosign y la política de admisión).
5. Anota en la bitácora la falla, cuánto tardé, cuántas pistas usé y qué aprendí.

Repetimos con otra falla hasta que te diga que paremos. Para volver al estado sano entre fallas: `python romper.py --restaurar`. Antes de cambiar de rama, haz commit de `taller/progreso.json` y `BITACORA.md`.
