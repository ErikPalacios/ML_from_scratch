#!/usr/bin/env bash
# Prueba las 6 fallas sobre la carpeta que dejó probar.sh: vuelve a poner el pipeline de la solución (probar.sh
# termina con el esqueleto de la ronda Construir solo), arranca el LLM y la API y lo deja en verde; luego cada falla se
# mete con romper.py, se ve qué check la detecta, se cierra con su arreglo documentado y romper.py --verificar la da
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
cp "$SOL"/pipeline/*.py pipeline/
python mundo/servidor.py arrancar > /dev/null; python mundo/api.py arrancar > /dev/null
paso "f0 sano" python verificar.py

# 1 · validar las citas contra k
paso "k romper" python romper.py --mostrar --falla citas-contra-k
paso "k verificar" python verificar.py citas
paso "k arreglo" sh -c "$(declare -f cfg); cfg contra k contexto"
paso "k cerrar" python romper.py --verificar

# 2 · la cache sin la persona
paso "cache romper" python romper.py --mostrar --falla cache-sin-persona
paso "cache verificar" python verificar.py permisos
paso "cache arreglo" sh -c "$(declare -f cfg); cfg clave '[pregunta]' '[pregunta, persona]'"
paso "cache cerrar" python romper.py --verificar

# 3 · el límite de 200 ms
paso "lim romper" python romper.py --mostrar --falla limite-corto
paso "lim ver" python pipeline/preguntar.py --persona marco.diaz@marketplace.test "Un cliente quiere cancelar un pedido que ya salió: ¿qué le digo y cuándo le regresan el dinero?"
paso "lim verificar" python verificar.py stream
paso "lim arreglo" sh -c "$(declare -f cfg); cfg limite_s 0.2 30"
paso "lim cerrar" python romper.py --verificar

# 4 · la ventana repartida entre 8 slots
paso "ven romper" python romper.py --mostrar --falla ventana-repartida
paso "ven log" sh -c 'grep -E "n_ctx_slot" .taller/servidor.log | sed -E "s/^[0-9.]+ [A-Z] +//"'
paso "ven ver" python pipeline/preguntar.py --persona paula.vega@marketplace.test "¿Qué casos se escalan a líderes de soporte?"
paso "ven verificar" python verificar.py contexto
paso "ven arreglo" sh -c 'sed -i.bak "s/^PARALELO=8/PARALELO=1/" servidor.env && rm servidor.env.bak && python mundo/servidor.py arrancar'
paso "ven cerrar" python romper.py --verificar

# 5 · Drive sin revisar
paso "drv romper" python romper.py --mostrar --falla drive-sin-revisar
paso "drv ver" python pipeline/preguntar.py --persona tomas.rey@marketplace.test "Un cliente tiene un cobro duplicado, ¿qué le digo?"
paso "drv verificar" python verificar.py inyeccion
paso "drv arreglo" sh -c "$(declare -f cfg); cfg revisar_fuentes '[wiki, jira, politicas]' '[wiki, jira, drive, politicas]'"
paso "drv cerrar" python romper.py --verificar

# 6 · recuperar de más
paso "mas romper" python romper.py --mostrar --falla retrieval-de-mas
paso "mas verificar" python verificar.py ttft
paso "mas arreglo" sh -c "$(declare -f cfg); cfg candidatos 150 30 && cfg rerank_n 150 20 && cfg k 24 8"
paso "mas cerrar" python romper.py --verificar

# restaurar sin arreglar
paso "res romper" python romper.py --falla ventana-repartida
paso "res restaurar" python romper.py --restaurar
paso "fin" python verificar.py
python mundo/api.py parar > /dev/null; python mundo/servidor.py parar > /dev/null
