/* =============================================================================
   Atlas de Arquitecturas — js/ui/math.js
   Basado en apps/transformer-lab/js/ui/math.js (TL.MathTex → ATLAS.MathTex).
   ATLAS.MathTex: envoltorio de MathJax 3 (salida SVG) con caché LRU (SPEC §1).

   API
     ATLAS.MathTex.ready                  -> Promise<boolean>  (true: MathJax usable; false: no cargó en 8 s)
     ATLAS.MathTex.isReady()              -> boolean
     ATLAS.MathTex.render(latex, el, { display = false } = {}) -> el
         Síncrono si MathJax está listo; si no, deja un marcador provisional y lo encola.
         Sin MathJax (sin red): el código LaTeX en monoespaciada (<code class="tex-fallback">),
         legible y nunca roto. Las fórmulas en bloque van dentro de <span class="tex-display">.
     ATLAS.MathTex.typeset(el)            -> Promise   (compone \( … \) y \[ … \] de un subárbol HTML)
     ATLAS.MathTex.toHTML(latex, display) -> string    (SVG en caché o respaldo; útil para plantillas)
     ATLAS.MathTex.clearCache()
     ATLAS.MathTex.upgrade(el)            -> número de fórmulas provisionales ya compuestas dentro de el
   Si MathJax llega tarde (tras los 8 s de espera), las fórmulas de respaldo se sustituyen solas por
   las compuestas y se emite el evento 'atlas:mathjax-ready' en window.
   Los nodos dentro de un elemento .no-tex nunca se componen.
   Config (en index.html, antes de MathJax):
       window.MathJax = { tex: { inlineMath: [['\\(', '\\)']], displayMath: [['\\[', '\\]']] },
                          svg: { fontCache: 'global' }, startup: { typeset: false } };
   Con fontCache 'global' los glifos viven en un <svg id="MJX-SVG-global-cache"> del documento;
   tras la primera conversión se llama a updateDocument() para insertarlo.
   ========================================================================== */
