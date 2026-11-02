/* =============================================================================
   Atlas de Arquitecturas — js/arch/resnet.js
   Modelo `resnet` (He et al., CVPR 2016, arXiv:1512.03385). Solo calculadora (sin página): ancla
   para el puente con Swin y los bloques `compare`. Referencia: torchvision `resnet50(weights=None)`
   (ResNet v1.5: el stride de los bloques que bajan resolución va en la conv 3×3, no en la 1×1).
   Convs sin sesgo; BatchNorm con γ, β (parámetros) y media/varianza móviles (buffers).
   Contrato de ids: SPEC §14.2.

   Nodos y ops (path):
     stem:    stem › stem-conv (conv 7×7 s2 p3, 3→64) · stem › stem-bn · stem › stem-relu
     maxpool: maxpool (3×3 s2 p1)
     layer{k} (k = 1..4; 3, 4, 6, 3 bloques bottleneck; anchos w = 64, 128, 256, 512; salida 4w):
       bloque 1 (con proyección en el atajo; stride 2 si k > 1), path layer{k} › l{k}-b1:
         l{k}-b1-conv1 · -bn1 · -relu1 · -conv2 · -bn2 · -relu2 · -conv3 · -bn3 · -down · -down-bn ·
         -add · -relu3
       bloques 2…n (idénticos, repeat = n − 1), path layer{k} › l{k}-b2: los mismos sin -down/-down-bn.
     pool:    pool (global average pooling) · head: head (Linear 2048 → 1000, con sesgo)
   Tensores (forward): x-img · stem-conv · stem-bn · stem-out (112×112×64) · pool-out (56×56×64) ·
     por capa k: l{k}-b1-{conv1, bn1, relu1, conv2, bn2, relu2, conv3, bn3, down, down-bn, add, out},
     l{k}-b2-{conv1, bn1, relu1, conv2, bn2, relu2, conv3, bn3, add} y la salida de la capa:
     c2 (56×56×256) · c3 (28×28×512) · c4 (14×14×1024) · c5 (7×7×2048) · pooled (2048) · logits (1000).
   Añadidos a la lista de §14.2 (nada renombrado): los tensores internos stem-conv, stem-bn, l{k}-b{j}-*.
   c{k+1} es la salida del último bloque de layer{k} (strides 4, 8, 16, 32: los de Swin).
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const A = ATLAS.Arch;
  if (!A || !A.defineModel) throw new Error('resnet.js necesita js/arch/primitives.js antes.');

  A.defineModel({
    id: 'resnet',
    label: 'ResNet',
    paper: {
      title: 'Deep Residual Learning for Image Recognition', authors: 'He et al.', venue: 'CVPR 2016', year: 2016, arxiv: '1512.03385',
    },
    configs: {
      'resnet50-224': {
        label: 'ResNet-50 @ 224', H: 224, W: 224, Cin: 3, blocks: [3, 4, 6, 3], widths: [64, 128, 256, 512], expansion: 4,
        stem: 64, K: 1000, canonical: true, torchvision: 'resnet50',
        source: 'He et al. 2016, Tabla 1 (50 capas); torchvision resnet50(weights=None), v1.5 (stride en la 3×3)',
      },
    },
    knobs: { res: [224, 256, 320, 384] },

    applyKnobs(c, ov) {
      if (ov.res !== undefined) { c.H = ov.res; c.W = ov.res; c.label = 'ResNet-50 @ ' + ov.res; }
      return c;
    },

    resolve(c) {
      if (c.H % 32 !== 0 || c.W % 32 !== 0) throw new Error('ResNet: la resolución debe ser múltiplo de 32 (recibí ' + c.H + ').');
      c.res = c.H;
      c.tokens = (c.H / 32) * (c.W / 32);     // posiciones del mapa C5 (7×7 = 49 a 224)
      c.L = 2 + 3 * c.blocks.reduce((a, b) => a + b, 0);   // conv del stem + 3 por bloque + fc = 50
      c.blocksStr = c.blocks.join(', ');
      return c;
    },

    build(c, A) {
      const g = A.graph(c);
      const img = g.input('x-img', A.shape(['H', 'W', '3'], [c.H, c.W, c.Cin], 'img', 'grid'), { label: 'Imagen de entrada', tex: 'x' });
      const s2 = ['H/2', 'W/2'], s4 = ['H/4', 'W/4'];
      const cv = g.op('stem-conv', A.conv2d(img, { k: 7, s: 2, p: 3, cout: c.stem, coutSym: String(c.stem), outSym: s2, bias: false, floor: true }), {
        path: ['stem', 'stem-conv'], out: 'stem-conv', label: 'Conv 7×7, stride 2 (sin sesgo)', type: 'conv', group: 'embed',
        outMeta: { label: 'Salida de la conv del stem', tex: 'W * x' },
      });
      const bn = g.op('stem-bn', A.batchnorm2d(cv), { path: ['stem', 'stem-bn'], out: 'stem-bn', label: 'BatchNorm', type: 'norm', group: 'norm', outMeta: { label: 'Normalizada', tex: '\\mathrm{BN}(\\cdot)' } });
      const st = g.op('stem-relu', A.relu(bn), { path: ['stem', 'stem-relu'], out: 'stem-out', label: 'ReLU', type: 'tensorop', group: 'embed', outMeta: { label: 'Salida del stem (stride 2)', tex: 'h_{\\mathrm{stem}}' } });
      let x = g.op('maxpool', A.maxpool2d(st, { k: 3, s: 2, p: 1, outSym: s4 }), {
        path: ['maxpool'], out: 'pool-out', label: 'Max pooling 3×3, stride 2', type: 'tensorop', group: 'embed',
        outMeta: { label: 'Entrada de layer1 (stride 4)', tex: 'h_0' },
      });
      let stride = 4;
      for (let i = 0; i < 4; i++) {
        const k = i + 1, w = c.widths[i], cout = w * c.expansion, s = i === 0 ? 1 : 2;
        stride *= s;
        const os = ['H/' + stride, 'W/' + stride];
        x = bottleneckOps(g, x, { k, j: 1, w, cout, s, os, repeat: 1, project: true, outId: 'l' + k + '-b1-out' });
        x = bottleneckOps(g, x, { k, j: 2, w, cout, s: 1, os, repeat: c.blocks[i] - 1, project: false, outId: 'c' + (k + 1) });
      }
      const pooled = g.op('pool', A.global_avg_pool(x), { path: ['pool'], out: 'pooled', label: 'Global average pooling', type: 'tensorop', group: 'head', outMeta: { label: 'Promedio espacial de C5', tex: '\\bar h' } });
      g.op('head', A.classifier_head(pooled, { K: c.K }), { path: ['head'], out: 'logits', label: 'Cabeza de clasificación (fc)', type: 'head', group: 'head', outMeta: { label: 'Logits', tex: 'z' } });
      return g;
    },

    quantities(c, r) {
      const n = r.totals.byNode;
      const q = { tokens: c.tokens, res: c.H, K: c.K, L: c.L, blocks: c.blocksStr,
        stemParams: n.stem.params, stemMacs: n.stem.macs, headParams: n.head.params, headMacs: n.head.macs };
      for (let k = 1; k <= 4; k++) { q['layer' + k + 'Params'] = n['layer' + k].params; q['layer' + k + 'Macs'] = n['layer' + k].macs; }
      const bnOps = r.ops.filter((o) => o.prim === 'batchnorm2d');
      q.bnParams = bnOps.reduce((s, o) => s + o.params * o.repeat, 0);
      q.bnBuffers = bnOps.reduce((s, o) => s + o.detail.buffers * o.repeat, 0);
      q.convMacs = r.totals.byPrim.conv2d.macs;
      return q;
    },
  });

  // Un bottleneck como ops elementales (conv, BN, ReLU) para que los ids de cada tensor existan.
  function bottleneckOps(g, x, o) {
    const pre = 'l' + o.k + '-b' + o.j + '-', path = ['layer' + o.k, pre.slice(0, -1)];
    const L = (meta) => Object.assign({ perLayer: o.repeat > 1 }, meta);
    const op = (id, res, extra) => g.op(pre + id, res, Object.assign({ path, repeat: o.repeat, out: pre + id }, extra));
    const ws = String(o.w), cs = String(o.cout);
    const inSym = x.sym.slice(0, 2);
    const a1 = op('conv1', A.conv2d(x, { k: 1, cout: o.w, coutSym: ws, bias: false, outSym: inSym }), { label: 'Conv 1×1 (reduce a ' + o.w + ')', type: 'conv', group: 'embed', outMeta: L({ label: 'Reducción 1×1', tex: 'W_1 * h' }) });
    const n1 = op('bn1', A.batchnorm2d(a1), { label: 'BatchNorm', type: 'norm', group: 'norm', outMeta: L({ label: 'BN 1', tex: '\\mathrm{BN}' }) });
    const r1 = op('relu1', A.relu(n1), { label: 'ReLU', type: 'tensorop', group: 'act', outMeta: L({ label: 'ReLU 1', tex: '\\mathrm{ReLU}' }) });
    const a2 = op('conv2', A.conv2d(r1, { k: 3, s: o.s, p: 1, cout: o.w, coutSym: ws, bias: false, floor: true, outSym: o.os }), { label: 'Conv 3×3' + (o.s > 1 ? ', stride ' + o.s : ''), type: 'conv', group: 'embed', outMeta: L({ label: 'Conv 3×3', tex: 'W_2 * \\cdot' }) });
    const n2 = op('bn2', A.batchnorm2d(a2), { label: 'BatchNorm', type: 'norm', group: 'norm', outMeta: L({ label: 'BN 2', tex: '\\mathrm{BN}' }) });
    const r2 = op('relu2', A.relu(n2), { label: 'ReLU', type: 'tensorop', group: 'act', outMeta: L({ label: 'ReLU 2', tex: '\\mathrm{ReLU}' }) });
    const a3 = op('conv3', A.conv2d(r2, { k: 1, cout: o.cout, coutSym: cs, bias: false, outSym: o.os }), { label: 'Conv 1×1 (expande a ' + o.cout + ')', type: 'conv', group: 'embed', outMeta: L({ label: 'Expansión 1×1', tex: 'W_3 * \\cdot' }) });
    const n3 = op('bn3', A.batchnorm2d(a3), { label: 'BatchNorm', type: 'norm', group: 'norm', outMeta: L({ label: 'BN 3', tex: '\\mathrm{BN}' }) });
    let sc = x;
    if (o.project) {
      const d = op('down', A.conv2d(x, { k: 1, s: o.s, cout: o.cout, coutSym: cs, bias: false, floor: true, outSym: o.os }), { label: 'Atajo: conv 1×1' + (o.s > 1 ? ', stride ' + o.s : '') + ' (proyección)', type: 'conv', group: 'embed', outMeta: L({ label: 'Atajo proyectado', tex: 'W_s * h' }) });
      sc = op('down-bn', A.batchnorm2d(d), { label: 'BatchNorm del atajo', type: 'norm', group: 'norm', outMeta: L({ label: 'Atajo normalizado', tex: '\\mathrm{BN}(W_s * h)' }) });
    }
    const ad = op('add', A.residual_add(sc, n3), { label: 'Suma residual', type: 'tensorop', group: 'resid', outMeta: L({ label: 'F(h) + atajo', tex: 'F(h) + h' }) });
    return op('relu3', A.relu(ad), {
      out: o.outId, label: 'ReLU final', type: 'tensorop', group: 'resid',
      outMeta: { label: o.outId.startsWith('c') ? 'Salida de layer' + o.k + ' (' + o.outId.toUpperCase() + ')' : 'Salida del bloque 1', tex: o.outId.startsWith('c') ? o.outId.toUpperCase() : 'h', perLayer: false },
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
