#!/usr/bin/env bash
# Prueba las 6 fallas sobre la carpeta que dejó probar.sh: rehace el pipeline de la solución (probar.sh termina con
# el esqueleto de la ronda Construir solo), lo deja en verde con c11 en el índice de e5, y luego cada falla se mete con
# romper.py, se ve qué check la detecta, se cierra con su arreglo documentado y romper.py --verificar la da por buena.
# La API (mundo/servicio.py) corre todo el tiempo. Al final, una con --restaurar. Deja cada salida real en <carpeta>-fallas.log.
# Uso: bash probar.sh /ruta/x && bash probar-fallas.sh /ruta/x
set -uo pipefail
SOL="$(cd "$(dirname "$0")" && pwd)"
D="$1"; LOG="$D-fallas.log"; : > "$LOG"
cd "$D"; source .venv/bin/activate
paso() { echo "### $1" >> "$LOG"; shift; { "$@" 2>&1; c=$?; [ $c -ne 0 ] && echo "[código $c]"; } | tee -a "$LOG"; echo >> "$LOG"; }
espera() { python -c "import time; time.sleep($1)"; }
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
vig() { python -c "import json; print(json.load(open('indices/alias.json'))['c11']['actual'])"; }
cp "$SOL"/pipeline/*.py pipeline/
python mundo/crear.py > /dev/null; python pipeline/prueba.py --indice c11-minilm-2026-11-22 > /dev/null; python mundo/noche.py > /dev/null
python mundo/servicio.py > servicio-fallas.log 2>&1 & SP=$!
espera 3
paso "f0 sano" python verificar.py
paso "f0 salud" curl -s http://localhost:8150/salud

# 1 · embeddings de dos modelos en el mismo índice
paso "mez romper" python romper.py --mostrar --falla modelos-mezclados
paso "mez verificar" python verificar.py construir
paso "mez revisar" sh -c 'python pipeline/construir.py --revisar $(python -c "import json; print(json.load(open(\"indices/alias.json\"))[\"c11\"][\"actual\"])")'
paso "mez salud" curl -s http://localhost:8150/salud
paso "mez monitor" python mundo/evaluar.py
paso "mez arreglo" sh -c "python pipeline/alias.py volver c11 && python mundo/noche.py"
paso "mez cerrar" python romper.py --verificar

# 2 · vectores sin normalizar con similitud coseno
paso "nor romper" python romper.py --mostrar --falla sin-normalizar
paso "nor verificar" python verificar.py vectores
paso "nor normas" python -c "
import json, numpy as np; v = json.load(open('indices/alias.json'))['c11']['actual']; n = np.linalg.norm(np.load(f'indices/{v}/vectores.npy'), axis=1)
print(f'{v}: largo de los vectores de {n.min():.2f} a {n.max():.2f} (tendría que ser 1.00)')"
paso "nor monitor" python mundo/evaluar.py
paso "nor arreglo" sh -c "python pipeline/alias.py volver c11 && python mundo/noche.py"
paso "nor cerrar" python romper.py --verificar

# 3 · chunks que faltan en uno de los dos índices
paso "fal romper" python romper.py --mostrar --falla chunks-faltantes
paso "fal verificar" python verificar.py completo
paso "fal revisar" sh -c 'python pipeline/construir.py --revisar $(python -c "import json; print(json.load(open(\"indices/alias.json\"))[\"c11\"][\"actual\"])")'
paso "fal monitor" python mundo/evaluar.py
paso "fal arreglo" sh -c "python pipeline/alias.py volver c11 && python mundo/noche.py"
paso "fal cerrar" python romper.py --verificar

# 4 · dimensión equivocada
paso "dim romper" python romper.py --mostrar --falla dimension-equivocada
paso "dim verificar" python verificar.py construir
paso "dim noche" python mundo/noche.py
paso "dim config" grep -n "dimension" config.yaml
paso "dim arreglo" sh -c "$(declare -f cfg); cfg dimension 768 384 && python mundo/noche.py"
paso "dim cerrar" python romper.py --verificar

# 5 · la consulta embebida con otro modelo
paso "con romper" python romper.py --mostrar --falla consulta-otro-modelo
paso "con verificar" python verificar.py consulta
espera 1
paso "con salud" curl -s http://localhost:8150/salud
paso "con buscar" curl -s "http://localhost:8150/buscar?persona=elena.cruz@marketplace.test&q=plazo+para+devolver"
paso "con monitor" python mundo/evaluar.py
paso "con arreglo" sh -c "$(declare -f cfg); cfg modelo_consulta minilm del-indice"
espera 1
paso "con salud bien" curl -s http://localhost:8150/salud
paso "con cerrar" python romper.py --verificar

# 6 · el alias apuntando a un índice a medio construir
paso "med romper" python romper.py --mostrar --falla alias-a-medio
paso "med verificar" python verificar.py alias
paso "med listar" python pipeline/alias.py listar
paso "med salud" curl -s http://localhost:8150/salud
paso "med archivos" sh -c 'ls indices/$(python -c "import json; print(json.load(open(\"indices/alias.json\"))[\"c11\"][\"actual\"])")/'
paso "med arreglo" sh -c 'm=$(python -c "import json; print(json.load(open(\"indices/alias.json\"))[\"c11\"][\"actual\"])"); python pipeline/alias.py volver c11 && rm -rf indices/$m && python mundo/noche.py'
paso "med salud bien" curl -s http://localhost:8150/salud
paso "med cerrar" python romper.py --verificar

# restaurar
paso "rest romper" python romper.py
paso "rest restaurar" python romper.py --restaurar
paso "rest sano" python verificar.py
kill $SP 2>/dev/null; wait $SP 2>/dev/null
paso "servicio" cat servicio-fallas.log
