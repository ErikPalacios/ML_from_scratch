#!/usr/bin/env bash
# Corre el Guiado de la estación 8 del RAG en una carpeta limpia, como lo haría una persona, con los archivos de esta
# solución, y deja cada salida real en <carpeta>.log. Es el kit recién descomprimido: el esqueleto en su lugar.
# Uso: bash probar.sh <carpeta-vacía>   (crea su .venv con python3; necesita llama-server 1.1.0+ e internet para pip)
# Con DOJO_MODELOS=/otra/copia/modelo copia los modelos de ahí en vez de bajarlos (≈ 1.4 GB).
set -uo pipefail
SOL="$(cd "$(dirname "$0")" && pwd)"
KIT="$SOL/../rag-rag-api"
D="$1"; LOG="$D.log"
rm -rf "$D"; mkdir -p "$D"; : > "$LOG"
paso() { echo "### $1" >> "$LOG"; shift; { "$@" 2>&1; c=$?; [ $c -ne 0 ] && echo "[código $c]"; } | tee -a "$LOG"; echo >> "$LOG"; }
usa() { cp "$SOL/pipeline/$1" "pipeline/$1"; }
Q="¿En cuánto tiempo se reembolsa un cobro duplicado?"
L="¿Qué casos se escalan a líderes de soporte?"

(cd "$KIT" && tar --exclude .taller --exclude __pycache__ --exclude almacen --exclude modelo --exclude cache --exclude indices --exclude .venv -cf - .) | (cd "$D" && tar -xf -)
(cd "$KIT/mundo/esqueleto" && tar -cf - .) | (cd "$D" && tar -xf -)
cd "$D"

# paso 0 · el mundo
paso "p0 venv" sh -c 'python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt 2>&1 | grep -v "^\[notice\]"; .venv/bin/python --version; .venv/bin/pip list 2>/dev/null | grep -i -E "^(fastapi|uvicorn|starlette|pydantic|onnxruntime|numpy|tokenizers|pyyaml) "; llama-server --version 2>&1 | grep -E "^version"'
source .venv/bin/activate
paso "p0 modelos" python mundo/modelos.py
paso "p0 listar" python mundo/modelos.py --listar
paso "p0 crear" python mundo/crear.py
paso "p0 llm" python mundo/servidor.py arrancar
paso "p0 verificar" python verificar.py mundo
paso "p0 esqueleto" python verificar.py prompt

# precálculos (en el dojo y en C11; los supuestos de C11 van escritos en cada comando)
paso "pc ventana" python -c "
import sys; sys.path.insert(0, 'pipeline')
import llm; from recuperar import abrir; from _comun import corpus
c = llm.Cliente(); ch = corpus()['chunks']
top = abrir().recuperar('$Q', 'elena.cruz@marketplace.test')['top']
t = [c.contar_tokens(ch[k]['texto']) for k, _ in top]
v = c.ventana()
print(f'dojo: los 8 chunks del top de «$Q» suman {sum(t):,} tokens (de {min(t)} a {max(t)}) · ventana {v:,} = 8,192 ÷ 1 slot')
print(f'      presupuesto del prompt = {v:,} − 256 de respuesta − 64 de reserva = {v - 320:,} tokens: caben de sobra')
print(f'      con PARALELO=8, cada petición tiene 8,192 ÷ 8 = 1,024: quedan {1024 - 320} tokens para las reglas, la pregunta y los documentos')
print(f'C11:  8 chunks × ≈ 400 tokens (estación 2) + ≈ 300 de reglas y pregunta + 512 de respuesta = {8 * 400 + 300 + 512:,} tokens por petición')"
paso "pc limite" python -c "
import sys; sys.path.insert(0, 'pipeline')
import llm
r = llm.Cliente().chat([{'role': 'user', 'content': 'Cuenta del 1 al 60, separados por comas.'}], max_tokens=120)
v = r.tiempos['predicted_per_second']
print(f'dojo: el LLM escribe a {v:.0f} tokens/s · una respuesta de 256 tokens: 2.5 s de primer token + 256 ÷ {v:.0f} = {2.5 + 256 / v:.1f} s · llm.limite_s = 30 deja margen')
print(f'      con limite_s = 0.5 no alcanza ni el primer token del p95')
for tps in (20, 40):
    print(f'C11:  a {tps} tokens/s por persona (supuesto: la plataforma reparte su GPU entre muchas), 512 tokens: 2.5 + 512 ÷ {tps} = {2.5 + 512 / tps:.0f} s')"

