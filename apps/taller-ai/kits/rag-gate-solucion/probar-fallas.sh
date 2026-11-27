#!/usr/bin/env bash
# Prueba las 6 fallas sobre la carpeta que dejó probar.sh: vuelve a poner el pipeline de la solución (probar.sh termina
# con el esqueleto de la ronda Construir solo), arranca los servidores y la API, rehace la base (correr, calibrar,
# juzgar, promover) y lo deja en verde; luego cada falla se mete con romper.py, se ve qué check la detecta (y, en
# algunas, qué hace con un cambio de verdad), se cierra con su arreglo documentado y romper.py --verificar la da por
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
python mundo/servidor.py arrancar > /dev/null; python mundo/api.py arrancar > /dev/null
python pipeline/correr.py base > /dev/null && python pipeline/juez.py calibrar > /dev/null && python pipeline/juez.py base > /dev/null && python pipeline/gate.py promover base > /dev/null
paso "f0 sano" python verificar.py --rapido

# 1 · el examen con la cache de la API
paso "cache romper" python romper.py --mostrar --falla examen-con-cache
paso "cache verificar" python verificar.py correr
paso "cache k2" sh -c 'python pipeline/correr.py base-otra-vez > /dev/null && python mundo/propuesta.py k-2 > /dev/null && python pipeline/gate.py examen k2-con-cache; python mundo/propuesta.py quitar > /dev/null'
paso "cache arreglo" sh -c "$(declare -f cfg); cfg sin_cache false true"
paso "cache cerrar" python romper.py --verificar

# 2 · dev dentro del examen
paso "dev romper" python romper.py --mostrar --falla examen-con-dev
paso "dev verificar" python verificar.py correr
paso "dev arreglo" sh -c "$(declare -f cfg); cfg split todas test"
paso "dev cerrar" python romper.py --verificar

# 3 · el juez es el LLM de la API
paso "juez romper" python romper.py --mostrar --falla juez-es-la-api
paso "juez verificar" python verificar.py juez
paso "juez calibrar" python pipeline/juez.py calibrar
paso "juez arreglo" sh -c "$(declare -f cfg); cfg url http://127.0.0.1:9931/v1 http://127.0.0.1:9933/v1 && python mundo/servidor.py arrancar juez && python pipeline/juez.py calibrar"
paso "juez cerrar" python romper.py --verificar

# 4 · el margen aflojado
paso "mar romper" python romper.py --mostrar --falla margen-ancho
paso "mar verificar" python verificar.py estadistica
paso "mar umbral" sh -c 'python mundo/propuesta.py umbral-bajo > /dev/null && python pipeline/gate.py examen umbral-flojo; python mundo/propuesta.py quitar > /dev/null'
paso "mar arreglo" sh -c "$(declare -f cfg); cfg margen 0.5 0.10 && cfg caida_max 0.5 0.03"
paso "mar cerrar" python romper.py --verificar

# 5 · sin parear
paso "par romper" python romper.py --mostrar --falla sin-parear
paso "par verificar" python verificar.py estadistica
paso "par hoy" python pipeline/gate.py examen hoy-sin-parear
paso "par arreglo" sh -c "$(declare -f cfg); cfg pareado false true"
paso "par cerrar" python romper.py --verificar

# 6 · contra la última corrida
paso "ult romper" python romper.py --mostrar --falla contra-la-ultima
paso "ult verificar" python verificar.py promover
paso "ult arreglo" sh -c "$(declare -f cfg); cfg base ultima vigente"
paso "ult cerrar" python romper.py --verificar

# restaurar sin arreglar
paso "res romper" python romper.py --falla juez-es-la-api
paso "res restaurar" python romper.py --restaurar
paso "fin" python verificar.py --rapido
python mundo/api.py parar > /dev/null; python mundo/servidor.py parar > /dev/null
