/* =============================================================================
   Atlas de Arquitecturas — js/arch/sam.js
   Modelos `sam` (Kirillov et al., Segment Anything, ICCV 2023, arXiv:2304.02643; facebookresearch/segment-anything) y
   `sam2` (Ravi et al., SAM 2: Segment Anything in Images and Videos, ICLR 2025, arXiv:2408.00714; facebookresearch/sam2,
   configs sam2.1). Contrato de ids: SPEC §17. Cross-check: crosscheck/sam.py (HF SamModel y Sam2VideoModel construidos en
   código, sin hub): parámetros y FLOPs EXACTOS en las 7 configs (ver crosscheck/expected/sam*.json).

   Convenciones: formas sin batch; rejillas H×W×C (PyTorch: C×H×W). SAM: H = W = 1024 (lado largo a 1024 + relleno),
   D = ancho del ViT (1280 / 1024 / 768), h cabezas, d_h = D/h = 80 / 64 / 64, D_mlp = 4D, M = 14 (ventana), N = (H/16)² =
   4,096 tokens de imagen, C = 256 (ancho del prompt encoder y del decoder; el neck baja D → C), P = clics. SAM 2: D = ancho
   del stage 1 de Hiera (stages D, 2D, 4D, 8D con h, 2h, 4h, 8h cabezas; d_h = D/h constante), C = 256 (FPN, memory
   attention y decoder), memoria de 64 canales, D_mlp = 2048 (FFN de la memory attention), N = (H/16)² = 4,096.
   Dimensiones sin símbolo propio se escriben como número (25 ventanas, 196 tokens, 8 cabezas del decoder, 2048…) o como
   expresión evaluable ('5+P+1', '7·N+4·16', '6+2').

   PARÁMETROS (= sum(p.numel()) del modelo completo, también lo que este forward no usa):
   - SAM: 641,090,608 (H) · 312,342,832 (L) · 93,735,472 (B) = HF − 256: HF registra la matriz gaussiana 2×128 de la PE de
     Fourier como nn.Parameter; el oficial, como buffer (quantities.paramsHF = HF crudo).
   - SAM 2: 224,446,642 (L) · 80,850,178 (B+) · 46,060,354 (S) · 38,962,498 (T) = HF Sam2VideoModel = oficial.
   - Parámetros del modelo que el forward de referencia NO usa → ops `idle_params` (sin tensores, 0 MACs): SAM:
     mask-embed-idle (convs del prompt de máscara, 4,684; con maskIn = 1 corren y el idle es no-mask-idle, 256); SAM 2
     además mask-downsample-idle (17) y ma-no-mem-idle (no_mem_embed + no_mem_pos_enc, 512: solo el primer frame con prompt).
   MACs (FLOPs = 2·MACs, exactos contra FlopCounterMode): incluyen las einsum de la posición relativa descompuesta, el
   producto por la matriz gaussiana de Fourier (puntos y rejilla densa) y los tokens de RELLENO de las ventanas (64 → 70 con
   M = 14: 25 ventanas = 4,900 tokens; qkv, atención y proyección corren sobre el relleno). RoPE, interpolaciones y PE
   seno/coseno van a "otros".

   Forward de referencia. SAM: 1 clic positivo sin caja (→ + 1 punto de relleno "not a point": 2 tokens dispersos), sin
   máscara de entrada (→ embedding no-mask), multimask (3 máscaras + IoU). SAM 2: UN frame de seguimiento en régimen
   estacionario, sin clics (P = 0 → 1 punto vacío + relleno = 2 tokens), memoria = 1 frame con prompt (condFrames) +
   memFrames = 6 recientes (num_maskmem = 7) y ptrs = 16 punteros de objeto (cada puntero de 256 → 4 tokens de 64):
   7·4096 + 16·4 = 28,736 tokens de memoria; multimask y la mejor por IoU alimenta la memoria y el puntero nuevo.
   El grafo de cada modelo muestra un bloque/capa por grupo con `repeat` (ViT de SAM: 28 con ventanas + 4 globales; en el
   modelo real los globales son los índices 7, 15, 23, 31 — el último bloque es global —; two-way ×2; memory attention ×4).

   Knobs. sam: res (512…1280; cambia la posición absoluta (H/16)²·D y las tablas relativas globales (2H/16−1)·d_h), P (clics),
   masks (1 | 3), maskIn (1 = máscara previa como prompt denso). sam2: res (múltiplo de 32), memFrames (N_r frames recientes;
   cambia num_maskmem = N_r + 1 y la tabla temporal (N_r+1)×64), ptrs (P punteros leídos; > 16 supera el máximo oficial y se avisa).

   ---------------------------------------------------------------- SAM: nodos (path) y ops
   Vista `sam-overview`: path[0] ∈ img-encoder (contiene el neck), prompt-enc (contiene mask-in), mask-decoder. Los nodos
   de la vista que no tienen ops propias son glifos de tensor: image (x-img), img-emb, prompts (pts), masks, iou; `neck` y
   `mask-in` son nodos internos (img-encoder › neck, prompt-enc › mask-in) y totals.byNode los resuelve igual.
     img-encoder › patch-embed: e-patch-embed · img-encoder › pos-embed: e-pos-embed, e-add-pos
     img-encoder › win-blocks › <op>: w-ln1 w-partition w-qkv w-split w-scores w-scale w-rel-pos w-softmax w-weighted-sum
       w-merge w-proj w-unpartition w-res1 w-ln2 w-fc1 w-gelu w-fc2 w-res2   (repeat L − 4; nodos = id sin 'w-')
     img-encoder › global-blocks › <op>: g-ln1 g-flatten g-qkv g-split g-scores g-scale g-rel-pos g-softmax g-weighted-sum
       g-merge g-proj g-unflatten g-res1 g-ln2 g-fc1 g-gelu g-fc2 g-res2   (repeat 4)
     img-encoder › neck › conv1|ln1|conv2|ln2: neck-conv1 neck-ln1 neck-conv2 neck-ln2
     prompt-enc › pad: pe-pad · › fourier: pe-fourier · › type-embed: pe-type · › dense-pe: pe-grid, pe-dense
     prompt-enc › mask-in › no-mask: no-mask (o no-mask-idle) · › mask-embed: mask-embed-idle · con maskIn = 1:
       › conv1|ln1|gelu1|conv2|ln2|gelu2|conv3: me-conv1 me-ln1 me-gelu1 me-conv2 me-ln2 me-gelu2 me-conv3
     mask-decoder › tokens: md-out-tokens, md-concat · › src: md-add-dense, md-src-seq, md-pe-seq
     mask-decoder › two-way (repeat 2) › tok-self › add-pe|q-proj|k-proj|v-proj|split|scores|scale|softmax|weighted-sum|
       merge|out-proj|res|ln: tw-self-add-pe tw-self-<nodo> tw-res1 tw-ln1
       › tok2img › add-pe-q|add-pe-k|q-proj…out-proj|res|ln: tw-t2i-add-pe-q tw-add-pe-k tw-t2i-<nodo> tw-res2 tw-ln2
       › mlp › fc1|relu|fc2|res|ln: tw-fc1 tw-relu tw-fc2 tw-res3 tw-ln3
       › img2tok › add-pe|q-proj…out-proj|res|ln: tw-i2t-add-pe tw-i2t-<nodo> tw-res4 tw-ln4
     mask-decoder › final-attn › add-pe-q|add-pe-k|q-proj…out-proj|res|ln: fa-add-pe-q fa-add-pe-k fa-<nodo> fa-res fa-ln
     mask-decoder › upscale › grid|conv1|ln|gelu1|conv2|gelu2: up-grid up-conv1 up-ln up-gelu1 up-conv2 up-gelu2
     mask-decoder › hypernet › take|fc1|relu1|fc2|relu2|fc3: md-mask-toks hn-fc1 hn-relu1 hn-fc2 hn-relu2 hn-fc3
     mask-decoder › dot: md-dot · › iou-head › take|fc1…fc3: md-iou-tok ih-fc1 ih-relu1 ih-fc2 ih-relu2 ih-fc3
     mask-decoder › select › masks|iou: md-select-masks md-select-iou
   Tensores SAM (SPEC §17.1 + añadidos): x-img patches e-pos x0 · w-ln1 w-win (25×196×D) w-qkv w-q w-k w-v w-scores w-scaled
     w-biased w-attn w-z-heads w-z w-o w-unwin w-r1 w-ln2 w-u w-g w-f w-out · g-ln1 g-seq g-qkv g-q g-k g-v g-scores (h×N×N)
     g-scaled g-biased g-attn g-z-heads g-z g-o g-grid g-r1 g-ln2 g-u g-g g-f enc-out (64×64×D) · neck-c1 neck-n1 neck-c2
     img-emb (64×64×C) · pts (P×2) pt-labels (P) pts-pad pts-pe sparse ((P+1)×C) pe-grid img-pe (64×64×C) dense (64×64×C)
     [mask-input (256×256×1) mask-c1 mask-n1 mask-a1 mask-c2 mask-n2 mask-a2 con maskIn] · out-tokens (5×C) tokens
     ((5+P+1)×C) src src-seq pe-seq · tw-self-qin tw-self-qp/-kp/-vp/-q/-k/-v/-scores/-scaled/-attn/-z-heads/-z/-o tw-r1
     tw-n1 tw-t2i-qin tw-kin tw-t2i-… (scores 8×T×N) tw-r2 tw-n2 tw-u tw-a tw-f tw-r3 tw-n3 tw-i2t-kin tw-i2t-… (scores
     8×N×T) tw-r4 tw-keys · fa-qin fa-kin fa-… fa-r tok-out · up-in up-c1 up-n1 up-a1 up-c2 up-emb (256×256×C/8) ·
     mask-toks hn-h1 hn-a1 hn-h2 hn-a2 hyper-in (4×C/8) masks-all (4×256×256) iou-tok ih-h1 ih-a1 ih-h2 ih-a2 iou-all
     masks (3×256×256) iou (3).
   Diferencias con SPEC §17.1 (añadidos, nada renombrado): sparse es (P+1)×256 y tokens (5+P+1)×256 (sin caja hay un punto
   de relleno, como el oficial y HF); `neck` vive dentro de img-encoder (como ImageEncoderViT oficial: los parámetros del
   codificador incluyen el neck); nodos añadidos prompt-enc › pad|fourier|type-embed|dense-pe, mask-decoder › src|select y los
   internos de cada grupo; knob extra maskIn; ops idle_params.

   ---------------------------------------------------------------- SAM 2: nodos (path) y ops
   Vista `sam2-overview`: path[0] ∈ img-encoder (Hiera), fpn, memory-attn, memory-bank, obj-ptrs, prompt-enc, mask-decoder,
   occlusion, memory-encoder. Glifos sin ops: frame (x-img), masks, iou, memory (tensor `memory`).
     img-encoder › patch-embed: h-patch-embed · › pos-embed: h-pos-embed, h-add-pos
     img-encoder › stage{k} › qpool-block (k = 2…4) | win-blocks | global-blocks › <op>: h{k}-{q|w|g}-ln1 [-skip-proj -skip-pool]
       -partition | -flatten, -qkv -split [-q-pool] -scores -scale -softmax -weighted-sum -merge -proj -unpartition | -unflatten
       -res1 -ln2 -fc1 -gelu -fc2 -res2 (nodo = id sin el prefijo h{k}-{q|w|g}-). Grupos por config (Hiera-L): stage1 w×2;
       stage2 q + w×5; stage3 q + w×32 + g×3; stage4 q + w×3 (config.stages[k].groups).
     fpn › lat4|up|lat3|add|lat2|lat1|pos|seq: fpn-lat4 fpn-up fpn-lat3 fpn-add fpn-lat2 fpn-lat1 fpn-pos fpn-seq
     mask-decoder › hires › s0|s1: hr-s0 hr-s1 (conv_s0/conv_s1 del decoder; corren una vez por frame)
     memory-bank › tpos: mb-tpos · › concat: mb-concat, mb-concat-pos
     obj-ptrs › tpos: op-tpos-sine op-tpos-proj op-tpos-rep · › split: op-split · › take: op-take · › ptr-proj › fc1…fc3:
       pp-fc1 pp-relu1 pp-fc2 pp-relu2 pp-fc3 · › gate: op-gate
     memory-attn › in: ma-in · › self-attn (repeat 4) › ln|q-proj|k-proj|v-proj|split|rope-q|rope-k|scores|scale|softmax|
       weighted-sum|merge|out-proj|res: ma-ln1 ma-self-<nodo> ma-res1 · › cross-mem (repeat 4) › ln|add-pos|q-proj…out-proj|res:
       ma-ln2 ma-add-mpos ma-cross-<nodo> ma-res2 · › mlp (repeat 4) › ln|fc1|relu|fc2|res: ma-ln3 ma-fc1 ma-relu ma-fc2 ma-res3 ·
       › out-norm: ma-norm, ma-grid · › no-mem: ma-no-mem-idle
     prompt-enc: como SAM (pe-pad pe-fourier pe-type pe-grid pe-dense, mask-in › no-mask / mask-embed-idle) + prompt-enc ›
       mask-as-output: mask-downsample-idle
     mask-decoder: como SAM (tokens 6 de salida: objeto + IoU + 4 máscaras; ih-sigmoid en la cabeza de IoU; upscale con
       up-skip1 / up-skip2 = rasgos de alta resolución) + mask-decoder › select › pick: md-pick
     occlusion › take|fc1|relu1|fc2|relu2|fc3: oc-take oc-fc1 oc-relu1 oc-fc2 oc-relu2 oc-fc3
     memory-encoder › mask-prep: me-up me-sigmoid me-scale · › downsampler: me-ds{1…4}-conv/-ln/-gelu me-ds-final ·
       › fuse: me-pix-proj me-add · › fuser (repeat 2): me-cx-dw me-cx-ln me-cx-pw1 me-cx-gelu me-cx-pw2 me-cx-gamma me-cx-res ·
       › out: me-proj me-occl me-pos
   Tensores SAM 2: x-img patches h-pos h-x0 · por stage/grupo h{k}-{q|w|g}-ln1 [-skip-p -skip] -win | -seq -qkv -q -k -v
     [-q-pooled] -scores -scaled -attn -z-heads -z -o -unwin | -grid -r1 -ln2 -u -g -f y la salida -out (h{k}-out = salida del
     stage) · fpn-l4 fpn-up fpn-l3 fpn-s16 (64×64×C) fpn-s8 fpn-s4 fpn-pos feat-seq feat-s0 feat-s1 · bank-feats ((N+M)·N_tok×64)
     bank-pos bank-pos-t bank-ptrs (16×C) ptr-tpos-sine ptr-tpos ptr-pos ptr-tokens (64×64) memory (28,736×64) memory-pos ·
     ma-x0 ma-n1 ma-self-… (rope: -q-rot -k-rot; scores 1×N×N) ma-r1 ma-n2 ma-kin ma-cross-… (scores 1×N×28,736) ma-r2 ma-n3
     ma-u ma-a ma-f ma-out pix-mem-seq pix-mem · prompt y decoder como SAM (tokens 8×C; up-s1 up-s2; ih-logit) · obj-tok oc-h1
     oc-a1 oc-h2 oc-a2 obj-score (1) best-mask (256×256×1) best-tok pp-h1 pp-a1 pp-h2 pp-a2 ptr-raw obj-ptr (C) · mask-hr
     mask-prob mask-mem-in (1024×1024×1) me-ds{i}-c/-n/-a mem-mask mem-pix mem-fuse-in me-cx-d me-cx-n me-cx-u me-cx-g me-cx-f
     me-cx-s mem-fused mem-new mem-out (64×64×64) mem-out-pos.
   Añadidos a SPEC §17.2 (nada renombrado): nodos de primer nivel memory-bank, obj-ptrs, occlusion y memory-encoder con hijos
   (memory-bank/obj-ptrs aparecen en la vista; su costo está en las ops de arriba); mask-decoder › hires; los internos de
   cada grupo. El borde recurrente a t+1 es de la vista: mem-out y obj-ptr son las entradas bank-feats / bank-ptrs del
   frame siguiente.

   ---------------------------------------------------------------- metrics() (B = 1, bf16 por defecto)
   Unidades en metrics.units (macs | params | pct | ratio | bytes | count); …Mem = bytes, …Share = fracción.
   sam: encoderMacs, decoderMacsPerPrompt (prompt encoder + decoder), promptEncMacs, maskDecoderMacs, decoderMacsWithBox,
     encoderParams, decoderParams, encoderMacsShare, decoderMacsShare, encoderParamsShare, encoderToDecoder, breakEvenPrompts
     (prompts por pasada del codificador a los que el decoder iguala su costo; entero, = quantities.breakEvenPrompts), imgEmbMem · winBlockMacs, globalBlockMacs,
     globalToWinBlockMacs, winScoreMacs, globalScoreMacs (QKᵀ + A·V + rel-pos por bloque), globalToWinScoreMacs, winAttnMem,
     globalAttnMem, globalToWinAttnMem, winBlocks, globalBlocks, globalBlocksMacsShare, winBlocksMacs, globalBlocksMacs, neckMacs, patchEmbedMacs (reparto
     del encoder: patch embed + posición), relPosWinParams, relPosGlobalParams,
     padTokens, padOverhead, allGlobalEncoderMacs, allGlobalToActual · decTokens, decT2iAttnMem, decSelfAttnMem, imageTokens ·
     vitHEncoderMacs, encoderMacsVsVitH, paramsVsVitH (L y B) · listas promptScaling [{P, tokens, decoderMacs, macs}],
     resScaling [{res, tokens, encoderMacs, decoderMacs, globalAttnMem}].
   sam2: frameMacs, perObjectMacs (todo menos el codificador de imagen: memory attention + punteros + decoder + oclusión +
     memory encoder, por objeto seguido), perObjectMacsShare, imgEncoderMacs (Hiera + FPN + conv_s0/s1 = hieraMacs + fpnMacs + hiresMacs), imgEncoderMacsShare,
     memAttnMacs, memAttnMacsShare, memEncoderMacs, memEncoderMacsShare, decoderMacs, decoderMacsShare, objPtrMacs,
     firstFrameMacs (frame con prompt inicial: sin memory attention), memCrossScoreMacs, memSelfScoreMacs, memCrossAttnMem,
     memSelfAttnMem, memTokens, spatialMemTokens, ptrTokens, memFramesUsed, ptrsUsed · banco: memPerFrameMem, memBankFeatMem,
     memBankPosMem, memBankPtrMem, memoryBankMem, memToImgEmb, imgEmbMem · hieraGlobalBlocks, hieraBlocks · samHMacs,
     frameVsSamH, imgEncoderVsSamH, paramsVsSamH · listas memScaling [{memFrames, memTokens, macs, memAttnMacs, memCrossAttnMem,
     memoryBankMem}], ptrScaling [{ptrs, memTokens, memAttnMacs}], objScaling [{objects, macs}], stages [{k, side, tokens, C,
     h, depth, window, globalBlocks, winScoreMacs, globalScoreMacs, winAttnMem, globalAttnMem}] (por bloque normal del stage:
     ventanas CON relleno, ⌈side/ws⌉² ventanas de ws² tokens, como las ops; el bloque de q-pooling no entra). crossoverN = null.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const A = ATLAS.Arch;
  if (!A || !A.defineModel) throw new Error('sam.js necesita js/arch/primitives.js antes.');

  // ------------------------------------------------------------------ utilidades comunes
  const shp = (sym, num, mod, layout) => A.shape(sym, num, mod, layout);
  const fint = (n) => A.fmt.int(n);
  // k·sym para símbolos de canales: 3·'D' → '3D'; 3·'2D' → '6D'.
  function mulSym(k, s) {
    const m = String(s).match(/^(\d+)(.*)$/);
    return m ? String(k * parseInt(m[1], 10)) + m[2] : (k === 1 ? s : k + s);
  }
  // Parámetros sin uso en este forward (op sin tensores): cuentan en el total, 0 MACs.
  function idleOp(g, id, path, terms, what, where) {
    return g.op(id, A.idle_params({ paramTerms: terms, what }), { path, out: [], in: [], where, label: 'Sin uso en este forward: ' + what, type: 'embed', group: 'embed' });
  }

  // Atención multi-cabeza con Q, K, V separados y ancho interno propio (SamAttention: downsample 1 o 2;
  // RoPEAttention de SAM 2 con rope). Ops q-proj, k-proj, v-proj, split, [rope-q, rope-k], scores, scale, softmax,
  // weighted-sum, merge, out-proj. s = {g, pre, tpre, P, rep, where, tl, qIn, kIn, vIn, inner, innerSym, h, hSym, dhSym,
  // outD, outSym, qNote, kNote, vNote, rope: {kExclude, kRepeat}}
  function attnOps(s) {
    const { g, pre, tpre, P, rep, where, tl } = s;
    const L = (m) => Object.assign({ perLayer: rep > 1 }, m, { label: tl + m.label });
    const op = (id, res, node, extra) => g.op(pre + id, res, Object.assign({ path: P.concat([node]), repeat: rep, where }, extra));
    const I = s.inner, Is = s.innerSym;
    const qp = op('q-proj', A.linear(s.qIn, { dout: I, doutSym: Is }), 'q-proj', { out: tpre + 'qp', label: 'Proyección W_Q' + (s.qNote || ''), type: 'embed', group: 'attn', outMeta: L({ label: 'Q proyectada', tex: 'QW_Q' }) });
    const kp = op('k-proj', A.linear(s.kIn, { dout: I, doutSym: Is }), 'k-proj', { out: tpre + 'kp', label: 'Proyección W_K' + (s.kNote || ''), type: 'embed', group: 'attn', outMeta: L({ label: 'K proyectada', tex: 'KW_K' }) });
    const vp = op('v-proj', A.linear(s.vIn, { dout: I, doutSym: Is }), 'v-proj', { out: tpre + 'vp', label: 'Proyección W_V' + (s.vNote || ''), type: 'embed', group: 'attn', outMeta: L({ label: 'V proyectada', tex: 'VW_V' }) });
    const [q, k, v] = op('split', A.split_qkv_heads(qp, kp, vp, { h: s.h, hSym: s.hSym, dhSym: s.dhSym }), 'split', {
      out: [tpre + 'q', tpre + 'k', tpre + 'v'], label: 'Separar en ' + s.h + (s.h === 1 ? ' cabeza' : ' cabezas'), type: 'tensorop', group: 'attn',
      outMeta: [L({ label: 'queries por cabeza', tex: 'Q' }), L({ label: 'keys por cabeza', tex: 'K' }), L({ label: 'values por cabeza', tex: 'V' })],
    });
    let qq = q, kk = k;
    if (s.rope) {
      qq = op('rope-q', A.rope_2d(q, {}), 'rope-q', { out: tpre + 'q-rot', label: 'RoPE 2-D sobre Q', type: 'attn', group: 'attn', outMeta: L({ label: 'queries rotadas (RoPE 2-D)', tex: '\\mathrm{RoPE}(Q)' }) });
      kk = op('rope-k', A.rope_2d(k, { exclude: s.rope.kExclude || 0, repeat: s.rope.kRepeat || 1 }), 'rope-k', {
        out: tpre + 'k-rot', label: 'RoPE 2-D sobre K' + (s.rope.kExclude ? ' (sin rotar los ' + s.rope.kExclude + ' tokens de punteros)' : ''), type: 'attn', group: 'attn',
        outMeta: L({ label: 'keys rotadas (RoPE 2-D)', tex: '\\mathrm{RoPE}(K)' }),
      });
    }
    const sc = op('scores', A.attention_scores(qq, kk), 'scores', { out: tpre + 'scores', label: 'Producto QKᵀ', type: 'attn', group: 'attn', outMeta: L({ label: 'scores sin escalar', tex: 'QK^\\top' }) });
    const ss = op('scale', A.scale(sc), 'scale', { out: tpre + 'scaled', label: 'Escala 1/√d_h', type: 'attn', group: 'attn', outMeta: L({ label: 'scores escalados', tex: 'QK^\\top/\\sqrt{d_h}' }) });
    const a = op('softmax', A.softmax(ss), 'softmax', { out: tpre + 'attn', label: 'Softmax por fila', type: 'attn', group: 'attn', outMeta: L({ label: 'pesos de atención', tex: 'A' }) });
    const zh = op('weighted-sum', A.attention_weighted_sum(a, v), 'weighted-sum', { out: tpre + 'z-heads', label: 'Suma ponderada A·V', type: 'attn', group: 'attn', outMeta: L({ label: 'salida por cabeza', tex: 'AV' }) });
    const z = op('merge', A.merge_heads(zh, { Dsym: Is }), 'merge', { out: tpre + 'z', label: 'Concatenar cabezas', type: 'tensorop', group: 'attn', outMeta: L({ label: 'cabezas concatenadas', tex: 'Z' }) });
    return op('out-proj', A.linear(z, { dout: s.outD, doutSym: s.outSym }), 'out-proj', { out: tpre + 'o', label: 'Proyección de salida W_O', type: 'embed', group: 'attn', outMeta: L({ label: 'salida de la atención', tex: 'O = ZW_O' }) });
  }

  // MLP de 3 capas con ReLU (SamFeedForward: hipernetwork, cabeza de IoU, cabeza de oclusión, puntero de objeto).
  // s = {g, pre, tpre, P, where, tl, dims:[hidden, hidden, out], syms, grouped, sigmoid, outId, outLabel, outTex}
  function ffn3(s, x) {
    const { g, pre, tpre, P, where, tl } = s;
    const L = (m) => Object.assign({}, m, { label: tl + m.label });
    const op = (id, res, extra) => g.op(pre + id, res, Object.assign({ path: P.concat([id]), where }, extra));
    const lin = (t, i) => (s.grouped ? A.grouped_linear(t, { dout: s.dims[i], doutSym: s.syms[i] }) : A.linear(t, { dout: s.dims[i], doutSym: s.syms[i] }));
    const h1 = op('fc1', lin(x, 0), { out: tpre + 'h1', label: 'Capa 1' + (s.grouped ? ' (un Linear por token)' : ''), type: 'mlp', group: 'head', outMeta: L({ label: 'capa 1', tex: 'u_1' }) });
    const a1 = op('relu1', A.relu(h1), { out: tpre + 'a1', label: 'ReLU', type: 'mlp', group: 'head', outMeta: L({ label: 'ReLU 1', tex: '\\mathrm{ReLU}(u_1)' }) });
    const h2 = op('fc2', lin(a1, 1), { out: tpre + 'h2', label: 'Capa 2', type: 'mlp', group: 'head', outMeta: L({ label: 'capa 2', tex: 'u_2' }) });
    const a2 = op('relu2', A.relu(h2), { out: tpre + 'a2', label: 'ReLU', type: 'mlp', group: 'head', outMeta: L({ label: 'ReLU 2', tex: '\\mathrm{ReLU}(u_2)' }) });
    const last = op('fc3', lin(a2, 2), { out: s.sigmoid ? tpre + 'logit' : s.outId, label: 'Capa 3 (salida)', type: 'head', group: 'head',
      outMeta: s.sigmoid ? L({ label: 'salida antes de la sigmoide', tex: 'u_3' }) : { label: s.outLabel, tex: s.outTex } });
    if (!s.sigmoid) return last;
    return op('sigmoid', A.sigmoid(last), { out: s.outId, label: 'Sigmoide', type: 'head', group: 'head', outMeta: { label: s.outLabel, tex: s.outTex } });
  }

  // ------------------------------------------------------------------ prompt encoder (SAM y SAM 2)
  // c.P puntos (sin caja: + 1 punto de relleno). SAM 2 en un frame de seguimiento sin clics: P = 0 → 1 punto vacío
  // (etiqueta −1) + el relleno = 2 tokens, como HF y el oficial.
  function promptEncoder(g, c, model) {
    const WP = ['Prompt encoder'], TP = 'Prompt encoder · ';
    const nPts = Math.max(c.P, 1);
    const ptsSym = c.P > 0 ? 'P' : '1';
    const pts = g.input('pts', shp([ptsSym, '2'], [nPts, 2], 'qry', 'seq'), {
      label: c.P > 0 ? 'Prompts · ' + (c.P === 1 ? '1 clic' : c.P + ' clics') + ' (x, y) en píxeles de la imagen de ' + c.H : 'Prompts · sin clics en este frame: un punto vacío (etiqueta −1)', tex: 'p',
    });
    const lab = g.input('pt-labels', shp([ptsSym], [nPts], 'qry', 'vec'), { label: 'Prompts · etiqueta de cada punto (1 = objeto, 0 = fondo, −1 = vacío)', tex: '\\ell' });
    const pad = g.op('pe-pad', A.append_pad_point(pts, { sym: ptsSym + '+1' }), {
      path: ['prompt-enc', 'pad'], out: 'pts-pad', where: WP, label: 'Añadir el punto de relleno ("not a point"; no hay caja)', type: 'tensorop', group: 'embed',
      outMeta: { label: TP + 'puntos + 1 de relleno', tex: '[p;\\,p_{\\varnothing}]' },
    });
    const fpe = g.op('pe-fourier', A.fourier_pe(pad, { F: c.F, Dsym: 'C' }), {
      path: ['prompt-enc', 'fourier'], out: 'pts-pe', where: WP, label: 'PE de Fourier aleatoria de cada punto (G 2×' + c.F + ' fija)', type: 'embed', group: 'embed',
      outMeta: { label: TP + 'codificación de Fourier de cada punto', tex: '[\\sin,\\cos](2\\pi\\,(2p-1)G)' },
    });
    const sparse = g.op('pe-type', A.type_embed(fpe, { rows: c.pointTypes + 1, D: c.C, Dsym: 'C', kinds: ['positivo', 'negativo', 'esquina 1 de caja', 'esquina 2 de caja', 'not a point'] }), {
      path: ['prompt-enc', 'type-embed'], in: ['pts-pe', 'pt-labels'], out: 'sparse', where: WP, label: 'Sumar el embedding del tipo de punto (positivo, negativo, caja, not-a-point)', type: 'embed', group: 'embed',
      outMeta: { label: 'Prompts dispersos (sparse): un token por punto', tex: 'S' },
    });
    void lab;
    const sym16 = ['H/16', 'W/16'];
    const grid = g.op('pe-grid', A.coord_grid({ H: c.G, W: c.G, sym: sym16 }), {
      path: ['prompt-enc', 'dense-pe'], out: 'pe-grid', where: WP, label: 'Rejilla de centros (' + c.G + '×' + c.G + ') del embedding de imagen', type: 'tensorop', group: 'embed',
      outMeta: { label: TP + 'coordenadas normalizadas de cada celda del embedding', tex: 'c_{ij}' },
    });
    const ipe = g.op('pe-dense', A.fourier_pe(grid, { F: c.F, Dsym: 'C' }), {
      path: ['prompt-enc', 'dense-pe'], out: 'img-pe', where: WP, label: 'PE de Fourier de toda la rejilla (la posición de las keys de imagen)', type: 'embed', group: 'embed',
      outMeta: { label: TP + 'codificación posicional densa de la imagen', tex: 'P_{\\mathrm{img}}' },
    });
    // Prompt denso: máscara de entrada → convs, o el embedding "no-mask".
    const MI = ['prompt-enc', 'mask-in'], WM = ['Prompt encoder', 'prompt denso (máscara)'];
    const meTerms = [[2, 2, 1, c.maskInCh / 4], [c.maskInCh / 4], [2, c.maskInCh / 4], [2, 2, c.maskInCh / 4, c.maskInCh], [c.maskInCh], [2, c.maskInCh], [c.maskInCh, c.C], [c.C]];
    let dense;
    if (c.maskIn) {
      const mi = g.input('mask-input', shp(['H/4', 'W/4', '1'], [4 * c.G, 4 * c.G, 1], 'img', 'grid'), { label: 'Máscara de entrada (logits de la predicción anterior, ' + 4 * c.G + '×' + 4 * c.G + ')', tex: 'm_{\\mathrm{in}}' });
      const q = c.maskInCh / 4;
      const op = (id, res, extra) => g.op(id, res, Object.assign({ path: MI.concat([id.replace(/^me-/, '')]), where: WM }, extra));
      const c1 = op('me-conv1', A.conv2d(mi, { k: 2, s: 2, cout: q, coutSym: String(q), outSym: ['H/8', 'W/8'] }), { out: 'mask-c1', label: 'Conv 2×2 stride 2 (1 → ' + q + ')', type: 'conv', group: 'embed', outMeta: { label: TP + 'máscara reducida ×2', tex: 'm_1' } });
      const n1 = op('me-ln1', A.layernorm(c1), { out: 'mask-n1', label: 'LayerNorm2d', type: 'norm', group: 'norm', outMeta: { label: TP + 'máscara reducida ×2, normalizada', tex: '\\mathrm{LN}(m_1)' } });
      const a1 = op('me-gelu1', A.gelu(n1), { out: 'mask-a1', label: 'GELU', type: 'mlp', group: 'embed', outMeta: { label: TP + 'máscara reducida ×2, activada', tex: '\\mathrm{GELU}(\\cdot)' } });
      const c2 = op('me-conv2', A.conv2d(a1, { k: 2, s: 2, cout: c.maskInCh, coutSym: String(c.maskInCh), outSym: sym16 }), { out: 'mask-c2', label: 'Conv 2×2 stride 2 (' + q + ' → ' + c.maskInCh + ')', type: 'conv', group: 'embed', outMeta: { label: TP + 'máscara reducida ×4', tex: 'm_2' } });
      const n2 = op('me-ln2', A.layernorm(c2), { out: 'mask-n2', label: 'LayerNorm2d', type: 'norm', group: 'norm', outMeta: { label: TP + 'máscara reducida ×4, normalizada', tex: '\\mathrm{LN}(m_2)' } });
      const a2 = op('me-gelu2', A.gelu(n2), { out: 'mask-a2', label: 'GELU', type: 'mlp', group: 'embed', outMeta: { label: TP + 'máscara reducida ×4, activada', tex: '\\mathrm{GELU}(\\cdot)' } });
      dense = op('me-conv3', A.conv2d(a2, { k: 1, cout: c.C, coutSym: 'C', outSym: sym16 }), { out: 'dense', label: 'Conv 1×1 (' + c.maskInCh + ' → C)', type: 'conv', group: 'embed', outMeta: { label: 'Prompt denso: máscara de entrada embebida', tex: 'D_{\\mathrm{mask}}' } });
      idleOp(g, 'no-mask-idle', MI.concat(['no-mask']), [[c.C]], 'embedding "no-mask" (solo sin máscara de entrada)', WM);
    } else {
      dense = g.op('no-mask', A.broadcast_embed({ H: c.G, W: c.G, D: c.C, sym: ['H/16', 'W/16', 'C'] }), {
        path: MI.concat(['no-mask']), out: 'dense', where: WM, label: 'Embedding "no-mask" aprendido, repetido en cada posición', type: 'embed', group: 'embed',
        outMeta: { label: 'Prompt denso: embedding "no-mask" en cada posición', tex: 'D_{\\varnothing}' },
      });
      idleOp(g, 'mask-embed-idle', MI.concat(['mask-embed']), meTerms, 'convs del prompt de máscara (solo con máscara de entrada)', WM);
    }
    if (model === 'sam2') idleOp(g, 'mask-downsample-idle', ['prompt-enc', 'mask-as-output'], [[4, 4, 1, 1], [1]], 'conv 4×4 que usa una máscara de entrada como salida (sin pasar por SAM)', WP);
    return { sparse, dense, ipe };
  }

  // ------------------------------------------------------------------ decoder de máscaras (SAM y SAM 2)
  // src = embedding de imagen (64×64×C), con la memoria en SAM 2. Devuelve {tokOut, masks, iou, maskToks}.
  function maskDecoder(g, c, src0, pe, sparse, dense, model, hires) {
    const s2 = model === 'sam2';
    const WD = ['Decoder de máscaras'], TD = 'Decoder de máscaras · ';
    const C = c.C, I = C / c.down, nOut = s2 ? 6 : 5;
    const sym16 = ['H/16', 'W/16'];
    const outTok = g.op('md-out-tokens', A.learned_tokens({ rows: nOut, rowsSym: String(nOut), D: C, Dsym: 'C', mod: 'qry', kinds: (s2 ? ['objeto'] : []).concat(['IoU', 'máscara ×4']) }), {
      path: ['mask-decoder', 'tokens'], out: 'out-tokens', where: WD, label: 'Tokens de salida aprendidos (' + (s2 ? '1 de objeto + ' : '') + '1 de IoU + 4 de máscara)', type: 'embed', group: 'embed',
      outMeta: { label: TD + 'tokens de salida aprendidos', tex: 'T_{\\mathrm{out}}' },
    });
    const tokSym = s2 ? '6+2' : '5+P+1';
    const tokens = g.op('md-concat', A.concat_tokens(outTok, sparse, { sym: tokSym, mod: 'qry' }), {
      path: ['mask-decoder', 'tokens'], out: 'tokens', where: WD, label: 'Concatenar tokens de salida y prompts dispersos', type: 'tensorop', group: 'embed',
      outMeta: { label: 'Tokens del decoder (' + nOut + ' de salida + ' + sparse.num[0] + ' de prompt)', tex: 'T = [T_{\\mathrm{out}};\\,S]' },
    });
    const src = g.op('md-add-dense', A.add(src0, dense), {
      path: ['mask-decoder', 'src'], out: 'src', where: WD, label: 'Sumar el prompt denso al embedding de imagen', type: 'tensorop', group: 'embed',
      outMeta: { label: TD + 'embedding de imagen + prompt denso', tex: 'E + D' },
    });
    const srcSeq = g.op('md-src-seq', A.flatten(src, { sym: ['N', 'C'] }), { path: ['mask-decoder', 'src'], out: 'src-seq', where: WD, label: 'Aplanar la rejilla (N tokens de imagen)', type: 'tensorop', group: 'embed', outMeta: { label: TD + 'tokens de imagen (keys)', tex: 'E' } });
    const peSeq = g.op('md-pe-seq', A.flatten(pe, { sym: ['N', 'C'] }), { path: ['mask-decoder', 'src'], out: 'pe-seq', where: WD, label: 'Aplanar la PE densa', type: 'tensorop', group: 'embed', outMeta: { label: TD + 'posición de cada token de imagen', tex: 'P_{\\mathrm{img}}' } });

    // ---- capa two-way (repeat Ldec)
    const B = ['mask-decoder', 'two-way'], rep = c.Ldec;
    const L = (m, tl) => Object.assign({ perLayer: true }, m, { label: tl + m.label });
    const op = (id, res, path, where, extra) => g.op(id, res, Object.assign({ path: B.concat(path), repeat: rep, where }, extra));
    const TS = TD + 'two-way · tokens (self-attention) · ', WS = ['Decoder de máscaras', 'two-way', 'self-attention de los tokens'];
    const qpe = op('tw-self-add-pe', A.add(tokens, tokens), ['tok-self', 'add-pe'], WS, { in: ['tokens'], out: 'tw-self-qin', label: 'Sumar la PE de los tokens (los tokens originales) a Q y K; la capa 1 no la suma', type: 'tensorop', group: 'embed', outMeta: L({ label: 'entrada de Q y K (tokens + su PE)', tex: 't + T' }, TS) });
    const so = attnOps({ g, pre: 'tw-self-', tpre: 'tw-self-', P: B.concat(['tok-self']), rep, where: WS, tl: TS, qIn: qpe, kIn: qpe, vIn: tokens, inner: C, innerSym: 'C', h: c.hDec, hSym: String(c.hDec), dhSym: String(C / c.hDec), outD: C, outSym: 'C' });
    const r1 = op('tw-res1', A.residual_add(tokens, so), ['tok-self', 'res'], WS, { out: 'tw-r1', label: 'Residual (la capa 1 no lo tiene: sus tokens pasan a ser la salida de la atención)', type: 'tensorop', group: 'resid', outMeta: L({ label: 'tokens + self-attention', tex: "t'" }, TS) });
    const n1 = op('tw-ln1', A.layernorm(r1), ['tok-self', 'ln'], WS, { out: 'tw-n1', label: 'LayerNorm 1 (post-LN)', type: 'norm', group: 'norm', outMeta: L({ label: 'tras LayerNorm 1', tex: "\\mathrm{LN}(t')" }, TS) });
    const TT = TD + 'two-way · tokens → imagen · ', WT = ['Decoder de máscaras', 'two-way', 'cross-attention tokens → imagen'];
    const tq = op('tw-t2i-add-pe-q', A.add(n1, tokens), ['tok2img', 'add-pe-q'], WT, { out: 'tw-t2i-qin', label: 'Sumar la PE de los tokens a Q', type: 'tensorop', group: 'embed', outMeta: L({ label: 'Q de los tokens (+ su PE)', tex: 't + T' }, TT) });
    const kin = op('tw-add-pe-k', A.add(srcSeq, peSeq), ['tok2img', 'add-pe-k'], WT, { out: 'tw-kin', label: 'Sumar la PE densa a las keys de imagen (la misma suma sirve a imagen → tokens)', type: 'tensorop', group: 'embed', outMeta: L({ label: 'keys de imagen (+ PE densa)', tex: 'E + P_{\\mathrm{img}}' }, TD + 'two-way · ') });
    const to = attnOps({ g, pre: 'tw-t2i-', tpre: 'tw-t2i-', P: B.concat(['tok2img']), rep, where: WT, tl: TT, qIn: tq, kIn: kin, vIn: srcSeq, inner: I, innerSym: 'C/2', h: c.hDec, hSym: String(c.hDec), dhSym: String(I / c.hDec), outD: C, outSym: 'C',
      qNote: ' (C → C/2)', kNote: ' (C → C/2, sobre los N tokens de imagen)', vNote: ' (C → C/2)' });
    const r2 = op('tw-res2', A.residual_add(n1, to), ['tok2img', 'res'], WT, { out: 'tw-r2', label: 'Residual', type: 'tensorop', group: 'resid', outMeta: L({ label: 'tokens + cross-attention a la imagen', tex: "t''" }, TT) });
    const n2 = op('tw-ln2', A.layernorm(r2), ['tok2img', 'ln'], WT, { out: 'tw-n2', label: 'LayerNorm 2', type: 'norm', group: 'norm', outMeta: L({ label: 'tras LayerNorm 2', tex: "\\mathrm{LN}(t'')" }, TT) });
    const TM = TD + 'two-way · MLP de los tokens · ', WMl = ['Decoder de máscaras', 'two-way', 'MLP de los tokens'];
    const u = op('tw-fc1', A.linear(n2, { dout: c.DmlpDec, doutSym: String(c.DmlpDec) }), ['mlp', 'fc1'], WMl, { out: 'tw-u', label: 'MLP: capa 1 (C → ' + c.DmlpDec + ')', type: 'mlp', group: 'mlp', outMeta: L({ label: 'capa oculta del MLP', tex: 'U' }, TM) });
    const ua = op('tw-relu', A.relu(u), ['mlp', 'relu'], WMl, { out: 'tw-a', label: 'ReLU', type: 'mlp', group: 'mlp', outMeta: L({ label: 'activación ReLU', tex: '\\mathrm{ReLU}(U)' }, TM) });
    const f = op('tw-fc2', A.linear(ua, { dout: C, doutSym: 'C' }), ['mlp', 'fc2'], WMl, { out: 'tw-f', label: 'MLP: capa 2 (' + c.DmlpDec + ' → C)', type: 'mlp', group: 'mlp', outMeta: L({ label: 'salida del MLP', tex: 'F' }, TM) });
    const r3 = op('tw-res3', A.residual_add(n2, f), ['mlp', 'res'], WMl, { out: 'tw-r3', label: 'Residual', type: 'tensorop', group: 'resid', outMeta: L({ label: 'tokens + MLP', tex: "t'''" }, TM) });
    const n3 = op('tw-ln3', A.layernorm(r3), ['mlp', 'ln'], WMl, { out: 'tw-n3', label: 'LayerNorm 3', type: 'norm', group: 'norm', outMeta: { label: TD + 'two-way · tokens a la salida de la capa', tex: 't_\\ell', perLayer: false, note: 'Salida de cada capa; tras la última va a la atención final.' } });
    const TI = TD + 'two-way · imagen → tokens · ', WI = ['Decoder de máscaras', 'two-way', 'cross-attention imagen → tokens'];
    const ik = op('tw-i2t-add-pe', A.add(n3, tokens), ['img2tok', 'add-pe'], WI, { out: 'tw-i2t-kin', label: 'Sumar la PE de los tokens (ahora son las keys)', type: 'tensorop', group: 'embed', outMeta: L({ label: 'keys de los tokens (+ su PE)', tex: 't_\\ell + T' }, TI) });
    const io = attnOps({ g, pre: 'tw-i2t-', tpre: 'tw-i2t-', P: B.concat(['img2tok']), rep, where: WI, tl: TI, qIn: kin, kIn: ik, vIn: n3, inner: I, innerSym: 'C/2', h: c.hDec, hSym: String(c.hDec), dhSym: String(I / c.hDec), outD: C, outSym: 'C',
      qNote: ' (las N posiciones de imagen preguntan)', kNote: ' (desde los tokens)', vNote: ' (desde los tokens)' });
    const r4 = op('tw-res4', A.residual_add(srcSeq, io), ['img2tok', 'res'], WI, { out: 'tw-r4', label: 'Residual sobre el embedding de imagen', type: 'tensorop', group: 'resid', outMeta: L({ label: 'imagen + lo que leyó de los tokens', tex: "E'" }, TI) });
    const keys = op('tw-ln4', A.layernorm(r4), ['img2tok', 'ln'], WI, { out: 'tw-keys', label: 'LayerNorm 4', type: 'norm', group: 'norm', outMeta: { label: TD + 'two-way · embedding de imagen actualizado', tex: 'E_\\ell', perLayer: false, note: 'Las dos ramas se actualizan: tokens (t_ℓ) e imagen (E_ℓ).' } });

    // ---- atención final tokens → imagen
    const F = ['mask-decoder', 'final-attn'], WF = ['Decoder de máscaras', 'atención final tokens → imagen'], TF = TD + 'atención final · ';
    const fop = (id, res, node, extra) => g.op(id, res, Object.assign({ path: F.concat([node]), where: WF }, extra));
    const fq = fop('fa-add-pe-q', A.add(n3, tokens), 'add-pe-q', { out: 'fa-qin', label: 'Sumar la PE de los tokens a Q', type: 'tensorop', group: 'embed', outMeta: { label: TF + 'Q de los tokens (+ su PE)', tex: 't + T' } });
    const fk = fop('fa-add-pe-k', A.add(keys, peSeq), 'add-pe-k', { out: 'fa-kin', label: 'Sumar la PE densa a las keys de imagen', type: 'tensorop', group: 'embed', outMeta: { label: TF + 'keys de imagen (+ PE densa)', tex: 'E + P_{\\mathrm{img}}' } });
    const fo = attnOps({ g, pre: 'fa-', tpre: 'fa-', P: F, rep: 1, where: WF, tl: TF, qIn: fq, kIn: fk, vIn: keys, inner: I, innerSym: 'C/2', h: c.hDec, hSym: String(c.hDec), dhSym: String(I / c.hDec), outD: C, outSym: 'C' });
    const fr = fop('fa-res', A.residual_add(n3, fo), 'res', { out: 'fa-r', label: 'Residual', type: 'tensorop', group: 'resid', outMeta: { label: TF + 'tokens + atención final', tex: 't + O' } });
    const tokOut = fop('fa-ln', A.layernorm(fr), 'ln', { out: 'tok-out', label: 'LayerNorm final', type: 'norm', group: 'norm', outMeta: { label: TD + 'tokens de salida del transformer', tex: 'T^{*}' } });

    // ---- upscaling (×4) del embedding de imagen
    const U = ['mask-decoder', 'upscale'], WU = ['Decoder de máscaras', 'upscaling ×4'], TU = TD + 'upscaling · ';
    const uop = (id, res, node, extra) => g.op(id, res, Object.assign({ path: U.concat([node]), where: WU }, extra));
    const ug = uop('up-grid', A.to_grid(keys, { H: c.G, W: c.G, sym: sym16 }), 'grid', { out: 'up-in', label: 'Secuencia → rejilla ' + c.G + '×' + c.G, type: 'tensorop', group: 'embed', outMeta: { label: TU + 'embedding de imagen como rejilla', tex: 'E^{*}' } });
    let x = uop('up-conv1', A.conv_transpose2d(ug, { k: 2, cout: C / 4, coutSym: 'C/4', outSym: ['H/8', 'W/8'] }), 'conv1', { out: 'up-c1', label: 'ConvTranspose 2×2 stride 2 (C → C/4)', type: 'conv', group: 'embed', outMeta: { label: TU + 'ampliado ×2', tex: 'u_1' } });
    if (s2) x = uop('up-skip1', A.add(x, hires.s1), 'skip1', { out: 'up-s1', label: 'Sumar los rasgos de alta resolución de stride 8 (proyectados a C/4)', type: 'tensorop', group: 'resid', outMeta: { label: TU + 'ampliado ×2 + rasgos de stride 8', tex: 'u_1 + f_{s1}' } });
    x = uop('up-ln', A.layernorm(x), 'ln', { out: 'up-n1', label: 'LayerNorm2d', type: 'norm', group: 'norm', outMeta: { label: TU + 'ampliado ×2, normalizado', tex: '\\mathrm{LN}(u_1)' } });
    x = uop('up-gelu1', A.gelu(x), 'gelu1', { out: 'up-a1', label: 'GELU', type: 'mlp', group: 'embed', outMeta: { label: TU + 'ampliado ×2, activado', tex: '\\mathrm{GELU}(\\cdot)' } });
    x = uop('up-conv2', A.conv_transpose2d(x, { k: 2, cout: C / 8, coutSym: 'C/8', outSym: ['H/4', 'W/4'] }), 'conv2', { out: 'up-c2', label: 'ConvTranspose 2×2 stride 2 (C/4 → C/8)', type: 'conv', group: 'embed', outMeta: { label: TU + 'ampliado ×4', tex: 'u_2' } });
    if (s2) x = uop('up-skip2', A.add(x, hires.s0), 'skip2', { out: 'up-s2', label: 'Sumar los rasgos de alta resolución de stride 4 (proyectados a C/8)', type: 'tensorop', group: 'resid', outMeta: { label: TU + 'ampliado ×4 + rasgos de stride 4', tex: 'u_2 + f_{s0}' } });
    const up = uop('up-gelu2', A.gelu(x), 'gelu2', { out: 'up-emb', label: 'GELU', type: 'mlp', group: 'embed', outMeta: { label: 'Embedding de imagen ampliado (' + 4 * c.G + '×' + 4 * c.G + '×C/8)', tex: 'E_{\\uparrow}' } });

    // ---- hipernetwork, producto y cabeza de IoU
    const off = s2 ? 1 : 0;
    const HN = ['mask-decoder', 'hypernet'], WH = ['Decoder de máscaras', 'hipernetwork (un MLP por token de máscara)'];
    const mt = g.op('md-mask-toks', A.take_rows(tokOut, { start: 1 + off, count: c.nMask, sym: String(c.nMask) }), { path: HN.concat(['take']), out: 'mask-toks', where: WH, label: 'Tomar los ' + c.nMask + ' tokens de máscara', type: 'tensorop', group: 'head', outMeta: { label: TD + 'tokens de máscara a la salida del transformer', tex: 't_{\\mathrm{mask}}' } });
    const hyper = ffn3({ g, pre: 'hn-', tpre: 'hn-', P: HN, where: WH, tl: TD + 'hipernetwork · ', dims: [C, C, C / 8], syms: ['C', 'C', 'C/8'], grouped: true, outId: 'hyper-in', outLabel: 'Pesos dinámicos: un vector de C/8 por token de máscara', outTex: 'w_k' }, mt);
    const all = g.op('md-dot', A.hyper_dot(hyper, up), { path: ['mask-decoder', 'dot'], out: 'masks-all', where: WD, label: 'Producto punto: máscara k = w_k · embedding ampliado en cada píxel', type: 'head', group: 'head', outMeta: { label: TD + 'las ' + c.nMask + ' máscaras (logits)', tex: 'M_k = w_k^\\top E_{\\uparrow}' } });
    const IH = ['mask-decoder', 'iou-head'], WIh = ['Decoder de máscaras', 'cabeza de IoU'];
    const it = g.op('md-iou-tok', A.take_rows(tokOut, { start: off, count: 1, vec: true }), { path: IH.concat(['take']), out: 'iou-tok', where: WIh, label: 'Tomar el token de IoU', type: 'tensorop', group: 'head', outMeta: { label: TD + 'token de IoU a la salida del transformer', tex: 't_{\\mathrm{IoU}}' } });
    const iouAll = ffn3({ g, pre: 'ih-', tpre: 'ih-', P: IH, where: WIh, tl: TD + 'cabeza de IoU · ', dims: [c.iouHidden, c.iouHidden, c.nMask], syms: [String(c.iouHidden), String(c.iouHidden), String(c.nMask)], sigmoid: s2, outId: 'iou-all', outLabel: TD + 'IoU predicho de las ' + c.nMask + ' máscaras', outTex: '\\widehat{\\mathrm{IoU}}' }, it);
    const SEL = ['mask-decoder', 'select'], WSl = ['Decoder de máscaras', 'selección multimask'];
    const multi = c.masks === 3;
    const masks = g.op('md-select-masks', A.mask_select(all, { start: multi ? 1 : 0, count: c.masks }), { path: SEL.concat(['masks']), out: 'masks', where: WSl, label: multi ? 'multimask: las 3 máscaras de ambigüedad (tokens 1–3)' : 'una sola máscara (token 0)', type: 'tensorop', group: 'head',
      outMeta: { label: multi ? 'Máscaras (3 niveles de ambigüedad, logits ' + 4 * c.G + '×' + 4 * c.G + ')' : 'Máscara (logits ' + 4 * c.G + '×' + 4 * c.G + ')', tex: 'M' } });
    const iou = g.op('md-select-iou', A.mask_select(iouAll, { start: multi ? 1 : 0, count: c.masks }), { path: SEL.concat(['iou']), out: 'iou', where: WSl, label: 'IoU predicho de las máscaras devueltas', type: 'tensorop', group: 'head', outMeta: { label: 'IoU predicho por máscara (calidad)', tex: '\\widehat{\\mathrm{IoU}}' } });
    return { tokOut, masks, iou, maskToks: mt };
  }

  // ================================================================== SAM
  const SAM_BASE = {
    Cin: 3, patch: 16, C: 256, M: 14, mlpRatio: 4, F: 128, pointTypes: 4, maskInCh: 16,
    // Decoder (MaskDecoder + TwoWayTransformer del oficial): 2 capas, 8 cabezas, MLP 2048, downsample ×2 en las cross-attention.
    Ldec: 2, hDec: 8, DmlpDec: 2048, down: 2, nMask: 4, iouHidden: 256,
    // Prompt del forward de referencia: P clics, sin caja, sin máscara de entrada, multimask (3 máscaras).
    P: 1, masks: 3, maskIn: 0,
  };
  const WE_OF = (c) => 'Codificador de imagen (ViT-' + c.size + ')';

  function samApplyKnobs(c, ov) {
    const notes = [];
    const res0 = c.H;
    if (ov.res !== undefined) { c.H = ov.res; c.W = ov.res; }
    if (ov.P !== undefined) c.P = ov.P;
    if (ov.masks !== undefined) c.masks = ov.masks;
    if (ov.maskIn !== undefined) c.maskIn = ov.maskIn;
    if (c.H !== res0) notes.push('Resolución ' + c.H + ': la posición absoluta (' + c.H / 16 + '×' + c.H / 16 + '×D) y las tablas relativas de los bloques globales (2·' + c.H / 16 + '−1 filas) cambian de tamaño (los pesos de 1024 se interpolan).');
    if (['res', 'P', 'masks', 'maskIn'].some((k) => ov[k] !== undefined)) {
      c.label = 'SAM ViT-' + c.size + ' @ ' + c.H + (c.P !== 1 ? ' · ' + c.P + ' clics' : '') + (c.masks !== 3 ? ' · 1 máscara' : '') + (c.maskIn ? ' · con máscara de entrada' : '');
    }
    c._notes = notes;
    return c;
  }

  function samResolve(c) {
    if (c.H !== c.W) throw new Error('SAM: el calculador modela la entrada cuadrada (lado largo a ' + c.H + ' con relleno), H = W.');
    if (c.H % c.patch !== 0) throw new Error('SAM: la resolución ' + c.H + ' no es divisible por el parche 16.');
    if (c.masks !== 1 && c.masks !== 3) throw new Error('SAM: masks debe ser 1 (una máscara) o 3 (multimask).');
    if (c.maskIn !== 0 && c.maskIn !== 1) throw new Error('SAM: maskIn debe ser 1 (con máscara de entrada) u omitirse.');
    if (c.D % c.h !== 0) throw new Error('SAM: D no es divisible por h.');
    c.res = c.H;
    c.G = c.H / c.patch;
    c.N = c.G * c.G;
    c.tokens = c.N;
    c.patches = c.N;
    c.dh = c.D / c.h;
    c.Dmlp = c.D * c.mlpRatio;
    c.nWside = Math.ceil(c.G / c.M);
    c.nW = c.nWside * c.nWside;
    c.padTokens = c.nW * c.M * c.M;
    c.Lg = c.globals.length;
    c.Lw = c.L - c.Lg;
    c.globalsStr = c.globals.join(', ');
    c.nSparse = c.P + 1;
    c.nTok = 5 + c.nSparse;
    c.innerDec = c.C / c.down;
    return c;
  }

  // Bloque del ViT de SAM (pre-LN): kind 'w' = atención en ventanas M×M con relleno, 'g' = global sobre los N tokens.
  // Ambos con posición relativa descompuesta (tablas por eje de 2S−1 filas: S = M o S = H/16).
  function vitBlock(g, x, c, kind) {
    const win = kind === 'w', pre = kind + '-', rep = win ? c.Lw : c.Lg;
    const P = ['img-encoder', win ? 'win-blocks' : 'global-blocks'];
    const where = [WE_OF(c), win ? 'bloques con ventanas ' + c.M + '×' + c.M + ' (' + rep + ' de ' + c.L + ')' : 'bloques globales (' + rep + ' de ' + c.L + ': índices ' + c.globalsStr + ')'];
    const tl = 'Codificador de imagen · ' + (win ? 'bloque con ventanas · ' : 'bloque global · ');
    const L = (m) => Object.assign({ perLayer: true }, m, { label: tl + m.label });
    const op = (id, res, extra) => g.op(pre + id, res, Object.assign({ path: P.concat([id]), repeat: rep, where }, extra));
    const sym16 = ['H/16', 'W/16'];
    const ln1 = op('ln1', A.layernorm(x), { out: pre + 'ln1', label: 'LayerNorm 1', type: 'norm', group: 'norm', outMeta: L({ label: 'entrada normalizada', tex: '\\mathrm{LN}_1(x)' }) });
    const t = win
      ? op('partition', A.window_partition_pad(ln1, { M: c.M, nWSym: String(c.nW), tokSym: 'M²' }), {
        out: 'w-win', label: 'Partición en ventanas ' + c.M + '×' + c.M + (c.padTokens > c.N ? ' (relleno ' + c.G + ' → ' + c.nWside * c.M + ')' : ''), type: 'tensorop', group: 'attn',
        outMeta: L({ label: c.nW + ' ventanas de ' + c.M + '×' + c.M + ' tokens' + (c.padTokens > c.N ? ' (con relleno)' : ''), tex: 'x_{\\mathrm{win}}' }) })
      : op('flatten', A.flatten(ln1, { sym: ['N', 'D'] }), { out: 'g-seq', label: 'Aplanar la rejilla (N tokens)', type: 'tensorop', group: 'attn', outMeta: L({ label: 'secuencia de N tokens', tex: 'x' }) });
    const qkv = op('qkv', A.linear(t, { dout: 3 * c.D, doutSym: '3D', bias: true }), { out: pre + 'qkv', label: 'Proyección Q, K, V', type: 'embed', group: 'attn', outMeta: L({ label: 'Q, K y V concatenados', tex: '[Q\\;K\\;V]' }) });
    const [q, k, v] = op('split', A.split_heads(qkv, { h: c.h, parts: 3 }), {
      out: [pre + 'q', pre + 'k', pre + 'v'], label: 'Separar en ' + c.h + ' cabezas', type: 'tensorop', group: 'attn',
      outMeta: [L({ label: 'queries por cabeza', tex: 'Q' }), L({ label: 'keys por cabeza', tex: 'K' }), L({ label: 'values por cabeza', tex: 'V' })],
    });
    const sc = op('scores', A.attention_scores(q, k), { out: pre + 'scores', label: win ? 'Producto QKᵀ dentro de cada ventana' : 'Producto QKᵀ global (N×N)', type: 'attn', group: 'attn', outMeta: L({ label: win ? 'scores por ventana' : 'scores globales N×N', tex: 'QK^\\top' }) });
    const sl = op('scale', A.scale(sc), { out: pre + 'scaled', label: 'Escala 1/√d_h', type: 'attn', group: 'attn', outMeta: L({ label: 'scores escalados', tex: 'QK^\\top/\\sqrt{d_h}' }) });
    const S = win ? c.M : c.G;
    const rp = op('rel-pos', A.decomposed_rel_pos(sl, q, { S, Ssym: win ? 'M' : 'H/16' }), {
      out: pre + 'biased', label: 'Posición relativa descompuesta (tablas de ' + (2 * S - 1) + '×d_h por eje)', type: 'attn', group: 'attn',
      outMeta: L({ label: 'scores + posición relativa (alto y ancho)', tex: 'QK^\\top/\\sqrt{d_h} + qR_h + qR_w' }),
    });
    const a = op('softmax', A.softmax(rp), { out: pre + 'attn', label: 'Softmax por fila', type: 'attn', group: 'attn', outMeta: L({ label: 'pesos de atención', tex: 'A' }) });
    const zh = op('weighted-sum', A.attention_weighted_sum(a, v), { out: pre + 'z-heads', label: 'Suma ponderada A·V', type: 'attn', group: 'attn', outMeta: L({ label: 'salida por cabeza', tex: 'AV' }) });
    const z = op('merge', A.merge_heads(zh, { Dsym: 'D' }), { out: pre + 'z', label: 'Concatenar cabezas', type: 'tensorop', group: 'attn', outMeta: L({ label: 'cabezas concatenadas', tex: 'Z' }) });
    const pj = op('proj', A.linear(z, { dout: c.D, doutSym: 'D' }), { out: pre + 'o', label: 'Proyección de salida W_O' + (win && c.padTokens > c.N ? ' (también sobre el relleno)' : ''), type: 'embed', group: 'attn', outMeta: L({ label: 'salida de la atención', tex: 'O = ZW_O' }) });
    const back = win
      ? op('unpartition', A.window_unpartition(pj, { H: c.G, W: c.G, M: c.M, outSym: sym16 }), { out: 'w-unwin', label: 'Deshacer las ventanas (y recortar el relleno)', type: 'tensorop', group: 'attn', outMeta: L({ label: 'rejilla reconstruida', tex: '\\mathrm{unpartition}(O)' }) })
      : op('unflatten', A.to_grid(pj, { H: c.G, W: c.G, sym: sym16 }), { out: 'g-grid', label: 'Secuencia → rejilla', type: 'tensorop', group: 'attn', outMeta: L({ label: 'salida de la atención como rejilla', tex: 'O' }) });
    const r1 = op('res1', A.residual_add(x, back), { out: pre + 'r1', label: 'Residual 1', type: 'tensorop', group: 'resid', outMeta: L({ label: 'x + atención', tex: "x'" }) });
    const ln2 = op('ln2', A.layernorm(r1), { out: pre + 'ln2', label: 'LayerNorm 2', type: 'norm', group: 'norm', outMeta: L({ label: 'entrada normalizada del MLP', tex: "\\mathrm{LN}_2(x')" }) });
    const u = op('fc1', A.linear(ln2, { dout: c.Dmlp, doutSym: 'D_mlp' }), { out: pre + 'u', label: 'MLP: capa 1 (×4)', type: 'mlp', group: 'mlp', outMeta: L({ label: 'capa oculta del MLP', tex: 'U' }) });
    const gg = op('gelu', A.gelu(u), { out: pre + 'g', label: 'GELU', type: 'mlp', group: 'mlp', outMeta: L({ label: 'activación GELU', tex: '\\mathrm{GELU}(U)' }) });
    const f = op('fc2', A.linear(gg, { dout: c.D, doutSym: 'D' }), { out: pre + 'f', label: 'MLP: capa 2', type: 'mlp', group: 'mlp', outMeta: L({ label: 'salida del MLP', tex: 'F' }) });
    return op('res2', A.residual_add(r1, f), {
      out: win ? 'w-out' : 'enc-out', label: 'Residual 2', type: 'tensorop', group: 'resid',
      outMeta: win ? L({ label: 'salida del bloque', tex: 'x_\\ell' })
        : { label: 'Salida del ViT (' + c.G + '×' + c.G + '×D, antes del neck)', tex: 'x_L', perLayer: false, note: 'El último bloque (índice ' + (c.L - 1) + ') es global.' },
    });
  }

  function samImageEncoder(g, c) {
    const WE = [WE_OF(c)], TE = 'Codificador de imagen · ';
    const sym16 = ['H/16', 'W/16'];
    const img = g.input('x-img', shp(['H', 'W', '3'], [c.H, c.W, c.Cin], 'img', 'grid'), { label: 'Imagen de entrada (lado largo a ' + c.H + ', con relleno)', tex: 'x' });
    const pt = g.op('e-patch-embed', A.conv2d(img, { k: c.patch, s: c.patch, cout: c.D, coutSym: 'D', kSym: String(c.patch), outSym: sym16 }), {
      path: ['img-encoder', 'patch-embed'], out: 'patches', where: WE, label: 'Patch embedding (conv 16×16, stride 16)', type: 'conv', group: 'embed',
      outMeta: { label: TE + 'parches embebidos (rejilla ' + c.G + '×' + c.G + ')', tex: 'X_p' },
    });
    const pos = g.op('e-pos-embed', A.pos_embed_grid({ H: c.G, W: c.G, D: c.D, sym: ['H/16', 'W/16', 'D'] }), {
      path: ['img-encoder', 'pos-embed'], out: 'e-pos', where: WE, label: 'Posición absoluta aprendida (' + c.G + '×' + c.G + '×D)', type: 'embed', group: 'embed',
      outMeta: { label: TE + 'tabla de posición absoluta', tex: 'E_{\\mathrm{pos}}' },
    });
    const x0 = g.op('e-add-pos', A.add(pt, pos), { path: ['img-encoder', 'pos-embed'], out: 'x0', where: WE, label: 'Sumar la posición', type: 'tensorop', group: 'embed', outMeta: { label: TE + 'tokens con posición (entrada del bloque 0)', tex: 'x_0' } });
    // Orden real: bloques globales en los índices c.globals (el último es global); el grafo muestra un bloque de cada tipo.
    const w = vitBlock(g, x0, c, 'w');
    const enc = vitBlock(g, w, c, 'g');
    const NK = ['img-encoder', 'neck'], WN = [WE_OF(c), 'neck'], TN = TE + 'neck · ';
    const nop = (id, res, node, extra) => g.op(id, res, Object.assign({ path: NK.concat([node]), where: WN }, extra));
    const c1 = nop('neck-conv1', A.conv2d(enc, { k: 1, cout: c.C, coutSym: 'C', outSym: sym16, bias: false }), 'conv1', { out: 'neck-c1', label: 'Conv 1×1 (D → C, sin sesgo)', type: 'conv', group: 'embed', outMeta: { label: TN + 'proyección 1×1 a C', tex: 'W_1 * x_L' } });
    const n1 = nop('neck-ln1', A.layernorm(c1), 'ln1', { out: 'neck-n1', label: 'LayerNorm2d', type: 'norm', group: 'norm', outMeta: { label: TN + 'proyección normalizada', tex: '\\mathrm{LN}(\\cdot)' } });
    const c2 = nop('neck-conv2', A.conv2d(n1, { k: 3, p: 1, s: 1, cout: c.C, coutSym: 'C', outSym: sym16, bias: false }), 'conv2', { out: 'neck-c2', label: 'Conv 3×3 (C → C, sin sesgo)', type: 'conv', group: 'embed', outMeta: { label: TN + 'conv 3×3', tex: 'W_2 * \\cdot' } });
    const emb = nop('neck-ln2', A.layernorm(c2), 'ln2', { out: 'img-emb', label: 'LayerNorm2d', type: 'norm', group: 'norm', outMeta: { label: 'Embedding de imagen (' + c.G + '×' + c.G + '×C, se calcula una vez por imagen)', tex: 'E' } });
    return emb;
  }

  A.defineModel({
    id: 'sam',
    label: 'Segment Anything (SAM)',
    paper: { title: 'Segment Anything', authors: 'Kirillov et al.', venue: 'ICCV 2023', year: 2023, arxiv: '2304.02643', code: 'github.com/facebookresearch/segment-anything' },
    configs: {
      'sam-vit-h-1024': Object.assign({}, SAM_BASE, { label: 'SAM ViT-H @ 1024', size: 'H', H: 1024, W: 1024, D: 1280, L: 32, h: 16, globals: [7, 15, 23, 31], canonical: true,
        source: 'Kirillov et al. 2023 (SAM: codificador ViT-H/16 MAE, prompt encoder y decoder de máscaras ligero) y build_sam.py oficial (build_sam_vit_h: embed_dim 1280, depth 32, 16 cabezas, bloques globales [7, 15, 23, 31], ventana 14, rel-pos); cross-check HF SamModel(SamConfig(...)) construido en código' }),
      'sam-vit-l-1024': Object.assign({}, SAM_BASE, { label: 'SAM ViT-L @ 1024', size: 'L', H: 1024, W: 1024, D: 1024, L: 24, h: 16, globals: [5, 11, 17, 23],
        source: 'build_sam.py oficial (build_sam_vit_l: embed_dim 1024, depth 24, 16 cabezas, bloques globales [5, 11, 17, 23]); cross-check HF SamModel(SamConfig(...))' }),
      'sam-vit-b-1024': Object.assign({}, SAM_BASE, { label: 'SAM ViT-B @ 1024', size: 'B', H: 1024, W: 1024, D: 768, L: 12, h: 12, globals: [2, 5, 8, 11],
        source: 'build_sam.py oficial (build_sam_vit_b: embed_dim 768, depth 12, 12 cabezas, bloques globales [2, 5, 8, 11]); cross-check HF SamModel(SamConfig(...))' }),
    },
    knobs: { res: [512, 768, 1024, 1280], P: [1, 2, 3, 5, 10], masks: [1, 3], maskIn: [1] },
    applyKnobs(c, ov) { return samApplyKnobs(c, ov); },
    resolve(c) { return samResolve(c); },

    build(c, A) {
      const g = A.graph(c);
      const emb = samImageEncoder(g, c);
      const { sparse, dense, ipe } = promptEncoder(g, c, 'sam');
      maskDecoder(g, c, emb, ipe, sparse, dense, 'sam');
      return g;
    },

    quantities(c, r) { return samQuantities(c, r); },
    metrics(c, r, o) { return samMetrics(c, r, o); },
  });

  const sumOf = (r, f, key) => r.ops.filter(f).reduce((s, o) => s + o[key] * o.repeat, 0);
  const perOp = (r, f, key) => r.ops.filter(f).reduce((s, o) => s + o[key], 0);

  function samQuantities(c, r) {
    const n = r.totals.byNode, by = r.totals.byPath;
    const inW = (o) => o.path[1] === 'win-blocks', inG = (o) => o.path[1] === 'global-blocks';
    const encMacs = n['img-encoder'].macs, promptMacs = n['prompt-enc'].macs, decMacs = n['mask-decoder'].macs;
    const opBy = (id) => r.ops.find((o) => o.id === id);
    return {
      tokens: c.N, N: c.N, G: c.G, res: c.H, H: c.H, D: c.D, L: c.L, h: c.h, dh: c.dh, Dmlp: c.Dmlp, M: c.M, C: c.C, P: c.P, masks: c.masks,
      nW: c.nW, nWside: c.nWside, padTokens: c.padTokens, padExtraTokens: c.padTokens - c.N, padSide: c.nWside * c.M,
      Lw: c.Lw, Lg: c.Lg, globals: c.globalsStr, nSparse: c.nSparse, nTok: c.nTok, innerDec: c.innerDec, hDec: c.hDec, Ldec: c.Ldec, DmlpDec: c.DmlpDec,
      encoderParams: n['img-encoder'].params, promptEncParams: n['prompt-enc'].params, decoderParams: n['mask-decoder'].params,
      promptDecoderParams: n['prompt-enc'].params + n['mask-decoder'].params,
      encoderMacs: encMacs, promptEncMacs: promptMacs, maskDecoderMacs: decMacs, decoderMacsPerPrompt: promptMacs + decMacs,
      breakEvenPrompts: Math.round(encMacs / (promptMacs + decMacs)),
      patchEmbedParams: by['img-encoder>patch-embed'].params, posEmbedParams: by['img-encoder>pos-embed'].params, neckParams: by['img-encoder>neck'].params,
      neckMacs: by['img-encoder>neck'].macs,
      winBlockParams: perOp(r, inW, 'params'), globalBlockParams: perOp(r, inG, 'params'),
      winBlockMacs: perOp(r, inW, 'macs'), globalBlockMacs: perOp(r, inG, 'macs'),
      winBlocksParams: by['img-encoder>win-blocks'].params, globalBlocksParams: by['img-encoder>global-blocks'].params,
      winBlocksMacs: by['img-encoder>win-blocks'].macs, globalBlocksMacs: by['img-encoder>global-blocks'].macs,
      relPosWinParams: opBy('w-rel-pos').params, relPosGlobalParams: opBy('g-rel-pos').params,
      relPosWinRows: 2 * c.M - 1, relPosGlobalRows: 2 * c.G - 1,
      relPosWinMacs: opBy('w-rel-pos').macs, relPosGlobalMacs: opBy('g-rel-pos').macs,
      twoWayParams: by['mask-decoder>two-way'].params, twoWayLayerParams: by['mask-decoder>two-way'].params / c.Ldec,
      hypernetParams: by['mask-decoder>hypernet'].params, iouHeadParams: by['mask-decoder>iou-head'].params, upscaleParams: by['mask-decoder>upscale'].params,
      upscaleMacs: by['mask-decoder>upscale'].macs, twoWayMacs: by['mask-decoder>two-way'].macs, dotMacs: by['mask-decoder>dot'].macs,
      maskEmbedParams: 4 + 4 * 4 + 2 * 4 + 16 * 4 * 4 + 16 + 2 * 16 + 16 * c.C + c.C,   // convs del prompt de máscara (1→4→16→C)
      denseOut: 4 * c.G,
      paramsHF: r.totals.params + 2 * c.F,          // HF registra la matriz gaussiana 2×128 como Parameter (el oficial, buffer)
      fourierGaussian: 2 * c.F,
    };
  }

  function samMetrics(c, r, o) {
    const q = r.quantities, t = r.totals, by = o.by, B = o.B;
    const scoreOps = (pre) => r.ops.filter((x) => x.id.startsWith(pre) && (x.prim === 'attention_scores' || x.prim === 'attention_weighted_sum' || x.prim === 'decomposed_rel_pos'));
    const winScore = scoreOps('w-').reduce((s, x) => s + x.macs, 0), globScore = scoreOps('g-').reduce((s, x) => s + x.macs, 0);
    const winAttnMem = c.nW * c.h * c.M * c.M * c.M * c.M * by * B, globalAttnMem = c.h * c.N * c.N * by * B;
    const dec = q.decoderMacsPerPrompt;
    const allGlobal = q.encoderMacs + c.Lw * (q.globalBlockMacs - q.winBlockMacs);
    const ref = (id) => { try { return A.run(id); } catch (e) { return null; } };
    const h = c.size === 'H' && c.H === 1024 ? null : ref('sam-vit-h-1024');
    const base = Object.assign({ res: c.H, P: c.P, masks: c.masks }, c.maskIn ? { maskIn: 1 } : {});
    const at = (ov) => A.run(r.id, Object.assign({}, base, ov));
    const decOf = (m) => m.totals.byNode['prompt-enc'].macs + m.totals.byNode['mask-decoder'].macs;
    const out = {
      // codificar una vez, decodificar por prompt
      encoderMacs: q.encoderMacs, encoderParams: q.encoderParams, encoderMacsShare: q.encoderMacs / t.macs,
      decoderMacsPerPrompt: dec, decoderParams: q.promptDecoderParams, promptEncMacs: q.promptEncMacs, maskDecoderMacs: q.maskDecoderMacs,
      decoderMacsShare: dec / t.macs, encoderToDecoder: q.encoderMacs / dec, breakEvenPrompts: Math.round(q.encoderMacs / dec),   // = quantities.breakEvenPrompts
      decoderMacsWithBox: decOf(at({ P: c.P + 1 })),            // P clics + 1 caja = P + 2 tokens (sin relleno), como P + 1 clics
      imgEmbMem: c.N * c.C * by * B,                             // el embedding que se guarda por imagen (64×64×256)
      encoderParamsShare: q.encoderParams / t.params,
      // ventanas vs global, por bloque
      winBlockMacs: q.winBlockMacs, globalBlockMacs: q.globalBlockMacs, globalToWinBlockMacs: q.globalBlockMacs / q.winBlockMacs,
      winScoreMacs: winScore, globalScoreMacs: globScore, globalToWinScoreMacs: globScore / winScore,
      winAttnMem, globalAttnMem, globalToWinAttnMem: globalAttnMem / winAttnMem,
      winBlocks: c.Lw, globalBlocks: c.Lg, globalBlocksMacsShare: q.globalBlocksMacs / q.encoderMacs,
      winBlocksMacs: q.winBlocksMacs, globalBlocksMacs: q.globalBlocksMacs, neckMacs: q.neckMacs, patchEmbedMacs: q.encoderMacs - q.winBlocksMacs - q.globalBlocksMacs - q.neckMacs,   // reparto del encoder (patch embed + posición)
      relPosWinParams: q.relPosWinParams, relPosGlobalParams: q.relPosGlobalParams,
      padTokens: c.padTokens, padOverhead: c.padTokens / c.N - 1,
      allGlobalEncoderMacs: allGlobal, allGlobalToActual: allGlobal / q.encoderMacs,
      // decoder
      decTokens: c.nTok, decT2iAttnMem: c.hDec * c.nTok * c.N * by * B, decSelfAttnMem: c.hDec * c.nTok * c.nTok * by * B,
      imageTokens: c.N,
      units: SAM_UNITS,
    };
    if (h) Object.assign(out, { vitHEncoderMacs: h.quantities.encoderMacs, encoderMacsVsVitH: q.encoderMacs / h.quantities.encoderMacs, paramsVsVitH: t.params / h.totals.params });
    out.promptScaling = [1, 2, 5, 10].map((P) => { const m = P === c.P ? r : at({ P }); return { P, tokens: 5 + P + 1, decoderMacs: decOf(m), macs: m.totals.macs }; });
    out.resScaling = [512, 768, 1024, 1280].map((res) => {
      const m = res === c.H ? r : at({ res });
      return { res, tokens: m.config.N, encoderMacs: m.quantities.encoderMacs, decoderMacs: decOf(m), globalAttnMem: c.h * m.config.N * m.config.N * by * B };
    });
    return out;
  }

  // Unidades de las métricas que no siguen la convención de nombres (…Macs = MACs, …Mem = bytes, …Share = fracción).
  const SAM_UNITS = {
    encoderMacs: 'macs', decoderMacsPerPrompt: 'macs', promptEncMacs: 'macs', maskDecoderMacs: 'macs', decoderMacsWithBox: 'macs',
    encoderParams: 'params', decoderParams: 'params', relPosWinParams: 'params', relPosGlobalParams: 'params',
    encoderMacsShare: 'pct', decoderMacsShare: 'pct', encoderParamsShare: 'pct', globalBlocksMacsShare: 'pct', padOverhead: 'pct',
    encoderToDecoder: 'ratio', globalToWinBlockMacs: 'ratio', globalToWinScoreMacs: 'ratio', globalToWinAttnMem: 'ratio',
    allGlobalToActual: 'ratio', encoderMacsVsVitH: 'ratio', paramsVsVitH: 'ratio',
    winBlockMacs: 'macs', globalBlockMacs: 'macs', winScoreMacs: 'macs', globalScoreMacs: 'macs', allGlobalEncoderMacs: 'macs', vitHEncoderMacs: 'macs',
    imgEmbMem: 'bytes', winAttnMem: 'bytes', globalAttnMem: 'bytes', decT2iAttnMem: 'bytes', decSelfAttnMem: 'bytes',
    winBlocks: 'count', globalBlocks: 'count', padTokens: 'count', decTokens: 'count', imageTokens: 'count', breakEvenPrompts: 'count',
    winBlocksMacs: 'macs', globalBlocksMacs: 'macs', neckMacs: 'macs', patchEmbedMacs: 'macs',
  };

  // ================================================================== SAM 2
  const SAM2_BASE = {
    Cin: 3, C: 256, memDim: 64, F: 128, pointTypes: 4, maskInCh: 16,
    // Hiera: patch embed conv 7×7 stride 4 padding 3; q-pooling 2×2 en el primer bloque de los stages 2–4; MLP ×4.
    patchK: 7, patchS: 4, patchP: 3, qStride: 2, mlpRatio: 4,
    // Memory attention: 4 capas pre-LN, 1 cabeza, FFN 2048, RoPE 2-D (θ = 10,000).
    Lmem: 4, hMem: 1, Dmlp: 2048,
    // Decoder de máscaras (como el de SAM + rasgos de alta resolución + token y cabeza de objeto).
    Ldec: 2, hDec: 8, DmlpDec: 2048, down: 2, nMask: 4, iouHidden: 256,
    // Memory encoder: downsampler de máscara 1→4→16→64→256 (conv 3×3 stride 2) + fuser de 2 bloques ConvNeXt (7×7, 4C).
    dsChannels: [1, 4, 16, 64, 256], fuserLayers: 2, fuserK: 7, fuserRatio: 4,
    // Frame de seguimiento de referencia: sin clics (P = 0 → 1 punto vacío + relleno), multimask (3) y la mejor por IoU;
    // memoria = 1 frame con prompt (M) + memFrames recientes (N = 6, num_maskmem = 7) y 16 punteros de objeto.
    P: 0, masks: 3, maskIn: 0, memFrames: 6, condFrames: 1, ptrs: 16, maxPtrs: 16,
  };
  const SIZE2 = { 'sam2-hiera-l': 'L', 'sam2-hiera-bplus': 'B+', 'sam2-hiera-s': 'S', 'sam2-hiera-t': 'T' };
  const WH_OF = (c) => 'Codificador de imagen (Hiera-' + c.size + ')';
  const CSYM = ['D', '2D', '4D', '8D'], HSYM = ['h', '2h', '4h', '8h'];

  function sam2ApplyKnobs(c, ov) {
    const notes = [];
    const n0 = c.memFrames, p0 = c.ptrs;
    if (ov.res !== undefined) { c.H = ov.res; c.W = ov.res; }
    if (ov.memFrames !== undefined) c.memFrames = ov.memFrames;
    if (ov.ptrs !== undefined) c.ptrs = ov.ptrs;
    if (c.memFrames !== n0) notes.push('Nᵣ = ' + c.memFrames + ' frames recientes (memFrames; la config usa ' + n0 + '): num_maskmem = ' + (c.memFrames + 1) + ', así que la tabla temporal de la memoria pasa a ' + (c.memFrames + 1) + '×64 parámetros y la cross-attention ve ' + (c.memFrames + c.condFrames) + ' memorias.');
    if (c.ptrs > c.maxPtrs) notes.push('P = ' + c.ptrs + ' punteros (ptrs) supera el máximo del modelo oficial (max_obj_ptrs_in_encoder = ' + c.maxPtrs + ').');
    if (['res', 'memFrames', 'ptrs'].some((k) => ov[k] !== undefined)) {
      c.label = 'SAM 2 Hiera-' + c.size + ' @ ' + c.H + (c.memFrames !== n0 ? ' · Nᵣ = ' + c.memFrames : '') + (c.ptrs !== p0 ? ' · ' + c.ptrs + ' punteros' : '');
    }
    c._notes = notes;
    return c;
  }

  function sam2Resolve(c) {
    if (c.H !== c.W) throw new Error('SAM 2: el calculador modela la entrada cuadrada (H = W).');
    if (c.H % 32 !== 0) throw new Error('SAM 2: la resolución ' + c.H + ' debe ser múltiplo de 32 (patch embed stride 4 y tres q-poolings).');
    c.res = c.H;
    c.G = c.H / 16; c.N = c.G * c.G; c.tokens = c.N;
    c.dh = c.D / c.h;
    c.L = c.depths.reduce((a, b) => a + b, 0);
    c.depthsStr = c.depths.join(', '); c.globalsStr = c.globals.join(', '); c.windowsStr = c.windows.join(', ');
    let start = 0;
    c.stages = c.depths.map((depth, i) => {
      const k = i + 1, f = 4 * Math.pow(2, i), side = c.H / f;
      const C = c.D * Math.pow(2, i), h = c.h * Math.pow(2, i);
      const idx = Array.from({ length: depth }, (_, j) => start + j);
      const st = { k, f, side, sideSym: ['H/' + f, 'W/' + f], C, Csym: CSYM[i], h, hSym: HSYM[i], dh: C / h, depth, ws: c.windows[i], start, groups: [] };
      let rest = idx;
      if (k > 1) {
        const glob = c.globals.indexOf(start) >= 0, prev = c.windows[i - 1], ws = glob ? 0 : prev;
        const inSide = side * 2;
        const nW = ws ? Math.pow(Math.ceil(inSide / ws), 2) : 1;
        if (ws && (ws % 2 !== 0 || nW !== Math.pow(Math.ceil(side / (ws / 2)), 2))) throw new Error('SAM 2: la ventana ' + ws + ' del q-pooling no encaja con el mapa ' + inSide + '×' + inSide + '.');
        st.groups.push({ kind: 'q', rep: 1, ws, outWs: ws / 2, nW, inSide, inSideSym: ['H/' + f / 2, 'W/' + f / 2], inC: C / 2, inCsym: CSYM[i - 1], idx: [start] });
        rest = idx.slice(1);
      }
      const w = rest.filter((j) => c.globals.indexOf(j) < 0), gl = rest.filter((j) => c.globals.indexOf(j) >= 0);
      if (w.length) st.groups.push({ kind: 'w', rep: w.length, ws: st.ws, nW: Math.pow(Math.ceil(side / st.ws), 2), inSide: side, inSideSym: st.sideSym, inC: C, inCsym: st.Csym, idx: w });
      if (gl.length) st.groups.push({ kind: 'g', rep: gl.length, ws: 0, nW: 1, inSide: side, inSideSym: st.sideSym, inC: C, inCsym: st.Csym, idx: gl });
      st.globalBlocks = gl.length + (st.groups[0].kind === 'q' && st.groups[0].ws === 0 ? 1 : 0);
      start += depth;
      return st;
    });
    c.Cout = c.stages[3].C;
    c.nMem = c.memFrames + c.condFrames;
    c.memTokens = c.nMem * c.N;
    c.ptrSplit = c.C / c.memDim;
    c.ptrTokens = c.ptrSplit * c.ptrs;
    c.Nm = c.memTokens + c.ptrTokens;
    c.numMaskmem = c.memFrames + 1;
    c.nSparse = 2;
    c.nTok = 8;
    return c;
  }

  // Grupo de bloques de Hiera (pre-LN, MultiScaleBlock). kind 'q': primer bloque del stage con q-pooling (ventana del
  // stage anterior; el atajo es Linear + max-pool), 'w': ventanas de lado ws (con relleno), 'g': atención global.
  function hieraGroup(g, x, c, st, gr, last) {
    const k = st.k, kind = gr.kind, pre = 'h' + k + '-' + kind + '-', rep = gr.rep, ws = gr.ws;
    const node = { q: 'qpool-block', w: 'win-blocks', g: 'global-blocks' }[kind];
    const P = ['img-encoder', 'stage' + k, node];
    const desc = kind === 'q' ? 'bloque de q-pooling' + (ws ? ' (ventanas ' + ws + '×' + ws + ' → ' + gr.outWs + '×' + gr.outWs + ')' : ' (global)')
      : kind === 'w' ? 'bloques con ventanas ' + ws + '×' + ws + ' (×' + rep + ')' : 'bloques globales (×' + rep + ')';
    const where = [WH_OF(c), 'Stage ' + k, desc];
    const tl = 'Codificador de imagen · Stage ' + k + ' · ' + (kind === 'q' ? 'q-pooling · ' : kind === 'w' ? 'ventanas · ' : 'global · ');
    const L = (m) => Object.assign({ perLayer: rep > 1 }, m, { label: tl + m.label });
    const op = (id, res, extra) => g.op(pre + id, res, Object.assign({ path: P.concat([id]), repeat: rep, where }, extra));
    const ln1 = op('ln1', A.layernorm(x), { out: pre + 'ln1', label: 'LayerNorm 1', type: 'norm', group: 'norm', outMeta: L({ label: 'entrada normalizada', tex: '\\mathrm{LN}_1(x)' }) });
    let resid = x;
    if (kind === 'q') {
      const sp = op('skip-proj', A.linear(ln1, { dout: st.C, doutSym: st.Csym }), { out: pre + 'skip-p', label: 'Atajo: Linear ' + gr.inCsym + ' → ' + st.Csym, type: 'embed', group: 'resid', outMeta: L({ label: 'atajo proyectado (antes del pooling)', tex: 'xW_s' }) });
      resid = op('skip-pool', A.maxpool2d(sp, { k: c.qStride, s: c.qStride, outSym: st.sideSym }), { out: pre + 'skip', label: 'Atajo: max-pool 2×2', type: 'tensorop', group: 'resid', outMeta: L({ label: 'atajo reducido ×2', tex: '\\mathrm{pool}(xW_s)' }) });
    }
    const t = ws
      ? op('partition', A.window_partition_pad(ln1, { M: ws, nWSym: String(gr.nW), tokSym: String(ws * ws) }), { out: pre + 'win', label: 'Partición en ventanas ' + ws + '×' + ws, type: 'tensorop', group: 'attn', outMeta: L({ label: gr.nW + ' ventanas de ' + ws + '×' + ws, tex: 'x_{\\mathrm{win}}' }) })
      : op('flatten', A.flatten(ln1, { sym: [gr.inSideSym.join('·'), gr.inCsym] }), { out: pre + 'seq', label: 'Aplanar la rejilla (atención global)', type: 'tensorop', group: 'attn', outMeta: L({ label: 'secuencia de todos los tokens del mapa', tex: 'x' }) });
    const qkv = op('qkv', A.linear(t, { dout: 3 * st.C, doutSym: mulSym(3, st.Csym) }), { out: pre + 'qkv', label: 'Proyección Q, K, V (' + gr.inCsym + ' → 3·' + st.Csym + ')', type: 'embed', group: 'attn', outMeta: L({ label: 'Q, K y V concatenados', tex: '[Q\\;K\\;V]' }) });
    const [q, kk, v] = op('split', A.split_heads(qkv, { h: st.h, parts: 3, hSym: st.hSym, dhSym: 'd_h' }), {
      out: [pre + 'q', pre + 'k', pre + 'v'], label: 'Separar en ' + st.h + (st.h === 1 ? ' cabeza' : ' cabezas'), type: 'tensorop', group: 'attn',
      outMeta: [L({ label: 'queries por cabeza', tex: 'Q' }), L({ label: 'keys por cabeza', tex: 'K' }), L({ label: 'values por cabeza', tex: 'V' })],
    });
    let qq = q;
    if (kind === 'q') qq = op('q-pool', A.query_pool(q, { s: c.qStride, tokSym: ws ? String(gr.outWs * gr.outWs) : st.sideSym.join('·') }), { out: pre + 'q-pooled', label: 'Q-pooling: max-pool 2×2 de las queries', type: 'tensorop', group: 'attn', outMeta: L({ label: 'queries reducidas ×4 (K y V no)', tex: '\\mathrm{pool}(Q)' }) });
    const sc = op('scores', A.attention_scores(qq, kk), { out: pre + 'scores', label: ws ? 'Producto QKᵀ dentro de cada ventana' : 'Producto QKᵀ global', type: 'attn', group: 'attn', outMeta: L({ label: ws ? 'scores por ventana' : 'scores globales', tex: 'QK^\\top' }) });
    const sl = op('scale', A.scale(sc), { out: pre + 'scaled', label: 'Escala 1/√d_h', type: 'attn', group: 'attn', outMeta: L({ label: 'scores escalados', tex: 'QK^\\top/\\sqrt{d_h}' }) });
    const a = op('softmax', A.softmax(sl), { out: pre + 'attn', label: 'Softmax por fila', type: 'attn', group: 'attn', outMeta: L({ label: 'pesos de atención', tex: 'A' }) });
    const zh = op('weighted-sum', A.attention_weighted_sum(a, v), { out: pre + 'z-heads', label: 'Suma ponderada A·V', type: 'attn', group: 'attn', outMeta: L({ label: 'salida por cabeza', tex: 'AV' }) });
    const z = op('merge', A.merge_heads(zh, { Dsym: st.Csym }), { out: pre + 'z', label: 'Concatenar cabezas', type: 'tensorop', group: 'attn', outMeta: L({ label: 'cabezas concatenadas', tex: 'Z' }) });
    const pj = op('proj', A.linear(z, { dout: st.C, doutSym: st.Csym }), { out: pre + 'o', label: 'Proyección de salida W_O', type: 'embed', group: 'attn', outMeta: L({ label: 'salida de la atención', tex: 'O = ZW_O' }) });
    const back = ws
      ? op('unpartition', A.window_unpartition(pj, { H: st.side, W: st.side, M: kind === 'q' ? gr.outWs : ws, outSym: st.sideSym }), { out: pre + 'unwin', label: 'Deshacer las ventanas' + (kind === 'q' ? ' (ahora de ' + gr.outWs + '×' + gr.outWs + ')' : ''), type: 'tensorop', group: 'attn', outMeta: L({ label: 'rejilla reconstruida', tex: '\\mathrm{unpartition}(O)' }) })
      : op('unflatten', A.to_grid(pj, { H: st.side, W: st.side, sym: st.sideSym }), { out: pre + 'grid', label: 'Secuencia → rejilla', type: 'tensorop', group: 'attn', outMeta: L({ label: 'salida de la atención como rejilla', tex: 'O' }) });
    const r1 = op('res1', A.residual_add(resid, back), { out: pre + 'r1', label: 'Residual 1' + (kind === 'q' ? ' (con el atajo reducido)' : ''), type: 'tensorop', group: 'resid', outMeta: L({ label: 'atajo + atención', tex: "x'" }) });
    const ln2 = op('ln2', A.layernorm(r1), { out: pre + 'ln2', label: 'LayerNorm 2', type: 'norm', group: 'norm', outMeta: L({ label: 'entrada normalizada del MLP', tex: "\\mathrm{LN}_2(x')" }) });
    const u = op('fc1', A.linear(ln2, { dout: c.mlpRatio * st.C, doutSym: mulSym(c.mlpRatio, st.Csym) }), { out: pre + 'u', label: 'MLP: capa 1 (×4)', type: 'mlp', group: 'mlp', outMeta: L({ label: 'capa oculta del MLP', tex: 'U' }) });
    const gg = op('gelu', A.gelu(u), { out: pre + 'g', label: 'GELU', type: 'mlp', group: 'mlp', outMeta: L({ label: 'activación GELU', tex: '\\mathrm{GELU}(U)' }) });
    const f = op('fc2', A.linear(gg, { dout: st.C, doutSym: st.Csym }), { out: pre + 'f', label: 'MLP: capa 2', type: 'mlp', group: 'mlp', outMeta: L({ label: 'salida del MLP', tex: 'F' }) });
    return op('res2', A.residual_add(r1, f), {
      out: last ? 'h' + k + '-out' : pre + 'out', label: 'Residual 2', type: 'tensorop', group: 'resid',
      outMeta: last ? { label: 'Codificador de imagen · salida del stage ' + k + ' (stride ' + st.f + ')', tex: 'z_' + k, perLayer: false } : L({ label: 'salida del bloque', tex: 'x_\\ell' }),
    });
  }

  function hieraEncoder(g, c) {
    const WE = [WH_OF(c)], TE = 'Codificador de imagen · ';
    const s1 = c.stages[0];
    const img = g.input('x-img', shp(['H', 'W', '3'], [c.H, c.W, c.Cin], 'img', 'grid'), { label: 'Frame t (' + c.H + '×' + c.W + ')', tex: 'x_t' });
    const pe = g.op('h-patch-embed', A.conv2d(img, { k: c.patchK, s: c.patchS, p: c.patchP, cout: c.D, coutSym: 'D', kSym: String(c.patchK), outSym: s1.sideSym, floor: true }), {
      path: ['img-encoder', 'patch-embed'], out: 'patches', where: WE, label: 'Patch embedding (conv 7×7, stride 4, padding 3)', type: 'conv', group: 'embed',
      outMeta: { label: TE + 'parches embebidos (stride 4)', tex: 'X_p' },
    });
    const pos = g.op('h-pos-embed', A.window_pos_embed({ H: s1.side, W: s1.side, C: c.D, bkg: c.bkg, win: c.windows[0], sym: ['H/4', 'W/4', 'D'] }), {
      path: ['img-encoder', 'pos-embed'], out: 'h-pos', where: WE, label: 'Posición por ventanas (fondo ' + c.bkg + '×' + c.bkg + ' interpolado + ventana ' + c.windows[0] + '×' + c.windows[0] + ' en mosaico)', type: 'embed', group: 'embed',
      outMeta: { label: TE + 'tabla de posición (fondo + ventana)', tex: 'E_{\\mathrm{pos}}' },
    });
    let x = g.op('h-add-pos', A.add(pe, pos), { path: ['img-encoder', 'pos-embed'], out: 'h-x0', where: WE, label: 'Sumar la posición', type: 'tensorop', group: 'embed', outMeta: { label: TE + 'tokens con posición (entrada del stage 1)', tex: 'x_0' } });
    const outs = [];
    for (const st of c.stages) {
      st.groups.forEach((gr, i) => { x = hieraGroup(g, x, c, st, gr, i === st.groups.length - 1); });
      outs.push(x);
    }
    return outs;
  }

  function fpnNeck(g, c, outs) {
    const W = ['FPN (neck)'], T = 'FPN · ';
    const op = (id, res, extra) => g.op(id, res, Object.assign({ path: ['fpn', id.replace(/^fpn-/, '')], where: W }, extra));
    const lat = (id, x, st, out, lab) => op(id, A.conv2d(x, { k: 1, cout: c.C, coutSym: 'C', outSym: st.sideSym }), { out, label: 'Lateral: conv 1×1 (' + st.Csym + ' → C), stride ' + st.f, type: 'conv', group: 'embed', outMeta: { label: lab, tex: 'P_{' + st.f + '}' } });
    const l4 = lat('fpn-lat4', outs[3], c.stages[3], 'fpn-l4', T + 'nivel stride 32 (se descarta tras el top-down)');
    const up = op('fpn-up', A.upsample_nearest(l4, { s: 2, outSym: ['H/16', 'W/16'] }), { out: 'fpn-up', label: 'Top-down: upsample ×2 (nearest)', type: 'tensorop', group: 'embed', outMeta: { label: T + 'stride 32 ampliado a stride 16', tex: '\\uparrow P_{32}' } });
    const l3 = lat('fpn-lat3', outs[2], c.stages[2], 'fpn-l3', T + 'lateral de stride 16');
    const s16 = op('fpn-add', A.add(l3, up), { out: 'fpn-s16', label: 'Top-down: lateral + ampliado', type: 'tensorop', group: 'embed', outMeta: { label: 'Rasgos del frame, stride 16 (' + c.G + '×' + c.G + '×C)', tex: 'F_{16}' } });
    const s8 = lat('fpn-lat2', outs[1], c.stages[1], 'fpn-s8', T + 'rasgos de stride 8 (sin top-down)');
    const s4 = lat('fpn-lat1', outs[0], c.stages[0], 'fpn-s4', T + 'rasgos de stride 4 (sin top-down)');
    const pos = op('fpn-pos', A.sine_pos_encoding({ H: c.G, W: c.G, D: c.C, rowsSym: 'N', Dsym: 'C' }), { out: 'fpn-pos', label: 'PE seno/coseno 2-D del nivel stride 16 (buffer)', type: 'embed', group: 'embed', outMeta: { label: T + 'posición seno/coseno del nivel stride 16', tex: 'P_{\\sin}' } });
    const seq = op('fpn-seq', A.flatten(s16, { sym: ['N', 'C'] }), { out: 'feat-seq', label: 'Aplanar (N tokens)', type: 'tensorop', group: 'embed', outMeta: { label: T + 'rasgos de stride 16 como secuencia', tex: 'F_{16}' } });
    return { s16, s8, s4, pos, seq };
  }

  function memoryBank(g, c) {
    const WB = ['Banco de memoria'], TB = 'Banco de memoria · ';
    const mem = g.input('bank-feats', shp([c.nMem + '·N', String(c.memDim)], [c.memTokens, c.memDim], 'img', 'seq'), {
      label: TB + c.nMem + ' memorias espaciales (' + c.condFrames + ' con prompt + ' + c.memFrames + ' recientes), ' + c.G + '×' + c.G + '×' + c.memDim + ' cada una', tex: 'M_{\\mathrm{sp}}',
    });
    const mpos = g.input('bank-pos', shp([c.nMem + '·N', String(c.memDim)], [c.memTokens, c.memDim], 'img', 'seq'), { label: TB + 'posición seno/coseno de cada memoria (se guarda con ella)', tex: 'P_{\\mathrm{sp}}' });
    const tpos = g.op('mb-tpos', A.add_temporal_embed(mpos, { rows: c.numMaskmem, D: c.memDim, Dsym: String(c.memDim), frames: c.nMem }), {
      path: ['memory-bank', 'tpos'], out: 'bank-pos-t', where: WB, label: 'Sumar el embedding temporal de cada memoria (' + c.numMaskmem + ' posiciones del FIFO)', type: 'embed', group: 'embed',
      outMeta: { label: TB + 'posición espacial + temporal de cada memoria', tex: 'P_{\\mathrm{sp}} + e_{\\Delta t}' },
    });
    const WP = ['Punteros de objeto'], TP = 'Punteros de objeto · ';
    const ptr = g.input('bank-ptrs', shp([String(c.ptrs), 'C'], [c.ptrs, c.C], 'qry', 'seq'), { label: TP + c.ptrs + ' punteros guardados (' + c.condFrames + ' del frame con prompt + ' + (c.ptrs - c.condFrames) + ' de frames anteriores)', tex: 'p_{1..' + c.ptrs + '}' });
    const ts = g.op('op-tpos-sine', A.sine_pos_1d({ rows: c.ptrs, rowsSym: String(c.ptrs), D: c.C, Dsym: 'C', mod: 'qry' }), {
      path: ['obj-ptrs', 'tpos'], out: 'ptr-tpos-sine', where: WP, label: 'PE seno/coseno 1-D de la distancia temporal de cada puntero (buffer)', type: 'embed', group: 'embed',
      outMeta: { label: TP + 'posición temporal seno/coseno de cada puntero', tex: '\\mathrm{PE}(\\Delta t)' },
    });
    const tp = g.op('op-tpos-proj', A.linear(ts, { dout: c.memDim, doutSym: String(c.memDim) }), { path: ['obj-ptrs', 'tpos'], out: 'ptr-tpos', where: WP, label: 'Proyección de la posición temporal (C → ' + c.memDim + ')', type: 'embed', group: 'embed', outMeta: { label: TP + 'posición temporal proyectada', tex: '\\mathrm{PE}(\\Delta t)W' } });
    const pp = g.op('op-tpos-rep', A.repeat_rows(tp, { k: c.ptrSplit, sym: c.ptrSplit + '·' + c.ptrs }), { path: ['obj-ptrs', 'tpos'], out: 'ptr-pos', where: WP, label: 'Repetir la posición para los ' + c.ptrSplit + ' tokens de cada puntero', type: 'tensorop', group: 'embed', outMeta: { label: TP + 'posición de cada token de puntero', tex: 'P_{\\mathrm{ptr}}' } });
    const pt = g.op('op-split', A.split_tokens(ptr, { parts: c.ptrSplit, sym: c.ptrSplit + '·' + c.ptrs, dSym: String(c.memDim) }), {
      path: ['obj-ptrs', 'split'], out: 'ptr-tokens', where: WP, label: 'Partir cada puntero (C) en ' + c.ptrSplit + ' tokens de ' + c.memDim, type: 'tensorop', group: 'embed',
      outMeta: { label: TP + c.ptrTokens + ' tokens de ' + c.memDim + ' (cada puntero de C = ' + c.C + ' → ' + c.ptrSplit + ' tokens)', tex: 'p\\to[p^{(1)}\\ldots p^{(' + c.ptrSplit + ')}]' },
    });
    const ms = c.nMem + '·N+' + c.ptrSplit + '·' + c.ptrs;
    const memory = g.op('mb-concat', A.concat_tokens(mem, pt, { sym: ms, mod: 'img' }), { path: ['memory-bank', 'concat'], out: 'memory', where: WB, label: 'Concatenar memorias espaciales y tokens de punteros', type: 'tensorop', group: 'embed', outMeta: { label: 'Memoria que lee el frame t (' + c.Nm + ' tokens de ' + c.memDim + ')', tex: 'M' } });
    const mp = g.op('mb-concat-pos', A.concat_tokens(tpos, pp, { sym: ms, mod: 'img' }), { path: ['memory-bank', 'concat'], out: 'memory-pos', where: WB, label: 'Concatenar las posiciones', type: 'tensorop', group: 'embed', outMeta: { label: TB + 'posición de cada token de memoria', tex: 'P_M' } });
    return { memory, mp };
  }

  function memoryAttention(g, c, feat, pos, memory, mpos) {
    const WM = ['Memory attention'], TM = 'Memory attention · ';
    const x0 = g.op('ma-in', A.add(feat, pos), { path: ['memory-attn', 'in'], out: 'ma-x0', where: WM, label: 'Entrada: rasgos + 0.1 · posición', type: 'tensorop', group: 'embed', outMeta: { label: TM + 'rasgos del frame + 0.1·posición', tex: 'F + 0.1\\,P' } });
    const rep = c.Lmem, B = ['memory-attn'];
    const L = (m, tl) => Object.assign({ perLayer: true }, m, { label: tl + m.label });
    const op = (id, res, path, where, extra) => g.op(id, res, Object.assign({ path: B.concat(path), repeat: rep, where }, extra));
    const TS = TM + 'self-attention · ', WS = ['Memory attention', 'self-attention (RoPE)'];
    const n1 = op('ma-ln1', A.layernorm(x0), ['self-attn', 'ln'], WS, { out: 'ma-n1', label: 'LayerNorm 1 (pre-LN)', type: 'norm', group: 'norm', outMeta: L({ label: 'entrada normalizada', tex: '\\mathrm{LN}_1(x)' }, TS) });
    const so = attnOps({ g, pre: 'ma-self-', tpre: 'ma-self-', P: B.concat(['self-attn']), rep, where: WS, tl: TS, qIn: n1, kIn: n1, vIn: n1, inner: c.C, innerSym: 'C', h: c.hMem, hSym: String(c.hMem), dhSym: 'C', outD: c.C, outSym: 'C', rope: {} });
    const r1 = op('ma-res1', A.residual_add(x0, so), ['self-attn', 'res'], WS, { out: 'ma-r1', label: 'Residual 1', type: 'tensorop', group: 'resid', outMeta: L({ label: 'x + self-attention', tex: "x'" }, TS) });
    const TC = TM + 'cross-attention a la memoria · ', WC = ['Memory attention', 'cross-attention a la memoria'];
    const n2 = op('ma-ln2', A.layernorm(r1), ['cross-mem', 'ln'], WC, { out: 'ma-n2', label: 'LayerNorm 2', type: 'norm', group: 'norm', outMeta: L({ label: 'queries normalizadas', tex: "\\mathrm{LN}_2(x')" }, TC) });
    const kin = op('ma-add-mpos', A.add(memory, mpos), ['cross-mem', 'add-pos'], WC, { out: 'ma-kin', label: 'Keys = memoria + posición (en cada capa)', type: 'tensorop', group: 'embed', outMeta: L({ label: 'keys de memoria (+ posición espacial y temporal)', tex: 'M + P_M' }, TC) });
    const co = attnOps({ g, pre: 'ma-cross-', tpre: 'ma-cross-', P: B.concat(['cross-mem']), rep, where: WC, tl: TC, qIn: n2, kIn: kin, vIn: memory, inner: c.C, innerSym: 'C', h: c.hMem, hSym: String(c.hMem), dhSym: 'C', outD: c.C, outSym: 'C',
      kNote: ' (' + c.memDim + ' → C, sobre los ' + c.Nm + ' tokens de memoria)', vNote: ' (' + c.memDim + ' → C)', rope: { kExclude: c.ptrTokens, kRepeat: c.nMem } });
    const r2 = op('ma-res2', A.residual_add(r1, co), ['cross-mem', 'res'], WC, { out: 'ma-r2', label: 'Residual 2', type: 'tensorop', group: 'resid', outMeta: L({ label: "x' + lo leído de la memoria", tex: "x''" }, TC) });
    const TF = TM + 'MLP · ', WF = ['Memory attention', 'MLP'];
    const n3 = op('ma-ln3', A.layernorm(r2), ['mlp', 'ln'], WF, { out: 'ma-n3', label: 'LayerNorm 3', type: 'norm', group: 'norm', outMeta: L({ label: 'entrada normalizada del MLP', tex: "\\mathrm{LN}_3(x'')" }, TF) });
    const u = op('ma-fc1', A.linear(n3, { dout: c.Dmlp, doutSym: 'D_mlp' }), ['mlp', 'fc1'], WF, { out: 'ma-u', label: 'MLP: capa 1 (C → D_mlp)', type: 'mlp', group: 'mlp', outMeta: L({ label: 'capa oculta del MLP', tex: 'U' }, TF) });
    const ua = op('ma-relu', A.relu(u), ['mlp', 'relu'], WF, { out: 'ma-a', label: 'ReLU', type: 'mlp', group: 'mlp', outMeta: L({ label: 'activación ReLU', tex: '\\mathrm{ReLU}(U)' }, TF) });
    const f = op('ma-fc2', A.linear(ua, { dout: c.C, doutSym: 'C' }), ['mlp', 'fc2'], WF, { out: 'ma-f', label: 'MLP: capa 2 (D_mlp → C)', type: 'mlp', group: 'mlp', outMeta: L({ label: 'salida del MLP', tex: 'F' }, TF) });
    const out = op('ma-res3', A.residual_add(r2, f), ['mlp', 'res'], WF, { out: 'ma-out', label: 'Residual 3', type: 'tensorop', group: 'resid', outMeta: { label: TM + 'salida de la capa', tex: 'x_\\ell', perLayer: false, note: 'Salida de cada capa; tras la capa 4 va a la LayerNorm final.' } });
    const WO = ['Memory attention', 'LayerNorm final'];
    const nm = g.op('ma-norm', A.layernorm(out), { path: ['memory-attn', 'out-norm'], out: 'pix-mem-seq', where: WO, label: 'LayerNorm final', type: 'norm', group: 'norm', outMeta: { label: TM + 'rasgos condicionados por la memoria (secuencia)', tex: '\\tilde F' } });
    const grid = g.op('ma-grid', A.to_grid(nm, { H: c.G, W: c.G, sym: ['H/16', 'W/16'] }), { path: ['memory-attn', 'out-norm'], out: 'pix-mem', where: WO, label: 'Secuencia → rejilla', type: 'tensorop', group: 'embed', outMeta: { label: 'Rasgos del frame condicionados por la memoria (' + c.G + '×' + c.G + '×C)', tex: '\\tilde F_{16}' } });
    idleOp(g, 'ma-no-mem-idle', ['memory-attn', 'no-mem'], [[c.C], [c.C]], 'no_mem_embed y no_mem_pos_enc (el primer frame con prompt, sin memoria)', ['Memory attention']);
    return grid;
  }

  function memoryEncoder(g, c, best, s16, objScore) {
    const TE = 'Memory encoder · ';
    const op = (id, res, node, where, extra) => g.op(id, res, Object.assign({ path: ['memory-encoder', node, id.replace(/^me-/, '')], where }, extra));
    const WP = ['Memory encoder', 'máscara de entrada'];
    const hr = op('me-up', A.upsample_bilinear(best, { H: c.H, W: c.W, outSym: ['H', 'W'] }), 'mask-prep', WP, { out: 'mask-hr', label: 'Interpolar la mejor máscara a ' + c.H + '×' + c.W + ' (bilineal)', type: 'tensorop', group: 'embed', outMeta: { label: TE + 'máscara (logits) a resolución completa', tex: 'm_{\\uparrow}' } });
    const pr = op('me-sigmoid', A.sigmoid(hr), 'mask-prep', WP, { out: 'mask-prob', label: 'Sigmoide', type: 'tensorop', group: 'embed', outMeta: { label: TE + 'probabilidad de la máscara', tex: '\\sigma(m)' } });
    let x = op('me-scale', A.scale(pr, { factor: 20, bias: -10 }), 'mask-prep', WP, { out: 'mask-mem-in', label: 'Escala ×20 y sesgo −10', type: 'tensorop', group: 'embed', outMeta: { label: TE + 'máscara reescalada (20·σ − 10)', tex: '20\\,\\sigma(m) - 10' } });
    const WD = ['Memory encoder', 'downsampler de la máscara (÷16)'];
    const ch = c.dsChannels;
    for (let i = 1; i < ch.length; i++) {
      const f = Math.pow(2, i), sym = ['H/' + f, 'W/' + f];
      x = op('me-ds' + i + '-conv', A.conv2d(x, { k: 3, s: 2, p: 1, cout: ch[i], coutSym: String(ch[i]), outSym: sym, floor: true }), 'downsampler', WD, { out: 'me-ds' + i + '-c', label: 'Conv ' + i + ': 3×3 stride 2, ' + ch[i - 1] + ' → ' + ch[i] + ' canales', type: 'conv', group: 'embed', outMeta: { label: TE + 'máscara reducida ÷' + f, tex: 'm_' + i } });
      x = op('me-ds' + i + '-ln', A.layernorm(x), 'downsampler', WD, { out: 'me-ds' + i + '-n', label: 'LayerNorm2d ' + i + ' (' + ch[i] + ' canales)', type: 'norm', group: 'norm', outMeta: { label: TE + 'máscara reducida ÷' + f + ', normalizada', tex: '\\mathrm{LN}(m_' + i + ')' } });
      x = op('me-ds' + i + '-gelu', A.gelu(x), 'downsampler', WD, { out: 'me-ds' + i + '-a', label: 'GELU ' + i, type: 'mlp', group: 'embed', outMeta: { label: TE + 'máscara reducida ÷' + f + ', activada', tex: '\\mathrm{GELU}(\\cdot)' } });
    }
    const mm = op('me-ds-final', A.conv2d(x, { k: 1, cout: c.C, coutSym: 'C', outSym: ['H/16', 'W/16'] }), 'downsampler', WD, { out: 'mem-mask', label: 'Conv 1×1 (' + ch[ch.length - 1] + ' → C)', type: 'conv', group: 'embed', outMeta: { label: TE + 'máscara embebida (stride 16)', tex: 'D_m' } });
    const WF = ['Memory encoder', 'fusión rasgos + máscara'];
    const pix = op('me-pix-proj', A.conv2d(s16, { k: 1, cout: c.C, coutSym: 'C', outSym: ['H/16', 'W/16'] }), 'fuse', WF, { out: 'mem-pix', label: 'Conv 1×1 de los rasgos del frame (los del codificador, sin la memoria)', type: 'conv', group: 'embed', outMeta: { label: TE + 'rasgos del frame proyectados', tex: 'W_p * F_{16}' } });
    let y = op('me-add', A.add(pix, mm), 'fuse', WF, { out: 'mem-fuse-in', label: 'Sumar rasgos y máscara', type: 'tensorop', group: 'embed', outMeta: { label: TE + 'rasgos + máscara', tex: 'W_p * F + D_m' } });
    const WX = ['Memory encoder', 'fuser (' + c.fuserLayers + ' bloques ConvNeXt)'], TX = TE + 'fuser · ';
    const L = (m) => Object.assign({ perLayer: true }, m, { label: TX + m.label });
    const xop = (id, res, extra) => g.op(id, res, Object.assign({ path: ['memory-encoder', 'fuser', id.replace(/^me-cx-/, '')], repeat: c.fuserLayers, where: WX }, extra));
    const dw = xop('me-cx-dw', A.depthwise_conv2d(y, { k: c.fuserK }), { out: 'me-cx-d', label: 'Conv depthwise ' + c.fuserK + '×' + c.fuserK, type: 'conv', group: 'embed', outMeta: L({ label: 'conv depthwise', tex: '\\mathrm{dw}(y)' }) });
    const dn = xop('me-cx-ln', A.layernorm(dw), { out: 'me-cx-n', label: 'LayerNorm2d', type: 'norm', group: 'norm', outMeta: L({ label: 'normalizado', tex: '\\mathrm{LN}(\\cdot)' }) });
    const pu = xop('me-cx-pw1', A.linear(dn, { dout: c.fuserRatio * c.C, doutSym: mulSym(c.fuserRatio, 'C') }), { out: 'me-cx-u', label: 'Pointwise 1 (C → 4C)', type: 'mlp', group: 'mlp', outMeta: L({ label: 'expansión pointwise', tex: 'U' }) });
    const pg = xop('me-cx-gelu', A.gelu(pu), { out: 'me-cx-g', label: 'GELU', type: 'mlp', group: 'mlp', outMeta: L({ label: 'activación GELU', tex: '\\mathrm{GELU}(U)' }) });
    const pw = xop('me-cx-pw2', A.linear(pg, { dout: c.C, doutSym: 'C' }), { out: 'me-cx-f', label: 'Pointwise 2 (4C → C)', type: 'mlp', group: 'mlp', outMeta: L({ label: 'proyección pointwise', tex: 'F' }) });
    const gm = xop('me-cx-gamma', A.layer_scale(pw, { init: 1e-6 }), { out: 'me-cx-s', label: 'Layer scale γ (init 1e-6)', type: 'tensorop', group: 'mlp', outMeta: L({ label: 'escalado por γ', tex: '\\gamma\\odot F' }) });
    y = xop('me-cx-res', A.residual_add(y, gm), { out: 'mem-fused', label: 'Residual', type: 'tensorop', group: 'resid', outMeta: { label: TE + 'rasgos fusionados', tex: 'y_\\ell', perLayer: false } });
    const WO = ['Memory encoder', 'salida'];
    const pj = op('me-proj', A.conv2d(y, { k: 1, cout: c.memDim, coutSym: String(c.memDim), outSym: ['H/16', 'W/16'] }), 'out', WO, { out: 'mem-new', label: 'Conv 1×1 (C → ' + c.memDim + ')', type: 'conv', group: 'embed', outMeta: { label: TE + 'memoria del frame (antes de la oclusión)', tex: 'm_t' } });
    const mo = op('me-occl', A.gate_embed(pj, { mode: 'add' }), 'out', WO, { in: ['mem-new', objScore.id], out: 'mem-out', label: 'Sumar el embedding de oclusión si el objeto no aparece', type: 'tensorop', group: 'embed', outMeta: { label: 'Memoria nueva del frame t (' + c.G + '×' + c.G + '×' + c.memDim + ', entra al banco)', tex: 'm_t' } });
    op('me-pos', A.sine_pos_encoding({ H: c.G, W: c.G, D: c.memDim, rowsSym: 'N', Dsym: String(c.memDim) }), 'out', WO, { out: 'mem-out-pos', label: 'PE seno/coseno de la memoria (buffer; se guarda con ella)', type: 'embed', group: 'embed', outMeta: { label: TE + 'posición de la memoria nueva', tex: 'P_{m_t}' } });
    return mo;
  }

  A.defineModel({
    id: 'sam2',
    label: 'SAM 2',
    paper: { title: 'SAM 2: Segment Anything in Images and Videos', authors: 'Ravi et al.', venue: 'ICLR 2025', year: 2025, arxiv: '2408.00714', code: 'github.com/facebookresearch/sam2' },
    configs: {
      'sam2-hiera-l': Object.assign({}, SAM2_BASE, { label: 'SAM 2 Hiera-L @ 1024', size: 'L', H: 1024, W: 1024, D: 144, h: 2, depths: [2, 6, 36, 4], globals: [23, 33, 43], windows: [8, 4, 16, 8], bkg: 7, canonical: true,
        source: 'Ravi et al. 2024/2025 (SAM 2) y configs/sam2.1/sam2.1_hiera_l.yaml oficial (embed_dim 144, 2 cabezas, stages [2, 6, 36, 4], bloques globales [23, 33, 43], window_spec [8, 4, 16, 8], fondo de posición 7×7; FPN [1152, 576, 288, 144] → 256; memory attention 4 capas; num_maskmem 7; 16 punteros); cross-check HF Sam2VideoModel(Sam2VideoConfig(...))' }),
      'sam2-hiera-bplus': Object.assign({}, SAM2_BASE, { label: 'SAM 2 Hiera-B+ @ 1024', size: 'B+', H: 1024, W: 1024, D: 112, h: 2, depths: [2, 3, 16, 3], globals: [12, 16, 20], windows: [8, 4, 14, 7], bkg: 14,
        source: 'configs/sam2.1/sam2.1_hiera_b+.yaml oficial (embed_dim 112, 2 cabezas; stages, bloques globales, ventanas y fondo 14×14 por defecto de Hiera: [2, 3, 16, 3], [12, 16, 20], [8, 4, 14, 7]); cross-check HF Sam2VideoModel' }),
      'sam2-hiera-s': Object.assign({}, SAM2_BASE, { label: 'SAM 2 Hiera-S @ 1024', size: 'S', H: 1024, W: 1024, D: 96, h: 1, depths: [1, 2, 11, 2], globals: [7, 10, 13], windows: [8, 4, 14, 7], bkg: 7,
        source: 'configs/sam2.1/sam2.1_hiera_s.yaml oficial (embed_dim 96, 1 cabeza, stages [1, 2, 11, 2], bloques globales [7, 10, 13], fondo 7×7; ventanas por defecto [8, 4, 14, 7]); cross-check HF Sam2VideoModel' }),
      'sam2-hiera-t': Object.assign({}, SAM2_BASE, { label: 'SAM 2 Hiera-T @ 1024', size: 'T', H: 1024, W: 1024, D: 96, h: 1, depths: [1, 2, 7, 2], globals: [5, 7, 9], windows: [8, 4, 14, 7], bkg: 7,
        source: 'configs/sam2.1/sam2.1_hiera_t.yaml oficial (embed_dim 96, 1 cabeza, stages [1, 2, 7, 2], bloques globales [5, 7, 9], fondo 7×7; ventanas por defecto [8, 4, 14, 7]); cross-check HF Sam2VideoModel' }),
    },
    knobs: { res: [512, 768, 1024], memFrames: [1, 2, 4, 6, 8], ptrs: [1, 4, 8, 16] },
    applyKnobs(c, ov) { return sam2ApplyKnobs(c, ov); },
    resolve(c) { return sam2Resolve(c); },

    build(c, A) {
      const g = A.graph(c);
      const outs = hieraEncoder(g, c);
      const fpn = fpnNeck(g, c, outs);
      const WR = ['Decoder de máscaras', 'rasgos de alta resolución'];
      const s0 = g.op('hr-s0', A.conv2d(fpn.s4, { k: 1, cout: c.C / 8, coutSym: 'C/8', outSym: ['H/4', 'W/4'] }), { path: ['mask-decoder', 'hires', 's0'], out: 'feat-s0', where: WR, label: 'Conv 1×1 de los rasgos de stride 4 (C → C/8; una vez por frame)', type: 'conv', group: 'embed', outMeta: { label: 'Decoder de máscaras · rasgos de alta resolución, stride 4', tex: 'f_{s0}' } });
      const s1 = g.op('hr-s1', A.conv2d(fpn.s8, { k: 1, cout: c.C / 4, coutSym: 'C/4', outSym: ['H/8', 'W/8'] }), { path: ['mask-decoder', 'hires', 's1'], out: 'feat-s1', where: WR, label: 'Conv 1×1 de los rasgos de stride 8 (C → C/4; una vez por frame)', type: 'conv', group: 'embed', outMeta: { label: 'Decoder de máscaras · rasgos de alta resolución, stride 8', tex: 'f_{s1}' } });
      const { memory, mp } = memoryBank(g, c);
      const pix = memoryAttention(g, c, fpn.seq, fpn.pos, memory, mp);
      const { sparse, dense, ipe } = promptEncoder(g, c, 'sam2');
      const dec = maskDecoder(g, c, pix, ipe, sparse, dense, 'sam2', { s0, s1 });
      // Cabeza de oclusión: ¿aparece el objeto en este frame?
      const WO = ['Cabeza de oclusión'];
      const ot = g.op('oc-take', A.take_rows(dec.tokOut, { start: 0, count: 1, vec: true }), { path: ['occlusion', 'take'], out: 'obj-tok', where: WO, label: 'Tomar el token de objeto', type: 'tensorop', group: 'head', outMeta: { label: 'Cabeza de oclusión · token de objeto a la salida del transformer', tex: 't_{\\mathrm{obj}}' } });
      const os = ffn3({ g, pre: 'oc-', tpre: 'oc-', P: ['occlusion'], where: WO, tl: 'Cabeza de oclusión · ', dims: [c.C, c.C, 1], syms: ['C', 'C', '1'], outId: 'obj-score', outLabel: 'Score de objeto (logit: > 0 = el objeto aparece)', outTex: 's_{\\mathrm{obj}}' }, ot);
      const SEL = ['Decoder de máscaras', 'selección multimask'];
      const best = g.op('md-pick', A.pick_mask(dec.masks, dec.iou), { path: ['mask-decoder', 'select', 'pick'], out: 'best-mask', where: SEL, label: 'Elegir la máscara de mayor IoU predicho', type: 'tensorop', group: 'head', outMeta: { label: 'Máscara del frame t (la de mayor IoU, logits ' + 4 * c.G + '×' + 4 * c.G + ')', tex: '\\hat m_t' } });
      // Puntero de objeto del frame t (del token de la máscara elegida).
      const WP = ['Punteros de objeto', 'puntero del frame t'];
      const bt = g.op('op-take', A.take_rows(dec.tokOut, { start: 3, count: 1, vec: true }), { path: ['obj-ptrs', 'take'], out: 'best-tok', where: WP, label: 'Tomar el token de la máscara elegida', type: 'tensorop', group: 'head', outMeta: { label: 'Punteros de objeto · token de la máscara elegida', tex: 't_{\\hat k}' } });
      const raw = ffn3({ g, pre: 'pp-', tpre: 'pp-', P: ['obj-ptrs', 'ptr-proj'], where: WP, tl: 'Punteros de objeto · MLP · ', dims: [c.C, c.C, c.C], syms: ['C', 'C', 'C'], outId: 'ptr-raw', outLabel: 'Punteros de objeto · puntero antes de la oclusión', outTex: 'p_t' }, bt);
      g.op('op-gate', A.gate_embed(raw, { mode: 'replace' }), { path: ['obj-ptrs', 'gate'], in: ['ptr-raw', os.id], out: 'obj-ptr', where: WP, label: 'Si el objeto no aparece, el puntero pasa a ser el vector aprendido "no objeto"', type: 'tensorop', group: 'head', outMeta: { label: 'Puntero de objeto del frame t (entra al banco)', tex: 'p_t' } });
      memoryEncoder(g, c, best, fpn.s16, os);
      return g;
    },

    quantities(c, r) { return sam2Quantities(c, r); },
    metrics(c, r, o) { return sam2Metrics(c, r, o); },
  });

  function sam2Quantities(c, r) {
    const n = r.totals.byNode, by = r.totals.byPath;
    const hires = by['mask-decoder>hires'];
    const q = {
      tokens: c.N, N: c.N, G: c.G, res: c.H, H: c.H, D: c.D, h: c.h, dh: c.dh, L: c.L, C: c.C, Cout: c.Cout, memDim: c.memDim,
      depths: c.depthsStr, globals: c.globalsStr, windows: c.windowsStr, bkg: c.bkg,
      memFrames: c.memFrames, condFrames: c.condFrames, nMem: c.nMem, numMaskmem: c.numMaskmem, ptrs: c.ptrs, maxPtrs: c.maxPtrs,
      memTokens: c.memTokens, ptrTokens: c.ptrTokens, Nm: c.Nm, ptrSplit: c.ptrSplit, Lmem: c.Lmem, Dmlp: c.Dmlp, nTok: c.nTok,
      imgEncoderParams: n['img-encoder'].params, fpnParams: n.fpn.params, hieraFpnParams: n['img-encoder'].params + n.fpn.params,
      memAttnParams: n['memory-attn'].params, memEncoderParams: n['memory-encoder'].params, memBankParams: n['memory-bank'].params,
      objPtrParams: n['obj-ptrs'].params, promptEncParams: n['prompt-enc'].params, maskDecoderParams: n['mask-decoder'].params, occlusionParams: n.occlusion.params,
      decoderParams: n['prompt-enc'].params + n['mask-decoder'].params + n.occlusion.params,
      imgEncoderMacs: n['img-encoder'].macs + n.fpn.macs + hires.macs, hieraMacs: n['img-encoder'].macs, fpnMacs: n.fpn.macs, hiresMacs: hires.macs,
      memAttnMacs: n['memory-attn'].macs + by['obj-ptrs>tpos'].macs, memEncoderMacs: n['memory-encoder'].macs,
      decoderMacs: n['prompt-enc'].macs + n['mask-decoder'].macs - hires.macs + n.occlusion.macs, objPtrMacs: by['obj-ptrs>ptr-proj'].macs,
      memAttnLayerParams: (by['memory-attn>self-attn'].params + by['memory-attn>cross-mem'].params + by['memory-attn>mlp'].params) / c.Lmem,
      tposParams: c.numMaskmem * c.memDim,
    };
    c.stages.forEach((st) => {
      const p = 's' + st.k;
      q[p + 'Res'] = st.side; q[p + 'C'] = st.C; q[p + 'Heads'] = st.h; q[p + 'Depth'] = st.depth; q[p + 'Window'] = st.ws; q[p + 'Globals'] = st.globalBlocks;
      q[p + 'Params'] = by['img-encoder>stage' + st.k].params; q[p + 'Macs'] = by['img-encoder>stage' + st.k].macs;
    });
    return q;
  }

  function sam2Metrics(c, r, o) {
    const q = r.quantities, t = r.totals, by = o.by, B = o.B;
    const sc = (pre) => r.ops.filter((x) => x.id.startsWith(pre) && (x.prim === 'attention_scores' || x.prim === 'attention_weighted_sum')).reduce((s, x) => s + x.macs * x.repeat, 0);
    const feat = c.N * c.memDim * by * B, ptrB = c.C * by * B;
    const ref = (id) => { try { return A.run(id); } catch (e) { return null; } };
    const samH = ref('sam-vit-h-1024');
    const base = { res: c.H, memFrames: c.memFrames, ptrs: c.ptrs };
    const at = (ov) => A.run(r.id, Object.assign({}, base, ov));
    const out = {
      crossoverN: null, crossoverNProj: null, scoreToLinear: null,
      frameMacs: t.macs,
      imgEncoderMacs: q.imgEncoderMacs, imgEncoderMacsShare: q.imgEncoderMacs / t.macs,
      hieraMacs: q.hieraMacs, fpnMacs: q.fpnMacs, hiresMacs: q.hiresMacs,   // imgEncoderMacs = Hiera + FPN + conv_s0/s1 (compartidos entre objetos)
      memAttnMacs: q.memAttnMacs, memAttnMacsShare: q.memAttnMacs / t.macs,
      memEncoderMacs: q.memEncoderMacs, memEncoderMacsShare: q.memEncoderMacs / t.macs,
      decoderMacs: q.decoderMacs, decoderMacsShare: q.decoderMacs / t.macs, objPtrMacs: q.objPtrMacs,
      // por objeto seguido y frame: todo menos el codificador de imagen (Hiera + FPN + conv_s0/s1 se comparten entre objetos)
      perObjectMacs: t.macs - q.imgEncoderMacs, perObjectMacsShare: (t.macs - q.imgEncoderMacs) / t.macs,
      firstFrameMacs: t.macs - q.memAttnMacs,               // el frame con prompt inicial: sin memoria (no_mem_embed)
      memCrossScoreMacs: sc('ma-cross-'), memSelfScoreMacs: sc('ma-self-'),
      memCrossAttnMem: c.hMem * c.N * c.Nm * by * B, memSelfAttnMem: c.hMem * c.N * c.N * by * B,
      memTokens: c.Nm, spatialMemTokens: c.memTokens, ptrTokens: c.ptrTokens, memFramesUsed: c.nMem, ptrsUsed: c.ptrs,
      // banco de memoria (lo que se guarda entre frames, por objeto)
      memPerFrameMem: feat, memBankFeatMem: c.nMem * feat, memBankPosMem: c.nMem * feat, memBankPtrMem: c.ptrs * ptrB,
      memoryBankMem: 2 * c.nMem * feat + c.ptrs * ptrB, memToImgEmb: c.memDim / c.C,
      imgEmbMem: c.N * c.C * by * B,
      hieraGlobalBlocks: c.stages.reduce((s, st) => s + st.globalBlocks, 0), hieraBlocks: c.L,
      units: SAM2_UNITS,
    };
    if (samH) Object.assign(out, { samHMacs: samH.totals.macs, frameVsSamH: t.macs / samH.totals.macs, imgEncoderVsSamH: q.imgEncoderMacs / samH.quantities.encoderMacs, paramsVsSamH: t.params / samH.totals.params });
    out.memScaling = [1, 2, 4, 6, 8].map((N) => {
      const m = N === c.memFrames ? r : at({ memFrames: N }), mc = m.config;
      return { memFrames: N, memTokens: mc.Nm, macs: m.totals.macs, memAttnMacs: m.quantities.memAttnMacs, memCrossAttnMem: c.hMem * c.N * mc.Nm * by * B, memoryBankMem: 2 * mc.nMem * feat + mc.ptrs * ptrB };
    });
    out.objScaling = [1, 2, 4, 8].map((k) => ({ objects: k, macs: q.imgEncoderMacs + k * out.perObjectMacs }));
    out.ptrScaling = [1, 4, 8, 16].map((P) => { const m = P === c.ptrs ? r : at({ ptrs: P }); return { ptrs: P, memTokens: m.config.Nm, memAttnMacs: m.quantities.memAttnMacs }; });
    out.stages = c.stages.map((st) => ({
      k: st.k, side: st.side, tokens: st.side * st.side, C: st.C, h: st.h, depth: st.depth, window: st.ws, globalBlocks: st.globalBlocks,
      winScoreMacs: 2 * Math.pow(Math.ceil(st.side / st.ws), 2) * Math.pow(st.ws, 4) * st.C, globalScoreMacs: 2 * Math.pow(st.side, 4) * st.C,
      winAttnMem: Math.pow(Math.ceil(st.side / st.ws), 2) * st.h * Math.pow(st.ws, 4) * by * B, globalAttnMem: st.h * Math.pow(st.side, 4) * by * B,
    }));
    return out;
  }

  const SAM2_UNITS = {
    frameMacs: 'macs', perObjectMacs: 'macs', imgEncoderMacs: 'macs', memAttnMacs: 'macs', memEncoderMacs: 'macs', decoderMacs: 'macs', objPtrMacs: 'macs', firstFrameMacs: 'macs',
    memCrossScoreMacs: 'macs', memSelfScoreMacs: 'macs', samHMacs: 'macs', hieraMacs: 'macs', fpnMacs: 'macs', hiresMacs: 'macs',
    imgEncoderMacsShare: 'pct', perObjectMacsShare: 'pct', memAttnMacsShare: 'pct', memEncoderMacsShare: 'pct', decoderMacsShare: 'pct',
    memCrossAttnMem: 'bytes', memSelfAttnMem: 'bytes', memPerFrameMem: 'bytes', memBankFeatMem: 'bytes', memBankPosMem: 'bytes', memBankPtrMem: 'bytes',
    memoryBankMem: 'bytes', imgEmbMem: 'bytes',
    memToImgEmb: 'ratio', frameVsSamH: 'ratio', imgEncoderVsSamH: 'ratio', paramsVsSamH: 'ratio',
    memTokens: 'count', spatialMemTokens: 'count', ptrTokens: 'count', memFramesUsed: 'count', ptrsUsed: 'count', hieraGlobalBlocks: 'count', hieraBlocks: 'count',
  };
})(typeof window !== 'undefined' ? window : globalThis);
