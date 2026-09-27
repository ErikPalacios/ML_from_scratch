/* Transformer Lab · optimizadores (SGD y Adam) con recorte por norma global y traza opcional. */
(function (root) {
  'use strict';
  const TL = (root.TL = root.TL || {});
  const Mat = TL.Mat;

  const DEFAULTS = { type: 'adam', lr: 0.01, beta1: 0.9, beta2: 0.999, eps: 1e-8, clip: 1.0 };
  const SGD_LR = 0.1;

  function normalize(hp) {
    hp = hp || {};
    const o = Object.assign({}, DEFAULTS, hp);
    o.type = o.type === 'sgd' ? 'sgd' : 'adam';
    if (hp.lr === undefined || hp.lr === null || hp.lr === '') o.lr = o.type === 'sgd' ? SGD_LR : DEFAULTS.lr;
    o.lr = Number(o.lr);
    if (!(o.lr > 0) || !Number.isFinite(o.lr)) throw new Error('La tasa de aprendizaje η debe ser un número positivo.');
    o.beta1 = Number(o.beta1);
    o.beta2 = Number(o.beta2);
    o.eps = Number(o.eps);
    if (!(o.beta1 >= 0 && o.beta1 < 1) || !(o.beta2 >= 0 && o.beta2 < 1)) throw new Error('β₁ y β₂ deben estar en [0, 1).');
    o.clip = o.clip === null || o.clip === undefined || o.clip === '' || Number(o.clip) <= 0 ? 0 : Number(o.clip);
    return o;
  }

  function create(hp) {
    const o = normalize(hp);
    return { type: o.type, lr: o.lr, beta1: o.beta1, beta2: o.beta2, eps: o.eps, clip: o.clip, t: 0, m: {}, v: {} };
  }

  const fmt = (x, n) => (Number.isFinite(x) ? x.toFixed(n === undefined ? 4 : n) : String(x));
  const AXSYM = { T: 'T', V: 'V', d: 'd', dk: 'd_k', dff: 'd_{ff}', '1': '1', maxLen: 'T_{\\max}' };

  // Un paso del optimizador. Muta model.params (y el estado m, v de Adam); opt.t += 1.
  function step(opt, model, grads, opts) {
    const tr = !!(opts && opts.trace);
    const order = model.order;
    // ---- norma global del gradiente (y recorte)
    const norms = {};
    let tot2 = 0;
    for (const name of order) {
      const g = grads[name];
      let s = 0;
      if (g) for (let k = 0; k < g.d.length; k++) s += g.d[k] * g.d[k];
      norms[name] = Math.sqrt(s);
      tot2 += s;
    }
    const total = Math.sqrt(tot2);
    const clip = opt.clip > 0 ? opt.clip : 0;
    const factor = clip && total > clip ? clip / total : 1;
    opt.t += 1;
    const t = opt.t;
    const steps = [];

    let env = null;
    if (tr) {
      const cfg = model.cfg;
      env = { d: cfg.dModel, dk: cfg.dModel / cfg.nHeads, dff: cfg.dFF, V: model.vocab.length, h: cfg.nHeads, maxLen: cfg.maxLen, T: 1 };
      const nParams = order.reduce((a, n) => a + model.params[n].d.length, 0);
      steps.push({
        id: 'upd.gradnorm', tpl: 'upd.gradnorm', phase: 'update', block: 'optim', layer: null, head: null, kind: 'gradnorm',
        title: clip ? 'Norma global del gradiente y recorte (clipping)' : 'Norma global del gradiente',
        formula: '\\|g\\| = \\sqrt{\\textstyle\\sum_{\\theta}\\sum_{i,j} (\\mathrm{d}\\theta_{ij})^2} = ' + fmt(total) +
          (clip ? ',\\quad c = \\min\\!\\left(1,\\ \\frac{' + clip + '}{\\|g\\|}\\right) = ' + fmt(factor) : ''),
        dimsSym: '\\mathbb{R}^{|\\theta|}\\to\\mathbb{R}',
        dims: '\\mathbb{R}^{' + nParams + '}\\to\\mathbb{R}',
        inputs: [],
        outputs: [],
        aux: {
          norms: order.map((name) => ({ name, tex: model.paramMeta[name].tex, norm: norms[name] })),
          total, clip, factor, clipped: factor < 1, nParams,
        },
        flops: null,
      });
    }

    const isAdam = opt.type === 'adam';
    const lr = opt.lr, b1 = opt.beta1, b2 = opt.beta2, eps = opt.eps;
    const bc1 = 1 - Math.pow(b1, t), bc2 = 1 - Math.pow(b2, t);
    for (const name of order) {
      const theta = model.params[name];
      const g0 = grads[name] || new Mat(theta.r, theta.c);
      const g = factor === 1 ? g0 : Mat.scale(g0, factor);
      const n = theta.d.length;
      let before = null, mBefore = null, vBefore = null;
      if (tr) before = theta.clone();
      if (isAdam) {
        if (!opt.m[name] || opt.m[name].length !== n) { opt.m[name] = new Float64Array(n); opt.v[name] = new Float64Array(n); }
        const m = opt.m[name], v = opt.v[name];
        if (tr) { mBefore = new Mat(theta.r, theta.c, m.slice()); vBefore = new Mat(theta.r, theta.c, v.slice()); }
        const th = theta.d, gd = g.d;
        for (let k = 0; k < n; k++) {
          const gk = gd[k];
          m[k] = b1 * m[k] + (1 - b1) * gk;
          v[k] = b2 * v[k] + (1 - b2) * gk * gk;
          const mh = m[k] / bc1, vh = v[k] / bc2;
          th[k] = th[k] - lr * mh / (Math.sqrt(vh) + eps);
        }
      } else {
        const th = theta.d, gd = g.d;
        for (let k = 0; k < n; k++) th[k] = th[k] - lr * gd[k];
      }
      if (tr) steps.push(updateStep(model, opt, name, before, g, mBefore, vBefore, theta, env, factor));
    }
    return { steps, gradNorm: total, clipFactor: factor, norms };
  }

  function updateStep(model, opt, name, before, g, mBefore, vBefore, theta, env, factor) {
    const pm = model.paramMeta[name];
    const tex = pm.tex, lab = pm.label;
    const labelsFor = (ax) => (ax === 'V' ? model.vocabDisplay : null);
    const ref = (key, tx, label, mat, role) => ({ key, tex: tx, label, mat, role, rowAxis: pm.rowAxis, colAxis: pm.colAxis,
      rowLabels: labelsFor(pm.rowAxis), colLabels: labelsFor(pm.colAxis), colOffset: 0 });
    const isAdam = opt.type === 'adam';
    const dTex = '\\mathrm{d}' + tex;
    const shapeSym = '(' + AXSYM[pm.rowAxis] + '\\times ' + AXSYM[pm.colAxis] + ')';
    const newTex = (x) => x + '\\ (\\text{nuevo})';
    const inputs = [ref('theta', tex, lab, before, 'param'), ref('g', dTex, 'd' + lab, g.clone(), 'grad')];
    const outputs = [ref('theta_new', newTex(tex), lab + ' (nuevo)', theta.clone(), 'param')];
    const delta = Mat.sub(theta, before);
    const aux = { name, tex, optimizer: opt.type, lr: opt.lr, t: opt.t, beta1: opt.beta1, beta2: opt.beta2, eps: opt.eps,
      clipFactor: factor, delta };
    let formula;
    const cap = pm.layer !== null && pm.layer !== undefined ? 'Capa ' + (pm.layer + 1) + ' · ' : '';
    if (isAdam) {
      const mT = 'm_{' + tex + '}', vT = 'v_{' + tex + '}';
      const mNew = new Mat(theta.r, theta.c, opt.m[name].slice());
      const vNew = new Mat(theta.r, theta.c, opt.v[name].slice());
      inputs.push(ref('m', mT, 'm', mBefore, 'grad'), ref('v', vT, 'v', vBefore, 'grad'));
      outputs.push(ref('m_new', newTex(mT), 'm (nuevo)', mNew, 'grad'), ref('v_new', newTex(vT), 'v (nuevo)', vNew, 'grad'));
      const bc1 = 1 - Math.pow(opt.beta1, opt.t), bc2 = 1 - Math.pow(opt.beta2, opt.t);
      aux.mhat = Mat.scale(mNew, 1 / bc1);
      aux.vhat = Mat.scale(vNew, 1 / bc2);
      aux.bc1 = bc1;
      aux.bc2 = bc2;
      formula = mT + '\\leftarrow \\beta_1 ' + mT + ' + (1-\\beta_1)\\,' + dTex + ',\\quad ' +
        vT + '\\leftarrow \\beta_2 ' + vT + ' + (1-\\beta_2)\\,(' + dTex + ')^{2},\\quad ' +
        tex + '\\leftarrow ' + tex + ' - \\eta\\,\\frac{\\hat m}{\\sqrt{\\hat v}+\\epsilon},\\ \\ \\hat m = \\frac{' + mT + '}{1-\\beta_1^{' + opt.t + '}},\\ \\hat v = \\frac{' + vT + '}{1-\\beta_2^{' + opt.t + '}}';
    } else {
      formula = tex + '\\leftarrow ' + tex + ' - \\eta\\,' + dTex + ',\\quad \\eta = ' + opt.lr;
    }
    const dimsSym = shapeSym + '\\to' + shapeSym;
    return {
      id: 'upd.param.' + name, tpl: 'upd.param', phase: 'update', block: 'optim', layer: pm.layer === undefined ? null : pm.layer, head: null,
      kind: 'update',
      title: cap + 'Actualización de ' + lab + ' (' + (isAdam ? 'Adam' : 'SGD') + ')',
      formula,
      dimsSym,
      dims: TL.Model.dimsFromSym(dimsSym, env),
      inputs, outputs, aux, flops: null,
    };
  }

  TL.Optim = { defaults: Object.assign({}, DEFAULTS), sgdLr: SGD_LR, normalize, create, step };
})(typeof window !== 'undefined' ? window : globalThis);
