# Atlas de Arquitecturas — build specification (internal contract)

Single source of truth for every agent building this app. Read it fully before writing anything.
If something is ambiguous, choose the option that keeps modules decoupled and leave a short code
comment explaining the choice. Do NOT edit files owned by another agent (§2); if you need a change in
someone else's file, note it in your final report. The phase roadmap lives in `docs/ROADMAP.md`
(Spanish, user-facing) and is mirrored in `js/content/catalog.js` (`roadmap`).

Sibling apps in this repo — reuse their patterns, never import their files at runtime:
- `apps/ml-system-design` (**Ronda de Diseño ML**): shell, store, flashcards, build, web/Vercel build,
  validator, smoke test. This app is a fork of that shell (copy + adapt, §2).
- `apps/transformer-lab` (**Laboratorio Transformer**): attention/transformer from scratch, step by
  step, with MathJax. The Atlas links to it instead of re-teaching it (§10.3).

## 0. Goal (from the user, condensed)

The user is a mechatronics engineer (MSc), fluent in CNNs (ResNet) and classic detection (YOLO:
anchors, IoU, NMS, mAP). Gap: **attention applied to vision, multimodal models, and LLM internals**.
Target: ML/AI Engineer interviews, later robotics. They want an **atlas of architectures at "level 2"**:
block diagram + math + tensor dimensions, for the models those interviews ask about, starting with
the ones that combine attention and vision.

Level definitions (used in the UI and in content):
- **Nivel 1** — what it is, inputs → outputs, when to use it, one diagram. (Map cards only.)
- **Nivel 2** — every block with its exact formula, every tensor with its shape (symbols and
  numbers), parameter and FLOP counts with the arithmetic shown, training objective, inference
  costs, failure modes, interview questions. (Every model page.)
- Nivel 3 (writing it from scratch, training it) is out of scope: that's what the Laboratorio
  Transformer does for the vanilla decoder.

The app has five areas:
1. **Mapa** — every family (encoder-only, decoder-only, encoder-decoder, CNN, ViT, detectors,
   multimodal, generative, VLA, trees, level-1 families) and how they relate.
2. **Modelos** — one page per model (or per tightly coupled pair), fixed 11-section template (§5.3).
3. **Repaso de atención** — compact recap with the notation every other page uses; deep-links to the
   Laboratorio Transformer.
4. **Práctica** — blank diagrams, "¿qué forma tiene este tensor?" drills generated from the
   calculator, "¿qué pasa si duplico…?" scaling questions, flashcards (Leitner, like the Ronda).
5. **Referencia** — shapes & formulas sheet (parameter/FLOP formulas per block type, generated tables
   per model), glossary ES–EN.

**Diagrams are the heart of the app** (§7). **Exactness is critical** (§6, §9): every shape, parameter
count and FLOP count shown anywhere comes from the calculator (§6), which is unit-tested and
cross-checked against reference PyTorch implementations (§9.3). Nothing numeric about a model's
architecture is typed by hand in content.

Built **in phases** (docs/ROADMAP.md). Phase 1 = the complete shell + the three engines (calculator,
diagram, practice) + Mapa skeleton + Repaso de atención + **ViT** complete + reference sheet (ViT rows).
Later phases add one content file (+ one calculator file + diagram specs) per model **without touching
the shell**, so the formats in §5–§7 are long-lived contracts.

## 1. Hard technical constraints

Same as the Ronda (its SPEC §1), plus MathJax:
- Plain JavaScript (ES2020), **classic scripts** (no ES modules: they break on `file://`). Every file
  is an IIFE attaching to the global namespace `ATLAS`:
  ```js
  (function (root) {
    'use strict';
    const ATLAS = (root.ATLAS = root.ATLAS || {});
    // ...
  })(typeof window !== 'undefined' ? window : globalThis);
  ```
  `js/core/*`, `js/arch/*` and `js/content/*` must NOT touch `document`/`window` at load time (they
  load in Node for validation and tests).
- No npm dependencies. Node ≥ 20 (`node --test`). Machine: Node 24, macOS, Chrome. Python cross-check
  (§9.3) runs in a local venv and is **dev-only** (never shipped, never needed by `npm test`).
- External resources allowed: Google Fonts stylesheet (IBM Plex Sans, IBM Plex Sans Condensed, IBM
  Plex Mono) and **MathJax 3 SVG** from cdnjs
  (`https://cdnjs.cloudflare.com/ajax/libs/mathjax/3.2.2/es5/tex-svg.min.js`, config as in the Lab:
  `\( \)` inline, `\[ \]` display, `startup.typeset:false`, `svg.fontCache:'global'`). Offline: fonts
  fall back to system stacks; formulas fall back to monospace LaTeX source (readable, never broken).
  The web build's service worker caches MathJax at runtime so the installed app has formulas offline.
- Must work (1) by double-clicking `index.html` (`file://`), (2) bundled by `build.mjs` into one HTML
  and published as a claude.ai Artifact (sandboxed iframe: no `alert/confirm/prompt`, no downloads, no
  `window.open`, no service workers, only `#token` hashes with `[A-Za-z0-9._~-]`), (3) as the web build
  for Vercel (installable, offline after the first visit) — §10.
- Toggle visibility with `el.hidden`; global `[hidden]{display:none!important}`.
- All user-facing text in **Spanish (neutral Latin American, tuteo)**; technical terms in English as
  said in interviews (patch embedding, self-attention, cross-attention, KV cache, prefill…). Code
  comments in Spanish, short.
- Accessibility: landmarks, skip link, visible focus, everything keyboard-operable (including diagram
  blocks and practice), `aria-current`, `prefers-reduced-motion`, text contrast ≥ 4.5:1, graphic
  elements (block fills, edge strokes) ≥ 3:1 against their background in both themes.
- Responsive: 360 px+ with 16 px gutter; the body never scrolls horizontally. Diagrams pan/zoom with
  gestures inside their own viewport (§7.6).
- Theme-aware (light/dark/system) per §3.

## 2. File layout and ownership

```
apps/atlas-arquitecturas/
  index.html                     # full document; load order §2.1                                   [shell]
  package.json                   # scripts §9.5                                                     [orchestrator]
  build.mjs                      # → dist/atlas-arquitecturas.html + dist/artifact.html            [shell]
  vercel.json · .vercelignore · .gitignore                                                          [shell]
  README.md                      # Spanish user guide (written last)                                [integrator]
  docs/SPEC.md · docs/ROADMAP.md # this file · phase plan                                           [orchestrator]
  css/app.css                    # tokens (§3) + base + layout + sidebar + pages + blocks           [shell]
  css/diagram.css                # architecture diagrams, legend, tooltips, detail panel, walk mode [diagram]
  css/practice.css               # drills, blank diagrams, flashcards, glossary                     [practice]
  js/core/registry.js            # catalog, register, templates, lookups (§5)                       [orchestrator]
  js/core/store.js               # persistence (fork of the Ronda's store, key 'atlas.v1') (§4.4)   [shell]
  js/core/quantities.js          # {{model.key}} resolver used by content/validator (§6.6)          [arch]
  js/arch/primitives.js          # ATLAS.Arch: layer primitives, shapes, params, MACs (§6)          [arch]
  js/arch/<model>.js             # one file per model family: config(s) + build() (§6.4)            [arch / phase agent]
  js/ui/dom.js                   # ATLAS.dom (fork of MSD.dom + new icons)                         [shell]
  js/ui/math.js                  # ATLAS.MathTex (fork of the Lab's TL.MathTex)                    [shell]
  js/ui/blocks.js                # ATLAS.Blocks.render for every block type (§5.4)                 [shell]
  js/ui/archdiagram.js           # ATLAS.ArchDiagram (§7) — THE core component                    [diagram]
  js/ui/viz/<name>.js            # key-idea visualizations, one per file (§7.8)                    [diagram / phase agent]
  js/ui/practice.js              # ATLAS.Practice: drills, blank diagrams, what-if (§8)             [practice]
  js/ui/flashcards.js            # ATLAS.Flashcards (fork of the Ronda's)                          [practice]
  js/ui/reference.js             # glossary + generated shape/formula sheet (§5.6)                  [practice]
  js/app.js                      # ATLAS.App: router, layout, sidebar, home, map, model pages, search [shell]
  js/content/catalog.js          # ATLAS.defineCatalog({...}) — every page's meta + families + roadmap [catalog]
  js/content/<id>.js             # one content file per page (e.g. vit.js, repaso-atencion.js, mapa.js) [content]
  js/content/diagrams/<id>.js    # diagram specs of that page (overview + expanded blocks) (§7.2)  [content]
  crosscheck/                    # Python cross-check (dev-only): requirements.txt, *.py, expected/*.json [arch]
  tools/                         # validate-content.mjs, browser-check.mjs (copy), smoke.js, build-web.mjs,
                                 # crosscheck-compare.mjs, contrast-check.mjs                     [orchestrator/shell]
  tests/                         # arch.test.cjs, content.test.cjs, store.test.cjs, crosscheck.test.cjs
  dev/diagram.html · dev/blocks.html  # isolated demo pages for the diagram component and blocks [diagram/shell]
  web/                           # manifest, icons, sw.js (fork of the Ronda's)                   [shell]
```
Forking rule: copy the Ronda's file, rename the namespace (`MSD` → `ATLAS`) and keys (`msd.v1` →
`atlas.v1`, cache prefix `ronda-` → `atlas-`), then adapt. Keep a one-line header comment
"Basado en apps/ml-system-design/…". Never edit the Ronda or the Lab from an Atlas phase (exception:
§10.3, only if the user approves).

### 2.1 Load order in `index.html`
Google Fonts → `css/app.css` → `css/diagram.css` → `css/practice.css` → MathJax config inline →
MathJax script (`async`). Scripts at the end of `<body>`, classic, in this order:
`js/core/registry.js` → `js/core/store.js` → `js/arch/primitives.js` → `js/arch/*.js` (catalog order)
→ `js/core/quantities.js` → `js/ui/dom.js` → `js/ui/math.js` → `js/ui/blocks.js` →
`js/ui/archdiagram.js` → `js/ui/viz/*.js` → `js/ui/practice.js` → `js/ui/flashcards.js` →
`js/ui/reference.js` → `js/content/catalog.js` → content files and their diagram files →
`js/app.js`. Future phases append lines at three marked spots:
`<!-- arch: modelos nuevos -->`, `<!-- viz: visualizaciones nuevas -->`,
`<!-- contenido: páginas nuevas -->`. The validator fails if a file in `js/arch/`, `js/ui/viz/` or
`js/content/` is not loaded, or is loaded after `js/app.js`.

## 3. Visual design (tokens are a contract: `css/app.css` defines them, others consume them)

Name: **Atlas de Arquitecturas**. Treatment: a technical atlas — precise, dense, quiet; the figures
should look like the best paper/blog figures (The Illustrated Transformer, Lilian Weng, the ViT/Swin/
DETR paper figures), not like a dashboard. Ground with a faint blueprint grid behind diagrams only.
No emoji markers, no gradients, no card soup. Fonts as in the Ronda: display IBM Plex Sans Condensed
600/700; body IBM Plex Sans 16 px / 1.6; data, shapes and formulas-as-text IBM Plex Mono
(`tabular-nums`).

Base tokens: same names and values as the Ronda (`--bg --surface --surface-2 --ink --muted --rule
--rule-strong --accent --accent-ink --accent-soft --ok --bad --warn` + soft variants, `--focus`,
shadows, type scale, radii, `--gap --gutter --ease --dur`, `--sidebar-w:288px --content-max:820px
--toc-w:220px`), plus `--grid` (`#DCE2E8` / `#18222C`) for the blueprint grid. Light on bare `:root`;
dark under `@media (prefers-color-scheme: dark){ :root:not([data-theme="light"]){…} }` and under
`:root[data-theme="dark"]{…}`; `color-scheme` set; `body{background:var(--bg);color:var(--ink)}`.

