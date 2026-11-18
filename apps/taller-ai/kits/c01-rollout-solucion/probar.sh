#!/usr/bin/env bash
# La estación 10 de punta a punta, con la solución de referencia, en una carpeta limpia: los pasos del Guiado en orden
# y sus salidas reales en <carpeta>.log (de ahí las toma contenido.py). ≈ 40 min (la sombra, el ensayo y el canary
# esperan su tiempo con carga). Borra el clúster dojo-rollout y su registro si existen.
#
#   bash probar.sh /ruta/a/una/carpeta-nueva
set -uo pipefail
SOL=$(cd "$(dirname "$0")" && pwd); export SOL
KIT=$(cd "$SOL/../c01-rollout" && pwd)
D=${1:?uso: bash probar.sh <carpeta-nueva>}
LOG="$D.log"
rm -rf "$D" && cp -R "$KIT" "$D" && cd "$D" || exit 1
find . -name __pycache__ -prune -exec rm -rf {} +
: > "$LOG"
p() { echo "### $*" | tee -a "$LOG"; }
c() { echo "\$ $*" >> "$LOG"; ( eval "$@" ) >> "$LOG" 2>&1; local s=$?; [ $s -ne 0 ] && echo "[código $s]" >> "$LOG"; echo >> "$LOG"; return 0; }
ro() { kubectl argo rollouts -n classifier get rollout gateway --no-color; }
fase() { kubectl -n classifier get rollout gateway -o jsonpath='{.status.phase}'; }
pesos() { kubectl -n dojo-alb exec deploy/alb -- python -c "import urllib.request as u,json;d=json.load(u.urlopen('http://localhost:8081'));print(' · '.join(f\"{x['service']} {x['peso']} %\" for x in d['destinos']), '·', d['fuente'])"; }
corridas() { kubectl -n classifier get analysisrun -o json | python3 -c "
import json,sys
for a in sorted(json.load(sys.stdin)['items'], key=lambda a: a['metadata']['creationTimestamp']):
    st = a.get('status', {})
    print(a['metadata']['name'], st.get('phase'), st.get('message', ''))
    for m in st.get('metricResults', []):
        v = [x.get('value') for x in m.get('measurements', [])]
        print(f\"  {m['name']:<17} {m.get('phase'):<12} mediciones {len(v)} · última {v[-1] if v else '-'}\")"; }
# espera a que el Rollout llegue a una fase (Healthy, Degraded) o a un peso; deja en el log una foto cada vez que cambia
mirar() { local hasta=$1 tope=$2 t0=$SECONDS prev=""; while [ $((SECONDS - t0)) -lt "$tope" ]; do
    local ahora; ahora="$(fase) $(kubectl -n classifier get rollout gateway -o jsonpath='{.status.canary.weights.canary.weight}')"
    if [ "$ahora" != "$prev" ]; then echo "--- a los $((SECONDS - t0)) s: $ahora" >> "$LOG"; prev=$ahora; fi
    case "$hasta" in Degraded) [ "$(fase)" = "$hasta" ] && break ;;
      Healthy) [ "$(fase)" = "$hasta" ] && [ "$(kubectl -n classifier get rollout gateway -o jsonpath='{.status.stableRS}')" = "$(kubectl -n classifier get rollout gateway -o jsonpath='{.status.currentPodHash}')" ] && break ;;
      *) [ "${ahora#* }" = "$hasta" ] && break ;; esac; sleep 5; done
  echo "--- fin a los $((SECONDS - t0)) s: $(fase)" >> "$LOG"; }

p "paso 0: el mundo"
c "time python3 mundo/crear.py --de-cero"
export KUBECONFIG=$PWD/.kube/config
c python3 verificar.py mundo
c git log --oneline
c python3 mundo/modelos.py ver

p "paso 1: leer el mundo"
c kubectl -n classifier get deploy,svc,ingress
c kubectl -n argo-rollouts get pods
c kubectl argo rollouts version
c pesos
c "kubectl -n classifier get ingress gateway -o jsonpath='{.spec.rules[0].http.paths[0].backend.service}{\"\n\"}'"
c python3 mundo/carga.py --por-segundo 40 --segundos 15
c "curl -s 'localhost:9910/api/v1/query' --data-urlencode 'query=sum by (modelo, pod) (classifier_requests_total)' | python3 -m json.tool | head -30"

p "paso 2: triton-v15 sin tráfico"
cp "$SOL/k8s/triton-v15.yaml" k8s/
c kubectl apply -k k8s/
c "time kubectl -n classifier rollout status deploy/triton-v15 --timeout=180s"
c "kubectl -n classifier get pods -l app.kubernetes.io/name=triton -L classifier/modelo -o wide | cut -c1-140"
c kubectl -n classifier get pdb
c "kubectl -n classifier get endpointslices -l kubernetes.io/service-name=triton-v15"
c python3 verificar.py par
c "git add k8s && git commit -qm 'triton-v15: 1 pod, sin tráfico; su Service y su PDB en 0' && git log --oneline -1"

