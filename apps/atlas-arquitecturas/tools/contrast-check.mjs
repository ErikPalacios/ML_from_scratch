#!/usr/bin/env node
// Atlas de Arquitecturas — tools/contrast-check.mjs (SPEC §3.2)
// Lee los tokens de css/app.css (claro = bloques `:root {…}`, oscuro = `:root[data-theme="dark"] {…}`
// sobre el claro), resuelve var(--x) y comprueba cada par de colores que usan los diagramas y las
// visualizaciones (css/diagram.css), en ambos temas:
//   gráficos (trazos de bloques, aristas, glifos)  ≥ 3:1 contra su fondo
//   texto (etiquetas, formas, insignias)           ≥ 4.5:1 contra su fondo
// Las opacidades se mezclan con el fondo antes de medir. Sale con código 1 si algo falla.
// Uso: node tools/contrast-check.mjs [--verbose]
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '..', 'css', 'app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const verbose = process.argv.includes('--verbose');

function blocks(selectorRe) {
  const out = [];
  const re = new RegExp(selectorRe.source + '\\s*\\{([^}]*)\\}', 'g');
  let m;
  while ((m = re.exec(css))) out.push(m[1]);
  return out;
}
function decls(body) {
  const o = {};
  for (const part of body.split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (k.startsWith('--')) o[k] = v;
  }
  return o;
}
const light = Object.assign({}, ...blocks(/(?:^|\n|\})\s*:root(?![\w\[:])/).map(decls));
const darkOver = Object.assign({}, ...blocks(/:root\[data-theme="dark"\]/).map(decls));
const dark = Object.assign({}, light, darkOver);
if (!Object.keys(light).length || !Object.keys(darkOver).length) { console.error('No se encontraron los bloques de tokens en css/app.css'); process.exit(2); }

