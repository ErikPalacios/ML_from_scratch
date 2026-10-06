/* =============================================================================
   Atlas de Arquitecturas — js/arch/vit.js
   Modelo `vit` (Dosovitskiy et al., ICLR 2021, arXiv:2010.11929). Configs, knobs (res, P) y build().
   Contrato de ids (SPEC §13.1). Ids de operación y su path de nodos de diagrama:

   Vista general `vit-overview` (+ `vit-patch-embed`, que usa los nodos `conv` y `flatten`):
     op patch-embed   path patch-embed › conv      x-img → x-patch-grid       (conv P×P, stride P)
     op patch-flatten path patch-embed › flatten   x-patch-grid → x-patches
     op cls           path cls                      x-patches → x-cls-cat      (antepone el token CLS)
     op pos-embed     path pos-embed                → e-pos                    (tabla aprendida (N+1)×D)
     op add-pos       path add-pos                  x-cls-cat, e-pos → x0
   Capa `vit-enc-layer` (repeat L; path encoder › enc-layer › …):
     ln1 (h-ln1) · mhsa › {qkv (qkv), split (q,k,v), scores (scores), scale (scores-scaled),
     softmax (attn), weighted-sum (z-heads), merge (z), proj (o)} · res1 (r1) · ln2 (h-ln2) ·
     mlp › {fc1 (u), gelu (g), fc2 (f)} · res2 (x-out)
     `vit-mlp` (expandido) usa los nodos `fc1`, `gelu`, `fc2`.
   Cabeza: final-ln (x-ln) · pool-cls (cls-out) · head (logits).
   Tensores añadidos a la lista de §13.1 (no la cambian): `e-pos` (tabla de posición, para la arista
   pos-embed → add-pos) y `scores-scaled` (salida del nodo `scale`, arista scale → softmax).

   Interpolación de posición: si el knob `res` (o `P`) cambia, N cambia y la tabla aprendida se
   interpola (bicúbica, como al hacer fine-tuning a 384): sus parámetros pasan a (N+1)·D. El
   resultado lo anota en `notes`.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const A = ATLAS.Arch;
  if (!A || !A.defineModel) throw new Error('vit.js necesita js/arch/primitives.js antes.');

  const base = { C: 3, K: 1000, qkvBias: true, projBias: true, mlpBias: true, act: 'gelu', pool: 'cls', preLN: true };
  const cfg = (o) => Object.assign({}, base, o);

  A.defineModel({
    id: 'vit',
    label: 'ViT — Vision Transformer',
    paper: {
      title: 'An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale',
      authors: 'Dosovitskiy et al.', venue: 'ICLR 2021', year: 2021, arxiv: '2010.11929',
    },
    configs: {
      'vit-b16-224': cfg({ label: 'ViT-B/16 @ 224', H: 224, W: 224, P: 16, D: 768, L: 12, h: 12, Dmlp: 3072, canonical: true,
        timm: 'vit_base_patch16_224',
        source: 'Dosovitskiy et al. 2021, Tabla 1 (ViT-Base); cabeza de 1000 clases como timm vit_base_patch16_224' }),
      'vit-s16-224': cfg({ label: 'ViT-S/16 @ 224', H: 224, W: 224, P: 16, D: 384, L: 12, h: 6, Dmlp: 1536,
        timm: 'vit_small_patch16_224',
        source: 'DeiT (Touvron et al., ICML 2021, arXiv:2012.12877), DeiT-S; timm vit_small_patch16_224' }),
      'vit-l16-224': cfg({ label: 'ViT-L/16 @ 224', H: 224, W: 224, P: 16, D: 1024, L: 24, h: 16, Dmlp: 4096,
        timm: 'vit_large_patch16_224',
        source: 'Dosovitskiy et al. 2021, Tabla 1 (ViT-Large); timm vit_large_patch16_224' }),
      'vit-h14-224': cfg({ label: 'ViT-H/14 @ 224', H: 224, W: 224, P: 14, D: 1280, L: 32, h: 16, Dmlp: 5120,
        timm: 'vit_huge_patch14_224',
        source: 'Dosovitskiy et al. 2021, Tabla 1 (ViT-Huge); timm vit_huge_patch14_224' }),
      'vit-b16-384': cfg({ label: 'ViT-B/16 @ 384', H: 384, W: 384, P: 16, D: 768, L: 12, h: 12, Dmlp: 3072,
        timm: 'vit_base_patch16_384',
        source: 'Dosovitskiy et al. 2021 (ViT-Base con fine-tuning a 384); timm vit_base_patch16_384' }),
      'vit-b32-224': cfg({ label: 'ViT-B/32 @ 224', H: 224, W: 224, P: 32, D: 768, L: 12, h: 12, Dmlp: 3072,
        timm: 'vit_base_patch32_224',
        source: 'Dosovitskiy et al. 2021, Tabla 1 (ViT-Base, parches de 32); timm vit_base_patch32_224' }),
    },
    // Valores sugeridos para el explorador; se acepta cualquier entero con res divisible por P.
    knobs: { res: [224, 384, 448, 512], P: [8, 14, 16, 32] },

    applyKnobs(c, ov) {
      const notes = [];
      const N0 = (c.H / c.P) * (c.W / c.P), P0 = c.P;
      if (ov.res !== undefined) { c.H = ov.res; c.W = ov.res; }
      if (ov.P !== undefined) c.P = ov.P;
      if (c.H % c.P !== 0 || c.W % c.P !== 0) {
        throw new Error('La resolución ' + c.H + '×' + c.W + ' no es divisible por el tamaño de parche P = ' + c.P + '.');
      }
      const N = (c.H / c.P) * (c.W / c.P);
      if (ov.P !== undefined && ov.P !== P0) {
        notes.push('Cambiar P cambia también el kernel del patch embedding (P²·C·D parámetros); un modelo entrenado con otro P necesita re-muestrear ese kernel (FlexiViT) o reentrenarse.');
      }
      if (N !== N0) {
        notes.push('Position embeddings interpolados: de (N+1)×D = ' + (N0 + 1) + '×' + c.D + ' a ' + (N + 1) + '×' + c.D +
          ' (bicúbica en la rejilla 2D; el CLS se conserva). Los parámetros de posición pasan a (N+1)·D = ' + A.fmt.int((N + 1) * c.D) + '.');
        c.posInterpolatedFrom = N0 + 1;
      }
      c._notes = notes;
      if (ov.res !== undefined || ov.P !== undefined) c.label = 'ViT-' + labelSize(c.D) + '/' + c.P + ' @ ' + c.H;
      return c;
    },

    resolve(c) {
      if (c.D % c.h !== 0) throw new Error('D = ' + c.D + ' no es divisible por h = ' + c.h + '.');
      c.res = c.H;
      c.gridH = c.H / c.P; c.gridW = c.W / c.P;
      c.N = c.gridH * c.gridW;           // parches
      c.tokens = c.N + 1;                // + CLS
      c.dh = c.D / c.h;
      c.patchDim = c.P * c.P * c.C;      // P²·C
      return c;
    },

    build(c, A) {
      const g = A.graph(c);
      const img = g.input('x-img', A.shape(['H', 'W', 'C'], [c.H, c.W, c.C], 'img', 'grid'), { label: 'Imagen de entrada', tex: 'x' });

      const grid = g.op('patch-embed', A.conv2d(img, { k: c.P, s: c.P, cout: c.D, coutSym: 'D', kSym: 'P', outSym: ['H/P', 'W/P'], bias: true, macTex: 'N\\cdot D\\cdot P^2\\cdot C' }), {
        path: ['patch-embed', 'conv'], out: 'x-patch-grid', label: 'Patch embedding (conv P×P, stride P)', type: 'conv', group: 'embed',
        outMeta: { label: 'Rejilla de parches embebidos', tex: 'X_{\\mathrm{grid}}' },
      });
      const xp = g.op('patch-flatten', A.flatten(grid, { sym: ['N', 'D'] }), {
        path: ['patch-embed', 'flatten'], out: 'x-patches', label: 'Aplanar la rejilla en secuencia', type: 'tensorop', group: 'embed',
        outMeta: { label: 'Patches embebidos', tex: 'X_p E' },
      });
      const xc = g.op('cls', A.cls_token(xp, { outSym: 'N+1' }), {
        path: ['cls'], out: 'x-cls-cat', label: 'Token CLS (se antepone)', type: 'embed', group: 'embed',
        outMeta: { label: 'CLS + patches', tex: '[x_{\\mathrm{cls}};\\,X_p E]' },
      });
      const ep = g.op('pos-embed', A.pos_embed_learned({ rows: c.N + 1, rowsSym: 'N+1', D: c.D, mod: 'img', interpolatedFrom: c.posInterpolatedFrom }), {
        path: ['pos-embed'], out: 'e-pos', label: 'Position embeddings aprendidos', type: 'embed', group: 'embed',
        outMeta: { label: 'Tabla de posición', tex: 'E_{\\mathrm{pos}}' },
      });
      const x0 = g.op('add-pos', A.add(xc, ep), {
        path: ['add-pos'], out: 'x0', label: 'Suma de posición', type: 'tensorop', group: 'embed',
        outMeta: { label: 'Entrada al encoder', tex: 'x_0' },
      });

      const xL = A.preLnLayer(g, x0, {
        prefix: ['encoder', 'enc-layer'], L: c.L, h: c.h, Dmlp: c.Dmlp,
        qkvBias: c.qkvBias, projBias: c.projBias, mlpBias: c.mlpBias,
      });

      const xln = g.op('final-ln', A.layernorm(xL), {
        path: ['final-ln'], out: 'x-ln', label: 'LayerNorm final', type: 'norm', group: 'norm',
        outMeta: { label: 'Salida normalizada', tex: '\\mathrm{LN}(x_L)' },
      });
      const cl = g.op('pool-cls', A.pool_cls(xln), {
        path: ['pool-cls'], out: 'cls-out', label: 'Tomar el token CLS', type: 'tensorop', group: 'head',
        outMeta: { label: 'Vector del CLS', tex: 'y' },
      });
      g.op('head', A.classifier_head(cl, { K: c.K }), {
        path: ['head'], out: 'logits', label: 'Cabeza de clasificación', type: 'head', group: 'head',
        outMeta: { label: 'Logits', tex: 'z = yW_{\\mathrm{head}} + b' },
      });
      return g;
    },

    quantities(c, r) {
      const n = r.totals.byNode;
      const op = (id) => r.ops.find((o) => o.id === id);
      const layerParams = n['enc-layer'].params / c.L;
      const layerMacs = n['enc-layer'].macs / c.L;
      const scoreMacsLayer = op('scores').macs + op('weighted-sum').macs;
      return {
        tokens: c.tokens, patches: c.N, grid: c.gridH, res: c.H, P: c.P, C: c.C, patchDim: c.patchDim,
        D: c.D, L: c.L, h: c.h, dh: c.dh, Dmlp: c.Dmlp, K: c.K,
        patchEmbedParams: n['patch-embed'].params, patchEmbedMacs: n['patch-embed'].macs,
        clsParams: n.cls.params, posParams: n['pos-embed'].params,
        layerParams, layerMacs,
        attnParamsLayer: n.mhsa.params / c.L, mlpParamsLayer: n.mlp.params / c.L,
        attnMacsLayer: n.mhsa.macs / c.L, mlpMacsLayer: n.mlp.macs / c.L,
        scoreMacsLayer, scoreEntries: c.h * c.tokens * c.tokens,
        encoderParams: n.encoder.params, encoderMacs: n.encoder.macs,
        headParams: n.head.params, finalLnParams: n['final-ln'].params,
        crossoverN: 2 * c.D + c.Dmlp,
      };
    },
  });

  function labelSize(D) { return ({ 384: 'S', 768: 'B', 1024: 'L', 1280: 'H' })[D] || ('D' + D); }
})(typeof window !== 'undefined' ? window : globalThis);
