#!/usr/bin/env bash
# Corre el Guiado de la estación 2 de IA Privada en una carpeta limpia, como lo haría una persona, con los archivos de
# esta solución, y deja cada salida real en <carpeta>.log. Es el kit recién descomprimido: el esqueleto en su lugar.
# Uso: bash probar.sh <carpeta-vacía>     (necesita llama.cpp 1.1.0+ e internet para bajar el f16 una vez)
# Con TRUEML_MODELOS=/otra/carpeta copia el f16 de ahí (con su sha256) en vez de bajarlo (≈ 1.5 GB).
set -uo pipefail
SOL="$(cd "$(dirname "$0")" && pwd)"
KIT="$SOL/../ia-privada-cuantizacion"
D="$1"; LOG="$D.log"
rm -rf "$D"; mkdir -p "$D"; : > "$LOG"
paso() { echo "### $1" >> "$LOG"; shift; { "$@" 2>&1; c=$?; [ $c -ne 0 ] && echo "[código $c]"; } | tee -a "$LOG"; echo >> "$LOG"; }
usa() { cp "$SOL/pipeline/$1" "pipeline/$1"; }

(cd "$KIT" && tar --exclude .taller --exclude __pycache__ --exclude modelo --exclude cuantizados --exclude resultados --exclude .respaldo -cf - .) | (cd "$D" && tar -xf -)
(cd "$KIT/mundo/esqueleto" && tar -cf - .) | (cd "$D" && tar -xf -)
cd "$D"

# paso 0 · el mundo
paso "p0 version" sh -c 'llama-server --version 2>&1 | grep -E "^version"; for h in llama-quantize llama-perplexity; do command -v $h; done; python3 --version'
paso "p0 modelos" python3 mundo/modelos.py
paso "p0 verificar" python3 verificar.py mundo
paso "p0 ficha" python3 mundo/ficha.py modelo/Qwen3-0.6B-f16.gguf --tipos
paso "p0 esqueleto" python3 verificar.py cuantizar

# precálculos (en el despacho y en el dojo; los supuestos del despacho van escritos en cada comando)
paso "pc tamanos" python3 -c "
import sys; sys.path.insert(0, '.'); from pathlib import Path; from mundo.ficha import resumen
n = resumen(Path('modelo/Qwen3-0.6B-f16.gguf'))['pesos']
for nombre, bits in (('f16', 16), ('Q8_0', 8.5), ('Q4_K_M', 4.9), ('Q2_K', 3.6)):
    print(f'dojo:     {nombre:<7} {n / 1e6:,.1f} M pesos × {bits:>4} bits ÷ 8 = {n * bits / 8 / 1e6:6,.0f} MB')
for nombre, gb in (('FP16', 32.76e9 * 2 / 1e9), ('INT8', 32.76e9 * 8.5 / 8 / 1e9), ('INT4 (AWQ)', 19.32)):
    print(f'despacho: Qwen3 32B en {nombre:<10} ≈ {gb:5.1f} GB de pesos')"
paso "pc memoria" python3 -c "
util, kv, prog = 43.2, 17.18, 2          # GB útiles de la L40S de 48 GB · KV de 8 conversaciones de 8,192 tokens · el programa (la ficha del despacho)
for nombre, pesos in (('FP16', 65.52), ('INT8', 34.81), ('INT4 (AWQ)', 19.32)):
    t = pesos + kv + prog
    print(f'despacho: {nombre:<10} {pesos:5.2f} + {kv} de KV + {prog} = {t:5.2f} GB de {util} útiles: {\"cabe\" if t <= util else \"no cabe\"}')
print('dojo:     el KV cache no cambia al cuantizar los pesos: 112 KiB por token en las tres (28 capas × 8 cabezas K/V × 128 × 2 × 2 B)')"
paso "pc techo" python3 -c "
ancho = 120                              # GB/s de memoria del M4 de esta Mac
for nombre, mb in (('Q8_0', 798.8), ('Q4_K_M', 478.3), ('Q2_K', 341.3)):
    print(f'dojo:     {nombre:<7} techo {ancho} GB/s ÷ {mb / 1000:.3f} GB = {ancho / (mb / 1000):4.0f} tokens/s')
for nombre, gb in (('FP16', 65.52), ('INT8', 34.81), ('INT4 (AWQ)', 19.32)):
    print(f'despacho: {nombre:<10} 0.7 × 864 GB/s ÷ {gb:5.2f} GB = {0.7 * 864 / gb:4.1f} tokens/s por conversación (objetivo ≥ 20)')"

