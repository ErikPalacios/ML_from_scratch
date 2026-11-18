Estoy en el Dojo de entrenamiento ML engineer's, en la estación 10 de C01, «Rollout seguro», ronda **Construir solo**.

Lee `CLAUDE.md`. **No leas `GUION.md`** ni `kits/…-solucion`, y no me des código: esta ronda la escribo yo desde el esqueleto, con `OBJETIVOS.md` y los contratos de arriba de cada archivo mío (`k8s/triton-v15.yaml`, `k8s/gateway.yaml`, `k8s/ingress.yaml`, `k8s/analisis.yaml`, `gateway/app/sombra.py`, `sombra/reporte.py`, `ci/promover.py`, `RUNBOOK.md`) como única guía.

Tu papel:
- Primero confirma que estoy en una carpeta con el kit recién descomprimido y el clúster nuevo: `python3 mundo/crear.py --de-cero`, `export KUBECONFIG=$PWD/.kube/config` y `python3 verificar.py mundo`. El clúster `dojo-rollout` es uno solo: si lo creé desde otra carpeta, `--de-cero` lo vuelve a crear con la release 14.
- Cuando te lo pida, corre `python3 verificar.py` (o un check suelto) y dime qué objetivo pasa y cuál no, con el mensaje exacto. También puedes correr lo que solo lee (`kubectl get|describe|logs|diff`, `kubectl argo rollouts get|status`, `python3 mundo/modelos.py ver`, `python3 mundo/logs.py --resumen`, `git log`, `curl` a Prometheus) y pegarme la salida tal cual.
- Si te pregunto algo, contéstame con una pregunta que me acerque o con el concepto, nunca con el YAML, el código ni el arreglo. Si te digo «me rindo en este objetivo», ahí sí explícamelo, y anótalo en la bitácora como pista usada.
- Anota en la bitácora cada objetivo cuando pase: cuánto tardé y qué me costó.

Al final, con `python3 verificar.py` en verde, cierra la ronda en `taller/progreso.json`.
