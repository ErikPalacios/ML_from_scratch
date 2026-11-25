#!/usr/bin/env bash
# Corre el Guiado de la estación 2 del RAG en una carpeta limpia, como lo haría una persona, con los archivos de esta
# solución, y deja cada salida real en <carpeta>.log. Es el kit recién descomprimido: el esqueleto en su lugar.
# Uso: bash probar.sh <carpeta-vacía>      (crea su propio .venv con python3; necesita internet para pip y el tokenizer)
set -uo pipefail
SOL="$(cd "$(dirname "$0")" && pwd)"
KIT="$SOL/../rag-chunking"
D="$1"; LOG="$D.log"
rm -rf "$D"; mkdir -p "$D"; : > "$LOG"
paso() { echo "### $1" >> "$LOG"; shift; { "$@" 2>&1; c=$?; [ $c -ne 0 ] && echo "[código $c]"; } | tee -a "$LOG"; echo >> "$LOG"; }
usa() { cp "$SOL/pipeline/$1" "pipeline/$1"; }

# el kit como sale del .zip: el mundo + el esqueleto en su lugar
(cd "$KIT" && tar --exclude .taller --exclude __pycache__ --exclude almacen --exclude chunks --exclude modelo --exclude .venv -cf - .) | (cd "$D" && tar -xf -)
(cd "$KIT/mundo/esqueleto" && tar -cf - .) | (cd "$D" && tar -xf -)
cd "$D"

# paso 0 · el mundo
paso "p0 venv" sh -c 'python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt 2>&1 | grep -v "^\[notice\]"; .venv/bin/python --version; .venv/bin/pip list 2>/dev/null | grep -i -E "^(tokenizers|pyyaml) "'
source .venv/bin/activate
paso "p0 tokenizer" python mundo/tokenizador.py
paso "p0 tokenizer otra vez" python mundo/tokenizador.py
paso "p0 crear" python mundo/crear.py
paso "p0 verificar" python verificar.py mundo
paso "p0 esqueleto" python verificar.py tokens

