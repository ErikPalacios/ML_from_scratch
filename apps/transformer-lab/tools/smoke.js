// Prueba de humo de la app completa (se evalúa dentro de la página con tools/browser-check.mjs):
//   node tools/browser-check.mjs --url index.html --wait 3000 --eval-file tools/smoke.js
//   (o sobre dist/transformer-lab.html). Devuelve un resumen JSON y lanza un error si algo falla.
// Recorre TODOS los pasos de la traza en varias configuraciones y, en cada uno, comprueba: sin
// excepciones, escenario con contenido, fórmula y dimensiones compuestas, explicación sin
// marcadores sin rellenar, inspector al pasar por 2–3 celdas de la salida y bloque activo en el
// diagrama. Después entrena, genera, comprueba gradientes, cambia pestañas y tema, y mira el
// desbordamiento horizontal a 390 px (en un iframe de ese ancho).
// Regresiones de la revisión: «Animar» deja a la vista lo que se anima (1440 y 1024 px), la
// reproducción anima los pasos, el inspector se ve al tocar una celda en el móvil, el foco del
// teclado no queda bajo el inspector ni la línea de tiempo (1024 px), la validación rechaza
// configuraciones que congelarían la página, «Máxima» no arrastra su ritmo de un modelo a otro,
// una divergencia se detecta y se explica, y las fórmulas no son paradas de tabulación.
(async () => {
  const T0 = performance.now();
  const A = TL.App, S = A.state;
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  const fails = [];
  const errors = [];
  const fail = (where, msg) => { if (fails.length < 200) fails.push(where + ': ' + msg); };
  const check = (cond, where, msg) => { if (!cond) fail(where, msg); return !!cond; };

  // errores de la página durante la prueba
  const origErr = console.error;
  console.error = function () { errors.push(Array.from(arguments).map((a) => (a && a.stack) || String(a)).join(' ')); return origErr.apply(this, arguments); };
  // los módulos de la vista avisan con console.warn cuando recurren a un respaldo: también cuenta como fallo
  const origWarn = console.warn;
  console.warn = function () { const m = Array.from(arguments).map((a) => (a && a.stack) || String(a)).join(' '); if (/OpViews|falló|error/i.test(m)) errors.push('aviso: ' + m); return origWarn.apply(this, arguments); };
  const onErr = (e) => errors.push('error: ' + (e.message || e));
  const onRej = (e) => errors.push('promesa rechazada: ' + ((e.reason && e.reason.message) || e.reason));
  window.addEventListener('error', onErr);
  window.addEventListener('unhandledrejection', onRej);

  const mj = await TL.MathTex.ready;
  const PH = /\{(T|d|h|dk|dff|V|N|l|hd|lr)\}/;
  const DEF = {
    corpus: TL.Trainer.DEFAULT_CORPUS, tokMode: 'word',
    cfg: { dModel: 8, nHeads: 2, nLayers: 1, dFF: 32, maxLen: 8, activation: 'relu', posEnc: 'sinusoidal', seed: 42 },
    hp: { type: 'adam', lr: 0.01, clip: 1 }, batchSize: 4,
  };
  const mk = (o) => ({
    corpus: o.corpus || DEF.corpus, tokMode: o.tokMode || DEF.tokMode,
    cfg: Object.assign({}, DEF.cfg, o.cfg || {}), hp: Object.assign({}, DEF.hp, o.hp || {}), batchSize: o.batchSize || DEF.batchSize,
  });
  const CONFIGS = [
    { name: 'por defecto', c: mk({}) },
    { name: '2 capas · 4 cabezas · GELU · PE aprendida', c: mk({ cfg: { nLayers: 2, nHeads: 4, activation: 'gelu', posEnc: 'learned' } }) },
    { name: 'caracteres', c: mk({ tokMode: 'char' }) },
    { name: 'SGD con recorte', c: mk({ hp: { type: 'sgd', lr: 0.1, clip: 0.5 } }) },
    { name: '1 cabeza', c: mk({ cfg: { nHeads: 1 } }) },
  ];

  // ---- comprobaciones de fórmulas compuestas por MathJax
  // fórmula rota: error de MathJax, código LaTeX de respaldo, marcador provisional (macro que MathJax
  // carga bajo demanda, p. ej. \boldsymbol) o macro desconocida (noundefined la dibuja en rojo)
  const MJ_BAD = '[data-mjx-error], merror, [data-mml-node="merror"], .tex-fallback, .tex-retry, [fill="red"]';
  const MJ_BAD_RE = /tex-fallback|tex-retry|fill="red"|data-mjx-error|merror/;
  function texOK(el, where, what) {
    if (!check(el && el.innerHTML.trim().length > 0, where, what + ' vacío')) return;
    if (mj) {
      check(el.querySelector('mjx-container'), where, what + ' sin componer');
      check(!el.querySelector(MJ_BAD), where, what + ' con error de MathJax');
    }
  }
  // todas las fórmulas del contenido (explicaciones con sus marcadores rellenos, derivaciones,
  // recorrido, notación y símbolos) se componen sin error a la primera
  function contentTex() {
    const C = TL.Content, bad = [];
    const vals = { T: 5, d: 8, h: 2, dk: 4, dff: 32, V: 22, N: 1, l: 1, hd: 1, lr: 0.01 };
    let n = 0;
    const test = (tex, display, where) => {
      n++;
      if (MJ_BAD_RE.test(TL.MathTex.toHTML(tex, display))) bad.push(where + ': ' + String(tex).slice(0, 90));
    };
    const scan = (html, where) => {
      const parts = TL.MathTex._splitMath(String(html || ''));
      if (!parts) { bad.push(where + ': delimitador LaTeX sin cerrar'); return; }
      for (const p of parts) if (p.tex !== undefined) test(p.tex, p.display, where);
    };
    for (const id in C.steps) {
      const c = C.steps[id];
      for (const k of ['title', 'summary', 'intuition', 'shapes', 'details']) if (typeof c[k] === 'string') scan(C.fill(c[k], vals), id + '.' + k);
      for (const m of c.math || []) test(C.fill(m, vals), true, id + '.math');
    }
    for (const id in C.derivations || {}) scan(C.derivations[id].html, 'derivación ' + id);
    (C.tour || []).forEach((t, k) => scan(t.html, 'recorrido ' + (k + 1)));
    for (const x of C.notation || []) test(x.tex, false, 'notación');
    for (const x of C.symbols || []) if (x.tex) test(x.tex, false, 'símbolo ' + x.sym);
    return { n, bad };
  }
  // texto visible sin el código LaTeX de respaldo (sin MathJax, «\\mathrm{d}» contiene «{d}» y no es un marcador)
  function plainText(el) {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement && n.parentElement.closest('.tex-fallback, .tex-pending, .tex-lite, mjx-container') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    let t = '', n;
    while ((n = w.nextNode())) t += n.nodeValue;
    return t;
  }
  // celdas representativas de un mapa
  const cellsOf = (hm) => {
    const R = hm.R, C = hm.C;
    const out = [[0, 0], [R - 1, C - 1], [Math.floor(R / 2), Math.floor(C / 2)]];
    return out.filter((p, k) => out.findIndex((q) => q[0] === p[0] && q[1] === p[1]) === k);
  };

  // ---- un paso
  function checkStep(cfgName, i, stat) {
    const t0 = performance.now();
    let sum;
    try { sum = A.goToStep(i); A.flush(); } catch (e) { fail(cfgName + ' · paso ' + (i + 1), 'excepción: ' + e.message); return; }
    stat.ms.push(performance.now() - t0);
    const st = A.getStep();
    const W = cfgName + ' · paso ' + (i + 1) + ' (' + st.id + ')';
    const n = S.trace.steps.length;
    check(sum && sum.index === i, W, 'goToStep no devolvió el índice');
    // cabecera: fase, contador, título, fórmula y dimensiones (numéricas y simbólicas)
    check($('step-count').textContent === 'Paso ' + (i + 1) + ' / ' + n, W, 'contador incorrecto: ' + $('step-count').textContent);
    check($('step-title').textContent.trim().length > 2, W, 'sin título');
    check($('step-chip').textContent.trim().length > 0, W, 'sin chip de fase');
    texOK($('step-formula'), W, 'fórmula');
    texOK($('step-dimsym'), W, 'dimensiones simbólicas');
    texOK($('step-dims'), W, 'dimensiones numéricas');
    // escenario
    const stage = $('stage');
    check(stage.querySelector('.ov'), W, 'el escenario no tiene vista');
    check(stage.textContent.trim().length > 20, W, 'escenario casi vacío');
    if (st.outputs.length) check(stage.querySelectorAll('.hm').length >= 1, W, 'sin mapas de calor');
    const stTxt = plainText(stage);
    check(!/\{(T|d|h|dk|dff|V|N)\}|undefined|NaN/.test(stTxt), W, 'texto sospechoso en el escenario: ' + ((stTxt.match(/.{0,30}(\{(T|d|h|dk|dff|V|N)\}|undefined|NaN).{0,30}/) || [''])[0]));
    // el superíndice de capa se escribe [l], como en las fórmulas (no ⁽l⁾)
    check(!/[⁽⁾]/.test(stTxt), W, 'superíndice de capa entre paréntesis en el escenario: ' + ((stTxt.match(/.{0,30}[⁽⁾].{0,10}/) || [''])[0]));
    if (mj) check(!stage.querySelector(MJ_BAD), W, 'fórmula rota en el escenario');
    // en escritorio ninguna matriz debe necesitar desplazamiento propio (en «auto» se ajustan al ancho)
    if (innerWidth >= 1200) {
      for (const sc of stage.querySelectorAll('.hm__scroll')) {
        const d = sc.scrollWidth - sc.clientWidth;
        if (d > 1) { fail(W, 'un mapa de calor desborda su caja en ' + d + ' px'); break; }
      }
    }
    // explicación
    const ex = $('expl').querySelector('.expl');
    if (check(ex, W, 'sin explicación')) {
      const txt = plainText(ex);
      check(txt.length > 120, W, 'explicación demasiado corta');
      check(!PH.test(txt), W, 'marcador sin rellenar en la explicación: ' + (txt.match(PH) || [''])[0]);
      check(S.explKey && S.explKey.split('|')[0] === st.tpl, W, 'la explicación no es la del paso');
      if (mj) {
        const prose = Array.from(ex.querySelectorAll('.prose')).map((p) => p.textContent).join(' ');
        check(!/\\\(|\\\[/.test(prose), W, 'delimitadores LaTeX sin componer en la explicación');
        const bad = ex.querySelector(MJ_BAD);
        check(!bad, W, 'fórmula rota en la explicación: ' + (bad ? (bad.closest('[data-tex]') || bad).getAttribute('data-tex') || bad.textContent.slice(0, 60) : ''));
      }
    }
    // inspector: 2–3 celdas de la salida
    const view = S.view;
    if (st.kind === 'gradnorm') {
      const rows = stage.querySelectorAll('.chart-bars__row');
      check(rows.length > 0, W, 'sin barras de normas');
      for (const r of Array.from(rows).slice(0, 3)) {
        r.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        A.flush();
        stat.hovers++;
        check($('inspector-body').querySelector('.insp'), W, 'la barra no produjo inspector');
      }
    } else if (check(view && view.heatmaps && view.heatmaps.length, W, 'la vista no expone mapas')) {
      let outs = view.heatmaps.filter((hm) => st.outputs.some((o) => o.tex === hm.ref.tex));
      if (!outs.length) outs = view.heatmaps.slice(-1);
      const hm = outs[0];
      for (const [r, c] of cellsOf(hm)) {
        A.flush(); // vacía cualquier pendiente
        $('inspector-body').innerHTML = '';
        hm.hover(r, c);
        A.flush();
        stat.hovers++;
        const b = $('inspector-body');
        const where = W + ' · celda (' + r + ',' + c + ') de ' + hm.ref.key;
        if (check(b.querySelector('.insp') && b.innerHTML.length > 60, where, 'el inspector quedó vacío')) {
          const bt = plainText(b);
          check(!PH.test(bt), where, 'marcador sin rellenar en el inspector');
          check(!/undefined|NaN/.test(bt), where, 'texto sospechoso en el inspector: ' + bt.slice(0, 120));
          if (mj) {
            for (const tx of b.querySelectorAll('.insp__tex')) check(tx.querySelector('mjx-container'), where, 'la fórmula del inspector no se compuso');
            check(!/\\\(|\\\[/.test(b.textContent), where, 'delimitadores LaTeX sin componer en el inspector');
            check(!b.querySelector(MJ_BAD), where, 'fórmula rota en el inspector');
          }
        }
      }
    }
    // diagrama: bloque activo y etiquetas de forma
    const host = $('dg-host');
    check(host.querySelector('.dg-node.is-active'), W, 'ningún bloque activo en el diagrama');
    check(host.querySelectorAll('.dg-shapes text').length >= 8, W, 'faltan etiquetas de forma en el diagrama');
    if (i === 0) check(!Array.from(host.querySelectorAll('.dg-shapes title')).some((t) => /[{}\\]/.test(t.textContent)), W, 'tooltip de forma con LaTeX sin componer');
    // línea de tiempo
    const cur = $('tl-ticks').querySelectorAll('.tl-tick.is-cur');
    check(cur.length === 1 && Array.prototype.indexOf.call($('tl-ticks').children, cur[0]) === i, W, 'la línea de tiempo no marca el paso');
  }

  async function runConfig(cf) {
    const res = A.applyConfig(cf.c);
    if (!check(res.ok, cf.name, 'applyConfig falló: ' + JSON.stringify(res.errors))) return { name: cf.name, ok: false };
    A.setTab('paso');
    await frame();
    const n = S.trace.steps.length;
    const stat = { ms: [], hovers: 0 };
    for (let i = 0; i < n; i++) {
      checkStep(cf.name, i, stat);
      if (i % 40 === 39) await sleep(0); // deja respirar al navegador
    }
    // animación interrumpida por un cambio de paso (debe resolverse sin errores)
    const mm = S.trace.steps.findIndex((s) => s.kind === 'matmul');
    A.goToStep(mm);
    const p = S.view.animate();
    await sleep(40);
    A.goToStep(mm + 1);
    const done = await Promise.race([p.then(() => true), sleep(1500).then(() => false)]);
    check(done, cf.name, 'animate() no terminó al destruir la vista');
    const ms = stat.ms;
    return {
      name: cf.name, steps: n, V: S.s.tok.vocab.length, T: S.trace.T, hovers: stat.hovers,
      avgStepMs: +(ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(1), maxStepMs: +Math.max.apply(null, ms).toFixed(1),
    };
  }


  // ---- utilidades para las regresiones de visibilidad
  // franja visible de una ventana: sin la cabecera fija, la línea de tiempo ni el inspector fijo al pie
  const bandOf = (w) => {
    const d = w.document;
    const hd = d.getElementById('app-head').getBoundingClientRect();
    const top = Math.max(0, hd.bottom);
    let bottom = w.innerHeight;
    const tl = d.getElementById('timeline');
    if (!tl.hidden) bottom = Math.min(bottom, tl.getBoundingClientRect().top);
    if (w.innerWidth < 1200) {
      const ins = d.getElementById('inspector').getBoundingClientRect();
      if (ins.height && ins.top > top && ins.top < bottom) bottom = ins.top;
    }
    return { top, bottom };
  };
  // tras pulsar «Animar»: las matrices que se están rellenando deben verse (con 2 px de tolerancia)
  async function animVisible(w, B, id, where) {
    const d = w.document;
    const i = B.getTrace().steps.findIndex((x) => x.id === id);
    if (!check(i >= 0, where, 'no existe el paso ' + id)) return;
    B.goToStep(i); B.flush();
    w.scrollTo(0, 0);
    await sleep(50);
    d.getElementById('btn-animate').click();
    await sleep(1500); // desplazamiento suave
    const hms = B.state.view.heatmaps.filter((h) => h._revealed !== Infinity);
    if (!check(hms.length, where + ' · ' + id, 'no hay ninguna matriz animándose')) return;
    const rs = hms.map((h) => h.el.getBoundingClientRect());
    const top = Math.min.apply(null, rs.map((r) => r.top)), bottom = Math.max.apply(null, rs.map((r) => r.bottom));
    const b = bandOf(w);
    const fits = bottom - top <= b.bottom - b.top;
    check(fits ? top >= b.top - 2 && bottom <= b.bottom + 2 : top < b.bottom && bottom > b.top, where + ' · ' + id,
      'lo que se anima (' + Math.round(top) + '…' + Math.round(bottom) + ' px) queda fuera de la franja visible (' + Math.round(b.top) + '…' + Math.round(b.bottom) + ' px)');
    // la salida que se rellena se ve entera si cabe (antes, con LayerNorm, quedaba bajo la línea de tiempo)
    const st = B.getStep();
    for (const h of hms.filter((x) => st.outputs.some((o) => o.tex === x.ref.tex))) {
      const r = h.el.getBoundingClientRect();
      if (r.height <= b.bottom - b.top - 4) {
        check(r.top >= b.top - 2 && r.bottom <= b.bottom + 2, where + ' · ' + id, 'la salida ' + h.ref.key + ' (' + Math.round(r.top) + '…' + Math.round(r.bottom) +
          ' px) no se ve entera en la franja visible (' + Math.round(b.top) + '…' + Math.round(b.bottom) + ' px)');
      }
    }
    B.state.view.stop && B.state.view.stop();
  }
  const loadFrame = async (width, height) => {
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;left:0;top:0;width:' + width + 'px;height:' + height + 'px;border:0;opacity:0;pointer-events:none';
    f.src = location.href.split('#')[0];
    document.body.appendChild(f);
    await new Promise((r) => { f.onload = r; });
    const w = f.contentWindow;
    for (let k = 0; k < 100 && !(w.TL && w.TL.App && w.TL.App.state.ready); k++) await sleep(50);
    await w.TL.MathTex.ready;
    try { w.localStorage.setItem('tl.welcomeDismissed', 'true'); } catch (e) { /* nada */ }
    const wl = w.document.getElementById('welcome'); if (wl) wl.hidden = true;
    return f;
  };

  const summary = { mathjax: mj, configs: [] };
  if (mj) {
    const ct = contentTex();
    summary.contentTex = ct.n;
    for (const b of ct.bad.slice(0, 20)) fail('contenido', 'fórmula que no se compone a la primera: ' + b);
  }
  for (const cf of CONFIGS) {
    summary.configs.push(await runConfig(cf));
    console.log('[smoke] ' + cf.name + ' → ' + JSON.stringify(summary.configs[summary.configs.length - 1]));
  }

  // ---- de vuelta a la configuración por defecto: interacción, entrenamiento, generación, gradientes
  A.applyConfig(CONFIGS[0].c);
  A.setTab('paso');
  await frame();
  {
    const W = 'interacción';
    // teclado
    A.goToStep(3);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    check(S.idx === 4, W, '→ no avanzó');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    check(S.idx === S.trace.steps.length - 1, W, 'Fin no fue al último paso');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    check(S.idx === 0, W, 'Inicio no fue al primer paso');
    // clic en un bloque del diagrama
    const node = $('dg-host').querySelector('.dg-node[data-block="L0.ffn1"]');
    if (check(node, W, 'no existe el bloque L0.ffn1')) {
      node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      check(A.getStep().block === 'L0.ffn1', W, 'el clic en el diagrama no llevó al bloque (' + A.getStep().block + ')');
    }
    // botón «Números: auto → todos → no → auto»
    A.goToStep(S.trace.steps.findIndex((x) => x.id === 'upd.param.E'));
    if (S.showValues !== 'auto') { while (S.showValues !== 'auto') $('btn-values').click(); await frame(); }
    const nv = () => $('stage').querySelectorAll('.hm--vals').length;
    const nAuto = nv(), nAll = $('stage').querySelectorAll('.hm').length;
    $('btn-values').click(); await frame(); await frame();
    check(S.showValues === 'todos' && nv() === nAll, W, '«Números: todos» no muestra números en todas las matrices (' + nv() + ' de ' + nAll + ')');
    $('btn-values').click(); await frame(); await frame();
    check(S.showValues === 'no' && nv() === 0, W, '«Números: no» sigue mostrando números');
    $('btn-values').click(); await frame(); await frame();
    check(S.showValues === 'auto' && nv() === nAuto, W, '«Números: auto» no restauró el estado inicial');
    check(nAuto < nAll, W, 'en el paso de Adam de E, «auto» debería dejar alguna matriz grande solo con color');
    // nueva iteración: misma longitud, iteración +1
    const it0 = S.trace.iter;
    const r = A.newIteration();
    check(r.iter === it0 + 1 && r.steps === S.trace.steps.length, W, 'Nueva iteración no avanzó la iteración');
  }
  {
    const W = 'entrenamiento';
    const before = TL.Trainer.evaluate(S.s).loss;
    const t0 = performance.now();
    const r = A.train(300);
    summary.training = { lossBefore: +before.toFixed(4), lossAfter: +r.meanLoss.toFixed(4), iter: r.iter, ms: Math.round(performance.now() - t0) };
    check(r.meanLoss < before * 0.6, W, 'la pérdida no bajó lo suficiente: ' + before.toFixed(3) + ' → ' + r.meanLoss.toFixed(3));
  }
  {
    const W = 'generación';
    A.setTab('generacion');
    await frame();
    const g = A.generate('el gato come', { greedy: true, maxNew: 5 });
    summary.generation = { prompt: 'el gato come', text: g.text, generated: g.generated };
    if (check(g.ok, W, 'falló: ' + g.error)) {
      check(g.generated[0] === 'pescado', W, 'se esperaba «pescado», salió «' + g.generated[0] + '»');
      check($('gen-result').querySelectorAll('.gen-step').length === g.steps, W, 'no se dibujaron todos los pasos');
      check($('gen-result').querySelectorAll('.hm').length === g.steps * S.s.cfg.nLayers * S.s.cfg.nHeads, W, 'faltan mapas de atención');
    }
    const bad = A.generate('el dragón come', {});
    check(!bad.ok && /dragón/.test(bad.error || ''), W, 'una palabra desconocida debería dar un error en español');
    check(!$('gen-error').hidden, W, 'el error no se muestra');
    A.generate('el gato', {});
  }
  {
    const W = 'gradientes';
    A.setTab('datos');
    await frame();
    const gc = A.gradCheck();
    summary.gradCheck = { n: gc.n, ok: gc.ok, worstRelErr: gc.worst };
    check(gc.n > 0 && gc.ok === gc.n, W, gc.ok + ' de ' + gc.n + ' coinciden (peor error relativo ' + gc.worst + ')');
    check($('gc-table').querySelectorAll('tbody tr').length === gc.n, W, 'tabla incompleta');
  }
  // ---- pestañas
  summary.tabs = {};
  for (const t of ['paso', 'entrenamiento', 'generacion', 'datos']) {
    const W = 'pestaña ' + t;
    A.setTab(t);
    await frame(); await frame();
    const panel = $('panel-' + t);
    check(!panel.hidden, W, 'panel oculto');
    for (const o of ['paso', 'entrenamiento', 'generacion', 'datos']) if (o !== t) check($('panel-' + o).hidden, W, 'el panel ' + o + ' sigue visible');
    check($('tab-' + t).getAttribute('aria-selected') === 'true', W, 'pestaña no marcada');
    check(panel.offsetHeight > 300, W, 'panel casi vacío (' + panel.offsetHeight + ' px)');
    check($('timeline').hidden === (t !== 'paso'), W, 'la línea de tiempo no sigue a la pestaña');
    summary.tabs[t] = panel.offsetHeight;
  }
  {
    const W = 'pestaña entrenamiento (contenido)';
    A.setTab('entrenamiento');
    await frame();
    const nA = S.s.cfg.nLayers * S.s.cfg.nHeads;
    check($('tr-attn').querySelectorAll('.hm').length === nA, W, 'mapas de atención: ' + $('tr-attn').querySelectorAll('.hm').length + ' en vez de ' + nA);
    check($('tr-pred').querySelectorAll('tbody tr').length === S.s.tok.sentences[S.attnSent || 0].T, W, 'tabla de predicciones incompleta');
    check($('tr-sent-bars').querySelectorAll('.chart-bars__row').length === S.s.tok.sentences.length, W, 'faltan barras por frase');
    check($('tr-grad-bars').querySelectorAll('.chart-bars__row').length === S.s.model.order.length, W, 'faltan barras de gradiente');
  }
  {
    const W = 'pestaña datos (contenido)';
    A.setTab('datos');
    await frame();
    check($('dimmap-table').querySelectorAll('.dimmap__row').length > 100, W, 'mapa de dimensiones incompleto');
    check($('params-table').querySelectorAll('tbody tr').length === S.s.model.order.length, W, 'inventario de parámetros incompleto');
    check($('vocab-list').children.length === S.s.tok.vocab.length, W, 'vocabulario incompleto');
  }
  // ---- tema
  {
    const W = 'tema';
    A.setTab('paso');
    A.goToStep(16);
    await frame();
    const cellBg = () => { const c = $('stage').querySelector('.hm__c'); return c ? getComputedStyle(c).backgroundColor : ''; };
    const initial = S.theme;
    A.setTheme('dark');
    await frame(); await frame();
    const bgD = getComputedStyle(document.body).backgroundColor, cD = cellBg();
    A.setTheme('light');
    await frame(); await frame();
    const bgL = getComputedStyle(document.body).backgroundColor, cL = cellBg();
    check(bgD === 'rgb(14, 20, 26)', W, 'fondo oscuro inesperado: ' + bgD);
    check(bgL === 'rgb(236, 239, 242)', W, 'fondo claro inesperado: ' + bgL);
    check(cD && cL && cD !== cL, W, 'los mapas de calor no se recolorean con el tema');
    A.setTheme(initial);
    summary.theme = { dark: bgD, light: bgL };
  }


  // ---- regresiones de la revisión (1440 px)
  {
    const W = 'regresiones 1440';
    A.applyConfig(CONFIGS[0].c);
    A.setTab('paso');
    await frame();
    const wl = $('welcome'); const wlHidden = wl.hidden; wl.hidden = true;
    // «Animar» desplaza la página hasta lo que se anima (antes, el resultado quedaba bajo la línea de tiempo)
    for (const id of ['fwd.L0.attn.q', 'fwd.L0.ln1', 'fwd.L0.attn.h0.softmax', 'loss.ce', 'bwd.lnf', 'upd.param.L0.W1']) await animVisible(window, A, id, W);
    // la reproducción automática anima cada paso y avanza
    A.goToStep(3);
    document.querySelector('#tl-speed [data-speed="4"]').click();
    let animSeen = false;
    A.play();
    const t0 = performance.now();
    while (performance.now() - t0 < 2500) { if (document.querySelector('.ov.is-animating')) animSeen = true; await sleep(60); }
    const moved = S.idx > 3;
    A.pause();
    document.querySelector('#tl-speed [data-speed="1"]').click();
    check(animSeen && moved, W, 'la reproducción no anima los pasos (animación: ' + animSeen + ', avanzó: ' + moved + ')');
    check(!S.playing && S.view.heatmaps.every((h) => h._revealed === Infinity), W, '«Pausa» no detuvo la animación en curso');
    // Espacio mantenido (autorrepetición) no alterna la reproducción
    A.goToStep(0);
    for (let k = 0; k < 5; k++) document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', repeat: k > 0, bubbles: true }));
    check(S.playing, W, 'mantener Espacio alterna la reproducción');
    A.pause();
    // las fórmulas no son paradas de tabulación (menú de MathJax)
    if (mj) check(!document.querySelector('mjx-container[tabindex="0"]'), W, 'hay fórmulas con tabindex=0');
    // la explicación usa el η de la traza aunque luego se cambie en «Entrenamiento»
    A.setTab('entrenamiento'); $('tr-lr').value = '0.05'; $('tr-lr').dispatchEvent(new Event('change')); A.setTab('paso');
    A.goToStep(S.trace.steps.findIndex((x) => x.id === 'upd.param.E')); A.flush();
    check(/η = 0\.01\b/.test($('expl').textContent) && !$('stale-note').hidden, W, 'tras cambiar η, la explicación no sigue a la traza o falta el aviso');
    wl.hidden = wlHidden;
    A.applyConfig(CONFIGS[0].c);
  }
  // ---- configuraciones que congelarían la página: la validación las rechaza
  {
    const W = 'validación de coste';
    const lines = (n, words, vocab) => { const o = []; let k = 0; for (let i = 0; i < n; i++) { const w = []; for (let j = 0; j < words; j++) w.push('w' + ((k++) % vocab)); o.push(w.join(' ') + ' .'); } return o.join('\n'); };
    const big = A.applyConfig({ corpus: lines(200, 40, 390), cfg: { dModel: 64, nHeads: 16, nLayers: 3, dFF: 256, maxLen: 32 }, batchSize: 64 });
    check(!big.ok && /demasiado pesada/.test(big.errors.batchSize || ''), W, 'la configuración máxima no se rechazó: ' + JSON.stringify(big.errors || {}));
    // «Máxima» no arrastra su ritmo de un modelo pequeño a uno mayor (antes: un primer fotograma de varios segundos)
    A.applyConfig({ corpus: 'a', cfg: { dModel: 2, nHeads: 1, nLayers: 1, dFF: 1, maxLen: 2 }, batchSize: 1 });
    A.setTab('entrenamiento');
    document.querySelector('#tr-speed [data-speed="maxima"]').click();
    $('tr-run').click();
    await sleep(600);
    $('tr-run').click();
    const med = A.applyConfig({ corpus: lines(200, 20, 300), cfg: { dModel: 32, nHeads: 4, nLayers: 2, dFF: 64, maxLen: 16 }, batchSize: 8 });
    check(med.ok, W, 'una configuración mediana se rechazó: ' + JSON.stringify(med.errors));
    A.setTab('entrenamiento');
    await frame();
    const gaps = [];
    $('tr-run').click();
    await new Promise((res) => { let last = performance.now(); const t0 = last; const f = (t) => { gaps.push(t - last); last = t; if (t - t0 < 800) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    const tp = performance.now();
    $('tr-run').click();
    const pauseMs = performance.now() - tp;
    document.querySelector('#tr-speed [data-speed="media"]').click();
    const worst = Math.max.apply(null, gaps);
    summary.trainFrames = { worstMs: Math.round(worst), pauseMs: Math.round(pauseMs) };
    check(worst < 600, W, 'con «Máxima», un fotograma tardó ' + Math.round(worst) + ' ms');
    check(pauseMs < 400, W, '«Pausa» tardó ' + Math.round(pauseMs) + ' ms');
    // generación con muchos mapas de atención: solo se construyen los del último paso
    A.applyConfig({ corpus: CONFIGS[0].c.corpus, cfg: { nLayers: 2, nHeads: 4 } });
    A.setTab('generacion');
    const g = A.generate('el gato', { greedy: false, temperature: 2, maxNew: 30, seed: 3 });
    const nh = $('gen-result').querySelectorAll('.hm').length;
    check(g.ok && nh <= 8, W, 'la generación construyó ' + nh + ' mapas de atención (máximo 8 a la vista)');
    // divergencia: se detecta, se detiene y se explica (antes: pérdida «finita» de 690.78 y «sin gradientes»)
    A.applyConfig({ corpus: CONFIGS[0].c.corpus, cfg: { nLayers: 1, nHeads: 2 }, hp: { type: 'sgd', lr: 5, clip: 0 } });
    A.setTab('entrenamiento');
    const dv = A.train(600);
    check(dv.diverged && dv.iter < 600 && !$('tr-diverged').hidden, W, 'la divergencia no se detectó (iteración ' + dv.iter + ')');
    check(!/e\+\d/.test($('st-ppl').textContent), W, 'la perplejidad desborda su casilla: ' + $('st-ppl').textContent);
    // tras divergir no se recorren (ni actualizan) más iteraciones, y «Paso a paso» lo explica
    A.setTab('paso');
    const itD = S.s.iter;
    const nd = A.newIteration();
    check(nd.diverged && S.s.iter === itD && !$('stale-note').hidden && /divergió/.test($('stale-text').textContent), W,
      'con el entrenamiento divergido, «Nueva iteración» siguió actualizando (iteración ' + itD + ' → ' + S.s.iter + ') o no se explicó');
    // una pérdida enorme pero finita no es divergencia (Adam se recupera): antes se detenía en la iteración 3-4
    A.applyConfig({ corpus: CONFIGS[0].c.corpus, cfg: { nLayers: 1, nHeads: 2 }, hp: { type: 'adam', lr: 5, clip: 0 } });
    const ad = A.train(200);
    check(!ad.diverged && Number.isFinite(ad.loss), W, 'Adam con η = 5 se dio por divergido con pérdida finita (iteración ' + ad.iter + ')');
    A.applyConfig(CONFIGS[0].c);
    A.setTab('paso');
  }
  // ---- regresiones de la 2.ª revisión (1440 px)
  {
    const W = 'regresiones 2';
    A.applyConfig(CONFIGS[0].c);
    A.setTab('paso');
    await frame();
    const wl = $('welcome'); const wlHidden = wl.hidden; wl.hidden = true;
    const inBand = (el) => { if (!el) return false; const r = el.getBoundingClientRect(), b = bandOf(window); return r.top >= b.top - 2 && r.bottom <= b.bottom + 2; };
    const last = S.trace.steps.length - 1;
    // «Animar» en el último paso: al terminar, el resumen de la iteración vuelve a la vista
    A.goToStep(last); A.flush(); scrollTo(0, 0);
    $('btn-animate').click();
    await sleep(700);
    S.view.stop();
    await sleep(1100);
    const rc = $('stage').querySelector('.ov-recap');
    check(inBand(rc), W, 'tras animar el último paso, el resumen de la iteración no queda a la vista');
    check(rc && /han cambiado \d/.test(rc.textContent), W, 'el resumen no distingue los números que no cambiaron: ' + (rc ? rc.textContent.slice(0, 120) : ''));
    // la reproducción termina con el resumen a la vista y el foco en «Nueva iteración»
    scrollTo(0, 0);
    A.goToStep(last - 1);
    document.querySelector('#tl-speed [data-speed="4"]').click();
    A.play();
    let t0 = performance.now();
    while (S.playing && performance.now() - t0 < 12000) await sleep(80);
    await sleep(900);
    const rc2 = $('stage').querySelector('.ov-recap');
    check(!S.playing && inBand(rc2) && document.activeElement && !!document.activeElement.closest('.ov-recap'), W,
      'al acabar la reproducción el resumen no está a la vista o el foco no está en «Nueva iteración» (' + (document.activeElement && document.activeElement.tagName) + ')');
    // cambiar de velocidad durante la reproducción se nota ya (antes: al acabar la animación en curso)
    document.querySelector('#tl-speed [data-speed="0.5"]').click();
    A.goToStep(3);
    A.play();
    await sleep(800);
    t0 = performance.now();
    document.querySelector('#tl-speed [data-speed="4"]').click();
    while (S.idx === 3 && performance.now() - t0 < 6000) await sleep(20);
    const adv = performance.now() - t0;
    A.pause();
    document.querySelector('#tl-speed [data-speed="1"]').click();
    check(adv < 1500, W, 'tras pasar de 0.5× a 4×, el paso siguiente tardó ' + Math.round(adv) + ' ms');
    // las celdas −∞ pendientes de la animación no se ven antes de tiempo
    A.goToStep(S.trace.steps.findIndex((x) => x.id === 'fwd.L0.attn.h0.mask')); A.flush();
    const pm = S.view.animate();
    await sleep(60);
    const early = Array.from($('stage').querySelectorAll('.hm__c.is-pending .hm__ninf')).filter((e) => getComputedStyle(e).visibility !== 'hidden').length;
    S.view.stop(); await pm;
    check(!early, W, early + ' celdas −∞ se ven antes de que la animación llegue a ellas');
    // la etiqueta «del forward · paso N» lleva a ese paso y deja el foco en su título
    const tagStep = S.trace.steps.findIndex((x) => x.id === 'bwd.logits.dW');
    A.goToStep(tagStep); A.flush();
    const tag = $('stage').querySelector('.hm__tag--btn');
    if (check(tag, W, 'sin etiqueta «del forward» en ' + S.trace.steps[tagStep].id)) {
      tag.click();
      check(S.idx < tagStep && document.activeElement === $('step-title'), W, 'la etiqueta «del forward» no llevó al paso o dejó el foco en ' + document.activeElement.tagName);
    }
    // la nota de la atención describe la fila que muestra (en la frase 5, «la» → «casa»; no «el verbo»)
    A.newIteration(4);
    A.goToStep(S.trace.steps.findIndex((x) => x.id === 'fwd.L0.attn.h0.softmax')); A.flush();
    const an = $('stage').querySelector('.ov-note--attn');
    check(an && /la fila de «la» \(posición 5, que debe predecir «casa»\)/.test(an.textContent), W, 'la nota de la atención no describe la fila que muestra: ' + (an ? an.textContent.slice(0, 120) : ''));
    // símbolo B: su descripción sigue al minilote de «Entrenamiento»
    A.setTab('entrenamiento');
    $('tr-batch').value = '8'; $('tr-batch').dispatchEvent(new Event('change'));
    const symB = Array.from(document.querySelectorAll('#symstrip .sym')).map((x) => x.getAttribute('aria-label')).find((x) => /^B /.test(x || '')) || '';
    check(/B = 8 frases/.test(symB), W, 'la descripción de B no se actualizó: ' + symB);
    // un clic en un símbolo muestra el tooltip de ESE símbolo (antes, el de T)
    A.setTab('paso');
    const strip = $('symstrip');
    const dff = Array.from(strip.querySelectorAll('.sym')).find((x) => /^d_ff/.test(x.getAttribute('aria-label') || ''));
    if (check(dff, W, 'no está el símbolo d_ff')) {
      strip.blur();
      dff.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      strip.focus();
      await frame();
      const tip = document.querySelector('.chart-tip');
      check(tip && /FFN/.test(tip.textContent), W, 'al pulsar d_ff se mostró otro símbolo: ' + (tip ? tip.textContent.slice(0, 60) : '—'));
      strip.blur();
    }
    wl.hidden = wlHidden;
    A.applyConfig(CONFIGS[0].c);
  }
  // ---- un modelo pesado (pero admitido): entrenar no congela la página; el minilote respeta el límite
  {
    const W = 'modelo pesado';
    const lines = (n, words, vocab) => { const o = []; let k = 0; for (let i = 0; i < n; i++) { const w = []; for (let j = 0; j < words; j++) w.push('w' + ((k++) % vocab)); o.push(w.join(' ') + ' .'); } return o.join('\n'); };
    const hv = A.applyConfig({ corpus: lines(40, 31, 300), cfg: { dModel: 64, nHeads: 16, nLayers: 3, dFF: 256, maxLen: 32 }, batchSize: 4 });
    if (check(hv.ok, W, 'la configuración pesada se rechazó: ' + JSON.stringify(hv.errors))) {
      A.setTab('paso');
      A.goToStep(S.trace.steps.findIndex((x) => x.kind === 'softmax' && x.phase === 'forward')); A.flush();
      const btn = () => $('stage').querySelector('[data-train-return]');
      const it0 = S.s.iter, tr0 = S.trace.iter;
      let gap = 0, lastT = performance.now(), on = true;
      (function beat() { const t = performance.now(); gap = Math.max(gap, t - lastT); lastT = t; if (on) setTimeout(beat, 16); })();
      const tc = performance.now();
      btn().click();
      const clickMs = performance.now() - tc;
      await sleep(1000);
      const lbl = btn() ? btn().textContent : '';
      btn().click(); // cancelar
      await sleep(150);
      on = false;
      check(clickMs < 100 && gap < 700, W, '«Entrenar 200 iteraciones y volver» bloqueó la página (clic ' + Math.round(clickMs) + ' ms, peor pausa ' + Math.round(gap) + ' ms)');
      check(/Entrenando…/.test(lbl) && S.s.iter > it0 && S.trace.iter === tr0 && btn() && !/Entrenando/.test(btn().textContent), W,
        'progreso o cancelación de «Entrenar 200 y volver» incorrectos (' + lbl + '; iteración ' + it0 + ' → ' + S.s.iter + ')');
      // el minilote de «Entrenamiento» no puede saltarse el límite de coste de «Datos»
      A.setTab('entrenamiento');
      $('tr-batch').value = '64'; $('tr-batch').dispatchEvent(new Event('change'));
      check(S.s.batchSize === 4 && /demasiado pesado/.test($('tr-hp-err').textContent), W, 'B = 64 se aceptó en «Entrenamiento» (B = ' + S.s.batchSize + ')');
      // +10 a trozos: la página sigue respondiendo y se puede cancelar
      const p10 = document.querySelector('[data-train="10"]');
      gap = 0; lastT = performance.now(); on = true;
      (function beat() { const t = performance.now(); gap = Math.max(gap, t - lastT); lastT = t; if (on) setTimeout(beat, 16); })();
      p10.click();
      await sleep(500);
      p10.click();
      await sleep(150);
      on = false;
      check(gap < 700 && p10.textContent === '+10', W, '«+10» bloqueó la página (' + Math.round(gap) + ' ms) o no se canceló (' + p10.textContent + ')');
    }
    A.applyConfig(CONFIGS[0].c);
    A.setTab('paso');
  }
  // ---- 1024×768 en un iframe: inspector fijo al pie, línea de tiempo de una fila, foco y animación a la vista
  {
    const W = '1024 px';
    const f = await loadFrame(1024, 768);
    const w = f.contentWindow, d = f.contentDocument, B = w.TL.App;
    B.setTab('paso');
    check(d.getElementById('iterbar').parentNode.id === 'iterbar-slot' && d.getElementById('timeline').offsetHeight < 110, W,
      'la línea de tiempo ocupa dos filas (' + d.getElementById('timeline').offsetHeight + ' px)');
    for (const id of ['fwd.L0.attn.q', 'fwd.L0.ln1', 'fwd.L0.attn.h0.scores', 'upd.param.L0.W1']) await animVisible(w, B, id, W);
    // teclado: flechas por la matriz de salida; la celda enfocada no queda tapada
    const si = B.getTrace().steps.findIndex((x) => x.id === 'fwd.L0.attn.h0.softmax');
    B.goToStep(si); B.flush(); w.scrollTo(0, 0);
    const hms = B.state.view.heatmaps;
    const first = hms[hms.length - 2].el.querySelector('.hm__c[tabindex="0"]');
    first.focus();
    let covered = 0;
    for (let k = 0; k < 5; k++) {
      d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', { key: k < 4 ? 'ArrowDown' : 'ArrowRight', bubbles: true, cancelable: true }));
      await new Promise((r) => w.requestAnimationFrame(() => w.requestAnimationFrame(() => w.requestAnimationFrame(r))));
      await sleep(30);
      const r = d.activeElement.getBoundingClientRect(), b = bandOf(w);
      if (r.top < b.top - 1 || r.bottom > b.bottom + 1) covered++;
    }
    check(!covered, W, covered + ' de 5 celdas enfocadas con el teclado quedaron bajo el inspector o la línea de tiempo');
    f.remove();
  }

  // ---- móvil (390×844) en un iframe: sin desplazamiento horizontal en ninguna pestaña
  {
    const W = 'móvil 390 px';
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;left:0;top:0;width:390px;height:844px;border:0;opacity:0;pointer-events:none';
    f.src = location.href.split('#')[0];
    document.body.appendChild(f);
    await new Promise((r) => { f.onload = r; });
    const w = f.contentWindow, d = f.contentDocument;
    for (let k = 0; k < 100 && !(w.TL && w.TL.App && w.TL.App.state.ready); k++) await sleep(50);
    await w.TL.MathTex.ready;
    const B = w.TL.App;
    const over = (where) => {
      const de = d.documentElement;
      const bad = de.scrollWidth > de.clientWidth || de.scrollWidth > w.innerWidth;
      if (bad) {
        // culpable: el elemento visible más ancho que la ventana
        let who = '';
        for (const e of d.querySelectorAll('body *')) {
          const r = e.getBoundingClientRect();
          if (r.width && r.right > de.clientWidth + 0.5) { who = e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + '.' + String(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className).split(' ').join('.'); break; }
        }
        fail(W + ' · ' + where, 'desbordamiento horizontal: scrollWidth ' + de.scrollWidth + ' > ' + de.clientWidth + ' (' + who + ')');
      }
      return bad;
    };
    const wf = () => new Promise((r) => w.requestAnimationFrame(() => setTimeout(r, 0)));
    let checked = 0;
    for (const t of ['paso', 'entrenamiento', 'generacion', 'datos']) {
      B.setTab(t);
      await wf(); await wf();
      over('pestaña ' + t);
      checked++;
    }
    B.setTab('paso');
    const n = B.getTrace().steps.length;
    for (let i = 0; i < n; i++) {
      B.goToStep(i); B.flush();
      await wf();
      over('paso ' + (i + 1) + ' (' + B.getStep().id + ')');
      checked++;
    }
    B.openGuide();
    await wf();
    over('guía');
    B.closeModal();
    // tocar una celda: la cuenta aparece en el inspector fijo sobre la línea de tiempo, a la vista
    {
      const si = B.getTrace().steps.findIndex((x) => x.id === 'fwd.L0.attn.h0.scores');
      B.goToStep(si); B.flush();
      const cell = B.state.view.heatmaps[0].el.querySelectorAll('.hm__c')[5];
      cell.scrollIntoView({ block: 'center' });
      await wf();
      cell.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
      B.flush();
      await wf();
      const ins = d.getElementById('inspector').getBoundingClientRect(), tl = d.getElementById('timeline').getBoundingClientRect();
      check(!d.getElementById('inspector').classList.contains('is-empty') && ins.top >= 0 && ins.bottom <= tl.top + 1 && ins.top < w.innerHeight - 100, W,
        'tras tocar una celda, el inspector no queda a la vista (' + Math.round(ins.top) + '…' + Math.round(ins.bottom) + ' px; línea de tiempo en ' + Math.round(tl.top) + ')');
    }
    // minimizado, el inspector conserva «Mostrar» al cambiar de paso (antes quedaba una barra sin control)
    {
      const im = d.getElementById('insp-min');
      if (!d.getElementById('inspector').classList.contains('is-collapsed')) im.click();
      B.goToStep(B.state.idx + 1); B.flush();
      await wf();
      check(d.getElementById('inspector').classList.contains('is-collapsed') && !im.hidden, W, 'con el inspector minimizado, «Mostrar» desaparece al cambiar de paso');
      im.click();
    }
    summary.mobile = { width: w.innerWidth, checks: checked + 1 };
    f.remove();
  }

  // ---- pantalla baja (844×390, móvil en horizontal): queda sitio para el paso con el inspector abierto
  {
    const W = '844×390';
    const f = await loadFrame(844, 390);
    const w = f.contentWindow, d = f.contentDocument, B = w.TL.App;
    B.setTab('paso');
    B.goToStep(B.getTrace().steps.findIndex((x) => x.id === 'fwd.L0.attn.h0.softmax')); B.flush();
    const hms = B.state.view.heatmaps;
    const cell = hms[hms.length - 2].el.querySelectorAll('.hm__c')[0];
    cell.scrollIntoView({ block: 'center' });
    await sleep(60);
    cell.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    B.flush();
    await new Promise((r) => w.requestAnimationFrame(() => w.requestAnimationFrame(r)));
    const hd = d.getElementById('app-head').getBoundingClientRect(), ins = d.getElementById('inspector').getBoundingClientRect();
    const room = ins.top - Math.max(0, hd.bottom);
    check(room >= 150, W, 'con el inspector abierto solo quedan ' + Math.round(room) + ' px para el paso');
    f.remove();
  }

  window.removeEventListener('error', onErr);
  window.removeEventListener('unhandledrejection', onRej);
  console.error = origErr;
  console.warn = origWarn;
  summary.errors = errors.slice(0, 20);
  summary.fails = fails.length;
  summary.ms = Math.round(performance.now() - T0);
  if (errors.length) for (const e of errors.slice(0, 20)) fail('consola', e);
  if (fails.length) throw new Error('PRUEBA DE HUMO FALLIDA (' + fails.length + ' fallos)\n  ' + fails.slice(0, 60).join('\n  ') + '\n' + JSON.stringify(summary));
  summary.ok = true;
  return summary;
})()
