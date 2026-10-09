// Pruebas de la fase 12 (encoder-decoder: T5, Whisper; js/arch/encdec.js + primitivas nuevas de primitives.js).
// Cuentas a mano, totales exactos de HF (meta, sin pesos: crosscheck/encdec.py), formas y comportamiento de los knobs.
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const ARCH = Array.from(html.matchAll(/<script src="(js\/arch\/[^"]+)"/g), (m) => m[1]);
function load(files) {
  const ctx = vm.createContext({});
  for (const f of ['js/core/registry.js'].concat(files, ['js/core/quantities.js'])) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  return vm.runInContext('ATLAS', ctx);
}
const ATLAS = load(ARCH);
const A = ATLAS.Arch, Q = ATLAS.Quantities;
const J = (x) => JSON.parse(JSON.stringify(x));
const S = (sym, num, layout) => A.shape(sym, num, 'aud', layout);
const T5 = ['t5-small', 't5-base', 't5-large', 'flan-t5-base', 't5-base-decode'];
const WH = ['whisper-tiny', 'whisper-base', 'whisper-small', 'whisper-medium', 'whisper-large-v3', 'distil-whisper-large-v3', 'whisper-small-decode'];

// ---------------------------------------------------------------- primitivas
test('F12 conv1d: forma, parámetros, MACs, stride 2 con padding (front end de Whisper)', () => {
  const x = S(['3000', 'n_mels'], [3000, 80]);
  const c1 = A.conv1d(x, { k: 3, p: 1, cout: 768, coutSym: 'D', outSym: '3000' });
  assert.deepStrictEqual([J(c1.out.num), J(c1.out.sym)], [[3000, 768], ['3000', 'D']]);
  assert.strictEqual(c1.params, 3 * 80 * 768 + 768);
  assert.strictEqual(c1.macs, 3000 * 768 * 3 * 80);
  assert.strictEqual(c1.paramArith, '3·80·768 + 768 = 185,088');
  const c2 = A.conv1d(c1.out, { k: 3, s: 2, p: 1, cout: 768, coutSym: 'D', outSym: '1500' });
  assert.deepStrictEqual(J(c2.out.num), [1500, 768]);                    // ⌊(3000 + 2 − 3)/2⌋ + 1
  assert.strictEqual(c2.macs, 1500 * 768 * 3 * 768);
  assert.strictEqual(A.conv1d(S(['T', 'C'], [7, 2]), { k: 3, s: 2, cout: 4 }).out.num[0], 3);   // ⌊(7 − 3)/2⌋ + 1
  assert.strictEqual(A.conv1d(S(['T', 'C'], [7, 2]), { k: 3, cout: 4, bias: false }).params, 3 * 2 * 4);
  assert.throws(() => A.conv1d(S(['H', 'W', 'C'], [2, 2, 2], 'grid'), { k: 1, cout: 1 }), /T×C/);
});

test('F12 t5RelativeBucket: distancias exactas, escala log, simetría y saturación (32 buckets, 128)', () => {
  const b = (r, bi) => A.t5RelativeBucket(r, bi, 32, 128);
  // bidireccional: 16 buckets por signo; 0…7 exactos; positivos (memoria a la derecha) suman 16
  assert.deepStrictEqual([0, -1, -7, 1, 7].map((r) => b(r, true)), [0, 1, 7, 17, 23]);
  // valores de HF (crosscheck/expected/t5-base.json, bucket_checks)
  assert.deepStrictEqual([-8, -11, -12, -16, -32, -64, -90, -91, -128, -600].map((r) => b(r, true)), [8, 8, 9, 10, 12, 14, 14, 15, 15, 15]);
  assert.deepStrictEqual([8, 16, 64, 91, 600].map((r) => b(r, true)), [24, 26, 30, 31, 31]);
  // causal: 32 buckets solo para el pasado; 0…15 exactos; el futuro (rel > 0) cae en 0 (lo anula la máscara)
  assert.deepStrictEqual([0, -15, -16, -22, -32, -64, -127, -128, 5].map((r) => b(r, false)), [0, 15, 16, 18, 21, 26, 31, 31, 0]);
  for (let r = -300; r < 0; r++) assert.ok(b(r - 1, true) >= b(r, true) || r - 1 < -300, 'monótono');
});