p "paso 3: la sombra en el gateway"
cp "$SOL/gateway/app/sombra.py" gateway/app/
c python3 verificar.py sombra-codigo
c "git add gateway && git commit -qm 'gateway: la sombra (hash del request_id, fila acotada, plazo propio)' && git log --oneline -1"
c python3 mundo/publicar.py gateway
python3 "$SOL/pasos.py" sombra > k8s/gateway.yaml
c "git diff --stat && git commit -qam 'gateway: prende la sombra hacia triton-v15 (10 %)' && git log --oneline -1"
c kubectl apply -k k8s/
c "kubectl -n classifier rollout status deploy/gateway --timeout=180s"
c "kubectl -n classifier logs deploy/gateway | grep -E 'sombra|gateway listo'"
c python3 mundo/carga.py --por-segundo 40 --segundos 330 --cada 60
c python3 mundo/logs.py --resumen
c "kubectl -n classifier logs deploy/gateway | grep '\"shadow\": true' | head -2"

p "paso 4: el reporte de la sombra"
cp "$SOL/sombra/reporte.py" sombra/
c "python3 mundo/logs.py > sombra/evidencia.jsonl && wc -l sombra/evidencia.jsonl"
c python3 sombra/reporte.py sombra/evidencia.jsonl
c "python3 -c \"import json; r=json.load(open('sombra/reporte.json')); print({k: r[k] for k in ('pares', 'acuerdo_top1', 'p99_razon', 'caidas', 'veredicto')})\""
c python3 verificar.py sombra
c "git add sombra && git commit -qm 'sombra: el reporte de la 15 (sigue al canary)' && git log --oneline -1"

p "paso 5: el Rollout"
python3 "$SOL/pasos.py" rollout > k8s/gateway.yaml
cp "$SOL/k8s/ingress.yaml" k8s/
c "git commit -qam 'gateway: de Deployment a Rollout de Argo; el Ingress reparte con los pesos de Argo' && git log --oneline -1"
c kubectl apply -k k8s/
c "kubectl argo rollouts -n classifier status gateway --timeout 180s"
c kubectl -n classifier get deploy,rs,pods -l app.kubernetes.io/name=gateway
c kubectl -n classifier delete deploy/gateway svc/gateway
c ro
c "kubectl -n classifier get ingress gateway -o jsonpath='{.metadata.annotations.alb\.ingress\.kubernetes\.io/actions\.gateway-stable}{\"\n\"}' | python3 -m json.tool"
c pesos
c "kubectl -n classifier get svc gateway-stable gateway-canary -o custom-columns='SERVICE:.metadata.name,SELECTOR:.spec.selector'"
c python3 verificar.py reparto sincronia

p "paso 6: el análisis"
cp "$SOL/k8s/analisis.yaml" k8s/
python3 "$SOL/pasos.py" rollout > /dev/null
python3 - <<'EOF2'
from pathlib import Path
sol = Path(__import__("os").environ["SOL"] + "/k8s/gateway.yaml").read_text()
a = sol[sol.index("      analysis:"):sol.index("      steps:")]
p = Path("k8s/gateway.yaml"); t = p.read_text()
p.write_text(t.replace("      steps:", a + "      steps:", 1))
EOF2
c "git add k8s && git commit -qm 'analisis: el Rollout corre canary-vs-estable de fondo' && git diff HEAD~1 --stat"
c kubectl apply -k k8s/
c kubectl -n classifier get analysistemplate
H=$(kubectl -n classifier get rollout gateway -o jsonpath='{.status.stableRS}')
c python3 mundo/carga.py --por-segundo 40 --segundos 200
c "curl -s localhost:9910/api/v1/query --data-urlencode 'query=sum(increase(classifier_top1_score_bucket{hash=\"$H\",le=\"0.3\"}[3m])) / sum(increase(classifier_top1_score_count{hash=\"$H\"}[3m]))' | python3 -c 'import json,sys; print(json.load(sys.stdin)[\"data\"][\"result\"][0][\"value\"][1])'"
c python3 verificar.py rollout analisis

