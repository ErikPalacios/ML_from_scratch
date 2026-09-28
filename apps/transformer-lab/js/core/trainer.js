/* Transformer Lab · sesión de entrenamiento: datos, iteración trazada, mini-lotes, evaluación,
   generación autoregresiva, comprobación de gradientes y snapshots. */
(function (root) {
  'use strict';
  const TL = (root.TL = root.TL || {});
  const Mat = TL.Mat;

  const DEFAULT_CORPUS = [
    'el gato come pescado .',
    'el perro come carne .',
    'la niña bebe leche .',
    'el niño bebe agua .',
    'el gato duerme en la casa .',
    'el perro duerme en el jardín .',
    'la niña lee un libro .',
    'el niño lee un cuento .',
  ].join('\n');

  function createSession(o) {
    o = o || {};
    const cfg = TL.Model.normalizeCfg(o.cfg);
    const hp = TL.Optim.normalize(o.optim);
    const corpus = o.corpus === undefined || o.corpus === null ? DEFAULT_CORPUS : String(o.corpus);
    const tokMode = o.tokMode === 'char' ? 'char' : 'word';
    const tok = TL.Tokenizer.build(corpus, tokMode, cfg.maxLen);
    const model = TL.Model.create(cfg, tok.vocab);
    const opt = TL.Optim.create(hp);
    const batchSize = Math.max(1, (o.batchSize | 0) || 4);
    return {
      tok,
      model,
      opt,
      cfg: model.cfg,
      hp,
      batchSize,
      corpus,
      tokMode,
      iter: 0,
      history: [],
      lastGradNorms: {},
      lastGradNorm: null,
      lastClipFactor: 1,
      diverged: false, // la pérdida o el gradiente dejaron de ser finitos (NaN/∞): no se sigue actualizando
      _rng: TL.rng((cfg.seed ^ 0x5bd1e995) >>> 0), // barajado de mini-lotes (determinista)
      _perm: [],
      _cursor: 0,
    };
  }

  // Cambia hiperparámetros del optimizador sin reiniciar (lr, betas, clip…). Extra, no en la spec.
  function setHyper(s, patch) {
    const hp = TL.Optim.normalize(Object.assign({}, s.hp, patch || {}));
    const typeChanged = hp.type !== s.opt.type;
    s.hp = hp;
    if (typeChanged) {
      s.opt = TL.Optim.create(hp);
    } else {
      Object.assign(s.opt, { lr: hp.lr, beta1: hp.beta1, beta2: hp.beta2, eps: hp.eps, clip: hp.clip });
    }
    if (patch && patch.batchSize) s.batchSize = Math.max(1, patch.batchSize | 0);
    return s;
  }

  function sentence(s, idx) {
    const n = s.tok.sentences.length;
    const i = ((idx | 0) % n + n) % n;
    return s.tok.sentences[i];
  }

  function tokenizeStep(s, sen) {
    const tok = s.tok;
    const disp = sen.inputTokens.map(tok.display);
    const ids = Mat.fromRow(sen.inputIds);
    // la frase no va dentro de la fórmula (en \text{} se verían escapes como \_ o \%): la interfaz
    // la muestra como texto aparte, desde aux.text
    return {
      id: 'data.tokenize', tpl: 'data.tokenize', phase: 'data', block: 'tokens', layer: null, head: null, kind: 'tokenize',
      title: 'Tokenización: texto → ' + sen.T + ' ids (entrada) y ' + sen.T + ' objetivos',
      formula: '\\text{texto}\\;\\mapsto\\;\\mathrm{ids} = [' + sen.inputIds.join(',\\,') + '],\\quad y = [' + sen.targetIds.join(',\\,') + ']',
      dimsSym: '\\text{texto}\\to(1\\times T)',
      dims: '\\text{texto}\\to(1\\times ' + sen.T + ')',
      inputs: [],
      outputs: [{ key: 'ids', tex: '\\mathrm{ids}', label: 'ids', mat: ids, role: 'const', rowAxis: '1', colAxis: 'T',
        rowLabels: null, colLabels: disp, colOffset: 0 }],
      aux: {
        text: sen.text,
        tokens: sen.tokens.slice(),
        ids: sen.ids.slice(),
        inputTokens: sen.inputTokens.slice(),
        targetTokens: sen.targetTokens.slice(),
        inputIds: sen.inputIds.slice(),
        targetIds: sen.targetIds.slice(),
        vocab: tok.vocab.slice(),
        mode: tok.mode,
        truncated: !!sen.truncated,
      },
      flops: null,
    };
  }

  // UNA iteración completa trazada sobre UNA frase: datos + forward + pérdida + backward + actualización.
  function traceIteration(s, sentenceIndex) {
    const sen = sentence(s, sentenceIndex);
    const steps = [tokenizeStep(s, sen)];
    const f = TL.Model.forward(s.model, sen.inputIds, sen.targetIds, { trace: true });
    const b = TL.Model.backward(s.model, f.cache, { trace: true });
    const u = TL.Optim.step(s.opt, s.model, b.grads, { trace: true });
    for (const st of f.steps) steps.push(st);
    for (const st of b.steps) steps.push(st);
    for (const st of u.steps) steps.push(st);
    s.iter += 1;
    s.history.push({ iter: s.iter, loss: f.loss, traced: true });
    s.lastGradNorms = u.norms;
    s.lastGradNorm = u.gradNorm;
    s.lastClipFactor = u.clipFactor;
    if (!Number.isFinite(f.loss) || f.lossCapped || !Number.isFinite(u.gradNorm)) s.diverged = true;
    return { steps, loss: f.loss, iter: s.iter, sentenceIndex: s.tok.sentences.indexOf(sen), gradNorm: u.gradNorm, clipFactor: u.clipFactor };
  }

  function nextIndex(s) {
    const n = s.tok.sentences.length;
    if (s._cursor >= s._perm.length) {
      const p = [];
      for (let i = 0; i < n; i++) p.push(i);
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(s._rng() * (i + 1));
        const t = p[i]; p[i] = p[j]; p[j] = t;
      }
      s._perm = p;
      s._cursor = 0;
    }
    return s._perm[s._cursor++];
  }

  // n iteraciones sin traza; cada una con un mini-lote de s.batchSize frases (gradientes promediados).
  // Si el entrenamiento diverge (pérdida o norma del gradiente no finitas, o una probabilidad del
  // objetivo por debajo de 1e-300, que haría la pérdida +∞), se marca s.diverged y se
  // deja de actualizar: seguir solo propagaría NaN (hay que bajar η o activar el recorte y reiniciar).
  function trainSteps(s, n) {
    n = Math.max(0, n | 0);
    const model = s.model;
    const losses = [];
    const B = Math.max(1, s.batchSize | 0);
    const acc = {};
    for (const name of model.order) acc[name] = new Mat(model.params[name].r, model.params[name].c);
    for (let it = 0; it < n; it++) {
      if (s.diverged) break;
      for (const name of model.order) acc[name].d.fill(0);
      let lsum = 0, capped = false;
      for (let b = 0; b < B; b++) {
        const sen = s.tok.sentences[nextIndex(s)];
        const f = TL.Model.forward(model, sen.inputIds, sen.targetIds, { trace: false });
        const g = TL.Model.backward(model, f.cache, { trace: false }).grads;
        lsum += f.loss;
        if (f.lossCapped) capped = true;
        for (const name of model.order) {
          const a = acc[name].d, gd = g[name].d;
          for (let k = 0; k < a.length; k++) a[k] += gd[k];
        }
      }
      const inv = 1 / B;
      for (const name of model.order) {
        const a = acc[name].d;
        for (let k = 0; k < a.length; k++) a[k] *= inv;
      }
      const u = TL.Optim.step(s.opt, model, acc, { trace: false });
      const loss = lsum / B;
      s.iter += 1;
      s.history.push({ iter: s.iter, loss });
      s.lastGradNorms = u.norms;
      s.lastGradNorm = u.gradNorm;
      s.lastClipFactor = u.clipFactor;
      losses.push(loss);
      // pérdida o gradiente no finitos, o una probabilidad del objetivo < 1e-300 (logits desbocados)
      if (!Number.isFinite(loss) || capped || !Number.isFinite(u.gradNorm)) s.diverged = true;
    }
    return { losses, diverged: s.diverged };
  }

  function evaluate(s) {
    const per = [];
    let sum = 0;
    for (const sen of s.tok.sentences) {
      const l = TL.Model.loss(s.model, sen.inputIds, sen.targetIds);
      per.push({ text: sen.text, loss: l });
      sum += l;
    }
    return { loss: sum / per.length, perSentence: per };
  }

  function predict(s, sentenceIndex) {
    const sen = sentence(s, sentenceIndex);
    const f = TL.Model.forward(s.model, sen.inputIds, sen.targetIds, { trace: false });
    return { probs: f.probs, attn: f.attn, loss: f.loss, inputTokens: sen.inputTokens.slice(), targetTokens: sen.targetTokens.slice(),
      inputIds: sen.inputIds.slice(), targetIds: sen.targetIds.slice(), text: sen.text };
  }

  // Generación autoregresiva (solo forward). Ventana deslizante de maxLen tokens; se detiene en '.'.
  function generate(s, promptText, opts) {
    opts = opts || {};
    const maxNew = opts.maxNew === undefined ? 10 : Math.max(0, opts.maxNew | 0);
    // τ ≤ 0 (p. ej. 0) se trata como τ = 0.001 (prácticamente greedy); un valor no numérico, como τ = 1.
    const tRaw = opts.temperature === undefined || opts.temperature === null || opts.temperature === '' ? 1 : Number(opts.temperature);
    const temperature = Number.isFinite(tRaw) ? Math.max(1e-3, tRaw) : 1;
    const greedy = opts.greedy === undefined ? true : !!opts.greedy;
    const topK = opts.topK === undefined ? 10 : Math.max(1, opts.topK | 0);
    const rng = TL.rng(opts.seed === undefined || opts.seed === null ? (s.cfg.seed + 7) : (opts.seed | 0));
    const tok = s.tok;
    const enc = tok.encode(promptText || '');
    if (enc.unknown.length) {
      return { ok: false, error: tok.unknownMessage(enc.unknown), unknown: enc.unknown, tokens: [], steps: [] };
    }
    const ids = [0].concat(enc.ids);
    const V = tok.vocab.length;
    const maxLen = s.cfg.maxLen;
    const steps = [];
    let stoppedBy = 'maxNew';
    for (let k = 0; k < maxNew; k++) {
      const ctx = ids.slice(Math.max(0, ids.length - maxLen));
      const f = TL.Model.forward(s.model, ctx, null, { trace: false });
      const T = ctx.length;
      const logits = f.logits.d.subarray((T - 1) * V, T * V);
      // distribución con temperatura: p ∝ exp(logit/τ)
      let mx = -Infinity;
      for (let j = 0; j < V; j++) if (logits[j] / temperature > mx) mx = logits[j] / temperature;
      const probs = new Float64Array(V);
      let sum = 0;
      for (let j = 0; j < V; j++) { probs[j] = Math.exp(logits[j] / temperature - mx); sum += probs[j]; }
      for (let j = 0; j < V; j++) probs[j] /= sum;
      let chosen = 0;
      if (greedy) {
        for (let j = 1; j < V; j++) if (probs[j] > probs[chosen]) chosen = j;
      } else {
        const r = rng();
        let c = 0;
        chosen = V - 1;
        for (let j = 0; j < V; j++) { c += probs[j]; if (r < c) { chosen = j; break; } }
      }
      const order = Array.from({ length: V }, (_, j) => j).sort((a, b) => probs[b] - probs[a]);
      const top = order.slice(0, Math.min(topK, V)).map((j) => ({ token: tok.vocab[j], display: tok.display(tok.vocab[j]), id: j, p: probs[j] }));
      steps.push({
        context: ctx.map((i) => tok.vocab[i]),
        contextIds: ctx.slice(),
        probs,
        chosen,
        chosenToken: tok.vocab[chosen],
        pChosen: probs[chosen],
        top,
        attn: f.attn,
        slid: ids.length > maxLen,
      });
      ids.push(chosen);
      if (tok.vocab[chosen] === '.') { stoppedBy = 'punto'; break; }
    }
    return {
      ok: true,
      tokens: ids.map((i) => tok.vocab[i]),
      text: tok.decode(ids),
      generated: ids.slice(enc.ids.length + 1).map((i) => tok.vocab[i]),
      steps,
      stoppedBy,
      temperature,
      greedy,
    };
  }

  // Comprobación de gradientes por diferencias centrales: (ℒ(θ+h) − ℒ(θ−h)) / 2h frente al backward.
  function gradCheck(s, sentenceIndex, opts) {
    opts = opts || {};
    const perParam = opts.perParam === undefined ? 3 : Math.max(1, opts.perParam | 0);
    const h = opts.h === undefined ? 1e-5 : Number(opts.h);
    const sen = sentence(s, sentenceIndex);
    const model = s.model;
    const f = TL.Model.forward(model, sen.inputIds, sen.targetIds, { trace: false });
    const grads = TL.Model.backward(model, f.cache, { trace: false }).grads;
    const rng = TL.rng((s.cfg.seed * 31 + 17) >>> 0);
    const out = [];
    for (const name of model.order) {
      const P = model.params[name], G = grads[name];
      const n = P.d.length;
      const gmax = G.maxAbs();
      // se eligen entradas con gradiente apreciable (si todas son 0, cualquiera)
      let cand = [];
      for (let k = 0; k < n; k++) if (Math.abs(G.d[k]) >= 0.01 * gmax && Math.abs(G.d[k]) > 1e-9) cand.push(k);
      if (!cand.length) cand = Array.from({ length: n }, (_, k) => k);
      const picked = [];
      let best = cand[0];
      for (const k of cand) if (Math.abs(G.d[k]) > Math.abs(G.d[best])) best = k;
      picked.push(best);
      const pool = cand.filter((k) => k !== best);
      while (picked.length < perParam && pool.length) picked.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
      for (const k of picked) {
        const old = P.d[k];
        P.d[k] = old + h;
        const lp = TL.Model.loss(model, sen.inputIds, sen.targetIds);
        P.d[k] = old - h;
        const lm = TL.Model.loss(model, sen.inputIds, sen.targetIds);
        P.d[k] = old;
        const numeric = (lp - lm) / (2 * h);
        const analytic = G.d[k];
        const denom = Math.max(Math.abs(analytic), Math.abs(numeric));
        const relErr = denom < 1e-12 ? Math.abs(analytic - numeric) : Math.abs(analytic - numeric) / denom;
        out.push({ name, tex: model.paramMeta[name].tex, i: Math.floor(k / P.c), j: k % P.c, analytic, numeric, relErr });
      }
    }
    return out;
  }

  function snapshot(s) {
    const params = {};
    for (const name of s.model.order) params[name] = s.model.params[name].d.slice();
    const m = {}, v = {};
    for (const k in s.opt.m) m[k] = s.opt.m[k].slice();
    for (const k in s.opt.v) v[k] = s.opt.v[k].slice();
    return {
      params,
      opt: { type: s.opt.type, lr: s.opt.lr, beta1: s.opt.beta1, beta2: s.opt.beta2, eps: s.opt.eps, clip: s.opt.clip, t: s.opt.t, m, v },
      hp: Object.assign({}, s.hp),
      iter: s.iter,
      history: s.history.map((h) => Object.assign({}, h)),
      lastGradNorms: Object.assign({}, s.lastGradNorms),
      lastGradNorm: s.lastGradNorm,
      lastClipFactor: s.lastClipFactor,
      diverged: !!s.diverged,
      rngState: s._rng.getState(),
      perm: s._perm.slice(),
      cursor: s._cursor,
    };
  }

  function restore(s, snap) {
    for (const name of s.model.order) {
      if (!snap.params[name] || snap.params[name].length !== s.model.params[name].d.length) {
        throw new Error('El snapshot no corresponde a este modelo (parámetro ' + name + ').');
      }
      s.model.params[name].d.set(snap.params[name]);
    }
    const o = snap.opt;
    const m = {}, v = {};
    for (const k in o.m) m[k] = o.m[k].slice();
    for (const k in o.v) v[k] = o.v[k].slice();
    s.opt = { type: o.type, lr: o.lr, beta1: o.beta1, beta2: o.beta2, eps: o.eps, clip: o.clip, t: o.t, m, v };
    if (snap.hp) s.hp = Object.assign({}, snap.hp);
    s.iter = snap.iter;
    s.history = snap.history.map((h) => Object.assign({}, h));
    s.lastGradNorms = Object.assign({}, snap.lastGradNorms);
    s.lastGradNorm = snap.lastGradNorm === undefined ? null : snap.lastGradNorm;
    s.lastClipFactor = snap.lastClipFactor === undefined ? 1 : snap.lastClipFactor;
    s.diverged = !!snap.diverged;
    s._rng.setState(snap.rngState);
    s._perm = snap.perm.slice();
    s._cursor = snap.cursor;
    return s;
  }

  TL.Trainer = {
    DEFAULT_CORPUS,
    createSession,
    setHyper,
    traceIteration,
    trainSteps,
    evaluate,
    predict,
    generate,
    gradCheck,
    snapshot,
    restore,
  };
})(typeof window !== 'undefined' ? window : globalThis);
