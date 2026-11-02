/* =============================================================================
   Atlas de Arquitecturas — js/arch/clip.js
   Modelo `clip` (Radford et al., ICML 2021, arXiv:2103.00020). Referencia para el cross-check:
   HF `transformers.CLIPModel(CLIPConfig(...))` construido en código (sin hub). Contrato: SPEC §14.3.

   Dos torres por muestra (sin batch) + una parte conjunta con batch explícito B (knob):
   - Imagen = ViT con las diferencias de CLIP: conv de parches SIN sesgo, LayerNorm `ln-pre` tras
     sumar posiciones, `ln-post` solo sobre el CLS, proyección D→E SIN sesgo.
   - Texto = transformer pre-LN de Lt capas, ancho Dt, máscara CAUSAL (op propia, nodo `mask`),
     LayerNorm final, features en el token EOT, proyección Dt→E SIN sesgo.
   - Conjunta: L2 → apilar B → matriz de similitud B×B → × e^t (logit_scale, 1 parámetro) → pérdida
     contrastiva simétrica. Activación QuickGELU (x·σ(1.702x)): mismos conteos que GELU.

   CONVENCIÓN DE CÓMPUTO (importante para la prosa): los totales son POR PAR imagen-texto.
   La op `similarity` cuenta B·E MACs (una fila de la matriz B×B: un par contra los B textos del
   lote); el lote completo cuesta B·(totales) = B·(torres) + B²·E, que es exactamente lo que mide
   PyTorch con un batch B (cross-check). metrics().logitsMacs = B²·E es la matmul entera.
   Los tensores conjuntos (img-batch, txt-batch, sims, logits, loss) sí son del lote (tensor.batched).

   Ops (path) — vista `clip-overview` (+ `clip-image-encoder`, `clip-text-encoder`):
     Imagen (prefijo de ids i-; path img-encoder › …):
       i-patch-embed   img-encoder › patch-embed › conv     i-img → i-patch-grid   (conv P×P sin sesgo)
       i-patch-flatten img-encoder › patch-embed › flatten  → i-patches
       i-cls           img-encoder › cls                    → i-cls-cat
       i-pos-embed     img-encoder › pos-embed              → i-e-pos
       i-add-pos       img-encoder › add-pos                i-cls-cat, i-e-pos → i-x0
       i-ln-pre        img-encoder › ln-pre                 → i-ln-pre
       capa (repeat L): i-ln1 · i-qkv · i-split · i-scores · i-scale · i-softmax · i-weighted-sum ·
         i-merge · i-proj · i-res1 · i-ln2 · i-fc1 · i-gelu · i-fc2 · i-res2 con paths
         img-encoder › enc-layer › {ln1, mhsa › {qkv, split, scores, scale, softmax, weighted-sum,
         merge, proj}, res1, ln2, mlp › {fc1, gelu, fc2}, res2}
       i-pool-cls      img-encoder › pool-cls               i-x-out → i-cls
       i-ln-post       img-encoder › ln-post                → i-cls-ln
       img-proj        img-proj                             → i-emb    (Linear D→E sin sesgo)
       img-norm        img-norm                             → i-emb-norm (L2)
       img-stack       img-norm                             → img-batch (B×E: el lote)
     Texto (prefijo t-; path txt-encoder › …):
       t-tok-embed     txt-encoder › tok-embed              t-ids → t-tok
       t-pos-embed     txt-encoder › pos-embed              → t-e-pos
       t-add-pos       txt-encoder › add-pos                → t-x0
       capa (repeat Lt): igual que la de imagen con prefijo t- y, entre scale y softmax,
         t-mask (txt-encoder › enc-layer › mhsa › mask) → t-masked
       t-ln-final      txt-encoder › ln-final               t-x-out → t-ln-final
       t-pick-eot      txt-encoder › pick-eot               → t-eot
       txt-proj        txt-proj                             → t-emb    (Linear Dt→E sin sesgo)
       txt-norm        txt-norm                             → t-emb-norm (L2)
       txt-stack       txt-norm                             → txt-batch (B×E)
     Conjunta: similarity (similarity) img-batch, txt-batch → sims · temperature (temperature)
       sims → logits · loss (loss) logits → loss
   Tensores (forward): i-img i-patch-grid i-patches i-cls-cat i-e-pos i-x0 i-ln-pre i-h-ln1 i-qkv i-q
     i-k i-v i-scores i-scores-scaled i-attn i-z-heads i-z i-o i-r1 i-h-ln2 i-u i-g i-f i-x-out i-cls
     i-cls-ln i-emb i-emb-norm img-batch · t-ids t-tok t-e-pos t-x0 t-h-ln1 t-qkv t-q t-k t-v t-scores
     t-scores-scaled t-masked t-attn t-z-heads t-z t-o t-r1 t-h-ln2 t-u t-g t-f t-x-out t-ln-final
     t-eot t-emb t-emb-norm txt-batch · sims logits loss
   Añadidos a la lista de §14.3 (nada renombrado): i-e-pos, t-e-pos (tablas de posición), i-scores-scaled,
   t-scores-scaled (salida de `scale`, como en ViT), i-z-heads, t-z-heads y `sims` (similitudes coseno
   B×B antes de la temperatura; `logits` = sims·e^t).
   Config: imagen H, W, P, D, L, h, Dmlp; texto T, V, Dt, Lt, ht, Dmlpt; E; B.
   Notación (Fig. 3 del paper, la misma del diagrama): I_f = f_I(x) ∈ ℝ^D (i-cls-ln), I_e = I_f·W_i con
   W_i ∈ ℝ^{D×E} (i-emb), Î = I_e/‖I_e‖ (i-emb-norm); igual T_f, T_e = T_f·W_t, T̂ para el texto.
   Etiquetas de tensor de las torres con prefijo "Torre de imagen · " / "Torre de texto · " y op.where
   = ['Torre de imagen'] / ['Torre de texto'] (las dos torres repiten nombres; ids sin cambios).
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const A = ATLAS.Arch;
  if (!A || !A.defineModel) throw new Error('clip.js necesita js/arch/primitives.js antes.');

  const txtB = { T: 77, V: 49408, Dt: 512, Lt: 12, ht: 8, Dmlpt: 2048 };
  const txtL = { T: 77, V: 49408, Dt: 768, Lt: 12, ht: 12, Dmlpt: 3072 };
  const base = { Cin: 3, B: 32768, act: 'quick_gelu', logitScaleInit: 1 / 0.07, logitScaleMax: 100 };
  const cfg = (img, txt, o) => Object.assign({}, base, img, txt, o);
  const vitB = (P) => ({ H: 224, W: 224, P, D: 768, L: 12, h: 12, Dmlp: 3072 });
  const vitL = (res) => ({ H: res, W: res, P: 14, D: 1024, L: 24, h: 16, Dmlp: 4096 });

  A.defineModel({
    id: 'clip',
    label: 'CLIP',
    paper: {
      title: 'Learning Transferable Visual Models From Natural Language Supervision',
      authors: 'Radford et al.', venue: 'ICML 2021', year: 2021, arxiv: '2103.00020',
    },
    configs: {
      'clip-vit-b16': cfg(vitB(16), txtB, { label: 'CLIP ViT-B/16', E: 512, canonical: true,
        source: 'Radford et al. 2021, Tabla 20 (ViT-B/16: imagen 12×768, 12 cabezas; texto 12×512, 8 cabezas; E = 512); HF CLIPModel(CLIPConfig(...))' }),
      'clip-vit-b32': cfg(vitB(32), txtB, { label: 'CLIP ViT-B/32', E: 512,
        source: 'Radford et al. 2021, Tabla 20 (ViT-B/32); HF CLIPModel(CLIPConfig(...))' }),
      'clip-vit-l14': cfg(vitL(224), txtL, { label: 'CLIP ViT-L/14', E: 768,
        source: 'Radford et al. 2021, Tabla 20 (ViT-L/14: imagen 24×1024, 16 cabezas; texto 12×768, 12 cabezas; E = 768); HF CLIPModel(CLIPConfig(...))' }),
      'clip-vit-l14-336': cfg(vitL(336), txtL, { label: 'CLIP ViT-L/14 @ 336', E: 768,
        source: 'Radford et al. 2021, Tabla 20 (ViT-L/14@336px, una época extra a 336); HF CLIPModel(CLIPConfig(...)); el encoder de LLaVA-1.5' }),
    },
    // B: batch del lote contrastivo (solo cambia los tensores conjuntos y metrics()).
    // res y P: los de la torre de imagen (como en ViT; la tabla de posición se interpola).
    knobs: { B: [8, 256, 4096, 32768], res: [224, 336, 448], P: [14, 16, 32] },

    applyKnobs(c, ov) {
      const notes = [];
      if (ov.B !== undefined) c.B = ov.B;
      if (c.B !== 32768) notes.push('Batch contrastivo B = ' + A.fmt.int(c.B) + ' (el paper usa 32,768): cambian img-batch, txt-batch, sims y logits; las torres no.');
      const N0 = (c.H / c.P) * (c.W / c.P);
      if (ov.res !== undefined) { c.H = ov.res; c.W = ov.res; }
      if (ov.P !== undefined) c.P = ov.P;
      if (c.H % c.P !== 0) throw new Error('CLIP: la resolución ' + c.H + ' no es divisible por el patch P = ' + c.P + '.');
      const N = (c.H / c.P) * (c.W / c.P);
      if (N !== N0) {
        notes.push('Position embeddings de imagen interpolados: de ' + (N0 + 1) + '×' + c.D + ' a ' + (N + 1) + '×' + c.D + (N > N0 ? ' (como CLIP ViT-L/14 → @336).' : '.'));
        c.label = 'CLIP ViT-' + (c.D === 1024 ? 'L' : 'B') + '/' + c.P + (c.H !== 224 ? ' @ ' + c.H : '');
      }
      c._notes = notes;
      return c;
    },

    resolve(c) {
      if (c.H % c.P !== 0) throw new Error('CLIP: la resolución ' + c.H + ' no es divisible por el patch P = ' + c.P + '.');
      if (c.D % c.h !== 0 || c.Dt % c.ht !== 0) throw new Error('CLIP: el ancho no es divisible por el número de cabezas.');
      c.res = c.H;
      c.gridH = c.H / c.P; c.gridW = c.W / c.P;
      c.N = c.gridH * c.gridW;
      c.tokens = c.N + 1;
      c.dh = c.D / c.h; c.dht = c.Dt / c.ht;
      c.negatives = c.B - 1;
      return c;
    },

    build(c, A) {
      const g = A.graph(c);
      // ---------------- torre de imagen
      // Contexto para mostrar: las dos torres repiten nombres (Q, LayerNorm 1, Posición…), así que las
      // etiquetas de tensor y op.where dicen la torre. Ids sin cambios.
      const IE = ['img-encoder'], WI = ['Torre de imagen'], TI = 'Torre de imagen · ';
      const img = g.input('i-img', A.shape(['H', 'W', '3'], [c.H, c.W, c.Cin], 'img', 'grid'), { label: 'Imagen de entrada', tex: 'x' });
      const grid = g.op('i-patch-embed', A.conv2d(img, { k: c.P, s: c.P, cout: c.D, coutSym: 'D', kSym: 'P', outSym: ['H/P', 'W/P'], bias: false, macTex: 'N\\cdot D\\cdot P^2\\cdot 3' }), {
        where: WI, path: IE.concat(['patch-embed', 'conv']), out: 'i-patch-grid', label: 'Patch embedding (conv P×P, stride P, sin sesgo)', type: 'conv', group: 'embed',
        outMeta: { label: TI + 'rejilla de parches embebidos', tex: 'X_{\\mathrm{grid}}' },
      });
      const xp = g.op('i-patch-flatten', A.flatten(grid, { sym: ['N', 'D'] }), {
        where: WI, path: IE.concat(['patch-embed', 'flatten']), out: 'i-patches', label: 'Aplanar la rejilla', type: 'tensorop', group: 'embed',
        outMeta: { label: TI + 'patches embebidos', tex: 'X_p E' },
      });
      const xc = g.op('i-cls', A.cls_token(xp, { outSym: 'N+1' }), {
        where: WI, path: IE.concat(['cls']), out: 'i-cls-cat', label: 'Token CLS (class embedding)', type: 'embed', group: 'embed',
        outMeta: { label: TI + 'CLS + patches', tex: '[x_{\\mathrm{cls}};\\,X_p E]' },
      });
      const ep = g.op('i-pos-embed', A.pos_embed_learned({ rows: c.N + 1, rowsSym: 'N+1', D: c.D, mod: 'img' }), {
        where: WI, path: IE.concat(['pos-embed']), out: 'i-e-pos', label: 'Position embeddings aprendidos', type: 'embed', group: 'embed',
        outMeta: { label: TI + 'tabla de posición', tex: 'E_{\\mathrm{pos}}' },
      });
      const x0 = g.op('i-add-pos', A.add(xc, ep), {
        where: WI, path: IE.concat(['add-pos']), out: 'i-x0', label: 'Suma de posición', type: 'tensorop', group: 'embed',
        outMeta: { label: TI + 'tokens con posición', tex: 'x_0' },
      });
      const xpre = g.op('i-ln-pre', A.layernorm(x0), {
        where: WI, path: IE.concat(['ln-pre']), out: 'i-ln-pre', label: 'LayerNorm previo (ln_pre)', type: 'norm', group: 'norm',
        outMeta: { label: TI + 'entrada al encoder (tras ln_pre)', tex: '\\mathrm{LN}_{\\mathrm{pre}}(x_0)' },
      });
      const ixL = A.preLnLayer(g, xpre, {
        prefix: IE.concat(['enc-layer']), L: c.L, h: c.h, Dmlp: c.Dmlp, tid: 'i-', oid: 'i-', where: WI, labelPrefix: TI,
        actLabel: 'QuickGELU', actTex: 'U\\,\\sigma(1.702\\,U)',
      });
      const icls = g.op('i-pool-cls', A.pool_cls(ixL), {
        where: WI, path: IE.concat(['pool-cls']), out: 'i-cls', label: 'Tomar el token CLS', type: 'tensorop', group: 'head',
        outMeta: { label: TI + 'vector del CLS', tex: 'x_L^{\\mathrm{cls}}' },
      });
      const icln = g.op('i-ln-post', A.layernorm(icls), {
        where: WI, path: IE.concat(['ln-post']), out: 'i-cls-ln', label: 'LayerNorm posterior (ln_post, solo el CLS)', type: 'norm', group: 'norm',
        outMeta: { label: TI + 'CLS normalizado (salida de la torre)', tex: 'I_f = f_I(x) = \\mathrm{LN}_{\\mathrm{post}}(x_L^{\\mathrm{cls}})' },
      });
      const iemb = g.op('img-proj', A.linear(icln, { dout: c.E, doutSym: 'E', bias: false }), {
        path: ['img-proj'], out: 'i-emb', label: 'Proyección de imagen D → E (sin sesgo)', type: 'embed', group: 'head',
        outMeta: { label: 'Embedding de imagen (proyectado, D → E)', tex: 'I_e = I_f\\,W_i' },
      });
      const inrm = g.op('img-norm', A.l2_normalize(iemb), {
        path: ['img-norm'], out: 'i-emb-norm', label: 'Normalización L2', type: 'tensorop', group: 'head',
        outMeta: { label: 'Embedding de imagen unitario', tex: '\\hat I = I_e/\\lVert I_e\\rVert_2' },
      });
      const ib = g.op('img-stack', A.stack_batch(inrm, { B: c.B }), {
        path: ['img-norm'], out: 'img-batch', label: 'Lote de B imágenes', type: 'tensorop', group: 'head', batched: true,
        outMeta: { label: 'Embeddings de imagen del lote', tex: '\\hat I \\in \\mathbb{R}^{B\\times E}', batched: true },
      });

      // ---------------- torre de texto
      const TE = ['txt-encoder'], WT = ['Torre de texto'], TT = 'Torre de texto · ';
      const ids = g.input('t-ids', A.shape(['T'], [c.T], 'txt', 'vec'), { label: 'Ids de tokens (BPE, con SOT y EOT)', tex: 't' });
      const tok = g.op('t-tok-embed', A.embedding_lookup(ids, { V: c.V, D: c.Dt, Dsym: 'D_t' }), {
        where: WT, path: TE.concat(['tok-embed']), out: 't-tok', label: 'Token embedding (V × D_t)', type: 'embed', group: 'embed',
        outMeta: { label: TT + 'embeddings de tokens', tex: 'E_{\\mathrm{tok}}[t]' },
      });
      const tep = g.op('t-pos-embed', A.pos_embed_learned({ rows: c.T, rowsSym: 'T', D: c.Dt, Dsym: 'D_t', mod: 'txt' }), {
        where: WT, path: TE.concat(['pos-embed']), out: 't-e-pos', label: 'Position embeddings aprendidos', type: 'embed', group: 'embed',
        outMeta: { label: TT + 'tabla de posición del texto', tex: 'E_{\\mathrm{pos}}' },
      });
      const tx0 = g.op('t-add-pos', A.add(tok, tep), {
        where: WT, path: TE.concat(['add-pos']), out: 't-x0', label: 'Suma de posición', type: 'tensorop', group: 'embed',
        outMeta: { label: TT + 'entrada al encoder de texto', tex: 'x_0' },
      });
      const txL = A.preLnLayer(g, tx0, {
        prefix: TE.concat(['enc-layer']), L: c.Lt, h: c.ht, Dmlp: c.Dmlpt, tid: 't-', oid: 't-', maskOp: true, where: WT, labelPrefix: TT,
        actLabel: 'QuickGELU', actTex: 'U\\,\\sigma(1.702\\,U)',
      });
      const tln = g.op('t-ln-final', A.layernorm(txL), {
        where: WT, path: TE.concat(['ln-final']), out: 't-ln-final', label: 'LayerNorm final', type: 'norm', group: 'norm',
        outMeta: { label: TT + 'salida normalizada', tex: '\\mathrm{LN}(x_L)' },
      });
      const teot = g.op('t-pick-eot', A.pick_token(tln, { index: 'EOT (id más alto de la secuencia)' }), {
        where: WT, path: TE.concat(['pick-eot']), out: 't-eot', label: 'Tomar el token EOT', type: 'tensorop', group: 'head',
        outMeta: { label: TT + 'vector del EOT (salida de la torre)', tex: 'T_f = f_T(t) = x_L^{\\mathrm{eot}}' },
      });
      const temb = g.op('txt-proj', A.linear(teot, { dout: c.E, doutSym: 'E', bias: false }), {
        path: ['txt-proj'], out: 't-emb', label: 'Proyección de texto D_t → E (sin sesgo)', type: 'embed', group: 'head',
        outMeta: { label: 'Embedding de texto (proyectado, D_t → E)', tex: 'T_e = T_f\\,W_t' },
      });
      const tnrm = g.op('txt-norm', A.l2_normalize(temb), {
        path: ['txt-norm'], out: 't-emb-norm', label: 'Normalización L2', type: 'tensorop', group: 'head',
        outMeta: { label: 'Embedding de texto unitario', tex: '\\hat T = T_e/\\lVert T_e\\rVert_2' },
      });
      const tb = g.op('txt-stack', A.stack_batch(tnrm, { B: c.B }), {
        path: ['txt-norm'], out: 'txt-batch', label: 'Lote de B textos', type: 'tensorop', group: 'head', batched: true,
        outMeta: { label: 'Embeddings de texto del lote', tex: '\\hat T \\in \\mathbb{R}^{B\\times E}', batched: true },
      });

      // ---------------- parte conjunta (por par: ver la cabecera)
      const sim = perPair(A.similarity_logits(ib, tb), c);
      const sims = g.op('similarity', sim, {
        path: ['similarity'], out: 'sims', label: 'Similitudes coseno I_e·T_eᵀ (B×B)', type: 'fuse', group: 'head', batched: true,
        macTex: 'B\\cdot E\\;\\text{por par}\\;(B^2E\\ \\text{el lote})',
        outMeta: { label: 'Similitudes coseno del lote', tex: '\\hat I\\,\\hat T^\\top', batched: true },
      });
      const ls = A.logit_scale(sims);
      ls.other = c.B;   // por par: una fila
      const logits = g.op('temperature', ls, {
        path: ['temperature'], out: 'logits', label: 'Temperatura aprendida (× e^t, tope 100)', type: 'head', group: 'head', batched: true,
        outMeta: { label: 'Logits del lote', tex: 'e^{t}\\, \\hat I\\,\\hat T^\\top', batched: true },
      });
      const lo = A.contrastive_loss(logits);
      lo.other = Math.round(lo.other / c.B);   // por par
      g.op('loss', lo, {
        path: ['loss'], out: 'loss', label: 'Pérdida contrastiva simétrica (InfoNCE)', type: 'head', group: 'head', batched: true,
        outMeta: { label: 'Pérdida del lote', tex: '\\tfrac12(\\mathrm{CE}_{\\mathrm{img}} + \\mathrm{CE}_{\\mathrm{txt}})', batched: true },
      });
      return g;
    },

    quantities(c, r) {
      const n = r.totals.byNode;
      const imgMacs = n['img-encoder'].macs + n['img-proj'].macs;
      const txtMacs = n['txt-encoder'].macs + n['txt-proj'].macs;
      return {
        tokens: c.tokens, patches: c.N, grid: c.gridH, res: c.H, P: c.P, D: c.D, L: c.L, h: c.h, dh: c.dh, Dmlp: c.Dmlp,
        T: c.T, V: c.V, Dt: c.Dt, Lt: c.Lt, ht: c.ht, dht: c.dht, Dmlpt: c.Dmlpt, E: c.E, B: c.B, negatives: c.B - 1,
        imgParams: n['img-encoder'].params + n['img-proj'].params, txtParams: n['txt-encoder'].params + n['txt-proj'].params,
        imgEncoderParams: n['img-encoder'].params, txtEncoderParams: n['txt-encoder'].params,
        tokEmbedParams: n['tok-embed'].params, imgMacs, txtMacs, towerMacs: imgMacs + txtMacs,
        logitsMacs: c.B * c.B * c.E, logitsElements: c.B * c.B,
        layerParamsImg: r.ops.filter((o) => o.path[0] === 'img-encoder' && o.path[1] === 'enc-layer').reduce((s, o) => s + o.params, 0),
        layerParamsTxt: r.ops.filter((o) => o.path[0] === 'txt-encoder' && o.path[1] === 'enc-layer').reduce((s, o) => s + o.params, 0),
      };
    },

    // metrics(): memoria de la matriz B×B (fp32 y bf16), negativos por muestra y costo del lote.
    // Las torres son POR MUESTRA (B = 1): attnMem, attnMemAllLayers y actMem no se multiplican por el B
    // del lote contrastivo (32,768); las versiones del lote completo van en *Batch. Lo que sí depende de
    // B (la matriz B×B, los embeddings del lote) está en logits*, embBatchMem y negatives.
    metrics(c, r, o) {
      const q = r.quantities, B = c.B;
      const sc = r.ops.filter((op) => op.prim === 'attention_scores');
      const el = (op) => r.tensors[op.out[0]].elements;
      const tower = (p) => sc.filter((op) => op.path[0] === p);
      const maxEl = (ops) => ops.reduce((m, op) => Math.max(m, el(op)), 0);
      const attnMem = maxEl(sc) * o.by;
      const attnMemAllLayers = sc.reduce((s, op) => s + el(op) * op.repeat, 0) * o.by;
      return {
        attnMem, attnMemAllLayers,                           // por muestra, el mayor de UNA capa / todas las capas
        imgAttnMem: maxEl(tower('img-encoder')) * o.by, txtAttnMem: maxEl(tower('txt-encoder')) * o.by,
        attnMemBatch: attnMem * B, attnMemAllLayersBatch: attnMemAllLayers * B,
        actMem: o.actMemPerSample,                          // activaciones de las dos torres, una muestra
        actMemBatch: o.actMemBatch,                          // el lote entero: torres × B + tensores del lote
        negatives: B - 1, negativesPerSample: B - 1, logitsElements: B * B,
        logitsMem: B * B * o.by, logitsFp32Mem: B * B * 4, logitsBf16Mem: B * B * 2,
        logitsMacs: B * B * c.E, towerMacs: q.towerMacs, imgMacs: q.imgMacs, txtMacs: q.txtMacs,
        batchMacs: B * r.totals.macs,                       // forward de todo el lote (= PyTorch con batch B)
        logitsMacsShare: (B * B * c.E) / (B * r.totals.macs),
        embBatchMem: 2 * B * c.E * o.by,                     // img-batch + txt-batch
      };
    },
  });

  // La matmul B×E·E×B cuenta por par: B·E MACs (el lote completo B²E vive en detail.batchMacs).
  function perPair(res, c) {
    const batchMacs = res.macs;
    res.macs = c.B * c.E;
    res.macArith = c.B + '·' + c.E + ' = ' + A.fmt.int(res.macs);
    res.detail = Object.assign({}, res.detail, { batchMacs, perPair: true, note: 'B²E para el lote; B·E por par (una fila de la matriz)' });
    return res;
  }
})(typeof window !== 'undefined' ? window : globalThis);
