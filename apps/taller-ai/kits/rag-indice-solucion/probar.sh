#!/usr/bin/env bash
# Corre el Guiado de la estación 5 del RAG en una carpeta limpia, como lo haría una persona, con los archivos de esta
# solución, y deja cada salida real en <carpeta>.log. Es el kit recién descomprimido: el esqueleto en su lugar.
# Uso: bash probar.sh <carpeta-vacía>      (crea su propio .venv con python3; necesita internet para pip y los modelos)
# Con DOJO_MODELOS=/otra/copia/modelo copia los modelos de ahí en vez de bajarlos (≈ 578 MB).
set -uo pipefail
SOL="$(cd "$(dirname "$0")" && pwd)"
KIT="$SOL/../rag-indice"
D="$1"; LOG="$D.log"
rm -rf "$D"; mkdir -p "$D"; : > "$LOG"
paso() { echo "### $1" >> "$LOG"; shift; { "$@" 2>&1; c=$?; [ $c -ne 0 ] && echo "[código $c]"; } | tee -a "$LOG"; echo >> "$LOG"; }
usa() { cp "$SOL/pipeline/$1" "pipeline/$1"; }
espera() { python -c "import time; time.sleep($1)"; }

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
paso "p0 esqueleto" python verificar.py embeddings

# precálculos (en el dojo y en C11; los supuestos de C11 van escritos en cada comando)
paso "pc tamano" python -c "
for nombre, n, d in (('dojo, e5-small', 151, 384), ('C11, e5-small', 7_500_000, 384), ('C11, un modelo de 1,024', 7_500_000, 1024)):
    b = n * d * 4                                   # float32 = 4 bytes por número
    print(f'{nombre:<24} {n:>9,} chunks × {d:>5,} × 4 B = {b / 1e9:8.4f} GB' if b > 1e8 else f'{nombre:<24} {n:>9,} chunks × {d:>5,} × 4 B = {b / 1e3:,.0f} KB')"
paso "pc modelo" python -c "
import json; from tokenizers import Tokenizer
cat = json.load(open('mundo/modelos.json'))
for k in ('e5', 'minilm'):
    m = cat[k]; b = m['archivos']['model.onnx']['bytes']; v = Tokenizer.from_file(f'modelo/{k}/tokenizer.json').get_vocab_size()
    print(f'{k:<6} {b / 1e6:5.0f} MB ÷ 4 B ≈ {b / 4 / 1e6:5.1f} M parámetros · vocabulario {v:,} × {m[\"dim\"]} = {v * m[\"dim\"] / 1e6:4.1f} M ({v * m[\"dim\"] / (b / 4):.0%} del modelo)')"
paso "pc fuerza" python -c "
import time, numpy as np
n, d = 500_000, 384
M = np.random.default_rng(0).standard_normal((n, d), dtype=np.float32); q = M[0]
M @ q; t = time.perf_counter()
for _ in range(20): M @ q
ms = (time.perf_counter() - t) / 20 * 1000
print(f'en tu Mac: {n:,} vectores × {d} en {ms:.1f} ms por pregunta ({n * d * 4 / 1e9:.2f} GB leídos)')
print(f'C11, 7.5 M chunks: ≈ {ms * 7_500_000 / n:.0f} ms por pregunta, solo de multiplicar, si todo cabe en RAM (11.5 GB)')"

# paso 1 · embeddings
usa embeber.py
paso "p1 frases" python pipeline/embeber.py "¿Cuánto tarda un reembolso a tarjeta?" "Los reembolsos a tarjeta de débito tardan de 5 a 10 días hábiles." "El calendario de pagos a vendedores sale los lunes."
paso "p1 minilm" python pipeline/embeber.py --modelo minilm "¿Cuánto tarda un reembolso a tarjeta?" "Los reembolsos a tarjeta de débito tardan de 5 a 10 días hábiles." "El calendario de pagos a vendedores sale los lunes."
paso "p1 tokens" python -c "
import json; from tokenizers import Tokenizer
c = json.load(open('almacen/corpus/vigente.json'))['chunks']
for k, pre, tope in (('e5', 'passage: ', 512), ('minilm', '', 256)):
    t = Tokenizer.from_file(f'modelo/{k}/tokenizer.json'); t.no_truncation(); t.no_padding(); n = [len(t.encode(pre + x['texto']).ids) for x in c.values()]
    print(f'{k:<6} tokens por chunk: promedio {sum(n) / len(n):.0f}, el más largo {max(n)} · tope {tope}: {sum(x > tope for x in n)} chunks se cortan')"
paso "p1 verificar" python verificar.py embeddings

# paso 2 · el cache
paso "p2 cache" python -c "
import sys, time, json; sys.path.insert(0, 'pipeline')
from embeber import Modelo, embeber_chunks
from tokenizers import Tokenizer
c = json.load(open('almacen/corpus/vigente.json'))['chunks']; m = Modelo('e5')
for vez in ('primera', 'segunda'):
    t = time.perf_counter(); ids, M, nuevos = embeber_chunks(c, m); s = time.perf_counter() - t
    print(f'{vez} vez: {nuevos:>3} embebidos de {len(ids)} en {s:.2f} s · matriz {M.shape} {M.dtype}')
