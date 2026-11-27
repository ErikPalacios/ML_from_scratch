#!/usr/bin/env bash
# Corre el Guiado de la estación 9 del RAG en una carpeta limpia, como lo haría una persona, con los archivos de esta
# solución, y deja cada salida real en <carpeta>.log. Es el kit recién descomprimido: el esqueleto en su lugar.
# Uso: bash probar.sh <carpeta-vacía>   (crea su .venv con python3; necesita llama-server 1.1.0+ e internet para pip)
# Con DOJO_MODELOS=/otra/copia/modelo enlaza los modelos de ahí en vez de bajarlos (≈ 3.9 GB).
set -uo pipefail
SOL="$(cd "$(dirname "$0")" && pwd)"
KIT="$SOL/../rag-gate"
D="$1"; LOG="$D.log"
rm -rf "$D"; mkdir -p "$D"; : > "$LOG"
paso() { echo "### $1" >> "$LOG"; shift; { "$@" 2>&1; c=$?; [ $c -ne 0 ] && echo "[código $c]"; } | tee -a "$LOG"; echo >> "$LOG"; }
usa() { cp "$SOL/pipeline/$1" "pipeline/$1"; }

(cd "$KIT" && tar --exclude .taller --exclude __pycache__ --exclude almacen --exclude modelo --exclude cache --exclude indices --exclude corridas --exclude .venv -cf - .) | (cd "$D" && tar -xf -)
(cd "$KIT/mundo/esqueleto" && tar -cf - .) | (cd "$D" && tar -xf -)
cd "$D"

# paso 0 · el mundo
paso "p0 venv" sh -c 'python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt 2>&1 | grep -v "^\[notice\]"; .venv/bin/python --version; llama-server --version 2>&1 | grep -E "^version"'
source .venv/bin/activate
paso "p0 modelos" python mundo/modelos.py
paso "p0 listar" python mundo/modelos.py --listar
paso "p0 crear" python mundo/crear.py
paso "p0 servidores" python mundo/servidor.py arrancar
paso "p0 api" python mundo/api.py arrancar
paso "p0 verificar" python verificar.py mundo
paso "p0 esqueleto" python verificar.py correr

# precálculos (en el dojo y en C11; los supuestos de C11 van escritos en cada comando)
paso "pc ruido" python -c "
import math
def wilson(k, n, z=1.96):
    p = k / n; c = (p + z*z/(2*n)) / (1 + z*z/n); m = z * math.sqrt(p*(1-p)/n + z*z/(4*n*n)) / (1 + z*z/n); return c - m, c + m
for k, n, que in ((40, 51, 'dojo: 40 de las 51 de test bien (78 %)'), (510, 600, 'C11:  510 de ≈ 600 (85 %)'), (51, 60, 'C11:  51 de un área de 60 (85 %)')):
    lo, hi = wilson(k, n); print(f'{que}: Wilson 95 % de {lo:.1%} a {hi:.1%} (± ≈ {(hi - lo) / 2 * 100:.1f} puntos)')"
paso "pc margen" python -c "
import math
for n, d, que in ((51, 0.10, 'dojo'), (51, 0.0, 'dojo, sin ruido'), (600, 0.10, 'C11 '), (200, 0.10, 'C11, un área de 200')):
    se = math.sqrt(d / n); print(f'{que}: {n} preguntas, {d:.0%} cambian de veredicto → se ≈ {se * 100:.1f} puntos · margen mínimo (1.645 + 0.842) × se ≈ {2.487 * se * 100:.1f} puntos')"

# paso 1 · correr el examen
usa correr.py
paso "p1 correr" python pipeline/correr.py base
paso "p1 fila" python -c "
import json; f = [json.loads(l) for l in open('corridas/base/respuestas.jsonl')]
x = next(r for r in f if r['id'] == 'G-012'); print(json.dumps(x, ensure_ascii=False, indent=1))"
paso "p1 manifiesto" python -c "
import json; m = json.load(open('corridas/base/manifiesto.json')); m['ids'] = m['ids'][:3] + ['…']; print(json.dumps(m, ensure_ascii=False, indent=1))"
paso "p1 verificar" python verificar.py correr

