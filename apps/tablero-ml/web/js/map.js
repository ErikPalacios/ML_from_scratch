/* El mapa de metro del proyecto, con el diseño TrueML del mapa del C01 del Dojo: un panel azul marino, la línea
   pintada con las 6 etapas de la T (datos, modelo, API, contenedor, orquestación, monitoreo), un brillo debajo,
   puntos que fluyen del dato al monitoreo y cada paso como estación (anillo = por hacer, medio lleno = en curso,
   lleno con ✓ = hecho, «!» = bloqueado, punteado = N/A, anillo amarillo = la próxima acción).
   - Arriba: el avance (una pastilla por paso, del color de su etapa) y la T de vidrio, que se enciende según lo hecho
     en cada etapa; al pasar por una estación se enciende su etapa en la T y se atenúan las demás estaciones.
   - Angosto (< 600 px): una línea vertical, con el tramo y su cadencia (semanas, días…) como encabezado.
   - Ancho: una serpentina de 3 a 6 columnas, con las filas parejas; las filas pares van a la izquierda y las nones
     vuelven, y la vuelta va por fuera de las estaciones.
   Las estaciones son HTML (el texto se acomoda solo); las líneas son un SVG que se dibuja midiendo los puntos.
   La etapa de un paso sale de su estación del C01 (etapas.json de TrueML); un paso propio del patrón o tuyo toma la
   del paso anterior si cabe en su tramo, o la primera de su tramo. Solo es presentación: no se guarda. */
import { STATUS_LABEL, TRAMO_LABEL, SPEED_LABEL, progress } from './shared/model.mjs';
import { esc } from './lib.js';

export const STAGES = ['datos', 'modelo', 'api', 'contenedor', 'orquestacion', 'monitoreo'];
export const STAGE_LABEL = { diseno: 'Design', datos: 'Data', modelo: 'Model', api: 'API', contenedor: 'Container', orquestacion: 'Orchestration', monitoreo: 'Monitoring' };
// Las 12 estaciones del C01 en las 6 etapas (apps/trueml/etapas.json: 1–2, 3–5, 6, 7–8, 9–10, 11–12); el kickoff es diseño.
const BASE_STAGE = {
  kickoff: 'diseno', datos: 'datos', versionado: 'datos', entrenamiento: 'modelo', gate: 'modelo', export: 'modelo', serving: 'api',
  empaquetado: 'contenedor', cicd: 'contenedor', kubernetes: 'orquestacion', rollout: 'orquestacion', request: 'monitoreo', monitoreo: 'monitoreo',
};
const TRAMO_STAGES = { diseno: ['diseno'], datos: ['datos'], modelo: ['modelo'], release: ['api', 'contenedor'], operacion: ['orquestacion', 'monitoreo'] };

export function stagesOf(steps) {
  let prev = null;
  return steps.map((s) => {
    const known = BASE_STAGE[s.base || s.id];
    const allowed = TRAMO_STAGES[s.tramo] || ['api'];
    const st = known || (allowed.includes(prev) ? prev : allowed[0]);
    prev = st;
    return st;
  });
}

// La T de vidrio (vendor/trueml/trueml-mark.js); sin el script, nada.
export const tMark = (key, labels = null, maxH) => (window.TrueMLMark ? window.TrueMLMark.mark(true, labels, key, maxH) : '');
// La T con etiquetas en inglés (la interfaz del tablero es en inglés).
export const T_LABELS = [['Data', 'dataset'], ['Model', 'PyTorch'], ['API', 'FastAPI'], ['Container', 'Docker'], ['Orchestration', 'Kubernetes'], ['Monitoring', 'Prometheus · Grafana']];
// La T chica de 6 cuadritos con una etapa encendida (como en la Ronda).
export function miniT(stage) {
  return `<span class="tm-mini" aria-hidden="true">${['contenedor', 'orquestacion', 'monitoreo', 'api', 'modelo', 'datos'].map((id) => `<i class="tm-mini-${id}${id === stage ? '' : ' tm-off'}"></i>`).join('')}</span>`;
}