test('F12 t5_rel_bias, add_rel_bias, pad_or_trim y log_mel (a mano)', () => {
  const rb = A.t5_rel_bias({ h: 12, Tq: 5, Tk: 5, qSym: 'T_in', kSym: 'T_in', bidirectional: true });
  assert.deepStrictEqual([J(rb.out.num), J(rb.out.sym), rb.params, rb.macs], [[12, 5, 5], ['h', 'T_in', 'T_in'], 32 * 12, 0]);
  assert.strictEqual(rb.detail.bucketsUsed, 9);                           // rel −4 … 4 → 9 buckets distintos
  const dec = A.t5_rel_bias({ h: 2, Tq: 1, Tk: 10, qSym: '1', kSym: 'ctx', bidirectional: false, pos0: 9 });
  assert.deepStrictEqual([J(dec.out.num), dec.detail.bucketsUsed], [[2, 1, 10], 10]);
  const sc = A.shape(['h', 'T', 'T'], [12, 5, 5], 'txt', 'heads');
  const ab = A.add_rel_bias(sc, rb.out);
  assert.deepStrictEqual([ab.prim, ab.params, ab.macs, ab.other], ['add_rel_bias', 0, 0, 300]);
  const au = A.shape(['S'], [80000], 'aud', 'vec');
  const pd = A.pad_or_trim(au, { to: 480000 });
  assert.deepStrictEqual([J(pd.out.num), pd.detail.padded, pd.detail.trimmed, pd.params + pd.macs], [[480000], 400000, 0, 0]);
  const lm = A.log_mel(pd.out, { nMels: 80, framesSym: '3000' });
  assert.deepStrictEqual([J(lm.out.num), J(lm.out.sym), lm.params, lm.macs, lm.out.mod], [[3000, 80], ['3000', 'n_mels'], 0, 0, 'aud']);
  assert.deepStrictEqual([lm.detail.winMs, lm.detail.hopMs, lm.detail.bins, lm.detail.melFilterMacs], [25, 10, 201, 3000 * 201 * 80]);
  const ids = J(A.primitives()).map((p) => p.id);
  for (const id of ['conv1d', 't5_rel_bias', 'add_rel_bias', 'pad_or_trim', 'log_mel']) assert.ok(ids.includes(id), id);
  assert.strictEqual(A.fmt.shapeTex(A.shape(['T_out', 'T_in'], [2, 3])), 'T_{\\mathrm{out}}\\times T_{\\mathrm{in}}');
  assert.strictEqual(A.fmt.shapeTex(A.shape(['3000', 'n_mels'], [3000, 80])), '3000\\times n_{\\mathrm{mels}}');
});

test('F12 las primitivas y modelos nuevos no cambian ningún resultado de las fases 1–11', () => {
  const OLD = load(ARCH.filter((f) => f !== 'js/arch/encdec.js')).Arch;
  let n = 0;
  for (const c of OLD.configs()) {
    const a = OLD.run(c.id), b = A.run(c.id);
    assert.deepStrictEqual([b.totals.params, b.totals.macs, b.totals.other], [a.totals.params, a.totals.macs, a.totals.other], c.id);
    n++;
  }
  assert.ok(n >= 75, n + ' configs');
});

// ---------------------------------------------------------------- modelos
test('F12 registro: modelos, configs, canónicas y decodeOf', () => {
  assert.deepStrictEqual(J(A.configs('t5').map((c) => c.id)), T5);
  assert.deepStrictEqual(J(A.configs('whisper').map((c) => c.id)), WH);
  assert.deepStrictEqual([A.canonical('t5'), A.canonical('whisper')], ['t5-base', 'whisper-small']);
  assert.strictEqual(A.run('t5-base-decode').config.decodeOf, 't5-base');
  assert.strictEqual(A.run('whisper-small-decode').config.decodeOf, 'whisper-small');
  assert.strictEqual(typeof A.encdec.spanCorruption, 'function');
});

