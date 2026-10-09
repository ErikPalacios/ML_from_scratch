# Ronda de Diseño ML — build specification (internal contract)

Single source of truth for every agent building this app. Read it fully before writing anything.
If something is ambiguous, choose the option that keeps modules decoupled and leave a short code
comment explaining the choice. Do NOT edit files owned by another agent (see §2); if you need a
change in someone else's file, note it in your final report.

## 0. Goal (from the user, translated/condensed)

The user is a mechatronics engineer with a master's degree, strong in ML/DL theory and computer
vision (classification, detection, segmentation), uses PyTorch, but **has never taken a model to
production**. Goal: pass **ML Engineer** interviews (not research, not data science) where they are
asked to **design an end-to-end ML system**. They want an interactive **study app** (single
self-contained HTML page) that is a **course + interview simulator**, written by a *Staff ML
Engineer who has also been an ML System Design interviewer*. **Do not explain models themselves;
explain in depth all the engineering around them.**

The full app has four parts:
- **Parte 1 — Fundamentos**: 15 modules (m01…m15).
- **Parte 2 — Casos de diseño**: 13 cases (c01…c13), each following a **mandatory 15-section template** (§6).
- **Parte 3 — Modo práctica**: 45-min timed simulator with a text area → then solution + self-evaluation
  rubric by sections (aclaración, estimaciones, arquitectura, trade-offs, monitoreo, comunicación);
  plus a **flashcards** bank.
- **Parte 4 — Referencias rápidas**: cheat sheets (numbers, tools by category, Docker/kubectl
  commands) and a **Spanish–English glossary**.

It is built **in phases**. **This is Phase 1**: the complete skeleton (navigation, index with ALL
modules and cases, progress, practice mode incl. flashcards), **module m01 complete** and **case
c01 complete**. Every other module/case appears in the index as **"Próximamente"** (with its title,
summary and — for cases — its interviewer prompt, so it can already be practiced). Later phases will
add one content file per module/case **without touching the shell**, so the content format (§5) is
a long-lived contract.

## 1. Hard technical constraints

- Plain JavaScript (ES2020), **classic scripts** (no ES modules: they break on `file://`). Every file
  is an IIFE attaching to the global namespace `MSD`:
  ```js
  (function (root) {
    'use strict';
    const MSD = (root.MSD = root.MSD || {});
    // ...
  })(typeof window !== 'undefined' ? window : globalThis);
  ```
  `js/core/*` and `js/content/*` must NOT touch `document`/`window` APIs at load time (they must
  load in Node for validation).
- No npm dependencies. Node ≥ 20 for tools/tests (`node --test`). Machine: Node 24, macOS, Chrome.
- Only external resource: Google Fonts stylesheet (IBM Plex Sans, IBM Plex Sans Condensed, IBM Plex
  Mono). Everything degrades gracefully offline (system font stacks).
- Must work (1) by double-clicking `index.html` (`file://`) and (2) bundled by `build.mjs` into one
  HTML file and published as a claude.ai Artifact, which runs in a **sandboxed iframe**: no
  `alert/confirm/prompt` (build confirmations into the page), no downloads via `<a download>`, no
  `window.open`, no `window.print`, no service workers. Clipboard: call
  `navigator.clipboard.writeText` inside the click handler, catch rejection and fall back to
  selecting the text. Only plain `#token` hashes survive in the artifact URL (letters, digits,
  `. _ ~ -`) — see routing §4.3.
- Toggle visibility with `el.hidden = true/false`; a global `[hidden]{display:none!important}` exists.
- All user-facing text in **Spanish (neutral Latin American, tuteo)**; technical terms in English.
  Code comments in Spanish, short, only where useful (reference files in §8 are the exception: they
  are commented line by line on purpose).
- Accessibility: semantic landmarks, skip link, visible focus, keyboard-operable everything,
  `aria-current` in nav, `prefers-reduced-motion` respected, contrast ≥ 4.5:1 for text.
- Responsive: works at 360–400 px width with a ≥ 16 px side gutter; body never scrolls
  horizontally (only tables, code and diagrams scroll inside their own `overflow-x:auto` wrapper).
- Theme-aware (light/dark) per §3.

## 2. File layout and ownership

```
apps/ml-system-design/
  index.html                    # full document; loads css/js in the order of §2.1        [shell]
  package.json                  # scripts: test, embed, build, check, smoke, validate       [orchestrator]
  build.mjs                     # inlines local css/js → dist/ml-system-design.html + dist/artifact.html [shell]
  README.md                     # Spanish user guide (written last)                          [integrator]
  docs/SPEC.md                  # this file                                                  [orchestrator]
  css/app.css                   # tokens (§3) + base + layout + sidebar + pages + blocks     [shell]
  css/components.css            # diagram + code viewer styles                               [viz]
  css/practice.css              # simulator, rubric, history, flashcards, glossary           [practice]
  js/core/registry.js           # MSD.register / catalog / templates / lookups (§5)          [orchestrator — exists]
  js/core/store.js              # persistence + progress + practice + flashcards state (§4.4) [shell]
  js/ui/dom.js                  # MSD.dom: h(), esc(), icons, clipboard helper (§4.2)        [shell]
  js/ui/blocks.js               # MSD.Blocks.render(block, ctx) for every block type (§5.3)  [shell]
  js/ui/diagram.js              # MSD.Diagram.render(spec, opts) (§5.4)                      [viz]
  js/ui/code.js                 # MSD.Code.render(files, opts) + highlighter (§5.5)          [viz]
  js/ui/practice.js             # MSD.Practice (simulator, rubric, history pages)            [practice]
  js/ui/flashcards.js           # MSD.Flashcards (review page)                               [practice]
  js/ui/reference.js            # MSD.Reference (glossary page + "próximamente" cheat sheets) [practice]
  js/app.js                     # MSD.App: router, layout, sidebar, home, module/case pages, search [shell]
  js/content/catalog.js         # MSD.defineCatalog({...}) — every module/case/page meta     [catalog]
  js/content/reference-files.js # GENERATED by tools/embed-reference.mjs (never edit by hand)
  js/content/m01-mapa.js        # module m01 content                                         [m01]
  js/content/c01-clasificacion.js # case c01 content (all sections except 13)                [c01]
  js/content/c01-archivos.js    # case c01 section 13 (reference files) via MSD.addSection    [c01-files]
  reference/c01/...             # the REAL reference files of case c01 (runnable)            [c01-files]
  tools/browser-check.mjs       # headless Chrome checker (exists; copied from transformer-lab)
  tools/validate-content.mjs    # content validator (exists — run it!)                        [orchestrator]
  tools/embed-reference.mjs     # reference/** → js/content/reference-files.js (exists)       [orchestrator]
  tools/smoke.js                # browser smoke test (eval script for browser-check)         [integrator]
  tests/content.test.cjs        # node:test wrapper around the validator + embed freshness   [orchestrator — exists]
  dev/components.html           # isolated demo page for diagram + code components           [viz]
```

### 2.1 Script/style load order in `index.html`
Google Fonts → `css/app.css` → `css/components.css` → `css/practice.css`.
Scripts (all at the end of `<body>`, classic, in this order):
`js/core/registry.js` → `js/core/store.js` → `js/ui/dom.js` → `js/ui/blocks.js` →
`js/ui/diagram.js` → `js/ui/code.js` → `js/ui/practice.js` → `js/ui/flashcards.js` →
`js/ui/reference.js` → `js/content/catalog.js` → `js/content/reference-files.js` →
`js/content/m01-mapa.js` → `js/content/c01-clasificacion.js` → `js/content/c01-archivos.js` →
`js/app.js` (boots on `DOMContentLoaded`, or immediately if the DOM is already parsed).
Future phases append `js/content/<id>-*.js` lines before `js/app.js` — keep that spot obvious with an
HTML comment `<!-- contenido: añade aquí los módulos/casos nuevos -->`.

### 2.2 Tooling (already written — use it)
```
node tools/validate-content.mjs            # validates catalog + the content files index.html loads, in that order (schema, links, template)
node tools/embed-reference.mjs             # regenerates js/content/reference-files.js from reference/**
node --test "tests/*.test.cjs"             # validator + embed freshness + store tests (a bare directory fails on Node 24)
node tools/browser-check.mjs --url index.html [--width 1440 --height 900] [--dark] [--mobile] \
     [--wait 2500] [--eval "js (awaited)"]... [--eval-file f.js] [--shot /abs/out.png] [--full]
```
`browser-check` prints console messages/exceptions and each eval's JSON value, saves a PNG you can
look at with the Read tool, and exits 1 on errors. **Screenshots go to your scratchpad dir, never
the repo.**

## 3. Visual design (tokens are a contract; `css/app.css` defines them, others only consume them)

Name: **Ronda de Diseño ML** (the "design round" of the interview). Treatment: utilitarian, polished,
information-dense like an engineering **datasheet / runbook** — not a marketing page. No emoji as
section markers, no gradients, no "card soup" (border+shadow only where an element is a separate
object), numbering only where order is real (the 7 framework steps, the 15 template sections).

Fonts: display **IBM Plex Sans Condensed** 600/700 (headings, eyebrows, nav group labels);
body **IBM Plex Sans** 400/500/600 (16 px, line-height 1.6, measure ≈ 70ch); data/code
**IBM Plex Mono** 400/500 (numbers with units, code, shapes). Fallbacks:
`'IBM Plex Sans Condensed', 'Arial Narrow', system-ui, sans-serif`,
`'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif`,
`'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace`.
Use `font-variant-numeric: tabular-nums` where digits align.

Tokens (define ALL on bare `:root` = light; redefine under
`@media (prefers-color-scheme: dark){ :root:not([data-theme="light"]){…; color-scheme:dark} }` and
again under `:root[data-theme="dark"]{…; color-scheme:dark}`; `body` gets `background: var(--bg)`):

| token | light | dark | meaning |
|---|---|---|---|
| `--bg` | `#EEF1F3` | `#10151B` | page ground |
| `--surface` | `#FBFCFC` | `#151B22` | reading surface / panels |
| `--surface-2` | `#F3F5F7` | `#1B232C` | insets, table heads, code bg |
| `--ink` | `#141B22` | `#E6EBF0` | text |
| `--muted` | `#5B6672` | `#95A1AD` | secondary text |
| `--rule` | `#D3D9DF` | `#27313B` | hairlines |
| `--rule-strong` | `#A9B3BD` | `#3C4854` | emphasized rules, arrows |
| `--accent` | `#2B5BD7` | `#7CA2FF` | interactive accent + ONLINE path |
| `--accent-ink` | `#1E46B0` | `#9DB9FF` | accent text on soft bg |
| `--accent-soft` | `#E3EAFB` | `#1A2544` | accent fills |
| `--offline` | `#9A5A06` | `#E3A34B` | OFFLINE / batch / training path |
| `--offline-soft` | `#F6E9D5` | `#35270F` | |
| `--monitor` | `#7445A8` | `#B794F0` | observability / connections |
| `--monitor-soft` | `#EEE6F7` | `#2A1F3D` | |
| `--store` | `#2F6B57` | `#6FC3A5` | data stores / "interview phrase" |
| `--store-soft` | `#E0EFE8` | `#16302A` | |
| `--ok` | `#25734A` | `#5CC98A` | senior / done / success |
| `--ok-soft` | `#DDF0E4` | `#133022` | |
| `--bad` | `#B3261E` | `#F07A70` | traps / errors / junior |
| `--bad-soft` | `#F8E0DE` | `#3A1A18` | |
| `--warn` | `#9A5A06` | `#E3A34B` | estimates (same hue family as offline, on purpose: "numbers to verify") |
| `--warn-soft` | `#F6E9D5` | `#35270F` | |
| `--focus` | `#2B5BD7` | `#7CA2FF` | focus ring |
| `--shadow-1` | `0 1px 2px rgba(20,27,34,.06)` | `0 1px 2px rgba(0,0,0,.4)` | |
| `--shadow-pop` | `0 8px 28px rgba(20,27,34,.16)` | `0 8px 28px rgba(0,0,0,.5)` | |
Also: `--font-display --font-body --font-mono`, type scale `--fs-xs:12px --fs-sm:13.5px --fs-md:16px
--fs-lg:19px --fs-xl:24px --fs-2xl:32px`, radii `--r-1:3px --r-2:6px`, `--gap:12px --gutter:16px`,
`--ease:cubic-bezier(.2,.7,.2,1) --dur:160ms`, layout `--sidebar-w:288px --content-max:780px --toc-w:220px`.
Every color must meet ≥ 4.5:1 for text on its intended surface in both themes (adjust the soft/ink
values slightly if needed and note it).

Semantic mapping used everywhere (diagram, callouts, chips):
- online path / interactive → accent · offline path → offline · observability → monitor ·
  data stores → store · traps/junior → bad · senior/done → ok · estimates → warn · skip → muted.

**Signature details (keep them):**
1. **Uptime strip** progress: like a status page's 90-day uptime bar — one small cell per module
   and case (28 cells, grouped 15 | 13), states: `done` (ok), `progress` (accent, partial),
   `ready` (rule-strong outline), `soon` (hatched/dim). Shown on Home and compact in the sidebar.
2. **Spec strip** on case pages: datasheet-style row of the case's key numbers with units
   (`QPS pico 500 req/s · p99 ≤ 200 ms · disponibilidad 99.9 % · presupuesto ≈ US$3k/mes`)
   (hidden while the practice gate is shown: its numbers are part of the solution).
3. The practice **timer shows which framework step you should be on** (§7.2).

Layout: ≥ 1200 px → sidebar (fixed, own scroll) | content column (max `--content-max`) | right TOC
(sticky, "En esta página" with read ticks). 768–1199 → sidebar + content (TOC collapses into a
"Secciones" disclosure at the top of the page). < 768 → top bar with menu button; sidebar becomes a
drawer (focus-trapped, Esc closes, backdrop click closes). Sticky elements use
`top: env(safe-area-inset-top, 0px)`.

## 4. Shell architecture

