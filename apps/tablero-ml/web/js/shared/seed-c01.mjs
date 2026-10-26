/* C01 preload (v2, production mode) with the real state of ~/Documents/ProyectosPortafolio/Caso1, read on 2026-10-26
   without changing anything there: PLAN.md (milestones 0–10), LAB_LOG.md (status, measurements, what broke),
   DESIGN.md (back-of-the-envelope sizing) and the git log (f3133a3 milestone 0, 4bc61ef milestone 1 step 1.1).
   - Milestones sit on the step where they land; their «done when» is the PLAN's.
   - Sizing inputs are C01's (course) plus DESIGN.md's own assumption for log lines (400 B). Calc answers are only the
     ones DESIGN.md actually computed; the rest of the entry gates are still open.
   - upgradeSeedC01() migrates a v1 preload already in production: it only replaces texts nobody edited. */
import { projectFromTemplate } from './factory.mjs';
import { seedC01V1 } from './seed-c01-v1.mjs';

const H = (id, text, status, done) => ({ id, text, status, done });
const R = (id, name, value, unit, date, note = '') => ({ id, name, value, unit, date, note });
const C = (id, code, note) => ({ id, code, note });
const F = (id, path, ref) => ({ id, path, ref });

// DESIGN.md: what was actually computed, as written there.
const ANSWERS = {
  kickoff: { 'qps-avg': '116', 'qps-peak': '350', 'qps-design': '500', 'gpu-count': '2', 'error-budget-min': '43' },
  serving: { 'tensor-bytes': '602112', 'inflight-total': '25' },
  datos: { 'log-day': '4' },
};
const VAR_OVERRIDES = { log_bytes: { value: '400', source: 'DESIGN.md: ~400 B per log line × 10 M (estimated)' } };

