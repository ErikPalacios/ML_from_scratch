/* =============================================================================
   Atlas de Arquitecturas — tools/smoke.js
   Basado en apps/ml-system-design/tools/smoke.js.
   Prueba de humo en navegador. Es una expresión (async IIFE) para browser-check:
     npm run smoke            # index.html, escritorio 1440×900, claro
     npm run smoke:mobile     # 375×812 · npm run smoke:dark · npm run smoke:tablet (768×1024)
     npm run smoke:dist       # lo mismo contra dist/atlas-arquitecturas.html
     npm run smoke:artifact   # dist/artifact.html envuelto con un window.claude falso y sin localStorage
     npm run smoke:web        # dist/web servido por http (service worker, lab/ precargado)
     npm run smoke:offline    # MathJax bloqueado: el respaldo aparece al instante
   El modo lo fija tools/smoke-harness.mjs en window.__SMOKE_MODE (artifact | web | offline).
   Recorre cada página lista del registro (y las especiales), verifica que cada sección se pinte,
   que no haya bloques rotos ni desborde horizontal, que cada diagrama dibuje en sus aristas
   exactamente las formas de ATLAS.Arch (ATLAS.ArchDiagram.checkLabels, y como respaldo
   [data-edge][data-tensor] contra ATLAS.Arch.fmt.shape), que abrir/cerrar bloques funcione, que el
   recorrido visite todos los pasos, la ruta #página.sección~nodo, la tabla trace, la búsqueda
   (incluidos los bloques de diagrama), flashcards, práctica, tema y respaldo.
   Cada falla se reporta con console.error (browser-check sale con código 1); el valor final es
   un resumen JSON. Supone un perfil limpio (browser-check crea uno nuevo en cada corrida).
   ========================================================================== */
