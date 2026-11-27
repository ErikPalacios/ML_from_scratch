#!/usr/bin/env bash
# Prueba las 6 fallas sobre la carpeta que dejó probar.sh: vuelve a poner la solución y los resultados (probar.sh
# termina con el esqueleto de la ronda Construir solo), y cada falla se mete con romper.py, se ve qué check la
# detecta, se cierra con su arreglo documentado y romper.py --verificar la da por buena. Al final, una con --restaurar.
# Deja cada salida real en <carpeta>-fallas.log.     Uso: bash probar.sh /ruta/x && bash probar-fallas.sh /ruta/x
set -uo pipefail
SOL="$(cd "$(dirname "$0")" && pwd)"
D="$1"; LOG="$D-fallas.log"; : > "$LOG"
cd "$D"
paso() { echo "### $1" >> "$LOG"; shift; { "$@" 2>&1; c=$?; [ $c -ne 0 ] && echo "[código $c]"; } | tee -a "$LOG"; echo >> "$LOG"; }
med() { python3 - "$@" <<'Y'
import json, sys
seccion, clave, valor = sys.argv[1:]
m = json.load(open("medicion.json"))
m[seccion][clave] = json.loads(valor)
open("medicion.json", "w").write(json.dumps(m, ensure_ascii=False, indent=2) + "\n")
print(f"medicion.json: {seccion}.{clave} = {valor}")
Y
}
cp "$SOL"/pipeline/*.py pipeline/
python3 pipeline/cuantizar.py > /dev/null && python3 pipeline/medir.py > /dev/null && python3 pipeline/calidad.py > /dev/null && python3 pipeline/reporte.py > /dev/null
paso "f0 sano" python3 verificar.py

# 1 · el prompt largo cambió a medias
paso "pro romper" python3 romper.py --mostrar --falla prompts-a-medias
paso "pro verificar" python3 verificar.py comparable
paso "pro reporte" cat resultados/reporte.md
paso "pro arreglo" sh -c "$(declare -f med); med velocidad prompts '\"mundo/entrada/prompts.json\"' && python3 pipeline/medir.py && python3 pipeline/reporte.py > /dev/null"
paso "pro cerrar" python3 romper.py --verificar

# 2 · el cache del prompt
paso "cac romper" python3 romper.py --mostrar --falla cache-prompt
paso "cac verificar" python3 verificar.py comparable
paso "cac muestras" python3 -c "
import json; x = json.load(open('resultados/velocidad.json'))['cuantizaciones']['Q4_K_M']['muestras']['largo']
print(' · '.join(f'TTFT {s[\"ttft_ms\"]:.0f} ms, leyó {s[\"prompt_n\"]:,} tokens' for s in x))"
paso "cac arreglo" sh -c "$(declare -f med); med velocidad cache_prompt false && python3 pipeline/medir.py && python3 pipeline/reporte.py > /dev/null"
paso "cac cerrar" python3 romper.py --verificar

# 3 · tokens por segundo con la lectura del prompt adentro
paso "tot romper" python3 romper.py --mostrar --falla metrica-total
paso "tot verificar" python3 verificar.py velocidad
paso "tot arreglo" sh -c "$(declare -f med); med velocidad metrica '\"decode\"' && python3 pipeline/medir.py && python3 pipeline/reporte.py > /dev/null"
paso "tot cerrar" python3 romper.py --verificar

# 4 · cada una contesta del largo que quiere
paso "lar romper" python3 romper.py --mostrar --falla largo-libre
paso "lar verificar" python3 verificar.py comparable
paso "lar tokens" python3 -c "
import json; v = json.load(open('resultados/velocidad.json'))['cuantizaciones']
for t, x in v.items(): print(t, 'corto:', [s['tokens'] for s in x['muestras']['corto']], 'tokens ·', x['mediana']['corto']['decode_tps'], 'tokens/s')"
paso "lar arreglo" sh -c "$(declare -f med); med velocidad largo_fijo true && python3 pipeline/medir.py && python3 pipeline/reporte.py > /dev/null"
paso "lar cerrar" python3 romper.py --verificar

# 5 · el examen con azar
paso "aza romper" python3 romper.py --mostrar --falla examen-al-azar
paso "aza verificar" python3 verificar.py calidad
paso "aza arreglo" sh -c "$(declare -f med); med calidad temperatura 0 && med calidad semilla 7 && python3 pipeline/calidad.py && python3 pipeline/reporte.py > /dev/null"
paso "aza cerrar" python3 romper.py --verificar

# 6 · un Q4_0 con el nombre de Q4_K_M
paso "arc romper" python3 romper.py --mostrar --falla archivo-equivocado
paso "arc verificar" python3 verificar.py cuantizar calidad reporte
paso "arc ficha" python3 mundo/ficha.py cuantizados/Qwen3-0.6B-Q4_K_M.gguf --tipos
paso "arc reporte" cat resultados/reporte.md
paso "arc sin todas" python3 pipeline/cuantizar.py
paso "arc arreglo" sh -c "python3 pipeline/cuantizar.py --todas && python3 pipeline/medir.py Q4_K_M && python3 pipeline/calidad.py Q4_K_M && python3 pipeline/reporte.py > /dev/null"
paso "arc cerrar" python3 romper.py --verificar

# restaurar
paso "rest romper" python3 romper.py
paso "rest restaurar" python3 romper.py --restaurar
paso "rest sano" python3 verificar.py
