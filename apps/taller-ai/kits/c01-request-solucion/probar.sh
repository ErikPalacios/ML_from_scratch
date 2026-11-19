#!/usr/bin/env bash
# La estación 11 de punta a punta, con la solución de referencia, en una carpeta limpia: los pasos del Guiado en orden
# y sus salidas reales en <carpeta>.log (de ahí las toma contenido.py). ≈ 15 min. Apaga el mundo de otra corrida.
#
#   bash probar.sh /ruta/a/una/carpeta-nueva /ruta/al/venv
set -uo pipefail
SOL=$(cd "$(dirname "$0")" && pwd); export SOL
KIT=$(cd "$SOL/../c01-request" && pwd)
D=${1:?uso: bash probar.sh <carpeta-nueva> <venv>}
VENV=$(cd "${2:?falta el venv}" && pwd)
export PATH="$VENV/bin:$PATH" PYTHONUNBUFFERED=1
LOG="$D.log"
if [ -d "$D" ]; then (cd "$D" && python mundo/nodo.py parar >/dev/null 2>&1; DOCKER_CONFIG=$D/.docker docker compose down -v -t 2 >/dev/null 2>&1); fi
rm -rf "$D" && cp -R "$KIT" "$D" && cd "$D" || exit 1
find . -name __pycache__ -prune -exec rm -rf {} +
: > "$LOG"
p() { echo "### $*" | tee -a "$LOG"; }
c() { echo "\$ $*" >> "$LOG"; ( eval "$@" ) >> "$LOG" 2>&1; local s=$?; [ $s -ne 0 ] && echo "[código $s]" >> "$LOG"; echo >> "$LOG"; return 0; }
q() { curl -s localhost:9952/api/v1/query --data-urlencode "query=$1" | python -c "
import json,sys
d=json.load(sys.stdin)
if d['status']!='success': print(d); sys.exit()
for r in d['data']['result'] or [{'metric': {}, 'value': [0, '(vacío)']}]:
    m={k: v for k, v in r['metric'].items() if k not in ('instance',)}
    print(('{' + ', '.join(f'{k}=\"{v}\"' for k, v in m.items()) + '}') if m else '{}', r['value'][1])"; }
export -f q
recargar() { python mundo/recargar.py prometheus >> "$LOG" 2>&1; echo >> "$LOG"; }
export DOCKER_CONFIG=$D/.docker

p "paso 0: el mundo"
c "time python mundo/crear.py"
c python verificar.py mundo
c python mundo/nodo.py estado
c python mundo/carga.py --una
c python mundo/nodo.py logs a 4
c python verificar.py

p "paso 1: el request_id y la línea de log"
python "$SOL/pasos.py" rastro 1 > gateway/app/rastro.py
c python mundo/recargar.py gateway
c python mundo/carga.py --una
c python mundo/nodo.py logs b 3
RID=$(python - <<'EOF'
import json; print([json.loads(l) for l in open("logs/backend.log")][-1]["request_id"])
EOF
)
c python mundo/buscar.py "$RID" --sin-s3
c "curl -s -i -X POST localhost:8951/v1/classify -H 'Content-Type: text/plain' -H 'X-Request-ID: con espacios' --data 'hola' | grep -iE '^HTTP|x-request-id'"
c python verificar.py request-id linea-log

p "paso 2: tres relojes"
c python mundo/carga.py --tasa 40 --segundos 30 --basura 0
c python mundo/relojes.py 1000

p "paso 3: lo que suma cada request"
python "$SOL/pasos.py" rastro 3 > gateway/app/rastro.py
c python mundo/recargar.py gateway
c python mundo/carga.py --tasa 20 --segundos 10
c "curl -s localhost:8951/metrics | grep -E '^classifier_requests_total|^classifier_request_seconds_(bucket|count|sum)' | grep 'source=\"mobile\"' | head -20"
c "curl -s localhost:8951/metrics | grep -c '^classifier_'"
c python mundo/carga.py --tasa 20 --segundos 10 --fuente-loca
c "curl -s localhost:8951/metrics | grep -c '^classifier_'"
c "curl -s localhost:8951/metrics | grep '^classifier_requests_total' | grep -o 'source=\"[a-z]*\"' | sort | uniq -c"
c python verificar.py metricas series-acotadas

p "paso 4: Prometheus lee los pods"
c "curl -s localhost:9952/api/v1/targets | python -c \"import json,sys;[print(t['labels']['job'], t['scrapeUrl'], t['health']) for t in json.load(sys.stdin)['data']['activeTargets']]\""
c "python -m json.tool nodo/descubrimiento/pods.json | head -24"
# primero, la trampa: leer por los Services (los dos eligen los mismos pods)
# (lo que hace un ServiceMonitor: leer los endpoints de cada Service y ponerle la etiqueta service)
sed -e 's#descubrimiento/pods.json#descubrimiento/servicios.json#' "$SOL/observabilidad/prometheus.yml" > observabilidad/prometheus.yml
echo '      - {source_labels: [__meta_kubernetes_service_name], target_label: service}' >> observabilidad/prometheus.yml
c "tail -3 observabilidad/prometheus.yml"
recargar
python mundo/carga.py --tasa 20 --segundos 40 >/dev/null 2>&1
c "q 'count by (pod) (up{job=\"gateway\"})'"
c "q 'sum(rate(classifier_requests_total[30s]))'"
c "q 'sum(rate(alb_request_count_total[30s]))'"
cp "$SOL/observabilidad/prometheus.yml" observabilidad/prometheus.yml
recargar
sleep 35
c "curl -s localhost:9952/api/v1/targets | python -c \"import json,sys;[print(t['labels'].get('pod'), t['labels'].get('nodo'), t['labels'].get('hash'), t['scrapeUrl'], t['health']) for t in json.load(sys.stdin)['data']['activeTargets'] if t['labels']['job']=='gateway']\""
c "q 'up{job=\"gateway\"}'"
c "q 'sum(rate(classifier_requests_total[30s]))'"
c "q 'sum(rate(alb_request_count_total[30s]))'"
c "q 'count by (__name__) ({job=\"gateway\", __name__=~\"classifier_.*\"})'"
c python verificar.py prometheus-lee

p "paso 5: PromQL y las recording rules"
python "$SOL/pasos.py" reglas 5 > observabilidad/reglas.yml
recargar
python mundo/carga.py --tasa 20 --segundos 65 --basura 0.05 >/dev/null 2>&1
c "q 'classifier:requests:rate1m'"
c "q 'classifier:errores_servidor:ratio_rate1m'"
c "q 'sum(rate(classifier_requests_total{code=~\"5..\"}[1m])) / sum(rate(classifier_requests_total{code!~\"4..\"}[1m]))'"
c "q 'classifier:latencia:p99_1m'"
c "q 'sum(rate(classifier_requests_total{code=\"200\"}[1m])) / sum(rate(classifier_requests_total[1m]))'"
# un reinicio: el contador del pod a vuelve a 0
c "q 'sum by (pod) (classifier_requests_total{code=\"200\"})'"
c python mundo/nodo.py matar a
python mundo/carga.py --tasa 20 --segundos 25 >/dev/null 2>&1
c "q 'sum by (pod) (classifier_requests_total{code=\"200\"})'"
c "q 'sum(rate(classifier_requests_total{code=\"200\"}[1m]))'"
c "q 'rate(sum(classifier_requests_total{code=\"200\"})[1m:5s])'"
c "q 'resets(classifier_requests_total{code=\"200\",source=\"mobile\"}[2m])'"
c python verificar.py consultas

p "paso 6: del p99 a una request: exemplars"
cp "$SOL/gateway/app/rastro.py" gateway/app/rastro.py
c python mundo/recargar.py gateway
c python mundo/carga.py --tasa 30 --segundos 30
c "curl -s -H 'Accept: application/openmetrics-text; version=1.0.0' localhost:8951/metrics | grep 'trace_id' | head -3"
curl -s localhost:9952/api/v1/query_exemplars --data-urlencode 'query=classifier_request_seconds_bucket' --data-urlencode "start=$(($(date +%s)-120))" --data-urlencode "end=$(date +%s)" > logs/exemplars.json
EX=$(cat logs/exemplars.json)
c "curl -s localhost:9952/api/v1/query_exemplars --data-urlencode 'query=classifier_request_seconds_bucket' --data-urlencode \"start=\$((\$(date +%s)-120))\" --data-urlencode \"end=\$(date +%s)\" > logs/exemplars.json"
c "python -c \"import json,sys;d=json.load(sys.stdin)['data'];ex=[(float(e['value']),e['labels']['trace_id'],s['seriesLabels']['le']) for s in d for e in s['exemplars']];ex.sort(reverse=True);print(len(ex),'exemplars en 2 min');[print(f'{v*1000:6.1f} ms  le={le:<6} trace_id={t}') for v,t,le in ex[:5]]\" < logs/exemplars.json"
LENTA=$(echo "$EX" | python -c "import json,sys;d=json.load(sys.stdin)['data'];ex=[(float(e['value']),e['labels']['trace_id']) for s in d for e in s['exemplars']];print(max(ex)[1])")
c python mundo/buscar.py "$LENTA" --sin-s3
c python verificar.py reglas-de-conteo

p "paso 7: el camino del log a S3"
cp "$SOL/observabilidad/fluent-bit.conf" observabilidad/fluent-bit.conf
python "$SOL/pasos.py" reglas 7 > observabilidad/reglas.yml
recargar
c python mundo/recargar.py fluent-bit
python mundo/carga.py --tasa 20 --segundos 70 >/dev/null 2>&1
c "docker compose logs fluent-bit-a 2>&1 | grep -E 'inotify_fs_add|uploaded' | cut -c1-220 | tail -4"
c "curl -s localhost:9953/api/v2/metrics/prometheus | grep -E '^fluentbit_(input_records|output_proc_records|output_errors|output_retries)_total'"
c "python -c \"
import sys; sys.path.insert(0, '.')
from datetime import datetime, timezone
from mundo.comun import objetos
h = datetime.now(timezone.utc)
for o in objetos(f'logs/crudo/{h:%Y/%m/%d/%H}/')[-4:]: print(o['Key'], o['Size'], 'B')\""
RID2=$(python - <<'EOF'
import json; print([json.loads(l) for l in open("logs/backend.log")][-300]["request_id"])
EOF
)
c python mundo/buscar.py "$RID2"
c "q 'time() - dojo_s3_ultimo_objeto_timestamp_seconds'"
# el simulacro: S3 se cae y la request no se entera
c docker compose stop s3
c python mundo/carga.py --tasa 20 --segundos 90
c "docker compose logs fluent-bit-a --since 90s 2>&1 | grep -iE 'error|retry|fail' | cut -c1-200 | tail -4"
c "curl -s localhost:9953/api/v2/metrics/prometheus | grep -E '^fluentbit_output_(proc_records|errors|retries|retries_failed)_total'"
c "q 'time() - dojo_s3_ultimo_objeto_timestamp_seconds'"
c python verificar.py log-en-s3
sleep 100
c "curl -s localhost:9952/api/v1/alerts | python -c \"import json,sys;[print(a['labels']['alertname'], a['labels'].get('nodo',''), a['state']) for a in json.load(sys.stdin)['data']['alerts']]\""
c docker compose start s3
sleep 30
c "docker compose logs fluent-bit-a --since 30s 2>&1 | grep -E 'uploaded' | cut -c1-200 | tail -4"
c "curl -s localhost:9953/api/v2/metrics/prometheus | grep -E '^fluentbit_output_(proc_records|errors|retries|retries_failed)_total'"
c python verificar.py log-en-s3

p "paso 8: el job diario: del crudo a Parquet"
cp "$SOL/diario/a_parquet.py" diario/a_parquet.py
c "time python diario/a_parquet.py"
c python diario/a_parquet.py
c "python -c \"
import sys, duckdb; sys.path.insert(0, '.')
from datetime import datetime, timedelta, timezone
from mundo.comun import BUCKET, PREDICCIONES, objetos, s3
dia = (datetime.now(timezone.utc) - timedelta(days=1)).date()
c = s3()
for o in objetos(f'{PREDICCIONES}dt={dia}/'):
    c.download_file(BUCKET, o['Key'], f'logs/{o[\\\"Key\\\"].split(\\\"=\\\")[2].split(\\\"/\\\")[0]}.parquet')
con = duckdb.connect()
print(con.sql(\\\"SELECT model_version, count(*) AS filas, round(quantile_cont(ms_total, 0.99), 1) AS p99_ms, round(avg(CASE WHEN status >= 500 THEN 1 ELSE 0 END) * 100, 2) AS pct_5xx, round(avg(score), 3) AS score_medio FROM 'logs/resnet50-*.parquet' GROUP BY 1 ORDER BY 1\\\"))
print(con.sql(\\\"SELECT hour(hora) AS hora_utc, model_version, count(*) AS filas FROM 'logs/resnet50-*.parquet' WHERE hour(hora) BETWEEN 15 AND 16 GROUP BY 1, 2 ORDER BY 1, 2\\\"))
print(con.sql(\\\"DESCRIBE SELECT * FROM 'logs/resnet50-2026-11-01.parquet'\\\").fetchall()[:6])\""
c python verificar.py parquet

p "paso 9: lo que el gateway no ve"
cp "$SOL/observabilidad/reglas.yml" observabilidad/reglas.yml
recargar
c python verificar.py alertas
c python mundo/nodo.py parar triton
sleep 6
c python mundo/carga.py --tasa 20 --segundos 50
c "tail -1 logs/alb.log"
c "curl -s localhost:8957/metrics | grep -E '^alb_(request_count_total|httpcode_elb_total\{code=\"503\"\}|healthy_host_count)'"
c "q 'classifier:errores_servidor:ratio_rate1m'"
c "q 'sum(rate(classifier_requests_total[1m]))'"
c "q 'sum(rate(alb_httpcode_elb_total{code=\"503\"}[1m]))'"
c "curl -s localhost:9952/api/v1/alerts | python -c \"import json,sys;[print(a['labels']['alertname'], a['state']) for a in json.load(sys.stdin)['data']['alerts']]\""
c python verificar.py de-punta-a-punta
c python mundo/nodo.py arrancar triton
sleep 75
c "curl -s localhost:9952/api/v1/alerts | python -c \"import json,sys;[print(a['labels']['alertname'], a['state']) for a in json.load(sys.stdin)['data']['alerts']]\""
c python verificar.py

p "fin"
c "git status --short | head"
echo "listo: $LOG"
