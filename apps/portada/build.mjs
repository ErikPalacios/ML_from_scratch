#!/usr/bin/env node
// Arma dist/ (lo que sube a Vercel) a partir de site.json, data/dojo.json, src/ y el sistema de diseño TrueML
// (vendor/trueml, copiado con node apps/trueml/sync.mjs). Sin dependencias.
//   index.html, privacidad/index.html, style.css (tokens + portada), trueml.js, icon.svg, og.png, robots.txt, sitemap.xml
// Todo lo que se ve sale de los datos: agregar una herramienta es agregar una entrada en site.json.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { etapas, franja, marca, miniT, resumen, selectorTema } from './vendor/trueml/lib.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, 'src');
const OUT = join(ROOT, 'dist');
const fail = (m) => { console.error('[build] ERROR: ' + m); process.exit(1); };
const site = JSON.parse(readFileSync(join(ROOT, 'site.json'), 'utf8'));
const dojo = JSON.parse(readFileSync(join(ROOT, 'data', 'dojo.json'), 'utf8'));
const sensei = JSON.parse(readFileSync(join(ROOT, 'data', 'sensei.json'), 'utf8'));
// Las apps principales: Sensei (entender) y el Dojo (practicar), cada una con su avance. site.destacada sigue sirviendo.
const DEST = site.destacadas || [site.destacada];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const today = new Date().toISOString().slice(0, 10);

// {{id}} en los textos de los datos: la URL de esa herramienta (o repo, issues)
const URLS = { repo: site.repo, issues: site.issues, ...Object.fromEntries([...DEST, ...site.apps].map((a) => [a.id, a.url])) };
const enlaces = (t) => t.replace(/\{\{(\w+)\}\}/g, (_, k) => { if (!(k in URLS)) fail(`no hay URL para {{${k}}}`); return URLS[k]; });
try { [...DEST, ...site.apps, ...site.rutas].forEach((x) => etapas(x.etapas)); } catch (e) { fail(e.message); }

// ---------------------------------------------------------------- piezas
const herramienta = (a) => `<article class="p-tool" data-etapas="${etapas(a.etapas).join(' ')}" data-nombre="${esc(a.title)}" data-resumen="${esc(resumen(a.etapas))}">
        <div class="p-tool-h"><span class="p-num">${esc(a.num)} · ${esc(a.tag)}</span>${miniT(a.etapas)}</div>
        <h3>${esc(a.title)}</h3>
        <p>${esc(a.text)}</p>
        <a class="p-btn-dark" href="${esc(a.url)}">${esc(a.cta)} →</a>
      </article>`;

const listas = dojo.estaciones.filter((s) => s.lista);
// el avance de cada app principal: una celda por estación del Dojo o por lección de Sensei, del color de su etapa
const AVANCE = {
  dojo: () => ({ n: dojo.total, pips: dojo.estaciones.map((s) => `<i class="tm-c-${s.etapa}${s.lista ? '' : ' p-off'}" title="${esc(`${s.num} · ${s.titulo}${s.lista ? '' : ' (próximamente)'}`)}"></i>`).join(''),
    texto: listas.length === 1 ? `Estación ${listas[0].num} de ${dojo.total} lista · ${listas[0].titulo}`
      : `${listas.length} de ${dojo.total} estaciones listas · ${listas.map((s) => `${s.num} ${s.titulo}`).join(' · ')}` }),
  sensei: () => {
    const hechas = sensei.lecciones.filter((l) => l.lista);
    const modulos = [...new Set(hechas.map((l) => l.modulo.replace(/^\d+ · /, '')))];
    return { n: sensei.total, pips: sensei.lecciones.map((l) => `<i class="${l.etapa === 'todas' ? 'p-pip-todas' : `tm-c-${l.etapa}`}${l.lista ? '' : ' p-off'}" title="${esc(`${l.titulo}${l.lista ? '' : ` (fase ${l.fase})`}`)}"></i>`).join(''),
      texto: `${hechas.length} de ${sensei.total} lecciones listas · ${modulos.join(' · ')}` };
  },
};
const destacada = DEST.map((d, k) => {
  const av = AVANCE[d.avance || 'dojo']();
  return `<article class="p-dojo" id="${esc(d.id === 'taller' ? 'dojo' : d.id)}" data-etapas="${etapas(d.etapas).join(' ')}" data-nombre="${esc(d.title)}" data-resumen="${esc(resumen(d.etapas))}">
      ${franja('tm-stripe p-dojo-stripe')}
      <div class="p-dojo-body">
        <div class="p-tool-h"><span class="p-num p-num-y">${String(k).padStart(2, '0')} · ${esc(d.tag)}</span>${miniT(d.etapas)}</div>
        <h2>${esc(d.title)}</h2>
        <p>${esc(d.text)}</p>
        <div class="p-avance"><div class="p-pips${av.n > 24 ? ' p-pips--densa' : ''}" style="--n:${av.n}">${av.pips}</div><span>${esc(av.texto)}</span></div>
        <a class="p-btn p-btn-y" href="${esc(d.url)}">${esc(d.cta)} →</a>
      </div>
    </article>`;
}).join('\n    ');

