#!/usr/bin/env bash
# Prueba cada falla de romper.py sobre la carpeta que dejó probar.sh (con la solución puesta otra vez), y deja cada
# salida real en <carpeta>-fallas.log: la historia, lo que dice verificar.py, el comando que la confirma y el cierre.
# Uso: bash probar-fallas.sh <carpeta de probar.sh>     (≈ 10 min: tasa-infinita vuelve a correr la abierta)
set -uo pipefail
SOL="$(cd "$(dirname "$0")" && pwd)"
D="$1"; LOG="$D-fallas.log"
: > "$LOG"
paso() { echo "### $1" >> "$LOG"; shift; { "$@" 2>&1; c=$?; [ $c -ne 0 ] && echo "[código $c]"; } | tee -a "$LOG"; echo >> "$LOG"; }
cd "$D"
# probar.sh terminó con el esqueleto (reiniciar.py): la solución de vuelta, y sus resultados del respaldo
for f in servidor.env servir.sh carga.env gpu.env pipeline/carga.py pipeline/reporte.py; do cp "$SOL/$f" "$f"; done
cp -R "$(ls -d .respaldo/tuyo-* | tail -1)/resultados" resultados
python3 mundo/servidor.py arrancar
paso "sano" python3 verificar.py

K='-H "Authorization: Bearer dojo-vllm-5c1e9a"'
confirma() {   # el comando que confirma cada falla (el mismo que trae su página)
  case "$1" in
    tope-dos) sh -c 'grep -n "max-num-seqs" servir.sh; grep -E "non-default" .taller/servidor.log | sed -E "s/^.*non-default args: //"' ;;
    memoria-recortada) sh -c 'grep -E "KV cache" .taller/servidor.log | sed -E "s/^\((APIServer|EngineCore_DP0) pid=[0-9]+\) //; s/ [0-9]{2}-[0-9]{2} [0-9:]{8} / /"' ;;
    sin-clave) curl -s -w "\n[HTTP %{http_code}]" http://127.0.0.1:8000/v1/models ;;
    razonamiento-prendido) sh -c 'curl -s http://127.0.0.1:8000/v1/chat/completions -H "Authorization: Bearer dojo-vllm-5c1e9a" -H "Content-Type: application/json" -d "{\"model\": \"qwen3-32b\", \"messages\": [{\"role\": \"user\", \"content\": \"¿Qué es una pena convencional?\"}], \"max_tokens\": 40}" | python3 -c "import json, sys; d = json.load(sys.stdin); m = d[\"choices\"][0][\"message\"]; print(\"reasoning:\", (m[\"reasoning\"] or \"\")[:90], \"…\"); print(\"content:\", m[\"content\"]); print(\"finish_reason:\", d[\"choices\"][0][\"finish_reason\"], \"· usage:\", d[\"usage\"])"' ;;
    nombre-servido) sh -c 'curl -s -H "Authorization: Bearer dojo-vllm-5c1e9a" http://127.0.0.1:8000/v1/models | python3 -c "import json, sys; print([m[\"id\"] for m in json.load(sys.stdin)[\"data\"]])"; grep NOMBRE servidor.env' ;;
    tasa-infinita) sh -c 'grep TASA carga.env; python3 -c "import json; d = json.load(open(\"resultados/abierta.json\")); ms = d[\"medidas\"]; print(\"tasa:\", d[\"meta\"][\"tasa\"], \"· la última salió a los\", round(max(m[\"programada\"] for m in ms), 2), \"s · TTFT de la más lenta:\", round(max(m[\"ttft_s\"] for m in ms), 1), \"s · en fila hasta\", d[\"metricas\"][\"pico_waiting\"])"' ;;
  esac
}

for f in tope-dos memoria-recortada sin-clave razonamiento-prendido nombre-servido tasa-infinita; do
  paso "$f romper" python3 romper.py --mostrar --falla "$f"
  paso "$f verificar" python3 verificar.py
  paso "$f confirma" confirma "$f"
  paso "$f revelar" python3 romper.py --revelar
done
paso "final" python3 verificar.py
python3 mundo/servidor.py parar
