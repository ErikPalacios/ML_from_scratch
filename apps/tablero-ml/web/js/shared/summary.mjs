/* «Resume brief»: a markdown status report to paste at the start of a Claude Code session.
   The board (button) and the API (GET /api/claude/<id>) build the same text, so Claude Code reads what you see.
   Calc values only appear when the engineer matched or revealed them: the brief never leaks an answer. */
import { STATUS_LABEL, TRAMO_LABEL, daysSince, progress, localDate } from './model.mjs';
import { evaluateProject, fmtNum } from './calc.mjs';
import { T } from './templates.mjs';

const PASS = { pendiente: '○', en_curso: '◐', hecho: '✓' };
const one = (s) => String(s || '').replace(/\s*\n\s*/g, ' ').trim();
const cell = (s) => one(s).replace(/\|/g, '\\|');

export function daysLabel(n) {
  if (n === null) return 'no date';
  if (n === 0) return 'today';
  if (n === 1) return '1 day ago';
  return `${n} days ago`;
}

const CALC_STATE = { ok: 'matched', revealed: 'revealed', wrong: 'wrong', todo: 'to do', blocked: 'blocked', error: 'formula error' };

export function gateText(g) {
  if (!g || !g.need) return '—';
  if (g.met) return `met ${g.done + g.revealed}/${g.need}`;
  if (g.waived) return `waived (${g.done + g.revealed}/${g.need})`;
  return `open ${g.done + g.revealed}/${g.need}${g.failedChecks ? `, ${g.failedChecks} check ✗` : ''}`;
}

function calcLines(s, ev) {
  return (s.calcs || []).map((c) => {
    const r = ev.calcs[`${s.id}/${c.id}`] || {};
    const shown = r.status === 'ok' || r.status === 'revealed' ? ` = ${fmtNum(r.value)} ${c.unit}`.trimEnd() : '';
    const need = r.status === 'blocked' ? ` (needs \`${r.missing.join(', ')}\`)` : '';
    const done = r.status === 'ok' || r.status === 'revealed';
    const chk = r.check ? ` · check «${one(r.check.label)}»${done ? `: ${r.check.ok ? 'pass' : 'FAIL'}` : ''}` : '';
    return `- [${r.status === 'ok' || r.status === 'revealed' ? 'x' : ' '}] ${one(c.label)} (\`${c.id}\`)${shown} — ${CALC_STATE[r.status] || r.status}${need}${chk}`;
  });
}

function stepBlock(s, i, ev, lines) {
  const g = ev.gates[s.id];
  lines.push(`### ${i + 1}. ${s.title} — ${STATUS_LABEL[s.status]}${s.reason ? ` (${one(s.reason)})` : ''}`);
  if (s.note) lines.push('', `Scope: ${one(s.note)}`);
  if (s.calcs && s.calcs.length) {
    lines.push('', `Entry gate: ${gateText(g)}${s.gate && s.gate.waived ? ` — waiver: ${one(s.gate.reason)}` : ''}`, ...calcLines(s, ev));
  }
  if (s.hitos.length) lines.push('', 'Milestones:', ...s.hitos.map((h) => `- [${h.status === 'hecho' ? 'x' : ' '}] ${one(h.text)} — ${STATUS_LABEL[h.status]}${h.done ? `. Done when: ${one(h.done)}` : ''}`));
  const open = s.done.filter((d) => !d.ok);
  if (s.done.length) lines.push('', `Definition of Done (${s.done.length - open.length}/${s.done.length}):`, ...s.done.map((d) => `- [${d.ok ? 'x' : ' '}] ${one(d.text)}`));
  if (s.results.length) lines.push('', 'Measurements:', ...s.results.map((r) => `- ${one(r.name)}: ${one(r.value)}${r.unit ? ' ' + one(r.unit) : ''}${r.date ? ` (${r.date})` : ''}${r.note ? ` — ${one(r.note)}` : ''}`));
  if (s.commands.length) lines.push('', 'Runbook:', ...s.commands.map((c) => `- \`${one(c.code)}\`${c.note ? ` — ${one(c.note)}` : ''}`));
  if (s.files.length) lines.push('', 'Artifacts:', ...s.files.map((f) => `- ${one(f.path)}${f.ref ? ` (${one(f.ref)})` : ''}`));
  if (s.notes.trim()) lines.push('', 'Notes:', '', s.notes.trim());
  lines.push('');
}

