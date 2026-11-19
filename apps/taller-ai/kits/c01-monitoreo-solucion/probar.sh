#!/usr/bin/env bash
# La estación 12 de punta a punta, con la solución de referencia, en una carpeta limpia: los pasos del Guiado en orden
# y sus salidas reales en <carpeta>.log (de ahí las toma contenido.py). ≈ 25 min. Apaga el mundo de otra corrida.
#
#   bash probar.sh /ruta/a/una/carpeta-nueva /ruta/al/venv
set -uo pipefail
SOL=$(cd "$(dirname "$0")" && pwd); export SOL
KIT=$(cd "$SOL/../c01-monitoreo" && pwd)
D=${1:?uso: bash probar.sh <carpeta-nueva> <venv>}
VENV=$(cd "${2:?falta el venv}" && pwd)
export PATH="$VENV/bin:$PATH" PYTHONUNBUFFERED=1
LOG="$D.log"
if [ -d "$D" ]; then (cd "$D" && python mundo/servicios.py parar >/dev/null 2>&1; DOCKER_CONFIG=$D/.docker docker compose down -v -t 2 >/dev/null 2>&1); fi
rm -rf "$D" && cp -R "$KIT" "$D" && cd "$D" || exit 1
find . -name __pycache__ -prune -exec rm -rf {} +
: > "$LOG"
p() { echo "### $*" | tee -a "$LOG"; }
c() { echo "\$ $*" >> "$LOG"; ( eval "$@" ) >> "$LOG" 2>&1; local s=$?; [ $s -ne 0 ] && echo "[código $s]" >> "$LOG"; echo >> "$LOG"; return 0; }
q() { curl -s localhost:9962/api/v1/query --data-urlencode "query=$1" | python -c "
import json,sys
d=json.load(sys.stdin)
if d['status']!='success': print(d); sys.exit()
for r in d['data']['result'] or [{'metric': {}, 'value': [0, '(vacío)']}]:
    m={k: v for k, v in r['metric'].items() if k not in ('instance',)}
    print(('{' + ', '.join(f'{k}=\"{v}\"' for k, v in m.items()) + '}') if m else '{}', r['value'][1])"; }
alertas() { curl -s localhost:9962/api/v1/alerts | python -c "import json,sys;a=json.load(sys.stdin)['data']['alerts'];[print(x['labels']['alertname'], x['labels'].get('severity',''), x['state'], x.get('activeAt','')[:19]) for x in a] or print('(ninguna)')"; }
export -f q alertas
export DOCKER_CONFIG=$D/.docker
AYER=$(python -c "from mundo.comun import ayer; print(ayer())" 2>/dev/null)

p "paso 0: el mundo"
c "time python mundo/crear.py"
AYER=$(python -c "from mundo.comun import ayer; print(ayer())")
c python verificar.py mundo
c python mundo/servicios.py estado
c "sleep 200; python mundo/capas.py"
c "q 'sum(rate(classifier_requests_total[1h]))'"
c "q 'count_over_time(classifier_top1_score_count[8d])'"
c python verificar.py

p "paso 1: el presupuesto y el burn rate"
python "$SOL/pasos.py" reglas 1 > observabilidad/reglas.yml
c python mundo/promtool.py revisar
c python mundo/recargar.py prometheus
c "sleep 20; q 'classifier:error_ratio:rate5m'; q 'classifier:error_ratio:rate1h'; q 'classifier:error_ratio:rate6h'"
c "q 'classifier:error_ratio:rate1h / 0.001'"
c alertas
c python verificar.py reglas burn-rate

p "paso 2: probar sin esperar"
python "$SOL/pasos.py" pruebas 2 > observabilidad/pruebas.yml
c "time python mundo/promtool.py prueba"
cp observabilidad/reglas.yml /tmp/reglas-dojo-12.yml
sed -i '' 's/and classifier:error_ratio:rate5m > (14.4 \* 0.001)/# (sin la ventana corta)/' observabilidad/reglas.yml
c python mundo/promtool.py prueba
cp /tmp/reglas-dojo-12.yml observabilidad/reglas.yml
c python verificar.py burn-rate

p "paso 3: la baja confianza"
python "$SOL/pasos.py" reglas 3 > observabilidad/reglas.yml
c python mundo/recargar.py prometheus
c "sleep 20; q 'classifier:low_confidence_share:rate30m'; q 'count_over_time(classifier:low_confidence_share:rate30m[7d])'; q 'avg_over_time(classifier:low_confidence_share:rate30m[7d])'"
c python verificar.py baja-confianza
c python mundo/historia.py ventana
c "time python mundo/promtool.py rellenar"
c "sleep 75; q 'count_over_time(classifier:low_confidence_share:rate30m[7d])'; q 'avg_over_time(classifier:low_confidence_share:rate30m[7d])'; q 'min_over_time(classifier:low_confidence_share:rate30m[7d])'; q 'max_over_time(classifier:low_confidence_share:rate30m[7d])'"
c python verificar.py baja-confianza

p "paso 4: de la alerta a la persona"
python "$SOL/pasos.py" reglas 4 > observabilidad/reglas.yml
python "$SOL/pasos.py" pruebas 4 > observabilidad/pruebas.yml
cp "$SOL/observabilidad/alertmanager.yml" observabilidad/alertmanager.yml
c "time python mundo/promtool.py prueba"
c python mundo/recargar.py prometheus
c python mundo/recargar.py alertmanager
c "for l in 'severity=page alertname=ClassifierErrorBudgetFastBurn slo=disponibilidad' 'severity=ticket alertname=ClassifierLowConfidenceSpike' 'severity=none alertname=Watchdog' 'alertname=Otra'; do echo \"\$l → \$(python -c \"import sys; from mundo.comun import amtool; print(amtool('config','routes','test','--config.file=/etc/alertmanager/dojo/alertmanager.yml',*sys.argv[1:]).stdout.strip())\" \$l)\"; done"
c "sleep 45; curl -s localhost:8966/estado; echo; python mundo/tickets.py avisos 3"
c alertas
c python verificar.py pruebas-propias alertmanager

p "paso 5: un incidente de verdad"
c "date -u +%H:%M:%S; python mundo/servicios.py reiniciar triton --falla 30"
c "sleep 60; python mundo/capas.py | head -2; q 'classifier:error_ratio:rate5m / 0.001'; q 'classifier:error_ratio:rate1h / 0.001'; alertas"
c "sleep 150; date -u +%H:%M:%S; q 'classifier:error_ratio:rate1h / 0.001'; alertas; python mundo/tickets.py avisos 4"
c "sleep 270; date -u +%H:%M:%S; q 'classifier:error_ratio:rate30m / 0.001'; q 'classifier:error_ratio:rate6h / 0.001'; alertas; curl -s localhost:9963/api/v2/alerts | python -c \"import json,sys;[print(a['labels']['alertname'], a['status']['state'], a['status']['inhibitedBy']) for a in json.load(sys.stdin)]\""
c "date -u +%H:%M:%S; python mundo/servicios.py reiniciar triton"
c "sleep 330; date -u +%H:%M:%S; q 'classifier:error_ratio:rate5m / 0.001'; alertas; python mundo/tickets.py avisos 6"
for i in $(seq 1 48); do python mundo/tickets.py avisos 12 | grep -q 'tickets  firing    ClassifierErrorBudgetSlowBurn' && break; sleep 10; done
c "python mundo/tickets.py avisos 4; python mundo/tickets.py"

p "paso 6: el job diario"
cp "$SOL/diario/monitoreo.py" diario/monitoreo.py
c "time python diario/monitoreo.py"
c "python -c \"import json; from mundo.comun import s3, BUCKET, MONITOREO, ayer; r=json.loads(s3().get_object(Bucket=BUCKET, Key=f'{MONITOREO}dt={ayer()}/resumen.json')['Body'].read()); print(json.dumps({k: r[k] for k in ('psi','psi_por_categoria','baja_confianza','bytes_mediana','holdout','apps')}, ensure_ascii=False, indent=1)); print({k: v for k, v in r['aceptacion'].items() if k in ('total','source=mobile','source=web','categoria=abrigos','categoria=botines')})\""
D0=$(python -c "from mundo.comun import ayer; from datetime import timedelta; print(ayer() - timedelta(days=31))")
c "python diario/monitoreo.py --dia $(python -c "from mundo.comun import ayer; from datetime import timedelta; print(ayer() - timedelta(days=32))")"
c "time python diario/monitoreo.py --desde $D0"
c "curl -s localhost:9964/metrics | grep -E '^(push_time_seconds|classifier_monitoreo_psi|classifier_monitoreo_aceptacion\{.*(total|mobile)|classifier_monitoreo_dia)'"
c "sleep 10; q 'time() - push_time_seconds{job=\"monitoreo-diario\"}'"
c python verificar.py job-diario

p "paso 7: el disparador"
cp "$SOL/diario/disparador.py" diario/disparador.py
c python diario/disparador.py --seco
D1=$(python -c "from mundo.comun import ayer; from datetime import timedelta; print(ayer() - timedelta(days=18))")
c "python diario/disparador.py --desde $D1 --seco | grep -v 'nada que abrir'"
c "python diario/disparador.py --desde $D1 | grep -v 'nada que abrir'"
c "python diario/disparador.py | grep -v 'nada que abrir'"
c python mundo/tickets.py
c python verificar.py disparador

p "paso 8: diagnosticar y decidir"
MOB=$(python -c "from mundo.comun import ayer; from datetime import timedelta; print(f'aceptacion-source=mobile-{ayer() - timedelta(days=10)}')")
ABR=$(python -c "from mundo.comun import ayer; from datetime import timedelta; print(f'aceptacion-categoria=abrigos-{ayer() - timedelta(days=4)}')")
DRF=$(python -c "from mundo.comun import ayer; from datetime import timedelta; print(f'drift-psi-{ayer() - timedelta(days=2)}')")
c "python mundo/tickets.py ver $MOB | python -c \"import json,sys; t=json.load(sys.stdin); print(t['titulo']); print(json.dumps(t['evidencia'], ensure_ascii=False)); print(json.dumps(t['diagnostico'], ensure_ascii=False, indent=1)); print(t['accion_sugerida'])\""
c "python mundo/tickets.py ver $DRF | python -c \"import json,sys; t=json.load(sys.stdin); print(t['titulo']); print(json.dumps(t['evidencia']['psi'])); print(json.dumps(t['evidencia']['aceptacion_slice'], ensure_ascii=False)); print(json.dumps(t['diagnostico']['despliegues'])); print(t['accion_sugerida'])\""
c "python mundo/orquestador.py submit --from cronwf/reentreno-mensual --ticket $DRF"
c "python mundo/tickets.py decidir $MOB --accion avisar-dueno --nota 'la app mobile 5.2.0 manda fotos más comprimidas y con menos contraste; ticket al equipo-app-mobile con la evidencia; no se reentrena'"
c "python mundo/tickets.py decidir $DRF --accion reentrenar --nota 'temporada de frío: chamarras acolchadas que el modelo casi no vio; tanda extra de abrigos y corrida adelantada'"
c "python mundo/tickets.py decidir $ABR --accion reentrenar --nota 'es el mismo cambio que el drift: va en la misma corrida'"
c "python mundo/orquestador.py submit --from cronwf/reentreno-mensual --ticket $MOB"
c "python mundo/orquestador.py submit --from cronwf/reentreno-mensual --ticket $DRF"
c python mundo/orquestador.py lista
c python verificar.py ciclo-cerrado

p "paso 9: las muestras y el job programado"
cp "$SOL/diario/muestras.py" diario/muestras.py
c "time python diario/muestras.py"
c "python -c \"import json; from mundo.comun import s3, BUCKET, ETIQUETADO, ayer; from datetime import timedelta; m=(ayer().replace(day=1)+timedelta(days=32)).strftime('%Y-%m'); t=json.loads(s3().get_object(Bucket=BUCKET, Key=f'{ETIQUETADO}cola-{m}/tareas.json')['Body'].read()); print(json.dumps(t[0], ensure_ascii=False)); print(json.dumps(t[300], ensure_ascii=False)); print(json.dumps(t[-1], ensure_ascii=False))\""
c "time python mundo/cron.py correr"
c python mundo/cron.py estado
c "sleep 10; q 'time() - push_time_seconds{job=\"monitoreo-diario\"}'"
c "time python verificar.py"
c "cat taller/progreso.json | python -c \"import json,sys; print(json.load(sys.stdin)['verificaciones'][-1])\""
echo "listo: $LOG"
