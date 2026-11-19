#!/usr/bin/env bash
# Prueba las 6 fallas sobre la carpeta que dejó probar.sh (todo en verde): por cada una, la mete, corre verificar.py
# (qué checks la delatan), mira lo que vería quien diagnostica, aplica el arreglo documentado y la cierra con
# romper.py --verificar. Al final prueba --restaurar con dos. Las salidas reales quedan en <carpeta>.fallas.log.
# Uso: bash probar-fallas.sh <carpeta-de-probar.sh> <venv>      (≈ 45 min)
set -uo pipefail
D="$1"; LOG="$D.fallas.log"
VENV=$(cd "${2:?falta el venv}" && pwd)
export PATH="$VENV/bin:$PATH" PYTHONUNBUFFERED=1 DOCKER_CONFIG=$D/.docker
: > "$LOG"
cd "$D" || exit 1
paso() { echo "### $1" | tee -a "$LOG"; shift; { "$@" 2>&1; c=$?; [ $c -ne 0 ] && echo "[código $c]"; } >> "$LOG"; echo >> "$LOG"; }
alertas() { curl -s localhost:9962/api/v1/alerts | python -c "import json,sys;a=json.load(sys.stdin)['data']['alerts'];[print(x['labels']['alertname'], x['labels'].get('severity',''), x['state']) for x in a] or print('(ninguna)')"; }
q() { curl -s localhost:9962/api/v1/query --data-urlencode "query=$1" | python -c "import json,sys;r=json.load(sys.stdin)['data']['result'];[print({k:v for k,v in x['metric'].items() if k!='instance'}, x['value'][1]) for x in r] or print('(vacío)')"; }
export -f alertas q
git add -A >/dev/null 2>&1; git commit -qm "lo de la estación 12" >/dev/null 2>&1

f=latido-perdido
paso "$f romper" python romper.py --mostrar --falla $f
sleep 30
paso "$f verificar ya" sh -c "python verificar.py alertmanager; curl -s localhost:8966/estado"
sleep 380
paso "$f verificar" python verificar.py alertmanager
paso "$f buscapersonas" sh -c "curl -s localhost:8966/estado; echo; python mundo/tickets.py avisos 2"
paso "$f prometheus" sh -c "alertas; q 'increase(prometheus_notifications_errors_total[1m])'; q 'prometheus_notifications_alertmanagers_discovered'; curl -s localhost:9962/api/v1/alertmanagers"
paso "$f log" sh -c "git log -1 -p --format='%h %an: %s' -- mundo/prometheus/prometheus.yml | grep -E '^[0-9a-f]{7}|^[-+][^-+]'"
paso "$f arreglo" sh -c 'git revert --no-edit HEAD | head -1 && python mundo/recargar.py prometheus && sleep 90 && curl -s localhost:8966/estado'
paso "$f cerrar" python romper.py --verificar

f=retencion-corta
paso "$f romper" python romper.py --mostrar --falla $f
paso "$f verificar" python verificar.py mundo baja-confianza
paso "$f historia" sh -c "q 'count_over_time(classifier_top1_score_count[8d])'; q 'count_over_time(classifier:low_confidence_share:rate30m[7d])'; q 'avg_over_time(classifier:low_confidence_share:rate30m[7d])'; curl -s localhost:9962/api/v1/status/flags | python -c \"import json,sys; print('retention', json.load(sys.stdin)['data']['storage.tsdb.retention.time'])\""
paso "$f log" sh -c "git log -1 -p --format='%h %an: %s' -- compose.yaml | grep -E '^[0-9a-f]{7}|^[-+][^-+]'"
paso "$f arreglo" sh -c 'git revert --no-edit HEAD | head -1 && docker compose up -d --wait prometheus 2>&1 | tail -1 && python mundo/historia.py metricas --de-nuevo && sleep 75 && python mundo/promtool.py rellenar && sleep 75'
paso "$f después" sh -c "q 'count_over_time(classifier_top1_score_count[8d])'; q 'count_over_time(classifier:low_confidence_share:rate30m[7d])'; q 'avg_over_time(classifier:low_confidence_share:rate30m[7d])'"
paso "$f cerrar" python romper.py --verificar

f=job-roto
paso "$f romper" python romper.py --mostrar --falla $f
paso "$f verificar" python verificar.py frescura
paso "$f cron" python mundo/cron.py estado
paso "$f pushgateway" sh -c "curl -s localhost:9964/metrics | grep -E '^(push_time_seconds|classifier_monitoreo_psi|classifier_monitoreo_dia)'; q 'time() - push_time_seconds{job=\"monitoreo-diario\"}'"
paso "$f log" sh -c "git log -1 -p --format='%h %an: %s' -- mundo/plataforma.yaml | grep -E '^[0-9a-f]{7}|^[-+][^-+]'"
paso "$f arreglo" sh -c 'git revert --no-edit HEAD | head -1 && python mundo/cron.py correr'
paso "$f cerrar" python romper.py --verificar

f=decode-nuevo
paso "$f romper" python romper.py --mostrar --falla $f
sleep 200
paso "$f verificar" python verificar.py en-vivo
paso "$f capas" python mundo/capas.py
paso "$f log" sh -c "git log -1 -p --format='%h %an: %s' -- gateway/app/preprocess.py | grep -E '^[0-9a-f]{7}|^[-+][^-+]'"
paso "$f arreglo" sh -c 'git revert --no-edit HEAD | head -1 && python mundo/servicios.py reiniciar gateway && sleep 220 && python mundo/capas.py'
paso "$f cerrar" python romper.py --verificar

f=app-nueva
paso "$f romper" python romper.py --mostrar --falla $f
sleep 200
paso "$f verificar" python verificar.py en-vivo
paso "$f capas" python mundo/capas.py
paso "$f log" sh -c "git log -1 -p --format='%h %an: %s' -- mundo/callers.json | grep -E '^[0-9a-f]{7}|^[-+][^-+]'"
paso "$f arreglo" sh -c 'git revert --no-edit HEAD | head -1 && sleep 220 && python mundo/capas.py'
paso "$f cerrar" python romper.py --verificar

f=examen-nuevo
paso "$f romper" python romper.py --mostrar --falla $f
paso "$f verificar" python verificar.py muestras
paso "$f log" sh -c "git log -1 -p --format='%h %an: %s' -- mundo/plataforma.yaml | grep -E '^[0-9a-f]{7}|^[-+][^-+]'"
paso "$f arreglo" python diario/muestras.py
paso "$f cerrar" python romper.py --verificar

paso "restaurar romper" python romper.py --falla job-roto
paso "restaurar" python romper.py --restaurar
paso "restaurar 2 romper" python romper.py --falla app-nueva
paso "restaurar 2" python romper.py --restaurar
paso "final" python verificar.py
echo "listo: $LOG"
