/* Sample project for the public demo: «Receipt Classifier API», a made-up online-synchronous system.
   Everything here is fictional (names, dates, measurements); the structure is the real one: pattern template,
   entry-gate calcs answered with the board's own engine, milestones, results, decisions and a work log. */
import { projectFromTemplate } from './shared/factory.mjs';
import { evaluateProject } from './shared/calc.mjs';

// Dates are relative to the visitor's first visit, so the sample never looks abandoned.
const DAY = 86400000;
const D = (daysAgo) => new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10);
const Z = (daysAgo) => new Date(Date.now() - daysAgo * DAY).toISOString().replace(/\.\d{3}Z$/, 'Z');

const H = (id, text, status, done) => ({ id, text, status, done });
const R = (id, name, value, unit, date, note = '') => ({ id, name, value, unit, date, note });
const C = (id, code, note) => ({ id, code, note });
const F = (id, path, ref) => ({ id, path, ref });

// This system's own numbers (the template's reference case has 10 M requests/day and a US$3,000 budget).
const REQUIREMENTS = { n_day: '2000000', budget_month: '2000' };
// Steps whose entry-gate calcs are answered (all of them, or just the listed ones).
const ANSWERED = { kickoff: 'all', datos: 'all', serving: ['tensor-bytes', 'p99-budget'] };

const STEP = {
  kickoff: {
    status: 'hecho',
    vuelta: { v1: 'hecho', v2: 'pendiente' },
    hitos: [H('sizing', 'Back-of-the-envelope sizing reviewed', 'hecho', 'Requirements, capacity plan and cost written down; every entry-gate check green.')],
    notes: 'Sample note: 2 M requests/day average ≈ 23 req/s, peak ≈ 69 req/s, designed for 100 req/s. 2 GPUs (one per AZ) so the service survives losing a zone; infra ≈ US$1.3k/month against a US$2k budget.',
    done: [true, true, true, true],
  },
  datos: {
    status: 'hecho',
    vuelta: { v1: 'hecho', v2: 'pendiente' },
    notes: 'Sample note: prediction logs ≈ 0.6 GB/day; the labeling queue (5,000 images/month) costs ≈ US$500/month, so the total stays under the budget.',
    done: [true, true, true, false],
  },
  versionado: { status: 'no_aplica', reason: 'Sample: the first release uses a public pretrained checkpoint, so there are no own dataset snapshots yet.' },
  entrenamiento: { status: 'no_aplica', reason: 'Sample: no fine-tuning in v1; the checkpoint is used as is.' },
  gate: {
    status: 'en_curso',
    vuelta: { v1: 'en_curso', v2: 'pendiente' },
    hitos: [H('golden', 'Golden set evaluation script', 'en_curso', 'A script reports top-1 and top-5 on the golden set and fails below the agreed floor.')],
    notes: 'Sample note: the floor for top-1 is still being negotiated with the product owner; the confidence interval per class decides which classes need more examples.',
  },
  serving: {
    status: 'en_curso',
    vuelta: { v1: 'en_curso', v2: 'pendiente' },
    hitos: [
      H('m1', 'Walking skeleton', 'hecho', 'A curl with a receipt photo returns the contract JSON; /readyz is 503 while the model loads.'),
      H('m2', 'Input validation and errors', 'en_curso', 'One test per error (400, 413, 415) plus a happy path with a fake model.'),
      H('m3', 'Timeouts and fallback', 'pendiente', 'A slow model returns 504 within the deadline; /healthz stays 200.'),
    ],
    results: [
      R('r1', 'Forward pass (batch 1, CPU, 4 threads)', '≈ 31', 'ms', D(1), 'Sample number. Three runs: 33.1 / 30.2 / 29.4 ms.'),
      R('r2', 'Decode + preprocess, warm', '≈ 5', 'ms', D(1), 'Sample number. JPEG 1280×960.'),
      R('r3', 'First request after start (cold)', '≈ 420', 'ms', D(1), 'Sample number. Decoder and allocator warm-up; later requests are an order of magnitude faster.'),
    ],
    commands: [
      C('k0', 'curl -s -F "image=@receipt.jpg" localhost:8000/v1/classify | jq', 'Smoke test of the contract'),
      C('k00', 'pytest -q tests/test_errors.py', 'One case per error code'),
    ],
    files: [F('f1', 'app/main.py', 'FastAPI app with lifespan loading'), F('f2', 'tests/test_errors.py', 'Error-path tests')],
    notes: 'Sample note: the cold first request is why /readyz exists; the load balancer waits for it.',
    done: [true, true, false, false, false],
  },
  empaquetado: { status: 'bloqueado', reason: 'Sample: waiting for access to the container registry.' },
};

