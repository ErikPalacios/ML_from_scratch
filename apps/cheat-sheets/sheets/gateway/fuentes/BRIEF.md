# Brief: "El gateway: FastAPI en producción" (study page + PDF) — content writers

## Goal and learner
- **Learner:** a mechatronics MSc with a computer-vision/PyTorch background who has never shipped to production.
  - Sheets they already have: Docker, Kubernetes, Git + GitHub Actions, "De PyTorch a Triton" (the model server) and an end-to-end map, "Del dato a producción".
  - This sheet covers **the API they will write themselves**: the gateway that sits between clients and the model server.
  - Topics: FastAPI basics, async vs threads, validation and the API contract, calling the model server (timeouts, retries), backpressure and admission control, errors and graceful degradation, health/readiness and shutdown, observability, tests, performance, diagnosis.
  - Target level is the JOB: write a production gateway from scratch with the docs open, and diagnose why it's slow, returns 503s, or blocks.
- **Format:** the same as the other sheets.
  - Each section has a "fórmula" (syntax templates with `{placeholders}`, plus real KaTeX formulas where they exist: Little's law for in-flight requests, timeout budgets, retry amplification), a pieces table, a real example, a figure, "Cómo recordarla", "Trampa", and an optional mini-lab.
  - Web tools at the end: a symptom **diagnosticador**, a **revisor de código del gateway** (heuristic Python rules) and an error **quiz**.
- **Language:** Spanish (neutral Latin American, tuteo), technical terms in English, gender-neutral. Say "el curso"; course labels like C01/M07 are fine; never invent shorthand codes.

## Style: plain language, same concepts
The learner asked for "lenguaje simple pero mencionando los mismos conceptos".
- **Short sentences**, one idea each, everyday words.
- **Explain each technical term** in plain words the first time it appears in a section, and keep the English term beside it. Example: "el **event loop** (el único hilo que atiende todas las requests `async` por turnos: si una se queda bloqueada, se detienen todas)".
- **No undefined acronyms** and no stacked jargon.
- **Analogies** only when they are correct and help memory. Example: admission control is the doorman who says "lleno, vuelve en un momento" instead of letting everyone in until the place collapses.
- **Never drop concepts** to simplify.
- **Tables:** in `pieces` and `vars`, the "qué hace" column is plain Spanish; the code or field stays exact.

## Sources
- **App root:** `~/Documents/ML_from_scratch/ClaudeApss/.claude/worktrees/fase-7-ronda-diseno-ml-7020fd/apps/ml-system-design`. Cheat sheets: `…/apps/cheat-sheets`.
- **C01 gateway real files (the running example):** `reference/c01/gateway/app/main.py`, `app/preprocess.py`, `app/labels.json`, `tests/test_api.py`, `pytest.ini`, `requirements.txt`, `requirements-dev.txt`, `Dockerfile`, `.dockerignore`. Also `reference/c01/k8s/gateway.yaml` (probes, preStop, resources) and `reference/c01/README.md`.
  - Quote exact short excerpts.
  - Use the versions pinned in `requirements.txt`, and say when the current version differs.
- **Course:**
  - C01 (`c01-clasificacion.js`, `c01-archivos.js`):
    - `arquitectura`: el camino de un request; por qué existe cada tier;
    - `serving`: timeouts, reintentos y backpressure; HTTP o gRPC; contrato de API y versionado; seguridad;
    - `fallas`: escalera de degradación;
    - `monitoreo`: logging, golden signals.
  - M07 (servidores), M03 (latencia, throughput, Little's law), M11 (despliegue), M12 (monitoreo), M15 (seguridad), `ref-comandos.js`.
- **Consistency with the existing sheets.** Read them; don't contradict them.
  - `apps/cheat-sheets/sheets/recorrido/fuentes/content-w2.json`: the `request` station (latency budget per hop) and the `fastapi`, `pytest` and `opentelemetry` cards; `content-w1.json`: the `serving` station.
  - `apps/cheat-sheets/sheets/triton/fuentes/content-w2.json` (`clientes`: health codes, binary data, tritonclient) and `content-w3.json` (`prepost`).
  - `apps/cheat-sheets/sheets/kubernetes/fuentes/content-w2.json` (`probes`: grace 45 s, preStop 15 s → 30 s for the app).
  - `apps/cheat-sheets/sheets/docker/fuentes/content-w2.json` (`pid1`: uvicorn as PID 1, SIGTERM, exec form).
- **Course anchors:** `#<page>.<section-id>`. Only use ids that exist.
- **Verification:** check every API, default, status code and message against the official docs. Load WebSearch and WebFetch with ToolSearch `select:WebSearch,WebFetch`.
  - fastapi.tiangolo.com: lifespan, dependencies, UploadFile, background tasks, testing, async;
  - docs.pydantic.dev (v2);
  - starlette.io;
  - uvicorn.dev: settings, timeouts, workers, graceful shutdown;
  - python-httpx.org: timeouts, limits, AsyncClient;
  - docs.python.org: asyncio, `to_thread`, concurrency;
  - prometheus_client and OpenTelemetry Python docs;
  - the tritonclient source;
  - RFC 9110 for HTTP status semantics, and RFC 6585 for 429.

  It is October 2026: check the current versions. Never invent APIs, defaults or messages; if unsure, say so or leave it out.

## Settled facts
Verify them. If one is wrong, report it and use the verified value.
- **The event loop:** a blocking call inside `async def` (sync I/O, `time.sleep`, CPU-heavy image decode) stalls every request on that worker. A plain `def` endpoint runs in a threadpool, and so does `run_in_threadpool` / `asyncio.to_thread`. Starlette's default threadpool size is 40 tokens (verify).
- **C01's admission control:** a 16 in-flight limit, and what it returns when full. Take the exact status and headers from `main.py`.
- **C01's timeouts toward Triton:** take them from `main.py`/C01; don't invent them.
- **Status codes:**
  - 422 = validation error (FastAPI's default for request validation);
  - 413 = payload too large;
  - 415 = unsupported media type;
  - 429 = rate limit (per client);
  - 503 = temporarily unavailable or overloaded (with Retry-After);
  - 504 = upstream timeout at a gateway;
  - 502 = bad upstream response.

  Follow what C01 actually returns, and explain any difference.
- **Graceful shutdown:** consistent with the Docker and Kubernetes sheets (preStop 15 s, grace 45 s, app 30 s, `--timeout-graceful-shutdown`). Take the exact values from the C01 Dockerfile and gateway.yaml.
- **Retries** only for idempotent or safe requests, with backoff and jitter, and a total deadline. Retry amplification across layers: say it plainly.

## The sections (fixed ids and numbers)
| num | id | Section | Writer |
|---|---|---|---|
| 0 | `bolsillo` | Números de bolsillo: códigos HTTP, timeouts, límites del gateway del C01, Little's law | W1 |
| null | `cadena` | La cadena: el viaje de un request dentro del gateway (uvicorn → middleware → ruta → validación → admisión → preproceso → Triton → respuesta → logs y métricas) | W1 |
| 1 | `gateway` | Qué hace un gateway y por qué existe (separar CPU de GPU, el contrato, seguridad, degradación) | W1 |
| 2 | `fastapi` | FastAPI básico: app, rutas, modelos de Pydantic, response_model, códigos, dependencias, lifespan | W1 |
| 3 | `async` | async contra hilos: event loop, async def contra def, trabajo bloqueante, threadpool, workers y GIL | W1 |
| 4 | `contrato` | Validación y contrato: Pydantic v2, uploads con límite, 400/413/415/422, versionar la API, OpenAPI | W1 |
| 5 | `upstream` | Llamar al servidor de modelos: cliente async reutilizado, pool de conexiones, timeouts, reintentos con backoff y jitter, deadline | W2 |
| 6 | `backpressure` | Backpressure y control de admisión: límite de requests en vuelo, 429 contra 503 + Retry-After, load shedding, Little's law | W2 |
| 7 | `degradacion` | Errores y degradación: mapear errores a códigos, la escalera de degradación del C01, no filtrar detalles internos | W2 |
| 8 | `salud` | Health, readiness y apagado ordenado: liveness contra readiness, warmup en lifespan, SIGTERM y drenado (coherente con Docker y Kubernetes) | W2 |
| 9 | `observabilidad` | Observabilidad: una línea JSON por request, request ID, métricas de Prometheus (histogramas), trazas de OpenTelemetry, qué no loguear | W2 |
| 10 | `tests` | Tests: pytest, TestClient y AsyncClient, el fake de Triton del C01, probar timeouts y errores, pruebas de carga | W3 |
| 11 | `rendimiento` | Rendimiento: workers de uvicorn, CPU para el decode, keep-alive, perfilar (py-spy), medir el p99 | W3 |
| 12 | `diagnostico` | Diagnóstico: el método y la tabla de síntomas | W3 |
| 13 | `errores` | Errores que debes reconocer rápido (FastAPI, Pydantic, uvicorn, httpx o tritonclient, asyncio) | W3 |

## Extra keys
### W1 adds `revisor`
14–18 heuristic rules for a gateway code reviewer that runs in the browser on Python source.
- **How it works:** the builder writes a small line-based scanner. It finds function blocks by `def` / `async def` and their indentation, finds route decorators (`@app.get`, `@app.post`, `@router.*`), and finds module scope. Each rule then applies a regex to lines within its scope:
```
{ "id": "sleep-en-async", "severity": "error|warn|info", "scope": "async_def|route|any_def|module|file",
  "pattern": "JS regex source", "flags": "", "not_pattern": "optional regex that suppresses a match on the same line",
  "check": "plain description of the rule, precise",
  "message": "aviso corto", "why": "por qué importa, simple", "fix": "1 frase",
  "example_bad": "código mínimo que la dispara", "example_good": "código mínimo que no" }
```
- **Cover:**
  - blocking calls inside `async def` (`time.sleep`, `requests.`, sync file or socket I/O, heavy PIL/cv2 decode without a threadpool);
  - HTTP clients without a timeout;
  - a client created per request;
  - deprecated `@app.on_event`;
  - `detail=str(e)` leaking internals;
  - bare or swallowed `except`;
  - `print` instead of logging;
  - reading a whole `UploadFile` with no size limit;
  - `reload=True`;
  - CORS `allow_origins=["*"]` with credentials;
  - a 500 for an upstream timeout;
  - and so on.
- **0 findings on C01:** the rules must give 0 findings on C01's `main.py` and `preprocess.py`. Test them yourself with a small JS or Python harness in your scratch folder, and report the results.

### W3 adds `diagnosticador` and `errores`
**`diagnosticador`:** 14 symptoms in the form `{ "symptom", "causes": [ { "cause", "check", "fix" } ] }`. Cover:
- the p99 goes up but the GPU sits idle;
- bursts of 503;
- a flood of 422;
- every request slows down at once (a blocked event loop);
- memory grows;
- timeouts toward Triton;
- 499s or client disconnects;
- slow responses after a deploy;
- readiness flapping;
- shutdown drops requests;
- logs with no request ID;
- metrics show no latency;
- it works locally but not in the container;
- uploads rejected.

**`errores`:** 26 real messages in the form `{ "msg", "meaning", "first", "topic" }`. Topics map to sections:

| topic | section |
|---|---|
| fastapi | `fastapi` |
| async | `async` |
| validacion | `contrato` |
| upstream, timeout | `upstream` |
| carga | `backpressure` |
| error | `degradacion` |
| salud, apagado | `salud` |
| logs, metricas | `observabilidad` |
| tests | `tests` |
| rendimiento | `rendimiento` |
| otro | `diagnostico` |

## Section schema and figures
- **Schema:** the same as the other sheets: `{ id, num, title, question, templates[{code,note}], formulas[], vars[], pieces[], example{title,lang,code,source,notes}, figure{kind,caption,data}, memo, trap, lab{goal,steps[{cmd,expect}],fix,needs,verified}, links[] }`.
  - See `apps/cheat-sheets/sheets/kubernetes/fuentes/content-w1.json` for the exact shape and depth.
  - Only `memo`, `trap`, `note` and `notes` may contain `<b>` or `<code>`.
- **Figure kinds** (give clean, short data, to scale where there are numbers):
  - `request-path`: the request's journey through the gateway with time per step (C01 budget);
  - `event-loop`: a timeline of the single loop interleaving awaits vs one blocking call stalling everyone;
  - `threads`: event loop + threadpool + workers (processes);
  - `status`: a decision tree of which HTTP code to return;
  - `timeouts`: nested budgets (client > gateway > Triton) and retries with backoff and jitter;
  - `admission`: in-flight slots, a full sign, 503 + Retry-After, a queue vs shedding;
  - `degradation`: C01's degradation ladder;
  - `shutdown`: the SIGTERM → drain → exit timeline aligned with preStop and grace;
  - `observability`: one request → log line + metrics + trace spans;
  - `chain` and `table`.

## Labs
- **Python on the Mac:** the learner can create a venv and `pip install` FastAPI/uvicorn/httpx themselves, so labs may use them. Mark these `"verified": "docs"` unless you really ran them.
- **No installs for you:**
  - You must NOT install anything.
  - You may run stdlib-only Python (asyncio demos of a blocking call vs await, Little's law math) with the system `python3`, or with the repo's `.venv` at `~/Documents/ML_from_scratch/.venv` if it has what you need.
  - If you ran it, mark it `"executed"` with a `verified_note`.
- **Cleanup:** labs use `~/lab-gateway` and clean up with `rm -rf ~/lab-gateway`.

## Quality bar, output, report
- **Quality:** correct first, then short. Use exact excerpts from the real files.
- **Do NOT:**
  - run docker, kubectl or aws;
  - install anything;
  - log in anywhere.
- **Output:** one JSON per writer at `/private/tmp/claude-501/-Users-USER-Documents-ML-from-scratch-ClaudeApss--claude-worktrees-fase-7-ronda-diseno-ml-7020fd/a9dccf86-c43d-47db-95d2-7a59cbb85db1/scratchpad/gateway/content-<writer>.json`, validated with node.
- **Report** (English, brief):
  - what you wrote;
  - the URLs you checked;
  - versions (pinned vs current);
  - anything uncertain.
