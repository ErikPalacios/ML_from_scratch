// Genera "Serving de LLMs con vLLM", novena hoja del sitio y hermana de las de Docker, Kubernetes, Git, Triton, el gateway
// y Prometheus (sheets/prometheus/fuentes/gen-prom.mjs, de donde sale este archivo): mismos tokens claro/oscuro, fuentes,
// hero, nav de chips, .pad con papel cuadriculado, fórmulas (KaTeX → MathML), tabla de piezas que se apila en el celular,
// ejemplo con botón de copiar, "Cómo recordarla" / "Trampa", laboratorios plegados, chips del curso y de las hojas hermanas
// (cada ancla revisada), CSS de impresión, diagnosticador y quiz de errores.
//
// Qué cambió respecto de gen-prom.mjs:
//   - sin revisor: no hay archivo que revisar, así que se fueron js-yaml, REV_CHECK y la interfaz rv-*;
//   - en su lugar, la calculadora de VRAM y KV cache (la clave calculadora de content-w1.json, un port de
//     capacity/vram_calc.py del C10): sus expresiones js se validan (solo expresiones: sin ;, =>, function ni asignaciones)
//     y se compilan aquí a funciones normales, las mismas en node y en la página (sin eval en el navegador); los checks
//     del contenido corren en node y otra vez en Chrome, en la pasada del build (window.__calc);
//   - figuras nuevas: prefill-decode, kv-cache, tokens, continuous, latency, parallel, quant y gateway, más chain y table;
//   - el resaltado suma los eventos SSE (data: {…} y data: [DONE]) y las métricas de vLLM con dos puntos
//     (vllm:num_requests_waiting) se leen como PromQL; el cmd de una cadena puede ser un valor, una línea del log, un
//     evento SSE, un request HTTP, una flag o un campo del JSON, y solo los comandos completos se copian.
//
// Las figuras se leen en un celular de 375 px sin scroll horizontal: son HTML que se acomoda solo (barras con anchos en %,
// grillas que pasan de columnas a filas); la única con curvas (la latencia contra la concurrencia) es SVG, con una variante
// angosta para el celular. A escala donde hay números: la línea de tiempo de un request, la memoria de cada GPU y de la
// réplica, la ventana de 8,192 tokens, las grillas de batching, la latencia del barrido y los bytes por precisión. Un color
// significa lo mismo en todas:
//   azul = pesos · violeta = KV cache · ámbar = prefill o espera en la cola · verde azulado = decode o tokens generados ·
//   verde = ok, libre o dentro del SLO · rojo = OOM, preemption, fuera del SLO o rechazado ·
//   gris = overhead, activaciones, reservado u ocioso.
//
// Uso:
//   node gen-vllm.mjs src <dir>   → <dir>/head.html, wrap.html, script.js y src.html (con KaTeX de cdnjs)
//   node gen-vllm.mjs build       → lo anterior en ./out, pasa [data-tex] a MathML estático con tools/browser-check.mjs
//                                   (de la app ml-system-design), corre los checks de la calculadora en Chrome y escribe
//                                   out/artifact.html (para el Artifact de claude.ai) y ../cheatsheet-vllm.html (la
//                                   página del sitio y la fuente del PDF)
//   node gen-vllm.mjs pdf         → build y además ../cheatsheet-vllm.pdf (Chrome headless, A4)
//   node gen-vllm.mjs cmds        → muestra cómo se parte cada texto con comandos: [código copiable] «nota» ‹lugar›
// El contenido está en content-w1/2/3.json de esta carpeta (VLLM_CONTENT=<carpeta> lee otra). El generador no lo
// cambia: al final lista los avisos del contenido (enlaces que no existen, figuras que no cierran, datos raros).
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '../../../../ml-system-design'); // módulos del curso, browser-check.mjs y reference/c10
const CONTENT = process.env.VLLM_CONTENT ? resolve(process.env.VLLM_CONTENT) : HERE;
const readJSON = (f) => JSON.parse(readFileSync(join(CONTENT, f), 'utf8'));
const W1 = readJSON('content-w1.json'), W2 = readJSON('content-w2.json'), W3 = readJSON('content-w3.json');
const C10 = join(APP, 'reference/c10');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
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
// {tp × pp}: un producto de variables también es una variable (las GPUs que pide un pod)
const PHX = /\{([A-Za-z_]\w*(?:\s×\s[A-Za-z_]\w*)+|[a-z]{2}(?:[-: ][a-z]{2})+)\}/g; // y la fecha de un log: {mm-dd hh:mm:ss}
const phs = (escaped) => escaped.replace(PH, (m, pre, name, off, str) => {
  if (pre === '$' || pre === '%') return m;
  if (str[off - 1] === '{' && str[off + m.length] === '}') return m; // {{name}}: plantilla, no variable
  return pre === '@' ? `@{<var class="ph">${name}</var>}` : `<var class="ph">${name}</var>`;
}).replace(PHX, (m, inner) => `<var class="ph">${inner}</var>`);
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
// Un número no se separa de su unidad al final de un renglón ("15 s", "68.4 GB", "40 ms", "2,250 tokens").
const nbu = (h) => h.replace(/(\d) (s|ms|µs|min|h|d|días|GB|GiB|MB|MiB|KB|KiB|TB\/s|GB\/s|B|Gi|%|req\/s|rps|tokens\/s|tok\/s|tokens|series|bytes|pods|req|GPUs|secuencias|bloques|capas|heads)(?=$|[\s.,;:)\]])/g, '$1&nbsp;$2');
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


// ---------------------------------------------------------------- comandos, consultas y lugares de la interfaz
// Un texto de "check" o "first" puede ser un comando (copiable), una consulta de PromQL (copiable: las métricas de vLLM
// llevan dos puntos, vllm:num_requests_waiting) o un lugar de la web (la página de un modelo en Hugging Face, un panel de
// Grafana): ese no se copia, se visita.
const CMD_WORDS = new Set(['git', 'kubectl', 'docker', 'aws', 'curl', 'echo', 'cat', 'grep', 'sed', 'awk', 'test', 'python', 'python3', 'pip', 'pip3', 'uv', 'cd', 'ls', 'cp', 'mv', 'export', 'env', 'jq', 'tail', 'head', 'bash', 'sh', 'find', 'mkdir', 'rm', 'source', 'printf', 'sort', 'wc', 'uniq', 'tr', 'tee', 'xargs', 'lsof', 'kill', 'pkill', 'ps', 'top', 'free', 'df', 'du', 'nproc', 'time', 'brew', 'helm', 'kind', 'sleep', 'touch', 'open', 'uvicorn', 'gunicorn', 'watch', 'for', 'while', 'seq', 'nc', 'dig', 'nslookup', 'wget', 'sha256sum', 'shasum', 'promtool',
  'vllm', 'nvidia-smi', 'nvcc', 'hf', 'huggingface-cli', 'pytest', 'openai', 'ray', 'torchrun', 'all_reduce_perf']);