### 3.1 Operation palette (block fills/strokes — one color per op type, everywhere in the app)
| token (`--op-*`) | op type | light stroke / fill | dark stroke / fill | used for |
|---|---|---|---|---|
| `embed` | embeddings & projections | `#2B5BD7` / `#E3EAFB` | `#7CA2FF` / `#1A2544` | patch/token embedding, linear projections W_Q/K/V/O, projectors |
| `attn` | attention | `#B4307A` / `#F7E1EE` | `#F07BBE` / `#3A1630` | self-, cross-, windowed, deformable attention; QKᵀ, softmax·V |
| `norm` | normalization | `#5B6672` / `#E7EBEE` | `#A3AFBB` / `#232C35` | LayerNorm, RMSNorm, BatchNorm, GroupNorm |
| `mlp` | MLP / FFN | `#25734A` / `#DDF0E4` | `#5CC98A` / `#133022` | FFN, SwiGLU, MoE experts |
| `conv` | convolution | `#9A5A06` / `#F6E9D5` | `#E3A34B` / `#35270F` | conv layers, CNN backbones, patchify-as-conv |
| `fuse` | modality fusion | `#7445A8` / `#EEE6F7` | `#B794F0` / `#2A1F3D` | cross-modal attention, feature enhancers, token concat of modalities |
| `head` | output heads & losses | `#0E7C74` / `#D5ECE9` | `#3CC2B4` / `#12302E` | classifier, box/class heads, LM head, mask decoder output, losses |
| `tensorop` | tensor ops (no params) | `--muted` / `--surface` | same tokens | reshape, flatten, split heads, concat, add (⊕), pooling, sampling |

### 3.2 Modality palette (tensor glyphs and the stripe on encoders/streams)
| token (`--mod-*`) | modality | light / dark | glyph texture |
|---|---|---|---|
| `img` | image / vision tokens | `#0B7FA6` / `#4CC3EA` | solid |
| `txt` | text tokens | `#A4501B` / `#F0955A` | horizontal hatch |
| `act` | robot actions / states | `#5C7A12` / `#A9CF4F` | dots |
| `aud` | audio (Whisper, later) | `#8A6D00` / `#E5C443` | vertical hatch |
| `lat` | latent / noise (diffusion) | `#6B6F76` / `#B4B9C0` | speckle |
| `qry` | learned queries (DETR, Q-Former) | `#3D4FAE` / `#97A6FF` | outline only |
Modality is also encoded by texture (not only hue) for color-blind readers. `tools/contrast-check.mjs`
computes every pair the diagram uses (stroke vs `--surface`, label text vs fill) in both themes and
fails under 3:1 (graphics) / 4.5:1 (text); the shell agent may adjust hexes and must update this table.

### 3.3 Edge styles (connections)
| kind | look | meaning |
|---|---|---|
| `data` | solid 1.75 px `--muted` (`--rule-strong` fails 3:1), filled arrowhead | main data flow (carries the tensor label) |
| `residual` | dashed 6/4, `--ink` at 70 %, routed as a rounded bypass, ends in an `⊕` node | residual connection inside a block |
| `skip` | long dash-dot, `--op-conv`, routed outside the main column | long-range skip (U-Net, FPN, encoder→decoder features) |
| `cross` | double line (two 1 px strokes) in `--op-fuse`, hollow arrowhead, tag "K,V" | cross-attention: K and V come from another stream |
| `query` | dotted `--mod-qry` | learned queries entering a decoder |
| `control` | thin dotted `--muted`, no tensor label | masks, conditioning scalars (timestep, prompt type) |
Every `data`/`cross`/`query`/`skip` edge carries a **shape label** (§7.4) from the calculator.

### 3.4 Signature details (keep them)
1. **Ficha técnica** strip on model pages (paper · year · canonical config · params · tokens · GMACs),
   every number generated from the calculator.
2. **Tensors drawn to proportion** (§7.3): a 197-token sequence looks long, a 2048-channel map looks deep.
3. **Legend** pinned to every diagram (collapsible on mobile) with exactly the colors used in it.
4. **Familias** strip in the Mapa: one cell per model, state `done/progress/ready/soon` (the Ronda's
   uptime strip, regrouped by family).

Layout: as the Ronda (≥ 1200 px sidebar | content | TOC; 768–1199 sidebar + content; < 768 top bar +
drawer). Diagram blocks may break out of `--content-max` up to 1100 px on wide screens
(`.wide` figure) — they are the main reading surface.

## 4. Shell architecture

### 4.1 Pages and ids (ids are persistence keys: never rename)
- `inicio` (home), `mapa` (family map), `repaso-atencion`, model pages (ids in catalog, kebab-case,
  e.g. `vit`, `swin`, `clip`, `detr`, `grounding-dino`, `yolo-world`, `sam`, `llm-decoder`,
  `llm-inferencia`, `llava`, `qwen2-vl`, `diffusion`, `vla`…), `practica` (hub), `practica-<model>`
  (drills of one model), `flashcards`, `ref-formas` (shapes & formulas sheet), `glosario`, `buscar`.
- Sidebar groups: **Inicio** · **Mapa** · **Repaso de atención** · **Bloque 1 — Visión + atención**
  · **Bloque 2 — LLMs, retrieval y ML de industria** · **Bloque 3 — Robótica** · **Práctica**
  (Ejercicios, Flashcards) · **Referencia** (Formas y fórmulas, Glosario). Each model item shows its
  short name, state marker (✓ / progress ring / "Próx.").

### 4.2–4.3 dom, routing
As the Ronda (§4.2–4.3 of its SPEC) with `ATLAS.dom`; hash routes `#<page>` / `#<page>.<section>` /
`#<page>.<section>.<sub>`; extra route forms for diagrams: `#vit.diagrama~enc-layer` opens the
diagram of that section expanded on block `enc-layer` (`~` is allowed in artifact hashes). When a
node id appears in more than one view of the section (e.g. the `in`/`out` io nodes of every level-(b)
view), use the qualified form `#<page>.<section>~<diagramId>.<nodeId>` (`#vit.diagrama~vit-mlp.in`):
the router expands that view (`dg.expand(diagramId)`) and then calls `dg.focusNode(nodeId)`. The
unqualified `~<nodeId>` stays valid only while the id is unique in the section: the validator errors on
an ambiguous unqualified link, and `ATLAS.nodeHref(page, section, node, diagramId)` (registry) emits
the qualified form only when needed (search results and the "Ver en el diagrama" links use it).
`document.title` = `<page> · Atlas de Arquitecturas`. Keys: `/` search, `[` `]` prev/next page,
`Esc` closes panels, and inside a focused diagram §7.7.

### 4.4 `ATLAS.store`
Fork of `MSD.store` (two-tier: localStorage `atlas.v1` + claude.ai account db when published with
capabilities `{db:{}, user:{}}`; tab merge; export/import). Keep: sections read, page completed,
checklists, flashcards (Leitner 5 boxes, intervals [0,1,3,7,16] days), prefs (theme, legendOpen,
showNumbers), lastLocation. Drop: practice attempts/rubric/drafts. Add:
```js
store.drillResult(drillId, {ok:bool, answer:string})   // shape drills, what-if, blank diagrams
store.drillStats(prefix?) → {seen, ok, streak, lastAt}  // per model or global
store.blankDiagram(diagramId) → {filled:{slotId:answerId}, checkedAt?}
store.setBlankSlot(diagramId, slotId, answerId|null)
```
`store.courseProgress()` counts model pages + `repaso-atencion` (not the map or references).

### 4.5 Pages the shell renders
- **inicio**: purpose (one paragraph), the families strip + "X de N modelos", continue where you left
  off, next recommended, flashcards due, drill streak, roadmap from `catalog.roadmap`, study loop
  (diagrama → recorrido con números → costo → preguntas → práctica → flashcards).
- **mapa**: §5.5.
- **Model page**: header (eyebrow "Bloque 1 · Visión + atención", h1, `titleEn` mono, one-line
  summary, **ficha técnica** strip, "Viene de / Lleva a" chips from the catalog graph), then the 11
  template sections (§5.3) with read toggles, TOC with read ticks, template navigator 1–11, prev/next
  in course order, "Marcar como completado".
- **Próximamente** page for not-ready models: title, summary, topics, canonical config planned, paper,
  connections, and its map card.
- **Search** over page titles, section titles, block/sub-block names of diagrams, glossary,
  flashcards (as the Ronda).
- **Sidebar footer**: storage status, theme switch, export/import (as the Ronda).

## 5. Content format (long-lived contract)

### 5.1 Registry API (`js/core/registry.js`)
Same shape as the Ronda's (`defineCatalog, register, addSection, getPage, listPages, courseOrder,
flashcards, glossary, searchIndex, catalog(), registryProblems, registeredIds, slug, stripHtml`) plus
`ATLAS.MODEL_TEMPLATE` (§5.3), `ATLAS.OP_TYPES`, `ATLAS.MODALITIES`, `ATLAS.EDGE_KINDS`,
`ATLAS.families()`, `ATLAS.diagram(id)` (registered diagram specs), `ATLAS.registerDiagram(spec)`.

### 5.2 Catalog (`js/content/catalog.js`)
```js
ATLAS.defineCatalog({ version: 1,
  families: [ {id:'vit', title:'Vision Transformers', titleEn, summary, kind:'family'} , … ],   // §5.5
  items: {
    vit: { id:'vit', kind:'model', block:1, num:1, family:'vit', title:'ViT — Vision Transformer',
           titleEn:'Vision Transformer', short:'ViT', summary, topics:[…], freq:'alta'|'media'|'baja',
           minutes, from:['repaso-atencion','resnet*'], to:['swin','clip','sam','llava'],
           paper:{ title:'An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale',
                   authors:'Dosovitskiy et al.', venue:'ICLR 2021', arxiv:'2010.11929' },
           canonical:'vit-b16-224', level:2 },
    // level-1 entries (map cards only, no page): kind:'card', level:1
    inicio:{…kind:'special'}, mapa:{…}, 'repaso-atencion':{…kind:'recap'}, practica:{…},
    flashcards:{…}, 'ref-formas':{…}, glosario:{…} },
  roadmap: [ {phase:1, title:'Fase 1 — …', status:'done'|'next'|'later', items:[ids], note:html} ],
  flashcards: [], glossary: [] });
