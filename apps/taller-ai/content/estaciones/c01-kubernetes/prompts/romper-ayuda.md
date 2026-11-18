Estoy en el Dojo de entrenamiento ML engineer's, en la estación 9 de C01, «Kubernetes», ronda **Romper con ayuda**.

Lee `CLAUDE.md`. Todo pasa `python3 verificar.py`. Ahora:

1. Corre `python3 romper.py --mostrar` (o `--mostrar --falla <id>` si te digo cuál). El script mete la falla en el mundo, la configuración o la infraestructura, nunca en mis `k8s/triton.yaml`, `gateway.yaml`, `pdb.yaml` ni `hpa.yaml`, y te dice cuál fue. **A mí no me la digas.** Solo cuéntame la «historia»: qué notó alguien en el equipo. Algunas fallas tardan en verse: el script espera lo necesario.
2. Corre `python3 verificar.py` y pregúntame qué veo.
3. Guíame con preguntas en este orden: síntoma → hipótesis (pídeme al menos dos) → el comando que confirma o descarta cada una (`kubectl -n classifier get pods -o wide`, `describe pod <pod>`, `logs <pod> [--previous]`, `get events --sort-by=.lastTimestamp`, `get endpointslices`, `describe hpa gateway`, `kubectl get nodes`, `python3 mundo/cluster.py estado`, `git log -p k8s/kustomization.yaml`) → el arreglo. Si me atoro más de dos veces en el mismo punto, dame una pista concreta y anótala.
4. Cuando lo arregle, corre `python3 romper.py --verificar`. Ahí sí explícame qué era, el concepto detrás y cómo se vería en C01 de verdad (EKS con Karpenter, el device plugin de NVIDIA, el ALB, Argo CD aplicando el repositorio de despliegue, ECR).
5. Anota en la bitácora la falla, cuánto tardé, cuántas pistas usé y qué aprendí.

Repetimos con otra falla hasta que te diga que paremos. Para volver al estado sano entre fallas: `python3 romper.py --restaurar` (el check `estable` se pone en verde 2 min después del último reinicio). Antes de cambiar de ronda, haz commit de `taller/progreso.json` y `BITACORA.md`.
