/* «Cómo se usa» (demo only): the 2-minute tutorial video with chapters, shown on the home route.
   It lives outside #app because app.js rewrites #app on every render: a video inside it would stop playing.
   app.js renders the hero; when it is on screen this script shows the section and adds a hero button that jumps to it.
   On any other route the section hides and the video pauses. The service worker never touches /video/*.mp4. */
const CHAPTERS = [
  [5.0, 'Tus proyectos'],
  [11.5, 'Retoma donde te quedaste'],
  [22.6, 'Lee el mapa'],
  [35.2, 'Abre un paso'],
  [43.2, 'Haz las cuentas de la puerta'],
  [63.3, 'Ciérralo y míralo en el mapa'],
  [74.2, 'Registra cada sesión'],
  [96.2, 'Conéctalo con Claude Code'],
  [110.6, 'Crea tu propio proyecto'],
];
const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

function mount() {
  const app = document.getElementById('app');
  const sec = document.createElement('section');
  sec.className = 'wrap demo-video';
  sec.id = 'como-se-usa';
  sec.lang = 'es';
  sec.hidden = true;
  sec.setAttribute('aria-labelledby', 'demo-video-h');
  sec.innerHTML = `<div class="card demo-video__card">
    <div class="demo-video__head">
      <span class="kick">Cómo se usa · 2 min</span>
      <h2 id="demo-video-h" tabindex="-1">El tablero, paso a paso</h2>
      <p class="demo-video__lead">Un recorrido por este mismo demo, del mapa del proyecto a la conexión con Claude Code. Lleva subtítulos en español: no necesitas sonido.</p>
      <p class="small" lang="en">A 2-minute walkthrough of this demo, with Spanish subtitles.</p>
    </div>
    <div class="demo-video__frame">
      <video controls preload="none" playsinline poster="/video/como-se-usa.jpg" width="1920" height="1080" aria-label="Video: cómo se usa el tablero, 2 min 17 s">
        <source src="/video/como-se-usa.mp4" type="video/mp4">
      </video>
    </div>
    <h3 class="k demo-video__k" id="demo-video-caps">Capítulos</h3>
    <ol class="demo-video__chapters" aria-labelledby="demo-video-caps">${CHAPTERS.map(([t, name]) =>
      `<li><button type="button" data-t="${t}"><span class="demo-video__t">${clock(t)} ·</span> <span>${name}</span></button></li>`).join('')}</ol>
  </div>`;
  app.insertAdjacentElement('afterend', sec);

  const video = sec.querySelector('video');
  const buttons = [...sec.querySelectorAll('[data-t]')];
  sec.querySelector('ol').addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    const t = Number(b.dataset.t);
    const seek = () => { video.currentTime = t; video.play().catch(() => {}); };
    // with preload="none" the browser knows nothing yet: load the metadata first, then jump
    if (video.readyState >= 1) seek(); else { video.addEventListener('loadedmetadata', seek, { once: true }); video.load(); }
  });
  let current = -1;
  video.addEventListener('timeupdate', () => {
    let i = -1;
    for (let k = 0; k < CHAPTERS.length; k++) if (video.currentTime >= CHAPTERS[k][0] - 0.05) i = k;
    if (i === current) return;
    current = i;
    buttons.forEach((b, k) => { if (k === i) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
  });

  // the hero belongs to app.js and is redrawn often: after each render, show/hide the section and re-add the button
  const sync = () => {
    const hero = app.querySelector('.hero');
    if (!hero) {
      if (!sec.hidden) { video.pause(); sec.hidden = true; }
      return;
    }
    sec.hidden = false;
    const row = hero.querySelector('.row');
    if (row && !row.querySelector('[data-demo-video]')) {
      const jump = document.createElement('button');
      jump.type = 'button';
      jump.className = 'btn';
      jump.lang = 'es';
      jump.dataset.demoVideo = '';
      jump.innerHTML = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg> Cómo se usa · 2 min';
      jump.addEventListener('click', () => {
        const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
        sec.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
        sec.querySelector('h2').focus({ preventScroll: true });
      });
      row.append(jump);
    }
  };
  new MutationObserver(sync).observe(app, { childList: true });
  sync();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
