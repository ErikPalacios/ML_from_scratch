/* TrueML · generador de la T de vidrio (SVG) + tema claro/oscuro. Uso: TrueMLMark.mark(vidrio, etiquetas, clave, maxAltura) */
(function () {
const MK = {};
  const ST = [
    ['datos', 'Datos', 'dataset', 'y'],
    ['modelo', 'Modelo', 'PyTorch', 'o'],
    ['api', 'API', 'FastAPI', 'g'],
    ['contenedor', 'Contenedor', 'Docker', 'b'],
    ['orquestacion', 'Orquestación', 'Kubernetes', 'p'],
    ['monitoreo', 'Monitoreo', 'Prometheus · Grafana', 'n']
  ];

  function mark(glass, labels, key, maxH) {
    const id = (glass ? 'g' : 'f') + (labels ? 'l' + (key || '') : '') + (maxH ? 'h' + String(maxH).replace(/[^a-z0-9]/gi, '') : '');
    if (MK[id]) return MK[id];
    const pre = 'tm' + id, C = 0.8660254, S = 0.5;
    const f = n => Math.round(n * 100) / 100, f4 = n => Math.round(n * 10000) / 10000;
    const B = [1e9, 1e9, -1e9, -1e9];
    const bb = (x, y) => { if (x < B[0]) B[0] = x; if (y < B[1]) B[1] = y; if (x > B[2]) B[2] = x; if (y > B[3]) B[3] = y; };
    const R = (x, y, z) => [(x - y) * C, (x + y) * S - z];
    const P = (x, y, z) => { const q = R(x, y, z); bb(q[0], q[1]); return q; };
    const pt = p => { const q = P(p[0], p[1], p[2]); return f(q[0]) + ',' + f(q[1]); };
    const hx = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const mix = (a, b, t) => { const A = hx(a), Z = hx(b); return '#' + A.map((v, i) => Math.round(v + (Z[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
    const K = {
      y: { t: '#FFC857', r: '#E8AE36', l: '#D99A1E', d: '#8F6210' },
      o: { t: '#FF8A5C', r: '#EC6A3F', l: '#D9532A', d: '#9A3414' },
      g: { t: '#3FD3A6', r: '#17B386', l: '#109A72', d: '#07644A' },
      b: { t: '#5C77FF', r: '#3D5AFE', l: '#2C45D6', d: '#16289A' },
      p: { t: '#9C8CFF', r: '#7A69EE', l: '#6150D9', d: '#3B2BA0' },
      n: { t: '#2A3566', r: '#1B2550', l: '#141C40', d: '#0A0F26' },
      s: { t: '#C3CDFF', r: '#8FA2FF', l: '#6E82EE', d: '#4A5CC8' },
      a: { t: '#FFB08F', r: '#FF8A5C', l: '#EC6A3F', d: '#B8441F' }
    };
    const defs = [], seen = {};
    let cur = [];
    const add = s => cur.push(s);
    const poly = (pts, fill, xa) => add(`<polygon points="${pts.map(pt).join(' ')}" fill="${fill}"${xa || ''}/>`);
    const box = (x0, x1, y0, y1, z0, z1, c) => {
      poly([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], c.l);
      poly([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], c.r);
      poly([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], c.t);
    };
    const side = (c, deg) => { const a = deg * Math.PI / 180, t = (.5 * Math.cos(a) + .2 * Math.sin(a) - .2) / .3; return t < 0 ? mix(c.l, c.d, Math.min(-t * .4, .5)) : t <= 1 ? mix(c.l, c.r, t) : mix(c.r, c.t, Math.min(t - 1, 1)); };
    const lg = k => { const g = pre + 'c' + k; if (!seen[g]) { seen[g] = 1; const c = K[k]; defs.push(`<linearGradient id="${g}"><stop offset="0" stop-color="${mix(c.l, c.d, .5)}"/><stop offset=".36" stop-color="${c.l}"/><stop offset=".74" stop-color="${c.r}"/><stop offset="1" stop-color="${mix(c.r, c.l, .4)}"/></linearGradient>`); } return g; };
    const rg = k => { const g = pre + 's' + k; if (!seen[g]) { seen[g] = 1; const c = K[k]; defs.push(`<radialGradient id="${g}" cx=".5" cy=".5" r=".5" fx=".64" fy=".3"><stop offset="0" stop-color="${mix(c.t, '#ffffff', .35)}"/><stop offset=".5" stop-color="${c.r}"/><stop offset="1" stop-color="${mix(c.l, c.d, .3)}"/></radialGradient>`); } return g; };
    const cyl = (cx, cy, r, z0, z1, ck, top, sideFill) => {
      const a = r * 1.2247449, b = r * .7071068, q = P(cx, cy, z0), sx = q[0], y0 = q[1], y1 = y0 - (z1 - z0);
      bb(sx - a, y1 - b); bb(sx + a, y0 + b);
      add(`<path d="M${f(sx - a)} ${f(y1)}V${f(y0)}A${f(a)} ${f(b)} 0 0 0 ${f(sx + a)} ${f(y0)}V${f(y1)}Z" fill="${sideFill || 'url(#' + lg(ck) + ')'}"/>`);
      if (top !== null) add(`<ellipse cx="${f(sx)}" cy="${f(y1)}" rx="${f(a)}" ry="${f(b)}" fill="${top || K[ck].t}"/>`);
    };
    const ex = glass ? 0 : 7, m = glass ? 3.6 : 0, H = glass ? 40 - 2 * m : 37, k = (18 - m) / 18, sh = glass ? .84 : 1;
    const datos = z0 => {
      const r = 18.5 - m, g = 2.4 * sh, dh = (H - 2 * g) / 3;
      for (let i = 0; i < 3; i++) { const zb = z0 + i * (dh + g); if (i) cyl(20, 20, r - 2.6 * sh, zb - g, zb, 'y', null, mix(K.y.l, K.y.d, .55)); cyl(20, 20, r, zb, zb + dh, 'y'); }
    };
    const red = z0 => {
      const L = [[20 - 18 * k, 20 + 10 * k, [.2, .5, .8]], [20, 20, [.08, .36, .64, .92]], [20 + 18 * k, 20 - 10 * k, [.3, .7]]].map(([x, y, zs]) => zs.map(t => [x, y, z0 + t * H]));
      const items = [], rr = 4.6 * (glass ? .88 : 1);
      for (let i = 0; i < L.length - 1; i++) L[i].forEach(a => L[i + 1].forEach(b => { const pa = P(a[0], a[1], a[2]), pb = P(b[0], b[1], b[2]); items.push([(a[0] + a[1] + a[2] + b[0] + b[1] + b[2]) / 2 - .01, `<line x1="${f(pa[0])}" y1="${f(pa[1])}" x2="${f(pb[0])}" y2="${f(pb[1])}" stroke="${K.o.l}" stroke-width="1.4" stroke-linecap="round"/>`]); }));
      L.flat().forEach(n => { const p = P(n[0], n[1], n[2]); bb(p[0] - rr, p[1] - rr); bb(p[0] + rr, p[1] + rr); items.push([n[0] + n[1] + n[2], `<circle cx="${f(p[0])}" cy="${f(p[1])}" r="${f(rr)}" fill="url(#${rg('o')})"/>`]); });
      items.sort((a, b) => a[0] - b[0]).forEach(i => add(i[1]));
    };
    const llaves = z0 => {
      const d = 'M37 6C25 6 25 12 25 24V38C25 46 21 50 9 50C21 50 25 54 25 62V76C25 88 25 94 37 94M63 6C75 6 75 12 75 24V38C75 46 79 50 91 50C79 50 75 54 75 62V76C75 88 75 94 63 94';
      const q = P(20, 20, z0 + H), g = H / 100, e = q[0] - 50 * g, dep = 5 * sh;
      bb(e + 3 * g, q[1] - dep); bb(e + 97 * g, q[1] + 100 * g);
      for (let j = dep; j >= 0; j -= .5) add(`<path d="${d}" transform="matrix(${f4(g)} 0 0 ${f4(g)} ${f(e)} ${f(q[1] - j)})" fill="none" stroke="${j ? K.g.t : K.g.l}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>`);
    };
    const contenedor = (ox, z0) => {
      const c = K.b, x0 = ox + 1 + m, x1 = ox + 39 - m, y0 = 8 + m * .6, y1 = 32 - m * .6, z1 = z0 + 25 - m * 1.2, fr = 1.7 * sh;
      box(x0, x1, y0, y1, z0, z1, c);
      const n = glass ? 9 : 10, xa = x0 + fr, p = (x1 - fr - xa) / n, hi = mix(c.l, c.r, .6), lo = mix(c.l, c.d, .5);
      for (let i = 0; i < n; i++) { const xs = xa + i * p + p * .2; poly([[xs, y1, z0 + fr], [xs + p * .3, y1, z0 + fr], [xs + p * .3, y1, z1 - fr], [xs, y1, z1 - fr]], hi); poly([[xs + p * .3, y1, z0 + fr], [xs + p * .55, y1, z0 + fr], [xs + p * .55, y1, z1 - fr], [xs + p * .3, y1, z1 - fr]], lo); }
      const fm = mix(c.l, c.d, .35), dm = mix(c.r, c.d, .4), ym = (y0 + y1) / 2, w = y1 - y0;
      poly([[x0, y1, z0], [x1, y1, z0], [x1, y1, z0 + fr], [x0, y1, z0 + fr]], fm);
      poly([[x0, y1, z1 - fr], [x1, y1, z1 - fr], [x1, y1, z1], [x0, y1, z1]], fm);
      [y0 + w * .175, ym - w * .11, ym + w * .11, y1 - w * .175].forEach(yy => poly([[x1, yy - .45, z0 + fr], [x1, yy + .45, z0 + fr], [x1, yy + .45, z1 - fr], [x1, yy - .45, z1 - fr]], dm));
      poly([[x1, ym - .2, z0], [x1, ym + .2, z0], [x1, ym + .2, z1], [x1, ym - .2, z1]], mix(c.r, c.d, .6));
      poly([[x1, y0, z0], [x1, y1, z0], [x1, y1, z0 + fr], [x1, y0, z0 + fr]], dm);
      poly([[x1, y0, z1 - fr], [x1, y1, z1 - fr], [x1, y1, z1], [x1, y0, z1]], dm);
      const s = 2 * sh;
      [[x0, z0], [x0, z1 - s], [x1 - s, z0], [x1 - s, z1 - s]].forEach(([xx, zz]) => poly([[xx, y1, zz], [xx + s, y1, zz], [xx + s, y1, zz + s], [xx, y1, zz + s]], c.d));
      [[y0, z0], [y0, z1 - s], [y1 - s, z0], [y1 - s, z1 - s]].forEach(([yy, zz]) => poly([[x1, yy, zz], [x1, yy + s, zz], [x1, yy + s, zz + s], [x1, yy, zz + s]], c.d));
      const rm = mix(c.t, c.r, .55);
      poly([[x0, y1 - fr, z1], [x1, y1 - fr, z1], [x1, y1, z1], [x0, y1, z1]], rm);
      poly([[x1 - fr, y0, z1], [x1, y0, z1], [x1, y1, z1], [x1 - fr, y1, z1]], rm);
    };
    const hexp = (cx, cy, Rr, z0, z1, c) => {
      const V = [0, 1, 2, 3, 4, 5].map(j => { const t = (30 + 60 * j) * Math.PI / 180; return [cx + Rr * Math.cos(t), cy + Rr * Math.sin(t)]; });
      [[5, 0, 0], [0, 1, 60], [1, 2, 120]].forEach(([i, j, a]) => poly([[V[i][0], V[i][1], z0], [V[j][0], V[j][1], z0], [V[j][0], V[j][1], z1], [V[i][0], V[i][1], z1]], side(c, a)));
      poly(V.map(v => [v[0], v[1], z1]), c.t);
    };
    const cluster = z0 => {
      [[180, .5], [300, .64], [null, .88]].forEach(([a, hk]) => { const r = a === null ? 0 : 12.9 * sh, t = (a || 0) * Math.PI / 180; hexp(20 + r * Math.cos(t), 20 + r * Math.sin(t), 7 * sh, z0, z0 + H * hk, K.p); });
    };
    const monitor = (ox, z0) => {
      box(ox + 2 + m, ox + 38 - m, 2 + m, 38 - m, z0, z0 + 4.5 * sh, K.n);
      const zb = z0 + 4.5 * sh, hh = H - 4.5 * sh, o = 10 * k, w = 3.8 * sh;
      [[-o, o, .38, 's'], [0, 0, .6, 's'], [o, -o, .86, 'a']].forEach(([dx, dy, hk, c]) => box(ox + 20 + dx - w, ox + 20 + dx + w, 20 + dy - w, 20 + dy + w, zb, zb + hh * hk, K[c]));
    };
    const EDGE = { y: K.y.l, o: K.o.l, g: K.g.l, b: K.b.r, p: K.p.r, n: '#5A6699' };
    const cube = (ox, oz, kk, front) => {
      const c = K[kk], e = EDGE[kk], i = .7, x0 = ox + i, x1 = ox + 40 - i, y0 = i, y1 = 40 - i, z0 = oz + i, z1 = oz + 40 - i;
      const ln = (pts, o, w, col) => add(`<path d="M${pts.map(pt).join('L')}" fill="none" stroke="${col || e}" stroke-opacity="${o}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"/>`);
      if (!front) {
        poly([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], c.t, ' fill-opacity=".07"');
        poly([[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], c.r, ' fill-opacity=".06"');
        poly([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], c.l, ' fill-opacity=".06"');
        ln([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0]], .4, .6); ln([[x0, y0, z0], [x0, y0, z1]], .4, .6);
      } else {
        poly([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], c.l, ' fill-opacity=".08"');
        poly([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], c.r, ' fill-opacity=".08"');
        poly([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], c.t, ' fill-opacity=".12"');
        ln([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1]], .95, .9);
        ln([[x0, y1, z1], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x1, y0, z1]], .95, .9);
        ln([[x1, y1, z1], [x1, y1, z0]], .95, .9);
        ln([[x0, y1, z1], [x1, y1, z1], [x1, y0, z1]], .45, .5, '#ffffff');
      }
    };
    const zc = 120 + 3 * ex;
    const cells = [[0, 0], [0, 40 + ex], [0, 80 + 2 * ex], [-40 - ex, zc], [0, zc], [40 + ex, zc]];
    const figs = [datos, red, llaves, z => contenedor(-40 - ex, z), cluster, z => monitor(40 + ex, z)];
    const groups = cells.map(([ox, oz], i) => { cur = []; if (glass) cube(ox, oz, ST[i][3], false); figs[i](oz + m); if (glass) cube(ox, oz, ST[i][3], true); return `<g data-stage="${ST[i][0]}" data-dim=".1">${cur.join('')}</g>`; });
    let lab = '';
    if (labels) {
      const LB = Array.isArray(labels) ? labels : ST.map(q => [q[1], q[2]]);
      const fs = 7, ft = 5.2, lh = 7.5, gp = 10;
      const W = (nm, te) => Math.max(nm.length * fs * .6, te.length * ft * .6) + 1;
      const zt = zc + 40, xa = -40 - ex, xb = 80 + ex;
      const topY = X => X < (xa - 40) * C || X > xb * C ? Infinity : X <= xa * C ? (2 * xa - X / C) * S - zt : X / C * S - zt;
      const minTop = (a, b) => { let v = topY(Math.min(Math.max(xa * C, a), b)); for (let j = 0; j <= 20; j++) v = Math.min(v, topY(a + (b - a) * j / 20)); return v; };
      const tx = (x, y, an, nm, te) => `<text x="${f(x)}" y="${f(y)}" text-anchor="${an}" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="${fs}" font-weight="700" fill="#0E1530" style="fill:var(--tm-ink,#0E1530)">${nm}</text><text x="${f(x)}" y="${f(y + lh)}" text-anchor="${an}" font-family="ui-monospace,Menlo,monospace" font-size="${ft}" fill="#5A6385" style="fill:var(--tm-ink3,#5A6385)">${te}</text>`;
      const ld = (p, q) => `<path d="M${f(p[0])} ${f(p[1])}L${f(q[0])} ${f(q[1])}" stroke="#9AA2C0" style="stroke:var(--tm-lead,#9AA2C0)" stroke-width=".6" stroke-dasharray="1.8 1.4" fill="none"/><circle cx="${f(p[0])}" cy="${f(p[1])}" r="1.3" fill="#0E1530" style="fill:var(--tm-ink,#0E1530)"/>`;
      const g = [], xl = -40 * C - gp;
      [0, 1, 2].forEach(i => { if (!LB[i]) { g[i] = ''; return; }
        const [ox, oz] = cells[i], nm = LB[i][0], te = LB[i][1], p = glass ? R(ox + .7, 39.3, oz + 20) : R(ox + 8, 32, oz + 20), y = p[1] + 2.4, w = W(nm, te);
        g[i] = ld(p, [xl + 2.5, p[1]]) + tx(xl, y, 'end', nm, te);
        bb(xl - w, y - 5.5); bb(xl, y + lh + 1.5);
      });
      const A = glass ? [[16, 24, 40], [20, 20, 40], [20, 20, 40]] : [[16, 24, 25], [20, 20, H * .88], [20, 20, 4.5 + (H - 4.5) * .6]];
      const placed = [];
      [5, 4, 3].forEach(i => { if (!LB[i]) { g[i] = ''; return; }
        const [ox, oz] = cells[i], nm = LB[i][0], te = LB[i][1], q = A[i - 3], p = R(ox + q[0], q[1], oz + q[2]), w = W(nm, te), end = i === 3;
        const a = end ? p[0] + 5 - w : p[0] - 5, b = a + w;
        let bot = minTop(a, b) - 5;
        placed.forEach(o => { if (a < o.b + 4 && b > o.a - 4) bot = Math.min(bot, o.top - 5); });
        const top = bot - 14, y = bot - lh - 1.3;
        placed.push({ a, b, top });
        g[i] = ld(p, [p[0], bot + 2.2]) + tx(end ? b : a, y, end ? 'end' : 'start', nm, te);
        bb(a, top); bb(b, bot);
      });
      lab = ST.map(([sk], i) => `<g data-stage="${sk}" data-dim=".28" data-kind="label">${g[i]}</g>`).join('');
    }
    const pd = 4, vb = [B[0] - pd, B[1] - pd, B[2] - B[0] + 2 * pd, B[3] - B[1] + 2 * pd].map(f).join(' ');
    return (MK[id] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="100%" style="display:block;${maxH ? 'max-height:' + maxH + ';' : ''}overflow:visible" role="img" aria-label="TrueML"><defs>${defs.join('')}</defs>${groups.join('')}${lab}</svg>`);
  }

const THEMES = {
  claro: { bg: '#EDEFF7', grid: 'rgba(14,21,48,.055)', card: '#FFFFFF', ink: '#0E1530', ink2: '#3A4364', ink3: '#5A6385', line: '#E3E6F0', chip: '#EEF1FF', acc: '#3D5AFE', nav: 'rgba(237,239,247,.86)', sh: '0 1px 0 rgba(14,21,48,.08)', btn2: '#FFFFFF', btn2sh: '#C9CEE0', code: '#0E1530', codeink: '#E6EAFB', codeink2: '#8F9BC9', ok: '#E3F7EF', okink: '#0C7A5B', lead: '#9AA2C0' },
  oscuro: { bg: '#0A0F22', grid: 'rgba(255,255,255,.045)', card: '#121A36', ink: '#EEF1FB', ink2: '#B4BCDD', ink3: '#8C95BD', line: '#232C52', chip: '#1B2450', acc: '#8FA2FF', nav: 'rgba(10,15,34,.82)', sh: '0 0 0 1px #1E2750', btn2: '#1B2450', btn2sh: '#070B1A', code: '#070B1A', codeink: '#DDE3FA', codeink2: '#7F8AB8', ok: '#0F3B30', okink: '#5BE0B5', lead: '#4A5480' }
};
function theme(mode) {
  const dark = mode === 'oscuro' || (mode !== 'claro' && !!window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  const t = THEMES[dark ? 'oscuro' : 'claro'], r = document.documentElement.style;
  for (const k in t) r.setProperty('--tm-' + k, t[k]);
  r.colorScheme = dark ? 'dark' : 'light';
  return dark;
}
function sync(el, stages, dim) {
  if (!el) return;
  el.querySelectorAll('[data-stage]').forEach(g => {
    const lit = !stages || stages.indexOf(g.getAttribute('data-stage')) >= 0, lb = g.getAttribute('data-kind') === 'label';
    g.style.transition = 'opacity .3s ease';
    g.style.opacity = lit ? '1' : String(dim != null && !lb ? dim : g.getAttribute('data-dim'));
  });
}
function play(el) {
  if (!el || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
  ST.forEach(([sk], i) => el.querySelectorAll('[data-stage="' + sk + '"]').forEach(g => {
    if (!g.animate) return;
    const lb = g.getAttribute('data-kind') === 'label', o = g.style.opacity || '1';
    g.animate(lb ? [{ opacity: 0 }, { opacity: o }] : [{ opacity: 0, transform: 'translate(0px,-28px)' }, { opacity: o, transform: 'translate(0px,0px)' }], { duration: lb ? 420 : 640, delay: 150 + i * 140 + (lb ? 320 : 0), easing: 'cubic-bezier(.2,.85,.25,1)', fill: 'backwards' });
  }));
}
window.TrueMLMark = { mark, theme, sync, play, ST };
})();