```
`from` entries ending in `*` are "things you already know" outside the atlas (ResNet, YOLO): the map
draws them as grey anchor nodes.

### 5.3 Model page template (MANDATORY; ids fixed, order fixed)
| # | id | título | must contain |
|---|---|---|---|
| 1 | `para-que` | Para qué sirve | entradas → salidas in one sentence; when to use it / when not (table or two lists) |
| 2 | `puente` | Puente con lo que ya sabes | "como ResNet/YOLO, pero…" (or vs. an earlier atlas model); a comparison table of the 3–5 concepts that map 1:1 and the 1–2 that are genuinely new |
| 3 | `diagrama` | Diagrama de bloques | `archdiagram` block, overview + every expandable block (§7); legend; walk mode |
| 4 | `operaciones` | Operaciones por bloque | per block: `op` blocks (§5.4) with exact LaTeX, input/output shapes, what and **why**; then `trace` block: the full walk with numbers of the canonical example (e.g. 224×224×3 → … → 1000 logits) |
| 5 | `costo` | Parámetros y costo | `params` table and `flops` table (generated, arithmetic shown), `scaling` explorer (resolution / tokens / context), the scaling law in words ("×2 resolución → ×4 tokens → ×16 en la matriz de atención…") |
| 6 | `entrenamiento` | Entrenamiento | loss with formula, data (dataset names + sizes as stated in the paper), objective, recipe facts that interviewers ask (warmup, augmentation, resolution fine-tuning…) |
| 7 | `inferencia` | Inferencia | steps; what dominates latency and memory (with calculator numbers); common tricks |
| 8 | `fallas` | Cómo falla y trade-offs | 2–4 failure modes; comparison table vs alternatives (rows = criteria) |
| 9 | `variantes` | Variantes y descendientes | one line each, linked to atlas pages when they exist |
| 10 | `entrevista` | Preguntas de entrevista | `followups` (junior vs senior) and `qa`; traps flagged with `trap: true` |
| 11 | `practica` | Práctica activa | `blankdiagram`, `shapedrill`, `whatif` blocks + link to the page's flashcards |
A page may register sub-pages only through the catalog (e.g. `llm-decoder` + `llm-inferencia`), never
by adding template sections. Sections can have `priority:'core'|'extra'|'skip'` ("Sáltate esto").

### 5.4 Block types
All Ronda block types (`p h3 list callout table kv steps calc qa followups tradeoffs checklist quiz
code html`) with the same fields and callout kinds (`why trap senior skip estimate connect interview
note`), plus:
- `{t:'math', tex, display?:true, caption?}` — LaTeX via `ATLAS.MathTex`. Inline LaTeX inside any html
  field with `\( … \)`.
- `{t:'op', block:'<diagram node id>', model, title, tex, in:[tensorId], out:[tensorId], what:html,
  why:html, params?:true, flops?:true, diagram?:'<diagram id>', scope?:'<path id>'}` — the per-block card of section 4.
  `diagram` picks which diagram's node to read when the id repeats (e.g. `qkv` in `swin-wmsa` and
  `swin-swmsa`); `scope` restricts the ops to a path id (e.g. `txt-encoder` in CLIP). The card honours
  the node's `costOf` / `scope` / `opsExact` marks exactly like the diagram tooltip. Shapes, parameter and MAC
  counts are pulled from the calculator by tensor/node id; the author writes only prose and LaTeX.
- `{t:'trace', model, config?, from?, to?}` — the numeric walk: a generated table of every tensor in
  forward order (step, op, formula, symbolic shape, numeric shape, elements, note). Clicking a row
  highlights the tensor in the page's diagram.
- `{t:'params', model, config?, group?:'block'|'layer'|'op'}` — generated table: block, formula
  (LaTeX), count, % of total; total row equals the calculator's total.
- `{t:'flops', model, config?}` — generated table in MACs and FLOPs (FLOPs = 2 × MACs), per block,
  with the formula and % of total; footnote on the MACs-vs-FLOPs convention (§6.2).
- `{t:'scaling', model, knobs:[{key:'res', values:[224,384,448,512]} …], show:['tokens','params','macs','attnMem','kvCache'…]}`
  — interactive explorer (sliders/chips); every number recomputed by the calculator; a small log-log
  chart of the chosen metric.
- `{t:'archdiagram', diagram:'<diagram id>', walk?:'<walk id>', wide?:true, caption?}` — §7.
- `{t:'viz', kind:'<viz name>', params:{…}, caption?}` — key-idea visualization (§7.8).
- `{t:'compare', models:[ids], rows:[metric keys]}` — generated side-by-side table from the calculator
  (params, tokens, MACs at canonical config) for the trade-offs sections.
- `{t:'blankdiagram', diagram, slots:[{node|edge, ask:'label'|'shape'|'op', options?:[…]}]}` — §8.1.
- `{t:'shapedrill', model, pool:[tensorIds]|'all', configs?:[configIds]}` — §8.2.
- `{t:'whatif', items:[{q, change:{key:value}, ask:'tokens'|'params'|'macs'|'attnMem'|'kv', options?}]}` — §8.3.
- `{t:'card', family|model}` — a map card (§5.5) embedded inline.
- `{t:'formulas', prims?:[ids]}` — generated table of primitives (`ATLAS.Arch.primitives()`): name,
  params formula, MACs formula, output shape (LaTeX). Used by `ref-formas`.
Links to the Laboratorio in any html field: `<a href="lab:paso">…</a>`, `lab:entrenamiento`,
`lab:generacion`, `lab:datos`, `lab:paso-<n>`; the shell rewrites them with `ATLAS.labLink` (§10.3).
Inline HTML whitelist and number conventions as the Ronda: `<b> <strong> <i> <em> <code> <a href>
<br> <sub> <sup> <kbd> <span class="en"> <span class="est">`; decimal point, comma thousands
(86,567,656); `≈` for rounded values; **estimates** wrapped in `<span class="est">`. Inline quantities
from the calculator: `{{vit-b16-224.params.total}}`, `{{vit-b16-224.tokens}}` (§6.6) — prefer these
over typed numbers whenever a number is architectural.

### 5.5 The Map (`mapa`)
- A hand-laid SVG (same diagram engine, `kind:'map'` spec) of families as regions and models as
  nodes, with typed relation edges: `hereda` (descendant), `usa` (uses as a component: LLaVA usa CLIP
  ViT-L/14), `contrasta` (alternative to), `reemplaza`. Anchors for what the user already knows
  (ResNet, YOLO) in grey. Clicking a node opens its card; ready models link to their page.
- Under it, one **card** per family and per model (level 1 for `kind:'card'` entries): inputs →
  outputs, one-line idea, where it's used, canonical size, paper, "nivel 2 en: <page>" or "solo nivel 1".
- A table "¿Qué familia uso para…?" (task → family → why) and a "tres sabores de transformer" table
  (encoder-only / decoder-only / encoder-decoder: mask, objective, examples) — the recap of the three
  masks lives here and in `repaso-atencion`.

### 5.6 Reference sheet (`ref-formas`)
Generated, not hand-written: for each primitive (§6.3) its param formula, MAC formula and output
shape (LaTeX), and for each ready model a compact table (tokens, D, L, heads, params, MACs at the
canonical config) via `compare`. Plus hand-written sections (allowed prose): rules of thumb (params
of a transformer layer ≈ 12 D², MACs per token ≈ params for the linear parts, i.e. FLOPs per token ≈ 2·params, attention term
N²·D…), each one verified by a calculator assertion in `tests/arch.test.cjs` (§9.2).

## 6. The architecture calculator (`ATLAS.Arch`) — single source of numbers

### 6.1 Purpose
Every shape, parameter count and MAC/FLOP count in the app is computed here, in plain JS that runs in
the browser (diagrams, tables, drills, scaling explorer) and in Node (tests, validator). Nothing
architectural is typed by hand anywhere else.

### 6.2 Conventions (state them in the UI footnotes and in `ref-formas`)
- Shapes **without batch** by default, row-major "tokens × channels": `N×D`, images `H×W×C`
  (channels-last in text; note that PyTorch is `C×H×W`). Batch appears only in memory/throughput
  numbers, as an explicit `B`.
- Symbols (shared with the Lab; mapping table in `repaso-atencion`): `N` tokens (ViT: patches),
  `D` model width, `h` heads, `d_h = D/h`, `L` layers, `D_mlp` MLP hidden size, `P` patch size,
  `H, W` image size, `C` channels, `V` vocabulary, `K` classes, `T` text/sequence length when a second
  stream exists (CLIP, VLMs), `M` window size (Swin), `Q` queries (DETR). Lab ↔ Atlas: `T↔N`,
  `d↔D`, `d_k↔d_h`, `d_ff↔D_mlp`.
- **Parameters**: exact integers, biases included when the reference implementation has them (the
  config says so per layer). Buffers (fixed sinusoidal PE, relative position index) are not
  parameters; learned tables (relative position bias in Swin) are.
- **MACs**: multiply-accumulates of matmuls/convs (count `m·n·k` for an `m×k · k×n` matmul).
  **FLOPs = 2 × MACs.** Elementwise ops, softmax, norms and activations are reported separately as
  "otros (≈)" and excluded from the headline number, and the UI says so. Trap to flag everywhere:
  many papers and tools (fvcore, the DeiT/Swin tables) report **MACs under the name "FLOPs"** — the
  ≈ 17.5 "GFLOPs" usually quoted for ViT-B/16 @224 are ≈ 17.5 **GMACs** (the F1 reviewers confirm the
  exact table and figure before the page quotes it).
- Attention MACs = projections + `QKᵀ` (N·N·D) + `A·V` (N·N·D) + output projection; attention
  **memory** reports the `h×N×N` score tensor in fp16/bf16 bytes (and notes FlashAttention avoids
  materializing it).
- Every number has a provenance: `computed` (calculator), `paper` (quoted from a cited table, with
  table number) or `estimate` (rendered with `.est`). Paper numbers that disagree with the calculator
  are shown side by side with an explanation (e.g. MACs vs FLOPs, or a different head), never silently
  replaced.

### 6.3 Primitives (`js/arch/primitives.js`)
Each primitive is a pure function `(inShape, cfg) → {out:Shape, params:int, macs:int, other?:int,
paramFormula:tex, macFormula:tex, detail:{…}}`. A `Shape` is `{sym:['N+1','D'], num:[197,768],
mod:'img'|'txt'|…, layout:'seq'|'grid'|'vec'|'heads'}`. Required in Phase 1:
`linear, conv2d (incl. patchify), layernorm, rmsnorm, gelu, embedding_lookup, pos_embed_learned,
cls_token, concat_tokens, split_heads, merge_heads, attention_scores, softmax, attention_weighted_sum,
mhsa (composite: qkv → split → scores → softmax → ·V → merge → proj), mlp (composite), residual_add,
transformer_block (pre-LN composite), pool_cls, classifier_head`. Later phases add their own
(window_attention, patch_merging, cross_attention, deformable_attention, rope, gqa, swiglu, moe,
unet_block, timestep_embed…) in `primitives.js` (shared) or in their model file (model-specific) —
each new primitive comes with tests.

### 6.4 Model definitions (`js/arch/<model>.js`)
```js
ATLAS.Arch.defineModel({
  id: 'vit',
  configs: {
    'vit-b16-224': { label:'ViT-B/16 @ 224', H:224, W:224, C:3, P:16, D:768, L:12, h:12, Dmlp:3072, K:1000,
                     qkvBias:true, source:'Dosovitskiy et al. 2021, Tabla 1 (ViT-Base); cabeza de 1000 clases como timm vit_base_patch16_224',
                     canonical:true },
    'vit-l16-224': {…}, 'vit-h14-224': {…}, 'vit-s16-224': {…, source:'DeiT (Touvron et al. 2021)'},
  },
  knobs: { res:[224,384,512], P:[8,14,16,32] },            // for the scaling explorer / what-if
  build(cfg, A) {                                           // A = primitives, returns a Graph
    const g = A.graph(cfg);
    const x0 = g.input('img', A.shape(['H','W','C'], [cfg.H, cfg.W, cfg.C], 'img', 'grid'));
    const p = g.op('patch-embed', A.conv2d(x0, {k:cfg.P, s:cfg.P, cout:cfg.D, bias:true}), {node:'patch-embed'});
    // … every op gets a stable id; node = the diagram node it belongs to; tensors get stable ids
    return g;
  },
});
```
`ATLAS.Arch.run(configId) → {tensors:{id:{shape, producer, consumers}}, ops:[{id,node,prim,params,macs,…}],
totals:{params, macs, flops, other, byNode:{…}, byGroup:{…}}, quantities:{tokens, …}}` (memoized).
Tensor and op ids are **contracts** with diagrams (§7), content (`op`/`trace` blocks), drills and the
cross-check (§9.3): kebab-case, stable, never renamed once shipped.

### 6.5 Derived metrics (for scaling/what-if)
`ATLAS.Arch.metrics(configId, overrides) → {tokens, params, macs, flops, attnMacsShare, attnMem(bytes,
dtype), actMem(B,dtype), kvCache(B,ctx,dtype)?…}`; `overrides` may change only `knobs`.

### 6.6 Quantities in prose (`js/core/quantities.js`)
`{{<configId>.<path>}}` in any html field → formatted number (`params.total` → `86,567,656`;
`params.totalM` → `86.6 M`; `macs.totalG` → `17.56 G`; `tokens`; `tensor.<id>.shape` → `197×768`;
`tensor.<id>.sym` → `(N+1)×D`). Unknown keys are validator errors and render as a visible warning.

### 6.7 Exact result of `ATLAS.Arch.run(configId)` (contract for diagram, blocks, practice, validator)
```js
{ id:'vit-b16-224', model:'vit', label:'ViT-B/16 @ 224', config:{…resolved config…}, paper:{…},
  tensors: { 'x-patches': { id, sym:['N','D'], num:[196,768], mod:'img', layout:'seq'|'grid'|'heads'|'vec',
                            tex:'X_p', label:'Patches embebidos', producer:'patch-flatten'|null, consumers:[opId],
                            perLayer:false } },
  order: ['x-img', 'x-patch-grid', …],          // tensor ids in forward order (one layer shown for repeated blocks)
  ops: [ { id:'qkv', prim:'linear', label:'Proyección Q, K, V', path:['encoder','enc-layer','mhsa','qkv'],
           in:['h-ln1'], out:['qkv'], repeat:12,  // how many times it runs (per-layer ops: L); totals multiply by it
           params:1771776, macs:348585984, other:0,
           paramTex:'D\cdot 3D + 3D', paramArith:'768·2304 + 2304 = 1,771,776',
           macTex:'(N+1)\cdot D\cdot 3D', macArith:'197·768·2304 = 348,585,984',
           shapeTex:'(N{+}1)\times D \to (N{+}1)\times 3D' } ],
  totals: { params, macs, flops /* = 2·macs */, other,
            byNode: { [nodeId]: {params, macs} },  // every node id appearing in any op.path (aggregated ×repeat)
            byPrim: { linear:{params,macs}, … } },
  quantities: { tokens:197, patches:196, … }        // flat, model-specific extras for {{…}}
}
```
- `op.path` lists the diagram node ids from the outermost group to the innermost node; a node's
  params/MACs in a tooltip = `totals.byNode[nodeId]`, so overview and expanded views agree by construction.
- Per-layer numbers (one layer) are `params/macs` of the op; whole-model contribution = `× repeat`.
- `ATLAS.Arch.fmt`: `int(n)` → `86,567,656` · `si(n)` → `86.6 M` / `17.56 G` · `shape(t,'num')` →
  `197×768` · `shape(t,'sym')` → `(N+1)×D` (plain text) · `shapeTex(t)` → LaTeX.
- `ATLAS.Arch.configs(model?)` → `[{id,label,model,canonical}]`; `ATLAS.Arch.models()` → model ids;
  `ATLAS.Arch.primitives()` → `[{id, paramTex, macTex, outTex, note}]` (for `ref-formas`).
- Errors (unknown config, invalid knob) throw `Error` with a Spanish message; the UI shows it inline.

## 7. Architecture diagrams (`ATLAS.ArchDiagram`) — the core component

### 7.1 Principles
- **Hand-laid per model**: authors place every node on a grid (no auto-layout); the engine only
  routes edges (orthogonal with rounded corners, through optional `via` points) and draws.
- Flow left→right for pipelines (CLIP, VLMs, VLA), top→bottom for deep stacks (encoder layers); no
  unnecessary crossings (validator §9.1 counts crossings of `data` edges and fails above the spec's
  declared `maxCrossings`, default 0).
- Two zoom levels: **(a) overview** of the whole model; **(b) expanded** view of a block showing its
  sub-operations (e.g. MHSA → Q/K/V projections → split into heads → QKᵀ/√d_h → softmax → ·V →
  concat → W_O). Expanding animates the viewBox into the block and swaps in the sub-diagram, with a
  breadcrumb ("ViT-B/16 › Encoder layer × 12 › MHSA"). Up to 3 levels are allowed when a block nests
  (encoder layer → MHSA → one head).
- **The diagram must be understood without reading the page text** (review criterion §9.4): labels
  on blocks, shapes on edges, legend, repeat/parallel markers, and a one-line `caption` are enough.

### 7.2 Spec (`js/content/diagrams/<page>.js` → `ATLAS.registerDiagram(spec)`)
```js
{ id:'vit-overview', model:'vit', config:'vit-b16-224', kind:'arch'|'map', title, caption,
  page:'vit', section:'diagrama',             // where it lives (search + `#page.section~node` routes): a root diagram must be
                                              // in an archdiagram block of that section; level-(b) views repeat their parent's page/section.
                                              // Node ids should be unique per section (io nodes may repeat: link them as ~<diagramId>.<nodeId>, §4.2)
  parent?:'vit-overview', parentNode?:'enc-layer',   // for level-(b) views: which block it expands
  grid:{w:120, h:70},                       // units (1 unit = 8 px at 100 %)
  direction:'lr'|'tb', maxCrossings:0,
  groups:[ {id:'encoder', label:'Transformer encoder', x,y,w,h, repeat:{sym:'L', from:'L'} /* "×L = 12" from config */,
            modality?:'img'} ],
  nodes:[ {id:'patch-embed', op:'embed'|'attn'|'norm'|'mlp'|'conv'|'fuse'|'head'|'tensorop'|'io',
           label:'Patch embedding', sub:'conv 16×16, s=16', x,y,w,h,
           expand?:'vit-patch-embed' /* id of a level-(b) diagram */,
           heads?:'h' /* draw a fanned deck of h cards */, parallel?:n, shape?:'add'|'concat'|'split'|'rect',
           ops:['patch-embed'] /* calculator op ids → tooltip params/MACs */, tex?:'…' /* tooltip formula */,
           note:html /* detail panel: what + why */ } ],
  tensors:[ {id:'x-patches', at:{x,y}|{edge:'patch-embed>flatten', t:0.5}, show:'glyph'|'label'|'both'} ],
  edges:[ {from, to, kind:'data'|'residual'|'skip'|'cross'|'query'|'control', tensor?:'x-patches',
           fromSide?, toSide?, via?:[[x,y]], tag?:'K,V'} ],
  walks:[ {id:'forward', label:'Recorrido con números', steps:[ {nodes:[ids], edges:['a>b'], tensors:[ids],
           text:html /* uses {{…}} quantities */, expand?:'diagram id'} ]} ],
  legend:'auto' }
