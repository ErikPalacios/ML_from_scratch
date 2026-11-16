/* Lo poco que la app hace en el navegador: el selector de tema, los botones de copiar, la animación de la T
   en las páginas Dojo y el modo sin conexión.
   La app no corre nada del dojo: eso pasa en tu Mac. */
(function () {
  'use strict';
  var KEY = 'taller-tema', root = document.documentElement;

  // Tema: claro, oscuro o como el sistema. La elección se recuerda en este navegador.
  function getTema() { try { var t = localStorage.getItem(KEY); return t === 'light' || t === 'dark' ? t : 'auto'; } catch (e) { return 'auto'; } }
  function aplicar(t) {
    if (t === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t);
    [].forEach.call(document.querySelectorAll('.tema [data-tema]'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-tema') === t)); });
  }
  aplicar(getTema());

  document.addEventListener('click', function (ev) {
    var t = ev.target && ev.target.closest ? ev.target : null;
    if (!t) return;
    var b = t.closest('.tema [data-tema]');
    if (b) {
      var tema = b.getAttribute('data-tema');
      try { if (tema === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, tema); } catch (e) {}
      aplicar(tema);
      return;
    }
  });
  window.addEventListener('storage', function (e) { if (e.key === KEY) aplicar(getTema()); });

  // La T de vidrio del Dojo entra etapa por etapa (como TrueMLMark.play). Sin animación si así lo pide el sistema.
  var quieto = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var ETAPAS = ['datos', 'modelo', 'api', 'contenedor', 'orquestacion', 'monitoreo'];
  [].forEach.call(document.querySelectorAll('.d-hero-mark svg'), function (t3) {
    if (!t3.animate || quieto) return;
    ETAPAS.forEach(function (sk, i) {
      [].forEach.call(t3.querySelectorAll('[data-stage="' + sk + '"]'), function (g) {
        var lb = g.getAttribute('data-kind') === 'label', o = g.style.opacity || '1';
        g.animate(lb ? [{ opacity: 0 }, { opacity: o }] : [{ opacity: 0, transform: 'translate(0px,-28px)' }, { opacity: o, transform: 'translate(0px,0px)' }],
          { duration: lb ? 420 : 640, delay: 150 + i * 140 + (lb ? 320 : 0), easing: 'cubic-bezier(.2,.85,.25,1)', fill: 'backwards' });
      });
    });
  });

  // Portada: pasar por una etapa de la lista la enciende en la T de al lado (como TrueMLMark.sync) y lo dice abajo.
  var lista = document.querySelector('.d-etapas'), bloque = lista && lista.closest('.d-home'), cap = bloque && bloque.querySelector('.d-t-cap');
  function encender(sk) {
    [].forEach.call(bloque.querySelectorAll('.d-home-t [data-stage]'), function (g) {
      var lit = !sk || g.getAttribute('data-stage') === sk;
      g.style.transition = 'opacity .3s ease';
      g.style.opacity = lit ? '1' : g.getAttribute('data-dim');
    });
    if (cap) {
      var et = sk && lista.querySelector('[data-etapa="' + sk + '"] .d-etapa-h');
      cap.textContent = et ? et.querySelector('b').textContent + ' · ' + et.querySelector('span').textContent : cap.getAttribute('data-def');
    }
  }
  if (lista && bloque) {
    [].forEach.call(lista.querySelectorAll('[data-etapa]'), function (el) {
      el.addEventListener('mouseenter', function () { encender(el.getAttribute('data-etapa')); });
    });
    lista.addEventListener('mouseleave', function () { encender(null); });
  }

  // El mapa de la portada: la estación bajo el cursor (o con el foco) se queda, las demás se apagan, y el centro
  // dice cuál es y qué sale de ella. Al salir, el centro vuelve a su texto (data-def).
  var metro = document.querySelector('.d-metro');
  if (metro) {
    if (quieto && metro.pauseAnimations) metro.pauseAnimations();
    var c = ['.m-c1', '.m-c2', '.m-c3'].map(function (q) { return metro.querySelector(q); });
    var actual = null;
    var resaltar = function (a) {
      if (a === actual) return;
      if (actual) actual.classList.remove('m-on');
      actual = a;
      metro.classList.toggle('m-foco', !!a);
      if (a) a.classList.add('m-on');
      var txt = a ? ['ESTACIÓN ' + a.getAttribute('data-num') + ' · ' + a.getAttribute('data-etapa').toUpperCase(), a.getAttribute('data-titulo'), 'sale: ' + a.getAttribute('data-sale')] : null;
      c.forEach(function (el, k) { if (el) el.textContent = txt ? txt[k] : el.getAttribute('data-def'); });
    };
    metro.addEventListener('mouseover', function (e) { resaltar(e.target.closest ? e.target.closest('[data-st]') : null); });
    metro.addEventListener('mouseleave', function () { resaltar(null); });
    metro.addEventListener('focusin', function (e) { resaltar(e.target.closest ? e.target.closest('[data-st]') : null); });
    metro.addEventListener('focusout', function () { resaltar(null); });
  }

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
  }
})();
