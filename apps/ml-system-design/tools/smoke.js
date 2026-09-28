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
    ok('módulos del shell cargados', ['App', 'Blocks', 'Diagram', 'Code', 'Practice', 'Flashcards', 'Reference', 'store', 'dom'].every((k) => !!MSD[k]),
      ['App', 'Blocks', 'Diagram', 'Code', 'Practice', 'Flashcards', 'Reference', 'store', 'dom'].filter((k) => !MSD[k]));
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
    ok('c01: spec strip con 4–6 datos', $$('#page .specstrip__item').length >= 4 && $$('#page .specstrip__item').length <= 6, $$('#page .specstrip__item').length);
    const gated = !!$('#page .gate');
    notes.c01Compuerta = gated;
    if (gated) {
      ok('c01: la compuerta no muestra la solución', $$('#page section.sec').length === 0);
      ok('c01: botón "Practicar primero"', !!$('#page .gate a[href="#practica-c01"]'));
      const reveal = button('Ver la solución sin practicar', byId('page'));
      ok('c01: botón "Ver la solución sin practicar"', !!reveal);
      if (reveal) reveal.click();
      await waitFor(() => $$('#page section.sec').length === 15, 2000);
      ok('c01: preferencia solutionRevealed', !!(store.pref('solutionRevealed') || {}).c01);
    }
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
