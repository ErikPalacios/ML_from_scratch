/* =============================================================================
   Transformer Lab — js/app.js
   TL.App: estado, pestañas, línea de tiempo y cableado de toda la interfaz (spec §10).

   API de automatización (la usan las pruebas de integración):
     TL.App.state                       estado vivo (sesión, traza, paso actual…)
     TL.App.goToStep(i)                 va al paso i (0-based) de la traza actual → resumen del paso
     TL.App.getStep()                   objeto Step actual (con sus tensores)
     TL.App.setTab('paso'|'entrenamiento'|'generacion'|'datos')
     TL.App.newIteration([sentence])    traza otra iteración (mantiene el índice del paso)
     TL.App.train(n)                    n iteraciones sin traza (minilotes) → { iter, loss, meanLoss }
     TL.App.generate(prompt, opts)      genera y lo muestra en «Generación» → { ok, text, error, steps }
     TL.App.applyConfig({corpus, tokMode, cfg, hp, batchSize}) → { ok, errors }
   Dependencias opcionales (con respaldo si faltan): TL.MathTex, TL.Heatmap, TL.OpViews.
   ========================================================================== */
(function (root) {
  'use strict';
  const TL = (root.TL = root.TL || {});
  const doc = root.document;
  if (!doc) return;

  // ───────────────────────────────────────────────────────────── utilidades
  const $ = (id) => doc.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const now = () => (root.performance && performance.now ? performance.now() : Date.now());
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // h('div', {class, text, html, on…, dataset, style}, ...hijos)
  function h(tag, props) {
    const el = doc.createElement(tag);
    if (props) {
      for (const k in props) {
        const v = props[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, String(v));
      }
    }
    for (let i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { for (const x of c) append(el, x); return; }
    el.appendChild(c.nodeType ? c : doc.createTextNode(String(c)));
  }

  const store = {
    get(k, d) {
      try { const v = root.localStorage.getItem('tl.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set(k, v) { try { root.localStorage.setItem('tl.' + k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } },
  };

  const MINUS = '−';
  function fmt(v, n) {
    if (v === null || v === undefined || Number.isNaN(v)) return '—';
    if (!Number.isFinite(v)) return v > 0 ? '∞' : MINUS + '∞';
    let s = v.toFixed(n === undefined ? 3 : n);
    if (/^-0(\.0*)?$/.test(s)) s = s.slice(1);
    return s.replace(/^-/, MINUS);
  }
  const fmtInt = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('es-ES') : '—');
  const SUPD = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  // 2.3·10⁻¹⁰
  function sci(v, digits) {
    if (!Number.isFinite(v)) return fmt(v);
    if (v === 0) return '0';
    const a = Math.abs(v);
    if (a >= 1e-3 && a < 1e4) return fmt(v, digits === undefined ? 4 : digits);
    const e = Math.floor(Math.log10(a));
    let m = v / Math.pow(10, e);
    m = +m.toFixed(digits === undefined ? 1 : Math.min(digits, 3));
    return String(m).replace(/^-/, MINUS) + '·10' + String(e).split('').map((c) => SUPD[c]).join('');
  }
  // número con 6 cifras significativas (para comparar analítico / numérico)
  function sig(v, n) {
    if (!Number.isFinite(v)) return fmt(v);
    if (v === 0) return '0';
    const a = Math.abs(v);
    if (a < 1e-4 || a >= 1e6) return sci(v, 3);
    return (+v.toPrecision(n || 6)).toString().replace(/^-/, MINUS);
  }

  function afterPaint(fn) {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(fn, 0));
    else setTimeout(fn, 16);
  }
  // trocea un trabajo largo en porciones para no bloquear la interfaz; devuelve cancelar()
  function chunked(items, fn, per) {
    let i = 0, off = false;
    per = per || 16;
    function run() {
      if (off) return;
      const end = Math.min(items.length, i + per);
      for (; i < end; i++) fn(items[i], i);
      if (i < items.length) setTimeout(run, 0);
    }
    setTimeout(run, 0);
    return () => { off = true; };
  }

  // Texto plano del motor ('W_Q', 'd_k', 'H_f') → HTML con subíndices
  function richTitle(s) {
    return esc(s).replace(/([A-Za-zΣγβμσθηεŜ\u0300-\u036f])_(\{[^}]*\}|[A-Za-z0-9]+)/g, (m, a, b) => a + '<sub>' + b.replace(/[{}]/g, '') + '</sub>');
  }

  // ───────────────────────────────────────────── envoltorios con respaldo (viz)
  const Tex = {
    render(tex, el, opts) {
      if (!el) return el;
      if (TL.MathTex && typeof TL.MathTex.render === 'function') {
        try { TL.MathTex.render(tex, el, opts || {}); return el; } catch (e) { /* respaldo abajo */ }
      }
      el.textContent = '';
      el.appendChild(h('code', { class: 'tex-fallback', text: tex }));
      return el;
    },
    typeset(el) {
      if (el && TL.MathTex && typeof TL.MathTex.typeset === 'function') {
        try { return Promise.resolve(TL.MathTex.typeset(el)).catch(() => {}).then(() => fitWideMath(el)); } catch (e) { /* nada */ }
      }
      return Promise.resolve();
    },
    lite(tex) { return TL.Charts && TL.Charts.texLite ? TL.Charts.texLite(tex) : esc(tex); },
  };

  // Una fórmula en línea no puede partirse: si es más ancha que su párrafo, pasa a bloque con scroll propio
  function fitWideMath(root) {
    if (!root || !root.isConnected) return;
    for (const m of root.querySelectorAll('.tex:not(.tex--display):not(.tex--wide), mjx-container:not([display="true"])')) {
      const box = m.parentElement && m.parentElement.closest('p, li, dd, td, div');
      if (!box || !box.clientWidth) continue; // oculto: se comprobará al mostrarse
      if (m.getBoundingClientRect().width > box.clientWidth - 2) m.classList.add('tex--wide');
    }
  }

  // Mapa de calor mínimo (solo si falta TL.Heatmap)
  function fallbackHeatmap(ref, opts) {
    const fig = h('figure', { class: 'hm-fb' });
    const cap = h('figcaption', { class: 'hm-fb__cap' });
    const name = h('span', { class: 'hm-fb__name' });
    Tex.render(ref.tex, name);
    cap.append(name, h('span', { class: 'badge-shape', text: ref.mat.r + '×' + ref.mat.c }));
    const wrap = h('div', { class: 'hm-fb__wrap' });
    const table = h('table', { class: 'hm-fb__t' });
    wrap.append(table);
    if (!opts || opts.caption !== false) fig.append(cap);
    fig.append(wrap);
    const seq = ref.role === 'prob' || ref.role === 'onehot' || ref.role === 'mask';
    function update(mat) {
      table.textContent = '';
      let mx = 1e-12;
      for (let k = 0; k < mat.d.length; k++) if (Number.isFinite(mat.d[k])) mx = Math.max(mx, Math.abs(mat.d[k]));
      if (opts && opts.maxAbs) mx = opts.maxAbs;
      if (ref.colLabels) {
        const tr = h('tr', null, h('th'));
        for (const l of ref.colLabels) tr.append(h('th', { text: l }));
        table.append(tr);
      }
      for (let i = 0; i < mat.r; i++) {
        const tr = h('tr', null, h('th', { text: ref.rowLabels ? ref.rowLabels[i] : String(i) }));
        for (let j = 0; j < mat.c; j++) {
          const v = mat.d[i * mat.c + j];
          const td = h('td', { title: fmt(v, 4) });
          if (!Number.isFinite(v)) td.className = 'is-masked';
          else if (seq) td.style.background = 'color-mix(in srgb, var(--prob-1) ' + Math.round(clamp(v, 0, 1) * 100) + '%, var(--prob-0))';
          else td.style.background = 'color-mix(in srgb, var(' + (v < 0 ? '--neg' : '--pos') + ') ' + Math.round(Math.abs(v) / mx * 100) + '%, var(--zero))';
          tr.append(td);
        }
        table.append(tr);
      }
    }
    update(ref.mat);
    const noop = () => {};
    return { el: fig, update, highlightCell: noop, highlightRow: noop, highlightCol: noop, clear: noop, destroy() { fig.remove(); } };
  }
  function makeHeatmap(ref, opts) {
    if (TL.Heatmap && typeof TL.Heatmap.create === 'function') {
      try { return TL.Heatmap.create(ref, opts || {}); } catch (e) { console.error('TL.Heatmap.create falló:', e); }
    }
    return fallbackHeatmap(ref, opts);
  }
  function destroyHeatmap(hm) {
    if (!hm) return;
    try { if (typeof hm.destroy === 'function') hm.destroy(); else if (hm.el) hm.el.remove(); } catch (e) { /* nada */ }
  }

  // Vista de respaldo de un paso (solo si falta TL.OpViews): entradas → salidas
  function fallbackView(st, el) {
    const wrap = h('div', { class: 'fb-view' });
    const hms = [];
    const col = (refs, title) => {
      const c = h('div', { class: 'fb-view__col' }, h('div', { class: 'eyebrow', text: title }));
      for (const r of refs) { const hm = fallbackHeatmap(r, {}); hms.push(hm); c.append(hm.el); }
      return c;
    };
    if (st.inputs.length) wrap.append(col(st.inputs, 'Entradas'));
    if (st.inputs.length && st.outputs.length) wrap.append(h('div', { class: 'fb-view__arrow', text: '↦' }));
    if (st.outputs.length) wrap.append(col(st.outputs, 'Salidas'));
    if (!st.inputs.length && !st.outputs.length && st.aux && st.aux.norms) {
      const ul = h('ul', { class: 'fb-view__norms' });
      for (const n of st.aux.norms) ul.append(h('li', null, n.name + ': ‖d' + n.name + '‖ = ' + fmt(n.norm, 4)));
      wrap.append(ul);
    }
    el.append(wrap);
    return { destroy() { wrap.remove(); } };
  }

  // ───────────────────────────────────────────────────────────── constantes
  const TABS = ['paso', 'entrenamiento', 'generacion', 'datos'];
  const PHASE_FALLBACK = { data: 'Datos', forward: 'Forward', loss: 'Pérdida', backward: 'Backward', update: 'Actualización' };
  const PHASE_SHORT = { data: 'D', forward: 'Fwd', loss: 'ℒ', backward: 'Bwd', update: 'Act.' };
  const PHASE_CHIP = { data: 'chip--data', forward: 'chip--fwd', loss: 'chip--loss', backward: 'chip--bwd', update: 'chip--upd' };
  const KIND_NAME = {
    tokenize: 'tokenización', lookup: 'búsqueda de filas (one-hot · E)', add: 'suma elemento a elemento',
    layernorm: 'normalización por filas', matmul: 'producto de matrices', split: 'división en cabezas',
    concat: 'concatenación', scale: 'escalado', mask: 'máscara causal', softmax: 'softmax por filas',
    activation: 'activación elemento a elemento', crossentropy: 'entropía cruzada', grad_ce: 'gradiente de softmax + entropía cruzada',
    grad_softmax: 'gradiente del softmax', grad_mask: 'gradiente a través de la máscara', grad_layernorm: 'gradiente de LayerNorm',
    grad_activation: 'gradiente de la activación', grad_lookup: 'gradiente del embedding (suma dispersa)', sumrows: 'suma de filas',
    residual_split: 'copia del gradiente', accumulate: 'acumulación de gradientes', gradnorm: 'norma global del gradiente',
    update: 'regla de actualización',
  };
  const AX_DG = { T: 'T', V: 'V', d: 'd', dk: 'd_k', dff: 'd_{ff}', 1: '1', maxLen: 'T_{max}' };
  const AX_HTML = { T: '<i>T</i>', V: '<i>V</i>', d: '<i>d</i>', dk: '<i>d</i><sub>k</sub>', dff: '<i>d</i><sub>ff</sub>', 1: '1', maxLen: '<i>T</i><sub>max</sub>' };
  const SYM_HTML = { T: '<i>T</i>', d: '<i>d</i>', h: '<i>h</i>', dk: '<i>d</i><sub>k</sub>', dff: '<i>d</i><sub>ff</sub>', V: '<i>V</i>', N: '<i>N</i>', lr: '<i>η</i>' };
  const THEME_NAME = { auto: 'Sistema', light: 'Claro', dark: 'Oscuro' };
  const THEME_ORDER = ['auto', 'light', 'dark'];
  const PLAY_BASE_MS = 1500;

  const phaseName = (p) => {
    const c = TL.Content && TL.Content.phases && TL.Content.phases[p];
    return (c && c.name) || PHASE_FALLBACK[p] || p;
  };
  // forma simbólica en HTML: 'T\\times d_k' → T×d<sub>k</sub>
  function symHtml(sym) {
    return String(sym)
      .replace(/\\times\s*/g, '×')
      .replace(/T_\{\\max\}/g, '<i>T</i><sub>max</sub>')
      .replace(/d_\{ff\}/g, '<i>d</i><sub>ff</sub>')
      .replace(/d_k/g, '<i>d</i><sub>k</sub>')
      .replace(/(^|×)([TVd])(?=×|$)/g, '$1<i>$2</i>');
  }
  const axHtml = (r, c) => (AX_HTML[r] || esc(r)) + '×' + (AX_HTML[c] || esc(c));

  // ───────────────────────────────────────────────────────────── estado
  const S = {
    s: null,              // sesión de TL.Trainer
    config: null,         // { corpus, tokMode, cfg, hp, batchSize }
    trace: null,          // { steps, loss, iter, sentenceIndex, T }
    prevTrace: null,
    idx: 0,
    tab: 'paso',
    theme: store.get('theme', 'auto'),
    showValues: store.get('showValues', true) !== false,
    playing: false,
    speed: 1,
    playTimer: 0,
    dragging: false,
    view: null,
    dg: null,
    modalOpen: false,
    training: false,
    trainSpeed: 'media',
    perf: { lastStepMs: 0, maxStepMs: 0 },
    gen: null,            // último resultado de generación
    genVisited: false,
    datosDirty: true,
    ready: false,
  };

  // cachés que dependen de la sesión
  let explCache = new Map();
  let liveItems = [], liveSig = '', cancelLiveTex = null;
  let tickEls = [], runs = [];

  // ───────────────────────────────────────────────────────────── tema
  function applyTheme(t, silent) {
    if (!THEME_NAME[t]) t = 'auto';
    S.theme = t;
    if (t === 'auto') doc.documentElement.removeAttribute('data-theme');
    else doc.documentElement.setAttribute('data-theme', t);
    $('btn-theme-label').textContent = THEME_NAME[t];
    $('btn-theme').setAttribute('aria-label', 'Tema: ' + THEME_NAME[t].toLowerCase() + '. Pulsa para cambiar');
    store.set('theme', t);
    if (!silent) onThemeChange();
  }
  function onThemeChange() {
    afterPaint(() => {
      if (S.trace) renderStage(S.trace.steps[S.idx]);
      drawSpark();
      for (const x of trainHms) if (x.hm && x.hm.update && x.mat) x.hm.update(x.mat);
      for (const x of genHms) if (x.hm && x.hm.update && x.mat) x.hm.update(x.mat);
    });
  }

  // ───────────────────────────────────────────────────────────── pestañas
  function setTab(id, o) {
    o = o || {};
    if (TABS.indexOf(id) < 0) id = 'paso';
    const changed = S.tab !== id;
    if (!changed && !o.force) return S.tab;
    if (changed && S.tab === 'entrenamiento') stopTraining();
    if (id !== 'paso') stopPlay();
    S.tab = id;
    for (const t of TABS) {
      const tab = $('tab-' + t), panel = $('panel-' + t);
      const on = t === id;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      panel.hidden = !on;
    }
    doc.body.setAttribute('data-tab', id);
    $('timeline').hidden = id !== 'paso';
    if (!o.noHash) {
      try { root.history.replaceState(null, '', '#' + id); } catch (e) { /* p. ej. iframe aislado */ }
    }
    if (changed && !o.keepScroll) { try { root.scrollTo(0, 0); } catch (e) { /* nada */ } }
    if (id === 'entrenamiento') refreshTraining(true);
    if (id === 'generacion' && !S.genVisited) { S.genVisited = true; runGeneration(); }
    if (id === 'datos' && S.datosDirty) renderDatos();
    if (id === 'paso') { updateStale(); measureChrome(); }
    afterPaint(() => fitWideMath($('panel-' + id)));
    return S.tab;
  }

  function initTabs() {
    const list = doc.querySelector('.app-tabs');
    list.addEventListener('click', (e) => {
      const a = e.target.closest('[role="tab"]');
      if (!a) return;
      e.preventDefault();
      setTab(a.id.replace('tab-', ''));
    });
    list.addEventListener('keydown', (e) => {
      const a = e.target.closest('[role="tab"]');
      if (!a) return;
      let i = TABS.indexOf(a.id.replace('tab-', ''));
      if (e.key === 'ArrowRight') i = (i + 1) % TABS.length;
      else if (e.key === 'ArrowLeft') i = (i - 1 + TABS.length) % TABS.length;
      else if (e.key === 'Home') i = 0;
      else if (e.key === 'End') i = TABS.length - 1;
      else return;
      e.preventDefault();
      setTab(TABS[i]);
      $('tab-' + TABS[i]).focus();
    });
    doc.querySelector('.brand').addEventListener('click', (e) => { e.preventDefault(); setTab('paso'); });
    root.addEventListener('hashchange', () => {
      const id = (root.location.hash || '').slice(1);
      if (TABS.indexOf(id) >= 0) setTab(id, { noHash: true });
    });
  }

  // ───────────────────────────────────────────────────────────── configuración y sesión
  function defaultConfig() {
    const d = TL.Model.defaults;
    return {
      corpus: TL.Trainer.DEFAULT_CORPUS,
      tokMode: 'word',
      cfg: { dModel: d.dModel, nHeads: d.nHeads, nLayers: d.nLayers, dFF: d.dFF, maxLen: d.maxLen, activation: d.activation, posEnc: d.posEnc, seed: d.seed },
      hp: { type: 'adam', lr: 0.01, clip: 1.0 },
      batchSize: 4,
    };
  }

  function startSession(config) {
    stopTraining();
    stopPlay();
    const s = TL.Trainer.createSession({ corpus: config.corpus, tokMode: config.tokMode, cfg: config.cfg, optim: config.hp, batchSize: config.batchSize });
    S.s = s;
    S.config = {
      corpus: s.corpus, tokMode: s.tokMode,
      cfg: { dModel: s.cfg.dModel, nHeads: s.cfg.nHeads, nLayers: s.cfg.nLayers, dFF: s.cfg.dFF, maxLen: s.cfg.maxLen, activation: s.cfg.activation, posEnc: s.cfg.posEnc, seed: s.cfg.seed },
      hp: { type: s.hp.type, lr: s.hp.lr, clip: s.hp.clip },
      batchSize: s.batchSize,
    };
    explCache = new Map();
    S.explKey = null;
    liveSig = '';
    S.trace = null;
    S.prevTrace = null;
    S.idx = 0;
    buildDiagram();
    fillSentenceSelects();
    resetTrainingViews();
    resetGeneration();
    fillForm(S.config);
    syncTrainControls();
    $('gen-maxlen').textContent = String(s.cfg.maxLen);
    renderGenVocab();
    S.datosDirty = true;
    traceNew(0, 0);
    if (S.tab === 'datos') renderDatos();
    if (S.tab === 'generacion') { S.genVisited = true; runGeneration(); }
  }

  // ───────────────────────────────────────────────────────────── PASO A PASO
  function traceNew(sentIdx, keepIdx) {
    const s = S.s;
    const n = s.tok.sentences.length;
    sentIdx = ((sentIdx | 0) % n + n) % n;
    const r = TL.Trainer.traceIteration(s, sentIdx);
    const sen = s.tok.sentences[r.sentenceIndex];
    S.prevTrace = S.trace;
    S.trace = { steps: r.steps, loss: r.loss, iter: r.iter, sentenceIndex: r.sentenceIndex, T: sen.T, gradNorm: r.gradNorm, text: sen.text };
    buildTimeline();
    buildLive();
    setDiagramShapes();
    renderSymstrip();
    $('sent-select').value = String(r.sentenceIndex);
    updateHeaderStats();
    updateIterLoss();
    drawSpark();
    S.datosDirty = true;
    const k = keepIdx === undefined || keepIdx === null ? S.idx : keepIdx;
    goTo(clamp(k, 0, r.steps.length - 1), { force: true });
    updateStale();
    if (S.tab === 'entrenamiento') refreshTraining(true);
    return { iter: r.iter, loss: r.loss, sentenceIndex: r.sentenceIndex, steps: r.steps.length };
  }

  function stepSummary(i) {
    const st = S.trace.steps[i];
    return { index: i, total: S.trace.steps.length, id: st.id, tpl: st.tpl, phase: st.phase, kind: st.kind, block: st.block,
      layer: st.layer, head: st.head, title: st.title, dims: st.dims, ms: +S.perf.lastStepMs.toFixed(2) };
  }

  function goTo(i, o) {
    if (!S.trace) return null;
    const steps = S.trace.steps;
    i = clamp(i | 0, 0, steps.length - 1);
    if (i === S.idx && !(o && o.force)) return stepSummary(i);
    const t0 = now();
    const prev = S.idx;
    S.idx = i;
    const st = steps[i];
    renderStepHead(st, i);
    renderStage(st);
    syncDiagram(st);
    syncTimeline(i, o && o.force ? null : prev);
    syncLive(i);
    scheduleExpl(st);
    const ms = now() - t0;
    S.perf.lastStepMs = ms;
    S.perf.maxStepMs = Math.max(S.perf.maxStepMs, ms);
    return stepSummary(i);
  }
  const next = () => goTo(S.idx + 1);
  const prev = () => goTo(S.idx - 1);

  // --- cabecera del paso
  function splitTitle(title) {
    const parts = String(title).split(' · ');
    const loc = [];
    while (parts.length > 1 && /^(Capa|Cabeza) \d+$/.test(parts[0])) loc.push(parts.shift());
    return { loc: loc.join(' · '), main: parts.join(' · ') };
  }
  function renderStepHead(st, i) {
    const n = S.trace.steps.length;
    const head = $('step-head');
    head.setAttribute('data-phase', st.phase);
    const chip = $('step-chip');
    chip.className = 'chip ' + (PHASE_CHIP[st.phase] || 'chip--plain');
    chip.textContent = phaseName(st.phase);
    $('step-count').textContent = 'Paso ' + (i + 1) + ' / ' + n;
    const t = splitTitle(st.title);
    $('step-loc').textContent = [t.loc, KIND_NAME[st.kind] || st.kind].filter(Boolean).join(' · ');
    $('step-title').innerHTML = richTitle(t.main);
    Tex.render(st.formula, $('step-formula'), { display: true });
    Tex.render(st.dimsSym, $('step-dimsym'), { display: false });
    Tex.render(st.dims, $('step-dims'), { display: false });
    const fw = $('step-flops-wrap');
    if (st.flops) {
      let detail = '';
      if (st.kind === 'matmul' && st.aux && st.inputs[st.aux.a] && st.inputs[st.aux.b]) {
        const A = st.inputs[st.aux.a].mat, B = st.inputs[st.aux.b].mat;
        detail = A.r + '·' + A.c + '·' + B.c + ' = ';
      }
      $('step-flops').textContent = detail + fmtInt(st.flops) + ' multiplicaciones y sumas';
      fw.hidden = false;
    } else fw.hidden = true;
  }

  // --- escenario (TL.OpViews)
  let inspPending = null, inspRaf = 0;
  function resetInspector() {
    const b = $('inspector-body');
    b.classList.add('is-empty');
    b.textContent = '';
    $('inspector').classList.add('is-empty');
    $('insp-min').hidden = true;
  }
  function inspect(html) {
    inspPending = html === null || html === undefined ? '' : String(html);
    if (inspRaf) return;
    inspRaf = requestAnimationFrame(() => {
      inspRaf = 0;
      const v = inspPending;
      const b = $('inspector-body');
      if (!v) { resetInspector(); return; }
      b.classList.remove('is-empty');
      $('inspector').classList.remove('is-empty');
      $('insp-min').hidden = false;
      b.innerHTML = v;
      Tex.typeset(b);
    });
  }
  function makeCtx(st) {
    return {
      cfg: S.s.cfg, tok: S.s.tok, model: S.s.model, content: TL.Content,
      showValues: S.showValues, onInspect: inspect,
      animateSpeed: Math.round(160 / S.speed),
      values: placeholderValues(st), stepIndex: S.idx, steps: S.trace.steps,
      targetTokens: S.s.tok.sentences[S.trace.sentenceIndex].targetTokens.map(S.s.tok.display),
    };
  }
  function renderStage(st) {
    const stage = $('stage');
    if (S.view && typeof S.view.destroy === 'function') { try { S.view.destroy(); } catch (e) { /* nada */ } }
    S.view = null;
    S.animToken = (S.animToken || 0) + 1;
    stage.textContent = '';
    resetInspector();
    stage.setAttribute('data-phase', st.phase);
    stage.setAttribute('data-kind', st.kind);
    if (TL.OpViews && typeof TL.OpViews.render === 'function') {
      try { S.view = TL.OpViews.render(st, stage, makeCtx(st)) || null; } catch (e) {
        console.error('TL.OpViews.render falló en el paso ' + st.id + ':', e);
        stage.textContent = '';
        S.view = fallbackView(st, stage);
      }
    } else {
      S.view = fallbackView(st, stage);
    }
    const canAnim = !!(S.view && typeof S.view.animate === 'function');
    $('btn-animate').disabled = !canAnim;
    $('btn-animate').title = canAnim ? 'Reproduce la operación celda a celda' : 'Este paso no tiene animación';
    $('btn-animate-label').textContent = 'Animar';
  }
  function animateStep() {
    if (!S.view || typeof S.view.animate !== 'function') return;
    const tok = ++S.animToken;
    const btn = $('btn-animate');
    btn.disabled = true;
    $('btn-animate-label').textContent = 'Animando…';
    let p;
    try { p = S.view.animate(); } catch (e) { p = null; console.error(e); }
    Promise.resolve(p).catch(() => {}).then(() => {
      if (tok !== S.animToken) return;
      btn.disabled = false;
      $('btn-animate-label').textContent = 'Animar';
    });
  }

  // --- diagrama
  function buildDiagram() {
    if (S.dg) { try { S.dg.destroy(); } catch (e) { /* nada */ } }
    S.dg = null;
    if (!TL.Diagram) return;
    S.dg = TL.Diagram.create($('dg-host'), S.s.cfg, { onSelect: onBlockSelect, optimizer: S.s.opt.type, legend: true });
  }
  function syncDiagram(st) {
    const o = { head: st.head };
    if (st.phase === 'update' && st.aux && st.aux.name && S.s.model.paramMeta[st.aux.name]) o.paramBlock = S.s.model.paramMeta[st.aux.name].block;
    if (S.dg) S.dg.setActive(st.block, st.phase, o);
    $('dg-summary-active').textContent = phaseName(st.phase) + ' · ' + splitTitle(st.title).main;
  }
  function setDiagramShapes() {
    if (!S.dg || !S.trace) return;
    const map = {};
    for (const st of S.trace.steps) {
      if (st.phase === 'backward' || st.phase === 'update' || !st.outputs.length || map[st.block]) continue;
      const o = st.outputs[0];
      let sym = AX_DG[o.rowAxis] + '×' + AX_DG[o.colAxis];
      let num = o.mat.r + '×' + o.mat.c;
      if (/\.qkv$/.test(st.block)) { sym = '3×(' + sym + ')'; num = '3×(' + num + ')'; }
      if (st.block === 'loss') sym = 'escalar';
      map[st.block] = sym + ' · ' + num;
    }
    S.dg.setShapes(map);
  }
  function onBlockSelect(block, info) {
    if (!S.trace) return;
    const steps = S.trace.steps, cur = steps[S.idx];
    const head = info && info.head !== null && info.head !== undefined ? info.head : null;
    const match = (st, phase) => st.block === block && (phase === null || st.phase === phase) && (head === null || st.head === null || st.head === head);
    let i = -1;
    if (cur.phase === 'update' && block !== 'optim') {
      const pm = S.s.model.paramMeta;
      i = steps.findIndex((st) => st.kind === 'update' && pm[st.aux.name] && pm[st.aux.name].block === block);
    }
    if (i < 0) i = steps.findIndex((st) => match(st, cur.phase));
    if (i < 0) i = steps.findIndex((st) => match(st, 'forward'));
    if (i < 0) i = steps.findIndex((st) => match(st, null));
    if (i >= 0) { stopPlay(); goTo(i); }
  }

  // --- línea de tiempo
  function buildTimeline() {
    const steps = S.trace.steps, n = steps.length;
    const ticks = $('tl-ticks'), bands = $('tl-bands'), jumps = $('tl-jumps');
    ticks.textContent = '';
    bands.textContent = '';
    jumps.textContent = '';
    ticks.style.setProperty('--n', n);
    bands.style.setProperty('--n', n);
    const frag = doc.createDocumentFragment();
    tickEls = steps.map((st) => { const t = h('span', { class: 'tl-tick', 'data-phase': st.phase }); frag.appendChild(t); return t; });
    ticks.appendChild(frag);
    runs = [];
    steps.forEach((st, i) => {
      const last = runs[runs.length - 1];
      if (last && last.phase === st.phase) last.end = i;
      else runs.push({ phase: st.phase, start: i, end: i });
    });
    const seen = new Set();
    for (const r of runs) {
      const lbl = phaseName(r.phase) + ': pasos ' + (r.start + 1) + '–' + (r.end + 1);
      r.el = h('button', { type: 'button', class: 'tl-band', 'data-phase': r.phase, tabindex: '-1', title: lbl,
        style: 'grid-column:' + (r.start + 1) + ' / ' + (r.end + 2) }, h('span', { class: 'tl-band__txt' }));
      r.el.addEventListener('click', () => { stopPlay(); goTo(r.start); });
      bands.appendChild(r.el);
      if (!seen.has(r.phase)) {
        seen.add(r.phase);
        const cnt = steps.filter((x) => x.phase === r.phase).length;
        jumps.appendChild(h('button', { type: 'button', class: 'tl-jump', 'data-phase': r.phase, title: 'Ir al primer paso de ' + phaseName(r.phase).toLowerCase() + ' (' + cnt + ' paso' + (cnt > 1 ? 's' : '') + ')',
          onclick: () => { stopPlay(); goTo(r.start); } }, h('span', { class: 'tl-jump__dot', 'aria-hidden': 'true' }),
          h('span', { class: 'tl-jump__full', text: phaseName(r.phase) }),
          h('span', { class: 'tl-jump__short', 'aria-hidden': 'true', text: PHASE_SHORT[r.phase] || phaseName(r.phase) })));
      }
    }
    const track = $('tl-track');
    track.setAttribute('aria-valuemax', String(n));
    layoutBands();
  }
  function layoutBands() {
    if (!S.trace) return;
    const n = S.trace.steps.length;
    const w = $('tl-bands').clientWidth;
    if (!w) return;
    $('tl-ticks').style.columnGap = w / n >= 5 ? '1px' : '0px';
    for (const r of runs) {
      const segW = w * (r.end - r.start + 1) / n;
      const full = phaseName(r.phase), short = PHASE_SHORT[r.phase] || '';
      const txt = segW >= full.length * 7 + 10 ? full : segW >= short.length * 7 + 6 ? short : '';
      r.el.firstChild.textContent = txt;
    }
  }
  function syncTimeline(i, prevIdx) {
    const n = tickEls.length;
    const lo = prevIdx === undefined || prevIdx === null || prevIdx >= n ? 0 : Math.min(i, prevIdx);
    const hi = prevIdx === undefined || prevIdx === null || prevIdx >= n ? n - 1 : Math.max(i, prevIdx);
    for (let k = lo; k <= hi; k++) {
      const t = tickEls[k];
      if (!t) continue;
      t.classList.toggle('is-past', k < i);
      t.classList.toggle('is-cur', k === i);
    }
    $('tl-marker').style.left = ((i + 0.5) / n * 100) + '%';
    const st = S.trace.steps[i];
    const track = $('tl-track');
    track.setAttribute('aria-valuenow', String(i + 1));
    track.setAttribute('aria-valuetext', 'Paso ' + (i + 1) + ' de ' + n + ': ' + st.title);
    $('tl-prev').disabled = i === 0;
    $('tl-next').disabled = i === n - 1;
  }
  function idxFromX(x) {
    const r = $('tl-ticks').getBoundingClientRect();
    const n = S.trace.steps.length;
    return clamp(Math.floor((x - r.left) / r.width * n), 0, n - 1);
  }
  function showTickTip(i, x, y) {
    const st = S.trace.steps[i];
    if (!TL.Charts || !TL.Charts.tip) return;
    TL.Charts.tip.show((t) => {
      t.append(h('div', { class: 'tooltip__title', text: 'Paso ' + (i + 1) + ' / ' + S.trace.steps.length + ' · ' + phaseName(st.phase) }));
      t.append(h('div', { class: 'tl-tip__title', html: richTitle(st.title) }));
    }, x, y);
  }
  const hideTip = () => { if (TL.Charts && TL.Charts.tip) TL.Charts.tip.hide(); };
  function initTimeline() {
    const track = $('tl-track');
    let raf = 0, pendingX = 0;
    const dragTo = (x) => {
      pendingX = x;
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; goTo(idxFromX(pendingX)); });
    };
    track.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !S.trace) return;
      stopPlay();
      S.dragging = true;
      try { track.setPointerCapture(e.pointerId); } catch (err) { /* nada */ }
      goTo(idxFromX(e.clientX));
      track.focus({ preventScroll: true });
      e.preventDefault();
    });
    track.addEventListener('pointermove', (e) => {
      if (!S.trace) return;
      if (e.pointerType === 'mouse' || S.dragging) showTickTip(idxFromX(e.clientX), e.clientX, e.clientY);
      if (S.dragging) dragTo(e.clientX);
    });
    const end = (e) => {
      if (!S.dragging) return;
      S.dragging = false;
      try { track.releasePointerCapture(e.pointerId); } catch (err) { /* nada */ }
      if (e.pointerType !== 'mouse') hideTip();
      scheduleExpl(S.trace.steps[S.idx]);
    };
    track.addEventListener('pointerup', end);
    track.addEventListener('pointercancel', end);
    track.addEventListener('pointerleave', () => { if (!S.dragging) hideTip(); });
    track.addEventListener('keydown', (e) => {
      if (!S.trace) return;
      const n = S.trace.steps.length;
      let i = S.idx;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') i++;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') i--;
      else if (e.key === 'PageUp') i -= 10;
      else if (e.key === 'PageDown') i += 10;
      else if (e.key === 'Home') i = 0;
      else if (e.key === 'End') i = n - 1;
      else return;
      e.preventDefault();
      stopPlay();
      goTo(clamp(i, 0, n - 1));
    });
    $('tl-prev').addEventListener('click', () => { stopPlay(); prev(); });
    $('tl-next').addEventListener('click', () => { stopPlay(); next(); });
    $('tl-play').addEventListener('click', togglePlay);
    $('tl-speed').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-speed]');
      if (!b) return;
      S.speed = +b.dataset.speed;
      for (const x of $('tl-speed').querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
      if (S.playing) schedulePlay();
    });
  }

  // --- reproducción automática
  function togglePlay() { if (S.playing) stopPlay(); else startPlay(); }
  function startPlay() {
    if (!S.trace) return;
    if (S.idx >= S.trace.steps.length - 1) goTo(0);
    S.playing = true;
    const b = $('tl-play');
    b.setAttribute('aria-pressed', 'true');
    b.setAttribute('aria-label', 'Pausa (Espacio)');
    b.classList.add('is-playing');
    schedulePlay();
  }
  function stopPlay() {
    if (!S.playing) return;
    S.playing = false;
    clearTimeout(S.playTimer);
    const b = $('tl-play');
    b.setAttribute('aria-pressed', 'false');
    b.setAttribute('aria-label', 'Reproducir (Espacio)');
    b.classList.remove('is-playing');
  }
  function schedulePlay() {
    clearTimeout(S.playTimer);
    S.playTimer = setTimeout(() => {
      if (!S.playing) return;
      if (S.idx >= S.trace.steps.length - 1) { stopPlay(); return; }
      next();
      schedulePlay();
    }, PLAY_BASE_MS / S.speed);
  }

  // --- teclado global (solo en «Paso a paso»)
  function isEditable(t) {
    if (!t || t === doc.body) return false;
    const tag = t.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') return !/^(button|submit|reset|checkbox|radio)$/i.test(t.type || '');
    if (t.isContentEditable) return true;
    const role = t.getAttribute && t.getAttribute('role');
    return role === 'slider' || role === 'textbox' || role === 'spinbutton';
  }
  function isActivatable(t) {
    if (!t || t === doc.body) return false;
    if (/^(BUTTON|A|SUMMARY|INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return true;
    const role = t.getAttribute && t.getAttribute('role');
    return role === 'button' || role === 'tab' || role === 'link' || role === 'checkbox' || role === 'option';
  }
  function initKeys() {
    doc.addEventListener('keydown', (e) => {
      if (S.modalOpen) return;
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      if (S.tab !== 'paso' || !S.trace) return;
      const t = e.target;
      if (isEditable(t)) return;
      const n = S.trace.steps.length;
      switch (e.key) {
        case 'ArrowLeft': stopPlay(); prev(); break;
        case 'ArrowRight': stopPlay(); next(); break;
        case ' ': case 'Spacebar':
          if (isActivatable(t)) return;
          togglePlay(); break;
        case 'Home': stopPlay(); goTo(0); break;
        case 'End': stopPlay(); goTo(n - 1); break;
        default: return;
      }
      e.preventDefault();
    });
  }

  // --- explicación (panel derecho)
  function placeholderValues(st) {
    const cfg = S.s.cfg;
    return {
      T: S.trace ? S.trace.T : cfg.maxLen, d: cfg.dModel, h: cfg.nHeads, dk: cfg.dModel / cfg.nHeads, dff: cfg.dFF,
      V: S.s.tok.vocab.length, N: cfg.nLayers,
      l: st && st.layer !== null && st.layer !== undefined ? st.layer + 1 : 1,
      hd: st && st.head !== null && st.head !== undefined ? st.head + 1 : 1,
      lr: +S.s.opt.lr.toPrecision(6),
    };
  }
  function explKey(st) {
    const v = placeholderValues(st);
    return st.tpl + '|' + v.T + '|' + v.l + '|' + v.hd + '|' + v.lr;
  }
  let explTimer = 0;
  function scheduleExpl(st) {
    const key = explKey(st);
    if (key === S.explKey) return;
    clearTimeout(explTimer);
    const cached = explCache.get(key);
    if (cached) { mountExpl(cached, key); return; }
    const delay = S.dragging ? 160 : S.playing && S.speed >= 2 ? 90 : 0;
    const run = () => {
      if (!S.trace || S.trace.steps[S.idx] !== st) return;
      const el = buildExpl(st);
      explCache.set(key, el);
      mountExpl(el, key);
    };
    if (delay) explTimer = setTimeout(run, delay);
    else afterPaint(run);
  }
  function mountExpl(el, key) {
    const host = $('expl');
    const changedTpl = !S.explKey || S.explKey.split('|')[0] !== key.split('|')[0];
    S.explKey = key;
    if (host.firstChild !== el) { host.textContent = ''; host.appendChild(el); }
    if (!el._typeset) { el._typeset = true; Tex.typeset(el); }
    if (changedTpl) {
      const col = $('expl-col');
      if (col.scrollHeight > col.clientHeight + 4 && getComputedStyle(col).overflowY !== 'visible') col.scrollTop = 0;
    }
  }
  function expSection(title, body) {
    return h('section', { class: 'expl__sec' }, h('h4', { class: 'expl__h', text: title }), body);
  }
  function buildExpl(st) {
    const C = TL.Content || {};
    const c = C.steps && C.steps[st.tpl];
    const vals = placeholderValues(st);
    const F = (x) => (typeof x === 'string' ? (C.fill ? C.fill(x, vals) : x) : '');
    const art = h('article', { class: 'expl', 'data-phase': st.phase });
    if (!c) {
      art.append(h('p', { class: 'muted', text: 'Este paso no tiene explicación todavía (' + st.tpl + ').' }));
      return art;
    }
    art.append(h('div', { class: 'eyebrow expl__eyebrow' }, 'Explicación · ', phaseName(st.phase)));
    art.append(h('h3', { class: 'expl__title', html: richTitle(F(c.title)) }));
    if (c.summary) art.append(h('p', { class: 'expl__summary', html: richTitle(F(c.summary)) }));
    if (c.intuition) art.append(expSection('Intuición', h('div', { class: 'prose', html: F(c.intuition) })));
    if (c.math && c.math.length) {
      const box = h('div', { class: 'expl__math' });
      for (const m of c.math) { const d = h('div', { class: 'expl__eq' }); Tex.render(F(m), d, { display: true }); box.append(d); }
      art.append(expSection('En fórmulas', box));
    }
    if (c.shapes) art.append(expSection('Cómo cambian las dimensiones', h('div', { class: 'prose expl__shapes', html: F(c.shapes) })));
    if (c.details) {
      art.append(h('details', { class: 'expl__details', open: true },
        h('summary', null, h('span', { class: 'expl__h', text: 'Derivación y detalles' })),
        h('div', { class: 'prose', html: F(c.details) })));
    }
    if (c.code) art.append(expSection('Pseudocódigo (estilo NumPy)', h('pre', { class: 'expl__code', text: F(c.code) })));
    if (c.refs && c.refs.length && C.derivations) {
      const list = h('div', { class: 'expl__refs' });
      for (const id of c.refs) {
        const d = C.derivations[id];
        if (!d) continue;
        list.append(h('button', { type: 'button', class: 'ref-btn', onclick: () => openDerivation(id) },
          h('span', { class: 'ref-btn__k', text: 'Derivación' }), h('span', { class: 'ref-btn__t', text: d.title })));
      }
      art.append(expSection('Para profundizar', list));
    }
    return art;
  }

  // --- tensores vivos
  function buildLive() {
    const items = [];
    const seen = new Set();
    S.trace.steps.forEach((st, k) => {
      for (const o of st.outputs) {
        if (seen.has(o.tex)) continue;
        seen.add(o.tex);
        items.push({ k, tex: o.tex, r: o.mat.r, c: o.mat.c, rowAxis: o.rowAxis, colAxis: o.colAxis, phase: st.phase });
      }
    });
    const sig = items.map((it) => it.k + ':' + it.tex + ':' + it.r + 'x' + it.c).join('|');
    if (sig === liveSig) return;
    liveSig = sig;
    if (cancelLiveTex) cancelLiveTex();
    const list = $('live-list');
    list.textContent = '';
    liveItems = items.map((it) => {
      const name = h('span', { class: 'live__name', html: Tex.lite(it.tex) });
      const li = h('li', { class: 'live__item', 'data-phase': it.phase, hidden: true },
        h('button', { type: 'button', class: 'live__btn', title: 'Ir al paso ' + (it.k + 1), onclick: () => { stopPlay(); goTo(it.k); } },
          name,
          h('span', { class: 'live__shape' }, h('span', { class: 'badge-shape', text: it.r + '×' + it.c }), h('span', { class: 'live__sym', html: axHtml(it.rowAxis, it.colAxis) })),
          h('span', { class: 'live__step', text: 'paso ' + (it.k + 1) })));
      it.li = li;
      it.nameEl = name;
      return it;
    });
    for (let j = liveItems.length - 1; j >= 0; j--) list.appendChild(liveItems[j].li);
    // LaTeX real en segundo plano (primero los ya visibles)
    const order = liveItems.slice().sort((a, b) => (a.k <= S.idx ? 0 : 1) - (b.k <= S.idx ? 0 : 1) || b.k - a.k);
    cancelLiveTex = chunked(order, (it) => Tex.render(it.tex, it.nameEl, { display: false }), 12);
  }
  function syncLive(i) {
    let n = 0;
    for (const it of liveItems) {
      const vis = it.k <= i;
      if (it.li.hidden === vis) it.li.hidden = !vis;
      it.li.classList.toggle('is-current', it.k === i);
      if (vis) n++;
    }
    $('live-count').textContent = String(n);
  }
  function initSideTabs() {
    const tabs = [$('side-tab-expl'), $('side-tab-live')];
    const panes = [$('side-expl'), $('side-live')];
    const sel = (k) => {
      tabs.forEach((t, j) => { t.setAttribute('aria-selected', String(j === k)); t.tabIndex = j === k ? 0 : -1; });
      panes.forEach((p, j) => { p.hidden = j !== k; });
      store.set('sideTab', k);
    };
    tabs.forEach((t, k) => t.addEventListener('click', () => sel(k)));
    $('side-tabs').addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const k = tabs.indexOf(doc.activeElement) === 0 ? 1 : 0;
      sel(k);
      tabs[k].focus();
    });
    sel(store.get('sideTab', 0) === 1 ? 1 : 0);
  }

  // --- símbolos con sus valores
  function renderSymstrip() {
    const strip = $('symstrip');
    const vals = placeholderValues(null);
    const syms = (TL.Content && TL.Content.symbols) || [];
    strip.textContent = '';
    for (const sy of syms) {
      const key = sy.key || sy.sym;
      const v = vals[key];
      const item = h('span', { class: 'sym', tabindex: '0', role: 'note', 'aria-label': sy.sym + ' = ' + v + ': ' + sy.name },
        h('span', { class: 'sym__k', html: SYM_HTML[key] || esc(sy.sym) }),
        h('span', { class: 'sym__eq', text: '=' }),
        h('span', { class: 'sym__v', text: String(v) }));
      const show = (ev) => {
        if (!TL.Charts || !TL.Charts.tip) return;
        const r = item.getBoundingClientRect();
        TL.Charts.tip.show((t) => {
          t.append(h('div', { class: 'tooltip__title', text: sy.name }));
          if (sy.desc) t.append(h('div', { class: 'sym-tip', text: sy.desc }));
        }, ev && ev.clientX ? ev.clientX : r.left + r.width / 2, ev && ev.clientY ? ev.clientY : r.top);
      };
      item.addEventListener('mouseenter', show);
      item.addEventListener('focus', () => show(null));
      item.addEventListener('mouseleave', hideTip);
      item.addEventListener('blur', hideTip);
      strip.append(item);
    }
  }

  // --- barra de iteración (frase, nueva iteración, minigráfico)
  function fillSentenceSelects() {
    const sents = S.s.tok.sentences;
    for (const id of ['sent-select', 'tr-attn-sent']) {
      const sel = $(id);
      sel.textContent = '';
      sents.forEach((sen, i) => {
        const txt = sen.text.length > 42 ? sen.text.slice(0, 40) + '…' : sen.text;
        sel.append(h('option', { value: String(i), text: (i + 1) + '. ' + txt }));
      });
    }
    S.attnSent = 0;
    $('tr-attn-sent').value = '0';
  }
  function updateIterLoss() {
    const el = $('iter-loss');
    const t = S.trace;
    if (!t) { el.textContent = ''; return; }
    let delta = '';
    let cls = '';
    const p = S.prevTrace;
    if (p && p.sentenceIndex === t.sentenceIndex && p.steps.length === t.steps.length) {
      const d = t.loss - p.loss;
      delta = ' (' + (d <= 0 ? MINUS : '+') + fmt(Math.abs(d), 3) + ')';
      cls = d <= 0 ? 'is-down' : 'is-up';
    }
    el.innerHTML = '';
    el.append(h('span', { class: 'iterbar__lk', text: 'ℒ it. ' + t.iter + ' = ' }), h('b', { text: fmt(t.loss, 3) }), h('span', { class: 'iterbar__delta ' + cls, text: delta }));
    el.title = 'Pérdida de la frase trazada en la iteración ' + t.iter + (delta ? '; entre paréntesis, el cambio respecto a la iteración anterior con la misma frase' : '');
  }
  function cssVar(name) {
    return getComputedStyle(doc.documentElement).getPropertyValue(name).trim() || '#888';
  }
  function drawSpark() {
    const cv = $('spark');
    if (!cv || !S.s) return;
    const dpr = root.devicePixelRatio || 1;
    const W = 112, H = 26;
    if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
    const g = cv.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const hist = S.s.history;
    if (!hist.length) return;
    const n = hist.length, stride = Math.max(1, Math.ceil(n / 120));
    const pts = [];
    for (let i = 0; i < n; i += stride) pts.push(hist[i].loss);
    if ((n - 1) % stride) pts.push(hist[n - 1].loss);
    let lo = Infinity, hi = -Infinity;
    for (const v of pts) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (!(hi > lo)) { hi = lo + 1; }
    const X = (i) => 2 + (pts.length === 1 ? W - 4 : i / (pts.length - 1) * (W - 6));
    const Y = (v) => 3 + (1 - (v - lo) / (hi - lo)) * (H - 6);
    g.strokeStyle = cssVar('--rule');
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, H - 0.5); g.lineTo(W, H - 0.5); g.stroke();
    g.strokeStyle = cssVar('--fwd');
    g.lineWidth = 1.5;
    g.lineJoin = 'round';
    g.beginPath();
    pts.forEach((v, i) => { if (i) g.lineTo(X(i), Y(v)); else g.moveTo(X(i), Y(v)); });
    g.stroke();
    g.fillStyle = cssVar('--fwd');
    g.beginPath(); g.arc(X(pts.length - 1), Y(pts[pts.length - 1]), 2.4, 0, Math.PI * 2); g.fill();
  }
  function updateHeaderStats() {
    const s = S.s;
    $('hd-iter').textContent = fmtInt(s.iter);
    const last = s.history[s.history.length - 1];
    $('hd-loss').textContent = last ? fmt(last.loss, 3) : '—';
  }
  function updateStale() {
    const note = $('stale-note');
    if (!S.trace || !S.s) { note.hidden = true; return; }
    const diff = S.s.iter - S.trace.iter;
    if (diff <= 0) { note.hidden = true; return; }
    $('stale-text').textContent = 'Esta traza es de la iteración ' + S.trace.iter + '; desde entonces el modelo ha entrenado ' +
      fmtInt(diff) + (diff > 1 ? ' iteraciones' : ' iteración') + ' más (va por la ' + fmtInt(S.s.iter) + ').';
    note.hidden = false;
  }
  function initIterbar() {
    $('sent-select').addEventListener('change', (e) => { stopPlay(); traceNew(+e.target.value, S.idx); });
    $('btn-newiter').addEventListener('click', () => { stopPlay(); traceNew(S.trace.sentenceIndex, S.idx); });
    $('stale-retrace').addEventListener('click', () => { stopPlay(); traceNew(S.trace.sentenceIndex, S.idx); });
    $('btn-values').setAttribute('aria-pressed', String(S.showValues));
    $('btn-values').addEventListener('click', () => {
      S.showValues = !S.showValues;
      store.set('showValues', S.showValues);
      $('btn-values').setAttribute('aria-pressed', String(S.showValues));
      renderStage(S.trace.steps[S.idx]);
    });
    $('btn-animate').addEventListener('click', animateStep);
    $('insp-min').addEventListener('click', () => {
      const ins = $('inspector');
      const on = !ins.classList.contains('is-collapsed');
      ins.classList.toggle('is-collapsed', on);
      $('insp-min').setAttribute('aria-pressed', String(on));
      $('insp-min').textContent = on ? 'Mostrar' : 'Minimizar';
    });
  }

  // --- bienvenida
  function initWelcome() {
    const w = $('welcome');
    if (!store.get('welcomeDismissed', false)) w.hidden = false;
    $('welcome-close').addEventListener('click', () => { w.hidden = true; store.set('welcomeDismissed', true); measureChrome(); });
    $('welcome-guide').addEventListener('click', () => openGuide('tour', 0));
  }

  // ───────────────────────────────────────────────────────────── diálogo (guía, derivaciones)
  let modalReturn = null;
  function openModal(o) {
    const m = $('modal');
    modalReturn = doc.activeElement;
    $('modal-eyebrow').textContent = o.eyebrow || '';
    $('modal-title').textContent = o.title || '';
    const tabs = $('modal-tabs');
    tabs.textContent = '';
    tabs.hidden = !o.tabs;
    if (o.tabs) tabs.append(o.tabs);
    fillModal(o.body, o.foot);
    m.hidden = false;
    S.modalOpen = true;
    doc.documentElement.classList.add('has-modal');
    stopPlay();
    const box = m.querySelector('.modal__box');
    setTimeout(() => box.focus(), 0);
  }
  function fillModal(body, foot) {
    const b = $('modal-body'), f = $('modal-foot');
    b.textContent = '';
    f.textContent = '';
    if (body) b.append(body);
    if (foot) f.append(foot);
    f.hidden = !foot;
    b.scrollTop = 0;
    Tex.typeset(b);
  }
  function closeModal() {
    if (!S.modalOpen) return;
    $('modal').hidden = true;
    S.modalOpen = false;
    doc.documentElement.classList.remove('has-modal');
    if (modalReturn && modalReturn.focus && doc.contains(modalReturn)) modalReturn.focus();
    modalReturn = null;
  }
  function initModal() {
    const m = $('modal');
    m.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); });
    m.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeModal(); return; }
      if (e.key !== 'Tab') return;
      const f = Array.from(m.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
        .filter((x) => !x.disabled && x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (doc.activeElement === first || doc.activeElement === m.querySelector('.modal__box'))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }
  function openDerivation(id) {
    const d = TL.Content && TL.Content.derivations && TL.Content.derivations[id];
    if (!d) return;
    openModal({
      eyebrow: 'Derivación', title: d.title,
      body: h('div', { class: 'prose prose--long', html: d.html }),
      foot: h('button', { type: 'button', class: 'btn', 'data-close': '' }, 'Cerrar'),
    });
  }
  function openGuide(section, card) {
    const C = TL.Content || {};
    const tour = C.tour || [];
    let sec = section || 'tour', k = card || 0;
    const seg = h('div', { class: 'seg seg--sm', role: 'tablist', 'aria-label': 'Secciones de la guía' });
    const secs = [['tour', 'Recorrido'], ['notation', 'Notación'], ['glossary', 'Glosario'], ['keys', 'Teclado']];
    const btns = secs.map(([id, name]) => {
      const b = h('button', { type: 'button', role: 'tab', 'aria-selected': 'false' }, name);
      b.addEventListener('click', () => { sec = id; k = 0; draw(); });
      seg.append(b);
      return b;
    });
    function draw() {
      btns.forEach((b, j) => b.setAttribute('aria-selected', String(secs[j][0] === sec)));
      let body, foot = null;
      if (sec === 'tour') {
        const c = tour[k] || { title: '', html: '' };
        body = h('div', { class: 'tour' }, h('div', { class: 'tour__num', text: 'Tarjeta ' + (k + 1) + ' de ' + tour.length }),
          h('h3', { class: 'tour__title', text: c.title }), h('div', { class: 'prose', html: c.html }));
        const dots = h('div', { class: 'tour__dots', 'aria-hidden': 'true' });
        tour.forEach((_, j) => dots.append(h('span', { class: 'tour__dot' + (j === k ? ' is-on' : '') })));
        const prevB = h('button', { type: 'button', class: 'btn', disabled: k === 0 }, 'Anterior');
        const nextB = h('button', { type: 'button', class: 'btn btn--primary' }, k === tour.length - 1 ? 'Empezar' : 'Siguiente');
        prevB.addEventListener('click', () => { k = Math.max(0, k - 1); draw(); });
        nextB.addEventListener('click', () => { if (k >= tour.length - 1) { closeModal(); setTab('paso'); } else { k++; draw(); } });
        foot = h('div', { class: 'tour__foot' }, prevB, dots, nextB);
      } else if (sec === 'notation') {
        body = h('dl', { class: 'notation' });
        for (const n of C.notation || []) {
          const dt = h('dt');
          Tex.render(n.tex, dt, { display: false });
          body.append(dt, h('dd', { text: n.desc }));
        }
      } else if (sec === 'glossary') {
        body = h('dl', { class: 'glossary' });
        for (const g of C.glossary || []) body.append(h('dt', { text: g.term }), h('dd', { text: g.def }));
      } else {
        body = h('div', { class: 'keys' },
          keyRow(['←', '→'], 'Paso anterior / siguiente'),
          keyRow(['Espacio'], 'Reproducir o pausar el recorrido automático'),
          keyRow(['Inicio', 'Fin'], 'Primer / último paso de la iteración'),
          keyRow(['Tab'], 'Recorrer los controles; en el esquema, ↑ ↓ siguen el flujo y ← → cambian de cabeza'),
          keyRow(['Esc'], 'Cerrar este diálogo'),
          h('p', { class: 'small muted', text: 'Los atajos solo actúan en «Paso a paso» y nunca mientras escribes en un campo de texto.' }));
      }
      fillModal(body, foot);
    }
    openModal({ eyebrow: 'Laboratorio Transformer', title: 'Guía', tabs: seg, body: null, foot: null });
    draw();
  }
  function keyRow(keys, desc) {
    return h('div', { class: 'keys__row' }, h('span', { class: 'keys__k' }, keys.map((k) => h('span', { class: 'kbd', text: k }))), h('span', { text: desc }));
  }

  // ───────────────────────────────────────────────────────────── ENTRENAMIENTO
  let trainHms = [];     // [{hm, mat, l, h, el}]
  let trainRaf = 0, trainFrame = 0, lastHeavy = 0, itsWindow = [];
  let adaptive = 20;

  function resetTrainingViews() {
    for (const x of trainHms) destroyHeatmap(x.hm);
    trainHms = [];
    $('tr-attn').textContent = '';
    S.trainAttnSig = '';
    S.pca = null;
    itsWindow = [];
    $('st-speed').textContent = '—';
  }
  function syncTrainControls() {
    const s = S.s;
    $('tr-lr').value = String(+s.opt.lr.toPrecision(6));
    $('tr-batch').value = String(s.batchSize);
    $('tr-b-inline').textContent = String(s.batchSize);
    for (const b of $('tr-opt').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.opt === s.opt.type));
    $('tr-hp-err').textContent = '';
  }
  function setHyper(patch) {
    const s = S.s;
    const typeBefore = s.opt.type;
    try { TL.Trainer.setHyper(s, patch); } catch (e) { $('tr-hp-err').textContent = e.message; return false; }
    S.config.hp = { type: s.hp.type, lr: s.hp.lr, clip: s.hp.clip };
    S.config.batchSize = s.batchSize;
    if (s.opt.type !== typeBefore) buildDiagramKeep();
    syncTrainControls();
    // solo los campos de optimización del formulario (sin tocar el corpus que se esté editando)
    $('cfg-type').value = s.hp.type;
    $('cfg-lr').value = String(+s.hp.lr.toPrecision(6));
    $('cfg-batchSize').value = String(s.batchSize);
    S.datosDirty = true;
    explCache = new Map();
    S.explKey = null;
    return true;
  }
  function buildDiagramKeep() {
    buildDiagram();
    setDiagramShapes();
    if (S.trace) syncDiagram(S.trace.steps[S.idx]);
  }
  function initTraining() {
    $('tr-run').addEventListener('click', () => (S.training ? stopTraining() : startTraining()));
    for (const b of doc.querySelectorAll('[data-train]')) b.addEventListener('click', () => { stopTraining(); trainN(+b.dataset.train); });
    $('tr-speed').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-speed]');
      if (!b) return;
      S.trainSpeed = b.dataset.speed;
      for (const x of $('tr-speed').querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
    });
    $('tr-inspect').addEventListener('click', () => { stopTraining(); setTab('paso'); traceNew(S.attnSent || 0, S.idx); });
    $('tr-reset').addEventListener('click', () => { $('tr-reset-confirm').hidden = false; $('tr-reset').hidden = true; $('tr-reset-no').focus(); });
    $('tr-reset-no').addEventListener('click', () => { $('tr-reset-confirm').hidden = true; $('tr-reset').hidden = false; $('tr-reset').focus(); });
    $('tr-reset-yes').addEventListener('click', () => {
      $('tr-reset-confirm').hidden = true; $('tr-reset').hidden = false;
      startSession(S.config);
      refreshTraining(true);
      $('tr-reset').focus();
    });
    $('tr-lr').addEventListener('change', (e) => {
      const v = Number(e.target.value);
      if (!(v > 0) || v > 5) { $('tr-hp-err').textContent = 'η debe ser un número positivo (≤ 5): p. ej. 0.01 con Adam o 0.1 con SGD.'; return; }
      setHyper({ lr: v });
    });
    $('tr-batch').addEventListener('change', (e) => {
      const v = Number(e.target.value);
      if (!Number.isInteger(v) || v < 1 || v > 64) { $('tr-hp-err').textContent = 'El minilote B debe ser un entero entre 1 y 64.'; return; }
      setHyper({ batchSize: v });
    });
    $('tr-opt').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-opt]');
      if (!b || b.dataset.opt === S.s.opt.type) return;
      const lr = b.dataset.opt === 'sgd' ? 0.1 : 0.01;
      if (setHyper({ type: b.dataset.opt, lr })) {
        $('tr-hp-err').textContent = 'Optimizador cambiado a ' + (b.dataset.opt === 'sgd' ? 'SGD' : 'Adam') + ' (estado reiniciado); η = ' + lr + ', su valor típico.';
      }
    });
    $('tr-logy').addEventListener('change', () => drawLossChart());
    $('tr-attn-sent').addEventListener('change', (e) => { S.attnSent = +e.target.value; refreshTraining(true); });
  }
  function startTraining() {
    if (S.training) return;
    S.training = true;
    $('tr-run').setAttribute('aria-pressed', 'true');
    $('tr-run-label').textContent = 'Pausa';
    $('tr-run').classList.add('is-running');
    trainFrame = 0;
    itsWindow = [];
    trainRaf = requestAnimationFrame(trainLoop);
  }
  function stopTraining() {
    if (!S.training) return;
    S.training = false;
    cancelAnimationFrame(trainRaf);
    $('tr-run').setAttribute('aria-pressed', 'false');
    $('tr-run-label').textContent = 'Entrenar';
    $('tr-run').classList.remove('is-running');
    if (S.tab === 'entrenamiento') refreshTraining(true);
    updateStale();
  }
  function trainLoop(ts) {
    if (!S.training) return;
    trainFrame++;
    let n = 0;
    if (S.trainSpeed === 'lenta') n = trainFrame % 4 === 0 ? 1 : 0;
    else if (S.trainSpeed === 'media') n = 1;
    else n = adaptive;
    if (n > 0) {
      const t0 = now();
      TL.Trainer.trainSteps(S.s, n);
      const dt = now() - t0;
      if (S.trainSpeed === 'maxima') adaptive = clamp(Math.floor(n * 9 / Math.max(dt, 0.05)), 1, 2000);
      itsWindow.push([ts, n]);
      while (itsWindow.length > 1 && ts - itsWindow[0][0] > 1000) itsWindow.shift();
      refreshTraining(false, ts);
    }
    trainRaf = requestAnimationFrame(trainLoop);
  }
  function trainN(n) {
    TL.Trainer.trainSteps(S.s, n);
    refreshTraining(true);
    updateStale();
    return { iter: S.s.iter, loss: S.s.history[S.s.history.length - 1].loss };
  }

  function drawLossChart() {
    if (!TL.Charts) return;
    const s = S.s, hist = s.history, n = hist.length;
    const stride = Math.max(1, Math.ceil(n / 1500));
    const raw = [], ema = [];
    let m = null;
    for (let i = 0; i < n; i++) {
      const L = hist[i].loss;
      m = m === null ? L : 0.9 * m + 0.1 * L;
      if (i % stride === 0 || i === n - 1) { raw.push([hist[i].iter, L]); ema.push([hist[i].iter, m]); }
    }
    const lnV = Math.log(s.tok.vocab.length);
    const x0 = n ? hist[0].iter : 0, x1 = n ? Math.max(hist[n - 1].iter, x0 + 1) : 1;
    TL.Charts.line($('tr-loss'), [
      { name: 'media móvil', points: ema, colorVar: '--fwd', width: 2 },
      { name: 'pérdida por iteración', points: raw, colorVar: '--fwd', faint: true },
      { name: 'ln V (azar)', points: [[x0, lnV], [x1, lnV]], colorVar: '--muted', dashed: true, width: 1 },
    ], { xLabel: 'iteración', yLabel: 'pérdida ℒ', xName: 'iteración', logY: $('tr-logy').checked, areaIndex: 0, legend: true,
      includeZero: !$('tr-logy').checked, emptyText: 'Pulsa «Entrenar» para empezar', ariaLabel: 'Curva de pérdida por iteración' });
  }
  function refreshTraining(full, ts) {
    if (!S.s) return;
    const s = S.s;
    updateHeaderStats();
    const last = s.history[s.history.length - 1];
    $('st-iter').textContent = fmtInt(s.iter);
    $('st-loss').textContent = last ? fmt(last.loss, 4) : '—';
    $('st-gn').textContent = s.lastGradNorm === null || s.lastGradNorm === undefined ? '—' :
      fmt(s.lastGradNorm, 3) + (s.lastClipFactor < 1 ? ' → recortada ×' + fmt(s.lastClipFactor, 3) : '');
    if (itsWindow.length > 1) {
      const span = (itsWindow[itsWindow.length - 1][0] - itsWindow[0][0]) / 1000;
      let cnt = 0;
      for (let k = 1; k < itsWindow.length; k++) cnt += itsWindow[k][1];
      if (span > 0.2) $('st-speed').textContent = fmtInt(cnt / span) + ' it/s';
    }
    if (S.tab !== 'entrenamiento') return;
    drawLossChart();
    const t = ts || now();
    if (full || t - lastHeavy > 250) { lastHeavy = t; heavyTraining(); }
  }
  function heavyTraining() {
    const s = S.s;
    const ev = TL.Trainer.evaluate(s);
    $('st-mean').textContent = fmt(ev.loss, 4);
    $('st-ppl').textContent = fmt(Math.exp(ev.loss), 2);
    if (TL.Charts) {
      TL.Charts.bars($('tr-sent-bars'), ev.perSentence.map((p, i) => ({ key: 's' + i, label: (i + 1) + '. ' + p.text, value: p.loss, colorVar: '--fwd', highlight: i === S.attnSent })),
        { format: (v) => fmt(v, 3), onSelect: (it) => { S.attnSent = +it.key.slice(1); $('tr-attn-sent').value = String(S.attnSent); refreshTraining(true); }, ariaLabel: 'Pérdida por frase' });
      const pm = s.model.paramMeta;
      const hasG = s.lastGradNorms && Object.keys(s.lastGradNorms).length;
      TL.Charts.bars($('tr-grad-bars'), hasG ? s.model.order.map((name) => ({ key: name, label: name, tex: '\\mathrm{d}' + pm[name].tex, value: s.lastGradNorms[name], colorVar: '--bwd' })) : [],
        { format: (v) => fmt(v, 3), compact: s.model.order.length > 14, emptyText: 'Aún no hay gradientes: entrena una iteración.', ariaLabel: 'Norma del gradiente por parámetro' });
    }
    const pr = TL.Trainer.predict(s, S.attnSent || 0);
    renderTrainAttn(pr);
    renderPredTable(pr);
    renderPCA(pr);
  }
  function attnRef(mat, l, hh, tokens) {
    const N = S.s.cfg.nLayers;
    const sup = N > 1 ? '^{[' + (l + 1) + ']}' : '';
    return { key: 'A_' + (hh + 1) + (N > 1 ? '_L' + l : ''), tex: 'A_' + (hh + 1) + sup, label: 'A' + '₁₂₃₄₅₆₇₈₉'.charAt(hh) + (N > 1 ? ' capa ' + (l + 1) : ''),
      mat, role: 'prob', rowAxis: 'T', colAxis: 'T', rowLabels: tokens, colLabels: tokens, colOffset: 0 };
  }
  function renderTrainAttn(pr) {
    const s = S.s, tok = s.tok;
    const tokens = pr.inputTokens.map(tok.display);
    const sig = S.attnSent + '|' + tokens.join(' ') + '|' + s.cfg.nLayers + 'x' + s.cfg.nHeads;
    const grid = $('tr-attn');
    if (sig !== S.trainAttnSig) {
      for (const x of trainHms) destroyHeatmap(x.hm);
      trainHms = [];
      grid.textContent = '';
      grid.style.setProperty('--cols', String(Math.min(s.cfg.nHeads, 4)));
      for (let l = 0; l < s.cfg.nLayers; l++) {
        for (let hh = 0; hh < s.cfg.nHeads; hh++) {
          const mat = pr.attn[l][hh];
          const hm = makeHeatmap(attnRef(mat, l, hh, tokens), { showValues: 'auto', scale: 'sequential', caption: true });
          const cell = h('div', { class: 'attn-cell' }, h('div', { class: 'attn-cell__lbl', text: (s.cfg.nLayers > 1 ? 'Capa ' + (l + 1) + ' · ' : '') + 'Cabeza ' + (hh + 1) }), hm.el);
          grid.append(cell);
          trainHms.push({ hm, mat, l, h: hh });
        }
      }
      S.trainAttnSig = sig;
    } else {
      for (const x of trainHms) { x.mat = pr.attn[x.l][x.h]; if (x.hm.update) x.hm.update(x.mat); }
    }
  }
  function renderPredTable(pr) {
    const s = S.s, tok = s.tok, V = tok.vocab.length;
    const tbl = $('tr-pred');
    tbl.textContent = '';
    tbl.append(h('thead', null, h('tr', null, h('th', { class: 'num', text: 't' }), h('th', { text: 'entrada' }), h('th', { text: 'objetivo' }),
      h('th', { text: 'P(objetivo)' }), h('th', { text: 'las 3 más probables' }))));
    const body = h('tbody');
    for (let t = 0; t < pr.inputTokens.length; t++) {
      const row = pr.probs.d.subarray(t * V, (t + 1) * V);
      const order = Array.from({ length: V }, (_, j) => j).sort((a, b) => row[b] - row[a]).slice(0, 3);
      const tgt = pr.targetIds[t];
      const pT = row[tgt];
      const top = h('div', { class: 'top3' });
      for (const j of order) {
        top.append(h('span', { class: 'top3__it' + (j === tgt ? ' is-ok' : '') },
          h('span', { class: 'top3__tok', text: tok.display(tok.vocab[j]) }),
          h('span', { class: 'pbar', style: '--p:' + row[j].toFixed(4) }),
          h('span', { class: 'top3__p', text: fmt(row[j], 2) })));
      }
      body.append(h('tr', { class: order[0] === tgt ? 'is-hit' : '' },
        h('td', { class: 'num', text: String(t + 1) }),
        h('td', null, h('span', { class: 'tokchip', text: tok.display(pr.inputTokens[t]) })),
        h('td', null, h('span', { class: 'tokchip tokchip--tgt', text: tok.display(pr.targetTokens[t]) })),
        h('td', null, h('span', { class: 'pcell' }, h('span', { class: 'pbar pbar--wide' + (order[0] === tgt ? ' is-ok' : ''), style: '--p:' + pT.toFixed(4) }), h('span', { class: 'mono', text: fmt(pT, 3) }))),
        h('td', null, top)));
    }
    tbl.append(body);
  }
  // PCA de las filas de E: covarianza d×d + iteración de potencias con deflación
  function powerIter(C, d, init) {
    let v = init ? Float64Array.from(init) : Float64Array.from({ length: d }, (_, i) => 1 + 0.37 * Math.sin(i * 1.7 + 0.3));
    let lam = 0;
    for (let it = 0; it < 300; it++) {
      const w = new Float64Array(d);
      for (let i = 0; i < d; i++) { let a = 0; for (let j = 0; j < d; j++) a += C[i * d + j] * v[j]; w[i] = a; }
      let nrm = 0;
      for (let i = 0; i < d; i++) nrm += w[i] * w[i];
      nrm = Math.sqrt(nrm);
      if (nrm < 1e-14) break;
      let diff = 0;
      for (let i = 0; i < d; i++) { const x = w[i] / nrm; diff += Math.abs(x - v[i]); v[i] = x; }
      lam = nrm;
      if (diff < 1e-10) break;
    }
    return { v, lam };
  }
  function pca2(M, prev) {
    const n = M.r, d = M.c;
    const mean = new Float64Array(d);
    for (let i = 0; i < n; i++) for (let j = 0; j < d; j++) mean[j] += M.d[i * d + j] / n;
    const X = new Float64Array(n * d);
    for (let i = 0; i < n; i++) for (let j = 0; j < d; j++) X[i * d + j] = M.d[i * d + j] - mean[j];
    const C = new Float64Array(d * d);
    for (let a = 0; a < d; a++) for (let b = a; b < d; b++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += X[i * d + a] * X[i * d + b];
      s /= Math.max(1, n - 1);
      C[a * d + b] = s; C[b * d + a] = s;
    }
    let tr = 0;
    for (let a = 0; a < d; a++) tr += C[a * d + a];
    const p1 = powerIter(C, d, prev && prev.v1);
    const C2 = C.slice();
    for (let a = 0; a < d; a++) for (let b = 0; b < d; b++) C2[a * d + b] -= p1.lam * p1.v[a] * p1.v[b];
    let init2 = prev && prev.v2;
    if (!init2) { init2 = Float64Array.from({ length: d }, (_, i) => Math.cos(i * 2.3 + 1)); }
    const p2 = powerIter(C2, d, init2);
    // signo estable entre actualizaciones (sin saltos en el gráfico)
    const align = (v, pv) => {
      let dot = 0, big = 0;
      for (let i = 0; i < d; i++) { if (pv) dot += v[i] * pv[i]; if (Math.abs(v[i]) > Math.abs(big)) big = v[i]; }
      const flip = pv ? dot < 0 : big < 0;
      if (flip) for (let i = 0; i < d; i++) v[i] = -v[i];
    };
    align(p1.v, prev && prev.v1);
    align(p2.v, prev && prev.v2);
    const pts = [];
    for (let i = 0; i < n; i++) {
      let x = 0, y = 0;
      for (let j = 0; j < d; j++) { x += X[i * d + j] * p1.v[j]; y += X[i * d + j] * p2.v[j]; }
      pts.push([x, y]);
    }
    return { pts, v1: p1.v, v2: p2.v, var1: tr > 0 ? p1.lam / tr : 0, var2: tr > 0 ? p2.lam / tr : 0 };
  }
  function renderPCA(pr) {
    if (!TL.Charts) return;
    const s = S.s, tok = s.tok;
    const p = pca2(s.model.params.E, S.pca);
    S.pca = p;
    const inSent = new Set(pr.inputIds.concat(pr.targetIds));
    const punct = /^[.,;:!?¡¿]$|^<s>$/;
    const pts = p.pts.map(([x, y], i) => ({ x, y, label: tok.display(tok.vocab[i]), colorVar: punct.test(tok.vocab[i]) ? '--data' : '--fwd', highlight: inSent.has(i) }));
    TL.Charts.scatter($('tr-pca'), pts, { xLabel: 'CP 1 (' + fmt(p.var1 * 100, 0) + ' % de la varianza)', yLabel: 'CP 2 (' + fmt(p.var2 * 100, 0) + ' %)', equal: true, format: (v) => fmt(v, 2) });
    $('tr-pca-note').textContent = 'Cada punto es un token (fila de E, d = ' + s.cfg.dModel + ' dimensiones) proyectado sobre las 2 direcciones de mayor varianza, que explican el ' +
      fmt((p.var1 + p.var2) * 100, 0) + ' % del total. Resaltados: los tokens de la frase elegida. Con el entrenamiento, los tokens que se usan de forma parecida tienden a acercarse.';
  }

  // ───────────────────────────────────────────────────────────── GENERACIÓN
  let genHms = [];
  function resetGeneration() {
    for (const x of genHms) destroyHeatmap(x.hm);
    genHms = [];
    S.gen = null;
    S.genVisited = S.tab === 'generacion' ? S.genVisited : false;
    if ($('gen-result')) $('gen-result').textContent = '';
    if ($('gen-error')) $('gen-error').hidden = true;
  }
  function renderGenVocab() {
    const tok = S.s.tok;
    const words = tok.vocab.filter((t) => t !== tok.bos).map(tok.display);
    $('gen-vocab').textContent = 'El modelo solo conoce estos ' + words.length + ' tokens: ' + words.join(' · ');
  }
  function initGeneration() {
    const temp = $('gen-temp');
    const syncTemp = () => {
      const p = (temp.value - temp.min) / (temp.max - temp.min) * 100;
      temp.style.setProperty('--pct', p + '%');
      $('gen-temp-out').textContent = (+temp.value).toFixed(2);
    };
    temp.addEventListener('input', syncTemp);
    syncTemp();
    $('gen-mode').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-mode]');
      if (!b) return;
      for (const x of $('gen-mode').querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
      $('gen-seed-field').hidden = b.dataset.mode !== 'sample';
    });
    $('gen-run').addEventListener('click', () => runGeneration());
    $('gen-prompt').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runGeneration(); } });
  }
  function genOpts() {
    const greedy = $('gen-mode').querySelector('[aria-pressed="true"]').dataset.mode !== 'sample';
    const maxNew = clamp(parseInt($('gen-max').value, 10) || 10, 1, 30);
    $('gen-max').value = String(maxNew);
    return { maxNew, temperature: +$('gen-temp').value, greedy, seed: parseInt($('gen-seed').value, 10) || 0, topK: 10 };
  }
  function runGeneration(promptArg, optsArg) {
    const s = S.s, tok = s.tok;
    if (promptArg !== undefined) $('gen-prompt').value = String(promptArg);
    if (optsArg) {
      if (optsArg.temperature !== undefined) { $('gen-temp').value = String(optsArg.temperature); $('gen-temp').dispatchEvent(new Event('input')); }
      if (optsArg.maxNew !== undefined) $('gen-max').value = String(optsArg.maxNew);
      if (optsArg.seed !== undefined) $('gen-seed').value = String(optsArg.seed);
      if (optsArg.greedy !== undefined) {
        const mode = optsArg.greedy ? 'greedy' : 'sample';
        for (const x of $('gen-mode').querySelectorAll('button')) x.setAttribute('aria-pressed', String(x.dataset.mode === mode));
        $('gen-seed-field').hidden = mode !== 'sample';
      }
    }
    const prompt = $('gen-prompt').value;
    const o = genOpts();
    const res = TL.Trainer.generate(s, prompt, o);
    for (const x of genHms) destroyHeatmap(x.hm);
    genHms = [];
    const out = $('gen-result');
    out.textContent = '';
    const err = $('gen-error');
    S.gen = res;
    if (!res.ok) {
      err.textContent = res.error || 'No se pudo generar.';
      err.hidden = false;
      return { ok: false, error: res.error, text: '', steps: 0 };
    }
    err.hidden = true;
    const nPrompt = res.tokens.length - res.generated.length;
    const line = h('div', { class: 'gen-line' });
    res.tokens.forEach((t, i) => {
      if (i === 0) return; // <s>
      line.append(h('span', { class: 'tokchip ' + (i < nPrompt ? 'tokchip--prompt' : 'tokchip--gen'), text: tok.display(t) }));
    });
    const stopTxt = res.stoppedBy === 'punto' ? 'Se detuvo al generar «.».' : 'Se alcanzó el máximo de ' + o.maxNew + ' tokens nuevos.';
    out.append(h('section', { class: 'panel gen-summary' },
      h('div', { class: 'panel__head' }, h('span', { class: 'panel__title', text: 'Resultado' }),
        h('span', { class: 'small muted tg-head-right', text: 'pesos de la iteración ' + fmtInt(s.iter) + ' · ' + (o.greedy ? 'voraz' : 'muestreo, τ = ' + o.temperature.toFixed(2)) })),
      h('div', { class: 'panel__body' }, line,
        h('p', { class: 'small muted gen-summary__note', text: res.generated.length + ' token' + (res.generated.length === 1 ? '' : 's') + ' nuevo' + (res.generated.length === 1 ? '' : 's') + ' en ' +
          res.steps.length + ' pasos de forward. ' + stopTxt + (o.greedy ? '' : ' (En modo voraz la temperatura no cambia la elección, solo las probabilidades mostradas.)') }))));
    const V = tok.vocab.length;
    res.steps.forEach((st, k) => {
      const T = st.context.length;
      const ctx = h('div', { class: 'gen-ctx' });
      st.context.forEach((t, i) => ctx.append(h('span', { class: 'tokchip' + (i === T - 1 ? ' tokchip--last' : ''), text: tok.display(t) })));
      const headRow = h('div', { class: 'gen-step__head' },
        h('span', { class: 'gen-step__k', text: 'Paso ' + (k + 1) }), ctx,
        h('span', { class: 'gen-arrow', 'aria-hidden': 'true', text: '→' }),
        h('span', { class: 'tokchip tokchip--gen', text: tok.display(st.chosenToken) }),
        h('span', { class: 'mono small', text: 'p = ' + fmt(st.pChosen, 3) }),
        st.slid ? h('span', { class: 'chip chip--plain', title: 'El contexto superó maxLen: se conservan los últimos ' + s.cfg.maxLen + ' tokens', text: 'ventana deslizante' }) : null);
      const bars = h('div', { class: 'gen-bars' });
      const probsCol = h('div', { class: 'gen-step__probs' }, h('div', { class: 'gen-step__lbl', html: 'Las ' + Math.min(10, V) + ' más probables de \\(P(\\cdot \\mid \\text{contexto})\\), fila ' + T + ' del softmax' }), bars);
      const attnCol = h('div', { class: 'gen-step__attn' }, h('div', { class: 'gen-step__lbl', text: 'Atención con este contexto (la última fila, resaltada, es la posición que predice)' }));
      const agrid = h('div', { class: 'attn-grid attn-grid--gen' });
      agrid.style.setProperty('--cols', String(Math.min(s.cfg.nHeads, 4)));
      const disp = st.context.map(tok.display);
      for (let l = 0; l < s.cfg.nLayers; l++) {
        for (let hh = 0; hh < s.cfg.nHeads; hh++) {
          const mat = st.attn[l][hh];
          const hm = makeHeatmap(attnRef(mat, l, hh, disp), { showValues: 'auto', scale: 'sequential', caption: true });
          try {
            if (typeof hm.markRow === 'function') hm.markRow(T - 1, 'pin');
            else if (hm.highlightRow) hm.highlightRow(T - 1);
          } catch (e) { /* nada */ }
          agrid.append(h('div', { class: 'attn-cell' }, h('div', { class: 'attn-cell__lbl', text: (s.cfg.nLayers > 1 ? 'Capa ' + (l + 1) + ' · ' : '') + 'Cabeza ' + (hh + 1) }), hm.el));
          genHms.push({ hm, mat });
        }
      }
      attnCol.append(agrid);
      const art = h('article', { class: 'panel gen-step' }, headRow, h('div', { class: 'gen-step__body' }, probsCol, attnCol));
      out.append(art);
      if (TL.Charts) {
        TL.Charts.bars(bars, st.top.map((t) => ({ key: 't' + t.id, label: t.display, value: t.p, colorVar: t.id === st.chosen ? '--fwd' : '--prob-1', highlight: t.id === st.chosen })),
          { max: 1, format: (v) => fmt(v * 100, 1) + ' %', compact: true, ariaLabel: 'Probabilidades del siguiente token' });
      }
      Tex.typeset(probsCol);
    });
    return { ok: true, text: res.text, generated: res.generated.slice(), steps: res.steps.length, stoppedBy: res.stoppedBy };
  }

  // ───────────────────────────────────────────────────────────── DATOS Y MODELO
  const CFG_FIELDS = ['dModel', 'nHeads', 'nLayers', 'dFF', 'maxLen', 'activation', 'posEnc', 'seed', 'type', 'lr', 'batchSize', 'clip'];
  function fillForm(c) {
    $('cfg-corpus').value = c.corpus;
    for (const b of $('cfg-tok').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.tok === c.tokMode));
    const v = { dModel: c.cfg.dModel, nHeads: c.cfg.nHeads, nLayers: c.cfg.nLayers, dFF: c.cfg.dFF, maxLen: c.cfg.maxLen, activation: c.cfg.activation,
      posEnc: c.cfg.posEnc, seed: c.cfg.seed, type: c.hp.type, lr: c.hp.lr, batchSize: c.batchSize, clip: c.hp.clip };
    for (const k of CFG_FIELDS) $('cfg-' + k).value = String(v[k]);
    showCfgErrors({});
    updateCorpusHint();
  }
  function readForm() {
    const tokBtn = $('cfg-tok').querySelector('[aria-pressed="true"]');
    const r = { corpus: $('cfg-corpus').value, tokMode: tokBtn ? tokBtn.dataset.tok : 'word' };
    for (const k of CFG_FIELDS) r[k] = $('cfg-' + k).value;
    return r;
  }
  // Valida un objeto plano (del formulario o de la API). Devuelve { config, errors }.
  function validateConfig(r) {
    const e = {};
    const num = (x) => (typeof x === 'number' ? x : String(x).trim() === '' ? NaN : Number(x));
    const int = (k, lo, hi, msg) => {
      const v = num(r[k]);
      if (!Number.isInteger(v) || v < lo || v > hi) { e[k] = msg; return null; }
      return v;
    };
    const d = int('dModel', 2, 64, 'd debe ser un entero entre 2 y 64.');
    let hN = int('nHeads', 1, 64, 'h debe ser un entero positivo.');
    if (d !== null && hN !== null && d % hN !== 0) {
      const divs = [];
      for (let k = 1; k <= d; k++) if (d % k === 0) divs.push(k);
      e.nHeads = 'h debe dividir a d = ' + d + ' (valores posibles: ' + divs.join(', ') + ').';
      hN = null;
    }
    const N = int('nLayers', 1, 3, 'N debe ser 1, 2 o 3.');
    const dFF = int('dFF', 1, 256, 'd_ff debe ser un entero entre 1 y 256.');
    const maxLen = int('maxLen', 2, 32, 'La ventana debe tener entre 2 y 32 tokens.');
    const seedV = num(r.seed);
    if (!Number.isInteger(seedV) || Math.abs(seedV) > 2147483647) e.seed = 'La semilla debe ser un número entero.';
    const act = r.activation === 'gelu' ? 'gelu' : r.activation === 'relu' ? 'relu' : null;
    if (!act) e.activation = 'Elige ReLU o GELU.';
    const pe = r.posEnc === 'learned' ? 'learned' : r.posEnc === 'sinusoidal' ? 'sinusoidal' : null;
    if (!pe) e.posEnc = 'Elige sinusoidal o aprendida.';
    const type = r.type === 'sgd' ? 'sgd' : r.type === 'adam' ? 'adam' : null;
    if (!type) e.type = 'Elige Adam o SGD.';
    const lr = num(r.lr);
    if (!(lr > 0) || lr > 5) e.lr = 'η debe ser un número positivo (≤ 5): p. ej. 0.01 con Adam o 0.1 con SGD.';
    const B = int('batchSize', 1, 64, 'El minilote debe tener entre 1 y 64 frases.');
    const clip = num(r.clip);
    if (!(clip >= 0) || !Number.isFinite(clip)) e.clip = 'El umbral de recorte debe ser ≥ 0 (0 = sin recorte).';
    const corpus = String(r.corpus === undefined || r.corpus === null ? '' : r.corpus);
    const tokMode = r.tokMode === 'char' ? 'char' : 'word';
    let tokInfo = null;
    if (!corpus.split(/\r?\n/).some((l) => l.trim())) e.corpus = 'Escribe al menos una frase (una por línea).';
    else {
      try {
        const tk = TL.Tokenizer.build(corpus, tokMode, maxLen || 8);
        if (tk.vocab.length < 2) e.corpus = 'El vocabulario necesita al menos un token además de <s>.';
        else if (tk.vocab.length > 400) e.corpus = 'El vocabulario tiene ' + tk.vocab.length + ' tokens: demasiados para verlo con comodidad (máximo 400). Usa un corpus más pequeño.';
        else if (tk.sentences.length > 200) e.corpus = 'Hay ' + tk.sentences.length + ' frases; el máximo es 200.';
        tokInfo = tk;
      } catch (err) { e.corpus = err.message; }
    }
    const config = {
      corpus, tokMode,
      cfg: { dModel: d, nHeads: hN, nLayers: N, dFF, maxLen, activation: act, posEnc: pe, seed: seedV | 0 },
      hp: { type, lr, clip },
      batchSize: B,
    };
    return { config, errors: e, tok: tokInfo };
  }
  function showCfgErrors(errors) {
    for (const lab of doc.querySelectorAll('#panel-datos .cfg-fields .field[data-f]')) {
      const k = lab.dataset.f;
      const hint = lab.querySelector('.field__hint');
      lab.classList.toggle('field--error', !!errors[k]);
      hint.textContent = errors[k] || '';
      const input = lab.querySelector('input, select');
      if (input) { if (errors[k]) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); }
    }
    const cf = $('cfg-corpus').closest('.field');
    cf.classList.toggle('field--error', !!errors.corpus);
    if (errors.corpus) { $('cfg-corpus-hint').textContent = errors.corpus; $('cfg-corpus').setAttribute('aria-invalid', 'true'); }
    else { $('cfg-corpus').removeAttribute('aria-invalid'); updateCorpusHint(); }
    const n = Object.keys(errors).length;
    $('cfg-apply').disabled = n > 0;
    if (n) { $('cfg-status').textContent = 'Corrige ' + (n === 1 ? 'el campo marcado' : 'los ' + n + ' campos marcados') + ' para poder aplicar.'; $('cfg-status').className = 'cfg-status is-bad'; }
    else if ($('cfg-status').classList.contains('is-bad')) { $('cfg-status').textContent = ''; $('cfg-status').className = 'cfg-status'; }
  }
  function updateCorpusHint() {
    const r = readForm();
    try {
      const maxLen = Number(r.maxLen) || 8;
      const tk = TL.Tokenizer.build(r.corpus, r.tokMode, Math.max(1, maxLen));
      const longest = Math.max.apply(null, tk.sentences.map((x) => x.tokens.length - 1));
      const trunc = tk.sentences.filter((x) => x.truncated).length;
      $('cfg-corpus-hint').textContent = tk.sentences.length + ' frase' + (tk.sentences.length === 1 ? '' : 's') + ' · V = ' + tk.vocab.length +
        ' tokens (con <s>) · la más larga tiene ' + longest + ' tokens' + (trunc ? ' · ' + trunc + ' se recorta' + (trunc === 1 ? '' : 'n') + ' a maxLen + 1 = ' + (maxLen + 1) : '');
    } catch (e) { $('cfg-corpus-hint').textContent = ''; }
  }
  let cfgValidateTimer = 0;
  function initDatos() {
    const revalidate = () => {
      clearTimeout(cfgValidateTimer);
      cfgValidateTimer = setTimeout(() => showCfgErrors(validateConfig(readForm()).errors), 150);
    };
    $('panel-datos').querySelector('.cfg-grid').addEventListener('input', revalidate);
    $('panel-datos').querySelector('.cfg-grid').addEventListener('change', revalidate);
    $('cfg-tok').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tok]');
      if (!b) return;
      for (const x of $('cfg-tok').querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
      revalidate();
    });
    $('cfg-type').addEventListener('change', (e) => {
      const lr = Number($('cfg-lr').value);
      if (e.target.value === 'sgd' && lr === 0.01) $('cfg-lr').value = '0.1';
      if (e.target.value === 'adam' && lr === 0.1) $('cfg-lr').value = '0.01';
    });
    $('cfg-apply').addEventListener('click', () => {
      const res = applyConfig(readForm(), true);
      const st = $('cfg-status');
      if (res.ok) {
        const cp = TL.Model.countParams(S.s.model).total;
        st.textContent = 'Modelo reiniciado: ' + fmtInt(cp) + ' parámetros, V = ' + S.s.tok.vocab.length + ', ' + S.trace.steps.length + ' pasos por iteración.';
        st.className = 'cfg-status is-ok';
      }
    });
    $('cfg-defaults').addEventListener('click', () => {
      fillForm(defaultConfig());
      $('cfg-status').textContent = 'Valores por defecto cargados: pulsa «Aplicar y reiniciar» para usarlos.';
      $('cfg-status').className = 'cfg-status';
    });
    $('dimmap-filter').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-f]');
      if (!b) return;
      for (const x of $('dimmap-filter').querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
      filterDimmap(b.dataset.f);
    });
    $('gc-run').addEventListener('click', runGradCheck);
  }
  // Aplica una configuración (objeto del formulario o de la API, parcial o completo).
  function applyConfig(o, fromForm) {
    let flat;
    if (fromForm) flat = o;
    else {
      o = o || {};
      const c = S.config;
      const cfg = Object.assign({}, c.cfg, o.cfg || {});
      const hp = Object.assign({}, c.hp, o.hp || {});
      if (o.hp && o.hp.type && o.hp.lr === undefined && o.hp.type !== c.hp.type) hp.lr = o.hp.type === 'sgd' ? 0.1 : 0.01;
      flat = Object.assign({ corpus: o.corpus !== undefined ? o.corpus : c.corpus, tokMode: o.tokMode || c.tokMode, batchSize: o.batchSize !== undefined ? o.batchSize : c.batchSize }, cfg, hp);
    }
    const v = validateConfig(flat);
    if (Object.keys(v.errors).length) {
      if (fromForm) showCfgErrors(v.errors);
      return { ok: false, errors: v.errors };
    }
    try {
      startSession(v.config);
    } catch (err) {
      $('cfg-status').textContent = err.message;
      $('cfg-status').className = 'cfg-status is-bad';
      return { ok: false, errors: { general: err.message } };
    }
    return { ok: true, errors: {}, params: TL.Model.countParams(S.s.model).total, steps: S.trace.steps.length, V: S.s.tok.vocab.length };
  }

  let cancelDimTex = null;
  function renderDatos() {
    S.datosDirty = false;
    const s = S.s, cfg = s.cfg, model = s.model, tok = s.tok;
    const cp = TL.Model.countParams(model);
    $('model-summary').innerHTML = 'Modelo actual: <b>' + cfg.nLayers + ' capa' + (cfg.nLayers > 1 ? 's' : '') + '</b> · <b>' + cfg.nHeads + ' cabeza' + (cfg.nHeads > 1 ? 's' : '') +
      '</b> · <i>d</i> = ' + cfg.dModel + ' · <i>d</i><sub>k</sub> = ' + (cfg.dModel / cfg.nHeads) + ' · <i>d</i><sub>ff</sub> = ' + cfg.dFF + ' · <i>V</i> = ' + tok.vocab.length +
      ' · ventana de ' + cfg.maxLen + ' tokens · ' + (cfg.activation === 'gelu' ? 'GELU' : 'ReLU') + ' · PE ' + (cfg.posEnc === 'learned' ? 'aprendida' : 'sinusoidal') +
      ' · ' + (s.opt.type === 'sgd' ? 'SGD' : 'Adam') + ' (η = ' + (+s.opt.lr.toPrecision(6)) + ') · <b>' + fmtInt(cp.total) + ' parámetros</b>.';
    // vocabulario
    $('vocab-size').textContent = 'V = ' + tok.vocab.length;
    const vl = $('vocab-list');
    vl.textContent = '';
    tok.vocab.forEach((t, i) => vl.append(h('li', { class: 'vocab__it' }, h('span', { class: 'vocab__id', text: String(i) }), h('span', { class: 'vocab__tok', text: tok.display(t) }))));
    // inventario de parámetros
    const pt = $('params-table');
    pt.textContent = '';
    pt.append(h('thead', null, h('tr', null, h('th', { text: 'Nombre' }), h('th', { text: 'Símbolo' }), h('th', { text: 'Forma' }), h('th', { class: 'num', text: 'Nº' }),
      h('th', { text: 'Inicialización' }), h('th', { text: 'Descripción' }))));
    const pb = h('tbody');
    for (const name of model.order) {
      const pm = model.paramMeta[name];
      const sym = h('span');
      Tex.render(pm.tex, sym, { display: false });
      const [r, c] = pm.shape || [model.params[name].r, model.params[name].c];
      pb.append(h('tr', null, h('td', { class: 'mono', text: name }), h('td', null, sym),
        h('td', { class: 'nowrap' }, h('span', { class: 'badge-shape', text: r + '×' + c }), ' ', h('span', { class: 'badge-shape badge-shape--sym', html: axHtml(pm.rowAxis, pm.colAxis) })),
        h('td', { class: 'num', text: fmtInt(cp.byName[name]) }), h('td', { class: 'small', text: pm.init }), h('td', { class: 'small', text: pm.desc })));
    }
    pt.append(pb, h('tfoot', null, h('tr', null, h('th', { colspan: '3', text: 'Total' }), h('th', { class: 'num', text: fmtInt(cp.total) }), h('th', { colspan: '2' }))));
    $('params-total').textContent = fmtInt(cp.total) + ' parámetros';
    renderDimmap();
    // comprobación de gradientes: los resultados anteriores ya no valen
    $('gc-wrap').hidden = true;
    $('gc-table').textContent = '';
    $('gc-summary').textContent = '';
  }
  function renderDimmap() {
    const s = S.s;
    const T = S.trace ? S.trace.T : s.cfg.maxLen;
    const rows = TL.Model.shapeTable(s.model, T, { optimizer: s.opt.type });
    $('dimmap-t').textContent = rows.length + ' tensores · con T = ' + T + ' (la frase trazada en «Paso a paso»)';
    // tensor → primer paso de la traza que lo produce (o, si no, que lo usa)
    const producer = new Map();
    if (S.trace) {
      S.trace.steps.forEach((st, k) => { for (const o of st.outputs) if (!producer.has(o.tex)) producer.set(o.tex, k); });
      S.trace.steps.forEach((st, k) => { for (const o of st.inputs) if (!producer.has(o.tex)) producer.set(o.tex, k); });
    }
    const tbl = $('dimmap-table');
    tbl.textContent = '';
    tbl.append(h('thead', null, h('tr', null, h('th', { text: 'Tensor' }), h('th', { text: 'Forma simbólica' }), h('th', { text: 'Forma' }),
      h('th', { class: 'num', text: 'Elementos' }), h('th', { text: 'Descripción' }), h('th', { text: 'Paso' }))));
    const texJobs = [];
    let body = null, group = null;
    for (const r of rows) {
      if (r.group !== group) {
        group = r.group;
        body = h('tbody', { class: 'dimmap__group', 'data-phase': r.phase });
        body.append(h('tr', { class: 'dimmap__ghead' }, h('th', { colspan: '6', text: group })));
        tbl.append(body);
      }
      const name = h('span', { class: 'dimmap__tex', html: Tex.lite(r.tex) });
      texJobs.push([r.tex, name]);
      const k = producer.has(r.tex) ? producer.get(r.tex) : -1;
      const go = k >= 0 ? h('button', { type: 'button', class: 'btn btn--sm btn--ghost dimmap__go', title: 'Ver el paso ' + (k + 1) + ' en «Paso a paso»',
        onclick: () => { setTab('paso'); stopPlay(); goTo(k); } }, 'paso ' + (k + 1)) : h('span', { class: 'muted small', text: '—' });
      body.append(h('tr', { class: 'dimmap__row', 'data-phase': r.phase },
        h('td', null, name), h('td', null, h('span', { class: 'badge-shape badge-shape--sym', html: symHtml(r.sym) })),
        h('td', null, h('span', { class: 'badge-shape', text: r.shape[0] + '×' + r.shape[1] })),
        h('td', { class: 'num', text: fmtInt(r.shape[0] * r.shape[1]) }), h('td', { class: 'small', text: r.desc }), h('td', null, go)));
    }
    const cur = $('dimmap-filter').querySelector('[aria-pressed="true"]');
    filterDimmap(cur ? cur.dataset.f : 'all');
    if (cancelDimTex) cancelDimTex();
    cancelDimTex = chunked(texJobs, ([tex, el]) => Tex.render(tex, el, { display: false }), 14);
  }
  function filterDimmap(f) {
    for (const tb of $('dimmap-table').querySelectorAll('tbody')) tb.hidden = f !== 'all' && tb.dataset.phase !== f;
  }
  function runGradCheck() {
    const s = S.s;
    const sent = S.trace ? S.trace.sentenceIndex : 0;
    const t0 = now();
    const res = TL.Trainer.gradCheck(s, sent, { perParam: 3 });
    const ms = now() - t0;
    const tbl = $('gc-table');
    tbl.textContent = '';
    tbl.append(h('thead', null, h('tr', null, h('th', { text: 'Parámetro' }), h('th', { text: 'Entrada (i, j)' }), h('th', { class: 'num', text: 'Analítico (backward)' }),
      h('th', { class: 'num', text: 'Numérico (diferencias)' }), h('th', { class: 'num', text: 'Error relativo' }), h('th', { text: 'Estado' }))));
    const body = h('tbody');
    let ok = 0, worst = 0;
    for (const r of res) {
      const good = r.relErr < 1e-5 || Math.abs(r.analytic - r.numeric) < 1e-9;
      if (good) ok++;
      worst = Math.max(worst, r.relErr);
      const sym = h('span');
      Tex.render(r.tex || s.model.paramMeta[r.name].tex, sym, { display: false });
      body.append(h('tr', null, h('td', null, sym, h('span', { class: 'muted small gc-name', text: ' ' + r.name })),
        h('td', { class: 'mono', text: '(' + r.i + ', ' + r.j + ')' }), h('td', { class: 'num', text: sig(r.analytic) }), h('td', { class: 'num', text: sig(r.numeric) }),
        h('td', { class: 'num', text: sci(r.relErr) }),
        h('td', null, h('span', { class: 'chip ' + (good ? 'chip--ok' : 'chip--bad'), text: good ? 'coincide' : 'revisar' }))));
    }
    tbl.append(body);
    $('gc-wrap').hidden = false;
    const all = ok === res.length;
    const sum = $('gc-summary');
    sum.textContent = res.length + ' comprobaciones en ' + fmt(ms, 0) + ' ms (frase ' + (sent + 1) + ', iteración ' + fmtInt(s.iter) + ') · error relativo máximo ' + sci(worst) + ' · ' +
      (all ? 'todas coinciden.' : (res.length - ok) + ' no coinciden (con ReLU, una perturbación que cruza el 0 puede dar un error grande sin que el backward esté mal).');
    sum.className = 'gc-summary ' + (all ? 'is-ok' : 'is-bad');
    return { n: res.length, ok, worst };
  }

  // ───────────────────────────────────────────────────────────── adaptación al ancho
  const mqMobile = root.matchMedia ? root.matchMedia('(max-width: 759.98px)') : { matches: false };
  let dgUserToggled = false;
  function placeResponsive() {
    const bar = $('iterbar');
    const target = mqMobile.matches ? $('iterbar-slot') : $('tl-controls');
    if (bar.parentNode !== target) target.appendChild(bar);
    const det = $('dg-details');
    if (!mqMobile.matches) det.open = true;
    else if (!dgUserToggled) det.open = false;
    measureChrome();
  }
  function measureChrome() {
    const hd = $('app-head'), tl = $('timeline');
    const rs = doc.documentElement.style;
    rs.setProperty('--head-h', (hd ? hd.offsetHeight : 0) + 'px');
    rs.setProperty('--tl-h', (tl && !tl.hidden ? tl.offsetHeight : 0) + 'px');
    layoutBands();
  }
  function initResponsive() {
    const det = $('dg-details');
    det.querySelector('summary').addEventListener('click', () => { dgUserToggled = true; });
    if (mqMobile.addEventListener) mqMobile.addEventListener('change', placeResponsive);
    else if (mqMobile.addListener) mqMobile.addListener(placeResponsive);
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => measureChrome());
      ro.observe($('app-head'));
      ro.observe($('timeline'));
      ro.observe($('tl-bands'));
    } else root.addEventListener('resize', measureChrome);
    placeResponsive();
    try {
      const mqDark = root.matchMedia('(prefers-color-scheme: dark)');
      const f = () => { if (S.theme === 'auto') onThemeChange(); };
      if (mqDark.addEventListener) mqDark.addEventListener('change', f); else if (mqDark.addListener) mqDark.addListener(f);
    } catch (e) { /* nada */ }
  }

  // ───────────────────────────────────────────────────────────── arranque
  function showFatal(err) {
    console.error(err);
    const box = h('div', { class: 'callout fatal', 'data-phase': 'backward', role: 'alert' },
      h('b', { text: 'No se pudo iniciar el laboratorio. ' }), String(err && err.message ? err.message : err));
    const main = $('main');
    if (main) main.prepend(box);
  }
  function boot() {
    doc.documentElement.lang = 'es';
    const missing = ['Mat', 'Tokenizer', 'Model', 'Optim', 'Trainer'].filter((k) => !TL[k]);
    if (missing.length) { showFatal('Faltan módulos del motor: ' + missing.join(', ') + '.'); return; }
    applyTheme(S.theme, true);
    $('btn-theme').addEventListener('click', () => applyTheme(THEME_ORDER[(THEME_ORDER.indexOf(S.theme) + 1) % THEME_ORDER.length]));
    $('btn-guide').addEventListener('click', () => openGuide('tour', 0));
    initTabs();
    initTimeline();
    initKeys();
    initIterbar();
    initSideTabs();
    initWelcome();
    initModal();
    initTraining();
    initGeneration();
    initDatos();
    initResponsive();
    startSession(defaultConfig());
    const hash = (root.location.hash || '').slice(1);
    setTab(TABS.indexOf(hash) >= 0 ? hash : 'paso', { force: true, noHash: true, keepScroll: true });
    // fórmulas estáticas de las pestañas
    for (const el of doc.querySelectorAll('.panel-note, .gen-note, .gc-intro')) Tex.typeset(el);
    S.ready = true;
  }

  // ───────────────────────────────────────────────────────────── API pública
  TL.App = {
    state: S,
    goToStep(i) { stopPlay(); return goTo(i); },
    getStep() { return S.trace ? S.trace.steps[S.idx] : null; },
    getTrace() { return S.trace; },
    setTab(id) { return setTab(id); },
    newIteration(sentence) {
      stopPlay();
      return traceNew(sentence === undefined ? S.trace.sentenceIndex : sentence, S.idx);
    },
    train(n) {
      stopTraining();
      const r = trainN(Math.max(0, n | 0));
      const ev = TL.Trainer.evaluate(S.s);
      return { iter: r.iter, loss: r.loss, meanLoss: ev.loss };
    },
    generate(prompt, opts) { return runGeneration(prompt === undefined ? 'el gato' : prompt, opts || {}); },
    applyConfig(o) { return applyConfig(o, false); },
    setTheme(t) { applyTheme(t); return S.theme; },
    openGuide(section) { openGuide(section || 'tour', 0); },
    closeModal,
    gradCheck() { return runGradCheck(); },
    play() { startPlay(); },
    pause() { stopPlay(); },
    startTraining() { if (S.tab !== 'entrenamiento') setTab('entrenamiento'); startTraining(); },
    stopTraining() { stopTraining(); },
    pca: pca2,
    validateConfig,
  };

  try { boot(); } catch (err) { showFatal(err); }
})(typeof window !== 'undefined' ? window : globalThis);
