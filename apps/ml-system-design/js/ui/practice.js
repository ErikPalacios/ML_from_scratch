/* =============================================================================
   Ronda de Diseño ML — js/ui/practice.js
   MSD.Practice.render(container, route, ctx) (SPEC §7.2):
     'practica'      → hub: los 13 casos con dificultad, frecuencia, mejor puntaje y borrador
     'practica-cNN'  → sesión: enunciado, reloj de 45:00 con el framework de 7 pasos,
                       texto con autoguardado → rúbrica (6 dimensiones) → resultado
     'historial'     → intentos (más recientes primero), detalle, borrado con confirmación
   Todo el estado persistente pasa por MSD.store (§4.4); aquí solo hay estado de vista.
   ========================================================================== */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});
  const D = MSD.dom;
  const { h, icon } = D;

  const TOTAL_MIN = 45;
  const TOTAL_SEC = TOTAL_MIN * 60;
  const SAVE_DELAY = 1000;       // autoguardado: ~1 s después de la última tecla…
  const SAVE_MAX_WAIT = 5000;    // …pero nunca más de 5 s sin guardar si sigues escribiendo
  const MAX_TEXT = 100000;       // mismo tope que el store (un documento por intento)
  const LEVEL_TAG = ['Débil', 'Básico', 'Sólido', 'Senior'];
  const DIFF_LABEL = { intro: 'intro', media: 'media', alta: 'alta' };
  const FREQ_LABEL = { alta: 'alta', media: 'media', baja: 'baja' };
  // Dimensión débil → sección de M01 que la trabaja (solo se enlaza si existe).
  const M01_FOR_DIM = {
    aclaracion: 'preguntas-aclaracion', estimaciones: 'estimaciones-express', arquitectura: 'ciclo-de-vida',
    tradeoffs: 'senales', monitoreo: 'ciclo-de-vida', comunicacion: 'framework',
  };
  // Dimensión → sección de la solución del caso donde compararte.
  const CASE_SEC_FOR_DIM = {
    aclaracion: 'aclaracion', estimaciones: 'estimaciones', arquitectura: 'arquitectura',
    tradeoffs: 'tradeoffs', monitoreo: 'monitoreo', comunicacion: 'enunciado',
  };

  // ------------------------------------------------------------------ utilidades
  const safe = (fn, dflt) => { try { const v = fn(); return v === undefined ? dflt : v; } catch (e) { return dflt; } };
  const pad2 = (n) => String(n).padStart(2, '0');
  const fw = () => (Array.isArray(MSD.FRAMEWORK) ? MSD.FRAMEWORK : []);
  const dims = () => (Array.isArray(MSD.RUBRIC_DIMENSIONS) ? MSD.RUBRIC_DIMENSIONS : []);
  const caseLabel = (id) => String(id || '').toUpperCase();
  const strip = (s) => (typeof MSD.stripHtml === 'function' ? MSD.stripHtml(s) : String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
  const fmtInt = (n) => Number(n || 0).toLocaleString('en-US');
  const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
  const plural = (n, one, many) => fmtInt(n) + ' ' + (n === 1 ? one : many);
  const reduced = () => (D.reducedMotion ? D.reducedMotion() : false);
  const toast = (msg, kind) => { if (typeof D.toast === 'function') D.toast(msg, kind); };
  const fmtDate = (ts) => (typeof D.fmtDate === 'function' ? D.fmtDate(ts) : new Date(ts).toLocaleString());

  function meta(id) {
    const c = safe(() => MSD.catalog(), null);
    return (c && c.items && c.items[id]) || {};
  }
  function getPage(id) { return safe(() => MSD.getPage(id), null); }

  function elapsedOf(d) {
    if (!d) return 0;
    let e = Number(d.elapsedSec) || 0;
    if (d.running && typeof d.resumedAt === 'number') e += Math.max(0, (Date.now() - d.resumedAt) / 1000);
    return e;
  }

  // Paso esperado según el tiempo transcurrido. over = ya pasaron los 45 min.
  function stepAt(e) {
    const F = fw();
    const min = e / 60;
    const idx = F.findIndex((s) => min < s.to);
    return { idx: idx < 0 ? F.length : idx, over: idx < 0 };
  }

  // "63 %" con la unidad más pequeña (en mono, el espacio y el % se ven demasiado anchos).
  const pctEl = (n) => (n == null ? '—' : [String(n), h('span', { class: 'pct-u' }, '\u00a0%')]);
  const pctOf = (a) => (a && a.score && typeof a.score.pct === 'number' ? Math.round(a.score.pct) : null);
  const wordCount = (t) => (String(t || '').match(/\S+/g) || []).length;
  const levelClass = (lvl) => (lvl >= 4 ? 'lv-4' : lvl === 3 ? 'lv-3' : lvl >= 1 ? 'lv-low' : 'lv-0');

  function excerpt(html, max) {
    const t = strip(html);
    if (t.length <= max) return t;
    const cut = t.slice(0, max);
    return cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20)).replace(/[,.;:]$/, '') + '…';
  }

  function header(o) {
    const eb = h('p', { class: 'eyebrow' });
    (o.eyebrow || []).forEach((p, i) => {
      if (i) eb.appendChild(h('span', { class: 'sep', 'aria-hidden': 'true' }, '·'));
      eb.appendChild(typeof p === 'string' ? h('span', null, p) : p);
    });
    return h('header', { class: 'phead' + (o.cls ? ' ' + o.cls : '') },
      eb,
      h('h1', { class: 'phead__title', id: 'page-title', tabindex: '-1' }, o.title || ''),
      o.en ? h('p', { class: 'phead__en', lang: 'en' }, o.en) : null,
      o.summary ? h('p', { class: 'phead__summary', html: String(o.summary) }) : null,
      o.after || null);
  }

  function freqEl(f) {
    if (!FREQ_LABEL[f]) return null;
    return h('span', { class: 'freq freq--' + f, title: 'Qué tan seguido aparece en entrevistas de ML System Design' },
      h('span', { class: 'freq__bars', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
      h('span', null, 'Frecuencia: ', h('b', null, FREQ_LABEL[f])));
  }

  // Confirmación en línea (el sandbox no permite confirm()): el disparador se oculta y aparece
  // "pregunta [Sí] [No]". El foco va a "No" para que un Enter doble no borre nada.
  function inlineConfirm(trigger, question, yesLabel, onYes) {
    const no = h('button', { type: 'button', class: 'btn btn--sm' }, 'No');
    const yes = h('button', { type: 'button', class: 'btn btn--sm btn--danger' }, yesLabel);
    const box = h('span', { class: 'iconfirm', role: 'group', 'aria-label': question },
      h('span', { class: 'iconfirm__q' }, question), yes, no);
    const cleanup = () => { box.remove(); trigger.hidden = false; };
    const cancel = () => { cleanup(); trigger.focus(); };
    no.addEventListener('click', cancel);
    yes.addEventListener('click', () => { cleanup(); onYes(); });
    box.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); } });
    trigger.hidden = true;
    trigger.after(box);
    no.focus();
    return box;
  }

  // Barra de nivel 1–4 en celdas (resultado, historial).
  function levelCells(lvl) {
    return h('span', { class: 'lvcells ' + levelClass(lvl), 'aria-hidden': 'true' },
      [1, 2, 3, 4].map((n) => h('i', { class: n <= lvl ? 'on' : null })));
  }

  // Franja del framework: 7 segmentos proporcionales a sus minutos.
  function fwStrip() {
    const F = fw();
    return h('ol', { class: 'fwstrip', 'aria-label': 'Framework de 7 pasos en 45 minutos' },
      F.map((s) => h('li', { class: 'fwstrip__seg', style: { flexGrow: String(s.minutes) }, title: s.num + '. ' + s.title + ' — ' + s.en + ' (' + s.from + '–' + s.to + ' min)' },
        h('span', { class: 'fwstrip__top' }, h('span', { class: 'fwstrip__n' }, String(s.num)), h('span', { class: 'fwstrip__m' }, h('span', { 'aria-hidden': 'true' }, s.from + '–' + s.to + '′'), h('span', { class: 'sr-only' }, ', minutos ' + s.from + ' a ' + s.to))),
        h('span', { class: 'fwstrip__t' }, s.title))));
  }

  // ================================================================== HUB
  function renderHub(c, store) {
    const m = meta('practica');
    c.appendChild(header({
      eyebrow: ['Parte 3', 'Práctica'],
      title: m.title || 'Simulador de entrevista',
      en: m.titleEn || 'Interview simulator',
      summary: m.summary || 'Elige un caso y diséñalo en 45 minutos con el reloj y el framework de 7 pasos a la vista; después, autoevaluación con rúbrica y la solución.',
    }));

    const m01 = getPage('m01');
    const hasFw = m01 && Array.isArray(m01.sections) && m01.sections.some((s) => s.id === 'framework');
    c.appendChild(h('section', { class: 'phow', 'aria-labelledby': 'phow-h' },
      h('h2', { class: 'px-k', id: 'phow-h' }, 'Cómo funciona una ronda'),
      h('ol', { class: 'phow__steps' },
        h('li', null, h('b', null, '45 minutos con reloj'), ' y sin mirar la solución. El reloj te dice en qué paso del framework deberías ir.'),
        h('li', null, h('b', null, 'Autoevaluación'), ': seis dimensiones con niveles 1–4 y los puntos clave del caso. Sé estricto, como el entrevistador.'),
        h('li', null, h('b', null, 'Solución'), ': recién entonces compara con las 15 secciones del caso resuelto.')),
      fwStrip(),
      h('p', { class: 'phow__more' }, 'El porqué de cada paso: ',
        h('a', { href: hasFw ? '#m01.framework' : '#m01' }, 'M01 · framework de 7 pasos'), '.')));

    const cases = safe(() => MSD.listPages('case'), []);
    const drafts = store.listAttempts({ includeDrafts: true }).filter((a) => a.status === 'draft');
    const readyN = cases.filter((p) => p.ready).length;
    c.appendChild(h('section', { class: 'phub', 'aria-labelledby': 'phub-h' },
      h('div', { class: 'phub__head' },
        h('h2', { class: 'px-k', id: 'phub-h' }, 'Elige un enunciado'),
        h('span', { class: 'phub__count mono' }, cases.length + ' casos · ' + readyN + ' con solución' + (drafts.length ? ' · ' + plural(drafts.length, 'borrador', 'borradores') : ''))),
      cases.length
        ? h('ol', { class: 'phub__list' }, cases.map((p) => hubRow(p, store)))
        : h('p', { class: 'muted' }, 'No se cargó el catálogo de casos. Recarga la página.')));
  }

  function hubRow(p, store) {
    const id = p.id;
    const draft = store.getDraft(id);
    const attempts = store.listAttempts(id);
    const scores = attempts.map(pctOf).filter((x) => x != null);
    const best = scores.length ? Math.max.apply(null, scores) : null;
    const ready = !!p.ready;
    const ex = p.prompt ? excerpt(p.prompt, 200) : '';
    return h('li', { class: 'phub__item' + (draft ? ' has-draft' : '') },
      h('span', { class: 'phub__id mono', 'aria-hidden': 'true' }, caseLabel(id)),
      h('div', { class: 'phub__main' },
        h('h3', { class: 'phub__title' }, h('span', { class: 'sr-only' }, caseLabel(id) + ': '), p.title || caseLabel(id)),
        ex ? h('p', { class: 'phub__prompt' }, '«' + ex + '»') : null,
        h('div', { class: 'phub__meta' },
          p.difficulty ? h('span', { class: 'phub__diff' }, 'Dificultad: ', h('b', null, DIFF_LABEL[p.difficulty] || p.difficulty)) : null,
          freqEl(p.freq),
          ready
            ? h('span', { class: 'chip chip--ok' }, h('span', { html: icon('check') }), 'Con solución')
            : h('span', { class: 'chip chip--soon' }, 'Solución en una fase posterior'))),
      h('div', { class: 'phub__side' },
        h('div', { class: 'phub__score' },
          best != null
            ? [h('span', { class: 'phub__best mono' }, pctEl(best)), h('span', { class: 'phub__sk' }, 'mejor de ' + plural(attempts.length, 'intento', 'intentos'))]
            : h('span', { class: 'phub__sk' }, attempts.length ? plural(attempts.length, 'intento', 'intentos') : 'Sin intentos')),
        draft ? h('div', { class: 'phub__draft' }, h('span', { class: 'phub__dot', 'aria-hidden': 'true' }),
          'Borrador · ', h('span', { class: 'mono' }, D.fmtDuration(elapsedOf(draft))), draft.running ? ' (reloj en marcha)' : '') : null,
        h('div', { class: 'phub__actions' },
          h('a', { class: 'btn btn--sm' + (draft ? ' btn--primary' : ''), href: '#practica-' + id, 'aria-label': (draft ? 'Continuar borrador de ' : 'Empezar ') + caseLabel(id) + ': ' + (p.title || '') },
            h('span', { html: icon(draft ? 'arrow-right' : 'play') }), draft ? 'Continuar borrador' : 'Empezar'),
          attempts.length ? h('a', { class: 'btn btn--sm btn--ghost', href: '#historial.' + id }, 'Ver intentos (' + attempts.length + ')') : null)));
  }

  // ================================================================== SESIÓN
  let active = null;   // controlador de la sesión montada

  function teardownActive() {
    if (!active) return;
    const a = active;
    active = null;
    try { a.teardown(); } catch (e) { if (root.console) root.console.error('[practice] teardown', e); }
  }

  function renderMissingCase(c, caseId) {
    c.appendChild(header({ eyebrow: ['Parte 3', 'Práctica'], title: 'Ese caso no existe' }));
    c.appendChild(h('p', { class: 'b-p' }, 'No hay un caso ', h('code', null, caseLabel(caseId) || '—'), ' en el catálogo.'));
    c.appendChild(h('p', { style: { marginTop: '16px' } }, h('a', { class: 'btn btn--primary', href: '#practica' }, 'Ver los 13 casos')));
  }

  function phaseStepper() {
    const phases = [['edit', 'Diseño', '45 min'], ['rubric', 'Autoevaluación', 'rúbrica'], ['result', 'Resultado', 'y solución']];
    const items = phases.map(([id, t, s], i) => h('li', { class: 'pstep__item', dataset: { phase: id } },
      h('span', { class: 'pstep__n', 'aria-hidden': 'true' }, String(i + 1)),
      h('span', { class: 'pstep__t' }, t, h('span', { class: 'pstep__s' }, ' · ' + s))));
    const el = h('ol', { class: 'pstep', 'aria-label': 'Etapas de la práctica' }, items);
    return {
      el,
      set(phase) {
        const at = phases.findIndex((p) => p[0] === phase);
        items.forEach((li, i) => {
          li.classList.toggle('is-current', i === at);
          li.classList.toggle('is-past', i < at);
          if (i === at) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
        });
      },
    };
  }

  function renderSession(c, store, caseId) {
    const p = /^c\d\d$/.test(caseId) ? getPage(caseId) : null;
    if (!p) { renderMissingCase(c, caseId); return; }
    const ctl = { caseId, store, p, view: null, phase: null, resultId: null, rootEl: h('div', { class: 'psess' }) };
    const stepper = phaseStepper();
    const eyebrow = ['Parte 3', 'Simulador', caseLabel(caseId)];
    if (p.difficulty) eyebrow.push('Dificultad ' + (DIFF_LABEL[p.difficulty] || p.difficulty));
    c.appendChild(header({ eyebrow, title: p.title || caseLabel(caseId), en: p.titleEn, after: stepper.el, cls: 'phead--sess' }));
    c.appendChild(ctl.rootEl);

    ctl.alive = () => ctl.rootEl.isConnected;
    ctl.show = (phase, focus) => {
      if (ctl.view && ctl.view.destroy) ctl.view.destroy();
      // El resultado solo existe justo después de guardar (y si el intento no se borró).
      if (phase === 'result' && !(ctl.resultId && store.listAttempts(caseId).some((x) => x.id === ctl.resultId))) { ctl.resultId = null; phase = 'edit'; }
      ctl.rootEl.innerHTML = '';
      ctl.phase = phase;
      stepper.set(phase);
      ctl.view = phase === 'rubric' ? viewRubric(ctl) : phase === 'result' ? viewResult(ctl) : viewEdit(ctl);
      ctl.rootEl.appendChild(ctl.view.el);
      if (focus) {
        root.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' });
        const t = ctl.view.el.querySelector('[data-focus]');
        if (t) t.focus({ preventScroll: true });
      }
    };

    // Guardar lo pendiente al ocultar la página, al navegar y al desmontar.
    const flush = () => {
      if (ctl.view && ctl.view.flush) ctl.view.flush();
      if (typeof store.flush === 'function') store.flush();
    };
    const onVis = () => { if (document.visibilityState === 'hidden') flush(); };
    // app.js registra su hashchange antes: cuando llega aquí, la página nueva ya se pintó.
    const onHash = () => { if (!ctl.alive()) teardownActive(); };
    root.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVis);
    root.addEventListener('hashchange', onHash);
    // Datos fusionados desde la cuenta o importados: repintar si no estás escribiendo.
    const unsub = store.subscribe((kind) => {
      if (kind !== 'remote' && kind !== 'import') return;
      if (!ctl.alive() || ctl.phase !== 'edit' || (ctl.view && ctl.view.busy && ctl.view.busy())) return;
      ctl.show('edit');
    });
    ctl.teardown = () => {
      if (ctl.view && ctl.view.destroy) ctl.view.destroy();
      if (typeof store.flush === 'function') store.flush();
      root.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVis);
      root.removeEventListener('hashchange', onHash);
      unsub();
    };
    active = ctl;

    const d = store.getDraft(caseId);
    ctl.show(d && d.phase === 'rubric' ? 'rubric' : 'edit');
  }

  // ------------------------------------------------------------------ vista 1: diseño con reloj
  function viewEdit(ctl) {
    const { store, caseId, p } = ctl;
    const F = fw();
    let d = store.getDraft(caseId);
    const V = { dirty: false, saveTimer: null, firstDirty: 0, interval: null, lastSec: null, lastIdx: null, lastOver: null };
    const E = {};

    // --- enunciado
    const attempts = store.listAttempts(caseId);
    const last = attempts[0];
    const revealed = !!((store.pref('solutionRevealed') || {})[caseId]);
    const notes = [];
    if (last) {
      const lp = pctOf(last);
      notes.push(h('p', { class: 'sim__note' }, h('span', { html: icon('star') }),
        h('span', null, 'Último intento: ', h('b', { class: 'mono' }, lp == null ? '—' : lp + ' %'), ' el ' + fmtDate(last.finishedAt || last.updatedAt) + '. ',
          h('a', { href: '#historial.' + last.id }, 'Ver detalle'), attempts.length > 1 ? [' · ', h('a', { href: '#historial.' + caseId }, 'los ' + attempts.length + ' intentos')] : null)));
    }
    if (revealed && !attempts.length) {
      notes.push(h('p', { class: 'sim__note' }, h('span', { html: icon('info') }),
        h('span', null, 'Ya abriste la solución de este caso: tu puntaje será optimista. Aun así, escribirlo con reloj entrena la estructura.')));
    }
    const tests = Array.isArray(p.tests) && p.tests.length
      ? h('details', { class: 'sim__hint' },
        h('summary', null, h('span', { html: icon('chevron') }), 'Pista: qué evalúa este caso'),
        h('ul', { class: 'b-list' }, p.tests.map((t) => h('li', { html: String(t) }))))
      : null;
    const promptEl = h('section', { class: 'sim__prompt', 'aria-labelledby': 'sim-prompt-k' },
      h('h2', { class: 'px-k', id: 'sim-prompt-k', tabindex: '-1', dataset: { focus: '' } }, 'El entrevistador dice'),
      h('blockquote', { class: 'prompt-quote sim__quote', html: String(p.prompt || 'Diseña el sistema.') }),
      tests, notes);

    // --- reloj
    E.label = h('span', { class: 'clock__label' }, 'Tiempo restante');
    E.state = h('span', { class: 'clock__state' });
    E.digits = h('div', { class: 'clock__digits', role: 'timer', 'aria-label': 'Tiempo restante' }, '45:00');
    E.meta = h('div', { class: 'clock__meta' });
    E.segs = F.map((s) => h('span', { class: 'segbar__seg', style: { flexGrow: String(s.minutes) }, title: s.num + '. ' + s.title + ' (' + s.from + '–' + s.to + ' min)' }, h('i')));
    E.segbar = h('div', { class: 'segbar', 'aria-hidden': 'true' }, E.segs);
    E.stepLine = h('span', { class: 'clock__stepline' });
    E.stepEn = h('span', { class: 'clock__stepen', lang: 'en' });
    E.railBtn = h('button', { type: 'button', class: 'btn btn--text btn--sm clock__railbtn', 'aria-expanded': 'false', 'aria-controls': 'sim-rail-' + caseId,
      on: { click: () => {
        const open = !E.sim.classList.contains('is-rail-open');
        E.sim.classList.toggle('is-rail-open', open);
        E.railBtn.setAttribute('aria-expanded', String(open));
        E.railBtn.textContent = open ? 'Ocultar pasos' : 'Ver pasos';
      } } }, 'Ver pasos');
    E.run = h('button', { type: 'button', class: 'btn btn--primary clock__run', on: { click: toggleRun } });
    E.reset = h('button', { type: 'button', class: 'btn clock__reset', on: { click: () => {
      inlineConfirm(E.reset, '¿Reiniciar el reloj a 45:00?', 'Sí, reiniciar', () => {
        flushText();
        d = store.updateDraft(caseId, { elapsedSec: 0, running: false, resumedAt: null });
        syncRun();
        E.run.focus();
        toast('Reloj reiniciado a 45:00');
      });
    } } }, h('span', { html: icon('reset') }), 'Reiniciar');
    E.live = h('p', { class: 'sr-only', 'aria-live': 'polite', 'aria-atomic': 'true' });
    const clock = h('section', { class: 'clock', 'aria-label': 'Reloj de la entrevista' },
      h('div', { class: 'clock__top' }, E.label, E.state),
      h('div', { class: 'clock__mid' }, E.digits, E.meta),
      E.segbar,
      h('div', { class: 'clock__step' }, h('span', { class: 'clock__stepk' }, 'Deberías ir en'), E.stepLine, E.stepEn, E.railBtn),
      h('div', { class: 'clock__ctrl' }, E.run, E.reset),
      E.live);

    // --- raíl del framework (runbook)
    E.rail = F.map((s) => {
      const bar = h('span', { class: 'rail__bar', 'aria-hidden': 'true' }, h('i'));
      const left = h('span', { class: 'rail__left' });
      const sr = h('span', { class: 'sr-only rail__sr' });
      const li = h('li', { class: 'rail__step' },
        h('span', { class: 'rail__mk', 'aria-hidden': 'true' }, h('span', { class: 'rail__n' }, pad2(s.num)), h('span', { class: 'rail__ok', html: icon('check') })),
        h('div', { class: 'rail__body' },
          h('div', { class: 'rail__head' }, h('span', { class: 'rail__title' }, s.title), h('span', { class: 'rail__win mono' }, s.from + '–' + s.to + '′')),
          h('div', { class: 'rail__en', lang: 'en' }, s.en),
          h('div', { class: 'rail__now' }, bar, left),
          sr));
      return { li, bar, left, sr };
    });
    const railEl = h('div', { class: 'rail', id: 'sim-rail-' + caseId },
      h('p', { class: 'rail__k' }, 'Framework · 7 pasos · 45 min'),
      h('ol', { class: 'rail__list' }, E.rail.map((r) => r.li)));

    // --- editor
    E.ta = h('textarea', {
      class: 'sim__text', id: 'sim-text-' + caseId, maxlength: String(MAX_TEXT), spellcheck: 'true',
      placeholder: 'Escribe tu diseño en el orden en que lo dirías en voz alta: primero las preguntas de aclaración y los supuestos que fijas, luego requisitos, números, arquitectura… «Insertar esqueleto» te deja los 7 pasos como guía.',
      on: { input: markDirty, blur: flushText },
    });
    E.ta.value = d ? d.text || '' : '';
    E.count = h('span', { class: 'sim__count mono' });
    E.save = h('span', { class: 'sim__save' });
    E.banner = h('div', { class: 'timeup', role: 'status', hidden: true },
      h('span', { class: 'timeup__icon', html: icon('timer') }),
      h('p', { class: 'timeup__text' }, h('b', null, 'Tiempo.'), ' Termina tu idea y pasa a la autoevaluación.'),
      h('button', { type: 'button', class: 'btn btn--sm', on: { click: finish } }, 'Terminar y autoevaluar'));
    E.discard = h('button', { type: 'button', class: 'btn btn--text sim__discard', on: { click: () => {
      inlineConfirm(E.discard, '¿Descartar el borrador? Se borran el texto y el reloj.', 'Sí, descartar', () => {
        if (V.saveTimer) clearTimeout(V.saveTimer);
        V.dirty = false;
        store.discardDraft(caseId);
        d = null;
        E.ta.value = '';
        updateCount();
        setSave();
        syncRun();
        E.run.focus();
        toast('Borrador descartado');
      });
    } } }, 'Descartar borrador');
    const editor = h('section', { class: 'sim__editor', 'aria-label': 'Tu diseño' },
      h('div', { class: 'sim__tools' },
        h('label', { class: 'px-k', for: 'sim-text-' + caseId }, 'Tu diseño'),
        h('button', { type: 'button', class: 'btn btn--sm', on: { click: insertSkeleton }, title: 'Inserta los 7 pasos del framework como esquema de texto' },
          h('span', { html: icon('list') }), 'Insertar esqueleto'),
        h('span', { class: 'sim__status' }, E.save, h('span', { class: 'sep', 'aria-hidden': 'true' }, '·'), E.count)),
      E.banner,
      E.ta,
      h('div', { class: 'sim__foot' },
        h('button', { type: 'button', class: 'btn btn--primary btn--lg', on: { click: finish } }, h('span', { html: icon('flag') }), 'Terminar y autoevaluar'),
        E.discard,
        h('p', { class: 'sim__help' }, 'Se guarda solo mientras escribes. El reloj sigue corriendo aunque cambies de página; nunca se envía nada solo.')));

    E.sim = h('div', { class: 'sim' },
      h('div', { class: 'sim__grid' },
        promptEl,
        h('div', { class: 'sim__side' }, clock, railEl),
        editor));

    // --- comportamiento
    function setSave(state) {
      const mem = store.backend && store.backend() === 'memory';
      E.save.className = 'sim__save' + (state ? ' is-' + state : '');
      if (state === 'saving') E.save.textContent = 'Guardando…';
      else if (state === 'saved') {
        E.save.innerHTML = '';
        E.save.appendChild(h('span', { html: icon('check') }));
        E.save.appendChild(document.createTextNode(mem ? 'Guardado solo en memoria' : 'Guardado'));
        E.save.title = mem ? 'El navegador no permite guardar: exporta tu progreso antes de cerrar.' : 'Guardado ' + fmtDate(Date.now());
      } else E.save.textContent = 'Autoguardado';
    }
    function updateCount() {
      const t = E.ta.value;
      E.count.textContent = plural(wordCount(t), 'palabra', 'palabras') + ' · ' + plural(t.length, 'carácter', 'caracteres');
    }
    function markDirty() {
      const t = Date.now();
      if (!V.dirty) V.firstDirty = t;
      V.dirty = true;
      setSave('saving');
      updateCount();
      if (V.saveTimer) clearTimeout(V.saveTimer);
      V.saveTimer = setTimeout(flushText, t - V.firstDirty >= SAVE_MAX_WAIT ? 0 : SAVE_DELAY);
    }
    function flushText() {
      if (V.saveTimer) { clearTimeout(V.saveTimer); V.saveTimer = null; }
      if (!V.dirty) return;
      V.dirty = false;
      d = store.updateDraft(caseId, { text: E.ta.value });
      setSave('saved');
    }

    function toggleRun() {
      flushText();
      const e = elapsedOf(d);
      if (d && d.running) d = store.updateDraft(caseId, { elapsedSec: e, running: false, resumedAt: null });
      else {
        d = store.updateDraft(caseId, { elapsedSec: e, running: true, resumedAt: Date.now() });
        E.ta.focus({ preventScroll: true });
      }
      syncRun();
    }

    function syncRun() {
      const running = !!(d && d.running);
      const e = elapsedOf(d);
      E.run.innerHTML = '';
      E.run.appendChild(h('span', { html: icon(running ? 'pause' : 'play') }));
      E.run.appendChild(document.createTextNode(running ? 'Pausa' : e > 0 ? 'Reanudar' : 'Empezar (45 min)'));
      E.run.setAttribute('aria-pressed', String(running));
      E.reset.disabled = e < 1 && !running;
      E.discard.hidden = !d;
      if (running && !V.interval) V.interval = setInterval(() => tick(false), 250);
      if (!running && V.interval) { clearInterval(V.interval); V.interval = null; }
      tick(true);
    }

    function tick(force) {
      if (!ctl.alive()) { teardownActive(); return; }
      const e = elapsedOf(d);
      const sec = Math.floor(e);
      if (!force && sec === V.lastSec) return;
      V.lastSec = sec;
      const running = !!(d && d.running);
      const remaining = TOTAL_SEC - sec;
      const over = remaining < 0;
      E.digits.textContent = over ? '+' + D.fmtDuration(-remaining) : D.fmtDuration(remaining);
      E.label.textContent = over ? 'Tiempo extra' : 'Tiempo restante';
      E.digits.setAttribute('aria-label', over ? 'Tiempo extra' : 'Tiempo restante');
      E.state.textContent = over ? 'Tiempo' : running ? 'En marcha' : e > 0 ? 'En pausa' : 'Sin empezar';
      E.state.className = 'clock__state is-' + (over ? 'over' : running ? 'run' : e > 0 ? 'pause' : 'idle');
      E.meta.textContent = 'transcurrido ' + D.fmtDuration(sec) + ' de ' + TOTAL_MIN + ':00';
      E.sim.classList.toggle('is-over', over);
      E.sim.classList.toggle('is-running', running);

      const min = e / 60;
      const st = stepAt(e);
      F.forEach((s, i) => {
        const frac = Math.max(0, Math.min(1, (min - s.from) / (s.to - s.from)));
        E.segs[i].firstChild.style.width = (frac * 100).toFixed(1) + '%';
        E.segs[i].classList.toggle('is-current', i === st.idx);
        const r = E.rail[i];
        const past = i < st.idx;
        const cur = i === st.idx;
        r.li.classList.toggle('is-past', past);
        r.li.classList.toggle('is-current', cur);
        if (cur) r.li.setAttribute('aria-current', 'step'); else r.li.removeAttribute('aria-current');
        r.sr.textContent = past ? ' — ya pasó' : cur ? ' — deberías estar aquí' : '';
        if (cur) {
          r.bar.firstChild.style.width = (frac * 100).toFixed(1) + '%';
          const left = Math.max(0, Math.ceil(s.to * 60 - e));
          r.left.textContent = 'quedan ' + Math.floor(left / 60) + ':' + pad2(left % 60) + ' en este paso';
        }
      });
      if (st.over) {
        E.stepLine.textContent = 'Cierre: termina tu idea';
        E.stepEn.textContent = 'Time is up';
      } else {
        const s = F[st.idx];
        E.stepLine.textContent = 'Paso ' + s.num + '/' + F.length + ' · ' + s.title + ' (' + s.from + '–' + s.to + ' min)';
        E.stepEn.textContent = s.en;
      }
      E.banner.hidden = !over;
      // Avisos para lector de pantalla solo en transiciones reales mientras corre.
      if (V.lastIdx !== null && running) {
        if (over && !V.lastOver) E.live.textContent = 'Tiempo. Termina tu idea y pasa a la autoevaluación.';
        else if (!over && st.idx !== V.lastIdx) { const s = F[st.idx]; E.live.textContent = 'Paso ' + s.num + ' de ' + F.length + ': ' + s.title + '.'; }
      }
      V.lastIdx = st.idx;
      V.lastOver = over;
    }

    // Inserta los 7 pasos como esquema de texto plano en el cursor (arriba si está vacío).
    function insertSkeleton() {
      const ta = E.ta;
      const text = F.map((s) => s.num + '. ' + s.title + ' — ' + s.en + ' (' + s.from + '–' + s.to + ' min)\n- ').join('\n\n') + '\n';
      const val = ta.value;
      const start = val.trim() ? ta.selectionStart : 0;
      const end = val.trim() ? ta.selectionEnd : val.length;
      const before = val.slice(0, start);
      const after = val.slice(end);
      const pre = !before ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
      const post = after && !after.startsWith('\n') ? '\n' : '';
      const ins = pre + text + post;
      if (ins.length + val.length - (end - start) > MAX_TEXT) { toast('El texto llegó al límite de 100,000 caracteres.'); return; }
      ta.setRangeText(ins, start, end, 'end');
      const caret = start + pre.length + text.indexOf('- ') + 2;
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(caret, caret);
      markDirty();
    }

    function finish() {
      flushText();
      const e = elapsedOf(d);
      d = store.updateDraft(caseId, { elapsedSec: e, running: false, resumedAt: null, phase: 'rubric' });
      ctl.show('rubric', true);
    }

    updateCount();
    setSave(d && d.text ? 'saved' : null);
    syncRun();

    return {
      el: E.sim,
      flush: flushText,
      busy: () => V.dirty || document.activeElement === E.ta,
      destroy() { flushText(); if (V.interval) clearInterval(V.interval); V.interval = null; },
    };
  }

  // ------------------------------------------------------------------ vista 2: rúbrica
  function sanitizeRubric(r, list) {
    const out = {};
    if (!r || typeof r !== 'object') return out;
    list.forEach((dm) => {
      const x = r[dm.id];
      if (!x || typeof x !== 'object') return;
      const level = [1, 2, 3, 4].indexOf(x.level) >= 0 ? x.level : 0;
      out[dm.id] = { level, points: Array.isArray(x.points) ? x.points.filter((s) => typeof s === 'string') : [] };
    });
    return out;
  }

  function keyPointsOf(p) {
    return p && p.ready && p.rubric && typeof p.rubric === 'object' ? p.rubric : null;
  }

  function computeScore(R, list, kp) {
    let total = 0, rated = 0, got = 0, all = 0;
    list.forEach((dm) => {
      const r = R[dm.id];
      if (r && r.level) { total += r.level; rated++; }
      const pts = kp && Array.isArray(kp[dm.id]) ? kp[dm.id] : [];
      all += pts.length;
      if (r && r.points) got += r.points.filter((id) => pts.some((x) => x && x.id === id)).length;
    });
    const max = list.length * 4;
    return {
      total, max, rated,
      pct: max ? Math.round((total / max) * 100) : 0,
      keyPoints: { got, total: all, pct: all ? Math.round((got / all) * 100) : null },
    };
  }

  function viewRubric(ctl) {
    const { store, caseId, p } = ctl;
    const list = dims();
    const kp = keyPointsOf(p);
    let d = store.getDraft(caseId);
    const R = sanitizeRubric(d && d.rubric, list);
    const text = d ? d.text || '' : '';

    const persist = () => { d = store.updateDraft(caseId, { rubric: clone(R), phase: 'rubric' }); };

    // Resumen en vivo
    const S = {};
    S.big = h('span', { class: 'rsum__big mono' }, '—');
    S.line = h('span', { class: 'rsum__line' });
    S.bar = h('span', { class: 'rsum__bar', 'aria-hidden': 'true' }, h('i'));
    S.kpLine = h('span', { class: 'rsum__line' });
    S.kpBar = h('span', { class: 'rsum__bar rsum__bar--kp', 'aria-hidden': 'true' }, h('i'));
    S.msg = h('p', { class: 'rsum__msg', role: 'alert' });
    S.dimsDone = h('span', { class: 'rsum__dims mono' });

    function refresh() {
      const sc = computeScore(R, list, kp);
      S.big.textContent = '';
      [].concat(sc.rated ? pctEl(sc.pct) : '—').forEach((x) => S.big.append(x));
      S.line.textContent = sc.total + ' de ' + sc.max + ' puntos';
      S.bar.firstChild.style.width = sc.pct + '%';
      S.dimsDone.textContent = sc.rated + '/' + list.length + ' dimensiones';
      if (kp) {
        S.kpLine.textContent = sc.keyPoints.got + ' de ' + sc.keyPoints.total + ' puntos clave' + (sc.keyPoints.pct != null ? ' · ' + sc.keyPoints.pct + ' %' : '');
        S.kpBar.firstChild.style.width = (sc.keyPoints.pct || 0) + '%';
      }
      if (sc.rated === list.length) S.msg.textContent = '';
      list.forEach((dm) => {
        const fs = fsById[dm.id];
        if (fs) fs.classList.toggle('is-rated', !!(R[dm.id] && R[dm.id].level));
        const pc = fs && fs.querySelector('.rdim__pc');
        if (pc) {
          const pts = kp && Array.isArray(kp[dm.id]) ? kp[dm.id] : [];
          const n = (R[dm.id] && R[dm.id].points || []).filter((id) => pts.some((x) => x.id === id)).length;
          pc.textContent = n + '/' + pts.length;
        }
      });
    }

    const setLevel = (dimId, lvl) => {
      R[dimId] = R[dimId] || { level: 0, points: [] };
      R[dimId].level = lvl;
      persist();
      refresh();
    };
    const setPoint = (dimId, ptId, on) => {
      R[dimId] = R[dimId] || { level: 0, points: [] };
      const pts = R[dimId].points.filter((x) => x !== ptId);
      if (on) pts.push(ptId);
      R[dimId].points = pts;
      persist();
      refresh();
    };

    const fsById = {};
    const fieldsets = list.map((dm, i) => {
      const cur = R[dm.id] || { level: 0, points: [] };
      const pts = kp && Array.isArray(kp[dm.id]) ? kp[dm.id].filter((x) => x && x.id) : [];
      return (fsById[dm.id] = h('fieldset', { class: 'rdim', id: 'rdim-' + dm.id },
        h('legend', { class: 'rdim__legend' },
          h('span', { class: 'rdim__n mono', 'aria-hidden': 'true' }, pad2(i + 1)),
          h('span', { class: 'rdim__title' }, dm.title),
          h('span', { class: 'rdim__en', lang: 'en' }, dm.en)),
        h('p', { class: 'rdim__q' }, dm.question),
        h('div', { class: 'rdim__levels' }, (dm.levels || []).map((txt, li) => {
          const lvl = li + 1;
          const iid = 'lvl-' + dm.id + '-' + lvl;
          return h('label', { class: 'lvl', for: iid },
            h('input', { type: 'radio', class: 'lvl__input', name: 'lvl-' + dm.id, id: iid, value: String(lvl), checked: cur.level === lvl,
              on: { change: () => setLevel(dm.id, lvl) } }),
            h('span', { class: 'lvl__head' }, h('span', { class: 'lvl__n mono' }, String(lvl)), h('span', { class: 'lvl__tag' }, LEVEL_TAG[li] || '')),
            h('span', { class: 'lvl__text' }, txt));
        })),
        pts.length
          ? h('div', { class: 'rdim__pts' },
            h('p', { class: 'rdim__pk' }, 'Puntos clave de ' + caseLabel(caseId) + ' que cubriste', h('span', { class: 'rdim__pc mono' })),
            h('ul', { class: 'rdim__plist' }, pts.map((pt) => {
              const iid = 'kp-' + dm.id + '-' + pt.id;
              return h('li', { class: 'rdim__pt' },
                h('input', { type: 'checkbox', id: iid, class: 'rdim__box', checked: cur.points.indexOf(pt.id) >= 0,
                  on: { change: (e) => setPoint(dm.id, pt.id, e.target.checked) } }),
                h('label', { for: iid, html: String(pt.text || pt.id) }));
            })))
          : null));
    });

    function save() {
      const missing = list.filter((dm) => !(R[dm.id] && R[dm.id].level));
      if (missing.length) {
        S.msg.textContent = 'Falta elegir el nivel en: ' + missing.map((dm) => dm.title).join(', ') + '.';
        const first = fsById[missing[0].id] && fsById[missing[0].id].querySelector('input[type="radio"]');
        if (first) { fsById[missing[0].id].scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' }); first.focus({ preventScroll: true }); }
        return;
      }
      const sc = computeScore(R, list, kp);
      const a = store.finishAttempt(caseId, {
        rubric: clone(R),
        score: { total: sc.total, max: sc.max, pct: sc.pct, keyPoints: sc.keyPoints },
      });
      ctl.resultId = a && a.id;
      toast('Evaluación guardada en tu historial');
      ctl.show('result', true);
    }

    const back = () => {
      d = store.updateDraft(caseId, { phase: 'edit' });
      ctl.show('edit', true);
    };

    const intro = h('div', { class: 'rub__intro' },
      h('h2', { class: 'rub__h', tabindex: '-1', dataset: { focus: '' } }, 'Autoevalúate como lo haría el entrevistador'),
      h('p', { class: 'b-p' }, 'Para cada dimensión elige el nivel que te daría alguien que no te conoce: si dudas entre dos, elige el menor. ',
        kp ? 'Después marca los puntos clave del caso que realmente dijiste (escritos, no pensados).' : 'Este caso aún no tiene solución publicada, así que evalúas solo con los niveles.'),
      h('details', { class: 'rtext', open: true },
        h('summary', null, h('span', { html: icon('chevron') }), 'Tu diseño', h('span', { class: 'rtext__meta mono' }, plural(wordCount(text), 'palabra', 'palabras') + ' · ' + D.fmtDuration(Math.round(elapsedOf(d))))),
        text.trim() ? h('pre', { class: 'rtext__pre' }, text) : h('p', { class: 'rtext__empty' }, 'No escribiste texto (¿practicaste en voz alta?). Evalúa lo que dijiste.')));

    const sum = h('aside', { class: 'rsum', 'aria-label': 'Puntaje en vivo' },
      h('p', { class: 'px-k' }, 'Tu puntaje'),
      h('div', { class: 'rsum__score', 'aria-live': 'polite', 'aria-atomic': 'true' }, S.big, S.dimsDone),
      h('div', { class: 'rsum__row' }, S.line, S.bar),
      kp ? h('div', { class: 'rsum__row' }, S.kpLine, S.kpBar) : null,
      S.msg,
      h('div', { class: 'rsum__actions' },
        h('button', { type: 'submit', class: 'btn btn--primary' }, h('span', { html: icon('check') }), 'Guardar evaluación'),
        h('button', { type: 'button', class: 'btn btn--text', on: { click: back } }, 'Volver a editar el diseño')));

    const form = h('form', { class: 'rub', novalidate: true, on: { submit: (e) => { e.preventDefault(); save(); } } },
      intro,
      h('div', { class: 'rub__grid' }, h('div', { class: 'rub__dims' }, fieldsets), sum));
    refresh();
    return { el: form, flush() {}, destroy() {} };
  }

  // ------------------------------------------------------------------ vista 3: resultado
  function dimBreakdown(a, p, opts) {
    const list = dims();
    const kp = keyPointsOf(p);
    const R = sanitizeRubric(a.rubric, list);
    return h('ol', { class: 'dimres' + (opts && opts.compact ? ' dimres--compact' : '') }, list.map((dm) => {
      const r = R[dm.id] || { level: 0, points: [] };
      const pts = kp && Array.isArray(kp[dm.id]) ? kp[dm.id] : [];
      const got = r.points.filter((id) => pts.some((x) => x.id === id)).length;
      return h('li', { class: 'dimres__row' },
        h('span', { class: 'dimres__t' }, dm.title),
        levelCells(r.level),
        h('span', { class: 'dimres__lv' }, r.level ? h('b', { class: 'mono' }, r.level + '/4') : '—', r.level ? ' ' + (LEVEL_TAG[r.level - 1] || '') : ''),
        h('span', { class: 'dimres__kp mono' }, pts.length ? got + '/' + pts.length + ' clave' : ''));
    }));
  }

  function weakest(a, p) {
    const list = dims();
    const kp = keyPointsOf(p);
    const R = sanitizeRubric(a.rubric, list);
    return list.map((dm, i) => {
      const r = R[dm.id] || { level: 0, points: [] };
      const pts = kp && Array.isArray(kp[dm.id]) ? kp[dm.id] : [];
      const missed = pts.filter((x) => r.points.indexOf(x.id) < 0);
      const cov = pts.length ? (pts.length - missed.length) / pts.length : 1;
      return { dm, i, level: r.level || 0, cov, missed };
    }).filter((x) => x.level < 4)
      .sort((x, y) => x.level - y.level || x.cov - y.cov || x.i - y.i)
      .slice(0, 2);
  }

  function viewResult(ctl) {
    const { store, caseId, p } = ctl;
    const a = store.listAttempts(caseId).find((x) => x.id === ctl.resultId);   // show() ya verificó que existe
    const pct = pctOf(a);
    const sc = a.score || {};
    const kpc = sc.keyPoints || {};
    const m01 = getPage('m01');
    const m01Secs = m01 && Array.isArray(m01.sections) ? m01.sections : [];

    const weak = weakest(a, p);
    const weakEl = weak.length
      ? h('ol', { class: 'weak' }, weak.map((w) => {
        const secId = M01_FOR_DIM[w.dm.id];
        const sec = m01Secs.find((s) => s.id === secId);
        const links = [h('a', { href: sec ? '#m01.' + sec.id : '#m01' }, 'M01 · ' + (sec ? sec.title : 'El mapa y la entrevista'))];
        const caseSec = CASE_SEC_FOR_DIM[w.dm.id];
        if (p.ready && caseSec) {
          const cs = (p.sections || []).find((s) => s.id === caseSec);
          if (cs) links.push(h('a', { href: '#' + caseId + '.' + caseSec }, 'Solución · ' + (cs.num ? cs.num + '. ' : '') + cs.title));
        }
        return h('li', { class: 'weak__item' },
          h('div', { class: 'weak__head' },
            h('span', { class: 'weak__t' }, w.dm.title), levelCells(w.level),
            h('span', { class: 'weak__lv mono' }, w.level + '/4')),
          h('p', { class: 'weak__q' }, w.dm.question),
          w.missed.length ? h('div', { class: 'weak__missed' },
            h('p', { class: 'weak__mk' }, 'Puntos clave que no marcaste'),
            h('ul', { class: 'b-list' }, w.missed.map((x) => h('li', { html: String(x.text || x.id) })))) : null,
          h('p', { class: 'weak__links' }, h('span', { class: 'weak__lk' }, 'Repasa: '), links.reduce((acc, l, i) => acc.concat(i ? [' · ', l] : [l]), [])));
      }))
      : h('p', { class: 'b-p' }, 'Todas las dimensiones en 4/4. Revisa igual la solución: un 4 autoevaluado suele ser optimista.');

    const solutionCta = p.ready
      ? h('a', { class: 'btn btn--primary btn--lg', href: '#' + caseId, on: { click: () => {
        const sr = store.pref('solutionRevealed') || {};
        sr[caseId] = true;
        store.setPref('solutionRevealed', sr);
      } } }, h('span', { html: icon('book') }), 'Ver la solución')
      : h('p', { class: 'res__pending' }, h('span', { html: icon('info') }), h('span', null, 'La solución de este caso llega en una fase posterior; tu intento queda guardado en el historial para compararlo cuando llegue.'));

    const again = h('button', { type: 'button', class: 'btn', on: { click: () => { ctl.resultId = null; ctl.show('edit', true); } } },
      h('span', { html: icon('reset') }), 'Practicar de nuevo');

    const el = h('div', { class: 'res' },
      h('section', { class: 'res__top', 'aria-labelledby': 'res-h' },
        h('h2', { class: 'px-k', id: 'res-h', tabindex: '-1', dataset: { focus: '' } }, 'Resultado de tu ronda'),
        h('div', { class: 'res__score' },
          h('span', { class: 'res__big mono' }, pctEl(pct)),
          h('div', { class: 'res__facts' },
            h('span', null, h('b', { class: 'mono' }, (sc.total || 0) + '/' + (sc.max || dims().length * 4)), ' puntos de rúbrica'),
            kpc.total ? h('span', null, h('b', { class: 'mono' }, kpc.got + '/' + kpc.total), ' puntos clave (' + (kpc.pct || 0) + ' %)') : null,
            h('span', null, h('b', { class: 'mono' }, D.fmtDuration(a.elapsedSec)), ' de ' + TOTAL_MIN + ':00'),
            h('span', null, plural(wordCount(a.text), 'palabra', 'palabras')))),
        h('p', { class: 'res__note' }, 'El número orienta; lo que anota el entrevistador son las dimensiones en 1–2. Empieza por ahí.'),
        dimBreakdown(a, p)),
      h('section', { class: 'res__weak', 'aria-labelledby': 'res-weak-h' },
        h('h2', { class: 'px-k', id: 'res-weak-h' }, 'Dónde enfocarte'),
        weakEl),
      h('div', { class: 'res__actions' }, solutionCta, h('a', { class: 'btn', href: '#historial.' + a.id }, h('span', { html: icon('list') }), 'Ver en el historial'), again),
      h('details', { class: 'rtext', open: true },
        h('summary', null, h('span', { html: icon('chevron') }), 'Tu diseño (solo lectura)', h('span', { class: 'rtext__meta mono' }, fmtDate(a.finishedAt || a.updatedAt))),
        a.text && a.text.trim() ? h('pre', { class: 'rtext__pre' }, a.text) : h('p', { class: 'rtext__empty' }, 'Sin texto en este intento.')));
    return { el, flush() {}, destroy() {} };
  }

  // ================================================================== HISTORIAL
  function renderHistory(c, store, route) {
    const m = meta('historial');
    c.appendChild(header({
      eyebrow: ['Parte 3', 'Práctica'],
      title: m.title || 'Historial de práctica',
      en: m.titleEn || 'Practice history',
      summary: m.summary || 'Todos tus intentos con su puntaje por dimensión.',
    }));
    const sid = route && route.sectionId ? String(route.sectionId) : null;
    const H = {
      filter: sid && /^c\d\d$/.test(sid) ? sid : 'all',
      open: new Set(sid && !/^c\d\d$/.test(sid) ? [sid] : []),
    };
    const body = h('div', { class: 'hist' });
    c.appendChild(body);

    function paint(focusSel) {
      body.innerHTML = '';
      const all = store.listAttempts();
      const drafts = store.listAttempts({ includeDrafts: true }).filter((a) => a.status === 'draft');
      if (H.filter !== 'all' && !all.some((a) => a.caseId === H.filter)) H.filter = 'all';
      const shown = H.filter === 'all' ? all : all.filter((a) => a.caseId === H.filter);

      if (drafts.length) {
        body.appendChild(h('div', { class: 'hist__drafts' }, drafts.map((d) => {
          const pm = getPage(d.caseId) || {};
          return h('p', { class: 'sim__note' }, h('span', { html: icon('timer') }),
            h('span', null, 'Borrador abierto en ', h('b', null, caseLabel(d.caseId) + ' · ' + (pm.short || pm.title || '')), ' — ',
              h('span', { class: 'mono' }, D.fmtDuration(elapsedOf(d))), ' transcurridos' + (d.running ? ' (reloj en marcha)' : '') + '. ',
              h('a', { href: '#practica-' + d.caseId }, 'Continuar')));
        })));
      }

      if (!all.length) {
        body.appendChild(h('div', { class: 'px-empty' },
          h('p', { class: 'px-empty__t' }, 'Aún no tienes intentos terminados'),
          h('p', { class: 'muted' }, 'Un intento se guarda aquí cuando terminas la autoevaluación. El primero siempre cuesta: 45 minutos con reloj, sin mirar la solución.'),
          h('p', null, h('a', { class: 'btn btn--primary', href: '#practica' }, h('span', { html: icon('play') }), 'Ir al simulador'))));
        return;
      }

      // Estadísticas del conjunto filtrado
      const scores = shown.map(pctOf).filter((x) => x != null);
      const avg = scores.length ? Math.round(scores.reduce((s, x) => s + x, 0) / scores.length) : null;
      const best = scores.length ? Math.max.apply(null, scores) : null;
      const list = dims();
      const dimAvg = list.map((dm) => {
        const lv = shown.map((a) => a.rubric && a.rubric[dm.id] && a.rubric[dm.id].level).filter((x) => x >= 1 && x <= 4);
        return { dm, v: lv.length ? lv.reduce((s, x) => s + x, 0) / lv.length : 0 };
      });
      const low = dimAvg.filter((x) => x.v > 0).sort((x, y) => x.v - y.v)[0];
      body.appendChild(h('section', { class: 'hstats', 'aria-label': 'Resumen' },
        h('div', { class: 'stat' }, h('span', { class: 'stat__v' }, String(shown.length)), h('span', { class: 'stat__k' }, shown.length === 1 ? 'intento' : 'intentos')),
        h('div', { class: 'stat' }, h('span', { class: 'stat__v' }, pctEl(avg)), h('span', { class: 'stat__k' }, 'promedio')),
        h('div', { class: 'stat' }, h('span', { class: 'stat__v' }, pctEl(best)), h('span', { class: 'stat__k' }, 'mejor')),
        h('div', { class: 'hstats__dims' },
          h('ol', { class: 'hdims' }, dimAvg.map((x) => h('li', { class: 'hdims__i', title: x.dm.title + ': ' + (x.v ? x.v.toFixed(1) : '—') + ' de 4 en promedio' },
            h('span', { class: 'hdims__bar ' + levelClass(Math.round(x.v)), 'aria-hidden': 'true' }, h('i', { style: { height: (x.v / 4 * 100) + '%' } })),
            h('span', { class: 'hdims__k', 'aria-hidden': 'true' }, x.dm.title.split(' ')[0]),
            h('span', { class: 'sr-only' }, x.dm.title),
            h('span', { class: 'sr-only' }, ': ' + (x.v ? x.v.toFixed(1) : 'sin datos') + ' de 4')))),
          low ? h('p', { class: 'hstats__low' }, 'Más débil en promedio: ', h('b', null, low.dm.title)) : null)));

      // Filtro por caso
      const byCase = {};
      all.forEach((a) => { byCase[a.caseId] = (byCase[a.caseId] || 0) + 1; });
      const chips = [['all', 'Todos', all.length]].concat(Object.keys(byCase).sort().map((id) => [id, caseLabel(id), byCase[id]]));
      if (chips.length > 2) {
        body.appendChild(h('div', { class: 'fchips', role: 'group', 'aria-label': 'Filtrar por caso' }, chips.map(([id, t, n]) =>
          h('button', { type: 'button', class: 'fchip', 'aria-pressed': String(H.filter === id), on: { click: () => { H.filter = id; paint('.fchip[aria-pressed="true"]'); } } },
            t, h('span', { class: 'fchip__n mono' }, String(n))))));
      }

      body.appendChild(h('div', { class: 'hist__cols', 'aria-hidden': 'true' },
        h('span', null, 'Caso'), h('span', null, 'Fecha'), h('span', { class: 'num' }, 'Duración'), h('span', { class: 'num' }, 'Puntaje'), h('span', null, 'Por dimensión'), h('span')));
      body.appendChild(h('ol', { class: 'hist__list', 'aria-label': 'Intentos, del más reciente al más antiguo' }, shown.map((a) => histItem(a))));

      if (focusSel) { const f = body.querySelector(focusSel); if (f) f.focus(); }
    }

    function histItem(a) {
      const p = getPage(a.caseId) || { id: a.caseId };
      const pct = pctOf(a);
      const list = dims();
      const R = sanitizeRubric(a.rubric, list);
      const pid = 'hp-' + a.id;
      const isOpen = H.open.has(a.id);
      const btn = h('button', { type: 'button', class: 'hist__row', 'aria-expanded': String(isOpen), 'aria-controls': pid },
        h('span', { class: 'hist__case' }, h('span', { class: 'mono hist__id' }, caseLabel(a.caseId)), h('span', { class: 'hist__title' }, p.short || p.title || '')),
        h('span', { class: 'hist__date' }, fmtDate(a.finishedAt || a.updatedAt)),
        h('span', { class: 'hist__dur mono' }, h('span', { class: 'sr-only' }, 'duración '), D.fmtDuration(a.elapsedSec)),
        h('span', { class: 'hist__score mono' }, h('span', { class: 'scorebar', 'aria-hidden': 'true' }, h('i', { style: { width: (pct || 0) + '%' } })), pct == null ? '—' : pct + ' %'),
        h('span', { class: 'hist__dims', 'aria-hidden': 'true' }, list.map((dm) => {
          const lv = (R[dm.id] && R[dm.id].level) || 0;
          return h('span', { class: 'hist__dim ' + levelClass(lv), title: dm.title + ': ' + (lv || '—') + '/4' }, h('i', { style: { height: (lv / 4 * 100) + '%' } }));
        })),
        h('span', { class: 'sr-only' }, '. Por dimensión: ' + list.map((dm) => dm.title + ' ' + ((R[dm.id] && R[dm.id].level) || 'sin nivel')).join(', ')),
        h('span', { class: 'hist__chev', html: icon('chevron-down') }));
      const del = h('button', { type: 'button', class: 'btn btn--sm btn--ghost hist__del' }, 'Borrar intento');
      del.addEventListener('click', () => inlineConfirm(del, '¿Borrar este intento?', 'Sí, borrar', () => {
        const items = Array.from(body.querySelectorAll('.hist__item'));
        const i = items.findIndex((x) => x.dataset.id === a.id);
        const next = items[i + 1] || items[i - 1];
        store.deleteAttempt(a.id);
        H.open.delete(a.id);
        toast('Intento borrado');
        paint(next ? '.hist__item[data-id="' + next.dataset.id + '"] .hist__row' : '.fchip, .btn');
      }));
      const panel = h('div', { class: 'hist__panel', id: pid, hidden: !isOpen },
        dimBreakdown(a, p, { compact: true }),
        a.score && a.score.keyPoints && a.score.keyPoints.total ? h('p', { class: 'hist__kp' }, 'Puntos clave: ', h('b', { class: 'mono' }, a.score.keyPoints.got + '/' + a.score.keyPoints.total), ' (' + (a.score.keyPoints.pct || 0) + ' %)') : null,
        a.text && a.text.trim() ? h('pre', { class: 'rtext__pre hist__text' }, a.text) : h('p', { class: 'rtext__empty' }, 'Sin texto en este intento.'),
        h('div', { class: 'hist__actions' },
          p.ready ? h('a', { class: 'btn btn--sm', href: '#' + a.caseId }, h('span', { html: icon('book') }), 'Ver la solución') : h('span', { class: 'muted small' }, 'Solución en una fase posterior.'),
          h('a', { class: 'btn btn--sm', href: '#practica-' + a.caseId }, h('span', { html: icon('reset') }), 'Practicar de nuevo'),
          del));
      btn.addEventListener('click', () => {
        const open = btn.getAttribute('aria-expanded') !== 'true';
        btn.setAttribute('aria-expanded', String(open));
        panel.hidden = !open;
        if (open) H.open.add(a.id); else H.open.delete(a.id);
      });
      // id = "historial.<attemptId>": el router desplaza hasta aquí con #historial.<id>
      return h('li', { class: 'hist__item', id: 'historial.' + a.id, dataset: { id: a.id }, tabindex: '-1' }, btn, panel);
    }

    paint();

    // En la misma página el router solo desplaza: aquí se abre el intento o se aplica el filtro.
    const onHash = () => {
      if (!body.isConnected) { root.removeEventListener('hashchange', onHash); return; }
      let s = String(root.location.hash || '').replace(/^#/, '');
      try { s = decodeURIComponent(s); } catch (e) { /* tal cual */ }
      const i = s.indexOf('.');
      if ((i < 0 ? s : s.slice(0, i)) !== 'historial' || i < 0) return;
      const sec = s.slice(i + 1);
      if (/^c\d\d$/.test(sec)) { H.filter = sec; paint('.fchip[aria-pressed="true"]'); return; }
      const li = document.getElementById('historial.' + sec);
      if (!li) return;
      const b = li.querySelector('.hist__row');
      if (b && b.getAttribute('aria-expanded') !== 'true') b.click();
    };
    root.addEventListener('hashchange', onHash);
  }

  // ================================================================== API
  function render(container, route, ctx) {
    teardownActive();
    const store = (ctx && ctx.store) || MSD.store;
    const id = (route && route.pageId) || 'practica';
    const wrap = h('div', { class: 'px' });
    container.appendChild(wrap);
    if (id === 'practica') renderHub(wrap, store);
    else if (id === 'historial') renderHistory(wrap, store, route || {});
    else if (/^practica-c\d\d$/.test(id)) renderSession(wrap, store, id.slice(9));
    else renderMissingCase(wrap, id.replace(/^practica-/, ''));
  }

  MSD.Practice = { render, _elapsedOf: elapsedOf, _stepAt: stepAt };
})(typeof window !== 'undefined' ? window : globalThis);
