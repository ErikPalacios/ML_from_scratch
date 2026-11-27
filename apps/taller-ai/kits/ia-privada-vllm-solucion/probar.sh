#!/usr/bin/env bash
# Corre el Guiado de la estación 3 de IA Privada en una carpeta limpia, como lo haría una persona, con los archivos de
# esta solución, y deja cada salida real en <carpeta>.log. Es el kit recién descomprimido: el esqueleto en su lugar.
# Uso: bash probar.sh <carpeta-vacía>     (en la Mac, con el vLLM del dojo: ≈ 15 min, casi todo la carga abierta)
# El paso 6 (la GPU rentada) no se corre aquí: necesita un pod. Aquí solo su plan y su receta.
set -uo pipefail
SOL="$(cd "$(dirname "$0")" && pwd)"
KIT="$SOL/../ia-privada-vllm"
D="$1"; LOG="$D.log"
rm -rf "$D"; mkdir -p "$D"; : > "$LOG"
paso() { echo "### $1" >> "$LOG"; shift; { "$@" 2>&1; c=$?; [ $c -ne 0 ] && echo "[código $c]"; } | tee -a "$LOG"; echo >> "$LOG"; }
usa() { mkdir -p "$(dirname "$1")"; cp "$SOL/$1" "$1"; }

(cd "$KIT" && tar --exclude .taller --exclude __pycache__ --exclude resultados --exclude .respaldo -cf - .) | (cd "$D" && tar -xf -)
(cd "$KIT/mundo/esqueleto" && tar -cf - .) | (cd "$D" && tar -xf -)
cd "$D"

# paso 0 · el mundo
paso "p0 version" python3 --version
paso "p0 verificar" python3 verificar.py mundo
paso "p0 esqueleto" python3 verificar.py config
paso "p0 dataset" python3 mundo/dataset.py 40