```
Edges never carry free-text shapes: a `data/cross/query/skip` edge must name a `tensor` (validator
error otherwise), and its label is rendered from the calculator. Walk steps reference ids only.

### 7.3 Tensor glyphs (proportional)
A tensor is drawn as a small isometric box whose three visible extents map to its dims:
- `seq` (`N×D`): length ∝ `log2(N)`, depth ∝ `log2(D)`; `grid` (`H×W×C`): face ∝ `log2(H)`,
  `log2(W)`, depth ∝ `log2(C)`; `heads` (`h×N×d_h`): a stack of `min(h,8)` thin slabs with "×h";
  `vec`: a thin bar. Log scaling with clamps (min 6 px, max 64 px per extent at 100 %) so 197 vs 50
  tokens or 768 vs 2048 channels are visibly different without one tensor dwarfing the figure.
- Fill = modality color (§3.2) at 18 % + texture; stroke = modality color.
- Label next to the glyph or on the edge: symbolic shape on top (`(N+1)×D`), numbers below (`197×768`),
  both in mono; toggle "Mostrar números" (pref `showNumbers`, default on).

### 7.4 Visual grammar
- Op blocks: rounded rects (r = 4) filled with `--op-*-soft`, 1.5 px stroke `--op-*`, label 13 px
  semibold, `sub` 11.5 px mono muted. Tensor ops (`tensorop`) are small circles/pills: ⊕ add, ‖ concat,
  ✂ split, ⤓ pool. Learnable-parameter badge (small key-shaped tick + count, e.g. "1.77 M") at the
  top-right of blocks with parameters, from the calculator.
- `repeat` groups: frame with the label "× L = 12" and two offset shadow frames behind (a stack).
- `heads`: fanned deck of cards (offset 3 px each, up to 8 drawn) with "h = 12".
- Parallel encoders (CLIP image ‖ text): side-by-side columns with modality stripes, joined at the
  fusion node; parallel branches are vertically aligned.
- Residuals bypass on the left/outside of the main column and join at a ⊕; never cross the data path.
- Cross-attention edges arrive at the side of the attention block, tagged "K,V"; the query path
  arrives from below/above.

Decided after the Phase 1 review: parameter badges sit at the **top-left** of blocks (top-right
collided with incoming shape labels); the three edges out of a head split carry neutral `Q`/`K`/`V`
tags (not the cross-attention tag style); memory is always printed in **decimal** units via
`ATLAS.Arch.fmt.bytes` (1 KB = 1000 B) and compute as `GMACs`/`GFLOPs` via `ATLAS.Arch.fmt.ops`; any
"attention share" names which one it is: *atención (solo QKᵀ y A·V)* = `scoreMacsShare`, *bloque de
atención (con proyecciones)* = `attnMacsShare`. On ViT pages `N` = patches and the sequence is N+1;
in generic recaps `N` = sequence length.

### 7.5 Interaction
- **Hover / focus** on a node or edge → tooltip: name, formula (MathJax), input → output shapes
  (symbols and numbers), params and MACs (from `ops`). Touch: first tap = tooltip, second tap = open.
- **Click / Enter** → detail panel (right side ≥ 1024 px; bottom sheet on mobile): `note`, formula,
  shapes, params with the arithmetic (`768·2304 + 2304 = 1,771,776`), MACs with arithmetic, link to
  the matching `op` card in section 4 and the "Abrir bloque" button if `expand` exists.
- **Expand** (double-click, "Abrir bloque" button, or `+` key) → level (b) with breadcrumb; `Backspace`
  / breadcrumb / "Volver" returns.
- **Walk mode** ("Recorrido"): Anterior / Siguiente / play; the active nodes/edges/tensors light up
  (others dim to 35 %), the step text shows the numeric example, expanded views open automatically
  when a step requires it; the `trace` table row of the active tensor is highlighted if visible.
- Toolbar per diagram: zoom −/+/ajustar, "Mostrar números", "Leyenda", "Recorrido", "Pantalla
  completa" (CSS full-viewport overlay — not the Fullscreen API, which artifacts may block).

### 7.6 Pan/zoom and responsiveness
Pointer-events pan (drag) and pinch-zoom inside the diagram viewport (`touch-action:none` only on the
viewport; page scroll still works outside it and with two-finger scroll on desktop needing Ctrl/⌘ for
zoom). Min zoom = fit width; max 4×. On < 768 px the diagram opens at fit-width with a "Toca para
explorar" hint; the legend collapses into a chip row.

### 7.7 Accessibility
Every node and labelled edge is focusable (`role="button"`, `aria-label` with name + shapes). Arrow
keys move along `data` edges (→/↓ next, ←/↑ previous; on parallel sibling edges such as Q/K/V, ←/→ cycle between them), Tab cycles nodes in spec order, Enter opens,
`+`/`-` expand/collapse, `Esc` closes the panel. Under every diagram a `<details>` "Bloques y formas"
lists every node with its shapes, params and note (text alternative).

### 7.8 Key-idea visualizations (`js/ui/viz/<name>.js`, `ATLAS.Viz.register(name, render)`)
Hand-made, interactive, theme-aware, driven by calculator numbers. Planned:
`patchify` (F1: a 224×224 image — procedurally drawn scene, no external images — split into the 14×14
grid, flattened to 196 tokens + CLS, position embeddings; slider for P and resolution),
`attention-map` (F1, recap: one query token's attention over the patches; synthetic but labelled as
illustrative), `shifted-windows` (Swin), `similarity-matrix` (CLIP, with InfoNCE row/column softmax),
`hungarian` (DETR: queries ↔ GT boxes, cost matrix, assignment), `causal-mask` + `kv-cache` growing
(LLM), `dynamic-resolution` (Qwen2-VL), `prompt-to-mask` (SAM), `denoise` (diffusion), `action-chunk`
(VLA). Any synthetic data is labelled "ilustrativo".

### 7.9 JS API (contract for blocks, practice and the map)
```js
const dg = ATLAS.ArchDiagram.render(diagramId, containerEl, {
  mode: 'full' | 'mini' | 'blank',      // mini = no toolbar/panel (drills); blank = practice §8.1
  walk?: walkId, wide?: bool, showNumbers?: bool,
  blank?: { slots:[{id /* node id or 'from>to' */, ask:'label'|'shape'|'op'}], onSlot(slotId, anchorEl) },
  onSelect?(nodeId), onExpand?(diagramId),
});
dg.el; dg.expand(diagramId); dg.collapse(); dg.focusNode(nodeId);
dg.highlight({ nodes:[], edges:['a>b'], tensors:[] }); dg.clearHighlight();
dg.setSlot(slotId, text, state /* 'empty'|'filled'|'ok'|'bad' */);
dg.startWalk(walkId); dg.stopWalk(); dg.destroy();
ATLAS.ArchDiagram.legend(diagramId) → HTMLElement      // the legend alone (map page, ref sheet)
ATLAS.Viz.register(name, (el, params, ctx) => ({ destroy() })); ATLAS.Viz.render(name, el, params, ctx)
```
Everything reads CSS variables at render time and re-renders on theme change (`ATLAS.App.onTheme`,
or a `MutationObserver` on `<html data-theme>` + `matchMedia` listener).

## 8. Practice (`ATLAS.Practice`)

### 8.1 Blank diagrams
The same diagram with chosen slots blanked (node label, op type or edge shape). Tap a slot → choose
from options (generated distractors: other node labels of the same model, shapes from the trace with
one dim changed). "Comprobar" marks right/wrong per slot; state persisted (`store.blankDiagram`).
Distractors for shapes come from the calculator (e.g. `196×768` vs `197×768` vs `197×2304`).

### 8.2 Shape drills ("¿Qué forma tiene este tensor?")
Pick a tensor (random from the pool, any config in `configs`), highlight it on a mini diagram, ask for
its numeric shape. Free-text answer normalized (`197x768`, `197 × 768`, `(197, 768)` all accepted;
batch dim optional). Show the derivation from the trace on reveal. Also reverse drills: "¿cuántos
parámetros tiene este bloque?" with tolerance ±1 % and the formula on reveal.

### 8.3 What-if ("¿qué pasa si duplico…?")
Multiple choice or numeric: e.g. ViT-B/16 at 448 instead of 224 → tokens ×4 (196 → 784), params ≈ same
(only the position table changes and must be interpolated), attention-score MACs ×16, total MACs ≈
×4.x. Every answer computed by `ATLAS.Arch.metrics`; the explanation shows both runs side by side.

### 8.4 Flashcards
Fork of the Ronda's (Leitner, 5 boxes, Space / 1 / 2 / 3). Kinds: `forma`, `formula`, `conteo`,
`concepto`, `tradeoff`, `trampa`. Card answers may use `{{…}}` quantities and LaTeX.

### 8.5 `practica` hub
Per model: drills done/accuracy, blank diagrams completed, "mezcla" mode (random drills across all
ready models), and the flashcards due count.

### 8.6 Rendering contract between shell and practice
The shell's `blocks.js` delegates these block types to `ATLAS.Practice.renderBlock(block, el, ctx)`:
`scaling`, `blankdiagram`, `shapedrill`, `whatif` (and shows a warning box if `ATLAS.Practice` is
missing). The router calls page renderers with `(container, route, ctx)`:
`ATLAS.Practice.renderHub` (`practica`), `ATLAS.Practice.renderModel` (`practica-<model>`),
`ATLAS.Flashcards.render` (`flashcards`), `ATLAS.Reference.renderGlossary` (`glosario`).
`ctx = {store: ATLAS.store, navigate(hash), renderBlocks(blocks, el, pageCtx), pageId}`; `pageCtx`
carries `{pageId, model, config}` so generated blocks default to the page's canonical config.
`archdiagram` and `viz` blocks call `ATLAS.ArchDiagram.render` / `ATLAS.Viz.render` (§7.9); the shell
keeps the returned controllers per section so a `#page.section~node` route can call `focusNode`.

