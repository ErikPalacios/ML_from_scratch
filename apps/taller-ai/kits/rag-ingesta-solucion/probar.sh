#!/usr/bin/env bash
# Corre el Guiado de la estación 1 del RAG en una carpeta limpia, como lo haría una persona, con los archivos de esta
# solución, y deja cada salida real en <carpeta>.log. Es el kit recién descomprimido: el esqueleto en su lugar.
# Uso: bash probar.sh <carpeta-vacía>      (crea su propio .venv con python3; necesita internet solo para pip)
set -uo pipefail
SOL="$(cd "$(dirname "$0")" && pwd)"
KIT="$SOL/../rag-ingesta"
D="$1"; LOG="$D.log"
[ -d "$D" ] && (cd "$D" && [ -x .venv/bin/python ] && .venv/bin/python mundo/fuentes.py parar >/dev/null 2>&1)
rm -rf "$D"; mkdir -p "$D"; : > "$LOG"
paso() { echo "### $1" >> "$LOG"; shift; { "$@" 2>&1; c=$?; [ $c -ne 0 ] && echo "[código $c]"; } | tee -a "$LOG"; echo >> "$LOG"; }
usa() { cp "$SOL/pipeline/$1" "pipeline/$1"; }

# el kit como sale del .zip: el mundo + el esqueleto en su lugar
(cd "$KIT" && tar --exclude .taller --exclude __pycache__ --exclude fuentes --exclude almacen --exclude .venv -cf - .) | (cd "$D" && tar -xf -)
(cd "$KIT/mundo/esqueleto" && tar -cf - .) | (cd "$D" && tar -xf -)
cd "$D"

# paso 0 · el mundo
paso "p0 venv" sh -c 'python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt 2>&1 | grep -v "^\[notice\]"; .venv/bin/python --version'
source .venv/bin/activate
paso "p0 crear" python mundo/crear.py
paso "p0 arrancar" python mundo/fuentes.py arrancar
paso "p0 verificar" python verificar.py mundo
paso "p0 esqueleto" python verificar.py http

# precálculos sobre el mundo recién creado
paso "pc corpus" python mundo/fuentes.py estado
paso "pc crudo" python -c "
import sys; sys.path.insert(0, '.')
from mundo.comun import estado
from mundo.referencia import esperado
e = esperado(estado())
por = {}
for d, v in e.items():
    f = d.split(':')[0]; por[f] = por.get(f, 0) + len(v['crudo'])
