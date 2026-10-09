/* =============================================================================
   Atlas de Arquitecturas — js/ui/viz/train-memory.js
   Visualización "train-memory" (SPEC §7.8, §22.3): qué ocupa la GPU al entrenar Llama 3 8B con FT completo, LoRA y QLoRA.
   Tres barras apiladas en la MISMA escala (bytes decimales), todas de ATLAS.Arch.metrics (modelo `lora`, js/arch/finetune.js):
     base (pesos de la base; rayado = congelada) · adaptadores · gradientes · optimizador (+ copia maestra fp32) · activaciones
     (≈, incluye los logits de la pérdida), con las líneas de 24 / 48 / 80 GB.
   Knobs compartidos por las tres filas (cada fila = su config con los mismos overrides): rango r (LoRA y QLoRA), bits de la base de
   LoRA (16 | 8; QLoRA es siempre NF4 + doble cuantización), optimizador (AdamW | AdamW 8-bit | SGD con momentum), gradient
   checkpointing (0 | 1), B y T. "Método" elige la fila que se detalla en la lectura.
   params: { method:'lora'|'full'|'qlora', r:16, bits:16, optimizer:8, gradCkpt:0, B:1, T:2048 }
   No toca el DOM al cargar.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const r1 = (v) => Math.round(v * 10) / 10;
  const METHODS = [
    { id: 'full', config: 'full-ft-llama3-8b', label: 'FT completo', knobs: ['optimizer', 'gradCkpt', 'B', 'T'] },
    { id: 'lora', config: 'lora-llama3-8b-r16', label: 'LoRA', knobs: ['r', 'bits', 'optimizer', 'gradCkpt', 'B', 'T'] },
    { id: 'qlora', config: 'qlora-llama3-8b-r16', label: 'QLoRA (NF4)', knobs: ['r', 'optimizer', 'gradCkpt', 'B', 'T'] },
  ];
  const KNOBS = {
    r: { label: 'Rango r', vals: [8, 16, 64], txt: (v) => String(v) },
    bits: { label: 'Base de LoRA', vals: [16, 8], txt: (v) => v + ' bits' },
    optimizer: { label: 'Optimizador', vals: [8, 2, 4], txt: (v) => ({ 8: 'AdamW', 2: 'AdamW 8-bit', 4: 'SGD + momentum' })[v] },
    gradCkpt: { label: 'Gradient checkpointing', vals: [0, 1], txt: (v) => (v ? 'sí' : 'no') },
    B: { label: 'B', vals: [1, 4, 8], txt: (v) => String(v) },
    T: { label: 'T', vals: [512, 2048, 8192], txt: (v) => String(v) },
  };
  const SEGS = [
    { id: 'base', key: 'baseWeightBytes', label: 'Pesos de la base', cls: 'is-base' },
    { id: 'adapters', key: 'adapterBytes', label: 'Adaptadores', cls: 'is-adapt' },
    { id: 'grads', key: 'gradBytes', label: 'Gradientes', cls: 'is-grad' },
    { id: 'optimizer', key: 'optimizerBytes', label: 'Optimizador (+ copia fp32)', cls: 'is-opt' },
    { id: 'activations', key: 'activationBytes', label: 'Activaciones + logits (≈)', cls: 'is-act' },
  ];
  const GPUS = [24e9, 48e9, 80e9];
  let uid = 0;

  function render(el, params) {
    const V = ATLAS.Viz, A = ATLAS.Arch;
    const fmt = (A && A.fmt) || {};
    const bytes = fmt.bytes || ((n) => (n / 1e9).toFixed(1) + ' GB');
    const fint = fmt.int || ((n) => String(n));
    const pick = (k, d) => (KNOBS[k].vals.indexOf(+params[k]) >= 0 ? +params[k] : d);
    const state = { method: METHODS.some((m) => m.id === params.method) ? params.method : 'lora', r: pick('r', 16), bits: pick('bits', 16), optimizer: pick('optimizer', 8), gradCkpt: pick('gradCkpt', 0), B: pick('B', 1), T: pick('T', 2048) };
    const metOf = (m) => { const ov = {}; m.knobs.forEach((k) => { ov[k] = state[k]; }); try { return A.metrics(m.config, ov); } catch (e) { return null; } };

    const wrap = V.html('div', { class: 'viz viz-tm' }, el);
    const ctl = V.html('div', { class: 'viz-controls' }, wrap);
    const grp = (lab) => { const g = V.html('div', { class: 'viz-ctl', role: 'group', 'aria-label': lab }, ctl); V.html('span', { class: 'viz-ctl-l', text: lab }, g); return g; };
    const all = [];
    const chip = (g, label, key, v) => { const b = V.html('button', { type: 'button', class: 'viz-chip', 'aria-pressed': 'false', text: label }, g); b.addEventListener('click', () => { state[key] = v; draw(); }); b._k = key; b._v = v; all.push(b); };
    const gM = grp('Detalle');
    METHODS.forEach((m) => chip(gM, m.label, 'method', m.id));
    Object.keys(KNOBS).forEach((k) => { const g = grp(KNOBS[k].label); KNOBS[k].vals.forEach((v) => chip(g, KNOBS[k].txt(v), k, v)); });
    const stage = V.html('div', { class: 'viz-stage viz-tm-stage', tabindex: 0, role: 'group', 'aria-label': 'Memoria de entrenamiento por método. Flechas arriba y abajo: método detallado; izquierda y derecha: largo de secuencia T; G: gradient checkpointing' }, wrap);
    const out = V.html('div', { class: 'viz-readout', 'aria-live': 'polite' }, wrap);
    const note = V.html('p', { class: 'viz-note' }, wrap);

    const pid = 'viz-tm-fz' + (++uid);
    let lastNarrow = null;
    function draw() {
      all.forEach((b) => b.setAttribute('aria-pressed', String(state[b._k] === b._v)));
      const rows = METHODS.map((m) => ({ m, met: metOf(m) }));
      const cw = stage.clientWidth || 860, narrow = cw < 640;
      lastNarrow = narrow;
      stage.innerHTML = '';
      const W = narrow ? Math.max(300, Math.min(460, cw)) : 880;
      const svg = V.svg('svg', { class: 'viz-svg', viewBox: '0 0 ' + W + ' 10', style: 'max-width:' + W + 'px', role: 'img' }, stage);
      const t = (p, x, y, s, cls, anchor) => { const e = V.svg('text', { x: r1(x), y: r1(y), class: cls, 'text-anchor': anchor || null }, p); V.rich(e, s); return e; };
      // rayado de "congelado" (líneas claras sobre el tramo de la base)
      const pat = V.svg('pattern', { id: pid, patternUnits: 'userSpaceOnUse', width: 5, height: 5, patternTransform: 'rotate(45)' }, V.svg('defs', null, svg));
      V.svg('path', { d: 'M0 0V5', class: 'viz-tm-hatch' }, pat);
      if (rows.some((x) => !x.met)) { t(svg, 8, 20, 'El calculador no tiene estas configs (modelo lora).', 'viz-t'); svg.setAttribute('viewBox', '0 0 ' + W + ' 30'); out.textContent = ''; return; }
      t(svg, 8, 15, narrow ? 'Memoria de un paso: Llama 3 8B' : 'Memoria de un paso de entrenamiento de Llama 3 8B (del calculador), mismos B, T y optimizador en las tres filas', 'viz-t');
      t(svg, 8, 29, narrow ? 'B = ' + state.B + ', T = ' + state.T + ' · activaciones ≈' : 'B = ' + state.B + ' · T = ' + state.T + ' · ' + KNOBS.optimizer.txt(state.optimizer) + ' · gradient checkpointing ' + KNOBS.gradCkpt.txt(state.gradCkpt) + ' · activaciones: estimación (≈)', 'viz-s');
      const lx = 8, bx = narrow ? 8 : 150, bw = W - bx - (narrow ? 8 : 170), bh = 20;
      const maxV = Math.max(...rows.map((x) => x.met.totalTrainMemory), ...GPUS) * 1.04;
      const X = (v) => bx + bw * v / maxV;
      let y = 62;
      const yTop = y, barYs = [];
      rows.forEach(({ m, met }) => {
        const cur = m.id === state.method;
        const rl = m.id === 'full' ? 'FT completo' : (m.id === 'lora' ? 'LoRA' + (state.bits === 8 ? ' 8 bits' : '') : 'QLoRA') + ' · r = ' + state.r;
        if (narrow) { t(svg, lx, y, rl, 'viz-n' + (cur ? ' viz-tm-cur' : '')); t(svg, W - 8, y, bytes(met.totalTrainMemory), 'viz-n', 'end'); y += 5; }
        else t(svg, lx, y + 14, rl, 'viz-n' + (cur ? ' viz-tm-cur' : ''));
        barYs.push(y);
        let x = X(0);
        SEGS.forEach((sg) => {
          const v = met[sg.key] || 0, w = bw * v / maxV;
          if (v > 0) {
            V.svg('rect', { x: r1(x), y: r1(y), width: r1(Math.max(1.2, w)), height: bh, class: 'viz-tm-seg ' + sg.cls }, svg);
            if (sg.id === 'base' && m.id !== 'full') V.svg('rect', { x: r1(x), y: r1(y), width: r1(Math.max(1.2, w)), height: bh, class: 'viz-tm-frozen', fill: 'url(#' + pid + ')' }, svg);
          }
          x += w;
        });
        V.svg('rect', { x: r1(X(0)), y: r1(y), width: r1(X(met.totalTrainMemory) - X(0)), height: bh, class: 'viz-tm-frame' + (cur ? ' is-cur' : '') }, svg);
        if (!narrow) t(svg, X(met.totalTrainMemory) + 6, y + 14, bytes(met.totalTrainMemory), 'viz-n');
        y += bh + (narrow ? 14 : 12);
      });
      // líneas de las GPU (por encima de las barras, finas)
      GPUS.forEach((g) => {
        // en angosto, solo sobre las barras (los rótulos de las filas van arriba de cada barra)
        const d = narrow ? barYs.map((by, i) => 'M' + r1(X(g)) + ' ' + r1(i ? by - 3 : yTop - 8) + 'V' + r1(by + bh + 3)).join('') : 'M' + r1(X(g)) + ' ' + r1(yTop - 8) + 'V' + r1(y - 6);
        V.svg('path', { d, class: 'viz-tm-gpu' }, svg);
        t(svg, X(g), yTop - 12, (g / 1e9) + ' GB', 'viz-tm-gput', 'middle');
      });
      // leyenda
      let lgx = lx, lgy = y + 8;
      SEGS.forEach((sg) => {
        const w = 13 + sg.label.length * 6.6 + 14;
        if (lgx > lx && lgx + w > W - 8) { lgx = lx; lgy += 16; }
        V.svg('rect', { x: r1(lgx), y: r1(lgy - 9), width: 10, height: 10, class: 'viz-tm-seg ' + sg.cls }, svg);
        if (sg.id === 'base') V.svg('rect', { x: r1(lgx), y: r1(lgy - 9), width: 10, height: 10, class: 'viz-tm-frozen', fill: 'url(#' + pid + ')' }, svg);
        t(svg, lgx + 14, lgy, sg.label, 'viz-s');
        lgx += w;
      });
      lgy += 16;
      t(svg, lx, lgy, narrow ? 'rayado: base congelada (LoRA, QLoRA)' : 'rayado: base congelada (en LoRA y QLoRA); líneas: GPU de 24 / 48 / 80 GB (sin el contexto de CUDA: ≈ 0.5–1 GB más)', 'viz-s');
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + r1(lgy + 10));
      svg.setAttribute('aria-label', rows.map(({ m, met }) => m.label + ': ' + bytes(met.totalTrainMemory)).join('; ') + ' (B = ' + state.B + ', T = ' + state.T + ').');

      const sel = rows.find((x) => x.m.id === state.method), met = sel.met;
      const fits = GPUS.find((g) => met.totalTrainMemory <= g);
      out.innerHTML = '';
      const kv = (k, v) => { const sp = V.html('span', null, out); sp.innerHTML = k + ' <b>' + v + '</b>'; };
      kv(sel.m.label + ':', bytes(met.totalTrainMemory) + (fits ? ' · entra en ' + fits / 1e9 + ' GB' : ' · no entra en 80 GB'));
      kv('entrenables:', fint(met.trainableParams) + ' (' + (100 * met.trainableShare).toFixed(met.trainableShare < 0.1 ? 2 : 0) + ' %)');
      kv('bytes por parámetro entrenable:', String(met.bytesPerTrainableParam));
      kv('base:', bytes(met.baseWeightBytes));
      kv('activaciones (≈):', bytes(met.activationBytes));
      kv('cómputo del paso:', fmt.ops ? fmt.ops(met.trainStepMacs) : fint(met.trainStepMacs));
      note.innerHTML = 'Del calculador (js/arch/finetune.js). FT completo con AdamW en precisión mixta ≈ 16 bytes por parámetro (pesos y gradientes bf16 + copia fp32 + m y v; ZeRO §3.1); LoRA guarda la base en bf16 y entrena ≈ 0.5 %; QLoRA guarda la base en NF4 con doble cuantización (≈ 4.13 bits por parámetro). Con secuencias largas mandan las activaciones (estimación ≈ por token y capa con FlashAttention-2; en LoRA con dropout cada adaptador guarda su copia de la entrada); el gradient checkpointing las baja a la entrada de cada capa a cambio de un forward más.';
    }
    stage.addEventListener('keydown', (ev) => {
      const k = ev.key;
      if (k === 'ArrowUp' || k === 'ArrowDown') { ev.preventDefault(); const i = METHODS.findIndex((m) => m.id === state.method); state.method = METHODS[(i + (k === 'ArrowDown' ? 1 : METHODS.length - 1)) % METHODS.length].id; draw(); }
      else if (k === 'ArrowRight' || k === 'ArrowLeft') { ev.preventDefault(); const vs = KNOBS.T.vals, i = Math.max(0, Math.min(vs.length - 1, vs.indexOf(state.T) + (k === 'ArrowRight' ? 1 : -1))); state.T = vs[i]; draw(); }
      else if (k === 'g' || k === 'G') { ev.preventDefault(); state.gradCkpt = state.gradCkpt ? 0 : 1; draw(); }
    });
    draw();
    let ro = null;
    if (root.ResizeObserver) { ro = new ResizeObserver(() => { const nar = (stage.clientWidth || 860) < 640; if (stage.clientWidth && nar !== lastNarrow) draw(); }); ro.observe(stage); }
    return { destroy() { if (ro) ro.disconnect(); wrap.remove(); } };
  }

  if (ATLAS.Viz) ATLAS.Viz.register('train-memory', render);
})(typeof window !== 'undefined' ? window : globalThis);
