#!/usr/bin/env bash
# Corre el Guiado de la estación 6 en una carpeta limpia, como lo haría una persona, con los archivos de esta
# solución, y deja cada salida real en <carpeta>.log. Es el kit recién descomprimido: el esqueleto en su lugar.
# Uso: bash probar.sh <carpeta-vacía>      (necesita Docker; crea su propio .venv con python3; ≈ 6 min)
set -uo pipefail
SOL="$(cd "$(dirname "$0")" && pwd)"
KIT="$SOL/../c01-serving"
D="$1"; LOG="$D.log"
rm -rf "$D"; mkdir -p "$D"; : > "$LOG"
export PYTHONUNBUFFERED=1
paso() { echo "### $1" >> "$LOG"; shift; { "$@" 2>&1; c=$?; [ $c -ne 0 ] && echo "[código $c]"; } | grep -v -E "View (run|experiment)|Waiting up to 300 seconds|época" | tee -a "$LOG"; echo >> "$LOG"; }
usa() { mkdir -p "$(dirname "$1")"; cp "$SOL/$1" "$1"; }

(cd "$KIT" && tar --exclude .taller --exclude __pycache__ --exclude data --exclude fotos-raras --exclude logs --exclude .venv --exclude servir.yaml --exclude .pytest_cache -cf - .) | (cd "$D" && tar -xf -)
(cd "$KIT/mundo/esqueleto" && tar -cf - .) | (cd "$D" && tar -xf -)
cd "$D"
docker compose down -v >/dev/null 2>&1

# paso 0 · el mundo
paso "p0 venv" sh -c 'python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt 2>&1 | grep -v "^\[notice\]"; .venv/bin/python --version; du -sh .venv | cut -f1'
source .venv/bin/activate
paso "p0 up" sh -c 'docker compose up -d --wait 2>&1 | tail -2'
paso "p0 crear" sh -c '/usr/bin/time -p python mundo/crear.py 2>&1'
paso "p0 git" sh -c 'git init -q && git add -A && git commit -qm "kit recién descomprimido" && git log --oneline'
paso "p0 verificar" python verificar.py mundo

# precálculos
paso "pc memoria" python -c "
MiB = 2**20
for nombre, en_vuelo, decodes in [('C01 y el dojo (gateway.yaml)', 16, 2), ('con 64 en vuelo y 8 decodes', 64, 8)]:
    bodies = en_vuelo * 10 * MiB
    decode = decodes * 40_000_000 * 4 * 2
    print(f'{nombre}: bodies {en_vuelo} × 10 MiB = {bodies / MiB:,.0f} MiB · decodes {decodes} × 40 MP × 4 B × 2 copias = {decode / MiB:,.0f} MiB · total {(bodies + decode) / MiB:,.0f} MiB + el proceso')"
paso "pc little" python -c "
for nombre, llegan, dura in [('C01, una copia, requests normales', 100, 0.050), ('C01, una copia, requests lentas', 100, 0.200), ('dojo, verificar responde (8 a la vez)', 800, 0.010)]:
    print(f'{nombre}: {llegan}/s × {dura * 1000:.0f} ms = {llegan * dura:.0f} en vuelo')"
paso "pc plazo" python -c "
P, T = 250, 150
for nombre, subir, cpu, decode in [('Ana', 3, 0, 6), ('subida lenta', 200, 0, 6), ('subida de 240 ms', 240, 0, 6)]:
    g = subir + cpu + decode
    print(f'{nombre}: gastado {g} ms · queda {P - g} ms · plazo de Triton min({T}, {P - g}) = {min(T, P - g)} ms')"
paso "pc batch" python -c "
for nombre, llegan in [('C01, una T4 en el pico (250/s)', 250), ('C01, una zona caída (500/s)', 500), ('dojo, verificar responde (≈ 800/s)', 800)]:
    print(f'{nombre}: 1 + {llegan} × 0.002 = {1 + llegan * 0.002:.1f} fotos por batch')"
