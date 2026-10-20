#!/usr/bin/env node
// Genera la hoja "Del dato a producción" (id recorrido) del sitio Cheat sheets con el diseño del Cheat sheet de Docker
// (sheets/docker/fuentes/gen-docker.mjs): mismos tokens claro/oscuro, fuentes, hero, nav de chips pegada arriba,
// papel cuadriculado, chips de variables, bloques de código con botón de copiar, tablas que se apilan en el celular
// y CSS de impresión. Todas las figuras (mapa de metro, líneas, procesos, mini-mapas) se dibujan desde los JSON.
//
// Uso:
//   node gen-recorrido.mjs [build]     → ../recorrido.html (página del sitio y fuente del PDF) y out/artifact.html
//   node gen-recorrido.mjs pdf         → lo anterior y ../recorrido.pdf (Chrome headless, A4)
//   --content <carpeta>                → lee content-w1..w4.json de otra carpeta (por defecto, la de este archivo)
//
// El contenido (content-w1..w4.json, contrato en BRIEF.md) no se toca aquí: si algo no cuadra con el contrato,
// se avisa al final ("avisos del contenido") y se dibuja lo que hay.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHEET = join(HERE, '..');                         // sheets/recorrido
const APP = join(HERE, '../../../../ml-system-design'); // el curso: títulos de las secciones enlazadas
const ARGS = process.argv.slice(2);
const argVal = (k) => { const i = ARGS.indexOf(k); return i >= 0 ? ARGS[i + 1] : null; };
const MODE = ARGS.find((a, i) => !a.startsWith('--') && ARGS[i - 1] !== '--content') || 'build';
const CONTENT = resolve(argVal('--content') || HERE);
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const COURSE_URL = 'https://ronda-diseno-ml.vercel.app/';

// ---------------------------------------------------------------- contenido
const PROBLEMS = [];
const warn = (where, msg) => { const m = `${where}: ${msg}`; if (!PROBLEMS.includes(m)) PROBLEMS.push(m); };
const readJSON = (f) => JSON.parse(readFileSync(join(CONTENT, f), 'utf8'));
const W1 = readJSON('content-w1.json'), W2 = readJSON('content-w2.json'), W3 = readJSON('content-w3.json'), W4 = readJSON('content-w4.json');
const A = (x) => (Array.isArray(x) ? x : []);
const S_ = (x) => (x === undefined || x === null ? '' : String(x));