## 9. Verification (exactness is a feature)

### 9.1 Validator (`tools/validate-content.mjs`, `npm run validate`)
Loads everything `index.html` loads (in order) in Node and fails on: unknown block types or missing
fields; template sections missing/out of order; broken internal links; unknown `{{…}}` keys;
diagram specs whose nodes overlap, fall outside the grid, reference unknown op/tensor ids, have
`data` edges without `tensor`, or exceed `maxCrossings`; `op`/`trace` blocks with unknown ids;
calculator `run` failures for any config; glossary slug collisions; files not loaded by `index.html`;
digit groups typed in prose that equal a calculator quantity of the page's model (warning: "usa
`{{…}}`"); paper entries without `arxiv` (or `url`) and `venue`. Added after the Phase 1 review: LaTeX that lost
its backslashes (control chars or bare `cdot`/`frac`/`sqrt`… inside math — always write LaTeX in
`String.raw` (R``) strings); ambiguous `~node` links (use `~diagramId.nodeId`); a root diagram's
declared `section` must be the one that embeds it; map diagrams: no relation curve may pass behind a
node it doesn't connect or over a region title (`ATLAS.ArchDiagram.mapCheck`), crossings counted on
the engine's real geometry (`ATLAS.ArchDiagram.geometry`); map edges are built from `catalog.relations`.

### 9.2 Calculator tests (`tests/arch.test.cjs`)
For every primitive: shape/param/MAC unit tests on tiny configs computed by hand in the test. For every
model config: totals equal the cross-check expectations (§9.3) exactly for params, within 0.5 % for
MACs (different conventions documented per model), output shapes equal. Rules of thumb in prose are
asserted (e.g. per-layer params of ViT-B = 12·D² + 13·D within the exact formula). Anchor values for
Phase 1, recomputed independently (both must match the calculator): ViT-B/16 @224 with a 1000-class
head = **86,567,656** params (timm `vit_base_patch16_224`); ≈ **17.56 GMACs** of matmuls/convs (the "FLOPs"
figure in the DeiT/Swin tables — verify the table before quoting it).

### 9.3 Python cross-check (`crosscheck/`, dev-only)
`crosscheck/requirements.txt` (torch, timm, transformers; pinned), `crosscheck/<model>.py` builds the
**reference implementation from a config, without downloading weights** (`pretrained=False`, HF
`*Config(...)` objects built in code), counts parameters (`sum(p.numel())`), runs a forward pass on a
zero input recording every hooked module's output shape, and counts FLOPs with
`torch.utils.flop_counter.FlopCounterMode` (which reports 2 × MACs). Output:
`crosscheck/expected/<configId>.json` = `{params_total, params_by_module, shapes:{tensorId:[…]},
flops_total, source:{lib, version, ctor}}`, **committed**. The mapping from calculator tensor ids to
PyTorch module names lives in the same `.py`. `npm run crosscheck` (= `tools/crosscheck-compare.mjs`)
regenerates (needs the venv) and diffs; `tests/crosscheck.test.cjs` compares the calculator with the
committed JSON (no Python needed). Venv: `apps/atlas-arquitecturas/.venv` (gitignored,
vercelignored), created with `python3.13 -m venv .venv && .venv/bin/pip install -r crosscheck/requirements.txt`.
If a reference implementation differs from the paper (e.g. timm drops ViT's pre-logits layer), the JSON
notes it and the page says which one the numbers follow.

### 9.4 Review per phase (content-focused, like the Ronda's)
Reviewers (parallel) → verify-then-apply fixers:
1. **Exactitud técnica** — formulas, mechanisms, paper configs and citations (arXiv ids, venues,
   table numbers), no invented benchmarks.
2. **Números** — runs `npm test`, `npm run crosscheck` (if the venv exists) and recomputes by hand
   every hand-written number and every rule of thumb.
3. **Diagramas** — screenshots (light, dark, 375 px) of every diagram view and expanded block;
   checks every drawn shape against `ATLAS.Arch.run` output, layout grammar (§7.4), crossings,
   legend completeness, and the **"se entiende sin leer el texto"** test: describe the model from the
   screenshot alone and compare with the page.
4. **Entrevistador senior** — would a senior interviewer accept these answers; traps; what's missing;
   what to mark "sáltate esto".
UX/shell reviewers only in phases that change the shell (F1).

### 9.5 Commands
```
npm run validate        # §9.1
npm test                # node --test "tests/*.test.cjs"  (arch, content, store, crosscheck JSON)
npm run crosscheck      # regenerate + diff with Python (needs .venv)
npm run contrast        # tools/contrast-check.mjs (§3.2)
npm run smoke           # headless Chrome walk of every ready page, every diagram view, walk mode, drills
npm run smoke:mobile · smoke:mobile:dark · smoke:dark · smoke:tablet · smoke:dist
npm run smoke:artifact · smoke:web · smoke:offline   # artifact wrapper, service worker + lab, MathJax blocked
npm run build           # dist/atlas-arquitecturas.html + dist/artifact.html
npm run build:web       # + dist/web (manifest, icons, sw.js)   ·   build:vercel = same without re-generation
```
Smoke must assert, per diagram: renders without console errors, every edge label equals the
calculator's shape, expand/collapse works, the walk visits all steps, no horizontal page overflow at
375 px.

## 10. Build and distribution

### 10.1 Single file + Artifact
`build.mjs` (fork of the Ronda's) inlines css/js → `dist/atlas-arquitecturas.html` (double-click) and
`dist/artifact.html` (no doctype/html/head/body, starts with `<title>`); MathJax and fonts stay as
external links (allowed hosts). Publish as a claude.ai Artifact with capabilities `{db:{}, user:{}}`
only when the user asks.

### 10.2 Web (Vercel)
Fork of the Ronda's `tools/build-web.mjs` + `web/` (manifest name "Atlas de Arquitecturas", short
name "Atlas", icons redrawn, cache prefix `atlas-`) → `dist/web/`. The service worker also
runtime-caches the MathJax script and the font files (stale-while-revalidate) so formulas work offline
after the first visit. `vercel.json` with Root Directory `apps/atlas-arquitecturas`, no framework, no
install, build `npm run build:vercel`, output `dist/web`; `.vercelignore` anchored with `/` (Vercel
drops dotfiles — nothing in the build may depend on one). Deploy only when the user asks (new Vercel
project `atlas-arquitecturas`).

### 10.3 Linking the Laboratorio Transformer (approved by the user 2026-10-06)
`ATLAS.labLink(tab)` returns, by environment: web build → `lab/#<tab>` (the web build copies
`vendor/lab/index.html` to `dist/web/lab/index.html`, precached by the service worker).
`vendor/lab/index.html` is a **committed copy** of the Lab's `dist/transformer-lab.html`, regenerated
with `npm run vendor:lab` (runs `node ../transformer-lab/build.mjs` and copies) because a Vercel CLI
deploy from this folder cannot see `../transformer-lab`; `tests/content.test.cjs` warns when it is
older than the Lab's sources (only when `../transformer-lab` exists); `file://` → `../transformer-lab/index.html#<tab>`; Artifact → no
link, a note "Abre el Laboratorio Transformer (apps/transformer-lab)". Lab tabs: `paso`, `entrenamiento`,
`generacion`, `datos`, plus `#paso-<n>` (1-based step of the traced iteration) — a small change in the
Lab's `js/app.js` approved by the user, done by the orchestrator, not by Atlas agents.

## 11. Writing style (every content file)
The Ronda's §9, adapted:
- Spanish (neutral LatAm, tuteo), direct, no filler. Technical terms in English as said in interviews.
- **Always the why.** **Numeric example before notation** (first the 224×224×3 image becoming 196
  vectors of 768, then `x_p ∈ ℝ^{N×(P²C)}`). Comparison tables when two things get confused. Traps
  flagged (`callout trap`). "Sáltate esto" (`callout skip` / `priority:'skip'`) for what's rarely asked.
- Bridge from what the user knows: ResNet (stages, stride, receptive field, BatchNorm, GAP head), YOLO
  (grid, anchors, IoU, NMS, mAP), and earlier atlas pages. Point forward with `callout connect`.
- Use the paper's own config and cite it (title, first author et al., venue, year, arXiv id; table
  number when quoting a number). Paper-reported accuracies only with the table cited; otherwise none.
  Never invent benchmarks or latencies; estimates go in `.est` with how to measure them.
- Interviewer voice: "esto es lo que te van a preguntar", "esto es lo que un entrevistador anota".
- Validate with `npm run validate` until 0 errors.

## 12. Phase recipe (for the orchestrator)
- Check plan usage before each phase (`get_usage`); a phase must fit one 5-hour window (build + review
  + fixes + commits). Don't chain a phase after another in the same window unless usage is low.
- Write the phase's **shared facts** (canonical configs, tensor ids, node ids, paper citations) into
  §13+ of this SPEC before launching agents, so parallel agents agree.
- Build agents (parallel, by file ownership) → integrate → `validate`/`test`/`smoke` green → **commit**
  → reviewers (§9.4) → verify-then-apply fixers → green → **commit**. Commit messages:
  `feat(atlas): …` / `fix(atlas): apply phase N review findings (…)`.
- Phase 1 agents: shell (fork + pages), calculator + tests + cross-check, diagram engine + legend +
  `dev/diagram.html` + `patchify`, content ViT (+ its diagrams), content repaso + mapa + ref-formas +
  catalog. Later phases: one calculator+content+diagram agent per model, plus one viz agent if needed.

## 13. Phase 1 shared facts (every F1 agent MUST use exactly these)

