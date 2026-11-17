#!/usr/bin/env bash
# Prueba las 6 fallas sobre la carpeta que dejó probar.sh (todo en verde): para cada una, la mete con
# romper.py --mostrar, muestra qué check la detecta, corre el comando que la confirma, aplica el arreglo
# documentado y la cierra con romper.py --verificar. Al final mete una al azar y prueba --restaurar.
# Uso: bash probar-fallas.sh <carpeta-de-probar.sh>      (≈ 6 min)
set -uo pipefail
D="$1"; LOG="$D-fallas.log"; : > "$LOG"
cd "$D" && source .venv/bin/activate
export PYTHONUNBUFFERED=1
paso() { echo "### $1" >> "$LOG"; shift; { "$@" 2>&1; c=$?; [ $c -ne 0 ] && echo "[código $c]"; } | grep -v -E "View (run|experiment)|Waiting up to 300 seconds|época" | tee -a "$LOG"; echo >> "$LOG"; }
ver() { python verificar.py 2>&1 | grep -E "^✗|en verde"; }

# 1 · umbral-movido
paso "f1 romper" python romper.py --mostrar --falla umbral-movido
paso "f1 detecta" ver
paso "f1 confirma" sh -c 'git log -1 --format="%h %an · %s" -- gate.yaml; git show HEAD -- gate.yaml | grep "^[-+] "'
paso "f1 gate" python pipeline/gate.py --candidato cand-2026-10-01-proveedor
paso "f1 arreglo" sh -c 'git revert --no-edit HEAD | head -1; grep -E "^  (margen_puntos|caida_max_puntos)" gate.yaml'
paso "f1 verificar" python romper.py --verificar

# 2 · golden-tocado
paso "f2 romper" python romper.py --mostrar --falla golden-tocado
paso "f2 detecta" ver
paso "f2 confirma" sh -c 'python mundo/s3.py golden | head -1; python mundo/s3.py versiones golden/golden-v1/manifest.json'
paso "f2 evaluar" python pipeline/evaluar.py
paso "f2 arreglo" sh -c 'python mundo/s3.py restaurar golden/golden-v1/manifest.json $(python mundo/s3.py versiones golden/golden-v1/manifest.json | head -1 | sed "s/.*version-id //"); python mundo/s3.py golden | head -1'
paso "f2 verificar" python romper.py --verificar

# 3 · golden-fuga
paso "f3 romper" python romper.py --mostrar --falla golden-fuga
paso "f3 detecta" ver
paso "f3 confirma" sh -c 'git log -1 --format="%h %an · %s" -- corrida.yaml; python mundo/modelos.py candidatos | tail -1; python mundo/s3.py tarjeta ds-2026-09-15 | grep -E "parent|total|nota"'
paso "f3 evaluar" python pipeline/evaluar.py
paso "f3 arreglo" sh -c 'git revert --no-edit HEAD | head -1; grep "^candidato" corrida.yaml'
paso "f3 verificar" python romper.py --verificar

# 4 · alias-a-mano
paso "f4 romper" python romper.py --mostrar --falla alias-a-mano
paso "f4 detecta" ver
paso "f4 confirma" python mundo/modelos.py versiones
paso "f4 arreglo" python mundo/modelos.py alias champion 3
paso "f4 verificar" python romper.py --verificar

# 5 · labels-desordenados
paso "f5 romper" python romper.py --mostrar --falla labels-desordenados
paso "f5 detecta" ver
paso "f5 confirma" python verificar.py labels
paso "f5 evaluar" python pipeline/evaluar.py
paso "f5 arreglo" sh -c 'python mundo/modelos.py labels cand-2026-10-01 && python pipeline/evaluar.py | tail -1'
paso "f5 verificar" python romper.py --verificar

# 6 · mlflow-caido
paso "f6 romper" python romper.py --mostrar --falla mlflow-caido
paso "f6 detecta" ver
paso "f6 confirma" sh -c 'docker compose ps -a --format "{{.Service}}: {{.State}} · {{.Status}}"'
paso "f6 gate" sh -c '/usr/bin/time -p python pipeline/evaluar.py 2>&1 | grep -E "^✗|Error|^real" | tail -3'
paso "f6 arreglo" sh -c 'docker compose up -d --wait mlflow 2>&1 | tail -1'
paso "f6 verificar" python romper.py --verificar

# una al azar, escondida, y --restaurar
paso "azar romper" python romper.py
paso "azar restaurar" python romper.py --restaurar
paso "final" python verificar.py
paso "progreso" python -c "
import json
p = json.load(open('taller/progreso.json'))
for f in p['rondas']['romper_ayuda']['fallas']:
    print(f['id'], f['minutos'], 'min', '(rendido)' if f['rendido'] else '')
print(len(p.get('verificaciones', [])), 'verificaciones anotadas')"
echo "listo: $LOG"
