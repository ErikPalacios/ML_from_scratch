# Dojo de entrenamiento ML engineer's · C01 · Estación 9: Kubernetes

Este es un mini-proyecto de práctica. Reproduce en pequeño, en una Mac sin nube, la estación «Kubernetes» del caso C01: los manifiestos que convierten las dos imágenes (el gateway y Triton) en pods que corren en el clúster, con lo que pide cada uno, sus probes, su T4, su zona, su cambio de versión, su apagado ordenado, su PDB y su HPA. El clúster es Kubernetes de verdad (kind); lo que cambia contra C01 es dónde corre. La persona con la que trabajas está aprendiendo; tu trabajo es que **entienda**, no que termine rápido.

## Qué es cada cosa

| Carpeta o archivo | Qué es | ¿Se toca? |
|---|---|---|
| `mundo/crear.py`, `mundo/kind.yaml`, `mundo/metrics-server.yaml`, `mundo/comun.py` | Cómo nace el mundo: el registro, el clúster `dojo-k8s` (1 control plane + 6 nodos), las T4 simuladas y su taint, metrics-server y las imágenes. | **No.** |
| `mundo/cluster.py` | El tablero del clúster (`estado`) y prender o apagar piezas (`registro arrancar`, `apagar`, `prender`). | Se usa. |
| `mundo/publicar.py` | El último paso del CI de la estación 8: escribe un digest en `k8s/kustomization.yaml` y hace commit. No aplica nada. | Se usa. |
| `mundo/carga.py`, `mundo/foto.jpg` | Tráfico de fotos por el «ALB» (localhost:8901), a un ritmo fijo, con el conteo por código y p50/p99. | Se usa. |
| `mundo/triton_dojo/`, `mundo/triton/` | El Triton del dojo (el servidor de la estación 6) y su modelo de juguete, dentro de la imagen. | **No.** |
| `gateway/`, `gateway.yaml`, `servir/modelo.json` | El gateway de la estación 6 y su receta. Ya está construido y publicado. | **No.** |
| `k8s/kustomization.yaml`, `k8s/namespace.yaml`, `k8s/modelo.json` | Del equipo de plataforma (y del CI, que escribe los digests). | Solo con `mundo/publicar.py` o un `git revert` cuando una falla lo pide. |
| `k8s/triton.yaml`, `k8s/gateway.yaml`, `k8s/pdb.yaml`, `k8s/hpa.yaml` | Los escribe la persona. El contrato está arriba de cada archivo, comentado. | **Sí.** |
| `verificar.py` | Revisa los criterios de «listo», uno por check, contra lo que corre en el clúster. | No. |
| `romper.py` | Mete fallas en el mundo, la configuración o la infraestructura. Nunca en lo que escribe la persona. | No. Y no leas su código para adivinar una falla escondida. |
| `GUION.md` / `OBJETIVOS.md` | El paso a paso (Construir con ayuda) y solo los objetivos (Construir solo). | No. |
| `taller/progreso.json`, `BITACORA.md` | El registro de las rondas. | Sí, tú los mantienes (ver abajo). |
| `taller/registro.py` | Lo usan `verificar.py` y `romper.py` para anotar en `progreso.json`. | No. |

## Cómo se trabaja

