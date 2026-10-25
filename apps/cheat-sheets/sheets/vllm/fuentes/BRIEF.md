# Brief: "Serving de LLMs con vLLM" (study page + PDF) — content writers

## Goal and learner
- **Learner:** a mechatronics MSc with a CV/PyTorch background who has never shipped to production.
  - Sheets they already have: Docker, Kubernetes, Git + Actions, "De PyTorch a Triton" (serving a CNN), "El gateway: FastAPI en producción", "Prometheus y Grafana", and the map "Del dato a producción".
- **What this sheet teaches:** why serving an LLM is different from serving a CNN, and how to run vLLM well. Topics:
  - tokens and context;
  - prefill vs decode;
  - the KV cache and VRAM math;
  - `vllm serve` and its flags;
  - the OpenAI-compatible API with streaming;
  - continuous batching;
  - LLM latency metrics (TTFT, TPOT/ITL, tokens/s) and benchmarking;
  - tensor/pipeline parallelism;
  - quantization;
  - optimizations (prefix caching, speculative decoding, LoRA, autoscaling, cold start);
  - the LLM gateway in front (quotas in tokens, admission, PII, streaming through proxies);
  - diagnosis.
- **Target level is the JOB:** size and launch a vLLM deployment with the docs open, read its metrics, and diagnose OOMs, slow first tokens, preemption and truncated answers.
- **Format:** the same as the other sheets.
  - **Each section:**
    - a "fórmula": syntax templates with `{placeholders}`, plus real KaTeX formulas (KV cache bytes, VRAM budget, TTFT/TPOT, throughput, Little's law for concurrency);
    - a pieces table and a real example;
    - a figure;
    - "Cómo recordarla", "Trampa", and an optional mini-lab.
  - **Web tools at the end:**
    - a symptom **diagnosticador**;
    - a **calculadora de VRAM y KV cache**, a port of C10's `capacity/vram_calc.py`;
    - an error **quiz**.
- **Language:** Spanish (neutral Latin American, tuteo), technical terms in English. Gender-neutral. Say "el curso"; course labels like C10/M14 are fine; never invent shorthand codes.

## Style: plain language, same concepts
The learner asked for "lenguaje simple pero mencionando los mismos conceptos".
- **Short sentences:** one idea each, everyday words.
- **First mentions:** explain each technical term in plain words the first time it appears in a section, and keep the English term beside it. Example: "el **KV cache** (lo que el modelo ya 'leyó' de tu conversación, guardado en la GPU para no recalcularlo en cada token nuevo)".
- **No jargon:** no undefined acronyms and no stacked jargon.
- **Analogies:** only correct ones that help memory. Examples:
  - prefill is reading the whole question at once; decode is answering word by word;
  - continuous batching is a bus that lets passengers on and off at every stop, instead of waiting until everyone reaches the end.
- **Never drop concepts** to simplify.
- **Tables:** in `pieces` and `vars`, the "qué hace" column is plain Spanish; the flag, field or code stays exact.

## Sources
- **App root:** `/Users/erikpalacios/Documents/ML_from_scratch/ClaudeApss/.claude/worktrees/fase-7-ronda-diseno-ml-7020fd/apps/ml-system-design`. Cheat sheets: `…/apps/cheat-sheets`.
- **C10 real files (the running example), under `reference/c10/`:**
  - `README.md`
  - `k8s/vllm-70b.yaml`: the vLLM deployment, its flags, GPUs and probes
  - `capacity/vram_calc.py` and `capacity/fleet_calc.py`, with their tests
  - `bench/run_sweep.sh` and `bench/pick_concurrency.py`, with tests and fixtures
  - `gateway/llm_gateway.py`, `admission.py`, `quota.py`, `pii.py` and `tenants.yaml`, with tests
  - `monitoring/alerts.yml` and `alerts_test.yml`
  - `eval/golden_eval.py`

  Quote exact short excerpts, and use the versions they pin.
- **Course:**
  - M14 (`js/content/m14-*.js`): sections `por-que`, `prefill-decode`, `kv-cache`, `batching-caching`, `api-vs-propio`, `rag`, `agentes`, `evaluacion`, `guardrails`, `costo-tokens`.
  - C10 (`c10-*.js` and `c10-archivos.js`).
  - C11 and C12 as tenants of C10.
  - M04 (hardware), M08 (quantization), M03 (latency, Little's law).
  - `ref-numeros.js`, `ref-comandos.js`.
  - `docs/SPEC.md` §8k (C10's shared facts).
- **Consistency with existing sheets.** Read them; don't contradict them.
  - `apps/cheat-sheets/sheets/triton/fuentes/*`: batching, precision bytes, the GPU-utilization meaning.
  - `apps/cheat-sheets/sheets/gateway/fuentes/*`: admission, timeouts, retries, streaming and disconnects (499), shutdown.
  - `apps/cheat-sheets/sheets/prometheus/fuentes/*`: metric types, `histogram_quantile`, burn rate.
  - `apps/cheat-sheets/sheets/kubernetes/fuentes/*`: GPUs, probes, KEDA.
  - The recorrido sheet's `llm` pattern (`apps/cheat-sheets/sheets/recorrido/fuentes/content-w3.json`).
- **Course anchors:** `#<page>.<section-id>`. Only use ids that exist (list them with grep).
- **Verification:** check every flag, default, endpoint, metric name and message against the official docs. Load WebSearch/WebFetch with ToolSearch `select:WebSearch,WebFetch`. Sources:
  - docs.vllm.ai (serve CLI, engine args, OpenAI-compatible server, metrics, parallelism, quantization, prefix caching, speculative decoding, LoRA, structured outputs, deployment with Docker and Kubernetes);
  - the vLLM source on GitHub;
  - the OpenAI API reference (chat completions, streaming);
  - Hugging Face model cards and `config.json`, for layers, KV heads and head dim;
  - NVIDIA GPU data sheets.
- **Versions and accuracy:** it is October 2026, so check the current vLLM version and what changed (V1 engine, flag renames). State C10's pinned version from `vllm-70b.yaml`. Never invent flags, defaults, metric names or messages; if unsure, say so or leave it out.

## Settled facts
Verify them. If one is wrong, report it and use the verified value.
- **KV cache bytes per token:** 2 (K and V) × layers × num_kv_heads × head_dim × bytes per element. GQA reduces `num_kv_heads` relative to attention heads. Take the exact formula and constants from C10's `vram_calc.py` and its tests; the calculator must reproduce those test values.
- **VRAM budget:**
  - weights (params × bytes) + KV cache + activations/overhead;
  - `--gpu-memory-utilization` is the fraction of each GPU's memory vLLM may use. C10's manifest claims the default is 0.92 since v0.20 (0.9 through v0.19). **Verify this against the engine-args docs and the source for v0.30.0 and for the current version.** If the course is wrong, report it; don't copy it.
  - the KV cache gets what remains after weights and profiling.
- **C10 numbers** (from `capacity/vram_calc.py`, `README.md` and `k8s/vllm-70b.yaml`). Every writer uses the same ones:
  - **Model:** ≈ 70B with the Llama 3.x 70B architecture: 80 layers, 64 attention heads, 8 KV heads (GQA), head_dim 128, hidden 8192. 70.6 B params; the checkpoint is FP8, so ≈ 70.6 GB of weights.
  - **KV per token:** 2 × 80 × 8 × 128 × 2 B = 327,680 B = 320 KiB in BF16; 160 KiB in FP8.
  - **One replica:** 2 × H100 80 GB with TP=2, `--gpu-memory-utilization 0.90`. Room for KV ≈ 0.90 × 160 − 70.6 − ≈ 5 ≈ 68.4 GB.
  - **Sequences:** a 2,250-token sequence (2,000 prompt + 250 output) ≈ 0.737 GB, so ≈ 92 sequences (≈ 185 with FP8 KV).
  - **Fleet:** 60 rps design; ≈ 6 rps per replica measured, planned at 70 %; 16 replicas on 4 × p5.48xlarge (8 H100 each, ≈ US$55/h); ≈ US$160.6k/month against ≈ US$442.5k/month for the vendor.
  - **SLOs:** TTFT p95 ≤ 1 s at the gateway (interactive); TPOT p95 ≤ 50 ms. The bench's last point inside both is 72 in flight per replica; the gateway's cap is 288 per gateway replica.
  - **Image:** `vllm/vllm-openai:v0.30.0` by digest. Its ENTRYPOINT is `vllm serve`, so the manifest passes only args.
  - **Flags:** `--served-model-name`, `--load-format safetensors`, `--tensor-parallel-size 2`, `--gpu-memory-utilization 0.90`, `--max-model-len 8192`, `--max-num-seqs 128`, `--kv-cache-dtype auto`, `--enable-prefix-caching`, `--enable-chunked-prefill`, `--max-num-batched-tokens 8192`, `--scheduling-policy priority`, `--generation-config vllm`, `--shutdown-timeout 60`, `--port 8000`.
  - **Env:** `HF_HUB_OFFLINE=1` and `VLLM_NO_USAGE_STATS=1`. `/dev/shm` is an emptyDir with medium Memory. Probes all hit `/health`; startup allows 90 × 10 s.
  - **Ownership:** W1 owns the math (`bolsillo`, `memoria`, `calculadora`), W2 the manifest (`arrancar`), W3 the gateway (`gateway-llm`). Quote the others' parts without changing a number. If a number above is wrong in the files, the files win: report it.
- **Prefill vs decode:**
  - prefill is compute-bound, processes the whole prompt in parallel and drives TTFT;
  - decode is memory-bandwidth-bound, one token per step per sequence, and drives TPOT/ITL.
- **Continuous batching:** sequences join and leave the running batch at every step. PagedAttention stores the KV cache in fixed-size blocks.
- **OpenAI-compatible server:** `/v1/chat/completions`, `/v1/completions`, `/v1/models`, `/health`, `/metrics`; port 8000 by default (verify). Streaming uses Server-Sent Events.
- **Latency definitions** (the same in every section). Verify them against the `vllm bench serve` docs and source:
  - **TTFT** is the time from when the request arrives until the first token arrives;
  - **TPOT** = (E2E − TTFT) ÷ (output tokens − 1), the average time per output token after the first;
  - **ITL** is the gap between two consecutive tokens; TPOT is its average within one request;
  - **E2E** is the total time;
  - **throughput** is output tokens/s, and requests/s;
  - **goodput** is requests/s that meet every SLO.
- **Metric names:** vLLM's Prometheus metrics use the `vllm:` prefix (for example `vllm:num_requests_running`, `vllm:num_requests_waiting`, `vllm:time_to_first_token_seconds`, and a KV-cache usage gauge). Verify exact names for the current version and for C10's pin.

## The sections (fixed ids and numbers)
| num | id | Section | Writer |
|---|---|---|---|
| 0 | `bolsillo` | Números de bolsillo: tokens, bytes por parámetro, fórmula del KV cache, TTFT/TPOT, puertos y endpoints | W1 |
| null | `cadena` | La cadena: de un prompt a un stream de tokens (tokenizer → scheduler → prefill → KV cache → decode → detokenize → SSE) | W1 |
| 1 | `que-es` | Por qué servir un LLM es distinto y qué hace vLLM (autoregresivo, prefill/decode, PagedAttention, continuous batching, alternativas) | W1 |
| 2 | `tokens` | Tokens y contexto: tokenizer, chat template, max_model_len, prompt contra completion, costo por token, español contra inglés | W1 |
| 3 | `memoria` | Memoria: pesos + KV cache, la fórmula con GQA, gpu_memory_utilization, bloques, max_num_seqs, preemption | W1 |
| 4 | `arrancar` | Arrancar vLLM: `vllm serve` y sus flags, la imagen de Docker, el manifest del C10 en Kubernetes (GPUs, shm, probes, caché del modelo, secreto de HF) | W2 |
| 5 | `api` | La API compatible con OpenAI: chat completions, streaming SSE, parámetros de sampling, structured outputs, el cliente de openai | W2 |
| 6 | `batching` | Continuous batching y el scheduler: prefill contra decode en el mismo batch, chunked prefill, max_num_batched_tokens, latencia contra throughput | W2 |
| 7 | `metricas` | Medir: TTFT, TPOT/ITL, E2E, tokens/s, goodput; métricas `vllm:` en Prometheus; el barrido de concurrencia del C10 | W2 |
| 8 | `paralelismo` | Paralelismo: tensor, pipeline y réplicas; NVLink contra PCIe; cuándo un 70B necesita TP | W2 |
| 9 | `cuantizacion` | Cuantización: FP8, INT4 (AWQ/GPTQ), KV cache en FP8, qué GPU soporta qué, la calidad | W3 |
| 10 | `optimizar` | Optimizaciones: prefix caching, speculative decoding, LoRA múltiple, autoscaling por cola, cold start | W3 |
| 11 | `gateway-llm` | El gateway de LLMs del C10: cuotas en tokens por tenant, admisión, PII, streaming detrás de proxies, cancelar al desconectarse | W3 |
| 12 | `diagnostico` | Diagnóstico: el método y la tabla de síntomas | W3 |
| 13 | `errores` | Errores que debes reconocer rápido (vLLM, CUDA/NCCL, Hugging Face, cliente de OpenAI) | W3 |

## Extra keys
### W1 adds `calculadora`
This is a spec for an interactive VRAM / KV-cache calculator, ported from `reference/c10/capacity/vram_calc.py`:
```
{ "inputs": [ { "id": "params_b", "label": "…", "unit": "…", "default": …, "min": …, "max": …, "step": … } ],
  "presets": [ { "name": "C10 · <model>", "values": { … }, "source": "config.json / model card URL" } ],
  "formulas": [ { "id": "kv_bytes_token", "tex": "…", "js": "plain JS expression using input ids" } ],
  "outputs": [ { "id": "…", "label": "…", "js": "…", "unit": "GB" } ],
  "checks": [ { "values": { … }, "expect": { "<output id>": number }, "tolerance": 0.01, "source": "test_vram_calc.py::<test>" } ] }
```
- Every `checks` case must reproduce a real value from C10's tests or `README`.
- Presets need real model configs: layers, KV heads, head dim, params, dtype. Include C10's model plus 2–3 common open models, and give the config source for each.

### W3 adds `diagnosticador` and `errores`
**`diagnosticador`:** 14 symptoms, as `{ "symptom", "causes": [ { "cause", "check", "fix" } ] }`. Cover:
- OOM at startup;
- "KV cache too small for max_model_len";
- high TTFT;
- high TPOT;
- preemption warnings;
- truncated answers;
- "context length exceeded";
- a slow cold start;
- streaming that stalls behind a proxy;
- repetitive or garbage output (chat template or sampling);
- low throughput with an idle GPU;
- multi-GPU hangs (NCCL);
- 429s from the gateway;
- a model download that fails (gated repo, token).

**`errores`:** 26 real messages, as `{ "msg", "meaning", "first", "topic" }`. Topics map to sections:

| topic | section |
|---|---|
| conceptos | `que-es` |
| tokens | `tokens` |
| memoria | `memoria` |
| arranque, config | `arrancar` |
| api, cliente | `api` |
| batching | `batching` |
| metricas | `metricas` |
| paralelismo, nccl | `paralelismo` |
| cuantizacion | `cuantizacion` |
| optimizacion | `optimizar` |
| gateway | `gateway-llm` |
| otro | `diagnostico` |

## Section schema and figures
- **Section schema:** the same as the other sheets: `{ id, num, title, question, templates[{code,note}], formulas[], vars[], pieces[], example{title,lang,code,source,notes}, figure{kind,caption,data}, memo, trap, lab{goal,steps[{cmd,expect}],fix,needs,verified}, links[] }`.
  - For shape and depth, see `apps/cheat-sheets/sheets/kubernetes/fuentes/content-w1.json`.
  - Only `memo`, `trap`, `note` and `notes` may contain `<b>`/`<code>`.
- **Figure kinds.** Give clean, short data, to scale where there are numbers.
  - `prefill-decode`: a timeline of one request, with prefill as one big step and decode as many small steps; TTFT and TPOT are marked.
  - `kv-cache`: a GPU memory bar split into weights, KV cache, activations and free space, to scale for C10.
  - `paged`: KV blocks for several sequences spread over the pool, like pages; blocks freed and reused.
  - `continuous`: static batching vs continuous batching, as a step-by-step grid of slots.
  - `tokens`: a sentence split into tokens, Spanish vs English, with counts.
  - `parallel`: TP vs PP vs replicas across GPUs.
  - `latency`: TTFT/TPOT/throughput vs concurrency, from C10's bench fixtures. The README says they are SYNTHETIC, with vLLM v0.30.0's real keys; the caption must say so.
  - `quant`: bytes per parameter and VRAM for FP16/FP8/INT4 for C10's model.
  - `gateway`: client → gateway (auth, quota in tokens, admission, PII) → vLLM pool, streaming back.
  - `chain` and `table`.

## Labs
- **The Mac has no NVIDIA GPU.** Labs that need vLLM on a GPU get `"lab": null` with `lab_omitted`.
- **You may run (never install anything):**
  - stdlib-only Python labs, such as KV-cache math, a continuous-batching simulation, or an OpenAI-compatible mock server that streams SSE with `http.server`, read with curl;
  - C10's own pure-Python tools and tests (`capacity/`, `bench/`, `gateway/`), if an existing venv has what they need. Check `/Users/erikpalacios/Documents/ML_from_scratch/.venv` and `/Users/erikpalacios/Documents/ProyectosPortafolio/Caso1/.venv`, and use them read-only.
- **Marking:** mark what you ran `"executed"` with a `verified_note`.
- **Paths:** labs use `~/lab-vllm` and clean up with `rm -rf ~/lab-vllm`.

## Quality bar, output, report
- **Quality bar:** correct first, then short. Excerpts must match the real files exactly.
- **Do NOT:** run docker, kubectl or aws; install anything; log in anywhere; download models.
- **Output:** one JSON per writer at `/private/tmp/claude-501/-Users-erikpalacios-Documents-ML-from-scratch-ClaudeApss--claude-worktrees-fase-7-ronda-diseno-ml-7020fd/a9dccf86-c43d-47db-95d2-7a59cbb85db1/scratchpad/vllm/content-<writer>.json`, validated with node.
- **Report** (English, brief):
  - what you wrote;
  - the URLs you checked;
  - versions (pinned vs current);
  - anything uncertain.