export function buildSummary(p, { now = Date.now(), sessions = 3, decisions = 5, tz } = {}) {
  const pat = T.PATTERNS[p.pattern];
  const pr = progress(p);
  const ev = evaluateProject(p);
  const days = daysSince(p.lastActivity, now, tz);
  const gates = p.steps.filter((s) => s.status !== 'no_aplica' && s.calcs && s.calcs.length);
  const revealed = p.steps.reduce((n, s) => n + (s.calcs || []).filter((c) => c.revealed).length, 0);
  const L = [];
  L.push(`# Resume brief: ${p.name}`, '');
  L.push(`- **Pattern:** ${pat ? pat.name : p.pattern}${pat && pat.case ? ` (reference: ${pat.case.toUpperCase()})` : ''}`);
  if (p.repo) L.push(`- **Repo:** \`${p.repo}\``);
  if (p.goal) L.push(`- **Goal:** ${one(p.goal)}`);
  L.push(`- **Current pass:** ${p.vueltaActual === 2 ? '2 (solo, no reference code)' : '1 (guided)'}`);
  L.push(`- **Last activity:** ${localDate(new Date(p.lastActivity), tz)} (${daysLabel(days)})`);
  L.push(`- **Progress:** ${pr.hecho}/${pr.total} steps done, ${pr.enCurso} in progress, ${pr.bloqueado} blocked${pr.noAplica ? `, ${pr.noAplica} N/A` : ''} · pass 1: ${pr.v1}/${pr.total} · pass 2: ${pr.v2}/${pr.total}`);
  L.push(`- **Entry gates:** ${gates.filter((s) => ev.gates[s.id].met).length}/${gates.length} met, ${gates.filter((s) => ev.gates[s.id].waived && !ev.gates[s.id].met).length} waived · ${revealed} answer(s) revealed`);
  L.push('');
  L.push('## Where I left off', '', p.resume.where.trim() || '_(empty)_', '');
  const nextStep = p.steps.find((s) => s.id === p.resume.nextStepId);
  L.push('## Next action', '', (p.resume.next.trim() || '_(empty)_') + (nextStep ? `\n\nOn the map: **${nextStep.title}** (\`${nextStep.id}\`), entry gate ${gateText(ev.gates[nextStep.id])}.` : ''), '');
  const blocked = p.steps.filter((s) => s.status === 'bloqueado');
  L.push('## Open blockers', '');
  L.push(...(blocked.length ? blocked.map((s) => `- **${s.title}:** ${one(s.reason) || 'no reason given'}`) : ['- None.']), '');

  L.push('## Map', '', '| # | Step | Stage | Status | Entry gate | P1 | P2 | Milestones | DoD |', '|---|---|---|---|---|---|---|---|---|');
  p.steps.forEach((s, i) => {
    const hit = s.hitos.length ? `${s.hitos.filter((h) => h.status === 'hecho').length}/${s.hitos.length}` : '—';
    const crit = s.done.length ? `${s.done.filter((d) => d.ok).length}/${s.done.length}` : '—';
    const st = STATUS_LABEL[s.status] + (s.status === 'no_aplica' || s.status === 'bloqueado' ? `: ${cell(s.reason)}` : '');
    L.push(`| ${i + 1} | ${cell(s.title)} (\`${s.id}\`) | ${TRAMO_LABEL[s.tramo]} | ${st} | ${s.status === 'no_aplica' ? '—' : gateText(ev.gates[s.id])} | ${PASS[s.vuelta.v1]} | ${PASS[s.vuelta.v2]} | ${hit} | ${crit} |`);
  });
  L.push('', 'Passes: ✓ done · ◐ in progress · ○ to do.', '');

  const filled = (p.vars || []).filter((v) => String(v.value).trim());
  if ((p.vars || []).length) {
    const unset = p.vars.filter((v) => !String(v.value).trim());
    L.push('## Sizing inputs', '', `${filled.length}/${p.vars.length} set. The full sheet is in \`GET /api/claude/${p.id}.json\` (\`vars\`).`, '');
    if (unset.length) { L.push('Unset (calcs that read them are blocked):'); for (const v of unset) L.push(`- \`${v.id}\` ${one(v.label)} (${v.unit || '—'}, ${v.kind})${v.ref ? ` · reference ${v.ref}` : ''}`); L.push(''); }
  }

  const active = p.steps.filter((s) => s.status === 'en_curso' || s.status === 'bloqueado' || s.id === p.resume.nextStepId);
  if (active.length) {
    L.push('## Active steps', '');
    active.forEach((s) => stepBlock(s, p.steps.indexOf(s), ev, L));
  }

  const ses = [...p.sessions].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, sessions);
  if (ses.length) {
    L.push('## Recent work log', '');
    for (const s of ses) {
      L.push(`### ${s.date}${s.source === 'claude' ? ' (Claude Code)' : ''}`);
      if (s.did) L.push(`- **Did:** ${one(s.did)}`);
      if (s.measured) L.push(`- **Measured:** ${one(s.measured)}`);
      if (s.next) L.push(`- **Next:** ${one(s.next)}`);
      L.push('');
    }
  }
  const dec = p.decisions.filter((d) => d.status === 'vigente').sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, decisions);
  if (dec.length) {
    L.push('## Decisions in force (latest)', '');
    for (const d of dec) L.push(`- **${one(d.what)}**${d.against ? ` over ${one(d.against)}` : ''}: ${one(d.why)} (${d.date})`);
    L.push('');
  }
  L.push('---', `Generated by the board on ${localDate(new Date(now), tz)}. Revision ${p.rev}.`);
  return L.join('\n');
}
