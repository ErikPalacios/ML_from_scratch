#!/usr/bin/env bash
# Prueba las 6 fallas sobre la carpeta que dejó probar.sh (todo en verde): para cada una, la mete con
# romper.py --mostrar, muestra qué check la detecta, corre el comando que la confirma, aplica el arreglo
# documentado y la cierra con romper.py --verificar. Al final mete una al azar y prueba --restaurar.
# Uso: bash probar-fallas.sh <carpeta-de-probar.sh>      (≈ 4 min)
set -uo pipefail
D="$1"; LOG="$D-fallas.log"; : > "$LOG"
cd "$D" && source .venv/bin/activate
export PYTHONUNBUFFERED=1
paso() { echo "### $1" >> "$LOG"; shift; { "$@" 2>&1; c=$?; [ $c -ne 0 ] && echo "[código $c]"; } | grep -v -E "View (run|experiment)|Waiting up to 300 seconds|época" | tee -a "$LOG"; echo >> "$LOG"; }
ver() { python verificar.py 2>&1 | grep -E "^✗|en verde"; }

# 1 · receta-sin-revisar
paso "f1 romper" python romper.py --mostrar --falla receta-sin-revisar
paso "f1 detecta" ver
paso "f1 confirma" sh -c 'git log -1 --format="%h %an · %s" -- engine.yaml; git show HEAD -- engine.yaml | grep "^[-+] "'
paso "f1 paso" python pipeline/paridad.py
paso "f1 arreglo" sh -c 'git revert --no-edit HEAD | head -1; grep -E "^  (precision|a1_min):" engine.yaml'
paso "f1 verificar" python romper.py --verificar

# 2 · pesos-cambiados
paso "f2 romper" python romper.py --mostrar --falla pesos-cambiados
paso "f2 detecta" ver
paso "f2 confirma" python verificar.py pesos
paso "f2 paso" python pipeline/exportar.py
paso "f2 arreglo" python mundo/modelos.py pesos 4
paso "f2 verificar" python romper.py --verificar

# 3 · runtime-distinto
paso "f3 romper" python romper.py --mostrar --falla runtime-distinto
paso "f3 detecta" ver
paso "f3 confirma" sh -c 'git log -1 --format="%h %an · %s" -- mundo/servidor/requirements.txt; git show HEAD -- mundo/servidor/requirements.txt | grep "^[-+]onnx"'
paso "f3 paso" python pipeline/registrar.py
paso "f3 arreglo" sh -c 'git revert --no-edit HEAD | head -1; grep "^onnxruntime" mundo/servidor/requirements.txt'
paso "f3 verificar" python romper.py --verificar

# 4 · engine-champion-cambiado
paso "f4 romper" python romper.py --mostrar --falla engine-champion-cambiado
paso "f4 detecta" ver
paso "f4 confirma" sh -c 'python mundo/modelos.py engine 3 | grep -E "engine_sha256|engine/engine.onnx"'
paso "f4 paso" python pipeline/latencia.py
paso "f4 arreglo" python mundo/modelos.py reconstruir-engine 3
paso "f4 verificar" python romper.py --verificar

# 5 · firma-cambiada
paso "f5 romper" python romper.py --mostrar --falla firma-cambiada
paso "f5 detecta" ver
paso "f5 confirma" sh -c 'git log -1 --format="%h %an · %s" -- mundo/servidor/classifier.yaml; git show HEAD -- mundo/servidor/classifier.yaml | grep "^[-+][a-z]"'
paso "f5 paso" python pipeline/paridad.py
paso "f5 arreglo" sh -c 'git revert --no-edit HEAD | head -1'
paso "f5 verificar" python romper.py --verificar

# 6 · mlflow-caido
paso "f6 romper" python romper.py --mostrar --falla mlflow-caido
paso "f6 detecta" ver
paso "f6 confirma" sh -c 'docker compose ps -a --format "{{.Service}}: {{.State}} · {{.Status}}"'
paso "f6 paso" sh -c '/usr/bin/time -p python pipeline/exportar.py 2>&1 | grep -E "^✗|Error|^real" | tail -3'
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