(async () => {
  'use strict';
  const T0 = performance.now();
  const MODE = window.__SMOKE_MODE || 'dev';
  const A = window.ATLAS;
  const store = A.store;
  const passes = [];
  const fails = [];
  const notes = {};
  const overflow = [];

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const byId = (id) => document.getElementById(id);
  const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const drawerMode = () => matchMedia('(max-width: 767px)').matches;

  function ok(name, cond, info) {
    if (cond) passes.push(name);
    else {
      const msg = name + (info !== undefined ? ' — ' + (typeof info === 'string' ? info : JSON.stringify(info)) : '');
      fails.push(msg);
      console.error('[smoke] FALLA: ' + msg);
    }
    return !!cond;
  }
  async function waitFor(fn, ms, every) {
    const t = performance.now();
    for (;;) {
      let v = null;
      try { v = fn(); } catch (e) { v = null; }
      if (v) return v;
      if (performance.now() - t > (ms || 3000)) return null;
      await sleep(every || 40);
    }
  }
  async function step(name, fn) {
    try { await fn(); } catch (e) { ok(name + ': sin excepciones', false, String(e && e.stack || e)); }
  }
  async function go(hash) {
    if (location.hash === hash) A.App.navigate(hash);
    else location.hash = hash;
    await waitFor(() => { const r = A.App.route(); return r && r.hash === hash; }, 3000);
    await sleep(120);
  }
  function checkOverflow(label) {
    const de = document.documentElement;
    const extra = de.scrollWidth - innerWidth;
    if (extra > 0) {
      const off = $$('body *').filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.right <= innerWidth + 1) return false;
        const pr = el.parentElement && el.parentElement.getBoundingClientRect();
        return !pr || pr.right <= innerWidth + 1;
      }).slice(0, 5).map((el) => el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : '') + ' → ' + Math.round(el.getBoundingClientRect().right));
      overflow.push({ route: label, extra, off });
    }
    return ok('sin scroll horizontal en ' + label, extra <= 0, { scrollWidth: de.scrollWidth, innerWidth });
  }
  // Bloques rotos: avisos del shell, errores del diagrama, cantidades sin resolver.
  const broken = (el) => $$('.block-warn, .ad-error, .q-warn', el || byId('page')).map((x) => txt(x).slice(0, 140));
  const blur = () => { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); };
  function key(k, target) {
    const t = target || document.body;
    const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
    t.dispatchEvent(ev);
    return ev;
  }
  const button = (label, scope) => $$('button, a.btn', scope || document).find((b) => txt(b).indexOf(label) >= 0);

  // Etiquetas de forma de un diagrama = calculador. checkLabels del componente; respaldo genérico.
  function labelProblems(fig) {
    const AD = A.ArchDiagram;
    if (AD && typeof AD.checkLabels === 'function') return AD.checkLabels(fig);
    const spec = A.diagram(fig.getAttribute('data-view') || fig.getAttribute('data-diagram'));
    if (!spec || !spec.config) return [];
    const run = A.Arch.run(spec.config);
    return $$('[data-edge][data-tensor]', fig).filter((e) => {
      const t = run.tensors[e.getAttribute('data-tensor')];
      return !t || txt(e).indexOf(A.Arch.fmt.shape(t, 'num')) < 0;
    }).map((e) => ({ edge: e.getAttribute('data-edge'), tensor: e.getAttribute('data-tensor'), got: txt(e) }));
  }
  const diagramCtrls = (scope) => (A.Blocks ? A.Blocks.controllers(scope || byId('page'), 'diagram') : []);

  // Diagramas de la página: etiquetas, cada bloque expandible (y vuelta), recorrido completo.
  async function checkDiagrams(label) {
    const ctrls = diagramCtrls();
    let views = 0, walks = 0;
    for (const c of ctrls) {
      const fig = $('figure.ad', c.el) || c.el;
      const spec = A.diagram(c.diagram);
      ok(label + ' · ' + c.diagram + ': dibuja', !!fig && !$('.ad-error', fig) && $$('svg', fig).length > 0);
      if (!spec || spec.kind === 'map') continue;
      const bad = labelProblems(fig);
      ok(label + ' · ' + c.diagram + ': formas = calculador', bad.length === 0, bad.slice(0, 4));
      ok(label + ' · ' + c.diagram + ': aristas con forma', $$('[data-edge][data-tensor]', fig).length > 0);
      views++;
      // Bloques que se abren (nivel b y c)
      const seen = new Set([c.diagram]);
      const view = () => fig.getAttribute('data-view') || c.diagram;
      const queue = (spec.nodes || []).filter((n) => n.expand).map((n) => n.expand);
      while (queue.length) {
        const id = queue.shift();
        if (seen.has(id)) continue;
        seen.add(id);
        try {
          await c.ctrl.expand(id);   // el diagrama baja por la cadena de padres él solo (puede animar)
          ok(label + ' · abre ' + id, !!(await waitFor(() => view() === id, 2500)), view());
          await sleep(50);
          const bad2 = labelProblems(fig);
          ok(label + ' · ' + id + ': formas = calculador', bad2.length === 0, bad2.slice(0, 4));
          views++;
          const sub = A.diagram(id);
          (sub && sub.nodes || []).filter((n) => n.expand).forEach((n) => queue.push(n.expand));
          for (let i = 0; i < 4 && view() !== c.diagram; i++) {
            const before = view();
            await c.ctrl.collapse();
            await waitFor(() => view() !== before, 2500);
          }
          ok(label + ' · vuelve de ' + id, view() === c.diagram, view());
        } catch (e) { ok(label + ' · abre ' + id + ' sin excepciones', false, String(e)); }
      }
      // Recorrido: visita todos los pasos con "Siguiente"
      for (const w of spec.walks || []) {
        try {
          c.ctrl.startWalk(w.id);
          await sleep(60);
          const bar = $('.ad-walk', fig);
          ok(label + ' · recorrido ' + w.id + ': se abre', !!bar && !bar.hidden);
          let visited = 1;
          for (let i = 1; i < w.steps.length; i++) {
            const next = $('.ad-walk-next', fig);
            if (!next || next.disabled) break;
            next.click();
            await sleep(30);
            visited++;
          }
          ok(label + ' · recorrido ' + w.id + ': visita los ' + w.steps.length + ' pasos', visited === w.steps.length && new RegExp('Paso ' + w.steps.length + ' de ' + w.steps.length).test(txt($('.ad-walk-n', fig))), { visited, n: txt($('.ad-walk-n', fig)) });
          c.ctrl.stopWalk();
          await sleep(30);
          walks++;
        } catch (e) { ok(label + ' · recorrido ' + w.id + ' sin excepciones', false, String(e)); }
      }
    }
    return { diagrams: ctrls.length, views, walks };
  }

  // Contadores de recursos vivos (para comprobar que salir de una página destruye sus controladores):
  // ResizeObservers sin desconectar y listeners de window/document de los tipos que usan los componentes.
  const live = { ro: 0, ls: new Map() };
  (() => {
    const RO = window.ResizeObserver;
    if (RO) {
      window.ResizeObserver = class extends RO {
        constructor(cb) { super(cb); this.__smokeOn = true; live.ro++; }
        disconnect() { if (this.__smokeOn) { this.__smokeOn = false; live.ro--; } return super.disconnect(); }
      };
    }
    const TYPES = ['resize', 'hashchange', 'keydown', 'pointerdown', 'scroll'];
    const keyOf = (who, t, o) => who + ':' + t + (o === true || (o && o.capture) ? ':c' : '');
    for (const [who, tgt] of [['window', window], ['document', document]]) {
      const add = tgt.addEventListener, rem = tgt.removeEventListener;
      tgt.addEventListener = function (t, fn, o) {
        if (TYPES.indexOf(t) >= 0 && fn) { const k = keyOf(who, t, o); const m = live.ls.get(k) || new Set(); m.add(fn); live.ls.set(k, m); }
        return add.call(this, t, fn, o);
      };
      tgt.removeEventListener = function (t, fn, o) {
        if (TYPES.indexOf(t) >= 0 && fn) { const m = live.ls.get(keyOf(who, t, o)); if (m) m.delete(fn); }
        return rem.call(this, t, fn, o);
      };
    }
  })();
  const liveCounts = () => { const o = { ro: live.ro }; for (const [k, m] of live.ls) o[k] = m.size; return o; };

  // ------------------------------------------------------------------ 0. arranque
  await step('arranque', async () => {
    ok('registro sin problemas', A.registryProblems().length === 0, A.registryProblems());
    ok('aviso de desarrollo oculto', byId('dev-banner').hidden, txt(byId('dev-banner')));
    const mods = ['App', 'Blocks', 'store', 'dom', 'MathTex', 'Arch', 'Quantities', 'ArchDiagram', 'Viz', 'Practice', 'Flashcards', 'Reference'];
    ok('módulos cargados', mods.every((k) => !!A[k]), mods.filter((k) => !A[k]));
    ok('vit y repaso listos', (A.getPage('vit') || {}).ready && (A.getPage('repaso-atencion') || {}).ready);
    ok('índice con todos los modelos', $$('#nav .nav__item').filter((a) => (A.catalog().items[a.dataset.id] || {}).kind === 'model').length === Object.values(A.catalog().items).filter((it) => it.kind === 'model').length);
    notes.viewport = innerWidth + '×' + innerHeight + (drawerMode() ? ' (cajón)' : '') + (matchMedia('(prefers-color-scheme: dark)').matches ? ' oscuro' : ' claro');
    notes.backend = store.backend();
    notes.mode = MODE;
    // Sin red (smoke:offline) el respaldo debe estar listo ya (el error del <script> se detecta al
    // instante); con red, MathJax tiene que cargar.
    const st = await Promise.race([A.MathTex.ready.then((v) => (v ? 'ok' : 'falló')), sleep(30).then(() => 'esperando')]);
    if (MODE === 'offline') ok('sin MathJax: ready ya resolvió false (sin esperar 8 s)', st === 'falló', st);
    notes.mathjax = await A.MathTex.ready;
    if (MODE !== 'offline') ok('MathJax cargó', notes.mathjax === true, notes.mathjax);
  });

  // ------------------------------------------------------------------ 1. inicio
  await step('inicio', async () => {
    await go('#inicio');
    ok('inicio: título', txt(byId('page-title')) === 'Atlas de Arquitecturas');
    const cells = $$('#page .fstrip:not(.fstrip--compact) .fstrip__groups .ucell');
    const course = A.courseOrder().length;
    ok('inicio: tira de familias con una celda por página del curso', cells.length === course, { cells: cells.length, course });
    ok('inicio: hoja de ruta', $$('#page .roadmap__item').length === (A.catalog().roadmap || []).length);
    ok('inicio: tarjetas "Ahora"', $$('#page .now-card').length === 2);
    ok('inicio: sin bloques rotos', broken().length === 0, broken());
    checkOverflow('#inicio');
  });

  // ------------------------------------------------------------------ 2. páginas del curso + especiales
  const stats = { diagrams: 0, views: 0, walks: 0 };
  await step('páginas', async () => {
    const soon = [];
    const special = ['mapa', 'ref-formas'];
    for (const id of A.courseOrder().concat(special)) {
      await go('#' + id);
      const p = A.getPage(id);
      ok(id + ': h1', !!byId('page-title') && txt(byId('page-title')).length > 0);
      ok(id + ': document.title', / · Atlas de Arquitecturas$/.test(document.title), document.title);
      ok(id + ': sin bloques rotos', broken().length === 0, broken());
      if (p && p.ready) {
        ok(id + ': ' + p.sections.length + ' secciones', $$('#page section.sec').length === p.sections.length);
        p.sections.forEach((s) => ok(id + '.' + s.id + ': se pinta', !!byId(id + '.' + s.id) && $('.sec__body', byId(id + '.' + s.id)).children.length > 0));
        if (p.kind === 'model') {
          ok(id + ': plantilla de 11 en orden', JSON.stringify($$('#page section.sec').map((s) => s.dataset.sec)) === JSON.stringify(A.MODEL_TEMPLATE.map((t) => t.id)));
          ok(id + ': ficha técnica con parámetros', !!$('#page .ficha') && /Parámetros/i.test(txt($('#page .ficha'))) && !/no disponible/.test(txt($('#page .ficha'))));
          ok(id + ': navegador 1–11', $$('#page .tnav__item').length === 11);
        }
        ok(id + ': enlaces lab: reescritos', $$('#page a[href^="lab:"]').length === 0);
        if (A.MathTex.isReady()) ok(id + ': fórmulas compuestas', $$('#page .tex-fallback').length === 0, $$('#page .tex-fallback').slice(0, 3).map((x) => x.getAttribute('data-tex')));
        const d = await checkDiagrams('#' + id);
        stats.diagrams += d.diagrams; stats.views += d.views; stats.walks += d.walks;
      } else {
        soon.push(id);
        ok(id + ': página "Próximamente"', !!$('#page .soon-note') && !!$('#page .chip--soon'));
      }
      if ($('#nav .nav__item[data-id="' + id + '"]')) ok(id + ': aria-current en el índice', !!$('#nav .nav__item[data-id="' + id + '"][aria-current="page"]'));
      checkOverflow('#' + id);
    }
    notes.proximamente = soon.length;
    notes.diagramas = stats;
    ok('hay diagramas verificados', stats.views > 0, stats);
  });

  // ------------------------------------------------------------------ 3. rutas de diagrama, trace, op
  await step('vit: ruta ~nodo, trace y op', async () => {
    if (!(A.getPage('vit') || {}).ready) return;
    await go('#vit.diagrama~mhsa');
    const c = diagramCtrls(byId('vit.diagrama'))[0];
    const fig = c && ($('figure.ad', c.el) || c.el);
    ok('#vit.diagrama~mhsa: abre la capa del encoder', !!fig && await waitFor(() => fig.getAttribute('data-view') === 'vit-enc-layer', 1500), fig && fig.getAttribute('data-view'));
    if (c) { await c.ctrl.collapse(); await sleep(400); }
    await go('#vit.operaciones');
    const row = $('#page .b-trace .trace__row[data-tensor="x-patches"]');
    ok('trace: fila de x-patches', !!row);
    if (row) {
      row.click();
      ok('trace: la fila queda activa', row.classList.contains('is-active'));
      ok('trace: resalta el tensor en el diagrama', !!(await waitFor(() => $('#vit\\.diagrama .is-on'), 800)));
    }
    ok('op: tarjeta con ancla #vit.operaciones.<nodo>', !!byId('vit.operaciones.qkv') || !!$('#page .opc[id^="vit.operaciones."]'));
    const ptotal = txt($('#page .b-ptab tfoot td.num b'));
    ok('params: total = calculador', ptotal === A.Arch.fmt.int(A.Arch.run('vit-b16-224').totals.params), ptotal);
  });

  // ------------------------------------------------------------------ 4. leída / completado
  await step('marcas de progreso', async () => {
    const id = (A.getPage('vit') || {}).ready ? 'vit' : 'repaso-atencion';
    await go('#' + id);
    const p = A.getPage(id);
    const first = p.sections[0].id;
    const rt = $('#page .read-toggle[data-sec="' + first + '"]');
    rt.click();
    ok(id + ': sección leída en el store', store.isSectionRead(id, first));
    ok(id + ': anillo de progreso en el índice', !!(await waitFor(() => $('#nav .nav__item[data-id="' + id + '"] .ring'), 1500)));
    ok(id + ': celda "en curso" en la tira compacta', !!(await waitFor(() => $('#side-uptime .ucell--progress'), 1500)));
    for (const s of p.sections) if (!store.isSectionRead(id, s.id)) $('#page .read-toggle[data-sec="' + s.id + '"]').click();
    await sleep(60);
    $('#page .complete-toggle').click();
    ok(id + ': completado', store.pageProgress(id).completed);
    ok(id + ': check en el índice', !!(await waitFor(() => $('#nav .nav__item[data-id="' + id + '"] .mk-done'), 1500)));
    ok(id + ': contador 1/N', await waitFor(() => /^1\/\d+$/.test(txt($('#side-uptime .side-uptime__count'))), 1500), txt($('#side-uptime .side-uptime__count')));
    store.flush();
    if (store.backend() === 'local') {
      let ls = null;
      try { ls = localStorage.getItem('atlas.v1'); } catch (e) { ls = null; }
      ok('persistido en localStorage atlas.v1', !!ls && ls.indexOf(id + '.' + first) >= 0);
    } else if (store.backend() === 'account' && window.__writes) {
      ok('persistido en la cuenta (data/users/<uid>/state)', !!(await waitFor(() => window.__writes.some((p) => /\/state$/.test(p)), 4000)), window.__writes);
    }
  });

  // ------------------------------------------------------------------ 5. páginas de otros componentes
  await step('práctica, flashcards, glosario, buscar', async () => {
    for (const h of ['#practica', '#practica-vit', '#flashcards', '#glosario', '#buscar', '#resnet', '#swin']) {
      await go(h);
      ok(h + ': se pinta', txt(byId('page')).length > 40 && !!$('#page h1'), txt(byId('page')).slice(0, 80));
      ok(h + ': sin bloques rotos', broken().length === 0, broken());
      checkOverflow(h);
    }
    // Flashcards: mostrar y calificar
    const ids = A.Flashcards && A.Flashcards.visibleCards ? A.Flashcards.visibleCards(store).map((c) => c.id) : A.flashcards().map((c) => c.id);
    if (ids.length) {
      await go('#flashcards');
      const s0 = store.flashStats(ids);
      blur();
      key(' ');
      await sleep(80);
      blur();
      key('3');
      ok('flashcards: Espacio + 3 califica una tarjeta', !!(await waitFor(() => store.flashStats(ids).seen === s0.seen + 1, 1500)), { s0: s0.seen, s1: store.flashStats(ids).seen });
    }
  });

  // ------------------------------------------------------------------ 5b. salir de una página destruye sus controladores
  await step('teardown de controladores', async () => {
    await go('#inicio');
    await sleep(150);
    const base = liveCounts();
    const routes = ['#vit', '#practica', '#practica-vit', '#flashcards', '#glosario', '#repaso-atencion'];
    for (let i = 0; i < 3; i++) for (const r of routes) { await go(r); await go('#inicio'); }
    await sleep(150);
    const after = liveCounts();
    const grew = Object.keys(after).filter((k) => (after[k] || 0) > (base[k] || 0)).map((k) => k + ' ' + (base[k] || 0) + '→' + after[k]);
    ok('3 idas y vueltas a ' + routes.join(' ') + ' no dejan observadores ni listeners vivos', grew.length === 0, grew);
    notes.vivos = after;
  });

  // ------------------------------------------------------------------ 5c. cada bloque de la búsqueda abre su diagrama
  await step('búsqueda: bloques → diagrama', async () => {
    const blocks = A.searchIndex().filter((e) => e.type === 'block');
    const bad = [];
    for (const e of blocks) {
      await go(e.href);
      const r = A.App.parseHash(e.href);
      const sec = byId(r.pageId + '.' + r.section);
      const c = sec && diagramCtrls(sec)[0];
      const fig = c && ($('figure.ad', c.el) || c.el);
      const opened = fig && await waitFor(() => fig.getAttribute('data-view') === e.diagram, 2500);
      const focused = await waitFor(() => document.activeElement && document.activeElement.getAttribute('data-node') === e.node && fig.contains(document.activeElement), 1500);
      if (!opened || !focused) bad.push(e.href + ' → vista ' + (fig && fig.getAttribute('data-view')) + ', foco ' + (document.activeElement && (document.activeElement.getAttribute('data-node') || document.activeElement.tagName)));
    }
    ok('los ' + blocks.length + ' resultados de tipo Bloque abren su diagrama y enfocan su nodo', bad.length === 0, bad.slice(0, 6));
    // Forma calificada (~diagrama.nodo) para un id repetido en la sección (el "in" de cada vista de vit).
    if ((A.getPage('vit') || {}).ready && A.nodeDiagrams('vit', 'diagrama', 'in').length > 1) {
      await go('#vit.diagrama~vit-mlp.in');
      const c = diagramCtrls(byId('vit.diagrama'))[0];
      const fig = c && ($('figure.ad', c.el) || c.el);
      ok('#vit.diagrama~vit-mlp.in abre vit-mlp (no la primera vista con "in")', !!fig && !!(await waitFor(() => fig.getAttribute('data-view') === 'vit-mlp', 2500)), fig && fig.getAttribute('data-view'));
      ok('#vit.diagrama~vit-mlp.in enfoca el nodo in', !!(await waitFor(() => document.activeElement && document.activeElement.getAttribute('data-node') === 'in', 1500)));
      await go('#vit.diagrama~vit-patch-embed.in');
      ok('…y ~vit-patch-embed.in cambia a vit-patch-embed', !!fig && !!(await waitFor(() => fig.getAttribute('data-view') === 'vit-patch-embed', 2500)), fig && fig.getAttribute('data-view'));
    }
    await go('#inicio');
  });

  // ------------------------------------------------------------------ 6. búsqueda y atajos
  await step('búsqueda', async () => {
    await go('#inicio');
    const inp = byId('search-input');
    for (const q of ['atencion', 'MHSA', 'patch embedding']) {
      inp.value = q;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      const n = $$('#search-results .sres').length;
      ok('búsqueda "' + q + '" devuelve resultados', n > 0, n);
    }
    ok('búsqueda: hay resultados de tipo Bloque', $$('#search-results .sres__type').some((x) => txt(x) === 'Bloque'));
    const blockRes = $$('#search-results .sres').find((x) => txt($('.sres__type', x)) === 'Bloque');
    if (blockRes) {
      blockRes.click();
      ok('búsqueda: un bloque abre #página.sección~nodo', await waitFor(() => /~/.test(location.hash), 1500), location.hash);
    }
    inp.value = '';
    await go('#inicio');
    blur();
    key('/');
    ok('atajo "/" enfoca la búsqueda', await waitFor(() => document.activeElement === inp, 800));
    key('Escape', inp);
    if (drawerMode()) await waitFor(() => !byId('sidebar').classList.contains('is-open'), 800);
    else inp.blur();
    const order = A.courseOrder();
    await go('#' + order[0]);
    blur();
    key(']');
    ok('atajo "]" va a la página siguiente', !!(await waitFor(() => location.hash === '#' + order[1], 1500)), location.hash);
  });

  // ------------------------------------------------------------------ 7. tema y respaldo
  await step('tema y respaldo', async () => {
    await go('#inicio');
    const sb = byId('sidebar');
    if (drawerMode()) {
      byId('menu-btn').click();
      ok('cajón: se abre', await waitFor(() => sb.classList.contains('is-open'), 800));
    }
    const de = document.documentElement;
    const tb = (t) => $('#side-foot button[data-theme="' + t + '"]');
    let themed = 0;
    const off = A.App.onTheme(() => { themed++; });
    tb('dark').click();
    ok('tema: Oscuro', de.getAttribute('data-theme') === 'dark' && getComputedStyle(document.body).backgroundColor === 'rgb(16, 21, 27)');
    tb('light').click();
    ok('tema: Claro', de.getAttribute('data-theme') === 'light' && getComputedStyle(document.body).backgroundColor === 'rgb(238, 241, 243)');
    ok('tema: avisa a onTheme', themed >= 1, themed);
    off();
    tb('system').click();
    ok('tema: Sistema quita data-theme', !de.hasAttribute('data-theme'));
    const exp1 = store.exportJSON();
    ok('exportar: JSON del atlas', JSON.parse(exp1).app === 'atlas-arquitecturas');
    byId('btn-portability').click();
    const modal = byId('modal');
    ok('respaldo: se abre el panel', await waitFor(() => !modal.hidden, 800));
    byId('import-text').value = exp1;
    button('Importar', modal).click();
    ok('respaldo: importa', !!(await waitFor(() => $('.result-msg.is-ok', modal), 800)), txt($('.result-msg', modal)));
    key('Escape');
    ok('respaldo: Esc cierra', await waitFor(() => modal.hidden, 800));
    if (drawerMode()) { byId('drawer-close').click(); await waitFor(() => !sb.classList.contains('is-open'), 800); }
  });

  // ------------------------------------------------------------------ 8. ruta desconocida
  await step('no encontrado', async () => {
    await go('#no-existe-esta-ruta');
    ok('ruta desconocida: página "no encontrado"', txt(byId('page-title')) === 'No encontramos esta página');
    checkOverflow('#no-existe-esta-ruta');
    await go('#inicio');
  });

  // ------------------------------------------------------------------ 9. por entorno (smoke-harness)
  await step('entorno ' + MODE, async () => {
    if (MODE === 'artifact') {
      ok('artifact: ATLAS_ENV', window.ATLAS_ENV === 'artifact', window.ATLAS_ENV);
      ok('artifact: guardado en la cuenta', !!(await waitFor(() => store.backend() === 'account', 4000)), store.backend());
      await go('#repaso-atencion');
      ok('artifact: ningún enlace al Laboratorio (no hay a.lab-link)', $$('#page a.lab-link').length === 0);
      const notesEls = $$('#page .lab-link--note');
      ok('artifact: notas en lugar de enlaces', notesEls.length > 0, notesEls.length);
      ok('artifact: la ubicación completa del Laboratorio aparece una sola vez por página', $$('#page .lab-link__where--full').length === 1, $$('#page .lab-link__where--full').length);
      ok('artifact: sin "Laboratorio Transformer" repetido en cada nota', !notesEls.some((n) => (txt(n).match(/Laboratorio/gi) || []).length > 1), notesEls.map(txt).filter((t) => (t.match(/Laboratorio/gi) || []).length > 1).slice(0, 3));
    } else if (MODE === 'web') {
      ok('web: ATLAS_ENV', window.ATLAS_ENV === 'web', window.ATLAS_ENV);
      const reg = await Promise.race([navigator.serviceWorker.ready, sleep(15000).then(() => null)]);
      ok('web: service worker activo', !!(reg && reg.active), reg && reg.scope);
      const keys = await caches.keys();
      const app = keys.find((k) => k.startsWith('atlas-app-'));
      const pre = app ? (await (await caches.open(app)).keys()).map((r) => new URL(r.url).pathname) : [];
      ok('web: lab/ precargado', pre.some((p) => /\/lab\/$/.test(p)), pre);
      const rt = keys.indexOf('atlas-runtime') >= 0 ? (await (await caches.open('atlas-runtime')).keys()).map((r) => r.url) : [];
      ok('web: MathJax en la caché desde la primera visita', rt.some((u) => /mathjax\/.*tex-svg/.test(u)), rt.slice(0, 5));
      await go('#repaso-atencion');
      const links = $$('#page a.lab-link');
      ok('web: los enlaces al Laboratorio apuntan a lab/#…', links.length > 0 && links.every((a) => /^lab\/#/.test(a.getAttribute('href'))), links.slice(0, 3).map((a) => a.getAttribute('href')));
      const lr = await fetch('lab/');
      const lt = await lr.text();
      ok('web: lab/ responde con el Laboratorio', lr.status === 200 && /Laboratorio/i.test((/<title>([^<]*)/i.exec(lt) || [])[1] || ''), lr.status);
      await go('#inicio');
    } else if (MODE === 'offline') {
      await go('#vit.operaciones');
      ok('offline: fórmulas en LaTeX de respaldo', $$('#page .tex-fallback').length > 0, $$('#page .tex-fallback').length);
      ok('offline: ningún marcador provisional pendiente', $$('#page .tex-pending').length === 0, $$('#page .tex-pending').length);
      await go('#inicio');
    }
  });

  const summary = {
    ok: fails.length === 0, pasaron: passes.length, fallaron: fails.length, fallas: fails,
    desborde: overflow, notas: notes, segundos: Math.round((performance.now() - T0) / 100) / 10,
  };
  if (fails.length) console.error('[smoke] ' + fails.length + ' fallas de ' + (passes.length + fails.length) + ' comprobaciones');
  else console.log('[smoke] OK: ' + passes.length + ' comprobaciones en ' + summary.segundos + ' s');
  return summary;
})();
