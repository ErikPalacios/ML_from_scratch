#!/usr/bin/env bash
# Corre el Guiado de la estación 4 en una carpeta limpia, como lo haría una persona, con los archivos de esta
# solución, y deja cada salida real en <carpeta>.log. Es el kit recién descomprimido: el esqueleto en su lugar.
# Uso: bash probar.sh <carpeta-vacía>      (necesita Docker; crea su propio .venv con python3; ≈ 8 min)
set -uo pipefail
SOL="$(cd "$(dirname "$0")" && pwd)"
KIT="$SOL/../c01-gate"
D="$1"; LOG="$D.log"
rm -rf "$D"; mkdir -p "$D"; : > "$LOG"
export PYTHONUNBUFFERED=1
paso() { echo "### $1" >> "$LOG"; shift; { "$@" 2>&1; c=$?; [ $c -ne 0 ] && echo "[código $c]"; } | grep -v -E "View (run|experiment)|Waiting up to 300 seconds" | tee -a "$LOG"; echo >> "$LOG"; }

(cd "$KIT" && tar --exclude .taller --exclude __pycache__ --exclude data --exclude entrada --exclude reportes --exclude .venv --exclude corrida.yaml -cf - .) | (cd "$D" && tar -xf -)
(cd "$KIT/mundo/esqueleto" && tar -cf - .) | (cd "$D" && tar -xf -)
cd "$D"
docker compose down -v >/dev/null 2>&1

# paso 0 · el mundo
paso "p0 venv" sh -c 'python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt 2>&1 | grep -v "^\[notice\]"; .venv/bin/python --version; du -sh .venv | cut -f1'
source .venv/bin/activate
paso "p0 up" sh -c 'docker compose up -d --wait 2>&1 | tail -2'
paso "p0 crear" sh -c '/usr/bin/time -p python mundo/crear.py 2>&1 | grep -v "época"'
paso "p0 git" sh -c 'git init -q && git add -A && git commit -qm "kit recién descomprimido" && git log --oneline'
paso "p0 verificar" python verificar.py mundo

# precálculos
paso "pc margen" python -c "
import math
for nombre, q, N in [('C01, golden de 50,000', 0.85, 50000), ('dojo, golden de 1,000', 0.82, 1000)]:
    print(f'{nombre}: E = 1.96 × √({q} × {1 - q:.2f} ÷ {N:,}) × 100 = {196 * math.sqrt(q * (1 - q) / N):.2f} puntos')"
paso "pc categoria" python -c "
import math
print(f'una categoría con 100 fotos y recall 0.85: E = 1.96 × √(0.85 × 0.15 ÷ 100) × 100 = {196 * math.sqrt(0.85 * 0.15 / 100):.1f} puntos')"
paso "pc holm" python -c "
for k in (10, 100):
    print(f'{k} pruebas con α = 0.05 y ninguna diferencia real: P(al menos una falsa alarma) = 1 − 0.95^{k} = {1 - 0.95 ** k:.1%}')"

# paso 1 · las reglas y los parámetros de esta noche
paso "p1 corrida" sh -c 'grep -v "^#" corrida.yaml'
paso "p1 gate" sh -c 'grep -v "^#" gate.yaml | grep -v "^ *#"'
paso "p1 versiones" python mundo/modelos.py versiones
paso "p1 candidatos" python mundo/modelos.py candidatos
paso "p1 golden" python mundo/s3.py golden

# paso 2 · evaluar
cp "$SOL/pipeline/evaluar.py" pipeline/
paso "p2 evaluar" sh -c '/usr/bin/time -p python pipeline/evaluar.py 2>&1'
paso "p2 pares" python -c "
import pandas as pd
p = pd.read_parquet('reportes/cand-2026-10-01/pares.parquet')
print(p.shape, '·', round(__import__('os').path.getsize('reportes/cand-2026-10-01/pares.parquet') / 1e3), 'kB')
print(p.head(3).to_string())"
paso "p2 verificar" python verificar.py examen pares labels

# paso 3 · el gate: reglas revisadas y no inferioridad
cp "$SOL/pipeline/gate.py" pipeline/
git add -A && git commit -qm "pipeline: evaluar y gate"
sed -i '' 's/margen_puntos: 2.4 /margen_puntos: 3.0 /' gate.yaml
paso "p3 sin commit" python pipeline/gate.py
git commit -qam "gate: margen 3.0 (prueba)"
paso "p3 sin revision" python pipeline/gate.py
git revert --no-edit HEAD >/dev/null
paso "p3 gate" python pipeline/gate.py
paso "p3 verificar" python verificar.py no-inferioridad umbrales

# paso 4 · categorías, slices y calibración (la misma corrida del gate)
paso "p4 reporte" python -c "
import json
r = json.load(open('reportes/cand-2026-10-01/reporte.json'))
for x in r['categorias']:
    print(f\"{x['categoria']:<10} n {x['n']:>3} · {x['recall_champion']:5.1f} → {x['recall_candidato']:5.1f} · b {x['b']:>2} · c {x['c']:>2} · p {x['p']:.3f} · Holm {x['p_holm']:.3f}\")"
paso "p4 verificar" python verificar.py categorias slices

# paso 5 · el gate que frena
paso "p5 evaluar" python pipeline/evaluar.py --candidato cand-2026-10-01-proveedor
paso "p5 gate" python pipeline/gate.py --candidato cand-2026-10-01-proveedor
paso "p5 gates" python mundo/modelos.py gates
paso "p5 verificar" python verificar.py frena

# paso 6 · registrar el challenger
cp "$SOL/pipeline/registrar.py" pipeline/
git add -A && git commit -qm "pipeline: registrar"
paso "p6 proveedor" python pipeline/registrar.py --candidato cand-2026-10-01-proveedor
paso "p6 registrar" python pipeline/registrar.py
paso "p6 otra vez" python pipeline/registrar.py
paso "p6 versiones" python mundo/modelos.py versiones
paso "p6 verificar" python verificar.py registro

paso "final" python verificar.py
echo "listo: $LOG"
