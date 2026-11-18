Estoy en el Dojo de entrenamiento ML engineer's, en la estación 9 de C01, «Kubernetes», ronda **Construir con ayuda**.

Lee primero `CLAUDE.md` y `GUION.md` de esta carpeta. Vamos a escribir juntos, siguiendo los pasos 0 a 8 de `GUION.md`, los cuatro manifiestos que llevan el gateway y Triton al clúster: leer el clúster (nodos, zonas, lo asignable, las T4 y su taint); Triton con una T4 por pod, uno por zona; sus tres probes; el gateway con su Service y su HPA; una versión nueva bajo carga sin perder fotos; una versión que no arranca y la vuelta atrás con `git revert`; el PDB con dos drains a la vez, y el HPA en un pico.

Entre el paso 0 y el 1, `GUION.md` trae los «Precálculos»: las cuentas de servilleta de la estación. Pídeme que haga cada cuenta yo primero, corrígeme y después corre el comando que la comprueba (o dime en qué paso se va a confirmar).

En cada paso:
1. Dime el objetivo en una línea y explícame los conceptos que usa desde cero, rápido, con una analogía y con el término en inglés. Doy por sabido Python y PyTorch, no Kubernetes.
2. Escribe conmigo el archivo del paso, por bloques y con el porqué de cada campo. No me pegues el archivo entero de golpe. El contrato de arriba de cada archivo manda.
3. Dime qué comando correr y espera a que te pegue la salida. Los que cambian algo (`kubectl apply`, `kubectl delete`, `kubectl drain`, `kubectl cordon|uncordon`, `kubectl rollout undo|restart`, `mundo/publicar.py`, `mundo/carga.py`, `mundo/cluster.py registro|apagar|prender|borrar`, `git commit`, `git revert`) no los corras tú sin decírmelo antes.
4. Corre `python3 verificar.py <checks del paso>` y explícame el resultado. Mira conmigo, en este orden: `kubectl -n classifier get pods -o wide`, `kubectl -n classifier describe pod <pod>` (los Events y Last State), `kubectl -n classifier logs <pod> [--previous]` y `python3 mundo/cluster.py estado`.
5. Anota el paso en la bitácora (sección «Bitácora» de `CLAUDE.md`) con lo que hice, lo que medí y lo que sigue.

Recuerda que cada terminal nueva necesita `export KUBECONFIG=$PWD/.kube/config`, y que lo que corre sale de git: commit y `kubectl apply -k k8s/`, nunca un `kubectl edit`. Si algo falla, no lo arregles en silencio: muéstrame el error, dime tu hipótesis y arreglémoslo juntos. Al final, corre `python3 verificar.py` completo y cierra la ronda en `taller/progreso.json`.
