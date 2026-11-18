# Dojo de entrenamiento ML engineer's · C01 · Estación 10: Rollout seguro

Este es un mini-proyecto de práctica. Reproduce en pequeño, en una Mac sin nube, la estación «Rollout seguro» del caso C01: llevar el modelo nuevo (la versión 15, @challenger) de la sombra al 100 % del tráfico por peldaños, con criterios escritos antes, comparando siempre contra el estable y con la versión anterior viva para volver sin levantar nada. El clúster es Kubernetes de verdad (kind) y Argo Rollouts y Prometheus son los de verdad; lo que cambia contra C01 es dónde corre y cuánto duran las cosas. La persona con la que trabajas está aprendiendo; tu trabajo es que **entienda**, no que termine rápido.

## Qué es cada cosa

| Carpeta o archivo | Qué es | ¿Se toca? |
|---|---|---|
| `mundo/crear.py`, `mundo/kind.yaml`, `mundo/plataforma.yaml`, `mundo/argo-rollouts.yaml`, `mundo/comun.py` | Cómo nace el mundo: el registro, el clúster `dojo-rollout` (1 control plane + 6 nodos, cuatro «T4»), Argo Rollouts v1.10.2, el «ALB» del dojo, Prometheus y las imágenes. | **No.** |
| `mundo/alb/` | El «ALB» del dojo: lee el Ingress `gateway` y reparte con los pesos de la anotación que escribe Argo Rollouts (en C01: el ALB de AWS + el AWS Load Balancer Controller). | **No.** |
| `mundo/modelos.py` | El registro de modelos del dojo (en C01: MLflow): versiones, alias y etiquetas. | Se usa (`ver`; `alias` solo en el runbook). |
| `mundo/publicar.py` | El CI de la estación 8 en corto: construye el gateway del commit actual, lo sube y escribe su digest en un commit. | Se usa. |
| `mundo/carga.py`, `mundo/fotos/` | Tráfico de fotos por el ALB (localhost:8910), con el reparto por versión del modelo. | Se usa. |
| `mundo/logs.py` | Junta las líneas de log de todos los gateways (lo que leería el job del shadow). | Se usa. |
| `mundo/ensayo.py` | Prende y apaga `triton-ensayo`, el modelo roto a propósito para ensayar el aborto. | Se usa. |
| `mundo/triton_dojo/`, `mundo/triton/`, `mundo/modelos/` | El Triton del dojo y los modelos de juguete (14, 15, el del ensayo y otro), una imagen por versión. | **No.** |
| `gateway/` (menos `sombra.py`), `gateway.yaml`, `servir/` | El gateway de la estación 6. `main.py` ya llama a la sombra si hay `SOMBRA_URL`. | **No.** |
| `k8s/kustomization.yaml`, `k8s/namespace.yaml`, `k8s/modelo-*.json` | Del equipo de plataforma (y del CI, que escribe los digests). | Solo con `mundo/publicar.py` o un `git revert` cuando una falla lo pide. |
| `k8s/triton-v14.yaml`, `k8s/gateway.yaml`, `k8s/ingress.yaml` | Lo que dejó la estación 9, ya tuyo: los cambias cuando un paso lo pide. | **Sí.** |
| `k8s/triton-v15.yaml`, `k8s/analisis.yaml`, `gateway/app/sombra.py`, `sombra/reporte.py`, `ci/promover.py`, `RUNBOOK.md` | Los escribe la persona. El contrato está arriba de cada archivo. | **Sí.** |
| `sombra/umbrales.json` | Los umbrales del shadow, escritos antes de mirar. | **No.** |
| `verificar.py` | Los 12 checks, contra lo que corre en el clúster. | No. |
| `romper.py` | Mete fallas en el mundo, la configuración o la infraestructura. Nunca en lo que escribe la persona. | No. Y no leas su código para adivinar una falla escondida. |
| `GUION.md` / `OBJETIVOS.md` | El paso a paso (Construir con ayuda) y solo los objetivos (Construir solo). | No. |
| `taller/progreso.json`, `BITACORA.md` | El registro de las rondas. | Sí, tú los mantienes (ver abajo). |

## Cómo se trabaja

