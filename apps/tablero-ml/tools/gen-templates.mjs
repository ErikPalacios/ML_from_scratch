#!/usr/bin/env node
// Genera web/js/shared/templates.mjs: los pasos obligatorios de cada patrón, sacados del curso y de la hoja
// «Del dato a producción». No inventa pasos: todo sale de estas fuentes.
//   - Las 12 estaciones del C01 (patrón online síncrono): ../cheat-sheets/sheets/recorrido/fuentes/content-w1.json y -w2.json
//     (pregunta, resumen, artefacto que sale, criterios «lista cuando…», comandos y enlaces al curso).
//   - Batch, LLM, streaming y edge: la comparación contra el C01 de content-w3.json (qué cambia, qué desaparece, qué aparece),
//     con los criterios de cada paso de fuentes/patterns-done.json (sacados de los casos C14, C11, C13 y C03).
//   - Asíncrono e híbrido (la hoja no los compara): fuentes/patterns-extra.json, sacado de los casos C04–C08 y M02.
//   - Los títulos de las secciones del curso: se cargan los archivos de ../ml-system-design/js/content en un vm.
// Uso: node tools/gen-templates.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHEET = join(ROOT, '..', 'cheat-sheets', 'sheets', 'recorrido', 'fuentes');
const COURSE = join(ROOT, '..', 'ml-system-design');
const OUT = join(ROOT, 'web', 'js', 'shared', 'templates.mjs');
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const warnings = [];

export const COURSE_URL = 'https://ronda-diseno-ml.vercel.app/';
export const SHEETS_URL = 'https://cheat-sheets-ml.vercel.app/';

// ---------------------------------------------------------------- curso: títulos de páginas y secciones
const ctx = vm.createContext({ console });
const load = (rel) => vm.runInContext(readFileSync(join(COURSE, rel), 'utf8'), ctx, { filename: rel });
load('js/core/registry.js');
const indexHtml = readFileSync(join(COURSE, 'index.html'), 'utf8');
for (const m of indexHtml.matchAll(/<script\s+src="js\/content\/([^"]+)"><\/script>/g)) load('js/content/' + m[1]);
const MSD = ctx.MSD;
const SPECIAL = { 'ref-herramientas': 'Herramientas', 'ref-comandos': 'Comandos', 'ref-numeros': 'Números' };

function courseLink(anchor) {
  const m = /^#([a-z0-9-]+)(?:\.([a-z0-9-]+))?$/.exec(anchor);
  if (!m) { warnings.push(`enlace al curso con formato raro: ${anchor}`); return null; }
  const page = MSD.getPage(m[1]);
  if (!page) { warnings.push(`el curso no tiene la página ${m[1]} (${anchor})`); return null; }
  const pageLabel = SPECIAL[m[1]] || `${m[1].toUpperCase()} · ${page.short || page.title}`;
  let label = `Curso · ${pageLabel}`;
  if (m[2]) {
    const sec = (page.sections || []).find((s) => s.id === m[2]);
    if (!sec) { warnings.push(`el curso no tiene la sección ${anchor}`); return null; }
    label += ` · ${sec.title}`;
  }
  return { label, href: COURSE_URL + anchor };
}