# paso 1 · el prompt
usa prompt.py
paso "p1 ejemplo" python pipeline/prompt.py
paso "p1 verificar" python verificar.py prompt

# paso 2 · las citas
usa citas.py
paso "p2 ejemplo" python pipeline/citas.py
paso "p2 verificar" python verificar.py citas

# paso 3 · las guardas
usa guardas.py
paso "p3 corpus" python pipeline/guardas.py
paso "p3 veneno" python -c "
import json; c = json.load(open('almacen/corpus/vigente.json'))['chunks']['drive:d40#000']
print(c['titulo'], '·', c['acl']); print(c['texto'])"
paso "p3 verificar" python verificar.py guardas

# paso 4 · la API
usa api.py
paso "p4 arrancar" python mundo/api.py arrancar
paso "p4 elena" python pipeline/preguntar.py --persona elena.cruz@marketplace.test "$Q"
paso "p4 eventos" python pipeline/preguntar.py --eventos --persona paula.vega@marketplace.test "$L"
paso "p4 carmen" python pipeline/preguntar.py --persona carmen.nava@marketplace.test "$Q"
paso "p4 sin llave" curl -s -w "\n[HTTP %{http_code}]" -X POST http://127.0.0.1:9932/v1/ask -H "Content-Type: application/json" -d '{"pregunta": "hola"}'
TK=$(python -c "import json; print({p: t for t, p in json.load(open('almacen/tokens.json')).items()}['paula.vega@marketplace.test'])")
paso "p4 crudo" sh -c "curl -sN -X POST http://127.0.0.1:9932/v1/ask -H 'Content-Type: application/json' -H 'Authorization: Bearer $TK' -d '{\"pregunta\": \"¿Cuánto puede compensar un líder a un cliente Plata?\"}' | head -9"
paso "p4 verificar" python verificar.py citas api permisos inyeccion nose

# paso 5 · cuando algo se corta
paso "p5 parar" python mundo/servidor.py parar
paso "p5 caido" python pipeline/preguntar.py --persona paula.vega@marketplace.test "¿Qué pasa si quien compra no recoge el paquete en la sucursal?"
paso "p5 arrancar" python mundo/servidor.py arrancar
paso "p5 verificar" python verificar.py stream contexto

# paso 6 · el presupuesto del primer token
paso "pc ttft" python -c "
import sys, statistics; sys.path.insert(0, 'pipeline')
import api, sse; from recuperar import abrir; from _comun import golden
rec = abrir(); _, g = golden()
qs = [x for x in g if x['split'] == 'test' and x['tipo'] == 'directa'][:10]
list(api.responder('¿Qué días salen los pagos a vendedores?', 'carmen.nava@marketplace.test', recuperador=rec, cache=api.Cache()))
ms = []
for x in qs:
    ev = list(sse.leer(''.join(api.responder(x['pregunta'], x['persona'], recuperador=rec, cache=api.Cache())).splitlines(True)))
    ms.append(ev[-1][1]['ms'])
m = {k: statistics.median(x[k] for x in ms) for k in ('buscar', 'reranker', 'prompt', 'ttft')}
llm_ = m['ttft'] - m['buscar'] - m['reranker'] - m['prompt']
print(f'dojo (mediana de 10): buscar {m[\"buscar\"]:.0f} + reranker {m[\"reranker\"]:.0f} + prompt {m[\"prompt\"]:.0f} + LLM hasta su primer token {llm_:.0f} = {m[\"ttft\"]:.0f} ms de 2,500')
b, r, red = 50, 150, 100
print(f'C11 (supuestos: buscar {b} ms en el motor, reranker {r} ms en GPU, {red} ms de red y colas): al LLM le quedan {2500 - b - r - red:,} ms para el prefill')
print(f'      de ≈ 4,000 tokens: necesita leer el prompt a ≥ {4000 / ((2500 - b - r - red) / 1000):,.0f} tokens/s, sin contar la cola de la plataforma')"
paso "p6 verificar" python verificar.py ttft

# todo
paso "fin verificar" python verificar.py

# la ronda Construir solo arranca desde el esqueleto
paso "solo parar" python mundo/api.py parar
paso "solo reiniciar" python mundo/reiniciar.py
paso "solo verificar" python verificar.py mundo prompt
