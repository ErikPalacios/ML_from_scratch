/* =============================================================================
   Atlas de Arquitecturas — js/core/quantities.js
   ATLAS.Quantities: resuelve {{configId.path}} (y {{path}} con la config de la página) en prosa
   (SPEC §6.6). Todos los números salen de ATLAS.Arch.run / metrics. Sin DOM.

   API:
     fill(html, {config}) → html     reemplaza cada {{…}}; las claves desconocidas quedan como
                                      <span class="q-unknown" data-key="…">¿…?</span> (aviso visible).
     get(key, {config}?) → {value, text} | null     key = 'vit-b16-224.params.total' o, con
                                      opts.config, 'params.total'.
     keys(configId) → [paths]         paths SIN el prefijo de config (p. ej. 'params.total').
     has(key, {config}?) → bool
   Paths:
     label · id
     params.total | params.totalM · macs.total | macs.totalG | macs.totalM · flops.total |
     flops.totalG · other.total | other.totalG   (…G = número con prefijo: '17.56 G'; la prosa añade ' MACs')
     macs.totalGMACs | flops.totalGFLOPs | macs.text | flops.text   (unidad pegada: '17.56 GMACs', '35.13 GFLOPs')
     tokens (y cualquier clave de quantities, también como quantities.<k>)
     tensor.<id>.shape | .sym | .elements
     node.<id>.params | .paramsM | .paramsPct | .macs | .macsG | .macsM | .macsPct | .flops | .flopsG
     op.<id>.params | .macs | .paramArith | .macArith | .repeat
     prim.<prim>.params | .macs   ·   group.<g>.params | .macs
     cfg.<key>                         (valores de la config resuelta; enteros < 10,000 sin separador
                                        de miles, como en las formas: 'D = 1024' junto a '197×1024')
     metrics.<k>                       (ATLAS.Arch.metrics con B = 1, bf16; bytes con ATLAS.Arch.fmt.bytes,
                                        unidades decimales: 1 KB = 1000 B → '931.4 KB', '173.1 MB'. Unidad por
                                        el mapa metrics.units del modelo o por el nombre: …Mem, …Mem2x,
                                        …MemAllLayers, …Cache = bytes; …Share = %; 'ratio' = 3 cifras;
                                        'macs' = fmt.ops, p. ej. '1.81 GMACs' — solo por el mapa units)
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});

  const RE = /\{\{\s*([A-Za-z0-9_.\-]+)\s*\}\}/g;
  const keyCache = {};

  const arch = () => {
    if (!ATLAS.Arch || !ATLAS.Arch.run) throw new Error('ATLAS.Quantities necesita ATLAS.Arch (js/arch/primitives.js).');
    return ATLAS.Arch;
  };

  // Separa 'vit-b16-224.params.total' → ['vit-b16-224', 'params.total'] (config conocida al inicio).
  function split(key, opts) {
    const A = arch();
    const i = key.indexOf('.');
    if (i > 0 && A.hasConfig(key.slice(0, i))) return [key.slice(0, i), key.slice(i + 1)];
    if (A.hasConfig(key)) return [key, 'label'];
    const def = opts && opts.config;
    return def ? [def, key] : [null, key];
  }

  const num = (value, text) => ({ value, text });

  function resolvePath(configId, path) {
    const A = arch(), f = A.fmt;
    let r;
    try { r = A.run(configId); } catch (e) { return null; }
    const t = r.totals;
    const parts = path.split('.');
    const head = parts[0];

    switch (path) {
      case 'label': return num(r.label, r.label);
      case 'id': return num(r.id, r.id);
      case 'params.total': return num(t.params, f.int(t.params));
      case 'params.totalM': return num(t.params / 1e6, (t.params / 1e6).toFixed(t.params >= 1e7 ? 1 : (t.params >= 1e5 ? 2 : 4)) + ' M');
      case 'macs.total': return num(t.macs, f.int(t.macs));
      case 'macs.totalG': return num(t.macs / 1e9, (t.macs / 1e9).toFixed(2) + ' G');
      case 'macs.totalM': return num(t.macs / 1e6, (t.macs / 1e6).toFixed(1) + ' M');
      case 'flops.total': return num(t.flops, f.int(t.flops));
      case 'flops.totalG': return num(t.flops / 1e9, (t.flops / 1e9).toFixed(2) + ' G');
      case 'other.total': return num(t.other, f.int(t.other));
      case 'other.totalG': return num(t.other / 1e9, (t.other / 1e9).toFixed(2) + ' G');
      // Con unidad pegada (formato único: '17.56 GMACs', '35.13 GFLOPs'). Las claves *G de arriba
      // siguen dando solo el número con prefijo ('17.56 G') porque la prosa ya escribe ' MACs' detrás.
      case 'macs.totalGMACs': return num(t.macs / 1e9, (t.macs / 1e9).toFixed(2) + ' GMACs');
      case 'flops.totalGFLOPs': return num(t.flops / 1e9, (t.flops / 1e9).toFixed(2) + ' GFLOPs');
      case 'macs.text': return num(t.macs, f.ops(t.macs, 'MACs'));
      case 'flops.text': return num(t.flops, f.ops(t.flops, 'FLOPs'));
      default: break;
    }
    if (parts.length === 1 && Object.prototype.hasOwnProperty.call(r.quantities, head)) return qty(r.quantities[head]);
    if (head === 'quantities' && parts.length === 2 && Object.prototype.hasOwnProperty.call(r.quantities, parts[1])) return qty(r.quantities[parts[1]]);

    if (head === 'tensor' && parts.length === 3) {
      const x = r.tensors[parts[1]];
      if (!x) return null;
      if (parts[2] === 'shape') return num(x.num.slice(), f.shape(x, 'num'));
      if (parts[2] === 'sym') return num(x.sym.slice(), f.shape(x, 'sym'));
      if (parts[2] === 'elements') return num(x.elements, f.int(x.elements));
      return null;
    }
    if (head === 'node' && parts.length === 3) {
      const n = t.byNode[parts[1]];
      if (!n) return null;
      return nodeLike(n, parts[2], t);
    }
    if ((head === 'prim' || head === 'group') && parts.length === 3) {
      const n = (head === 'prim' ? t.byPrim : t.byGroup)[parts[1]];
      if (!n) return null;
      return nodeLike(n, parts[2], t);
    }
    if (head === 'op' && parts.length === 3) {
      const op = r.ops.find((o) => o.id === parts[1]);
      if (!op) return null;
      switch (parts[2]) {
        case 'params': return num(op.params, f.int(op.params));
        case 'macs': return num(op.macs, f.int(op.macs));
        case 'paramArith': return num(op.paramArith, op.paramArith);
        case 'macArith': return num(op.macArith, op.macArith);
        case 'repeat': return num(op.repeat, String(op.repeat));
        default: return null;
      }
    }
    if (head === 'cfg' && parts.length === 2) {
      const c = r.config;
      if (!Object.prototype.hasOwnProperty.call(c, parts[1])) return null;
      const v = c[parts[1]];
      // Dimensiones (D = 1024, D_mlp = 3072) sin separador, igual que en las formas '197×1024'.
      if (typeof v === 'number') return num(v, Number.isInteger(v) && Math.abs(v) < 10000 ? String(v) : f.int(v));
      if (typeof v === 'boolean') return num(v, v ? 'sí' : 'no');
      if (typeof v === 'string') return num(v, v);
      return null;
    }
    if (head === 'metrics' && parts.length === 2) {
      let m;
      try { m = A.metrics(configId, {}); } catch (e) { return null; }
      if (!Object.prototype.hasOwnProperty.call(m, parts[1])) return null;
      const v = m[parts[1]];
      if (typeof v !== 'number') return null;
      // Unidad: la del mapa del modelo (metrics.units: {clave: 'bytes'|'pct'|'ratio'|'count'}) o, si no
      // está, por el nombre: …Mem, …Mem2x, …MemAllLayers, …MemBatch, …Cache = bytes; …Share = fracción.
      const unit = (m.units && m.units[parts[1]]) || metricUnitByName(parts[1]);
      if (unit === 'bytes') return num(v, f.bytes(v));
      if (unit === 'pct') return num(v, f.pct(v));
      if (unit === 'ratio') return num(v, fRatio(v));
      // 'macs' (mapa units del modelo): cómputo con el formato único de la app (fmt.ops): '1.81 GMACs', '2.98 TMACs'.
      if (unit === 'macs') return num(v, f.ops(v));
      if (parts[1] === 'scoreToLinear') return num(v, v.toFixed(2));
      return num(v, f.int(v));
    }
    return null;
  }

  function metricUnitByName(k) {
    if (/Mem(\d+x|AllLayers|Batch|PerSample|Layer)?$|Cache$/.test(k)) return 'bytes';
    if (/Share$/.test(k)) return 'pct';
    return 'count';
  }
  // Cociente adimensional con 3 cifras significativas: 504.925 → '505', 9.5 → '9.5'. Si el redondeo da un
  // entero de una cifra que NO es exacto (1.004), se escriben 2 decimales ('1.00'): "1" leería como idéntico.
  function fRatio(v) {
    const x = Number(v.toPrecision(3));
    if (Math.abs(x) < 10 && Number.isInteger(x) && v !== x) return v.toFixed(2);
    return Math.abs(x) >= 1000 ? arch().fmt.int(x) : String(x);
  }

  function qty(v) {
    const f = arch().fmt;
    if (typeof v === 'number') return num(v, Number.isInteger(v) ? f.int(v) : String(+v.toFixed(4)));
    if (typeof v === 'string') return num(v, v);
    return null;
  }

  function nodeLike(n, field, t) {
    const f = arch().fmt;
    switch (field) {
      case 'params': return num(n.params, f.int(n.params));
      case 'paramsM': return num(n.params / 1e6, (n.params / 1e6).toFixed(n.params >= 1e7 ? 1 : 2) + ' M');
      case 'paramsPct': return num(t.params ? n.params / t.params : 0, f.pct(t.params ? n.params / t.params : 0));
      case 'macs': return num(n.macs, f.int(n.macs));
      case 'macsG': return num(n.macs / 1e9, (n.macs / 1e9).toFixed(2) + ' G');
      case 'macsM': return num(n.macs / 1e6, (n.macs / 1e6).toFixed(1) + ' M');
      case 'macsPct': return num(t.macs ? n.macs / t.macs : 0, f.pct(t.macs ? n.macs / t.macs : 0));
      case 'flops': return num(2 * n.macs, f.int(2 * n.macs));
      case 'flopsG': return num(2 * n.macs / 1e9, (2 * n.macs / 1e9).toFixed(2) + ' G');
      default: return null;
    }
  }

  function get(key, opts) {
    if (typeof key !== 'string' || !key) return null;
    const [cid, path] = split(key.trim(), opts);
    if (!cid) return null;
    return resolvePath(cid, path);
  }

  function has(key, opts) { return get(key, opts) !== null; }

  function keys(configId) {
    if (keyCache[configId]) return keyCache[configId].slice();
    const A = arch();
    const r = A.run(configId);
    const out = ['label', 'id', 'params.total', 'params.totalM', 'macs.total', 'macs.totalG', 'macs.totalM',
      'flops.total', 'flops.totalG', 'other.total', 'other.totalG', 'macs.totalGMACs', 'flops.totalGFLOPs', 'macs.text', 'flops.text'];
    for (const k of Object.keys(r.quantities)) { out.push(k); out.push('quantities.' + k); }
    for (const id of r.order) ['shape', 'sym', 'elements'].forEach((x) => out.push('tensor.' + id + '.' + x));
    const nf = ['params', 'paramsM', 'paramsPct', 'macs', 'macsG', 'macsM', 'macsPct', 'flops', 'flopsG'];
    for (const id of Object.keys(r.totals.byNode)) nf.forEach((x) => out.push('node.' + id + '.' + x));
    for (const id of Object.keys(r.totals.byPrim)) ['params', 'macs'].forEach((x) => out.push('prim.' + id + '.' + x));
    for (const id of Object.keys(r.totals.byGroup)) ['params', 'macs'].forEach((x) => out.push('group.' + id + '.' + x));
    for (const op of r.ops) ['params', 'macs', 'paramArith', 'macArith', 'repeat'].forEach((x) => out.push('op.' + op.id + '.' + x));
    for (const k of Object.keys(r.config)) {
      const v = r.config[k];
      if (['number', 'boolean', 'string'].indexOf(typeof v) >= 0) out.push('cfg.' + k);
    }
    const m = A.metrics(configId, {});
    for (const k of Object.keys(m)) if (typeof m[k] === 'number') out.push('metrics.' + k);
    keyCache[configId] = Array.from(new Set(out));
    return keyCache[configId].slice();
  }

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // Claves usadas en un html (para el validador).
  function scan(html) {
    const out = [];
    String(html || '').replace(RE, (m, k) => { out.push(k); return m; });
    return out;
  }

  function fill(html, opts) {
    if (html === null || html === undefined) return html;
    return String(html).replace(RE, (m, key) => {
      const q = get(key, opts);
      if (!q) return '<span class="q-unknown" data-key="' + esc(key) + '" title="Cantidad desconocida">¿' + esc(key) + '?</span>';
      return esc(q.text);
    });
  }

  ATLAS.Quantities = { fill, get, has, keys, scan, PATTERN: RE };
})(typeof window !== 'undefined' ? window : globalThis);