const STEP = {
  kickoff: {
    status: 'en_curso',
    vuelta: { v1: 'en_curso', v2: 'pendiente' },
    hitos: [H('design', 'DESIGN.md · interview-style sizing', 'en_curso', 'Requirements, back-of-the-envelope sizing, architecture and API written down; open items from the entry gate closed.')],
    notes: 'DESIGN.md sized C01 for the interview: 116 → 350 → 500 req/s, 2 × T4 (N+1 across 2 AZs) at ≈ US$768/month for GPUs, 43 min/month error budget, ≈ 25 in flight at p50 and ≈ 100 at p99 (Little). Still open here: gateway vCPU and nodes, network to Triton, ALB and the full monthly cost against the US$3,000 budget.',
  },
  datos: {
    hitos: [H('imagenette', 'Imagenette 320px as the golden set (scripts/download_data.py)', 'pendiente', 'Downloaded to data/ (≈ 325 MB, ask before downloading); its 10 classes mapped to ImageNet indices. Used for the golden set (milestone 9), the load test (milestone 6) and the perturbations (milestone 10).')],
    notes: 'Minimal scope (PLAN, «Simple database»): Imagenette to measure real top-1/top-5, and SQLite with predictions and feedback (milestone 4, under Monitoring). In production predictions would ship as JSON logs → S3/Parquet.',
  },
  versionado: { status: 'no_aplica', reason: 'Minimal scope: torchvision IMAGENET1K_V2 weights and Imagenette, no own snapshots. MODEL_VERSION comes in milestone 9.' },
  entrenamiento: { status: 'no_aplica', reason: 'The model already exists (ResNet-50 IMAGENET1K_V2 from torchvision); the case neither redesigns nor retrains it.' },
  gate: {
    hitos: [H('h9a', 'Milestone 9 (part 1) · eval_golden.py and the parity gate', 'pendiente', 'eval_golden.py reports top-1/top-5 on ≈ 500 Imagenette photos; parity_check.py requires ≥ 99.5 % top-1 agreement: passes PyTorch vs ONNX and fails ResNet-50 V2 vs V1 or vs ResNet-18.')],
    notes: 'From milestone 1: V2 and V1 give the same top-1 with very different confidence (0.27 vs 0.61). Any score threshold is recalibrated per model version.',
  },
  export: {
    hitos: [H('h7b', 'Milestone 7 (b) · ONNX Runtime on CPU', 'pendiente', 'Variant measured with the same loadtest.sh and compared in the before/after table.')],
    notes: 'No NVIDIA GPU on the Mac: TensorRT and Triton do not apply here; export is PyTorch → ONNX → ONNX Runtime CPU. PyTorch vs ONNX parity is the milestone 9 gate.',
  },
  serving: {
    status: 'en_curso',
    vuelta: { v1: 'en_curso', v2: 'pendiente' },
    hitos: [
      H('h1', 'Milestone 1 · Walking skeleton', 'en_curso', 'curl with a dog photo returns the contract JSON with a sensible top-1; /readyz is 503 while loading; first-request vs next-10 latency recorded (warm-up).'),
      H('h2', 'Milestone 2 · Input validation and errors', 'pendiente', 'pytest with one case per error (400, 413 by bytes, 413 by MP, 415, invalid top_k) plus a happy path with a fake model, all green in under 5 s.'),
      H('h3', 'Milestone 3 · Timeouts and fallback', 'pendiente', 'pytest with a 2 s model → 504 in ≈ 150 ms; model down → 503 with Retry-After; /healthz stays 200 in both.'),
      H('h8', 'Milestone 8 · Gateway + model server (optional)', 'pendiente', 'Same external contract with two services in docker-compose; network hop cost on p50/p99 measured.'),
    ],
    results: [
      R('r1', 'ResNet-50 V2 forward (batch 1, 4 threads, macOS native), forwards 2–5', '≈ 25', 'ms', '2026-10-21', 'Two runs: 27.8/24.8/23.3/25.1 and 25.1/26.7/24.1/23.3 ms.'),
      R('r2', 'Forward 1 (warm-up)', '39.9', 'ms', '2026-10-21'),
      R('r3', 'Decode + preprocess, warm', '≈ 3–7', 'ms', '2026-10-21', 'AVIF 414×311 ≈ 3 ms; PNG 1204×515 ≈ 7 ms.'),
      R('r4', 'Decode + preprocess, cold', '2180 / 72.6', 'ms', '2026-10-21', 'First time on the machine (AVIF decoder) / first call of a new process.'),
      R('r5', 'Model load', '≈ 456–511', 'ms', '2026-10-21'),
      R('r6', 'Warm-up (3 passes through the full path)', '89–110', 'ms', '2026-10-21'),
      R('r7', 'Process importing torch, port closed', '≈ 3', 's', '2026-10-21', 'With LOAD_DELAY_S=10: ≈ 10 s more with /readyz 503 and /healthz 200.'),
      R('r8', 'Top-1 on the same dog, V2 vs V1', '0.269 vs 0.613', 'score', '2026-10-21', 'toy poodle on both; mass on dog classes 0.546 vs 0.998.'),
    ],
    commands: [
      C('m1', 'uv run python scripts/predict_once.py data/perrito.jpg', 'Caso1 · top-5 of one photo and forward timings (step 1.1).'),
      C('m2', 'curl -i localhost:8080/readyz', 'Caso1 · 503 while loading, 200 once the model is ready (step 1.3).'),
    ],
    files: [
      F('f1', 'scripts/predict_once.py', 'uncommitted (commit 4bc61ef only has DESIGN.md and LAB_LOG.md)'),
      F('f2', 'app/main.py', 'uncommitted · last change 2026-10-23'),
      F('f3', 'app/model.py', 'uncommitted'),
      F('f4', 'app/preprocess.py', 'uncommitted'),
    ],
    notes: [
      'Milestone 1, pass 1: 1.1 ✓ predict_once.py with top-5 and the forward measured · 1.2–1.3 ✓ lifespan loading the model once, /healthz and /readyz 503→200 with warm-up · 1.4 → POST /v1/classify + curl.',
      '',
      'What broke in milestone 1 (LAB_LOG):',
      '- An out-of-distribution image (a circuit diagram) still returns a top-5, with a low score (0.24): needs a confidence threshold and the manual picker.',
      '- The .jpg was AVIF and Pillow opened it: validate the real format from the bytes, not the extension or Content-Type (milestone 2).',
      '- Measuring once, cold, misleads (44 ms and 2180 ms): the warm-up before /readyz must cover the full path.',
      '- Center crop keeps only ≈ 41 % of a panoramic image\'s width.',
      '- The old server was still running and /readyz returned 404: Python reads the code once at startup.',
    ].join('\n'),
  },
  empaquetado: {
    vuelta: { v1: 'en_curso', v2: 'pendiente' },
    hitos: [
      H('h0', 'Milestone 0 · Setup (uv, Python 3.13, pinned dependencies)', 'hecho', '`rm -rf .venv && uv sync` reinstalls exactly the same versions; git status clean and without .venv, data/ or models/. Closed 2026-10-12 (I did 0.1–0.5 and 0.12; the mentor finished it).'),
      H('h5', 'Milestone 5 · Docker', 'pendiente', '`docker run -p 8080:8080` + curl returns the contract JSON; image size and time to /readyz 200 recorded.'),
    ],
    results: [
      R('r1', 'Packages in .venv', '41', 'packages', '2026-10-12', '6 direct + 2 dev.'),
      R('r2', '.venv size (macOS)', '646', 'MB', '2026-10-12'),
      R('r3', 'nvidia-* packages in the lock, before / after the CPU index', '15 (+ triton) / 0', 'packages', '2026-10-12'),
    ],
    commands: [
      C('m1', 'rm -rf .venv && uv sync --frozen && uv pip freeze', 'Caso1 · reproduces exactly the same versions.'),
      C('m2', 'uv lock --check', 'Caso1 · lock in sync with pyproject.toml (belongs in CI).'),
      C('m3', "grep -c '^name = \"nvidia' uv.lock", 'Caso1 · 0 with the PyTorch CPU index.'),
    ],
    files: [F('f1', 'pyproject.toml, uv.lock, .python-version, .gitignore', 'f3133a3 · Milestone 0')],
    notes: 'Learned: pasting a pyproject.toml template on top left the lock out of sync. The lock derives from pyproject, never the other way around.',
  },
  cicd: { status: 'no_aplica', reason: 'Out of the PLAN\'s minimal scope (milestones 0–10). LAB_LOG notes that `uv lock --check` belongs in CI.' },
  kubernetes: { status: 'no_aplica', reason: 'One container on the laptop; replicas are sized on paper (DESIGN.md, «What changes on the laptop»).' },
  rollout: {
    hitos: [H('h9b', 'Milestone 9 (part 2) · MODEL_VERSION exposed and rollback', 'pendiente', 'MODEL_VERSION in the response and the logs; rollback to the previous image tag in under 1 minute.')],
  },
  request: {
    hitos: [
      H('h6', 'Milestone 6 · Load test', 'pendiente', 'Table in LAB_LOG.md with concurrency, throughput, p50, p99, % errors and CPU; the point where p99 crosses 200 ms; Little\'s law (L = λ·W) checked on every row.'),
      H('h7', 'Milestone 7 · Improve with what was measured (a: threads vs workers, c: batching)', 'pendiente', 'Before/after table with the best configuration and why it won.'),
    ],
    results: [
      R('r1', 'CPU replicas for 500 req/s with the measured forward (25 ms)', '22 (88 cores)', 'replicas', '2026-10-21', 'DESIGN.md: 40 img/s per replica, 24 planned at 60 %, N+1. ≈ US$2,730/month as c6i.xlarge vs ≈ US$768 with 2 GPUs.'),
      R('r2', 'Requests in flight at 500 req/s (Little: L = λ·W)', '≈ 25 at p50 · ≈ 100 at p99', 'requests', '2026-10-21', 'Back-of-the-envelope in DESIGN.md.'),
    ],
  },
  monitoreo: {
    hitos: [
      H('h4', 'Milestone 4 · Minimal observability + SQLite', 'pendiente', 'After 200 requests, quantiles.py prints p50 and p99, and a SQL query returns the simulated acceptance rate.'),
      H('h10', 'Milestone 10 · Break the model, not the service', 'pendiente', 'Table with the accuracy drop per perturbation and which label-free signal (confidence, entropy, PSI) would have caught it in production.'),
    ],
  },
};

