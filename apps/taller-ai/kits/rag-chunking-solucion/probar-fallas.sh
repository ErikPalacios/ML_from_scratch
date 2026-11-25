#!/usr/bin/env bash
# Prueba las 4 fallas sobre la carpeta que dejó probar.sh: rehace el pipeline de la solución (probar.sh termina con
# el esqueleto de la ronda Construir solo), lo deja en verde con el día 2, y luego cada falla se mete con romper.py,
# se ve qué check la detecta, se cierra con su arreglo documentado y romper.py --verificar la da por buena.
# Al final, una con --restaurar. Deja cada salida real en <carpeta>-fallas.log.
# Uso: bash probar.sh /ruta/x && bash probar-fallas.sh /ruta/x
set -uo pipefail
SOL="$(cd "$(dirname "$0")" && pwd)"
D="$1"; LOG="$D-fallas.log"; : > "$LOG"
cd "$D"; source .venv/bin/activate
paso() { echo "### $1" >> "$LOG"; shift; { "$@" 2>&1; c=$?; [ $c -ne 0 ] && echo "[código $c]"; } | tee -a "$LOG"; echo >> "$LOG"; }
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
cp "$SOL"/pipeline/*.py pipeline/
python pipeline/chunkear.py > /dev/null; python pipeline/chunkear.py > /dev/null
python mundo/avanzar.py > /dev/null; python pipeline/chunkear.py > /dev/null; python pipeline/chunkear.py > /dev/null
paso "f0 sano" python verificar.py

# 1 · chunks gigantes
paso "gig romper" python romper.py --mostrar --falla chunks-gigantes
paso "gig verificar" python verificar.py tamano traslape
paso "gig arreglo" sh -c "$(declare -f cfg); cfg objetivo 1500 400 && python pipeline/chunkear.py"
paso "gig cerrar" python romper.py --verificar

# 2 · tabla cortada
paso "tab romper" python romper.py --mostrar --falla tabla-cortada
paso "tab verificar" python verificar.py ruta tablas
paso "tab ver" sh -c "python -c \"import json; d = json.load(open('chunks/docs/drive__d21.json')); [print(repr(c['texto'][:50]), '…', repr(c['texto'][-40:])) for c in d['chunks'][:3]]\""
paso "tab arreglo" sh -c "$(declare -f cfg); cfg estrategia fija estructura && python pipeline/chunkear.py"
paso "tab cerrar" python romper.py --verificar

# 3 · ACL perdida
paso "acl romper" python romper.py --mostrar --falla acl-perdida
paso "acl verificar" python verificar.py docs acl
paso "acl corrida" sh -c "python -c \"import json, glob; x = json.load(open(sorted(glob.glob('chunks/corridas/*.json'))[-1])); print('sin_acl:', x['sin_acl'])\""
paso "acl arreglo" sh -c "python mundo/crear.py --reingestar && python pipeline/chunkear.py"
paso "acl cerrar" python romper.py --verificar

# 4 · hash ignorado
paso "hash romper" python romper.py --mostrar --falla hash-ignorado
paso "hash verificar" python verificar.py incremental
paso "hash corrida" sh -c "python -c \"import json, glob; x = json.load(open(sorted(glob.glob('chunks/corridas/*.json'))[-1])); print(len(x['rechunkeados']), 'partidos ·', x['sin_cambios'], 'sin cambios')\""
paso "hash arreglo" sh -c "$(declare -f cfg); cfg incremental false true && python pipeline/chunkear.py"
paso "hash cerrar" python romper.py --verificar

# 5 · prefijo perdido
paso "pre romper" python romper.py --mostrar --falla prefijo-perdido
paso "pre verificar" python verificar.py tokens tamano
paso "pre arreglo" sh -c "$(declare -f cfg); cfg prefijo '\"\"' '\"passage: \"' && python pipeline/chunkear.py"
paso "pre cerrar" python romper.py --verificar

# 6 · texto truncado
paso "tru romper" python romper.py --mostrar --falla texto-truncado
paso "tru verificar" python verificar.py docs
paso "tru corrida" sh -c "python -c \"import json, glob; x = json.load(open(sorted(glob.glob('chunks/corridas/*.json'))[-1])); print('rechunkeados:', x['rechunkeados']); d = json.load(open('chunks/docs/drive__d20.json')); print(len(d['chunks']), 'chunks ·', [c['ruta'][-1] for c in d['chunks']])\""
paso "tru arreglo" sh -c "python mundo/crear.py --reingestar && python pipeline/chunkear.py"
paso "tru cerrar" python romper.py --verificar

# restaurar
paso "rest romper" python romper.py
paso "rest restaurar" python romper.py --restaurar
paso "rest sano" python verificar.py
