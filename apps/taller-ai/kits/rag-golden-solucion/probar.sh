#!/usr/bin/env bash
# Corre el Guiado de la estación 4 del RAG en una carpeta limpia, como lo haría una persona, con los archivos de esta
# solución, y deja cada salida real en <carpeta>.log. Es el kit recién descomprimido: el esqueleto en su lugar.
# Uso: bash probar.sh <carpeta-vacía>      (crea su propio .venv con python3; necesita internet para pip)
set -uo pipefail
SOL="$(cd "$(dirname "$0")" && pwd)"
KIT="$SOL/../rag-golden"
D="$1"; LOG="$D.log"
rm -rf "$D"; mkdir -p "$D"; : > "$LOG"
paso() { echo "### $1" >> "$LOG"; shift; { "$@" 2>&1; c=$?; [ $c -ne 0 ] && echo "[código $c]"; } | tee -a "$LOG"; echo >> "$LOG"; }
usa() { cp "$SOL/pipeline/$1" "pipeline/$1"; }

# el kit como sale del .zip: el mundo + el esqueleto en su lugar
(cd "$KIT" && tar --exclude .taller --exclude __pycache__ --exclude almacen --exclude golden --exclude .venv -cf - .) | (cd "$D" && tar -xf -)
(cd "$KIT/mundo/esqueleto" && tar -cf - .) | (cd "$D" && tar -xf -)
cd "$D"

# paso 0 · el mundo
paso "p0 venv" sh -c 'python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt 2>&1 | grep -v "^\[notice\]"; .venv/bin/python --version; .venv/bin/pip list 2>/dev/null | grep -i -E "^(pyyaml|jsonschema) "'
source .venv/bin/activate
paso "p0 crear" python mundo/crear.py
paso "p0 verificar" python verificar.py mundo
paso "p0 esqueleto" python verificar.py esquema

# precálculos (en el dojo y en C11; los supuestos de C11 van escritos en cada comando)
paso "pc cuantas" python -c "
from math import sqrt
z, zp = 1.96, 0.84                               # 95 % de confianza, 80 % de potencia
def margen(p, n): return z * sqrt(p * (1 - p) / n)
def hacen_falta(p, d): return (z + zp) ** 2 * 2 * p * (1 - p) / d ** 2
p = 0.85                                         # supuesto: el recall@8 ronda el 85 %
for n in (45, 450, 600):
    print(f'n = {n:>3}: recall {p:.0%} ± {margen(p, n):.1%}')
for d in (0.10, 0.05, 0.03):
    print(f'ver {d:.0%} de diferencia entre dos sistemas (cada uno con su examen): ≈ {hacen_falta(p, d):,.0f} preguntas')"
paso "pc fugas" python -c "
for n in (6, 10, 60, 90):
    print(f'0 fugas en {n:>2} prohibidas: la tasa real puede ser hasta ≈ {3 / n:.1%} (regla de tres, 95 %)')"
paso "pc pares" python -c "
for nombre, n in (('candidatas del dojo', 79), ('golden de C11', 600), ('un mes de preguntas de C11', 25_000 * 30)):
    print(f'{nombre:<27} {n:>9,} → {n * (n - 1) // 2:>18,} pares')"
paso "pc splits" python -c "
import hashlib, random
def h(i, sal='golden-c11'): return 'test' if int(hashlib.sha256(f'{sal}|{i}'.encode()).hexdigest()[:8], 16) % 100 < 75 else 'dev'
ids = [f'G-{i:03d}' for i in range(1, 601)]
random.seed(1); a = {i: random.random() < 0.75 for i in ids}; random.seed(2); b = {i: random.random() < 0.75 for i in ids}
print(f'al azar otra vez:  {sum(a[i] != b[i] for i in ids)} de 600 cambian de split (esperado 2 × 0.75 × 0.25 = 37.5 % = 225)')
print(f'por hash del id:   {sum(h(i) != h(i) for i in ids)} de 600 · y si la sal cambia: {sum(h(i) != h(i, \"otra\") for i in ids)} de 600')"
paso "pc costo" python -c "
for nombre, n, minutos in (('C11', 600, 8), ('dojo', 79, 8)):        # supuesto: 8 min de un experto por pregunta, con sus fuentes
    print(f'{nombre:<4} {n:>3} preguntas × {minutos} min = {n * minutos / 60:,.1f} h de expertos')
semana, fuentes = 0.05, 1.4                      # supuestos de C11: cambia el 5 % de los documentos por semana; 1.4 fuentes por pregunta
print(f'C11: con {semana:.0%} de documentos cambiando por semana, ≈ {600 * (1 - (1 - semana) ** fuentes):.0f} preguntas tocadas por semana')"