const ruta = (r, i) => `<div class="p-card p-ruta" data-etapas="${etapas(r.etapas).join(' ')}" data-nombre="${esc(r.titulo)}" data-resumen="${esc(resumen(r.etapas))}">
      <div class="p-tool-h"><span class="p-num">${String(i + 1).padStart(2, '0')}</span>${miniT(r.etapas, { etiqueta: false })}</div>
      <h3>${esc(r.titulo)}</h3>
      <p>${enlaces(r.texto)}</p>
    </div>`;

const boton = (b) => `<a class="p-btn ${b.estilo === 'primario' ? 'p-btn-b' : 'p-btn-w'}" href="${esc(enlaces(b.href))}">${esc(b.texto)}${b.estilo === 'primario' ? ' →' : ''}</a>`;

// La T: con etiquetas si hay espacio, sin ellas en pantallas angostas (lo decide el CSS con un container query)
const T = `<div class="p-t-con">${marca({ etiquetas: true, maxAltura: 'min(calc(100vh - 150px), 860px)' })}</div><div class="p-t-sin">${marca({ maxAltura: '520px' })}</div>`;

// El video de la portada (apps/video-portada): chico en bucle en el hero; en grande, con controles, en un diálogo.
const V = site.video;
const VIDEO = V ? `    <figure class="p-video" data-p-video>
      <div class="p-video-marco">
        <video muted playsinline loop preload="none" poster="${esc(V.poster)}" aria-label="${esc(V.alt)}">
          <source src="${esc(V.chico)}.webm" type="video/webm"><source src="${esc(V.chico)}.mp4" type="video/mp4">
        </video>
        <button class="p-video-pausa" type="button" data-p-video-pausa aria-pressed="true"><i aria-hidden="true"></i><span>Reproducir</span></button>
        <button class="p-video-abrir" type="button" data-p-video-abrir>Ver en grande ↗</button>
      </div>
      <figcaption>${esc(V.texto)}</figcaption>
    </figure>
` : '';
const VIDEO_DLG = V ? `<dialog class="p-video-dlg" data-p-video-dlg aria-label="${esc(V.alt)}">
  <video controls playsinline preload="none" poster="${esc(V.poster)}"><source src="${esc(V.grande)}.mp4" type="video/mp4"></video>
  <button class="p-video-cerrar" type="button" data-p-video-cerrar aria-label="Cerrar el video">×</button>
</dialog>` : '';

