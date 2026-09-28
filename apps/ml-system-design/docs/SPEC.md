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
node tools/validate-content.mjs            # validates catalog + all content files (schema, links, template)
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
   (`QPS pico 500 req/s · p99 ≤ 200 ms · disponibilidad 99.9 % · presupuesto ≈ US$3k/mes`).
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
  history), `flashcards`, `glosario`, `ref-numeros`, `ref-herramientas`, `ref-comandos`,
  `buscar` (search results, optional).
- Sidebar groups (in this order): **Inicio** · **Parte 1 — Fundamentos** (m01–m15) ·
  **Parte 2 — Casos de diseño** (c01–c13) · **Parte 3 — Práctica** (Simulador, Historial,
  Flashcards) · **Parte 4 — Referencias** (Números que debes saber, Herramientas por categoría,
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
store.exportJSON() → string
store.importJSON(str) → {ok, error?}          // validates shape, merges
store.backend() / store.onStatus(fn)
```

### 4.5 Pages the shell renders (js/app.js)
- **inicio** (Home — opens in a realistic working state, never empty): title + one-paragraph purpose;
  uptime strip + "X de 28 completados"; "Continúa donde lo dejaste" (last location, or m01 on first
  visit); "Siguiente recomendado" (first ready & not completed item in course order);
  practice summary (last attempts with scores; CTA "Practicar c01"); flashcards due today; the
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
  and `pref('solutionRevealed')[caseId]` is not set, show the enunciado (section 1 content) and two
  actions: primary "Practicar primero (45 min)" → `#practica-cNN`; secondary text button
  "Ver la solución sin practicar" (sets `solutionRevealed`). Otherwise show the 15 template sections
  with a numbered template navigator (1–15; titles from `MSD.CASE_TEMPLATE`), same read ticks, same
  prev/next. Section 15's checklist is interactive and persisted.
- **"Próximamente" page** (module/case not ready): header with title/summary, "Qué vas a aprender"
  (`meta.topics`), interview frequency, connections; for cases also the enunciado with a
  "Practicar este enunciado" button (practice works; solution pending) and a note:
  "Este contenido llega en una fase posterior. Pídelo cuando termines lo anterior."
- **Search**: input at the top of the sidebar; results in a popover/list (keyboard navigable)
  over: page titles/summaries, section titles, glossary terms (en/es), flashcard questions.
  Uses `MSD.searchIndex()` (§5.6). Enter opens the first result.
- **Sidebar footer**: storage status, theme switch (Sistema/Claro/Oscuro — sets/removes
  `data-theme` on `<html>`), "Exportar / Importar progreso" (opens an in-page panel: export shows the
  JSON in a textarea + Copy button; import accepts pasted JSON with an explicit "Importar" button
  and a result message; no `prompt()`).
Practice/flashcards/glossary/ref pages are rendered by `MSD.Practice`, `MSD.Flashcards`,
`MSD.Reference` (§7): the router calls `X.render(container, route, ctx)` where
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
'intro'|'media'|'alta' (cases), tests?:[string] (cases: what the case really tests)}`.

**Registered module** (`MSD.register`):
```js
{ id:'m01', kind:'module',
  sections:[ {id:'kebab-id', title:'…', titleEn?:'…', priority?:'core'|'extra'|'skip', blocks:[…]} ],
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
Section ids for cases are fixed (§6). A case may be split across files: the main file registers
the page with 14 sections and another file calls `MSD.addSection('c01', {id:'archivos', …})`.

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
flashcard questions (href `#flashcards`). The shell filters with a case/diacritic-insensitive match.

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
- `practica-cNN` session: the prompt (large, quoted); countdown **45:00** with Start/Pause/Reset
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
Deck = `MSD.flashcards()`. Filter chips by source page (m01, c01…) and by kind; default "Pendientes
hoy". Card flow: show question → "Mostrar respuesta" (Space) → grade "Otra vez" (1) / "Difícil" (2) /
"Bien" (3) with the keys shown. Session summary at the end. Stats: per box counts (Leitner 0–4),
due today. Works with zero due cards ("Todo al día" + option "Repasar todo igual").

### 7.4 Reference pages
- `glosario`: searchable table ES–EN (`MSD.glossary()`): English term (mono), Spanish, definition,
  "cómo lo dirías" sentence, source page chips; alphabet jump; each row has id `glosario.<slug(en)>`.
- `ref-numeros`, `ref-herramientas`, `ref-comandos`: "Próximamente" pages (they are Phase-later content)
  showing their `topics` from the catalog.

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
  monitoring and labeling. 1 % of images sampled to a labeling queue.
- Monthly cost (approx, on-demand): 2 × g4dn.xlarge ≈ US$768; 2 × c6i.xlarge ≈ US$248; EKS control
  plane ≈ US$73; ALB ≈ US$30–60; logs/metrics/S3 ≈ US$100; **infra ≈ US$1.3k/month**; labeling
  (≈ 5k images/month by humans) ≈ US$250–500 → **≈ US$1.6–1.8k/month total**, under budget.
- Online metric: **category-suggestion acceptance rate** (seller keeps one of the suggested
  categories); guardrails: p99 latency, % listings re-categorized later by moderators, form
  completion time.

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