const DECISIONS = [
  ['2026-10-12', 'empaquetado', 'Python 3.13 pinned in .python-version and the Dockerfile', 'Python 3.14', 'Mature torch and onnxruntime wheels on arm64, and the same minor version as the course\'s python:3.13-slim. 3.14 later turned out to have every wheel too.'],
  ['2026-10-12', 'empaquetado', 'uv + pyproject.toml + uv.lock', 'venv + requirements.txt with ==', 'The lock pins transitive dependencies too, for macOS and Linux in one file, and uv sync is reproducible and fast.'],
  ['2026-10-12', 'empaquetado', 'CPU-only torch on Linux (download.pytorch.org/whl/cpu index)', 'torch from PyPI', 'On Linux the PyPI wheel bundles CUDA: 15 nvidia-* packages plus triton a CPU service never uses.'],
  ['2026-10-12', 'empaquetado', 'Weights and data out of git', 'Versioning them in the repo', 'Large binaries; versioned by tag or hash.'],
  ['2026-10-12', 'serving', 'ResNet-50, torchvision IMAGENET1K_V2 weights', 'ResNet-18', 'The case\'s model (4.1 GMACs); on CPU it stresses the SLO, so milestones 6 and 7 have something to fix. ResNet-18 meets it with room and teaches nothing.'],
  ['2026-10-12', 'serving', 'A single app/preprocess.py with weights.transforms() and Pillow decode', 'Hand-written resize in the handler', 'One source of truth, identical to training: prevents training-serving skew.'],
  ['2026-10-12', 'serving', 'Sync def handler in milestone 1; run_in_threadpool + asyncio.wait_for in milestone 3', 'async def with the forward inside', 'An async def with the forward inside blocks the event loop.'],
  ['2026-10-12', 'serving', 'One uvicorn process on port 8080', 'uvicorn --workers N inside the container', 'One process per container; the orchestrator adds replicas. Measured in milestone 7.'],
  ['2026-10-12', 'serving', 'Config from environment variables (MODEL_VERSION, INFER_TIMEOUT_S=0.15, MAX_BYTES, MAX_PIXELS, TORCH_THREADS…)', 'Constants in code', 'The same artifact in every environment; only config changes.'],
  ['2026-10-12', 'datos', 'Imagenette 320px + SQLite for predictions and feedback', 'An own dataset; JSON logs → S3/Parquet', 'Imagenette\'s 10 classes map to ImageNet: real top-1/top-5 on the Mac. SQLite only keeps predictions queryable locally.'],
  ['2026-10-21', 'request', 'Gateway → model server over HTTP with a binary tensor (Triton\'s KServe v2 protocol)', 'gRPC', 'As compact as gRPC, without its load-balancing trap behind an L4 balancer, and debuggable with curl. The public API stays HTTP + JSON.'],
];