// Una estación: el anillo con su número o su marca. `next` = la próxima acción; `own` = paso propio del patrón.
export function dotSvg(n, status, next = false, own = false) {
  const glyph = status === 'hecho' ? '<path class="ck" d="M16.5 24.5l5 5 10-11"/>'
    : status === 'bloqueado' ? '<text class="n" x="24" y="29.5" text-anchor="middle">!</text>'
    : `<text class="n" x="24" y="28.6" text-anchor="middle">${n}</text>`;
  return `<svg viewBox="0 0 48 48" aria-hidden="true">
    ${next ? '<circle class="nx" cx="24" cy="24" r="22"/>' : ''}
    ${status === 'en_curso' ? '<circle class="halo" cx="24" cy="24" r="17"/>' : ''}
    <circle class="o" cx="24" cy="24" r="17"/>
    ${status === 'en_curso' ? '<path class="half" d="M24 9.5a14.5 14.5 0 0 0 0 29z"/>' : ''}
    ${glyph}
    ${own ? '<g class="own"><circle cx="38.5" cy="9.5" r="6.5"/><path d="M38.5 6.6v5.8M35.6 9.5h5.8"/></g>' : ''}
  </svg>`;
}

const VUELTA_TXT = { pendiente: '○', en_curso: '◐', hecho: '✓' };
const vv = (s) => `<span class="vv" title="Pass 1 (guided) and pass 2 (solo)">P1 ${s.vuelta.v1 === 'hecho' ? '<b>✓</b>' : VUELTA_TXT[s.vuelta.v1]} · P2 ${s.vuelta.v2 === 'hecho' ? '<b>✓</b>' : VUELTA_TXT[s.vuelta.v2]}</span>`;

// Entry-gate chip: open (calcs left), met, or waived.
function gateChip(g) {
  if (!g || !g.need) return '';
  if (g.waived && !g.met) return '<span class="chip chip--waived" title="Entry gate waived">gate waived</span>';
  if (g.met) return `<span class="chip chip--hecho" title="Entry gate met">gate ✓ ${g.done + g.revealed}/${g.need}</span>`;
  return `<span class="chip chip--gate" title="Entry gate open">gate ${g.done + g.revealed}/${g.need}${g.failedChecks ? ' · check ✗' : ''}</span>`;
}

const cadence = (s) => (s.speed === 'nuevo' ? 'pattern-specific' : s.speed === 'diseno' ? 'design' : SPEED_LABEL[s.speed]);

function stationHtml(p, s, i, ev, stage) {
  const crit = s.done.length ? `DoD ${s.done.filter((d) => d.ok).length}/${s.done.length}` : '';
  const hit = s.hitos.length ? `${s.hitos.filter((h) => h.status === 'hecho').length}/${s.hitos.length} milestones` : '';
  const why = s.status === 'no_aplica' || s.status === 'bloqueado' ? s.reason : '';
  const isNext = p.resume.nextStepId === s.id;
  const own = s.speed === 'nuevo';
  return `<a class="st stg-${stage}" data-s="${s.status}" data-i="${i}" data-stage="${stage}" ${isNext ? 'data-next' : ''} href="#/p/${esc(p.id)}/step/${esc(s.id)}"
      data-hint="${esc(`${i + 1} · ${s.title} → ${STAGE_LABEL[stage]}${stage === 'diseno' ? '' : ' stage'} · ${cadence(s)}`)}"
      aria-label="${esc(`${i + 1}. ${s.title}: ${STATUS_LABEL[s.status]}${isNext ? ', next action' : ''}. Stage: ${STAGE_LABEL[stage]}.`)}">
    <span class="st__dot">${dotSvg(i + 1, s.status, isNext, own)}</span>
    <span class="st__b">
      <span class="st__t">${esc(s.title)}</span>
      <span class="st__m">
        ${isNext ? '<span class="chip chip--next">Next</span>' : ''}
        <span class="chip chip--${s.status}">${STATUS_LABEL[s.status]}</span>
        ${s.status === 'no_aplica' ? '' : gateChip(ev && ev.gates[s.id])}
      </span>
      <span class="st__x">${[vv(s), hit, crit].filter(Boolean).map((x) => `<span class="nb">${x}</span>`).join(' · ')}</span>
      ${why ? `<span class="st__why">${esc(why)}</span>` : ''}
    </span>
  </a>`;
}

