/* El mapa de metro del proyecto, con el estilo de «Del dato a producción»: cada paso es una estación y el color de la
   línea dice a qué ritmo cambia (semanas, días, milisegundos, continuo; magenta = paso propio del patrón).
   - Angosto (< 640 px): una línea vertical, con el tramo (Datos, Modelo, Release, Operación) como encabezado.
   - Ancho: una serpentina de 3 a 6 columnas; las filas pares van a la izquierda y las nones vuelven.
   Las estaciones son HTML (el texto se acomoda solo); las líneas son un SVG que se dibuja midiendo los puntos. */
import { STATUS_LABEL, TRAMO_LABEL, SPEED_LABEL } from './shared/model.mjs';
import { esc } from './lib.js';

const dotSvg = (n, status) => `<svg viewBox="0 0 40 40" aria-hidden="true">
  ${status === 'en_curso' ? '<circle class="halo" cx="20" cy="20" r="17"/>' : ''}
  <circle class="o" cx="20" cy="20" r="16"/>
  ${status === 'hecho' ? '<path class="ck" d="M12.5 20.5l5 5 10-11" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>'
    : status === 'bloqueado' ? '<text class="n" x="20" y="25.5" text-anchor="middle">!</text>'
    : `<text class="n" x="20" y="25" text-anchor="middle">${n}</text>`}
</svg>`;

const VUELTA_TXT = { pendiente: '○', en_curso: '◐', hecho: '✓' };
const vv = (s) => `<span class="vv" title="Pass 1 (guided) and pass 2 (solo)">P1 ${s.vuelta.v1 === 'hecho' ? '<b>✓</b>' : VUELTA_TXT[s.vuelta.v1]} · P2 ${s.vuelta.v2 === 'hecho' ? '<b>✓</b>' : VUELTA_TXT[s.vuelta.v2]}</span>`;

// Entry-gate chip: open (calcs left), met, or waived.
function gateChip(g) {
  if (!g || !g.need) return '';
  if (g.waived && !g.met) return '<span class="chip chip--waived" title="Entry gate waived">gate waived</span>';
  if (g.met) return `<span class="chip chip--hecho" title="Entry gate met">gate ✓ ${g.done + g.revealed}/${g.need}</span>`;
  return `<span class="chip chip--gate" title="Entry gate open">gate ${g.done + g.revealed}/${g.need}${g.failedChecks ? ' · check ✗' : ''}</span>`;
}

function stationHtml(p, s, i, ev) {
  const crit = s.done.length ? `DoD ${s.done.filter((d) => d.ok).length}/${s.done.length}` : '';
  const hit = s.hitos.length ? `${s.hitos.filter((h) => h.status === 'hecho').length}/${s.hitos.length} milestones` : '';
  const why = s.status === 'no_aplica' || s.status === 'bloqueado' ? s.reason : '';
  const isNext = p.resume.nextStepId === s.id;
  return `<a class="st ln-${s.speed}" data-s="${s.status}" data-i="${i}" href="#/p/${esc(p.id)}/step/${esc(s.id)}" aria-label="${esc(`${i + 1}. ${s.title}: ${STATUS_LABEL[s.status]}`)}">
    <span class="st__dot">${dotSvg(i + 1, s.status)}</span>
    <span class="st__b">
      <span class="st__t">${esc(s.title)}</span>
      <span class="st__m">
        <span class="chip chip--${s.status}">${STATUS_LABEL[s.status]}</span>
        ${isNext ? '<span class="chip chip--next">Next</span>' : ''}
        ${s.status === 'no_aplica' ? '' : gateChip(ev && ev.gates[s.id])}
        ${vv(s)}
      </span>
      ${hit || crit ? `<span class="small">${[hit, crit].filter(Boolean).join(' · ')}</span>` : ''}
      ${why ? `<span class="st__why">${esc(why)}</span>` : ''}
    </span>
  </a>`;
}

export function mapHtml(p, ev) {
  const rows = [];
  let tramo = null;
  p.steps.forEach((s, i) => {
    if (s.tramo !== tramo) { tramo = s.tramo; rows.push(`<div class="band" aria-hidden="true">${TRAMO_LABEL[tramo].toUpperCase()}</div>`); }
    rows.push(stationHtml(p, s, i, ev));
  });
  const speeds = [...new Set(p.steps.map((s) => s.speed))];
  return `<div class="map" data-layout="list">
    <svg class="map__lines" aria-hidden="true"></svg>
    <nav class="stations" aria-label="Project steps">${rows.join('')}</nav>
    ${p.steps.length ? '<div class="loopnote"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4"/></svg>Monitoring feeds back into data: retraining closes the loop.</div>' : ''}
  </div>
  <div class="legend">${speeds.map((sp) => `<span class="ln-${sp}"><i></i>${SPEED_LABEL[sp]}</span>`).join('')}
    <span>Steps: ✓ done · ◎ in progress · ! blocked · ┄ N/A</span><span>Passes: ✓ done · ◐ in progress · ○ to do</span></div>`;
}

// Acomoda las estaciones y dibuja las líneas. Se vuelve a llamar cuando cambia el ancho.
export function layoutMap(root) {
  const map = root.querySelector('.map');
  if (!map) return;
  const nav = map.querySelector('.stations');
  const sts = [...nav.querySelectorAll('.st')];
  const width = nav.clientWidth;
  const grid = width >= 600;
  map.dataset.layout = grid ? 'grid' : 'list';
  if (grid) {
    const cols = Math.max(3, Math.min(6, Math.floor(width / 175)));
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

function drawLines(map, sts, grid) {
  const svg = map.querySelector('.map__lines');
  const box = map.getBoundingClientRect();
  const pts = sts.map((el) => {
    const r = el.querySelector('.st__dot').getBoundingClientRect();
    return { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top, cls: el.className.match(/ln-\w+/)[0], na: el.dataset.s === 'no_aplica' };
  });
  svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
  const paths = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    let d;
    if (grid && Math.abs(a.y - b.y) > 2) {
      // vuelta de la serpentina: por el borde del mapa, para no cruzar el texto de la estación
      const edge = a.x > box.width / 2 ? box.width - 7 : 7;
      const r = Math.min(14, Math.abs(edge - a.x) / 2);
      const sx = edge > a.x ? 1 : -1;
      d = `M${a.x},${a.y} L${edge - sx * r},${a.y} Q${edge},${a.y} ${edge},${a.y + r} L${edge},${b.y - r} Q${edge},${b.y} ${edge - sx * r},${b.y} L${b.x},${b.y}`;
    } else d = `M${a.x},${a.y} L${b.x},${b.y}`;
    paths.push(`<path class="${b.cls}${a.na || b.na ? ' na' : ''}" d="${d}"/>`);
  }
  svg.innerHTML = paths.join('');
}