const RESUME = {
  where: 'Milestone 1 (walking skeleton), pass 1. Steps 1.1–1.3 done: predict_once.py with top-5 and the forward measured (≈ 25 ms), lifespan loading ResNet-50 once, /healthz and /readyz 503→200 with warm-up. Note: app/main.py, app/model.py, app/preprocess.py and scripts/predict_once.py are uncommitted (main.py last changed 2026-10-23), and LAB_LOG.md and DESIGN.md have uncommitted changes.',
  next: 'Milestone 1, step 1.4: POST /v1/classify reading the raw body and returning the top-k per the contract; test it with curl and a dog photo. First: commit what already works from steps 1.1–1.3, and close the Requirements & Capacity Plan gate.',
  nextStepId: 'serving',
};

const SESSIONS = [
  {
    id: 's-2026-10-12', date: '2026-10-12', source: 'import', stepIds: ['empaquetado'],
    did: 'Milestone 0: setup with uv, Python 3.13 and pinned dependencies (I did 0.1–0.5 and 0.12; the mentor finished it). Wrote PLAN.md and LAB_LOG.md. Commit f3133a3.',
    measured: '.venv with 41 packages and 646 MB; nvidia-* packages in the lock: 15 → 0 with the CPU index; `uv sync --frozen` reproduces exactly.',
    next: 'Milestone 1, step 1.1: load ResNet-50 in a standalone script and get the top-5 of one photo.',
  },
  {
    id: 's-2026-10-21', date: '2026-10-21', source: 'import', stepIds: ['serving', 'request', 'kickoff'],
    did: 'Milestone 1, step 1.1: predict_once.py and the first CPU forward measurement; DESIGN.md with the back-of-the-envelope sizing (commit 4bc61ef). Steps 1.2–1.3: lifespan, /healthz and /readyz 503→200 with warm-up.',
    measured: 'Forward ≈ 25 ms (batch 1, 4 threads); decode + preprocess warm ≈ 3–7 ms (cold 44 and 2180 ms); model load ≈ 456–511 ms; warm-up 89–110 ms; with the measured forward, 22 CPU replicas would be needed for 500 req/s.',
    next: 'Milestone 1, step 1.4: POST /v1/classify + curl.',
  },
];