# precálculos (las cuentas, con los números de mundo/*.json y de la ficha del despacho escritos en cada comando)
paso "pc memoria" python3 -c "
import json
m = json.load(open('mundo/modelos.json'))['Qwen/Qwen3-32B-AWQ']; g = json.load(open('mundo/gpus.json'))['gpus']['l40s']
kv = 2 * m['capas'] * m['cabezas_kv'] * m['dim_cabeza'] * m['bytes_kv']          # K y V · capas · cabezas KV · dimensión · 2 bytes
libre = g['vram_gib'] - m['bytes_pesos'] / 2**30 - 2                              # memoria que ve el programa − pesos − ≈ 2 GiB del programa
tokens = int(libre * 2**30 // (kv * 16)) * 16                                     # en bloques de 16 tokens
print(f'KV por token: 2 × {m[\"capas\"]} × {m[\"cabezas_kv\"]} × {m[\"dim_cabeza\"]} × 2 = {kv:,} B ({kv // 1024} KiB)')
print(f'L40S: {g[\"vram_gib\"]} GiB − {m[\"bytes_pesos\"] / 2**30:.2f} de pesos − 2 del programa = {libre:.2f} GiB de KV cache = {tokens:,} tokens')
print(f'  al tope de 8,192: {tokens / 8192:.1f} conversaciones · de ≈ 6,500 (las típicas): {tokens / 6500:.1f} · las 8 de diseño piden 8 × 6,500 = 52,000')"
paso "pc decode" python3 -c "
pesos, kv, bw = 19.32e9, 262144, 0.7 * 864e9                                       # bytes de pesos · KV por token · 0.7 del ancho de banda de la L40S
for n in (1, 2, 8):
    t = (pesos + n * 6500 * kv) / bw                                                 # cada paso lee los pesos y el KV de las n conversaciones
    print(f'{n} a la vez: ({pesos / 1e9:.2f} GB + {n} × 6,500 × 256 KiB = {n * 6500 * kv / 1e9:.2f} GB) ÷ {bw / 1e9:.1f} GB/s = {t * 1000:.1f} ms por token → {1 / t:.1f} tokens/s cada una')
pre = 2 * 32.76e9 * 2048 / (0.5 * 362.05e12)
print(f'y un paso que además lee 2,048 tokens de un prompt: 2 × 32.76 mil millones × 2,048 ÷ (0.5 × 362 TFLOPS) = {pre * 1000:.0f} ms: ese token sale {pre / t:.0f} veces más lento')"
paso "pc little" python3 -c "
import math
for quien, tasa in (('despacho, 3 copias', 0.21), ('una copia (el dojo)', 0.07)):
    L = tasa * 27                                                                    # ley de Little: llegadas por segundo × segundos que dura cada una
    p8 = 1 - sum(math.exp(-L) * L**k / math.factorial(k) for k in range(8))          # Poisson: probabilidad de 8 o más a la vez
    print(f'{quien}: {tasa}/s × 27 s = {L:.2f} a la vez en promedio · 8 o más a la vez: {p8:.2%} del tiempo')"
paso "pc intervalo" python3 -c "
import math
for n in (40, 200, 1000):
    d = 1.96 * math.sqrt(n * 0.95 * 0.05)
    lo, hi = math.floor(n * 0.95 - d), math.ceil(n * 0.95 + d)
    print(f'{n:>5} peticiones: el p95 verdadero está entre la {max(1, lo)}.ª y la {min(n, hi)}.ª más lenta (p{100 * max(1, lo) / n:.1f}–p{100 * min(n, hi) / n:.1f})' + ('' if hi <= n else ': sin techo, la más lenta es lo más que sabes'))"

# paso 1 · servidor.env
usa servidor.env
paso "p1 verificar" python3 verificar.py config

# paso 2 · servir.sh
usa servir.sh
paso "p2 verificar config" python3 verificar.py config
paso "p2 arrancar" python3 mundo/servidor.py arrancar
paso "p2 log" sh -c 'grep -E "SIMULADO|non-default|Chunked|Model loading|KV cache|Starting|startup" .taller/servidor.log | sed -E "s/^\((APIServer|EngineCore_DP0) pid=[0-9]+\) //; s/ [0-9]{2}-[0-9]{2} [0-9:]{8} / /"'
paso "p2 health" curl -s -w "[HTTP %{http_code}]" http://127.0.0.1:8000/health
paso "p2 sin clave" curl -s -w "\n[HTTP %{http_code}]" http://127.0.0.1:8000/v1/models
paso "p2 modelos" sh -c 'curl -s -H "Authorization: Bearer dojo-vllm-5c1e9a" http://127.0.0.1:8000/v1/models | python3 -m json.tool | grep -vE "created"'
paso "p2 stream" sh -c 'curl -sN http://127.0.0.1:8000/v1/chat/completions -H "Authorization: Bearer dojo-vllm-5c1e9a" -H "Content-Type: application/json" -d "{\"model\": \"qwen3-32b\", \"messages\": [{\"role\": \"user\", \"content\": \"¿Qué es una pena convencional?\"}], \"max_tokens\": 4, \"stream\": true, \"stream_options\": {\"include_usage\": true}}" | grep -v "^$" | sed -E "s/\"id\": \"chatcmpl-[0-9a-f]+\", //; s/\"created\": [0-9]+, //"'
paso "p2 metrics" sh -c 'curl -s http://127.0.0.1:8000/metrics | grep -E "^vllm:(cache_config_info|num_requests_running|num_requests_waiting|kv_cache_usage_perc|num_preemptions_total|time_to_first_token_seconds_count)"'
paso "p2 verificar" python3 verificar.py servidor clave memoria plantilla

# paso 3 · carga.env
usa carga.env
paso "p3 verificar" python3 verificar.py prueba lugares

# paso 4 · una() y cerrada()
usa pipeline/carga.py
usa pipeline/reporte.py
cp "$KIT/mundo/esqueleto/pipeline/reporte.py" pipeline/reporte.py      # el reporte todavía es el esqueleto (paso 5)
paso "p4 humo" python3 pipeline/carga.py humo
paso "p4 verificar humo" python3 verificar.py humo
paso "p4 cerrada" python3 pipeline/carga.py cerrada
paso "p4 verificar" python3 verificar.py cerrada

# paso 5 · abierta() y el reporte
paso "p5 abierta" python3 pipeline/carga.py abierta
paso "p5 verificar abierta" python3 verificar.py abierta
usa pipeline/reporte.py
paso "p5 reporte" python3 pipeline/reporte.py
paso "p5 verificar" python3 verificar.py reporte

# paso 6 · la GPU rentada: lo que corre sin pod (el plan y la receta)
usa gpu.env
paso "p6 plan" python3 mundo/gpu.py plan
paso "p6 receta" python3 mundo/gpu.py receta
paso "p6 verificar" python3 verificar.py gpu
paso "p6 sin llave" env -u RUNPOD_API_KEY python3 mundo/gpu.py estado

# todo
paso "fin verificar" python3 verificar.py
paso "fin parar" python3 mundo/servidor.py parar

# la ronda Construir solo arranca desde el esqueleto
paso "solo reiniciar" python3 mundo/reiniciar.py
paso "solo verificar" python3 verificar.py mundo config