t = Tokenizer.from_file('modelo/e5/tokenizer.json'); t.no_truncation(); t.no_padding(); tok = sum(len(t.encode('passage: ' + x['texto']).ids) for x in c.values())
t = time.perf_counter(); m.embeber([x['texto'] for x in c.values()], 'pasaje'); s = time.perf_counter() - t
print(f'sin cache: {tok:,} tokens en {s:.2f} s = {tok / s:,.0f} tokens/s en tu Mac')
print(f'C11, 7.5 M chunks × ≈ 300 tokens = 2.25 mil millones de tokens ÷ {tok / s:,.0f}/s ≈ {2.25e9 / (tok / s) / 3600:,.0f} h en una Mac como esta')
print(f'C11, lo que cambia en un día (≈ 75 mil chunks × 300): ≈ {75_000 * 300 / (tok / s) / 3600:.1f} h')"
paso "p2 carpeta" sh -c 'ls cache/embeddings/; ls cache/embeddings/e5@* | head -3; ls cache/embeddings/e5@* | wc -l | tr -d " "'
paso "p2 verificar" python verificar.py cache

# paso 3 · BM25
usa bm25.py
paso "p3 codigo" python pipeline/bm25.py "¿Qué dice el ticket SEG-5?"
paso "p3 nombre" python pipeline/bm25.py "¿Un paquete de 25 kg se puede mandar con guía del marketplace?"
paso "p3 parafrasis" python pipeline/bm25.py "¿En cuánto tiempo me regresan el dinero si pagué con tarjeta?"
paso "p3 verificar" python verificar.py bm25

# paso 4 · vectores
usa vectores.py
paso "p4 verificar" python verificar.py vectores

# paso 5 · construir al lado
usa construir.py
paso "p5 construir" python pipeline/construir.py
paso "p5 archivos" sh -c 'ls -l indices/c11-e5-2026-11-22/ | awk "NR>1 {print \$5, \$9}"; du -sh indices/* | sed "s/\t/ /"'
paso "p5 manifiesto" python -c "
import json; m = json.load(open('indices/c11-e5-2026-11-22/manifiesto.json'))
print(json.dumps({k: m[k] for k in ('nombre', 'estado', 'corpus', 'modelo', 'dimension', 'similitud', 'n')}, ensure_ascii=False, indent=1))"
paso "p5 revisar" python pipeline/construir.py --revisar c11-e5-2026-11-22
paso "p5 alias" python pipeline/alias.py listar 2>&1 || cat indices/alias.json
paso "p5 verificar" python verificar.py construir completo

# paso 6 · buscar y la prueba con el golden set
usa buscar.py
usa prueba.py
usa alias.py
paso "p6 buscar" python pipeline/buscar.py --indice c11-e5-2026-11-22 --persona elena.cruz@marketplace.test "¿En cuánto tiempo me regresan el dinero si pagué con tarjeta?"
paso "p6 piloto" python pipeline/prueba.py --indice c11-minilm-2026-11-22
paso "p6 nuevo" python pipeline/prueba.py --indice c11-e5-2026-11-22
paso "p6 otra consulta" python pipeline/prueba.py --indice c11-e5-2026-11-22 --consulta minilm
paso "p6 dev" python pipeline/prueba.py --indice c11-e5-2026-11-22 --split dev
paso "p6 verificar" python verificar.py permisos prueba

# paso 7 · el alias, sin cortar el servicio
python mundo/servicio.py > servicio.log 2>&1 & SP=$!
espera 3
paso "p7 salud" curl -s http://localhost:8150/salud
paso "p7 una" curl -s "http://localhost:8150/buscar?persona=elena.cruz@marketplace.test&indice=vectores&k=3&q=plazo+para+devolver+electr%C3%B3nica"
python mundo/trafico.py --segundos 15 > trafico.log 2>&1 & TP=$!
espera 5
paso "p7 cambiar" python pipeline/alias.py cambiar c11 c11-e5-2026-11-22
wait $TP
paso "p7 trafico" cat trafico.log
paso "p7 servicio" cat servicio.log
python mundo/trafico.py --segundos 8 > trafico2.log 2>&1 & TP=$!
espera 3
paso "p7 volver" python pipeline/alias.py volver c11
wait $TP
paso "p7 trafico volver" cat trafico2.log
paso "p7 otra vez" python pipeline/alias.py cambiar c11 c11-e5-2026-11-22
espera 2
paso "p7 salud nueva" curl -s http://localhost:8150/salud
paso "p7 a medias" python -c "
import sys, os, json; sys.path.insert(0, 'pipeline')
from alias import apuntar
os.makedirs('indices/c11-e5-prueba', exist_ok=True); json.dump({'nombre': 'c11-e5-prueba', 'estado': 'construyendo'}, open('indices/c11-e5-prueba/manifiesto.json', 'w'))
try: apuntar('c11', 'c11-e5-prueba')
except ValueError as e: print('ValueError:', e)
import shutil; shutil.rmtree('indices/c11-e5-prueba')"
paso "p7 verificar" python verificar.py consulta alias
kill $SP 2>/dev/null; wait $SP 2>/dev/null
paso "p7 noche" python mundo/noche.py
paso "p7 alias final" python pipeline/alias.py listar

# todo
paso "fin verificar" python verificar.py

# la ronda Construir solo arranca desde el esqueleto
paso "solo reiniciar" python mundo/reiniciar.py
paso "solo verificar" python verificar.py mundo embeddings