p "paso 7: el ensayo con un modelo roto"
c python3 mundo/ensayo.py prender
python3 "$SOL/pasos.py" ensayo > k8s/gateway.yaml
c "git commit -qam 'ensayo: la release con el modelo roto' && git log --oneline -1"
ENSAYO=$(git rev-parse HEAD)
python3 mundo/carga.py --por-segundo 40 --segundos 480 --cada 30 > "$D.carga-ensayo.txt" 2>&1 &
CARGA=$!
sleep 5
c kubectl apply -k k8s/
sleep 20
c ro
c pesos
echo '$ (cada 5 s: fase y peso del canary)' >> "$LOG"
mirar Degraded 420
echo >> "$LOG"
c ro
c corridas
c pesos
c "kubectl -n classifier get events --field-selector involvedObject.kind=Rollout --sort-by=.lastTimestamp | tail -8"
kill $CARGA 2>/dev/null; wait $CARGA 2>/dev/null
c "cat $D.carga-ensayo.txt"
c python3 verificar.py sincronia rollout
c "git revert --no-edit $ENSAYO && git log --oneline -2"
c kubectl apply -k k8s/
c "kubectl argo rollouts -n classifier status gateway --timeout 120s"
c python3 mundo/ensayo.py apagar
c python3 verificar.py rollout sincronia

p "paso 8: el canary de la release 15"
python3 "$SOL/pasos.py" final > k8s/gateway.yaml
c "git diff | head -60"
c "git commit -qam 'release 15: el gateway habla con triton-v15 (resnet50-2026-11-01); sin sombra' && git log --oneline -1"
R15=$(git rev-parse HEAD)
python3 mundo/carga.py --por-segundo 40 --segundos 900 --cada 30 > "$D.carga-15.txt" 2>&1 &
CARGA=$!
sleep 5
c kubectl apply -k k8s/
sleep 30
c ro
c pesos
echo '$ (cada 5 s: fase y peso del canary)' >> "$LOG"
mirar 25 330
echo >> "$LOG"
c ro
c pesos
c corridas
mirar Healthy 400
echo >> "$LOG"
c ro
c corridas
c pesos
kill $CARGA 2>/dev/null; wait $CARGA 2>/dev/null
c "cat $D.carga-15.txt"

p "paso 9: promover, el bake y volver"
cp "$SOL/ci/promover.py" ci/
c "time python3 ci/promover.py"
c python3 mundo/modelos.py ver
c python3 ci/promover.py
python3 mundo/carga.py --por-segundo 40 --segundos 60 --cada 5 > "$D.carga-vuelta.txt" 2>&1 &
CARGA=$!
sleep 10
c "git revert --no-edit $R15 && git log --oneline -1"
T0=$SECONDS
c kubectl apply -k k8s/
mirar Healthy 120
echo "--- volver a la release 14 tardó $((SECONDS - T0)) s" >> "$LOG"
c ro
c python3 mundo/modelos.py alias champion 14
wait $CARGA 2>/dev/null
c "cat $D.carga-vuelta.txt"
python3 mundo/carga.py --por-segundo 40 --segundos 600 --cada 60 > "$D.carga-otra-vez.txt" 2>&1 &
CARGA=$!
sleep 5
c "git revert --no-edit HEAD && git log --oneline -1"
c kubectl apply -k k8s/
sleep 20
c ro
echo '$ (cada 5 s: fase y peso del canary)' >> "$LOG"
mirar Healthy 540
echo >> "$LOG"
c "time python3 ci/promover.py"
kill $CARGA 2>/dev/null; wait $CARGA 2>/dev/null
c "cat $D.carga-otra-vez.txt"
c ro
c python3 mundo/modelos.py ver
python3 - <<'EOF'
import re
from pathlib import Path
p = Path("k8s/triton-v15.yaml"); t = p.read_text()
t = t.replace("  replicas: 1                                    # la T4 de más: la sombra y el canary; al terminar el bake, 2",
              "  replicas: 2                                    # ya atiende todo: uno por zona")
t = t.replace("  minAvailable: 0                                # con 1 de 1, minAvailable: 1 bloquearía todo drain; con 2 pods, 1",
              "  minAvailable: 1                                # con 2 pods, un drain a la vez")
p.write_text(t)
p = Path("k8s/triton-v14.yaml"); t = p.read_text()
t = t.replace("  replicas: 2\n", "  replicas: 1                                    # el bake: viva para volver sin levantar nada\n", 1)
t = t.replace("  minAvailable: 1                                # con 2 pods, un drain a la vez; con 1 pod (en el bake), 0",
              "  minAvailable: 0                                # con 1 de 1 (el bake), 0")
p.write_text(t)
EOF
c "git diff --stat && git commit -qam 'bake: triton-v15 con 2 pods, triton-v14 con 1 (PDB 0) hasta que termine' && git log --oneline -1"
c kubectl apply -k k8s/
c "kubectl -n classifier rollout status deploy/triton-v15 --timeout=180s && kubectl -n classifier rollout status deploy/triton-v14 --timeout=180s"
c "kubectl -n classifier get pods -L classifier/modelo -o wide | cut -c1-150"
c ro
c python3 verificar.py bake alias
cp "$SOL/RUNBOOK.md" .
c "git add RUNBOOK.md ci && git commit -qm 'runbook y el job promover' && git log --oneline -1"

p "final: todos los checks"
c python3 verificar.py
c git log --oneline
echo "listo: $LOG"