// ---------------------------------------------------------------- hojas
const SHEET_TITLE = {
  recorrido: 'Del dato a producción', triton: 'De PyTorch a Triton', gateway: 'El gateway', docker: 'Docker', git: 'Git y GitHub Actions',
  kubernetes: 'Kubernetes', prometheus: 'Prometheus y Grafana', estimaciones: 'Formulario de estimaciones', vllm: 'vLLM',
};
const sheet = (id, anchor, what) => ({ label: `Hoja · ${SHEET_TITLE[id]}${what ? ' · ' + what : ''}`, href: `${SHEETS_URL}${id}/${anchor ? '#' + anchor : ''}` });
// Las hojas temáticas que corresponden a cada estación del C01 (anclas que existen en cada hoja).
const STATION_SHEETS = {
  export: [sheet('triton', 'onnx', 'ONNX'), sheet('triton', 'paridad', 'paridad'), sheet('triton', 'tensorrt', 'TensorRT')],
  serving: [sheet('gateway', 'contrato', 'contrato'), sheet('triton', 'repositorio', 'model repository'), sheet('gateway', 'tests', 'tests')],
  empaquetado: [sheet('docker', 'anatomia', 'anatomía de un Dockerfile'), sheet('docker', 'compose', 'compose')],
  cicd: [sheet('git', 'workflow', 'workflows'), sheet('git', 'tests-ci', 'tests en CI'), sheet('docker', 'registries', 'registries')],
  kubernetes: [sheet('kubernetes', 'deployments', 'Deployments'), sheet('kubernetes', 'probes', 'probes'), sheet('kubernetes', 'autoscaling', 'autoscaling')],
  rollout: [sheet('kubernetes', 'rollouts', 'rollouts'), sheet('git', 'cd', 'CD')],
  request: [sheet('gateway', 'upstream', 'timeouts y reintentos'), sheet('gateway', 'backpressure', 'admisión'), sheet('estimaciones', 'latencia', 'latencia')],
  monitoreo: [sheet('prometheus', 'metricas', 'tipos de métrica'), sheet('prometheus', 'histogramas', 'histogramas'), sheet('prometheus', 'slos', 'SLOs')],
};
const PATTERN_SHEET = {
  sincrono: sheet('recorrido', 'mapa', 'mapa del C01'), batch: sheet('recorrido', 'pat-batch', 'patrón batch'), llm: sheet('recorrido', 'pat-llm', 'patrón LLM'),
  streaming: sheet('recorrido', 'pat-streaming', 'patrón streaming'), edge: sheet('recorrido', 'pat-edge', 'patrón edge'),
  asincrono: sheet('recorrido', 'casos-asincrono', 'casos asíncronos'), hibrido: sheet('recorrido', 'casos-hibrido', 'casos híbridos'),
};

// ---------------------------------------------------------------- texto plano
const plain = (s) => String(s || '')
  .replace(/<code>([\s\S]*?)<\/code>/g, '`$1`')
  .replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- estaciones del C01
const TRAMO = { datos: 'datos', versionado: 'datos', entrenamiento: 'modelo', gate: 'modelo', export: 'modelo', serving: 'release', empaquetado: 'release', cicd: 'release', kubernetes: 'operacion', rollout: 'operacion', request: 'operacion', monitoreo: 'operacion' };
const SPEED = { datos: 'semanas', versionado: 'semanas', entrenamiento: 'semanas', gate: 'semanas', export: 'semanas', serving: 'dias', empaquetado: 'dias', cicd: 'dias', kubernetes: 'dias', rollout: 'dias', request: 'ms', monitoreo: 'continuo' };
const w1 = json(join(SHEET, 'content-w1.json'));
const w2 = json(join(SHEET, 'content-w2.json'));
const w3 = json(join(SHEET, 'content-w3.json'));
const raw = [...w1.stations, ...w2.stations].sort((a, b) => a.num - b.num);
if (raw.length !== 12) throw new Error('se esperaban 12 estaciones');

const linksFor = (anchors, extra = []) => {
  const seen = new Set();
  return [...anchors.map(courseLink).filter(Boolean), ...extra].filter((l) => (seen.has(l.href) ? false : seen.add(l.href)));
};

const STATIONS = raw.map((s) => ({
  id: s.id, num: s.num, title: s.title, tramo: TRAMO[s.id], speed: SPEED[s.id],
  question: plain(s.question), note: plain(s.summary), artifact: plain(s.out[0]),
  done: s.done.map(plain),
  commands: s.commands.map((c) => ({ code: c.code, note: plain(c.note) })),
  links: linksFor(s.links, [sheet('recorrido', `est-${s.id}`, `estación ${s.num}`), ...(STATION_SHEETS[s.id] || [])]),
}));
const byId = Object.fromEntries(STATIONS.map((s) => [s.id, s]));

// ---------------------------------------------------------------- patrones
const NAMES = {
  sincrono: 'Online síncrono', batch: 'Batch', asincrono: 'Asíncrono con colas', llm: 'LLMs y RAG',
  hibrido: 'Híbridos', streaming: 'Streaming', edge: 'Edge y on-device',
};
const CASE_PAGES = MSD.courseOrder().map((id) => MSD.getPage(id)).filter((pg) => pg && pg.kind === 'case');
const casesOf = (pattern) => CASE_PAGES.filter((c) => c.pattern === pattern).map((c) => c.id);

