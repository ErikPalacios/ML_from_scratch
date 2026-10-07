#!/usr/bin/env node
// Cross-check calculador ↔ PyTorch (SPEC §9.3).
//   node tools/crosscheck-compare.mjs            regenera crosscheck/expected/*.json con la venv
//                                                (si existe .venv) y compara con ATLAS.Arch.
//   node tools/crosscheck-compare.mjs --no-regen solo compara con los JSON versionados.
// Sale con código 1 si algo no coincide. Exporta compareAll() (lo usa tests/crosscheck.test.cjs).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED = join(ROOT, 'crosscheck', 'expected');
const FILES = ['js/arch/primitives.js', 'js/arch/transformer.js', 'js/arch/vit.js', 'js/arch/resnet.js', 'js/arch/swin.js', 'js/arch/clip.js'];
export const FLOP_TOL = 0.005;   // 0.5 % (en la práctica la diferencia es 0)

export function loadArch(root = ROOT) {
  const ctx = vm.createContext({});
  for (const f of FILES) vm.runInContext(readFileSync(join(root, f), 'utf8'), ctx, { filename: f });
  return vm.runInContext('ATLAS.Arch', ctx);
}

const rel = (a, b) => (b === 0 ? (a === 0 ? 0 : Infinity) : Math.abs(a - b) / Math.abs(b));
const sumOps = (by, keys) => keys.reduce((s, k) => s + (by[k] || 0), 0);

// Compara una config; devuelve [{what, calc, ref, ok, note?}].
export function compareConfig(A, exp) {
  const out = [];
  const push = (what, calc, ref, ok, note) => out.push({ what, calc, ref, ok, note });
  // calc_overrides: knobs con los que corrió la referencia (CLIP: B = 1, el batch de PyTorch).
  const ov = exp.calc_overrides || {};
  const r = A.run(exp.config_id, ov);
  const t = r.totals;

  push('params_total', t.params, exp.params_total, t.params === exp.params_total);
  for (const [node, n] of Object.entries(exp.params_by_node || {})) {
    const c = t.byNode[node] ? t.byNode[node].params : null;
    push('params[' + node + ']', c, n, c === n);
  }
  // params_by_path: nodos que repiten id en dos lugares (torres de CLIP) se comparan por su ruta.
  for (const [key, n] of Object.entries(exp.params_by_path || {})) {
    const c = t.byPath[key] ? t.byPath[key].params : null;
    push('params[' + key + ']', c, n, c === n);
  }
  for (const [id, shape] of Object.entries(exp.shapes || {})) {
    const x = r.tensors[id];
    const c = x ? x.num.join('×') : '(sin tensor)';
    push('shape[' + id + ']', c, shape.join('×'), c === shape.join('×'));
  }
  const flopsOk = (calc, ref) => rel(calc, ref) <= FLOP_TOL;
  push('flops_total', t.flops, exp.flops_total, flopsOk(t.flops, exp.flops_total),
    'FlopCounterMode = 2 × MACs de matmuls/convs; diferencia ' + (100 * rel(t.flops, exp.flops_total)).toFixed(4) + ' %');
  if (exp.flops_total_fused_sdpa !== undefined) {
    push('flops_total (sdpa)', t.flops, exp.flops_total_fused_sdpa, flopsOk(t.flops, exp.flops_total_fused_sdpa));
  }
  // Desglose por operador aten ↔ primitivas del calculador.
  const by = exp.flops_by_op || {};
  const p = (k) => (t.byPrim[k] ? t.byPrim[k].macs : 0);
  if (Object.keys(by).length) {
    const conv = sumOps(by, ['aten.convolution']);
    if (conv || p('conv2d')) push('flops[convolution]', 2 * p('conv2d'), conv, 2 * p('conv2d') === conv);
    const lin = sumOps(by, ['aten.addmm', 'aten.mm']);
    // mm incluye la matriz de similitud de CLIP (I·Tᵀ).
    const linCalc = 2 * (p('linear') + p('classifier_head') + p('similarity_logits'));
    push('flops[addmm+mm]', linCalc, lin, linCalc === lin);
    const att = sumOps(by, ['aten.bmm', 'aten.baddbmm', 'aten._scaled_dot_product_flash_attention_for_cpu',
      'aten._scaled_dot_product_efficient_attention', 'aten._scaled_dot_product_flash_attention', 'aten._scaled_dot_product_cudnn_attention']);
    push('flops[bmm/sdpa]', 2 * (p('attention_scores') + p('attention_weighted_sum')), att,
      2 * (p('attention_scores') + p('attention_weighted_sum')) === att);
  }
  // batch_check (CLIP): con batch B, PyTorch = B × (total del calculador con ese B), porque el
  // calculador cuenta por par (la similitud, B·E por par).
  const bc = exp.batch_check;
  if (bc) {
    const rb = A.run(exp.config_id, Object.assign({}, ov, { B: bc.B }));
    const calc = bc.B * rb.totals.flops;
    push('batch B=' + bc.B + ' flops_total', calc, bc.flops_total, flopsOk(calc, bc.flops_total), 'B × FLOPs por par');
    for (const [id, shape] of Object.entries(bc.shapes || {})) {
      const x = rb.tensors[id];
      const c = x ? x.num.join('×') : '(sin tensor)';
      push('batch B=' + bc.B + ' shape[' + id + ']', c, shape.join('×'), c === shape.join('×'));
    }
  }
  // windows (Swin): ventana efectiva, shift y tabla de sesgo de cada bloque de los pares (regla de timm).
  for (const w of exp.windows || []) {
    const st = (r.config.stages || [])[w.stage - 1];
    const tag = 'window[s' + w.stage + '-b' + w.block + ']';
    if (!st) { push(tag, null, w.window_size[0], false); continue; }
    const shift = w.block === 2 ? st.shift : 0;
    push(tag + ' M', st.M, w.window_size[0], st.M === w.window_size[0]);
    push(tag + ' shift', shift, w.shift_size[0], shift === w.shift_size[0]);
    push(tag + ' bias table', (2 * st.M - 1) * (2 * st.M - 1) + '×' + st.h, w.bias_table.join('×'), (2 * st.M - 1) * (2 * st.M - 1) + '×' + st.h === w.bias_table.join('×'));
    const hasMask = !!r.tensors['s' + w.stage + '-b' + w.block + '-masked'];
    push(tag + ' mask', hasMask, !!w.attn_mask, hasMask === !!w.attn_mask);
  }
  const hf = exp.alt && exp.alt.hf;
  if (hf) {
    push('hf params_total', t.params, hf.params_total, t.params === hf.params_total);
    push('hf flops_total', t.flops, hf.flops_total, flopsOk(t.flops, hf.flops_total));
  }
  return out;
}

