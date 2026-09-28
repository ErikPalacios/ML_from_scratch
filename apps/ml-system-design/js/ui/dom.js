/* =============================================================================
   Ronda de Diseño ML — js/ui/dom.js
   MSD.dom: utilidades de DOM compartidas (SPEC §4.2).
     h(tag, attrs, ...children)  esc(str)  icon(name)  copyText(text, fallbackEl)
     fmtDuration(sec)  slug(str)  + extras: fmtDate(ts)  toast(msg)  focusables(el)
   ========================================================================== */
(function (root) {
  'use strict';
  const MSD = (root.MSD = root.MSD || {});

  // Propiedades que se asignan como propiedad (no como atributo) para reflejar el estado real.
  const PROPS = { value: 1, checked: 1, disabled: 1, selected: 1, hidden: 1, indeterminate: 1, open: 1 };

  function append(el, child) {
    if (child == null || child === false || child === true) return;
    if (Array.isArray(child)) { child.forEach((c) => append(el, c)); return; }
    if (typeof child === 'string' || typeof child === 'number') { el.appendChild(document.createTextNode(String(child))); return; }
    if (child && typeof child.nodeType === 'number') el.appendChild(child);
  }

  /** h('button', {class:'btn', on:{click: fn}, 'aria-pressed':'false'}, 'Texto', otroNodo) */
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs && (typeof attrs !== 'object' || Array.isArray(attrs) || typeof attrs.nodeType === 'number')) {
      children.unshift(attrs);   // h('p', 'texto') también funciona
      attrs = null;
    }
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v == null) continue;
        if (k === 'class' || k === 'className') { const c = Array.isArray(v) ? v.filter(Boolean).join(' ') : v; if (c) el.className = c; }
        else if (k === 'text') el.textContent = String(v);
        else if (k === 'html') el.innerHTML = String(v);
        else if (k === 'on') { for (const ev of Object.keys(v)) if (typeof v[ev] === 'function') el.addEventListener(ev, v[ev]); }
        else if (k === 'dataset') { for (const d of Object.keys(v)) if (v[d] != null) el.dataset[d] = String(v[d]); }
        else if (k === 'style' && typeof v === 'object') {
          // acepta 'margin-top', '--var' o camelCase (marginTop)
          for (const p of Object.keys(v)) el.style.setProperty(p.indexOf('-') >= 0 ? p : p.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()), v[p]);
        }
        else if (PROPS[k]) el[k] = v;
        else if (v === false) continue;
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    children.forEach((c) => append(el, c));
    return el;
  }

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Íconos 16×16 de trazo (currentColor). Solo trazos simples: se leen bien a 14–18 px.
  const P = {
    check: '<path d="M3.2 8.4l3 3 6.6-7"/>',
    chevron: '<path d="M6 3.5L10.5 8 6 12.5"/>',
    'chevron-down': '<path d="M3.5 6L8 10.5 12.5 6"/>',
    menu: '<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/>',
    close: '<path d="M4 4l8 8M12 4l-8 8"/>',
    search: '<circle cx="7" cy="7" r="4.3"/><path d="M10.2 10.2l3.3 3.3"/>',
    timer: '<circle cx="8" cy="9" r="5.2"/><path d="M8 6.2V9l1.8 1.3M6.3 1.8h3.4"/>',
    play: '<path d="M5 3.2v9.6L12.6 8z"/>',
    pause: '<path d="M5.5 3.5v9M10.5 3.5v9"/>',
    reset: '<path d="M3.2 8a4.8 4.8 0 1 0 1.5-3.5"/><path d="M3 2.6v2.6h2.6"/>',
    copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1"/><path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/>',
    external: '<path d="M9.5 2.5h4v4M13.5 2.5L7.5 8.5M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3"/>',
    flag: '<path d="M3.5 14V2.5M3.5 3h8l-1.6 2.8L11.5 8.6h-8"/>',
    star: '<path d="M8 2.2l1.8 3.7 4 .6-2.9 2.8.7 4L8 11.4l-3.6 1.9.7-4L2.2 6.5l4-.6z"/>',
    book: '<path d="M2.5 3.5h3.8A1.7 1.7 0 0 1 8 5.2v8a1.4 1.4 0 0 0-1.4-1.4H2.5zM13.5 3.5H9.7A1.7 1.7 0 0 0 8 5.2v8a1.4 1.4 0 0 1 1.4-1.4h4.1z"/>',
    cases: '<rect x="2.5" y="4.5" width="11" height="8.5" rx="1"/><path d="M5.8 4.5V3a.8.8 0 0 1 .8-.8h2.8a.8.8 0 0 1 .8.8v1.5M2.5 8.2h11"/>',
    practice: '<circle cx="8" cy="8.8" r="5"/><path d="M8 6v2.8l2 1.2M6.4 2h3.2M12.6 4.2l.9-.9"/>',
    cards: '<rect x="2.5" y="4.5" width="9" height="9" rx="1"/><path d="M5 2.5h7.5a1 1 0 0 1 1 1V11"/>',
    ref: '<path d="M3.5 2.5h9v11h-9zM5.8 5.5h4.4M5.8 8h4.4M5.8 10.5h2.6"/>',
    sun: '<circle cx="8" cy="8" r="2.8"/><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1"/>',
    moon: '<path d="M13 9.6A5.5 5.5 0 0 1 6.4 3a5.5 5.5 0 1 0 6.6 6.6z"/>',
    system: '<rect x="2" y="3" width="12" height="8" rx="1"/><path d="M5.5 13.5h5M8 11v2.5"/>',
    'arrow-left': '<path d="M13 8H3.5M7.5 4L3.5 8l4 4"/>',
    'arrow-right': '<path d="M3 8h9.5M8.5 4l4 4-4 4"/>',
    info: '<circle cx="8" cy="8" r="6"/><path d="M8 7.2v4M8 4.9v.1"/>',
    warn: '<path d="M8 2.2l6.2 11H1.8z"/><path d="M8 6.5v3.2M8 11.4v.1"/>',
    skip: '<path d="M3 3.5l5 4.5-5 4.5zM8.5 3.5l5 4.5-5 4.5"/>',
    link: '<path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.9.9"/><path d="M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.3 9a2.6 2.6 0 0 0 3.7 3.7l.9-.9"/>',
    // extras
    home: '<path d="M2.5 7.2L8 2.8l5.5 4.4M4 6.2v7.3h8V6.2M6.6 13.5V9.8h2.8v3.7"/>',
    chat: '<path d="M2.5 3.5h11v7h-6l-3 2.6v-2.6h-2z"/>',
    approx: '<path d="M3 6.2c1.6-1.4 3.2-1.4 5 0s3.4 1.4 5 0M3 10.2c1.6-1.4 3.2-1.4 5 0s3.4 1.4 5 0"/>',
    question: '<circle cx="8" cy="8" r="6"/><path d="M6.3 6.2a1.8 1.8 0 0 1 3.5.6c0 1.2-1.8 1.5-1.8 2.7M8 11.3v.1"/>',
    note: '<path d="M3.5 2.5h6l3 3v8h-9zM9.5 2.5v3h3M5.8 8.5h4.4M5.8 11h3"/>',
    upload: '<path d="M8 10.5V2.8M4.8 5.8L8 2.6l3.2 3.2M2.8 10.5v2.7h10.4v-2.7"/>',
    download: '<path d="M8 2.6v7.8M4.8 7.3L8 10.5l3.2-3.2M2.8 10.5v2.7h10.4v-2.7"/>',
    database: '<ellipse cx="8" cy="4" rx="5" ry="1.8"/><path d="M3 4v8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8V4M3 8c0 1 2.2 1.8 5 1.8S13 9 13 8"/>',
    list: '<path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.1M2.5 8h.1M2.5 12h.1"/>',
    dot: '<circle cx="8" cy="8" r="2.5" fill="currentColor"/>',
  };
  const FILLED = { play: 1 };

  function icon(name) {
    const p = P[name];
    if (!p) return '';
    return '<svg class="ico ico--' + name + '" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false" fill="' +
      (FILLED[name] ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>';
  }

  function selectContents(el) {
    try {
      if (!el) return false;
      if (typeof el.select === 'function') { el.focus({ preventScroll: true }); el.select(); return true; }
      const r = document.createRange();
      r.selectNodeContents(el);
      const s = root.getSelection();
      s.removeAllRanges();
      s.addRange(r);
      return true;
    } catch (e) { return false; }
  }

  /** Copia al portapapeles. LLÁMALA dentro del manejador del clic (el permiso depende del gesto).
   *  Si el API falla (iframe sin permiso), selecciona el texto de fallbackEl para Cmd/Ctrl+C. → Promise<bool> */
  function copyText(text, fallbackEl) {
    const fallback = () => {
      let ok = false;
      if (fallbackEl && selectContents(fallbackEl)) {
        try { ok = !!document.execCommand('copy'); } catch (e) { ok = false; }
      } else {
        // área temporal fuera de pantalla
        const ta = document.createElement('textarea');
        ta.value = String(text);
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        try { ok = !!document.execCommand('copy'); } catch (e) { ok = false; }
        ta.remove();
      }
      return ok;
    };
    try {
      const nav = root.navigator;
      if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
        return nav.clipboard.writeText(String(text)).then(() => true, () => fallback());
      }
    } catch (e) { /* sigue al respaldo */ }
    return Promise.resolve(fallback());
  }

  /** 2699 → "44:59"; 3725 → "62:05"; negativos con signo. */
  function fmtDuration(sec) {
    const n = Math.round(Number(sec) || 0);
    const s = Math.abs(n);
    const m = Math.floor(s / 60);
    return (n < 0 ? '-' : '') + String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  function slug(str) {
    if (typeof MSD.slug === 'function') return MSD.slug(str);
    return String(str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  /** 1790000000000 → "28 sep 2026, 14:05" (hora local). */
  function fmtDate(ts, withTime) {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '—';
    const base = d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
    return withTime === false ? base : base + ', ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  /** Aviso breve y accesible (región viva #toasts de index.html). */
  function toast(msg, kind) {
    const host = document.getElementById('toasts');
    if (!host) return;
    const el = h('div', { class: 'toast' + (kind ? ' toast--' + kind : '') }, String(msg));
    host.appendChild(el);
    setTimeout(() => { el.classList.add('is-leaving'); setTimeout(() => el.remove(), 250); }, 3200);
  }

  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
  function focusables(container) {
    if (!container) return [];
    return Array.from(container.querySelectorAll(FOCUSABLE)).filter((el) => !el.closest('[hidden]') && el.getClientRects().length > 0);
  }

  const reducedMotion = () => !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);

  MSD.dom = { h, esc, icon, copyText, fmtDuration, slug, fmtDate, toast, focusables, reducedMotion, ICONS: Object.keys(P) };
})(typeof window !== 'undefined' ? window : globalThis);
