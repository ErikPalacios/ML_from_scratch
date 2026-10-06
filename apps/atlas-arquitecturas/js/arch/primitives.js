/* =============================================================================
   Atlas de Arquitecturas — js/arch/primitives.js
   ATLAS.Arch: la calculadora de arquitecturas (SPEC §6). Única fuente de números:
   formas, parámetros y MACs de cada primitiva; constructor de grafos; run(), metrics(),
   fmt, configs(), models(), primitives(). Sin DOM: se carga también en Node.

   Convenciones (SPEC §6.2):
   - Formas SIN batch, "tokens × canales" (N×D); imágenes H×W×C (channels-last; PyTorch usa C×H×W).
   - MACs = multiplica-acumula de matmuls/convs (m·n·k). FLOPs = 2 × MACs.
   - "otros (≈)" = estimación de operaciones elementwise (sesgos, normas, softmax, activaciones,
     sumas), excluida del número principal. Costos por elemento usados (≈, documentados):
     sesgo 1 · suma/residual 1 · escala 1 · LayerNorm 5 · RMSNorm 4 · softmax 5 · GELU 8.
   - Parámetros exactos, con sesgos cuando la implementación de referencia los tiene.

   Contrato de run(configId) = SPEC §6.7. Añadidos compatibles (no rompen el contrato):
   - op: también `node` (= último de path), `type` (paleta §3.1), `group` (embed|attn|mlp|norm|
     head|resid), `detail`. tensor: también `elements`. totals: también `byGroup`;
     byNode[id] también trae `other`. Resultado: también `overrides` y `notes` (avisos, p. ej.
     interpolación de position embeddings).
   - run(configId, overrides?) acepta knobs (memoizado por configId + overrides).
   - metrics(configId, overrides) acepta además `B`, `dtype` ('fp32'|'fp16'|'bf16'|'fp8'|'int8') y
     `ctx` (largo para kvCache) dentro de overrides (no cambian la arquitectura, solo los bytes).
     attnMem/actMem/kvCache se devuelven como números (bytes) para esos B y dtype (por defecto
     B=1, bf16). kvCache = null en modelos sin máscara causal.
   - Primitivas extra `scale` (×1/√d_h), `add` (suma no residual), `flatten` (rejilla → secuencia).
   - Tensores extra respecto de SPEC §13.1 (añadidos, nada renombrado): `e-pos` (tabla de posición)
     y `scores-scaled` (salida del nodo `scale`). Ver la cabecera de js/arch/vit.js.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});

  // ------------------------------------------------------------------ formato
  function int(n) {
    if (n === null || n === undefined || !isFinite(n)) return String(n);
    const neg = n < 0;
    const s = String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return neg ? '-' + s : s;
  }

  // si(n): 86.6 M · 17.56 G · 1.77 M · 590.6 K. decimals opcional fuerza los decimales.
  function si(n, decimals) {
    const a = Math.abs(n);
    const units = [[1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'K']];
    for (const [v, u] of units) {
      if (a >= v) {
        const x = n / v;
        const d = decimals !== undefined ? decimals : (v >= 1e9 ? 2 : (Math.abs(x) < 10 ? 2 : 1));
        return x.toFixed(d) + ' ' + u;
      }
    }
    return decimals !== undefined ? n.toFixed(decimals) : int(n);
  }

  function bytes(n) {
    const a = Math.abs(n);
    const units = [[2 ** 40, 'TiB'], [2 ** 30, 'GiB'], [2 ** 20, 'MiB'], [2 ** 10, 'KiB']];
    for (const [v, u] of units) if (a >= v) { const x = n / v; return x.toFixed(x < 10 ? 2 : 1) + ' ' + u; }
    return int(n) + ' B';
  }

  function pct(x, decimals) { return (x * 100).toFixed(decimals === undefined ? 1 : decimals) + ' %'; }

  // Símbolos: texto plano y LaTeX.
  const SYM_TEX = { D_mlp: 'D_{\\mathrm{mlp}}', d_h: 'd_h', 'P^2C': 'P^2C' };
  function symTexAtom(s) {
    s = String(s);
    if (SYM_TEX[s]) return SYM_TEX[s];
    return s.replace(/D_mlp/g, 'D_{\\mathrm{mlp}}');
  }
  const compound = (s) => /[+\-\/ ]/.test(String(s));
  // En una forma: (N+1)×D. En LaTeX de forma: (N{+}1)\times D.
  function symText(s) { s = String(s); return compound(s) ? '(' + s + ')' : s; }
  function symTexShape(s) {
    const t = symTexAtom(s).replace(/-/g, '{-}').replace(/\+/g, '{+}');
    return compound(s) ? '(' + t + ')' : t;
  }
  // En un producto de fórmula: (N+1)\cdot D.
  function symTexFactor(s) { const t = symTexAtom(s); return compound(s) ? '(' + t + ')' : t; }
  const texProd = (syms) => syms.map(symTexFactor).join('\\cdot ');

  function shapeStr(t, mode) {
    if (!t) return '';
    if (mode === 'sym') return t.sym.map(symText).join('×');
    return t.num.join('×');
  }
  function shapeTex(t) { return t ? t.sym.map(symTexShape).join('\\times ') : ''; }

  // Aritmética con números reales: términos = productos de factores. '768·2304 + 2304 = 1,771,776'.
  const prod = (a) => a.reduce((x, y) => x * y, 1);
  function sumTerms(terms) { return terms.reduce((s, t) => s + prod(t), 0); }
  function arith(terms) {
    if (!terms.length) return '0';
    const total = sumTerms(terms);
    if (terms.length === 1 && terms[0].length === 1) return int(total);
    return terms.map((t) => t.join('·')).join(' + ') + ' = ' + int(total);
  }
  // Suma de subtotales (compuestas): '1,771,776 + 590,592 = 2,362,368'.
  function arithSum(values) {
    const v = values.filter((x) => x > 0);
    const total = v.reduce((a, b) => a + b, 0);
    if (v.length <= 1) return int(total);
    return v.map(int).join(' + ') + ' = ' + int(total);
  }

  const fmt = { int, si, bytes, pct, shape: shapeStr, shapeTex, symText, symTex: symTexShape };

  // ------------------------------------------------------------------ formas
  function shape(sym, num, mod, layout) {
    if (!Array.isArray(sym) || !Array.isArray(num) || sym.length !== num.length) {
      throw new Error('Forma inválida: sym y num deben ser arreglos del mismo largo.');
    }
    num.forEach((n) => { if (!Number.isInteger(n) || n <= 0) throw new Error('Forma inválida: dimensión ' + n + ' no es un entero positivo.'); });
    return { sym: sym.map(String), num: num.slice(), mod: mod || null, layout: layout || (num.length === 1 ? 'vec' : 'seq') };
  }
  const plain = (t) => ({ sym: t.sym.slice(), num: t.num.slice(), mod: t.mod, layout: t.layout });
  const elems = (t) => prod(t.num);

  // Costos elementwise por elemento (≈) para "otros".
  const OTHER = { bias: 1, add: 1, scale: 1, layernorm: 5, rmsnorm: 4, softmax: 5, gelu: 8 };

  // Resultado común de una primitiva.
  function result(prim, inputs, out, o) {
    const pTerms = o.paramTerms || [];
    const mTerms = o.macTerms || [];
    const params = o.params !== undefined ? o.params : sumTerms(pTerms);
    const macs = o.macs !== undefined ? o.macs : sumTerms(mTerms);
    const outs = Array.isArray(out) ? out : [out];
    const ins = inputs.filter(Boolean);
    const inTex = ins.map(shapeTex).join(',\\ ');
    const outTex = outs.map(shapeTex).join(',\\ ');
    return {
      prim, inputs: ins, out,
      params, macs, other: o.other || 0,
      paramFormula: o.paramTex || (params ? '' : '0'),
      macFormula: o.macTex || (macs ? '' : '0'),
      paramArith: o.paramArith || arith(pTerms),
      macArith: o.macArith || arith(mTerms),
      shapeTex: (inTex ? inTex + ' \\to ' : '\\to ') + outTex,
      detail: o.detail || {},
    };
  }

  // ------------------------------------------------------------------ primitivas
  // linear: última dimensión din → dout. o = {dout, doutSym, bias=true, mod?}
  function linear(x, o) {
    const bias = o.bias !== false;
    const din = x.num[x.num.length - 1], dinSym = x.sym[x.sym.length - 1];
    const rows = x.num.slice(0, -1), rowsSym = x.sym.slice(0, -1);
    const dout = o.dout, doutSym = o.doutSym || String(dout);
    const out = shape(rowsSym.concat([doutSym]), rows.concat([dout]), o.mod || x.mod, x.layout === 'vec' ? 'vec' : x.layout);
    const pTerms = [[din, dout]].concat(bias ? [[dout]] : []);
    return result('linear', [x], out, {
      paramTerms: pTerms,
      paramTex: texProd([dinSym, doutSym]) + (bias ? ' + ' + symTexFactor(doutSym) : ''),
      macTerms: [rows.concat([din, dout])],
      macTex: texProd(rowsSym.concat([dinSym, doutSym])),
      other: bias ? prod(rows) * dout * OTHER.bias : 0,
      detail: { din, dout, bias },
    });
  }

  // conv2d sobre H×W×C (channels-last). o = {k, s=k, p=0, cout, coutSym, kSym, outSym:[hs, ws], bias=true}
  function conv2d(x, o) {
    if (x.num.length !== 3) throw new Error('conv2d espera una entrada H×W×C.');
    const [H, W, C] = x.num, [, , Cs] = x.sym;
    const k = o.k, s = o.s || o.k, p = o.p || 0, bias = o.bias !== false;
    if ((H + 2 * p - k) % s !== 0 || (W + 2 * p - k) % s !== 0) {
      throw new Error('conv2d: la resolución ' + H + '×' + W + ' no es divisible por el stride ' + s + ' (con kernel ' + k + ').');
    }
    const Ho = (H + 2 * p - k) / s + 1, Wo = (W + 2 * p - k) / s + 1;
    const cout = o.cout, coutSym = o.coutSym || String(cout), kSym = o.kSym || String(k);
    const outSym = o.outSym || [String(Ho), String(Wo)];
    const out = shape([outSym[0], outSym[1], coutSym], [Ho, Wo, cout], o.mod || x.mod, 'grid');
    const kk = symTexFactor(kSym) + '^2';
    return result('conv2d', [x], out, {
      paramTerms: [[k, k, C, cout]].concat(bias ? [[cout]] : []),
      paramTex: kk + '\\cdot ' + symTexFactor(Cs) + '\\cdot ' + symTexFactor(coutSym) + (bias ? ' + ' + symTexFactor(coutSym) : ''),
      macTerms: [[Ho, Wo, cout, k, k, C]],
      macTex: o.macTex || (texProd([outSym[0], outSym[1], coutSym]) + '\\cdot ' + kk + '\\cdot ' + symTexFactor(Cs)),
      other: bias ? Ho * Wo * cout * OTHER.bias : 0,
      detail: { k, s, p, Ho, Wo, cin: C, cout, bias, patchify: k === s && p === 0 },
    });
  }

  function norm(prim, x, o) {
    const D = x.num[x.num.length - 1], Ds = x.sym[x.sym.length - 1];
    const affine2 = prim === 'layernorm';
    return result(prim, [x], plain(x), {
      paramTerms: affine2 ? [[2, D]] : [[D]],
      paramTex: affine2 ? '2' + symTexFactor(Ds) : symTexFactor(Ds),
      other: elems(x) * OTHER[prim],
      detail: { D, eps: (o && o.eps) || null },
    });
  }
  const layernorm = (x, o) => norm('layernorm', x, o);   // γ y β: 2D
  const rmsnorm = (x, o) => norm('rmsnorm', x, o);       // solo γ: D

  function elementwise(prim, x, cost, o) {
    return result(prim, [x], plain(x), { other: elems(x) * cost, detail: Object.assign({}, o || {}) });
  }
  const gelu = (x) => elementwise('gelu', x, OTHER.gelu);
  const softmax = (x) => elementwise('softmax', x, OTHER.softmax);
  // scale: multiplica por un escalar (1/√d_h). o.causal: además aplica la máscara causal.
  const scale = (x, o) => elementwise('scale', x, OTHER.scale, o);

  function add(a, b, prim) {
    if (shapeStr(a) !== shapeStr(b)) throw new Error('Suma con formas distintas: ' + shapeStr(a) + ' y ' + shapeStr(b) + '.');
    return result(prim || 'add', [a, b], plain(a), { other: elems(a) * OTHER.add });
  }
  const residual_add = (a, b) => add(a, b, 'residual_add');

  // embedding_lookup: ids (N) → N×D. o = {V, D, Vsym='V', Dsym='D'}
  function embedding_lookup(ids, o) {
    const N = ids.num[0], Ns = ids.sym[0];
    const out = shape([Ns, o.Dsym || 'D'], [N, o.D], o.mod || ids.mod || 'txt', 'seq');
    return result('embedding_lookup', [ids], out, {
      paramTerms: [[o.V, o.D]], paramTex: texProd([o.Vsym || 'V', o.Dsym || 'D']),
      detail: { V: o.V, D: o.D },
    });
  }

  // pos_embed_learned: la tabla aprendida rows×D (sin entrada de datos). o = {rows, rowsSym, D, Dsym, mod}
  function pos_embed_learned(o) {
    const out = shape([o.rowsSym, o.Dsym || 'D'], [o.rows, o.D], o.mod, 'seq');
    return result('pos_embed_learned', [], out, {
      paramTerms: [[o.rows, o.D]], paramTex: texProd([o.rowsSym, o.Dsym || 'D']),
      detail: { rows: o.rows, D: o.D, interpolatedFrom: o.interpolatedFrom || null },
    });
  }

  // cls_token: antepone un vector aprendido: N×D → (N+1)×D.
  function cls_token(x, o) {
    const [N, D] = x.num, [Ns, Ds] = x.sym;
    const outSym = (o && o.outSym) || (Ns + '+1');
    const out = shape([outSym, Ds], [N + 1, D], x.mod, 'seq');
    return result('cls_token', [x], out, { paramTerms: [[D]], paramTex: symTexFactor(Ds), detail: { D } });
  }

  // concat_tokens: concatena a lo largo de los tokens. o.sym = símbolo del largo resultante.
  function concat_tokens(a, b, o) {
    if (a.num[1] !== b.num[1]) throw new Error('concat_tokens: anchos distintos (' + a.num[1] + ' y ' + b.num[1] + ').');
    const sym = (o && o.sym) || (a.sym[0] + '+' + b.sym[0]);
    const out = shape([sym, a.sym[1]], [a.num[0] + b.num[0], a.num[1]], (o && o.mod) || a.mod, 'seq');
    return result('concat_tokens', [a, b], out, {});
  }

  // flatten: rejilla h×w×C → secuencia (h·w)×C. o.sym = [símbolo de tokens, símbolo de canales]
  function flatten(x, o) {
    const [h, w, c] = x.num;
    const sym = (o && o.sym) || [x.sym[0] + '·' + x.sym[1], x.sym[2]];
    return result('flatten', [x], shape(sym, [h * w, c], x.mod, 'seq'), {});
  }

  // split_heads: N×(parts·D) → parts × [h×N×d_h]. o = {h, parts=1, hSym='h', dhSym='d_h'}
  function split_heads(x, o) {
    const parts = o.parts || 1, h = o.h;
    const [N, W] = x.num, Ns = x.sym[0];
    if (W % parts !== 0) throw new Error('split_heads: ' + W + ' no es divisible en ' + parts + ' partes.');
    const D = W / parts;
    if (D % h !== 0) throw new Error('split_heads: D = ' + D + ' no es divisible por h = ' + h + '.');
    const dh = D / h;
    const mk = () => shape([o.hSym || 'h', Ns, o.dhSym || 'd_h'], [h, N, dh], x.mod, 'heads');
    const outs = Array.from({ length: parts }, mk);
    return result('split_heads', [x], parts === 1 ? outs[0] : outs, { detail: { h, dh, parts } });
  }

  // merge_heads: h×N×d_h → N×D (concatenar cabezas).
  function merge_heads(z, o) {
    const [h, N, dh] = z.num;
    return result('merge_heads', [z], shape([z.sym[1], (o && o.Dsym) || 'D'], [N, h * dh], z.mod, 'seq'), { detail: { h, dh } });
  }

  // attention_scores: Q (h×Nq×d_h) · Kᵀ (h×d_h×Nk) → h×Nq×Nk. MACs h·Nq·Nk·d_h (= Nq·Nk·D).
  function attention_scores(q, k) {
    const [h, Nq, dh] = q.num, Nk = k.num[1];
    if (k.num[0] !== h || k.num[2] !== dh) throw new Error('attention_scores: Q y K con cabezas o d_h distintos.');
    const out = shape([q.sym[0], q.sym[1], k.sym[1]], [h, Nq, Nk], q.mod, 'heads');
    return result('attention_scores', [q, k], out, {
      macTerms: [[h, Nq, Nk, dh]], macTex: texProd([q.sym[0], q.sym[1], k.sym[1], q.sym[2]]),
      detail: { h, Nq, Nk, dh, note: 'h·N·N·d_h = N²·D' },
    });
  }

  // attention_weighted_sum: A (h×Nq×Nk) · V (h×Nk×d_h) → h×Nq×d_h.
  function attention_weighted_sum(a, v) {
    const [h, Nq, Nk] = a.num, dh = v.num[2];
    if (v.num[0] !== h || v.num[1] !== Nk) throw new Error('attention_weighted_sum: A y V incompatibles.');
    const out = shape([a.sym[0], a.sym[1], v.sym[2]], [h, Nq, dh], a.mod, 'heads');
    return result('attention_weighted_sum', [a, v], out, {
      macTerms: [[h, Nq, Nk, dh]], macTex: texProd([a.sym[0], a.sym[1], a.sym[2], v.sym[2]]),
      detail: { h, Nq, Nk, dh },
    });
  }

  // pool_cls: (N+1)×D → D (fila 0).
  function pool_cls(x) {
    return result('pool_cls', [x], shape([x.sym[1]], [x.num[1]], x.mod, 'vec'), {});
  }

  // classifier_head: D → K (lineal sobre un vector).
  function classifier_head(x, o) {
    const r = linear(x, { dout: o.K, doutSym: o.Ksym || 'K', bias: o.bias !== false, mod: x.mod });
    r.prim = 'classifier_head';
    return r;
  }

  // ---- compuestas (para fórmulas, tablas y pruebas; los modelos usan las elementales en el grafo)
  function composite(prim, x, parts, out, o) {
    return {
      prim, inputs: [x], out,
      params: parts.reduce((s, p) => s + p.params, 0),
      macs: parts.reduce((s, p) => s + p.macs, 0),
      other: parts.reduce((s, p) => s + p.other, 0),
      paramFormula: o.paramTex, macFormula: o.macTex,
      paramArith: arithSum(parts.map((p) => p.params)),
      macArith: arithSum(parts.map((p) => p.macs)),
      shapeTex: shapeTex(x) + ' \\to ' + shapeTex(out),
      detail: Object.assign({ parts: parts.map((p) => ({ prim: p.prim, params: p.params, macs: p.macs, other: p.other })) }, o.detail || {}),
    };
  }

  // mhsa: qkv → split → scores → scale → softmax → ·V → merge → proj. o = {h, qkvBias, projBias, Dsym}
  function mhsa(x, o) {
    const D = x.num[1], Ds = (o && o.Dsym) || x.sym[1], Ns = x.sym[0];
    const qkv = linear(x, { dout: 3 * D, doutSym: '3' + Ds, bias: o.qkvBias !== false });
    const sp = split_heads(qkv.out, { h: o.h, parts: 3 });
    const [q, k, v] = sp.out;
    const sc = attention_scores(q, k);
    const sl = scale(sc.out);
    const sm = softmax(sl.out);
    const ws = attention_weighted_sum(sm.out, v);
    const mg = merge_heads(ws.out, { Dsym: Ds });
    const pj = linear(mg.out, { dout: D, doutSym: Ds, bias: o.projBias !== false });
    const nb = (o.qkvBias !== false ? 3 : 0) + (o.projBias !== false ? 1 : 0);
    const n = symTexFactor(Ns), d = symTexFactor(Ds);
    return composite('mhsa', x, [qkv, sp, sc, sl, sm, ws, mg, pj], pj.out, {
      paramTex: '4' + d + '^2' + (nb ? ' + ' + (nb === 1 ? '' : nb) + d : ''),
      macTex: '4\\,' + n + '\\,' + d + '^2 + 2\\,' + n + '^2\\,' + d,
      detail: { h: o.h, dh: D / o.h },
    });
  }

  // mlp: fc1 (D → D_mlp) → GELU → fc2 (D_mlp → D). o = {Dmlp, DmlpSym='D_mlp', bias=true}
  function mlp(x, o) {
    const D = x.num[1], Ds = x.sym[1], Ms = o.DmlpSym || 'D_mlp', bias = o.bias !== false;
    const fc1 = linear(x, { dout: o.Dmlp, doutSym: Ms, bias });
    const act = gelu(fc1.out);
    const fc2 = linear(act.out, { dout: D, doutSym: Ds, bias });
    const d = symTexFactor(Ds), m = symTexFactor(Ms), n = symTexFactor(x.sym[0]);
    return composite('mlp', x, [fc1, act, fc2], fc2.out, {
      paramTex: '2\\,' + d + '\\,' + m + (bias ? ' + ' + m + ' + ' + d : ''),
      macTex: '2\\,' + n + '\\,' + d + '\\,' + m,
    });
  }

  // transformer_block (pre-LN): x + MHSA(LN(x)); luego + MLP(LN(·)).
  function transformer_block(x, o) {
    const ln1 = layernorm(x);
    const at = mhsa(ln1.out, o);
    const r1 = residual_add(x, at.out);
    const ln2 = layernorm(r1.out);
    const ml = mlp(ln2.out, o);
    const r2 = residual_add(r1.out, ml.out);
    const d = symTexFactor(x.sym[1]), m = symTexFactor(o.DmlpSym || 'D_mlp'), n = symTexFactor(x.sym[0]);
    const r = composite('transformer_block', x, [ln1, at, r1, ln2, ml, r2], r2.out, {
      paramTex: '4' + d + '^2 + 2\\,' + d + '\\,' + m + ' + ' + m + ' + 9' + d,
      macTex: n + '\\,(4' + d + '^2 + 2\\,' + d + '\\,' + m + ') + 2\\,' + n + '^2\\,' + d,
      detail: { note: 'Con D_mlp = 4D y todos los sesgos: 12D² + 13D parámetros.' },
    });
    return r;
  }

  const PRIMS = {
    linear, conv2d, layernorm, rmsnorm, gelu, embedding_lookup, pos_embed_learned, cls_token,
    concat_tokens, flatten, split_heads, merge_heads, attention_scores, scale, softmax,
    attention_weighted_sum, mhsa, mlp, add, residual_add, transformer_block, pool_cls, classifier_head,
  };

  // Tabla genérica de fórmulas (ref-formas). Símbolos de SPEC §6.2.
  const PRIM_INFO = [
    { id: 'linear', name: 'Linear', paramTex: 'D_{in}\\,D_{out} + D_{out}', macTex: 'N\\,D_{in}\\,D_{out}', outTex: 'N\\times D_{in} \\to N\\times D_{out}', note: 'El sesgo (+D_out) solo si la capa lo tiene. Es la mayoría de los MACs de un transformer.' },
    { id: 'conv2d', name: 'Conv2d', paramTex: 'k^2\\,C_{in}\\,C_{out} + C_{out}', macTex: 'H_o\\,W_o\\,C_{out}\\,k^2\\,C_{in}', outTex: 'H\\times W\\times C_{in} \\to H_o\\times W_o\\times C_{out}', note: 'Patchify = conv con k = s = P: H_o = H/P. Equivale a un Linear sobre cada parche aplanado (P²C → D).' },
    { id: 'layernorm', name: 'LayerNorm', paramTex: '2D', macTex: '0', outTex: 'N\\times D \\to N\\times D', note: 'γ y β por canal. Sin MACs; ≈ 5 ops por elemento en "otros".' },
    { id: 'rmsnorm', name: 'RMSNorm', paramTex: 'D', macTex: '0', outTex: 'N\\times D \\to N\\times D', note: 'Solo γ (sin centrar ni β).' },
    { id: 'gelu', name: 'GELU', paramTex: '0', macTex: '0', outTex: 'N\\times D_{\\mathrm{mlp}} \\to N\\times D_{\\mathrm{mlp}}', note: 'Elementwise; ≈ 8 ops por elemento (aprox. tanh) en "otros".' },
    { id: 'embedding_lookup', name: 'Embedding lookup', paramTex: 'V\\,D', macTex: '0', outTex: 'N \\to N\\times D', note: 'Indexar una tabla: parámetros sí, MACs no.' },
    { id: 'pos_embed_learned', name: 'Position embedding aprendido', paramTex: '(N{+}1)\\,D', macTex: '0', outTex: '\\to (N{+}1)\\times D', note: 'Tabla aprendida (parámetro). Si cambia la resolución, se interpola y cambia su tamaño. Un PE sinusoidal fijo es buffer, no parámetro.' },
    { id: 'cls_token', name: 'Token CLS', paramTex: 'D', macTex: '0', outTex: 'N\\times D \\to (N{+}1)\\times D', note: 'Un vector aprendido que se antepone a la secuencia.' },
    { id: 'concat_tokens', name: 'Concatenar tokens', paramTex: '0', macTex: '0', outTex: 'N_a\\times D,\\ N_b\\times D \\to (N_a{+}N_b)\\times D', note: 'Sin parámetros.' },
    { id: 'flatten', name: 'Aplanar rejilla', paramTex: '0', macTex: '0', outTex: 'h\\times w\\times D \\to hw\\times D', note: 'Reshape: la rejilla de parches se vuelve secuencia.' },
    { id: 'split_heads', name: 'Separar en cabezas', paramTex: '0', macTex: '0', outTex: 'N\\times 3D \\to 3\\times(h\\times N\\times d_h)', note: 'Reshape + transpose; d_h = D/h.' },
    { id: 'attention_scores', name: 'Scores QKᵀ', paramTex: '0', macTex: 'h\\,N^2\\,d_h = N^2 D', outTex: 'h\\times N\\times d_h \\to h\\times N\\times N', note: 'Cuadrático en N: el término que domina a alta resolución.' },
    { id: 'scale', name: 'Escala 1/√d_h', paramTex: '0', macTex: '0', outTex: 'h\\times N\\times N \\to h\\times N\\times N', note: 'Elementwise. La máscara causal (si la hay) se aplica aquí.' },
    { id: 'softmax', name: 'Softmax', paramTex: '0', macTex: '0', outTex: 'h\\times N\\times N \\to h\\times N\\times N', note: 'Por fila; ≈ 5 ops por elemento en "otros".' },
    { id: 'attention_weighted_sum', name: 'Suma ponderada A·V', paramTex: '0', macTex: 'h\\,N^2\\,d_h = N^2 D', outTex: 'h\\times N\\times N,\\ h\\times N\\times d_h \\to h\\times N\\times d_h', note: 'Igual costo que QKᵀ.' },
    { id: 'merge_heads', name: 'Concatenar cabezas', paramTex: '0', macTex: '0', outTex: 'h\\times N\\times d_h \\to N\\times D', note: 'Transpose + reshape.' },
    { id: 'mhsa', name: 'Multi-head self-attention', paramTex: '4D^2 + 4D', macTex: '4ND^2 + 2N^2D', outTex: 'N\\times D \\to N\\times D', note: 'Proyecciones (4ND²) + scores y suma ponderada (2N²D). Las cabezas no cambian el conteo.' },
    { id: 'mlp', name: 'MLP (FFN)', paramTex: '2D\\,D_{\\mathrm{mlp}} + D_{\\mathrm{mlp}} + D', macTex: '2N\\,D\\,D_{\\mathrm{mlp}}', outTex: 'N\\times D \\to N\\times D', note: 'Con D_mlp = 4D: 8D² + 5D parámetros y 8ND² MACs.' },
    { id: 'residual_add', name: 'Suma residual', paramTex: '0', macTex: '0', outTex: 'N\\times D \\to N\\times D', note: 'Elementwise, sin parámetros.' },
    { id: 'transformer_block', name: 'Bloque transformer (pre-LN)', paramTex: '4D^2 + 2D\\,D_{\\mathrm{mlp}} + D_{\\mathrm{mlp}} + 9D', macTex: 'N(4D^2 + 2D\\,D_{\\mathrm{mlp}}) + 2N^2D', outTex: 'N\\times D \\to N\\times D', note: 'Con D_mlp = 4D: 12D² + 13D parámetros y 12ND² + 2N²D MACs. Los dos términos se igualan en N = 6D.' },
    { id: 'pool_cls', name: 'Pooling CLS', paramTex: '0', macTex: '0', outTex: '(N{+}1)\\times D \\to D', note: 'Toma la fila del token CLS.' },
    { id: 'classifier_head', name: 'Cabeza de clasificación', paramTex: 'D\\,K + K', macTex: 'D\\,K', outTex: 'D \\to K', note: 'Un Linear sobre el vector del CLS.' },
  ];
  function primitives() { return PRIM_INFO.map((p) => Object.assign({}, p)); }

  // ------------------------------------------------------------------ grafo
  function graph(cfg) {
    const tensors = {}, order = [], ops = [], opIds = new Set();

    function addTensor(id, sh, meta, producer) {
      if (!id || typeof id !== 'string') throw new Error('Tensor sin id.');
      if (tensors[id]) throw new Error('Tensor "' + id + '" definido dos veces.');
      meta = meta || {};
      tensors[id] = {
        id, sym: sh.sym.slice(), num: sh.num.slice(), mod: sh.mod, layout: sh.layout,
        tex: meta.tex || id, label: meta.label || id, producer: producer || null, consumers: [],
        perLayer: !!meta.perLayer, elements: elems(sh),
      };
      if (meta.note) tensors[id].note = meta.note;
      order.push(id);
      return Object.assign(plain(sh), { id });
    }

    return {
      cfg,
      input(id, sh, meta) { return addTensor(id, sh, meta, null); },
      tensor(id) { const t = tensors[id]; if (!t) throw new Error('Tensor desconocido: ' + id); return Object.assign(plain(t), { id }); },
      // op(id, resultadoDePrimitiva, {path|node, out, outMeta, label, repeat, type, group, in?})
      op(id, res, o) {
        o = o || {};
        if (opIds.has(id)) throw new Error('Operación "' + id + '" definida dos veces.');
        opIds.add(id);
        const path = o.path ? o.path.slice() : (o.node ? [o.node] : [id]);
        const ins = o.in || res.inputs.filter((h) => h && h.id).map((h) => h.id);
        ins.forEach((tid) => { if (!tensors[tid]) throw new Error('Op "' + id + '": entrada desconocida "' + tid + '".'); });
        const outsSh = Array.isArray(res.out) ? res.out : [res.out];
        const outIds = Array.isArray(o.out) ? o.out : [o.out || id];
        if (outIds.length !== outsSh.length) throw new Error('Op "' + id + '": ' + outsSh.length + ' salidas y ' + outIds.length + ' ids.');
        const metas = Array.isArray(o.outMeta) ? o.outMeta : [o.outMeta || {}];
        const handles = outIds.map((tid, i) => addTensor(tid, outsSh[i], metas[i] || {}, id));
        ins.forEach((tid) => tensors[tid].consumers.push(id));
        ops.push({
          id, prim: res.prim, label: o.label || id, path, node: path[path.length - 1],
          in: ins, out: outIds, repeat: o.repeat || 1,
          params: res.params, macs: res.macs, other: res.other,
          paramTex: o.paramTex || res.paramFormula, paramArith: res.paramArith,
          macTex: o.macTex || res.macFormula, macArith: res.macArith,
          shapeTex: res.shapeTex, type: o.type || 'tensorop', group: o.group || 'other',
          detail: res.detail || {},
        });
        return handles.length === 1 ? handles[0] : handles;
      },
      _data() { return { tensors, order, ops }; },
    };
  }

  // Bloque pre-LN reutilizable (ViT, transformer de juguete). Ids de SPEC §13.1/13.2.
  // prefix = path de nodos que contiene la capa (p. ej. ['encoder','enc-layer']).
  // o = {L, h, Dmlp, qkvBias, projBias, mlpBias, causal, outId='x-out'}
  function preLnLayer(g, x, o) {
    const P = o.prefix || ['enc-layer'];
    const rep = o.L || 1;
    const L = (meta) => Object.assign({ perLayer: true }, meta);
    const D = x.num[1], Ds = x.sym[1];
    const at = P.concat(['mhsa']), ml = P.concat(['mlp']);
    const op = (id, res, path, extra) => g.op(id, res, Object.assign({ path, repeat: rep }, extra));

    const hln1 = op('ln1', layernorm(x), P.concat(['ln1']), { out: 'h-ln1', label: 'LayerNorm 1', type: 'norm', group: 'norm', outMeta: L({ label: 'Entrada normalizada (LN 1)', tex: '\\mathrm{LN}_1(x)' }) });
    const qkv = op('qkv', linear(hln1, { dout: 3 * D, doutSym: '3' + Ds, bias: o.qkvBias !== false }), at.concat(['qkv']), { out: 'qkv', label: 'Proyección Q, K, V', type: 'embed', group: 'attn', outMeta: L({ label: 'Q, K y V concatenados', tex: '[Q\\;K\\;V]' }) });
    const [q, k, v] = op('split', split_heads(qkv, { h: o.h, parts: 3 }), at.concat(['split']), {
      out: ['q', 'k', 'v'], label: 'Separar en cabezas', type: 'tensorop', group: 'attn',
      outMeta: [L({ label: 'Queries por cabeza', tex: 'Q' }), L({ label: 'Keys por cabeza', tex: 'K' }), L({ label: 'Values por cabeza', tex: 'V' })],
    });
    const sc = op('scores', attention_scores(q, k), at.concat(['scores']), { out: 'scores', label: 'Producto QKᵀ', type: 'attn', group: 'attn', outMeta: L({ label: 'Scores sin escalar', tex: 'QK^\\top' }) });
    const ss = op('scale', scale(sc, { causal: !!o.causal }), at.concat(['scale']), {
      out: 'scores-scaled', label: o.causal ? 'Escala 1/√d_h + máscara causal' : 'Escala 1/√d_h', type: 'attn', group: 'attn',
      outMeta: L({ label: o.causal ? 'Scores escalados y enmascarados' : 'Scores escalados', tex: o.causal ? 'QK^\\top/\\sqrt{d_h} + M' : 'QK^\\top/\\sqrt{d_h}' }),
    });
    const a = op('softmax', softmax(ss), at.concat(['softmax']), { out: 'attn', label: 'Softmax por fila', type: 'attn', group: 'attn', outMeta: L({ label: 'Pesos de atención', tex: 'A' }) });
    const zh = op('weighted-sum', attention_weighted_sum(a, v), at.concat(['weighted-sum']), { out: 'z-heads', label: 'Suma ponderada A·V', type: 'attn', group: 'attn', outMeta: L({ label: 'Salida por cabeza', tex: 'AV' }) });
    const z = op('merge', merge_heads(zh, { Dsym: Ds }), at.concat(['merge']), { out: 'z', label: 'Concatenar cabezas', type: 'tensorop', group: 'attn', outMeta: L({ label: 'Cabezas concatenadas', tex: 'Z' }) });
    const ov = op('proj', linear(z, { dout: D, doutSym: Ds, bias: o.projBias !== false }), at.concat(['proj']), { out: 'o', label: 'Proyección de salida W_O', type: 'embed', group: 'attn', outMeta: L({ label: 'Salida de la atención', tex: 'O = ZW_O' }) });
    const r1 = op('res1', residual_add(x, ov), P.concat(['res1']), { out: 'r1', label: 'Residual 1', type: 'tensorop', group: 'resid', outMeta: L({ label: 'x + atención', tex: "x'" }) });
    const hln2 = op('ln2', layernorm(r1), P.concat(['ln2']), { out: 'h-ln2', label: 'LayerNorm 2', type: 'norm', group: 'norm', outMeta: L({ label: 'Entrada normalizada (LN 2)', tex: "\\mathrm{LN}_2(x')" }) });
    const u = op('fc1', linear(hln2, { dout: o.Dmlp, doutSym: 'D_mlp', bias: o.mlpBias !== false }), ml.concat(['fc1']), { out: 'u', label: 'MLP: capa 1 (expansión)', type: 'mlp', group: 'mlp', outMeta: L({ label: 'Capa oculta del MLP', tex: 'U = \\mathrm{LN}_2(x\')W_1 + b_1' }) });
    const gg = op('gelu', gelu(u), ml.concat(['gelu']), { out: 'g', label: 'GELU', type: 'mlp', group: 'mlp', outMeta: L({ label: 'Activación', tex: '\\mathrm{GELU}(U)' }) });
    const f = op('fc2', linear(gg, { dout: D, doutSym: Ds, bias: o.mlpBias !== false }), ml.concat(['fc2']), { out: 'f', label: 'MLP: capa 2 (proyección)', type: 'mlp', group: 'mlp', outMeta: L({ label: 'Salida del MLP', tex: 'F' }) });
    // res2 produce x_ℓ; tras la última de las L repeticiones es x_L (de ahí el id 'x-out').
    return op('res2', residual_add(r1, f), P.concat(['res2']), {
      out: o.outId || 'x-out', label: 'Residual 2', type: 'tensorop', group: 'resid',
      outMeta: { label: 'Salida del encoder (x_L)', tex: 'x_L', perLayer: false, note: 'Salida de cada capa x_ℓ; tras la capa L es x_L.' },
    });
  }

  // ------------------------------------------------------------------ modelos y configs
  const models = {};          // id → definición
  const configIndex = {};     // configId → modelId
  const memo = {};

  function defineModel(def) {
    if (!def || !def.id) throw new Error('defineModel: falta id.');
    if (models[def.id]) throw new Error('defineModel: el modelo "' + def.id + '" ya existe.');
    for (const cid of Object.keys(def.configs || {})) {
      if (configIndex[cid]) throw new Error('defineModel: la config "' + cid + '" ya existe.');
      configIndex[cid] = def.id;
    }
    models[def.id] = def;
  }

  function modelOf(configId) {
    const m = configIndex[configId];
    if (!m) throw new Error('Configuración desconocida: "' + configId + '".');
    return models[m];
  }

  const NON_ARCH = ['B', 'dtype', 'ctx'];   // no cambian la arquitectura (solo bytes)

  function resolve(configId, overrides) {
    const def = modelOf(configId);
    const base = Object.assign({}, def.configs[configId]);
    const ov = Object.assign({}, overrides || {});
    NON_ARCH.forEach((k) => delete ov[k]);
    for (const key of Object.keys(ov)) {
      if (!def.knobs || !(key in def.knobs)) throw new Error('Knob inválido "' + key + '" para el modelo "' + def.id + '". Válidos: ' + Object.keys(def.knobs || {}).join(', ') + '.');
      const v = ov[key];
      if (!Number.isInteger(v) || v <= 0) throw new Error('Knob "' + key + '": el valor debe ser un entero positivo (recibí ' + v + ').');
    }
    const cfg = def.applyKnobs ? def.applyKnobs(base, ov) : Object.assign(base, ov);
    return def.resolve ? def.resolve(cfg) : cfg;
  }

  function memoKey(configId, overrides) {
    const ov = Object.assign({}, overrides || {});
    NON_ARCH.forEach((k) => delete ov[k]);
    return configId + '|' + Object.keys(ov).sort().map((k) => k + '=' + ov[k]).join(',');
  }

  function run(configId, overrides) {
    const key = memoKey(configId, overrides);
    if (memo[key]) return memo[key];
    const def = modelOf(configId);
    const cfg = resolve(configId, overrides);
    const g = def.build(cfg, A);   // build(cfg, A) crea su grafo con A.graph(cfg) y lo devuelve (SPEC §6.4)
    if (!g || typeof g._data !== 'function') throw new Error('El modelo "' + def.id + '" no devolvió un grafo en build().');
    const { tensors, order, ops } = g._data();

    const totals = { params: 0, macs: 0, flops: 0, other: 0, byNode: {}, byPrim: {}, byGroup: {} };
    const bump = (map, k, op) => {
      const e = map[k] || (map[k] = { params: 0, macs: 0, other: 0 });
      e.params += op.params * op.repeat; e.macs += op.macs * op.repeat; e.other += op.other * op.repeat;
    };
    for (const op of ops) {
      totals.params += op.params * op.repeat;
      totals.macs += op.macs * op.repeat;
      totals.other += op.other * op.repeat;
      new Set(op.path).forEach((n) => bump(totals.byNode, n, op));
      bump(totals.byPrim, op.prim, op);
      bump(totals.byGroup, op.group, op);
    }
    totals.flops = 2 * totals.macs;

    const r = {
      id: configId, model: def.id, label: cfg.label || configId, config: cfg, paper: def.paper || null,
      overrides: Object.assign({}, overrides || {}),
      tensors, order, ops, totals, quantities: {}, notes: (cfg._notes || []).slice(),
    };
    delete cfg._notes;
    r.quantities = Object.assign({}, def.quantities ? def.quantities(cfg, r) : {});
    if (r.quantities.tokens === undefined && cfg.tokens !== undefined) r.quantities.tokens = cfg.tokens;
    memo[key] = r;
    return r;
  }

  const DTYPE_BYTES = { fp32: 4, tf32: 4, fp16: 2, bf16: 2, fp8: 1, int8: 1 };

  // metrics: números derivados para el explorador de escala y el "¿qué pasa si…?" (SPEC §6.5).
  function metrics(configId, overrides) {
    const ov = overrides || {};
    const dtype = ov.dtype || 'bf16';
    const B = ov.B === undefined ? 1 : ov.B;
    if (!DTYPE_BYTES[dtype]) throw new Error('dtype desconocido: "' + dtype + '". Válidos: ' + Object.keys(DTYPE_BYTES).join(', ') + '.');
    if (!Number.isInteger(B) || B <= 0) throw new Error('B debe ser un entero positivo.');
    const r = run(configId, ov);
    const by = bytesOf(dtype);
    const cfg = r.config, t = r.totals;
    const isScore = (op) => op.prim === 'attention_scores' || op.prim === 'attention_weighted_sum';
    const scoreMacs = r.ops.filter(isScore).reduce((s, op) => s + op.macs * op.repeat, 0);
    const attnMacs = (t.byGroup.attn || { macs: 0 }).macs;
    // Lineales dentro de las capas (proyecciones de atención + MLP).
    const linearMacs = r.ops.filter((op) => op.prim === 'linear' && (op.path.indexOf('mhsa') >= 0 || op.path.indexOf('mlp') >= 0))
      .reduce((s, op) => s + op.macs * op.repeat, 0);
    const scoreT = r.order.map((id) => r.tensors[id]).find((x) => x.id === 'scores');
    const layers = cfg.L || 1;
    const attnMemLayer = scoreT ? scoreT.elements * by * B : 0;
    // Activaciones (≈, entrenamiento): todos los tensores del forward guardados para el backward.
    const actElems = r.order.reduce((s, id) => {
      const x = r.tensors[id];
      return s + x.elements * (x.perLayer ? layers : 1);
    }, 0);
    const out = {
      id: configId, overrides: Object.assign({}, ov), B, dtype, bytesPerElement: by,
      tokens: r.quantities.tokens,
      params: t.params, macs: t.macs, flops: t.flops, other: t.other,
      attnMacs, attnMacsShare: t.macs ? attnMacs / t.macs : 0,
      scoreMacs, scoreMacsShare: t.macs ? scoreMacs / t.macs : 0,
      linearMacs,
      attnMem: attnMemLayer,                    // bytes: tensor h×N×N de UNA capa, ×B (FlashAttention no lo materializa)
      attnMemAllLayers: attnMemLayer * layers,  // si se guardan las L capas (entrenamiento sin recomputar)
      actMem: actElems * by * B,                // ≈ entrenamiento: todas las activaciones del forward
      paramMem: t.params * by,
      kvCache: null,
    };
    if (cfg.D && cfg.Dmlp) {
      // Por capa: scores (2N²D) vs lineales (N(4D² + 2D·D_mlp)) → se cruzan en N = 2D + D_mlp (= 6D si D_mlp = 4D).
      out.crossoverN = 2 * cfg.D + cfg.Dmlp;
      out.crossoverNProj = 2 * cfg.D;          // solo contra las proyecciones Q, K, V, O
      out.scoreToLinear = out.tokens / out.crossoverN;
    }
    if (cfg.causal && cfg.D) {
      const ctx = ov.ctx || out.tokens;
      out.kvCache = 2 * layers * ctx * cfg.D * by * B;  // K y V de cada capa
    }
    return out;
  }
  function bytesOf(dtype) { return DTYPE_BYTES[dtype]; }

  function configs(model) {
    const out = [];
    for (const mid of Object.keys(models)) {
      if (model && mid !== model) continue;
      const def = models[mid];
      for (const cid of Object.keys(def.configs)) {
        const c = def.configs[cid];
        out.push({ id: cid, label: c.label || cid, model: mid, canonical: !!c.canonical });
      }
    }
    if (model && !models[model]) throw new Error('Modelo desconocido: "' + model + '".');
    return out;
  }

  function model(id) { const d = models[id]; if (!d) throw new Error('Modelo desconocido: "' + id + '".'); return d; }

  const A = Object.assign(ATLAS.Arch || {}, PRIMS, {
    shape, graph, preLnLayer, defineModel, run, metrics, resolve, fmt, primitives,
    configs, models: () => Object.keys(models), model, hasConfig: (id) => !!configIndex[id],
    canonical: (mid) => { const c = configs(mid).find((x) => x.canonical); return c ? c.id : null; },
    DTYPE_BYTES: Object.assign({}, DTYPE_BYTES), OTHER_COST: Object.assign({}, OTHER),
    _clearMemo: () => { for (const k of Object.keys(memo)) delete memo[k]; },
  });
  ATLAS.Arch = A;
})(typeof window !== 'undefined' ? window : globalThis);
