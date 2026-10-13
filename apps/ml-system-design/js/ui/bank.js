/* =============================================================================
   Ronda de Diseño ML — js/ui/bank.js
   Banco de problemas (#problemas, #problemas.<sección>): un problema tras otro con números nuevos.
     - Secciones = MSD.problemBank[id] (js/content/banco-*.js): {id, title, summary, topics, formulas,
       quick, templates:[{id, topic, level 1–3, title, ref 'página.sección', gen(r) → {q, parts, hint, takeaway}}]}.
     - Partes encadenadas: numéricas (tol relativa, tolAbs absoluta, o exacta) u opción (choices + answer).
       Al comprobar una parte se muestra su valor correcto, así el error no arrastra a la siguiente.
     - Dificultad adaptativa por tema (modo Auto): 3 aciertos seguidos sin pista → sube de nivel;
       2 fallos seguidos → baja. También se puede fijar el nivel.
   Estadísticas por tema en prefs ('problemStats'); temas y modo elegidos en prefs ('problemPrefs').
   ========================================================================== */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});
  const D = MSD.dom;
  const { h, icon } = D;

  const LEVEL_UP = 3;     // aciertos seguidos (sin pista) para subir de nivel
  const LEVEL_DOWN = 2;   // fallos seguidos para bajar
  const safe = (fn, dflt) => { try { const v = fn(); return v === undefined ? dflt : v; } catch (e) { return dflt; } };
  const reduced = () => (D.reducedMotion ? D.reducedMotion() : false);
  const Drill = () => MSD.Drill;
  const shuffle = (a) => Drill().shuffle(a);
  const R = {
    pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
    int: (lo, hi, step) => { const s = step || 1; return lo + s * Math.floor(Math.random() * (Math.floor((hi - lo) / s) + 1)); },
    chance: (p) => Math.random() < p,
    shuffle: (a) => shuffle(a),
  };

  // Valor esperado con las cifras que importan (99.95 no se redondea a 100).
  function fmtAns(part) {
    const a = part.answer;
    if (typeof part.tolAbs === 'number' && part.tolAbs > 0) {
      // un decimal más que la tolerancia: con ±0.001, 99.9975 se ve completo (no "99.997")
      const dec = Math.min(7, Math.max(0, Math.ceil(-Math.log10(part.tolAbs)) + 1));
      return Number(a.toFixed(dec)).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: dec });
    }
    if (!part.tol) return Math.round(a).toLocaleString('en-US');
    const v = a === 0 ? 0 : Number(a.toPrecision(4));
    return v.toLocaleString('en-US', { maximumFractionDigits: 8 });
  }
  function checkNum(part, v) {
    if (typeof part.tolAbs === 'number') return Math.abs(v - part.answer) <= part.tolAbs + 1e-12;
    if (part.tol > 0) return Math.abs(v - part.answer) <= part.tol * Math.abs(part.answer) + 1e-12;
    return Math.round(v) === Math.round(part.answer);
  }
  function tolText(part) {
    if (typeof part.tolAbs === 'number') return 'Se acepta ±' + fmtAbs(part.tolAbs) + (part.unit ? ' ' + part.unit : '') + '.';
    if (part.tol > 0 && part.unit === '%') return 'Se acepta ±' + Math.round(part.tol * 100) + ' % del valor (relativo, no puntos porcentuales).';
    if (part.tol > 0) return 'Se acepta ±' + Math.round(part.tol * 100) + ' %: importa el orden de magnitud. Acepta 1,200 · 1.2k · 3.5M.';
    return 'Respuesta exacta (un número entero).';
  }
  const fmtAbs = (x) => Number(x).toLocaleString('en-US', { maximumFractionDigits: 6 });
  // Lo que escribiste, con 4 cifras significativas (0.00025 no se muestra como 0).
  const fmtVal = (x) => (x === 0 ? '0' : Number(Number(x).toPrecision(4)).toLocaleString('en-US', { maximumFractionDigits: 10 }));

  const banks = () => Object.values(MSD.problemBank || {}).filter((b) => b && b.id && Array.isArray(b.templates) && b.templates.length);
  const topicTitle = (bank, t) => ((bank.topics || []).find((x) => x.id === t) || {}).title || t;
  function refInfo(ref) {
    const m = /^([a-z0-9-]+)\.([A-Za-z0-9_-]+)$/.exec(String(ref || ''));
    if (!m) return null;
    const p = safe(() => MSD.getPage(m[1]), null);
    const s = p && p.sections ? p.sections.find((x) => x.id === m[2]) : null;
    return s ? { href: '#' + m[1] + '.' + m[2], title: (/^[mc]\d\d$/.test(m[1]) ? m[1].toUpperCase() + ' · ' : '') + s.title } : null;
  }

  // ------------------------------------------------------------------ estado guardado
  const fresh = () => ({ level: 1, streak: 0, miss: 0, ok: 0, n: 0 });
  function statsOf(store, bankId) { return Object.assign({}, (store.pref('problemStats') || {})[bankId] || {}); }
  function topicStat(store, bankId, t) { return Object.assign(fresh(), statsOf(store, bankId)[t] || {}); }
  function saveTopic(store, bankId, t, ts) {
    const all = store.pref('problemStats') || {};
    all[bankId] = Object.assign({}, all[bankId] || {}, { [t]: ts });
    store.setPref('problemStats', all);
  }
  function prefsOf(store, bankId) { return Object.assign({ topics: null, mode: 'auto' }, (store.pref('problemPrefs') || {})[bankId] || {}); }
  function savePrefs(store, bankId, p) {
    const all = store.pref('problemPrefs') || {};
    all[bankId] = p;
    store.setPref('problemPrefs', all);
  }

  // Sesión (memoria): si sales a releer una sección y vuelves, el problema sigue ahí.
  const sessions = {};
  function sessionOf(bankId) { return sessions[bankId] || (sessions[bankId] = { queue: [], recent: [], problem: null, count: 0, ok: 0, streak: 0 }); }

  function makeProblem(bank, topics, mode, store) {
    const s = sessionOf(bank.id);
    for (let attempt = 0; attempt < 12; attempt++) {
      if (!s.queue.length) s.queue = shuffle(topics);
      const t = s.queue.shift();
      if (topics.indexOf(t) < 0) continue;
      const L = mode === 'auto' ? topicStat(store, bank.id, t).level : +mode;
      let cands = [];
      for (const d of [0, -1, 1, -2, 2]) {
        cands = bank.templates.filter((x) => x.topic === t && x.level === L + d);
        if (cands.length) break;
      }
      if (!cands.length) continue;
      const fresher = cands.filter((x) => s.recent.indexOf(x.id) < 0);
      const tpl = R.pick(fresher.length ? fresher : cands);
      let data = null;
      try { data = tpl.gen(R); } catch (e) { if (root.console) root.console.error('[banco] plantilla ' + tpl.id, e); continue; }
      if (!data || !Array.isArray(data.parts) || !data.parts.length) continue;
      s.recent = [tpl.id].concat(s.recent).slice(0, 5);
      return { tpl, topic: t, level: tpl.level, data, idx: 0, res: [], hinted: false, gaveUp: false, done: false };
    }
    return null;
  }

  // ------------------------------------------------------------------ página
  let panelRef = null;
  function render(container, route, ctx) {
    const store = (ctx && ctx.store) || MSD.store;
    if (panelRef) { panelRef.close(false); if (panelRef.panel.isConnected) panelRef.panel.remove(); panelRef = null; }
    const old = document.getElementById('drill-panel');
    if (old) old.remove();
    document.documentElement.classList.remove('drill-panel-open');

    const all = banks();
    const wrap = h('div', { class: 'px bank' });
    container.appendChild(wrap);
    const eb = h('p', { class: 'eyebrow' }, h('span', null, 'Parte 3'), h('span', { class: 'sep', 'aria-hidden': 'true' }, '·'), h('span', null, 'Práctica'));
    wrap.appendChild(h('header', { class: 'phead' }, eb,
      h('h1', { class: 'phead__title', id: 'page-title', tabindex: '-1' }, 'Banco de problemas'),
      h('p', { class: 'phead__en', lang: 'en' }, 'Problem bank'),
      h('p', { class: 'phead__summary' }, 'Un problema tras otro, siempre con números nuevos. La dificultad se ajusta sola por tema: 3 aciertos seguidos te suben de nivel y 2 fallos te bajan. Si no sabes por dónde empezar, pide la pista: te dice cómo plantearlo, sin los números.')));
    if (!all.length) {
      wrap.appendChild(h('div', { class: 'px-empty' }, h('p', { class: 'px-empty__t' }, 'Todavía no hay problemas cargados')));
      return;
    }
    const want = route && route.sectionId ? String(route.sectionId) : (store.pref('problemLastBank') || '');
    const bank = all.find((b) => b.id === want) || all[0];
    if (store.pref('problemLastBank') !== bank.id) store.setPref('problemLastBank', bank.id);

    // Secciones del banco (por ahora una; cada sección nueva aparece aquí)
    wrap.appendChild(h('nav', { class: 'bank__secs', 'aria-label': 'Secciones del banco' },
      h('span', { class: 'px-k' }, 'Sección'),
      h('div', { class: 'seg' }, all.map((b) => h('a', { class: 'bank__sec', href: '#problemas.' + b.id, 'aria-current': b.id === bank.id ? 'page' : null }, b.title))),
      h('span', { class: 'muted small' }, 'Pide más secciones cuando quieras (datos y labels, métricas, serving…).')));

    const P = prefsOf(store, bank.id);
    const topicIds = (bank.topics || []).map((t) => t.id).filter((t) => bank.templates.some((x) => x.topic === t));
    let selected = Array.isArray(P.topics) ? P.topics.filter((t) => topicIds.indexOf(t) >= 0) : topicIds.slice();
    if (!selected.length) selected = topicIds.slice();
    let mode = ['auto', '1', '2', '3'].indexOf(String(P.mode)) >= 0 ? String(P.mode) : 'auto';

    // Controles: temas, nivel y apuntes
    const chipsEl = h('div', { class: 'bank__topics', role: 'group', 'aria-label': 'Temas' });
    const modeBtns = {};
    const modeSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Nivel' }, [['auto', 'Auto'], ['1', '1'], ['2', '2'], ['3', '3']].map(([k, t]) =>
      (modeBtns[k] = h('button', { type: 'button', 'aria-pressed': String(k === mode), title: k === 'auto' ? 'El nivel se ajusta solo por tema' : 'Fijar nivel ' + k, on: { click: () => setMode(k) } }, t))));
    const openBtn = (k, label, ic) => h('button', {
      type: 'button', class: 'btn btn--sm', 'aria-controls': 'drill-panel', 'aria-expanded': 'false', dataset: { drillOpen: k },
      on: { click: () => (panelRef.isOpen() && panelRef.tab() === k ? panelRef.close(true) : panelRef.open(k)) },
    }, h('span', { html: icon(ic) }), label);
    const sessEl = h('p', { class: 'bank__sess mono small', 'aria-live': 'polite' });
    wrap.appendChild(h('div', { class: 'bank__controls' },
      h('div', { class: 'bank__row' }, h('span', { class: 'px-k' }, 'Temas'), chipsEl),
      h('div', { class: 'bank__row' }, h('span', { class: 'px-k' }, 'Nivel'), modeSeg,
        h('span', { class: 'bank__tools' }, openBtn('formulario', 'Formulario', 'approx'), openBtn('numeros', 'Números de referencia', 'ref'))),
      sessEl));
    const stage = h('div', { class: 'bank__stage' });
    wrap.appendChild(stage);

    // Apuntes (panel derecho)
    panelRef = Drill().makePanel({
      title: 'Apuntes · ' + bank.title,
      tabs: [
        { id: 'formulario', label: 'Formulario', paint: (body) => {
          (bank.topics || []).forEach((t) => {
            const list = (bank.formulas || []).filter((f) => f.topic === t.id);
            if (!list.length) return;
            body.appendChild(h('h3', { class: 'dpanel__h' }, t.title));
            Drill().paintFormulas(body, list);
          });
          const loose = (bank.formulas || []).filter((f) => !f.topic);
          if (loose.length) Drill().paintFormulas(body, loose);
        } },
        { id: 'numeros', label: 'Números de referencia', paint: (body) => {
          Drill().paintQuick(body, bank.quick, 'Sin números de referencia.');
          body.appendChild(h('p', { class: 'small' }, 'Más números: ', h('a', { href: '#ref-numeros' }, 'Números que debes saber'), '.'));
        } },
      ],
    });
    document.body.appendChild(panelRef.panel);
    const onHash = () => {
      if (!wrap.isConnected || !/^#problemas/.test(root.location.hash)) {
        if (panelRef) { panelRef.close(false); panelRef.panel.remove(); panelRef = null; }
        document.documentElement.classList.remove('drill-panel-open');
        root.removeEventListener('hashchange', onHash);
      }
    };
    root.addEventListener('hashchange', onHash);

    const S = sessionOf(bank.id);

    function paintChips() {
      chipsEl.innerHTML = '';
      const allOn = selected.length === topicIds.length;
      chipsEl.appendChild(h('button', { type: 'button', class: 'bank__chip', 'aria-pressed': String(allOn), on: { click: () => { if (allOn) return; selected = topicIds.slice(); persist(); paintChips(); } } }, 'Todos'));
      topicIds.forEach((t) => {
        const st = topicStat(store, bank.id, t);
        const on = selected.indexOf(t) >= 0;
        chipsEl.appendChild(h('button', {
          type: 'button', class: 'bank__chip', 'aria-pressed': String(on), dataset: { topic: t },
          title: st.n ? st.ok + ' de ' + st.n + ' bien · nivel ' + st.level : 'Sin intentos todavía · nivel 1',
          on: { click: () => {
            if (on && selected.length === 1) return;   // al menos un tema
            selected = on ? selected.filter((x) => x !== t) : selected.concat(t);
            persist(); paintChips();
          } },
        }, topicTitle(bank, t), h('span', { class: 'bank__lv mono' }, 'Nv ' + st.level)));
      });
    }
    function setMode(k) {
      mode = k;
      Object.keys(modeBtns).forEach((x) => modeBtns[x].setAttribute('aria-pressed', String(x === k)));
      persist();
    }
    function persist() {
      savePrefs(store, bank.id, { topics: selected.slice(), mode });
      S.queue = [];
    }
    function paintSess() {
      sessEl.textContent = S.count
        ? 'Esta sesión: ' + S.count + (S.count === 1 ? ' problema' : ' problemas') + ' · ' + S.ok + ' bien · racha ' + S.streak
        : S.problem ? 'Primer problema de la sesión · Enter comprueba y pasa al siguiente.' : 'Elige temas y nivel, y empieza. Enter comprueba y pasa al siguiente.';
    }

    function startNext(focus) {
      S.problem = makeProblem(bank, selected, mode, store);
      paintProblem(focus);
    }

    function finish(pb) {
      pb.done = true;
      const ok = !pb.gaveUp && pb.res.every((x) => x && x.ok);
      pb.ok = ok;
      S.count++;
      if (ok) { S.ok++; S.streak++; } else S.streak = 0;
      const st = topicStat(store, bank.id, pb.topic);
      st.n++;
      let msg = '';
      if (ok) {
        st.ok++;
        st.miss = 0;
        if (!pb.hinted) st.streak++;
        if (mode === 'auto' && st.streak >= LEVEL_UP && st.level < 3) { st.level++; st.streak = 0; msg = 'Subiste a nivel ' + st.level + ' en ' + topicTitle(bank, pb.topic) + '.'; }
      } else {
        st.streak = 0;
        st.miss++;
        if (mode === 'auto' && st.miss >= LEVEL_DOWN && st.level > 1) { st.level--; st.miss = 0; msg = 'Bajaste a nivel ' + st.level + ' en ' + topicTitle(bank, pb.topic) + ': consolida antes de subir.'; }
      }
      saveTopic(store, bank.id, pb.topic, st);
      pb.levelMsg = msg;
      if (msg && D.toast) D.toast(msg);
      paintChips();
    }

    function paintProblem(focus) {
      paintSess();
      stage.innerHTML = '';
      const pb = S.problem;
      if (!pb) {
        stage.appendChild(h('div', { class: 'bank__start' },
          h('button', { type: 'button', class: 'btn btn--primary btn--lg', on: { click: () => startNext(true) } }, h('span', { html: icon('play') }), 'Empezar'),
          h('span', { class: 'muted small' }, bank.templates.length + ' tipos de problema · ' + topicIds.length + ' temas · nunca se repiten los números')));
        return;
      }
      const d = pb.data;
      const ref = refInfo(pb.tpl.ref);
      const card = h('article', { class: 'dq bank__card' + (pb.done ? (pb.ok ? ' is-ok' : ' is-bad') : ''), 'aria-labelledby': 'pb-q' },
        h('div', { class: 'dq__tags' },
          h('span', { class: 'chip chip--accent' }, topicTitle(bank, pb.topic)),
          h('span', { class: 'chip' }, 'Nivel ' + pb.level),
          pb.tpl.title ? h('span', { class: 'chip' }, pb.tpl.title) : null),
        h('div', { class: 'dq__q', id: 'pb-q', tabindex: '-1', html: String(d.q || '') }));
      // Partes
      const partsEl = h('ol', { class: 'bank__parts' });
      d.parts.forEach((part, k) => {
        if (k > pb.idx && !pb.done) return;
        const r = pb.res[k];
        const li = h('li', { class: 'bank__part' + (r ? (r.ok ? ' is-ok' : ' is-bad') : ' is-current') });
        li.appendChild(h('div', { class: 'bank__ask', html: String(part.ask || '') }));
        if (r) {
          const yours = r.skipped ? 'sin responder' : Array.isArray(part.choices) ? stripTags(part.choices[r.choice]) : fmtVal(r.value) + (part.unit ? ' ' + part.unit : '');
          const right = Array.isArray(part.choices) ? stripTags(part.choices[part.answer]) : fmtAns(part) + (part.unit ? ' ' + part.unit : '');
          li.appendChild(h('p', { class: 'bank__verdict small' },
            h('span', { html: icon(r.ok ? 'check' : 'close') }),
            r.ok ? 'Bien' : 'No', ' · tu respuesta: ', h('b', { class: 'mono' }, yours), r.ok && !Array.isArray(part.choices) ? [' · exacto ≈ ', h('b', { class: 'mono' }, right)] : r.ok ? null : [' · correcto: ', h('b', { class: 'mono' }, right)]));
          if (Array.isArray(part.steps) && part.steps.length) li.appendChild(h('ol', { class: 'dq__steps' }, part.steps.map((s) => h('li', { html: String(s) }))));
        } else if (!pb.done) li.appendChild(inputFor(part, k));
        partsEl.appendChild(li);
      });
      card.appendChild(partsEl);
      if (pb.hinted && d.hint) card.appendChild(h('div', { class: 'bank__hint' }, h('p', { class: 'px-k' }, 'Cómo plantearlo'), h('div', { html: String(d.hint) })));
      if (pb.done) {
        const nOk = pb.res.filter((x) => x && x.ok).length;
        const res = h('div', { class: 'dq__res', id: 'pb-res', tabindex: '-1' },
          h('p', { class: 'dq__verdict' }, h('span', { html: icon(pb.ok ? 'check' : 'close') }),
            pb.ok ? (pb.hinted ? '¡Correcto! (con pista: no cuenta para subir de nivel)' : '¡Correcto!') : (pb.gaveUp ? 'Viste la solución' : 'Bien en ' + nOk + ' de ' + d.parts.length + (d.parts.length === 1 ? ' parte' : ' partes'))),
          d.takeaway ? h('div', { class: 'bank__takeaway' }, h('p', { class: 'px-k' }, 'Qué decide este número'), h('div', { html: String(d.takeaway) })) : null,
          pb.levelMsg ? h('p', { class: 'bank__level small' }, h('b', null, pb.levelMsg)) : null,
          ref ? h('p', { class: 'small' }, 'Repasar: ', h('a', { href: ref.href }, ref.title)) : null);
        card.appendChild(res);
        card.appendChild(h('div', { class: 'dq__actions' },
          h('button', { type: 'button', class: 'btn btn--primary', on: { click: () => startNext(true) } }, 'Siguiente problema', h('span', { html: icon('arrow-right') }))));
      } else {
        card.appendChild(h('div', { class: 'dq__actions' },
          h('button', { type: 'button', class: 'btn btn--primary', on: { click: () => check() } }, 'Comprobar'),
          d.hint && !pb.hinted ? h('button', { type: 'button', class: 'btn btn--sm', on: { click: () => { pb.hinted = true; paintProblem(false); focusInput(); } } }, h('span', { html: icon('question') }), 'Pista: cómo plantearlo') : null,
          h('button', { type: 'button', class: 'btn btn--text btn--sm', on: { click: giveUp } }, 'Ver solución')));
      }
      stage.appendChild(card);
      if (MSD.Blocks && MSD.Blocks.decorate) safe(() => MSD.Blocks.decorate(card));
      if (focus) {
        if (pb.done) { const t = stage.querySelector('#pb-res'); if (t) t.focus({ preventScroll: true }); }
        else if (!focusInput()) { const q = stage.querySelector('#pb-q'); if (q) q.focus({ preventScroll: true }); }
        const top = card.getBoundingClientRect().top;
        if (top < 0 || top > root.innerHeight * 0.5) card.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
      }
    }

    function stripTags(s) { return String(s || '').replace(/<[^>]*>/g, ''); }

    function inputFor(part, k) {
      if (Array.isArray(part.choices)) {
        const name = 'pb-ch-' + k;
        return h('div', { class: 'dq__opts', role: 'radiogroup', 'aria-label': stripTags(part.ask) }, part.choices.map((c, i) => h('label', { class: 'dq__opt', for: name + '-' + i },
          h('input', { type: 'radio', name, value: String(i), id: name + '-' + i }),
          h('span', { class: 'dq__key mono' }, String.fromCharCode(65 + i)),
          h('span', { class: 'dq__otext', html: String(c) }))));
      }
      const id = 'pb-in-' + k;
      const inp = h('input', { class: 'input dq__num mono', id, inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', placeholder: 'tu número' });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); check(); } });
      return h('div', { class: 'dq__calc' },
        h('label', { class: 'sr-only', for: id }, 'Tu respuesta'),
        h('div', { class: 'dq__row' }, inp, part.unit ? h('span', { class: 'dq__unit' }, part.unit) : null),
        h('p', { class: 'muted small' }, tolText(part)),
        h('p', { class: 'result-msg is-bad bank__msg', role: 'alert', hidden: true }));
    }
    function focusInput() {
      const el = stage.querySelector('.bank__part.is-current input');
      if (el) { el.focus({ preventScroll: true }); return true; }
      return false;
    }

    function check() {
      const pb = S.problem;
      if (!pb || pb.done) return;
      const part = pb.data.parts[pb.idx];
      const cur = stage.querySelector('.bank__part.is-current');
      if (!cur) return;
      if (Array.isArray(part.choices)) {
        const sel = cur.querySelector('input:checked');
        if (!sel) { if (D.toast) D.toast('Elige una opción'); return; }
        pb.res[pb.idx] = { ok: +sel.value === part.answer, choice: +sel.value };
      } else {
        const inp = cur.querySelector('input');
        const v = Drill().parseNum(inp.value);
        if (v === null) {
          const msg = cur.querySelector('.bank__msg');
          msg.textContent = 'Escribe solo el número (p. ej. 350, 1,200, 1.2k o 99.95).';
          msg.hidden = false;
          inp.focus();
          return;
        }
        pb.res[pb.idx] = { ok: checkNum(part, v), value: v, raw: inp.value };
      }
      if (pb.idx < pb.data.parts.length - 1) { pb.idx++; paintProblem(false); focusInput(); return; }
      finish(pb);
      paintProblem(true);
    }

    function giveUp() {
      const pb = S.problem;
      if (!pb || pb.done) return;
      for (let k = pb.idx; k < pb.data.parts.length; k++) if (!pb.res[k]) pb.res[k] = { ok: false, skipped: true };
      pb.gaveUp = true;
      finish(pb);
      paintProblem(true);
    }

    // Teclado: Enter comprueba (fuera del input) o pasa al siguiente problema; 1–4 / A–D eligen opción.
    wrap.addEventListener('keydown', (e) => {
      const pb = S.problem;
      if (!pb || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      const typing = t && t.tagName === 'INPUT' && t.type !== 'radio';
      if (typing) return;
      if (e.key === 'Enter' && !(t && (t.tagName === 'BUTTON' || t.tagName === 'A'))) {
        e.preventDefault();
        if (pb.done) startNext(true); else check();
        return;
      }
      const part = !pb.done && pb.data.parts[pb.idx];
      if (part && Array.isArray(part.choices)) {
        const k = '1234'.indexOf(e.key) >= 0 ? '1234'.indexOf(e.key) : 'abcd'.indexOf(String(e.key).toLowerCase());
        if (k >= 0 && k < part.choices.length) { const r = stage.querySelector('.bank__part.is-current input[value="' + k + '"]'); if (r) { r.checked = true; r.focus(); } }
      }
    });

    paintChips();
    paintProblem(false);
  }

  // current(bankId): el problema en curso (solo lectura; la usa la prueba de humo).
  MSD.Bank = { render, current: (bankId) => (sessions[bankId] || {}).problem || null, checkNum, fmtAns };
})(typeof window !== 'undefined' ? window : globalThis);