test('F12 parámetros exactos = HF (meta): T5, Flan-T5 (LM head desatado) y Whisper (sin / con el buffer sinusoidal)', () => {
  const HF = { 't5-small': 60506624, 't5-base': 222903552, 't5-large': 737668096, 'flan-t5-base': 247577856, 't5-base-decode': 222903552,
    'whisper-tiny': 37184640, 'whisper-base': 71825920, 'whisper-small': 240582912, 'whisper-medium': 762321920, 'whisper-large-v3': 1541570560,
    'distil-whisper-large-v3': 754485760, 'whisper-small-decode': 240582912 };
  const RAW = { 'whisper-tiny': 37760640, 'whisper-base': 72593920, 'whisper-small': 241734912, 'whisper-medium': 763857920, 'whisper-large-v3': 1543490560,
    'distil-whisper-large-v3': 756405760 };
  for (const [id, n] of Object.entries(HF)) assert.strictEqual(A.run(id).totals.params, n, id);
  for (const [id, n] of Object.entries(RAW)) assert.strictEqual(A.run(id).quantities.paramsHF, n, id);
  // fórmula a mano (T5: sin sesgos, RMSNorm D; I = h·d_kv)
  const t5 = (V, D, I, F, L, h, gated, tied) => V * D + L * (4 * D * I + (gated ? 3 : 2) * D * F + 2 * D) + L * (8 * D * I + (gated ? 3 : 2) * D * F + 3 * D) + 2 * 32 * h + 2 * D + (tied ? 0 : V * D);
  assert.strictEqual(t5(32128, 768, 768, 3072, 12, 12, false, true), 222903552);
  assert.strictEqual(t5(32128, 768, 768, 2048, 12, 12, true, false), 247577856);
  // Whisper: LayerNorm 2D, W_K sin sesgo (3D de sesgos en Q, V, O), FFN con sesgos; posición del decoder 448×D
  const wh = (V, D, F, L, Ld, mels) => {
    const attn = 4 * D * D + 3 * D + 2 * D, ffn = 2 * D * F + F + D + 2 * D;
    return (3 * mels * D + D) + (3 * D * D + D) + L * (attn + ffn) + 2 * D + V * D + 448 * D + Ld * (2 * attn + ffn) + 2 * D;
  };
  assert.strictEqual(wh(51865, 768, 3072, 12, 12, 80), 240582912);
  assert.strictEqual(wh(51866, 1280, 5120, 32, 2, 128), 754485760);
  // el original de OpenAI registra la posición del encoder como buffer: 1,500 × D valores que HF cuenta
  assert.strictEqual(A.run('whisper-small').quantities.paramsHF - A.run('whisper-small').totals.params, 1500 * 768);
});

test('F12 reparto de parámetros (embedding compartido / encoder / decoder con cross / LM head)', () => {
  const m = A.metrics('t5-base', {});
  assert.strictEqual(m.sharedEmbedParams, 32128 * 768);
  assert.strictEqual(m.encoderParams, 109628544 - 32128 * 768);          // HF model.encoder sin la tabla compartida
  assert.strictEqual(m.decoderParams, 137949312 - 32128 * 768);
  assert.strictEqual(m.lmHeadParams, 0);                                   // atado
  assert.strictEqual(m.sharedEmbedParams + m.encoderParams + m.decoderParams + m.lmHeadParams, m.totalParams);
  assert.strictEqual(m.crossAttnParams, 12 * (4 * 768 * 768 + 768));
  assert.strictEqual(m.relBiasParams, 2 * 32 * 12);
  assert.strictEqual(A.metrics('flan-t5-base', {}).lmHeadParams, 32128 * 768);
  const w = A.metrics('whisper-small', {});
  assert.strictEqual(w.sharedEmbedParams + w.encoderParams + w.decoderParams + w.lmHeadParams, w.totalParams);
  assert.strictEqual(w.frontendParams, 3 * 80 * 768 + 768 + 3 * 768 * 768 + 768);
  assert.strictEqual(w.decoderPosParams, 448 * 768);
  assert.strictEqual(w.crossAttnParams, 12 * (4 * 768 * 768 + 3 * 768 + 2 * 768));
  // decode: los pesos que no corren son idle_params y el total no cambia; byNode igual en encoder y enc-out
  const p = A.run('whisper-small').totals.byNode, d = A.run('whisper-small-decode').totals.byNode;
  for (const k of ['conv', 'encoder', 'enc-out', 'decoder', 'cross-attn', 'self-attn', 'ffn', 'dec-norm', 'prompt-tokens']) assert.strictEqual(d[k].params, p[k].params, k);
  assert.strictEqual(d.encoder.macs + d.conv.macs, 0);
});