### 4.1 Pages and IDs
- Modules: `m01`…`m15`. Cases: `c01`…`c13`.
- Special pages: `inicio` (home/dashboard), `practica` (simulator hub: choose a case),
  `practica-cNN` (a running/finished practice session for case NN), `historial` (practice
  history), `flashcards`, `mis-notas` (the user's own notes and terms), `glosario`, `ref-numeros`, `ref-herramientas`, `ref-comandos`,
  `buscar` (search results, optional).
- Sidebar groups (in this order): **Inicio** · **Parte 1 — Fundamentos** (m01–m15) ·
  **Parte 2 — Casos de diseño** (c01–c13) · **Parte 3 — Práctica** (Simulador, Historial,
  Flashcards, Mis notas) · **Parte 4 — Referencias** (Números que debes saber, Herramientas por categoría,
  Docker y kubectl, Glosario ES–EN). Each item shows its number, short title, and a state marker
  (done ✓ / progress ring / "Próx." pill for not-ready).

### 4.2 `MSD.dom` (js/ui/dom.js)
`h(tag, attrs, ...children)` (attrs: `class`, `text`, `html`, `on:{event:fn}`, `dataset`, aria/any
attribute; children: nodes/strings/arrays/null) · `esc(str)` · `icon(name)` returns inline SVG
string for: `check, chevron, menu, close, search, timer, play, pause, reset, copy, external, flag,
star, book, cases, practice, cards, ref, sun, moon, system, arrow-left, arrow-right, info, warn,
skip, link` (simple 16×16 stroke icons, `currentColor`) · `copyText(text, fallbackEl)` → Promise<bool> ·
`fmtDuration(sec)` → `"44:59"` · `slug(str)`.

### 4.3 Routing (js/app.js)
Hash routes: `#<pageId>` or `#<pageId>.<sectionId>` (dot separator; only `[A-Za-z0-9._~-]`).
Examples: `#m01`, `#m01.framework`, `#c01.estimaciones`, `#practica-c01`, `#glosario`.
Empty hash → `inicio`. Unknown → friendly "no encontrado" with link home. On navigation: render
page, scroll to section if given (else top), update `aria-current`, set `document.title` to
`<page title> · Ronda de Diseño ML`, store `lastLocation`. Internal links in content are plain
`<a href="#m03">` / `<a href="#c01.serving">` and must just work (including links to not-ready
pages, which show the "Próximamente" page). Keyboard: `/` focuses search, `[` / `]` previous/next
page in the course order, `Esc` closes drawers/popovers.

### 4.4 `MSD.store` (js/core/store.js) — state + persistence
In-memory state object, persisted with a **two-tier backend**:
1. **Always** `localStorage` key `msd.v1` (wrap every access in try/catch; if it throws, keep memory only).
   Several tabs share that key: before each write, merge what is stored (same rules as the account
   merge below; tombstones keep deletions deleted) and merge `storage` events from other tabs, notifying
   subscribers with `'remote'`, so one tab never overwrites another tab's attempts or progress.
2. **If running inside a claude.ai Artifact viewer** (`window.claude && typeof window.claude.use === 'function'`):
   `const [db, user] = await Promise.all([claude.use('db'), claude.use('user')])`; if both non-null
   and `uid = await user.id()` is non-null, sync to the viewer's **private** subtree:
   - main doc: `db.doc('data/users/' + uid + '/state')` → `{v:1, updatedAt, progress, flash, prefs, checklists, lastLocation}`
   - attempts: `db.doc('data/users/' + uid + '/state').collection('attempts').doc(attemptId)` → one
     doc per attempt/draft (keeps each doc ≪ 256 KiB; cap text at 100 000 chars).
   On load: read remote; merge with local by `updatedAt` per top-level key (newer wins; for maps like
   `progress.sections` take the union with newest timestamps). Writes: coalesce (≥ 2 s after the last
   change), **one write at a time per doc**, never from render code, never on a timer that rewrites
   unchanged data. Handle rejections: `invalid_argument` → stop syncing that doc, keep local;
   `unavailable` → retry once after a random 1–3 s delay; `revoked`/others → degrade to local.
   Never block first paint on this (the namespace resolves later; `null` after ~10 s).
   Expose status: `store.backend()` → `'account' | 'local' | 'memory'` and `store.onStatus(fn)`;
   the sidebar footer shows "Guardado en tu cuenta" / "Guardado en este navegador" / "Sin guardado".
Public API (all synchronous reads from memory; writes schedule persistence and notify subscribers):
```js
store.subscribe(fn) → unsubscribe            // fn(changeKind) after any mutation
store.getState()                             // read-only view
// progress
store.isSectionRead(pageId, sectionId) → bool
store.setSectionRead(pageId, sectionId, bool)
store.pageProgress(pageId) → {read, total, pct, completed}   // total from MSD.getPage(pageId).sections
store.setPageCompleted(pageId, bool)
store.courseProgress() → {done, inProgress, ready, total, pct}  // over the 28 modules+cases
store.markVisited(pageId)
store.getChecklist(pageId, listId) → {itemId: true}
store.setChecklistItem(pageId, listId, itemId, bool)
store.lastLocation() / store.setLastLocation(hash)
// practice (attempt = {id, caseId, status:'draft'|'done', text, elapsedSec, running:bool,
//   resumedAt:number|null, createdAt, updatedAt, finishedAt?, rubric?:{dimId:{level:1-4, points:[pointIds]}}, score?:{total, max, pct}})
store.getDraft(caseId) → attempt|null           // the single open draft for a case
store.startDraft(caseId) → attempt              // creates if none
store.updateDraft(caseId, patch)                // text / elapsedSec / running / resumedAt
store.finishAttempt(caseId, {rubric, score}) → attempt   // status → 'done'
store.saveRubric(attemptId, rubric, score)
store.discardDraft(caseId)
store.listAttempts(caseId?) → attempt[] (newest first, done only unless {includeDrafts:true})
store.deleteAttempt(attemptId)
// flashcards (Leitner, 5 boxes; intervals in days [0,1,3,7,16])
store.cardState(cardId) → {box, due, seen, lapses, last}   // defaults for unseen: box 0, due now
store.gradeCard(cardId, 'again'|'hard'|'good')             // again→box 0; hard→same box, due +1d (box0: +10min); good→box+1
store.dueCards(cardIds) → ids due now (unseen count as due)
// prefs
store.pref(key) / store.setPref(key, value)   // theme:'system'|'light'|'dark', solutionRevealed:{caseId:true}, flashFilter, etc.
// portability
// notes (the user's own notes and glossary terms; js/ui/notes.js renders them)
//   note = {id, kind:'note'|'term', page, section, term, text (≤ 4000 chars), createdAt, at, del}
//   Stored in state.notes.items; a deletion keeps {del:true, at} without text so it wins on merge
//   (newest `at` wins). In the Artifact they sync to their own doc data/users/<uid>/notes.
store.listNotes({page?, section?, kind?}?) → live notes, oldest first
store.getNote(id) / store.addNote({kind, page, section, term, text}) → note|null
store.updateNote(id, {term?, text?, kind?}) → note|null / store.deleteNote(id)
store.exportJSON() → string
store.importJSON(str) → {ok, error?}          // validates shape, merges
store.backend() / store.onStatus(fn)
```

### 4.5 Pages the shell renders (js/app.js)
- **inicio** (Home — opens in a realistic working state, never empty): title + one-paragraph purpose;
  uptime strip + "X de 28 completados"; "Continúa donde lo dejaste" (last location, or m01 on first
  visit); "Siguiente recomendado" (first ready & not completed item in course order);
  practice summary (last attempts with scores; CTA "Practicar <first ready case without a finished
  attempt>", falling back to the first ready case); flashcards due today; the
  **phase roadmap** from `catalog.roadmap` (Fase 1 ✓ contents; next phases as suggestions the user can
  ask for); a compact "Cómo usar esta app" (study loop: módulo → flashcards → caso en modo práctica →
  rúbrica → solución). Everything derived from real state; first visit shows sensible defaults.
- **Module page** (`mNN`, ready): header (eyebrow "Parte 1 · Módulo 01", h1 title, `titleEn` in
  muted mono, summary, meta row: reading time, interview-frequency chip, "Conecta con" chips linking
  to other pages), then sections. Each section: `<section id="<pageId>.<sectionId>">` with h2 (and
  a priority chip `Esencial`/`Extra`/`Sáltate esto` if given), blocks, and at the end a
  "Marcar como leída" toggle button. Bottom: prev/next in course order + "Marcar módulo como
  completado". Right TOC with read ticks; highlight current section on scroll (IntersectionObserver).
- **Case page** (`cNN`, ready): header (eyebrow "Parte 2 · Caso 01", title, summary, **spec strip**
  from `page.specs`), then the **practice gate**: if the user has no finished attempt for this case
  and `pref('solutionRevealed')[caseId]` is not set, show ONLY the interviewer prompt (catalog `prompt`) —
  never the rest of section 1, the spec strip or the progress line (they answer the clarifying questions
  and contain the estimates) — with `tests` inside a collapsed "Pista: qué evalúa este caso" disclosure,
  and two actions: primary "Practicar primero (45 min)" → `#practica-cNN`; secondary text button
  "Ver la solución sin practicar" (sets `solutionRevealed`). Otherwise show the 15 template sections
  with a numbered template navigator (1–15; titles from `MSD.CASE_TEMPLATE`), same read ticks, same
  prev/next. Section 15's checklist is interactive and persisted.
- **"Próximamente" page** (module/case not ready): header with title/summary, "Qué vas a aprender"
  (`meta.topics`), interview frequency, connections; for cases also the enunciado with a
  "Practicar este enunciado" button (practice works; solution pending) and a note:
  "Este contenido llega en una fase posterior. Pídelo cuando termines lo anterior."
- **Mis notas** (js/ui/notes.js, `MSD.Notes`): every section rendered by `buildSection` ends with the
  user's notes for it (a warm "sticky note" panel) and an "Agregar nota" button next to "Marcar como
  leída"; the form saves a note or a **term** (term + own definition). `#mis-notas` lists everything
  grouped by page (filter, edit, delete with an in-page confirmation, "Agregar término"). Own terms also
  appear in the glossary (row id `glosario.mio-<noteId>`, source chip "Mío"), in the search (types
  `note` / `myterm`) and as flashcards (`id: 'mio-<noteId>'`, kind `mio`, source `mis-notas`). User text
  is always rendered as text (escaped), never as HTML. Notes travel with export/import.
  On pages with visible sections the shell calls `MSD.Notes.setPage({id, sections, current})`: a fixed
  bar (bottom-right) with "Nota" (adds a note in the section being read) and "Ver notas (N)" opens a
  non-modal panel from the left with the form (section selector, defaults to the current section) and
  the page's notes grouped by section; ≥ 1100 px the content shifts right while it is open; Esc closes.
  All note lists are "live": a change in one (section, panel, #mis-notas) repaints the others unless
  you are typing in them.
- **Module practice** (js/ui/drill.js, `MSD.Drill`, route `#practicar-mNN`): shown for a module when
  `MSD.drillBank[mNN]` exists (content files `js/content/mNN-practica.js` → `questions` (4 options, one
  `ok`, each with `why`; `explain`; `section` to re-read) and `quick` cheat-sheet cards;
  `js/content/mNN-practica-calc.js` → `formulas` and `calc` templates `{id, section, title, gen(r) →
  {q, unit, answer, tol, steps}}` with random numbers each round). A round = 6 multiple choice (unseen
  first, pref `drillSeen`) + 4 calculations; stats in pref `drillStats`. A right-side panel shows
  Formulario / Notas rápidas / Mis notas. The module page shows a "Practicar mNN" call to action.
- **"En esta página" (right TOC) is collapsible**: its title is a toggle; collapsed it becomes a vertical
  tab and the content column widens to `--content-wide` (big diagrams fit). Pref `tocCollapsed`.
- **Search**: input at the top of the sidebar; results in a popover/list (keyboard navigable)
  over: page titles/summaries, section titles, glossary terms (en/es), flashcard questions.
  Uses `MSD.searchIndex()` (§5.6). Enter opens the first result. Flashcards rank below pages, sections
  and terms (no title bonus, at most 3 results), and cards of a case still behind its practice gate are
  not shown.
- **Sidebar footer**: storage status, theme switch (Sistema/Claro/Oscuro — sets/removes
  `data-theme` on `<html>`), "Exportar / Importar progreso" (opens an in-page panel: export shows the
  JSON in a textarea + Copy button; import accepts pasted JSON with an explicit "Importar" button
  and a result message; no `prompt()`).
Practice/flashcards/glossary/ref pages are rendered by `MSD.Practice`, `MSD.Flashcards`,
`MSD.Reference` (§7) — except a `ref-*` sheet with registered sections, which the shell renders like a
module page (§7.4): the router calls `X.render(container, route, ctx)` where
`ctx = {store: MSD.store, navigate(hash), renderBlocks(blocks, el, pageCtx)}`.

## 5. Content format (long-lived contract)

### 5.1 Registry API (js/core/registry.js — already written; read it)
```js
MSD.defineCatalog(catalog)            // once, from js/content/catalog.js
MSD.register(page)                    // one call per content file for modules/cases
MSD.addSection(pageId, section)       // add/replace a section of a page (for split files)
MSD.getPage(id) → {…meta, …content, ready:bool, sections:[…]} | null   // sections ordered (template order for cases)
MSD.listPages(kind?) → [merged pages in course order]   // kind: 'module' | 'case'
MSD.courseOrder() → ['m01',…,'m15','c01',…,'c13']
MSD.flashcards() → all cards from all registered pages (+ catalog.flashcards)
MSD.glossary() → merged, de-duplicated (by en.toLowerCase()), sorted by en
MSD.searchIndex() → [{type:'page'|'section'|'term'|'card', id, title, text, href}]
MSD.CASE_TEMPLATE, MSD.RUBRIC_DIMENSIONS, MSD.FRAMEWORK, MSD.BLOCK_TYPES, MSD.CALLOUT_KINDS
MSD.MODULE_IDS, MSD.CASE_IDS, MSD.slug(str), MSD.stripHtml(html)
MSD.catalog() → the catalog object     // NOTE: a function
MSD.registryProblems() → [string]     // registration errors (show them in a dev banner if non-empty)
MSD.registeredIds() → [id]            // ids with registered content (validator: unknown ids are typos)
MSD.sectionOverrides() → ['page.sec'] // addSection calls that replace a section the main file registers
MSD.files[path] → string              // embedded reference files (generated)
```
Catalog object shape (`js/content/catalog.js` calls `MSD.defineCatalog(...)` once):
```js
{ version: 1,
  items: { m01:{…}, …, m15:{…}, c01:{…}, …, c13:{…},
           inicio:{id,kind:'special',title,short,summary}, practica:{…}, historial:{…}, flashcards:{…},
           glosario:{…}, 'ref-numeros':{…, topics}, 'ref-herramientas':{…, topics}, 'ref-comandos':{…, topics} },
  roadmap: [ {phase:1, title:'Fase 1 — …', status:'done'|'next'|'later', items:[ids], note:html} ],
  flashcards: [],   // optional general cards (source 'general'); ids 'gen-…'
  glossary: [] }    // optional general terms
```

### 5.2 Page objects
**Catalog item** (in `catalog.items[id]`, for all 28 + special pages): 
`{id, kind:'module'|'case'|'special', part:1|2|3|4, num, title, titleEn, short (≤ 28 chars for the
sidebar), summary (1–2 sentences), topics:[string] (what it will cover), freq:'alta'|'media'|'baja'
(how often it shows up in MLE system-design interviews), minutes (reading estimate), connects:[ids],
prompt?:html (cases only: the interviewer's ambiguous prompt, 1–3 sentences), difficulty?:
'intro'|'media'|'alta' (cases), tests?:[string] (cases: what the case really tests), facts?:[{topic,
a:html}] (cases, optional: the interviewer’s answers grouped under neutral topics from M01’s question
bank; shown collapsed in the practice session)}`.

**Registered module** (`MSD.register`):
```js
{ id:'m01', kind:'module',
  sections:[ {id:'kebab-id', title:'…', titleEn?:'…', priority?:'core'|'extra'|'skip',
              dims?:['aclaracion'|'estimaciones'|'arquitectura'|'tradeoffs'|'monitoreo'|'comunicacion'],
              blocks:[…]} ],
  flashcards:[ {id:'m01-01', q:'…', a:'html', kind:'concepto'|'numero'|'tradeoff'|'trampa'|'frase'} ],
  glossary:[ {en:'throughput', es:'rendimiento, caudal', def:'html (1–2 sentences)', say?:'English example sentence'} ] }
```
**Registered case**: same plus
```js
{ kind:'case',
  specs:[ ['QPS pico','500 req/s'], ['Latencia','p99 ≤ 200 ms'], … ],   // spec strip, 4–6 pairs
  rubric:{ aclaracion:[{id,text}], estimaciones:[…], arquitectura:[…], tradeoffs:[…], monitoreo:[…], comunicacion:[…] },
  sections:[ /* exactly the 15 template ids of §6, in any order; the registry sorts them */ ] }
```
`dims` (optional) = rubric dimensions this section trains; the practice result links weak dimensions
to up to 3 tagged sections of ready modules (fallback: M01).

Section ids for cases are fixed (§6). A case may be split across files: the main file registers
the page with 14 sections and another file calls `MSD.addSection('c01', {id:'archivos', …})`.

**Registered reference sheet** (`ref-numeros`, `ref-herramientas`, `ref-comandos`):
`MSD.register({id:'ref-numeros', kind:'special', sections:[…], flashcards?:[{id:'ref-numeros-01',…}], glossary?:[…]})`.
It is ready when it has ≥ 1 section; there is no catalog `ready` flag. Any other registered id is a
validator error (a typo such as `m3` would never be shown).

Ids of sections, checklists/items, flashcards and rubric points are persistence keys (store.js:
`progress.sections['<page>.<section>']`, `checklists['<page>|<list>|<item>']`, `flash.cards[<cardId>]`,
attempt `rubric[dim].points`). Once shipped they are immutable: change `title`/text, never the id;
never reuse a deleted id.

### 5.3 Block types (rendered by `MSD.Blocks.render`)
Inline HTML is allowed in any `html`/`text`-like field: `<b> <strong> <i> <em> <code> <a href="#…">
<br> <sub> <sup> <kbd> <span class="est">` and `<span class="en">`. Use HTML entities for `<`, `>`, `&`
in prose. External links: `<a href="https://…" target="_blank" rel="noopener">` (only for real,
well-known URLs).
- `{t:'p', html}` — paragraph.
- `{t:'h3', text}` — sub-heading inside a section.
- `{t:'list', ordered?:bool, items:[html]}`.
- `{t:'callout', kind, title?, html}` — kinds (`MSD.CALLOUT_KINDS`) and default titles:
  `why` "El porqué" · `trap` "Trampa" · `senior` "Señal senior" · `skip` "Sáltate esto" ·
  `estimate` "Estimación — verifica" · `connect` "Conexión" · `interview` "Cómo decirlo en la entrevista"
  (English phrasing) · `note` "Nota".
- `{t:'table', caption?, head:[html], rows:[[html]], note?:html}` — first column is row header.
- `{t:'kv', items:[[label, value, note?]]}` — datasheet-like key numbers (value in mono).
- `{t:'steps', items:[{title, meta?, html}]}` — numbered sequence (real order only).
- `{t:'calc', title?, rows:[{label, expr, value, note?}], result?:html}` — back-of-the-envelope
  worked calculation: each row "label · expr (mono) · = value". Always pair with a sentence that
  says what the number means for the design.
- `{t:'qa', items:[{q, a, why?}]}` — clarifying questions with ASSUMED answers (+ why ask it).
- `{t:'followups', items:[{q, junior, senior, why?}]}` — interviewer follow-ups with a "nivel
  junior" answer vs a "nivel senior" answer side by side (stacked on mobile), plus why the senior
  one scores.
- `{t:'tradeoffs', items:[{option, verdict:'elegido'|'descartado'|'depende', pros:html, cons:html, why:html}]}`.
- `{t:'checklist', id, items:[{id, html}]}` — interactive, persisted per page/list/item.
- `{t:'quiz', items:[{q, options:[html], answer:index, explain:html}]}` — self-check; click an
  option → reveal right/wrong + explanation (not persisted).
- `{t:'diagram', id, title, caption?, spec}` — §5.4.
- `{t:'code', title?, caption?, files:[{name, lang, src?|code?, note?:html}]}` — §5.5.
- `{t:'html', html}` — escape hatch (use sparingly).
Unknown block type → render a visible warning box (never crash).

`<span class="est">≈ 1,000 img/s</span>` marks an **estimate**: dotted underline + a tiny "est."
marker + tooltip "Estimación: mídela en tu caso". Numbers use decimal point and comma thousands
(1,000.5 — MX/EN convention). Currency: `US$`.

### 5.4 Diagram spec (`MSD.Diagram.render(spec, {id, title}) → HTMLElement`)
Coordinates in grid **units** (1 unit = 10 px at 100 % scale; the SVG scales with `viewBox`, and
sits in an `overflow-x:auto` wrapper with `min-width` = 70 % of natural width so text stays legible
on phones).
```js
spec = {
  width: 100, height: 56,                           // canvas in units
  lanes: [ {id, label, x, y, w, h, kind:'online'|'offline'|'monitor'|'neutral'} ],   // labeled background bands
  nodes: [ {id, label, sub?, x, y, w, h, kind, note?:html, badge?:string} ],
  //  kind: 'client'|'edge'|'service'|'model'|'gpu'|'store'|'queue'|'job'|'monitor'|'external'|'human'
  //  label ≤ 18 chars, sub ≤ 26 chars; typical w 14–20, h 6–8
  edges: [ {from, to, label?, kind?:'online'|'offline'|'async'|'monitor'|'neutral', dashed?, fromSide?, toSide?, via?:[[x,y]…], bidir?} ],
  //  sides: 'l'|'r'|'t'|'b' (auto if omitted); orthogonal routing through `via` points
  flows: [ {id, label, steps:[ {nodes:[ids], edges:['from>to'], text:html} ]} ]   // optional guided walkthrough
}
```
Behavior: nodes are focusable buttons (Enter/Space/click) → highlight node + incident edges and
show `note` in a panel under the diagram ("Por qué está aquí"). If `flows` exist, show controls
"Recorrer: <flow label>" with Anterior/Siguiente and the step text; highlighted nodes/edges animate
(respect reduced motion). Under every diagram, a `<details>` "Componentes y por qué" lists all nodes
with their notes (text alternative + mobile friendliness). Lane and edge colors follow §3 mapping;
node kinds get distinct shapes/insets (store = cylinder-ish, queue = segmented, gpu = chip corner
marks, human = rounded pill, external/client = dashed border). Theme-aware via CSS variables only.

### 5.5 Code block spec (`MSD.Code.render(files, opts) → HTMLElement`)
`files:[{name, lang, src?, code?, note?}]` — `src` is a path under `reference/` (e.g.
`'c01/gateway/app/main.py'`) resolved via `MSD.files[src]`; `code` is inline text for short
snippets. `lang`: `python | dockerfile | yaml | bash | pbtxt | json | toml | text | promql | ini`.
Renders tabs (one per file, filename in mono), line numbers, lightweight syntax highlighting
(comments, strings, keywords, numbers, keys for yaml/pbtxt — comments visually distinct because they
carry the explanations), "Copiar" button per file, optional `note` under the file, wrap toggle
(default: no wrap, horizontal scroll inside the block). Missing `src` → visible warning, no crash.

### 5.6 Search index
`MSD.searchIndex()` builds entries from catalog items (title, titleEn, summary, topics), registered
section titles (href `#page.section`), glossary terms (href `#glosario` + `.` + slug(en)), and
flashcard questions (href `#flashcards.<cardId>`: the flashcards page shows that card first). The shell
filters with a case/diacritic-insensitive match.

## 6. Case template (MANDATORY for every case; ids fixed, order fixed)
| # | id | título | must contain |
|---|---|---|---|
| 1 | `enunciado` | Enunciado | the prompt exactly as an interviewer says it (ambiguous on purpose) + how to open your answer |
| 2 | `aclaracion` | Preguntas de aclaración | `qa` block: questions you should ask, with assumed answers and why each matters |
| 3 | `requisitos` | Requisitos | functional + non-functional (latency p99, QPS, availability, budget, freshness…) as tables/kv |
| 4 | `estimaciones` | Estimaciones back-of-the-envelope | `calc` blocks with numbers: peak QPS, GPUs, VRAM, storage, monthly cost; each marked estimate |
| 5 | `arquitectura` | Arquitectura | `diagram` with online and offline paths separated (lanes) + walkthrough flows |
| 6 | `datos` | Pipeline de datos y entrenamiento | sources, labeling, versioning, training, validation gate, registry |
| 7 | `serving` | Serving | pattern, framework, hardware, batching, optimizations — each with why |
| 8 | `evaluacion` | Evaluación offline y online | offline metrics/slices/parity, online A/B with sample size, guardrails |
| 9 | `monitoreo` | Monitoreo, alertas y reentrenamiento | system vs model metrics, concrete alert rules, retrain triggers |
| 10 | `fallas` | Modos de falla y degradación | failure table + graceful-degradation ladder |
| 11 | `tradeoffs` | Trade-offs | `tradeoffs` block: discarded alternatives and why |
| 12 | `costo` | Costo y cómo reducirlo | monthly cost breakdown + levers with impact |
| 13 | `archivos` | Archivos de referencia | `code` blocks: Dockerfile, docker-compose, minimal FastAPI app, K8s manifest or Triton/vLLM config — commented line by line explaining why |
| 14 | `seguimiento` | Preguntas de seguimiento | `followups` block: junior vs senior answers |
| 15 | `checklist` | Checklist final | `checklist` block: "si no mencionaste esto, pierdes puntos" |

## 7. Practice mode (js/ui/practice.js, flashcards.js, reference.js)

### 7.1 Framework (from module m01; `MSD.FRAMEWORK` in registry.js — the single source)
| # | id | título (ES) | English | minutos | ventana |
|---|---|---|---|---|---|
| 1 | `aclarar` | Aclarar el problema | Clarify the problem | 5 | 0–5 |
| 2 | `requisitos` | Requisitos y métricas | Requirements & metrics | 5 | 5–10 |
| 3 | `estimar` | Estimaciones | Back-of-the-envelope estimates | 5 | 10–15 |
| 4 | `arquitectura` | Arquitectura de alto nivel | High-level design | 10 | 15–25 |
| 5 | `profundizar` | Deep dives | Deep dives | 12 | 25–37 |
| 6 | `operar` | Evaluación, despliegue y monitoreo | Evaluation, deployment & monitoring | 5 | 37–42 |
| 7 | `cerrar` | Fallas, trade-offs y cierre | Failure modes, trade-offs & wrap-up | 3 | 42–45 |

### 7.2 Simulator
- `practica` hub: list all 13 cases (ready or not) with prompt excerpt, difficulty, freq, best score,
  "Empezar" / "Continuar borrador" / "Ver intentos". Ready cases say "con solución"; others "solución
  en una fase posterior".
- `practica-cNN` session: the prompt (large, quoted), the `tests` hint and, if the case has `facts`,
  a collapsed "Respuestas del entrevistador" list (one disclosure per topic, to open only when you ask);
  countdown **45:00** with Start/Pause/Reset
  (elapsed persisted via `store.updateDraft` — survives reload/navigation: compute
  `elapsed = elapsedSec + (running ? (now - resumedAt)/1000 : 0)`); a **framework rail** (7 steps
  with their minute windows) highlighting the current expected step based on elapsed time, with the
  step's English name; a large autosaving textarea (coalesced saves ~1 s; char/word count);
  "Insertar esqueleto" button that inserts the 7 framework headings as a plain-text outline;
  when time runs out: gentle banner "Tiempo" (never auto-submit, never alert). Button
  "Terminar y autoevaluar" → rubric view.
- Rubric view: 6 dimensions from `MSD.RUBRIC_DIMENSIONS` (id, title, question, levels 1–4 with
  generic descriptors). For each: choose level 1–4 (radio group) + tick the case-specific key points
  from `page.rubric[dimId]` (if the case is ready). Score = sum(levels)/24 → %, plus key-point
  coverage. "Guardar evaluación" → `store.finishAttempt`. Then show: your design text (read-only),
  score summary, weakest dimensions with links to the relevant module sections, and a primary button
  "Ver la solución" (`#cNN`) for ready cases (sets `solutionRevealed`) — for not-ready cases "La
  solución llega en una fase posterior; tu intento queda guardado".
- `historial`: attempts newest first (case, date, duration, score %, per-dimension mini bars);
  expand to read the text; delete with an in-page confirm ("¿Borrar? Sí / No" inline).

### 7.3 Flashcards (`flashcards` page)
Deck = `MSD.flashcards()` minus the cards of any case still behind its practice gate (no finished
attempt and no `solutionRevealed`); show how many are locked. The sidebar badge and Home count the same
deck. Filter chips by source page (m01, c01…) and by kind; default "Pendientes
hoy". Card flow: show question → "Mostrar respuesta" (Space) → grade "Otra vez" (1) / "Difícil" (2) /
"Bien" (3) with the keys shown. Session summary at the end. Stats: per box counts (Leitner 0–4),
due today. Works with zero due cards ("Todo al día" + option "Repasar todo igual").

### 7.4 Reference pages
- `glosario`: searchable table ES–EN (`MSD.glossary()`): English term (mono), Spanish, definition,
  "cómo lo dirías" sentence, source page chips; alphabet jump; each row has id `glosario.<slug(en)>`.
- `ref-numeros`, `ref-herramientas`, `ref-comandos`: when `MSD.getPage(id).ready` (sections registered,
  §5.2), the shell renders them like a module page: `<section id="<id>.<sectionId>">` with blocks, read
  toggles and TOC, eyebrow "Parte 4 · Referencias", no "completado" or prev/next (sheets don't count
  toward course progress); the sidebar "Próx." pill also follows `getPage(id).ready`. Otherwise
  `MSD.Reference` shows a "Próximamente" page with the catalog `topics`.

## 8. Case c01 — shared facts (both c01 agents MUST use exactly these)
Scenario: second-hand **marketplace**. Sellers upload photos when creating a listing; the service
suggests the **product category** (top-5 of **500 leaf categories**) while the seller fills the rest
of the form. Other internal teams will also call the API. The model already exists: **ResNet-50**
trained in PyTorch (25.6 M params, ≈ 4.1 GMACs at 224×224), ~85 % top-1 / ~96 % top-5 offline
(assumed). Not our job to redesign the model.
- Traffic: **10 M images/day** → avg **≈ 116 req/s**; diurnal peak ≈ 3× → **≈ 350 req/s**; design
  peak with spike margin **500 req/s**. One image per request.
- Latency SLO: **p99 ≤ 200 ms server-side** (from full request received at the LB to response sent),
  p50 ≈ 30–50 ms expected. Caller timeout 300 ms → UI falls back to manual category picker.
- Availability **99.9 %** (≈ 43 min/month). Non-critical path (graceful fallback exists).
- Budget: **≈ US$3,000/month** infra (assumed answer).
- Mobile app downsizes photos to ≤ 1024 px long side before upload (~150–250 KB JPEG); web uploads can
  be full size (≤ 10 MB, ≤ 40 MP enforced).
- Serving design: **gateway service (FastAPI, CPU)** does validation + decode + resize + normalize,
  calls **NVIDIA Triton Inference Server** (GPU tier) over **HTTP/REST (KServe v2 protocol) with the
  binary tensor extension** (`tritonclient.http.aio`); gRPC is discussed as an alternative with the
  L4 load-balancing trap. Model in Triton: name **`classifier`**, platform `tensorrt_plan`, input
  **`input`** FP32 `[3,224,224]`, output **`logits`** FP32 `[500]`, `max_batch_size: 32`,
  **dynamic batching** `max_queue_delay_microseconds: 2000`, `instance_group` 2 × KIND_GPU.
  Engine built with `trtexec --fp16` from ONNX (opset 17, dynamic batch 1–32, opt 16) **on the same
  GPU type (T4, sm_75) and the same NGC release (e.g. 24.08) as serving** (engines are not portable).
- Hardware: **NVIDIA T4** (AWS `g4dn.xlarge`: 4 vCPU, 16 GiB RAM, 16 GB GPU, ≈ US$0.526/h
  on-demand us-east-1 — mark as approximate/verify). Planned per-GPU capacity **600 img/s** (≈ 50 %
  of a *measured* max; the max itself is an estimate to be measured with `perf_analyzer`).
  → 1 GPU covers peak; **2 GPUs (2 AZs, N+1)** for availability; HPA/KEDA up to 4.
- Gateway: CPU pods (1 uvicorn process per container, preprocessing in a threadpool), ≈ 6 ms CPU per
  image average → ≈ 3 cores busy at 500 req/s → provision ≈ 8 vCPU (2 × `c6i.xlarge`, ≈ US$0.17/h each).
- Ports: gateway **8080**; Triton HTTP **8000**, gRPC **8001**, metrics **8002**. Health:
  gateway `/healthz` (liveness) and `/readyz` (readiness: Triton model ready); Triton
  `/v2/health/live`, `/v2/health/ready`. API: `POST /v1/classify?top_k=5` with raw image bytes body
  (`Content-Type: image/jpeg|image/png|image/webp`), response
  `{"model_version": "...", "predictions": [{"label": "...", "score": 0.83}, …], "latency_ms": 41.2}`.
  Errors: 400 bad image, 413 too large, 415 unsupported type, 503 Triton unavailable (with
  `Retry-After`), 504 inference timeout.
- Env vars: `TRITON_URL` (default `localhost:8000`), `MODEL_NAME` (`classifier`), `MODEL_VERSION`
  (string reported back, e.g. `2026-09-01-resnet50-fp16`), `INFER_TIMEOUT_S` (`0.15`), `LABELS_PATH`.
- Prediction logging: one JSON line per request to stdout (request_id, model_version, top-k ids +
  scores, latency, image sha256 prefix, source) → Fluent Bit → S3 (Parquet via Firehose/Glue) for
  monitoring and labeling. 1 % of requests sampled as REFERENCES (request_id + sha256 ≈ 10 MB/day; the
  photo stays in the product's storage); only the ≈ 5k/month selected for human labeling or the golden
  set are copied (no EXIF, restricted bucket with lifecycle).
- Monthly cost (approx, on-demand): 2 × g4dn.xlarge ≈ US$768; 2 × c6i.xlarge ≈ US$248; EKS control
  plane ≈ US$73; ALB ≈ US$500 (LCUs billed by processed bytes: ≈ 2 TB/day of images at ≈ 200 KB);
  logs/metrics/S3 ≈ US$100; **infra ≈ US$1.75k/month**; labeling (≈ 5k images/month by humans)
  ≈ US$250–500 → **≈ US$2.0–2.3k/month total**, under budget.
- Online metric: **category-suggestion acceptance rate** (seller keeps one of the suggested
  categories); guardrails: p99 latency, % listings re-categorized later by moderators, form
  completion time.

## 8b. Case c02 — shared facts (both c02 agents MUST use exactly these)
Scenario: a logistics company with **25 distribution centers × 40 IP cameras = 1,000 cameras**. Goal:
detect **people and vehicles in restricted zones** (after-hours perimeter, forklift aisles, fire lanes)
and raise alerts to a central **monitoring center (SOC)** within seconds; store short clips as evidence.
Existing NVRs keep recording continuously (not our job). Not a people-identification system: no face
recognition.
- Cameras: RTSP, H.264. Main stream 1080p @ 15 fps ≈ 4 Mb/s (est.) → 40 cams ≈ 160 Mb/s per site
  (same as m02's edge example) ≈ 1.73 TB/day per site. A **second stream configured at 1080p @ 5 fps
  (≈ 1.5 Mb/s, est.)** is the one we analyze: decode only what we use.
- Inference: detection at **5 fps per camera** + multi-object tracking between detections →
  40 × 5 = **200 frames/s per site**; fleet 5,000 frames/s.
- Detector: a light YOLO-class model (≈ 10–30 M params), 640×640 input, TensorRT INT8/FP16. **Assumed
  measured max ≈ 400 frames/s per L4** at this input (est. — measure with trtexec/perf_analyzer or
  DeepStream's own FPS output) → planned 70 % ≈ 280 frames/s → **1 L4 per site** at ≈ 50 % of the
  measured max. (m03's heavier detector at ≈ 250 frames/s would run at 80 % → too hot: model choice matters.)
- Architecture: **hybrid**. Edge box per site (1U server with **1× NVIDIA L4**, ≈ US$10k est.) running
  **NVIDIA DeepStream** (decode on NVDEC, streammux batch of 40, primary detector, tracker, zone
  analytics, message broker) → local **event forwarder** (zone rules + dwell debounce ≈ 1.5 s,
  idempotent event ids, store-and-forward queue, clip upload via presigned URL) → **cloud**: event
  ingestion API (FastAPI, auth per site, idempotent upsert) → queue (SQS) → **verifier** (heavier
  detector at higher resolution on 3 key frames, 1–2 × L4 g6.xlarge always on) → alert service to SOC
  → S3 clips (30-day retention) → labeling of false alarms → retraining → **OTA rollout** to edge boxes
  by waves (canary sites first).
- Alert SLO: **p95 ≤ 5 s** from the person entering the zone to the alert on the SOC screen (includes
  the 1.5 s dwell); edge per-frame processing ≤ 300 ms. Availability of alerting per site 99.5 % (edge
  box is a single point of failure → heartbeat alert; critical sites may get a second box).
- Alert quality: recall of real intrusions ≥ 95 %; precision of alerts reaching the SOC ≥ 90 % after
  cloud verification; SOC capacity ≈ 4 operators at night → fleet-wide budget ≈ 50 alerts/hour.
  Candidate events from the edge before verification ≈ 250/hour fleet-wide at night peak (est.).
- Uplink per site: events-only ≈ a few MB per event (10 s clip at 4 Mb/s ≈ 5 MB + 3 key frames ≈ 300 KB
  each) vs streaming everything (≈ 60 Mb/s per site for the 5 fps streams, 1.5 Gb/s fleet ≈ 16 TB/day).
- Costs (approx, est.): edge capex ≈ US$250k (25 × US$10k) → ≈ US$6.9k/month amortized over 36 months,
  power ≈ 300 W per box; cloud ≈ US$1–2k/month (verifier 1–2 × g6.xlarge ≈ US$0.805/h, S3, API, queue).
  All-cloud alternative: 5,000 / 280 ≈ 18 L4 + N+1 = 19 × g6.xlarge ≈ US$11.2k/month in GPUs alone,
  plus video ingest (e.g. Kinesis Video Streams, per-GB pricing — verify) and dedicated uplinks at
  every site.
- Reference files (reference/c02/): edge/deepstream/ds_app_config.txt, edge/deepstream/
  config_infer_primary.txt, edge/docker-compose.yml, edge/forwarder/{app.py, rules.py,
  requirements.txt, tests/test_rules.py}, cloud/api/{main.py, requirements.txt, tests/test_api.py},
  cloud/k8s/verifier.yaml, cloud/monitoring/alerts.yml, README.md.

## 8c. Case c03 — shared facts (both c03 agents MUST use exactly these)
Scenario: an **auto-parts plant in Nuevo León** (stamped/machined metal brackets for an automaker).
Two different problems that share a platform — a senior splits them:
(A) **defect inspection on the line** (hard real time, integrated with the PLC to reject parts) and
(B) **PPE compliance** on the plant floor (soft real time, privacy-sensitive).
- Lines: **4 lines**, each **2 parts/s** (120/min), 2 shifts × 8 h = 16 h/day → **115,200 parts/line/day**
  (460,800 plant-wide). Defect rate ≈ **0.5 %** → ≈ 576 defects/line/day; 4 defect types (crack, burr,
  missing hole, deformation).
- Inspection station per line: 5 MP mono global-shutter GigE Vision camera (2448 × 2048 × 1 B ≈ 5.0 MB
  per image, ≈ 40–45 ms over 1 GigE), strobe lighting, photo-eye trigger; **Jetson Orin NX 16 GB** per
  line running TensorRT (engine built for the exact JetPack 6 / L4T r36 on the device).
- Timing: conveyor 0.6 m/s, camera → reject gate 0.3 m → **500 ms** from trigger to gate. Budget:
  acquisition + transfer ≈ 50 ms, preprocessing ≈ 20 ms, inference ≤ 120 ms (est. — measure with
  trtexec on the device), decision + PLC write (Modbus TCP) ≈ 10 ms; **hard decision deadline 350 ms**
  after the trigger (150 ms left for the gate). If no decision by the deadline → **fail-safe: divert
  the part to the manual-inspection bin** (never pass it).
- Models: anomaly detection trained on good parts (≈ 2,000 good images, ≈ 300 defect images at start)
  + a supervised defect classifier as labeled defects accumulate. Metrics: recall per defect type at
  a fixed false-positive rate. Don't explain model internals.
- Error costs (est., contract-dependent): a **false negative** (defect shipped to the automaker) ≈
  US$2,000–10,000 per escape incident (containment, chargebacks, PPM scorecard); a **false positive**
  (good part diverted) ≈ US$0.05–0.10 of re-inspection labor. Manual re-inspection capacity ≈ 1 part
  every 15 s per inspector (1 per line) → 3,840/day per line → false-positive budget ≤ (3,840 − 576) /
  115,200 ≈ 2.8 %; **target FP rate ≤ 1.5 %** with **recall ≥ 99.5 %** per defect type → thresholds
  chosen by expected cost under that recall constraint.
- PPE: **12 area cameras** 1080p, analyzed at **2 fps** (24 frames/s total) on **1 Jetson AGX Orin 64 GB**
  with DeepStream; detect helmet, safety vest, glasses in hazard zones; alert to the shift supervisor's
  tablet within **≤ 10 s** if a person without required PPE stays > 5 s in a hazard zone. Privacy: no
  face recognition, no identity tracking across days, blur faces in stored evidence, aggregate KPIs
  per zone/shift, 7-day retention, notice to workers and agreement with their representatives;
  Mexico's data-protection law (LFPDPPP, new law published in 2025) — general principles only, no
  legal advice.
- Network: plant OT network isolated; devices on an OT VLAN; a DMZ gateway syncs to the cloud with
  store-and-forward (rejected-part images, a sample of passed parts, metrics); the line must run fully
  **offline for ≥ 72 h**.
- Rollout: models/containers delivered through the DMZ from a registry; **shadow mode on one line for a
  full shift** (new model runs alongside, its decisions only logged and compared) → canary line →
  all lines; rollback = keep the previous engine on the device.
- Monitoring: per-line reject rate vs baseline (> 2× for 30 min → likely lighting/lens/focus problem,
  not real defects → alert), anomaly-score distribution drift, **golden-part check at shift start**,
  deadline misses (should be ≈ 0), device temperature/throttling, heartbeats.
- Costs (approx, est.): per inspection station Jetson Orin NX + carrier ≈ US$1–1.5k, camera + lens +
  lighting ≈ US$2–5k, plus PLC integration; PPE box (AGX Orin) ≈ US$2–3k; cloud side small
  (≈ US$200–500/month: storage, API, labeling tool, occasional training jobs).
- Reference files (reference/c03/): edge/inspector/{app.py, decision.py, config.yaml,
  requirements.txt, tests/test_inspector.py}, edge/Dockerfile, edge/docker-compose.yml,
  tools/{choose_threshold.py, build_engine_jetson.sh, tests/test_choose_threshold.py}, README.md.

## 8d. Case c04 — shared facts (every c04 agent and the m12 agent MUST use exactly these)
Scenario: a private **hospital group with 3 pathology labs (A, B, C)** digitizes biopsies and surgical
specimens. Scope: **colorectal H&E slides**. Today a pathologist reviews each slide and, for the
report, estimates by eye the **tumor area and % of tumor in the tissue** (used, among other things,
to decide whether a sample is adequate for molecular testing); estimates vary between pathologists.
Goal: **segment tumor regions** on every whole-slide image (WSI) so that, when the pathologist opens
the case, the viewer already shows an overlay + tumor area (mm²) + % of tissue, which they **accept or
correct before signing**. The pathologist always signs; the system is **assistive (decision support),
never the diagnosis**. Intra-operative frozen sections (minutes) are **out of scope**. Not our job to
redesign the model; regulatory classification (software as a medical device) is legal/clinical
governance's call — we provide traceability and validation evidence, general principles only.
- Scanners: labs A and B use vendor X (**SVS / pyramidal TIFF**, 40× ≈ **0.25 µm/px**, pyramid levels at
  downsample 1, 4, 16 — typical for that format, verify per scanner); lab C uses vendor Y (**DICOM WSI**,
  different color profile). The scanners already upload every WSI to the group's **digital archive in the
  cloud (object storage, S3-like, in the region legal approved)**; the upload link and the archive's
  storage are NOT our cost. Upload completion emits an event (object key + sha256).
- Volume: **≈ 1,200 in-scope WSI/day** across the 3 labs; scanners run ≈ **08:00–22:00** (14 h) → average
  ≈ 86 slides/h, **peak ≈ 170 slides/h** (≈ 2×, est.). Growth: 2 more labs next year (→ ≈ 2,000/day).
- Image size (est.): average tissue ≈ **1.5 cm²** per slide; at 40× that is ≈ 2.4 Gpx (≈ 7.2 GB raw RGB;
  it never fits in RAM as one array); WSI file ≈ **1 GB** (0.5–3 GB depending on tissue and compression).
  The model runs at **20× (≈ 0.5 µm/px)**: there is no 20× level in the SVS pyramid, so each 512×512 tile is
  read as a 1024×1024 region at level 0 and downsampled 2× (4× the decode work — a senior detail).
  Tiles **512×512 with 64 px overlap (stride 448)**, only where a tissue mask (computed on a low-res
  thumbnail) says there is tissue → **≈ 3,000 tiles/slide** (1.5 cm² / (448 × 0.5 µm)² ≈ 2,990).
  → **≈ 3.6 M tiles/day**.
- Model: an existing **U-Net-class segmentation model** (≈ 30 M params, input 512×512 RGB at 20×, output
  a per-pixel tumor probability), trained in PyTorch on the ≈ 400 annotated slides of labs A/B; offline
  **Dice ≈ 0.82** on a held-out set from A/B (assumed); **never validated on lab C (vendor Y)**.
  Served with TensorRT FP16; **assumed measured max ≈ 300 tiles/s per L4** (est. — measure with trtexec)
  → **planned 200 tiles/s per worker** (≈ 70 %).
- CPU side (est.): reading + JPEG decode + 2× downsample ≈ **20 ms CPU per tile** → 200 tiles/s needs
  ≈ 4 busy cores → worker node **g6.2xlarge** (1 × L4, 8 vCPU, 32 GiB, local NVMe; ≈ **US$0.98/h**
  on-demand us-east-1, verify; the spot discount varies a lot by instance type and time — check the spot price history, don't assume a fixed %). The WSI is downloaded to local NVMe
  (≈ 5–10 s per GB with parallel ranged GETs) because the slide readers (OpenSlide / tiffslide) want a
  file.
- Per slide (est.): download 5–10 s + tissue mask ≈ 1 s + tiles 3,000 / 200 ≈ **15 s** of GPU (CPU decode
  overlapped with ≈ 6 reader threads — OpenSlide decodes in C and releases the GIL) + stitch + post-process ≈ 2–3 s → **≈ 20–30 s per slide** →
  ≈ 120–180 slides/h per worker. Daily GPU work: 3.6 M / 200 ≈ 18,000 s ≈ **5 GPU-h/day**.
  Peak 170 slides/h × 3,000 ≈ 510k tiles/h ≈ **142 tiles/s** → 1 worker at ≈ 71 % of plan; **KEDA scales
  0–4 workers on SQS queue depth** (scale to zero at night; cold start ≈ 3–5 min for node + image pull is
  fine against the 60 min SLO).
- SLOs: **turnaround p95 ≤ 60 min** from "WSI available in the archive" to "result visible in the
  viewer"; **99 % of slides scanned before 22:00 are processed before 07:00**. Availability is NOT
  critical (if the system is down, pathologists work as today, and the viewer says "sin resultado de IA"),
  but **integrity is**: a result must never be shown on the wrong slide or with an unknown model version
  (result bound to slide_id + sha256 of the file + model_version; wrong/missing mpp metadata → the slide is
  not processed and is flagged).
- Architecture (names used everywhere): archive upload event → **`slide-jobs` SQS queue** (+ DLQ after 3
  attempts) → **`seg-worker`** (GPU, K8s Deployment, KEDA ScaledObject; download → QC + tissue mask →
  tile → batch infer → stitch with overlap blending → threshold → polygons) → results in object storage
  `results/<slide_id>/<model_version>/` (GeoJSON polygons in level-0 pixel coordinates, low-res heatmap PNG,
  `summary.json` with tumor mm², % of tissue, QC flags, model_version, container digest, preprocessing
  config hash, input sha256) + an index row in Postgres → **`results-api`** (FastAPI, read-only for the
  viewer; also receives the pathologist's corrections) → existing web **viewer** shows the overlay; the
  accepted/corrected final mask is stored as a new **annotation version** (never overwrites the model output).
  Idempotency key = sha256 + model_version + preprocessing config hash (redelivered message → skip).
  Spot interruption / SIGTERM → stop taking messages; an unfinished slide becomes visible again in the
  queue (visibility timeout, extended by a heartbeat while processing).
- Human in the loop & labels: pathologist time is the scarce resource: **20 pathologist-hours/month** for
  labeling at ≈ **US$200/h** (est.) ≈ **US$4k/month** — the **dominant cost of the system**, bigger than
  GPUs. Full polygon annotation of a slide ≈ 30–60 min; correcting a model proposal ≈ 5–10 min; labeling
  one selected region ≈ 1–2 min (est.). → 20 h ≈ 20–40 full slides, or ≈ 120–240 corrections, or
  ≈ 600–1,200 regions. **Active learning** chooses what to label: uncertain regions (e.g. mean pixel entropy
  or margin near the threshold) + diversity (cap per slide, stratified by lab/scanner, all of lab C first).
  Residents can pre-annotate; a pathologist approves. Inter-pathologist agreement on tumor regions:
  **Dice ≈ 0.75–0.85** (est., varies by tissue) → the ceiling for what the model can be measured against.
  Corrections from sign-out are free labels but biased: **"accepted without edits" ≠ correct**
  (automation bias) → a monthly random audit sample is annotated independently.
- Evaluation: **golden set of 100 slides** (stratified by lab, scanner, specimen type; annotated by 2
  pathologists + consensus; frozen; never used for training) + a monthly temporal set. Offline metrics
  per slice (lab, scanner, specimen type, stain batch): pixel **Dice**, **tumor-% absolute error ≤ 5
  points**, **lesion-level sensitivity for foci ≥ 1 mm ≥ 95 %** at ≤ 1 false-positive region per slide
  (targets, est.), calibration of the probabilities. Before enabling lab C: **silent mode** (runs, results
  hidden) + ≥ 30 annotated lab-C slides. Online (no classic A/B on patients without clinical
  governance approval): silent/shadow period, then assistive mode per lab; metrics: pathologist
  **major-edit rate** (area changed > 20 %), review time per slide, turnaround, % of slides with QC flags.
- Monitoring (the m12 agent uses this as its running example next to c01): system — queue age of the
  oldest message > 30 min, DLQ > 0, turnaround SLO burn, GPU util, worker errors; data — per-lab/scanner
  **stain color statistics** (PSI > 0.2 on tissue color histograms vs the training reference), % of
  out-of-focus tiles (blur) per scanner, tissue area, missing/odd mpp; model — distribution of predicted
  tumor % per lab, mean confidence, and the delayed-but-strong label: **pathologist major-edit rate** over
  4 weeks vs baseline. Retraining: monthly with new corrections + active-learning labels, or triggered by
  drift / a new lab or scanner; gate: no slice worse than production by more than its CI (e.g. Dice
  −0.02), lesion sensitivity target met on the golden set.
- Privacy & traceability: health data = sensitive personal data (Mexico: LFPDPPP; US: HIPAA — general
  principles only, no legal advice). WSI files carry a **label image and macro image** (the slide label
  can show patient name / barcode) and metadata → strip them before any training/labeling copy;
  pseudonymized ids; least-privilege access; every access and result logged (append-only audit log,
  object lock); per result: model_version, training dataset version, container digest, preprocessing
  config hash, input sha256, reviewer, timestamps. Retention follows the lab's clinical-records policy
  (legal decides).
- Monthly cost (approx, on-demand, est.): GPU busy time ≈ 1,200 × 25 s ≈ 8.3 worker-h/day, but that is work,
  not billed time: slides arrive every ≈ 42 s from 08:00 to 22:00 and KEDA's cooldownPeriod is 15 min, so the
  first worker stays up the whole scanning window (≈ 14.25 h) + cold starts + a second worker in bursts →
  **≈ 15 billed node-h/day** (est.) ≈ 450 h × US$0.98 ≈ **US$440** (spot: depends on the real discount; at
  25–70 % off it saves ≈ US$110–310; ≈ 25 % was observed on g6 in us-east-1, oct-2026, see M13); reprocessing/backfills for shadow evaluation of candidate
  models ≈ US$70; training ≈ US$200; EKS control plane ≈ US$73; CPU nodes (results-api, jobs) ≈ US$150;
  Postgres (managed, Multi-AZ, small) ≈ US$200; results storage (≈ 5 MB/slide → ≈ 180 GB/month,
  cumulative) + logs/metrics ≈ US$100 → **infra ≈ US$1.2k/month**; pathologist labeling ≈ **US$4k/month**
  → **≈ US$5.2k/month total** (≈ 76 % expert time). Budget answer: infra ≤ US$2k/month + the 20 h/month of pathologists.
- Reference files (reference/c04/): worker/{tiling.py (pure: level selection by mpp, tissue-mask tile
  grid with overlap, stitching with blending, polygon-free summary math), worker.py (SQS-style loop with
  idempotency, heartbeat, SIGTERM, DLQ semantics, atomic result write, behind interfaces for queue /
  storage / slide reader / model so tests run without AWS or GPU), requirements.txt,
  tests/{test_tiling.py, test_worker.py}}, worker/Dockerfile, k8s/seg-worker.yaml (Deployment + KEDA
  ScaledObject on SQS), loop/{select_for_labeling.py (active learning under an hours budget),
  tests/test_select.py}, monitoring/alerts.yml (Prometheus rules), README.md.

## 8e. Case c05 — shared facts (every c05 agent MUST use exactly these)
Scenario: a Mexican **SME lending platform** (créditos PyME). Customers upload documents during
onboarding and loan applications; today a team of **45 data-entry staff (capturistas)** types the fields
into the core system: turnaround 24–48 h, the bottleneck of the loan funnel. Goal: automate capture,
send to humans **only the doubtful fields**, keep accuracy. Identity-fraud checks (liveness, document
authenticity) are done by an existing KYC vendor — **out of scope**; we extract and validate fields.
- Document mix and volume: **≈ 5,000 documents/day** (average over 30 days incl. weekends), month-start
  peaks ≈ 2×. Uploads 08:00–22:00. Mix (est.): CFDI invoices (facturas) 35 % (≈ 1.5 pages), INE voter
  ID front+back 25 % (2 images), proof of address (comprobante de domicilio: CFE, Telmex, water…) 15 %
  (1 page), bank statements 10 % (≈ 8 pages), loan application forms 15 % (3 pages; ≈ 30 % of forms have
  handwritten fields) → **≈ 2.4 pages/doc → ≈ 12,000 pages/day** (≈ 24k at peak).
- Sources: ≈ 50 % of INE and proofs of address are **phone photos** (skew, glare, blur, cropped);
  bank statements and CFDI PDFs are mostly **digital-born PDFs with a text layer** (no OCR needed); forms
  are scans or photos.
- **CFDI = Mexican e-invoice**: every CFDI 4.0 has an XML (namespace `http://www.sat.gob.mx/cfd/4`,
  UUID in the `tfd:TimbreFiscalDigital` complement) and its printed PDF carries a QR with UUID, RFCs and
  total; SAT exposes a public status check (vigente/cancelado — verify the current service). Senior move:
  **ask for the XML (or read the QR) instead of OCR-ing the PDF** — the best model is no model. Assume
  ≈ 60 % of invoices arrive with XML.
- Pages that need OCR (est.): ≈ 6,200/day (≈ 51 %): INE 2,500, forms 2,250, statements 800 (the ≈ 20 %
  scanned), proofs of address ≈ 375, invoices ≈ 260 → ≈ **186k OCR pages/month**.
- Pipeline (names used everywhere): `docs-api` (FastAPI) upload → raw object storage (S3, KMS) +
  **sync quality gate ≤ 3 s p95** (type/size/page limits, sha256 dedupe, blur via variance of Laplacian,
  glare, resolution, document boundary → immediate "súbelo de nuevo" to the customer) → **orchestration
  with AWS Step Functions (Standard)** per document (retries with backoff, Catch → failure state, the
  human-review step uses `waitForTaskToken`) → stages: **classify** (doc type + page roles; small model on
  CPU) → **text acquisition** (CFDI XML parse | PDF text layer | OCR: managed text-detection API, words +
  boxes + confidence) → **extract** (per doc type: a layout-aware token-classification model fine-tuned on
  our documents, ONNX Runtime **on CPU** — throughput is tiny, ≈ 0.6 pages/s at peak; + rules/regex for
  structured fields; INE back has an MRZ-like zone) → **validate** (format + check digits: CURP, RFC
  homoclave, CLABE; cross-field: subtotal + IVA − retenciones = total; cross-document: name on INE ≈ name
  on the application; external: SAT CFDI status) → **route** (per-field calibrated confidence vs per-field
  threshold; the doc is straight-through (STP) only if every required field is accepted and every
  validation passes; otherwise a review task with only the flagged fields, prioritized by SLA and loan
  stage) → **review UI** (the capturistas become reviewers; corrections are labels) → Postgres records with
  provenance per field (page, bbox, source stage, model version, confidence) → core system.
- Model licensing trap: some popular document-model weights are **non-commercial** (e.g. LayoutLMv3 —
  verify); pick a commercially licensed model (verify licenses) — a senior asks.
- Vision LLM option: allowed only as a fallback for long-tail layouts, with **grounding** (every extracted
  value must match OCR tokens on the page, else review), through a provider contract with zero data
  retention, and **never for INE images** (policy decision). Cost and latency per page to verify.
- Targets: field accuracy on auto-accepted fields **≥ 99.5 %** (critical fields CURP, RFC, CLABE,
  amounts ≥ 99.9 %); **STP ≥ 60 % of documents at launch → 80 % in 12 months**; turnaround: STP docs
  **p95 ≤ 2 min**, reviewed docs **p90 ≤ 4 business hours**; `docs-api` availability 99.9 %
  (customer-facing); the async pipeline may lag but never loses a document.
- People and time (est.): manual capture ≈ 4 min/doc (≈ 15 docs/h); reviewing only flagged fields with
  image crops ≈ 45 s/doc; full audit of an STP doc ≈ 2 min; QA audits a random **2 % of STP docs**.
  Capturista fully loaded cost ≈ US$800/month → today ≈ 45 × 800 ≈ **US$36k/month**.
- Labels: ≈ 2 years of manual captures (≈ 1.2 M documents) = **typed values without boxes** (weak labels:
  align them to OCR tokens by fuzzy matching to build token labels) with ≈ 1–2 % typing errors (est.);
  a **gold set of 2,000 documents** double-keyed by two capturistas + adjudication, stratified by doc type
  and source (photo/scan/digital); reviewer corrections feed retraining.
- Costs (approx, est., verify prices): managed OCR text detection ≈ US$1.50 per 1,000 pages → ≈ US$280/
  month (forms/tables/queries APIs cost ≈ 10–40× more per page — the trade-off to discuss); extraction on
  CPU (2 pods for HA) + `docs-api` + classifier ≈ US$300; Step Functions (≈ 10 transitions/doc ≈ 1.5 M/
  month at ≈ US$0.025 per 1,000) ≈ US$40; Postgres + S3 + logs ≈ US$400 → **infra ≈ US$1.0–1.5k/month**;
  humans (reviewers + QA) dominate.
- Privacy: INE, CURP, addresses, bank data = personal data (Mexico: LFPDPPP, new law 2025 — general
  principles only); encryption, least privilege, PII redaction in logs, retention per the lender's
  policy (legal decides), managed OCR in the same cloud account/region under the provider's terms.
- Alert names (narrative + reference files): `DocPipelineBacklog`, `StageErrorRateHigh`,
  `STPRateDrop`, `AuditFieldAccuracyLow`, `OCRConfidenceShift`, `ReviewSLABreach`, `SATValidationDown`,
  `QualityGateRejectSpike`.
- Reference files (reference/c05/): pipeline/{validators.py (CURP, RFC, CLABE check digits, CFDI totals,
  dates), cfdi.py (parse CFDI 4.0 XML → fields + UUID), quality.py (numpy: variance of Laplacian, glare,
  resolution), routing.py (per-field thresholds → STP or review task with flagged fields + priority),
  calibrate_thresholds.py (per-field threshold for a target accuracy on a labeled CSV, with a Wilson lower
  bound), requirements.txt, tests/}, api/{main.py (FastAPI upload: limits, sha256 dedupe, sync quality
  gate, start execution behind an interface), requirements.txt, tests/}, orchestration/
  statemachine.asl.json (Step Functions definition: Retry/Catch, waitForTaskToken review), monitoring/
  alerts.yml, README.md.

## 8f. Case c06 — shared facts (every c06 agent MUST use exactly these)
Scenario: a **social network** where users publish posts (text, optionally images) and comments.
Detect content that violates the policies and act on it. Video, live streams, DMs and ads are **out of
scope** (mention them as extensions). Account-level enforcement (strikes, bans) exists and consumes our
decisions.
- Volume: **30 M posts/day** (40 % with images, avg 1.5 images → **18 M images/day**) + **150 M
  comments/day** (text) → 180 M text items/day ≈ 2,083/s average, **peak ≈ 3× ≈ 6,250 text items/s**;
  images ≈ 208/s average, **peak ≈ 625 images/s**. Posts 347/s average (≈ 1,040/s peak).
- Policies — exactly 7 ids, as in reference/c06/decision/policies.yaml (hate speech and harassment merge into
  one policy; credible threats and graphic violence into one) — and severity tiers: **S0 zero tolerance** (CSAM — handled by hash matching against
  industry hash lists and legal reporting obligations, e.g. NCMEC in the US; a specialized team, no ad-hoc
  training; violent extremism/terrorist content), **S1 high** (credible threats, self-harm promotion,
  graphic violence), **S2 medium** (hate speech, harassment, adult nudity), **S3 low** (spam/scams,
  borderline) — exact mapping per policy is the narrative's choice; actions: block pre-publication, remove,
  reduce distribution / interstitial warning, age-gate, send to review. Overall prevalence of violating
  items ≈ 0.5 % (est.), spam is most of it.
- Sync vs async: a **pre-publication check with p99 ≤ 150 ms** added to post/comment creation (hashes +
  rules + cheap models) and **async deep scoring with p95 ≤ 5 min**; user reports and virality re-trigger
  scoring. If the sync check fails or times out: **fail open for S1–S3** (publish, score async; S1 also gets
  local fallback rules that only reduce/send to review, plus high-priority deep scoring); the S0 *model*
  signal also fails open (high-priority deep scoring). Only the **S0 hash check** fails closed: it runs
  in-process/local so it never depends on a remote call (narrative explains).
- Cascade (names used everywhere): `mod-gateway` (sync API called by post-service and comment-service) →
  stage 0 **`hash-match`** (perceptual hashes — PDQ for images, 256 bits, Hamming distance threshold;
  verify the recommended value — against known-bad lists and our own removed content; exact/near-dup text
  hashes; URL/domain blocklists; rate rules) → stage 1 **fast models** (multilingual distilled text
  classifier, multi-label per policy; light image classifier; served on Triton) → **`decision-engine`**
  (per policy × severity × surface thresholds from a **versioned policy config**; actions; statement of
  reasons) → Kafka topic `mod-events` → stage 2 **`deep-scorer`** async (larger multimodal model incl. text
  in images/OCR for memes) only for items whose stage-1 score exceeds a low threshold (**≈ 3 % of items**,
  est.) → **`review-router`** (priority = P(violation) × severity weight × predicted views in the next
  hours; SLA aging) → review tool → decisions = labels → appeals service (a different reviewer) →
  enforcement service.
- Capacity (est., measure): stage-1 text model ≈ 3,000 items/s per L4 (≤ 128 tokens, batched) → planned
  70 % = 2,100/s → 6,250 / 2,100 → 3 + 1 (N+1, multi-AZ) = **4 L4**; stage-1 image model ≈ 1,500 img/s
  per L4 → 625/s → 1 + 1 = **2 L4**; stage 2 ≈ 100 items/s per L4 (planned 70/s); 3 % of 180 M =
  5.4 M/day ≈ 62.5/s average, ≈ 190/s at peak → async: sized for the sustained daily peak (≈ 190/s)
  without N+1 or burst headroom; bursts above it wait in Kafka (bounded backlog): **4 L4** (≈ 280/s
  planned); GPUs ≈ 10 × g6.xlarge ≈ US$0.80/h ≈ **US$5.9k/month**
  on-demand (verify).
- Human review (est.): **≈ 600 moderator seats covered every day** (vendor + in-house, 3 shifts; the
  vendor covers rest days, so real headcount is ≈ 1.4× larger), ≈ 60 items/h each over ≈ 6
  productive h → **≈ 216k reviews/day capacity** → routing thresholds must keep review arrivals
  ≤ ≈ 200k/day (≈ 0.11 % of items); cost ≈ US$1,500/month per seat (est., includes that coverage, varies
  by country) ≈
  **US$900k/month** — humans dominate cost by ≈ 50–100× over infra. Moderator wellbeing (exposure
  limits, blurring/grayscale by default, rotation, counseling) is part of the design.
- Metrics: **prevalence** (share of views on violating content, measured by a random sample of viewed
  items labeled by humans — not by the model), **proactive rate** (actioned before any user report),
  precision/recall per policy (recall from the random sample), **time to action** / views before action,
  **appeal overturn rate**, reviewer agreement, and fairness checks across languages/dialects.
- SLOs: `mod-gateway` p99 ≤ 150 ms and availability 99.95 % (fail-open covers it); deep scoring p95 ≤ 5
  min; S1 user reports reviewed p90 ≤ 1 h; S0 matches actioned immediately.
- Labels and drift: reviewer decisions are biased (only what was flagged) → random-sample labeling for
  evaluation; labels carry the **policy version** (definitions change); adversaries adapt in days
  (homoglyphs, spacing, text inside images, perturbations to evade hashes) → frequent retraining + new
  hashes of removed content; a new policy can launch in days with an **LLM classifier prompted with the
  policy** as a stopgap (cost/latency only for the stage-2 slice), its outputs verified by humans, then
  distilled into the fast model.
- Regulation (general principles, no legal advice): EU **Digital Services Act** (notice and action,
  statement of reasons, appeals, transparency reports — verify obligations by service size), US legal
  reporting of CSAM; Mexico has no equivalent platform law (verify, hedge).
- Alert names (narrative + reference files): `ModGatewayLatencyHigh`, `ModFailOpenRateHigh`,
  `DeepScorerBacklog`, `ReviewQueueAging`, `PolicyScoreShift`, `HashListStale`, `AppealOverturnRateHigh`,
  `ProactiveRateDrop`.
- Reference files (reference/c06/): decision/{policies.yaml (versioned thresholds per policy × severity ×
  surface → action), engine.py (combine cascade scores, apply thresholds, fail-open rules, statement of
  reasons), requirements.txt, tests/}, hashing/{match.py (256-bit hashes, Hamming distance with numpy,
  bucketed multi-index search), tests/}, review/{priority.py (harm-based priority + SLA aging +
  capacity-aware routing), tests/}, eval/{prevalence.py (prevalence and per-policy precision/recall from
  stratified samples with CIs), tests/}, gateway/{main.py (FastAPI sync endpoint with a time budget and
  fail-open behind interfaces), tests/}, monitoring/alerts.yml, README.md.

## 8g. Case c07 — shared facts (every c07 agent MUST use exactly these)
Scenario: **the same second-hand marketplace as c01** (sellers upload photos; c01 suggests the category).
Users must find listings by **describing what they want** ("chamarra de mezclilla vintage talla M") or by
**uploading a photo** ("algo como esto"). Today search is keyword-only (BM25 in OpenSearch) with many
zero-result and vocabulary-mismatch queries. Not our job to design the embedding model internals.
- Catalog: **≈ 100 M active listings** (≈ 4 photos each); **≈ 2.5 M new listings/day** (consistent with
  c01's 10 M images/day ÷ 4) and about the same number leaving (sold/expired/removed) — steady state.
  New listings ≈ 29/s average, ≈ 90/s peak.
- Queries: **≈ 50 M searches/day** → ≈ 579/s average, **peak ≈ 3× ≈ 1,750 QPS**; **≈ 5 % are photo
  queries** (≈ 90/s at peak). Results: top 48 per page, with filters (category, price, city/shipping,
  condition) that must be honored.
- Embeddings: a **CLIP-class dual encoder** (image and text towers in a shared space), fine-tuned on the
  marketplace's own (title, photo) pairs and click logs; **d = 512**, L2-normalized; **one vector per
  listing** = normalized average of the main-photo embedding and the title+attributes text embedding
  (simple, one index; per-photo vectors are discussed as an alternative ×4 memory).
- Index memory (compute in the case): 100 M × 512 × 4 B = **204.8 GB FP32**; FP16 102.4 GB; **int8
  scalar quantization 51.2 GB**; **PQ with 64-byte codes 6.4 GB**; HNSW graph links add ≈ M×2×4 B per
  vector at layer 0 (M = 32 → ≈ 256 B → ≈ 25.6 GB, est.). Design decision: **HNSW over int8 vectors,
  4 shards × 25 M vectors** (≈ 12.8 GB vectors + ≈ 6.4 GB graph ≈ 19 GB per shard, est.), each shard with
  **2 replicas**, scatter-gather; top-200 candidates rescored with the exact float vectors (kept on
  EBS gp3 and served from the page cache: r7i has no instance store, so a new or restarted copy pre-warms;
  local NVMe, e.g. r6id, is the cost lever that removes the pre-warm); IVF-PQ discussed as the memory-cheap alternative (and its recall cost).
- Hybrid: ANN (semantic) and BM25 (keyword: brands, model numbers, exact sizes) **in parallel**, fused
  with **Reciprocal Rank Fusion (k = 60)**, filters applied inside the ANN search when possible (filtered
  HNSW / pre-filter by shard partition) — post-filtering trap (filter after top-k → empty pages for
  selective filters); optional **cross-encoder reranker** for text queries (GPU); the case's design choice is the **top-30**
  (top-100 discussed and rejected on cost).
- Latency SLO (server-side): **text query p99 ≤ 300 ms**, **photo query p99 ≤ 600 ms** (incl. image decode
  + encoding); budget (est.): text encode ≈ 10 ms GPU, ANN ≈ 20 ms per shard (parallel), BM25 ≈ 40 ms
  (parallel), fusion + filters ≈ 10 ms, rerank top-30 ≈ 25 ms (top-100 would be ≈ 60 ms), overhead.
- Freshness: a new listing is **searchable within p95 ≤ 5 min** (Kafka `listing-events` → `embed-worker`
  GPU → upsert); a **sold/removed listing must disappear within ≤ 1 min** → availability filter from a
  fast store (tombstones) at query time, because HNSW deletes are expensive (mark deleted + periodic
  shard rebuild).
- Re-embedding the catalog when the model changes (est.): image tower ≈ 2,000 img/s per L4 at 224×224
  (measure) → 100 M main photos ≈ 50,000 GPU-s ≈ **14 GPU-h** (≈ 1.7 h on 8 L4 spot) + text tower +
  index build → **blue/green index** (build the new index aside, shadow-compare, swap an alias); vectors
  of different model versions are NEVER mixed in one index.
- Capacity (est., measure): query text encoding ≈ 5,000 queries/s per L4 (short text) → the peak
  ≈ 1,660 text QPS + ≈ 90 photo QPS fit in 1 L4 + N+1 (shared pool). The **reranker is the GPU cost
  driver**: a small cross-encoder ≈ 10,000 (query, doc) pairs/s per L4 (est., ≤ 64 tokens) → planned 70 %
  ≈ 7,000/s; top-100 at 1,660 QPS = 166k pairs/s ≈ 24 L4 — too expensive → rerank the **top-30** (≈ 50k
  pairs/s ≈ 7.1 L4 at the planned rate → 8 L4; a query cache gives extra margin) or only head queries; the narrative justifies the choice. ANN shards on
  memory-optimized CPU instances (e.g. r7i family — verify RAM and prices).
- Evaluation: offline query sets from logs (head/torso/tail), graded human relevance labels (0–3),
  **NDCG@10**, recall@k; **ANN recall@100 vs exact brute force ≥ 0.95** on a canary query set; online:
  search CTR, contacts-with-seller per search, zero-result rate, query reformulation rate; A/B (and
  interleaving for ranking changes → #m11.interleaving-bandits).
- Alert names: `SearchLatencyHigh`, `ZeroResultRateHigh`, `IndexFreshnessLag`, `SoldItemsServed`,
  `ANNRecallDrop`, `EmbedWorkerBacklog`, `SearchCTRDrop`, `ShardMemoryHigh`.
- Reference files (reference/c07/): indexing/{embed_worker.py (consume listing events through an
  interface: create/update → embed → upsert with model_version; sold/removed → tombstone; idempotent by
  listing_id + version), build_index.py (FAISS on synthetic vectors: HNSW and IVF-PQ, measure recall@k vs
  brute force, memory and latency — runs on CPU with small N), requirements.txt, tests/}, search/{api.py
  (FastAPI: text or photo query → encoder interface; ANN and BM25 interfaces in parallel with timeouts;
  RRF; filters; tombstone filter; optional rerank; fallbacks: BM25-only if ANN times out),
  fusion.py (RRF), requirements.txt, tests/}, eval/{offline_eval.py (recall@k, NDCG@10 with graded labels),
  tests/}, monitoring/alerts.yml (+ promtool tests), README.md.

## 8h. Case c08 — shared facts (every c08 agent MUST use exactly these)
Scenario: **the same marketplace (c01, c07)**: the app's **home screen** shows each user a personalized
feed of listings. Today it shows "recientes en tu ciudad" + popular items. Goal: more **contacts with
sellers / purchases** (the business value), not just clicks.
- Scale: **≈ 30 M DAU**, ≈ 3 home loads per user per day → **≈ 90 M home requests/day ≈ 1,042 RPS
  average, peak ≈ 3× ≈ 3,100 RPS**; each response = 50 listings (first screen shows ≈ 10; infinite scroll
  asks for more pages). Catalog ≈ 100 M active listings with ≈ 2.5 M new/day (c07 facts).
- Funnel (names used everywhere): `home-api` → **candidate generation in parallel** (≈ 1,000 total):
  two-tower ANN on the user embedding (≈ 500; item tower embeddings indexed like c07), item-to-item
  **co-visitation** from the user's recent views (≈ 300), trending/popular in the user's city (≈ 100),
  followed sellers / saved searches (≈ 100) → **filter** (sold, blocked, already seen many times, geo/
  shipping) → **ranker** (multi-task DNN, ≈ 10 M params: P(click), P(contact|click); ≈ 300 features of
  user, item, context and cross features) → **re-ranker** (diversity caps per category/seller, freshness
  boost, **exploration slots ≈ 5 %**, business rules) → 50 items; impressions logged with request_id
  and the **feature snapshot used at serving** (log-and-wait to avoid training-serving skew →
  #m09.skew).
- Latency SLO: **p99 ≤ 200 ms server-side**; budget (est.): retrieval ≈ 40 ms (parallel sources),
  feature fetch ≈ 40 ms (batch get of ≈ 1,000 items × features + user features — the hidden cost), ranking
  ≈ 60 ms, re-rank ≈ 10 ms, overhead ≈ 30 ms (context + in-process) = 180 ms internal budget of home-api; the
  remaining ≈ 20 ms of the SLO are margin for event-loop queueing and serializing/writing the response
  (network and LB are outside this server-side SLO); each source has its own timeout and the feed is
  served with whatever sources answered; total failure → cached popular-in-city fallback.
- Ranking compute (est., measure): 3,100 RPS × 1,000 candidates ≈ **3.1 M item-scores/s at peak**;
  ranker on GPU with Triton ≈ 1.5 M item-scores/s per L4 (measure) → planned 70 % ≈ 1.05 M/s → 3 + 1
  (N+1) = **4 L4**; alternative: a light pre-ranker cuts to 300 candidates (≈ 0.93 M/s). GBDT on CPU is
  discussed as the simpler baseline (estimate cores with ≈ 10 µs per item, est.).
- Online feature store (est.): item features ≈ 1 KB × 100 M ≈ 100 GB; user features ≈ 2 KB × 30 M DAU
  (+ inactive users) ≈ 60–100 GB → in-memory key-value cluster (Redis-class) with replicas; real-time
  features (last 50 user actions, item click/contact counters over 1 h/24 h) from Kafka + a stream
  processor (Flink-class) with freshness ≤ 1 min.
- Training data (est.): ≈ 90 M requests × ≈ 10 viewed items ≈ **900 M impressions/day**; labels: click
  (same session) and **contact with seller within 24 h (delayed label)**; position bias (log position;
  exploration traffic for unbiased estimates); daily incremental training of the ranker, weekly
  two-tower retraining + re-indexing of item embeddings (blue/green like c07).
- Cold start: new users → onboarding categories + city + popular; new listings → content embedding from
  c07's CLIP vectors mapped into the item tower / content-based candidates + exploration boost.
- Objective and metrics: primary online metric **contacts with sellers per DAU** (proxy of transactions);
  guardrails: D7 retention, home latency, diversity, **new-seller exposure** (marketplace health), %
  sold items shown; offline: recall@k of retrieval sources, NDCG / AUC of the ranker per slice (new vs
  returning users, city size). A/B: **user-level randomization**, 1 % relative lift on contacts/DAU —
  compute the sample size; marketplace interference (sellers shared across arms) → mention
  seller-side/cluster designs (hedged).
- Alert names: `HomeLatencyHigh`, `CandidateSourceTimeouts`, `FeatureStoreStale`, `RankerScoreShift`,
  `HomeFallbackRateHigh`, `ContactsPerDAUDrop`, `ImpressionLogLag`, `ExplorationTrafficOff`.
- Reference files (reference/c08/): serving/{home_api.py (FastAPI: sources in parallel with per-source
  timeouts behind interfaces, merge + dedupe, filters, feature fetch interface, ranker interface,
  re-rank, fallback, impression log with feature snapshot), rerank.py (diversity caps + exploration slots,
  deterministic with a seed per request), requirements.txt, tests/}, retrieval/{covisitation.py
  (item-item co-visitation counts from sessions with time decay and top-k per item), tests/},
  training/{build_training_set.py (point-in-time join of impressions with delayed labels — contact within
  24 h — no leakage), tests/}, eval/{ab_sample_size.py (users per arm for a relative lift on a per-user
  metric with given mean/variance), offline_metrics.py (recall@k, NDCG@k, AUC), tests/},
  monitoring/alerts.yml (+ promtool tests), README.md.

## 8i. Case c09 — shared facts (every c09 agent MUST use exactly these)
Scenario: a **Latin American payment platform (PSP)** that processes **card-not-present online payments**
for merchants (e-commerce, apps). The fraud check runs **inside the authorization flow**: every payment is
scored before the issuer authorization request. Card data is tokenized upstream (PCI DSS scope): the fraud
system never sees the PAN, only a card token/fingerprint. Issuer-side fraud and merchant onboarding fraud
are **out of scope**.
- Volume: **≈ 10 M transactions/day** → ≈ 116 TPS average; daily peak ≈ 3× ≈ 350 TPS; **design peak
  ≈ 2,000 TPS** (Buen Fin / Hot Sale / paydays 15 and 30). Average ticket **≈ US$30** → ≈ US$300 M/day ≈
  **US$9 B/month** processed.
- Fraud today: **chargebacks ≈ 0.12 % of value (12 bps) ≈ US$11 M/month** in losses (est.); by count
  **≈ 0.08 %** of transactions (fraud skews toward larger tickets) → ≈ 8,000 fraudulent tx/day. Current
  defense: a hand-written rules engine (≈ 400 rules) + a nightly batch blocklist. Goal: cut fraud losses
  ≈ 40 % without raising the decline rate of good customers.
- Decisions: **approve**, **decline**, **step-up** (3-D Secure challenge / OTP), and **manual review** only for
  merchants that capture later (e.g. high-value orders). Step-up has friction: ≈ 10–20 % of challenged
  legitimate buyers abandon (est.).
- Error costs (est.): a **false negative** = the chargeback amount + ≈ US$15 fee + ops ≈ ticket + US$15;
  a **false positive** (good tx declined) = lost fee revenue (≈ 2.5 % of the ticket) + a share of future
  purchases of that customer (churn) — the business sets ≈ US$5–10 per wrongly declined good tx; a step-up
  costs ≈ abandonment × margin. Thresholds come from expected cost per segment (merchant category,
  ticket size) under a cap on the decline rate.
- Latency: the whole authorization takes ≈ 1–2 s; the **fraud check budget is p99 ≤ 100 ms** (feature
  fetch ≈ 10–20 ms, model ≈ 2–5 ms on CPU, rules ≈ 5 ms, overhead); availability of the fraud check
  **99.99 %** — if it times out or fails: **fail to a rules-only fallback** (in-process rules + hard
  velocity limits), never block all payments; the choice per merchant segment is the narrative's trade-off.
- Features (names used everywhere): `txn-events` Kafka topic → **Flink** jobs compute windowed aggregates
  per card token, device, IP, email, merchant (counts, sums, distinct merchants/countries over 1 min, 1 h,
  24 h, 7 d) → **online store** (Redis-class, p99 read ≤ 10 ms); the most time-critical velocity counters
  (e.g. same card in the last 60 s) are updated **synchronously in the request path** (atomic increments
  with TTL) because a stream lag of seconds misses card-testing bursts; static/slow features (account age,
  merchant risk, graph features from shared devices/IPs) computed daily in batch. **One feature-definition
  module** is used online and for the offline backfill (point-in-time correct; the current transaction is
  excluded from its own aggregates consistently online and offline — the classic trap).
- Model: a **gradient-boosted trees model (GBDT, LightGBM-class)** on ≈ 300 features, served **on CPU**
  in the scoring service (≈ 1–2 ms per prediction, est.) + the **rules engine** (blocklists, hard limits,
  merchant-specific rules) + champion/challenger. No deep model internals.
- Labels: **chargebacks arrive late** — dispute windows of up to ≈ 120 days; assume ≈ 60 % of eventual
  chargebacks arrive within 30 days and ≈ 90 % within 60 days (est.) → evaluate only **matured cohorts**
  (≥ 60–90 days) and use early proxies (confirmed fraud reports, manual-review outcomes, issuer fraud
  alerts) for monitoring. **Declined transactions never get a label** (selection bias / reject inference) →
  keep a small, controlled **exploration slice** (e.g. step-up instead of decline for ≈ 1 % of medium-risk
  traffic) to measure what the model blocks.
- Evaluation: time-based splits; metrics: **value-weighted recall** (US$ of fraud caught), recall at a fixed
  decline rate, decline rate and step-up rate of good customers, approval rate, expected cost per 1,000
  transactions; online: champion/challenger on a traffic share, guardrails on approval rate.
- Monitoring alert names: `FraudScoreLatencyHigh`, `FraudFallbackActive`, `FeatureFreshnessLag`,
  `DeclineRateSpike`, `StepUpRateSpike`, `ScoreDistributionShift`, `RulesEngineErrors`,
  `ChargebackRateRising` (lagging signal).
- Costs (est.): scoring service on CPU (≈ 2,000 TPS × 3 ms ≈ 6 cores busy → ≈ 3 × c7i.2xlarge per zone
  for N+1); Kafka (managed) + Flink (managed) ≈ US$3–6k/month; online store (Redis cluster with replicas)
  ≈ US$2–4k/month; total infra ≈ US$10–15k/month vs ≈ US$11 M/month of fraud losses → infra is noise; the
  levers are recall, decline rate and analyst time.
- Regulation and audit (general principles only): PCI DSS scope reduction via tokenization, personal data
  (LFPDPPP in Mexico; GDPR/CCPA where applicable), **reason codes** stored for every decision (ops,
  disputes, merchant support), decision log retained per policy; no legal advice.
- Reference files (reference/c09/): features/{definitions.py (feature definitions as code: windows,
  aggregations, keys — one source for online and offline), online_counters.py (sliding-window counters in
  minute buckets with TTL behind a key-value interface; in-memory fake; injectable clock),
  point_in_time.py (build the training set from the event log: features as of each transaction,
  excluding the transaction itself; label = chargeback/confirmed fraud within a maturity window; immature
  rows excluded, not labeled negative), tests/}, scoring/{service.py (FastAPI POST /v1/score: time budget,
  sync velocity counters, feature fetch interface with timeout + defaults, model interface (a tiny GBDT
  trained on synthetic data in the tests or a fake), rules engine, decision with thresholds per segment
  and reason codes, rules-only fallback, Prometheus metrics), policy.yaml (thresholds per segment, decline
  cap, step-up band, exploration share), requirements.txt, tests/}, eval/{choose_thresholds.py (expected
  cost per 1,000 tx per segment over a grid of decline/step-up thresholds with a decline-rate cap),
  label_maturity.py (fraction of eventual chargebacks arrived by day N; which cohorts are evaluable),
  tests/}, monitoring/alerts.yml (+ promtool tests), README.md.

## 8j. Case c13 — shared facts (every c13 agent MUST use exactly these)
Scenario: a **video-meeting platform** (Latin America + US) adds **live captions** to calls and meetings.
Captions appear for every participant while people speak; transcripts can be saved if the host enables it.
Translation, summaries and diarization of a single mixed track are **out of scope** (extensions).
- Volume: **≈ 2 M meetings/day**, average **40 min**, ≈ 4 participants; captions are an opt-in feature used
  in **≈ 30 %** of meetings → ≈ 600k captioned meetings/day ≈ **24 M captioned meeting-minutes/day**;
  average concurrency 24 M / 1,440 ≈ 16.7k captioned meetings; **peak ≈ 3× ≈ 50k concurrent captioned
  meetings** (business hours).
- Topology (base scenario): **a single AWS region (us-east-1, three zones)** for every user, SFUs
  included; gateways and the GPU fleet live in the same region (SFU, gateway and worker in the same zone).
- Audio path: the SFU (media server) already receives **one Opus track per participant** (48 kHz, 20 ms
  frames); we transcribe **per participant** (speaker attribution for free, no diarization), resampled to
  16 kHz mono. With voice activity detection (**VAD**) only the tracks with speech consume ASR compute:
  ≈ **1.2 active speakers per meeting** on average at any moment (est.) → **≈ 60k concurrent active ASR
  streams at peak**, while ≈ 200k participant tracks stay connected (cheap, CPU-side).
- Latency targets: **partial captions p95 ≤ 500 ms** from the word spoken to text on screen; **final
  segment p95 ≤ 1.5 s** after the end of an utterance (endpointing on ≈ 500–700 ms of silence); audio
  chunks of **160 ms** to the model (est.) with right-context/lookahead per model.
- Model and serving: a **streaming-native ASR model** (transducer/CTC-class with cache-aware streaming —
  e.g. NVIDIA Riva/Parakeet-class or an equivalent open model; verify names and licenses) served on GPU
  with stateful sequence batching; Whisper-class models are batch/offline by design and need chunking hacks
  for live use (discussed as an alternative and for post-meeting transcripts). Assumed capacity
  **≈ 500 concurrent streams per L4** (est. — strongly model-dependent; measure with the real model and
  160 ms chunks; unvalidated: public cards for current streaming models report ≈ 240 streams on one H100
  at 80 ms chunks, so 500 per L4 may be optimistic — keep it as the labelled assumption, do not renumber
  silently) → planned 70 % ≈ 350 → 60k / 350 ≈ **172 L4 at peak** (+ headroom per zone) — the GPU
  fleet follows the daily curve (≈ 60 L4 at night).
- Languages at launch: **Spanish (Mexico/LatAm), English, Portuguese (Brazil)**; language chosen per
  participant (setting or automatic language ID in the first seconds — trade-off).
- Architecture (names used everywhere): SFU → **`asr-gateway`** (bidirectional gRPC streaming from the
  SFU's audio fork; one long-lived session per participant track; VAD and chunking on CPU) → **session
  router** (assigns sessions to GPU workers by free capacity; sticky for the session's life) →
  **`asr-worker`** (GPU, holds the streaming model state per session) → partial/final hypotheses →
  **`caption-bus`** (pub/sub per meeting) → existing meeting signaling WebSocket to clients; finals →
  transcript store (only if the host enabled saving).
- Statefulness: the streaming state lives on one GPU worker → load balancing by **active streams**, not
  requests or CPU; autoscaling on a custom metric (active streams per GPU) with headroom for the morning
  ramp (GPU nodes take minutes to start → #m06.cold-starts); scale-in only by **draining** (stop assigning
  new sessions; existing sessions end or migrate at an utterance boundary; meetings can last hours); on
  worker loss the gateway re-establishes the session on another worker and the user loses ≈ 1–2 s of
  partials (acceptable for captions).
- Quality: **WER per language and slice** (accent/region, noise, device, overlapping speech) on golden
  audio sets; targets as the narrative's justified choice (e.g. ≤ 12–15 % WER on conversational Spanish —
  est., measure); partial-result stability (**revision/flicker rate**), final latency, punctuation; custom
  vocabulary per organization (names, products) — hedged.
- Costs (est.): GPUs follow the curve: ≈ 172 L4 at peak, ≈ 100 L4 average ≈ 100 × US$0.80 × 730 ≈
  **US$58k/month** on-demand (+ CPU for gateways/VAD, bus, storage) vs a managed streaming ASR API at ≈
  US$0.01 per audio minute list (Amazon Transcribe streaming, Oct 2026 — verify; volume tiers lower) × ≈ 24 M ×
  1.2 active-speaker minutes/day × 30 ≈ **US$8.6 M/month** (≈ US$3.5 M at ≈ US$0.004 volume pricing) → at this scale self-hosting wins by orders of magnitude; at a small scale the API
  wins (break-even to compute).
- Privacy: audio is **not stored** by default; transcripts only if the host enables saving (retention
  ≈ 30 days, configurable); visible "captions on" indicator; no training on customer audio without
  explicit opt-in; LFPDPPP/GDPR/US state laws — general principles only.
- Monitoring alert names: `CaptionPartialLatencyHigh`, `CaptionFinalLatencyHigh`, `GPUStreamSaturation`,
  `SessionReconnectRateHigh`, `CaptionDeliveryLag`, `CanaryWERRegression`, `VADActiveRatioShift`,
  `ASRCapacityHeadroomLow`.
- Reference files (reference/c13/): streaming/{chunker.py (20 ms frames → 160 ms chunks with left context;
  energy-based VAD baseline in numpy with hangover; endpointing on silence → final), stabilizer.py (partial
  vs final hypotheses: stable prefix, revision/flicker metric), tests/}, server/{asr_server.py (FastAPI
  WebSocket endpoint: receives audio frames, VAD, chunking, model interface (fake ASR in tests), emits
  partial/final JSON messages with timestamps, backpressure and per-session limits, Prometheus metrics),
  requirements.txt, tests/}, gateway/{session_router.py (capacity-aware sticky assignment, draining,
  reassignment on worker loss), tests/}, eval/{wer.py (WER via Levenshtein with Spanish-aware
  normalization: case, punctuation, optional accent folding; per-slice aggregation; latency percentiles
  from session logs), tests/}, k8s/asr-worker.yaml (GPU Deployment with preStop drain, long
  terminationGracePeriodSeconds, autoscaling on active streams — KEDA prometheus scaler or HPA custom
  metric; validate core resources), monitoring/alerts.yml (+ promtool tests), README.md.

## 8k. Case c10 — shared facts (every c10 agent and the m14 agent MUST use exactly these)
Scenario: **the c01 marketplace** (Latin America) today calls a **third-party LLM API** from three internal
products and wants to serve an **open-weights model on its own infrastructure** (AWS, us-east-1). Reasons
given by the business: a growing bill, customer PII leaving the company, and lack of control (model
deprecations, rate limits, latency variance). The case must show with numbers when self-hosting wins and
when it does not, and keep the vendor as an explicit, governed fallback — never "self-host everything".
- Products (the platform's tenants):
  1. **Support assistant** (chat with buyers/sellers; streaming; later the agent of #c12) — interactive.
  2. **Seller listing assistant** (drafts titles/descriptions from photos' attributes and seller notes) — interactive.
  3. **Catalog enrichment** (extract structured attributes as JSON from listings, nightly) — **batch**.
  (The employee RAG assistant of #c11 is a future tenant — mention only.)
- Volume (est., given by the interviewer): interactive ≈ **1.5 M requests/day** (≈ 17 rps avg, **peak ≈ 3×
  ≈ 52 rps → design for 60 rps**), avg prompt **≈ 2,000 tokens** (system prompt + history + context; ≈ half
  of it a shared prefix per product → prefix caching) and **≈ 250 output tokens**; batch ≈ **2 M items/day**,
  ≈ 800 in / 150 out tokens, must finish **within an 8 h night window**.
  Monthly: interactive ≈ 90 B input + 11.25 B output tokens; batch ≈ 48 B input + 9 B output.
- Today's vendor bill (est., list prices of a mid-tier proprietary model ≈ US$2.50 / M input and US$10 / M
  output — illustrative, verify current prices and caching/batch discounts; batch API at −50 %):
  ≈ 90 × 2.5k + 11.25 × 10k + 0.5 × (48 × 2.5k + 9 × 10k) ≈ **US$442k/month**, growing ≈ 10 %/month.
- SLOs (interactive, streaming): **TTFT p95 ≤ 1.0 s**, **TPOT p95 ≤ 50 ms** (≈ 20 tokens/s per user, faster
  than reading); availability 99.9 % for the platform; batch: done by 06:00.
- Model: one **≈ 70B-class dense open-weights instruct model** (the math uses the Llama 3.x 70B
  architecture from #m04: 70.6 B params, 80 layers, 8 KV heads × head_dim 128 → **KV 320 KiB/token in BF16**,
  160 KiB in FP8; candidates and licenses — Llama 3.3 70B community license vs Apache-2.0 families like Qwen
  or gpt-oss (MoE) — are the narrative's justified, verified choice for Oct 2026; do NOT invent model names
  or benchmark scores). Weights in **FP8** (≈ 70.6 GB; quality checked on our golden sets, not assumed).
  A small ≈ 8B model is an optional later lever (routing easy requests), not part of the base design.
- Serving: **vLLM** (OpenAI-compatible server; continuous batching, PagedAttention, prefix caching, chunked
  prefill; SGLang / TensorRT-LLM as alternatives; TGI in maintenance mode — verify) on **H100**:
  one replica = **2 × H100 with tensor parallelism 2** (TP=2), `gpu_memory_utilization` 0.90, max context
  8k tokens. KV room per replica ≈ 0.9 × 160 − 70.6 − ≈ 5 (runtime/activations, est.) ≈ **68 GB** ≈ 93
  sequences of 2,250 tokens in BF16 KV (≈ 2× with FP8 KV).
  Planned capacity per replica (est. — measure with `vllm bench serve` and the real prompt mix): **≈ 6 rps
  of this mix within SLOs**; plan at 70 % → ≈ 4.2 rps → 60 / 4.2 ≈ 14.3 → **16 replicas = 32 H100 =
  4 × p5.48xlarge** at peak. Little's law check: 60 rps × ≈ 10.5 s per request ≈ 630 concurrent sequences ≈
  40 per replica (fits the KV room).
- Batch fills the night valley on the **same fleet** at lower priority (≈ 3.5k prefill + ≈ 650 output
  tokens/s per replica over 8 h on 16 replicas — fits the capacity assumption, est.).
- Platform components (names used everywhere): **`llm-gateway`** (OpenAI-compatible API in front of every
  model: per-tenant API keys, quotas in tokens/min (token bucket), priority classes interactive > batch,
  model aliases (`chat-default` → current model revision), streaming passthrough (SSE), timeouts, usage
  metering per tenant, PII redaction before any vendor call, governed **vendor fallback** only for tenants
  allowed to send data out) → **`vllm-70b`** (Kubernetes Deployment on EKS, 2 GPUs per pod) ;
  **`batch-runner`** (reads a night queue, submits through the gateway with batch priority, retries,
  checkpoints); weights as safetensors in **S3**, copied to node-local NVMe at pod start (sha256 checked);
  **model registry** with an eval report per revision.
- Cold start: a new p5 node + image + 70 GB of weights + CUDA graphs ≈ **5–10 min** (est., measure) →
  autoscaling cannot follow 1-minute spikes: keep the peak fleet warm in business hours, scale in at night
  only if batch doesn't need it, and absorb spikes with admission control/queueing at the gateway; GPU
  capacity is the real constraint (p5 on-demand availability, Capacity Blocks / reservations — verify).
- Cost (est., ref-numeros: p5.48xlarge ≈ US$55/h → ≈ US$6.88 per H100-hour, 730 h/month): 4 nodes always on
  ≈ **US$160.6k/month** on-demand (+ gateway CPU, storage, observability, and **the team** — 2–4 engineers on
  call, hedged) vs **≈ US$442k/month** vendor → ≈ 2.7× cheaper at this scale, **not orders of magnitude**;
  at ≈ 1/5 of the volume the vendor wins (compute the break-even); commitments (Savings Plans / reservations)
  lower the self-hosted side further — hedged.
- Quality and evaluation: per-product **golden sets** (support: ≈ 1,000 real conversations with rubric;
  listings: human-rated drafts; extraction: exact-match / JSON validity / field F1 against labelled items),
  **LLM-as-judge** calibrated against human ratings (pairwise vs the current vendor), shadow traffic before
  switching a tenant, per-tenant canary with guardrail metrics (escalation rate to humans, CSAT, seller
  edits), regression gate per model revision.
- Privacy/security: prompts contain buyer/seller PII → staying in our VPC is a goal; prompts/outputs **not
  stored by default**, sampled logging with PII redaction for eval only (30 days), per-tenant isolation in
  the gateway; prompt injection and output guardrails → #m14 / #m15 (general principles; LFPDPPP).
- Monitoring alert names: `LLMTTFTHigh`, `LLMTPOTHigh`, `LLMQueueBacklog`, `KVCacheSaturation`,
  `LLMPreemptionsRising`, `LLMGatewayErrorRate`, `LLMCapacityHeadroomLow`, `CanaryEvalRegression`
  (vLLM exposes `vllm:`-prefixed Prometheus metrics — verify exact names for the pinned version).
- Reference files (reference/c10/): capacity/{vram_calc.py (weights + KV per token from a model config;
  KV room per replica given TP and gpu_memory_utilization; max concurrent sequences; tests reproduce #m04's
  128 KiB / 320 KiB per token), fleet_calc.py (traffic mix + measured per-replica capacity → replicas,
  GPUs, nodes, monthly cost vs API cost and break-even), tests/}, bench/{pick_concurrency.py (reads results
  of `vllm bench serve` sweeps (JSON) and picks the max concurrency meeting TTFT/TPOT SLOs; synthetic fixture
  data), tests/}, gateway/{llm_gateway.py (FastAPI OpenAI-compatible proxy: API keys per tenant, token-bucket
  quotas on tokens/min, priority, aliases, SSE streaming passthrough, timeouts, vendor fallback behind an
  interface with PII redaction, Prometheus metrics; fake upstream in tests), requirements.txt, tests/},
  k8s/vllm-70b.yaml (Deployment with `vllm serve` args, 2 GPUs, /dev/shm, long startupProbe, readiness,
  preStop drain, PDB; core resources validated with kubernetes-validate; vLLM itself not run — no GPU here),
  eval/{golden_eval.py (golden-set runner: JSON validity / field F1 for extraction, pluggable judge for chat
  with pairwise win-rate and a gate), tests/}, monitoring/alerts.yml (+ promtool tests), README.md.

## 8l. Case c11 — shared facts (every c11 agent MUST use exactly these)
Scenario: **the c01 marketplace company** (≈ 8,000 employees: support, operations, sellers' success,
engineering, legal) wants an **internal assistant** that answers employees' questions from internal
documents and **cites its sources**. It becomes a new tenant (`employee-assistant`) of the c10 platform:
generation goes through **`llm-gateway`** to the self-hosted **`chat-default`** model (≈ 70B, max context
**8k tokens** — a hard budget for the prompt). Not our job to train the LLM or the embedding model.
- Sources (connectors): **Confluence** wiki (≈ 400k pages), **Google Drive** (Docs, Sheets, PDFs; ≈ 1.2 M
  files of which ≈ 300k PDFs, some scanned), **Jira** tickets (≈ 3 M, only the last 2 years indexed), and
  the **support policies/macros** repository. After filtering (type, age, trash, size) ≈ **1.5 M documents
  → ≈ 12 M chunks** of ≈ 400 tokens (≈ 4.8 B tokens).
- Changes: ≈ **1 % of documents change per day** (≈ 15k) — incremental ingestion by change feeds/webhooks
  where the source has them, otherwise polling by modified time; deletions as tombstones. Freshness target:
  an edited page is answerable in **p95 ≤ 15 min**; **permission changes (revocations) apply in ≤ 5 min**.
- Permissions are THE hard requirement: every document carries its ACL from the source (Confluence space and
  page restrictions, Drive sharing incl. groups and "anyone in the domain", Jira project roles), normalized
  into principal ids (users + groups); group membership synced from the IdP (Okta/Google groups). The
  filter is applied **inside retrieval (pre-filter)**, never after generation; a chunk the user can't open
  must never reach the prompt. Link sharing ("anyone with the link") is treated as NOT shared (trap).
- Traffic: ≈ 40 % weekly active; ≈ **25k questions/day** in business hours (≈ 0.7 qps avg over 10 h, **peak
  ≈ 2 qps**) — tiny for the GPUs; the hard parts are ingestion, permissions and quality.
- Retrieval: **hybrid** — BM25 + dense vectors in **OpenSearch** (as in c07: k-NN HNSW + BM25, fused with
  **RRF k = 60**), a multilingual embedding model (Spanish + English + Portuguese; **d = 1024**, served on
  1–2 L4 with the c07 pattern; model choice verified by the narrative) → top-50 → **cross-encoder
  reranker** (GPU) → **top-8 chunks** into the prompt. Index memory (compute): 12 M × 1024 × 4 B ≈ 49 GB
  FP32, ≈ 12.3 GB int8 + HNSW graph. Initial embedding ≈ 4.8 B tokens ≈ 44 L4-hours at ≈ 30k tokens/s
  (est., measure) ≈ US$36 — embedding is cheap; re-embedding = blue/green index like c07.
- Prompt budget (8k): system + instructions ≈ 800, conversation history ≤ 1,200, **8 chunks × 400 ≈ 3,200**,
  question ≈ 100 → ≈ 5,300 in + **≤ 600 out** (≈ 6k average with overhead, est.). Tokens/day ≈ 25k × 6k ≈
  **150 M in + 10 M out** — < 5 % of the c10 fleet's interactive load.
- Answers: grounded only in retrieved chunks, every claim with **citations** [n] linking to the source and
  section; if the evidence is insufficient → say so and show the best documents ("no sé" is a valid answer);
  conflicting sources → show both with dates. Latency: retrieval + rerank **p95 ≤ 700 ms**, first token
  **p95 ≤ 2.5 s**, full answer streamed ≤ 10 s.
- Evaluation: golden set of **≈ 600 questions** written with subject-matter experts per area (with the
  expected documents and a reference answer), incl. permission tests (same question, users with different
  access) and unanswerable questions; retrieval **recall@8 / MRR**; answer **faithfulness/groundedness**
  and **citation precision** by an LLM judge calibrated on ≈ 200 human-rated answers; online: thumbs,
  citation clicks, "no sé" rate, deflection of internal tickets (hedged).
- Privacy/security: answers logged with doc ids, not full text, 30 days; HR/legal spaces excluded by default
  (allow-list of sources per sensitivity); indirect prompt injection via documents (a page that says
  "ignore your instructions…") → #m14.guardrails.
- Monitoring alert names: `RAGAnswerLatencyHigh`, `RetrievalLatencyHigh`, `IngestionLagHigh`,
  `ACLSyncStale`, `EmptyRetrievalRateHigh`, `IndexDocCountDrop`, `GroundednessCanaryRegression`,
  `NegativeFeedbackRising`.
- Reference files (reference/c11/): ingest/{chunker.py (structure-aware chunking: headings path kept as
  context, tables not split mid-row, overlap, token counting with a pluggable tokenizer), acl.py (normalize
  source ACLs to principals; expand user → groups; build the retrieval filter; link-sharing trap),
  incremental.py (change detection by version/content hash, upserts, tombstones, ACL-only updates without
  re-embedding), tests/}, retrieval/{hybrid.py (BM25 + vector behind interfaces with in-memory fakes, ACL
  pre-filter, RRF fusion, rerank interface, top-k), tests/}, answer/{prompt_builder.py (8k context budget,
  numbered sources, refusal instruction), citations.py (parse [n], validate each cited id was retrieved AND
  allowed, strip/flag invalid ones), tests/}, service/{app.py (FastAPI /v1/ask with SSE streaming through an
  llm-gateway client interface; auth → principals; fake LLM in tests), requirements.txt, tests/},
  eval/{retrieval_eval.py (recall@k, MRR per slice incl. permission cases), groundedness.py (judge interface
  + agreement with human labels), tests/}, monitoring/alerts.yml (+ promtool tests), README.md.

## 8m. Case c12 — shared facts (every c12 agent MUST use exactly these)
Scenario: **the c01 marketplace's support assistant** (a c10 tenant, `support-assistant`) today only answers
questions. The business wants it to **resolve cases** by acting on internal systems on behalf of the
authenticated customer (buyer or seller). It runs on the c10 platform (`llm-gateway` → `chat-default`,
tool calling via the OpenAI-compatible API — verify vLLM tool-calling support/flags for the chosen model).
- Volume: ≈ **150k support conversations/day**; ≈ **6 LLM calls per conversation** on average (loop steps)
  → ≈ 0.9 M LLM calls/day ≈ 10 rps avg, **≈ 31 rps peak** — inside the c10 support tenant's share
  (≈ 2/3 of 60 rps); ≈ 2,500 input tokens per call (system prompt + **tool schemas ≈ 1,500 shared prefix**
  → prefix caching) and ≈ 150 output tokens.
- Today: ≈ 600 human agents; ≈ 45 % of conversations need an action (refund, return, address change,
  cancellation, tracking). Goal: the agent **resolves ≈ 40–50 % end to end** (est., not promised), hands
  off the rest with a summary; human cost per conversation ≈ US$3–5 (est.) vs agent ≈ cents (compute).
- Tools (names used everywhere): `get_order`, `get_shipment_tracking`, `search_help_center` (c11-style
  retrieval over the PUBLIC help center), `update_shipping_address` (only before shipment),
  `cancel_order` (only before shipment), `create_return_label`, `issue_refund`, `escalate_to_human`.
  Side-effect classes: **read** (retries OK), **write** (idempotency key per conversation + action),
  **irreversible/money** (explicit customer confirmation in chat + policy check).
- Policy (enforced in code, NOT in the prompt): tools are scoped to the authenticated customer's own
  orders (the backend checks ownership on every call — the model never passes a customer id);
  **auto-refund ≤ US$50 equivalent** and only for eligible reasons/states; above that or outside policy →
  **human approval queue** (the conversation waits; SLA 4 business hours); max **1 refund per order** by
  the agent.
- Limits: **≤ 8 tool calls per turn**, **≤ 12 LLM calls per conversation**, **token budget 40k per
  conversation**, tool timeout **3 s** (reads retried once with backoff; writes never blindly retried),
  turn wall-clock **≤ 20 s** (then a holding message); on any limit → hand off to a human.
- Latency: first visible response of a turn **p95 ≤ 4 s** (streaming text or a "consultando tu pedido…"
  status), full turn with tools **p95 ≤ 12 s**.
- State: conversation + **step log** (every LLM call, tool call with args/result, policy decision) in a
  durable store (Postgres); a turn can **resume after a crash** from the last completed step; waiting for
  approval can take hours (durable workflow — Temporal-class engines or an own state machine; hedged).
- Security: untrusted text enters via customer messages, seller messages, product descriptions and tool
  results → **indirect prompt injection**; mitigations: privilege separation (policy layer), allow-listed
  tools per conversation type, structured tool outputs, confirmation for money, output filters; none is
  complete (say so). PII minimized in prompts and logs.
- Evaluation: offline **scenario suite ≈ 400 scenarios** (mocked tool backends, scripted or LLM-simulated
  customers — hedged) with checks on outcome (task success), **policy violations (zero tolerance; any one
  blocks release)**, trajectory (no unnecessary/forbidden calls), turns and cost; regression gate per
  model/prompt/tool-schema revision; online: resolution rate, escalation rate, **reopen within 7 days**,
  CSAT, refunds US$ per 1,000 conversations vs the human baseline, canary per conversation type.
- Observability: one **trace per conversation** with a span per LLM call and tool call (OpenTelemetry
  GenAI semantic conventions — verify status), cost per conversation, replay from the step log.
- Monitoring alert names: `AgentToolErrorRateHigh`, `AgentStepLimitHit`, `AgentPolicyViolation`,
  `RefundAmountAnomaly`, `AgentTurnLatencyHigh`, `ApprovalQueueBacklog`, `AgentCostPerConversationHigh`,
  `EscalationRateShift`.
- Reference files (reference/c12/): agent/{loop.py (orchestrator: LLM interface with a scripted fake in
  tests; tool dispatch; step/tool/token/wall-clock limits; observation truncation; stop conditions;
  hand-off), tools.py (registry with pydantic argument schemas → JSON schema for the LLM; side-effect class;
  per-tool timeout/retry rules; idempotency keys), policy.py (ownership scope, refund limits and
  eligibility, confirmation required, approval routing — pure functions), state.py (durable step log in
  SQLite for tests; resume after crash; exactly-once effects via idempotency), tests/},
  guardrails/{untrusted.py (wrap untrusted tool/user text, heuristics flags — state its limits), tests/},
  eval/{scenarios/*.yaml, run_scenarios.py (mock backends, success/violation/trajectory metrics, gate),
  tests/}, service/{app.py (FastAPI conversation endpoint with SSE status/messages; approvals webhook),
  requirements.txt, tests/}, monitoring/alerts.yml (+ promtool tests), README.md.

## 9. Writing style for content agents (applies to every content file)
- Spanish (neutral Latin American, tuteo), direct, no filler, no motivational fluff. Technical terms
  in English (latency, throughput, batch, serving, feature store, rollout…), exactly as they'd be
  said in an interview; give the Spanish gloss on first use only when it helps.
- **Always the why** behind each decision, not just the what. Comparison **tables** whenever two
  things get confused. **Traps and common mistakes** flagged explicitly (`callout trap`).
  **Numeric examples before abstract notation.** Connect each module with the previous ones and point
  forward to later modules (`callout connect`, internal links like `<a href="#m03">M3</a>` even if
  not ready yet). If a topic is rarely asked in interviews, say so (`callout skip` / `priority:'skip'`).
- Realistic numbers **marked as estimates** (`<span class="est">`); if you are not sure about a
  figure or benchmark, **say so explicitly** instead of inventing it ("no tengo un benchmark
  confiable; mídelo con …"). Never fabricate citations or benchmarks. Cite only well-known sources
  by name (e.g. Sculley et al., *Hidden Technical Debt in Machine Learning Systems*, NeurIPS 2015;
  Martin Zinkevich, *Rules of Machine Learning*; Chip Huyen, *Designing Machine Learning Systems*,
  O'Reilly 2022; Google SRE Book) and only when genuinely relevant.
- The reader is strong in CV/PyTorch → use CV examples, relate to what they already know (a
  notebook with a ResNet), never explain model internals.
- Voice: a Staff MLE who has interviewed many candidates: concrete, opinionated, "esto es lo que
  un entrevistador anota".
- Validate your file with `node tools/validate-content.mjs` until it reports no errors.
