/* «Resumen para retomar»: un markdown con el estado del proyecto para pegarlo al empezar una sesión con Claude Code.
   Lo arma igual la web (botón) y la API (GET /api/claude/<id>), así Claude Code lee lo mismo que tú. */
import { STATUS_LABEL, TRAMO_LABEL, daysSince, progress, localDate } from './model.mjs';
import { T } from './templates.mjs';

const VUELTA = { pendiente: '○', en_curso: '◐', hecho: '✓' };
const one = (s) => String(s || '').replace(/\s*\n\s*/g, ' ').trim();
const cell = (s) => one(s).replace(/\|/g, '\\|');

export function daysLabel(n) {
  if (n === null) return 'sin fecha';
  if (n === 0) return 'hoy';
  if (n === 1) return 'hace 1 día';
  return `hace ${n} días`;
}

function stepBlock(s, i, lines) {
  lines.push(`### ${i + 1}. ${s.title} — ${STATUS_LABEL[s.status]}${s.reason ? ` (${one(s.reason)})` : ''}`);
  if (s.hitos.length) lines.push('', 'Hitos:', ...s.hitos.map((h) => `- [${h.status === 'hecho' ? 'x' : ' '}] ${one(h.text)} — ${STATUS_LABEL[h.status]}${h.done ? `. Hecho cuando: ${one(h.done)}` : ''}`));
  const open = s.done.filter((d) => !d.ok);
  if (s.done.length) lines.push('', `Criterios de hecho (${s.done.length - open.length}/${s.done.length}):`, ...s.done.map((d) => `- [${d.ok ? 'x' : ' '}] ${one(d.text)}`));
  if (s.results.length) lines.push('', 'Resultados medidos:', ...s.results.map((r) => `- ${one(r.name)}: ${one(r.value)}${r.unit ? ' ' + one(r.unit) : ''}${r.date ? ` (${r.date})` : ''}${r.note ? ` — ${one(r.note)}` : ''}`));
  if (s.commands.length) lines.push('', 'Comandos para verificar:', ...s.commands.map((c) => `- \`${one(c.code)}\`${c.note ? ` — ${one(c.note)}` : ''}`));
  if (s.files.length) lines.push('', 'Archivos y commits:', ...s.files.map((f) => `- ${one(f.path)}${f.ref ? ` (${one(f.ref)})` : ''}`));
  if (s.notes.trim()) lines.push('', 'Notas:', '', s.notes.trim());
  lines.push('');
}

export function buildSummary(p, { now = Date.now(), sessions = 3, decisions = 5, tz } = {}) {
  const pat = T.PATTERNS[p.pattern];
  const pr = progress(p);
  const days = daysSince(p.lastActivity, now, tz);
  const L = [];
  L.push(`# Retomar: ${p.name}`, '');
  L.push(`- **Patrón:** ${pat ? pat.name : p.pattern}${pat && pat.case ? ` (como el ${pat.case.toUpperCase()} del curso)` : ''}`);
  if (p.repo) L.push(`- **Repo:** \`${p.repo}\``);
  if (p.goal) L.push(`- **Meta:** ${one(p.goal)}`);
  L.push(`- **Vuelta actual:** ${p.vueltaActual === 2 ? '2 (solo, sin mirar el código)' : '1 (guiada: el mentor da el código explicado)'}`);
  L.push(`- **Última actividad:** ${localDate(new Date(p.lastActivity), tz)} (${daysLabel(days)})`);
  L.push(`- **Avance:** ${pr.hecho}/${pr.total} pasos hechos, ${pr.enCurso} en curso, ${pr.bloqueado} bloqueados${pr.noAplica ? `, ${pr.noAplica} no aplican` : ''} · vuelta 1: ${pr.v1}/${pr.total} · vuelta 2: ${pr.v2}/${pr.total}`);
  L.push('');
  L.push('## Dónde me quedé', '', p.resume.where.trim() || '_(sin escribir)_', '');
  const nextStep = p.steps.find((s) => s.id === p.resume.nextStepId);
  L.push('## Próximo paso concreto', '', (p.resume.next.trim() || '_(sin escribir)_') + (nextStep ? `\n\nPaso del mapa: **${nextStep.title}** (\`${nextStep.id}\`).` : ''), '');
  const blocked = p.steps.filter((s) => s.status === 'bloqueado');
  L.push('## Bloqueos abiertos', '');
  L.push(...(blocked.length ? blocked.map((s) => `- **${s.title}:** ${one(s.reason) || 'sin razón escrita'}`) : ['- Ninguno.']), '');

  L.push('## Mapa', '', '| # | Paso | Tramo | Estado | Vuelta 1 | Vuelta 2 | Hitos | Criterios |', '|---|---|---|---|---|---|---|---|');
  p.steps.forEach((s, i) => {
    const hit = s.hitos.length ? `${s.hitos.filter((h) => h.status === 'hecho').length}/${s.hitos.length}` : '—';
    const crit = s.done.length ? `${s.done.filter((d) => d.ok).length}/${s.done.length}` : '—';
    const st = STATUS_LABEL[s.status] + (s.status === 'no_aplica' || s.status === 'bloqueado' ? `: ${cell(s.reason)}` : '');
    L.push(`| ${i + 1} | ${cell(s.title)} (\`${s.id}\`) | ${TRAMO_LABEL[s.tramo]} | ${st} | ${VUELTA[s.vuelta.v1]} | ${VUELTA[s.vuelta.v2]} | ${hit} | ${crit} |`);
  });
  L.push('', 'Vueltas: ✓ hecha · ◐ en curso · ○ pendiente.', '');

  const active = p.steps.filter((s) => s.status === 'en_curso' || s.status === 'bloqueado' || s.id === p.resume.nextStepId);
  if (active.length) {
    L.push('## Pasos activos (detalle)', '');
    active.forEach((s) => stepBlock(s, p.steps.indexOf(s), L));
  }

  const ses = [...p.sessions].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, sessions);
  if (ses.length) {
    L.push('## Últimas sesiones', '');
    for (const s of ses) {
      L.push(`### ${s.date}${s.source === 'claude' ? ' (Claude Code)' : ''}`);
      if (s.did) L.push(`- **Hice:** ${one(s.did)}`);
      if (s.measured) L.push(`- **Medí:** ${one(s.measured)}`);
      if (s.next) L.push(`- **Sigue:** ${one(s.next)}`);
      L.push('');
    }
  }
  const dec = p.decisions.filter((d) => d.status === 'vigente').sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, decisions);
  if (dec.length) {
    L.push('## Decisiones vigentes (las más recientes)', '');
    for (const d of dec) L.push(`- **${one(d.what)}**${d.against ? ` en vez de ${one(d.against)}` : ''}: ${one(d.why)} (${d.date})`);
    L.push('');
  }
  L.push('---', `Generado por el tablero el ${localDate(new Date(now), tz)}. Revisión ${p.rev}.`);
  return L.join('\n');
}
