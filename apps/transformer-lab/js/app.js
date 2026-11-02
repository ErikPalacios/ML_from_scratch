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
   Usa TL.MathTex, TL.Heatmap, TL.OpViews, TL.Diagram, TL.Charts y TL.Content (se comprueban al arrancar).
     TL.App.flush()                     aplica ya la explicación y el inspector pendientes (pruebas)
     TL.App.play() / pause()            reproducción automática (cada paso se anima y se deja leer)
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

  // Texto plano del motor ('W_Q', 'd_k', 'H_f', 'X⁽⁰⁾') → HTML con subíndices; el superíndice de capa
  // se escribe entre corchetes, como en las fórmulas (X^{[0]}): los paréntesis suelen indicar un ejemplo
  const SUPN = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };
  const supBr = (html) => String(html).replace(/⁽([⁰¹²³⁴⁵⁶⁷⁸⁹]+)⁾/g, (m, n) => '<sup>[' + n.split('').map((c) => SUPN[c]).join('') + ']</sup>');
  function richTitle(s) {
    return supBr(esc(s).replace(/([A-Za-zΣγβμσθηεŜ\u0300-\u036f])_(\{[^}]*\}|[A-Za-z0-9]+)/g, (m, a, b) => a + '<sub>' + b.replace(/[{}]/g, '') + '</sub>'));
  }

  // ───────────────────────────────────────────── fórmulas (TL.MathTex degrada solo si MathJax no carga)
  const Tex = {
    render(tex, el, opts) { return TL.MathTex.render(tex, el, opts || {}); },
    typeset(el) {
      if (!el) return Promise.resolve();
      return Promise.resolve(TL.MathTex.typeset(el)).catch(() => {}).then(() => fitWideMath(el));
    },
    lite(tex) { return TL.Charts.texLite(tex); },
  };
  // Fórmula larga del encabezado: se parte en sus piezas «a,\quad b» o «a\qquad b» (al nivel superior)
  // para que puedan pasar a la línea siguiente en vez de quedar ocultas tras un desplazamiento horizontal.
  // level 0: piezas separadas por \quad / \qquad (y ↦); si aun así la fórmula no cabe, se parte más:
  // level 1 también antes de =, ≈, ⟹, ←; level 2 también antes de + y − binarios. Siempre al nivel
  // superior (fuera de llaves, entornos, \left…\right, \big(…\big) y paréntesis).
  function splitFormula(tex, level) {
    level = level || 0;
    const parts = [];
    let depth = 0, env = 0, lr = 0, par = 0, last = 0;
    const top = () => !depth && !env && !lr && !par;
    const cut = (i, keep) => {
      // keep: el operador empieza la pieza siguiente (= B, ← B…); si no, se descarta (\quad)
      let a = tex.slice(last, i);
      a = a.replace(/(\\[,:!]|\\q?quad|\s)+$/, '');
      if (a.endsWith('\\')) a = a.slice(0, -1); // «\;» justo antes del corte
      a = a.replace(/\s+$/, '');
      if (a.trim()) { parts.push(a); last = i; return true; }
      return false;
    };
    for (let i = 0; i < tex.length; i++) {
      const c = tex[i];
      if (c === '\\') {
        const m = /^\\([A-Za-z]+)/.exec(tex.slice(i, i + 16));
        if (m) {
          const w = m[1], nx = tex[i + m[0].length] || '', nx2 = tex.slice(i + m[0].length, i + m[0].length + 2);
          if (w === 'begin') env++;
          else if (w === 'end') env--;
          else if (w === 'left') lr++;
          else if (w === 'right') lr--;
          else if (/^[Bb]igg?[lm]?$/.test(w) && (nx === '(' || nx === '[' || nx2 === '\\{')) lr++;
          else if (/^[Bb]igg?[rm]?$/.test(w) && (nx === ')' || nx === ']' || nx2 === '\\}')) lr--;
          else if ((w === 'quad' || w === 'qquad') && top()) {
            // un operador suelto («⟹») no forma pieza: se queda con lo que le sigue
            if (!/^\\(Longrightarrow|Rightarrow|mapsto|approx|leftarrow|Leftarrow)(\\[,:!]|\\|\s)*$/.test(tex.slice(last, i).trim())) {
              cut(i);
              last = i + m[0].length;
            }
          } else if (top() && (w === 'mapsto' || (level >= 1 && /^(approx|Longrightarrow|Rightarrow|leftarrow|Leftarrow)$/.test(w)))) {
            cut(i, true);
          }
          i += m[0].length - 1;
        } else i++; // \, \; \{ … : se salta el carácter escapado
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '(' || c === '[') par++;
      else if (c === ')' || c === ']') par = Math.max(0, par - 1);
      else if (top() && level >= 1 && c === '=') cut(tex[i - 1] === ':' ? i - 1 : i, true);
      else if (top() && level >= 2 && (c === '+' || c === '-')) {
        const prevCh = tex.slice(last, i).replace(/\s+$/, '').slice(-1);
        if (prevCh && !/[=+\-({^_,&]/.test(prevCh)) cut(i, true);
      }
    }
    const rest = tex.slice(last).trim();
    if (rest) parts.push(rest);
    return parts.length ? parts : [tex];
  }
  function renderFormula(tex, host, level) {
    host.textContent = '';
    host.dataset.tex = tex;
    host.dataset.lvl = String(level || 0);
    const parts = splitFormula(tex, level);
    host.classList.toggle('is-multi', parts.length > 1);
    for (const p of parts) {
      const s = h('span', { class: 'step-formula__part' });
      TL.MathTex.render(p, s, { display: true });
      host.appendChild(s);
    }
  }
  // si una fórmula en bloque no cabe en su caja (y MathJax la compuso), se vuelve a partir más fino
  function formulaOverflows(host) {
    if (!host.clientWidth) return false;
    if (host.scrollWidth > host.clientWidth + 1) return true;
    for (const m of host.querySelectorAll('mjx-container')) if (m.scrollWidth > m.clientWidth + 1) return true;
    return false;
  }
  function refitFormulas(root) {
    if (!root || !root.isConnected || !TL.MathTex.isReady()) return;
    for (const host of root.querySelectorAll('[data-tex][data-lvl], .tex--display[data-tex]')) {
      const tex = host.dataset.tex;
      let lvl = +(host.dataset.lvl || -1);
      if (lvl < 0) { if (!formulaOverflows(host)) continue; lvl = 0; host.classList.add('tex-split'); renderFormula(tex, host, 0); }
      while (lvl < 2 && formulaOverflows(host)) { lvl++; renderFormula(tex, host, lvl); }
    }
  }

  // Una fórmula en línea no puede partirse: si es más ancha que su párrafo, pasa a bloque con scroll propio
  function fitWideMath(root) {
    if (!root || !root.isConnected) return;
    for (const m of root.querySelectorAll('.tex:not(.tex--display):not(.tex--wide), mjx-container:not([display="true"])')) {
      const box = m.parentElement && m.parentElement.closest('p, li, dd, td, div');
      if (!box || !box.clientWidth) continue; // oculto: se comprobará al mostrarse
      if (m.getBoundingClientRect().width > box.clientWidth - 2) m.classList.add('tex--wide');
    }
  }

  const makeHeatmap = (ref, opts) => TL.Heatmap.create(ref, opts || {});
  function destroyHeatmap(hm) {
    if (!hm) return;
    try { hm.destroy(); } catch (e) { /* nada */ }
  }

  // ───────────────────────────────────────────────────────────── constantes
  const TABS = ['paso', 'entrenamiento', 'generacion', 'datos'];
  const PHASE_FALLBACK = { data: 'Datos', forward: 'Forward', loss: 'Pérdida', backward: 'Backward', update: 'Actualización' };
  const PHASE_SHORT = { data: 'Datos', forward: 'Fwd', loss: 'Pérd.', backward: 'Bwd', update: 'Act.' };
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
  const SYM_HTML = { T: '<i>T</i>', d: '<i>d</i>', h: '<i>h</i>', dk: '<i>d</i><sub>k</sub>', dff: '<i>d</i><sub>ff</sub>', V: '<i>V</i>', N: '<i>N</i>', lr: '<i>η</i>', B: '<i>B</i>' };
  const THEME_NAME = { auto: 'Sistema', light: 'Claro', dark: 'Oscuro' };
  // números en las celdas: 'auto' (donde caben) · 'todos' · 'no' (solo color); antes se guardaba true/false
  const VALUES_ORDER = ['auto', 'todos', 'no'];
  const VALUES_CTX = { auto: 'auto', todos: 'always', no: false };
  function normValues(v) { return v === false ? 'no' : VALUES_ORDER.indexOf(v) >= 0 ? v : 'auto'; }
  const THEME_ORDER = ['auto', 'light', 'dark'];
  // reproducción automática (a 1×): cada paso se anima como mucho PLAY_ANIM_MS y luego se deja
  // PLAY_BASE_MS para leerlo; a 2× o 4× todo se divide por la velocidad
  const PLAY_BASE_MS = 1500;
  const PLAY_ANIM_MS = 3000;

  const phaseName = (p) => {
    const c = TL.Content.phases[p];
    return (c && c.name) || PHASE_FALLBACK[p] || p;
  };
  // LaTeX sencillo → texto plano (para lectores de pantalla): '(5\\times 8)\\to(5\\times 8)' → '(5×8)→(5×8)'
  function texPlain(t) {
    return String(t == null ? '' : t)
      .replace(/\\times\s*/g, '×').replace(/\\cdot\s*/g, '·').replace(/\\to(?![A-Za-z])\s*/g, ' → ')
      .replace(/\\mathbb\{R\}/g, 'ℝ').replace(/\\(text|mathrm)\{([^}]*)\}/g, '$2')
      .replace(/\\[,;:! ]|\\q?quad/g, ' ').replace(/\\[A-Za-z]+/g, '').replace(/[{}]/g, '')
      .replace(/\s+/g, ' ').trim();
  }
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
    showValues: normValues(store.get('showValues', 'auto')), // 'auto' | 'todos' | 'no'
    playing: false,
    speed: 1,
    playAnim: false,      // la animación en curso la lanzó la reproducción automática
    canAnim: false,       // el paso actual tiene animación
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
  // mapas de calor, gráficos y diagrama se recolorean solos (observan data-theme); aquí solo el minigráfico
  function onThemeChange() { afterPaint(drawSpark); }

  // ───────────────────────────────────────────────────────────── pestañas
  function setTab(id, o) {
    o = o || {};
    if (TABS.indexOf(id) < 0) id = 'paso';
    const changed = S.tab !== id;
    if (!changed && !o.force) return S.tab;
    // al salir de «Entrenamiento» se pausa sin refrescar un panel que se va a ocultar
    if (changed && S.tab === 'entrenamiento') {
      stopTraining({ noRefresh: true });
      if (bgJob && bgJob.kind === 'train') bgJob.cancel();
    }
    if (id !== 'paso') {
      stopPlay();
      // «Entrenar 200 iteraciones y volver» es de «Paso a paso»: al salir se cancela (lo entrenado se conserva)
      if (bgJob && bgJob.kind === 'return') bgJob.cancel();
    }
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
    if (id === 'paso') { updateStale(); drawSpark(); }
    measureChrome();
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
      else goToHashStep(id);
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
    stopTraining({ noRefresh: true });
    stopPlay();
    if (bgJob) bgJob.cancel();
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
    // (el formulario de «Datos» no se toca aquí: «Reiniciar pesos» no debe borrar lo que se esté
    // editando; lo rellenan el arranque y applyConfig)
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
    if (bgJob && bgJob.kind === 'return') bgJob.cancel();
    // tras una divergencia no se traza (ni se actualiza) nada más: los parámetros ya no son finitos
    // y cada iteración nueva solo propagaría NaN. El aviso de «Paso a paso» lo explica.
    if (s.diverged && S.trace) {
      $('sent-select').value = String(S.trace.sentenceIndex);
      updateStale();
      if (!$('stale-note').hidden) bringIntoBand($('stale-note'), { smooth: true });
      srSay('El entrenamiento divergió: no se recorren más iteraciones hasta reiniciar los pesos.');
      return { iter: S.trace.iter, loss: S.trace.loss, sentenceIndex: S.trace.sentenceIndex, steps: S.trace.steps.length, diverged: true };
    }
    const n = s.tok.sentences.length;
    sentIdx = ((sentIdx | 0) % n + n) % n;
    const r = TL.Trainer.traceIteration(s, sentIdx);
    const sen = s.tok.sentences[r.sentenceIndex];
    S.prevTrace = S.trace;
    // lr/opt: con qué optimizador se calculó la traza (si luego cambia η, la explicación sigue a la traza)
    S.trace = { steps: r.steps, loss: r.loss, iter: r.iter, sentenceIndex: r.sentenceIndex, T: sen.T, gradNorm: r.gradNorm, text: sen.text,
      lr: s.opt.lr, opt: s.opt.type };
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

  // Enlace directo #paso-<n> (n desde 1): lo usa el Atlas de Arquitecturas para abrir un paso concreto.
  function goToHashStep(id) {
    const m = /^paso-(\d+)$/.exec(id || '');
    if (!m || !S.trace) return;
    setTab('paso', { noHash: true });
    stopPlay();
    goTo(parseInt(m[1], 10) - 1);   // goTo acota al rango de la traza
  }

  function goTo(i, o) {
    if (!S.trace) return null;
    const steps = S.trace.steps;
    i = clamp(i | 0, 0, steps.length - 1);
    if (i === S.idx && !(o && o.force)) return stepSummary(i);
    // ir a otro paso cancela «Entrenar 200 iteraciones y volver» (lo ya entrenado se conserva)
    if (bgJob && bgJob.kind === 'return' && i !== bgJob.idx) bgJob.cancel();
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
    announceStep(st, i);
    const ms = now() - t0;
    S.perf.lastStepMs = ms;
    S.perf.maxStepMs = Math.max(S.perf.maxStepMs, ms);
    return stepSummary(i);
  }
  const next = () => goTo(S.idx + 1);
  const prev = () => goTo(S.idx - 1);

  // lectores de pantalla: el cambio de paso se anuncia en una región de estado (con retardo, para
  // no leer cada paso al arrastrar la línea de tiempo; durante la reproducción no se anuncia)
  let srTimer = 0;
  function announceStep(st, i) {
    clearTimeout(srTimer);
    if (S.playing || S.dragging) return;
    srTimer = setTimeout(() => {
      const el = $('sr-step');
      if (el && S.trace && S.trace.steps[S.idx] === st) {
        el.textContent = 'Paso ' + (i + 1) + ' de ' + S.trace.steps.length + ': ' + st.title + '. Dimensiones: ' + texPlain(st.dims) + '.';
      }
    }, 300);
  }

  // mensaje para lectores de pantalla (sustituye al anuncio del paso que estuviera pendiente)
  function srSay(txt) {
    clearTimeout(srTimer);
    srTimer = setTimeout(() => { const el = $('sr-step'); if (el) el.textContent = txt; }, 320);
  }
  function reducedMotion() {
    try { return root.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }
  // desplaza la página lo justo para que el elemento quede en la franja visible (sin cabecera, línea de
  // tiempo ni inspector fijos). o.top: si hay que moverse, su borde superior va arriba de la franja;
  // o.smooth: desplazamiento suave (salvo movimiento reducido); o.focus: además recibe el foco
  function bringIntoBand(el, o) {
    o = o || {};
    if (!el || !el.isConnected) return;
    const band = visibleBand(), r = el.getBoundingClientRect(), pad = 8;
    let dy = 0;
    const inside = r.top >= band.top && r.bottom <= band.bottom;
    if (!inside) {
      if (o.top || r.height + 2 * pad > band.bottom - band.top || r.top < band.top) dy = r.top - band.top - pad;
      else dy = r.bottom - band.bottom + pad;
    }
    if (Math.abs(dy) >= 2) {
      try { root.scrollBy({ top: dy, behavior: o.smooth && !reducedMotion() ? 'smooth' : 'auto' }); } catch (e) { root.scrollBy(0, dy); }
    }
    if (o.focus) {
      if (!el.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) el.setAttribute('tabindex', '-1');
      try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    }
  }
  // tras cambiar de paso desde dentro del escenario (el botón pulsado desaparece con la vista), el foco
  // pasa al título del paso nuevo; así el teclado y el lector de pantalla siguen en su sitio
  function focusStepTitle() {
    bringIntoBand($('step-head'), { top: true });
    bringIntoBand($('step-title'), { focus: true });
  }

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
    // la frase de la tokenización va como texto (no dentro de la fórmula: _, %, & o \ se verían escapados)
    const q = $('step-quote');
    if (st.kind === 'tokenize' && st.aux && st.aux.text != null) { q.textContent = '«' + st.aux.text + '»'; q.hidden = false; }
    else { q.textContent = ''; q.hidden = true; }
    renderFormula(st.formula, $('step-formula'));
    refitFormulas($('step-head'));
    Tex.render(st.dimsSym, $('step-dimsym'), { display: false });
    Tex.render(st.dims, $('step-dims'), { display: false });
    const fw = $('step-flops-wrap');
    if (st.flops) {
      let detail = '';
      if (st.kind === 'matmul' && st.aux && st.inputs[st.aux.a] && st.inputs[st.aux.b]) {
        const A = st.inputs[st.aux.a].mat, B = st.inputs[st.aux.b].mat;
        detail = A.r + '·' + A.c + '·' + B.c + ' = ';
      }
      const fl = $('step-flops');
      fl.textContent = '';
      fl.append(h('span', { class: 'mono', text: detail + fmtInt(st.flops) }), h('span', { class: 'step-flops__u', text: 'productos (cada uno: 1 mult. + 1 suma ≈ 2 FLOP)' }));
      fl.title = detail + fmtInt(st.flops) + ' multiplicaciones y sumas: una por cada término de cada producto escalar';
      fw.hidden = false;
    } else fw.hidden = true;
  }

  // --- escenario (TL.OpViews)
  let inspPending = null, inspRaf = 0;
  function resetInspector() {
    const b = $('inspector-body');
    b.classList.add('is-empty');
    b.innerHTML = '<p class="insp-empty">Pasa el cursor por cualquier celda de las matrices (o tócala; con el teclado, <span class="kbd">Tab</span> y las flechas). Aquí aparecerá la <b>cuenta exacta</b> que produce ese número, término a término, y en las demás matrices se resaltarán las celdas que intervienen.</p>';
    $('inspector').classList.add('is-empty');
    // minimizado, «Mostrar» sigue a mano (si no, la hoja quedaría en una barra sin control)
    $('insp-min').hidden = !$('inspector').classList.contains('is-collapsed');
    measureInsp();
  }
  // el HTML llega en cada movimiento del cursor: se aplica como mucho una vez por fotograma
  function inspect(html) {
    inspPending = html === null || html === undefined ? '' : String(html);
    if (inspRaf) return;
    inspRaf = requestAnimationFrame(applyInspector);
  }
  function applyInspector() {
    inspRaf = 0;
    const v = inspPending;
    inspPending = null;
    if (v === null) return;
    const b = $('inspector-body');
    if (!v) { resetInspector(); return; }
    b.classList.remove('is-empty');
    $('inspector').classList.remove('is-empty');
    $('insp-min').hidden = false;
    b.innerHTML = v;
    // la fórmula del inspector (\[…\]) en piezas que pueden pasar de línea, como en la cabecera
    for (const el of b.querySelectorAll('.insp__tex')) {
      const t = el.textContent.trim();
      if (/^\\\[[\s\S]*\\\]$/.test(t)) renderFormula(t.slice(2, -2), el);
    }
    Tex.typeset(b);
    refitFormulas(b);
    measureInsp();
  }
  // franja de la ventana que no tapan la cabecera, la línea de tiempo ni el inspector fijos.
  // Por debajo de 1200 px el inspector va fijo al pie y crece en cuanto la animación muestra una
  // cuenta: se reserva ya su altura máxima (si no, taparía justo lo que se está animando).
  function visibleBand() {
    const hd = $('app-head').getBoundingClientRect();
    const top = Math.max(0, hd.bottom);
    let bottom = root.innerHeight;
    const tl = $('timeline');
    if (!tl.hidden) bottom = Math.min(bottom, tl.getBoundingClientRect().top);
    if (!mqWide.matches) {
      const ins = $('inspector');
      let hgt = ins.getBoundingClientRect().height;
      // (durante la reproducción la animación no abre el inspector: no hace falta reservar su altura)
      if (ins.classList.contains('is-empty') && !ins.classList.contains('is-collapsed') && !(S.playing && S.playAnim)) {
        const mh = parseFloat(getComputedStyle($('inspector-body')).maxHeight);
        hgt += (Number.isFinite(mh) ? mh : root.innerHeight * 0.3) + 20;
      }
      if (hgt) bottom -= hgt + (mqMobile.matches ? 4 : 8);
    }
    return { top, bottom };
  }
  // resumen del último paso: pérdida de la misma frase con los pesos recién actualizados y cuántos
  // números cambiaron de verdad (con gradiente 0 —y, con Adam, sin momento— un número no se mueve)
  function recapFor(i) {
    const t = S.trace, s = S.s;
    if (!t || i !== t.steps.length - 1) return null;
    const sen = s.tok.sentences[t.sentenceIndex];
    const fresh = t.iter === s.iter;
    let changed = 0;
    for (const st of t.steps) {
      if (st.kind !== 'update' || !st.aux || !st.aux.delta) continue;
      const dd = st.aux.delta.d;
      for (let k = 0; k < dd.length; k++) if (dd[k] !== 0) changed++;
    }
    return {
      iter: t.iter, before: t.loss, after: fresh && !s.diverged ? TL.Model.loss(s.model, sen.inputIds, sen.targetIds) : null,
      stale: !fresh, diverged: !!s.diverged,
      nParams: TL.Model.countParams(s.model).total, nChanged: changed, optimizer: t.opt, relu: s.cfg.activation === 'relu',
      onNew: s.diverged ? null : () => {
        stopPlay();
        traceNew(t.sentenceIndex, 0);
        try { root.scrollTo(0, 0); } catch (e) { /* nada */ }
        focusStepTitle();
      },
    };
  }
  // último paso: tras animarlo (con «Animar» o en la reproducción) la página está en la salida; se
  // vuelve al resumen de la iteración, que va arriba de la vista. focusBtn: el foco pasa a «Nueva iteración».
  function showRecap(focusBtn) {
    const box = $('stage').querySelector('.ov-recap');
    if (!box) return;
    bringIntoBand(box, { top: true, smooth: true });
    if (focusBtn) {
      const b = box.querySelector('button');
      if (b) { try { b.focus({ preventScroll: true }); } catch (e) { b.focus(); } }
    }
  }
  function makeCtx(st) {
    return {
      cfg: S.s.cfg, tok: S.s.tok, model: S.s.model, content: TL.Content,
      showValues: VALUES_CTX[S.showValues],
      // durante la reproducción, sin columna derecha (< 1200 px), la animación no abre el inspector fijo
      // al pie: taparía justo la matriz que se está rellenando (el cursor o un toque sí lo abren)
      onInspect: (html, o) => { if (o && o.anim && S.playing && S.playAnim && !mqWide.matches) return; inspect(html); },
      animateSpeed: Math.round(160 / S.speed),
      values: placeholderValues(st), stepIndex: S.idx, steps: S.trace.steps, iter: S.trace.iter,
      targetTokens: S.s.tok.sentences[S.trace.sentenceIndex].targetTokens.map(S.s.tok.display),
      viewport: visibleBand,
      goTo: (k) => { stopPlay(); goTo(k); focusStepTitle(); },
      onTrainAndReturn: (n) => trainAndReturn(n),
      recap: recapFor(S.idx),
    };
  }
  function renderStage(st) {
    const stage = $('stage');
    if (S.view && typeof S.view.destroy === 'function') { try { S.view.destroy(); } catch (e) { /* nada */ } }
    S.view = null;
    S.animToken = (S.animToken || 0) + 1;
    stage.textContent = '';
    // lo que el inspector tuviera pendiente es de la vista anterior: se descarta
    if (inspRaf) { cancelAnimationFrame(inspRaf); inspRaf = 0; }
    inspPending = null;
    resetInspector();
    stage.setAttribute('data-phase', st.phase);
    stage.setAttribute('data-kind', st.kind);
    $('inspector').setAttribute('data-phase', st.phase);
    // TL.OpViews ya recurre a su vista genérica si la específica falla; esto solo cubre lo imprevisto
    try { S.view = TL.OpViews.render(st, stage, makeCtx(st)); } catch (e) {
      console.error('TL.OpViews.render falló en el paso ' + st.id + ':', e);
      stage.textContent = '';
      stage.append(h('p', { class: 'callout', 'data-phase': 'backward', text: 'No se pudo dibujar este paso (' + e.message + ').' }));
    }
    if (bgJob && bgJob.kind === 'return') syncReturnBtn();
    // gradnorm no tiene animación (su vista no es una ecuación de matrices)
    const canAnim = !!(S.view && st.kind !== 'gradnorm');
    S.canAnim = canAnim;
    $('btn-animate').disabled = !canAnim;
    $('btn-animate').title = canAnim ? 'Reproduce la operación celda a celda (y desplaza la página hasta el resultado)' : 'Este paso no tiene animación';
    $('btn-animate-label').textContent = 'Animar';
  }
  // anima la vista actual; o: { budget } (duración máxima en ms). Devuelve una promesa.
  function runAnim(o) {
    if (!S.view || !S.canAnim || typeof S.view.animate !== 'function') return Promise.resolve();
    const tok = ++S.animToken;
    const btn = $('btn-animate');
    btn.disabled = true;
    $('btn-animate-label').textContent = 'Animando…';
    let p;
    try { p = S.view.animate(o); } catch (e) { p = null; console.error(e); }
    return Promise.resolve(p).catch(() => {}).then(() => {
      if (tok !== S.animToken) return;
      btn.disabled = !S.canAnim;
      $('btn-animate-label').textContent = 'Animar';
      if (S.trace && S.idx === S.trace.steps.length - 1) showRecap(false);
    });
  }
  function animateStep() { stopPlay(); runAnim(); }

  // --- diagrama
  function buildDiagram() {
    if (S.dg) { try { S.dg.destroy(); } catch (e) { /* nada */ } }
    S.dg = null;
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
    TL.Charts.tip.show((t) => {
      t.append(h('div', { class: 'tooltip__title', text: 'Paso ' + (i + 1) + ' / ' + S.trace.steps.length + ' · ' + phaseName(st.phase) }));
      t.append(h('div', { class: 'tl-tip__title', html: richTitle(st.title) }));
    }, x, y);
  }
  const hideTip = () => TL.Charts.tip.hide();
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
      const faster = +b.dataset.speed > S.speed;
      S.speed = +b.dataset.speed;
      for (const x of $('tl-speed').querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
      // durante la reproducción el cambio se nota ya: la pausa de lectura en curso se ajusta al nuevo
      // ritmo y, al acelerar, la animación en curso se completa de golpe (el paso siguiente ya va más rápido)
      if (S.playing) {
        if (faster && S.playAnim && S.view && typeof S.view.stop === 'function') S.view.stop();
        playRetime();
      }
    });
  }

  // --- reproducción automática: una «película» de la iteración. Cada paso se anima (como «Animar»,
  // con la duración acotada y la página desplazada hasta el resultado) y luego se deja un momento
  // para leerlo. «Pausa», las flechas o cualquier salto la detienen.
  let playTok = 0, playWake = null, playTimer = null;
  function playSleep(ms) {
    return new Promise((res) => {
      const done = () => { if (playTimer) clearTimeout(playTimer.id); playTimer = null; playWake = null; res(); };
      playTimer = { t0: now(), id: setTimeout(done, ms), done };
      playWake = done;
    });
  }
  // la velocidad cambió durante la pausa de lectura: lo que queda de ella se ajusta al nuevo ritmo
  function playRetime() {
    if (!playTimer) return;
    const left = Math.max(0, PLAY_BASE_MS / S.speed - (now() - playTimer.t0));
    clearTimeout(playTimer.id);
    playTimer.id = setTimeout(playTimer.done, left);
  }
  function togglePlay() { if (S.playing) stopPlay(); else startPlay(); }
  function startPlay() {
    if (!S.trace || S.playing) return;
    if (S.idx >= S.trace.steps.length - 1) goTo(0);
    S.playing = true;
    const b = $('tl-play');
    b.setAttribute('aria-pressed', 'true');
    b.setAttribute('aria-label', 'Pausa (Espacio)');
    b.classList.add('is-playing');
    playLoop(++playTok);
  }
  function stopPlay() {
    if (!S.playing) return;
    S.playing = false;
    playTok++;
    if (playWake) playWake();
    // la animación que había lanzado la reproducción se corta (la matriz queda completa)
    if (S.playAnim && S.view && typeof S.view.stop === 'function') S.view.stop();
    S.playAnim = false;
    const b = $('tl-play');
    b.setAttribute('aria-pressed', 'false');
    b.setAttribute('aria-label', 'Reproducir (Espacio)');
    b.classList.remove('is-playing');
  }
  async function playLoop(tok) {
    let first = true; // el paso actual también se anima antes de avanzar
    while (S.playing && tok === playTok) {
      if (!first) {
        // fin de la película: el resumen de la iteración queda a la vista y con el foco en «Nueva iteración»
        if (S.idx >= S.trace.steps.length - 1) { stopPlay(); showRecap(true); return; }
        next();
      }
      first = false;
      if (S.canAnim) {
        S.playAnim = true;
        await runAnim({ budget: PLAY_ANIM_MS / S.speed });
        if (tok !== playTok) return;
        S.playAnim = false;
      }
      if (!S.playing || tok !== playTok) return;
      await playSleep(PLAY_BASE_MS / S.speed);
    }
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
      // Esc cierra cualquier tooltip abierto (símbolos, línea de tiempo, gráficos): WCAG 1.4.13
      if (e.key === 'Escape') TL.Charts.tip.hide();
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
          // mantener pulsada la barra no debe alternar al ritmo de repetición del teclado
          if (e.repeat) { e.preventDefault(); return; }
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
      // η con el que se calculó la traza (si luego se cambia en «Entrenamiento», la explicación
      // sigue a los números que se ven)
      lr: +(S.trace && S.trace.lr != null ? S.trace.lr : S.s.opt.lr).toPrecision(6),
      B: 1, // «Paso a paso» recorre una sola frase
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
    if (!el._typeset) { el._typeset = true; Tex.typeset(el).then(() => refitFormulas(el)); }
    // (una explicación guardada en caché puede tener fórmulas provisionales de MathJax: se componen ya)
    else if (TL.MathTex.upgrade) TL.MathTex.upgrade(el);
    if (changedTpl) {
      for (const col of [$('expl-col'), $('side-expl')]) {
        if (col.scrollHeight > col.clientHeight + 4 && getComputedStyle(col).overflowY !== 'visible') col.scrollTop = 0;
      }
    }
  }
  function expSection(title, body) {
    return h('section', { class: 'expl__sec' }, h('h4', { class: 'expl__h', text: title }), body);
  }
  function buildExpl(st) {
    const C = TL.Content;
    const c = C.steps[st.tpl];
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
      for (const m of c.math) { const d = h('div', { class: 'expl__eq' }); renderFormula(F(m), d); box.append(d); }
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
      if (k === 0) refitFormulas($('expl')); // oculta no se podía medir
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

  // --- símbolos con sus valores: una sola parada de tabulación; ← → recorren los símbolos
  let symItems = [], symIdx = 0;
  function renderSymstrip() {
    const strip = $('symstrip');
    const vals = placeholderValues(null);
    const syms = TL.Content.symbols || [];
    strip.textContent = '';
    symItems = [];
    syms.forEach((sy, k) => {
      const key = sy.key || sy.sym;
      const v = vals[key];
      const desc = String(sy.desc || '').replace('{batch}', String(S.s.batchSize));
      const item = h('span', { class: 'sym', id: 'sym-' + k, role: 'note', 'aria-label': sy.sym + ' = ' + v + ': ' + sy.name + '. ' + desc },
        h('span', { class: 'sym__k', html: SYM_HTML[key] || esc(sy.sym) }),
        h('span', { class: 'sym__eq', text: '=' }),
        h('span', { class: 'sym__v', text: String(v) }));
      item._show = (ev) => {
        const r = item.getBoundingClientRect();
        TL.Charts.tip.show((t) => {
          t.append(h('div', { class: 'tooltip__title', text: sy.name }));
          if (desc) t.append(h('div', { class: 'sym-tip', text: desc }));
        }, ev && ev.clientX ? ev.clientX : r.left + r.width / 2, ev && ev.clientY ? ev.clientY : r.top);
      };
      item.addEventListener('mouseenter', item._show);
      item.addEventListener('mouseleave', () => { if (doc.activeElement !== strip) hideTip(); });
      strip.append(item);
      symItems.push(item);
    });
    symIdx = Math.min(symIdx, Math.max(0, symItems.length - 1));
    strip.tabIndex = symItems.length ? 0 : -1;
    strip.setAttribute('role', 'group');
    strip.setAttribute('aria-label', 'Símbolos y sus valores en este modelo (usa ← y → para recorrerlos)');
    if (symItems.length) strip.setAttribute('aria-activedescendant', symItems[symIdx].id);
  }
  function initSymstrip() {
    const strip = $('symstrip');
    const pick = (k, show) => {
      if (!symItems.length) return;
      symIdx = clamp(k, 0, symItems.length - 1);
      symItems.forEach((it, j) => it.classList.toggle('is-focus', j === symIdx));
      strip.setAttribute('aria-activedescendant', symItems[symIdx].id);
      // con la tira en una fila con desplazamiento (1200–1599 px), el símbolo activo no queda cortado
      if (strip.scrollWidth > strip.clientWidth + 1) {
        const it = symItems[symIdx], a = it.getBoundingClientRect(), b = strip.getBoundingClientRect();
        if (a.left < b.left) strip.scrollLeft -= b.left - a.left + 4;
        else if (a.right > b.right) strip.scrollLeft += a.right - b.right + 4;
      }
      if (show) symItems[symIdx]._show(null);
    };
    // un clic o un toque en un símbolo enfoca la tira: se muestra ESE símbolo (no el último activo)
    strip.addEventListener('pointerdown', (e) => {
      const k = symItems.indexOf(e.target.closest ? e.target.closest('.sym') : null);
      if (k < 0) return;
      symIdx = k;
      if (doc.activeElement === strip) pick(k, true);
    });
    strip.addEventListener('focus', () => pick(symIdx, true));
    strip.addEventListener('blur', () => { for (const it of symItems) it.classList.remove('is-focus'); hideTip(); });
    strip.addEventListener('keydown', (e) => {
      let k = symIdx;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') k++;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') k--;
      else if (e.key === 'Home') k = 0;
      else if (e.key === 'End') k = symItems.length - 1;
      else return;
      e.preventDefault();
      e.stopPropagation();
      pick(k, true);
    });
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
    el.append(h('span', { class: 'iterbar__lk', html: '<i class="lsym">L</i> it. ' + t.iter + ' = ' }), h('b', { text: fmtLoss(t.loss, 3) }), h('span', { class: 'iterbar__delta ' + cls, text: delta }));
    el.title = 'Pérdida de la frase recorrida en la iteración ' + t.iter + (delta ? '; entre paréntesis, el cambio respecto a la iteración anterior con la misma frase' : '');
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
  // pérdida con NaN visible (una divergencia no debe parecer un número normal); una pérdida enorme
  // pero finita (pasos demasiado grandes) en notación científica, no «1e+306»
  const fmtLoss = (v, n) => (Number.isNaN(v) ? 'NaN' : Math.abs(v) >= 1e6 ? sci(v, 2) : fmt(v, n));
  function updateHeaderStats() {
    const s = S.s;
    $('hd-iter').textContent = fmtInt(s.iter);
    const last = s.history[s.history.length - 1];
    $('hd-loss').textContent = last ? fmtLoss(last.loss, 3) : '—';
  }
  const OPT_NAME = { adam: 'Adam', sgd: 'SGD' };
  function updateStale() {
    const note = $('stale-note');
    if (!S.trace || !S.s) { note.hidden = true; return; }
    const diff = S.s.iter - S.trace.iter;
    const optChanged = S.trace.lr != null && (S.trace.lr !== S.s.opt.lr || S.trace.opt !== S.s.opt.type);
    const div = !!S.s.diverged;
    const rb = $('stale-retrace');
    rb.textContent = div ? 'Ir a «Entrenamiento»' : 'Recorrer una iteración nueva con los pesos actuales';
    if (diff <= 0 && !optChanged && !div) { note.hidden = true; return; }
    let txt = '';
    if (div) {
      txt = (diff > 0 ? 'Estás viendo la traza de la iteración ' + S.trace.iter + '. ' : '') +
        'El entrenamiento divergió en la iteración ' + fmtInt(S.s.iter) + ' (la pérdida o el gradiente dejaron de ser finitos): ya no se recorren ni se actualizan más iteraciones. ' +
        'Baja η o activa el recorte del gradiente y pulsa «Reiniciar pesos» en «Entrenamiento».';
    } else if (diff > 0) {
      txt = 'Estás viendo la traza de la iteración ' + S.trace.iter + '; desde entonces el modelo ha entrenado ' +
        fmtInt(diff) + (diff > 1 ? ' iteraciones' : ' iteración') + ' más (va por la ' + fmtInt(S.s.iter) + ').';
    }
    if (optChanged && !div) {
      txt += (txt ? ' ' : '') + 'Esta traza usó ' + OPT_NAME[S.trace.opt] + ' con η = ' + (+S.trace.lr.toPrecision(6)) + '; el optimizador ahora usa ' +
        OPT_NAME[S.s.opt.type] + ' con η = ' + (+S.s.opt.lr.toPrecision(6)) + '.';
    }
    $('stale-text').textContent = txt;
    note.hidden = false;
  }
  function initIterbar() {
    $('sent-select').addEventListener('change', (e) => { stopPlay(); traceNew(+e.target.value, S.idx); });
    $('btn-newiter').addEventListener('click', () => { stopPlay(); traceNew(S.trace.sentenceIndex, S.idx); });
    $('stale-retrace').addEventListener('click', () => {
      stopPlay();
      if (S.s.diverged) setTab('entrenamiento');
      else traceNew(S.trace.sentenceIndex, S.idx);
    });
    syncValuesBtn();
    $('btn-values').addEventListener('click', () => {
      S.showValues = VALUES_ORDER[(VALUES_ORDER.indexOf(S.showValues) + 1) % VALUES_ORDER.length];
      store.set('showValues', S.showValues);
      syncValuesBtn();
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

  function syncValuesBtn() {
    const b = $('btn-values');
    $('btn-values-label').textContent = S.showValues;
    b.setAttribute('aria-label', 'Números en las celdas: ' + { auto: 'automático (donde caben)', todos: 'en todas las matrices', no: 'ninguno, solo color' }[S.showValues] + '. Pulsa para cambiar');
    b.classList.toggle('is-on', S.showValues !== 'no');
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
        .filter((x) => !x.disabled && x.offsetParent !== null && x.tabIndex >= 0);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (doc.activeElement === first || doc.activeElement === m.querySelector('.modal__box'))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }
  function openDerivation(id) {
    const d = TL.Content.derivations[id];
    if (!d) return;
    $('modal-body').removeAttribute('role');
    $('modal-body').removeAttribute('aria-labelledby');
    openModal({
      eyebrow: 'Derivación', title: d.title,
      body: h('div', { class: 'prose prose--long', html: d.html }),
      foot: h('button', { type: 'button', class: 'btn', 'data-close': '' }, 'Cerrar'),
    });
  }
  function openGuide(section, card) {
    const C = TL.Content;
    const tour = C.tour || [];
    let sec = section || 'tour', k = card || 0;
    const seg = h('div', { class: 'seg seg--sm', role: 'tablist', 'aria-label': 'Secciones de la guía' });
    const secs = [['tour', 'Recorrido'], ['notation', 'Notación'], ['glossary', 'Glosario'], ['keys', 'Teclado']];
    const btns = secs.map(([id, name]) => {
      const b = h('button', { type: 'button', role: 'tab', id: 'guide-tab-' + id, 'aria-selected': 'false', 'aria-controls': 'modal-body', tabindex: '-1' }, name);
      b.addEventListener('click', () => { sec = id; k = 0; draw(); });
      seg.append(b);
      return b;
    });
    // pestañas: una sola parada de tabulación; ← → Inicio Fin cambian de sección
    seg.addEventListener('keydown', (e) => {
      let j = secs.findIndex((x) => x[0] === sec);
      if (e.key === 'ArrowRight') j = (j + 1) % secs.length;
      else if (e.key === 'ArrowLeft') j = (j - 1 + secs.length) % secs.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = secs.length - 1;
      else return;
      e.preventDefault();
      sec = secs[j][0]; k = 0; draw();
      btns[j].focus();
    });
    function draw() {
      btns.forEach((b, j) => { const on = secs[j][0] === sec; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
      const mb = $('modal-body');
      mb.setAttribute('role', 'tabpanel');
      mb.setAttribute('aria-labelledby', 'guide-tab-' + sec);
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
          keyRow(['Espacio'], 'Reproducir o pausar: la iteración entera, animando cada operación («Animar» repite solo la del paso actual)'),
          keyRow(['Inicio', 'Fin'], 'Primer / último paso de la iteración'),
          keyRow(['Tab'], 'Recorrer los controles; en el esquema, ↑ ↓ siguen el flujo y ← → cambian de cabeza'),
          keyRow(['Esc'], 'Cerrar este diálogo, una derivación o un tooltip'),
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
  let trainRaf = 0, trainFrame = 0, lastHeavy = 0, heavyGap = 250, itsWindow = [];
  let adaptive = 1, lastIterMs = 0, lastIterTs = -Infinity;

  function resetTrainingViews() {
    for (const x of trainHms) destroyHeatmap(x.hm);
    trainHms = [];
    $('tr-attn').textContent = '';
    S.trainAttnSig = '';
    S.pca = null;
    itsWindow = [];
    evalReset();
    $('st-speed').textContent = '—';
    showDiverged();
  }

  // Evaluación del corpus por partes: cada frase guarda su pérdida y la iteración en que se midió.
  // Mientras se entrena solo se mide lo que cabe en unos milisegundos por fotograma; en pausa se
  // completa a trozos en segundo plano. Así un corpus grande no congela la página.
  let evalState = null, evalTimer = 0;
  function evalReset() { evalState = null; clearTimeout(evalTimer); evalTimer = 0; }
  function evalStep(budgetMs) {
    const s = S.s, sents = s.tok.sentences, n = sents.length;
    let E = evalState;
    if (!E || E.s !== s || E.n !== n) E = evalState = { s, n, loss: new Float64Array(n), at: new Float64Array(n).fill(-1), cursor: 0 };
    const t0 = now();
    let did = 0;
    for (let k = 0; k < n; k++) {
      const i = E.cursor;
      if (E.at[i] !== s.iter) {
        if (did && now() - t0 > budgetMs) break;
        E.loss[i] = TL.Model.loss(s.model, sents[i].inputIds, sents[i].targetIds);
        E.at[i] = s.iter;
        did++;
      }
      E.cursor = (i + 1) % n;
    }
    let sum = 0, cnt = 0, fresh = 0;
    const per = sents.map((sen, i) => {
      if (E.at[i] < 0) return { text: sen.text, loss: NaN };
      sum += E.loss[i]; cnt++;
      if (E.at[i] === s.iter) fresh++;
      return { text: sen.text, loss: E.loss[i] };
    });
    const res = { loss: cnt ? sum / cnt : NaN, perSentence: per, complete: fresh === n, fresh, n };
    S.lastEval = res;
    return res;
  }
  function showDiverged() {
    const el = $('tr-diverged');
    if (el) el.hidden = !(S.s && S.s.diverged);
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
    // la descripción de B en la tira de símbolos cita el minilote de «Entrenamiento»
    if (patch && patch.batchSize !== undefined) renderSymstrip();
    updateStale();
    return true;
  }
  function buildDiagramKeep() {
    buildDiagram();
    setDiagramShapes();
    if (S.trace) syncDiagram(S.trace.steps[S.idx]);
  }
  function initTraining() {
    $('tr-run').addEventListener('click', () => (S.training ? stopTraining() : startTraining()));
    // +1 / +10 / +100: a trozos (la página sigue respondiendo); el botón muestra el progreso y un
    // segundo clic cancela
    for (const b of doc.querySelectorAll('[data-train]')) b.addEventListener('click', () => trainButton(b));
    $('tr-speed').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-speed]');
      if (!b) return;
      S.trainSpeed = b.dataset.speed;
      for (const x of $('tr-speed').querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
    });
    $('tr-inspect').addEventListener('click', () => { stopTraining({ noRefresh: true }); setTab('paso'); traceNew(S.attnSent || 0, S.idx); });
    $('tr-reset').addEventListener('click', () => { $('tr-reset-confirm').hidden = false; $('tr-reset').hidden = true; $('tr-reset-no').focus(); });
    $('tr-reset-no').addEventListener('click', () => { $('tr-reset-confirm').hidden = true; $('tr-reset').hidden = false; $('tr-reset').focus(); });
    $('tr-reset-confirm').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); $('tr-reset-no').click(); } });
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
      // el mismo límite de coste que en «Datos y modelo»: una iteración no se puede partir entre
      // fotogramas, así que con un minilote demasiado grande cada fotograma congelaría la página
      const c = S.s.cfg;
      const est = (B) => estimateIterMs({ d: c.dModel, h: c.nHeads, N: c.nLayers, dFF: c.dFF, B, V: S.s.tok.vocab.length, sentences: S.s.tok.sentences });
      const ms = est(v);
      if (ms > MAX_ITER_MS) {
        let bMax = v;
        while (bMax > 1 && est(bMax) > MAX_ITER_MS) bMax--;
        $('tr-hp-err').textContent = 'Con B = ' + v + ' este modelo es demasiado pesado para el navegador (≈ ' + fmtInt(ms) + ' ms por iteración; el límite es ' +
          MAX_ITER_MS + ' ms). Con este modelo, B puede llegar a ' + bMax + '.';
        e.target.value = String(S.s.batchSize);
        return;
      }
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
    if (bgJob) bgJob.cancel();
    if (S.s.diverged) { showDiverged(); return; }
    S.training = true;
    $('tr-run').setAttribute('aria-pressed', 'true');
    $('tr-run-label').textContent = 'Pausa';
    $('tr-run').classList.add('is-running');
    trainFrame = 0;
    itsWindow = [];
    // «Máxima» vuelve a medir desde 1 iteración por trozo: el ritmo de un modelo anterior no vale
    adaptive = 1;
    lastIterMs = 0;
    lastIterTs = -Infinity;
    trainRaf = requestAnimationFrame(trainLoop);
  }
  // o.noRefresh: no recalcular el panel (al salir de la pestaña o al reiniciar la sesión)
  function stopTraining(o) {
    if (!S.training) return;
    S.training = false;
    cancelAnimationFrame(trainRaf);
    $('tr-run').setAttribute('aria-pressed', 'false');
    $('tr-run-label').textContent = 'Entrenar';
    $('tr-run').classList.remove('is-running');
    if (!(o && o.noRefresh) && S.tab === 'entrenamiento') refreshTraining(true);
    updateStale();
  }
  // Cada fotograma tiene un presupuesto de tiempo: la página (y el botón «Pausa») sigue respondiendo
  // aunque el modelo sea grande.
  function trainLoop(ts) {
    if (!S.training) return;
    trainFrame++;
    const t0 = now();
    let n = 0;
    if (S.trainSpeed === 'maxima') {
      // trozos de `adaptive` iteraciones (≈ 4 ms cada uno) hasta gastar ~10 ms del fotograma
      do {
        const k = clamp(adaptive, 1, 64);
        TL.Trainer.trainSteps(S.s, k);
        n += k;
      } while (now() - t0 < 10 && !S.s.diverged);
      const per = (now() - t0) / n;
      adaptive = clamp(Math.floor(4 / Math.max(per, 1e-3)), 1, 64);
    } else {
      // lenta: 1 iteración cada 4 fotogramas; media: 1 por fotograma. Si una iteración tarda más de
      // ~12 ms, entre dos iteraciones se deja al menos otro tanto de respiro.
      const due = S.trainSpeed === 'lenta' ? trainFrame % 4 === 0 : true;
      if (due && ts - lastIterTs >= (lastIterMs > 12 ? 2 * lastIterMs : 0)) {
        TL.Trainer.trainSteps(S.s, 1);
        n = 1;
        lastIterMs = now() - t0;
        lastIterTs = ts;
      }
    }
    if (n > 0) {
      itsWindow.push([ts, n]);
      while (itsWindow.length > 1 && ts - itsWindow[0][0] > 1000) itsWindow.shift();
      if (S.s.diverged) { stopTraining(); showDiverged(); return; }
      refreshTraining(false);
    }
    trainRaf = requestAnimationFrame(trainLoop);
  }
  // síncrono (API de automatización y +1): n iteraciones de golpe
  function trainN(n) {
    if (!S.s.diverged) TL.Trainer.trainSteps(S.s, n);
    refreshTraining(true);
    showDiverged();
    updateStale();
    drawSpark();
    const last = S.s.history[S.s.history.length - 1];
    return { iter: S.s.iter, loss: last ? last.loss : NaN };
  }
  // n iteraciones a trozos de ≈ 10 ms por fotograma (al menos una: una iteración no se puede partir):
  // la página sigue respondiendo, se puede mostrar el progreso y cancelar. Solo hay un trabajo a la vez.
  // o: { kind: 'train' | 'return', onProgress(done, n) }. Devuelve el trabajo:
  // { n, done, kind, promise → { done, n, cancelled, diverged }, cancel() }
  let bgJob = null;
  function trainChunked(n, o) {
    o = o || {};
    if (bgJob) bgJob.cancel();
    const s = S.s;
    const job = { n, done: 0, kind: o.kind || 'train', cancelled: false, over: false };
    let raf = 0, resolve = null;
    job.promise = new Promise((r) => { resolve = r; });
    const finish = () => {
      job.over = true;
      if (bgJob === job) bgJob = null;
      cancelAnimationFrame(raf);
      resolve({ done: job.done, n, cancelled: job.cancelled, diverged: !!s.diverged });
    };
    job.cancel = () => { if (job.over) return; job.cancelled = true; finish(); };
    const frame = () => {
      raf = 0;
      if (job.over) return;
      if (S.s !== s) { job.cancelled = true; finish(); return; } // la sesión cambió (Aplicar, Reiniciar)
      const t0 = now();
      while (job.done < n && !s.diverged) {
        TL.Trainer.trainSteps(s, 1);
        job.done++;
        if (now() - t0 > 10) break;
      }
      if (o.onProgress) o.onProgress(job.done, n);
      if (job.done >= n || s.diverged) { finish(); return; }
      raf = requestAnimationFrame(frame);
    };
    bgJob = job;
    raf = requestAnimationFrame(frame);
    return job;
  }
  function trainButton(b) {
    const n = +b.dataset.train;
    if (bgJob && bgJob.btn === b) { bgJob.cancel(); return; }
    stopTraining();
    if (bgJob) bgJob.cancel();
    if (S.s.diverged) { showDiverged(); return; }
    if (!(n > 1)) { trainN(n); return; }
    const label = b.textContent;
    itsWindow = [];
    let prevK = 0;
    const job = trainChunked(n, { kind: 'train', onProgress: (k) => {
      // velocidad (it/s) también mientras avanza a trozos
      const t = now();
      itsWindow.push([t, k - prevK]);
      prevK = k;
      while (itsWindow.length > 1 && t - itsWindow[0][0] > 1000) itsWindow.shift();
      b.textContent = k + '/' + n;
      refreshTraining(false);
    } });
    job.btn = b;
    b.classList.add('is-running');
    b.setAttribute('aria-busy', 'true');
    b.title = 'Entrenando ' + n + ' iteraciones: pulsa de nuevo para cancelar';
    job.promise.then((r) => {
      b.textContent = label;
      b.classList.remove('is-running');
      b.removeAttribute('aria-busy');
      b.removeAttribute('title');
      if (S.tab === 'entrenamiento') refreshTraining(true);
      showDiverged();
      updateStale();
      drawSpark();
      if (r.cancelled && r.done < n) $('tr-hp-err').textContent = 'Cancelado tras ' + r.done + ' de ' + n + ' iteraciones.';
    });
  }
  // «Entrenar 200 iteraciones y volver a este paso» (nota de la atención): a trozos, con el progreso en
  // el propio botón (un segundo clic cancela; ir a otro paso, también). Al terminar se recorre una
  // iteración nueva y se vuelve a este paso, con la nota (ya con los pesos entrenados) a la vista.
  function returnBtn() { return $('stage').querySelector('[data-train-return]'); }
  function syncReturnBtn() {
    const b = returnBtn();
    if (!b) return;
    if (!b.dataset.label) b.dataset.label = b.textContent;
    const j = bgJob && bgJob.kind === 'return' ? bgJob : null;
    if (j) {
      b.textContent = 'Entrenando… ' + j.done + ' / ' + j.n + ' · pulsa para cancelar';
      b.setAttribute('aria-busy', 'true');
      b.classList.add('is-running');
    } else {
      b.textContent = b.dataset.label;
      b.removeAttribute('aria-busy');
      b.classList.remove('is-running');
    }
  }
  function trainAndReturn(n) {
    stopPlay();
    if (bgJob && bgJob.kind === 'return') { bgJob.cancel(); return; } // segundo clic: cancelar
    if (!S.trace) return;
    stopTraining({ noRefresh: true });
    if (S.s.diverged) { updateStale(); bringIntoBand($('stale-note'), { smooth: true }); return; }
    const i = S.idx, sent = S.trace.sentenceIndex;
    const job = trainChunked(n, { kind: 'return', onProgress: () => { syncReturnBtn(); updateHeaderStats(); } });
    job.idx = i;
    syncReturnBtn();
    srSay('Entrenando ' + n + ' iteraciones…');
    job.promise.then((r) => {
      updateHeaderStats();
      drawSpark();
      syncReturnBtn();
      if (r.cancelled || S.s.diverged) {
        updateStale();
        srSay(S.s.diverged ? 'El entrenamiento divergió tras ' + r.done + ' iteraciones.' : 'Entrenamiento cancelado tras ' + r.done + ' iteraciones.');
        return;
      }
      traceNew(sent, i);
      bringIntoBand($('stage').querySelector('.ov-note--attn'), { focus: true });
      srSay('Entrenadas ' + r.done + ' iteraciones: ahora ves la iteración ' + S.trace.iter + ', de nuevo en el paso ' + (S.idx + 1) + '.');
    });
  }

  // Curva de pérdida incremental: la media móvil y los puntos (diezmados) se guardan en la sesión y
  // cada fotograma solo procesa las iteraciones nuevas (no recorre toda la historia).
  const LOSS_PTS = 3000;
  function lossView(s) {
    let lv = s._lossView;
    if (!lv || lv.n > s.history.length) lv = s._lossView = { n: 0, ema: null, stride: 1, raw: [], sm: [] };
    const hist = s.history;
    for (let i = lv.n; i < hist.length; i++) {
      const L = hist[i].loss;
      if (Number.isFinite(L)) lv.ema = lv.ema === null ? L : 0.9 * lv.ema + 0.1 * L;
      if (i % lv.stride === 0) { lv.raw.push([hist[i].iter, L]); lv.sm.push([hist[i].iter, lv.ema === null ? NaN : lv.ema]); }
      if (lv.raw.length > LOSS_PTS) {
        lv.raw = lv.raw.filter((_, k) => k % 2 === 0);
        lv.sm = lv.sm.filter((_, k) => k % 2 === 0);
        lv.stride *= 2;
      }
    }
    lv.n = hist.length;
    return lv;
  }
  function drawLossChart() {
    const s = S.s, hist = s.history, n = hist.length;
    const lv = lossView(s);
    const raw = lv.raw.slice(), ema = lv.sm.slice();
    // el último punto siempre (aunque no caiga en el diezmado)
    if (n && (!raw.length || raw[raw.length - 1][0] !== hist[n - 1].iter)) { raw.push([hist[n - 1].iter, hist[n - 1].loss]); ema.push([hist[n - 1].iter, lv.ema === null ? NaN : lv.ema]); }
    const lnV = Math.log(s.tok.vocab.length);
    const x0 = n ? hist[0].iter : 0, x1 = n ? Math.max(hist[n - 1].iter, x0 + 1) : 1;
    TL.Charts.line($('tr-loss'), [
      { name: 'media móvil', points: ema, colorVar: '--fwd', width: 2 },
      { name: 'pérdida por iteración', points: raw, colorVar: '--fwd', faint: true },
      { name: 'ln V (azar)', points: [[x0, lnV], [x1, lnV]], colorVar: '--muted', dashed: true, width: 1 },
    ], { xLabel: 'iteración', yLabel: 'pérdida', xName: 'iteración', logY: $('tr-logy').checked, areaIndex: 0, legend: true,
      includeZero: !$('tr-logy').checked, emptyText: 'Pulsa «Entrenar» para empezar', ariaLabel: 'Curva de pérdida por iteración' });
  }
  function refreshTraining(full) {
    if (!S.s) return;
    const s = S.s;
    showDiverged(); // también si divergió al recorrer una iteración en «Paso a paso»
    updateHeaderStats();
    const last = s.history[s.history.length - 1];
    $('st-iter').textContent = fmtInt(s.iter);
    $('st-loss').textContent = last ? fmtLoss(last.loss, 4) : '—';
    const gn = s.lastGradNorm;
    $('st-gn').textContent = gn === null || gn === undefined ? '—' : !Number.isFinite(gn) ? 'no finita (' + (Number.isNaN(gn) ? 'NaN' : '∞') + ')' :
      fmt(gn, 3) + (s.lastClipFactor < 1 ? ' → recortada ×' + fmt(s.lastClipFactor, 3) : '');
    if (itsWindow.length > 1) {
      const span = (itsWindow[itsWindow.length - 1][0] - itsWindow[0][0]) / 1000;
      let cnt = 0;
      for (let k = 1; k < itsWindow.length; k++) cnt += itsWindow[k][1];
      if (span > 0.2) $('st-speed').textContent = fmtInt(cnt / span) + ' it/s';
    }
    if (S.tab !== 'entrenamiento') return;
    drawLossChart();
    // el refresco pesado se espacia según lo que tarda (nunca en todos los fotogramas)
    if (full || now() - lastHeavy > heavyGap) {
      const t0 = now();
      heavyTraining(!!full && !S.training);
      lastHeavy = now();
      heavyGap = Math.max(250, 4 * (lastHeavy - t0));
    }
  }
  // settle: sin entrenar (pausa, +1, +10…): la evaluación del corpus se completa en segundo plano
  function heavyTraining(settle) {
    const s = S.s;
    clearTimeout(evalTimer);
    showEval(evalStep(S.training ? 6 : 12));
    if (settle && !S.lastEval.complete) {
      const more = () => {
        if (S.training || S.tab !== 'entrenamiento' || S.s !== s) return;
        const ev = evalStep(12);
        showEval(ev);
        if (!ev.complete) evalTimer = setTimeout(more, 0);
      };
      evalTimer = setTimeout(more, 0);
    }
    const pm = s.model.paramMeta;
    const hasG = s.lastGradNorms && Object.keys(s.lastGradNorms).length;
    // etiqueta visible (W_Q⁽²⁾), no la clave interna del motor
    const gFinite = hasG && Number.isFinite(s.lastGradNorm);
    TL.Charts.bars($('tr-grad-bars'), gFinite ? s.model.order.map((name) => ({ key: name, label: pm[name].label, tex: '\\mathrm{d}' + pm[name].tex, value: s.lastGradNorms[name], colorVar: '--bwd' })) : [],
      { format: (v) => fmt(v, 3), compact: s.model.order.length > 14,
        emptyText: hasG ? 'Gradientes no finitos (NaN o ∞): el entrenamiento divergió.' : 'Aún no hay gradientes: entrena una iteración.', ariaLabel: 'Norma del gradiente por parámetro' });
    const pr = TL.Trainer.predict(s, S.attnSent || 0);
    renderTrainAttn(pr);
    renderPredTable(pr);
    renderPCA(pr);
  }
  function showEval(ev) {
    // mientras no están medidas todas las frases con los pesos actuales (corpus grande), la media se
    // estima con la media móvil de las pérdidas de los minilotes (las medidas viejas la retrasarían)
    let L = ev.loss, approx = '';
    if (!ev.complete) {
      const lv = lossView(S.s);
      if (lv.ema !== null) L = lv.ema;
      approx = '≈ ';
    }
    $('st-mean').textContent = Number.isNaN(L) && ev.fresh ? 'NaN' : approx + fmtLoss(L, 4);
    $('st-mean').title = ev.complete ? 'Media de las ' + ev.n + ' frases con los pesos actuales' :
      'Estimación (media móvil de los minilotes) mientras se miden las ' + ev.n + ' frases con los pesos actuales';
    // perplejidad e^L: con una pérdida enorme, en forma de potencia (e^690 no cabe en la casilla)
    const ppl = $('st-ppl');
    if (!Number.isFinite(L)) ppl.textContent = Number.isNaN(L) && ev.fresh ? 'NaN' : '—';
    else if (L > 20) ppl.innerHTML = approx + 'e<sup>' + esc(fmtLoss(L, 1)) + '</sup>';
    else ppl.textContent = approx + fmt(Math.exp(L), 2);
    TL.Charts.bars($('tr-sent-bars'), ev.perSentence.map((p, i) => ({ key: 's' + i, label: (i + 1) + '. ' + p.text, value: p.loss, colorVar: '--fwd', highlight: i === S.attnSent })),
      { format: (v) => fmt(v, 3), onSelect: (it) => { S.attnSent = +it.key.slice(1); $('tr-attn-sent').value = String(S.attnSent); refreshTraining(true); }, ariaLabel: 'Pérdida por frase',
        emptyText: S.s.diverged ? 'Pérdidas no finitas (NaN): el entrenamiento divergió.' : 'Midiendo…' });
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
        h('td', { class: 'num', text: String(t) }),
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
    $('gen-vocab').textContent = 'El modelo conoce estos ' + words.length + ' tokens (más <s>, V = ' + tok.vocab.length + '): ' + words.join(' · ');
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
  const GEN_ATTN_MAX = 8;
  function buildGenAttn(grid, st, disp) {
    const s = S.s, T = st.context.length;
    const list = [];
    for (let l = 0; l < s.cfg.nLayers; l++) for (let hh = 0; hh < s.cfg.nHeads; hh++) list.push([l, hh]);
    const add = (items) => {
      for (const [l, hh] of items) {
        const mat = st.attn[l][hh];
        const hm = makeHeatmap(attnRef(mat, l, hh, disp), { showValues: 'auto', scale: 'sequential', caption: true });
        try {
          if (typeof hm.markRow === 'function') hm.markRow(T - 1, 'pin');
          else if (hm.highlightRow) hm.highlightRow(T - 1);
        } catch (e) { /* nada */ }
        grid.append(h('div', { class: 'attn-cell' }, h('div', { class: 'attn-cell__lbl', text: (s.cfg.nLayers > 1 ? 'Capa ' + (l + 1) + ' · ' : '') + 'Cabeza ' + (hh + 1) }), hm.el));
        genHms.push({ hm, mat });
      }
    };
    add(list.slice(0, GEN_ATTN_MAX));
    if (list.length > GEN_ATTN_MAX) {
      const rest = list.slice(GEN_ATTN_MAX);
      const more = h('button', { type: 'button', class: 'btn btn--sm gen-attn__more' }, 'Mostrar las ' + rest.length + ' cabezas restantes');
      more.addEventListener('click', () => { more.remove(); add(rest); });
      grid.append(more);
    }
  }
  function genOpts() {
    const greedy = $('gen-mode').querySelector('[aria-pressed="true"]').dataset.mode !== 'sample';
    const mv = parseInt($('gen-max').value, 10);
    const maxNew = Number.isFinite(mv) ? clamp(mv, 1, 30) : 10; // 0 → 1 (el mínimo), no 10
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
        h('span', { class: 'small muted tg-head-right', text: 'pesos de la iteración ' + fmtInt(s.iter) + ' · ' +
          (o.greedy ? 'voraz' + (o.temperature !== 1 ? ' · τ = ' + o.temperature.toFixed(2) : '') : 'muestreo, τ = ' + o.temperature.toFixed(2)) })),
      h('div', { class: 'panel__body' }, line,
        h('p', { class: 'small muted gen-summary__note', text: res.generated.length + ' token' + (res.generated.length === 1 ? '' : 's') + ' nuevo' + (res.generated.length === 1 ? '' : 's') + ' en ' +
          res.steps.length + ' pasos de forward. ' + stopTxt +
          (o.greedy ? ' (En modo voraz la temperatura no cambia la elección, solo las probabilidades mostradas.)'
            : ' (Muestreo con τ = ' + o.temperature.toFixed(2) + ': otra semilla puede dar otra frase.)') }))));
    const V = tok.vocab.length, N = s.cfg.nLayers, H = s.cfg.nHeads, d = s.cfg.dModel;
    // mapas de atención: todos si son pocos; si no, cada paso en un desplegable que los construye al
    // abrirse (abierto solo el último) y como mucho GEN_ATTN_MAX por paso (el resto, con un botón)
    const combos = N * H;
    const eager = res.steps.length * combos <= 32;
    res.steps.forEach((st, k) => {
      const T = st.context.length;
      const ctx = h('div', { class: 'gen-ctx' });
      st.context.forEach((t, i) => ctx.append(h('span', { class: 'tokchip' + (i === T - 1 ? ' tokchip--last' : ''), text: tok.display(t) })));
      const headRow = h('div', { class: 'gen-step__head' },
        h('span', { class: 'gen-step__k', text: 'Paso ' + (k + 1) }), ctx,
        h('span', { class: 'gen-arrow', 'aria-hidden': 'true', text: '→' }),
        h('span', { class: 'tokchip tokchip--gen', text: tok.display(st.chosenToken) }),
        h('span', { class: 'mono small', text: 'p = ' + fmt(st.pChosen, 3) }),
        st.slid ? h('span', { class: 'chip chip--plain', title: 'El contexto superó la ventana T_máx: se conservan los últimos ' + s.cfg.maxLen + ' tokens', text: 'ventana deslizante' }) : null);
      const disp = st.context.map(tok.display);
      // cómo cambian las formas en este paso de inferencia (solo forward)
      const shapes = h('p', { class: 'gen-shapes', title: 'Formas del forward de este paso: T = ' + T + ' tokens de contexto, d = ' + d + ', V = ' + V },
        h('span', { class: 'gen-shapes__k', text: 'Formas' }),
        'ids (1×' + T + ') → X (' + T + '×' + d + ') → ' + N + (N > 1 ? ' capas' : ' capa') + ' (' + T + '×' + d + ') → logits (' + T + '×' + V +
        ') → última fila (1×' + V + ') → ÷ τ → softmax → «' + tok.display(st.chosenToken) + '»');
      const bars = h('div', { class: 'gen-bars' });
      const probsCol = h('div', { class: 'gen-step__probs' }, h('div', { class: 'gen-step__lbl', html: 'Las ' + Math.min(10, V) + ' más probables de \\(P(\\cdot \\mid \\text{contexto})\\): última fila del softmax (índice ' + (T - 1) + ', <span class="no-tex">«' + esc(disp[T - 1]) + '»</span>)' }), bars);
      const attnCol = h('div', { class: 'gen-step__attn' }, h('div', { class: 'gen-step__lbl', text: 'Atención con este contexto (la última fila, resaltada, es la posición que predice)' }));
      const agrid = h('div', { class: 'attn-grid attn-grid--gen' });
      agrid.style.setProperty('--cols', String(Math.min(H, 4)));
      const last = k === res.steps.length - 1;
      if (eager) { buildGenAttn(agrid, st, disp); attnCol.append(agrid); }
      else {
        const det = h('details', { class: 'gen-attn', open: last }, h('summary', { class: 'gen-attn__sum' }, 'Mapas de atención (' + combos + ': ' + N + (N > 1 ? ' capas' : ' capa') + ' × ' + H + ' cabezas)'), agrid);
        let built = false;
        const build = () => { if (built) return; built = true; buildGenAttn(agrid, st, disp); };
        det.addEventListener('toggle', () => { if (det.open) build(); });
        if (last) build();
        attnCol.append(det);
      }
      const art = h('article', { class: 'panel gen-step' }, headRow, shapes, h('div', { class: 'gen-step__body' }, probsCol, attnCol));
      out.append(art);
      TL.Charts.bars(bars, st.top.map((t) => ({ key: 't' + t.id, label: t.display, value: t.p, colorVar: t.id === st.chosen ? '--fwd' : '--prob-1', highlight: t.id === st.chosen })),
        { max: 1, format: (v) => fmt(v * 100, 1) + ' %', compact: true, ariaLabel: 'Probabilidades del siguiente token' });
      // solo el rótulo lleva LaTeX: las etiquetas de las barras son tokens del corpus y no se componen
      Tex.typeset(probsCol.querySelector('.gen-step__lbl'));
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
  // Estimación (calibrada en Chrome) del tiempo de una iteración de entrenamiento: productos de
  // matrices del forward y del backward de B frases de longitud media, más un término por cabeza.
  const MAX_ITER_MS = 500;
  function estimateIterMs(o) {
    let t1 = 0, t2 = 0;
    for (const sen of o.sentences) { t1 += sen.T; t2 += sen.T * sen.T; }
    const n = Math.max(1, o.sentences.length);
    t1 /= n; t2 /= n;
    const mm = o.B * (o.N * (4 * t1 * o.d * o.d + 2 * t2 * o.d + 2 * t1 * o.d * o.dFF) + t1 * o.d * o.V);
    const heads = o.B * o.N * o.h * t2;
    return 6e-6 * (mm + 20 * heads);
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
    let hN = int('nHeads', 1, 16, 'h debe ser un entero entre 1 y 16.');
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
    // coste estimado de una iteración de entrenamiento (minilote de B frases, forward + backward):
    // si pasara de ~0.5 s, cada fotograma congelaría la página
    if (!Object.keys(e).length && tokInfo) {
      const ms = estimateIterMs({ d, h: hN, N, dFF, B, V: tokInfo.vocab.length, sentences: tokInfo.sentences });
      if (ms > MAX_ITER_MS) {
        e.batchSize = 'Esta configuración es demasiado pesada para el navegador (≈ ' + fmtInt(ms) + ' ms por iteración; el límite es ' + MAX_ITER_MS +
          ' ms). Reduce B, d, N, d_ff o la ventana T_máx.';
      }
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
        ' tokens (con <s>) · la más larga tiene ' + longest + ' tokens' + (trunc ? ' · ' + trunc + ' se recorta' + (trunc === 1 ? '' : 'n') + ' a T_máx + 1 = ' + (maxLen + 1) : '');
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
    fillForm(S.config);
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
    pt.append(h('thead', null, h('tr', null, h('th', { text: 'Símbolo' }), h('th', { text: 'Forma' }), h('th', { class: 'num', text: 'Nº' }),
      h('th', { text: 'Inicialización' }), h('th', { text: 'Descripción' }))));
    const pb = h('tbody');
    for (const name of model.order) {
      const pm = model.paramMeta[name];
      const sym = h('span');
      Tex.render(pm.tex, sym, { display: false });
      const [r, c] = pm.shape || [model.params[name].r, model.params[name].c];
      pb.append(h('tr', null, h('td', { title: 'clave interna: ' + name }, sym),
        h('td', { class: 'nowrap' }, h('span', { class: 'badge-shape', text: r + '×' + c }), ' ', h('span', { class: 'badge-shape badge-shape--sym', html: axHtml(pm.rowAxis, pm.colAxis) })),
        h('td', { class: 'num', text: fmtInt(cp.byName[name]) }), h('td', { class: 'small', text: pm.init }), h('td', { class: 'small', text: pm.desc })));
    }
    pt.append(pb, h('tfoot', null, h('tr', null, h('th', { colspan: '2', text: 'Total' }), h('th', { class: 'num', text: fmtInt(cp.total) }), h('th', { colspan: '2' }))));
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
    $('dimmap-t').textContent = rows.length + ' tensores · con T = ' + T + ' (la frase de la iteración de «Paso a paso»)';
    // tensor → primer paso de la traza que lo produce (o, si no, que lo usa)
    const producer = new Map();
    if (S.trace) {
      S.trace.steps.forEach((st, k) => { for (const o of st.outputs) if (!producer.has(o.tex)) producer.set(o.tex, k); });
      S.trace.steps.forEach((st, k) => { for (const o of st.inputs) if (!producer.has(o.tex)) producer.set(o.tex, k); });
      // la entrada normalizada de una LayerNorm (su entrada con gorro) la calcula el paso de esa LayerNorm
      S.trace.steps.forEach((st, k) => {
        if (st.kind === 'layernorm' && st.inputs[0] && !producer.has('\\hat ' + st.inputs[0].tex)) producer.set('\\hat ' + st.inputs[0].tex, k);
      });
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
        h('td', { class: 'num', text: fmtInt(r.shape[0] * r.shape[1]) }), h('td', { class: 'small', html: supBr(esc(r.desc)) }), h('td', null, go)));
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
      body.append(h('tr', null, h('td', { title: 'clave interna: ' + r.name }, sym),
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
  const mqWide = root.matchMedia ? root.matchMedia('(min-width: 1200px)') : { matches: false };
  // por debajo de 1200 px la barra de la iteración no cabe junto a los controles: iría a una segunda
  // fila de la línea de tiempo (fija), así que pasa al contenido, encima del paso
  const mqNarrow = root.matchMedia ? root.matchMedia('(max-width: 1199.98px)') : { matches: false };
  // pantallas bajas (móvil en horizontal): cabecera no fija y línea de tiempo compacta (CSS)
  const mqShort = root.matchMedia ? root.matchMedia('(max-height: 500px)') : { matches: false };
  let dgUserToggled = false;
  function placeResponsive() {
    const bar = $('iterbar');
    const target = mqNarrow.matches ? $('iterbar-slot') : $('tl-controls');
    if (bar.parentNode !== target) target.appendChild(bar);
    // ≥ 1200 px: el inspector va al pie de la columna derecha (así no tapa las matrices);
    // más estrecho: debajo del escenario (fijo al pie de la ventana entre 760 y 1199 px)
    const insp = $('inspector');
    const slot = mqWide.matches ? $('insp-slot-side') : $('paso-main');
    if (insp.parentNode !== slot) slot.appendChild(insp);
    const det = $('dg-details');
    if (!mqMobile.matches) det.open = true;
    else if (!dgUserToggled) det.open = false;
    measureChrome();
  }
  function measureChrome() {
    const hd = $('app-head'), tl = $('timeline');
    const rs = doc.documentElement.style;
    // la cabecera solo tapa contenido cuando es fija (en el móvil y en pantallas bajas no lo es)
    const headH = hd && getComputedStyle(hd).position === 'sticky' ? hd.offsetHeight : 0;
    rs.setProperty('--head-h', headH + 'px');
    rs.setProperty('--tl-h', (tl && !tl.hidden ? tl.offsetHeight : 0) + 'px');
    measureWelcome();
    measureInsp();
    layoutBands();
  }
  // el aviso de bienvenida empuja las columnas fijas hacia abajo: se descuenta solo la parte que
  // aún se ve (al desplazar la página deja de ocupar sitio)
  function measureWelcome() {
    const wl = $('welcome');
    let v = 0;
    if (wl && !wl.hidden && S.tab === 'paso') {
      const hd = $('app-head');
      const vis = wl.getBoundingClientRect().bottom - (hd ? Math.max(0, hd.getBoundingClientRect().bottom) : 0);
      v = vis > 0 ? Math.ceil(vis) + 12 : 0;
    }
    const s = v + 'px';
    if (s !== measureWelcome.last) { measureWelcome.last = s; doc.documentElement.style.setProperty('--welcome-h', s); }
  }
  // inspector fijo al pie (< 1200 px): su altura se reserva en scroll-padding-bottom (el foco del
  // teclado y la animación no quedan debajo)
  function measureInsp() {
    const ins = $('inspector');
    const v = (!mqWide.matches && ins && ins.offsetParent !== null ? ins.offsetHeight + 8 : 0) + 'px';
    if (v !== measureInsp.last) { measureInsp.last = v; doc.documentElement.style.setProperty('--insp-h', v); }
  }
  function initResponsive() {
    const det = $('dg-details');
    det.querySelector('summary').addEventListener('click', () => { dgUserToggled = true; });
    for (const mq of [mqMobile, mqWide, mqNarrow, mqShort]) {
      if (mq.addEventListener) mq.addEventListener('change', placeResponsive);
      else if (mq.addListener) mq.addListener(placeResponsive);
    }
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => measureChrome());
      ro.observe($('app-head'));
      ro.observe($('timeline'));
      ro.observe($('welcome'));
      ro.observe($('tl-bands'));
      ro.observe($('inspector'));
    } else root.addEventListener('resize', measureChrome);
    let scrollRaf = 0;
    root.addEventListener('scroll', () => {
      if (scrollRaf) return;
      scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; measureWelcome(); });
    }, { passive: true });
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
    const missing = ['Mat', 'Tokenizer', 'Model', 'Optim', 'Trainer', 'Content', 'MathTex', 'Heatmap', 'OpViews', 'Diagram', 'Charts'].filter((k) => !TL[k]);
    if (missing.length) { showFatal('Faltan módulos: ' + missing.map((k) => 'TL.' + k).join(', ') + '. Comprueba que todos los archivos js/ se cargaron.'); return; }
    applyTheme(S.theme, true);
    $('btn-theme').addEventListener('click', () => applyTheme(THEME_ORDER[(THEME_ORDER.indexOf(S.theme) + 1) % THEME_ORDER.length]));
    $('btn-guide').addEventListener('click', () => openGuide('tour', 0));
    initTabs();
    initTimeline();
    initKeys();
    initIterbar();
    initSymstrip();
    initSideTabs();
    initWelcome();
    initModal();
    initTraining();
    initGeneration();
    initDatos();
    initResponsive();
    startSession(defaultConfig());
    fillForm(S.config);
    // MathJax que llega tarde (tras el tiempo de espera): se reconstruye lo que guardaba LaTeX de respaldo
    root.addEventListener('tl:mathjax-ready', () => {
      explCache = new Map();
      S.explKey = null;
      S.datosDirty = true;
      liveSig = '';
      if (S.trace) { buildLive(); goTo(S.idx, { force: true }); }
      if (S.tab === 'datos') renderDatos();
    });
    const hash = (root.location.hash || '').slice(1);
    setTab(TABS.indexOf(hash) >= 0 ? hash : 'paso', { force: true, noHash: true, keepScroll: true });
    goToHashStep(hash);
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
      stopTraining({ noRefresh: true });
      const r = trainN(Math.max(0, n | 0));
      // evaluación completa (reutiliza lo que el refresco del panel ya midió con estos pesos)
      const ev = evalStep(Infinity);
      if (S.tab === 'entrenamiento') showEval(ev);
      return { iter: r.iter, loss: r.loss, meanLoss: ev.loss, diverged: !!S.s.diverged };
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
    // aplica ya lo que espera al siguiente fotograma (explicación del paso e inspector): para pruebas
    flush() {
      if (inspRaf) { cancelAnimationFrame(inspRaf); applyInspector(); }
      if (S.trace) {
        const st = S.trace.steps[S.idx], key = explKey(st);
        if (key !== S.explKey) {
          clearTimeout(explTimer);
          let el = explCache.get(key);
          if (!el) { el = buildExpl(st); explCache.set(key, el); }
          mountExpl(el, key);
        }
      }
    },
  };

  try { boot(); } catch (err) { showFatal(err); }
})(typeof window !== 'undefined' ? window : globalThis);
