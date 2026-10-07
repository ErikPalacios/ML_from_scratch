/* =============================================================================
   Atlas de Arquitecturas — js/arch/swin.js
   Modelo `swin` (Liu et al., ICCV 2021, arXiv:2103.14030). Referencia: timm
   `swin_tiny_patch4_window7_224` y hermanos (pretrained=False). Contrato de ids: SPEC §14.1.

   Convenciones: rejillas H×W×C (channels-last, como timm, que trabaja en NHWC); ventanas
   nW×M²×C (layout 'windows'); cabezas nW×h×M²×d_h (layout 'winheads'). C = ancho del stage 1
   (96 en Swin-T); la imagen tiene 3 canales (cfg.Cin). Etapa k: lado H/(4·2^(k−1)), canales
   C·2^(k−1) (símbolos C, 2C, 4C, 8C), h_k cabezas (d_h = 32).

   Regla de timm (verificada): si el mapa de una etapa NO es mayor que la ventana (lado ≤ M), la
   ventana pasa a ser el mapa entero (M_k = lado, una sola ventana) y NO hay desplazamiento (shift 0):
   p. ej. el stage 4 de Swin-T @224 (7×7 con M = 7). La tabla de sesgo relativo usa ese M_k.
   Si el lado es mayor que M y no es múltiplo de M, timm rellena con padding: el calculador no
   lo modela y da un error (knobs válidos: lado de cada etapa múltiplo de M o ≤ M).

   Vista general `swin-overview` — ops y path:
     patch-embed   patch-embed › conv    x-img → x-patch-grid            (conv P×P stride P, con sesgo)
     patch-norm    patch-embed › norm    x-patch-grid → x-embed          (LayerNorm del patch embedding)
     stage1…stage4 (grupos; repeat = profundidad/2 pares de bloques)
     merge1…merge3 (patch merging antes de los stages 2, 3 y 4)
     final-ln      final-ln              s4-out → x-ln
     pool          pool                  x-ln → pooled                   (global average pooling)
     head          head                  pooled → logits
   Par de bloques (stage k, bloque j ∈ {1: W-MSA, 2: SW-MSA}); op id = s{k}-b{j}-<op>:
     ln1 · [shift] · partition · qkv · split · scores · scale · bias · [mask] · softmax ·
     weighted-sum · merge · proj · reverse · [unshift] · res1 · ln2 · fc1 · gelu · fc2 · res2
     ([…] solo en bloques con desplazamiento: los b2 de las etapas cuyo lado > M).
   Paths del stage 1 (los nodos de `swin-block-pair`, `swin-wmsa` y `swin-swmsa`):
     stage1 › w-ln1 · stage1 › w-msa › {partition, qkv, split, scores, scale, bias, softmax,
     weighted-sum, merge, proj, reverse} · stage1 › w-res1 · stage1 › w-ln2 ·
     stage1 › w-mlp › {fc1, gelu, fc2} · stage1 › w-res2;  el bloque 2 igual con sw-* y, dentro de
     sw-msa, además shift, mask y unshift.
     OJO: los nodos internos (qkv, scores, …, fc1) son los mismos ids en w-msa y sw-msa, así que
     totals.byNode.qkv suma los dos bloques del stage 1 (× pares); w-msa, sw-msa, w-mlp, sw-mlp,
     w-ln1… son por bloque. Para el número de UN bloque usa op.<s1-b1-qkv>.
   Paths de los stages 2–4 (sin nodos internos; prefijo s{k}-):
     stage{k} › s{k}-w-ln1 · stage{k} › s{k}-w-msa (todas las ops de atención) · stage{k} › s{k}-w-res1 ·
     stage{k} › s{k}-w-ln2 · stage{k} › s{k}-w-mlp (fc1, gelu, fc2) · stage{k} › s{k}-w-res2; y s{k}-sw-*.
   Patch merging (`swin-patch-merging`, números de merge1):
     m1-concat  merge1 › concat   s1-out → m1-concat        (2×2 vecinos: H/8×W/8×4C)
     m1-ln      merge1 › ln       m1-concat → m1-ln         (LayerNorm(4C))
     m1-reduce  merge1 › reduce   m1-ln → m1-out            (Linear 4C→2C sin sesgo)
     merge2/merge3: ops m{k}-concat/-ln/-reduce con paths merge{k} › m{k}-concat / m{k}-ln / m{k}-reduce.

   Tensores (orden del forward):
     x-img · x-patch-grid · x-embed ·
     por etapa k y bloque j: s{k}-b{j}-ln1 · [-shift] · -win · -qkv · -q · -k · -v · -scores ·
       -scaled · -biased · [-masked] · -attn · -z-heads · -z · -proj · -unwin · [-unshift] · -r1 ·
       -ln2 · -u · -g · -f · y la salida: s{k}-b1-out (bloque 1) / s{k}-out (bloque 2 = salida del
       par; tras el último par, salida del stage) ·
     m{k}-concat · m{k}-ln · m{k}-out (k = 1..3) · x-ln · pooled · logits.
   Diferencias con la lista de SPEC §14.1 (añadidos/ajustes, nada renombrado):
     - `s{k}-b{j}-z-heads` (añadido): salida de A·V por cabeza (nW×h×M²×d_h), como `z-heads` en ViT;
       `s{k}-b{j}-z` = cabezas concatenadas (nW×M²×C).
     - NO existen `s{k}-b{j}-in` ni `s{k}-b2-out` (serían duplicados): la entrada del bloque 1 es
       `x-embed` (stage 1) o `m{k−1}-out` (stages 2–4); la del bloque 2 es `s{k}-b1-out`; la salida
       del bloque 2 es `s{k}-out`.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const A = ATLAS.Arch;
  if (!A || !A.defineModel) throw new Error('swin.js necesita js/arch/primitives.js antes.');

  // paperParamsM / paperGFLOPs: Tabla 1(a) del paper (provenance 'paper'; sus "FLOPs" son MACs).
  const base = { Cin: 3, P: 4, M: 7, mlpRatio: 4, K: 1000, qkvBias: true, projBias: true, mlpBias: true };
  const cfg = (o) => Object.assign({}, base, o);
  const T_DEPTHS = [2, 2, 6, 2], S_DEPTHS = [2, 2, 18, 2];

  // k·sym para símbolos de canales: 3·'C' → '3C'; 3·'2C' → '6C'.
  function mulSym(k, s) {
    const m = String(s).match(/^(\d+)(.*)$/);
    return m ? String(k * parseInt(m[1], 10)) + m[2] : (k === 1 ? s : k + s);
  }
  const SIZE = { 96: { 6: 'T', 18: 'S' }, 128: { 18: 'B' }, 192: { 18: 'L' } };
  const sizeOf = (c) => ((SIZE[c.C] || {})[c.depths[2]]) || ('C' + c.C);

  A.defineModel({
    id: 'swin',
    label: 'Swin Transformer',
    paper: {
      title: 'Swin Transformer: Hierarchical Vision Transformer using Shifted Windows',
      authors: 'Liu et al.', venue: 'ICCV 2021 (Marr Prize)', year: 2021, arxiv: '2103.14030',
    },
    configs: {
      'swin-t-224': cfg({ label: 'Swin-T @ 224', H: 224, W: 224, C: 96, depths: T_DEPTHS, heads: [3, 6, 12, 24], canonical: true, paperParamsM: 28, paperGFLOPs: 4.5,
        timm: 'swin_tiny_patch4_window7_224',
        source: 'Liu et al. 2021, §3.3 (variantes: Swin-T C = 96, profundidades {2, 2, 6, 2}) y Tabla 1(a) (28M, 4.5G); timm swin_tiny_patch4_window7_224' }),
      'swin-s-224': cfg({ label: 'Swin-S @ 224', H: 224, W: 224, C: 96, depths: S_DEPTHS, heads: [3, 6, 12, 24], paperParamsM: 50, paperGFLOPs: 8.7,
        timm: 'swin_small_patch4_window7_224',
        source: 'Liu et al. 2021, §3.3 (Swin-S: C = 96, profundidades {2, 2, 18, 2}) y Tabla 1(a) (50M, 8.7G); timm swin_small_patch4_window7_224' }),
      'swin-b-224': cfg({ label: 'Swin-B @ 224', H: 224, W: 224, C: 128, depths: S_DEPTHS, heads: [4, 8, 16, 32], paperParamsM: 88, paperGFLOPs: 15.4,
        timm: 'swin_base_patch4_window7_224',
        source: 'Liu et al. 2021, §3.3 (Swin-B: C = 128, profundidades {2, 2, 18, 2}) y Tabla 1(a) (88M, 15.4G); timm swin_base_patch4_window7_224' }),
      'swin-b-384': cfg({ label: 'Swin-B @ 384 (M = 12)', H: 384, W: 384, C: 128, depths: S_DEPTHS, heads: [4, 8, 16, 32], M: 12, paperParamsM: 88, paperGFLOPs: 47.0,
        timm: 'swin_base_patch4_window12_384',
        source: 'Liu et al. 2021, Tabla 1(a) (Swin-B a 384², ventana 12: 88M, 47.0G); timm swin_base_patch4_window12_384' }),
    },
    // Sugeridos; se acepta cualquier par (res, M) en que el lado de cada etapa sea múltiplo de M o ≤ M.
    knobs: { res: [224, 384, 448], M: [7, 12, 14] },

    applyKnobs(c, ov) {
      if (ov.res !== undefined) { c.H = ov.res; c.W = ov.res; }
      if (ov.M !== undefined) c.M = ov.M;
      const notes = [];
      if (ov.M !== undefined && ov.M !== base.M) {
        notes.push('Cambiar M cambia la tabla de sesgo relativo de cada bloque a (2M−1)²·h parámetros (timm la interpola al cargar pesos de otro M).');
      }
      c._notes = notes;
      if (ov.res !== undefined || ov.M !== undefined) c.label = 'Swin-' + sizeOf(c) + ' @ ' + c.H + (c.M !== 7 ? ' (M = ' + c.M + ')' : '');
      return c;
    },

    resolve(c) {
      if (c.H !== c.W) throw new Error('Swin: el calculador solo modela imágenes cuadradas (H = W).');
      if (c.H % c.P !== 0) throw new Error('Swin: la resolución ' + c.H + ' no es divisible por el patch P = ' + c.P + '.');
      c.res = c.H;
      c.tokens = (c.H / c.P) * (c.W / c.P);
      c.patches = c.tokens;
      c.depthsStr = c.depths.join(', ');
      c.L = c.depths.reduce((a, b) => a + b, 0);
      c.stages = c.depths.map((depth, i) => {
        const k = i + 1, f = c.P * Math.pow(2, i);
        if (c.H % f !== 0) throw new Error('Swin: la resolución ' + c.H + ' no llega entera al stage ' + k + ' (lado ' + (c.H / f) + ').');
        if (depth % 2 !== 0) throw new Error('Swin: la profundidad del stage ' + k + ' debe ser par (pares W-MSA + SW-MSA).');
        const side = c.H / f, Ck = c.C * Math.pow(2, i), h = c.heads[i];
        if (Ck % h !== 0) throw new Error('Swin: C = ' + Ck + ' no es divisible por h = ' + h + ' en el stage ' + k + '.');
        // timm _calc_window_shift: ventana = min(lado, M); shift = 0 si lado ≤ M.
        const clamped = side <= c.M;
        const Mk = clamped ? side : c.M;
        if (!clamped && side % c.M !== 0) {
          throw new Error('Swin: el stage ' + k + ' tiene un mapa de ' + side + '×' + side + ', que no es múltiplo de la ventana M = ' + c.M +
            ' (timm rellenaría con padding; el calculador no lo modela). Prueba res = ' + (32 * c.M) + ' (o un múltiplo) o una M que divida ' + side + '.');
        }
        return {
          k, side, sideSym: 'H/' + f, sideSymW: 'W/' + f, tokens: side * side, C: Ck, Csym: i === 0 ? 'C' : Math.pow(2, i) + 'C', h, dh: Ck / h,
          depth, pairs: depth / 2, M: Mk, windowTokens: Mk * Mk, windows: (side / Mk) * (side / Mk),
          shift: clamped ? 0 : Math.floor(c.M / 2), clamped: Mk !== c.M, stride: f,
        };
      });
      c.dh = c.stages[0].dh;
      c.Cout = c.stages[3].C;
      return c;
    },

    build(c, A) {
      const g = A.graph(c);
      const img = g.input('x-img', A.shape(['H', 'W', '3'], [c.H, c.W, c.Cin], 'img', 'grid'), { label: 'Imagen de entrada', tex: 'x' });
      const s1 = c.stages[0];
      const pg = g.op('patch-embed', A.conv2d(img, { k: c.P, s: c.P, cout: c.C, coutSym: 'C', kSym: 'P', outSym: [s1.sideSym, s1.sideSymW], bias: true }), {
        path: ['patch-embed', 'conv'], out: 'x-patch-grid', label: 'Patch partition + linear embedding (conv ' + c.P + '×' + c.P + ', stride ' + c.P + ')', type: 'conv', group: 'embed',
        outMeta: { label: 'Rejilla de tokens de ' + c.P + '×' + c.P + ' px', tex: 'X_{\\mathrm{grid}}' },
      });
      let x = g.op('patch-norm', A.layernorm(pg), {
        path: ['patch-embed', 'norm'], out: 'x-embed', label: 'LayerNorm del patch embedding', type: 'norm', group: 'norm',
        outMeta: { label: 'Tokens embebidos (entrada del stage 1)', tex: 'z_0' },
      });

      for (const st of c.stages) {
        if (st.k > 1) x = patchMerging(g, x, c.stages[st.k - 2], st);
        x = swinBlock(g, x, st, 1, 0);
        x = swinBlock(g, x, st, 2, st.shift);
      }

      const xl = g.op('final-ln', A.layernorm(x), {
        path: ['final-ln'], out: 'x-ln', label: 'LayerNorm final', type: 'norm', group: 'norm',
        outMeta: { label: 'Salida del stage 4 normalizada', tex: '\\mathrm{LN}(z_4)' },
      });
      const pooled = g.op('pool', A.global_avg_pool(xl), {
        path: ['pool'], out: 'pooled', label: 'Global average pooling', type: 'tensorop', group: 'head',
        outMeta: { label: 'Promedio espacial', tex: '\\bar z' },
      });
      g.op('head', A.classifier_head(pooled, { K: c.K }), {
        path: ['head'], out: 'logits', label: 'Cabeza de clasificación', type: 'head', group: 'head',
        outMeta: { label: 'Logits', tex: 'z = \\bar z W + b' },
      });
      return g;
    },

    quantities(c, r) {
      const n = r.totals.byNode;
      const q = {
        tokens: c.tokens, patches: c.patches, res: c.H, P: c.P, C: c.C, M: c.M, K: c.K, L: c.L, dh: c.dh,
        depths: c.depthsStr, Cout: c.Cout,
        patchEmbedParams: n['patch-embed'].params, patchEmbedMacs: n['patch-embed'].macs,
        headParams: n.head.params, finalLnParams: n['final-ln'].params,
        biasTableS1: (2 * c.stages[0].M - 1) * (2 * c.stages[0].M - 1), biasParamsS1Block: (2 * c.stages[0].M - 1) * (2 * c.stages[0].M - 1) * c.stages[0].h,
      };
      for (const st of c.stages) Object.assign(q, stageQuantities(c, st, n));
      for (let k = 1; k <= 3; k++) { q['merge' + k + 'Params'] = n['merge' + k].params; q['merge' + k + 'Macs'] = n['merge' + k].macs; }
      // Bloque del stage 1 (W-MSA) — reglas de la prosa.
      q.wmsaParamsS1 = n['w-msa'].params; q.wmsaMacsS1 = n['w-msa'].macs;
      q.blockParamsS1 = n['w-ln1'].params + n['w-msa'].params + n['w-ln2'].params + n['w-mlp'].params;
      q.windowScoreMacs = c.stages.reduce((s, st) => s + st.depth * scoreMacsBlock(st), 0);
      q.globalScoreMacs = c.stages.reduce((s, st) => s + st.depth * globalScoreMacsBlock(st), 0);
      return q;
    },

    // metrics(): por etapa, tokens, ventanas, MACs de scores (QKᵀ + A·V) por bloque con ventanas y con
    // atención global a la misma resolución, la razón (= HW/M² = nº de ventanas) y la memoria de scores.
    metrics(c, r, o) {
      const out = {};
      const stages = c.stages.map((st) => {
        const s = stageQuantities(c, st, r.totals.byNode);
        const attnMem = st.windows * st.h * st.windowTokens * st.windowTokens * o.by * o.B;
        const globalAttnMem = st.h * st.tokens * st.tokens * o.by * o.B;
        Object.assign(out, s);
        out['s' + st.k + 'AttnMem'] = attnMem;
        out['s' + st.k + 'GlobalAttnMem'] = globalAttnMem;
        return {
          k: st.k, side: st.side, tokens: st.tokens, C: st.C, h: st.h, depth: st.depth, M: st.M, windows: st.windows, shift: st.shift,
          scoreMacs: scoreMacsBlock(st), globalScoreMacs: globalScoreMacsBlock(st), ratio: st.tokens / st.windowTokens,
          attnMem, globalAttnMem,
        };
      });
      out.stages = stages;
      out.windowScoreMacs = stages.reduce((s, x) => s + x.depth * x.scoreMacs, 0);
      out.globalScoreMacs = stages.reduce((s, x) => s + x.depth * x.globalScoreMacs, 0);
      out.globalToWindow = out.globalScoreMacs / out.windowScoreMacs;
      return out;
    },
  });

  // MACs de QKᵀ + A·V de un bloque: con ventanas 2·HW·M²·C; global 2·(HW)²·C.
  const scoreMacsBlock = (st) => 2 * st.tokens * st.windowTokens * st.C;
  const globalScoreMacsBlock = (st) => 2 * st.tokens * st.tokens * st.C;

  function stageQuantities(c, st, n) {
    const p = 's' + st.k;
    const o = {};
    o[p + 'Res'] = st.side; o[p + 'Tokens'] = st.tokens; o[p + 'C'] = st.C; o[p + 'Heads'] = st.h;
    o[p + 'Depth'] = st.depth; o[p + 'Pairs'] = st.pairs; o[p + 'Window'] = st.M; o[p + 'WindowTokens'] = st.windowTokens;
    o[p + 'Windows'] = st.windows; o[p + 'Shift'] = st.shift; o[p + 'Stride'] = st.stride;
    o[p + 'ScoreMacs'] = scoreMacsBlock(st);                 // por bloque, QKᵀ + A·V con ventanas
    o[p + 'QkMacs'] = scoreMacsBlock(st) / 2;                // por bloque, solo QKᵀ: HW·M²·C
    o[p + 'GlobalScoreMacs'] = globalScoreMacsBlock(st);     // por bloque, si la atención fuera global
    o[p + 'GlobalToWindow'] = st.tokens / st.windowTokens;   // = nº de ventanas
    o[p + 'ScoreMacsStage'] = st.depth * scoreMacsBlock(st);
    if (n) { o[p + 'Params'] = n['stage' + st.k].params; o[p + 'Macs'] = n['stage' + st.k].macs; }
    return o;
  }

  // Par de bloques: j = 1 (W-MSA) o 2 (SW-MSA, con desplazamiento `shift` si > 0).
  function swinBlock(g, x, st, j, shift) {
    const k = st.k, pre = 's' + k + '-b' + j + '-', w = j === 1 ? 'w' : 'sw';
    const S = 'stage' + k, nb = k === 1 ? '' : 's' + k + '-';
    const rep = st.pairs;
    const Cs = st.Csym;
    const pBlock = (name) => [S, nb + w + '-' + name];
    const pMsa = (inner) => (k === 1 ? [S, w + '-msa', inner] : [S, nb + w + '-msa']);
    const pMlp = (inner) => (k === 1 ? [S, w + '-mlp', inner] : [S, nb + w + '-mlp']);
    const L = (meta) => Object.assign({ perLayer: true }, meta);
    const op = (id, res, path, extra) => g.op(pre + id, res, Object.assign({ path, repeat: rep }, extra));
    const kind = j === 1 ? 'W-MSA' : (shift ? 'SW-MSA' : 'W-MSA (sin desplazamiento: una sola ventana)');
    const winSym = st.clamped ? { nWSym: String(st.windows), tokSym: String(st.windowTokens), Msym: String(st.M) } : { nWSym: 'nW', tokSym: 'M²', Msym: 'M' };

    const ln1 = op('ln1', A.layernorm(x), pBlock('ln1'), { out: pre + 'ln1', label: 'LayerNorm 1 (' + kind + ')', type: 'norm', group: 'norm', outMeta: L({ label: 'Entrada normalizada', tex: '\\mathrm{LN}_1(z)' }) });
    let t = ln1;
    if (shift) {
      t = op('shift', A.cyclic_shift(t, { s: shift }), pMsa('shift'), { out: pre + 'shift', label: 'Desplazamiento cíclico (−' + shift + ', −' + shift + ')', type: 'tensorop', group: 'attn', outMeta: L({ label: 'Rejilla desplazada ⌊M/2⌋', tex: '\\mathrm{roll}(z, -\\lfloor M/2\\rfloor)' }) });
    }
    const win = op('partition', A.window_partition(t, { M: st.M, nWSym: winSym.nWSym, tokSym: winSym.tokSym }), pMsa('partition'), {
      out: pre + 'win', label: 'Partición en ventanas ' + st.M + '×' + st.M, type: 'tensorop', group: 'attn', outMeta: L({ label: 'Ventanas (un lote de nW)', tex: 'z_{\\mathrm{win}}' }),
    });
    const qkv = op('qkv', A.linear(win, { dout: 3 * st.C, doutSym: mulSym(3, Cs), bias: true }), pMsa('qkv'), {
      out: pre + 'qkv', label: 'Proyección Q, K, V', type: 'embed', group: 'attn', outMeta: L({ label: 'Q, K y V concatenados', tex: '[Q\\;K\\;V]' }),
    });
    const [q, kk, v] = op('split', A.split_heads(qkv, { h: st.h, parts: 3 }), pMsa('split'), {
      out: [pre + 'q', pre + 'k', pre + 'v'], label: 'Separar en cabezas', type: 'tensorop', group: 'attn',
      outMeta: [L({ label: 'Queries por ventana y cabeza', tex: 'Q' }), L({ label: 'Keys por ventana y cabeza', tex: 'K' }), L({ label: 'Values por ventana y cabeza', tex: 'V' })],
    });
    const sc = op('scores', A.attention_scores(q, kk), pMsa('scores'), { out: pre + 'scores', label: 'Producto QKᵀ (dentro de cada ventana)', type: 'attn', group: 'attn', outMeta: L({ label: 'Scores por ventana', tex: 'QK^\\top' }) });
    const sl = op('scale', A.scale(sc), pMsa('scale'), { out: pre + 'scaled', label: 'Escala 1/√d_h', type: 'attn', group: 'attn', outMeta: L({ label: 'Scores escalados', tex: 'QK^\\top/\\sqrt{d_h}' }) });
    let pre2 = op('bias', A.rel_pos_bias(sl, { M: st.M, h: st.h, Msym: winSym.Msym }), pMsa('bias'), {
      out: pre + 'biased', label: 'Sesgo de posición relativa', type: 'attn', group: 'attn', outMeta: L({ label: 'Scores + sesgo relativo', tex: 'QK^\\top/\\sqrt{d_h} + B' }),
    });
    if (shift) {
      pre2 = op('mask', A.attn_mask(pre2), pMsa('mask'), { out: pre + 'masked', label: 'Máscara de SW-MSA', type: 'attn', group: 'attn', outMeta: L({ label: 'Scores enmascarados', tex: '\\ldots + M_{\\mathrm{shift}}' }) });
    }
    const a = op('softmax', A.softmax(pre2), pMsa('softmax'), { out: pre + 'attn', label: 'Softmax por fila', type: 'attn', group: 'attn', outMeta: L({ label: 'Pesos de atención por ventana', tex: 'A' }) });
    const zh = op('weighted-sum', A.attention_weighted_sum(a, v), pMsa('weighted-sum'), { out: pre + 'z-heads', label: 'Suma ponderada A·V', type: 'attn', group: 'attn', outMeta: L({ label: 'Salida por cabeza', tex: 'AV' }) });
    const z = op('merge', A.merge_heads(zh, { Dsym: Cs }), pMsa('merge'), { out: pre + 'z', label: 'Concatenar cabezas', type: 'tensorop', group: 'attn', outMeta: L({ label: 'Cabezas concatenadas', tex: 'Z' }) });
    const pj = op('proj', A.linear(z, { dout: st.C, doutSym: Cs, bias: true }), pMsa('proj'), { out: pre + 'proj', label: 'Proyección de salida W_O', type: 'embed', group: 'attn', outMeta: L({ label: 'Salida de la atención por ventana', tex: 'ZW_O' }) });
    let back = op('reverse', A.window_reverse(pj, { H: st.side, W: st.side, M: st.M, outSym: [st.sideSym, st.sideSymW] }), pMsa('reverse'), {
      out: pre + 'unwin', label: 'Revertir la partición', type: 'tensorop', group: 'attn', outMeta: L({ label: 'Rejilla reconstruida', tex: '\\mathrm{reverse}(\\cdot)' }),
    });
    if (shift) {
      back = op('unshift', A.cyclic_shift(back, { s: shift, inverse: true }), pMsa('unshift'), { out: pre + 'unshift', label: 'Deshacer el desplazamiento (+' + shift + ', +' + shift + ')', type: 'tensorop', group: 'attn', outMeta: L({ label: 'Rejilla en su posición original', tex: '\\mathrm{roll}(\\cdot, +\\lfloor M/2\\rfloor)' }) });
    }
    const r1 = op('res1', A.residual_add(x, back), pBlock('res1'), { out: pre + 'r1', label: 'Residual 1', type: 'tensorop', group: 'resid', outMeta: L({ label: 'z + atención', tex: "z'" }) });
    const ln2 = op('ln2', A.layernorm(r1), pBlock('ln2'), { out: pre + 'ln2', label: 'LayerNorm 2', type: 'norm', group: 'norm', outMeta: L({ label: 'Entrada normalizada (LN 2)', tex: "\\mathrm{LN}_2(z')" }) });
    const u = op('fc1', A.linear(ln2, { dout: 4 * st.C, doutSym: mulSym(4, Cs), bias: true }), pMlp('fc1'), { out: pre + 'u', label: 'MLP: capa 1 (×4)', type: 'mlp', group: 'mlp', outMeta: L({ label: 'Capa oculta del MLP', tex: 'U' }) });
    const gg = op('gelu', A.gelu(u), pMlp('gelu'), { out: pre + 'g', label: 'GELU', type: 'mlp', group: 'mlp', outMeta: L({ label: 'Activación', tex: '\\mathrm{GELU}(U)' }) });
    const f = op('fc2', A.linear(gg, { dout: st.C, doutSym: Cs, bias: true }), pMlp('fc2'), { out: pre + 'f', label: 'MLP: capa 2', type: 'mlp', group: 'mlp', outMeta: L({ label: 'Salida del MLP', tex: 'F' }) });
    const outId = j === 1 ? pre + 'out' : 's' + k + '-out';
    return op('res2', A.residual_add(r1, f), pBlock('res2'), {
      out: outId, label: 'Residual 2', type: 'tensorop', group: 'resid',
      outMeta: j === 1
        ? L({ label: 'Salida del bloque W-MSA', tex: 'z_{\\ell}' })
        : { label: 'Salida del stage ' + k, tex: 'z_{' + k + '}', perLayer: false, note: 'Salida de cada par de bloques; tras el último par es la salida del stage.' },
    });
  }

  // Patch merging antes del stage `st` (desde el stage `prev`): merge{k−1}.
  function patchMerging(g, x, prev, st) {
    const m = prev.k, id = 'm' + m + '-';
    const node = (name) => (m === 1 ? ['merge1', name] : ['merge' + m, id + name]);
    const cc = g.op(id + 'concat', A.patch_concat(x, { outSym: [st.sideSym, st.sideSymW, mulSym(4, prev.Csym)] }), {
      path: node('concat'), out: id + 'concat', label: 'Concatenar vecinos 2×2', type: 'tensorop', group: 'embed',
      outMeta: { label: 'Vecinos 2×2 concatenados', tex: '[z_{00};z_{10};z_{01};z_{11}]' },
    });
    const ln = g.op(id + 'ln', A.layernorm(cc), {
      path: node('ln'), out: id + 'ln', label: 'LayerNorm(4C)', type: 'norm', group: 'norm',
      outMeta: { label: 'Concatenación normalizada', tex: '\\mathrm{LN}(\\cdot)' },
    });
    return g.op(id + 'reduce', A.linear(ln, { dout: st.C, doutSym: st.Csym, bias: false }), {
      path: node('reduce'), out: id + 'out', label: 'Linear 4C → 2C (sin sesgo)', type: 'embed', group: 'embed',
      outMeta: { label: 'Entrada del stage ' + st.k, tex: 'z' },
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