test('F12 MACs a mano: T5-base (teacher forcing) y el encoder de Whisper-small por ventana de 30 s', () => {
  const D = 768, I = 768, F = 3072, h = 12, dh = 64, V = 32128, L = 12, Tin = 512, Tout = 114;
  const enc = L * (Tin * (4 * D * I + 2 * D * F) + 2 * h * Tin * Tin * dh);
  const dec = L * (Tout * 4 * D * I + 2 * h * Tout * Tout * dh + Tout * 2 * D * I + Tin * 2 * D * I + 2 * h * Tout * Tin * dh + Tout * 2 * D * F);
  const r = A.run('t5-base');
  assert.strictEqual(r.totals.macs, enc + dec + Tout * D * V);
  assert.strictEqual(r.totals.flops, 141981401088);                       // = FlopCounterMode de HF (crosscheck)
  const we = 3000 * 768 * 3 * 80 + 1500 * 768 * 3 * 768 + 12 * (1500 * (4 * 768 * 768 + 2 * 768 * 3072) + 2 * 12 * 1500 * 1500 * 64);
  assert.strictEqual(A.metrics('whisper-small', {}).encoderMacs, we);
  assert.strictEqual(we, 172081152000);
});

test('F12 formas: encoder, cross-attention (T_out × T_in), front end de Whisper y decode', () => {
  const sh = (id, t) => A.run(id).tensors[t].num.join('×');
  assert.strictEqual(sh('t5-base', 'enc-out'), '512×768');
  assert.strictEqual(sh('t5-base', 'e-bias'), '12×512×512');
  assert.strictEqual(sh('t5-base', 'c-scores'), '12×114×512');
  assert.strictEqual(sh('t5-base', 'c-k'), '512×768');
  assert.strictEqual(sh('t5-base', 'logits'), '114×32128');
  assert.deepStrictEqual(J(A.run('t5-base').tensors['c-scores'].sym), ['h', 'T_out', 'T_in']);
  assert.strictEqual(sh('whisper-small', 'audio'), '480000');
  assert.strictEqual(sh('whisper-small', 'mel'), '3000×80');
  assert.strictEqual(sh('whisper-large-v3', 'mel'), '3000×128');
  assert.strictEqual(sh('whisper-small', 'conv2-out'), '1500×768');
  assert.strictEqual(sh('whisper-small', 'c-scores'), '12×128×1500');
  assert.strictEqual(sh('t5-base-decode', 'd-k-ctx'), '12×114×64');
  assert.strictEqual(sh('t5-base-decode', 'd-k-past'), '12×113×64');
  assert.strictEqual(sh('t5-base-decode', 'd-bias'), '12×1×114');
  assert.strictEqual(sh('t5-base-decode', 'c-k-heads'), '12×512×64');
  assert.strictEqual(sh('whisper-small-decode', 'c-scores'), '12×1×1500');
  const dr = A.run('whisper-small-decode');
  assert.strictEqual(dr.tensors['c-k-heads'].producer, null);             // la cross KV cache es una entrada
  assert.ok(!dr.tensors['c-k'] && !dr.tensors['enc-out'] && !dr.tensors['d-masked']);
  assert.ok(A.run('flan-t5-base').tensors['e-prod'] && !A.run('t5-base').tensors['e-prod']);
  assert.ok(!A.run('flan-t5-base').tensors['dec-out-scaled'] && A.run('t5-base').tensors['dec-out-scaled']);
});