function resolve(tokens, v, depth = 0) {
  if (depth > 10) throw new Error('var() circular: ' + v);
  const m = /^var\((--[\w-]+)(?:,\s*(.+))?\)$/.exec(v.trim());
  if (m) return tokens[m[1]] != null ? resolve(tokens, tokens[m[1]], depth + 1) : (m[2] ? resolve(tokens, m[2], depth + 1) : null);
  return v.trim();
}
function hex(c) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c || '');
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
const ratio = (a, b) => { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
const mix = (fg, bg, a) => fg.map((c, i) => Math.round(c * a + bg[i] * (1 - a)));

// [descripción, color (token), fondo (token), mínimo, alpha del color]
const OPS = ['embed', 'attn', 'norm', 'mlp', 'conv', 'fuse', 'head'];
const MODS = ['img', 'txt', 'act', 'aud', 'lat', 'qry'];
const pairs = [];
const G = 3, T = 4.5;
for (const o of OPS) {
  pairs.push([`borde de bloque ${o}`, `--op-${o}`, '--surface', G]);
  pairs.push([`etiqueta sobre bloque ${o}`, '--ink', `--op-${o}-soft`, T]);
  pairs.push([`sub (mono) sobre bloque ${o}`, '--muted', `--op-${o}-soft`, T]);
}
pairs.push(['borde de op de tensor (⊕, ‖) = --muted', '--muted', '--surface', G]);
pairs.push(['símbolo de op de tensor', '--ink', '--surface', G]);
pairs.push(['borde de entrada/salida (io)', '--muted', '--surface', G]);
pairs.push(['etiqueta sobre io', '--ink', '--surface-2', T]);
pairs.push(['arista data (--muted)', '--muted', '--surface', G]);
pairs.push(['arista residual (--ink 70 %)', '--ink', '--surface', G, 0.7]);
pairs.push(['arista skip (--op-conv)', '--op-conv', '--surface', G]);
pairs.push(['arista cross (--op-fuse)', '--op-fuse', '--surface', G]);
pairs.push(['arista query (--mod-qry)', '--mod-qry', '--surface', G]);
pairs.push(['arista control (--muted)', '--muted', '--surface', G]);
pairs.push(['etiqueta K,V', '--ink', '--op-fuse-soft', T]);
for (const m of MODS) pairs.push([`glifo de tensor ${m} (trazo)`, `--mod-${m}`, '--surface', G]);
pairs.push(['forma: símbolos (--muted)', '--muted', '--surface', T]);
pairs.push(['forma: números (--ink)', '--ink', '--surface', T]);
pairs.push(['insignia de parámetros (texto)', '--ink', '--surface', T]);
pairs.push(['nombre de grupo / región', '--muted', '--surface', T]);
pairs.push(['nombre de región (sobre --surface-2)', '--muted', '--surface-2', T]);
pairs.push(['etiqueta "× L" / "h ="', '--ink', '--surface', T]);
pairs.push(['franja de modalidad img (grupo)', '--mod-img', '--surface', G]);
// mapa
pairs.push(['mapa: relación hereda (--ink 80 %)', '--ink', '--surface-2', G, 0.8]);
pairs.push(['mapa: relación usa (--accent)', '--accent', '--surface-2', G]);
pairs.push(['mapa: relación contrasta (--warn)', '--warn', '--surface-2', G]);
pairs.push(['mapa: relación reemplaza (--bad)', '--bad', '--surface-2', G]);
pairs.push(['mapa: borde de nodo listo (--accent)', '--accent', '--surface-2', G]);
pairs.push(['mapa: borde de nodo próximo/ancla (--muted)', '--muted', '--surface-2', G]);
pairs.push(['mapa: etiqueta en nodo listo', '--ink', '--accent-soft', T]);
pairs.push(['mapa: etiqueta en nodo próximo', '--ink', '--surface', T]);
pairs.push(['mapa: etiqueta en ancla', '--ink', '--surface-2', T]);
pairs.push(['mapa: fase "F2" (--muted)', '--muted', '--surface-2', T]);
// práctica (huecos), recorrido, tooltip, panel
pairs.push(['hueco: borde (--accent)', '--accent', '--surface', G]);
pairs.push(['hueco: texto (--accent-ink)', '--accent-ink', '--surface', T]);
pairs.push(['hueco lleno: texto', '--accent-ink', '--accent-soft', T]);
pairs.push(['hueco correcto: borde', '--ok', '--ok-soft', G]);
pairs.push(['hueco correcto: texto', '--ink', '--ok-soft', T]);
pairs.push(['hueco incorrecto: borde', '--bad', '--bad-soft', G]);
pairs.push(['hueco incorrecto: texto', '--ink', '--bad-soft', T]);
pairs.push(['número de hueco (texto sobre --accent)', '--on-accent', '--accent', T]);
pairs.push(['recorrido: texto', '--ink', '--accent-soft', T]);
pairs.push(['recorrido: rótulo', '--accent-ink', '--accent-soft', T]);
pairs.push(['recorrido: contador (--muted)', '--muted', '--accent-soft', T]);
pairs.push(['tooltip / panel: texto', '--ink', '--surface', T]);
pairs.push(['tooltip / panel: secundario', '--muted', '--surface', T]);
pairs.push(['botón activo (--accent-ink sobre --accent-soft)', '--accent-ink', '--accent-soft', T]);
pairs.push(['miga de pan (enlace)', '--accent-ink', '--bg', T]);
// visualizaciones
pairs.push(['viz: texto secundario', '--muted', '--surface', T]);
pairs.push(['viz: rótulo "ilustrativo" (--warn)', '--warn', '--surface', T]);
pairs.push(['viz: celda de máscara usada (--op-attn)', '--op-attn', '--surface', G]);
pairs.push(['viz: celda cross (--op-fuse)', '--op-fuse', '--surface', G]);
pairs.push(['viz: query seleccionada (--ink)', '--ink', '--surface', G]);

let fails = 0;
const report = [];
for (const [theme, tokens] of [['claro', light], ['oscuro', dark]]) {
  for (const [what, fgT, bgT, min, alpha] of pairs) {
    const fgV = resolve(tokens, `var(${fgT})`), bgV = resolve(tokens, `var(${bgT})`);
    const fg = hex(fgV), bg = hex(bgV);
    if (!fg || !bg) { report.push(`  ? [${theme}] ${what}: no se pudo leer ${fgT}=${fgV} / ${bgT}=${bgV}`); fails++; continue; }
    const c = ratio(alpha ? mix(fg, bg, alpha) : fg, bg);
    const ok = c >= min;
    if (!ok) fails++;
    if (!ok || verbose) report.push(`  ${ok ? 'ok ' : 'FALLA'} [${theme}] ${what}: ${fgT} ${fgV}${alpha ? ' @' + alpha * 100 + '%' : ''} sobre ${bgT} ${bgV} = ${c.toFixed(2)}:1 (mín ${min}:1)`);
  }
}
// Informativo: --op-tensorop del SPEC (= --rule-strong) contra --surface
for (const [theme, tokens] of [['claro', light], ['oscuro', dark]]) {
  const fg = hex(resolve(tokens, 'var(--op-tensorop)')), bg = hex(resolve(tokens, 'var(--surface)'));
  if (fg && bg) report.push(`  info [${theme}] --op-tensorop sobre --surface = ${ratio(fg, bg).toFixed(2)}:1 (los diagramas usan --muted para ese trazo)`);
}
console.log(`Contraste de diagramas: ${pairs.length * 2} pares comprobados, ${fails} fallas.`);
console.log(report.join('\n'));
process.exit(fails ? 1 : 0);
