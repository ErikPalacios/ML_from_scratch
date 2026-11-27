#!/usr/bin/env bash
# Corre el Guiado de la estación 6 del RAG en una carpeta limpia, como lo haría una persona, con los archivos de esta
# solución, y deja cada salida real en <carpeta>.log. Es el kit recién descomprimido: el esqueleto en su lugar.
# Uso: bash probar.sh <carpeta-vacía>      (crea su propio .venv con python3; necesita internet para pip y los modelos)
# Con DOJO_MODELOS=/otra/copia/modelo copia los modelos de ahí en vez de bajarlos (≈ 623 MB).
set -uo pipefail
SOL="$(cd "$(dirname "$0")" && pwd)"
KIT="$SOL/../rag-retrieval"
D="$1"; LOG="$D.log"
rm -rf "$D"; mkdir -p "$D"; : > "$LOG"
paso() { echo "### $1" >> "$LOG"; shift; { "$@" 2>&1; c=$?; [ $c -ne 0 ] && echo "[código $c]"; } | tee -a "$LOG"; echo >> "$LOG"; }
usa() { cp "$SOL/pipeline/$1" "pipeline/$1"; }
Q="¿En cuánto tiempo me regresan el dinero si pagué con tarjeta?"
P=elena.cruz@marketplace.test

# el kit como sale del .zip: el mundo + el esqueleto en su lugar
(cd "$KIT" && tar --exclude .taller --exclude __pycache__ --exclude almacen --exclude modelo --exclude cache --exclude indices --exclude .venv -cf - .) | (cd "$D" && tar -xf -)
(cd "$KIT/mundo/esqueleto" && tar -cf - .) | (cd "$D" && tar -xf -)
cd "$D"

# paso 0 · el mundo
paso "p0 venv" sh -c 'python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt 2>&1 | grep -v "^\[notice\]"; .venv/bin/python --version; .venv/bin/pip list 2>/dev/null | grep -i -E "^(onnxruntime|numpy|tokenizers|pyyaml) "'
source .venv/bin/activate
paso "p0 modelos" python mundo/modelos.py
paso "p0 listar" python mundo/modelos.py --listar
paso "p0 crear" python mundo/crear.py
paso "p0 verificar" python verificar.py mundo
paso "p0 esqueleto" python verificar.py fusion
paso "p0 linea base" python pipeline/prueba.py

# precálculos (en el dojo y en C11; los supuestos de C11 van escritos en cada comando)
paso "pc rrf" python -c "
for k in (1, 10, 60):
    v = {r: 1 / (k + r) for r in (1, 2, 8, 10, 30)}
    print(f'k={k:<3} lugar 1: {v[1]:.4f} · 2: {v[2]:.4f} · 8: {v[8]:.4f} · 30: {v[30]:.4f} · el 30 vale {v[30] / v[1]:4.0%} del 1 · '
          f'10.º en las dos listas: {2 * v[10]:.4f} contra 1.º en una sola: {v[1]:.4f} → {\"gana el de las dos\" if 2 * v[10] > v[1] else \"gana el 1.º de una\"}')"
paso "pc pool" python -c "
for nombre, n, c in (('dojo', 151, 30), ('C11', 7_500_000, 30)):
    print(f'{nombre:<5} {c} candidatos por índice de {n:>9,} chunks: el pool es a lo más {2 * c} ({2 * c / n:.4%} del corpus); el reranker lee 20 de ahí')"

# paso 1 · la fusión
usa fusion.py
paso "p1 ejemplo" python pipeline/fusion.py
paso "p1 verificar" python verificar.py fusion

# paso 2 · candidatos y fusión, con los permisos antes
usa recuperar.py
paso "p2 fusion" python pipeline/recuperar.py --modo fusion --persona $P "$Q"
paso "p2 poco" python pipeline/recuperar.py --modo fusion --persona carmen.nava@marketplace.test "$Q"
paso "p2 verificar" python verificar.py fusion candidatos