test('F12 knobs: T_in solo mueve el encoder y la cross; seconds no cambia el cómputo (relleno a 30 s); límites', () => {
  const a = A.metrics('t5-base', {}), b = A.metrics('t5-base', { Tin: 128 });
  assert.strictEqual(A.run('t5-base', { Tin: 128 }).totals.params, A.run('t5-base').totals.params);
  assert.ok(b.encoderMacs < a.encoderMacs);
  assert.strictEqual(b.crossKvMacs, 2 * 12 * 128 * 768 * 768);
  assert.strictEqual(A.metrics('t5-base', { Tout: 16 }).encoderMacs, a.encoderMacs);   // el encoder corre una vez, no depende de T_out
  const w30 = A.metrics('whisper-small', {}), w5 = A.metrics('whisper-small', { seconds: 5 });
  assert.strictEqual(w5.encoderMacs, w30.encoderMacs);
  assert.strictEqual(A.run('whisper-small', { seconds: 5 }).totals.macs, A.run('whisper-small').totals.macs);
  assert.deepStrictEqual([w30.paddingShare, w5.usefulPositions, w5.paddingShare], [0, 250, 1 - 250 / 1500]);
  assert.ok(Math.abs(w5.realtimeFactor - 6 * w30.realtimeFactor) < 1e-12);  // mismo tiempo, 6× menos audio
  assert.match(A.run('whisper-small', { seconds: 5 }).notes.join(' '), /rellena/);
  assert.throws(() => A.run('whisper-small', { seconds: 31 }), /30 s/);
  assert.throws(() => A.run('whisper-small', { Tout: 449 }), /448/);
  assert.throws(() => A.run('t5-base', { decode: 1, Tout: 1 }), /≥ 2/);
  assert.throws(() => A.run('t5-base', { seconds: 4 }), /Knob inválido/);
  assert.throws(() => A.run('whisper-small', { Tin: 512 }), /Knob inválido/);   // Whisper: T_in = 1,500 fijo
  assert.match(A.run('t5-base', { Tin: 1024 }).notes.join(' '), /512/);
});

test('F12 generación: paso de decode del grafo = el modelo analítico; Σ pasos; K/V de la cross una vez', () => {
  for (const id of ['t5-base', 'flan-t5-base', 'whisper-small', 'distil-whisper-large-v3']) {
    const c = A.run(id).config;
    for (const T of [2, 37, 114]) {
      const m = A.metrics(id, { Tout: T }), d = A.run(id, { Tout: T, decode: 1 });
      assert.strictEqual(d.totals.macs, m.decoderMacsPerToken, id + ' T_out ' + T);
      assert.strictEqual(m.decoderLayerMacsPerToken + m.lmHeadMacsPerToken, m.decoderMacsPerToken);
      assert.strictEqual(m.decoderSelfMacsPerToken + m.decoderCrossMacsPerToken + m.decoderFfnMacsPerToken, m.decoderLayerMacsPerToken, id);
      // Σ_{t=1}^{T} paso(t) con los grafos de decode
      let s = 0;
      if (T <= 37) for (let t = 2; t <= T; t++) s += A.run(id, { Tout: t, decode: 1 }).totals.macs;
      if (T <= 37) assert.strictEqual(m.generationDecoderMacs, s + m.decoderMacsPerTokenFirst, id);
      assert.strictEqual(m.totalGenerationMacs, m.encoderMacs + m.crossKvMacs + m.generationDecoderMacs);
      // K y V de la cross (una vez) = las ops cross-k y cross-v del grafo de teacher forcing
      const r = A.run(id, { Tout: T });
      const kv = r.ops.filter((o) => o.id === 'cross-k' || o.id === 'cross-v').reduce((x, o) => x + o.macs * o.repeat, 0);
      assert.strictEqual(m.crossKvMacs, kv);
      assert.strictEqual(m.crossKvMacs, 2 * c.Ld * c.Tin * c.D * c.inner);
    }
  }
  // decode config = la de prefill con decode = 1
  assert.strictEqual(A.run('t5-base-decode').totals.macs, A.run('t5-base', { decode: 1 }).totals.macs);
  assert.strictEqual(A.metrics('t5-base-decode', {}).encoderMacs, A.metrics('t5-base', {}).encoderMacs);
  // generar vs teacher forcing: la diferencia es exactamente la mitad superior de QKᵀ y A·V de la self-attention (T(T−1)/2 por producto)
  const m = A.metrics('t5-base', {});
  assert.strictEqual(m.teacherForcedMacs - (m.encoderMacs + m.crossKvMacs + m.generationDecoderMacs), 2 * 12 * 12 * 64 * (114 * 113 / 2));
});