### 13.1 ViT canonical config `vit-b16-224`
Paper: Dosovitskiy et al., *An Image is Worth 16x16 Words: Transformers for Image Recognition at
Scale*, ICLR 2021, arXiv:2010.11929 (Table 1: ViT-Base L=12, D=768, MLP 3072, heads 12, 86M).
Input 224×224×3, P=16 → N = (224/16)² = 196 patches, + CLS = 197 tokens. Pre-LN encoder, GELU,
learned 1-D position embeddings (197×768), qkv with bias, classifier = LayerNorm → CLS token →
linear 768→1000 (follows timm `vit_base_patch16_224`; the paper's pre-training head had an extra
hidden layer, dropped at fine-tuning — say so in `entrenamiento`). Other configs for drills/variants:
`vit-s16-224` (DeiT-S: D=384, L=12, h=6, MLP 1536), `vit-l16-224` (D=1024, L=24, h=16, MLP 4096),
`vit-h14-224` (D=1280, L=32, h=16, MLP 5120), `vit-b16-384`, `vit-b32-224`.

Diagram node ids (overview `vit-overview`): `input`, `patch-embed` (expand `vit-patch-embed`),
`cls`, `pos-embed`, `add-pos`, `encoder` (group, repeat L), `enc-layer` (expand `vit-enc-layer`),
`final-ln`, `pool-cls`, `head`. Expanded `vit-enc-layer`: `ln1`, `mhsa` (expand `vit-mhsa`), `res1`,
`ln2`, `mlp` (expand `vit-mlp`), `res2`. Expanded `vit-mhsa`: `qkv`, `split`, `scores`, `scale`,
`softmax`, `weighted-sum`, `merge`, `proj`.
Tensor ids (forward order): `x-img` (224×224×3), `x-patch-grid` (14×14×768), `x-patches` (196×768),
`x-cls-cat` (197×768), `x0` (197×768), `h-ln1`, `qkv` (197×2304), `q`,`k`,`v` (12×197×64 each),
`scores` (12×197×197), `attn` (12×197×197), `z-heads` (12×197×64), `z` (197×768), `o` (197×768),
`r1`, `h-ln2`, `u` (197×3072), `g` (197×3072), `f` (197×768), `x-out` (= x_L, 197×768), `x-ln`,
`cls-out` (768), `logits` (1000). Layer-internal tensors are those of one layer; the trace shows layer
1 in full and "× 12 idénticas" for the rest.

### 13.2 Attention recap (`repaso-atencion`)
Notation of §6.2; scaled dot-product attention `\mathrm{softmax}(QK^\top/\sqrt{d_h})V`, multi-head,
the three masks (bidirectional / causal / cross), pre-LN vs post-LN, cost `O(N²·D)` vs `O(N·D²)` and
where they cross (`N ≈ 6D`-ish — the calculator computes the exact crossover per config), what the Lab
covers (link each item to a Lab tab), what this app adds (vision-side shapes). Kept compact: ≤ 25 min
reading. Toy example sized like the Lab's (N=5, D=8, h=2) so the user can match numbers.
Calculator: model `transformer`, configs `toy-n5-d8` (N=5, D=8, h=2, D_mlp=32, L=1, pre-LN, bias in
qkv/proj/MLP, no embeddings: input is `x0` 5×8) and `toy-n5-d8-causal` (same, causal mask — same counts,
the mask only changes which scores are used). Tensor ids reuse ViT's layer ids (`x0`, `h-ln1`, `qkv`,
`q`, `k`, `v`, `scores`, `attn`, `z-heads`, `z`, `o`, `r1`, `h-ln2`, `u`, `g`, `f`, `x-out`); node ids
as `vit-enc-layer` / `vit-mhsa` (`ln1 mhsa res1 ln2 mlp res2` / `qkv split scores scale softmax
weighted-sum merge proj`). Diagrams: `repaso-block` (one pre-LN block, expandable to `repaso-mhsa`)
and `repaso-masks` is a `viz` (`attention-masks`: bidirectional / causal / cross, side by side).

