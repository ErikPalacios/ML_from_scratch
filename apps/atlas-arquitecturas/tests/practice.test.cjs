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
const MODELS = ['vit', 'swin', 'clip', 'detr', 'deformable-detr', 'grounding-dino', 'yolov8', 'yolo-world', 'sam', 'sam2', 'llm'];
const diagrams = ATLAS.diagrams();

// Lo que el diagrama escribe para un nodo (archdiagram.js nodeCost): por capa si todas las ops se
// repiten igual; Σ op × repeat si mezclan repeticiones; el total si es un grupo con repeat.totalOf.
function shownParams(R, node, total) {
  const ids = node.ops || [], pid = node.costOf || node.id;
  const ops = R.ops.filter((o) => ids.indexOf(o.id) >= 0 || (!node.opsExact && o.path && o.path.indexOf(pid) >= 0 && (!node.scope || o.path.indexOf(node.scope) >= 0)));
  const rep = Math.max(1, ...ops.map((o) => o.repeat || 1));
  const mixed = ops.some((o) => (o.repeat || 1) !== rep);
  return ops.reduce((a, o) => a + (o.params || 0) * (total || mixed ? o.repeat || 1 : 1), 0);
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
        assert.ok([cf.L, cf.Lt, cf.Lenc, cf.Ldec].indexOf(+m[1]) >= 0, c.id + ': «' + prompt + '»');
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
      const t = R.tensors[c.tensor];
      const known = {};
      P._drillFacts(R, c).forEach(([s, v]) => { known[s] = v; known[s.replace('_', '')] = v; });
      known.dh = known.d_h != null ? known.d_h : (known.D != null ? known.D : known.D_t) / known.h;
      // Swin: cabezas y ventanas del stage que nombra la etiqueta (datos: H, M y h por stage)
      const st = (R.config.stages || []).find((s) => new RegExp('Stage ' + s.k + '\\b').test(t.label || ''));
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
    for (const [k, u] of Object.entries(m.units)) assert.ok(['ratio', 'count', 'bytes', 'pct', 'macs', 'params'].includes(u), cfg + ' ' + k + ': ' + u);
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
  for (const cfg of ['llama3-8b', 'llama3-70b', 'llama2-7b', 'mixtral-8x7b']) {
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
  // el mapa units del calculador solo usa unidades que la práctica sabe formatear
  for (const cfg of ['llama3-8b', 'mixtral-8x7b']) {
    const m = A.metrics(cfg, {});
    for (const [k, u] of Object.entries(m.units)) assert.ok(['ratio', 'count', 'bytes', 'pct', 'macs', 'params'].includes(u), cfg + ' ' + k + ': ' + u);
  }
});
