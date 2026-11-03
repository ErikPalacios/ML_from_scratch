/* Lo poco que la app hace en el navegador: el selector de tema, los botones de copiar y el modo sin conexión.
   La app no corre nada del taller: eso pasa en tu Mac. */
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
      var src = document.getElementById(c.getAttribute('data-copiar'));
      if (!src) return;
      var texto = src.tagName === 'TEMPLATE' ? src.content.textContent : src.textContent;
      var antes = c.textContent;
      copiarTexto(texto.replace(/\n$/, '')).then(function () {
        c.textContent = 'Copiado ✓'; c.classList.add('ok');
        setTimeout(function () { c.textContent = antes; c.classList.remove('ok'); }, 1600);
      }, function () { c.textContent = 'No se pudo copiar'; });
    }
  });
  window.addEventListener('storage', function (e) { if (e.key === KEY) aplicar(getTema()); });

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
  }
})();
