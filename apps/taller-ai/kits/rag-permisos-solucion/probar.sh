#!/usr/bin/env bash
# Corre el Guiado de la estación 3 del RAG en una carpeta limpia, como lo haría una persona, con los archivos de esta
# solución, y deja cada salida real en <carpeta>.log. Es el kit recién descomprimido: el esqueleto en su lugar.
# Uso: bash probar.sh <carpeta-vacía>      (crea su propio .venv con python3; necesita internet para pip)
set -uo pipefail
SOL="$(cd "$(dirname "$0")" && pwd)"
KIT="$SOL/../rag-permisos"
D="$1"; LOG="$D.log"
rm -rf "$D"; mkdir -p "$D"; : > "$LOG"
paso() { echo "### $1" >> "$LOG"; shift; { "$@" 2>&1; c=$?; [ $c -ne 0 ] && echo "[código $c]"; } | tee -a "$LOG"; echo >> "$LOG"; }
usa() { cp "$SOL/pipeline/$1" "pipeline/$1"; }
cfg() { python - "$@" <<'Y'
import re, sys
clave, viejo, nuevo = sys.argv[1:]
s = open("config.yaml").read()
s2 = re.sub(rf"(?m)^(\s*{clave}:\s*){re.escape(viejo)}", lambda m: m.group(1) + nuevo, s, count=1)
assert s2 != s, (clave, viejo)
open("config.yaml", "w").write(s2)
print(f"config.yaml: {clave}: {viejo} → {nuevo}")
Y
}

# el kit como sale del .zip: el mundo + el esqueleto en su lugar
(cd "$KIT" && tar --exclude .taller --exclude __pycache__ --exclude almacen --exclude indice --exclude .venv -cf - .) | (cd "$D" && tar -xf -)
(cd "$KIT/mundo/esqueleto" && tar -cf - .) | (cd "$D" && tar -xf -)
cd "$D"

# paso 0 · el mundo
paso "p0 venv" sh -c 'python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt 2>&1 | grep -v "^\[notice\]"; .venv/bin/python --version; .venv/bin/pip list 2>/dev/null | grep -i -E "^pyyaml "'
source .venv/bin/activate
paso "p0 crear" python mundo/crear.py
paso "p0 verificar" python verificar.py mundo
paso "p0 esqueleto" python verificar.py principals

# precálculos (en el dojo y en C11; los supuestos de C11 van escritos en cada comando)
paso "pc grupos" python -c "
import sys; sys.path.insert(0, '.')
from mundo import referencia as r
d = r.directorio(); cs = [c for x in r.docs().values() for c in x['chunks']]
g = sum(sum(len(cl) for cl in c['acl']) for c in cs)
p = sum(sum(r.puede_ver(c['acl'], r.principals(q, d)) for q in r.personas()) for c in cs)
print(f'dojo · {len(cs)} chunks · ACL en grupos: {g} principals ({g / len(cs):.1f} por chunk) · expandida a personas: {p} ({p / len(cs):.1f} por chunk)')
chunks, prin, gente = 7_500_000, 3, 400     # supuestos de C11: 3 principals por ACL; 400 personas detrás de cada ACL
print(f'C11  · {chunks / 1e6:.1f} M chunks · en grupos: {chunks * prin / 1e6:.1f} M principals · expandida: {chunks * gente / 1e9:.1f} mil millones')"
paso "pc quitar" python -c "
import sys; sys.path.insert(0, '.')
from mundo import referencia as r
f = 'group:fraude@marketplace.test'
n = sum(1 for x in r.docs().values() for c in x['chunks'] if any(f in cl for cl in c['acl']))
print(f'dojo · Tomás sale de fraude · en grupos: 0 chunks que reescribir (1 cambio en la copia del directorio) · expandida a personas: {n} chunks')
print(f'C11  · alguien sale de soporte, que está en el 10 % de los chunks (supuesto) · en grupos: 0 chunks · expandida: {0.10 * 7_500_000 / 1e3:.0f} mil chunks')"
paso "pc retraso" python -c "
entrega, slo, por_dia = 20, 300, 25_000
for cada in (60, 280, 900, 3600):
    peor = entrega + cada
    print(f'carril cada {cada:>4} s: peor caso {peor:>4} s · ' + ('cabe en 5 min' if peor <= slo else f'{peor / slo:.1f} veces el SLO'))
cada_pregunta = 86400 / por_dia
print(f'C11 · {por_dia:,} preguntas al día = una cada {cada_pregunta:.1f} s en promedio: en 5 min caben ≈ {slo / cada_pregunta:.0f} preguntas; en una hora, ≈ {3600 / cada_pregunta:,.0f}')"
paso "pc postfiltro" python -c "
import sys; sys.path.insert(0, '.')
from mundo import referencia as r
n = sum(len(x['chunks']) for x in r.docs().values())
for q in ('ana.ruiz', 'irene.sol', 'carmen.nava', 'diego.luna'):
    v = len(r.permitidos(q + '@marketplace.test')); p = v / n
    print(f'dojo · {q:<11} ve {v:>3} de {n} ({p:5.1%}) · post-filter con top-8: le llegan {8 * p:.1f} en promedio · para asegurar 8 habría que pedir ≈ {8 / p:.0f}')
