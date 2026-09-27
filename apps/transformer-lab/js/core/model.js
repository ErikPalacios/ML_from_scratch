/* Transformer Lab · modelo decoder-only estilo GPT (pre-LayerNorm).
   forward/backward escritos a mano (sin autodiff) y, opcionalmente, con traza paso a paso (§5 de la spec). */
(function (root) {
  'use strict';
  const TL = (root.TL = root.TL || {});
  const Mat = TL.Mat;

  const DEFAULTS = {
    dModel: 8,
    nHeads: 2,
    nLayers: 1,
    dFF: 32,
    maxLen: 8,
    activation: 'relu',
    posEnc: 'sinusoidal',
    seed: 42,
    lnEps: 1e-5,
  };

  // Escala de la inicialización de W_out (ver paramMeta.init): logits iniciales pequeños ⇒ ℒ₀ ≈ ln V.
  const WOUT_GAIN = 0.5;

  // ---------------------------------------------------------------- utilidades
  const SUB = '₀₁₂₃₄₅₆₇₈₉';
  const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  const subU = (n) => String(n).split('').map((c) => SUB[+c]).join('');
  const supU = (n) => '⁽' + String(n).split('').map((c) => SUP[+c]).join('') + '⁾';
  const fmt = (x, n) => {
    if (!Number.isFinite(x)) return String(x);
    const s = x.toFixed(n === undefined ? 3 : n);
    return s === '-0.000' ? '0.000' : s;
  };

  const displayToken = (t) => (TL.Tokenizer && TL.Tokenizer.displayToken ? TL.Tokenizer.displayToken(t) : (t === ' ' ? '␣' : t));

  function normalizeCfg(cfg) {
    const c = Object.assign({}, DEFAULTS, cfg || {});
    if (!cfg || cfg.dFF === undefined || cfg.dFF === null || cfg.dFF === '') c.dFF = 4 * Number(c.dModel);
    const int = (k, lo, hi) => {
      const v = Number(c[k]);
      if (!Number.isInteger(v) || v < lo || v > hi) {
        throw new Error('Configuración no válida: «' + k + '» debe ser un entero entre ' + lo + ' y ' + hi + ' (recibido: ' + c[k] + ').');
      }
      c[k] = v;
    };
    int('dModel', 1, 256);
    int('nHeads', 1, 64);
    int('nLayers', 1, 6);
    int('dFF', 1, 1024);
    int('maxLen', 1, 128);
    if (c.dModel % c.nHeads !== 0) {
      throw new Error('Configuración no válida: el número de cabezas h = ' + c.nHeads + ' debe dividir a d = ' + c.dModel +
        ' (cada cabeza trabaja con d_k = d/h columnas, que debe ser un entero).');
    }
    if (c.activation !== 'relu' && c.activation !== 'gelu') {
      throw new Error('Configuración no válida: la activación debe ser «relu» o «gelu».');
    }
    if (c.posEnc !== 'sinusoidal' && c.posEnc !== 'learned') {
      throw new Error('Configuración no válida: la codificación posicional debe ser «sinusoidal» o «learned».');
    }
    c.seed = Number(c.seed) | 0;
    c.lnEps = Number(c.lnEps) > 0 ? Number(c.lnEps) : 1e-5;
    return c;
  }

  // PE[pos, 2i] = sin(pos / 10000^{2i/d}),  PE[pos, 2i+1] = cos(pos / 10000^{2i/d})
  function sinusoidalPE(maxLen, d) {
    const P = new Mat(maxLen, d);
    for (let pos = 0; pos < maxLen; pos++) {
      for (let j = 0; j < d; j++) {
        const i2 = j - (j % 2);
        const ang = pos / Math.pow(10000, i2 / d);
        P.d[pos * d + j] = j % 2 === 0 ? Math.sin(ang) : Math.cos(ang);
      }
    }
    return P;
  }

  // M_ij = 0 si j ≤ i, −∞ si j > i (causal: cada posición solo ve el pasado y a sí misma).
  function causalMask(T) {
    const M = new Mat(T, T);
    for (let i = 0; i < T; i++) for (let j = i + 1; j < T; j++) M.d[i * T + j] = -Infinity;
    return M;
  }

  // ---------------------------------------------------------------- activaciones
  const GC = Math.sqrt(2 / Math.PI);
  const ACT = {
    relu: { f: (x) => (x > 0 ? x : 0), df: (x) => (x > 0 ? 1 : 0), tex: '\\mathrm{ReLU}', name: 'ReLU' },
    gelu: {
      f: (x) => 0.5 * x * (1 + Math.tanh(GC * (x + 0.044715 * x * x * x))),
      df: (x) => {
        const x2 = x * x;
        const th = Math.tanh(GC * (x + 0.044715 * x2 * x));
        return 0.5 * (1 + th) + 0.5 * x * (1 - th * th) * GC * (1 + 3 * 0.044715 * x2);
      },
      tex: '\\mathrm{GELU}',
      name: 'GELU',
    },
  };

  // ---------------------------------------------------------------- LayerNorm
  function lnForward(X, g, b, eps) {
    const T = X.r, d = X.c;
    const Y = new Mat(T, d), xhat = new Mat(T, d);
    const mu = new Mat(T, 1), vr = new Mat(T, 1), sg = new Mat(T, 1);
    const x = X.d;
    for (let t = 0; t < T; t++) {
      const o = t * d;
      let s = 0;
      for (let j = 0; j < d; j++) s += x[o + j];
      const m = s / d;
      let v = 0;
      for (let j = 0; j < d; j++) { const z = x[o + j] - m; v += z * z; }
      v /= d;
      const sd = Math.sqrt(v + eps);
      for (let j = 0; j < d; j++) {
        const xh = (x[o + j] - m) / sd;
        xhat.d[o + j] = xh;
        Y.d[o + j] = g.d[j] * xh + b.d[j];
      }
      mu.d[t] = m; vr.d[t] = v; sg.d[t] = sd;
    }
    return { Y, xhat, mu, var: vr, sigma: sg, eps };
  }

  // dx̂ = dy ⊙ γ ; dx = (1/σ)(dx̂ − mean(dx̂) − x̂ ⊙ mean(dx̂ ⊙ x̂)) ; dγ = Σ_filas dy ⊙ x̂ ; dβ = Σ_filas dy
  function lnBackward(dY, c, g) {
    const T = dY.r, d = dY.c;
    const dx = new Mat(T, d), dxhat = new Mat(T, d), dg = new Mat(1, d), db = new Mat(1, d);
    const xh = c.xhat.d, dy = dY.d;
    for (let t = 0; t < T; t++) {
      const o = t * d;
      let m1 = 0, m2 = 0;
      for (let j = 0; j < d; j++) {
        const v = dy[o + j] * g.d[j];
        dxhat.d[o + j] = v;
        m1 += v;
        m2 += v * xh[o + j];
        dg.d[j] += dy[o + j] * xh[o + j];
        db.d[j] += dy[o + j];
      }
      m1 /= d; m2 /= d;
      const sd = c.sigma.d[t];
      for (let j = 0; j < d; j++) dx.d[o + j] = (dxhat.d[o + j] - m1 - xh[o + j] * m2) / sd;
    }
    return { dx, dg, db, dxhat };
  }

  // ---------------------------------------------------------------- creación del modelo
  function paramLayout(cfg, V) {
    const d = cfg.dModel, dff = cfg.dFF, N = cfg.nLayers;
    const multi = N > 1;
    const L = [];
    const sup = (l) => (multi ? '^{[' + (l + 1) + ']}' : '');
    const usup = (l) => (multi ? supU(l + 1) : '');
    const sq = (n) => Math.sqrt(n);
    L.push({ name: 'E', r: V, c: d, rowAxis: 'V', colAxis: 'd', std: 1, block: 'embed', tex: 'E', label: 'E',
      desc: 'Tabla de embeddings: fila i = vector de dimensión d del token i del vocabulario.',
      init: 'Normal N(0, 1): cada entrada con media 0 y desviación 1.' });
    if (cfg.posEnc === 'learned') {
      L.push({ name: 'P', r: cfg.maxLen, c: d, rowAxis: 'maxLen', colAxis: 'd', std: 0.1, block: 'posenc',
        tex: 'P_{\\text{pos}}', label: 'P_pos',
        desc: 'Codificación posicional aprendida: fila p = vector que se suma al token en la posición p.',
        init: 'Normal N(0, 0.1²): valores pequeños para no tapar al embedding al principio.' });
    }
    for (let l = 0; l < N; l++) {
      const p = 'L' + l + '.';
      const s = sup(l), u = usup(l), cap = 'Capa ' + (l + 1) + ': ';
      const wInit = 'Normal N(0, 1/d): desviación 1/√d = ' + fmt(1 / sq(d)) + ', así H·W conserva una escala ≈ 1.';
      L.push({ name: p + 'ln1.g', r: 1, c: d, rowAxis: '1', colAxis: 'd', fill: 1, block: 'L' + l + '.ln1', tex: '\\gamma_1' + s, label: 'γ₁' + u,
        desc: cap + 'ganancia (escala) de LayerNorm 1, una por dimensión.', init: 'Unos: al principio LayerNorm no reescala.' });
      L.push({ name: p + 'ln1.b', r: 1, c: d, rowAxis: '1', colAxis: 'd', fill: 0, block: 'L' + l + '.ln1', tex: '\\beta_1' + s, label: 'β₁' + u,
        desc: cap + 'sesgo (desplazamiento) de LayerNorm 1.', init: 'Ceros.' });
      L.push({ name: p + 'Wq', r: d, c: d, rowAxis: 'd', colAxis: 'd', std: 1 / sq(d), block: 'L' + l + '.qkv', tex: 'W_Q' + s, label: 'W_Q' + u,
        desc: cap + 'proyección de consultas (queries): Q = H·W_Q. Sus columnas se reparten entre las cabezas.', init: wInit });
      L.push({ name: p + 'Wk', r: d, c: d, rowAxis: 'd', colAxis: 'd', std: 1 / sq(d), block: 'L' + l + '.qkv', tex: 'W_K' + s, label: 'W_K' + u,
        desc: cap + 'proyección de claves (keys): K = H·W_K.', init: wInit });
      L.push({ name: p + 'Wv', r: d, c: d, rowAxis: 'd', colAxis: 'd', std: 1 / sq(d), block: 'L' + l + '.qkv', tex: 'W_V' + s, label: 'W_V' + u,
        desc: cap + 'proyección de valores (values): V = H·W_V.', init: wInit });
      L.push({ name: p + 'Wo', r: d, c: d, rowAxis: 'd', colAxis: 'd', std: 1 / sq(d), block: 'L' + l + '.proj', tex: 'W_O' + s, label: 'W_O' + u,
        desc: cap + 'proyección de salida de la atención: mezcla las cabezas concatenadas, O = Z·W_O.', init: wInit });
      L.push({ name: p + 'ln2.g', r: 1, c: d, rowAxis: '1', colAxis: 'd', fill: 1, block: 'L' + l + '.ln2', tex: '\\gamma_2' + s, label: 'γ₂' + u,
        desc: cap + 'ganancia de LayerNorm 2 (antes de la FFN).', init: 'Unos.' });
      L.push({ name: p + 'ln2.b', r: 1, c: d, rowAxis: '1', colAxis: 'd', fill: 0, block: 'L' + l + '.ln2', tex: '\\beta_2' + s, label: 'β₂' + u,
        desc: cap + 'sesgo de LayerNorm 2.', init: 'Ceros.' });
      L.push({ name: p + 'W1', r: d, c: dff, rowAxis: 'd', colAxis: 'dff', std: 1 / sq(d), block: 'L' + l + '.ffn1', tex: 'W_1' + s, label: 'W₁' + u,
        desc: cap + 'primera capa de la FFN: expande de d a d_ff dimensiones.', init: wInit });
      L.push({ name: p + 'b1', r: 1, c: dff, rowAxis: '1', colAxis: 'dff', fill: 0, block: 'L' + l + '.ffn1', tex: 'b_1' + s, label: 'b₁' + u,
        desc: cap + 'sesgo de la primera capa de la FFN (se suma a cada fila: broadcasting).', init: 'Ceros.' });
      L.push({ name: p + 'W2', r: dff, c: d, rowAxis: 'dff', colAxis: 'd', std: 1 / sq(dff), block: 'L' + l + '.ffn2', tex: 'W_2' + s, label: 'W₂' + u,
        desc: cap + 'segunda capa de la FFN: comprime de d_ff de vuelta a d.',
        init: 'Normal N(0, 1/d_ff): desviación 1/√d_ff = ' + fmt(1 / sq(dff)) + '.' });
      L.push({ name: p + 'b2', r: 1, c: d, rowAxis: '1', colAxis: 'd', fill: 0, block: 'L' + l + '.ffn2', tex: 'b_2' + s, label: 'b₂' + u,
        desc: cap + 'sesgo de la segunda capa de la FFN.', init: 'Ceros.' });
    }
    L.push({ name: 'lnf.g', r: 1, c: d, rowAxis: '1', colAxis: 'd', fill: 1, block: 'lnf', tex: '\\gamma_f', label: 'γ_f',
      desc: 'Ganancia de la LayerNorm final.', init: 'Unos.' });
    L.push({ name: 'lnf.b', r: 1, c: d, rowAxis: '1', colAxis: 'd', fill: 0, block: 'lnf', tex: '\\beta_f', label: 'β_f',
      desc: 'Sesgo de la LayerNorm final.', init: 'Ceros.' });
    L.push({ name: 'Wout', r: d, c: V, rowAxis: 'd', colAxis: 'V', std: WOUT_GAIN / sq(d), block: 'logits', tex: 'W_{\\text{out}}', label: 'W_out',
      desc: 'Proyección final al vocabulario: logits = H_f·W_out (una columna por token).',
      init: 'Normal con desviación ' + WOUT_GAIN + '/√d = ' + fmt(WOUT_GAIN / sq(d)) +
        ' (la mitad de 1/√d): los logits iniciales son pequeños, las probabilidades casi uniformes y la pérdida inicial ≈ ln V.' });
    return L;
  }

  function create(cfgIn, vocab) {
    const cfg = normalizeCfg(cfgIn);
    if (!Array.isArray(vocab) || vocab.length < 2) throw new Error('El vocabulario debe tener al menos 2 tokens.');
    const V = vocab.length;
    const rng = TL.rng(cfg.seed);
    const layout = paramLayout(cfg, V);
    const params = {}, paramMeta = {}, order = [];
    for (const p of layout) {
      let m;
      if (p.fill !== undefined) { m = new Mat(p.r, p.c); m.d.fill(p.fill); }
      else m = Mat.randn(p.r, p.c, p.std, rng);
      params[p.name] = m;
      order.push(p.name);
      const lm = /^L(\d+)\./.exec(p.name);
      const layer = lm ? +lm[1] : null;
      paramMeta[p.name] = { tex: p.tex, label: p.label, desc: p.desc, init: p.init, block: p.block,
        rowAxis: p.rowAxis, colAxis: p.colAxis, layer, shape: [p.r, p.c] };
    }
    return {
      cfg,
      vocab: vocab.slice(),
      vocabDisplay: vocab.map(displayToken),
      params,
      order,
      paramMeta,
      peTable: sinusoidalPE(cfg.maxLen, cfg.dModel),
      _masks: {},
    };
  }

  function getMask(model, T) {
    return model._masks[T] || (model._masks[T] = causalMask(T));
  }

  // ---------------------------------------------------------------- traza
  const AXSYM = { T: 'T', V: 'V', d: 'd', dk: 'd_k', dff: 'd_{ff}', '1': '1', maxLen: 'T_{\\max}' };
  const shp = (ref) => '(' + AXSYM[ref.rowAxis] + '\\times ' + AXSYM[ref.colAxis] + ')';

  // Sustituye los símbolos (T, d, d_k, d_{ff}, V, h, T_{\max}) por sus valores numéricos.
  function dimsFromSym(sym, env) {
    return sym.replace(/T_\{\\max\}|d_\{ff\}|d_k|\\[A-Za-z]+|[TdVh]/g, (m) => {
      if (m[0] === '\\') return m;
      switch (m) {
        case 'T_{\\max}': return String(env.maxLen);
        case 'd_{ff}': return String(env.dff);
        case 'd_k': return String(env.dk);
        case 'T': return String(env.T);
        case 'd': return String(env.d);
        case 'V': return String(env.V);
        case 'h': return String(env.h);
        default: return m;
      }
    });
  }

  function makeTrace(model, inputIds) {
    const cfg = model.cfg;
    const T = inputIds.length;
    const tok = inputIds.map((i) => model.vocabDisplay[i]);
    const voc = model.vocabDisplay;
    const env = { T, d: cfg.dModel, dk: cfg.dModel / cfg.nHeads, dff: cfg.dFF, V: model.vocab.length, h: cfg.nHeads, maxLen: cfg.maxLen };
    const labelsFor = (ax) => (ax === 'T' ? tok : ax === 'V' ? voc : null);
    const steps = [];
    const X = {
      T, tok, env, steps,
      ref(key, tex, label, mat, role, rowAxis, colAxis, colOffset) {
        return { key, tex, label, mat: mat.clone(), role, rowAxis, colAxis,
          rowLabels: labelsFor(rowAxis), colLabels: labelsFor(colAxis), colOffset: colOffset || 0 };
      },
      id(tpl, l, h) {
        let id = tpl;
        if (l !== null && l !== undefined) id = id.replace(/^(fwd|bwd)\./, '$1.L' + l + '.');
        if (h !== null && h !== undefined) id = id.replace(/\.attn\./, '.attn.h' + h + '.');
        return id;
      },
      push(o) {
        const layer = o.layer === undefined ? null : o.layer;
        const head = o.head === undefined ? null : o.head;
        const st = {
          id: o.id || X.id(o.tpl, layer, head),
          tpl: o.tpl,
          phase: o.phase,
          block: o.block,
          layer,
          head,
          kind: o.kind,
          title: o.title,
          formula: o.formula,
          dimsSym: o.dimsSym,
          dims: o.dims || dimsFromSym(o.dimsSym, env),
          inputs: o.inputs || [],
          outputs: o.outputs || [],
          aux: o.aux || {},
          flops: o.flops === undefined ? null : o.flops,
        };
        steps.push(st);
        return st;
      },
      // Paso de producto matricial: C = A·B (+ bias). dims se generan de los ejes de los operandos.
      mm(o, A, B, C, bias) {
        const inputs = bias ? [A, B, bias] : [A, B];
        return X.push(Object.assign({}, o, {
          kind: 'matmul',
          dimsSym: shp(A) + '\\cdot' + shp(B) + (bias ? '+' + shp(bias) : '') + '\\to' + shp(C),
          inputs,
          outputs: [C],
          aux: { a: 0, b: 1, bias: bias ? 2 : null },
          flops: A.mat.r * A.mat.c * B.mat.c,
        }));
      },
    };
    return X;
  }

  // Nombres LaTeX / unicode dentro de una capa: superíndice [l] solo si hay más de una capa.
  function layerNames(multi, l) {
    const s = multi ? '^{[' + (l + 1) + ']}' : '';
    const sT = multi ? '^{[' + (l + 1) + ']\\top}' : '^{\\top}';
    const us = multi ? supU(l + 1) : '';
    return {
      t: (b) => b + s,
      tT: (b) => b + sT,
      u: (b) => b + us,
      uT: (b) => b + us + 'ᵀ',
      cap: 'Capa ' + (l + 1) + ' · ',
    };
  }
  const xTex = (l) => 'X^{[' + l + ']}';
  const xLab = (l) => 'X' + supU(l);

  // ---------------------------------------------------------------- forward
  function forward(model, inputIds, targetIds, opts) {
    const tr = !!(opts && opts.trace);
    const cfg = model.cfg, p = model.params;
    const T = inputIds.length;
    if (T < 1) throw new Error('La secuencia de entrada está vacía.');
    if (T > cfg.maxLen) throw new Error('La secuencia tiene ' + T + ' tokens y la ventana de contexto es de ' + cfg.maxLen + '.');
    const d = cfg.dModel, nH = cfg.nHeads, dk = d / nH, V = model.vocab.length, N = cfg.nLayers;
    const multi = N > 1;
    const act = ACT[cfg.activation];
    const X_ = tr ? makeTrace(model, inputIds) : null;
    const R_ = tr ? X_.ref : null;
    const hasTargets = Array.isArray(targetIds) && targetIds.length > 0;
    for (let t = 0; t < T; t++) {
      const id = inputIds[t];
      if (!(id >= 0 && id < V) || id !== (id | 0)) throw new Error('Id de token no válido en la posición ' + t + ': ' + id + ' (el vocabulario tiene ' + V + ' tokens).');
    }
    if (hasTargets && targetIds.length !== T) throw new Error('targetIds debe tener la misma longitud que inputIds.');

    // ---- embedding: X_emb = onehot(ids)·E (en la práctica: copiar filas de E)
    const Xemb = Mat.gatherRows(p.E, inputIds);
    if (tr) {
      X_.push({ tpl: 'fwd.embed', phase: 'forward', block: 'embed', kind: 'lookup',
        title: 'Embedding de tokens: búsqueda de filas en E',
        formula: 'X_{\\text{emb}} = \\mathrm{onehot}(\\mathrm{ids})\\,E',
        dimsSym: '(T\\times V)\\cdot(V\\times d)\\to(T\\times d)',
        inputs: [R_('onehot', '\\mathrm{onehot}(\\mathrm{ids})', 'one-hot', Mat.oneHot(inputIds, V), 'onehot', 'T', 'V'),
          R_('E', 'E', 'E', p.E, 'param', 'V', 'd')],
        outputs: [R_('X_emb', 'X_{\\text{emb}}', 'X_emb', Xemb, 'act', 'T', 'd')],
        aux: { ids: inputIds.slice(), tokens: X_.tok.slice() } });
    }

    // ---- codificación posicional: X^{[0]} = X_emb + PE
    const learned = cfg.posEnc === 'learned';
    const PEm = Mat.sliceRows(learned ? p.P : model.peTable, 0, T);
    const X0 = Mat.add(Xemb, PEm);
    if (tr) {
      const peRef = learned
        ? R_('P_pos', 'P_{\\text{pos}}[0{:}T]', 'P_pos[0:T]', PEm, 'param', 'T', 'd')
        : R_('PE', 'PE', 'PE', PEm, 'const', 'T', 'd');
      X_.push({ tpl: 'fwd.posenc', phase: 'forward', block: 'posenc', kind: 'add',
        title: learned ? 'Codificación posicional aprendida' : 'Codificación posicional sinusoidal',
        formula: 'X^{[0]} = X_{\\text{emb}} + ' + peRef.tex,
        dimsSym: '(T\\times d)+(T\\times d)\\to(T\\times d)',
        inputs: [R_('X_emb', 'X_{\\text{emb}}', 'X_emb', Xemb, 'act', 'T', 'd'), peRef],
        outputs: [R_('X0', xTex(0), xLab(0), X0, 'act', 'T', 'd')],
        aux: { residual: false, broadcast: false, posEnc: cfg.posEnc, positions: Array.from({ length: T }, (_, i) => i) } });
    }

    const M = getMask(model, T);
    const factor = 1 / Math.sqrt(dk);
    const layers = [];
    const attn = [];
    let X = X0;

    for (let l = 0; l < N; l++) {
      const n = layerNames(multi, l);
      const pre = 'L' + l + '.';
      const bl = 'L' + l + '.';
      const Xin = X;
      const xin = xTex(l), xinL = xLab(l);

      // ---- LayerNorm 1
      const g1 = p[pre + 'ln1.g'], be1 = p[pre + 'ln1.b'];
      const ln1 = lnForward(Xin, g1, be1, cfg.lnEps);
      const Hm = ln1.Y;
      if (tr) {
        X_.push({ tpl: 'fwd.ln1', phase: 'forward', block: bl + 'ln1', layer: l, kind: 'layernorm',
          title: n.cap + 'LayerNorm 1 (normaliza cada fila)',
          formula: n.t('H') + ' = \\mathrm{LN}_1(' + xin + ') = ' + n.t('\\gamma_1') + '\\odot\\frac{' + xin +
            ' - \\mu}{\\sqrt{\\sigma^2+\\varepsilon}} + ' + n.t('\\beta_1'),
          dimsSym: '(T\\times d)\\to(T\\times d)',
          inputs: [R_('X', xin, xinL, Xin, 'act', 'T', 'd'), R_('gamma', n.t('\\gamma_1'), n.u('γ₁'), g1, 'param', '1', 'd'),
            R_('beta', n.t('\\beta_1'), n.u('β₁'), be1, 'param', '1', 'd')],
          outputs: [R_('H', n.t('H'), n.u('H'), Hm, 'act', 'T', 'd')],
          aux: lnAux(ln1) });
      }

      // ---- proyecciones Q, K, V
      const Wq = p[pre + 'Wq'], Wk = p[pre + 'Wk'], Wv = p[pre + 'Wv'];
      const Q = Mat.matmul(Hm, Wq), K = Mat.matmul(Hm, Wk), Vv = Mat.matmul(Hm, Wv);
      if (tr) {
        const qkv = [['q', 'Q', Wq, Q, 'consultas'], ['k', 'K', Wk, K, 'claves'], ['v', 'V', Wv, Vv, 'valores']];
        for (const [s, L, W, out, nom] of qkv) {
          X_.mm({ tpl: 'fwd.attn.' + s, phase: 'forward', block: bl + 'qkv', layer: l,
            title: n.cap + 'Proyección de ' + nom + ' ' + L + ' = H·W_' + L,
            formula: n.t(L) + ' = ' + n.t('H') + '\\,' + n.t('W_' + L) },
          R_('H', n.t('H'), n.u('H'), Hm, 'act', 'T', 'd'), R_('W_' + L, n.t('W_' + L), n.u('W_' + L), W, 'param', 'd', 'd'), R_(L, n.t(L), n.u(L), out, 'act', 'T', 'd'));
        }
      }

      // ---- división en cabezas
      const heads = [];
      for (let h = 0; h < nH; h++) {
        heads.push({ Qh: Mat.sliceCols(Q, h * dk, (h + 1) * dk), Kh: Mat.sliceCols(K, h * dk, (h + 1) * dk), Vh: Mat.sliceCols(Vv, h * dk, (h + 1) * dk) });
      }
      if (tr) {
        const outs = [];
        const groups = [];
        const srcs = [['Q', Q], ['K', K], ['V', Vv]];
        srcs.forEach(([L], gi) => {
          const o = [];
          for (let h = 0; h < nH; h++) {
            o.push(outs.length);
            const m = heads[h]['' + L + 'h'];
            outs.push(R_(L + '_' + (h + 1), n.t(L + '_' + (h + 1)), n.u(L + subU(h + 1)), m, 'act', 'T', 'dk', h * dk));
          }
          groups.push({ input: gi, outputs: o });
        });
        const hs = heads.map((_, h) => h + 1);
        X_.push({ tpl: 'fwd.attn.split', phase: 'forward', block: bl + 'split', layer: l, kind: 'split',
          title: n.cap + 'División en ' + nH + ' cabeza' + (nH > 1 ? 's' : '') + ' (d_k = ' + dk + ' columnas cada una)',
          formula: ['Q', 'K', 'V'].map((L) => '[' + hs.map((h) => n.t(L + '_' + h)).join('\\,\\|\\,') + '] = ' + n.t(L)).join(',\\quad '),
          dimsSym: '3\\times(T\\times d)\\to 3\\times h\\times(T\\times d_k)',
          inputs: srcs.map(([L, m]) => R_(L, n.t(L), n.u(L), m, 'act', 'T', 'd')),
          outputs: outs,
          aux: { nHeads: nH, dK: dk, groups } });
      }

      // ---- atención por cabeza
      const layerAttn = [];
      for (let h = 0; h < nH; h++) {
        const hd = heads[h];
        const hh = h + 1;
        const hcap = n.cap + 'Cabeza ' + hh + ' · ';
        const qT = n.t('Q_' + hh), kT = n.t('K_' + hh), kTT = n.tT('K_' + hh), vT = n.t('V_' + hh);
        const sT = n.t('S_' + hh), stT = n.t('\\tilde S_' + hh), shT = n.t('\\hat S_' + hh), aT = n.t('A_' + hh), zT = n.t('Z_' + hh);
        const S = Mat.matmulBT(hd.Qh, hd.Kh);
        const St = Mat.scale(S, factor);
        const Sh = Mat.add(St, M);
        const sm = Mat.softmaxParts(Sh);
        const A = sm.P;
        const Z = Mat.matmul(A, hd.Vh);
        hd.A = A;
        hd.Z = Z;
        layerAttn.push(A);
        if (tr) {
          const common = { phase: 'forward', layer: l, head: h };
          const sRef = () => R_('S_' + hh, sT, n.u('S' + subU(hh)), S, 'act', 'T', 'T');
          const stRef = () => R_('St_' + hh, stT, n.u('S̃' + subU(hh)), St, 'act', 'T', 'T');
          const shRef = () => R_('Sh_' + hh, shT, n.u('Ŝ' + subU(hh)), Sh, 'act', 'T', 'T');
          const aRef = () => R_('A_' + hh, aT, n.u('A' + subU(hh)), A, 'prob', 'T', 'T');
          X_.mm(Object.assign({ tpl: 'fwd.attn.scores', block: bl + 'scores', title: hcap + 'Puntuaciones Q·Kᵀ',
            formula: sT + ' = ' + qT + '\\,' + kTT }, common),
          R_('Q_' + hh, qT, n.u('Q' + subU(hh)), hd.Qh, 'act', 'T', 'dk', h * dk),
          R_('K_' + hh + 'T', kTT, n.uT('K' + subU(hh)), Mat.transpose(hd.Kh), 'act', 'dk', 'T'),
          sRef());
          X_.push(Object.assign({ tpl: 'fwd.attn.scale', block: bl + 'scale', kind: 'scale',
            title: hcap + 'Escalado por 1/√d_k',
            formula: stT + ' = \\frac{' + sT + '}{\\sqrt{d_k}} = \\frac{' + sT + '}{\\sqrt{' + dk + '}}',
            dimsSym: '(T\\times T)\\to(T\\times T)',
            inputs: [sRef()], outputs: [stRef()],
            aux: { factor, factorTex: '1/\\sqrt{d_k}', dk } }, common));
          X_.push(Object.assign({ tpl: 'fwd.attn.mask', block: bl + 'mask', kind: 'mask',
            title: hcap + 'Máscara causal (no mirar el futuro)',
            formula: shT + ' = ' + stT + ' + M,\\quad M_{ij} = \\begin{cases}0 & j \\le i\\\\ -\\infty & j > i\\end{cases}',
            dimsSym: '(T\\times T)+(T\\times T)\\to(T\\times T)',
            inputs: [stRef(), R_('M', 'M', 'M', M, 'mask', 'T', 'T')], outputs: [shRef()], aux: {} }, common));
          X_.push(Object.assign({ tpl: 'fwd.attn.softmax', block: bl + 'softmax', kind: 'softmax',
            title: hcap + 'Softmax por filas → pesos de atención',
            formula: aT + ' = \\mathrm{softmax}_{\\text{fila}}(' + shT + ')',
            dimsSym: '(T\\times T)\\to(T\\times T)',
            inputs: [shRef()], outputs: [aRef()],
            aux: { rowMax: sm.rowMax, exps: sm.exps, rowSum: sm.rowSum, attention: true, queryLabels: X_.tok.slice(), keyLabels: X_.tok.slice() } }, common));
          X_.mm(Object.assign({ tpl: 'fwd.attn.context', block: bl + 'context', title: hcap + 'Contexto: mezcla de valores A·V',
            formula: zT + ' = ' + aT + '\\,' + vT }, common),
          aRef(), R_('V_' + hh, vT, n.u('V' + subU(hh)), hd.Vh, 'act', 'T', 'dk', h * dk),
          R_('Z_' + hh, zT, n.u('Z' + subU(hh)), Z, 'act', 'T', 'dk', h * dk));
        }
      }
      attn.push(layerAttn);

      // ---- concatenación, proyección de salida y residual 1
      const Zc = Mat.concatCols(heads.map((hd) => hd.Z));
      if (tr) {
        X_.push({ tpl: 'fwd.attn.concat', phase: 'forward', block: bl + 'concat', layer: l, kind: 'concat',
          title: n.cap + 'Concatenación de las cabezas',
          formula: n.t('Z') + ' = [' + heads.map((_, h) => n.t('Z_' + (h + 1))).join('\\,\\|\\,') + ']',
          dimsSym: 'h\\times(T\\times d_k)\\to(T\\times d)',
          inputs: heads.map((hd, h) => R_('Z_' + (h + 1), n.t('Z_' + (h + 1)), n.u('Z' + subU(h + 1)), hd.Z, 'act', 'T', 'dk', h * dk)),
          outputs: [R_('Z', n.t('Z'), n.u('Z'), Zc, 'act', 'T', 'd')],
          aux: { nHeads: nH, dK: dk, groups: [{ inputs: heads.map((_, h) => h), output: 0 }] } });
      }
      const Wo = p[pre + 'Wo'];
      const O = Mat.matmul(Zc, Wo);
      if (tr) {
        X_.mm({ tpl: 'fwd.attn.proj', phase: 'forward', block: bl + 'proj', layer: l,
          title: n.cap + 'Proyección de salida de la atención', formula: n.t('O') + ' = ' + n.t('Z') + '\\,' + n.t('W_O') },
        R_('Z', n.t('Z'), n.u('Z'), Zc, 'act', 'T', 'd'), R_('W_O', n.t('W_O'), n.u('W_O'), Wo, 'param', 'd', 'd'),
        R_('O', n.t('O'), n.u('O'), O, 'act', 'T', 'd'));
      }
      const Rm = Mat.add(Xin, O);
      if (tr) {
        X_.push({ tpl: 'fwd.res1', phase: 'forward', block: bl + 'res1', layer: l, kind: 'add',
          title: n.cap + 'Conexión residual 1 (X + atención)',
          formula: n.t('R') + ' = ' + xin + ' + ' + n.t('O'),
          dimsSym: '(T\\times d)+(T\\times d)\\to(T\\times d)',
          inputs: [R_('X', xin, xinL, Xin, 'act', 'T', 'd'), R_('O', n.t('O'), n.u('O'), O, 'act', 'T', 'd')],
          outputs: [R_('R', n.t('R'), n.u('R'), Rm, 'act', 'T', 'd')],
          aux: { residual: true, broadcast: false } });
      }

      // ---- LayerNorm 2 + FFN + residual 2
      const g2 = p[pre + 'ln2.g'], be2 = p[pre + 'ln2.b'];
      const ln2 = lnForward(Rm, g2, be2, cfg.lnEps);
      const Hp = ln2.Y;
      if (tr) {
        X_.push({ tpl: 'fwd.ln2', phase: 'forward', block: bl + 'ln2', layer: l, kind: 'layernorm',
          title: n.cap + 'LayerNorm 2 (antes de la FFN)',
          formula: n.t("H'") + ' = \\mathrm{LN}_2(' + n.t('R') + ') = ' + n.t('\\gamma_2') + '\\odot\\frac{' + n.t('R') +
            ' - \\mu}{\\sqrt{\\sigma^2+\\varepsilon}} + ' + n.t('\\beta_2'),
          dimsSym: '(T\\times d)\\to(T\\times d)',
          inputs: [R_('R', n.t('R'), n.u('R'), Rm, 'act', 'T', 'd'), R_('gamma', n.t('\\gamma_2'), n.u('γ₂'), g2, 'param', '1', 'd'),
            R_('beta', n.t('\\beta_2'), n.u('β₂'), be2, 'param', '1', 'd')],
          outputs: [R_('Hp', n.t("H'"), n.u("H'"), Hp, 'act', 'T', 'd')],
          aux: lnAux(ln2) });
      }
      const W1 = p[pre + 'W1'], b1 = p[pre + 'b1'], W2 = p[pre + 'W2'], b2 = p[pre + 'b2'];
      const U = Mat.addRowVec(Mat.matmul(Hp, W1), b1);
      if (tr) {
        X_.mm({ tpl: 'fwd.ffn1', phase: 'forward', block: bl + 'ffn1', layer: l,
          title: n.cap + 'FFN: primera capa lineal (expande a d_ff)',
          formula: n.t('U') + ' = ' + n.t("H'") + '\\,' + n.t('W_1') + ' + ' + n.t('b_1') },
        R_('Hp', n.t("H'"), n.u("H'"), Hp, 'act', 'T', 'd'), R_('W_1', n.t('W_1'), n.u('W₁'), W1, 'param', 'd', 'dff'),
        R_('U', n.t('U'), n.u('U'), U, 'act', 'T', 'dff'), R_('b_1', n.t('b_1'), n.u('b₁'), b1, 'param', '1', 'dff'));
      }
      const G = Mat.map(U, act.f);
      if (tr) {
        X_.push({ tpl: 'fwd.act', phase: 'forward', block: bl + 'act', layer: l, kind: 'activation',
          title: n.cap + 'FFN: activación ' + act.name,
          formula: n.t('G') + ' = ' + act.tex + '(' + n.t('U') + ')' +
            (cfg.activation === 'relu' ? ' = \\max(0,\\, ' + n.t('U') + ')' : ''),
          dimsSym: '(T\\times d_{ff})\\to(T\\times d_{ff})',
          inputs: [R_('U', n.t('U'), n.u('U'), U, 'act', 'T', 'dff')],
          outputs: [R_('G', n.t('G'), n.u('G'), G, 'act', 'T', 'dff')],
          aux: { fn: cfg.activation } });
      }
      const F = Mat.addRowVec(Mat.matmul(G, W2), b2);
      if (tr) {
        X_.mm({ tpl: 'fwd.ffn2', phase: 'forward', block: bl + 'ffn2', layer: l,
          title: n.cap + 'FFN: segunda capa lineal (vuelve a d)',
          formula: n.t('F') + ' = ' + n.t('G') + '\\,' + n.t('W_2') + ' + ' + n.t('b_2') },
        R_('G', n.t('G'), n.u('G'), G, 'act', 'T', 'dff'), R_('W_2', n.t('W_2'), n.u('W₂'), W2, 'param', 'dff', 'd'),
        R_('F', n.t('F'), n.u('F'), F, 'act', 'T', 'd'), R_('b_2', n.t('b_2'), n.u('b₂'), b2, 'param', '1', 'd'));
      }
      const Xout = Mat.add(Rm, F);
      if (tr) {
        X_.push({ tpl: 'fwd.res2', phase: 'forward', block: bl + 'res2', layer: l, kind: 'add',
          title: n.cap + 'Conexión residual 2 (R + FFN)',
          formula: xTex(l + 1) + ' = ' + n.t('R') + ' + ' + n.t('F'),
          dimsSym: '(T\\times d)+(T\\times d)\\to(T\\times d)',
          inputs: [R_('R', n.t('R'), n.u('R'), Rm, 'act', 'T', 'd'), R_('F', n.t('F'), n.u('F'), F, 'act', 'T', 'd')],
          outputs: [R_('X', xTex(l + 1), xLab(l + 1), Xout, 'act', 'T', 'd')],
          aux: { residual: true, broadcast: false } });
      }
      layers.push({ Xin, ln1, H: Hm, Q, K, V: Vv, heads, Z: Zc, O, R: Rm, ln2, Hp, U, G, F, Xout });
      X = Xout;
    }

    // ---- LayerNorm final, logits y softmax
    const gf = p['lnf.g'], bf = p['lnf.b'];
    const lnf = lnForward(X, gf, bf, cfg.lnEps);
    const Hf = lnf.Y;
    const xN = xTex(N), xNL = xLab(N);
    if (tr) {
      X_.push({ tpl: 'fwd.lnf', phase: 'forward', block: 'lnf', kind: 'layernorm',
        title: 'LayerNorm final',
        formula: 'H_f = \\mathrm{LN}_f(' + xN + ') = \\gamma_f\\odot\\frac{' + xN + ' - \\mu}{\\sqrt{\\sigma^2+\\varepsilon}} + \\beta_f',
        dimsSym: '(T\\times d)\\to(T\\times d)',
        inputs: [R_('X', xN, xNL, X, 'act', 'T', 'd'), R_('gamma', '\\gamma_f', 'γ_f', gf, 'param', '1', 'd'),
          R_('beta', '\\beta_f', 'β_f', bf, 'param', '1', 'd')],
        outputs: [R_('H_f', 'H_f', 'H_f', Hf, 'act', 'T', 'd')],
        aux: lnAux(lnf) });
    }
    const Wout = p.Wout;
    const logits = Mat.matmul(Hf, Wout);
    if (tr) {
      X_.mm({ tpl: 'fwd.logits', phase: 'forward', block: 'logits', title: 'Logits: una puntuación por token del vocabulario',
        formula: '\\mathrm{logits} = H_f\\,W_{\\text{out}}' },
      R_('H_f', 'H_f', 'H_f', Hf, 'act', 'T', 'd'), R_('W_out', 'W_{\\text{out}}', 'W_out', Wout, 'param', 'd', 'V'),
      R_('logits', '\\mathrm{logits}', 'logits', logits, 'act', 'T', 'V'));
    }
    const smo = Mat.softmaxParts(logits);
    const probs = smo.P;
    if (tr) {
      X_.push({ tpl: 'fwd.softmax_out', phase: 'forward', block: 'softmax_out', kind: 'softmax',
        title: 'Softmax de salida → probabilidad del siguiente token',
        formula: 'P = \\mathrm{softmax}_{\\text{fila}}(\\mathrm{logits})',
        dimsSym: '(T\\times V)\\to(T\\times V)',
        inputs: [R_('logits', '\\mathrm{logits}', 'logits', logits, 'act', 'T', 'V')],
        outputs: [R_('P', 'P', 'P', probs, 'prob', 'T', 'V')],
        aux: { rowMax: smo.rowMax, exps: smo.exps, rowSum: smo.rowSum, attention: false, queryLabels: X_.tok.slice(), keyLabels: model.vocabDisplay.slice() } });
    }

    // ---- pérdida: entropía cruzada media
    let loss = null;
    if (hasTargets) {
      const perToken = new Mat(T, 1), pTarget = new Mat(T, 1);
      let s = 0;
      for (let t = 0; t < T; t++) {
        const pt = probs.d[t * V + targetIds[t]];
        const lt = -Math.log(pt > 1e-300 ? pt : 1e-300);
        perToken.d[t] = lt;
        pTarget.d[t] = pt;
        s += lt;
      }
      loss = s / T;
      if (tr) {
        X_.push({ tpl: 'loss.ce', phase: 'loss', block: 'loss', kind: 'crossentropy',
          title: 'Pérdida: entropía cruzada media',
          formula: '\\mathcal{L} = -\\frac{1}{T}\\sum_{t=1}^{T}\\log P_{t,\\,y_t} = ' + fmt(loss, 4),
          dimsSym: '(T\\times V),\\,(T\\times V)\\to(1\\times 1)',
          inputs: [R_('P', 'P', 'P', probs, 'prob', 'T', 'V'), R_('Y', 'Y', 'Y', Mat.oneHot(targetIds, V), 'onehot', 'T', 'V')],
          outputs: [R_('L', '\\mathcal{L}', 'ℒ', Mat.fromRow([loss]), 'scalar', '1', '1')],
          aux: { targetIds: targetIds.slice(), targetTokens: targetIds.map((i) => model.vocabDisplay[i]), perToken, pTarget } });
      }
    }

    const cache = { T, inputIds: inputIds.slice(), targetIds: hasTargets ? targetIds.slice() : null,
      Xemb, PE: PEm, X0, layers, lnf, Hf, XN: X, logits, probs, mask: M, factor };
    return { loss, probs, logits, attn, cache, steps: tr ? X_.steps : [] };
  }

  function lnAux(c) {
    return { mu: c.mu, var: c.var, sigma: c.sigma, xhat: c.xhat, eps: c.eps };
  }

  // ---------------------------------------------------------------- backward
  function backward(model, cache, opts) {
    const tr = !!(opts && opts.trace);
    if (!cache || !cache.targetIds) throw new Error('backward necesita un forward con targetIds (hace falta la pérdida).');
    const cfg = model.cfg, p = model.params;
    const T = cache.T, d = cfg.dModel, nH = cfg.nHeads, dk = d / nH, V = model.vocab.length, N = cfg.nLayers;
    const multi = N > 1;
    const act = ACT[cfg.activation];
    const X_ = tr ? makeTrace(model, cache.inputIds) : null;
    const R_ = tr ? X_.ref : null;
    const grads = {};
    const D = '\\mathrm{d}';

    // ---- softmax + entropía cruzada: dlogits = (P − Y)/T
    const Y = Mat.oneHot(cache.targetIds, V);
    const dlogits = Mat.scale(Mat.sub(cache.probs, Y), 1 / T);
    const dlT = D + '\\,\\mathrm{logits}';
    if (tr) {
      X_.push({ tpl: 'bwd.ce', phase: 'backward', block: 'loss', kind: 'grad_ce',
        title: 'Gradiente de softmax + entropía cruzada: (P − Y)/T',
        formula: dlT + ' = \\frac{1}{T}\\,(P - Y) = \\frac{1}{' + T + '}\\,(P - Y)',
        dimsSym: '(T\\times V)-(T\\times V)\\to(T\\times V)',
        inputs: [R_('P', 'P', 'P', cache.probs, 'prob', 'T', 'V'), R_('Y', 'Y', 'Y', Y, 'onehot', 'T', 'V')],
        outputs: [R_('dlogits', dlT, 'dlogits', dlogits, 'grad', 'T', 'V')],
        aux: { T } });
    }

    // ---- W_out
    grads.Wout = Mat.matmulAT(cache.Hf, dlogits);
    const dHf = Mat.matmulBT(dlogits, p.Wout);
    if (tr) {
      X_.mm({ tpl: 'bwd.logits.dW', phase: 'backward', block: 'logits', title: 'Gradiente de W_out',
        formula: D + 'W_{\\text{out}} = H_f^{\\top}\\,' + dlT },
      R_('H_fT', 'H_f^{\\top}', 'H_fᵀ', Mat.transpose(cache.Hf), 'act', 'd', 'T'),
      R_('dlogits', dlT, 'dlogits', dlogits, 'grad', 'T', 'V'),
      R_('dW_out', D + 'W_{\\text{out}}', 'dW_out', grads.Wout, 'grad', 'd', 'V'));
      X_.mm({ tpl: 'bwd.logits.dX', phase: 'backward', block: 'logits', title: 'Gradiente hacia H_f',
        formula: D + 'H_f = ' + dlT + '\\,W_{\\text{out}}^{\\top}' },
      R_('dlogits', dlT, 'dlogits', dlogits, 'grad', 'T', 'V'),
      R_('W_outT', 'W_{\\text{out}}^{\\top}', 'W_outᵀ', Mat.transpose(p.Wout), 'param', 'V', 'd'),
      R_('dH_f', D + 'H_f', 'dH_f', dHf, 'grad', 'T', 'd'));
    }

    // ---- LayerNorm final
    const gf = p['lnf.g'];
    const bf = lnBackward(dHf, cache.lnf, gf);
    grads['lnf.g'] = bf.dg;
    grads['lnf.b'] = bf.db;
    let dX = bf.dx;
    if (tr) {
      X_.push({ tpl: 'bwd.lnf', phase: 'backward', block: 'lnf', kind: 'grad_layernorm',
        title: 'Retropropagación por la LayerNorm final',
        formula: lnBwdFormula(D + xTex(N), D + 'H_f', '\\gamma_f', '\\beta_f'),
        dimsSym: '(T\\times d)\\to(T\\times d),\\,(1\\times d),\\,(1\\times d)',
        inputs: [R_('dY', D + 'H_f', 'dH_f', dHf, 'grad', 'T', 'd'), R_('X', xTex(N), xLab(N), cache.XN, 'act', 'T', 'd'),
          R_('gamma', '\\gamma_f', 'γ_f', gf, 'param', '1', 'd')],
        outputs: [R_('dX', D + xTex(N), 'd' + xLab(N), dX, 'grad', 'T', 'd'),
          R_('dgamma', D + '\\gamma_f', 'dγ_f', bf.dg, 'grad', '1', 'd'), R_('dbeta', D + '\\beta_f', 'dβ_f', bf.db, 'grad', '1', 'd')],
        aux: { mu: cache.lnf.mu, sigma: cache.lnf.sigma, xhat: cache.lnf.xhat, dxhat: bf.dxhat, eps: cache.lnf.eps } });
    }

    for (let l = N - 1; l >= 0; l--) {
      const c = cache.layers[l];
      const n = layerNames(multi, l);
      const pre = 'L' + l + '.';
      const bl = 'L' + l + '.';
      const cm = { phase: 'backward', layer: l };
      const xo = xTex(l + 1), xi = xTex(l);

      // ---- residual 2: el gradiente se copia a los dos caminos
      const dXout = dX;
      const dF = dXout; // (misma matriz: la rama de la FFN recibe una copia exacta)
      if (tr) {
        X_.push(Object.assign({ tpl: 'bwd.res2', block: bl + 'res2', kind: 'residual_split',
          title: n.cap + 'Residual 2: el gradiente se copia a ambos caminos',
          formula: D + n.t('R') + '_{\\text{directo}} = ' + D + xo + ',\\quad ' + D + n.t('F') + ' = ' + D + xo,
          dimsSym: '(T\\times d)\\to 2\\times(T\\times d)',
          inputs: [R_('dX', D + xo, 'd' + xLab(l + 1), dXout, 'grad', 'T', 'd')],
          outputs: [R_('dR_skip', D + n.t('R') + '_{\\text{directo}}', n.u('dR') + ' (directo)', dXout, 'grad', 'T', 'd'),
            R_('dF', D + n.t('F'), n.u('dF'), dF, 'grad', 'T', 'd')],
          aux: { branches: ['camino directo (skip)', 'subcapa'] } }, cm));
      }

      // ---- FFN segunda capa: dW2 = Gᵀ dF ; db2 = Σ dF ; dG = dF W2ᵀ
      const W2 = p[pre + 'W2'], W1 = p[pre + 'W1'];
      const dW2 = Mat.matmulAT(c.G, dF);
      const db2 = Mat.sumRows(dF);
      const dG = Mat.matmulBT(dF, W2);
      grads[pre + 'W2'] = dW2;
      grads[pre + 'b2'] = db2;
      if (tr) {
        const dFref = () => R_('dF', D + n.t('F'), n.u('dF'), dF, 'grad', 'T', 'd');
        X_.mm(Object.assign({ tpl: 'bwd.ffn2.dW', block: bl + 'ffn2', title: n.cap + 'Gradiente de W₂',
          formula: D + n.t('W_2') + ' = ' + n.tT('G') + '\\,' + D + n.t('F') }, cm),
        R_('GT', n.tT('G'), n.uT('G'), Mat.transpose(c.G), 'act', 'dff', 'T'), dFref(),
        R_('dW_2', D + n.t('W_2'), n.u('dW₂'), dW2, 'grad', 'dff', 'd'));
        X_.push(Object.assign({ tpl: 'bwd.ffn2.db', block: bl + 'ffn2', kind: 'sumrows',
          title: n.cap + 'Gradiente de b₂ (suma sobre las posiciones)',
          formula: D + n.t('b_2') + ' = \\sum_{t=1}^{T} ' + D + n.t('F') + '_{t,:}',
          dimsSym: '(T\\times d)\\to(1\\times d)',
          inputs: [dFref()], outputs: [R_('db_2', D + n.t('b_2'), n.u('db₂'), db2, 'grad', '1', 'd')], aux: {} }, cm));
        X_.mm(Object.assign({ tpl: 'bwd.ffn2.dX', block: bl + 'ffn2', title: n.cap + 'Gradiente hacia G',
          formula: D + n.t('G') + ' = ' + D + n.t('F') + '\\,' + n.tT('W_2') }, cm),
        dFref(), R_('W_2T', n.tT('W_2'), n.uT('W₂'), Mat.transpose(W2), 'param', 'd', 'dff'),
        R_('dG', D + n.t('G'), n.u('dG'), dG, 'grad', 'T', 'dff'));
      }

      // ---- activación: dU = dG ⊙ f'(U)
      const deriv = Mat.map(c.U, act.df);
      const dU = Mat.mul(dG, deriv);
      if (tr) {
        X_.push(Object.assign({ tpl: 'bwd.act', block: bl + 'act', kind: 'grad_activation',
          title: n.cap + 'Gradiente a través de la activación ' + act.name,
          formula: D + n.t('U') + ' = ' + D + n.t('G') + '\\odot ' + act.tex + "'(" + n.t('U') + ')' +
            (cfg.activation === 'relu' ? ',\\quad \\mathrm{ReLU}\'(u) = \\mathbb{1}[u>0]' : ''),
          dimsSym: '(T\\times d_{ff})\\odot(T\\times d_{ff})\\to(T\\times d_{ff})',
          inputs: [R_('dG', D + n.t('G'), n.u('dG'), dG, 'grad', 'T', 'dff'), R_('U', n.t('U'), n.u('U'), c.U, 'act', 'T', 'dff')],
          outputs: [R_('dU', D + n.t('U'), n.u('dU'), dU, 'grad', 'T', 'dff')],
          aux: { fn: cfg.activation, deriv } }, cm));
      }

      // ---- FFN primera capa: dW1 = H'ᵀ dU ; db1 = Σ dU ; dH' = dU W1ᵀ
      const dW1 = Mat.matmulAT(c.Hp, dU);
      const db1 = Mat.sumRows(dU);
      const dHp = Mat.matmulBT(dU, W1);
      grads[pre + 'W1'] = dW1;
      grads[pre + 'b1'] = db1;
      if (tr) {
        const dUref = () => R_('dU', D + n.t('U'), n.u('dU'), dU, 'grad', 'T', 'dff');
        X_.mm(Object.assign({ tpl: 'bwd.ffn1.dW', block: bl + 'ffn1', title: n.cap + 'Gradiente de W₁',
          formula: D + n.t('W_1') + ' = ' + n.tT("H'") + '\\,' + D + n.t('U') }, cm),
        R_('HpT', n.tT("H'"), n.uT("H'"), Mat.transpose(c.Hp), 'act', 'd', 'T'), dUref(),
        R_('dW_1', D + n.t('W_1'), n.u('dW₁'), dW1, 'grad', 'd', 'dff'));
        X_.push(Object.assign({ tpl: 'bwd.ffn1.db', block: bl + 'ffn1', kind: 'sumrows',
          title: n.cap + 'Gradiente de b₁ (suma sobre las posiciones)',
          formula: D + n.t('b_1') + ' = \\sum_{t=1}^{T} ' + D + n.t('U') + '_{t,:}',
          dimsSym: '(T\\times d_{ff})\\to(1\\times d_{ff})',
          inputs: [dUref()], outputs: [R_('db_1', D + n.t('b_1'), n.u('db₁'), db1, 'grad', '1', 'dff')], aux: {} }, cm));
        X_.mm(Object.assign({ tpl: 'bwd.ffn1.dX', block: bl + 'ffn1', title: n.cap + "Gradiente hacia H'",
          formula: D + n.t("H'") + ' = ' + D + n.t('U') + '\\,' + n.tT('W_1') }, cm),
        dUref(), R_('W_1T', n.tT('W_1'), n.uT('W₁'), Mat.transpose(W1), 'param', 'dff', 'd'),
        R_('dHp', D + n.t("H'"), n.u("dH'"), dHp, 'grad', 'T', 'd'));
      }

      // ---- LayerNorm 2
      const g2 = p[pre + 'ln2.g'];
      const b2b = lnBackward(dHp, c.ln2, g2);
      grads[pre + 'ln2.g'] = b2b.dg;
      grads[pre + 'ln2.b'] = b2b.db;
      const dRln = b2b.dx;
      const dRlnT = D + n.t('R') + '_{\\text{LN}}';
      if (tr) {
        X_.push(Object.assign({ tpl: 'bwd.ln2', block: bl + 'ln2', kind: 'grad_layernorm',
          title: n.cap + 'Retropropagación por LayerNorm 2',
          formula: lnBwdFormula(dRlnT, D + n.t("H'"), n.t('\\gamma_2'), n.t('\\beta_2')),
          dimsSym: '(T\\times d)\\to(T\\times d),\\,(1\\times d),\\,(1\\times d)',
          inputs: [R_('dY', D + n.t("H'"), n.u("dH'"), dHp, 'grad', 'T', 'd'), R_('X', n.t('R'), n.u('R'), c.R, 'act', 'T', 'd'),
            R_('gamma', n.t('\\gamma_2'), n.u('γ₂'), g2, 'param', '1', 'd')],
          outputs: [R_('dR_ln', dRlnT, n.u('dR') + ' (LN)', dRln, 'grad', 'T', 'd'),
            R_('dgamma', D + n.t('\\gamma_2'), n.u('dγ₂'), b2b.dg, 'grad', '1', 'd'),
            R_('dbeta', D + n.t('\\beta_2'), n.u('dβ₂'), b2b.db, 'grad', '1', 'd')],
          aux: { mu: c.ln2.mu, sigma: c.ln2.sigma, xhat: c.ln2.xhat, dxhat: b2b.dxhat, eps: c.ln2.eps } }, cm));
      }
      const dR = Mat.add(dXout, dRln);
      if (tr) {
        X_.push(Object.assign({ tpl: 'bwd.res2.merge', block: bl + 'res2', kind: 'accumulate',
          title: n.cap + 'Residual 2: se suman los gradientes que llegan a R',
          formula: D + n.t('R') + ' = ' + D + n.t('R') + '_{\\text{directo}} + ' + dRlnT,
          dimsSym: '(T\\times d)+(T\\times d)\\to(T\\times d)',
          inputs: [R_('dR_skip', D + n.t('R') + '_{\\text{directo}}', n.u('dR') + ' (directo)', dXout, 'grad', 'T', 'd'),
            R_('dR_ln', dRlnT, n.u('dR') + ' (LN)', dRln, 'grad', 'T', 'd')],
          outputs: [R_('dR', D + n.t('R'), n.u('dR'), dR, 'grad', 'T', 'd')], aux: {} }, cm));
      }

      // ---- residual 1
      const dO = dR;
      const dXskipT = D + xi + '_{\\text{directo}}';
      if (tr) {
        X_.push(Object.assign({ tpl: 'bwd.res1', block: bl + 'res1', kind: 'residual_split',
          title: n.cap + 'Residual 1: el gradiente se copia a ambos caminos',
          formula: dXskipT + ' = ' + D + n.t('R') + ',\\quad ' + D + n.t('O') + ' = ' + D + n.t('R'),
          dimsSym: '(T\\times d)\\to 2\\times(T\\times d)',
          inputs: [R_('dR', D + n.t('R'), n.u('dR'), dR, 'grad', 'T', 'd')],
          outputs: [R_('dX_skip', dXskipT, 'd' + xLab(l) + ' (directo)', dR, 'grad', 'T', 'd'),
            R_('dO', D + n.t('O'), n.u('dO'), dO, 'grad', 'T', 'd')],
          aux: { branches: ['camino directo (skip)', 'subcapa'] } }, cm));
      }

      // ---- proyección de salida: dW_O = Zᵀ dO ; dZ = dO W_Oᵀ
      const Wo = p[pre + 'Wo'];
      const dWo = Mat.matmulAT(c.Z, dO);
      const dZ = Mat.matmulBT(dO, Wo);
      grads[pre + 'Wo'] = dWo;
      if (tr) {
        const dOref = () => R_('dO', D + n.t('O'), n.u('dO'), dO, 'grad', 'T', 'd');
        X_.mm(Object.assign({ tpl: 'bwd.attn.proj.dW', block: bl + 'proj', title: n.cap + 'Gradiente de W_O',
          formula: D + n.t('W_O') + ' = ' + n.tT('Z') + '\\,' + D + n.t('O') }, cm),
        R_('ZT', n.tT('Z'), n.uT('Z'), Mat.transpose(c.Z), 'act', 'd', 'T'), dOref(),
        R_('dW_O', D + n.t('W_O'), n.u('dW_O'), dWo, 'grad', 'd', 'd'));
        X_.mm(Object.assign({ tpl: 'bwd.attn.proj.dX', block: bl + 'proj', title: n.cap + 'Gradiente hacia Z',
          formula: D + n.t('Z') + ' = ' + D + n.t('O') + '\\,' + n.tT('W_O') }, cm),
        dOref(), R_('W_OT', n.tT('W_O'), n.uT('W_O'), Mat.transpose(Wo), 'param', 'd', 'd'),
        R_('dZ', D + n.t('Z'), n.u('dZ'), dZ, 'grad', 'T', 'd'));
      }

      // ---- dZ → dZ_1 … dZ_h
      const dZh = [];
      for (let h = 0; h < nH; h++) dZh.push(Mat.sliceCols(dZ, h * dk, (h + 1) * dk));
      if (tr) {
        X_.push(Object.assign({ tpl: 'bwd.attn.concat', block: bl + 'concat', kind: 'split',
          title: n.cap + 'El gradiente de Z se reparte entre las cabezas',
          formula: '[' + dZh.map((_, h) => D + n.t('Z_' + (h + 1))).join('\\,\\|\\,') + '] = ' + D + n.t('Z'),
          dimsSym: '(T\\times d)\\to h\\times(T\\times d_k)',
          inputs: [R_('dZ', D + n.t('Z'), n.u('dZ'), dZ, 'grad', 'T', 'd')],
          outputs: dZh.map((m, h) => R_('dZ_' + (h + 1), D + n.t('Z_' + (h + 1)), n.u('dZ' + subU(h + 1)), m, 'grad', 'T', 'dk', h * dk)),
          aux: { nHeads: nH, dK: dk, groups: [{ input: 0, outputs: dZh.map((_, h) => h) }] } }, cm));
      }

      // ---- atención por cabeza (hacia atrás)
      const dQh = [], dKh = [], dVh = [];
      for (let h = 0; h < nH; h++) {
        const hd = c.heads[h];
        const hh = h + 1;
        const hcap = n.cap + 'Cabeza ' + hh + ' · ';
        const cmh = Object.assign({ head: h }, cm);
        const dA = Mat.matmulBT(dZh[h], hd.Vh);
        const dV = Mat.matmulAT(hd.A, dZh[h]);
        // dŜ = A ⊙ (dA − rowsum(dA ⊙ A))
        const rowDot = new Mat(T, 1);
        const dSh = new Mat(T, T);
        for (let i = 0; i < T; i++) {
          let s = 0;
          for (let j = 0; j < T; j++) s += dA.d[i * T + j] * hd.A.d[i * T + j];
          rowDot.d[i] = s;
          for (let j = 0; j < T; j++) dSh.d[i * T + j] = hd.A.d[i * T + j] * (dA.d[i * T + j] - s);
        }
        // la máscara es constante: las posiciones enmascaradas no reciben gradiente
        const dSt = new Mat(T, T);
        for (let k = 0; k < T * T; k++) dSt.d[k] = cache.mask.d[k] === -Infinity ? 0 : dSh.d[k];
        const dS = Mat.scale(dSt, cache.factor);
        const dQ = Mat.matmul(dS, hd.Kh);
        const dK = Mat.matmulAT(dS, hd.Qh);
        dQh.push(dQ); dKh.push(dK); dVh.push(dV);
        if (tr) {
          const aT = n.t('A_' + hh), vT = n.t('V_' + hh), zT = n.t('Z_' + hh);
          const dAT = D + aT, dshT = D + n.t('\\hat S_' + hh), dstT = D + n.t('\\tilde S_' + hh), dsT = D + n.t('S_' + hh);
          const dZref = () => R_('dZ_' + hh, D + zT, n.u('dZ' + subU(hh)), dZh[h], 'grad', 'T', 'dk', h * dk);
          const aRef = () => R_('A_' + hh, aT, n.u('A' + subU(hh)), hd.A, 'prob', 'T', 'T');
          const dARef = () => R_('dA_' + hh, dAT, n.u('dA' + subU(hh)), dA, 'grad', 'T', 'T');
          const dShRef = () => R_('dSh_' + hh, dshT, n.u('dŜ' + subU(hh)), dSh, 'grad', 'T', 'T');
          const dStRef = () => R_('dSt_' + hh, dstT, n.u('dS̃' + subU(hh)), dSt, 'grad', 'T', 'T');
          const dSRef = () => R_('dS_' + hh, dsT, n.u('dS' + subU(hh)), dS, 'grad', 'T', 'T');
          X_.mm(Object.assign({ tpl: 'bwd.attn.context.dA', block: bl + 'context', title: hcap + 'Gradiente de los pesos de atención A' + subU(hh),
            formula: dAT + ' = ' + D + zT + '\\,' + n.tT('V_' + hh) }, cmh),
          dZref(), R_('V_' + hh + 'T', n.tT('V_' + hh), n.uT('V' + subU(hh)), Mat.transpose(hd.Vh), 'act', 'dk', 'T'), dARef());
          X_.mm(Object.assign({ tpl: 'bwd.attn.context.dV', block: bl + 'context', title: hcap + 'Gradiente de los valores V' + subU(hh),
            formula: D + vT + ' = ' + n.tT('A_' + hh) + '\\,' + D + zT }, cmh),
          R_('A_' + hh + 'T', n.tT('A_' + hh), n.uT('A' + subU(hh)), Mat.transpose(hd.A), 'prob', 'T', 'T'), dZref(),
          R_('dV_' + hh, D + vT, n.u('dV' + subU(hh)), dV, 'grad', 'T', 'dk', h * dk));
          X_.push(Object.assign({ tpl: 'bwd.attn.softmax', block: bl + 'softmax', kind: 'grad_softmax',
            title: hcap + 'Retropropagación por el softmax',
            formula: dshT + ' = ' + aT + '\\odot\\left(' + dAT + ' - \\mathrm{rowsum}(' + dAT + '\\odot ' + aT + ')\\right)',
            dimsSym: '(T\\times T)\\odot(T\\times T)\\to(T\\times T)',
            inputs: [aRef(), dARef()], outputs: [dShRef()], aux: { rowDot } }, cmh));
          X_.push(Object.assign({ tpl: 'bwd.attn.mask', block: bl + 'mask', kind: 'grad_mask',
            title: hcap + 'La máscara bloquea el gradiente del futuro',
            formula: dstT + ' = ' + dshT + '\\odot\\mathbb{1}[M_{ij} = 0]',
            dimsSym: '(T\\times T)\\to(T\\times T)',
            inputs: [dShRef(), R_('M', 'M', 'M', cache.mask, 'mask', 'T', 'T')], outputs: [dStRef()], aux: {} }, cmh));
          X_.push(Object.assign({ tpl: 'bwd.attn.scale', block: bl + 'scale', kind: 'scale',
            title: hcap + 'Escalado del gradiente por 1/√d_k',
            formula: dsT + ' = \\frac{' + dstT + '}{\\sqrt{d_k}} = \\frac{' + dstT + '}{\\sqrt{' + dk + '}}',
            dimsSym: '(T\\times T)\\to(T\\times T)',
            inputs: [dStRef()], outputs: [dSRef()], aux: { factor: cache.factor, factorTex: '1/\\sqrt{d_k}', dk } }, cmh));
          X_.mm(Object.assign({ tpl: 'bwd.attn.scores.dQ', block: bl + 'scores', title: hcap + 'Gradiente de las consultas Q' + subU(hh),
            formula: D + n.t('Q_' + hh) + ' = ' + dsT + '\\,' + n.t('K_' + hh) }, cmh),
          dSRef(), R_('K_' + hh, n.t('K_' + hh), n.u('K' + subU(hh)), hd.Kh, 'act', 'T', 'dk', h * dk),
          R_('dQ_' + hh, D + n.t('Q_' + hh), n.u('dQ' + subU(hh)), dQ, 'grad', 'T', 'dk', h * dk));
          X_.mm(Object.assign({ tpl: 'bwd.attn.scores.dK', block: bl + 'scores', title: hcap + 'Gradiente de las claves K' + subU(hh),
            formula: D + n.t('K_' + hh) + ' = ' + D + n.tT('S_' + hh) + '\\,' + n.t('Q_' + hh) }, cmh),
          R_('dS_' + hh + 'T', D + n.tT('S_' + hh), n.uT('dS' + subU(hh)), Mat.transpose(dS), 'grad', 'T', 'T'),
          R_('Q_' + hh, n.t('Q_' + hh), n.u('Q' + subU(hh)), hd.Qh, 'act', 'T', 'dk', h * dk),
          R_('dK_' + hh, D + n.t('K_' + hh), n.u('dK' + subU(hh)), dK, 'grad', 'T', 'dk', h * dk));
        }
      }

      // ---- dQ = [dQ_1 ‖ …], dK, dV
      const dQ = Mat.concatCols(dQh), dK = Mat.concatCols(dKh), dV = Mat.concatCols(dVh);
      if (tr) {
        const inputs = [];
        const groups = [];
        const lists = [['Q', dQh], ['K', dKh], ['V', dVh]];
        lists.forEach(([L, arr], gi) => {
          const ins = [];
          arr.forEach((m, h) => {
            ins.push(inputs.length);
            inputs.push(R_('d' + L + '_' + (h + 1), D + n.t(L + '_' + (h + 1)), n.u('d' + L + subU(h + 1)), m, 'grad', 'T', 'dk', h * dk));
          });
          groups.push({ inputs: ins, output: gi });
        });
        X_.push(Object.assign({ tpl: 'bwd.attn.split', block: bl + 'split', kind: 'concat',
          title: n.cap + 'Se juntan los gradientes de las cabezas',
          formula: lists.map(([L, arr]) => D + n.t(L) + ' = [' + arr.map((_, h) => D + n.t(L + '_' + (h + 1))).join('\\,\\|\\,') + ']').join(',\\quad '),
          dimsSym: '3\\times h\\times(T\\times d_k)\\to 3\\times(T\\times d)',
          inputs,
          outputs: [R_('dQ', D + n.t('Q'), n.u('dQ'), dQ, 'grad', 'T', 'd'), R_('dK', D + n.t('K'), n.u('dK'), dK, 'grad', 'T', 'd'),
            R_('dV', D + n.t('V'), n.u('dV'), dV, 'grad', 'T', 'd')],
          aux: { nHeads: nH, dK: dk, groups } }, cm));
      }

      // ---- proyecciones Q, K, V
      const Wq = p[pre + 'Wq'], Wk = p[pre + 'Wk'], Wv = p[pre + 'Wv'];
      grads[pre + 'Wq'] = Mat.matmulAT(c.H, dQ);
      grads[pre + 'Wk'] = Mat.matmulAT(c.H, dK);
      grads[pre + 'Wv'] = Mat.matmulAT(c.H, dV);
      const dHq = Mat.matmulBT(dQ, Wq), dHk = Mat.matmulBT(dK, Wk), dHv = Mat.matmulBT(dV, Wv);
      const dH = Mat.add(Mat.add(dHq, dHk), dHv);
      const trip = [['q', 'Q', dQ, Wq, dHq], ['k', 'K', dK, Wk, dHk], ['v', 'V', dV, Wv, dHv]];
      if (tr) {
        const HT = Mat.transpose(c.H);
        for (const [s, L, dM] of trip) {
          X_.mm(Object.assign({ tpl: 'bwd.attn.' + s + '.dW', block: bl + 'qkv', title: n.cap + 'Gradiente de W_' + L,
            formula: D + n.t('W_' + L) + ' = ' + n.tT('H') + '\\,' + D + n.t(L) }, cm),
          R_('HT', n.tT('H'), n.uT('H'), HT, 'act', 'd', 'T'), R_('d' + L, D + n.t(L), n.u('d' + L), dM, 'grad', 'T', 'd'),
          R_('dW_' + L, D + n.t('W_' + L), n.u('dW_' + L), grads[pre + 'W' + s], 'grad', 'd', 'd'));
        }
        for (const [s, L, dM, W, out] of trip) {
          X_.mm(Object.assign({ tpl: 'bwd.attn.' + s + '.dX', block: bl + 'qkv', title: n.cap + 'Gradiente hacia H por la rama ' + L,
            formula: D + n.t('H') + '_{' + L + '} = ' + D + n.t(L) + '\\,' + n.tT('W_' + L) }, cm),
          R_('d' + L, D + n.t(L), n.u('d' + L), dM, 'grad', 'T', 'd'), R_('W_' + L + 'T', n.tT('W_' + L), n.uT('W_' + L), Mat.transpose(W), 'param', 'd', 'd'),
          R_('dH_' + L, D + n.t('H') + '_{' + L + '}', n.u('dH') + '_' + L, out, 'grad', 'T', 'd'));
        }
        X_.push(Object.assign({ tpl: 'bwd.attn.dH', block: bl + 'qkv', kind: 'accumulate',
          title: n.cap + 'H recibe gradiente por tres caminos (Q, K y V): se suman',
          formula: D + n.t('H') + ' = ' + ['Q', 'K', 'V'].map((L) => D + n.t('H') + '_{' + L + '}').join(' + '),
          dimsSym: '(T\\times d)+(T\\times d)+(T\\times d)\\to(T\\times d)',
          inputs: trip.map(([, L, , , out]) => R_('dH_' + L, D + n.t('H') + '_{' + L + '}', n.u('dH') + '_' + L, out, 'grad', 'T', 'd')),
          outputs: [R_('dH', D + n.t('H'), n.u('dH'), dH, 'grad', 'T', 'd')], aux: {} }, cm));
      }

      // ---- LayerNorm 1
      const g1 = p[pre + 'ln1.g'];
      const b1b = lnBackward(dH, c.ln1, g1);
      grads[pre + 'ln1.g'] = b1b.dg;
      grads[pre + 'ln1.b'] = b1b.db;
      const dXln = b1b.dx;
      const dXlnT = D + xi + '_{\\text{LN}}';
      if (tr) {
        X_.push(Object.assign({ tpl: 'bwd.ln1', block: bl + 'ln1', kind: 'grad_layernorm',
          title: n.cap + 'Retropropagación por LayerNorm 1',
          formula: lnBwdFormula(dXlnT, D + n.t('H'), n.t('\\gamma_1'), n.t('\\beta_1')),
          dimsSym: '(T\\times d)\\to(T\\times d),\\,(1\\times d),\\,(1\\times d)',
          inputs: [R_('dY', D + n.t('H'), n.u('dH'), dH, 'grad', 'T', 'd'), R_('X', xi, xLab(l), c.Xin, 'act', 'T', 'd'),
            R_('gamma', n.t('\\gamma_1'), n.u('γ₁'), g1, 'param', '1', 'd')],
          outputs: [R_('dX_ln', dXlnT, 'd' + xLab(l) + ' (LN)', dXln, 'grad', 'T', 'd'),
            R_('dgamma', D + n.t('\\gamma_1'), n.u('dγ₁'), b1b.dg, 'grad', '1', 'd'),
            R_('dbeta', D + n.t('\\beta_1'), n.u('dβ₁'), b1b.db, 'grad', '1', 'd')],
          aux: { mu: c.ln1.mu, sigma: c.ln1.sigma, xhat: c.ln1.xhat, dxhat: b1b.dxhat, eps: c.ln1.eps } }, cm));
      }
      const dXin = Mat.add(dR, dXln);
      if (tr) {
        X_.push(Object.assign({ tpl: 'bwd.res1.merge', block: bl + 'res1', kind: 'accumulate',
          title: n.cap + 'Residual 1: se suman los gradientes que llegan a ' + xLab(l),
          formula: D + xi + ' = ' + dXskipT + ' + ' + dXlnT,
          dimsSym: '(T\\times d)+(T\\times d)\\to(T\\times d)',
          inputs: [R_('dX_skip', dXskipT, 'd' + xLab(l) + ' (directo)', dR, 'grad', 'T', 'd'),
            R_('dX_ln', dXlnT, 'd' + xLab(l) + ' (LN)', dXln, 'grad', 'T', 'd')],
          outputs: [R_('dX', D + xi, 'd' + xLab(l), dXin, 'grad', 'T', 'd')], aux: {} }, cm));
      }
      dX = dXin;
    }

    // ---- codificación posicional: dX_emb = dX^{[0]} (y dP_pos[0:T] = dX^{[0]} si es aprendida)
    const learned = cfg.posEnc === 'learned';
    const dXemb = dX;
    if (learned) {
      const dP = new Mat(cfg.maxLen, d);
      dP.d.set(dX.d, 0);
      grads.P = dP;
    }
    if (tr) {
      const outs = [R_('dX_emb', D + 'X_{\\text{emb}}', 'dX_emb', dXemb, 'grad', 'T', 'd')];
      if (learned) outs.push(R_('dP_pos', D + 'P_{\\text{pos}}[0{:}T]', 'dP_pos[0:T]', dX, 'grad', 'T', 'd'));
      X_.push({ tpl: 'bwd.posenc', phase: 'backward', block: 'posenc', kind: 'residual_split',
        title: learned ? 'Gradiente por la codificación posicional (aprendida)' : 'Gradiente por la codificación posicional (PE es constante)',
        formula: D + 'X_{\\text{emb}} = ' + D + 'X^{[0]}' + (learned ? ',\\quad ' + D + 'P_{\\text{pos}}[0{:}T] = ' + D + 'X^{[0]}' : ''),
        dimsSym: learned ? '(T\\times d)\\to 2\\times(T\\times d)' : '(T\\times d)\\to(T\\times d)',
        inputs: [R_('dX0', D + 'X^{[0]}', 'd' + xLab(0), dX, 'grad', 'T', 'd')],
        outputs: outs,
        aux: { branches: learned ? ['embedding de tokens', 'posición aprendida'] : ['embedding de tokens'], posEnc: cfg.posEnc } });
    }

    // ---- embedding: dE = onehot(ids)ᵀ · dX_emb (suma dispersa de filas)
    const dE = new Mat(V, d);
    for (let t = 0; t < T; t++) {
      const row = cache.inputIds[t] * d;
      for (let j = 0; j < d; j++) dE.d[row + j] += dXemb.d[t * d + j];
    }
    grads.E = dE;
    if (tr) {
      X_.push({ tpl: 'bwd.embed', phase: 'backward', block: 'embed', kind: 'grad_lookup',
        title: 'Gradiente de la tabla de embeddings E',
        formula: D + 'E = \\mathrm{onehot}(\\mathrm{ids})^{\\top}\\,' + D + 'X_{\\text{emb}}',
        dimsSym: '(V\\times T)\\cdot(T\\times d)\\to(V\\times d)',
        inputs: [R_('onehotT', '\\mathrm{onehot}(\\mathrm{ids})^{\\top}', 'one-hotᵀ', Mat.transpose(Mat.oneHot(cache.inputIds, V)), 'onehot', 'V', 'T'),
          R_('dX_emb', D + 'X_{\\text{emb}}', 'dX_emb', dXemb, 'grad', 'T', 'd')],
        outputs: [R_('dE', D + 'E', 'dE', dE, 'grad', 'V', 'd')],
        aux: { ids: cache.inputIds.slice(), tokens: X_.tok.slice() } });
    }

    return { grads, steps: tr ? X_.steps : [] };
  }

  function lnBwdFormula(dX, dY, g, b) {
    const D = '\\mathrm{d}';
    return D + '\\hat X = ' + dY + '\\odot ' + g + ',\\quad ' +
      dX + ' = \\frac{1}{\\sigma}\\left(' + D + '\\hat X - \\overline{' + D + '\\hat X} - \\hat X\\odot\\overline{' + D + '\\hat X\\odot\\hat X}\\right),\\quad ' +
      D + g + ' = \\sum_t ' + dY + '\\odot\\hat X,\\quad ' + D + b + ' = \\sum_t ' + dY;
  }

  // ---------------------------------------------------------------- utilidades públicas
  function loss(model, inputIds, targetIds) {
    return forward(model, inputIds, targetIds, { trace: false }).loss;
  }

  function countParams(model) {
    const byName = {};
    let total = 0;
    for (const n of model.order) {
      const m = model.params[n];
      byName[n] = m.r * m.c;
      total += m.r * m.c;
    }
    return { total, byName };
  }

  // Mapa de dimensiones: CADA tensor del forward y del backward (una fila por tensor), con forma
  // simbólica (LaTeX) y numérica, agrupado por bloque. Extra: `phase` ('forward'|'backward'|'update').
  function shapeTable(model, T) {
    const cfg = model.cfg;
    const d = cfg.dModel, nH = cfg.nHeads, dk = d / nH, dff = cfg.dFF, V = model.vocab.length, N = cfg.nLayers;
    T = Math.max(1, Math.min(cfg.maxLen, (T | 0) || cfg.maxLen));
    const multi = N > 1;
    const SZ = { T, d, d_k: dk, 'd_{ff}': dff, V, 1: 1, 'T_{\\max}': cfg.maxLen };
    const rows = [];
    const D = '\\mathrm{d}';
    let phase = 'forward';
    const add = (group, tex, rs, cs, desc) => rows.push({ group, tex, sym: rs + '\\times ' + cs, shape: [SZ[rs], SZ[cs]], desc, phase });
    const learned = cfg.posEnc === 'learned';
    const actName = ACT[cfg.activation].name;
    const lnStats = (g, which) => {
      add(g, '\\mu_{' + which + '}', 'T', '1', 'LayerNorm ' + which + ': media de cada fila (una por posición).');
      add(g, '\\sigma_{' + which + '}', 'T', '1', 'LayerNorm ' + which + ': desviación típica √(var + ε) de cada fila.');
      add(g, '\\hat X_{' + which + '}', 'T', 'd', 'LayerNorm ' + which + ': filas normalizadas (media 0, varianza 1) antes de γ y β.');
    };

    // ---------- forward
    add('Datos', '\\mathrm{ids}', '1', 'T', 'Índices de los T tokens de entrada (el primero es <s>).');
    add('Datos', 'y', '1', 'T', 'Índices de los objetivos: la entrada desplazada una posición.');
    add('Datos', '\\mathrm{onehot}(\\mathrm{ids})', 'T', 'V', 'Cada fila es un vector one-hot: un 1 en la columna de su token.');
    add('Embeddings', 'E', 'V', 'd', 'Parámetro: tabla de embeddings (una fila de d números por token del vocabulario).');
    add('Embeddings', 'X_{\\text{emb}}', 'T', 'd', 'Embeddings de la entrada = filas de E elegidas por los ids.');
    if (learned) {
      add('Embeddings', 'P_{\\text{pos}}', 'T_{\\max}', 'd', 'Parámetro: codificación posicional aprendida (una fila por posición posible).');
      add('Embeddings', 'P_{\\text{pos}}[0{:}T]', 'T', 'd', 'Las T primeras filas de P_pos: las que usa esta secuencia.');
    } else {
      add('Embeddings', 'PE', 'T', 'd', 'Codificación posicional sinusoidal (fija, sin parámetros).');
    }
    add('Embeddings', 'X^{[0]}', 'T', 'd', 'Entrada de la primera capa: embedding + posición.');

    for (let l = 0; l < N; l++) {
      const n = layerNames(multi, l);
      const gA = 'Capa ' + (l + 1) + ' · Atención', gF = 'Capa ' + (l + 1) + ' · FFN';
      const sfx = multi ? '^{[' + (l + 1) + ']}' : '';
      add(gA, n.t('\\gamma_1'), '1', 'd', 'Parámetro: ganancia de LayerNorm 1.');
      add(gA, n.t('\\beta_1'), '1', 'd', 'Parámetro: sesgo de LayerNorm 1.');
      lnStats(gA, '1' + sfx);
      add(gA, n.t('H'), 'T', 'd', 'Salida de LayerNorm 1 (entrada de la atención).');
      add(gA, n.t('W_Q'), 'd', 'd', 'Parámetro: proyección de consultas.');
      add(gA, n.t('W_K'), 'd', 'd', 'Parámetro: proyección de claves.');
      add(gA, n.t('W_V'), 'd', 'd', 'Parámetro: proyección de valores.');
      add(gA, n.t('Q'), 'T', 'd', 'Consultas de todas las cabezas juntas: H·W_Q.');
      add(gA, n.t('K'), 'T', 'd', 'Claves de todas las cabezas juntas: H·W_K.');
      add(gA, n.t('V'), 'T', 'd', 'Valores de todas las cabezas juntas: H·W_V.');
      add(gA, 'M', 'T', 'T', 'Máscara causal: 0 en el pasado y la diagonal, −∞ en el futuro.');
      for (let h = 1; h <= nH; h++) {
        const cols = 'columnas ' + ((h - 1) * dk) + '…' + (h * dk - 1);
        const cab = 'Cabeza ' + h + ': ';
        add(gA, n.t('Q_' + h), 'T', 'd_k', cab + cols + ' de Q.');
        add(gA, n.t('K_' + h), 'T', 'd_k', cab + cols + ' de K.');
        add(gA, n.t('V_' + h), 'T', 'd_k', cab + cols + ' de V.');
        add(gA, n.tT('K_' + h), 'd_k', 'T', cab + 'claves traspuestas (para multiplicar Q·Kᵀ).');
        add(gA, n.t('S_' + h), 'T', 'T', cab + 'puntuaciones Q·Kᵀ (fila = consulta, columna = clave).');
        add(gA, n.t('\\tilde S_' + h), 'T', 'T', cab + 'puntuaciones escaladas por 1/√d_k.');
        add(gA, n.t('\\hat S_' + h), 'T', 'T', cab + 'puntuaciones con la máscara causal (−∞ en el futuro).');
        add(gA, n.t('A_' + h), 'T', 'T', cab + 'pesos de atención: softmax por filas (cada fila suma 1).');
        add(gA, n.t('Z_' + h), 'T', 'd_k', cab + 'contexto A·V: mezcla ponderada de los valores.');
      }
      add(gA, n.t('Z'), 'T', 'd', 'Contextos de las ' + nH + ' cabezas concatenados.');
      add(gA, n.t('W_O'), 'd', 'd', 'Parámetro: proyección de salida de la atención.');
      add(gA, n.t('O'), 'T', 'd', 'Salida de la atención: Z·W_O.');
      add(gA, n.t('R'), 'T', 'd', 'Residual 1: entrada de la capa + salida de la atención.');
      add(gF, n.t('\\gamma_2'), '1', 'd', 'Parámetro: ganancia de LayerNorm 2.');
      add(gF, n.t('\\beta_2'), '1', 'd', 'Parámetro: sesgo de LayerNorm 2.');
      lnStats(gF, '2' + sfx);
      add(gF, n.t("H'"), 'T', 'd', 'Salida de LayerNorm 2 (entrada de la FFN).');
      add(gF, n.t('W_1'), 'd', 'd_{ff}', 'Parámetro: primera capa de la FFN (expande de d a d_ff).');
      add(gF, n.t('b_1'), '1', 'd_{ff}', 'Parámetro: sesgo de la primera capa (se suma a cada fila: broadcasting).');
      add(gF, n.t('U'), 'T', 'd_{ff}', 'Preactivación de la FFN: H\'·W₁ + b₁.');
      add(gF, n.t('G'), 'T', 'd_{ff}', 'Activación ' + actName + '(U).');
      add(gF, n.t('W_2'), 'd_{ff}', 'd', 'Parámetro: segunda capa de la FFN (comprime de d_ff a d).');
      add(gF, n.t('b_2'), '1', 'd', 'Parámetro: sesgo de la segunda capa.');
      add(gF, n.t('F'), 'T', 'd', 'Salida de la FFN: G·W₂ + b₂.');
      add(gF, xTex(l + 1), 'T', 'd', 'Residual 2: salida de la capa ' + (l + 1) + ' (R + F).');
    }
    add('Salida', '\\gamma_f', '1', 'd', 'Parámetro: ganancia de la LayerNorm final.');
    add('Salida', '\\beta_f', '1', 'd', 'Parámetro: sesgo de la LayerNorm final.');
    lnStats('Salida', 'f');
    add('Salida', 'H_f', 'T', 'd', 'Salida de la LayerNorm final.');
    add('Salida', 'W_{\\text{out}}', 'd', 'V', 'Parámetro: proyección al vocabulario (una columna por token).');
    add('Salida', '\\mathrm{logits}', 'T', 'V', 'Puntuación de cada token del vocabulario en cada posición.');
    add('Salida', 'P', 'T', 'V', 'Probabilidades del siguiente token (cada fila suma 1).');
    add('Pérdida', 'Y', 'T', 'V', 'Objetivos one-hot: un 1 en la columna del token correcto de cada posición.');
    add('Pérdida', '\\ell_t', 'T', '1', 'Pérdida de cada posición: −log P[t, y_t].');
    add('Pérdida', '\\mathcal{L}', '1', '1', 'Entropía cruzada media sobre las T posiciones (un escalar).');

    // ---------- backward
    phase = 'backward';
    const gS = 'Gradientes · Salida';
    add(gS, D + '\\,\\mathrm{logits}', 'T', 'V', '(P − Y)/T: gradiente de la pérdida respecto a los logits.');
    add(gS, 'H_f^{\\top}', 'd', 'T', 'H_f traspuesta (para dW_out).');
    add(gS, D + 'W_{\\text{out}}', 'd', 'V', 'H_fᵀ · dlogits.');
    add(gS, 'W_{\\text{out}}^{\\top}', 'V', 'd', 'W_out traspuesta (para dH_f).');
    add(gS, D + 'H_f', 'T', 'd', 'dlogits · W_outᵀ.');
    add(gS, D + '\\gamma_f', '1', 'd', 'Σ_t dH_f ⊙ X̂ (gradiente de la ganancia final).');
    add(gS, D + '\\beta_f', '1', 'd', 'Σ_t dH_f (gradiente del sesgo final).');
    add(gS, D + xTex(N), 'T', 'd', 'Gradiente que entra por arriba en la capa ' + N + '.');
    for (let l = N - 1; l >= 0; l--) {
      const n = layerNames(multi, l);
      const gF = 'Gradientes · Capa ' + (l + 1) + ' · FFN', gA = 'Gradientes · Capa ' + (l + 1) + ' · Atención';
      add(gF, D + n.t('R') + '_{\\text{directo}}', 'T', 'd', 'Copia de dX' + supU(l + 1) + ' por el camino directo del residual 2.');
      add(gF, D + n.t('F'), 'T', 'd', 'Copia de dX' + supU(l + 1) + ' que entra en la FFN.');
      add(gF, n.tT('G'), 'd_{ff}', 'T', 'G traspuesta (para dW₂).');
      add(gF, D + n.t('W_2'), 'd_{ff}', 'd', 'Gᵀ · dF.');
      add(gF, D + n.t('b_2'), '1', 'd', 'Σ_t dF: suma de dF sobre las posiciones.');
      add(gF, n.tT('W_2'), 'd', 'd_{ff}', 'W₂ traspuesta (para dG).');
      add(gF, D + n.t('G'), 'T', 'd_{ff}', 'dF · W₂ᵀ.');
      add(gF, ACT[cfg.activation].tex + "'(" + n.t('U') + ')', 'T', 'd_{ff}', 'Derivada de la activación evaluada en U.');
      add(gF, D + n.t('U'), 'T', 'd_{ff}', 'dG ⊙ f\'(U).');
      add(gF, n.tT("H'"), 'd', 'T', 'H\' traspuesta (para dW₁).');
      add(gF, D + n.t('W_1'), 'd', 'd_{ff}', "H'ᵀ · dU.");
      add(gF, D + n.t('b_1'), '1', 'd_{ff}', 'Σ_t dU: suma de dU sobre las posiciones.');
      add(gF, n.tT('W_1'), 'd_{ff}', 'd', 'W₁ traspuesta (para dH\').');
      add(gF, D + n.t("H'"), 'T', 'd', 'dU · W₁ᵀ.');
      add(gF, D + n.t('\\gamma_2'), '1', 'd', 'Gradiente de la ganancia de LayerNorm 2.');
      add(gF, D + n.t('\\beta_2'), '1', 'd', 'Gradiente del sesgo de LayerNorm 2.');
      add(gF, D + n.t('R') + '_{\\text{LN}}', 'T', 'd', 'Gradiente que vuelve a R a través de LayerNorm 2.');
      add(gF, D + n.t('R'), 'T', 'd', 'Suma: camino directo + retropropagación por LayerNorm 2.');
      add(gA, D + xTex(l) + '_{\\text{directo}}', 'T', 'd', 'Copia de dR por el camino directo del residual 1.');
      add(gA, D + n.t('O'), 'T', 'd', 'Copia de dR que entra en la atención.');
      add(gA, n.tT('Z'), 'd', 'T', 'Z traspuesta (para dW_O).');
      add(gA, D + n.t('W_O'), 'd', 'd', 'Zᵀ · dO.');
      add(gA, n.tT('W_O'), 'd', 'd', 'W_O traspuesta (para dZ).');
      add(gA, D + n.t('Z'), 'T', 'd', 'dO · W_Oᵀ.');
      for (let h = 1; h <= nH; h++) {
        const cab = 'Cabeza ' + h + ': ';
        add(gA, D + n.t('Z_' + h), 'T', 'd_k', cab + 'columnas de dZ que le corresponden.');
        add(gA, n.tT('V_' + h), 'd_k', 'T', cab + 'valores traspuestos (para dA).');
        add(gA, D + n.t('A_' + h), 'T', 'T', cab + 'dZ · Vᵀ: gradiente de los pesos de atención.');
        add(gA, n.tT('A_' + h), 'T', 'T', cab + 'pesos traspuestos (para dV).');
        add(gA, D + n.t('V_' + h), 'T', 'd_k', cab + 'Aᵀ · dZ.');
        add(gA, D + n.t('\\hat S_' + h), 'T', 'T', cab + 'retropropagación por el softmax: A ⊙ (dA − rowsum(dA ⊙ A)).');
        add(gA, D + n.t('\\tilde S_' + h), 'T', 'T', cab + 'igual que dŜ con ceros donde la máscara es −∞.');
        add(gA, D + n.t('S_' + h), 'T', 'T', cab + 'dS̃ / √d_k.');
        add(gA, D + n.t('Q_' + h), 'T', 'd_k', cab + 'dS · K.');
        add(gA, D + n.tT('S_' + h), 'T', 'T', cab + 'dS traspuesta (para dK).');
        add(gA, D + n.t('K_' + h), 'T', 'd_k', cab + 'dSᵀ · Q.');
      }
      add(gA, D + n.t('Q'), 'T', 'd', 'Gradientes dQ de las cabezas concatenados.');
      add(gA, D + n.t('K'), 'T', 'd', 'Gradientes dK de las cabezas concatenados.');
      add(gA, D + n.t('V'), 'T', 'd', 'Gradientes dV de las cabezas concatenados.');
      add(gA, n.tT('H'), 'd', 'T', 'H traspuesta (para dW_Q, dW_K, dW_V).');
      add(gA, D + n.t('W_Q'), 'd', 'd', 'Hᵀ · dQ.');
      add(gA, D + n.t('W_K'), 'd', 'd', 'Hᵀ · dK.');
      add(gA, D + n.t('W_V'), 'd', 'd', 'Hᵀ · dV.');
      add(gA, D + n.t('H') + '_{Q}', 'T', 'd', 'dQ · W_Qᵀ: contribución de la rama Q a dH.');
      add(gA, D + n.t('H') + '_{K}', 'T', 'd', 'dK · W_Kᵀ: contribución de la rama K a dH.');
      add(gA, D + n.t('H') + '_{V}', 'T', 'd', 'dV · W_Vᵀ: contribución de la rama V a dH.');
      add(gA, D + n.t('H'), 'T', 'd', 'Suma de las tres contribuciones.');
      add(gA, D + n.t('\\gamma_1'), '1', 'd', 'Gradiente de la ganancia de LayerNorm 1.');
      add(gA, D + n.t('\\beta_1'), '1', 'd', 'Gradiente del sesgo de LayerNorm 1.');
      add(gA, D + xTex(l) + '_{\\text{LN}}', 'T', 'd', 'Gradiente que vuelve a X' + supU(l) + ' a través de LayerNorm 1.');
      add(gA, D + xTex(l), 'T', 'd', 'Suma: camino directo + retropropagación por LayerNorm 1.');
    }
    const gE = 'Gradientes · Embeddings';
    add(gE, D + 'X_{\\text{emb}}', 'T', 'd', 'Igual a dX⁽⁰⁾ (una suma reparte el gradiente sin cambiarlo).');
    if (learned) add(gE, D + 'P_{\\text{pos}}', 'T_{\\max}', 'd', 'Solo las T primeras filas reciben gradiente (= dX⁽⁰⁾); el resto, 0.');
    add(gE, '\\mathrm{onehot}(\\mathrm{ids})^{\\top}', 'V', 'T', 'One-hot traspuesta (para dE).');
    add(gE, D + 'E', 'V', 'd', 'onehotᵀ · dX_emb: cada fila de dX_emb se suma a la fila de su token.');

    // ---------- actualización
    phase = 'update';
    const inv = { V: 'V', d: 'd', dk: 'd_k', dff: 'd_{ff}', 1: '1', maxLen: 'T_{\\max}', T: 'T' };
    for (const name of model.order) {
      const pm = model.paramMeta[name];
      const rs = inv[pm.rowAxis], cs = inv[pm.colAxis];
      add('Optimizador (Adam)', 'm_{' + pm.tex + '}', rs, cs, 'Primer momento de Adam para ' + pm.label + ' (media móvil del gradiente).');
      add('Optimizador (Adam)', 'v_{' + pm.tex + '}', rs, cs, 'Segundo momento de Adam para ' + pm.label + ' (media móvil del gradiente al cuadrado).');
    }
    return rows;
  }

  TL.Model = {
    defaults: Object.assign({}, DEFAULTS),
    normalizeCfg,
    create,
    forward,
    backward,
    loss,
    countParams,
    shapeTable,
    dimsFromSym,
    activations: ACT,
    // expuestos para tests/visualización
    _internal: { lnForward, lnBackward, sinusoidalPE, causalMask, makeTrace, layerNames, supU, subU, fmt },
  };
})(typeof window !== 'undefined' ? window : globalThis);