// Fracción hecha de cada etapa (sin contar los N/A), para encender la T.
function stageProgress(steps, stages) {
  const fr = {};
  STAGES.forEach((st) => {
    const mine = steps.filter((s, i) => stages[i] === st && s.status !== 'no_aplica');
    fr[st] = mine.length ? mine.filter((s) => s.status === 'hecho').length / mine.length : 0;
  });
  return fr;
}

const STATE_KEY = [['pendiente', 'to do'], ['en_curso', 'in progress'], ['hecho', 'done'], ['bloqueado', 'blocked'], ['no_aplica', 'N/A']];

export function mapHtml(p, ev, patternName) {
  const stages = stagesOf(p.steps);
  const pr = progress(p);
  const rows = [];
  let tramo = null;
  p.steps.forEach((s, i) => {
    if (s.tramo !== tramo) {
      tramo = s.tramo;
      const group = [];
      for (let j = i; j < p.steps.length && p.steps[j].tramo === tramo; j++) group.push(p.steps[j]);
      const speeds = [...new Set(group.map((x) => x.speed).filter((sp) => sp !== 'nuevo' && sp !== 'diseno'))].map((sp) => SPEED_LABEL[sp]);
      rows.push(`<div class="band stg-${stages[i]}" aria-hidden="true"><b>${TRAMO_LABEL[tramo]}</b>${speeds.length ? ` · ${speeds.join(' · ')}` : ''}</div>`);
    }
    rows.push(stationHtml(p, s, i, ev, stages[i]));
  });
  const fr = stageProgress(p.steps, stages);
  const pips = p.steps.map((s, i) => `<i class="stg-${stages[i]}" data-s="${s.status}"></i>`).join('');
  const present = ['diseno', ...STAGES].filter((st) => stages.includes(st));
  const hasOwn = p.steps.some((s) => s.speed === 'nuevo');
  const rest = 'Line colors are the six stages of the T, from data to monitoring.';
  return `<section class="map" data-layout="list" aria-label="Project map">
    <div class="tm-stripe map__stripe" aria-hidden="true"><span class="tm-c-datos"></span><span class="tm-c-modelo"></span><span class="tm-c-api"></span><span class="tm-c-contenedor"></span><span class="tm-c-orquestacion"></span><span class="tm-c-monitoreo"></span></div>
    <header class="map__head">
      <div class="map__sum">
        <p class="map__eyebrow">${esc(patternName || 'Project')} · data → monitoring</p>
        <p class="map__big"><b>${pr.hecho}</b> of ${pr.total} steps done${pr.enCurso ? `<span> · ${pr.enCurso} in progress</span>` : ''}${pr.bloqueado ? `<span class="warn"> · ${pr.bloqueado} blocked</span>` : ''}</p>
        <div class="map__pips" role="img" aria-label="${esc(`${pr.hecho} of ${pr.total} steps done`)}">${pips}</div>
        <p class="map__hint" data-rest="${esc(rest)}">${esc(rest)}</p>
      </div>
      <div class="map__t" aria-hidden="true" data-fr='${esc(JSON.stringify(fr))}'>${tMark('map')}</div>
    </header>
    <div class="map__body">
      <svg class="map__lines" aria-hidden="true"></svg>
      <nav class="stations" aria-label="Project steps">${rows.join('') || '<p class="map__empty">No steps yet: add one below.</p>'}</nav>
    </div>
    ${p.steps.length ? '<p class="loopnote"><span aria-hidden="true">↺</span> Monitoring feeds back into data: retraining closes the loop.</p>' : ''}
    <div class="legend">
      <div class="legend__row"><span class="legend__k">Line · stage</span>${present.map((st) => `<span class="stg-${st}"><i></i>${STAGE_LABEL[st]}</span>`).join('')}</div>
      <div class="legend__row"><span class="legend__k">Steps</span>${STATE_KEY.map(([st, label]) => `<span class="lg stg-diseno" data-s="${st}"><span class="lg__dot">${dotSvg('', st)}</span>${label}</span>`).join('')}<span class="lg stg-diseno" data-s="pendiente"><span class="lg__dot">${dotSvg('', 'pendiente', true)}</span>next action</span>${hasOwn ? `<span class="lg stg-diseno" data-s="pendiente"><span class="lg__dot">${dotSvg('', 'pendiente', false, true)}</span>pattern-specific</span>` : ''}</div>
      <div class="legend__row"><span class="legend__k">Passes</span><span>P1 guided · P2 solo: ✓ done · ◐ in progress · ○ to do</span></div>
    </div>
  </section>`;
}