# paso 1 · cuantizar
usa cuantizar.py
paso "p1 cuantizar" python3 pipeline/cuantizar.py
paso "p1 otra vez" python3 pipeline/cuantizar.py
paso "p1 manifiesto" python3 -c "
import json; m = json.load(open('cuantizados/manifiesto.json'))
print(json.dumps(m['Q4_K_M'], indent=1))"
paso "p1 ficha" sh -c 'for t in Q8_0 Q4_K_M Q2_K; do python3 mundo/ficha.py cuantizados/Qwen3-0.6B-$t.gguf --tipos | sed -n "1p;5,\$p"; echo; done'
paso "p1 verificar" python3 verificar.py cuantizar

# paso 2 · una muestra
usa medir.py
paso "p2 muestra" python3 -c "
import sys, json; sys.path.insert(0, '.'); sys.path.insert(0, 'pipeline')
from mundo.servidor import servido; from mundo.comun import medicion, leer_json; from medir import una_peticion
cfg = medicion()['velocidad']; p = leer_json('mundo/entrada/prompts.json')
with servido('cuantizados/Qwen3-0.6B-Q8_0.gguf') as url:
    una_peticion(url, p['sistema'], p['prompts'][0]['texto'], cfg)       # calentar
    for x in p['prompts']:
        print(x['id'], json.dumps(una_peticion(url, p['sistema'], x['texto'], cfg)))
    print('sin largo fijo:', json.dumps(una_peticion(url, p['sistema'], p['prompts'][0]['texto'], cfg | {'largo_fijo': False})))
    una_peticion(url, p['sistema'], p['prompts'][1]['texto'], cfg | {'cache_prompt': True})
    print('con cache, otra vez el largo:', json.dumps(una_peticion(url, p['sistema'], p['prompts'][1]['texto'], cfg | {'cache_prompt': True})))"

# paso 3 · medir las tres
paso "p3 medir" python3 pipeline/medir.py
paso "p3 muestras" python3 -c "
import json; v = json.load(open('resultados/velocidad.json'))
for t, x in v['cuantizaciones'].items():
    for p, ms in x['muestras'].items():
        print(f'{t:<7} {p:<6} ' + ' · '.join(f'TTFT {s[\"ttft_ms\"]:6.0f} ms, escribe {s[\"decode_tps\"]:5.1f}/s, {s[\"prompt_n\"]:,} → {s[\"tokens\"]} tokens' for s in ms))"
paso "p3 verificar" python3 verificar.py comparable velocidad

# paso 4 · perplejidad
usa calidad.py
paso "p4 perplejidad" python3 -c "
import sys; sys.path.insert(0, '.'); sys.path.insert(0, 'pipeline')
from mundo.comun import medicion; from calidad import perplejidad
cfg = medicion()['calidad']
for g in ('modelo/Qwen3-0.6B-f16.gguf', 'cuantizados/Qwen3-0.6B-Q2_K.gguf'):
    print(g, perplejidad(g, cfg))"

# paso 5 · el examen y la calidad de las tres
paso "p5 q2" python3 -c "
import sys; sys.path.insert(0, '.'); sys.path.insert(0, 'pipeline')
from mundo.comun import medicion; from mundo.servidor import servido; from calidad import examen
for t in ('Q8_0', 'Q2_K'):
    with servido(f'cuantizados/Qwen3-0.6B-{t}.gguf') as url:
        r = examen(url, medicion()['calidad'])
    print(f'{t}: {r[\"aciertos\"]}/{r[\"total\"]}')
    for q in r['respuestas'][:3]:
        print(f'  {q[\"id\"]} {\"✓\" if q[\"bien\"] else \"✗\"} {q[\"respuesta\"][:70]!r}')"
paso "p5 calidad" python3 pipeline/calidad.py
paso "p5 verificar" python3 verificar.py calidad

# paso 6 · lado a lado
paso "p6 reporte" python3 pipeline/reporte.py
paso "p6 verificar" python3 verificar.py reporte
paso "fin verificar" python3 verificar.py

# la ronda Construir solo arranca desde el esqueleto
paso "solo reiniciar" python3 mundo/reiniciar.py
paso "solo verificar" python3 verificar.py mundo cuantizar