# precálculos (en el dojo)
paso "pc tokens" python -c "
import sys; sys.path.insert(0, '.')
from mundo import referencia as r
v = r.vivos()
n = {d: r.tokens_texto(x['texto']) for d, x in v.items() if x['texto']}
c = sum(len(x['texto']) for x in v.values())
print(f'{len(n)} documentos con texto · {sum(n.values())} tokens · {c} caracteres · {c / sum(n.values()):.2f} caracteres por token')
print('más de 400:', sorted((d, t) for d, t in n.items() if t > 400))
print('chunks si todo se llenara a 400:', sum(-(-t // 395) for t in n.values()))"
paso "pc corte" python -c "
for n in (400, 512, 1500, 1730):
    print(f'chunk de {n} tokens: e5 lee {min(1, 512 / n):.0%}')"
paso "pc c11" python -c "
docs, por_doc, por_chunk = 1_500_000, 1_500, 300
tok = docs * por_doc; ch = tok // por_chunk
print(f'C11: {tok / 1e9:.2f} mil millones de tokens · {ch / 1e6:.1f} M chunks')
print(f'traslape de 15 % en todo: {0.15 * tok / 1e6:.0f} M tokens más · el 1 % de documentos al día: {0.01 * docs:.0f} documentos, {0.01 * ch / 1e3:.0f} mil chunks')"

# paso 1 · contar tokens
usa tokens.py
paso "p1 contar" python -c "
import sys; sys.path.insert(0, 'pipeline')
from tokens import contar, tokens_texto, tokenizer
for s in ['', 'Hola', '¿Cuántos días tengo para devolver una licuadora?']:
    print(repr(s), contar(s), tokenizer().encode('passage: ' + s).tokens)
print('sin prefijo:', tokens_texto('¿Cuántos días tengo para devolver una licuadora?'))
print('en inglés:', tokens_texto('How many days do I have to return a blender?'))"
paso "p1 verificar" python verificar.py tokens

# paso 2 · bloques
usa bloques.py
paso "p2 bloques" python -c "
import sys, json; sys.path.insert(0, 'pipeline')
from bloques import bloques
c = json.load(open('almacen/catalogo.json'))
t = json.load(open('almacen/texto/' + c['wiki:1002']['hash'] + '.json'))['texto']
for b in bloques(t):
    print(b['tipo'], b.get('nivel', ''), len(b['lineas']), 'líneas ·', b['lineas'][0][:60])"
paso "p2 verificar" python verificar.py bloques

# pasos 3 a 5 · el chunker (la solución trae los tres pasos juntos en chunker.py) y la corrida básica
usa chunker.py
usa chunkear.py
paso "p3 fija" python -c "
import sys, json; sys.path.insert(0, 'pipeline')
from _comun import config
from chunker import chunks
c = json.load(open('almacen/catalogo.json'))
t = json.load(open('almacen/texto/' + c['drive:d21']['hash'] + '.json'))['texto']
cfg = config()['chunking'] | {'estrategia': 'fija'}
for x in chunks(t, 'Tarifas de envío por estado 2026.md', cfg):
    print(x['tokens'], 'tokens · empieza:', repr(x['texto'][:40]), '· termina:', repr(x['texto'][-30:]))"
paso "p3 estructura" python -c "
import sys, json; sys.path.insert(0, 'pipeline')
from _comun import config
from chunker import chunks
c = json.load(open('almacen/catalogo.json'))
for d in ('drive:d20', 'drive:d21'):
    t = json.load(open('almacen/texto/' + c[d]['hash'] + '.json'))['texto']
    for x in chunks(t, c[d]['titulo'], config()['chunking']):
        print(x['tokens'], x['traslape'], ' › '.join(x['ruta']))"
paso "p3 chunkear" python pipeline/chunkear.py
paso "p3 un chunk" sh -c "python -c \"import json; d = json.load(open('chunks/docs/wiki__1002.json')); c = d['chunks'][1]; print(c['texto']); print({k: c[k] for k in ('chunk_id', 'tokens', 'traslape', 'acl')})\""
paso "p3 verificar" python verificar.py ruta docs
paso "p4 tabla" sh -c "python -c \"import json; d = json.load(open('chunks/docs/drive__d21.json')); [print(c['chunk_id'], c['tokens'], '·', ' ⏎ '.join(l[:34] for l in c['texto'].split(chr(10))[2:5]), '… ⏎', c['texto'].split(chr(10))[-1][:34]) for c in d['chunks']]\""
paso "p4 verificar" python verificar.py tamano tablas
paso "p5 traslape" sh -c "python -c \"import json; d = json.load(open('chunks/docs/drive__d20.json')); a, b = [c for c in d['chunks'] if 'Preguntas' in c['ruta'][-1]]; print('…' + a['texto'][-160:]); print('---'); print(b['texto'][:260] + '…'); print(b['traslape'], 'tokens de traslape')\""
paso "p5 verificar" python verificar.py traslape

# paso 6 · un chunk por documento, con su ACL
paso "p6 acl" sh -c "python -c \"import json; d = json.load(open('chunks/docs/drive__d04.json')); print(d['titulo'], d['acl']); print(d['chunks'][0]['acl'])\""
paso "p6 sin texto" sh -c "ls chunks/docs | wc -l; ls chunks/docs/drive__d06.json 2>&1 | head -1"
paso "p6 verificar" python verificar.py docs acl

# paso 7 · incremental y el día 2
paso "p7 segunda" python pipeline/chunkear.py
paso "p7 avanzar" python mundo/avanzar.py
paso "p7 dia2" python pipeline/chunkear.py
paso "p7 corrida" sh -c "python -c \"import json, glob; x = json.load(open(sorted(glob.glob('chunks/corridas/*.json'))[-1])); print({k: x[k] for k in ('rechunkeados', 'solo_meta', 'borrados', 'sin_cambios', 'sin_texto')})\""
paso "p7 ruta" sh -c "python -c \"import json; print(json.load(open('chunks/docs/drive__d08.json'))['chunks'][0]['ruta'])\""
paso "p7 acl nueva" sh -c "python -c \"import json; d = json.load(open('chunks/docs/drive__d01.json')); print(d['acl'], d['chunks'][0]['acl'])\""
paso "p7 tercera" python pipeline/chunkear.py
paso "p7 verificar" python verificar.py

# la ronda Construir solo arranca desde el esqueleto
paso "solo reiniciar" python mundo/reiniciar.py
paso "solo verificar" python verificar.py mundo tokens
