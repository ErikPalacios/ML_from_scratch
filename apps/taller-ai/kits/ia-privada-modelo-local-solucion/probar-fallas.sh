#!/usr/bin/env bash
# Prueba las 6 fallas sobre la carpeta que dejó probar.sh: vuelve a poner la solución (probar.sh termina con el
# esqueleto de la ronda Construir solo), arranca el servidor, y cada falla se mete con romper.py, se ve qué check la
# detecta, se cierra con su arreglo documentado y romper.py --verificar la da por buena. Al final, una con --restaurar.
# Deja cada salida real en <carpeta>-fallas.log.     Uso: bash probar.sh /ruta/x && bash probar-fallas.sh /ruta/x
set -uo pipefail
SOL="$(cd "$(dirname "$0")" && pwd)"
D="$1"; LOG="$D-fallas.log"; : > "$LOG"
cd "$D"
paso() { echo "### $1" >> "$LOG"; shift; { "$@" 2>&1; c=$?; [ $c -ne 0 ] && echo "[código $c]"; } | tee -a "$LOG"; echo >> "$LOG"; }
env_() { python3 -c "import sys; sys.path.insert(0, '.'); from mundo.comun import editar_env; editar_env('$1', '$2'); print('servidor.env: $1=$2')"; }
servir() { python3 - "$@" <<'Y'
import re, sys
viejo, nuevo = sys.argv[1:]
s = open("servir.sh").read()
s2 = s.replace(viejo, nuevo, 1) if viejo else s.rstrip("\n") + " " + nuevo + "\n"
assert s2 != s, viejo
open("servir.sh", "w").write(s2)
print(f"servir.sh: «{viejo or '(al final)'}» → «{nuevo}»")
Y
}
cp "$SOL/servidor.env" "$SOL/servir.sh" .; cp "$SOL"/pipeline/*.py pipeline/
python3 mundo/servidor.py arrancar > /dev/null
paso "f0 sano" python3 verificar.py

# 1 · el servidor se movió de puerto y el cliente no
paso "pue romper" python3 romper.py --mostrar --falla puerto-movido
paso "pue verificar" python3 verificar.py config cliente
paso "pue preguntar" python3 pipeline/preguntar.py "¿Sigues ahí?"
paso "pue arreglo" sh -c "$(declare -f env_); env_ PUERTO 9931 && python3 mundo/servidor.py arrancar"
paso "pue cerrar" python3 romper.py --verificar

# 2 · el servidor abierto a la red
paso "exp romper" python3 romper.py --mostrar --falla expuesto
paso "exp verificar" python3 verificar.py config
paso "exp lsof" sh -c 'lsof -nP -iTCP:9931 -sTCP:LISTEN | awk "NR==1 || /LISTEN/ {print \$1, \$8, \$9, \$10}"'
paso "exp arreglo" sh -c "$(declare -f env_); env_ HOST 127.0.0.1 && python3 mundo/servidor.py arrancar"
paso "exp lsof bien" sh -c 'lsof -nP -iTCP:9931 -sTCP:LISTEN | awk "NR==1 || /LISTEN/ {print \$1, \$8, \$9, \$10}"'
paso "exp cerrar" python3 romper.py --verificar

# 3 · 4 a la vez reparte el contexto
paso "par romper" python3 romper.py --mostrar --falla paralelo-reparte
paso "par verificar" python3 verificar.py servidor contexto
paso "par log" sh -c 'grep -E "n_ctx_slot|llama_kv_cache: size" .taller/servidor.log | sed -E "s/^[0-9.]+ [A-Z] //"'
paso "par despacho" python3 -c "
import sys; sys.path.insert(0, 'pipeline')
from llm import Cliente, ContextoExcedido
try:
    r = Cliente().chat([{'role': 'user', 'content': 'cláusula ' * 1500}], max_tokens=5); print('cupo:', r.tokens_prompt)
except ContextoExcedido as e:
    print(f'el prompt del despacho ({e.n_prompt:,} tokens) no cabe en {e.n_ctx:,}')"
paso "par arreglo" sh -c "$(declare -f env_); env_ PARALELO 1 && python3 mundo/servidor.py arrancar"
paso "par cerrar" python3 romper.py --verificar

# 4 · sin --api-key
paso "cla romper" python3 romper.py --mostrar --falla sin-clave
paso "cla verificar" python3 verificar.py clave cliente
paso "cla curl" curl -s -w "\n[HTTP %{http_code}]" http://127.0.0.1:9931/v1/models
paso "cla servir" cat servir.sh
paso "cla log" sh -c 'grep -E "security" .taller/servidor.log | sed -E "s/^[0-9.]+ [A-Z] +//"'
paso "cla arreglo" sh -c "$(declare -f servir); servir '' '--api-key \"\$CLAVE\"' && python3 mundo/servidor.py arrancar"
paso "cla cerrar" python3 romper.py --verificar

# 5 · sin --reasoning: vuelve a razonar
paso "raz romper" python3 romper.py --mostrar --falla razonamiento-auto
paso "raz verificar" python3 verificar.py plantilla
CUERPO='{"model": "qwen3-0.6b", "messages": [{"role": "system", "content": "Contesta en una frase."}, {"role": "user", "content": "¿Qué es un contrato de arrendamiento?"}], "temperature": 0, "seed": 7, "max_tokens": 120}'
paso "raz crudo" curl -s http://127.0.0.1:9931/v1/chat/completions -H "Authorization: Bearer dojo-local-7f3a" -H "Content-Type: application/json" -d "$CUERPO"
paso "raz arreglo" sh -c "$(declare -f servir); servir '' '--reasoning \"\$RAZONAMIENTO\"' && python3 mundo/servidor.py arrancar"
paso "raz cerrar" python3 romper.py --verificar

# 6 · la plantilla de chat de otro modelo
paso "pla romper" python3 romper.py --mostrar --falla plantilla-ajena
paso "pla verificar" python3 verificar.py plantilla
paso "pla preguntar" python3 pipeline/preguntar.py --max 60 "¿Qué es una pena convencional en un contrato?"
paso "pla props" sh -c 'curl -s -H "Authorization: Bearer dojo-local-7f3a" http://127.0.0.1:9931/props | python3 -c "import json, sys; print(json.load(sys.stdin)[\"chat_template\"][:160].replace(chr(10), \" \"))"'
paso "pla arreglo" sh -c "$(declare -f servir); servir ' --chat-template llama3' '' && python3 mundo/servidor.py arrancar"
paso "pla cerrar" python3 romper.py --verificar

# restaurar
paso "rest romper" python3 romper.py
paso "rest restaurar" python3 romper.py --restaurar
paso "rest sano" python3 verificar.py
python3 mundo/servidor.py parar > /dev/null
