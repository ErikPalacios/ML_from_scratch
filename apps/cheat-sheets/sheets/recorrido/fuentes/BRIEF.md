# Brief: "Del dato a producción" (study page + PDF) — content writers

## Goal and learner
- **Learner:** mechatronics MSc with CV/PyTorch who has never shipped to production. They are going through the course "Ronda de Diseño ML" but haven't seen every module yet.
  - In their words: "siento que tengo todas las piezas regadas en la cabeza".
  - They want ONE coherent picture: from getting the data, step by step, until the system is operating (training → server → packaging → Kubernetes → …), with figures that help remember the processes.
- **For every platform or tool, explain two things:**
  - what it is;
  - **how you work with it**: do you **PROGRAM** it (write code), **CONFIGURE** it (write declarative files: YAML, config), **OPERATE** it (commands or a UI), or is it a **MANAGED** cloud service you rent and configure?

  Until recently the learner didn't know what Kubernetes was, or whether it is programmed or configured. Write for that person.
- **Language:** Spanish (neutral Latin American, tuteo), technical terms in English.
  - Direct and short, always the why. Gender-neutral phrasing.
  - Say "el curso". Course labels like C01 or M05 are fine; never invent shorthand codes.
- **Format:** the same family as two existing sheets ("Formulario de estimaciones" and "Cheat sheet de Docker"): a web page plus a printable PDF. A builder draws every figure from your data, so give it clean, short data.

## The page (for context; you write only your part)
1. Hero, plus how to read the page.
2. **The full map of C01:** a "metro map" with 12 stations in 4 stretches (Datos → Modelo → Release → Operación) and the artifact that passes from one station to the next. Retraining closes the loop.
3. **The 4 speeds:**
   - the same map split into 4 colored lines: **semanas** (model), **días** (code release), **milisegundos** (one request) and **continuo** (operation);
   - the transfer stations where the lines meet.
4. **12 station sections (zoom).** Each one has:
   - a step-by-step process figure;
   - real C01 files;
   - key commands;
   - what fails there;
   - "lista cuando…";
   - **platform cards** for the tools used at that station.
5. **"¿Se programa, se configura o se opera?":** every tool in one figure, by how you work with it. Built from the platform cards.
6. **4 patterns in depth:** batch (C14), LLM/RAG (C11), streaming (C13) and edge (C03), compared with C01, showing which stations disappear, change or appear.
7. **One mini-map per case** (C02 to C15), grouped by pattern.
8. **Quiz "¿En qué estación falló?":** a symptom, then the station and the first check.

## Sources
App root: `/Users/erikpalacios/Documents/ML_from_scratch/ClaudeApss/.claude/worktrees/fase-7-ronda-diseno-ml-7020fd/apps/ml-system-design`

Course content is in `js/content/*.js`, as `MSD.register` calls with sections and blocks. You can grep the files or load them in node with `vm`, the way `tools/validate-content.mjs` does.

- **C01** (`c01-clasificacion.js`), with its sections:
  - `arquitectura`: Día 1, arquitectura objetivo, el camino de un request, por qué existe cada tier;
  - `datos`: fuentes de datos y labels, etiquetado, versionado y linaje, pipeline de entrenamiento, gate de evaluación, registry, aliases y cadencia;
  - `serving`;
  - `evaluacion`: offline, parity, shadow/canary/A-B, cómo se enruta cada versión;
  - `monitoreo`: golden signals, métricas de modelo y datos, alertas, dashboards, logging, reentrenamiento y promoción;
  - `fallas`;
  - `archivos` (in `c01-archivos.js`): a map of which file implements which part.
- **C01 real files:** `reference/c01/`, which has `gateway/`, `model/` (export_onnx.py, build_engine.sh, parity_check.py), `triton/`, `k8s/` (gateway.yaml, triton.yaml, keda-triton.yaml, monitoring.yaml), `monitoring/` (prometheus.yml, alerts.yml), `docker-compose.yml` and `README.md`.
  - The reference code starts at the trained model. For data and training, use what C01's `datos` section says, and mark it as described by the course (`"real": false`); never invent file contents.
