/* TrueML · lo que hace la marca en el navegador (sin dependencias). Todo se activa con atributos data-*:
     .tm-tema [data-tema="light|dark|auto"]   selector de tema; la clave de localStorage sale de
                                               <html data-tema-clave="…"> (por defecto trueml-tema)
     [data-tm-escena]                          contenedor de la T; data-caption = texto de reposo
     [data-tm-caption]                         donde se escribe qué etapas cubre la herramienta
     [data-etapas="datos modelo"][data-nombre] al pasar el cursor o el foco, enciende esas etapas en la T
     [data-tm-sticky]                          la T fija, centrada en lo que queda de pantalla bajo [data-tm-nav]
   Sin JavaScript la página se ve completa: esto solo agrega el tema, el resaltado y la animación. */
(function () {
  'use strict';
  var root = document.documentElement, KEY = root.getAttribute('data-tema-clave') || 'trueml-tema';

  // ---- tema
  function getTema() { try { var t = localStorage.getItem(KEY); return t === 'light' || t === 'dark' ? t : 'auto'; } catch (e) { return 'auto'; } }
  function aplicar(t) {
    if (t === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t);
    [].forEach.call(document.querySelectorAll('.tm-tema [data-tema]'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-tema') === t)); });
  }
  aplicar(getTema());
  document.addEventListener('click', function (ev) {
    var b = ev.target && ev.target.closest && ev.target.closest('.tm-tema [data-tema]');
    if (!b) return;
    var t = b.getAttribute('data-tema');
    try { if (t === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, t); } catch (e) {}
    aplicar(t);
  });
  window.addEventListener('storage', function (e) { if (e.key === KEY) aplicar(getTema()); });

  // ---- la T: encender las etapas de una herramienta
  var escena = document.querySelector('[data-tm-escena]');
  var caption = document.querySelector('[data-tm-caption]');
  var reposo = escena ? escena.getAttribute('data-caption') || '' : '';
  function encender(lista) {
    if (!escena) return;
    [].forEach.call(escena.querySelectorAll('[data-stage]'), function (g) {
      var on = !lista || lista.indexOf(g.getAttribute('data-stage')) >= 0;
      g.style.transition = 'opacity .3s ease';
      g.style.opacity = on ? '1' : g.getAttribute('data-dim');
    });
  }
  var activo = null;
  function entrar(el) {
    if (activo === el) return;
    activo = el;
    encender(el.getAttribute('data-etapas').split(/\s+/));
    if (caption) caption.textContent = el.getAttribute('data-nombre') + ' · ' + el.getAttribute('data-resumen');
  }
  function salir() { activo = null; encender(null); if (caption) caption.textContent = reposo; }
  [].forEach.call(document.querySelectorAll('[data-etapas]'), function (el) {
    el.addEventListener('mouseenter', function () { entrar(el); });
    el.addEventListener('mouseleave', salir);
    el.addEventListener('focusin', function () { entrar(el); });
    el.addEventListener('focusout', function (e) { if (!el.contains(e.relatedTarget)) salir(); });
  });

  // ---- la T entra etapa por etapa (como TrueMLMark.play)
  if (escena && !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) {
    ['datos', 'modelo', 'api', 'contenedor', 'orquestacion', 'monitoreo'].forEach(function (sk, i) {
      [].forEach.call(escena.querySelectorAll('[data-stage="' + sk + '"]'), function (g) {
        if (!g.animate) return;
        var lb = g.getAttribute('data-kind') === 'label', o = g.style.opacity || '1';
        g.animate(lb ? [{ opacity: 0 }, { opacity: o }] : [{ opacity: 0, transform: 'translate(0px,-28px)' }, { opacity: o, transform: 'translate(0px,0px)' }],
          { duration: lb ? 420 : 640, delay: 150 + i * 140 + (lb ? 320 : 0), easing: 'cubic-bezier(.2,.85,.25,1)', fill: 'backwards' });
      });
    });
  }

  // ---- la T fija y centrada; en una sola columna se queda en su lugar
  var fija = document.querySelector('[data-tm-sticky]'), nav = document.querySelector('[data-tm-nav]');
  function colocar() {
    if (!fija) return;
    var una = getComputedStyle(fija.parentElement).gridTemplateColumns.trim().split(/\s+/).length < 2;
    fija.style.position = una ? 'relative' : 'sticky';
    if (una) { fija.style.top = '0px'; return; }
    var n = nav ? nav.offsetHeight : 74;
    fija.style.top = Math.max(n + 12, Math.round(n + (window.innerHeight - n - fija.offsetHeight) / 2)) + 'px';
  }
  if (fija) {
    colocar();
    window.addEventListener('resize', colocar);
    if (window.ResizeObserver) new ResizeObserver(colocar).observe(fija);
  }
})();
