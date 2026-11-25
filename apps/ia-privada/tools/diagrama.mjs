// Los diagramas de Sensei usan el mismo motor que la Ronda de Diseño (vendor/ronda/diagram.js, copiado por
// node apps/trueml/sync.mjs): carriles, cajas con forma según su tipo, flechas en ángulo recto, recorridos paso a
// paso, «Ampliar» y un clic en cada caja que dice por qué está ahí. El build revisa la spec, convierte los textos
// (que aceptan el Markdown en línea de las lecciones, con [[id]] del glosario) y la deja en la página; app.js la dibuja.
//
// content/diagramas/<id>.json:
//   { "titulo": "…", "width": 100, "height": 44,                    unidades de grilla: 1 = 10 px
//     "lanes": [ { "id", "label", "kind": online|offline|monitor|neutral, "x", "y", "w", "h" } ],
//     "nodes": [ { "id", "label", "sub", "note", "badge", "kind", "x", "y", "w", "h" } ],
//     "edges": [ { "from", "to", "kind": online|offline|monitor|async|neutral, "label", "dashed", "bidir",
//                  "fromSide"/"toSide": l|r|t|b, "via": [[x, y], …] } ],
//     "flows": [ { "id", "label", "steps": [ { "nodes": [ids], "edges": ["a>b"], "text": "…" } ] } ] }
// Tipos de caja: client, edge, service, model, gpu, store, queue, job, monitor, external, human.
import { esc } from './md.mjs';

const KINDS = new Set(['client', 'edge', 'service', 'model', 'gpu', 'store', 'queue', 'job', 'monitor', 'external', 'human']);
const EDGES = new Set(['online', 'offline', 'monitor', 'async', 'neutral']);
const LANES = new Set(['online', 'offline', 'monitor', 'neutral']);
const SIDES = new Set(['l', 'r', 't', 'b']);
const num = (v) => typeof v === 'number' && isFinite(v);

export function validar(d, id) {
  const e = [];
  if (!d.titulo) e.push('falta «titulo»');
  if (!num(d.width) || !num(d.height)) e.push('faltan «width» y «height» (unidades de 10 px)');
  const ids = new Set();
  for (const n of d.nodes || []) {
    if (!n.id || ids.has(n.id)) e.push(`nodo sin id o repetido: «${n.id}»`);
    ids.add(n.id);
    if (!n.label) e.push(`nodo ${n.id}: falta «label»`);
    if (!KINDS.has(n.kind)) e.push(`nodo ${n.id}: tipo «${n.kind}» no existe`);
    for (const k of ['x', 'y', 'w', 'h']) if (!num(n[k])) e.push(`nodo ${n.id}: falta «${k}»`);
    if (num(n.x) && num(n.w) && n.x + n.w > d.width) e.push(`nodo ${n.id}: se sale a lo ancho`);
    if (num(n.y) && num(n.h) && n.y + n.h > d.height) e.push(`nodo ${n.id}: se sale a lo alto`);
  }
  if (ids.size < 2) e.push('necesita al menos 2 nodos');
  const llaves = new Set();
  for (const a of d.edges || []) {
    if (!ids.has(a.from) || !ids.has(a.to)) e.push(`flecha ${a.from}>${a.to}: nodo inexistente`);
    if (a.kind && !EDGES.has(a.kind)) e.push(`flecha ${a.from}>${a.to}: tipo «${a.kind}» no existe`);
    for (const k of ['fromSide', 'toSide']) if (a[k] && !SIDES.has(a[k])) e.push(`flecha ${a.from}>${a.to}: ${k} «${a[k]}»`);
    llaves.add(`${a.from}>${a.to}`);
  }
  for (const l of d.lanes || []) if (!LANES.has(l.kind)) e.push(`carril ${l.id}: tipo «${l.kind}» no existe`);
  for (const f of d.flows || []) {
    if (!f.label || !Array.isArray(f.steps) || !f.steps.length) e.push(`recorrido ${f.id}: falta «label» o «steps»`);
    (f.steps || []).forEach((s, k) => {
      for (const n of s.nodes || []) if (!ids.has(n)) e.push(`recorrido ${f.id}, paso ${k + 1}: nodo «${n}» no existe`);
      for (const a of s.edges || []) if (!llaves.has(a)) e.push(`recorrido ${f.id}, paso ${k + 1}: flecha «${a}» no existe`);
      if (!s.text) e.push(`recorrido ${f.id}, paso ${k + 1}: falta «text»`);
    });
  }
  return e.map((x) => `diagrama ${id}: ${x}`);
}

// La spec lista para el motor: los textos que se muestran como HTML pasan por el Markdown en línea.
function preparar(d, inline) {
  const plano = (s) => (s == null ? s : inline(s));
  return {
    width: d.width, height: d.height,
    lanes: (d.lanes || []).map((l) => ({ ...l, label: plano(l.label) })),
    nodes: d.nodes.map((n) => ({ ...n, label: plano(n.label), sub: plano(n.sub), badge: plano(n.badge), note: plano(n.note) })),
    edges: (d.edges || []).map((a) => ({ ...a, label: plano(a.label) })),
    flows: (d.flows || []).map((f) => ({ ...f, label: plano(f.label), steps: f.steps.map((s) => ({ ...s, text: plano(s.text) })) })),
  };
}

// Sin JavaScript se ve la lista de componentes con su porqué; con JavaScript, app.js la cambia por el diagrama.
export function montar(id, d, pie, inline) {
  const spec = preparar(d, inline);
  const lista = spec.nodes.map((n) => `<li><b>${n.label}</b>${n.sub ? ` · ${n.sub}` : ''}${n.note ? `<br>${n.note}` : ''}</li>`).join('');
  return `<div class="dg-mount" data-dg="${esc(id)}" data-titulo="${esc(d.titulo)}">
<script type="application/json">${JSON.stringify({ spec, caption: pie || '' }).replace(/</g, '\\u003c')}</script>
<figure class="dg-sinjs"><figcaption><b>${esc(d.titulo)}</b>${pie ? ` · ${pie}` : ''}</figcaption><ul>${lista}</ul></figure>
</div>`;
}
