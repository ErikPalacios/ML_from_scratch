// Genera "Prometheus y Grafana", sexta hermana de las hojas de Docker, Kubernetes, Git, Triton y el gateway
// (sheets/gateway/fuentes/gen-gateway.mjs, de donde sale este archivo): mismos tokens claro/oscuro, fuentes, hero, nav de
// chips, .pad con papel cuadriculado, fórmulas (KaTeX → MathML), tabla de piezas, ejemplo con botón de copiar (con
// resaltado de PromQL, también dentro de expr: y query: del YAML), "Cómo recordarla" / "Trampa", laboratorios plegados,
// chips del curso y de las hojas hermanas, CSS de impresión, diagnosticador, revisor (aquí, de archivos de reglas de
// Prometheus, leídos con js-yaml de cdnjs como en las hojas de Kubernetes y Git) y quiz.
//
// Las figuras se leen en un celular de 375 px sin scroll horizontal: casi todas son HTML que se acomoda solo (barras con
// anchos en %, grillas que pasan de columnas a filas); las tres que son curvas (rate, los estados de una alerta y el
// presupuesto que se quema) son SVG con una variante angosta para el celular, como el apagado de la hoja del gateway.
// A escala donde hay números: el counter y su rate, los buckets y la interpolación del p99, las series por pod, los
// minutos de una alerta, el dashboard en la grilla de 24 columnas y el presupuesto a 1×, 6× y 14.4×.
// Un color significa lo mismo en todas:
//   azul = counter (el odómetro) · verde azulado = gauge (el medidor de gasolina) · violeta = histogram (los cajones) ·
//   verde = ok, up, inactive o resuelta · ámbar = pending o espera · rojo = firing, down o una cuenta que miente ·
//   gris = silenciada, inhibida o ignorada.
//
// Uso:
//   node gen-prom.mjs src <dir>   → <dir>/head.html, wrap.html, script.js, revisor.js y src.html (con KaTeX de cdnjs)
//   node gen-prom.mjs build       → lo anterior en ./out, pasa [data-tex] a MathML estático con tools/browser-check.mjs
//                                   (de la app ml-system-design), corre el revisor en Chrome con el mismo js-yaml de la
//                                   página y escribe out/artifact.html (para el Artifact de claude.ai) y
//                                   ../cheatsheet-prometheus.html (la página del sitio y la fuente del PDF)
//   node gen-prom.mjs pdf         → build y además ../cheatsheet-prometheus.pdf (Chrome headless, A4)
//   node gen-prom.mjs cmds        → muestra cómo se parte cada texto con comandos: [código copiable] «nota» ‹lugar›
// El contenido está en content-w1/2/3.json de esta carpeta (PROM_CONTENT=<carpeta> lee otra). El generador no lo
// cambia: al final lista los avisos del contenido (enlaces que no existen, figuras que no cierran, datos raros).
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '../../../../ml-system-design'); // módulos del curso, browser-check.mjs y reference/c01
const CONTENT = process.env.PROM_CONTENT ? resolve(process.env.PROM_CONTENT) : HERE;
const readJSON = (f) => JSON.parse(readFileSync(join(CONTENT, f), 'utf8'));
const W1 = readJSON('content-w1.json'), W2 = readJSON('content-w2.json'), W3 = readJSON('content-w3.json');
const C01 = join(APP, 'reference/c01');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// js-yaml de cdnjs: la misma URL que los revisores de Kubernetes y Git (el service worker la guarda una vez para todas)
const YAML_URL = 'https://cdnjs.cloudflare.com/ajax/libs/js-yaml/4.1.0/js-yaml.min.js';
const AVISOS = [];
const aviso = (m) => { if (!AVISOS.includes(m)) AVISOS.push(m); };

