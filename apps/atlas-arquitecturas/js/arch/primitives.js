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
     head|resid|act), `detail`, `batched` (CLIP: op de la parte conjunta). tensor: también `elements`
     y `batched` (ya incluye el batch B). totals: también `byGroup` y `byPath` (clave = path unido
     con '>', p. ej. 'txt-encoder>enc-layer': separa nodos que repiten id en dos lugares, como las
     dos torres de CLIP o W-MSA/SW-MSA de Swin); byNode[id] también trae `other`.
     Resultado: también `overrides` y `notes` (avisos, p. ej. interpolación de position embeddings).
   - run(configId, overrides?) acepta knobs (memoizado por configId + overrides).
   - metrics(configId, overrides) acepta además `B`, `dtype` ('fp32'|'fp16'|'bf16'|'fp8'|'int8') y
     `ctx` (largo para kvCache) dentro de overrides (no cambian la arquitectura, solo los bytes;
     salvo en un modelo que declare B como knob — CLIP —, donde B también cambia los tensores
     conjuntos y su valor por defecto es el de la config). attnMem/actMem/kvCache se devuelven como
     números (bytes) para esos B y dtype (por defecto B=1, bf16). kvCache = null en modelos sin
     máscara causal. attnMem = el mayor tensor de scores de una capa; attnMemAllLayers = todos.
     actMem (≈, entrenamiento) = cada tensor materializado del forward una vez por repetición de su
     op, SIN vistas/movimientos (split/merge de cabezas, flatten, partición de ventanas, roll),
     SIN tablas de parámetros (e-pos) y SIN los scores previos al softmax (QKᵀ, escalados, con
     sesgo o máscara: el backward no los guarda). Cada modelo puede añadir claves (def.metrics).
   - Primitivas extra `scale` (×1/√d_h), `add` (suma no residual), `flatten` (rejilla → secuencia).
   - Tensores extra respecto de SPEC §13.1 (añadidos, nada renombrado): `e-pos` (tabla de posición)
     y `scores-scaled` (salida del nodo `scale`). Ver la cabecera de js/arch/vit.js.
   - Fase 2 (Swin, ResNet, CLIP): batchnorm2d, relu, maxpool2d, global_avg_pool, conv_bn,
     bottleneck, cyclic_shift, window_partition, window_reverse, rel_pos_bias, attn_mask,
     causal_mask, window_attention, patch_concat, patch_merging, causal_self_attention, pick_token,
     l2_normalize, stack_batch, similarity_logits, logit_scale, contrastive_loss. Las primitivas de
     atención aceptan una dimensión delantera de ventanas (nW×…); layouts nuevos 'windows'
     (nW×M²×C), 'winheads' (nW×h×M²×d_h) y 'mat' (B×B). conv2d acepta `floor` (redondeo de PyTorch).
   - Fase 3 (DETR, Deformable DETR): frozen_batchnorm2d (γ, β y estadísticas congeladas = buffers),
     group_norm, sigmoid, sine_pos_encoding (PE 2-D seno/coseno, buffer), level_embed, add_level_embed,
     flatten_levels, learned_queries, zeros_init, split_qkv_heads (Q, K, V con largos distintos),
     multihead_attention y cross_attention (compuestas; Q de una secuencia, K/V de otra; posición opcional
     solo en Q y K), reference_points (rejilla de puntos de referencia por nivel), deform_sample
     (muestreo bilineal: 4 MACs por canal y punto), deform_weighted_sum (suma ponderada de los puntos
     muestreados), deformable_attention (compuesta: lineal en tokens, sin término N_q·N_k), ref_offset
     (suma inverse_sigmoid(ref) a la caja), box_mlp (compuesta), hungarian_cost (matriz Q×G),
     hungarian_match y set_prediction_loss (solo "otros"). conv_bn y bottleneck aceptan `frozenBN`
     (sin la opción, el resultado es exactamente el de la fase 2).
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

  // bytes(n): ÚNICO formateador de memoria de la app. Unidades DECIMALES (SI): 1 KB = 1000 B,
  // 1 MB = 10⁶ B, 1 GB = 10⁹ B, 1 TB = 10¹² B (como las fichas de GPU y los tamaños de checkpoint).
  // 931,416 → '931.4 KB' · 173,135,312 → '173.1 MB' · 2,000,000 → '2.00 MB' · 512 → '512 B'.
  // Dos decimales por debajo de 10 y uno por encima (≥ 3 cifras significativas).
  function bytes(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    const a = Math.abs(n);
    const units = [[1e12, 'TB'], [1e9, 'GB'], [1e6, 'MB'], [1e3, 'KB']];
    for (const [v, u] of units) {
      if (a >= v) {
        const x = n / v;
        let s = x.toFixed(Math.abs(x) < 10 ? 2 : 1);
        // 999.96 KB → '1000.0 KB': sube de unidad.
        if (Math.abs(parseFloat(s)) >= 1000 && v < 1e12) { const y = n / (v * 1e3); s = y.toFixed(2); return s + ' ' + units[units.findIndex((w) => w[0] === v) - 1][1]; }
        return s + ' ' + u;
      }
    }
    return int(n) + ' B';
  }

  // ops(n, unit): cómputo con el prefijo pegado a la unidad, formato único de la app:
  // 17,563,828,224 → '17.56 GMACs' · ops(n, 'FLOPs') → '35.13 GFLOPs' · 872 → '872 MACs'.
  function ops(n, unit) {
    const u = unit || 'MACs';
    const s = si(n);
    const m = s.match(/^(.*) ([KMGT])$/);
    return m ? m[1] + ' ' + m[2] + u : s + ' ' + u;
  }

  function pct(x, decimals) { return (x * 100).toFixed(decimals === undefined ? 1 : decimals) + ' %'; }

  // Símbolos: texto plano y LaTeX.
  const SYM_TEX = { D_mlp: 'D_{\\mathrm{mlp}}', d_h: 'd_h', 'P^2C': 'P^2C', nW: 'n_W', 'M²': 'M^2', D_t: 'D_t',
    // Fase 3 (Deformable DETR): h cabezas, L niveles, K puntos por cabeza y nivel (notación del paper, salvo h).
    'hLK·2': 'hLK\\cdot 2', K_cls: 'K_{\\mathrm{cls}}' };
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
  // k·sym en LaTeX: 2·D → '2D'; 2·2C → '4C'; 2·64 → '128' (símbolos que empiezan por un entero).
  function texScale(k, sym) {
    const m = String(sym).match(/^(\d+)(.*)$/);
    if (m && !compound(sym)) return String(k * parseInt(m[1], 10)) + symTexAtom(m[2]);
    return k + symTexFactor(sym);
  }

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

  const fmt = { int, si, ops, bytes, pct, shape: shapeStr, shapeTex, symText, symTex: symTexShape };

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
  const OTHER = { bias: 1, add: 1, scale: 1, layernorm: 5, rmsnorm: 4, softmax: 5, gelu: 8,
    batchnorm: 5, relu: 1, mask: 1, l2norm: 3,
    // Fase 3: BN congelada = escala + desplazamiento; GroupNorm como LayerNorm; sigmoide; PE seno/coseno.
    frozenbn: 2, groupnorm: 5, sigmoid: 4, sinpos: 3 };

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
    // o.floor: redondeo hacia abajo como PyTorch (ResNet: 7×7 s2 p3 sobre 224 → 112). Sin floor, exige divisibilidad.
    if (!o.floor && ((H + 2 * p - k) % s !== 0 || (W + 2 * p - k) % s !== 0)) {
      throw new Error('conv2d: la resolución ' + H + '×' + W + ' no es divisible por el stride ' + s + ' (con kernel ' + k + ').');
    }
    const Ho = Math.floor((H + 2 * p - k) / s) + 1, Wo = Math.floor((W + 2 * p - k) / s) + 1;
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
      paramTex: affine2 ? texScale(2, Ds) : symTexFactor(Ds),
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

  // Las primitivas de atención aceptan dimensiones delanteras opcionales (ventanas de Swin: nW×…):
  // split_heads nW×N×3D → 3 × [nW×h×N×d_h]; con entrada 2-D el resultado es el de siempre.
  // split_heads: N×(parts·D) → parts × [h×N×d_h]. o = {h, parts=1, hSym='h', dhSym='d_h'}
  function split_heads(x, o) {
    const parts = o.parts || 1, h = o.h;
    const nd = x.num.length;
    const lead = x.num.slice(0, nd - 2), leadSym = x.sym.slice(0, nd - 2);
    const N = x.num[nd - 2], W = x.num[nd - 1], Ns = x.sym[nd - 2];
    if (W % parts !== 0) throw new Error('split_heads: ' + W + ' no es divisible en ' + parts + ' partes.');
    const D = W / parts;
    if (D % h !== 0) throw new Error('split_heads: D = ' + D + ' no es divisible por h = ' + h + '.');
    const dh = D / h;
    const mk = () => shape(leadSym.concat([o.hSym || 'h', Ns, o.dhSym || 'd_h']), lead.concat([h, N, dh]), x.mod, lead.length ? 'winheads' : 'heads');
    const outs = Array.from({ length: parts }, mk);
    return result('split_heads', [x], parts === 1 ? outs[0] : outs, { detail: { h, dh, parts } });
  }

  // merge_heads: h×N×d_h → N×D (concatenar cabezas). Con ventanas: nW×h×N×d_h → nW×N×D.
  function merge_heads(z, o) {
    const nd = z.num.length;
    const lead = z.num.slice(0, nd - 3), leadSym = z.sym.slice(0, nd - 3);
    const h = z.num[nd - 3], N = z.num[nd - 2], dh = z.num[nd - 1];
    return result('merge_heads', [z], shape(leadSym.concat([z.sym[nd - 2], (o && o.Dsym) || 'D']), lead.concat([N, h * dh]), z.mod, lead.length ? 'windows' : 'seq'), { detail: { h, dh } });
  }

  // attention_scores: Q (h×Nq×d_h) · Kᵀ (h×d_h×Nk) → h×Nq×Nk. MACs h·Nq·Nk·d_h (= Nq·Nk·D).
  // Con ventanas: nW×h×M²×d_h → nW×h×M²×M², MACs nW·h·M²·M²·d_h (= H·W·M²·C).
  function attention_scores(q, k) {
    const nd = q.num.length;
    const lead = q.num.slice(0, nd - 3), leadSym = q.sym.slice(0, nd - 3);
    const [h, Nq, dh] = q.num.slice(nd - 3), Nk = k.num[nd - 2];
    if (k.num.length !== nd || k.num[nd - 3] !== h || k.num[nd - 1] !== dh || lead.some((v, i) => k.num[i] !== v)) throw new Error('attention_scores: Q y K con cabezas o d_h distintos.');
    const qs = q.sym.slice(nd - 3);
    const out = shape(leadSym.concat([qs[0], qs[1], k.sym[nd - 2]]), lead.concat([h, Nq, Nk]), q.mod, lead.length ? 'winheads' : 'heads');
    return result('attention_scores', [q, k], out, {
      macTerms: [lead.concat([h, Nq, Nk, dh])], macTex: texProd(leadSym.concat([qs[0], qs[1], k.sym[nd - 2], qs[2]])),
      detail: Object.assign({ h, Nq, Nk, dh, note: 'h·N·N·d_h = N²·D' }, lead.length ? { windows: prod(lead) } : {}),
    });
  }

  // attention_weighted_sum: A (h×Nq×Nk) · V (h×Nk×d_h) → h×Nq×d_h.
  function attention_weighted_sum(a, v) {
    const nd = a.num.length;
    const lead = a.num.slice(0, nd - 3), leadSym = a.sym.slice(0, nd - 3);
    const [h, Nq, Nk] = a.num.slice(nd - 3), dh = v.num[nd - 1];
    if (v.num.length !== nd || v.num[nd - 3] !== h || v.num[nd - 2] !== Nk) throw new Error('attention_weighted_sum: A y V incompatibles.');
    const as = a.sym.slice(nd - 3);
    const out = shape(leadSym.concat([as[0], as[1], v.sym[nd - 1]]), lead.concat([h, Nq, dh]), a.mod, lead.length ? 'winheads' : 'heads');
    return result('attention_weighted_sum', [a, v], out, {
      macTerms: [lead.concat([h, Nq, Nk, dh])], macTex: texProd(leadSym.concat([as[0], as[1], as[2], v.sym[nd - 1]])),
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

  // ---- Fase 2 (Swin, ResNet, CLIP): primitivas elementales ------------------------------
  // batchnorm2d: γ y β por canal (2C parámetros). Media y varianza móviles (y el contador) son buffers.
  function batchnorm2d(x) {
    const C = x.num[x.num.length - 1], Cs = x.sym[x.sym.length - 1];
    return result('batchnorm2d', [x], plain(x), {
      paramTerms: [[2, C]], paramTex: texScale(2, Cs), other: elems(x) * OTHER.batchnorm,
      detail: { C, buffers: 2 * C + 1, note: 'running_mean y running_var (2C) + num_batches_tracked: buffers, no parámetros' },
    });
  }
  const relu = (x) => elementwise('relu', x, OTHER.relu);

  // maxpool2d: ventana k×k, stride s, padding p; redondeo hacia abajo (PyTorch). o = {k, s=k, p=0, outSym}
  function maxpool2d(x, o) {
    const [H, W, C] = x.num, k = o.k, s = o.s || o.k, p = o.p || 0;
    const Ho = Math.floor((H + 2 * p - k) / s) + 1, Wo = Math.floor((W + 2 * p - k) / s) + 1;
    const os = o.outSym || [String(Ho), String(Wo)];
    return result('maxpool2d', [x], shape([os[0], os[1], x.sym[2]], [Ho, Wo, C], x.mod, 'grid'), {
      other: Ho * Wo * C * k * k, detail: { k, s, p, Ho, Wo },
    });
  }

  // global_avg_pool: H×W×C → C (promedio espacial; ≈ 1 suma por elemento).
  function global_avg_pool(x) {
    const [H, W, C] = x.num;
    return result('global_avg_pool', [x], shape([x.sym[2]], [C], x.mod, 'vec'), { other: H * W * C, detail: { H, W, C } });
  }

  // cyclic_shift (Swin): torch.roll de la rejilla H×W×C por −⌊M/2⌋ en filas y columnas (o +⌊M/2⌋ si inverse).
  // Mueve tokens, no calcula: 0 parámetros, 0 MACs.
  function cyclic_shift(x, o) {
    return result('cyclic_shift', [x], plain(x), { detail: { shift: o.s, inverse: !!o.inverse } });
  }

  // window_partition (Swin): H×W×C → nW×M²×C, nW = (H/M)·(W/M) ventanas de M×M tokens.
  // o = {M, nWSym='nW', tokSym='M²'}
  function window_partition(x, o) {
    const [H, W, C] = x.num, M = o.M;
    if (H % M !== 0 || W % M !== 0) throw new Error('window_partition: la rejilla ' + H + '×' + W + ' no es divisible por la ventana M = ' + M + '.');
    const nW = (H / M) * (W / M);
    return result('window_partition', [x], shape([o.nWSym || 'nW', o.tokSym || 'M²', x.sym[2]], [nW, M * M, C], x.mod, 'windows'), {
      detail: { M, nW, H, W },
    });
  }

  // window_reverse (Swin): nW×M²×C → H×W×C (inversa de window_partition). o = {H, W, M, outSym:[hs, ws]}
  function window_reverse(x, o) {
    const [nW, MM, C] = x.num;
    if (nW * MM !== o.H * o.W) throw new Error('window_reverse: ' + nW + '×' + MM + ' tokens no llenan una rejilla ' + o.H + '×' + o.W + '.');
    return result('window_reverse', [x], shape([o.outSym[0], o.outSym[1], x.sym[2]], [o.H, o.W, C], x.mod, 'grid'), { detail: { M: o.M, nW } });
  }

  // rel_pos_bias (Swin): scores + B, con B tomado de una tabla aprendida (2M−1)²×h (parámetro) mediante
  // un índice de posición relativa M²×M² (buffer). Suma elementwise.
  function rel_pos_bias(x, o) {
    const M = o.M, h = o.h, Ms = o.Msym || 'M', hs = o.hSym || 'h';
    const t = '(2' + Ms + '-1)^2';
    return result('rel_pos_bias', [x], plain(x), {
      paramTerms: [[2 * M - 1, 2 * M - 1, h]], paramTex: t + '\\cdot ' + symTexFactor(hs),
      other: elems(x) * OTHER.add, detail: { M, h, table: [(2 * M - 1) * (2 * M - 1), h], index: [M * M, M * M] },
    });
  }

  // attn_mask (Swin, SW-MSA): suma una máscara fija nW×M²×M² (0 / −100) que impide atender entre
  // regiones que el desplazamiento cíclico juntó en la misma ventana. Buffer: 0 parámetros.
  function attn_mask(x) {
    return result('attn_mask', [x], plain(x), { other: elems(x) * OTHER.mask, detail: { note: 'máscara = buffer (no parámetro)' } });
  }

  // causal_mask: pone −∞ sobre el triángulo superior de los scores (texto de CLIP, decoders).
  // No cambia parámetros ni MACs: una implementación ingenua calcula igual los N² scores.
  function causal_mask(x) {
    const N = x.num[x.num.length - 1], rows = x.num[x.num.length - 2];
    const heads = elems(x) / (N * rows);
    return result('causal_mask', [x], plain(x), {
      other: elems(x) * OTHER.mask,
      detail: { used: heads * rows * (rows + 1) / 2, masked: heads * rows * (rows - 1) / 2 },
    });
  }

  // patch_concat (Swin, patch merging): concatena los 2×2 vecinos: H×W×C → H/2×W/2×4C. o.outSym = [hs, ws, cs]
  function patch_concat(x, o) {
    const [H, W, C] = x.num;
    if (H % 2 !== 0 || W % 2 !== 0) throw new Error('patch_concat: la rejilla ' + H + '×' + W + ' no es par.');
    const os = (o && o.outSym) || [x.sym[0] + '/2', x.sym[1] + '/2', '4' + x.sym[2]];
    return result('patch_concat', [x], shape(os, [H / 2, W / 2, 4 * C], x.mod, 'grid'), { detail: { H, W, C } });
  }

  // pick_token: toma una fila de una secuencia T×D → D (CLIP texto: el token EOT). o.index = descripción
  function pick_token(x, o) {
    return result('pick_token', [x], shape([x.sym[x.sym.length - 1]], [x.num[x.num.length - 1]], x.mod, 'vec'), { detail: { index: (o && o.index) || null } });
  }

  // l2_normalize: x / ‖x‖₂ por fila (≈ 3 ops por elemento). Sin parámetros.
  function l2_normalize(x) {
    return result('l2_normalize', [x], plain(x), { other: elems(x) * OTHER.l2norm });
  }

  // stack_batch: apila B vectores de una muestra: E → B×E (el resto del grafo es por muestra).
  function stack_batch(x, o) {
    const out = shape([o.Bsym || 'B', x.sym[0]], [o.B, x.num[0]], x.mod, 'seq');
    return result('stack_batch', [x], out, { detail: { B: o.B } });
  }

  // similarity_logits (CLIP): I (B×E) · Tᵀ (E×B) → B×B. MACs B·B·E.
  function similarity_logits(a, b) {
    const [B1, E] = a.num, [B2, E2] = b.num;
    if (E !== E2) throw new Error('similarity_logits: dimensiones de embedding distintas (' + E + ' y ' + E2 + ').');
    const out = shape([a.sym[0], b.sym[0]], [B1, B2], null, 'mat');
    return result('similarity_logits', [a, b], out, {
      macTerms: [[B1, B2, E]], macTex: texProd([a.sym[0], b.sym[0], a.sym[1]]), detail: { B: B1, E },
    });
  }

  // logit_scale (CLIP): multiplica por e^t, con t un escalar aprendido (1 parámetro; init 1/0.07, tope 100).
  function logit_scale(x) {
    return result('logit_scale', [x], plain(x), { paramTerms: [[1]], paramTex: '1', other: elems(x) * OTHER.scale, detail: { init: 1 / 0.07, max: 100 } });
  }

  // contrastive_loss (CLIP, InfoNCE simétrica): ½·[CE por filas (imagen→texto) + CE por columnas
  // (texto→imagen)], etiquetas = la diagonal. B×B → escalar. Solo "otros": 2 softmax de B² + 2B.
  function contrastive_loss(x) {
    const B = x.num[0];
    return result('contrastive_loss', [x], shape(['1'], [1], null, 'vec'), {
      other: 2 * B * B * OTHER.softmax + 2 * B, detail: { B, negatives: B - 1 },
    });
  }

  // ---- Fase 3 (DETR, Deformable DETR): primitivas elementales -----------------------------
  // frozen_batchnorm2d (DETR y Deformable DETR, código oficial y HF): BatchNorm con γ, β, media y varianza
  // CONGELADAS, guardadas como buffers (4C): 0 parámetros. En inferencia es x·escala + desplazamiento.
  function frozen_batchnorm2d(x) {
    const C = x.num[x.num.length - 1];
    return result('frozen_batchnorm2d', [x], plain(x), {
      params: 0, other: elems(x) * OTHER.frozenbn,
      detail: { C, buffers: 4 * C, affine: 2 * C, note: 'γ, β, running_mean y running_var son buffers (4C): 0 parámetros; una BatchNorm normal tendría 2C parámetros' },
    });
  }

  // group_norm: γ y β por canal (2C parámetros); normaliza por grupos de canales. o.groups (32 en Deformable DETR).
  function group_norm(x, o) {
    const C = x.num[x.num.length - 1], Cs = x.sym[x.sym.length - 1];
    return result('group_norm', [x], plain(x), {
      paramTerms: [[2, C]], paramTex: texScale(2, Cs), other: elems(x) * OTHER.groupnorm, detail: { C, groups: (o && o.groups) || 32 },
    });
  }

  // sigmoid: elementwise (cajas normalizadas a [0, 1], puntos de referencia).
  const sigmoid = (x) => elementwise('sigmoid', x, OTHER.sigmoid);

  // sine_pos_encoding (DETR): codificación posicional 2-D FIJA (seno/coseno de y y de x, D/2 canales por
  // eje, temperatura 10,000, coordenadas normalizadas a [0, 2π]). Buffer calculado: 0 parámetros.
  // Sin entrada de datos (solo depende del tamaño de la rejilla). o = {H, W} o {levels:[[H,W],…]}, D,
  // rowsSym='N', Dsym='D'. Con varios niveles (Deformable DETR) devuelve los niveles concatenados.
  function sine_pos_encoding(o) {
    const lv = o.levels || [[o.H, o.W]];
    const rows = lv.reduce((s, hw) => s + hw[0] * hw[1], 0);
    const out = shape([o.rowsSym || 'N', o.Dsym || 'D'], [rows, o.D], o.mod || 'img', 'seq');
    return result('sine_pos_encoding', [], out, {
      other: rows * o.D * OTHER.sinpos,
      detail: { levels: lv.map((x) => x.slice()), D: o.D, perAxis: o.D / 2, temperature: o.temperature || 10000, normalize: o.normalize !== false, buffer: true,
        note: 'PE(y, x) = [sin/cos(y/T^{2i/(D/2)}), sin/cos(x/T^{2i/(D/2)})]: buffer, no parámetro' },
    });
  }

  // level_embed (Deformable DETR): tabla aprendida L×D, un vector por nivel de la pirámide (se suma a la PE).
  function level_embed(o) {
    const out = shape([o.Lsym || 'L', o.Dsym || 'D'], [o.L, o.D], o.mod || 'img', 'seq');
    return result('level_embed', [], out, { paramTerms: [[o.L, o.D]], paramTex: texProd([o.Lsym || 'L', o.Dsym || 'D']), detail: { L: o.L, D: o.D } });
  }

  // add_level_embed: PE (N×D, niveles concatenados) + el vector de su nivel (tabla L×D) → N×D.
  function add_level_embed(pos, table, o) {
    if (pos.num[1] !== table.num[1]) throw new Error('add_level_embed: anchos distintos.');
    return result('add_level_embed', [pos, table], plain(pos), { other: elems(pos) * OTHER.add, detail: { levels: (o && o.levels) || null } });
  }

  // flatten_levels (Deformable DETR): aplana y concatena las rejillas de cada nivel: Σ H_l·W_l × C.
  function flatten_levels(grids, o) {
    const C = grids[0].num[2];
    grids.forEach((g) => { if (g.num[2] !== C) throw new Error('flatten_levels: canales distintos entre niveles.'); });
    const rows = grids.reduce((s, g) => s + g.num[0] * g.num[1], 0);
    return result('flatten_levels', grids, shape((o && o.sym) || ['N', grids[0].sym[2]], [rows, C], grids[0].mod, 'seq'), {
      detail: { levels: grids.map((g) => [g.num[0], g.num[1]]), tokens: grids.map((g) => g.num[0] * g.num[1]) },
    });
  }

  // learned_queries (DETR): Q vectores aprendidos ("object queries" = query_pos, Q×D). o.split (Deformable
  // DETR): una tabla Q×2D que se parte en query_pos y tgt (dos salidas Q×D). Sin entrada de datos.
  function learned_queries(o) {
    const Qs = o.Qsym || 'Q', Ds = o.Dsym || 'D';
    const mk = () => shape([Qs, Ds], [o.Q, o.D], o.mod || 'qry', 'seq');
    const split = !!o.split;
    return result('learned_queries', [], split ? [mk(), mk()] : mk(), {
      paramTerms: [[o.Q, split ? 2 * o.D : o.D]], paramTex: split ? symTexFactor(Qs) + '\\cdot ' + texScale(2, Ds) : texProd([Qs, Ds]),
      detail: { Q: o.Q, D: o.D, split },
    });
  }

  // zeros_init (DETR): la entrada del decoder empieza en ceros (Q×D); la identidad de cada query está
  // en query_pos, que se suma en cada capa. 0 parámetros.
  function zeros_init(o) {
    return result('zeros_init', [], shape([o.rowsSym || 'Q', o.Dsym || 'D'], [o.rows, o.D], o.mod || 'qry', 'seq'), { detail: { rows: o.rows, D: o.D } });
  }

  // split_qkv_heads: Q (N_q×D), K y V (N_k×D) ya proyectados → h×N_q×d_h, h×N_k×d_h, h×N_k×d_h.
  // A diferencia de split_heads, Q y K/V pueden tener largos distintos (cross-attention).
  function split_qkv_heads(q, k, v, o) {
    const h = o.h;
    if (q.num[1] !== k.num[1] || k.num[1] !== v.num[1]) throw new Error('split_qkv_heads: Q, K y V con anchos distintos.');
    if (k.num[0] !== v.num[0]) throw new Error('split_qkv_heads: K y V deben tener el mismo largo.');
    if (q.num[1] % h !== 0) throw new Error('split_qkv_heads: D = ' + q.num[1] + ' no es divisible por h = ' + h + '.');
    const dh = q.num[1] / h;
    const mk = (x) => shape([o.hSym || 'h', x.sym[0], o.dhSym || 'd_h'], [h, x.num[0], dh], x.mod, 'heads');
    return result('split_qkv_heads', [q, k, v], [mk(q), mk(k), mk(v)], { detail: { h, dh, Nq: q.num[0], Nk: k.num[0] } });
  }

  // reference_points (Deformable DETR, encoder): el centro normalizado de cada token de cada nivel, repetido
  // para los L niveles (N×L×2). Calculado, sin parámetros ni MACs. o = {levels:[[H,W],…], rowsSym, Lsym}
  function reference_points(o) {
    const lv = o.levels, L = lv.length;
    const rows = lv.reduce((s, hw) => s + hw[0] * hw[1], 0);
    return result('reference_points', [], shape([o.rowsSym || 'N', o.Lsym || 'L', '2'], [rows, L, 2], o.mod || 'img', 'seq'), {
      other: rows * L * 2 * 2, detail: { levels: lv.map((x) => x.slice()) },
    });
  }

  // deform_sample (Deformable DETR): para cada query, cabeza, nivel y punto, interpola bilinealmente el
  // value (4 vecinos) en ref + Δ. value N_v×D, offsets N_q×(hLK·2) [, ref] → h×N_q×LK×d_h.
  // MACs 4·h·N_q·L·K·d_h (4 multiplica-acumula por canal y punto); las coordenadas y los 4 pesos
  // bilineales por punto van a "otros". FlopCounterMode NO lo cuenta (grid_sample): analítico.
  function deform_sample(value, offsets, ref, o) {
    const h = o.h, L = o.L, K = o.K, D = value.num[1], Nq = offsets.num[0];
    if (D % h !== 0) throw new Error('deform_sample: D no es divisible por h.');
    if (offsets.num[1] !== h * L * K * 2) throw new Error('deform_sample: los offsets deben tener h·L·K·2 = ' + (h * L * K * 2) + ' canales.');
    const dh = D / h, Qs = offsets.sym[0];
    const out = shape([o.hSym || 'h', Qs, 'LK', 'd_h'], [h, Nq, L * K, dh], offsets.mod, 'heads');
    return result('deform_sample', [value, offsets, ref], out, {
      macTerms: [[4, h, Nq, L, K, dh]], macTex: '4\\,' + texProd(['h', Qs]) + '\\cdot LK\\cdot d_h',
      other: h * Nq * L * K * 10,
      detail: { h, L, K, dh, Nq, Nv: value.num[0], samples: h * L * K, note: 'bilineal: 4 vecinos por punto; sin término N_q·N_v' },
    });
  }

  // deform_weighted_sum: Σ_{l,k} A·v(muestra) por cabeza y concatena: h×N_q×LK×d_h, pesos N_q×hLK → N_q×D.
  // MACs h·N_q·L·K·d_h (= N_q·LK·D), el análogo de A·V pero con LK = 16 claves en vez de N.
  function deform_weighted_sum(sampled, weights, o) {
    const [h, Nq, LK, dh] = sampled.num;
    if (weights.num[0] !== Nq || weights.num[1] !== h * LK) throw new Error('deform_weighted_sum: pesos incompatibles (' + weights.num.join('×') + ').');
    const out = shape([sampled.sym[1], (o && o.Dsym) || 'D'], [Nq, h * dh], sampled.mod, 'seq');
    return result('deform_weighted_sum', [sampled, weights], out, {
      macTerms: [[h, Nq, LK, dh]], macTex: texProd(['h', sampled.sym[1]]) + '\\cdot LK\\cdot d_h', detail: { h, Nq, LK, dh },
    });
  }

  // ref_offset (Deformable DETR): caja = MLP(hs) + inverse_sigmoid(ref) en (cx, cy) antes de la sigmoide.
  function ref_offset(x, ref) {
    return result('ref_offset', [x, ref], plain(x), { other: ref.num[0] * ref.num[1] * 5, detail: { note: 'Δ + σ⁻¹(ref) en cx, cy' } });
  }

  // hungarian_cost (DETR, solo entrenamiento): matriz de costos Q×G entre predicciones y objetos reales:
  // C = λ_cls·(−p̂(c)) + λ_L1·‖b − b̂‖₁ + λ_giou·(−GIoU). Sin parámetros ni MACs ("otros" ≈).
  // o = {wCls, wL1, wGiou, focal}
  function hungarian_cost(logits, boxes, gtLabels, gtBoxes, o) {
    const Q = logits.num[0], C = logits.num[1], G = gtBoxes.num[0];
    o = o || {};
    const out = shape([logits.sym[0], gtBoxes.sym[0]], [Q, G], null, 'seq');
    return result('hungarian_cost', [logits, boxes, gtLabels, gtBoxes], out, {
      other: Q * C * OTHER.softmax + Q * G * 45,
      detail: { Q, G, classes: C, entries: Q * G, wCls: o.wCls, wL1: o.wL1, wGiou: o.wGiou, focal: !!o.focal },
    });
  }

  // hungarian_match: asignación uno a uno de costo mínimo (scipy linear_sum_assignment): G pares
  // (query, objeto); las Q − G queries restantes → "no object" (∅). ≈ Q·G·min(Q, G) operaciones.
  function hungarian_match(cost) {
    const [Q, G] = cost.num;
    return result('hungarian_match', [cost], shape([cost.sym[1], '2'], [G, 2], null, 'seq'), {
      other: Q * G * Math.min(Q, G), detail: { Q, G, matched: G, unmatched: Q - G },
    });
  }

  // set_prediction_loss (DETR): CE de clase sobre las Q queries (∅ con peso eos) + L1 + GIoU sobre las G
  // emparejadas. o = {wCe, wL1, wGiou, eos, focal}. → escalar. Solo "otros".
  function set_prediction_loss(logits, boxes, assign, gtLabels, gtBoxes, o) {
    const Q = logits.num[0], C = logits.num[1], G = gtBoxes.num[0];
    o = o || {};
    return result('set_prediction_loss', [logits, boxes, assign, gtLabels, gtBoxes], shape(['1'], [1], null, 'vec'), {
      other: Q * C * OTHER.softmax + G * 45,
      detail: { Q, G, wCe: o.wCe, wL1: o.wL1, wGiou: o.wGiou, eos: o.eos, focal: !!o.focal },
    });
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

  // ---- Fase 2: compuestas ---------------------------------------------------------------
  // conv_bn: conv (sin sesgo) → BatchNorm (→ ReLU). o = opciones de conv2d + {relu=true}. Redondeo floor.
  // o.frozenBN (fase 3, DETR): la BN es frozen_batchnorm2d (buffers): solo cuentan los pesos de la conv.
  function conv_bn(x, o) {
    const cv = conv2d(x, Object.assign({ floor: true, s: 1 }, o, { bias: false }));   // stride 1 por defecto (no el de patchify)
    const bn = o.frozenBN ? frozen_batchnorm2d(cv.out) : batchnorm2d(cv.out);
    const parts = [cv, bn];
    if (o.relu !== false) parts.push(relu(bn.out));
    return composite('conv_bn', x, parts, parts[parts.length - 1].out, {
      paramTex: o.frozenBN ? 'k^2\\,C_{in}\\,C_{out}' : 'k^2\\,C_{in}\\,C_{out} + 2C_{out}', macTex: 'H_o\\,W_o\\,C_{out}\\,k^2\\,C_{in}',
      detail: Object.assign({ k: o.k, s: o.s || 1, relu: o.relu !== false }, o.frozenBN ? { frozenBN: true } : {}),
    });
  }

  // bottleneck (ResNet-50, torchvision v1.5: el stride va en la 3×3):
  //   1×1 (C_in→w) → BN → ReLU → 3×3 s (w→w) → BN → ReLU → 1×1 (w→4w) → BN, + atajo, → ReLU.
  //   Atajo = identidad, o proyección 1×1 s (C_in→4w) + BN cuando cambian canales o resolución.
  // o = {width, cout=4·width, stride=1, project}
  // o.frozenBN (fase 3): todas sus BN congeladas (buffers), como el backbone de DETR.
  function bottleneck(x, o) {
    const w = o.width, cout = o.cout || 4 * w, s = o.stride || 1;
    const project = o.project !== undefined ? o.project : (s !== 1 || x.num[2] !== cout);
    const fz = o.frozenBN ? { frozenBN: true } : {};
    const a = conv_bn(x, Object.assign({ k: 1, cout: w }, fz));
    const b = conv_bn(a.out, Object.assign({ k: 3, s, p: 1, cout: w }, fz));
    const c = conv_bn(b.out, Object.assign({ k: 1, cout, relu: false }, fz));
    const parts = [a, b, c];
    let sc = x;
    if (project) { const d = conv_bn(x, Object.assign({ k: 1, s, cout, relu: false }, fz)); parts.push(d); sc = d.out; }
    const ad = residual_add(sc, c.out);
    const r = relu(ad.out);
    parts.push(ad, r);
    return composite('bottleneck', x, parts, r.out, {
      paramTex: o.frozenBN ? 'C_{in}w + 9w^2 + 4w^2' + (project ? ' + 4w\\,C_{in}' : '')
        : 'C_{in}w + 9w^2 + 4w^2 + 2(6w)' + (project ? ' + 4w\\,C_{in} + 8w' : ''),
      macTex: 'H\\,W\\,C_{in}w + H_o W_o (9w^2 + 4w^2)' + (project ? ' + H_o W_o\\,4w\\,C_{in}' : ''),
      detail: Object.assign({ width: w, cout, stride: s, project }, fz),
    });
  }

  // window_attention (Swin W-MSA / SW-MSA) sobre una rejilla H×W×C:
  //   [shift] → partición nW×M²×C → qkv → cabezas → QKᵀ → escala → + sesgo relativo → [máscara] →
  //   softmax → ·V → concatenar → proyección → revertir partición → [unshift].
  // o = {M, h, shift=0, qkvBias=true, projBias=true}
  // Parámetros 4C² + 4C + (2M−1)²·h. MACs H·W·4C² + 2·H·W·M²·C (vs 2·(HW)²·C de la atención global).
  function window_attention(x, o) {
    const [H, W, C] = x.num, M = o.M;
    const parts = [];
    let t = x;
    if (o.shift) { const sh = cyclic_shift(t, { s: o.shift }); parts.push(sh); t = sh.out; }
    const wp = window_partition(t, { M }); parts.push(wp);
    const qkv = linear(wp.out, { dout: 3 * C, doutSym: '3' + x.sym[2], bias: o.qkvBias !== false }); parts.push(qkv);
    const sp = split_heads(qkv.out, { h: o.h, parts: 3 }); parts.push(sp);
    const [q, k, v] = sp.out;
    const sc = attention_scores(q, k); parts.push(sc);
    const sl = scale(sc.out); parts.push(sl);
    const bi = rel_pos_bias(sl.out, { M, h: o.h }); parts.push(bi);
    let pre = bi.out;
    if (o.shift) { const mk = attn_mask(pre); parts.push(mk); pre = mk.out; }
    const sm = softmax(pre); parts.push(sm);
    const ws = attention_weighted_sum(sm.out, v); parts.push(ws);
    const mg = merge_heads(ws.out, { Dsym: x.sym[2] }); parts.push(mg);
    const pj = linear(mg.out, { dout: C, doutSym: x.sym[2], bias: o.projBias !== false }); parts.push(pj);
    const rv = window_reverse(pj.out, { H, W, M, outSym: [x.sym[0], x.sym[1]] }); parts.push(rv);
    let out = rv.out;
    if (o.shift) { const us = cyclic_shift(out, { s: o.shift, inverse: true }); parts.push(us); out = us.out; }
    return composite('window_attention', x, parts, out, {
      paramTex: '4C^2 + 4C + (2M-1)^2 h', macTex: '4\\,HW\\,C^2 + 2\\,HW\\,M^2\\,C',
      detail: { M, h: o.h, shift: o.shift || 0, nW: (H / M) * (W / M), globalScoreMacs: 2 * H * W * H * W * C, windowScoreMacs: 2 * H * W * M * M * C },
    });
  }

  // patch_merging (Swin): concat 2×2 (H×W×C → H/2×W/2×4C) → LayerNorm(4C) → Linear 4C→2C SIN sesgo.
  // Parámetros 8C + 8C². Los tokens bajan ×4 y los canales suben ×2.
  function patch_merging(x, o) {
    const C = x.num[2];
    const cc = patch_concat(x, o);
    const ln = layernorm(cc.out);
    const rd = linear(ln.out, { dout: 2 * C, doutSym: (o && o.coutSym) || ('2' + x.sym[2]), bias: false });
    return composite('patch_merging', x, [cc, ln, rd], rd.out, {
      paramTex: '8C + 8C^2', macTex: '\\tfrac{H}{2}\\tfrac{W}{2}\\cdot 4C\\cdot 2C',
    });
  }

  // causal_self_attention: MHSA con máscara causal. Mismos parámetros y MACs que la bidireccional:
  // la máscara es una operación sobre el tensor de scores (solo "otros").
  function causal_self_attention(x, o) {
    const D = x.num[1], Ds = (o && o.Dsym) || x.sym[1];
    const qkv = linear(x, { dout: 3 * D, doutSym: '3' + Ds, bias: o.qkvBias !== false });
    const sp = split_heads(qkv.out, { h: o.h, parts: 3 });
    const [q, k, v] = sp.out;
    const sc = attention_scores(q, k);
    const sl = scale(sc.out);
    const mk = causal_mask(sl.out);
    const sm = softmax(mk.out);
    const ws = attention_weighted_sum(sm.out, v);
    const mg = merge_heads(ws.out, { Dsym: Ds });
    const pj = linear(mg.out, { dout: D, doutSym: Ds, bias: o.projBias !== false });
    const ref = mhsa(x, o);
    return composite('causal_self_attention', x, [qkv, sp, sc, sl, mk, sm, ws, mg, pj], pj.out, {
      paramTex: ref.paramFormula, macTex: ref.macFormula, detail: { h: o.h, dh: D / o.h, used: mk.detail.used, masked: mk.detail.masked },
    });
  }

  // ---- Fase 3: compuestas -------------------------------------------------------------------
  // multihead_attention (nn.MultiheadAttention de DETR): Q, K y V con entradas propias y largos N_q, N_k.
  //   [+ posición en Q y en K, nunca en V] → W_Q, W_K, W_V → cabezas → QKᵀ → escala → softmax → ·V →
  //   concatenar → W_O. o = {h, bias=true, Dsym, qPos, kPos (formas), prim}
  // Parámetros 4D² + 4D. MACs 2·N_q·D² + 2·N_k·D² + 2·N_q·N_k·D (= 4ND² + 2N²D si N_q = N_k = N).
  function multihead_attention(qIn, kIn, vIn, o) {
    o = o || {};
    const D = qIn.num[1], Ds = o.Dsym || qIn.sym[1], bias = o.bias !== false;
    const parts = [];
    let qx = qIn, kx = kIn;
    if (o.qPos) { const a = add(qIn, o.qPos); parts.push(a); qx = a.out; }
    if (o.kPos) {
      if (kIn === qIn && o.kPos === o.qPos) kx = qx;            // q = k = x + pos: una sola suma
      else { const a = add(kIn, o.kPos); parts.push(a); kx = a.out; }
    }
    const qp = linear(qx, { dout: D, doutSym: Ds, bias });
    const kp = linear(kx, { dout: D, doutSym: Ds, bias });
    const vp = linear(vIn, { dout: D, doutSym: Ds, bias });
    const sp = split_qkv_heads(qp.out, kp.out, vp.out, { h: o.h });
    const [q, k, v] = sp.out;
    const sc = attention_scores(q, k);
    const sl = scale(sc.out);
    const sm = softmax(sl.out);
    const ws = attention_weighted_sum(sm.out, v);
    const mg = merge_heads(ws.out, { Dsym: Ds });
    const pj = linear(mg.out, { dout: D, doutSym: Ds, bias });
    parts.push(qp, kp, vp, sp, sc, sl, sm, ws, mg, pj);
    const n = symTexFactor(qIn.sym[0]), m = symTexFactor(kIn.sym[0]), d = symTexFactor(Ds);
    const self = qIn.sym[0] === kIn.sym[0] && qIn.num[0] === kIn.num[0];
    const r = composite(o.prim || 'multihead_attention', qIn, parts, pj.out, {
      paramTex: '4' + d + '^2' + (bias ? ' + 4' + d : ''),
      macTex: self ? '4\\,' + n + '\\,' + d + '^2 + 2\\,' + n + '^2\\,' + d
        : '2\\,' + n + '\\,' + d + '^2 + 2\\,' + m + '\\,' + d + '^2 + 2\\,' + n + '\\,' + m + '\\,' + d,
      detail: { h: o.h, dh: D / o.h, Nq: qIn.num[0], Nk: kIn.num[0], scoreMacs: sc.macs + ws.macs, posQ: !!o.qPos, posK: !!o.kPos, posV: false },
    });
    r.inputs = [qIn, kIn, vIn, o.qPos, o.kPos].filter((t, i, a) => t && a.indexOf(t) === i);
    return r;
  }

  // cross_attention (decoder de DETR): Q de las queries (N_q = Q filas), K y V de la memoria del encoder
  // (N_k = N filas, largo distinto). o.qPos = query_pos, o.kPos = PE de la memoria (V sin posición).
  function cross_attention(xq, mem, o) {
    return multihead_attention(xq, mem, mem, Object.assign({}, o, { prim: 'cross_attention' }));
  }

  // deformable_attention (Deformable DETR, MSDeformAttn): cada query mira solo h·L·K puntos muestreados
  // alrededor de su punto de referencia en los L niveles (K por cabeza y nivel), no las N_v claves.
  //   [q + pos] → Δ = Linear(D → hLK·2), A = softmax_{LK}(Linear(D → hLK)); V = Linear(D → D) sobre el
  //   value; muestreo bilineal de V en ref + Δ; Σ A·V muestreado; W_O.
  // o = {h, L, K, qPos, ref (forma), Dsym}. Parámetros D·3hLK + 3hLK + 2D² + 2D.
  // MACs N_q·D·3hLK + N_v·D² + N_q·D² + 5·N_q·hLK·d_h: LINEAL en tokens (sin término N_q·N_v).
  function deformable_attention(xq, valueIn, o) {
    const D = xq.num[1], Ds = o.Dsym || xq.sym[1], h = o.h, L = o.L, K = o.K, S = h * L * K;
    const parts = [];
    let q = xq;
    if (o.qPos) { const a = add(xq, o.qPos); parts.push(a); q = a.out; }
    const vp = linear(valueIn, { dout: D, doutSym: Ds });
    const off = linear(q, { dout: 2 * S, doutSym: 'hLK·2' });
    const aw = linear(q, { dout: S, doutSym: 'hLK' });
    const sm = softmax(aw.out);
    const smp = deform_sample(vp.out, off.out, o.ref || null, { h, L, K });
    const ws = deform_weighted_sum(smp.out, sm.out, { Dsym: Ds });
    const pj = linear(ws.out, { dout: D, doutSym: Ds });
    parts.push(vp, off, aw, sm, smp, ws, pj);
    const n = symTexFactor(xq.sym[0]), m = symTexFactor(valueIn.sym[0]), d = symTexFactor(Ds);
    const r = composite('deformable_attention', xq, parts, pj.out, {
      paramTex: d + '\\cdot 3hLK + 3hLK + 2' + d + '^2 + 2' + d,
      macTex: n + '\\,' + d + '\\cdot 3hLK + ' + m + '\\,' + d + '^2 + ' + n + '\\,' + d + '^2 + 5\\,' + n + '\\,hLK\\,d_h',
      detail: { h, L, K, samples: S, Nq: xq.num[0], Nv: valueIn.num[0], samplingMacs: smp.macs + ws.macs,
        denseScoreMacs: 2 * xq.num[0] * valueIn.num[0] * D, note: 'sin término N_q·N_v: cada query lee hLK puntos' },
    });
    r.inputs = [xq, valueIn, o.qPos, o.ref].filter((t, i, a) => t && a.indexOf(t) === i);
    return r;
  }

  // box_mlp (DETR): MLP de 3 capas D → D → D → 4 con ReLU entre capas, + sigmoide: (cx, cy, w, h) en [0, 1].
  // o = {layers=3, hidden=D, out=4}. Parámetros 2(D² + D) + 4D + 4 con 3 capas.
  function box_mlp(x, o) {
    o = o || {};
    const n = o.layers || 3, D = x.num[x.num.length - 1], Hd = o.hidden || D, out = o.out || 4;
    const parts = [];
    let t = x;
    for (let i = 0; i < n; i++) {
      const last = i === n - 1;
      const l = linear(t, { dout: last ? out : Hd, doutSym: last ? String(out) : x.sym[x.sym.length - 1] });
      parts.push(l); t = l.out;
      if (!last) { const a = relu(t); parts.push(a); t = a.out; }
    }
    const sg = sigmoid(t); parts.push(sg);
    const d = symTexFactor(x.sym[x.sym.length - 1]), q = symTexFactor(x.sym[0]);
    return composite('box_mlp', x, parts, sg.out, {
      paramTex: (n - 1) + '(' + d + '^2 + ' + d + ') + ' + out + d + ' + ' + out,
      macTex: q + '\\,(' + (n - 1) + d + '^2 + ' + out + d + ')',
      detail: { layers: n, hidden: Hd, out },
    });
  }

  const PRIMS = {
    linear, conv2d, layernorm, rmsnorm, gelu, embedding_lookup, pos_embed_learned, cls_token,
    concat_tokens, flatten, split_heads, merge_heads, attention_scores, scale, softmax,
    attention_weighted_sum, mhsa, mlp, add, residual_add, transformer_block, pool_cls, classifier_head,
    // Fase 2
    batchnorm2d, relu, maxpool2d, global_avg_pool, conv_bn, bottleneck, cyclic_shift, window_partition,
    window_reverse, rel_pos_bias, attn_mask, causal_mask, window_attention, patch_concat, patch_merging,
    causal_self_attention, pick_token, l2_normalize, stack_batch, similarity_logits, logit_scale, contrastive_loss,
    // Fase 3
    frozen_batchnorm2d, group_norm, sigmoid, sine_pos_encoding, level_embed, add_level_embed, flatten_levels,
    learned_queries, zeros_init, split_qkv_heads, reference_points, deform_sample, deform_weighted_sum, ref_offset,
    hungarian_cost, hungarian_match, set_prediction_loss, multihead_attention, cross_attention, deformable_attention, box_mlp,
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
    // Fase 2 (Swin, ResNet, CLIP)
    { id: 'batchnorm2d', name: 'BatchNorm', paramTex: '2C', macTex: '0', outTex: 'H\\times W\\times C \\to H\\times W\\times C', note: 'γ y β por canal; media y varianza móviles son buffers. En inferencia se funde con la conv anterior.' },
    { id: 'relu', name: 'ReLU', paramTex: '0', macTex: '0', outTex: 'H\\times W\\times C \\to H\\times W\\times C', note: 'max(0, x); 1 op por elemento en "otros".' },
    { id: 'maxpool2d', name: 'Max pooling', paramTex: '0', macTex: '0', outTex: 'H\\times W\\times C \\to H_o\\times W_o\\times C', note: 'ResNet: 3×3, stride 2, padding 1 (112 → 56).' },
    { id: 'global_avg_pool', name: 'Global average pooling', paramTex: '0', macTex: '0', outTex: 'H\\times W\\times C \\to C', note: 'Promedio espacial: Swin y ResNet clasifican así (no hay token CLS).' },
    { id: 'conv_bn', name: 'Conv + BN (+ ReLU)', paramTex: 'k^2\\,C_{in}\\,C_{out} + 2C_{out}', macTex: 'H_o\\,W_o\\,C_{out}\\,k^2\\,C_{in}', outTex: 'H\\times W\\times C_{in} \\to H_o\\times W_o\\times C_{out}', note: 'La conv no lleva sesgo: el β de la BN lo hace redundante.' },
    { id: 'bottleneck', name: 'Bloque bottleneck (ResNet-50)', paramTex: 'C_{in}w + 13w^2 + 12w\;(+\\,4wC_{in} + 8w)', macTex: 'HWC_{in}w + H_oW_o\\,13w^2\;(+\\,H_oW_o\\,4wC_{in})', outTex: 'H\\times W\\times C_{in} \\to H_o\\times W_o\\times 4w', note: '1×1 reduce a w, 3×3 (con el stride), 1×1 expande a 4w; atajo identidad o proyección 1×1 + BN (entre paréntesis).' },
    { id: 'cyclic_shift', name: 'Desplazamiento cíclico', paramTex: '0', macTex: '0', outTex: 'H\\times W\\times C \\to H\\times W\\times C', note: 'torch.roll por ⌊M/2⌋: las ventanas del bloque siguiente cruzan los bordes de las anteriores.' },
    { id: 'window_partition', name: 'Partición en ventanas', paramTex: '0', macTex: '0', outTex: 'H\\times W\\times C \\to n_W\\times M^2\\times C', note: 'n_W = HW/M². Las ventanas se procesan como un lote.' },
    { id: 'window_reverse', name: 'Revertir ventanas', paramTex: '0', macTex: '0', outTex: 'n_W\\times M^2\\times C \\to H\\times W\\times C', note: 'Inversa de la partición.' },
    { id: 'rel_pos_bias', name: 'Sesgo de posición relativa', paramTex: '(2M-1)^2\\,h', macTex: '0', outTex: 'n_W\\times h\\times M^2\\times M^2 \\to \\text{igual}', note: 'Tabla aprendida (parámetro) indexada por un índice M²×M² (buffer); se suma a los scores.' },
    { id: 'attn_mask', name: 'Máscara de SW-MSA', paramTex: '0', macTex: '0', outTex: 'n_W\\times h\\times M^2\\times M^2 \\to \\text{igual}', note: 'Tras el desplazamiento, una ventana junta regiones no vecinas: la máscara (buffer, −100) les impide atenderse.' },
    { id: 'causal_mask', name: 'Máscara causal', paramTex: '0', macTex: '0', outTex: 'h\\times T\\times T \\to h\\times T\\times T', note: 'El token t solo atiende a 1…t. No cambia parámetros ni MACs.' },
    { id: 'window_attention', name: 'Atención por ventanas (W-MSA / SW-MSA)', paramTex: '4C^2 + 4C + (2M-1)^2 h', macTex: '4HW\\,C^2 + 2HW\\,M^2 C', outTex: 'H\\times W\\times C \\to H\\times W\\times C', note: 'Lineal en los tokens HW (vs 2(HW)²C de la global): el ahorro es HW/M².' },
    { id: 'patch_merging', name: 'Patch merging', paramTex: '8C + 8C^2', macTex: '\\tfrac{HW}{4}\\cdot 4C\\cdot 2C', outTex: 'H\\times W\\times C \\to \\tfrac{H}{2}\\times\\tfrac{W}{2}\\times 2C', note: 'Concat 2×2 → LayerNorm(4C) → Linear 4C→2C sin sesgo: tokens ÷4, canales ×2 (como un stride 2).' },
    { id: 'causal_self_attention', name: 'Self-attention causal', paramTex: '4D^2 + 4D', macTex: '4ND^2 + 2N^2D', outTex: 'N\\times D \\to N\\times D', note: 'Mismos conteos que la bidireccional; la máscara solo cambia qué scores se usan.' },
    { id: 'pick_token', name: 'Tomar un token', paramTex: '0', macTex: '0', outTex: 'T\\times D \\to D', note: 'CLIP texto: la fila del token EOT.' },
    { id: 'l2_normalize', name: 'Normalización L2', paramTex: '0', macTex: '0', outTex: 'E \\to E', note: 'x/‖x‖: el producto punto pasa a ser similitud coseno.' },
    { id: 'similarity_logits', name: 'Matriz de similitud', paramTex: '0', macTex: 'B^2 E', outTex: 'B\\times E,\\ B\\times E \\to B\\times B', note: 'I·Tᵀ: B² pares; la diagonal son los positivos y el resto B−1 negativos por fila.' },
    { id: 'logit_scale', name: 'Temperatura aprendida', paramTex: '1', macTex: '0', outTex: 'B\\times B \\to B\\times B', note: 'Multiplica por e^t (init 1/0.07, tope 100).' },
    { id: 'contrastive_loss', name: 'Pérdida contrastiva (InfoNCE simétrica)', paramTex: '0', macTex: '0', outTex: 'B\\times B \\to 1', note: 'Promedio de la CE por filas (imagen→texto) y por columnas (texto→imagen).' },
    // Fase 3 (DETR, Deformable DETR)
    { id: 'frozen_batchnorm2d', name: 'BatchNorm congelada (FrozenBN)', paramTex: '0', macTex: '0', outTex: 'H\\times W\\times C \\to H\\times W\\times C', note: 'γ, β, media y varianza fijas, guardadas como buffers (4C): el backbone de DETR no las entrena. Una BatchNorm normal tendría 2C parámetros.' },
    { id: 'group_norm', name: 'GroupNorm', paramTex: '2C', macTex: '0', outTex: 'H\\times W\\times C \\to H\\times W\\times C', note: 'Normaliza por grupos de canales (32 en Deformable DETR); no depende del batch.' },
    { id: 'sigmoid', name: 'Sigmoide', paramTex: '0', macTex: '0', outTex: 'Q\\times 4 \\to Q\\times 4', note: 'Cajas (cx, cy, w, h) normalizadas a [0, 1].' },
    { id: 'sine_pos_encoding', name: 'Posición 2-D seno/coseno', paramTex: '0', macTex: '0', outTex: '\\to N\\times D', note: 'D/2 canales para y y D/2 para x (temperatura 10,000). Fija: buffer, no parámetro. DETR la suma a Q y K en cada atención, nunca a V.' },
    { id: 'level_embed', name: 'Embedding de nivel', paramTex: 'L\\,D', macTex: '0', outTex: '\\to L\\times D', note: 'Un vector aprendido por nivel de la pirámide: le dice a la atención de qué escala viene cada token.' },
    { id: 'add_level_embed', name: 'Suma del embedding de nivel', paramTex: '0', macTex: '0', outTex: 'N\\times D,\\ L\\times D \\to N\\times D', note: 'Cada token recibe el vector de su nivel.' },
    { id: 'flatten_levels', name: 'Aplanar niveles', paramTex: '0', macTex: '0', outTex: '\\{H_l\\times W_l\\times D\\} \\to (\\textstyle\\sum_l H_lW_l)\\times D', note: 'Concatena los tokens de todos los niveles en una sola secuencia.' },
    { id: 'learned_queries', name: 'Object queries aprendidas', paramTex: 'Q\\,D', macTex: '0', outTex: '\\to Q\\times D', note: 'Q vectores aprendidos (query_pos): cada uno es un "slot" que terminará respondiendo por un objeto o por ∅. Deformable DETR aprende Q×2D (query_pos y la entrada).' },
    { id: 'zeros_init', name: 'Entrada del decoder en ceros', paramTex: '0', macTex: '0', outTex: '\\to Q\\times D', note: 'DETR arranca el decoder en ceros; la identidad de cada query entra por query_pos en cada capa.' },
    { id: 'split_qkv_heads', name: 'Separar Q, K, V en cabezas', paramTex: '0', macTex: '0', outTex: 'N_q\\times D,\\ N_k\\times D \\to h\\times N_q\\times d_h,\\ h\\times N_k\\times d_h', note: 'Como split_heads, pero Q y K/V pueden tener largos distintos (cross-attention).' },
    { id: 'multihead_attention', name: 'Multi-head attention (Q, K, V separados)', paramTex: '4D^2 + 4D', macTex: '2N_qD^2 + 2N_kD^2 + 2N_qN_kD', outTex: 'N_q\\times D,\\ N_k\\times D \\to N_q\\times D', note: 'nn.MultiheadAttention. En DETR la posición se suma a Q y a K, nunca a V.' },
    { id: 'cross_attention', name: 'Cross-attention', paramTex: '4D^2 + 4D', macTex: '2QD^2 + 2ND^2 + 2QND', outTex: 'Q\\times D,\\ N\\times D \\to Q\\times D', note: 'Q desde las queries del decoder, K y V desde la memoria del encoder (largos distintos): los scores son h×Q×N.' },
    { id: 'reference_points', name: 'Puntos de referencia', paramTex: '0', macTex: '0', outTex: '\\to N\\times L\\times 2', note: 'Encoder de Deformable DETR: el centro normalizado de cada token, en cada nivel. En el decoder salen de Linear(D → 2) + sigmoide sobre query_pos.' },
    { id: 'deform_sample', name: 'Muestreo bilineal (deformable)', paramTex: '0', macTex: '4\\,h\\,N_q\\,LK\\,d_h', outTex: 'N_v\\times D,\\ N_q\\times hLK{\\cdot}2 \\to h\\times N_q\\times LK\\times d_h', note: 'Interpola el value en ref + Δ (4 vecinos por punto). grid_sample: FlopCounterMode no lo cuenta (MACs analíticos).' },
    { id: 'deform_weighted_sum', name: 'Suma ponderada de las muestras', paramTex: '0', macTex: 'h\\,N_q\\,LK\\,d_h', outTex: 'h\\times N_q\\times LK\\times d_h \\to N_q\\times D', note: 'El análogo de A·V con LK = 16 claves por cabeza en vez de N.' },
    { id: 'deformable_attention', name: 'Atención deformable multi-escala', paramTex: 'D\\cdot 3hLK + 3hLK + 2D^2 + 2D', macTex: 'N_qD\\cdot 3hLK + N_vD^2 + N_qD^2 + 5N_q\\,hLK\\,d_h', outTex: 'N_q\\times D,\\ N_v\\times D \\to N_q\\times D', note: 'Offsets (hLK·2) y pesos (hLK) salen de la query; cada query lee hLK puntos: lineal en tokens, sin término N_q·N_v.' },
    { id: 'ref_offset', name: 'Caja relativa a la referencia', paramTex: '0', macTex: '0', outTex: 'Q\\times 4,\\ Q\\times 2 \\to Q\\times 4', note: 'Deformable DETR predice la caja como Δ + σ⁻¹(ref) antes de la sigmoide.' },
    { id: 'box_mlp', name: 'Cabeza de cajas (MLP 3 capas)', paramTex: '2(D^2 + D) + 4D + 4', macTex: 'Q\\,(2D^2 + 4D)', outTex: 'Q\\times D \\to Q\\times 4', note: 'D → D → D → 4 con ReLU y sigmoide final: (cx, cy, w, h) normalizados.' },
    { id: 'hungarian_cost', name: 'Matriz de costos del matching', paramTex: '0', macTex: '0', outTex: 'Q\\times (K{+}1),\\ Q\\times 4,\\ G \\to Q\\times G', note: 'C = λ_cls(−p̂(c)) + λ_L1‖b − b̂‖₁ + λ_giou(−GIoU) para cada par (query, objeto). Solo entrenamiento.' },
    { id: 'hungarian_match', name: 'Matching húngaro', paramTex: '0', macTex: '0', outTex: 'Q\\times G \\to G\\times 2', note: 'Asignación uno a uno de costo mínimo: G queries emparejadas, Q − G → ∅. Por eso DETR no necesita NMS.' },
    { id: 'set_prediction_loss', name: 'Pérdida de conjunto', paramTex: '0', macTex: '0', outTex: '\\to 1', note: 'CE de clase sobre las Q queries (∅ con peso reducido) + L1 + GIoU sobre las emparejadas.' },
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
      if (meta.batched) tensors[id].batched = true;   // ya incluye el batch B (CLIP: parte conjunta)
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
        if (o.batched) ops[ops.length - 1].batched = true;   // sus MACs ya incluyen el batch B
        // where: contexto para mostrar (de lo general a lo particular), p. ej. ['Stage 2', 'bloque 1 (W-MSA)']
        // o ['Torre de texto']; lo usa la práctica para nombrar sin ambigüedad. No cambia ningún número.
        if (Array.isArray(o.where) && o.where.length) ops[ops.length - 1].where = o.where.slice();
        return handles.length === 1 ? handles[0] : handles;
      },
      _data() { return { tensors, order, ops }; },
    };
  }

  // Bloque pre-LN reutilizable (ViT, transformer de juguete, torres de CLIP). Ids de SPEC §13.1/13.2.
  // prefix = path de nodos que contiene la capa (p. ej. ['encoder','enc-layer']).
  // o = {L, h, Dmlp, qkvBias, projBias, mlpBias, causal, outId='x-out',
  //      tid='' (prefijo de ids de tensor: 'i-' → 'i-h-ln1'), oid='' (prefijo de ids de op),
  //      maskOp (máscara causal como op propia, nodo 'mask', tensor '<tid>masked'), actLabel,
  //      where (contexto de las ops, p. ej. ['Torre de imagen']), labelPrefix (prefijo de las etiquetas
  //      de tensor, p. ej. 'Torre de imagen · ')}
  // Sin tid/oid/maskOp/where/labelPrefix el resultado es exactamente el de la fase 1.
  function preLnLayer(g, x, o) {
    const P = o.prefix || ['enc-layer'];
    const rep = o.L || 1;
    const L = (meta) => Object.assign({ perLayer: true }, meta);
    const D = x.num[1], Ds = x.sym[1];
    const at = P.concat(['mhsa']), ml = P.concat(['mlp']);
    const T = (n) => (o.tid || '') + n, O = (n) => (o.oid || '') + n;
    const pre = o.labelPrefix || '';
    const tag = (m) => (pre && m && m.label ? Object.assign({}, m, { label: pre + m.label }) : m);
    const op = (id, res, path, extra) => {
      const e = Object.assign({ path, repeat: rep }, extra);
      if (o.where) e.where = o.where;
      if (pre && e.outMeta) e.outMeta = Array.isArray(e.outMeta) ? e.outMeta.map(tag) : tag(e.outMeta);
      return g.op(O(id), res, e);
    };
    const sepMask = !!o.maskOp;

    const hln1 = op('ln1', layernorm(x), P.concat(['ln1']), { out: T('h-ln1'), label: 'LayerNorm 1', type: 'norm', group: 'norm', outMeta: L({ label: 'Entrada normalizada (LN 1)', tex: '\\mathrm{LN}_1(x)' }) });
    const qkv = op('qkv', linear(hln1, { dout: 3 * D, doutSym: '3' + Ds, bias: o.qkvBias !== false }), at.concat(['qkv']), { out: T('qkv'), label: 'Proyección Q, K, V', type: 'embed', group: 'attn', outMeta: L({ label: 'Q, K y V concatenados', tex: '[Q\\;K\\;V]' }) });
    const [q, k, v] = op('split', split_heads(qkv, { h: o.h, parts: 3 }), at.concat(['split']), {
      out: [T('q'), T('k'), T('v')], label: 'Separar en cabezas', type: 'tensorop', group: 'attn',
      outMeta: [L({ label: 'Queries por cabeza', tex: 'Q' }), L({ label: 'Keys por cabeza', tex: 'K' }), L({ label: 'Values por cabeza', tex: 'V' })],
    });
    const sc = op('scores', attention_scores(q, k), at.concat(['scores']), { out: T('scores'), label: 'Producto QKᵀ', type: 'attn', group: 'attn', outMeta: L({ label: 'Scores sin escalar', tex: 'QK^\\top' }) });
    const inScale = !!o.causal && !sepMask;
    let ss = op('scale', scale(sc, { causal: inScale }), at.concat(['scale']), {
      out: T('scores-scaled'), label: inScale ? 'Escala 1/√d_h + máscara causal' : 'Escala 1/√d_h', type: 'attn', group: 'attn',
      outMeta: L({ label: inScale ? 'Scores escalados y enmascarados' : 'Scores escalados', tex: inScale ? 'QK^\\top/\\sqrt{d_h} + M' : 'QK^\\top/\\sqrt{d_h}' }),
    });
    if (sepMask) {
      ss = op('mask', causal_mask(ss), at.concat(['mask']), {
        out: T('masked'), label: 'Máscara causal', type: 'attn', group: 'attn',
        outMeta: L({ label: 'Scores enmascarados (−∞ sobre el futuro)', tex: 'QK^\\top/\\sqrt{d_h} + M_{\\mathrm{causal}}' }),
      });
    }
    const a = op('softmax', softmax(ss), at.concat(['softmax']), { out: T('attn'), label: 'Softmax por fila', type: 'attn', group: 'attn', outMeta: L({ label: 'Pesos de atención', tex: 'A' }) });
    const zh = op('weighted-sum', attention_weighted_sum(a, v), at.concat(['weighted-sum']), { out: T('z-heads'), label: 'Suma ponderada A·V', type: 'attn', group: 'attn', outMeta: L({ label: 'Salida por cabeza', tex: 'AV' }) });
    const z = op('merge', merge_heads(zh, { Dsym: Ds }), at.concat(['merge']), { out: T('z'), label: 'Concatenar cabezas', type: 'tensorop', group: 'attn', outMeta: L({ label: 'Cabezas concatenadas', tex: 'Z' }) });
    const ov = op('proj', linear(z, { dout: D, doutSym: Ds, bias: o.projBias !== false }), at.concat(['proj']), { out: T('o'), label: 'Proyección de salida W_O', type: 'embed', group: 'attn', outMeta: L({ label: 'Salida de la atención', tex: 'O = ZW_O' }) });
    const r1 = op('res1', residual_add(x, ov), P.concat(['res1']), { out: T('r1'), label: 'Residual 1', type: 'tensorop', group: 'resid', outMeta: L({ label: 'x + atención', tex: "x'" }) });
    const hln2 = op('ln2', layernorm(r1), P.concat(['ln2']), { out: T('h-ln2'), label: 'LayerNorm 2', type: 'norm', group: 'norm', outMeta: L({ label: 'Entrada normalizada (LN 2)', tex: "\\mathrm{LN}_2(x')" }) });
    const u = op('fc1', linear(hln2, { dout: o.Dmlp, doutSym: 'D_mlp', bias: o.mlpBias !== false }), ml.concat(['fc1']), { out: T('u'), label: 'MLP: capa 1 (expansión)', type: 'mlp', group: 'mlp', outMeta: L({ label: 'Capa oculta del MLP', tex: 'U = \\mathrm{LN}_2(x\')W_1 + b_1' }) });
    const gg = op('gelu', gelu(u), ml.concat(['gelu']), { out: T('g'), label: o.actLabel || 'GELU', type: 'mlp', group: 'mlp', outMeta: L({ label: 'Activación', tex: o.actTex || '\\mathrm{GELU}(U)' }) });
    const f = op('fc2', linear(gg, { dout: D, doutSym: Ds, bias: o.mlpBias !== false }), ml.concat(['fc2']), { out: T('f'), label: 'MLP: capa 2 (proyección)', type: 'mlp', group: 'mlp', outMeta: L({ label: 'Salida del MLP', tex: 'F' }) });
    // res2 produce x_ℓ; tras la última de las L repeticiones es x_L (de ahí el id 'x-out').
    return op('res2', residual_add(r1, f), P.concat(['res2']), {
      out: o.outId || T('x-out'), label: 'Residual 2', type: 'tensorop', group: 'resid',
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

  const NON_ARCH = ['B', 'dtype', 'ctx'];   // no cambian la arquitectura (solo bytes)…
  // …salvo que el modelo los declare como knob (CLIP: B cambia los tensores conjuntos B×E y B×B).
  const nonArch = (def) => NON_ARCH.filter((k) => !(def.knobs && k in def.knobs));

  function resolve(configId, overrides) {
    const def = modelOf(configId);
    const base = Object.assign({}, def.configs[configId]);
    const ov = Object.assign({}, overrides || {});
    nonArch(def).forEach((k) => delete ov[k]);
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
    nonArch(modelOf(configId)).forEach((k) => delete ov[k]);
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

    // byPath: como byNode pero con la ruta completa ('img-encoder>enc-layer'): distingue nodos con el
    // mismo id en dos lugares (las dos torres de CLIP; W-MSA y SW-MSA de Swin, que comparten 'qkv', …).
    const totals = { params: 0, macs: 0, flops: 0, other: 0, byNode: {}, byPath: {}, byPrim: {}, byGroup: {} };
    const bump = (map, k, op) => {
      const e = map[k] || (map[k] = { params: 0, macs: 0, other: 0 });
      e.params += op.params * op.repeat; e.macs += op.macs * op.repeat; e.other += op.other * op.repeat;
    };
    for (const op of ops) {
      totals.params += op.params * op.repeat;
      totals.macs += op.macs * op.repeat;
      totals.other += op.other * op.repeat;
      new Set(op.path).forEach((n) => bump(totals.byNode, n, op));
      op.path.forEach((n, i) => bump(totals.byPath, op.path.slice(0, i + 1).join('>'), op));
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

  // Tensores que NO cuentan como activaciones guardadas en actMem: vistas y movimientos de datos
  // (reshape/permute/roll: no los guarda el backward), tablas de parámetros (no son activaciones) y
  // los scores previos al softmax (temporales: el backward de softmax usa su salida A; el de QKᵀ, Q y K).
  const NOT_SAVED = {
    split_heads: 1, merge_heads: 1, flatten: 1, window_partition: 1, window_reverse: 1, cyclic_shift: 1,
    pool_cls: 1, pick_token: 1, stack_batch: 1, pos_embed_learned: 1,
    attention_scores: 1, scale: 1, rel_pos_bias: 1, attn_mask: 1, causal_mask: 1,
    // Fase 3: vistas (split_qkv_heads, flatten_levels), tablas de parámetros (learned_queries, level_embed) y
    // tensores constantes calculados (PE seno/coseno, ceros, puntos de referencia del encoder).
    split_qkv_heads: 1, flatten_levels: 1, learned_queries: 1, level_embed: 1, sine_pos_encoding: 1, zeros_init: 1, reference_points: 1,
  };

  // metrics: números derivados para el explorador de escala y el "¿qué pasa si…?" (SPEC §6.5).
  function metrics(configId, overrides) {
    const ov = overrides || {};
    const dtype = ov.dtype || 'bf16';
    if (!DTYPE_BYTES[dtype]) throw new Error('dtype desconocido: "' + dtype + '". Válidos: ' + Object.keys(DTYPE_BYTES).join(', ') + '.');
    if (ov.B !== undefined && (!Number.isInteger(ov.B) || ov.B <= 0)) throw new Error('B debe ser un entero positivo.');
    const def = modelOf(configId);
    const r = run(configId, ov);
    const cfg = r.config, t = r.totals;
    // B por defecto 1; en modelos con knob B (CLIP) el de la config (32,768).
    const B = ov.B !== undefined ? ov.B : (def.knobs && 'B' in def.knobs && cfg.B ? cfg.B : 1);
    const by = bytesOf(dtype);
    const opById = {};
    r.ops.forEach((op) => { opById[op.id] = op; });
    const isScore = (op) => op.prim === 'attention_scores' || op.prim === 'attention_weighted_sum';
    const scoreMacs = r.ops.filter(isScore).reduce((s, op) => s + op.macs * op.repeat, 0);
    const attnMacs = (t.byGroup.attn || { macs: 0 }).macs;
    // Lineales dentro de las capas (proyecciones de atención + MLP).
    const linearMacs = r.ops.filter((op) => op.prim === 'linear' && (op.group === 'attn' || op.group === 'mlp'))
      .reduce((s, op) => s + op.macs * op.repeat, 0);
    // Tensores de scores h×N×N (uno por op attention_scores): el mayor de una capa, y todos.
    const scoreTs = r.ops.filter((op) => op.prim === 'attention_scores').map((op) => ({ t: r.tensors[op.out[0]], rep: op.repeat }));
    const attnMemLayer = scoreTs.reduce((m, x) => Math.max(m, x.t.elements), 0) * by * B;
    const attnMemAll = scoreTs.reduce((s, x) => s + x.t.elements * x.rep, 0) * by * B;
    const layers = cfg.L || 1;
    // Activaciones (≈, entrenamiento): cada tensor materializado del forward, una vez por repetición de
    // la op que lo produce; sin vistas, sin tablas de parámetros ni scores previos al softmax (NOT_SAVED).
    let actElems = 0, actElemsBatched = 0;
    for (const id of r.order) {
      const x = r.tensors[id];
      const prod = x.producer ? opById[x.producer] : null;
      if (prod && NOT_SAVED[prod.prim]) continue;
      const n = x.elements * (prod ? prod.repeat : 1);
      if (x.batched) actElemsBatched += n; else actElems += n;
    }
    const out = {
      id: configId, overrides: Object.assign({}, ov), B, dtype, bytesPerElement: by,
      tokens: r.quantities.tokens,
      params: t.params, macs: t.macs, flops: t.flops, other: t.other,
      attnMacs, attnMacsShare: t.macs ? attnMacs / t.macs : 0,
      scoreMacs, scoreMacsShare: t.macs ? scoreMacs / t.macs : 0,
      linearMacs,
      attnMem: attnMemLayer,                    // bytes: el mayor tensor de scores de UNA capa, ×B (FlashAttention no lo materializa)
      attnMemAllLayers: attnMemAll,             // si se guardan los de todas las capas (entrenamiento sin recomputar)
      actMem: (actElems * B + actElemsBatched) * by,  // ≈ entrenamiento: activaciones guardadas del forward
      actMemPerSample: actElems * by,           // lo mismo para una muestra, sin los tensores del lote (CLIP)
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
    if (def.metrics) Object.assign(out, def.metrics(cfg, r, { B, by, dtype, actMemPerSample: out.actMemPerSample, actMemBatch: out.actMem }));
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