p = 0.02                                    # supuesto de C11: alguien de un área chica ve el 2 % del corpus
print(f'C11  · alguien que ve el 2 % · post-filter con top-8: {8 * p:.2f} en promedio · para asegurar 8 habría que pedir ≈ {8 / p:.0f}')"
paso "pc prueba" python -c "
import sys; sys.path.insert(0, '.')
from mundo import referencia as r
acls = {repr(x['acl']) for x in r.docs().values()}
print(f'dojo · {len(r.personas())} personas × {len(acls)} ACL distintas = {len(r.personas()) * len(acls)} combinaciones (persona × documento serían {len(r.personas()) * len(r.docs())})')
gente, docs = 5_000, 1_500_000              # supuesto de C11: 5,000 personas
print(f'C11  · {gente:,} personas × {docs / 1e6:.1f} M documentos = {gente * docs / 1e9:.1f} mil millones de combinaciones: no se prueban todas')"

# paso 1 · quién es quién
usa directorio.py
paso "p1 principals" python -c "
import sys, json; sys.path.insert(0, 'pipeline')
from directorio import principals
d = json.load(open('almacen/directorio.json'))
for p in ('ana.ruiz@marketplace.test', 'paula.vega@marketplace.test', 'luis.campos@paqueteria-aliada.test'):
    for n in (1, 10):
        print(p.split('@')[0], 'profundidad', n, '→', sorted(x.split('@')[0] for x in principals(p, d, n)))"
paso "p1 verificar" python verificar.py principals

# paso 2 · ¿puede verlo?
usa permisos.py
paso "p2 casos" python -c "
import sys, json; sys.path.insert(0, 'pipeline')
from directorio import principals
from permisos import puede_ver
d = json.load(open('almacen/directorio.json'))
acl = json.load(open('almacen/docs/wiki__3004.json'))['acl']
print('Caso Transportes del Norte:', acl)
for p in ('irene.sol', 'paula.vega', 'ana.ruiz'):
    print(f'  {p:<10}', puede_ver(acl, principals(p + '@marketplace.test', d, 10)))
print('acl vacía:', puede_ver([], {'domain:marketplace.test'}), '· cláusula vacía:', puede_ver([[]], {'domain:marketplace.test'}))"
paso "p2 verificar" python verificar.py permisos

# paso 3 · el índice
usa indexar.py
paso "p3 indexar" python pipeline/indexar.py
paso "p3 un chunk" python -c "
import json; idx = json.load(open('indice/indice.json'))
c = idx['chunks']['wiki:1006#000']; print({k: c[k] for k in ('doc_id', 'titulo', 'acl')}); print(idx['docs']['wiki:1006'])"
paso "p3 verificar" python verificar.py indice

# paso 4 · filtrar antes del top-k
usa buscar.py
paso "p4 antes" python pipeline/buscar.py --como ana.ruiz@marketplace.test "Cuenta de vendedor duplicada"
paso "p4 despues" sh -c "$(declare -f cfg); cfg filtro antes despues && python pipeline/buscar.py --como ana.ruiz@marketplace.test 'Cuenta de vendedor duplicada'; cfg filtro despues antes"
paso "p4 verificar" python verificar.py filtro

# paso 5 · el último filtro antes del prompt
paso "p5 contexto" python -c "
import sys, json; sys.path.insert(0, 'pipeline')
from buscar import buscar, contexto, indice
c = indice()['chunks']['drive:d04#000']
falso = {'chunk_id': 'drive:d04#000', 'texto': c['texto'], 'acl': [['domain:marketplace.test']]}
r = contexto([falso] + buscar('Código de conducta', 'diego.luna@marketplace.test'), 'diego.luna@marketplace.test')
print('fuentes:', r['fuentes'], '· descartados:', r['descartados']); print(r['texto'][:120] + '…')"
paso "p5 verificar" python verificar.py prompt

# paso 6 · la prueba de permisos
paso "p6 diego" python pipeline/buscar.py --como diego.luna@marketplace.test "¿Cuánto gana un líder de soporte?"
paso "p6 lucia" python pipeline/buscar.py --como lucia.mora@marketplace.test "¿Cuánto gana un líder de soporte?"
paso "p6 verificar" python verificar.py fuga acceso

# paso 7 · el carril rápido y la mañana
usa revocar.py
paso "p7 nada" python pipeline/revocar.py
paso "p7 manana" python mundo/avanzar.py
paso "p7 bitacora" cat indice/revocaciones.jsonl
paso "p7 hugo" python pipeline/buscar.py --como hugo.salas@marketplace.test "Tarifas de envío por estado"
paso "p7 verificar" python verificar.py revocacion

# paso 8 · lo que el reindexado no puede deshacer
paso "p8 vigente" sh -c "python -c \"import json; [print(d, v) for d, v in json.load(open('indice/acl_vigente.json')).items()]\""
paso "p8 desde cero" python pipeline/indexar.py --desde-cero
paso "p8 fuga" python verificar.py fuga
paso "p8 carril" python pipeline/revocar.py
paso "p8 verificar" python verificar.py

# la ronda Construir solo arranca desde el esqueleto
paso "solo reiniciar" python mundo/reiniciar.py
paso "solo verificar" python verificar.py mundo principals