# paso 3 · el reranker
usa reranker.py
paso "p3 pares" python pipeline/reranker.py "$Q" "Los reembolsos a tarjeta de débito tardan de 5 a 10 días hábiles." "El calendario de pagos a vendedores sale los lunes." "Para devolver un producto tienes 30 días desde que lo recibiste."
paso "p3 tokens" python -c "
from tokenizers import Tokenizer
t = Tokenizer.from_file('modelo/reranker/tokenizer.json')
e = t.encode('¿Cuánto tarda un reembolso?', 'Los reembolsos tardan de 5 a 10 días.')
print(' '.join(e.tokens)); print(f'{len(e.ids)} tokens: la pregunta y el pasaje van juntos, en una sola entrada')"
paso "pc latencia" python -c "
import sys, time; sys.path.insert(0, 'pipeline')
from buscar import abrir; from recuperar import Recuperador; from reranker import Reranker
r = Recuperador(abrir(), Reranker()); rr = r.reranker
import fusion
bm, ve = r.candidatos('$Q', '$P'); pool = [c for c, _ in fusion.rrf([bm, ve])]
rr.puntuar('$Q', [r.textos[c] for c in pool[:8]])
ms = {}
for n in (8, 20, 30):
    t = time.perf_counter()
    for _ in range(5): rr.puntuar('$Q', [r.textos[c] for c in pool[:n]])
    ms[n] = (time.perf_counter() - t) / 5 * 1000
    print(f'en tu Mac: {n:>2} pares en {ms[n]:4.0f} ms ({ms[n] / n:4.1f} ms por par)')
par = ms[20] / 20
print(f'C11, 25 mil preguntas al día × 20 pares = 500 mil pares ≈ {500_000 * par / 1000 / 3600:.1f} h de CPU al día como esta Mac')
print(f'C11, una pregunta: {ms[20]:.0f} ms del reranker de un presupuesto de 2,500 ms hasta el primer token ({ms[20] / 2500:.0%})')"
paso "p3 verificar" python verificar.py reranker

# paso 4 · el retrieval completo
paso "p4 completo" python pipeline/recuperar.py --persona $P "$Q"
paso "p4 verificar" python verificar.py rerank permisos

# paso 5 · medir y afinar con dev
usa medir.py
paso "p5 afinar" python pipeline/medir.py --afinar
paso "p5 verificar" python verificar.py medicion

# paso 6 · el reporte con test
paso "pc muestra" python -c "
import math
z = 1.96 + 0.84            # 95 % de confianza y 80 % de probabilidad de verla
p = 0.90                   # un recall@8 típico
for nombre, n in (('dojo', 37), ('C11', 600)):
    d = z * math.sqrt(2 * p * (1 - p) / n)
    print(f'{nombre:<5} {n:>4} preguntas: la mejora más chica que se distingue del ruido ≈ {d:.1%} (de {p:.0%} a {p + d:.0%})')
for d in (0.05, 0.02):
    print(f'para ver una mejora de {d:.0%}: ≈ {z ** 2 * 2 * p * (1 - p) / d ** 2:,.0f} preguntas')"
paso "p6 reporte" python pipeline/medir.py
paso "p6 json" python -c "
import json; r = json.load(open('indices/c11-e5-2026-11-22/retrieval.json'))
print(json.dumps({k: r[k] for k in ('indice', 'golden', 'split', 'k', 'config')}, ensure_ascii=False))
print('reranker:', r['reranker']['repo'], '@', r['reranker']['revision'][:12])
d = [p for p in r['por_pregunta'] if p['fusion'] is not None and p['completo'] != p['fusion']]
print(f'preguntas donde el reranker cambia el recall@8: {len(d)}')"
paso "p6 dev" sh -c 'sed -i.bak "s/^  split: test/  split: dev/" config.yaml && python pipeline/medir.py; mv config.yaml.bak config.yaml'
paso "p6 verificar" python verificar.py medicion reporte

# todo
paso "fin verificar" python verificar.py

# la ronda Construir solo arranca desde el esqueleto
paso "solo reiniciar" python mundo/reiniciar.py
paso "solo verificar" python verificar.py mundo fusion
