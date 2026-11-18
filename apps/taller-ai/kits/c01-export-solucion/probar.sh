#!/usr/bin/env bash
# Corre el Guiado de la estación 5 en una carpeta limpia, como lo haría una persona, con los archivos de esta
# solución, y deja cada salida real en <carpeta>.log. Es el kit recién descomprimido: el esqueleto en su lugar.
# Uso: bash probar.sh <carpeta-vacía>      (necesita Docker; crea su propio .venv con python3; ≈ 8 min)
set -uo pipefail
SOL="$(cd "$(dirname "$0")" && pwd)"
KIT="$SOL/../c01-export"
D="$1"; LOG="$D.log"
rm -rf "$D"; mkdir -p "$D"; : > "$LOG"
export PYTHONUNBUFFERED=1
paso() { echo "### $1" >> "$LOG"; shift; { "$@" 2>&1; c=$?; [ $c -ne 0 ] && echo "[código $c]"; } | grep -v -E "View (run|experiment)|Waiting up to 300 seconds|^\[torch.onnx\]|época" | tee -a "$LOG"; echo >> "$LOG"; }

(cd "$KIT" && tar --exclude .taller --exclude __pycache__ --exclude data --exclude entrada --exclude artefactos --exclude .venv --exclude corrida.yaml -cf - .) | (cd "$D" && tar -xf -)
(cd "$KIT/mundo/esqueleto" && tar -cf - .) | (cd "$D" && tar -xf -)
cd "$D"
docker compose down -v >/dev/null 2>&1

# paso 0 · el mundo
paso "p0 venv" sh -c 'python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt 2>&1 | grep -v "^\[notice\]"; .venv/bin/python --version; du -sh .venv | cut -f1'
source .venv/bin/activate
paso "p0 up" sh -c 'docker compose up -d --wait 2>&1 | tail -2'
paso "p0 crear" sh -c '/usr/bin/time -p python mundo/crear.py 2>&1'
paso "p0 git" sh -c 'git init -q && git add -A && git commit -qm "kit recién descomprimido" && git log --oneline'
paso "p0 verificar" python verificar.py mundo

# precálculos
paso "pc pesos" python -c "
from mundo.arquitectura import construir_modelo
n = sum(p.numel() for p in construir_modelo(10).parameters())
for nombre, p in [('C01, ResNet-50', 24_500_000), ('dojo, MiniResNet', n)]:
    print(f'{nombre}: {p:,} parámetros × 4 B = {p * 4 / 1e6:.3f} MB en FP32 · × 2 B = {p * 2 / 1e6:.3f} MB en FP16')"
paso "pc fp16" python -c "
import numpy as np
for x in (1.0, 2.3, 10.0):
    print(f'cerca de {x}: el siguiente FP16 está a {float(np.spacing(np.float16(x))):.5f}')
print('2.301 y 2.300 en FP16:', float(np.float16(2.301)), float(np.float16(2.300)), '· el mayor FP16:', float(np.finfo(np.float16).max))"
paso "pc examen" python -c "
import math
for nombre, N in [('C01, 10,000 fotos', 10000), ('dojo, golden-v1', 1000), ('chequeo del export', 512)]:
    L = (1 - 0.995) * N
    for f in (0.002, 0.01):
        s = math.sqrt(N * f * (1 - f))
        print(f'{nombre}: L = {L:.1f} · f = {f:.1%}: espera {N * f:.1f} cambios, σ = {s:.2f}, D = {(L - N * f) / s:+.1f}')"
paso "pc uso" python -c "
for nombre, X, tasas in [('C01, una T4 con el engine FP16', 1200, (250, 500)), ('dojo, un hilo de tu Mac', 2390, (600, 1200))]:
    print(nombre + ': ' + ' · '.join(f'{t}/s → ρ = {t / X:.0%}' for t in tasas))"

# paso 1 · qué se va a servir y con qué reglas
paso "p1 corrida" sh -c 'grep -v "^#" corrida.yaml'
paso "p1 versiones" python mundo/modelos.py versiones
paso "p1 engine champion" python mundo/modelos.py engine 3
paso "p1 servidor" sh -c 'grep -v "^#" mundo/servidor/classifier.yaml; grep -v "^#" mundo/servidor/requirements.txt'

# paso 2 · exportar a ONNX
cp "$SOL/pipeline/exportar.py" pipeline/
git add -A && git commit -qm "pipeline: exportar"
paso "p2 exportar" python pipeline/exportar.py
paso "p2 dynamo" python pipeline/exportar.py --exportador dynamo
paso "p2 verificar" python verificar.py receta pesos export

# paso 3 · construir el engine
cp "$SOL/pipeline/construir.py" pipeline/
git add -A && git commit -qm "pipeline: construir"
paso "p3 construir" python pipeline/construir.py
paso "p3 tamanos" sh -c 'ls -l artefactos/v4/*.onnx | awk "{print \$5, \$9}"; python -c "
import onnx, collections
for p in (\"artefactos/v4/model.onnx\", \"artefactos/v4/engine.onnx\"):
    g = onnx.load(p).graph
    print(p, dict(collections.Counter(n.op_type for n in g.node)))"'
paso "p3 verificar" python verificar.py engine firma

# paso 4 · paridad, y el engine que frena
cp "$SOL/pipeline/paridad.py" pipeline/
git add -A && git commit -qm "pipeline: paridad"
paso "p4 paridad" python pipeline/paridad.py
paso "p4 int8 construir" python pipeline/construir.py --precision int8
paso "p4 int8 paridad" python pipeline/paridad.py --prueba int8
paso "p4 verificar" python verificar.py paridad frena

# paso 5 · gate de latencia
cp "$SOL/pipeline/latencia.py" pipeline/
git add -A && git commit -qm "pipeline: latencia"
paso "p5 latencia" sh -c '/usr/bin/time -p python pipeline/latencia.py 2>&1'
paso "p5 rondas" python -c "
import json
r = json.load(open('artefactos/v4/latencia.json'))
for t, x in r['tasas'].items():
    print(t, '/s · champion', [round(v, 3) for v in x['rondas_champion']], '· challenger', [round(v, 3) for v in x['rondas_challenger']])"
paso "p5 verificar" python verificar.py latencia

# paso 6 · registrar
cp "$SOL/pipeline/registrar.py" pipeline/
git add -A && git commit -qm "pipeline: registrar"
paso "p6 registrar" python pipeline/registrar.py
paso "p6 otra vez" python pipeline/registrar.py
paso "p6 versiones" python mundo/modelos.py versiones
paso "p6 engine" python mundo/modelos.py engine 4
paso "p6 verificar" python verificar.py registro

paso "final" python verificar.py
echo "listo: $LOG"
