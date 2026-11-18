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

# 1 · plazos-invertidos
paso "f1 romper" python romper.py --mostrar --falla plazos-invertidos
paso "f1 detecta" ver
paso "f1 confirma" sh -c 'git log -1 --format="%h %an · %s" -- gateway.yaml; git show HEAD -- gateway.yaml | grep "^[-+] "; python mundo/servicios.py estado; tail -3 logs/gateway.log'
paso "f1 arreglo" sh -c 'git revert --no-edit HEAD | head -1; python mundo/servicios.py arrancar gateway'
paso "f1 verificar" python romper.py --verificar

# 2 · limites-flojos
paso "f2 romper" python romper.py --mostrar --falla limites-flojos
paso "f2 detecta" ver
paso "f2 confirma" sh -c 'git log -1 --format="%h %an · %s" -- gateway.yaml; git show HEAD -- gateway.yaml | grep "^[-+] "; python verificar.py reglas | head -1'
paso "f2 arreglo" sh -c 'git revert --no-edit HEAD | head -1; python mundo/servicios.py reiniciar gateway | tail -1'
paso "f2 verificar" python romper.py --verificar

# 3 · modelo-equivocado
paso "f3 romper" python romper.py --mostrar --falla modelo-equivocado
paso "f3 detecta" ver
paso "f3 confirma" sh -c 'shasum -a 256 model_repository/classifier/1/model.onnx | cut -c1-12; grep "successfully loaded" logs/triton.log | sed -E "s/^I[0-9]+ [0-9:.]+ [0-9]+ servidor.py\] //"; python mundo/modelos.py engine 4 | grep engine_sha256'
paso "f3 arreglo" sh -c 'python servir/armar.py && python mundo/servicios.py reiniciar triton | tail -1'
paso "f3 verificar" python romper.py --verificar

# 4 · labels-desordenados
paso "f4 romper" python romper.py --mostrar --falla labels-desordenados
paso "f4 detecta" ver
paso "f4 confirma" sh -c 'python servir/armar.py; python mundo/modelos.py labels 4'
paso "f4 arreglo" sh -c 'python mundo/modelos.py reparar-labels 4 && python servir/armar.py | tail -1'
paso "f4 verificar" python romper.py --verificar

# 5 · triton-trabado
paso "f5 romper" python romper.py --mostrar --falla triton-trabado
paso "f5 detecta" ver
paso "f5 confirma" sh -c 'python mundo/servicios.py estado; grep "\"status\": 504" logs/gateway.log | tail -1 | cut -c1-220'
paso "f5 arreglo" sh -c 'python mundo/servicios.py reiniciar triton | tail -1'
paso "f5 verificar" python romper.py --verificar

# 6 · mlflow-caido
paso "f6 romper" python romper.py --mostrar --falla mlflow-caido
paso "f6 detecta" ver
paso "f6 confirma" sh -c 'docker compose ps -a --format "{{.Service}}: {{.State}} · {{.Status}}"; curl -s -o /dev/null -w "classify → %{http_code}\n" -X POST localhost:8701/v1/classify -H "Content-Type: image/jpeg" --data-binary @fotos-raras/tenis.jpg; python servir/armar.py'
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
python mundo/servicios.py parar >/dev/null
echo "listo: $LOG"