const PATTERNS = {
  sincrono: {
    name: NAMES.sincrono, case: 'c01', cases: casesOf('sincrono'),
    summary: 'Alguien espera la respuesta en milisegundos: load balancer, gateway en CPU y model server en GPU, con timeouts y fallback. Es el C01 completo: sus 12 estaciones, del dato al monitoreo.',
    removed: [], links: linksFor(['#c01.arquitectura', '#m02.online-sincrona'].filter(Boolean), [PATTERN_SHEET.sincrono]),
  },
};
const STEPS = {
  sincrono: STATIONS.map((s) => ({ id: s.id, base: s.id, status: 'igual', title: s.title, tramo: s.tramo, speed: s.speed, question: s.question, note: s.note, artifact: s.artifact, done: s.done, commands: s.commands, links: s.links })),
};

const done4 = existsSync(join(ROOT, 'fuentes', 'patterns-done.json')) ? json(join(ROOT, 'fuentes', 'patterns-done.json')).patterns : {};
const extra = existsSync(join(ROOT, 'fuentes', 'patterns-extra.json')) ? json(join(ROOT, 'fuentes', 'patterns-extra.json')).patterns : {};

const kebab = (s) => plain(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).replace(/-$/, '');

// Un paso de un patrón: si viene de una estación del C01 hereda su pregunta y sus comandos solo cuando no cambia.
function patternStep(p, s) {
  const base = s.base && byId[s.base] ? byId[s.base] : null;
  const status = s.status === 'nuevo' || !base ? 'nuevo' : s.status;
  const links = linksFor(s.links || [], base ? [sheet('recorrido', `est-${base.id}`, `estación ${base.num} del C01`)] : [PATTERN_SHEET[p]]);
  return {
    id: s.id, base: base ? base.id : null, status,
    title: plain(s.title) || (base && base.title), tramo: s.tramo || (base && base.tramo) || 'release',
    speed: status === 'nuevo' ? 'nuevo' : s.speed || (base && base.speed),
    question: status === 'igual' && base ? base.question : '',
    note: plain(s.note), artifact: status === 'igual' && base ? base.artifact : '',
    done: (s.done || []).map(plain).filter(Boolean),
    commands: status === 'igual' && base ? base.commands : [],
    links,
  };
}

for (const pat of w3.patterns) {
  const p = pat.id;
  const d = done4[p];
  PATTERNS[p] = {
    name: NAMES[p], case: pat.case, cases: casesOf(p), summary: plain(pat.summary), speeds: plain(pat.speeds),
    removed: pat.changes.filter((c) => c.status === 'desaparece').map((c) => ({ id: c.station, why: plain(c.note) })),
    links: linksFor(pat.links || [], [PATTERN_SHEET[p]]),
  };
  if (d && Array.isArray(d.steps)) {
    STEPS[p] = d.steps.map((s) => patternStep(p, s));
  } else {
    // Sin el archivo de criterios: el orden y las notas de la hoja, sin criterios.
    warnings.push(`${p}: falta fuentes/patterns-done.json, los pasos van sin criterios`);
    const out = [];
    for (const st of STATIONS) {
      const c = pat.changes.find((x) => x.station === st.id);
      if (c && c.status !== 'desaparece') out.push(patternStep(p, { id: st.id, base: st.id, status: c.status, note: c.note, tramo: st.tramo, speed: st.speed, links: [] }));
      for (const n of pat.new.filter((x) => x.after === st.id)) out.push(patternStep(p, { id: kebab(n.title), base: null, status: 'nuevo', title: n.title, note: n.note, tramo: st.tramo, links: [] }));
    }
    STEPS[p] = out;
  }
}
for (const p of ['asincrono', 'hibrido']) {
  const e = extra[p];
  if (!e) { warnings.push(`${p}: falta fuentes/patterns-extra.json; el patrón queda sin plantilla`); continue; }
  PATTERNS[p] = {
    name: NAMES[p], case: e.case, cases: e.cases || casesOf(p), summary: plain(e.summary),
    removed: (e.removed || []).map((r) => ({ id: r.id, why: plain(r.why) })),
    links: linksFor(e.links || [`#${e.case}.arquitectura`], [PATTERN_SHEET[p]]),
  };
  STEPS[p] = e.steps.map((s) => patternStep(p, s));
}