# paso 1 · el esquema
cp "$SOL/esquema/candidata.schema.json" esquema/
usa esquema.py
paso "p1 estructura" python -c "
import sys, json; sys.path.insert(0, 'pipeline')
from esquema import estructura
for l in open('almacen/candidatos/expertos.jsonl'):
    x = json.loads(l); e = estructura(x)
    if e: print(x['id'], '→', ' | '.join(e))
x = json.loads(open('almacen/candidatos/expertos.jsonl').readline()); x |= {'tipo': 'dificil', 'respuesta': ''}
print('dos fallas a la vez:', estructura(x))"
paso "p1 verificar" python verificar.py esquema

# paso 2 · las reglas de cada tipo
paso "p2 lote" python pipeline/esquema.py almacen/candidatos/expertos.jsonl
paso "p2 verificar" python verificar.py reglas

# paso 3 · casi iguales
usa parecidas.py
paso "p3 pares" python pipeline/parecidas.py almacen/candidatos/expertos.jsonl
paso "p3 umbral" python pipeline/parecidas.py almacen/candidatos/expertos.jsonl --umbral 0.5
paso "p3 verificar" python verificar.py parecidas

# paso 4 · splits que no se mueven
usa splits.py
paso "p4 splits" python pipeline/splits.py G-001 G-009 G-015 G-034
paso "p4 conteo" python -c "
import sys; sys.path.insert(0, 'pipeline')
from splits import split_de
for sal in ('golden-c11', 'otra'):
    xs = [split_de(f'G-{i:03d}', sal, 75) for i in range(1, 80)]
    print(f'sal {sal:<10}: test {xs.count(\"test\")}, dev {xs.count(\"dev\")} · G-001..G-005 →', xs[:5])"
paso "p4 verificar" python verificar.py splits

# paso 5 · la regla de contaminación
usa contaminacion.py
paso "p5 afinado" cat almacen/afinado/ejemplos.jsonl
paso "p5 contra" python -c "
import sys, json; sys.path.insert(0, 'pipeline')
from contaminacion import contaminadas
from splits import split_de
xs = [json.loads(l) for l in open('almacen/candidatos/expertos.jsonl')]
for x in xs: x['split'] = split_de(x['id'], 'golden-c11', 75)
ej = [json.loads(l) for l in open('almacen/afinado/ejemplos.jsonl')]
print('contaminadas:', contaminadas(xs, ej, 0.6))
print('G-009 es de', [x['split'] for x in xs if x['id'] == 'G-009'][0], 'y es igual al ejemplo A-07: no cuenta')"
paso "p5 verificar" python verificar.py contaminacion

# paso 6 · armar y publicar golden-v1
usa publicar.py
usa armar.py
paso "p6 armar" python pipeline/armar.py
paso "p6 manifiesto" python -c "
import json; m = json.load(open('golden/golden-v1/manifiesto.json'))
print({k: m[k] for k in ('version', 'anterior', 'creado', 'corpus', 'directorio', 'n', 'por_tipo', 'por_split', 'quemadas')}); print('sha256', m['sha256'])"
paso "p6 una" sh -c "grep '\"G-041\"' golden/golden-v1/preguntas.jsonl"
paso "p6 otra vez" python pipeline/armar.py
paso "p6 pisar" python -c "
import sys; sys.path.insert(0, 'pipeline')
from _comun import GOLDEN, subir, YaExiste
try:
    subir(GOLDEN / 'golden-v1', 'golden-v1')
except YaExiste as e:
    print('YaExiste:', e)"
paso "p6 comprobar" python pipeline/publicar.py --comprobar
paso "p6 verificar" python verificar.py publicar cobertura permisos fuentes

# paso 7 · la re-ingesta del 22 y el reanclaje
usa reanclar.py
paso "p7 avanzar" python mundo/avanzar.py
paso "p7 fuentes" python verificar.py fuentes
paso "p7 armar" python pipeline/armar.py
paso "p7 reanclar" python pipeline/reanclar.py
paso "p7 cambios" python -c "
import json
a = json.load(open('golden/anclas.json'))['pasos'][0]
for k, x in a['chunks'].items():
    if not (x['por'] == 'sha' and x['a'] == k): print(f'{k:<14} → {str(x[\"a\"]):<14} por {x[\"por\"]}')
m = json.load(open('golden/golden-v2/manifiesto.json')); print('golden-v2:', m['cambios'])"
paso "p7 verificar" python verificar.py fuentes reanclaje

# paso 8 · lo que va a medir el gate
paso "p8 evaluar" python mundo/evaluar.py
paso "p8 sin filtro" python mundo/evaluar.py --sin-filtro
paso "p8 comparar" python mundo/evaluar.py --comparar
paso "p8 dev" python mundo/evaluar.py --split dev
paso "p8 verificar" python verificar.py

# la ronda Construir solo arranca desde el esqueleto
paso "solo reiniciar" python mundo/reiniciar.py
paso "solo verificar" python verificar.py mundo esquema