test('F12 KV: cross una vez por entrada vs self por token (bytes = HF EncoderDecoderCache en bf16)', () => {
  const m = A.metrics('whisper-small', {});
  assert.strictEqual(m.crossKvBytes, 2 * 12 * 1500 * 768 * 2);            // 55.3 MB, fijo aunque el audio dure 5 s
  assert.strictEqual(m.selfKvCacheBytes, 2 * 12 * 128 * 768 * 2);
  assert.strictEqual(m.selfKvBytesPerToken, 2 * 12 * 768 * 2);
  assert.strictEqual(A.metrics('whisper-small', { B: 4 }).crossKvBytes, 4 * m.crossKvBytes);
  assert.strictEqual(A.metrics('whisper-small', { dtype: 'fp32' }).crossKvBytes, 2 * m.crossKvBytes);
  const t = A.metrics('t5-base', {});
  assert.strictEqual(t.crossKvBytes, 18874368);
  assert.strictEqual(t.selfKvCacheBytes, 4202496);
  assert.strictEqual(A.run('t5-base').quantities.crossKvBytes, t.crossKvBytes);
  // distil: 2 capas de decoder → 16× menos cross KV que large-v3
  assert.strictEqual(A.metrics('whisper-large-v3', {}).crossKvBytes, 16 * A.metrics('distil-whisper-large-v3', {}).crossKvBytes);
});

test('F12 métricas: participación del encoder, tiempos ≈ (H100) y realtime factor; units conocidas', () => {
  for (const id of T5.concat(WH)) {
    const m = A.metrics(id, {});
    assert.ok(m.encoderShare > 0 && m.encoderShare < 1, id);
    assert.ok(Math.abs(m.encoderShare + m.crossKvShare + m.decoderShare - 1) < 1e-12, id);
    assert.ok(m.generationMs > 0 && m.decoderMs > m.decoderStepMs, id);
    for (const [k, u] of Object.entries(m.units)) assert.ok(['ratio', 'count', 'bytes', 'pct', 'macs', 'params', 'ms'].includes(u), id + ' ' + k);
    for (const k of Object.keys(m)) if (typeof m[k] === 'number' && !['params', 'macs', 'flops', 'other', 'attnMacs', 'attnMacsShare', 'scoreMacs', 'scoreMacsShare', 'linearMacs',
      'attnMem', 'attnMemAllLayers', 'actMem', 'actMemPerSample', 'paramMem', 'bytesPerElement', 'tokens', 'B', 'crossoverN', 'crossoverNProj', 'scoreToLinear'].includes(k)) assert.ok(m.units[k], id + ' ' + k + ' sin unidad');
    assert.strictEqual(m.toutScaling.length, 6);
  }
  const w = A.metrics('whisper-small', {});
  assert.ok(w.realtimeFactor < 0.01 && w.speedVsRealtime > 100);          // cota de roofline: muy por debajo del tiempo real
  assert.strictEqual(w.decoderStepBound, 'memoria');                       // un token por paso: limitado por memoria
  assert.ok(A.metrics('whisper-small', { bandwidth: 1e12 }).decoderMs > w.decoderMs);
  assert.ok(A.metrics('distil-whisper-large-v3', {}).generationMs < A.metrics('whisper-large-v3', {}).generationMs / 4);
  assert.ok(A.metrics('distil-whisper-large-v3', {}).encoderShare > 0.95);
  const sc = w.toutScaling;
  assert.ok(sc.every((x, i) => i === 0 || x.encoderShare < sc[i - 1].encoderShare), 'la participación del encoder baja con T_out');
});