// ---------------------------------------------------------------- la T del mapa
function paintT(t) {
  if (!t) return;
  let fr = {};
  try { fr = JSON.parse(t.dataset.fr || '{}'); } catch {}
  t.querySelectorAll('svg > g[data-stage]').forEach((g) => {
    const f = fr[g.getAttribute('data-stage')] || 0;
    g.style.transition = 'opacity .3s ease';
    g.style.opacity = String(Math.round((0.26 + 0.74 * f) * 100) / 100);
  });
}

// Pasar por una estación (o enfocarla con el teclado) enciende su etapa en la T y atenúa las demás.
export function initMap(app) {
  let cur = null;
  const focus = (st) => {
    const map = st ? st.closest('.map') : app.querySelector('.map');
    if (!map || st === cur) return;
    cur = st;
    const t = map.querySelector('.map__t');
    const hint = map.querySelector('.map__hint');
    if (st) {
      map.dataset.focus = st.dataset.stage;
      if (hint) hint.textContent = st.dataset.hint;
      if (t && window.TrueMLMark && STAGES.includes(st.dataset.stage)) window.TrueMLMark.sync(t, [st.dataset.stage], 0.1);
      else paintT(t);
    } else {
      delete map.dataset.focus;
      if (hint) hint.textContent = hint.dataset.rest;
      paintT(t);
    }
  };
  const pick = (e) => {
    const st = e.target.closest && e.target.closest('.map .stations .st');
    if (st) focus(st);
  };
  app.addEventListener('mouseover', pick);
  app.addEventListener('focusin', pick);
  app.addEventListener('mouseout', (e) => {
    if (!cur || !e.target.closest || !e.target.closest('.map .stations')) return;
    const to = e.relatedTarget;
    if (!to || !to.closest || !to.closest('.map .stations .st')) focus(null);
  });
  app.addEventListener('focusout', (e) => {
    if (cur && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.map .stations .st'))) focus(null);
  });
  // cada render nuevo empieza sin foco
  return () => { cur = null; };
}

// Acomoda las estaciones y dibuja las líneas. Se vuelve a llamar cuando cambia el ancho.
export function layoutMap(root) {
  const map = root.querySelector('.map');
  if (!map) return;
  paintT(map.querySelector('.map__t'));
  const nav = map.querySelector('.stations');
  const sts = [...nav.querySelectorAll('.st')];
  const width = nav.clientWidth;
  const grid = width >= 600;
  map.dataset.layout = grid ? 'grid' : 'list';
  if (grid) {
    // filas parejas: con 13 pasos y hasta 6 columnas, 5 · 5 · 3 en vez de 6 · 6 · 1
    const maxCols = Math.max(3, Math.min(6, Math.floor(width / 170)));
    const rowsN = Math.max(1, Math.ceil(sts.length / maxCols));
    const cols = Math.max(3, Math.ceil(sts.length / rowsN));
    nav.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    sts.forEach((el, i) => {
      const row = Math.floor(i / cols);
      const col = row % 2 === 0 ? i % cols : cols - 1 - (i % cols);
      el.style.gridRow = String(row + 1);
      el.style.gridColumn = String(col + 1);
    });
  } else {
    nav.style.gridTemplateColumns = '';
    sts.forEach((el) => { el.style.gridRow = ''; el.style.gridColumn = ''; });
  }
  drawLines(map, sts, grid);
}

// Una polilínea con las esquinas redondeadas.
function pathD(pts, r) {
  const f = (n) => Math.round(n * 10) / 10;
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], [cx, cy] = pts[i + 1];
    const l1 = Math.hypot(bx - ax, by - ay), l2 = Math.hypot(cx - bx, cy - by);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    if (!rr) { d += ` L${f(bx)},${f(by)}`; continue; }
    d += ` L${f(bx - ((bx - ax) / l1) * rr)},${f(by - ((by - ay) / l1) * rr)} Q${f(bx)},${f(by)} ${f(bx + ((cx - bx) / l2) * rr)},${f(by + ((cy - by) / l2) * rr)}`;
  }
  const z = pts[pts.length - 1];
  return d + ` L${f(z[0])},${f(z[1])}`;
}

