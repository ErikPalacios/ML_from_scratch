/* UI helpers: HTML escaping, icons, dates, toasts and dialogs. */
import { daysSince, localDate } from './shared/model.mjs';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Texto del usuario → HTML seguro: escapa todo y solo convierte `código` en <code>.
export const rich = (s) => esc(s).replace(/`([^`\n]+)`/g, '<code>$1</code>');

// Un enlace solo sale si es http(s), una ruta o un ancla (el modelo ya lo valida; esto es la segunda capa).
export function safeHref(href) {
  const h = String(href || '');
  return /^(https?:\/\/|#|\/)/.test(h) ? h : '#';
}
export const isExternal = (href) => /^https?:\/\//.test(href);

const P = {
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', alert: '<path d="M12 8v5M12 16.5v.5"/><path d="M10.3 3.9L2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  back: '<path d="M15 5l-7 7 7 7"/>', next: '<path d="M9 5l7 7-7 7"/>', up: '<path d="M6 15l6-6 6 6"/>', down: '<path d="M6 9l6 6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>', trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>', book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/>',
  log: '<path d="M7 4h11v16H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><path d="M9 9h6M9 13h6"/>', scale: '<path d="M12 4v16M6 20h12M5 8h14M5 8l-3 6h6zM19 8l-3 6h6z"/>',
  map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>', gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>', upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>', theme: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 0 0 17z" fill="currentColor"/>',
  play: '<path d="M7 5l11 7-11 7z"/>', terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M12 15h5"/>', out: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 8l-4 4 4 4M6 12h10"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
  fx: '<path d="M14 4h-2a3 3 0 0 0-3 3v13M6 11h7M15 13l5 6M20 13l-5 6"/>', calc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 12h2M12 12h2M16 12h0M8 16h2M12 16h2M16 16h0"/>',
};
export const icon = (name, label) => `<svg class="ic" viewBox="0 0 24 24" ${label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"'} focusable="false">${P[name] || ''}</svg>`;

export const todayLocal = () => localDate(new Date());
export const days = (iso) => daysSince(iso, Date.now());
export function daysText(n) {
  if (n === null || n === undefined) return 'no date';
  if (n === 0) return 'today';
  if (n === 1) return 'yesterday';
  return `${n} days ago`;
}
export const daysLevel = (n) => (n === null ? 'old' : n <= 2 ? 'ok' : n <= 6 ? 'mid' : 'old');
export function fmtDate(isoOrDate) {
  const d = isoOrDate.length === 10 ? new Date(isoOrDate + 'T12:00:00') : new Date(isoOrDate);
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

let toastTimer;
export function toast(msg, kind = 'info', ms = 3200) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = msg;
  el.dataset.kind = kind;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

// Diálogo modal con <dialog>. `body` es HTML ya escapado; `actions` = [{label, value, primary, danger}].
export function dialog({ title, body, actions = [{ label: 'Close', value: null }], onOpen }) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.innerHTML = `<form method="dialog" class="dlg">
      <header><h2>${esc(title)}</h2><button type="button" class="btn btn--ghost btn--icon" data-close aria-label="Close">${icon('x')}</button></header>
      <div class="body">${body}</div>
      <footer>${actions.map((a, i) => `<button class="btn ${a.primary ? 'btn--primary' : ''} ${a.danger ? 'btn--danger' : ''}" value="${i}" type="${a.primary && a.type !== 'button' ? 'submit' : 'button'}" data-i="${i}" ${a.type === 'button' ? 'data-keep' : ''}>${a.label}</button>`).join('')}</footer>
    </form>`;
    // Enter envía con el botón principal (el único type=submit); los demás cierran con su valor o, si son
    // acciones que no cierran (copiar, descargar), solo corren su handler.
    d.querySelector('[data-close]').addEventListener('click', () => d.close(''));
    d.querySelectorAll('footer button[type="button"]:not([data-keep])').forEach((b) => b.addEventListener('click', () => d.close(b.value)));
    d.addEventListener('click', (e) => { if (e.target === d) d.close(''); });
    d.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing || !e.target.matches('input:not([type="checkbox"])')) return;
      e.preventDefault();
      const primary = d.querySelector('footer button[type="submit"]');
      if (primary) primary.click();
    });
    document.body.appendChild(d);
    d.addEventListener('close', () => {
      const v = d.returnValue;
      const form = d.querySelector('form');
      const data = Object.fromEntries(new FormData(form).entries());
      d.remove();
      // Botones del cuerpo con value="v:…" (listas para elegir) devuelven ese valor tal cual.
      if (typeof v === 'string' && v.startsWith('v:')) { resolve({ value: v, data }); return; }
      const a = v === '' || v === undefined ? null : actions[Number(v)];
      resolve(a ? { value: a.value, data } : null);
    });
    d.showModal();
    if (onOpen) onOpen(d);
  });
}

export async function confirmDlg(title, text, okLabel = 'Yes', danger = false) {
  const r = await dialog({ title, body: `<p>${esc(text)}</p>`, actions: [{ label: 'Cancel', value: false }, { label: okLabel, value: true, primary: !danger, danger }] });
  return !!(r && r.value);
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch {}
    ta.remove();
    return ok;
  }
}

export function download(name, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
