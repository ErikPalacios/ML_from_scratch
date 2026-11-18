#!/usr/bin/env bash
# Prueba las 6 fallas sobre la carpeta que dejó probar.sh (todo en verde): por cada una, la mete, corre verificar.py
# (qué checks la delatan), mira lo que vería quien diagnostica, aplica el arreglo documentado y la cierra con
# romper.py --verificar. Al final prueba --restaurar con dos. Las salidas reales quedan en <carpeta>.fallas.log.
# Uso: bash probar-fallas.sh <carpeta-de-probar.sh>      (≈ 30 min)
set -uo pipefail
D="$1"; LOG="$D.fallas.log"
: > "$LOG"
cd "$D" || exit 1
export KUBECONFIG=$PWD/.kube/config PYTHONUNBUFFERED=1
paso() { echo "### $1" | tee -a "$LOG"; shift; { "$@" 2>&1; c=$?; [ $c -ne 0 ] && echo "[código $c]"; } | grep -v '^Warning' >> "$LOG"; echo >> "$LOG"; }
sano() { kubectl argo rollouts -n classifier status gateway --timeout 300s >/dev/null 2>&1
         for d in $(kubectl -n classifier get deploy -l app.kubernetes.io/name=triton -o name); do kubectl -n classifier rollout status "$d" --timeout=300s >/dev/null 2>&1; done; }
pesos='kubectl -n dojo-alb exec deploy/alb -- python -c "import urllib.request as u;print(u.urlopen(\"http://localhost:8081\").read().decode())"'
git add -A >/dev/null 2>&1; git commit -qm "bitácora" >/dev/null 2>&1

f=peso-fantasma
paso "$f romper" python3 romper.py --mostrar --falla $f
paso "$f verificar" python3 verificar.py reparto servicio
paso "$f ingress" sh -c "kubectl -n classifier get ingress gateway -o jsonpath='{.spec.rules[0].http.paths[0].backend.service}{\"\n\"}'; $pesos"
paso "$f log" sh -c "git log -1 -p --format='%h %an: %s' -- k8s/kustomization.yaml | grep -E '^[0-9a-f]{7}|^\+'"
paso "$f arreglo" sh -c 'git revert --no-edit HEAD | head -1 && kubectl apply -k k8s/ | grep -v unchanged; sleep 3; '"$pesos"
paso "$f cerrar" python3 romper.py --verificar

f=bake-corto
paso "$f romper" python3 romper.py --mostrar --falla $f
paso "$f verificar" python3 verificar.py rollout bake
paso "$f spec" kubectl -n classifier get rollout gateway -o jsonpath='{.spec.strategy.canary.scaleDownDelaySeconds}{"\n"}'
paso "$f log" sh -c "git log -1 -p --format='%h %an: %s' -- k8s/kustomization.yaml | grep -E '^[0-9a-f]{7}|^\+'"
paso "$f arreglo" sh -c 'git revert --no-edit HEAD | head -1 && kubectl apply -k k8s/ | grep -v unchanged'
paso "$f cerrar" python3 romper.py --verificar

f=alias-atrasado
paso "$f romper" python3 romper.py --mostrar --falla $f
paso "$f verificar" python3 verificar.py alias bake
paso "$f registro" python3 mundo/modelos.py ver
paso "$f estable" sh -c "kubectl argo rollouts -n classifier get rollout gateway --no-color | sed -n 1,12p"
paso "$f arreglo" python3 ci/promover.py --esperar 0
paso "$f cerrar" python3 romper.py --verificar

f=par-cruzado
paso "$f romper" python3 romper.py --mostrar --falla $f
paso "$f verificar" python3 verificar.py par servicio
paso "$f imagenes" kubectl -n classifier get deploy triton-v14 triton-v15 -o custom-columns='NOMBRE:.metadata.name,IMAGEN:.spec.template.spec.containers[0].image'
paso "$f log" sh -c "git log -1 -p --format='%h %an: %s' -- k8s/kustomization.yaml | grep -E '^[0-9a-f]{7}|^[-+]  '"
paso "$f arreglo" sh -c 'git revert --no-edit HEAD | head -1 && kubectl apply -k k8s/ | grep -v unchanged && kubectl -n classifier rollout status deploy/triton-v15 --timeout=300s'
paso "$f cerrar" python3 romper.py --verificar

f=canary-dudoso
paso "$f romper" python3 romper.py --mostrar --falla $f
paso "$f verificar" python3 verificar.py rollout alias servicio
paso "$f rollout" sh -c "kubectl argo rollouts -n classifier get rollout gateway --no-color | sed -n 1,12p"
paso "$f analisis" sh -c "kubectl -n classifier get analysisrun --sort-by=.metadata.creationTimestamp | tail -2; R=\$(kubectl -n classifier get analysisrun --sort-by=.metadata.creationTimestamp -o name | tail -1); kubectl -n classifier get \$R -o json | python3 -c \"import json,sys; [print(m['name'], m['phase'], [x.get('value') for x in m.get('measurements', [])][-1:]) for m in json.load(sys.stdin)['status']['metricResults']]\""
paso "$f registro" python3 mundo/modelos.py ver
paso "$f log" git log --oneline -3
paso "$f arreglo" sh -c 'git revert --no-edit HEAD | head -1 && kubectl apply -k k8s/ | grep -v unchanged && kubectl argo rollouts -n classifier status gateway --timeout 120s'
paso "$f cerrar" python3 romper.py --verificar

f=fuga-en-el-bake
paso "$f romper" python3 romper.py --mostrar --falla $f
paso "$f verificar" python3 verificar.py servicio alias
paso "$f carga" sh -c "tail -3 .taller/carga-falla.log"
paso "$f errores" sh -c "curl -s localhost:9910/api/v1/query --data-urlencode 'query=sum by (modelo) (rate(classifier_requests_total{code=~\"5..\"}[1m])) / sum by (modelo) (rate(classifier_requests_total[1m]))' | python3 -m json.tool | grep -E 'modelo|\"0\\.'"
R15=$(git log -1 --format=%H --grep '^release 15')
paso "$f arreglo" sh -c "git revert --no-edit $R15 | head -1 && T0=\$(date +%s) && kubectl apply -k k8s/ | grep -v unchanged && kubectl argo rollouts -n classifier status gateway --timeout 120s && echo \"la 14 atiende el 100 % a los \$(( \$(date +%s) - T0 )) s\" && python3 ci/promover.py --esperar 0"
paso "$f confirmar" sh -c "sleep 20; python3 mundo/carga.py --por-segundo 40 --segundos 30"
paso "$f causa" sh -c "git log --oneline -4 && git log -1 -p --format='%h %an: %s' --grep CVE -- k8s/kustomization.yaml | grep -E '^[0-9a-f]{7}|^[-+]    digest'"
paso "$f cerrar" python3 romper.py --verificar
paso "$f despues" sh -c "python3 mundo/modelos.py ver; kubectl argo rollouts -n classifier get rollout gateway --no-color | sed -n 1,8p"

# --restaurar deja todo sano
for f in peso-fantasma alias-atrasado; do
  paso "$f restaurar-romper" python3 romper.py --falla $f
  paso "$f restaurar" python3 romper.py --restaurar
done
sano
paso "final" python3 verificar.py
echo "listo: $LOG"