(function (root) {
  'use strict';
  const ATLAS = (root.ATLAS = root.ATLAS || {});
  const doc = root.document;

  const TIMEOUT_MS = 8000;
  const CACHE_MAX = 800;
  const SKIP_TAGS = /^(SCRIPT|NOSCRIPT|STYLE|TEXTAREA|PRE|CODE|MJX-CONTAINER|SVG|MATH)$/i;

  let mj = null;            // objeto MathJax ya inicializado
  let failed = false;       // true si venció el tiempo de espera
  let cacheChecked = false; // ¿ya está el <svg> de glifos globales en el documento?
  const cache = new Map();  // clave → cadena HTML (LRU por orden de inserción)
  const pending = new Map(); // el → { latex, display } (render encolado antes de estar listo)
  let serial = Promise.resolve(); // serializa los typesetPromise de MathJax

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------------------------------------------------------------- espera a MathJax
  function mathJaxUsable() {
    const M = root.MathJax;
    return !!(M && M.startup && M.startup.promise && typeof M.tex2svg === 'function');
  }

  const ready = new Promise((resolve) => {
    if (!doc) { failed = true; resolve(false); return; }
    const t0 = Date.now();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      if (ok) mj = root.MathJax; else failed = true;
      flushPending();
      resolve(ok);
      if (!ok) watchLate();
    };
    const poll = () => {
      if (done) return;
      if (mathJaxUsable()) {
        root.MathJax.startup.promise.then(() => finish(true), () => finish(false));
        return;
      }
      if (Date.now() - t0 > TIMEOUT_MS) { finish(false); return; }
      setTimeout(poll, 40);
    };
    poll();
    // límite duro también para startup.promise
    setTimeout(() => finish(mathJaxUsable() && !!root.MathJax.startup.document), TIMEOUT_MS + 50);
  });

  function isReady() { return !!mj; }

  // ---------------------------------------------------------------- MathJax que llega tarde
  // Tras el tiempo de espera se sigue vigilando (evento load del script y sondeo cada segundo
  // durante un minuto). Si MathJax aparece, se componen las fórmulas de respaldo ya dibujadas.
  let lateWatch = false;
  function watchLate() {
    if (lateWatch || !doc) return;
    lateWatch = true;
    const t0 = Date.now();
    let timer = 0, upgrading = false;
    const check = () => {
      if (mj || upgrading) return;
      if (mathJaxUsable()) {
        upgrading = true;
        clearTimeout(timer);
        root.MathJax.startup.promise.then(upgradeLate, () => { upgrading = false; });
        return;
      }
      if (Date.now() - t0 < 60000) timer = setTimeout(check, 1000);
    };
    const s = doc.getElementById('MathJax-script');
    if (s) s.addEventListener('load', () => setTimeout(check, 0));
    timer = setTimeout(check, 1000);
  }
  function upgradeLate() {
    if (mj || !mathJaxUsable()) return;
    mj = root.MathJax;
    failed = false;
    cache.clear();
    cacheChecked = false;
    for (const c of Array.from(doc.querySelectorAll('.tex-fallback[data-tex], .tex-lite[data-tex]'))) {
      if (!c.isConnected) continue;
      const display = c.dataset.display === '1';
      const wrap = display && c.parentElement && c.parentElement.classList.contains('tex-display') ? c.parentElement : c;
      const tmp = doc.createElement('span');
      tmp.innerHTML = convert(c.dataset.tex, display);
      wrap.replaceWith.apply(wrap, Array.from(tmp.childNodes));
    }
    try { root.dispatchEvent(new Event('atlas:mathjax-ready')); } catch (e) { /* nada */ }
  }

  // ---------------------------------------------------------------- conversión con caché
  // (data-tex guarda el LaTeX original: si MathJax llega tarde, se compone en su sitio)
  // why: 'error' si MathJax está cargado pero no pudo componer esta fórmula (si no, no está disponible)
  function fallbackHTML(latex, display, why) {
    const title = why === 'error' ? 'Fórmula sin componer (MathJax no pudo procesarla)' : 'Fórmula sin componer (MathJax no disponible)';
    const code = '<code class="tex-fallback" title="' + title + '" data-tex="' + esc(latex) +
      '" data-display="' + (display ? 1 : 0) + '">' + esc(latex) + '</code>';
    return display ? '<span class="tex-display">' + code + '</span>' : code;
  }
  function liteHTML(latex, display) {
    const lite = esc(latex);
    const s = '<span class="tex-lite" data-tex="' + esc(latex) + '" data-display="' + (display ? 1 : 0) + '">' + lite + '</span>';
    return display ? '<span class="tex-display">' + s + '</span>' : s;
  }
  // marcador provisional mientras carga MathJax: versión unicode aproximada (sin parpadeo de LaTeX crudo)
  function pendingHTML(latex, display) {
    const lite = esc(latex);
    const s = '<span class="tex-pending">' + lite + '</span>';
    return display ? '<span class="tex-display">' + s + '</span>' : s;
  }

  // Macros que MathJax carga bajo demanda («autoload», p. ej. \boldsymbol): la primera conversión
  // lanza un error con e.retry (una promesa). Ese resultado NO se guarda en la caché: se deja un
  // marcador provisional (versión unicode) y, cuando llega el paquete, se compone en su sitio.
  const retryTries = new Map(); // clave → intentos (evita un bucle si el paquete nunca llega)
  function retryHTML(latex, display) {
    const lite = esc(latex);
    const s = '<span class="tex-pending tex-retry" data-tex="' + esc(latex) + '" data-display="' + (display ? 1 : 0) + '">' + lite + '</span>';
    return display ? '<span class="tex-display">' + s + '</span>' : s;
  }
  function waitRetry(p) {
    Promise.resolve(p).catch(() => {}).then(() => setTimeout(() => {
      const n = upgradeRetries(doc);
      if (n) { try { root.dispatchEvent(new Event('atlas:mathjax-retry')); } catch (e) { /* nada */ } }
    }, 0));
  }
  // sustituye los marcadores provisionales de un subárbol (conectado o no) por la fórmula compuesta
  function upgradeRetries(scope) {
    if (!mj || !scope || typeof scope.querySelectorAll !== 'function') return 0;
    let n = 0;
    for (const c of Array.from(scope.querySelectorAll('.tex-retry[data-tex]'))) {
      const display = c.dataset.display === '1';
      const wrap = display && c.parentElement && c.parentElement.classList.contains('tex-display') ? c.parentElement : c;
      if (!wrap.parentNode) continue;
      const tmp = doc.createElement('span');
      tmp.innerHTML = convert(c.dataset.tex, display);
      wrap.replaceWith.apply(wrap, Array.from(tmp.childNodes));
      n++;
    }
    return n;
  }

  function ensureGlobalCache() {
    if (cacheChecked || !mj) return;
    if (doc.getElementById('MJX-SVG-global-cache')) { cacheChecked = true; return; }
    try { mj.startup.document.updateDocument(); } catch (e) { /* sin documento: los glifos no resolverán */ }
    cacheChecked = !!doc.getElementById('MJX-SVG-global-cache');
  }

  function convert(latex, display) {
    const key = (display ? 'D' : 'I') + latex;
    const hit = cache.get(key);
    if (hit !== undefined) {
      cache.delete(key);
      cache.set(key, hit);
      return hit;
    }
    let html;
    try {
      const node = mj.tex2svg(latex, { display: !!display });
      ensureGlobalCache();
      html = node.outerHTML;
      if (display) html = '<span class="tex-display">' + html + '</span>';
    } catch (e) {
      const tries = retryTries.get(key) || 0;
      if (e && e.retry && tries < 5) {
        retryTries.set(key, tries + 1);
        waitRetry(e.retry);
        return retryHTML(latex, display); // provisional: no se guarda en la caché
      }
      html = fallbackHTML(latex, display, 'error');
    }
    retryTries.delete(key);
    cache.set(key, html);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    return html;
  }

  function toHTML(latex, display) {
    latex = String(latex == null ? '' : latex);
    if (mj) return convert(latex, display);
    if (failed) return fallbackHTML(latex, display);
    return pendingHTML(latex, display);
  }

  // ---------------------------------------------------------------- render
  // opts.lite: sin MathJax, mostrar la versión unicode aproximada (para nombres cortos: W_Q → W_Q con subíndice)
  function render(latex, el, opts) {
    if (!el) return el;
    const display = !!(opts && opts.display);
    const lite = !!(opts && opts.lite);
    latex = String(latex == null ? '' : latex);
    if (mj) {
      pending.delete(el);
      el.innerHTML = convert(latex, display);
    } else if (failed) {
      el.innerHTML = lite ? liteHTML(latex, display) : fallbackHTML(latex, display);
    } else {
      el.innerHTML = pendingHTML(latex, display);
      pending.set(el, { latex, display, lite });
    }
    return el;
  }

  function flushPending() {
    const jobs = Array.from(pending.entries());
    pending.clear();
    for (const [el, j] of jobs) render(j.latex, el, { display: j.display, lite: j.lite });
  }

  // ---------------------------------------------------------------- typeset (HTML con \( \) y \[ \])
  // Divide un texto en segmentos {text} / {tex, display}. Devuelve null si hay un delimitador sin cerrar.
  function splitMath(s) {
    const out = [];
    let i = 0, last = 0;
    while (i < s.length) {
      const k = s.indexOf('\\', i);
      if (k < 0 || k + 1 >= s.length) break;
      const c = s[k + 1];
      if (c === '(' || c === '[') {
        const close = c === '(' ? '\\)' : '\\]';
        const e = s.indexOf(close, k + 2);
        if (e < 0) return null;
        if (k > last) out.push({ text: s.slice(last, k) });
        out.push({ tex: s.slice(k + 2, e), display: c === '[' });
        i = last = e + 2;
      } else {
        i = k + 2; // otra barra (\\, \$…): se salta
      }
    }
    if (last < s.length) out.push({ text: s.slice(last) });
    return out;
  }

  function collectTextNodes(el) {
    const nodes = [];
    const walker = doc.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */, {
      acceptNode(n) {
        for (let p = n.parentNode; p && p !== el.parentNode; p = p.parentNode) {
          // tex-fallback: ya es código LaTeX; no-tex: texto del usuario (tokens), nunca es LaTeX
          if (p.nodeType === 1 && (SKIP_TAGS.test(p.nodeName) || (p.classList && (p.classList.contains('tex-fallback') || p.classList.contains('no-tex'))))) return 2; // REJECT
        }
        return n.nodeValue.indexOf('\\(') >= 0 || n.nodeValue.indexOf('\\[') >= 0 ? 1 : 3; // ACCEPT : SKIP
      },
    });
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    return nodes;
  }

  function typesetNow(el) {
    let broken = false;
    for (const node of collectTextNodes(el)) {
      const parts = splitMath(node.nodeValue);
      if (!parts) { broken = true; continue; }
      const frag = doc.createDocumentFragment();
      for (const p of parts) {
        if (p.text !== undefined) { frag.appendChild(doc.createTextNode(p.text)); continue; }
        const span = doc.createElement('span');
        span.className = p.display ? 'tex tex--display' : 'tex';
        if (p.display) span.dataset.tex = p.tex; // la app puede volver a partirla si no cabe
        span.innerHTML = mj ? convert(p.tex, p.display) : fallbackHTML(p.tex, p.display);
        frag.appendChild(span);
      }
      node.parentNode.replaceChild(frag, node);
    }
    if (broken && mj && typeof mj.typesetPromise === 'function') {
      // delimitadores partidos entre nodos: que MathJax se encargue (serializado)
      serial = serial.then(() => {
        try { if (mj.typesetClear) mj.typesetClear([el]); } catch (e) { /* nada */ }
        return mj.typesetPromise([el]);
      }).then(() => ensureGlobalCache(), () => {});
      return serial;
    }
    return Promise.resolve();
  }

  function typeset(el) {
    if (!el || !doc) return Promise.resolve();
    if (mj || failed) return typesetNow(el); // sin MathJax (ya descartado): el respaldo, también al instante
    return ready.then(() => typesetNow(el));
  }

  function clearCache() { cache.clear(); }

  ATLAS.MathTex = { ready, isReady, render, typeset, toHTML, clearCache, upgrade: upgradeRetries, _splitMath: splitMath };
})(typeof window !== 'undefined' ? window : globalThis);