test('F12 span corruption: random_spans_helper(512, 0.15, 3) = 568 crudos → 512 de entrada y 114 de objetivo', () => {
  const s = A.encdec.spanCorruption(512);
  assert.deepStrictEqual([s.tokens, s.noise, s.nonNoise, s.spans, s.inputs, s.targets], [568, 85, 483, 28, 512, 114]);
  const q = A.run('t5-base').quantities;
  assert.deepStrictEqual([q.spanRawTokens, q.spanInputTokens, q.spanTargetTokens, q.spanNoiseSpans], [568, 512, 114, 28]);
  assert.deepStrictEqual([A.run('t5-base').config.Tin, A.run('t5-base').config.Tout], [512, 114]);
  // redondeo bancario de Python: round(2.5) = 2
  assert.strictEqual(A.encdec.spanLengths(50, 0.05, 3).noise, 2);
});

test('F12 contrato §6.7 y totals.byPath coherentes en las 12 configs (y con knobs)', () => {
  const children = (r, pp) => {
    const out = new Set();
    for (const op of r.ops) if (op.path.length > pp.length && pp.every((p, i) => op.path[i] === p)) out.add(op.path[pp.length]);
    return Array.from(out);
  };
  const runs = T5.concat(WH).map((id) => A.run(id)).concat([A.run('whisper-tiny', { seconds: 7, Tout: 9 }), A.run('t5-small', { Tin: 33, Tout: 5, decode: 1 })]);
  for (const r of runs) {
    const t = r.totals;
    const check = (pp, want) => {
      const kids = children(r, pp);
      if (!kids.length) return;
      const at = (k) => t.byPath[pp.concat([k]).join('>')];
      assert.strictEqual(kids.reduce((s, k) => s + at(k).params, 0), want.params, r.id + ' params ' + pp.join('>'));
      assert.strictEqual(kids.reduce((s, k) => s + at(k).macs, 0), want.macs, r.id + ' MACs ' + pp.join('>'));
      kids.forEach((k) => check(pp.concat([k]), at(k)));
    };
    check([], t);
    assert.strictEqual(r.order.length, Object.keys(r.tensors).length);
    for (const id of r.order) {
      const x = r.tensors[id];
      if (x.producer) assert.ok(r.ops.find((o) => o.id === x.producer).out.includes(id), id);
      x.consumers.forEach((oid) => assert.ok(r.ops.find((o) => o.id === oid).in.includes(id), id + ' ← ' + oid));
    }
    for (const op of r.ops) for (const k of ['id', 'prim', 'label', 'path', 'in', 'out', 'repeat', 'params', 'macs', 'other', 'paramTex', 'paramArith', 'macTex', 'macArith', 'shapeTex']) assert.ok(k in op, op.id + '.' + k);
    assert.strictEqual(t.flops, 2 * t.macs);
  }
  // ids que usan los diagramas (contrato con build12/arch-ids.md)
  const r = A.run('t5-base');
  for (const n of ['embed', 'encoder', 'enc-attn', 'enc-ffn', 'enc-out', 'decoder', 'self-attn', 'cross-attn', 'ffn', 'dec-norm', 'lm-head', 'output', 'rel-bias']) assert.ok(r.totals.byNode[n], n);
  const w = A.run('whisper-small');
  for (const n of ['audio', 'mel', 'conv', 'encoder', 'enc-out', 'prompt-tokens', 'decoder', 'self-attn', 'cross-attn', 'ffn', 'dec-norm', 'lm-head', 'text']) assert.ok(w.totals.byNode[n], n);
});

test('F12 cantidades en prosa ({{…}}) de T5 y Whisper', () => {
  assert.strictEqual(Q.get('t5-base.params.total').text, '222,903,552');
  assert.strictEqual(Q.get('whisper-small.tensor.c-scores.shape').text, '12×128×1500');
  for (const id of ['t5-base', 'whisper-small', 'whisper-small-decode']) J(Q.keys(id)).forEach((k) => assert.ok(Q.get(id + '.' + k), id + '.' + k));
});
