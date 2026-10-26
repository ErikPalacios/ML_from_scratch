/* v1 → v2 (production mode). Runs on the server when a project is read and in the browser on cached copies.
   - Adds `vars`, per-step `calcs`, `gate`, `inputs` and `outputs` from the pattern's template, and the `kickoff` step.
   - Template texts that nobody edited (title, scope, question, DoD, runbook notes) switch to the English production
     text; anything you wrote stays as it is.
   - The C01 seed gets its own pass (seed-c01.mjs → upgradeSeedC01) so its preloaded state reads in English too. */
import { SCHEMA_VERSION, fillCalc } from './model.mjs';
import { T } from './templates.mjs';
import { LEGACY } from './legacy-es.mjs';
import { stepFromTemplate, templateVars } from './factory.mjs';
import { upgradeSeedC01 } from './seed-c01.mjs';

const clone = (x) => JSON.parse(JSON.stringify(x));

export function migrate(doc) {
  if (!doc || doc.v >= SCHEMA_VERSION) return doc;
  const d = clone(doc);
  const tpl = T.STEPS[d.pattern] || [];
  const legacy = LEGACY[d.pattern] || {};
  if (!Array.isArray(d.vars)) d.vars = templateVars(d.pattern);
  for (const s of d.steps) {
    const key = s.base || s.id;
    const t = tpl.find((x) => x.id === key);
    const old = legacy[key];
    s.inputs = s.inputs || (t ? [...(t.inputs || [])] : []);
    s.outputs = s.outputs || (t ? [...(t.outputs || [])] : []);
    s.calcs = (s.calcs || (t ? t.calcs.map((c) => ({ ...c, answer: '', revealed: false, note: '' })) : [])).map(fillCalc);
    s.gate = s.gate || { waived: false, reason: '', at: '' };
    if (t && old) {
      if (s.title === old.title) s.title = t.title;
      if (s.note === old.note) s.note = t.note;
      if (s.question === old.question) s.question = t.question || '';
      s.done.forEach((c) => {
        const i = old.done.indexOf(c.text);
        if (i >= 0 && t.done[i]) c.text = t.done[i];
      });
      s.commands.forEach((c) => {
        const i = old.commandNotes.indexOf(c.note);
        if (i >= 0 && t.commands[i]) c.note = t.commands[i].note;
      });
      s.links.forEach((l) => { l.label = l.label.replace(/^Curso · /, 'Course · ').replace(/^Hoja · /, 'Sheet · '); });
    }
  }
  const kick = tpl.find((x) => x.id === 'kickoff');
  if (kick && !d.steps.some((s) => s.id === 'kickoff')) d.steps.unshift(stepFromTemplate(kick));
  d.v = SCHEMA_VERSION;
  return upgradeSeedC01(d);
}