paso "pc tensor" python -c "
for nombre, lado, foto in [('C01', 224, 214_836), ('dojo', 32, 1_278)]:
    t = 3 * lado * lado * 4
    print(f'{nombre}: tensor 3 × {lado} × {lado} × 4 B = {t:,} B · la foto pesa ≈ {foto:,} B · {t / foto:.1f} veces')"
paso "pc log" python -c "
for nombre, por_dia, bytes_ in [('C01', 10_000_000, 300), ('dojo, un día de verificar', 2_000, 300)]:
    print(f'{nombre}: {por_dia:,} requests × {bytes_} B = {por_dia * bytes_ / 1e9:.3f} GB al día')"

# paso 1 · qué se sirve y con qué reglas
paso "p1 servir" sh -c 'grep -v "^#" servir.yaml'
paso "p1 versiones" python mundo/modelos.py versiones
paso "p1 engine" python mundo/modelos.py engine 4
paso "p1 reglas" sh -c 'grep -v "^#" gateway.yaml | sed -n "1,30p"'
paso "p1 verificar" python verificar.py reglas

# paso 2 · el model repository
usa servir/armar.py
git add -A && git commit -qm "servir: armar"
paso "p2 armar" python servir/armar.py
paso "p2 otra vez" python servir/armar.py
paso "p2 arbol" sh -c 'find model_repository servir -type f | sort; python -m json.tool servir/modelo.json | head -12'
paso "p2 verificar" python verificar.py repositorio

# paso 3 · el config.pbtxt y Triton
usa model_repository/classifier/config.pbtxt
git add -A && git commit -qm "triton: config.pbtxt"
paso "p3 mal" sh -c 'sed -i.bak "s/dims: \[ 3, 32, 32 \] } \]/dims: [ 1, 3, 32, 32 ] } ]/" model_repository/classifier/config.pbtxt && python mundo/servicios.py arrancar triton; mv model_repository/classifier/config.pbtxt.bak model_repository/classifier/config.pbtxt'
paso "p3 arrancar" python mundo/servicios.py arrancar triton
paso "p3 log" sh -c 'grep -v "Started\|model repository" logs/triton.log | sed -E "s/^I[0-9]+ [0-9:.]+ [0-9]+ servidor.py\] //"'
paso "p3 meta" sh -c 'curl -s localhost:8700/v2/models/classifier; echo; curl -s -o /dev/null -w "/v2/health/ready → %{http_code}\n" localhost:8700/v2/health/ready'
paso "p3 verificar" python verificar.py config triton

# paso 4 · revisar cada foto
usa gateway/app/revision.py
git add -A && git commit -qm "gateway: revision"
paso "p4 revisar" python -c "
import sys; sys.path.insert(0, 'gateway')
from pathlib import Path
from app.revision import Rechazo, preparar, revisar_imagen, revisar_tipo
TIPO = {'jpg': 'image/jpeg', 'png': 'image/png', 'webp': 'image/webp', 'pdf': 'application/pdf'}
for n in ['tenis.jpg', 'tenis.webp', 'tenis-girada.jpg', 'documento.pdf', 'vacia.jpg', 'gigante.png', 'tira.png', 'corrupta.jpg', 'cortada.jpg']:
    data = Path('fotos-raras', n).read_bytes()
    try:
        revisar_tipo(TIPO[n.rsplit('.', 1)[1]], ['image/jpeg', 'image/png', 'image/webp'])
        w, h = revisar_imagen(data, 40_000_000, 8)
        x = preparar(data)
        print(f'{n:<17} {len(data):>7,} B · {w} × {h} → tensor {list(x.shape)}')
    except Rechazo as e:
        print(f'{n:<17} {len(data):>7,} B → {e.codigo} {e.motivo}')"