const isCmdWord = (w) => CMD_WORDS.has(w) || /^python3(\.\d+)?$/.test(w) || /^\.\/[\w.-]+/.test(w);
const firstCmd = (s) => { const ws = String(s).trim().split(/\s+/); let k = 0; while (k < ws.length - 1 && /^[A-Z_][A-Z0-9_]*=\S*$/.test(ws[k])) k++; return ws[k] || ''; };
const PQ_FN = ['sum', 'rate', 'irate', 'increase', 'histogram_quantile', 'avg', 'max', 'min', 'count', 'topk', 'bottomk', 'absent', 'absent_over_time', 'changes', 'resets', 'delta', 'deriv', 'avg_over_time', 'max_over_time', 'min_over_time', 'last_over_time', 'count_over_time', 'sum_over_time', 'quantile_over_time', 'clamp_min', 'clamp_max', 'clamp', 'label_replace', 'vector', 'scalar', 'predict_linear', 'group', 'stddev', 'stdvar', 'count_values', 'sort', 'sort_desc', 'histogram_count', 'histogram_sum', 'histogram_fraction'];
// una función de PromQL o un selector con labels; los nombres de métrica aceptan dos puntos (vllm:kv_cache_usage_perc{…})
const PROMQL = new RegExp(`^(?:${PQ_FN.join('|')})(?:\\s+(?:by|without)\\s*\\([^)]*\\))?\\s*\\(|^[a-zA-Z_:][a-zA-Z0-9_:]*\\{`);
// Una serie sola también es una consulta: vllm:num_preemptions_total, una recording rule del C10
// (llm:gateway_ttft_p95:rate5m) o una métrica del gateway (llm_gateway_inflight). Solo nombres con dos puntos o con el
// prefijo del gateway: un snake_case suelto (desc_act, prompt_tokens, finish_reason) es un campo, no una métrica.
const BARE_METRIC = /^(?:[a-z_][a-z0-9_]*:[a-z0-9_:]*[a-z0-9_]|llm_gateway_[a-z0-9_]+|DCGM_FI_[A-Z0-9_]+)$/;
const CALL = /^[A-Za-z_][\w.]*\(/; // una llamada de Python: client.chat.completions.create(…)
const CUTS = [' (', ' en ', ' y, ', ' y ', ' o ', ' contra ', ' comparado con ', ' con ', ': ', ' → ', ' mientras ', ' para ', ' sobre ', ' # '];
// «…» fuera de las comillas: el comando está recortado (aws s3 sync … && …) y no corre si lo pegas; adentro de unas
// comillas es el texto que pones tú ("content": "…") y el comando sí corre.
function truncated(c) {
  let q = null;
  for (const ch of String(c)) { if (q) { if (ch === q) q = null; continue; } if (ch === '"' || ch === "'") { q = ch; continue; } if (ch === '…') return true; }
  return false;
}
// Parte por " · " (cada tramo es una cosa que mirar), pero no adentro de unas comillas: curl -w 'conecta … · primer byte …'
function splitDots(s) {
  const out = []; let q = null, cur = '';
  const t = String(s);
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === q) q = null; cur += ch; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (t.startsWith(' · ', i)) { out.push(cur); cur = ''; i += 2; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}
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
        const cmd = s.slice(0, i).trimEnd(), tail = (cmd.match(/[,;]$/) || [''])[0];
        return { cmd: cmd.slice(0, cmd.length - tail.length), note: tail + s.slice(i) };
      }
    }
  }
  return { cmd: s, note: '' };
}
// Lugares de la web: el primer nombre dice de quién es la pantalla (la página de un modelo en Hugging Face; un dashboard o
// Explore, de Grafana). El lugar termina antes de lo que lo explica: ": …", " (…)", ", …" o " del panel", " con la misma
// query". Si el contenido no usa ninguno, la leyenda del hero no lo muestra.
const UI_HOME = { 'Hugging Face': 'Hugging Face', Grafana: 'Grafana', Explore: 'Grafana', Dashboards: 'Grafana' };
const PLACE_RE = new RegExp(`^((?:${Object.keys(UI_HOME).join('|')})(?:\\s→\\s[^→:(,]+?)+)(?=$|:\\s|\\s\\(|,\\s|\\s(?:con|del|de la|en|para)\\s)`);
let UI_USED = false;
const splitPlace = (seg) => { const m = String(seg).trim().match(PLACE_RE); if (m) UI_USED = true; return m ? { place: m[1].trim(), note: String(seg).trim().slice(m[1].length) } : null; };
const ICON_UI = '<svg class="ui__ic" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="10" rx="1.6"/><path d="M1.5 5.5h13"/><path class="ui__ptr" d="M8.6 7.4l4.6 1.9-2 0.8-0.8 2z"/></svg>';
function placeHtml(place) {
  const parts = String(place).split(/\s*→\s*/), home = UI_HOME[parts[0]];
  const shown = home && home === parts[0] ? parts.slice(1) : parts; // "Hugging Face → Files": el dueño ya va arriba
  return `<span class="ui" title="${esc(`un lugar de la web${home ? ' de ' + home : ''}: se abre, no se copia`)}">${ICON_UI}${home ? `<span class="ui__home">${home}</span>` : ''}${shown.map((p) => `<span class="ui__p">${esc(p)}</span>`).join('<span class="ui__a" aria-hidden="true">›</span>')}</span>`;
}
const copyBtn = (text) => `<button class="cp" type="button"${text === undefined ? '' : ` data-copy="${esc(text)}"`}>Copiar</button>`;
// Un comando con «…» está recortado: se muestra, pero no se copia (pegado en la terminal no corre).
const cmdChip = (c) => `<span class="cmdw"><code class="cmd">${esc(c)}</code>${truncated(c) ? '' : copyBtn(c)}</span>`;
// La nota que sigue a un comando: si empezaba con ": " (el corte), pasa a " — " para no dejar dos puntos sueltos; si es
// " y <otro comando>" o " y, adentro, <otro comando>", ese otro comando también va como código copiable.
function cmdNote(n) {
  const m = String(n).match(/^(\s+(?:[yo]|con|comparado con)(?:,\s*[^,]{1,24},)?\s+)(.+)$/);
  if (m) { const c = splitCmd(m[2]); if (c) return `<span class="cmdn">${esc(m[1])}</span>${cmdChip(c.cmd)}${c.note ? cmdNote(c.note) : ''}`; }
  return `<span class="cmdn">${esc(String(n).replace(/^:\s+/, ' — ').replace(/^\s*#\s*/, ' — '))}</span>`;
}
// Texto de "check" o "first": cada tramo separado por " · " que empieza con un comando (o con "dónde: comando") se
// muestra como código copiable; un lugar de la web, como un lugar; el resto, como texto.
function cmdHtml(s) {
  return splitDots(s).map((seg) => {
    const pl = splitPlace(seg);
    if (pl) return `${placeHtml(pl.place)}${pl.note ? `<span class="cmdn">${esc(pl.note.replace(/^:\s+/, ' — '))}</span>` : ''}`;
    let pre = '', body = seg;
    if (!splitCmd(seg)) { const m = seg.match(/^([^:()]{1,70}):\s+(.+)$/); if (m && splitCmd(m[2])) { pre = m[1] + ': '; body = m[2]; } }
    const c = splitCmd(body);
    if (!c) return esc(seg);
    return `${pre ? `<span class="cmdn">${esc(pre)}</span>` : ''}${cmdChip(c.cmd)}${c.note ? cmdNote(c.note) : ''}`;
  }).join('<span class="sep"> · </span>');
}
const isPlaceOnly = (s) => splitDots(s).every((seg) => splitPlace(seg));
// El cmd de un eslabón de una cadena: qué es y dónde se escribe (o se lee). Si el contenido trae "tipo", manda; si no, se
// deduce del texto. En una cadena de vLLM no todo es un comando: "≈ 35.3 GB por GPU" es un valor, "GPU KV cache size: …"
// una línea del log, "data: {…}" un evento SSE, "POST /v1/chat/completions" un request, "--max-num-batched-tokens 8192"
// una flag y "finish_reason: "stop"" un campo del JSON. Solo los comandos y las consultas completas llevan Copiar.
const LOG_RE = /^(?:GPU KV cache size|Available KV cache memory|Engine \d+:|Maximum concurrency|Loading weights|Model loading took|(?:INFO|WARNING|ERROR|DEBUG)\b|\(EngineCore|torch\.OutOfMemoryError|CUDA out of memory|ValueError|RuntimeError|NCCL (?:INFO|WARN))/;
function cmdTipo(c) {
  const s = String(c).trim();
  if (splitPlace(s)) return 'ui';
  if (/^data:\s/.test(s)) return 'sse';
  if (/^(GET|POST|PUT|HEAD|DELETE)\s+(https?:\/\/|\/)/.test(s)) return 'http';
  if (isCmdWord(firstCmd(s))) return 'shell';
  if (/^--[a-z][a-z0-9-]*(?:[\s=]|$)/.test(s)) return 'flag';
  if (LOG_RE.test(s)) return 'log';
  if (/^(?:≈|~|\d[\d.,]*\s*(?:GB|GiB|MB|MiB|KiB|ms|s|tokens|%)(?:\s|$))/.test(s)) return 'valor';
  if (/^(?:nodeSelector|tolerations?|resources|env|volumeMounts|volumes|nvidia\.com\/gpu)\b/.test(s)) return 'yaml';
  if (/^[A-Z][A-Za-z0-9_]*\.[a-z_]+\(/.test(s)) return 'python';
  if (/^"?[a-z_]+"?:\s*(?:"|\d|\[|\{|true\b|false\b|null\b)/.test(s)) return 'json';
  if (/^[A-Za-z_][\w.-]*\s*:(\s|$)/.test(s) || /^[a-z_][a-z0-9_]*(\s+·\s+[a-z_][a-z0-9_]*)+$/.test(s)) return 'yaml';
  if (/\s→\s/.test(s)) return 'flujo';
  if (PROMQL.test(s) || BARE_METRIC.test(s)) return 'promql';
  return 'code';
}
const TIPO_L = { shell: 'terminal', promql: 'PromQL', python: 'Python', yaml: 'YAML', http: 'HTTP', sse: 'evento SSE', log: 'log', valor: 'valor', flag: 'flag', json: 'JSON', flujo: 'secuencia', code: 'código' };
const TIPO_T = { shell: 'un comando: va en la terminal', promql: 'una consulta: va en Prometheus o en Grafana', python: 'una línea de Python del cliente', yaml: 'campos del manifest (YAML)', http: 'el request HTTP que llega', sse: 'un evento del stream (Server-Sent Events): lo manda vLLM, no lo escribes', log: 'una línea del log de vLLM: la buscas, no la escribes', valor: 'un número de la cuenta, no un comando', flag: 'una flag de vllm serve', json: 'un campo del JSON de la respuesta', flujo: 'una secuencia de pasos, no un comando', code: 'código' };
function stepCode(cmd, tipo) {
  if (!cmd) return '';
  let t = tipo || cmdTipo(cmd);
  if (t !== 'ui' && !TIPO_L[t]) { aviso(`cadena: tipo desconocido «${t}» en «${String(cmd).slice(0, 40)}»; lo deduzco del texto`); t = cmdTipo(cmd); }
  if (t === 'ui') { const pl = splitPlace(cmd); return `<p class="cc">${pl ? placeHtml(pl.place) + (pl.note ? `<span class="cmdn">${esc(pl.note)}</span>` : '') : placeHtml(cmd)}</p>`; }
  let code = String(cmd), note = '';
  // la parte que explica no es código: "GET /health → 200" (la respuesta), "campo: valor → efecto"
  if (t === 'yaml' || t === 'http') { const k = [' → ', ' sobre '].map((x) => code.indexOf(x)).filter((x) => x > 0).sort((a, b) => a - b)[0]; if (k) { note = code.slice(k); code = code.slice(0, k); } }
  const copy = (t === 'shell' || t === 'promql' || t === 'python') && !truncated(code);
  const tag = `<span class="ktag ktag--${t}" title="${esc(TIPO_T[t] || '')}">${TIPO_L[t] || t}</span>`, nt = note ? `<span class="cmdn">${esc(note)}</span>` : '';
  // un comando, una línea del log o un evento largo va en un bloquecito a todo el ancho, con la etiqueta (y Copiar)
  // arriba: en un celular, apretado entre los dos, se partía letra por letra
  // un evento SSE con su data: y su JSON resaltados; una consulta, con sus funciones (Copiar lleva el texto tal cual)
  const shown = t === 'sse' ? hlSse(code) ?? esc(code) : t === 'promql' ? hlProm(code) : esc(code);
  if (code.length > 18) return `<p class="cc"><span class="qb qb--${t}"><span class="qb__bar">${tag}${copy ? copyBtn(code) : ''}</span><code class="cmd">${shown}</code></span>${nt}</p>`;
  return `<p class="cc"><span class="cmdw">${tag}<code class="cmd">${shown}</code>${copy ? copyBtn(code) : ''}</span>${nt}</p>`;
}

// ---------------------------------------------------------------- resaltado de código (ligero)
// subcomandos que se resaltan después del comando: kubectl rollout status, vllm bench serve, hf auth login, nvidia-smi topo
const CLI_SUB = new Set(['rollout', 'config', 'auth', 'create', 'set', 'image', 'run', 'logs', 'debug', 'get', 'describe', 'exec', 'top', 'check', 'test', 'compose', 'network', 'repo', 'serve', 'bench', 'download', 'login', 'whoami', 'topo', 'collect-env', 'chat', 'complete', 'port-forward', 'apply', 'delete', 'cp', 's3', 'sync']);
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
          st.sub = /^(kubectl|docker|git|pip|pip3|uv|promtool|helm|vllm|hf|huggingface-cli|nvidia-smi|aws)$/.test(t) ? 2 : 0;
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
// Un evento SSE (Server-Sent Events): "data: {json}" con el JSON resaltado, "data: [DONE]" como marca y los campos
// event:, id: y retry: como claves. Va en los bloques de texto (una salida de curl -N) y en los heredocs.
function hlSse(line) {
  const m = String(line).match(/^(data|event|id|retry):( ?)(.*)$/);
  if (!m) return null;
  const v = m[3];
  const body = m[1] !== 'data' ? esc(v) : v.trim() === '[DONE]' ? `<span class="tk-d">${esc(v)}</span>` : /^\s*[{[]/.test(v) ? hlJson(v) : esc(v);
  return `<span class="tk-k">${m[1]}:</span>${m[2]}${body}`;
}
function hlLine(line, lang, st) {
  if (lang === 'text') { const e = hlSse(line); if (e !== null) return e; }
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
const hlBody = (h) => (h.lang === 'python' ? hlPy(h.body.join('\n')) : h.lang === 'json' ? hlJson(h.body.join('\n')) : h.lang === 'yaml' ? hlYaml(h.body.join('\n')) : h.body.map((l) => hlSse(l) ?? esc(l)).join('\n'));
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
const LANG = { python: 'Python', bash: 'bash · zsh', text: 'texto', json: 'JSON', yaml: 'YAML', promql: 'PromQL', sse: 'SSE' };
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
// Una tabla chica de números que no se apila en el celular (cabe a 375 px): cada celda ya viene en HTML; hide = las
// columnas que se esconden en el celular (están en la figura de arriba); rowCls(i) = la clase de cada fila.
function miniTable(head, rows, { hide = [], rowCls = () => '' } = {}) {
  const h = (j) => (hide.includes(j) ? ' class="mt__hm"' : '');
  return `<div class="mt__w"><table class="mt"><thead><tr>${head.map((x, j) => `<th scope="col"${h(j)}>${x}</th>`).join('')}</tr></thead><tbody>${rows.map((r, i) => `<tr${rowCls(i) ? ` class="${rowCls(i)}"` : ''}>${r.map((c, j) => (j === 0 ? `<th scope="row"${h(j)}>${c}</th>` : `<td${h(j)}>${c}</td>`)).join('')}</tr>`).join('')}</tbody></table></div>`;
}
const noteP = (s) => (s ? `<p class="fig__note">${rx(s)}</p>` : '');
const notesList = (arr) => (arr && arr.length ? `<ul class="fig__notes">${arr.map((x) => `<li>${rx(x)}</li>`).join('')}</ul>` : '');

// ---------------------------------------------------------------- SVG (la única curva: la latencia contra la concurrencia)
const svgFig = (W, H, body, label, cls, maxW) => `<svg class="chart ${cls}" viewBox="0 0 ${W} ${r1(H)}" role="img" aria-label="${esc(label)}" preserveAspectRatio="xMidYMid meet"${maxW ? ` style="max-width:${maxW}px"` : ''}>${body}</svg>`;
const txt = (x, y, s, cls = 't', anchor = 'start') => `<text x="${r1(x)}" y="${r1(y)}" class="${cls}" text-anchor="${anchor}">${esc(s)}</text>`;
const line = (x1, y1, x2, y2, cls = 'ax') => `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" class="${cls}"/>`;
const rect = (x, y, w, h, cls, extra = '') => `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(Math.max(0, w))}" height="${r1(Math.max(0, h))}" class="${cls}" ${extra}/>`;
const path = (d, cls = 's-muted', extra = '') => `<path d="${d}" class="${cls}" fill="none" ${extra}/>`;
const dot = (x, y, r, cls) => `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r}" class="${cls}"/>`;
const poly = (pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${r1(x)},${r1(y)}`).join(' ');
// un paso "redondo" para un eje: 1, 2, 2.5 o 5 por potencia de 10, con unos `n` cortes
function niceStep(max, n = 4) { const raw = max / n, p = 10 ** Math.floor(Math.log10(raw)); return [1, 2, 2.5, 5, 10].map((k) => k * p).find((s) => s >= raw); }

// ---------------------------------------------------------------- piezas comunes de las figuras
// Una barra a escala hecha de segmentos, uno detrás de otro desde 0 (o desde `at`): azul = pesos, gris = overhead,
// violeta = KV cache (kvu: la parte en uso), gris rayado = reservado, verde = libre, rojo rayado = lo que no cabe, ámbar =
// prompt o prefill, verde azulado = salida o decode. `marks` son líneas verticales (el tope de vLLM, un límite).
function gbar(segs, scale, { marks = [], aria = '', cls = '' } = {}) {
  let acc = 0;
  const parts = segs.filter((s) => +s.v > 0).map((s) => {
    const l = s.at !== undefined ? +s.at : acc;
    acc = l + +s.v;
    const w = +s.v / scale;
    const t = s.text && w >= (s.min ?? 0.17) ? `<span class="gb__t">${s.text}</span>` : '';
    return `<span class="gb__s gb--${s.k}" style="left:${pct(l / scale)};width:${pct(w)}">${t}</span>`;
  }).join('');
  const mk = marks.map((m) => `<span class="gb__m gb__m--${m.k || 'lim'}" style="left:${pct(+m.at / scale)}"></span>`).join('');
  return `<div class="gb${cls ? ' ' + cls : ''}" role="img" aria-label="${esc(aria)}"><div class="gb__in">${parts}</div>${mk}</div>`;
}
// el eje de una barra: cortes cada `step`; el primero pegado a la izquierda y el último (con la unidad) a la derecha
function gaxis(scale, step, unit, fmt = fmtN) {
  const ticks = []; for (let v = 0; v <= scale + 1e-9; v += step) ticks.push(r2(v));
  const u = unit && unit.length <= 2 ? unit : '';
  return `<div class="gax" aria-hidden="true">${ticks.map((v, i) => `<span class="${i === 0 ? 'is-0' : i === ticks.length - 1 ? 'is-n' : ''}" style="left:${pct(v / scale)}">${fmt(v)}${i === ticks.length - 1 && u ? `&nbsp;${u}` : ''}</span>`).join('')}</div>`;
}
// el paso de un eje: uno "lindo" (1, 2, 2.5, 3, 4 o 5 por una potencia de 10, o 2,048) que divide la escala en partes iguales
function axStep(scale) {
  const c = [2048, 1024];
  for (let p = Math.floor(Math.log10(scale)) - 2; p <= Math.floor(Math.log10(scale)); p++) [1, 2, 2.5, 3, 4, 5].forEach((k) => c.push(k * 10 ** p));
  const fit = (lo, hi) => c.filter((st) => { const n = scale / st; return Math.abs(n - Math.round(n)) < 1e-9 && n >= lo && n <= hi; }).sort((a, b) => Math.abs(scale / a - 5) - Math.abs(scale / b - 5))[0];
  return fit(4, 6) || fit(3, 8) || niceStep(scale, 4);
}
// un máximo redondo para un eje: el primer múltiplo de un paso "lindo" que cubre a max
function niceMax(max, n = 4) { const st = niceStep(max, n); return { max: Math.ceil(max / st - 1e-9) * st, step: st }; }
// leyenda chica: [[clase del color, texto (HTML)], …]
// (el texto va en su propio span: en un flex, el span que no deja partir una flag quedaba como otro ítem, con hueco)
const kl = (items) => `<p class="kleg">${items.filter(Boolean).map(([k, t]) => `<span><i class="sw sw--${k}"></i><span>${t}</span></span>`).join('')}</p>`;
const gb = (x, d = 1) => `${fmtN(Number(x).toFixed(d).replace(/\.0+$/, ''))}&nbsp;GB`;
// "no cabe": un valor negativo nunca se dibuja como barra; va como chip rojo con su número
const noFit = (v, unit = 'GB') => `<span class="nofit">no cabe${v !== undefined && v !== null ? `: ${fmtN(v)}&nbsp;${unit}` : ''}</span>`;
// los enlaces de una fuente (texto con URLs): el texto escapado y cada URL como enlace chico
const linkify = (s) => esc(s).replace(/https?:\/\/[^\s)»,;]+[^\s)»,;.]/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u.replace(/^https?:\/\//, '')}</a>`);

// ================================================================ figuras
// que-es · prefill-decode: un request de soporte del C10 en el tiempo, a escala. Arriba, entero (de 0 al peor caso dentro
// del SLO): el prefill es un bloque y el decode, 249 pasos. Abajo, el primer segundo con cada token como una marca, para
// que se vea el TPOT; y los pisos teóricos del prefill y de un paso de decode, a la misma escala.
function figPrefillDecode(d) {
  const ph = d.phases || [], pre = ph.find((p) => p.id === 'prefill') || ph[0] || {}, dec = ph.find((p) => p.id === 'decode') || ph[1] || {};
  const ttft = +d.ttft_s, e2e = +d.e2e_s, tpot = +d.tpot_ms / 1000, nOut = +d.output_tokens, slo = d.slo || {};
  if (Math.abs(ttft + (nOut - 1) * tpot - e2e) > 0.02) aviso(`prefill-decode: TTFT + (${nOut} − 1) × TPOT = ${r2(ttft + (nOut - 1) * tpot)} s, pero e2e_s dice ${e2e}`);
  if (Math.abs(+pre.end_s - ttft) > 1e-9 || Math.abs(+dec.start_s - +pre.end_s) > 1e-9 || Math.abs(+dec.end_s - e2e) > 1e-9) aviso('prefill-decode: las fases no van de 0 al TTFT y del TTFT al E2E');
  if (slo.worst_e2e_s && Math.abs(+slo.ttft_p95_s + (nOut - 1) * slo.tpot_p95_ms / 1000 - slo.worst_e2e_s) > 0.02) aviso('prefill-decode: worst_e2e_s no es TTFT p95 + (n − 1) × TPOT p95');
  const z = d.zoom || {}, tt = z.token_times_s || [], [z0, z1] = z.window_s || [0, 1];
  tt.forEach((t, i) => { if (i && Math.abs(t - tt[i - 1] - tpot) > 1e-6) aviso(`prefill-decode: en el zoom, del token ${i} al ${i + 1} no hay ${d.tpot_ms} ms`); if (t < z0 || t > z1) aviso(`prefill-decode: el token en ${t} s se sale del zoom`); });
  if (tt.length && Math.abs(tt[0] - ttft) > 1e-9) aviso('prefill-decode: el primer token del zoom no cae en el TTFT');
  const { max: S } = niceMax(Math.max(e2e, +slo.worst_e2e_s || 0) * 1.02, 6);
  const P = (t) => pct(t / S), Z = (t) => pct((t - z0) / (z1 - z0));
  const fs = (s) => `${fmtN(r2(s))}&nbsp;s`;
  const marks = d.marks || [];
  const full = `<div class="pd__w"><p class="to__h">El request entero, a escala (de 0 a ${fmtN(S)} s)</p>
    <div class="pd__trk" role="img" aria-label="${esc(`Prefill de 0 a ${ttft} s, decode de ${ttft} a ${e2e} s${slo.worst_e2e_s ? `; el peor caso dentro del SLO termina en ${slo.worst_e2e_s} s` : ''}.`)}">
      <span class="pd__b pd--pre" style="left:0;width:${P(ttft)}"></span><span class="pd__b pd--dec" style="left:${P(ttft)};width:${P(e2e - ttft)}"><span class="pd__bt">${fmtN(nOut - 1)} pasos de decode</span></span>
      ${marks.map((m) => `<span class="pd__m" style="left:${P(m.at_s)}"></span>`).join('')}
      ${slo.ttft_p95_s ? `<span class="pd__s" style="left:${P(slo.ttft_p95_s)}"></span>` : ''}${slo.worst_e2e_s ? `<span class="pd__s" style="left:${P(slo.worst_e2e_s)}"></span>` : ''}
    </div>${gaxis(S, axStep(S), 's')}
    <ul class="pd__keys">${ph.map((p) => `<li><i class="sw sw--${p.id === 'prefill' ? 'pre' : 'dec'}"></i><span><b>${fs(+p.end_s - +p.start_s)}</b> ${tx(p.label)}${p.bound ? ` <span class="pd__bd">· ${tx(p.bound)}</span>` : ''}</span></li>`).join('')}
      ${marks.map((m) => `<li><i class="sw sw--mark"></i><span>${tx(m.label)}</span></li>`).join('')}
      ${slo.ttft_p95_s ? `<li><i class="sw sw--slo"></i><span><b>${fs(slo.ttft_p95_s)}</b> el SLO del TTFT (p95)${slo.worst_e2e_s ? ` · <b>${fs(slo.worst_e2e_s)}</b> el peor caso dentro de los dos SLOs: ${fmtN(slo.ttft_p95_s)} s + ${fmtN(nOut - 1)} × ${fmtN(slo.tpot_p95_ms)} ms` : ''}</span></li>` : ''}</ul></div>`;
  const F = d.floors || {};
  const zoom = `<div class="pd__z"><p class="to__h">${tx(z.label || 'el primer segundo')} (a escala, de ${fmtN(z0)} a ${fmtN(z1)} s)</p>
    <p class="pd__zl" aria-hidden="true"><span class="pd__zlt" style="width:${Z(ttft)}">TTFT = ${fmtN(ttft)}&nbsp;s</span><span class="pd__zlp">TPOT = ${fmtN(d.tpot_ms)}&nbsp;ms por token</span></p>
    <div class="pd__ztrk" role="img" aria-label="${esc(`Del 0 al ${z1} s: prefill hasta ${ttft} s y después un token cada ${d.tpot_ms} ms: ${tt.join(', ')} s.`)}">
      <span class="pd__b pd--pre" style="left:0;width:${Z(ttft)}"><span class="pd__bt">prefill</span></span><span class="pd__b pd--decsoft" style="left:${Z(ttft)};width:${Z(z1 - ttft + z0)}"></span>
      ${tt.map((t) => `<span class="pd__tk" style="left:${Z(t)}"></span>`).join('')}
      ${tt.length > 1 ? `<span class="pd__br" style="left:${Z(tt[0])};width:${pct((tt[1] - tt[0]) / (z1 - z0))}"></span>` : ''}
    </div>${gaxis(z1 - z0, (z1 - z0) / 4, 's', (v) => fmtN(r2(v + z0)))}
    ${F.prefill_ms || F.decode_step_ms ? `<ul class="pd__fl">${F.prefill_ms ? `<li><span class="pd__flt"><span class="pd__flb pd--pre" style="width:${pct(F.prefill_ms / 1000 / (z1 - z0))}"></span></span><span>piso teórico del prefill: ≈&nbsp;${fmtN(F.prefill_ms)}&nbsp;ms (el real: ${fmtN(ttft * 1000)}&nbsp;ms, con la cola)</span></li>` : ''}${F.decode_step_ms ? `<li><span class="pd__flt"><span class="pd__flb pd--dec" style="width:${pct(F.decode_step_ms / 1000 / (z1 - z0))}"></span></span><span>piso teórico de un paso de decode: ≈&nbsp;${fmtN(F.decode_step_ms)}&nbsp;ms (el real: ${fmtN(d.tpot_ms)}&nbsp;ms)</span></li>` : ''}</ul>` : ''}</div>`;
  return `<div class="pd">${full}${zoom}</div>${kl([['pre', 'prefill: lee el prompt (cómputo)'], ['dec', 'decode: un token por paso (memoria)'], ['mark', 'TTFT y E2E de este request'], ['slo', 'el SLO']])}`;
}

// memoria · kv-cache: la memoria de una réplica y de cada GPU, a escala (pesos, overhead, KV y el margen que vLLM no
// toca), lo que ocupan las conversaciones adentro del KV y tres variantes de la misma cuenta.
const KC_K = { pesos: 'wt', overhead: 'ov', kv: 'kv', libre: 'rs' };
function figKvCache(d) {
  const parts = d.parts || [], tot = +d.total_gb, G = d.per_gpu || {}, gp = G.parts || [];
  const sum = (a) => r2(a.reduce((s, p) => s + (+p.gb || 0), 0));
  [...parts, ...gp].forEach((p) => { if (!KC_K[p.id]) aviso(`kv-cache: no tengo color para la parte «${p.id}»`); });
  if (Math.abs(sum(parts) - tot) > 0.05) aviso(`kv-cache: las partes de la réplica suman ${sum(parts)} GB, no ${tot}`);
  if (G.total_gb && Math.abs(sum(gp) - +G.total_gb) > 0.05) aviso(`kv-cache: las partes de una GPU suman ${sum(gp)} GB, no ${G.total_gb}`);
  const nG = G.total_gb ? Math.round(tot / G.total_gb) : 1;
  gp.forEach((p) => { const q = parts.find((x) => x.id === p.id); if (q && Math.abs(q.gb - p.gb * nG) > 0.051) aviso(`kv-cache: ${p.id} por GPU (${p.gb} GB) × ${nG} no da los ${q.gb} GB de la réplica`); });
  const kv = parts.find((p) => p.id === 'kv') || { gb: 0 }, res = parts.find((p) => p.id === 'libre') || { gb: 0 };
  (d.kv_use || []).forEach((u) => { if (+u.gb > +kv.gb + 1e-9) aviso(`kv-cache: «${u.label}» (${u.gb} GB) no entra en los ${kv.gb} GB de KV`); });
  const order = (ps) => ['pesos', 'overhead', 'kv', 'libre'].map((id) => ps.find((p) => p.id === id)).filter(Boolean).concat(ps.filter((p) => !KC_K[p.id]));
  const segs = (ps) => order(ps).map((p) => ({ k: KC_K[p.id] || 'ov', v: +p.gb, text: gb(p.gb) }));
  const budget = tot - +res.gb, gBudget = G.total_gb ? +G.total_gb - +((gp.find((p) => p.id === 'libre') || {}).gb || 0) : 0;
  const util = r2(budget / tot);
  const legend = `<ul class="kc__lg">${order(parts).map((p) => `<li><i class="sw sw--${KC_K[p.id] || 'ov'}"></i><span><b>${gb(p.gb)}</b> ${tx(p.label || p.id)}</span></li>`).join('')}<li><i class="sw sw--lim"></i><span><b>${gb(budget)}</b> el tope de vLLM: ${fmtN(util)} × ${fmtN(tot)}&nbsp;GB</span></li></ul>`;
  const rep = `<div class="kc__r"><p class="to__h">La réplica: ${fmtN(nG)} GPUs, ${fmtN(tot)} GB (a escala)</p>${gbar(segs(parts), tot, { marks: [{ at: budget }], aria: `Réplica de ${tot} GB: ${order(parts).map((p) => `${p.label || p.id} ${p.gb} GB`).join(', ')}.` })}${gaxis(tot, axStep(tot), 'GB')}${legend}</div>`;
  const use = (d.kv_use || []).length ? `<div class="kc__u"><p class="to__h">Adentro de los ${gb(kv.gb)} de KV (a escala)</p><ul class="kc__ul">${d.kv_use.map((u) => `<li><p class="kc__ut">${tx(u.label)}</p><div class="kc__ub">${gbar([{ k: 'kvu', v: +u.gb }, { k: 'fr', v: +kv.gb - +u.gb }], +kv.gb, { aria: `${u.label}: ${u.gb} de ${kv.gb} GB` })}<span class="kc__uv"><b>${gb(u.gb)}</b> · ${fmtN(Math.round((u.gb / kv.gb) * 100))}&nbsp;%</span></div></li>`).join('')}</ul></div>` : '';
  const gpu = gp.length ? `<div class="kc__g"><p class="to__h">Cada GPU: ${fmtN(G.total_gb)} GB (a escala)</p>${gbar(segs(gp), +G.total_gb, { marks: gBudget ? [{ at: gBudget }] : [], aria: `Una GPU de ${G.total_gb} GB: ${order(gp).map((p) => `${p.id} ${p.gb} GB`).join(', ')}.` })}${gaxis(+G.total_gb, axStep(+G.total_gb), 'GB')}${G.blocks ? `<p class="kc__bl"><b>${fmtN(G.blocks)}</b> bloques de ${fmtN(G.block_tokens)} tokens = ${fmtN(G.blocks * G.block_tokens)} tokens de KV, los mismos en las ${fmtN(nG)} GPUs</p>` : ''}</div>` : '';
  const V = d.variants || [];
  const vMax = niceMax(Math.max(+kv.gb, ...V.map((v) => +v.kv_gb || 0)), 4).max;
  const vars = V.length ? `<div class="kc__v"><p class="to__h">La misma cuenta, cambiando una cosa (KV a escala, de 0 a ${fmtN(vMax)} GB)</p><ul class="kc__vl">${V.map((v) => {
    const bad = v.fits === false || +v.kv_gb <= 0;
    if (bad && +v.kv_gb > 0) aviso(`kv-cache: la variante «${v.label}» dice que no cabe, pero tiene ${v.kv_gb} GB de KV`);
    return `<li${bad ? ' class="is-no"' : ''}><p class="kc__ut">${tx(v.label)}</p><div class="kc__ub">${bad ? `<span class="kc__nf">${noFit(v.kv_gb)}</span>` : gbar([{ k: 'kv', v: +v.kv_gb }], vMax, { aria: `${v.label}: ${v.kv_gb} GB de KV` })}<span class="kc__uv">${bad ? '<b>0</b> secuencias' : `<b>${fmtN(v.sequences_2250)}</b> secuencias`}</span></div></li>`;
  }).join('')}</ul></div>` : '';
  return `<div class="kc">${rep}<div class="kc__2">${use}${gpu}</div>${vars}</div>${kl([['wt', 'pesos'], ['ov', 'overhead: activaciones, CUDA graphs y buffers'], ['kv', 'KV cache (adentro: la parte en uso)'], ['fr', 'KV libre'], ['rs', 'reservado: vLLM no lo toca'], ['lim', `el tope de ${tx('--gpu-memory-utilization')}`]])}`;
}

// tokens · tokens: tres partes. Cuántos tokens por palabra da cada tokenizer en inglés y en español (barras pareadas, a
// escala); el chat template de Llama 3.3 como una fila de piezas (las marcas especiales son chips: un token cada una); y la
// ventana de 8,192 tokens de un request de soporte, a escala.
const TPL_K = { especial: 'sp', rol: 'rol', plantilla: 'tpl', tuyo: 'own' };
function figTokens(d) {
  const F = d.fertility || {}, rows = F.rows || [], ex = F.example, Tp = d.template, Wn = d.window;
  const out = [];
  if (rows.length) {
    const { max: fx } = niceMax(Math.max(...rows.flatMap((r) => [+r.en, +r.es])), 4);
    const hl = rows.find((r) => r.highlight) || rows[0];
    if (ex && hl) {
      if (Math.abs(ex.words * hl.en - ex.en_tokens) > 1) aviso(`tokens: ${ex.words} palabras × ${hl.en} no dan ${ex.en_tokens} tokens`);
      if (Math.abs(ex.words * hl.es - ex.es_tokens) > 1) aviso(`tokens: ${ex.words} palabras × ${hl.es} no dan ${ex.es_tokens} tokens`);
    }
    const dpct = (r) => Math.round((r.es / r.en - 1) * 100);
    const row = (r) => `<li class="tz__r${r.highlight ? ' is-hl' : ''}"><p class="tz__n">${tx(r.tokenizer)}</p><p class="tz__bs"><span class="tz__b tz--en" style="width:${pct(r.en / fx)}"><span>${fmtN(r.en)}</span></span><span class="tz__b tz--es" style="width:${pct(r.es / fx)}"><span>${fmtN(r.es)}</span></span></p><p class="tz__d">+${dpct(r)}&nbsp;%</p></li>`;
    const exHtml = ex ? `<div class="tz__ex"><p class="tz__ext">${tx(ex.label)}: <b>${fmtN(ex.en_tokens)}</b> tokens en inglés contra <b>${fmtN(ex.es_tokens)}</b> en español (+${fmtN(Math.round((ex.es_tokens / ex.en_tokens - 1) * 100))}&nbsp;%)</p><p class="tz__exb"><span class="tz__b tz--en" style="width:${pct(ex.en_tokens / ex.es_tokens)}"><span>${fmtN(ex.en_tokens)}</span></span><span class="tz__b tz--es" style="width:100%"><span>${fmtN(ex.es_tokens)}</span></span></p></div>` : '';
    out.push(`<div class="tz__f"><p class="to__h">${tx(cap(F.unit || 'tokens por palabra'))}, a escala de 0 a ${fmtN(fx)}${F.corpus ? ` · ${tx(F.corpus)}` : ''}</p>
      <ol class="tz__rows">${rows.map(row).join('')}</ol>${exHtml}${F.source ? `<p class="tz__src">Fuente: ${linkify(F.source)}</p>` : ''}</div>`);
  }
  if (Tp && Tp.pieces) {
    const nSp = Tp.pieces.filter((p) => p.kind === 'especial').length;
    if (Tp.special_tokens !== undefined && nSp !== +Tp.special_tokens) aviso(`tokens: el template tiene ${nSp} piezas especiales, pero special_tokens dice ${Tp.special_tokens}`);
    Tp.pieces.forEach((p) => { if (!TPL_K[p.kind]) aviso(`tokens: tipo de pieza del template sin estilo: ${p.kind}`); });
    const piece = (p) => `<span class="tz__p tz--${TPL_K[p.kind] || 'tpl'}">${esc(p.text).replace(/\n/g, '<i class="tz__nl" aria-label="salto de línea">↵</i>')}</span>`;
    out.push(`<div class="tz__t"><p class="to__h">El chat template de ${tx(Tp.model)}: lo que de verdad lee el modelo</p><p class="tz__ps">${Tp.pieces.map(piece).join('')}</p>
      <p class="kleg"><span><span class="tz__p tz--sp">&lt;|…|&gt;</span>marca especial: 1 token${nSp ? ` (aquí, ${fmtN(nSp)})` : ''}</span><span><span class="tz__p tz--rol">rol</span>el rol del turno</span><span><span class="tz__p tz--tpl">texto</span>lo agrega la plantilla</span><span><span class="tz__p tz--own">texto</span>tus mensajes</span><span><i class="tz__nl">↵</i>salto de línea</span></p>
      ${Tp.note ? `<p class="fig__note">${rx(Tp.note)}</p>` : ''}${Tp.source ? `<p class="tz__src">Fuente: ${linkify(Tp.source)}</p>` : ''}</div>`);
  }
  if (Wn && Wn.segments) {
    const M = +Wn.max_model_len, K = { prompt: 'pre', salida: 'dec', reservado: 'rs', libre: 'fr' };
    const s = Wn.segments.reduce((a, x) => a + +x.tokens, 0);
    if (s !== M) aviso(`tokens: los segmentos de la ventana suman ${s}, no ${M}`);
    Wn.segments.forEach((x) => { if (!K[x.kind]) aviso(`tokens: tipo de segmento sin color: ${x.kind}`); });
    (Wn.marks || []).forEach((m) => { if (m.at < 0 || m.at > M) aviso(`tokens: la marca ${m.at} se sale de la ventana`); });
    const st = M % 2048 === 0 ? 2048 : niceMax(M, 4).step;
    out.push(`<div class="tz__w"><p class="to__h">La ventana de ${fmtN(M)} tokens de un request (a escala)</p>${gbar(Wn.segments.map((x) => ({ k: K[x.kind] || 'ov', v: +x.tokens })), M, { marks: (Wn.marks || []).map((m) => ({ at: m.at, k: 'cut' })), aria: Wn.segments.map((x) => `${x.label}: ${x.tokens} tokens`).join('; ') })}${gaxis(M, st, 'tokens')}
      <ul class="tz__wl">${Wn.segments.map((x) => `<li><i class="sw sw--${K[x.kind] || 'ov'}"></i><span><b>${fmtN(x.tokens)}</b> ${tx(x.label)}</span></li>`).join('')}${(Wn.marks || []).map((m) => `<li><i class="sw sw--cut"></i><span><b>${fmtN(m.at)}</b> ${tx(m.label)}</span></li>`).join('')}</ul></div>`);
  }
  return `<div class="tz">${out.join('')}</div>${kl([['en', 'inglés'], ['es', 'español'], ['pre', 'prompt (lo lee el prefill)'], ['dec', 'salida (la escribe el decode)'], ['rs', 'reservado para la salida'], ['fr', 'libre']])}`;
}

// batching · continuous: el batching estático contra el continuo como grillas de lugares × pasos, las dos a la misma
// escala (una columna = un paso), con cada celda del color de lo que hace: prefill (el primer token), decode o vacía.
function figContinuous(d) {
  const S = +d.slots, R = d.requests || [], modes = ['static', 'continuous'].filter((k) => d[k]);
  const N = Math.max(...modes.map((k) => +d[k].steps || 0));
  const parse = (c) => { const m = String(c).match(/^([A-Za-z]+)(\d+)$/); return m ? { id: m[1], n: +m[2] } : null; };
  const cellK = (c) => { const p = parse(c); return !p ? 'idle' : p.n === 1 ? 'pre' : 'dec'; };
  modes.forEach((k) => {
    const g = d[k], G = g.grid || [];
    if (G.length !== S) aviso(`continuous: ${k} tiene ${G.length} filas, no ${S} lugares`);
    G.forEach((row, i) => { if (row.length !== +g.steps) aviso(`continuous: ${k}, fila ${i + 1}: ${row.length} pasos, no ${g.steps}`); });
    const busy = G.flat().filter((c) => parse(c)).length;
    if (busy !== +g.busy) aviso(`continuous: ${k} tiene ${busy} celdas ocupadas, pero busy dice ${g.busy}`);
    if (Math.abs(busy / (S * g.steps) - +g.occupancy) > 0.006) aviso(`continuous: ${k}: ${busy} / (${S} × ${g.steps}) no da occupancy ${g.occupancy}`);
    R.forEach((r) => {
      const at = []; G.forEach((row, i) => row.forEach((c, j) => { const p = parse(c); if (p && p.id === r.id) at.push({ i, j, n: p.n }); }));
      if (at.length !== +r.tokens) aviso(`continuous: ${k}: ${r.id} aparece ${at.length} veces, pero tiene ${r.tokens} tokens`);
      if (at.some((x, q) => x.n !== q + 1 || x.i !== at[0].i || x.j !== at[0].j + q)) aviso(`continuous: ${k}: los tokens de ${r.id} no van seguidos en un mismo lugar`);
      const f = at.find((x) => x.n === 1);
      if (g.first_token_step && f && +g.first_token_step[r.id] !== f.j + 1) aviso(`continuous: ${k}: el primer token de ${r.id} está en el paso ${f.j + 1}, no en el ${g.first_token_step[r.id]}`);
    });
  });
  const grid = (k) => {
    const g = d[k], G = g.grid || [];
    const head = `<span class="cb__c0">paso</span>${Array.from({ length: N }, (_, j) => `<span class="cb__hd${j >= g.steps ? ' is-out' : ''}">${j + 1}</span>`).join('')}`;
    const rows = G.map((row, i) => `<span class="cb__c0">${i + 1}</span>${Array.from({ length: N }, (_, j) => (j < row.length ? `<span class="cb__c cb--${cellK(row[j])}">${parse(row[j]) ? esc(row[j]) : ''}</span>` : '<span class="cb__x"></span>')).join('')}`).join('');
    const late = Object.entries(g.first_token_step || {}).filter(([, s]) => s > 1);
    return `<div class="cb__g"><p class="cb__h">${tx(g.label)}</p><div class="cb__grid" style="--n:${N}" role="img" aria-label="${esc(`${g.label}: ${S} lugares × ${g.steps} pasos; ${g.busy} ocupados (${Math.round(g.occupancy * 100)} %).`)}">${head}${rows}</div>
      <p class="cb__st"><b>${fmtN(g.steps)} pasos</b> · ${fmtN(g.busy)} de ${fmtN(S * g.steps)} lugares con trabajo = <b class="cb__oc">${fmtN(Math.round(g.occupancy * 100))}&nbsp;%</b>${late.length ? ` · primer token de ${late.map(([id, s2]) => `${esc(id)} en el paso ${s2}`).join(' y de ')}` : ''}</p></div>`;
  };
  const req = R.length ? `<p class="cb__rq"><span class="k">${fmtN(R.length)} requests, ${fmtN(S)} lugares:</span> ${R.map((r) => `<span class="cb__rc"><b>${esc(r.id)}</b> ${fmtN(r.tokens)} tokens</span>`).join('')}</p>` : '';
  const L = d.legend || {};
  const legItems = Object.entries(L).map(([k, t]) => [k === '·' ? 'idle' : /1$/.test(k) ? 'pre' : 'dec', `<code>${esc(k)}</code> ${tx(t)}`]);
  return `<div class="cb">${req}${modes.map(grid).join('')}${(d.rules || []).length ? `<ul class="cb__ru">${d.rules.map((r) => `<li>${tx(r)}</li>`).join('')}</ul>` : ''}</div>${kl(legItems.length ? legItems : [['pre', 'prefill'], ['dec', 'decode'], ['idle', 'vacío']])}`;
}

// metricas · latency: el barrido del C10 (fixtures sintéticos): TTFT p95 y TPOT p95 contra la concurrencia, con la línea
// del SLO, la zona que cumple y el punto elegido. SVG ancho (dos paneles lado a lado) y angosto (uno arriba del otro).
function latPanel(pts, key, sloV, title, unit, ox, oy, W, H, chosen) {
  const L = 48, R = 12, T = 30, B = 34;
  const cMax = Math.max(...pts.map((p) => p.c)), xr = Math.ceil((cMax * 1.08) / 8) * 8;
  const { max: yMax, step: ySt } = niceMax(Math.max(sloV, ...pts.map((p) => p[key])) * 1.06, 4);
  const X = (c) => ox + L + (c / xr) * (W - L - R), Y = (v) => oy + T + (1 - v / yMax) * (H - T - B);
  let s = '';
  s += rect(X(0), Y(sloV), X(xr) - X(0), Y(0) - Y(sloV), 'f-in');
  for (let v = 0; v <= yMax + 1e-9; v += ySt) { s += line(X(0), Y(v), X(xr), Y(v), 'grid'); s += txt(X(0) - 6, Y(v) + 4, fmtN(r2(v)), 't', 'end'); }
  const xs = pts.map((p) => p.c);
  xs.forEach((c) => { s += line(X(c), Y(0), X(c), Y(0) + 4, 'ax'); s += txt(X(c), Y(0) + 17, String(c), 't', 'middle'); });
  s += line(X(0), Y(0), X(xr), Y(0), 'ax') + txt(X(xr), oy + H - 4, 'en vuelo (c)', 't', 'end');
  s += txt(ox + 6, oy + 14, title, 'tm tb', 'start');
  s += line(X(0), Y(sloV), X(xr), Y(sloV), 'l-slo') + txt(X(0) + 6, Y(sloV) - 6, `SLO ${fmtN(sloV)} ${unit}`, 'tok tb', 'start');
  s += path(poly(pts.map((p) => [X(p.c), Y(p[key])])), 's-ink', 'stroke-width="1.6"');
  pts.forEach((p) => { s += dot(X(p.c), Y(p[key]), 4, p[key] <= sloV ? 'f-ok' : 'f-fire'); });
  const ch = pts.find((p) => p.c === chosen);
  if (ch) { s += `<circle cx="${r1(X(ch.c))}" cy="${r1(Y(ch[key]))}" r="8.5" class="ring"/>`; s += txt(X(ch.c) - 11, Y(ch[key]) - 10, `${fmtN(r1(ch[key]))}`, 'tv', 'end'); }
  return s;
}
function latSvg(d, W) {
  const narrow = W < 500, pts = d.points || [], slo = d.slo || {}, c = (d.chosen || {}).c;
  const PW = narrow ? W : (W - 20) / 2, PH = narrow ? 228 : 250;
  const a = latPanel(pts, 'ttft_p95_ms', +slo.ttft_p95_ms, 'TTFT p95 (ms)', 'ms', 0, 0, PW, PH, c);
  const b = latPanel(pts, 'tpot_p95_ms', +slo.tpot_p95_ms, 'TPOT p95 (ms)', 'ms', narrow ? 0 : PW + 20, narrow ? PH + 14 : 0, PW, PH, c);
  return { s: a + b, H: narrow ? PH * 2 + 14 : PH };
}
function figLatency(d) {
  const pts = d.points || [], slo = d.slo || {}, ch = d.chosen || {};
  pts.forEach((p, i) => {
    const ok = p.ttft_p95_ms <= slo.ttft_p95_ms && p.tpot_p95_ms <= slo.tpot_p95_ms;
    if (ok !== !!p.ok) aviso(`latency: en c = ${p.c}, ok dice ${p.ok} pero TTFT p95 ${p.ttft_p95_ms} y TPOT p95 ${p.tpot_p95_ms} contra el SLO dan ${ok}`);
    if (p.goodput_rps > p.rps + 1e-9) aviso(`latency: en c = ${p.c} el goodput pasa el throughput`);
    if (i && p.c <= pts[i - 1].c) aviso('latency: los puntos no van en orden de c');
  });
  const per = pts.map((p) => p.output_tok_s / p.rps), pm = per.reduce((a, x) => a + x, 0) / (per.length || 1);
  if (per.some((x) => Math.abs(x - pm) > 0.01 * pm)) aviso('latency: tokens/s ÷ req/s no es el mismo en todos los puntos');
  const firstBad = pts.findIndex((p) => !p.ok), lastGood = firstBad < 0 ? pts[pts.length - 1] : pts[firstBad - 1];
  if (!lastGood || lastGood.c !== ch.c) aviso(`latency: el elegido es c = ${ch.c}, pero el último bueno antes del primer malo es c = ${lastGood ? lastGood.c : '—'}`);
  const cp = pts.find((p) => p.c === ch.c);
  if (cp && Math.abs(r2(cp.rps) - +ch.rps) > 0.006) aviso(`latency: chosen.rps ${ch.rps} no es el rps de c = ${ch.c} (${cp.rps})`);
  if (ch.planned_rps && Math.abs(r2(ch.rps * ch.planned_utilization) - ch.planned_rps) > 0.006) aviso('latency: planned_rps no es rps × planned_utilization');
  const aria = `Barrido: ${pts.map((p) => `c ${p.c}: TTFT p95 ${p.ttft_p95_ms} ms, TPOT p95 ${p.tpot_p95_ms} ms`).join('; ')}. SLO: ${slo.ttft_p95_ms} ms y ${slo.tpot_p95_ms} ms.`;
  const w = latSvg(d, 720), nw = latSvg(d, 340);
  const mk = (d.marks || []).map((m) => `<li><span class="lt__c${(pts.find((p) => p.c === m.c) || {}).ok ? ' is-ok' : ' is-bad'}">${fmtN(m.c)}</span><span>${tx(m.label)}</span></li>`).join('');
  // una tabla chica que no se apila: en el celular se esconden los p95 (están en la figura, arriba)
  const tbl = miniTable(['En vuelo', 'req/s', 'goodput', 'tokens/s', 'TTFT p95', 'TPOT p95'], pts.map((p) => [`<i class="mt__d" aria-hidden="true"></i>${fmtN(p.c)}<span class="sr">${p.ok ? ' (cumple)' : ' (no cumple)'}</span>`, fmtN(r2(p.rps)), fmtN(r2(p.goodput_rps)), fmtN(Math.round(p.output_tok_s)), `${fmtN(p.ttft_p95_ms)}&nbsp;ms`, `${fmtN(p.tpot_p95_ms)}&nbsp;ms`]), { hide: [4, 5], rowCls: (i) => `${pts[i].ok ? 'is-ok' : 'is-bad'}${pts[i].c === ch.c ? ' is-ch' : ''}` });
  const plan = ch.planned_rps ? `<p class="lt__pl">Se planea al ${fmtN(Math.round(ch.planned_utilization * 100))}&nbsp;%: ${fmtN(ch.rps)} × ${fmtN(ch.planned_utilization)} = <b>${fmtN(ch.planned_rps)} req/s</b> por réplica.</p>` : '';
  return `${svgFig(720, w.H, w.s, aria, 'fv-w', 900)}${svgFig(340, nw.H, nw.s, aria, 'fv-n', 470)}
    ${mk ? `<ul class="lt__mk">${mk}</ul>` : ''}${tbl}${plan}${d.source ? `<p class="tz__src">Datos: <code>${esc(d.source)}</code></p>` : ''}
    ${kl([['ok', 'cumple su SLO'], ['fire', 'fuera del SLO'], ['in', 'la zona que cumple'], ['ring', `el elegido: ${fmtN(ch.c)} en vuelo`]])}`;
}

// paralelismo · parallel: TP, PP y una copia por GPU en un nodo de 8 H100; cada una con sus GPUs agrupadas por réplica y la
// memoria de cada GPU a escala (los mismos colores que la figura de la memoria). Si no cabe, lo que se pasa va en rojo.
function figParallel(d) {
  const N = d.node || {}, Ls = d.layouts || [], lg = d.per_gpu_legend || {};
  const segsOf = (g) => {
    const tot = +g.total, rs = +g.reserved || 0, budget = tot - rs;
    const used = (+g.weights || 0) + (+g.overhead || 0) + (+g.kv || 0);
    const over = +g.over_by || 0;
    if (!over && Math.abs(used + rs - tot) > 0.051) aviso(`parallel: pesos + KV + overhead + reservado = ${r2(used + rs)} GB, no ${tot}`);
    if (over && Math.abs(used - budget - over) > 0.051) aviso(`parallel: lo que se pasa (${r2(used - budget)} GB) no es over_by (${over})`);
    const s = [{ k: 'wt', v: +g.weights || 0, text: gb(g.weights) }, { k: 'ov', v: +g.overhead || 0 }, { k: 'kv', v: +g.kv || 0, text: gb(g.kv) }];
    if (!over) return { segs: [...s, { k: 'rs', v: rs }], budget };
    // no cabe: lo que pasa del tope se pinta en rojo, encima del reservado; el resto del reservado sigue gris
    return { segs: [...s, { k: 'over', v: over, at: budget }, { k: 'rs', v: rs - over, at: budget + over }], budget };
  };
  const card = (L) => {
    const g = L.per_gpu_gb || {}, { segs, budget } = segsOf(g);
    if (N.gpus && L.replicas_per_node * L.gpus_per_replica !== +N.gpus) aviso(`parallel: ${L.name}: ${L.replicas_per_node} réplicas × ${L.gpus_per_replica} GPUs no llenan las ${N.gpus} del nodo`);
    if (L.fits && Math.abs(+g.kv * L.gpus_per_replica - +L.kv_gb_per_replica) > 0.051) aviso(`parallel: ${L.name}: KV por GPU × GPUs no da kv_gb_per_replica`);
    if (L.fits === !!g.over_by) aviso(`parallel: ${L.name}: fits y over_by no dicen lo mismo`);
    const gpus = Array.from({ length: L.replicas_per_node || 0 }, () => `<span class="pa__rep">${'<i class="pa__gpu"></i>'.repeat(L.gpus_per_replica || 0)}</span>`).join('');
    const ms = L.comm_ms || {}, fl = L.floor_ms || {};
    const cm = L.comm_mb_per_step ? Object.keys(L.comm_mb_per_step).map((k) => {
      const m = k.match(/^(decode|prefill)_(\d+)$/), lab = m ? `Un paso de ${m[1]} con ${fmtN(m[2])} tokens` : tx(k);
      const t = [ms.nvlink && ms.nvlink[k] !== undefined ? `<b>${fmtN(ms.nvlink[k])}&nbsp;ms</b> por NVLink` : '', ms.pcie_gen5 && ms.pcie_gen5[k] !== undefined ? `<b>${fmtN(ms.pcie_gen5[k])}&nbsp;ms</b> por PCIe Gen5` : ''].filter(Boolean).join(' contra ');
      return `<li>${lab}: <b>${fmtN(L.comm_mb_per_step[k])}&nbsp;MB</b> entre GPUs${t ? ` → ${t}` : ''}${fl[k] !== undefined ? `; el piso del paso es ${fmtN(fl[k])}&nbsp;ms` : ''}</li>`;
    }) : [];
    return `<div class="pa__c${L.fits ? '' : ' is-no'}"><p class="pa__n"><b>${tx(L.name)}</b>${L.fits ? '<span class="pa__ok">cabe</span>' : noFit(g.over_by !== undefined ? -g.over_by : undefined)}</p>
      <p class="pa__gs" role="img" aria-label="${esc(`${L.replicas_per_node} réplicas de ${L.gpus_per_replica} GPU por nodo`)}">${gpus}<span class="pa__gl">${fmtN(L.replicas_per_node)} × ${fmtN(L.gpus_per_replica)} GPU${L.gpus_per_replica > 1 ? 's' : ''}</span></p>
      <p class="pa__sp">${tx(L.split)}</p>
      <p class="to__h">Cada GPU, a escala (de 0 a ${fmtN(g.total)} GB)</p>${gbar(segs, +g.total, { marks: [{ at: budget }], aria: `${L.name}: ${['weights', 'kv', 'overhead', 'reserved'].map((k) => `${k} ${g[k]} GB`).join(', ')}${g.over_by ? `; se pasa por ${g.over_by} GB` : ''}` })}${gaxis(+g.total, axStep(+g.total), 'GB')}
      <p class="pa__kv">${L.fits ? `KV por réplica: <b>${gb(L.kv_gb_per_replica)}</b> · <b>${fmtN(L.seqs_2250)}</b> secuencias de 2,250 tokens` : `se pasa por <b>${gb(g.over_by)}</b> del tope (${gb(budget)} por GPU): sin lugar para el KV`}</p>
      <p class="pa__x"><span class="k">Comunicación:</span> ${tx(L.comm)}</p>
      ${cm.length ? `<ul class="pa__cm">${cm.join('')}</ul>` : ''}
      ${L.latency ? `<p class="pa__x"><span class="k">Latencia:</span> ${tx(L.latency)}</p>` : ''}
      <p class="pa__v">${tx(L.verdict)}</p></div>`;
  };
  const more = (d.more_tp || []).length ? `<div class="pa__m"><p class="to__h">Con más TP, en el mismo nodo</p>${miniTable(['TP', 'KV por réplica', 'Secuencias de 2,250', 'Réplicas por nodo'], d.more_tp.map((m) => [`TP=${fmtN(m.tp)}`, gb(m.kv_gb_per_replica), fmtN(m.seqs_2250), fmtN(m.replicas_per_node)]))}</div>` : '';
  const leg = kl([['wt', tx(lg.weights || 'pesos')], ['ov', tx(lg.overhead || 'overhead')], ['kv', tx(lg.kv || 'KV cache')], ['rs', tx(lg.reserved || 'reservado')], ['over', 'lo que no cabe'], ['lim', 'el tope de vLLM']]);
  return `${N.name ? `<p class="pa__node"><b>${tx(N.name)}</b>: ${fmtN(N.gpus)} × ${tx(N.gpu)} · ${tx(N.link)}</p>` : ''}<div class="pa">${Ls.map(card).join('')}</div>${more}${d.fleet ? `<p class="callout">${tx(d.fleet)}</p>` : ''}${leg}`;
}

// cuantizacion · quant: bytes por parámetro y la memoria del 70B en cada formato: en la réplica de 2 × H100 y en una sola
// H100, a escala (pesos, runtime y KV libre); lo que no cabe va en rojo y nunca como barra negativa. Abajo, los checkpoints
// reales y el error de redondeo de INT8 contra FP8 (con y sin un valor atípico).
function figQuant(d) {
  const Rp = d.replica || {}, Fm = d.formatos || [], kib = d.kv_por_token_kib || {};
  const G = +Rp.gpus, gpuGB = +Rp.gb_por_gpu, u = +Rp.gpu_memory_utilization, run = +Rp.runtime_gb_por_gpu;
  const B2 = +Rp.presupuesto_gb, B1 = r2(gpuGB * u);
  if (Math.abs(G * gpuGB * u - B2) > 0.05) aviso(`quant: ${G} × ${gpuGB} × ${u} no da presupuesto_gb ${B2}`);
  const P = Fm.length ? Fm[0].pesos_gb / Fm[0].bytes_por_param : 0;
  Fm.forEach((f) => {
    if (Math.abs(f.pesos_gb / f.bytes_por_param - P) > 0.06) aviso(`quant: ${f.formato}: pesos ÷ bytes no da los mismos parámetros que los demás`);
    const k2 = r1(B2 - f.pesos_gb - G * run);
    if (Math.abs(k2 - f.kv_libre_2xH100_gb) > 0.06) aviso(`quant: ${f.formato}: ${B2} − ${f.pesos_gb} − ${G} × ${run} = ${k2}, pero kv_libre_2xH100_gb dice ${f.kv_libre_2xH100_gb}`);
    if (f.kv_libre_1xH100_gb !== null && f.kv_libre_1xH100_gb !== undefined) { const k1 = r1(B1 - f.pesos_gb - run); if (Math.abs(k1 - f.kv_libre_1xH100_gb) > 0.06) aviso(`quant: ${f.formato}: ${B1} − ${f.pesos_gb} − ${run} = ${k1}, pero kv_libre_1xH100_gb dice ${f.kv_libre_1xH100_gb}`); }
    [['BF16', 'secuencias_2250_kv_bf16'], ['FP8', 'secuencias_2250_kv_fp8']].forEach(([t, key]) => {
      if (!kib[t]) return;
      const want = f.kv_libre_2xH100_gb > 0 ? Math.floor((f.kv_libre_2xH100_gb * 1e9) / (2250 * kib[t] * 1024)) : 0;
      if (want !== +f[key]) aviso(`quant: ${f.formato}: ${f.kv_libre_2xH100_gb} GB ÷ (2,250 × ${kib[t]} KiB) = ${want}, pero ${key} dice ${f[key]}`);
    });
  });
  const mx = niceMax(Math.max(B2, ...Fm.map((f) => f.pesos_gb + G * run)), 5);
  const sq = (b) => `<span class="qu__sq" aria-hidden="true">${'<i></i>'.repeat(Math.floor(b))}${b % 1 ? `<i class="is-half" style="--f:${b % 1}"></i>` : ''}</span>`;
  const barOf = (f, nG, budget, kvFree) => {
    if (kvFree === null || kvFree === undefined) return '<span class="qu__na">no aplica: los pesos solos pasan la memoria de la GPU</span>';
    const rt = nG * run, used = f.pesos_gb + rt;
    const segs = kvFree >= 0 ? [{ k: 'wt', v: f.pesos_gb, text: gb(f.pesos_gb) }, { k: 'ov', v: rt }, { k: 'kv', v: kvFree, text: gb(kvFree) }]
      : [{ k: 'wt', v: Math.min(f.pesos_gb, budget), text: gb(f.pesos_gb) }, ...(f.pesos_gb < budget ? [{ k: 'ov', v: budget - f.pesos_gb }] : []), { k: 'over', v: used - budget, at: budget }];
    return gbar(segs, mx.max, { marks: [{ at: budget }], aria: `${f.formato} en ${nG} H100: pesos ${f.pesos_gb} GB, runtime ${rt} GB, ${kvFree >= 0 ? `KV libre ${kvFree} GB` : `no cabe por ${-kvFree} GB`}; tope ${budget} GB` });
  };
  const row = (f) => `<li class="qu__r${f.kv_libre_2xH100_gb < 0 ? ' is-no' : ''}">
      <p class="qu__h"><b>${tx(f.formato)}</b>${sq(+f.bytes_por_param)}<span class="qu__bp">${fmtN(f.bytes_por_param)}&nbsp;B por parámetro</span><span class="qu__pw">pesos <b>${gb(f.pesos_gb)}</b>${f.checkpoint_real_gb ? ` · checkpoint real ${gb(f.checkpoint_real_gb)}` : ''}</span></p>
      <p class="qu__l">${fmtN(G)} × H100 (tope ${gb(B2)})</p>${barOf(f, G, B2, f.kv_libre_2xH100_gb)}
      <p class="qu__k">${f.kv_libre_2xH100_gb >= 0 ? `KV libre <b>${gb(f.kv_libre_2xH100_gb)}</b> → <b>${fmtN(f.secuencias_2250_kv_bf16)}</b> secuencias de 2,250 tokens con KV en BF16, <b>${fmtN(f.secuencias_2250_kv_fp8)}</b> con KV en FP8` : `${noFit(f.kv_libre_2xH100_gb)} sin lugar para el KV`}</p>
      <p class="qu__l">1 × H100 (tope ${gb(B1)})</p>${barOf(f, 1, B1, f.kv_libre_1xH100_gb)}
      ${gaxis(mx.max, axStep(mx.max), 'GB')}
      ${f.kv_libre_1xH100_gb !== null && f.kv_libre_1xH100_gb !== undefined ? `<p class="qu__k">${f.kv_libre_1xH100_gb >= 0 ? `KV libre <b>${gb(f.kv_libre_1xH100_gb)}</b>` : noFit(f.kv_libre_1xH100_gb)}</p>` : ''}
      ${f.nota ? `<p class="qu__n">${tx(f.nota)}</p>` : ''}</li>`;
  const head = `<p class="qu__m">${tx(cap(d.modelo || ''))}. Una réplica: ${fmtN(G)} × ${fmtN(gpuGB)}&nbsp;GB × ${fmtN(u)} = <b>${gb(B2)}</b> para vLLM, con ≈&nbsp;${gb(run)} de runtime por GPU.${kib.BF16 ? ` KV por token: ${fmtN(kib.BF16)}&nbsp;KiB en BF16${kib.FP8 ? `, ${fmtN(kib.FP8)}&nbsp;KiB en FP8` : ''}.` : ''}</p>`;
  const ck = (d.checkpoints_reales || []).length ? `<div class="qu__ck"><p class="to__h">Los checkpoints reales</p><ul>${d.checkpoints_reales.map((c) => `<li><code>${esc(c.repo)}</code><span>${tx(c.dtype)}${c.parametros ? ` · ${fmtN(c.parametros)} parámetros` : ''} · <b>${gb(c.gb)}</b></span></li>`).join('')}</ul></div>` : '';
  let rd = '';
  const Rd = d.redondeo;
  if (Rd) {
    const grp = (lab, o) => {
      const ks = Object.keys(o).filter((k) => !/^error_/.test(k));
      return `<li><p class="qu__rl">${lab}</p><ul class="qu__eb">${ks.map((k) => { const e = o[`error_${k}`]; return `<li><span class="qu__ek">${tx(k)} → <b>${fmtN(o[k])}</b></span><span class="qu__et">${e !== undefined ? `<span class="qu__ev" style="width:${pct(e)}"></span>` : ''}</span><span class="qu__en">${e !== undefined ? `${fmtN(r1(e * 100))}&nbsp;%` : ''}</span></li>`; }).join('')}</ul></li>`;
    };
    const med = Rd.mediana_4096_pesos_con_atipico;
    rd = `<div class="qu__rd"><p class="to__h">Redondear ${fmtN(Rd.valor)} a 8 bits: lo que se guarda y su error relativo (a escala, de 0 a 100 %)</p><ul class="qu__rg">${Rd.sin_atipico ? grp('sin un valor atípico en el tensor', Rd.sin_atipico) : ''}${Rd.con_atipico_25 ? grp('con un atípico de 25 en el mismo tensor', Rd.con_atipico_25) : ''}${med ? `<li><p class="qu__rl">mediana del error en 4,096 pesos con un atípico</p><ul class="qu__eb">${Object.entries(med).map(([k, e]) => `<li><span class="qu__ek">${tx(k)}</span><span class="qu__et"><span class="qu__ev" style="width:${pct(e)}"></span></span><span class="qu__en">${fmtN(r1(e * 100))}&nbsp;%</span></li>`).join('')}</ul></li>` : ''}</ul></div>`;
    ['sin_atipico', 'con_atipico_25'].forEach((g) => { const o = Rd[g]; if (!o) return; ['INT8', 'FP8'].forEach((k) => { if (o[k] !== undefined && o[`error_${k}`] !== undefined && Math.abs(Math.abs(o[k] - Rd.valor) / Rd.valor - o[`error_${k}`]) > 0.002) aviso(`quant: redondeo ${g}: |${o[k]} − ${Rd.valor}| ÷ ${Rd.valor} no da error_${k} ${o[`error_${k}`]}`); }); });
  }
  return `${head}<p class="to__h">Cada formato, a escala (todas las barras van de 0 a ${fmtN(mx.max)} GB)</p><ol class="qu">${Fm.map(row).join('')}</ol><div class="qu__2">${ck}${rd}</div>
    ${kl([['wt', 'pesos'], ['ov', 'runtime: activaciones, CUDA graphs y buffers'], ['kv', 'KV libre'], ['over', 'lo que no cabe'], ['lim', 'el tope de vLLM']])}`;
}

// gateway-llm · gateway: un request de soporte por el llm-gateway del C10, de arriba abajo: cada etapa con su tiempo y el
// código que devuelve si falla (en rojo). A la derecha, el stream que vuelve por el mismo camino. Abajo, los topes, los
// timeouts a escala y los tenants.
const GW_K = (e) => (/admisi/i.test(e) ? 'pre' : /stream/i.test(e) ? 'dec' : /cierre/i.test(e) ? 'ok' : /^vllm/i.test(e) ? 'pool' : 'plain');
const HUMAN = { en_vuelo_por_replica_del_gateway: 'en vuelo por réplica del gateway', reservados_interactive: 'reservados para interactive', cola_interactive: 'cola de interactive (lugares · espera máxima)', cola_batch: 'cola de batch (lugares · espera máxima)', retry_after_s: 'Retry-After', conectar: 'conectar', primer_token: 'hasta el primer token', silencio_entre_eventos: 'silencio entre dos eventos', request_sin_stream: 'un request sin stream' };
const human = (k) => HUMAN[k] || String(k).replace(/_/g, ' ');
function figGateway(d) {
  const E = d.etapas || [], known = ['cliente', 'etapas', 'topes', 'timeouts_s', 'tenants'];
  const chips = (s) => String(s || '').split(' · ').filter((x) => x.trim()).map((x) => { const m = x.match(/^(.*?)\s*(\([^)]*\))$/); return `<span class="gw__f">${tx(m ? m[1] : x)}</span>${m ? `<span class="gw__fn">${tx(m[2])}</span>` : ''}`; }).join('');
  const iV = E.findIndex((e) => /^vllm/i.test(e.etapa)), iS = E.findIndex((e) => /stream/i.test(e.etapa));
  if (iV < 0) aviso('gateway: ninguna etapa es vLLM; dibujo el request sin el stream de vuelta');
  const cm = String(d.cliente || '').match(/^([^:]{1,30}):\s+(.+)$/);
  const cli = `<div class="gw__cl"><p class="gw__ct"><span class="k">El cliente${cm ? ` · ${tx(cm[1])}` : ''}</span></p><p><code>${esc(cm ? cm[2] : d.cliente || '')}</code></p></div>`;
  const st = E.map((e, i) => `<li class="gw__e gw--${GW_K(e.etapa)}" style="grid-row:${i + 2}"><p class="gw__eh"><span class="gw__no">${i + 1}</span><b>${tx(e.etapa)}</b>${e.tiempo ? `<span class="gw__t">${tx(e.tiempo)}</span>` : ''}</p><p class="gw__x">${tx(e.hace)}</p>${e.si_falla ? `<p class="gw__fs"><span class="k">Si falla:</span> ${chips(e.si_falla)}</p>` : ''}</li>`).join('');
  const back = iV >= 0 ? `<li class="gw__up" style="grid-row:1 / span ${Math.max(iV, iS) + 2}" aria-hidden="true"><span class="gw__upt">el stream vuelve</span></li>` : '';
  const down = `<li class="gw__dn" style="grid-row:1 / span ${Math.max(1, iV + 2)}" aria-hidden="true"><span class="gw__dnt">el request baja</span></li>`;
  const flow = `<ol class="gw" role="list" aria-label="${esc(`Etapas del gateway: ${E.map((e) => e.etapa).join(', ')}`)}"><li class="gw__c0" style="grid-row:1">${cli}</li>${st}${down}${back}</ol>`;
  const T = d.topes;
  const topes = T ? `<div class="gw__b"><p class="to__h">Los topes</p><ul class="gw__kv">${Object.entries(T).map(([k, v]) => (typeof v === 'object' && v ? `<li><span>${tx(human(k))}:</span> ${Object.entries(v).map(([a, b]) => `<b>${fmtN(b)}&nbsp;s</b> en ${esc(a)}`).join(' · ')}</li>` : `<li><b>${tx(typeof v === 'number' ? fmtN(v) : v)}</b> <span>${tx(human(k))}</span></li>`)).join('')}</ul></div>` : '';
  const TO = d.timeouts_s;
  let tos = '';
  if (TO) { const m = { max: Math.max(...Object.values(TO).map(Number)) }; tos = `<div class="gw__b"><p class="to__h">Los timeouts del gateway, a escala (de 0 a ${fmtN(m.max)} s)</p><ul class="gw__to">${Object.entries(TO).map(([k, v]) => `<li><span class="gw__tl">${tx(human(k))}</span><span class="gw__tt"><span style="width:${pct(v / m.max)}"></span></span><span class="gw__tv">${fmtN(v)}&nbsp;s</span></li>`).join('')}</ul></div>`; }
  const TN = d.tenants || [];
  const ten = TN.length ? `<div class="gw__tn"><p class="to__h">Los tenants (tenants.yaml)</p>${dataTable(['Tenant', 'Clase', 'Tokens por minuto', 'max_tokens', 'Prompt máximo', '¿Vendor?'], TN.map((t) => [t.tenant, t.clase, fmtN(t.tokens_por_min), fmtN(t.max_tokens), fmtN(t.max_prompt), t.vendor ? 'sí' : 'no']), { cls: 'wide5', mono: [0] })}</div>` : '';
  const extra = Object.keys(d).filter((k) => !known.includes(k));
  extra.forEach((k) => aviso(`gateway: la clave «${k}» no tiene dibujo propio; va como lista`));
  const ex = extra.map((k) => `<div class="gw__b"><p class="to__h">${tx(human(k))}</p><pre class="gw__raw">${esc(JSON.stringify(d[k], null, 1))}</pre></div>`).join('');
  return `${flow}<div class="gw__g">${topes}${tos}</div>${ten}${ex}${kl([['pre', 'espera en la cola'], ['pool', 'vLLM'], ['dec', 'el stream: tokens que vuelven'], ['ok', 'cierre'], ['fire', 'el código si falla']])}`;
}

// cadena, arrancar, api y diagnostico · chain: los pasos en orden, agrupados (en la pista de arriba) por quién los hace o
// por fase. Cada cmd dice qué es: un comando, una consulta, una línea del log, un evento SSE, un valor… Los números de cada
// paso llevan el color de lo que hacen donde eso significa algo: ámbar la cola y el prefill, violeta el KV, verde azulado
// el decode y los tokens, azul los pesos, verde el final bueno.
const CHAIN = {
  cadena: { g: (s) => (/^Cliente/.test(s.label) ? 'cli' : /tokenizer|SSE/i.test(s.label) ? 'api' : /^(Prefill|KV cache|Decode)/.test(s.label) ? 'gpu' : 'eng'), c: (s) => (/^(Cola|Prefill)/.test(s.label) ? 'pre' : /^KV/.test(s.label) ? 'kv' : /^Decode|SSE/.test(s.label) ? 'dec' : /^Fin/.test(s.label) ? 'ok' : '') },
  arrancar: { g: (s) => (/Scheduling|Init/i.test(s.label) ? 'k8s' : /Listo/i.test(s.label) ? 'up' : /Apagado/i.test(s.label) ? 'down' : 'vllm'), c: (s) => (/Pesos/.test(s.label) ? 'wt' : /KV/.test(s.label) ? 'kv' : /Listo/.test(s.label) ? 'ok' : '') },
  api: { g: (s) => (/rol/.test(s.label) ? 'first' : /usage|^fin/i.test(s.label) ? 'end' : 'tok'), c: (s) => (/rol/.test(s.label) ? 'pre' : /usage|^fin/i.test(s.label) ? '' : 'dec') },
  diagnostico: { g: (s) => (/^Cliente/.test(s.label) ? 'cli' : /^(Gateway|Admisi)/.test(s.label) ? 'gw' : /^vLLM/.test(s.label) ? 'vllm' : /^GPU/.test(s.label) ? 'gpuh' : 'k8s'), c: () => '' },
};
const GL = { cli: 'el cliente', api: 'API server', eng: 'engine core', gpu: 'workers de GPU', k8s: 'Kubernetes', vllm: 'vLLM', up: 'en servicio', down: 'apagado', first: 'después del prefill', tok: 'un evento por token', end: 'el cierre', gw: 'el gateway', gpuh: 'la GPU' };
function figChain(d, sec) {
  const all = d.steps || [];
  const isBranch = (s) => /aparte/i.test(s.label || '');
  const st = all.filter((s) => !isBranch(s)), br = d.branch || all.find(isBranch);
  const C = CHAIN[sec] || { g: () => 'step', c: () => '' };
  if (!CHAIN[sec]) aviso(`cadena: la sección ${sec} no tiene grupos propios`);
  // "1 · Scheduling": el número ya lo pone la figura
  const lab = (s) => String(s.label).replace(/^\d+\s*·\s*/, '');
  st.forEach((s, i) => { const m = String(s.label).match(/^(\d+)\s*·/); if (m && +m[1] !== i + 1) aviso(`cadena ${sec}: el paso «${s.label}» está en el lugar ${i + 1}`); });
  const group = (i) => C.g(st[i]);
  const groups = [];
  st.forEach((s, i) => { const g = group(i); if (!groups.length || groups[groups.length - 1].g !== g) groups.push({ g, items: [] }); groups[groups.length - 1].items.push(i); });
  const pill = (i) => { const g = group(i), t = lab(st[i]); return g === 'vllm' && /^vLLM:\s*/.test(t) ? t.replace(/^vLLM:\s*/, '') : t; };
  const track = `<div class="ch__tr">${groups.map((G) => `<div class="ch__grp ch--${G.g}"><p class="ch__gl">${esc(GL[G.g] || G.g)}</p><p class="ch__gi">${G.items.map((i) => `<span class="ch__tp"><b class="${C.c(st[i]) ? 'c--' + C.c(st[i]) : ''}">${i + 1}</b>${esc(pill(i))}</span>`).join('<span class="ch__ta" aria-hidden="true">→</span>')}</p></div>`).join('<span class="ch__ga" aria-hidden="true">→</span>')}${br ? `<div class="ch__grp ch--br"><p class="ch__gl">rama aparte</p><p class="ch__gi"><span class="ch__tp"><b>·</b>${esc(String(br.label).replace(/\s*\(aparte\)\s*/i, ''))}</span></p></div>` : ''}</div>`;
  const step = (s, i) => { const c = C.c(s); return `<li class="ch__s${c ? ' c--' + c : ''}"><span class="ch__no" aria-hidden="true">${i + 1}</span><p class="ch__l">${esc(lab(s))}<span class="ch__who">${esc(GL[group(i)] || '')}</span></p>${s.ask ? `<p class="ch__ask">${tx(s.ask)}</p>` : ''}${stepCode(s.cmd, s.tipo)}${s.note ? `<p class="ch__n">${tx(s.note)}</p>` : ''}</li>`; };
  const list = `<ol class="ch">${st.map(step).join('')}</ol>`;
  const brHtml = br ? `<div class="ch__br"><p class="ch__l"><span class="ch__bk">rama aparte</span>${esc(String(br.label).replace(/\s*\(aparte\)\s*/i, ''))}</p>${br.ask ? `<p class="ch__ask">${tx(br.ask)}</p>` : ''}${stepCode(br.cmd, br.tipo)}${br.note ? `<p class="ch__n">${tx(br.note)}</p>` : ''}</div>` : '';
  const tipos = [...new Set([...st, ...(br ? [br] : [])].filter((s) => s.cmd).map((s) => (s.tipo && TIPO_L[s.tipo] ? s.tipo : cmdTipo(s.cmd || ''))))].filter((t) => TIPO_L[t] || t === 'ui');
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
  bolsillo: [['estimaciones', 'Formulario de estimaciones', 'vram', 'memoria de GPU']],
  cadena: [['recorrido', 'Del dato a producción', 'pat-llm', 'el patrón LLM']],
  'que-es': [['triton', 'De PyTorch a Triton', 'serving', 'qué es servir un modelo']],
  memoria: [['estimaciones', 'Formulario de estimaciones', 'vram', 'memoria de GPU']],
  arrancar: [['kubernetes', 'Kubernetes', 'scheduling', 'GPUs y scheduling'], ['kubernetes', 'Kubernetes', 'probes', 'probes y apagado'], ['docker', 'Docker', 'gpu', 'GPU en contenedores']],
  api: [['gateway', 'El gateway', 'contrato', 'contrato y 499'], ['gateway', 'El gateway', 'upstream', 'timeouts y reintentos']],
  batching: [['triton', 'De PyTorch a Triton', 'batching', 'dynamic batching']],
  metricas: [['prometheus', 'Prometheus y Grafana', 'histogramas', 'histogramas y percentiles']],
  cuantizacion: [['triton', 'De PyTorch a Triton', 'tensorrt', 'precisión en TensorRT']],
  optimizar: [['kubernetes', 'Kubernetes', 'autoscaling', 'autoscaling con KEDA']],
  'gateway-llm': [['gateway', 'El gateway', 'backpressure', 'admisión'], ['gateway', 'El gateway', 'upstream', 'timeouts y reintentos'], ['gateway', 'El gateway', 'salud', 'apagado ordenado']],
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

const ORDER = ['bolsillo', 'cadena', 'que-es', 'tokens', 'memoria', 'arrancar', 'api', 'batching', 'metricas', 'paralelismo', 'cuantizacion', 'optimizar', 'gateway-llm', 'diagnostico', 'errores'];
const EXPECT = [0, null, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
ORDER.forEach((id, i) => { if (!byId[id]) throw new Error('falta la sección ' + id); if (byId[id].num !== EXPECT[i]) throw new Error(`num inesperado en ${id}: ${byId[id].num}`); });
ALL.forEach((x) => { if (!ORDER.includes(x.id)) aviso(`sección de más (no la muestro): ${x.id}`); });
const SECLAB = (id) => { const x = byId[id]; return `${x.num === null ? 'La cadena' : 'Sección ' + x.num} · ${x.title}`; };
const NAVL = { bolsillo: 'Bolsillo', cadena: 'La cadena', 'que-es': '1 · Qué es', tokens: '2 · Tokens', memoria: '3 · Memoria', arrancar: '4 · Arrancar', api: '5 · API', batching: '6 · Batching', metricas: '7 · Métricas', paralelismo: '8 · Paralelismo', cuantizacion: '9 · Cuantización', optimizar: '10 · Optimizar', 'gateway-llm': '11 · Gateway', diagnostico: '12 · Diagnóstico', errores: '13 · Errores' };

// Errores: cada mensaje va a su sección según su topic (la tabla del BRIEF). Un topic que no está en la tabla es un aviso
// y el mensaje va al diagnóstico; si el section que trae el mensaje no coincide con su topic, manda el topic.
const TOPIC_SECTION = { conceptos: 'que-es', tokens: 'tokens', memoria: 'memoria', arranque: 'arrancar', config: 'arrancar', api: 'api', cliente: 'api', batching: 'batching', metricas: 'metricas', paralelismo: 'paralelismo', nccl: 'paralelismo', cuantizacion: 'cuantizacion', optimizacion: 'optimizar', gateway: 'gateway-llm', otro: 'diagnostico' };
const ERRS = W3.errores.map((e) => {
  let sec = TOPIC_SECTION[e.topic];
  if (!sec || !byId[sec]) { aviso(`errores: topic sin sección: «${e.topic}» en "${e.msg.slice(0, 50)}…" (lo mando al diagnóstico)`); sec = 'diagnostico'; }
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
const FIG = { 'prefill-decode': figPrefillDecode, 'kv-cache': figKvCache, tokens: figTokens, continuous: figContinuous, latency: figLatency, parallel: figParallel, quant: figQuant, gateway: figGateway, chain: figChain };
function figureHtml(x) {
  const f = x.figure, D = f.data || {};
  let inner;
  if (f.kind === 'table') inner = figTable(D, x.id);
  else if (FIG[f.kind]) inner = FIG[f.kind](D, x.id) + notesList(D.notes) + noteP(D.note);
  else throw new Error('figura desconocida: ' + f.kind);
  return `<figure class="fig fig--${esc(f.kind)}${/<table/.test(inner) ? ' has-table' : ''}">${inner}<figcaption>${tx(f.caption)}</figcaption></figure>`;
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
    <p class="small errs__none" id="err-none" hidden>Ningún mensaje tiene ese texto. Prueba con una palabra del mensaje (por ejemplo <code>KV cache</code> o <code>NCCL</code>).</p>
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
  const fig = id === 'errores' ? quizHtml(x) + (x.figure.data && x.figure.data.head ? figureHtml(x) : '') : figureHtml(x);
  return `
<section class="sec" id="${id}">
  <header class="sec__head"><span class="sec__n">${num}</span><div><h2>${esc(x.title).replace(/_/g, '_<wbr>')}</h2><p class="sec__q">${esc(x.question).replace(/_/g, '_<wbr>')}</p></div></header>
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
// ================================================================ calculadora de VRAM y KV cache (la clave calculadora de W1)
// Un port de capacity/vram_calc.py del C10. Las expresiones js del contenido (fórmulas, salidas y validaciones) son
// nuestras, pero solo se aceptan si son expresiones: números, los ids de los inputs y de las fórmulas anteriores,
// Math.<función>, operadores aritméticos, de comparación y lógicos, ?: y paréntesis. Nada de ;, =>, function, asignaciones
// ni otros nombres. Cada una se compila aquí a una función normal, function (s) { return (…); }, con cada id como s.<id>: la
// misma fuente corre en node (los checks del contenido, con new Function) y en la página (sin eval en el navegador).
const CALC = W1.calculadora;
const MATH_FN = new Set(['floor', 'ceil', 'round', 'trunc', 'min', 'max', 'abs', 'sign', 'sqrt', 'pow', 'log', 'log2', 'log10', 'exp']);
const TOK_RE = /\s+|(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\.\d+)|(Math\.[A-Za-z]\w*)|([A-Za-z_$][\w$]*)|(===|!==|==|!=|<=|>=|&&|\|\||[-+*/%<>!?:(),])/y;
function compileExpr(js, known, where) {
  const src = String(js), out = [], refs = [];
  if (/;|=>|\bfunction\b/.test(src)) throw new Error(`calculadora: ${where} no es una expresión (lleva ;, => o function): ${src}`);
  let pos = 0;
  while (pos < src.length) {
    TOK_RE.lastIndex = pos;
    const m = TOK_RE.exec(src);
    if (!m) throw new Error(`calculadora: ${where}: no acepto «${src.slice(pos, pos + 14)}» (¿una asignación?) en ${src}`);
    pos = TOK_RE.lastIndex;
    if (m[1]) out.push(m[1]);
    else if (m[2]) { if (!MATH_FN.has(m[2].slice(5))) throw new Error(`calculadora: ${where}: ${m[2]} no está en la lista de Math permitida`); out.push(m[2]); }
    else if (m[3]) { if (!known.has(m[3])) throw new Error(`calculadora: ${where}: «${m[3]}» no es un input ni una fórmula anterior`); if (!refs.includes(m[3])) refs.push(m[3]); out.push('s.' + m[3]); }
    else if (m[4]) out.push(m[4]);
    else out.push(' ');
  }
  const fn = `function (s) { return (${out.join('').trim()}); }`;
  try { new Function(`return ${fn};`); } catch (e) { throw new Error(`calculadora: ${where}: ${e.message} en ${src}`); }
  return { src: fn, refs };
}
function compileCalc(C) {
  const inputs = C.inputs || [], known = new Set();
  inputs.forEach((i) => {
    if (known.has(i.id)) throw new Error(`calculadora: input repetido: ${i.id}`);
    known.add(i.id);
    if (!(i.min <= i.default && i.default <= i.max)) aviso(`calculadora: el default de ${i.id} (${i.default}) se sale de ${i.min}…${i.max}`);
  });
  const formulas = (C.formulas || []).map((f) => { if (known.has(f.id)) throw new Error(`calculadora: id repetido: ${f.id}`); const c = compileExpr(f.js, known, `la fórmula ${f.id}`); known.add(f.id); return { ...f, ...c }; });
  const outputs = (C.outputs || []).map((o) => ({ ...o, ...compileExpr(o.js, known, `la salida ${o.id}`) }));
  const validations = (C.validations || []).map((v, i) => ({ ...v, ...compileExpr(v.when, known, `la validación ${i + 1}`) }));
  // Qué salidas esconde cada validación: las que dependen (directa o indirectamente) de todo lo que la validación mira,
  // salvo las que solo repiten lo mismo (room_gb y fits cuando no cabe: son la prueba del aviso).
  const deps = {};
  formulas.forEach((f) => { deps[f.id] = new Set([f.id, ...f.refs.flatMap((r) => [...(deps[r] || [r])])]); });
  const closure = (refs) => new Set(refs.flatMap((r) => [...(deps[r] || [r])]));
  validations.forEach((v) => { v.hides = outputs.filter((o) => { const D = closure(o.refs); return v.refs.every((r) => D.has(r)) && !o.refs.every((r) => v.refs.includes(r)); }).map((o) => o.id); });
  const js = `{ f: [${formulas.map((f) => `[${JSON.stringify(f.id)}, ${f.src}]`).join(', ')}], o: [${outputs.map((o) => `[${JSON.stringify(o.id)}, ${o.src}]`).join(', ')}], v: [${validations.map((v) => v.src).join(', ')}] }`;
  return { inputs, formulas, outputs, validations, js };
}
const CALC_C = compileCalc(CALC);
const CALC_F = new Function(`return ${CALC_C.js};`)();
function calcRun(vals, F = CALC_F) {
  const s = { ...vals };
  F.f.forEach(([id, fn]) => { s[id] = fn(s); });
  const out = {};
  F.o.forEach(([id, fn]) => { out[id] = fn(s); });
  return { s, out, msgs: F.v.map((fn) => !!fn(s)) };
}
// Los checks del contenido: cada caso, con sus valores, debe dar lo que dicen los tests del C10 (dentro de su tolerancia).
const CALC_TOL = CALC.tolerance_mode || 'absolute';
function calcChecks(run) {
  const res = [];
  (CALC.checks || []).forEach((c, i) => {
    const miss = CALC_C.inputs.filter((x) => !(x.id in (c.values || {}))).map((x) => x.id);
    if (miss.length) aviso(`calculadora: al check ${i + 1} le faltan ${miss.join(', ')}`);
    const r = run(c.values || {});
    Object.entries(c.expect || {}).forEach(([k, want]) => {
      const got = k in r.out ? r.out[k] : r.s[k];
      const tol = +c.tolerance || 0, lim = CALC_TOL === 'relative' ? tol * Math.abs(want) : tol;
      res.push({ i: i + 1, k, want, got, ok: typeof got === 'number' && Math.abs(got - want) <= lim + 1e-9, src: c.source });
    });
  });
  return res;
}
{
  if (!['absolute', 'relative'].includes(CALC_TOL)) aviso(`calculadora: tolerance_mode raro: ${CALC_TOL} (lo leo como absolute)`);
  (CALC.presets || []).forEach((p) => {
    CALC_C.inputs.forEach((x) => {
      const v = (p.values || {})[x.id];
      if (v === undefined) aviso(`calculadora: el preset «${p.name}» no trae ${x.id}`);
      else if (v < x.min || v > x.max) aviso(`calculadora: en el preset «${p.name}», ${x.id} = ${v} se sale de ${x.min}…${x.max}`);
    });
    const r = calcRun(p.values || {});
    Object.entries(r.out).forEach(([k, v]) => { if (typeof v !== 'number' || !isFinite(v)) aviso(`calculadora: el preset «${p.name}» da ${k} = ${v}`); });
  });
  (CALC.checks || []).forEach((c, i) => CALC_C.inputs.forEach((x) => { const v = (c.values || {})[x.id]; if (v !== undefined && (v < x.min || v > x.max)) aviso(`calculadora: el check ${i + 1} usa ${x.id} = ${v}, fuera de ${x.min}…${x.max}`); }));
}
const CALC_NODE = calcChecks(calcRun);
CALC_NODE.filter((r) => !r.ok).forEach((r) => aviso(`calculadora (node): el check ${r.i} da ${r.k} = ${r.got}, pero ${r.src} dice ${r.want}`));
// La barra de memoria de la calculadora usa estos ids; si el contenido los cambia, la barra no se dibuja.
const BAR_IDS = ['weights_bytes', 'budget_bytes', 'room_bytes', 'live_tokens', 'kv_bytes_token', 'tp', 'gpu_gb', 'overhead_gb'];
const CALC_BAR = BAR_IDS.every((id) => CALC_C.inputs.some((x) => x.id === id) || CALC_C.formulas.some((f) => f.id === id));
if (!CALC_BAR) aviso(`calculadora: falta alguno de ${BAR_IDS.join(', ')}: la barra de memoria no se dibuja`);
// Las salidas que más importan, resaltadas (si existen)
const CALC_KEY = ['room_gb', 'seqs', 'vllm_tokens'];
// 1,000.5 · −2.2: con separador de miles y el signo menos de verdad (como en el resto de la hoja)
const fmtD = (v, dec) => { if (typeof v !== 'number' || !isFinite(v)) return '—'; let t = Math.abs(v).toFixed(dec); if (+t === 0) return t.replace(/\B(?=(\d{3})+(?!\d))/g, ','); const [i, d] = t.split('.'); return (v < 0 ? '−' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (d ? '.' + d : ''); };
const unitHtml = (o) => (o.kind === 'bool' ? '' : o.unit === 'x' ? 'x' : esc(o.unit));
function calcHtml() {
  const C = CALC, CC = CALC_C;
  const r0 = calcRun(Object.fromEntries(CC.inputs.map((x) => [x.id, x.default])));
  const groups = [...new Set(CC.inputs.map((x) => x.group || 'datos'))];
  const field = (x) => `<div class="cx-f"><label for="cx-${esc(x.id)}">${tx(x.label)}</label><span class="cx-in"><input id="cx-${esc(x.id)}" type="number" inputmode="decimal" min="${x.min}" max="${x.max}" step="${x.step}" value="${x.default}" aria-describedby="cx-e-${esc(x.id)}" autocomplete="off"><span class="cx-u">${tx(x.unit)}</span></span><span class="cx-e" id="cx-e-${esc(x.id)}" hidden></span></div>`;
  const sets = groups.map((g) => `<fieldset class="cx-g"><legend>${tx(cap(g))}</legend>${CC.inputs.filter((x) => (x.group || 'datos') === g).map(field).join('')}</fieldset>`).join('');
  const isDef = (p) => CC.inputs.every((x) => (p.values || {})[x.id] === x.default);
  const presets = (C.presets || []).length ? `<div class="cx-ps" role="group" aria-label="Modelos y GPUs de ejemplo"><p class="tag">Llenar con</p>${C.presets.map((p, i) => `<button class="btn cx-p" type="button" data-p="${i}" aria-pressed="${isDef(p) ? 'true' : 'false'}">${tx(p.name)}</button>`).join('')}</div>` : '';
  const sources = (C.presets || []).some((p) => p.source) ? `<div class="cx-src"><p class="tag">De dónde salen los números de cada modelo</p><ul>${C.presets.filter((p) => p.source).map((p) => `<li><b>${tx(p.name)}:</b> ${linkify(p.source)}</li>`).join('')}</ul></div>` : '';
  const outs = CC.outputs.map((o) => {
    const v = r0.out[o.id], hide = CC.validations.some((vv, i) => r0.msgs[i] && vv.hides.includes(o.id));
    return `<div class="cx-o${CALC_KEY.includes(o.id) ? ' is-key' : ''}${o.kind === 'bool' ? ' is-bool' : ''}" id="cx-o-${esc(o.id)}"${hide ? ' hidden' : ''}><dt>${tx(o.label)}</dt><dd><b class="cx-v${o.kind === 'bool' ? (v ? ' is-yes' : ' is-no') : ''}">${o.kind === 'bool' ? (v ? 'sí' : 'no') : fmtD(v, o.decimals ?? 2)}</b>${unitHtml(o) ? `<span class="cx-ou">${unitHtml(o)}</span>` : ''}</dd></div>`;
  }).join('');
  const msgs0 = CC.validations.filter((v, i) => r0.msgs[i]).map((v) => `<p class="cx-msg">${tx(v.message)}</p>`).join('');
  const bar = CALC_BAR ? `<div class="cx-bar"><p class="to__h">La réplica, a escala: <span id="cx-bt"></span></p><div class="gb cx-gb" id="cx-gb" role="img" aria-label="La memoria de la réplica"></div><div class="gax" id="cx-ax" aria-hidden="true"></div><p class="kleg" id="cx-lg"></p></div>` : '';
  const fx = CC.formulas.length ? `<div class="cx-fx"><p class="tag">Las fórmulas, en el orden en que se calculan</p><ol>${CC.formulas.map((f) => `<li><p class="cx-fl">${tx(f.label || f.id)}</p>${mb(f.tex)}</li>`).join('')}</ol></div>` : '';
  return `<div class="card tool" id="calculadora">
    <h3>${tx(C.title || 'Calculadora')}</h3>
    ${C.intro ? `<p class="small">${tx(C.intro)}</p>` : ''}
    ${presets}
    <form class="cx-form" id="cx-form" novalidate onsubmit="return false">${sets}</form>
    <div class="cx-acts"><button class="btn" id="cx-reset" type="button">Restablecer</button><p class="small cx-bad" id="cx-bad" hidden></p></div>
    <div class="cx-msgs" id="cx-msgs" aria-live="polite">${msgs0}</div>
    ${bar}
    <dl class="cx-out" id="cx-out" aria-live="polite">${outs}</dl>
    ${fx}
    ${(C.notes || []).length ? `<ul class="cx-notes">${C.notes.map((n) => `<li>${rx(n)}</li>`).join('')}</ul>` : ''}
    ${sources}
  </div>`;
}

// ================================================================ herramientas
function toolsHtml() {
  const D = W3.diagnosticador;
  D.forEach((g) => { if (g.causes.length < 2 || g.causes.length > 5) aviso(`diagnosticador: "${g.symptom}" tiene ${g.causes.length} causas (2–5 es lo esperado)`); });
  const panels = D.map((g) => `<div class="dg-panel" data-dg="${esc(g.id)}" hidden>
      <p class="dg-sym">${esc(g.symptom)}</p>
      <div class="dg-first"><p class="tag">${isPlaceOnly(g.first) ? 'Mira primero' : 'Corre primero'}</p><p>${cmdHtml(g.first)}</p></div>
      <ol class="dg-causes">${g.causes.map((c) => `<li><p class="dg-cause">${tx(c.cause)}</p><p class="dg-row"><span class="k">Compruébalo:</span> ${cmdHtml(c.check)}</p><p class="dg-row"><span class="k">Arreglo:</span> ${tx(c.fix)}</p></li>`).join('')}</ol>
    </div>`).join('');
  const calc = calcHtml();
  return `
<section class="sec tools" id="herramientas">
  <header class="sec__head"><span class="sec__n">⚙</span><div><h2>Herramientas</h2><p class="sec__q">Del síntoma al primer comando, y la cuenta de memoria de una réplica antes de tenerla.</p></div></header>
  <div class="card tool" id="diagnosticador">
    <h3>Diagnosticador</h3>
    <p class="small">Elige lo que ves. Te dice qué mirar primero y las causas típicas, cada una con cómo comprobarla y cómo arreglarla. Los comandos y las consultas de PromQL se copian${UI_USED ? `; un lugar de la web se abre, no se copia` : ''}.</p>
    <div class="dg-chips" role="group" aria-label="Síntomas">${D.map((g) => `<button class="dg-chip" type="button" aria-pressed="false" data-dg="${esc(g.id)}">${esc(g.symptom)}</button>`).join('')}</div>
    <label class="dg-pick"><span class="tag">Síntoma</span><select id="dg-select"><option value="">Elige un síntoma…</option>${D.map((g) => `<option value="${esc(g.id)}">${esc(g.symptom)}</option>`).join('')}</select></label>
    <p class="small dg-empty" id="dg-empty">Elige un síntoma para ver las causas.</p>
    <div class="dg-panels">${panels}</div>
  </div>
  ${calc}
</section>`;
}

// ================================================================ CSS
const TOKENS_LIGHT = `--bg: #f4f6f9; --paper: #ffffff; --ink: #18212d; --muted: #5a6575; --rule: #d6dde6; --grid: rgba(31, 95, 174, 0.075);
  --accent: #1f5fae; --accent-soft: rgba(31, 95, 174, 0.14); --accent2: #0f7a6e; --accent2-soft: rgba(15, 122, 110, 0.32);
  --hi: #d99a12; --hi-soft: #fff1cc; --warn: #b5482c; --warn-soft: #fbe8e2; --free: #e7ecf2; --onbar: #ffffff;
  --code-bg: #f6f8fb; --syn-kw: #1f5fae; --syn-str: #7a4fb8; --syn-com: #5a6575; --syn-dec: #0f7a6e; --syn-num: #8a5a00; --ok-soft: rgba(15, 122, 110, 0.13); --hi-ink: #8a5a00; --var-bg: rgba(31, 95, 174, 0.09); --on-hi: #18212d;
  --wt: #1f5fae; --kv: #7a4fb8; --pre: #d99a12; --pre-soft: #fff1cc; --pre-ink: #8a5a00; --dec: #0f7a6e; --dec-soft: rgba(15, 122, 110, 0.16);
  --okc: #2a7a36; --okc-soft: rgba(42, 122, 54, 0.14); --fire: #b5482c; --fire-soft: #fbe8e2; --off: #7b8594; --off-soft: rgba(123, 133, 148, 0.22);`;
const TOKENS_DARK = `--bg: #0e131a; --paper: #151c26; --ink: #e5ecf4; --muted: #9aa7b7; --rule: #2a3544; --grid: rgba(125, 175, 240, 0.085);
  --accent: #7db1ff; --accent-soft: rgba(125, 177, 255, 0.18); --accent2: #4fcfbf; --accent2-soft: rgba(79, 207, 191, 0.32);
  --hi: #f2c14e; --hi-soft: #3a2e10; --warn: #ff8b6e; --warn-soft: #3b1f18; --free: #1d2632; --onbar: #0e131a;
  --code-bg: #10161f; --syn-kw: #7db1ff; --syn-str: #c7b0f5; --syn-com: #9aa7b7; --syn-dec: #4fcfbf; --syn-num: #f2c14e; --ok-soft: rgba(79, 207, 191, 0.14); --hi-ink: #f2c14e; --var-bg: rgba(125, 177, 255, 0.13); --on-hi: #0e131a;
  --wt: #7db1ff; --kv: #c7b0f5; --pre: #f2c14e; --pre-soft: #3a2e10; --pre-ink: #f2c14e; --dec: #4fcfbf; --dec-soft: rgba(79, 207, 191, 0.18);
  --okc: #7fd18b; --okc-soft: rgba(127, 209, 139, 0.16); --fire: #ff8b6e; --fire-soft: #3b1f18; --off: #8592a3; --off-soft: rgba(133, 146, 163, 0.26); color-scheme: dark;`;
const CSS = `
/* El diseño de las hojas de Docker, Kubernetes, Git, Triton, el gateway y Prometheus: papel cuadriculado para la
   sintaxis, tinta azul, resaltador ámbar. Colores de las figuras (uno por idea): azul = pesos, violeta = KV cache,
   ámbar = prefill o espera en la cola, verde azulado = decode o tokens generados, verde = ok, libre o dentro del SLO,
   rojo = OOM, preemption, fuera del SLO o rechazado, gris = overhead, activaciones, reservado u ocioso. */
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
.sec__head > div { min-width: 0; } /* max_num_batched_tokens en un título: que se parta en los _ y no ensanche la página */
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
code, pre, .cmd, var.ph, figure.fig, .tool { font-variant-ligatures: none; font-feature-settings: "liga" 0, "calt" 0; }
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
.ktag--sse { color: var(--dec); border-color: var(--dec); } .ktag--log, .ktag--valor, .ktag--flujo { border-style: dashed; } .ktag--flag, .ktag--http, .ktag--json, .ktag--yaml { color: var(--ink); }
.qb--sse code.cmd, .qb--log code.cmd, .qb--json code.cmd { font-size: 12px; }
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
.search input:focus-visible, .dg-pick select:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
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
footer { margin-top: 30px; color: var(--muted); font-size: 14px; border-top: 1px solid var(--rule); padding-top: 14px; }
/* ---------- piezas comunes de las figuras */
.kleg { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 10px 0 0; font: 500 13px/1.4 var(--f-display); color: var(--muted); }
.kleg > span { display: inline-flex; align-items: center; gap: 6px; }
.kleg code { font-size: 12px; }
.sw { display: inline-block; flex: none; width: 16px; height: 12px; border-radius: 3px; font-style: normal; }
.callout { margin: 12px 0 0; padding: 8px 12px; border-left: 4px solid var(--ink); background: var(--free); border-radius: 0 8px 8px 0; font: 700 14.5px/1.4 var(--f-display); }
.to__h { margin: 0 0 6px; font: 800 12px/1.3 var(--f-display); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
/* SVG: textos, trazos y rellenos (un color por idea) */
svg .t { fill: var(--muted); font: 12px var(--f-display); } svg .tm { fill: var(--ink); font: 12px var(--f-display); } svg .tb { font-weight: 700; }
svg .tv { fill: var(--ink); font: 700 11px var(--f-mono); }
svg .grid { stroke: var(--rule); stroke-width: 1; } svg .ax { stroke: var(--muted); stroke-width: 1; }
svg .s-ink { stroke: var(--ink); } svg .s-muted { stroke: var(--muted); }
svg .f-ok { fill: var(--okc); } svg .f-fire { fill: var(--fire); } svg .f-ink { fill: var(--ink); } svg .f-paper { fill: var(--paper); }
svg.chart.fv-n { display: none; }
@media (max-width: 679px) { svg.chart.fv-w { display: none; } svg.chart.fv-n { display: block; } }
/* ---------- barras a escala (memoria, ventana de tokens) y su eje */
.gb { position: relative; height: 26px; }
.gb__in { position: absolute; inset: 0; border-radius: 5px; background: var(--free); overflow: hidden; }
.gb__s { position: absolute; top: 0; bottom: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.gb__s + .gb__s { box-shadow: inset 1.5px 0 0 var(--paper); }
.gb__t { font: 700 11.5px/1 var(--f-mono); white-space: nowrap; color: var(--onbar); padding: 0 3px; }
.gb--wt { background: var(--wt); } .gb--kv, .gb--kvu { background: var(--kv); } .gb--dec { background: var(--dec); }
.gb--pre { background: var(--pre); } .gb--pre .gb__t { color: var(--on-hi); }
.gb--fr { background: var(--okc-soft); box-shadow: inset 0 0 0 1.5px var(--okc) !important; } .gb--fr .gb__t { color: var(--ink); }
.gb--ov { background: var(--off); }
.gb--rs { background: repeating-linear-gradient(135deg, var(--off) 0 2px, transparent 2px 6px); } .gb--rs .gb__t { color: var(--ink); }
.gb--over { background: repeating-linear-gradient(135deg, var(--fire) 0 3px, var(--fire-soft) 3px 6px); }
.gb--idle { background: var(--off-soft); }
.gb__m { position: absolute; top: -4px; bottom: -4px; width: 0; margin-left: -1px; border-left: 2px dashed var(--ink); z-index: 2; pointer-events: none; }
.gb__m--cut { border-left-style: solid; }
.gax { position: relative; height: 18px; margin-top: 3px; font: 600 11px/18px var(--f-mono); color: var(--muted); }
.gax span { position: absolute; top: 0; transform: translateX(-50%); white-space: nowrap; }
.gax span.is-0 { transform: none; } .gax span.is-n { transform: translateX(-100%); }
.nofit { display: inline-block; font: 700 12px/1.4 var(--f-display); color: var(--fire); background: var(--fire-soft); border: 1.5px solid var(--fire); border-radius: 999px; padding: 1px 9px; white-space: nowrap; }
/* ---------- que-es · prefill y decode en el tiempo */
.pd { display: grid; gap: 18px; }
.pd p { margin: 0; }
.pd__trk, .pd__ztrk { position: relative; height: 30px; margin-top: 10px; background: var(--free); border-radius: 5px; }
.pd__b { position: absolute; top: 0; bottom: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.pd__b:first-child { border-radius: 5px 0 0 5px; }
.pd--pre { background: var(--pre); } .pd--dec { background: var(--dec); } .pd--decsoft { background: var(--dec-soft); }
.pd__bt { font: 700 11.5px/1 var(--f-display); color: var(--onbar); white-space: nowrap; padding: 0 4px; }
.pd--pre .pd__bt { color: var(--on-hi); }
.pd__m { position: absolute; top: -6px; bottom: -6px; width: 0; margin-left: -1px; border-left: 2.5px solid var(--ink); }
.pd__s { position: absolute; top: -6px; bottom: -6px; width: 0; margin-left: -1px; border-left: 2px dashed var(--okc); }
.pd__tk { position: absolute; top: 4px; bottom: 4px; width: 2px; margin-left: -1px; background: var(--dec); }
.pd__br { position: absolute; top: -8px; height: 6px; border: 1.5px solid var(--dec); border-bottom: 0; border-radius: 2px 2px 0 0; }
.pd__zl { display: flex; margin: 8px 0 0 !important; font: 700 12px/1.3 var(--f-display); }
.pd__zlt { flex: none; text-align: right; padding-right: 6px; color: var(--pre-ink); }
.pd__zlp { flex: 1; min-width: 0; padding-left: 6px; color: var(--dec); }
ul.pd__keys { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 4px; font-size: 14px; line-height: 1.4; }
.pd__keys li, .pd__fl li { display: flex; gap: 8px; align-items: baseline; }
.pd__keys .sw { transform: translateY(1px); }
.pd__keys b { font: 700 13px var(--f-mono); }
.pd__bd { color: var(--muted); }
ul.pd__fl { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 8px; font-size: 13.5px; line-height: 1.4; }
.pd__fl li { flex-direction: column; gap: 3px; }
.pd__flt { position: relative; display: block; width: 100%; height: 10px; background: var(--free); border-radius: 3px; }
.pd__flb { position: absolute; left: 0; top: 0; bottom: 0; min-width: 2px; border-radius: 3px; }
/* ---------- memoria · la réplica, cada GPU y el KV por dentro */
.kc { display: grid; gap: 18px; }
.kc p { margin: 0; }
ul.kc__lg, ul.tz__wl { list-style: none; margin: 8px 0 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 250px), 1fr)); gap: 4px 18px; font-size: 13.5px; line-height: 1.4; }
.kc__lg li, .tz__wl li { display: flex; gap: 8px; align-items: baseline; } .kc__lg .sw, .tz__wl .sw { transform: translateY(1px); }
.kc__lg b, .tz__wl b { font: 700 12.5px var(--f-mono); white-space: nowrap; }
.kc__2 { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 18px 24px; align-items: start; }
@media (max-width: 760px) { .kc__2 { grid-template-columns: minmax(0, 1fr); } }
ul.kc__ul, ul.kc__vl { list-style: none; margin: 0; padding: 0; display: grid; gap: 9px; }
.kc__ut { margin: 0 0 3px !important; font-size: 13.5px; line-height: 1.35; }
.kc__ub { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; }
.kc__ub .gb { height: 16px; }
.kc__uv { font: 600 12.5px var(--f-mono); white-space: nowrap; text-align: right; }
.kc__uv b { font-weight: 800; }
.kc__bl { margin-top: 6px !important; font-size: 13.5px; line-height: 1.4; } .kc__bl b { font-family: var(--f-mono); }
.kc__nf { display: block; }
/* ---------- tokens · fertilidad, chat template y la ventana */
.tz { display: grid; gap: 20px; }
.tz p { margin: 0; }
ol.tz__rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.tz__r { display: grid; grid-template-columns: 8.4em minmax(0, 1fr) 3.6em; gap: 4px 10px; align-items: center; padding: 4px 6px; border-radius: 8px; }
.tz__r.is-hl { background: var(--free); box-shadow: inset 0 0 0 1.5px var(--ink); }
.tz__n { font: 600 13px/1.25 var(--f-display); } .tz__r.is-hl .tz__n { font-weight: 800; }
.tz__bs, .tz__exb { display: grid; gap: 2px; }
.tz__b { display: flex; justify-content: flex-end; align-items: center; height: 15px; border-radius: 3px; min-width: 2.8em; }
.tz__b span { font: 700 10.5px/1 var(--f-mono); padding: 0 4px; }
.tz--en { background: var(--paper); box-shadow: inset 0 0 0 1.5px var(--ink); } .tz--en span { color: var(--ink); }
.tz--es { background: var(--ink); } .tz--es span { color: var(--paper); }
.tz__d { font: 700 12.5px var(--f-mono); text-align: right; }
.tz__ex { margin-top: 10px; border-left: 4px solid var(--ink); background: var(--free); border-radius: 0 8px 8px 0; padding: 8px 12px; }
.tz__ext { font: 600 14px/1.4 var(--f-display); } .tz__ext b { font-family: var(--f-mono); }
.tz__exb { margin-top: 6px !important; } .tz__exb .tz__b { height: 18px; }
.tz__src { margin-top: 8px !important; font-size: 12.5px; line-height: 1.45; color: var(--muted); overflow-wrap: anywhere; }
.tz__src a { color: var(--accent); }
.tz__ps { display: flex; flex-wrap: wrap; gap: 6px 4px; align-items: center; line-height: 1.4; }
.tz__p { display: inline-block; max-width: 100%; border-radius: 5px; padding: 2px 6px; font-size: 13.5px; overflow-wrap: anywhere; }
.tz--sp { font: 700 11.5px/1.5 var(--f-mono); background: var(--ink); color: var(--paper); }
.tz--rol { font: 800 13px/1.4 var(--f-display); box-shadow: inset 0 0 0 1.5px var(--ink); }
.tz--tpl { font-style: italic; color: var(--muted); background: var(--free); }
.tz--own { background: var(--paper); box-shadow: inset 0 0 0 1.5px var(--muted); }
.tz__nl { font-style: normal; font-weight: 800; color: var(--muted); padding: 0 1px; }
.tz__t .kleg .tz__p { font-size: 11.5px; padding: 0 5px; }
/* ---------- batching · las grillas de lugares × pasos */
.cb { display: grid; gap: 16px; }
.cb p { margin: 0; }
.cb__rq { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; font-size: 13.5px; }
.cb__rc { font: 600 12.5px/1.4 var(--f-display); border: 1px solid var(--rule); border-radius: 999px; padding: 1px 8px; background: var(--paper); white-space: nowrap; }
.cb__rc b { font-family: var(--f-mono); }
.cb__g { min-width: 0; }
.cb__h { margin-bottom: 6px !important; font: 700 14px/1.35 var(--f-display); }
.cb__grid { display: grid; grid-template-columns: 2.5em repeat(var(--n), minmax(0, 1fr)); gap: 2px; }
.cb__c0 { font: 600 10.5px/24px var(--f-display); color: var(--muted); text-align: right; padding-right: 4px; white-space: nowrap; }
.cb__hd { font: 600 10.5px/24px var(--f-mono); color: var(--muted); text-align: center; }
.cb__hd.is-out { opacity: .35; }
.cb__c { height: 26px; border-radius: 3px; display: grid; place-items: center; font: 700 10.5px/1 var(--f-mono); min-width: 0; overflow: hidden; }
.cb--pre { background: var(--pre); color: var(--on-hi); } .cb--dec { background: var(--dec); color: var(--onbar); } .cb--idle { background: var(--off-soft); }
.cb__x { height: 26px; border-radius: 3px; box-shadow: inset 0 0 0 1px var(--rule); }
.cb__st { margin-top: 6px !important; font-size: 13.5px; line-height: 1.45; } .cb__oc { font: 800 15px var(--f-mono); }
ul.cb__ru { margin: 0; padding-left: 20px; font-size: 14px; line-height: 1.45; }
/* ---------- metricas · el barrido */
svg .f-in { fill: var(--okc-soft); } svg .l-slo { stroke: var(--okc); stroke-width: 1.6; stroke-dasharray: 6 4; } svg .tok { fill: var(--okc); font: 12px var(--f-display); }
svg .ring { fill: none; stroke: var(--ink); stroke-width: 2; }
ul.lt__mk { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px 18px; font-size: 13.5px; line-height: 1.4; }
.lt__mk li { display: inline-flex; gap: 6px; align-items: baseline; }
.lt__c { font: 800 12px/1.4 var(--f-mono); border-radius: 999px; padding: 0 7px; color: var(--onbar); }
.lt__c.is-ok { background: var(--okc); } .lt__c.is-bad { background: var(--fire); }
.lt__pl { margin: 8px 0 0; font-size: 14px; } .lt__pl b { font-family: var(--f-mono); }
.mt__w { margin-top: 12px; max-width: 100%; overflow-x: auto; }
table.mt { width: 100%; border-collapse: collapse; font: 600 13px/1.4 var(--f-mono); }
.mt th, .mt td { text-align: right; padding: 4px 6px; border-bottom: 1px solid var(--rule); white-space: nowrap; }
.mt thead th { font: 700 11px/1.3 var(--f-display); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); vertical-align: bottom; white-space: normal; }
.mt tbody th { font: 800 13px/1.4 var(--f-mono); color: var(--ink); text-align: left; }
.mt thead th:first-child { text-align: left; }
.mt__d { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 6px; background: var(--okc); }
.mt tr.is-bad .mt__d { background: var(--fire); } .mt tr.is-bad td, .mt tr.is-bad th { color: var(--fire); }
.mt tr.is-ch th, .mt tr.is-ch td { background: var(--okc-soft); }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (max-width: 520px) { .mt__hm { display: none; } }
/* ---------- paralelismo · una tarjeta por forma de partir el modelo */
.pa__node { margin: 0 0 10px; font-size: 14px; line-height: 1.45; }
.pa { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: 12px; }
.pa__c { border: 1px solid var(--rule); border-top: 4px solid var(--wt); border-radius: 12px; padding: 10px 12px; min-width: 0; }
.pa__c.is-no { border-top-color: var(--fire); }
.pa__c p { margin: 0; }
.pa__n { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 8px; font: 500 15px/1.3 var(--f-display); }
.pa__ok { font: 700 12px/1.4 var(--f-display); color: var(--okc); background: var(--okc-soft); border: 1.5px solid var(--okc); border-radius: 999px; padding: 1px 9px; }
.pa__gs { margin-top: 8px !important; display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }
.pa__rep { display: inline-flex; gap: 2px; padding: 2px; border: 1.5px solid var(--ink); border-radius: 5px; }
.pa__gpu { width: 13px; height: 13px; border-radius: 2px; background: var(--wt); }
.pa__c.is-no .pa__rep { border-color: var(--fire); }
.pa__gl { font: 600 12px var(--f-mono); color: var(--muted); }
.pa__sp { margin: 6px 0 10px !important; font-size: 13.5px; line-height: 1.4; }
.pa__kv { margin-top: 6px !important; font-size: 13.5px; line-height: 1.4; } .pa__kv b { font-family: var(--f-mono); }
.pa__x { margin-top: 8px !important; font-size: 13.5px; line-height: 1.4; }
ul.pa__cm { margin: 4px 0 0; padding-left: 18px; font-size: 13px; line-height: 1.45; } .pa__cm b { font-family: var(--f-mono); }
.pa__v { margin-top: 8px !important; font: 700 13.5px/1.4 var(--f-display); }
.pa__m { margin-top: 14px; }
/* ---------- cuantizacion · bytes y memoria por formato */
.qu__m { margin: 0 0 10px; font-size: 14px; line-height: 1.45; } .qu__m b { font-family: var(--f-mono); }
ol.qu { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: 12px; }
.qu__r { border: 1px solid var(--rule); border-top: 4px solid var(--wt); border-radius: 12px; padding: 8px 12px 10px; min-width: 0; }
.qu__r.is-no { border-top-color: var(--fire); }
.qu__r p { margin: 0; }
.qu__h { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; font-size: 13.5px; line-height: 1.35; }
.qu__h b { font: 800 15px/1.3 var(--f-display); }
.qu__sq { display: inline-flex; gap: 3px; } .qu__sq i { width: 14px; height: 14px; border-radius: 2px; background: var(--wt); }
.qu__sq i.is-half { width: calc(14px * var(--f)); }
.qu__bp { font: 600 12.5px var(--f-mono); color: var(--muted); }
.qu__pw { flex-basis: 100%; } .qu__pw b { font-family: var(--f-mono); }
.qu__l { margin-top: 10px !important; font: 700 11px/1.3 var(--f-display); letter-spacing: .05em; text-transform: uppercase; color: var(--muted); }
.qu__r .gb { margin-top: 4px; height: 22px; }
.qu__k { margin-top: 4px !important; font-size: 13.5px; line-height: 1.4; } .qu__k b { font-family: var(--f-mono); }
.qu__na { display: block; margin-top: 4px; font-size: 13px; color: var(--muted); font-style: italic; }
.qu__n { margin-top: 8px !important; font-size: 13px; color: var(--muted); line-height: 1.4; }
.qu__2 { margin-top: 16px; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: 16px 24px; align-items: start; }
@media (max-width: 760px) { .qu__2 { grid-template-columns: minmax(0, 1fr); } }
.qu__ck ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 7px; font-size: 13px; line-height: 1.4; }
.qu__ck li { display: grid; gap: 1px; } .qu__ck code { font-size: 12px; overflow-wrap: anywhere; } .qu__ck b { font-family: var(--f-mono); }
ul.qu__rg { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.qu__rl { margin: 0 0 3px !important; font: 600 13px/1.35 var(--f-display); }
ul.qu__eb { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.qu__eb li { display: grid; grid-template-columns: 11em minmax(0, 1fr) 4.5em; gap: 8px; align-items: center; font-size: 12.5px; }
@media (max-width: 520px) { .qu__eb li { grid-template-columns: minmax(0, 1fr) 4.5em; } .qu__ek { grid-column: 1 / -1; } }
.qu__ek b { font-family: var(--f-mono); }
.qu__et { position: relative; height: 10px; background: var(--free); border-radius: 3px; overflow: hidden; }
.qu__ev { position: absolute; left: 0; top: 0; bottom: 0; background: var(--ink); min-width: 2px; }
.qu__en { font: 600 12px var(--f-mono); text-align: right; white-space: nowrap; }
/* ---------- gateway-llm · el request baja, el stream vuelve */
ol.gw { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 22px minmax(0, 1fr) 22px; column-gap: 8px; row-gap: 8px; }
ol.gw > li { grid-column: 2; min-width: 0; }
ol.gw > li.gw__dn { grid-column: 1; position: relative; } ol.gw > li.gw__up { grid-column: 3; position: relative; }
.gw__dn::before, .gw__up::before { content: ""; position: absolute; left: 50%; width: 3px; margin-left: -1.5px; border-radius: 2px; }
.gw__dn::before { top: 4px; bottom: 12px; background: var(--ink); } .gw__up::before { top: 12px; bottom: 4px; background: var(--dec); }
.gw__dn::after, .gw__up::after { content: ""; position: absolute; left: 50%; margin-left: -6px; border-left: 6px solid transparent; border-right: 6px solid transparent; }
.gw__dn::after { bottom: 2px; border-top: 10px solid var(--ink); } .gw__up::after { top: 2px; border-bottom: 10px solid var(--dec); }
.gw__dnt, .gw__upt { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-90deg); white-space: nowrap; font: 800 10.5px/1 var(--f-display); letter-spacing: .05em; text-transform: uppercase; background: var(--paper); padding: 3px 5px; }
.gw__dnt { color: var(--ink); } .gw__upt { color: var(--dec); }
.gw__cl { border: 2px solid var(--ink); border-radius: 10px; padding: 6px 10px; }
.gw__cl p { margin: 0; } .gw__cl code { font-size: 12px; overflow-wrap: anywhere; }
.gw__e { --c: var(--ink); border: 1px solid var(--rule); border-left: 4px solid var(--c); border-radius: 10px; padding: 7px 10px; }
.gw--plain { --c: var(--muted); } .gw--pre { --c: var(--pre); } .gw--dec { --c: var(--dec); } .gw--ok { --c: var(--okc); }
.gw--pool { --c: var(--ink); border-width: 2px 2px 2px 4px; border-color: var(--ink); box-shadow: 4px 4px 0 -1px var(--paper), 4px 4px 0 1px var(--ink); margin-right: 5px; }
.gw__e p { margin: 0; }
.gw__eh { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; font: 500 14.5px/1.3 var(--f-display); }
.gw__no { flex: none; width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; background: var(--c); color: var(--paper); font: 800 11px/1 var(--f-display); }
.gw--pre .gw__no { color: var(--on-hi); }
.gw__t { margin-left: auto; font: 700 12px/1.4 var(--f-mono); color: var(--muted); white-space: nowrap; }
.gw__x { margin-top: 3px !important; font-size: 13.5px; line-height: 1.4; }
.gw__fs { margin-top: 5px !important; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; font-size: 13px; }
.gw__f { font: 700 12px/1.45 var(--f-mono); color: var(--fire); box-shadow: inset 0 0 0 1.5px var(--fire); background: var(--fire-soft); border-radius: 6px; padding: 0 6px; }
.gw__fn { font-size: 12.5px; color: var(--muted); }
.gw__g { margin-top: 16px; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px 24px; align-items: start; }
@media (max-width: 760px) { .gw__g { grid-template-columns: minmax(0, 1fr); } }
.gw__b { min-width: 0; }
ul.gw__kv { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; font-size: 13.5px; line-height: 1.4; } .gw__kv b { font-family: var(--f-mono); }
ul.gw__to { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.gw__to li { display: grid; grid-template-columns: 12em minmax(0, 1fr) 3.6em; gap: 8px; align-items: center; font-size: 13px; }
@media (max-width: 520px) { .gw__to li { grid-template-columns: minmax(0, 1fr) 3.6em; } .gw__tl { grid-column: 1 / -1; } }
.gw__tt { position: relative; height: 12px; background: var(--free); border-radius: 3px; overflow: hidden; } .gw__tt span { position: absolute; left: 0; top: 0; bottom: 0; background: var(--ink); min-width: 2px; }
.gw__tv { font: 700 12px var(--f-mono); text-align: right; }
.gw__tn { margin-top: 14px; }
pre.gw__raw { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.5 var(--f-mono); }
/* colores de las leyendas (uno por idea, los mismos de las barras) */
.sw--wt { background: var(--wt); } .sw--kv, .sw--kvu { background: var(--kv); } .sw--pre { background: var(--pre); } .sw--dec { background: var(--dec); }
.sw--fr { background: var(--okc-soft); box-shadow: inset 0 0 0 1.5px var(--okc); } .sw--ok { background: var(--okc); } .sw--fire { background: var(--fire); }
.sw--ov { background: var(--off); } .sw--rs { background: repeating-linear-gradient(135deg, var(--off) 0 2px, transparent 2px 5px); box-shadow: inset 0 0 0 1px var(--off); }
.sw--over { background: repeating-linear-gradient(135deg, var(--fire) 0 2px, var(--fire-soft) 2px 4px); } .sw--idle { background: var(--off-soft); }
.sw--lim { width: 0; height: 14px; border-left: 2px dashed var(--ink); border-radius: 0; } .sw--cut { width: 0; height: 14px; border-left: 2px solid var(--ink); border-radius: 0; }
.sw--mark { width: 0; height: 14px; border-left: 2.5px solid var(--ink); border-radius: 0; } .sw--slo { width: 0; height: 14px; border-left: 2px dashed var(--okc); border-radius: 0; }
.sw--en { background: var(--paper); box-shadow: inset 0 0 0 1.5px var(--ink); } .sw--es { background: var(--ink); }
.sw--in { background: var(--okc-soft); box-shadow: inset 0 0 0 1px var(--okc); } .sw--ring { width: 14px; height: 14px; border-radius: 50%; box-shadow: inset 0 0 0 2px var(--ink); }
.sw--pool { background: var(--paper); box-shadow: inset 0 0 0 2px var(--ink); }
/* ---------- la calculadora */
.cx-ps { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 12px; }
.cx-ps .tag { flex-basis: 100%; margin: 0 !important; }
.cx-p { min-height: 44px; text-align: left; max-width: 100%; }
.cx-p[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); color: var(--ink); }
.cx-src { margin-top: 14px; border-top: 1px dashed var(--rule); padding-top: 10px; font-size: 12.5px; line-height: 1.45; color: var(--muted); }
.cx-src .tag { margin: 0 0 2px !important; }
.cx-src ul { margin: 0; padding-left: 18px; display: grid; gap: 3px; }
.cx-src a { color: var(--accent); overflow-wrap: anywhere; }
.cx-form { margin-top: 12px; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: 12px; }
fieldset.cx-g { margin: 0; min-width: 0; border: 1px solid var(--rule); border-radius: 10px; padding: 6px 12px 12px; display: grid; gap: 10px; align-content: start; }
fieldset.cx-g legend { padding: 0 6px; font: 800 12px/1.3 var(--f-display); letter-spacing: .08em; text-transform: uppercase; color: var(--accent); }
.cx-f { display: grid; gap: 3px; min-width: 0; }
.cx-f label { font: 600 13.5px/1.35 var(--f-display); }
.cx-in { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; }
.cx-in input { width: 9.5em; max-width: 100%; min-height: 44px; font: 600 16px var(--f-mono); color: var(--ink); background: var(--bg); border: 1px solid var(--rule); border-radius: 8px; padding: 6px 10px; }
.cx-in input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.cx-in input[aria-invalid="true"] { border-color: var(--fire); box-shadow: 0 0 0 1px var(--fire); }
.cx-u { font: 500 12.5px/1.3 var(--f-display); color: var(--muted); min-width: 0; }
.cx-e { font: 700 12.5px/1.35 var(--f-display); color: var(--fire); }
.cx-acts { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; margin-top: 12px; }
.cx-acts .btn { min-height: 44px; }
.cx-bad { margin: 0; color: var(--fire); font-weight: 600; }
.cx-msgs { display: grid; gap: 6px; margin-top: 12px; }
.cx-msgs:empty { display: none; }
.cx-msg { margin: 0; padding: 8px 12px; border-left: 4px solid var(--fire); background: var(--fire-soft); border-radius: 0 8px 8px 0; font-size: 14.5px; line-height: 1.45; }
.cx-bar { margin-top: 14px; }
.cx-bar .gb { height: 28px; }
.cx-bar .kleg b { font-family: var(--f-mono); color: var(--ink); }
dl.cx-out { margin: 14px 0 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 210px), 1fr)); gap: 8px; }
@media (max-width: 520px) { dl.cx-out { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; } .cx-o { padding: 6px 8px; } .cx-v { font-size: 17px; } }
.cx-o { border: 1px solid var(--rule); border-radius: 10px; padding: 7px 10px; min-width: 0; }
.cx-o.is-key { border: 2px solid var(--accent); }
.cx-o dt { font: 600 12.5px/1.35 var(--f-display); color: var(--muted); }
.cx-o dd { margin: 3px 0 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 6px; }
.cx-v { font: 800 19px/1.2 var(--f-mono); color: var(--ink); overflow-wrap: anywhere; }
.cx-v.is-yes { color: var(--okc); } .cx-v.is-no { color: var(--fire); }
.cx-ou { font: 600 12.5px var(--f-display); color: var(--muted); }
.cx-fx { margin-top: 16px; }
.cx-fx ol { margin: 4px 0 0; padding-left: 22px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px; }
.cx-fx ol > li { min-width: 0; }
.cx-fl { margin: 0; font: 600 13px/1.3 var(--f-display); color: var(--muted); }
.cx-fx .mb math { font-size: 1.05em; }
.cx-notes { margin: 14px 0 0; padding-left: 20px; font-size: 14px; line-height: 1.5; color: var(--muted); display: grid; gap: 4px; }
/* ---------- cadenas de pasos (la cadena, arrancar, la API y el diagnóstico) */
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
.ch__s.c--pre { --c: var(--pre); } .ch__s.c--kv { --c: var(--kv); } .ch__s.c--dec { --c: var(--dec); } .ch__s.c--wt { --c: var(--wt); } .ch__s.c--ok { --c: var(--okc); }
.ch__s.c--pre .ch__no { color: var(--on-hi); } .ch__s .ch__no { color: var(--paper); }
.ch__tp b.c--pre { background: var(--pre); color: var(--on-hi); } .ch__tp b.c--kv { background: var(--kv); } .ch__tp b.c--dec { background: var(--dec); } .ch__tp b.c--wt { background: var(--wt); } .ch__tp b.c--ok { background: var(--okc); }
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
  .pd__keys, .pd__fl, .kc__lg, .tz__wl, .kc__ut, .kc__bl, .cb__st, .cb__rq, ul.cb__ru, .lt__mk, .lt__pl, .pa__node, .pa__sp, .pa__kv, .pa__x, ul.pa__cm, .pa__v, .qu__m, .qu__h, .qu__k, .qu__n, .qu__ck ul, .qu__rl, .qu__eb li, .gw__x, .gw__fs, ul.gw__kv, .gw__to li, .tz__ext, .tz__src, .tz__n, .tz__p { font-size: 9.5px; }
  .gax, .kc__uv, .qu__en, .gw__tv, .gw__t, .gb__t, .pd__bt, .tz__d, .tz__b span, .cb__c, .cb__c0, .cb__hd, .qu__bp, .gw__f, .pa__gl, .pd__zl { font-size: 8.5px !important; }
  .gb { height: 18px; } .pd__trk, .pd__ztrk { height: 20px; } .cb__c, .cb__x { height: 18px; } .cb__c0, .cb__hd { line-height: 18px; } .tz__b { height: 11px; }
  .pa { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; } ol.qu { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; } .kc__2, .gw__g { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important; } .qu__2 { grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr) !important; }
  .gw__eh, .pa__n, .qu__h b { font-size: 11px; } .cb__h { font-size: 10.5px; }
  .ch__s { padding: 0 0 9px 32px; } .ch__no { width: 23px; height: 23px; font-size: 11px; } .ch__s::before { left: 10px; top: 25px; } .ch__l { font-size: 12px; padding-top: 1px; } .ch__n, .ch__ask { font-size: 10px; } .ch__tp { font-size: 9.5px; } .ch__br { margin-left: 32px; } .ch__who, .ch__gl { font-size: 8px; }
  /* el código y los textos chicos de las figuras, al tamaño del resto del PDF */
  figure.fig code, figure.fig code.cmd { font-size: 8.5px !important; } .qb code.cmd { padding: 3px 6px; } .ktag { font-size: 7.5px; }
  .ui { font-size: 9px !important; } .ui__home { font-size: 7px !important; }
  .notes, .memo, .trap, ol.errlist li, .tpl, .mb, ul.ex__notes li, .pd__w, .pd__z, .kc__r, .kc__u, .kc__g, .kc__v, .tz__f, .tz__t, .tz__w, .cb__g, svg.chart, .lt__mk, .pa__c, .qu__r, .qu__ck, .qu__rd, .gw__e, .gw__cl, .gw__b, .gw__tn, .ch__s, .ch__br, .ch__tr, .cx-o { break-inside: avoid; }
  tr { break-inside: avoid; }
  .card > h3, .example > h3, .tag, .to__h, .code__bar { break-after: avoid; }
  .links { break-before: avoid; }
}
`;

// Sin ligaduras en la letra monoespaciada: el shorthand font: de reglas como .code pre o .vars td.c vuelve a poner
// font-variant-ligatures y font-feature-settings en normal, y JetBrains Mono dibuja -> como una flecha y <| |> como
// triángulos (los tokens especiales del chat template). Esta regla va al final, con los mismos selectores que usan la
// letra monoespaciada, así gana en la cascada.
const MONO_RULES = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => /var\(--f-mono\)/.test(m[2]));
const MONO_SEL = [...new Set(MONO_RULES.map((m) => m[1].trim()).filter((x) => x && !x.startsWith('@')).flatMap((x) => x.split(/\s*,\s*/)))];
const CSS_ALL = CSS + `\n${MONO_SEL.join(', ')}, code *, pre * { font-variant-ligatures: none; font-feature-settings: "liga" 0, "calt" 0; }\n`;

// ================================================================ JS de la página (sin librerías: funciona sin conexión)
const DATA = {
  errs: ERRS.map((e) => ({ msg: e.msg, meaning: e.meaning, first: cmdHtml(e.first), sec: e.sec, lab: SECLAB(e.sec) })),
  calc: {
    inputs: CALC_C.inputs.map((x) => ({ id: x.id, label: x.label, min: x.min, max: x.max, default: x.default })),
    presets: (CALC.presets || []).map((p) => ({ name: p.name, values: p.values })),
    outputs: CALC_C.outputs.map((o) => ({ id: o.id, kind: o.kind || '', decimals: o.decimals ?? 2 })),
    validations: CALC_C.validations.map((v) => ({ message: v.message, hides: v.hides })),
    bar: CALC_BAR,
  },
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

  // ---------- calculadora de VRAM y KV cache: las mismas funciones que corrieron en node, compiladas en el build (sin eval)
  var CX = D.calc, CF = /*CALCF*/;
  if ($('calculadora')) (function () {
    var IN = {}, OUT = {};
    CX.inputs.forEach(function (x) { IN[x.id] = $('cx-' + x.id); });
    CX.outputs.forEach(function (o) { OUT[o.id] = $('cx-o-' + o.id); });
    function group(t) { return t.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
    // 208,740 · 68.4 · −2.2: separador de miles, los decimales de cada salida y el signo menos de verdad
    function fmt(v, dec) {
      if (typeof v !== 'number' || !isFinite(v)) return '—';
      var t = Math.abs(v).toFixed(dec), p = t.split('.');
      return (v < 0 && +t !== 0 ? '−' : '') + group(p[0]) + (p[1] ? '.' + p[1] : '');
    }
    function plain(v) { var p = String(v).split('.'); return group(p[0]) + (p[1] ? '.' + p[1] : ''); }
    function fmtA(v) { return fmt(v, Math.abs(v - Math.round(v)) < 0.05 ? 0 : 1); } // 160 GB, 171.0 → 171, 85.5
    function pc(f) { return (Math.round(Math.max(0, Math.min(1, f)) * 10000) / 100) + '%'; }
    function read() {
      var vals = {}, bad = 0;
      CX.inputs.forEach(function (x) {
        var el = IN[x.id], e = $('cx-e-' + x.id), raw = String(el.value).trim(), v = raw === '' ? NaN : Number(raw), msg = '';
        if (!isFinite(v)) msg = 'Escribe un número.';
        else if (v < x.min || v > x.max) msg = 'Va de ' + plain(x.min) + ' a ' + plain(x.max) + '.';
        e.textContent = msg; e.hidden = !msg; el.setAttribute('aria-invalid', msg ? 'true' : 'false');
        if (msg) bad++;
        vals[x.id] = v;
      });
      return { vals: vals, bad: bad };
    }
    // la réplica a escala: pesos, overhead, KV en uso, KV libre y lo que vLLM no toca; si no cabe, lo que se pasa en rojo
    function seg(k, l, w, t) { return w > 0 ? '<span class="gb__s gb--' + k + '" style="left:' + pc(l) + ';width:' + pc(w) + '">' + (t && w >= 0.17 ? '<span class="gb__t">' + t + '</span>' : '') + '</span>' : ''; }
    function bar(s) {
      var g = $('cx-gb');
      if (!g || !CX.bar) return;
      var G = 1e9, tot = s.tp * s.gpu_gb, w = s.weights_bytes / G, ov = s.overhead_gb, bud = s.budget_bytes / G, room = s.room_bytes / G;
      var live = Math.max(0, s.live_tokens * s.kv_bytes_token / G), use = Math.min(live, Math.max(0, room));
      var sc = Math.max(tot, w + ov) || 1, h = '';
      h += seg('wt', 0, w / sc, fmt(w, 1) + '&nbsp;GB') + seg('ov', w / sc, ov / sc);
      if (room >= 0) h += seg('kvu', (w + ov) / sc, use / sc, fmt(use, 1) + '&nbsp;GB') + seg('fr', (w + ov + use) / sc, (room - use) / sc, fmt(room - use, 1) + '&nbsp;GB') + seg('rs', bud / sc, (tot - bud) / sc);
      else h += seg('over', bud / sc, (w + ov - bud) / sc) + (tot > w + ov ? seg('rs', (w + ov) / sc, (tot - w - ov) / sc) : '');
      g.innerHTML = '<div class="gb__in">' + h + '</div><span class="gb__m" style="left:' + pc(bud / sc) + '"></span>';
      var pw = Math.pow(10, Math.floor(Math.log10(sc)) - 1), cands = [], st = 0, ax = '';
      [1, 2, 2.5, 3, 4, 5, 10, 20, 25, 30, 40, 50].forEach(function (k) { cands.push(k * pw); });
      cands.forEach(function (c) { var n = sc / c; if (!st && Math.abs(n - Math.round(n)) < 1e-9 && n >= 3 && n <= 6) st = c; });
      if (!st) { var raw = sc / 4, p2 = Math.pow(10, Math.floor(Math.log10(raw))); st = [1, 2, 2.5, 5, 10].map(function (k) { return k * p2; }).filter(function (x) { return x >= raw; })[0]; }
      for (var v = 0; v <= sc + 1e-9; v += st) ax += '<span class="' + (v === 0 ? 'is-0' : v / sc > 0.93 ? 'is-n' : '') + '" style="left:' + pc(v / sc) + '">' + plain(Math.round(v * 100) / 100) + '</span>';
      $('cx-ax').innerHTML = ax;
      $('cx-bt').textContent = fmtA(tot) + ' GB en ' + s.tp + (s.tp === 1 ? ' GPU' : ' GPUs') + ' (eje en GB)';
      var L = [['wt', 'pesos', w], ['ov', 'overhead', ov]];
      if (room >= 0) L.push(['kvu', 'KV de las secuencias vivas', use], ['fr', 'KV libre', room - use]); else L.push(['over', 'no cabe', w + ov - bud]);
      L.push(['rs', 'vLLM no lo toca', tot - bud]);
      $('cx-lg').innerHTML = L.map(function (x) { return '<span><i class="sw sw--' + x[0] + '"></i>' + x[1] + ' <b>' + fmtA(x[2]) + '&nbsp;GB</b></span>'; }).join('') + '<span><i class="sw sw--lim"></i>tope de vLLM <b>' + fmtA(bud) + '&nbsp;GB</b></span>';
    }
    function calc() {
      var r = read(), k;
      $('cx-bad').hidden = !r.bad;
      if (r.bad) {
        $('cx-bad').textContent = 'Corrige ' + (r.bad === 1 ? 'el campo marcado' : 'los ' + r.bad + ' campos marcados') + ': mientras tanto, los resultados quedan en blanco.';
        CX.outputs.forEach(function (o) { var el = OUT[o.id], b = el.querySelector('.cx-v'); el.hidden = false; b.textContent = '—'; b.className = 'cx-v'; });
        $('cx-msgs').innerHTML = '';
        if ($('cx-gb')) { $('cx-gb').innerHTML = ''; $('cx-ax').innerHTML = ''; $('cx-lg').innerHTML = ''; $('cx-bt').textContent = '—'; }
        return;
      }
      var s = {};
      for (k in r.vals) s[k] = r.vals[k];
      CF.f.forEach(function (f) { s[f[0]] = f[1](s); });
      var hide = {}, msgs = [];
      CF.v.forEach(function (fn, i) { if (fn(s)) { msgs.push(CX.validations[i].message); CX.validations[i].hides.forEach(function (id) { hide[id] = 1; }); } });
      CF.o.forEach(function (o, i) {
        var m = CX.outputs[i], el = OUT[o[0]], v = o[1](s), b = el.querySelector('.cx-v');
        el.hidden = !!hide[o[0]];
        if (m.kind === 'bool') { b.textContent = v ? 'sí' : 'no'; b.className = 'cx-v ' + (v ? 'is-yes' : 'is-no'); }
        else { b.textContent = fmt(v, m.decimals); b.className = 'cx-v'; }
      });
      $('cx-msgs').innerHTML = msgs.map(function (m) { return '<p class="cx-msg">' + esc(m) + '</p>'; }).join('');
      bar(s);
      doc.querySelectorAll('.cx-p').forEach(function (b) { var p = CX.presets[+b.getAttribute('data-p')]; b.setAttribute('aria-pressed', CX.inputs.every(function (x) { return p.values[x.id] === r.vals[x.id]; }) ? 'true' : 'false'); });
    }
    CX.inputs.forEach(function (x) { IN[x.id].addEventListener('input', calc); });
    doc.querySelectorAll('.cx-p').forEach(function (b) { b.addEventListener('click', function () { var p = CX.presets[+b.getAttribute('data-p')]; CX.inputs.forEach(function (x) { if (p.values[x.id] !== undefined) IN[x.id].value = p.values[x.id]; }); calc(); }); });
    $('cx-reset').addEventListener('click', function () { CX.inputs.forEach(function (x) { IN[x.id].value = x.default; }); calc(); });
    calc();
  })();

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
const JS = JS_SRC.replace('/*DATA*/', () => jsonForScript(DATA)).replace('/*CALCF*/', () => CALC_C.js);

// ================================================================ página
const NAV = [...ORDER.map((id) => [id, NAVL[id]]), ['diagnosticador', 'Diagnosticador'], ['calculadora', 'Calculadora']];
const TITLE = 'Serving de LLMs con vLLM';
const HEAD = `<title>${TITLE}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&family=JetBrains+Mono:wght@400;600;700&family=Source+Serif+4:ital,opsz,wght@0,8..60,400..700;1,8..60,400..700&display=swap">
<style>${CSS_ALL}</style>`;
// Versiones del pie: vLLM de la imagen del manifest del C10 (vllm/vllm-openai:vX.Y.Z), las del gateway de su
// requirements.txt (fastapi, uvicorn y el cliente HTTP que fija) y la versión actual de vLLM, la que dice el contenido. Si
// el C10 o el contenido cambian, el pie cambia con ellos.
const VER = (() => {
  const man = readFileSync(join(C10, 'k8s/vllm-70b.yaml'), 'utf8'), req = readFileSync(join(C10, 'gateway/requirements.txt'), 'utf8');
  const pin = (name) => (req.match(new RegExp(`^${name.replace(/[.-]/g, '\\$&')}==([\\d.]+)`, 'mi')) || [])[1];
  const vllm = (man.match(/image:\s*vllm\/vllm-openai:v?(\d+\.\d+\.\d+)/) || [])[1];
  const http = pin('httpx2') ? ['httpx2', pin('httpx2')] : ['httpx', pin('httpx')];
  const gw = { fastapi: pin('fastapi'), uvicorn: pin('uvicorn'), [http[0]]: http[1] };
  const txt = JSON.stringify([W1, W2, W3]);
  const cur = (txt.match(/v(\d+\.\d+\.\d+)\s*\((?:la )?versión actual/) || txt.match(/(?:la )?última es v(\d+\.\d+\.\d+)/) || [])[1];
  if (!vllm) aviso('el pie no encontró la imagen vllm/vllm-openai en k8s/vllm-70b.yaml');
  Object.entries(gw).forEach(([k, x]) => { if (!x) aviso(`el pie no encontró la versión de ${k} en gateway/requirements.txt`); });
  if (!cur) aviso('el pie no encontró la versión actual de vLLM en el contenido');
  return { vllm: vllm ? `v${vllm}` : '', gw: Object.entries(gw).filter(([, x]) => x).map(([k, x]) => `${k} ${x}`).join(', '), cur: cur ? `v${cur}` : '' };
})();
const N_EXEC = ORDER.filter((id) => byId[id].lab && byId[id].lab.verified === 'executed').length;
const N_LABS = ORDER.filter((id) => byId[id].lab).length;
// las secciones y las herramientas se arman antes que el hero: así se sabe si el contenido usó lugares de la web
const SECTIONS = ORDER.map(sectionHtml).join('\n');
const TOOLS = toolsHtml();
const LEG_UI = UI_USED ? `<span>${placeHtml('Hugging Face → Files and versions')}un lugar de la web: se abre, no se copia</span>` : '';
const WRAP = `<div class="wrap">
  <header class="hero">
    <p class="kicker">Ronda de Diseño ML · Serving de LLMs · ejemplos del C10</p>
    <h1>${TITLE}</h1>
    <p class="lead">Para levantar un LLM con vLLM con la documentación abierta, saber cuántas conversaciones caben en tu GPU y diagnosticar por qué el primer token tarda, las respuestas se cortan o el servidor no arranca por memoria. En el C10, un modelo de ≈&nbsp;70B con pesos FP8 corre en 2 H100 por réplica: vLLM lee el prompt completo de una vez (prefill), guarda lo leído en el KV cache y escribe la respuesta token por token (decode), mezclando en cada paso las conversaciones de muchos usuarios. Cada sección trae la sintaxis como plantilla con variables, las piezas, un ejemplo real del curso, una figura, un truco para recordarla, la trampa típica y un laboratorio opcional. En la versión web, al final hay un diagnosticador de síntomas, una calculadora de VRAM y KV cache y un quiz de errores.</p>
    <p class="legendrow"><span><i class="dot" style="background:var(--hi-soft);outline:1px solid var(--hi)"></i>Cómo recordarla</span><span><i class="dot" style="background:var(--warn-soft);outline:1px solid var(--warn)"></i>Trampa típica</span><span><var class="ph">variable</var>la cambias tú</span><span><i class="dot" style="background:var(--accent2)"></i>Ejemplos en verde</span>${LEG_UI}</p>
    <p class="legendrow"><span class="lgk">En las figuras:</span><span><i class="dot" style="background:var(--wt)"></i>pesos</span><span><i class="dot" style="background:var(--kv)"></i>KV cache</span><span><i class="dot" style="background:var(--pre)"></i>prefill o espera en la cola</span><span><i class="dot" style="background:var(--dec)"></i>decode o tokens generados</span><span><i class="dot" style="background:var(--okc)"></i>ok, libre o dentro del SLO</span><span><i class="dot" style="background:var(--fire)"></i>OOM, preemption, fuera del SLO o rechazado</span><span><i class="dot" style="background:var(--off)"></i>overhead, activaciones, reservado u ocioso</span></p>
  </header>
  <nav class="toc" aria-label="Secciones"><ul>${NAV.map(([id, l]) => `<li><a href="#${id}">${esc(l)}</a></li>`).join('')}</ul></nav>
  ${SECTIONS}
  ${TOOLS}
  <footer>Flags, defaults, endpoints, métricas y mensajes revisados en octubre de 2026 contra la documentación oficial de vLLM, su código en GitHub, la referencia de la API de OpenAI y los config.json de los modelos en Hugging Face, y contra los archivos de <code>reference/c10</code> del curso. Las versiones son las del C10 (vLLM ${esc(VER.vllm)} en la imagen; el gateway con ${esc(VER.gw)}) y la actual de vLLM (${esc(VER.cur)}); cuando la versión actual cambia algo, la sección lo dice. ${N_EXEC === N_LABS ? `De los ${N_LABS} laboratorios, los ${N_EXEC} se corrieron de verdad en un Mac, sin GPU.` : `De los ${N_LABS} laboratorios, ${N_EXEC} se corrieron de verdad en un Mac; los demás se verificaron contra la documentación.`} Si tu terminal dice otra cosa, créele a tu terminal.</footer>
</div>`;

const KATEX = '<script src="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.11/katex.min.js"></script><script id="render-math">document.querySelectorAll("[data-tex]").forEach(function (el) { katex.render(el.dataset.tex, el, { displayMode: el.classList.contains("mb"), output: "mathml", throwOnError: false, strict: "ignore" }); }); window.__math = document.querySelectorAll("[data-tex] math").length;</script>';
// Los checks de la calculadora otra vez, en Chrome y con la misma fuente compilada que lleva la página (window.__calc).
const CALC_TEST = { mode: CALC_TOL, checks: (CALC.checks || []).map((c) => ({ values: c.values, expect: c.expect, tolerance: c.tolerance })) };
const CALC_CHECK = `<script id="calc-check">window.__calc = (function () {
  try {
    var CF = ${CALC_C.js}, T = ${jsonForScript(CALC_TEST)}, res = [];
    T.checks.forEach(function (c, i) {
      var s = {}, k, out = {};
      for (k in c.values) s[k] = c.values[k];
      CF.f.forEach(function (f) { s[f[0]] = f[1](s); });
      CF.o.forEach(function (o) { out[o[0]] = o[1](s); });
      Object.keys(c.expect).forEach(function (k) { var got = k in out ? out[k] : s[k], want = c.expect[k], tol = +c.tolerance || 0, lim = T.mode === 'relative' ? tol * Math.abs(want) : tol; res.push({ i: i + 1, k: k, got: got, want: want, ok: typeof got === 'number' && Math.abs(got - want) <= lim + 1e-9 }); });
    });
    return { n: res.length, ok: res.filter(function (r) { return r.ok; }).length, fails: res.filter(function (r) { return !r.ok; }) };
  } catch (e) { return { error: String(e && e.stack || e) }; }
})();</script>`;

function writeSrc(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'head.html'), HEAD);
  writeFileSync(join(dir, 'wrap.html'), WRAP);
  writeFileSync(join(dir, 'script.js'), JS);
  // src.html: sin el script de la página, para que el .wrap que se captura quede intacto (solo con el TeX renderizado).
  writeFileSync(join(dir, 'src.html'), '<!doctype html>\n<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' + HEAD + '</head><body>' + WRAP + KATEX + CALC_CHECK + '</body></html>');
  const texN = (WRAP.match(/data-tex=/g) || []).length;
  console.log('src ok ·', (HEAD + WRAP + JS).length, 'bytes ·', texN, 'fórmulas ·', ORDER.length, 'secciones');
  console.log(`datos: ${ORDER.length} secciones · laboratorios ${N_LABS} (${N_EXEC} probados) · diagnosticador ${W3.diagnosticador.length} síntomas · calculadora ${CALC_C.inputs.length} inputs, ${CALC_C.formulas.length} fórmulas, ${CALC_C.outputs.length} salidas, ${(CALC.checks || []).length} checks · errores ${ERRS.length} mensajes · contenido de ${CONTENT}`);
  CALC_C.validations.forEach((v, i) => console.log(`  validación ${i + 1} (${v.refs.join(', ')}) esconde: ${v.hides.join(', ') || 'nada'}`));
  return texN;
}
// Los checks de la calculadora: en node (al cargar el generador) y en Chrome (en la pasada del build). Avisos si algo no da.
function calcReport(v) {
  const nOk = CALC_NODE.filter((r) => r.ok).length;
  console.log(`calculadora (node): ${nOk}/${CALC_NODE.length} checks bien`);
  if (!v) { aviso('calculadora: sin resultado de los checks en Chrome'); return; }
  if (v.error) { aviso(`calculadora: los checks en Chrome fallaron: ${v.error}`); return; }
  console.log(`calculadora (Chrome): ${v.ok}/${v.n} checks bien`);
  (v.fails || []).forEach((f) => aviso(`calculadora (Chrome): el check ${f.i} da ${f.k} = ${f.got}, se esperaba ${f.want}`));
  if (v.n !== CALC_NODE.length) aviso(`calculadora: node corrió ${CALC_NODE.length} comparaciones y Chrome ${v.n}`);
}
function report() {
  if (AVISOS.length) { console.log(`avisos del contenido (${AVISOS.length}):`); AVISOS.forEach((a) => console.log('  - ' + a)); }
  else console.log('avisos del contenido: ninguno');
}
function pdf(pagePath) {
  const out = join(HERE, '..', 'cheatsheet-vllm.pdf');
  const prof = mkdtempSync(join(tmpdir(), 'vllm-pdf-'));
  const r = spawnSync(CHROME, ['--headless=new', '--no-pdf-header-footer', '--virtual-time-budget=10000', `--print-to-pdf=${out}`, `--user-data-dir=${prof}`, pathToFileURL(pagePath).href], { encoding: 'utf8', timeout: 180000 });
  try { rmSync(prof, { recursive: true, force: true }); } catch (e) { /* no importa */ }
  if (r.status !== 0 || !existsSync(out)) { console.error(r.stdout, r.stderr); throw new Error('Chrome no pudo imprimir el PDF'); }
  console.log('cheatsheet-vllm.pdf listo');
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
  const evalJs = "(async () => { for (let i = 0; i < 150 && (!window.__math || !window.__calc); i++) await new Promise(r => setTimeout(r, 100)); const errs = [...document.querySelectorAll('.katex-error')].map(e => e.getAttribute('title') || e.textContent).slice(0, 10); return JSON.stringify({ n: window.__math || 0, total: document.querySelectorAll('[data-tex]').length, errors: errs, calc: window.__calc || null, html: document.querySelector('.wrap').outerHTML }); })()";
  const r = spawnSync('node', [join(APP, 'tools/browser-check.mjs'), '--url', join(out, 'src.html'), '--wait', '1500', '--timeout', '120000', '--light', '--eval', evalJs], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const lineE = (r.stdout || '').split('\n').find((l) => l.startsWith('[eval] '));
  if (!lineE) { console.error(r.stdout, r.stderr); throw new Error('sin resultado del render'); }
  const v = JSON.parse(JSON.parse(lineE.slice(7)));
  console.log('math', v.n, 'de', v.total, '· errores', v.errors.length, v.errors);
  (r.stdout || '').split('\n').filter((l) => !l.startsWith('[eval] ')).forEach((l) => l && console.log('  ' + l));
  if (v.n !== v.total || v.errors.length) throw new Error('hay fórmulas sin renderizar');
  calcReport(v.calc);
  const page = HEAD + '\n' + v.html + '\n<script>' + JS + '</script>';
  writeFileSync(join(out, 'artifact.html'), page);
  const pagePath = join(HERE, '..', 'cheatsheet-vllm.html');
  writeFileSync(pagePath, '<!doctype html>\n<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' + HEAD + '</head><body>' + v.html + '\n<script>' + JS + '</script></body></html>');
  console.log('final', page.length, 'bytes');
  if (mode === 'pdf') pdf(pagePath);
  report();
} else { console.error('modo desconocido: ' + mode + ' (usa src, build, pdf o cmds)'); process.exit(2); }