// Comprobaciones: ids únicos y válidos, tramos y velocidades conocidos.
for (const [p, steps] of Object.entries(STEPS)) {
  const ids = new Set();
  for (const s of steps) {
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(s.id)) throw new Error(`${p}: id inválido ${s.id}`);
    if (ids.has(s.id)) throw new Error(`${p}: id repetido ${s.id}`);
    ids.add(s.id);
    if (!['diseno', 'datos', 'modelo', 'release', 'operacion'].includes(s.tramo)) throw new Error(`${p}/${s.id}: tramo ${s.tramo}`);
    if (!['semanas', 'dias', 'ms', 'continuo', 'nuevo'].includes(s.speed)) throw new Error(`${p}/${s.id}: speed ${s.speed}`);
    if (!s.done.length) warnings.push(`${p}/${s.id}: sin criterios de hecho`);
  }
}

const ORDER = ['sincrono', 'batch', 'asincrono', 'llm', 'hibrido', 'streaming', 'edge'];

// ---------------------------------------------------------------- modo producción (v2): inglés, kickoff y cálculos
// fuentes/text-en.json: títulos, scope, inputs/outputs y Definition of Done en inglés (misma cantidad y orden que el español).
// fuentes/calcs-*.json: variables y cálculos del entry gate por patrón, sacados del curso; `expected` es el valor que da
// el curso y aquí se vuelve a calcular con el motor de la app (web/js/shared/calc.mjs).
const { parse, evaluate, varsOf } = await import(join(ROOT, 'web', 'js', 'shared', 'calc.mjs'));
const EN = existsSync(join(ROOT, 'fuentes', 'text-en.json')) ? json(join(ROOT, 'fuentes', 'text-en.json')).patterns : {};
const CALCS = {};
for (const f of ['calcs-sincrono.json', 'calcs-batch-asincrono-llm.json', 'calcs-hibrido-streaming-edge.json']) {
  if (existsSync(join(ROOT, 'fuentes', f))) Object.assign(CALCS, json(join(ROOT, 'fuentes', f)).patterns);
  else warnings.push(`falta fuentes/${f}`);
}
const enLink = (l) => ({ ...l, label: l.label.replace(/^Curso · /, 'Course · ').replace(/^Hoja · /, 'Sheet · ') });
const EXPECTED = {};
const LEGACY = {};
const STEPS_EN = {};
const VARS = {};
for (const p of ORDER) {
  if (!STEPS[p]) continue;
  const en = EN[p] || { steps: {} };
  const cs = CALCS[p] || { vars: [], steps: {} };
  if (!EN[p]) warnings.push(`${p}: sin textos en inglés`);
  LEGACY[p] = Object.fromEntries(STEPS[p].map((s) => [s.id, { title: s.title, note: s.note, question: s.question, done: s.done, commandNotes: s.commands.map((c) => c.note) }]));
  const SRC = existsSync(join(ROOT, 'fuentes', 'var-sources-en.json')) ? json(join(ROOT, 'fuentes', 'var-sources-en.json'))[p] || {} : {};
  VARS[p] = (cs.vars || []).map((v) => ({ id: v.id, label: v.label, unit: v.unit || '', kind: v.kind, source: SRC[v.id] || v.source || '', ref: String(v.default ?? '') }));
  const env = Object.fromEntries((cs.vars || []).map((v) => [v.id, Number(v.default)]));
  const calcOf = (id) => (cs.steps && cs.steps[id] ? cs.steps[id] : []).map((c) => {
    let val;
    try {
      const ast = parse(c.expr);
      for (const n of varsOf(ast)) if (!(n in env)) warnings.push(`${p}/${id}/${c.id}: usa «${n}», que no está definida antes`);
      val = evaluate(ast, env);
      if (c.out) env[c.out] = val;
      if (typeof c.expected === 'number') {
        const t = c.tol > 0 ? c.tol : Math.abs(c.expected - Math.round(c.expected)) < 1e-9 ? 0 : 0.01;
        const ok = t === 0 ? Math.abs(val - c.expected) < 1e-9 : Math.abs(val - c.expected) <= t * Math.max(Math.abs(c.expected), 1e-12);
        if (!ok) warnings.push(`${p}/${id}/${c.id}: el motor da ${val}, el curso dice ${c.expected}`);
      }
      if (c.check && c.check.expr && !evaluate(parse(c.check.expr), env)) warnings.push(`${p}/${id}/${c.id}: el check «${c.check.label}» falla con los valores del curso`);
    } catch (e) { warnings.push(`${p}/${id}/${c.id}: ${e.message}`); }
    EXPECTED[`${p}/${id}/${c.id}`] = val;
    return { id: c.id, label: c.label, out: c.out || '', expr: c.expr, unit: c.unit || '', tol: typeof c.tol === 'number' ? c.tol : 0.02, why: c.why || '', check: c.check && c.check.expr ? { expr: c.check.expr, label: c.check.label || '' } : null, ref: c.ref || '' };
  });
  const K = en.steps.kickoff || {};
  const kickoff = {
    id: 'kickoff', base: 'kickoff', status: 'nuevo', title: K.title || 'Requirements & Capacity Plan', tramo: 'diseno', speed: 'diseno',
    question: '', note: K.scope || '', artifact: '', inputs: K.inputs || [], outputs: K.outputs || [], done: K.dod || [], commands: [],
    links: linksFor([`#${PATTERNS[p].case}.requisitos`, `#${PATTERNS[p].case}.estimaciones`].filter((a) => { const pg = MSD.getPage(a.slice(1).split('.')[0]); return pg && (pg.sections || []).some((x) => x.id === a.split('.')[1]); }), [sheet('estimaciones', '', 'C01 sizing chain')]).map(enLink),
    calcs: calcOf('kickoff'),
  };
  STEPS_EN[p] = [kickoff, ...STEPS[p].map((s) => {
    const e = en.steps[s.id] || {};
    if (!en.steps[s.id]) warnings.push(`${p}/${s.id}: sin texto en inglés`);
    const done = e.dod && e.dod.length === s.done.length ? e.dod : (e.dod && warnings.push(`${p}/${s.id}: dod en inglés con otra cantidad`), s.done);
    const notes = e.commandNotes && e.commandNotes.length === s.commands.length ? e.commandNotes : s.commands.map((c) => c.note);
    return {
      ...s, title: e.title || s.title, note: e.scope || s.note, question: '', inputs: e.inputs || [], outputs: e.outputs || [],
      done, commands: s.commands.map((c, i) => ({ code: c.code, note: notes[i] })), links: s.links.map(enLink), calcs: calcOf(s.id),
    };
  })];
  for (const id of Object.keys(cs.steps || {})) if (!STEPS_EN[p].some((s) => s.id === id)) warnings.push(`${p}: hay cálculos para «${id}», que no es un paso del patrón`);
  if (EN[p]) {
    PATTERNS[p].name = EN[p].name || PATTERNS[p].name;
    PATTERNS[p].summary = EN[p].summary || PATTERNS[p].summary;
    PATTERNS[p].removed = PATTERNS[p].removed.map((r) => ({ ...r, why: ((EN[p].removed || []).find((x) => x.id === r.id) || r).why }));
  }
  PATTERNS[p].links = PATTERNS[p].links.map(enLink);
}
for (const st of STATIONS) {
  const e = (EN.sincrono && EN.sincrono.steps[st.id]) || {};
  st.title = e.title || st.title; st.note = e.scope || st.note; st.question = ''; st.links = st.links.map(enLink);
}

