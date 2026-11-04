/* Lo que Cimientos hace en el navegador: el tema, el globo de las palabras del glosario, marcar lecciones como
   leídas, el buscador del glosario y el modo sin conexión. Todo se ve y se lee sin JavaScript: sin él, cada palabra
   subrayada lleva a su entrada del glosario. */
(function () {
  'use strict';
  var root = document.documentElement;
  var guardar = function (k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} };
  var leer = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };

  // ------------------------------------------------------------ tema: claro, oscuro o como el sistema
  var KTEMA = 'cimientos-tema';
  function getTema() { var t = leer(KTEMA); return t === 'light' || t === 'dark' ? t : 'auto'; }
  function aplicar(t) {
    if (t === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t);
    [].forEach.call(document.querySelectorAll('.tema [data-tema]'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-tema') === t)); });
  }
  aplicar(getTema());
  window.addEventListener('storage', function (e) { if (e.key === KTEMA) aplicar(getTema()); if (e.key === KLEIDAS) pintarLeidas(); });

  // ------------------------------------------------------------ lecciones leídas (solo en este navegador)
  var KLEIDAS = 'cimientos-leidas';
  function leidas() { try { var a = JSON.parse(leer(KLEIDAS) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function pintarLeidas() {
    var l = leidas();
    [].forEach.call(document.querySelectorAll('[data-leida]'), function (b) { b.setAttribute('aria-pressed', String(l.indexOf(b.getAttribute('data-leida')) >= 0)); });
    [].forEach.call(document.querySelectorAll('[data-leccion]'), function (a) { a.classList.toggle('leida', l.indexOf(a.getAttribute('data-leccion')) >= 0); });
    var av = document.querySelector('[data-avance]');
    if (av) {
      var pub = av.getAttribute('data-avance').split(' ').filter(Boolean);
      var n = pub.filter(function (id) { return l.indexOf(id) >= 0; }).length;
      if (!av.hasAttribute('data-def')) av.setAttribute('data-def', av.textContent);
      av.textContent = n ? av.getAttribute('data-def') + ' Llevas ' + n + ' leída' + (n === 1 ? '' : 's') + '.' : av.getAttribute('data-def');
    }
  }
  pintarLeidas();

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
    var left = Math.min(Math.max(m, r.left + r.width / 2 - w / 2), window.innerWidth - w - m);
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
  [].forEach.call(document.querySelectorAll('a.g'), function (a) { a.setAttribute('aria-haspopup', 'dialog'); a.setAttribute('aria-expanded', 'false'); });

  document.addEventListener('click', function (ev) {
    var t = ev.target && ev.target.closest ? ev.target : null;
    if (!t) return;
    var b = t.closest('.tema [data-tema]');
    if (b) { var tema = b.getAttribute('data-tema'); guardar(KTEMA, tema === 'auto' ? null : tema); aplicar(tema); return; }
    var g = t.closest('a.g');
    if (g && !ev.metaKey && !ev.ctrlKey && !ev.shiftKey && ev.button === 0) {
      if (abrir(g, ev.detail === 0)) { ev.preventDefault(); return; }
    }
    if (t.closest('.g-pop-x')) { cerrar(true); return; }
    if (pop && !pop.hidden && !t.closest('.g-pop')) cerrar(false);
    var l = t.closest('[data-leida]');
    if (l) {
      var id = l.getAttribute('data-leida'), lista = leidas(), i = lista.indexOf(id);
      if (i >= 0) lista.splice(i, 1); else lista.push(id);
      guardar(KLEIDAS, JSON.stringify(lista));
      pintarLeidas();
    }
  });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') cerrar(true); });
  window.addEventListener('resize', function () { if (abierto) colocar(abierto); });
  window.addEventListener('scroll', function () { if (abierto && !window.matchMedia('(max-width: 600px)').matches) colocar(abierto); }, { passive: true });

  // ------------------------------------------------------------ abrir la tarjeta a la que apunta el enlace (#k-…)
  function abrirDestino() {
    var h = decodeURIComponent(location.hash.slice(1)), el = h && document.getElementById(h);
    if (el && el.tagName === 'DETAILS') el.open = true;
  }
  abrirDestino();
  window.addEventListener('hashchange', abrirDestino);

  // ------------------------------------------------------------ buscador del glosario
  var buscar = document.querySelector('[data-buscar-en]');
  if (buscar) {
    var norm = function (s) { return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim(); };
    buscar.addEventListener('input', function () {
      var q = norm(buscar.value), alguno = false;
      [].forEach.call(document.querySelectorAll('.c-letra'), function (sec) {
        var visibles = 0;
        [].forEach.call(sec.querySelectorAll(buscar.getAttribute('data-buscar-en')), function (el) {
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
