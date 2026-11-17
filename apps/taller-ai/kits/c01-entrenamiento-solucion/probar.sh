#!/usr/bin/env bash
# Corre el Guiado de la estación 3 en una carpeta limpia, como lo haría una persona, con los archivos de esta
# solución, y deja cada salida real en <carpeta>.log. Es el kit recién descomprimido: el esqueleto en su lugar.
# Uso: bash probar.sh <carpeta-vacía>      (necesita Docker; crea su propio .venv con python3; ≈ 15 min)
set -uo pipefail
SOL="$(cd "$(dirname "$0")" && pwd)"
KIT="$SOL/../c01-entrenamiento"
D="$1"; LOG="$D.log"
rm -rf "$D"; mkdir -p "$D"; : > "$LOG"
export PYTHONUNBUFFERED=1   # que las líneas salgan aunque el proceso muera de golpe (paso 5)
paso() { echo "### $1" >> "$LOG"; shift; { "$@" 2>&1; c=$?; [ $c -ne 0 ] && echo "[código $c]"; } | grep -v "^🧪 View experiment" | tee -a "$LOG"; echo >> "$LOG"; }

# el kit como sale del .zip: el mundo + el esqueleto en su lugar
(cd "$KIT" && tar --exclude .taller --exclude __pycache__ --exclude data --exclude entrada --exclude historial --exclude .venv -cf - .) | (cd "$D" && tar -xf -)
(cd "$KIT/mundo/esqueleto" && tar -cf - .) | (cd "$D" && tar -xf -)
cd "$D"
docker compose down -v >/dev/null 2>&1

# paso 0 · el mundo
paso "p0 venv" sh -c 'python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt 2>&1 | grep -v "^\[notice\]"; .venv/bin/python --version; du -sh .venv | cut -f1'
source .venv/bin/activate
paso "p0 up" sh -c 'docker compose up -d --wait 2>&1 | tail -3'
paso "p0 crear" python mundo/crear.py
paso "p0 git" sh -c 'git init -q && git add -A && git commit -qm "kit recién descomprimido" && git log --oneline'
paso "p0 verificar" python verificar.py mundo

