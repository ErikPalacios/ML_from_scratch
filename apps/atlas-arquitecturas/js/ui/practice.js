/* =============================================================================
   Atlas de Arquitecturas — js/ui/practice.js
   ATLAS.Practice (SPEC §8): explorador de escalado, diagramas en blanco, drills de formas y de
   parámetros, "¿qué pasa si…?", hub 'practica' y páginas 'practica-<modelo>'.
     renderBlock(block, el, ctx) → {el, destroy}   tipos: scaling · blankdiagram · shapedrill · whatif
     renderHub(container, route, ctx) → {el, destroy}    página 'practica'
     renderModel(container, route, ctx) → {el, destroy}  página 'practica-<modelo>'
   (el shell llama destroy() al salir: desmonta diagramas mini/en blanco y cierra el popover).
   Todo número sale de ATLAS.Arch (run / metrics / fmt). Nada se escribe a mano.
   Ids de drills (persistencia, no renombrar): '<configId>:<tensorId>:shape',
   '<configId>:<nodeId>:params', 'whatif:<pageId>:<índice>', 'blank:<diagramId>'.
   Sin DOM al cargar: todo ocurre dentro de las funciones de render.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});

  // ------------------------------------------------------------------ utilidades
  const safe = (fn, dflt) => { try { const v = fn(); return v === undefined ? dflt : v; } catch (e) { return dflt; } };
  const h = (...a) => ATLAS.dom.h(...a);
  const icon = (n) => (ATLAS.dom && ATLAS.dom.icon ? ATLAS.dom.icon(n) : '');
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const Arch = () => ATLAS.Arch || null;
  const reduced = () => !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  let uidN = 0;
  const uid = (p) => (p || 'px') + '-' + (++uidN);

  function fInt(n) {
    const A = Arch();
    if (A && A.fmt && typeof A.fmt.int === 'function') return A.fmt.int(n);
    return Math.round(Number(n) || 0).toLocaleString('en-US');
  }
  function fSi(n) {
    const A = Arch();
    if (A && A.fmt && typeof A.fmt.si === 'function') return A.fmt.si(n);
    const v = Math.abs(n);
    const [d, s] = v >= 1e12 ? [1e12, 'T'] : v >= 1e9 ? [1e9, 'G'] : v >= 1e6 ? [1e6, 'M'] : v >= 1e3 ? [1e3, 'k'] : [1, ''];
    const x = n / d;
    return (Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2)) + (s ? ' ' + s : '');
  }
  // Memoria: el formateador único del calculador (unidades decimales, 1 KB = 1000 B). El respaldo
  // local solo corre si ATLAS.Arch no está cargado, y usa las mismas reglas.
  // Cómputo con prefijo pegado a la unidad: '17.56 GMACs', '35.13 GFLOPs' (ATLAS.Arch.fmt.ops).
  function fOps(n, unit) {
    const A = Arch();
    if (A && A.fmt && typeof A.fmt.ops === 'function') return A.fmt.ops(n, unit || 'MACs');
    const m = fSi(n).match(/^(.*) ([kKMGT])$/);
    return m ? m[1] + ' ' + m[2].toUpperCase() + (unit || 'MACs') : fSi(n) + ' ' + (unit || 'MACs');
  }
  function fBytes(b) {
    if (b == null || !isFinite(b)) return '—';
    const A = Arch();
    if (A && A.fmt && typeof A.fmt.bytes === 'function') return A.fmt.bytes(b);
    const v = Math.abs(b);
    const [d, s] = v >= 1e12 ? [1e12, 'TB'] : v >= 1e9 ? [1e9, 'GB'] : v >= 1e6 ? [1e6, 'MB'] : v >= 1e3 ? [1e3, 'KB'] : [1, 'B'];
    const x = b / d;
    return (d === 1 ? String(Math.round(x)) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2)) + ' ' + s;
  }
  const shapeKey = (num) => (num || []).join('×');
  function fSym(t) {
    const A = Arch();
    if (A && A.fmt && typeof A.fmt.shape === 'function') { const s = safe(() => A.fmt.shape(t, 'sym'), null); if (s) return s; }
    const sym = (t && t.sym) || [];
    return sym.map((s) => (sym.length > 1 && /[+\-·*/ ]/.test(s) ? '(' + s + ')' : s)).join('×');
  }
  function fShape(t) {
    const A = Arch();
    if (A && A.fmt && typeof A.fmt.shape === 'function') { const s = safe(() => A.fmt.shape(t, 'num'), null); if (s) return s; }
    return shapeKey(t && t.num);
  }
  // Factor "×4", "×15.9", "≈ ×1", "×0.5"
  function fFactor(r) {
    if (r == null || !isFinite(r)) return '—';
    if (Math.abs(r - 1) < 0.0005) return '×1';
    if (Math.abs(r - 1) < 0.05) { const d = (r - 1) * 100; return '≈ ×1 (' + (d > 0 ? '+' : '−') + Math.abs(d).toFixed(Math.abs(d) < 0.1 ? 2 : 1) + ' %)'; }
    const ri = Math.round(r);
    if (r >= 1 && Math.abs(r - ri) / r < 0.002) return '×' + ri;
    if (r >= 100) return '×' + Math.round(r);
    if (r >= 10) return '×' + r.toFixed(1);
    if (r >= 1) return '×' + String(Number(r.toFixed(2)));
    // menos de 1: "÷4" se lee mejor que "×0.25"
    const inv = 1 / r, ii = Math.round(inv);
    if (Math.abs(inv - ii) / inv < 0.002) return '÷' + ii;
    return '÷' + String(Number(inv >= 10 ? inv.toFixed(1) : inv.toFixed(2)));
  }

  // {{…}} del calculador (ATLAS.Quantities) y LaTeX (ATLAS.MathTex) — ambos opcionales.
  function fill(html, pageCtx) {
    const Q = ATLAS.Quantities;
    if (!Q || typeof Q.fill !== 'function' || String(html).indexOf('{{') < 0) return String(html == null ? '' : html);
    return safe(() => Q.fill(String(html), pageCtx), String(html));
  }
  function typeset(el) {
    const M = ATLAS.MathTex;
    if (M && typeof M.typeset === 'function') { try { const p = M.typeset(el); if (p && p.catch) p.catch(() => {}); } catch (e) { /* respaldo: LaTeX visible */ } }
  }
  function decorate(el) { if (ATLAS.Blocks && typeof ATLAS.Blocks.decorate === 'function') safe(() => ATLAS.Blocks.decorate(el)); }

  // RNG con semilla (opciones estables entre recargas) y sin semilla (siguiente drill).
  function hashStr(s) { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; }
  function rng(seed) {
    let a = (typeof seed === 'string' ? hashStr(seed) : seed) >>> 0;
    return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function shuffle(arr, r) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  function warnBox(el, msg) {
    el.appendChild(h('div', { class: 'px-warn', role: 'note' }, h('span', { html: icon('warn') }), h('span', null, String(msg))));
  }

  // ------------------------------------------------------------------ store (tolerante a métodos ausentes)
  function storeOf(ctx) { return (ctx && ctx.store) || ATLAS.store || null; }
  function sCall(store, name, ...args) { return store && typeof store[name] === 'function' ? safe(() => store[name](...args), undefined) : undefined; }
  function stats(store, prefix) {
    const s = sCall(store, 'drillStats', prefix);
    return Object.assign({ seen: 0, ok: 0, streak: 0, lastAt: null }, s || {});
  }
  function sumStats(store, prefixes) {
    const out = { seen: 0, ok: 0, streak: 0, lastAt: null };
    prefixes.forEach((p) => { const s = stats(store, p); out.seen += s.seen || 0; out.ok += s.ok || 0; if (s.lastAt && (!out.lastAt || s.lastAt > out.lastAt)) { out.lastAt = s.lastAt; out.streak = s.streak || 0; } });
    return out;
  }
  const pct = (s) => (s.seen ? Math.round((s.ok / s.seen) * 100) + ' %' : '—');

  // ------------------------------------------------------------------ calculador: configs, modelos, knobs, métricas
  const allConfigs = () => safe(() => Arch().configs(), []) || [];
  const configsOf = (model) => safe(() => Arch().configs(model), []) || [];
  function canonicalOf(model) { const cs = configsOf(model); return ((cs.find((c) => c.canonical) || cs[0]) || {}).id || null; }
  function cfgInfo(id) { return allConfigs().find((c) => c.id === id) || null; }
  function cfgLabel(id) { const c = cfgInfo(id); return c ? c.label : (safe(() => Arch().run(id).label, null) || id); }
  function modelOfConfig(id) { const c = cfgInfo(id); return c ? c.model : safe(() => Arch().run(id).model, null); }
  function run(id, ov) {
    const A = Arch();
    if (!A || typeof A.run !== 'function') throw new Error('El calculador (ATLAS.Arch) no está cargado.');
    return ov ? A.run(id, ov) : A.run(id);
  }
  // Fase 6: edge.ov / node.ov de un diagrama = knobs del calculador solo para esa arista o ese nodo (p. ej. {decode: 1}:
  // el carril de decode dentro de un diagrama de prefill). Igual que archdiagram.js ovRun: la misma config con
  // overrides + ov; si falla, la corrida base. ovKey = firma estable ('decode=1') para ids y comparaciones.
  function ovRun(R, ov) {
    if (!ov || !R) return R;
    return safe(() => run(R.id, Object.assign({}, R.overrides || {}, ov)), R) || R;
  }
  const ovKey = (ov) => (ov && typeof ov === 'object' ? Object.keys(ov).sort().map((k) => k + '=' + ov[k]).join(',') : '');
  const sameOv = (a, b) => ovKey(a) === ovKey(b);
  function metrics(cfg, ov) {
    const A = Arch();
    if (!A || typeof A.metrics !== 'function') throw new Error('El calculador no expone ATLAS.Arch.metrics.');
    // fp16 explícito: la memoria de scores se reporta en fp16 (SPEC §6.2); B = 1 por defecto.
    const m = A.metrics(cfg, Object.assign({ dtype: 'fp16' }, ov || {}));
    // El mapa `units` del modelo ({clave: 'ratio'|'count'|'bytes'|'pct'|'macs'|'params'}) manda sobre el nombre.
    if (m && m.units && typeof m.units === 'object') Object.assign(ARCH_UNITS, m.units);
    // MoE: E de la última corrida, para el formato 'avg' («≈ 7.2 de 8» expertos leídos por capa).
    ARCH_CTX.experts = m && typeof m.experts === 'number' ? m.experts : null;
    return m;
  }
  const ARCH_UNITS = {};
  const ARCH_CTX = {};
  // Knobs del modelo (SPEC §6.4 `knobs`). ATLAS.Arch.knobs(model) si existe; si no, lo que haya.
  function modelKnobs(model) {
    const A = Arch();
    if (!A) return {};
    const tries = [() => A.knobs(model), () => A.model(model).knobs, () => A.getModel(model).knobs, () => A.modelDef(model).knobs];
    for (const t of tries) { const k = safe(t, null); if (k && typeof k === 'object') return k; }
    return {};
  }
  function pageMeta(pageId) { return safe(() => (ATLAS.catalog().items || {})[pageId], null) || {}; }
  // Modelo del calculador de una página: el de su config canónica (la página 'llm-inferencia' puede
  // usar el modelo 'llm'); si no, el id de la página.
  function modelOfPage(pageId) {
    const m = pageMeta(pageId);
    return (m.canonical && modelOfConfig(m.canonical)) || m.arch || (configsOf(pageId).length ? pageId : null) || pageId;
  }
  function resolve(block, ctx) {
    const c = ctx || {};
    let config = block.config || null;
    let model = block.model || (config && modelOfConfig(config)) || c.model || (c.pageId ? modelOfPage(c.pageId) : null);
    if (!config && c.config && (!model || modelOfConfig(c.config) === model)) config = c.config;
    if (!config && model) { const m = pageMeta(c.pageId); config = (m.canonical && modelOfConfig(m.canonical) === model) ? m.canonical : canonicalOf(model); }
    if (!model && config) model = modelOfConfig(config);
    return { model, config };
  }

  const KNOBS = {
    res: { label: 'Resolución', show: (v) => v + '×' + v },
    P: { label: 'Patch P', show: (v) => 'P = ' + v },
    ctx: { label: 'Contexto', show: (v) => fInt(v) + ' tok' },
    T: { label: 'Tokens de texto T', show: (v) => fInt(v) },
    B: { label: 'Batch B', show: (v) => 'B = ' + fInt(v) },
    // DETR / Deformable DETR: imagen no cuadrada (H, W), object queries Q y objetos anotados G.
    H: { label: 'Alto H', show: (v) => 'H = ' + v },
    W: { label: 'Ancho W', show: (v) => 'W = ' + v },
    Q: { label: 'Object queries Q', show: (v) => 'Q = ' + fInt(v) },
    G: { label: 'Objetos anotados G', show: (v) => 'G = ' + fInt(v) },
    // SAM / SAM 2 (knobs que solo tienen esos modelos)
    masks: { label: 'Máscaras de salida', show: (v) => (v === 1 ? '1 máscara' : v + ' máscaras'), phrase: (v) => (v === 1 ? 'una sola máscara de salida' : v + ' máscaras de salida (multimask)') },
    maskIn: { label: 'Máscara previa como prompt', show: (v) => (v ? 'sí' : 'no'), phrase: (v) => (v ? 'con la máscara previa como prompt' : 'sin máscara previa') },
    memFrames: { label: 'Frames recientes Nᵣ', sym: 'Nᵣ', show: (v) => 'Nᵣ = ' + v, phrase: (v) => 'Nᵣ = ' + v + ' frames recientes' },
    ptrs: { label: 'Punteros de objeto P', sym: 'P', show: (v) => 'P = ' + v, phrase: (v) => 'P = ' + v + (v === 1 ? ' puntero de objeto' : ' punteros de objeto') },
    // Hardware propio del roofline (overrides de metrics(): LLM, difusión, VLA). En B/s y FLOP/s: se muestran en GB/s y TFLOPS.
    bandwidth: { label: 'Ancho de banda de memoria', show: (v) => fRate(v, 'B/s'), phrase: (v) => 'ancho de banda ' + fRate(v, 'B/s') },
    peakFlops: { label: 'Pico de cómputo', show: (v) => fRate(v, 'FLOPS'), phrase: (v) => 'pico ' + fRate(v, 'FLOPS') },
  };
  // 204.8e9 → '204.8 GB/s'; 3.35e12 → '3.35 TB/s'; 42.5e12 → '42.5 TFLOPS' (3 cifras significativas, sin ceros de más).
  function fRate(v, unit) {
    const P = [[1e15, 'P'], [1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k']].find(([x]) => Math.abs(v) >= x);
    return P ? String(Number((v / P[0]).toPrecision(4))) + ' ' + P[1] + unit : String(v) + ' ' + unit;
  }
  // Mismo knob, otro significado según el modelo: en SAM, P son clics del prompt (el patch es 16).
  // π0: el knob H es el CHUNK (cfg.Ha, símbolo H_a), no el alto de la imagen (cfg.H = 224).
  const KNOBS_BY_MODEL = {
    pi0: {
      H: { label: 'Acciones por chunk H_a', sym: 'H_a', show: (v) => 'H_a = ' + v, phrase: (v) => 'chunks de ' + v + ' acciones (H_a = ' + v + ')' },
      cams: { label: 'Cámaras', sym: 'cams', show: (v) => v + (v === 1 ? ' cámara' : ' cámaras'), phrase: (v) => (v === 1 ? 'una sola cámara' : v + ' cámaras') },
      steps: { label: 'Pasos de flow', sym: 'pasos', show: (v) => v + (v === 1 ? ' paso' : ' pasos'), phrase: (v) => v + (v === 1 ? ' paso' : ' pasos') + ' de flow por chunk' },
      T: { label: 'Tokens de texto T', show: (v) => 'T = ' + v, phrase: (v) => 'T = ' + v + ' tokens de texto (max_token_len, con relleno)' },
    },
    openvla: {
      T: { label: 'Tokens de texto T', show: (v) => 'T = ' + v, phrase: (v) => 'una instrucción de ' + v + ' tokens (T = ' + v + ')' },
      res: { label: 'Resolución', show: (v) => v + '×' + v },
      images: { label: 'Imágenes por paso', sym: 'imágenes', show: (v) => v + (v === 1 ? ' imagen' : ' imágenes'), phrase: (v) => (v === 1 ? 'una imagen por paso' : v + ' imágenes por paso (cámaras)') },
      da: { label: 'Dimensiones de la acción d_a', sym: 'd_a', show: (v) => 'd_a = ' + v, phrase: (v) => 'acciones de ' + v + ' dimensiones (d_a = ' + v + ': ' + v + ' tokens por paso)' },
    },
    sam: { P: { label: 'Clics P', show: (v) => 'P = ' + v, phrase: (v) => 'P = ' + v + (v === 1 ? ' clic' : ' clics') } },
    // Fase 10 (fine-tuning): targets = cuántas matrices por bloque llevan adapter; optimizer = bytes de estado por parámetro.
    lora: {
      r: { label: 'Rango r', show: (v) => 'r = ' + v, phrase: (v) => 'rango r = ' + v },
      targets: { label: 'Matrices adaptadas', show: (v) => (v === 2 ? 'W_Q y W_V' : v === 4 ? 'la atención (Q, K, V, O)' : v === 7 ? 'las 7 lineales' : v + ' matrices'), phrase: (v) => 'adapters en ' + (v === 2 ? 'W_Q y W_V' : v === 4 ? 'Q, K, V y O' : v === 7 ? 'las 7 lineales del bloque' : v + ' matrices') },
      bits: { label: 'Bits de la base congelada', show: (v) => v + ' bits', phrase: (v) => 'base congelada a ' + v + ' bits' + (v === 4 ? ' (NF4)' : '') },
      gradCkpt: { label: 'Gradient checkpointing', show: (v) => (v ? 'sí' : 'no'), phrase: (v) => (v ? 'con' : 'sin') + ' gradient checkpointing' },
      optimizer: { label: 'Optimizador', show: (v) => ({ 8: 'AdamW', 2: 'AdamW 8-bit', 4: 'SGD + momentum', 0: 'SGD' })[v] || v + ' B/param', phrase: (v) => 'con ' + (({ 8: 'AdamW (fp32)', 2: 'AdamW 8-bit', 4: 'SGD con momentum', 0: 'SGD sin momentum' })[v] || v + ' bytes de estado por parámetro') },
      T: { label: 'Tokens por secuencia T', show: (v) => 'T = ' + fInt(v), phrase: (v) => 'secuencias de ' + fInt(v) + ' tokens' },
      B: { label: 'Secuencias por paso B', show: (v) => 'B = ' + v, phrase: (v) => 'B = ' + v + ' secuencias por paso' },
    },
    'rlhf-dpo': {
      T: { label: 'Largo de secuencia T (prompt + respuesta)', show: (v) => 'T = ' + fInt(v), phrase: (v) => 'secuencias de ' + fInt(v) + ' tokens (prompt + respuesta)' },
      G: { label: 'Respuestas por prompt G', show: (v) => 'G = ' + v, phrase: (v) => 'G = ' + v + ' respuestas por prompt' },
      Gs: { label: 'Respuestas por prompt G', show: (v) => 'G = ' + v, phrase: (v) => 'G = ' + v + ' respuestas por prompt' },
      groupSize: { label: 'Respuestas por prompt G', show: (v) => 'G = ' + v, phrase: (v) => 'G = ' + v + ' respuestas por prompt' },
      B: { label: 'Prompts (o pares) por paso B', show: (v) => 'B = ' + v, phrase: (v) => 'B = ' + v + ' prompts (o pares) por paso' },
      lora: { label: 'LoRA', show: (v) => (v ? 'sí' : 'no'), phrase: (v) => (v ? 'con LoRA (la referencia = la base)' : 'sin LoRA') },
      refOffload: { label: 'Log-probs de la referencia precalculados', show: (v) => (v ? 'sí' : 'no'), phrase: (v) => (v ? 'con' : 'sin') + ' log-probs de la referencia precalculados' },
      gradCkpt: { label: 'Gradient checkpointing', show: (v) => (v ? 'sí' : 'no'), phrase: (v) => (v ? 'con' : 'sin') + ' gradient checkpointing' },
    },
    llava: { images: { label: 'Imágenes en el prompt', show: (v) => v + (v === 1 ? ' imagen' : ' imágenes'), phrase: (v) => v + (v === 1 ? ' imagen' : ' imágenes') + ' en el prompt' } },
    // Qwen2-VL: frames = 1 es una imagen (se duplica a 2 frames); un video de F frames da F/2 parches temporales.
    'qwen2-vl': { frames: { label: 'Frames del video F', sym: 'F', show: (v) => (v === 1 ? '1 (imagen)' : v + ' frames'), phrase: (v) => (v === 1 ? 'una imagen' : 'un video de ' + v + ' frames') } },
    llm: {
      T: { label: 'Tokens del prompt T', show: (v) => 'T = ' + fInt(v), phrase: (v) => 'un prompt de ' + fInt(v) + ' tokens' },
      ctx: { label: 'Contexto ctx', show: (v) => fInt(v) + ' tok', phrase: (v) => fInt(v) + ' tokens de contexto en la cache' },
      bits: { label: 'Bits de los pesos', show: (v) => v + ' bits', phrase: (v) => 'pesos a ' + v + ' bits (embedding y LM head en 16)' },
      kvBits: { label: 'Bits de la KV cache', show: (v) => v + ' bits', phrase: (v) => 'KV cache a ' + v + ' bits' },
      nKV: { label: 'Cabezas KV n_KV', show: (v) => 'n_KV = ' + v, phrase: (v) => 'n_KV = ' + v + (v === 1 ? ' (MQA)' : '') },
    },
  };
  const knobDef = (k, model) => (model && KNOBS_BY_MODEL[model] && KNOBS_BY_MODEL[model][k]) || KNOBS[k] || null;
  const knobLabel = (k, model) => (knobDef(k, model) || {}).label || k;
  const knobShow = (k, v, model) => { const d = knobDef(k, model); return d && d.show ? d.show(v) : String(v); };
  function changeText(change, model) {
    const c = change || {};
    const one = (k, v) => {
      const d = knobDef(k, model);
      if (k === 'res') return 'resolución ' + knobShow(k, v, model);
      if (d && d.phrase) return d.phrase(v);
      return d && /=/.test(knobShow(k, v, model)) ? knobLabel(k, model).replace(/\s+\S+$/, '').toLowerCase() + ' ' + knobShow(k, v, model) : knobLabel(k, model) + ' = ' + knobShow(k, v, model);
    };
    // Alto y ancho juntos: "imagen de 1600×2432 (H×W)", no "alto H = 1600 · ancho W = 2432".
    const both = c.H != null && c.W != null;
    const parts = both ? ['imagen de ' + c.H + '×' + c.W + ' (H×W)'] : [];
    Object.keys(c).forEach((k) => { if (!(both && (k === 'H' || k === 'W'))) parts.push(one(k, c[k])); });
    return parts.join(' · ');
  }
  // Valor base de un knob en la config. `res` es el lado de una imagen CUADRADA: si la config no es
  // cuadrada (Grounding DINO-T @ 896×1344) no hay base en la serie (null) y el explorador elige una
  // cuadrada (renderScaling) en vez de colar 896×1344 como si fuera "896".
  function knobBase(cfg, key, values) {
    const c = cfg || {};
    if (key === 'res') return c.res != null ? c.res : (c.H != null && c.H === c.W ? c.H : null);
    if (c[key] != null) return c[key];
    return values && values.length ? values[0] : null;
  }

  // Métricas: etiqueta, tipo de formato y nota. `notes` = nota por modelo (Swin: ventanas fijas, sin CLS;
  // CLIP: torres por muestra y una parte conjunta del lote B; DETR: N = tokens de C5 sin CLS, y los scores
  // mezclan el encoder (∝ N²) con el decoder (cross ∝ Q·N, self ∝ Q²); Deformable DETR: el encoder no
  // tiene matriz N×N, así que los scores genéricos son solo los de la self-attention del decoder).
  // kind: count · ops (MACs) · bytes · pct (fracción 0–1) · ratio (cociente adimensional, "×505") · bool (sí / no; fase 10).
  const METRICS = {
    tokens: { label: 'Tokens', kind: 'count', note: 'longitud de la secuencia (incluye CLS)',
      labels: { 'grounding-dino': 'Tokens de imagen N', 'yolo-world': 'Celdas A (P3–P5)', yolov8: 'Celdas A (P3–P5)', sam: 'Tokens del encoder N', sam2: 'Tokens a stride 16 N' },
      notes: { swin: 'tokens del stage 1 (H/4 × W/4, sin CLS)', clip: 'torre de imagen: N + 1 (incluye CLS)',
        detr: 'tokens del encoder: (H/32)·(W/32), sin CLS', 'deformable-detr': 'tokens de todos los niveles (Σ H_l·W_l, strides 8 a 64), sin CLS',
        'grounding-dino': 'tokens de imagen de los 4 niveles (Σ H_l·W_l, strides 8 a 64), sin CLS; el texto (T) va aparte',
        'yolo-world': 'puntos de anclaje A = Σ h·w de P3–P5 (strides 8, 16, 32; 8,400 a 640): celdas de la rejilla, no una secuencia',
        yolov8: 'puntos de anclaje A = Σ h·w de P3–P5 (strides 8, 16, 32; 8,400 a 640): celdas de la rejilla, no una secuencia',
        sam: '(H/16)·(W/16) tokens del ViT (64×64 a 1024), sin CLS',
        sam2: '(H/16)·(W/16) tokens de Hiera a stride 16 (los que leen la memory attention y el decoder), sin CLS; el stage 1 tiene 16× más',
        llm: 'tokens del prompt (T), sin CLS' } },
    patches: { label: 'Patches', kind: 'count' },
    params: { label: 'Parámetros', kind: 'count', note: 'pesos + biases' },
    macs: { label: 'MACs', kind: 'ops', note: 'matmuls y convs · FLOPs = 2 × MACs',
      // difusión: el grafo es UNA evaluación de cada componente, no la imagen (esa es samplingMacs)
      labels: { 'stable-diffusion': 'MACs de un paso del grafo (texto + 1 NFE + VAE)', dit: 'MACs por NFE' },
      notes: { 'stable-diffusion': 'una vez cada componente; el costo por imagen es «MACs por imagen»', dit: 'una evaluación del DiT; el costo por imagen es «MACs por imagen»' } },
    flops: { label: 'FLOPs', kind: 'ops', note: '= 2 × MACs' },
    attnMem: { label: 'Scores de atención', kind: 'bytes', note: 'h×N×N en fp16, una capa, B = 1',
      notes: { swin: 'nW×h×M²×M² en fp16, el mayor bloque, B = 1', clip: 'h×N×N en fp16, una capa de la torre mayor, una muestra',
        detr: 'h×N×N del encoder en fp16, una capa, B = 1 (el mayor: cross es h×Q×N)',
        'deformable-detr': 'no aplica: el encoder deformable no tiene matriz N×N (ver «Scores si el encoder fuera denso»)',
        'grounding-dino': 'no aplica: el encoder de imagen es deformable (ver «Scores de la fusión imagen ↔ texto», h/2×N×T)',
        'yolo-world': 'no aplica: no hay atención h×N×N (convs; la max-sigmoid es por celda y palabra)', yolov8: 'no aplica: YOLOv8 es solo convs',
        sam: 'h×N×N de un bloque global del ViT en fp16, B = 1 (los bloques con ventanas: 25×h×196×196)',
        sam2: 'el mayor tensor de scores de una capa en fp16, B = 1: un bloque global de Hiera (stage 3) o la cross-attention a la memoria (1×N×Nₘ)' } },
    actMem: { label: 'Activaciones', kind: 'bytes', note: 'fp16, B = 1', notes: { clip: 'fp16, las dos torres, una muestra' } },
    kvCache: { label: 'KV cache', kind: 'bytes', note: 'fp16, B = 1', notes: { llm: 'ctx × B × KV por token, a los bits de la KV (por defecto bf16, ctx = 4,096, B = 1)' } },
    attnMemAllLayers: { label: 'Scores de atención (todas las capas)', kind: 'bytes', note: 'fp16, B = 1 (entrenamiento sin recomputar)' },
    actMemPerSample: { label: 'Activaciones por muestra', kind: 'bytes', note: 'fp16, sin los tensores del lote' },
    paramMem: { label: 'Pesos en memoria', kind: 'bytes', note: 'parámetros × 2 bytes (fp16)' },
    linearMacs: { label: 'MACs de las lineales de las capas', kind: 'ops', note: 'proyecciones Q, K, V, O y MLP' },
    other: { label: 'Otras operaciones', kind: 'count', note: 'ops de normas, softmax y activaciones (no son MACs)' },
    scoreMacs: { label: 'MACs de QKᵀ y A·V', kind: 'ops', note: 'la parte que crece con N²',
      notes: { swin: 'con ventanas M×M fijas crece ∝ N (lineal)',
        detr: 'encoder (∝ N²) + decoder (cross ∝ Q·N, self ∝ Q²)',
        'deformable-detr': 'no aplica: sin término N² (ver el muestreo deformable y la self-attention del decoder)',
        'grounding-dino': 'no aplica: sin término N² (ver la fusión imagen ↔ texto y el muestreo deformable)', 'yolo-world': 'no aplica: sin atención densa', yolov8: 'no aplica: solo convs',
        sam: 'encoder + decoder: las ventanas crecen ∝ N, los 4 bloques globales ∝ N² (sin la posición relativa)',
        sam2: 'Hiera (ventanas ∝ N, globales ∝ N²) + memory attention (cross ∝ N·Nₘ) + decoder' } },
    // Dos "partes de atención" distintas: siempre con su nombre completo (no se confunden).
    scoreMacsShare: { label: 'Atención (solo QKᵀ y A·V)', kind: 'pct', note: '% de los MACs totales; la parte ∝ N²',
      notes: { swin: '% de los MACs totales; con ventanas fijas, lineal en N',
        detr: '% de los MACs: encoder (∝ N²) más decoder (cross ∝ Q·N, self ∝ Q²)',
        'deformable-detr': 'no aplica: sin término N² (ver «Muestreo deformable»)',
        'grounding-dino': 'no aplica: sin término N² (ver «Fusión imagen ↔ texto»)', 'yolo-world': 'no aplica: sin atención densa', yolov8: 'no aplica: solo convs',
        sam: '% de los MACs: encoder (ventanas ∝ N, 4 globales ∝ N²) + decoder', sam2: '% de los MACs: Hiera + memory attention (cross ∝ N·Nₘ) + decoder' } },
    // DETR: la atención separada por dónde ocurre (solo el encoder es ∝ N²).
    encScoreMacs: { label: 'Encoder: MACs de QKᵀ y A·V', kind: 'ops', note: 'todas las capas del encoder; ∝ N²' },
    encScoreMacsLayer: { label: 'Encoder: MACs de QKᵀ y A·V (una capa)', kind: 'ops', note: '2·N²·D; ∝ N²' },
    encScoreShare: { label: 'Encoder: QKᵀ y A·V', kind: 'pct', note: '% de los MACs totales; la única parte ∝ N²' },
    decCrossScoreMacs: { label: 'Cross-attention: MACs de QKᵀ y A·V', kind: 'ops', note: 'las capas del decoder; ∝ Q·N' },
    decCrossScoreMacsLayer: { label: 'Cross-attention: MACs de QKᵀ y A·V (una capa)', kind: 'ops', note: '2·Q·N·D; ∝ Q·N' },
    decCrossScoreShare: { label: 'Cross-attention: QKᵀ y A·V', kind: 'pct', note: '% de los MACs totales; ∝ Q·N' },
    decSelfScoreMacs: { label: 'Self-attention del decoder: MACs de QKᵀ y A·V', kind: 'ops', note: 'las capas del decoder; ∝ Q²' },
    decSelfScoreMacsLayer: { label: 'Self-attention del decoder: MACs de QKᵀ y A·V (una capa)', kind: 'ops', note: '2·Q²·D; ∝ Q²' },
    decSelfScoreShare: { label: 'Self-attention del decoder: QKᵀ y A·V', kind: 'pct', note: '% de los MACs totales; ∝ Q²' },
    encAttnMem: { label: 'Scores del encoder', kind: 'bytes', note: 'h×N×N en fp16, una capa, B = 1' },
    encAttnFp32Mem: { label: 'Scores del encoder (fp32)', kind: 'bytes', note: 'h×N×N en fp32, una capa, B = 1' },
    encAttnMemAllLayers: { label: 'Scores del encoder (todas las capas)', kind: 'bytes', note: 'h×N×N × capas, fp16, B = 1 (entrenamiento sin recomputar)' },
    encAttnMem2x: { label: 'Scores del encoder con H y W ×2', kind: 'bytes', note: 'tokens ×4 ⇒ h×N×N ×16; fp16, una capa, B = 1' },
    decCrossAttnMem: { label: 'Scores de la cross-attention', kind: 'bytes', note: 'h×Q×N en fp16, una capa, B = 1' },
    decSelfAttnMem: { label: 'Scores de la self-attention del decoder', kind: 'bytes', note: 'h×Q×Q en fp16, una capa, B = 1', notes: { sam: 'h×T×T de los tokens del decoder en fp16, una capa, B = 1' } },
    encAttnEntries: { label: 'Entradas de scores del encoder', kind: 'count', note: 'h×N×N, una capa' },
    decCrossAttnEntries: { label: 'Entradas de scores de la cross-attention', kind: 'count', note: 'h×Q×N, una capa' },
    decSelfAttnEntries: { label: 'Entradas de scores de la self-attention del decoder', kind: 'count', note: 'h×Q×Q, una capa' },
    encToCrossScore: { label: 'Scores del encoder / de la cross-attention', kind: 'ratio', note: 'por capa: N²/(Q·N) = N/Q' },
    tokens2x: { label: 'Tokens con H y W ×2', kind: 'count', note: '≈ ×4 (un stride menos, como DC5)' },
    encScoreMacs2x: { label: 'Encoder: QKᵀ y A·V con H y W ×2', kind: 'ops', note: 'tokens ×4 ⇒ ×16' },
    backboneMacs: { label: 'MACs del backbone', kind: 'ops', note: 'ResNet-50 hasta C5',
      notes: { 'yolo-world': 'CSPDarknet de YOLOv8-L hasta P5 (con SPPF)', yolov8: 'CSPDarknet hasta P5 (con SPPF)' } },
    backboneMacsShare: { label: 'Backbone', kind: 'pct', note: '% de los MACs totales' },
    inputProjMacs: { label: 'MACs de la proyección de entrada', kind: 'ops', note: 'conv 1×1 de C5 a D' },
    encoderMacs: { label: 'MACs del encoder', kind: 'ops', note: 'todas sus capas', notes: { sam: 'ViT + neck: una vez por imagen, sirve a todos los prompts' } },
    encoderMacsShare: { label: 'Encoder', kind: 'pct', note: '% de los MACs totales', notes: { sam: '% de los MACs con un prompt (ViT + neck, una vez por imagen)' } },
    decoderMacs: { label: 'MACs del decoder', kind: 'ops', note: 'todas sus capas', notes: { sam2: 'prompt encoder + decoder + cabeza de oclusión, por objeto (sin las convs de alta resolución, que se comparten)' } },
    decoderMacsShare: { label: 'Decoder', kind: 'pct', note: '% de los MACs totales', notes: { sam: '% de los MACs: prompt encoder + decoder, un prompt', sam2: '% del frame: prompt encoder + decoder + oclusión, por objeto' } },
    headMacs: { label: 'MACs de las cabezas', kind: 'ops', note: 'clase + caja, sobre las Q queries',
      notes: { 'grounding-dino': 'cabeza contrastiva (query · token, sin pesos) + MLP de cajas, sobre las Q queries',
        'yolo-world': 'cajas + texto (embedding de región · vocabulario) en P3–P5, cada celda', yolov8: 'cajas + clases en P3–P5, cada celda (desacopladas)' } },
    auxHeadsMacs: { label: 'MACs de las cabezas auxiliares', kind: 'ops', note: 'solo entrenamiento: las otras capas del decoder' },
    queries: { label: 'Object queries Q', kind: 'count', note: 'predicciones por imagen (el máximo de detecciones)' },
    // ---- Fase 4: Grounding DINO (texto en cada imagen, fusión imagen ↔ texto, reparto por bloque)
    imageTokens: { label: 'Tokens de imagen N', kind: 'count', note: 'Σ H_l·W_l de los 4 niveles (strides 8 a 64)', notes: { sam: '(H/16)·(W/16): las keys de imagen del decoder' } },
    textTokens: { label: 'Tokens de texto T', kind: 'count', note: 'el prompt en WordPiece, con [CLS] y [SEP]', notes: { llava: 'tokens de texto del prompt (sin el marcador de imagen)', 'qwen2-vl': 'tokens de texto del prompt' } },
    // Una sola entrada por clave (revisión de la fase 8: la de difusión pisaba a la de Grounding DINO / YOLO-World): lo propio de
    // cada modelo va en labels / notes.
    textEncoderMacs: { label: 'MACs del texto (BERT + proyección)', kind: 'ops', note: 'se pagan en CADA imagen: el prompt entra junto con la imagen',
      labels: { 'stable-diffusion': 'MACs del text encoder' },
      notes: { 'stable-diffusion': 'por pasada; 2 por imagen con CFG (el prompt y el vacío)' } },
    textEncoderParams: { label: 'Parámetros del codificador de texto', kind: 'count', note: 'BERT-base + proyección 768 → D',
      labels: { 'stable-diffusion': 'Parámetros del text encoder' },
      notes: { 'yolo-world': 'CLIP ViT-B/32 (torre de texto) + proyección; corre offline: fuera del total', 'stable-diffusion': 'CLIP ViT-L/14 (texto)' } },
    textEncoderMacsShare: { label: 'Texto (BERT + proyección)', kind: 'pct', note: '% de los MACs por imagen' },
    textEncoderMacsMaxT: { label: 'MACs del texto con T = 256', kind: 'ops', note: 'el máximo de tokens (max_text_len)' },
    fusionMacs: { label: 'MACs de la fusión imagen ↔ texto', kind: 'ops', note: 'i2t + t2i de las 6 capas del feature enhancer',
      notes: { 'yolo-world': 'max-sigmoid de los 4 T-CSPLayers + image-pooling attention' } },
    fusionMacsShare: { label: 'Fusión imagen ↔ texto', kind: 'pct', note: '% de los MACs totales' },
    fusionMacsLayer: { label: 'MACs de la fusión (una capa)', kind: 'ops', note: 'proyecciones a E = D_mlp/2 + la matriz h/2×N×T' },
    fusionScoreMacsLayer: { label: 'Fusión: MACs de la matriz y los A·V (una capa)', kind: 'ops', note: '3·N·T·E: la parte que crece con N·T' },
    fusionAttnEntries: { label: 'Entradas de scores de la fusión', kind: 'count', note: 'h/2×N×T, una capa' },
    fusionAttnMem: { label: 'Scores de la fusión imagen ↔ texto', kind: 'bytes', note: 'h/2×N×T en fp16, una capa, B = 1 (una sola matriz para i2t y t2i)' },
    imgBackboneMacs: { label: 'MACs del backbone de imagen', kind: 'ops', note: 'Swin-T hasta C5' },
    imgBackboneMacsShare: { label: 'Backbone de imagen (Swin-T)', kind: 'pct', note: '% de los MACs totales' },
    enhancerMacs: { label: 'MACs del feature enhancer', kind: 'ops', note: 'sus 6 capas: fusión, self-attention deformable de la imagen y del texto, FFN' },
    enhancerMacsShare: { label: 'Feature enhancer', kind: 'pct', note: '% de los MACs totales' },
    querySelectMacs: { label: 'MACs de la query selection', kind: 'ops', note: 'puntúa los N tokens contra el texto y toma los Q mejores' },
    querySelectMacsShare: { label: 'Query selection', kind: 'pct', note: '% de los MACs totales' },
    decTextScoreMacs: { label: 'Cross-attention de texto: MACs de QKᵀ y A·V', kind: 'ops', note: 'las capas del decoder; ∝ Q·T' },
    decTextAttnMem: { label: 'Scores de la cross-attention de texto', kind: 'bytes', note: 'h×Q×T en fp16, una capa, B = 1' },
    txtSelfAttnMem: { label: 'Scores de la self-attention del texto', kind: 'bytes', note: 'h/2×T×T en fp16, una capa, B = 1' },
    logitsElements: { label: 'Logits', kind: 'count', note: 'puntuaciones de salida',
      labels: { 'grounding-dino': 'Logits Q×T', 'yolo-world': 'Logits A×V', yolov8: 'Logits A×K' },
      notes: { 'grounding-dino': 'una puntuación por query y token de texto (HF rellena hasta Q×256)', 'yolo-world': 'una puntuación por celda y palabra (P3–P5)', yolov8: 'una puntuación por celda y clase (P3–P5)' } },
    logitsPaddedElements: { label: 'Logits rellenados (HF)', kind: 'count', note: 'Q×256: HF rellena hasta max_text_len con −∞' },
    bytesPerElement: { label: 'Bytes por elemento', kind: 'count', note: 'del dtype' },
    // comparación entre detectores: cada uno en SU configuración salvo que la etiqueta diga otra cosa
    yolov8Macs: { label: 'MACs de YOLOv8-L', kind: 'ops', note: 'YOLOv8-L @ 640', notes: { 'yolo-world': 'YOLOv8-L a la misma resolución' } },
    yolov8Params: { label: 'Parámetros de YOLOv8-L', kind: 'count', note: '' },
    macsVsYolov8: { label: 'MACs / YOLOv8-L', kind: 'ratio', note: 'cada uno en su config (Grounding DINO-T @ 896×1344, YOLOv8-L @ 640: resoluciones distintas)',
      notes: { 'yolo-world': 'a la misma resolución: lo que cuesta el texto (T-CSPLayers, IPA y cabeza de texto)' } },
    paramsVsYolov8: { label: 'Parámetros / YOLOv8-L', kind: 'ratio', note: 'no depende de la resolución' },
    detrMacs: { label: 'MACs de DETR-R50', kind: 'ops', note: 'DETR-R50 @ 800×1216', notes: { 'yolo-world': 'DETR-R50 @ 640', yolov8: 'DETR-R50 @ 640' } },
    detrParams: { label: 'Parámetros de DETR-R50', kind: 'count', note: '' },
    macsVsDetr: { label: 'MACs / DETR-R50', kind: 'ratio', note: 'cada uno en su config (896×1344 vs 800×1216)' },
    paramsVsDetr: { label: 'Parámetros / DETR-R50', kind: 'ratio', note: 'no depende de la resolución' },
    yoloWorldMacs: { label: 'MACs de YOLO-World-L', kind: 'ops', note: 'YOLO-World-L @ 640, V = 80', notes: { yolov8: 'YOLO-World-L a la misma resolución, V = 80' } },
    yoloWorldParams: { label: 'Parámetros de YOLO-World-L', kind: 'count', note: 'sin CLIP (offline)' },
    macsVsYoloWorld: { label: 'MACs / YOLO-World-L', kind: 'ratio', note: 'cada uno en su config (esta vs 640×640): buena parte es resolución; compara con «a 672×672»' },
    paramsVsYoloWorld: { label: 'Parámetros / YOLO-World-L', kind: 'ratio', note: 'sin CLIP (offline) en YOLO-World; no depende de la resolución' },
    macsAt672: { label: 'MACs a 672×672', kind: 'ops', note: 'el mismo modelo a ≈ la resolución de YOLO-World-L @ 640' },
    macsAt448: { label: 'MACs a 448×448', kind: 'ops', note: 'el mismo modelo, imagen cuadrada de 448' },
    macsVsYoloWorldAt672: { label: 'MACs a 672×672 / YOLO-World-L @ 640', kind: 'ratio', note: 'a escala parecida: la diferencia que sí es de arquitectura' },
    macsVsYoloWorldAt448: { label: 'MACs a 448×448 / YOLO-World-L @ 640', kind: 'ratio', note: 'a 448×448 Grounding DINO-T cuesta ≈ lo mismo' },
    // ---- Fase 4: YOLOv8 / YOLO-World (backbone · neck · cabezas; texto offline; fusión en el neck)
    backboneParams: { label: 'Parámetros del backbone', kind: 'count', note: 'CSPDarknet (YOLOv8-L)' },
    neckMacs: { label: 'MACs del neck', kind: 'ops', note: 'PAN-FPN con C2f', notes: { 'yolo-world': 'RepVL-PAN: T-CSPLayers (C2f + max-sigmoid) e image-pooling attention', sam: 'conv 1×1 (D → C) + conv 3×3 (C → C), sin sesgo' } },
    neckMacsShare: { label: 'Neck', kind: 'pct', note: '% de los MACs totales' },
    neckParams: { label: 'Parámetros del neck', kind: 'count', note: '' },
    headMacsShare: { label: 'Cabezas', kind: 'pct', note: '% de los MACs totales' },
    headParams: { label: 'Parámetros de las cabezas', kind: 'count', note: 'P3–P5' },
    boxHeadMacs: { label: 'MACs de la cabeza de cajas', kind: 'ops', note: '4·reg_max canales por celda (DFL)' },
    anchors: { label: 'Celdas A (P3–P5)', kind: 'count', note: 'Σ h·w de P3–P5: un punto de anclaje por celda' },
    vocabSize: { label: 'Vocabulario V', kind: 'count', note: 'palabras o clases del prompt' },
    promptTextMacs: { label: 'MACs de CLIP por prompt', kind: 'ops', note: 'torre de texto con 77 tokens; offline' },
    vocabTextMacs: { label: 'MACs de codificar el vocabulario', kind: 'ops', note: 'V prompts por CLIP: una vez por vocabulario (offline)' },
    onlineTextMacs: { label: 'MACs del texto por imagen', kind: 'ops', note: '0: el vocabulario ya está codificado' },
    vocabTextToOnline: { label: 'Codificar el vocabulario / una imagen', kind: 'ratio', note: 'se paga una vez; después, 0 por imagen' },
    maxSigmoidMacs: { label: 'MACs de la max-sigmoid attention', kind: 'ops', note: 'los 4 T-CSPLayers; ∝ celdas·V' },
    ipaMacs: { label: 'MACs de la image-pooling attention', kind: 'ops', note: '27 tokens de imagen (3×3 de 3 niveles) actualizan el texto' },
    tcspMacs: { label: 'MACs de los T-CSPLayers', kind: 'ops', note: 'convs C2f + max-sigmoid' },
    tcspMacsShare: { label: 'T-CSPLayers', kind: 'pct', note: '% de los MACs totales' },
    logitsP3Elements: { label: 'Logits en P3', kind: 'count', note: '(H/8)·(W/8) celdas × V' },
    logitsP4Elements: { label: 'Logits en P4', kind: 'count', note: '(H/16)·(W/16) celdas × V' },
    logitsP5Elements: { label: 'Logits en P5', kind: 'count', note: '(H/32)·(W/32) celdas × V' },
    regionTextMacs: { label: 'MACs de la similitud región-texto', kind: 'ops', note: 'A×E · E×V: la cabeza contrastiva' },
    deltaParamsVsYolov8: { label: 'Parámetros extra sobre YOLOv8-L', kind: 'count', note: 'max-sigmoid + IPA + rama de texto de la cabeza' },
    deltaMacsVsYolov8: { label: 'MACs extra sobre YOLOv8-L', kind: 'ops', note: 'a la misma resolución' },
    gdinoMacs: { label: 'MACs de Grounding DINO-T', kind: 'ops', note: 'Grounding DINO-T @ 896×1344, T = 16' },
    gdinoParams: { label: 'Parámetros de Grounding DINO-T', kind: 'count', note: 'con BERT' },
    gdinoTextMacs: { label: 'MACs del texto de Grounding DINO-T', kind: 'ops', note: 'BERT + proyección, en cada imagen' },
    gdinoToYoloWorldMacs: { label: 'Grounding DINO-T / YOLO-World-L (MACs)', kind: 'ratio', note: 'Grounding DINO-T @ 896×1344 vs esta config: resoluciones distintas' },
    gdino672Macs: { label: 'MACs de Grounding DINO-T @ 672×672', kind: 'ops', note: '≈ la resolución de YOLO-World-L @ 640' },
    gdino448Macs: { label: 'MACs de Grounding DINO-T @ 448×448', kind: 'ops', note: '' },
    gdino672ToYoloWorldMacs: { label: 'Grounding DINO-T @ 672×672 / YOLO-World-L (MACs)', kind: 'ratio', note: 'a escala parecida: la diferencia que sí es de arquitectura' },
    gdino448ToYoloWorldMacs: { label: 'Grounding DINO-T @ 448×448 / YOLO-World-L (MACs)', kind: 'ratio', note: '≈ los mismos MACs' },
    detrToYoloWorldMacs: { label: 'DETR-R50 / YOLO-World-L (MACs)', kind: 'ratio', note: 'DETR-R50 @ 640' },
    yoloWorldToYolov8Macs: { label: 'YOLO-World-L / YOLOv8-L (MACs)', kind: 'ratio', note: 'a la misma resolución' },
    detrToYolov8Macs: { label: 'DETR-R50 / YOLOv8-L (MACs)', kind: 'ratio', note: 'DETR-R50 @ 640' },
    costEntries: { label: 'Celdas de la matriz de costos', kind: 'count', note: 'Q×G, solo entrenamiento' },
    // Deformable DETR: muestreo disperso (convención del calculador: 4 MACs por lectura bilineal + 1 de la suma ponderada).
    samplesPerQuery: { label: 'Muestras por query', kind: 'count', note: 'h·L·K (cabezas × niveles × puntos)' },
    keysPerQueryDense: { label: 'Keys por query si fuera densa', kind: 'count', note: '= N' },
    encSamplingMacs: { label: 'Encoder: MACs del muestreo deformable', kind: 'ops', note: '5·N·hLK·d_h por capa (4 por lectura bilineal + 1 de la suma)' },
    encSamplingMacsLayer: { label: 'Encoder: MACs del muestreo deformable (una capa)', kind: 'ops', note: '5·N·hLK·d_h; lineal en N' },
    decCrossSamplingMacs: { label: 'Cross-attention: MACs del muestreo deformable', kind: 'ops', note: '5·Q·hLK·d_h por capa' },
    decCrossSamplingMacsLayer: { label: 'Cross-attention: MACs del muestreo deformable (una capa)', kind: 'ops', note: '5·Q·hLK·d_h' },
    samplingMacs: { label: 'MACs del muestreo deformable', kind: 'ops', note: 'encoder + cross-attention del decoder; convención del calculador',
      labels: { 'stable-diffusion': 'MACs por imagen', dit: 'MACs por imagen' },
      notes: { 'stable-diffusion': 'pasos × (2 con CFG) × MACs por NFE + (2 con CFG) × texto + decoder del VAE', dit: 'pasos × (2 con CFG) × MACs por NFE + decoder del VAE' } },
    latentTokens: { label: 'Tokens del latente', kind: 'count', note: '(H/8/P)·(W/8/P): parches del latente',
      notes: { 'stable-diffusion': '(H/8)·(W/8): posiciones del latente (nivel 1 de la U-Net)', dit: '(H/8/P)·(W/8/P): parches del latente' } },
    ditMacs: { label: 'MACs por evaluación (NFE)', kind: 'ops', note: 'una pasada del DiT' },
    unetMacs: { label: 'MACs por evaluación (NFE)', kind: 'ops', note: 'una pasada de la U-Net' },
    scoreShareDit: { label: 'Parte de QKᵀ y A·V', kind: 'pct', note: '% de los MACs por NFE; crece ∝ tokens²' },
    selfScoreShareUnet: { label: 'Self-attention de la U-Net: QKᵀ y A·V', kind: 'pct', note: '% de los MACs por NFE; crece ∝ tokens² del nivel 64×64' },
    vaeDecoderShare: { label: 'Decoder del VAE', kind: 'pct', note: '% de los MACs por imagen' },
    selfAttnScoreBytes: { label: 'Scores de la self-attention (nivel más fino)', kind: 'bytes', note: 'h×N×N en fp16, una capa, B = 1' },
    selfAttnTokens: { label: 'Tokens de la self-attention (nivel más fino)', kind: 'count', note: '(H/8)·(W/8)' },
    msPerImage: { label: 'ms por imagen (≈ cota)', kind: 'ms', note: 'roofline en H100, sin overhead' },
    unetNfeMs: { label: 'ms por NFE de la U-Net (≈ cota)', kind: 'ms', note: 'roofline en H100' },
    ditNfeMs: { label: 'ms por NFE del DiT (≈ cota)', kind: 'ms', note: 'roofline en H100' },
    samplingMs: { label: 'ms del muestreo (≈ cota)', kind: 'ms', note: 'roofline en H100' },
    vaeDecodeMs: { label: 'ms del decoder del VAE (≈ cota)', kind: 'ms', note: 'roofline en H100, una vez por imagen' },
    textEncoderMs: { label: 'ms del text encoder (≈ cota)', kind: 'ms', note: 'roofline en H100' },
    sequentialPasses: { label: 'Pasadas secuenciales de la red', kind: 'count', note: '= pasos: con CFG, las 2 evaluaciones de un paso van en un batch de 2' },
    blockMacs: { label: 'MACs de un bloque (una NFE)', kind: 'ops', note: 'un bloque DiT, una evaluación' },
    blocksSamplingMacs: { label: 'MACs de los bloques por imagen', kind: 'ops', note: 'L bloques × NFE' },
    imagesPerSecUpperBound: { label: 'Imágenes/s (≈ tope)', kind: 'count', note: 'roofline en H100' },
    unetParams: { label: 'Parámetros de la U-Net', kind: 'count', note: '' },
    ditParams: { label: 'Parámetros del DiT', kind: 'count', note: '' },
    vaeParams: { label: 'Parámetros del VAE', kind: 'count', note: 'encoder + decoder' },
    unetParamsShare: { label: 'U-Net', kind: 'pct', note: '% de los parámetros del sistema' },
    nfe: { label: 'Evaluaciones de la red (NFE)', kind: 'count', note: 'pasos × (2 con CFG)' },
    vaeDecoderMacs: { label: 'MACs del decoder del VAE', kind: 'ops', note: 'una vez por imagen' },
    vaeEncoderMacs: { label: 'MACs del encoder del VAE', kind: 'ops', note: 'solo en entrenamiento (o img2img)' },
    compressionFactor: { label: 'Compresión del VAE', kind: 'ratio', note: 'valores de la imagen / valores del latente' },
    // Fase 9 (VLA): costo por acción / por chunk y frecuencias estimadas (roofline con hardware citado).
    macsPerAction: { label: 'MACs por acción', kind: 'ops', note: 'prefill + los pasos de decode de los tokens de acción' },
    macsPerChunk: { label: 'MACs por chunk de acciones', kind: 'ops', note: 'prefijo una vez + pasos × paso de flow' },
    prefillShare: { label: 'MACs del paso en el prefill (%)', kind: 'pct', note: '% de los MACs por acción que hace el prefill (visión + proyector + LLM sobre N + T)' },
    actionMsRtx4090: { label: 'ms por acción en RTX 4090 (≈)', kind: 'ms', note: 'roofline, sin overhead' },
    hzRtx4090: { label: 'Acciones/s en RTX 4090 (≈ tope)', kind: 'hz', note: 'roofline, sin overhead' },
    hz: { label: 'Acciones/s (≈ tope)', kind: 'hz', note: 'roofline con el hardware elegido' },
    prefixTokens: { label: 'Tokens del prefijo', kind: 'count', note: 'imágenes + lenguaje (se calculan una vez por chunk)' },
    suffixTokens: { label: 'Tokens del sufijo', kind: 'count', note: 'estado + H_a acciones (1 + H_a)' },
    prefixMacs: { label: 'MACs del prefijo', kind: 'ops', note: 'SigLIP + Gemma sobre imágenes y lenguaje, una vez por chunk' },
    flowStepMacs: { label: 'MACs por paso de flow', kind: 'ops', note: 'action expert sobre el sufijo, leyendo la KV del prefijo' },
    actionTokensPerStep: { label: 'Tokens de acción por paso', kind: 'count', note: '7 dimensiones × 1 token' },
    // Fase 10 (fine-tuning y alineación): memoria de entrenamiento y cómputo por paso.
    trainableParams: { label: 'Parámetros entrenables', kind: 'count', note: 'Σ r·(d_in + d_out) por matriz adaptada (LoRA); todos (full FT)' },
    trainableShare: { label: 'Entrenables / totales', kind: 'pct', note: '' },
    adapterParamsPerLayer: { label: 'Parámetros del adapter por capa', kind: 'count', note: '' },
    mergedParams: { label: 'Parámetros tras el merge', kind: 'count', note: 'W₀ + (α/r)·BA: igual que la base' },
    baseParams: { label: 'Parámetros de la base', kind: 'count', note: 'congelados' },
    adapterBytes: { label: 'Bytes del adapter', kind: 'bytes', note: 'lo que guardas y distribuyes' },
    baseWeightBytes: { label: 'Pesos de la base', kind: 'bytes', note: 'a los bits elegidos (NF4 con sus constantes)' },
    gradBytes: { label: 'Gradientes', kind: 'bytes', note: 'solo de lo entrenable' },
    masterBytes: { label: 'Copia maestra fp32', kind: 'bytes', note: 'full FT en precisión mixta' },
    optimizerStateBytes: { label: 'Estados del optimizador', kind: 'bytes', note: 'm y v de AdamW, etc.' },
    optimizerBytes: { label: 'Optimizador (estados + maestra)', kind: 'bytes', note: '' },
    activationBytes: { label: 'Activaciones (≈)', kind: 'bytes', note: 'estimado por token y capa; depende de gradient checkpointing' },
    activationBytesNoCkpt: { label: 'Activaciones sin checkpointing (≈)', kind: 'bytes', note: '' },
    activationBytesCkpt: { label: 'Activaciones con checkpointing (≈)', kind: 'bytes', note: '' },
    logitsBytes: { label: 'Logits', kind: 'bytes', note: 'T × V en fp32' },
    totalTrainMemory: { label: 'Memoria total de entrenamiento (≈)', kind: 'bytes', note: 'pesos + gradientes + optimizador + activaciones' },
    quantConstBytes: { label: 'Constantes de cuantización', kind: 'bytes', note: 'absmax por bloque (con doble cuantización)' },
    bytesPerTrainableParam: { label: 'Bytes por parámetro entrenable', kind: 'ratio', note: 'peso + gradiente + optimizador' },
    quantBitsPerParam: { label: 'Bits por parámetro de la base', kind: 'ratio', note: 'NF4: 4 + constantes' },
    memoryVsFullFt: { label: 'Memoria / la de full FT', kind: 'ratio', note: '' },
    backwardToForward: { label: 'Backward / forward (MACs)', kind: 'ratio', note: 'full FT ≈ 2; LoRA ≈ 1 (solo gradientes de entrada en W₀)' },
    forwardMacs: { label: 'MACs del forward', kind: 'ops', note: '' },
    backwardMacs: { label: 'MACs del backward', kind: 'ops', note: '' },
    recomputeMacs: { label: 'MACs recomputados (checkpointing)', kind: 'ops', note: '' },
    trainStepMacs: { label: 'MACs por paso de entrenamiento', kind: 'ops', note: 'forward + backward (+ recómputo)' },
    modelsInMemory: { label: 'Modelos en memoria', kind: 'count', note: 'política, referencia, reward, crítico' },
    policyParams: { label: 'Parámetros de la política', kind: 'count', note: '' },
    referenceParams: { label: 'Parámetros de la referencia', kind: 'count', note: '' },
    rewardParams: { label: 'Parámetros del reward model', kind: 'count', note: '' },
    criticParams: { label: 'Parámetros del crítico', kind: 'count', note: '' },
    generationTokensPerStep: { label: 'Tokens generados por paso', kind: 'count', note: 'rollouts (0 en DPO)' },
    rolloutShare: { label: 'Rollouts (generación)', kind: 'pct', note: '% de los MACs del paso (en tiempo pesa mucho más: decode)' },
    scoringShare: { label: 'Puntuar (referencia + reward)', kind: 'pct', note: '% de los MACs del paso' },
    updateShare: { label: 'Actualización (forward + backward)', kind: 'pct', note: '% de los MACs del paso' },
    gpus80Needed: { label: 'GPUs de 80 GB necesarias (≈)', kind: 'count', note: 'memoria total / 80 GB, sin paralelismo fino' },
    // Revisión de la fase 10: el resto de claves de metrics() de `lora` y `rlhf-dpo` con etiqueta (nada crudo en explorers ni what-ifs).
    r: { label: 'Rango r', kind: 'count', note: 'del adapter (0 en full FT)' },
    alpha: { label: 'Escala α', kind: 'count', note: 'el adapter suma (α/r)·BA' },
    targetsCount: { label: 'Matrices adaptadas por bloque', kind: 'count', note: '2 = W_Q, W_V · 4 = atención · 7 = todas las lineales' },
    allParams: { label: 'Parámetros totales (base + adapter)', kind: 'count', note: 'el «all params» de peft' },
    trainableSharePct: { label: 'Entrenables / totales (en %)', kind: 'ratio', note: '3 cifras: 0.520, 0.0848' },
    trainableWeightBytes: { label: 'Pesos entrenables', kind: 'bytes', note: 'adapter (fp32 en peft, bf16 en QLoRA) o todo el modelo' },
    activationBytesPerTokenLayer: { label: 'Activaciones por token y capa (≈)', kind: 'bytes', note: 'lo que guarda el backward' },
    loraDropoutBytesPerTokenLayer: { label: 'Copias del lora_dropout por token y capa', kind: 'bytes', note: 'una por adapter con p > 0' },
    attnScoresBytesEager: { label: 'Scores T×T si la atención fuera eager', kind: 'bytes', note: 'sin SDPA / FlashAttention: L·h·T²·2 bytes' },
    baseWeightBytes16: { label: 'Base a 16 bits', kind: 'bytes', note: 'bf16' },
    baseWeightBytes8: { label: 'Base a 8 bits', kind: 'bytes', note: 'LLM.int8 en las lineales' },
    baseWeightBytes4: { label: 'Base en NF4 (con doble cuantización)', kind: 'bytes', note: 'las lineales; embedding y LM head en bf16' },
    baseWeightBytes4NoDQ: { label: 'Base en NF4 sin doble cuantización', kind: 'bytes', note: 'absmax fp32 por bloque de 64' },
    quantConstBitsPerParam: { label: 'Bits de constantes por parámetro', kind: 'ratio', note: '0.5 sin DQ → 0.127 con DQ' },
    forwardMacsPerSeq: { label: 'MACs del forward (una secuencia)', kind: 'ops', note: '' },
    backwardMacsPerSeq: { label: 'MACs del backward (una secuencia)', kind: 'ops', note: '' },
    recomputeMacsPerSeq: { label: 'MACs recomputados (una secuencia)', kind: 'ops', note: 'gradient checkpointing' },
    trainStepMacsPerSeq: { label: 'MACs del paso (una secuencia)', kind: 'ops', note: 'forward + backward (+ recómputo)' },
    backwardInputGradMacs: { label: 'MACs de los gradientes de entrada (dX)', kind: 'ops', note: 'en LoRA, también en las W₀ congeladas' },
    backwardWeightGradMacs: { label: 'MACs de los gradientes de pesos (dW)', kind: 'ops', note: 'en LoRA, solo A y B' },
    backwardInputGradMacsPerSeq: { label: 'MACs de dX (una secuencia)', kind: 'ops', note: '' },
    backwardWeightGradMacsPerSeq: { label: 'MACs de dW (una secuencia)', kind: 'ops', note: '' },
    trainStepMacsRule: { label: 'MACs por paso (regla de bolsillo)', kind: 'ops', note: '3N (full) o 2N_base + 3N_adapter por token' },
    macsPerToken: { label: 'MACs por token (forward)', kind: 'ops', note: '' },
    adapterMacsPerToken: { label: 'MACs del adapter por token', kind: 'ops', note: 'lo que cuesta no fusionarlo en inferencia' },
    trainStepMacsVsFullFt: { label: 'MACs del paso / los del full FT', kind: 'ratio', note: 'mismos B, T y checkpointing' },
    tokensPerStep: { label: 'Tokens por paso', kind: 'count', note: 'B × T' },
    sequencesPerStep: { label: 'Secuencias por paso', kind: 'count', note: 'B (PPO) · 2B (DPO: elegida y rechazada) · B·G (GRPO)' },
    Tp: { label: 'Tokens del prompt T_p', kind: 'count', note: 'T/2' },
    Tr: { label: 'Tokens de la respuesta T_r', kind: 'count', note: 'T/2' },
    groupSize: { label: 'Respuestas por prompt G (GRPO)', kind: 'count', note: 'n_G en las formas; G del decoder = cabezas KV' },
    ppoEpochs: { label: 'Épocas de PPO por batch', kind: 'count', note: 'num_ppo_epochs de TRL (0 si no es PPO)' },
    rolloutMacs: { label: 'MACs de la generación', kind: 'ops', note: 'prefill del prompt + decode de la respuesta, por paso' },
    rolloutMacsPerSeq: { label: 'MACs de generar una respuesta', kind: 'ops', note: 'prefill + T_r − 1 decodes' },
    rolloutPrefillMacsPerSeq: { label: 'MACs del prefill del prompt (una respuesta)', kind: 'ops', note: 'lo que el prefix caching comparte' },
    rolloutMacsSharedPrefix: { label: 'MACs de la generación con prefijo compartido', kind: 'ops', note: 'GRPO: un prefill por prompt para las G respuestas' },
    rolloutShareSharedPrefix: { label: 'Rollouts con prefijo compartido', kind: 'pct', note: '% de los MACs del paso si las G respuestas comparten el prefill (prefix caching)' },
    referenceMacs: { label: 'MACs de la referencia', kind: 'ops', note: 'forward por paso' },
    rewardMacs: { label: 'MACs del reward model', kind: 'ops', note: 'forward por paso' },
    criticForwardMacs: { label: 'MACs del forward del crítico', kind: 'ops', note: 'valores «old»' },
    policyForwardMacs: { label: 'MACs del forward de la política (old)', kind: 'ops', note: 'log-probs «old» de PPO' },
    scoringMacs: { label: 'MACs de puntuar', kind: 'ops', note: 'referencia + reward + forwards «old»' },
    policyUpdateMacs: { label: 'MACs del update de la política', kind: 'ops', note: 'forward + backward (× épocas)' },
    criticUpdateMacs: { label: 'MACs del update del crítico', kind: 'ops', note: '' },
    updateMacs: { label: 'MACs de los updates', kind: 'ops', note: 'política + crítico' },
    referencePrecomputeMacs: { label: 'MACs de precalcular la referencia', kind: 'ops', note: 'DPO con log-probs precalculados: fuera del paso' },
    policyTrainStepMacsPerSeq: { label: 'MACs del paso de la política (una secuencia)', kind: 'ops', note: '' },
    policyForwardMacsPerSeq: { label: 'MACs del forward de la política (una secuencia)', kind: 'ops', note: '' },
    criticTrainStepMacsPerSeq: { label: 'MACs del paso del crítico (una secuencia)', kind: 'ops', note: '' },
    policyWeightBytes: { label: 'Pesos de la política', kind: 'bytes', note: '' },
    referenceWeightBytes: { label: 'Pesos de la referencia', kind: 'bytes', note: '0 con LoRA (es la base) o precalculada' },
    rewardWeightBytes: { label: 'Pesos del reward model', kind: 'bytes', note: '' },
    criticWeightBytes: { label: 'Pesos del crítico', kind: 'bytes', note: '' },
    policyOptimizerBytes: { label: 'Optimizador de la política', kind: 'bytes', note: '' },
    criticOptimizerBytes: { label: 'Optimizador del crítico', kind: 'bytes', note: '' },
    policyGradBytes: { label: 'Gradientes de la política', kind: 'bytes', note: '' },
    criticGradBytes: { label: 'Gradientes del crítico', kind: 'bytes', note: '' },
    // kind 'bool': metrics() devuelve true / false; metricValue lo lee como 1 / 0 y fMetric lo escribe «sí» / «no».
    fitsOn24: { label: 'Cabe en 24 GB', kind: 'bool', note: 'memoria total ≤ 24 GB (RTX 4090, A10)' },
    fitsOn48: { label: 'Cabe en 48 GB', kind: 'bool', note: 'memoria total ≤ 48 GB (L40S, A6000)' },
    fitsOn80: { label: 'Cabe en 80 GB', kind: 'bool', note: 'memoria total ≤ 80 GB (A100 / H100)' },
    // Fase 11 (BERT, retrieval, ANN).
    attnScoreShareEncoder: { label: 'QKᵀ y A·V', kind: 'pct', note: '% de los MACs del encoder; crece ∝ T²' },
    embeddingIndexBytes: { label: 'Memoria del índice', kind: 'bytes', note: 'N × dim × bits / 8' },
    macsPerSequence: { label: 'MACs por secuencia', kind: 'ops', note: '' },
    mlmHeadMacs: { label: 'MACs de la cabeza MLM', kind: 'ops', note: 'sobre todas las posiciones (como HF BertForPreTraining)' },
    mlmPredictions: { label: 'Posiciones que predice el MLM', kind: 'count', note: '15 % de los tokens' },
    bruteForceMacs: { label: 'MACs de la búsqueda exacta', kind: 'ops', note: 'N × dim por consulta' },
    bruteForceMsH100: { label: 'ms de la búsqueda exacta en H100 (≈ cota)', kind: 'ms', note: 'roofline: leer el índice domina' },
    corpusEncodeMacs: { label: 'MACs para codificar el corpus', kind: 'ops', note: 'offline, × N documentos' },
    queryEncodeMacs: { label: 'MACs por consulta (encoder)', kind: 'ops', note: '' },
    docEncodeMacs: { label: 'MACs por documento', kind: 'ops', note: 'offline' },
    crossEncoderMacsPerPair: { label: 'MACs por par (cross-encoder)', kind: 'ops', note: '' },
    rerankMacs: { label: 'MACs del rerank', kind: 'ops', note: 'k pares por consulta' },
    rerankShareOnline: { label: 'Rerank', kind: 'pct', note: '% de los MACs en línea por consulta' },
    indexBytes: { label: 'Memoria del índice', kind: 'bytes', note: '' },
    bytesPerVector: { label: 'Bytes por vector', kind: 'count', note: 'incluye enlaces del grafo o códigos PQ' },
    memoryVsFlat: { label: 'Memoria / la del índice exacto', kind: 'pct', note: '' },
    distanceComputations: { label: 'Distancias por consulta (≈)', kind: 'count', note: '' },
    bytesTouchedPerQuery: { label: 'Bytes leídos por consulta (≈)', kind: 'bytes', note: '' },
    linkBytes: { label: 'Bytes de enlaces del grafo', kind: 'bytes', note: 'HNSW: ≈ N·M·2·4 B en la capa 0 + capas altas' },
    codeBytes: { label: 'Bytes de los códigos PQ', kind: 'bytes', note: 'N·m·nbits/8' },
    latencyMs: { label: 'ms por consulta en CPU (≈ cota)', kind: 'ms', note: 'roofline de ancho de banda; no cuenta el costo de los saltos aleatorios' },
    searchMacs: { label: 'MACs de la búsqueda', kind: 'ops', note: 'distancias × d' },
    scannedVectors: { label: 'Vectores revisados por consulta', kind: 'count', note: '' },
    // Revisión de la fase 11: el resto de claves numéricas de metrics() de `bert`, `retrieval` y `ann` con etiqueta.
    poolerParams: { label: 'Parámetros del pooler', kind: 'count', note: 'Linear D → D + tanh sobre [CLS]' },
    mlmHeadParams: { label: 'Parámetros de la cabeza MLM', kind: 'count', note: 'dense + LayerNorm + sesgo del decoder (D² + 3D + V; el decoder está atado)' },
    nspParams: { label: 'Parámetros de la cabeza NSP', kind: 'count', note: 'Linear D → 2' },
    mlmTiedParams: { label: 'Decoder del MLM atado (no se cuenta)', kind: 'count', note: 'V × D: la tabla de word embeddings, ya contada' },
    bodyParams: { label: 'Parámetros del cuerpo', kind: 'count', note: 'embeddings + encoder' },
    headsParams: { label: 'Parámetros de las cabezas', kind: 'count', note: 'pooler + MLM + NSP' },
    headsParamsShare: { label: 'Cabezas (parámetros)', kind: 'pct', note: '% de los parámetros' },
    layerMacs: { label: 'MACs por capa del encoder', kind: 'ops', note: '' },
    mlmDecoderMacs: { label: 'MACs del decoder del MLM', kind: 'ops', note: 'T × D × V (todas las posiciones)' },
    mlmHeadMacsGathered: { label: 'MACs de la cabeza MLM solo en las posiciones elegidas', kind: 'ops', note: 'como el código original (gather_indexes)' },
    poolerMacs: { label: 'MACs del pooler', kind: 'ops', note: 'D² sobre [CLS]' },
    nspMacs: { label: 'MACs de la cabeza NSP', kind: 'ops', note: '' },
    mlmHeadMacsShare: { label: 'Cabeza MLM', kind: 'pct', note: '% de los MACs por secuencia' },
    attnScoreShare: { label: 'QKᵀ y A·V', kind: 'pct', note: '% de los MACs por secuencia (con la cabeza MLM)' },
    maskRate: { label: 'Tokens elegidos por el MLM', kind: 'pct', note: '' },
    mlmMaskTokens: { label: 'Elegidos que pasan a [MASK]', kind: 'count', note: '80 % de los elegidos (en esperanza)' },
    mlmRandomTokens: { label: 'Elegidos que pasan a un token al azar', kind: 'count', note: '10 % de los elegidos' },
    mlmKeptTokens: { label: 'Elegidos que quedan iguales', kind: 'count', note: '10 % de los elegidos' },
    maskShare: { label: '[MASK]', kind: 'pct', note: '% de los elegidos' },
    randomShare: { label: 'Token al azar', kind: 'pct', note: '% de los elegidos' },
    keepShare: { label: 'Sin cambio', kind: 'pct', note: '% de los elegidos' },
    nspPositiveShare: { label: 'Pares IsNext', kind: 'pct', note: '% de los pares de NSP' },
    tokensPerBatch: { label: 'Tokens por paso', kind: 'count', note: 'B × T' },
    stepMacs: { label: 'MACs por paso de entrenamiento (≈)', kind: 'ops', note: '3 × forward × B' },
    pretrainMacs: { label: 'MACs del preentrenamiento de BERT (≈)', kind: 'ops', note: '1M pasos de B = 256: 90 % a T = 128 y 10 % a 512' },
    forwardBatchMsH100: { label: 'ms del forward del lote en H100 (≈ cota)', kind: 'ms', note: 'roofline, B secuencias' },
    crossoverT: { label: 'Largo donde QKᵀ + A·V igualan a las lineales', kind: 'count', note: 'T = 2D + D_mlp (6D en BERT)' },
    N: { label: 'Documentos del corpus N', kind: 'count', note: '', labels: { ann: 'Vectores del índice N' } },
    k: { label: 'Candidatos por consulta k', kind: 'count', note: '' },
    Tq: { label: 'Tokens de la consulta T_q', kind: 'count', note: '' },
    Td: { label: 'Tokens del documento T_d', kind: 'count', note: '' },
    dim: { label: 'Dimensión guardada dim', kind: 'count', note: '' },
    bits: { label: 'Bits por número', kind: 'count', note: 'precisión guardada del índice' },
    pairTokens: { label: 'Tokens del par (cross-encoder)', kind: 'count', note: 'T_q + T_d − 1, truncado a 512 (se recorta el documento)' },
    cpuBandwidth: { label: 'Ancho de banda de la CPU', kind: 'bw', note: 'AMD EPYC 9654, 1 socket' },
    cpuPeakFlops: { label: 'Pico de cómputo de la CPU', kind: 'flops', note: 'fp32, derivado (≈)' },
    crossEncoderFullScanMacs: { label: 'MACs del cross-encoder sobre todo el corpus', kind: 'ops', note: 'N pares por consulta: lo que NO se hace' },
    crossEncoderFullScanMs: { label: 'ms del cross-encoder sobre todo el corpus (≈ cota)', kind: 'ms', note: 'H100 a pico, por consulta' },
    crossEncoderParams: { label: 'Parámetros del cross-encoder', kind: 'count', note: '' },
    rerankMs: { label: 'ms del rerank en H100 (≈ cota)', kind: 'ms', note: 'k pares, roofline' },
    pairsPerSecH100: { label: 'Pares por segundo en H100 (≈ tope)', kind: 'count', note: 'roofline, a pico' },
    towerParams: { label: 'Parámetros de una torre', kind: 'count', note: '' },
    docTowerParams: { label: 'Parámetros de la torre de documentos', kind: 'count', note: '0 si comparte los pesos (siamés)' },
    biEncoderParams: { label: 'Parámetros del bi-encoder', kind: 'count', note: 'las dos torres, sin el reranker' },
    rerankerParams: { label: 'Parámetros del reranker', kind: 'count', note: '0 si no hay rerank' },
    queryEncodeMs: { label: 'ms para codificar la consulta en H100 (≈ cota)', kind: 'ms', note: 'roofline' },
    corpusEncodeMs: { label: 'ms para codificar el corpus en H100 (≈ cota)', kind: 'ms', note: 'offline, a pico' },
    corpusEncodeTime: { label: 'Tiempo para codificar el corpus en H100 (≈ cota)', kind: 'duration', note: 'offline, a pico' },
    bruteForceBytes: { label: 'Bytes que lee la búsqueda exacta', kind: 'bytes', note: 'el índice entero, por consulta' },
    embeddingIndexBytes32: { label: 'Memoria del índice en fp32', kind: 'bytes', note: 'N × dim × 4' },
    colbertIndexBytes: { label: 'Índice por token (ColBERT)', kind: 'bytes', note: 'N × T_d × dim × bits / 8' },
    colbertV1IndexBytes: { label: 'Índice de ColBERT v1 (fp16)', kind: 'bytes', note: 'N × T_d × dim × 2' },
    colbertV2IndexBytes: { label: 'Índice de ColBERTv2 (residuo de 2 bits)', kind: 'bytes', note: '36 B por vector' },
    colbertV2BytesPerVector: { label: 'Bytes por vector en ColBERTv2', kind: 'bytes', note: 'centroide (4 B) + residuo' },
    tokenVectors: { label: 'Vectores de token guardados', kind: 'count', note: 'N × T_d' },
    singleVectorRatio: { label: 'Vectores por documento vs un vector', kind: 'ratio', note: '= T_d' },
    maxsimMacsPerDoc: { label: 'MACs de MaxSim por documento', kind: 'ops', note: 'T_q × T_d × dim' },
    colbertRerankMacs: { label: 'MACs de MaxSim sobre los k candidatos', kind: 'ops', note: '' },
    bruteForceMsCpu: { label: 'ms de la búsqueda exacta en CPU (≈ cota)', kind: 'ms', note: 'roofline: leer el índice domina' },
    onlineMacsPerQuery: { label: 'MACs en línea por consulta', kind: 'ops', note: 'encoder + búsqueda exacta + rerank' },
    onlineMsH100: { label: 'ms en línea por consulta en H100 (≈ cota)', kind: 'ms', note: '' },
    bruteForceShareOnline: { label: 'Búsqueda exacta', kind: 'pct', note: '% de los MACs en línea por consulta' },
    queryVsDocEncode: { label: 'Documento / consulta (MACs del encoder)', kind: 'ratio', note: '' },
    crossVsBiPerQuery: { label: 'Cross-encoder sobre todo el corpus / bi-encoder', kind: 'ratio', note: 'MACs por consulta' },
    encodeMacs: { label: 'MACs para codificar la query', kind: 'ops', note: 'encoder de queries de DPR' },
    encodeParams: { label: 'Parámetros del encoder de la query', kind: 'count', note: '' },
    flatBytes: { label: 'Memoria del índice exacto (fp32)', kind: 'bytes', note: 'N × d × 4' },
    flatMacs: { label: 'MACs de la búsqueda exacta', kind: 'ops', note: 'N × d' },
    vectorBytes: { label: 'Bytes de los vectores', kind: 'bytes', note: 'N × d × bits / 8' },
    layer0LinkBytes: { label: 'Enlaces del nivel 0', kind: 'bytes', note: '4 · N · 2M' },
    upperLinkBytes: { label: 'Enlaces de los niveles de arriba', kind: 'bytes', note: '≈ 4 · N · M/(M − 1): ≈ 1/(2(M − 1)) del nivel 0' },
    levelBytes: { label: 'Niveles y offsets de HNSW', kind: 'bytes', note: '4N + 8(N + 1)' },
    wikiRuleBytes: { label: 'Regla del wiki de FAISS', kind: 'bytes', note: '(d·4 + 2M·4) por vector' },
    linksPerVector: { label: 'Enlaces por vector (esperanza)', kind: 'ratio', note: '2M + M/(M − 1)' },
    levels: { label: 'Niveles sobre el 0 (≈)', kind: 'count', note: '⌊log_M N⌋' },
    upperDistances: { label: 'Distancias del descenso (≈)', kind: 'count', note: '⌊log_M N⌋ · M' },
    layer0Distances: { label: 'Distancias en el nivel 0 (≈)', kind: 'count', note: 'efSearch · 2M (estimación: medido 0.44–1.02×)' },
    buildMacs: { label: 'MACs de construir el índice (≈)', kind: 'ops', note: '' },
    searchParams: { label: 'Parámetros del índice', kind: 'count', note: 'centroides y codebooks (k-means)' },
    distanceComputationsFlat: { label: 'Distancias de la búsqueda exacta', kind: 'count', note: 'N' },
    distanceRatioVsFlat: { label: 'Distancias: exacta / índice', kind: 'ratio', note: '' },
    searchMacsShare: { label: 'Búsqueda', kind: 'pct', note: '% de los MACs por consulta (con el encoder)' },
    macsVsFlat: { label: 'MACs: exacta / índice', kind: 'ratio', note: '' },
    bytesTouchedVsFlat: { label: 'Bytes leídos: exacta / índice', kind: 'ratio', note: '' },
    buildMsCpu: { label: 'ms de construir el índice en CPU (≈ cota)', kind: 'ms', note: 'a pico: el build real es mucho más lento' },
    buildTimeCpu: { label: 'Tiempo de construir el índice en CPU (≈ cota)', kind: 'duration', note: 'a pico: el build real es mucho más lento' },
    qpsUpperBound: { label: 'Consultas por segundo (≈ tope)', kind: 'count', note: '1 / latencia, un núcleo de memoria' },
    encodeMsH100: { label: 'ms para codificar la query en H100 (≈ cota)', kind: 'ms', note: '' },
    h100Bandwidth: { label: 'Ancho de banda de la H100', kind: 'bw', note: 'para el encoder' },
    idBytes: { label: 'Bytes de los ids', kind: 'bytes', note: 'int64 por vector en las listas' },
    centroidBytes: { label: 'Bytes de los centroides', kind: 'bytes', note: 'n_list × d × 4' },
    codebookBytes: { label: 'Bytes de los codebooks de PQ', kind: 'bytes', note: 'k_s × d × 4' },
    listSizeBytes: { label: 'Tamaños de las listas', kind: 'bytes', note: '8 · n_list' },
    coarseLinkBytes: { label: 'Enlaces del HNSW sobre los centroides', kind: 'bytes', note: '0 con cuantizador plano' },
    precomputedTableBytes: { label: 'Tabla precalculada (RAM)', kind: 'bytes', note: 'n_list × m × k_s × 4, si cabe en 2 GiB' },
    compression: { label: 'Compresión de PQ', kind: 'ratio', note: 'd × 4 / (m × nbits / 8)' },
    coarseDistances: { label: 'Distancias a centroides por consulta', kind: 'count', note: 'n_list, o ≈ las del HNSW grueso' },
    listSize: { label: 'Vectores por lista', kind: 'ratio', note: 'N / n_list' },
    centroidBytesTouched: { label: 'Bytes de centroides leídos por consulta', kind: 'bytes', note: 'coarse · d · 4' },
    centroidBytesShare: { label: 'Centroides', kind: 'pct', note: '% de los bytes leídos por consulta' },
    latencyMsCachedCentroids: { label: 'ms por consulta con los centroides en caché (≈ cota)', kind: 'ms', note: 'misma cota sin leer los centroides de DRAM' },
    actionBins: { label: 'Bins por dimensión', kind: 'count', note: 'discretización uniforme entre q01 y q99' },
    decodeSteps: { label: 'Pasos de decode por acción', kind: 'count', note: 'el primer token sale del prefill' },
    actionTokenFirst: { label: 'Primer id de token de acción', kind: 'count', note: 'los 256 ids menos usados de Llama' },
    actionTokenLast: { label: 'Último id de token de acción', kind: 'count', note: '' },
    paperHz: { label: 'Hz reportados en el paper', kind: 'hz', note: 'medidos en el hardware del paper' },
    dinoParams: { label: 'Parámetros de DINOv2', kind: 'count', note: '' },
    siglipParams: { label: 'Parámetros de SigLIP', kind: 'count', note: '' },
    visionParamsUsed: { label: 'Parámetros de visión que se usan', kind: 'count', note: 'sin la última capa ni las cabezas que se descartan' },
    idleParams: { label: 'Parámetros que no se usan', kind: 'count', note: 'están en el checkpoint pero no en el forward' },
    dinoMacs: { label: 'MACs de DINOv2', kind: 'ops', note: '' },
    siglipMacs: { label: 'MACs de SigLIP', kind: 'ops', note: '' },
    decodeMacsTotal: { label: 'MACs del decode de una acción', kind: 'ops', note: 'los pasos de decode de los tokens de acción' },
    hzH100: { label: 'Acciones/s en H100 (≈ tope)', kind: 'hz', note: 'roofline' },
    hzOrin: { label: 'Acciones/s en Jetson AGX Orin (≈ tope)', kind: 'hz', note: 'roofline; FP16 denso derivado (≈)' },
    cams: { label: 'Cámaras', kind: 'count', note: '' },
    kvRows: { label: 'Keys que mira cada query en un paso de flow', kind: 'count', note: 'N + T del prefijo (KV cache) + 1 + H_a del sufijo' },
    chunk: { label: 'Acciones por chunk H_a', kind: 'count', note: 'knob H' },
    steps: { label: 'Pasos de flow (integración)', kind: 'count', note: '' },
    actionDim: { label: 'Dimensión de acción (con padding)', kind: 'count', note: '' },
    imgProjParams: { label: 'Proyección imagen → Gemma', kind: 'count', note: '' },
    gemmaParams: { label: 'Parámetros de Gemma 2B', kind: 'count', note: '' },
    paligemmaParams: { label: 'Parámetros de PaliGemma', kind: 'count', note: 'SigLIP + proyección + Gemma' },
    actionProjParams: { label: 'Proyecciones de acción, estado y tiempo', kind: 'count', note: '' },
    gemmaPrefixMacs: { label: 'MACs de Gemma sobre el prefijo', kind: 'ops', note: 'una vez por chunk' },
    expertStepMacs: { label: 'MACs del action expert por paso', kind: 'ops', note: '' },
    flowMacs: { label: 'MACs de todos los pasos de flow', kind: 'ops', note: 'pasos × paso de flow' },
    prefixShare: { label: 'Prefijo', kind: 'pct', note: '% de los MACs por chunk' },
    flowShare: { label: 'Pasos de flow', kind: 'pct', note: '% de los MACs por chunk' },
    prefixKvBytes: { label: 'KV cache del prefijo', kind: 'bytes', note: 'bf16; se reutiliza en los pasos de flow' },
    paperOnboardMs: { label: 'ms reportados (a bordo)', kind: 'ms', note: 'medidos en el paper' },
    chunkHz: { label: 'Chunks/s (≈ tope)', kind: 'hz', note: 'roofline' },
    actionsPerSecond: { label: 'Acciones/s predichas (≈ tope)', kind: 'hz', note: 'H_a × chunks/s si se encadenan chunks sin pausa; el robot ejecuta menos (25 de 50 a 50 Hz)' },
    samplingShare: { label: 'Muestreo deformable', kind: 'pct', note: '% de los MACs; convención del calculador (los profilers no cuentan grid_sample)' },
    denseEncScoreMacs: { label: 'Encoder denso: MACs de QKᵀ y A·V', kind: 'ops', note: 'si el encoder usara atención densa sobre los mismos N tokens; ∝ N²' },
    denseEncScoreMacsLayer: { label: 'Encoder denso: MACs de QKᵀ y A·V (una capa)', kind: 'ops', note: '2·N²·D' },
    denseDecCrossScoreMacsLayer: { label: 'Cross-attention densa: MACs de QKᵀ y A·V (una capa)', kind: 'ops', note: '2·Q·N·D' },
    denseToDeform: { label: 'Atención densa / muestreo deformable', kind: 'ratio', note: 'por capa del encoder: 2N²D / (5·N·hLK·d_h)' },
    denseEncAttnMem: { label: 'Scores si el encoder fuera denso', kind: 'bytes', note: 'h×N×N en fp16, una capa, B = 1' },
    denseEncAttnFp32Mem: { label: 'Scores si el encoder fuera denso (fp32)', kind: 'bytes', note: 'h×N×N en fp32, una capa, B = 1' },
    encSampledMem: { label: 'Values muestreados del encoder', kind: 'bytes', note: 'h×N×LK×d_h en fp16, una capa (la ruta PyTorch; el kernel CUDA no lo materializa)' },
    encAttnWeightsMem: { label: 'Pesos de muestreo del encoder', kind: 'bytes', note: 'N×hLK en fp16, una capa, B = 1' },
    attnMacs: { label: 'MACs del bloque de atención (con proyecciones)', kind: 'ops', note: 'QKᵀ, A·V y proyecciones Q, K, V, O' },
    attnMacsShare: { label: 'Bloque de atención (con proyecciones)', kind: 'pct', note: '% de los MACs: QKᵀ, A·V y proyecciones Q, K, V, O' },
    // CLIP: la parte conjunta (depende del batch contrastivo B, no de la arquitectura)
    negatives: { label: 'Negativos por muestra', kind: 'count', note: 'B − 1' },
    logitsMem: { label: 'Matriz de logits B×B', kind: 'bytes', note: 'B² valores, 2 bytes cada uno (bf16)',
      labels: { 'grounding-dino': 'Logits Q×T', 'yolo-world': 'Logits A×V', yolov8: 'Logits A×K' },
      notes: { 'grounding-dino': 'una puntuación por query y token de texto; fp16, B = 1', 'yolo-world': 'una puntuación por celda y palabra; fp16, B = 1', yolov8: 'una puntuación por celda y clase; fp16, B = 1' } },
    logitsMacs: { label: 'MACs de la matriz B×B', kind: 'ops', note: 'B²·E, el lote completo' },
    logitsMacsShare: { label: 'Matriz B×B en el forward del lote', kind: 'pct', note: '% de los MACs del lote (torres × B + B²·E)' },
    embBatchMem: { label: 'Embeddings del lote', kind: 'bytes', note: '2·B·E valores (imagen y texto), bf16' },
    batchMacs: { label: 'MACs del lote', kind: 'ops', note: 'forward de los B pares' },
    // ---- Fase 5: SAM (codificar una vez por imagen, decodificar por prompt; ventanas vs bloques globales)
    encoderParams: { label: 'Parámetros del encoder', kind: 'count', note: 'ViT + neck', notes: { bert: 'las L capas post-LN' } },
    encoderParamsShare: { label: 'Encoder (parámetros)', kind: 'pct', note: '% de los parámetros del modelo' },
    decoderParams: { label: 'Parámetros del prompt encoder + decoder', kind: 'count', note: 'lo que corre por prompt (el mismo en H, L y B)' },
    decoderMacsPerPrompt: { label: 'MACs por prompt (prompt encoder + decoder)', kind: 'ops', note: 'cada clic, con el embedding de imagen ya calculado' },
    promptEncMacs: { label: 'MACs del prompt encoder', kind: 'ops', note: 'Fourier de los puntos y de la rejilla densa' },
    maskDecoderMacs: { label: 'MACs del decoder de máscaras', kind: 'ops', note: 'two-way ×2, atención final, upscaling y cabezas' },
    decoderMacsWithBox: { label: 'MACs por prompt con caja', kind: 'ops', note: 'P clics + 1 caja (2 esquinas, sin punto de relleno)' },
    encoderToDecoder: { label: 'Encoder / un prompt (MACs)', kind: 'ratio', note: 'cuántos prompts cuestan lo mismo que el encoder' },
    breakEvenPrompts: { label: 'Prompts para igualar un encoder', kind: 'count', note: 'prompts por imagen a los que el decoder acumula lo que costó el encoder' },
    imgEmbMem: { label: 'Embedding de imagen', kind: 'bytes', note: '64×64×C en fp16: lo que se cachea por imagen', notes: { sam2: 'rasgos de stride 16 (64×64×C) en fp16, por frame' } },
    winBlockMacs: { label: 'MACs de un bloque con ventanas', kind: 'ops', note: 'un bloque, sobre el relleno 64 → 70 (25 ventanas de 14×14)' },
    globalBlockMacs: { label: 'MACs de un bloque global', kind: 'ops', note: 'un bloque, atención sobre los N tokens' },
    globalToWinBlockMacs: { label: 'Bloque global / bloque con ventanas (MACs)', kind: 'ratio', note: 'las lineales son iguales; cambia la parte de atención' },
    winScoreMacs: { label: 'Ventanas: MACs de QKᵀ, A·V y posición relativa (un bloque)', kind: 'ops', note: 'nW·h·M²·M²·d_h por producto; ∝ N' },
    globalScoreMacs: { label: 'Global: MACs de QKᵀ, A·V y posición relativa (un bloque)', kind: 'ops', note: 'h·N²·d_h por producto; ∝ N²' },
    globalToWinScoreMacs: { label: 'Global / ventanas: QKᵀ, A·V y posición relativa', kind: 'ratio', note: 'por bloque' },
    winAttnMem: { label: 'Scores de un bloque con ventanas', kind: 'bytes', note: 'nW×h×M²×M² en fp16 (25 ventanas de 196 tokens), B = 1' },
    globalAttnMem: { label: 'Scores de un bloque global', kind: 'bytes', note: 'h×N×N en fp16, B = 1 (si se materializa: sin FlashAttention)' },
    globalToWinAttnMem: { label: 'Scores: bloque global / con ventanas', kind: 'ratio', note: 'por bloque, fp16' },
    winBlocks: { label: 'Bloques con ventanas', kind: 'count', note: 'L − 4' },
    globalBlocks: { label: 'Bloques globales', kind: 'count', note: '4 en H, L y B' },
    winBlocksMacs: { label: 'MACs de los bloques con ventanas', kind: 'ops', note: 'todos (L − 4 bloques)' },
    globalBlocksMacs: { label: 'MACs de los bloques globales', kind: 'ops', note: 'los 4' },
    patchEmbedMacs: { label: 'MACs del patch embedding', kind: 'ops', note: 'conv 16×16 stride 16 (+ posición)' },
    globalBlocksMacsShare: { label: 'Bloques globales (en el encoder)', kind: 'pct', note: '% de los MACs del encoder' },
    relPosWinParams: { label: 'Posición relativa de un bloque con ventanas', kind: 'count', note: '2 tablas de (2M − 1)×d_h' },
    relPosGlobalParams: { label: 'Posición relativa de un bloque global', kind: 'count', note: '2 tablas de (2·H/16 − 1)×d_h' },
    padTokens: { label: 'Tokens con relleno (ventanas)', kind: 'count', note: 'nW·M²: la rejilla 64×64 se rellena a 70×70' },
    padOverhead: { label: 'Relleno de las ventanas', kind: 'pct', note: '% de tokens extra en cada bloque con ventanas' },
    allGlobalEncoderMacs: { label: 'MACs del encoder si todo fuera global', kind: 'ops', note: 'los L bloques con atención global' },
    allGlobalToActual: { label: 'Todo global / real (MACs del encoder)', kind: 'ratio', note: 'las lineales dominan: las ventanas ahorran poco en MACs, mucho en memoria' },
    decTokens: { label: 'Tokens del decoder T', kind: 'count', note: '5 aprendidos + P clics + 1 de relleno' },
    decT2iAttnMem: { label: 'Scores tokens → imagen del decoder', kind: 'bytes', note: 'h×T×N en fp16, una capa, B = 1' },
    vitHEncoderMacs: { label: 'MACs del encoder de SAM ViT-H', kind: 'ops', note: 'a 1024' },
    encoderMacsVsVitH: { label: 'Encoder / el de SAM ViT-H (MACs)', kind: 'ratio', note: 'a la misma resolución' },
    paramsVsVitH: { label: 'Parámetros / SAM ViT-H', kind: 'ratio', note: '' },
    // ---- Fase 5: SAM 2 (frame en régimen con el banco lleno; por objeto seguido; banco de memoria)
    frameMacs: { label: 'MACs por frame (un objeto)', kind: 'ops', note: 'frame en régimen: banco lleno (Nₚ + Nᵣ memorias y P punteros)' },
    firstFrameMacs: { label: 'MACs del primer frame (con prompt)', kind: 'ops', note: 'banco vacío: sin memory attention' },
    imgEncoderMacs: { label: 'MACs del encoder de imagen', kind: 'ops', note: 'Hiera + FPN + convs de alta resolución: una vez por frame, se comparten entre objetos' },
    imgEncoderMacsShare: { label: 'Encoder de imagen (Hiera + FPN)', kind: 'pct', note: '% del frame (un objeto)' },
    hieraMacs: { label: 'MACs de Hiera', kind: 'ops', note: 'los 4 stages, sin el FPN' },
    fpnMacs: { label: 'MACs del FPN', kind: 'ops', note: 'laterales 1×1 a C y top-down' },
    hiresMacs: { label: 'MACs de las convs de alta resolución', kind: 'ops', note: 'conv_s0 y conv_s1 del decoder: una vez por frame' },
    memAttnMacs: { label: 'MACs de la memory attention', kind: 'ops', note: 'Lₘ = 4 capas (self, cross a la memoria y MLP) + la posición de los punteros' },
    memAttnMacsShare: { label: 'Memory attention', kind: 'pct', note: '% del frame (un objeto); crece con Nᵣ' },
    memEncoderMacs: { label: 'MACs del memory encoder', kind: 'ops', note: 'downsampler de la máscara + fusión + 2 bloques ConvNeXt' },
    memEncoderMacsShare: { label: 'Memory encoder', kind: 'pct', note: '% del frame (un objeto)' },
    objPtrMacs: { label: 'MACs del MLP del puntero', kind: 'ops', note: 'token de la máscara elegida → puntero de C' },
    perObjectMacs: { label: 'MACs por objeto seguido', kind: 'ops', note: 'todo menos el encoder de imagen: memory attention, decoder, puntero y memory encoder' },
    perObjectMacsShare: { label: 'Parte por objeto', kind: 'pct', note: '% del frame que se repite por cada objeto extra' },
    memCrossScoreMacs: { label: 'Cross-attention a la memoria: MACs de QKᵀ y A·V', kind: 'ops', note: 'las Lₘ capas; ∝ N·Nₘ' },
    memSelfScoreMacs: { label: 'Self-attention del frame: MACs de QKᵀ y A·V', kind: 'ops', note: 'las Lₘ capas de memory attention; ∝ N²' },
    memCrossAttnMem: { label: 'Scores de la cross-attention a la memoria', kind: 'bytes', note: '1×N×Nₘ en fp16 (1 cabeza), una capa, B = 1' },
    memSelfAttnMem: { label: 'Scores de la self-attention del frame', kind: 'bytes', note: '1×N×N en fp16 (1 cabeza), una capa, B = 1' },
    memTokens: { label: 'Tokens de memoria Nₘ', kind: 'count', note: '(Nₚ + Nᵣ)·N + 4·P' },
    spatialMemTokens: { label: 'Tokens de memoria espacial', kind: 'count', note: '(Nₚ + Nᵣ)·N' },
    ptrTokens: { label: 'Tokens de punteros', kind: 'count', note: '4·P: cada puntero de C = 256 se parte en 4 de Cₘ = 64' },
    memFramesUsed: { label: 'Memorias espaciales leídas', kind: 'count', note: 'Nₚ + Nᵣ' },
    ptrsUsed: { label: 'Punteros leídos P', kind: 'count', note: 'los del frame con prompt + los de hasta 15 frames anteriores' },
    memPerFrameMem: { label: 'Memoria de un frame', kind: 'bytes', note: 'N×Cₘ en fp16 (sin su posición)' },
    memBankFeatMem: { label: 'Banco: memorias espaciales', kind: 'bytes', note: '(Nₚ + Nᵣ)·N×Cₘ en fp16' },
    memBankPosMem: { label: 'Banco: posición de las memorias', kind: 'bytes', note: 'se guarda con cada memoria; fp16' },
    memBankPtrMem: { label: 'Banco: punteros', kind: 'bytes', note: 'P×C en fp16' },
    memoryBankMem: { label: 'Banco de memoria por objeto', kind: 'bytes', note: 'memorias + posiciones + punteros, fp16' },
    memToImgEmb: { label: 'Canales: memoria / embedding (Cₘ / C)', kind: 'ratio', note: '64 / 256: la memoria se comprime ×4' },
    hieraGlobalBlocks: { label: 'Bloques globales de Hiera', kind: 'count', note: 'todos en el stage 3' },
    hieraBlocks: { label: 'Bloques de Hiera', kind: 'count', note: 'suma de los 4 stages' },
    samHMacs: { label: 'MACs de SAM ViT-H (un prompt)', kind: 'ops', note: 'a 1024' },
    frameVsSamH: { label: 'Frame / SAM ViT-H (MACs)', kind: 'ratio', note: 'un frame en régimen vs una imagen con un clic' },
    imgEncoderVsSamH: { label: 'Encoder de imagen / el de SAM ViT-H (MACs)', kind: 'ratio', note: 'Hiera + FPN vs ViT-H + neck' },
    paramsVsSamH: { label: 'Parámetros / SAM ViT-H', kind: 'ratio', note: '' },
    // Fase 6 (LLM): inferencia. intensity = FLOPs por byte movido; rate = tokens/s (estimado de roofline).
    kvBytesPerToken: { label: 'KV cache por token', kind: 'bytes', note: '2·L·n_kv·d_h·bytes de la KV (K y V de todas las capas)' },
    kvBytesPerTokenLayer: { label: 'KV cache por token y capa', kind: 'bytes', note: '2·n_kv·d_h·bytes de la KV' },
    kvCacheBytes: { label: 'KV cache', kind: 'bytes', note: 'por token × ctx × B, a los bits de la KV (por defecto bf16)' },
    kvBytesPerTokenMHA: { label: 'KV por token si fuera MHA', kind: 'bytes', note: 'n_kv = n_heads' },
    kvCacheBytesMHA: { label: 'KV cache si fuera MHA', kind: 'bytes', note: 'n_kv = n_heads' },
    kvCacheBytesMQA: { label: 'KV cache si fuera MQA', kind: 'bytes', note: 'n_kv = 1' },
    kvSavingVsMHA: { label: 'Ahorro de KV vs MHA', kind: 'ratio', note: 'n_heads / n_kv' },
    kvCacheVsWeights: { label: 'KV cache / pesos', kind: 'ratio', note: 'cuando pasa de ×1, la cache ya pesa más que el modelo' },
    weightBytes: { label: 'Pesos en memoria', kind: 'bytes', note: 'lineales de los bloques × bits / 8 + embedding y LM head en 16 bits (si bits < 16); sin escalas: +3–6 % con escalas de grupo' },
    weightBytes16: { label: 'Pesos a 16 bits', kind: 'bytes', note: 'bf16/fp16' },
    weightBytes8: { label: 'Pesos a 8 bits', kind: 'bytes', note: 'lineales en INT8/FP8; embedding y LM head en 16 bits; sin escalas' },
    weightBytes4: { label: 'Pesos a 4 bits', kind: 'bytes', note: 'lineales en INT4; embedding y LM head en 16 bits (como GPTQ/AWQ); sin escalas: +3–6 % con escalas de grupo' },
    quantizedLinearBytes: { label: 'Pesos de las lineales (cuantizados)', kind: 'bytes', note: 'atención y FFN de los bloques × bits / 8' },
    unquantizedBytes: { label: 'Pesos que quedan en 16 bits', kind: 'bytes', note: 'embedding, LM head, RMSNorm (y router de MoE)' },
    quantizedParams: { label: 'Parámetros cuantizables', kind: 'count', note: 'lineales de los bloques (atención + FFN)' },
    unquantizedParams: { label: 'Parámetros sin cuantizar', kind: 'count', note: 'embedding, LM head, RMSNorm (y router)' },
    activeWeightBytes: { label: 'Pesos activos por token', kind: 'bytes', note: 'MoE: solo los expertos elegidos; a los bits de los pesos' },
    kvPlusWeightsBytes: { label: 'Pesos + KV cache', kind: 'bytes', note: 'lo que ocupa en la HBM (≈, sin activaciones ni runtime)' },
    hbmHeadroomBytes: { label: 'HBM libre', kind: 'bytes', note: 'HBM − pesos − KV cache; negativo = no cabe (H100 de 80 GB)' },
    totalParams: { label: 'Parámetros totales', kind: 'count', note: 'todo lo que vive en memoria' },
    activeParams: { label: 'Parámetros activos por token', kind: 'count', note: 'MoE: compartidos + top-k expertos; denso = totales' },
    activeParamsShare: { label: 'Activos / totales', kind: 'pct', note: '' },
    embedParams: { label: 'Embedding de entrada', kind: 'count', note: 'V×d' },
    lmHeadParams: { label: 'LM head', kind: 'count', note: 'd×V (sin atar al embedding)' },
    attnParams: { label: 'Atención (todas las capas)', kind: 'count', note: 'Q, K, V, O' },
    ffnParams: { label: 'FFN (todas las capas)', kind: 'count', note: 'SwiGLU: gate, up, down (MoE: todos los expertos + router)' },
    normParams: { label: 'RMSNorms', kind: 'count', note: 'solo la escala γ' },
    layerParams: { label: 'Parámetros por capa', kind: 'count', note: '' },
    attnParamsLayer: { label: 'Atención por capa', kind: 'count', note: 'd·(n_h + 2·n_kv)·d_h + n_h·d_h·d' },
    ffnParamsLayer: { label: 'FFN por capa', kind: 'count', note: '3·d·d_ff (MoE: × expertos + router)' },
    embedParamsShare: { label: 'Embedding + LM head', kind: 'pct', note: '% de los parámetros',
      labels: { bert: 'Embeddings (palabra, posición y segmento)' }, notes: { bert: '% de los parámetros; el decoder del MLM reutiliza la tabla (atado)' } },
    attnParamsShare: { label: 'Atención', kind: 'pct', note: '% de los parámetros' },
    ffnParamsShare: { label: 'FFN', kind: 'pct', note: '% de los parámetros' },
    normParamsShare: { label: 'Normas', kind: 'pct', note: '% de los parámetros' },
    routerParams: { label: 'Routers', kind: 'count', note: 'd×E por capa, × L capas' },
    expertParams: { label: 'Un experto', kind: 'count', note: '3·d·d_ff', labels: { pi0: 'Parámetros del experto de acción' }, notes: { pi0: 'gemma_300m: 18 capas de ancho D_a = 1024 + su norma final' } },
    expertsParamsShare: { label: 'Expertos', kind: 'pct', note: '% de los parámetros' },
    prefillMacs: { label: 'MACs del prefill', kind: 'ops', note: 'T tokens en paralelo, todas las capas', notes: { openvla: 'visión + proyector + Llama sobre las N + T filas (sin el decode)' } },
    prefillMacsPerToken: { label: 'MACs del prefill por token', kind: 'ops', note: '≈ parámetros sin embedding + el término de atención' },
    prefillMacsLastLogits: { label: 'Prefill con logits solo del último token', kind: 'ops', note: 'lo que hace un servidor real: la LM head corre 1 vez' },
    prefillScoreMacs: { label: 'Prefill: QKᵀ y A·V', kind: 'ops', note: 'la matriz T×T completa (como la cuentan HF y sdpa)' },
    prefillScoreMacsCausal: { label: 'Prefill: QKᵀ y A·V útiles', kind: 'ops', note: 'solo el triángulo causal (≈ la mitad)' },
    prefillScoreMacsShare: { label: 'Prefill: parte de atención', kind: 'pct', note: '% de los MACs del prefill' },
    decodeMacsPerToken: { label: 'MACs por token en decode', kind: 'ops', note: '1 token leyendo ctx de K/V' },
    decodeScoreMacs: { label: 'Decode: QKᵀ y A·V', kind: 'ops', note: '∝ ctx' },
    decodeLinearMacs: { label: 'Decode: capas lineales', kind: 'ops', note: '≈ parámetros activos sin embedding' },
    decodeScoreMacsShare: { label: 'Decode: parte de atención', kind: 'pct', note: '% de los MACs por token; crece con ctx' },
    decodeFlopsPerParam: { label: 'FLOPs por parámetro (decode)', kind: 'ratio', note: 'la regla dice ≈ 2' },
    prefillBytes: { label: 'Bytes movidos en el prefill', kind: 'bytes', note: 'pesos + KV escrita' },
    decodeBytesPerStep: { label: 'Bytes leídos por paso de decode', kind: 'bytes', note: 'pesos + KV cache' },
    decodeWeightBytesRead: { label: 'Decode: pesos leídos', kind: 'bytes', note: 'una vez por paso, para todo el lote', labels: { openvla: 'Pesos del LLM leídos por paso de decode' }, notes: { openvla: 'Llama 2 + LM head en bf16, sin la tabla de embedding; la visión no corre en el decode' } },
    decodeKvBytesRead: { label: 'Decode: KV leída', kind: 'bytes', note: 'ctx × B × KV por token' },
    arithmeticIntensityPrefill: { label: 'Intensidad aritmética del prefill', kind: 'intensity', note: 'FLOPs / bytes movidos' },
    arithmeticIntensityDecode: { label: 'Intensidad aritmética del decode', kind: 'intensity', note: 'FLOPs / bytes movidos; ≈ B con ctx corto' },
    ridgePoint: { label: 'Punto de quiebre de la GPU', kind: 'intensity', note: 'pico de FLOPs / ancho de banda (H100 SXM ≈)' },
    decodeTokPerSecUpperBound: { label: 'Decode: tokens/s del lote (≈ tope)', kind: 'rate', note: 'estimado de roofline, sin overhead de kernels; no mira si el lote cabe en la HBM' },
    decodeTokPerSecPerSeq: { label: 'Decode: tokens/s por secuencia (≈ tope)', kind: 'rate', note: 'estimado de roofline' },
    prefillTokPerSecUpperBound: { label: 'Prefill: tokens/s (≈ tope)', kind: 'rate', note: 'estimado de roofline' },
    maxBatchInHbm: { label: 'Lote máximo que cabe en HBM', kind: 'count', note: '(HBM − pesos) / KV por secuencia (≈, sin activaciones; H100 de 80 GB)' },
    decodeExpertsReadPerLayer: { label: 'Expertos leídos por capa', kind: 'avg', note: 'esperado con ruteo uniforme y el lote B: E·(1 − ((E−k)/E)^B)' },
    experts: { label: 'Expertos E', kind: 'count', note: '' },
    // Fase 7 (VLMs): tokens visuales y su costo.
    visualTokens: { label: 'Tokens visuales N', kind: 'count', note: 'los que entran al LLM por imagen', notes: { llava: '576 a 336 px (CLS fuera)', 'qwen2-vl': '(H/28)·(W/28) por imagen, tras el merge 2×2', openvla: '256 parches por imagen (features de las dos torres fusionadas)', pi0: 'todas las cámaras: 256 por cámara' } },
    promptTokens: { label: 'Tokens del prompt (N + T)', kind: 'count', note: 'visuales + texto' },
    visualShare: { label: 'Parte visual del prompt', kind: 'pct', note: '% de los tokens del prompt que son de imagen' },
    prefillShareFromImage: { label: 'Prefill debido a la imagen', kind: 'pct', note: '% de los MACs del prefill: torre de visión + projector + los N tokens en el LLM' },
    kvBytesPerImage: { label: 'KV cache por imagen', kind: 'bytes', note: 'N tokens × KV por token (bf16)', notes: { 'qwen2-vl': 'N tokens × KV por token (bf16); en un video, el clip entero' } },
    visualTokensPerImage: { label: 'Tokens visuales por imagen', kind: 'count', note: '', notes: { llava: '576 por imagen a 336 px', 'qwen2-vl': 'una imagen; en un video, el clip entero' } },
    llmMacsFromImage: { label: 'MACs del LLM por la imagen', kind: 'ops', note: 'prefill del LLM con N + T filas menos con T' },
    llmMacsTextOnly: { label: 'MACs del LLM solo con el texto', kind: 'ops', note: 'prefill del LLM con las T filas de texto' },
    posSpan: { label: 'Posiciones M-RoPE ocupadas', kind: 'count', note: 'texto + max(alto, ancho) de la rejilla de la imagen' },
    crossoverNProj: { label: 'Largo donde la atención iguala a las proyecciones', kind: 'count', note: 'como crossoverN, pero solo contra Q, K, V, O (sin la FFN)' },
    crossoverN: { label: 'Largo donde la atención iguala a las lineales', kind: 'count', note: 'filas a partir de las que QKᵀ + A·V cuestan más que las proyecciones y la FFN (por capa)' },
    scoreToLinear: { label: 'Atención / lineales', kind: 'ratio', note: 'MACs de QKᵀ + A·V sobre los de las lineales, por capa' },
    kvBytesPrompt: { label: 'KV cache del prompt', kind: 'bytes', note: '(N + T) × KV por token (bf16)' },
    visionMacs: { label: 'MACs de la torre de visión', kind: 'ops', note: 'ViT completo (LLaVA corre las 24 capas aunque usa la penúltima)' },
    visionMacsUsed: { label: 'MACs de visión que se usan', kind: 'ops', note: 'hasta la capa de la que salen las features' },
    visionMacsDiscarded: { label: 'MACs de visión desperdiciados', kind: 'ops', note: 'la última capa de CLIP: HF la corre y la descarta' },
    llmPrefillMacs: { label: 'MACs del prefill del LLM (N + T filas)', kind: 'ops', note: '' },
    projectorMacs: { label: 'MACs del projector / merger', kind: 'ops', note: '' },
    imageMacs: { label: 'MACs debidos a la imagen', kind: 'ops', note: 'visión + projector + los N tokens en el LLM' },
    visionParams: { label: 'Parámetros de la torre de visión', kind: 'count', note: '', labels: { openvla: 'Parámetros de las dos torres de visión' }, notes: { openvla: 'DINOv2 + SigLIP, con las partes que no se usan' } },
    projectorParams: { label: 'Parámetros del projector / merger', kind: 'count', note: '' },
    llmParams: { label: 'Parámetros del LLM', kind: 'count', note: '' },
    visualModuleParams: { label: 'Parámetros de visión + projector', kind: 'count', note: '' },
    visionParamsShare: { label: 'Visión', kind: 'pct', note: '% de los parámetros' },
    visionMacsShare: { label: 'Visión: % del prefill', kind: 'pct', note: '% de los MACs del prefill', labels: { openvla: 'MACs de visión (% de la acción)' }, notes: { openvla: 'DINOv2 + SigLIP sobre los MACs por acción' } },
    ttftMs: { label: 'TTFT (≈ cota inferior, ms)', kind: 'count', note: 'roofline en H100, sin overhead' },
    ttftTextOnlyMs: { label: 'TTFT sin imagen (≈ ms)', kind: 'count', note: 'roofline en H100' },
    topk: { label: 'Expertos por token k', kind: 'count', note: '' },
  };
  // Fase 9 (π0): tiempos ≈ por etapa y hardware (chunkMsRtx4090, prefixMsH100, flowMsOrin…), roofline con specs citadas.
  // Con la preposición ya contraída: «ms del prefill», no «ms de el prefill». decodeMs* = UN paso de decode.
  { const ST = { chunk: 'de un chunk de acciones', image: 'de los encoders de imagen', prefix: 'del prefijo en Gemma (tokens de imagen + texto; sin SigLIP)', flow: 'de los pasos de flow',
      flowStep: 'de un paso de flow', vision: 'de la visión', prefill: 'del prefill', decode: 'de un paso de decode', decodeTotal: 'de todo el decode', action: 'de una acción' };
    const HW = { Rtx4090: 'RTX 4090', H100: 'H100', Orin: 'Jetson AGX Orin', '': 'el hardware elegido' };
    const EST = { Orin: '; FP16 denso derivado (≈)' };
    Object.keys(ST).forEach((st) => Object.keys(HW).forEach((hw) => {
      const k = st + 'Ms' + hw;
      if (!METRICS[k]) METRICS[k] = { label: 'ms ' + ST[st] + ' en ' + HW[hw] + ' (≈ cota)', kind: 'ms', note: 'roofline con las specs citadas, sin overhead' + (EST[hw] || '') };
    }));
    Object.keys(HW).filter((hw) => hw).forEach((hw) => {
      if (!METRICS['chunkHz' + hw]) METRICS['chunkHz' + hw] = { label: 'Chunks/s en ' + HW[hw] + ' (≈ tope)', kind: 'hz', note: 'roofline con las specs citadas, sin overhead' + (EST[hw] || '') };
    });
    // Hardware del roofline (lo que devuelve metrics(); por defecto H100 SXM).
    if (!METRICS.bandwidth) METRICS.bandwidth = { label: 'Ancho de banda de memoria', kind: 'bw', note: 'el del roofline (por defecto H100 SXM, 3.35 TB/s)' };
    if (!METRICS.peakFlops) METRICS.peakFlops = { label: 'Pico de cómputo', kind: 'flops', note: 'denso, bf16/FP16 (por defecto H100 SXM, 989 TFLOPS)' };
    // ANN (fase 11): el roofline de la búsqueda es la CPU (FAISS), no la H100.
    METRICS.bandwidth.notes = Object.assign({}, METRICS.bandwidth.notes, { ann: 'el del roofline de la búsqueda: CPU AMD EPYC 9654, 1 socket (460.8 GB/s)' });
    METRICS.peakFlops.notes = Object.assign({}, METRICS.peakFlops.notes, { ann: 'CPU AMD EPYC 9654: fp32 ≈ 7.37 TFLOPS (derivado)' }); }
  const metricNote = (k, model) => { const m = METRICS[metricKey(k)] || {}; return (m.notes && model && m.notes[model]) || m.note || ''; };
  const metricKey = (k) => (k === 'kv' ? 'kvCache' : k);
  const DIFFUSION = { 'stable-diffusion': true, dit: true };   // fase 8: modelos cuyo samplingMacs es el costo por imagen
  // Etiqueta: la del modelo (labels[model]: «Celdas A» en YOLO) o la general.
  const metricLabel = (k, model) => { const m = METRICS[metricKey(k)] || {}; return (m.labels && model && m.labels[model]) || m.label || k; };
  const UNIT_KIND = { ratio: 'ratio', count: 'count', bytes: 'bytes', pct: 'pct', macs: 'ops', params: 'count', ms: 'ms', duration: 'duration' };
  // Tipo de formato: el de METRICS; si la clave no está, por su nombre (las métricas que añade cada modelo
  // siguen la convención …Mem/…Cache = bytes, …Share = fracción, …Macs = MACs; como js/core/quantities.js).
  function metricKind(key) {
    const k = metricKey(key);
    // Primero el mapa `units` del modelo (lo registra metrics()); luego METRICS; luego el nombre.
    if (METRICS[k] && ['intensity', 'rate', 'avg', 'ms', 'duration', 'hz', 'bw', 'flops', 'bool'].includes(METRICS[k].kind)) return METRICS[k].kind;   // formato propio, gana a units
    if (ARCH_UNITS[k] && UNIT_KIND[ARCH_UNITS[k]]) return UNIT_KIND[ARCH_UNITS[k]];
    if (METRICS[k] && METRICS[k].kind) return METRICS[k].kind;
    if (/Mem(\d+x|AllLayers|Batch|PerSample|Layer)?$|Cache$/.test(k)) return 'bytes';
    if (/Share$/.test(k)) return 'pct';
    if (/Macs(\d+x|Layer)?$/.test(k)) return 'ops';
    if (/^fits/.test(k)) return 'bool';   // fitsOn…, fitsInHbm: booleanos del calculador
    return 'count';
  }
  // Cociente con 3 cifras significativas: 504.925 → '505', 9.5 → '9.5', 16 → '16'.
  // Si el redondeo da un entero de una cifra que no es exacto (1.004), 2 decimales: '×1.00', no '×1'.
  // ≥ 1000: entero redondeado (1,645, no 1,640); ≥ 100,000: 3 cifras significativas (3,810,000), como quantities.js.
  const fRatio = (v) => { const x = Number(v.toPrecision(3)); if (Math.abs(x) < 10 && Number.isInteger(x) && v !== x) return v.toFixed(2); return Math.abs(x) >= 1e5 ? fInt(x) : Math.abs(x) >= 1000 ? fInt(Math.round(v)) : String(x); };
  // Milisegundos (fase 8): 3 cifras significativas, como quantities.js: 1.62 · 2.54 · 83.8 · 121.
  const fMs = (v) => { const a = Math.abs(v); return a >= 100 ? fInt(Math.round(v)) : a >= 10 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : String(Number(v.toPrecision(3))); };
  // Lee una métrica: número, {bytes}, o función (attnMem(dtype), kvCache(B, ctx, dtype)…). Booleano (fitsOn24…) → 1 / 0
  // (kind 'bool': fMetric lo escribe «sí» / «no»).
  function metricValue(m, key) {
    if (!m) return null;
    const k = metricKey(key);
    let v = m[k];
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (k === 'scoreMacs' && v == null) { const sp = attnSplit(m); v = sp ? sp.attn : null; }
    if (typeof v === 'function') v = safe(() => (k === 'kvCache' ? v(1, undefined, 'fp16') : k === 'actMem' ? v(1, 'fp16') : v('fp16')), null);
    if (v && typeof v === 'object') v = v.bytes != null ? v.bytes : v.total != null ? v.total : v.value != null ? v.value : null;
    return typeof v === 'number' && isFinite(v) ? v : null;
  }
  // Porcentaje: 1 decimal desde 1 %; debajo de 1 %, 3 cifras significativas (0.0848 %, 0.520 %: "0.1 %" sería −18 %).
  // Mismo criterio que ATLAS.Arch.fmt.pctAuto (prosa {{metrics.…Share}} y tablas compare); ≥ 1 % igual que antes.
  function fPctAuto(v) {
    const p = v * 100;
    return (p !== 0 && Math.abs(p) < 1 ? p.toPrecision(3) : (Math.round(p * 10) / 10).toFixed(1)) + ' %';
  }
  function fMetric(key, v) {
    if (v == null) return '—';
    const kind = metricKind(key);
    if (kind === 'bool') return v ? 'sí' : 'no';
    if (kind === 'bytes') return fBytes(v);
    if (kind === 'ops') return fOps(v, metricKey(key) === 'flops' ? 'FLOPs' : 'MACs');
    if (kind === 'pct') return fPctAuto(v);
    if (kind === 'ratio') return '×' + fRatio(v);
    if (kind === 'intensity') return fRatio(v) + ' FLOPs/B';
    if (kind === 'rate') return '≈ ' + fRatio(v) + ' tok/s';
    if (kind === 'ms') return fMs(v) + ' ms';
    // 'duration' (fase 11): un tiempo largo con su unidad (36.8 s, 16.3 min, 6.8 días); fmt.duration del calculador.
    if (kind === 'duration') { const A = Arch(); return A && A.fmt && typeof A.fmt.duration === 'function' ? A.fmt.duration(v) : fMs(v) + ' ms'; }
    // 'avg': un conteo esperado (no un factor): 1 decimal, sin «×»; «de E» si es un MoE (≈ 7.2 de 8).
    if (kind === 'hz') return '≈ ' + fRatio(v) + ' Hz';
    if (kind === 'bw') return fRate(v, 'B/s');
    if (kind === 'flops') return fRate(v, 'FLOPS');
    if (kind === 'avg') return (Number.isInteger(v) ? String(v) : '≈ ' + v.toFixed(1)) + (ARCH_CTX.experts ? ' de ' + ARCH_CTX.experts : '');
    return v >= 1e6 ? fSi(v) : fInt(v);
  }
  // Comparación con la base: factor (×4) o, para porcentajes, diferencia en puntos.
  function fVsBase(key, v, b) {
    if (v == null || b == null) return '';
    if (metricKind(key) === 'bool') return v === b ? 'base' : (b ? 'sí' : 'no') + ' en la base';
    if (metricKind(key) === 'pct') { const d = (v - b) * 100; return Math.abs(d) < 0.05 ? 'base' : (d > 0 ? '+' : '−') + Math.abs(d).toFixed(1) + ' pp vs base'; }
    if (!b) return '';
    return Math.abs(v / b - 1) < 0.0005 ? 'base' : fFactor(v / b) + ' vs base';
  }
  const isChanged = (key, v, b) => v != null && b != null && (metricKind(key) === 'bool' ? v !== b : metricKind(key) === 'pct' ? Math.abs(v - b) >= 0.0005 : b !== 0 && Math.abs(v / b - 1) >= 0.0005);
  function fMetricExact(key, v) {
    if (v == null) return '';
    const kind = metricKind(key);
    if (kind === 'bool') return v ? 'sí' : 'no';
    if (kind === 'pct') return (v * 100).toFixed(Math.abs(v) < 0.01 && v !== 0 ? 4 : 3) + ' %';
    if (kind === 'ratio') return '×' + String(+v.toFixed(4));
    if (kind === 'intensity') return String(+v.toFixed(4)) + ' FLOPs/B';
    if (kind === 'rate') return String(+v.toFixed(2)) + ' tok/s';
    if (kind === 'ms' || kind === 'duration') return String(+v.toFixed(3)) + ' ms';
    if (kind === 'hz') return String(+v.toFixed(2)) + ' Hz';
    if (kind === 'bw') return fInt(v) + ' B/s';
    if (kind === 'flops') return fInt(v) + ' FLOPS';
    if (kind === 'avg') return String(+v.toFixed(3));
    return fInt(v) + (kind === 'bytes' ? ' bytes' : '');
  }
  // Reparto de MACs: matriz de atención (QKᵀ + A·V, crece con N²) vs capas lineales (crecen con N).
  function attnSplit(m) {
    if (!m || !(m.macs > 0)) return null;
    let attn = null;
    // scoreMacs = QKᵀ + A·V (ATLAS.Arch.metrics). attnMacs incluye proyecciones: no sirve aquí.
    for (const k of ['scoreMacs', 'attnScoreMacs']) if (typeof m[k] === 'number') { attn = m[k]; break; }
    if (attn == null && typeof m.scoreMacsShare === 'number') attn = m.scoreMacsShare * m.macs;
    if (attn == null) return null;
    return { attn, linear: Math.max(0, m.macs - attn), share: attn / m.macs };
  }

  // ------------------------------------------------------------------ diagramas del modelo
  // cfg (opcional): sin las vistas que declaran `configs` y no la incluyen (moe-block solo para Mixtral; las vistas
  // densas del decoder no dibujan Mixtral): así ningún ejercicio sale de una figura que no aplica a esa config.
  // Fase 9: un diagrama con calc: false (RT-2: pesos cerrados, sin config del calculador) no da drills de formas ni de parámetros.
  function diagramsOf(model, cfg) {
    const all = safe(() => ATLAS.diagrams(), {}) || {};
    return Object.values(all).filter((d) => d && d.model === model && d.kind !== 'map' && d.calc !== false
      && (!cfg || !Array.isArray(d.configs) || !d.configs.length || d.configs.indexOf(cfg) >= 0 || d.configs.indexOf(baseCfg(cfg)) >= 0));
  }
  // Config de decode → su config de prefill (llama3-8b-decode → llama3-8b) para el filtro de vistas.
  const baseCfg = (cfg) => safe(() => { const R = run(cfg); return (R && R.config && R.config.decodeOf) || cfg; }, cfg);
  const edgeKey = (e) => e.from + '>' + e.to;
  // ov = los overrides de la arista o del glifo (fase 6): un tensor del carril de decode ({decode: 1}) no es el
  // mismo que el del prefill aunque tenga el mismo id. Sin ov = las aristas de la corrida base del diagrama.
  function tensorInDiagram(d, tid, ov) {
    return (d.edges || []).some((e) => e.tensor === tid && sameOv(e.ov, ov)) || (d.tensors || []).some((t) => t.id === tid && sameOv(t.ov, ov));
  }
  // cfg (fase 10, revisión): solo las vistas que aplican a la config del drill (diagramsOf con configs). Sin él, el drill
  // de DPO «Política · log-probs por secuencia» montaba ppo-step (la primera vista con el tensor pol-logp).
  function diagramForTensor(model, tid, ov, cfg) {
    const ds = diagramsOf(model, cfg);
    return ds.find((d) => (d.edges || []).some((e) => e.tensor === tid && sameOv(e.ov, ov))) || ds.find((d) => tensorInDiagram(d, tid, ov)) || null;
  }
  // config: la del drill. Se pasa al diagrama solo si la vista la declara en `configs` (ppo-step / dpo-step / lora-overview…
  // dibujan cada config a su manera); una vista sin `configs` se dibuja con la suya, como antes.
  function mountMini(figEl, diagramId, hl, config) {
    const AD = ATLAS.ArchDiagram;
    if (!AD || typeof AD.render !== 'function' || !diagramId) return null;
    try {
      const spec = safe(() => ATLAS.diagram(diagramId), null);
      const useCfg = config && spec && Array.isArray(spec.configs) && spec.configs.indexOf(config) >= 0 && config !== spec.config ? config : null;
      const dg = AD.render(diagramId, figEl, Object.assign({ mode: 'mini', quiz: true, showNumbers: false }, useCfg ? { config: useCfg } : {}));
      if (dg && hl && typeof dg.highlight === 'function') safe(() => dg.highlight(hl));
      // La figura mini tiene alto máximo: se desplaza hasta lo resaltado (sin mover la página).
      const center = () => {
        const on = figEl.querySelector('.ad-edge.is-on, [data-edge].is-on') || figEl.querySelector('.is-on');
        if (!on || !on.getBoundingClientRect) return;
        const fr = figEl.getBoundingClientRect(), r = on.getBoundingClientRect();
        figEl.scrollTop += (r.top + r.height / 2) - (fr.top + figEl.clientHeight / 2);
        figEl.scrollLeft += (r.left + r.width / 2) - (fr.left + figEl.clientWidth / 2);
      };
      if (root.requestAnimationFrame) root.requestAnimationFrame(() => root.requestAnimationFrame(center)); else center();
      return dg;
    } catch (e) { figEl.textContent = ''; return null; }
  }
  const destroyDg = (dg) => { if (dg && typeof dg.destroy === 'function') safe(() => dg.destroy()); };

  // ------------------------------------------------------------------ parseo de respuestas
  // "197x768", "197 × 768", "(197, 768)", "[197,768]", "1×197×768", "B×197×768" → candidatos [[197,768]…]
  function parseShape(str) {
    let s = String(str || '').trim().toLowerCase();
    if (!s) return [];
    s = s.replace(/[()[\]{}]/g, ' ').replace(/\btorch\.size\b/g, ' ').trim();
    const cands = [];
    const toNums = (parts) => {
      const p = parts.map((x) => x.trim()).filter((x) => x !== '');
      if (!p.length) return null;
      const out = [];
      for (const x of p) {
        if (x === 'b') { out.push('B'); continue; }
        if (!/^\d+$/.test(x)) return null;
        out.push(parseInt(x, 10));
      }
      return out;
    };
    const hasX = /[x×*·⋅]/.test(s);
    if (hasX) {
      // con "×" (o "·", como en la aritmética de la app) las comas son separadores de miles (1,000 × 768)
      const a = toNums(s.replace(/(\d),(?=\d{3}\b)/g, '$1').split(/[x×*·⋅]/));
      if (a) cands.push(a);
    } else {
      const a = toNums(s.split(/[,;\s]+/));
      if (a) cands.push(a);
      // un solo número con coma de miles: "1,000"
      if (/^\d{1,3}(,\d{3})+$/.test(s)) cands.push([parseInt(s.replace(/,/g, ''), 10)]);
    }
    return cands;
  }
  function shapeMatches(str, expected) {
    const exp = (expected || []).map(Number);
    return parseShape(str).some((c) => {
      let a = c;
      if (a.length === exp.length + 1 && (a[0] === 1 || a[0] === 'B')) a = a.slice(1);   // batch opcional
      return a.length === exp.length && a.every((v, i) => v === exp[i]);
    });
  }
  // "86,567,656" · "86 567 656" · "86.567.656" · "86.6M" · "86.6 M" · "7.09e6" · "≈ 1.77 M" · "7,1 M" → número.
  // Reglas de separadores (se explican en las pistas de los drills):
  //  - Coma o espacio entre grupos de 3 cifras = miles (590,592 · 590 592).
  //  - Punto = miles SOLO si todos los grupos tras los puntos tienen exactamente 3 cifras, hay más de
  //    un grupo o ningún otro separador decimal, y no hay sufijo de unidad: 590.592 → 590592,
  //    86.567.656 → 86567656, 1.234,5 → 1234.5. Con sufijo (7.087 M) o con 1–2 decimales (86.6) es decimal.
  //  - Coma con 1–2 cifras = decimal (7,1 M → 7.1 M).
  // parseNum devuelve además `half`: media unidad de la última cifra escrita (precisión del redondeo:
  // "7.09M" → 5,000; "590000" → 5,000; "590592" → 0.5). Sirve para aceptar respuestas redondeadas.
  function parseNum(str) {
    let s = String(str || '').trim().toLowerCase().replace(/[≈~]/g, '').replace(/parámetros|params?|macs?|flops?|tokens?|tok\b/g, '').trim();
    if (!s) return null;
    let mult = 1;
    // p / e (fase 11): PMACs y EMACs (corpus de 21M pasajes, preentrenamiento de BERT).
    const m = s.match(/(k|m|g|b|t|p|e|mil millones|millones|mil)\s*$/);
    if (m) {
      mult = { k: 1e3, mil: 1e3, m: 1e6, millones: 1e6, g: 1e9, b: 1e9, 'mil millones': 1e9, t: 1e12, p: 1e15, e: 1e18 }[m[1]];
      s = s.slice(0, m.index).trim();
    }
    s = s.replace(/(\d)[\s_\u00a0\u202f](?=\d{3}\b)/g, '$1');
    if (!m && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');                        // 590.592 (miles con punto)
    else if (/^\d{1,3}(\.\d{3})+,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');   // 1.234,5
    else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');                  // 590,592 · 1,234.5
    else if (/^\d+,\d+$/.test(s)) s = s.replace(',', '.');                                   // coma decimal
    const mm = s.match(/^[+-]?(\d+)?(?:\.(\d*))?(?:e([+-]?\d+))?$/);
    if (!mm || (!mm[1] && !mm[2])) return null;
    const v = parseFloat(s) * mult;
    if (!isFinite(v)) return null;
    const dec = (mm[2] || '').length, ex = mm[3] ? parseInt(mm[3], 10) : 0;
    let half;
    if (dec || ex || mult !== 1) half = 0.5 * Math.pow(10, ex - dec) * mult;
    else { const tz = ((mm[1] || '').match(/0+$/) || [''])[0].length; half = 0.5 * Math.pow(10, Math.min(tz, Math.max(0, (mm[1] || '').length - 1))); }
    return { v, half };
  }
  function parseNumber(str) { const r = parseNum(str); return r ? r.v : null; }
  // Porcentaje escrito por la persona ("41.9", "41.9 %") → fracción 0.419 (las métricas pct son fracciones 0–1).
  function parsePct(str) { const v = parseNumber(String(str || '').replace(/%/g, '').trim()); return v == null ? null : v / 100; }
  // Bytes: "3.72 MB", "3,7 MB", "931 KB", "1.2 GiB" (binario también vale), "3720000", "3.72e6 B".
  function parseBytes(str) {
    const s = String(str || '').trim().toLowerCase().replace(/[≈~]/g, '').trim();
    const m = s.match(/^(.*?)\s*(bytes?|b|kb|mb|gb|tb|kib|mib|gib|tib)\s*$/);
    const U = { b: 1, byte: 1, bytes: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 };
    if (!m) return parseNumber(s);
    const n = parseNumber(m[1]);
    return n == null ? null : n * U[m[2]];
  }

  // ------------------------------------------------------------------ popover de opciones (diagrama en blanco)
  let openPop = null;
  function closePop(restore) {
    if (!openPop) return;
    const p = openPop; openPop = null;
    document.removeEventListener('pointerdown', p.onDoc, true);
    document.removeEventListener('keydown', p.onKey, true);
    if (p.el.parentNode) p.el.parentNode.removeChild(p.el);
    if (restore && p.returnTo && p.returnTo.isConnected && typeof p.returnTo.focus === 'function') safe(() => p.returnTo.focus({ preventScroll: true }));
    if (p.onClose) p.onClose();
  }
  function openPicker(o) {
    closePop(false);
    const host = o.host;
    const titleId = uid('pxp-t');
    const btns = o.options.map((op) => h('button', {
      type: 'button', class: 'pxp__opt' + (op.mono ? ' mono' : ''), role: 'menuitemradio', 'aria-checked': String(op.id === o.current),
      on: { click: () => { const ret = o.returnTo; closePop(false); o.onPick(op.id); if (ret && ret.isConnected) safe(() => ret.focus({ preventScroll: true })); } },
    }, op.text));
    const clear = o.current != null ? h('button', { type: 'button', class: 'pxp__clear btn btn--text', on: { click: () => { const ret = o.returnTo; closePop(false); o.onPick(null); if (ret && ret.isConnected) safe(() => ret.focus({ preventScroll: true })); } } }, 'Vaciar hueco') : null;
    const el = h('div', { class: 'pxp', role: 'dialog', 'aria-labelledby': titleId },
      h('div', { class: 'pxp__head' },
        h('p', { class: 'pxp__t', id: titleId }, o.title),
        h('button', { type: 'button', class: 'pxp__x', 'aria-label': 'Cerrar', html: icon('close'), on: { click: () => closePop(true) } })),
      o.subtitle ? h('p', { class: 'pxp__sub' }, o.subtitle) : null,
      o.hint ? h('p', { class: 'pxp__hint' }, 'Pista: ' + o.hint) : null,
      h('div', { class: 'pxp__list', role: 'menu', 'aria-labelledby': titleId }, btns),
      clear);
    host.appendChild(el);
    // Posición: bajo el ancla, dentro del ancho del bloque.
    const hr = host.getBoundingClientRect();
    const ar = o.anchor && o.anchor.getBoundingClientRect ? o.anchor.getBoundingClientRect() : null;
    const w = Math.min(320, hr.width);
    el.style.width = w + 'px';
    let left = 0, top = 0;
    if (ar && ar.width + ar.height > 0) {
      left = Math.max(0, Math.min(hr.width - w, ar.left - hr.left + ar.width / 2 - w / 2));
      top = ar.bottom - hr.top + 6;
    }
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    const onDoc = (e) => { if (!el.isConnected) { closePop(false); return; } if (!el.contains(e.target) && !(o.anchor && o.anchor.contains && o.anchor.contains(e.target))) closePop(false); };
    const onKey = (e) => {
      // Si el bloque ya no está en la página (navegación sin destroy), se cierra sin tragarse la tecla.
      if (!el.isConnected) { closePop(false); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(true); return; }
      if (!el.contains(document.activeElement)) return;
      const list = Array.from(el.querySelectorAll('.pxp__opt'));
      const i = list.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = list.length; const j = i < 0 ? 0 : (i + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
        list[j].focus();
      } else if (e.key === 'Tab') {
        // foco atrapado mientras está abierto
        const f = Array.from(el.querySelectorAll('button'));
        const k = f.indexOf(document.activeElement);
        if (e.shiftKey && k === 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && k === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener('pointerdown', onDoc, true);
    document.addEventListener('keydown', onKey, true);
    openPop = { el, onDoc, onKey, returnTo: o.returnTo, onClose: o.onClose };
    const cur = btns.find((b) => b.getAttribute('aria-checked') === 'true') || btns[0];
    if (cur) cur.focus({ preventScroll: true });
    safe(() => el.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' }));
  }

  // ================================================================== SCALING (explorador)
  function renderScaling(block, el, ctx) {
    const { model, config } = resolve(block, ctx);
    if (!config) throw new Error('No encontré una configuración del calculador para «' + (model || '?') + '».');
    const R = run(config);
    const cfg = R.config || {};
    const mk = modelKnobs(model);
    const knobs = (Array.isArray(block.knobs) && block.knobs.length ? block.knobs : Object.keys(mk).map((k) => ({ key: k })))
      .map((k) => {
        const values = (Array.isArray(k.values) && k.values.length ? k.values : (mk[k.key] || [])).slice();
        let base = knobBase(cfg, k.key, values);
        // Sin base en la serie (resolución de una config no cuadrada): la base del explorador es la
        // cuadrada de lado H (o la primera), y ese valor se manda siempre como override (forced).
        let forced = false;
        if (base == null && values.length) {
          base = values.indexOf(cfg.H) >= 0 ? cfg.H : values.slice().sort((a, b) => a - b)[0];
          forced = true;
        }
        if (base != null && values.indexOf(base) < 0) values.push(base);
        values.sort((a, b) => a - b);
        return { key: k.key, label: k.label || knobLabel(k.key, model), values, base, forced };
      })
      .filter((k) => k.values.length > 0);
    const show = (Array.isArray(block.show) && block.show.length ? block.show : ['tokens', 'params', 'macs', 'attnMem']).map(metricKey);
    const cur = {};
    knobs.forEach((k) => { cur[k.key] = k.base; });
    let xKnob = knobs.length ? knobs[0].key : null;
    const overrides = (o) => { const ov = {}; knobs.forEach((k) => { const v = (o || cur)[k.key]; if (v !== k.base || k.forced) ov[k.key] = v; }); return ov; };
    // Base de las comparaciones: la config con los knobs base (con la cuadrada forzada, si la hay).
    // Se calcula antes de clasificar las métricas: metrics() registra el mapa `units` del modelo.
    const baseM = metrics(config, overrides());
    const forcedKnob = knobs.find((k) => k.forced);
    const plottable = show.filter((k) => metricKind(k) !== 'pct' && metricKind(k) !== 'bool');   // sí / no no se grafica en log-log
    // Gráfica: MACs si están; si no, la primera memoria (CLIP: la curva B² de la matriz de logits); si no, otra.
    let chartMetric = plottable.indexOf('macs') >= 0 ? 'macs'
      : plottable.find((k) => metricKind(k) === 'bytes') || plottable.find((k) => k !== 'params') || plottable[0] || show[0];

    const wrap = h('div', { class: 'pxs' });
    el.appendChild(wrap);
    const head = h('div', { class: 'pxs__head' },
      h('p', { class: 'px-k' }, 'Explorador de escalado'),
      h('p', { class: 'pxs__cfg' }, h('span', { class: 'chip' }, cfgLabel(config)), h('span', { class: 'muted small' }, 'Cambia un knob: todo se recalcula con el calculador.')),
      forcedKnob ? h('p', { class: 'pxs__base muted small' }, 'La config es de ' + cfg.H + '×' + cfg.W + ' (no cuadrada); aquí todas las imágenes son cuadradas y la base («vs base») es ' + knobShow(forcedKnob.key, forcedKnob.base, model) + '.') : null);
    const knobsEl = h('div', { class: 'pxs__knobs' });
    const knobNote = h('p', { class: 'pxs__knote muted small', 'aria-live': 'polite', hidden: true });
    const cardsEl = h('div', { class: 'pxs__cards', 'aria-live': 'polite' });
    const errEl = h('div', { class: 'pxs__err', hidden: true });
    const chartEl = h('figure', { class: 'pxs__chart' });
    const splitEl = h('div', { class: 'pxs__split' });
    wrap.append(head, knobsEl, knobNote, errEl, cardsEl, chartEl, splitEl,
      h('p', { class: 'pxs__foot muted small' }, 'MACs = multiply-accumulates de matmuls y convs; FLOPs = 2 × MACs. Normas, softmax y activaciones no entran en el total (van aparte como «otros»). Muchas tablas llaman «FLOPs» a lo que en realidad son MACs.'));

    // ¿Esta combinación de knobs es válida? (p. ej. 384 px con P = 14: 384/14 no es entero).
    // null si lo es; si no, el motivo (mensaje del calculador). Se consulta antes de ofrecerla.
    function invalidReason(key, v) {
      const o = Object.assign({}, cur, { [key]: v });
      try { metrics(config, overrides(o)); return null; } catch (e) { return (e && e.message) || String(e); }
    }
    function noteKnob(msg) { knobNote.textContent = msg || ''; knobNote.hidden = !msg; }
    function paintKnobs() {
      knobsEl.innerHTML = '';
      knobs.forEach((k) => {
        const lid = uid('pxs-k');
        const row = h('div', { class: 'pxs__knob' }, h('span', { class: 'pxs__kl', id: lid }, k.label));
        if (k.values.length > 7) {
          const idx = Math.max(0, k.values.indexOf(cur[k.key]));
          const out = h('output', { class: 'pxs__kv mono' }, knobShow(k.key, cur[k.key], model));
          const rg = h('input', { type: 'range', class: 'pxs__range', min: '0', max: String(k.values.length - 1), step: '1', value: String(idx), 'aria-labelledby': lid,
            'aria-valuetext': knobShow(k.key, cur[k.key], model),
            on: { input: (e) => {
              const v = k.values[+e.target.value];
              const why = invalidReason(k.key, v);
              if (why) {
                // combinación inválida: se queda en el último valor válido y se explica por qué
                noteKnob(knobShow(k.key, v, model) + ' no está disponible con los demás knobs. ' + why);
                e.target.value = String(Math.max(0, k.values.indexOf(cur[k.key])));
                return;
              }
              noteKnob(null);
              cur[k.key] = v; xKnob = k.key; out.textContent = knobShow(k.key, cur[k.key], model); e.target.setAttribute('aria-valuetext', out.textContent); paint();
            } } });
          row.append(rg, out);
        } else {
          row.appendChild(h('div', { class: 'fchips', role: 'group', 'aria-labelledby': lid }, k.values.map((v) => {
            const why = cur[k.key] === v ? null : invalidReason(k.key, v);
            const tip = why ? 'No disponible con los demás knobs: ' + why : v === k.base ? (k.forced ? 'Base del explorador (la config es de ' + cfg.H + '×' + cfg.W + ')' : 'Valor de la config canónica') : null;
            // aria-disabled (no disabled): sigue enfocable y el motivo se lee/ve al tocarlo.
            return h('button', { type: 'button', class: 'fchip mono' + (v === k.base ? ' is-base' : '') + (why ? ' is-off' : ''), 'aria-pressed': String(cur[k.key] === v),
              'aria-disabled': why ? 'true' : null, title: tip,
              on: { click: () => {
                if (why) { noteKnob(knobShow(k.key, v, model) + ' no está disponible con los demás knobs. ' + why); return; }
                noteKnob(null);
                cur[k.key] = v; xKnob = k.key; paintKnobs(); paint(); const b = knobsEl.querySelector('[data-k="' + k.key + '"][data-v="' + v + '"]'); if (b) b.focus();
              } }, dataset: { k: k.key, v } },
            knobShow(k.key, v, model));
          })));
        }
        knobsEl.appendChild(row);
      });
    }

    function paint() {
      let m;
      errEl.hidden = true;
      try { m = metrics(config, overrides()); } catch (e) {
        errEl.hidden = false; errEl.innerHTML = ''; warnBox(errEl, e && e.message ? e.message : String(e));
        return;
      }
      cardsEl.innerHTML = '';
      show.forEach((k) => {
        const v = metricValue(m, k), b = metricValue(baseM, k);
        cardsEl.appendChild(h('div', { class: 'pxs__card' + (k === chartMetric ? ' is-chart' : '') },
          h('span', { class: 'pxs__ck' }, metricLabel(k, model)),
          h('span', { class: 'pxs__cv mono', title: fMetricExact(k, v) }, fMetric(k, v)),
          h('span', { class: 'pxs__cr mono' + (isChanged(k, v, b) ? ' is-changed' : '') }, fVsBase(k, v, b)),
          metricNote(k, model) ? h('span', { class: 'pxs__cn' }, metricNote(k, model)) : null));
      });
      paintChart(m);
      paintSplit(m);
    }

    function paintChart() {
      chartEl.innerHTML = '';
      const k = knobs.find((x) => x.key === xKnob);
      if (!k || k.values.length < 2) { chartEl.hidden = true; return; }
      chartEl.hidden = false;
      const pts = [];
      k.values.forEach((x) => {
        const o = Object.assign({}, cur, { [k.key]: x });
        const m = safe(() => metrics(config, overrides(o)), null);
        const y = metricValue(m, chartMetric);
        if (y != null && y > 0 && x > 0) pts.push({ x, y, on: x === cur[k.key] });
      });
      const seg = h('div', { class: 'seg pxs__seg', role: 'group', 'aria-label': 'Métrica de la gráfica' }, plottable.map((mk2) =>
        h('button', { type: 'button', 'aria-pressed': String(mk2 === chartMetric), on: { click: () => { chartMetric = mk2; paint(); const b = chartEl.querySelector('[data-m="' + mk2 + '"]'); if (b) b.focus(); } }, dataset: { m: mk2 } }, metricLabel(mk2, model))));
      chartEl.appendChild(h('div', { class: 'pxs__chead' }, h('span', { class: 'px-k' }, metricLabel(chartMetric, model) + ' vs ' + k.label + ' (log-log)'), seg));
      if (pts.length < 2) { chartEl.appendChild(h('p', { class: 'muted small' }, 'No hay suficientes puntos válidos para graficar.')); return; }
      const W = 360, H = 170, L = 52, Rm = 14, T = 12, B = 30;
      const lx = (x) => Math.log(x), xs = pts.map((p) => lx(p.x)), ys = pts.map((p) => Math.log(p.y));
      const x0 = Math.min(...xs), x1 = Math.max(...xs);
      let y0 = Math.min(...ys), y1 = Math.max(...ys);
      if (y1 - y0 < 1e-9) { y0 -= 0.5; y1 += 0.5; }
      const X = (v) => L + ((v - x0) / (x1 - x0 || 1)) * (W - L - Rm);
      const Y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
      const slope = (ys[ys.length - 1] - ys[0]) / ((xs[xs.length - 1] - xs[0]) || 1);
      let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="pxs__svg" role="img" aria-label="' + esc(metricLabel(chartMetric, model) + ' según ' + k.label + ': ' + pts.map((p) => knobShow(k.key, p.x, model) + ' → ' + fMetric(chartMetric, p.y)).join('; ')) + '" preserveAspectRatio="xMidYMid meet">';
      // rejilla y ejes
      svg += '<line x1="' + L + '" y1="' + (H - B) + '" x2="' + (W - Rm) + '" y2="' + (H - B) + '" class="pxs__axis"/>';
      svg += '<line x1="' + L + '" y1="' + T + '" x2="' + L + '" y2="' + (H - B) + '" class="pxs__axis"/>';
      pts.forEach((p) => {
        const px = X(lx(p.x));
        svg += '<line x1="' + px + '" y1="' + T + '" x2="' + px + '" y2="' + (H - B) + '" class="pxs__grid"/>';
        svg += '<text x="' + px + '" y="' + (H - B + 16) + '" class="pxs__tick" text-anchor="middle">' + esc(p.x >= 10000 ? fInt(p.x) : String(p.x)) + '</text>';
      });
      [y0, y1].forEach((v, i) => {
        const val = Math.exp(v);
        svg += '<line x1="' + L + '" y1="' + Y(v) + '" x2="' + (W - Rm) + '" y2="' + Y(v) + '" class="pxs__grid"/>';
        svg += '<text x="' + (L - 6) + '" y="' + (Y(v) + (i ? 9 : -2)) + '" class="pxs__tick" text-anchor="end">' + esc((metricKind(chartMetric) === 'ops') ? fSi(val) : fMetric(chartMetric, val)) + '</text>';   // eje: sin unidad (va en el título)
      });
      svg += '<polyline class="pxs__line" points="' + pts.map((p) => X(lx(p.x)).toFixed(1) + ',' + Y(Math.log(p.y)).toFixed(1)).join(' ') + '"/>';
      pts.forEach((p) => {
        svg += '<circle cx="' + X(lx(p.x)).toFixed(1) + '" cy="' + Y(Math.log(p.y)).toFixed(1) + '" r="' + (p.on ? 5.5 : 3.5) + '" class="pxs__pt' + (p.on ? ' is-on' : '') + '"/>';
      });
      svg += '</svg>';
      chartEl.appendChild(h('div', { class: 'pxs__plot', html: svg }));
      // Pendiente baja ≠ constante: YOLO-World con V de 80 a 1203 sube ×1.09 (solo los términos ∝ V).
      // Se decide por el factor total entre el primer y el último punto, no solo por la pendiente.
      const p0 = pts[0], p1 = pts[pts.length - 1], total = p1.y / p0.y;
      const span = ' de ' + knobShow(k.key, p0.x, model) + ' a ' + knobShow(k.key, p1.x, model);
      const why = slopeWhy(k.key, chartMetric);
      const slopeTxt = Math.abs(total - 1) < 0.0005 ? 'constante: no depende de ' + k.label
        : Math.abs(slope) < 0.1 ? 'crece poco: ' + fFactor(total) + span + (why ? ' — ' + why : '')
        : 'pendiente ≈ ' + slope.toFixed(2) + ' → ' + metricLabel(chartMetric, model) + ' ∝ ' + (k.key === 'res' ? 'res' : (knobDef(k.key, model) || {}).sym || k.key) + '^' + slope.toFixed(1) + ' (×2 en ' + k.label + ' ⇒ ' + fFactor(Math.pow(2, slope)) + ')';
      chartEl.appendChild(h('figcaption', { class: 'pxs__cap mono' }, slopeTxt));
    }

    // Por qué una curva crece poco (knob con efecto pequeño sobre los MACs), según el modelo.
    function slopeWhy(key, metric) {
      if (metricKind(metric) !== 'ops') return '';
      if (key === 'V' && model === 'yolo-world') return 'solo crecen los términos ∝ V: la similitud región-texto de la cabeza y la guía de texto del neck (max-sigmoid e IPA); backbone, convs y cabeza de cajas no dependen de V';
      if (key === 'P' && model === 'sam') return 'solo crecen el prompt encoder y el decoder (P + 1 tokens dispersos); el encoder no ve el prompt y es casi todo el cómputo';
      if (key === 'memFrames' && model === 'sam2') return 'solo crece la memory attention: la cross-attention a la memoria (QKᵀ, A·V) y las proyecciones de K y V, ∝ Nᵣ; Hiera, FPN y decoder no dependen de Nᵣ';
      if (key === 'ptrs' && model === 'sam2') return 'cada puntero agrega solo 4 tokens de memoria frente a los N = 4,096 de cada frame';
      if (key === 'T' && model === 'grounding-dino') return 'solo crecen BERT, la fusión (la matriz h/2×N×T y sus A·V), la cross-attention de texto y los logits Q×T; Swin, la atención deformable y las FFN no dependen de T';
      return '';
    }
    const splitSegments = (m) => splitSegmentsOf(m, model);
    function paintSplit(m) {
      splitEl.innerHTML = '';
      const sp = splitSegments(m);
      const windowed = !!(m && m.windowScoreMacs != null);
      const deform = !!(m && typeof m.samplingMacs === 'number') && !DIFFUSION[model];   // en difusión, samplingMacs = costo por imagen
      // Grounding DINO: el tensor de scores que crece con la imagen es el de la fusión (h/2×N×T).
      const fusionMem = !!(m && typeof m.fusionAttnMem === 'number');
      // Deformable DETR no tiene attnMem (sin matriz N×N): su mayor tensor de scores es el h×Q×Q del decoder.
      // SAM: un bloque global del ViT (h×N×N); SAM 2: la cross-attention a la memoria (1×N×N_m), la que crece con N_r.
      const samMem = model === 'sam' && !!(m && typeof m.globalAttnMem === 'number');
      const sam2Mem = model === 'sam2' && !!(m && typeof m.memCrossAttnMem === 'number');
      const memKey = fusionMem ? 'fusionAttnMem' : deform ? 'decSelfAttnMem' : samMem ? 'globalAttnMem' : sam2Mem ? 'memCrossAttnMem' : 'attnMem';
      const mem = metricValue(m, memKey);
      const detrLike = !deform && !!(m && typeof m.encScoreMacs === 'number');
      if (!sp && mem == null) { splitEl.hidden = true; return; }
      splitEl.hidden = false;
      splitEl.appendChild(h('p', { class: 'px-k' }, sp ? sp.title : 'Dónde se va el cómputo'));
      if (sp) {
        // Un segmento que no llega a 0.05 % se escribe "< 0.1 %" (las cabezas de Grounding DINO), no "0 %".
        const segs = sp.segs.map((x) => { const p = Math.round((x.v / m.macs) * 1000) / 10; return Object.assign({}, x, { pct: p, pctTxt: p === 0 && x.v > 0 ? '< 0.1' : String(p) }); });
        splitEl.appendChild(h('div', { class: 'pxs__bar', role: 'img', 'aria-label': segs.map((x) => x.label.replace(/ \(.*$/, '') + ' ' + x.pctTxt + ' %').join(', ') + ' de los MACs' },
          segs.map((x) => h('span', { class: 'pxs__seg-' + x.cls, style: { width: Math.max(x.pct, 0.5) + '%' } }))));
        const am = typeof m.attnMacsShare === 'number' && !deform && !sp.noAttnNote ? Math.round(m.attnMacsShare * 1000) / 10 : null;
        splitEl.appendChild(h('ul', { class: 'pxs__legend' }, segs.map((x) =>
          h('li', null, h('i', { class: 'pxs__sw pxs__sw--' + x.cls }), h('span', null, x.label + ': '), h('b', { class: 'mono' }, fOps(x.v) + ' · ' + x.pctTxt + ' %')))));
        (sp.extra || []).forEach((t) => splitEl.appendChild(h('p', { class: 'pxs__mem muted small' }, t)));
        if (am != null) splitEl.appendChild(h('p', { class: 'pxs__mem muted small' },
          'Otra métrica, no la confundas: el bloque de atención (con proyecciones Q, K, V, O) es ', h('b', { class: 'mono' }, am + ' %'), ' de los MACs.'));
      }
      if (mem != null) {
        const b = metricValue(baseM, memKey);
        const dense = deform ? metricValue(m, 'denseEncAttnMem') : null;
        splitEl.appendChild(h('p', { class: 'pxs__mem' },
          samMem ? 'Scores de un bloque global del ViT — tensor h×N×N en fp16 (2 bytes), B = 1 (los de un bloque con ventanas, 25×h×196×196, son ' + fBytes(m.winAttnMem) + '): '
            : sam2Mem ? 'Scores de la cross-attention a la memoria — tensor 1×N×Nₘ de una capa (1 cabeza), en fp16 (2 bytes), B = 1; crece con Nᵣ: '
            : windowed ? 'Scores de atención — el mayor tensor nW×h×M²×M² de un bloque, en fp16 (2 bytes), B = 1: '
            : model === 'clip' ? 'Scores de atención — tensor h×N×N de una capa de la torre mayor, en fp16 (2 bytes), una muestra (no depende de B): '
            : fusionMem ? 'Scores de la fusión imagen ↔ texto — tensor h/2×N×T de una capa (uno solo para i2t y t2i), en fp16 (2 bytes), B = 1; crece con N·T (el encoder de imagen es deformable, sin matriz N×N): '
            : detrLike ? 'Scores del encoder — tensor h×N×N de una capa, en fp16 (2 bytes), B = 1 (los de la cross-attention, h×Q×N, son menores): '
            : deform ? 'Scores de la self-attention del decoder — tensor h×Q×Q de una capa, en fp16 (2 bytes), B = 1 (el encoder deformable no tiene matriz N×N): '
            : 'Scores de atención — tensor h×N×N en fp16 (2 bytes), una capa, B = 1: ', h('b', { class: 'mono', title: fInt(mem) + ' bytes' }, fBytes(mem)),
          b ? h('span', { class: 'mono muted' }, ' (' + fFactor(mem / b) + ' vs base)') : null,
          dense != null ? h('span', null, '. Con atención densa sobre los mismos tokens, el encoder pesaría ', h('b', { class: 'mono', title: fInt(dense) + ' bytes' }, fBytes(dense)), ' por capa') : null,
          deform ? '.' : '. FlashAttention no lo materializa completo en memoria.'));
      }
    }

    paintKnobs();
    paint();
    return { el: wrap, destroy() { wrap.remove(); } };
  }

  // Segmentos del reparto de MACs según el modelo. Solo el encoder de DETR (y la atención global de
  // ViT/CLIP) crece ∝ N²: en DETR el decoder (cross ∝ Q·N, self ∝ Q²) va en su propio segmento, y en
  // Deformable DETR la atención es un muestreo disperso (∝ N·hLK), sin matriz N×N en el encoder.
  function splitSegmentsOf(m, model) {
    if (!m || !(m.macs > 0)) return null;
    const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
    const rest = (used, label) => ({ cls: 'l', label, v: Math.max(0, m.macs - used) });
    // Grounding DINO: Swin-T · BERT · feature enhancer · decoder · cabezas (y el resto: proyección de
    // imagen y query selection). Dentro del enhancer se nombran la fusión y el muestreo deformable.
    if (num(m.imgBackboneMacs) != null && num(m.enhancerMacs) != null && num(m.textEncoderMacs) != null) {
      const segs = [
        { cls: 'b', label: 'Backbone de imagen Swin-T (∝ H·W)', v: m.imgBackboneMacs },
        { cls: 't', label: 'Texto: BERT + proyección (∝ T, en cada imagen)', v: m.textEncoderMacs },
        { cls: 'a', label: 'Feature enhancer (6 capas: fusión imagen ↔ texto ∝ N·T, self-attention deformable ∝ N, texto, FFN)', v: m.enhancerMacs },
        { cls: 'd', label: 'Decoder (6 capas sobre las Q queries)', v: num(m.decoderMacs) || 0 },
        { cls: 'h', label: 'Cabezas (contrastiva + cajas)', v: num(m.headMacs) || 0 },
      ];
      const used = segs.reduce((a, x) => a + x.v, 0);
      segs.push(rest(used, 'Resto (proyección de imagen a D y query selection)'));
      const extra = [];
      if (num(m.fusionMacs) != null) extra.push('Dentro del enhancer: fusión imagen ↔ texto ' + fOps(m.fusionMacs) + ' (' + (Math.round((m.fusionMacs / m.macs) * 1000) / 10) + ' % del total)'
        + (num(m.encSamplingMacs) != null ? ', muestreo deformable ' + fOps(m.encSamplingMacs) + ' (' + (Math.round((m.encSamplingMacs / m.macs) * 1000) / 10) + ' %)' : '') + '.');
      return { title: 'Dónde se va el cómputo: Swin-T, BERT, feature enhancer, decoder y cabezas', segs, extra, noAttnNote: true };
    }
    // YOLOv8 / YOLO-World: backbone · neck · cabezas (sin atención densa).
    if (num(m.neckMacs) != null && num(m.backboneMacs) != null && num(m.anchors) != null) {
      const yw = model === 'yolo-world';
      const segs = [
        { cls: 'b', label: 'Backbone CSPDarknet hasta P5 (∝ H·W)', v: m.backboneMacs },
        { cls: 'd', label: yw ? 'Neck RepVL-PAN (T-CSPLayers con max-sigmoid + image-pooling attention; ∝ H·W, la guía de texto ∝ V)' : 'Neck PAN-FPN con C2f (∝ H·W)', v: m.neckMacs },
        { cls: 'h', label: yw ? 'Cabezas en P3–P5: cajas + texto (embedding de región · vocabulario, ∝ A·V)' : 'Cabezas en P3–P5: cajas + clases (∝ A)', v: num(m.headMacs) || 0 },
      ];
      const used = segs.reduce((a, x) => a + x.v, 0);
      if (m.macs - used > 0.0005 * m.macs) segs.push(rest(used, 'Resto'));
      const extra = [];
      if (yw && num(m.fusionMacs) != null) extra.push('Fusión con el texto dentro del neck (max-sigmoid + IPA): ' + fOps(m.fusionMacs) + ' (' + (Math.round((m.fusionMacs / m.macs) * 1000) / 10) + ' %). El codificador de texto (CLIP) corre offline: 0 por imagen.');
      return { title: 'Dónde se va el cómputo: backbone, neck y cabezas', segs, extra, noAttnNote: true };
    }
    const pctOf = (v) => Math.round((v / m.macs) * 1000) / 10;
    // SAM: el encoder (una vez por imagen) frente a lo que corre en cada prompt.
    if (model === 'sam' && num(m.winBlocksMacs) != null && num(m.globalBlocksMacs) != null && num(m.decoderMacsPerPrompt) != null) {
      const segs = [
        { cls: 'b', label: 'Encoder: los ' + m.winBlocks + ' bloques con ventanas 14×14 (∝ N, con el relleno a múltiplos de 14)', v: m.winBlocksMacs },
        { cls: 'a', label: 'Encoder: los ' + m.globalBlocks + ' bloques globales (la atención crece ∝ N²)', v: m.globalBlocksMacs },
        { cls: 't', label: 'Encoder: patch embedding y neck', v: (num(m.patchEmbedMacs) || 0) + (num(m.neckMacs) || 0) },
        { cls: 'd', label: 'Prompt encoder (por prompt)', v: num(m.promptEncMacs) || 0 },
        { cls: 'h', label: 'Decoder de máscaras (por prompt)', v: num(m.maskDecoderMacs) || 0 },
      ];
      const used = segs.reduce((a, x) => a + x.v, 0);
      if (m.macs - used > 0.0005 * m.macs) segs.push(rest(used, 'Resto'));
      const extra = ['El encoder corre una vez por imagen; cada prompt cuesta ' + fOps(m.decoderMacsPerPrompt) + ' (prompt encoder + decoder)'
        + (num(m.breakEvenPrompts) != null ? ': el encoder equivale a ' + fInt(m.breakEvenPrompts) + ' prompts' : '') + '. Con k prompts sobre la misma imagen: ' + fOps(m.encoderMacs) + ' + k × ' + fOps(m.decoderMacsPerPrompt) + '.'];
      return { title: 'Dónde se va el cómputo: encoder (una vez por imagen) vs prompt encoder y decoder (por prompt)', segs, extra, noAttnNote: true };
    }
    // SAM 2: lo que se comparte entre objetos (Hiera + FPN) frente a lo que corre por objeto seguido.
    if (model === 'sam2' && num(m.hieraMacs) != null && num(m.memAttnMacs) != null && num(m.perObjectMacs) != null) {
      const segs = [
        { cls: 'b', label: 'Hiera (una vez por frame; se comparte entre objetos)', v: m.hieraMacs },
        { cls: 't', label: 'FPN y convs de alta resolución (por frame; compartidos)', v: (num(m.fpnMacs) || 0) + (num(m.hiresMacs) || 0) },
        { cls: 'a', label: 'Memory attention (por objeto; la cross-attention a la memoria crece ∝ N·Nₘ)', v: m.memAttnMacs },
        { cls: 'h', label: 'Prompt encoder, decoder, oclusión y puntero (por objeto)', v: (num(m.decoderMacs) || 0) + (num(m.objPtrMacs) || 0) },
        { cls: 'd', label: 'Memory encoder (por objeto)', v: num(m.memEncoderMacs) || 0 },
      ];
      const used = segs.reduce((a, x) => a + x.v, 0);
      if (m.macs - used > 0.0005 * m.macs) segs.push(rest(used, 'Resto'));
      const extra = ['Por objeto seguido: ' + fOps(m.perObjectMacs) + ' (' + pctOf(m.perObjectMacs) + ' % del frame). Con k objetos: ' + fOps(m.imgEncoderMacs) + ' + k × ' + fOps(m.perObjectMacs) + '.'
        + (num(m.memCrossScoreMacs) != null ? ' Dentro de la memory attention, QKᵀ y A·V de la cross-attention a la memoria: ' + fOps(m.memCrossScoreMacs) + ' (' + pctOf(m.memCrossScoreMacs) + ' %).' : '')];
      return { title: 'Dónde se va el cómputo: encoder compartido (por frame) vs la parte por objeto', segs, extra, noAttnNote: true };
    }
    if (num(m.samplingMacs) != null && !DIFFUSION[model]) {
      const samp = m.samplingMacs, dself = num(m.decSelfScoreMacs) || 0;
      return { title: 'Dónde se va el cómputo: atención deformable vs el resto', segs: [
        { cls: 'a', label: 'Muestreo deformable (encoder ∝ N·hLK, cross-attention ∝ Q·hLK; sin matriz N×N; convención del calculador)', v: samp },
        { cls: 'd', label: 'Self-attention del decoder, solo QKᵀ y A·V (∝ Q²)', v: dself },
        rest(samp + dself, 'Todo lo demás (backbone ResNet-50, proyecciones de entrada, offsets, pesos, proyecciones de value y salida, FFN y cabezas; ∝ N en el encoder y el backbone, ∝ Q en el decoder)'),
      ] };
    }
    if (num(m.encScoreMacs) != null && num(m.decCrossScoreMacs) != null) {
      const enc = m.encScoreMacs, dec = m.decCrossScoreMacs + (num(m.decSelfScoreMacs) || 0);
      return { title: 'Dónde se va el cómputo: atención (solo QKᵀ y A·V) del encoder, del decoder y el resto', segs: [
        { cls: 'a', label: 'Encoder, solo QKᵀ y A·V (crece ∝ N²)', v: enc },
        { cls: 'd', label: 'Decoder, solo QKᵀ y A·V (cross ∝ Q·N, self ∝ Q²)', v: dec },
        rest(enc + dec, 'Todo lo demás (backbone ResNet-50, proyección de entrada, proyecciones Q, K, V, O, FFN y cabezas; ∝ N en el encoder y el backbone, ∝ Q en el decoder)'),
      ] };
    }
    const sp = attnSplit(m);
    if (!sp) return null;
    const windowed = m.windowScoreMacs != null;   // Swin: atención por ventanas de tamaño fijo
    return { title: 'Dónde se va el cómputo: atención (solo QKᵀ y A·V) vs el resto', segs: [
      { cls: 'a', label: windowed ? 'Atención, solo QKᵀ y A·V (con ventanas M×M fijas crece ∝ N·M², lineal en N)' : 'Atención, solo QKᵀ y A·V (crece ∝ N²)', v: sp.attn },
      { cls: 'l', label: windowed ? 'Todo lo demás (proyecciones Q, K, V, O, MLP, patch embedding, patch merging y cabeza, ∝ N)'
        : model === 'clip' ? 'Todo lo demás (proyecciones Q, K, V, O, MLP, embeddings de patches y de texto, y proyecciones finales; ∝ N)'
        : model === 'llm' ? 'Todo lo demás (proyecciones Q, K, V, O, FFN SwiGLU y LM head; ∝ T)'
        : 'Todo lo demás (proyecciones Q, K, V, O, MLP, patch embedding y cabeza, ∝ N)', v: sp.linear },
    ] };
  }

  // ================================================================== DIAGRAMA EN BLANCO (§8.1)
  function opTitle(id) { const t = (ATLAS.OP_TYPES || []).find((o) => o.id === id); return t ? t.title : id; }
  function shapeDistractors(t, R, seed) {
    const num = (t.num || []).map(Number);
    const right = shapeKey(num);
    const seen = new Set([right]);
    const r = rng(seed);
    const dims = new Set();
    Object.values(R.tensors || {}).forEach((x) => (x.num || []).forEach((d) => dims.add(Number(d))));
    const rep = (i, v) => num.map((d, j) => (j === i ? v : d));
    const bucket = (arrs) => shuffle(arrs.map(shapeKey).filter((k) => !seen.has(k) && !/(^|×)0(×|$)/.test(k)), r);
    const off1 = bucket([].concat(...num.map((d, i) => (d > 2 ? [rep(i, d - 1), rep(i, d + 1)] : []))));
    const swap = bucket([].concat(...num.map((d, i) => Array.from(dims).filter((v) => v !== d && v > 1).map((v) => rep(i, v)))));
    const trans = num.length >= 2 && num[0] !== num[num.length - 1] ? bucket([num.slice().reverse()]) : [];
    const other = bucket(Object.values(R.tensors || {}).filter((x) => (x.num || []).length === num.length).map((x) => x.num.map(Number)));
    const out = [];
    const take = (b) => { while (b.length) { const k = b.shift(); if (!seen.has(k)) { seen.add(k); out.push(k); return; } } };
    [off1, swap, trans.length ? trans : other, other, swap, off1].forEach(take);
    return out.slice(0, 3);
  }
  function labelPool(model, spec, exceptLabel, configId) {
    const seen = new Set([String(fillLabel(exceptLabel || '', configId)).toLowerCase()]);
    const out = [];
    const ds = [spec].concat(diagramsOf(model).filter((d) => d.id !== spec.id));
    ds.forEach((d) => (d.nodes || []).forEach((n) => {
      const text = fillLabel(n.label || '', configId);
      const k = String(text).toLowerCase();
      if (!n.label || seen.has(k) || n.op === 'io') return;
      seen.add(k); out.push({ id: n.id, text, local: d.id === spec.id });
    }));
    return out;
  }
  function buildSlots(spec, blockSlots, R) {
    const model = spec.model;
    const nodes = spec.nodes || [];
    const out = [];
    (blockSlots || []).forEach((s, i) => {
      const seed = spec.id + ':' + (s.node || s.edge || i);
      const r = rng(seed);
      let slot = null;
      if (s.edge || (s.node && s.ask === 'shape')) {
        let id = s.edge || s.node;
        let tid = s.tensor || null;
        // {node, ask:'shape'} → se pregunta en la arista que lleva ese tensor (sale del nodo), así el
        // diagrama oculta esa etiqueta de forma (que si no, delataría la respuesta).
        // ov (fase 6): la forma de una arista con ov (o que sale de un nodo con ov) se lee de run(config, ov), como la
        // dibuja archdiagram.js: el carril de decode pregunta 8×1×128, no la forma del prefill.
        let ov = null;
        if (!s.edge && s.node) {
          const outs = (spec.edges || []).filter((e) => e.from === s.node && e.tensor && (!tid || e.tensor === tid));
          const e = outs[0] || (tid ? (spec.edges || []).find((x) => x.tensor === tid) : null);
          if (e) { id = edgeKey(e); tid = tid || e.tensor; ov = e.ov || null; }
          const nd = nodes.find((x) => x.id === s.node);
          if (!ov && nd && nd.ov && !e) ov = nd.ov;
        }
        if (s.edge) { const e = (spec.edges || []).find((x) => edgeKey(x) === s.edge); if (e) { tid = tid || e.tensor; ov = e.ov || null; } }
        const Rs = ov ? ovRun(R, ov) : R;
        if (!tid && s.node && Rs) { const op = (Rs.ops || []).filter((o) => o.node === s.node || (o.path || []).indexOf(s.node) >= 0).pop(); if (op) tid = (op.out || [])[0]; }
        const t = Rs && tid ? Rs.tensors[tid] : null;
        if (!t) return;
        const correct = { id: shapeKey(t.num), text: shapeKey(t.num), mono: true };
        const pool = shapeDistractors(t, Rs, seed).map((k) => ({ id: k, text: k, mono: true }));
        slot = { id, ask: 'shape', tensor: tid, correct, pool };
      } else if (s.node) {
        const n = nodes.find((x) => x.id === s.node);
        if (!n) return;
        const ask = s.ask === 'op' ? 'op' : 'label';
        if (ask === 'op') {
          const pool = shuffle((ATLAS.OP_TYPES || []).filter((o) => o.id !== 'io' && o.id !== n.op).map((o) => ({ id: o.id, text: o.title })), r);
          slot = { id: n.id, ask, correct: { id: n.op, text: opTitle(n.op) }, pool };
        } else {
          const cid = R && R.id;
          const pool = labelPool(model, spec, n.label, cid);
          // primero los del mismo diagrama (más difíciles), luego los de otros
          const local = shuffle(pool.filter((p) => p.local), r), other = shuffle(pool.filter((p) => !p.local), r);
          slot = { id: n.id, ask, correct: { id: n.id, text: fillLabel(n.label, cid) }, pool: local.slice(0, 2).concat(other, local.slice(2)) };
        }
      }
      if (!slot) return;
      // Pista opcional del autor (slots:[{…, hint:'…'}]): desambigua huecos con el mismo predecesor; se ve en la
      // lista y en el popover, nunca delata la respuesta por sí sola (la escribe el autor).
      if (typeof s.hint === 'string' && s.hint.trim()) slot.hint = s.hint.trim();
      // Opciones del autor: ids de nodo / op / formas, o textos literales.
      let opts;
      if (Array.isArray(s.options) && s.options.length) {
        opts = s.options.map((o) => {
          if (o && typeof o === 'object') return { id: String(o.id != null ? o.id : o.text), text: String(o.text != null ? o.text : o.id), mono: slot.ask === 'shape' };
          const str = String(o);
          if (slot.ask === 'label') { const n = nodes.find((x) => x.id === str); return n ? { id: n.id, text: fillLabel(n.label, R && R.id) } : { id: 'txt:' + str, text: str }; }
          if (slot.ask === 'op') return { id: str, text: opTitle(str) };
          const k = str.replace(/\s*[x×*]\s*/g, '×');
          return { id: k, text: k, mono: true };
        });
        if (!opts.some((o) => o.id === slot.correct.id)) opts.push(slot.correct);
      } else {
        opts = [slot.correct].concat(slot.pool.slice(0, 3));
      }
      const seenT = new Set();
      opts = opts.filter((o) => { const k = o.text.toLowerCase(); if (seenT.has(k)) return false; seenT.add(k); return true; });
      slot.options = shuffle(opts, rng(seed + ':o'));
      slot.n = out.length + 1;
      out.push(slot);
    });
    // Descripción para la lista (sin delatar la respuesta).
    const blankLabel = {};
    out.forEach((s) => { if (s.ask === 'label') blankLabel[s.id] = s.n; });
    const plain = (t) => (ATLAS.ArchDiagram && typeof ATLAS.ArchDiagram.plainSub === 'function' ? ATLAS.ArchDiagram.plainSub(t) : String(t)).replace(/\n/g, ' ');
    const nameOf = (nid) => (blankLabel[nid] ? 'hueco ' + blankLabel[nid] : '«' + plain(fillLabel((nodes.find((x) => x.id === nid) || {}).label || nid, R && R.id)) + '»');
    // Huecos de nombre: "después de X" (arista de entrada); si otro hueco tiene la misma descripción (dos bloques que
    // salen de «Tokens») o no hay entrada (la máscara entra por control), "antes de Y" (arista de salida). slots[i].desc
    // del autor manda (texto plano, no debe delatar la respuesta).
    const flow = (e) => e.kind !== 'residual' && e.kind !== 'control';
    const after = (sid) => { const inc = (spec.edges || []).find((e) => e.to === sid && flow(e)); return inc ? ' que viene después de ' + nameOf(inc.from) : ''; };
    const before = (sid) => {
      const o = (spec.edges || []).find((e) => e.from === sid && flow(e)) || (spec.edges || []).find((e) => e.from === sid);
      return o ? ' que va antes de ' + nameOf(o.to) : '';
    };
    out.forEach((s) => {
      if (s.ask === 'shape') {
        const [a, b] = String(s.id).split('>');
        s.desc = b ? 'Forma del tensor entre ' + nameOf(a) + ' y ' + nameOf(b) : 'Forma de la salida de ' + nameOf(a);
      } else if (s.ask === 'op') s.desc = 'Tipo de operación de ' + nameOf(s.id);
      else s.desc = 'Nombre del bloque' + (after(s.id) || before(s.id));
      // Descripción del autor en el nodo (blankDesc): gana a la generada (expertos MoE: mismos vecinos).
      const nd = s.ask === 'label' && (spec.nodes || []).find((x) => x.id === s.id);
      if (nd && typeof nd.blankDesc === 'string' && nd.blankDesc.trim()) s.desc = nd.blankDesc.trim();
    });
    const dupDesc = (s) => out.some((x) => x !== s && x.desc === s.desc);
    out.forEach((s) => { if (s.ask === 'label' && dupDesc(s) && before(s.id)) s.desc = 'Nombre del bloque' + before(s.id); });
    // Todavía repetidos (mismos vecinos): se numeran por orden para que la lista nunca muestre dos líneas iguales.
    out.forEach((s) => { if (dupDesc(s)) { const same = out.filter((x) => x.desc === s.desc); same.forEach((x, i) => { x.desc += ' (' + (i + 1) + ' de ' + same.length + ')'; }); } });
    (blockSlots || []).forEach((bs, i) => {
      const id = bs && (bs.edge || bs.node);
      const sl = bs && typeof bs.desc === 'string' && bs.desc.trim() ? out.find((x) => x.id === id || (bs.node && x.id.split('>')[0] === bs.node && x.ask === 'shape' && bs.ask === 'shape')) : null;
      if (sl) sl.desc = bs.desc.trim();
    });
    return out;
  }
  // Clave de respuestas de un bloque (también la usa el hub para contar diagramas completos).
  function blankKey(block) {
    const spec = safe(() => ATLAS.diagram(block.diagram), null);
    if (!spec) return null;
    const cfg = spec.config || canonicalOf(spec.model);
    const R = safe(() => run(cfg), null);
    return { spec, slots: buildSlots(spec, block.slots, R) };
  }
  function blankDone(block, store) {
    const k = blankKey(block);
    if (!k || !k.slots.length) return false;
    const st = sCall(store, 'blankDiagram', k.spec.id) || {};
    const f = st.filled || {};
    return !!st.checkedAt && k.slots.every((s) => f[s.id] === s.correct.id);
  }

  function renderBlank(block, el, ctx) {
    const key = blankKey(block);
    if (!key) throw new Error('No existe el diagrama «' + block.diagram + '».');
    const { spec, slots } = key;
    if (!slots.length) throw new Error('El diagrama en blanco «' + spec.id + '» no tiene huecos válidos (revisa node/edge en slots).');
    const did = spec.id;
    const store = storeOf(ctx);
    const saved = sCall(store, 'blankDiagram', did) || {};
    const filled = {};
    slots.forEach((s) => { const v = (saved.filled || {})[s.id]; if (v != null && s.options.some((o) => o.id === v)) filled[s.id] = v; });
    let checked = !!saved.checkedAt;
    let showSol = false;

    const wrap = h('div', { class: 'pxb' });
    el.appendChild(wrap);
    wrap.appendChild(h('div', { class: 'pxb__head' },
      h('p', { class: 'px-k' }, 'Diagrama en blanco'),
      h('p', { class: 'muted small' }, 'Toca un hueco (o usa la lista) y elige la respuesta. Luego, «Comprobar».')));
    const fig = h('div', { class: 'pxb__fig' });
    wrap.appendChild(fig);
    let dg = null;
    const AD = ATLAS.ArchDiagram;
    if (AD && typeof AD.render === 'function') {
      try {
        dg = AD.render(did, fig, {
          mode: 'blank', wide: !!block.wide, showNumbers: block.showNumbers !== false,
          blank: { slots: slots.map((s) => ({ id: s.id, ask: s.ask, n: s.n, tensor: s.tensor })), onSlot: (sid, anchor) => pick(sid, anchor, anchor) },
        });
      } catch (e) { dg = null; fig.innerHTML = ''; warnBox(fig, 'No se pudo dibujar el diagrama: ' + (e && e.message ? e.message : e) + '. Puedes responder con la lista.'); }
    } else warnBox(fig, 'El componente de diagramas no está cargado; responde con la lista.');

    const list = h('ol', { class: 'pxb__list' });
    const fb = h('p', { class: 'pxb__fb', 'aria-live': 'polite' });
    const btnCheck = h('button', { type: 'button', class: 'btn btn--primary', on: { click: check } }, h('span', { html: icon('check') }), 'Comprobar');
    const btnSol = h('button', { type: 'button', class: 'btn', hidden: true, 'aria-pressed': 'false', on: { click: () => { showSol = !showSol; paint(); } } }, 'Ver solución');
    const btnReset = h('button', { type: 'button', class: 'btn btn--ghost', on: { click: reset } }, h('span', { html: icon('reset') }), 'Vaciar');
    wrap.append(list, h('div', { class: 'pxb__actions' }, btnCheck, btnSol, btnReset), fb);

    const textOf = (s, id) => { const o = s.options.find((x) => x.id === id); return o ? o.text : ''; };
    function state(s) { if (filled[s.id] == null) return 'empty'; if (!checked) return 'filled'; return filled[s.id] === s.correct.id ? 'ok' : 'bad'; }
    const painted = {};   // último estado enviado al diagrama (setSlot redibuja la vista: solo si cambia)
    function paint() {
      list.innerHTML = '';
      let nOk = 0;
      slots.forEach((s) => {
        const st = state(s);
        if (st === 'ok') nOk++;
        const txt = filled[s.id] != null ? textOf(s, filled[s.id]) : '';
        if (dg && typeof dg.setSlot === 'function' && painted[s.id] !== st + '|' + txt) { painted[s.id] = st + '|' + txt; safe(() => dg.setSlot(s.id, txt, st)); }
        const val = filled[s.id] != null ? textOf(s, filled[s.id]) : null;
        const btn = h('button', { type: 'button', class: 'pxb__pick' + (val ? '' : ' is-empty') + (s.ask === 'shape' ? ' mono' : ''), 'aria-haspopup': 'dialog',
          'aria-label': 'Hueco ' + s.n + ': ' + s.desc + '. ' + (s.hint ? 'Pista: ' + s.hint + '. ' : '') + (val ? 'Respuesta: ' + val : 'Sin responder'),
          on: { click: (e) => pick(s.id, e.currentTarget, e.currentTarget) } }, val || 'Elegir…');
        list.appendChild(h('li', { class: 'pxb__row is-' + st, dataset: { slot: s.id } },
          h('span', { class: 'pxb__n mono', 'aria-hidden': 'true' }, String(s.n)),
          h('span', { class: 'pxb__desc' }, s.desc, s.hint ? h('span', { class: 'pxb__hint' }, 'Pista: ' + s.hint) : null),
          btn,
          checked ? h('span', { class: 'pxb__mark', 'aria-hidden': 'true', html: st === 'ok' ? icon('check') : icon('close') }) : null,
          checked && st !== 'ok' && showSol ? h('span', { class: 'pxb__sol' }, 'Correcta: ', h('b', { class: s.ask === 'shape' ? 'mono' : null }, s.correct.text)) : null));
      });
      btnSol.hidden = !checked || nOk === slots.length;
      btnSol.setAttribute('aria-pressed', String(showSol));
      btnSol.textContent = showSol ? 'Ocultar solución' : 'Ver solución';
      if (checked) fb.textContent = nOk === slots.length ? 'Todo correcto: ' + nOk + ' de ' + slots.length + '.' : nOk + ' de ' + slots.length + ' correctos. Corrige los marcados y vuelve a comprobar.';
      else fb.textContent = Object.keys(filled).length ? Object.keys(filled).length + ' de ' + slots.length + ' huecos respondidos.' : '';
      fb.className = 'pxb__fb' + (checked ? (nOk === slots.length ? ' is-ok' : ' is-bad') : '');
    }
    function pick(sid, anchor, returnTo) {
      const s = slots.find((x) => x.id === sid);
      if (!s) return;
      const q = root.CSS && CSS.escape ? CSS.escape(sid) : sid;
      const listBtn = list.querySelector('[data-slot="' + q + '"] .pxb__pick');
      // Tras elegir, el diagrama puede haber redibujado el hueco: se busca de nuevo para devolver el foco.
      const fromDiagram = !!(anchor && fig.contains(anchor));
      const refocus = () => {
        const el2 = fromDiagram ? fig.querySelector('[data-slot="' + q + '"]') : list.querySelector('[data-slot="' + q + '"] .pxb__pick');
        if (el2 && typeof el2.focus === 'function') safe(() => el2.focus({ preventScroll: true }));
      };
      openPicker({
        host: wrap, anchor: anchor || listBtn, returnTo: (returnTo && returnTo.focus ? returnTo : listBtn), refocus,
        title: 'Hueco ' + s.n, subtitle: s.desc, hint: s.hint || null, options: s.options, current: filled[s.id],
        onPick: (id) => {
          if (id == null) delete filled[s.id]; else filled[s.id] = id;
          sCall(store, 'setBlankSlot', did, s.id, id == null ? null : id);
          checked = false; showSol = false;
          paint();
          refocus();
        },
      });
    }
    function check() {
      checked = true;
      const ok = slots.every((s) => filled[s.id] === s.correct.id);
      sCall(store, 'drillResult', 'blank:' + did, { ok, answer: JSON.stringify(filled) });
      // checkedAt: el store lo marca con drillResult('blank:…') o con un método propio.
      sCall(store, 'checkBlankDiagram', did, { ok: slots.filter((s) => filled[s.id] === s.correct.id).length, total: slots.length });
      paint();
    }
    function reset() {
      if (store && typeof store.resetBlankDiagram === 'function') sCall(store, 'resetBlankDiagram', did);
      else slots.forEach((s) => { if (filled[s.id] != null) sCall(store, 'setBlankSlot', did, s.id, null); });
      slots.forEach((s) => { delete filled[s.id]; });
      checked = false; showSol = false;
      paint();
    }
    paint();
    return { el: wrap, destroy() { closePop(false); destroyDg(dg); wrap.remove(); } };
  }

  // ================================================================== DRILLS: formas y parámetros (§8.2)
  const CFG_SYMS = [['H', 'H'], ['W', 'W'], ['C', 'C'], ['P', 'P'], ['D', 'D'], ['L', 'L'], ['h', 'h'], ['Dmlp', 'D_mlp'], ['K', 'K'], ['N', 'N'], ['T', 'T'], ['V', 'V'], ['M', 'M'], ['Q', 'Q'], ['G', 'G']];
  // Datos de la config que necesita un drill de formas: cada símbolo de las formas debe salir de aquí o
  // del texto de la pregunta. DETR: K = clases (los logits son Q×(K+1)), G = objetos anotados del
  // ejemplo, C_5 = canales del mapa C5 del backbone ResNet. Deformable DETR usa la notación del paper:
  // L niveles, K puntos por nivel y K_cls clases.
  // CLIP: los datos dependen de la torre (side = 'img' | 'txt' | 'joint', ver sideOfOps): la de texto
  // tiene su propio ancho D_t, sus cabezas y su MLP; la parte conjunta usa B y E. Swin: cabezas por stage.
  // SAM y SAM 2 usan la notación de su página: cada par es [símbolo, valor, nota?] y la nota se muestra
  // junto al dato ("P = 1 (clic)"): en SAM, P son clics y el patch (16) va aparte; en SAM 2, P son los
  // punteros de objeto (no hay clics en el frame de seguimiento), D y h son los del stage 1 (las formas
  // dicen 2D, 4h…), D_mlp es el MLP de la memory attention (el de Hiera es 4× el ancho del stage).
  function factPairs(cfg, side) {
    const c = cfg || {};
    const pick = (list) => list.filter(([, v]) => v != null);
    if (c.memDim != null && Array.isArray(c.depths)) {
      return pick([['H', c.H], ['W', c.W], ['D', c.D, 'stage 1; luego 2D, 4D, 8D'], ['h', c.h, 'stage 1; luego 2h, 4h, 8h'], ['d_h', c.dh, 'igual en los 4 stages'],
        ['L', c.depths.join(' / '), 'bloques por stage'], ['N', c.N], ['C', c.C], ['C_m', c.memDim], ['N_r', c.memFrames, 'frames recientes'], ['N_p', c.condFrames, 'frames con prompt'],
        ['P', c.ptrs, 'punteros de objeto'], ['L_m', c.Lmem, 'capas de memory attention'], ['D_mlp', c.Dmlp, 'MLP de la memory attention']]);
    }
    if (c.patch != null && c.nTok != null && Array.isArray(c.globals)) {
      return pick([['H', c.H], ['W', c.W], ['patch', c.patch], ['D', c.D], ['L', c.L], ['h', c.h], ['D_mlp', c.Dmlp], ['N', c.N], ['M', c.M, 'ventana'], ['C', c.C],
        ['P', c.P, c.P === 1 ? 'clic' : 'clics']]);
    }
    if (c.Dt != null) {
      if (side === 'txt') return pick([['T', c.T], ['V', c.V], ['D_t', c.Dt], ['h', c.ht], ['D_mlp', c.Dmlpt], ['L_t', c.Lt], ['E', c.E], ['B', c.B]]);
      if (side === 'joint') return pick([['D', c.D], ['D_t', c.Dt], ['E', c.E], ['B', c.B]]);
      return pick([['H', c.H], ['W', c.W], ['P', c.P], ['D', c.D], ['L', c.L], ['h', c.h], ['D_mlp', c.Dmlp], ['N', c.N], ['E', c.E], ['B', c.B]]);
    }
    // Fase 6: un paso de decode (cfg.decode = 1) no usa T (1 token nuevo) sino ctx, el largo de la KV cache que lee.
    const dec = c.decode === 1;
    const out = CFG_SYMS.filter(([k]) => typeof c[k] === 'number' && !(dec && k === 'T')).map(([k, s]) => [s, c[k]]);
    if (dec && typeof c.ctx === 'number') out.push(['ctx', c.ctx, 'KV cache: ctx − 1 filas guardadas + el token nuevo']);
    const has = (sym) => out.some(([x]) => x === sym);
    if (Array.isArray(c.heads) && !has('h')) out.push(['h', c.heads.join(' / ') + ' (por stage)']);
    if (Array.isArray(c.heads) && typeof c.dh === 'number') out.push(['d_h', c.dh]);
    if (typeof c.levels === 'number' && typeof c.points === 'number') {
      if (!has('L')) out.push(['L', c.levels]);
      if (!has('K')) out.push(['K', c.points]);
      if (typeof c.classes === 'number') out.push(['K_cls', c.classes]);
    } else if (typeof c.classes === 'number' && !has('K')) out.push(['K', c.classes]);
    if (typeof c.D === 'number' && Array.isArray(c.widths) && c.widths.length && typeof c.expansion === 'number') out.push(['C_5', c.widths[c.widths.length - 1] * c.expansion]);
    // Fase 11 (retrieval / ANN): candidatos k que devuelve la búsqueda (y que reordena el cross-encoder).
    if (typeof c.k === 'number' && !has('k')) out.push(['k', c.k, 'vecinos / candidatos por consulta']);
    // Retrieval / ANN (cfg.Tq): T es T_q (o el par del cross-encoder), no un símbolo propio de las formas: fuera, salvo en el
    // cross-encoder, donde es el largo del par. En ANN las configs heredan TODOS los knobs de ANN_BASE: solo van los símbolos del
    // tipo de índice (revisión de la fase 11: «M = 32» del HNSW junto a «m = 96» de PQ en la tarjeta de IVF-PQ era una trampa).
    const drop = (sym) => { const i = out.findIndex(([x]) => x === sym); if (i >= 0) out.splice(i, 1); };
    const annKind = typeof c.efSearch === 'number' && ['hnsw', 'ivfpq', 'flat'].indexOf(c.kind) >= 0 ? c.kind : null;
    const retrKind = ['bi', 'cross', 'late'].indexOf(c.kind) >= 0 && typeof c.Td === 'number';   // modelo `retrieval` (el LLM también tiene Tq)
    if ((retrKind || annKind) && !dec) {
      if (c.kind === 'cross' && typeof c.T === 'number') { drop('T'); out.push(['T', c.T, c.pairTrunc ? 'tokens del par, truncado a ' + c.T + ' (el documento entra con ' + c.TdPair + ')' : 'tokens del par: T_q + T_d − 1']); }
      else drop('T');
    }
    if (annKind) {
      drop('M');
      if (!c.encode) ['D', 'L', 'h', 'D_mlp', 'V', 'T_q'].forEach(drop);   // sin encoder: la query entra como vector de d
      const list = [['N', c.N, 'vectores en el índice'], ['d', c.d, 'dimensión de los vectores']];
      if (annKind === 'hnsw') list.push(['M', c.M, 'vecinos por nodo (2M en el nivel 0)'], ['ef', c.efSearch, 'efSearch: candidatos en la búsqueda']);
      if (annKind === 'ivfpq') {
        list.push(['n_list', c.nlist, 'listas (centroides de IVF)'], ['n_probe', c.nprobe, 'listas que se revisan'], ['m', c.m, 'sub-vectores de PQ (no la M de HNSW)'], ['k_s', c.ksub, 'centroides por sub-espacio (2^nbits)'], ['n_scan', c.scanned, 'vectores que se recorren ≈ n_probe·N/n_list']);
        if (c.coarseM) list.push(['M', c.coarseM, 'HNSW sobre los centroides: vecinos por nodo'], ['ef', Math.max(c.coarseEf, c.nprobe), 'HNSW sobre los centroides: efSearch (candidatos)']);
      }
      list.forEach(([sym, v, n]) => { if (typeof v === 'number' && !has(sym)) out.push([sym, v, n]); });
    }
    if (typeof c.dim === 'number' && !has('dim') && c.kind !== 'cross') out.push(['dim', c.dim, 'dimensión del embedding']);   // el cross-encoder no guarda embeddings
    // T_q solo en retrieval / ANN con encoder (el LLM también tiene cfg.Tq = filas de query, que en sus formas es T).
    if (typeof c.Tq === 'number' && !has('T_q') && (retrKind || (annKind && c.encode))) out.push(['T_q', c.Tq, 'tokens de la consulta']);
    if (typeof c.Td === 'number' && !has('T_d')) out.push(['T_d', c.Td, 'tokens del documento']);
    // Reranker en cascada (otro ancho que el bi-encoder): sus dimensiones van con _r (las pone el calculador al importarlo).
    if (c.rerank && c.reranker) { const rr = safe(() => run(c.reranker), null); const rc = rr && rr.config;
      if (rc) [['D_r', rc.D, 'ancho del reranker'], ['h_r', rc.h], ['d_r', rc.D && rc.h ? rc.D / rc.h : null], ['D_mlp,r', rc.Dmlp], ['V_r', rc.V]]
        .forEach(([sym, v, n]) => { if (typeof v === 'number' && !has(sym)) out.push([sym, v, n]); }); }
    // Fase 10 (fine-tuning): rango y escala del adapter, ancho de K/V; en RLHF G son las cabezas KV (no el grupo de GRPO, que en
    // las formas es n_G = cfg.groupSize: js/arch/finetune.js). r / α solo cuando HAY adapter: el full FT tiene r = α = 0 (α/r
    // daría NaN) y las configs de RLHF sin LoRA (lora = 0) arrastran r 16 / α 32 de RL_BASE sin usarlos.
    const hasAdapter = c.r > 0 && c.full !== 1 && (c.lora === undefined || c.lora === 1);
    if (hasAdapter && c.alpha > 0 && !has('r')) out.push(['r', c.r, 'rango del adapter'], ['α', c.alpha, 'escala α/r = ' + String(+(c.alpha / c.r).toFixed(3))]);
    if (c.method === 'grpo' && c.groupSize != null && !has('n_G')) out.push(['n_G', c.groupSize, 'respuestas por prompt (la G de GRPO)']);
    if (c.Dkv != null && !has('D_kv')) out.push(['D_kv', c.Dkv, 'n_KV·d_h: salida de W_K y W_V']);
    if (c.Tp != null && !has('T_p')) out.push(['T_p', c.Tp, 'tokens del prompt'], ['T_r', c.Tr, 'tokens de la respuesta']);
    if (c.method && c.G != null) { const i = out.findIndex(([x]) => x === 'G'); if (i >= 0) out[i] = ['G', c.G, 'cabezas KV del decoder']; }
    // Fase 8 (difusión): canales del VAE / texto (SD), torres de texto (SDXL), tamaño de entrada I (DiT).
    // T y K con nota: en estas páginas T = 1,000 son también los pasos de ruido y K = 1,000 se confunde con ellos.
    const noteOf = (sym, note) => { const i = out.findIndex(([x]) => x === sym); if (i >= 0 && out[i].length < 3) out[i] = [out[i][0], out[i][1], note]; };
    if (c.Cv != null) noteOf('T', 'tokens de texto de CLIP (no los ' + fInt(c.trainSteps || 1000) + ' pasos de ruido)');
    if (c.I != null) noteOf('K', 'clases de ImageNet (tabla de K + 1 con la clase nula)');
    if (c.I != null && !has('I')) out.push(['I', c.I, 'lado del latente']);
    if (c.Cv != null && !has('C_v')) out.push(['C_v', c.Cv, 'canales del VAE']);
    if (c.Dtxt != null && !has('D_t')) out.push(['D_t', c.Dtxt, 'ancho del texto (cross-attention)']);
    if (c.ht) [['h_t', c.ht, 'cabezas del text encoder'], ['d_t', c.dt], ['L_t', c.Lt, 'capas del text encoder']].forEach(([sym, v, n]) => { if (v != null && !has(sym)) out.push([sym, v, n]); });
    if (c.headDim && !has('d_h')) out.push(['d_h', c.headDim, 'dim. por cabeza']);
    (Array.isArray(c.towers) ? c.towers : []).forEach((tw, i) => { out.push(['D_' + (i + 1), tw.D, 'text encoder ' + (i + 1)], ['h_' + (i + 1), tw.h], ['d_' + (i + 1), tw.D / tw.h]); });
    // Fase 9 (VLA): OpenVLA (c.Dd) tiene DOS torres (DINOv2 D_d…, SigLIP D_s…) cuyas features se concatenan (D_v = D_d + D_s);
    // π0 (c.Da) tiene SigLIP por cámara + Gemma + el experto de acción (D_a, con las mismas h, G y d_h que Gemma) y el chunk
    // H_a (knob `H`: cfg.Ha). OJO: en las dos configs H = 224 es el ALTO de la imagen, no el chunk.
    const vla = c.Dd != null || c.Da != null;
    const push = (list) => list.forEach(([sym, v, note]) => { if (v != null && !has(sym)) out.push(note ? [sym, v, note] : [sym, v]); });
    if (vla) {
      noteOf('H', c.Da != null ? 'alto de la imagen; el chunk es H_a' : 'alto de la imagen');
      if (c.Da != null) noteOf('N', c.cams > 1 ? 'tokens de imagen de las ' + c.cams + ' cámaras = ' + c.cams + '·N_p' : 'tokens de imagen de 1 cámara');
      else noteOf('N', 'tokens visuales: N_p por imagen');
      noteOf('T', c.Da != null ? 'tokens de texto, relleno incluido' : 'tokens de texto, con <BOS>');
      noteOf('D', c.Da != null ? 'ancho de Gemma 2B' : 'ancho de Llama 2 7B');
      noteOf('D_mlp', c.Da != null ? 'FFN de Gemma' : 'MLP de Llama');
      push([['d_h', c.dh, c.Da != null ? 'dim. por cabeza, igual en Gemma y en el experto' : 'dim. por cabeza del LLM']]);
      if (c.Dd != null) {
        push([['N_p', c.Np, 'parches de UNA imagen, sin CLS ni registros'],
          ['D_d', c.Dd, 'ancho de DINOv2'], ['h_d', c.hd, 'cabezas de DINOv2'], ['d_d', c.dd, 'dim. por cabeza de DINOv2'], ['L_d', c.Ld, 'capas de DINOv2'],
          ['D_s', c.Ds, 'ancho de SigLIP'], ['h_s', c.hs, 'cabezas de SigLIP'], ['d_s', c.ds, 'dim. por cabeza de SigLIP'], ['M_s', c.Ms, 'MLP de SigLIP, no 4D_s'], ['L_s', c.Ls, 'capas de SigLIP'],
          ['D_v', c.Dv, 'D_d + D_s: features fusionadas de las dos torres'], ['d_a', c.da, 'dimensiones de la acción = tokens por paso']]);
      } else {
        push([['N_p', c.Np, 'parches por cámara'],
          ['D_s', c.Ds, 'ancho de SigLIP'], ['h_s', c.hs, 'cabezas de SigLIP'], ['d_s', c.ds, 'dim. por cabeza de SigLIP'], ['M_s', c.Ms, 'MLP de SigLIP, no 4D_s'], ['L_s', c.Ls, 'capas de SigLIP'],
          ['D_a', c.Da, 'ancho del experto de acción; su FFN es 4D_a = ' + (c.Dmlpa || 4 * c.Da)], ['H_a', c.Ha, 'acciones por chunk: el knob H'],
          ['d_a', c.da, 'dim. de la acción y del estado, con relleno']]);
      }
    }
    // Fase 7 (VLMs): la torre de visión tiene sus propios símbolos (D_v, h_v…) además de los del LLM.
    if (typeof c.Dv === 'number' && !vla) {
      [['D_v', c.Dv, 'ancho de la torre de visión'], ['h_v', c.hv, 'cabezas de la torre de visión'], ['d_v', c.dv, 'dim. por cabeza de la visión'],
        ['L_v', c.Lv, 'capas de la torre de visión'], ['N_p', c.Np, c.frames > 1 ? 'patches del video entero (todos los pares de frames)' : c.images != null ? 'patches de UNA imagen (sin CLS)' : 'patches de la imagen'], ['F', c.F, 'frames']]
        .forEach(([sym, v, note]) => { if (typeof v === 'number' && !has(sym)) out.push([sym, v, note]); });
    }
    return out;
  }
  // Torre de las ops (CLIP): 'img' (img-encoder, img-proj…), 'txt' (txt-…) o 'joint' (similitud, pérdida, lote).
  function sideOfOps(ops) {
    const heads = (ops || []).map((o) => String(((o && o.path) || [])[0] || ''));
    if (!heads.length) return null;
    if (heads.every((p) => /^txt/.test(p))) return 'txt';
    if (heads.every((p) => /^img/.test(p))) return 'img';
    return heads.some((p) => /^(txt|img)/.test(p)) ? null : 'joint';
  }
  // Torre de un drill (forma: la op que produce el tensor; parámetros: las ops del nodo).
  function drillSide(R, cand) {
    if (!R || !cand) return null;
    if (cand.kind === 'shape') {
      const t = R.tensors[cand.tensor];
      const op = t && (R.ops || []).find((x) => x.id === t.producer);
      return op ? sideOfOps([op]) : null;
    }
    const np = safe(() => nodeParams(R, cand.model, cand.node), null);
    return np ? sideOfOps(np.ops) : null;
  }
  function cfgFacts(cfg, side) {
    // Dimensiones sin separador de miles (D_mlp = 3072), como en las formas y en {{cfg.*}}.
    const dim = (v) => (typeof v !== 'number' ? String(v) : Number.isInteger(v) && Math.abs(v) < 10000 ? String(v) : fInt(v));
    return factPairs(cfg, side).map(([s, v, note]) => h('span', { class: 'pxd__fact mono' }, s + ' = ' + dim(v), note ? h('span', { class: 'pxd__fnote' }, ' (' + note + ')') : null));
  }
  // ------------------------------------------------------------------ drills de parámetros
  // Un drill de parámetros pregunta por un nodo de un diagrama y su respuesta es EXACTAMENTE lo que ese
  // diagrama muestra para el nodo (archdiagram.js nodeOps/nodeCost; blocks.js opsOfNode): las ops se
  // eligen con node.ops, costOf, scope y opsExact, porque desde la fase 2 hay ids de nodo repetidos (las
  // dos torres de CLIP, W-MSA y SW-MSA en Swin). Por instancia si todas las ops se repiten igual (una
  // capa, un par de bloques); el total (Σ op × repeat) si mezclan repeticiones (una torre entera). Los
  // grupos con repeat.totalOf preguntan por el total que el diagrama escribe ("= 85.1 M en total").
  function opsOfDiagramNode(R, n) {
    const ids = n.ops || [];
    const pid = n.costOf || n.id;
    return (R.ops || []).filter((o) => ids.indexOf(o.id) >= 0 || (!n.opsExact && o.path && o.path.indexOf(pid) >= 0 && (!n.scope || o.path.indexOf(n.scope) >= 0)));
  }
  // ref: {diagram, node} | {diagram, group} | id de nodo (el primer diagrama del modelo que lo tiene) |
  // {op}: una op hoja cuyo nodo no está en ningún diagrama (única op con ese nodo).
  function locateParamsNode(model, R, ref) {
    // vistas de la config de la corrida primero (fase 10: ppo-step vs dpo-step); si ninguna tiene el nodo, todas (como antes).
    const cfgId = R && (R.id || (R.config && R.config.id));
    const dsC = cfgId ? diagramsOf(model, cfgId) : [];
    const ds = dsC.concat(diagramsOf(model).filter((d) => dsC.indexOf(d) < 0));
    if (ref && typeof ref === 'object' && ref.op) {
      const op = (R.ops || []).find((o) => o.id === ref.op);
      return op ? { op, ops: [op] } : null;
    }
    const r = typeof ref === 'string' ? { node: ref } : (ref || {});
    const list = r.diagram ? ds.filter((d) => d.id === r.diagram) : ds;
    for (const d of list) {
      if (r.node) {
        const n = (d.nodes || []).find((x) => x && x.id === r.node && x.op !== 'io');
        if (n) return { diagram: d, node: n, ops: opsOfDiagramNode(R, n) };
      }
      const gid = r.group || (typeof ref === 'string' ? ref : null);
      if (gid) {
        const g = (d.groups || []).find((x) => x && x.id === gid);
        const tn = g && g.repeat && g.repeat.totalOf && (d.nodes || []).find((x) => x && x.id === g.repeat.totalOf);
        if (tn) return { diagram: d, group: g, node: tn, ops: opsOfDiagramNode(R, tn) };
      }
    }
    return null;
  }
  // Contexto común de las ops (op.where del calculador): ['Stage 2', 'bloque 1 (W-MSA)'] o ['Torre de texto'].
  function commonWhere(ops) {
    const ws = ops.map((o) => (Array.isArray(o.where) ? o.where : []));
    if (!ws.length || ws.some((w) => !w.length)) return [];
    const out = [];
    for (let i = 0; i < ws[0].length; i++) { const v = ws[0][i]; if (ws.every((w) => w[i] === v)) out.push(v); else break; }
    return out;
  }
  // Etiqueta de diagrama como texto plano (el prompt escapa HTML y no compone TeX): 'q_{pos}' y
  // 'q_{\\mathrm{pos}}' → 'q_pos'.
  const plainLabel = (t) => String(t == null ? '' : t).replace(/\n/g, ' ')
    .replace(/_\{\\(?:mathrm|text|rm)\{([^{}]*)\}\}/g, '_$1').replace(/_\{([^{}\\]*)\}/g, '_$1')
    .replace(/\s+/g, ' ').trim();
  // Etiqueta de diagrama con {{…}} del calculador ('LLM decoder ({{cfg.llmLabel}})') → texto plano con los valores de la
  // config del drill (sin HTML ni entidades: el prompt escapa al mostrar).
  const unent = (x) => x.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  function fillLabel(t, configId) {
    const s0 = String(t == null ? '' : t);
    if (s0.indexOf('{{') < 0 || !configId) return s0;
    return unent(fill(s0, { config: configId }).replace(/<[^>]*>/g, ''));
  }
  // Copias de los pesos de una op (op.paramRepeat, fase 7: LLaVA con varias imágenes corre la torre `images` veces con los
  // mismos pesos); por defecto op.repeat.
  const pRep = (o) => (o && o.paramRepeat != null ? o.paramRepeat : (o && o.repeat) || 1);
  function nodeParams(R, model, ref, raw) {
    const loc = locateParamsNode(model, R, ref);
    if (!loc || !loc.ops.length) return null;
    const all = loc.ops;
    const ops = all.filter((o) => (o.params || 0) > 0);
    if (!ops.length) return null;
    // Pesos compartidos con otro nodo (torre siamesa de SBERT: paramRepeat 0): el diagrama no muestra badge, no hay drill.
    if (all.every((o) => pRep(o) === 0)) return null;
    // repeticiones de los PESOS (paramRepeat): con pesos compartidos (LLaVA con varias imágenes) no es el repeat de los MACs
    const rep = Math.max(...all.map(pRep));
    const mixed = all.some((o) => pRep(o) !== rep);
    const group = !!loc.group;
    const whole = group || mixed;                 // total del modelo para ese bloque (Σ op × paramRepeat)
    const times = (o) => (whole ? pRep(o) : 1);
    const total = ops.reduce((a, o) => a + o.params * times(o), 0);
    // Errores típicos de conteo: olvidar los biases de linear/conv, o los γ y β de LayerNorm.
    const biasOf = (o) => (o.detail && o.detail.bias ? (o.detail.dout || o.detail.cout || 0) : 0);
    const biases = ops.reduce((a, o) => a + biasOf(o) * times(o), 0);
    const lnParams = ops.filter((o) => o.prim === 'layernorm' || o.prim === 'rmsnorm').reduce((a, o) => a + o.params * times(o), 0);
    // Unidad de repetición: Swin repite PARES de bloques (W-MSA + SW-MSA); el resto, capas. El símbolo
    // sale de la torre (CLIP: L para la imagen, L_t para el texto), nunca de cfg.L a ciegas.
    // Grounding DINO lleva un Swin-T de backbone (cfg.stages), pero sus capas de BERT, del enhancer y del
    // decoder son capas, no pares: la unidad "par" solo vale para las ops de Swin (modelo swin o img-backbone).
    const cfg = R.config || {};
    const isSwin = Array.isArray(cfg.stages) && (model === 'swin' || all.every((o) => ((o.path || [])[0]) === 'img-backbone'));
    const blockOf = (o) => (Array.isArray(o.where) ? o.where.find((w) => /^bloque /.test(String(w))) : null) || '';
    const blocks = new Set(all.map(blockOf));
    const pairUnit = isSwin && (blocks.size > 1 || group);
    const inPath = (id) => all.every((o) => (o.path || []).indexOf(id) >= 0);
    const txt = all.some((o) => (o.path || []).indexOf('txt-encoder') >= 0) || inPath('txt-backbone');
    // Símbolo del número de capas (CLIP: L_t en la torre de texto; DETR: L_enc / L_dec; Grounding DINO:
    // L_t en BERT, L_enc en el feature enhancer, L_dec en el decoder).
    const towerL = cfg.Ld != null && inPath('dinov2') ? ['L_d', cfg.Ld] : cfg.Ls != null && cfg.Lv == null && inPath('siglip') ? ['L_s', cfg.Ls] : null;
    const layerSym = txt ? (cfg.Lt != null ? ['L_t', cfg.Lt] : null)
      : cfg.Lenc != null && (inPath('encoder') || inPath('enhancer')) ? ['L_enc', cfg.Lenc]
      : cfg.Ldec != null && inPath('decoder') ? ['L_dec', cfg.Ldec]
      // Fase 7 (VLM): la torre de visión tiene su propio número de capas (L_v), distinto del L del LLM.
      : cfg.Lv != null && inPath('vision-encoder') ? ['L_v', cfg.Lv]
      // Fase 9 (VLA): torres de OpenVLA (DINOv2 L_d, SigLIP L_s) y la SigLIP de π0 (L_s).
      : towerL ? towerL
      : cfg.L != null && !isSwin ? ['L', cfg.L] : null;
    const sym = layerSym && layerSym[1] === rep ? layerSym[0] + ' = ' + rep : '' + rep;
    // ¿El repeat mayor es de verdad el número de capas? (En el backbone ResNet de DETR el mayor repeat
    // es el de los bottlenecks de un stage: 5 en layer3, que no son "capas" del bloque.)
    const repIsLayers = layerSym && layerSym[1] === rep;
    let qual = '';
    if (group) qual = isSwin ? ' (el stage completo: los ' + rep + ' pares)' : repIsLayers ? ' (completo: las ' + sym + ' capas)' : ' (completo)';
    else if (mixed) qual = isSwin ? '' : repIsLayers ? ' (entero: con las ' + sym + ' capas)' : ' (entero)';
    else if (rep > 1) qual = isSwin
      ? (pairUnit ? ' (una sola pareja de bloques; hay ' + rep + ')' : ' (un solo bloque; el stage tiene ' + rep + ' pares)')
      : ' (una sola capa; hay ' + sym + ')';
    // LLaVA: la capa repetida del ViT cuenta L_v − 1 = 23 (hasta la penúltima, de donde salen las features); la 24 es otra
    // op (la que HF calcula y descarta). Todas tienen los mismos parámetros: la pregunta es por UNA capa de las L_v = 24.
    const vlmVis = cfg.Lv != null && inPath('vision-encoder');
    if (vlmVis && !group && !mixed && rep === cfg.Lv - 1) qual = ' (una sola capa; la torre tiene L_v = ' + cfg.Lv + ': las ' + rep + ' hasta la penúltima, de donde salen las features, y la ' + cfg.Lv + ', que HF calcula y descarta)';
    // OpenVLA: las torres corren L_d − 1 = 23 (DINOv2) y L_s − 1 = 26 (SigLIP) capas repetidas; la última es otra op
    // (dino-last-layer / sig-last-layer, con los mismos parámetros, γ₁ y γ₂ incluidos) que se calcula y se descarta.
    if (towerL && !group && !mixed && rep === towerL[1] - 1) qual = ' (una sola capa; la torre tiene ' + towerL[0] + ' = ' + towerL[1] + ': las ' + rep + ' hasta la penúltima, de donde salen las features, y la ' + towerL[1] + ', que se calcula y se descarta)';
    if (vlmVis && !group && mixed && model === 'llava') qual = ' (entero: embeddings, las L_v = ' + cfg.Lv + ' capas —también la ' + cfg.Lv + ', que se descarta— y ln_post)';
    // Nombre: el del diagrama (o el de la op hoja), con el contexto que falte (stage/bloque, torre).
    // node.drillLabel / group.drillLabel: nombre para el drill cuando la etiqueta del diagrama es corta ('Clase').
    let base = plainLabel(fillLabel(loc.group ? (loc.group.drillLabel || loc.group.label || loc.node.label) : loc.node ? (loc.node.drillLabel || loc.node.label) : loc.op.label, R.id));
    const low = (x) => String(x).toLowerCase();
    // Sin paréntesis ni puntuación al comparar: 'Backbone (ResNet-50)' ya está en 'Backbone ResNet-50'.
    const norm = (x) => low(x).replace(/[()[\],:·]/g, ' ').replace(/\s+/g, ' ').trim();
    let ctxParts = commonWhere(all).filter((w) => norm(base).indexOf(norm(w)) < 0);
    // "Patch merging" con contexto "Patch merging 2 (stage 2 → 3)": basta el contexto.
    // También "Imagen → texto" con contexto "fusión: imagen → texto" (Grounding DINO): basta el contexto.
    // Y "Patch merging (concat 2×2 → …)" con contexto "Patch merging 1 (stage 1 → 2)" (op suelta de Grounding DINO).
    const headOf = (x) => norm(x).replace(/\s+\d+(\s.*)?$/, '');
    const leadOf = () => ctxParts.findIndex((w) => low(w).indexOf(low(base)) === 0 || (' ' + norm(w) + ' ').indexOf(' ' + norm(base) + ' ') >= 0
      || (/\d/.test(w) && headOf(w) === norm(String(base).replace(/\s*\(.*\)$/, ''))));
    const lead = leadOf();
    if (lead >= 0) { base = ctxParts[lead]; ctxParts = ctxParts.filter((_, i) => i !== lead); }
    // "W-MSA" con contexto "bloque 1 (W-MSA)": el paréntesis del contexto sobra ("bloque 1 · W-MSA").
    ctxParts = ctxParts.map((w) => { const pm = w.match(/^(.*\S)\s*\(([^()]*)\)$/); return pm && norm(pm[2]) === norm(base) ? pm[1] : w; });
    // "LayerNorm 1 (W-MSA)" con contexto "bloque 1 (W-MSA)": el paréntesis sobra.
    // La primera palabra del paréntesis tiene que estar en el contexto como palabra entera y con letras:
    // "Conv 3×3 stride 2 (1 → 4)" con contexto "downsampler de la máscara (÷16)" conserva su paréntesis.
    const par = ctxParts.length ? base.match(/^(.*\S)\s*\(([^()]*)\)$/) : null;
    const tok0 = par ? par[2].split(/[ ,:]/)[0] : '';
    const wordIn = (hay, w) => new RegExp('(^|[^\\p{L}\\p{N}])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^\\p{L}\\p{N}])', 'iu').test(hay);
    if (par && /\p{L}/u.test(tok0) && wordIn(ctxParts.join(' '), tok0)) {
      base = par[1];
      // "Self-attention (texto)" con contexto "texto: self-attention": sin el paréntesis, basta el contexto.
      const l2 = leadOf();
      if (l2 >= 0) { base = ctxParts[l2]; ctxParts = ctxParts.filter((_, i) => i !== l2); }
    }
    // Fase 6: la etiqueta del diagrama contradice al calculador en otra config ("FFN SwiGLU" con el contexto "FFN MoE (8
    // expertos, top-2)" en Mixtral; "Atención GQA" con "atención MHA (…)" en Llama 2 7B): misma primera palabra y alguna
    // otra palabra de la etiqueta que el contexto no tiene → manda el contexto (sale de la config).
    if (model === 'llm' && ctxParts.length && !loc.group) {
      const lastCtx = ctxParts[ctxParts.length - 1];
      const wb = norm(base).split(' '), wc = norm(lastCtx).split(' ');
      if (wb.length > 1 && wb[0] === wc[0] && wb.slice(1).some((w) => !wordIn(lastCtx, w))) { base = lastCtx; ctxParts = ctxParts.slice(0, -1); }
    }
    // Fase 7 (VLM): un grupo repetido (todas las capas del ViT o del LLM) se nombra por lo que cuenta exactamente: solo las
    // capas, sin lo que el resto de la página llama "el ViT" (patchify + capas + merger, ≈ 675M) o "el LLM" (con embedding
    // y LM head). Sin contexto: el nombre ya lo dice todo.
    if (group && !mixed && cfg.Lv != null && !loc.group.drillLabel && (vlmVis || inPath('llm'))) {
      ctxParts = [];
      if (vlmVis) {
        base = 'Encoder de visión';
        qual = ' (solo las ' + sym + ' capas del ViT, ' + (model === 'llava' ? 'sin patch embedding, CLS, posición ni la capa ' + cfg.Lv + ')' : 'sin patchify ni merger)');
      } else {
        base = 'LLM decoder' + (cfg.llmLabel ? ' (' + cfg.llmLabel + ')' : '');
        qual = ' (solo las ' + sym + ' capas, sin embedding, norma final ni LM head)';
      }
    }
    let label = (ctxParts.length ? ctxParts.join(' · ') + ' · ' : '') + base;
    // Revisión de la fase 8: dos nodos del MISMO diagrama con la misma etiqueta ('Conv 3×3' dos veces en el bloque ResNet) darían
    // la misma pregunta con respuestas distintas: se numeran por su orden en el diagrama ('Conv 3×3 (1)', '(2)').
    if (!raw && loc.node && !loc.group && loc.diagram) {
      const rawOf = (n) => plainLabel(fillLabel(n.drillLabel || n.label, R.id));
      const mine = rawOf(loc.node);
      const same = (loc.diagram.nodes || []).filter((n) => n && n.id && n.op !== 'io' && rawOf(n) === mine);
      if (same.length > 1) {
        const clash = same.filter((n) => {
          if (n === loc.node) return true;
          const o = safe(() => nodeParams(R, model, { diagram: loc.diagram.id, node: n.id }, true), null);
          return o && o.label + o.qual === label + qual && o.total !== total;
        });
        if (clash.length > 1) label += ' (' + (clash.indexOf(loc.node) + 1) + ')';
      }
    }
    return { ops, total, group: whole, perLayer: !whole && rep > 1, repeat: rep, biases, lnParams, label, qual,
      unit: pairUnit ? 'par' : isSwin ? 'bloque' : 'capa', diagram: loc.diagram ? loc.diagram.id : null,
      node: loc.node ? loc.node.id : null };
  }
  // Califica un conteo de parámetros (SPEC §8.2). Exacto = correcto. Redondeado = correcto si cuadra
  // hasta la última cifra escrita (máx. ±1 %). Pero la tolerancia nunca llega a la mitad de los biases:
  // una respuesta sin biases (7,077,888 en vez de 7,087,872) es un error, aunque esté a 0.14 %.
  function gradeParams(str, np) {
    const p = parseNum(str);
    if (!p) return null;
    const E = np.total, n = p.v, diff = Math.abs(n - E);
    const slips = [
      { n: np.biases, what: 'los biases' },
      { n: np.lnParams, what: 'los parámetros de LayerNorm (γ y β)' },
      { n: np.biases + np.lnParams, what: 'los biases y los γ, β de LayerNorm' },
    ].filter((x, i, a) => x.n > 0 && x.n < E && a.findIndex((y) => y.n === x.n) === i);
    const strict = np.biases > 0 ? Math.min(0.001 * E, np.biases / 2) : 0.001 * E;
    const rounded = p.half > 0.5 ? Math.min(p.half, 0.01 * E) : 0;
    const tol = Math.max(0.5, strict, rounded);
    // ¿Coincide con "E menos algo que se suele olvidar", con una precisión que sí lo distingue?
    const prec = Math.max(0.5, rounded);
    const slip = slips.find((x) => prec <= x.n / 2 && Math.abs(n - (E - x.n)) <= prec && Math.abs(n - (E - x.n)) < diff);
    if (slip) return { ok: false, slip, value: n };
    if (diff <= 0.5) return { ok: true, exact: true, value: n };
    if (diff <= tol) {
      // Redondeo que no distingue "con" de "sin" biases: correcto, con aviso en la explicación.
      const amb = slips.find((x) => Math.abs(n - (E - x.n)) <= Math.max(prec, strict));
      return { ok: true, exact: false, amb: amb || null, value: n };
    }
    return { ok: false, value: n };
  }
  // Candidatos de parámetros de una config: cada nodo (no io) de cada diagrama del modelo, cada grupo con
  // repeat.totalOf (si se repite más de una vez) y, para ops hoja con params cuyo nodo no está en ningún
  // diagrama, la op (solo si es la única con ese nodo; id cfg:<nodo>:params, como antes). Sin duplicados (mismas ops, misma unidad, mismo
  // nombre). Id estable: cfg:<nodo>:params; si el id de nodo se repite entre diagramas, cfg:<diagrama>><nodo>:params.
  function paramsCandidates(src, cfg, R) {
    const ds = diagramsOf(src.model, cfg);
    const count = {};
    ds.forEach((d) => { (d.nodes || []).concat(d.groups || []).forEach((n) => { if (n && n.id) count[n.id] = (count[n.id] || 0) + 1; }); });
    const out = [], seen = new Set(), seenOps = new Set();
    const push = (ref, key) => {
      const np = nodeParams(R, src.model, ref);
      if (!np || !(np.total > 0)) return;
      const opSig = np.ops.map((o) => o.id).sort().join(',') + '|' + np.group;
      const sig = opSig + '|' + np.label;
      // una op hoja que ya pregunta un nodo de diagrama (mismas ops con params) no se repite; tampoco un nodo que toma
      // el costo de otro (costOf) con las mismas ops y la misma unidad (fase 6: "L capas, T tokens" / "L capas, 1 token"
      // de la inferencia = el bloque decoder).
      const borrowed = ref.node && ref.diagram && safe(() => ((ATLAS.diagram(ref.diagram).nodes || []).find((x) => x.id === ref.node) || {}).costOf, null);
      if (seen.has(sig) || ((ref.op || borrowed) && seenOps.has(opSig))) return;
      seen.add(sig); seenOps.add(opSig);
      out.push({ kind: 'params', model: src.model, pageId: src.pageId, config: cfg, node: ref, id: cfg + ':' + key + ':params' });
    };
    const key = (d, id) => (count[id] > 1 ? d.id + '>' + id : id);
    ds.forEach((d) => {
      (d.nodes || []).forEach((n) => { if (n && n.id && n.op !== 'io') push({ diagram: d.id, node: n.id }, key(d, n.id)); });
      (d.groups || []).forEach((g) => {
        if (!g || !g.repeat || !g.repeat.totalOf) return;
        const tn = (d.nodes || []).find((x) => x && x.id === g.repeat.totalOf);
        const ops = tn ? opsOfDiagramNode(R, tn) : [];
        if (ops.length && Math.max(...ops.map((o) => o.repeat || 1)) > 1) push({ diagram: d.id, group: g.id }, key(d, g.id));
      });
    });
    const inDiagram = new Set();
    ds.forEach((d) => (d.nodes || []).forEach((n) => n && n.id && inDiagram.add(n.id)));
    const byNode = {};
    (R.ops || []).forEach((o) => { (byNode[o.node] = byNode[o.node] || []).push(o); });
    Object.keys(byNode).forEach((nid) => {
      const list = byNode[nid];
      if (inDiagram.has(nid) || list.length !== 1 || !((list[0].params || 0) > 0)) return;
      push({ op: list[0].id }, nid);   // el id de nodo no está en ningún diagrama: no choca
    });
    return out;
  }
  function drillCandidates(sources, kinds) {
    const out = [];
    sources.forEach((src) => {
      const cfgs = (src.configs && src.configs.length ? src.configs : [canonicalOf(src.model)]).filter(Boolean);
      cfgs.forEach((cfg) => {
        const R = safe(() => run(cfg), null);
        if (!R) return;
        if (kinds.indexOf('shape') >= 0) {
          // pool 'all': los tensores que aparecen en algún diagrama del modelo (así siempre hay figura y
          // contexto); un pool explícito (lista de ids) se respeta tal cual.
          const ds = diagramsOf(src.model, cfg);
          const pool = Array.isArray(src.pool) ? src.pool
            : (R.order || Object.keys(R.tensors || {})).filter((tid) => !ds.length || ds.some((d) => tensorInDiagram(d, tid)));
          // Sin repetir la misma pregunta (misma corrida, mismo tensor): la config de decode y el carril {decode: 1}.
          const seenT = new Set();
          const add = (Rx, tid, ov) => {
            const t = Rx.tensors[tid];
            if (!t || !t.producer || !(t.num || []).length) return;   // las entradas no se preguntan
            const sig = Rx.label + '|' + tid;
            if (seenT.has(sig)) return;
            seenT.add(sig);
            const k = ovKey(ov);
            out.push(Object.assign({ kind: 'shape', model: src.model, pageId: src.pageId, config: cfg, tensor: tid, id: cfg + (k ? '~' + k : '') + ':' + tid + ':shape' }, k ? { ov } : {}));
          };
          pool.forEach((tid) => add(R, tid, null));
          // Un paso de decode (config de decode): también la KV cache de todo el contexto (k-ctx, v-ctx = G×ctx×d_h, salida
          // de kv_append), la forma que más se pregunta en el ejercicio de KV cache aunque ningún diagrama la dibuje.
          if (!Array.isArray(src.pool) && R.config && R.config.decode === 1) (R.ops || []).filter((o) => o.prim === 'kv_append').forEach((o) => (o.out || []).forEach((tid) => add(R, tid, null)));
          // Fase 6: aristas (y glifos) con ov, p. ej. el carril de decode ({decode: 1}) de la inferencia LLM: se preguntan
          // con las formas de run(config, ov), las mismas que dibuja el diagrama.
          if (!Array.isArray(src.pool)) ds.forEach((d) => (d.edges || []).concat(d.tensors || []).forEach((e) => {
            const tid = e.tensor || (e.id && !e.from ? e.id : null);
            if (!e.ov || !tid) return;
            const Rx = ovRun(R, e.ov);
            if (Rx && Rx !== R) add(Rx, tid, e.ov);
          }));
        }
        if (kinds.indexOf('params') >= 0) paramsCandidates(src, cfg, R).forEach((c) => out.push(c));
      });
      if (kinds.indexOf('whatif') >= 0) (src.whatifs || []).forEach((w) => out.push(Object.assign({ kind: 'whatif', model: src.model, pageId: src.pageId }, w)));
    });
    return out;
  }

  // Corredor de drills: una tarjeta a la vez, "Siguiente" elige otra (ponderado por historial).
  function DrillRunner(el, o) {
    const store = storeOf(o.ctx);
    const kindsAll = o.kinds || ['shape'];
    let kinds = kindsAll.slice();
    const cache = {};
    const cands = () => { const k = kinds.join(','); return cache[k] || (cache[k] = drillCandidates(o.sources, kinds)); };
    const sess = { n: 0, ok: 0 };
    let cur = null, last = null, dg = null, answered = false;

    const wrap = h('div', { class: 'pxd' });
    el.appendChild(wrap);
    const bar = h('div', { class: 'pxd__bar' });
    const card = h('div', { class: 'pxd__card' });
    wrap.append(bar, card);

    function paintBar() {
      bar.innerHTML = '';
      if (o.title) bar.appendChild(h('p', { class: 'px-k' }, o.title));
      if (o.kindSwitch && kindsAll.length > 1) {
        const opts = [['shape', 'Formas'], ['params', 'Parámetros'], ['whatif', '¿Qué pasa si…?']].filter(([k]) => kindsAll.indexOf(k) >= 0);
        const all = opts.length > 1 ? [['*', 'Todo']].concat(opts) : opts;
        bar.appendChild(h('div', { class: 'seg pxd__seg', role: 'group', 'aria-label': 'Tipo de ejercicio' }, all.map(([k, t]) => {
          const on = k === '*' ? kinds.length === kindsAll.length : kinds.length === 1 && kinds[0] === k;
          return h('button', { type: 'button', 'aria-pressed': String(on), on: { click: () => { kinds = k === '*' ? kindsAll.slice() : [k]; paintBar(); next(); } } }, t);
        })));
      }
      bar.appendChild(h('span', { class: 'pxd__sess mono' }, sess.n ? 'Esta sesión: ' + sess.ok + '/' + sess.n : 'Sin responder aún'));
    }
    function weight(c) {
      const s = stats(store, c.id);
      if (!s.seen) return 3;
      return (s.ok < s.seen ? 2 : 1) / (1 + Math.min(4, s.streak || 0));
    }
    function choose() {
      let list = cands();
      if (!list.length) return null;
      if (list.length > 1 && last) list = list.filter((c) => c.id !== last.id);
      const ws = list.map(weight);
      let x = Math.random() * ws.reduce((a, b) => a + b, 0);
      for (let i = 0; i < list.length; i++) { x -= ws[i]; if (x <= 0) return list[i]; }
      return list[list.length - 1];
    }
    function next(focus) {
      destroyDg(dg); dg = null;
      cur = choose();
      answered = false;
      paintCard(focus);
    }
    function record(ok, answer) {
      sess.n++; if (ok) sess.ok++;
      if (cur.kind !== 'whatif') sCall(store, 'drillResult', cur.id, { ok, answer: String(answer) });
      paintBar();
    }

    function paintCard(focus) {
      card.innerHTML = '';
      if (!cur) {
        card.appendChild(h('div', { class: 'px-empty' }, h('p', { class: 'px-empty__t' }, 'No hay ejercicios todavía'),
          h('p', { class: 'muted' }, 'Los drills se generan del calculador cuando el modelo tiene configuraciones y diagramas.')));
        return;
      }
      if (cur.kind === 'whatif') { paintWhatif(focus); return; }
      const R = run(cur.config, cur.ov);
      const modelName = safe(() => pageMeta(cur.pageId).short, null);
      const top = h('div', { class: 'pxd__meta' },
        modelName && o.showModel ? h('span', { class: 'chip chip--accent' }, modelName) : null,
        h('span', { class: 'chip' }, R.label || cfgLabel(cur.config)),
        h('span', { class: 'pxd__facts' }, cfgFacts(R.config, drillSide(R, cur))));
      let qHtml, hint, expected, diag, hl, grade = null, isShape = cur.kind === 'shape';
      if (isShape) {
        const t = R.tensors[cur.tensor];
        expected = t.num.map(Number);
        // tex del tensor: solo el símbolo (si trae la ecuación "U = …", la parte izquierda).
        const tsym = t.tex ? String(t.tex).split('=')[0].trim() : '';
        qHtml = '¿Qué forma tiene ' + (t.label ? '<b>' + esc(t.label) + '</b> ' : '') + (tsym ? '\\(' + tsym + '\\)' : '<code>' + esc(cur.tensor) + '</code>') + '?';
        hint = 'Solo números, sin batch: tokens × canales (N×D); imágenes H×W×C; cabezas h×N×d_h. Acepta 197x768, 197 × 768 o (197, 768).';
        const d = diagramForTensor(cur.model, cur.tensor, cur.ov, cur.config);
        diag = d && d.id;
        const prod = (R.ops || []).find((x) => x.id === t.producer);
        const pn = prod && (d ? (d.nodes || []).find((n) => (prod.path || []).indexOf(n.id) >= 0 && n.id === prod.path[prod.path.length - 1]) : null);
        // Solo las aristas del mismo carril (mismo ov); si el tensor también va por aristas de otro carril (el prefill
        // escribe K,V y el decode agrega una fila), no se resalta por tensor: se encenderían las del otro carril.
        const es = d ? (d.edges || []).filter((e) => e.tensor === cur.tensor) : [];
        const mine = es.filter((e) => sameOv(e.ov, cur.ov));
        hl = d ? { tensors: mine.length < es.length ? [] : [cur.tensor], edges: mine.map(edgeKey), nodes: pn ? [pn.id] : [] } : null;
      } else {
        const np = nodeParams(R, cur.model, cur.node);
        expected = np.total;
        qHtml = '¿Cuántos parámetros tiene <b>' + esc(np.label) + '</b>' + esc(np.qual) + '?';
        hint = 'Pesos y biases. Exacto, o redondeado hasta la cifra que escribas (7.09M; máx. ±1 %); olvidar los biases cuenta como error. Miles con coma, espacio o punto (7,087,872 · 7 087 872 · 7.087.872: el punto es de miles solo si separa grupos de 3 cifras y no hay sufijo); decimales con punto o coma (7.09M · 7,09 M).';
        diag = np.diagram;
        hl = np.diagram && np.node ? { nodes: [np.node], edges: [], tensors: [] } : null;
      }
      const qid = uid('pxd-q');
      const inp = h('input', { type: 'text', class: 'input pxd__in mono', id: uid('pxd-in'), autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
        inputmode: isShape ? 'text' : 'decimal', placeholder: isShape ? 'números con ×, p. ej. 3×5' : 'p. ej. 1,234,567', 'aria-describedby': qid });
      const fb = h('p', { class: 'pxd__fb', 'aria-live': 'polite' });
      const reveal = h('div', { class: 'pxd__reveal', hidden: true });
      const btnNext = h('button', { type: 'button', class: 'btn btn--primary', hidden: true, on: { click: () => next(true) } }, 'Siguiente', h('span', { html: icon('arrow-right') }));
      const btnCheck = h('button', { type: 'submit', class: 'btn btn--primary' }, 'Comprobar');
      const btnGive = h('button', { type: 'button', class: 'btn btn--ghost', on: { click: () => finish(false, '(sin respuesta)') } }, 'No sé, muéstrame');
      const form = h('form', { class: 'pxd__form', novalidate: true, on: { submit: (e) => {
        e.preventDefault();
        if (answered) { next(true); return; }
        const v = inp.value.trim();
        if (!v) { fb.className = 'pxd__fb is-warn'; fb.textContent = 'Escribe una respuesta (o pulsa «No sé, muéstrame»).'; inp.focus(); return; }
        let ok;
        if (isShape) {
          if (!parseShape(v).length) { fb.className = 'pxd__fb is-warn'; fb.textContent = 'No entendí la forma. Escribe números separados por × (p. ej. 3×5).'; return; }
          ok = shapeMatches(v, expected);
        } else {
          const g = gradeParams(v, nodeParams(R, cur.model, cur.node));
          if (!g) { fb.className = 'pxd__fb is-warn'; fb.textContent = 'No entendí el número. Prueba con 7087872, 7.087.872 o 7.09M.'; return; }
          ok = g.ok;
          grade = g;
        }
        finish(ok, v);
      } } },
      h('label', { class: 'sr-only', for: inp.id }, isShape ? 'Forma numérica' : 'Número de parámetros'),
      inp, btnCheck, btnGive);

      function finish(ok, answer) {
        answered = true;
        record(ok, answer);
        inp.readOnly = true;
        btnCheck.hidden = true; btnGive.hidden = true; btnNext.hidden = false;
        const right = isShape ? shapeKey(expected) : fInt(expected);
        fb.className = 'pxd__fb ' + (ok ? 'is-ok' : 'is-bad');
        fb.innerHTML = '';
        const lead = ok ? (grade && !grade.exact ? 'Correcto (redondeado): ' : 'Correcto: ') : answer === '(sin respuesta)' ? 'Respuesta: ' : grade && grade.slip ? 'Casi. Es ' : 'No. Es ';
        fb.append(h('span', { html: icon(ok ? 'check' : 'close') }), h('span', null, lead), h('b', { class: 'mono' }, right));
        if (grade && grade.slip) fb.append(h('span', null, '— te faltan ' + fInt(grade.slip.n) + ' parámetros: ' + grade.slip.what + '.'));
        paintReveal(R, reveal, grade);
        reveal.hidden = false;
        typeset(reveal);
        btnNext.focus({ preventScroll: true });
      }

      const fig = h('div', { class: 'pxd__fig' });
      card.append(top, h('p', { class: 'pxd__q', id: qid, html: qHtml }), h('p', { class: 'pxd__hint muted small' }, hint), fig, form, fb, reveal, h('div', { class: 'pxd__actions' }, btnNext));
      dg = mountMini(fig, diag, hl, cur.config);
      if (!dg) fig.hidden = true;
      typeset(card);
      if (focus) inp.focus({ preventScroll: true });
      last = cur;
    }

    function paintReveal(R, el2, grade) {
      el2.innerHTML = '';
      if (cur.kind === 'shape') {
        const t = R.tensors[cur.tensor];
        const op = (R.ops || []).find((x) => (x.out || []).indexOf(cur.tensor) >= 0 || x.id === t.producer);
        el2.appendChild(h('p', { class: 'px-k' }, 'De dónde sale'));
        el2.appendChild(h('p', { class: 'pxd__sym' }, h('span', { class: 'mono' }, fSym(t)), ' = ', h('b', { class: 'mono' }, fShape(t)), t.perLayer ? h('span', { class: 'muted small' }, ' (una capa)') : null));
        if (op) {
          const ins = (op.in || []).map((id) => R.tensors[id]).filter(Boolean);
          el2.appendChild(h('div', { class: 'pxd__chain' },
            ins.map((x) => h('span', { class: 'pxd__t' }, h('span', { class: 'mono' }, fShape(x)), h('span', { class: 'muted small' }, x.label || x.id))),
            h('span', { class: 'pxd__op' }, h('span', { html: icon('arrow-right') }), h('b', null, op.label || op.prim || op.id)),
            h('span', { class: 'pxd__t is-out' }, h('span', { class: 'mono' }, fShape(t)), h('span', { class: 'muted small' }, t.label || t.id))));
          if (op.shapeTex) el2.appendChild(h('p', { class: 'pxd__tex', html: '\\(' + op.shapeTex + '\\)' }));
        }
      } else {
        const np = nodeParams(R, cur.model, cur.node);
        el2.appendChild(h('p', { class: 'px-k' }, 'Cómo se cuenta'));
        const rows = np.ops.slice(0, 12).map((op) => h('tr', null,
          h('td', null, op.label || op.id),
          h('td', { html: op.paramTex ? '\\(' + op.paramTex + '\\)' : '' }),
          h('td', { class: 'mono num' }, op.paramArith || fInt(op.params)),
          np.group && (op.repeat || 1) > 1 ? h('td', { class: 'mono num' }, '×' + op.repeat) : null));
        el2.appendChild(h('div', { class: 'pxd__tablewrap' }, h('table', { class: 'pxd__table' },
          h('thead', null, h('tr', null, h('th', null, 'Operación'), h('th', null, 'Fórmula'), h('th', { class: 'num' }, 'Cuenta'), np.group && np.repeat > 1 ? h('th', { class: 'num' }, 'Veces') : null)),
          h('tbody', null, rows),
          h('tfoot', null, h('tr', null, h('th', { colspan: '2' }, 'Total'), h('td', { class: 'mono num' }, fInt(np.total)), np.group && np.repeat > 1 ? h('td') : null)))));
        if (np.ops.length > 12) el2.appendChild(h('p', { class: 'muted small' }, '… y ' + (np.ops.length - 12) + ' operaciones más.'));
        if (np.perLayer) el2.appendChild(h('p', { class: 'muted small' }, np.unit === 'capa'
          ? 'Hay ' + np.repeat + ' capas iguales: ' + fInt(np.total * np.repeat) + ' en total.'
          : np.unit === 'par'
            ? 'El stage tiene ' + np.repeat + ' pares iguales: ' + fInt(np.total * np.repeat) + ' en total.'
            : 'El stage tiene ' + np.repeat + ' pares, uno de estos bloques en cada uno: ' + fInt(np.total * np.repeat) + ' en total.'));
        if (np.biases > 0) {
          const share = (np.biases / np.total) * 100;
          el2.appendChild(h('p', { class: 'pxd__bias small' },
            h('b', null, 'Biases: '), fInt(np.biases) + ' (' + (share < 0.1 ? share.toFixed(3) : share.toFixed(2)) + ' % del bloque). Sin ellos serían ' + fInt(np.total - np.biases) + '. ',
            'Por eso la tolerancia es menor que la mitad de los biases: una cuenta sin ellos no pasa, aunque esté a menos de 1 %.'));
        }
        if (grade && grade.amb) el2.appendChild(h('p', { class: 'muted small' },
          'Tu redondeo no distingue si contaste ' + grade.amb.what + ': con ellos son ' + fInt(np.total) + ', sin ellos ' + fInt(np.total - grade.amb.n) + '. En la entrevista, di el número con biases.'));
      }
    }

    function paintWhatif(focus) {
      const host = h('div', { class: 'pxd__wi' });
      card.appendChild(host);
      renderWhatIfItem(cur.item, host, { config: cur.config, drillId: cur.id, store, pageCtx: { pageId: cur.pageId }, showModel: o.showModel ? safe(() => pageMeta(cur.pageId).short, null) : null,
        onDone: (ok) => { sess.n++; if (ok) sess.ok++; paintBar(); },
        footer: h('div', { class: 'pxd__actions' }, h('button', { type: 'button', class: 'btn btn--primary', on: { click: () => next(true) } }, 'Siguiente', h('span', { html: icon('arrow-right') }))) });
      if (focus) { const b = host.querySelector('button, input'); if (b) b.focus({ preventScroll: true }); }
      last = cur;
    }

    paintBar();
    next(false);
    return { el: wrap, destroy() { destroyDg(dg); wrap.remove(); } };
  }

  function renderShapeDrill(block, el, ctx) {
    const { model, config } = resolve(block, ctx);
    if (!model) throw new Error('El bloque shapedrill necesita «model».');
    const configs = Array.isArray(block.configs) && block.configs.length ? block.configs : [config || canonicalOf(model)];
    const kinds = Array.isArray(block.kinds) && block.kinds.length ? block.kinds : ['shape', 'params'];
    return DrillRunner(el, { ctx, kinds, kindSwitch: true, title: '¿Qué forma tiene este tensor?',
      sources: [{ model, pageId: ctx && ctx.pageId, configs, pool: block.pool === 'all' || !block.pool ? 'all' : block.pool }] });
  }

  // ================================================================== WHAT-IF (§8.3)
  const WI_ROWS = ['tokens', 'params', 'macs', 'scoreMacs', 'attnMem', 'kvCache'];
  // Fase 10: en entrenamiento lo que se compara es memoria y cómputo del PASO, no el forward de inferencia.
  const WI_ROWS_BY_MODEL = {
    lora: ['trainableParams', 'trainableShare', 'totalTrainMemory', 'activationBytes', 'trainStepMacs', 'fitsOn24', 'fitsOn80'],
    'rlhf-dpo': ['modelsInMemory', 'trainableParams', 'totalTrainMemory', 'gpus80Needed', 'generationTokensPerStep', 'trainStepMacs', 'rolloutShare'],
  };
  // Etiqueta de un factor COMO OPCIÓN: la misma regla para todas las opciones (correcta, distractores
  // y las del autor), así el formato no delata la respuesta: "≈" + 2 cifras significativas.
  // 3.98 → "≈ ×4" · 15.88 → "≈ ×16" · 4.45 → "≈ ×4.5" · 0.25 → "≈ ÷4" · 1.003 → "≈ ×1".
  // El valor exacto (fFactor: "×3.98") se muestra al responder.
  function sig2(x) {
    if (!(x > 0) || !isFinite(x)) return x;
    const e = Math.floor(Math.log10(x)) - 1;
    const f = Math.pow(10, e);
    return Number((Math.round(x / f) * f).toPrecision(2));
  }
  function fFactorOpt(r) {
    if (r == null || !isFinite(r) || r <= 0) return '—';
    if (Math.abs(r - 1) < 0.05) return '≈ ×1';
    return r >= 1 ? '≈ ×' + String(sig2(r)) : '≈ ÷' + String(sig2(1 / r));
  }
  const nearF = (a, b) => Math.abs(Math.log(a / b)) < Math.log(1.25);
  // Distractores = errores típicos de escala: confundir N con N² (r², √r), un ×2 de más o de menos,
  // "no cambia" (×1) y ×4 de más o de menos. Ninguno a menos de 25 % del correcto ni de otro.
  function factorOptions(r, seed) {
    const right = fFactorOpt(r);
    const cands = [r * r, Math.sqrt(r), 2 * r, r / 2, 1, 4 * r, r / 4].filter((x) => x > 0 && isFinite(x));
    const out = [];
    const labels = new Set([right]);
    for (const c of cands) {
      if (nearF(c, r) || out.some((o) => nearF(o, c))) continue;
      const l = fFactorOpt(c);
      if (labels.has(l)) continue;
      labels.add(l); out.push(c);
      if (out.length === 3) break;
    }
    const opts = [{ id: 'ok', text: right, v: r }].concat(out.map((c, i) => ({ id: 'd' + i, text: fFactorOpt(c), v: c })));
    return shuffle(opts, rng(seed));
  }
  // Opciones de VALOR absoluto ("¿Cuántos tokens…?", "¿Cuánto pesa…?"): mismos errores de escala,
  // aplicados al valor; todas con el mismo formateador (fMetric) y redondeo.
  function valueOptions(ask, bv, av, seed) {
    const r = av / bv;
    const isCount = metricKind(ask) === 'count';
    const fix = (x) => (isCount ? Math.round(x) : x);
    const right = fMetric(ask, fix(av));
    const isPct = metricKind(ask) === 'pct';
    // Porcentajes: nada por encima de 100 % (×2 o ×4 de una fracción grande no es un distractor creíble).
    const cands = [bv, av * r, bv * Math.sqrt(r), av * 2, av / 2, av * 4, av / 4, 1 - av].map(fix).filter((x) => x > 0 && isFinite(x) && (!isPct || x <= 1));
    const out = [];
    const labels = new Set([right]);
    for (const c of cands) {
      if (nearF(c, av) || out.some((o) => nearF(o, c))) continue;
      const l = fMetric(ask, c);
      if (labels.has(l)) continue;
      labels.add(l); out.push(c);
      if (out.length === 3) break;
    }
    const opts = [{ id: 'ok', text: right, v: av }].concat(out.map((c, i) => ({ id: 'd' + i, text: fMetric(ask, c), v: c })));
    return shuffle(opts, rng(seed));
  }
  // ¿La pregunta pide un valor absoluto? "¿Cuántos…?" / "¿Cuánto…?" → sí (salvo expect explícito).
  // Revisión de la fase 8: una métrica en % (…Share, unidad 'pct') se pregunta SIEMPRE por su valor nuevo (salvo expect: 'factor'):
  // «×7.6» de una fracción de 15 % daría 116 %, y «el % se multiplica por 2.8» se lee peor que «15.2 % → 41.9 %».
  function asksValue(item, qText) {
    if (item.expect === 'value') return true;
    if (item.expect === 'factor') return false;
    if (metricKind(metricKey(item.ask || 'macs')) === 'pct') return true;
    if (metricKind(metricKey(item.ask || 'macs')) === 'bool') return true;   // «¿cabe en 24 GB?»: sí / no
    return /(^|[¿\s])cu[aá]nt[oa]s?\b/i.test(String(qText || '').replace(/<[^>]*>/g, ' '));
  }
  function parseFactor(o) {
    if (typeof o === 'number') return o;
    const s = String(o && typeof o === 'object' ? (o.value != null ? o.value : o.text) : o).replace(/[≈×x~\s]/g, '').replace(',', '.');
    if (/^÷/.test(s)) return 1 / parseFloat(s.slice(1));
    if (/^\//.test(s)) return 1 / parseFloat(s.slice(1));
    const fr = s.match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);   // "1/4" → 0.25
    if (fr) { const b = parseFloat(fr[2]); return b ? parseFloat(fr[1]) / b : null; }
    if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/.test(s)) return null;
    const v = parseFloat(s);
    return isFinite(v) ? v : null;
  }
  // Opción del autor → factor (laxo: "algo por encima de ×4" → 4; "÷4" o "1/4" → 0.25).
  function parseFactorLoose(o) {
    const v = parseFactor(o);
    if (v != null) return v;
    const s = String(o && typeof o === 'object' ? (o.value != null ? o.value : o.text) : o);
    const fr = s.match(/(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)/);
    if (fr) return parseFloat(fr[1].replace(',', '.')) / parseFloat(fr[2].replace(',', '.'));
    const n = s.match(/\d+(?:[.,]\d+)?/);
    if (!n) return null;
    const x = parseFloat(n[0].replace(',', '.'));
    return /÷/.test(s) ? 1 / x : x;
  }
  // ¿La opción del autor es solo un factor ("×4", "≈ ×16", "÷2", 4)? Entonces se reformatea con
  // fFactorOpt para que todas sigan la misma regla. Si es texto ("algo por encima de ×4"), se respeta.
  const isBareFactor = (o) => typeof o === 'number' || /^\s*[≈~]?\s*[×x÷/]?\s*\d+(?:[.,]\d+)?\s*$/.test(String(o && typeof o === 'object' ? (o.text != null ? o.text : o.value) : o));

  // Un ítem: {q, change, ask, options?, mode?:'mc'|'numeric', expect?:'factor'|'value', explain?, id?}
  //   expect: 'value' pide el valor nuevo (opciones o entrada en unidades de la métrica); 'factor', el
  //   factor de cambio. Si falta, «¿Cuántos…?» / «¿Cuánto…?» en la pregunta implica 'value'.
  function renderWhatIfItem(item, host, o) {
    const cfg = o.config;
    const wm = modelOfConfig(cfg);
    const ask = metricKey(item.ask || 'macs');
    const base = metrics(cfg, {});
    let alt, err = null;
    try { alt = metrics(cfg, item.change || {}); } catch (e) { err = e; }
    const card = h('div', { class: 'pxw__item' });
    host.appendChild(card);
    const head = h('div', { class: 'pxd__meta' },
      o.showModel ? h('span', { class: 'chip chip--accent' }, o.showModel) : null,
      h('span', { class: 'chip' }, cfgLabel(cfg)), h('span', { class: 'chip chip--warn' }, changeText(item.change, wm)));
    const qHtml = fill(item.q || ('¿Qué pasa con ' + metricLabel(ask, wm).toLowerCase() + ' si ' + changeText(item.change, wm) + '?'), o.pageCtx);
    const q = h('div', { class: 'pxw__q', html: qHtml });
    card.append(head, q);
    decorate(q);
    if (err) { warnBox(card, err.message || String(err)); return card; }
    const bv = metricValue(base, ask), av = metricValue(alt, ask);
    if (bv == null || av == null) { warnBox(card, 'El calculador no da «' + metricLabel(ask, wm) + '» para ' + cfgLabel(cfg) + '.'); return card; }
    const r = av / bv;
    // Con opciones del autor, se pregunta lo que ellas expresan (factores) salvo expect explícito.
    const askKind = metricKind(ask);
    const isBool = askKind === 'bool';   // fase 10: «¿cabe en 24 GB?» → opciones sí / no (sin factor ni entrada numérica)
    const numeric = !isBool && (item.mode === 'numeric' || item.numeric === true);
    const expectValue = isBool ? true : (Array.isArray(item.options) && item.options.length && !numeric) ? false : asksValue(item, qHtml);
    const fb = h('p', { class: 'pxd__fb', 'aria-live': 'polite' });
    const expl = h('div', { class: 'pxw__expl', hidden: true });
    let done = false;

    function finish(ok, answer) {
      if (done) return; done = true;
      if (o.drillId) sCall(o.store, 'drillResult', o.drillId, { ok, answer: String(answer) });
      fb.className = 'pxd__fb ' + (ok ? 'is-ok' : 'is-bad');
      fb.innerHTML = '';
      if (isBool) fb.append(h('span', { html: icon(ok ? 'check' : 'close') }), h('span', null, ok ? 'Correcto: ' : 'No. Es '),
        h('b', { class: 'mono' }, fMetric(ask, av)), h('span', null, ' (' + metricLabel(ask, wm).toLowerCase() + ': ' + fMetric(ask, bv) + ' → ' + fMetric(ask, av) + ').'));
      else if (expectValue) fb.append(h('span', { html: icon(ok ? 'check' : 'close') }), h('span', null, ok ? 'Correcto: ' : 'No. Es '),
        h('b', { class: 'mono', title: fMetricExact(ask, av) }, fMetric(ask, av)), h('span', null, ' (' + fMetric(ask, bv) + ' → ' + fMetric(ask, av) + ': ' + (askKind === 'pct' ? fVsBase(ask, av, bv).replace(' vs base', '') : fFactor(r)) + ').'));
      else fb.append(h('span', { html: icon(ok ? 'check' : 'close') }), h('span', null, ok ? 'Correcto: ' : 'No. Es '),
        h('b', { class: 'mono' }, fFactor(r)), h('span', null, ' (' + fMetric(ask, bv) + ' → ' + fMetric(ask, av) + ').'));
      paintExpl();
      expl.hidden = false;
      typeset(expl);
      if (o.onDone) o.onDone(ok);
    }
    function paintExpl() {
      expl.innerHTML = '';
      const rows = (WI_ROWS_BY_MODEL[wm] || WI_ROWS).filter((k) => metricValue(base, k) != null && metricValue(alt, k) != null);
      if (rows.indexOf(ask) < 0) rows.unshift(ask);
      expl.appendChild(h('div', { class: 'pxd__tablewrap' }, h('table', { class: 'pxw__table' },
        h('caption', { class: 'sr-only' }, 'Las dos corridas del calculador lado a lado'),
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Métrica'), h('th', { scope: 'col', class: 'num' }, cfgLabel(cfg)), h('th', { scope: 'col', class: 'num' }, 'con ' + changeText(item.change, wm)), h('th', { scope: 'col', class: 'num' }, 'Factor'))),
        h('tbody', null, rows.map((k) => {
          const b = metricValue(base, k), a = metricValue(alt, k);
          return h('tr', { class: k === ask ? 'is-ask' : null },
            h('th', { scope: 'row' }, metricLabel(k, wm)),
            h('td', { class: 'mono num', title: fMetricExact(k, b) }, fMetric(k, b)),
            h('td', { class: 'mono num', title: fMetricExact(k, a) }, fMetric(k, a)),
            h('td', { class: 'mono num' }, metricKind(k) === 'bool' ? (a === b ? '=' : 'cambia') : metricKind(k) === 'pct' ? fVsBase(k, a, b).replace(' vs base', '') : b ? fFactor(a / b) : '—'));
        })))));
      const sb = attnSplit(base), sa = attnSplit(alt);
      if (sb && sa) expl.appendChild(h('p', { class: 'muted small' }, 'Atención (solo QKᵀ y A·V), en % de los MACs: ' + Math.round(sb.share * 1000) / 10 + ' % → ' + Math.round(sa.share * 1000) / 10 + ' %.'
        + (typeof base.attnMacsShare === 'number' && typeof alt.attnMacsShare === 'number' ? ' Bloque de atención (con proyecciones): ' + Math.round(base.attnMacsShare * 1000) / 10 + ' % → ' + Math.round(alt.attnMacsShare * 1000) / 10 + ' %.' : '')));
      if (item.explain) { const x = h('div', { class: 'pxw__note', html: fill(item.explain, o.pageCtx) }); decorate(x); expl.appendChild(x); }
    }

    if (!numeric) {
      let opts;
      const seed = (o.drillId || '') + JSON.stringify(item.change);
      if (isBool) {
        opts = [{ id: 'si', text: 'sí', ok: av === 1 }, { id: 'no', text: 'no', ok: av === 0 }];
      } else if (Array.isArray(item.options) && item.options.length) {
        // el correcto es el más cercano (en escala log) al factor calculado; los factores "pelados"
        // se reescriben con la misma regla (fFactorOpt) y se quitan duplicados del correcto.
        const vals = item.options.map(parseFactorLoose);
        let best = 0;
        vals.forEach((v, i) => { if (v > 0 && Math.abs(Math.log(v / r)) < Math.abs(Math.log((vals[best] || 1e-12) / r))) best = i; });
        const textOf = (op, i) => (isBareFactor(op) && vals[i] > 0 ? fFactorOpt(vals[i]) : String(op && typeof op === 'object' ? (op.text || op.value) : op));
        const seenT = new Set();
        opts = item.options.map((op, i) => ({ id: 'o' + i, text: textOf(op, i), ok: i === best }))
          .sort((a, b) => (b.ok ? 1 : 0) - (a.ok ? 1 : 0))
          .filter((x) => { const k = x.text.toLowerCase(); if (seenT.has(k)) return false; seenT.add(k); return true; });
        opts.sort((a, b) => +a.id.slice(1) - +b.id.slice(1));
      } else if (expectValue) {
        opts = valueOptions(ask, bv, av, seed).map((x) => ({ id: x.id, text: x.text, ok: x.id === 'ok' }));
      } else {
        opts = factorOptions(r, seed).map((x) => ({ id: x.id, text: x.text, ok: x.id === 'ok' }));
      }
      const gid = uid('pxw-g');
      const btns = opts.map((op) => h('button', { type: 'button', class: 'pxw__opt mono', 'aria-pressed': 'false',
        on: { click: () => {
          if (done) return;
          btns.forEach((b, i) => { b.disabled = true; b.classList.toggle('is-right', opts[i].ok); });
          const me = btns[opts.indexOf(op)];
          me.setAttribute('aria-pressed', 'true');
          if (!op.ok) me.classList.add('is-wrong');
          finish(op.ok, op.text);
        } } }, op.text));
      card.appendChild(h('div', { class: 'pxw__opts', role: 'group', 'aria-labelledby': gid },
        h('span', { class: 'sr-only', id: gid }, expectValue ? 'Opciones: nuevo valor de ' + metricLabel(ask, wm) : 'Opciones: factor de cambio en ' + metricLabel(ask, wm)), btns));
    } else {
      const inp = h('input', { type: 'text', class: 'input pxd__in mono', id: uid('pxw-in'), autocomplete: 'off', spellcheck: 'false', inputmode: 'decimal',
        placeholder: expectValue ? (askKind === 'bytes' ? 'p. ej. 3.7 MB' : askKind === 'pct' ? 'en %, p. ej. 41.9' : 'nuevo valor, p. ej. 785') : 'factor, p. ej. 4 o 1/4' });
      const form = h('form', { class: 'pxd__form', novalidate: true, on: { submit: (e) => {
        e.preventDefault();
        if (done) return;
        const v = expectValue ? (askKind === 'bytes' ? parseBytes(inp.value) : askKind === 'pct' ? parsePct(inp.value) : parseNumber(inp.value)) : parseFactor(inp.value);
        if (v == null || !isFinite(v)) { fb.className = 'pxd__fb is-warn'; fb.textContent = 'No entendí el número.'; return; }
        const target = expectValue ? av : r;
        const tol = expectValue ? 0.01 : 0.03;
        inp.readOnly = true;
        finish(Math.abs(v - target) <= Math.abs(target) * tol, inp.value);
      } } },
      h('label', { class: 'sr-only', for: inp.id }, expectValue ? 'Nuevo valor' : 'Factor de cambio'),
      inp, h('button', { type: 'submit', class: 'btn btn--primary' }, 'Comprobar'),
      h('button', { type: 'button', class: 'btn btn--ghost', on: { click: () => { inp.readOnly = true; finish(false, '(sin respuesta)'); } } }, 'No sé, muéstrame'));
      card.appendChild(form);
    }
    card.append(fb, expl);
    if (o.footer) card.appendChild(o.footer);
    typeset(card);
    return card;
  }

  // Índice global de un ítem what-if en su página (ids 'whatif:<pageId>:<i>').
  function collectBlocks(page, type) {
    const out = [];
    const walk = (arr) => (Array.isArray(arr) ? arr : []).forEach((b) => {
      if (!b || typeof b !== 'object') return;
      if (b.t === type) out.push(b);
      if (Array.isArray(b.blocks)) walk(b.blocks);
    });
    ((page && page.sections) || []).forEach((s) => walk(s.blocks));
    return out;
  }
  function whatifOffset(pageId, block) {
    const page = safe(() => ATLAS.getPage(pageId), null);
    let off = 0;
    for (const b of collectBlocks(page, 'whatif')) { if (b === block) return off; off += (b.items || []).length; }
    return 0;
  }

  function renderWhatIf(block, el, ctx) {
    const { config } = resolve(block, ctx);
    if (!config) throw new Error('El bloque whatif no encontró una configuración del calculador.');
    const pageId = (ctx && ctx.pageId) || 'pagina';
    const off = whatifOffset(pageId, block);
    const store = storeOf(ctx);
    const wrap = h('div', { class: 'pxw' });
    el.appendChild(wrap);
    wrap.appendChild(h('p', { class: 'px-k' }, '¿Qué pasa si…?'));
    (block.items || []).forEach((item, i) => {
      const drillId = 'whatif:' + pageId + ':' + (item.id != null ? item.id : off + i);
      try { renderWhatIfItem(item, wrap, { config: item.config || config, drillId, store, pageCtx: ctx }); }
      catch (e) { warnBox(wrap, e && e.message ? e.message : String(e)); }
    });
    return { el: wrap, destroy() { wrap.remove(); } };
  }

  // ================================================================== renderBlock
  const RENDERERS = { scaling: renderScaling, blankdiagram: renderBlank, shapedrill: renderShapeDrill, whatif: renderWhatIf };
  function renderBlock(block, el, ctx) {
    const fn = RENDERERS[block && block.t];
    const box = h('div', { class: 'px-block px-block--' + (block && block.t) });
    el.appendChild(box);
    if (!fn) { warnBox(box, 'Tipo de bloque de práctica desconocido: «' + (block && block.t) + '».'); return { el: box, destroy() { box.remove(); } }; }
    try {
      const c = fn(block, box, Object.assign({}, ctx && ctx.pageCtx, ctx));
      return { el: box, destroy() { if (c && c.destroy) c.destroy(); box.remove(); } };
    } catch (e) {
      box.innerHTML = '';
      warnBox(box, (e && e.message) ? e.message : String(e));
      return { el: box, destroy() { box.remove(); } };
    }
  }

  // ================================================================== PÁGINAS
  function header(o) {
    const eb = h('p', { class: 'eyebrow' });
    (o.eyebrow || []).forEach((p, i) => {
      if (i) eb.appendChild(h('span', { class: 'sep', 'aria-hidden': 'true' }, '·'));
      eb.appendChild(typeof p === 'string' ? h('span', null, p) : p);
    });
    return h('header', { class: 'phead' }, eb,
      h('h1', { class: 'phead__title', id: 'page-title', tabindex: '-1' }, o.title || ''),
      o.en ? h('p', { class: 'phead__en', lang: 'en' }, o.en) : null,
      o.summary ? h('p', { class: 'phead__summary', html: String(o.summary) }) : null);
  }
  function readyModels() {
    return (safe(() => ATLAS.listPages('model'), []) || []).filter((p) => p && p.ready);
  }
  function modelInfo(page) {
    const model = modelOfPage(page.id);
    const cfgs = configsOf(model).map((c) => c.id);
    const canon = page.canonical || canonicalOf(model);
    const ds = diagramsOf(model);
    const whatifs = [];
    collectBlocks(page, 'whatif').forEach((b) => (b.items || []).forEach((it) => {
      const i = whatifs.length;
      whatifs.push({ id: 'whatif:' + page.id + ':' + (it.id != null ? it.id : i), item: it, config: it.config || b.config || canon });
    }));
    const blanks = collectBlocks(page, 'blankdiagram');
    return { page, model, cfgs, canon, ds, whatifs, blanks };
  }
  function modelPrefixes(mi) {
    return mi.cfgs.map((c) => c + ':').concat(['whatif:' + mi.page.id + ':'], mi.ds.map((d) => 'blank:' + d.id));
  }
  function cardsDue(store, source) {
    const ids = (safe(() => ATLAS.flashcards(), []) || []).filter((c) => c && c.id && (!source || c.source === source)).map((c) => c.id);
    const due = sCall(store, 'dueCards', ids);
    return { total: ids.length, due: Array.isArray(due) ? due.length : 0 };
  }
  function flashLink(store, ctx, source, text) {
    return h('a', { class: 'btn', href: '#flashcards', on: { click: () => { if (source) sCall(store, 'setPref', 'flashFilter', { mode: 'due', source, kind: 'all' }); } } },
      h('span', { html: icon('cards') }), text);
  }
  function statLine(items) {
    return h('div', { class: 'stat-line pxh__stats' }, items.map(([v, k]) => h('div', { class: 'stat' }, h('span', { class: 'stat__v' }, String(v)), h('span', { class: 'stat__k' }, k))));
  }

  function renderHub(container, route, ctx) {
    const store = storeOf(ctx);
    const m = pageMeta('practica');
    const wrap = h('div', { class: 'px pxh' });
    container.appendChild(wrap);
    wrap.appendChild(header({ eyebrow: ['Práctica'], title: m.title || 'Ejercicios', en: m.titleEn || 'Practice',
      summary: m.summary || 'Diagramas en blanco, «¿qué forma tiene este tensor?», «¿cuántos parámetros?» y «¿qué pasa si duplico…?». Todo se genera con el calculador, así que las respuestas son exactas.' }));
    const models = readyModels().map(modelInfo);
    const g = stats(store);
    const fc = cardsDue(store);
    wrap.appendChild(statLine([[g.seen, 'ejercicios respondidos'], [pct(g), 'acierto'], [g.streak || 0, 'racha actual'], [fc.due, 'flashcards pendientes']]));

    if (!models.length) {
      wrap.appendChild(h('div', { class: 'px-empty' }, h('p', { class: 'px-empty__t' }, 'Todavía no hay modelos listos'),
        h('p', { class: 'muted' }, 'Los ejercicios aparecen cuando una página de modelo tiene sus 11 secciones.')));
      return { el: wrap, destroy() { wrap.remove(); } };
    }
    // Tabla por modelo
    const sec = h('section', { class: 'pxh__sec', 'aria-labelledby': 'pxh-models' }, h('h2', { class: 'pxh__h', id: 'pxh-models' }, 'Por modelo'));
    const rows = models.map((mi) => {
      const s = sumStats(store, modelPrefixes(mi));
      const bd = mi.blanks.filter((b) => blankDone(b, store)).length;
      const f = cardsDue(store, mi.page.id);
      return h('tr', null,
        h('th', { scope: 'row' }, h('a', { href: '#practica-' + mi.page.id }, mi.page.short || mi.page.title || mi.page.id), h('span', { class: 'pxh__cfg mono muted' }, cfgLabel(mi.canon))),
        h('td', { class: 'num mono', dataset: { label: 'Respondidos' } }, String(s.seen)),
        h('td', { class: 'num mono', dataset: { label: 'Acierto' } }, pct(s)),
        h('td', { class: 'num mono', dataset: { label: 'Diagramas en blanco' } }, mi.blanks.length ? bd + '/' + mi.blanks.length : '—'),
        h('td', { class: 'num mono', dataset: { label: 'Flashcards pendientes' } }, f.total ? f.due + '/' + f.total : '—'),
        h('td', { class: 'pxh__go' }, h('a', { class: 'btn btn--sm', href: '#practica-' + mi.page.id }, 'Practicar', h('span', { html: icon('arrow-right') }))));
    });
    sec.appendChild(h('div', { class: 'pxd__tablewrap' }, h('table', { class: 'pxh__table' },
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Modelo'), h('th', { scope: 'col', class: 'num' }, 'Respondidos'), h('th', { scope: 'col', class: 'num' }, 'Acierto'),
        h('th', { scope: 'col', class: 'num' }, 'Diagramas en blanco'), h('th', { scope: 'col', class: 'num' }, 'Flashcards'), h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'Ir')))),
      h('tbody', null, rows))));
    wrap.appendChild(sec);

    // Mezcla
    const mix = h('section', { class: 'pxh__sec', 'aria-labelledby': 'pxh-mix' },
      h('h2', { class: 'pxh__h', id: 'pxh-mix' }, 'Mezcla'),
      h('p', { class: 'muted' }, 'Ejercicios al azar de todos los modelos listos y de todas sus configuraciones. Primero salen los que no has visto o fallaste.'));
    wrap.appendChild(mix);
    const runner = DrillRunner(mix, { ctx, kinds: ['shape', 'params', 'whatif'], kindSwitch: true, showModel: true,
      sources: models.map((mi) => ({ model: mi.model, pageId: mi.page.id, configs: mi.cfgs.length ? mi.cfgs : [mi.canon], pool: 'all', whatifs: mi.whatifs })) });

    // Flashcards
    wrap.appendChild(h('section', { class: 'pxh__sec', 'aria-labelledby': 'pxh-fc' },
      h('h2', { class: 'pxh__h', id: 'pxh-fc' }, 'Flashcards'),
      h('p', null, fc.total ? 'Tienes ' + plural(fc.due, 'tarjeta pendiente', 'tarjetas pendientes') + ' hoy de ' + fc.total + '.' : 'El mazo todavía está vacío.'),
      fc.total ? h('p', null, flashLink(store, ctx, null, 'Repasar flashcards')) : null));
    return { el: wrap, destroy() { runner.destroy(); wrap.remove(); } };
  }

  function renderModel(container, route, ctx) {
    const store = storeOf(ctx);
    const rid = String((route && route.pageId) || (ctx && ctx.pageId) || '');
    const pid = rid.replace(/^practica-/, '');
    const page = safe(() => ATLAS.getPage(pid), null);
    const wrap = h('div', { class: 'px pxm' });
    container.appendChild(wrap);
    if (!page || !page.ready) {
      wrap.appendChild(header({ eyebrow: [h('a', { href: '#practica' }, 'Práctica')], title: 'Práctica: ' + ((page && (page.short || page.title)) || pid) }));
      wrap.appendChild(h('div', { class: 'px-empty' }, h('p', { class: 'px-empty__t' }, 'Este modelo todavía no está listo'),
        h('p', { class: 'muted' }, 'Sus ejercicios llegan con su página.'), h('p', null, h('a', { class: 'btn', href: '#practica' }, 'Volver a Práctica'))));
      return { el: wrap, destroy() { wrap.remove(); } };
    }
    const mi = modelInfo(page);
    const pageCtx = Object.assign({}, ctx, { pageId: page.id, model: mi.model, config: mi.canon });
    const ctrls = [];
    const short = page.short || page.title || page.id;
    wrap.appendChild(header({ eyebrow: [h('a', { href: '#practica' }, 'Práctica'), short], title: 'Práctica: ' + short, en: page.titleEn,
      summary: 'Todos los ejercicios de ' + esc(short) + ': ' + plural(mi.cfgs.length || 1, 'configuración', 'configuraciones') + ' del calculador, diagramas en blanco y preguntas de escalado.' }));
    const s = sumStats(store, modelPrefixes(mi));
    const f = cardsDue(store, page.id);
    wrap.appendChild(statLine([[s.seen, 'respondidos'], [pct(s), 'acierto'], [mi.blanks.filter((b) => blankDone(b, store)).length + '/' + (mi.blanks.length || 0), 'diagramas en blanco'], [f.due, 'flashcards pendientes']]));
    wrap.appendChild(h('p', { class: 'pxm__back' }, h('a', { href: '#' + page.id + '.practica' }, h('span', { html: icon('arrow-left') }), 'Volver a la página de ' + short)));

    const section = (id, title, intro) => {
      const sec = h('section', { class: 'pxh__sec', id: 'practica-' + page.id + '.' + id, 'aria-labelledby': 'pxm-' + id },
        h('h2', { class: 'pxh__h', id: 'pxm-' + id }, title), intro ? h('p', { class: 'muted' }, intro) : null);
      wrap.appendChild(sec);
      return sec;
    };
    // 1. Diagramas en blanco (los de la página; si no hay, uno generado del overview)
    let blanks = mi.blanks.slice();
    if (!blanks.length) {
      const ov = mi.ds.find((d) => !d.parent) || mi.ds[0];
      if (ov) {
        const nodes = (ov.nodes || []).filter((n) => n.label && n.op !== 'io' && n.op !== 'tensorop').slice(0, 3).map((n) => ({ node: n.id, ask: 'label' }));
        const edges = (ov.edges || []).filter((e) => e.tensor && e.kind === 'data').filter((e, i, a) => i === 1 || i === a.length - 2).map((e) => ({ edge: edgeKey(e), ask: 'shape' }));
        if (nodes.length + edges.length) blanks = [{ t: 'blankdiagram', diagram: ov.id, slots: nodes.concat(edges) }];
      }
    }
    if (blanks.length) {
      const sec = section('blancos', 'Diagramas en blanco', 'Completa nombres de bloques, tipos de operación y formas en las aristas.');
      blanks.forEach((b) => ctrls.push(renderBlock(b, sec, pageCtx)));
    }
    // 2. Formas
    const src = [{ model: mi.model, pageId: page.id, configs: mi.cfgs.length ? mi.cfgs : [mi.canon], pool: 'all' }];
    const sShape = section('formas', '¿Qué forma tiene este tensor?', 'Cualquier tensor de cualquier configuración (' + (mi.cfgs.map(cfgLabel).join(' · ') || cfgLabel(mi.canon)) + ').');
    ctrls.push(DrillRunner(sShape, { ctx: pageCtx, kinds: ['shape'], sources: src }));
    // 3. Parámetros
    const sPar = section('parametros', '¿Cuántos parámetros tiene este bloque?', 'Exacto, o redondeado hasta la cifra que escribas (máx. ±1 %). Olvidar los biases cuenta como error. Al revelar ves la fórmula y la aritmética de cada operación.');
    ctrls.push(DrillRunner(sPar, { ctx: pageCtx, kinds: ['params'], sources: src }));
    // 4. What-if
    const wiBlocks = collectBlocks(page, 'whatif');
    if (wiBlocks.length) {
      const sec = section('que-pasa-si', '¿Qué pasa si…?', 'Cada respuesta compara dos corridas del calculador.');
      wiBlocks.forEach((b) => ctrls.push(renderBlock(b, sec, pageCtx)));
    }
    // 5. Flashcards
    const sFc = section('flashcards', 'Flashcards de ' + short);
    sFc.appendChild(h('p', null, f.total ? plural(f.due, 'pendiente', 'pendientes') + ' hoy de ' + plural(f.total, 'tarjeta', 'tarjetas') + '.' : 'Este modelo todavía no tiene tarjetas.'));
    if (f.total) sFc.appendChild(h('p', null, flashLink(store, ctx, page.id, 'Repasar las de ' + short)));
    return { el: wrap, destroy() { ctrls.forEach((c) => c && c.destroy && c.destroy()); wrap.remove(); } };
  }

  ATLAS.Practice = {
    renderBlock, renderHub, renderModel,
    BLOCK_TYPES: Object.keys(RENDERERS),
    // expuestos para pruebas y para el validador/smoke
    _parseShape: parseShape, _shapeMatches: shapeMatches, _parseNumber: parseNumber, _fFactor: fFactor,
    _blankKey: blankKey, _drillCandidates: drillCandidates, _factorOptions: factorOptions,
    _valueOptions: valueOptions, _fFactorOpt: fFactorOpt, _parseFactor: parseFactor, _parseBytes: parseBytes,
    _parseNum: parseNum, _gradeParams: gradeParams, _nodeParams: nodeParams, _asksValue: asksValue,
    _changeText: changeText, _knobLabel: knobLabel, _knobShow: knobShow, _splitSegments: splitSegmentsOf, _factPairs: factPairs, _drillFacts: (R, cand) => factPairs(R.config, drillSide(R, cand)), _metricKind: metricKind, _metricLabel: (k, model) => metricLabel(k, model), _metricNote: (k, model) => metricNote(k, model), _fMetric: fMetric, _knobBase: knobBase,
    _metricValue: metricValue, _diagramForTensor: diagramForTensor, _fVsBase: fVsBase,
  };
})(typeof window !== 'undefined' ? window : globalThis);