- **Modules:**
  - m01 (ciclo de vida); m05 contenedores; m06 orquestación; m07 servidores;
  - m08 optimización; m09 datos; m10 mlops; m11 despliegue; m12 monitoreo; m13 nube;
  - m14 llms (W3).
- **References:** `ref-herramientas.js` (tools per category; use the course's picks) and `ref-comandos.js`.
- **Other cases:** `c02-…c15-*.js` and their `-archivos.js`, plus `docs/SPEC.md` §8 (shared facts per case) and `catalog.js` (the `pattern` field per case).
- **Verify tool claims against official docs.** Load WebSearch and WebFetch with ToolSearch `select:WebSearch,WebFetch`. Sources include kubernetes.io, keda.sh, NVIDIA Triton and TensorRT, mlflow.org, argoproj.github.io, prometheus.io, docs.github.com (Actions), AWS docs (S3, ECR, EKS, ALB), dvc.org, lakefs.io and labelstud.io.
  - If the course and the docs disagree, follow the docs, keep the wording close to the course, and report the disagreement.
  - Never invent flags, file names, defaults or numbers. If unsure, say so or leave it out.
- **Course anchors:** `#<page>.<section-id>`. Only use ids that exist.

## The 12 stations (fixed ids; everyone uses them)
| # | id | Estación | Tramo | Velocidad |
|---|---|---|---|---|
| 1 | `datos` | Datos y etiquetas | Datos | semanas |
| 2 | `versionado` | Versionado y linaje | Datos | semanas |
| 3 | `entrenamiento` | Entrenamiento | Modelo | semanas |
| 4 | `gate` | Gate de evaluación y registry | Modelo | semanas |
| 5 | `export` | Export, engine y paridad | Modelo | semanas |
| 6 | `serving` | Código de serving | Release | días |
| 7 | `empaquetado` | Empaquetado (Docker) | Release | días |
| 8 | `cicd` | CI/CD y registro de imágenes | Release | días |
| 9 | `kubernetes` | Kubernetes | Operación | días |
| 10 | `rollout` | Rollout seguro | Operación | días |
| 11 | `request` | La request en vivo | Operación | milisegundos |
| 12 | `monitoreo` | Monitoreo y reentrenamiento | Operación | continuo |

You may refine a title to match C01's wording, but keep the id, order, tramo and velocity. If C01 really does something in a different order (for example, the engine is built inside the release pipeline), keep the station and say where it actually happens.

**Transfer stations**, where the lines meet:
- `registro-modelos`: the model registry. The model line hands a version to the release line.
- `registro-imagenes`: the image registry (ECR). The release line hands an image to the cluster.
- `cluster`: EKS. Release, request and operation all happen here.
- `datos`: operation sends new labels and drift back to the model line.

## Platform cards (canonical ids; W1 and W2 write them)
The `work` field uses `programa`, `configura`, `opera` or `administrado`: a `main` value plus optional `also` values.

| id | Tool (as the course names it) | Writer | Station(s) |
|---|---|---|---|
| `s3` | Amazon S3 | W1 | datos, versionado (and where artifacts live) |
| `label-studio` | Label Studio | W1 | datos |
| `dvc-lakefs` | DVC / lakeFS | W1 | versionado |
| `orquestador` | the training-pipeline orchestrator C01 names (Airflow, Kubeflow or SageMaker Pipelines: check C01) | W1 | entrenamiento |
| `pytorch` | PyTorch | W1 | entrenamiento |
| `mlflow` | MLflow (tracking + model registry) | W1 | entrenamiento, gate |
| `onnx` | ONNX | W1 | export |
| `tensorrt` | TensorRT | W1 | export |
| `triton` | NVIDIA Triton Inference Server | W1 | serving (also kubernetes, request) |
| `fastapi` | FastAPI + Uvicorn | W1 | serving |
| `pytest` | pytest | W1 | serving (also cicd) |
| `docker` | Docker (+ docker compose) | W2 | empaquetado |
| `git` | Git / GitHub | W2 | cicd |
| `github-actions` | GitHub Actions (or whatever CI the course uses) | W2 | cicd |
| `ecr` | Amazon ECR | W2 | cicd |
| `kubernetes` | Kubernetes (Amazon EKS) + kubectl | W2 | kubernetes |
| `alb` | AWS Load Balancer (ALB, via Ingress) | W2 | kubernetes, request |
| `autoscaling` | HPA / KEDA | W2 | kubernetes |
| `gpu-k8s` | NVIDIA device plugin / GPU Operator | W2 | kubernetes |
| `argo-rollouts` | Argo Rollouts (or what C01 uses for canary) | W2 | rollout |
| `prometheus` | Prometheus + Alertmanager | W2 | monitoreo |
| `grafana` | Grafana | W2 | monitoreo |
| `opentelemetry` | OpenTelemetry | W2 | request, monitoreo |

If C01 or the course clearly uses a different tool for a role, use that one, keep the id, and report it. Drop a card only if the course never uses that role.

## Icons
Suggest one per step or chip from this list:

`data`, `image`, `label`, `version`, `pipeline`, `train`, `gpu`, `chart`, `gate`, `registry`, `export`, `engine`, `code`, `test`, `container`, `build`, `push`, `image-registry`, `cluster`, `pod`, `autoscale`, `balancer`, `rollout`, `request`, `user`, `server`, `monitor`, `alert`, `log`, `drift`, `retrain`, `cloud`, `file`, `database`, `queue`, `stream`, `device`, `llm`, `search`, `clock`, `lock`

## Output
Write ONE JSON file (UTF-8) per writer at `/private/tmp/claude-501/-Users-erikpalacios-Documents-ML-from-scratch-ClaudeApss--claude-worktrees-fase-7-ronda-diseno-ml-7020fd/a9dccf86-c43d-47db-95d2-7a59cbb85db1/scratchpad/pipeline/content-<writer>.json`. Validate it with `node -e "JSON.parse(require('fs').readFileSync('<file>','utf8'))"`.

### W1 and W2: `{ "stations": [Station…], "platforms": [Platform…] }`
```
Station {
  "id": "export", "num": 5, "title": "Export, engine y paridad",
  "question": "¿Cómo pasa el modelo de PyTorch a algo que Triton sirve rápido?",          // one line
  "summary": "2–3 sentences: what happens here in C01 and why",
  "in":  ["checkpoint registrado en MLflow (alias candidato)"],                         // artifacts that enter (short)
  "out": ["model.onnx", "engine TensorRT (model.plan)", "reporte de paridad"],          // artifacts that leave; out[0] is drawn on the map
  "steps": [ { "label": "Exportar a ONNX", "detail": "one line", "icon": "export",
               "who": "MLE | data engineer | plataforma/SRE | automático (CI) | etiquetadores",
               "where": "dónde corre: tu Mac, job de CI, nodo GPU, servicio de AWS…" } ],   // 4–7 steps: the process figure
  "files": [ { "path": "reference/c01/model/export_onnx.py", "real": true, "what": "qué hace",
               "excerpt": "≤ 12 líneas reales", "lang": "python|yaml|dockerfile|bash|text|protobuf" } ],
                                                         // "real": false → a description of what the course says exists; no excerpt
  "commands": [ { "code": "python export_onnx.py --out {ruta_onnx}", "note": "one line" } ],  // only real ones; {placeholders} for variables
  "fails": [ { "symptom": "lo que ves", "cause": "por qué pasa", "check": "primer comando o chequeo" } ],   // 3–5
  "done": ["“lista cuando…” item"],                     // 3–5 exit criteria
  "memo": "Cómo recordarla: 1–2 sentences (may contain <b> and <code>)",
  "trap": "Trampa: 1–2 sentences",
  "platforms": ["onnx", "tensorrt"],                    // ids of the cards used here
  "links": ["#c01.evaluacion", "#m08.<id>"]
}
Platform {
  "id": "kubernetes", "name": "Kubernetes (Amazon EKS)", "category": "orquestación de contenedores",
  "what": "qué es en una línea, sin jerga",
  "analogy": "analogía corta y correcta (opcional)",
  "in_c01": "qué hace en el C01, concreto",
  "work": { "main": "configura", "also": ["opera", "administrado"] },
  "how": "2–3 frases: qué escribes tú, qué hace la herramienta sola, con qué la operas",
  "example": { "lang": "yaml", "code": "≤ 10 líneas, reales del C01 cuando se pueda", "source": "reference/c01/k8s/gateway.yaml (extracto)" },
  "runs": "dónde corre",
  "alternatives": "opcional: alternativas que menciona el curso",
  "links": ["#m06.objetos-basicos"]
}
```

### W3: `{ "patterns": [Pattern…], "cases": [Case…] }`
```
Pattern {
  "id": "batch", "name": "Batch", "case": "c14", "title": "Pronóstico de demanda (C14)",
  "summary": "2–3 sentences: how the whole picture changes and why",
  "changes": [ { "station": "<one of the 12 ids>", "status": "igual|cambia|desaparece", "note": "one line" } ],   // all 12
  "new": [ { "title": "estación nueva", "after": "<station id>", "note": "one line", "icon": "…" } ],
  "line": [ { "label": "paso", "icon": "…" } ],     // the pattern's own line, 6–9 steps, for a mini metro line
  "speeds": "which speeds exist and at what rhythm (e.g., batch: no milliseconds line; the cycle is nightly)",
  "links": ["#c14.<id>", "#m02.<id>"]
}
Case {
  "id": "c02", "title": "…", "pattern": "edge",
  "one_liner": "what it is, in one line",
  "map": { "datos": ["chip"], "modelo": ["chip"], "release": ["chip"], "operacion": ["chip"] },   // 1–3 concrete chips per stretch
  "vs_c01": ["1–3 bullets: what differs from C01"],
  "key_numbers": ["1–2 defining numbers from SPEC §8 or the case"],
  "links": ["#c02.arquitectura"]
}
```
Cover C02 to C15 (14 cases) and patterns batch/c14, llm/c11, streaming/c13 and edge/c03.

### W4: `{ "intro": …, "map": …, "speeds": …, "work_kinds": …, "quiz": [Q…] }`
```
"intro":  { "lead": "2–3 sentences for the hero", "how_to_read": ["3–4 short bullets"] },
"map":    { "caption": "1–2 sentences", "loop_note": "how operation closes the loop back to data in C01" },
"speeds": { "intro": "why separating by speed untangles the picture (2–3 sentences)",
            "lines": [ { "id": "semanas|dias|ms|continuo", "name": "Línea del modelo", "rhythm": "cada cuánto corre en C01 (from the course)",
                         "stations": ["<ids or for ms: request sub-steps>"], "trigger": "qué la dispara", "who": "quién la mueve", "note": "one line" } ],
            "transfers": [ { "id": "registro-modelos|registro-imagenes|cluster|datos", "name": "…", "connects": ["semanas","dias"],
                             "what_passes": "qué cruza aquí", "where": "en qué herramienta vive en C01" } ] },
"work_kinds": { "programa": "1–2 sentences + an example", "configura": "…", "opera": "…", "administrado": "…" },
"quiz": [ { "symptom": "lo que ves, concreto (logs, métricas, mensajes)", "station": "<station id>",
            "why": "1–2 sentences", "first_check": "comando o chequeo concreto", "distractors": ["<id>", "<id>"] } ]
```
24 questions, 2 per station, realistic (C01 failures from the `fallas`, `monitoreo` and `evaluacion` sections and the course's debugging tables). Each distractor must be a plausible but wrong station.

## Quality bar
- Correct first, then short. Every claim must trace back to the course or official docs.
- Real files: quote short excerpts exactly. Commands must be real, with `{placeholders}`.
- Concrete beats generic: use C01's names, numbers and files.
- Escape correctly for JSON. Only `summary`, `memo`, `trap`, `how`, `note` and `why` may contain `<b>` or `<code>`.
- **Do NOT:**
  - run docker, kubectl, aws or any cluster or cloud command;
  - install anything;
  - log in anywhere or use credentials.

## Report
Briefly, in English:
- what you wrote;
- the doc URLs you checked;
- any disagreements between the course and the docs;
- anything uncertain.
