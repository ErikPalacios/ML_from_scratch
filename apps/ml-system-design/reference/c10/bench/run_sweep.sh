#!/usr/bin/env bash
# Barrido de concurrencia contra UNA réplica de vllm-70b (caso c10) → un JSON por punto → pick_concurrency.py.
# NO se ejecutó en esta referencia (no hay GPU): los flags se verificaron contra el código de vLLM v0.30.0
# (vllm/benchmarks/serve.py y vllm/benchmarks/datasets/datasets.py). Corre en una máquina con la réplica
# levantada (kubectl port-forward a un pod, o dentro del cluster) y con vLLM instalado (trae `vllm bench`).
#
# Por qué contra UNA réplica y no contra el gateway: queremos la capacidad de la unidad que escala. El
# gateway (admisión, cuotas) se prueba aparte. Y por qué "con la mezcla del caso": la capacidad depende del
# largo del prompt, de cuánto se comparte y del largo de la salida; con otra mezcla el número no sirve.
set -euo pipefail  # cortar ante el primer error o variable sin definir

BASE_URL="${BASE_URL:-http://localhost:8000}"           # la réplica (port-forward al pod)
MODEL="${MODEL:-chat-70b-fp8-2026-09-28}"               # el --served-model-name del pod
TOKENIZER="${TOKENIZER:-/models/chat-70b-fp8-2026-09-28}" # tokenizer local: los conteos de tokens salen de aquí
OUT="${OUT:-results}"                                    # carpeta de los JSON
NUM_PROMPTS="${NUM_PROMPTS:-1000}"                       # ≥ 500 por punto: con menos, el p95 es ruido

for c in 16 32 48 64 72 80 96; do  # alrededor del codo esperado (≈ 40 planeado × 1/0.7 ≈ 57, y más allá)
  vllm bench serve \
    --backend openai-chat \
    --endpoint /v1/chat/completions \
    --base-url "$BASE_URL" \
    --model "$MODEL" \
    --tokenizer "$TOKENIZER" \
    `# Mezcla sintética del caso: 3 productos (3 prefijos) × ≈ 1,000 tokens compartidos + ≈ 1,000 propios,` \
    `# 250 de salida. Los prompts se barajan (default). Mejor aún: reproducir prompts reales redactados.` \
    --dataset-name prefix_repetition \
    --prefix-repetition-num-prefixes 3 \
    --prefix-repetition-prefix-len 1000 \
    --prefix-repetition-suffix-len 1000 \
    --prefix-repetition-output-len 250 \
    `# ignore_eos: que cada request genere sus 250 tokens; sin esto, texto aleatorio corta en largos raros.` \
    --ignore-eos \
    --num-prompts "$NUM_PROMPTS" \
    `# Barrido CERRADO: hasta c requests en vuelo, el siguiente sale cuando termina uno.` \
    --max-concurrency "$c" \
    --request-rate inf \
    `# El default de --metric-percentiles es "99": sin esto no hay p95 en el JSON.` \
    --percentile-metrics ttft,tpot,itl,e2el \
    --metric-percentiles 50,95,99 \
    `# goodput: req/s que cumplen TTFT ≤ 1,000 ms Y TPOT ≤ 50 ms uno por uno (valores en ms).` \
    --goodput ttft:1000 tpot:50 \
    --save-result \
    --result-dir "$OUT" \
    --result-filename "sweep-c$(printf '%03d' "$c").json"
done

# Elegir: el último punto que cumple antes del primero que no, y la capacidad planeada al 70 %.
python "$(dirname "$0")/pick_concurrency.py" "$OUT"/sweep-c*.json --ttft-ms 1000 --tpot-ms 50 --percentile 95

# Después, confirmar con un barrido ABIERTO (llegadas de Poisson a la tasa planeada), que es como llega el
# tráfico real: con --request-rate 4.2 y sin --max-concurrency, la cola se forma en el servidor y se ve en el
# TTFT. El barrido cerrado nunca deja que se forme esa cola (coordinated omission, #m03.load-testing).