export function seedC01() {
  const p = projectFromTemplate({
    id: 'c01',
    name: 'C01 · Image Classification API (Caso1)',
    pattern: 'sincrono',
    repo: '~/Documents/ProyectosPortafolio/Caso1',
    goal: 'POST /v1/classify with ResNet-50 on CPU that works, is measured and is broken on purpose: PLAN milestones 0–10, in two passes.',
  });
  // C01's own requirements (the course's case), plus DESIGN.md's assumptions where it made its own.
  for (const v of p.vars) {
    if (!v.value) v.value = v.ref;
    if (VAR_OVERRIDES[v.id]) Object.assign(v, VAR_OVERRIDES[v.id]);
  }
  for (const s of p.steps) {
    s.commands = s.commands.map((c) => ({ ...c, note: `Course (full C01)${c.note ? ': ' + c.note : ''}` }));
    for (const c of s.calcs) if (ANSWERS[s.id] && ANSWERS[s.id][c.id]) c.answer = ANSWERS[s.id][c.id];
    const x = STEP[s.id];
    if (!x) continue;
    if (x.status) s.status = x.status;
    if (x.reason) s.reason = x.reason;
    if (x.vuelta) s.vuelta = { ...s.vuelta, ...x.vuelta };
    if (x.hitos) s.hitos = x.hitos;
    if (x.results) s.results = x.results;
    if (x.commands) s.commands = [...x.commands, ...s.commands];
    if (x.files) s.files = x.files;
    if (x.notes) s.notes = x.notes;
  }
  p.vueltaActual = 1;
  p.resume = { ...RESUME };
  p.sessions = SESSIONS.map((s) => ({ ...s }));
  p.decisions = DECISIONS.map(([date, stepId, what, against, why], i) => ({ id: `d${i + 1}`, date, stepId, what, against, why, status: 'vigente' }));
  // Last sign of work in Caso1: app/main.py, modified 2026-10-23 19:36 (Mac local time, UTC−6).
  p.createdAt = '2026-10-12T23:04:54Z';
  p.lastActivity = '2026-10-24T01:36:00Z';
  p.updatedAt = p.lastActivity;
  for (const s of p.steps) s.updatedAt = STEP[s.id] ? p.lastActivity : p.createdAt;
  return p;
}