# precálculos sobre el mundo recién creado
paso "pc pasos" python -c "
import math, sys; sys.path.insert(0, '.')
from mundo.comun import receta, s3, tarjeta
n, r = tarjeta(s3(), 'ds-2026-09-01')['counts']['train'], receta()
p = math.ceil(n / r['batch'])
print(f\"{n} fotos de train ÷ batch {r['batch']} = {p} pasos por época · × {r['epocas']} épocas = {p * r['epocas']} pasos\")"
paso "pc pesos" python -c "
import sys; sys.path.insert(0, '.')
from mundo.arquitectura import construir_modelo
n = sum(p.numel() for p in construir_modelo(10).parameters())
print(f'{n:,} parámetros × 4 bytes = {n * 4 / 1e3:.0f} kB de pesos · más los 2 promedios de Adam = {n * 12 / 1e3:.0f} kB')"
paso "pc l0" python -c "
import math
print(f'ln(500) = {math.log(500):.2f} · ln(10) = {math.log(10):.2f}')"
paso "pc ruido" python -c "
import math
for nombre, a, G in [('C01, val de 92,417', 0.85, 92417), ('dojo, val de 1,524', 0.85, 1524)]:
    print(f'{nombre}: ε = 1.96 × √({a} × {1 - a:.2f} ÷ {G:,}) = ± {196 * math.sqrt(a * (1 - a) / G):.2f} puntos')"

# paso 1 · leer el snapshot con el preprocess del gateway
cp "$SOL/pipeline/datos.py" pipeline/
paso "p1 datos" python pipeline/datos.py ds-2026-09-01
paso "p1 otra vez" sh -c 'du -sh data/cache | cut -f1; ls data/cache | wc -l | tr -d " "; /usr/bin/time -p python pipeline/datos.py ds-2026-09-01 2>&1 | grep -E "^real|paridad"'
paso "p1 latest" python pipeline/datos.py latest
paso "p1 verificar" python verificar.py datos paridad

# paso 2 · la prueba de humo
cp "$SOL/pipeline/humo.py" pipeline/
paso "p2 humo" python pipeline/humo.py --snapshot ds-2026-09-01
paso "p2 lr0" python pipeline/humo.py --snapshot ds-2026-09-01 --lr 0
paso "p2 verificar" python verificar.py humo

# paso 3 · el job: receta, semilla, MLflow y árbol limpio
cp "$SOL/pipeline/entrenar.py" pipeline/
paso "p3 sucio" python pipeline/entrenar.py --snapshot ds-2026-09-01 --champion 1 --corrida a-mano-1
git add -A && git commit -qm "pipeline: datos, humo y entrenar"
echo "# una prueba" >> receta.yaml
paso "p3 receta sucia" python pipeline/entrenar.py --snapshot ds-2026-09-01 --champion 1 --corrida a-mano-1
git restore receta.yaml
paso "p3 entrenar" python pipeline/entrenar.py --snapshot ds-2026-09-01 --champion 1 --corrida a-mano-1
paso "p3 otra vez" python pipeline/entrenar.py --snapshot ds-2026-09-01 --champion 1 --corrida a-mano-1
paso "p3 corridas" python mundo/modelos.py corridas
paso "p3 verificar" python verificar.py mlflow punteros limpio

# paso 4 · arrancar del champion
paso "p4 versiones" python mundo/modelos.py versiones
paso "p4 alias" python pipeline/entrenar.py --snapshot ds-2026-09-01 --champion @champion --corrida a-mano-2
sed -i '' 's/^arranque: champion /arranque: cero     /' receta.yaml
git commit -qam "receta: arranque desde cero (prueba)"
paso "p4 desde cero" python pipeline/entrenar.py --snapshot ds-2026-09-01 --champion 1 --corrida desde-cero
git revert --no-edit HEAD >/dev/null
paso "p4 revert" sh -c 'git log --oneline -3; grep "^arranque" receta.yaml'
paso "p4 verificar" python verificar.py champion

# paso 5 · checkpoints y reanudar
paso "p5 checkpoint" python mundo/s3.py checkpoint ds-2026-09-01 a-mano-1
paso "p5 ls" python mundo/s3.py ls ml-ckpt
paso "p5 caida" sh -c 'python pipeline/entrenar.py --snapshot ds-2026-09-01 --champion 1 --corrida con-caida & sleep 15; kill -9 $!; wait $! 2>/dev/null; echo "[se perdió el nodo: kill -9 a los 15 s]"'
paso "p5 reanudar" python pipeline/entrenar.py --snapshot ds-2026-09-01 --champion 1 --corrida con-caida
paso "p5 comparar" sh -c 'python mundo/modelos.py corridas | grep -E "a-mano-1|con-caida"'
paso "p5 verificar" python verificar.py checkpoints reanudar

# paso 6 · el pipeline en el orquestador
cp "$SOL/pipeline.yaml" .
git add -A && git commit -qm "pipeline.yaml: humo → entrenar"
paso "p6 orquestador" python mundo/orquestador.py pipeline.yaml --apagon 15
paso "p6 historial" python -c "
import json, glob
r = json.load(open(sorted(glob.glob('historial/wf-*.json'))[-1]))
print('corrida:', r['corrida'], '· parámetros:', r['parametros'], '→', r['resueltos'])
for p in r['pasos']:
    for i in p['intentos']:
        print(f\"  {p['id']} intento {i['n']}: {i['segundos']} s · código {i['codigo']} · {i['motivo']}\")"
paso "p6 verificar" python verificar.py pipeline

# paso 7 · ¿regresión o ruido?
cp "$SOL/pipeline/comparar.py" pipeline/
git add -A && git commit -qm "comparar corridas"
paso "p7 pocas" python pipeline/comparar.py a-mano-1 desde-cero
for s in 18 19 20 21; do
  paso "p7 semilla $s" sh -c "python pipeline/entrenar.py --snapshot ds-2026-09-01 --champion 1 --corrida semilla-$s --semilla $s | grep '✓'"
done
paso "p7 ruido" python pipeline/comparar.py a-mano-1 semilla-19
paso "p7 revisar" python pipeline/comparar.py a-mano-1 desde-cero
paso "p7 verificar" python verificar.py ruido

paso "final" python verificar.py
echo "listo: $LOG"