const data = { COURSE_URL, SHEETS_URL, ORDER: ORDER.filter((p) => PATTERNS[p]), PATTERNS, STATIONS, STEPS: STEPS_EN, VARS };
writeFileSync(OUT, `/* GENERADO por tools/gen-templates.mjs: no lo edites a mano. Fuentes: el curso (Ronda de Diseño ML) y la hoja «Del dato a producción». */
export const T = ${JSON.stringify(data, null, 1)};
`);
// Los textos en español de la versión 1, para que la migración reemplace solo lo que nadie editó.
writeFileSync(join(ROOT, 'web', 'js', 'shared', 'legacy-es.mjs'), `/* GENERADO por tools/gen-templates.mjs: los textos de plantilla de la versión 1 (en español), por patrón y paso.
   migrate.mjs los compara con el proyecto: si un texto sigue igual, lo cambia por el de producción en inglés. */
export const LEGACY = ${JSON.stringify(LEGACY)};
`);
writeFileSync(join(ROOT, 'tests', 'calc-expected.json'), JSON.stringify(EXPECTED, null, 1));
console.log(`[templates] ${OUT.replace(ROOT + '/', '')}: ${Object.entries(STEPS_EN).map(([p, s]) => `${p} ${s.length} pasos/${s.reduce((n, x) => n + x.calcs.length, 0)} cálculos/${VARS[p].length} variables`).join(' · ')}`);
for (const w of warnings) console.log('  aviso: ' + w);
