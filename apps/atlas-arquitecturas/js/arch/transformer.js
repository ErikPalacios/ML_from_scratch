/* =============================================================================
   Atlas de Arquitecturas — js/arch/transformer.js
   Modelo `transformer`: un bloque pre-LN de juguete para el Repaso de atención (SPEC §13.2),
   del tamaño del ejemplo del Laboratorio Transformer (N=5, D=8, h=2, D_mlp=32, L=1).
   Sin embeddings: la entrada es `x0` (N×D). Ids de tensores = los de una capa de ViT:
     x0 · h-ln1 · qkv · q, k, v · scores · scores-scaled · attn · z-heads · z · o · r1 · h-ln2 ·
     u · g · f · x-out
   Ops y path de nodos (diagramas `repaso-block` / `repaso-mhsa`):
     enc-layer › ln1 · enc-layer › mhsa › {qkv, split, scores, scale, softmax, weighted-sum, merge,
     proj} · enc-layer › res1 · enc-layer › ln2 · enc-layer › mlp › {fc1, gelu, fc2} · enc-layer › res2
   La config causal tiene los mismos conteos: la máscara solo cambia qué scores se usan (se aplica
   en el paso `scale`; una implementación ingenua calcula igual los N² scores).
   Referencia PyTorch: torch.nn.TransformerEncoderLayer(d_model=8, nhead=2, dim_feedforward=32,
   norm_first=True, activation='gelu') → 872 parámetros.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const A = ATLAS.Arch;
  if (!A || !A.defineModel) throw new Error('transformer.js necesita js/arch/primitives.js antes.');

  const toy = { N: 5, D: 8, h: 2, Dmlp: 32, L: 1, qkvBias: true, projBias: true, mlpBias: true, act: 'gelu', preLN: true };

  A.defineModel({
    id: 'transformer',
    label: 'Bloque transformer (pre-LN)',
    paper: {
      title: 'Attention Is All You Need', authors: 'Vaswani et al.', venue: 'NeurIPS 2017', year: 2017, arxiv: '1706.03762',
      note: 'Pre-LN: Xiong et al., On Layer Normalization in the Transformer Architecture, ICML 2020, arXiv:2002.04745.',
    },
    configs: {
      'toy-n5-d8': Object.assign({}, toy, { label: 'Juguete N=5, D=8, h=2', causal: false, canonical: true,
        source: 'Ejemplo del Laboratorio Transformer; equivale (en conteos) a torch.nn.TransformerEncoderLayer(8, 2, 32, activation="gelu", norm_first=True)' }),
      'toy-n5-d8-causal': Object.assign({}, toy, { label: 'Juguete causal N=5, D=8, h=2', causal: true,
        source: 'Igual que toy-n5-d8 con máscara causal (decoder-only)' }),
    },
    // N = largo de la secuencia: sirve para ver el cruce N = 6D (= 48 con D = 8).
    knobs: { N: [5, 16, 48, 96, 256] },

    resolve(c) {
      if (c.D % c.h !== 0) throw new Error('D = ' + c.D + ' no es divisible por h = ' + c.h + '.');
      c.dh = c.D / c.h;
      c.tokens = c.N;
      return c;
    },

    build(c, A) {
      const g = A.graph(c);
      const x0 = g.input('x0', A.shape(['N', 'D'], [c.N, c.D], 'txt', 'seq'), { label: 'Entrada al bloque', tex: 'x_0' });
      A.preLnLayer(g, x0, {
        prefix: ['enc-layer'], L: c.L, h: c.h, Dmlp: c.Dmlp, causal: c.causal,
        qkvBias: c.qkvBias, projBias: c.projBias, mlpBias: c.mlpBias,
      });
      return g;
    },

    quantities(c, r) {
      const n = r.totals.byNode;
      const op = (id) => r.ops.find((o) => o.id === id);
      const entries = c.h * c.N * c.N;
      const used = c.causal ? c.h * c.N * (c.N + 1) / 2 : entries;
      return {
        tokens: c.N, N: c.N, D: c.D, h: c.h, dh: c.dh, Dmlp: c.Dmlp, L: c.L,
        layerParams: n['enc-layer'].params / c.L, layerMacs: n['enc-layer'].macs / c.L,
        attnParamsLayer: n.mhsa.params / c.L, mlpParamsLayer: n.mlp.params / c.L,
        attnMacsLayer: n.mhsa.macs / c.L, mlpMacsLayer: n.mlp.macs / c.L,
        scoreMacsLayer: op('scores').macs + op('weighted-sum').macs,
        scoreEntries: entries, usedScores: used, maskedScores: entries - used,
        crossoverN: 2 * c.D + c.Dmlp,
      };
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