// Parte una polilínea a la mitad de su largo: la primera mitad va del color de una estación, la segunda del de la otra.
function splitHalf(pts) {
  const segs = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); segs.push(l); total += l; }
  let left = total / 2;
  for (let i = 0; i < segs.length; i++) {
    if (left <= segs[i]) {
      const t = segs[i] ? left / segs[i] : 0, a = pts[i], b = pts[i + 1];
      const m = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      return [[...pts.slice(0, i + 1), m], [m, ...pts.slice(i + 1)]];
    }
    left -= segs[i];
  }
  return [pts, [pts[pts.length - 1]]];
}

function drawLines(map, sts, grid) {
  const body = map.querySelector('.map__body');
  const svg = map.querySelector('.map__lines');
  const box = body.getBoundingClientRect();
  const pts = sts.map((el) => {
    const r = el.querySelector('.st__dot').getBoundingClientRect();
    return { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top, stage: el.dataset.stage, na: el.dataset.s === 'no_aplica' };
  });
  svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
  const glow = [], line = [], route = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    let poly;
    if (grid && Math.abs(a.y - b.y) > 2) {
      // vuelta de la serpentina: por fuera de las estaciones, en el margen del panel
      const edge = a.x > box.width / 2 ? box.width + 10 : -10;
      poly = [[a.x, a.y], [edge, a.y], [edge, b.y], [b.x, b.y]];
    } else poly = [[a.x, a.y], [b.x, b.y]];
    route.push(...(route.length ? poly.slice(1) : poly));
    if (a.na || b.na) { line.push(`<path class="na" d="${pathD(poly, 26)}"/>`); continue; }
    const halves = a.stage === b.stage ? [[poly, a.stage]] : splitHalf(poly).map((h, k) => [h, k ? b.stage : a.stage]);
    halves.forEach(([h, st]) => {
      if (h.length < 2) return;
      const d = pathD(h, 26);
      glow.push(`<path class="glow stg-${st}" d="${d}"/>`);
      line.push(`<path class="ln stg-${st}" d="${d}"/>`);
    });
  }
  const flow = route.length > 1 ? `<path class="flow" d="${pathD(route, 26)}"/>` : '';
  svg.innerHTML = glow.join('') + line.join('') + flow;
}
