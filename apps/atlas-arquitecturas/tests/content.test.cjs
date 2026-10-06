// Pruebas de contenido. Basado en apps/ml-system-design/tests/content.test.cjs.
// - el validador (tools/validate-content.mjs) pasa sin errores;
// - la hoja de ruta del catálogo refleja docs/ROADMAP.md (15 fases);
// - las reglas de dedo que afirma ref-formas son ciertas en el calculador;
// - los enlaces lab:paso-<n> apuntan al paso que dice el texto (traza por defecto del Laboratorio);
// - aviso (no falla) si vendor/lab/index.html es más viejo que las fuentes del Laboratorio (SPEC §10.3).
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const { readFileSync, readdirSync, existsSync, statSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const ROOT = join(__dirname, '..');
const LAB = join(ROOT, '..', 'transformer-lab');

function loadAtlas() {
  const ctx = vm.createContext({ console });
  const files = ['js/core/registry.js', 'js/arch/primitives.js', 'js/arch/transformer.js', 'js/arch/vit.js', 'js/core/quantities.js',
    'js/content/catalog.js', 'js/content/repaso-atencion.js', 'js/content/mapa.js', 'js/content/ref-formas.js', 'js/content/vit.js'];
  for (const f of files) if (existsSync(join(ROOT, f))) vm.runInContext(readFileSync(join(ROOT, f), 'utf8'), ctx, { filename: f });
  return ctx.ATLAS;
}

test('validate-content: sin errores', () => {
  const r = spawnSync(process.execPath, [join(ROOT, 'tools', 'validate-content.mjs'), '--quiet'], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

test('catalog.roadmap refleja docs/ROADMAP.md', () => {
  const A = loadAtlas();
  const md = readFileSync(join(ROOT, 'docs', 'ROADMAP.md'), 'utf8');
  const phases = [...md.matchAll(/^\|\s*\*\*F(\d+)\*\*/gm)].map((m) => +m[1]);
  const road = A.catalog().roadmap;
  assert.deepStrictEqual(Array.from(road, (r) => r.phase), phases, 'fases del catálogo vs ROADMAP.md');   // Array.from: el arreglo del vm es de otro realm
  assert.strictEqual(road.length, 15);
  // Cada modelo y el repaso aparecen en exactamente una fase.
  const items = A.catalog().items;
  const seen = {};
  for (const r of road) for (const id of r.items) seen[id] = (seen[id] || 0) + 1;
  for (const [id, it] of Object.entries(items)) if (it.kind === 'model' || it.kind === 'recap') assert.strictEqual(seen[id], 1, id + ' en ' + (seen[id] || 0) + ' fases');
});

test('reglas de dedo de ref-formas: ciertas en el calculador', () => {
  const A = loadAtlas();
  const Ar = A.Arch;
  const cfgs = Ar.configs().filter((c) => ['vit', 'transformer'].includes(c.model));
  assert.ok(cfgs.length >= 2);
  for (const c of cfgs) {
    const r = Ar.run(c.id);
    const { D, Dmlp } = r.config;
    if (Dmlp !== 4 * D) continue;
    const q = r.quantities;
    // 1 · parámetros por capa = 12D² + 13D
    assert.strictEqual(q.layerParams, 12 * D * D + 13 * D, c.id + ': 12D² + 13D');
    // 2 · MACs de una capa = N·12D² (pesos lineales) + 2N²D → MACs por token ≈ pesos de las lineales
    const N = q.tokens;
    assert.strictEqual(q.layerMacs, N * 12 * D * D + 2 * N * N * D, c.id + ': MACs por capa');
    // 3 · cruce del término de atención en N = 6D
    assert.strictEqual(q.crossoverN, 6 * D, c.id + ': N* = 6D');
  }
});

test('enlaces lab:paso-<n>: apuntan al paso que nombra el texto', { skip: !existsSync(join(LAB, 'js', 'core', 'trainer.js')) && 'sin ../transformer-lab' }, () => {
  // Traza por defecto del Laboratorio (la que ve quien abre el enlace): 1 capa, 2 cabezas, primera frase.
  const ctx = vm.createContext({ console });
  for (const f of ['tensor', 'tokenizer', 'model', 'optim', 'trainer']) {
    vm.runInContext(readFileSync(join(LAB, 'js', 'core', f + '.js'), 'utf8'), ctx, { filename: 'lab/' + f + '.js' });
  }
  const s = ctx.TL.Trainer.createSession({});
  const steps = ctx.TL.Trainer.traceIteration(s, 0).steps;
  // Lo que el contenido del atlas afirma de cada paso enlazado.
  const EXPECT = {
    2: 'fwd.embed', 3: 'fwd.posenc', 4: 'fwd.L0.ln1', 5: 'fwd.L0.attn.q', 8: 'fwd.L0.attn.split',
    9: 'fwd.L0.attn.h0.scores', 10: 'fwd.L0.attn.h0.scale', 11: 'fwd.L0.attn.h0.mask', 12: 'fwd.L0.attn.h0.softmax',
    13: 'fwd.L0.attn.h0.context', 19: 'fwd.L0.attn.concat', 20: 'fwd.L0.attn.proj', 21: 'fwd.L0.res1', 31: 'bwd.ce',
  };
  const used = new Set();
  const dir = join(ROOT, 'js', 'content');
  const files = readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => join(dir, f))
    .concat(existsSync(join(dir, 'diagrams')) ? readdirSync(join(dir, 'diagrams')).filter((f) => f.endsWith('.js')).map((f) => join(dir, 'diagrams', f)) : []);
  for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/lab:paso-(\d+)/g)) used.add(+m[1]);
  for (const n of used) {
    assert.ok(n >= 1 && n <= steps.length, 'lab:paso-' + n + ' fuera de la traza (' + steps.length + ' pasos)');
    assert.ok(EXPECT[n], 'lab:paso-' + n + ' se usa pero no está en EXPECT de esta prueba (agrega qué paso es)');
    assert.strictEqual(steps[n - 1].id, EXPECT[n], 'lab:paso-' + n + ' ya no es ' + EXPECT[n] + ' (es ' + steps[n - 1].id + ')');
  }
  // El rango "backward = pasos 31–74" del repaso.
  assert.strictEqual(steps[30].phase, 'backward');
  assert.notStrictEqual(steps[73].phase, steps[74].phase, 'el backward debería terminar en el paso 74');
});

test('vendor/lab/index.html al día con el Laboratorio (aviso)', { skip: !existsSync(LAB) && 'sin ../transformer-lab' }, (t) => {
  const vendored = join(ROOT, 'vendor', 'lab', 'index.html');
  if (!existsSync(vendored)) { t.diagnostic('AVISO: falta vendor/lab/index.html (npm run vendor:lab)'); return; }
  const vt = statSync(vendored).mtimeMs;
  const newer = [];
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(js|css|html)$/.test(f) && st.mtimeMs > vt) newer.push(p.slice(LAB.length + 1));
    }
  };
  walk(join(LAB, 'js')); walk(join(LAB, 'css'));
  if (existsSync(join(LAB, 'index.html')) && statSync(join(LAB, 'index.html')).mtimeMs > vt) newer.push('index.html');
  if (newer.length) t.diagnostic('AVISO: vendor/lab/index.html es más viejo que ' + newer.slice(0, 5).join(', ') + (newer.length > 5 ? '…' : '') + ' — corre npm run vendor:lab');
});
