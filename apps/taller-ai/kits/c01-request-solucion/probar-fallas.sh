#!/usr/bin/env bash
# Prueba las 6 fallas sobre la carpeta que dejó probar.sh (todo en verde): por cada una, la mete, corre verificar.py
# (qué checks la delatan), mira lo que vería quien diagnostica, aplica el arreglo documentado y la cierra con
# romper.py --verificar. Al final prueba --restaurar con dos. Las salidas reales quedan en <carpeta>.fallas.log.
# Uso: bash probar-fallas.sh <carpeta-de-probar.sh> <venv>      (≈ 15 min)
set -uo pipefail
D="$1"; LOG="$D.fallas.log"
VENV=$(cd "${2:?falta el venv}" && pwd)
export PATH="$VENV/bin:$PATH" PYTHONUNBUFFERED=1 DOCKER_CONFIG=$D/.docker
: > "$LOG"
cd "$D" || exit 1
paso() { echo "### $1" | tee -a "$LOG"; shift; { "$@" 2>&1; c=$?; [ $c -ne 0 ] && echo "[código $c]"; } >> "$LOG"; echo >> "$LOG"; }
alertas() { curl -s localhost:9952/api/v1/alerts | python -c "import json,sys;a=json.load(sys.stdin)['data']['alerts'];[print(x['labels']['alertname'], x['labels'].get('nodo',''), x['state']) for x in a] or print('(ninguna)')"; }
q() { curl -s localhost:9952/api/v1/query --data-urlencode "query=$1" | python -c "import json,sys;r=json.load(sys.stdin)['data']['result'];[print({k:v for k,v in x['metric'].items() if k!='instance'}, x['value'][1]) for x in r] or print('(vacío)')"; }
export -f alertas q
git add -A >/dev/null 2>&1; git commit -qm "lo de la estación 11" >/dev/null 2>&1

f=etiqueta-sin-techo
paso "$f romper" python romper.py --mostrar --falla $f
paso "$f carga" python mundo/carga.py --tasa 20 --segundos 20
paso "$f verificar" python verificar.py series-acotadas metricas
paso "$f metrics" sh -c "curl -s localhost:8951/metrics | grep -c '^classifier_request_debug_seconds_bucket'; curl -s localhost:8951/metrics | grep '^classifier_request_debug_seconds_count' | head -2"
paso "$f prometheus" sh -c "q 'count({__name__=~\"classifier_request_debug_seconds.*\"})'; q 'prometheus_tsdb_head_series'"
paso "$f log" sh -c "git log -1 -p --format='%h %an: %s' -- gateway/app/main.py | grep -E '^[0-9a-f]{7}|^\+[^+]'"
paso "$f arreglo" sh -c 'git revert --no-edit HEAD | head -1 && python mundo/nodo.py reiniciar gateway'
paso "$f cerrar" python romper.py --verificar

f=monitor-perdido
paso "$f romper" python romper.py --mostrar --falla $f
sleep 40
paso "$f verificar" python verificar.py prometheus-lee alertas
paso "$f descubrimiento" sh -c "python -c \"import json;[print(t['targets'], t['labels'].get('__meta_kubernetes_pod_label_app_kubernetes_io_name')) for t in json.load(open('nodo/descubrimiento/pods.json'))]\""
paso "$f up" sh -c "q 'up{job=\"gateway\"}'; q 'classifier:errores_servidor:ratio_rate1m'; alertas"
paso "$f log" sh -c "git log -1 -p --format='%h %an: %s' -- mundo/plataforma.yaml | grep -E '^[0-9a-f]{7}|^[-+][^-+]'"
paso "$f arreglo" sh -c 'git revert --no-edit HEAD | head -1 && python mundo/nodo.py publicar && sleep 70'
paso "$f cerrar" python romper.py --verificar

f=s3-caido
paso "$f romper" python romper.py --mostrar --falla $f
paso "$f verificar" python verificar.py log-en-s3 de-punta-a-punta
paso "$f fluent" sh -c "sleep 40; docker compose logs fluent-bit-a --since 40s 2>&1 | grep -iE 'error|fail' | cut -c1-180 | tail -3; curl -s localhost:9953/api/v2/metrics/prometheus | grep -E '^fluentbit_output_(retries|errors)_total'"
paso "$f ps" docker compose ps s3 --all --format '{{.Service}} {{.State}} {{.Status}}'
paso "$f arreglo" sh -c 'docker compose start s3 && sleep 25 && docker compose logs fluent-bit-a --since 25s 2>&1 | grep uploaded | cut -c1-160 | tail -2'
paso "$f cerrar" python romper.py --verificar

f=lector-caido
paso "$f romper" python romper.py --mostrar --falla $f
paso "$f verificar" python verificar.py log-en-s3
paso "$f ps" docker compose ps --all --format '{{.Service}} {{.State}}'
sleep 190
paso "$f alerta" sh -c "alertas; q 'time() - dojo_s3_ultimo_objeto_timestamp_seconds'"
paso "$f arreglo" sh -c 'docker compose start fluent-bit-b && sleep 75 && docker compose logs fluent-bit-b --since 75s 2>&1 | grep uploaded | cut -c1-160 | tail -2'
paso "$f cerrar" python romper.py --verificar

f=triton-caido
paso "$f romper" python romper.py --mostrar --falla $f
sleep 45
paso "$f verificar" python verificar.py mundo de-punta-a-punta
paso "$f metricas" sh -c "q 'sum(rate(classifier_requests_total[1m]))'; q 'classifier:errores_servidor:ratio_rate1m'; curl -s localhost:8957/metrics | grep -E '^alb_(httpcode_elb_total\{code=\"503\"\}|healthy_host_count)'; tail -1 logs/alb.log; alertas"
paso "$f estado" python mundo/nodo.py estado
paso "$f arreglo" sh -c 'python mundo/nodo.py arrancar triton && sleep 70'
paso "$f cerrar" python romper.py --verificar

f=llave-rotada
paso "$f romper" python romper.py --mostrar --falla $f
sleep 20
paso "$f verificar" python verificar.py mundo de-punta-a-punta
paso "$f alb" sh -c "curl -s localhost:8957/metrics | grep -E '^alb_httpcode_elb_total\{code=\"401\"\}'; tail -1 logs/alb.log"
paso "$f log" sh -c "git log -1 -p --format='%h %an: %s' -- mundo/plataforma.yaml | grep -E '^[0-9a-f]{7}|^[-+][^-+]'"
paso "$f arreglo" sh -c 'git revert --no-edit HEAD | head -1 && python mundo/nodo.py reiniciar alb && sleep 70'
paso "$f cerrar" python romper.py --verificar

paso "restaurar romper" python romper.py --falla etiqueta-sin-techo
paso "restaurar" python romper.py --restaurar
paso "restaurar 2 romper" python romper.py --falla llave-rotada
paso "restaurar 2" python romper.py --restaurar
paso "final" python verificar.py
echo "listo: $LOG"
