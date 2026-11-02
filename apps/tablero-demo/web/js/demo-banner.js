/* Banner of the demo: says what this is, links back and resets the demo's data. */
const REPO = 'https://github.com/ErikPalacios/ML_from_scratch/tree/main/apps/tablero-ml';
const HOME = 'https://ml-desde-cero.vercel.app';

function reset() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('tml-demo:') || k.startsWith('tml:')) localStorage.removeItem(k);
  } catch { /* nothing to clear */ }
  location.hash = '#/';
  location.reload();
}

function mount() {
  const bar = document.createElement('aside');
  bar.className = 'demo-banner';
  bar.setAttribute('aria-label', 'About this demo');
  bar.innerHTML = '<p><strong>Live demo.</strong> The sample project has made-up numbers. Edit anything: your changes stay in this browser and nothing is sent anywhere.</p>'
    + `<p class="demo-banner__links"><button type="button" class="btn btn--ghost" id="demo-reset">Reset demo</button> <a href="${REPO}">Source code</a> <a href="${HOME}">ML desde cero</a></p>`;
  const header = document.querySelector('header.bar');
  header.insertAdjacentElement('afterend', bar);
  bar.querySelector('#demo-reset').addEventListener('click', () => { if (confirm('Reset the demo? Your edits will be lost.')) reset(); });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