const SESSIONS = [
  { id: 's1', date: D(3), source: 'web', stepIds: ['kickoff', 'datos'], did: 'Sample entry: wrote the requirements and answered the sizing calcs for the kickoff and data steps.', measured: '≈ 23 req/s average, 100 req/s design target, 2 GPUs, infra ≈ US$1.3k/month.', next: 'Start the walking skeleton.' },
  { id: 's2', date: D(1), source: 'web', stepIds: ['serving'], did: 'Sample entry: built the walking skeleton and measured the CPU forward pass.', measured: 'Forward ≈ 31 ms; decode + preprocess ≈ 5 ms; cold start ≈ 420 ms.', next: 'Input validation tests (milestone 2).' },
];
const DECISIONS = [
  [D(3), 'kickoff', 'Run one GPU per availability zone', 'A single larger GPU', 'Losing one zone must not take the service down; two small GPUs also keep utilization inside the planning band.'],
  [D(1), 'serving', 'Return 503 with Retry-After while the model loads', 'Accepting requests and queueing them', 'Failing fast lets the load balancer route around a cold pod; a queue would hide the problem and blow the latency budget.'],
];

// An answer string the board's engine accepts: the exact value (integers) or 4 significant digits.
const ans = (v) => (Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(4))));

export function seedDemo() {
  const p = projectFromTemplate({
    id: 'sample',
    name: 'Sample · Receipt Classifier API',
    pattern: 'sincrono',
    repo: '',
    goal: 'A made-up system to explore the board: POST /v1/classify behind a load balancer, sized and built step by step.',
  });
  for (const v of p.vars) { if (!v.value) v.value = v.ref; if (REQUIREMENTS[v.id]) { v.value = REQUIREMENTS[v.id]; v.source = 'Sample requirement'; } }
  const ev = evaluateProject(p);
  for (const s of p.steps) {
    const only = ANSWERED[s.id];
    if (only) for (const c of s.calcs) if (only === 'all' || only.includes(c.id)) c.answer = ans(ev.calcs[`${s.id}/${c.id}`].value);
    const x = STEP[s.id];
    if (!x) continue;
    for (const k of ['status', 'reason', 'vuelta', 'hitos', 'results', 'files', 'notes']) if (x[k] !== undefined) s[k] = x[k];
    if (x.commands) s.commands = [...x.commands, ...s.commands];
    if (x.done) s.done.forEach((c, i) => { c.ok = !!x.done[i]; });
  }
  p.vueltaActual = 1;
  p.resume = {
    where: 'Sample: kickoff and data are done; the walking skeleton works and input validation is in progress.',
    next: 'Finish the error-path tests (milestone 2), then timeouts and fallback.',
    nextStepId: 'serving',
  };
  p.sessions = SESSIONS.map((s) => ({ ...s }));
  p.decisions = DECISIONS.map(([date, stepId, what, against, why], i) => ({ id: `d${i + 1}`, date, stepId, what, against, why, status: 'vigente' }));
  p.createdAt = Z(9);
  p.lastActivity = Z(1);
  p.updatedAt = p.lastActivity;
  for (const s of p.steps) s.updatedAt = STEP[s.id] || ANSWERED[s.id] ? p.lastActivity : p.createdAt;
  return p;
}