# paso 2 · las métricas sin juez
usa metricas.py
paso "p2 metricas" python pipeline/metricas.py base
paso "p2 citas" python -c "
import json; f = {json.loads(l)['id']: json.loads(l) for l in open('corridas/base/respuestas.jsonl')}; m = json.load(open('corridas/base/metricas.json'))['por_pregunta']
for i in ('G-001', 'G-007', 'G-012', 'G-021'):
    print(i, '· cita a una fuente esperada:', m[i]['cita_esperada'], '· sin cita:', m[i]['sin_cita'], '·', f[i]['respuesta'][:90])"
paso "p2 verificar" python verificar.py metricas

# paso 3 · el juez
usa juez.py
paso "p3 juez api" python pipeline/juez.py calibrar --url http://127.0.0.1:9931/v1
paso "p3 calibrar" python pipeline/juez.py calibrar
paso "p3 otra vez" python pipeline/juez.py calibrar
paso "p3 juzgar" python pipeline/juez.py base
paso "p3 incorrectas" python -c "
import json; j = [json.loads(l) for l in open('corridas/base/juicio.jsonl')]; f = {json.loads(l)['id']: json.loads(l) for l in open('corridas/base/respuestas.jsonl')}
g = {json.loads(l)['id']: json.loads(l) for l in open('almacen/golden/golden-v2/preguntas.jsonl')}
for x in j:
    if x['veredicto'] == 'incorrecta':
        print(f\"{x['id']} {g[x['id']]['tipo']:<13} por {x['por']:<5} «{f[x['id']]['respuesta'][:70]}» · referencia: «{g[x['id']]['respuesta'][:50]}»\")"
paso "p3 verificar" python verificar.py juez

# paso 4 · el gate
usa gate.py
paso "p4 estadistica" python verificar.py estadistica
paso "p4 sin base" python pipeline/gate.py base
paso "p4 promover" python pipeline/gate.py promover base
paso "p4 propuestas" python mundo/propuesta.py
paso "p4 umbral" python mundo/propuesta.py umbral-bajo
paso "p4 examen umbral" python pipeline/gate.py examen umbral-bajo
paso "p4 promover umbral" python pipeline/gate.py promover umbral-bajo
paso "p4 quitar umbral" python mundo/propuesta.py quitar
paso "p4 k2" python mundo/propuesta.py k-2
paso "p4 examen k2" python pipeline/gate.py examen k-2
paso "p4 quitar k2" python mundo/propuesta.py quitar
paso "p4 verificar" python verificar.py gate promover

# paso 5 · el examen de cada cambio, de punta a punta
paso "p5 hoy" python pipeline/gate.py examen hoy
paso "p5 verificar" python verificar.py examen
paso "pc tiempo" python -c "
import json
f = [json.loads(l) for l in open('corridas/hoy/respuestas.jsonl')]
t = sum(r['ms']['total'] for r in f) / 1000
print(f'dojo: {len(f)} preguntas una tras otra: {t:.0f} s de API ({t / len(f):.1f} s por pregunta), más el juez (las respuestas iguales ya están en cache/juez/)')
print(f'C11:  ≈ 600 preguntas × ≈ 4 s (supuesto: 8 chunks y respuesta de 512 tokens) ÷ 8 a la vez ≈ {600 * 4 / 8 / 60:.0f} min por cambio; el canario: 100 cada 4 h = 600 al día, ≈ {600 / 25000:.1%} de las ≈ 25k preguntas diarias')"

# todo
paso "fin verificar" python verificar.py

# la ronda Construir solo arranca desde el esqueleto
paso "solo parar" python mundo/api.py parar
paso "solo reiniciar" python mundo/reiniciar.py
paso "solo verificar" sh -c 'python mundo/api.py arrancar > /dev/null; python verificar.py mundo correr'