const vars = {
  VIDEO, VIDEO_DLG,
  NAME: esc(site.name), URL: site.url, TAGLINE: esc(site.tagline), DESC: esc(site.description), AUTHOR: esc(site.author),
  REPO: site.repo, ISSUES: site.issues, YEAR: new Date().getFullYear(), DATE: today,
  JSONLD: JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebSite', name: site.name, url: site.url + '/', inLanguage: 'es',
    description: site.description, author: { '@type': 'Person', name: site.author }, license: 'https://creativecommons.org/licenses/by-nc-nd/4.0/' }).replace(/</g, '\\u003c'),
  NAVMARK: marca(), TEMA: selectorTema(), KICKER: esc(site.kicker), BOTONES: site.botones?.length ? `    <div class="p-btns">${site.botones.map(boton).join('')}</div>\n` : '',
  T, CAPTION: esc(site.caption), DESTACADA: destacada, HERRAMIENTAS: site.apps.map(herramienta).join('\n      '),
  RUTAS: site.rutas.map(ruta).join('\n    '),
  GARANTIAS: site.garantias.map((g, i) => `<li><span class="p-check p-check-${i % 4}">✓</span>${esc(g)}</li>`).join(''),
  FEEDBACK_T: esc(site.feedback.titulo), FEEDBACK: enlaces(site.feedback.texto),
};
const fill = (t) => t.replace(/\{\{(\w+)\}\}/g, (_, k) => { if (!(k in vars)) fail('falta la variable {{' + k + '}}'); return vars[k]; });

// ---------------------------------------------------------------- escribir
for (const f of ['tokens.css', 'cliente.js', 'lib.mjs']) if (!existsSync(join(ROOT, 'vendor', 'trueml', f))) fail(`falta vendor/trueml/${f}: corre node apps/trueml/sync.mjs`);
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'privacidad'), { recursive: true });
writeFileSync(join(OUT, 'index.html'), fill(readFileSync(join(SRC, 'index.html'), 'utf8')));
writeFileSync(join(OUT, 'privacidad', 'index.html'), fill(readFileSync(join(SRC, 'privacidad.html'), 'utf8')));
writeFileSync(join(OUT, 'style.css'), readFileSync(join(ROOT, 'vendor', 'trueml', 'tokens.css'), 'utf8') + '\n' + readFileSync(join(SRC, 'style.css'), 'utf8'));
copyFileSync(join(ROOT, 'vendor', 'trueml', 'cliente.js'), join(OUT, 'trueml.js'));
// La mudanza a trueml.app: la página que lleva el avance de la dirección *.vercel.app vieja a la nueva (ver vendor/trueml/mudanza.js).
for (const f of ['mudanza.html', 'mudanza.js']) copyFileSync(join(ROOT, 'vendor', 'trueml', f), join(OUT, f));
copyFileSync(join(SRC, 'video.js'), join(OUT, 'video.js'));
if (V) {
  mkdirSync(join(OUT, 'video'), { recursive: true });
  for (const f of [V.chico + '.webm', V.chico + '.mp4', V.grande + '.mp4', V.poster]) {
    const src = join(SRC, f.replace(/^\//, ''));
    if (!existsSync(src)) fail(`falta src${f} (corre npm run portada en apps/video-portada)`);
    copyFileSync(src, join(OUT, f.replace(/^\//, '')));
  }
}
for (const f of ['icon.svg', 'og.png']) {
  if (!existsSync(join(SRC, f))) fail('falta src/' + f + (f === 'og.png' ? ' (corre npm run og)' : ''));
  copyFileSync(join(SRC, f), join(OUT, f));
}
// robots.txt también lista el sitemap de cada herramienta (sus subdominios de trueml.app): Google los acepta aquí
// aunque sean de otro host, y así encuentra todas las páginas desde la portada.
const sitemaps = [site.url, ...new Set([...site.destacadas, ...site.apps].map((a) => a.url.replace(/\/$/, '')))].map((u) => `Sitemap: ${u}/sitemap.xml`);
writeFileSync(join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\n\n${sitemaps.join('\n')}\n`);
const urls = [site.url + '/', site.url + '/privacidad/', ...[...DEST, ...site.apps].filter((a) => a.url).map((a) => a.url + '/')];
writeFileSync(join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc><lastmod>${today}</lastmod></url>`).join('\n')}\n</urlset>\n`);
console.log(`[build] dist/ listo · ${DEST.map((d) => d.title).join(' + ')} + ${site.apps.length} herramientas · ${site.rutas.length} rutas · Dojo ${listas.length}/${dojo.total} · ${urls.length} URLs en el sitemap`);
