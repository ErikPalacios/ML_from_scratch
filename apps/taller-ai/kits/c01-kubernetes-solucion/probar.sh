#!/usr/bin/env bash
# La estación 9 de punta a punta, con la solución de referencia, en una carpeta limpia: los pasos del Guiado en orden
# y sus salidas reales en <carpeta>.log (de ahí las toma contenido.py). ≈ 15 min. Borra el clúster dojo-k8s y su
# registro si existen.
#
#   bash probar.sh /ruta/a/una/carpeta-nueva
set -uo pipefail
SOL=$(cd "$(dirname "$0")" && pwd)
KIT=$(cd "$SOL/../c01-kubernetes" && pwd)
D=${1:?uso: bash probar.sh <carpeta-nueva>}
LOG="$D.log"
rm -rf "$D" && cp -R "$KIT" "$D" && cd "$D" || exit 1
find . -name __pycache__ -prune -exec rm -rf {} +
: > "$LOG"
p() { echo "### $*" | tee -a "$LOG"; }
c() { echo "\$ $*" >> "$LOG"; ( eval "$@" ) >> "$LOG" 2>&1; local s=$?; [ $s -ne 0 ] && echo "[código $s]" >> "$LOG"; echo >> "$LOG"; return 0; }
pod() { kubectl -n classifier get pods -l "app.kubernetes.io/name=$1" -o jsonpath="{.items[${2:-0}].metadata.name}"; }

p "paso 0: el mundo"
c "time python3 mundo/crear.py --de-cero"
export KUBECONFIG=$PWD/.kube/config
c python3 verificar.py mundo
c git log --oneline

p "paso 1: el clúster"
c kubectl get nodes -L dojo/apodo,topology.kubernetes.io/zone,workload
c "kubectl get nodes -l workload -o custom-columns='NODO:.metadata.name,CPU:.status.allocatable.cpu,MEMORIA:.status.allocatable.memory,T4:.status.allocatable.nvidia\.com/gpu'"
c "kubectl describe node dojo-k8s-worker3 | grep -E '^Taints|nvidia.com/gpu|^  cpu|^  memory'"
c kubectl -n kube-system get pods -o wide --no-headers -l k8s-app=kindnet
c "kubectl describe node dojo-k8s-worker | sed -n '/Allocated resources/,/memory/p'"
c python3 mundo/cluster.py estado

p "paso 2: Triton"
cp "$SOL/k8s/triton.yaml" k8s/
c kubectl apply -k k8s/
c "time kubectl -n classifier rollout status deploy/triton --timeout=180s"
c kubectl -n classifier get pods -o wide
c "git add k8s && git commit -qm 'triton: 2 pods con una T4 cada uno, uno por zona' && git log --oneline -1"

p "paso 3: las probes de Triton"
T=$(pod triton)
c kubectl -n classifier logs "$T"
c "kubectl -n classifier describe pod $T | sed -n '/^Events:/,\$p'"
c "kubectl -n classifier get pod $T -o jsonpath='{.status.qosClass}{\"\n\"}'"

p "paso 4: el gateway y su HPA"
cp "$SOL/k8s/gateway.yaml" "$SOL/k8s/hpa.yaml" k8s/
c kubectl apply -k k8s/
c "time kubectl -n classifier rollout status deploy/gateway --timeout=180s"
sleep 20
c kubectl -n classifier get pods -o wide
c kubectl -n classifier get endpointslices -l kubernetes.io/service-name=gateway
c "curl -s -w '\nHTTP %{http_code} en %{time_total} s\n' -H 'Content-Type: image/jpeg' --data-binary @mundo/foto.jpg localhost:8901/v1/classify"
c "git add k8s && git commit -qm 'gateway: Deployment, Service y HPA' && git log --oneline -1"
c "kubectl describe node dojo-k8s-worker | sed -n '/Allocated resources/,/memory/p'"

p "paso 5: una versión nueva, bajo carga"
c python3 mundo/publicar.py gateway nueva
python3 mundo/carga.py --por-segundo 40 --segundos 75 --cada 15 > "$D.carga5" 2>&1 &
CARGA=$!
sleep 5
c kubectl apply -k k8s/
c "time kubectl -n classifier rollout status deploy/gateway --timeout=180s"
wait $CARGA
c cat "$D.carga5"
c kubectl -n classifier get rs -l app.kubernetes.io/name=gateway
c kubectl -n classifier rollout history deploy/gateway

p "paso 6: la versión que no arranca"
c python3 mundo/publicar.py gateway mala
c kubectl apply -k k8s/
c "time kubectl -n classifier rollout status deploy/gateway --timeout=200s"
c kubectl -n classifier get pods -l app.kubernetes.io/name=gateway
M=$(kubectl -n classifier get pods -l app.kubernetes.io/name=gateway -o json | python3 -c "import json,sys; print(next(p['metadata']['name'] for p in json.load(sys.stdin)['items'] if not all(c.get('ready') for c in p['status'].get('containerStatuses', []))))")
c "kubectl -n classifier logs $M --previous | tail -5"
c "kubectl -n classifier get deploy gateway -o jsonpath='{range .status.conditions[*]}{.type}={.status} {.reason}{\"\n\"}{end}'"
c "curl -s -o /dev/null -w 'HTTP %{http_code}\n' -H 'Content-Type: image/jpeg' --data-binary @mundo/foto.jpg localhost:8901/v1/classify"
c "git revert --no-edit HEAD && git log --oneline -3"
c kubectl apply -k k8s/
c "time kubectl -n classifier rollout status deploy/gateway --timeout=180s"
c kubectl -n classifier get rs -l app.kubernetes.io/name=gateway

p "paso 7: el PDB y un drain"
cp "$SOL/k8s/pdb.yaml" k8s/
c kubectl apply -k k8s/
c kubectl -n classifier get pdb triton
c "git add k8s && git commit -qm 'triton: PDB minAvailable 1' && git log --oneline -1"
A=$(kubectl -n classifier get pod "$(pod triton 0)" -o jsonpath='{.spec.nodeName}')
B=$(kubectl -n classifier get pod "$(pod triton 1)" -o jsonpath='{.spec.nodeName}')
kubectl drain "$A" --ignore-daemonsets --delete-emptydir-data --timeout=150s > "$D.drain1" 2>&1 &
DR=$!
sleep 3
c "time kubectl drain $B --ignore-daemonsets --delete-emptydir-data --timeout=150s 2>&1 | grep -v '^Warning'"
wait $DR
c "grep -v '^Warning' $D.drain1"
c kubectl -n classifier get pods -o wide -l app.kubernetes.io/name=triton
c kubectl uncordon "$A" "$B"

p "paso 8: el HPA en un pico"
python3 mundo/carga.py --por-segundo 60 --segundos 180 --cada 30 --12mp > "$D.carga8" 2>&1 &
CARGA=$!
for i in 1 2 3 4 5 6; do sleep 28; c "kubectl -n classifier get hpa gateway --no-headers; kubectl top pods -n classifier -l app.kubernetes.io/name=gateway --no-headers"; done
wait $CARGA
c cat "$D.carga8"
c "kubectl -n classifier describe hpa gateway | sed -n '/^Events:/,\$p'"
c python3 mundo/cluster.py estado

p "final"
sleep 60
c python3 verificar.py
echo "listo: $LOG"
