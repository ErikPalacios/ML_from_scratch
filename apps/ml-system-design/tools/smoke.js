/* =============================================================================
   Ronda de Diseño ML — tools/smoke.js
   Prueba de humo en navegador. Es una expresión (async IIFE) para browser-check:
     npm run smoke                     # index.html, escritorio 1440×900
     node tools/browser-check.mjs --url index.html --wait 1500 --timeout 180000 \
          --eval-file tools/smoke.js [--mobile --width 375 --height 812] [--dark]
     npm run smoke:dist                # lo mismo contra dist/ml-system-design.html
   Recorre la app como lo haría una persona (hash routes, clics, teclado) y verifica
   estado en MSD.store. Cada falla se reporta con console.error (browser-check sale
   con código 1) y el valor final es un resumen JSON.
   Supone un perfil limpio (browser-check crea uno nuevo en cada corrida); si no lo es,
   las comprobaciones que dependen del estado inicial se adaptan en vez de fallar.
   ========================================================================== */
(async () => {
  'use strict';
  const T0 = performance.now();
  const store = MSD.store;
  const passes = [];
  const fails = [];
  const notes = {};
  const overflow = [];

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const byId = (id) => document.getElementById(id);
  const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const visible = (el) => !!el && !el.closest('[hidden]') && el.getClientRects().length > 0;
  const inViewport = (el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.height > 0; };
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

  // Navega por hash y espera a que el router haya pintado la ruta.
  async function go(hash) {
    if (location.hash === hash) MSD.App.navigate(hash);
    else location.hash = hash;
    await waitFor(() => { const r = MSD.App.route(); return r && r.hash === hash; }, 3000);
    await sleep(60);
  }

  // Desborde horizontal del documento en la vista actual (la página nunca debe desplazarse a lo ancho).
  function checkOverflow(label) {
    const de = document.documentElement;
    const extra = de.scrollWidth - innerWidth;
    if (extra > 0) {
      // Culpables: elementos que se salen del viewport cuyo padre no se sale.
      const off = $$('body *').filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.right <= innerWidth + 1) return false;
        const pr = el.parentElement && el.parentElement.getBoundingClientRect();
        return !pr || pr.right <= innerWidth + 1;
      }).slice(0, 5).map((el) => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '') + ' → ' + Math.round(el.getBoundingClientRect().right));
      overflow.push({ route: label, extra, off });
    }
    return ok('sin scroll horizontal en ' + label, extra <= 0, { scrollWidth: de.scrollWidth, innerWidth });
  }

  const broken = (el) => $$('.block-warn, .block-placeholder, .cx__warn, .dg__warn', el || byId('page')).map((x) => txt(x).slice(0, 120));
  const blur = () => { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); };
  function key(k, target) {
    const t = target || document.body;
    const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
    t.dispatchEvent(ev);
    return ev;
  }
  const button = (label, scope) => $$('button, a.btn', scope || document).find((b) => txt(b).indexOf(label) >= 0);

  // ------------------------------------------------------------------ 0. arranque
  await step('arranque', async () => {
    ok('registro sin problemas', MSD.registryProblems().length === 0, MSD.registryProblems());
    ok('aviso de desarrollo oculto', byId('dev-banner').hidden);
    ok('módulos del shell cargados', ['App', 'Blocks', 'Diagram', 'Code', 'Practice', 'Flashcards', 'Reference', 'Notes', 'store', 'dom'].every((k) => !!MSD[k]),
      ['App', 'Blocks', 'Diagram', 'Code', 'Practice', 'Flashcards', 'Reference', 'Notes', 'store', 'dom'].filter((k) => !MSD[k]));
    ok('m01 y c01 listos', MSD.getPage('m01').ready && MSD.getPage('c01').ready);
    ok('28 ítems en el índice', $$('#nav .nav__item').filter((a) => /^[mc]\d\d$/.test(a.dataset.id)).length === 28);
    notes.viewport = innerWidth + '×' + innerHeight + (drawerMode() ? ' (cajón)' : '') + (matchMedia('(prefers-color-scheme: dark)').matches ? ' oscuro' : ' claro');
    notes.backend = store.backend();
  });

  // ------------------------------------------------------------------ 1. inicio
  await step('inicio', async () => {
    await go('#inicio');
    ok('inicio: título', txt(byId('page-title')) === 'Ronda de Diseño ML');
    ok('inicio: uptime strip de 28 celdas', $$('#page .uptime:not(.uptime--compact) .ucell').filter((c) => !c.closest('.uptime__legend')).length === 28);
    ok('inicio: hoja de ruta', $$('#page .roadmap__item').length > 0);
    ok('inicio: tarjetas "Ahora"', $$('#page .now-card').length === 2);
    ok('inicio: sin bloques rotos', broken().length === 0, broken());
    checkOverflow('#inicio');
  });

  // ------------------------------------------------------------------ 2. todas las rutas del curso
  await step('rutas del curso', async () => {
    const soon = [];
    for (const id of MSD.courseOrder()) {
      await go('#' + id);
      const p = MSD.getPage(id);
      const h1 = byId('page-title');
      ok(id + ': h1', !!h1 && txt(h1).length > 0);
      ok(id + ': document.title', document.title.indexOf('Ronda de Diseño ML') > 0, document.title);
      ok(id + ': sin bloques rotos', broken().length === 0, broken());
      if (p && p.ready) {
        if (p.kind === 'module') ok(id + ': ' + p.sections.length + ' secciones', $$('#page section.sec').length === p.sections.length);
        else ok(id + ': compuerta o solución', !!$('#page .gate') || $$('#page section.sec').length === 15);
        if (p.kind === 'case' && $('#page .gate')) {
          // Con el perfil limpio todo caso listo está tras la compuerta: se abre la solución para revisarla
          // y se restaura la preferencia (el paso 4 prueba la compuerta de c01).
          const sr = Object.assign({}, store.pref('solutionRevealed') || {});
          store.setPref('solutionRevealed', Object.assign({}, sr, { [id]: true }));
          MSD.App.rerender(); await sleep(80);
          ok(id + ': solución con 15 secciones', $$('#page section.sec').length === 15);
          ok(id + ': solución sin bloques rotos', broken().length === 0, broken());
          ok(id + ': diagramas con nodos', $$('#page .dg').every((d) => $$('.dg-node', d).length > 0));
          checkOverflow('#' + id + ' (solución)');
          store.setPref('solutionRevealed', sr);
          MSD.App.rerender(); await sleep(40);
        }
      } else {
        soon.push(id);
        ok(id + ': página "Próximamente"', !!$('#page .soon-note') && !!$('#page .chip--soon'));
        if (/^c/.test(id)) ok(id + ': botón "Practicar este enunciado"', !!$('#page a[href="#practica-' + id + '"]'));
      }
      ok(id + ': aria-current en el índice', !!$('#nav .nav__item[data-id="' + id + '"][aria-current="page"]'));
      checkOverflow('#' + id);
    }
    notes.proximamente = soon.length;
    for (const id of ['ref-numeros', 'ref-herramientas', 'ref-comandos', 'practica-c05']) {
      await go('#' + id);
      ok(id + ': renderiza', !!byId('page').querySelector('h1'), txt(byId('page')).slice(0, 80));
      const rp = MSD.getPage(id);
      if (/^ref-/.test(id) && rp && rp.ready) {
        ok(id + ': hoja con contenido', !$('#page .soon-note') && $$('#page section.sec').length === rp.sections.length);
        rp.sections.forEach((s) => ok(id + '.' + s.id + ': ancla', !!byId(id + '.' + s.id)));
      } else if (/^ref-/.test(id)) ok(id + ': Próximamente', !!$('#page .soon-note'));
      ok(id + ': sin bloques rotos', broken().length === 0, broken());
      checkOverflow('#' + id);
    }
    ok('practica-c05: la visita no crea borrador', store.getDraft('c05') === null);
  });

  // ------------------------------------------------------------------ 3. m01: secciones, diagrama, quiz, leída, completado
  await step('m01', async () => {
    await go('#inicio');
    await go('#m01.framework');
    const sec = byId('m01.framework');
    ok('#m01.framework existe', !!sec);
    if (sec) {
      await waitFor(() => Math.abs(sec.getBoundingClientRect().top) < 140, 1500);
      const top = Math.round(sec.getBoundingClientRect().top);
      ok('#m01.framework se desplaza al inicio de la sección', top >= -4 && top < 140, top);
      ok('#m01.framework enfoca el título', document.activeElement === $('.sec__title', sec));
    }
    const dgs = $$('#page .dg');
    ok('m01: diagramas con nodos', dgs.length > 0 && dgs.every((d) => $$('.dg-node', d).length > 0), dgs.length);
    const q = $('#page .quiz__opt');
    if (q) {
      q.click();
      ok('m01: quiz revela veredicto', !!$('#page .quiz__fb.is-right, #page .quiz__fb.is-wrong'));
    }
    ok('m01: tablas en contenedor desplazable', $$('#page .b-table').every((f) => !!$('.scroll-x', f)));

    // Marcar una sección como leída → progreso en el índice y en el uptime compacto.
    const p = MSD.getPage('m01');
    const first = p.sections[0].id;
    const rt = $('#page .read-toggle[data-sec="' + first + '"]');
    rt.click();
    ok('m01: sección marcada como leída en el store', store.isSectionRead('m01', first));
    ok('m01: botón en estado "Leída"', await waitFor(() => rt.getAttribute('aria-pressed') === 'true' && txt(rt) === 'Leída', 1000));
    ok('m01: anillo de progreso en el índice', !!(await waitFor(() => $('#nav .nav__item[data-id="m01"] .ring'), 1500)));
    ok('m01: celda "en curso" en el uptime compacto', !!(await waitFor(() => $('#side-uptime .ucell--progress'), 1500)));
    ok('m01: marca en el TOC', !!(await waitFor(() => $('#toc li.is-read[data-sec="' + first + '"], #page .page-toc li.is-read[data-sec="' + first + '"]'), 1500)));
    // Todas leídas + completado → "done" y contador 1/28.
    for (const s of p.sections) if (!store.isSectionRead('m01', s.id)) $('#page .read-toggle[data-sec="' + s.id + '"]').click();
    await sleep(60);
    $('#page .complete-toggle').click();
    ok('m01: módulo completado', store.pageProgress('m01').completed);
    ok('m01: check en el índice', !!(await waitFor(() => $('#nav .nav__item[data-id="m01"] .mk-done'), 1500)));
    ok('m01: contador del índice 1/28', await waitFor(() => txt($('#side-uptime .side-uptime__count')) === '1/28', 1500), txt($('#side-uptime .side-uptime__count')));
    ok('m01: contador de la barra superior 1/28', txt(byId('topbar-progress')) === '1/28');
    ok('m01: celda "completado" en el uptime compacto', $$('#side-uptime .ucell--done').length === 1);
    checkOverflow('#m01 (final)');
  });

  // ------------------------------------------------------------------ 4. c01: compuerta, 15 secciones, diagrama, calc, código, checklist
  await step('c01', async () => {
    await go('#c01');
    const gated = !!$('#page .gate');
    notes.c01Compuerta = gated;
    if (gated) {
      // La compuerta muestra solo el enunciado ambiguo: ni la tira de datos ni el resto de la sección 1.
      ok('c01: la compuerta no muestra spec strip ni la solución del enunciado', !$('#page .specstrip') && !!$('#page .gate .prompt-quote') && txt($('#page .gate')).indexOf('T4') < 0);
      ok('c01: la compuerta no muestra la solución', $$('#page section.sec').length === 0);
      ok('c01: la compuerta tiene un h2', !!$('#page .gate h2.gate__head'));
      ok('c01: botón "Practicar primero"', !!$('#page .gate a[href="#practica-c01"]'));
      const reveal = button('Ver la solución sin practicar', byId('page'));
      ok('c01: botón "Ver la solución sin practicar"', !!reveal);
      if (reveal) reveal.click();
      await waitFor(() => $$('#page section.sec').length === 15, 2000);
      ok('c01: preferencia solutionRevealed', !!(store.pref('solutionRevealed') || {}).c01);
    }
    ok('c01: spec strip con 4–6 datos', $$('#page .specstrip__item').length >= 4 && $$('#page .specstrip__item').length <= 6, $$('#page .specstrip__item').length);
    const ids = $$('#page section.sec').map((s) => s.dataset.sec);
    ok('c01: 15 secciones en el orden de la plantilla', JSON.stringify(ids) === JSON.stringify(MSD.CASE_TEMPLATE.map((t) => t.id)), ids);
    ok('c01: navegador de plantilla 1–15', $$('#page .tnav__item').length === 15);
    ok('c01: TOC numerado', $$('#toc .toc__link').length === 15);
    ok('c01: sin bloques rotos', broken().length === 0, broken());
    checkOverflow('#c01 (solución)');

    // Estimaciones: bloques calc
    const est = byId('c01.estimaciones');
    ok('c01: estimaciones con calc', $$('.calc .calc__row', est).length > 0);
    ok('c01: estimaciones marcadas (.est)', $$('#page span.est[title]').length > 0);

    // Diagrama de arquitectura: nodo → nota; recorrido paso a paso.
    // La sección tiene un MVP sin carriles y luego el diagrama completo (carriles + recorridos).
    const dgsA = $$('.dg', byId('c01.arquitectura'));
    const dg = dgsA.find((d) => !!$('.dg__flowbtn', d)) || dgsA[0];
    ok('c01: diagrama de arquitectura', !!dg, dgsA.length);
    if (dg) {
      ok('c01: carriles online/offline', !!$('.dg-l-online', dg) && !!$('.dg-l-offline', dg));
      const node = $$('.dg-node', dg).find((n) => n.getAttribute('data-node'));
      node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const note = $('.dg__note', dg);
      ok('c01: clic en nodo muestra "Por qué está aquí"', await waitFor(() => !note.hidden && txt($('.dg__note-body', note)).length > 10, 1000), txt(note).slice(0, 80));
      ok('c01: nodo seleccionado', node.getAttribute('aria-pressed') === 'true');
      key('Escape', node);
      ok('c01: Esc cierra la nota', await waitFor(() => note.hidden, 800));
      const fb = $('.dg__flowbtn', dg);
      ok('c01: hay recorridos guiados', !!fb);
      if (fb) {
        fb.click();
        const panel = $('.dg__step', dg);
        const count = $('.dg__step-count', dg);
        ok('c01: el recorrido abre el paso 1', await waitFor(() => !panel.hidden && /^1\//.test(txt(count)), 800), txt(count));
        const hl1 = $$('.dg-node.is-hl, .dg-edge.is-hl', dg).length;
        ok('c01: el paso resalta nodos o aristas', hl1 > 0);
        const text1 = txt($('.dg__step-text', dg));
        $('.dg__btn--primary', dg).click();
        ok('c01: "Siguiente" avanza al paso 2', await waitFor(() => /^2\//.test(txt(count)), 800), txt(count));
        ok('c01: el texto del paso cambia', txt($('.dg__step-text', dg)) !== text1);
        const prev = $$('.dg__btn', dg).find((b) => txt(b).indexOf('Anterior') >= 0);
        prev.click();
        ok('c01: "Anterior" vuelve al paso 1', await waitFor(() => /^1\//.test(txt(count)), 800));
        const exit = $$('.dg__btn', dg).find((b) => txt(b) === 'Salir');
        exit.click();
        ok('c01: "Salir" cierra el recorrido', panel.hidden);
      }
      ok('c01: lista "Componentes y por qué"', !!$('details.dg__list', dg));
    }

    // Seguimiento: followups junior vs senior
    ok('c01: followups junior/senior', $$('.fu__col--junior', byId('c01.seguimiento')).length > 0 && $$('.fu__col--senior', byId('c01.seguimiento')).length > 0);

    // Archivos: pestañas de código, botón copiar, ningún src faltante.
    const arch = byId('c01.archivos');
    const cx = $('.cx--tabs', arch);
    ok('c01: bloque de código con pestañas', !!cx);
    ok('c01: ningún archivo de referencia faltante', $$('.cx__warn, .cx__tab-warn', arch).length === 0);
    if (cx) {
      const tabs = $$('.cx__tab', cx);
      tabs[1].click();
      const panel1 = byId(tabs[1].getAttribute('aria-controls'));
      const panel0 = byId(tabs[0].getAttribute('aria-controls'));
      ok('c01: la pestaña 2 queda seleccionada', tabs[1].getAttribute('aria-selected') === 'true' && tabs[0].getAttribute('aria-selected') === 'false');
      ok('c01: se muestra el panel de la pestaña 2', visible(panel1) && !visible(panel0));
      ok('c01: el panel tiene código', txt($('.cx__code', panel1)).length > 20);
      ok('c01: botón "Copiar"', !!$('.cx__btn--copy', panel1));
    }
    ok('c01: resaltado de sintaxis', $$('.cx__code span', arch).length > 50);

    // Checklist final: persiste en el store y al volver a la página.
    const ckWrap = $('.checklist', byId('c01.checklist'));
    const listId = ckWrap.dataset.list;
    const box = $('.checklist__box', ckWrap);
    const before = Object.values(store.getChecklist('c01', listId)).filter(Boolean).length;
    box.click();
    ok('c01: checklist guarda el ítem', Object.values(store.getChecklist('c01', listId)).filter(Boolean).length === before + 1);
    await go('#inicio');
    await go('#c01.checklist');
    const box2 = $('.checklist .checklist__box', byId('c01.checklist'));
    ok('c01: el ítem sigue marcado al volver', !!box2 && box2.checked);
    ok('c01: contador del checklist', /^1 \/ \d+$/.test(txt($('.checklist__count', byId('c01.checklist')))), txt($('.checklist__count', byId('c01.checklist'))));
    store.flush();
    let ls = null;
    try { ls = localStorage.getItem('msd.v1'); } catch (e) { ls = null; }
    ok('c01: persistido en localStorage', !!ls && ls.indexOf('c01|' + listId + '|') >= 0);
  });

  // ------------------------------------------------------------------ 5. práctica: hub, reloj, autosave, rúbrica, historial
  await step('práctica', async () => {
    await go('#practica');
    ok('practica: 13 casos en el hub', $$('#page .phub__item').length === 13, $$('#page .phub__item').length);
    ok('practica: framework de 7 pasos', $$('#page .fwstrip__seg').length === 7);
    checkOverflow('#practica');

    await go('#practica-c01');
    ok('practica-c01: sin borrador al entrar', store.getDraft('c01') === null);
    const digits = $('#page .clock__digits');
    ok('practica-c01: reloj en 45:00', txt(digits) === '45:00', txt(digits));
    ok('practica-c01: raíl de 7 pasos', $$('#page .rail__step').length === 7);
    const run = $('#page .clock__run');
    run.click();
    ok('practica-c01: Empezar crea borrador en marcha', !!store.getDraft('c01') && store.getDraft('c01').running);
    ok('practica-c01: el reloj baja', !!(await waitFor(() => txt(digits) !== '45:00', 2500)), txt(digits));
    ok('practica-c01: paso actual en el raíl', $$('#page .rail__step.is-current').length === 1);
    run.click();
    const e1 = store.getDraft('c01').elapsedSec;
    ok('practica-c01: Pausa detiene el reloj', !store.getDraft('c01').running && e1 > 0, e1);
    ok('practica-c01: botón "Reanudar"', txt(run).indexOf('Reanudar') >= 0, txt(run));
    run.click();
    await sleep(1200);
    run.click();
    const e2 = store.getDraft('c01').elapsedSec;
    ok('practica-c01: el tiempo transcurrido aumenta', e2 > e1, { e1, e2 });
    checkOverflow('#practica-c01');

    // Autosave del texto
    const ta = $('#page .sim__text');
    const TEXT = 'Aclaro: 10 M imágenes/día, p99 200 ms. Gateway FastAPI + Triton en T4 con dynamic batching.';
    ta.focus();
    ta.value = TEXT;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ok('practica-c01: indicador "Guardando…"', txt($('#page .sim__save')).indexOf('Guardando') >= 0, txt($('#page .sim__save')));
    ok('practica-c01: autosave del texto', !!(await waitFor(() => (store.getDraft('c01') || {}).text === TEXT, 4000)));
    ok('practica-c01: indicador "Guardado"', await waitFor(() => txt($('#page .sim__save')).indexOf('Guardado') >= 0, 1000), txt($('#page .sim__save')));
    ta.blur();
    const skel = button('Insertar esqueleto', byId('page'));
    skel.click();
    ok('practica-c01: "Insertar esqueleto" agrega los 7 pasos', MSD.FRAMEWORK.every((s) => ta.value.indexOf(s.title) >= 0));
    // Sobrevive a la navegación
    await go('#inicio');
    await go('#practica-c01');
    ok('practica-c01: el texto sobrevive a la navegación', ($('#page .sim__text') || {}).value === ta.value);

    // Rúbrica
    const fin = $('#page .sim__foot .btn--primary');
    fin.click();
    const form = await waitFor(() => $('#page form.rub'), 2000);
    ok('practica-c01: vista de rúbrica', !!form);
    const fsets = $$('fieldset', form);
    ok('practica-c01: 6 dimensiones', fsets.length === 6, fsets.length);
    const submit = $('button[type="submit"]', form);
    submit.click();
    ok('practica-c01: guardar incompleto no crea intento', store.listAttempts('c01').length === 0);
    fsets.forEach((fs) => { const r = $('input.lvl__input[value="3"]', fs); if (r) r.click(); const b = $('.rdim__box', fs); if (b) b.click(); });
    ok('practica-c01: puntos clave del caso', $$('.rdim__box', form).length > 0);
    await sleep(60);
    submit.click();
    const res = await waitFor(() => $('#page .res'), 2000);
    ok('practica-c01: vista de resultado', !!res);
    const att = store.listAttempts('c01')[0];
    ok('practica-c01: intento guardado con puntaje 75 %', !!att && att.status === 'done' && att.score && att.score.pct === 75, att && att.score);
    ok('practica-c01: el borrador se cerró', store.getDraft('c01') === null);
    checkOverflow('#practica-c01 (resultado)');

    await go('#historial');
    const rows = $$('#page .hist__item');
    ok('historial: muestra el intento', rows.length >= 1 && txt(rows[0]).indexOf('75') >= 0, rows.length);
    const row = $('.hist__row', rows[0]);
    if (row) {
      row.click();
      ok('historial: el intento se expande con el texto', await waitFor(() => visible($('.hist__panel', rows[0])) && txt($('.hist__text', rows[0])).indexOf('Gateway FastAPI') >= 0, 1000));
    }
    checkOverflow('#historial');
    await go('#c01');
    ok('c01: con intento hecho, sin compuerta', !$('#page .gate') && $$('#page section.sec').length === 15);
  });

  // ------------------------------------------------------------------ 6. flashcards
  await step('flashcards', async () => {
    const ids = MSD.flashcards().map((c) => c.id);
    await go('#flashcards');
    const s0 = store.flashStats(ids);
    const rev = await waitFor(() => $('#page .fcard__reveal'), 1500);
    ok('flashcards: hay tarjeta pendiente', !!rev, txt(byId('page')).slice(0, 120));
    if (rev) {
      rev.click();
      const good = await waitFor(() => $('#page .grade--good'), 1000);
      ok('flashcards: "Mostrar respuesta" revela la respuesta', !!good && txt($('#page .fcard__ahtml')).length > 0);
      good.click();
      const s1 = store.flashStats(ids);
      ok('flashcards: calificar "Bien" registra la tarjeta', s1.seen === s0.seen + 1 && s1.boxes[1] === s0.boxes[1] + 1, { s0, s1 });
      // Teclado: Espacio muestra, 2 = Difícil
      blur();
      key(' ');
      ok('flashcards: Espacio muestra la respuesta', !!(await waitFor(() => $('#page .grade--hard'), 1000)));
      blur();
      key('2');
      ok('flashcards: tecla 2 califica', await waitFor(() => store.flashStats(ids).seen === s0.seen + 2, 1000));
    }
    checkOverflow('#flashcards');
  });

  // ------------------------------------------------------------------ 7. glosario
  await step('glosario', async () => {
    const terms = MSD.glossary();
    await go('#glosario');
    const input = await waitFor(() => byId('gl-q'), 1500);
    const rows = $$('#page .gl__row');
    ok('glosario: una fila por término', rows.length === terms.length, { rows: rows.length, terms: terms.length });
    input.value = 'latency';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const shown = rows.filter((r) => !r.hidden).length;
    ok('glosario: el filtro reduce la tabla', shown > 0 && shown < rows.length, shown);
    checkOverflow('#glosario (filtrado)');
    // Término oculto por el filtro: el hash lo muestra y lo desplaza.
    const target = terms.find((t) => { const r = byId('glosario.' + MSD.slug(t.en)); return r && r.hidden; }) || terms[terms.length - 1];
    const slugA = MSD.slug(target.en);
    await go('#glosario.' + slugA);
    const rowA = byId('glosario.' + slugA);
    ok('glosario: #glosario.<slug> marca la fila', !!rowA && rowA.classList.contains('is-target') && !rowA.hidden);
    ok('glosario: la fila queda a la vista', await waitFor(() => inViewport(rowA), 2000), rowA && Math.round(rowA.getBoundingClientRect().top));
    // Desde otra página
    const other = terms[Math.floor(terms.length / 2)];
    const slugB = MSD.slug(other.en);
    await go('#inicio');
    await go('#glosario.' + slugB);
    const rowB = byId('glosario.' + slugB);
    ok('glosario: desde otra página, la fila queda a la vista', !!rowB && (await waitFor(() => inViewport(rowB), 2000)), rowB && Math.round(rowB.getBoundingClientRect().top));
    checkOverflow('#glosario');
  });

  // ------------------------------------------------------------------ 8. búsqueda y atajos
  await step('búsqueda', async () => {
    await go('#inicio');
    const inp = byId('search-input');
    for (const q of ['p99', 'canary', 'metrica']) {
      inp.value = q;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      const n = $$('#search-results .sres').length;
      ok('búsqueda "' + q + '" devuelve resultados', n > 0 && !byId('search-results').hidden, n);
      notes['busqueda_' + q] = n;
    }
    ok('búsqueda sin acentos = con acentos', (() => {
      inp.value = 'métrica'; inp.dispatchEvent(new Event('input', { bubbles: true }));
      return $$('#search-results .sres').length === notes.busqueda_metrica;
    })());
    inp.value = 'canary';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    const before = location.hash;
    key('Enter', inp);
    ok('búsqueda: Enter abre el primer resultado', await waitFor(() => location.hash !== before, 1500), location.hash);
    ok('búsqueda: resultados cerrados tras abrir', byId('search-results').hidden);
    inp.value = '';
    await sleep(80);
    // Atajo "/"
    blur();
    key('/');
    ok('atajo "/" enfoca la búsqueda', await waitFor(() => document.activeElement === inp, 800));
    key('Escape', inp);
    if (drawerMode()) ok('Esc cierra el cajón', await waitFor(() => !byId('sidebar').classList.contains('is-open'), 800));
    else inp.blur();
    await sleep(60);
    // Atajos [ y ]
    await go('#m01');
    blur();
    // Se espera al router (hashchange es asíncrono), no solo a location.hash.
    const at = (id) => { const r = MSD.App.route(); return location.hash === '#' + id && r && r.pageId === id; };
    key(']');
    ok('atajo "]" va a m02', !!(await waitFor(() => at('m02'), 1500)), location.hash);
    blur();
    key('[');
    ok('atajo "[" vuelve a m01', !!(await waitFor(() => at('m01'), 1500)), location.hash);
    // "[" y "]" no se disparan mientras se escribe
    inp.focus();
    key(']', inp);
    await sleep(120);
    ok('atajos ignorados en campos de texto', location.hash === '#m01');
    inp.blur();
  });

  // ------------------------------------------------------------------ 9. tema, exportar/importar (dentro del cajón en móvil)
  await step('tema y respaldo', async () => {
    await go('#inicio');
    const sb = byId('sidebar');
    if (drawerMode()) {
      byId('menu-btn').click();
      ok('cajón: se abre con el botón de menú', await waitFor(() => sb.classList.contains('is-open') && byId('shell').inert, 800));
      ok('cajón: foco dentro del cajón', await waitFor(() => sb.contains(document.activeElement), 800));
    }
    const de = document.documentElement;
    const tb = (t) => $('#side-foot button[data-theme="' + t + '"]');
    tb('dark').click();
    ok('tema: Oscuro fija data-theme="dark"', de.getAttribute('data-theme') === 'dark' && store.pref('theme') === 'dark' && tb('dark').getAttribute('aria-pressed') === 'true');
    ok('tema: fondo oscuro aplicado', getComputedStyle(document.body).backgroundColor === 'rgb(16, 21, 27)', getComputedStyle(document.body).backgroundColor);
    tb('light').click();
    ok('tema: Claro fija data-theme="light"', de.getAttribute('data-theme') === 'light');
    ok('tema: fondo claro aplicado', getComputedStyle(document.body).backgroundColor === 'rgb(238, 241, 243)', getComputedStyle(document.body).backgroundColor);
    tb('system').click();
    ok('tema: Sistema quita data-theme', !de.hasAttribute('data-theme') && store.pref('theme') === 'system');

    // Exportar / importar
    const exp1 = store.exportJSON();
    let parsed = null;
    try { parsed = JSON.parse(exp1); } catch (e) { parsed = null; }
    ok('exportar: JSON válido y no vacío', !!parsed && parsed.app === 'ronda-diseno-ml' && parsed.state && Object.keys(parsed.state.progress.sections || {}).length > 0);
    byId('btn-portability').click();
    const modal = byId('modal');
    ok('exportar: se abre el panel', await waitFor(() => !modal.hidden && $('.modal__panel', modal), 800));
    const expTa = $('textarea[readonly]', modal);
    ok('exportar: el panel muestra el respaldo', !!expTa && expTa.value.length > 100 && JSON.parse(expTa.value).state.v === 1);
    const impTa = byId('import-text');
    const impBtn = button('Importar', modal);
    impTa.value = '{no es json';
    impBtn.click();
    ok('importar: JSON inválido muestra error', !!$('.result-msg.is-bad', modal));
    impTa.value = expTa.value;
    impBtn.click();
    ok('importar: el respaldo se importa', await waitFor(() => $('.result-msg.is-ok', modal), 800), txt($('.result-msg', modal)));
    const pick = (s) => { const x = JSON.parse(s).state; return JSON.stringify([x.progress, Object.keys(x.attempts).sort(), x.flash, x.checklists, x.prefs]); };
    ok('importar: ida y vuelta sin cambios', pick(store.exportJSON()) === pick(exp1));
    ok('importar: el progreso sigue ahí', store.pageProgress('m01').completed && store.listAttempts('c01').length === 1);
    key('Escape');
    ok('panel: Esc lo cierra', await waitFor(() => modal.hidden, 800));
    if (drawerMode()) {
      byId('drawer-close').click();
      ok('cajón: se cierra', await waitFor(() => !sb.classList.contains('is-open') && !byId('shell').inert, 800));
    }
  });

  // ------------------------------------------------------------------ 9b. mis notas: sección, término propio, página, glosario, búsqueda, flashcards
  await step('mis notas', async () => {
    const before = store.listNotes().length;
    await go('#m01');
    const secs = $$('#page section.sec');
    ok('notas: botón «Agregar nota» en cada sección', secs.length > 0 && secs.every((x) => !!$('.notes-btn', x)));
    const sec = secs[0];
    const btn = $('.notes-btn', sec);
    if (drawerMode()) btn.scrollIntoView({ block: 'center' });
    btn.click();
    const ta = await waitFor(() => $('.notes-form__text', sec), 1000);
    ok('notas: abre el formulario con el foco en el texto', !!ta && document.activeElement === ta);
    ta.value = 'Duda de prueba: <b>no</b> es HTML\nsegunda línea';
    button('Guardar', $('.notes__form', sec)).click();
    const card = await waitFor(() => $('.notes__list .note', sec), 1000);
    ok('notas: la nota aparece en la sección', !!card && $('.note__text', card).textContent === 'Duda de prueba: <b>no</b> es HTML\nsegunda línea');
    ok('notas: el texto se muestra como texto, no como HTML', !!card && !$('.note__text b', card));
    ok('notas: guardada en el store', store.listNotes().length === before + 1);
    ok('notas: el botón muestra el conteo', txt($('.notes-btn__n', sec)) === String(store.listNotes({ page: 'm01', section: sec.dataset.sec }).length));
    // Término propio desde la misma sección
    btn.click();
    await waitFor(() => $('.notes__form .notes-form', sec), 1000);
    button('Término para el glosario', sec).click();
    const termIn = $('.notes__form .notes-form__term', sec);
    ok('notas: el modo término pide el término', visible(termIn) && document.activeElement === termIn);
    termIn.value = 'Zeta de prueba';
    $('.notes__form .notes-form__text', sec).value = 'Definición propia de prueba.';
    button('Guardar', $('.notes__form', sec)).click();
    await waitFor(() => $$('.notes__list .note', sec).length >= 2, 1000);
    const term = store.listNotes({ kind: 'term' }).find((n) => n.term === 'Zeta de prueba');
    ok('notas: término guardado', !!term);
    // Editar la nota
    const first = $('.notes__list .note', sec);
    button('Editar', first).click();
    const eta = await waitFor(() => $('.notes-form__text', first), 800);
    eta.value = 'Nota editada';
    button('Guardar cambios', first).click();
    ok('notas: editar actualiza el texto', await waitFor(() => txt($('.note__text', $('.notes__list .note', sec))) === 'Nota editada', 800));
    checkOverflow('#m01 (con notas)');
    // Página Mis notas + marcador del índice
    await go('#mis-notas');
    ok('mis notas: título', txt(byId('page-title')) === 'Mis notas');
    ok('mis notas: lista las entradas', $$('#page .note').length === store.listNotes().length);
    ok('mis notas: el índice muestra el conteo', txt($('#nav .nav__item[data-id="mis-notas"] .mk-count')) === String(store.listNotes().length));
    const q = byId('mn-q');
    q.value = 'zeta';
    q.dispatchEvent(new Event('input', { bubbles: true }));
    ok('mis notas: el filtro funciona', $$('#page .note').length === 1);
    q.value = '';
    q.dispatchEvent(new Event('input', { bubbles: true }));
    checkOverflow('#mis-notas');
    // Glosario: el término propio sale con la marca «Mío»
    await go('#glosario.mio-' + term.id);
    const row = await waitFor(() => byId('glosario.mio-' + term.id), 1000);
    ok('glosario: el término propio está marcado «Mío»', !!row && txt($('.gl__src', row)) === 'Mío' && row.classList.contains('is-target'));
    // Búsqueda
    const inp = byId('search-input');
    inp.value = 'zeta de prueba';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    ok('búsqueda: encuentra tu término', $$('#search-results .sres').some((r) => txt($('.sres__type', r)) === 'Mi término'));
    inp.value = 'nota editada';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    ok('búsqueda: encuentra tu nota', $$('#search-results .sres').some((r) => txt($('.sres__type', r)) === 'Mi nota'));
    inp.value = '';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    blur();
    // Flashcards y exportar
    ok('flashcards: tu término entra al mazo', MSD.Flashcards.visibleCards(store).some((c) => c.id === 'mio-' + term.id));
    ok('exportar incluye las notas', !!JSON.parse(store.exportJSON()).state.notes.items[term.id]);
    // Borrar desde Mis notas (con confirmación en la página, sin confirm())
    await go('#mis-notas');
    const tcard = $('#page .note[data-note="' + term.id + '"]');
    button('Borrar', tcard).click();
    const yes = await waitFor(() => button('Sí, borrar', tcard), 800);
    yes.click();
    ok('mis notas: borrar quita la entrada', await waitFor(() => !store.getNote(term.id) && !$('#page .note[data-note="' + term.id + '"]'), 800));
    // Barra flotante + panel izquierdo
    await go('#m01');
    const nbar = $('.nbar');
    ok('barra de notas: visible en un módulo', visible(nbar));
    const secs2 = MSD.getPage('m01').sections;
    const target = secs2[2].id;
    await go('#m01.' + target);
    await sleep(150);
    button('Nota', nbar).click();
    const drawer = await waitFor(() => { const d = byId('notes-drawer'); return d && !d.hidden && d; }, 1000);
    ok('panel: se abre desde la barra', !!drawer);
    ok('panel: el formulario propone la sección que estás leyendo', $('.ndrawer__sel', drawer).value === target, $('.ndrawer__sel', drawer).value);
    ok('panel: foco en el texto', document.activeElement === $('.notes-form__text', drawer));
    $('.notes-form__text', drawer).value = 'Nota desde el panel';
    button('Guardar', $('.ndrawer__add', drawer)).click();
    ok('panel: la nota aparece en el panel', await waitFor(() => $$('.ndrawer__list .note', drawer).some((x) => txt($('.note__text', x)) === 'Nota desde el panel'), 1000));
    ok('panel: y también al final de su sección', await waitFor(() => $$('#page section.sec[data-sec="' + target + '"] .notes__list .note').some((x) => txt($('.note__text', x)) === 'Nota desde el panel'), 1000));
    ok('barra: el conteo de la página se actualiza', txt($('.nbar__n')) === String(store.listNotes({ page: 'm01' }).length));
    checkOverflow('#m01 (panel de notas abierto)');
    key('Escape', $('.ndrawer__title', drawer));
    ok('panel: Esc lo cierra', await waitFor(() => byId('notes-drawer').hidden, 800));
    await go('#practica');
    ok('barra de notas: oculta fuera de las páginas de contenido', !visible($('.nbar')));
    // "En esta página" plegable (solo existe con TOC visible, ≥ 1200 px)
    await go('#m01');
    const tg = $('#toc .toc__toggle');
    if (tg && visible(tg)) {
      const w0 = byId('page').getBoundingClientRect().width;
      tg.click();
      await sleep(80);
      ok('índice: se pliega', byId('shell').classList.contains('toc-collapsed') && !visible($('#toc .toc__list')));
      ok('índice: plegado, el contenido se ensancha', byId('page').getBoundingClientRect().width > w0 + 100, [w0, byId('page').getBoundingClientRect().width]);
      ok('índice: se recuerda', store.pref('tocCollapsed') === true);
      checkOverflow('#m01 (índice plegado)');
      $('#toc .toc__toggle').click();
      await sleep(80);
      ok('índice: se despliega', !byId('shell').classList.contains('toc-collapsed') && visible($('#toc .toc__list')));
    } else notes.indice_plegable = 'sin TOC en este ancho';
    // Limpieza: deja el estado como estaba
    store.listNotes().slice(before).forEach((n) => store.deleteNote(n.id));
    ok('notas: limpieza', store.listNotes().length === before);
  });

  // ------------------------------------------------------------------ 9c. práctica de M01
  await step('práctica M01', async () => {
    await go('#m01');
    const cta = $('#page .drill-cta a[href="#practicar-m01"]');
    ok('práctica: botón «Practicar M01» en el módulo', !!cta);
    await go('#practicar-m01');
    ok('práctica: título', /^Practicar M01/.test(txt(byId('page-title'))));
    ok('práctica: el índice marca M01', !!$('#nav .nav__item[data-id="m01"][aria-current="page"]'));
    // Apuntes
    button('Formulario').click();
    const panel = await waitFor(() => { const p = byId('drill-panel'); return p && !p.hidden && p; }, 800);
    ok('apuntes: el formulario se abre', !!panel && $$('.dform', panel).length >= 8);
    button('Notas rápidas', panel).click();
    ok('apuntes: notas rápidas', $$('.dquick', panel).length >= 5);
    checkOverflow('#practicar-m01 (apuntes abiertos)');
    key('Escape', $('.dpanel__title', panel));
    ok('apuntes: Esc los cierra', await waitFor(() => byId('drill-panel').hidden, 800));
    // Una ronda completa, contestando bien
    button('Nueva ronda').click();
    const rd = await waitFor(() => MSD.Drill.current('m01'), 800);
    ok('ronda: 10 preguntas (6 + 4)', !!rd && rd.items.length === 10 && rd.items.filter((x) => x.kind === 'calc').length === 4, rd && rd.items.length);
    for (let i = 0; rd && i < rd.items.length; i++) {
      const it = rd.items[i];
      const card = await waitFor(() => $('#page .dq'), 800);
      if (it.kind === 'mcq') {
        const k = it.options.findIndex((o) => o.ok);
        $('input[value="' + k + '"]', card).click();
      } else {
        const inp = $('.dq__num', card);
        inp.value = String(Math.round(it.answer * 1000) / 1000);
      }
      button('Comprobar', card).click();
      await waitFor(() => $('#page .dq__res'), 800);
      if (i === 0) ok('ronda: muestra la explicación y el enlace para repasar', !!$('#page .dq__res a[href^="#m01."]'));
      button(i === rd.items.length - 1 ? 'Ver resultado' : 'Siguiente').click();
    }
    ok('ronda: 10 de 10 contestando bien', await waitFor(() => /^10 de 10/.test(txt(byId('drill-score'))), 1000), txt(byId('drill-score')));
    ok('ronda: guarda las estadísticas', (store.pref('drillStats') || {}).m01 && store.pref('drillStats').m01.best === 100);
    // Una respuesta de cálculo fuera de tolerancia cuenta como error
    button('Nueva ronda').click();
    const rd2 = await waitFor(() => MSD.Drill.current('m01') !== rd && MSD.Drill.current('m01'), 800);
    const ci = rd2.items.findIndex((x) => x.kind === 'calc');
    rd2.i = ci;
    MSD.App.navigate('#practicar-m01');
    await go('#inicio');
    await go('#practicar-m01');
    const card2 = await waitFor(() => $('#page .dq__num'), 800);
    card2.value = String(rd2.items[ci].answer * 3);
    button('Comprobar').click();
    ok('ronda: un cálculo 3× fuera de rango es incorrecto', await waitFor(() => $('#page .dq.is-bad'), 800));
    checkOverflow('#practicar-m01');
    button('Terminar ronda').click();
    await go('#inicio');
  });

  // ------------------------------------------------------------------ 9d. banco de problemas
  await step('banco de problemas', async () => {
    await go('#problemas');
    ok('banco: título', txt(byId('page-title')) === 'Banco de problemas');
    ok('banco: está en el índice', !!$('#nav .nav__item[data-id="problemas"][aria-current="page"]'));
    const bank = MSD.problemBank && MSD.problemBank.estimaciones;
    ok('banco: sección Estimaciones cargada', !!bank && bank.templates.length >= 30, bank && bank.templates.length);
    // Solo Tráfico, modo Auto: 3 aciertos seguidos suben a nivel 2
    for (const c of $$('#page .bank__chip[data-topic]')) if (c.dataset.topic !== 'trafico' && c.getAttribute('aria-pressed') === 'true') c.click();
    ok('banco: filtro de tema', $$('#page .bank__chip[data-topic][aria-pressed="true"]').map((c) => c.dataset.topic).join() === 'trafico');
    const answerAll = async (good) => {
      const pb = MSD.Bank.current('estimaciones');
      for (let k = 0; k < pb.data.parts.length; k++) {
        const part = pb.data.parts[k];
        const cur = await waitFor(() => $('#page .bank__part.is-current'), 800);
        if (Array.isArray(part.choices)) $('input[value="' + (good ? part.answer : (part.answer + 1) % part.choices.length) + '"]', cur).click();
        else $('input', cur).value = String(good ? part.answer : part.answer * 10 + 7);
        button('Comprobar', $('#page .bank__card')).click();
        await sleep(40);
      }
      return pb;
    };
    button('Empezar').click();
    for (let i = 0; i < 3; i++) {
      await waitFor(() => MSD.Bank.current('estimaciones') && !MSD.Bank.current('estimaciones').done, 800);
      const pb = await answerAll(true);
      ok('banco: problema ' + (i + 1) + ' resuelto bien (' + pb.tpl.id + ')', pb.done && pb.ok);
      if (i === 0) ok('banco: muestra la solución y qué decide el número', !!$('#page .bank__part .dq__steps') && !!$('#page #pb-res'));
      if (i < 2) button('Siguiente problema').click();
    }
    ok('banco: 3 aciertos seguidos suben a nivel 2', ((store.pref('problemStats') || {}).estimaciones || {}).trafico.level === 2);
    ok('banco: el chip muestra el nivel nuevo', /Nv 2/.test(txt($('#page .bank__chip[data-topic="trafico"]'))));
    // Un problema mal y uno con «Ver solución»
    button('Siguiente problema').click();
    await waitFor(() => MSD.Bank.current('estimaciones') && !MSD.Bank.current('estimaciones').done, 800);
    const bad = await answerAll(false);
    ok('banco: respuesta fuera de rango es incorrecta', bad.done && !bad.ok);
    button('Siguiente problema').click();
    await waitFor(() => MSD.Bank.current('estimaciones') && !MSD.Bank.current('estimaciones').done, 800);
    if (MSD.Bank.current('estimaciones').data.hint) {
      button('Pista').click();
      ok('banco: la pista muestra el planteamiento', !!(await waitFor(() => $('#page .bank__hint'), 600)));
    }
    button('Ver solución').click();
    ok('banco: ver solución cuenta como fallo y muestra los pasos', await waitFor(() => MSD.Bank.current('estimaciones').done && !MSD.Bank.current('estimaciones').ok && $('#page .bank__part .dq__steps'), 800));
    ok('banco: 2 fallos seguidos bajan a nivel 1', ((store.pref('problemStats') || {}).estimaciones || {}).trafico.level === 1);
    // Cambiar de tema a media pregunta cambia el problema (sin contarlo)
    button('Siguiente problema').click();
    await waitFor(() => MSD.Bank.current('estimaciones') && !MSD.Bank.current('estimaciones').done, 800);
    const countBefore = txt($('#page .bank__sess'));
    $('#page .bank__chip[data-topic="costo"]').click();
    $('#page .bank__chip[data-topic="trafico"]').click();
    ok('banco: cambiar de tema cambia el problema en curso', await waitFor(() => MSD.Bank.current('estimaciones').topic === 'costo' && $('#page .bank__card .chip') && /Costo/.test(txt($('#page .bank__card .chip'))), 800), MSD.Bank.current('estimaciones').topic);
    ok('banco: el cambio no cuenta como problema', txt($('#page .bank__sess')) === countBefore);
    const prevPb = MSD.Bank.current('estimaciones');
    button('Saltar problema').click();
    ok('banco: saltar da otro problema sin contarlo', await waitFor(() => MSD.Bank.current('estimaciones') !== prevPb && !MSD.Bank.current('estimaciones').done, 800) && txt($('#page .bank__sess')) === countBefore);
    button('Reiniciar sesión').click();
    ok('banco: reiniciar sesión vuelve al inicio con contadores en cero', await waitFor(() => !MSD.Bank.current('estimaciones') && !!button('Empezar'), 800) && /^Elige temas/.test(txt($('#page .bank__sess'))));
    button('Reiniciar niveles').click();
    const yesBtn = await waitFor(() => button('Sí, reiniciar'), 800);
    ok('banco: reiniciar niveles pide confirmación', !!yesBtn);
    yesBtn.click();
    ok('banco: reiniciar niveles borra los niveles', await waitFor(() => !((store.pref('problemStats') || {}).estimaciones), 800));
    // Casos completos: «Diseña un proyecto» y «Arregla o mejora» traen una decisión, cálculos y la solución de cada parte
    for (const tp of ['proyecto', 'diagnostico']) {
      const chip = $('#page .bank__chip[data-topic="' + tp + '"]');
      ok('banco: tema ' + tp, !!chip);
      if (!chip) continue;
      if (chip.getAttribute('aria-pressed') !== 'true') chip.click();
      for (const c of $$('#page .bank__chip[data-topic]')) if (c.dataset.topic !== tp && c.getAttribute('aria-pressed') === 'true') c.click();
      (button('Empezar') || button('Siguiente problema')).click();
      const cur = await waitFor(() => { const p = MSD.Bank.current('estimaciones'); return p && !p.done && p.topic === tp && p; }, 800);
      ok('banco: problema de ' + tp, !!cur, cur && cur.topic);
      if (!cur) continue;
      const parts = cur.data.parts;
      ok('banco: ' + tp + ' trae decisión y cálculos (' + cur.tpl.id + ')', parts.some((p) => Array.isArray(p.choices)) && parts.filter((p) => !Array.isArray(p.choices)).length >= 2);
      const pb = await answerAll(true);
      ok('banco: ' + tp + ' resuelto bien (' + pb.tpl.id + ')', pb.done && pb.ok);
      ok('banco: ' + tp + ' muestra los pasos de cada parte', $$('#page .bank__part .dq__steps').length === parts.length);
      checkOverflow('#problemas (' + tp + ')');
    }
    // Deja seleccionados todos los temas otra vez («Todos» se guarda como null para que un tema nuevo aparezca seleccionado)
    button('Todos').click();
    ok('banco: «Todos» se guarda sin lista fija', ((store.pref('problemPrefs') || {}).estimaciones || {}).topics === null);
    // Apuntes
    button('Formulario').click();
    const panel = await waitFor(() => { const p = byId('drill-panel'); return p && !p.hidden && p; }, 800);
    ok('banco: el formulario se abre con fórmulas', !!panel && $$('.dform', panel).length >= 10);
    ok('banco: las fórmulas no muestran etiquetas HTML', !$$('.dform', panel).some((el) => /<\/?[a-z]/i.test(el.textContent)));
    button('Números de referencia', panel).click();
    ok('banco: números de referencia', $$('.dquick', panel).length >= 3);
    checkOverflow('#problemas (apuntes abiertos)');
    key('Escape', $('.dpanel__title', panel));
    checkOverflow('#problemas');
    await go('#inicio');
    ok('banco: al salir se quita el panel', !byId('drill-panel'));
  });

  // ------------------------------------------------------------------ 9e. banco: casos de diseño
  await step('banco: casos de diseño', async () => {
    const bank = MSD.problemBank && MSD.problemBank.casos;
    ok('casos: sección cargada', !!bank && bank.templates.length >= 30, bank && bank.templates.length);
    if (!bank) return;
    await go('#problemas.casos');
    ok('casos: la sección queda activa', !!$('#page .bank__sec[aria-current="page"][href="#problemas.casos"]'));
    ok('casos: la barra muestra las secciones', $$('#page .bank__sec').length >= 2);
    const topics = bank.topics.map((t) => t.id);
    ok('casos: un chip por tema', topics.every((t) => $('#page .bank__chip[data-topic="' + t + '"]')), topics);
    ok('casos: cada tema tiene nivel 1', topics.every((t) => bank.templates.some((x) => x.topic === t && x.level === 1)));
    const solve = async () => {
      const pb = MSD.Bank.current('casos');
      for (let k = 0; k < pb.data.parts.length; k++) {
        const part = pb.data.parts[k];
        const cur = await waitFor(() => $('#page .bank__part.is-current'), 800);
        if (Array.isArray(part.choices)) $('input[value="' + part.answer + '"]', cur).click();
        else $('input', cur).value = String(part.answer);
        button('Comprobar', $('#page .bank__card')).click();
        await sleep(40);
      }
      return pb;
    };
    // Un problema de nivel 1 por tema: decisión + cálculo, resuelto bien, con los pasos de cada parte
    for (const tp of topics) {
      const chip = $('#page .bank__chip[data-topic="' + tp + '"]');
      if (chip.getAttribute('aria-pressed') !== 'true') chip.click();
      for (const c of $$('#page .bank__chip[data-topic]')) if (c.dataset.topic !== tp && c.getAttribute('aria-pressed') === 'true') c.click();
      const go2 = button('Empezar') || button('Siguiente problema');
      if (go2) go2.click();
      const cur = await waitFor(() => { const p = MSD.Bank.current('casos'); return p && !p.done && p.topic === tp && p; }, 800);
      ok('casos: problema de ' + tp, !!cur, cur && cur.topic);
      if (!cur) continue;
      ok('casos: ' + tp + ' empieza en nivel 1 (' + cur.tpl.id + ')', cur.level === 1);
      ok('casos: ' + tp + ' trae una decisión y un cálculo', cur.data.parts.some((p) => Array.isArray(p.choices)) && cur.data.parts.some((p) => !Array.isArray(p.choices)));
      const pb = await solve();
      ok('casos: ' + tp + ' resuelto bien (' + pb.tpl.id + ')', pb.done && pb.ok);
      ok('casos: ' + tp + ' muestra los pasos de cada parte', $$('#page .bank__part .dq__steps').length === pb.data.parts.length);
      checkOverflow('#problemas.casos (' + tp + ')');
    }
    button('Todos').click();
    button('Formulario').click();
    const panel = await waitFor(() => { const p = byId('drill-panel'); return p && !p.hidden && p; }, 800);
    ok('casos: formulario con fórmulas de los temas', !!panel && $$('.dform', panel).length >= topics.length);
    ok('casos: las fórmulas no muestran etiquetas HTML', !$$('.dform', panel).some((el) => /<\/?[a-z]/i.test(el.textContent)));
    button('Números de referencia', panel).click();
    ok('casos: tarjetas de referencia (patrón, piezas y números)', $$('.dquick', panel).length >= 5);
    key('Escape', $('.dpanel__title', panel));
    await go('#inicio');
  });

  // ------------------------------------------------------------------ 10. ruta desconocida
  await step('no encontrado', async () => {
    await go('#no-existe-esta-ruta');
    ok('ruta desconocida: página "no encontrado"', txt(byId('page-title')) === 'No encontramos esta página');
    ok('ruta desconocida: enlace al inicio', !!$('#page a[href="#inicio"]'));
    checkOverflow('#no-existe-esta-ruta');
    await go('#inicio');
  });

  const summary = {
    ok: fails.length === 0,
    pasaron: passes.length,
    fallaron: fails.length,
    fallas: fails,
    desborde: overflow,
    notas: notes,
    segundos: Math.round((performance.now() - T0) / 100) / 10,
  };
  if (fails.length) console.error('[smoke] ' + fails.length + ' fallas de ' + (passes.length + fails.length) + ' comprobaciones');
  else console.log('[smoke] OK: ' + passes.length + ' comprobaciones en ' + summary.segundos + ' s');
  return summary;
})();