# paso 5 · el gateway: arranque, salud y classify
usa gateway/app/main.py
git add -A && git commit -qm "gateway: main"
paso "p5 arrancar" python mundo/servicios.py arrancar gateway
paso "p5 estado" python mundo/servicios.py estado
paso "p5 classify" sh -c 'curl -s -i -X POST "localhost:8701/v1/classify?top_k=3" -H "Content-Type: image/jpeg" -H "X-Request-ID: ana-0001" -H "X-Client-Source: mobile" --data-binary @fotos-raras/tenis.jpg | grep -v -i "^date:\|^server:"'
paso "p5 salud" sh -c 'curl -s -w "  ← /healthz %{http_code}\n" localhost:8701/healthz; curl -s -w "  ← /readyz %{http_code}\n" localhost:8701/readyz'
paso "p5 verificar" python verificar.py salud responde
paso "p5 batch" sh -c 'curl -s localhost:8700/metrics | grep -E "^nv_inference_(count|exec_count)"; python -c "
import re, urllib.request
m = urllib.request.urlopen(\"http://localhost:8700/metrics\").read().decode()
n, e = (float(re.search(rf\"^nv_inference_{k}\\{{.*\\}} (\\S+)\", m, re.M).group(1)) for k in (\"count\", \"exec_count\"))
print(f\"{n:.0f} fotos en {e:.0f} batches: {n / e:.2f} fotos por batch en promedio\")"'
paso "p5 memoria" sh -c 'ps -o rss= -p $(cat logs/gateway.pid) | awk "{printf \"el gateway ocupa %.0f MiB (RSS) sin requests\n\", \$1 / 1024}"'

# paso 6 · los códigos de cada falla y los topes
paso "p6 codigos" sh -c 'for f in "tenis.png image/png" "documento.pdf application/pdf" "vacia.jpg image/jpeg" "gigante.png image/png" "tira.png image/png" "corrupta.jpg image/jpeg" "cortada.jpg image/jpeg"; do set -- $f; printf "%-14s → " $1; curl -s -X POST localhost:8701/v1/classify -H "Content-Type: $2" --data-binary @fotos-raras/$1 -w "  [%{http_code}]\n"; done; printf "%-14s → " "top_k=50"; curl -s -X POST "localhost:8701/v1/classify?top_k=50" -H "Content-Type: image/jpeg" --data-binary @fotos-raras/tenis.jpg -w "  [%{http_code}]\n" | cut -c1-150; printf "%-14s → " "GET"; curl -s localhost:8701/v1/classify -w "  [%{http_code}]\n"'
paso "p6 verificar" python verificar.py rechazos topes

# paso 7 · los plazos, con Triton congelado de verdad
paso "p7 congelado" sh -c 'kill -STOP $(cat logs/triton.pid); curl -s -o /dev/null -w "classify → %{http_code} en %{time_total} s\n" -X POST localhost:8701/v1/classify -H "Content-Type: image/jpeg" --data-binary @fotos-raras/tenis.jpg; curl -s -w " ← /readyz %{http_code} en %{time_total} s\n" localhost:8701/readyz; curl -s -w " ← /healthz %{http_code}\n" localhost:8701/healthz; python mundo/servicios.py estado; kill -CONT $(cat logs/triton.pid)'
paso "p7 log" sh -c 'grep "\"status\": 504" logs/gateway.log | tail -1'
paso "p7 verificar" python verificar.py plazos

# paso 8 · el log, las métricas y las pruebas
usa gateway/tests/conftest.py
usa gateway/tests/test_gateway.py
git add -A && git commit -qm "gateway: pruebas"
paso "p8 linea" sh -c 'grep "\"request_id\": \"ana-0001\"" logs/gateway.log | python -m json.tool; grep "\"request_id\": \"ana-0001\"" logs/gateway.log | wc -c | awk "{print \$1, \"B en una línea\"}"'
paso "p8 metricas" sh -c 'curl -s localhost:8701/metrics | grep -E "^classifier_requests_total|^classifier_request_seconds_(count|sum)"'
paso "p8 pytest" sh -c '/usr/bin/time -p python -m pytest -q 2>&1 | tail -4'
paso "p8 verificar" python verificar.py log pruebas

paso "final" python verificar.py
echo "listo: $LOG"
