/* Atlas de Arquitecturas — tests/practice.test.cjs
   Drills de práctica (SPEC §8.2) sobre todos los modelos: la respuesta de cada drill de parámetros es
   lo que su diagrama muestra para el nodo, cada drill de formas se puede responder con su texto y los
   datos de la tarjeta, y las métricas de DETR y de la fase 4 tienen etiqueta y formato. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROOT = join(__dirname, '..');
function load() {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const files = Array.from(html.matchAll(/<script src="([^"]+)"/g), (m) => m[1])
    .filter((f) => /^js\/(core|arch|content)\//.test(f) || f === 'js/ui/dom.js' || f === 'js/ui/practice.js');
  const ctx = vm.createContext({ console, setTimeout, clearTimeout });
  for (const f of files) vm.runInContext(readFileSync(join(ROOT, f), 'utf8'), ctx, { filename: f });
  return ctx.ATLAS;
}
const ATLAS = load();
const P = ATLAS.Practice, A = ATLAS.Arch;
// Revisión de la fase 10: lora y rlhf-dpo también entran en las barridas (drills de parámetros = diagrama, de formas = tarjeta).
const MODELS = ['vit', 'swin', 'clip', 'detr', 'deformable-detr', 'grounding-dino', 'yolov8', 'yolo-world', 'sam', 'sam2', 'llm', 'llava', 'qwen2-vl', 'stable-diffusion', 'dit', 'lora', 'rlhf-dpo', 'bert', 'retrieval', 'ann', 't5', 'whisper'];
const diagrams = ATLAS.diagrams();
// Fase 7 (VLM): símbolos de la torre de visión que la tarjeta de datos debe mostrar además de los genéricos (H, W, C, P, D, L,
// h, D_mlp, N, T, V, G): D_v, h_v, d_v, L_v, N_p y, en Qwen2-VL, F (frames). Mientras practice.js (factPairs) no los incluya,
// las barridas de formas los toman de aquí (mismos nombres que js/arch/vlm.js).
const vlmFacts = (cfg) => (cfg && cfg.Dv != null ? { D_v: cfg.Dv, h_v: cfg.hv, d_v: cfg.dv, L_v: cfg.Lv, N_p: cfg.Np, F: cfg.F } : {});
// Fase 8 (difusión): símbolos propios de las formas de js/arch/diffusion.js que la tarjeta debe mostrar además de los genéricos
// (H, W, C, T, V, h; DiT: P, D, L, h, D_mlp, N, K): SD — C_v (canales base del VAE), D_t (ancho del texto: 768 en SD 1.5, 2,048 en
// SDXL), h_t / d_t / L_t (cabezas, dim. por cabeza y capas del encoder de texto de SD 1.5); SDXL — d_h (64), D_1 / D_2, h_1 / h_2,
// d_1 / d_2 (los dos encoders de texto); DiT — I (lado del latente = res/8). Mientras practice.js (factPairs) no los incluya,
// las barridas los toman de aquí (mismos nombres que la cabecera de diffusion.js).
const diffFacts = (cfg) => {
  if (!cfg || (cfg.Cv == null && cfg.I == null)) return {};
  const f = cfg.I != null ? { I: cfg.I } : { C_v: cfg.Cv, D_t: cfg.Dtxt };
  if (cfg.ht) Object.assign(f, { h_t: cfg.ht, d_t: cfg.dt, L_t: cfg.Lt });
  if (cfg.headDim) f.d_h = cfg.headDim;
  (cfg.towers || []).forEach((tw, i) => { f['D_' + (i + 1)] = tw.D; f['h_' + (i + 1)] = tw.h; f['d_' + (i + 1)] = tw.D / tw.h; });
  return f;
};

// Lo que el diagrama escribe para un nodo (archdiagram.js nodeCost): por capa si todas las ops se
// repiten igual; Σ op × repeat si mezclan repeticiones; el total si es un grupo con repeat.totalOf.
function shownParams(R, node, total) {
  const ids = node.ops || [], pid = node.costOf || node.id;
  const ops = R.ops.filter((o) => ids.indexOf(o.id) >= 0 || (!node.opsExact && o.path && o.path.indexOf(pid) >= 0 && (!node.scope || o.path.indexOf(node.scope) >= 0)));
  const rep = Math.max(1, ...ops.map((o) => o.repeat || 1));
  // pesos compartidos entre ejecuciones (op.paramRepeat < op.repeat: LLaVA con varias imágenes, la política de DPO que corre
  // elegida + rechazada con UNA copia de los pesos): archdiagram.js muestra el total con paramRepeat.
  const pRep = (o) => (o.paramRepeat != null ? o.paramRepeat : o.repeat || 1);
  const mixed = ops.some((o) => (o.repeat || 1) !== rep || pRep(o) !== (o.repeat || 1));
  return ops.reduce((a, o) => a + (o.params || 0) * (total || mixed ? pRep(o) : 1), 0);
}

test('drills de parámetros: respuesta = lo que muestra el diagrama; prompt sin TeX crudo ni contexto repetido', () => {
  let n = 0;
  for (const model of MODELS) for (const { id: cfg } of A.configs(model)) {
    const R = A.run(cfg);
    for (const c of P._drillCandidates([{ model, configs: [cfg], pool: 'all' }], ['params'])) {
      const np = P._nodeParams(R, model, c.node);
      const prompt = np.label + np.qual;
      n++;
      if (np.diagram) {
        const d = diagrams[np.diagram];
        let want;
        if (c.node.group) {
          const g = d.groups.find((x) => x.id === c.node.group);
          want = shownParams(R, d.nodes.find((x) => x.id === g.repeat.totalOf), true);
        } else want = shownParams(R, d.nodes.find((x) => x.id === np.node), false);
        assert.strictEqual(np.total, want, c.id + ': ' + prompt);
      }
      assert.ok(!/_\{|\\|\^/.test(prompt), c.id + ': TeX crudo en «' + prompt + '»');
      const parts = np.label.split(' · ').map((x) => x.toLowerCase().replace(/[()]/g, ''));
      parts.forEach((a, i) => parts.forEach((b, j) => assert.ok(i === j || b.indexOf(a) < 0, c.id + ': contexto repetido en «' + prompt + '»')));
      // "con las N capas" solo si N es de verdad un número de capas de la config
      const m = prompt.match(/las (?:[A-Za-z_]+ = )?(\d+) capas/);
      if (m) {
        const cf = R.config;
        assert.ok([cf.L, cf.Lt, cf.Lenc, cf.Ldec, cf.Lv].indexOf(+m[1]) >= 0, c.id + ': «' + prompt + '»');
      }
    }
  }
  assert.ok(n > 300, 'se revisaron ' + n + ' drills');
  const R = A.run('detr-r50-800x1216');
  const bb = P._nodeParams(R, 'detr', { diagram: 'detr-overview', node: 'backbone' });
  assert.strictEqual(bb.total, 23454912);
  assert.ok(!/capas/.test(bb.qual) && !/Backbone \(ResNet-50\) · Backbone/.test(bb.label), bb.label + bb.qual);
});

test('drills de formas: cada dimensión sale de los datos de la tarjeta o del texto de la pregunta', () => {
  let n = 0;
  for (const model of MODELS) for (const { id: cfg } of A.configs(model)) {
    const R = A.run(cfg);
    for (const c of P._drillCandidates([{ model, configs: [cfg], pool: 'all' }], ['shape'])) {
      const Rc = c.ov ? A.run(cfg, c.ov) : R;   // fase 6: aristas con ov (carril de decode) → run(config, ov)
      const t = Rc.tensors[c.tensor];
      const known = {};
      P._drillFacts(Rc, c).forEach(([s, v]) => { known[s] = v; known[s.replace('_', '')] = v; });
      Object.entries(vlmFacts(Rc.config)).forEach(([s, v]) => { if (!(s in known)) known[s] = v; });
      Object.entries(diffFacts(Rc.config)).forEach(([s, v]) => { if (!(s in known)) known[s] = v; });
      known.dh = known.d_h != null ? known.d_h : (known.D != null ? known.D : known.D_t) / known.h;
      // Swin: cabezas y ventanas del stage que nombra la etiqueta (datos: H, M y h por stage)
      const st = (Rc.config.stages || []).find((s) => new RegExp('Stage ' + s.k + '\\b').test(t.label || ''));
      if (st) { known.h = st.h; known.nW = st.windows; }
      const text = (t.label || '') + ' ' + (t.tex || '');
      t.sym.forEach((sym, i) => {
        const str = String(sym);
        if (/^\d+$/.test(str)) return;
        const e = str.replace(/K_cls/g, 'Kcls').replace(/C_5/g, 'C5').replace(/\bhLK\b/g, '(h*L*K)').replace(/\bLK\b/g, '(L*K)')
          .replace(/D_\{?mlp\}?/g, 'Dmlp').replace(/d_h/g, 'dh').replace(/²/g, '**2').replace(/·/g, '*').replace(/(\d)([A-Za-z(])/g, '$1*$2');
        const ids = e.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
        if (ids.some((x) => !(x in known))) {
          assert.ok(new RegExp('\\b' + t.num[i] + '\\b').test(text), cfg + ' ' + c.tensor + ': «' + str + '» no sale de los datos (' + t.label + ')');
          return;
        }
        n++;
        const v = Function(...Object.keys(known), 'return ' + e)(...Object.values(known));
        assert.strictEqual(v, t.num[i], cfg + ' ' + c.tensor + ': ' + str);
      });
    }
  }
  assert.ok(n > 1000);
  // DETR: G y K (clases) en la tarjeta; Deformable DETR: L niveles, K puntos y K_cls clases
  const facts = (cfg) => Object.fromEntries(P._factPairs(A.run(cfg).config));
  assert.strictEqual(facts('detr-r50-800x1216').G, 7);
  assert.strictEqual(facts('detr-r50-800x1216').K, 91);
  assert.deepStrictEqual([facts('deformable-detr-r50').L, facts('deformable-detr-r50').K, facts('deformable-detr-r50').K_cls], [4, 4, 91]);
});

test('métricas de DETR: etiqueta, tipo y formato (bytes, %, cociente)', () => {
  const m = A.metrics('detr-r50-800x1216', {}), d = A.metrics('deformable-detr-r50', {});
  for (const k of Object.keys(m).concat(Object.keys(d))) {
    const v = m[k] != null ? m[k] : d[k];
    if (typeof v !== 'number' || /^(id|B|bytesPerElement|crossover|scoreToLinear)/.test(k)) continue;
    assert.notStrictEqual(P._metricLabel(k), k, 'sin etiqueta: ' + k);
  }
  assert.strictEqual(P._metricKind('encAttnMem2x'), 'bytes');
  assert.strictEqual(P._metricKind('encScoreShare'), 'pct');
  assert.strictEqual(P._metricKind('denseToDeform'), 'ratio');
  assert.match(P._metricNote('tokens', 'detr'), /sin CLS/);
  assert.doesNotMatch(P._metricNote('tokens', 'deformable-detr'), /incluye CLS/);
  const Q = ATLAS.Quantities;
  assert.strictEqual(Q.get('detr-r50-800x1216.metrics.encAttnMem2x').text, '231.0 MB');
  assert.strictEqual(Q.get('detr-r50-800x1216.metrics.encToCrossScore').text, '9.5');
  assert.strictEqual(Q.get('deformable-detr-r50.metrics.denseToDeform').text, '505');
  // tokens2x exacto (el nivel de stride 64 redondea hacia arriba), no 4·N
  assert.strictEqual(d.tokens2x, A.run('deformable-detr-r50', { H: 1600, W: 2432 }).config.N);
});

test('what-if: texto del cambio (H y W juntos, knobs con nombre) y métricas genéricas nulas en Deformable DETR', () => {
  assert.strictEqual(P._changeText({ H: 1600, W: 2432 }), 'imagen de 1600×2432 (H×W)');
  assert.strictEqual(P._changeText({ res: 640 }), 'resolución 640×640');
  assert.match(P._changeText({ Q: 300 }), /queries Q = 300/);
  const d = A.metrics('deformable-detr-r50', {});
  assert.strictEqual(d.attnMem, null);
  assert.strictEqual(d.scoreMacsShare, null);
  assert.ok(d.decSelfAttnMem > 0 && d.denseEncAttnMem > d.decSelfAttnMem);
});

test('fase 4: toda forma de Grounding DINO, YOLOv8 y YOLO-World sale de los datos de la tarjeta o de su etiqueta', () => {
  let n = 0;
  for (const cfg of ['grounding-dino-t', 'yolov8l-640', 'yolo-world-l-640']) {
    const R = A.run(cfg);
    const known = {};
    P._factPairs(R.config).forEach(([s, v]) => { known[s] = v; known[s.replace('_', '')] = v; });
    if (known.dh == null && known.D != null) known.dh = known.D / known.h;
    for (const id of R.order) {
      const t = R.tensors[id];
      const text = (t.label || '') + ' ' + (t.tex || '');
      t.sym.forEach((sym, i) => {
        const str = String(sym);
        if (/^\d+$/.test(str)) return;
        const e = str.replace(/\bhLK\b/g, '(h*L*K)').replace(/\bLK\b/g, '(L*K)').replace(/D_\{?mlp\}?/g, 'Dmlp').replace(/d_h/g, 'dh')
          .replace(/·/g, '*').replace(/(\d)([A-Za-z(])/g, '$1*$2');
        const ids = e.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
        if (ids.some((x) => !(x in known))) {
          assert.ok(new RegExp('\\b' + t.num[i] + '\\b').test(text), cfg + ' ' + id + ': «' + str + '» no sale de los datos (' + t.label + ')');
          return;
        }
        n++;
        assert.strictEqual(Function(...Object.keys(known), 'return ' + e)(...Object.values(known)), t.num[i], cfg + ' ' + id + ': ' + str);
      });
    }
  }
  assert.ok(n > 800, 'se revisaron ' + n + ' dimensiones');
  // datos de la tarjeta: Grounding DINO usa la notación de Deformable DETR (L niveles, K puntos) y C = 96 de Swin-T
  const f = Object.fromEntries(P._factPairs(A.run('grounding-dino-t').config));
  assert.deepStrictEqual([f.T, f.Q, f.L, f.K, f.C, f.D, f.N], [16, 900, 4, 4, 96, 256, 24990]);
  assert.strictEqual(Object.fromEntries(P._factPairs(A.run('yolo-world-l-640').config)).V, 80);
});

test('fase 4: drills de parámetros de Grounding DINO con capas (no pares de Swin) y su símbolo', () => {
  const R = A.run('grounding-dino-t');
  const prompts = P._drillCandidates([{ model: 'grounding-dino', configs: ['grounding-dino-t'], pool: 'all' }], ['params'])
    .map((c) => { const np = P._nodeParams(R, 'grounding-dino', c.node); return { id: c.id, np, prompt: np.label + np.qual }; });
  assert.ok(prompts.length > 30, prompts.length + ' drills');
  for (const { id, np, prompt } of prompts) {
    // "pares" / "stage" solo para las ops del backbone Swin-T
    if (!/img-backbone|merge/.test(id) && !/Swin/.test(np.label)) {
      assert.ok(!/pares|pareja|el stage/.test(prompt), id + ': «' + prompt + '»');
      assert.notStrictEqual(np.unit, 'par', id);
    }
  }
  const by = Object.fromEntries(prompts.map((x) => [x.id.split(':')[1], x]));
  assert.match(by.enhancer.prompt, /L_enc = 6/);
  assert.match(by.decoder.prompt, /L_dec = 6/);
  assert.match(by['txt-backbone'].prompt, /L_t = 12/);
  assert.strictEqual(by['txt-self'].prompt, 'Feature enhancer · texto: self-attention (una sola capa; hay L_enc = 6)');
  // Swin sigue con su unidad de pares
  const S = A.run('swin-t-224');
  const sw = P._drillCandidates([{ model: 'swin', configs: ['swin-t-224'], pool: 'all' }], ['params']).map((c) => P._nodeParams(S, 'swin', c.node));
  assert.ok(sw.some((np) => np.unit === 'par' || /pares/.test(np.qual)));
});

test('fase 4: métricas con etiqueta, tipo (units del calculador) y formato', () => {
  const skip = /^(id|B|bytesPerElement|crossover|scoreToLinear)/;
  for (const cfg of ['grounding-dino-t', 'grounding-dino-t-672', 'yolo-world-l-640', 'yolov8l-640']) {
    const model = A.run(cfg).model;
    const m = A.metrics(cfg, {});
    for (const k of Object.keys(m)) {
      if (typeof m[k] !== 'number' || skip.test(k)) continue;
      assert.notStrictEqual(P._metricLabel(k, model), k, cfg + ': sin etiqueta: ' + k);
      // el mapa units del calculador manda
      const u = m.units && m.units[k];
      const want = { ratio: 'ratio', count: 'count', bytes: 'bytes', pct: 'pct', macs: 'ops', params: 'count' }[u];
      if (want) assert.strictEqual(P._metricKind(k), want, cfg + ' ' + k);
    }
  }
  for (const k of ['macsVsYolov8', 'paramsVsYolov8', 'macsVsDetr', 'paramsVsDetr', 'macsVsYoloWorld', 'paramsVsYoloWorld', 'macsVsYoloWorldAt672', 'macsVsYoloWorldAt448',
    'vocabTextToOnline', 'gdinoToYoloWorldMacs', 'gdino672ToYoloWorldMacs', 'gdino448ToYoloWorldMacs', 'detrToYoloWorldMacs', 'yoloWorldToYolov8Macs', 'detrToYolov8Macs']) assert.strictEqual(P._metricKind(k), 'ratio', k);
  for (const k of ['fusionMacsShare', 'textEncoderMacsShare', 'samplingShare', 'enhancerMacsShare', 'neckMacsShare']) assert.strictEqual(P._metricKind(k), 'pct', k);
  for (const k of ['fusionAttnMem', 'decTextAttnMem', 'txtSelfAttnMem']) assert.strictEqual(P._metricKind(k), 'bytes', k);
  for (const k of ['textEncoderMacsMaxT', 'gdino672Macs', 'macsAt672', 'deltaMacsVsYolov8']) assert.strictEqual(P._metricKind(k), 'ops', k);
  const g = A.metrics('grounding-dino-t', {}), y = A.metrics('yolo-world-l-640', {});
  assert.match(P._fMetric('macsVsYolov8', g.macsVsYolov8), /^×5\.\d+$/);
  assert.strictEqual(P._fMetric('gdino448ToYoloWorldMacs', y.gdino448ToYoloWorldMacs), '×1.00');
  assert.strictEqual(P._fMetric('gdino672ToYoloWorldMacs', y.gdino672ToYoloWorldMacs), '×2.05');
  assert.match(P._fMetric('fusionAttnMem', g.fusionAttnMem), /MB$/);
  // tokens: nota y etiqueta por modelo (sin «incluye CLS»)
  assert.match(P._metricNote('tokens', 'grounding-dino'), /4 niveles.*sin CLS/);
  for (const md of ['yolo-world', 'yolov8']) {
    assert.match(P._metricNote('tokens', md), /P3–P5/);
    assert.doesNotMatch(P._metricNote('tokens', md), /CLS\)/);
    assert.strictEqual(P._metricLabel('tokens', md), 'Celdas A (P3–P5)');
  }
  // cantidades en prosa: el cociente casi entero lleva 2 decimales; los demás, 3 cifras
  const Q = ATLAS.Quantities;
  assert.strictEqual(Q.get('yolo-world-l-640.metrics.gdino448ToYoloWorldMacs').text, '1.00');
  assert.strictEqual(Q.get('grounding-dino-t-672.metrics.macsVsYoloWorld').text, '2.05');
  assert.strictEqual(Q.get('grounding-dino-t.metrics.macsVsYoloWorldAt672').text, '2.05');
  assert.strictEqual(Q.get('grounding-dino-t-672.macs.totalG').text, '181.68 G');
});

test('fase 4: configs a resolución comparable y base cuadrada del explorador', () => {
  // mismo modelo (mismos parámetros) a 672×672 y 448×448; la canónica sigue siendo 896×1344
  assert.strictEqual(A.canonical('grounding-dino'), 'grounding-dino-t');
  const t = A.run('grounding-dino-t'), t672 = A.run('grounding-dino-t-672'), t448 = A.run('grounding-dino-t-448');
  assert.deepStrictEqual([t672.totals.params, t448.totals.params], [t.totals.params, t.totals.params]);
  assert.strictEqual(t672.totals.macs, A.run('grounding-dino-t', { res: 672 }).totals.macs);
  assert.deepStrictEqual([t672.config.N, t448.config.N], [9382, 4165]);
  // knobBase: la resolución de una config no cuadrada no tiene base en la serie cuadrada
  assert.strictEqual(P._knobBase(t.config, 'res', [448, 672, 896, 1120]), null);
  assert.strictEqual(P._knobBase(t672.config, 'res', [448, 672, 896, 1120]), 672);
  assert.strictEqual(P._knobBase(A.run('swin-t-224').config, 'res', [224, 384]), 224);
  assert.strictEqual(P._knobBase(A.run('yolo-world-l-640').config, 'res', [320, 640]), 640);
});

test('fase 5: toda forma de SAM y SAM 2 sale de los datos de la tarjeta o de su etiqueta; tipos de métrica por units', () => {
  let n = 0;
  for (const cfg of ['sam-vit-h-1024', 'sam-vit-b-1024', 'sam2-hiera-l', 'sam2-hiera-t']) {
    const R = A.run(cfg);
    const known = {};
    P._factPairs(R.config).forEach(([s, v]) => { known[s] = v; known[s.replace('_', '')] = v; });
    if (known.dh == null && known.D != null) known.dh = known.D / known.h;
    for (const id of R.order) {
      const t = R.tensors[id];
      const text = (t.label || '') + ' ' + (t.tex || '');
      t.sym.forEach((sym, i) => {
        const str = String(sym);
        if (/^\d+$/.test(str)) return;
        const e = str.replace(/D_\{?mlp\}?/g, 'Dmlp').replace(/d_h/g, 'dh').replace(/²/g, '**2').replace(/·/g, '*').replace(/(\d)([A-Za-z(])/g, '$1*$2');
        const ids = e.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
        if (ids.some((x) => !(x in known))) {
          assert.ok(new RegExp('\\b' + t.num[i] + '\\b').test(text), cfg + ' ' + id + ': «' + str + '» no sale de los datos (' + t.label + ')');
          return;
        }
        n++;
        assert.strictEqual(Function(...Object.keys(known), 'return ' + e)(...Object.values(known)), t.num[i], cfg + ' ' + id + ': ' + str);
      });
    }
  }
  assert.ok(n > 1500, 'se revisaron ' + n + ' dimensiones');
  const f = Object.fromEntries(P._factPairs(A.run('sam-vit-h-1024').config));
  assert.deepStrictEqual([f.P, f.C, f.D, f.M, f.N, f.h], [1, 256, 1280, 14, 4096, 16]);
  // el mapa units del calculador solo usa unidades que la práctica sabe formatear, y cubre toda métrica numérica
  // cuyo nombre no basta (…Mem = bytes, …Share = %, el resto = conteo)
  for (const cfg of ['sam-vit-h-1024', 'sam2-hiera-l']) {
    const m = A.metrics(cfg, {});
    for (const [k, u] of Object.entries(m.units)) assert.ok(['ratio', 'count', 'bytes', 'pct', 'macs', 'params', 'ms'].includes(u), cfg + ' ' + k + ': ' + u);
    for (const k of Object.keys(m)) if (typeof m[k] === 'number' && /Macs$/.test(k) && !/^(attnMacs|scoreMacs|linearMacs)$/.test(k)) assert.ok(m.units[k], cfg + ' ' + k + ' sin unidad');
  }
});

test('fase 5: knobs, métricas, «Dónde se va el cómputo» y datos de la tarjeta de SAM / SAM 2 con la notación de su página', () => {
  // knobs por modelo: en SAM, P son clics; los knobs de SAM 2 tienen nombre y símbolo
  assert.strictEqual(P._knobLabel('P', 'sam'), 'Clics P');
  assert.strictEqual(P._knobLabel('P', 'vit'), 'Patch P');
  assert.strictEqual(P._knobLabel('memFrames', 'sam2'), 'Frames recientes Nᵣ');
  assert.strictEqual(P._knobShow('memFrames', 12, 'sam2'), 'Nᵣ = 12');
  assert.strictEqual(P._knobLabel('ptrs', 'sam2'), 'Punteros de objeto P');
  assert.strictEqual(P._knobLabel('maskIn', 'sam'), 'Máscara previa como prompt');
  assert.strictEqual(P._changeText({ P: 10 }, 'sam'), 'P = 10 clics');
  assert.strictEqual(P._changeText({ memFrames: 12 }, 'sam2'), 'Nᵣ = 12 frames recientes');
  assert.doesNotMatch(P._changeText({ P: 10 }, 'sam'), /[Pp]atch/);
  // métricas: toda clave numérica tiene etiqueta, y su tipo es el del mapa units del calculador
  const skip = /^(id|B|bytesPerElement|crossover|scoreToLinear)/;
  const UK = { ratio: 'ratio', count: 'count', bytes: 'bytes', pct: 'pct', macs: 'ops', params: 'count' };
  for (const cfg of ['sam-vit-h-1024', 'sam-vit-b-1024', 'sam2-hiera-l', 'sam2-hiera-t']) {
    const model = A.run(cfg).model, m = A.metrics(cfg, {});
    for (const k of Object.keys(m)) {
      if (typeof m[k] !== 'number' || skip.test(k)) continue;
      assert.notStrictEqual(P._metricLabel(k, model), k, cfg + ': sin etiqueta: ' + k);
      const u = m.units && m.units[k];
      if (UK[u]) assert.strictEqual(P._metricKind(k), UK[u], cfg + ' ' + k);
    }
    assert.doesNotMatch(P._metricNote('tokens', model), /incluye CLS/);
    assert.match(P._metricNote('tokens', model), /sin CLS/);
  }
  const ms = A.metrics('sam-vit-h-1024', {}), m2 = A.metrics('sam2-hiera-l', {});
  assert.strictEqual(P._fMetric('breakEvenPrompts', ms.breakEvenPrompts), '1,645');
  assert.strictEqual(P._fMetric('encoderToDecoder', ms.encoderToDecoder), '×1,645');
  assert.strictEqual(P._fMetric('globalToWinAttnMem', ms.globalToWinAttnMem), '×17.5');
  assert.strictEqual(P._fMetric('padOverhead', ms.padOverhead), '19.6 %');
  assert.strictEqual(P._fMetric('memoryBankMem', m2.memoryBankMem), '7.35 MB');
  assert.strictEqual(P._fMetric('memToImgEmb', m2.memToImgEmb), '×0.25');
  assert.strictEqual(P._metricLabel('decoderMacsPerPrompt', 'sam'), 'MACs por prompt (prompt encoder + decoder)');
  // reparto del cómputo: los segmentos suman el total y nombran lo que corre por prompt / por objeto
  for (const [cfg, model, re] of [['sam-vit-h-1024', 'sam', /por prompt/], ['sam2-hiera-l', 'sam2', /por objeto/], ['sam2-hiera-t', 'sam2', /por objeto/]]) {
    const m = A.metrics(cfg, { dtype: 'fp16' });
    const sp = P._splitSegments(m, model);
    assert.ok(sp && sp.segs.length >= 5, cfg);
    assert.match(sp.title, re);
    assert.ok(Math.abs(sp.segs.reduce((a, x) => a + x.v, 0) - m.macs) <= 0.0005 * m.macs, cfg + ': los segmentos no suman los MACs');
    assert.ok(sp.segs.every((x) => !/QKᵀ y A·V\) vs el resto/.test(x.label)));
  }
  // datos de la tarjeta: SAM separa patch (16) de clics (P); SAM 2 no muestra P = 0 (clics): P = punteros
  const fs = P._factPairs(A.run('sam-vit-h-1024').config), f2 = P._factPairs(A.run('sam2-hiera-l').config);
  const by = (fp) => Object.fromEntries(fp.map(([s, v, n]) => [s, { v, n }]));
  assert.deepStrictEqual([by(fs).patch.v, by(fs).P.v, by(fs).P.n], [16, 1, 'clic']);
  const b2 = by(f2);
  assert.deepStrictEqual([b2.P.v, b2.C_m.v, b2.N_r.v, b2.N_p.v, b2.L_m.v, b2.h.v, b2.D.v, b2.D_mlp.v], [16, 64, 6, 1, 4, 2, 144, 2048]);
  assert.match(b2.h.n, /stage 1/);
  assert.match(b2.D_mlp.n, /memory attention/);
  assert.strictEqual(b2.L.v, '2 / 6 / 36 / 4');
});

test('fase 5: drills de SAM 2 sin prompts repetidos con respuestas distintas; el paréntesis numérico no se pierde', () => {
  for (const cfg of ['sam-vit-h-1024', 'sam-vit-l-1024', 'sam-vit-b-1024', 'sam2-hiera-l', 'sam2-hiera-bplus', 'sam2-hiera-s', 'sam2-hiera-t']) {
    const R = A.run(cfg), model = R.model;
    const seen = {};
    for (const c of P._drillCandidates([{ model, configs: [cfg], pool: 'all' }], ['shape', 'params'])) {
      let prompt, ans;
      if (c.kind === 'params') { const np = P._nodeParams(R, model, c.node); prompt = 'P:' + np.label + np.qual; ans = np.total; }
      else { const t = R.tensors[c.tensor]; prompt = 'S:' + t.label + '|' + t.tex; ans = t.num.join('×'); }
      if (seen[prompt] != null) assert.strictEqual(String(seen[prompt]), String(ans), cfg + ': «' + prompt + '» pregunta dos cosas distintas');
      seen[prompt] = ans;
    }
  }
  const R = A.run('sam2-hiera-l');
  const np = P._nodeParams(R, 'sam2', { op: 'me-ds1-conv' }) || P._drillCandidates([{ model: 'sam2', configs: ['sam2-hiera-l'], pool: 'all' }], ['params'])
    .map((c) => P._nodeParams(R, 'sam2', c.node)).find((x) => x.ops.some((o) => o.id === 'me-ds1-conv'));
  assert.match(np.label, /1 → 4/);
});

test('fase 6: toda forma del modelo llm (prefill y decode, denso y MoE) sale de los datos de la tarjeta o de su etiqueta; units conocidas', () => {
  let n = 0;
  for (const cfg of ['llama3-8b', 'llama3-70b', 'llama2-7b', 'mixtral-8x7b', 'llama3-8b-decode', 'mixtral-8x7b-decode']) {
    for (const ov of [{}, { decode: 1 }]) {
      const R = A.run(cfg, ov);
      const known = {};
      P._factPairs(R.config).forEach(([s, v]) => { known[s] = v; known[s.replace('_', '')] = v; });
      if (known.dh == null && known.D != null) known.dh = known.D / known.h;
      for (const id of R.order) {
        const t = R.tensors[id];
        const text = (t.label || '') + ' ' + (t.tex || '');
        t.sym.forEach((sym, i) => {
          const str = String(sym);
          if (/^\d+$/.test(str)) return;
          const e = str.replace(/D_\{?mlp\}?/g, 'Dmlp').replace(/d_h/g, 'dh').replace(/·/g, '*').replace(/(\d)([A-Za-z(])/g, '$1*$2');
          const ids = e.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
          if (ids.some((x) => !(x in known))) {
            // decode: ctx (contexto de la KV cache) va en la etiqueta del tensor con su número
            const v = ids.includes('ctx') ? Function('ctx', 'return ' + e.replace(/[A-Za-z_]+(?<!ctx)\b/g, (m) => (m in known ? known[m] : m)))(R.config.ctx) : t.num[i];
            assert.strictEqual(v, t.num[i], cfg + ' ' + id + ': ' + str);
            assert.ok(new RegExp('\\b' + (ids.includes('ctx') ? A.fmt.int(R.config.ctx) : t.num[i]) + '\\b').test(text) || ids.includes('ctx') && /ctx/.test(R.label), cfg + ' ' + id + ': «' + str + '» no sale de los datos (' + t.label + ')');
            return;
          }
          n++;
          assert.strictEqual(Function(...Object.keys(known), 'return ' + e)(...Object.values(known)), t.num[i], cfg + ' ' + id + ': ' + str);
        });
      }
    }
  }
  assert.ok(n > 300, 'se revisaron ' + n + ' dimensiones');
  // datos de la tarjeta (genéricos): G = cabezas KV (grupos de GQA) sale de la config
  const f = Object.fromEntries(P._factPairs(A.run('llama3-8b').config));
  assert.deepStrictEqual([f.D, f.L, f.h, f.G, f.D_mlp, f.T, f.V], [4096, 32, 32, 8, 14336, 2048, 128256]);
  // un paso de decode: ctx (largo de la KV cache) en vez de T
  const fd = Object.fromEntries(P._factPairs(A.run('llama3-8b-decode').config).map(([s, v]) => [s, v]));
  assert.deepStrictEqual([fd.ctx, fd.T], [4096, undefined]);
  // el mapa units del calculador solo usa unidades que la práctica sabe formatear
  for (const cfg of ['llama3-8b', 'mixtral-8x7b']) {
    const m = A.metrics(cfg, {});
    for (const [k, u] of Object.entries(m.units)) assert.ok(['ratio', 'count', 'bytes', 'pct', 'macs', 'params', 'ms'].includes(u), cfg + ' ' + k + ': ' + u);
  }
});

test('fase 6 (revisión): ov en huecos y drills de formas, configs de decode, huecos sin descripciones repetidas, etiquetas LLM', () => {
  // Huecos de forma en aristas con ov (carril de decode): la respuesta es la forma de run(config, ov), como la dibuja el motor.
  let nOv = 0;
  for (const d of Object.values(diagrams)) {
    if (d.kind === 'map' || !d.config) continue;
    for (const e of (d.edges || []).filter((x) => x.ov && x.tensor)) {
      const k = P._blankKey({ diagram: d.id, slots: [{ edge: e.from + '>' + e.to, ask: 'shape' }] });
      const want = A.run(d.config, e.ov).tensors[e.tensor].num.join('×');
      assert.strictEqual(k.slots[0].correct.text, want, d.id + ' ' + e.from + '>' + e.to);
      nOv++;
    }
  }
  assert.ok(nOv >= 2, 'aristas con ov: ' + nOv);
  // Drills de formas: las aristas con ov dan candidatos con ov y la forma de run(config, ov); sin preguntas repetidas.
  const cands = P._drillCandidates([{ model: 'llm', configs: ['llama3-8b'], pool: 'all' }], ['shape']);
  const ovc = cands.filter((c) => c.ov);
  assert.ok(ovc.length >= 1);
  ovc.forEach((c) => { assert.match(c.id, /~decode=1:/); assert.ok(A.run('llama3-8b', c.ov).tensors[c.tensor]); });
  assert.strictEqual(new Set(cands.map((c) => c.id)).size, cands.length);
  // Config de decode: pregunta la KV cache de todo el contexto (G×ctx×d_h) y no repite el carril {decode: 1}.
  const dc = P._drillCandidates([{ model: 'llm', configs: ['llama3-8b-decode'], pool: 'all' }], ['shape']);
  assert.ok(dc.some((c) => c.tensor === 'k-ctx'));
  const sig = dc.map((c) => A.run(c.config, c.ov).label + '|' + c.tensor);
  assert.strictEqual(new Set(sig).size, sig.length);
  // Parámetros: el nodo de la FFN en Mixtral se nombra como MoE (no "FFN SwiGLU" con la respuesta de 8 expertos + router);
  // los nodos que toman el costo de otro (costOf) no repiten la pregunta del bloque.
  const mx = A.run('mixtral-8x7b');
  for (const c of P._drillCandidates([{ model: 'llm', configs: ['mixtral-8x7b'], pool: 'all' }], ['params'])) {
    const np = P._nodeParams(mx, 'llm', c.node);
    if (np.node === 'ffn') assert.doesNotMatch(np.label, /SwiGLU/, np.label);
  }
  const l2 = A.run('llama2-7b');
  const attn = P._drillCandidates([{ model: 'llm', configs: ['llama2-7b'], pool: 'all' }], ['params']).map((c) => P._nodeParams(l2, 'llm', c.node)).find((np) => np.node === 'attn');
  if (attn) assert.doesNotMatch(attn.label, /GQA/, attn.label);
  const p8 = P._drillCandidates([{ model: 'llm', configs: ['llama3-8b'], pool: 'all' }], ['params']).map((c) => c.node && c.node.node);
  assert.ok(!p8.includes('prefill') && !p8.includes('decode'));
  // Ninguna lista de huecos tiene dos descripciones iguales (todas las páginas).
  const items = (ATLAS.catalog && ATLAS.catalog().items) || {};
  const walk = (b, f) => { if (!b || typeof b !== 'object') return; if (Array.isArray(b)) { b.forEach((x) => walk(x, f)); return; } if (b.t) f(b); Object.keys(b).forEach((k) => { if (typeof b[k] === 'object') walk(b[k], f); }); };
  let nb = 0;
  for (const id of Object.keys(items)) {
    const page = ATLAS.getPage ? ATLAS.getPage(id) : null;
    if (!page) continue;
    walk(page.sections, (b) => {
      if (b.t !== 'blankdiagram') return;
      const k = P._blankKey(b);
      const ds = k.slots.map((s) => s.desc);
      assert.strictEqual(new Set(ds).size, ds.length, b.diagram + ': ' + ds.join(' | '));
      // Revisión de la fase 12: dos huecos en el mismo lugar se pisan (el segundo borra el marcador del primero).
      const ids = k.slots.map((s) => s.id);
      assert.strictEqual(new Set(ids).size, ids.length, b.diagram + ': huecos repetidos ' + ids.join(' | '));
      nb++;
    });
  }
  assert.ok(nb >= 10, 'diagramas en blanco: ' + nb);
  // Un hueco de forma sobre un tensor que ninguna arista lleva (Whisper: conv2-act, dentro del front end) va a la arista que
  // sale del nodo con la MISMA forma (conv > encoder: e-x0, 1500 × D), no al nodo (donde pisaría el hueco de etiqueta).
  {
    const k = P._blankKey({ diagram: 'whisper-overview', slots: [{ node: 'conv', ask: 'label' }, { node: 'conv', tensor: 'conv2-act', ask: 'shape' }] });
    assert.deepStrictEqual(Array.from(k.slots, (s) => s.id), ['conv', 'conv>encoder']);
    assert.strictEqual(k.slots[1].correct.id, A.run('whisper-small').tensors['conv2-act'].num.join('×'));
  }
  // Knobs de bits del LLM: pesos y KV por separado.
  assert.strictEqual(P._knobLabel('bits', 'llm'), 'Bits de los pesos');
  assert.strictEqual(P._knobLabel('kvBits', 'llm'), 'Bits de la KV cache');
  assert.match(P._changeText({ kvBits: 8 }, 'llm'), /KV cache a 8 bits/);
  for (const k of ['quantizedLinearBytes', 'unquantizedBytes', 'kvPlusWeightsBytes', 'hbmHeadroomBytes']) {
    assert.notStrictEqual(P._metricLabel(k, 'llm'), k);
    assert.strictEqual(P._metricKind(k), 'bytes');
  }
  assert.match(P._fMetric('kvPlusWeightsBytes', A.metrics('llama3-8b', { bits: 4 }).kvPlusWeightsBytes), /^6\.13 GB$/);
  // expertos leídos por capa: un conteo esperado, no un factor (sin «×»)
  assert.strictEqual(P._metricKind('decodeExpertsReadPerLayer'), 'avg');
  assert.match(P._fMetric('decodeExpertsReadPerLayer', A.metrics('mixtral-8x7b', { B: 8 }).decodeExpertsReadPerLayer), /^≈ 7\.2( de 8)?$/);
  assert.match(P._fMetric('decodeExpertsReadPerLayer', 2), /^2( de 8)?$/);
});

test('fase 7: toda forma de LLaVA y Qwen2-VL (imagen, varias imágenes, video) sale de los datos de la tarjeta (+ los de la torre de visión); units conocidas', () => {
  let n = 0;
  const cases = [['llava15-7b', [{}, { images: 2 }]], ['llava15-13b', [{}]], ['qwen2-vl-7b', [{}, { frames: 4 }, { H: 448, W: 672 }]], ['qwen2-vl-2b', [{}]], ['qwen2-vl-72b', [{}]]];
  for (const [cfg, ovs] of cases) {
    for (const ov of ovs) {
      const R = A.run(cfg, ov);
      const known = {};
      P._factPairs(R.config).forEach(([s, v]) => { known[s] = v; known[s.replace('_', '')] = v; });
      Object.entries(vlmFacts(R.config)).forEach(([s, v]) => { if (!(s in known)) known[s] = v; });
      known.dh = R.config.dh;
      for (const id of R.order) {
        const t = R.tensors[id];
        const text = (t.label || '') + ' ' + (t.tex || '');
        t.sym.forEach((sym, i) => {
          const str = String(sym);
          if (/^\d+$/.test(str)) return;
          const e = str.replace(/D_\{?mlp\}?/g, 'Dmlp').replace(/d_h/g, 'dh').replace(/·/g, '*').replace(/(\d)([A-Za-z(])/g, '$1*$2');
          const ids = e.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
          if (ids.some((x) => !(x in known))) {
            assert.ok(new RegExp('\\b' + t.num[i] + '\\b').test(text), cfg + ' ' + id + ': «' + str + '» no sale de los datos (' + t.label + ')');
            return;
          }
          n++;
          // h, D_mlp y d_h son los del LLM; la torre de visión usa h_v, 4D_v y d_v (no deben aparecer los del LLM en la torre)
          assert.strictEqual(Function(...Object.keys(known), 'return ' + e)(...Object.values(known)), t.num[i], cfg + ' ' + id + ': ' + str);
        });
      }
    }
    const m = A.metrics(cfg, {});
    for (const [k, u] of Object.entries(m.units)) assert.ok(['ratio', 'count', 'bytes', 'pct', 'macs', 'params', 'ms'].includes(u), cfg + ' ' + k + ': ' + u);
  }
  assert.ok(n > 400, 'se revisaron ' + n + ' dimensiones');
  // datos genéricos de la tarjeta: D, L, h, G, D_mlp del LLM; N = tokens visuales; T = de texto
  const f = Object.fromEntries(P._factPairs(A.run('qwen2-vl-7b').config));
  assert.deepStrictEqual([f.D, f.L, f.h, f.G, f.D_mlp, f.N, f.T, f.H, f.W, f.P], [3584, 28, 28, 4, 18944, 841, 64, 812, 812, 14]);
});

test('fase 8: toda forma de Stable Diffusion (inferencia, entrenamiento, SDXL) y DiT (incl. flow matching) sale de los datos de la tarjeta (+ los de difusión); units conocidas', () => {
  let n = 0;
  const cases = [['sd15-unet', [{}, { cfg: 0 }, { res: 768 }]], ['sd15-train', [{}]], ['sdxl-unet', [{}]], ['dit-xl2-256', [{}, { patch: 4 }]], ['dit-xl2-512', [{}]],
    ['dit-b2-256', [{}]], ['dit-xl8-256', [{}]], ['dit-xl2-256-fm', [{}]]];
  for (const [cfg, ovs] of cases) {
    for (const ov of ovs) {
      const R = A.run(cfg, ov);
      const known = {};
      P._factPairs(R.config).forEach(([s, v]) => { known[s] = v; known[s.replace('_', '')] = v; });
      Object.entries(diffFacts(R.config)).forEach(([s, v]) => { if (!(s in known)) known[s] = v; });
      known.dh = known.d_h != null ? known.d_h : known.D / known.h;
      for (const id of R.order) {
        const t = R.tensors[id];
        const text = (t.label || '') + ' ' + (t.tex || '');
        t.sym.forEach((sym, i) => {
          const str = String(sym);
          if (/^\d+$/.test(str)) return;
          const e = str.replace(/D_\{?mlp\}?/g, 'Dmlp').replace(/d_h/g, 'dh').replace(/²/g, '**2').replace(/·/g, '*').replace(/(\d)([A-Za-z(])/g, '$1*$2');
          const ids = e.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
          if (ids.some((x) => !(x in known))) {
            assert.ok(new RegExp('\\b' + t.num[i] + '\\b').test(text), cfg + ' ' + id + ': «' + str + '» no sale de los datos (' + t.label + ')');
            return;
          }
          n++;
          assert.strictEqual(Function(...Object.keys(known), 'return ' + e)(...Object.values(known)), t.num[i], cfg + ' ' + id + ': ' + str);
        });
      }
    }
    const m = A.metrics(cfg, {});
    for (const [k, u] of Object.entries(m.units)) assert.ok(['ratio', 'count', 'bytes', 'pct', 'macs', 'params', 'ms'].includes(u), cfg + ' ' + k + ': ' + u);
  }
  assert.ok(n > 3000, 'se revisaron ' + n + ' dimensiones');
  // datos genéricos de la tarjeta: SD 1.5 (H, W, C = 320, h = 8, T = 77, V); DiT (P, D, L, h, D_mlp, N, K)
  const f = Object.fromEntries(P._factPairs(A.run('sd15-unet').config));
  assert.deepStrictEqual([f.H, f.W, f.C, f.h, f.T, f.V], [512, 512, 320, 8, 77, 49408]);
  const fd = Object.fromEntries(P._factPairs(A.run('dit-xl2-256').config));
  assert.deepStrictEqual([fd.P, fd.D, fd.L, fd.h, fd.D_mlp, fd.N, fd.K], [2, 1152, 28, 16, 4608, 256, 1000]);
});

test('fase 8 (revisión): ms con decimales, una entrada por métrica, % como valor, T y K con nota, prompts de parámetros únicos', () => {
  // ms: 3 cifras significativas en todos los formateadores (fMetric: explorador, what-if, tablas)
  A.metrics('sd15-unet', {});
  P._metricKind('vaeDecodeMs');
  assert.strictEqual(P._fMetric('unetNfeMs', 1.624415), '1.62 ms');
  assert.strictEqual(P._fMetric('vaeDecodeMs', 2.5425), '2.54 ms');
  assert.strictEqual(P._fMetric('msPerImage', 83.8367), '83.8 ms');
  assert.strictEqual(P._fMetric('samplingMs', 120.57), '121 ms');
  // METRICS sin claves repetidas (en un literal, la última pisa a la primera sin aviso)
  const src = readFileSync(join(ROOT, 'js/ui/practice.js'), 'utf8');
  const lit = src.slice(src.indexOf('const METRICS = {'), src.indexOf('const metricNote'));
  const keys = Array.from(lit.matchAll(/^ {4}([A-Za-z0-9_]+): \{/gm), (m) => m[1]);
  const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
  assert.deepStrictEqual(dup, [], 'claves repetidas en METRICS: ' + dup.join(', '));
  assert.strictEqual(P._metricLabel('textEncoderMacs', 'grounding-dino'), 'MACs del texto (BERT + proyección)');
  assert.match(P._metricNote('textEncoderMacs', 'grounding-dino'), /CADA imagen/);
  assert.strictEqual(P._metricLabel('textEncoderMacs', 'stable-diffusion'), 'MACs del text encoder');
  assert.match(P._metricNote('textEncoderParams', 'yolo-world'), /offline/);
  assert.match(P._metricNote('textEncoderParams', 'stable-diffusion'), /CLIP ViT-L\/14/);
  // un % se pregunta por su valor (las opciones nunca pasan de 100 %), salvo expect: 'factor'
  assert.strictEqual(P._asksValue({ ask: 'selfScoreShareUnet' }, '¿Qué pasa con la parte de la U-Net que es QKᵀ y A·V?'), true);
  assert.strictEqual(P._asksValue({ ask: 'selfScoreShareUnet', expect: 'factor' }, '¿Qué pasa?'), false);
  assert.strictEqual(P._asksValue({ ask: 'macs' }, '¿Qué pasa con los MACs?'), false);
  const b = A.metrics('sd15-unet', {}).selfScoreShareUnet, a = A.metrics('sd15-unet', { res: 1024 }).selfScoreShareUnet;
  for (const seed of ['a', 'b', 'c', 'd']) P._valueOptions('selfScoreShareUnet', b, a, seed).forEach((o) => assert.ok(o.v <= 1, o.text));
  // T y K con nota en la tarjeta de datos
  const ts = P._factPairs(A.run('sd15-unet').config).find((x) => x[0] === 'T');
  assert.match(ts[2], /tokens de texto de CLIP/);
  const ks = P._factPairs(A.run('dit-xl2-256').config).find((x) => x[0] === 'K');
  assert.match(ks[2], /clases de ImageNet/);
  // prompts de parámetros: la misma pregunta nunca tiene dos respuestas (sd-resblock: dos 'Conv 3×3')
  for (const cfg of A.configs().map((c) => c.id)) {
    const R = A.run(cfg), model = R.model, seen = {};
    for (const c of P._drillCandidates([{ model, configs: [cfg], pool: 'all' }], ['params'])) {
      const np = P._nodeParams(R, model, c.node), prompt = np.label + np.qual;
      if (seen[prompt] != null) assert.strictEqual(seen[prompt], np.total, cfg + ': «' + prompt + '» pregunta dos cosas distintas');
      seen[prompt] = np.total;
    }
  }
});

test('fase 8 (revisión): cada fila de un bloque compare tiene etiqueta y formato en blocks.js', () => {
  const ctx = vm.createContext({ console, setTimeout, clearTimeout });
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const files = Array.from(html.matchAll(/<script src="([^"]+)"/g), (m) => m[1]).filter((f) => /^js\/(core|arch|content)\//.test(f) || f === 'js/ui/dom.js' || f === 'js/ui/blocks.js');
  for (const f of files) vm.runInContext(readFileSync(join(ROOT, f), 'utf8'), ctx, { filename: f });
  const B = ctx.ATLAS.Blocks, AT = ctx.ATLAS;
  assert.ok(B && Array.isArray(B.COMPARE_METRICS));
  const walk = (arr, out) => (arr || []).forEach((b) => { if (!b || typeof b !== 'object') return; if (b.t === 'compare') out.push(b); if (Array.isArray(b.blocks)) walk(b.blocks, out); });
  const bad = [];
  for (const id of Object.keys(AT.catalog().items || {})) {
    const p = AT.getPage(id);
    if (!p) continue;
    const out = [];
    (p.sections || []).forEach((s) => walk(s.blocks, out));
    // una fila sin entrada solo vale si es un campo de la config (D, L…): las métricas necesitan su formato (un % no es «0»)
    out.forEach((b) => (b.rows || []).forEach((k) => {
      if (B.COMPARE_METRICS.includes(k)) return;
      const runs = (b.models || []).map((m) => { try { return AT.Arch.run(m); } catch (e) { return null; } }).filter(Boolean);
      if (!runs.every((r) => r.config && typeof r.config[k] === 'number')) bad.push(id + ': ' + k);
    }));
  }
  assert.deepStrictEqual(bad, []);
});

test('fase 9: un diagrama calc: false no da drills de formas ni de parámetros (va al final: registra un diagrama de prueba)', () => {
  ATLAS.registerDiagram({ id: 'zz-nocalc', kind: 'arch', model: 'dit', calc: false, calcNote: 'prueba', title: 'Prueba', caption: 'Prueba.', grid: { w: 40, h: 12 },
    nodes: [{ id: 'a', op: 'io', label: 'Imagen', x: 1, y: 2, w: 8, h: 4 }, { id: 'patchify', op: 'conv', label: 'Patchify', x: 20, y: 2, w: 10, h: 4 }],
    edges: [{ from: 'a', to: 'patchify', kind: 'data', tag: 'imagen' }] });
  const cands = P._drillCandidates([{ model: 'dit', configs: ['dit-xl2-256'], pool: 'all' }], ['shape', 'params']);
  assert.ok(cands.length > 0);
  assert.ok(!cands.some((c) => c.node && c.node.diagram === 'zz-nocalc'), 'drill desde un diagrama calc: false');
});

// ================================================================ FASE 9 (VLA) — bloque del agente arch
// La tarjeta del drill (practice.js factPairs) trae los símbolos propios de js/arch/vla.js además de los genéricos: DINOv2 D_d,
// h_d, d_d, L_d; SigLIP D_s, h_s, d_s, M_s (= 4,304), L_s; π0 D_a (experto), H_a (chunk), d_a (acción/estado); d_h. La barrida
// usa SOLO la tarjeta real (sin datos inyectados por el test).
test('fase 9: toda forma de OpenVLA y π0 (1 y 3 cámaras, otros H / pasos / T) sale de los datos de la tarjeta; units conocidas', () => {
  let n = 0;
  const cases = [['openvla-7b', [{}, { T: 64 }, { res: 336, images: 2, da: 4 }]], ['pi0', [{}, { cams: 2, H: 25, steps: 5, T: 16 }]], ['pi0-1cam', [{}]]];
  for (const [cfg, ovs] of cases) {
    for (const ov of ovs) {
      const R = A.run(cfg, ov);
      const known = {};
      P._factPairs(R.config).forEach(([s, v]) => { if (typeof v === 'number') { known[s] = v; known[s.replace('_', '')] = v; } });
      for (const id of R.order) {
        const t = R.tensors[id];
        const text = (t.label || '') + ' ' + (t.tex || '');
        t.sym.forEach((sym, i) => {
          const str = String(sym);
          if (/^\d+$/.test(str)) return;
          const e = str.replace(/D_\{?mlp\}?/g, 'Dmlp').replace(/d_h/g, 'dh').replace(/·/g, '*').replace(/(\d)([A-Za-z(])/g, '$1*$2');
          const ids = e.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
          if (ids.some((x) => !(x in known))) {
            assert.ok(new RegExp('\\b' + t.num[i] + '\\b').test(text), cfg + ' ' + id + ': «' + str + '» no sale de los datos (' + t.label + ')');
            return;
          }
          n++;
          assert.strictEqual(Function(...Object.keys(known), 'return ' + e)(...Object.values(known)), t.num[i], cfg + ' ' + id + ': ' + str);
        });
      }
    }
    const m = A.metrics(cfg, {});
    for (const [k, u] of Object.entries(m.units)) assert.ok(['ratio', 'count', 'bytes', 'pct', 'macs', 'params', 'ms'].includes(u), cfg + ' ' + k + ': ' + u);
  }
  assert.ok(n > 800, 'se revisaron ' + n + ' dimensiones');
  // datos genéricos de la tarjeta: OpenVLA = los del LLM (Llama 2 7B) + N = 256 visuales, T = 22; π0 = los de Gemma 2B
  const f = Object.fromEntries(P._factPairs(A.run('openvla-7b').config));
  assert.deepStrictEqual([f.D, f.L, f.h, f.G, f.D_mlp, f.N, f.T, f.V, f.H, f.P], [4096, 32, 32, 32, 11008, 256, 22, 32064, 224, 14]);
  const g = Object.fromEntries(P._factPairs(A.run('pi0').config));
  assert.deepStrictEqual([g.D, g.L, g.h, g.G, g.D_mlp, g.N, g.T, g.V], [2048, 18, 8, 1, 16384, 768, 48, 257152]);
  // símbolos de VLA: OpenVLA D_v = las DOS torres fusionadas; π0 H_a = el chunk y H = el alto de la imagen (con nota)
  assert.deepStrictEqual([f.D_d, f.h_d, f.d_d, f.L_d, f.D_s, f.h_s, f.d_s, f.M_s, f.L_s, f.D_v, f.d_h, f.d_a], [1024, 16, 64, 24, 1152, 16, 72, 4304, 27, 2176, 128, 7]);
  assert.deepStrictEqual([g.D_a, g.H_a, g.d_a, g.d_h, g.N_p, g.D_s, g.M_s], [1024, 50, 32, 256, 256, 1152, 4304]);
  const notes = (cfg) => Object.fromEntries(P._factPairs(A.run(cfg).config).map(([s, , n]) => [s, n || '']));
  assert.match(notes('openvla-7b').D_v, /D_d \+ D_s/);
  assert.match(notes('pi0').H, /alto de la imagen/);
  assert.match(notes('pi0').H_a, /chunk/);
  const g25 = Object.fromEntries(P._factPairs(A.run('pi0', { H: 25 }).config));
  assert.deepStrictEqual([g25.H, g25.H_a], [224, 25]);
});
// ================================================================ fin del bloque de la fase 9

// ================================================================ revisión de la fase 10 (fine-tuning y alineación)
test('fase 10: tarjeta de datos — r / α solo con adapter, n_G (grupo de GRPO) ≠ G (cabezas KV), sin NaN', () => {
  const facts = (cfg, ov) => Object.fromEntries(P._factPairs(A.run(cfg, ov || {}).config).map(([s, v, n]) => [s, { v, n: n || '' }]));
  const ft = facts('full-ft-llama3-8b');
  assert.ok(!('r' in ft) && !('α' in ft), 'full FT sin r ni α');
  assert.ok(!JSON.stringify(P._factPairs(A.run('full-ft-llama3-8b').config)).includes('NaN'));
  const lo = facts('lora-llama3-8b-r16');
  assert.deepStrictEqual([lo.r.v, lo['α'].v], [16, 32]);
  assert.match(lo['α'].n, /α\/r = 2$/);
  for (const cfg of ['rlhf-llama3-8b', 'dpo-llama3-8b', 'grpo-llama3-8b']) assert.ok(!('r' in facts(cfg)), cfg + ': sin LoRA no hay «rango del adapter»');
  for (const cfg of ['dpo-llama3-8b-lora', 'ppo-llama3-8b-lora']) assert.strictEqual(facts(cfg).r.v, 16, cfg);
  assert.strictEqual(facts('rlhf-llama3-8b', { lora: 1 }).r.v, 16);
  const g = facts('grpo-llama3-8b'), g16 = facts('grpo-llama3-8b', { groupSize: 16 });
  assert.deepStrictEqual([g.G.v, g.n_G.v, g16.G.v, g16.n_G.v], [8, 8, 8, 16]);
  assert.match(g.G.n, /cabezas KV/);
  assert.match(g.n_G.n, /respuestas por prompt/);
  assert.ok(!('n_G' in facts('rlhf-llama3-8b')) && !('n_G' in facts('dpo-llama3-8b')), 'n_G solo en GRPO');
  // las formas del grupo usan n_G (no G): con groupSize = 16 las recompensas son 16 y las K del decoder siguen con G = 8
  const R16 = A.run('grpo-llama3-8b', { groupSize: 16 });
  assert.deepStrictEqual([R16.tensors.rewards.sym, R16.tensors.rewards.num, R16.tensors.advantages.sym].map((x) => JSON.stringify(x)), ['["n_G"]', '[16]', '["n_G"]']);
  assert.strictEqual(R16.tensors['pol-k-rope'] ? R16.tensors['pol-k-rope'].sym[0] : 'G', 'G');
});

test('fase 10: métricas booleanas (sí / no), % chicos con 3 cifras y etiquetas de todas las claves', () => {
  const m = A.metrics('lora-llama3-8b-r16', {}), q = A.metrics('qlora-llama3-8b-r16', { gradCkpt: 1 });
  assert.strictEqual(P._metricKind('fitsOn24'), 'bool');
  assert.deepStrictEqual([P._metricValue(m, 'fitsOn24'), P._metricValue(q, 'fitsOn24')], [0, 1]);
  assert.deepStrictEqual([P._fMetric('fitsOn24', 0), P._fMetric('fitsOn24', 1), P._fMetric('fitsOn80', P._metricValue(m, 'fitsOn80'))], ['no', 'sí', 'sí']);
  assert.strictEqual(P._fVsBase('fitsOn24', 1, 0), 'no en la base');
  // what-if con ask booleano: se pregunta por el valor (opciones sí / no)
  assert.strictEqual(P._asksValue({ ask: 'fitsOn24' }, '¿Entra en 24 GB?'), true);
  // porcentajes: < 1 % con 3 cifras significativas; ≥ 1 % igual que antes (1 decimal)
  const qv = A.metrics('lora-llama3-8b-r16-qv', {});
  assert.deepStrictEqual([P._fMetric('trainableShare', qv.trainableShare), P._fMetric('trainableShare', m.trainableShare), P._fMetric('rolloutShare', 0.1618)], ['0.0848 %', '0.520 %', '16.2 %']);
  assert.strictEqual(A.fmt.pctAuto(0.000848037664288186), '0.0848 %');
  assert.strictEqual(A.fmt.pctAuto(0.1234), A.fmt.pct(0.1234));
  assert.strictEqual(A.fmt.pctAuto(0), '0.0 %');
  assert.strictEqual(ATLAS.Quantities.get('lora-llama3-8b-r16-qv.metrics.trainableShare').text, '0.0848 %');
  assert.strictEqual(ATLAS.Quantities.get('grpo-llama3-8b.metrics.rolloutShare').text, '16.2 %');
  // ninguna clave numérica / booleana de metrics() de lora y rlhf-dpo queda con la etiqueta cruda
  for (const cfg of ['lora-llama3-8b-r16', 'full-ft-llama3-8b', 'qlora-llama3-8b-r16', 'rlhf-llama3-8b', 'dpo-llama3-8b', 'grpo-llama3-8b', 'ppo-llama3-8b-lora']) {
    const mm = A.metrics(cfg, {});
    for (const k of Object.keys(mm)) {
      if (!(typeof mm[k] === 'number' || typeof mm[k] === 'boolean') || /^(B|T|dtype|actMem|actMemPerSample|paramMem)$/.test(k)) continue;
      assert.notStrictEqual(P._metricLabel(k, A.run(cfg).model), k, cfg + ': sin etiqueta ' + k);
    }
  }
});

test('fase 10: rollout con prefijo compartido (GRPO) y claves existentes intactas', () => {
  const g = A.metrics('grpo-llama3-8b', {}), g64 = A.metrics('grpo-llama3-8b', { groupSize: 64 }), p = A.metrics('rlhf-llama3-8b', {});
  assert.strictEqual(+g.rolloutShare.toFixed(4), 0.1618);   // convención de siempre: cada respuesta paga su prefill
  assert.strictEqual(+g.rolloutShareSharedPrefix.toFixed(3), 0.101);
  assert.strictEqual(+g64.rolloutShareSharedPrefix.toFixed(3), 0.092);
  assert.strictEqual(g.rolloutMacsSharedPrefix, g.B * (g.rolloutPrefillMacsPerSeq + g.groupSize * (g.rolloutMacsPerSeq - g.rolloutPrefillMacsPerSeq)));
  assert.strictEqual(p.rolloutMacsSharedPrefix, p.rolloutMacs);   // PPO: 1 respuesta por prompt, nada que compartir
  assert.strictEqual(A.metrics('dpo-llama3-8b', {}).rolloutShareSharedPrefix, 0);
  assert.strictEqual(P._metricKind('rolloutShareSharedPrefix'), 'pct');
});

test('fase 10: el drill de formas monta la vista de SU config (DPO → dpo-step, no ppo-step)', () => {
  const d = P._diagramForTensor('rlhf-dpo', 'pol-logp', null, 'dpo-llama3-8b');
  assert.ok(d && (!Array.isArray(d.configs) || d.configs.indexOf('dpo-llama3-8b') >= 0), 'vista: ' + (d && d.id));
  const p = P._diagramForTensor('rlhf-dpo', 'pol-logp', null, 'rlhf-llama3-8b');
  assert.ok(p && (!Array.isArray(p.configs) || p.configs.indexOf('rlhf-llama3-8b') >= 0), 'vista: ' + (p && p.id));
  assert.notStrictEqual(d.id, p.id);
});

test('fase 11 (revisión): tarjetas de ANN solo con los símbolos de su índice; métricas de bert / retrieval / ann con etiqueta; duración y P/E', () => {
  const facts = (cfg, ov) => Object.fromEntries(P._factPairs(A.run(cfg, ov || {}).config).map(([s, v]) => [s, v]));
  const h = facts('hnsw-1m-768'), q = facts('ivfpq-1m-768'), f = facts('flat-1m-768'), b = facts('ivfpq-1b-768');
  assert.deepStrictEqual([h.M, h.ef, h.n_list, h.m, h.T], [32, 64, undefined, undefined, undefined]);
  assert.deepStrictEqual([q.M, q.ef, q.n_list, q.n_probe, q.m, q.k_s, q.n_scan], [undefined, undefined, 4096, 16, 96, 256, 3906]);
  assert.deepStrictEqual([f.M, f.ef, f.n_list, f.m, f.N, f.d], [undefined, undefined, undefined, undefined, 1e6, 768]);
  assert.deepStrictEqual([b.M, b.ef, b.n_list], [32, 64, 1048576], 'IVF-PQ a 1B: M y ef del HNSW sobre los centroides');
  assert.deepStrictEqual([facts('flat-1m-768', { encode: 0 }).D, facts('flat-1m-768', { encode: 0 }).T_q], [undefined, undefined]);
  assert.strictEqual(facts('cross-encoder-minilm').T, 211);
  assert.strictEqual(facts('dpr-bert-base').T, undefined);
  assert.strictEqual(facts('llama3-8b').T_q, undefined, 'el Tq del LLM no es «tokens de la consulta»');
  const skip = /^(id|B|bytesPerElement|crossover|scoreToLinear)$/;
  for (const cfg of ['bert-base', 'dpr-bert-base', 'sbert-minilm', 'cross-encoder-minilm', 'colbert-v2', 'hnsw-1m-768', 'ivfpq-1m-768', 'flat-1m-768', 'ivfpq-1b-768']) {
    const model = A.run(cfg).model, m = A.metrics(cfg, {});
    for (const k of Object.keys(m)) if (typeof m[k] === 'number' && !skip.test(k)) assert.notStrictEqual(P._metricLabel(k, model), k, cfg + ': sin etiqueta: ' + k);
  }
  A.metrics('dpr-bert-base', {});
  assert.strictEqual(P._metricKind('corpusEncodeTime'), 'duration');
  assert.strictEqual(P._fMetric('corpusEncodeTime', 975384), '16.3 min');
  assert.strictEqual(P._fMetric('crossVsBiPerQuery', 3814994.6), '×3,810,000');
  assert.match(P._metricNote('bandwidth', 'ann'), /EPYC/);
});
