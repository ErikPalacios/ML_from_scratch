# Transformer Lab — build specification (internal contract)

This file is the single source of truth shared by every agent building the app. Read it fully
before writing code. If something here is ambiguous, pick the option that keeps the modules
decoupled and document your choice in a code comment.

## 0. Goal (from the user, translated)

> "Create an animation or application — whichever is more convenient — where the **complete
> training of a transformer** can be seen: from the **text input to its output**, showing **every
> step of the forward and of the backward pass**; in **every section of the transformer** you can
> see **how the dimensions of the input and output change**; the **complete attention process**;
> at **every moment** I can know the **dimensions and operations being performed on the
> matrices**; as **explanatory, mathematical and interactive** as possible."

The user is a Spanish speaker learning ML from scratch (the repo is `ML_from_scratch`).
**All user-facing text is Spanish.** Code comments in Spanish (short, only where useful).

Deliverable: a zero-build, dependency-free (except MathJax from CDN) web app in
`apps/transformer-lab/` that runs by double-clicking `index.html` (file://) **and** can be bundled
into a single HTML file by `build.mjs` for publishing.

## 1. Hard technical constraints

- Plain JavaScript (ES2020), **classic scripts** (no ES modules — they break on file://).
  Every file is an IIFE that attaches to the global namespace `TL`:
  ```js
  (function (root) {
    'use strict';
    const TL = (root.TL = root.TL || {});
    // ...
    TL.Something = Something;
  })(typeof window !== 'undefined' ? window : globalThis);
  ```
  Core files (`js/core/*`) must NOT touch `document`/`window` so they run in Node for tests.
- No npm dependencies. Node ≥ 20 for tests/build (`node --test`), machine has Node 24.
- Only external resource allowed: MathJax 3 **SVG** build (no fonts/CSS needed):
  `https://cdnjs.cloudflare.com/ajax/libs/mathjax/3.2.2/es5/tex-svg.min.js`, and Google Fonts
  stylesheet (`fonts.googleapis.com`). Everything must degrade gracefully when offline
  (formulas fall back to monospace LaTeX source; fonts fall back to system stacks).
- The published artifact runs in a sandboxed iframe: no `alert/confirm/prompt`, no downloads, no
  `window.open`, no service workers. Use `el.hidden = true/false` to toggle visibility (a global
  CSS rule `[hidden]{display:none!important}` exists).
- Numerics in `Float64Array`. Deterministic PRNG (mulberry32) seeded from config.
- Must stay responsive: traced iteration < 50 ms, un-traced training ≥ 200 iterations/s for the
  default config.

## 2. File layout

```
apps/transformer-lab/
  index.html                 # full document (doctype) — loads css/js below in order
  package.json               # {"private":true,"scripts":{"test":"node --test tests/","build":"node build.mjs","check":"node tools/browser-check.mjs --url index.html"}}
  build.mjs                  # inlines local css/js → dist/transformer-lab.html (+ dist/artifact.html fragment)
  README.md                  # Spanish user guide (written last)
  css/app.css                # design tokens + layout + app chrome (shell agent)
  css/viz.css                # matrix/heatmap/op-view styles (viz agent)
  js/core/tensor.js          # TL.Mat, TL.rng                      (engine agent)
  js/core/tokenizer.js       # TL.Tokenizer                         (engine agent)
  js/core/model.js           # TL.Model  (forward/backward + trace) (engine agent)
  js/core/optim.js           # TL.Optim  (SGD, Adam + trace)        (engine agent)
  js/core/trainer.js         # TL.Trainer (session, train, generate, gradcheck) (engine agent)
  js/content/explain.js      # TL.Content (Spanish explanations)    (content agent)
  js/ui/math.js              # TL.MathTex (MathJax wrapper)         (viz agent)
  js/ui/heatmap.js           # TL.Heatmap                           (viz agent)
  js/ui/opviews.js           # TL.OpViews (one renderer per step kind) (viz agent)
  js/ui/diagram.js           # TL.Diagram (architecture schematic)  (shell agent)
  js/ui/charts.js            # TL.Charts (loss curve, bars, scatter) (shell agent)
  js/app.js                  # TL.App (state, tabs, timeline, wiring) (shell agent)
  tests/engine.test.cjs      # node:test — gradcheck, shapes, trace contract, training (engine agent)
  tools/browser-check.mjs    # headless Chrome checker (already exists — use it!)
  docs/SPEC.md               # this file
```

Script load order in `index.html`: MathJax config → MathJax (async) → tensor → tokenizer → model →
optim → trainer → explain → math → heatmap → opviews → diagram → charts → app.

### Browser check tool (already written)
```
node tools/browser-check.mjs --url index.html --width 1440 --height 900 [--dark] [--mobile] \
   [--wait 2500] [--eval "js expression (awaited)"]... [--shot /abs/path.png] [--full]
```
Prints every console message / exception, the JSON value of each `--eval`, saves a PNG
screenshot (you can then view it with the Read tool), exits 1 on errors. Put screenshots in your
scratch/temp dir, never in the repo.

## 3. The model (decoder-only, GPT-style, pre-LayerNorm)

### 3.1 Config (`cfg`) and defaults
```js
{
  dModel: 8,          // d
  nHeads: 2,          // h   (must divide dModel) → dK = dModel / nHeads
  nLayers: 1,         // N   (1..3)
  dFF: 32,            // d_ff (default 4·d)
  maxLen: 8,          // context window (max tokens per input sequence)
  activation: 'relu', // 'relu' | 'gelu' (tanh approximation)
  posEnc: 'sinusoidal', // 'sinusoidal' (fixed, no params) | 'learned' (param P, maxLen×d)
  seed: 42,
  lnEps: 1e-5,
}
```
Optimizer hp defaults: `{ type: 'adam', lr: 0.01, beta1: 0.9, beta2: 0.999, eps: 1e-8, clip: 1.0 }`
(`clip`: global-norm gradient clipping threshold, `0` or `null` = off). SGD default lr 0.1.
Training batch size default: 4 sentences (average of per-sentence gradients).

### 3.2 Data / tokenizer
Default corpus (one sentence per line, designed so attention must look back at the subject):
```
el gato come pescado .
el perro come carne .
la niña bebe leche .
el niño bebe agua .
el gato duerme en la casa .
el perro duerme en el jardín .
la niña lee un libro .
el niño lee un cuento .
```
- Mode `'word'` (default): lowercase, split punctuation `. , ; : ! ? ¡ ¿` into separate tokens,
  split on whitespace. Mode `'char'`: every character (spaces included, shown as `␣`) is a token.
- Vocabulary: `['<s>', ...unique tokens in order of first appearance]`. id = index. No `<unk>`:
  unknown tokens in a generation prompt produce a clear Spanish error listing the vocabulary.
- Each line → sequence `seq = ['<s>', ...tokens]`, truncated to `maxLen + 1` tokens.
  Training pair: `input = seq[0 .. n-2]`, `target = seq[1 .. n-1]` (next-token prediction),
  so `T = n − 1 ≤ maxLen`.
- Default: the step-by-step view uses sentence 0 `"el gato come pescado ."` → T = 5.

### 3.3 Parameters (names are part of the contract)
| name | shape | init |
|---|---|---|
| `E` | V×d | N(0, 1) |
| `P` (only if posEnc = 'learned') | maxLen×d | N(0, 0.1²)... engine may tune |
| `L{l}.ln1.g`, `L{l}.ln1.b` | 1×d | ones / zeros |
| `L{l}.Wq`, `L{l}.Wk`, `L{l}.Wv`, `L{l}.Wo` | d×d | N(0, 1/d) |
| `L{l}.ln2.g`, `L{l}.ln2.b` | 1×d | ones / zeros |
| `L{l}.W1` | d×d_ff | N(0, 1/d) |
| `L{l}.b1` | 1×d_ff | zeros |
| `L{l}.W2` | d_ff×d | N(0, 1/d_ff) |
| `L{l}.b2` | 1×d | zeros |
| `lnf.g`, `lnf.b` | 1×d | ones / zeros |
| `Wout` | d×V | N(0, 1/d) |

(`l` is 0-based in names; displayed 1-based to the user: "Capa 1".) No biases in Q/K/V/O
projections nor in `Wout` (like LLaMA); FFN has biases (to show broadcasting + bias gradients).
The engine may adjust init scales if needed for fast convergence, but must record the init
description (Spanish) in `paramMeta[name].init`.

Sinusoidal PE: `PE[pos, 2i] = sin(pos / 10000^{2i/d})`, `PE[pos, 2i+1] = cos(pos / 10000^{2i/d})`.

### 3.4 Forward pass (per sequence, B = 1; T tokens)
Notation (LaTeX names are part of the contract — use them in `tex` fields and content):
```
X_emb = onehot(ids) · E                          (T×V)(V×d) → T×d      [lookup]
X^{[0]} = X_emb + PE[0:T]                         T×d                   [add]
for l = 1..N:
  H   = LN_1(X^{[l-1]}) = γ₁ ⊙ (X−μ)/√(σ²+ε) + β₁  T×d                   [layernorm]
  Q = H W_Q ; K = H W_K ; V = H W_V              (T×d)(d×d) → T×d      [matmul ×3]
  split into heads: Q_h = Q[:, (h−1)d_k : h·d_k]  T×d → h × (T×d_k)     [split]
  for h = 1..H:
    S_h  = Q_h K_hᵀ                               (T×d_k)(d_k×T) → T×T  [matmul]
    S̃_h  = S_h / √d_k                             T×T                   [scale]
    Ŝ_h  = S̃_h + M,  M_ij = 0 if j ≤ i else −∞    T×T                   [mask]
    A_h  = softmax_row(Ŝ_h)                       T×T                   [softmax]
    Z_h  = A_h V_h                                (T×T)(T×d_k) → T×d_k  [matmul]
  Z   = [Z_1 ‖ … ‖ Z_H]                           h×(T×d_k) → T×d       [concat]
  O   = Z W_O                                     (T×d)(d×d) → T×d      [matmul]
  R   = X^{[l-1]} + O                             T×d                   [add, residual]
  H'  = LN_2(R)                                   T×d                   [layernorm]
  U   = H' W_1 + b_1                              (T×d)(d×d_ff)+(1×d_ff) → T×d_ff [matmul+bias]
  G   = ReLU(U)  (or GELU)                        T×d_ff                [activation]
  F   = G W_2 + b_2                               (T×d_ff)(d_ff×d)+(1×d) → T×d [matmul+bias]
  X^{[l]} = R + F                                 T×d                   [add, residual]
H_f    = LN_f(X^{[N]})                            T×d                   [layernorm]
logits = H_f W_out                                (T×d)(d×V) → T×V      [matmul]
P      = softmax_row(logits)                      T×V                   [softmax]
ℒ      = −(1/T) Σ_t log P[t, y_t]                 scalar                [crossentropy]
```
LaTeX names: `X_{\text{emb}}`, `PE`, `X^{[0]}`, `H`, `Q`, `K`, `V`, `Q_1`, `K_1^{\top}`, `S_1`,
`\tilde S_1`, `\hat S_1`, `M`, `A_1`, `Z_1`, `Z`, `O`, `R`, `H'`, `U`, `G`, `F`, `X^{[1]}`,
`H_f`, `\mathrm{logits}`, `P`, `Y` (one-hot targets), `\mathcal{L}`. Parameters: `E`, `P_{\text{pos}}`
(learned PE — named `P_{\text{pos}}` to avoid clashing with probabilities `P`), `\gamma_1`, `\beta_1`,
`W_Q`, `W_K`, `W_V`, `W_O`, `\gamma_2`, `\beta_2`, `W_1`, `b_1`, `W_2`, `b_2`, `\gamma_f`, `\beta_f`,
`W_{\text{out}}`. When `nLayers > 1`, parameters and intra-layer activations get a layer
superscript `^{[l]}` (e.g. `W_Q^{[2]}`, `H^{[2]}`); with 1 layer omit it (except `X^{[0]}`, `X^{[1]}`).
Heads are subscripts (1-based).

### 3.5 Backward pass
Gradient notation: `\mathrm{d}X := \partial\mathcal{L}/\partial X` (same shape as X).
```
dlogits = (P − Y) / T                                     T×V   [grad_ce]
dW_out  = H_fᵀ · dlogits                                  (d×T)(T×V) → d×V   [matmul]
dH_f    = dlogits · W_outᵀ                                (T×V)(V×d) → T×d   [matmul]
dX^{[N]}, dγ_f, dβ_f = LN_f backward                                         [grad_layernorm]
for l = N..1:
  residual 2:  dR ← dX^{[l]} (skip path) ; dF = dX^{[l]}                     [residual_split]
  dW_2 = Gᵀ dF ; db_2 = Σ_rows dF ; dG = dF W_2ᵀ                             [matmul, sumrows, matmul]
  dU = dG ⊙ f'(U)                                                            [grad_activation]
  dW_1 = H'ᵀ dU ; db_1 = Σ_rows dU ; dH' = dU W_1ᵀ                           [matmul, sumrows, matmul]
  dR_ln, dγ₂, dβ₂ = LN_2 backward(dH')                                       [grad_layernorm]
  dR = dX^{[l]} + dR_ln                                                      [accumulate]
  residual 1:  dX^{[l-1]} ← dR (skip) ; dO = dR                              [residual_split]
  dW_O = Zᵀ dO ; dZ = dO W_Oᵀ                                                [matmul, matmul]
  dZ → dZ_1 … dZ_H                                                           [split]
  for each head h:
    dA_h = dZ_h V_hᵀ           (T×d_k)(d_k×T) → T×T                          [matmul]
    dV_h = A_hᵀ dZ_h           (T×T)(T×d_k) → T×d_k                          [matmul]
    dŜ_h = A_h ⊙ (dA_h − rowsum(dA_h ⊙ A_h))                                 [grad_softmax]
    dS̃_h = dŜ_h with masked entries forced to 0 (M is constant)              [grad_mask]
    dS_h = dS̃_h / √d_k                                                       [scale]
    dQ_h = dS_h K_h            (T×T)(T×d_k) → T×d_k                          [matmul]
    dK_h = dS_hᵀ Q_h           (T×T)(T×d_k) → T×d_k                          [matmul]
  dQ = [dQ_1‖…], dK = […], dV = […]                                          [concat]
  dW_Q = Hᵀ dQ ; dW_K = Hᵀ dK ; dW_V = Hᵀ dV                                 [matmul ×3]
  dH = dQ W_Qᵀ + dK W_Kᵀ + dV W_Vᵀ   (3 matmul steps then 1 accumulate step)  [matmul ×3, accumulate]
  dX_ln, dγ₁, dβ₁ = LN_1 backward(dH)                                        [grad_layernorm]
  dX^{[l-1]} = dR + dX_ln                                                    [accumulate]
positional:  dX_emb = dX^{[0]} ; (learned) dP_pos[0:T] = dX^{[0]}            [residual_split]
embedding:   dE = onehot(ids)ᵀ · dX_emb   (scatter-add rows into E)          [grad_lookup]
```
LayerNorm backward (per row, n = d, x̂ = (x−μ)/σ, σ = √(σ²+ε)):
`dx̂ = dy ⊙ γ`, `dx = (1/σ) (dx̂ − mean(dx̂) − x̂ ⊙ mean(dx̂ ⊙ x̂))`, `dγ = Σ_rows dy ⊙ x̂`, `dβ = Σ_rows dy`.
GELU (tanh approx): `0.5x(1+tanh(√(2/π)(x+0.044715x³)))` and its exact derivative.

### 3.6 Update
- `gradnorm` step: global L2 norm `‖g‖ = √(Σ_params Σ g²)`, per-parameter norms, and clipping
  factor `min(1, clip/‖g‖)` if clipping is on (then all grads are scaled).
- One `update` step **per parameter** (in the order of `model.order`):
  - SGD: `θ ← θ − η g`
  - Adam: `m ← β₁m + (1−β₁)g`, `v ← β₂v + (1−β₂)g²`, `m̂ = m/(1−β₁ᵗ)`, `v̂ = v/(1−β₂ᵗ)`,
    `θ ← θ − η m̂/(√v̂ + ε)`.

## 4. Engine public API (engine agent implements, everyone else consumes)

### 4.1 `TL.Mat` (js/core/tensor.js)
```js
class Mat { constructor(r, c, data /*Float64Array|undefined*/) ; r; c; d /*Float64Array row-major*/ }
Mat.prototype: get(i,j) set(i,j,v) clone() shape()->[r,c] row(i)->Float64Array(copy) toArray()->number[][]
               maxAbs() (ignores ±Infinity) min() max() (finite only) frob()
Static (all return NEW Mat, never mutate inputs):
  Mat.zeros(r,c) Mat.ones(r,c) Mat.from2D(arr) Mat.fromRow(arr) Mat.eye(n) Mat.randn(r,c,std,rng)
  Mat.matmul(A,B) Mat.transpose(A) Mat.add(A,B) Mat.sub(A,B) Mat.mul(A,B) Mat.scale(A,s)
  Mat.addRowVec(A, v /*1×c*/) Mat.sumRows(A)->1×c   (sum over rows = column sums)
  Mat.sumCols(A)->r×1 Mat.meanCols(A)->r×1 Mat.map(A,f) Mat.map2(A,B,f)
  Mat.sliceCols(A,c0,c1) Mat.concatCols([A,B,...]) Mat.rowSoftmax(A) (−Infinity → 0 prob)
  Mat.oneHot(ids,V)->T×V  Mat.gatherRows(E,ids)->T×d
TL.rng(seed) -> () => float in [0,1)   (mulberry32)
TL.randn(rng) -> standard normal (Box–Muller)
```

### 4.2 `TL.Tokenizer` (js/core/tokenizer.js)
```js
const tok = TL.Tokenizer.build(corpusText, mode /*'word'|'char'*/, maxLen)
tok = {
  mode, vocab: string[], stoi: {token: id},
  split(text) -> string[]            // tokens (without <s>)
  encode(text) -> {ids, tokens, unknown: string[]}   // without <s>
  decode(ids) -> string              // word mode joins with spaces and attaches punctuation
  display(token) -> string           // '␣' for space in char mode, token otherwise
  sentences: [{ text, tokens /*with <s>*/, ids, inputIds, targetIds, inputTokens, targetTokens, T }]
}
```

### 4.3 `TL.Model` (js/core/model.js)
```js
const model = TL.Model.create(cfg, vocab /*string[]*/)   // uses cfg.seed
model = { cfg, vocab, params: {name: Mat}, order: string[] /*param names in display order*/,
          paramMeta: {name: {tex, desc /*Spanish*/, init /*Spanish*/, block /*diagram id*/, rowAxis, colAxis}} }
TL.Model.forward(model, inputIds, targetIds /*may be null → no loss*/, {trace: bool})
   -> { loss /*number|null*/, probs: Mat T×V, logits: Mat, attn: A[l][h] (Mat T×T), cache, steps: Step[] }
TL.Model.backward(model, cache, {trace: bool}) -> { grads: {name: Mat}, steps: Step[] }
TL.Model.loss(model, inputIds, targetIds) -> number          // fast path for gradcheck
TL.Model.countParams(model) -> { total, byName: {name: count} }
TL.Model.shapeTable(model, T) -> [{ group, tex, sym, shape: [r,c], desc }]   // every tensor in the
      // forward & backward with symbolic + numeric shape — for the "Mapa de dimensiones" view
```

### 4.4 `TL.Optim` (js/core/optim.js)
```js
const opt = TL.Optim.create(hp)   // {type:'adam'|'sgd', lr, beta1, beta2, eps, clip}
TL.Optim.step(opt, model, grads, {trace: bool}) -> { steps: Step[], gradNorm, clipFactor }
   // mutates model.params in place (after cloning 'before' snapshots when tracing); opt.t += 1
```

### 4.5 `TL.Trainer` (js/core/trainer.js)
```js
const s = TL.Trainer.createSession({ corpus, tokMode, cfg, optim /*hp*/, batchSize })
s = { tok, model, opt, cfg, hp, batchSize, iter /*completed updates*/, history: [{iter, loss}],
      lastGradNorms: {name: number} }
TL.Trainer.traceIteration(s, sentenceIndex) -> { steps: Step[], loss, iter }
   // ONE full training iteration on ONE sentence with tracing: data+forward+loss+backward+update.
   // Applies the update (mutates params, increments s.iter, pushes history).
TL.Trainer.trainSteps(s, n) -> { losses: number[] }   // n iterations, mini-batch of s.batchSize
   // sentences (cycled deterministically / shuffled with seeded rng), gradients averaged.
TL.Trainer.evaluate(s) -> { loss /*mean over all sentences*/, perSentence: [{text, loss}] }
TL.Trainer.predict(s, sentenceIndex) -> { probs: Mat, attn, loss, inputTokens, targetTokens }
TL.Trainer.generate(s, promptText, { maxNew = 10, temperature = 1, greedy = true, seed })
   -> { ok, error?, tokens: string[] /*prompt with <s> + generated*/, steps: [{ context: string[],
        probs: Float64Array /*V*/, chosen: id, chosenToken, top: [{token,id,p}] , attn /*A[l][h] for this context*/ }] }
   // stops at '.' or when the context reaches maxLen (then keeps last maxLen tokens: sliding window)
TL.Trainer.gradCheck(s, sentenceIndex, { perParam = 3, h = 1e-5 })
   -> [{ name, i, j, analytic, numeric, relErr }]
TL.Trainer.snapshot(s) / TL.Trainer.restore(s, snap)   // deep copy of params + optimizer state
```

## 5. The trace: `Step` objects (THE key contract)

```js
Step = {
  id:     'fwd.L0.attn.h1.scores',   // unique in the trace
  tpl:    'fwd.attn.scores',         // template key → TL.Content.steps[tpl] (list in §6)
  phase:  'data' | 'forward' | 'loss' | 'backward' | 'update',
  block:  'L0.scores',               // diagram node id (list in §7)
  layer:  0 | null,                  // 0-based
  head:   0 | null,                  // 0-based
  kind:   one of §5.1,
  title:  'Capa 1 · Cabeza 2 · Puntuaciones Q·Kᵀ',   // Spanish, short
  formula:'S_2 = Q_2\\,K_2^{\\top}',                   // LaTeX, concrete names
  dimsSym:'(T\\times d_k)\\cdot(d_k\\times T)\\to(T\\times T)',
  dims:   '(5\\times 4)\\cdot(4\\times 5)\\to(5\\times 5)',
  inputs:  [TensorRef...],
  outputs: [TensorRef...],
  aux:    { ...kind-specific, see §5.1 },
  flops:  number | null,            // multiply-adds for matmuls (T·k·n), null otherwise
}
TensorRef = {
  key:   'Q_2',                     // unique within the step (ASCII)
  tex:   'Q_2',                     // LaTeX name
  label: 'Q₂',                      // plain unicode short label
  mat:   Mat,                       // a CLONE (trace is immutable history)
  role:  'act' | 'param' | 'grad' | 'const' | 'prob' | 'onehot' | 'mask' | 'scalar',
  rowAxis: 'T'|'V'|'d'|'dk'|'dff'|'1'|'maxLen',  colAxis: same set,
  rowLabels: string[] | null,       // e.g. tokens for T axis, vocab for V axis
  colLabels: string[] | null,       // e.g. vocab for V axis, key tokens for attention columns
  colOffset: number | 0,            // for head slices: column index in the full d axis
}
```
Rules:
- Every `inputs`/`outputs` mat is a clone taken at that moment.
- `T`-axis labels are the input tokens (display form); `V` labels are the vocabulary;
  `d/dk/dff` axes have `null` labels (UI shows indices).
- For matmul-like steps, the second operand is stored **already transposed** when the formula
  has a transpose (e.g. input `K_2^{\top}` is the T-transposed matrix, key `K_2T`), so the UI can
  always compute `out[i][j] = Σ_k A[i,k]·B[k,j] (+ bias[j])`.
- Gradient tensors have `role: 'grad'`; parameters `role: 'param'`; probabilities/attention
  weights `role: 'prob'`.

### 5.1 Kinds and their `aux`
| kind | inputs | outputs | aux |
|---|---|---|---|
| `tokenize` | – | `ids` (1×T, role const) | `{ text, tokens /*with <s>*/, ids, inputTokens, targetTokens, inputIds, targetIds, vocab }` |
| `lookup` | `onehot` (T×V), `E` | `X_emb` | `{ ids, tokens }` |
| `add` | A, B | C | `{ residual: bool, broadcast: bool }` (posenc: aux also `{ posEnc: 'sinusoidal'|'learned' }`) |
| `layernorm` | X, γ (1×d), β (1×d) | Y | `{ mu (T×1), var (T×1), sigma (T×1), xhat (T×d), eps }` |
| `matmul` | A, B, [bias 1×n] | C | `{ a: 0, b: 1, bias: 2 | null }` (indices into inputs) |
| `split` | X (T×d) (or several: Q,K,V) | h slices per input | `{ nHeads, dK, groups: [{ input: 0, outputs: [0,1] }] }` |
| `concat` | h slices (per group) | full matrices | `{ nHeads, dK, groups: [{ inputs: [0,1], output: 0 }] }` |
| `scale` | X | Y | `{ factor, factorTex: '1/\\sqrt{d_k}' }` |
| `mask` | S̃, M | Ŝ | `{}` (M holds 0 / −Infinity) |
| `softmax` | X | P | `{ rowMax (T×1), exps (T×C), rowSum (T×1), attention: bool, queryLabels, keyLabels }` |
| `activation` | U | G | `{ fn: 'relu'|'gelu' }` |
| `crossentropy` | P, Y (one-hot) | ℒ (1×1, role scalar) | `{ targetIds, targetTokens, perToken (T×1), pTarget (T×1) }` |
| `grad_ce` | P, Y | dlogits | `{ T }` |
| `grad_softmax` | A, dA | dŜ | `{ rowDot (T×1) = rowsum(dA⊙A) }` |
| `grad_mask` | dŜ, M | dS̃ | `{}` |
| `grad_layernorm` | dY, X, γ | dX, dγ, dβ | `{ mu, sigma, xhat, dxhat }` |
| `grad_activation` | dG, U | dU | `{ fn, deriv (T×d_ff) = f'(U) }` |
| `grad_lookup` | onehotᵀ (V×T), dX_emb | dE | `{ ids, tokens }` |
| `sumrows` | dY (T×n) | db (1×n) | `{}` |
| `residual_split` | dX | two (or one) copies | `{ branches: ['camino directo (skip)', 'subcapa'] }` |
| `accumulate` | g1, g2, [g3] | sum | `{}` |
| `gradnorm` | all grads? (NO — too many) → none | none | `{ norms: [{name, tex, norm}], total, clip, factor }` |
| `update` | θ, g, [m, v] | θ_new, [m_new, v_new] | `{ name, optimizer, lr, t, beta1, beta2, eps, mhat?, vhat?, delta (Mat θ_new−θ) }` |

`scale` is also used in backward (dS = dS̃/√d_k) with `phase: 'backward'`. `matmul`, `split`,
`concat`, `add` likewise may appear in backward.

## 6. Template keys (`tpl`) — the complete ordered list for 1 layer (repeat per layer/head)
```
data.tokenize
fwd.embed            fwd.posenc
fwd.ln1  fwd.attn.q  fwd.attn.k  fwd.attn.v  fwd.attn.split
  (per head) fwd.attn.scores  fwd.attn.scale  fwd.attn.mask  fwd.attn.softmax  fwd.attn.context
fwd.attn.concat  fwd.attn.proj  fwd.res1  fwd.ln2  fwd.ffn1  fwd.act  fwd.ffn2  fwd.res2
fwd.lnf  fwd.logits  fwd.softmax_out
loss.ce
bwd.ce  bwd.logits.dW  bwd.logits.dX  bwd.lnf
  (per layer, last to first)
  bwd.res2  bwd.ffn2.dW  bwd.ffn2.db  bwd.ffn2.dX  bwd.act  bwd.ffn1.dW  bwd.ffn1.db  bwd.ffn1.dX
  bwd.ln2  bwd.res2.merge  bwd.res1  bwd.attn.proj.dW  bwd.attn.proj.dX  bwd.attn.concat
    (per head) bwd.attn.context.dA  bwd.attn.context.dV  bwd.attn.softmax  bwd.attn.mask
               bwd.attn.scale  bwd.attn.scores.dQ  bwd.attn.scores.dK
  bwd.attn.split  bwd.attn.q.dW  bwd.attn.k.dW  bwd.attn.v.dW
  bwd.attn.q.dX  bwd.attn.k.dX  bwd.attn.v.dX  bwd.attn.dH  bwd.ln1  bwd.res1.merge
bwd.posenc  bwd.embed
upd.gradnorm
upd.param            (one per parameter, in model.order)
```
Default config (1 layer, 2 heads) ⇒ ~90 steps.

## 7. Diagram block ids (`block`)
```
tokens, embed, posenc,
L{l}.ln1, L{l}.qkv, L{l}.split, L{l}.scores, L{l}.scale, L{l}.mask, L{l}.softmax, L{l}.context,
L{l}.concat, L{l}.proj, L{l}.res1, L{l}.ln2, L{l}.ffn1, L{l}.act, L{l}.ffn2, L{l}.res2,
lnf, logits, softmax_out, loss, optim
```
Backward steps use the block of the forward op they differentiate (e.g. `bwd.attn.scores.dQ` →
`L0.scores`). Update steps use `optim` and `aux.name` tells which parameter (its
`paramMeta[name].block` lets the diagram also highlight the owner block).

## 8. Content API (content agent) — `TL.Content` in js/content/explain.js
```js
TL.Content = {
  symbols: [{ sym: 'T', tex: 'T', name: 'longitud de la secuencia', desc }...],   // T, d, h, d_k, d_ff, V, N, η
  notation: [{ tex, desc }],                // e.g. '\\mathrm{d}X := \\partial\\mathcal L/\\partial X'
  steps: { [tpl]: {
      title,          // Spanish generic title (engine's step.title has the concrete one)
      summary,        // 1 sentence, plain Spanish, what happens
      intuition,      // HTML string (may contain inline math \\( … \\))
      math: [LaTeX],  // display equations, generic symbols (T, d, d_k …), may use placeholders
      shapes,         // HTML string explaining how dims change here
      details,        // HTML: derivation / why / pitfalls (backward: derive the gradient!)
      code,           // optional: 1-3 lines of NumPy-style pseudo-code, plain text
  } },
  derivations: { [id]: { title, html } },   // long derivations: 'matmul-grad', 'softmax-jacobian',
                                            // 'softmax-ce', 'layernorm-grad', 'residual', 'scale-why',
                                            // 'mask-why', 'adam', 'embedding-grad', 'multihead-why'
  glossary: [{ term, def }],
  tour: [{ title, html }],                  // 5–8 intro cards shown on first visit
  phases: { data, forward, loss, backward, update: { name, color: 'fwd'|'bwd'|'upd'|'data', desc } },
}
```
Placeholders the app substitutes in any Content string: `{T} {d} {h} {dk} {dff} {V} {N} {l}`
(layer 1-based) `{hd}` (head 1-based) `{lr}`. Math delimiters inside HTML: `\( … \)` inline,
`\[ … \]` display (MathJax typesets them). Every `tpl` in §6 MUST have an entry.

## 9. UI contracts (viz agent ⇄ shell agent)

### 9.1 `TL.MathTex` (js/ui/math.js)
```js
TL.MathTex.render(latex, el, { display = false } = {})  // sync if MathJax ready, else queues; fallback <code>
TL.MathTex.typeset(el) -> Promise                        // typesets \( \) and \[ \] in an HTML subtree
TL.MathTex.ready -> Promise<boolean>                     // resolves true when MathJax usable, false on timeout (8 s)
```
MathJax config (in index.html before the script):
```js
window.MathJax = { tex: { inlineMath: [['\\(', '\\)']], displayMath: [['\\[', '\\]']] },
                   svg: { fontCache: 'global' }, startup: { typeset: false } };
```

### 9.2 `TL.Heatmap` (js/ui/heatmap.js)
```js
const hm = TL.Heatmap.create(tensorRef, {
   cell /*px, auto if omitted*/, showValues /*bool|'auto'*/, scale /*'diverging'|'sequential'|'auto'*/,
   maxAbs /*shared color scale, optional*/, caption: true, highlightCols: [[c0,c1,cssColorVar]] ,
   onHover(i, j, value) /*j === -1 → row header, i === -1 → col header*/, onLeave() })
hm.el                          // root element (figure with caption: LaTeX name + shape badge "5×8" + symbolic "T×d")
hm.highlightCell(i,j,cls) hm.highlightRow(i,cls) hm.highlightCol(j,cls) hm.clear()
hm.update(mat)                 // re-render values (for animations)
```
Color scales are read from CSS custom properties at render time (theme-aware):
`--neg`, `--pos`, `--zero` (diverging), `--prob-0`, `--prob-1` (sequential), `--masked` (−∞ cells
drawn hatched). `role:'prob'|'onehot'|'mask'` → sequential; others diverging.

### 9.3 `TL.OpViews` (js/ui/opviews.js)
```js
const view = TL.OpViews.render(step, containerEl, ctx)
// ctx = { cfg, tok, content: TL.Content, showValues, onInspect(html) /*inspector panel*/,
//         animateSpeed /*ms per cell*/ }
view.animate() -> Promise   // optional per-kind animation (matmul sweep, softmax row-by-row, …)
view.destroy()
```
Renders the operation as an equation of matrices: operands → operator glyphs (·, +, ⊙, softmax,
LN, ‖, ↦) → result, each a heatmap with caption & shape badge; plus kind-specific extras
(attention arc graph for softmax with `aux.attention`, one-hot/lookup highlighting, LN row stats,
PE sinusoid mini-plot, activation curve, CE target outlines, Adam m/v panels, gradnorm bars).
Hovering any output cell highlights the contributing input cells and calls `ctx.onInspect(html)`
with the **full numeric computation** of that cell (e.g. `S₂[3,1] = Σₖ Q₂[3,k]·K₂ᵀ[k,1] =
(0.12)(−0.40) + … = 0.73`), including LaTeX. It must never overflow the page horizontally: wide
equations wrap or scroll inside their own container.

### 9.4 `TL.Diagram` (js/ui/diagram.js)
```js
const dg = TL.Diagram.create(el, cfg, { onSelect(blockId) })
dg.setActive(blockId, phase, { paramBlock })  // highlights; backward = gradient colour, arrows reversed/animated
dg.setShapes({ [blockId]: 'T×d (5×8)' })       // edge/shape labels
dg.destroy()
```

### 9.5 `TL.Charts` (js/ui/charts.js)
`TL.Charts.line(canvas, series:[{name, points:[[x,y]], colorVar}], opts)`,
`TL.Charts.bars(el, items:[{label, value, colorVar, tex?}], opts)`,
`TL.Charts.scatter(canvas, points:[{x,y,label}], opts)` — theme-aware (read CSS vars), HiDPI.

## 10. App (shell agent) — tabs & layout (all text Spanish)
Tabs: **Paso a paso** · **Entrenamiento** · **Generación** · **Datos y modelo** (+ theme toggle,
help/tour).

1. **Paso a paso** (default, opens already showing step 1 of a traced iteration of sentence 0):
   - Left: `TL.Diagram` (click a block → jump to the first step of that block in the current phase).
   - Center: step header (phase chip, "Paso 23 / 91", title, big formula, dims in numbers AND symbols,
     FLOPs), then `TL.OpViews.render(step)`, then the inspector box (hover details).
   - Right: explanation from `TL.Content.steps[step.tpl]` (summary, intuition, math, shapes, details,
     code), a "Tensores vivos" list (all tensors produced so far with shapes, click → jump), and the
     symbols legend with current numeric values (T=5, d=8 …).
   - Bottom: timeline scrubber — one tick per step coloured by phase, with phase segment labels
     (Datos · Forward · Pérdida · Backward · Actualización); ◀ ▶ buttons, play/pause with speed,
     keyboard ← → (step), Espacio (play), Inicio/Fin. Sentence selector; "Nueva iteración"
     (re-trace with the updated params — shows loss dropping iteration by iteration).
2. **Entrenamiento**: controls (Entrenar/Pausa, +1, +10, +100 iterations, lr, optimizer, batch),
   live loss curve (and per-sentence loss), perplexity, gradient-norm bars per parameter, attention
   heatmaps (every layer × head) for a chosen sentence updating live, prediction table (for each
   position: input token → target, top-3 predicted with probabilities), 2-D PCA scatter of the
   embedding rows of `E` with token labels. Button "Inspeccionar esta iteración" → switches to
   Paso a paso with a new traced iteration at the current params.
3. **Generación**: prompt input (default "el gato"), temperature, greedy/sample, "Generar" →
   autoregressive steps listed; each shows context tokens, probability bars over the vocabulary
   (top 10), chosen token, and the attention of the last position. Explain that at inference only
   the forward pass runs (no loss, no backward).
4. **Datos y modelo**: editable corpus textarea, tokenizer mode, hyperparameters (d, h, N, d_ff,
   activation, posEnc, maxLen, optimizer, lr, batch, clip, seed) with validation (h divides d),
   "Aplicar y reiniciar"; vocabulary table (id → token); parameter inventory (name, LaTeX, shape,
   #params, init, description, total); **Mapa de dimensiones** (`TL.Model.shapeTable`) — a full
   table of every tensor in forward and backward with symbolic and numeric shapes; gradient check
   button showing the `TL.Trainer.gradCheck` table (relative errors, pass/fail chip).

## 11. Visual design (tokens — shell agent defines them in css/app.css; viz agent consumes)
Concept: a precise **technical lab notebook** — cool graph-paper ground, ink-navy text, schematic
diagram like the original paper's figure, matrices as heatmaps. Phase colours carry meaning
everywhere: forward = teal, backward (gradients) = magenta, update = ochre, data = slate.
Fonts (Google Fonts): display **Spectral** (600, used sparingly for headings), body **IBM Plex Sans**
(400/500/600), data **IBM Plex Mono** (400/500) for numbers, shapes, code. Fallback stacks required.

```css
:root {            /* light: "papel técnico" */
  --bg:#ECEFF2; --grid:#DCE2E8; --surface:#F8FAFB; --surface-2:#F1F4F7; --ink:#15202B; --muted:#5A6774;
  --rule:#C9D2DB; --focus:#2B6CB0;
  --fwd:#0E7C74; --fwd-soft:#D5ECE9; --bwd:#B42F6B; --bwd-soft:#F4DCE7; --upd:#A86B0C; --upd-soft:#F3E6CC;
  --data:#4A5B6C; --data-soft:#DDE3E9;
  --neg:#2F64B5; --zero:#F8FAFB; --pos:#C8502A; --prob-0:#F8FAFB; --prob-1:#4B2E83; --masked:#9AA6B2;
  --font-display:'Spectral', Georgia, 'Times New Roman', serif;
  --font-body:'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-mono:'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
}
/* dark: "pizarra" — redefine tokens under @media (prefers-color-scheme: dark) :root:not([data-theme=light])
   AND :root[data-theme=dark]; color-scheme: dark in both */
  --bg:#0E141A; --grid:#18222C; --surface:#131B23; --surface-2:#18222C; --ink:#E4EBF1; --muted:#93A1AE;
  --rule:#2A3643; --focus:#6FA8E8;
  --fwd:#3CC2B4; --fwd-soft:#12302E; --bwd:#F0679F; --bwd-soft:#3A1628; --upd:#F0B24A; --upd-soft:#3A2A10;
  --data:#9FB0C1; --data-soft:#1E2A36;
  --neg:#5B93E6; --zero:#131B23; --pos:#F07B4C; --prob-0:#131B23; --prob-1:#B89BFF; --masked:#4A5663;
```
`body` must set `background: var(--bg)` and `color: var(--ink)` explicitly. Layout must work at
phone width (≥ 360 px, 16 px side gutter, no horizontal page scroll; wide matrices scroll inside
their own container). Visible keyboard focus; respect `prefers-reduced-motion`. Use
`font-variant-numeric: tabular-nums` for numbers. No emoji as UI markers. Avoid the generic
"AI look" (purple gradients, everything centered, rounded cards everywhere).
