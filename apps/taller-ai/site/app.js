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

  // Copiar: el botón copia el texto del <pre> o <template> al que apunta data-copiar.
  function copiarViejo(texto) {
    var ta = document.createElement('textarea');
    ta.value = texto; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } finally { document.body.removeChild(ta); }
    return ok ? Promise.resolve() : Promise.reject(new Error('copy'));
  }
  function copiarTexto(texto) {
    // El API moderno puede negarse (sin permiso, o fuera de https): entonces se usa el método clásico.
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(texto).catch(function () { return copiarViejo(texto); });
    return copiarViejo(texto);
  }

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
    var c = t.closest('[data-copiar]');
    if (c) {
      if (c.closest('summary')) ev.preventDefault(); // el botón vive en el resumen: copiar no abre ni cierra
      var src = document.getElementById(c.getAttribute('data-copiar'));
      if (!src) return;
      var texto = src.tagName === 'TEMPLATE' ? src.content.textContent : src.textContent;
      var toast = document.querySelector('.d-toast');
      if (toast) { // páginas Dojo: un aviso abajo en lugar de cambiar el botón
        copiarTexto(texto.replace(/\n$/, '')).then(function () { avisar(toast, 'Copiado al portapapeles'); }, function () { avisar(toast, 'No se pudo copiar'); });
        return;
      }
      var antes = c.textContent;
      copiarTexto(texto.replace(/\n$/, '')).then(function () {
        c.textContent = 'Copiado ✓'; c.classList.add('ok');
        setTimeout(function () { c.textContent = antes; c.classList.remove('ok'); }, 1600);
      }, function () { c.textContent = 'No se pudo copiar'; });
    }
  });
  window.addEventListener('storage', function (e) { if (e.key === KEY) aplicar(getTema()); });

  var tToast;
  function avisar(el, txt) {
    el.textContent = txt; el.classList.add('on');
    clearTimeout(tToast); tToast = setTimeout(function () { el.classList.remove('on'); }, 1600);
  }

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

  // Portada: pasar por una etapa de la lista la enciende en la T (como TrueMLMark.sync) y lo dice abajo.
  var lista = document.querySelector('.d-etapas'), cap = document.querySelector('.d-t-cap');
  function encender(sk) {
    [].forEach.call(document.querySelectorAll('.d-home-t [data-stage]'), function (g) {
      var lit = !sk || g.getAttribute('data-stage') === sk;
      g.style.transition = 'opacity .3s ease';
      g.style.opacity = lit ? '1' : g.getAttribute('data-dim');
    });
    if (cap) {
      var et = sk && lista.querySelector('[data-etapa="' + sk + '"] .d-etapa-h');
      cap.textContent = et ? et.querySelector('b').textContent + ' · ' + et.querySelector('span').textContent : cap.getAttribute('data-def');
    }
  }
  if (lista) {
    [].forEach.call(lista.querySelectorAll('[data-etapa]'), function (el) {
      el.addEventListener('mouseenter', function () { encender(el.getAttribute('data-etapa')); });
    });
    lista.addEventListener('mouseleave', function () { encender(null); });
  }

  // El anillo del mapa: la estación bajo el cursor se queda y las demás se apagan.
  var anillo = document.querySelector('.d-anillo');
  if (anillo) {
    if (quieto && anillo.pauseAnimations) anillo.pauseAnimations();
    var resaltar = function (a) {
      [].forEach.call(anillo.querySelectorAll('[data-st]'), function (g) { g.style.transition = 'opacity .25s ease'; g.style.opacity = !a || g === a ? '1' : '.3'; });
    };
    anillo.addEventListener('mouseover', function (e) { resaltar(e.target.closest ? e.target.closest('[data-st]') : null); });
    anillo.addEventListener('mouseleave', function () { resaltar(null); });
  }

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
  }
})();