// ---------------------------------------------------------------- utilidades (las de gen-gateway.mjs)
const T = String.raw;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// HTML permitido en memo, trap y en las notas: solo <b> y <code> (y entidades ya escritas, como &lt;); todo lo demás se escapa.
const rich = (s) => esc(s).replace(/&lt;(\/?)(b|code)&gt;/g, '<$1$2>').replace(/&amp;(lt|gt|amp|quot|#39);/g, '&$1;');
const mb = (tex) => `<div class="mb" data-tex="${esc(tex)}"></div>`;
const mi = (tex) => `<span class="mi" data-tex="${esc(tex)}"></span>`;
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const pct = (f) => `${r2(Math.max(0, Math.min(1, f)) * 100)}%`;
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
// 24532532 → 24,532,532 (el contenido usa coma de miles y punto decimal); −8 con el signo menos de verdad
const fmtN = (x) => { const [i, d] = String(x).split('.'); return i.replace(/\B(?=(\d{3})+(?!\d))/g, ',').replace(/^-/, '−') + (d ? '.' + d : ''); };
// {placeholder} → variable con aspecto de variable matemática; acepta puntos ({alertmanager.yml}), acentos ({métrica}) y
// letras griegas ({φ}). No toca ${VAR} (bash), %{http_code} (curl -w), { mapas: con espacio }, {"clave": …} ni las
// plantillas de Go y de Grafana: {{ $labels.pod }} (con espacios) y {{gpu_uuid}} (pegadas: la llave de afuera lo delata).
// En {métrica}{{label}="{valor}"} la primera llave de {{label} es texto (el { de los labels) y {label} sí es variable.
const PH = /(\$|@|%)?\{([A-Za-zÀ-ÖØ-öø-ÿ_\u0370-\u03ff][\wÀ-ÖØ-öø-ÿ\u0370-\u03ff]*(?:\.[\wÀ-ÖØ-öø-ÿ]+)*)\}/g;
const phs = (escaped) => escaped.replace(PH, (m, pre, name, off, str) => {
  if (pre === '$' || pre === '%') return m;
  if (str[off - 1] === '{' && str[off + m.length] === '}') return m; // {{name}}: plantilla, no variable
  return pre === '@' ? `@{<var class="ph">${name}</var>}` : `<var class="ph">${name}</var>`;
});
// {s | ms | percentunit | reqps}: elige una (solo en las plantillas). No toca {{ $value | humanize }}.
const ALT = /\{([^\s{}|][^{}|]*?(?:\s\|\s[^{}|]+?)+)\}/g;
const alts = (escaped) => escaped.replace(ALT, (m, inner, off, str) => (str[off - 1] === '{' || str[off + m.length] === '}' ? m
  : `<var class="ph ph--alt">${inner.split(/\s\|\s/).map((x) => x.trim()).join('<i aria-hidden="true">|</i>')}</var>`));
// Las flags (--web.enable-lifecycle, --data-urlencode) no se parten en el guion.
const nbFlags = (h) => h.replace(/(^|[\s(\[>])(--?[A-Za-z][A-Za-z0-9-]*)/g, (m, pre, f) => {
  if (f.length <= 16) return `${pre}<span class="nb">${f}</span>`;
  const head = f.match(/^--?[A-Za-z0-9]+/)[0];
  return `${pre}<span class="nb">${head}</span>${f.slice(head.length)}`;
});
// Un número no se separa de su unidad al final de un renglón ("15 s", "10 MB", "200 ms").
const nbu = (h) => h.replace(/(\d) (s|ms|µs|min|h|d|días|GB|MB|KB|B|Gi|%|req\/s|series|muestras|bytes|pods|req)(?=$|[\s.,;:)\]])/g, '$1&nbsp;$2');
const tx = (s) => nbu(nbFlags(esc(s)));
const rx = (s) => nbu(nbFlags(rich(s)));
const ph = (s) => phs(esc(s));
const phT = (s) => phs(alts(nbFlags(esc(s))));
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

// Símbolo de una variable (λ, Δ_scrape, N_series, q̂, c_ℓ, x̄, t_retención, $__interval…) → TeX para la tabla.
const GREEK = { α: '\\alpha', β: '\\beta', γ: '\\gamma', δ: '\\delta', ε: '\\varepsilon', θ: '\\theta', λ: '\\lambda', μ: '\\mu', π: '\\pi', ρ: '\\rho', σ: '\\sigma', τ: '\\tau', φ: '\\varphi', ω: '\\omega', Δ: '\\Delta', ℓ: '\\ell' };
const SUB_D = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' };
const SUP_D = { '¹': '1', '²': '2', '³': '3' };
const texText = (s) => `\\text{${String(s).replace(/([&%$#_{}])/g, '\\$1')}}`;
const texTT = (s) => `\\texttt{${String(s).replace(/([&%$#_{}])/g, '\\$1')}}`;
function symTex(s) {
  const base = (h) => {
    let pre = '';
    if (h.length > 1 && h[0] === 'Δ') { pre = '\\Delta '; h = h.slice(1); }
    const m = h.match(/^(.)([\u0302\u0304]?)([¹²³]?)([₀-₉]*)$/u);
    if (m && !/\d/.test(m[1])) {
      let b = GREEK[m[1]] || m[1];
      if (m[2] === '\u0302') b = `\\hat{${b}}`;
      if (m[2] === '\u0304') b = `\\bar{${b}}`;
      if (m[3]) b += `^{${SUP_D[m[3]]}}`;
      if (m[4]) b += `_{${[...m[4]].map((c) => SUB_D[c]).join('')}}`;
      return pre + b;
    }
    return pre + texText(h);
  };
  const one = (p) => {
    p = p.trim();
    if (!p) return '';
    if (p.includes('…')) return p.split(/\s*…\s*/).map(one).join(' \\ldots ');
    if (p.includes(' × ')) return p.split(' × ').map((q) => (/^[\d.]+$/.test(q.trim()) ? q.trim() : one(q))).join(' \\times ');
    // nombres de código ($__rate_interval, group_wait, MAX_INFLIGHT): en monoespaciada, no como subíndice
    if (/^\$/.test(p) || /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(p) || (p.match(/_/g) || []).length >= 2) return texTT(p);
    const fn1 = p.match(/^([A-Za-z])\((.+)\)$/); // U(a, b)
    if (fn1) return `${base(fn1[1])}(${fn1[2].split(/\s*,\s*/).map(one).join(',\\ ')})`;
    const i = p.indexOf('_');
    if (i > 0 && !/\s/.test(p.slice(0, i))) {
      const head = p.slice(0, i), sub = p.slice(i + 1);
      // group_wait, scrape_interval: una palabra de config, no una variable con subíndice (t_cruce, N_series, Δt_eval sí)
      if (/^[a-z]{2,}$/.test(head) && /^[a-z]{2,}$/.test(sub)) return texTT(p);
      const fn = sub.match(/^(\w+)\((.+)\)$/);
      if (fn) return `${base(head)}_{\\text{${fn[1]}}}(${fn[2]})`;
      return `${base(head)}_{${[...sub].length === 1 ? (GREEK[sub] || sub) : texText(sub)}}`;
    }
    if (/\s/.test(p)) return texText(p);
    return base(p);
  };
  // separa por "," y "·" fuera de paréntesis: U(a, b) queda entero
  const parts = []; let depth = 0, cur = '';
  for (const ch of String(s)) {
    if (ch === '(') depth++; else if (ch === ')') depth = Math.max(0, depth - 1);
    if (!depth && (ch === ',' || ch === '·')) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts.map(one).filter(Boolean).join(T`,\ `);
}

// Ancho aproximado de un texto en px, medido en Chrome con Archivo (las proporciones por tipo de letra) y JetBrains
// Mono (0.6 em por letra). Con un 2 % de margen: así un renglón del SVG nunca se sale de su caja.
function textW(s, px, { bold = false, mono = false } = {}) {
  if (mono) return [...String(s)].length * 0.6 * px;
  const k = bold ? { lo: 0.55, up: 0.71, dg: 0.585, sp: 0.26, pn: 0.29, br: 0.33, ot: 0.4, wd: 0.88 } : { lo: 0.5, up: 0.69, dg: 0.555, sp: 0.26, pn: 0.28, br: 0.31, ot: 0.38, wd: 0.85 };
  let w = 0;
  for (const ch of String(s)) {
    if (/[a-zà-ÿ]/.test(ch)) w += /[mw]/.test(ch) ? k.lo * 1.55 : /[iljtfr]/.test(ch) ? k.lo * 0.62 : k.lo;
    else if (/[A-ZÀ-Þ]/.test(ch)) w += /[MW]/.test(ch) ? k.up * 1.3 : /[IJ]/.test(ch) ? k.up * 0.45 : k.up;
    else if (/[0-9]/.test(ch)) w += k.dg;
    else if (ch === ' ') w += k.sp;
    else if (/[.,:;'!|]/.test(ch)) w += k.pn;
    else if (/[()[\]{}]/.test(ch)) w += k.br;
    else if (/[←-⇿✀-➿]/.test(ch)) w += k.wd;
    else w += k.ot;
  }
  return w * px * 1.02;
}

// ---------------------------------------------------------------- comandos, consultas y lugares de la interfaz
// Un texto de "check" o "first" puede ser un comando (copiable), una consulta de PromQL (copiable, va en la caja de
// consultas de Prometheus) o un lugar de la web ("Status → Target health", "Inspect → Query"): ese no se copia, se visita.
const CMD_WORDS = new Set(['git', 'kubectl', 'docker', 'aws', 'curl', 'echo', 'cat', 'grep', 'sed', 'test', 'python', 'python3', 'pip', 'pip3', 'cd', 'ls', 'export', 'jq', 'tail', 'head', 'bash', 'find', 'mkdir', 'rm', 'source', 'printf', 'sort', 'wc', 'uniq', 'tr', 'lsof', 'kill', 'pkill', 'ps', 'brew', 'amtool', 'promtool', 'helm', 'kind', 'sleep', 'touch', 'open', 'uvicorn', 'gunicorn', 'watch', 'for', 'while', 'seq', 'nc', 'dig', 'nslookup', 'wget']);
const isCmdWord = (w) => CMD_WORDS.has(w) || /^python3(\.\d+)?$/.test(w) || /^\.\/[\w.-]+/.test(w);
const firstCmd = (s) => { const ws = String(s).trim().split(/\s+/); let k = 0; while (k < ws.length - 1 && /^[A-Z_][A-Z0-9_]*=\S*$/.test(ws[k])) k++; return ws[k] || ''; };
const PQ_FN = ['sum', 'rate', 'irate', 'increase', 'histogram_quantile', 'avg', 'max', 'min', 'count', 'topk', 'bottomk', 'absent', 'absent_over_time', 'changes', 'resets', 'delta', 'deriv', 'avg_over_time', 'max_over_time', 'min_over_time', 'last_over_time', 'count_over_time', 'sum_over_time', 'quantile_over_time', 'clamp_min', 'clamp_max', 'clamp', 'label_replace', 'vector', 'scalar', 'predict_linear', 'group', 'stddev', 'stdvar', 'count_values', 'sort', 'sort_desc', 'histogram_count', 'histogram_sum', 'histogram_fraction'];
const PROMQL = new RegExp(`^(?:${PQ_FN.join('|')})(?:\\s+(?:by|without)\\s*\\([^)]*\\))?\\s*\\(|^[a-zA-Z_:][a-zA-Z0-9_:]*\\{`);
const BARE_METRIC = /^[a-z_:][a-z0-9_:]*_[a-z0-9_:]*$/; // prometheus_tsdb_head_series: una serie sola también es una consulta
const CALL = /^[A-Za-z_][\w.]*\(/; // una llamada de Python: REQUESTS.labels(…).inc()
const CUTS = [' (', ' en ', ' y, ', ' y ', ' o ', ' contra ', ': ', ' → ', ' mientras ', ' para ', ' sobre '];
// Un tramo que empieza con un comando (o con una expresión de PromQL o de Python) → { cmd, note }. Las comillas y los
// paréntesis no se cortan; una expresión termina en el primer espacio que no sigue con un operador.
function splitCmd(seg) {
  const s = String(seg).trim();
  if (/^[A-Z_][A-Z0-9_]*=\S+$/.test(s)) return { cmd: s, note: '' };
  const first = firstCmd(s);
  const expr = !isCmdWord(first) && (PROMQL.test(s) || CALL.test(s) || BARE_METRIC.test(s.split(/\s/)[0]));
  if (!isCmdWord(first) && !expr) return null;
  let q = null, depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if ('([{'.includes(c)) { depth++; continue; }
    if (')]}'.includes(c)) { depth = Math.max(0, depth - 1); continue; }
    if (depth) continue;
    if (expr) {
      if (c !== ' ') continue;
      const rest = s.slice(i + 1), before = s.slice(0, i);
      const words = /^\((?:[A-Za-zÀ-ÿ¿?]+[\s,]+)+[A-Za-zÀ-ÿ¿?]+\)/.test(rest); // "(y grafícalo…)": texto, no código
      if (!words && (/^(?:\/|\*|\+|-\s|>|<|==|!=|and\b|or\b|unless\b|by\b|without\b|on\b|ignoring\b|group_left\b|bool\b|offset\b|\(|\[|\d)/.test(rest) || /[/*+><=-]$/.test(before) || /\b(?:by|without|on|ignoring|bool|offset|and|or|unless)$/.test(before))) continue;
      return { cmd: before, note: s.slice(i) };
    }
    for (const cut of CUTS) {
      if (s.startsWith(cut, i)) {
        const cmd = s.slice(0, i), tail = (cmd.match(/[,;]$/) || [''])[0];
        return { cmd: cmd.slice(0, cmd.length - tail.length), note: tail + s.slice(i) };
      }
    }
  }
  return { cmd: s, note: '' };
}
// Lugares de la web: el primer nombre dice de quién es la pantalla (Status es de Prometheus; Connections, Inspect y Explore,
// de Grafana). El lugar termina antes de lo que lo explica: ": …", " (…)", ", …" o " del panel", " con la misma query".
const UI_HOME = { Status: 'Prometheus', Alerts: 'Prometheus', Connections: 'Grafana', Inspect: 'Grafana', Explore: 'Grafana', Dashboards: 'Grafana', Alerting: 'Grafana', Administration: 'Grafana' };
const PLACE_RE = new RegExp(`^((?:${Object.keys(UI_HOME).join('|')})(?:\\s→\\s[^→:(,]+?)*)(?=$|:\\s|\\s\\(|,\\s|\\s(?:con|del|de la|en|para)\\s)`);
const splitPlace = (seg) => { const m = String(seg).trim().match(PLACE_RE); return m ? { place: m[1].trim(), note: String(seg).trim().slice(m[1].length) } : null; };
const ICON_UI = '<svg class="ui__ic" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="10" rx="1.6"/><path d="M1.5 5.5h13"/><path class="ui__ptr" d="M8.6 7.4l4.6 1.9-2 0.8-0.8 2z"/></svg>';
function placeHtml(place) {
  const parts = String(place).split(/\s*→\s*/), home = UI_HOME[parts[0]];
  return `<span class="ui" title="${esc(`un lugar de la web${home ? ' de ' + home : ''}: se abre, no se copia`)}">${ICON_UI}${home ? `<span class="ui__home">${home}</span>` : ''}${parts.map((p) => `<span class="ui__p">${esc(p)}</span>`).join('<span class="ui__a" aria-hidden="true">›</span>')}</span>`;
}
const copyBtn = (text) => `<button class="cp" type="button"${text === undefined ? '' : ` data-copy="${esc(text)}"`}>Copiar</button>`;
const cmdChip = (c) => `<span class="cmdw"><code class="cmd">${esc(c)}</code>${copyBtn(c)}</span>`;
// La nota que sigue a un comando: si empezaba con ": " (el corte), pasa a " — " para no dejar dos puntos sueltos; si es
// " y <otro comando>" o " y, adentro, <otro comando>", ese otro comando también va como código copiable.
function cmdNote(n) {
  const m = String(n).match(/^(\s+[yo](?:,\s*[^,]{1,24},)?\s+)(.+)$/);
  if (m) { const c = splitCmd(m[2]); if (c) return `<span class="cmdn">${esc(m[1])}</span>${cmdChip(c.cmd)}${c.note ? cmdNote(c.note) : ''}`; }
  return `<span class="cmdn">${esc(String(n).replace(/^:\s+/, ' — '))}</span>`;
}
// Texto de "check" o "first": cada tramo separado por " · " que empieza con un comando (o con "dónde: comando") se
// muestra como código copiable; un lugar de la web, como un lugar; el resto, como texto.
function cmdHtml(s) {
  return String(s).split(' · ').map((seg) => {
    const pl = splitPlace(seg);
    if (pl) return `${placeHtml(pl.place)}${pl.note ? `<span class="cmdn">${esc(pl.note.replace(/^:\s+/, ' — '))}</span>` : ''}`;
    let pre = '', body = seg;
    if (!splitCmd(seg)) { const m = seg.match(/^([^:()]{1,40}):\s+(.+)$/); if (m && splitCmd(m[2])) { pre = m[1] + ': '; body = m[2]; } }
    const c = splitCmd(body);
    if (!c) return esc(seg);
    return `${pre ? `<span class="cmdn">${esc(pre)}</span>` : ''}${cmdChip(c.cmd)}${c.note ? cmdNote(c.note) : ''}`;
  }).join('<span class="sep"> · </span>');
}
const isPlaceOnly = (s) => String(s).split(' · ').every((seg) => splitPlace(seg));
// El cmd de un eslabón de una cadena: qué es y dónde se escribe. W3 lo dice en "tipo" (shell, promql o ui); en las cadenas
// de W1 se deduce del texto.
function cmdTipo(c) {
  const s = String(c).trim();
  if (splitPlace(s)) return 'ui';
  if (/^(GET|POST|PUT|HEAD)\s+https?:\/\//.test(s)) return 'http';
  if (isCmdWord(firstCmd(s))) return 'shell';
  if (/^[A-Z][A-Za-z0-9_]*\.[a-z_]+\(/.test(s)) return 'python';
  if (/^[A-Za-z_][\w.-]*\s*:(\s|$)/.test(s) || /^[a-z_][a-z0-9_]*(\s+·\s+[a-z_][a-z0-9_]*)+$/.test(s)) return 'yaml';
  if (/^[A-Z][a-z]+(?:[A-Z0-9][A-Za-z0-9]*)+$/.test(s)) return 'regla';
  if (PROMQL.test(s) || BARE_METRIC.test(s)) return 'promql';
  return 'code';
}
const TIPO_L = { shell: 'terminal', promql: 'PromQL', python: 'Python', yaml: 'YAML', http: 'HTTP', regla: 'regla', code: 'código' };
const TIPO_T = { shell: 'un comando: va en la terminal', promql: 'una consulta: va en la caja de consultas de Prometheus (o en Grafana)', python: 'una línea de Python de tu servicio', yaml: 'una clave de la configuración (YAML)', http: 'el request que hace Prometheus', regla: 'el nombre de una regla de alerta', code: 'código' };
function stepCode(cmd, tipo) {
  if (!cmd) return '';
  const t = tipo || cmdTipo(cmd);
  if (t === 'ui') { const pl = splitPlace(cmd); return `<p class="cc">${pl ? placeHtml(pl.place) + (pl.note ? `<span class="cmdn">${esc(pl.note)}</span>` : '') : placeHtml(cmd)}</p>`; }
  let code = String(cmd), note = '';
  if (t === 'yaml') { const k = [' → ', ' sobre '].map((x) => code.indexOf(x)).filter((x) => x > 0).sort((a, b) => a - b)[0]; if (k) { note = code.slice(k); code = code.slice(0, k); } }
  const copy = t === 'shell' || t === 'promql' || t === 'python';
  const tag = `<span class="ktag ktag--${t}" title="${esc(TIPO_T[t] || '')}">${TIPO_L[t] || t}</span>`, nt = note ? `<span class="cmdn">${esc(note)}</span>` : '';
  // una consulta o un comando largo va en un bloquecito a todo el ancho, con la etiqueta y Copiar arriba: en un celular,
  // apretado entre los dos, se partía letra por letra
  if (code.length > 24) return `<p class="cc"><span class="qb"><span class="qb__bar">${tag}${copy ? copyBtn(code) : ''}</span><code class="cmd">${esc(code)}</code></span>${nt}</p>`;
  return `<p class="cc"><span class="cmdw">${tag}<code class="cmd">${esc(code)}</code>${copy ? copyBtn(code) : ''}</span>${nt}</p>`;
}

// ---------------------------------------------------------------- resaltado de código (ligero)
const CLI_SUB = new Set(['rollout', 'config', 'auth', 'create', 'set', 'image', 'run', 'logs', 'debug', 'get', 'describe', 'exec', 'top', 'check', 'test', 'silence', 'alert', 'routes', 'compose', 'network', 'repo']);
// PromQL: comentarios, strings, variables de Grafana ($__rate_interval, $source), rangos ([5m]), números, funciones y
// palabras clave (by, without, on, ignoring, group_left, bool, offset, and, or, unless).
const PQ_KW = new Set(['by', 'without', 'on', 'ignoring', 'group_left', 'group_right', 'bool', 'offset', 'and', 'or', 'unless']);
function hlProm(code) {
  const re = /(#[^\n]*|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|`[^`\n]*`?|\$\{?[A-Za-z_]\w*\}?|\[\s*\d+(?:ms|[smhdwy])(?:\d+(?:ms|[smhdwy]))*\s*(?::\s*(?:\d+(?:ms|[smhdwy]))*)?\]|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|[A-Za-z_:][\w:]*)/g;
  let out = '', last = 0, m;
  const s = String(code);
  while ((m = re.exec(s))) {
    const t = m[0];
    out += esc(s.slice(last, m.index));
    last = m.index + t.length;
    if (t[0] === '#') out += `<span class="tk-c">${esc(t)}</span>`;
    else if (/^["'`]/.test(t)) out += `<span class="tk-s">${esc(t)}</span>`;
    else if (t[0] === '$') out += `<span class="tk-d">${esc(t)}</span>`;
    else if (t[0] === '[' || /^\d/.test(t)) out += `<span class="tk-n">${esc(t)}</span>`;
    else if (PQ_KW.has(t)) out += `<span class="tk-k">${esc(t)}</span>`;
    else if (/^\s*\(/.test(s.slice(last))) out += `<span class="tk-f">${esc(t)}</span>`;
    else out += esc(t);
  }
  return out + esc(s.slice(last));
}
function hlCode(seg, lang, st) {
  if (!seg) return '';
  if (lang === 'yaml') {
    if (st.atStart) {
      st.atStart = false;
      const m = seg.match(/^(\s*(?:-\s+)?)([A-Za-z_][\w./-]*)(:)(?=\s|$)/);
      if (m) return esc(m[1]) + `<span class="tk-k">${esc(m[2])}</span>` + esc(seg.slice(m[1].length + m[2].length));
    }
    return esc(seg);
  }
  if (lang === 'bash') {
    // palabras en posición de comando: inicio de línea, después de ; && || | $( ( { then do
    let out = '';
    const re = /(\s+|&&|\|\||[;|(){}]|\$\(|[^\s;|&(){}]+|&)/g;
    let m;
    while ((m = re.exec(seg))) {
      const t = m[0];
      if (/^\s+$/.test(t)) { out += t; continue; }
      if (/^(&&|\|\||[;|({]|\$\()$/.test(t)) { out += esc(t); st.cmdPos = true; st.sub = 0; continue; }
      if (t === ')' || t === '}') { out += esc(t); continue; }
      if (st.cmdPos) {
        if (/^[A-Za-z_][\w]*=/.test(t)) { out += esc(t); continue; } // VAR=valor: sigue en posición de comando
        if (/^[A-Za-z][\w.+-]*$/.test(t)) {
          out += `<span class="tk-k">${esc(t)}</span>`;
          st.cmdPos = /^(then|do|else|time|sudo|exec|!)$/.test(t);
          st.sub = /^(kubectl|docker|git|pip|pip3|amtool|promtool|helm)$/.test(t) ? 2 : 0;
          continue;
        }
        st.cmdPos = false;
        out += esc(t); continue;
      }
      if (st.sub > 0 && /^[a-z][a-z-]*$/.test(t)) {
        out += `<span class="tk-k">${esc(t)}</span>`;
        st.sub = CLI_SUB.has(t) ? st.sub - 1 : 0;
        continue;
      }
      st.sub = 0;
      out += esc(t);
    }
    return out;
  }
  return esc(seg);
}
function hlLine(line, lang, st) {
  if (/^\s*#/.test(line)) return `<span class="tk-c">${esc(line)}</span>`;
  if (lang === 'text' && /^\$ /.test(line)) return `<span class="tk-p">$</span> ` + hlLine(line.slice(2), 'bash', { cmdPos: true, sub: 0 });
  let out = '', buf = '', i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < line.length && line[j] !== c) { if (line[j] === '\\' && c === '"') j++; j++; }
      if (j < line.length) {
        out += hlCode(buf, lang, st); buf = '';
        out += `<span class="tk-s">${esc(line.slice(i, j + 1))}</span>`;
        if (lang === 'bash') { st.cmdPos = false; st.sub = 0; }
        i = j + 1; continue;
      }
    }
    if (c === '#' && i > 0 && /\s/.test(line[i - 1])) {
      out += hlCode(buf, lang, st); buf = '';
      out += `<span class="tk-c">${esc(line.slice(i))}</span>`;
      i = line.length; break;
    }
    buf += c; i++;
  }
  return out + hlCode(buf, lang, st);
}
// YAML con PromQL adentro: el valor de expr: y de query: (en la misma línea o en un bloque | más sangrado) se resalta como
// PromQL; el resto, como YAML (claves, strings y comentarios).
function hlYaml(code) {
  const out = []; let blk = -1;
  for (const ln of String(code).split('\n')) {
    const ind = ln.match(/^\s*/)[0].length;
    if (blk >= 0) {
      if (!ln.trim()) { out.push(esc(ln)); continue; }
      if (ind > blk) { out.push(esc(ln.slice(0, ind)) + hlProm(ln.slice(ind))); continue; }
      blk = -1;
    }
    const m = ln.match(/^(\s*(?:-\s+)?)(expr|query)(\s*:\s*)(.*)$/);
    if (m) {
      const keyInd = m[1].replace(/-\s+$/, (d) => ' '.repeat(d.length)).length;
      const head = esc(m[1]) + `<span class="tk-k">${m[2]}</span>` + esc(m[3]);
      if (/^[|>][-+]?\s*(#.*)?$/.test(m[4])) { blk = keyInd; out.push(head + hlLine(m[4], 'yaml', { atStart: false })); continue; }
      if (/^["']/.test(m[4])) { out.push(head + hlLine(m[4], 'yaml', { atStart: false })); continue; }
      const k = m[4].search(/\s#/);
      out.push(head + (k >= 0 ? hlProm(m[4].slice(0, k)) + `<span class="tk-c">${esc(m[4].slice(k))}</span>` : hlProm(m[4])));
      continue;
    }
    out.push(hlLine(ln, 'yaml', { atStart: true, cmdPos: true, sub: 0 }));
  }
  return out.join('\n');
}
// Python: comentarios, strings (también los de triple comilla, que cruzan renglones) y palabras clave.
const PY_KW = new Set(['def', 'return', 'if', 'elif', 'else', 'for', 'while', 'in', 'not', 'and', 'or', 'is', 'import', 'from', 'as', 'with', 'try', 'except', 'finally', 'raise', 'class', 'lambda', 'None', 'True', 'False', 'async', 'await', 'pass', 'break', 'continue', 'yield', 'global', 'nonlocal', 'assert', 'del']);
function hlPy(code) {
  const re = /("""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|\b[rRbBfFuU]{1,2}"(?:\\.|[^"\\\n])*"?|\b[rRbBfFuU]{1,2}'(?:\\.|[^'\\\n])*'?|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|#[^\n]*|@[A-Za-z_][\w.]*|\b[A-Za-z_]\w*\b)/g;
  let out = '', last = 0, m;
  const s = String(code);
  while ((m = re.exec(s))) {
    const t = m[0];
    out += esc(s.slice(last, m.index));
    if (t[0] === '#') out += `<span class="tk-c">${esc(t)}</span>`;
    else if (t[0] === '@') out += `<span class="tk-d">${esc(t)}</span>`;
    else if (/^[rRbBfFuU]{0,2}["']/.test(t)) out += `<span class="tk-s">${esc(t)}</span>`;
    else if (PY_KW.has(t)) out += `<span class="tk-k">${esc(t)}</span>`;
    else out += esc(t);
    last = m.index + t.length;
  }
  return out + esc(s.slice(last));
}
// JSON (el body de una respuesta de la API): claves, strings y números.
function hlJson(code) {
  return esc(code).replace(/(&quot;(?:\\.|[^\\&]|&(?!quot;))*?&quot;)(\s*:)?|(-?\b\d+(?:\.\d+)?(?:[eE][-+]?\d+)?\b)/g, (m, str, colon, num) => {
    if (str) return colon ? `<span class="tk-k">${str}</span>${colon}` : `<span class="tk-s">${str}</span>`;
    return `<span class="tk-n">${num}</span>`;
  });
}
// El cuerpo de un heredoc de bash: Python si lo lee python o si va a un .py; YAML si va a un .yml o a kubectl apply -f -.
function heredocLang(ln) {
  if (/\bpython3?(?:\.\d+)?\s+-\s*<</.test(ln)) return 'python';
  if (/\bkubectl\b.*\s-f\s+-\s*<</.test(ln)) return 'yaml';
  const f = (ln.match(/>\s*(\S+)\s*<</) || ln.match(/>\s*(\S+)/) || [])[1] || '';
  return /\.py$/.test(f) ? 'python' : /\.ya?ml$/.test(f) ? 'yaml' : /\.json$/.test(f) ? 'json' : 'text';
}
const hlBody = (h) => (h.lang === 'python' ? hlPy(h.body.join('\n')) : h.lang === 'json' ? hlJson(h.body.join('\n')) : h.lang === 'yaml' ? hlYaml(h.body.join('\n')) : h.body.map((l) => esc(l)).join('\n'));
function hl(code, lang) {
  if (lang === 'python') return hlPy(code);
  if (lang === 'json') return hlJson(code);
  if (lang === 'promql') return hlProm(code);
  if (lang === 'yaml') return hlYaml(code);
  const out = []; let cont = false, here = null;
  for (const ln of String(code).split('\n')) {
    if (here) {
      if (ln.trim() === here.end) { if (here.body.length) out.push(hlBody(here)); out.push(`<span class="tk-k">${esc(ln)}</span>`); here = null; cont = false; continue; }
      here.body.push(ln);
      continue;
    }
    const st = { atStart: !cont, cmdPos: !cont, sub: 0 };
    out.push(hlLine(ln, lang, st));
    cont = /\\\s*$/.test(ln) && !/^\s*#/.test(ln);
    if (lang === 'bash') {
      const h = ln.match(/<<-?\s*'?(\w+)'?/);
      if (h) here = { end: h[1], lang: heredocLang(ln), body: [] };
    }
  }
  if (here && here.body.length) out.push(hlBody(here));
  return out.join('\n');
}
const LANG = { python: 'Python', bash: 'bash · zsh', text: 'texto', json: 'JSON', yaml: 'YAML', promql: 'PromQL' };
const codeBlock = (code, lang, label, src) => `<div class="code"><div class="code__bar"><span class="code__lang">${esc(label || LANG[lang] || lang)}</span>${src ? `<span class="code__src">${esc(src)}</span>` : ''}${copyBtn()}</div><pre><code>${hl(code, lang)}</code></pre></div>`;

// ---------------------------------------------------------------- tablas HTML (se apilan en el celular)
function dataTable(head, rows, { cls = '', mono = [], cmd = [] } = {}) {
  const cell = (v, j) => {
    const content = cmd.includes(j) ? cmdHtml(v) : tx(v);
    const k = j > 0 && head[j] ? ` data-k="${esc(head[j])}"` : '';
    const c = [j === 0 ? 'rh' : '', mono.includes(j) ? 'mono' : '', cmd.includes(j) ? 'cmdc' : '', /^[—–-]$/.test(String(v).trim()) ? 'nil' : ''].filter(Boolean).join(' ');
    return j === 0 ? `<th scope="row"${c ? ` class="${c}"` : ''}>${content}</th>` : `<td${k}${c ? ` class="${c}"` : ''}>${content}</td>`;
  };
  return `<div class="tblw"><table class="dt stk ${cls}"><thead><tr>${head.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map(cell).join('')}</tr>`).join('')}</tbody></table></div>`;
}
const noteP = (s) => (s ? `<p class="fig__note">${rx(s)}</p>` : '');
const notesList = (arr) => (arr && arr.length ? `<ul class="fig__notes">${arr.map((x) => `<li>${rx(x)}</li>`).join('')}</ul>` : '');

// ---------------------------------------------------------------- SVG (las curvas: counter, gauge, rate, estados, presupuesto)
const svgFig = (W, H, body, label, cls, maxW) => `<svg class="chart ${cls}" viewBox="0 0 ${W} ${r1(H)}" role="img" aria-label="${esc(label)}" preserveAspectRatio="xMidYMid meet"${maxW ? ` style="max-width:${maxW}px"` : ''}>${body}</svg>`;
const txt = (x, y, s, cls = 't', anchor = 'start') => `<text x="${r1(x)}" y="${r1(y)}" class="${cls}" text-anchor="${anchor}">${esc(s)}</text>`;
const line = (x1, y1, x2, y2, cls = 'ax') => `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" class="${cls}"/>`;
const rect = (x, y, w, h, cls, extra = '') => `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(Math.max(0, w))}" height="${r1(Math.max(0, h))}" class="${cls}" ${extra}/>`;
const path = (d, cls = 's-muted', extra = '') => `<path d="${d}" class="${cls}" fill="none" ${extra}/>`;
const dot = (x, y, r, cls) => `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r}" class="${cls}"/>`;
const numMark = (x, y, k, cls = 'f-ink') => `<circle cx="${r1(x)}" cy="${r1(y)}" r="9" class="${cls}"/>` + txt(x, y + 4, String(k), 'tnum', 'middle');
const poly = (pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${r1(x)},${r1(y)}`).join(' ');
// un paso "redondo" para un eje: 1, 2, 2.5 o 5 por potencia de 10, con unos `n` cortes
function niceStep(max, n = 4) { const raw = max / n, p = 10 ** Math.floor(Math.log10(raw)); return [1, 2, 2.5, 5, 10].map((k) => k * p).find((s) => s >= raw); }

// ---------------------------------------------------------------- piezas comunes de las figuras
// La enfermera que hace la ronda (el scrape), el odómetro (counter), el medidor de gasolina (gauge), los cajones
// (histogram) y la campana (un aviso): dibujos chicos para recordar las figuras.
const ICON_NURSE = '<svg class="ic ic--nurse" viewBox="0 0 24 24" aria-hidden="true"><circle cx="8.5" cy="7" r="3"/><path class="ic__cap" d="M5.4 4.6h6.2l-0.7-2.6H6.1z"/><path d="M3.5 22v-6a5 5 0 0 1 10 0v6"/><rect class="ic__l" x="15" y="9.5" width="6.5" height="9.5" rx="1"/><path class="ic__l" d="M16.9 12.6h2.8M16.9 15.4h2.8"/></svg>';
const ICON_ODO = '<svg class="ic ic--odo" viewBox="0 0 24 24" aria-hidden="true"><rect class="ic__l" x="2" y="7" width="20" height="10" rx="2"/><path class="ic__l" d="M7 7v10M12 7v10M17 7v10"/><path class="ic__l" d="M15 4.5l2 1.5-2 1.5" /></svg>';
const ICON_FUEL = '<svg class="ic ic--fuel" viewBox="0 0 24 24" aria-hidden="true"><path class="ic__l" d="M3.5 17.5a8.5 8.5 0 0 1 17 0"/><path class="ic__l" d="M12 17.5l-4.4-6.2"/><circle cx="12" cy="17.5" r="1.7"/><path class="ic__l" d="M3.5 17.5h2.2M18.3 17.5h2.2"/></svg>';
const ICON_DRAWERS = '<svg class="ic ic--drawers" viewBox="0 0 24 24" aria-hidden="true"><rect class="ic__l" x="4" y="2.5" width="16" height="19" rx="1.5"/><path class="ic__l" d="M4 8.8h16M4 15.2h16M10.4 5.6h3.2M10.4 12h3.2M10.4 18.4h3.2"/></svg>';
const ICON_BELL = '<svg class="ic ic--bell" viewBox="0 0 24 24" aria-hidden="true"><path class="ic__l" d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.6 2.1H4.4z"/><path class="ic__l" d="M10 20.6a2 2 0 0 0 4 0"/></svg>';
const ICON_PUSH = '<svg class="ic ic--push" viewBox="0 0 24 24" aria-hidden="true"><rect class="ic__l" x="3" y="12.5" width="8" height="8" rx="1.2"/><path class="ic__l" d="M7 12.5V8.5a4 4 0 0 1 4-4h6.5"/><path class="ic__l" d="M15.2 2l2.8 2.5-2.8 2.5"/></svg>';
// Colores de las figuras (uno por idea), en una leyenda chica
const kindLeg = (kinds) => `<p class="kleg">${kinds.map((k) => ({
  cnt: '<span><i class="sw sw--cnt"></i>counter</span>',
  gau: '<span><i class="sw sw--gau"></i>gauge</span>',
  his: '<span><i class="sw sw--his"></i>histogram</span>',
  off: '<span><i class="sw sw--off"></i>del cliente</span>',
  prom: '<span><i class="sw sw--prom"></i>las agrega Prometheus</span>',
  ok: '<span><i class="sw sw--ok"></i>ok · up · inactive</span>',
  pen: '<span><i class="sw sw--pen"></i>pending</span>',
  fire: '<span><i class="sw sw--fire"></i>firing</span>',
  down: '<span><i class="sw sw--fire"></i>down o una cuenta que miente</span>',
  mute: '<span><i class="sw sw--off"></i>silenciada, inhibida o ignorada</span>',
}[k] || '')).join('')}</p>`;
const typeCls = (t) => (/counter/i.test(t) ? 'cnt' : /gauge/i.test(t) ? 'gau' : /histogram/i.test(t) ? 'his' : 'off');
// "classifier_requests_total (un pod)": el nombre como código y lo de entre paréntesis como texto; "requests en vuelo
// (gauge)" no es un nombre de métrica: va todo como texto.
const metricHtml = (m) => { const x = String(m || '').match(/^([a-zA-Z_:][\w:]*)\s*(\(.*\))?$/); return x ? `<code>${esc(x[1])}</code>${x[2] ? ` <span class="ty__mx">${tx(x[2])}</span>` : ''}` : `<span class="ty__mx">${tx(m)}</span>`; };

// ================================================================ figuras
// 1 · Pull contra push: la ronda de enfermería. Prometheus pasa por cada target cada 15 s y anota up (1 o 0); con push, un
// servicio muerto solo deja de mandar y nadie anota nada.
function figPull(d) {
  const P = d.prometheus || {}, ticks = d.ticks_s || [], T = d.targets || [], Q = d.push || {};
  if (P.interval_s && ticks.some((t, i) => i && t - ticks[i - 1] !== P.interval_s)) aviso('pull: los ticks_s no van cada interval_s');
  const n = ticks.length;
  const cell = (up) => (up ? '<span class="pl__c pl--up">1</span>' : '<span class="pl__c pl--down">0</span>');
  const tname = (t) => `<p class="pl__t${t.up ? '' : ' pl__t--down'}"><b>${tx(t.name)}</b><span class="pl__ep"><code>${esc(t.endpoint)}</code>${t.job ? `<span class="pl__job">job="${esc(t.job)}"</span>` : ''}</span></p>`;
  const head = (lab) => `<p class="pl__gh">${lab}</p>${ticks.map((t) => `<span class="pl__gt">${fmtN(t)}</span>`).join('')}`;
  const aria = `Prometheus lee cada target cada ${P.interval_s} s: ${T.map((t) => `${t.name}, up = ${t.up}`).join('; ')}.`;
  const pull = `<div class="pl__side pl--pull">
    <p class="pl__h">${ICON_NURSE}<span><b>Pull:</b> Prometheus hace la ronda</span></p>
    <p class="pl__who"><b>${esc(P.name || 'Prometheus')}</b> <code>:${esc(P.port || 9090)}</code> pasa por cada target cada <b>${fmtN(P.interval_s)}&nbsp;s</b>, pide <code>/metrics</code> y espera hasta <b>${fmtN(P.timeout_s)}&nbsp;s</b>. En cada visita anota <code>up</code>:</p>
    <div class="pl__g" style="--n:${n}" role="img" aria-label="${esc(aria)}">${head('cada ronda, en segundos')}${T.map((t) => tname(t) + ticks.map(() => cell(t.up)).join('')).join('')}</div>
    <p class="pl__dir"><span class="pl__ar">Prometheus <b>→</b> GET /metrics <b>→</b> target</span><span class="pl__ar">target <b>→</b> 200 con el texto</span></p>
    ${d.pull_note ? `<p class="pl__nt">${tx(d.pull_note)}</p>` : ''}
  </div>`;
  const push = `<div class="pl__side pl--push">
    <p class="pl__h">${ICON_PUSH}<span><b>Push:</b> ${tx(String(Q.name || 'push').replace(/^Push\s*/i, '') || 'cada proceso manda')}</span></p>
    ${Q.who ? `<p class="pl__who"><span class="k">Quién abre la conexión:</span> ${tx(Q.who)}</p>` : ''}
    <div class="pl__g pl__g--push" style="--n:${n}" aria-hidden="true">${head('si estos mismos mandaran')}${T.map((t) => tname(t) + ticks.map(() => (t.up ? '<span class="pl__c pl--sent">↑</span>' : '<span class="pl__c pl--none"></span>')).join('')).join('')}</div>
    ${Q.when ? `<p class="pl__who"><span class="k">Cuándo conviene:</span> ${tx(Q.when)}</p>` : ''}
    ${Q.weakness ? `<p class="pl__weak"><span class="k">El problema:</span> ${tx(Q.weakness)}</p>` : ''}
  </div>`;
  return `<div class="pl">${pull}${push}</div><p class="kleg"><span><i class="sw sw--ok"></i>up = 1: contestó</span><span><i class="sw sw--fire"></i>up = 0: no contestó, y queda anotado</span><span><i class="sw sw--sent"></i>con push: mandó</span><span><i class="sw sw--none"></i>con push: nada (¿murió o no hubo tráfico?)</span></p>`;
}

// 2 · Los tres tipos, a escala: el counter (odómetro) con su reinicio y su rate, el gauge (medidor de gasolina) con su
// promedio y su pico, y los cajones acumulados del histograma.
function seriesChart(pts, { W = 320, H = 196, xr, yr, cls, win, reset, extra = '', yfmt = fmtN }) {
  const L = 44, R = 12, Tp = 26, B = 32;
  const X = (t) => L + ((t - xr[0]) / (xr[1] - xr[0])) * (W - L - R);
  const Y = (v) => Tp + (1 - (v - yr[0]) / (yr[1] - yr[0])) * (H - Tp - B);
  let s = '';
  if (win) { s += rect(X(win[0]), Tp - 4, X(win[1]) - X(win[0]), H - Tp - B + 4, 'f-win'); s += txt((X(win[0]) + X(win[1])) / 2, Tp - 8, win[2], 'tm tb', 'middle'); }
  const yst = niceStep(yr[1] - yr[0], 3);
  for (let v = yr[0]; v <= yr[1] + 1e-9; v += yst) { s += line(L, Y(v), W - R, Y(v), 'grid'); s += txt(L - 6, Y(v) + 4, yfmt(r2(v)), 't', 'end'); }
  const xs = pts.map((p) => p[0]);
  xs.forEach((t, i) => { s += line(X(t), H - B, X(t), H - B + 4, 'ax'); if (i % 2 === 0) s += txt(X(t), H - B + 16, fmtN(t), 't', 'middle'); });
  s += line(L, H - B, W - R, H - B, 'ax') + txt(W - R, H - 4, 'segundos', 't', 'end');
  // la línea: un tramo por proceso (el reinicio la corta)
  const parts = [[]];
  pts.forEach((p, i) => { if (reset && i && pts[i - 1][0] === reset[0]) parts.push([]); parts[parts.length - 1].push(p); });
  parts.forEach((pp) => { if (pp.length > 1) s += path(poly(pp.map(([t, v]) => [X(t), Y(v)])), `s-${cls}`, 'stroke-width="2"'); });
  if (reset) {
    const a = pts.find((p) => p[0] === reset[0]), b = pts.find((p) => p[0] === reset[1]);
    if (a && b) { s += path(`M${r1(X(a[0]))},${r1(Y(a[1]))} L${r1(X(b[0]))},${r1(Y(b[1]))}`, 's-muted', 'stroke-width="1.6" stroke-dasharray="1.5 3"'); s += txt((X(a[0]) + X(b[0])) / 2 + 4, (Y(a[1]) + Y(b[1])) / 2, 'reinicio', 'tm tb', 'start'); }
  }
  pts.forEach(([t, v]) => { s += dot(X(t), Y(v), 3.3, `f-${cls}`); });
  return { s: s + extra, X, Y, W, H };
}
function figTypes(d) {
  const C = d.counter || {}, G = d.gauge || {}, H = d.histogram || {}, S = d.summary;
  const cards = [];
  // el counter y el gauge comparten el eje de tiempo y la ventana de 2 min (la del lab de esta sección)
  const wm = String(C.window || '').match(/\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)\]/);
  const win = wm ? [+wm[1], +wm[2], `ventana ${String(C.window).split(':')[0]}`] : null;
  const ref = C.points || G.points || [[0, 0]];
  const xr = [Math.min(win ? win[0] : Infinity, ref[0][0]) - 4, ref[ref.length - 1][0] + 6];
  if (C.points) {
    const pts = C.points;
    const ymax = Math.max(...pts.map((p) => p[1])), yst = niceStep(ymax, 2);
    const ch = seriesChart(pts, { xr, yr: [0, Math.ceil((ymax * 1.08) / yst) * yst], cls: 'cnt', win, reset: C.reset_between });
    // los valores a cada lado del reinicio, junto a sus puntos
    const ri = pts.findIndex((p) => C.reset_between && p[0] === C.reset_between[1]);
    let lab = '';
    if (ri > 0) {
      const a = pts[ri - 1], b = pts[ri], z = pts[pts.length - 1], f = pts[0];
      lab += txt(ch.X(f[0]), ch.Y(f[1]) - 9, fmtN(f[1]), 'tv', 'start') + txt(ch.X(a[0]), ch.Y(a[1]) - 9, fmtN(a[1]), 'tv', 'middle');
      lab += txt(ch.X(b[0]) + 7, ch.Y(b[1]) - 7, fmtN(b[1]), 'tv', 'start') + txt(ch.X(z[0]), ch.Y(z[1]) - 9, fmtN(z[1]), 'tv', 'end');
    }
    const odo = ri > 0 ? `<p class="ty__odo"><span class="odo">${String(pts[ri - 1][1]).padStart(6, '0')}</span><span aria-hidden="true">→</span><span class="odo odo--new">${String(pts[ri][1]).padStart(6, '0')}</span><span class="ty__odn">el proceso nuevo empieza de 0</span></p>` : '';
    cards.push(`<div class="ty__c ty--cnt"><p class="ty__h">${ICON_ODO}<span><b>Counter</b> · el odómetro: solo sube</span></p><p class="ty__m">${metricHtml(C.metric)}</p>
      ${svgFig(ch.W, ch.H, ch.s + lab, `Counter a escala: ${pts.map((p) => p.join(' s → ')).join(', ')}; reinicio entre ${C.reset_between}`, 'ty__svg')}
      ${odo}<ul class="ty__r"><li class="ok"><code>rate(x[2m])</code> <b>${fmtN(C.rate_per_s)}/s</b><span>corrige el reinicio</span></li><li><code>increase(x[2m])</code> <b>${fmtN(C.increase)}</b><span>requests en la ventana</span></li><li class="bad"><span class="ty__x">última − primera</span> <b>${fmtN(C.naive_per_s)}/s</b><span>negativo: no ve el reinicio</span></li></ul>
      ${C.note ? `<p class="ty__n">${tx(C.note)}</p>` : ''}</div>`);
  }
  if (G.points) {
    const pts = G.points, ymax = Math.max(...pts.map((p) => p[1]));
    const yr = [0, Math.ceil(ymax + 1)];
    const ch = seriesChart(pts, { xr, yr, cls: 'gau', win });
    let ex = '';
    if (G.avg_over_time !== undefined) ex += line(44, ch.Y(G.avg_over_time), ch.W - 12, ch.Y(G.avg_over_time), 'l-avg');
    if (G.max_over_time !== undefined) { const p = pts.find((q) => q[1] === G.max_over_time); if (p) ex += `<circle cx="${r1(ch.X(p[0]))}" cy="${r1(ch.Y(p[1]))}" r="7.5" class="ring-gau"/>` + txt(ch.X(p[0]) + 11, ch.Y(p[1]) - 4, `pico ${fmtN(G.max_over_time)}`, 'tg tb', 'start'); }
    cards.push(`<div class="ty__c ty--gau"><p class="ty__h">${ICON_FUEL}<span><b>Gauge</b> · el medidor de gasolina: sube y baja</span></p><p class="ty__m">${metricHtml(G.metric)}</p>
      ${svgFig(ch.W, ch.H, ch.s + ex, `Gauge a escala: ${pts.map((p) => p[1]).join(', ')}; promedio ${G.avg_over_time}, pico ${G.max_over_time}`, 'ty__svg')}
      <ul class="ty__r"><li class="ok"><code>avg_over_time(x[2m])</code> <b>${fmtN(G.avg_over_time)}</b><span>lo que marcó en promedio: la línea punteada</span></li><li class="ok"><code>max_over_time(x[2m])</code> <b>${fmtN(G.max_over_time)}</b><span>el pico, en el círculo</span></li></ul>
      ${G.note ? `<p class="ty__n">${tx(G.note)}</p>` : ''}</div>`);
  }
  if (H.buckets) {
    const B = H.buckets, N = +H.count || B[B.length - 1][1];
    B.forEach(([le, c], i) => { if (i && c < B[i - 1][1]) aviso(`types: el bucket le=${le} (${c}) baja respecto del anterior`); if (H.per_bucket && H.per_bucket[i] !== c - (i ? B[i - 1][1] : 0)) aviso(`types: per_bucket[${i}] no es la diferencia de los acumulados`); });
    if (B[B.length - 1][0] !== '+Inf' || B[B.length - 1][1] !== N) aviso('types: el último bucket no es +Inf = count');
    const rows = B.map(([le, c], i) => { const prev = i ? B[i - 1][1] : 0; return `<li${le === '+Inf' ? ' class="ty__inf"' : ''}><span class="ty__le">le="${esc(le)}"</span><span class="ty__bt"><span class="ty__bp" style="width:${pct(prev / N)}"></span><span class="ty__bn" style="left:${pct(prev / N)};width:${pct((c - prev) / N)}"></span></span><span class="ty__bv">${fmtN(c)}</span></li>`; }).join('');
    cards.push(`<div class="ty__c ty--his"><p class="ty__h">${ICON_DRAWERS}<span><b>Histogram</b> · cajones acumulados: «hasta»</span></p><p class="ty__m">${metricHtml(H.metric)}</p>
      <ol class="ty__bk" role="img" aria-label="${esc(`Buckets acumulados: ${B.map(([le, c]) => `le ${le}: ${c}`).join(', ')}`)}">${rows}</ol>
      <p class="ty__sum"><span><code>_sum</code> <b>${fmtN(H.sum_s)}&nbsp;s</b></span><span><code>_count</code> <b>${fmtN(N)}</b></span><span>= <code>le="+Inf"</code></span></p>
      ${H.note ? `<p class="ty__n">${tx(H.note)}</p>` : ''}</div>`);
  }
  const sum = S && S.note ? `<p class="ty__sm"><span class="k">Summary:</span> ${tx(S.note)}</p>` : '';
  return `<div class="ty">${cards.join('')}</div>${sum}<p class="kleg"><span><i class="sw sw--cnt"></i>counter</span><span><i class="sw sw--gau"></i>gauge</span><span><i class="sw sw--his"></i>histogram: lo nuevo de cada cajón</span><span><i class="sw sw--hisoft"></i>lo que ya traía del cajón anterior</span><span><i class="sw sw--win"></i>la ventana de rate()</span></p>`;
}

// 3 · Una métrica se abre en series: el árbol de la latencia (4 sources × 15), las series por pod a escala (un cuadrito,
// una serie) y lo que hace un label sin techo.
function figSeries(d) {
  const tr = d.tree || {}, rows = d.rows || [];
  const nB = +((String((tr.per_value || [])[0] || '').match(/\((\d+)\)/) || [])[1] || 0);
  const per = +tr.per_value_count || 0, extra = per - nB;
  if (tr.values && per * tr.values.length !== +tr.total) aviso(`series: ${per} × ${tr.values.length} no da total ${tr.total}`);
  const sqs = `${'<i class="sq sq--b"></i>'.repeat(nB)}${extra > 0 ? '<i class="sq sq--inf"></i>' + '<i class="sq sq--x"></i>'.repeat(extra - 1) : ''}`;
  const tree = `<div class="se__tree"><p class="se__root"><span class="tag2 tag2--his">histogram</span><code>${esc(tr.metric)}</code></p>
    <p class="se__lab">se abre por el label <code>${esc(tr.label)}</code>, que tiene ${fmtN((tr.values || []).length)} valores:</p>
    <ul class="se__kids">${(tr.values || []).map((v) => `<li><p class="se__v"><code>${esc(tr.label)}="${esc(v)}"</code></p><p class="se__sq" aria-hidden="true">${sqs}</p><p class="se__n">${fmtN(per)} series</p></li>`).join('')}</ul>
    <p class="se__tot">${fmtN((tr.values || []).length)} × ${fmtN(per)} = <b>${fmtN(tr.total)} series</b> de una sola métrica, en un solo pod</p>
    <p class="se__key">${(tr.per_value || []).map((x, i) => { const m = String(x).match(/^(.*?)\s*(\(\d+\))$/); return `<span><i class="sq ${i === 0 ? 'sq--b' : i === 1 ? 'sq--inf' : 'sq--x'}"></i><code>${esc(m ? m[1] : x)}</code>${m ? ` ${esc(m[2])}` : ''}</span>`; }).join('')}</p></div>`;
  // las series por pod, a escala
  const mx = Math.max(1, ...rows.map((r) => +r.max_series || 0));
  const tot = rows.reduce((a, r) => a + (+r.max_series || 0), 0);
  if (d.total_pod && tot !== +d.total_pod) aviso(`series: las filas suman ${tot}, pero total_pod dice ${d.total_pod}`);
  const list = `<ol class="se__rows">${rows.map((r) => { const k = typeCls(r.type); return `<li class="se--${k}"><p class="se__mn"><code>${esc(r.metric)}</code><span class="tag2 tag2--${k}">${esc(r.type)}</span></p><p class="se__ml">${r.labels && !/^[—–-]$/.test(String(r.labels).trim()) ? tx(r.labels) : 'sin labels'}${r.per_combination ? ` · <b>${fmtN(r.per_combination)}</b> por combinación` : ''}</p><p class="se__b"><span class="se__bt"><span class="se__bb" style="width:${pct((+r.max_series || 0) / mx)}"></span></span><b>${fmtN(r.max_series)}</b></p></li>`; }).join('')}</ol>`;
  // el waffle: 1 cuadrito = 1 serie
  const plus = +d.per_target_extra || 0;
  const waf = rows.map((r) => `<i class="w--${typeCls(r.type)}" title="${esc(r.metric)}"></i>`.repeat(+r.max_series || 0)).join('') + '<i class="w--prom"></i>'.repeat(plus);
  const svc = String(d.service || '');
  const waffle = `<div class="se__waf"><p class="to__h">Un pod del gateway, un cuadrito por serie: ${fmtN(tot)}${plus ? ` + ${fmtN(plus)} = <b>${fmtN(tot + plus)}</b>` : ''}</p><p class="se__w" role="img" aria-label="${esc(`${tot + plus} series por pod`)}">${waf}</p>${svc ? `<p class="se__svc">${tx(svc)}</p>` : ''}</div>`;
  const bad = d.bad ? `<div class="se__bad"><p class="se__bh">Un label sin techo: <code>${esc(d.bad.label)}</code></p><p>${tx(d.bad.growth)}</p></div>` : '';
  return `${tree}<div class="se__g"><div><p class="to__h">Series por métrica en un pod (a escala, máximo ${fmtN(mx)})</p>${list}</div>${waffle}</div>${bad}${d.measured ? `<p class="fig__note"><span class="k">Medido:</span> ${tx(d.measured)}</p>` : ''}${kindLeg(['cnt', 'his', 'off', 'prom'])}`;
}

// 5 · rate(): un counter que reinicia dentro de la ventana. Restar el primero al último da negativo; rate() pega encima
// lo que el contador llevaba antes del reinicio (la línea punteada) y la pendiente sale bien. SVG ancho y angosto.
function rateSvg(d, W) {
  const narrow = W < 500;
  const S = d.samples || [], win = d.window || {}, ev = +d.eval_s, rs = d.reset_between_s || [];
  const L = narrow ? 46 : 64, R = narrow ? 14 : 136, Tp = 34, B = 40, H = narrow ? 270 : 300;
  const tMax = S[S.length - 1][0];
  const pre = (S.find((p) => p[0] === rs[0]) || [0, 0])[1];
  const ghost = S.filter((p) => p[0] >= rs[1] && p[0] <= ev).map(([t, v]) => [t, v + pre]);
  const yTop = Math.max(...S.map((p) => p[1]), ...ghost.map((p) => p[1]));
  const yst = niceStep(yTop, 5), yMax = Math.ceil((yTop * 1.06) / yst) * yst;
  const X = (t) => L + (t / tMax) * (W - L - R), Y = (v) => Tp + (1 - v / yMax) * (H - Tp - B);
  const inW = S.filter((p) => p[0] > win.from_s_exclusive && p[0] <= win.to_s);
  const f = inW[0], z = inW[inW.length - 1];
  let s = '';
  s += rect(X(win.from_s_exclusive), Tp - 8, X(win.to_s) - X(win.from_s_exclusive), H - Tp - B + 8, 'f-win');
  s += txt((X(win.from_s_exclusive) + X(win.to_s)) / 2, Tp - 14, narrow ? `ventana ${win.selector}` : `la ventana ${win.selector}: (${win.from_s_exclusive}, ${win.to_s}] s · ${win.samples_in} muestras`, 'tm tb', 'middle');
  for (let v = 0; v <= yMax + 1e-9; v += yst) { s += line(L, Y(v), W - R, Y(v), 'grid'); s += txt(L - 6, Y(v) + 4, fmtN(v), 't', 'end'); }
  const xst = narrow ? 30 : 15;
  for (let t = 0; t <= tMax + 1e-9; t += xst) { s += line(X(t), H - B, X(t), H - B + 4, 'ax'); if (t % (narrow ? 60 : 30) === 0) s += txt(X(t), H - B + 17, fmtN(t), 't', 'middle'); }
  s += line(L, H - B, W - R, H - B, 'ax') + txt(W - R, H - 4, 'segundos', 't', 'end') + txt(6, 12, narrow ? 'valor' : 'valor del counter', 't', 'start');
  // la hora de la evaluación, arriba (abajo chocaba con "segundos"): centrada en el celular, a la derecha de la línea en la
  // versión ancha (a la izquierda está el rótulo de la ventana)
  s += line(X(ev), Tp - 8, X(ev), H - B, 'l-now') + (narrow ? txt(X(ev), Tp - 14, `t = ${ev}`, 'tm tb', 'middle') : txt(X(ev) + 6, Tp - 14, `evaluamos en t = ${ev}`, 'tm tb', 'start'));
  // el counter: un tramo por proceso; el reinicio, punteado (no es un error: el proceso nuevo empieza de 0)
  const a = S.filter((p) => p[0] <= rs[0]), b = S.filter((p) => p[0] >= rs[1]);
  s += path(poly(a.map(([t, v]) => [X(t), Y(v)])), 's-cnt', 'stroke-width="2"') + path(poly(b.map(([t, v]) => [X(t), Y(v)])), 's-cnt', 'stroke-width="2"');
  s += path(`M${r1(X(rs[0]))},${r1(Y(pre))} L${r1(X(rs[1]))},${r1(Y(b[0][1]))}`, 's-muted', 'stroke-width="1.6" stroke-dasharray="1.5 3"');
  s += txt(X(rs[1]) - (narrow ? 8 : 10), Y(b[0][1]) - (narrow ? 2 : 6), 'reinicio', 'tm tb', 'end');
  // lo que suma rate(): el proceso nuevo, con los 1,680 del viejo encima
  s += path(poly([[X(rs[0]), Y(pre)], ...ghost.map(([t, v]) => [X(t), Y(v)])]), 's-cnt', 'stroke-width="1.5" stroke-dasharray="4 3" opacity=".75"');
  ghost.forEach(([t, v]) => { s += dot(X(t), Y(v), 3, 'f-paper s-cnt'); });
  const gm = ghost[Math.floor(ghost.length / 2)] || ghost[0];
  if (gm) s += txt(X(gm[0]), Y(gm[1]) + (narrow ? 20 : 22), `+${fmtN(pre)}`, 'tc tb', 'middle');
  // las dos pendientes
  s += line(X(f[0]), Y(f[1]), X(z[0]), Y(z[1] + pre), 'l-rate') + line(X(f[0]), Y(f[1]), X(z[0]), Y(z[1]), 'l-naive');
  S.forEach(([t, v]) => { s += dot(X(t), Y(v), 3.4, t > win.from_s_exclusive && t <= win.to_s ? 'f-cnt' : 'f-cnt o-out'); });
  const rv = (d.rate || {}).value, nv = (d.naive || {}).value;
  // la resta: en el celular, debajo de su línea punteada cerca del comienzo (más allá cruza el reinicio y el counter); en
  // la versión ancha, abajo a la derecha del último punto, en el margen (ahí la curva sube y deja el lugar libre)
  if (narrow) {
    const tl = f[0] + (z[0] - f[0]) * 0.08, vl = f[1] + ((z[1] - f[1]) * (tl - f[0])) / (z[0] - f[0]);
    s += txt(X(tl), Y(vl) + 19, `${fmtN(nv)} req/s`, 'tw tb', 'start');
    s += txt(X(z[0]) - 4, Y(z[1] + pre) - 10, `rate() = ${fmtN(rv)} req/s`, 'tc tb', 'end');
  } else {
    s += txt(X(z[0]) + 10, Y(z[1]) + 22, `restar: ${fmtN(nv)} req/s ✗`, 'tw tb', 'start');
    s += txt(X(z[0]) + 10, Y(z[1] + pre) + 4, `rate() = ${fmtN(rv)} req/s ✓`, 'tc tb', 'start');
  }
  return { s, H };
}
function figRate(d) {
  const S = d.samples || [];
  if (S.some((p, i) => i && p[0] - S[i - 1][0] !== +d.scrape_s)) aviso('rate: las muestras no van cada scrape_s');
  const win = d.window || {}, n = S.filter((p) => p[0] > win.from_s_exclusive && p[0] <= win.to_s).length;
  if (win.samples_in !== undefined && n !== +win.samples_in) aviso(`rate: en la ventana hay ${n} muestras, pero samples_in dice ${win.samples_in}`);
  const aria = `${d.metric}: un counter que sube ${S.length > 1 ? (S[1][1] - S[0][1]) / d.scrape_s : ''} por segundo y reinicia entre ${(d.reset_between_s || []).join(' y ')} s. Restar da ${(d.naive || {}).value} req/s; rate() da ${(d.rate || {}).value} req/s.`;
  const w = rateSvg(d, 720), nw = rateSvg(d, 340);
  const card = (cls, title, o, unit) => (o ? `<li class="ra__k ra--${cls}"><p class="ra__kt">${title}</p><p class="ra__kc"><code>${esc(o.calc)}</code></p><p class="ra__kv"><b>${fmtN(o.value)}</b>${unit ? ` ${unit}` : ''}</p></li>` : '');
  return `${svgFig(720, w.H, w.s, aria, 'fv-w', 900)}${svgFig(340, nw.H, nw.s, aria, 'fv-n', 470)}
    <ol class="ra__ks">${card('bad', 'Restar el primero al último: no ve el reinicio', d.naive, 'req/s')}${card('ok', 'rate(): suma lo que el counter llevaba antes del reinicio', d.rate, 'req/s')}${card('plain', 'increase(): rate × los segundos de la ventana', d.increase, 'requests')}${card('plain', 'irate() en t = 105: solo las dos últimas muestras', d.irate_at_105, 'req/s')}</ol>
    <p class="kleg"><span><i class="sw sw--cnt"></i>${esc(d.metric || 'el counter')}, una muestra cada ${fmtN(d.scrape_s)}&nbsp;s</span><span><i class="sw sw--ghost"></i>lo que ve rate(): el viejo + el nuevo</span><span><i class="sw sw--fire"></i>la resta que miente</span><span><i class="sw sw--win"></i>la ventana: abierta a la izquierda</span></p>`;
}

// 6 · Buckets e interpolación: los buckets acumulados de dos pods sumados (to scale), la recta dentro del bucket donde cae
// r = 0.99 × N y por qué el promedio de los p99 de cada pod miente.
function bucketsInterp(d) {
  const b = d.bucket || {}, W = 340, H = 232, L = 44, R = 18, Tp = 26, B = 46;
  const x0 = b.l - (b.u - b.l) * 0.2, x1 = b.u + (b.u - b.l) * 0.2, y0 = b.c_l - 1, y1 = b.c_u + 0.6;
  const X = (v) => L + ((v - x0) / (x1 - x0)) * (W - L - R), Y = (v) => Tp + (1 - (v - y0) / (y1 - y0)) * (H - Tp - B);
  const ms = (v) => `${fmtN(r1(v * 1000))} ms`;
  let s = '';
  s += rect(X(b.l), Tp - 6, X(b.u) - X(b.l), H - Tp - B + 6, 'f-hissoft');
  s += txt((X(b.l) + X(b.u)) / 2, Tp - 11, 'el bucket donde cae r', 'tm tb', 'middle');
  [b.c_l, d.r, b.c_u].forEach((v) => { s += line(L, Y(v), W - R, Y(v), 'grid'); s += txt(L - 6, Y(v) + 4, v === d.r ? `r = ${v}` : String(v), v === d.r ? 'tm tb' : 't', 'end'); });
  [b.l, (b.l + b.u) / 2, b.u].forEach((v) => { s += line(X(v), H - B, X(v), H - B + 4, 'ax'); s += txt(X(v), H - B + 16, ms(v), 't', 'middle'); });
  s += line(L, H - B, W - R, H - B, 'ax');
  // la recta y el corte en r
  s += line(X(b.l), Y(b.c_l), X(b.u), Y(b.c_u), 'l-his');
  const q = d.estimate_s;
  s += line(L, Y(d.r), X(q), Y(d.r), 'l-guide') + line(X(q), Y(d.r), X(q), H - B, 'l-guide');
  s += dot(X(b.l), Y(b.c_l), 4, 'f-his') + dot(X(b.u), Y(b.c_u), 4, 'f-his') + dot(X(q), Y(d.r), 4.5, 'f-paper s-his2');
  s += txt(X(b.l) + 7, Y(b.c_l) + 14, `ℓ: ${b.c_l} hasta ${ms(b.l)}`, 'tm', 'start');
  s += txt(X(b.u) - 7, Y(b.c_u) - 8, `u: ${b.c_u} hasta ${ms(b.u)}`, 'tm', 'end');
  // real (Prometheus no lo conoce) y estimado (la recta), en un renglón bajo el eje: uno a cada lado
  s += `<path d="M${r1(X(d.real_s))},${r1(H - B - 1)} l-5,-8 h10 z" class="f-ink"/>`;
  s += txt(X(d.real_s) + 4, H - B + 32, `▲ real ${ms(d.real_s)}`, 'tm tb', 'end') + txt(X(q) - 4, H - B + 32, `estimado ${ms(q)}`, 'th tb', 'start');
  return svgFig(W, H, s, `Interpolación: r = ${d.r} cae entre ${b.c_l} (${ms(b.l)}) y ${b.c_u} (${ms(b.u)}); la recta da ${ms(q)}; el real es ${ms(d.real_s)}.`, 'bk__svg', 470);
}
function figBuckets(d) {
  const bounds = d.bounds || [], pods = d.pods || {}, names = Object.keys(pods), sum = d.sum || [];
  const N = +d.N || sum[sum.length - 1];
  bounds.forEach((le, i) => { const t = names.reduce((a, k) => a + (pods[k][i] || 0), 0); if (t !== sum[i]) aviso(`buckets: le=${le}: los pods suman ${t}, pero sum dice ${sum[i]}`); });
  const b = d.bucket || {};
  if (r2(b.l + (b.u - b.l) * ((d.r - b.c_l) / (b.c_u - b.c_l))) !== r2(d.estimate_s)) aviso('buckets: la interpolación no da estimate_s');
  if (d.r !== d.q * N) aviso(`buckets: r = ${d.r}, pero q × N = ${d.q * N}`);
  const rows = bounds.map((le, i) => {
    const hit = +le === b.l || +le === b.u;
    let acc = 0;
    const segs = names.map((k, j) => { const v = pods[k][i] || 0, l = acc; acc += v; return `<span class="bk__s bk--p${j}" style="left:${pct(l / N)};width:${pct(v / N)}" title="${esc(`${k}: ${v}`)}"></span>`; }).join('');
    return `<li class="${hit ? 'bk--hit' : ''}"><span class="ty__le">le="${esc(le)}"</span><span class="ty__bt">${segs}</span><span class="ty__bv">${fmtN(sum[i])}</span></li>`;
  }).join('');
  const rLine = `<span class="bk__r" style="left:calc(var(--le) + (100% - var(--le) - var(--bv)) * ${r2(d.r / N)})" aria-hidden="true"><span>r = ${fmtN(d.r)}</span></span>`;
  const stack = `<div class="bk__a"><p class="to__h">Los buckets acumulados de los dos pods, sumados por le (${fmtN(N)} requests)</p><ol class="ty__bk bk__rows" role="img" aria-label="${esc(bounds.map((le, i) => `le ${le}: ${sum[i]}`).join(', '))}">${rows}${rLine}</ol>
    <p class="kleg">${names.map((k, j) => `<span><i class="sw bk--p${j}"></i>${esc(k)}</span>`).join('')}<span><i class="sw sw--rline"></i>r = ${d.q} × ${fmtN(N)}: el request ${fmtN(d.r)}</span></p></div>`;
  // el promedio de los p99 contra el p99 de verdad, a escala
  const pp = d.per_pod_p99_s || {}, slo = +d.slo_s;
  const bars = [...names.map((k) => [`p99 de ${k}`, pp[k], 'pod']), ['promedio de los dos p99', d.avg_of_p99_s, 'avg'], ['p99 real de los 100', d.real_s, 'real'], ['histogram_quantile (la recta)', d.estimate_s, 'est']];
  const mx = Math.ceil((Math.max(slo, ...bars.map((x) => +x[1])) * 1000 * 1.02) / 50) * 50 / 1000; // de 0 a un número redondo (300 ms)
  const P = (v) => pct(v / mx);
  const avg = `<div class="bk__c"><p class="to__h">¿Cumple el SLO de ${fmtN(slo * 1000)} ms? A escala, de 0 a ${fmtN(Math.round(mx * 1000))} ms</p><ul class="bk__bars" style="--slo:${P(slo)}">${bars.map(([lab, v, k]) => `<li class="bk--${k}"><span class="bk__bl">${tx(lab)}</span><span class="bk__bt"><span class="bk__bb" style="width:${P(v)}"></span></span><span class="bk__bv">${fmtN(r1(v * 1000))}&nbsp;ms${k === 'avg' ? ' <b class="bk__no">✗</b>' : ''}</span></li>`).join('')}<li class="bk__slo" aria-hidden="true"><span></span><span class="bk__st"><span>SLO ${fmtN(slo * 1000)} ms</span></span><span></span></li></ul>
    <p class="fig__note">El promedio dice ${fmtN(r1(d.avg_of_p99_s * 1000))} ms («cumple»); el p99 de los ${fmtN(N)} requests es ${fmtN(r1(d.real_s * 1000))} ms. Sumar los buckets y sacar el cuantil una vez no miente.</p></div>`;
  return `<div class="bk">${stack}<div class="bk__i"><p class="to__h">histogram_quantile: una recta dentro del bucket</p>${bucketsInterp(d)}</div></div>${avg}`;
}

// 7 · Los estados de una alerta en el tiempo: el p99 minuto a minuto (cada punto con el color de su estado), la banda de
// estados, el for y los eventos. SVG ancho y angosto.
const STATE_CLS = { inactive: 'ok', pending: 'pen', firing: 'fire' };
function stateAt(states, m) { return states.find((x) => m >= x.from && m < x.to) || states[states.length - 1]; }
function alertSvg(d, W) {
  const narrow = W < 500, S = d.series || [], st = d.states || [], ev = d.events || [];
  const L = narrow ? 40 : 56, R = narrow ? 12 : 18, H = narrow ? 268 : 262;
  const t1 = Math.max(...S.map((p) => p[0]), ...st.map((x) => x.to));
  const X = (m) => L + (m / t1) * (W - L - R);
  const yv = S.map((p) => p[1]), th = +d.threshold;
  const y0 = Math.floor(r2((Math.min(...yv, th) - 0.02) * 20)) / 20, y1 = Math.ceil(r2((Math.max(...yv, th) + 0.02) * 20)) / 20;
  const cT = 34, cB = narrow ? 150 : 148, bandY = cB + 22, bandH = 22, axY = bandY + bandH + (narrow ? 30 : 30);
  const Y = (v) => cT + (1 - (v - y0) / (y1 - y0)) * (cB - cT);
  let s = '';
  // eventos arriba, numerados
  ev.forEach((e, i) => { s += line(X(e.t), 22, X(e.t), axY, 'l-ev'); s += numMark(X(e.t), 12, i + 1, /page/i.test(e.label) ? 'f-fire' : /resol/i.test(e.label) ? 'f-ok' : 'f-ink'); });
  for (let v = y0; v <= y1 + 1e-9; v += 0.05) { const vv = r2(v); s += line(L, Y(vv), W - R, Y(vv), 'grid'); s += txt(L - 6, Y(vv) + 4, String(vv), 't', 'end'); }
  // el umbral, rotulado debajo de la línea donde la curva lleva más tiempo arriba (el tramo firing): ahí no hay nada
  const fs = st.filter((x) => x.state === 'firing').sort((a, b) => (b.to - b.from) - (a.to - a.from))[0];
  const tm = fs ? (fs.from + fs.to) / 2 : t1 / 2, evNear = ev.some((e) => Math.abs(e.t - tm) < 1.5);
  s += line(L, Y(th), W - R, Y(th), 'l-th') + txt(X(evNear ? tm + 2 : tm), Y(th) + 15, `umbral ${th} s`, 'tw tb', 'middle');
  s += txt(6, cT - 12, narrow ? 'p99 (s)' : String(d.expr_label || 'p99 (s)').split(':')[0], 't', 'start');
  s += path(poly(S.map(([m, v]) => [X(m), Y(v)])), 's-ink', 'stroke-width="1.6"');
  S.forEach(([m, v]) => { s += dot(X(m), Y(v), narrow ? 3 : 3.6, `f-${STATE_CLS[stateAt(st, m).state] || 'ok'}`); });
  // banda de estados
  let fired = false;
  st.forEach((x) => {
    const k = STATE_CLS[x.state] || 'ok', w = X(x.to) - X(x.from);
    const lab = x.state === 'inactive' && fired ? 'resolved' : x.state;
    if (x.state === 'firing') fired = true;
    s += rect(X(x.from), bandY, w, bandH, `f-${k}-soft s-${k}`, 'rx="3"');
    if (textW(lab, 12, { bold: true }) + 8 < w) s += txt((X(x.from) + X(x.to)) / 2, bandY + 15.5, lab, `tb ts-${k}`, 'middle');
  });
  // el for: del inicio del último pending al firing
  const pend = [...st].reverse().find((x) => x.state === 'pending' && st.some((y) => y.state === 'firing' && y.from === x.to));
  if (pend) {
    const yb = bandY + bandH + 6;
    s += path(`M${r1(X(pend.from))},${yb} v6 H${r1(X(pend.to))} v-6`, 's-pen', 'stroke-width="1.6"');
    s += txt((X(pend.from) + X(pend.to)) / 2, yb + 20, `for: ${d.for_min} min seguidos`, 'tp tb', 'middle');
  }
  // eje en minutos
  s += line(L, axY, W - R, axY, 'ax');
  for (let m = 0; m <= t1; m += narrow ? 5 : 1) { s += line(X(m), axY, X(m), axY + (m % 5 ? 3 : 5), 'ax'); if (m % (narrow ? 10 : 5) === 0) s += txt(X(m), axY + 17, String(m), 't', 'middle'); }
  s += txt(W - R, axY + 32, d.x_label || 'minutos', 't', 'end');
  return { s, H: axY + 38 };
}
function figAlertStates(d) {
  const st = d.states || [], S = d.series || [];
  st.forEach((x, i) => { if (i && x.from !== st[i - 1].to) aviso(`alert-states: hay un hueco entre los estados ${i - 1} y ${i}`); });
  // cada punto en el estado que le toca: sobre el umbral → pending o firing; debajo → inactive
  S.forEach(([m, v]) => { const k = stateAt(st, m).state, over = v > d.threshold; if ((k === 'inactive') === over && !(k === 'firing' && !over)) aviso(`alert-states: el minuto ${m} (${v}) no calza con el estado ${k}`); });
  const aria = `${d.alert}: ${st.map((x) => `${x.state} de ${x.from} a ${x.to} min`).join('; ')}.`;
  const w = alertSvg(d, 720), nw = alertSvg(d, 340);
  let fired = false;
  const sts = st.map((x) => { const lab = x.state === 'inactive' && fired ? 'resolved' : x.state; if (x.state === 'firing') fired = true; return `<li><span class="as__st as--${STATE_CLS[x.state] || 'ok'}">${esc(lab)}</span><span class="as__t">${fmtN(x.from)}–${fmtN(x.to)} min</span><span class="as__x">${x.note ? tx(x.note) : ''}</span></li>`; }).join('');
  const evs = (d.events || []).map((e, i) => `<li><span class="kev__n${/page/i.test(e.label) ? ' kev__n--fire' : /resol/i.test(e.label) ? ' kev__n--ok' : ''}">${i + 1}</span><span class="kev__t">${fmtN(e.t)}&nbsp;min</span><span class="kev__x">${tx(e.label)}</span></li>`).join('');
  const ei = d.eval_interval_s || {};
  return `<p class="as__h"><code>${esc(d.alert)}</code> · <code>for: ${esc(d.for_min)}m</code> · se evalúa cada ${Object.entries(ei).map(([k, v]) => `${fmtN(v)}&nbsp;s ${k === 'eks' ? 'en EKS' : k === 'compose' ? 'en el compose' : 'en ' + esc(k)}`).join(' y ')}</p>
    ${svgFig(720, w.H, w.s, aria, 'fv-w', 900)}${svgFig(340, nw.H, nw.s, aria, 'fv-n', 470)}
    <div class="as__g"><ol class="as__sts">${sts}</ol><ol class="kev">${evs}</ol></div>
    ${kindLeg(['ok', 'pen', 'fire'])}`;
}

// 8 · El árbol de ruteo de Alertmanager: la raíz, un hijo por severidad con sus alertas, la inhibición y un incidente
// donde disparan tres alertas y llega un solo page.
const sevCls = (s) => (/^page|critical/i.test(String(s)) ? 'fire' : /warn/i.test(String(s)) ? 'pen' : 'tick');
function figRouting(d) {
  const R = d.root || {}, K = d.routes || [], I = d.inhibit, X = d.incident;
  const kv = (k, v) => (v === undefined || v === '' ? '' : `<span class="ro__kv"><span class="k">${esc(k)}</span> <code>${esc(Array.isArray(v) ? `[${v.join(', ')}]` : v)}</code></span>`);
  const root = `<div class="ro__root"><p class="ro__h">${ICON_BELL}<span><b>route</b> (la raíz): entran todas las alertas</span></p><p class="ro__rc">si ningún hijo calza → <b>${esc(R.receiver)}</b></p><p class="ro__kvs">${kv('group_by', R.group_by)}${kv('group_wait', R.group_wait)}${kv('group_interval', R.group_interval)}${kv('repeat_interval', R.repeat_interval)}</p></div>`;
  const kids = `<ol class="ro__kids">${K.map((k, i) => { const sev = (String(k.matchers).match(/severity="([^"]+)"/) || [])[1] || ''; return `<li class="ro--${sevCls(sev)}"><p class="ro__n"><span class="ro__no">${i + 1}</span><code>${esc(k.matchers)}</code></p><p class="ro__rc">→ <b>${esc(k.receiver)}</b></p>${k.extra ? `<p class="ro__x"><code>${esc(k.extra)}</code></p>` : ''}<ul class="ro__al">${(k.alerts || []).map((a) => `<li>${esc(a)}</li>`).join('')}</ul></li>`; }).join('')}</ol>`;
  const inh = I ? `<div class="ro__inh"><p class="ro__ih"><span class="k">Inhibición:</span> mientras esté activa una alerta con <code>${esc(I.source)}</code>, se callan las que cumplen <code>${esc(I.targets)}</code> y tienen el mismo <code>${esc((I.equal || []).join(', '))}</code>.</p></div>` : '';
  let inc = '';
  if (X) {
    const nNot = (X.alerts || []).filter((a) => !/inhib|silenc/i.test(a.result)).length;
    if (X.notifications !== undefined && nNot !== +X.notifications) aviso(`routing: ${nNot} alertas notifican, pero notifications dice ${X.notifications}`);
    inc = `<div class="ro__inc"><p class="to__h">Un incidente (${esc(X.start)}): ${tx(X.story)}</p><ol class="ro__tl">${(X.alerts || []).map((a) => { const off = /inhib|silenc/i.test(a.result); return `<li class="${off ? 'ro--off' : 'ro--sent'}"><span class="ro__tm">${esc(a.firing_at)}</span><span class="ro__a"><b>${esc(a.alert)}</b> <span class="sev2 sev2--${sevCls(a.severity)}">${esc(a.severity)}</span> firing <span class="ro__w">(${tx(a.why)})</span></span><span class="ro__res">${off ? '<b aria-hidden="true">⊘</b>' : '<b aria-hidden="true">✓</b>'} ${tx(a.result)}</span></li>`; }).join('')}</ol>
      <p class="ro__sum">${fmtN((X.alerts || []).length)} alertas en firing → <b>${fmtN(X.notifications)} ${+X.notifications === 1 ? 'notificación' : 'notificaciones'}</b></p></div>`;
  }
  return `<div class="ro">${root}<p class="ro__down" aria-hidden="true">↓ baja al primer hijo que calza</p>${kids}${inh}</div>${inc}<p class="kleg"><span><i class="sw sw--fire"></i>page: despierta a alguien</span><span><i class="sw sw--pen"></i>warning: en horario laboral</span><span><i class="sw sw--tick"></i>ticket: esta semana</span><span><i class="sw sw--off"></i>inhibida: no se notifica</span></p>`;
}

// 9 · Un dashboard de Grafana en su grilla de 24 columnas, a escala: filas, paneles (con su tipo, unidad y umbrales),
// variables y anotaciones. Abajo, cada panel con sus consultas.
const PANEL_ICON = {
  timeseries: '<svg viewBox="0 0 40 20" aria-hidden="true"><path d="M1 16 L8 12 L14 14 L21 6 L28 9 L34 4 L39 7"/></svg>',
  stat: '<svg viewBox="0 0 40 20" aria-hidden="true"><text x="20" y="15.5" text-anchor="middle">42</text></svg>',
  gauge: '<svg viewBox="0 0 40 20" aria-hidden="true"><path d="M8 18 A12 12 0 0 1 32 18"/><path d="M20 18 L27 10"/></svg>',
  heatmap: '<svg viewBox="0 0 40 20" aria-hidden="true">' + [0, 1, 2, 3, 4, 5].map((c) => [0, 1, 2].map((r) => `<rect x="${2 + c * 6.2}" y="${1.5 + r * 6}" width="5.4" height="5.2" opacity="${[0.25, 0.5, 0.9, 0.6, 0.3, 0.15][(c + r * 2) % 6]}"/>`).join('')).join('') + '</svg>',
  table: '<svg viewBox="0 0 40 20" aria-hidden="true"><path d="M2 3h36M2 9h36M2 15h36M14 3v14M27 3v14"/></svg>',
};
const TYPE_ES = { timeseries: 'Time series', stat: 'Stat', gauge: 'Gauge', heatmap: 'Heatmap', table: 'Table' };
const thrCls = (c) => (/rojo/i.test(c) ? 'fire' : /verde/i.test(c) ? 'ok' : /amar|ámbar/i.test(c) ? 'pen' : 'off');
function figDashboard(d) {
  const P = d.panels || [], R = d.rows || [], G = +d.grid_columns || 24;
  P.forEach((p) => { if (p.x + p.w > G) aviso(`dashboard: el panel «${p.title}» se sale de las ${G} columnas`); });
  // un panel no se pisa con otro
  P.forEach((a, i) => P.slice(i + 1).forEach((b) => { if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) aviso(`dashboard: «${a.title}» y «${b.title}» se pisan`); }));
  const num = new Map(P.map((p, i) => [p, i + 1]));
  const thrStrip = (p) => (p.thresholds && p.thresholds.length ? `<span class="db__th">${p.thresholds.map(([v, c]) => `<i class="db--${thrCls(c)}" title="${esc(`${v === 'base' ? 'base' : v}: ${c}`)}"></i>`).join('')}</span>` : '');
  const rowsHtml = R.map((row, ri) => {
    const mine = P.filter((p) => p.row === row.title), h = Math.max(1, ...mine.map((p) => p.y + p.h - row.y));
    if (R[ri + 1] && row.y + h > R[ri + 1].y) aviso(`dashboard: la fila «${row.title}» pisa a la siguiente`);
    return `<div class="db__row"><p class="db__rh"><span aria-hidden="true">▾</span> ${esc(row.title)}</p><div class="db__grid" style="--cols:${G};--rows:${h}">${mine.map((p) => `<div class="db__p db--${esc(p.type)}${p.w <= 6 ? ' db--narrow' : ''}" style="grid-column:${p.x + 1} / span ${p.w};grid-row:${p.y - row.y + 1} / span ${p.h}" title="${esc(`${num.get(p)} · ${p.title}`)}"><span class="db__no">${num.get(p)}</span><span class="db__ic">${PANEL_ICON[p.type] || ''}</span><span class="db__tt">${esc(p.title)}</span>${p.unit ? `<span class="db__u">${esc(p.unit)}</span>` : ''}${thrStrip(p)}</div>`).join('')}</div></div>`;
  }).join('');
  const vars = (d.variables || []).map((v) => `<span class="db__var"><span class="db__vn">${esc(v.name)}</span><span class="db__vv">${v.all ? 'All' : '…'} ▾</span></span>`).join('');
  const frame = `<div class="db" role="img" aria-label="${esc(`Dashboard ${d.title}: ${P.length} paneles en ${R.length} filas, en una grilla de ${G} columnas`)}"><div class="db__bar"><p class="db__title">${esc(d.title)}</p><p class="db__vars">${vars}</p></div>${rowsHtml}</div>`;
  const list = `<ol class="db__list">${P.map((p) => `<li><p class="db__lh"><span class="db__no">${num.get(p)}</span><span class="db__lx"><b>${esc(p.title)}</b><span class="db__lt">${esc(TYPE_ES[p.type] || p.type)}${p.unit ? ` · unit <code>${esc(p.unit)}</code>` : ''}${p.min !== undefined ? ` · de ${fmtN(p.min)} a ${fmtN(p.max)}` : ''}${p.format ? ` · Format: ${esc(p.format)}` : ''}${p.legend ? ` · Legend <code>${esc(p.legend)}</code>` : ''}</span>${p.thresholds ? `<span class="db__lth">${p.thresholds.map(([v, c]) => `<span class="db__tc db--${thrCls(c)}">${v === 'base' ? 'base' : fmtN(v)}: ${esc(c)}</span>`).join('')}</span>` : ''}</span></p>${(p.queries || []).map((q) => stepCode(q, 'promql')).join('')}</li>`).join('')}</ol>`;
  const ann = (d.annotations || []).length ? `<div class="db__ann"><p class="to__h">Anotaciones: marcas verticales en todos los paneles</p><ul>${d.annotations.map((a) => `<li><b>${esc(a.name)}</b> ${stepCode(a.query, 'promql')}</li>`).join('')}</ul></div>` : '';
  const varl = (d.variables || []).length ? `<div class="db__ann"><p class="to__h">Variables: los menús de arriba</p><ul>${d.variables.map((v) => `<li><code>$${esc(v.name)}</code> · ${tx(v.query)}${v.multi ? ' · selección múltiple' : ''}${v.all ? ' · con All' : ''}</li>`).join('')}</ul></div>` : '';
  return `${frame}<p class="db__scale">A escala: ${fmtN(G)} columnas de ancho; cada fila de la grilla, una unidad de alto.</p>${list}<div class="db__g2">${varl}${ann}</div><p class="kleg"><span><i class="sw sw--ok"></i>umbral verde</span><span><i class="sw sw--fire"></i>umbral rojo (pinta; no avisa)</span></p>`;
}

// 10 · El presupuesto de errores: cuánto dura a 1×, 6× y 14.4× (a escala, en días), las alertas de dos ventanas y un
// deploy malo minuto a minuto. La curva es un SVG ancho y angosto; lo demás, HTML.
const burnCls = (b) => (b >= 10 ? 'fire' : b > 1 ? 'pen' : 'ok');
function burnSvg(d, W) {
  const narrow = W < 500, Pd = +d.periodo_h, RT = d.ritmos || [];
  const L = narrow ? 42 : 56, R = narrow ? 12 : 18, Tp = 18, B = 40, H = narrow ? 210 : 230;
  const X = (h) => L + (h / Pd) * (W - L - R), Y = (f) => Tp + (1 - f) * (H - Tp - B);
  let s = '';
  [0, 0.25, 0.5, 0.75, 1].forEach((f) => { s += line(L, Y(f), W - R, Y(f), 'grid'); s += txt(L - 6, Y(f) + 4, `${f * 100} %`, 't', 'end'); });
  for (let dd = 0; dd * 24 <= Pd; dd += 5) { s += line(X(dd * 24), H - B, X(dd * 24), H - B + 4, 'ax'); s += txt(X(dd * 24), H - B + 17, String(dd), 't', 'middle'); }
  s += line(L, H - B, W - R, H - B, 'ax') + txt(W - R, H - 6, 'días del mes', 't', 'end') + txt(6, 11, narrow ? 'queda' : 'presupuesto que queda', 't', 'start');
  RT.forEach((r) => {
    const k = burnCls(r.burn);
    s += path(`M${r1(X(0))},${r1(Y(1))} L${r1(X(r.agota_h))},${r1(Y(0))}`, `s-${k}`, 'stroke-width="2.6"');
    s += dot(X(r.agota_h), Y(0), 4.2, `f-${k}`);
  });
  // solo la línea lenta lleva su rótulo adentro (las rápidas caen juntas cerca del 0: las nombra la lista de al lado)
  const slow = [...RT].sort((a, b) => a.burn - b.burn)[0];
  if (slow && X(slow.agota_h) - X(0) > (W - L - R) * 0.5) { const lab = `${fmtN(slow.burn)}× · ${fmtN(slow.agota_h / 24)} días`; s += txt(X(slow.agota_h) - 6, Y(0.2), lab, `tb ts-${burnCls(slow.burn)}`, 'end'); }
  return { s, H };
}
function figBurn(d) {
  const RT = d.ritmos || [], AL = d.alertas || [], I = d.incidente || {}, Pd = +d.periodo_h, pres = +d.presupuesto;
  RT.forEach((r) => { if (Math.abs(Pd / r.burn - r.agota_h) > 0.6) aviso(`burn: ${r.burn}× agota en ${r.agota_h} h, pero ${Pd} / ${r.burn} = ${r2(Pd / r.burn)}`); });
  const dur = (s) => { const m = String(s).match(/^(\d+(?:\.\d+)?)(m|h|d)$/); return m ? +m[1] * { m: 1 / 60, h: 1, d: 24 }[m[2]] : NaN; };
  AL.forEach((a) => { const g = r2((a.burn * dur(a.larga)) / Pd); if (Math.abs(g - a.gasta) > 0.006) aviso(`burn: ${a.burn}× en ${a.larga} gasta ${g}, pero gasta dice ${a.gasta}`); if (Math.abs(a.burn * pres - a.umbral) > 1e-9) aviso(`burn: umbral de ${a.burn}× no es ${a.burn} × presupuesto`); if (Math.abs(dur(a.larga) / dur(a.corta) - 12) > 0.01) aviso(`burn: la corta de ${a.burn}× no es 1/12 de la larga`); });
  const aria = `Presupuesto de errores: ${RT.map((r) => `a ${r.burn}× se acaba en ${r.agota_h} h`).join('; ')}.`;
  const w = burnSvg(d, 720), nw = burnSvg(d, 340);
  const head = `<p class="bu__h"><span>SLO <b>${fmtN(r2(d.slo * 100))}&nbsp;%</b> en ${fmtN(Pd / 24)} días</span><span>presupuesto <b>${fmtN(r2(pres * 100))}&nbsp;%</b></span>${d.requests_mes ? `<span>de ${fmtN(d.requests_mes)} requests al mes: <b>${fmtN(d.presupuesto_requests)}</b> pueden fallar</span>` : ''}</p>`;
  const rit = `<ul class="bu__rit">${RT.map((r) => `<li class="bu--${burnCls(r.burn)}"><i class="sw sw--${burnCls(r.burn)}"></i>${tx(r.label)}</li>`).join('')}</ul>`;
  const pairs = `<div class="bu__pairs"><p class="to__h">Las alertas de dos ventanas: la larga confirma, la corta (1/12) se apaga rápido</p><ol class="bu__pl">${AL.map((a) => `<li class="bu--${burnCls(a.burn)}"><p class="bu__pt"><span class="bu__x">${fmtN(a.burn)}×</span><span class="sev2 sev2--${sevCls(a.severidad)}">${tx(a.severidad)}</span><span>suena si el error pasa <b>${fmtN(r2(a.umbral * 100))}&nbsp;%</b> en <b>${esc(a.larga)}</b> y en <b>${esc(a.corta)}</b></span></p><p class="bu__wb" aria-hidden="true"><span class="bu__wl"><span>${esc(a.larga)}</span></span><span class="bu__ws"><span>${esc(a.corta)}</span></span></p><p class="bu__g">gasta el <b>${fmtN(r2(a.gasta * 100))}&nbsp;%</b> del presupuesto del mes antes de sonar</p></li>`).join('')}</ol></div>`;
  let inc = '';
  if (I.dura_min) {
    const DS = I.dispara_min || [], AP = I.apaga_tras_arreglo_min || {}, apv = Object.values(AP).map(Number);
    const tEnd = I.dura_min + Math.max(0, ...apv), span = Math.ceil((tEnd * 1.04) / 10) * 10;
    const P = (m) => pct(m / span);
    if (Math.abs(r2((I.burn * I.dura_min) / (Pd * 60)) - r2(I.gastado_total)) > 0.005) aviso('burn: el incidente no gasta gastado_total');
    const tick = []; for (let m = 0; m <= span; m += 20) tick.push(`<span style="left:${P(m)}">${m}</span>`);
    const row = (lab, body, val, cls = '') => `<li class="bu__ir ${cls}"><p class="bu__il">${lab}</p><p class="bu__it">${body}</p><p class="bu__iv">${val}</p></li>`;
    const bar = `<span class="bu__err" style="width:${P(I.dura_min)}"></span><span class="bu__fix" style="left:${P(I.dura_min)}"></span>`;
    const rows = [row(`el deploy malo: ${fmtN(r2(I.tasa_error * 100))}&nbsp;% de errores (${fmtN(I.burn)}×)`, bar, `${fmtN(I.dura_min)}&nbsp;min · gasta ${fmtN(r2(I.gastado_total * 100))}&nbsp;%`, 'bu--inc')];
    DS.forEach((x) => rows.push(row(tx(x.alerta), `${bar}<span class="bu__m bu--${/C01/i.test(x.alerta) ? 'c01' : 'fire'}" style="left:${P(x.min)}"></span>`, `suena a los <b>${fmtN(x.min)}</b>&nbsp;min${x.gastado !== undefined ? ` · ${fmtN(r2(x.gastado * 100))}&nbsp;% gastado` : ''}`)));
    const ap = Object.entries(AP);
    if (ap.length) rows.push(row('la de 14.4× se apaga después del arreglo', `${bar}${ap.map(([k, v], i) => `<span class="bu__m ${i ? 'bu--late' : 'bu--ok'}" style="left:${P(I.dura_min + +v)}"></span>`).join('')}`, ap.map(([k, v]) => `${esc(k)}: <b>+${fmtN(v)}</b>&nbsp;min`).join(' · ')));
    inc = `<div class="bu__inc"><p class="to__h">Un deploy malo, minuto a minuto (a escala, de 0 a ${span} min)</p><ol class="bu__ilist">${rows.join('')}</ol><p class="bu__ax" aria-hidden="true"><span></span><span class="bu__axt">${tick.join('')}</span><span></span></p></div>`;
  }
  return `${head}<div class="bu__a"><div class="bu__ch">${svgFig(720, w.H, w.s, aria, 'fv-w', 900)}${svgFig(340, nw.H, nw.s, aria, 'fv-n', 470)}</div>${rit}</div>${pairs}${inc}
    <p class="kleg"><span><i class="sw sw--ok"></i>1×: dura el mes</span><span><i class="sw sw--pen"></i>6×</span><span><i class="sw sw--fire"></i>14.4× o más: page</span><span><i class="sw sw--c01"></i>el umbral fijo del C01</span><span><i class="sw sw--fix"></i>el arreglo</span></p>`;
}

// 11 · El Prometheus Operator: los objetos que escribes → el Operator → la config generada → Prometheus → los targets, y
// quién le pregunta a Prometheus. Un ServiceMonitor sin la label release queda afuera, sin error.
function figOperator(d) {
  const O = d.objetos || [], Op = d.operator || {}, Pr = d.prometheus || {}, Tg = d.targets || [];
  const kindC = (k) => (/PrometheusRule/.test(k) ? 'rule' : /PodMonitor/.test(k) ? 'pod' : 'svc');
  const objs = `<ul class="op__objs">${O.map((o) => `<li class="op--${kindC(o.kind)}${o.ignorado ? ' op--ign' : ''}"><p class="op__k">${esc(o.kind)}</p><p class="op__nm"><code>${esc(o.nombre)}</code></p><p class="op__lb"><code>${esc(o.label)}</code></p><p class="op__el">${o.ignorado ? '<b aria-hidden="true">✗</b> ' : ''}${tx(o.elige)}</p></li>`).join('')}</ul>`;
  const arrow = (t) => `<p class="op__ar"><span aria-hidden="true">↓</span>${t}</p>`;
  const stage = (n, t, body, cls = '') => `<div class="op__st ${cls}"><p class="op__sh"><span class="op__sn">${n}</span><span>${t}</span></p>${body}</div>`;
  const tg = `<ul class="op__tg">${Tg.map((t) => `<li><code>${esc(t.instance)}</code><span class="op__job">job="${esc(t.job)}"</span><span class="op__up op--${/up/i.test(t.health) ? 'ok' : 'down'}">${esc(String(t.health).toUpperCase())}</span></li>`).join('')}</ul>`;
  const cons = `<ul class="op__cons">${(d.consumidores || []).map((c) => { const [who, rest] = String(c).split(/:\s*/); return `<li><b>${esc(who)}</b>${rest ? `<span>${tx(rest)}</span>` : ''}</li>`; }).join('')}</ul>`;
  return `<div class="op">
    ${stage(1, 'Lo que escribes: objetos en el cluster', objs)}
    ${arrow('el Operator los vigila')}
    ${stage(2, 'El Prometheus Operator', `<p class="op__p"><span class="k">Vigila:</span> ${tx(Op.vigila)}</p><p class="op__p"><span class="k">Elige con:</span> ${String(Op.filtro || '').split(/\s+·\s+/).map((x) => { const m = x.match(/^(.*?)\s+(\([^)]*\))$/); return m ? `<code>${esc(m[1])}</code> ${tx(m[2])}` : `<code>${esc(x)}</code>`; }).join(' · ')}</p>`, 'op--oper')}
    ${arrow('genera la config')}
    ${stage(3, 'Lo que escribe el Operator', `<ul class="op__w">${(Op.escribe || []).map((x) => `<li>${tx(x)}</li>`).join('')}</ul><p class="op__p"><span class="k">Un job por endpoint:</span> ${(d.jobs || []).map((j) => `<code>${esc(j)}</code>`).join(' ')}</p>`)}
    ${arrow(tx(Pr.recarga ? `recarga: ${Pr.recarga}` : 'recarga'))}
    ${stage(4, `Prometheus · <code>${esc(Pr.pod)}</code>`, `<p class="op__p"><span class="k">Service:</span> <code>${esc(Pr.service)}</code></p>`, 'op--prom')}
    <div class="op__two"><div>${arrow('lee cada target (scrape)')}${stage(5, 'Los targets: los pods detrás de cada Service', tg)}</div><div>${arrow('le preguntan con PromQL')}${stage(6, 'Quién lo consulta', cons)}</div></div>
  </div><p class="kleg"><span><i class="sw sw--ok"></i>UP</span><span><i class="sw sw--off"></i>ignorado: sin la label release, el Operator ni lo mira</span></p>`;
}

// 0, 4 y 12 · Cadenas de pasos: de una línea de código al aviso (con quién hace cada paso), la vida de un target en cada
// ronda (antes, durante y después del scrape) y el método de diagnóstico (con lo que hay que mirar en cada eslabón).
const ACTOR = (lab) => (/^(Código|Tu código|\/metrics)$/i.test(lab) ? 'svc' : /^(Alertmanager|Aviso|Receptor)$/i.test(lab) ? 'am' : /Grafana/i.test(lab) ? 'gf' : 'prom');
const ACTOR_L = { svc: 'tu servicio', prom: 'Prometheus', am: 'Alertmanager', gf: 'Grafana' };
function figChain(d, sec) {
  const all = d.steps || [];
  const isBranch = (s) => /aparte/i.test(s.label || '');
  const st = all.filter((s) => !isBranch(s));
  const br = d.branch || all.find(isBranch);
  // grupos: por actor (la cadena del aviso y el diagnóstico) o por fase (el scrape)
  let group;
  if (sec === 'scrape') {
    // la visita es el GET /metrics; lo que viene después (metric_relabel_configs, límites, up, la TSDB) es "después del
    // scrape", como dice el pie de la figura
    const v = st.findIndex((s) => /^Scrape$/i.test(s.label));
    if (v < 0) aviso('scrape: la cadena no tiene un paso «Scrape»');
    group = (i) => (i < v ? 'pre' : i === v ? 'visit' : 'post');
  } else group = (i) => ACTOR(st[i].label);
  const GL = { pre: 'antes del scrape', visit: 'la visita', post: 'después del scrape', ...ACTOR_L };
  const groups = [];
  st.forEach((s, i) => { const g = group(i); if (!groups.length || groups[groups.length - 1].g !== g) groups.push({ g, items: [] }); groups[groups.length - 1].items.push(i); });
  const track = `<div class="ch__tr">${groups.map((G) => `<div class="ch__grp ch--${G.g}"><p class="ch__gl">${G.g === 'visit' ? ICON_NURSE : ''}${esc(GL[G.g] || G.g)}</p><p class="ch__gi">${G.items.map((i) => `<span class="ch__tp"><b>${i + 1}</b>${esc(st[i].label)}</span>`).join('<span class="ch__ta" aria-hidden="true">→</span>')}</p></div>`).join('<span class="ch__ga" aria-hidden="true">→</span>')}${br ? `<div class="ch__grp ch--gf ch--br"><p class="ch__gl">rama aparte</p><p class="ch__gi"><span class="ch__tp"><b>·</b>${esc(String(br.label).replace(/\s*\(aparte\)\s*/i, ''))}</span></p></div>` : ''}</div>`;
  const step = (s, i, k) => `<li class="ch__s ch--${group(i)}" style="--k:${st.length > 1 ? r2(i / (st.length - 1)) : 0}"><span class="ch__no" aria-hidden="true">${k}</span><p class="ch__l">${esc(s.label)}<span class="ch__who">${esc(GL[group(i)] || '')}</span></p>${s.ask ? `<p class="ch__ask">${tx(s.ask)}</p>` : ''}${stepCode(s.cmd, s.tipo)}${s.note ? `<p class="ch__n">${tx(s.note)}</p>` : ''}</li>`;
  const list = `<ol class="ch">${st.map((s, i) => step(s, i, i + 1)).join('')}</ol>`;
  const brHtml = br ? `<div class="ch__br"><p class="ch__l"><span class="ch__bk">rama aparte</span>${esc(String(br.label).replace(/\s*\(aparte\)\s*/i, ''))}</p>${br.ask ? `<p class="ch__ask">${tx(br.ask)}</p>` : ''}${stepCode(br.cmd, br.tipo)}${br.note ? `<p class="ch__n">${tx(br.note)}</p>` : ''}</div>` : '';
  const tipos = [...new Set([...st, ...(br ? [br] : [])].map((s) => s.tipo || cmdTipo(s.cmd || '')))].filter((t) => TIPO_L[t] || t === 'ui');
  const leg = `<p class="kleg">${tipos.map((t) => (t === 'ui' ? `<span>${placeHtml('un lugar')}de la web: se abre, no se copia</span>` : `<span><span class="ktag ktag--${t}">${TIPO_L[t]}</span>${esc(TIPO_T[t])}</span>`)).join('')}</p>`;
  return `${track}${list}${brHtml}${d.rule ? `<p class="callout">${tx(d.rule)}</p>` : ''}${leg}`;
}

// ================================================================ secciones
const ALL = [...W1.sections, ...W2.sections, ...W3.sections];
const byId = Object.fromEntries(ALL.map((x) => [x.id, x]));
// Títulos de los enlaces al curso: el registro real de la app (js/core/registry.js) con los módulos y casos cargados.
const COURSE = (() => {
  const ctx = {}; ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  const scripts = [...readFileSync(join(APP, 'index.html'), 'utf8').matchAll(/<script src="js\/((?:core\/registry|content\/[^"]+)\.js)"><\/script>/g)].map((m) => m[1]);
  for (const f of scripts) { try { vm.runInContext(readFileSync(join(APP, 'js', f), 'utf8'), ctx, { filename: f }); } catch (e) { aviso(`no pude cargar ${f} del curso: ${e.message}`); } }
  return ctx.MSD;
})();
const MODLAB = (m) => (m === 'ref-comandos' ? 'Docker y kubectl' : m === 'ref-numeros' ? 'Números' : m === 'ref-herramientas' ? 'Herramientas' : /^m\d+$/.test(m) ? 'M' + parseInt(m.slice(1), 10) : m.toUpperCase());
function linkChip(anchor) {
  const [m, id] = anchor.replace(/^#/, '').split('.');
  const page = COURSE && COURSE.getPage ? COURSE.getPage(m) : null;
  const sec = page && (page.sections || []).find((x) => x.id === id);
  if (!sec) aviso(`enlace del curso que no existe: ${anchor}`);
  return `<a class="chip" href="https://ronda-diseno-ml.vercel.app/#${esc(anchor.replace(/^#/, ''))}" target="_blank" rel="noopener">${esc(MODLAB(m))} · ${esc(sec ? sec.title : id)}</a>`;
}
// Las hojas hermanas que siguen el mismo tema (el brief pide no contradecirlas: mejor enlazarlas), con la sección exacta.
// Cada ancla se revisa contra la página de esa hoja.
const SHEET_LINKS = {
  bolsillo: [['estimaciones', 'Formulario de estimaciones']],
  cadena: [['recorrido', 'Del dato a producción', 'est-monitoreo', 'la estación de monitoreo']],
  metricas: [['gateway', 'El gateway', 'observabilidad', 'observabilidad']],
  instrumentar: [['gateway', 'El gateway', 'observabilidad', 'observabilidad'], ['triton', 'De PyTorch a Triton', 'medir', 'medir']],
  scrape: [['docker', 'Docker', 'redes', 'redes']],
  promql: [['kubernetes', 'Kubernetes', 'autoscaling', 'autoscaling']],
  histogramas: [['gateway', 'El gateway', 'observabilidad', 'observabilidad']],
  grafana: [['triton', 'De PyTorch a Triton', 'batching', 'batching']],
  kubernetes: [['kubernetes', 'Kubernetes', 'autoscaling', 'autoscaling']],
  diagnostico: [['kubernetes', 'Kubernetes', 'diagnostico', 'diagnóstico']],
};
{
  const sheetsDir = join(HERE, '../..');
  const pages = {};
  for (const [id, , anchor] of Object.values(SHEET_LINKS).flat()) {
    if (!anchor) continue;
    if (!(id in pages)) { try { pages[id] = readFileSync(join(sheetsDir, id, JSON.parse(readFileSync(join(sheetsDir, '..', 'sheets.json'), 'utf8')).find((s) => s.id === id).page), 'utf8'); } catch (e) { pages[id] = ''; } }
    if (!pages[id].includes(`id="${anchor}"`)) aviso(`hoja hermana: ${id} no tiene la sección #${anchor}`);
  }
}
const sheetChip = ([id, t, anchor, sub]) => `<a class="chip chip--sheet" href="https://cheat-sheets-ml.vercel.app/${id}/${anchor ? '#' + anchor : ''}">Hoja · ${esc(t)}${sub ? ` · ${esc(sub)}` : ''}</a>`;

const ORDER = ['bolsillo', 'cadena', 'que-es', 'metricas', 'instrumentar', 'scrape', 'promql', 'histogramas', 'reglas', 'alertmanager', 'grafana', 'slos', 'kubernetes', 'diagnostico', 'errores'];
const EXPECT = [0, null, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
ORDER.forEach((id, i) => { if (!byId[id]) throw new Error('falta la sección ' + id); if (byId[id].num !== EXPECT[i]) throw new Error(`num inesperado en ${id}: ${byId[id].num}`); });
ALL.forEach((x) => { if (!ORDER.includes(x.id)) aviso(`sección de más (no la muestro): ${x.id}`); });
const SECLAB = (id) => { const x = byId[id]; return `${x.num === null ? 'La cadena' : 'Sección ' + x.num} · ${x.title}`; };
const NAVL = { bolsillo: 'Bolsillo', cadena: 'La cadena', 'que-es': '1 · Qué es', metricas: '2 · Métricas', instrumentar: '3 · Instrumentar', scrape: '4 · Scrape', promql: '5 · PromQL', histogramas: '6 · Histogramas', reglas: '7 · Reglas', alertmanager: '8 · Alertmanager', grafana: '9 · Grafana', slos: '10 · SLOs', kubernetes: '11 · Kubernetes', diagnostico: '12 · Diagnóstico', errores: '13 · Errores' };

// Errores: cada mensaje va a su sección según su topic (la tabla del BRIEF).
const TOPIC_SECTION = { conceptos: 'que-es', modelo: 'metricas', cliente: 'instrumentar', scrape: 'scrape', config: 'scrape', promql: 'promql', histograma: 'histogramas', reglas: 'reglas', alertmanager: 'alertmanager', grafana: 'grafana', slo: 'slos', kubernetes: 'kubernetes', operator: 'kubernetes', otro: 'diagnostico' };
const ERRS = W3.errores.map((e) => {
  const sec = TOPIC_SECTION[e.topic];
  if (!sec || !byId[sec]) throw new Error(`errores: topic sin sección: ${e.topic}`);
  if (e.section && e.section !== sec) aviso(`errores: "${e.msg.slice(0, 50)}…" trae section ${e.section}, pero su topic ${e.topic} va a ${sec} (usé ${sec})`);
  return { ...e, sec };
});

function stripLead(s, lead) { return String(s).replace(new RegExp('^' + lead + ':\\s*', 'i'), ''); }
function padHtml(x) {
  const tpls = x.templates.map((t) => `<div class="tpl"><pre class="tpl__code">${phT(t.code)}</pre>${t.note ? `<p class="tpl__note">${phs(rx(t.note))}</p>` : ''}</div>`).join('');
  const f = (x.formulas || []).map(mb).join('');
  const vars = `<table class="vars stk vt"><colgroup><col style="width:30%"><col style="width:38%"><col style="width:32%"></colgroup><thead><tr><th scope="col">Variable</th><th scope="col">Qué es</th><th scope="col">Ejemplo</th></tr></thead><tbody>${x.vars.map(([v, q, e]) => `<tr><th scope="row" class="rh">${/\{/.test(v) ? ph(v) : mi(symTex(v))}</th><td data-k="Qué es">${tx(q)}</td><td class="c" data-k="Ejemplo">${tx(e)}</td></tr>`).join('')}</tbody></table>`;
  return `<div class="pad"><div class="pad__grid${f ? '' : ' nofx'}"><div class="pad__tpl"><p class="tag">Sintaxis con variables</p><div class="tpls">${tpls}</div></div><div class="pad__vars"><p class="tag">Variables</p>${vars}</div>${f ? `<div class="pad__fx"><p class="tag">Fórmulas</p>${f}</div>` : ''}</div></div>`;
}
function piecesHtml(x) {
  return `<div class="card pieces"><h3>Las piezas</h3><table class="vars stk pz"><colgroup><col style="width:29%"><col style="width:41%"><col style="width:30%"></colgroup><thead><tr><th scope="col">Pieza</th><th scope="col">Qué hace</th><th scope="col">Ejemplo</th></tr></thead><tbody>${x.pieces.map(([p, q, e]) => `<tr><th scope="row" class="rh p">${ph(p)}</th><td data-k="Qué hace">${tx(q)}</td><td class="c" data-k="Ejemplo">${tx(e)}</td></tr>`).join('')}</tbody></table></div>`;
}
const tableCls = (head) => (head.length >= 5 ? 'wide5' : head.length >= 4 ? 'wide4' : '');
function tablesHtml(x) {
  return (x.tables || []).map((t) => `<div class="card tbl"><h3>${esc(t.caption)}</h3>${dataTable(t.head, t.rows, { cls: tableCls(t.head), mono: t.head.map((h, j) => (/^Ejemplo$/i.test(h) ? j : -1)).filter((j) => j >= 0) })}${noteP(t.note)}</div>`).join('');
}
// la tabla de bolsillo: la primera columna son campos de la config (monoespaciada)
function figTable(D, id) {
  if (!D.head) throw new Error(`figura table sin head en ${id}`);
  return dataTable(D.head, D.rows, { cls: tableCls(D.head), mono: [0] }) + noteP(D.note);
}
const FIG = { pull: figPull, types: figTypes, series: figSeries, rate: figRate, buckets: figBuckets, 'alert-states': figAlertStates, routing: figRouting, dashboard: figDashboard, burn: figBurn, operator: figOperator, chain: figChain };
function figureHtml(x) {
  const f = x.figure, D = f.data || {};
  let inner;
  if (f.kind === 'table') inner = figTable(D, x.id);
  else if (FIG[f.kind]) inner = FIG[f.kind](D, x.id) + notesList(D.notes) + noteP(D.note);
  else throw new Error('figura desconocida: ' + f.kind);
  return `<figure class="fig fig--${esc(f.kind)}${/<table/.test(inner) ? ' has-table' : ''}">${inner}<figcaption>${esc(f.caption)}</figcaption></figure>`;
}
function quizHtml(x) {
  const first = ERRS[0];
  return `<figure class="fig quiz" id="quiz">
    <div class="quiz__top"><p class="tag">Quiz · un mensaje a la vez</p><p class="quiz__n" id="q-count">Mensaje 1 de ${ERRS.length}</p></div>
    <pre class="term" id="q-msg">${esc(first.msg)}</pre>
    <div class="quiz__btns"><button class="btn primary" id="q-show" type="button">Ver respuesta</button><button class="btn" id="q-next" type="button">Siguiente</button></div>
    <div class="quiz__ans" id="q-ans" hidden></div>
    <figcaption>${esc(x.figure.caption)}</figcaption>
  </figure>
  <div class="card errs" id="errores-lista">
    <h3>Los ${ERRS.length} mensajes</h3>
    <label class="search"><span class="tag">Buscar</span><input type="search" id="err-q" placeholder="Texto del mensaje, causa o comando" autocomplete="off" spellcheck="false"></label>
    <p class="small" id="err-n" aria-live="polite">${ERRS.length} de ${ERRS.length}</p>
    <ol class="errlist">${ERRS.map((e) => `<li data-q="${esc(norm([e.msg, e.meaning, e.first, SECLAB(e.sec)].join(' ')))}"><p class="err__msg"><code>${esc(e.msg)}</code></p><p class="err__m">${tx(e.meaning)}</p><p class="err__f"><span class="k">Primero:</span> ${cmdHtml(e.first)}</p><p class="err__s">→ <a href="#${e.sec}">${esc(SECLAB(e.sec))}</a></p></li>`).join('')}</ol>
    <p class="small errs__none" id="err-none" hidden>Ningún mensaje tiene ese texto. Prueba con una palabra del mensaje (por ejemplo <code>deadline</code> o <code>receiver</code>).</p>
  </div>`;
}
function exampleHtml(x) {
  const e = x.example;
  if (!LANG[e.lang]) aviso(`${x.id}: lenguaje de ejemplo sin resaltado: ${e.lang}`);
  return `<div class="example"><h3>Ejemplo real · ${esc(e.title)}</h3>${codeBlock(e.code, e.lang, null, e.source)}${e.notes && e.notes.length ? `<ul class="ex__notes">${e.notes.map((t) => `<li>${rx(t)}</li>`).join('')}</ul>` : ''}</div>`;
}
const notesHtml = (x) => `<div class="notes"><div class="memo"><p class="tag">Cómo recordarla</p><p>${rx(stripLead(x.memo, 'Cómo recordarla'))}</p></div><div class="trap"><p class="tag">Trampa</p><p>${rx(stripLead(x.trap, 'Trampa'))}</p></div></div>`;
const linksHtml = (x) => {
  const sh = SHEET_LINKS[x.id] || [];
  return (x.links && x.links.length) || sh.length ? `<p class="links"><span class="links__k">En el curso:</span> ${(x.links || []).map(linkChip).join(' ')}${sh.length ? ` ${sh.map(sheetChip).join(' ')}` : ''}</p>` : '';
};
// Nota de un laboratorio probado. Si la nota dice dónde y con qué se corrió ("Ejecutado con Python 3.13.16 y 3.14.3 en
// macOS (Apple M4): …"), eso pasa a la línea estándar y queda el resto. Si no, la nota va entera, sin inventar versiones.
function execLine(l) {
  const t = String(l.verified_note || '').trim();
  if (!t) return { ver: 'Probado de verdad en un Mac.', note: '' };
  const m = t.match(/^(?:Ejecutado|Corrido|Probado)\s+con\s+([^:]+?)\s+en\s+(macOS(?:\s*\([^)]*\))?)\s*[:.]\s*([\s\S]*)$/i);
  if (!m || m[1].length > 90) return { ver: 'Probado de verdad en un Mac.', note: t };
  return { ver: `Probado de verdad en ${m[2]}, con ${m[1]}.`, note: cap(m[3].trim()) };
}
function labHtml(x) {
  const l = x.lab;
  if (!l) {
    if (!x.lab_omitted) return '';
    return `<p class="nolab"><span class="k">Sin laboratorio:</span> ${esc(String(x.lab_omitted).split(/(?<=\.)\s/)[0])}</p>`;
  }
  const steps = l.steps.map((st, i) => `<li>${codeBlock(st.cmd, 'bash', `Paso ${i + 1}`)}<p class="expect"><span class="k">Qué deberías ver:</span> ${tx(st.expect)}</p></li>`).join('');
  let ver, note = String(l.verified_note || '');
  if (l.verified === 'executed') ({ ver, note } = execLine(l));
  else {
    if (l.verified !== 'docs') aviso(`${x.id}: verified raro en el laboratorio: ${l.verified}`);
    ver = 'Verificado contra la documentación; no ejecutado aquí.';
    note = note.replace(/^(?:No ejecutado aquí|No se corrió aquí)(?:\s*\([^)]*\))?[.:;]?\s*/i, '');
    note = note ? cap(note) : '';
  }
  return `<details class="lab"><summary><span class="lab__t">Laboratorio (opcional)</span><span class="lab__n">${l.steps.length} pasos</span></summary><div class="lab__body">
    <p class="lab__goal"><span class="k">Qué vas a provocar:</span> ${tx(l.goal)}</p>
    ${l.needs ? `<p class="lab__needs small"><span class="k">Necesitas:</span> ${tx(l.needs)}</p>` : ''}
    <ol class="lab__steps">${steps}</ol>
    <div class="lab__fix"><p class="tag">Cómo arreglarlo y confirmarlo</p><p>${tx(l.fix)}</p></div>
    <p class="verified">${esc(ver)}${note ? ` <span>${esc(note)}</span>` : ''}</p>
  </div></details>`;
}
function sectionHtml(id) {
  const x = byId[id];
  const num = x.num === null ? '↳' : String(x.num);
  const fig = id === 'errores' ? quizHtml(x) : figureHtml(x);
  return `
<section class="sec" id="${id}">
  <header class="sec__head"><span class="sec__n">${num}</span><div><h2>${esc(x.title)}</h2><p class="sec__q">${esc(x.question)}</p></div></header>
  ${padHtml(x)}
  ${piecesHtml(x)}
  ${fig}
  ${tablesHtml(x)}
  ${exampleHtml(x)}
  ${notesHtml(x)}
  ${linksHtml(x)}
  ${labHtml(x)}
</section>`;
}

// ================================================================ revisor de reglas de alerta (archivos de reglas de Prometheus)
// Las 18 reglas de content-w2.json (revisor[].check), portadas de w2/revisor_check.mjs con la misma semántica: los mismos
// regex, el mismo orden y los mismos textos de detalle (lo prueba un test diferencial contra el original). Corre sobre los
// documentos que devuelve jsyaml.loadAll: un archivo con groups[].rules[] o un PrometheusRule con spec.groups. Es una
// función normal: la página la lleva con toString(). Cada hallazgo trae además gi y ri (el grupo y la regla, por posición)
// para encontrar su línea en el texto.
function revisarReglas(docs, ids) {
  'use strict';
  var MULT = { ms: 0.001, s: 1, m: 60, h: 3600, d: 86400, w: 604800, y: 31536000 };
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function nonEmptyStr(v) { return typeof v === 'string' && v.trim() !== ''; }
  function str(v) { return v === undefined || v === null ? '' : String(v); }
  // E: literales de texto vaciados ("") y comentarios # quitados
  function cleanExpr(expr) {
    var out = '', i = 0, s = str(expr);
    while (i < s.length) {
      var c = s[i];
      if (c === '"' || c === "'" || c === '`') {
        var j = i + 1;
        while (j < s.length && s[j] !== c) { if (s[j] === '\\' && c !== '`') j++; j++; }
        out += '""'; i = j + 1; continue;
      }
      if (c === '#') { while (i < s.length && s[i] !== '\n') i++; continue; }
      out += c; i++;
    }
    return out;
  }
  // la expr cruda sin comentarios (los textos se conservan)
  function noComments(expr) {
    var out = '', i = 0, s = str(expr);
    while (i < s.length) {
      var c = s[i];
      if (c === '"' || c === "'" || c === '`') {
        var j = i + 1;
        while (j < s.length && s[j] !== c) { if (s[j] === '\\' && c !== '`') j++; j++; }
        out += s.slice(i, j + 1); i = j + 1; continue;
      }
      if (c === '#') { while (i < s.length && s[i] !== '\n') i++; continue; }
      out += c; i++;
    }
    return out;
  }
  function durSeconds(v) {
    if (v === undefined || v === null) return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v).trim();
    if (s === '') return null;
    if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
    var re = /(\d+)(ms|s|m|h|d|w|y)/y, total = 0, m, pos = 0;
    while ((m = re.exec(s)) !== null) { total += parseInt(m[1], 10) * MULT[m[2]]; pos = re.lastIndex; }
    if (pos === 0 || pos !== s.length) return null;
    return total;
  }
  function matchParen(s, open) {
    var depth = 0;
    for (var i = open; i < s.length; i++) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') { depth--; if (depth === 0) return i; }
    }
    return -1;
  }
  function aggregations(E) {
    var AGG_RE = /\b(sum|avg|min|max|count|group|stddev|stdvar|topk|bottomk|quantile|count_values|limitk|limit_ratio)\s*(?:(by|without)\s*\(([^)]*)\)\s*)?\(/g;
    var res = [], m;
    while ((m = AGG_RE.exec(E)) !== null) {
      var open = AGG_RE.lastIndex - 1, close = matchParen(E, open);
      if (close < 0) continue;
      var clause = m[2] || null, labels = m[3] !== undefined ? m[3] : null, end = close;
      if (!clause) {
        var after = E.slice(close + 1).match(/^\s*(by|without)\s*\(([^)]*)\)/);
        if (after) { clause = after[1]; labels = after[2]; end = close + after[0].length; }
      }
      res.push({ op: m[1], start: m.index, open: open, close: close, end: end, clause: clause,
        labels: labels === null ? [] : labels.split(',').map(function (x) { return x.trim(); }).filter(Boolean) });
    }
    return res;
  }
  function outermost(spans) {
    return spans.filter(function (a) { return !spans.some(function (b) { return b !== a && b.start <= a.start && b.end >= a.end && (b.start < a.start || b.end > a.end); }); });
  }
  var KEYWORDS = ['by', 'without', 'on', 'ignoring', 'group_left', 'group_right', 'bool', 'offset', 'and', 'or', 'unless', 'atan2', 'start', 'end', 'step', 'range', 'inf', 'nan', 'smoothed', 'anchored'];
  function metricNames(E) {
    var s = E.replace(/\{[^}]*\}/g, ' ').replace(/\[[^\]]*\]/g, ' ').replace(/\b(by|without|on|ignoring|group_left|group_right)\s*\([^)]*\)/g, ' ');
    var names = [], re = /(^|[^a-zA-Z0-9_:.])([a-zA-Z_:][a-zA-Z0-9_:]*)/g, m;
    while ((m = re.exec(s)) !== null) {
      var name = m[2];
      if (/^\s*\(/.test(s.slice(re.lastIndex))) continue;
      if (KEYWORDS.indexOf(name.toLowerCase()) >= 0) continue;
      names.push(name);
    }
    return names;
  }
  function ranges(E) {
    var out = [], re = /\[([^\]]*)\]/g, m;
    while ((m = re.exec(E)) !== null) out.push({ raw: m[1].split(':')[0].trim(), secs: durSeconds(m[1].split(':')[0]) });
    return out;
  }
  function recordedWindows(E) {
    var out = [], re = /[a-zA-Z_:][a-zA-Z0-9_:]*/g, m;
    while ((m = re.exec(E)) !== null) {
      if (m[0].indexOf(':') < 0) continue;
      var last = m[0].split(':').pop(), w = last.match(/(\d+)(ms|s|m|h|d|w|y)$/);
      if (w) out.push(parseInt(w[1], 10) * MULT[w[2]]);
    }
    return out;
  }
  function isWatchdog(E) { return /^\s*vector\s*\(/.test(E); }
  function sevOf(r) { return isObj(r.labels) ? str(r.labels.severity) : ''; }
  function isPage(r) { return /^(page|critical)$/i.test(sevOf(r).trim()); }
  function forSecs(r) {
    if (r.for === undefined || r.for === null || str(r.for).trim() === '') return 0;
    return durSeconds(r.for);
  }
  function uniq(arr) { var o = []; arr.forEach(function (x) { if (o.indexOf(x) < 0) o.push(x); }); return o; }
  // ---------------------------------------------------------------- recolectar
  var all = [], problems = [];
  (docs || []).forEach(function (d, di) {
    if (d === null || d === undefined) return;
    var gs;
    if (isObj(d) && d.kind === 'PrometheusRule') gs = isObj(d.spec) ? d.spec.groups : undefined;
    else if (isObj(d)) gs = d.groups;
    if (!Array.isArray(gs)) { problems.push({ doc: di, detail: 'el documento no tiene groups (o spec.groups en un PrometheusRule)' }); return; }
    var seen = [];
    gs.forEach(function (g, gi) {
      var go = isObj(g) ? g : {}, name = nonEmptyStr(go.name) ? go.name : '';
      if (!name) problems.push({ doc: di, group: gi, gi: gi, detail: 'grupo sin name' });
      else if (seen.indexOf(name) >= 0) problems.push({ doc: di, group: gi, gi: gi, detail: 'name repetido: ' + name });
      seen.push(name);
      if (!Array.isArray(go.rules)) { problems.push({ doc: di, group: gi, gi: gi, detail: 'rules no es una lista' }); return; }
      go.rules.forEach(function (r, ri) { all.push({ doc: di, group: name || '#' + gi, gi: gi, idx: ri, r: isObj(r) ? r : {} }); });
    });
  });
  var alerts = all.filter(function (x) { return nonEmptyStr(x.r.alert); });
  var records = all.filter(function (x) { return nonEmptyStr(x.r.record) && !nonEmptyStr(x.r.alert); });
  // ---------------------------------------------------------------- reglas
  var CHECKS = {
    'estructura': function (push) {
      problems.forEach(function (p) { push(p, p.detail); });
      all.forEach(function (x) {
        var r = x.r, a = nonEmptyStr(r.alert), rec = nonEmptyStr(r.record);
        if (!a && !rec) push(x, 'falta alert o record');
        if (a && rec) push(x, 'alert y record a la vez');
        if (!nonEmptyStr(typeof r.expr === 'number' ? String(r.expr) : r.expr)) push(x, 'falta expr');
        if (rec && !a) ['for', 'keep_firing_for', 'annotations'].forEach(function (k) { if (k in r) push(x, 'campo de alerta en una regla de grabación: ' + k); });
      });
    },
    'alerta-sin-comparacion': function (push) {
      alerts.forEach(function (x) {
        var E = cleanExpr(x.r.expr);
        if (E.trim() === '') return; // sin expr: lo reporta estructura
        if (isWatchdog(E) || /\babsent(_over_time)?\s*\(/.test(E) || /\b(and|unless)\b/.test(E)) return;
        var s = E.replace(/\{[^}]*\}/g, ' '), re = /(==|!=|>=|<=|>|<)/g, m, total = 0, withBool = 0;
        while ((m = re.exec(s)) !== null) { total++; if (/^\s*bool\b/.test(s.slice(re.lastIndex))) withBool++; }
        if (total === 0) push(x, 'sin comparación');
        else if (total === withBool) push(x, 'todas las comparaciones llevan bool');
      });
    },
    'alerta-sin-for': function (push) {
      alerts.forEach(function (x) {
        var f = forSecs(x.r);
        if (f !== 0) return;
        var E = cleanExpr(x.r.expr);
        if (isWatchdog(E)) return;
        if (/\band\b/.test(E)) {
          var ws = uniq(ranges(E).map(function (r) { return r.secs; }).filter(function (v) { return v !== null; }).concat(recordedWindows(E)));
          if (ws.length >= 2) return;
        }
        push(x, 'sin for (0s)');
      });
    },
    'sin-severity': function (push) {
      alerts.forEach(function (x) { if (sevOf(x.r).trim() === '') push(x, 'sin labels.severity'); });
    },
    'sin-anotaciones': function (push) {
      alerts.forEach(function (x) {
        var an = isObj(x.r.annotations) ? x.r.annotations : {}, miss = [];
        if (!nonEmptyStr(str(an.summary))) miss.push('summary');
        if (!nonEmptyStr(str(an.description))) miss.push('description');
        if (isPage(x.r) && !nonEmptyStr(str(an.runbook_url))) miss.push('runbook_url');
        if (miss.length) push(x, 'falta ' + miss.join(', '));
      });
    },
    'etiqueta-perdida': function (push) {
      alerts.forEach(function (x) {
        var texts = [];
        [x.r.annotations, x.r.labels].forEach(function (o) { if (isObj(o)) Object.keys(o).forEach(function (k) { texts.push(str(o[k])); }); });
        var refs = [];
        texts.forEach(function (t) {
          var re1 = /\$labels\.([a-zA-Z_][a-zA-Z0-9_]*)/g, re2 = /index\s+\$labels\s+"([^"]+)"/g, m;
          while ((m = re1.exec(t)) !== null) if (refs.indexOf(m[1]) < 0) refs.push(m[1]);
          while ((m = re2.exec(t)) !== null) if (refs.indexOf(m[1]) < 0) refs.push(m[1]);
        });
        if (!refs.length) return;
        var E = cleanExpr(x.r.expr), aggs = aggregations(E);
        if (!aggs.length) return;
        var outer = outermost(aggs);
        if (outer.some(function (a) { return a.clause === 'without' || ['topk', 'bottomk', 'count_values', 'limitk', 'limit_ratio'].indexOf(a.op) >= 0; })) return;
        var rest = '', pos = 0;
        outer.slice().sort(function (a, b) { return a.start - b.start; }).forEach(function (a) { rest += E.slice(pos, a.start) + ' 0 '; pos = a.end + 1; });
        rest += E.slice(pos);
        if (metricNames(rest).length) return;
        var avail = [];
        outer.forEach(function (a) { if (a.clause === 'by') a.labels.forEach(function (l) { if (avail.indexOf(l) < 0) avail.push(l); }); });
        if (/\bhistogram_quantile\s*\(/.test(E)) avail = avail.filter(function (l) { return l !== 'le'; });
        refs.filter(function (l) { return avail.indexOf(l) < 0; }).forEach(function (l) { push(x, '$labels.' + l + ' no queda después de la agregación'); });
      });
    },
    'rate-sobre-gauge': function (push) {
      all.forEach(function (x) {
        var E = cleanExpr(x.r.expr);
        var native = /\bhistogram_(quantile|count|sum|avg|fraction|stddev|stdvar)\s*\(/.test(E);
        var re = /\b(rate|irate|increase)\s*\(\s*([a-zA-Z_:][a-zA-Z0-9_:]*)\s*(\{[^}]*\})?\s*\[/g, m, seen = [];
        while ((m = re.exec(E)) !== null) {
          var n = m[2], bad;
          if (n === 'nv_inference_pending_request_count') bad = true;
          else if (/_(total|count|sum|bucket)$/.test(n)) bad = false;
          else if (n.indexOf('nv_inference_') === 0 || n.indexOf('nv_cache_') === 0 || n === 'nv_energy_consumption') bad = false;
          else if (native) bad = false;
          else bad = true;
          if (bad && seen.indexOf(n) < 0) { seen.push(n); push(x, m[1] + '(' + n + '[…])'); }
        }
      });
    },
    'ventana-corta': function (push) {
      all.forEach(function (x) {
        var seen = [];
        ranges(cleanExpr(x.r.expr)).forEach(function (r) {
          if (r.secs !== null && r.secs < 60 && seen.indexOf(r.raw) < 0) { seen.push(r.raw); push(x, '[' + r.raw + ']'); }
        });
      });
    },
    'quantile-sin-le': function (push) {
      all.forEach(function (x) {
        var E = cleanExpr(x.r.expr), re = /\bhistogram_quantile\s*\(/g, m;
        while ((m = re.exec(E)) !== null) {
          var open = re.lastIndex - 1, close = matchParen(E, open);
          if (close < 0) continue;
          var args = E.slice(open + 1, close), depth = 0, comma = -1;
          for (var i = 0; i < args.length; i++) {
            if (args[i] === '(') depth++; else if (args[i] === ')') depth--; else if (args[i] === ',' && depth === 0) { comma = i; break; }
          }
          var vec = comma >= 0 ? args.slice(comma + 1) : args;
          if (!/[a-zA-Z0-9_:]_bucket\b/.test(vec)) continue;
          var bad = aggregations(vec).filter(function (a) { return ['topk', 'bottomk', 'limitk', 'limit_ratio', 'count_values'].indexOf(a.op) < 0; })
            .filter(function (a) { return !a.clause || (a.clause === 'by' && a.labels.indexOf('le') < 0) || (a.clause === 'without' && a.labels.indexOf('le') >= 0); });
          if (bad.length) push(x, bad.map(function (a) { return a.op + (a.clause ? ' ' + a.clause + ' (' + a.labels.join(', ') + ')' : ''); }).join('; '));
        }
      });
    },
    'promedio-de-percentiles': function (push) {
      all.forEach(function (x) {
        var E = cleanExpr(x.r.expr);
        function hit(inner) { return /\bhistogram_quantile\s*\(/.test(inner) || /\{[^}]*\bquantile\s*=~?/.test(inner); }
        var found = false;
        aggregations(E).filter(function (a) { return a.op === 'avg'; }).forEach(function (a) { if (hit(E.slice(a.open + 1, a.close))) found = true; });
        var re = /\bavg_over_time\s*\(/g, m;
        while ((m = re.exec(E)) !== null) {
          var open = re.lastIndex - 1, close = matchParen(E, open);
          if (close > 0 && hit(E.slice(open + 1, close))) found = true;
        }
        if (found) push(x, 'avg de un percentil');
      });
    },
    'irate-en-alerta': function (push) {
      alerts.forEach(function (x) { if (/\birate\s*\(/.test(cleanExpr(x.r.expr))) push(x, 'irate('); });
    },
    'division-sin-proteccion': function (push) {
      records.forEach(function (x) {
        var E = cleanExpr(x.r.expr).replace(/\[[^\]]*\]/g, '[]'), unprotected = false;
        for (var i = 0; i < E.length; i++) {
          if (E[i] !== '/' || E[i - 1] === '<' || E[i - 1] === '>') continue;
          var j = i + 1;
          for (;;) {
            var mm = E.slice(j).match(/^\s*(bool\b|(on|ignoring)\s*\([^)]*\)|group_(left|right)\b(\s*\([^)]*\))?)/);
            if (!mm) break;
            j += mm[0].length;
          }
          var rest = E.slice(j).replace(/^\s+/, ''), off = E.length - rest.length, operand;
          if (rest.charAt(0) === '(') operand = E.slice(off, matchParen(E, off) + 1);
          else {
            var depth = 0, k = 0;
            for (; k < rest.length; k++) {
              var c = rest[k];
              if (c === '(' || c === '{' || c === '[') depth++;
              else if (c === ')' || c === '}' || c === ']') { if (depth === 0) break; depth--; }
              else if (depth === 0 && /[+\-*/%^<>=!]/.test(c) && k > 0) break;
              else if (depth === 0 && /^\s(and|or|unless)\b/.test(rest.slice(k))) break;
            }
            operand = rest.slice(0, k);
          }
          var protectedOp = /^\s*[0-9.]/.test(operand) || /\bclamp(_min)?\s*\(/.test(operand) || /(>=?|!=)\s*[0-9.]/.test(operand);
          if (!protectedOp) unprotected = true;
        }
        if (unprotected) push(x, 'denominador sin > 0 ni clamp_min');
      });
    },
    'nombre-recording': function (push) {
      records.forEach(function (x) {
        var name = str(x.r.record);
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*:[a-zA-Z_][a-zA-Z0-9_]*:[a-zA-Z0-9_]+$/.test(name)) { push(x, name + ' no es nivel:métrica:operaciones'); return; }
        var w = name.split(':')[2].match(/(\d+)(ms|s|m|h|d|w|y)$/);
        if (!w) return;
        var secs = parseInt(w[1], 10) * MULT[w[2]];
        var rs = ranges(cleanExpr(x.r.expr)).map(function (r) { return r.secs; }).filter(function (v) { return v !== null; });
        if (rs.length && rs.indexOf(secs) < 0) push(x, 'el nombre dice ' + w[0] + ' y la expr usa [' + ranges(cleanExpr(x.r.expr)).map(function (r) { return r.raw; }).join('], [') + ']');
      });
    },
    'umbral-en-ms': function (push) {
      alerts.forEach(function (x) {
        var E = cleanExpr(x.r.expr), re = /\bhistogram_quantile\s*\(/g, m;
        while ((m = re.exec(E)) !== null) {
          var open = re.lastIndex - 1, close = matchParen(E, open);
          if (close < 0 || !/_seconds_bucket\b/.test(E.slice(open, close))) continue;
          var after = E.slice(close + 1).match(/^\s*(>=|<=|>|<)\s*([0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?)/);
          if (after && parseFloat(after[2]) >= 50) push(x, 'histogram_quantile(…) ' + after[1] + ' ' + after[2]);
        }
      });
    },
    'for-largo-en-page': function (push) {
      alerts.forEach(function (x) {
        var f = forSecs(x.r);
        if (isPage(x.r) && f !== null && f > 1800) push(x, 'for: ' + String(x.r.for) + ' con severity ' + sevOf(x.r));
      });
    },
    'instancia-fija': function (push) {
      alerts.forEach(function (x) {
        var raw = noComments(x.r.expr), re = /(?:^|[{,\s])(instance|pod|node)\s*=\s*("([^"]*)"|'([^']*)'|`([^`]*)`)/g, m;
        while ((m = re.exec(raw)) !== null) {
          var val = m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : m[5] !== undefined ? m[5] : '';
          if (val !== '') push(x, m[1] + '="' + val + '"');
        }
      });
    },
    'up-sin-absent': function (push) {
      var hasAbsent = alerts.some(function (x) { return /\babsent(_over_time)?\s*\(\s*up\b/.test(cleanExpr(x.r.expr)); });
      if (hasAbsent) return;
      alerts.forEach(function (x) { if (/\bup\s*(\{[^}]*\})?\s*(==\s*0|<\s*1)(?![0-9.])/.test(cleanExpr(x.r.expr))) push(x, 'up == 0 sin absent(up{…})'); });
    },
    'causa-no-sintoma': function (push) {
      var RES = /^(node_cpu_seconds_total|node_load(1|5|15)|node_memory_\w+|node_filesystem_\w+|node_disk_\w+|container_cpu_\w+|container_memory_\w+|container_fs_\w+|nv_gpu_\w+|nv_cpu_\w+|DCGM_FI_\w+|process_cpu_seconds_total|process_resident_memory_bytes|machine_cpu_cores|machine_memory_bytes)$/;
      alerts.forEach(function (x) {
        if (!isPage(x.r)) return;
        var names = metricNames(cleanExpr(x.r.expr));
        if (names.length && names.every(function (n) { return RES.test(n); })) push(x, 'solo recursos: ' + uniq(names).join(', '));
      });
    }
  };
  var out = [];
  (ids || Object.keys(CHECKS)).forEach(function (id) {
    if (!CHECKS[id]) return;
    CHECKS[id](function (x, detail) {
      out.push({ id: id, doc: x.doc, group: x.group, rule: x.r ? (x.r.alert || x.r.record || '#' + x.idx) : undefined, detail: detail, gi: x.gi, ri: x.idx });
    });
  });
  return out;
}
// La línea de cada hallazgo en el texto (js-yaml no da posiciones): parte el texto en documentos (---), busca groups: y
// recorre sus listas por sangría: el ítem del grupo gi y, adentro de su rules:, el ítem de la regla ri (la línea de su
// alert: o record: si la tiene). Sin estructura en bloque (groups: [ … ] en una línea), la línea del documento.
function ubicarReglas(src, docs) {
  'use strict';
  var L = String(src).replace(/\r\n?/g, '\n').split('\n');
  function content(s) { return !!s.trim() && !/^\s*#/.test(s); }
  function ind(s) { return s.match(/^ */)[0].length; }
  // documentos con contenido, en orden (como los no nulos de loadAll)
  var ranges = [], cur = null;
  for (var i = 0; i <= L.length; i++) {
    var ln = i < L.length ? L[i] : '---';
    if (/^(---|\.\.\.)(\s|$)/.test(ln)) {
      if (cur && cur.first >= 0) { cur.end = i; ranges.push(cur); }
      cur = { start: i + 1, first: -1 };
      if (/^---\s+\S/.test(ln) && !/^---\s+#/.test(ln)) cur.first = i;
      continue;
    }
    if (!cur) cur = { start: 0, first: -1 };
    if (cur.first < 0 && content(ln)) cur.first = i;
  }
  var real = [];
  (docs || []).forEach(function (d, di) { if (d !== null && d !== undefined) real.push(di); });
  function rangeOf(di) { var k = real.indexOf(di); return k >= 0 && ranges.length === real.length ? ranges[k] : (ranges.length === 1 ? ranges[0] : null); }
  // los ítems de la lista en bloque que es el valor de la clave de la línea keyLine
  function items(keyLine, keyInd, end) {
    var out = [], li = -1, stop = end;
    for (var i = keyLine + 1; i < end; i++) {
      if (!content(L[i])) continue;
      var n = ind(L[i]), dash = /^\s*-(\s|$)/.test(L[i]);
      if (li < 0) { if (!dash || n < keyInd) return { lines: out, end: i }; li = n; }
      if (n < li || (n === li && !dash)) { stop = i; break; }
      if (n === li) out.push(i);
    }
    return { lines: out, end: stop };
  }
  function keyCol(line, next) { var m = /^(\s*-\s+)\S/.exec(L[line]); return m ? m[1].length : (next !== undefined && next >= 0 ? ind(L[next]) : ind(L[line]) + 2); }
  // la clave en la columna col (con o sin el "- " del ítem adelante)
  function findKey(re, a, b, col) { for (var i = a; i < b; i++) { if (!content(L[i])) continue; var m = re.exec(L[i]); if (m && m[1].length === col) return i; } return -1; }
  var cache = {};
  function structure(r) {
    var key = r.start + ':' + r.end;
    if (cache[key]) return cache[key];
    var g = -1, gInd = 0;
    for (var i = r.start; i < r.end; i++) { var m = /^(\s*)groups\s*:\s*(#.*)?$/.exec(L[i]); if (m) { g = i; gInd = m[1].length; break; } }
    var groups = [];
    if (g >= 0) {
      var gs = items(g, gInd, r.end);
      gs.lines.forEach(function (gl, k) {
        var ge = k + 1 < gs.lines.length ? gs.lines[k + 1] : gs.end, nx = -1;
        for (var j = gl + 1; j < ge; j++) if (content(L[j])) { nx = j; break; }
        var col = keyCol(gl, nx), rl = findKey(/^(\s*(?:-\s+)?)rules\s*:\s*(#.*)?$/, gl, ge, col), rules = [];
        if (rl >= 0) {
          var rs = items(rl, col, ge);
          rules = rs.lines.map(function (il, q) {
            var ie = q + 1 < rs.lines.length ? rs.lines[q + 1] : rs.end;
            for (var j = il; j < ie; j++) if (/^\s*(?:-\s+)?(alert|record)\s*:/.test(L[j])) return j;
            return il;
          });
        }
        groups.push({ line: gl, rules: rules });
      });
    }
    return (cache[key] = { first: r.first, groups: groups });
  }
  return function (f) {
    var r = rangeOf(f.doc);
    if (!r) return null;
    var s = structure(r), g = f.gi !== undefined ? s.groups[f.gi] : null;
    if (g && f.ri !== undefined && g.rules[f.ri] !== undefined) return g.rules[f.ri] + 1;
    if (g) return g.line + 1;
    return s.first >= 0 ? s.first + 1 : null;
  };
}
const REVISOR_SRC = `${revisarReglas.toString()}\n${ubicarReglas.toString()}`;
const RULE_IDS = [...revisarReglas.toString().matchAll(/^ {4}'([a-z0-9-]+)': function/gm)].map((m) => m[1]);
const RULES = W2.revisor;
{
  const ids = RULES.map((r) => r.id);
  ids.filter((id) => !RULE_IDS.includes(id)).forEach((id) => aviso(`revisor: la regla ${id} del contenido no tiene implementación; el revisor la salta`));
  RULE_IDS.filter((id) => !ids.includes(id)).forEach((id) => aviso(`revisor: la regla ${id} está implementada pero el contenido ya no la trae`));
  RULES.forEach((r) => { if (!['error', 'warn', 'info'].includes(r.severity)) aviso(`revisor: severidad rara en ${r.id}: ${r.severity}`); });
}

// Un archivo de reglas del C01 con errores típicos: cada regla del revisor dispara una vez, por un error distinto.
const BAD_EXAMPLE = `# EJEMPLO con problemas a propósito: es para probar el revisor, no lo copies
groups:
  - name: classifier-recording
    rules:
      - record: classifier_error_ratio
        expr: |
          sum(rate(classifier_requests_total{status=~"5.."}[5m]))
            / sum(rate(classifier_requests_total[5m]))
        for: 5m

  - name: classifier-alerts
    rules:
      - alert: ClassifierHighP99Latency
        expr: |
          histogram_quantile(0.99,
            sum by (le) (rate(classifier_request_latency_seconds_bucket[5m]))
          ) > 200
        for: 1h
        labels:
          severity: page
        annotations:
          summary: "p99 del clasificador sobre 200 ms"
          description: "p99 = {{ $value | humanizeDuration }} (SLO 200 ms)."

      - alert: ClassifierP99PorPod
        expr: |
          avg(histogram_quantile(0.99,
            sum by (source) (rate(classifier_request_latency_seconds_bucket[5m]))
          )) > 0.2
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "p99 sobre 200 ms en el pod {{ $labels.pod }}"
          description: "p99 = {{ $value | humanizeDuration }}."

      - alert: ClassifierHigh5xxRate
        expr: |
          sum(irate(classifier_requests_total{status=~"5.."}[30s]))
            / sum(rate(classifier_requests_total{status!~"4.."}[30s])) > 0.01
        labels:
          severity: page
        annotations:
          summary: "Más de 1 % de 5xx en /v1/classify"
          description: "Tasa de 5xx = {{ $value | humanizePercentage }}."
          runbook_url: "https://runbooks.example.com/classifier/high-5xx-rate"

      - alert: TritonPendingHigh
        expr: rate(nv_inference_pending_request_count{model="classifier"}[5m]) > 10
        for: 10m
        annotations:
          summary: "Muchos requests esperando en Triton"
          description: "Pendientes = {{ $value }}."

      - alert: GPUSaturated
        expr: nv_gpu_utilization{instance="10.0.3.17:8002"}
        for: 15m
        labels:
          severity: page
        annotations:
          summary: "GPU {{ $labels.gpu_uuid }} saturada"
          description: "Utilización = {{ $value | humanizePercentage }}."
          runbook_url: "https://runbooks.example.com/classifier/gpu-saturated"

      - alert: GatewayScrapeDown
        expr: up{job="gateway"} == 0
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Prometheus no puede leer un pod del gateway"
          description: "{{ $labels.instance }} no responde al scrape."
`;
const C01_ALERTS = (() => { const t = readFileSync(join(C01, 'monitoring/alerts.yml'), 'utf8'); return t.endsWith('\n') ? t : t + '\n'; })();
const SAMPLES = {
  bad: { text: BAD_EXAMPLE, label: 'EJEMPLO con problemas a propósito: bórralo y pega tus reglas', cls: '' },
  c01: { text: C01_ALERTS, label: 'C01 · monitoring/alerts.yml (el archivo real)', cls: 'ok' },
};

// ================================================================ herramientas
function toolsHtml() {
  const D = W3.diagnosticador;
  D.forEach((g) => { if (g.causes.length < 2 || g.causes.length > 4) aviso(`diagnosticador: "${g.symptom}" tiene ${g.causes.length} causas (2–4 es lo esperado)`); });
  const panels = D.map((g) => `<div class="dg-panel" data-dg="${esc(g.id)}" hidden>
      <p class="dg-sym">${esc(g.symptom)}</p>
      <div class="dg-first"><p class="tag">${isPlaceOnly(g.first) ? 'Mira primero' : 'Corre primero'}</p><p>${cmdHtml(g.first)}</p></div>
      <ol class="dg-causes">${g.causes.map((c) => `<li><p class="dg-cause">${tx(c.cause)}</p><p class="dg-row"><span class="k">Compruébalo:</span> ${cmdHtml(c.check)}</p><p class="dg-row"><span class="k">Arreglo:</span> ${tx(c.fix)}</p></li>`).join('')}</ol>
    </div>`).join('');
  return `
<section class="sec tools" id="herramientas">
  <header class="sec__head"><span class="sec__n">⚙</span><div><h2>Herramientas</h2><p class="sec__q">Del síntoma al primer comando (o a la pantalla que hay que abrir), y una revisión rápida de tus reglas de alerta antes de cargarlas.</p></div></header>
  <div class="card tool" id="diagnosticador">
    <h3>Diagnosticador</h3>
    <p class="small">Elige lo que ves. Te dice qué mirar primero y las causas típicas, cada una con cómo comprobarla y cómo arreglarla. Los comandos se copian; un lugar de la web, como ${placeHtml('Status → Target health')}, se abre en Prometheus o en Grafana.</p>
    <div class="dg-chips" role="group" aria-label="Síntomas">${D.map((g) => `<button class="dg-chip" type="button" aria-pressed="false" data-dg="${esc(g.id)}">${esc(g.symptom)}</button>`).join('')}</div>
    <label class="dg-pick"><span class="tag">Síntoma</span><select id="dg-select"><option value="">Elige un síntoma…</option>${D.map((g) => `<option value="${esc(g.id)}">${esc(g.symptom)}</option>`).join('')}</select></label>
    <p class="small dg-empty" id="dg-empty">Elige un síntoma para ver las causas.</p>
    <div class="dg-panels">${panels}</div>
  </div>
  <div class="card tool" id="revisor">
    <h3>Revisor de reglas de alerta</h3>
    <p class="small">Pega un archivo de reglas de Prometheus (el YAML con <code>groups:</code> que carga <code>rule_files</code>) o un PrometheusRule (las mismas reglas bajo <code>spec.groups</code>). Revisa ${RULES.length} reglas típicas en tu navegador: alertas sin <code>for</code>, sin <code>severity</code> o sin el texto para quien la recibe, <code>rate()</code> sobre un gauge, ventanas de menos de 4 scrapes, <code>histogram_quantile</code> sin <code>le</code> o promediado, umbrales en milisegundos, alertas atadas a un pod, divisiones sin proteger y nombres fuera de la convención. Cada hallazgo dice el grupo, la regla y la línea.</p>
    <p class="small">No reemplaza a <code>promtool check rules</code>: no valida el PromQL ni las plantillas. Mira lo que promtool deja pasar y después duele.</p>
    <label class="rv-label" for="rv-text" id="rv-label">${esc(SAMPLES.bad.label)}</label>
    <textarea id="rv-text" rows="18" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off">${esc(BAD_EXAMPLE)}</textarea>
    <div class="rv-btns"><button class="btn primary" id="rv-run" type="button">Revisar</button><button class="btn" id="rv-bad" type="button">Ejemplo con problemas</button><button class="btn" id="rv-c01" type="button">C01 · alerts.yml</button><button class="btn" id="rv-clear" type="button">Vaciar</button></div>
    <div class="rv-out" id="rv-out" aria-live="polite"></div>
    <p class="small rv-note">Lee el YAML con js-yaml (de cdnjs): después de la primera visita queda guardado y funciona sin conexión.</p>
  </div>
</section>`;
}

// ================================================================ CSS
const TOKENS_LIGHT = `--bg: #f4f6f9; --paper: #ffffff; --ink: #18212d; --muted: #5a6575; --rule: #d6dde6; --grid: rgba(31, 95, 174, 0.075);
  --accent: #1f5fae; --accent-soft: rgba(31, 95, 174, 0.14); --accent2: #0f7a6e; --accent2-soft: rgba(15, 122, 110, 0.32);
  --hi: #d99a12; --hi-soft: #fff1cc; --warn: #b5482c; --warn-soft: #fbe8e2; --free: #e7ecf2; --onbar: #ffffff;
  --code-bg: #f6f8fb; --syn-kw: #1f5fae; --syn-str: #7a4fb8; --syn-com: #5a6575; --syn-dec: #0f7a6e; --syn-num: #8a5a00; --ok-soft: rgba(15, 122, 110, 0.13); --hi-ink: #8a5a00; --var-bg: rgba(31, 95, 174, 0.09); --on-hi: #18212d;
  --cnt: #1f5fae; --cnt-soft: rgba(31, 95, 174, 0.12); --gau: #0f7a6e; --gau-soft: rgba(15, 122, 110, 0.13); --his: #7a4fb8; --his-soft: rgba(122, 79, 184, 0.2);
  --okc: #2a7a36; --okc-soft: rgba(42, 122, 54, 0.12); --pen: #d99a12; --pen-soft: #fff1cc; --pen-ink: #8a5a00; --fire: #b5482c; --fire-soft: #fbe8e2; --off: #7b8594;`;
const TOKENS_DARK = `--bg: #0e131a; --paper: #151c26; --ink: #e5ecf4; --muted: #9aa7b7; --rule: #2a3544; --grid: rgba(125, 175, 240, 0.085);
  --accent: #7db1ff; --accent-soft: rgba(125, 177, 255, 0.18); --accent2: #4fcfbf; --accent2-soft: rgba(79, 207, 191, 0.32);
  --hi: #f2c14e; --hi-soft: #3a2e10; --warn: #ff8b6e; --warn-soft: #3b1f18; --free: #1d2632; --onbar: #0e131a;
  --code-bg: #10161f; --syn-kw: #7db1ff; --syn-str: #c7b0f5; --syn-com: #9aa7b7; --syn-dec: #4fcfbf; --syn-num: #f2c14e; --ok-soft: rgba(79, 207, 191, 0.14); --hi-ink: #f2c14e; --var-bg: rgba(125, 177, 255, 0.13); --on-hi: #0e131a;
  --cnt: #7db1ff; --cnt-soft: rgba(125, 177, 255, 0.14); --gau: #4fcfbf; --gau-soft: rgba(79, 207, 191, 0.15); --his: #c7b0f5; --his-soft: rgba(199, 176, 245, 0.24);
  --okc: #7fd18b; --okc-soft: rgba(127, 209, 139, 0.14); --pen: #f2c14e; --pen-soft: #3a2e10; --pen-ink: #f2c14e; --fire: #ff8b6e; --fire-soft: #3b1f18; --off: #8592a3; color-scheme: dark;`;
const CSS = `
/* El diseño de las hojas de Docker, Kubernetes, Git, Triton y el gateway: papel cuadriculado para la sintaxis, tinta
   azul, resaltador ámbar. Colores de las figuras (uno por idea): azul = counter (el odómetro), verde azulado = gauge (el
   medidor de gasolina), violeta = histogram (los cajones), verde = ok, up, inactive o resuelta, ámbar = pending o
   espera, rojo = firing, down o una cuenta que miente, gris = silenciada, inhibida o ignorada. */
:root {
  ${TOKENS_LIGHT}
  --f-display: "Archivo", "Helvetica Neue", Arial, sans-serif; --f-body: "Source Serif 4", Georgia, "Times New Roman", serif;
  --f-mono: "JetBrains Mono", ui-monospace, Menlo, monospace; --f-math: "STIX Two Math", "Cambria Math", "Latin Modern Math", math, serif;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  ${TOKENS_DARK} } }
:root[data-theme="dark"] {
  ${TOKENS_DARK} }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; overflow-wrap: break-word; background: var(--bg); color: var(--ink); font: 17px/1.6 var(--f-body); padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); padding-block: 0 48px; }
.wrap { max-width: 1120px; margin: 0 auto; }
h1, h2, h3, .tag, legend { font-family: var(--f-display); text-wrap: balance; }
a { color: var(--accent); }
.hero { padding-block: 40px 22px; display: grid; gap: 10px; }
.hero .kicker { font: 600 12.5px/1.3 var(--f-display); letter-spacing: .14em; text-transform: uppercase; color: var(--accent); margin: 0; }
.hero h1 { font-size: clamp(32px, 6vw, 54px); line-height: 1.04; margin: 0; font-weight: 800; font-stretch: 112%; letter-spacing: -0.01em; }
.hero p.lead { max-width: 70ch; margin: 0; color: var(--muted); font-size: 18px; }
.legendrow { display: flex; flex-wrap: wrap; gap: 8px 18px; font: 500 13px/1.4 var(--f-display); color: var(--muted); margin: 6px 0 0; }
.legendrow span { display: inline-flex; align-items: center; gap: 6px; }
.legendrow .lgk { font-weight: 700; color: var(--ink); }
.legendrow .ui { flex-wrap: nowrap; white-space: nowrap; }
.dot { width: 12px; height: 12px; border-radius: 3px; display: inline-block; flex: none; }
nav.toc { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 5; background: var(--bg); border-bottom: 1px solid var(--rule); margin-bottom: 8px; }
nav.toc ul { position: relative; list-style: none; display: flex; gap: 6px; overflow-x: auto; margin: 0; padding: 10px 0; scrollbar-width: thin; }
nav.toc a { display: inline-block; white-space: nowrap; padding: 6px 11px; border-radius: 999px; border: 1px solid var(--rule); background: var(--paper); color: var(--ink); text-decoration: none; font: 600 13px/1 var(--f-display); }
nav.toc a:hover, nav.toc a:focus-visible { border-color: var(--accent); color: var(--accent); outline: none; }
nav.toc a[aria-current="true"] { background: var(--accent); border-color: var(--accent); color: var(--paper); }
.sec { padding-block: 34px 10px; border-top: 1px solid var(--rule); scroll-margin-top: 64px; }
.tool { scroll-margin-top: 70px; }
.sec__head { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 18px; }
.sec__n { flex: none; min-width: 46px; height: 46px; padding: 0 6px; border-radius: 10px; display: grid; place-items: center; background: var(--accent); color: var(--paper); font: 800 22px/1 var(--f-display); }
.sec h2 { margin: 0; font-size: clamp(24px, 3.4vw, 32px); line-height: 1.1; font-weight: 800; font-stretch: 108%; }
.sec__q { margin: 4px 0 0; color: var(--muted); }
.pad__grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-template-areas: "tpl vars" "fx fx"; gap: 14px 28px; align-items: start; }
.pad__grid.nofx { grid-template-areas: "tpl vars"; }
.pad__tpl { grid-area: tpl; min-width: 0; } .pad__vars { grid-area: vars; min-width: 0; } .pad__fx { grid-area: fx; min-width: 0; border-top: 1px dashed var(--rule); padding-top: 10px; }
@media (max-width: 920px) { .pad__grid, .pad__grid.nofx { grid-template-columns: minmax(0, 1fr); grid-template-areas: "tpl" "fx" "vars"; } }
.pad .vars { margin-top: 2px; }
.pieces { margin-top: 16px; }
.pad { min-width: 0; background-color: var(--paper); background-image: linear-gradient(var(--grid) 1px, transparent 1px), linear-gradient(90deg, var(--grid) 1px, transparent 1px); background-size: 18px 18px; border: 1px solid var(--rule); border-radius: 12px; padding: 16px 18px; }
.tpls { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
.tpl__code { margin: 0; font: 600 14px/1.6 var(--f-mono); color: var(--ink); white-space: pre-wrap; overflow-wrap: anywhere; }
.nb { white-space: nowrap; }
.tpl__note { margin: 3px 0 0; font-size: 14.5px; line-height: 1.5; color: var(--muted); }
var.ph { font-family: var(--f-body); font-style: italic; font-weight: 600; font-size: 1.08em; letter-spacing: 0; color: var(--accent); background: var(--var-bg); border-radius: 4px; padding: 0 3px; }
var.ph--alt i { font-style: normal; font-weight: 400; color: var(--muted); padding: 0 4px; }
.mb { overflow-x: auto; overflow-y: hidden; padding: 6px 2px; }
.mb math { font-family: var(--f-math); font-size: 1.22em; display: inline math; }
.mi math { font-family: var(--f-math); font-size: 1.08em; }
.vars { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 14.5px; background: var(--paper); table-layout: fixed; }
.vars th, .dt th { text-align: left; font: 700 11.5px/1.3 var(--f-display); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); border-bottom: 1px solid var(--rule); padding: 6px; vertical-align: bottom; }
.vars td, .vars th.rh { border-bottom: 1px solid var(--rule); padding: 6px; vertical-align: top; overflow-wrap: anywhere; }
.vars th.rh { font: 400 14.5px/1.5 var(--f-body); letter-spacing: 0; text-transform: none; color: var(--ink); }
.vars th.rh.p { font: 600 13px/1.5 var(--f-mono); }
.vars td.c { font: 600 13px/1.5 var(--f-mono); color: var(--accent2); }
.card { background: var(--paper); border: 1px solid var(--rule); border-radius: 12px; padding: 14px 16px; min-width: 0; }
.card > h3, .example > h3 { margin: 0 0 6px; font-size: 15px; letter-spacing: .1em; text-transform: uppercase; color: var(--accent); }
.card.tbl { margin-top: 16px; }
.pieces .vars { margin-top: 4px; }
figure.fig { min-width: 0; margin: 18px 0 0; background: var(--paper); border: 1px solid var(--rule); border-radius: 12px; padding: 14px; }
figure.fig figcaption { color: var(--muted); font-size: 14.5px; margin-top: 12px; }
svg.chart { width: 100%; height: auto; display: block; margin: 0 auto; }
.tblw { margin-top: 12px; }
.dt { width: 100%; border-collapse: collapse; font-size: 14.5px; line-height: 1.45; }
.dt td, .dt th.rh { border-bottom: 1px solid var(--rule); padding: 7px 8px 7px 6px; vertical-align: top; overflow-wrap: anywhere; text-align: left; }
.dt th.rh { font: 600 14px/1.45 var(--f-display); letter-spacing: 0; text-transform: none; color: var(--ink); overflow-wrap: break-word; }
.dt .mono, .dt th.rh.mono { font: 600 13px/1.5 var(--f-mono); overflow-wrap: anywhere; }
.dt td.cmdc .cmdw { display: inline-flex; }
.dt td.nil { color: var(--muted); }
.fig__note { color: var(--muted); font-size: 14.5px; margin: 10px 0 0; }
.fig__notes { margin: 10px 0 0; padding-left: 20px; color: var(--muted); font-size: 14.5px; }
.cmdw { display: inline-flex; align-items: baseline; gap: 6px; max-width: 100%; min-width: 0; }
code, code.cmd { font: 13.5px var(--f-mono); background: var(--free); padding: 1px 5px; border-radius: 4px; overflow-wrap: anywhere; }
code, pre, .cmd, var.ph { font-variant-ligatures: none; font-feature-settings: "liga" 0, "calt" 0; }
.cmdn { color: var(--muted); }
.sep { color: var(--muted); }
p.cc { margin: 6px 0 0; }
p.cc .cmdw { display: inline-flex; }
button.cp { flex: none; font: 600 11.5px/1 var(--f-display); letter-spacing: .02em; color: var(--accent); background: var(--paper); border: 1px solid var(--rule); border-radius: 6px; padding: 4px 7px; cursor: pointer; }
button.cp:hover, button.cp:focus-visible { border-color: var(--accent); outline: none; }
/* un lugar de la web (Status → Target health): se abre, no se copia */
.ui { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 1px 4px; max-width: 100%; vertical-align: baseline; font: 600 13px/1.35 var(--f-display); color: var(--ink); background: var(--paper); border: 1.5px solid var(--accent); border-radius: 7px; padding: 1px 8px 1px 5px; }
.ui__ic { width: 15px; height: 15px; flex: none; fill: none; stroke: var(--accent); stroke-width: 1.3; stroke-linejoin: round; }
.ui__ic .ui__ptr { fill: var(--accent); stroke: var(--paper); stroke-width: .8; }
.ui__home { font: 800 10px/1.3 var(--f-display); letter-spacing: .06em; text-transform: uppercase; color: var(--accent); }
.ui__a { color: var(--muted); font-weight: 800; }
/* qué es cada código de una cadena: dónde se escribe */
.ktag { flex: none; align-self: center; font: 700 10px/1.4 var(--f-display); letter-spacing: .05em; text-transform: uppercase; border-radius: 4px; padding: 1px 5px; border: 1px solid var(--rule); color: var(--muted); background: var(--paper); white-space: nowrap; }
.ktag--shell { color: var(--ink); border-color: var(--ink); } .ktag--promql { color: var(--accent); border-color: var(--accent); } .ktag--python { color: var(--accent2); border-color: var(--accent2); }
.qb { display: block; margin-top: 2px; min-width: 0; border: 1px solid var(--rule); border-radius: 8px; background: var(--code-bg); }
.qb__bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 3px 4px 3px 6px; border-bottom: 1px solid var(--rule); }
.qb code.cmd { display: block; background: none; border-radius: 0; padding: 5px 9px 6px; font-size: 12.5px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
.code { margin-top: 10px; background: var(--code-bg); border: 1px solid var(--rule); border-radius: 10px; min-width: 0; }
.code__bar { display: flex; align-items: center; gap: 10px; padding: 6px 8px 6px 12px; border-bottom: 1px solid var(--rule); font: 600 12px/1.3 var(--f-display); color: var(--muted); }
.code__lang { text-transform: uppercase; letter-spacing: .08em; flex: none; }
.code__src { flex: 1; min-width: 0; font-weight: 500; overflow-wrap: anywhere; }
.code__bar .cp { margin-left: auto; }
.code pre { margin: 0; padding: 12px 14px; overflow-x: auto; font: 13px/1.55 var(--f-mono); color: var(--ink); tab-size: 4; }
.code pre code { font: inherit; background: none; padding: 0; overflow-wrap: normal; }
.tk-k { color: var(--syn-kw); font-weight: 700; } .tk-f { color: var(--syn-kw); } .tk-s { color: var(--syn-str); } .tk-c { color: var(--syn-com); font-style: italic; } .tk-p { color: var(--muted); user-select: none; } .tk-d { color: var(--syn-dec); font-weight: 700; } .tk-n { color: var(--syn-num); }
.example { margin-top: 20px; }
ul.ex__notes { margin: 12px 0 0; padding-left: 20px; columns: 2 380px; column-gap: 34px; font-size: 15.5px; line-height: 1.5; }
ul.ex__notes li { break-inside: avoid; margin-bottom: 6px; }
.notes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 16px; }
@media (max-width: 720px) { .notes { grid-template-columns: minmax(0, 1fr); } }
.memo, .trap { border-radius: 10px; padding: 12px 16px; min-width: 0; }
.memo { background: var(--hi-soft); } .trap { background: var(--warn-soft); }
.memo p, .trap p { margin: 0; }
.tag { font-size: 11.5px !important; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; margin: 0 0 4px !important; color: var(--muted); }
.memo .tag { color: var(--hi-ink); } .trap .tag { color: var(--warn); }
.small { font-size: 14.5px; color: var(--muted); }
.k { font: 700 12.5px var(--f-display); color: var(--muted); letter-spacing: .02em; }
.links { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin: 16px 0 0; font: 500 13px/1.35 var(--f-display); }
.links__k { color: var(--muted); font-weight: 700; }
.links .chip { border: 1px solid var(--rule); background: var(--paper); border-radius: 999px; padding: 4px 10px; color: var(--ink); text-decoration: none; }
.links .chip--sheet { border-color: var(--accent); color: var(--accent); }
.links a.chip:hover, .links a.chip:focus-visible { border-color: var(--accent); color: var(--accent); }
details.lab { margin-top: 14px; border: 1px solid var(--rule); border-radius: 12px; background: var(--paper); }
details.lab > summary { cursor: pointer; list-style: none; display: flex; align-items: center; gap: 10px; padding: 11px 14px; font: 700 14px/1.3 var(--f-display); color: var(--ink); }
details.lab > summary::-webkit-details-marker { display: none; }
details.lab > summary::before { content: "▸"; color: var(--accent); transition: transform .15s; }
details.lab[open] > summary::before { transform: rotate(90deg); }
.lab__n { margin-left: auto; color: var(--muted); font-weight: 500; font-size: 13px; flex: none; }
.lab__body { padding: 0 14px 14px; border-top: 1px solid var(--rule); }
.lab__goal { margin: 12px 0 4px; }
ol.lab__steps { list-style: none; margin: 8px 0 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
ol.lab__steps > li { min-width: 0; }
.expect { margin: 6px 0 0; font-size: 15px; line-height: 1.5; }
.lab__fix { margin-top: 12px; background: var(--ok-soft); border-radius: 10px; padding: 10px 14px; }
.lab__fix .tag { color: var(--accent2); }
.lab__fix p { margin: 0; font-size: 15px; }
.verified { margin: 10px 0 0; font: 500 12.5px/1.45 var(--f-display); color: var(--muted); }
.verified span { display: block; margin-top: 2px; font-weight: 400; }
p.nolab { margin: 14px 0 0; font: 500 13.5px/1.4 var(--f-display); color: var(--muted); }
.btn { font: 600 14px/1.2 var(--f-display); color: var(--ink); background: var(--paper); border: 1px solid var(--rule); border-radius: 8px; padding: 8px 12px; cursor: pointer; }
.btn:hover, .btn:focus-visible { border-color: var(--accent); color: var(--accent); outline: none; }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--paper); }
.btn.primary:hover, .btn.primary:focus-visible { color: var(--paper); outline: 2px solid var(--accent); outline-offset: 2px; }
.btn:disabled { opacity: .55; cursor: default; }
.quiz__top { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 4px 12px; }
.quiz__n { margin: 0; font: 600 13px var(--f-display); color: var(--muted); }
pre.term { margin: 8px 0 0; padding: 14px 16px; border-radius: 10px; background: var(--code-bg); border: 1px solid var(--rule); font: 600 14px/1.55 var(--f-mono); color: var(--ink); white-space: pre-wrap; overflow-wrap: anywhere; }
.quiz__btns { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.quiz__ans { margin-top: 12px; border-top: 1px solid var(--rule); padding-top: 10px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; }
.quiz__ans p { margin: 0; }
.errs { margin-top: 14px; }
.search { display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px; margin-top: 6px; }
.search input, .dg-pick select { width: 100%; font: 500 15px var(--f-display); color: var(--ink); background: var(--bg); border: 1px solid var(--rule); border-radius: 8px; padding: 8px 10px; }
.search input:focus-visible, .dg-pick select:focus-visible, #rv-text:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
ol.errlist { list-style: none; margin: 8px 0 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 0; }
ol.errlist li { border-top: 1px solid var(--rule); padding: 10px 0; }
ol.errlist p { margin: 0; }
.err__msg code { font-weight: 600; background: none; padding: 0; }
.err__m { font-size: 15.5px; margin-top: 2px !important; }
.err__f, .err__s { font-size: 14.5px; margin-top: 4px !important; }
.err__s a, .quiz__ans a { font: 600 13.5px var(--f-display); }
.errs__none { margin: 8px 0 0; }
.tools .tool { margin-top: 14px; }
.tool > h3 { font-size: 16px; }
.dg-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.dg-chip { font: 500 14px/1.35 var(--f-display); text-align: left; color: var(--ink); background: var(--bg); border: 1px solid var(--rule); border-radius: 10px; padding: 8px 11px; cursor: pointer; max-width: 100%; }
.dg-chip:hover, .dg-chip:focus-visible { border-color: var(--accent); outline: none; }
.dg-chip[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--paper); }
.dg-pick { display: none; grid-template-columns: minmax(0, 1fr); gap: 4px; margin-top: 10px; }
@media (max-width: 640px) {
  .dg-chips { display: none; } .dg-pick { display: grid; }
  /* en el celular, cada comando (o lugar) en su renglón: el " · " entre dos quedaba solo en una línea */
  .dg-row .sep, .dg-first .sep, .err__f .sep, .quiz__ans .sep, p.cc .sep { display: none; }
  .dg-row .cmdw, .dg-first .cmdw, .err__f .cmdw, .quiz__ans .cmdw, p.cc .cmdw, .dg-row .ui, .dg-first .ui, .err__f .ui, .quiz__ans .ui { display: flex; width: fit-content; margin: 4px 0 2px; }
}
.dg-empty { margin: 12px 0 0; }
.dg-panel { margin-top: 14px; border-top: 1px solid var(--rule); padding-top: 12px; }
.dg-sym { margin: 0 0 8px; font: 700 17px/1.35 var(--f-display); }
.dg-first p { margin: 0; }
ol.dg-causes { margin: 12px 0 0; padding-left: 22px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
ol.dg-causes li::marker { font: 700 14px var(--f-display); color: var(--muted); }
.dg-cause { margin: 0; font-weight: 600; }
.dg-row { margin: 3px 0 0; font-size: 15px; }
.rv-label { display: block; margin-top: 12px; font: 700 12.5px/1.3 var(--f-display); letter-spacing: .06em; text-transform: uppercase; color: var(--warn); }
.rv-label.ok { color: var(--accent2); } .rv-label.mine { color: var(--muted); }
#rv-text { display: block; width: 100%; margin-top: 6px; min-height: 300px; font: 13px/1.55 var(--f-mono); color: var(--ink); background: var(--code-bg); border: 1px solid var(--rule); border-radius: 10px; padding: 10px 12px; resize: vertical; white-space: pre; overflow: auto; tab-size: 2; }
.rv-btns { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.rv-out { margin-top: 12px; }
.rv-sum { margin: 0 0 4px; font: 600 15px var(--f-display); }
.rv-objs { margin: 0 0 10px; font-size: 14px; color: var(--muted); }
ol.rv-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; }
ol.rv-list li { border: 1px solid var(--rule); border-left-width: 4px; border-radius: 8px; padding: 8px 12px; min-width: 0; }
ol.rv-list li.sev-error { border-left-color: var(--warn); } ol.rv-list li.sev-warn { border-left-color: var(--hi); } ol.rv-list li.sev-info { border-left-color: var(--accent); }
ol.rv-list p { margin: 3px 0 0; font-size: 15px; }
.rv-h { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; }
.rv-msg { font-weight: 600; }
p.rv-obj { font: 500 13.5px/1.45 var(--f-display); color: var(--muted); }
p.rv-obj code { font-size: 12.5px; }
p.rv-det code { font-size: 12.5px; color: var(--ink); }
.rv-ln { font: 700 12.5px/1.2 var(--f-display); color: var(--accent); background: var(--paper); border: 1px solid var(--rule); border-radius: 999px; padding: 2px 8px; cursor: pointer; }
.rv-ln:hover, .rv-ln:focus-visible { border-color: var(--accent); outline: none; }
.sev { flex: none; font: 700 11px/1 var(--f-display); letter-spacing: .08em; text-transform: uppercase; border-radius: 999px; padding: 4px 8px; }
.sev.error { background: var(--warn); color: var(--onbar); } .sev.warn { background: var(--hi-soft); color: var(--hi-ink); border: 1px solid var(--hi); } .sev.info { background: var(--accent-soft); color: var(--accent); }
.rv-err { border: 1px solid var(--warn); background: var(--warn-soft); border-radius: 10px; padding: 10px 14px; }
.rv-err p { margin: 4px 0 0; }
.rv-err__t { font: 700 16px/1.3 var(--f-display); color: var(--warn); margin: 0 !important; }
pre.rv-err__snip { margin: 8px 0 0; padding: 8px 10px; border-radius: 8px; background: var(--paper); border: 1px solid var(--rule); font: 12.5px/1.5 var(--f-mono); white-space: pre-wrap; overflow-wrap: anywhere; }
.rv-note { margin: 10px 0 0; }
footer { margin-top: 30px; color: var(--muted); font-size: 14px; border-top: 1px solid var(--rule); padding-top: 14px; }
/* ---------- piezas comunes de las figuras */
.kleg { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 10px 0 0; font: 500 13px/1.4 var(--f-display); color: var(--muted); }
.kleg > span { display: inline-flex; align-items: center; gap: 6px; }
.kleg code { font-size: 12px; }
.sw { display: inline-block; flex: none; width: 16px; height: 12px; border-radius: 3px; font-style: normal; }
.sw--cnt { background: var(--cnt); } .sw--gau { background: var(--gau); } .sw--his { background: var(--his); } .sw--hisoft { background: var(--his-soft); border: 1px solid var(--his); }
.sw--ok { background: var(--okc); } .sw--pen { background: var(--pen); } .sw--fire { background: var(--fire); } .sw--off { background: var(--off); } .sw--prom { background: var(--ink); }
.sw--win { background: var(--free); border: 1px solid var(--rule); } .sw--ghost { height: 0; border-top: 2px dashed var(--cnt); border-radius: 0; }
.sw--sent { width: 14px; height: 14px; border-radius: 50%; border: 1.5px solid var(--rule); } .sw--none { width: 14px; height: 14px; border-radius: 50%; border: 1.5px dashed var(--rule); }
.sw--rline { width: 0; height: 14px; border-left: 2px dashed var(--ink); border-radius: 0; } .sw--tick { background: none; border: 1.5px solid var(--ink); }
.sw--c01 { width: 12px; height: 12px; border-radius: 50%; background: var(--ink); } .sw--fix { width: 0; height: 14px; border-left: 3px solid var(--okc); border-radius: 0; }
.callout { margin: 12px 0 0; padding: 8px 12px; border-left: 4px solid var(--ink); background: var(--free); border-radius: 0 8px 8px 0; font: 700 14.5px/1.4 var(--f-display); }
.to__h { margin: 0 0 6px; font: 800 12px/1.3 var(--f-display); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.ic { width: 22px; height: 22px; flex: none; fill: var(--ink); stroke: var(--ink); stroke-width: 1.3; stroke-linecap: round; stroke-linejoin: round; }
.ic .ic__l { fill: none; stroke-width: 1.7; }
.ic .ic__cap { fill: var(--paper); stroke-width: 1.2; }
.tag2 { flex: none; font: 800 10px/1.4 var(--f-display); letter-spacing: .06em; text-transform: uppercase; border-radius: 999px; padding: 1px 7px; border: 1.5px solid var(--c); color: var(--c); white-space: nowrap; }
.tag2--cnt { --c: var(--cnt); } .tag2--gau { --c: var(--gau); } .tag2--his { --c: var(--his); } .tag2--off { --c: var(--off); }
.sev2 { flex: none; font: 800 10.5px/1.3 var(--f-display); text-transform: uppercase; letter-spacing: .05em; border-radius: 999px; padding: 1px 7px; color: var(--onbar); white-space: nowrap; }
.sev2--fire { background: var(--fire); } .sev2--pen { background: var(--pen); color: var(--on-hi); } .sev2--tick { background: none; color: var(--ink); box-shadow: inset 0 0 0 1.5px var(--ink); }
ol.kev { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; font-size: 14.5px; line-height: 1.45; }
ol.kev li { display: grid; grid-template-columns: 22px 68px minmax(0, 1fr); gap: 8px; align-items: baseline; }
.kev__n { width: 22px; height: 22px; border-radius: 50%; display: inline-grid; place-items: center; background: var(--ink); color: var(--paper); font: 800 11.5px/1 var(--f-display); }
.kev__n--fire { background: var(--fire); color: var(--onbar); } .kev__n--ok { background: var(--okc); color: var(--onbar); }
.kev__t { font: 700 12.5px/1.4 var(--f-mono); color: var(--muted); }
/* SVG: textos, trazos y rellenos (un color por idea) */
svg .t { fill: var(--muted); font: 12px var(--f-display); } svg .tm { fill: var(--ink); font: 12px var(--f-display); } svg .tb { font-weight: 700; }
svg .tv { fill: var(--ink); font: 600 10.5px var(--f-mono); } svg .tnum { fill: var(--paper); font: 800 11.5px var(--f-display); }
svg .tw { fill: var(--fire); font: 12.5px var(--f-display); } svg .tc { fill: var(--cnt); font: 12.5px var(--f-display); } svg .tg { fill: var(--gau); font: 12px var(--f-display); }
svg .th { fill: var(--his); font: 12px var(--f-display); } svg .tp { fill: var(--pen-ink); font: 12px var(--f-display); }
svg .ts-ok { fill: var(--okc); font-size: 12px; font-family: var(--f-display); } svg .ts-pen { fill: var(--pen-ink); font-size: 12px; font-family: var(--f-display); } svg .ts-fire { fill: var(--fire); font-size: 12px; font-family: var(--f-display); }
svg .grid { stroke: var(--rule); stroke-width: 1; } svg .ax { stroke: var(--muted); stroke-width: 1; }
svg .s-cnt { stroke: var(--cnt); } svg .s-gau { stroke: var(--gau); } svg .s-his { stroke: var(--his); } svg .s-his2 { stroke: var(--his); stroke-width: 2.4; } svg .s-fire { stroke: var(--fire); } svg .s-ok { stroke: var(--okc); stroke-width: 1.4; } svg .s-pen { stroke: var(--pen); stroke-width: 1.4; } svg .s-ink { stroke: var(--ink); } svg .s-muted { stroke: var(--muted); }
svg .f-cnt { fill: var(--cnt); } svg .f-gau { fill: var(--gau); } svg .f-his { fill: var(--his); } svg .f-fire { fill: var(--fire); } svg .f-ok { fill: var(--okc); } svg .f-pen { fill: var(--pen); } svg .f-ink { fill: var(--ink); } svg .f-paper { fill: var(--paper); }
svg .f-win { fill: var(--free); } svg .f-hissoft { fill: var(--his-soft); opacity: .6; } svg .f-ok-soft { fill: var(--okc-soft); } svg .f-pen-soft { fill: var(--pen-soft); } svg .f-fire-soft { fill: var(--fire-soft); }
svg .o-out { opacity: .4; } svg .ring-gau { fill: none; stroke: var(--gau); stroke-width: 1.6; }
svg .l-avg { stroke: var(--gau); stroke-width: 1.4; stroke-dasharray: 5 3; } svg .l-now { stroke: var(--ink); stroke-width: 1.3; stroke-dasharray: 2 3; }
svg .l-rate { stroke: var(--cnt); stroke-width: 3; } svg .l-naive { stroke: var(--fire); stroke-width: 2.6; stroke-dasharray: 7 4; }
svg .l-his { stroke: var(--his); stroke-width: 2.6; } svg .l-guide { stroke: var(--ink); stroke-width: 1.2; stroke-dasharray: 4 3; }
svg .l-th { stroke: var(--fire); stroke-width: 1.4; stroke-dasharray: 6 4; } svg .l-ev { stroke: var(--muted); stroke-width: 1; stroke-dasharray: 1 3; }
svg.chart.fv-n { display: none; }
@media (max-width: 679px) { svg.chart.fv-w { display: none; } svg.chart.fv-n { display: block; } }
/* ---------- 1 · pull contra push (la ronda) */
.pl { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr); gap: 14px; align-items: start; }
@media (max-width: 860px) { .pl { grid-template-columns: minmax(0, 1fr); } }
.pl__side { border: 1px solid var(--rule); border-radius: 12px; padding: 10px 12px; min-width: 0; }
.pl--pull { border: 2px solid var(--ink); }
.pl--push { border: 1.5px dashed var(--muted); }
.pl__h { margin: 0; display: flex; align-items: center; gap: 8px; font: 600 15px/1.3 var(--f-display); }
.pl__h .ic { width: 30px; height: 30px; }
.pl__who { margin: 6px 0 0; font-size: 14.5px; line-height: 1.45; }
.pl__who code { font-size: 12.5px; }
.pl__g { display: grid; grid-template-columns: minmax(0, 1fr) repeat(var(--n), 24px); gap: 7px 5px; align-items: center; margin-top: 10px; }
.pl__gh { margin: 0; align-self: end; font: 800 10.5px/1.25 var(--f-display); letter-spacing: .05em; text-transform: uppercase; color: var(--muted); }
.pl__gt { align-self: end; font: 600 11px/1 var(--f-mono); color: var(--muted); text-align: center; }
.pl__t { margin: 0; min-width: 0; }
.pl__t b { display: block; font: 700 13.5px/1.3 var(--f-display); }
.pl__t--down b { color: var(--fire); }
.pl__ep { display: flex; flex-wrap: wrap; gap: 0 6px; }
.pl__ep code { font-size: 11.5px; background: none; padding: 0; color: var(--muted); }
.pl__job { font: 600 11px/1.4 var(--f-mono); color: var(--muted); }
.pl__c { width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; font: 800 12.5px/1 var(--f-display); }
.pl--up { background: var(--okc); color: var(--onbar); } .pl--down { background: var(--fire); color: var(--onbar); }
.pl--sent { border: 1.5px solid var(--rule); color: var(--muted); font-family: var(--f-display); } .pl--none { border: 1.5px dashed var(--rule); }
.pl__dir { margin: 10px 0 0; display: flex; flex-wrap: wrap; gap: 2px 14px; font: 600 12.5px/1.4 var(--f-display); color: var(--muted); }
.pl__ar b { color: var(--ink); }
.pl__nt { margin: 8px 0 0; font-size: 14px; line-height: 1.45; }
.pl__weak { margin: 8px 0 0; padding: 6px 10px; border-left: 4px solid var(--fire); background: var(--fire-soft); border-radius: 0 8px 8px 0; font-size: 14px; line-height: 1.45; }
/* ---------- 2 · los tres tipos */
.ty { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: 12px; }
.ty__c { --c: var(--ink); border: 1px solid var(--rule); border-top: 4px solid var(--c); border-radius: 12px; padding: 10px 12px; min-width: 0; }
.ty--cnt { --c: var(--cnt); } .ty--gau { --c: var(--gau); } .ty--his { --c: var(--his); }
.ty__h { margin: 0; display: flex; align-items: center; gap: 8px; font: 500 14px/1.3 var(--f-display); }
.ty__h b { color: var(--c); font-weight: 800; }
.ty__h .ic { width: 30px; height: 30px; fill: var(--c); stroke: var(--c); }
.ty__m { margin: 4px 0 4px; line-height: 1.35; } .ty__m code { font-size: 12px; }
.ty__mx { font: 500 12.5px/1.35 var(--f-display); color: var(--muted); }
svg.ty__svg { max-width: 440px; }
.ty__odo { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin: 6px 0 0; font-size: 13px; }
.odo { font: 700 14px/1 var(--f-mono); letter-spacing: .14em; background: var(--ink); color: var(--paper); border-radius: 4px; padding: 4px 4px 4px 6px; }
.odo--new { background: var(--fire); color: var(--onbar); }
.ty__odn { color: var(--muted); font: 600 12.5px var(--f-display); }
ul.ty__r { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 4px; }
.ty__r li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 8px; font-size: 13.5px; line-height: 1.4; }
.ty__r li code { font-size: 12px; }
.ty__r li b { font: 800 14px var(--f-mono); }
.ty__r li > span:last-child { color: var(--muted); font-size: 12.5px; }
.ty__r li.ok b { color: var(--c); } .ty__r li.bad b, .ty__r .ty__x { color: var(--fire); font-weight: 700; }
.ty__x { font: 700 12.5px var(--f-display); }
.ty__n { margin: 8px 0 0; font-size: 13.5px; line-height: 1.45; color: var(--muted); }
ol.ty__bk { list-style: none; margin: 6px 0 0; padding: 0; display: grid; gap: 3px; position: relative; --le: 82px; --bv: 46px; }
.ty__bk li { display: grid; grid-template-columns: var(--le) minmax(0, 1fr) var(--bv); align-items: center; }
.ty__le { font: 600 11px var(--f-mono); color: var(--muted); text-align: right; padding-right: 6px; white-space: nowrap; }
.ty__bt { position: relative; height: 13px; background: var(--free); border-radius: 3px; overflow: hidden; }
.ty__bp { position: absolute; left: 0; top: 0; bottom: 0; background: var(--his-soft); }
.ty__bn { position: absolute; top: 0; bottom: 0; background: var(--his); }
.ty__bv { font: 700 11.5px var(--f-mono); text-align: right; }
.ty__inf .ty__le { color: var(--ink); font-weight: 800; }
.ty__sum { margin: 6px 0 0; display: flex; flex-wrap: wrap; gap: 2px 12px; font-size: 13px; } .ty__sum code { font-size: 12px; } .ty__sum b { font-family: var(--f-mono); }
.ty__sm { margin: 12px 0 0; padding: 8px 12px; border: 1.5px dashed var(--muted); border-radius: 10px; font-size: 14px; line-height: 1.45; }
/* ---------- 3 · series y cardinalidad */
.se__tree { border: 1px solid var(--rule); border-radius: 12px; padding: 10px 12px; }
.se__root { margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; }
.se__root code { font: 700 13px var(--f-mono); background: none; padding: 0; }
.se__lab { margin: 6px 0 0; font-size: 14px; } .se__lab code { font-size: 12.5px; }
ul.se__kids { list-style: none; margin: 8px 0 0; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
@media (max-width: 680px) { ul.se__kids { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.se__kids li { border: 1.5px solid var(--his); border-radius: 10px; padding: 6px 8px; min-width: 0; }
.se__kids p { margin: 0; }
.se__v code { font-size: 11.5px; background: none; padding: 0; }
.se__sq { margin-top: 6px !important; display: grid; grid-template-columns: repeat(5, 12px); gap: 3px; }
.sq { display: inline-block; flex: none; width: 12px; height: 12px; border-radius: 2px; }
.sq--b { background: var(--his); } .sq--inf { background: var(--his); box-shadow: inset 0 0 0 2.5px var(--ink); } .sq--x { background: var(--his-soft); box-shadow: inset 0 0 0 1px var(--his); }
.se__n { margin-top: 4px !important; font: 700 12px var(--f-mono); }
.se__tot { margin: 8px 0 0; font: 500 14px/1.4 var(--f-display); } .se__tot b { font-family: var(--f-mono); }
.se__key { margin: 6px 0 0; display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 12.5px; color: var(--muted); }
.se__key span { display: inline-flex; align-items: center; gap: 5px; } .se__key code { font-size: 11.5px; }
.se__g { margin-top: 14px; display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 16px; align-items: start; }
@media (max-width: 860px) { .se__g { grid-template-columns: minmax(0, 1fr); } }
ol.se__rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.se__rows li { --c: var(--off); min-width: 0; }
.se--cnt { --c: var(--cnt) !important; } .se--his { --c: var(--his) !important; } .se--gau { --c: var(--gau) !important; }
.se__rows p { margin: 0; }
.se__mn { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; }
.se__mn code { font: 700 12px var(--f-mono); background: none; padding: 0; }
.se__ml { margin-top: 1px !important; font-size: 12.5px; color: var(--muted); }
.se__b { margin-top: 3px !important; display: grid; grid-template-columns: minmax(0, 1fr) 34px; gap: 8px; align-items: center; }
.se__bt { display: block; height: 12px; background: var(--free); border-radius: 3px; overflow: hidden; }
.se__bb { display: block; height: 100%; background: var(--c); }
.se__b b { font: 700 12px var(--f-mono); text-align: right; }
.se__w { margin: 6px 0 0; display: grid; grid-template-columns: repeat(auto-fill, 10px); gap: 2px; }
.se__w i { width: 10px; height: 10px; border-radius: 2px; }
.w--cnt { background: var(--cnt); } .w--his { background: var(--his); } .w--gau { background: var(--gau); } .w--off { background: var(--off); } .w--prom { background: var(--ink); }
.se__svc { margin: 8px 0 0; font: 600 14px/1.4 var(--f-display); }
.se__bad { margin-top: 12px; border: 1.5px solid var(--fire); background: var(--fire-soft); border-radius: 10px; padding: 8px 12px; }
.se__bad p { margin: 0; font-size: 14px; line-height: 1.45; } .se__bad p + p { margin-top: 4px; }
.se__bh { font: 700 14px/1.4 var(--f-display) !important; color: var(--fire); }
/* ---------- 5 · rate */
ol.ra__ks { list-style: none; margin: 10px 0 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); gap: 8px; }
.ra__k { --c: var(--muted); border: 1px solid var(--rule); border-left: 4px solid var(--c); border-radius: 8px; padding: 6px 10px; min-width: 0; }
.ra--bad { --c: var(--fire); } .ra--ok { --c: var(--cnt); }
.ra__k p { margin: 0; }
.ra__kt { font: 700 13px/1.35 var(--f-display); }
.ra__kc { margin-top: 3px !important; } .ra__kc code { font-size: 12px; }
.ra__kv { margin-top: 3px !important; font: 500 13px var(--f-display); color: var(--muted); } .ra__kv b { font: 800 17px var(--f-mono); color: var(--c); }
.ra--plain .ra__kv b { color: var(--ink); }
/* ---------- 6 · buckets e interpolación */
.bk { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 18px; align-items: start; }
@media (max-width: 860px) { .bk { grid-template-columns: minmax(0, 1fr); } }
.bk__a, .bk__i { min-width: 0; }
ol.bk__rows { padding-top: 20px; --le: 82px; --bv: 40px; }
.bk__s { position: absolute; top: 0; bottom: 0; }
.bk--p0 { background: var(--his); } .bk--p1 { background: var(--his-soft); box-shadow: inset 0 0 0 1px var(--his); }
.bk--hit .ty__le { color: var(--ink); font-weight: 800; } .bk--hit .ty__bt { box-shadow: 0 0 0 2px var(--ink); }
.bk__r { position: absolute; top: 0; bottom: -2px; width: 0; border-left: 2px dashed var(--ink); z-index: 1; pointer-events: none; }
.bk__r span { position: absolute; top: 0; right: 4px; font: 700 11px/16px var(--f-mono); white-space: nowrap; }
svg.bk__svg { max-width: 470px; }
.bk__c { margin-top: 16px; border-top: 1px dashed var(--rule); padding-top: 12px; }
ul.bk__bars { list-style: none; margin: 4px 0 0; padding: 0; display: grid; gap: 6px; }
.bk__bars li { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.6fr) 88px; gap: 4px 10px; align-items: center; }
@media (max-width: 640px) { .bk__bars li { grid-template-columns: minmax(0, 1fr) 82px; } .bk__bl { grid-column: 1 / -1; } .bk__slo > span:first-child { display: none; } }
.bk__bl { font: 600 13px/1.3 var(--f-display); }
.bk__bt { position: relative; display: block; height: 14px; background: var(--free); border-radius: 3px; }
.bk__bt::after { content: ""; position: absolute; top: -4px; bottom: -4px; left: var(--slo); border-left: 2px dashed var(--fire); }
.bk__bb { display: block; height: 100%; border-radius: 3px; background: var(--c); }
.bk--pod { --c: var(--his-soft); } .bk--avg { --c: var(--fire); } .bk--real { --c: var(--ink); } .bk--est { --c: var(--his); }
.bk--pod .bk__bb { box-shadow: inset 0 0 0 1px var(--his); }
.bk__bv { font: 700 12.5px var(--f-mono); text-align: right; white-space: nowrap; }
.bk__no { color: var(--fire); }
.bk--avg .bk__bl { color: var(--fire); }
.bk__slo .bk__st { position: relative; display: block; height: 16px; }
.bk__slo .bk__st span { position: absolute; left: var(--slo); transform: translateX(-50%); font: 700 11.5px/16px var(--f-display); color: var(--fire); white-space: nowrap; }
/* ---------- 7 · estados de una alerta */
.as__h { margin: 0 0 8px; display: flex; flex-wrap: wrap; gap: 4px 8px; font-size: 13.5px; color: var(--muted); }
.as__h code { font-size: 12.5px; color: var(--ink); }
.as__g { margin-top: 10px; display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); gap: 10px 20px; align-items: start; }
@media (max-width: 760px) { .as__g { grid-template-columns: minmax(0, 1fr); } }
ol.as__sts { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.as__sts li { display: grid; grid-template-columns: 80px 74px minmax(0, 1fr); gap: 8px; align-items: baseline; font-size: 14px; line-height: 1.4; }
.as__st { font: 800 10.5px/1.3 var(--f-display); text-transform: uppercase; letter-spacing: .04em; border-radius: 999px; padding: 2px 6px; text-align: center; border: 1.5px solid var(--c); color: var(--c); background: var(--cs); }
.as--ok { --c: var(--okc); --cs: var(--okc-soft); } .as--pen { --c: var(--pen-ink); --cs: var(--pen-soft); } .as--fire { --c: var(--fire); --cs: var(--fire-soft); }
.as__t { font: 700 12px var(--f-mono); color: var(--muted); white-space: nowrap; }
/* ---------- 8 · el árbol de Alertmanager */
.ro { display: grid; gap: 8px; }
.ro__root { border: 2px solid var(--ink); border-radius: 12px; padding: 8px 12px; min-width: 0; }
.ro p { margin: 0; }
.ro__h { display: flex; align-items: center; gap: 8px; font: 500 14.5px/1.3 var(--f-display); }
.ro__rc { margin-top: 4px !important; font-size: 14px; } .ro__rc b { font: 700 13px var(--f-mono); }
.ro__kvs { margin-top: 6px !important; display: flex; flex-wrap: wrap; gap: 4px 14px; }
.ro__kv { font-size: 12.5px; } .ro__kv code { font-size: 12px; }
.ro__down { padding-left: 14px; font: 700 12.5px var(--f-display); color: var(--muted); }
ol.ro__kids { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
@media (max-width: 860px) { ol.ro__kids { grid-template-columns: minmax(0, 1fr); } }
.ro__kids > li { --c: var(--ink); border: 1.5px solid var(--c); border-top-width: 5px; border-radius: 10px; padding: 8px 10px; min-width: 0; }
.ro--fire { --c: var(--fire) !important; } .ro--pen { --c: var(--pen) !important; } .ro--tick { --c: var(--ink) !important; }
.ro__n { display: flex; align-items: center; gap: 6px; } .ro__n code { font-size: 12.5px; }
.ro__no { flex: none; width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; background: var(--c); color: var(--onbar); font: 800 11px/1 var(--f-display); }
.ro--pen .ro__no { color: var(--on-hi); }
.ro__x { margin-top: 3px !important; } .ro__x code { font-size: 11.5px; }
ul.ro__al { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px; }
.ro__al li { font: 600 11.5px/1.4 var(--f-mono); border: 1px solid var(--rule); border-radius: 6px; padding: 1px 6px; background: var(--paper); overflow-wrap: anywhere; }
.ro__inh { border: 1.5px dashed var(--off); border-radius: 10px; padding: 8px 12px; font-size: 14px; line-height: 1.45; } .ro__inh code { font-size: 12px; }
.ro__inc { margin-top: 16px; border-top: 1px dashed var(--rule); padding-top: 12px; }
ol.ro__tl { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.ro__tl li { display: grid; grid-template-columns: 50px minmax(0, 1fr); gap: 2px 10px; align-items: baseline; padding: 6px 10px; border-radius: 8px; border-left: 4px solid var(--c); background: var(--cs); }
.ro--sent { --c: var(--fire); --cs: var(--fire-soft); } .ro--off { --c: var(--off); --cs: var(--free); }
.ro__tm { grid-row: span 2; font: 700 12.5px var(--f-mono); }
.ro__a { font-size: 14px; line-height: 1.4; } .ro__w { color: var(--muted); font-size: 12.5px; }
.ro__res { grid-column: 2; font-size: 13.5px; line-height: 1.4; } .ro__res b { color: var(--c); }
.ro__sum { margin: 8px 0 0; font: 500 14.5px var(--f-display); } .ro__sum b { color: var(--fire); }
/* ---------- 9 · el dashboard */
.db { border: 1px solid var(--rule); border-radius: 12px; padding: 8px; background: var(--bg); min-width: 0; }
.db p { margin: 0; }
.db__bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 12px; padding: 2px 4px 8px; }
.db__title { font: 800 14px var(--f-display); }
.db__vars { display: flex; flex-wrap: wrap; gap: 6px; }
.db__var { display: inline-flex; border: 1px solid var(--rule); border-radius: 6px; overflow: hidden; font: 600 12px/1.6 var(--f-display); }
.db__vn { background: var(--free); padding: 0 7px; } .db__vv { padding: 0 7px; background: var(--paper); }
.db__row { margin-top: 6px; }
.db__rh { margin-bottom: 4px !important; font: 700 12.5px var(--f-display); color: var(--muted); }
.db__grid { --u: 13px; display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); grid-template-rows: repeat(var(--rows), var(--u)); gap: 3px; }
.db__p { position: relative; min-width: 0; overflow: hidden; display: flex; flex-wrap: wrap; align-items: center; align-content: flex-start; gap: 3px 6px; border: 1px solid var(--rule); border-radius: 6px; background: var(--paper); padding: 4px 6px 7px; }
.db__no { flex: none; width: 18px; height: 18px; border-radius: 50%; display: inline-grid; place-items: center; background: var(--ink); color: var(--paper); font: 800 10.5px/1 var(--f-display); }
.db__tt { flex: 1 1 60%; min-width: 0; font: 700 12px/1.25 var(--f-display); }
.db__u { font: 600 10.5px var(--f-mono); color: var(--muted); }
.db__ic { display: inline-flex; } .db__ic svg { width: 40px; height: 20px; fill: none; stroke: var(--muted); stroke-width: 1.6; stroke-linecap: round; }
.db--heatmap .db__ic svg rect { fill: var(--his); stroke: none; }
.db--stat .db__ic svg text { fill: var(--ink); stroke: none; font: 800 14px var(--f-display); }
.db__th { position: absolute; left: 0; right: 0; bottom: 0; height: 4px; display: flex; }
.db__th i { flex: 1; } .db__th i.db--ok { background: var(--okc); } .db__th i.db--fire { background: var(--fire); } .db__th i.db--pen { background: var(--pen); }
@media (max-width: 640px) { .db__grid { --u: 9px; gap: 2px; } .db__tt, .db__u { display: none; } .db__p { justify-content: center; align-content: center; padding: 2px 2px 5px; gap: 2px; } .db__ic svg { width: 24px; height: 12px; } .db--narrow .db__ic { display: none; } }
.db__scale { margin: 6px 0 0; font-size: 12.5px; color: var(--muted); }
ol.db__list { list-style: none; margin: 12px 0 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 360px), 1fr)); gap: 10px 16px; }
.db__list li { min-width: 0; border-top: 1px solid var(--rule); padding-top: 6px; }
.db__lh { margin: 0; display: grid; grid-template-columns: 18px minmax(0, 1fr); gap: 8px; align-items: start; font-size: 14px; }
.db__lh .db__no { margin-top: 2px; }
.db__lx { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; min-width: 0; }
.db__lt { color: var(--muted); font-size: 12.5px; } .db__lt code { font-size: 11.5px; }
.db__lth { display: inline-flex; flex-wrap: wrap; gap: 4px; }
.db__tc { font: 600 11px/1.5 var(--f-display); border-radius: 999px; padding: 0 7px; border: 1px solid var(--rule); }
.db__tc.db--ok { color: var(--okc); border-color: var(--okc); } .db__tc.db--fire { color: var(--fire); border-color: var(--fire); }
.db__g2 { margin-top: 12px; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap: 12px; }
.db__ann { min-width: 0; } .db__ann ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; font-size: 13.5px; } .db__ann code { font-size: 12px; }
/* ---------- 10 · el presupuesto de errores */
.bu__h { margin: 0 0 8px; display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 14px; } .bu__h b { font-family: var(--f-mono); }
.bu__a { display: grid; grid-template-columns: minmax(0, 1fr) 210px; gap: 14px; align-items: center; }
@media (max-width: 760px) { .bu__a { grid-template-columns: minmax(0, 1fr); } }
.bu__ch { min-width: 0; }
ul.bu__rit { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; font: 600 13.5px/1.35 var(--f-display); }
.bu__rit li { display: flex; gap: 8px; align-items: center; }
.bu__pairs, .bu__inc { margin-top: 16px; border-top: 1px dashed var(--rule); padding-top: 12px; }
ol.bu__pl { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
@media (max-width: 860px) { ol.bu__pl { grid-template-columns: minmax(0, 1fr); } }
.bu__pl li { --c: var(--ink); border: 1px solid var(--rule); border-top: 4px solid var(--c); border-radius: 10px; padding: 8px 10px; min-width: 0; }
.bu--ok { --c: var(--okc) !important; } .bu--pen { --c: var(--pen) !important; } .bu--fire { --c: var(--fire) !important; }
.bu__pl p { margin: 0; }
.bu__pt { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; font-size: 13.5px; line-height: 1.4; }
.bu__x { font: 800 18px var(--f-mono); color: var(--c); }
.bu--pen .bu__x { color: var(--pen-ink); }
.bu__wb { margin-top: 8px !important; display: flex; height: 22px; }
.bu__wl { flex: 11; display: grid; place-items: center; background: var(--free); border: 1.5px solid var(--c); border-right: 0; border-radius: 4px 0 0 4px; font: 700 11.5px var(--f-mono); }
.bu__ws { flex: 1; position: relative; background: var(--c); border-radius: 0 4px 4px 0; }
.bu__ws span { position: absolute; right: 0; top: 100%; margin-top: 2px; font: 700 11.5px var(--f-mono); white-space: nowrap; }
.bu__g { margin-top: 20px !important; font-size: 13px; color: var(--muted); } .bu__g b { color: var(--ink); }
ol.bu__ilist { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.bu__ir { display: grid; grid-template-columns: 200px minmax(0, 1fr) 190px; gap: 2px 10px; align-items: center; }
.bu__ir p { margin: 0; }
.bu__il { font: 600 12.5px/1.3 var(--f-display); }
.bu__it { position: relative; height: 16px; background: var(--free); border-radius: 3px; }
.bu__err { position: absolute; left: 0; top: 5px; bottom: 5px; background: var(--fire-soft); box-shadow: inset 0 0 0 1px var(--fire); border-radius: 2px; }
.bu--inc .bu__err { top: 2px; bottom: 2px; background: var(--fire); }
.bu__fix { position: absolute; top: -3px; bottom: -3px; width: 0; border-left: 3px solid var(--okc); }
.bu__m { position: absolute; top: 1px; width: 14px; height: 14px; margin-left: -7px; border-radius: 50%; background: var(--c); box-shadow: 0 0 0 2px var(--paper); z-index: 1; }
.bu__m.bu--fire { --c: var(--fire); } .bu__m.bu--c01 { --c: var(--ink); } .bu__m.bu--ok { --c: var(--okc); } .bu__m.bu--late { background: var(--paper); box-shadow: inset 0 0 0 2.5px var(--fire), 0 0 0 2px var(--paper); }
.bu__iv { font-size: 12.5px; text-align: right; } .bu__iv b { font-family: var(--f-mono); }
.bu__ax { display: grid; grid-template-columns: 200px minmax(0, 1fr) 190px; gap: 10px; margin: 4px 0 0; }
.bu__axt { position: relative; height: 16px; font: 600 11px/16px var(--f-mono); color: var(--muted); }
.bu__axt span { position: absolute; transform: translateX(-50%); }
.bu__axt span:first-child { transform: none; } .bu__axt span:last-child { transform: translateX(-100%); }
@media (max-width: 760px) { .bu__ir, .bu__ax { grid-template-columns: minmax(0, 1fr); } .bu__iv { text-align: left; } .bu__ax > span:not(.bu__axt) { display: none; } }
/* ---------- 11 · el Operator */
.op { display: grid; gap: 4px; }
.op p { margin: 0; }
.op__st { border: 1px solid var(--rule); border-radius: 12px; padding: 8px 12px; min-width: 0; }
.op--oper { border: 2px solid var(--accent); } .op--prom { border: 2px solid var(--ink); }
.op__sh { margin-bottom: 6px !important; display: grid; grid-template-columns: 22px minmax(0, 1fr); align-items: center; gap: 8px; font: 700 14px/1.3 var(--f-display); } .op__sh code { font-size: 12px; }
.op__sn { flex: none; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; background: var(--ink); color: var(--paper); font: 800 11.5px/1 var(--f-display); }
ul.op__objs { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 230px), 1fr)); gap: 8px; }
.op__objs li { border: 1.5px solid var(--ink); border-radius: 10px; padding: 6px 9px; min-width: 0; font-size: 13px; line-height: 1.4; }
.op__objs li.op--rule { border-color: var(--accent); }
.op__objs li.op--ign { border-style: dashed; border-color: var(--off); color: var(--muted); background: var(--free); }
.op__objs li.op--ign .op__el b { color: var(--fire); }
.op__k { font: 800 10.5px/1.3 var(--f-display) !important; letter-spacing: .06em; text-transform: uppercase; }
.op__nm, .op__lb, .op__el { margin-top: 2px !important; } .op__objs code { font-size: 11.5px; }
.op__ar { padding-left: 16px; display: flex; align-items: center; gap: 8px; font: 600 12.5px/1.3 var(--f-display); color: var(--muted); }
.op__ar span { font-size: 18px; color: var(--ink); }
.op__p { font-size: 13.5px; line-height: 1.45; } .op__p code { font-size: 12px; }
ul.op__w { list-style: none; margin: 0 0 4px; padding: 0; display: grid; gap: 3px; font-size: 13.5px; }
.op__two { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 12px; }
@media (max-width: 760px) { .op__two { grid-template-columns: minmax(0, 1fr); } }
.op__two > div { min-width: 0; display: grid; gap: 4px; align-content: start; }
ul.op__tg, ul.op__cons { list-style: none; margin: 0; padding: 0; display: grid; gap: 5px; }
.op__tg li { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; font-size: 12.5px; } .op__tg code { font-size: 12px; }
.op__job { font: 600 11.5px var(--f-mono); color: var(--muted); }
.op__up { margin-left: auto; font: 800 10.5px/1.5 var(--f-mono); border-radius: 4px; padding: 0 6px; color: var(--onbar); }
.op__up.op--ok { background: var(--okc); } .op__up.op--down { background: var(--fire); }
.op__cons li { font-size: 13.5px; line-height: 1.4; } .op__cons li span { display: block; color: var(--muted); font-size: 13px; }
/* ---------- 0, 4 y 12 · cadenas de pasos */
.ch__tr { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0 0 16px; }
.ch__grp { border: 1.5px solid var(--rule); border-radius: 10px; padding: 4px 6px 6px; min-width: 0; max-width: 100%; }
.ch__grp p { margin: 0; }
.ch__gl { margin-bottom: 4px !important; display: flex; align-items: center; gap: 5px; font: 800 10.5px/1.3 var(--f-display); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.ch__gl .ic { width: 18px; height: 18px; }
.ch__gi { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.ch__ga { color: var(--muted); font-weight: 800; }
@media (max-width: 640px) { .ch__ga { display: none; } } /* en el celular los grupos se apilan: los números ya dicen el orden */
.ch--br { border-style: dashed; }
.ch__grp.ch--visit, .ch__grp.ch--prom { border-color: var(--ink); }
.ch__tp { display: inline-flex; align-items: center; gap: 5px; font: 700 12.5px/1.3 var(--f-display); border: 1px solid var(--rule); border-radius: 999px; padding: 2px 8px 2px 3px; background: var(--paper); }
.ch__tp b { width: 18px; height: 18px; border-radius: 50%; background: var(--ink); color: var(--paper); display: inline-grid; place-items: center; font: 800 10px/1 var(--f-display); }
.ch__ta { color: var(--muted); font-weight: 800; font-size: 12px; }
ol.ch { list-style: none; margin: 0; padding: 0; display: grid; }
.ch__s { --c: var(--ink); position: relative; padding: 0 0 16px 44px; min-width: 0; }
.ch__s::before { content: ""; position: absolute; left: 14px; top: 32px; bottom: 4px; width: 3px; background: var(--c); opacity: .35; border-radius: 2px; }
.ch__s:last-child::before { display: none; }
.ch__no { position: absolute; left: 0; top: 0; width: 31px; height: 31px; border-radius: 50%; background: var(--c); color: var(--paper); display: grid; place-items: center; font: 800 14px/1 var(--f-display); }
.ch__s p, .ch__br p { margin: 0; }
.ch__l { font: 800 16px/1.35 var(--f-display); padding-top: 3px; display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; }
.ch__who { font: 700 10.5px/1.3 var(--f-display); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.ch__n { margin-top: 5px !important; font-size: 15px; line-height: 1.5; }
.ch__ask { margin-top: 3px !important; font-size: 15px; line-height: 1.45; font-style: italic; }
.ch__br { margin: 0 0 4px 44px; border: 1.5px dashed var(--muted); border-radius: 10px; padding: 8px 12px; }
.ch__bk { font: 800 10.5px/1.3 var(--f-display); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); border: 1px solid var(--rule); border-radius: 999px; padding: 1px 7px; }
@media (max-width: 640px) { .ch__br { margin-left: 0; } }
/* tablas: se apilan en el celular */
@media (max-width: 640px) {
  table.stk, table.stk tbody, table.stk tr, table.stk td, table.stk th.rh { display: block; width: 100%; }
  table.stk thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  table.stk colgroup { display: none; }
  table.stk tr { border-bottom: 1px solid var(--rule); padding: 8px 0; }
  table.stk td, table.stk th.rh { border: 0; padding: 2px 0; }
  table.stk td[data-k]::before { content: attr(data-k); display: block; font: 700 10.5px/1.5 var(--f-display); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
  table.stk td.nil::before { display: inline-block; margin-right: 8px; }
}
@media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }
@media print {
  @page { size: A4; margin: 12mm; }
  :root, :root:not([data-theme="light"]), :root[data-theme="dark"] {
    ${TOKENS_LIGHT} --bg: #ffffff; --paper: #ffffff; color-scheme: light;
  }
  body { font-size: 11px; line-height: 1.45; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  nav.toc, #herramientas, details.lab, p.nolab, figure.quiz, .search, #err-n, #err-none, button.cp { display: none !important; }
  .sec { break-before: page; padding-top: 0; border-top: 0; }
  #bolsillo { break-before: auto; }
  .hero { padding-top: 0; padding-bottom: 12px; gap: 6px; } .hero p.lead { font-size: 12px; } .hero h1 { font-size: 34px; } .legendrow { font-size: 10px; }
  .sec__head { margin-bottom: 10px; gap: 12px; } .sec__n { min-width: 34px; height: 34px; font-size: 17px; border-radius: 8px; } .sec h2 { font-size: 22px; } .sec__q { font-size: 12px; margin-top: 2px; }
  .pad { padding: 10px 12px; }
  .pad__grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-template-areas: "tpl vars" "fx fx"; gap: 8px 16px; }
  .pad__grid.nofx { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-template-areas: "tpl vars"; }
  .tpls { gap: 7px; } .tpl__code { font-size: 10.5px; } .tpl__note { font-size: 10.5px; }
  .tag { font-size: 8.5px !important; }
  .vars, .dt { font-size: 10.5px; } .vars th, .dt th { font-size: 8.5px; padding: 3px 4px; } .vars td, .vars th.rh, .dt td, .dt th.rh { padding: 3px 4px; }
  .vars th.rh { font-size: 10.5px; } .vars td.c, .vars th.rh.p, .dt .mono, .dt th.rh.mono { font-size: 9.5px; } .dt th.rh { font-size: 10.5px; }
  code, code.cmd { font-size: 9.5px; }
  .code { margin-top: 6px; } .code pre { font-size: 9.5px; line-height: 1.4; padding: 7px 10px; } .code__bar { font-size: 9px; padding: 3px 8px; }
  .card { padding: 8px 10px; } .card > h3, .example > h3 { font-size: 11.5px; margin-bottom: 4px; }
  .pieces { margin-top: 10px; } .example { margin-top: 12px; } .notes { margin-top: 10px; gap: 8px; } .card.tbl { margin-top: 10px; }
  ul.ex__notes { columns: 2; column-gap: 20px; font-size: 10.5px; margin-top: 8px; }
  .memo, .trap { padding: 7px 10px; } .memo p, .trap p { font-size: 10.5px; }
  figure.fig { padding: 8px; margin-top: 10px; } figure.fig figcaption, .fig__note, .fig__notes { font-size: 10.5px; margin-top: 6px; }
  .links { font-size: 9px; margin-top: 8px; } .links .chip { padding: 2px 7px; }
  .mb { padding: 2px; } .mb math { font-size: 1.15em; }
  ol.errlist { display: block; columns: 2; column-gap: 20px; } ol.errlist li { padding: 5px 0; } .err__m, .err__f, .err__s { font-size: 10px; }
  pre, .code pre, .tpl__code, pre.term { white-space: pre-wrap; overflow-wrap: anywhere; overflow: visible; }
  .mb { overflow: visible; }
  .k { font-size: 9px; } .kleg { font-size: 9.5px; margin-top: 6px; } .sw { width: 12px; height: 9px; }
  .callout { font-size: 10.5px; padding: 5px 9px; } .to__h { font-size: 8.5px; } .ui, .ktag { font-size: 9px; } .ui__ic { width: 11px; height: 11px; }
  svg.chart.fv-n { display: none !important; } svg.chart.fv-w { display: block !important; }
  .pl { grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr) !important; } .pl__h, .pl__who, .pl__nt, .pl__weak, .pl__dir { font-size: 10px; } .pl__t b { font-size: 10px; } .pl__ep code, .pl__job, .pl__gh, .pl__gt { font-size: 8.5px; } .pl__g { grid-template-columns: minmax(0, 1fr) repeat(var(--n), 18px); gap: 4px; } .pl__c { width: 18px; height: 18px; font-size: 9px; } .pl__h .ic { width: 22px; height: 22px; }
  .ty { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; gap: 8px; } .ty__h, .ty__r li, .ty__n, .ty__sum, .ty__sm, .ty__odn { font-size: 9.5px; } .ty__r li b { font-size: 10px; } .ty__le, .ty__bv { font-size: 8.5px; } .odo { font-size: 10px; } .ty__bt { height: 9px; }
  ol.ty__bk { --le: 62px; --bv: 34px; }
  .se__lab, .se__tot, .se__svc, .se__bad p, .se__ml, .se__key { font-size: 9.5px; } .se__mn code, .se__root code { font-size: 9.5px; } ul.se__kids { grid-template-columns: repeat(4, minmax(0, 1fr)) !important; } .se__g { grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr) !important; } .se__w { grid-template-columns: repeat(auto-fill, 7px); } .se__w i { width: 7px; height: 7px; }
  .ra__kt, .ra__kv { font-size: 9.5px; } .ra__kv b { font-size: 12px; }
  .bk { grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr) !important; } .bk__bars li { grid-template-columns: minmax(0, 1fr) minmax(0, 1.6fr) 70px !important; } .bk__bl { grid-column: auto !important; } .bk__slo > span:first-child { display: block !important; } .bk__bl, .bk__bv { font-size: 9.5px; }
  .as__g { grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr) !important; } .as__sts li, ol.kev { font-size: 9.5px; } .as__sts li { grid-template-columns: 62px 46px minmax(0, 1fr); } .as__st { font-size: 8px; } .kev__n { width: 16px; height: 16px; font-size: 9px; } ol.kev li { grid-template-columns: 16px 42px minmax(0, 1fr); }
  ol.ro__kids { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; } .ro__h, .ro__rc, .ro__inh, .ro__a, .ro__res, .ro__sum, .ro__kv { font-size: 9.5px; } .ro__al li { font-size: 8.5px; }
  .db__grid { --u: 10px; } .db__tt { font-size: 9px; } .db__u { font-size: 8px; } .db__ic svg { width: 26px; height: 13px; } .db__lh, .db__lt, .db__ann ul { font-size: 9.5px; } ol.db__list { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
  .bu__a { grid-template-columns: minmax(0, 1fr) 160px !important; } ol.bu__pl { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; } .bu__pt, .bu__g, .bu__rit, .bu__il, .bu__iv, .bu__h { font-size: 9.5px; } .bu__ir, .bu__ax { grid-template-columns: 150px minmax(0, 1fr) 150px !important; } .bu__ax > span { display: block !important; } .bu__iv { text-align: right !important; }
  .op__two { grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr) !important; } .op__sh, .op__p, .op__objs li, .op__tg li, .op__cons li, ul.op__w, .op__ar { font-size: 9.5px; }
  .ch__s { padding: 0 0 9px 32px; } .ch__no { width: 23px; height: 23px; font-size: 11px; } .ch__s::before { left: 10px; top: 25px; } .ch__l { font-size: 12px; padding-top: 1px; } .ch__n, .ch__ask { font-size: 10px; } .ch__tp { font-size: 9.5px; } .ch__br { margin-left: 32px; } .ch__who, .ch__gl { font-size: 8px; }
  /* el código y los textos chicos de las figuras, al tamaño del resto del PDF */
  figure.fig code, figure.fig code.cmd { font-size: 8.5px !important; } .qb code.cmd { padding: 3px 6px; } .ktag { font-size: 7.5px; }
  .ty__mx, .ty__odn, .ty__x, .ty__r li > span:last-child, .se__n, .se__b b, .bk__bl, .bk__bv, .bk__slo .bk__st span, .as__h, .ro__al li, .db__lt, .db__tc, .op__job, .op__up, .op__tg li, .op__cons li, .op__cons li span, .pl__who { font-size: 9px !important; }
  .ui { font-size: 9px !important; } .ui__home { font-size: 7px !important; } .se__w i { width: 6px; height: 6px; } .se__w { grid-template-columns: repeat(auto-fill, 6px); }
  .notes, .memo, .trap, ol.errlist li, .tpl, .mb, ul.ex__notes li, .pl__side, .ty__c, .se__tree, .se__g > div, .ra__k, .bk__a, .bk__i, .bk__c, .as__g, .ro__root, .ro__kids > li, .ro__inc, .db, .db__list li, .bu__pl li, .bu__inc, .op__st, .ch__s, .ch__br, .ch__tr { break-inside: avoid; }
  tr { break-inside: avoid; }
  .card > h3, .example > h3, .tag, .to__h, .code__bar { break-after: avoid; }
  .links { break-before: avoid; }
}
`;

// ================================================================ JS de la página (sin librerías; js-yaml se carga aparte)
const DATA = {
  rules: RULES.map((r) => ({ id: r.id, severity: r.severity, message: r.message, why: r.why, fix: r.fix })),
  samples: SAMPLES,
  btns: [['rv-c01', 'c01']],
  yamlUrl: YAML_URL,
  errs: ERRS.map((e) => ({ msg: e.msg, meaning: e.meaning, first: cmdHtml(e.first), sec: e.sec, lab: SECLAB(e.sec) })),
};
const JS_SRC = String.raw`
(function () {
  'use strict';
  var D = /*DATA*/;
  var doc = document;
  function $(id) { return doc.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ---------- copiar: clipboard dentro del clic; si lo rechaza, seleccionar el texto
  function selectEl(el) {
    try { var r = doc.createRange(); r.selectNodeContents(el); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); } catch (e) {}
  }
  function flash(btn, msg) {
    if (!btn.getAttribute('data-label')) btn.setAttribute('data-label', btn.textContent);
    btn.textContent = msg;
    clearTimeout(btn._t);
    btn._t = setTimeout(function () { btn.textContent = btn.getAttribute('data-label'); }, 1800);
  }
  doc.addEventListener('click', function (ev) {
    var btn = ev.target && ev.target.closest ? ev.target.closest('button.cp') : null;
    if (!btn) return;
    var box = btn.closest('.cmdw, .code, .qb');
    var el = box ? box.querySelector('code.cmd, pre') : null;
    var text = btn.getAttribute('data-copy');
    if (text === null) text = el ? el.textContent : '';
    function fail() { if (el) selectEl(el); flash(btn, 'Seleccionado: ⌘C'); }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { flash(btn, 'Copiado'); }, fail);
      else fail();
    } catch (e) { fail(); }
  });

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

  // ---------- diagnosticador
  var chips = doc.querySelectorAll('.dg-chip'), sel = $('dg-select');
  function pick(id) {
    doc.querySelectorAll('.dg-panel').forEach(function (p) { p.hidden = p.getAttribute('data-dg') !== id; });
    chips.forEach(function (c) { c.setAttribute('aria-pressed', c.getAttribute('data-dg') === id ? 'true' : 'false'); });
    if (sel && sel.value !== id) sel.value = id;
    $('dg-empty').hidden = !!id;
  }
  chips.forEach(function (c) { c.addEventListener('click', function () { pick(c.getAttribute('data-dg')); }); });
  if (sel) sel.addEventListener('change', function () { pick(sel.value); });

  // ---------- revisor de reglas de alerta
  /*REVISOR*/
  var RULE = {}, IDS = D.rules.map(function (r) { RULE[r.id] = r; return r.id; });
  var RANK = { error: 0, warn: 1, info: 2 }, NAME = { error: 'error', warn: 'aviso', info: 'info' };
  function plural(nn, a, b) { return nn + ' ' + (nn === 1 ? a : b); }
  // js-yaml llega de cdnjs al abrir la página: así el service worker lo guarda para usarlo sin conexión.
  var yamlWait = null;
  function loadYaml(cb) {
    if (window.jsyaml) { cb(true); return; }
    if (yamlWait) { yamlWait.push(cb); return; }
    yamlWait = [cb];
    var s = doc.createElement('script');
    function done() { var l = yamlWait; yamlWait = null; s.onload = s.onerror = null; if (!window.jsyaml && s.parentNode) s.parentNode.removeChild(s); l.forEach(function (f) { f(!!window.jsyaml); }); }
    s.src = D.yamlUrl; s.async = true; s.crossOrigin = 'anonymous'; s.onload = done; s.onerror = done;
    doc.head.appendChild(s);
  }
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function nonEmpty(v) { return typeof v === 'string' && v.trim() !== ''; }
  // qué hay en el archivo: documentos, PrometheusRules, grupos, alertas y reglas de grabación
  function contar(docs) {
    var n = { docs: 0, cr: 0, groups: 0, alerts: 0, records: 0 };
    docs.forEach(function (d) {
      if (d === null || d === undefined) return;
      n.docs++;
      var cr = isObj(d) && d.kind === 'PrometheusRule'; if (cr) n.cr++;
      var gs = cr ? (isObj(d.spec) ? d.spec.groups : null) : (isObj(d) ? d.groups : null);
      if (!Array.isArray(gs)) return;
      gs.forEach(function (g) { n.groups++; if (isObj(g) && Array.isArray(g.rules)) g.rules.forEach(function (r) { if (!isObj(r)) return; if (nonEmpty(r.alert)) n.alerts++; else if (nonEmpty(r.record)) n.records++; }); });
    });
    return n;
  }
  function lineBtn(n) { return '<button class="rv-ln" type="button" data-line="' + n + '" title="Marcar la línea en el texto">línea ' + n + '</button>'; }
  function where(f, n) {
    var p = [];
    if (n.docs > 1) p.push('documento ' + (f.doc + 1));
    if (typeof f.group === 'string') p.push('grupo <code>' + esc(f.group) + '</code>');
    else if (typeof f.group === 'number') p.push('el grupo ' + (f.group + 1) + ' de la lista');
    if (f.rule !== undefined && f.rule !== null) p.push(/^#\d+$/.test(String(f.rule)) ? 'la regla ' + (f.ri + 1) + ' del grupo' : 'regla <code>' + esc(String(f.rule)) + '</code>');
    else if (f.group === undefined) p.push('todo el documento');
    if (f.line) p.push(lineBtn(f.line));
    return p.join(' · ');
  }
  function review() {
    var text = $('rv-text').value, out = $('rv-out');
    if (!text.trim()) { out.innerHTML = '<p class="small">Pega un archivo de reglas (el YAML con <code>groups:</code>) o un PrometheusRule y toca Revisar.</p>'; return; }
    if (!window.jsyaml) {
      out.innerHTML = '<p class="small">Cargando el lector de YAML…</p>';
      loadYaml(function (ok) {
        if (ok) review();
        else out.innerHTML = '<div class="rv-err" role="alert" id="rv-error"><p class="rv-err__t">No pude cargar el lector de YAML</p><p>El revisor usa js-yaml, que se baja de cdnjs la primera vez. Conéctate a internet y toca Revisar otra vez: después queda guardado y funciona sin conexión.</p></div>';
      });
      return;
    }
    var docs;
    try { docs = window.jsyaml.loadAll(text); }
    catch (e) {
      var m = e && e.mark, at = m ? 'Línea ' + (m.line + 1) + ', columna ' + (m.column + 1) : '';
      out.innerHTML = '<div class="rv-err" role="alert" id="rv-error"><p class="rv-err__t">El YAML no es válido: no pude leerlo</p><p>' + (at ? '<b>' + at + ':</b> ' : '') + '<code>' + esc((e && e.reason) || String(e)) + '</code></p>' + (m && m.snippet ? '<pre class="rv-err__snip">' + esc(m.snippet) + '</pre>' : '') + '<p class="small">Mira la sangría (solo espacios, nunca tabs), los dos puntos después de cada clave y las comillas sin cerrar. Prometheus tampoco cargaría este archivo: <code>promtool check rules</code> lo rechaza igual.</p></div>';
      return;
    }
    var n = contar(docs);
    if (!n.docs) { out.innerHTML = '<p class="rv-sum" id="rv-sum" data-total="0">No hay nada que revisar: el texto solo tiene comentarios.</p>'; return; }
    var found = revisarReglas(docs, IDS).filter(function (f) { return RULE[f.id]; });
    var loc = ubicarReglas(text, docs);
    found.forEach(function (f) { f.line = loc(f); });
    found.sort(function (a, b) { return (RANK[RULE[a.id].severity] - RANK[RULE[b.id].severity]) || ((a.line || 0) - (b.line || 0)); });
    var cnt = { error: 0, warn: 0, info: 0 };
    found.forEach(function (f) { cnt[RULE[f.id].severity]++; });
    var html = '<p class="rv-sum" id="rv-sum" data-total="' + found.length + '" data-error="' + cnt.error + '" data-warn="' + cnt.warn + '" data-info="' + cnt.info + '">' +
      (found.length ? plural(found.length, 'hallazgo', 'hallazgos') + ': ' + plural(cnt.error, 'error', 'errores') + ' · ' + plural(cnt.warn, 'aviso', 'avisos') + ' · ' + cnt.info + ' info'
        : 'Sin hallazgos: ninguna de las ' + IDS.length + ' reglas encontró algo.') + '</p>' +
      '<p class="rv-objs">Revisé ' + plural(n.docs, 'documento', 'documentos') + (n.cr ? ' (' + (n.cr === n.docs ? (n.cr === 1 ? 'un PrometheusRule' : 'todos PrometheusRule') : plural(n.cr, 'PrometheusRule', 'PrometheusRules')) + ')' : '') + ': ' + plural(n.groups, 'grupo', 'grupos') + ', ' + plural(n.alerts, 'alerta', 'alertas') + ' y ' + plural(n.records, 'regla de grabación', 'reglas de grabación') + '.</p>';
    if (found.length) html += '<ol class="rv-list">' + found.map(function (f) {
      var r = RULE[f.id];
      return '<li class="sev-' + r.severity + '" data-rule="' + r.id + '"' + (f.line ? ' data-line="' + f.line + '"' : '') + '><div class="rv-h"><span class="sev ' + r.severity + '">' + NAME[r.severity] + '</span><span class="rv-msg">' + esc(r.message) + '</span></div>' +
        '<p class="rv-obj">' + where(f, n) + '</p>' + (f.detail ? '<p class="rv-det"><code>' + esc(String(f.detail).slice(0, 200)) + '</code></p>' : '') +
        '<p>' + esc(r.why) + '</p><p><span class="k">Arreglo:</span> ' + esc(r.fix) + '</p></li>';
    }).join('') + '</ol>';
    out.innerHTML = html;
  }
  // marcar una línea del textarea
  $('rv-out').addEventListener('click', function (ev) {
    var b = ev.target && ev.target.closest ? ev.target.closest('.rv-ln') : null;
    if (!b) return;
    var ta = $('rv-text'), nn = +b.getAttribute('data-line'), lines = ta.value.split('\n'), start = 0;
    for (var i = 0; i < nn - 1 && i < lines.length; i++) start += lines[i].length + 1;
    var end = start + (lines[nn - 1] || '').length;
    ta.focus();
    try { ta.setSelectionRange(start, end); } catch (e) {}
    var lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
    ta.scrollTop = Math.max(0, (nn - 4) * lh);
    if (ta.scrollIntoView) ta.scrollIntoView({ block: 'nearest' });
  });
  function setLabel(t, cls) { var l = $('rv-label'); l.textContent = t; l.className = 'rv-label' + (cls ? ' ' + cls : ''); }
  function load(k) { var s = D.samples[k]; $('rv-text').value = s.text; setLabel(s.label, s.cls); review(); }
  $('rv-run').addEventListener('click', function () { var t = $('rv-text').value; var curk = Object.keys(D.samples).filter(function (k) { return D.samples[k].text === t; })[0]; if (!curk) setLabel('Tus reglas', 'mine'); review(); });
  $('rv-bad').addEventListener('click', function () { load('bad'); });
  D.btns.forEach(function (b) { var el = $(b[0]); if (el) el.addEventListener('click', function () { load(b[1]); }); });
  $('rv-clear').addEventListener('click', function () { $('rv-text').value = ''; setLabel('Tus reglas', 'mine'); $('rv-out').innerHTML = ''; $('rv-text').focus(); });
  review();

  // ---------- quiz de errores
  var order = [], pos = 0;
  function shuffle() {
    order = D.errs.map(function (_, i) { return i; });
    for (var i = order.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = order[i]; order[i] = order[j]; order[j] = t; }
    pos = 0;
  }
  function showQ() {
    var e = D.errs[order[pos]];
    $('q-count').textContent = 'Mensaje ' + (pos + 1) + ' de ' + D.errs.length;
    $('q-msg').textContent = e.msg;
    var a = $('q-ans');
    a.hidden = true;
    a.innerHTML = '<p class="tag">Qué significa</p><p>' + esc(e.meaning) + '</p><p class="tag">Primero</p><p>' + e.first + '</p><p class="tag">Dónde está</p><p><a href="#' + e.sec + '">' + esc(e.lab) + '</a></p>';
    $('q-show').disabled = false;
  }
  $('q-show').addEventListener('click', function () { $('q-ans').hidden = false; $('q-show').disabled = true; });
  $('q-next').addEventListener('click', function () { pos++; if (pos >= order.length) shuffle(); showQ(); });
  shuffle(); showQ();

  // ---------- búsqueda en la lista de errores
  var items = doc.querySelectorAll('.errlist > li'), q = $('err-q');
  function norm(s) { return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
  q.addEventListener('input', function () {
    var terms = norm(q.value.trim()).split(/\s+/).filter(Boolean), nn = 0;
    items.forEach(function (li) {
      var hay = li.getAttribute('data-q'), ok = terms.every(function (t) { return hay.indexOf(t) >= 0; });
      li.hidden = !ok; if (ok) nn++;
    });
    $('err-n').textContent = nn + ' de ' + items.length;
    $('err-none').hidden = nn > 0;
  });
})();`;
const jsonForScript = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const JS = JS_SRC.replace('/*DATA*/', () => jsonForScript(DATA)).replace('/*REVISOR*/', () => REVISOR_SRC);

// ================================================================ página
const NAV = [...ORDER.map((id) => [id, NAVL[id]]), ['diagnosticador', 'Diagnosticador'], ['revisor', 'Revisor de reglas']];
const TITLE = 'Prometheus y Grafana';
const HEAD = `<title>${TITLE}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&family=JetBrains+Mono:wght@400;600;700&family=Source+Serif+4:ital,opsz,wght@0,8..60,400..700;1,8..60,400..700&display=swap">
<style>${CSS}</style>`;
// Versiones del pie: Prometheus del compose del C01 y prometheus-client de su requirements.txt; las de los laboratorios
// (Alertmanager, Grafana, el chart y KEDA), del contenido. Si el C01 o el contenido cambian, el pie cambia con ellos.
const VER = (() => {
  const compose = readFileSync(join(C01, 'docker-compose.yml'), 'utf8'), req = readFileSync(join(C01, 'gateway/requirements.txt'), 'utf8');
  const txt = JSON.stringify([W1, W2, W3]);
  const best = (re) => [...txt.matchAll(re)].map((m) => m[1]).sort((a, b) => b.split('.').length - a.split('.').length)[0];
  const c01 = { Prometheus: (compose.match(/image:\s*prom\/prometheus:v?([\d.]+)/) || [])[1], 'prometheus-client': (req.match(/^prometheus-client==([\d.]+)/mi) || [])[1] };
  const labs = { Alertmanager: best(/prom\/alertmanager:v(\d+\.\d+\.\d+)/g), Grafana: best(/grafana\/grafana:(\d+\.\d+\.\d+)/g), 'kube-prometheus-stack': best(/kube-prometheus-stack (\d+\.\d+\.\d+)/g), KEDA: best(/KEDA v?(\d+\.\d+(?:\.\d+)?)/g) };
  Object.entries({ ...c01, ...labs }).forEach(([k, x]) => { if (!x) aviso(`el pie no encontró la versión de ${k}`); });
  const fmt = (o) => Object.entries(o).filter(([, x]) => x).map(([k, x]) => `${k} ${x}`).join(', ');
  return { c01: fmt(c01), labs: fmt(labs) };
})();
const N_EXEC = ORDER.filter((id) => byId[id].lab && byId[id].lab.verified === 'executed').length;
const N_LABS = ORDER.filter((id) => byId[id].lab).length;
const WRAP = `<div class="wrap">
  <header class="hero">
    <p class="kicker">Ronda de Diseño ML · Monitoreo · ejemplos de C01</p>
    <h1>${TITLE}</h1>
    <p class="lead">Para instrumentar un servicio, escribir con la documentación abierta las consultas de un dashboard y de una alerta, y diagnosticar «no data», «target down» o «la alerta nunca sonó». En el C01, Prometheus pasa cada 15 s por cada servicio, le pide sus números y los guarda como series de tiempo; las reglas convierten una consulta en una alerta, Alertmanager decide a quién avisar y Grafana dibuja. Cada sección trae la sintaxis como plantilla con variables, las piezas, un ejemplo real del curso, una figura, un truco para recordarla, la trampa típica y un laboratorio opcional. En la versión web, al final hay un diagnosticador de síntomas, un revisor de reglas de alerta y un quiz de errores.</p>
    <p class="legendrow"><span><i class="dot" style="background:var(--hi-soft);outline:1px solid var(--hi)"></i>Cómo recordarla</span><span><i class="dot" style="background:var(--warn-soft);outline:1px solid var(--warn)"></i>Trampa típica</span><span><var class="ph">variable</var>la cambias tú</span><span><i class="dot" style="background:var(--accent2)"></i>Ejemplos en verde</span><span>${placeHtml('Inspect → Query')}un lugar de la web: se abre, no se copia</span></p>
    <p class="legendrow"><span class="lgk">En las figuras:</span><span><i class="dot" style="background:var(--cnt)"></i>counter (el odómetro)</span><span><i class="dot" style="background:var(--gau)"></i>gauge (el medidor de gasolina)</span><span><i class="dot" style="background:var(--his)"></i>histogram (los cajones)</span><span><i class="dot" style="background:var(--okc)"></i>ok, up o resuelta</span><span><i class="dot" style="background:var(--pen)"></i>pending</span><span><i class="dot" style="background:var(--fire)"></i>firing, down o una cuenta que miente</span><span><i class="dot" style="background:var(--off)"></i>silenciada, inhibida o ignorada</span></p>
  </header>
  <nav class="toc" aria-label="Secciones"><ul>${NAV.map(([id, l]) => `<li><a href="#${id}">${esc(l)}</a></li>`).join('')}</ul></nav>
  ${ORDER.map(sectionHtml).join('\n')}
  ${toolsHtml()}
  <footer>Funciones, campos, defaults, puertos y mensajes revisados en octubre de 2026 contra la documentación oficial de Prometheus, Alertmanager, el Prometheus Operator, Grafana, prometheus_client y KEDA, contra el capítulo «Alerting on SLOs» del SRE Workbook de Google y contra los archivos de <code>reference/c01</code> del curso. Las versiones son las del C01 (${esc(VER.c01)}) y las de los laboratorios (${esc(VER.labs)}); cuando la versión actual cambia algo, la sección lo dice. De los ${N_LABS} laboratorios, ${N_EXEC} se corrieron de verdad en un Mac; los demás se verificaron contra la documentación. Si tu terminal dice otra cosa, créele a tu terminal.</footer>
</div>`;

const KATEX = '<script src="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.11/katex.min.js"></script><script id="render-math">document.querySelectorAll("[data-tex]").forEach(function (el) { katex.render(el.dataset.tex, el, { displayMode: el.classList.contains("mb"), output: "mathml", throwOnError: false, strict: "ignore" }); }); window.__math = document.querySelectorAll("[data-tex] math").length;</script>';
// Revisión del revisor en el build, en Chrome y con el mismo js-yaml de la página: el alerts.yml del C01 (y el mismo
// archivo como PrometheusRule, el comando del README) no dan hallazgos, el ejemplo con problemas dispara cada regla y cada
// ejemplo del contenido hace lo que dice (example_bad dispara su regla; example_good no dispara ninguna).
const CR_WRAP = 'apiVersion: monitoring.coreos.com/v1\nkind: PrometheusRule\nmetadata:\n  name: classifier\n  namespace: classifier\n  labels:\n    release: kube-prometheus-stack\nspec:\n' + C01_ALERTS.replace(/\n$/, '').split('\n').map((l) => '  ' + l).join('\n') + '\n';
const REV_TEST = { c01: C01_ALERTS, cr: CR_WRAP, bad: BAD_EXAMPLE, ex: RULES.map((r) => [r.id, r.example_bad, r.example_good]) };
const REV_CHECK = `<script src="${YAML_URL}"></script><script id="rev-check">${REVISOR_SRC}
window.__rev = (function () {
  var T = ${jsonForScript(REV_TEST)};
  if (!window.jsyaml) return { error: 'no cargó js-yaml' };
  function run(t) { var docs = jsyaml.loadAll(t), f = revisarReglas(docs), loc = ubicarReglas(t, docs); f.forEach(function (x) { x.line = loc(x); x.text = x.line ? t.split('\\n')[x.line - 1] : null; }); return f; }
  try {
    return {
      c01: run(T.c01).map(function (f) { return f.id + '@' + f.line; }),
      cr: run(T.cr).map(function (f) { return f.id + '@' + f.line; }),
      bad: run(T.bad).map(function (f) { return { id: f.id, rule: f.rule, line: f.line, text: f.text }; }),
      ex: T.ex.map(function (e) { var b = run(e[1]), g = run(e[2]); return { id: e[0], fired: b.filter(function (f) { return f.id === e[0]; }).length, good: g.map(function (f) { return f.id; }), lines: b.map(function (f) { return f.text; }) }; })
    };
  } catch (e) { return { error: String(e && e.stack || e) }; }
})();</script>`;

function writeSrc(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'head.html'), HEAD);
  writeFileSync(join(dir, 'wrap.html'), WRAP);
  writeFileSync(join(dir, 'script.js'), JS);
  writeFileSync(join(dir, 'revisor.cjs'), REVISOR_SRC + `\nvar REVISOR_RULES = ${jsonForScript(DATA.rules)};\nvar REVISOR_SAMPLES = ${jsonForScript(Object.fromEntries(Object.entries(SAMPLES).map(([k, v]) => [k, v.text])))};\nif (typeof module !== 'undefined') module.exports = { revisarReglas: revisarReglas, ubicarReglas: ubicarReglas, REVISOR_RULES: REVISOR_RULES, REVISOR_SAMPLES: REVISOR_SAMPLES };\n`);
  // src.html: sin el script de la página, para que el .wrap que se captura quede intacto (solo con el TeX renderizado).
  writeFileSync(join(dir, 'src.html'), '<!doctype html>\n<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' + HEAD + '</head><body>' + WRAP + KATEX + REV_CHECK + '</body></html>');
  const texN = (WRAP.match(/data-tex=/g) || []).length;
  console.log('src ok ·', (HEAD + WRAP + JS).length, 'bytes ·', texN, 'fórmulas ·', ORDER.length, 'secciones');
  console.log(`datos: ${ORDER.length} secciones · laboratorios ${N_LABS} (${N_EXEC} probados) · diagnosticador ${W3.diagnosticador.length} síntomas · revisor ${RULES.length} reglas · errores ${ERRS.length} mensajes · contenido de ${CONTENT}`);
  return texN;
}
// Lo que dijo el revisor en Chrome: avisos si algo no calza.
function revReport(v) {
  if (!v) { aviso('revisor: sin resultado de la revisión en Chrome'); return; }
  if (v.error) { aviso(`revisor: la revisión en Chrome falló: ${v.error}`); return; }
  if (v.c01.length) aviso(`revisor: alerts.yml del C01 da ${v.c01.length} hallazgos: ${v.c01.join(', ')}`);
  if (v.cr.length) aviso(`revisor: el C01 como PrometheusRule da ${v.cr.length} hallazgos: ${v.cr.join(', ')}`);
  const badIds = [...new Set(v.bad.map((f) => f.id))];
  RULES.filter((r) => !badIds.includes(r.id)).forEach((r) => aviso(`revisor: el ejemplo con problemas no dispara ${r.id}`));
  v.bad.forEach((f) => { if (!f.line) aviso(`revisor: ${f.id} sin línea en el ejemplo con problemas`); else if (f.rule && !/^#/.test(f.rule) && !String(f.text).includes(f.rule)) aviso(`revisor: ${f.id} apunta a la línea ${f.line} («${String(f.text).trim()}»), que no nombra a ${f.rule}`); });
  let fired = 0, quiet = 0;
  v.ex.forEach((e) => { if (e.fired) fired++; else aviso(`revisor: example_bad de ${e.id} no la dispara`); if (!e.good.length) quiet++; else aviso(`revisor: example_good de ${e.id} dispara ${e.good.join(', ')}`); });
  console.log(`revisor (Chrome, js-yaml de cdnjs): C01 alerts.yml ${v.c01.length} hallazgos · como PrometheusRule ${v.cr.length} · ejemplo con problemas ${v.bad.length} hallazgos (${badIds.length} de ${RULES.length} reglas) · example_bad que disparan ${fired}/${RULES.length} · example_good en silencio ${quiet}/${RULES.length}`);
}
function report() {
  if (AVISOS.length) { console.log(`avisos del contenido (${AVISOS.length}):`); AVISOS.forEach((a) => console.log('  - ' + a)); }
  else console.log('avisos del contenido: ninguno');
}
function pdf(pagePath) {
  const out = join(HERE, '..', 'cheatsheet-prometheus.pdf');
  const prof = mkdtempSync(join(tmpdir(), 'prom-pdf-'));
  const r = spawnSync(CHROME, ['--headless=new', '--no-pdf-header-footer', '--virtual-time-budget=10000', `--print-to-pdf=${out}`, `--user-data-dir=${prof}`, pathToFileURL(pagePath).href], { encoding: 'utf8', timeout: 180000 });
  try { rmSync(prof, { recursive: true, force: true }); } catch (e) { /* no importa */ }
  if (r.status !== 0 || !existsSync(out)) { console.error(r.stdout, r.stderr); throw new Error('Chrome no pudo imprimir el PDF'); }
  console.log('cheatsheet-prometheus.pdf listo');
}

const mode = process.argv[2] || 'build';
if (mode === 'cmds') {
  // para revisar a ojo cómo se parte cada texto con comandos: [código] «nota» ‹lugar›
  const show = (h) => h.replace(/<button[^>]*>Copiar<\/button>/g, '').replace(/<span class="ui"[^>]*>([\s\S]*?)<\/span><\/span>(?=<|$)/g, (m) => '‹' + m.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<span class="ui__a"[^>]*>›<\/span>/g, ' › ').replace(/<[^>]+>/g, '') + '›').replace(/<code class="cmd">([\s\S]*?)<\/code>/g, '[$1]').replace(/<span class="cmdn">([\s\S]*?)<\/span>/g, '«$1»').replace(/<span class="sep"> · <\/span>/g, ' · ').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  for (const g of W3.diagnosticador) { console.log(`\n# ${g.id}\n  first: ${show(cmdHtml(g.first))}`); g.causes.forEach((c) => console.log(`  check: ${show(cmdHtml(c.check))}`)); }
  console.log('\n# errores'); ERRS.forEach((e) => console.log(`  first: ${show(cmdHtml(e.first))}`));
  console.log('\n# cadenas'); ALL.forEach((x) => { const D = x.figure.data || {}; [...(D.steps || []), ...(D.branch ? [D.branch] : [])].forEach((s) => { if (s.cmd) console.log(`  ${x.id} (${s.tipo || cmdTipo(s.cmd)}): ${show(stepCode(s.cmd, s.tipo))}`); }); });
  process.exit(0);
}
if (mode === 'src') { writeSrc(process.argv[3] || join(HERE, 'out')); report(); }
else if (mode === 'build' || mode === 'pdf') {
  const out = join(HERE, 'out');
  writeSrc(out);
  const evalJs = "(async () => { for (let i = 0; i < 150 && (!window.__math || !window.__rev); i++) await new Promise(r => setTimeout(r, 100)); const errs = [...document.querySelectorAll('.katex-error')].map(e => e.getAttribute('title') || e.textContent).slice(0, 10); return JSON.stringify({ n: window.__math || 0, total: document.querySelectorAll('[data-tex]').length, errors: errs, rev: window.__rev || null, html: document.querySelector('.wrap').outerHTML }); })()";
  const r = spawnSync('node', [join(APP, 'tools/browser-check.mjs'), '--url', join(out, 'src.html'), '--wait', '1500', '--timeout', '120000', '--light', '--eval', evalJs], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const lineE = (r.stdout || '').split('\n').find((l) => l.startsWith('[eval] '));
  if (!lineE) { console.error(r.stdout, r.stderr); throw new Error('sin resultado del render'); }
  const v = JSON.parse(JSON.parse(lineE.slice(7)));
  console.log('math', v.n, 'de', v.total, '· errores', v.errors.length, v.errors);
  (r.stdout || '').split('\n').filter((l) => !l.startsWith('[eval] ')).forEach((l) => l && console.log('  ' + l));
  if (v.n !== v.total || v.errors.length) throw new Error('hay fórmulas sin renderizar');
  revReport(v.rev);
  const page = HEAD + '\n' + v.html + '\n<script>' + JS + '</script>';
  writeFileSync(join(out, 'artifact.html'), page);
  const pagePath = join(HERE, '..', 'cheatsheet-prometheus.html');
  writeFileSync(pagePath, '<!doctype html>\n<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' + HEAD + '</head><body>' + v.html + '\n<script>' + JS + '</script></body></html>');
  console.log('final', page.length, 'bytes');
  if (mode === 'pdf') pdf(pagePath);
  report();
} else { console.error('modo desconocido: ' + mode + ' (usa src, build, pdf o cmds)'); process.exit(2); }
