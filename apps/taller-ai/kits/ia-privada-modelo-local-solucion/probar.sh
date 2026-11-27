#!/usr/bin/env bash
# Corre el Guiado de la estación 1 de IA Privada en una carpeta limpia, como lo haría una persona, con los archivos de
# esta solución, y deja cada salida real en <carpeta>.log. Es el kit recién descomprimido: el esqueleto en su lugar.
# Uso: bash probar.sh <carpeta-vacía>     (necesita llama-server 1.1.0+ e internet para bajar el modelo una vez)
# Con TRUEML_MODELOS=/otra/carpeta copia el GGUF de ahí (con su sha256) en vez de bajarlo (≈ 805 MB).
set -uo pipefail
SOL="$(cd "$(dirname "$0")" && pwd)"
KIT="$SOL/../ia-privada-modelo-local"
D="$1"; LOG="$D.log"
rm -rf "$D"; mkdir -p "$D"; : > "$LOG"
paso() { echo "### $1" >> "$LOG"; shift; { "$@" 2>&1; c=$?; [ $c -ne 0 ] && echo "[código $c]"; } | tee -a "$LOG"; echo >> "$LOG"; }
usa() { mkdir -p "$(dirname "$1")"; cp "$SOL/$1" "$1"; }

(cd "$KIT" && tar --exclude .taller --exclude __pycache__ --exclude modelo --exclude .respaldo -cf - .) | (cd "$D" && tar -xf -)
(cd "$KIT/mundo/esqueleto" && tar -cf - .) | (cd "$D" && tar -xf -)
cd "$D"

# paso 0 · el mundo
paso "p0 version" sh -c 'llama-server --version 2>&1 | grep -E "^version"; python3 --version'
paso "p0 modelos" python3 mundo/modelos.py
paso "p0 listar" python3 mundo/modelos.py --listar
paso "p0 verificar" python3 verificar.py mundo
paso "p0 esqueleto" python3 verificar.py config

# paso 1 · servidor.env
usa servidor.env
paso "p1 verificar" python3 verificar.py config

