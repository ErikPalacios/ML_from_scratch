#!/usr/bin/env bash
# Prueba las 6 fallas sobre la carpeta que dejó probar.sh: rehace el pipeline de la solución (probar.sh termina con
# el esqueleto de la ronda Construir solo), lo deja en verde con la re-ingesta del 22 reanclada, y luego cada falla se
# mete con romper.py, se ve qué check la detecta, se cierra con su arreglo documentado y romper.py --verificar la da por
# buena. Al final, una con --restaurar. Deja cada salida real en <carpeta>-fallas.log.
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
cp "$SOL"/esquema/candidata.schema.json esquema/
python pipeline/armar.py > /dev/null; python mundo/avanzar.py > /dev/null; python pipeline/reanclar.py > /dev/null
paso "f0 sano" python verificar.py

# 1 · fuente que ya no existe tras re-ingestar
paso "fue romper" python romper.py --mostrar --falla fuente-perdida
paso "fue verificar" python verificar.py fuentes reanclaje
paso "fue evaluar" python mundo/evaluar.py
paso "fue arreglo" python pipeline/reanclar.py
paso "fue cerrar" python romper.py --verificar

# 2 · preguntas casi iguales
paso "dup romper" python romper.py --mostrar --falla casi-duplicadas
paso "dup verificar" python verificar.py parecidas
paso "dup pares" sh -c "python pipeline/parecidas.py golden/\$(cat golden/VIGENTE)/preguntas.jsonl --umbral 0.6"
paso "dup config" grep -n "umbral" config.yaml
paso "dup arreglo" sh -c "$(declare -f cfg); cfg umbral 0.95 0.6 && python pipeline/armar.py"
paso "dup cerrar" python romper.py --verificar

# 3 · sin preguntas sin respuesta
paso "sr romper" python romper.py --mostrar --falla sin-sin-respuesta
paso "sr verificar" python verificar.py cobertura
paso "sr manifiesto" python -c "
import json; v = open('golden/VIGENTE').read().strip(); m = json.load(open(f'golden/{v}/manifiesto.json'))
print(v, m['por_tipo'], m['config']['cuotas'], '· quitadas:', m['cambios']['quitadas'])"
paso "sr arreglo" sh -c "$(declare -f cfg); python mundo/crear.py --candidatos && cfg sin_respuesta 0.0 0.10 && python pipeline/armar.py"
paso "sr cerrar" python romper.py --verificar

# 4 · persona sin permiso a la que se le da por buena la respuesta
paso "dir romper" python romper.py --mostrar --falla directorio-viejo
paso "dir verificar" python verificar.py permisos reglas
paso "dir g039" sh -c "v=\$(cat golden/VIGENTE); grep '\"G-039\"' golden/\$v/preguntas.jsonl; python -c \"
import json; print('directorio de', json.load(open('almacen/directorio.json'))['foto'])\""
paso "dir arreglo" sh -c "python mundo/crear.py --directorio && python pipeline/armar.py"
paso "dir cerrar" python romper.py --verificar

# 5 · versión pisada
paso "pis romper" python romper.py --mostrar --falla version-pisada
paso "pis verificar" python verificar.py publicar
paso "pis comprobar" python pipeline/publicar.py --comprobar
paso "pis registro" python mundo/registro.py listar
paso "pis arreglo" sh -c "python mundo/registro.py bajar \$(cat golden/VIGENTE)"
paso "pis cerrar" python romper.py --verificar

# 6 · el golden contaminado por el afinado
paso "con romper" python romper.py --mostrar --falla contaminado
paso "con verificar" python verificar.py contaminacion
paso "con cli" python pipeline/contaminacion.py
paso "con arreglo" python pipeline/armar.py
paso "con cerrar" python romper.py --verificar

# restaurar
paso "rest romper" python romper.py
paso "rest restaurar" python romper.py --restaurar
paso "rest sano" python verificar.py