print(' · '.join(f'{f} {b / 1024:.0f} KiB' for f, b in por.items()), f'· total {sum(por.values()) / 1024:.0f} KiB en {len(e)} documentos')"
paso "pc hash" python -c "
import hashlib, time
b = bytes(512 * 2**20)
t = time.perf_counter(); hashlib.sha256(b).hexdigest(); s = time.perf_counter() - t
print(f'sha256 de 512 MiB en {s:.2f} s: {512 / 1024 / s:.1f} GiB/s en un núcleo')"
paso "pc llamadas" python -c "
import sys; sys.path.insert(0, '.')
from mundo.comun import estado, ancestros
e = estado(); ps = e['wiki']['paginas']
lista = sum(-(-sum(1 for p in ps.values() if p['espacio'] == s) // 10) for s in e['wiki']['espacios'])
print(f'{len(ps)} páginas: {lista} llamadas de lista + {len(ps)} de cuerpo + {len(ps)} de restricciones + {len(e[\"wiki\"][\"espacios\"])} de permisos de espacio = {lista + 2 * len(ps) + 3}')
print(f'a {e[\"limite_wiki\"]} por segundo: ≥ {(lista + 2 * len(ps) + 3) / e[\"limite_wiki\"]:.1f} s')"

# paso 1 · pedir()
usa conectores/http.py
paso "p1 pedir" python -c "
import sys; sys.path.insert(0, 'pipeline')
from conectores.http import pedir, LLAMADAS, ESPERAS
print(pedir('politicas', '/arbol')['archivos'][:2])
print(pedir('drive', '/files/no-existe'))
for _ in range(20): pedir('wiki', '/espacios/SOP/permisos')
print('llamadas', dict(LLAMADAS), '· 429 esperados', dict(ESPERAS))"
paso "p1 401" python -c "
from urllib.request import Request, urlopen
from urllib.error import HTTPError
try:
    urlopen(Request('http://localhost:8120/jira/api/nivel/10001', headers={'Authorization': 'Bearer otro'}))
except HTTPError as e:
    print(e.code, e.read().decode())"
paso "p1 verificar" python verificar.py http

# paso 2 · wiki
usa conectores/wiki.py
paso "p2 lista" python -c "
import sys; sys.path.insert(0, 'pipeline')
from _comun import config
from conectores.http import pedir
r = pedir('wiki', '/paginas', {'espacio': 'SOP', 'inicio': 0, 'limite': 10})
print(len(r['resultados']), 'resultados · siguiente:', r['siguiente'])
print(r['resultados'][0])"
paso "p2 restricciones" python -c "
import sys; sys.path.insert(0, 'pipeline')
from conectores.http import pedir
for p in ('3003', '3004'):
    print(p, pedir('wiki', f'/paginas/{p}/restricciones'))"
paso "p2 acl" python -c "
import sys; sys.path.insert(0, 'pipeline')
from conectores import wiki
refs = {r['doc_id']: r for r in wiki.listar()}
print(len(refs), 'páginas')
for d in ('wiki:2002', 'wiki:3003', 'wiki:3004'):
    print(d, refs[d]['titulo'], '→', wiki.acl(refs[d]))"
paso "p2 verificar" python verificar.py wiki

# paso 3 · drive
usa conectores/drive.py
paso "p3 permisos" python -c "
import sys, json; sys.path.insert(0, 'pipeline')
from conectores.http import pedir
for f in ('d04', 'd09'):
    print(f, json.dumps(pedir('drive', f'/files/{f}/permissions')['permissions'], ensure_ascii=False))"
paso "p3 acl" python -c "
import sys; sys.path.insert(0, 'pipeline')
from conectores import drive
refs = {r['doc_id']: r for r in drive.listar()}
for d in ('drive:d01', 'drive:d04', 'drive:d09', 'drive:d10'):
    print(d, refs[d]['titulo'], '→', drive.acl(refs[d]))
r, b, cur = drive.cambios(None)
print(len(r), 'archivos · cursor', cur)"
paso "p3 verificar" python verificar.py drive

# paso 4 · jira y políticas
usa conectores/jira.py
usa conectores/politicas.py
paso "p4 jql" python -c "
import sys; sys.path.insert(0, 'pipeline')
from zoneinfo import ZoneInfo
from _comun import utc
d = '2026-11-20T14:59:40Z'
print(d, '→', f'updated >= \"{utc(d).astimezone(ZoneInfo(\"America/Mexico_City\")):%Y-%m-%d %H:%M}\"')
from conectores.http import pedir
r = pedir('jira', '/buscar', {'jql': 'project in (SOP, SEG) AND updated >= \"2026-11-20 14:59\"'})
print('con la hora en UTC sin convertir:', len(r['issues']), 'tickets')
r = pedir('jira', '/buscar', {'jql': 'project in (SOP, SEG) AND updated >= \"2026-11-20 08:59\"'})
print('en la zona de la cuenta:', [(t['key'], t['fields']['updated']) for t in r['issues']])"
paso "p4 acl" python -c "
import sys; sys.path.insert(0, 'pipeline')
from conectores import jira, politicas
refs = {r['doc_id']: r for r in jira.listar()}
print(len(refs), 'tickets')
for d in ('jira:SOP-1', 'jira:SOP-5', 'jira:SEG-1'):
    print(d, '→', jira.acl(refs[d]))
p = politicas.listar()
print(len(p), 'políticas ·', p[0]['doc_id'], p[0]['version'])"
paso "p4 verificar" python verificar.py jira politicas

# paso 5 · parsing
usa parsing.py
paso "p5 html" python -c "
import sys; sys.path.insert(0, 'pipeline')
from conectores import wiki
from parsing import parsear
d = wiki.traer({'doc_id': 'wiki:2002', 'meta': {}})
print(d['crudo'].decode()[:420]); print('---')
print(parsear(d)['texto'])"
paso "p5 pdf" python -c "
import sys, io; sys.path.insert(0, 'pipeline')
from pypdf import PdfReader
from conectores import drive
from parsing import parsear
refs = {r['doc_id']: r for r in drive.listar()}
d = drive.traer(refs['drive:d01'])
print(PdfReader(io.BytesIO(d['crudo'])).pages[0].extract_text()); print('---')
print(parsear(d)['texto']); print('---')
print(parsear(drive.traer(refs['drive:d06'])))"
paso "p5 ticket" python -c "
import sys; sys.path.insert(0, 'pipeline')
from conectores import jira
from parsing import parsear
d = jira.traer({'doc_id': 'jira:SOP-1', 'meta': {}})
import json; t = json.loads(d['crudo'])['fields']
print(t['description']); print('--- un comentario:'); print(t['comment']['comments'][1]['body']); print('--- el texto:')
print(parsear(d)['texto'])"
paso "p5 verificar" python verificar.py parsing

# paso 6 · el almacén
usa almacen.py
paso "p6 hash" python -c "
import sys; sys.path.insert(0, 'pipeline')
from _comun import sha256
from conectores import wiki
import almacen
from parsing import parsear
d = wiki.traer({'doc_id': 'wiki:2002', 'meta': {}})
h = sha256(d['crudo'])
print('hash', h[:16], '· tiene_texto antes:', almacen.tiene_texto(h))
almacen.guardar_texto(h, parsear(d))
print('tiene_texto después:', almacen.tiene_texto(h), '·', almacen.ruta_texto(h).name)
print('otra vez el mismo contenido:', sha256(wiki.traer({'doc_id': 'wiki:2002', 'meta': {}})['crudo']) == h)"
rm -rf almacen

# paso 7 · la ingestión, la primera vez y la segunda
usa ingestar.py
paso "p7 primera" python pipeline/ingestar.py
paso "p7 segunda" python pipeline/ingestar.py
paso "p7 almacen" sh -c 'ls almacen; ls almacen/texto | head -3; echo "$(ls almacen/texto | wc -l | tr -d " ") archivos · $(cat almacen/texto/*.json | wc -c | tr -d " ") bytes"; cat almacen/cursores.json'
paso "p7 registro" python -c "
import json
c = json.load(open('almacen/catalogo.json'))
print(json.dumps(c['drive:d04'], ensure_ascii=False, indent=1))"
paso "p7 verificar" python verificar.py almacen catalogo

# paso 8 · un día después: incremental, barrido y freno
paso "p8 avanzar" python mundo/avanzar.py
paso "p8 antes" python verificar.py catalogo
paso "p8 incremental" python pipeline/ingestar.py
paso "p8 sin barrido" python verificar.py catalogo
paso "p8 barrido" python pipeline/ingestar.py --barrido
paso "p8 lapidas" python -c "
import json
c = json.load(open('almacen/catalogo.json'))
for d, x in c.items():
    if x['borrado']: print(d, x['titulo'], '·', x['motivo'])
print('wiki:2003 →', c['wiki:2003']['acl'])"
paso "p8 verificar" python verificar.py incremental barrido catalogo

paso "final" python verificar.py
python mundo/fuentes.py parar >/dev/null
echo "listo: $LOG"