# paso 2 · servir.sh
usa servir.sh
paso "p2 arrancar" python3 mundo/servidor.py arrancar
paso "p2 health" curl -s http://127.0.0.1:9931/health
paso "p2 sin clave" curl -s -w "\n[HTTP %{http_code}]" http://127.0.0.1:9931/v1/models
paso "p2 modelos" sh -c 'curl -s -H "Authorization: Bearer dojo-local-7f3a" http://127.0.0.1:9931/v1/models | python3 -c "import json, sys; d = json.load(sys.stdin)[\"data\"][0]; print(json.dumps({k: d[k] for k in (\"id\", \"owned_by\", \"meta\")}, indent=1))"'
paso "p2 props" sh -c 'curl -s -H "Authorization: Bearer dojo-local-7f3a" http://127.0.0.1:9931/props | python3 -c "
import json, sys; p = json.load(sys.stdin)
print(json.dumps({k: p[k] for k in (\"model_alias\", \"model_ftype\", \"total_slots\", \"build_info\")}, ensure_ascii=False, indent=1))
print(\"chat_template:\", p[\"chat_template\"][:300].replace(chr(10), \" \") + \" …\")"'
paso "p2 log" sh -c 'grep -E "n_ctx_slot|listening|security" .taller/servidor.log | sed -E "s/^[0-9.]+ [A-Z] +//"'
CUERPO='{"model": "qwen3-0.6b", "messages": [{"role": "system", "content": "Contesta en una frase."}, {"role": "user", "content": "¿Qué es un contrato de arrendamiento?"}], "temperature": 0, "seed": 7, "max_tokens": 120}'
paso "p2 crudo" curl -s http://127.0.0.1:9931/v1/chat/completions -H "Authorization: Bearer dojo-local-7f3a" -H "Content-Type: application/json" -d "$CUERPO"
paso "p2 verificar" python3 verificar.py servidor clave plantilla

# precálculos (en el despacho y en el dojo; los supuestos del despacho van escritos en cada comando)
paso "pc pesos" python3 -c "
import json, urllib.request
h = {'Authorization': 'Bearer dojo-local-7f3a'}
m = json.load(urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:9931/v1/models', headers=h)))['data'][0]['meta']
n, b = m['n_params'], m['size']
print(f'dojo:     Qwen3-0.6B en Q8_0: {n:,} parámetros, {b:,} bytes de pesos = {b * 8 / n:.2f} bits por parámetro ({b / 1e9:.2f} GB)')
print(f'          Q8_0 guarda bloques de 32 pesos: 32 bytes (1 por peso) + 2 de escala = 34 × 8 / 32 = {34 * 8 / 32} bits por peso')
print(f'despacho: Qwen3 32B en INT4 de AWQ: 19.32 GB de pesos (la ficha del despacho) × 8 ÷ 32.76 mil millones = {19.32e9 * 8 / 32.76e9:.2f} bits por parámetro: 4 de cada peso + escalas y lo que queda en 16 bits')"
paso "pc ficha" python3 mundo/ficha.py
paso "pc kv" python3 -c "
def kv(capas, cabezas_kv, dim):
    return 2 * capas * cabezas_kv * dim * 2          # K y V · cada capa · cada cabeza KV · su dimensión · 2 bytes (f16)
d, g = kv(28, 8, 128), kv(64, 8, 128)
print(f'dojo:     Qwen3-0.6B (28 capas, 8 cabezas KV de 128): {d:,} B = {d / 1024:.0f} KiB por token · × 8,192 = {d * 8192 / 2**20:,.0f} MiB')
print(f'despacho: Qwen3 32B (64 capas, 8 cabezas KV de 128): {g:,} B = {g / 1024:.0f} KiB por token · × 8,192 = {g * 8192 / 1e9:.2f} GB por conversación · × 8 = {g * 8192 * 8 / 1e9:.2f} GB')"
paso "pc decode" python3 -c "
import json, urllib.request
h = {'Content-Type': 'application/json', 'Authorization': 'Bearer dojo-local-7f3a'}
c = {'model': 'qwen3-0.6b', 'messages': [{'role': 'user', 'content': 'Explica qué es un contrato de arrendamiento.'}], 'max_tokens': 300, 'temperature': 0, 'seed': 7}
t = json.load(urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:9931/v1/chat/completions', json.dumps(c).encode(), h)))['timings']
pesos, ancho = 0.7988, 120          # GB de pesos (pc pesos) · GB/s de memoria de un M4 (el de esta Mac)
v = t[\"predicted_per_second\"]
print(f'dojo:     techo {ancho} GB/s ÷ {pesos} GB = {ancho / pesos:.0f} tokens/s · medido {v:.0f} tokens/s ({t[\"predicted_n\"]} tokens) = {v / (ancho / pesos):.0%} del techo')
print(f'despacho: techo 0.7 × 864 GB/s de la L40S ÷ 19.32 GB = {0.7 * 864 / 19.32:.1f} tokens/s por conversación (objetivo ≥ 20)')"
paso "pc prefill" python3 -c "
import json, urllib.request
h = {'Content-Type': 'application/json', 'Authorization': 'Bearer dojo-local-7f3a'}
c = {'model': 'qwen3-0.6b', 'messages': [{'role': 'user', 'content': 'cláusula ' * 1500}], 'max_tokens': 1, 'cache_prompt': False}
for _ in range(2):                  # la primera calienta; se reporta la segunda
    t = json.load(urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:9931/v1/chat/completions', json.dumps(c).encode(), h)))['timings']
print(f'dojo:     un prompt de {t[\"prompt_n\"]:,} tokens: prefill en {t[\"prompt_ms\"] / 1000:.2f} s ({t[\"prompt_per_second\"]:,.0f} tokens/s) en tu Mac')
print(f'despacho: 2 × 32.76 mil millones × 6,000 tokens ÷ (0.5 × 362 TFLOPS de la L40S) = {2 * 32.76e9 * 6000 / (0.5 * 362e12):.2f} s (objetivo de TTFT ≤ 2 s)')"

# paso 3 · el cliente
usa pipeline/llm.py
paso "p3 cliente" python3 -c "
import sys; sys.path.insert(0, 'pipeline')
from llm import Cliente
c = Cliente()
print('modelos():', c.modelos())
print('contar_tokens(\"Cláusula cuarta.\"):', c.contar_tokens('Cláusula cuarta.'))
r = c.chat([{'role': 'user', 'content': '¿Qué es una pena convencional? Una frase.'}], max_tokens=80)
print(r.texto)
print(f'tokens {r.tokens_prompt} → {r.tokens_salida} · fin {r.fin} · {r.segundos:.2f} s')"
paso "p3 tokens" python3 -c "
import sys; sys.path.insert(0, 'pipeline')
from llm import Cliente
c = Cliente()
for t in ('Cláusula cuarta.', 'Clause four.', 'arrendamiento', 'arrendatario', 'LFPDPPP'):
    print(f'{t!r:>20}: {c.contar_tokens(t)} tokens')"
paso "p3 verificar" python3 verificar.py cliente

# paso 4 · streaming
usa pipeline/preguntar.py
paso "p4 preguntar" python3 pipeline/preguntar.py "¿Qué es una pena convencional en un contrato?"
paso "p4 verificar" python3 verificar.py stream

# paso 5 · cuando algo sale mal
paso "p5 contexto" python3 -c "
import sys; sys.path.insert(0, 'pipeline')
from llm import Cliente, ContextoExcedido
try:
    Cliente().chat([{'role': 'user', 'content': 'cláusula ' * 9000}], max_tokens=5)
except ContextoExcedido as e:
    print(f'ContextoExcedido: {e}\n  n_prompt={e.n_prompt:,} n_ctx={e.n_ctx:,}')"
paso "p5 parar" python3 mundo/servidor.py parar
paso "p5 caido" python3 pipeline/preguntar.py "¿Sigues ahí?"
paso "p5 arrancar" python3 mundo/servidor.py arrancar
paso "p5 clave" python3 -c "
import sys; sys.path.insert(0, 'pipeline')
from llm import Cliente, ErrorLLM
try:
    Cliente(clave='otra').modelos()
except ErrorLLM as e:
    print(type(e).__name__, '·', e)"
paso "p5 verificar" python3 verificar.py contexto caido

# paso 6 · citas que se pueden validar
usa pipeline/citar.py
paso "p6 libre" python3 pipeline/citar.py --libre
paso "p6 enum" python3 pipeline/citar.py
paso "p6 verificar" python3 verificar.py citas

# todo
paso "fin verificar" python3 verificar.py
paso "fin parar" python3 mundo/servidor.py parar

# la ronda Construir solo arranca desde el esqueleto
paso "solo reiniciar" python3 mundo/reiniciar.py
paso "solo verificar" python3 verificar.py mundo config
