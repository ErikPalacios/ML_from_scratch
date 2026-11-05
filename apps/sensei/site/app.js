/* Lo que Sensei hace en el navegador: el tema, el cajón del índice en el celular, el buscador de la barra lateral,
   «En esta página», los diagramas (con el motor de la Ronda, /diagram.js), el globo de las palabras del glosario,
   marcar lecciones como leídas y el modo sin conexión. Todo se lee sin JavaScript: sin él, cada palabra subrayada
   lleva a su entrada del glosario y cada diagrama se ve como una lista de sus partes. */
(function () {
  'use strict';
  var root = document.documentElement;
  var guardar = function (k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} };
  var leer = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };
  var $$ = function (q, el) { return [].slice.call((el || document).querySelectorAll(q)); };
  var angosto = function () { return window.matchMedia('(max-width: 767px)').matches; };

  // ------------------------------------------------------------ tema: el del sistema, claro u oscuro
  var KTEMA = 'sensei-tema';
  function getTema() { var t = leer(KTEMA); return t === 'light' || t === 'dark' ? t : 'auto'; }
  function aplicar(t) {
    if (t === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t);
    $$('.tema [data-tema]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-tema') === t)); });
  }
  aplicar(getTema());

  // ------------------------------------------------------------ lecciones leídas (solo en este navegador)
  var KLEIDAS = 'sensei-leidas';
  function leidas() { try { var a = JSON.parse(leer(KLEIDAS) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function pintarLeidas() {
    var l = leidas();
    var publicadas = $$('.sidebar a.nav__item[data-leccion]').map(function (a) { return a.getAttribute('data-leccion'); });
    var n = publicadas.filter(function (id) { return l.indexOf(id) >= 0; }).length;
    $$('[data-leida]').forEach(function (b) { b.setAttribute('aria-pressed', String(l.indexOf(b.getAttribute('data-leida')) >= 0)); });
    $$('[data-leccion]').forEach(function (a) {
      var si = l.indexOf(a.getAttribute('data-leccion')) >= 0;
      if (a.tagName === 'I') a.classList.toggle('is-leida', si && a.classList.contains('is-lista')); else a.classList.toggle('leida', si);
    });
    $$('[data-prog]').forEach(function (el) { el.textContent = n + '/' + publicadas.length; });
    $$('[data-prog-n]').forEach(function (el) { el.textContent = String(n); });
    // «Empezar» se vuelve «Seguir» con la primera lección publicada que no has leído
    var seguir = document.querySelector('[data-seguir]');
    if (seguir && n) {
      var sig = $$('.sidebar a.nav__item[data-leccion]').filter(function (a) { return l.indexOf(a.getAttribute('data-leccion')) < 0; })[0];
      if (sig) { seguir.setAttribute('href', sig.getAttribute('href')); seguir.textContent = 'Seguir: ' + sig.querySelector('.nav__title').textContent; }
      else seguir.textContent = 'Leíste todo lo publicado ✓';
    }
  }
  pintarLeidas();
  window.addEventListener('storage', function (e) { if (e.key === KTEMA) aplicar(getTema()); if (e.key === KLEIDAS) pintarLeidas(); });

  // ------------------------------------------------------------ cajón del índice (celular)
  var side = document.getElementById('sidebar'), fondo = document.querySelector('.backdrop'), btnMenu = document.querySelector('.topbar [data-cajon="abrir"]');
  function cajon(abrir) {
    if (!side) return;
    side.classList.toggle('is-open', abrir);
    if (fondo) fondo.hidden = !abrir;
    root.classList.toggle('drawer-open', abrir);
    if (btnMenu) btnMenu.setAttribute('aria-expanded', String(abrir));
    if (abrir) { var a = side.querySelector('[aria-current="page"]') || side.querySelector('input'); if (a && a.scrollIntoView) a.scrollIntoView({ block: 'center' }); }
    else if (btnMenu && angosto()) btnMenu.focus();
  }
  var actual = side && side.querySelector('.nav [aria-current="page"]');
  if (actual && !angosto()) { var nav = side.querySelector('.nav'); nav.scrollTop = Math.max(0, actual.offsetTop - nav.clientHeight / 2); }

  // ------------------------------------------------------------ buscador de la barra lateral
  var input = document.querySelector('[data-buscar-nav]'), res = input && input.parentNode.querySelector('.side-res'), INDICE = null;
  var norm = function (s) { return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim(); };
  function cargarIndice() {
    if (INDICE) return Promise.resolve(INDICE);
    return fetch('/indice.json').then(function (r) { return r.json(); }).then(function (d) { INDICE = d; return d; }).catch(function () { INDICE = { lecciones: [], conceptos: [] }; return INDICE; });
  }
  function buscar() {
    var q = norm(input.value);
    // el índice de la barra lateral se filtra por título
    $$('.nav__group').forEach(function (g) {
      var hay = 0;
      $$('.nav__item', g).forEach(function (it) { var ok = !q || norm(it.getAttribute('data-buscar') || '').indexOf(q) >= 0; it.parentNode.classList.toggle('is-hidden', !ok); it.classList.toggle('is-hidden', !ok); if (ok) hay++; });
      g.classList.toggle('is-hidden', !hay);
      if (q && hay) g.open = true;
    });
    if (!q || q.length < 2) { res.hidden = true; res.innerHTML = ''; return; }
    cargarIndice().then(function (d) {
      var ls = d.lecciones.filter(function (x) { return norm(x.t).indexOf(q) >= 0; }).slice(0, 5);
      var cs = d.conceptos.filter(function (x) { return norm(x.t + ' ' + x.en).indexOf(q) >= 0; })
        .concat(d.conceptos.filter(function (x) { return norm(x.t + ' ' + x.en).indexOf(q) < 0 && norm(x.c).indexOf(q) >= 0; })).slice(0, 8);
      var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); };
      res.innerHTML = (ls.map(function (x) { return '<li><a href="' + x.u + '">' + esc(x.n + ' · ' + x.t) + '<small>Lección · ' + esc(x.m) + '</small></a></li>'; }).join('') +
        cs.map(function (x) { return '<li><a href="' + x.u + '">' + esc(x.t) + '<small>' + esc(x.en ? x.en + ' · ' : '') + 'Glosario</small></a></li>'; }).join('')) || '<li class="vacio">Nada coincide todavía.</li>';
      res.hidden = false;
    });
  }
  if (input) {
    input.addEventListener('input', buscar);
    input.addEventListener('focus', cargarIndice);
    input.addEventListener('keydown', function (e) {
      var items = $$('a', res); if (!items.length) return;
      var i = items.indexOf(res.querySelector('.is-sel'));
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (i >= 0) items[i].classList.remove('is-sel'); i = (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; items[i].classList.add('is-sel'); }
      else if (e.key === 'Enter' && i >= 0) { e.preventDefault(); location.href = items[i].getAttribute('href'); }
    });
  }

  // ------------------------------------------------------------ «En esta página»: la sección que estás leyendo
  var secs = $$('.sec[id]');
  if (secs.length && 'IntersectionObserver' in window) {
    var marcar = function (id) { $$('.toc__link').forEach(function (a) { a.classList.toggle('is-current', a.getAttribute('href') === '#' + id); }); };
    var vis = {};
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { vis[e.target.id] = e.isIntersecting; });
      var primera = secs.filter(function (s) { return vis[s.id]; })[0];
      if (primera) marcar(primera.id);
    }, { rootMargin: '-10% 0px -70% 0px' });
    secs.forEach(function (s) { io.observe(s); });
  }

  // ------------------------------------------------------------ diagramas: el motor de la Ronda
  function dibujarDiagramas() {
    if (!window.MSD || !window.MSD.Diagram) return;
    $$('.dg-mount:not(.is-listo)').forEach(function (m) {
      try {
        var d = JSON.parse(m.querySelector('script[type="application/json"]').textContent);
        var fig = window.MSD.Diagram.render(d.spec, { id: m.getAttribute('data-dg'), title: m.getAttribute('data-titulo'), caption: d.caption });
        m.appendChild(fig);
        m.classList.add('is-listo');
      } catch (e) { /* se queda la lista de partes */ }
    });
  }
  if (document.querySelector('.dg-mount')) {
    if (window.MSD && window.MSD.Diagram) dibujarDiagramas();
    else window.addEventListener('load', dibujarDiagramas);
  }

  // ------------------------------------------------------------ calculadoras (tools/calculadora.mjs las dibuja con sus valores iniciales)
  var MATH = ['exp', 'log', 'log2', 'log10', 'sqrt', 'pow', 'min', 'max', 'abs', 'round', 'floor', 'ceil', 'sin', 'cos', 'PI', 'E'];
  function fijo(n, d) { return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function auto(n) { return Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 10 ? 1 : 2; }
  function formatear(x, f, dec) {
    if (typeof x !== 'number' || !isFinite(x)) return '—';
    var d = (dec === undefined || dec === null) ? null : dec;
    if (f === 'int') return fijo(Math.round(x), 0);
    if (f === 'pct') return fijo(x * 100, d === null ? 1 : d) + ' %';
    if (f === 'sci') { if (x === 0) return '0'; var e = Math.floor(Math.log10(Math.abs(x))); return fijo(x / Math.pow(10, e), d === null ? 2 : d) + ' × 10^' + e; }
    if (f === 'bytes') { var u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'], k = 0, n = x; while (Math.abs(n) >= 1000 && k < u.length - 1) { n /= 1000; k++; } return fijo(n, d === null ? auto(n) : d) + ' ' + u[k]; }
    if (f === 'ms') return Math.abs(x) >= 1000 ? fijo(x / 1000, d === null ? 2 : d) + ' s' : fijo(x, d === null ? auto(x) : d) + ' ms';
    if (f === 'x') return fijo(x, d === null ? auto(x) : d) + '×';
    return fijo(x, d === null ? auto(x) : d);
  }
  function compilar(formula, nombres) {
    try { return new Function(nombres.join(','), 'var ' + MATH.map(function (m) { return m + '=Math.' + m; }).join(',') + '; return (' + formula + ');'); }
    catch (e) { return function () { return NaN; }; }
  }
  $$('.cx-calc[data-calc]').forEach(function (fig) {
    var spec; try { spec = JSON.parse(fig.getAttribute('data-calc')); } catch (e) { return; }
    var ins = $$('input[data-id]', fig);
    function recalcular() {
      var v = {};
      ins.forEach(function (i) {
        var id = i.getAttribute('data-id'), x = parseFloat(i.value);
        v[id] = isFinite(x) ? x : 0;
        var o = fig.querySelector('[data-out="' + id + '"]');
        var e = spec.entradas.filter(function (q) { return q.id === id; })[0] || {};
        var paso = String(i.step || ''), dec = paso.indexOf('.') >= 0 ? paso.split('.')[1].length : 0;
        if (o) o.textContent = formatear(v[id], 'num', dec) + (e.unidad ? ' ' + e.unidad : '');
      });
      spec.calculos.forEach(function (c) { var ks = Object.keys(v); v[c.id] = compilar(c.formula, ks).apply(null, ks.map(function (k) { return v[k]; })); });
      var ks = Object.keys(v), vals = ks.map(function (k) { return v[k]; });
      var ys = spec.salidas.map(function (s) { try { return compilar(s.formula, ks).apply(null, vals); } catch (e) { return NaN; } });
      var maxB = 1e-12;
      spec.salidas.forEach(function (s, k) { if (s.barra && s.formato !== 'pct' && isFinite(ys[k])) maxB = Math.max(maxB, Math.abs(ys[k])); });
      spec.salidas.forEach(function (s, k) {
        var el = fig.querySelector('[data-salida="' + k + '"]');
        if (el) el.textContent = formatear(ys[k], s.formato, s.decimales);
        var b = fig.querySelector('[data-barra="' + k + '"]');
        if (b) { var w = s.formato === 'pct' ? ys[k] : Math.abs(ys[k]) / maxB; b.style.width = (Math.max(0, Math.min(1, isFinite(w) ? w : 0)) * 100).toFixed(1) + '%'; }
      });
    }
    ins.forEach(function (i) { i.addEventListener('input', recalcular); });
    fig.classList.add('is-viva');
  });

  // ------------------------------------------------------------ el globo
  var datosEl = document.getElementById('g-datos'), DATOS = {};
  try { DATOS = datosEl ? JSON.parse(datosEl.textContent) : {}; } catch (e) { DATOS = {}; }
  var pop = document.querySelector('.g-pop'), abierto = null;
  var aqui = location.pathname.replace(/index\.html$/, '');
  function liga(url, txt) { return url ? '<a href="' + url + '">' + txt + '</a>' : txt; }
  function abrir(a, porTeclado) {
    var id = a.getAttribute('data-g'), d = DATOS[id];
    if (!d || !pop) return false;
    pop.querySelector('.g-pop-t').textContent = d.t;
    pop.querySelector('.g-pop-en').textContent = d.en;
    pop.querySelector('.g-pop-def').innerHTML = d.c;   // HTML que generó el build a partir del glosario
    var donde = [];
    if (d.p) donde.push(d.p[0] === aqui ? 'Se presenta en esta lección.' : 'Se presenta en ' + liga(d.p[0] + '#k-' + id, '«' + d.p[1] + '»') + '.');
    if (d.f) donde.push('A fondo en ' + liga(d.f[0], '«' + d.f[1] + '»') + (d.f[2] ? ' (próximamente, ' + d.f[2] + ')' : '') + '.');
    pop.querySelector('.g-pop-donde').innerHTML = donde.join(' ');
    pop.querySelector('.g-pop-ir').setAttribute('href', '/glosario/#g-' + id);
    if (abierto && abierto !== a) abierto.setAttribute('aria-expanded', 'false');
    abierto = a;
    a.setAttribute('aria-expanded', 'true');
    pop.hidden = false;
    colocar(a);
    if (porTeclado) pop.querySelector('.g-pop-x').focus();
    return true;
  }
  function colocar(a) {
    if (window.matchMedia('(max-width: 600px)').matches) { pop.style.left = ''; pop.style.top = ''; return; }
    var r = a.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight, m = 12;
    var vw = document.documentElement.clientWidth || window.innerWidth;   // sin la barra de desplazamiento
    var left = Math.min(Math.max(m, r.left + r.width / 2 - w / 2), vw - w - m);
    var top = r.bottom + 10;
    if (top + h > window.innerHeight - m && r.top - 10 - h > m) top = r.top - 10 - h;
    pop.style.left = left + 'px';
    pop.style.top = Math.max(m, top) + 'px';
  }
  function cerrar(devolverFoco) {
    if (!pop || pop.hidden) return;
    pop.hidden = true;
    if (abierto) { abierto.setAttribute('aria-expanded', 'false'); if (devolverFoco) abierto.focus(); }
    abierto = null;
  }
  $$('a.g').forEach(function (a) { a.setAttribute('aria-haspopup', 'dialog'); a.setAttribute('aria-expanded', 'false'); });

  document.addEventListener('click', function (ev) {
    var t = ev.target && ev.target.closest ? ev.target : null;
    if (!t) return;
    var b = t.closest('.tema [data-tema]');
    if (b) { var tema = b.getAttribute('data-tema'); guardar(KTEMA, tema === 'auto' ? null : tema); aplicar(tema); return; }
    var c = t.closest('[data-cajon]');
    if (c) { cajon(c.getAttribute('data-cajon') === 'abrir'); return; }
    if (angosto() && side && side.classList.contains('is-open') && t.closest('.sidebar a')) cajon(false);
    var g = t.closest('a.g');
    if (g && !ev.metaKey && !ev.ctrlKey && !ev.shiftKey && ev.button === 0) {
      if (abrir(g, ev.detail === 0)) { ev.preventDefault(); return; }
    }
    if (t.closest('.g-pop-x')) { cerrar(true); return; }
    if (pop && !pop.hidden && !t.closest('.g-pop')) cerrar(false);
    if (res && !res.hidden && !t.closest('.side-search')) res.hidden = true;
    var l = t.closest('[data-leida]');
    if (l) {
      var id = l.getAttribute('data-leida'), lista = leidas(), i = lista.indexOf(id);
      if (i >= 0) lista.splice(i, 1); else lista.push(id);
      guardar(KLEIDAS, JSON.stringify(lista));
      pintarLeidas();
    }
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') { cerrar(true); if (side && side.classList.contains('is-open')) cajon(false); if (res) res.hidden = true; }
    if (ev.key === '/' && input && !/INPUT|TEXTAREA/.test((document.activeElement || {}).tagName || '')) { ev.preventDefault(); if (angosto()) cajon(true); input.focus(); }
  });
  window.addEventListener('resize', function () { if (abierto) colocar(abierto); if (!angosto() && side && side.classList.contains('is-open')) cajon(false); });
  window.addEventListener('scroll', function () { if (abierto && !window.matchMedia('(max-width: 600px)').matches) colocar(abierto); }, { passive: true });

  // ------------------------------------------------------------ abrir la tarjeta a la que apunta el enlace (#k-…)
  function abrirDestino() {
    var h = decodeURIComponent(location.hash.slice(1)), el = h && document.getElementById(h);
    if (el && el.tagName === 'DETAILS') el.open = true;
  }
  abrirDestino();
  window.addEventListener('hashchange', abrirDestino);

  // ------------------------------------------------------------ buscador del glosario
  var buscarG = document.querySelector('[data-buscar-en]');
  if (buscarG) {
    buscarG.addEventListener('input', function () {
      var q = norm(buscarG.value), alguno = false;
      $$('.letra').forEach(function (sec) {
        var visibles = 0;
        $$(buscarG.getAttribute('data-buscar-en'), sec).forEach(function (el) {
          var ok = !q || el.getAttribute('data-buscar').indexOf(q) >= 0;
          el.hidden = !ok; if (ok) visibles++;
        });
        sec.hidden = !visibles; if (visibles) alguno = true;
      });
      var sin = document.querySelector('.c-sin');
      if (sin) sin.hidden = alguno;
    });
  }

  // ------------------------------------------------------------ sin conexión
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
  }
})();
