#!/usr/bin/env bash
# Prueba las 6 fallas sobre la carpeta que dejó probar.sh: rehace el pipeline de la solución (probar.sh termina con
# el esqueleto de la ronda Construir solo) y el reporte, lo deja en verde, y luego cada falla se mete con romper.py,
# se ve qué check la detecta y qué dice el reporte, se cierra con su arreglo documentado y romper.py --verificar la da
# por buena. Al final, una con --restaurar. Deja cada salida real en <carpeta>-fallas.log.
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
rep() { python -c "
import json; r = json.load(open('indices/c11-e5-2026-11-22/retrieval.json'))
print(f'reporte · {r[\"split\"]} · ' + ' · '.join(f'{m} {r[m][\"recall\"]:.1%} (n={r[m][\"n\"]}, recall@3 {r[m][\"recall@3\"]:.1%}, cortos {r[m][\"cortos\"]}, p50 {r[m][\"ms\"][\"p50\"]:.0f} ms)' for m in ('bm25', 'vectores', 'fusion', 'completo')))"; }
cp "$SOL"/pipeline/*.py pipeline/
python mundo/crear.py > /dev/null; python pipeline/medir.py > /dev/null
paso "f0 sano" python verificar.py
paso "f0 reporte" rep

# 1 · sumar los puntajes crudos
paso "sum romper" python romper.py --mostrar --falla fusion-suma
paso "sum reporte" rep
paso "sum verificar" python verificar.py fusion
paso "sum arreglo" sh -c "$(declare -f cfg); cfg fusion suma rrf && python pipeline/medir.py > /dev/null"
paso "sum cerrar" python romper.py --verificar

# 2 · cortar a 8 antes de fusionar
paso "cand romper" python romper.py --mostrar --falla candidatos-ocho
paso "cand reporte" rep
paso "cand verificar" python verificar.py candidatos rerank
paso "cand arreglo" sh -c "$(declare -f cfg); cfg candidatos 8 30 && python pipeline/medir.py > /dev/null"
paso "cand cerrar" python romper.py --verificar

# 3 · los permisos después del top-k
paso "fil romper" python romper.py --mostrar --falla filtro-despues
paso "fil reporte" rep
paso "fil verificar" python verificar.py permisos
paso "fil ver" python pipeline/recuperar.py --modo fusion --persona irene.sol@marketplace.test "¿En qué horario atiende soporte por teléfono?"
paso "fil arreglo" sh -c "$(declare -f cfg); cfg filtro despues antes && python pipeline/medir.py > /dev/null"
paso "fil cerrar" python romper.py --verificar

# 4 · el reranker con pocos candidatos
paso "pocos romper" python romper.py --mostrar --falla rerank-pocos
paso "pocos reporte" rep
paso "pocos verificar" python verificar.py rerank
paso "pocos arreglo" sh -c "$(declare -f cfg); cfg rerank_n 8 20 && python pipeline/medir.py > /dev/null"
paso "pocos cerrar" python romper.py --verificar

# 5 · medir el recall con las sin respuesta y las prohibidas mezcladas
paso "mez romper" python romper.py --mostrar --falla medicion-mezclada
paso "mez reporte" rep
paso "mez verificar" python verificar.py medicion reporte
paso "mez medir" python pipeline/medir.py
paso "mez arreglo" sh -c "$(declare -f cfg); cfg tipos '[directa, varias, sin_respuesta, prohibida]' '[directa, varias]' && python pipeline/medir.py > /dev/null"
paso "mez cerrar" python romper.py --verificar

# 6 · el reporte con el split de afinar
paso "split romper" python romper.py --mostrar --falla split-afinado
paso "split reporte" rep
paso "split verificar" python verificar.py medicion reporte
paso "split medir" python pipeline/medir.py
paso "split arreglo" sh -c "$(declare -f cfg); cfg split dev test && python pipeline/medir.py > /dev/null"
paso "split cerrar" python romper.py --verificar

# restaurar sin arreglar
paso "res romper" python romper.py --falla rerank-pocos
paso "res restaurar" python romper.py --restaurar
paso "fin" python verificar.py