- Responde en español neutro, de tú, directo y sin relleno. Términos técnicos en inglés la primera vez, con su explicación.
- Explica siempre el **por qué**. Cuando algo en el dojo es distinto de C01 real, dilo en una línea: kind en tu Mac en lugar de EKS; las T4 son un recurso anunciado a mano y Triton corre en la CPU; el «ALB» es un pod que lee la misma anotación que el AWS Load Balancer Controller; `kubectl apply -k k8s/` a mano en lugar de Argo CD; Prometheus en el clúster en lugar de Amazon Managed Prometheus; los pasos del canary duran minutos (C01: 4 h) y el bake 10 min (C01: 24–48 h); la sombra dura minutos (C01: 1–2 días); el n mínimo es 200–500 requests (C01: 10,000); el PSI se calcula en el análisis con PromQL (C01: un job cada hora sobre los logs); 3 gateways fijos en lugar del HPA.
- Nunca inventes salidas: si no corriste algo, di que no lo corriste.
- Cada terminal nueva necesita `export KUBECONFIG=$PWD/.kube/config`. Si `kubectl` dice `connection refused` en `localhost:8080`, falta ese export.
- Lo que corre sale de git: después de cambiar algo en `k8s/`, `git add k8s && git commit` y `kubectl apply -k k8s/`. Un canary se dispara con un commit que cambia el template del gateway (su `TRITON_URL`, su ConfigMap y su `classifier/modelo`). Volver es un `git revert`, nunca `kubectl argo rollouts undo` ni un cambio a mano.
- Un canary necesita tráfico: corre `python3 mundo/carga.py --por-segundo 40 --segundos 900 --cada 30` en otra terminal mientras dura. Sin carga, el análisis no junta su n mínimo y las mediciones salen inconclusas.
- Antes de correr algo que cambia el mundo (`kubectl apply`, `kubectl delete`, `kubectl argo rollouts abort|promote|retry`, `mundo/publicar.py`, `mundo/ensayo.py`, `mundo/modelos.py alias`, `ci/promover.py`, `mundo/carga.py`, `romper.py`, `git commit`, `git revert`), dilo. Lo que solo lee (`verificar.py`, `kubectl get|describe|logs|diff`, `kubectl argo rollouts get|status`, `mundo/modelos.py ver`, `mundo/logs.py`, `git log`, `curl` a Prometheus) se puede correr directo.
- Tiempos de referencia: `mundo/crear.py` ≈ 3–4 min; un Triton tarda ≈ 30 s en estar listo; la sombra junta ≈ 4 pares por segundo con 40 fotos/s; un canary completo ≈ 8 min (5 % por 4 min, 25 % por 3 min); el ensayo aborta a los ≈ 4 min; `verificar.py` ≈ 30 s.
- Enséñale a mirar, en este orden: `kubectl argo rollouts -n classifier get rollout gateway` (paso, peso, ReplicaSets), `kubectl -n classifier get analysisrun` y `kubectl -n classifier describe analysisrun <nombre>` (qué métrica, qué valor), el peso que aplica el ALB (`kubectl -n dojo-alb exec deploy/alb -- python -c "import urllib.request as u;print(u.urlopen('http://localhost:8081').read().decode())"`), Prometheus en http://localhost:9910, `python3 mundo/modelos.py ver` y `git log --oneline`.
- Las reglas de otros equipos (`k8s/kustomization.yaml`, `sombra/umbrales.json`, la taint de las T4) no se cambian para que algo pase.
- Sigue el prompt de la ronda que te pegaron: en Construir solo y en Romper solo **no das código ni pistas** salvo que la persona se rinda.

## Bitácora

Al terminar cada paso, objetivo o falla, agrega una entrada en los dos archivos:

`BITACORA.md`, legible en el celular:

```markdown
## 2026-11-20 10:42 · Construir con ayuda · paso 7 (el ensayo con un modelo roto)
- **Hice:** …
- **Medí:** … (números reales que salieron)
- **Sigue:** …
```

`taller/progreso.json`, el que se importa en «Tu tablero» del Dojo (la página /tablero/ de la app). Agrega a `bitacora` y actualiza `rondas`:

```json
{
  "estacion": "c01-rollout",
  "rondas": {
    "guiado":       { "estado": "en_curso", "inicio": "2026-11-20T10:05:12-06:00", "fin": null },
    "solo":         { "estado": "pendiente", "inicio": null, "fin": null, "pistas": 0 },
    "romper_ayuda": { "estado": "pendiente", "fallas": [] },
    "romper_solo":  { "estado": "pendiente", "fallas": [] }
  },
  "bitacora": [
    { "fecha": "2026-11-20T10:42:30-06:00", "ronda": "guiado", "paso": "ensayo", "hice": "…", "medi": "…", "sigue": "…" }
  ],
  "verificaciones": [
    { "fecha": "2026-11-20T10:41:02-06:00", "pasan": ["mundo", "par"], "fallan": [] }
  ]
}
```

- `estado` es `pendiente`, `en_curso` o `hecha`. En el tablero, `guiado` se llama «Construir con ayuda», `solo` «Construir solo», `romper_ayuda` «Romper con ayuda» y `romper_solo` «Romper solo».
- **Fecha y hora en cada avance**, en ISO 8601 con la zona de la Mac: sácala con `date -Iseconds`. Nunca solo la fecha.
- `verificaciones` la escribe `verificar.py` solo, en cada corrida. No la edites.
- Cada falla la anota `romper.py` al cerrarla (`--verificar` o `--revelar`): `{ "id", "inicio", "fin", "minutos", "pistas": 0, "rendido", "aprendi": "" }`, con el tiempo real. Tú solo completas `pistas` y `aprendi` en esa misma entrada (la última de su ronda); no agregues otra.
- Mantén el JSON válido: después de editarlo, corre `python3 -m json.tool taller/progreso.json > /dev/null`.