// ---------------------------------------------------------------- utilidades de texto
// Espacios que no se cortan donde un salto de línea se ve mal: "≈ 5k", "99.5 %", "150 ms".
const typo = (s) => S_(s).replace(/([≈≤≥~×]) (?=[\d$])/g, '$1\u00a0').replace(/(\d) (%|ms\b|s\b|h\b|GB\b|MB\b|Gi\b|Mi\b|pp\b)/g, '$1\u00a0$2');
const esc = (s) => S_(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// HTML permitido en el contenido: solo <b> y <code>; todo lo demás se escapa.
const rich = (s) => esc(typo(s)).replace(/&lt;(\/?)(b|code)&gt;/g, '<$1$2>');
const plain = (s) => S_(s).replace(/<\/?(?:b|code)>/g, '');
// {placeholder} → variable (no toca ${VAR} de bash ni {label="x"} de PromQL)
const PH = /(?<!\$)\{([A-Za-zÀ-ÖØ-öø-ÿ_][\wÀ-ÖØ-öø-ÿ.-]*)\}/g;
const phs = (h) => h.replace(PH, '<var class="ph">$1</var>');
// Las flags (-n, --platform) no se parten en el guion.
const nbFlags = (h) => h.replace(/(^|[\s(\[>])(--?[A-Za-z][A-Za-z0-9-]*)/g, (m, pre, f) => {
  if (f.length <= 16) return `${pre}<span class="nb">${f}</span>`;
  const head = f.match(/^--?[A-Za-z0-9]+/)[0];
  return `${pre}<span class="nb">${head}</span>${f.slice(head.length)}`;
});
const rt = (s) => phs(nbFlags(rich(s)));   // prosa
const ct = (s) => phs(nbFlags(esc(s)));    // comandos: tal cual, con {variables}
// Primer chequeo del quiz: si empieza con un comando va como terminal; si es una frase, como prosa.
const CMD_RE = /^(kubectl|aws|docker|git|python3?|curl|sum|rate|histogram_quantile|trtexec|perf_analyzer|nvidia-smi|promtool|helm|mlflow|dvc|lakectl|pytest|uvicorn)\b/;
const isCmd = (s) => CMD_RE.test(String(s).trim());
const chk = (s) => (isCmd(s) ? ct(s) : rt(s));
const r1 = (x) => Math.round(x * 10) / 10;
const norm = (s) => S_(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// ---------------------------------------------------------------- medida de texto (Archivo, medido en Chrome)
// Ancho de cada carácter en em, por peso; sirve para partir las etiquetas del SVG en líneas.
const CW = (() => {
  const chars = '0123456789 abcdefghijklmnopqrstuvwxyzáéíóúñüABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚÑ.,:;·-–—+=/()[]{}%≈≤≥×→←↓↑\'"_@#&*!?¿¡<>|$~';
  const raw = {
    400: '57,52,57,57,56,57,57,55,57,57,21,54,57,52,57,55,28,56,56,23,22,51,23,86,56,57,57,57,33,51,30,56,50,72,51,50,50,54,55,23,57,56,56,56,68,70,73,73,68,61,80,74,27,56,66,54,85,74,79,66,79,73,67,61,73,65,92,68,66,64,68,68,27,79,73,74,28,28,30,30,33,33,50,100,62,62,29,36,36,30,30,35,35,95,55,55,55,62,100,100,50,50,21,37,48,100,58,69,41,27,58,58,27,62,62,25,51,62',
    600: '58,58,58,58,58,58,58,58,58,58,20,56,59,55,59,56,31,59,58,25,25,54,25,86,58,60,59,59,36,54,31,58,53,76,55,53,51,56,56,25,60,58,58,58,71,71,72,73,67,61,79,73,28,59,70,57,84,73,78,67,78,72,67,62,72,67,95,69,68,63,71,67,28,78,72,73,30,30,34,34,33,33,50,100,64,64,30,36,36,34,34,39,39,97,55,55,55,64,100,100,50,50,25,44,51,100,58,73,41,29,61,61,29,64,64,25,54,64',
    700: '60,60,60,60,60,60,60,60,60,60,20,58,61,57,61,58,32,61,60,27,26,57,27,89,60,61,61,61,38,56,34,60,55,80,57,55,52,58,58,27,61,60,60,60,72,72,73,74,68,62,80,75,30,60,73,59,87,75,79,68,79,73,68,64,75,69,96,71,70,65,72,68,30,79,75,75,31,31,34,34,33,33,50,100,64,64,30,36,36,35,35,39,39,97,55,55,55,64,100,100,50,50,25,46,52,100,60,76,41,30,61,61,30,64,64,25,56,64',
    800: '62,63,63,63,63,62,63,63,63,62,19,62,63,61,63,62,35,63,63,29,29,61,29,94,63,64,63,63,41,58,38,63,57,86,61,57,53,62,62,29,64,63,63,63,75,75,75,76,70,64,82,79,33,63,77,62,91,79,81,70,81,75,70,67,78,73,98,74,73,68,75,70,33,81,78,79,32,32,33,33,33,33,50,100,65,65,30,37,37,37,37,39,39,98,55,55,55,65,100,100,50,50,26,47,53,100,62,82,41,31,61,61,31,65,65,27,58,65',
  };
  const out = {};
  for (const w of Object.keys(raw)) {
    const v = raw[w].split(',').map(Number);
    out[w] = {};
    [...chars].forEach((c, i) => { out[w][c] = v[i] / 100; });
    out[w]['\u00a0'] = out[w][' '];
  }
  return out;
})();
function tw(s, size, weight = 400, ls = 0) {
  const t = CW[weight] || CW[400];
  let w = 0;
  for (const c of S_(s)) w += (t[c] ?? t[c.toLowerCase()] ?? 0.6) * size + ls;
  return w;
}
// Parte un texto en líneas de ancho ≤ maxW px (corte por palabras; una palabra larga se corta en / - . _ :,
// salvo con keepWords: entonces la palabra queda entera aunque se pase un poco).
function wrapPx(s, maxW, size, weight = 400, ls = 0, keepWords = false) {
  const words = S_(s).split(/[ \t\n]+/).filter(Boolean), out = [];
  const fits = (x) => tw(x, size, weight, ls) <= maxW;
  let cur = '';
  for (let w of words) {
    while (!keepWords && !fits(w)) {
      if (cur) { out.push(cur); cur = ''; }
      let cut = 1;
      for (let i = 1; i <= w.length; i++) { if (fits(w.slice(0, i))) cut = i; else break; }
      const sep = Math.max(...['/', '-', '.', '_', ':'].map((c) => w.lastIndexOf(c, cut - 1)));
      if (sep >= cut * 0.4) cut = sep + 1;
      out.push(w.slice(0, cut)); w = w.slice(cut);
    }
    if (!cur) cur = w; else if (fits(cur + ' ' + w)) cur += ' ' + w; else { out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}

// ---------------------------------------------------------------- íconos (sprite SVG de trazo, currentColor)
// Glifos genéricos de 24×24 (nunca logos). Los 41 de la lista de BRIEF.md más los de la página.
const ICONS = {
  data: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="9.5" r="1.7"/><path d="M4.5 18l5-5.2 3.6 3.6 2.4-2.4 4.3 4.1"/>',
  label: '<path d="M3.5 12.3V5c0-.8.7-1.5 1.5-1.5h7.3c.4 0 .8.2 1.1.4l7.2 7.2c.6.6.6 1.5 0 2.1l-7.3 7.3c-.6.6-1.5.6-2.1 0L3.9 13.4c-.3-.3-.4-.7-.4-1.1z"/><circle cx="8.3" cy="8.3" r="1.6"/>',
  version: '<path d="M12 3.5l8.5 4.3-8.5 4.3-8.5-4.3z"/><path d="M3.5 12l8.5 4.3 8.5-4.3"/><path d="M3.5 16.2l8.5 4.3 8.5-4.3"/>',
  pipeline: '<rect x="2.8" y="9.3" width="5.4" height="5.4" rx="1.2"/><rect x="15.8" y="3.8" width="5.4" height="5.4" rx="1.2"/><rect x="15.8" y="14.8" width="5.4" height="5.4" rx="1.2"/><path d="M8.2 12h3.3M11.5 6.5v11M11.5 6.5h4.3M11.5 17.5h4.3"/>',
  train: '<circle cx="5" cy="7.5" r="2"/><circle cx="5" cy="16.5" r="2"/><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/><circle cx="19" cy="12" r="2"/><path d="M6.9 6.9l3.2-1.2M6.9 8.4l3.3 2.6M6.9 15.6l3.3-2.6M6.9 17.1l3.2 1.2M13.9 5.9l3.4 4.9M14 12h3M13.9 18.1l3.4-4.9"/>',
  gpu: '<rect x="6" y="6" width="12" height="12" rx="1.6"/><rect x="9.4" y="9.4" width="5.2" height="5.2" rx=".8"/><path d="M9 3v3M12 3v3M15 3v3M9 18v3M12 18v3M15 18v3M3 9h3M3 12h3M3 15h3M18 9h3M18 12h3M18 15h3"/>',
  chart: '<path d="M3.5 20.5h17"/><rect x="5" y="11" width="3.4" height="7" rx=".7"/><rect x="10.3" y="5.5" width="3.4" height="12.5" rx=".7"/><rect x="15.6" y="13.5" width="3.4" height="4.5" rx=".7"/>',
  gate: '<path d="M12 3l7.5 3v5.6c0 4.4-3.1 7.9-7.5 9.4-4.4-1.5-7.5-5-7.5-9.4V6z"/><path d="M8.7 12.2l2.3 2.3 4.4-4.7"/>',
  registry: '<rect x="3.5" y="3.8" width="17" height="5.2" rx="1.2"/><path d="M5 9v9.6c0 .8.7 1.4 1.5 1.4h11c.8 0 1.5-.6 1.5-1.4V9"/><path d="M9.8 13h4.4"/>',
  export: '<path d="M14 3.8h6.2V10"/><path d="M20.2 3.8l-8.7 8.7"/><path d="M18 13.8v4.7c0 .8-.7 1.5-1.5 1.5H5.5c-.8 0-1.5-.7-1.5-1.5v-11C4 6.7 4.7 6 5.5 6h4.7"/>',
  engine: '<path d="M13.2 2.8L5 13.6h6.3l-.9 7.6 8.3-10.8h-6.3z"/>',
  code: '<path d="M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5M13.6 4.8l-3.2 14.4"/>',
  test: '<rect x="5" y="4.5" width="14" height="16" rx="2"/><path d="M9 4.5V3.3h6v1.2"/><path d="M8.6 12.8l2.4 2.4 4.4-4.8"/>',
  container: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
  build: '<path d="M14.8 4.2a4.6 4.6 0 0 0-5.9 5.9l-5.3 5.3a1.9 1.9 0 0 0 0 2.7l2.3 2.3a1.9 1.9 0 0 0 2.7 0l5.3-5.3a4.6 4.6 0 0 0 5.9-5.9l-2.9 2.9-2.6-.7-.7-2.6z"/>',
  push: '<path d="M12 15.5V4M7 8.8l5-5 5 5"/><path d="M4 15v3.5c0 .8.7 1.5 1.5 1.5h13c.8 0 1.5-.7 1.5-1.5V15"/>',
  'image-registry': '<rect x="3.2" y="12.6" width="7.6" height="7.6" rx="1.2"/><rect x="13.2" y="12.6" width="7.6" height="7.6" rx="1.2"/><rect x="8.2" y="3.8" width="7.6" height="7.6" rx="1.2"/>',
  cluster: '<path d="M12 2.8l8 4.6v9.2l-8 4.6-8-4.6V7.4z"/><circle cx="12" cy="8.6" r="1.7"/><circle cx="8.7" cy="14.4" r="1.7"/><circle cx="15.3" cy="14.4" r="1.7"/>',
  pod: '<rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/><path d="M12 7.4l4.4 2.5v4.9L12 17.3l-4.4-2.5V9.9z"/>',
  autoscale: '<rect x="8.2" y="8.2" width="7.6" height="7.6" rx="1.3"/><path d="M3.5 8V3.5H8M16 3.5h4.5V8M20.5 16v4.5H16M8 20.5H3.5V16"/>',
  balancer: '<circle cx="4.8" cy="12" r="2"/><path d="M6.8 12h3.4"/><path d="M10.2 12c3.2 0 3.6-6 7.3-6M10.2 12h7.3M10.2 12c3.2 0 3.6 6 7.3 6"/><circle cx="19.3" cy="6" r="1.7"/><circle cx="19.3" cy="12" r="1.7"/><circle cx="19.3" cy="18" r="1.7"/>',
  rollout: '<path d="M3.5 19.5h5v-5h5v-5h5"/><path d="M15.2 4.5h4.3v4.3"/><path d="M19.5 4.5l-5.3 5.3"/>',
  request: '<path d="M4 8.2h14.5M14.5 4.2l4 4-4 4"/><path d="M20 15.8H5.5M9.5 11.8l-4 4 4 4"/>',
  user: '<circle cx="12" cy="8" r="3.8"/><path d="M4.6 20.5c.8-3.8 3.8-6.1 7.4-6.1s6.6 2.3 7.4 6.1"/>',
  server: '<rect x="3.5" y="4" width="17" height="7" rx="1.6"/><rect x="3.5" y="13" width="17" height="7" rx="1.6"/><circle cx="7.3" cy="7.5" r="1" fill="currentColor" stroke="none"/><circle cx="7.3" cy="16.5" r="1" fill="currentColor" stroke="none"/><path d="M11 7.5h6M11 16.5h6"/>',
  monitor: '<rect x="3" y="4" width="18" height="12.5" rx="1.8"/><path d="M8.5 20h7M12 16.5V20"/><path d="M5.6 10.6h2.9l1.6-3 2.6 6 1.5-3h4.3"/>',
  alert: '<path d="M6 16.3V11a6 6 0 0 1 12 0v5.3l1.6 2.2H4.4z"/><path d="M10 20.6a2.1 2.1 0 0 0 4 0"/>',
  log: '<path d="M9 6.5h11M9 12h11M9 17.5h8"/><circle cx="4.9" cy="6.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.9" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.9" cy="17.5" r="1.2" fill="currentColor" stroke="none"/>',
  drift: '<path d="M2.5 19.5h19"/><path d="M2.8 19c2.6 0 3-9.5 5.6-9.5s3 9.5 5.6 9.5"/><path d="M10 19c2.6 0 3-9.5 5.6-9.5s3 9.5 5.6 9.5" stroke-dasharray="2.4 2.2"/>',
  retrain: '<path d="M19.4 12.6a7.5 7.5 0 0 1-13.3 4.2"/><path d="M4.6 11.4a7.5 7.5 0 0 1 13.3-4.2"/><path d="M18.2 3.3v4.1h-4.1"/><path d="M5.8 20.7v-4.1h4.1"/>',
  cloud: '<path d="M7.2 18.8a4.5 4.5 0 0 1-.7-8.9 6 6 0 0 1 11.5-1.4 4.6 4.6 0 0 1-.3 10.3z"/>',
  file: '<path d="M14 3.5H7c-.8 0-1.5.7-1.5 1.5v14c0 .8.7 1.5 1.5 1.5h10c.8 0 1.5-.7 1.5-1.5V8z"/><path d="M14 3.5V8h4.5"/><path d="M8.6 12.6h6.8M8.6 16.1h4.6"/>',
  database: '<ellipse cx="12" cy="6" rx="7.5" ry="2.8"/><path d="M4.5 6v12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V6"/><path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8"/>',
  queue: '<rect x="2.8" y="5.5" width="4.8" height="8" rx="1"/><rect x="9.6" y="5.5" width="4.8" height="8" rx="1"/><rect x="16.4" y="5.5" width="4.8" height="8" rx="1"/><path d="M3 18h17.5M17.6 15.6l2.9 2.4-2.9 2.4"/>',
  stream: '<path d="M3 7.5c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M3 12.3c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M3 17.1c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/>',
  device: '<rect x="3.5" y="7" width="17" height="12.5" rx="2"/><circle cx="12" cy="13.2" r="3.3"/><path d="M8.2 7l1.4-2.5h4.8L15.8 7"/>',
  llm: '<path d="M4 5.5C4 4.7 4.7 4 5.5 4h13c.8 0 1.5.7 1.5 1.5v9c0 .8-.7 1.5-1.5 1.5h-8.3L5.6 20v-4h-.1C4.7 16 4 15.3 4 14.5z"/><path d="M8 8.8h8M8 12h5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.2"/><path d="M15.2 15.2l5.3 5.3"/>',
  clock: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.3V12l3.2 2"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><path d="M12 14.4v2.4"/>',
  // de la página (no son de la lista del contenido)
  branch: '<circle cx="7" cy="5.5" r="2"/><circle cx="7" cy="18.5" r="2"/><circle cx="17" cy="8" r="2"/><path d="M7 7.5v9"/><path d="M17 10c0 4.2-10 2.4-10 6.5"/>',
  trace: '<path d="M4 6h9M7 10.5h10M10 15h10M6 19.5h6"/>',
  map: '<path d="M3.5 6.3l5.2-2.1 6.6 2.4 5.2-2.1v13.2l-5.2 2.1-6.6-2.4-5.2 2.1z"/><path d="M8.7 4.2v13.2M15.3 6.6v13.2"/>',
  speed: '<path d="M4.3 17.5a8.3 8.3 0 1 1 15.4 0"/><path d="M12 13.4l4.3-4.3"/><circle cx="12" cy="13.6" r="1.3" fill="currentColor" stroke="none"/>',
  quiz: '<circle cx="12" cy="12" r="8.6"/><path d="M9.6 9.7a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1.1.9-1.1 1.6v.6"/><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/>',
  auto: '<rect x="5" y="8" width="14" height="11" rx="2.6"/><path d="M12 8V5.4"/><circle cx="12" cy="4.2" r="1.2"/><circle cx="9.4" cy="13" r="1.3" fill="currentColor" stroke="none"/><circle cx="14.6" cy="13" r="1.3" fill="currentColor" stroke="none"/><path d="M9.5 16.3h5M3 12.3v2.6M21 12.3v2.6"/>',
  pin: '<path d="M12 21s6.4-6 6.4-11.1a6.4 6.4 0 0 0-12.8 0C5.6 15 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.3"/>',
  check: '<path d="M5 12.6l4.4 4.4L19 7.4"/>',
  cross: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  arrow: '<path d="M4 12h15M13.8 6.6l5.4 5.4-5.4 5.4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  patterns: '<circle cx="5.5" cy="6" r="2.2"/><circle cx="5.5" cy="18" r="2.2"/><circle cx="18.5" cy="12" r="2.2"/><path d="M7.7 6h3.3c2 0 2.5 6 5.3 6M7.7 18h3.3c2 0 2.5-6 5.3-6"/>',
  cases: '<rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.5"/><rect x="13" y="3.5" width="7.5" height="7.5" rx="1.5"/><rect x="3.5" y="13" width="7.5" height="7.5" rx="1.5"/><rect x="13" y="13" width="7.5" height="7.5" rx="1.5"/>',
  'wk-programa': '<path d="M9 4.5h-.8c-1.2 0-1.9.8-1.9 2v3c0 1.2-.8 2-2 2.5 1.2.5 2 1.3 2 2.5v3c0 1.2.7 2 1.9 2H9M15 4.5h.8c1.2 0 1.9.8 1.9 2v3c0 1.2.8 2 2 2.5-1.2.5-2 1.3-2 2.5v3c0 1.2-.7 2-1.9 2H15"/>',
  'wk-configura': '<path d="M6 4v6M6 14v6M12 4v2M12 10v10M18 4v9M18 17v3"/><circle cx="6" cy="12" r="2"/><circle cx="12" cy="8" r="2"/><circle cx="18" cy="15" r="2"/>',
  'wk-opera': '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M7 9.8l3 2.6-3 2.6M12.5 15.4H17"/>',
  'wk-administrado': '<path d="M7.2 18.8a4.5 4.5 0 0 1-.7-8.9 6 6 0 0 1 11.5-1.4 4.6 4.6 0 0 1-.3 10.3z"/><path d="M9.3 13.8l1.9 1.9 3.6-3.8"/>',
};
const BRIEF_ICONS = ['data', 'image', 'label', 'version', 'pipeline', 'train', 'gpu', 'chart', 'gate', 'registry', 'export', 'engine', 'code', 'test', 'container', 'build', 'push', 'image-registry', 'cluster', 'pod', 'autoscale', 'balancer', 'rollout', 'request', 'user', 'server', 'monitor', 'alert', 'log', 'drift', 'retrain', 'cloud', 'file', 'database', 'queue', 'stream', 'device', 'llm', 'search', 'clock', 'lock'];
const SPRITE = `<svg class="sprite" width="0" height="0" aria-hidden="true" focusable="false"><defs>${Object.entries(ICONS).map(([k, v]) => `<symbol id="i-${k}" viewBox="0 0 24 24">${v}</symbol>`).join('')}</defs></svg>`;
function iconName(n, where) {
  if (Object.prototype.hasOwnProperty.call(ICONS, n)) return n;
  warn(where || 'íconos', `ícono desconocido «${S_(n)}» (se dibuja «file»)`);
  return 'file';
}
const icon = (n, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#i-${n}"/></svg>`;

// ---------------------------------------------------------------- el curso: títulos para los chips de enlaces
const COURSE = (() => {
  try {
    const ctx = vm.createContext({ console: { log() {}, info() {}, warn() {}, error() {} } });
    vm.runInContext(readFileSync(join(APP, 'js/core/registry.js'), 'utf8'), ctx, { filename: 'registry.js' });
    const index = readFileSync(join(APP, 'index.html'), 'utf8');
    for (const m of index.matchAll(/<script\s+src="js\/content\/([^"]+)"><\/script>/g)) {
      try { vm.runInContext(readFileSync(join(APP, 'js/content', m[1]), 'utf8'), ctx, { filename: m[1] }); } catch (e) { console.warn('aviso: no pude cargar', m[1], e.message); }
    }
    return ctx.MSD && typeof ctx.MSD.getPage === 'function' ? ctx.MSD : null;
  } catch (e) { console.warn('aviso: sin el registro del curso (los chips de enlaces llevan solo el id):', e.message); return null; }
})();
function linkChip(anchor, where) {
  const a = S_(anchor).replace(/^#/, ''), [pg, sec] = a.split('.');
  const page = COURSE ? COURSE.getPage(pg) : null;
  const s = page && sec ? (page.sections || []).find((x) => x.id === sec) : null;
  if (COURSE && !s) warn(where || 'enlaces', `el enlace ${anchor} no existe en el curso`);
  const lab = /^m\d+$/.test(pg) ? 'M' + parseInt(pg.slice(1), 10) : /^c\d+$/.test(pg) ? pg.toUpperCase() : page ? page.title : pg;
  return `<a class="chip" href="${COURSE_URL}#${esc(a)}" target="_blank" rel="noopener">${esc(lab)} · ${esc(s ? s.title : sec || '')}</a>`;
}
const linksHtml = (links, where) => (A(links).length ? `<p class="links"><span class="links__k">En el curso:</span> ${A(links).map((l) => linkChip(l, where)).join(' ')}</p>` : '');

// ---------------------------------------------------------------- el modelo del mapa (ids fijos de BRIEF.md)
const IDS = ['datos', 'versionado', 'entrenamiento', 'gate', 'export', 'serving', 'empaquetado', 'cicd', 'kubernetes', 'rollout', 'request', 'monitoreo'];
const TRAMOS = [
  { id: 'datos', name: 'Datos', st: ['datos', 'versionado'] },
  { id: 'modelo', name: 'Modelo', st: ['entrenamiento', 'gate', 'export'] },
  { id: 'release', name: 'Release', st: ['serving', 'empaquetado', 'cicd'] },
  { id: 'operacion', name: 'Operación', st: ['kubernetes', 'rollout', 'request', 'monitoreo'] },
];
const TRAMO_OF = {};
TRAMOS.forEach((t, i) => t.st.forEach((s) => { TRAMO_OF[s] = { ...t, n: i + 1 }; }));
const SPEED = { datos: 'semanas', versionado: 'semanas', entrenamiento: 'semanas', gate: 'semanas', export: 'semanas', serving: 'dias', empaquetado: 'dias', cicd: 'dias', kubernetes: 'dias', rollout: 'dias', request: 'ms', monitoreo: 'continuo' };
const LINES = ['semanas', 'dias', 'ms', 'continuo'];
const LINE_LABEL = { semanas: 'semanas', dias: 'días', ms: 'milisegundos', continuo: 'continuo' };
const LINE_ROLE = { semanas: 'el modelo', dias: 'el release', ms: 'un request', continuo: 'la operación' };
// Ícono de cada estación (roundel del mapa, botones del quiz).
const ST_ICON = { datos: 'label', versionado: 'version', entrenamiento: 'train', gate: 'gate', export: 'engine', serving: 'code', empaquetado: 'container', cicd: 'push', kubernetes: 'cluster', rollout: 'rollout', request: 'request', monitoreo: 'monitor' };
const ST_SHORT = { datos: 'Datos', versionado: 'Versionado', entrenamiento: 'Entrenamiento', gate: 'Gate', export: 'Export', serving: 'Serving', empaquetado: 'Empaquetado', cicd: 'CI/CD', kubernetes: 'Kubernetes', rollout: 'Rollout', request: 'Request', monitoreo: 'Monitoreo' };
// Transbordos (W4 speeds.transfers): en qué estación del mapa caen. Tres no son estaciones propias:
// el model registry vive en la 4 (Gate de evaluación y registry), ECR en la 8 (CI/CD y registro de imágenes) y EKS es la 9.
const XFER_AT = { 'registro-modelos': 'gate', 'registro-imagenes': 'cicd', cluster: 'kubernetes', datos: 'datos' };
const XFER_ICON = { 'registro-modelos': 'registry', 'registro-imagenes': 'image-registry', cluster: 'cluster', datos: 'database' };
// Ícono de cada ficha de herramienta (las fichas no traen uno).
const PF_ICON = { s3: 'database', 'label-studio': 'label', 'dvc-lakefs': 'version', orquestador: 'pipeline', pytorch: 'train', mlflow: 'registry', onnx: 'export', tensorrt: 'engine', triton: 'server', fastapi: 'code', pytest: 'test', docker: 'container', git: 'branch', 'github-actions': 'build', ecr: 'image-registry', kubernetes: 'cluster', alb: 'balancer', autoscaling: 'autoscale', 'gpu-k8s': 'gpu', 'argo-rollouts': 'rollout', prometheus: 'alert', grafana: 'chart', opentelemetry: 'trace' };
const WORK = ['programa', 'configura', 'opera', 'administrado'];
const WORK_META = {
  programa: { title: 'Se programa', badge: 'se programa', icon: 'wk-programa' },
  configura: { title: 'Se configura', badge: 'se configura', icon: 'wk-configura' },
  opera: { title: 'Se opera', badge: 'se opera', icon: 'wk-opera' },
  administrado: { title: 'Administrado', badge: 'administrado', icon: 'wk-administrado' },
};
// Los grupos de casos del curso (js/app.js, CASE_PATTERNS), en ese orden.
const PATTERNS = [['sincrono', 'Online síncrono'], ['batch', 'Batch'], ['asincrono', 'Asíncrono con colas'], ['llm', 'LLMs y RAG'], ['hibrido', 'Híbridos'], ['streaming', 'Streaming'], ['edge', 'Edge y on-device']];
const STATUS = { igual: 'igual', cambia: 'cambia', desaparece: 'desaparece' };

const ST = {};
for (const s of [...A(W1.stations), ...A(W2.stations)]) {
  if (!s || !s.id) { warn('estaciones', 'una estación sin id'); continue; }
  if (ST[s.id]) warn('estaciones', `${s.id} aparece dos veces (se usa la primera)`);
  else ST[s.id] = s;
}
for (const [i, id] of IDS.entries()) {
  if (!ST[id]) throw new Error(`falta la estación ${id}: el mapa necesita las 12`);
  if (ST[id].num !== i + 1) warn(`estación ${id}`, `num ${ST[id].num}, se esperaba ${i + 1} (se dibuja ${i + 1})`);
  ST[id].num = i + 1;
}
for (const id of Object.keys(ST)) if (!IDS.includes(id)) warn('estaciones', `${id} no es una de las 12 estaciones (no se dibuja)`);
const PF = {};
for (const p of [...A(W1.platforms), ...A(W2.platforms)]) {
  if (!p || !p.id) { warn('fichas', 'una ficha sin id'); continue; }
  if (PF[p.id]) warn('fichas', `${p.id} aparece dos veces (se usa la primera)`);
  else PF[p.id] = p;
}
// Casa de cada herramienta: la primera estación que la usa (ahí va la ficha completa).
const PF_HOME = {};
for (const id of IDS) for (const p of A(ST[id].platforms)) {
  if (!PF[p]) { warn(`estación ${id}`, `usa la ficha «${p}», que no existe`); continue; }
  if (!PF_HOME[p]) PF_HOME[p] = id;
}
// Excepciones: la ficha completa va en la estación donde la herramienta hace su trabajo principal.
const PF_HOME_OVERRIDE = { prometheus: 'monitoreo' };
for (const [p, st] of Object.entries(PF_HOME_OVERRIDE)) if (PF[p] && ST[st] && A(ST[st].platforms).includes(p)) PF_HOME[p] = st;
for (const p of Object.keys(PF)) if (!PF_HOME[p]) warn(`ficha ${p}`, 'ninguna estación la usa (sale solo en «¿Se programa…?»)');
const PF_ORDER = [...Object.keys(PF_HOME), ...Object.keys(PF).filter((p) => !PF_HOME[p])];
const lineOf = (id) => SPEED[id];
const SPEEDS = W4.speeds || {};
const LINE_DATA = Object.fromEntries(A(SPEEDS.lines).map((l) => [l.id, l]));
const lineName = (l) => (LINE_DATA[l] && LINE_DATA[l].name) || `Línea de ${LINE_ROLE[l]}`;
const XFERS = A(SPEEDS.transfers);
const XFER_OF_STATION = {};
for (const x of XFERS) {
  const at = XFER_AT[x.id];
  if (!at) { warn('transbordos', `«${x.id}» no es uno de los 4 transbordos conocidos (no se marca en el mapa)`); continue; }
  XFER_OF_STATION[at] = x;
}
const isXfer = (id) => Object.values(XFER_AT).includes(id);

// ---------------------------------------------------------------- revisión del contenido (avisos, sin corregir)
function validate() {
  const RICH = new Set(['summary', 'memo', 'trap', 'how', 'note', 'why']);
  const walk = (o, path) => {
    if (typeof o === 'string') {
      const key = path.split('.').pop().replace(/\[\d+\]$/, '');
      if (/<\/?(?:b|code)>/.test(o) && !RICH.has(key)) warn(path, 'trae <b> o <code> en un campo que no los admite (se muestran igual)');
      if (/<(?!\/?(?:b|code)>)[a-z][^>]*>/i.test(o) && RICH.has(key)) warn(path, 'trae HTML distinto de <b>/<code> (se escapa)');
      return;
    }
    if (Array.isArray(o)) o.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (o && typeof o === 'object') for (const k of Object.keys(o)) walk(o[k], path ? `${path}.${k}` : k);
  };
  walk(W1, 'w1'); walk(W2, 'w2'); walk(W3, 'w3'); walk(W4, 'w4');
  const WHO_HUMAN = ['MLE', 'data engineer', 'plataforma/SRE', 'etiquetadores'];
  for (const id of IDS) {
    const s = ST[id], w = `estación ${s.num} (${id})`;
    for (const k of ['title', 'question', 'summary', 'memo', 'trap']) if (!S_(s[k]).trim()) warn(w, `falta «${k}»`);
    if (!A(s.out).length) warn(w, 'sin «out»: el mapa no tiene qué artefacto dibujar');
    const n = A(s.steps).length;
    if (n < 4 || n > 7) warn(w, `${n} pasos (el contrato pide 4–7)`);
    A(s.steps).forEach((st, i) => {
      iconName(st.icon, `${w}, paso ${i + 1}`);
      if (st.who && !/^autom[aá]tico/i.test(st.who) && !WHO_HUMAN.includes(st.who)) warn(`${w}, paso ${i + 1}`, `who «${st.who}» no está en la lista (se dibuja como persona)`);
    });
    const nf = A(s.fails).length;
    if (nf < 3 || nf > 5) warn(w, `${nf} fallas (el contrato pide 3–5)`);
    const nd = A(s.done).length;
    if (nd < 3 || nd > 5) warn(w, `${nd} criterios de «lista cuando…» (el contrato pide 3–5)`);
    A(s.files).forEach((f) => {
      if (f.real === true && !S_(f.excerpt).trim()) warn(w, `archivo real sin extracto: ${f.path}`);
      if (f.real !== true && S_(f.excerpt).trim()) warn(w, `archivo descrito con extracto (no se muestra): ${f.path}`);
      if (f.real === true && S_(f.excerpt).split('\n').length > 12) warn(w, `extracto de más de 12 líneas: ${f.path}`);
    });
  }
  for (const p of Object.values(PF)) {
    const w = `ficha ${p.id}`;
    if (!p.work || !WORK.includes(p.work.main)) warn(w, `work.main «${p.work && p.work.main}» no es programa/configura/opera/administrado`);
    for (const x of A(p.work && p.work.also)) if (!WORK.includes(x)) warn(w, `work.also «${x}» no es un tipo conocido`);
    if (!PF_ICON[p.id]) warn(w, 'sin ícono asignado en el generador (se dibuja «file»)');
    if (p.example && S_(p.example.code).split('\n').length > 10) warn(w, 'el ejemplo pasa de 10 líneas');
  }
  // líneas y transbordos
  for (const l of LINES) if (!LINE_DATA[l]) warn('velocidades', `falta la línea «${l}»`);
  for (const l of A(SPEEDS.lines)) {
    if (!LINES.includes(l.id)) warn('velocidades', `línea desconocida «${l.id}»`);
    for (const s of A(l.stations)) if (IDS.includes(s) && SPEED[s] !== l.id) warn('velocidades', `${s} está en la línea ${l.id}, pero en el mapa es de ${SPEED[s]}`);
  }
  for (const x of XFERS) for (const c of A(x.connects)) if (!LINES.includes(c)) warn(`transbordo ${x.id}`, `conecta una línea desconocida «${c}»`);
  // patrones y casos
  for (const p of A(W3.patterns)) {
    const w = `patrón ${p.id}`, seen = new Set();
    for (const c of A(p.changes)) {
      if (!IDS.includes(c.station)) warn(w, `cambio sobre una estación desconocida «${c.station}»`);
      if (!STATUS[c.status]) warn(w, `estado «${c.status}» en ${c.station} (se esperaba igual, cambia o desaparece)`);
      seen.add(c.station);
    }
    for (const id of IDS) if (!seen.has(id)) warn(w, `no dice qué pasa con la estación ${id}`);
    for (const n of A(p.new)) { if (!IDS.includes(n.after)) warn(w, `estación nueva «${n.title}» después de «${n.after}», que no existe (va al final)`); iconName(n.icon, w); }
    const nl = A(p.line).length;
    if (nl < 6 || nl > 9) warn(w, `línea propia de ${nl} pasos (el contrato pide 6–9)`);
    A(p.line).forEach((x) => iconName(x.icon, w));
  }
  const PAT = PATTERNS.map((p) => p[0]);
  for (const c of A(W3.cases)) {
    if (!PAT.includes(c.pattern)) warn(`caso ${c.id}`, `patrón «${c.pattern}» desconocido`);
    for (const k of ['datos', 'modelo', 'release', 'operacion']) if (!A(c.map && c.map[k]).length) warn(`caso ${c.id}`, `mini-mapa sin chips en «${k}»`);
  }
  // quiz
  const per = {};
  A(W4.quiz).forEach((q, i) => {
    const w = `quiz ${i + 1}`;
    if (!IDS.includes(q.station)) warn(w, `estación desconocida «${q.station}»`);
    per[q.station] = (per[q.station] || 0) + 1;
    const d = A(q.distractors);
    if (d.length !== 2) warn(w, `${d.length} distractores (se esperaban 2)`);
    for (const x of d) { if (!IDS.includes(x)) warn(w, `distractor desconocido «${x}»`); if (x === q.station) warn(w, 'un distractor es la respuesta'); }
    if (new Set(d).size !== d.length) warn(w, 'distractores repetidos');
  });
  for (const id of IDS) if ((per[id] || 0) !== 2) warn('quiz', `${per[id] || 0} preguntas de ${id} (se esperaban 2)`);
}
validate();

// ---------------------------------------------------------------- piezas HTML comunes
const LANG = { python: 'Python', yaml: 'YAML', bash: 'bash', text: 'texto', protobuf: 'pbtxt', dockerfile: 'Dockerfile', json: 'JSON', promql: 'PromQL' };
const PY_KW = new Set(['def', 'return', 'import', 'from', 'as', 'class', 'if', 'elif', 'else', 'for', 'in', 'while', 'with', 'async', 'await', 'try', 'except', 'finally', 'raise', 'not', 'and', 'or', 'is', 'lambda', 'yield', 'pass', 'None', 'True', 'False']);
const DF_INSTR = new Set(['FROM', 'RUN', 'CMD', 'LABEL', 'EXPOSE', 'ENV', 'ADD', 'COPY', 'ENTRYPOINT', 'VOLUME', 'USER', 'WORKDIR', 'ARG', 'ONBUILD', 'STOPSIGNAL', 'HEALTHCHECK', 'SHELL']);
// Resaltado ligero: comentarios, cadenas y palabras clave (como el de gen-docker).
function hlCode(seg, lang, st) {
  if (!seg) return '';
  if (lang === 'dockerfile' && st.atStart) {
    st.atStart = false;
    const m = seg.match(/^(\s*)([A-Za-z]+)(?=\s|$)/);
    if (m && DF_INSTR.has(m[2].toUpperCase())) return esc(m[1]) + `<span class="tk-k">${esc(m[2])}</span>` + esc(seg.slice(m[0].length));
    return esc(seg);
  }
  if ((lang === 'yaml' || lang === 'protobuf') && st.atStart) {
    st.atStart = false;
    const m = seg.match(/^(\s*(?:-\s+)?)([A-Za-z_][\w.\/-]*)(\s*[:{])/);
    if (m) return esc(m[1]) + `<span class="tk-k">${esc(m[2])}</span>` + esc(seg.slice(m[1].length + m[2].length));
    return esc(seg);
  }
  if (lang === 'python') return esc(seg).replace(/\b([A-Za-z_]+)\b/g, (w) => (PY_KW.has(w) ? `<span class="tk-k">${w}</span>` : w));
  if (lang === 'bash' && st.atStart) {
    st.atStart = false;
    const m = seg.match(/^(\s*)([A-Za-z][\w.+-]*)/);
    if (m) return esc(m[1]) + `<span class="tk-k">${esc(m[2])}</span>` + esc(seg.slice(m[0].length));
  }
  return esc(seg);
}
function hlLine(line, lang) {
  const st = { atStart: true };
  if (/^\s*#/.test(line) && lang !== 'text') return `<span class="tk-c">${esc(line)}</span>`;
  let out = '', buf = '', i = 0;
  while (i < line.length) {
    const c = line[i];
    if ((c === '"' || c === "'") && lang !== 'text' && lang !== 'dockerfile') {
      let j = i + 1;
      while (j < line.length && line[j] !== c) { if (line[j] === '\\') j++; j++; }
      if (j < line.length) { out += hlCode(buf, lang, st); buf = ''; st.atStart = false; out += `<span class="tk-s">${esc(line.slice(i, j + 1))}</span>`; i = j + 1; continue; }
    }
    if (c === '#' && i > 0 && /\s/.test(line[i - 1]) && lang !== 'dockerfile') { out += hlCode(buf, lang, st); buf = ''; out += `<span class="tk-c">${esc(line.slice(i))}</span>`; i = line.length; break; }
    buf += c; i++;
  }
  return out + hlCode(buf, lang, st);
}
const hl = (code, lang) => S_(code).split('\n').map((l) => hlLine(l, lang)).join('\n');
const copyBtn = (text) => `<button class="cp" type="button"${text === undefined ? '' : ` data-copy="${esc(text)}"`}>Copiar</button>`;
const codeBlock = (code, lang, src) => `<div class="code"><div class="code__bar"><span class="code__lang">${esc(LANG[lang] || lang || 'texto')}</span>${src ? `<span class="code__src">${esc(src)}</span>` : ''}${copyBtn()}</div><pre><code>${hl(code, lang)}</code></pre></div>`;
// Primer chequeo de una falla: si empieza con un comando, el comando va como código copiable.
const CMD_WORDS = new Set(['kubectl', 'aws', 'docker', 'crane', 'cosign', 'curl', 'python', 'pytest', 'ls', 'git', 'dvc', 'lakectl', 'mlflow', 'nvidia-smi', 'helm']);
const CUTS = ['; ', ': ', ' (', ' y ', ' en ', ' contra ', ' → ', ', '];
function splitCmd(s) {
  const first = s.trim().split(/\s+/)[0];
  if (!CMD_WORDS.has(first)) return null;
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    for (const cut of CUTS) if (s.startsWith(cut, i)) return { cmd: s.slice(0, i).trim(), rest: s.slice(i) };
  }
  return { cmd: s.trim().replace(/\.$/, ''), rest: s.trim().endsWith('.') ? '.' : '' };
}
function checkHtml(s) {
  const c = splitCmd(S_(s));
  if (!c) return rt(s);
  return `<span class="cmdw"><code class="cmd">${ct(c.cmd)}</code>${copyBtn(c.cmd)}</span>${c.rest ? rt(c.rest) : ''}`;
}
const badgeReal = () => `<span class="badge real">${icon('check')}archivo real</span>`;
const badgeDesc = () => `<span class="badge desc">${icon('file')}descrito en el curso</span>`;
const isAuto = (who) => /^autom[aá]tico/i.test(S_(who).trim());
function wkBadge(k, main) {
  const m = WORK_META[k];
  if (!m) return `<span class="wkb">${esc(k)}</span>`;
  return `<span class="wkb wk-${k}${main ? ' wkb--main' : ''}">${icon(m.icon)}${esc(main ? m.title : m.badge)}</span>`;
}
const pips = (lines) => `<span class="pips">${lines.map((l) => `<i class="pip ln-${l}" title="${esc(LINE_LABEL[l] || l)}"></i>`).join('')}</span>`;
const stLink = (id, txt) => `<a class="stlink ln-${lineOf(id)}" href="#est-${id}"><i class="dot"></i>${esc(txt || `${ST[id].num} · ${ST_SHORT[id]}`)}</a>`;

// ---------------------------------------------------------------- SVG: piezas del mapa
const LH_NAME = 17.5;
function nameSvg(id, x, y, anchor, maxW, size, valign) {
  const s = ST[id], num = String(s.num);
  const lines = wrapPx(`${num} ${typo(plain(s.title))}`, maxW, size, 700, 0, true);
  const n = lines.length, lh = size * 1.18;
  const first = valign === 'top' ? y : valign === 'bottom' ? y - (n - 1) * lh : y - ((n - 1) * lh) / 2 + size * 0.36;
  const body = lines.map((l, i) => `<tspan x="${r1(x)}"${i ? ` dy="${r1(lh)}"` : ''}>${i === 0 ? `<tspan class="no">${num}</tspan>${esc(l.slice(num.length))}` : esc(l)}</tspan>`).join('');
  const w = Math.max(...lines.map((l) => tw(l, size, 700)));
  const bx = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  return { svg: `<text class="nm" x="${r1(x)}" y="${r1(first)}" text-anchor="${anchor}">${body}</text>`, box: { x: bx, y: first - size * 0.78, w, h: (n - 1) * lh + size * 1.02, what: `nombre ${id}` }, lines: n };
}
function ticketSvg(text, maxW, size, lh, at, ln, what) {
  const lines = wrapPx(typo(plain(text)), maxW - 14, size, 500);
  const w = Math.max(...lines.map((l) => tw(l, size, 500))) + 14, h = lines.length * lh + 9;
  const bx = at.ax === 'middle' ? at.x - w / 2 : at.ax === 'end' ? at.x - w : at.x;
  const by = at.ay === 'middle' ? at.y - h / 2 : at.ay === 'bottom' ? at.y - h : at.y;
  const x0 = bx + 7, y0 = by + 4.5 + size * 0.86;
  const svg = `<g class="tk ln-${ln}"><rect class="tkb" x="${r1(bx)}" y="${r1(by)}" width="${r1(w)}" height="${r1(h)}" rx="6"/><text class="tkt" x="${r1(x0)}" y="${r1(y0)}">${lines.map((l, i) => `<tspan x="${r1(x0)}"${i ? ` dy="${lh}"` : ''}>${esc(l)}</tspan>`).join('')}</text></g>`;
  return { svg, box: { x: bx, y: by, w, h, what }, lines: lines.length };
}
function roundelSvg(id, cx, cy, r) {
  const x = isXfer(id), ic = r * 1.2;
  return `<g class="ln-${lineOf(id)}">${x ? `<circle class="rdo" cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r + 5.5)}"/>` : ''}<circle class="rdi" cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r)}"/><use href="#i-${ST_ICON[id]}" class="mic" x="${r1(cx - ic / 2)}" y="${r1(cy - ic / 2)}" width="${r1(ic)}" height="${r1(ic)}"/><circle class="fr" cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r + (x ? 11 : 6))}"/></g>`;
}
const stnA = (id, inner) => `<a class="stn" href="#est-${id}" aria-label="Estación ${ST[id].num}: ${esc(plain(ST[id].title))}${isXfer(id) ? ' (transbordo)' : ''}">${inner}</a>`;
function segSvg(a, b, la, lb) {
  const d = (p, q) => `M${r1(p[0])},${r1(p[1])} L${r1(q[0])},${r1(q[1])}`;
  if (la === lb) return `<path class="seg ln-${la}" d="${d(a, b)}"/>`;
  const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  return `<path class="seg ln-${la}" d="${d(a, m)}"/><path class="seg ln-${lb}" d="${d(m, b)}"/>`;
}
const out0 = (id) => A(ST[id].out)[0] || '';
const boxesOverlap = (p, q) => p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
function checkOverlaps(boxes, fig) {
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    if (boxesOverlap(boxes[i], boxes[j])) warn(`figura ${fig}`, `se pisan «${boxes[i].what}» y «${boxes[j].what}» (texto más largo que su lugar)`);
  }
}
const LOOP_LABEL = 'Reentrenamiento';
// Etiqueta del bucle con el ícono de reentrenamiento (y es la línea base del texto).
const loopLabel = (x, y, t) => `<use href="#i-retrain" class="mic loopic" x="${r1(x)}" y="${r1(y - 13)}" width="16" height="16"/><text class="loopl" x="${r1(x + 20)}" y="${r1(y)}">${esc(t)}</text>`;
const bandSvg = (x, y, w, h, cls = 'band') => `<rect class="${cls}" x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="16"/>`;
const bandLabel = (x, y, t, anchor = 'start') => `<text class="bandl" x="${r1(x)}" y="${r1(y)}" text-anchor="${anchor}">${esc(t.toUpperCase())}</text>`;

// Mapa en 2D (tablet y escritorio): un anillo. Arriba Datos y Modelo, a la derecha Release, abajo Operación;
// a la izquierda el reentrenamiento cierra el ciclo. Nombres por fuera del anillo (los de Release, por dentro)
// y el artefacto que viaja en una etiqueta sobre cada tramo de vía.
function map2D() {
  const W = 812, x0 = 64, x1 = 568, y0 = 132, y1 = 132 + 4 * 112, R = 19, NS = 15, TS = 13, TLH = 15.5;
  const dx = (x1 - x0) / 4, dy = (y1 - y0) / 4, P = {};
  IDS.slice(0, 5).forEach((id, i) => { P[id] = [x0 + i * dx, y0]; });
  IDS.slice(5, 8).forEach((id, i) => { P[id] = [x1, y0 + (i + 1) * dy]; });
  IDS.slice(8, 12).forEach((id, i) => { P[id] = [x1 - i * dx, y1]; });
  const H = y1 + R + 14 + 2 * NS * 1.18 + 26;
  const boxes = [];
  let bands = '', segs = '', tks = '', stns = '';
  // bandas de los tramos (suaves, detrás de todo)
  const bTop = y0 + R + 12, xMid = x0 + 1.5 * dx, rx = x1 - R - 14;
  bands += bandSvg(4, 4, xMid - 8, bTop - 4) + bandLabel(16, 24, 'Datos');
  bands += bandSvg(xMid - 2, 4, W - 2 - xMid, bTop - 4) + bandLabel(W - 16, 24, 'Modelo', 'end');
  bands += bandSvg(rx, bTop + 8, W - 4 - rx, (y1 - R - 12) - (bTop + 8) - 8) + bandLabel(W - 16, P.serving[1] + 5, 'Release', 'end');
  bands += bandSvg(4, y1 - R - 12, W - 8, H - 4 - (y1 - R - 12)) + bandLabel(16, H - 14, 'Operación');
  boxes.push({ x: 16, y: 13, w: tw('DATOS', 11, 800, 1.76), h: 13, what: 'banda Datos' }, { x: W - 16 - tw('MODELO', 11, 800, 1.76), y: 13, w: tw('MODELO', 11, 800, 1.76), h: 13, what: 'banda Modelo' });
  boxes.push({ x: W - 16 - tw('RELEASE', 11, 800, 1.76), y: P.serving[1] - 6, w: tw('RELEASE', 11, 800, 1.76), h: 13, what: 'banda Release' });
  // vía: tramos de dos colores cuando cambia la línea
  for (let i = 0; i < IDS.length - 1; i++) segs += segSvg(P[IDS[i]], P[IDS[i + 1]], lineOf(IDS[i]), lineOf(IDS[i + 1]));
  // el bucle: de Monitoreo vuelve a Datos por abajo y por la izquierda
  const m = P.monitoreo, rc = 28;
  segs += `<path class="loop" d="M${r1(m[0] - R - 2)},${r1(y1)} H${r1(x0 + rc)} A${rc},${rc} 0 0 1 ${r1(x0)},${r1(y1 - rc)} V${r1(y0 + R + 12)}" marker-end="url(#m2d-arr)"/>`;
  // nombres
  const names = {};
  IDS.slice(0, 5).forEach((id) => { names[id] = nameSvg(id, P[id][0], P[id][1] - R - 13, 'middle', dx - 2, NS, 'bottom'); });
  IDS.slice(5, 8).forEach((id) => { names[id] = nameSvg(id, P[id][0] - R - 13, P[id][1], 'end', 205, NS, 'middle'); });
  IDS.slice(8, 12).forEach((id) => { names[id] = nameSvg(id, P[id][0], P[id][1] + R + 13 + NS * 0.8, 'middle', dx - 2, NS, 'top'); });
  // artefactos (out[0]) sobre cada tramo
  const tk = (id, maxW, at) => { const t = ticketSvg(out0(id), maxW, TS, TLH, at, lineOf(id), `artefacto de ${id}`); tks += t.svg; boxes.push(t.box); };
  for (let i = 0; i < 4; i++) { const a = P[IDS[i]], b = P[IDS[i + 1]]; tk(IDS[i], dx - 10, { x: (a[0] + b[0]) / 2, y: y0 + R + 11, ax: 'middle', ay: 'top' }); }
  for (let i = 4; i < 8; i++) { const a = P[IDS[i]], b = P[IDS[i + 1]]; tk(IDS[i], W - 6 - (x1 + R + 13), { x: x1 + R + 13, y: (a[1] + b[1]) / 2, ax: 'start', ay: 'middle' }); }
  for (let i = 8; i < 11; i++) { const a = P[IDS[i]], b = P[IDS[i + 1]]; tk(IDS[i], dx - 10, { x: (a[0] + b[0]) / 2, y: y1 - R - 11, ax: 'middle', ay: 'bottom' }); }
  const ly = (y0 + y1) / 2 + 6;
  tks += loopLabel(x0 + 22, ly - 12, LOOP_LABEL);
  boxes.push({ x: x0 + 22, y: ly - 25, w: 20 + tw(LOOP_LABEL, 13, 800), h: 16, what: 'etiqueta del bucle' });
  tk('monitoreo', 236, { x: x0 + 22, y: ly, ax: 'start', ay: 'top' });
  for (const id of IDS) { stns += stnA(id, roundelSvg(id, P[id][0], P[id][1], R) + names[id].svg); boxes.push(names[id].box); }
  checkOverlaps(boxes, 'mapa 2D');
  const defs = `<defs><marker id="m2d-arr" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="arrfill"/></marker></defs>`;
  return `<svg class="mapsvg map2d" viewBox="0 0 ${W} ${r1(H)}" role="group" aria-labelledby="map2d-t"><title id="map2d-t">Mapa del C01: 12 estaciones en un anillo, de Datos a Monitoreo, y el reentrenamiento que vuelve a Datos</title>${defs}${bands}${segs}${tks}${stns}</svg>`;
}

// Mapa vertical (celular): la vía baja por la izquierda; a la derecha, el nombre de cada estación y debajo
// el artefacto que viaja a la siguiente. El reentrenamiento sube por el borde izquierdo y entra a Datos.
function mapV() {
  const VW = 340, XT = 47, XL = 14, XS = 77, TW = VW - XS - 6, R = 17, NS = 15.5, NLH = 18.5, TS = 13, TLH = 15.5;
  let y = 8, bands = '', segs = '', tks = '', stns = '';
  const P = {}, boxes = [];
  TRAMOS.forEach((tr) => {
    const top = y;
    y += 30;
    for (const id of tr.st) {
      const s = ST[id], num = String(s.num), cy = y + R + 2;
      const numW = tw(num, NS, 800) + 6;
      const lines = wrapPx(typo(plain(s.title)), TW - numW, NS, 700);
      const first = lines.length > 1 ? cy - 3.5 : cy + 5.5, last = first + (lines.length - 1) * NLH;
      const name = `<text class="nm" x="${XS}" y="${r1(first)}"><tspan class="no">${esc(num)}</tspan>${lines.map((l, i) => `<tspan x="${r1(XS + numW)}"${i ? ` dy="${NLH}"` : ''}>${esc(l)}</tspan>`).join('')}</text>`;
      stns += stnA(id, roundelSvg(id, XT, cy, R) + name);
      const t = ticketSvg(out0(id), TW, TS, TLH, { x: XS, y: Math.max(cy + R, last + 6) + 6, ax: 'start', ay: 'top' }, lineOf(id), `artefacto de ${id}`);
      tks += t.svg; boxes.push(t.box);
      P[id] = cy;
      y = t.box.y + t.box.h + 14;
    }
    bands += bandSvg(27, top, VW - 31, y - top - 4) + bandLabel(XS, top + 20, tr.name);
    y += 10;
  });
  for (let i = 0; i < IDS.length - 1; i++) segs += segSvg([XT, P[IDS[i]]], [XT, P[IDS[i + 1]]], lineOf(IDS[i]), lineOf(IDS[i + 1]));
  const yL = y + 4, rc = 14;
  segs += `<path class="loop" d="M${XT},${r1(P.monitoreo + R + 2)} V${r1(yL - rc)} A${rc},${rc} 0 0 1 ${XT - rc},${r1(yL)} H${XL + rc} A${rc},${rc} 0 0 1 ${XL},${r1(yL - rc)} V${r1(P.datos + rc)} A${rc},${rc} 0 0 1 ${XL + rc},${r1(P.datos)} H${r1(XT - R - 9)}" marker-end="url(#mv-arr)"/>`;
  tks += loopLabel(XT + 12, yL + 5, `${LOOP_LABEL}: vuelve a 1 · ${ST_SHORT.datos}`);
  checkOverlaps(boxes, 'mapa vertical');
  const H = yL + 18;
  const defs = `<defs><marker id="mv-arr" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="arrfill"/></marker></defs>`;
  return `<svg class="mapsvg mapv" viewBox="0 0 ${VW} ${r1(H)}" role="group" aria-labelledby="mapv-t"><title id="mapv-t">Mapa del C01 de arriba abajo: 12 estaciones, de Datos a Monitoreo, y el reentrenamiento que vuelve a Datos</title>${defs}${bands}${segs}${tks}${stns}</svg>`;
}

// ---------------------------------------------------------------- secciones
const secHead = (ic, title, q, n, screenOnly = '') => `<header class="sec__head"><span class="sec__n">${n !== undefined ? esc(n) : icon(ic)}</span><div><h2>${esc(title)}</h2>${q ? `<p class="sec__q">${rt(q)}${screenOnly ? `<span class="scr"> ${rt(screenOnly)}</span>` : ''}</p>` : ''}</div></header>`;
const lineLegend = () => LINES.map((l) => `<span class="lg ln-${l}"><i class="lg-line"></i><b>${esc(LINE_LABEL[l])}</b><span>${esc(lineName(l))}</span></span>`).join('');
const xferGlyph = () => `<svg class="lg-x" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="11.5" class="g-o"/><circle cx="14" cy="14" r="7" class="g-i"/></svg>`;

function heroHtml() {
  const I = W4.intro || {};
  const how = A(I.how_to_read).map((t, i) => `<li><span class="howto__n">${i + 1}</span><span>${rt(t)}</span></li>`).join('');
  return `<header class="hero">
    <p class="kicker">Ronda de Diseño ML · MLOps de punta a punta · el C01</p>
    <h1>Del dato a <mark>producción</mark></h1>
    <p class="lead">${rt(I.lead)}</p>
    ${how ? `<ol class="howto" aria-label="Cómo leer esta hoja">${how}</ol>` : ''}
    <div class="legend">
      <p class="tag">Leyenda</p>
      <div class="legend__row">${lineLegend()}</div>
      <div class="legend__row">
        <span class="lg">${xferGlyph()}transbordo: ahí se tocan dos líneas</span>
        <span class="lg"><span class="lg-ticket">snapshot</span>el artefacto que viaja a la siguiente estación</span>
        <span class="lg">${badgeReal()}${badgeDesc()}</span>
        <span class="lg"><var class="ph">variable</var>la cambias tú</span>
      </div>
    </div>
  </header>`;
}

// Solo en papel: el mapa en una tabla (el mapa va en su propia página apaisada).
function printSummary() {
  const rows = IDS.map((id, i) => `<tr class="ln-${lineOf(id)}"><td class="nw"><i class="dot"></i> <b>${ST[id].num}</b></td><td><b>${esc(ST[id].title)}</b></td><td>${esc(TRAMO_OF[id].name)}</td><td class="nw">${esc(LINE_LABEL[lineOf(id)])}</td><td>${rt(out0(id))}<span class="psum__to"> → ${i < IDS.length - 1 ? `${ST[IDS[i + 1]].num} · ${esc(ST_SHORT[IDS[i + 1]])}` : `1 · ${esc(ST_SHORT.datos)} (reentrenamiento)`}</span></td></tr>`).join('');
  return `<div class="psum"><p class="tag">El recorrido en una tabla</p><table class="dt"><thead><tr><th scope="col">#</th><th scope="col">Estación</th><th scope="col">Tramo</th><th scope="col">Línea</th><th scope="col">Lo que sale y a dónde viaja</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function mapHtml() {
  const M = W4.map || {};
  return `<section class="sec" id="mapa">
  ${secHead('map', 'El mapa del C01', 'Doce estaciones en cuatro tramos, el artefacto que pasa de una a la siguiente y el reentrenamiento que cierra el ciclo.', undefined, 'Toca una estación para ir a su sección.')}
  <figure class="fig map">
    <div class="maplg">${lineLegend()}<span class="lg">${xferGlyph()}transbordo</span><span class="lg"><i class="lg-loop"></i>reentrenamiento</span></div>
    ${map2D()}
    ${mapV()}
    ${M.caption ? `<figcaption>${rt(M.caption)}</figcaption>` : ''}
  </figure>
  ${M.loop_note ? `<div class="loopnote"><span class="loopnote__ic">${icon('retrain')}</span><div><p class="tag">Cómo se cierra el ciclo</p><p>${rt(M.loop_note)}</p></div></div>` : ''}
</section>`;
}

// Ícono de cada paso del request (la línea de milisegundos trae texto, no ids de estación).
const SUBSTEP_ICON = [[/\bALB\b|balance/i, 'balancer'], [/gateway/i, 'code'], [/preproces/i, 'image'], [/triton|tensorrt|gpu/i, 'gpu'], [/softmax|top-?\d/i, 'chart'], [/\blog/i, 'log']];
const subIcon = (t) => (SUBSTEP_ICON.find(([re]) => re.test(plain(t))) || [null, 'request'])[1];
// Paradas de una línea: sus estaciones y, en los extremos, los transbordos que la tocan.
function laneStops(l) {
  const L = LINE_DATA[l], items = [];
  for (const s of A(L.stations)) {
    if (IDS.includes(s)) items.push({ kind: 'st', id: s });
    else {
      const [lab, tag] = S_(s).split(/\s+·\s+/);
      items.push({ kind: 'txt', label: lab, tag });
    }
  }
  const inStrip = (id) => items.some((x) => x.kind === 'st' && x.id === id);
  const pre = [], post = [];
  for (const x of XFERS) {
    const con = A(x.connects);
    if (!con.includes(l)) continue;
    const at = XFER_AT[x.id];
    if (at && inStrip(at)) continue; // ya está: la estación se dibuja como transbordo
    (con[0] === l ? post : pre).push({ kind: 'x', x });
  }
  return [...pre, ...items, ...post];
}
function stopHtml(it, l) {
  if (it.kind === 'st') {
    const id = it.id, x = isXfer(id) ? XFER_OF_STATION[id] : null;
    const others = x ? A(x.connects).filter((c) => c !== l) : [];
    return `<li><a class="stop${x ? ' stop--x' : ''} ln-${lineOf(id)}" href="#est-${id}"><span class="stop__rd">${icon(ST_ICON[id])}</span><span><span class="stop__n">${ST[id].num}</span> ${esc(ST_SHORT[id])}</span>${others.length ? pips(others) : ''}</a></li>`;
  }
  if (it.kind === 'x') {
    const x = it.x, others = A(x.connects).filter((c) => c !== l);
    return `<li><a class="stop stop--x stop--xo" href="#tr-${esc(x.id)}"><span class="stop__rd">${icon(XFER_ICON[x.id] || 'xfer')}</span><span>${esc(x.name || x.id)}</span>${pips(others)}</a></li>`;
  }
  return `<li><span class="stop stop--txt"><span class="stop__rd">${icon(subIcon(it.label))}</span><span>${rt(it.label)}${it.tag ? ` <span class="stop__t">${rt(it.tag)}</span>` : ''}</span></span></li>`;
}
function laneHtml(l) {
  const L = LINE_DATA[l];
  if (!L) return '';
  const dl = [['Ritmo', L.rhythm], ['Qué la dispara', L.trigger], ['Quién la mueve', L.who]].filter(([, v]) => S_(v).trim());
  return `<article class="lane ln-${l}" id="linea-${l}">
    <header class="lane__h"><span class="lane__speed">${esc(LINE_LABEL[l] || l)}</span><h3>${esc(L.name || lineName(l))}</h3></header>
    <ol class="strip vsm">${laneStops(l).map((it) => stopHtml(it, l)).join('')}</ol>
    <dl class="lane__dl">${dl.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${rt(v)}</dd></div>`).join('')}</dl>
    ${L.note ? `<p class="lane__note">${rt(L.note)}</p>` : ''}
  </article>`;
}
// Glifo de un transbordo: una vía por cada línea que llega, todas al mismo anillo doble. Sin flechas: quién entrega
// y quién recibe lo dice el texto (en el C01 cambia según el transbordo), y sirve para 2, 3 o más líneas.
function xferSvg(x) {
  const con = A(x.connects).filter((c) => LINES.includes(c));
  const ls = con.length ? con : ['dias'];
  const cx = 56, cy = 32, n = ls.length;
  // la primera llega por la izquierda; el resto se reparte por la derecha (de arriba abajo)
  const ends = n === 1 ? [[4, cy]] : [[4, cy], ...ls.slice(1).map((_, i) => [108, n === 2 ? cy : 8 + (i * 48) / (n - 2)])];
  let s = '';
  ls.forEach((l, i) => {
    const [ex, ey] = ends[i];
    s += ey === cy ? `<path class="xg-l ln-${l}" d="M${cx},${cy} H${ex}"/>` : `<path class="xg-l ln-${l}" d="M${cx},${cy} C${cx + 24},${cy} ${cx + 20},${r1(ey)} ${cx + 42},${r1(ey)} H${ex}"/>`;
  });
  s += `<circle cx="${cx}" cy="${cy}" r="13" class="g-o"/><circle cx="${cx}" cy="${cy}" r="8.5" class="g-i"/><use href="#i-${XFER_ICON[x.id] || 'xfer'}" x="${cx - 6.5}" y="${cy - 6.5}" width="13" height="13" class="mic"/>`;
  return `<svg class="xg" viewBox="0 0 112 64" aria-hidden="true">${s}</svg>`;
}
// "a", "a y b", "a, b y c"
const listY = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`);
const lineNames = (ls) => listY(A(ls).map((c) => `<span class="lnname ln-${esc(c)}"><i class="dot"></i>${esc(LINE_LABEL[c] || c)}</span>`));
function transferHtml(x) {
  const con = A(x.connects), at = XFER_AT[x.id];
  const path = `<span class="k">Une</span> ${lineNames(con)}`;
  return `<article class="xfer" id="tr-${esc(x.id)}">
    ${xferSvg(x)}
    <div class="xfer__b">
      <h4>${esc(x.name || x.id)}</h4>
      <p class="xfer__con">${path}</p>
      ${x.what_passes ? `<p><span class="k">Qué cruza</span> ${rt(x.what_passes)}</p>` : ''}
      ${x.where ? `<p><span class="k">Dónde vive</span> ${rt(x.where)}</p>` : ''}
      ${at ? `<p class="xfer__st">En el mapa: ${stLink(at, `estación ${ST[at].num} · ${ST_SHORT[at]}`)}</p>` : ''}
    </div>
  </article>`;
}
function speedsHtml() {
  return `<section class="sec" id="velocidades">
  ${secHead('speed', 'Las 4 velocidades', 'El mismo mapa partido en cuatro líneas que corren a ritmos distintos y solo se tocan en los transbordos.')}
  ${SPEEDS.intro ? `<p class="intro">${rt(SPEEDS.intro)}</p>` : ''}
  <div class="lanes">${LINES.map(laneHtml).join('')}</div>
  ${XFERS.length ? `<h3 class="sub">${icon('xfer')}Los ${XFERS.length} transbordos: donde se tocan las líneas</h3><div class="xfers">${XFERS.map(transferHtml).join('')}</div>` : ''}
</section>`;
}

// ---------------------------------------------------------------- estaciones
function stepsHtml(s) {
  return `<ol class="flow">${A(s.steps).map((st, i) => {
    const auto = isAuto(st.who), ic = iconName(st.icon, `estación ${s.num}`);
    return `<li class="step">
      <div class="step__top"><span class="step__ic">${icon(ic)}</span><span class="step__n">Paso ${i + 1}</span></div>
      <p class="step__l">${rt(st.label)}</p>
      ${st.detail ? `<p class="step__d">${rt(st.detail)}</p>` : ''}
      <p class="step__m">${st.who ? `<span class="who${auto ? ' auto' : ''}" title="quién">${icon(auto ? 'auto' : 'user')}${esc(st.who)}</span>` : ''}${st.where ? `<span class="where" title="dónde corre">${icon('pin')}${rt(st.where)}</span>` : ''}</p>
    </li>`;
  }).join('')}</ol>`;
}
function filesHtml(s) {
  const fs = A(s.files);
  if (!fs.length) return '';
  return `<div class="files">${fs.map((f) => f.real === true
    ? `<article class="file file--real"><header class="file__h">${badgeReal()}<code class="file__p">${esc(f.path)}</code></header>${f.what ? `<p class="file__w">${rt(f.what)}</p>` : ''}${S_(f.excerpt).trim() ? codeBlock(f.excerpt, f.lang, 'extracto') : ''}</article>`
    : `<article class="file file--desc"><header class="file__h">${badgeDesc()}<b class="file__p">${rt(f.path)}</b></header>${f.what ? `<p class="file__w">${rt(f.what)}</p>` : ''}</article>`).join('')}</div>`;
}
function cmdsHtml(s) {
  const cs = A(s.commands);
  if (!cs.length) return '';
  return `<ul class="cmds">${cs.map((c) => `<li><div class="cmdline"><code class="cmd">${ct(c.code)}</code>${copyBtn(c.code)}</div>${c.note ? `<p class="cmdnote">${rt(c.note)}</p>` : ''}</li>`).join('')}</ul>`;
}
function failsHtml(s) {
  const fs = A(s.fails);
  if (!fs.length) return '';
  return `<div class="tscroll"><table class="dt stk fails"><thead><tr><th scope="col">Lo que ves</th><th scope="col">Por qué pasa</th><th scope="col">Primer chequeo</th></tr></thead><tbody>${fs.map((f) => `<tr><th scope="row" class="rh">${rt(f.symptom)}</th><td data-k="Por qué pasa">${rt(f.cause)}</td><td data-k="Primer chequeo">${checkHtml(f.check)}</td></tr>`).join('')}</tbody></table></div>`;
}
const stripLead = (s, lead) => S_(s).replace(new RegExp('^\\s*' + lead + ':\\s*', 'i'), '');
function pfFull(p) {
  const work = p.work || {}, ic = PF_ICON[p.id] || 'file';
  const kinds = [work.main, ...A(work.also)].filter(Boolean);
  const ex = p.example && S_(p.example.code).trim() ? codeBlock(p.example.code, p.example.lang, p.example.source) : '';
  const dl = [['Dónde corre', p.runs], ['Alternativas', p.alternatives]].filter(([, v]) => S_(v).trim());
  return `<article class="pf" id="pf-${esc(p.id)}">
    <header class="pf__h"><span class="pf__ic">${icon(ic)}</span><div><h4>${esc(p.name || p.id)}</h4>${p.category ? `<p class="pf__cat">${esc(p.category)}</p>` : ''}</div></header>
    <div class="pf__grid">
      <div class="pf__a">
        ${p.what ? `<p class="pf__what">${rt(p.what)}</p>` : ''}
        ${p.analogy ? `<p class="pf__an"><span class="k">Como</span> ${rt(p.analogy)}</p>` : ''}
        ${p.in_c01 ? `<p class="pf__c01"><span class="k">En el C01</span> ${rt(p.in_c01)}</p>` : ''}
      </div>
      <div class="pf__w">
        <p class="tag">¿Cómo se trabaja?</p><div class="wkrow">${kinds.map((k, i) => wkBadge(k, i === 0)).join('')}</div>
        ${p.how ? `<p class="pf__how">${rt(p.how)}</p>` : ''}
      </div>
    </div>
    ${ex ? `<div class="pf__ex"><p class="tag">Ejemplo</p>${ex}</div>` : ''}
    ${dl.length ? `<dl class="pf__dl">${dl.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${rt(v)}</dd></div>`).join('')}</dl>` : ''}
    ${linksHtml(p.links, `ficha ${p.id}`)}
  </article>`;
}
function pfRef(p) {
  const home = PF_HOME[p.id], work = p.work || {};
  return `<a class="pfref" href="#pf-${esc(p.id)}"><span class="pf__ic">${icon(PF_ICON[p.id] || 'file')}</span><span class="pfref__b"><b>${esc(p.name || p.id)}</b><span class="pfref__t">${esc(p.category || '')}${p.category ? ' · ' : ''}ficha completa en la estación ${ST[home].num} · ${esc(ST_SHORT[home])} →</span></span><span class="wkrow">${[work.main, ...A(work.also)].filter(Boolean).map((k, i) => wkBadge(k, false && i)).join('')}</span></a>`;
}
function stationHtml(id, i) {
  const s = ST[id], l = lineOf(id), tr = TRAMO_OF[id];
  const nextId = IDS[i + 1] || 'datos', prevId = IDS[i - 1];
  const x = XFER_OF_STATION[id];
  const ins = A(s.in), outs = A(s.out);
  const goes = i < IDS.length - 1 ? `viaja a ${ST[nextId].num} · ${ST_SHORT[nextId]}` : `vuelve a 1 · ${ST_SHORT.datos} (reentrenamiento)`;
  const io = `<div class="io">
      <div class="io__col"><p class="tag">Entra</p><ul class="io__list">${ins.map((t) => `<li class="art">${rt(t)}</li>`).join('')}</ul></div>
      <div class="io__arrow" aria-hidden="true">${icon('arrow')}</div>
      <div class="io__col"><p class="tag">Sale</p><ul class="io__list">${outs.map((t, k) => `<li class="art${k === 0 ? ' art--go' : ''}">${rt(t)}${k === 0 ? `<span class="art__go">${esc(goes)}</span>` : ''}</li>`).join('')}</ul></div>
    </div>`;
  const pfs = A(s.platforms).filter((p) => PF[p]);
  const full = pfs.filter((p) => PF_HOME[p] === id), refs = pfs.filter((p) => PF_HOME[p] !== id);
  const done = A(s.done);
  const xHtml = x ? `<p class="st__x">${xferGlyph()}<span><b>Transbordo · ${esc(x.name || x.id)}.</b> Aquí se tocan las líneas ${lineNames(x.connects)}. <a href="#tr-${esc(x.id)}">Qué cruza</a></span></p>` : '';
  return `
<section class="sec st ln-${l}" id="est-${id}">
  <header class="st__head">
    <span class="st__n" aria-hidden="true">${s.num}</span>
    <div>
      <p class="st__kick">Estación ${s.num} de 12 · tramo ${esc(tr.name)} · <span class="lnname ln-${l}"><i class="dot"></i>línea de ${esc(LINE_LABEL[l])}</span></p>
      <h2>${esc(s.title)}</h2>
      ${s.question ? `<p class="sec__q">${rt(s.question)}</p>` : ''}
    </div>
  </header>
  ${xHtml}
  ${s.summary ? `<p class="st__sum">${rt(s.summary)}</p>` : ''}
  ${io}
  <h3 class="sub">${icon('pipeline')}El proceso, paso a paso</h3>
  ${stepsHtml(s)}
  ${A(s.files).length ? `<h3 class="sub">${icon('file')}Archivos del C01</h3>${filesHtml(s)}` : ''}
  ${A(s.commands).length ? `<h3 class="sub">${icon('wk-opera')}Comandos clave</h3>${cmdsHtml(s)}` : ''}
  ${A(s.fails).length ? `<h3 class="sub">${icon('alert')}Qué falla aquí</h3>${failsHtml(s)}` : ''}
  <div class="st__end">
    ${done.length ? `<div class="donebox"><p class="tag">${icon('check')}Lista cuando…</p><ul class="done">${done.map((d) => `<li>${rt(d)}</li>`).join('')}</ul></div>` : ''}
    <div class="notes">${s.memo ? `<div class="memo"><p class="tag">Cómo recordarla</p><p>${rt(stripLead(s.memo, 'Cómo recordarla'))}</p></div>` : ''}${s.trap ? `<div class="trap"><p class="tag">Trampa</p><p>${rt(stripLead(s.trap, 'Trampa'))}</p></div>` : ''}</div>
  </div>
  ${linksHtml(s.links, `estación ${id}`)}
  ${pfs.length ? `<h3 class="sub">${icon('wk-configura')}Herramientas de esta estación</h3><div class="pfs">${full.map((p) => pfFull(PF[p])).join('')}${refs.length ? `<div class="pfrefs">${refs.map((p) => pfRef(PF[p])).join('')}</div>` : ''}</div>` : ''}
  <nav class="st__pn" aria-label="Estaciones vecinas">${prevId ? `<a href="#est-${prevId}">← ${ST[prevId].num} · ${esc(ST_SHORT[prevId])}</a>` : '<span></span>'}<a href="#mapa">Mapa</a>${IDS[i + 1] ? `<a href="#est-${nextId}">${ST[nextId].num} · ${esc(ST_SHORT[nextId])} →</a>` : `<a href="#est-datos">↺ 1 · ${esc(ST_SHORT.datos)}</a>`}</nav>
</section>`;
}

// ---------------------------------------------------------------- ¿se programa, se configura o se opera?
function workHtml() {
  const WK = W4.work_kinds || {};
  const cols = WORK.map((k) => {
    const items = PF_ORDER.filter((p) => PF[p].work && PF[p].work.main === k);
    return `<div class="wk wk-${k}">
      <header class="wk__h"><span class="wk__ic">${icon(WORK_META[k].icon)}</span><h3>${esc(WORK_META[k].title)}</h3><span class="wk__c">${items.length}</span></header>
      ${WK[k] ? `<p class="wk__t">${rt(WK[k])}</p>` : ''}
      <ul class="wk__list">${items.map((p) => {
        const P_ = PF[p], home = PF_HOME[p];
        const also = A(P_.work.also);
        return `<li><a class="pfmini" href="#pf-${esc(p)}"><span class="pfmini__ic">${icon(PF_ICON[p] || 'file')}</span><span class="pfmini__b"><b>${esc(P_.name || p)}</b>${home ? `<span class="pfmini__st ln-${lineOf(home)}"><i class="dot"></i>${ST[home].num} · ${esc(ST_SHORT[home])}</span>` : ''}${also.length ? `<span class="pfmini__also">${also.map((a) => `<span class="wkdot wk-${esc(a)}" title="también ${esc(a)}">${WORK_META[a] ? icon(WORK_META[a].icon) : ''}${esc(a)}</span>`).join('')}</span>` : ''}</span></a></li>`;
      }).join('')}</ul>
    </div>`;
  }).join('');
  const others = PF_ORDER.filter((p) => !PF[p].work || !WORK.includes(PF[p].work.main));
  return `<section class="sec" id="trabajo">
  ${secHead('wk-configura', '¿Se programa, se configura o se opera?', `Las ${PF_ORDER.length} herramientas del recorrido según cómo trabajas con ellas. Casi ninguna es de un solo tipo: el ícono chico dice qué más haces con cada una.`)}
  <div class="wkcols">${cols}</div>
  ${others.length ? `<p class="small">Sin tipo: ${others.map((p) => esc(PF[p].name || p)).join(', ')}.</p>` : ''}
</section>`;
}

// ---------------------------------------------------------------- patrones
function patternHtml(p) {
  const items = [];
  const byId = Object.fromEntries(A(p.changes).map((c) => [c.station, c]));
  const news = A(p.new);
  for (const id of IDS) {
    const c = byId[id] || { station: id, status: '', note: '' };
    items.push({ kind: 'c01', id, status: STATUS[c.status] ? c.status : 'igual', note: c.note, unknown: !STATUS[c.status] });
    for (const nw of news.filter((n) => n.after === id)) items.push({ kind: 'new', ...nw });
  }
  for (const nw of news.filter((n) => !IDS.includes(n.after))) items.push({ kind: 'new', ...nw });
  const chip = (it) => it.kind === 'new'
    ? `<span class="cmpc cmpc--nueva">${icon('plus')}${esc(it.title)}</span>`
    : `<span class="cmpc cmpc--${it.status}"><b class="n">${ST[it.id].num}</b> ${esc(ST_SHORT[it.id])}</span>`;
  const count = (st) => items.filter((x) => x.kind === 'c01' && x.status === st).length;
  const STL = { igual: 'igual', cambia: 'cambia', desaparece: 'desaparece', nueva: 'nueva' };
  const notes = items.map((it) => {
    const st = it.kind === 'new' ? 'nueva' : it.status;
    return `<li class="cmpn cmpn--${st}">${chip(it)}<span class="cmpn__s">${STL[st]}</span><span class="cmpn__t">${rt(it.note)}</span></li>`;
  }).join('');
  const line = A(p.line);
  return `<article class="pat" id="pat-${esc(p.id)}">
    <header class="pat__h"><span class="pat__tag">${esc(p.name || p.id)}</span><h3>${esc(p.title || '')}</h3></header>
    ${p.summary ? `<p class="pat__sum">${rt(p.summary)}</p>` : ''}
    <p class="tag">Frente al C01 · ${count('cambia')} cambian · ${count('desaparece')} desaparecen · ${news.length} nuevas · ${count('igual')} igual</p>
    <ol class="cmp">${items.map((it) => `<li>${chip(it)}</li>`).join('')}</ol>
    ${line.length ? `<p class="tag pat__lt">Su propia línea</p><ol class="strip vsm pat__line">${line.map((x) => `<li><span class="stop"><span class="stop__rd">${icon(iconName(x.icon, `patrón ${p.id}`))}</span><span>${rt(x.label)}</span></span></li>`).join('')}</ol>` : ''}
    ${p.speeds ? `<div class="pat__speeds">${icon('speed')}<p><span class="k">Velocidades</span> ${rt(p.speeds)}</p></div>` : ''}
    <details class="pat__more"><summary>Estación por estación (${items.length})</summary><ul class="cmpns">${notes}</ul></details>
    ${linksHtml(p.links, `patrón ${p.id}`)}
  </article>`;
}
function patternsHtml() {
  const ps = A(W3.patterns);
  return `<section class="sec" id="patrones">
  ${secHead('patterns', `${ps.length} patrones frente al C01`, 'Qué estaciones desaparecen, cuáles cambian y cuáles aparecen cuando el sistema no es una API síncrona.')}
  <p class="cmplg"><span class="k">Cómo leer las tiras</span><span class="cmpc cmpc--igual">igual que en el C01</span><span class="cmpc cmpc--cambia">cambia</span><span class="cmpc cmpc--desaparece">desaparece</span><span class="cmpc cmpc--nueva">${icon('plus')}estación nueva</span></p>
  ${ps.map(patternHtml).join('')}
</section>`;
}

// ---------------------------------------------------------------- casos
const MM = [['datos', 'Datos'], ['modelo', 'Modelo'], ['release', 'Release'], ['operacion', 'Operación']];
const PATTERN_LABEL = Object.fromEntries(PATTERNS);
function caseHtml(c) {
  const map = c.map || {};
  return `<article class="case" id="caso-${esc(c.id)}">
    <header class="case__h"><span class="case__id">${esc(S_(c.id).toUpperCase())}</span><h4>${esc(c.title || '')}</h4><span class="case__pat">${esc(PATTERN_LABEL[c.pattern] || c.pattern || '')}</span></header>
    ${c.one_liner ? `<p class="case__one">${rt(c.one_liner)}</p>` : ''}
    <div class="mm">${MM.map(([k, lab]) => `<div class="mm__row"><i class="mm__dot"></i><div><span class="mm__t">${esc(lab)}</span><span class="mm__c">${A(map[k]).map((x) => `<span>${rt(x)}</span>`).join('')}</span></div></div>`).join('')}</div>
    ${A(c.vs_c01).length ? `<div class="case__vs"><p class="tag">Frente al C01</p><ul>${A(c.vs_c01).map((x) => `<li>${rt(x)}</li>`).join('')}</ul></div>` : ''}
    ${A(c.key_numbers).length ? `<ul class="case__kn">${A(c.key_numbers).map((x) => `<li>${rt(x)}</li>`).join('')}</ul>` : ''}
    ${linksHtml(c.links, `caso ${c.id}`)}
  </article>`;
}
function casesHtml() {
  const cs = A(W3.cases);
  const known = PATTERNS.map((p) => p[0]);
  const groups = PATTERNS.map(([k, label]) => ({ k, label, items: cs.filter((c) => c.pattern === k) }));
  groups.push({ k: 'otros', label: 'Otros', items: cs.filter((c) => !known.includes(c.pattern)) });
  return `<section class="sec" id="casos">
  ${secHead('cases', `Un mini-mapa por caso (${cs.length})`, 'Los mismos cuatro tramos en cada caso del curso, agrupados por patrón de inferencia. El C01 es el online síncrono de toda esta hoja.')}
  <div class="cases-all">${groups.filter((g) => g.items.length).map((g) => `<div class="cases-g" id="casos-${g.k}"><h3 class="sub">${esc(g.label)} <span class="cases-g__n">${g.items.length}</span></h3><div class="cases">${g.items.map(caseHtml).join('')}</div></div>`).join('')}</div>
</section>`;
}

// ---------------------------------------------------------------- quiz
const QUIZ = A(W4.quiz).filter((q) => IDS.includes(q.station));
function quizHtml() {
  const q0 = QUIZ[0];
  const rows = QUIZ.map((q) => `<tr><td>${rt(q.symptom)}</td><td class="nw">${ST[q.station].num} · ${esc(ST_SHORT[q.station])}</td><td class="${isCmd(q.first_check) ? 'mono' : 'chk'}">${chk(q.first_check)}</td></tr>`).join('');
  return `<section class="sec" id="quiz">
  ${secHead('quiz', '¿En qué estación falló?', `${QUIZ.length} síntomas reales del C01.`, undefined, 'Elige la estación; si fallas, prueba otra. Al acertar ves por qué y qué mirar primero.')}
  <p class="prt small">Para practicar en papel, tapa las dos columnas de la derecha y di la estación y el primer chequeo.</p>
  <div class="quiz" id="qz">
    <div class="quiz__top"><p class="tag">Síntoma</p><p class="quiz__n" id="qz-n">1 de ${QUIZ.length}</p></div>
    <p class="quiz__sym" id="qz-sym">${q0 ? rt(q0.symptom) : ''}</p>
    <p class="quiz__ask" id="qz-ask">Elige la estación</p>
    <div class="quiz__opts" id="qz-opts" role="group" aria-labelledby="qz-ask"></div>
    <div class="quiz__fb" id="qz-fb" aria-live="polite"></div>
    <div class="quiz__ctl"><button class="btn primary" id="qz-next" type="button">Siguiente</button><span class="quiz__score" id="qz-score"></span></div>
  </div>
  <div class="qprint"><table class="dt"><thead><tr><th scope="col">Síntoma</th><th scope="col">Estación</th><th scope="col">Primer chequeo</th></tr></thead><tbody>${rows}</tbody></table></div>
</section>`;
}

// ---------------------------------------------------------------- CSS
const CSS = `
/* Mismo diseño que el Cheat sheet de Docker: papel, tinta azul, resaltador ámbar. Las 4 líneas del metro tienen su color:
   semanas = violeta, días = azul, milisegundos = ámbar, continuo = verde azulado. */
:root {
  --bg: #f4f6f9; --paper: #ffffff; --ink: #18212d; --muted: #5a6575; --rule: #d6dde6; --grid: rgba(31, 95, 174, 0.075);
  --accent: #1f5fae; --accent-soft: rgba(31, 95, 174, 0.12); --accent2: #0f7a6e; --accent2-soft: rgba(15, 122, 110, 0.32);
  --hi: #d99a12; --hi-soft: #fff1cc; --warn: #b5482c; --warn-soft: #fbe8e2; --free: #e7ecf2; --onbar: #ffffff;
  --code-bg: #f6f8fb; --syn-kw: #1f5fae; --syn-str: #7a4fb8; --syn-com: #5a6575; --ok-soft: rgba(15, 122, 110, 0.12); --hi-ink: #8a5a00; --var-bg: rgba(31, 95, 174, 0.09); --pu: #7a4fb8; --pu-soft: rgba(122, 79, 184, 0.12); --on-hi: #18212d;
  --ln-semanas: var(--pu); --ln-dias: var(--accent); --ln-ms: var(--hi); --ln-continuo: var(--accent2);
  --ln-semanas-soft: var(--pu-soft); --ln-dias-soft: var(--accent-soft); --ln-ms-soft: rgba(217, 154, 18, 0.16); --ln-continuo-soft: var(--ok-soft);
  --ln-semanas-ink: #6b3fae; --ln-dias-ink: var(--accent); --ln-ms-ink: var(--hi-ink); --ln-continuo-ink: var(--accent2);
  --ln-semanas-on: #ffffff; --ln-dias-on: #ffffff; --ln-ms-on: #18212d; --ln-continuo-on: #ffffff;
  --new: #a3399b; --new-soft: rgba(163, 57, 155, 0.1);
  --wk-programa: #b02f62; --wk-configura: #2f7a2b; --wk-opera: #8f5617; --wk-administrado: #4b6584; --wk-on: #ffffff;
  --band: rgba(24, 33, 45, 0.045); --shadow: 0 1px 2px rgba(24, 33, 45, 0.05);
  --f-display: "Archivo", "Helvetica Neue", Arial, sans-serif; --f-body: "Source Serif 4", Georgia, "Times New Roman", serif;
  --f-mono: "JetBrains Mono", ui-monospace, Menlo, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #0e131a; --paper: #151c26; --ink: #e5ecf4; --muted: #9aa7b7; --rule: #2a3544; --grid: rgba(125, 175, 240, 0.085);
  --accent: #7db1ff; --accent-soft: rgba(125, 177, 255, 0.16); --accent2: #4fcfbf; --accent2-soft: rgba(79, 207, 191, 0.32);
  --hi: #f2c14e; --hi-soft: #3a2e10; --warn: #ff8b6e; --warn-soft: #3b1f18; --free: #1d2632; --onbar: #0e131a;
  --code-bg: #10161f; --syn-kw: #7db1ff; --syn-str: #c7b0f5; --syn-com: #9aa7b7; --ok-soft: rgba(79, 207, 191, 0.14); --hi-ink: #f2c14e; --var-bg: rgba(125, 177, 255, 0.13); --pu: #c7b0f5; --pu-soft: rgba(199, 176, 245, 0.15); --on-hi: #0e131a;
  --ln-ms-soft: rgba(242, 193, 78, 0.16); --ln-semanas-ink: #c7b0f5;
  --ln-semanas-on: #0e131a; --ln-dias-on: #0e131a; --ln-ms-on: #0e131a; --ln-continuo-on: #0e131a;
  --new: #ea8fe0; --new-soft: rgba(234, 143, 224, 0.13);
  --wk-programa: #f48fb5; --wk-configura: #8fd17f; --wk-opera: #e2ad6c; --wk-administrado: #a8bfdc; --wk-on: #0e131a;
  --band: rgba(229, 236, 244, 0.045); --shadow: none; color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #0e131a; --paper: #151c26; --ink: #e5ecf4; --muted: #9aa7b7; --rule: #2a3544; --grid: rgba(125, 175, 240, 0.085);
  --accent: #7db1ff; --accent-soft: rgba(125, 177, 255, 0.16); --accent2: #4fcfbf; --accent2-soft: rgba(79, 207, 191, 0.32);
  --hi: #f2c14e; --hi-soft: #3a2e10; --warn: #ff8b6e; --warn-soft: #3b1f18; --free: #1d2632; --onbar: #0e131a;
  --code-bg: #10161f; --syn-kw: #7db1ff; --syn-str: #c7b0f5; --syn-com: #9aa7b7; --ok-soft: rgba(79, 207, 191, 0.14); --hi-ink: #f2c14e; --var-bg: rgba(125, 177, 255, 0.13); --pu: #c7b0f5; --pu-soft: rgba(199, 176, 245, 0.15); --on-hi: #0e131a;
  --ln-ms-soft: rgba(242, 193, 78, 0.16); --ln-semanas-ink: #c7b0f5;
  --ln-semanas-on: #0e131a; --ln-dias-on: #0e131a; --ln-ms-on: #0e131a; --ln-continuo-on: #0e131a;
  --new: #ea8fe0; --new-soft: rgba(234, 143, 224, 0.13);
  --wk-programa: #f48fb5; --wk-configura: #8fd17f; --wk-opera: #e2ad6c; --wk-administrado: #a8bfdc; --wk-on: #0e131a;
  --band: rgba(229, 236, 244, 0.045); --shadow: none; color-scheme: dark; }
.ln-semanas { --ln: var(--ln-semanas); --ln-soft: var(--ln-semanas-soft); --ln-ink: var(--ln-semanas-ink); --ln-on: var(--ln-semanas-on); }
.ln-dias { --ln: var(--ln-dias); --ln-soft: var(--ln-dias-soft); --ln-ink: var(--ln-dias-ink); --ln-on: var(--ln-dias-on); }
.ln-ms { --ln: var(--ln-ms); --ln-soft: var(--ln-ms-soft); --ln-ink: var(--ln-ms-ink); --ln-on: var(--ln-ms-on); }
.ln-continuo { --ln: var(--ln-continuo); --ln-soft: var(--ln-continuo-soft); --ln-ink: var(--ln-continuo-ink); --ln-on: var(--ln-continuo-on); }
.wk-programa { --wk: var(--wk-programa); } .wk-configura { --wk: var(--wk-configura); } .wk-opera { --wk: var(--wk-opera); } .wk-administrado { --wk: var(--wk-administrado); }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; overflow-wrap: break-word; background: var(--bg); color: var(--ink); font: 17px/1.6 var(--f-body); padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); padding-block: 0 48px; }
.wrap { max-width: 1120px; margin: 0 auto; }
h1, h2, h3, h4, .tag { font-family: var(--f-display); text-wrap: balance; }
a { color: var(--accent); }
a:focus-visible, button:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 6px; }
.sprite { position: absolute; width: 0; height: 0; overflow: hidden; }
svg.ic { width: 1em; height: 1em; flex: none; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; vertical-align: -0.14em; }
.dot { display: inline-block; flex: none; width: 9px; height: 9px; border-radius: 50%; background: var(--ln, var(--muted)); }
.k { font: 700 12.5px var(--f-display); color: var(--muted); letter-spacing: .02em; margin-right: 2px; }
.small { font-size: 14.5px; color: var(--muted); }
.nb { white-space: nowrap; }
var.ph { font-family: var(--f-body); font-style: italic; font-weight: 600; font-size: 1.06em; letter-spacing: 0; color: var(--accent); background: var(--var-bg); border-radius: 4px; padding: 0 3px; }
code, code.cmd { font: 13.5px var(--f-mono); background: var(--free); padding: 1px 5px; border-radius: 4px; overflow-wrap: anywhere; }

.tag { font-size: 11.5px !important; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; margin: 0 0 4px !important; color: var(--muted); display: flex; align-items: center; gap: 6px; }
/* hero */
.hero { padding-block: 40px 22px; display: grid; gap: 12px; }
.hero .kicker { font: 600 12.5px/1.3 var(--f-display); letter-spacing: .14em; text-transform: uppercase; color: var(--accent); margin: 0; }
.hero h1 { font-size: clamp(34px, 6.4vw, 58px); line-height: 1.02; margin: 0; font-weight: 800; font-stretch: 112%; letter-spacing: -0.01em; }
.hero h1 mark { background: linear-gradient(transparent 58%, var(--hi-soft) 58%, var(--hi-soft) 92%, transparent 92%); color: inherit; padding: 0 .04em; }
.hero p.lead { max-width: 72ch; margin: 0; color: var(--muted); font-size: 18px; }
ol.howto { list-style: none; margin: 4px 0 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); gap: 10px; }
ol.howto li { display: flex; gap: 10px; align-items: flex-start; background: var(--paper); border: 1px solid var(--rule); border-radius: 12px; padding: 10px 12px; font-size: 15.5px; line-height: 1.45; min-width: 0; }
.howto__n { flex: none; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; background: var(--ink); color: var(--paper); font: 800 13px/1 var(--f-display); margin-top: 1px; }
.legend { display: grid; gap: 8px; margin-top: 4px; }
.legend__row, .maplg { display: flex; flex-wrap: wrap; gap: 8px 18px; font: 500 13.5px/1.4 var(--f-display); color: var(--muted); }
.lg { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px 7px; min-width: 0; }
.lg b { color: var(--ink); }
.lg-line { width: 32px; height: 7px; border-radius: 4px; background: var(--ln); display: inline-block; position: relative; flex: none; }
.lg-line::after { content: ""; position: absolute; left: 50%; top: 50%; width: 13px; height: 13px; margin: -6.5px 0 0 -6.5px; border-radius: 50%; background: var(--paper); border: 3px solid var(--ln); box-sizing: border-box; }
.lg-loop { width: 32px; height: 0; border-top: 4px dashed var(--ln-continuo); display: inline-block; flex: none; }
svg.lg-x { width: 22px; height: 22px; flex: none; }
.g-o { fill: var(--paper); stroke: var(--ink); stroke-width: 3; } .g-i { fill: var(--paper); stroke: var(--muted); stroke-width: 3; }
.lg-ticket { font: 500 12.5px var(--f-display); color: var(--ink); background: var(--paper); border: 1.4px solid var(--accent); border-radius: 5px; padding: 1px 7px; }
.badge { display: inline-flex; align-items: center; gap: 4px; flex: none; font: 700 11px/1.2 var(--f-display); letter-spacing: .06em; text-transform: uppercase; border-radius: 999px; padding: 3px 8px 3px 6px; }
.badge.real { background: var(--accent2); color: var(--onbar); }
.badge.desc { border: 1.5px dashed var(--muted); color: var(--muted); }
/* nav */
nav.toc { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 5; background: var(--bg); border-bottom: 1px solid var(--rule); margin-bottom: 8px; }
nav.toc ul { list-style: none; display: flex; gap: 6px; overflow-x: auto; margin: 0; padding: 10px 0; scrollbar-width: thin; }
nav.toc a { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; padding: 6px 11px; border-radius: 999px; border: 1px solid var(--rule); background: var(--paper); color: var(--ink); text-decoration: none; font: 600 13px/1 var(--f-display); }
nav.toc a:hover, nav.toc a:focus-visible { border-color: var(--accent); color: var(--accent); outline: none; }
nav.toc a[aria-current="true"] { background: var(--ink); border-color: var(--ink); color: var(--paper); }
/* secciones */
.sec { padding-block: 34px 10px; border-top: 1px solid var(--rule); scroll-margin-top: 58px; }
.sec__head { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 16px; }
.sec__n { flex: none; width: 46px; height: 46px; border-radius: 10px; display: grid; place-items: center; background: var(--ink); color: var(--paper); font: 800 22px/1 var(--f-display); }
.sec__n svg.ic { width: 26px; height: 26px; stroke-width: 2; }
.sec h2 { margin: 0; font-size: clamp(24px, 3.4vw, 32px); line-height: 1.1; font-weight: 800; font-stretch: 108%; }
.sec__q { margin: 4px 0 0; color: var(--muted); }
h3.sub { margin: 26px 0 10px; font-size: 13px; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); font-weight: 800; display: flex; align-items: center; gap: 8px; }
h3.sub svg.ic { width: 17px; height: 17px; color: var(--ln, var(--muted)); }
.intro { max-width: 78ch; margin: 0 0 14px; }
figure.fig { min-width: 0; margin: 12px 0 0; background: var(--paper); border: 1px solid var(--rule); border-radius: 12px; padding: 14px; }
figure.fig figcaption { color: var(--muted); font-size: 15px; margin-top: 10px; }
/* mapa */
.map { padding: 12px 10px 12px; }
.maplg { padding: 0 4px 8px; font-size: 12.5px; gap: 6px 14px; }
.maplg .lg span { display: none; }
.map .mapsvg { display: block; width: 100%; height: auto; margin: 0 auto; }
.map .map2d { max-width: 900px; }
.map .mapv { display: none; max-width: 440px; }
@media (max-width: 699px) { .map .map2d { display: none; } .map .mapv { display: block; } .map { padding: 10px 4px; } }
svg .band { fill: var(--band); }
svg .bandl { font: 800 11px var(--f-display); letter-spacing: .16em; fill: var(--muted); }
svg .seg { fill: none; stroke: var(--ln); stroke-width: 8; }
svg .loop { fill: none; stroke: var(--ln-continuo); stroke-width: 4.5; stroke-dasharray: 11 7; }
svg .loopl { font: 800 13px var(--f-display); fill: var(--ln-continuo-ink); }
svg .loopic { color: var(--ln-continuo-ink); stroke-width: 2.3; }
svg .arrfill { fill: var(--ln-continuo); }
svg .rdo { fill: var(--paper); stroke: var(--ink); stroke-width: 3; }
svg .rdi { fill: var(--paper); stroke: var(--ln); stroke-width: 4.5; }
svg .mic { color: var(--ink); stroke: currentColor; fill: none; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
svg .nm { font: 700 15px var(--f-display); fill: var(--ink); }
svg.mapv .nm { font-size: 15.5px; }
svg .nm .no { font-weight: 800; fill: var(--ln-ink); }
svg .tkb { fill: var(--paper); stroke: var(--ln); stroke-width: 1.4; }
svg .tkt { font: 500 13px var(--f-display); fill: var(--ink); }
svg .fr { fill: none; stroke: var(--accent); stroke-width: 2.5; stroke-dasharray: 4 3; opacity: 0; }
svg a.stn { cursor: pointer; }
svg a.stn:focus { outline: none; }
svg a.stn:hover .fr, svg a.stn:focus-visible .fr { opacity: 1; }
svg a.stn:hover .nm, svg a.stn:focus-visible .nm { text-decoration: underline; }
.loopnote { display: flex; gap: 12px; align-items: flex-start; margin-top: 12px; background: var(--ok-soft); border-radius: 12px; padding: 12px 16px; }
.loopnote p { margin: 0; } .loopnote .tag { color: var(--accent2); }
.loopnote__ic { flex: none; width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; background: var(--accent2); color: var(--onbar); }
.loopnote__ic svg.ic { width: 20px; height: 20px; }
/* líneas (velocidades) */
.lanes { display: grid; gap: 14px; margin-top: 4px; }
.lane { min-width: 0; background: var(--paper); border: 1px solid var(--rule); border-left: 7px solid var(--ln); border-radius: 12px; padding: 14px 16px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; scroll-margin-top: 64px; }
.lane__h { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; }
.lane__speed { font: 800 12px/1 var(--f-display); letter-spacing: .14em; text-transform: uppercase; color: var(--ln-on); background: var(--ln); border-radius: 999px; padding: 6px 11px; }
.lane h3 { margin: 0; font-size: 21px; font-weight: 800; }
.lane__dl { margin: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 250px), 1fr)); gap: 10px 20px; }
.lane__dl dt, .pf__dl dt { font: 800 11px/1.3 var(--f-display); letter-spacing: .12em; text-transform: uppercase; color: var(--ln-ink, var(--muted)); }
.lane__dl dd { margin: 3px 0 0; font-size: 15px; line-height: 1.5; }
.lane__note { margin: 0; font-size: 15px; line-height: 1.5; background: var(--ln-soft); border-radius: 8px; padding: 8px 12px; }
ol.strip { list-style: none; margin: 0; padding: 2px 0; display: flex; flex-wrap: wrap; align-items: center; row-gap: 10px; min-width: 0; }
ol.strip > li { display: flex; align-items: center; min-width: 0; max-width: 100%; }
ol.strip > li + li::before { content: ""; flex: none; width: 16px; height: 5px; border-radius: 3px; background: var(--ln, var(--muted)); margin: 0 3px; }
.stop { display: inline-flex; align-items: center; gap: 7px; min-width: 0; max-width: 100%; padding: 4px 12px 4px 4px; border: 2px solid var(--ln, var(--muted)); border-radius: 999px; background: var(--paper); color: var(--ink); text-decoration: none; font: 600 14px/1.25 var(--f-display); }
a.stop:hover, a.stop:focus-visible { background: var(--ln-soft, var(--free)); outline: none; }
.stop__rd { flex: none; width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; background: var(--ln-soft, var(--free)); color: var(--ln-ink, var(--ink)); }
.stop__rd svg.ic { width: 17px; height: 17px; }
.stop__n { font-weight: 800; color: var(--ln-ink, var(--ink)); }
.stop__t { font: 600 12px var(--f-mono); color: var(--muted); white-space: nowrap; }
.stop--x { box-shadow: 0 0 0 2px var(--paper), 0 0 0 4px var(--ink); }
.stop--xo { --ln: var(--ink); border-color: var(--ink); }
.stop--xo .stop__rd { background: var(--free); color: var(--ink); }
.pips { display: inline-flex; gap: 3px; margin-left: 2px; }
.pip { width: 11px; height: 11px; border-radius: 50%; background: var(--ln); box-shadow: 0 0 0 1.5px var(--paper), 0 0 0 2.5px var(--rule); }
@media (max-width: 600px) {
  ol.strip.vsm { flex-direction: column; align-items: stretch; row-gap: 0; }
  ol.strip.vsm > li { flex-direction: column; align-items: flex-start; }
  ol.strip.vsm > li + li::before { width: 5px; height: 13px; margin: 0 0 0 17px; }
}
.lnname { display: inline-flex; align-items: center; gap: 5px; font: 700 13px/1.3 var(--f-display); color: var(--ln-ink); white-space: nowrap; }
.xfers { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 460px), 1fr)); gap: 12px; }
.xfer { min-width: 0; background: var(--paper); border: 1px solid var(--rule); border-radius: 12px; padding: 12px 14px; display: grid; grid-template-columns: 104px minmax(0, 1fr); gap: 4px 12px; align-items: start; scroll-margin-top: 64px; }
svg.xg { width: 104px; height: auto; display: block; }
.xg-l { fill: none; stroke: var(--ln); stroke-width: 6; }
.xfer h4 { margin: 0; font-size: 17px; font-weight: 800; }
.xfer p { margin: 4px 0 0; font-size: 15px; line-height: 1.5; }
.xfer__con { font: 500 14px/1.6 var(--f-display); color: var(--muted); }
.xfer__con .lnname { vertical-align: baseline; }
@media (max-width: 420px) { .xfer { grid-template-columns: minmax(0, 1fr); } }
.stlink { display: inline-flex; align-items: center; gap: 5px; font: 700 13.5px/1.3 var(--f-display); color: var(--ln-ink); text-decoration: none; border-bottom: 1.5px solid var(--ln); }
/* estaciones */
.st__head { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 12px; }
.st__n { flex: none; width: 52px; height: 52px; border-radius: 50%; display: grid; place-items: center; background: var(--ln); color: var(--ln-on); font: 800 23px/1 var(--f-display); box-shadow: 0 0 0 3px var(--paper), 0 0 0 5px var(--ln); margin: 3px; }
.st__kick { margin: 0 0 3px; font: 700 12.5px/1.4 var(--f-display); letter-spacing: .04em; color: var(--muted); display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; }
.st__x { display: flex; gap: 10px; align-items: flex-start; margin: 0 0 12px; font: 500 14.5px/1.45 var(--f-display); background: var(--paper); border: 1px solid var(--rule); border-radius: 10px; padding: 8px 12px; }
.st__x .lnname { font-size: 13.5px; }
.st__sum { margin: 0 0 14px; max-width: 80ch; }
.io { display: grid; grid-template-columns: minmax(0, 1fr) 34px minmax(0, 1fr); gap: 8px; align-items: center; background: var(--paper); border: 1px solid var(--rule); border-radius: 12px; padding: 12px 14px; }
.io__arrow { display: grid; place-items: center; color: var(--ln); }
.io__arrow svg.ic { width: 28px; height: 28px; stroke-width: 2.4; }
ul.io__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.art { font: 500 14.5px/1.35 var(--f-display); background: var(--bg); border: 1px solid var(--rule); border-radius: 8px; padding: 6px 10px; }
.art--go { border: 2px solid var(--ln); background: var(--paper); }
.art__go { display: block; margin-top: 3px; font: 800 11px/1.3 var(--f-display); letter-spacing: .08em; text-transform: uppercase; color: var(--ln-ink); }
@media (max-width: 640px) { .io { grid-template-columns: minmax(0, 1fr); } .io__arrow svg.ic { transform: rotate(90deg); } }
.flow { list-style: none; margin: 0; padding: 0 0 2px; display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 205px), 1fr)); gap: 16px 30px; overflow: hidden; }
.step { position: relative; min-width: 0; background: var(--paper); border: 1px solid var(--rule); border-top: 4px solid var(--ln); border-radius: 12px; padding: 10px 12px 11px; display: flex; flex-direction: column; gap: 4px; }
.step:not(:last-child)::after { content: ""; position: absolute; top: 18px; right: -27px; width: 24px; height: 16px; background: var(--ln); -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 16'%3E%3Cpath d='M1 8h19M14 2l6.5 6-6.5 6' fill='none' stroke='black' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / contain no-repeat; mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 16'%3E%3Cpath d='M1 8h19M14 2l6.5 6-6.5 6' fill='none' stroke='black' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / contain no-repeat; }
.step__top { display: flex; align-items: center; gap: 8px; }
.step__ic { flex: none; width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; background: var(--ln-soft); color: var(--ln-ink); }
.step__ic svg.ic { width: 20px; height: 20px; }
.step__n { font: 800 11.5px var(--f-display); color: var(--muted); letter-spacing: .1em; text-transform: uppercase; }
.step__l { margin: 0; font: 700 16px/1.3 var(--f-display); }
.step__d { margin: 0; font-size: 14.5px; line-height: 1.45; }
.step__m { margin: auto 0 0; padding-top: 6px; display: flex; flex-wrap: wrap; gap: 4px 6px; }
.who, .where { display: inline-flex; align-items: center; gap: 4px; min-width: 0; max-width: 100%; font: 600 11.5px/1.25 var(--f-display); color: var(--muted); background: var(--bg); border: 1px solid var(--rule); border-radius: 999px; padding: 2px 8px 2px 6px; }
.who { color: var(--ink); } .who.auto { border-style: dashed; }
@media (max-width: 520px) { .flow { grid-template-columns: minmax(0, 1fr); row-gap: 28px; } .step:not(:last-child)::after { top: auto; right: auto; left: 22px; bottom: -24px; transform: rotate(90deg); } }
.files { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 380px), 1fr)); grid-auto-flow: dense; gap: 12px; }
.file { min-width: 0; background: var(--paper); border: 1px solid var(--rule); border-radius: 12px; padding: 12px 14px; }
.file--real { grid-column: 1 / -1; }
.file--desc { border-style: dashed; background: transparent; }
.file__h { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
.file__p { font: 600 13.5px/1.4 var(--f-mono); background: none; padding: 0; overflow-wrap: anywhere; }
b.file__p { font: 700 15px/1.35 var(--f-display); }
.file__w { margin: 6px 0 0; font-size: 15px; line-height: 1.5; }
button.cp { flex: none; font: 600 11.5px/1 var(--f-display); letter-spacing: .02em; color: var(--accent); background: var(--paper); border: 1px solid var(--rule); border-radius: 6px; padding: 5px 8px; cursor: pointer; }
button.cp:hover, button.cp:focus-visible { border-color: var(--accent); outline: none; }
.code { margin-top: 10px; background: var(--code-bg); border: 1px solid var(--rule); border-radius: 10px; min-width: 0; }
.code__bar { display: flex; align-items: center; gap: 10px; padding: 6px 8px 6px 12px; border-bottom: 1px solid var(--rule); font: 600 12px/1.3 var(--f-display); color: var(--muted); }
.code__lang { text-transform: uppercase; letter-spacing: .08em; flex: none; }
.code__src { flex: 1; min-width: 0; font-weight: 500; overflow-wrap: anywhere; }
.code__bar .cp { margin-left: auto; }
.code pre { margin: 0; padding: 12px 14px; overflow-x: auto; font: 13px/1.55 var(--f-mono); color: var(--ink); tab-size: 4; }
.code pre code { font: inherit; background: none; padding: 0; overflow-wrap: normal; }
.tk-k { color: var(--syn-kw); font-weight: 700; } .tk-s { color: var(--syn-str); } .tk-c { color: var(--syn-com); font-style: italic; }
ul.cmds { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.cmdline { display: flex; align-items: flex-start; gap: 8px; background: var(--code-bg); border: 1px solid var(--rule); border-radius: 8px; padding: 8px 8px 8px 12px; }
.cmdline code.cmd { flex: 1; min-width: 0; background: none; padding: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: 13.5px/1.5 var(--f-mono); }
.cmdnote { margin: 4px 2px 0; font-size: 14.5px; line-height: 1.45; color: var(--muted); }
.cmdw { display: inline-flex; align-items: baseline; gap: 6px; max-width: 100%; min-width: 0; }
.tscroll { overflow-x: auto; }
.dt { width: 100%; border-collapse: collapse; font-size: 14.5px; line-height: 1.45; background: var(--paper); border: 1px solid var(--rule); border-radius: 12px; }
.dt th { text-align: left; font: 700 11.5px/1.3 var(--f-display); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); border-bottom: 1px solid var(--rule); padding: 8px; vertical-align: bottom; }
.dt td, .dt th.rh { border-bottom: 1px solid var(--rule); padding: 8px; vertical-align: top; overflow-wrap: anywhere; text-align: left; }
.dt tr:last-child td, .dt tr:last-child th.rh { border-bottom: 0; }
.dt th.rh { font: 600 14.5px/1.45 var(--f-display); letter-spacing: 0; text-transform: none; color: var(--ink); overflow-wrap: break-word; }
table.fails th.rh { width: 33%; } table.fails td { width: 33%; }
.st__end { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; margin-top: 16px; align-items: start; }
@media (max-width: 760px) { .st__end { grid-template-columns: minmax(0, 1fr); } }
.donebox { background: var(--paper); border: 1px solid var(--rule); border-radius: 12px; padding: 12px 16px; }
.donebox .tag { color: var(--accent2); }
ul.done { list-style: none; margin: 4px 0 0; padding: 0; display: grid; gap: 6px; }
ul.done li { position: relative; padding-left: 26px; font-size: 15px; line-height: 1.45; }
ul.done li::before { content: ""; position: absolute; left: 0; top: 2px; width: 17px; height: 17px; border-radius: 5px; border: 2px solid var(--accent2); background: var(--ok-soft); }
ul.done li::after { content: ""; position: absolute; left: 5px; top: 5px; width: 5px; height: 9px; border: solid var(--accent2); border-width: 0 2.4px 2.4px 0; transform: rotate(45deg); }
.notes { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
.memo, .trap { border-radius: 10px; padding: 12px 16px; min-width: 0; }
.memo { background: var(--hi-soft); } .trap { background: var(--warn-soft); }
.memo p, .trap p { margin: 0; font-size: 15.5px; line-height: 1.5; }
.memo .tag { color: var(--hi-ink); } .trap .tag { color: var(--warn); }
.links { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin: 16px 0 0; font: 500 13px/1.35 var(--f-display); }
.links__k { color: var(--muted); font-weight: 700; }
.links .chip { border: 1px solid var(--rule); background: var(--paper); border-radius: 999px; padding: 4px 10px; color: var(--ink); text-decoration: none; }
.links a.chip:hover, .links a.chip:focus-visible { border-color: var(--accent); color: var(--accent); }
/* fichas de herramientas */
.pfs { display: grid; gap: 12px; }
.pf { min-width: 0; background: var(--paper); border: 1px solid var(--rule); border-radius: 14px; padding: 14px 16px; scroll-margin-top: 64px; box-shadow: var(--shadow); }
.pf__h { display: flex; gap: 12px; align-items: center; }
.pf__ic { flex: none; width: 40px; height: 40px; border-radius: 10px; display: grid; place-items: center; background: var(--free); color: var(--ink); }
.pf__ic svg.ic { width: 24px; height: 24px; }
.pf h4 { margin: 0; font-size: 19px; line-height: 1.2; font-weight: 800; }
.pf__cat { margin: 2px 0 0; font: 600 12.5px/1.3 var(--f-display); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.pf__grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px 22px; margin-top: 10px; align-items: start; }
@media (max-width: 860px) { .pf__grid { grid-template-columns: minmax(0, 1fr); } }
.pf__a p, .pf__w p { margin: 8px 0 0; font-size: 15.5px; line-height: 1.5; }
.pf__a p:first-child { margin-top: 0; }
.pf__what { font-weight: 600; }
.pf__an { color: var(--muted); font-style: italic; }
.pf__an .k { font-style: normal; }
.pf__w { background: var(--bg); border-radius: 10px; padding: 10px 12px; min-width: 0; }
.pf__ex { margin-top: 12px; }
.pf__ex .code { margin-top: 2px; }
.wkrow { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.wkb { display: inline-flex; align-items: center; gap: 5px; border-radius: 999px; padding: 3px 9px 3px 6px; font: 700 12.5px/1.2 var(--f-display); border: 1.5px solid var(--wk, var(--muted)); color: var(--wk, var(--muted)); background: var(--paper); white-space: nowrap; }
.wkb svg.ic { width: 15px; height: 15px; }
.wkb--main { background: var(--wk); color: var(--wk-on); font-size: 14px; padding: 5px 13px 5px 8px; }
.wkb--main svg.ic { width: 18px; height: 18px; }
.pf__dl { margin: 12px 0 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: 8px 22px; }
.pf__dl dd { margin: 2px 0 0; font-size: 15px; line-height: 1.5; }
.pfrefs { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 330px), 1fr)); gap: 10px; }
a.pfref { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; background: var(--paper); border: 1px dashed var(--rule); border-radius: 12px; padding: 10px 12px; color: var(--ink); text-decoration: none; min-width: 0; }
a.pfref:hover, a.pfref:focus-visible { border-color: var(--accent); }
.pfref__b { flex: 1 1 180px; min-width: 0; display: flex; flex-direction: column; }
.pfref__b b { font: 800 15.5px/1.25 var(--f-display); }
.pfref__t { font: 500 13px/1.35 var(--f-display); color: var(--muted); }
.pfref .wkrow .wkb { font-size: 11.5px; padding: 2px 8px 2px 5px; }
.st__pn { display: flex; justify-content: space-between; gap: 10px; margin-top: 18px; font: 700 14px/1.3 var(--f-display); }
.st__pn a { text-decoration: none; padding: 6px 2px; }
/* ¿se programa? */
.wkcols { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 1040px) { .wkcols { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 620px) { .wkcols { grid-template-columns: minmax(0, 1fr); } }
.wk { min-width: 0; background: var(--paper); border: 1px solid var(--rule); border-top: 6px solid var(--wk); border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
.wk__h { display: flex; align-items: center; gap: 9px; }
.wk__ic { flex: none; width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; background: var(--wk); color: var(--wk-on); }
.wk__ic svg.ic { width: 22px; height: 22px; }
.wk h3 { margin: 0; font-size: 19px; font-weight: 800; color: var(--wk); flex: 1; }
.wk__c { font: 800 13px var(--f-display); color: var(--wk); border: 1.5px solid var(--wk); border-radius: 999px; padding: 2px 9px; }
.wk__t { margin: 0; font-size: 14.5px; line-height: 1.5; }
ul.wk__list { list-style: none; margin: 4px 0 0; padding: 0; display: grid; gap: 7px; }
a.pfmini { display: flex; gap: 9px; align-items: flex-start; padding: 8px 10px; border: 1px solid var(--rule); border-radius: 10px; text-decoration: none; color: var(--ink); background: var(--bg); min-width: 0; }
a.pfmini:hover, a.pfmini:focus-visible { border-color: var(--wk); outline: none; }
.pfmini__ic { flex: none; width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; background: var(--paper); border: 1.5px solid var(--wk); color: var(--wk); }
.pfmini__ic svg.ic { width: 18px; height: 18px; }
.pfmini__b { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.pfmini__b b { font: 700 14.5px/1.25 var(--f-display); }
.pfmini__st { display: inline-flex; align-items: center; gap: 5px; font: 600 12px/1.2 var(--f-display); color: var(--ln-ink); }
.pfmini__also { display: flex; flex-wrap: wrap; gap: 4px; }
.wkdot { display: inline-flex; align-items: center; gap: 3px; font: 600 11px/1.2 var(--f-display); color: var(--wk); border: 1px solid var(--wk); border-radius: 999px; padding: 1px 6px 1px 4px; }
.wkdot svg.ic { width: 12px; height: 12px; }
/* patrones */
.cmplg { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; margin: 0 0 4px; }
.pat { min-width: 0; background: var(--paper); border: 1px solid var(--rule); border-radius: 14px; padding: 16px; margin-top: 16px; scroll-margin-top: 64px; }
.pat__h { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; margin-bottom: 6px; }
.pat__tag { font: 800 12px/1 var(--f-display); letter-spacing: .12em; text-transform: uppercase; background: var(--ink); color: var(--paper); border-radius: 999px; padding: 6px 11px; }
.pat h3 { margin: 0; font-size: 22px; line-height: 1.2; font-weight: 800; }
.pat__sum { margin: 0 0 12px; }
ol.cmp { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 0; }
ol.cmp > li { display: flex; align-items: center; }
ol.cmp > li + li::before { content: ""; width: 10px; height: 2px; background: var(--rule); margin: 0 2px; }
.cmpc { display: inline-flex; align-items: center; gap: 5px; border-radius: 999px; padding: 4px 10px; font: 600 13px/1.25 var(--f-display); border: 1.5px solid var(--rule); color: var(--muted); background: var(--paper); }
.cmpc .n { font-weight: 800; }
.cmpc--cambia { border: 2px solid var(--hi); color: var(--ink); }
.cmpc--desaparece { border-style: dashed; color: var(--muted); opacity: .6; text-decoration: line-through; }
.cmpc--nueva { border: 2px solid var(--new); color: var(--new); background: var(--new-soft); font-weight: 700; }
.cmpc svg.ic { width: 14px; height: 14px; stroke-width: 2.4; }
.pat__lt { margin-top: 14px !important; }
.pat__line { --ln: var(--muted); --ln-soft: var(--free); --ln-ink: var(--ink); }
.pat__speeds { display: flex; gap: 10px; align-items: flex-start; margin-top: 12px; background: var(--bg); border-radius: 10px; padding: 10px 12px; }
.pat__speeds svg.ic { flex: none; width: 20px; height: 20px; margin-top: 3px; color: var(--muted); }
.pat__speeds p { margin: 0; font-size: 15.5px; line-height: 1.5; }
details.pat__more { margin-top: 12px; border: 1px solid var(--rule); border-radius: 10px; }
details.pat__more > summary { cursor: pointer; list-style: none; padding: 9px 12px; font: 700 14px/1.3 var(--f-display); display: flex; gap: 8px; align-items: center; }
details.pat__more > summary::-webkit-details-marker { display: none; }
details.pat__more > summary::before { content: "▸"; color: var(--accent); transition: transform .15s; }
details.pat__more[open] > summary::before { transform: rotate(90deg); }
ul.cmpns { list-style: none; margin: 0; padding: 4px 12px 12px; display: grid; gap: 0; border-top: 1px solid var(--rule); }
li.cmpn { display: grid; grid-template-columns: 200px 104px minmax(0, 1fr); gap: 4px 12px; align-items: start; padding: 8px 0; border-bottom: 1px solid var(--rule); }
li.cmpn:last-child { border-bottom: 0; }
.cmpn .cmpc { justify-self: start; max-width: 100%; }
.cmpn__s { font: 800 11px/2 var(--f-display); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.cmpn--cambia .cmpn__s { color: var(--hi-ink); } .cmpn--nueva .cmpn__s { color: var(--new); }
.cmpn__t { font-size: 15px; line-height: 1.5; }
.cmpn--igual .cmpn__t, .cmpn--desaparece .cmpn__t { color: var(--muted); }
@media (max-width: 700px) { li.cmpn { grid-template-columns: minmax(0, 1fr) auto; } .cmpn__t { grid-column: 1 / -1; } }
/* casos */
.cases-g { margin-top: 6px; }
.cases-g__n { font: 800 12px var(--f-display); border: 1.5px solid var(--rule); border-radius: 999px; padding: 1px 8px; letter-spacing: 0; }
.cases { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr)); gap: 12px; }
.case { min-width: 0; background: var(--paper); border: 1px solid var(--rule); border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 9px; scroll-margin-top: 64px; }
.case__h { display: flex; align-items: center; gap: 9px; }
.case__pat { display: none; }
.case__id { flex: none; font: 800 12.5px/1 var(--f-display); background: var(--ink); color: var(--paper); border-radius: 7px; padding: 5px 7px; }
.case h4 { margin: 0; font-size: 17px; line-height: 1.25; font-weight: 800; }
.case__one { margin: 0; font-size: 15px; line-height: 1.5; }
.mm { display: grid; grid-template-columns: minmax(0, 1fr); background: var(--bg); border-radius: 10px; padding: 9px 10px 4px; }
.mm__row { display: grid; grid-template-columns: 14px minmax(0, 1fr); gap: 9px; position: relative; padding-bottom: 7px; min-width: 0; }
.mm__row:not(:last-child)::after { content: ""; position: absolute; left: 5.75px; top: 14px; bottom: -1px; width: 2.5px; background: var(--muted); opacity: .5; }
.mm__dot { width: 14px; height: 14px; border-radius: 50%; border: 2.5px solid var(--ink); background: var(--paper); margin-top: 1px; position: relative; z-index: 1; }
.mm__t { display: block; font: 800 10.5px/1.5 var(--f-display); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.mm__c { display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; margin-top: 2px; }
.mm__c > span { font: 500 13px/1.3 var(--f-display); background: var(--paper); border: 1px solid var(--rule); border-radius: 6px; padding: 3px 7px; min-width: 0; }
.case__vs ul { margin: 2px 0 0; padding-left: 18px; font-size: 14.5px; line-height: 1.5; }
.case__vs li + li { margin-top: 3px; }
ul.case__kn { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
ul.case__kn li { font: 700 13px/1.3 var(--f-display); background: var(--hi-soft); color: var(--ink); border-radius: 8px; padding: 4px 9px; }
.case .links { margin-top: auto; padding-top: 2px; }
/* quiz */
.quiz { background: var(--paper); border: 1px solid var(--rule); border-radius: 14px; padding: 16px; }
.quiz__top { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 4px 12px; }
.quiz__n { margin: 0; font: 700 13px var(--f-display); color: var(--muted); font-variant-numeric: tabular-nums; }
.quiz__sym { margin: 6px 0 0; font: 500 17px/1.5 var(--f-display); background: var(--code-bg); border: 1px solid var(--rule); border-left: 4px solid var(--warn); border-radius: 10px; padding: 12px 14px; }
.quiz__ask { margin: 14px 0 6px; font: 800 13px var(--f-display); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.quiz__opts { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 230px), 1fr)); gap: 8px; }
button.qopt { display: flex; align-items: center; gap: 10px; text-align: left; font: 700 15px/1.3 var(--f-display); color: var(--ink); background: var(--paper); border: 2px solid var(--ln); border-radius: 12px; padding: 8px 12px 8px 8px; cursor: pointer; min-height: 52px; }
button.qopt:hover:not(:disabled) { background: var(--ln-soft); }
button.qopt:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
.qopt .qrd { flex: none; width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; background: var(--ln-soft); color: var(--ln-ink); }
.qopt .qrd svg.ic { width: 19px; height: 19px; }
.qopt .qn { color: var(--ln-ink); font-weight: 800; margin-right: 2px; }
.qopt .qmark { margin-left: auto; flex: none; }
button.qopt.is-wrong { border-color: var(--warn); background: var(--warn-soft); color: var(--muted); text-decoration: line-through; cursor: default; }
button.qopt.is-right { border-color: var(--accent2); background: var(--ok-soft); box-shadow: 0 0 0 2px var(--accent2); cursor: default; }
button.qopt:disabled:not(.is-right):not(.is-wrong) { opacity: .55; cursor: default; }
.quiz__fb { margin-top: 12px; }
.quiz__fb:empty { display: none; }
.fb { border-radius: 12px; padding: 12px 14px; display: grid; gap: 8px; }
.fb p { margin: 0; }
.fb--no { background: var(--warn-soft); }
.fb--ok { background: var(--ok-soft); }
.fb__h { font: 800 16px/1.3 var(--f-display); display: flex; align-items: center; gap: 8px; }
.fb--no .fb__h { color: var(--warn); } .fb--ok .fb__h { color: var(--accent2); }
.fb__h svg.ic { width: 20px; height: 20px; stroke-width: 2.6; }
p.chk { margin: 0; padding: 10px 12px; border-radius: 8px; background: var(--code-bg); border: 1px solid var(--rule); }
pre.term { margin: 0; padding: 10px 12px; border-radius: 8px; background: var(--code-bg); border: 1px solid var(--rule); font: 600 13.5px/1.55 var(--f-mono); color: var(--ink); white-space: pre-wrap; overflow-wrap: anywhere; }
.quiz__ctl { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; margin-top: 14px; }
.quiz__score { font: 600 13.5px var(--f-display); color: var(--muted); }
.btn { font: 700 15px/1.2 var(--f-display); color: var(--ink); background: var(--paper); border: 1px solid var(--rule); border-radius: 10px; padding: 10px 16px; cursor: pointer; min-height: 44px; }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--paper); }
.btn.primary:hover { filter: brightness(1.08); }
.qprint, .psum, .prt { display: none; }
footer { margin-top: 30px; color: var(--muted); font-size: 14px; border-top: 1px solid var(--rule); padding-top: 14px; }
footer p { margin: 0 0 6px; max-width: 90ch; }
@media (max-width: 640px) {
  table.stk, table.stk tbody, table.stk tr, table.stk td, table.stk th.rh { display: block; width: 100% !important; }
  table.stk thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  table.stk tr { border-bottom: 1px solid var(--rule); padding: 8px 10px; }
  table.stk tr:last-child { border-bottom: 0; }
  table.stk td, table.stk th.rh { border: 0; padding: 2px 0; }
  table.stk td[data-k]::before { content: attr(data-k); display: block; margin-top: 4px; font: 700 10.5px/1.5 var(--f-display); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
  .hero { padding-top: 28px; }
  .sec__head, .st__head { gap: 12px; }
  .st__n { width: 44px; height: 44px; font-size: 20px; }
}
@media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }
/* sin ligaduras en el código: != , == y -< se ven tal como se escriben (el atajo font: de cada bloque las reiniciaría) */
code, pre, .cmd, var.ph { font-variant-ligatures: none !important; font-feature-settings: "liga" 0, "calt" 0 !important; }
@media print {
  @page { size: A4; margin: 12mm; }
  @page mapa { size: A4 landscape; margin: 9mm; }
  :root, :root:not([data-theme="light"]), :root[data-theme="dark"] {
    --bg: #ffffff; --paper: #ffffff; --ink: #18212d; --muted: #5a6575; --rule: #d6dde6;
    --accent: #1f5fae; --accent-soft: rgba(31, 95, 174, 0.12); --accent2: #0f7a6e; --hi: #d99a12; --hi-soft: #fff1cc; --warn: #b5482c; --warn-soft: #fbe8e2; --free: #eef2f6; --onbar: #ffffff;
    --code-bg: #f6f8fb; --syn-kw: #1f5fae; --syn-str: #7a4fb8; --syn-com: #5a6575; --ok-soft: rgba(15, 122, 110, 0.12); --hi-ink: #8a5a00; --var-bg: rgba(31, 95, 174, 0.09); --pu: #7a4fb8; --pu-soft: rgba(122, 79, 184, 0.12);
    --ln-ms-soft: rgba(217, 154, 18, 0.16); --ln-semanas-ink: #6b3fae; --ln-semanas-on: #ffffff; --ln-dias-on: #ffffff; --ln-ms-on: #18212d; --ln-continuo-on: #ffffff;
    --new: #a3399b; --new-soft: rgba(163, 57, 155, 0.1); --wk-programa: #b02f62; --wk-configura: #2f7a2b; --wk-opera: #8f5617; --wk-administrado: #4b6584; --wk-on: #ffffff;
    --band: rgba(24, 33, 45, 0.05); --shadow: none; color-scheme: light;
  }
  body { font-size: 11px; line-height: 1.45; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  nav.toc, button.cp, .quiz, .st__pn, .map .mapv, .maplg .lg span { display: none !important; }
  .map .map2d { display: block !important; }
  .qprint, .psum, .prt { display: block; } .scr { display: none; } .prt { margin: 0 0 6px; font-size: 10px; }
  .psum { margin-top: 10px; } .psum .dt { font-size: 9.5px; } .psum td { padding: 3px 5px; } .psum .dot { width: 8px; height: 8px; } .psum__to { color: var(--muted); white-space: nowrap; }
  .psum td:nth-child(1), .psum td:nth-child(3), .psum td:nth-child(4) { white-space: nowrap; overflow-wrap: normal; } .psum td:nth-child(2) { width: 26%; }
  .k { font-size: 9px; } .badge { font-size: 7.5px; padding: 2px 6px 2px 4px; } .pf__cat { font-size: 8.5px; } .lane__dl dt, .pf__dl dt { font-size: 7.5px; }
  ul.done li { padding-left: 17px; } ul.done li::before { width: 11px; height: 11px; top: 2px; border-width: 1.5px; border-radius: 3px; } ul.done li::after { left: 3.6px; top: 3.6px; width: 3.4px; height: 6px; border-width: 0 1.7px 1.7px 0; }
  .st__end { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; margin-top: 10px; }
  figure.fig figcaption { font-size: 10px; margin-top: 4px; }
  .loopnote { padding: 6px 10px; margin-top: 6px; } .loopnote p { font-size: 10px; } .loopnote__ic { width: 22px; height: 22px; } .loopnote__ic svg.ic { width: 13px; height: 13px; }
  #mapa .sec__head { margin-bottom: 4px; } #mapa .map { padding: 6px 8px; }
  .stop { padding: 2px 8px 2px 2px; font-size: 9.5px; } .stop__rd { width: 18px; height: 18px; }
  .cmpn__s { font-size: 8px; }
  .wkcols { grid-template-columns: repeat(4, minmax(0, 1fr)) !important; gap: 6px; } .wk { padding: 6px 7px; gap: 5px; } .wk h3 { font-size: 12px; } .wk__ic { width: 22px; height: 22px; } .wk__ic svg.ic { width: 14px; height: 14px; } .wk__c { font-size: 9px; padding: 1px 6px; }
  .wk__t { font-size: 9px !important; line-height: 1.4; } ul.wk__list { gap: 4px; } a.pfmini { padding: 4px 5px; gap: 5px; } .pfmini__ic { width: 20px; height: 20px; } .pfmini__ic svg.ic { width: 12px; height: 12px; }
  .pfmini__b b { font-size: 9px !important; } .pfmini__st { font-size: 8px; } .wkdot { font-size: 7.5px; } .wkdot svg.ic { width: 9px; height: 9px; }
  .sec { break-before: page; padding-top: 0; border-top: 0; }
  #mapa { page: mapa; }
  #mapa .map2d { width: auto; height: 133mm; max-width: 100%; }
  #velocidades { break-before: page; }
  .hero { padding-top: 0; padding-bottom: 8px; gap: 8px; } .hero p.lead { font-size: 12px; } .hero h1 { font-size: 34px; }
  ol.howto li { font-size: 10.5px; padding: 6px 8px; } .legend__row, .maplg { font-size: 10px; }
  .sec__head, .st__head { margin-bottom: 8px; gap: 10px; } .sec__n { width: 32px; height: 32px; font-size: 16px; border-radius: 8px; } .sec__n svg.ic { width: 19px; height: 19px; }
  .st__n { width: 36px; height: 36px; font-size: 17px; } .sec h2 { font-size: 21px; } .sec__q { font-size: 11.5px; margin-top: 2px; }
  h3.sub { margin: 12px 0 6px; font-size: 9.5px; }
  .tag { font-size: 8.5px !important; }
  .intro, .st__sum, .pat__sum { font-size: 11.5px; }
  .art, .io { font-size: 10.5px; } .io { padding: 8px 10px; }
  .flow { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px 22px; }
  .step { padding: 6px 8px; } .step__l { font-size: 11.5px; } .step__d { font-size: 10px; } .step__ic { width: 24px; height: 24px; } .step__ic svg.ic { width: 15px; height: 15px; }
  .step:not(:last-child)::after { right: -20px; width: 18px; height: 12px; top: 12px; }
  .who, .where { font-size: 8.5px; }
  .file { padding: 7px 10px; } .file__w, .cmdnote { font-size: 10.5px; } .file__p { font-size: 10px; } b.file__p { font-size: 11px; }
  .code { margin-top: 5px; } .code pre { font-size: 9px; line-height: 1.4; padding: 6px 9px; } .code__bar { font-size: 8.5px; padding: 3px 8px; }
  pre, .code pre, pre.term, .cmdline code.cmd { white-space: pre-wrap; overflow-wrap: anywhere; overflow: visible; }
  .tscroll { overflow: visible; }
  code, code.cmd, .cmdline code.cmd { font-size: 9.5px; } .cmdline { padding: 5px 8px; }
  .dt { font-size: 10px; } .dt th { font-size: 8px; padding: 4px 5px; } .dt td, .dt th.rh { padding: 4px 5px; } .dt th.rh { font-size: 10px; }
  ul.done li, .memo p, .trap p { font-size: 10.5px; } .memo, .trap, .donebox { padding: 7px 10px; }
  .links { font-size: 8.5px; margin-top: 8px; } .links .chip { padding: 2px 7px; }
  .pf { padding: 8px 10px; } .pf h4 { font-size: 13px; } .pf__a p, .pf__w p, .pf__dl dd { font-size: 10.5px; } .pf__w { padding: 6px 8px; } .pf__ex { margin-top: 6px; } .pf__ic { width: 28px; height: 28px; } .pf__ic svg.ic { width: 17px; height: 17px; }
  .pf__grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .wkb { font-size: 9.5px; } .wkb--main { font-size: 10.5px; }
  .lane { padding: 8px 10px; } .lane h3 { font-size: 14px; } .lane__dl dd, .lane__note { font-size: 10.5px; } .stop { font-size: 10.5px; } .stop__rd { width: 20px; height: 20px; } .stop__rd svg.ic { width: 12px; height: 12px; }
  .xfer p { font-size: 10.5px; } .xfer h4 { font-size: 12.5px; }
  .pat { padding: 10px 12px; } .pat h3 { font-size: 15px; } .cmpc { font-size: 9.5px; padding: 2px 7px; } .pat__speeds p, .cmpn__t { font-size: 10.5px; }
  details.pat__more > summary { display: none; } details.pat__more { border: 0; }
  details::details-content { content-visibility: visible; display: contents; }
  li.cmpn { grid-template-columns: 150px 74px minmax(0, 1fr); padding: 3px 0; } .cmpn__s { font-size: 7.5px !important; letter-spacing: .06em; }
  .cases { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; } .case { padding: 7px 8px; gap: 5px; } .case h4 { font-size: 11.5px; } .case__id { font-size: 9px; padding: 3px 5px; } .case__one, .case__vs ul { font-size: 9.5px; line-height: 1.4; }
  .mm { padding: 6px 7px 2px; } .mm__row { padding-bottom: 4px; gap: 6px; grid-template-columns: 10px minmax(0, 1fr); } .mm__dot { width: 10px; height: 10px; border-width: 2px; } .mm__row:not(:last-child)::after { left: 4px; top: 10px; width: 2px; } .mm__t { font-size: 7.5px; } .mm__c { gap: 3px; } .mm__c > span { font-size: 8.5px; padding: 1px 4px; } ul.case__kn li { font-size: 8.5px; padding: 2px 6px; }
  .cases-all { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; } .cases-g, .cases { display: contents; } .cases-g > h3.sub { display: none; }
  .case__h { flex-wrap: wrap; } .case__pat { display: block; flex-basis: 100%; font: 800 7.5px/1.2 var(--f-display); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
  .qprint td.mono { font: 9px/1.4 var(--f-mono); } .qprint td.chk { font: 9.5px/1.4 var(--f-body); } .qprint td.nw { white-space: nowrap; font: 700 10px var(--f-display); }
  figure.fig, .step, .file, .pf, .lane, .xfer, .wk, .case, .pat__speeds, .memo, .trap, .donebox, .io, tr, li.cmpn, .loopnote, .cmdline { break-inside: avoid; }
  .pat { break-inside: auto; }
  h3.sub, .tag { break-after: avoid; }
}
`;

// ---------------------------------------------------------------- JS de la página (sin librerías)
const QDATA = {
  st: Object.fromEntries(IDS.map((id) => [id, { n: ST[id].num, t: plain(ST[id].title), s: ST_SHORT[id], ic: ST_ICON[id], ln: lineOf(id) }])),
  q: QUIZ.map((q) => ({ s: rt(q.symptom), a: q.station, d: A(q.distractors).filter((x) => IDS.includes(x) && x !== q.station), w: rt(q.why), f: chk(q.first_check), fc: isCmd(q.first_check) })),
};
const JS_SRC = String.raw`
(function () {
  'use strict';
  var D = /*DATA*/;
  var doc = document;
  function $(id) { return doc.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ---------- copiar: clipboard dentro del clic; si lo rechaza, se selecciona el texto
  function selectEl(el) { try { var r = doc.createRange(); r.selectNodeContents(el); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); } catch (e) {} }
  function flash(btn, msg) {
    if (!btn.getAttribute('data-label')) btn.setAttribute('data-label', btn.textContent);
    btn.textContent = msg; clearTimeout(btn._t);
    btn._t = setTimeout(function () { btn.textContent = btn.getAttribute('data-label'); }, 1800);
  }
  doc.addEventListener('click', function (ev) {
    var btn = ev.target && ev.target.closest ? ev.target.closest('button.cp') : null;
    if (!btn) return;
    var box = btn.closest('.cmdw, .cmdline, .code');
    var el = box ? box.querySelector('code.cmd, pre') : null;
    var text = btn.getAttribute('data-copy');
    if (text === null) text = el ? el.textContent : '';
    function fail() { if (el) selectEl(el); flash(btn, 'Seleccionado: ⌘C'); }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { flash(btn, 'Copiado'); }, fail);
      else fail();
    } catch (e) { fail(); }
  });

  // ---------- al imprimir, los <details> se abren (y se cierran después)
  window.addEventListener('beforeprint', function () { doc.querySelectorAll('details:not([open])').forEach(function (d) { d.setAttribute('data-print', ''); d.open = true; }); });
  window.addEventListener('afterprint', function () { doc.querySelectorAll('details[data-print]').forEach(function (d) { d.removeAttribute('data-print'); d.open = false; }); });

  // ---------- nav: marca la sección visible
  var nav = doc.querySelector('nav.toc ul'), links = {};
  doc.querySelectorAll('nav.toc a').forEach(function (a) { links[a.getAttribute('href').slice(1)] = a; });
  if ('IntersectionObserver' in window && nav) {
    var cur = null;
    var io = new IntersectionObserver(function (ents) {
      ents.forEach(function (en) {
        if (!en.isIntersecting) return;
        var a = links[en.target.id];
        if (!a || a === cur) return;
        if (cur) cur.removeAttribute('aria-current');
        a.setAttribute('aria-current', 'true'); cur = a;
        var l = a.offsetLeft - (nav.clientWidth - a.offsetWidth) / 2;
        if (nav.scrollTo) nav.scrollTo({ left: Math.max(0, l), behavior: 'smooth' });
      });
    }, { rootMargin: '-30% 0px -65% 0px' });
    Object.keys(links).forEach(function (id) { var el = $(id); if (el) io.observe(el); });
  }

  // ---------- quiz: un síntoma, tres estaciones (la correcta y dos distractores, en orden aleatorio)
  var Q = D.q, S = D.st, order = [], pos = 0, first = 0, answered = 0, tries = 0, done = false;
  if (!Q.length || !$('qz')) return;
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function reshuffle() { order = shuffle(Q.map(function (_, i) { return i; })); pos = 0; }
  function icon(n) { return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#i-' + n + '"/></svg>'; }
  function score() { $('qz-score').textContent = answered ? 'A la primera: ' + first + ' de ' + answered : ''; }
  function render() {
    var q = Q[order[pos]];
    tries = 0; done = false;
    $('qz-n').textContent = (pos + 1) + ' de ' + Q.length;
    $('qz-sym').innerHTML = q.s;
    var opts = shuffle([q.a].concat(q.d));
    $('qz-opts').innerHTML = opts.map(function (id) {
      var st = S[id];
      return '<button type="button" class="qopt ln-' + st.ln + '" data-id="' + id + '"><span class="qrd">' + icon(st.ic) + '</span><span><span class="qn">' + st.n + '</span> ' + esc(st.t) + '</span><span class="qmark" aria-hidden="true"></span></button>';
    }).join('');
    $('qz-fb').innerHTML = '';
  }
  $('qz-opts').addEventListener('click', function (ev) {
    var b = ev.target.closest ? ev.target.closest('button.qopt') : null;
    if (!b || b.disabled || done) return;
    var q = Q[order[pos]], id = b.getAttribute('data-id'), st = S[id], ok = id === q.a;
    tries++;
    if (ok) {
      done = true; answered++; if (tries === 1) first++;
      b.classList.add('is-right'); b.setAttribute('aria-pressed', 'true');
      b.querySelector('.qmark').innerHTML = icon('check');
      $('qz-opts').querySelectorAll('button.qopt').forEach(function (x) { x.disabled = true; });
      $('qz-fb').innerHTML = '<div class="fb fb--ok"><p class="fb__h">' + icon('check') + 'Correcto: estación ' + st.n + ' · ' + esc(st.t) + (tries > 1 ? ' (al intento ' + tries + ')' : '') + '</p>' +
        '<p><span class="k">Por qué</span> ' + q.w + '</p><p class="k">Primer chequeo</p>' + (q.fc ? '<pre class="term">' + q.f + '</pre>' : '<p class="chk">' + q.f + '</p>') +
        '<p><a href="#est-' + id + '">Ir a la estación ' + st.n + ' · ' + esc(st.s) + ' →</a></p></div>';
      score();
      $('qz-next').focus({ preventScroll: true });
    } else {
      b.classList.add('is-wrong'); b.disabled = true;
      b.querySelector('.qmark').innerHTML = icon('cross');
      $('qz-fb').innerHTML = '<div class="fb fb--no"><p class="fb__h">' + icon('cross') + 'No es la estación ' + st.n + ' · ' + esc(st.t) + '.</p><p>Prueba con otra: ¿dónde se originó lo que ves?</p></div>';
    }
  });
  $('qz-next').addEventListener('click', function () { pos++; if (pos >= order.length) reshuffle(); render(); });
  reshuffle(); render(); score();
})();`;
const JS = JS_SRC.replace('/*DATA*/', JSON.stringify(QDATA).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'));

// ---------------------------------------------------------------- página
const NAV = [['mapa', 'Mapa'], ['velocidades', '4 velocidades'], ...IDS.map((id) => [`est-${id}`, `${ST[id].num} ${ST_SHORT[id]}`, lineOf(id)]), ['trabajo', '¿Programa o configura?'], ['patrones', 'Patrones'], ['casos', 'Casos'], ['quiz', 'Quiz']];
const HEAD = `<title>Del dato a producción</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="description" content="El C01 de punta a punta como un mapa de metro: 12 estaciones del dato a producción, el artefacto que viaja entre ellas, las 4 velocidades, cómo se trabaja cada herramienta, patrones, casos y un quiz de síntomas.">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&family=JetBrains+Mono:wght@400;600;700&family=Source+Serif+4:ital,opsz,wght@0,8..60,400..700;1,8..60,400..700&display=swap">
<style>${CSS}</style>`;
const WRAP = `<div class="wrap">
  ${heroHtml()}
  ${printSummary()}
  <nav class="toc" aria-label="Secciones"><ul>${NAV.map(([id, l, ln]) => `<li><a href="#${id}"${ln ? ` class="ln-${ln}"` : ''}>${ln ? '<i class="dot"></i>' : ''}${esc(l)}</a></li>`).join('')}</ul></nav>
  ${mapHtml()}
  ${speedsHtml()}
  ${IDS.map(stationHtml).join('\n')}
  ${workHtml()}
  ${patternsHtml()}
  ${casesHtml()}
  ${quizHtml()}
  <footer>
    <p>El recorrido es el del C01 del curso <a href="${COURSE_URL}" target="_blank" rel="noopener">Ronda de Diseño ML</a>. Los «archivos reales» son extractos de <code>reference/c01/</code>; los «descritos en el curso» son piezas que el curso explica pero que no están en el repo.</p>
    <p>Las afirmaciones sobre cada herramienta se revisaron contra su documentación oficial (Kubernetes, KEDA, NVIDIA Triton y TensorRT, MLflow, Argo, Prometheus, GitHub Actions, AWS, DVC, lakeFS, Label Studio). Si tu terminal dice otra cosa, créele a tu terminal.</p>
  </footer>
  ${SPRITE}
</div>`;

function report() {
  const facts = [`${IDS.length} estaciones`, `${LINES.length} velocidades`, `${Object.keys(PF).length} fichas de herramientas`, `${A(W3.cases).length} mini-mapas`, `Quiz de ${QUIZ.length} síntomas`];
  console.log('datos para sheets.json:', facts.join(' · '));
  if (PROBLEMS.length) { console.log(`avisos del contenido (${PROBLEMS.length}):`); PROBLEMS.forEach((p) => console.log('  - ' + p)); }
  else console.log('avisos del contenido: ninguno');
}

function build() {
  const outDir = join(HERE, 'out');
  mkdirSync(outDir, { recursive: true });
  const page = '<!doctype html>\n<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' + HEAD + '</head><body>' + WRAP + '\n<script>' + JS + '</script></body></html>';
  const artifact = HEAD + '\n' + WRAP + '\n<script>' + JS + '</script>';
  writeFileSync(join(SHEET, 'recorrido.html'), page);
  writeFileSync(join(outDir, 'artifact.html'), artifact);
  console.log(`recorrido.html ${(page.length / 1024).toFixed(0)} KB · artifact.html ${(artifact.length / 1024).toFixed(0)} KB · contenido de ${CONTENT}`);
  return join(SHEET, 'recorrido.html');
}
function pdf(pagePath) {
  const out = join(SHEET, 'recorrido.pdf');
  const prof = mkdtempSync(join(tmpdir(), 'recorrido-pdf-'));
  const r = spawnSync(CHROME, ['--headless=new', '--no-pdf-header-footer', '--virtual-time-budget=10000', `--print-to-pdf=${out}`, `--user-data-dir=${prof}`, pathToFileURL(pagePath).href], { encoding: 'utf8', timeout: 180000 });
  rmSync(prof, { recursive: true, force: true });
  if (r.status !== 0 || !existsSync(out)) { console.error(r.stdout, r.stderr); throw new Error('Chrome no pudo imprimir el PDF'); }
  console.log('recorrido.pdf listo');
}

const pagePath = build();
if (MODE === 'pdf') pdf(pagePath);
else if (MODE !== 'build') console.warn(`modo desconocido «${MODE}»: solo se armó el HTML`);
report();
