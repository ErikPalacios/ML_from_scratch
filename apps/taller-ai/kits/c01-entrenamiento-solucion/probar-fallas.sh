#!/usr/bin/env bash
# Prueba las 6 fallas sobre la carpeta que dejó probar.sh (todo en verde): para cada una, la mete con
# romper.py --mostrar, muestra qué check la detecta, corre el comando que la confirma, aplica el arreglo
# documentado y la cierra con romper.py --verificar. Al final mete una al azar y prueba --restaurar.
# Uso: bash probar-fallas.sh <carpeta-de-probar.sh>      (≈ 15 min)
set -uo pipefail
D="$1"; LOG="$D-fallas.log"; : > "$LOG"
cd "$D" && source .venv/bin/activate
export PYTHONUNBUFFERED=1
paso() { echo "### $1" >> "$LOG"; shift; { "$@" 2>&1; c=$?; [ $c -ne 0 ] && echo "[código $c]"; } | grep -v "^🧪 View experiment" | tee -a "$LOG"; echo >> "$LOG"; }
ver() { python verificar.py 2>&1 | grep -E "^✗|en verde"; }

# 1 · lr-roto
paso "f1 romper" python romper.py --mostrar --falla lr-roto
paso "f1 detecta" ver
paso "f1 confirma" sh -c 'git log -1 --format="%h %an · %s" -- receta.yaml; git show HEAD -- receta.yaml | grep "^[-+]lr"'
paso "f1 arreglo" sh -c 'git revert --no-edit HEAD | head -1; grep "^lr" receta.yaml'
paso "f1 verificar" python romper.py --verificar

# 2 · ckpt-espaciado
paso "f2 romper" python romper.py --mostrar --falla ckpt-espaciado
paso "f2 detecta" ver
paso "f2 confirma" sh -c 'git show HEAD -- receta.yaml | grep "^[-+]ckpt"'
paso "f2 apagon" python mundo/orquestador.py pipeline.yaml --apagon 15
paso "f2 arreglo" sh -c 'git revert --no-edit HEAD | head -1; grep "^ckpt" receta.yaml'
paso "f2 verificar" python romper.py --verificar

# 3 · champion-otro-orden
paso "f3 romper" python romper.py --mostrar --falla champion-otro-orden
paso "f3 detecta" ver
paso "f3 confirma" python mundo/modelos.py versiones
paso "f3 entrenar" python mundo/orquestador.py pipeline.yaml
paso "f3 arreglo" python mundo/modelos.py alias champion 1
paso "f3 verificar" python romper.py --verificar

# 4 · pillow-distinto
paso "f4 romper" python romper.py --mostrar --falla pillow-distinto
paso "f4 detecta" ver
paso "f4 confirma" sh -c 'pip show pillow | sed -n 1,2p; grep -i "^pillow" mundo/gateway/requirements.txt requirements.txt'
paso "f4 arreglo" sh -c 'pip install -q pillow==12.3.0 2>&1 | grep -v "^\[notice\]"; sed -i "" "s/^pillow==13.0.0/pillow==12.3.0/" requirements.txt; python verificar.py paridad'
paso "f4 verificar" python romper.py --verificar

# 5 · mlflow-caido
paso "f5 romper" python romper.py --mostrar --falla mlflow-caido
paso "f5 detecta" ver
paso "f5 confirma" sh -c 'docker compose ps -a --format "{{.Service}}: {{.State}} · {{.Status}}"'
paso "f5 entrenar" sh -c '/usr/bin/time -p python pipeline/entrenar.py --snapshot ds-2026-09-01 --champion 1 --corrida prueba-mlflow 2>&1 | grep -E "^✗|^real"'
paso "f5 arreglo" sh -c 'docker compose up -d --wait mlflow 2>&1 | tail -1'
paso "f5 verificar" python romper.py --verificar

# 6 · receta-sin-commit
paso "f6 romper" python romper.py --mostrar --falla receta-sin-commit
paso "f6 detecta" ver
paso "f6 confirma" sh -c 'git status --short; git diff receta.yaml | grep "^[-+]epocas"'
paso "f6 entrenar" python pipeline/entrenar.py --snapshot ds-2026-09-01 --champion 1 --corrida prueba-limpio
paso "f6 arreglo" sh -c 'git restore receta.yaml && git status --short receta.yaml && echo "receta.yaml igual al último commit"'
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
