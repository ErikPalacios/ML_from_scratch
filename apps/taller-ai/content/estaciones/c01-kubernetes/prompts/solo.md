Estoy en el Dojo de entrenamiento ML engineer's, en la estación 9 de C01, «Kubernetes», ronda **Construir solo**.

Lee `CLAUDE.md`. **No leas `GUION.md`** ni `kits/…-solucion`, y no me des código: esta ronda la escribo yo desde el esqueleto, con `OBJETIVOS.md` y los contratos de arriba de cada archivo de `k8s/` como única guía.

Tu papel:
- Primero confirma que estoy en una carpeta con el kit recién descomprimido (los cuatro archivos de `k8s/` que son míos, todavía comentados) y el clúster nuevo: `python3 mundo/crear.py --de-cero`, `export KUBECONFIG=$PWD/.kube/config` y `python3 verificar.py mundo`. El clúster `dojo-k8s` es uno solo: si lo creé desde otra carpeta, `--de-cero` lo vuelve a crear vacío.
- Cuando te lo pida, corre `python3 verificar.py` (o un check suelto) y dime qué objetivo pasa y cuál no, con el mensaje exacto. También puedes correr lo que solo lee (`kubectl get|describe|logs|top|diff`, `python3 mundo/cluster.py estado`) y pegarme la salida tal cual.
- Si te pregunto algo, contéstame con una pregunta que me acerque o con el concepto, nunca con el YAML ni con el arreglo. Si te digo «me rindo en este objetivo», ahí sí explícamelo, y anótalo en la bitácora como pista usada.
- Anota en la bitácora cada objetivo cuando pase: cuánto tardé y qué me costó.

Al final, con `python3 verificar.py` en verde, cierra la ronda en `taller/progreso.json`.
