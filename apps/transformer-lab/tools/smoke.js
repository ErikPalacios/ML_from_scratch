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
  function texOK(el, where, what) {
    if (!check(el && el.innerHTML.trim().length > 0, where, what + ' vacío')) return;
    if (mj) {
      check(el.querySelector('mjx-container'), where, what + ' sin componer');
      check(!el.querySelector('[data-mjx-error], merror, .tex-fallback'), where, what + ' con error de MathJax');
    }
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
    if (mj) check(!stage.querySelector('[data-mjx-error], merror'), W, 'error de MathJax en el escenario');
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
        check(!ex.querySelector('[data-mjx-error], merror'), W, 'error de MathJax en la explicación');
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
            check(!b.querySelector('[data-mjx-error], merror'), where, 'error de MathJax en el inspector');
          }
        }
      }
    }
    // diagrama: bloque activo y etiquetas de forma
    const host = $('dg-host');
    check(host.querySelector('.dg-node.is-active'), W, 'ningún bloque activo en el diagrama');
    check(host.querySelectorAll('.dg-shapes text').length >= 8, W, 'faltan etiquetas de forma en el diagrama');
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
    for (const id of ['fwd.L0.attn.q', 'fwd.L0.attn.h0.softmax', 'loss.ce', 'upd.param.L0.W1']) await animVisible(window, A, id, W);
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
    const dv = A.train(300);
    check(dv.diverged && dv.iter < 300 && !$('tr-diverged').hidden, W, 'la divergencia no se detectó (iteración ' + dv.iter + ')');
    check(!/e\+\d/.test($('st-ppl').textContent), W, 'la perplejidad desborda su casilla: ' + $('st-ppl').textContent);
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
    for (const id of ['fwd.L0.attn.q', 'fwd.L0.attn.h0.scores', 'upd.param.L0.W1']) await animVisible(w, B, id, W);
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
    summary.mobile = { width: w.innerWidth, checks: checked + 1 };
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
