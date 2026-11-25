#!/usr/bin/env bash
# Prueba las 6 fallas sobre la carpeta que dejó probar.sh (todo en verde): cada una se mete con romper.py, se ve qué
# check la detecta, se cierra con su arreglo documentado y romper.py --verificar la da por buena. Al final, una con
# --restaurar. Deja cada salida real en <carpeta>-fallas.log.
# Uso: bash probar.sh /ruta/x && bash probar-fallas.sh /ruta/x
set -uo pipefail
D="$1"; LOG="$D-fallas.log"; : > "$LOG"
cd "$D"; source .venv/bin/activate
paso() { echo "### $1" >> "$LOG"; shift; { "$@" 2>&1; c=$?; [ $c -ne 0 ] && echo "[código $c]"; } | tee -a "$LOG"; echo >> "$LOG"; }
python mundo/fuentes.py arrancar >/dev/null
cfg() { python - "$@" <<'P'
import re, sys
clave, viejo, nuevo = sys.argv[1:]
s = open("config.yaml").read()
s2 = re.sub(rf"({clave}:\s*){re.escape(viejo)}", lambda m: m.group(1) + nuevo, s, count=1)
assert s2 != s, (clave, viejo)
open("config.yaml", "w").write(s2)
print(f"config.yaml: {clave}: {viejo} → {nuevo}")
P
}

paso "f0 sano" python verificar.py

# 1 · token vencido
paso "token romper" python romper.py --mostrar --falla token-vencido
paso "token verificar" python verificar.py mundo catalogo
paso "token corrida" sh -c 'python -c "import json,glob; c=json.load(open(sorted(glob.glob(\"almacen/corridas/*.json\"))[-1])); print(json.dumps(c[\"fuentes\"][\"wiki\"], ensure_ascii=False))"'
paso "token log" sh -c 'sleep 1.2; python mundo/fuentes.py log | tail -3'
paso "token nuevo" python mundo/fuentes.py token wiki
paso "token arreglo" sh -c "$(declare -f cfg); cfg token wiki-dojo-7f3a \$(python mundo/fuentes.py token wiki) && python pipeline/ingestar.py --fuente wiki"
paso "token cerrar" python romper.py --verificar

# 2 · sin reintentos
paso "reintentos romper" python romper.py --mostrar --falla sin-reintentos
paso "reintentos verificar" python verificar.py http catalogo
paso "reintentos job" sh -c 'python pipeline/ingestar.py 2>&1 | tail -4'
paso "reintentos arreglo" sh -c "$(declare -f cfg); cfg reintentos 0 5 && python pipeline/ingestar.py"
paso "reintentos cerrar" python romper.py --verificar

# 3 · restricción silenciosa
paso "restriccion romper" python romper.py --mostrar --falla restriccion-silenciosa
paso "restriccion verificar" python verificar.py catalogo
paso "restriccion 404" python -c "
import sys; sys.path.insert(0, 'pipeline')
from conectores.http import pedir
print(pedir('wiki', '/paginas/3005'))"
paso "restriccion arreglo" python pipeline/ingestar.py --barrido
paso "restriccion cerrar" python romper.py --verificar

# 4 · link compartido como dominio
paso "link romper" python romper.py --mostrar --falla link-como-dominio
paso "link verificar" python verificar.py catalogo
paso "link arreglo" sh -c "$(declare -f cfg); cfg link_compartido dominio ignorar && python pipeline/ingestar.py --barrido"
paso "link cerrar" python romper.py --verificar

# 5 · texto alterado en el almacén
paso "texto romper" python romper.py --mostrar --falla texto-alterado
paso "texto verificar" python verificar.py almacen
paso "texto arreglo" python pipeline/ingestar.py --doc wiki:2002
paso "texto cerrar" python romper.py --verificar

# 6 · la cuenta del conector fuera de la unidad compartida
paso "unidad romper" python romper.py --mostrar --falla unidad-perdida
paso "unidad verificar" python verificar.py catalogo barrido
paso "unidad arreglo" sh -c 'python mundo/fuentes.py unidad on && python pipeline/ingestar.py --barrido'
paso "unidad cerrar" python romper.py --verificar

# --restaurar deja todo sano
paso "restaurar romper" python romper.py --falla link-como-dominio
paso "restaurar" python romper.py --restaurar
paso "final" python verificar.py
python mundo/fuentes.py parar >/dev/null
echo "listo: $LOG"