### 13.4 Ownership in Phase 1 (who writes what)
- **shell**: index.html, css/app.css, js/core/store.js, js/ui/dom.js, js/ui/math.js, js/ui/blocks.js,
  js/app.js, build.mjs, tools/build-web.mjs, web/*, vercel.json, .vercelignore, .gitignore,
  tools/smoke.js, dev/blocks.html, tests/store.test.cjs.
- **arch**: js/arch/primitives.js, js/arch/transformer.js, js/arch/vit.js, js/core/quantities.js,
  tests/arch.test.cjs, crosscheck/**, tools/crosscheck-compare.mjs, tests/crosscheck.test.cjs.
- **diagram**: js/ui/archdiagram.js, css/diagram.css, js/ui/viz/{patchify,attention-map,attention-masks}.js,
  dev/diagram.html, tools/contrast-check.mjs, and the diagram specs js/content/diagrams/{vit,repaso,mapa}.js.
- **practice**: js/ui/practice.js, js/ui/flashcards.js, js/ui/reference.js, css/practice.css.
- **content-vit**: js/content/vit.js.
- **content-general**: js/content/catalog.js, js/content/repaso-atencion.js, js/content/mapa.js,
  js/content/ref-formas.js, tools/validate-content.mjs, tests/content.test.cjs.
- **orchestrator**: docs/*, package.json, js/core/registry.js, tools/browser-check.mjs, vendor/lab/*,
  the Lab's `#paso-<n>` change, integration.

### 13.3 Catalog ids (every agent uses exactly these; map nodes, links and `from`/`to` refer to them)
Kinds: `recap` (counts in progress), `model` (11-section page), `card` (map card only, level 1 —
`anchor:true` for things the user already knows), `special`.
- recap: `repaso-atencion` (block 0).
- Bloque 1 models (phase): `vit` (F1) · `swin`, `clip` (F2) · `detr` (F3; Deformable DETR inside it) ·
  `grounding-dino`, `yolo-world` (F4) · `sam`, `sam2` (F5) · `llm-decoder`, `llm-inferencia` (F6) ·
  `llava`, `qwen2-vl` (F7) · `stable-diffusion`, `dit` (F8; flow matching inside `dit`) · `rt2`,
  `openvla`, `pi0` (F9).
- Bloque 2: `lora`, `rlhf-dpo` (F10) · `bert`, `retrieval`, `ann` (F11) · `t5`, `whisper` (F12) ·
  `two-tower`, `dlrm`, `gbdt` (F13).
- Bloque 3: `bytetrack`, `depth`, `pointnet` (F14) · `rl-ppo`, `imitation` (F15).
- Cards: anchors `resnet`, `yolo` (anchor:true); level-1 `gnn`, `mamba`, `gan`, `rnn-lstm`, `nerf-3dgs`
  (written as full cards in F12; F1 ships a 2–3 line card for each).
- Special: `inicio`, `mapa`, `practica`, `flashcards`, `ref-formas`, `glosario`, `buscar`.
- Families (`catalog.families`, map regions): `transformer` (root: repaso), `cnn`, `vit` (ViT, Swin),
  `contrastive` (CLIP), `detect` (DETR, Grounding DINO, YOLO-World, + anchor yolo), `seg` (SAM, SAM 2),
  `llm` (decoder-only), `vlm` (LLaVA, Qwen2-VL), `gen` (Stable Diffusion, DiT, GAN card), `vla`
  (RT-2, OpenVLA, π0), `encoder` (encoder-only: BERT, retrieval), `encdec` (T5, Whisper), `align`
  (LoRA, RLHF/DPO), `search` (ANN), `recsys` (two-tower, DLRM), `trees` (GBDT), `robot` (tracking,
  depth, PointNet, RL, imitation, NeRF/3DGS), `otros` (GNN, Mamba, RNN/LSTM).
- Map relation edges (`catalog.relations`): `[{from, to, kind:'hereda'|'usa'|'contrasta'|'reemplaza', label?}]`,
  e.g. `{from:'vit', to:'swin', kind:'hereda'}`, `{from:'clip', to:'llava', kind:'usa', label:'ViT-L/14 como encoder'}`,
  `{from:'yolo', to:'detr', kind:'contrasta', label:'sin anchors ni NMS'}`.

## 14. Phase 2 shared facts — Swin + CLIP (every F2 agent MUST use exactly these)

Lessons from Phase 1 that apply to every content/diagram agent: every string with LaTeX is a
`String.raw` (R``) literal; architectural numbers only via `{{…}}` or generated blocks; deep links to a
non-unique node use `~diagramId.nodeId`; memory in decimal units (`ATLAS.Arch.fmt.bytes`), compute as
GMACs/GFLOPs (`fmt.ops`); "attention share" always says which one; Q/K/V edges tagged; flashcard and
section ids are permanent. Interview questions in English (`followups` `q`), answers in Spanish, with
an optional `say` (English phrasing of the senior answer).

### 14.1 Swin Transformer — page `swin`, model `swin`
Paper: Liu et al., *Swin Transformer: Hierarchical Vision Transformer using Shifted Windows*, ICCV 2021
(Marr Prize), arXiv:2103.14030. Canonical config **`swin-t-224`**: 224×224×3, patch P=4 (conv 4×4
stride 4 + LayerNorm, "patch partition + linear embedding"), C=96, depths [2,2,6,2], heads [3,6,12,24]
(d_h = 32 everywhere), window M=7, MLP ratio 4, qkv bias, relative position bias table
((2M−1)²×h per block, a parameter; the index is a buffer), patch merging = concat 2×2 neighbours
(4C) → LayerNorm(4C) → Linear 4C→2C **without bias**, final LayerNorm → global average pool → Linear
768→1000. Reference implementation for the cross-check: timm `swin_tiny_patch4_window7_224`
(pretrained=False). Other configs: `swin-s-224` (depths [2,2,18,2]), `swin-b-224` (C=128, heads
[4,8,16,32]), `swin-b-384` (M=12). Rule to handle and explain: when a stage's feature map is not
larger than the window (stage 4 of Swin-T: 7×7 with M=7), there is a single window and **no shift**
(timm sets shift 0) — verify against timm and say it on the page.
Stage resolutions (Swin-T @224): 56×56×96 → 28×28×192 → 14×14×384 → 7×7×768 (strides 4, 8, 16, 32 —
the same strides as ResNet's C2…C5; this is the bridge).
Ids (the arch agent may add more, never rename; full list documented at the top of js/arch/swin.js):
- overview `swin-overview` nodes: `input`, `patch-embed`, `stage1`…`stage4` (groups, repeat = depth/2
  block pairs), `merge1`…`merge3`, `final-ln`, `pool`, `head`, `output`.
- stage-1 block pair `swin-block-pair` (stage-1 numbers): `w-ln1`, `w-msa`, `w-res1`, `w-ln2`, `w-mlp`,
  `w-res2`, `sw-ln1`, `sw-msa`, `sw-res1`, `sw-ln2`, `sw-mlp`, `sw-res2`.
- `swin-wmsa` / `swin-swmsa` (expanded attention, stage 1): `partition`, `qkv`, `split`, `scores`,
  `scale`, `bias` (relative position bias add), `softmax`, `weighted-sum`, `merge`, `proj`, `reverse`;
  the shifted variant adds `shift` (cyclic shift by ⌊M/2⌋), `mask` (attention mask add), `unshift`.
- `swin-patch-merging` (merge1 numbers): `concat`, `ln`, `reduce`.
- Tensor ids follow `s{k}-b{j}-<name>` for block j (1-based) of stage k with names `in ln1 shift win
  qkv q k v scores scaled biased masked attn z proj unwin unshift r1 ln2 u g f out` (shift/masked/unshift
  only in shifted blocks), stage outputs `s{k}-out`, merging `m{k}-concat m{k}-ln m{k}-out`, plus
  `x-img x-patch-grid x-embed x-ln pooled logits`. Window tensors are laid out `nW×M²×C` (stage 1:
  64×49×96) and heads `nW×h×M²×d_h` (64×3×49×32).
- `metrics()` must report, per stage, tokens, windows and attention-score MACs, and the comparison with
  global attention at the same resolution (the "linear vs quadratic in tokens" argument with numbers).

### 14.2 ResNet-50 — calculator only (no page; anchor for the bridge)
Model `resnet`, config `resnet50-224` (He et al., *Deep Residual Learning for Image Recognition*, CVPR
2016, arXiv:1512.03385; reference torchvision `resnet50()`, weights=None). Ids: nodes `stem`, `maxpool`,
`layer1`…`layer4`, `pool`, `head`; tensors `x-img stem-out pool-out c2 c3 c4 c5 pooled logits`
(c2 56×56×256, c3 28×28×512, c4 14×14×1024, c5 7×7×2048). BatchNorm params (γ, β) count; running stats
are buffers. Used by `compare` blocks and the Swin bridge.

### 14.3 CLIP — page `clip`, model `clip`
Paper: Radford et al., *Learning Transferable Visual Models From Natural Language Supervision*, ICML
2021, arXiv:2103.00020 (400M image-text pairs "WIT"; batch 32,768; 32 epochs; learned temperature
initialised to 0.07, logit scale clipped at 100 — verify each figure against the paper before quoting).
Canonical **`clip-vit-b16`**: image tower = ViT-B/16 @224 with CLIP's differences (patch conv **without
bias**, `ln_pre` after adding positions, `ln_post` on the CLS token only, then projection 768→512
**without bias**); text tower = 12 layers, width 512, 8 heads, D_mlp 2048, vocab 49,408 (BPE),
context 77, learned positions, **causal mask**, final LayerNorm, features taken at the **EOT token**
(highest token id), projection 512→512 without bias; joint embedding E=512, both L2-normalised;
learned scalar `logit_scale`. Activation is QuickGELU in the original weights (x·σ(1.702x)) — counts
don't change. Reference implementation for the cross-check: HF `transformers.CLIPModel(CLIPConfig(...))`
built in code (no hub download). Other configs: `clip-vit-b32`, `clip-vit-l14` (image 24 layers ×
1024, 16 heads; text 12 × 768, 12 heads; E=768), `clip-vit-l14-336` (used later by LLaVA-1.5).
Batch: the per-sample towers are shown without batch; the contrastive part has an explicit batch knob
`B` (default 32,768 = the paper's; values [8, 256, 4096, 32768]) for tensors `img-batch` (B×E),
`txt-batch` (B×E), `logits` (B×B); `metrics()` reports the B×B logits memory and the number of
negatives per sample (B−1).
Ids:
- overview `clip-overview` nodes: `img-input`, `img-encoder` (expand `clip-image-encoder`),
  `img-proj`, `img-norm`, `txt-input`, `txt-encoder` (expand `clip-text-encoder`), `txt-proj`,
  `txt-norm`, `similarity`, `temperature`, `loss`.
- `clip-image-encoder`: `patch-embed`, `cls`, `pos-embed`, `add-pos`, `ln-pre`, `enc-layer`, `pool-cls`,
  `ln-post`; `clip-text-encoder`: `tokens`, `tok-embed`, `pos-embed`, `add-pos`, `enc-layer`, `ln-final`,
  `pick-eot`. Layer internals reuse the ViT layer node ids (`ln1 mhsa res1 ln2 mlp res2`, MHSA
  `qkv split scores scale softmax weighted-sum merge proj`, the text one adds `mask`).
- Op paths start with `img-encoder` or `txt-encoder`. Tensor ids: image tower prefix `i-` (`i-img
  i-patch-grid i-patches i-cls-cat i-x0 i-ln-pre`, layer tensors `i-h-ln1 … i-x-out`, `i-cls i-cls-ln
  i-emb i-emb-norm`), text tower prefix `t-` (`t-ids t-tok t-x0`, layer tensors `t-h-ln1 … t-x-out` incl.
  `t-scores t-masked t-attn`, `t-ln-final t-eot t-emb t-emb-norm`), joint `img-batch txt-batch logits loss`.

### 14.4 Visualizations (diagram agent)
`shifted-windows` (stage-1-like grid at a readable size: windows, cyclic shift by ⌊M/2⌋, the 9 regions
and the attention mask; toggle regular / shifted; numbers from the calculator), `similarity-matrix`
(B×B cosine similarities × logit scale, row softmax = image→text CE, column softmax = text→image CE,
the diagonal as positives; small B with synthetic labelled data marked "ilustrativo", plus the real
B=32,768 numbers from `metrics()`), `zero-shot` (prompts "a photo of a {label}." → text embeddings as
classifier weights; synthetic, labelled "ilustrativo").

### 14.5 Ownership in Phase 2
- **arch**: js/arch/primitives.js (new primitives only; don't change existing outputs), js/arch/swin.js,
  js/arch/clip.js, js/arch/resnet.js, tests/arch.test.cjs (append), crosscheck/{swin,clip,resnet}.py +
  expected/*.json, tests/crosscheck.test.cjs (extend), js/core/quantities.js only if a new key type is
  needed; also fix `metrics().actMem` double counting (Phase 1 leftover).
- **diagram**: js/ui/archdiagram.js + css/diagram.css (extensions only: e.g. B×B glyphs, two parallel
  towers, window grids), js/ui/viz/{shifted-windows,similarity-matrix,zero-shot}.js,
  js/content/diagrams/{swin,clip}.js, dev/diagram.html.
- **content-swin**: js/content/swin.js. **content-clip**: js/content/clip.js.
- **orchestrator**: index.html script lines (already added, with empty stubs), catalog roadmap status,
  SPEC, integration.

## 15. Phase 3 shared facts — DETR (+ Deformable DETR brief) (every F3 agent MUST use exactly these)

Phase 1–2 lessons (§14 intro) apply. The page's thesis: **detection as set prediction** — the direct
contrast with YOLO (dense grid + anchors + NMS vs 100 learned queries + Hungarian matching, no NMS).

### 15.1 DETR — page `detr`, model `detr`
Paper: Carion et al., *End-to-End Object Detection with Transformers*, ECCV 2020, arXiv:2005.12872;
official code facebookresearch/detr. Canonical config **`detr-r50-800x1216`**: input 800×1216×3 (DETR
resizes the short side to 800, long side ≤ 1333; 1216 is chosen so every stride divides exactly) →
ResNet-50 backbone (C5: 25×38×2048, stride 32; **FrozenBatchNorm** in the official code = buffers, not
parameters — verify and state which count the page follows) → input projection 1×1 conv 2048→256 →
flatten to 950 tokens → fixed 2-D sine positional encoding (256, added to Q and K in every attention,
never to V) → encoder 6 layers (d=256, 8 heads, FFN 2048, ReLU, **post-LN** as in the official code) →
decoder 6 layers with **100 object queries** (learned `query_pos` 100×256, decoder input starts at
zeros), each layer = self-attention among queries → cross-attention (Q from queries, K/V from the
950-token memory) → FFN, post-LN, final decoder LayerNorm shared by the auxiliary outputs → heads per
query: class Linear 256→92 (91 COCO ids + "no object") and box MLP 256→256→256→4 + sigmoid
(cx, cy, w, h normalised). Training: Hungarian matching with cost λ_cls·(−p̂(c)) + λ_L1·L1 +
λ_giou·(−GIoU) and loss CE (no-object weight 0.1) + L1 + GIoU, weights (1, 5, 2), auxiliary losses at
every decoder layer — verify every value against the paper/code before quoting. Second config
**`detr-r50-640`** (640×640 → 20×20 = 400 tokens) for the side-by-side with YOLO at 640.
Reference implementation for the cross-check: HF `DetrForObjectDetection(DetrConfig(...))` built in
code with a non-pretrained backbone (no hub download); if HF's parameter count differs from the
official one (e.g. BN as parameters vs frozen buffers, or q/k/v layout), record both in the JSON notes
and make the calculator follow the official repo, with a flag to reproduce HF's count.
Knobs: `res` pairs (800×1216, 640×640, 1024×1024…; must be multiples of 32), `Q` (number of queries:
100, 300), `G` (ground-truth objects in the example image, default 7 — only for the matching cost
matrix Q×G).
Ids:
- overview `detr-overview` nodes: `input`, `backbone`, `input-proj`, `pos-enc`, `flatten`,
  `encoder` (group, repeat 6) with `enc-layer` (expand `detr-enc-layer`), `queries`, `decoder` (group,
  repeat 6) with `dec-layer` (expand `detr-dec-layer`), `dec-norm`, `class-head`, `box-head`, `output`,
  `matching` (training only), `loss` (training only).
- `detr-enc-layer`: `self-attn` (expand `detr-enc-attn`), `res1`, `ln1`, `ffn`, `res2`, `ln2`, plus
  `add-pos` (pos added to Q and K only).
- `detr-dec-layer`: `self-attn`, `res1`, `ln1`, `cross-attn` (expand `detr-cross-attn`), `res2`, `ln2`,
  `ffn`, `res3`, `ln3`, plus `add-qpos`.
- attention views: `q-proj`, `k-proj`, `v-proj`, `split`, `scores`, `scale`, `softmax`, `weighted-sum`,
  `merge`, `proj` (cross-attention: Q edge from the decoder stream, K/V edges from the memory, `cross`
  edge style).
- Tensors: `x-img`, `c5`, `proj`, `memory-in` (950×256), `pos` (950×256), encoder layer `e-…`
  (`e-q e-k e-v e-scores e-attn …`), `memory` (950×256), `query-pos` (100×256), `tgt0` (100×256),
  decoder layer `d-…` (`d-self-scores` 8×100×100, `d-cross-scores` 8×100×950, …), `hs` (100×256),
  `logits` (100×92), `boxes` (100×4), `cost` (Q×G), `loss`.
- `metrics()`: encoder self-attention vs decoder cross-attention vs decoder self-attention score MACs,
  memory of the 950×950 encoder attention, and how they scale with resolution (encoder ∝ (HW/32²)²).

### 15.2 Deformable DETR — inside the `detr` page (variants + one op card + one viz), model `deformable-detr`
Paper: Zhu et al., *Deformable DETR: Deformable Transformers for End-to-End Object Detection*, ICLR
2021, arXiv:2010.04159. Config `deformable-detr-r50` (multi-scale C3–C5 + one extra stride-64 level =
4 levels, d=256, 8 heads, K=4 sampling points per head per level, 300 queries, 6+6 layers). Calculator:
primitive `deformable_attention` (sampling offsets Linear d→M·L·K·2, attention weights Linear d→M·L·K,
value Linear d→d, output Linear d→d; MACs linear in tokens: no N² term). Cross-check params (and shapes
where hookable) with HF `DeformableDetrModel` built in code; FLOPs may be analytic only if the
grid-sample path isn't counted by FlopCounterMode — say so in the JSON notes. Training: 50 epochs vs
DETR's 500 — verify.

### 15.3 Visualizations
`hungarian` (Q×G cost matrix split into its class / L1 / GIoU terms, the optimal one-to-one assignment,
unmatched queries → ∅; synthetic boxes labelled "ilustrativo"; numbers of Q and G from the config),
`set-vs-nms` (YOLO-style dense predictions with duplicates removed by NMS vs DETR's queries producing
one box per object — the bridge figure), `deformable-attention` (a reference point, K sampling points per
head across 4 levels with weights; synthetic, labelled).

### 15.4 Ownership in Phase 3
- **arch**: js/arch/primitives.js (new primitives only), js/arch/detr.js (both models), tests,
  crosscheck/detr.py + expected/*.json, crosscheck tests.
- **diagram**: engine extensions (only if needed), js/ui/viz/{hungarian,set-vs-nms,deformable-attention}.js,
  js/content/diagrams/detr.js, dev/diagram.html.
- **content-detr**: js/content/detr.js (the whole page incl. the Deformable DETR material).
- **orchestrator**: index.html lines + stubs, catalog roadmap, SPEC, integration.

## 16. Phase 4 shared facts — Grounding DINO + YOLO-World (every F4 agent MUST use exactly these)

Phase 1–3 lessons apply (§14 intro; plus: diagram captions render — screenshot them; node ids repeat across
views → `scope`/`opsExact`/`costOf` and qualified deep links; byte metrics via `fmt.bytes`; labels with
context prefixes so drills are unambiguous; practice METRICS need labels for every new metric shown).
The page pair's thesis: **open-vocabulary detection** — the class head becomes a dot product with text
embeddings; the two models sit at opposite ends of **deep fusion / phrase grounding vs fixed vocabulary
/ latency** (not "accuracy vs speed": YOLO-World-L beats Grounding DINO-T/L on LVIS minival, Grounding
DINO wins on COCO).

### 16.1 Grounding DINO — page `grounding-dino`, model `grounding-dino`
Paper: Liu et al., *Grounding DINO: Marrying DINO with Grounded Pre-Training for Open-Set Object
Detection*, ECCV 2024, arXiv:2303.05499 (official repo IDEA-Research/GroundingDINO). Canonical config
**`grounding-dino-t`**: input **896×1344×3** (chosen so every Swin stage is an exact multiple of the 7×7
window — no padding; say so on the page; DINO-style training uses short side 800), Swin-T image
backbone (reuse js/arch/swin.js pieces) giving multi-scale features (stages 2–4 + one extra stride-64
level = 4 levels, each projected to d=256), BERT-base text backbone (12 layers, 768, 12 heads, vocab
30,522; text length knob `T`, default 16, max 256) + linear 768→256, **feature enhancer** 6 layers (image:
deformable self-attention; text: self-attention; image→text and text→image cross-attention; FFNs),
**language-guided query selection** (900 queries = top-900 image tokens by max similarity to the text
tokens; positional part from the selected boxes, content part learned), **cross-modality decoder** 6
layers (self-attention, text cross-attention, image deformable cross-attention, FFN), **contrastive
classification head** (query · text-token similarity → logits over text tokens, not fixed classes;
max-text-len 256) + box MLP. Training: focal loss on contrastive logits + L1 + GIoU (contrastive
denoising only in MM-Grounding-DINO, not in the paper's model), sub-sentence text representation (attention mask so unrelated category names don't attend to
each other) — verify every detail against the paper and code before quoting.
Reference implementation for the cross-check: HF `GroundingDinoForObjectDetection(GroundingDinoConfig(...))`
built in code with non-pretrained Swin/BERT configs (no hub downloads). Params exact; deformable /
grid-sample MACs analytic (as in §15.2). Knobs: `T` (text tokens), `res` pairs (multiples of 224 for
clean Swin windows), `Q`.
Ids: overview `grounding-dino-overview` nodes `img-input`, `img-backbone` (Swin-T), `img-proj`,
`txt-input`, `txt-backbone` (BERT), `txt-proj`, `enhancer` (group ×6, expand `gdino-enhancer-layer`),
`query-select`, `decoder` (group ×6, expand `gdino-decoder-layer`), `contrastive-head`, `box-head`,
`output`, `matching`, `loss`; enhancer layer: `img-self` (deformable), `txt-self`, `i2t` (image queries
text), `t2i` (text queries image), `img-ffn`, `txt-ffn` + norms/residuals; decoder layer: `self-attn`,
`txt-cross`, `img-cross` (deformable), `ffn` + norms. Tensor prefixes: image stream `i-…`, text stream
`t-…`, queries/decoder `q-…`, outputs `logits` (Q×T), `boxes` (Q×4).

### 16.2 YOLO-World — page `yolo-world`, model `yolo-world` (+ anchor `yolov8`)
Paper: Cheng et al., *YOLO-World: Real-Time Open-Vocabulary Object Detection*, CVPR 2024,
arXiv:2401.17270 (official repo AILab-CVC/YOLO-World, built on mmyolo). Canonical **`yolo-world-l-640`**:
640×640×3 → YOLOv8-L backbone (CSPDarknet with C2f) → **RepVL-PAN** (text-guided CSPLayer T-CSPLayer
with max-sigmoid attention injecting text into image features; image-pooling attention updating text
embeddings) → per-level heads: box regression (DFL) + **region-text contrastive head** (object
embeddings · L2-normalised text embeddings, with learnable scale/shift) over a vocabulary of `V` classes
(knob, default 80) whose embeddings come from the **CLIP ViT-B/32 text encoder** (reuse js/arch/clip.js
text tower for its cost) computed once offline — "prompt-then-detect": the vocabulary becomes
re-parameterised weights, so inference doesn't run the text encoder. Loss: region-text contrastive +
IoU + DFL. Verify every detail (incl. which parts the v2 release removed) against the paper and code.
Anchor model **`yolov8`**, config `yolov8l-640` (Ultralytics YOLOv8-L, the user's familiar baseline):
calculator only, no page; used by `compare` blocks and the bridge.
Cross-check: install `ultralytics` into the dev venv **only if** building `yolov8l.yaml` /
`yolov8l-world.yaml` from YAML needs no downloads (no weights, no CLIP weights); count params and FLOPs of
the detector without the text encoder; record any architecture difference between Ultralytics'
YOLO-World and the paper/official mmyolo version in the JSON notes. If a clean build isn't possible,
fall back to analytic counts verified against the published parameter tables, and say so.
Ids: overview `yolo-world-overview` nodes `input`, `backbone` (expand optional), `neck` (RepVL-PAN, expand
`yw-repvl-pan`), `txt-encoder` (offline, CLIP text), `vocab` (V×512 embeddings), `head-box`,
`head-text`, `output`, plus a visual "offline / online" split; RepVL-PAN view: `t-csp` (T-CSPLayer with
max-sigmoid attention), `img-pool-attn`, upsample/downsample paths at strides 8/16/32. Tensors: `x-img`,
`c3 c4 c5` (strides 8/16/32), `p3 p4 p5`, `vocab`, `obj-emb-*`, `logits-*` (HW×V per level), `boxes-*`.

### 16.3 Visualizations
`open-vocab-head` (fixed-class linear head vs text-embedding head: logits = region · text; add a new
class by typing a word — synthetic embeddings, labelled "ilustrativo"), `query-selection` (Grounding DINO:
image tokens ranked by max similarity to text tokens, top-K become decoder queries), `prompt-then-detect`
(YOLO-World: offline vocabulary → weights; online cost without the text encoder vs Grounding DINO's
per-image text pass, with calculator numbers).

### 16.4 Ownership in Phase 4
- **arch**: js/arch/primitives.js (new primitives only), js/arch/grounding-dino.js, js/arch/yolo-world.js
  (incl. the `yolov8` anchor), tests, crosscheck/{grounding_dino,yolo_world}.py + expected JSONs,
  requirements.txt (pin anything installed).
- **diagram**: engine extensions (only if needed), js/ui/viz/{open-vocab-head,query-selection,prompt-then-detect}.js,
  js/content/diagrams/{grounding-dino,yolo-world}.js, dev/diagram.html.
- **content-gdino**: js/content/grounding-dino.js. **content-yoloworld**: js/content/yolo-world.js.
- **orchestrator**: index.html lines + stubs, catalog (canonical ids, roadmap status), SPEC, integration;
  practice.js METRICS labels for new metrics if the arch agent lists them (or a fixer).

## 17. Phase 5 shared facts — SAM + SAM 2 (every F5 agent MUST use exactly these)

Phase 1–4 lessons apply (§14 intro, §16 intro). Thesis: **segmentation as a promptable query** —
a heavy image encoder runs once; a light decoder answers each prompt in milliseconds; SAM 2 adds a
**memory** so the same prompt follows an object through a video (bridge to tracking, F14).

### 17.1 SAM — page `sam`, model `sam`
Paper: Kirillov et al., *Segment Anything*, ICCV 2023, arXiv:2304.02643 (repo facebookresearch/segment-anything).
Canonical **`sam-vit-h-1024`**: input 1024×1024×3 (long side resized to 1024, padded) → image encoder
**ViT-H/16** MAE-pretrained (32 blocks, D=1280, 16 heads, windowed attention 14×14 with 4 global
blocks, relative position embeddings) → 64×64×1280 → neck (1×1 conv → LN → 3×3 conv → LN) → image
embedding **64×64×256**. Prompt encoder: points/boxes → random-Fourier positional encoding + learned
type embeddings (sparse tokens); masks → conv downsampling to 64×64×256 added to the image embedding
(else a learned "no-mask" embedding). Mask decoder: **two-way transformer** (2 layers, 256, 8 heads,
MLP 2048, cross-attention with an internal downsample to 128): token self-attn → token→image
cross-attn → MLP → image→token cross-attn; final token→image attention; output tokens = 4 mask tokens
(1 single-mask + 3 multimask for ambiguity) + 1 IoU token; upscaling by 2 transposed convs to
256×256×32; per-mask-token hypernetwork MLP → dot product → masks 256×256 (upsampled to the image);
IoU head predicts mask quality. Training: SA-1B (11M images, 1.1B masks) built by a 3-stage data
engine; loss focal:dice 20:1 + IoU MSE; interactive training with sampled prompts — verify every number.
Other configs: `sam-vit-l-1024` (24 blocks, 1024), `sam-vit-b-1024` (12 blocks, 768); knobs `res`,
`P` (points), `masks` (1 or 3). Reference: HF `SamModel(SamConfig(...))` built in code (no hub).
Ids: overview `sam-overview` nodes `image`, `img-encoder` (expand `sam-encoder`), `neck`, `img-emb`,
`prompts`, `prompt-enc`, `mask-in` (dense prompt), `mask-decoder` (expand `sam-mask-decoder`),
`masks`, `iou`; `sam-encoder`: `patch-embed`, `pos-embed`, `win-blocks`, `global-blocks` (groups
showing the 14×14 windows vs global layout), `neck`; `sam-mask-decoder`: `tokens` (output + prompt
tokens), `two-way` (expand `sam-two-way`), `final-attn`, `upscale`, `hypernet`, `dot`, `iou-head`;
`sam-two-way`: `tok-self`, `tok2img`, `mlp`, `img2tok`. Tensors: `x-img`, `patches`, `enc-out`
(64×64×1280), `img-emb` (64×64×256), `sparse` (P×256), `dense` (64×64×256), `tokens` (5+P)×256,
`up-emb` (256×256×32), `masks` (3×256×256), `iou` (3).

### 17.2 SAM 2 — page `sam2`, model `sam2`
Paper: Ravi et al., *SAM 2: Segment Anything in Images and Videos*, ICLR 2025, arXiv:2408.00714
(repo facebookresearch/sam2; SAM 2.1 checkpoints share the architecture). Canonical **`sam2-hiera-l`**
(Hiera-L image encoder, MAE-pretrained, hierarchical with stages at strides 4/8/16/32; FPN neck →
256-d features; stride-16 features go to memory attention, strides 4 and 8 are high-resolution skips
into the mask decoder), **memory attention** (4 transformer blocks: self-attn, cross-attn to the
memory bank's spatial memories + object pointers, MLP; RoPE in attention), **memory encoder**
(downsampled predicted mask + image embedding → light convs → 64-d memory features), **memory bank**
(FIFO of up to N=6 recent frames + up to M prompted frames; object pointers = projected mask-decoder
output tokens), mask decoder as SAM's + an **occlusion** head. Other configs: `sam2-hiera-t`,
`sam2-hiera-s`, `sam2-hiera-bplus` (no "+" in ids). Knobs: `res`, `memFrames` (N), `ptrs` (object
pointers). Reference: HF `Sam2Model(Sam2Config(...))` (and the video model if needed) built in code;
params exact; FLOPs per frame with N memories (state how many) — verify every detail.
Ids: overview `sam2-overview` (one frame t with the memory loop visible: `frame`, `img-encoder`
(Hiera, expand optional), `fpn`, `memory-attn` (group ×4, expand `sam2-memory-attn`), `prompts`,
`prompt-enc`, `mask-decoder`, `occlusion`, `masks`, `memory-encoder`, `memory-bank`, `obj-ptrs`, plus a
recurrent edge to frame t+1 drawn as `control`/`skip`); `sam2-memory-attn`: `self-attn`,
`cross-mem`, `mlp`.

### 17.3 Visualizations
`prompt-to-mask` (synthetic scene: click a point / drag a box → the 3 multimask outputs with predicted
IoU, ambiguity explained; labelled "ilustrativo"), `windowed-global` (SAM's ViT-H: which blocks are
windowed 14×14 vs global; cost per block from the calculator), `memory-bank` (timeline of video
frames: prompted frames, FIFO recent memories, object pointers, occlusion; memory sizes from the
calculator).

### 17.4 Ownership in Phase 5
- **arch**: js/arch/primitives.js (new primitives only), js/arch/sam.js (models `sam` and `sam2`),
  tests, crosscheck/sam.py + expected JSONs, requirements pins.
- **diagram**: engine extensions (only if needed), js/ui/viz/{prompt-to-mask,windowed-global,memory-bank}.js,
  js/content/diagrams/{sam,sam2}.js, dev/diagram.html.
- **content-sam**: js/content/sam.js. **content-sam2**: js/content/sam2.js.
- **orchestrator**: index.html + stubs, catalog (canonical ids `sam-vit-h-1024`, `sam2-hiera-l`;
  roadmap status), SPEC, practice METRICS labels for new metrics, integration.
