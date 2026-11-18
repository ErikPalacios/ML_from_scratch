#!/usr/bin/env bash
# Prueba las 6 fallas sobre la carpeta que dejó probar.sh (todo en verde): por cada una, la mete, corre verificar.py
# (qué checks la delatan), mira lo que vería quien diagnostica, aplica el arreglo documentado y la cierra con
# romper.py --verificar. Al final prueba --restaurar con dos. Las salidas reales quedan en <carpeta>.fallas.log.
# Uso: bash probar-fallas.sh <carpeta-de-probar.sh>      (≈ 20 min)
set -uo pipefail
D="$1"; LOG="$D.fallas.log"
: > "$LOG"
cd "$D" || exit 1
export KUBECONFIG=$PWD/.kube/config PYTHONUNBUFFERED=1
paso() { echo "### $1" | tee -a "$LOG"; shift; { "$@" 2>&1; c=$?; [ $c -ne 0 ] && echo "[código $c]"; } | grep -v '^Warning' >> "$LOG"; echo >> "$LOG"; }
nolisto() { kubectl -n classifier get pods -l "app.kubernetes.io/name=$1" -o json | python3 -c "import json,sys; print(next((p['metadata']['name'] for p in json.load(sys.stdin)['items'] if not all(c.get('ready') for c in p['status'].get('containerStatuses', [{}]))), ''))"; }
listo() { kubectl -n classifier rollout status deploy/triton --timeout=400s >/dev/null 2>&1; kubectl -n classifier rollout status deploy/gateway --timeout=200s >/dev/null 2>&1; }
git add -A >/dev/null 2>&1; git commit -qm "bitácora" >/dev/null 2>&1
# Con el HPA arriba (después del paso 8) los nodos de CPU están llenos y un pod nuevo no cabe: se espera a que baje a 3.
until [ "$(kubectl -n classifier get hpa gateway -o jsonpath='{.status.currentReplicas}')" = 3 ]; do sleep 15; done
sleep 130   # «estable» pide 2 min sin reinicios

f=memoria-corta
paso "$f romper" python3 romper.py --mostrar --falla $f
paso "$f verificar" python3 verificar.py recursos gateway estable
paso "$f pods" kubectl -n classifier get pods -l app.kubernetes.io/name=gateway
P=$(nolisto gateway)
paso "$f describe" sh -c "kubectl -n classifier describe pod $P | grep -E -A4 'Last State|Limits' | head -12"
paso "$f log" sh -c "git log -1 -p --format='%h %an: %s' -- k8s/kustomization.yaml | grep -E '^[0-9a-f]{7}|^\+'"
paso "$f arreglo" sh -c 'git revert --no-edit HEAD | head -1 && kubectl apply -k k8s/ | grep -v unchanged'
listo
paso "$f cerrar" python3 romper.py --verificar

f=sin-requests
paso "$f romper" python3 romper.py --mostrar --falla $f
paso "$f verificar" python3 verificar.py recursos hpa
paso "$f hpa" sh -c "kubectl -n classifier get hpa gateway; kubectl -n classifier describe hpa gateway | sed -n '/^Conditions:/,/^Events:/p'"
paso "$f arreglo" sh -c 'git revert --no-edit HEAD | head -1 && kubectl apply -k k8s/ | grep -v unchanged'
listo; sleep 60
paso "$f cerrar" python3 romper.py --verificar

f=sin-endpoints
paso "$f romper" python3 romper.py --mostrar --falla $f
paso "$f verificar" python3 verificar.py servicio gateway
paso "$f endpoints" sh -c "kubectl -n classifier get endpointslices -l kubernetes.io/service-name=gateway; kubectl -n classifier get svc gateway -o jsonpath='{.spec.selector}{\"\n\"}'; kubectl -n classifier get pods -l app.kubernetes.io/name=gateway --show-labels --no-headers | head -1"
paso "$f arreglo" sh -c 'git revert --no-edit HEAD | head -1 && kubectl apply -k k8s/ | grep -v unchanged'
sleep 3
paso "$f cerrar" python3 romper.py --verificar

f=zona-acordonada
paso "$f romper" python3 romper.py --mostrar --falla $f
paso "$f verificar" python3 verificar.py triton estable
paso "$f estado" python3 mundo/cluster.py estado
P=$(nolisto triton)
paso "$f describe" sh -c "kubectl -n classifier describe pod $P | sed -n '/^Events:/,\$p'"
paso "$f arreglo" sh -c "kubectl uncordon \$(kubectl get nodes -l workload=gpu-t4,topology.kubernetes.io/zone=us-east-1b -o name)"
listo
paso "$f cerrar" python3 romper.py --verificar

f=registro-caido
paso "$f romper" python3 romper.py --mostrar --falla $f
paso "$f verificar" python3 verificar.py imagenes servicio estable
P=$(nolisto gateway)
paso "$f describe" sh -c "kubectl -n classifier get pods -l app.kubernetes.io/name=gateway; kubectl -n classifier describe pod $P | sed -n '/^Events:/,\$p' | tail -6"
paso "$f estado" sh -c 'python3 mundo/cluster.py estado | head -1'
paso "$f arreglo" sh -c "python3 mundo/cluster.py registro arrancar && kubectl -n classifier delete pod $P"
listo
paso "$f cerrar" python3 romper.py --verificar

f=arranque-lento
paso "$f romper" python3 romper.py --mostrar --falla $f
paso "$f verificar" python3 verificar.py triton probes estable
P=$(nolisto triton)
paso "$f pods" kubectl -n classifier get pods -l app.kubernetes.io/name=triton
paso "$f describe" sh -c "kubectl -n classifier describe pod $P | sed -n '/^Events:/,\$p' | tail -8"
paso "$f logs" sh -c "kubectl -n classifier logs $P | head -4"
paso "$f arreglo" sh -c "sed -i '' 's/failureThreshold: 12/failureThreshold: 30/; s/5 s × 12 = 60 s para cargar el engine (tarda ≈ 20 s)/5 s × 30 = 150 s para cargar el engine (tarda ≈ 75 s)/' k8s/triton.yaml && git commit -qam 'triton: startup de 150 s para el engine de 75 s' && kubectl apply -k k8s/ | grep -v unchanged && time kubectl -n classifier rollout status deploy/triton --timeout=400s"
listo
paso "$f cerrar" python3 romper.py --verificar

# --restaurar deja todo sano
for f in sin-endpoints zona-acordonada; do
  paso "$f restaurar-romper" python3 romper.py --falla $f
  paso "$f restaurar" python3 romper.py --restaurar
done
listo; sleep 30
paso "final" python3 verificar.py
echo "listo: $LOG"