// A v1 C01 preload already in production (migrated by migrate.mjs to v2's shape): swap the preloaded Spanish texts
// for v2's, field by field, only where the value is still exactly what v1 wrote. Your own edits are never touched.
export function upgradeSeedC01(d) {
  if (d.id !== 'c01' || d.repo !== '~/Documents/ProyectosPortafolio/Caso1') return d;
  const old = seedC01V1();
  const neu = seedC01();
  const same = (a, b) => a === b;
  if (same(d.name, old.name)) d.name = neu.name;
  if (same(d.goal, old.goal)) d.goal = neu.goal;
  if (same(d.resume.where, old.resume.where)) d.resume.where = neu.resume.where;
  if (same(d.resume.next, old.resume.next)) d.resume.next = neu.resume.next;
  // inputs: fill what is still empty with C01's values
  for (const v of d.vars) { const n = neu.vars.find((x) => x.id === v.id); if (n && !String(v.value).trim()) Object.assign(v, { value: n.value, source: n.source }); }
  for (const s of d.steps) {
    const n = neu.steps.find((x) => x.id === s.id);
    if (!n) continue;
    if (s.id === 'kickoff') { // new in v2: if untouched, take it as preloaded (DESIGN.md's sizing)
      if (s.status === 'pendiente' && !s.notes && !s.hitos.length && s.calcs.every((c) => !c.answer)) Object.assign(s, { status: n.status, vuelta: n.vuelta, hitos: n.hitos, notes: n.notes, calcs: n.calcs });
      continue;
    }
    const o = old.steps.find((x) => x.id === s.id);
    if (!o) continue;
    if (same(s.reason, o.reason)) s.reason = n.reason;
    if (same(s.notes, o.notes)) s.notes = n.notes;
    const byId = (arr, id) => arr.find((x) => x.id === id);
    for (const h of s.hitos) { const a = byId(o.hitos, h.id), b = byId(n.hitos, h.id); if (a && b) { if (same(h.text, a.text)) h.text = b.text; if (same(h.done, a.done)) h.done = b.done; } }
    for (const r of s.results) { const a = byId(o.results, r.id), b = byId(n.results, r.id); if (a && b) { if (same(r.name, a.name)) r.name = b.name; if (same(r.note, a.note)) r.note = b.note; if (same(r.unit, a.unit)) r.unit = b.unit; } }
    for (const c of s.commands) {
      const b = byId(n.commands, c.id);
      if (!b) continue;
      const a = byId(o.commands, c.id);
      if ((a && same(c.note, a.note)) || /^Curso \(C01 completo\)/.test(c.note)) c.note = b.note;
    }
    for (const f of s.files) { const a = byId(o.files, f.id), b = byId(n.files, f.id); if (a && b && same(f.ref, a.ref)) f.ref = b.ref; }
    for (const c of s.calcs) { const b = byId(n.calcs, c.id); if (b && b.answer && !c.answer) c.answer = b.answer; }
  }
  for (const s of d.sessions) {
    const a = old.sessions.find((x) => x.id === s.id), b = neu.sessions.find((x) => x.id === s.id);
    if (!a || !b) continue;
    for (const k of ['did', 'measured', 'next']) if (same(s[k], a[k])) s[k] = b[k];
    if (s.source === 'import' && JSON.stringify(s.stepIds) === JSON.stringify(a.stepIds)) s.stepIds = b.stepIds;
  }
  for (const x of d.decisions) {
    const a = old.decisions.find((y) => y.id === x.id), b = neu.decisions.find((y) => y.id === x.id);
    if (!a || !b) continue;
    for (const k of ['what', 'against', 'why']) if (same(x[k], a[k])) x[k] = b[k];
  }
  return d;
}
