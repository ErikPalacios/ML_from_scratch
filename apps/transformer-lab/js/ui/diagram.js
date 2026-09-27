/* =============================================================================
   Transformer Lab — js/ui/diagram.js
   TL.Diagram: esquema SVG del transformer decoder-only (arriba → abajo = forward).

   API (spec §9.4):
     const dg = TL.Diagram.create(el, cfg, { onSelect(blockId, {head}), optimizer, legend })
     dg.setActive(blockId, phase, { head, paramBlock })  // phase: data|forward|loss|backward|update
     dg.setActive(null)                                  // limpia
     dg.setShapes({ [blockId]: 'T×d · 5×8' })            // etiquetas de forma en las aristas de salida
     dg.relayout()  dg.destroy()  dg.el (svg)  dg.blocks (ids en orden forward)
   Teclado: una sola parada de Tab (el bloque activo); ↑/↓ recorren el flujo, ←/→ cambian de
   cabeza dentro de los carriles, Inicio/Fin, Intro/Espacio → onSelect.
   Colores solo vía clases/tokens CSS (ver sección 4 de css/app.css).
   ========================================================================== */
(function (root) {
  'use strict';
  const TL = (root.TL = root.TL || {});
  const NS = 'http://www.w3.org/2000/svg';
  let UID = 0;

  // ---------------------------------------------------------------------------
  // utilidades
  // ---------------------------------------------------------------------------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function svgEl(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  // Texto enriquecido mínimo: 'W_{Q}', 'K^T', 'd_k' → tspans con sub/superíndice
  function parseRich(s) {
    const segs = [];
    let cur = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if ((ch === '_' || ch === '^') && i + 1 < s.length) {
        if (cur) { segs.push({ t: cur, m: 0 }); cur = ''; }
        let t;
        if (s[i + 1] === '{') {
          const j = s.indexOf('}', i + 2);
          t = s.slice(i + 2, j < 0 ? s.length : j);
          i = j < 0 ? s.length : j;
        } else { t = s[i + 1]; i += 1; }
        segs.push({ t, m: ch === '_' ? 1 : -1 });
      } else cur += ch;
    }
    if (cur) segs.push({ t: cur, m: 0 });
    return segs;
  }

  const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', a: 'ₐ', e: 'ₑ', h: 'ₕ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', s: 'ₛ', t: 'ₜ', x: 'ₓ' };
  const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', T: 'ᵀ', '[': '[', ']': ']' };
  function plain(s) {
    return parseRich(String(s)).map((g) => {
      if (!g.m) return g.t;
      const map = g.m > 0 ? SUB : SUP;
      return g.t.split('').map((c) => map[c] || c).join('');
    }).join('');
  }

  // ancho estimado (px) — mono ≈ 0.6em; sans ≈ 0.56em
  function textWidth(s, fs, mono) {
    const k = mono ? 0.6 : 0.56;
    let w = 0;
    for (const g of parseRich(String(s))) w += g.t.length * (g.m ? 0.72 : 1);
    return w * k * fs;
  }

  // añade tspans (con sub/superíndices) a un <text>; devuelve el desplazamiento vertical final
  function appendRich(textEl, s, fs, cls, shift) {
    shift = shift || 0;
    for (const g of parseRich(String(s))) {
      const ts = svgEl('tspan', cls ? { class: cls } : null, textEl);
      const target = g.m === 1 ? fs * 0.3 : g.m === -1 ? -fs * 0.42 : 0;
      if (target !== shift) ts.setAttribute('dy', (target - shift).toFixed(2));
      if (g.m) ts.setAttribute('font-size', (fs * 0.72).toFixed(2));
      shift = target;
      ts.textContent = g.t;
    }
    return shift;
  }
  function richText(textEl, s, fs) {
    textEl.textContent = '';
    appendRich(textEl, s, fs);
    return textEl;
  }

  function roundedPath(pts, r) {
    // quita puntos duplicados / colineales
    const p = [];
    for (const q of pts) {
      const last = p[p.length - 1];
      if (last && Math.abs(last[0] - q[0]) < 0.01 && Math.abs(last[1] - q[1]) < 0.01) continue;
      if (p.length >= 2) {
        const a = p[p.length - 2], b = last;
        const cross = (b[0] - a[0]) * (q[1] - b[1]) - (b[1] - a[1]) * (q[0] - b[0]);
        if (Math.abs(cross) < 0.01) { p[p.length - 1] = q; continue; }
      }
      p.push(q);
    }
    const f = (v) => +v.toFixed(2);
    let d = 'M' + f(p[0][0]) + ',' + f(p[0][1]);
    for (let i = 1; i < p.length - 1; i++) {
      const [px, py] = p[i - 1], [cx, cy] = p[i], [nx, ny] = p[i + 1];
      const d1 = Math.hypot(cx - px, cy - py), d2 = Math.hypot(nx - cx, ny - cy);
      const rr = Math.min(r, d1 / 2, d2 / 2);
      const ax = cx + ((px - cx) / d1) * rr, ay = cy + ((py - cy) / d1) * rr;
      const bx = cx + ((nx - cx) / d2) * rr, by = cy + ((ny - cy) / d2) * rr;
      d += 'L' + f(ax) + ',' + f(ay) + 'Q' + f(cx) + ',' + f(cy) + ' ' + f(bx) + ',' + f(by);
    }
    const e = p[p.length - 1];
    return d + 'L' + f(e[0]) + ',' + f(e[1]);
  }

  function normPhase(ph) {
    if (ph === 'backward' || ph === 'bwd') return 'bwd';
    if (ph === 'update' || ph === 'upd') return 'upd';
    if (ph === 'data') return 'data';
    return 'fwd'; // forward, loss
  }

  function prefersReducedMotion() {
    try { return root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }

  // 'T×d · 5×8' | 'T×d (5×8)' | '5×8' | 'T×d'
  function parseShape(s) {
    s = String(s).trim();
    let m = s.match(/^(.+?)\s*·\s*(.+)$/);
    if (m) return { sym: m[1].trim(), num: m[2].trim() };
    m = s.match(/^(.+?)\s*\((.+)\)\s*$/);
    if (m) return { sym: m[1].trim(), num: m[2].trim() };
    if (/^[\d\s×x*,]+$/.test(s)) return { sym: '', num: s };
    return { sym: s, num: '' };
  }

  // ---------------------------------------------------------------------------
  // definiciones de bloques (textos en español)
  // ---------------------------------------------------------------------------
  const LANE_OPS = [
    { key: 'scores',  label: 'Puntuaciones', sub: (h) => 'Q_' + h + '·K_' + h + '^T', op: 'Q·K^T',  desc: 'Producto escalar de cada consulta con cada clave: S = Q·Kᵀ (T×T).' },
    { key: 'scale',   label: 'Escala',       sub: () => '÷ √d_k',                      op: '÷√d_k',  desc: 'Se divide entre √d_k para que el softmax no se sature.' },
    { key: 'mask',    label: 'Máscara',      sub: () => '+ M (causal)',                op: 'máscara', desc: 'Máscara causal: cada token solo ve los anteriores (−∞ en el futuro).' },
    { key: 'softmax', label: 'Softmax',      sub: () => 'por filas',                   op: 'softmax', desc: 'Softmax por filas: pesos de atención A (cada fila suma 1).' },
    { key: 'context', label: 'Contexto',     sub: (h) => 'A_' + h + '·V_' + h,         op: 'A·V',     desc: 'Mezcla de valores: Z = A·V (T×d_k).' },
  ];

  function mainDefs(cfg, opts) {
    const H = clamp(Math.round(cfg.nHeads || 1), 1, 8);
    const concatSub = H === 1 ? 'Z = Z_1' : H === 2 ? 'Z_1 ‖ Z_2' : 'Z_1 ‖ … ‖ Z_' + H;
    const act = cfg.activation === 'gelu' ? 'GELU' : 'ReLU';
    const opt = opts.optimizer === 'sgd' ? 'SGD · θ ← θ − η·g' : opts.optimizer === 'adam' ? 'Adam · m̂, v̂' : 'θ ← θ − η·Δθ';
    return {
      tokens:      { label: 'Tokens', sub: 'texto → ids', cls: 'io', desc: 'Tokenización: el texto se convierte en ids del vocabulario.' },
      embed:       { label: 'Embedding', sub: 'one-hot · E', cls: 'param', desc: 'Búsqueda en la tabla E: cada id selecciona una fila (vector de d dimensiones).' },
      posenc:      { label: 'Posicional', sub: 'X_{emb} + PE', desc: 'Se suma la codificación posicional para que el modelo sepa el orden.' },
      ln1:         { label: 'Normalización 1', sub: 'LayerNorm', cls: 'param', desc: 'LayerNorm antes de la atención: normaliza cada fila y aplica γ₁, β₁.' },
      qkv:         { label: 'Proyecciones Q, K, V', sub: 'H·W_Q, H·W_K, H·W_V', cls: 'param', desc: 'Tres productos matriciales: consultas Q, claves K y valores V.' },
      split:       { label: 'Dividir en cabezas', sub: 'T×d → h×(T×d_k)', cls: 'op', desc: 'Se reparten las columnas de Q, K y V entre las cabezas.' },
      concat:      { label: 'Concatenar', sub: concatSub, cls: 'op', desc: 'Se juntan las salidas de las cabezas: T×d.' },
      proj:        { label: 'Proyección de salida', sub: 'Z·W_O', cls: 'param', desc: 'Proyección lineal O = Z·W_O que mezcla la información de las cabezas.' },
      res1:        { label: 'Residual 1', sub: 'R = X + O', cls: 'sum', desc: 'Conexión residual: se suma la entrada de la capa a la salida de la atención.' },
      ln2:         { label: 'Normalización 2', sub: 'LayerNorm', cls: 'param', desc: 'LayerNorm antes de la red feed-forward: γ₂, β₂.' },
      ffn1:        { label: 'FFN · capa 1', sub: 'H′·W_1 + b_1', cls: 'param', desc: 'Primera capa lineal de la FFN: expande de d a d_ff.' },
      act:         { label: 'Activación', sub: act, cls: 'op', desc: 'No linealidad elemento a elemento (' + act + ').' },
      ffn2:        { label: 'FFN · capa 2', sub: 'G·W_2 + b_2', cls: 'param', desc: 'Segunda capa lineal de la FFN: reduce de d_ff a d.' },
      res2:        { label: 'Residual 2', sub: 'X^{[l]} = R + F', cls: 'sum', desc: 'Conexión residual: R + salida de la FFN.' },
      lnf:         { label: 'Normalización final', sub: 'LayerNorm', cls: 'param', desc: 'LayerNorm final antes de la proyección al vocabulario.' },
      logits:      { label: 'Logits', sub: 'H_f·W_{out}', cls: 'param', desc: 'Puntuación de cada palabra del vocabulario en cada posición (T×V).' },
      softmax_out: { label: 'Softmax', sub: 'P = softmax(logits)', cls: 'op', desc: 'Probabilidades del siguiente token (cada fila suma 1).' },
      loss:        { label: 'Pérdida', sub: 'entropía cruzada', cls: 'io', desc: 'ℒ = −(1/T) Σ log P[t, y_t] frente a los objetivos Y.' },
      optim:       { label: 'Optimizador', sub: opt, cls: 'io', desc: 'Usa los gradientes de todos los parámetros para actualizarlos.' },
    };
  }

  // ---------------------------------------------------------------------------
  // layout (coordenadas en px de usuario; ancho W)
  // ---------------------------------------------------------------------------
  function computeLayout(cfg, W, opts) {
    const N = clamp(Math.round(cfg.nLayers || 1), 1, 3);
    const Hh = clamp(Math.round(cfg.nHeads || 1), 1, 8);
    const defs = mainDefs(cfg, opts);
    const railL = 9.5, x0 = 22, x1 = W - 14, railR = W - 6.5;
    const mid = Math.round((x0 + x1) / 2) + 0.5;
    const BH = 34, GAP = 24, R = 11;
    const nodes = [], edges = [], frames = [], lanes = [], notes = [];
    const blocks = [];

    const addBlock = (id) => { if (!blocks.includes(id)) blocks.push(id); };
    const box = (block, top, def, extra) => {
      const n = Object.assign({ block, kind: 'box', x: x0, w: x1 - x0, y: top, h: BH, lane: null, layer: null }, def, extra);
      n.cx = n.x + n.w / 2; n.cy = n.y + n.h / 2; n.top = n.y; n.bottom = n.y + n.h; n.right = n.x + n.w;
      nodes.push(n); addBlock(block);
      return n;
    };
    const sum = (block, cy, def, extra) => {
      const n = Object.assign({ block, kind: 'sum', cls: 'sum', x: mid - R, w: 2 * R, y: cy - R, h: 2 * R, r: R, lane: null, layer: null }, def, extra);
      n.cx = mid; n.cy = cy; n.top = cy - R; n.bottom = cy + R; n.right = mid + R;
      nodes.push(n); addBlock(block);
      return n;
    };
    const edge = (from, to, kind, pts, label, extra) => {
      const e = Object.assign({ from, to, kind, pts, label: label || null, lane: null }, extra);
      edges.push(e);
      return e;
    };
    const trunk = (a, b, labelY) => edge(a.block, b.block, 'trunk', [[mid, a.bottom], [mid, b.top]],
      { block: a.block, x: mid + 6, y: labelY != null ? labelY : (a.bottom + b.top) / 2, maxX: x1 });

    let y = 8;
    // --- entrada
    const nTok = box('tokens', y, defs.tokens);
    const nEmb = box('embed', nTok.bottom + GAP, defs.embed);
    trunk(nTok, nEmb);

    // --- codificación posicional: ⊕ con entrada lateral PE
    const pcy = nEmb.bottom + GAP + 15;
    const sideX = mid + R + 16;
    const learned = cfg.posEnc === 'learned';
    const nPos = sum('posenc', pcy, defs.posenc, {
      kind: 'posenc', cls: learned ? 'sum param' : 'sum',
      side: { x: sideX, y: pcy - 16, w: x1 - sideX, h: 32, label: learned ? 'P_{pos}' : 'PE', sub: learned ? 'aprendida' : 'sinusoidal' },
    });
    nPos.right = x1; nPos.x = x0; nPos.w = x1 - x0; nPos.y = pcy - 16; nPos.h = 32;
    nPos.top = pcy - R; nPos.bottom = pcy + R;
    edge('embed', 'posenc', 'trunk', [[mid, nEmb.bottom], [mid, nPos.top]], { block: 'embed', x: mid + 6, y: (nEmb.bottom + pcy - 16) / 2, maxX: x1 });
    edge('posenc', 'posenc', 'side', [[sideX, pcy], [mid + R, pcy]]);

    let prev = nPos;
    const firstLaneOf = [];
    let collapsed = false, L = 1, laneW = 0;

    for (let l = 0; l < N; l++) {
      const P = 'L' + l + '.';
      const pfb = prev._frameBottom;
      const frameTop = pfb ? pfb + 24 : prev.bottom + 30;
      const branchY = frameTop + 12;
      const frame = { layer: l, x: 2.5, y: frameTop, w: W - 5, h: 0, tab: { x: 2.5, y: frameTop - 16, h: 16, text: 'Capa ' + (l + 1) } };
      frames.push(frame);
      const lay = (def) => Object.assign({}, def, { layer: l });

      const nLn1 = box(P + 'ln1', frameTop + 24, lay(defs.ln1));
      edge(prev.block, nLn1.block, 'trunk', [[mid, prev.bottom], [mid, nLn1.top]], { block: prev.block, x: mid + 6, y: pfb ? pfb + 10 : prev.bottom + 11, maxX: x1 });
      const layerIn = prev.block;

      const nQkv = box(P + 'qkv', nLn1.bottom + GAP, lay(defs.qkv)); trunk(nLn1, nQkv);
      const nSplit = box(P + 'split', nQkv.bottom + GAP, lay(defs.split)); trunk(nQkv, nSplit);

      // --- carriles de cabezas
      collapsed = Hh > 4;
      L = Math.min(Hh, 4);
      const laneGap = 5;
      laneW = (x1 - x0 - laneGap * (L - 1)) / L;
      const wide = laneW >= 104;
      const bypass = wide;
      const nodeW = laneW - 8 - (bypass ? 14 : 0);
      const nh = wide ? 34 : 22, ngap = wide ? 20 : 16;
      const busY = nSplit.bottom + 10;
      const laneTop = nSplit.bottom + 22;
      const headerH = 17;
      let laneBottom = 0;
      const ctxNodes = [];
      for (let li = 0; li < L; li++) {
        const lx = x0 + li * (laneW + laneGap);
        const ncx = lx + 4 + nodeW / 2;
        const isRest = collapsed && li === 3;
        const hIdx = li + 1;
        const lane = { layer: l, lane: li, x: lx, y: laneTop, w: laneW, h: 0, cx: ncx, rest: isRest, heads: isRest ? Hh - 3 : 1,
          headCands: isRest ? ['cabezas 4–' + Hh, 'cab. 4–' + Hh, '4–' + Hh] : ['cabeza ' + hIdx, 'cab. ' + hIdx, String(hIdx)] };
        lanes.push(lane);
        let yy = laneTop + headerH + 2;
        let prevN = null;
        const hs = isRest ? 'h' : String(hIdx);
        for (const op of LANE_OPS) {
          const n = box(P + op.key, yy, {
            label: op.label, sub: op.sub(hs), op: op.op, cls: 'op', desc: op.desc, layer: l, lane: li, laneRest: isRest,
          }, { x: lx + 4, w: nodeW, h: nh, kind: wide ? 'box' : 'lane' });
          if (prevN) {
            // etiqueta en cada carril; renderShapes muestra solo la del carril de la cabeza activa
            edge(prevN.block, n.block, 'lane', [[ncx, prevN.bottom], [ncx, n.top]],
              { block: prevN.block, x: ncx + 5, y: (prevN.bottom + n.top) / 2, maxX: lx + laneW - (bypass ? 16 : 2), inLane: true, layer: l, lane: li },
              { lane: li });
          }
          prevN = n; yy = n.bottom + ngap;
        }
        const ctx = prevN;
        ctxNodes.push({ n: ctx, ncx, lx, li });
        laneBottom = ctx.bottom + 9;
        lane.h = laneBottom - laneTop;
        // entrada desde la división (Q_h, K_h)
        const fanPts = [[mid, nSplit.bottom], [mid, busY], [ncx, busY], [ncx, laneTop]];
        edge(nSplit.block, P + 'scores', 'fan', fanPts,
          { block: nSplit.block, x: ncx + 5, y: (busY + laneTop) / 2 + 0.5, maxX: lx + laneW - (bypass ? 16 : 2), layer: l, lane: li },
          { lane: li });
        // V_h entra directamente en A·V
        if (bypass) {
          const bx = lx + laneW - 8.5;
          edge(nSplit.block, P + 'context', 'bypass', [[mid, nSplit.bottom], [mid, busY], [bx, busY], [bx, ctx.cy], [ctx.right, ctx.cy]], null, { lane: li });
          notes.push({ x: bx - 4, y: laneTop + 12.5, text: 'V_' + hs, anchor: 'end', lane: li });
        }
        if (li === 0) firstLaneOf.push(l);
      }
      const bus2 = laneBottom + 9;
      const nConcat = box(P + 'concat', laneBottom + 24, lay(defs.concat));
      for (const c of ctxNodes) {
        // la etiqueta de forma de "contexto" va en el tallo común que entra en concat
        edge(c.n.block, nConcat.block, 'fanin', [[c.ncx, c.n.bottom], [c.ncx, bus2], [mid, bus2], [mid, nConcat.top]],
          c.li === 0 ? { block: c.n.block, x: mid + 6, y: bus2 + 7, maxX: x1 } : null,
          { lane: c.li });
      }

      const nProj = box(P + 'proj', nConcat.bottom + GAP, lay(defs.proj)); trunk(nConcat, nProj);
      const nRes1 = sum(P + 'res1', nProj.bottom + GAP + R, lay(defs.res1)); trunk(nProj, nRes1);
      edge(layerIn, nRes1.block, 'skip', [[mid, branchY], [railL, branchY], [railL, nRes1.cy], [mid - R, nRes1.cy]], null, { branch: [mid, branchY] });

      const branch2Y = nRes1.bottom + 10;
      const nLn2 = box(P + 'ln2', nRes1.bottom + 30, lay(defs.ln2));
      trunk(nRes1, nLn2, nRes1.bottom + 18);
      const nF1 = box(P + 'ffn1', nLn2.bottom + GAP, lay(defs.ffn1)); trunk(nLn2, nF1);
      const nAct = box(P + 'act', nF1.bottom + GAP, lay(defs.act)); trunk(nF1, nAct);
      const nF2 = box(P + 'ffn2', nAct.bottom + GAP, lay(defs.ffn2)); trunk(nAct, nF2);
      const res2Def = lay(defs.res2); res2Def.sub = 'X^{[' + (l + 1) + ']} = R + F';
      const nRes2 = sum(P + 'res2', nF2.bottom + GAP + R, res2Def); trunk(nF2, nRes2);
      edge(nRes1.block, nRes2.block, 'skip', [[mid, branch2Y], [railL, branch2Y], [railL, nRes2.cy], [mid - R, nRes2.cy]], null, { branch: [mid, branch2Y] });
      nRes1.sub = 'R = X^{[' + l + ']} + O';

      frame.h = nRes2.bottom + 12 - frameTop;
      prev = nRes2;
      prev._frameBottom = frameTop + frame.h;
    }

    // --- salida
    const fb = prev._frameBottom;
    const nLnf = box('lnf', fb + 26, defs.lnf);
    edge(prev.block, 'lnf', 'trunk', [[mid, prev.bottom], [mid, nLnf.top]], { block: prev.block, x: mid + 6, y: fb + 12, maxX: x1 });
    const nLog = box('logits', nLnf.bottom + GAP, defs.logits); trunk(nLnf, nLog);
    const nSm = box('softmax_out', nLog.bottom + GAP, defs.softmax_out); trunk(nLog, nSm);
    const nLoss = box('loss', nSm.bottom + GAP, defs.loss); trunk(nSm, nLoss);

    // --- optimizador, al costado
    const ox = Math.round(x0 + (x1 - x0) * 0.42);
    const nOpt = box('optim', nLoss.bottom + 32, defs.optim, { x: ox, w: x1 - ox });
    edge('loss', 'optim', 'grad', [[nOpt.cx, nLoss.bottom], [nOpt.cx, nOpt.top]],
      { block: 'loss', x: nOpt.cx + 6, y: (nLoss.bottom + nOpt.top) / 2, maxX: x1 });
    notes.push({ x: nOpt.cx - 6, y: (nLoss.bottom + nOpt.top) / 2 + 3.5, text: 'gradientes ∇θ', anchor: 'end' });

    let Htot = nOpt.bottom + 12;
    let legend = null;
    if (opts.legend !== false) {
      legend = { y: nOpt.bottom + 26 };
      Htot = legend.y + 6 * 17 + 6;
    }
    return { W, H: Htot, N, Hh, L, collapsed, laneW, x0, x1, mid, railL, railR, R, nodes, edges, frames, lanes, notes, legend, blocks };
  }

  // ---------------------------------------------------------------------------
  // render
  // ---------------------------------------------------------------------------
  function create(el, cfg, options) {
    if (!el) throw new Error('TL.Diagram.create: falta el elemento contenedor');
    const opts = Object.assign({ legend: true }, options || {});
    const uid = 'dg' + (++UID);
    const state = { active: null, shapes: {}, W: 0, lay: null, destroyed: false };
    el.classList.add('dg-host');

    const svg = svgEl('svg', {
      class: 'dg-svg', role: 'group', 'aria-label': 'Esquema del transformer (forward de arriba abajo)',
      xmlns: NS, focusable: 'false',
    });
    el.appendChild(svg);

    let gFrames, gLanes, gEdges, gHot, gNodes, gShapes, gNotes;
    const nodeEls = new Map(); // node → g
    const laneEls = [];

    function measureWidth() {
      const cs = getComputedStyle(el);
      const w = el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
      return w > 0 ? w : 0;
    }

    function arrowMarkers(defs) {
      const kinds = ['', 'skip', 'data', 'fwd', 'bwd', 'upd'];
      for (const k of kinds) {
        const m = svgEl('marker', {
          id: uid + '-a' + (k ? '-' + k : ''), class: 'dg-arrow' + (k ? ' dg-arrow--' + k : ''),
          viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7',
          markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse',
        }, defs);
        svgEl('path', { d: 'M0.5,1 L9.5,5 L0.5,9 Z' }, m);
      }
    }
    const markerUrl = (k) => 'url(#' + uid + '-a' + (k ? '-' + k : '') + ')';

    function build() {
      const hadFocus = svg.contains(document.activeElement);
      const keepKey = hadFocus ? state.stopKey : null;
      const w = measureWidth();
      const W = Math.round(clamp(w || state.W || 280, 240, 400));
      state.W = W;
      const lay = computeLayout(cfg, W, opts);
      state.lay = lay;
      svg.textContent = '';
      nodeEls.clear(); laneEls.length = 0;
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + Math.ceil(lay.H));
      svg.setAttribute('width', '100%');
      // nunca se amplía por encima de su ancho de diseño (texto nítido); se centra
      svg.style.maxWidth = W + 'px';
      svg.style.marginInline = 'auto';
      svg.style.aspectRatio = W + ' / ' + Math.ceil(lay.H);

      const defs = svgEl('defs', null, svg);
      arrowMarkers(defs);
      gFrames = svgEl('g', { class: 'dg-frames' }, svg);
      gLanes = svgEl('g', { class: 'dg-lanes' }, svg);
      gEdges = svgEl('g', { class: 'dg-edges' }, svg);
      gHot = svgEl('g', { class: 'dg-hot' }, svg);
      gNodes = svgEl('g', { class: 'dg-nodes' }, svg);
      gNotes = svgEl('g', { class: 'dg-notes', 'aria-hidden': 'true' }, svg);
      gShapes = svgEl('g', { class: 'dg-shapes', 'aria-hidden': 'true' }, svg);

      // marcos de capa
      for (const f of lay.frames) {
        const g = svgEl('g', { class: 'dg-frame-g', 'data-layer': f.layer, 'aria-hidden': 'true' }, gFrames);
        svgEl('rect', { class: 'dg-frame', x: f.x, y: f.y, width: f.w, height: f.h, rx: 6 }, g);
        const tg = svgEl('g', { class: 'dg-tab' }, g);
        const tw = Math.ceil(textWidth(f.tab.text, 10.5, true) + 6.5 * 0.84 + 14);
        svgEl('rect', { x: f.tab.x, y: f.tab.y, width: tw, height: f.tab.h, rx: 3 }, tg);
        const t = svgEl('text', { x: f.tab.x + 7, y: f.tab.y + 11.5 }, tg);
        t.textContent = f.tab.text;
        f.el = g;
      }

      // carriles
      for (const ln of lay.lanes) {
        const g = svgEl('g', { class: 'dg-lane-g', 'data-layer': ln.layer, 'data-lane': ln.lane, 'aria-hidden': 'true' }, gLanes);
        if (ln.rest) {
          // efecto de "pila" para las cabezas agrupadas
          svgEl('rect', { class: 'dg-lane-stack', x: ln.x + 3, y: ln.y - 3, width: ln.w, height: ln.h, rx: 4 }, g);
        }
        const r = svgEl('rect', { class: 'dg-lane', x: ln.x, y: ln.y, width: ln.w, height: ln.h, rx: 4 }, g);
        const t = svgEl('text', { class: 'dg-lane-head', x: ln.cx, y: ln.y + 12.5, 'text-anchor': 'middle' }, g);
        const cand = ln.headCands.find((c) => textWidth(c, 10, true) <= ln.w - 8) || ln.headCands[ln.headCands.length - 1];
        t.textContent = cand;
        ln.el = { g, rect: r, head: t };
        laneEls.push(ln);
      }

      // aristas
      for (const e of lay.edges) {
        const d = roundedPath(e.pts, 5);
        const cls = 'dg-edge dg-edge--' + e.kind;
        const p = svgEl('path', { class: cls, d, 'data-from': e.from, 'data-to': e.to }, gEdges);
        if (e.lane != null) p.setAttribute('data-lane', e.lane);
        if (e.kind === 'skip') p.setAttribute('marker-end', markerUrl('skip'));
        else p.setAttribute('marker-end', markerUrl(''));
        if (e.branch) svgEl('circle', { class: 'dg-branch', cx: e.branch[0], cy: e.branch[1], r: 2.5 }, gEdges);
        e.d = d; e.el = p;
      }

      // notas (V_h, "gradientes")
      for (const n of lay.notes) {
        const t = svgEl('text', { class: 'dg-edge-note' + (n.lane != null ? ' dg-edge-note--lane' : ''), x: n.x, y: n.y, 'text-anchor': n.anchor || 'start' }, gNotes);
        richText(t, n.text, 10);
      }

      // nodos
      for (const n of lay.nodes) renderNode(n, lay);

      if (lay.legend) renderLegend(lay);
      applyActive(false);
      // una sola parada de tabulación (roving tabindex); se conserva tras reconstruir
      const stop = (keepKey && nodeByKey(keepKey)) || (state.stopKey && nodeByKey(state.stopKey)) || lay.nodes[0];
      setTabStop(stop);
      if (hadFocus && stop) { try { stop.el.focus({ preventScroll: true }); } catch (e) { stop.el.focus(); } }
      fitTexts();
    }

    function nodeTitle(n) {
      const parts = [];
      if (n.layer != null) parts.push('Capa ' + (n.layer + 1));
      if (n.lane != null) parts.push(n.laneRest ? 'Cabezas 4–' + state.lay.Hh : 'Cabeza ' + (n.lane + 1));
      parts.push(n.label + (n.sub ? ' (' + plain(n.sub) + ')' : ''));
      return parts.join(' · ');
    }

    function renderNode(n, lay) {
      const g = svgEl('g', {
        class: 'dg-node dg-node--' + (n.cls || 'op').split(' ').join(' dg-node--'),
        'data-block': n.block, tabindex: '-1', role: 'button',
      }, gNodes);
      if (n.layer != null) g.setAttribute('data-layer', n.layer);
      if (n.lane != null) g.setAttribute('data-lane', n.lane);
      const title = nodeTitle(n);
      g.setAttribute('aria-label', title);
      const tt = svgEl('title', null, g);
      tt.textContent = title + (n.desc ? ' — ' + n.desc : '');

      if (n.kind === 'sum' || n.kind === 'posenc') {
        svgEl('circle', { class: 'dg-halo', cx: n.cx, cy: n.cy, r: n.r + 3 }, g);
        svgEl('circle', { class: 'dg-shape', cx: n.cx, cy: n.cy, r: n.r }, g);
        svgEl('path', { class: 'dg-glyph', d: 'M' + (n.cx - 5) + ',' + n.cy + 'H' + (n.cx + 5) + 'M' + n.cx + ',' + (n.cy - 5) + 'V' + (n.cy + 5) }, g);
        if (n.kind === 'posenc') {
          // etiqueta a la izquierda, caja PE a la derecha
          const lx = n.cx - n.r - 8;
          const t1 = svgEl('text', { class: 'dg-label', x: lx, y: n.cy - 1.5, 'text-anchor': 'end' }, g);
          t1.textContent = n.label;
          const t2 = svgEl('text', { class: 'dg-sub', x: lx, y: n.cy + 10.5, 'text-anchor': 'end' }, g);
          richText(t2, n.sub, 10.5);
          t1.dataset.maxw = t2.dataset.maxw = String(lx - 4);
          const s = n.side;
          svgEl('rect', { class: 'dg-halo', x: s.x - 3, y: s.y - 3, width: s.w + 6, height: s.h + 6, rx: 6 }, g);
          svgEl('rect', { class: 'dg-shape', x: s.x, y: s.y, width: s.w, height: s.h, rx: 3 }, g);
          if (/param/.test(n.cls)) svgEl('rect', { class: 'dg-pmark', x: s.x + s.w - 8, y: s.y + 3, width: 5, height: 5 }, g);
          const scx = s.x + s.w / 2;
          const a = svgEl('text', { class: 'dg-label', x: scx, y: s.y + 13, 'text-anchor': 'middle' }, g);
          richText(a, s.label, 12);
          const b = svgEl('text', { class: 'dg-sub', x: scx, y: s.y + 26.5, 'text-anchor': 'middle' }, g);
          b.textContent = s.sub;
          a.dataset.maxw = b.dataset.maxw = String(s.w - 8);
        } else {
          const lx = n.cx + n.r + 8;
          const maxw = lay.x1 - lx;
          const t1 = svgEl('text', { class: 'dg-label', x: lx, y: n.cy - 3 }, g);
          t1.textContent = n.label;
          const t2 = svgEl('text', { class: 'dg-sub', x: lx, y: n.cy + 11 }, g);
          richText(t2, n.sub, 10.5);
          t1.dataset.maxw = t2.dataset.maxw = String(maxw);
        }
      } else {
        const rx = n.cls === 'op' ? Math.min(n.h / 2, 11) : 3;
        svgEl('rect', { class: 'dg-halo', x: n.x - 3, y: n.y - 3, width: n.w + 6, height: n.h + 6, rx: rx + 3 }, g);
        svgEl('rect', { class: 'dg-shape', x: n.x, y: n.y, width: n.w, height: n.h, rx }, g);
        if (n.cls === 'param') svgEl('rect', { class: 'dg-pmark', x: n.x + n.w - 8, y: n.y + 3, width: 5, height: 5 }, g);
        const cx = n.x + n.w / 2;
        const maxw = n.w - (n.cls === 'op' ? 12 : 16);
        if (n.kind === 'lane') {
          const t = svgEl('text', { class: 'dg-op', x: cx, y: n.y + n.h / 2 + 3.6, 'text-anchor': 'middle' }, g);
          richText(t, n.op, 10.5);
          t.dataset.maxw = String(n.w - 5);
        } else {
          const t1 = svgEl('text', { class: 'dg-label', x: cx, y: n.y + n.h / 2 - 2.5, 'text-anchor': 'middle' }, g);
          richText(t1, n.label, 12);
          const t2 = svgEl('text', { class: 'dg-sub', x: cx, y: n.y + n.h / 2 + 10.5, 'text-anchor': 'middle' }, g);
          richText(t2, n.sub, 10.5);
          t1.dataset.maxw = t2.dataset.maxw = String(maxw);
        }
      }
      nodeEls.set(n, g);
      n.el = g;
    }

    function renderLegend(lay) {
      const g = svgEl('g', { class: 'dg-legend', 'aria-hidden': 'true' }, svg);
      const x = lay.x0, tx = x + 30;
      let y = lay.legend.y;
      const row = (draw, text) => {
        draw(y);
        const t = svgEl('text', { x: tx, y: y + 3.8 }, g);
        t.textContent = text;
        y += 17;
      };
      row((yy) => {
        svgEl('rect', { class: 'dg-shape', x, y: yy - 6, width: 22, height: 12, rx: 2 }, g);
        svgEl('rect', { class: 'dg-pmark', x: x + 16, y: yy - 4, width: 4, height: 4 }, g);
      }, 'bloque con parámetros entrenables');
      row((yy) => svgEl('rect', { class: 'dg-shape', x, y: yy - 6, width: 22, height: 12, rx: 6 }, g), 'operación sin parámetros');
      row((yy) => {
        svgEl('circle', { class: 'dg-shape', cx: x + 11, cy: yy, r: 6 }, g);
        svgEl('path', { class: 'dg-glyph', d: 'M' + (x + 8) + ',' + yy + 'H' + (x + 14) + 'M' + (x + 11) + ',' + (yy - 3) + 'V' + (yy + 3) }, g);
      }, 'suma · conexión residual (skip)');
      row((yy) => {
        const p = svgEl('path', { class: 'dg-legend-line dg-legend-line--fwd', d: 'M' + x + ',' + yy + 'H' + (x + 22) }, g);
        p.setAttribute('marker-end', markerUrl('fwd'));
      }, 'forward: datos (hacia abajo ↓)');
      row((yy) => {
        const p = svgEl('path', { class: 'dg-legend-line dg-legend-line--bwd', d: 'M' + x + ',' + yy + 'H' + (x + 22) }, g);
        p.setAttribute('marker-start', markerUrl('bwd'));
      }, 'backward: gradientes (hacia arriba ↑)');
      row((yy) => {
        const p = svgEl('path', { class: 'dg-legend-line dg-legend-line--upd', d: 'M' + x + ',' + yy + 'H' + (x + 22) }, g);
        p.setAttribute('marker-end', markerUrl('upd'));
      }, 'actualización: optimizador → parámetros');
    }

    // --- etiquetas de forma
    // carril donde van las etiquetas de una capa: el de la cabeza activa (si es de esa capa), si no el primero
    function labelLane(layer) {
      const a = state.active;
      if (!a || !a.block || layer == null) return 0;
      const m = a.block.match(/^L(\d+)\./);
      if (!m || +m[1] !== layer) return 0;
      const ln = laneOf(a.opts && a.opts.head, state.lay);
      return ln == null ? 0 : ln;
    }
    function renderShapes() {
      if (!gShapes) return;
      gShapes.textContent = '';
      const lay = state.lay;
      const map = state.shapes || {};
      for (const block of Object.keys(map)) {
        const val = map[block];
        if (val == null || val === '') continue;
        const e = lay.edges.find((ed) => ed.label && ed.label.block === block &&
          (ed.label.lane == null || ed.label.lane === labelLane(ed.label.layer)));
        if (!e) continue;
        const lb = e.label;
        const sh = parseShape(val);
        const avail = lb.maxX - lb.x;
        const fullW = textWidth((sh.sym ? sh.sym + ' · ' : '') + sh.num, 10, true);
        const t = svgEl('text', { x: lb.x, y: lb.y + 3.5, 'data-block': block }, gShapes);
        if (lb.inLane) {
          t.classList.add('dg-shape-inlane');
          // sobre un carril activo el halo debe usar el fondo del carril
          const ln = laneEls.find((q) => q.layer === lb.layer && q.lane === lb.lane);
          if (ln && ln.el.rect.classList.contains('is-active')) t.classList.add('on-active');
        }
        let sft = 0;
        if (fullW <= avail || !sh.num || !sh.sym) {
          if (sh.sym) sft = appendRich(t, sh.sym + (sh.num ? ' · ' : ''), 10, 'dg-sym', sft);
          if (sh.num) appendRich(t, sh.num, 10, 'dg-num', sft);
        } else {
          appendRich(t, sh.num, 10, 'dg-num', 0);
        }
        const tt = svgEl('title', null, t);
        tt.textContent = String(val);
      }
      markHotShapes();
    }

    function markHotShapes() {
      if (!gShapes) return;
      const a = state.active;
      for (const t of gShapes.querySelectorAll('text')) {
        const hot = !!(a && a.block && t.getAttribute('data-block') === a.block);
        t.classList.toggle('is-hot', hot);
        // data-phase también en etiquetas sobre un carril activo (su halo usa --ph-soft)
        if (a && a.block && (hot || t.classList.contains('on-active'))) t.setAttribute('data-phase', normPhase(a.phase));
        else t.removeAttribute('data-phase');
      }
    }

    // --- ajuste de textos (cuando las fuentes reales miden distinto)
    function fitTexts() {
      if (!svg.isConnected) return;
      if (svg.getBoundingClientRect().width > 0) state.fitted = true;
      for (const t of svg.querySelectorAll('text[data-maxw]')) {
        const maxw = parseFloat(t.dataset.maxw);
        if (!(maxw > 0)) continue;
        t.style.fontSize = '';
        let w = 0;
        try { w = t.getComputedTextLength(); } catch (e) { w = 0; }
        if (w > maxw && w > 0) {
          const fs = parseFloat(getComputedStyle(t).fontSize) || 11;
          t.style.fontSize = Math.max(7.5, fs * (maxw / w) * 0.98).toFixed(2) + 'px';
        }
      }
    }

    // --- estado activo
    function laneOf(head, lay) {
      if (head == null || head < 0) return null;
      if (lay.collapsed && head >= 3) return 3;
      return Math.min(head, lay.L - 1);
    }

    function clearActive() {
      for (const g of svg.querySelectorAll('.is-active, .is-target, .is-hot, .is-covered')) {
        g.classList.remove('is-active', 'is-target', 'is-hot', 'is-covered');
        g.removeAttribute('data-phase');
      }
      for (const g of svg.querySelectorAll('[aria-current]')) g.removeAttribute('aria-current');
      if (gHot) gHot.textContent = '';
      svg.removeAttribute('data-phase');
      for (const ln of laneEls) {
        if (ln.rest) {
          const cand = ln.headCands.find((c) => textWidth(c, 10, true) <= ln.w - 8) || ln.headCands[ln.headCands.length - 1];
          ln.el.head.textContent = cand;
        }
      }
    }

    function hotPath(e, ph, dir) {
      if (e.el) e.el.classList.add('is-covered');
      const g = svgEl('g', { 'data-phase': ph }, gHot);
      const base = svgEl('path', { class: 'dg-hot-edge' + (dir === 'up' ? ' dg-hot-edge--back' : ''), d: e.d || roundedPath(e.pts, 5) }, g);
      if (dir === 'up') {
        base.setAttribute('marker-start', markerUrl(ph));
        svgEl('path', { class: 'dg-flow', d: base.getAttribute('d') }, g);
      } else if (dir === 'down-flow') {
        base.setAttribute('marker-end', markerUrl(ph));
        base.classList.add('dg-hot-edge--back');
        svgEl('path', { class: 'dg-flow dg-flow--down', d: base.getAttribute('d') }, g);
      } else {
        base.setAttribute('marker-end', markerUrl(ph));
      }
      return g;
    }

    function applyActive(scroll) {
      clearActive();
      const a = state.active;
      if (!a || !a.block) { renderShapes(); return; }
      const lay = state.lay;
      const ph = normPhase(a.phase);
      svg.setAttribute('data-phase', ph);
      const o = a.opts || {};
      const lane = laneOf(o.head, lay);
      const blk = a.block;
      let first = null;

      for (const n of lay.nodes) {
        if (n.block !== blk) continue;
        if (n.lane != null && lane != null && n.lane !== lane) continue;
        n.el.classList.add('is-active');
        n.el.setAttribute('data-phase', ph);
        n.el.setAttribute('aria-current', 'step');
        if (!first) first = n;
      }
      // carril y cabecera
      const isLaneBlock = /\.(scores|scale|mask|softmax|context)$/.test(blk);
      const layerM = blk.match(/^L(\d+)\./);
      const layer = layerM ? +layerM[1] : null;
      if (isLaneBlock) {
        for (const ln of laneEls) {
          if (ln.layer !== layer) continue;
          if (lane != null && ln.lane !== lane) continue;
          ln.el.rect.classList.add('is-active'); ln.el.rect.setAttribute('data-phase', ph);
          ln.el.head.classList.add('is-active'); ln.el.head.setAttribute('data-phase', ph);
          if (ln.rest && o.head != null && o.head >= 3) {
            const hh = o.head + 1;
            const c = ['cabeza ' + hh, 'cab. ' + hh, String(hh)].find((s) => textWidth(s, 10, true) <= ln.w - 8) || String(hh);
            ln.el.head.textContent = c;
          }
        }
      }
      if (layer != null) {
        const f = lay.frames.find((fr) => fr.layer === layer);
        if (f) f.el.classList.add('is-hot');
      }
      // aristas conectadas
      const dir = ph === 'bwd' ? 'up' : 'down';
      for (const e of lay.edges) {
        if (e.kind === 'grad') {
          if (blk === 'optim' && ph === 'upd') hotPath(e, ph, 'down');
          continue;
        }
        if (e.from !== blk && e.to !== blk) continue;
        if (e.lane != null && lane != null && e.lane !== lane) continue;
        hotPath(e, ph, dir);
      }
      // actualización: enlace optimizador → bloque dueño del parámetro
      let scrollTarget = first;
      if (ph === 'upd' && o.paramBlock) {
        const opt = lay.nodes.find((n) => n.block === 'optim');
        const tgt = lay.nodes.find((n) => n.block === o.paramBlock && n.lane == null);
        if (tgt) {
          tgt.el.classList.add('is-target');
          if (tgt.layer != null) {
            const f = lay.frames.find((fr) => fr.layer === tgt.layer);
            if (f) f.el.classList.add('is-hot');
          }
          if (opt && tgt !== opt) {
            const tx = tgt.right, ty = tgt.kind === 'posenc' ? tgt.cy : tgt.cy;
            const pts = [[opt.right, opt.cy], [lay.railR, opt.cy], [lay.railR, ty], [tx, ty]];
            hotPath({ pts }, 'upd', 'down-flow');
          }
          scrollTarget = tgt;
        }
      }
      renderShapes();
      // la parada de tabulación sigue al bloque activo (sin mover el foco)
      if (first && !svg.contains(document.activeElement)) setTabStop(first);
      if (scroll && scrollTarget) scrollIntoView(scrollTarget);
    }

    function scrollParent() {
      for (let p = el; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (/(auto|scroll|overlay)/.test(s.overflowY) && p.scrollHeight > p.clientHeight + 1) return p;
      }
      return null;
    }

    function scrollIntoView(n) {
      const sp = scrollParent();
      if (!sp) return;
      const sr = svg.getBoundingClientRect();
      if (!sr.height) return;
      const k = sr.height / state.lay.H;
      const top = sr.top + (n.y - 6) * k, bot = sr.top + (n.y + n.h + 6) * k;
      const pr = sp.getBoundingClientRect();
      const margin = Math.min(48, pr.height * 0.12);
      if (top >= pr.top + margin && bot <= pr.bottom - margin) return;
      const target = sp.scrollTop + (top - pr.top) - (pr.height - (bot - top)) / 2;
      const max = sp.scrollHeight - sp.clientHeight;
      try {
        sp.scrollTo({ top: clamp(target, 0, max), behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      } catch (e) { sp.scrollTop = clamp(target, 0, max); }
    }

    // --- teclado: roving tabindex
    const keyOf = (n) => n.block + '|' + (n.lane == null ? '' : n.lane);
    function nodeByKey(k) { return state.lay.nodes.find((n) => keyOf(n) === k) || null; }
    function setTabStop(n) {
      if (!n || !n.el) return;
      for (const g of svg.querySelectorAll('.dg-node[tabindex="0"]')) if (g !== n.el) g.setAttribute('tabindex', '-1');
      n.el.setAttribute('tabindex', '0');
      state.stopKey = keyOf(n);
    }
    const LANE_KEYS = LANE_OPS.map((o) => o.key);
    const opIdx = (n) => LANE_KEYS.indexOf(n.block.slice(n.block.lastIndexOf('.') + 1));
    // ↑/↓ siguen el flujo (dentro de un carril, por sus operaciones); ←/→ cambian de cabeza
    function neighbor(n, key) {
      const lay = state.lay;
      const main = lay.nodes.filter((q) => q.lane == null);
      const laneNode = (layer, lane, k) => lay.nodes.find((q) => q.layer === layer && q.lane === lane && opIdx(q) === k) || null;
      const byBlock = (b) => lay.nodes.find((q) => q.block === b) || null;
      if (key === 'Home') return main[0];
      if (key === 'End') return main[main.length - 1];
      if (n.lane != null) {
        const k = opIdx(n);
        if (key === 'ArrowLeft') return laneNode(n.layer, n.lane - 1, k);
        if (key === 'ArrowRight') return laneNode(n.layer, n.lane + 1, k);
        if (key === 'ArrowUp') return k > 0 ? laneNode(n.layer, n.lane, k - 1) : byBlock('L' + n.layer + '.split');
        if (key === 'ArrowDown') return k < LANE_KEYS.length - 1 ? laneNode(n.layer, n.lane, k + 1) : byBlock('L' + n.layer + '.concat');
        return null;
      }
      const i = main.indexOf(n);
      if (key === 'ArrowDown') return /\.split$/.test(n.block) ? laneNode(n.layer, labelLane(n.layer), 0) : main[i + 1] || null;
      if (key === 'ArrowUp') return /\.concat$/.test(n.block) ? laneNode(n.layer, labelLane(n.layer), LANE_KEYS.length - 1) : main[i - 1] || null;
      return null;
    }

    // --- interacción
    function nodeFromEvent(ev) {
      const g = ev.target && ev.target.closest ? ev.target.closest('.dg-node') : null;
      if (!g || !svg.contains(g)) return null;
      for (const [n, gg] of nodeEls) if (gg === g) return n;
      return null;
    }
    function select(n) {
      if (typeof opts.onSelect === 'function') {
        const head = n.lane == null ? null : n.laneRest ? 3 : n.lane;
        opts.onSelect(n.block, { head });
      }
    }
    function onClick(ev) {
      const n = nodeFromEvent(ev);
      if (n) select(n);
    }
    function onKey(ev) {
      const n = nodeFromEvent(ev);
      if (!n) return;
      if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
        ev.preventDefault();
        select(n);
      } else if (/^(Arrow(Up|Down|Left|Right)|Home|End)$/.test(ev.key)) {
        const m = neighbor(n, ev.key);
        if (m && m !== n) { ev.preventDefault(); setTabStop(m); m.el.focus(); }
        else if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') ev.preventDefault();
      }
    }
    function onFocusIn(ev) {
      const n = nodeFromEvent(ev);
      if (n) setTabStop(n);
    }
    svg.addEventListener('click', onClick);
    svg.addEventListener('keydown', onKey);
    svg.addEventListener('focusin', onFocusIn);

    // --- tamaño
    let ro = null, raf = 0;
    function onResize() {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (state.destroyed) return;
        const w = measureWidth();
        if (!w) return;
        const target = Math.round(clamp(w, 240, 400));
        if (Math.abs(target - state.W) >= 16) build();
        else if (!state.fitted) fitTexts();
      });
    }
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(onResize);
      ro.observe(el);
    }
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => { if (!state.destroyed) fitTexts(); }).catch(() => {});
    }

    build();

    const api = {
      el: svg,
      get blocks() { return state.lay.blocks.slice(); },
      setActive(blockId, phase, o) {
        state.active = blockId ? { block: blockId, phase: phase || 'forward', opts: o || {} } : null;
        applyActive(true);
      },
      setShapes(map) {
        state.shapes = Object.assign({}, map || {});
        renderShapes();
      },
      relayout() { build(); },
      destroy() {
        state.destroyed = true;
        if (ro) ro.disconnect();
        if (raf) cancelAnimationFrame(raf);
        svg.removeEventListener('click', onClick);
        svg.removeEventListener('keydown', onKey);
        svg.removeEventListener('focusin', onFocusIn);
        svg.remove();
        el.classList.remove('dg-host');
      },
    };
    return api;
  }

  TL.Diagram = { create, _plain: plain, _parseShape: parseShape };
})(typeof window !== 'undefined' ? window : globalThis);
