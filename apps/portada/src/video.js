// El video de la portada: se reproduce solo, sin sonido y en bucle mientras se ve en pantalla.
// No se mueve con «reducir movimiento» ni con «ahorro de datos» (queda el póster y un botón para verlo).
// «Ver en grande» lo abre en un diálogo con controles y sonido del sistema.
(() => {
  const fig = document.querySelector('[data-p-video]');
  if (!fig) return;
  const chico = fig.querySelector('video');
  const pausa = fig.querySelector('[data-p-video-pausa]');
  const dlg = document.querySelector('[data-p-video-dlg]');
  const grande = dlg && dlg.querySelector('video');
  const quieto = matchMedia('(prefers-reduced-motion: reduce)').matches || (navigator.connection && navigator.connection.saveData);
  let pausadoAMano = !!quieto, visible = false;

  const pintar = () => {
    const corre = !chico.paused;
    pausa.setAttribute('aria-pressed', String(!corre));
    pausa.querySelector('span').textContent = corre ? 'Pausa' : 'Reproducir';
    fig.classList.toggle('p-video--corre', corre);
  };
  const intentar = () => {
    if (pausadoAMano || !visible || (dlg && dlg.open)) { chico.pause(); return; }
    if (chico.preload !== 'auto') { chico.preload = 'auto'; }
    const p = chico.play(); if (p && p.catch) p.catch(() => {});
  };
  chico.addEventListener('play', pintar); chico.addEventListener('pause', pintar);

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; intentar(); }, { threshold: 0.35 }).observe(chico);
  } else { visible = true; intentar(); }

  pausa.addEventListener('click', () => { pausadoAMano = !chico.paused; if (pausadoAMano) chico.pause(); else { visible = true; intentar(); } });

  if (!dlg || typeof dlg.showModal !== 'function') return;
  fig.querySelector('[data-p-video-abrir]').addEventListener('click', () => {
    chico.pause();
    dlg.showModal(); // en grande arranca desde el principio
    const p = grande.play(); if (p && p.catch) p.catch(() => {});
  });
  dlg.addEventListener('close', () => { grande.pause(); intentar(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.querySelector('[data-p-video-cerrar]').addEventListener('click', () => dlg.close());
})();
