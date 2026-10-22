# Brief: "De PyTorch a Triton" (study page + PDF) — content writers

## Goal and learner
- **Learner:** a mechatronics MSc with a computer-vision/PyTorch background (training is their strength) who has never shipped to production.
  - They already have sheets for Docker, Kubernetes, and Git + GitHub Actions, plus an end-to-end map, "Del dato a producción".
  - This sheet covers how a trained PyTorch model becomes a fast, measured service: preparing the model, exporting it to ONNX, checking parity, building a TensorRT engine, the Triton model repository and `config.pbtxt`, dynamic batching, clients (HTTP/gRPC), measuring with `perf_analyzer`, pre/post-processing, optimizations in order of impact, and diagnosis.
  - The target level is the JOB: take a model from a notebook to Triton with the docs open, and diagnose why it's slow, wrong, or doesn't load.
- **Format:** the same as the Docker, Kubernetes and Git sheets.
  - Each section has a "fórmula" (syntax templates with `{placeholders}`, plus real KaTeX formulas where they exist: VRAM, throughput, Little's law, batching), a pieces table, a real example, a figure, "Cómo recordarla", "Trampa", and an optional mini-lab.
  - The web tools at the end are a symptom **diagnosticador**, a **revisor de config.pbtxt** and an error **quiz**.
- **Language:** Spanish (neutral Latin American, tuteo), technical terms in English.
  - Gender-neutral phrasing.
  - Say "el curso". Course labels like C01 or M07 are fine; never invent shorthand codes.

## Style: plain language, same concepts
The learner asked for "lenguaje simple pero mencionando los mismos conceptos".
- **Sentences:** short ones, one idea each, everyday words.
- **New terms:** explain each technical term in plain words the first time it appears in a section, and keep the English term beside it. For example: "un **engine** de TensorRT (el modelo ya compilado para un tipo de GPU concreto: corre rápido, pero solo ahí)".
- **No jargon walls:** no undefined acronyms, no stacked jargon.
- **Analogies:** use correct ones that help memory. For example: dynamic batching is like a bus that waits a few milliseconds to fill up before leaving.
- **Depth:** never drop a concept to make it simpler.
- **Tables:** in `pieces` and `vars`, the "qué hace" column is plain Spanish; the command, flag or field stays exact.

## Sources
App root: `/Users/erikpalacios/Documents/ML_from_scratch/ClaudeApss/.claude/worktrees/fase-7-ronda-diseno-ml-7020fd/apps/ml-system-design`. Cheat sheets: `…/apps/cheat-sheets`.

- **C01 real files (the running example):**
  - `reference/c01/model/export_onnx.py`, `parity_check.py`, `build_engine.sh`, `requirements.txt`;
  - `reference/c01/triton/Dockerfile`, `reference/c01/triton/model_repository/classifier/config.pbtxt`;
  - `reference/c01/gateway/app/main.py` and `preprocess.py` (the client side and preprocessing);
  - `reference/c01/README.md` (lines 55–67: the order export → parity ORT → engine on a T4 → image → parity on Triton);
  - `reference/c01/k8s/triton.yaml` (ports, probes).
- **Course:**
  - M07 servidores de modelos (`js/content/m07-servidores.js`), M08 optimización (`m08-optimizacion.js`), M04 hardware (`m04-hardware.js`), M03 latencia/throughput/capacidad;
  - C01 `serving`, `estimaciones` and `evaluacion` (parity) in `c01-clasificacion.js` and `c01-archivos.js`;
  - `ref-comandos.js`, `ref-numeros.js`.
  - Other cases that serve models (c05 OCR, c07 search, c10 vLLM) only if useful.
- **Consistency with the existing sheets.** Read them and don't contradict them.
  - `apps/cheat-sheets/sheets/recorrido/fuentes/content-w1.json`: stations `export` and `serving`, and the `onnx`, `tensorrt`, `triton` and `pytorch` cards. These are already fact-checked. Settled there:
    - TensorRT 10.3 ships in NGC 24.08, which C01 uses;
    - an engine is tied to the GPU type and the TensorRT version;
    - compatibility modes are opt-in;
    - TensorRT 11 removed `--fp16` from trtexec;
    - the ONNX file is ≈ 98 MB;
    - parity thresholds come from `parity_check.py`;
    - `parity_check.py` needs `--checkpoint`.
  - `apps/cheat-sheets/sheets/estimaciones/` (the formula sheet: VRAM, GPUs and latency budget). Link to it rather than repeating it.
- **Course anchors:** `#<page>.<section-id>`. Only use ids that exist.
- **Verify every API, flag, field, default and message against official docs.** Load WebSearch and WebFetch with ToolSearch `select:WebSearch,WebFetch`. Sources:
  - pytorch.org (torch.onnx export, dynamo export, inference_mode);
  - onnx.ai and onnxruntime.ai;
  - NVIDIA TensorRT docs and the trtexec reference (note the version: C01 uses 10.3, and the current one is 11.x);
  - NVIDIA Triton docs: model repository, model configuration, dynamic batcher, instance groups, HTTP/gRPC and the KServe v2 protocol, health endpoints, metrics, perf_analyzer, model analyzer;
  - the tritonclient Python docs.

  It is October 2026, so check the current versions. When C01's pinned versions (Triton 24.08, TensorRT 10.3, torch 2.14.0) differ from the current ones, say which one each fact applies to.
- **Never invent APIs, flags, defaults, metrics names or messages.** If unsure, say so or leave it out.

## Settled facts
Verify them; report any that is wrong, and use the verified value.
- **Ports:** Triton's defaults are HTTP 8000, gRPC 8001 and metrics 8002. Health is at `/v2/health/ready` and `/v2/health/live`; per model, `/v2/models/{name}/ready`.
- **Model repository layout:** `<repo>/<model>/config.pbtxt` and `<repo>/<model>/<version>/model.plan` (TensorRT), or `model.onnx` (ONNX Runtime backend).
- **`max_batch_size` > 0** means the first dimension is the batch and isn't listed in `dims`. With `max_batch_size: 0` there is no batching.
- **Dynamic batching:** `preferred_batch_size` and `max_queue_delay_microseconds` trade latency for throughput. Take C01's values from `config.pbtxt`.
- **An engine works only on the GPU type (compute capability) and TensorRT version it was built for,** unless you opt into a compatibility mode, which is slower. C01 builds on a T4 with the same NGC release as Triton.
- **Bytes per parameter:** FP32 4, FP16 2, INT8 1.
- **The T4** has 16 GB of VRAM. Take other specs from NVIDIA's data sheet.

## The sections (fixed ids and numbers)
| num | id | Section | Writer |
|---|---|---|---|
| 0 | `bolsillo` | Números de bolsillo: precisión y bytes, VRAM, la T4, puertos y rutas de Triton, fórmulas de latencia y throughput | W1 |
| null | `cadena` | La cadena: del checkpoint a una respuesta medida | W1 |
| 1 | `serving` | Qué es servir un modelo (y por qué `model(x)` dentro de FastAPI no basta) | W1 |
| 2 | `pytorch` | Preparar el modelo en PyTorch: eval, inference_mode, preprocesamiento idéntico, determinismo | W1 |
| 3 | `onnx` | Exportar a ONNX: dynamo, opset, ejes dinámicos, checker, ONNX Runtime | W1 |
| 4 | `paridad` | Paridad: el modelo servido no es el evaluado (top-1, Δlogit, FP16) | W1 |
| 5 | `tensorrt` | TensorRT: qué es, trtexec, precisión, perfiles de optimización, portabilidad del engine | W2 |
| 6 | `repositorio` | El model repository y `config.pbtxt` | W2 |
| 7 | `batching` | Dynamic batching, instancias y concurrencia | W2 |
| 8 | `clientes` | Clientes: HTTP, gRPC, protocolo v2, health y metadata, tritonclient | W2 |
| 9 | `medir` | Medir: perf_analyzer, métricas de Triton, uso de GPU | W2 |
| 10 | `prepost` | Pre y postprocesamiento: dónde va (gateway, ensemble, backend de Python) y el riesgo de skew | W3 |
| 11 | `optimizar` | Optimizaciones en orden de impacto, y la alternativa sin GPU (ONNX Runtime en CPU) | W3 |
| 12 | `diagnostico` | Diagnóstico: el método y la tabla de síntomas | W3 |
| 13 | `errores` | Errores que debes reconocer rápido (export, TensorRT, Triton, CUDA) | W3 |

## Extra keys
**W2 adds `revisor`:** 14–18 rules for a `config.pbtxt` reviewer that runs in the browser. The builder writes a small parser for protobuf text format (`key: value`, nested `key { … }`, lists `[ … ]`, repeated blocks, `#` comments). Each rule looks like this:
```
{ "id": "dims-incluye-batch", "severity": "error|warn|info",
  "check": "precise rule the builder can implement over the parsed config object",
  "message": "aviso corto", "why": "por qué importa, simple", "fix": "1 frase",
  "example_bad": "config mínima que la dispara", "example_good": "config mínima que no" }
```
- Cover at least these cases:
  - `max_batch_size` > 0 while `dims` repeats a batch dimension;
  - `dynamic_batching` with `max_batch_size` 0;
  - a `preferred_batch_size` larger than `max_batch_size`;
  - a `max_queue_delay_microseconds` too big for an online SLO (use a threshold from C01's latency budget and explain it);
  - `platform`/`backend` not matching the model file (when `default_model_filename` is given);
  - `instance_group` `KIND_GPU` with a count greater than what fits in memory (info);
  - a missing `instance_group` (default behavior explained);
  - `data_type` names that are not valid `TYPE_*`;
  - a string output without `TYPE_STRING`;
  - a missing `name` vs. the folder name (info);
  - `version_policy` with `latest` keeping several versions loaded (VRAM);
  - no `model_warmup` for a TensorRT model with a cold-start SLO (info);
  - `optimization` / `cuda` graphs considerations (info, only if correct).
- C01's real `config.pbtxt` must give **0 findings**. Reason each rule against it, and record your reasoning in your scratch folder.

**W3 adds `diagnosticador`:** 14 symptoms, each `{ "symptom", "causes": [ { "cause", "check", "fix" } ] }`. Cover:
- model won't load;
- `UNAVAILABLE`/not ready;
- shape or dtype mismatch;
- outputs differ from PyTorch (parity fails);
- high p99 with low GPU use;
- GPU at 100 % but low throughput;
- CUDA OOM;
- an engine that worked yesterday fails today (driver/TensorRT/GPU change);
- an export that fails;
- slow first request (cold start/warmup);
- batching not happening;
- gRPC vs HTTP slower than expected;
- CPU preprocessing bottleneck;
- an accuracy drop only in FP16/INT8.

**W3 also adds `errores`:** 26 real messages, each `{ "msg", "meaning", "first", "topic" }`. Topics map to sections:

| topic | section |
|---|---|
| pytorch | `pytorch` |
| export | `onnx` |
| paridad | `paridad` |
| tensorrt, engine | `tensorrt` |
| config, repositorio | `repositorio` |
| batching | `batching` |
| cliente | `clientes` |
| rendimiento | `medir` |
| prepost | `prepost` |
| cuda, otro | `diagnostico` |

## Section schema and figures
The section schema is the same as the other sheets: `{ id, num, title, question, templates[{code,note}], formulas[] (KaTeX, only real formulas), vars[], pieces[], example{title,lang,code,source,notes}, figure{kind,caption,data}, memo, trap, lab{goal,steps[{cmd,expect}],fix,needs,verified}, links[] }`. Read `apps/cheat-sheets/sheets/kubernetes/fuentes/content-w1.json` for the exact shape and depth. Only `memo`, `trap`, `note` and `notes` may contain `<b>`/`<code>`.

Figure kinds; give clean, short data, to scale where there are numbers:
- `pipeline`: checkpoint → ONNX → engine → repository → server → client, with what each step checks;
- `graph`: a model graph before and after optimization (layer fusion, precision);
- `precision`: bytes per parameter and VRAM bars for FP32, FP16 and INT8, using C01's model;
- `repo`: the model repository folder tree;
- `batching`: a timeline of requests arriving, the queue delay window, and the batch dispatched (latency vs throughput);
- `instances`: GPU(s) with model instances and how requests are spread;
- `protocol`: client → HTTP/gRPC endpoints (health, metadata, infer) → server;
- `perf`: a latency-vs-concurrency or throughput-vs-concurrency curve (to scale, with data you can justify from the course or clearly labelled illustrative);
- `prepost`: where pre/post-processing can live (gateway CPU, ensemble, Python backend, DALI) with pros and cons;
- `chain` and `table`: as in the other sheets.

## Labs
The Mac has no NVIDIA GPU, so TensorRT and GPU Triton can't run on it.
- **CPU-only labs are fine:** export a small torchvision model to ONNX and compare with ONNX Runtime on CPU in a venv (the learner installs torch, onnx and onnxruntime themselves), or run Triton's ONNX Runtime backend on CPU in Docker, only if the image really supports the Mac's arm64 and you can verify it.
- **Omit labs that need a GPU:** set `"lab": null` with `"lab_omitted": "<reason>"`.
- Mark `"verified": "docs"`, or `"executed"` if you actually ran it.
- **Using an existing Python environment:** if one with torch, onnx and onnxruntime already exists on this Mac (for example the repo's own `.venv` under `/Users/erikpalacios/Documents/ML_from_scratch`), you may use it to check outputs. Never install anything.

## Quality bar, output, report
- **Quality:** correct first, then short. Exact excerpts from the real files.
- **Do NOT:**
  - run docker, kubectl or aws;
  - install anything;
  - log in anywhere.
- **Output:** one JSON file per writer at `/private/tmp/claude-501/-Users-erikpalacios-Documents-ML-from-scratch-ClaudeApss--claude-worktrees-fase-7-ronda-diseno-ml-7020fd/a9dccf86-c43d-47db-95d2-7a59cbb85db1/scratchpad/triton/content-<writer>.json`, validated with node.
- **Report:** in English, briefly:
  - what you wrote;
  - the URLs you checked;
  - which versions each fact applies to;
  - anything uncertain.