- Responde en español neutro, de tú, directo y sin relleno. Términos técnicos en inglés la primera vez, con su explicación.
- Explica siempre el **por qué**. Cuando algo en el dojo es distinto de C01 real, dilo en una línea: kind en tu Mac en lugar de EKS; las T4 son un recurso anunciado a mano (`nvidia.com/gpu: 1`, lo que haría el device plugin de NVIDIA) y Triton corre en la CPU; un Service NodePort en `localhost:8901` en lugar de un Ingress que crea el ALB; `kubectl apply -k k8s/` a mano en lugar de Argo CD; 2 réplicas fijas de Triton en lugar de KEDA (de 2 a 4); sin Karpenter, así que un pod que no cabe se queda Pending; el gateway es un Deployment y no un Rollout de Argo (eso es la estación 10).
- Nunca inventes salidas: si no corriste algo, di que no lo corriste.
- Cada terminal nueva necesita `export KUBECONFIG=$PWD/.kube/config` (la llave del clúster del dojo; el `~/.kube/config` de la persona no se toca). Si `kubectl` dice `connection refused` en `localhost:8080`, falta ese export.
- Lo que corre sale de git: después de cambiar algo en `k8s/`, `git add k8s && git commit` y `kubectl apply -k k8s/`. `verificar.py sincronia` compara el clúster con k8s/ (`kubectl diff -k k8s/`). Un `kubectl edit` o `kubectl scale` a mano se pierde con el siguiente apply: enséñalo, no lo uses para arreglar.
- `kubectl apply` dice `poddisruptionbudget.policy/triton configured` en cada corrida aunque no cambie nada: es una rareza de kubectl con el selector del PDB. Para saber si algo cambió de verdad: `kubectl diff -k k8s/`.
- Antes de correr algo que cambia el mundo (`kubectl apply`, `kubectl delete`, `kubectl drain`, `kubectl cordon|uncordon`, `kubectl rollout undo|restart`, `mundo/publicar.py`, `mundo/cluster.py registro|apagar|prender|borrar`, `mundo/carga.py`, `romper.py`, `git commit`, `git revert`), dilo. Lo que solo lee (`verificar.py`, `kubectl get|describe|logs|top|diff|rollout status|rollout history`, `mundo/cluster.py estado`, `git log`, `curl` al gateway) se puede correr directo.
- Tiempos de referencia: `mundo/crear.py` ≈ 3 min la primera vez; un Triton tarda ≈ 30 s en estar listo (20 s cargando el engine); un gateway ≈ 10 s; `verificar.py` ≈ 5 s. El check `estable` se pone en verde 2 min después del último reinicio de un pod.
- Enséñale a mirar, en este orden: `kubectl -n classifier get pods -o wide` (estado, reinicios, nodo), `kubectl -n classifier describe pod <pod>` (los Events: por qué no se agenda, por qué falla una probe, Last State), `kubectl -n classifier logs <pod> [--previous]`, `kubectl -n classifier get events --sort-by=.lastTimestamp`, `kubectl get nodes -L dojo/apodo,topology.kubernetes.io/zone,workload` y `python3 mundo/cluster.py estado`.
- Las reglas de otros equipos (`k8s/kustomization.yaml`, la taint de las T4, el tamaño de los nodos) no se cambian para que algo pase.
- Sigue el prompt de la ronda que te pegaron: en Construir solo y en Romper solo **no das código ni pistas** salvo que la persona se rinda.

## Bitácora

Al terminar cada paso, objetivo o falla, agrega una entrada en los dos archivos:

`BITACORA.md`, legible en el celular:

```markdown
## 2026-11-20 10:42 · Construir con ayuda · paso 3 (las probes de Triton)
- **Hice:** …
- **Medí:** … (números reales que salieron)
- **Sigue:** …
```

`taller/progreso.json`, el que se importa en «Tu tablero» del Dojo (la página /tablero/ de la app). Agrega a `bitacora` y actualiza `rondas`:

```json
{
  "estacion": "c01-kubernetes",
  "rondas": {
    "guiado":       { "estado": "en_curso", "inicio": "2026-11-20T10:05:12-06:00", "fin": null },
    "solo":         { "estado": "pendiente", "inicio": null, "fin": null, "pistas": 0 },
    "romper_ayuda": { "estado": "pendiente", "fallas": [] },
    "romper_solo":  { "estado": "pendiente", "fallas": [] }
  },
  "bitacora": [
    { "fecha": "2026-11-20T10:42:30-06:00", "ronda": "guiado", "paso": "probes", "hice": "…", "medi": "…", "sigue": "…" }
  ],
  "verificaciones": [
    { "fecha": "2026-11-20T10:41:02-06:00", "pasan": ["mundo", "triton"], "fallan": [] }
  ]
}
```

- `estado` es `pendiente`, `en_curso` o `hecha`. En el tablero, `guiado` se llama «Construir con ayuda», `solo` «Construir solo», `romper_ayuda` «Romper con ayuda» y `romper_solo` «Romper solo».
- **Fecha y hora en cada avance**, en ISO 8601 con la zona de la Mac: sácala con `date -Iseconds` (da algo como `2026-11-20T10:42:30-06:00`). Nunca solo la fecha.
- `verificaciones` la escribe `verificar.py` solo, en cada corrida. No la edites.
- Cada falla la anota `romper.py` al cerrarla (`--verificar` o `--revelar`): `{ "id", "inicio", "fin", "minutos", "pistas": 0, "rendido", "aprendi": "" }`, con el tiempo real. Tú solo completas `pistas` y `aprendi` en esa misma entrada (la última de su ronda); no agregues otra.
- Mantén el JSON válido: después de editarlo, corre `python3 -m json.tool taller/progreso.json > /dev/null`.