export function compareAll(root = ROOT) {
  const A = loadArch(root);
  const dir = join(root, 'crosscheck', 'expected');
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
  const results = [];
  const seen = new Set();
  for (const f of files) {
    const exp = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    seen.add(exp.config_id);
    if (!A.hasConfig(exp.config_id)) {
      results.push({ configId: exp.config_id, checks: [{ what: 'config', calc: null, ref: exp.config_id, ok: false, note: 'config desconocida para el calculador' }] });
      continue;
    }
    results.push({ configId: exp.config_id, checks: compareConfig(A, exp), exp });
  }
  for (const c of A.configs()) {
    if (!seen.has(c.id)) results.push({ configId: c.id, checks: [{ what: 'expected json', calc: c.id, ref: null, ok: false, note: 'falta crosscheck/expected/' + c.id + '.json' }] });
  }
  return results;
}

function regenerate() {
  const py = join(ROOT, '.venv', 'bin', 'python');
  if (!existsSync(py)) {
    console.log('No hay .venv: comparo solo con los JSON versionados (python3.13 -m venv .venv && .venv/bin/pip install -r crosscheck/requirements.txt).');
    return true;
  }
  for (const script of ['transformer.py', 'vit.py', 'resnet.py', 'swin.py', 'clip.py']) {
    console.log('▸ .venv/bin/python crosscheck/' + script);
    const r = spawnSync(py, [script], { cwd: join(ROOT, 'crosscheck'), stdio: 'inherit', env: Object.assign({}, process.env, { HF_HUB_OFFLINE: '1', PYTHONDONTWRITEBYTECODE: '1' }) });
    if (r.status !== 0) { console.error('Falló crosscheck/' + script); return false; }
  }
  return true;
}

const fmtN = (v) => (typeof v === 'number' ? v.toLocaleString('en-US') : String(v));

function main() {
  const regen = !process.argv.includes('--no-regen');
  if (regen && !regenerate()) process.exit(1);
  const results = compareAll();
  let bad = 0;
  for (const r of results) {
    const fails = r.checks.filter((c) => !c.ok);
    bad += fails.length;
    const head = r.checks.find((c) => c.what === 'params_total');
    const fl = r.checks.find((c) => c.what === 'flops_total');
    console.log((fails.length ? '✗ ' : '✓ ') + r.configId.padEnd(18) +
      (head ? ' params calc ' + fmtN(head.calc) + ' / torch ' + fmtN(head.ref) : '') +
      (fl ? ' · FLOPs calc ' + fmtN(fl.calc) + ' / torch ' + fmtN(fl.ref) + ' (' + (100 * rel(fl.calc, fl.ref)).toFixed(4) + ' %)' : '') +
      ' · ' + r.checks.length + ' comprobaciones');
    for (const f of fails) console.log('    ✗ ' + f.what + ': calc ' + fmtN(f.calc) + ' ≠ ref ' + fmtN(f.ref) + (f.note ? ' — ' + f.note : ''));
  }
  console.log(bad ? '\n' + bad + ' diferencias.' : '\nTodo coincide.');
  process.exit(bad ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
