/* Crear proyectos y pasos a partir de las plantillas del curso (templates.mjs). */
import { emptyProject, emptyStep, newId } from './model.mjs';
import { T } from './templates.mjs';

// Un paso de plantilla → un paso del proyecto, con sus criterios, comandos y enlaces listos para marcar.
export function stepFromTemplate(t, idOverride) {
  return emptyStep({
    id: idOverride || t.id,
    base: t.id,
    title: t.title,
    tramo: t.tramo,
    speed: t.speed,
    question: t.question || '',
    note: t.note || '',
    done: (t.done || []).map((text, i) => ({ id: `c${i + 1}`, text, ok: false })),
    commands: (t.commands || []).map((c, i) => ({ id: `k${i + 1}`, code: c.code, note: c.note || '' })),
    links: (t.links || []).map((l, i) => ({ id: `l${i + 1}`, label: l.label, href: l.href })),
  });
}

export const templateSteps = (pattern) => T.STEPS[pattern] || [];

export function projectFromTemplate({ id, name, pattern, repo = '', goal = '' }) {
  const p = emptyProject({ id, name, pattern, steps: templateSteps(pattern).map((t) => stepFromTemplate(t)) });
  p.repo = repo;
  p.goal = goal;
  p.resume.nextStepId = p.steps[0] ? p.steps[0].id : null;
  return p;
}

// Lo que se puede agregar a un proyecto: los pasos de su patrón que no tiene, las 12 estaciones del C01
// y los pasos propios de los demás patrones. El id cambia si ya existe uno igual.
export function addableSteps(project) {
  const have = new Set(project.steps.map((s) => s.base || s.id));
  const groups = [];
  const own = templateSteps(project.pattern).filter((t) => !have.has(t.id));
  if (own.length) groups.push({ label: `Del patrón ${T.PATTERNS[project.pattern].name}`, items: own });
  const c01 = T.STEPS.sincrono.filter((t) => !have.has(t.id) && !own.some((o) => o.id === t.id));
  if (c01.length) groups.push({ label: 'Estaciones del C01', items: c01 });
  for (const p of T.ORDER) {
    if (p === project.pattern) continue;
    const items = T.STEPS[p].filter((t) => t.status === 'nuevo' && !have.has(t.id));
    if (items.length) groups.push({ label: `Pasos propios de ${T.PATTERNS[p].name}`, items });
  }
  return groups;
}

export function uniqueStepId(project, wanted) {
  const ids = new Set(project.steps.map((s) => s.id));
  if (!ids.has(wanted)) return wanted;
  for (let i = 2; i < 100; i++) { const c = `${wanted.slice(0, 36)}-${i}`; if (!ids.has(c)) return c; }
  return newId('p');
}

// id de proyecto a partir del nombre: «C01 · API de clasificación» → «c01-api-de-clasificacion».
export function slugify(s) {
  const out = String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return out || newId('proy');
}
