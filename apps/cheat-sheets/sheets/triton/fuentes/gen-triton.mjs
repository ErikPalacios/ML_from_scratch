// Genera "De PyTorch a Triton", cuarta hermana de las hojas de Docker, Kubernetes y Git (sheets/git/fuentes/gen-git.mjs,
// de donde sale este archivo): mismos tokens claro/oscuro, fuentes, hero, nav de chips, .pad con papel cuadriculado,
// tabla de piezas, ejemplo con botón de copiar, "Cómo recordarla" / "Trampa", laboratorios plegados, chips del curso, CSS
// de impresión, diagnosticador, revisor (aquí, de config.pbtxt, con su propio parser de protobuf en texto) y quiz.
//
// Las figuras se leen en un celular de 375 px sin scroll horizontal: casi todas son HTML que se acomoda solo (barras con
// anchos en %, grillas que pasan de columnas a filas); la de rendimiento es un SVG con una variante para el celular.
// A escala donde hay números: los bytes y la VRAM de la precisión, las cuentas de operaciones del grafo, la línea de
// tiempo del batching (ms), los bytes que viajan por la red, la escala de |Δlogit| y las curvas de rendimiento.
// Un color significa lo mismo en todas: azul = CPU, verde azulado = la GPU y su trabajo (ejecuciones, throughput),
// ámbar = espera y latencia, violeta = precisión (más oscuro = más bytes: FP32, FP16, INT8), rojo = falla, se rechaza o
// no carga, gris punteado = se ignora o es un ejemplo.
//
// Uso:
//   node gen-triton.mjs src <dir>   → <dir>/head.html, wrap.html, script.js, revisor.js y src.html (con KaTeX de cdnjs)
//   node gen-triton.mjs build       → lo anterior en ./out, pasa [data-tex] a MathML estático con tools/browser-check.mjs
//                                     (de la app ml-system-design) y escribe out/artifact.html (para el Artifact de
//                                     claude.ai) y ../cheatsheet-triton.html (la página del sitio y la fuente del PDF)
//   node gen-triton.mjs pdf         → build y además ../cheatsheet-triton.pdf (Chrome headless, A4)
//   node gen-triton.mjs cmds        → muestra cómo se parte cada texto con comandos: [código copiable] «nota»
// El contenido está en content-w1/2/3.json de esta carpeta (TRITON_CONTENT=<carpeta> lee otra). El generador no lo
// cambia: al final lista los avisos del contenido (enlaces que no existen, figuras que no cierran, datos raros).
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '../../../../ml-system-design'); // módulos del curso, browser-check.mjs y reference/c01
const CONTENT = process.env.TRITON_CONTENT ? resolve(process.env.TRITON_CONTENT) : HERE;
const readJSON = (f) => JSON.parse(readFileSync(join(CONTENT, f), 'utf8'));
const W1 = readJSON('content-w1.json'), W2 = readJSON('content-w2.json'), W3 = readJSON('content-w3.json');
const C01_CONFIG = join(APP, 'reference/c01/triton/model_repository/classifier/config.pbtxt');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const AVISOS = [];
const aviso = (m) => { if (!AVISOS.includes(m)) AVISOS.push(m); };

// ---------------------------------------------------------------- utilidades (las de gen-git.mjs)
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
// 24532532 → 24,532,532 (el contenido usa coma de miles y punto decimal)
const fmtN = (x) => { const [i, d] = String(x).split('.'); return i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (d ? '.' + d : ''); };
// {placeholder} → variable con aspecto de variable matemática; acepta puntos ({modelo.onnx}, {datos.json}). No toca
// ${VAR} (bash), { mapas: con espacio } (protobuf, Python) ni {0: "batch"}.
const PH = /(\$|@)?\{([A-Za-zÀ-ÖØ-öø-ÿ_][\wÀ-ÖØ-öø-ÿ]*(?:\.[\wÀ-ÖØ-öø-ÿ]+)*)\}/g;
const phs = (escaped) => escaped.replace(PH, (m, pre, name) => (pre === '$' ? m : pre === '@' ? `@{<var class="ph">${name}</var>}` : `<var class="ph">${name}</var>`));
// Las flags (--fp16, --minShapes) no se parten en el guion.
const nbFlags = (h) => h.replace(/(^|[\s(\[>])(--?[A-Za-z][A-Za-z0-9-]*)/g, (m, pre, f) => {
  if (f.length <= 16) return `${pre}<span class="nb">${f}</span>`;
  const head = f.match(/^--?[A-Za-z0-9]+/)[0];
  return `${pre}<span class="nb">${head}</span>${f.slice(head.length)}`;
});
// Un número no se separa de su unidad al final de un renglón ("602 KB", "2 ms", "250 req/s").
const nbu = (h) => h.replace(/(\d) (s|ms|µs|min|h|días|GB|MB|KB|B|MiB|GiB|TB|%|vCPU|GPU|GPUs|W|pp|px|MP|TFLOPS|TOPS|req\/s|img\/s|Gb\/s|GB\/s|bytes|cores|clases)(?=$|[\s.,;:)\]])/g, '$1&nbsp;$2');
const tx = (s) => nbu(nbFlags(esc(s)));
const rx = (s) => nbu(nbFlags(rich(s)));
const ph = (s) => phs(esc(s));
const phT = (s) => phs(nbFlags(esc(s)));
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

// Símbolo de una variable (λ, t_exec(B), μ\u0302, σ²_B, T₅, ΔN_ok, max|Δlogit|, max_batch_size…) → TeX para la tabla.
const GREEK = { α: '\\alpha', β: '\\beta', γ: '\\gamma', δ: '\\delta', ε: '\\varepsilon', θ: '\\theta', λ: '\\lambda', μ: '\\mu', π: '\\pi', ρ: '\\rho', σ: '\\sigma', τ: '\\tau', φ: '\\varphi', ω: '\\omega', Δ: '\\Delta' };
const SUB_D = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' };
const SUP_D = { '¹': '1', '²': '2', '³': '3' };
function symTex(s) {
  const base = (h) => {
    let pre = '';
    if (h.length > 1 && h[0] === 'Δ') { pre = '\\Delta '; h = h.slice(1); }
    const m = h.match(/^(.)([\u0302\u0304]?)([¹²³]?)([₀-₉]*)$/u);
    if (m) {
      let b = GREEK[m[1]] || m[1];
      if (m[2] === '\u0302') b = `\\hat{${b}}`;
      if (m[2] === '\u0304') b = `\\bar{${b}}`;
      if (m[3]) b += `^{${SUP_D[m[3]]}}`;
      if (m[4]) b += `_{${[...m[4]].map((c) => SUB_D[c]).join('')}}`;
      return pre + b;
    }
    return pre + `\\text{${h}}`;
  };
  const one = (p) => {
    p = p.trim();
    const mx = p.match(/^max\|(.+)\|$/);
    if (mx) return `\\max|${base(mx[1])}|`;
    if (/\s/.test(p)) return `\\text{${p}}`;
    if ((p.match(/_/g) || []).length >= 2) return `\\texttt{${p.replace(/_/g, '\\_')}}`;
    const i = p.indexOf('_');
    if (i < 0) return base(p);
    const head = p.slice(0, i), sub = p.slice(i + 1);
    const fn = sub.match(/^(\w+)\((.+)\)$/);
    if (fn) return `${base(head)}_{\\text{${fn[1]}}}(${fn[2]})`;
    return `${base(head)}_{${[...sub].length === 1 ? (GREEK[sub] || sub) : `\\text{${sub}}`}}`;
  };
  return s.split(/\s*[,·]\s*/).map(one).join(T`,\ `);
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

// ---------------------------------------------------------------- comandos: separar lo copiable de la nota
const CMD_WORDS = new Set(['git', 'kubectl', 'docker', 'aws', 'curl', 'echo', 'cat', 'grep', 'sed', 'test', 'python', 'python3', 'pip', 'pip3', 'pytest', 'cd', 'ls', 'export', 'jq', 'tail', 'head', 'trtexec', 'nvidia-smi', 'polygraphy', 'perf_analyzer', 'model-analyzer', 'tritonserver', 'uvicorn', 'py-spy', 'bash', 'top', 'find', 'mkdir', 'rm', 'source', 'dmesg', 'chroot', 'df', 'printf', 'sort', 'wc']);
const isCmdWord = (w) => CMD_WORDS.has(w) || /^python3(\.\d+)?$/.test(w) || /^\.\/[\w.-]+/.test(w);
const PROMQL = /^(?:sum|rate|irate|increase|histogram_quantile|avg|max|min|count)(?:\s+(?:by|without)\s*\([^)]*\))?\s*\(/;
const CALL = /^[A-Za-z_][\w.]*\(/; // una llamada de Python: print(…), torch.cuda.memory_summary()
const CUTS = [' (', ' en ', ' y, ', ' y ', ' o ', ' contra ', ': ', ' → ', ' mientras ', ' para '];
// Un tramo que empieza con un comando (o con una expresión de PromQL o de Python) → { cmd, note }. Las comillas y los
// paréntesis no se cortan; una expresión termina en el primer espacio que no sigue con un operador.
function splitCmd(seg) {
  const s = String(seg).trim();
  const first = s.split(/\s+/)[0];
  const expr = !isCmdWord(first) && (PROMQL.test(s) || CALL.test(s));
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
      const words = /^\((?:[A-Za-zÀ-ÿ¿?]+[\s,]+)+[A-Za-zÀ-ÿ¿?]+\)/.test(rest); // "(batch promedio)": texto, no código
      if (!words && (/^(?:\/|\*|\+|-\s|>|<|==|!=|and\b|or\b|by\b|without\b|\(|\[)/.test(rest) || /[/*+><=-]$/.test(before) || /\b(?:by|without)$/.test(before))) continue;
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
// muestra como código copiable.
function cmdHtml(s) {
  return String(s).split(' · ').map((seg) => {
    let pre = '', body = seg;
    if (!splitCmd(seg)) { const m = seg.match(/^([^:()]{1,40}):\s+(.+)$/); if (m && splitCmd(m[2])) { pre = m[1] + ': '; body = m[2]; } }
    const c = splitCmd(body);
    if (!c) return esc(seg);
    return `${pre ? `<span class="cmdn">${esc(pre)}</span>` : ''}${cmdChip(c.cmd)}${c.note ? cmdNote(c.note) : ''}`;
  }).join('<span class="sep"> · </span>');
}
// El cmd de una figura siempre es código (un comando, PromQL, Python o un bloque de config): lo que no se reconoce como
// comando va entero como código copiable.
function codeChips(s) {
  if (!s) return '';
  return `<p class="cc">${String(s).split(' · ').map((seg) => {
    const c = splitCmd(seg);
    if (!c) return cmdChip(seg.trim());
    return `${cmdChip(c.cmd)}${c.note ? cmdNote(c.note) : ''}`;
  }).join('<span class="sep"> · </span>')}</p>`;
}

// ---------------------------------------------------------------- resaltado de código (ligero)
const CLI_SUB = new Set(['rollout', 'config', 'auth', 'create', 'set', 'image', 'run', 'logs', 'debug', 'get', 'describe', 'exec', 'top']);
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
          st.sub = /^(kubectl|docker|git|pip|pip3)$/.test(t) ? 2 : 0;
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
// Python: comentarios, strings (también los de triple comilla, que cruzan renglones) y palabras clave.
const PY_KW = new Set(['def', 'return', 'if', 'elif', 'else', 'for', 'while', 'in', 'not', 'and', 'or', 'is', 'import', 'from', 'as', 'with', 'try', 'except', 'finally', 'raise', 'class', 'lambda', 'None', 'True', 'False', 'async', 'await', 'pass', 'break', 'continue', 'yield', 'global', 'nonlocal', 'assert', 'del']);
function hlPy(code) {
  const re = /("""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|\b[rRbBfFuU]{1,2}"(?:\\.|[^"\\\n])*"?|\b[rRbBfFuU]{1,2}'(?:\\.|[^'\\\n])*'?|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|#[^\n]*|\b[A-Za-z_]\w*\b)/g;
  let out = '', last = 0, m;
  const s = String(code);
  while ((m = re.exec(s))) {
    const t = m[0];
    out += esc(s.slice(last, m.index));
    if (t[0] === '#') out += `<span class="tk-c">${esc(t)}</span>`;
    else if (/^[rRbBfFuU]{0,2}["']/.test(t)) out += `<span class="tk-s">${esc(t)}</span>`;
    else if (PY_KW.has(t)) out += `<span class="tk-k">${esc(t)}</span>`;
    else out += esc(t);
    last = m.index + t.length;
  }
  return out + esc(s.slice(last));
}
// protobuf en texto (config.pbtxt): nombres de campo, strings, enums en mayúsculas y comentarios.
function hlPb(code) {
  return String(code).split('\n').map((ln) => {
    let out = '', i = 0;
    while (i < ln.length) {
      const c = ln[i];
      if (c === '#') { out += `<span class="tk-c">${esc(ln.slice(i))}</span>`; break; }
      if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < ln.length && ln[j] !== c) { if (ln[j] === '\\') j++; j++; }
        out += `<span class="tk-s">${esc(ln.slice(i, j + 1))}</span>`; i = j + 1; continue;
      }
      const m = /^[A-Za-z_][\w.]*/.exec(ln.slice(i));
      if (m) {
        const w = m[0], rest = ln.slice(i + w.length);
        if (/^\s*[:{[<]/.test(rest)) out += `<span class="tk-k">${esc(w)}</span>`;
        else if (/^[A-Z][A-Z0-9_]+$/.test(w)) out += `<span class="tk-e">${esc(w)}</span>`;
        else out += esc(w);
        i += w.length; continue;
      }
      out += esc(c); i++;
    }
    return out;
  }).join('\n');
}
// El cuerpo de un heredoc de bash: Python si lo lee python o si va a un .py; protobuf si va a un .pbtxt.
function heredocLang(ln) {
  if (/\bpython3?(?:\.\d+)?\s+-\s*<</.test(ln)) return 'python';
  const f = (ln.match(/>\s*(\S+)\s*<</) || ln.match(/>\s*(\S+)/) || [])[1] || '';
  return /\.py$/.test(f) ? 'python' : /\.pbtxt$/.test(f) ? 'protobuf' : /\.ya?ml$/.test(f) ? 'yaml' : 'text';
}
const hlBody = (h) => (h.lang === 'python' ? hlPy(h.body.join('\n')) : h.lang === 'protobuf' ? hlPb(h.body.join('\n')) : h.body.map((l) => hlLine(l, h.lang, { atStart: true, cmdPos: true, sub: 0 })).join('\n'));
function hl(code, lang) {
  if (lang === 'python') return hlPy(code);
  if (lang === 'protobuf') return hlPb(code);
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
const LANG = { yaml: 'YAML', bash: 'bash · zsh', text: 'texto', json: 'JSON', python: 'Python', protobuf: 'protobuf (texto)' };
const codeBlock = (code, lang, label, src) => `<div class="code"><div class="code__bar"><span class="code__lang">${esc(label || LANG[lang] || lang)}</span>${src ? `<span class="code__src">${esc(src)}</span>` : ''}${copyBtn()}</div><pre><code>${hl(code, lang)}</code></pre></div>`;

// ---------------------------------------------------------------- SVG
let SVG_N = 0;
const txt = (x, y, s, cls = 't', anchor = 'start', fs = null) => `<text x="${r1(x)}" y="${r1(y)}" class="${cls}" text-anchor="${anchor}"${fs ? ` font-size="${fs}"` : ''}>${esc(s)}</text>`;

// ---------------------------------------------------------------- tablas HTML (se apilan en el celular)
function dataTable(head, rows, { cls = '', mono = [], cmd = [] } = {}) {
  const cell = (v, j) => {
    const content = cmd.includes(j) ? cmdHtml(v) : tx(v);
    const k = j > 0 && head[j] ? ` data-k="${esc(head[j])}"` : '';
    const c = [j === 0 ? 'rh' : '', mono.includes(j) ? 'mono' : '', cmd.includes(j) ? 'cmdc' : ''].filter(Boolean).join(' ');
    return j === 0 ? `<th scope="row"${c ? ` class="${c}"` : ''}>${content}</th>` : `<td${k}${c ? ` class="${c}"` : ''}>${content}</td>`;
  };
  return `<div class="tblw"><table class="dt stk ${cls}"><thead><tr>${head.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map(cell).join('')}</tr>`).join('')}</tbody></table></div>`;
}
const noteP = (s) => (s ? `<p class="fig__note">${rx(s)}</p>` : '');
const notesList = (arr) => (arr && arr.length ? `<ul class="fig__notes">${arr.map((x) => `<li>${rx(x)}</li>`).join('')}</ul>` : '');

// ================================================================ contenido y hechos que usan varias figuras
const ALL = [...W1.sections, ...W2.sections, ...W3.sections];
const byId = Object.fromEntries(ALL.map((x) => [x.id, x]));
// La GPU, su compute capability y la versión de TensorRT del C01 salen del contenido (bolsillo y la cadena); los dos
// mensajes de un engine que no carga, de la lista de errores. Con ellos se dibuja el candado del engine.
const FACT = (() => {
  const f = {};
  const gpuRow = ((byId.bolsillo || {}).pieces || []).find((p) => /compute capability/i.test(p[1] || ''));
  if (gpuRow) {
    f.gpu = (String(gpuRow[0]).match(/\b([A-Z]\d+)\b/) || [])[1];
    const m = String(gpuRow[1]).match(/compute capability (\d+\.\d+)\s*\((sm_\d+)\)/i);
    if (m) { f.cc = m[1]; f.sm = m[2]; }
  }
  const rel = ((byId.cadena || {}).vars || []).map((v) => String(v[2]).match(/(\d\d\.\d\d)\s*\(TensorRT (\d+(?:\.\d+)*)\)/)).find(Boolean);
  if (rel) { f.ngc = rel[1]; f.trt = rel[2]; }
  const msg = (re) => { const e = (W3.errores || []).find((x) => re.test(x.msg)); return e ? (String(e.msg).match(re) || [])[0] : null; };
  f.errTrt = msg(/not compatible with this version of TensorRT/);
  f.errGpu = msg(/generated on an incompatible device/);
  for (const k of ['gpu', 'sm', 'ngc', 'trt', 'errTrt', 'errGpu']) if (!f[k]) aviso(`no encontré ${k} en el contenido (para el candado y la portabilidad del engine)`);
  return f;
})();
const PREC = (s) => (/\bFP32\b/.test(s) ? '32' : /\bFP16\b/.test(s) ? '16' : /\bINT8\b/.test(s) ? '8' : '');
// FP32 / FP16 / INT8 sueltos dentro de un texto ya escapado → chip de su color de precisión
const precTags = (h) => h.replace(/\b(FP32|FP16|INT8)\b/g, (m) => `<span class="pt pt--${PREC(m)}">${m}</span>`);
const LOCK_SVG = '<svg class="lk__i" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 7V5.2a3 3 0 0 1 6 0V7" fill="none"/><rect x="3" y="7" width="10" height="7.5" rx="1.6"/></svg>';
function lockBadge() {
  if (!FACT.gpu && !FACT.trt) return '';
  return `<p class="lk">${LOCK_SVG}<span class="lk__k">Solo carga en</span><span class="lk__g">${esc(FACT.gpu || '?')}${FACT.sm ? ` · ${esc(FACT.sm)}` : ''}</span><span class="lk__p">+</span><span class="lk__t">TensorRT ${esc(FACT.trt || '?')}</span></p>`;
}
// ¿Dónde carga el engine? La GPU y la versión de TensorRT del build, contra otra GPU y otro TensorRT.
function portMatrix() {
  if (!FACT.gpu || !FACT.trt) return '';
  const no = (m) => `<td class="no"><span class="pm__x" aria-hidden="true">✗</span> no carga${m ? `: <code>${esc(m)}</code>` : ''}</td>`;
  return `<div class="pm"><p class="pm__h">${LOCK_SVG}¿Dónde carga este engine?</p>
    <div class="pm__w"><table class="pm__t"><colgroup><col class="pm__c0"><col><col></colgroup><thead><tr><th scope="col"><span class="sr">TensorRT</span></th><th scope="col">${esc(FACT.gpu)}${FACT.cc ? ` (compute capability ${esc(FACT.cc)})` : ''}</th><th scope="col">otra GPU (otra compute capability)</th></tr></thead>
    <tbody><tr><th scope="row">TensorRT ${esc(FACT.trt)}${FACT.ngc ? ` (NGC ${esc(FACT.ngc)})` : ''}</th><td class="ok"><span class="pm__k" aria-hidden="true">✓</span> carga: es la del build</td>${no(FACT.errGpu)}</tr>
    <tr><th scope="row">otro TensorRT (otra release de NGC)</th>${no(FACT.errTrt)}${no('')}</tr></tbody></table></div>
    <p class="pm__n">Salvo que lo construyas con un modo de compatibilidad (<code>--hardwareCompatibilityLevel</code> o <code>--versionCompatible</code>): opcional y más lento.</p></div>`;
}

// ================================================================ figuras
// 0 · Precisión: bytes por parámetro (un cuadrado = 1 byte), MB de pesos del modelo del C01 a escala y la VRAM de la T4.
const fmtGB = (g) => `${fmtN(g[0])}–${fmtN(g[1])} GB`;
function figPrecision(d) {
  const rows = d.rows || [];
  const maxMB = Math.max(1, ...rows.map((r) => +r.weights_mb || 0));
  rows.forEach((r) => {
    const want = (d.params * r.bytes) / 1e6;
    if (d.params && Math.abs(want - r.weights_mb) > 0.01 * want) aviso(`precisión: ${r.dtype} dice ${r.weights_mb} MB, pero ${d.params} × ${r.bytes} B = ${r1(want)} MB`);
    if (!PREC(r.dtype)) aviso(`precisión: no tengo color para ${r.dtype}`);
  });
  const row = (r) => {
    const k = PREC(r.dtype) || '32', n = Math.max(0, Math.min(8, Math.round(+r.bytes || 0)));
    return `<div class="pc__r">
      <p class="pc__dt"><span class="pt pt--${k}">${esc(r.dtype)}</span></p>
      <p class="pc__by"><span class="pc__sq" aria-hidden="true">${`<i class="pt--${k}"></i>`.repeat(n)}</span><span class="pc__bn">${esc(r.bytes)}&nbsp;B</span></p>
      <p class="pc__mb"><span class="pc__trk"><span class="pc__bar pt--${k}" style="width:${pct(r.weights_mb / maxMB)}"></span></span><span class="pc__v">${fmtN(r.weights_mb)}&nbsp;MB</span></p>
      <p class="pc__ro">${tx(r.role)}${r.t4 ? `<span class="pc__t4">${tx(r.t4)}</span>` : ''}</p>
    </div>`;
  };
  let vram = '';
  const v = d.vram;
  if (v) {
    const tot = +v.total_gb || 16, [ulo, uhi] = v.total_used_gb || [0, 0];
    const eng = rows.find((r) => /engine/i.test(r.role || '')) || rows[0];
    const wGB = eng ? eng.weights_mb / 1000 : 0;
    const step = tot <= 16 ? 4 : tot <= 48 ? 8 : 16;
    const ticks = []; for (let g = 0; g <= tot + 1e-9; g += step) ticks.push(g);
    const parts = v.parts || [];
    const pMax = Math.ceil(Math.max(0.1, ...parts.map((p) => p.gb[1])) * 4) / 4;
    const sLo = parts.reduce((s, p) => s + p.gb[0], 0) * (v.instances || 1), sHi = parts.reduce((s, p) => s + p.gb[1], 0) * (v.instances || 1);
    if (Math.abs(sLo - ulo) > 0.35 * ulo + 0.05 || Math.abs(sHi - uhi) > 0.35 * uhi + 0.05) aviso(`precisión: las partes de la VRAM por ${v.instances || 1} instancias suman ${r2(sLo)}–${r2(sHi)} GB y el total dice ${ulo}–${uhi} GB`);
    const part = (p) => `<li><p class="vr__pl">${tx(p.label)}</p><p class="vr__pb"><span class="vr__trk"><span class="vr__lo" style="width:${pct(p.gb[0] / pMax)}"></span><span class="vr__hi" style="left:${pct(p.gb[0] / pMax)};width:${pct((p.gb[1] - p.gb[0]) / pMax)}"></span></span><span class="vr__pv">${fmtGB(p.gb)}</span></p></li>`;
    const aria = `${v.gpu}: ${tot} GB; en uso ≈ ${ulo} a ${uhi} GB; pesos ${eng ? eng.dtype : ''} ${eng ? eng.weights_mb : ''} MB`;
    vram = `<div class="vr">
      <p class="vr__h"><span class="vr__g">${esc(v.gpu)}</span> · ${fmtN(tot)}&nbsp;GB de VRAM <span class="vr__vis">(${tx(v.visible)})</span></p>
      <div class="vr__bar" role="img" aria-label="${esc(aria)}"><span class="vr__used" style="width:${pct(ulo / tot)}"></span><span class="vr__may" style="left:${pct(ulo / tot)};width:${pct((uhi - ulo) / tot)}"></span><span class="vr__w pt--${PREC(eng ? eng.dtype : '') || '16'}" style="width:${pct(wGB / tot)}"></span></div>
      <div class="vr__ax" aria-hidden="true">${ticks.map((g, i) => `<span class="${i === 0 ? 'is-0' : i === ticks.length - 1 ? 'is-n' : ''}" style="left:${pct(g / tot)}">${g}${i === ticks.length - 1 ? '&nbsp;GB' : ''}</span>`).join('')}</div>
      <ul class="vr__lg"><li><i class="vr__sw vr__sw--used"></i><i class="vr__sw vr__sw--may"></i>en uso con ${esc(v.instances)} instancias: ≈&nbsp;${fmtN(ulo)}–${fmtN(uhi)}&nbsp;GB (rango estimado)</li>${eng ? `<li><i class="vr__sw pt--${PREC(eng.dtype) || '16'}"></i>los pesos ${esc(eng.dtype)}: ${fmtN(eng.weights_mb)}&nbsp;MB, el ${fmtN(r1((wGB / tot) * 100))}&nbsp;% de la tarjeta</li>` : ''}<li><i class="vr__sw vr__sw--free"></i>libre</li></ul>
      ${parts.length ? `<p class="vr__ph">De qué está hecho lo que se usa (rango estimado, a escala de 0 a ${fmtN(pMax)}&nbsp;GB)</p><ul class="vr__parts">${parts.map(part).join('')}</ul>` : ''}
      ${v.note ? `<p class="fig__note">${rx(v.note)}</p>` : ''}
    </div>`;
  }
  return `<p class="pc__m"><b>${esc(d.model)}</b> · ${fmtN(d.params)} parámetros</p>
    <div class="pc__hd" aria-hidden="true"><span>Precisión</span><span>Bytes por parámetro</span><span>Pesos del modelo (MB, a escala)</span><span>Para qué · en la T4</span></div>
    <div class="pc">${rows.map(row).join('')}</div>${vram}`;
}

// ↳ · La cadena: seis eslabones del checkpoint a la respuesta medida; los de CPU en azul, los de la GPU en verde azulado.
function figPipeline(d) {
  const st = d.steps || [], sp = d.split || {};
  const after = Number.isInteger(sp.after) ? sp.after : -1;
  if (after < 0 || after > st.length) aviso('cadena: el split no dice después de qué paso empieza la GPU');
  let lockDone = false;
  const item = (s, i) => {
    const gpu = after >= 0 && i >= after;
    const eng = !lockDone && (/engine/i.test(s.label || '') || /\.plan\b/.test(s.artifact || ''));
    if (eng) lockDone = true;
    return `<li class="pi__st pi--${gpu ? 'gpu' : 'cpu'}"><span class="pi__no" aria-hidden="true">${i + 1}</span>
      <div class="pi__a"><p class="pi__l">${esc(s.label)}</p><p class="pi__art">${precTags(tx(s.artifact))}</p><p class="pi__w">${tx(s.where)}</p>${eng ? lockBadge() : ''}</div>
      <div class="pi__b">${codeChips(s.cmd)}<p class="pi__ck"><span class="pi__cm" aria-hidden="true">✓</span><span><span class="k">Revisa:</span> ${tx(s.check)}</span></p></div></li>`;
  };
  const items = st.map(item);
  if (after > 0 && after < st.length) items.splice(after, 0, `<li class="pi__split"><span class="pi__sl">${esc(sp.label || '')}</span></li>`);
  return `<ol class="pi">${items.join('')}</ol><p class="kleg"><span><i class="sw sw--cpu"></i>corre en cualquier CPU</span><span><i class="sw sw--gpu"></i>corre en la GPU</span><span><i class="sw sw--pr"></i>precisión de lo que sale</span></p>`;
}

// 3 · El grafo antes y después (PyTorch → ONNX), con las cuentas de cada operación a escala.
function figBeforeAfter(d) {
  const B = d.before || {}, A = d.after || {}, F = d.fusions || [];
  const away = new Set(F.flatMap((f) => (f.from || []).slice(1)));
  const into = (op) => (F.find((f) => (f.from || []).slice(1).includes(op)) || {}).to || '';
  const nodes = [...(B.nodes || []), ...(A.nodes || [])];
  const maxN = Math.max(1, ...nodes.map((n) => +n.n || 0));
  const op = (n, side) => `<div class="gb__op gb__op--${side}"><p class="gb__on"><code>${esc(n.op)}</code><span class="gb__n">×${esc(n.n)}</span></p><span class="gb__trk"><span class="gb__bar" style="width:${pct(n.n / maxN)}"></span></span>${n.note ? `<p class="gb__nt">${tx(n.note)}</p>` : ''}</div>`;
  const after = A.nodes || [];
  let j = 0;
  const rows = (B.nodes || []).map((n) => {
    if (away.has(n.op)) return `<div class="gb__row gb__row--fold">${op(n, 'b')}<span class="gb__ar" aria-hidden="true">↗</span><div class="gb__fold"><p>plegado en <code>${esc(into(n.op))}</code>: no queda como nodo</p></div></div>`;
    const m = after[j++];
    return `<div class="gb__row">${op(n, 'b')}<span class="gb__ar" aria-hidden="true">→</span>${m ? op(m, 'a') : '<div></div>'}</div>`;
  });
  if (j !== after.length) aviso(`grafo: ${after.length} nodos después y ${j} filas para emparejarlos`);
  const sum = after.reduce((s, n) => s + (+n.n || 0), 0);
  if (A.total && sum !== A.total) aviso(`grafo: los nodos de ONNX suman ${sum}, pero total dice ${A.total}`);
  const io = d.io || {};
  const fus = F.map((f) => `<li>${(f.from || []).map((x) => `<code>${esc(x)}</code>`).join(' + ')} → <code>${esc(f.to)}</code>${f.where ? `: ${tx(f.where)}` : ''}</li>`).join('');
  return `<div class="gb"><div class="gb__hd"><p>${esc(B.label || 'antes')}</p><span></span><p>${esc(A.label || 'después')}</p></div>${rows.join('')}</div>
    ${fus ? `<ul class="gb__fu"><li class="gb__fh">Fusión</li>${fus}</ul>` : ''}
    ${io.input || io.output || d.weights_mb ? `<p class="gb__io">${io.input ? `<span><span class="k">Entrada</span> <code>${precTags(esc(io.input))}</code></span>` : ''}${io.output ? `<span><span class="k">Salida</span> <code>${precTags(esc(io.output))}</code></span>` : ''}${d.weights_mb ? `<span><span class="k">Pesos</span> ≈&nbsp;${fmtN(d.weights_mb)}&nbsp;MB</span>` : ''}</p>` : ''}`;
}
// 5 · Un bloque de ResNet en PyTorch, en ONNX y en el engine: cada caja ocupa las filas de las operaciones que absorbe.
const opKey = (s) => norm(s).replace(/\s*\(.*\)\s*$/, '').trim();
function stageSpans(S) {
  const spans = [S[0].nodes.map((_, i) => [i, i + 1])];
  for (let k = 1; k < S.length; k++) {
    const prev = S[k - 1].nodes, pSp = spans[k - 1], vocab = new Set(S[k].nodes.flatMap((n) => String(n).split(' + ').map(opKey)));
    let p = 0; const cur = [];
    for (const node of S[k].nodes) {
      const parts = String(node).split(' + ');
      let a = null, b = null;
      for (const part of parts) {
        if (p >= prev.length || opKey(prev[p]) !== opKey(part)) return null;
        if (a === null) a = pSp[p][0];
        b = pSp[p][1]; p++;
        while (p < prev.length && !vocab.has(opKey(prev[p]))) { b = pSp[p][1]; p++; } // lo que desaparece queda adentro
      }
      cur.push([a, b]);
    }
    if (p !== prev.length) return null;
    spans.push(cur);
  }
  return spans;
}
function figStages(d) {
  const S = (d.stages || []).filter((s) => s && Array.isArray(s.nodes) && s.nodes.length);
  if (!S.length) { aviso('grafo: sin etapas'); return ''; }
  const sp = stageSpans(S);
  if (!sp) aviso('grafo: no pude alinear las operaciones entre etapas; las dibujo una debajo de la otra');
  const nr = S[0].nodes.length;
  const addRow = S[0].nodes.findIndex((n) => opKey(n) === 'add');
  const last = S.length - 1;
  const head = S.map((s, k) => `<p class="gs__h${k === last ? ' gs__h--gpu' : ''}" style="grid-column:${k + 2};grid-row:1">${esc(s.label)}</p><p class="gs__p" style="grid-column:${k + 2};grid-row:2">${precTags(esc(s.precision || ''))}</p>`).join('');
  const boxes = sp ? S.map((s, k) => s.nodes.map((n, i) => {
    const [a, b] = sp[k][i], parts = String(n).split(' + '), fused = parts.length > 1 || (k > 0 && b - a > 1);
    const cls = `gs__n${k === last ? ' gs__n--gpu' : ''}${fused ? ' gs__n--f' : ''}${b - a > 1 && parts.length === 1 && k > 0 ? ' gs__n--fold' : ''}`;
    return `<div class="${cls}" style="grid-column:${k + 2};grid-row:${a + 3} / ${b + 3}">${parts.map((x, j) => `<span>${j ? '+ ' : ''}${esc(x)}</span>`).join('')}</div>`;
  }).join('')).join('') : '';
  const skip = sp && addRow > 0 ? `<span class="gs__sk" style="grid-row:3 / ${addRow + 4}" aria-hidden="true"></span>` : '';
  const grid = sp ? `<div class="gs" style="--ns:${S.length};--nr:${nr}" role="img" aria-label="${esc(S.map((s) => `${s.label}: ${s.nodes.join(', ')}`).join('. '))}">${head}${skip}${boxes}</div>`
    : `<div class="gs gs--flat">${S.map((s) => `<div><p class="gs__h">${esc(s.label)}</p><ol>${s.nodes.map((n) => `<li>${esc(n)}</li>`).join('')}</ol></div>`).join('')}</div>`;
  const notes = S.map((s) => (s.note ? `<li><span class="k">${esc(s.label)}:</span> ${tx(s.note)}</li>` : '')).join('');
  return `<p class="gs__sum">${S.map((s, k) => `<span class="gs__sn${k === last ? ' gs__sn--gpu' : ''}">${s.nodes.length}</span>`).join('<span class="gs__sa" aria-hidden="true">→</span>')}<span class="gs__st">operaciones por bloque, de PyTorch al engine</span></p>
    ${grid}
    ${d.shortcut && addRow > 0 ? `<p class="gs__skl"><span class="gs__skw" aria-hidden="true"></span>El atajo: ${tx(d.shortcut)}</p>` : ''}
    ${notes ? `<ul class="fig__notes gs__notes">${notes}</ul>` : ''}
    ${d.io ? `<p class="fig__note">${precTags(tx(d.io))}</p>` : ''}
    ${d.inspect ? `<p class="gs__in"><span class="k">Míralo en tu engine:</span> ${cmdHtml(d.inspect)}</p>` : ''}
    ${portMatrix()}
    <p class="kleg"><span><i class="sw sw--n"></i>una operación</span><span><i class="sw sw--f"></i>junta varias: plegadas en el export o fusionadas en un kernel</span><span><i class="sw sw--gpu"></i>capa del engine, en la GPU</span></p>`;
}
const figGraph = (d) => (d.stages ? figStages(d) : figBeforeAfter(d));

// 6 · El model repository: el árbol de carpetas (con sus líneas) y lo que hace Triton al arrancar.
const ICON = {
  dir: '<svg class="rp__ic" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 3.2h4.4l1.5 1.6h7.1v8.4H1.5z"/></svg>',
  file: '<svg class="rp__ic" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 1.5h6l3 3v10h-9z"/><path class="rp__fold" d="M9.5 1.5v3h3"/></svg>',
  cfg: '<svg class="rp__ic" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 1.5h6l3 3v10h-9z"/><path class="rp__fold" d="M9.5 1.5v3h3M5.5 8h5M5.5 10.5h5M5.5 13h3"/></svg>',
};
function figRepo(d) {
  const segs = (p) => String(p).replace(/\/$/, '').split('/');
  // una carpeta que el árbol no lista pero que un archivo necesita (detector/1/ para detector/1/model.onnx) se dibuja igual
  const tr = [], seen = new Set();
  for (const t of d.tree || []) {
    const sg = segs(t.path);
    for (let k = 1; k < sg.length; k++) {
      const dir = sg.slice(0, k).join('/') + '/';
      if (!seen.has(dir)) { seen.add(dir); tr.push({ path: dir, kind: /^\d+$/.test(sg[k - 1]) ? 'versión' : 'modelo', example: t.example, implied: true }); }
    }
    seen.add(String(t.path));
    tr.push(t);
  }
  const depth = (p) => segs(p).length - 1;
  const last = tr.map((t, i) => { const dd = depth(t.path); for (let j = i + 1; j < tr.length; j++) { const dj = depth(tr[j].path); if (dj < dd) return true; if (dj === dd) return false; } return true; });
  const anc = (i, lv) => { let a = i - 1; while (a >= 0 && depth(tr[a].path) !== lv) a--; return a; };
  const KIND = (t) => {
    const k = norm(t.kind || '');
    if (/ignorad/.test(k)) return ['ign', 'dir'];
    if (/^modelo/.test(k)) return ['model', 'dir'];
    if (/^version/.test(k)) return ['ver', 'dir'];
    if (/^config/.test(k)) return ['cfg', 'cfg'];
    if (/^archivo/.test(k)) return [/\.plan$/.test(t.path) ? 'plan' : 'file', 'file'];
    aviso(`repository: tipo desconocido "${t.kind}" en ${t.path}`);
    return ['file', /\/$/.test(t.path) ? 'dir' : 'file'];
  };
  const rows = tr.map((t, i) => {
    const dd = depth(t.path), [cls, ic] = KIND(t);
    if (dd > 0) { const a = anc(i, dd - 1); if (a < 0 || !String(t.path).startsWith(String(tr[a].path).replace(/\/?$/, '/'))) aviso(`repository: ${t.path} no cuelga de la carpeta de arriba`); }
    let guides = '';
    for (let lv = 0; lv < dd; lv++) { const a = anc(i, lv); if (a >= 0 && !last[a]) guides += `<span class="rp__g" style="--l:${lv}"></span>`; }
    const name = segs(t.path).pop() + (/\/$/.test(t.path) ? '/' : '');
    const exTop = t.example && (dd === 0 || !(tr[anc(i, dd - 1)] || {}).example);
    const tag = cls === 'ign' ? '<span class="rp__tag rp__tag--ign">ignorada</span>' : cls === 'plan' ? '<span class="rp__tag rp__tag--plan">engine</span>' : exTop ? '<span class="rp__tag">ejemplo</span>' : '';
    return `<li class="rp__i rp--${cls}${t.example ? ' rp--ex' : ''}" style="--d:${dd}">${guides}<span class="rp__e${last[i] ? ' rp__e--last' : ''}"></span><div class="rp__c"><p class="rp__nm">${ICON[ic]}<code>${esc(name)}</code>${tag}</p>${t.note ? `<p class="rp__n">${tx(t.note)}</p>` : ''}</div></li>`;
  }).join('');
  const rm = String(d.root || '').match(/^(\S+)\s+\((.*)\)\s*$/);
  const root = `<p class="rp__root">${ICON.dir}<code>${esc(rm ? rm[1] : d.root)}</code>${rm ? `<span class="rp__rn">${tx(rm[2])}</span>` : ''}</p>`;
  const ld = d.load || [];
  const out = String(ld[ld.length - 1] || '').match(/^(READY)\s*,?\s*o\s+(UNAVAILABLE.*)$/i);
  const load = ld.length ? `<div class="rp__ld"><p class="rp__lh">Cómo lo carga Triton</p><ol class="rp__ls">${ld.map((s, i) => (i === ld.length - 1 && out ? `<li class="rp__lo"><span class="rp__ok"><b aria-hidden="true">✓</b> ${esc(out[1])}</span><span class="rp__or">o</span><span class="rp__no"><b aria-hidden="true">✗</b> ${esc(out[2])}</span></li>` : `<li>${tx(s)}</li>`)).join('')}</ol></div>` : '';
  return `<div class="rp">${root}<ul class="rp__t">${rows}</ul></div>${load}<p class="kleg"><span><i class="sw sw--gpu"></i>el engine: atado a la GPU</span><span><i class="sw sw--bad"></i>Triton la ignora</span><span><i class="sw sw--ex"></i>ejemplo</span></p>`;
}

// 7 · Dynamic batching: llegadas, la espera en la cola y el batch que sale junto a una instancia libre. A escala en ms.
function figBatching(d) {
  const [a0, a1] = d.axis || [0, 30], span = (a1 - a0) || 1;
  const X = (t) => r2(((t - a0) / span) * 100);
  const lanes = d.lanes || [];
  const nInst = Math.max(1, lanes.length - 2);
  const step = span <= 12 ? 1 : span <= 30 ? 2 : span <= 60 ? 5 : 10;
  const ticks = []; for (let t = Math.ceil(a0 / step) * step; t <= a1 + 1e-9; t += step) ticks.push(r2(t));
  const LB = 18; // banda del nombre de cada carril
  const sc = (s, si) => {
    const arr = [...(s.arrivals || [])].sort((a, b) => a - b), bs = [...(s.batches || [])].sort((a, b) => a.open - b.open);
    const mem = arr.map((t) => bs.findIndex((b) => t >= b.open - 1e-9 && t <= b.send + 1e-9));
    if (mem.includes(-1)) aviso(`batching: en "${s.label}" una llegada no cae en ningún batch`);
    bs.forEach((b, k) => {
      const n = mem.filter((m) => m === k).length;
      if (n !== b.size) aviso(`batching: en "${s.label}" el batch ${k + 1} dice size ${b.size} y le tocan ${n} llegadas`);
      if (d.window_ms && b.send - b.open > d.window_ms + 1e-6) aviso(`batching: en "${s.label}" el batch ${k + 1} espera más que la ventana`);
      if (!(b.end > b.send)) aviso(`batching: en "${s.label}" el batch ${k + 1} termina antes de salir`);
      if (b.instance < 1 || b.instance > nInst) aviso(`batching: en "${s.label}" el batch ${k + 1} va a una instancia que no existe`);
    });
    for (let k = 0; k < bs.length; k++) for (let j = k + 1; j < bs.length; j++) if (bs[k].instance === bs[j].instance && bs[j].send < bs[k].end - 1e-9) aviso(`batching: en "${s.label}" dos batches usan la instancia ${bs[k].instance} a la vez`);
    // llegadas que caerían encima en un celular (≈ 300 px para todo el eje): en filas
    const gap = (span * 12) / 300, rowsA = [];
    const rowOf = arr.map((t) => { let r = 0; while ((rowsA[r] || []).some((u) => Math.abs(u - t) < gap)) r++; (rowsA[r] = rowsA[r] || []).push(t); return r; });
    const maxM = Math.max(1, ...bs.map((_, k) => mem.filter((m) => m === k).length));
    const H = [10 + Math.max(1, rowsA.length) * 12, 12 + maxM * 7, ...Array(nInst).fill(28)];
    const tops = []; let y = 0;
    H.forEach((h) => { tops.push(y); y += LB + h; });
    let el = ticks.map((t) => `<span class="bt__gl" style="left:${X(t)}%"></span>`).join('');
    lanes.forEach((l, k) => { el += `${k ? `<span class="bt__sep" style="top:${tops[k]}px"></span>` : ''}<span class="bt__ln" style="top:${tops[k] + 2}px">${esc(l)}</span>`; });
    arr.forEach((t, i) => { el += `<span class="bt__dot" style="left:${X(t)}%;top:${tops[0] + LB + 3 + rowOf[i] * 12}px"></span>`; });
    const yq = tops[1] + LB;
    bs.forEach((b, k) => {
      el += `<span class="bt__win" style="left:${X(b.open)}%;width:${r2(X(b.send) - X(b.open))}%;top:${yq + 2}px;height:${H[1] - 4}px"></span>`;
      arr.filter((_, i) => mem[i] === k).forEach((t, j) => { el += `<span class="bt__wait" style="left:${X(t)}%;width:${r2(Math.max(0, X(b.send) - X(t)))}%;top:${yq + 8 + j * 7}px"></span>`; });
      const li = 1 + Math.max(1, Math.min(nInst, b.instance)), yi = tops[li] + LB;
      el += `<span class="bt__go" style="left:${X(b.send)}%;top:${yq + H[1] - 2}px;height:${Math.max(4, yi + 3 - (yq + H[1] - 2))}px"></span>`;
      const wpx = ((b.end - b.send) / span) * 300;
      el += `<span class="bt__ex" style="left:${X(b.send)}%;width:${r2(X(b.end) - X(b.send))}%;top:${yi + 3}px;height:22px">${b.size}${wpx >= 36 ? '&nbsp;req' : ''}</span>`;
    });
    const aria = `${s.label}. ` + bs.map((b, k) => `Batch ${k + 1}: ${b.size} request${b.size === 1 ? '' : 's'}, espera de ${b.open} a ${b.send} ms, corre en la instancia ${b.instance} hasta ${b.end} ms.`).join(' ');
    // la unidad va en la primera etiqueta; en el celular se ve una etiqueta de cada dos
    const axis = `<div class="bt__ax" aria-hidden="true">${ticks.map((t, i) => `<span class="${[i === 0 ? 'is-0' : i === ticks.length - 1 ? 'is-n' : '', i % 2 ? 'is-odd' : ''].filter(Boolean).join(' ')}" style="left:${X(t)}%">${fmtN(t)}${i === 0 ? `&nbsp;${esc(d.unit || 'ms')}` : ''}</span>`).join('')}</div>`;
    return `<div class="bt__sc"><p class="bt__h"><span class="bt__k">${si + 1}</span><span>${esc(s.label)}</span></p><div class="bt__tl" style="height:${y}px" role="img" aria-label="${esc(aria)}">${el}</div>${axis}${s.result ? `<p class="bt__res">${tx(s.result)}</p>` : ''}</div>`;
  };
  const rules = (d.rules || []).length ? `<div class="bt__rl"><p class="bt__rh">Cuándo sale un batch</p><ol>${d.rules.map((r) => `<li>${tx(r)}</li>`).join('')}</ol></div>` : '';
  return `${rules}${(d.scenarios || []).map(sc).join('')}<p class="kleg"><span><i class="sw sw--req"></i>llega un request</span><span><i class="sw sw--wait"></i>espera en la cola${d.window_ms ? ` (hasta ${esc(d.window_ms)}&nbsp;ms)` : ''}</span><span><i class="sw sw--gpu"></i>el batch corre en la GPU: cuántos requests van juntos</span><span>eje en ${esc(d.unit || 'ms')}, a escala</span></p>`;
}

// 8 · Clientes: quién llama a qué puerto y qué endpoint; la inferencia lleva los bytes, a escala.
function figProtocol(d) {
  const ports = d.ports || [], calls = d.calls || [];
  const http = (ports.find((p) => /REST|KServe/i.test(p.proto || '')) || ports[0] || {}).port;
  const portOf = (c) => { const m = String(c.path || '').match(/^:(\d+)/); return m ? +m[1] : http; };
  calls.forEach((c) => { if (!ports.some((p) => p.port === portOf(c))) aviso(`clientes: ${c.path} va a un puerto que no está en ports`); });
  const GROUP = (c) => (/\/health\/|\/ready$/.test(c.path) ? 'Salud' : /\/infer$/.test(c.path) ? 'Inferencia' : /metrics/.test(c.path) ? 'Métricas' : 'Metadata');
  const bytesOf = (s) => { const m = String(s || '').match(/([\d,]+)\s*bytes/); return m ? +m[1].replace(/,/g, '') : null; };
  const payload = (c) => {
    const up = bytesOf(c.c01), down = bytesOf(c.answer);
    if (!up || !down) return '';
    const mx = Math.max(up, down);
    return `<div class="pr__pay" role="img" aria-label="sube ${up} bytes, baja ${down} bytes"><p><span class="pr__pk">↑ sube</span><span class="pr__trk"><span class="pr__bar" style="width:${pct(up / mx)}"></span></span><span class="pr__pv">${fmtN(up)}&nbsp;B</span></p><p><span class="pr__pk">↓ baja</span><span class="pr__trk"><span class="pr__bar" style="width:${pct(down / mx)}"></span></span><span class="pr__pv">${fmtN(down)}&nbsp;B</span></p></div>`;
  };
  const row = (c) => `<li class="pr__c${GROUP(c) === 'Inferencia' ? ' pr__c--infer' : ''}"><p class="pr__who">${esc(c.who)}</p><p class="pr__rq"><span class="pr__m pr__m--${esc(String(c.method).toLowerCase())}">${esc(c.method)}</span><code>${ph(c.path)}</code></p><p class="pr__an"><span class="pr__ar" aria-hidden="true">←</span> ${tx(c.answer)}</p>${c.c01 ? `<p class="pr__c01"><span class="k">En el C01:</span> ${tx(c.c01)}</p>` : ''}${GROUP(c) === 'Inferencia' ? payload(c) : ''}</li>`;
  const card = (p) => {
    const cs = calls.filter((c) => portOf(c) === p.port);
    let g = null, list = '';
    for (const c of cs) { if (GROUP(c) !== g) { g = GROUP(c); list += `<li class="pr__gh">${esc(g)}</li>`; } list += row(c); }
    return `<section class="pr__port${p.port === http ? ' pr__port--main' : ''}"><p class="pr__ph"><span class="pr__pn">${esc(p.port)}</span><span>${tx(p.proto)}</span></p><p class="pr__pu">${tx(p.used_by)}</p>${list ? `<ul class="pr__calls">${list}</ul>` : ''}</section>`;
  };
  return `<p class="pr__ends"><span class="pr__end pr__cl">${tx(d.client)}</span><span class="pr__x" aria-hidden="true">⇄</span><span class="pr__end pr__sv">${tx(d.server)}</span></p><div class="pr__ports">${ports.map(card).join('')}</div>`;
}

// 9 · Rendimiento: throughput y latencia contra la carga ofrecida, en dos paneles con el mismo eje x. SVG con variante
// para el celular. Los números son los del contenido (ilustrativos).
const niceUp = (v) => { const p = 10 ** Math.floor(Math.log10(v)); for (const k of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (k * p >= v - 1e-9) return k * p; return 10 * p; };
function perfSvg(d, o) {
  const P = [...(d.points || [])].sort((a, b) => a.offered - b.offered), M = [...(d.marks || [])].sort((a, b) => a.x - b.x);
  const W = o.W, fs = o.fs, ml = o.ml, mr = o.mr, pw = W - ml - mr;
  const xMax = niceUp(Math.max(...P.map((p) => p.offered), ...M.map((m) => m.x)) * 1.03);
  const y2Max = niceUp(Math.max(...P.map((p) => p.p99_ms)) * 1.06);
  const X = (v) => ml + (v / xMax) * pw;
  const id = 'pf' + ++SVG_N;
  // etiquetas de las marcas: una por renglón, arriba; el texto empieza en su línea o termina en ella si no cabe
  const lh = fs + 6;
  let y = 6;
  const mk = M.map((m) => {
    y += lh;
    const x = X(m.x), w = textW(m.label, fs, { bold: true });
    let anchor = 'start', tx0 = x + 4;
    if (tx0 + w > W - 2) { anchor = 'end'; tx0 = x - 4; }
    if (anchor === 'end' && tx0 - w < 2) { anchor = 'start'; tx0 = Math.max(2, x - w / 2); }
    return { m, x, y, w, anchor, tx0 };
  });
  const p1t = y + 22, p1y = p1t + 9, h1 = o.h1, p2t = p1y + h1 + 32, p2y = p2t + 9, h2 = o.h2, H = p2y + h2 + 38;
  const Y1 = (v) => p1y + h1 - (v / xMax) * h1, Y2 = (v) => p2y + h2 - (v / y2Max) * h2;
  const xs = []; for (let v = 0; v <= xMax + 1e-9; v += xMax / o.nx) xs.push(v);
  const y1s = []; for (let v = 0; v <= xMax + 1e-9; v += xMax / o.ny1) y1s.push(v);
  const y2s = []; for (let v = 0; v <= y2Max + 1e-9; v += y2Max / o.ny2) y2s.push(v);
  // un rectángulo del color del papel detrás de cada texto: las líneas de las marcas pasan por detrás
  const ko = (x0, yb, w, f) => `<rect x="${r1(x0 - 3)}" y="${r1(yb - f)}" width="${r1(w + 6)}" height="${r1(f + 5)}" class="pf-ko"/>`;
  const title = (yb, t) => ko(ml, yb, textW(t, fs + 0.5, { bold: true }), fs + 0.5) + txt(ml, yb, t, 'pf-pt', 'start', fs + 0.5);
  let s = `<defs><pattern id="${id}-h" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2.6" height="6" class="pf-hatch"/></pattern></defs>`;
  // marcas: líneas que cruzan los dos paneles, y encima sus etiquetas (una por renglón)
  mk.forEach((k) => { s += `<path d="M${r1(k.x)},${r1(k.y + 3)} V${r1(p2y + h2)}" class="pf-mk"/>`; });
  mk.forEach((k) => { s += ko(k.anchor === 'end' ? k.tx0 - k.w : k.tx0, k.y, k.w, fs) + txt(k.tx0, k.y, k.m.label, 'pf-mt', k.anchor, fs); });
  // panel 1: throughput
  s += title(p1t, d.y_left || 'throughput');
  y1s.forEach((v) => { s += `<path d="M${ml},${r1(Y1(v))} H${ml + pw}" class="pf-g"/>` + txt(ml - 5, Y1(v) + fs * 0.35, fmtN(Math.round(v)), 'pf-tk', 'end', fs - 0.5); });
  // lo que se rechaza: entre "todo lo que llega" (y = x) y el throughput, desde el último punto donde salía todo
  let k0 = -1; P.forEach((p, i) => { if (p.throughput >= 0.985 * p.offered) k0 = i; });
  if (k0 >= 0 && k0 < P.length - 1) {
    const seg = P.slice(k0);
    const poly = [...seg.map((p) => [X(p.offered), Y1(p.offered)]), ...[...seg].reverse().map((p) => [X(p.offered), Y1(p.throughput)])];
    s += `<path d="M${poly.map(([a, b]) => `${r1(a)},${r1(b)}`).join(' L')} Z" fill="url(#${id}-h)" class="pf-rej"/>`;
  }
  s += `<path d="M${X(0)},${r1(Y1(0))} L${r1(X(xMax))},${r1(Y1(xMax))}" class="pf-diag"/>`;
  s += `<path d="M${P.map((p) => `${r1(X(p.offered))},${r1(Y1(p.throughput))}`).join(' L')}" class="pf-thr"/>` + P.map((p) => `<circle cx="${r1(X(p.offered))}" cy="${r1(Y1(p.throughput))}" r="3.2" class="pf-dthr"/>`).join('');
  s += `<path d="M${ml},${p1y} V${p1y + h1} H${ml + pw}" class="pf-ax"/>`;
  // la etiqueta "ilustrativo", arriba a la izquierda del panel (la diagonal pasa lejos de esa esquina)
  const tw = textW('ILUSTRATIVO', fs - 1.5, { bold: true }) + 12 + (fs - 1.5) * 1.1;
  s += `<rect x="${ml + 8}" y="${p1y + 6}" width="${r1(tw)}" height="${r1(fs + 5)}" rx="4" class="pf-tag"/>` + txt(ml + 14, p1y + 6 + fs + 0.5, 'ILUSTRATIVO', 'pf-tagt', 'start', fs - 1.5);
  // panel 2: latencia
  s += title(p2t, d.y_right || 'latencia');
  y2s.forEach((v) => { s += `<path d="M${ml},${r1(Y2(v))} H${ml + pw}" class="pf-g"/>` + txt(ml - 5, Y2(v) + fs * 0.35, fmtN(Math.round(v)), 'pf-tk', 'end', fs - 0.5); });
  s += `<path d="M${P.map((p) => `${r1(X(p.offered))},${r1(Y2(p.p50_ms))}`).join(' L')}" class="pf-p50"/>` + P.map((p) => `<circle cx="${r1(X(p.offered))}" cy="${r1(Y2(p.p50_ms))}" r="2.8" class="pf-d50"/>`).join('');
  s += `<path d="M${P.map((p) => `${r1(X(p.offered))},${r1(Y2(p.p99_ms))}`).join(' L')}" class="pf-p99"/>` + P.map((p) => `<circle cx="${r1(X(p.offered))}" cy="${r1(Y2(p.p99_ms))}" r="3.2" class="pf-d99"/>`).join('');
  const lp = P[P.length - 1];
  // p99 y p50 a la derecha del último punto (el margen derecho les deja lugar), separados si quedan muy cerca
  if (lp) { let a = Y2(lp.p99_ms) + fs * 0.35, b = Y2(lp.p50_ms) + fs * 0.35; if (b - a < fs + 1) { const m = (a + b) / 2; a = m - (fs + 1) / 2; b = m + (fs + 1) / 2; } s += txt(X(lp.offered) + 7, a, 'p99', 'pf-ll', 'start', fs) + txt(X(lp.offered) + 7, b, 'p50', 'pf-ll', 'start', fs); }
  s += `<path d="M${ml},${p2y} V${p2y + h2} H${ml + pw}" class="pf-ax"/>`;
  xs.forEach((v, i) => { s += txt(X(v), p2y + h2 + fs + 5, fmtN(Math.round(v)), 'pf-tk', i === 0 ? 'start' : i === xs.length - 1 ? 'end' : 'middle', fs - 0.5); s += `<path d="M${r1(X(v))},${p1y + h1} v4 M${r1(X(v))},${p2y + h2} v4" class="pf-ax"/>`; });
  { const xl = d.x_label || 'carga ofrecida', fit = textW(xl, fs - 0.5, { bold: true }) <= W - 4; s += fit ? txt(Math.min(W - 2, ml + pw + mr - 2), H - 6, xl, 'pf-xl', 'end', fs - 0.5) : txt(2, H - 6, xl, 'pf-xl', 'start', fs - 1.5); }
  const aria = `Rampa ilustrativa: ${P.map((p) => `a ${p.offered} ofrecidas, ${p.throughput} logradas, p50 ${p.p50_ms} ms y p99 ${p.p99_ms} ms`).join('; ')}.`;
  return `<svg class="chart pf__svg" viewBox="0 0 ${W} ${r1(H)}" role="img" aria-label="${esc(aria)}">${s}</svg>`;
}
function figPerf(d) {
  const ok = (d.points || []).length >= 2;
  if (!ok) { aviso('rendimiento: menos de dos puntos'); return ''; }
  const wide = perfSvg(d, { W: 760, fs: 12, ml: 54, mr: 40, h1: 190, h2: 150, nx: 6, ny1: 6, ny2: 3 });
  const narrow = perfSvg(d, { W: 330, fs: 11.5, ml: 40, mr: 30, h1: 150, h2: 118, nx: 3, ny1: 3, ny2: 3 });
  return `<div class="pf"><div class="pf__w">${wide}</div><div class="pf__n">${narrow}</div></div>
    <p class="kleg"><span><i class="sw sw--thr"></i>throughput logrado</span><span><i class="sw sw--diag"></i>si todo lo que llega saliera</span><span><i class="sw sw--rej"></i>se rechaza</span><span><i class="sw sw--p99"></i>p99</span><span><i class="sw sw--p50"></i>p50</span><span><i class="sw sw--mk"></i>referencias</span></p>
    ${d.source ? `<p class="pf__src"><span class="k">Fuente:</span> ${tx(d.source)}</p>` : ''}`;
}

// 10 · Pre y postprocesamiento: las mismas cinco etapas en cinco lugares; cada celda dice dónde corre, y al final, qué
// viaja por la red hasta Triton (los KB a escala).
function laneClass(l) { const s = String(l.label || l.id || ''); return /CPU/i.test(s) && /GPU/i.test(s) ? 'cpugpu' : /GPU/i.test(s) ? 'gpu' : 'cpu'; }
function figPrepost(d) {
  const steps = d.steps || [], lanes = d.lanes || [], opts = d.options || [];
  const L = Object.fromEntries(lanes.map((l) => [l.id, l]));
  const short = (l) => String(l.label).replace(/\s*\(.*\)\s*$/, '');
  const kb = (w) => { const s = String(w || ''); if (/^nada\b/i.test(s)) return [0, 0]; const m = s.match(/(\d[\d,.]*)\s*(?:–\s*(\d[\d,.]*))?\s*KB/); return m ? [+m[1].replace(/,/g, ''), +(m[2] || m[1]).replace(/,/g, '')] : null; };
  const kbs = opts.map((o) => kb(o.wire)), kMax = Math.max(1, ...kbs.filter(Boolean).map((k) => k[1]));
  opts.forEach((o) => { if ((o.where || []).length !== steps.length) aviso(`prepost: ${o.id} tiene ${(o.where || []).length} lugares para ${steps.length} etapas`); (o.where || []).forEach((w) => { if (!L[w]) aviso(`prepost: ${o.id} usa el carril ${w}, que no existe`); }); });
  const legend = `<ul class="pp__lg">${lanes.map((l) => `<li><i class="pp__sw pp--${laneClass(l)}"></i>${tx(l.label)}</li>`).join('')}</ul>`;
  const stepsList = `<ol class="pp__steps">${steps.map((s) => `<li>${tx(s)}</li>`).join('')}</ol>`;
  const head = `<div class="pp__hd" aria-hidden="true"><span class="pp__h0">Dónde corre cada etapa</span>${steps.map((s, i) => `<span class="pp__hs"><b>${i + 1}</b> ${tx(s)}</span>`).join('')}<span class="pp__hw">Qué viaja a Triton</span></div>`;
  const row = (o, i) => {
    const k = kbs[i];
    const bar = k ? `<span class="pp__trk" aria-hidden="true">${k[1] ? `<span class="pp__lo" style="width:${pct(k[0] / kMax)}"></span>${k[1] > k[0] ? `<span class="pp__hi" style="left:${pct(k[0] / kMax)};width:${pct((k[1] - k[0]) / kMax)}"></span>` : ''}` : ''}</span>` : '';
    return `<div class="pp__o${o.c01 ? ' pp__o--c01' : ''}">
      <p class="pp__lab"><span class="pp__ol">${esc(o.label)}</span><span class="pp__v${o.c01 ? ' pp__v--c01' : ''}">${tx(o.verdict)}</span></p>
      <div class="pp__cells" role="list" aria-label="${esc(o.label)}">${(o.where || []).map((w, j) => `<span class="pp__cell pp--${L[w] ? laneClass(L[w]) : 'cpu'}" role="listitem" aria-label="${esc(steps[j] || '')}: ${esc(L[w] ? L[w].label : w)}"><b class="pp__cn" aria-hidden="true">${j + 1}</b><span>${esc(L[w] ? short(L[w]) : w)}</span></span>`).join('')}</div>
      <p class="pp__wire"><span class="k pp__wk">Viaja a Triton:</span> <span class="pp__wt">${tx(o.wire)}</span>${bar}</p>
      <div class="pp__pc"><p><span class="pp__pro">A favor:</span> ${tx(o.pros)}</p><p><span class="pp__con">En contra:</span> ${tx(o.cons)}</p></div>
    </div>`;
  };
  return `${legend}${stepsList}<div class="pp">${head}${opts.map(row).join('')}</div><p class="kleg"><span><i class="sw sw--bytes"></i>KB que viajan por la red hasta Triton, a escala</span><span><i class="sw sw--c01"></i>la que eligió el C01</span></p>`;
}

// 4, 11, 12 · Cadenas de pasos. La paridad son tres pruebas (en CPU, en la GPU, de punta a punta) con la escala de
// |Δlogit|; la optimización es una escalera de lo barato a lo caro; el diagnóstico va de afuera hacia adentro.
// La escala de max|Δlogit| sale de la fórmula de la paridad (\text{FP32: } \approx 10^{-4} \qquad \text{FP16: }
// 10^{-2}\text{–}10^{-1} \qquad \text{bug: } \gtrsim 1): un punto, un rango o un "≳"; el tope, de --max-abs-diff.
function logScale() {
  const x = byId.paridad;
  if (!x) return '';
  const fx = (x.formulas || []).find((f) => /\\text\{FP32:/.test(f) && /bug/i.test(f)) || '';
  const pts = fx.split(/\\qquad/).map((seg) => {
    const m = seg.trim().match(/^\\text\{([^:}]+):\s*\}\s*(.*)$/);
    if (!m) return null;
    const nums = [...m[2].matchAll(/10\^\{(-?\d+)\}|(?<![\w{^.-])(\d+(?:\.\d+)?)(?![\w}])/g)].map((t) => (t[1] !== undefined ? 10 ** +t[1] : +t[2]));
    if (!nums.length) return null;
    const ge = /\\gtrsim|\\geq?(?![a-z])/.test(m[2]);
    return { label: m[1].trim(), lo: nums[0], hi: !ge && nums.length > 1 ? nums[1] : nums[0], ge, approx: /\\approx/.test(m[2]) };
  }).filter(Boolean);
  const th = (x.templates || []).map((t) => (String(t.code).match(/--max-abs-diff\s+(\d+(?:\.\d+)?)/) || [])[1]).find(Boolean);
  if (pts.length < 2 || !th) { aviso('paridad: no encontré la escala de |Δlogit| (fórmula FP32/FP16/bug) o el tope --max-abs-diff; la figura va sin la escala'); return ''; }
  const all = [...pts.flatMap((p) => [p.lo, p.hi]), +th];
  const lo = Math.min(-6, 2 * Math.floor((Math.log10(Math.min(...all)) - 1) / 2)), hi = Math.max(2, 2 * Math.ceil((Math.log10(Math.max(...all)) + 1) / 2));
  const F = (v) => (Math.log10(v) - lo) / (hi - lo), P = (v) => pct(F(v));
  const e10 = (v) => { const e = Math.log10(v); return v >= 1 ? fmtN(v) : Math.abs(e - Math.round(e)) < 1e-9 ? `1e${Math.round(e)}` : v.toExponential(0).replace('+', ''); };
  const val = (p) => (p.ge ? `≳ ${e10(p.lo)}` : p.hi > p.lo ? `${e10(p.lo)}–${e10(p.hi)}` : `${p.approx ? '≈ ' : ''}${e10(p.lo)}`);
  const cls = (l) => (/FP32/.test(l) ? 'pt--32' : /FP16/.test(l) ? 'pt--16' : /INT8/.test(l) ? 'pt--8' : 'lg__bug');
  // cada etiqueta en la fila más baja donde no pisa a otra, medida en el eje más angosto (≈ 260 px en un celular)
  const AX = 260, rows = [];
  const chips = pts.map((p) => ({ p, c: (F(p.lo) + F(p.hi)) / 2, w: (Math.max(textW(p.label, 11.5, { bold: true }), textW(val(p), 11, { mono: true })) + 16) / AX })).sort((a, b) => a.c - b.c);
  chips.forEach((k) => { let r = 0; while ((rows[r] || []).some((o) => Math.abs(o.c - k.c) < (o.w + k.w) / 2 + 0.02)) r++; (rows[r] = rows[r] || []).push(k); k.row = r; });
  const H = 26 + rows.length * 38;
  const ticks = []; for (let e = lo; e <= hi; e += 2) ticks.push(e);
  return `<div class="lg"><p class="lg__h">La escala de max|Δlogit| (logarítmica): qué diferencia es normal</p>
    <div class="lg__ax" style="height:${H}px" role="img" aria-label="${esc(pts.map((p) => `${p.label} ${val(p)}`).join(', '))}; tope del gate ${th}">
      <span class="lg__stop" style="left:${P(+th)}"></span>
      ${ticks.map((e) => `<span class="lg__t" style="left:${P(10 ** e)}"></span>`).join('')}
      ${pts.filter((p) => p.hi > p.lo).map((p) => `<span class="lg__rg ${cls(p.label)}" style="left:${P(p.lo)};width:${pct(F(p.hi) - F(p.lo))}"></span>`).join('')}
      ${chips.map((k) => `<span class="lg__p ${cls(k.p.label)}" style="left:${pct(k.c)};bottom:${10 + k.row * 38}px;--lh:${9 + k.row * 38}px"><b>${esc(k.p.label)}</b><span>${esc(val(k.p))}</span></span>`).join('')}
      <span class="lg__th" style="left:${P(+th)}">tope del gate: ${esc(th)}</span>
    </div>
    <div class="lg__tk" aria-hidden="true">${ticks.map((e, i) => `<span class="${i === 0 ? 'is-0' : i === ticks.length - 1 ? 'is-n' : ''}" style="left:${P(10 ** e)}">${e === 0 ? '1' : e > 0 ? fmtN(10 ** e) : `1e${e}`}</span>`).join('')}</div>
    <p class="lg__n">A la izquierda del tope el gate pasa; a la derecha, frena.</p></div>`;
}
const WHERE = (note) => (/\bEn CPU\b|\ben cualquier máquina\b/i.test(note) ? 'cpu' : /\bEn la T4\b|\bGPU\b/.test(note) ? 'gpu' : 'e2e');
function figChain(d, sec) {
  const st = d.steps || [];
  const strip = (l) => String(l).replace(/^\d+\s*·\s*/, '');
  if (sec === 'paridad') {
    const li = st.map((s, i) => {
      const w = WHERE(s.note || ''), [body, catches] = String(s.note || '').split(/\s*Atrapa:\s*/);
      return `<li class="ch__s ch--${w}"><span class="ch__no" aria-hidden="true">${i + 1}</span><p class="ch__l">${esc(strip(s.label))}<span class="ch__wh">${w === 'cpu' ? 'CPU' : w === 'gpu' ? 'GPU' : 'servicio'}</span></p>${codeChips(s.cmd)}<p class="ch__n">${tx(body)}</p>${catches ? `<p class="ch__at"><span class="k">Atrapa:</span> ${tx(catches)}</p>` : ''}</li>`;
    }).join('');
    return `${logScale()}<ol class="ch">${li}</ol><p class="kleg"><span><i class="sw sw--cpu"></i>en CPU</span><span><i class="sw sw--gpu"></i>en la GPU</span><span><i class="sw sw--e2e"></i>por el servicio entero</span><span><i class="sw sw--bad"></i>lo que atrapa</span></p>`;
  }
  if (sec === 'optimizar') {
    const aside = st.filter((s) => /^Aparte\b/i.test(s.label || '')), main = st.filter((s) => !/^Aparte\b/i.test(s.label || ''));
    const li = main.map((s, i) => `<li class="ch__s"><span class="ch__no" aria-hidden="true">${i + 1}</span><p class="ch__l">${esc(s.label)}</p>${codeChips(s.cmd)}<p class="ch__n">${tx(s.note)}</p></li>`).join('');
    const as = aside.map((s) => `<div class="ch__as"><p class="ch__l">${esc(s.label)}</p>${codeChips(s.cmd)}<p class="ch__n">${tx(s.note)}</p></div>`).join('');
    return `<div class="ch__lad"><div class="ch__rail" aria-hidden="true"><span>más barato y seguro</span><span>más caro y arriesgado</span></div><ol class="ch ch--lad">${li}</ol></div>${as}`;
  }
  if (sec === 'diagnostico') {
    const track = `<p class="ch__tr">${st.map((s, i) => `<span class="ch__tp"><b>${i + 1}</b>${esc(s.label)}</span>`).join('<span class="ch__ta" aria-hidden="true">→</span>')}</p>`;
    const li = st.map((s, i) => `<li class="ch__s ch--probe" style="--k:${st.length > 1 ? r2(i / (st.length - 1)) : 0}"><span class="ch__no" aria-hidden="true">${i + 1}</span><p class="ch__l">${esc(s.label)}</p>${codeChips(s.cmd)}<p class="ch__n">${tx(s.note)}</p></li>`).join('');
    return `${track}<ol class="ch">${li}</ol>`;
  }
  return `<ol class="ch">${st.map((s, i) => `<li class="ch__s"><span class="ch__no" aria-hidden="true">${i + 1}</span><p class="ch__l">${esc(s.label)}</p>${codeChips(s.cmd)}${s.note ? `<p class="ch__n">${tx(s.note)}</p>` : ''}</li>`).join('')}</ol>`;
}

// ================================================================ secciones
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
// La hoja hermana de las cuentas (VRAM, GPUs, presupuesto de latencia): el brief pide enlazarla en vez de repetirla.
const SHEET_LINKS = { bolsillo: [['estimaciones', 'Formulario de estimaciones']], medir: [['estimaciones', 'Formulario de estimaciones']] };
const sheetChip = ([id, t]) => `<a class="chip chip--sheet" href="https://cheat-sheets-ml.vercel.app/${id}/">Hoja · ${esc(t)}</a>`;

const ORDER = ['bolsillo', 'cadena', 'serving', 'pytorch', 'onnx', 'paridad', 'tensorrt', 'repositorio', 'batching', 'clientes', 'medir', 'prepost', 'optimizar', 'diagnostico', 'errores'];
const EXPECT = [0, null, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
ORDER.forEach((id, i) => { if (!byId[id]) throw new Error('falta la sección ' + id); if (byId[id].num !== EXPECT[i]) throw new Error(`num inesperado en ${id}: ${byId[id].num}`); });
ALL.forEach((x) => { if (!ORDER.includes(x.id)) aviso(`sección de más (no la muestro): ${x.id}`); });
const SECLAB = (id) => { const x = byId[id]; return `${x.num === null ? 'La cadena' : 'Sección ' + x.num} · ${x.title}`; };
const NAVL = { bolsillo: 'Bolsillo', cadena: 'La cadena', serving: '1 · Servir', pytorch: '2 · PyTorch', onnx: '3 · ONNX', paridad: '4 · Paridad', tensorrt: '5 · TensorRT', repositorio: '6 · Repository', batching: '7 · Batching', clientes: '8 · Clientes', medir: '9 · Medir', prepost: '10 · Pre y post', optimizar: '11 · Optimizar', diagnostico: '12 · Diagnóstico', errores: '13 · Errores' };

// Errores: cada mensaje va a su sección según su topic (la tabla del BRIEF).
const TOPIC_SECTION = { pytorch: 'pytorch', export: 'onnx', paridad: 'paridad', tensorrt: 'tensorrt', engine: 'tensorrt', config: 'repositorio', repositorio: 'repositorio', batching: 'batching', cliente: 'clientes', rendimiento: 'medir', prepost: 'prepost', cuda: 'diagnostico', otro: 'diagnostico' };
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
  return (x.tables || []).map((t) => `<div class="card tbl"><h3>${esc(t.caption)}</h3>${dataTable(t.head, t.rows, { cls: tableCls(t.head) })}${noteP(t.note)}</div>`).join('');
}
const FIG = { precision: figPrecision, pipeline: figPipeline, graph: figGraph, repo: figRepo, batching: figBatching, protocol: figProtocol, perf: figPerf, prepost: figPrepost, chain: figChain };
function figureHtml(x) {
  const f = x.figure, D = f.data || {};
  let inner;
  if (f.kind === 'table') {
    if (!D.head) throw new Error(`figura table sin head en ${x.id}`);
    inner = dataTable(D.head, D.rows, { cls: tableCls(D.head) }) + noteP(D.note);
  } else if (FIG[f.kind]) {
    inner = FIG[f.kind](D, x.id) + notesList(D.notes) + noteP(D.note);
  } else throw new Error('figura desconocida: ' + f.kind);
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
    <p class="small errs__none" id="err-none" hidden>Ningún mensaje tiene ese texto. Prueba con una palabra del mensaje (por ejemplo <code>TensorRT</code> o <code>shape</code>).</p>
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
// Nota de un laboratorio probado. Si la nota dice dónde y con qué se corrió ("Ejecutado con Python 3.9.6 y 3.14.3 en
// macOS (Apple Silicon): …"), eso pasa a la línea estándar y queda el resto. Sin nota, la línea no inventa versiones.
function execLine(l, id) {
  const t = String(l.verified_note || '').trim();
  if (!t) return { ver: 'Probado de verdad en un Mac, sin GPU.', note: '' };
  const m = t.match(/^(?:Ejecutado|Corrido|Probado)\s+con\s+(.+?)\s+en\s+(macOS(?:\s*\([^)]*\))?)\s*[:.]\s*([\s\S]*)$/i);
  if (!m) { aviso(`${id}: no reconocí el principio de la nota del laboratorio; la dejé entera`); return { ver: 'Probado de verdad en un Mac, sin GPU.', note: t }; }
  return { ver: `Probado de verdad en ${m[2]}, sin GPU, con ${m[1]}.`, note: cap(m[3].trim()) };
}
function labHtml(x) {
  const l = x.lab;
  if (!l) {
    if (!x.lab_omitted) return '';
    return `<p class="nolab"><span class="k">Sin laboratorio:</span> ${/GPU NVIDIA/i.test(x.lab_omitted) ? 'necesita una GPU NVIDIA.' : esc(String(x.lab_omitted).split(/(?<=\.)\s/)[0])}</p>`;
  }
  const steps = l.steps.map((st, i) => `<li>${codeBlock(st.cmd, 'bash', `Paso ${i + 1}`)}<p class="expect"><span class="k">Qué deberías ver:</span> ${tx(st.expect)}</p></li>`).join('');
  let ver, note = String(l.verified_note || '');
  if (l.verified === 'executed') ({ ver, note } = execLine(l, x.id));
  else {
    if (l.verified !== 'docs') aviso(`${x.id}: verified raro en el laboratorio: ${l.verified}`);
    const partial = /\bse corrieron\b|\bse ejecutaron\b/i.test(note);
    if (partial) aviso(`${x.id}: el laboratorio dice verified "docs", pero su nota dice que una parte se corrió: la línea estándar queda en "Verificado contra la documentación."`);
    ver = partial ? 'Verificado contra la documentación.' : 'Verificado contra la documentación; no ejecutado aquí.';
    note = note.replace(/^(?:No ejecutado aquí|No se corrió aquí)(?:\s*\([^)]*\))?(?::[^.]*)?[.:]\s*/i, '');
  }
  const mac = /\bMac\b|sin GPU|No necesitas GPU|Ni GPU|ni GPU/i.test(l.needs || '') || l.verified === 'executed';
  return `<details class="lab"><summary><span class="lab__t">Laboratorio${mac ? ' en tu Mac, sin GPU' : ''} (opcional)</span><span class="lab__n">${l.steps.length} pasos</span></summary><div class="lab__body">
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

// ================================================================ revisor de config.pbtxt
// Un parser de protobuf en texto (el subconjunto de los config.pbtxt de Triton) y las 18 reglas de content-w2.json
// (revisor[].check), portados de w2/pbtxt.mjs y w2/rules.mjs con la misma semántica: los mismos tokens, errores, valores,
// defaults y casos borde. Lo único que se agrega: el parser anota en qué línea está cada campo y cada regla dice qué
// campo mira (at) o cuál falta (miss), para dar la línea del hallazgo. Son funciones normales: la página las lleva con
// toString().
function pbParse(src) {
  'use strict';
  src = String(src);
  function PErr(msg, line, col) { var e = new Error(line + ':' + col + ': ' + msg); e.pb = true; e.msg = msg; e.line = line; e.col = col; return e; }
  var toks = [], i = 0, line = 1, col = 1;
  function adv(n) { if (n === undefined) n = 1; for (var k = 0; k < n; k++) { if (src[i] === '\n') { line++; col = 1; } else col++; i++; } }
  function at(re) { re.lastIndex = i; return re.exec(src); }
  var NUM = /[-+]?(0[xX][0-9a-fA-F]+|(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?[fF]?)/y, NEGID = /-[A-Za-z_][A-Za-z0-9_]*/y, ID = /[A-Za-z_][A-Za-z0-9_.]*/y;
  var ESC = { n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', "'": "'", a: '\x07', b: '\b', f: '\f', v: '\v', '?': '?' };
  while (i < src.length) {
    var c = src[i];
    if (c === '#') { while (i < src.length && src[i] !== '\n') adv(); continue; }
    if (/\s/.test(c)) { adv(); continue; }
    var tl = line, tc = col;
    if ('{}[]<>:,;'.indexOf(c) >= 0) { toks.push({ t: 'p', v: c, line: tl, col: tc }); adv(); continue; }
    if (c === '"' || c === "'") {
      var q = c, s = '';
      adv();
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\n') throw PErr('string sin cerrar', tl, tc);
        if (src[i] === '\\') {
          adv();
          var e = src[i];
          if (e in ESC) { s += ESC[e]; adv(); }
          else if (e === 'x') { adv(); var h = ''; while (h.length < 2 && /[0-9a-fA-F]/.test(src[i])) { h += src[i]; adv(); } s += String.fromCharCode(parseInt(h, 16)); }
          else if (/[0-7]/.test(e)) { var o = ''; while (o.length < 3 && /[0-7]/.test(src[i])) { o += src[i]; adv(); } s += String.fromCharCode(parseInt(o, 8)); }
          else { s += e; adv(); }
        } else { s += src[i]; adv(); }
      }
      if (i >= src.length) throw PErr('string sin cerrar', tl, tc);
      adv();
      var prev = toks[toks.length - 1];
      if (prev && prev.t === 's') prev.v += s; // strings seguidas se concatenan
      else toks.push({ t: 's', v: s, line: tl, col: tc });
      continue;
    }
    var num = at(NUM);
    if (num && ((c !== '-' && c !== '+') || /[\d.]/.test(src[i + 1] || ''))) {
      var raw = num[0];
      adv(raw.length);
      raw = raw.replace(/[fF]$/, '');
      toks.push({ t: 'n', v: /^[-+]?0[xX]/.test(raw) ? parseInt(raw, 16) : Number(raw), line: tl, col: tc });
      continue;
    }
    if (c === '-' && /[A-Za-z]/.test(src[i + 1] || '')) { var ni = at(NEGID); adv(ni[0].length); toks.push({ t: 'i', v: ni[0], line: tl, col: tc }); continue; } // -inf / -nan
    var id = at(ID);
    if (id) { adv(id[0].length); toks.push({ t: 'i', v: id[0], line: tl, col: tc }); continue; }
    throw PErr("carácter inesperado '" + c + "'", line, col);
  }
  function scalarOf(tok) {
    if (tok.t === 's' || tok.t === 'n') return tok.v;
    if (['true', 'True', 't'].indexOf(tok.v) >= 0) return true;
    if (['false', 'False', 'f'].indexOf(tok.v) >= 0) return false;
    return tok.v; // nombre de un enum (o inf / nan)
  }
  var p = 0, POS = new WeakMap();
  function peek() { return toks[p]; }
  function next() { return toks[p++]; }
  function isP(tok, v) { return !!tok && tok.t === 'p' && tok.v === v; }
  function fail(msg, tok) { var t = tok || toks[toks.length - 1] || { line: 1, col: 1 }; throw PErr(msg, t.line, t.col); }
  function add(obj, key, val, isList) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) { obj[key] = val; return; }
    var cur = Array.isArray(obj[key]) ? obj[key] : [obj[key]];
    obj[key] = cur.concat(isList ? val : [val]);
  }
  // líneas de cada valor de un campo, en el mismo orden que list(obj[key]): k = la línea del nombre, v = la del valor
  function rec(obj, key, k, v) { var m = POS.get(obj); if (!m) { m = Object.create(null); POS.set(obj, m); } (m[key] || (m[key] = [])).push({ k: k, v: v }); }
  function parseMessage(close, openTok) {
    var obj = {};
    for (;;) {
      var tok = peek();
      if (!tok) { if (close) fail("falta '" + close + "'", openTok); return obj; }
      if (close && isP(tok, close)) { next(); return obj; }
      if (isP(tok, ',') || isP(tok, ';')) { next(); continue; }
      if (tok.t !== 'i') fail("se esperaba un nombre de campo y llegó '" + tok.v + "'", tok);
      var key = next().v, colon = false;
      if (isP(peek(), ':')) { next(); colon = true; }
      var v = peek();
      if (!v) fail("falta el valor de '" + key + "'", tok);
      if (isP(v, '{') || isP(v, '<')) {
        next();
        add(obj, key, parseMessage(v.v === '{' ? '}' : '>', v), false);
        rec(obj, key, tok.line, v.line);
      } else if (isP(v, '[')) {
        next();
        var arr = [], ls = [];
        for (;;) {
          var el = peek();
          if (!el) fail("falta ']'", v);
          if (isP(el, ']')) { next(); break; }
          if (isP(el, ',')) { next(); continue; }
          if (isP(el, '{') || isP(el, '<')) { next(); arr.push(parseMessage(el.v === '{' ? '}' : '>', el)); ls.push(el.line); }
          else if (el.t === 's' || el.t === 'n' || el.t === 'i') { next(); arr.push(scalarOf(el)); ls.push(el.line); }
          else fail("valor inesperado '" + el.v + "' en la lista de '" + key + "'", el);
        }
        add(obj, key, arr, true);
        ls.forEach(function (l) { rec(obj, key, tok.line, l); });
      } else {
        if (!colon) fail("falta ':' después de '" + key + "'", v);
        if (v.t === 'p') fail("valor inesperado '" + v.v + "' para '" + key + "'", v);
        next();
        add(obj, key, scalarOf(v), false);
        rec(obj, key, tok.line, v.line);
      }
    }
  }
  return { cfg: parseMessage(null, null), pos: POS };
}
function pbReview(c, ids) {
  'use strict';
  function list(x) { return x === undefined || x === null ? [] : Array.isArray(x) ? x : [x]; }
  function has(o, k) { return o !== null && typeof o === 'object' && !Array.isArray(o) && Object.prototype.hasOwnProperty.call(o, k); }
  function obj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
  function num(v) { return typeof v === 'number' && Number.isFinite(v) ? v : 0; } // falta o no es número = 0
  function truthy(v) { return v === true || (typeof v === 'number' && v !== 0) || (typeof v === 'string' && ['true', 'True', 't', '1'].indexOf(v) >= 0); }
  var VALID_TYPES = ['TYPE_BOOL', 'TYPE_UINT8', 'TYPE_UINT16', 'TYPE_UINT32', 'TYPE_UINT64', 'TYPE_INT8', 'TYPE_INT16', 'TYPE_INT32', 'TYPE_INT64', 'TYPE_FP16', 'TYPE_FP32', 'TYPE_FP64', 'TYPE_STRING', 'TYPE_BF16'];
  var STRING_ALIASES = ['BYTES', 'TYPE_BYTES', 'STRING', 'STR', 'TYPE_STR', 'TEXT', 'TYPE_TEXT'];
  function isStringAlias(v) { return typeof v === 'string' && v !== 'TYPE_STRING' && STRING_ALIASES.indexOf(v.toUpperCase()) >= 0; }
  function validType(v) { return typeof v === 'number' ? Number.isInteger(v) && v >= 1 && v <= 14 : VALID_TYPES.indexOf(v) >= 0; }
  var PLATFORM_BACKEND = { tensorrt_plan: 'tensorrt', onnxruntime_onnx: 'onnxruntime', pytorch_libtorch: 'pytorch', libtorch: 'pytorch', torch_aoti: 'pytorch', tensorflow_graphdef: 'tensorflow', tensorflow_savedmodel: 'tensorflow' };
  var PAIR_CHECKED = ['tensorrt', 'onnxruntime', 'pytorch', 'tensorflow'];
  var EXT_BACKEND = { '.plan': 'tensorrt', '.onnx': 'onnxruntime', '.pt': 'pytorch', '.pt2': 'pytorch', '.py': 'python', '.graphdef': 'tensorflow', '.savedmodel': 'tensorflow', '.xml': 'openvino' };
  function backendOf(x) {
    if (typeof x.backend === 'string' && x.backend) return x.backend;
    if (x.platform === 'ensemble') return 'ensemble';
    return PLATFORM_BACKEND[x.platform] || '';
  }
  function isTRT(x) { return backendOf(x) === 'tensorrt'; }
  function tensors(x) { return list(x.input).map(function (t, k) { return ['input', obj(t), k]; }).concat(list(x.output).map(function (t, k) { return ['output', obj(t), k]; })); }
  var out = [];
  function add(id, detail, at, miss) { out.push({ id: id, detail: detail, at: at || null, miss: miss || null }); }
  var RULES = {
    'dims-incluye-batch': function () {
      var mbs = num(c.max_batch_size);
      if (mbs <= 0) return;
      function lead(d) { return d.length > 0 && (d[0] === -1 || d[0] === mbs); }
      function img(d) { return d.length === 4 && lead(d) && ([1, 3].indexOf(d[1]) >= 0 || [1, 3].indexOf(d[3]) >= 0); }
      var anyInput = false;
      list(c.input).map(obj).forEach(function (t, k) { var d = list(t.dims); if (img(d)) { anyInput = true; add('dims-incluye-batch', 'input ' + t.name + ': dims [' + d + ']', ['input', k, 'dims']); } });
      list(c.output).map(obj).forEach(function (t, k) { var d = list(t.dims); if (img(d) || (anyInput && d.length >= 2 && lead(d))) add('dims-incluye-batch', 'output ' + t.name + ': dims [' + d + ']', ['output', k, 'dims']); });
    },
    'batching-sin-max-batch': function () {
      if (has(c, 'dynamic_batching') && num(c.max_batch_size) <= 0) add('batching-sin-max-batch', 'max_batch_size ' + num(c.max_batch_size), has(c, 'max_batch_size') ? ['max_batch_size'] : ['dynamic_batching']);
    },
    'preferido-fuera-de-rango': function () {
      var db = obj(c.dynamic_batching), mbs = num(c.max_batch_size);
      list(db.preferred_batch_size).forEach(function (q, j) { if (num(q) <= 0 || num(q) > mbs) add('preferido-fuera-de-rango', 'preferred ' + q + ' (max_batch_size ' + mbs + ')', ['dynamic_batching', 'preferred_batch_size', j]); });
    },
    'ventana-larga': function () {
      var d = num(obj(c.dynamic_batching).max_queue_delay_microseconds);
      if (has(c, 'dynamic_batching') && d > 10000) add('ventana-larga', d + ' µs', ['dynamic_batching', 'max_queue_delay_microseconds']);
    },
    'plataforma-vs-archivo': function () {
      var pb = PLATFORM_BACKEND[c.platform];
      if (typeof c.backend === 'string' && c.backend && pb && PAIR_CHECKED.indexOf(c.backend) >= 0 && pb !== c.backend) add('plataforma-vs-archivo', 'platform ' + c.platform + ' con backend ' + c.backend, ['backend']);
      var f = c.default_model_filename;
      if (typeof f === 'string' && f.indexOf('.') >= 0) {
        var ext = f.slice(f.lastIndexOf('.')).toLowerCase(), be = backendOf(c);
        if (EXT_BACKEND[ext] && be && be !== 'ensemble' && EXT_BACKEND[ext] !== be) add('plataforma-vs-archivo', f + ' es de ' + EXT_BACKEND[ext] + ', el config usa ' + be, ['default_model_filename']);
      }
    },
    'tensorrt-en-cpu': function () {
      var gs = list(c.instance_group).map(obj), k = -1;
      gs.forEach(function (g, j) { if (k < 0 && g.kind === 'KIND_CPU') k = j; });
      if (isTRT(c) && k >= 0) add('tensorrt-en-cpu', 'instance_group con KIND_CPU', ['instance_group', k, 'kind']);
    },
    'muchas-instancias-gpu': function () {
      var groups = list(c.instance_group).map(obj).filter(function (g) { return !has(g, 'kind') || g.kind === 'KIND_GPU' || g.kind === 'KIND_AUTO'; });
      function cnt(g) { return num(g.count) >= 1 ? num(g.count) : 1; }
      var allGpus = groups.filter(function (g) { return list(g.gpus).length === 0; }).reduce(function (s, g) { return s + cnt(g); }, 0);
      var gids = [];
      groups.forEach(function (g) { list(g.gpus).map(num).forEach(function (x) { if (gids.indexOf(x) < 0) gids.push(x); }); });
      var per = gids.map(function (gid) { return allGpus + groups.filter(function (g) { return list(g.gpus).map(num).indexOf(gid) >= 0; }).reduce(function (s, g) { return s + cnt(g); }, 0); });
      var max = Math.max.apply(null, [allGpus].concat(per, [0]));
      if (max > 2) add('muchas-instancias-gpu', max + ' instancias en una GPU', ['instance_group']);
    },
    'sin-instance-group': function () {
      if (c.platform !== 'ensemble' && list(c.instance_group).length === 0) add('sin-instance-group', '', null, 'instance_group');
    },
    'tipo-invalido': function () {
      tensors(c).forEach(function (e) { var t = e[1]; if (has(t, 'data_type') && !isStringAlias(t.data_type) && !validType(t.data_type)) add('tipo-invalido', e[0] + ' ' + t.name + ': ' + t.data_type, [e[0], e[2], 'data_type']); });
    },
    'texto-sin-type-string': function () {
      tensors(c).forEach(function (e) { var t = e[1]; if (isStringAlias(t.data_type)) add('texto-sin-type-string', e[0] + ' ' + t.name + ': ' + t.data_type, [e[0], e[2], 'data_type']); });
      list(c.model_warmup).map(obj).forEach(function (s, si) {
        list(s.inputs).map(obj).forEach(function (e, ei) { var v = obj(e.value); if (isStringAlias(v.data_type)) add('texto-sin-type-string', 'model_warmup ' + s.name + ' input ' + e.key + ': ' + v.data_type, ['model_warmup', si, 'inputs', ei, 'value', 'data_type']); });
      });
    },
    'sin-name': function () {
      if (!(typeof c.name === 'string' && c.name.length > 0)) add('sin-name', '', has(c, 'name') ? ['name'] : null, has(c, 'name') ? null : 'name');
    },
    'varias-versiones': function () {
      var vp = obj(c.version_policy);
      if (has(vp, 'all')) { add('varias-versiones', 'all', ['version_policy', 'all']); return; }
      if (has(vp, 'latest') && num(obj(vp.latest).num_versions) >= 2) add('varias-versiones', 'latest ' + obj(vp.latest).num_versions, ['version_policy', 'latest', 'num_versions']);
    },
    'tensorrt-sin-warmup': function () {
      if (isTRT(c) && list(c.model_warmup).length === 0) add('tensorrt-sin-warmup', '', null, 'model_warmup');
    },
    'warmup-no-coincide': function () {
      var ID = 'warmup-no-coincide', mbs = num(c.max_batch_size), inputs = list(c.input).map(obj), byName = {};
      inputs.forEach(function (t) { byName[t.name] = t; });
      list(c.model_warmup).map(obj).forEach(function (s, si) {
        var tag = ('model_warmup ' + (s.name || '')).trim(), b = num(s.batch_size), atB = has(s, 'batch_size') ? ['model_warmup', si, 'batch_size'] : ['model_warmup', si];
        if (b === 0) add(ID, tag + ': batch_size falta o es 0', atB);
        else if (mbs > 0 && b > mbs) add(ID, tag + ': batch_size ' + b + ' > max_batch_size ' + mbs, atB);
        else if (mbs === 0 && b > 1) add(ID, tag + ': batch_size ' + b + ' con max_batch_size 0', atB);
        if (inputs.length === 0) return; // nada contra qué comparar (config autocompletado)
        var seen = new Set();
        list(s.inputs).map(obj).forEach(function (e, ei) {
          var v = obj(e.value), inp = byName[e.key], atE = ['model_warmup', si, 'inputs', ei];
          if (!inp) { add(ID, tag + ': entrada ' + e.key + ' no existe en input', atE.concat(['key'])); return; }
          seen.add(e.key);
          if (validType(v.data_type) && validType(inp.data_type) && v.data_type !== inp.data_type) add(ID, tag + ': ' + e.key + ' ' + v.data_type + ' ≠ ' + inp.data_type, atE.concat(['value', 'data_type']));
          var wd = list(v.dims).map(num), idd = list(inp.dims).map(num);
          if (wd.some(function (x) { return x < 0; })) add(ID, tag + ': ' + e.key + ' dims [' + wd + '] con -1', atE.concat(['value', 'dims']));
          else if (idd.length > 0 && (wd.length !== idd.length || idd.some(function (d, k) { return d !== -1 && d !== wd[k]; }))) add(ID, tag + ': ' + e.key + ' dims [' + wd + '] ≠ [' + idd + ']', atE.concat(['value', 'dims']));
          if (!has(v, 'zero_data') && !has(v, 'random_data') && !has(v, 'input_data_file')) add(ID, tag + ': ' + e.key + ' sin zero_data, random_data ni input_data_file', atE.concat(['value']));
        });
        inputs.forEach(function (inp) { if (!seen.has(inp.name) && !truthy(inp.optional)) add(ID, tag + ': falta la entrada ' + inp.name, ['model_warmup', si]); });
      });
    },
    'cuda-graphs': function () {
      var cu = obj(obj(c.optimization).cuda);
      if (truthy(cu.graphs)) add('cuda-graphs', 'backend ' + (backendOf(c) || '?'), ['optimization', 'cuda', 'graphs']);
    },
    'rechazo-sin-timeout': function () {
      var db = obj(c.dynamic_batching), pols = [];
      if (has(db, 'default_queue_policy')) pols.push(['default_queue_policy', obj(db.default_queue_policy), ['dynamic_batching', 'default_queue_policy']]);
      list(db.priority_queue_policy).map(obj).forEach(function (e, k) { pols.push(['priority_queue_policy ' + e.key, obj(e.value), ['dynamic_batching', 'priority_queue_policy', k]]); });
      pols.forEach(function (pp) { var q = pp[1]; if (num(q.default_timeout_microseconds) === 0 && num(q.max_queue_size) === 0 && !truthy(q.allow_timeout_override)) add('rechazo-sin-timeout', pp[0], pp[2]); });
    },
    'prioridades-invalidas': function () {
      var db = obj(c.dynamic_batching), P = num(db.priority_levels);
      if (P <= 0) return;
      var d = num(db.default_priority_level);
      if (d < 1 || d > P) add('prioridades-invalidas', 'default_priority_level ' + d + ' fuera de [1, ' + P + ']', has(db, 'default_priority_level') ? ['dynamic_batching', 'default_priority_level'] : ['dynamic_batching', 'priority_levels']);
      if (truthy(db.preserve_ordering) && P > 1) add('prioridades-invalidas', 'preserve_ordering con varios niveles', ['dynamic_batching', 'preserve_ordering']);
      list(db.priority_queue_policy).map(obj).forEach(function (e, k) { var kk = num(e.key); if (kk < 1 || kk > P) add('prioridades-invalidas', 'priority_queue_policy ' + e.key + ' fuera de [1, ' + P + ']', ['dynamic_batching', 'priority_queue_policy', k, 'key']); });
    },
    'batch-sin-batcher': function () {
      if (num(c.max_batch_size) > 0 && !has(c, 'dynamic_batching') && !has(c, 'sequence_batching') && !has(c, 'ensemble_scheduling') && c.platform !== 'ensemble') add('batch-sin-batcher', 'max_batch_size ' + num(c.max_batch_size), ['max_batch_size']);
    }
  };
  (ids || Object.keys(RULES)).forEach(function (id) { if (RULES[id]) RULES[id](); });
  return out;
}
// La línea de un hallazgo: sigue el camino de campos (at) por las líneas que anotó el parser; si un tramo falta, la
// última línea que encontró.
function pbLine(r, at) {
  'use strict';
  if (!r || !at || !at.length) return null;
  function list(x) { return x === undefined || x === null ? [] : Array.isArray(x) ? x : [x]; }
  var cur = r.cfg, line = null;
  for (var i = 0; i < at.length; i++) {
    var key = at[i];
    if (typeof key === 'number') continue;
    var m = cur !== null && typeof cur === 'object' ? r.pos.get(cur) : null, ent = m ? m[key] : null;
    if (!ent || !ent.length) return line;
    if (typeof at[i + 1] === 'number') { var j = at[i + 1]; line = (ent[j] || ent[ent.length - 1]).v; cur = list(cur[key])[j]; i++; }
    else { line = ent[0].k; var v = cur[key]; cur = Array.isArray(v) ? v[0] : v; }
  }
  return line;
}
const REVISOR_SRC = `${pbParse.toString()}\n${pbReview.toString()}\n${pbLine.toString()}`;
const RULE_IDS = [...pbReview.toString().matchAll(/^ {4}'([a-z0-9-]+)': function/gm)].map((m) => m[1]);
{
  const ids = W2.revisor.map((r) => r.id);
  ids.filter((id) => !RULE_IDS.includes(id)).forEach((id) => aviso(`revisor: la regla ${id} del contenido no tiene implementación; el revisor la salta`));
  RULE_IDS.filter((id) => !ids.includes(id)).forEach((id) => aviso(`revisor: la regla ${id} está implementada pero el contenido ya no la trae`));
  W2.revisor.forEach((r) => { if (!['error', 'warn', 'info'].includes(r.severity)) aviso(`revisor: severidad rara en ${r.id}: ${r.severity}`); });
}

// El config del C01 con errores típicos: cada regla que dispara, la dispara por un error distinto.
const BAD_EXAMPLE = `# EJEMPLO con problemas a propósito: es para probar el revisor, no lo copies
name: "classifier"
platform: "tensorrt_plan"
max_batch_size: 32
version_policy: { latest: { num_versions: 3 } }

input [
  {
    name: "input"
    data_type: FP32
    dims: [ -1, 3, 224, 224 ]
  }
]
output [
  {
    name: "logits"
    data_type: TYPE_FP32
    dims: [ -1, 500 ]
  }
]

dynamic_batching {
  preferred_batch_size: [ 16, 64 ]
  max_queue_delay_microseconds: 50000
  default_queue_policy { timeout_action: REJECT }
}

instance_group [ { count: 4, kind: KIND_GPU } ]
`;
const C01_TEXT = readFileSync(C01_CONFIG, 'utf8');
const SAMPLES = {
  bad: { text: BAD_EXAMPLE, label: 'EJEMPLO con problemas a propósito: bórralo y pega tu config.pbtxt', cls: '' },
  c01: { text: C01_TEXT.endsWith('\n') ? C01_TEXT : C01_TEXT + '\n', label: 'C01 · triton/model_repository/classifier/config.pbtxt (el archivo real)', cls: 'ok' },
};
// Revisión en el build: el config real del C01 no da hallazgos, el ejemplo malo dispara varias reglas y cada ejemplo
// del contenido hace lo que dice.
const REVIEW_IDS = W2.revisor.map((r) => r.id);
const runRev = (text) => { const r = pbParse(text); return pbReview(r.cfg, REVIEW_IDS); };
const REV_CHECK = (() => {
  const c01 = runRev(SAMPLES.c01.text), bad = runRev(BAD_EXAMPLE);
  if (c01.length) aviso(`revisor: el config.pbtxt del C01 da ${c01.length} hallazgos: ${c01.map((f) => f.id).join(', ')}`);
  const ex = { fired: 0, quiet: 0, bad: [] };
  for (const r of W2.revisor) {
    let b = [], g = [];
    try { b = runRev(r.example_bad); } catch (e) { ex.bad.push(`${r.id}: example_bad no parsea (${e.message})`); }
    try { g = runRev(r.example_good); } catch (e) { ex.bad.push(`${r.id}: example_good no parsea (${e.message})`); }
    if (b.some((f) => f.id === r.id)) ex.fired++; else ex.bad.push(`${r.id}: example_bad no la dispara`);
    if (!g.length) ex.quiet++; else ex.bad.push(`${r.id}: example_good dispara ${g.map((f) => f.id).join(', ')}`);
  }
  ex.bad.forEach((m) => aviso('revisor: ' + m));
  return { c01: c01.length, bad: bad.length, badIds: [...new Set(bad.map((f) => f.id))], ex };
})();

// ================================================================ herramientas
function toolsHtml() {
  const D = W3.diagnosticador;
  D.forEach((g) => { if (g.causes.length < 2 || g.causes.length > 4) aviso(`diagnosticador: "${g.symptom}" tiene ${g.causes.length} causas (2–4 es lo esperado)`); });
  const panels = D.map((g) => `<div class="dg-panel" data-dg="${esc(g.id)}" hidden>
      <p class="dg-sym">${esc(g.symptom)}</p>
      <div class="dg-first"><p class="tag">Corre primero</p><p>${cmdHtml(g.first)}</p></div>
      <ol class="dg-causes">${g.causes.map((c) => `<li><p class="dg-cause">${tx(c.cause)}</p><p class="dg-row"><span class="k">Compruébalo:</span> ${cmdHtml(c.check)}</p><p class="dg-row"><span class="k">Arreglo:</span> ${tx(c.fix)}</p></li>`).join('')}</ol>
    </div>`).join('');
  return `
<section class="sec tools" id="herramientas">
  <header class="sec__head"><span class="sec__n">⚙</span><div><h2>Herramientas</h2><p class="sec__q">Del síntoma al primer comando, y una revisión rápida de tu config.pbtxt antes de construir la imagen.</p></div></header>
  <div class="card tool" id="diagnosticador">
    <h3>Diagnosticador</h3>
    <p class="small">Elige lo que ves. Te dice qué correr primero y las causas típicas, cada una con cómo comprobarla y cómo arreglarla.</p>
    <div class="dg-chips" role="group" aria-label="Síntomas">${D.map((g) => `<button class="dg-chip" type="button" aria-pressed="false" data-dg="${esc(g.id)}">${esc(g.symptom)}</button>`).join('')}</div>
    <label class="dg-pick"><span class="tag">Síntoma</span><select id="dg-select"><option value="">Elige un síntoma…</option>${D.map((g) => `<option value="${esc(g.id)}">${esc(g.symptom)}</option>`).join('')}</select></label>
    <p class="small dg-empty" id="dg-empty">Elige un síntoma para ver las causas.</p>
    <div class="dg-panels">${panels}</div>
  </div>
  <div class="card tool" id="revisor">
    <h3>Revisor de config.pbtxt</h3>
    <p class="small">Pega el <code>config.pbtxt</code> de un modelo de Triton. Revisa ${W2.revisor.length} reglas típicas en tu navegador: el contrato de tensores (dims con el batch, tipos), el batching y la cola, las instancias, las versiones y el warmup. Cada hallazgo dice el campo y la línea. No reemplaza la validación de Triton, que corre al cargar el modelo.</p>
    <label class="rv-label" for="rv-text" id="rv-label">${esc(SAMPLES.bad.label)}</label>
    <textarea id="rv-text" rows="16" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off">${esc(BAD_EXAMPLE)}</textarea>
    <div class="rv-btns"><button class="btn primary" id="rv-run" type="button">Revisar</button><button class="btn" id="rv-bad" type="button">Ejemplo con problemas</button><button class="btn" id="rv-c01" type="button">C01 · classifier/config.pbtxt</button><button class="btn" id="rv-clear" type="button">Vaciar</button></div>
    <div class="rv-out" id="rv-out" aria-live="polite"></div>
    <p class="small rv-note">Lo lee un parser de protobuf en texto escrito para esta página: no baja nada y funciona sin conexión.</p>
  </div>
</section>`;
}

// ================================================================ CSS
const CSS = `
/* El diseño de las hojas de Docker, Kubernetes y Git: papel cuadriculado para la sintaxis, tinta azul, resaltador ámbar.
   Colores de las figuras (uno por idea): azul = CPU, verde azulado = la GPU y su trabajo, ámbar = espera y latencia,
   violeta = precisión (más oscuro = más bytes), rojo = falla, se rechaza o no carga, gris punteado = se ignora o ejemplo. */
:root {
  --bg: #f4f6f9; --paper: #ffffff; --ink: #18212d; --muted: #5a6575; --rule: #d6dde6; --grid: rgba(31, 95, 174, 0.075);
  --accent: #1f5fae; --accent-soft: rgba(31, 95, 174, 0.14); --accent2: #0f7a6e; --accent2-soft: rgba(15, 122, 110, 0.32);
  --hi: #d99a12; --hi-soft: #fff1cc; --warn: #b5482c; --warn-soft: #fbe8e2; --free: #e7ecf2; --onbar: #ffffff;
  --code-bg: #f6f8fb; --syn-kw: #1f5fae; --syn-str: #7a4fb8; --syn-com: #5a6575; --ok-soft: rgba(15, 122, 110, 0.13); --hi-ink: #8a5a00; --var-bg: rgba(31, 95, 174, 0.09); --pu: #7a4fb8; --pu-soft: rgba(122, 79, 184, 0.11); --on-hi: #18212d;
  --cpu: #1f5fae; --cpu-soft: rgba(31, 95, 174, 0.12); --gpu: #0f7a6e; --gpu-soft: rgba(15, 122, 110, 0.13);
  --fp32: #5b3a99; --fp16: #b597e6; --int8: #e3d6f7; --on32: #ffffff; --on16: #18212d; --on8: #18212d;
  --f-display: "Archivo", "Helvetica Neue", Arial, sans-serif; --f-body: "Source Serif 4", Georgia, "Times New Roman", serif;
  --f-mono: "JetBrains Mono", ui-monospace, Menlo, monospace; --f-math: "STIX Two Math", "Cambria Math", "Latin Modern Math", math, serif;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #0e131a; --paper: #151c26; --ink: #e5ecf4; --muted: #9aa7b7; --rule: #2a3544; --grid: rgba(125, 175, 240, 0.085);
  --accent: #7db1ff; --accent-soft: rgba(125, 177, 255, 0.18); --accent2: #4fcfbf; --accent2-soft: rgba(79, 207, 191, 0.32);
  --hi: #f2c14e; --hi-soft: #3a2e10; --warn: #ff8b6e; --warn-soft: #3b1f18; --free: #1d2632; --onbar: #0e131a;
  --code-bg: #10161f; --syn-kw: #7db1ff; --syn-str: #c7b0f5; --syn-com: #9aa7b7; --ok-soft: rgba(79, 207, 191, 0.14); --hi-ink: #f2c14e; --var-bg: rgba(125, 177, 255, 0.13); --pu: #c7b0f5; --pu-soft: rgba(199, 176, 245, 0.13); --on-hi: #0e131a;
  --cpu: #7db1ff; --cpu-soft: rgba(125, 177, 255, 0.16); --gpu: #4fcfbf; --gpu-soft: rgba(79, 207, 191, 0.15);
  --fp32: #c7b0f5; --fp16: #8f73c9; --int8: #4b3b70; --on32: #0e131a; --on16: #0e131a; --on8: #e5ecf4; color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #0e131a; --paper: #151c26; --ink: #e5ecf4; --muted: #9aa7b7; --rule: #2a3544; --grid: rgba(125, 175, 240, 0.085);
  --accent: #7db1ff; --accent-soft: rgba(125, 177, 255, 0.18); --accent2: #4fcfbf; --accent2-soft: rgba(79, 207, 191, 0.32);
  --hi: #f2c14e; --hi-soft: #3a2e10; --warn: #ff8b6e; --warn-soft: #3b1f18; --free: #1d2632; --onbar: #0e131a;
  --code-bg: #10161f; --syn-kw: #7db1ff; --syn-str: #c7b0f5; --syn-com: #9aa7b7; --ok-soft: rgba(79, 207, 191, 0.14); --hi-ink: #f2c14e; --var-bg: rgba(125, 177, 255, 0.13); --pu: #c7b0f5; --pu-soft: rgba(199, 176, 245, 0.13); --on-hi: #0e131a;
  --cpu: #7db1ff; --cpu-soft: rgba(125, 177, 255, 0.16); --gpu: #4fcfbf; --gpu-soft: rgba(79, 207, 191, 0.15);
  --fp32: #c7b0f5; --fp16: #8f73c9; --int8: #4b3b70; --on32: #0e131a; --on16: #0e131a; --on8: #e5ecf4; color-scheme: dark; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
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
.dot { width: 12px; height: 12px; border-radius: 3px; display: inline-block; flex: none; }
.dot + .dot { margin-left: -3px; }
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
svg .t { fill: var(--muted); font: 12.5px var(--f-display); }
.tblw { margin-top: 12px; }
.dt { width: 100%; border-collapse: collapse; font-size: 14.5px; line-height: 1.45; }
.dt td, .dt th.rh { border-bottom: 1px solid var(--rule); padding: 7px 8px 7px 6px; vertical-align: top; overflow-wrap: anywhere; text-align: left; }
.dt th.rh { font: 600 14px/1.45 var(--f-display); letter-spacing: 0; text-transform: none; color: var(--ink); overflow-wrap: break-word; }
.dt .mono, .dt th.rh.mono { font: 600 13px/1.5 var(--f-mono); overflow-wrap: anywhere; }
.dt td.cmdc .cmdw { display: inline-flex; }
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
.code { margin-top: 10px; background: var(--code-bg); border: 1px solid var(--rule); border-radius: 10px; min-width: 0; }
.code__bar { display: flex; align-items: center; gap: 10px; padding: 6px 8px 6px 12px; border-bottom: 1px solid var(--rule); font: 600 12px/1.3 var(--f-display); color: var(--muted); }
.code__lang { text-transform: uppercase; letter-spacing: .08em; flex: none; }
.code__src { flex: 1; min-width: 0; font-weight: 500; overflow-wrap: anywhere; }
.code__bar .cp { margin-left: auto; }
.code pre { margin: 0; padding: 12px 14px; overflow-x: auto; font: 13px/1.55 var(--f-mono); color: var(--ink); tab-size: 4; }
.code pre code { font: inherit; background: none; padding: 0; overflow-wrap: normal; }
.tk-k { color: var(--syn-kw); font-weight: 700; } .tk-s { color: var(--syn-str); } .tk-c { color: var(--syn-com); font-style: italic; } .tk-p { color: var(--muted); user-select: none; } .tk-e { font-weight: 700; }
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
  /* en el celular, cada comando en su renglón: el " · " entre dos comandos quedaba solo en una línea */
  .dg-row .sep, .dg-first .sep, .err__f .sep, .quiz__ans .sep, p.cc .sep { display: none; }
  .dg-row .cmdw, .dg-first .cmdw, .err__f .cmdw, .quiz__ans .cmdw, p.cc .cmdw { display: flex; width: fit-content; margin: 4px 0 2px; }
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
#rv-text { display: block; width: 100%; margin-top: 6px; min-height: 280px; font: 13px/1.55 var(--f-mono); color: var(--ink); background: var(--code-bg); border: 1px solid var(--rule); border-radius: 10px; padding: 10px 12px; resize: vertical; white-space: pre; overflow: auto; }
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
.rv-ln { font: 700 12.5px/1.2 var(--f-display); color: var(--accent); background: var(--paper); border: 1px solid var(--rule); border-radius: 999px; padding: 2px 8px; cursor: pointer; }
.rv-ln:hover, .rv-ln:focus-visible { border-color: var(--accent); outline: none; }
.sev { flex: none; font: 700 11px/1 var(--f-display); letter-spacing: .08em; text-transform: uppercase; border-radius: 999px; padding: 4px 8px; }
.sev.error { background: var(--warn); color: var(--onbar); } .sev.warn { background: var(--hi-soft); color: var(--hi-ink); border: 1px solid var(--hi); } .sev.info { background: var(--accent-soft); color: var(--accent); }
.rv-err { border: 1px solid var(--warn); background: var(--warn-soft); border-radius: 10px; padding: 10px 14px; }
.rv-err p { margin: 4px 0 0; }
.rv-err__t { font: 700 16px/1.3 var(--f-display); color: var(--warn); margin: 0 !important; }
pre.rv-err__snip { margin: 8px 0 0; padding: 8px 10px; border-radius: 8px; background: var(--paper); border: 1px solid var(--rule); font: 12.5px/1.5 var(--f-mono); overflow-x: auto; white-space: pre; }
.rv-note { margin: 10px 0 0; }
footer { margin-top: 30px; color: var(--muted); font-size: 14px; border-top: 1px solid var(--rule); padding-top: 14px; }
/* ---------- piezas comunes de las figuras */
.kleg { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 10px 0 0; font: 500 13px/1.4 var(--f-display); color: var(--muted); }
.kleg span { display: inline-flex; align-items: center; gap: 6px; }
.sw { display: inline-block; flex: none; width: 16px; height: 12px; border-radius: 3px; font-style: normal; }
.sw--cpu { background: var(--cpu); } .sw--gpu { background: var(--gpu); } .sw--e2e { background: var(--ink); } .sw--bad { background: var(--warn-soft); border: 1.5px solid var(--warn); }
.sw--pr { background: linear-gradient(90deg, var(--fp32) 0 33%, var(--fp16) 33% 66%, var(--int8) 66%); }
.sw--ex { border: 1.5px dashed var(--muted); }
.sw--req { width: 11px; height: 11px; border-radius: 50%; background: var(--ink); }
.sw--wait { height: 4px; background: var(--hi); border-radius: 2px; }
.sw--n { border: 1.5px solid var(--muted); background: var(--paper); }
.sw--f { border: 2px solid var(--ink); background: var(--free); }
.sw--thr { height: 3px; background: var(--gpu); } .sw--diag { height: 0; border-top: 2px dashed var(--muted); border-radius: 0; }
.sw--rej { background: repeating-linear-gradient(45deg, var(--warn) 0 2px, transparent 2px 5px); opacity: .7; }
.sw--p99 { height: 3px; background: var(--hi); } .sw--p50 { height: 0; border-top: 2.5px dashed var(--hi); border-radius: 0; }
.sw--mk { width: 0; height: 14px; border-left: 1.5px dashed var(--muted); border-radius: 0; }
.sw--bytes { height: 8px; background: var(--ink); opacity: .75; } .sw--c01 { border: 2.5px solid var(--ink); background: var(--paper); }
.pt { display: inline-block; font: 700 12px/1.25 var(--f-mono); border-radius: 5px; padding: 1px 6px; vertical-align: baseline; }
.pt--32 { background: var(--fp32); color: var(--on32); } .pt--16 { background: var(--fp16); color: var(--on16); } .pt--8 { background: var(--int8); color: var(--on8); }
code .pt { font-size: .92em; padding: 0 4px; }
/* ---------- 0 · precisión y VRAM */
.pc__m { margin: 0 0 10px; font: 500 14px/1.4 var(--f-display); color: var(--muted); } .pc__m b { color: var(--ink); }
.pc__hd, .pc__r { display: grid; grid-template-columns: 82px 132px minmax(0, 1.25fr) minmax(0, 1fr); gap: 4px 16px; align-items: center; }
.pc__hd { font: 700 11px/1.3 var(--f-display); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); padding-bottom: 6px; border-bottom: 1px solid var(--rule); }
.pc__r { padding: 10px 0; border-bottom: 1px solid var(--rule); }
.pc__r p { margin: 0; min-width: 0; }
.pc__dt .pt { font-size: 14.5px; padding: 3px 9px; }
.pc__by { display: flex; align-items: center; gap: 8px; }
.pc__sq { display: inline-flex; gap: 3px; }
.pc__sq i { width: 15px; height: 15px; border-radius: 3px; display: block; }
.pc__bn { font: 700 13px var(--f-mono); color: var(--muted); }
.pc__mb { display: grid; grid-template-columns: minmax(0, 1fr) 74px; align-items: center; gap: 8px; }
.pc__trk { display: block; height: 18px; background: var(--free); border-radius: 4px; overflow: hidden; }
.pc__bar { display: block; height: 100%; }
.pc__v { font: 700 13.5px var(--f-mono); text-align: right; }
.pc__ro { font-size: 14.5px; line-height: 1.4; }
.pc__t4 { display: block; color: var(--muted); font: 500 12.5px/1.4 var(--f-display); margin-top: 2px; }
@media (max-width: 760px) {
  .pc__hd { display: none; }
  .pc__r { grid-template-columns: auto minmax(0, 1fr); grid-template-areas: "dt by" "mb mb" "ro ro"; gap: 6px 12px; }
  .pc__dt { grid-area: dt; } .pc__by { grid-area: by; } .pc__mb { grid-area: mb; } .pc__ro { grid-area: ro; }
}
.vr { margin-top: 18px; border-top: 1px dashed var(--rule); padding-top: 14px; }
.vr p { margin: 0; }
.vr__h { font: 700 15px/1.35 var(--f-display); }
.vr__g { color: var(--gpu); }
.vr__vis { font-weight: 500; color: var(--muted); font-size: 13.5px; }
.vr__bar { position: relative; height: 30px; margin-top: 10px; border-radius: 6px; background: var(--paper); box-shadow: inset 0 0 0 1.5px var(--gpu); overflow: hidden; }
.vr__used { position: absolute; left: 0; top: 0; bottom: 0; background: var(--gpu); }
.vr__may { position: absolute; top: 0; bottom: 0; background: repeating-linear-gradient(135deg, var(--gpu) 0 3px, transparent 3px 7px); opacity: .55; }
.vr__w { position: absolute; left: 0; top: 0; bottom: 0; min-width: 3px; }
.vr__ax { position: relative; height: 18px; margin-top: 3px; font: 600 11.5px/18px var(--f-mono); color: var(--muted); }
.vr__ax span { position: absolute; top: 0; transform: translateX(-50%); white-space: nowrap; }
.vr__ax span.is-0 { transform: none; } .vr__ax span.is-n { transform: translateX(-100%); }
ul.vr__lg { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px 16px; font: 500 13px/1.4 var(--f-display); color: var(--muted); }
ul.vr__lg li { display: inline-flex; align-items: center; gap: 6px; }
.vr__sw { width: 16px; height: 12px; border-radius: 3px; display: inline-block; flex: none; }
.vr__sw + .vr__sw { margin-left: -4px; }
.vr .fig__note { margin-top: 12px; }
.vr__sw--used { background: var(--gpu); } .vr__sw--may { background: repeating-linear-gradient(135deg, var(--gpu) 0 2px, transparent 2px 5px); box-shadow: inset 0 0 0 1px var(--gpu); } .vr__sw--free { box-shadow: inset 0 0 0 1.5px var(--gpu); }
.vr__ph { margin-top: 14px !important; font: 700 12px/1.3 var(--f-display); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
ul.vr__parts { list-style: none; margin: 6px 0 0; padding: 0; display: grid; gap: 7px; }
ul.vr__parts li { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: 3px 14px; align-items: center; }
.vr__pl { font-size: 14px; line-height: 1.35; }
.vr__pb { display: grid; grid-template-columns: minmax(0, 1fr) 100px; gap: 8px; align-items: center; }
.vr__trk { position: relative; display: block; height: 12px; background: var(--free); border-radius: 3px; overflow: hidden; }
.vr__lo { position: absolute; left: 0; top: 0; bottom: 0; background: var(--gpu); }
.vr__hi { position: absolute; top: 0; bottom: 0; background: repeating-linear-gradient(135deg, var(--gpu) 0 3px, transparent 3px 6px); opacity: .6; }
.vr__pv { font: 600 12px var(--f-mono); text-align: right; }
@media (max-width: 640px) { ul.vr__parts li { grid-template-columns: minmax(0, 1fr); } }
/* ---------- ↳ · la cadena */
ol.pi { list-style: none; margin: 0; padding: 0; display: grid; }
.pi__st { --c: var(--cpu); position: relative; display: grid; grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr); gap: 6px 24px; padding: 0 0 20px 44px; min-width: 0; }
.pi--gpu { --c: var(--gpu); }
.pi__st::before { content: ""; position: absolute; left: 14px; top: 32px; bottom: 4px; width: 3px; background: var(--c); opacity: .4; border-radius: 2px; }
.pi__no { position: absolute; left: 0; top: 0; width: 31px; height: 31px; border-radius: 50%; background: var(--c); color: var(--onbar); display: grid; place-items: center; font: 800 14px/1 var(--f-display); }
.pi__st p { margin: 0; }
.pi__a, .pi__b { min-width: 0; }
.pi__l { font: 800 17.5px/1.3 var(--f-display); }
.pi__art { margin-top: 5px !important; display: inline-block; max-width: 100%; font: 600 13px/1.5 var(--f-mono); background: var(--code-bg); border: 1px solid var(--rule); border-left: 3px solid var(--c); border-radius: 6px; padding: 3px 8px; }
.pi__w { margin-top: 5px !important; font: 600 12.5px/1.4 var(--f-display); color: var(--c); }
.pi__b p.cc { margin-top: 2px; }
.pi__ck { margin-top: 6px !important; display: flex; gap: 6px; font-size: 14.5px; line-height: 1.45; }
.pi__cm { flex: none; font: 800 15px/1.4 var(--f-display); color: var(--c); }
.pi__split { margin: 2px 0 20px; padding: 7px 12px; border-radius: 8px; border: 2px dashed var(--gpu); background: var(--gpu-soft); color: var(--ink); font: 800 13px/1.35 var(--f-display); letter-spacing: .03em; }
.pi__sl::before { content: "▼ "; color: var(--gpu); }
@media (max-width: 860px) { .pi__st { grid-template-columns: minmax(0, 1fr); } }
.lk { margin-top: 8px !important; display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; font: 700 12.5px/1.3 var(--f-display); border: 1.5px solid var(--ink); border-radius: 8px; padding: 4px 8px; background: var(--paper); }
.lk__i { width: 15px; height: 15px; flex: none; fill: var(--ink); stroke: var(--ink); stroke-width: 1.7; }
.lk__g, .lk__t { border-radius: 4px; padding: 1px 6px; font-family: var(--f-mono); font-size: 12px; }
.lk__g { color: var(--onbar); background: var(--gpu); } .lk__t { color: var(--paper); background: var(--ink); }
.lk__p { color: var(--muted); font-weight: 800; }
/* ---------- 3 · el grafo antes y después */
.gb { display: grid; }
.gb__hd, .gb__row { display: grid; grid-template-columns: minmax(0, 1fr) 26px minmax(0, 1fr); gap: 4px 10px; align-items: center; }
.gb__hd p { margin: 0 0 4px; font: 800 12.5px/1.3 var(--f-display); letter-spacing: .05em; text-transform: uppercase; color: var(--muted); }
.gb__row { padding: 7px 0; border-top: 1px solid var(--rule); }
.gb__op { min-width: 0; }
.gb__op p { margin: 0; }
.gb__on { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; }
.gb__on code { font: 700 13px/1.4 var(--f-mono); background: none; padding: 0; }
.gb__n { font: 800 13px var(--f-mono); color: var(--muted); }
.gb__trk { display: block; height: 7px; margin-top: 4px; background: var(--free); border-radius: 3px; overflow: hidden; }
.gb__bar { display: block; height: 100%; background: var(--fp32); }
.gb__nt { font-size: 13px; line-height: 1.35; color: var(--muted); margin-top: 3px !important; }
.gb__ar { text-align: center; font: 800 18px/1 var(--f-display); color: var(--muted); }
.gb__row--fold .gb__on code, .gb__row--fold .gb__n { color: var(--muted); }
.gb__row--fold .gb__bar { background: var(--muted); opacity: .45; }
.gb__fold p { margin: 0; font: 600 13.5px/1.35 var(--f-display); color: var(--muted); font-style: italic; }
.gb__fold code { font-style: normal; }
ul.gb__fu { list-style: none; margin: 10px 0 0; padding: 8px 10px; border: 2px solid var(--ink); border-radius: 10px; font-size: 14.5px; line-height: 1.45; }
.gb__fh { font: 800 11.5px/1.3 var(--f-display); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
p.gb__io { display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 10px 0 0; font-size: 14px; }
p.gb__io > span { display: inline-flex; flex-wrap: wrap; align-items: baseline; gap: 6px; min-width: 0; }
/* ---------- 5 · el bloque en PyTorch, ONNX y el engine */
.gs__sum { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin: 0 0 12px; }
.gs__sn { min-width: 34px; height: 34px; padding: 0 6px; border-radius: 8px; display: inline-grid; place-items: center; font: 800 17px/1 var(--f-display); border: 2px solid var(--ink); }
.gs__sn--gpu { background: var(--gpu); border-color: var(--gpu); color: var(--onbar); }
.gs__sa { font: 800 18px/1 var(--f-display); color: var(--muted); }
.gs__st { font: 600 13.5px/1.35 var(--f-display); color: var(--muted); }
.gs { display: grid; grid-template-columns: 16px repeat(var(--ns), minmax(0, 1fr)); grid-template-rows: auto auto repeat(var(--nr), minmax(30px, auto)); column-gap: 10px; row-gap: 4px; max-width: 860px; }
.gs__h { margin: 0; font: 800 13px/1.3 var(--f-display); align-self: end; }
.gs__h--gpu { color: var(--gpu); }
.gs__p { margin: 0 0 4px; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; font: 600 12px/1.3 var(--f-display); color: var(--muted); }
.gs__c { margin-left: auto; font: 800 12px var(--f-mono); color: var(--muted); }
.gs__n { display: flex; flex-direction: column; justify-content: center; min-width: 0; border: 1.5px solid var(--muted); border-radius: 7px; padding: 4px 7px; background: var(--paper); font: 600 12.5px/1.3 var(--f-mono); overflow-wrap: anywhere; }
.gs__n span { display: block; }
.gs__n--f { border: 2px solid var(--ink); background: var(--free); font-weight: 700; }
.gs__n--gpu { border-color: var(--gpu); background: var(--gpu-soft); }
.gs__n--gpu.gs__n--f { border-width: 2.5px; }
.gs__sk { grid-column: 1; position: relative; margin: 10px 0 14px 4px; border: 2px solid var(--muted); border-right: 0; border-radius: 8px 0 0 8px; }
.gs__sk::after { content: ""; position: absolute; right: -6px; bottom: -6px; border-style: solid; border-width: 5px 0 5px 7px; border-color: transparent transparent transparent var(--muted); }
.gs--flat { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
p.gs__skl { display: flex; align-items: center; gap: 8px; margin: 10px 0 0; font-size: 14.5px; }
.gs__skw { flex: none; width: 14px; height: 16px; border: 2px solid var(--muted); border-right: 0; border-radius: 6px 0 0 6px; }
ul.gs__notes { margin-top: 8px; }
p.gs__in { margin: 10px 0 0; font-size: 14.5px; }
.pm { margin-top: 16px; border: 2px solid var(--ink); border-radius: 12px; padding: 10px 12px; }
.pm__h { margin: 0 0 8px; display: flex; align-items: center; gap: 8px; font: 800 15px/1.3 var(--f-display); }
.pm__h .lk__i { width: 17px; height: 17px; }
table.pm__t { width: 100%; border-collapse: separate; border-spacing: 5px; table-layout: fixed; font-size: 14px; }
.pm__c0 { width: 30%; }
.pm__t th { font: 700 12.5px/1.3 var(--f-display); text-align: left; color: var(--muted); vertical-align: bottom; padding: 2px 4px; overflow-wrap: break-word; }
.pm__t tbody th { vertical-align: middle; color: var(--ink); }
.pm__t td { border-radius: 8px; padding: 8px; vertical-align: top; line-height: 1.35; overflow-wrap: anywhere; }
.pm__t td.ok { border: 2px solid var(--gpu); background: var(--gpu-soft); font-weight: 700; }
.pm__t td.no { background: var(--warn-soft); }
.pm__t td code { font-size: 12px; background: none; padding: 0; color: var(--warn); }
.pm__x { color: var(--warn); font-weight: 800; } .pm__k { color: var(--gpu); font-weight: 800; }
.pm__n { margin: 6px 4px 0; font-size: 13.5px; color: var(--muted); }
@media (max-width: 520px) { table.pm__t { font-size: 13px; border-spacing: 3px; } .pm__t td { padding: 6px; } .pm__c0 { width: 27%; } }
/* ---------- 6 · el model repository */
.rp { min-width: 0; }
.rp p { margin: 0; }
.rp__root { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; font: 600 14px/1.5 var(--f-display); }
.rp__root code { font: 700 14px var(--f-mono); background: none; padding: 0; }
.rp__rn { font: 500 13px/1.4 var(--f-display); color: var(--muted); }
ul.rp__t { list-style: none; margin: 2px 0 0; padding: 0; }
.rp__i { --step: 22px; position: relative; padding: 3px 0 3px calc(var(--d) * var(--step) + 26px); min-width: 0; }
.rp__g { position: absolute; top: 0; bottom: 0; left: calc(var(--l) * var(--step) + 8px); border-left: 1.5px solid var(--muted); opacity: .55; }
.rp__e { position: absolute; top: 0; bottom: 0; left: calc(var(--d) * var(--step) + 8px); width: 14px; border-left: 1.5px solid var(--muted); opacity: .55; }
.rp__e::after { content: ""; position: absolute; left: 0; top: 14px; width: 13px; border-top: 1.5px solid var(--muted); }
.rp__e--last { bottom: auto; height: 15px; }
.rp__c { display: grid; grid-template-columns: calc(270px - var(--d) * var(--step)) minmax(0, 1fr); gap: 0 14px; align-items: baseline; min-width: 0; }
.rp__nm { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; min-width: 0; }
.rp__nm code { font: 700 14px/1.5 var(--f-mono); background: none; padding: 0; }
.rp__ic { width: 16px; height: 16px; flex: none; fill: var(--paper); stroke: var(--ink); stroke-width: 1.3; }
.rp__ic .rp__fold { fill: none; }
.rp--model .rp__ic, .rp--ver .rp__ic { fill: var(--free); }
.rp--plan .rp__ic { fill: var(--gpu-soft); stroke: var(--gpu); } .rp--plan .rp__nm code { color: var(--gpu); }
.rp--ign .rp__ic { stroke: var(--warn); stroke-dasharray: 2 1.5; } .rp--ign .rp__nm code { color: var(--warn); text-decoration: line-through; }
.rp--ex .rp__nm code, .rp--ex .rp__n { opacity: .85; }
.rp__tag { font: 700 10.5px/1.2 var(--f-display); letter-spacing: .06em; text-transform: uppercase; border: 1.2px dashed var(--muted); color: var(--muted); border-radius: 999px; padding: 1px 6px; }
.rp__tag--plan { border: 0; background: var(--gpu); color: var(--onbar); } .rp__tag--ign { border: 0; background: var(--warn-soft); color: var(--warn); }
.rp__n { font-size: 14px; line-height: 1.4; color: var(--muted); }
.rp--root { padding-left: 0; }
@media (max-width: 760px) { .rp__c { grid-template-columns: minmax(0, 1fr); } .rp__n { margin-top: 1px !important; } }
.rp__ld { margin-top: 14px; border-top: 1px dashed var(--rule); padding-top: 10px; }
.rp__lh { margin: 0 0 8px; font: 800 12px/1.3 var(--f-display); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
ol.rp__ls { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; align-items: stretch; gap: 8px 22px; counter-reset: ld; }
ol.rp__ls > li { position: relative; counter-increment: ld; flex: 1 1 150px; min-width: 0; border: 1px solid var(--rule); border-radius: 10px; padding: 7px 10px 7px 34px; font-size: 14px; line-height: 1.4; background: var(--paper); }
ol.rp__ls > li::before { content: counter(ld); position: absolute; left: 8px; top: 7px; width: 19px; height: 19px; border-radius: 50%; background: var(--ink); color: var(--paper); display: grid; place-items: center; font: 800 11px/1 var(--f-display); }
ol.rp__ls > li:not(:last-child)::after { content: "→"; position: absolute; right: -18px; top: 50%; transform: translateY(-50%); color: var(--muted); font: 800 15px/1 var(--f-display); }
li.rp__lo { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; }
.rp__ok, .rp__no { border-radius: 6px; padding: 2px 7px; font: 700 13px/1.35 var(--f-display); }
.rp__ok { background: var(--gpu-soft); border: 1.5px solid var(--gpu); } .rp__ok b { color: var(--gpu); }
.rp__no { background: var(--warn-soft); border: 1.5px solid var(--warn); } .rp__no b { color: var(--warn); }
.rp__or { color: var(--muted); font: 600 12.5px var(--f-display); }
@media (max-width: 640px) { ol.rp__ls { flex-direction: column; gap: 14px; } ol.rp__ls > li { flex: none; } ol.rp__ls > li:not(:last-child)::after { content: "↓"; right: auto; left: 13px; top: auto; bottom: -15px; transform: none; } }
/* ---------- 7 · dynamic batching */
.bt__rl { border: 1.5px solid var(--hi); background: var(--hi-soft); border-radius: 10px; padding: 8px 12px; }
.bt__rh { margin: 0 0 4px; font: 800 12px/1.3 var(--f-display); letter-spacing: .08em; text-transform: uppercase; color: var(--hi-ink); }
.bt__rl ol { margin: 0; padding-left: 20px; font-size: 14.5px; line-height: 1.45; }
.bt__sc { margin-top: 16px; }
.bt__h { display: flex; gap: 8px; align-items: center; margin: 0 0 8px; font: 700 15px/1.35 var(--f-display); }
.bt__k { flex: none; width: 24px; height: 24px; border-radius: 50%; display: inline-grid; place-items: center; background: var(--ink); color: var(--paper); font: 800 12px/1 var(--f-display); }
.bt__tl { position: relative; margin: 0 8px; }
.bt__gl { position: absolute; top: 0; bottom: 0; width: 0; border-left: 1px dashed var(--rule); }
.bt__sep { position: absolute; left: -8px; right: -8px; height: 0; border-top: 1px solid var(--rule); }
.bt__ln { position: absolute; left: 0; font: 700 11px/16px var(--f-display); letter-spacing: .05em; text-transform: uppercase; color: var(--muted); white-space: nowrap; background: var(--paper); padding-right: 4px; }
.bt__dot { position: absolute; width: 11px; height: 11px; margin-left: -5.5px; border-radius: 50%; background: var(--ink); border: 1.5px solid var(--paper); }
.bt__win { position: absolute; background: var(--hi-soft); border: 1.5px solid var(--hi); border-radius: 4px; }
.bt__wait { position: absolute; height: 3px; margin-top: -1.5px; background: var(--hi); border-radius: 2px; min-width: 2px; }
.bt__wait::before { content: ""; position: absolute; left: -4px; top: -3px; width: 9px; height: 9px; border-radius: 50%; background: var(--ink); }
.bt__go { position: absolute; width: 0; margin-left: -1px; border-left: 2px solid var(--ink); }
.bt__go::after { content: ""; position: absolute; left: -6px; bottom: -2px; border-style: solid; border-width: 7px 5px 0 5px; border-color: var(--ink) transparent transparent transparent; }
.bt__ex { position: absolute; background: var(--gpu); color: var(--onbar); border-radius: 4px; display: grid; place-items: center; font: 800 12px/1 var(--f-mono); white-space: nowrap; overflow: hidden; }
.bt__ax { position: relative; height: 16px; margin: 4px 8px 0; font: 600 11px/16px var(--f-mono); color: var(--muted); }
.bt__ax span { position: absolute; top: 0; transform: translateX(-50%); white-space: nowrap; }
.bt__ax span.is-0 { transform: none; } .bt__ax span.is-n { transform: translateX(-100%); }
@media (max-width: 640px) { .bt__ax span.is-odd { display: none; } }
.bt__ln { z-index: 2; }
.bt__res { margin: 8px 0 0; font-size: 14.5px; line-height: 1.45; }
/* ---------- 8 · clientes y protocolo */
.pr__ends { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; margin: 0 0 12px; }
.pr__end { font: 700 14px/1.35 var(--f-display); border-radius: 8px; padding: 5px 10px; min-width: 0; }
.pr__cl { border: 2px solid var(--cpu); background: var(--cpu-soft); } .pr__sv { border: 2px solid var(--gpu); background: var(--gpu-soft); }
.pr__x { font: 800 18px var(--f-display); color: var(--muted); }
.pr__ports { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
.pr__port { border: 1px solid var(--rule); border-radius: 12px; padding: 10px 12px; min-width: 0; }
.pr__port--main { grid-column: 1 / -1; border: 1.5px solid var(--ink); }
.pr__port p { margin: 0; }
.pr__ph { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; font: 700 14px/1.35 var(--f-display); }
.pr__pn { font: 800 21px/1 var(--f-mono); }
.pr__pu { margin: 3px 0 0 !important; font-size: 13.5px; line-height: 1.4; color: var(--muted); }
ul.pr__calls { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 8px; }
li.pr__gh { margin-top: 2px; font: 800 11.5px/1.3 var(--f-display); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.pr__c { display: grid; grid-template-columns: 140px minmax(0, 1.15fr) minmax(0, 1fr); gap: 2px 14px; align-items: baseline; border-top: 1px solid var(--rule); padding-top: 7px; min-width: 0; }
.pr__c p { min-width: 0; }
.pr__who { font: 700 13px/1.35 var(--f-display); }
.pr__rq { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 6px; }
.pr__rq code { font: 700 13px/1.45 var(--f-mono); background: none; padding: 0; overflow-wrap: anywhere; }
.pr__m { flex: none; font: 800 10.5px/1 var(--f-mono); border-radius: 4px; padding: 3px 5px; border: 1.5px solid var(--ink); }
.pr__m--post { background: var(--ink); color: var(--paper); }
.pr__an { font-size: 14px; line-height: 1.4; }
.pr__ar { color: var(--muted); font-weight: 800; }
.pr__c01 { grid-column: 2 / -1; font-size: 13px; line-height: 1.4; color: var(--muted); }
.pr__c--infer { border: 2px solid var(--ink); border-radius: 10px; padding: 8px 10px; }
.pr__pay { grid-column: 1 / -1; margin-top: 6px; display: grid; gap: 4px; }
.pr__pay p { display: grid; grid-template-columns: 58px minmax(0, 1fr) 96px; gap: 8px; align-items: center; font: 600 12.5px/1.2 var(--f-display); }
.pr__pk { color: var(--muted); }
.pr__trk { display: block; height: 12px; background: var(--free); border-radius: 3px; overflow: hidden; }
.pr__bar { display: block; height: 100%; min-width: 2px; background: var(--ink); opacity: .75; }
.pr__pv { font: 700 12px var(--f-mono); text-align: right; }
@media (max-width: 760px) { .pr__ports { grid-template-columns: minmax(0, 1fr); } .pr__c { grid-template-columns: minmax(0, 1fr); } .pr__c01 { grid-column: 1; } }
@media (min-width: 761px) { .pr__c--infer { margin: 0 -12px; } }
/* ---------- 9 · rendimiento */
.pf__w svg { max-width: 840px; }
.pf__n { display: none; }
@media (max-width: 699px) { .pf__w { display: none; } .pf__n { display: block; } }
svg .pf-g { stroke: var(--rule); stroke-width: 1; }
svg .pf-ko { fill: var(--paper); }
svg .pf-ax { stroke: var(--muted); stroke-width: 1.2; fill: none; }
svg .pf-tk { fill: var(--muted); font-family: var(--f-mono); }
svg .pf-mt { fill: var(--ink); font-family: var(--f-display); font-weight: 600; }
svg .pf-pt { fill: var(--ink); font-family: var(--f-display); font-weight: 800; }
svg .pf-xl { fill: var(--muted); font-family: var(--f-display); font-weight: 600; }
svg .pf-ll { fill: var(--hi-ink); font-family: var(--f-display); font-weight: 800; }
svg .pf-mk { stroke: var(--muted); stroke-width: 1.2; stroke-dasharray: 3 3; fill: none; }
svg .pf-diag { stroke: var(--muted); stroke-width: 1.5; stroke-dasharray: 6 4; fill: none; }
svg .pf-thr { stroke: var(--gpu); stroke-width: 2.8; fill: none; } svg .pf-dthr { fill: var(--gpu); }
svg .pf-p99 { stroke: var(--hi); stroke-width: 2.8; fill: none; } svg .pf-d99 { fill: var(--hi); }
svg .pf-p50 { stroke: var(--hi); stroke-width: 2; stroke-dasharray: 6 4; fill: none; } svg .pf-d50 { fill: var(--paper); stroke: var(--hi); stroke-width: 1.6; }
svg .pf-hatch { fill: var(--warn); opacity: .55; }
svg .pf-rej { stroke: var(--warn); stroke-width: 1; }
svg .pf-tag { fill: var(--paper); stroke: var(--ink); stroke-width: 1.3; } svg .pf-tagt { fill: var(--ink); font-family: var(--f-display); font-weight: 800; letter-spacing: .1em; }
.pf__src { margin: 6px 0 0; font-size: 13.5px; color: var(--muted); }
/* ---------- 10 · pre y postprocesamiento */
ul.pp__lg { list-style: none; margin: 0 0 10px; padding: 0; display: flex; flex-wrap: wrap; gap: 6px 18px; font: 600 13.5px/1.4 var(--f-display); }
ul.pp__lg li { display: inline-flex; align-items: center; gap: 7px; }
.pp__sw { width: 18px; height: 14px; border-radius: 3px; flex: none; }
.pp--cpu { background: var(--cpu); color: var(--onbar); } .pp--gpu { background: var(--gpu); color: var(--onbar); }
.pp--cpugpu { background: var(--cpu); color: var(--onbar); box-shadow: inset 0 -5px 0 var(--gpu); }
ol.pp__steps { margin: 0 0 12px; padding-left: 22px; font-size: 14.5px; line-height: 1.45; columns: 2 230px; column-gap: 26px; }
.pp { display: grid; gap: 10px; }
.pp__hd { display: none; }
.pp__o { border: 1px solid var(--rule); border-radius: 12px; padding: 10px 12px; min-width: 0; }
.pp__o--c01 { border: 2.5px solid var(--ink); }
.pp__o p { margin: 0; }
.pp__lab { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; }
.pp__ol { font: 800 15.5px/1.35 var(--f-display); }
.pp__v { font: 700 11.5px/1.3 var(--f-display); letter-spacing: .04em; border: 1px solid var(--rule); color: var(--muted); border-radius: 999px; padding: 2px 8px; }
.pp__v--c01 { background: var(--ink); border-color: var(--ink); color: var(--paper); }
.pp__cells { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 4px; margin-top: 8px; }
.pp__cell { min-width: 0; border-radius: 6px; padding: 4px 5px 7px; font: 700 11.5px/1.2 var(--f-display); overflow-wrap: break-word; hyphens: auto; }
@media (max-width: 640px) { .pp__cell { padding: 4px 3px 7px; font-size: 10.5px; } }
.pp__cn { display: block; font: 800 11px/1.2 var(--f-mono); opacity: .85; }
.pp__wire { margin-top: 8px !important; display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; font-size: 14px; line-height: 1.4; }
.pp__trk { position: relative; display: block; flex: 1 1 100%; height: 9px; background: var(--free); border-radius: 3px; overflow: hidden; }
.pp__lo { position: absolute; left: 0; top: 0; bottom: 0; background: var(--ink); opacity: .75; }
.pp__hi { position: absolute; top: 0; bottom: 0; background: repeating-linear-gradient(135deg, var(--ink) 0 2px, transparent 2px 5px); opacity: .6; }
.pp__pc { margin-top: 8px; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 4px 18px; font-size: 14px; line-height: 1.45; }
.pp__pro, .pp__con { font: 800 11.5px/1.3 var(--f-display); letter-spacing: .06em; text-transform: uppercase; }
.pp__pro { color: var(--muted); } .pp__con { color: var(--warn); }
@media (max-width: 640px) { .pp__pc { grid-template-columns: minmax(0, 1fr); } }
@media (min-width: 900px) {
  ol.pp__steps { display: none; }
  .pp { gap: 0; grid-template-columns: 190px repeat(5, minmax(0, 1fr)) 170px; column-gap: 6px; }
  .pp__hd { display: contents; }
  .pp__hd > span { font: 700 12px/1.3 var(--f-display); color: var(--muted); padding: 0 2px 8px; align-self: end; }
  .pp__hd .pp__hs b { font-family: var(--f-mono); color: var(--ink); }
  .pp__o { display: grid; grid-column: 1 / -1; grid-template-columns: subgrid; align-items: center; row-gap: 8px; border-radius: 0; border-width: 1px 0 0; padding: 10px 0; }
  .pp__o--c01 { border: 2.5px solid var(--ink); border-radius: 10px; padding: 10px 8px; margin: 2px -8px; }
  .pp__lab { grid-column: 1; flex-direction: column; align-items: flex-start; }
  .pp__cells { display: contents; }
  .pp__cell { margin: 0; padding: 7px 7px 9px; font-size: 12.5px; }
  .pp__cn { display: none; }
  .pp__wire { grid-column: 7; margin: 0 !important; flex-direction: column; align-items: stretch; }
  .pp__wire .pp__trk { flex: none; width: 100%; margin-top: 4px; }
  .pp__wk { display: none; }
  .pp__pc { grid-column: 2 / -1; margin: 0; }
}
/* ---------- 4, 11, 12 · cadenas de pasos */
ol.ch { list-style: none; margin: 0; padding: 0; display: grid; }
.ch__s { --c: var(--ink); position: relative; padding: 0 0 18px 44px; min-width: 0; }
.ch__s::before { content: ""; position: absolute; left: 14px; top: 32px; bottom: 4px; width: 3px; background: var(--c); opacity: .35; border-radius: 2px; }
.ch__s:last-child::before { display: none; }
.ch--cpu { --c: var(--cpu); } .ch--gpu { --c: var(--gpu); } .ch--e2e { --c: var(--ink); }
.ch__no { position: absolute; left: 0; top: 0; width: 31px; height: 31px; border-radius: 50%; background: var(--c); color: var(--paper); display: grid; place-items: center; font: 800 14px/1 var(--f-display); }
.ch--cpu .ch__no, .ch--gpu .ch__no { color: var(--onbar); }
.ch__s p { margin: 0; }
.ch__l { font: 800 16.5px/1.35 var(--f-display); padding-top: 3px; }
.ch__wh { display: inline-block; margin-left: 8px; font: 700 11px/1.3 var(--f-display); letter-spacing: .06em; text-transform: uppercase; color: var(--c); border: 1.5px solid var(--c); border-radius: 999px; padding: 1px 7px; vertical-align: 2px; }
.ch__n { margin-top: 6px !important; font-size: 15px; line-height: 1.5; }
.ch__at { margin-top: 6px !important; padding: 5px 10px; border-left: 3px solid var(--warn); background: var(--warn-soft); border-radius: 0 6px 6px 0; font-size: 14.5px; line-height: 1.45; }
.lg { margin: 0 0 18px; border: 1px solid var(--rule); border-radius: 10px; padding: 10px 12px 8px; }
.lg p { margin: 0; }
.lg__h { font: 800 12px/1.3 var(--f-display); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.lg__ax { position: relative; margin: 10px 10px 0; border-bottom: 2px solid var(--muted); }
.lg__stop { position: absolute; top: 0; bottom: 0; right: 0; background: var(--warn-soft); }
.lg__t { position: absolute; bottom: -6px; height: 10px; border-left: 1.5px solid var(--muted); }
.lg__rg { position: absolute; bottom: -5px; height: 8px; border-radius: 4px; }
.lg__p { position: absolute; transform: translateX(-50%); display: grid; justify-items: center; font: 700 11.5px/1.25 var(--f-display); border-radius: 6px; padding: 3px 6px; white-space: nowrap; z-index: 1; }
.lg__p::after { content: ""; position: absolute; left: 50%; bottom: calc(-1 * var(--lh, 9px)); height: var(--lh, 9px); border-left: 2px solid var(--ink); opacity: .7; }
.lg__p span { font: 600 11px/1.2 var(--f-mono); }
.lg__bug { background: var(--warn); color: var(--onbar); }
.lg__th { position: absolute; top: -2px; transform: translateX(-100%); padding-right: 4px; font: 700 11px/1.2 var(--f-display); color: var(--warn); white-space: nowrap; border-right: 2px solid var(--warn); height: 100%; }
.lg__tk { position: relative; height: 18px; margin: 4px 10px 0; font: 600 11px/18px var(--f-mono); color: var(--muted); }
.lg__tk span { position: absolute; top: 0; transform: translateX(-50%); white-space: nowrap; }
.lg__tk span.is-0 { transform: none; } .lg__tk span.is-n { transform: translateX(-100%); }
.lg__n { margin-top: 2px !important; font-size: 13px; color: var(--muted); }
.ch__lad { position: relative; display: grid; grid-template-columns: 26px minmax(0, 1fr); gap: 12px; }
.ch__rail { position: relative; border-radius: 13px; background: linear-gradient(180deg, var(--free), var(--muted)); display: flex; flex-direction: column; justify-content: space-between; align-items: center; padding: 8px 0; }
.ch__rail span { writing-mode: vertical-rl; transform: rotate(180deg); font: 800 10.5px/1 var(--f-display); letter-spacing: .08em; text-transform: uppercase; color: var(--ink); white-space: nowrap; }
.ch__rail span:last-child { color: var(--paper); }
.ch--lad .ch__s::before { background: var(--muted); }
.ch__as { margin-top: 6px; border: 2px dashed var(--muted); border-radius: 12px; padding: 10px 12px; }
.ch__as p { margin: 0; }
p.ch__tr { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0 0 16px; }
.ch__tp { display: inline-flex; align-items: center; gap: 5px; font: 700 13px/1.3 var(--f-display); border: 1px solid var(--rule); border-radius: 999px; padding: 3px 9px 3px 4px; background: var(--paper); }
.ch__tp b { width: 19px; height: 19px; border-radius: 50%; background: var(--ink); color: var(--paper); display: inline-grid; place-items: center; font: 800 10.5px/1 var(--f-display); }
.ch__ta { color: var(--muted); font-weight: 800; }
.ch--probe .ch__no { background: color-mix(in srgb, var(--ink) calc(55% + var(--k) * 45%), var(--paper)); }
/* tablas: se apilan en el celular */
@media (max-width: 640px) {
  table.stk, table.stk tbody, table.stk tr, table.stk td, table.stk th.rh { display: block; width: 100%; }
  table.stk thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  table.stk colgroup { display: none; }
  table.stk tr { border-bottom: 1px solid var(--rule); padding: 8px 0; }
  table.stk td, table.stk th.rh { border: 0; padding: 2px 0; }
  table.stk td[data-k]::before { content: attr(data-k); display: block; font: 700 10.5px/1.5 var(--f-display); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
}
@media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }
@media print {
  @page { size: A4; margin: 12mm; }
  :root, :root:not([data-theme="light"]), :root[data-theme="dark"] {
    --bg: #ffffff; --paper: #ffffff; --ink: #18212d; --muted: #5a6575; --rule: #d6dde6; --grid: rgba(31, 95, 174, 0.075);
    --accent: #1f5fae; --accent-soft: rgba(31, 95, 174, 0.14); --accent2: #0f7a6e; --accent2-soft: rgba(15, 122, 110, 0.32);
    --hi: #d99a12; --hi-soft: #fff1cc; --warn: #b5482c; --warn-soft: #fbe8e2; --free: #e7ecf2; --onbar: #ffffff;
    --code-bg: #f6f8fb; --syn-kw: #1f5fae; --syn-str: #7a4fb8; --syn-com: #5a6575; --ok-soft: rgba(15, 122, 110, 0.13); --hi-ink: #8a5a00; --var-bg: rgba(31, 95, 174, 0.09); --pu: #7a4fb8; --pu-soft: rgba(122, 79, 184, 0.11); --on-hi: #18212d;
    --cpu: #1f5fae; --cpu-soft: rgba(31, 95, 174, 0.12); --gpu: #0f7a6e; --gpu-soft: rgba(15, 122, 110, 0.13);
    --fp32: #5b3a99; --fp16: #b597e6; --int8: #e3d6f7; --on32: #ffffff; --on16: #18212d; --on8: #18212d; color-scheme: light;
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
  .sw.sw--thr, .sw.sw--p99, .sw.sw--wait { height: 3px; } .sw.sw--diag, .sw.sw--p50 { height: 0; } .sw.sw--mk { width: 0; height: 10px; } .sw.sw--req { width: 8px; height: 8px; }
  .pf__src { font-size: 9.5px; } .pp__pro, .pp__con { font-size: 8px; }
  .pt { font-size: 9.5px; }
  .pc__hd { display: grid !important; } .pc__hd, .pc__r { grid-template-columns: 62px 104px minmax(0, 1.2fr) minmax(0, 1fr) !important; grid-template-areas: none !important; gap: 3px 10px; }
  .pc__dt, .pc__by, .pc__mb, .pc__ro { grid-area: auto !important; }
  .pc__hd { font-size: 8px; } .pc__r { padding: 5px 0; } .pc__ro, .pc__m { font-size: 10px; } .pc__t4 { font-size: 9px; } .pc__sq i { width: 11px; height: 11px; } .pc__bn, .pc__v { font-size: 9.5px; } .pc__trk { height: 12px; } .pc__dt .pt { font-size: 10.5px; }
  .vr { margin-top: 10px; padding-top: 8px; } .vr__h { font-size: 11px; } .vr__vis, ul.vr__lg, .vr__pl { font-size: 9.5px; } .vr__bar { height: 20px; } .vr__ax, .vr__pv { font-size: 9px; } .vr__ph { font-size: 8.5px; }
  .pi__st { grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr) !important; padding: 0 0 10px 34px; gap: 4px 14px; } .pi__no { width: 24px; height: 24px; font-size: 11px; } .pi__st::before { left: 11px; top: 26px; }
  .pi__l { font-size: 12px; } .pi__art, .pi__w { font-size: 9.5px; } .pi__ck { font-size: 10px; } .pi__split { font-size: 10px; padding: 4px 8px; margin-bottom: 10px; } .lk { font-size: 9.5px; } .lk__g, .lk__t { font-size: 9px; }
  .gb__on code, .gb__n { font-size: 10px; } .gb__nt, .gb__fold p { font-size: 9.5px; } .gb__row { padding: 3px 0; } ul.gb__fu, p.gb__io { font-size: 10px; } .gb__hd p { font-size: 9px; }
  .gs__h { font-size: 10px; } .gs__p { font-size: 9px; } .gs__n { font-size: 9.5px; padding: 2px 5px; } .gs { grid-template-rows: auto auto repeat(var(--nr), minmax(20px, auto)); } .gs__sn { min-width: 26px; height: 26px; font-size: 13px; } .gs__st, p.gs__skl, p.gs__in { font-size: 10px; }
  .pm { padding: 6px 8px; margin-top: 8px; } .pm__h { font-size: 11px; } table.pm__t { font-size: 10px; } .pm__t th { font-size: 9px; } .pm__t td { padding: 4px 6px; } .pm__t td code { font-size: 9px; } .pm__n { font-size: 9.5px; }
  .rp__root, .rp__nm code, .rp__root code { font-size: 10.5px; } .rp__n, .rp__rn { font-size: 9.5px; } .rp__i { --step: 17px; padding-top: 1px; padding-bottom: 1px; } .rp__c { grid-template-columns: calc(220px - var(--d) * var(--step)) minmax(0, 1fr) !important; } .rp__e::after { top: 10px; } .rp__e--last { height: 11px; }
  ol.rp__ls { flex-direction: row !important; gap: 6px 16px; } ol.rp__ls > li { font-size: 9.5px; padding: 4px 6px 4px 26px; flex-basis: 100px; } ol.rp__ls > li::before { width: 15px; height: 15px; font-size: 9px; left: 6px; top: 4px; } ol.rp__ls > li:not(:last-child)::after { content: "→" !important; right: -13px !important; left: auto !important; top: 50% !important; bottom: auto !important; transform: translateY(-50%) !important; } .rp__ok, .rp__no { font-size: 9.5px; }
  .bt__rl ol, .bt__res { font-size: 10px; } .bt__h { font-size: 11px; } .bt__ln, .bt__ax { font-size: 8.5px; } .bt__ex { font-size: 9.5px; }
  .pr__ports { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important; } .pr__c { grid-template-columns: 100px minmax(0, 1.15fr) minmax(0, 1fr) !important; } .pr__c01 { grid-column: 2 / -1 !important; } .pr__who, .pr__rq code, .pr__an, .pr__end, .pr__ph { font-size: 10px; } .pr__c01, .pr__pu { font-size: 9.5px; } .pr__pn { font-size: 15px; } .pr__pay p { font-size: 9px; }
  .pf__w svg { max-width: 600px; }
  ol.pp__steps { display: none !important; } .pp { gap: 0 !important; grid-template-columns: 112px repeat(5, minmax(0, 1fr)) 102px !important; column-gap: 4px !important; }
  .pp__hd { display: contents !important; } .pp__hd > span { font-size: 8.5px; padding-bottom: 4px; align-self: end; }
  .pp__o { display: grid !important; grid-column: 1 / -1 !important; grid-template-columns: subgrid !important; align-items: center; row-gap: 4px; border-radius: 0; border-width: 1px 0 0; padding: 5px 0; }
  .pp__o--c01 { border: 2px solid var(--ink) !important; border-radius: 8px !important; padding: 5px 4px !important; }
  .pp__lab { grid-column: 1; flex-direction: column; align-items: flex-start; } .pp__ol { font-size: 10px; } .pp__v { font-size: 8.5px; }
  .pp__cells { display: contents !important; } .pp__cell { font-size: 9px; padding: 4px 4px 6px; } .pp__cn { display: none !important; }
  .pp__wire { grid-column: 7; margin: 0 !important; flex-direction: column; align-items: stretch; font-size: 9px; } .pp__wk { display: none; } .pp__wire .pp__trk { flex: none; width: 100%; margin-top: 3px; height: 7px; }
  .pp__pc { grid-column: 2 / -1; margin: 0; font-size: 9.5px; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important; } ul.pp__lg { font-size: 9.5px; margin-bottom: 6px; }
  .ch__s { padding: 0 0 9px 32px; } .ch__no { width: 23px; height: 23px; font-size: 11px; } .ch__s::before { left: 10px; top: 25px; } .ch__l { font-size: 12px; padding-top: 1px; } .ch__n, .ch__at { font-size: 10px; } .ch__wh { font-size: 8px; }
  .lg { padding: 6px 8px; margin-bottom: 10px; } .lg__h, .lg__n { font-size: 8.5px; } .lg__p { font-size: 9px; } .lg__p span, .lg__th, .lg__tk { font-size: 8.5px; } .lg__ax { height: 54px; }
  .ch__tp { font-size: 9.5px; } .ch__as { padding: 6px 8px; } .ch__rail span { font-size: 8px; }
  figure.fig:not(.has-table), .notes, .memo, .trap, ol.errlist li, .tpl, .mb, ul.ex__notes li, .pc__r, .vr, .pi__st, .gb__row, .gs, .pm, .rp__i, .rp__ld, .bt__sc, .pr__port, .pr__c, .pp__o, .ch__s, .lg { break-inside: avoid; }
  tr { break-inside: avoid; }
  .card > h3, .example > h3, .tag, .bt__h, .vr__ph, .rp__lh, .pr__ph, li.pr__gh { break-after: avoid; }
}
`;

// ================================================================ JS de la página (sin librerías)
const DATA = {
  rules: W2.revisor.map((r) => ({ id: r.id, severity: r.severity, message: r.message, why: r.why, fix: r.fix })),
  samples: SAMPLES,
  btns: [['rv-c01', 'c01']],
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
    var box = btn.closest('.cmdw, .code');
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

  // ---------- revisor de config.pbtxt
  /*REVISOR*/
  var RULE = {}, IDS = D.rules.map(function (r) { RULE[r.id] = r; return r.id; });
  var RANK = { error: 0, warn: 1, info: 2 }, NAME = { error: 'error', warn: 'aviso', info: 'info' };
  function plural(nn, a, b) { return nn + ' ' + (nn === 1 ? a : b); }
  function list(x) { return x === undefined || x === null ? [] : Array.isArray(x) ? x : [x]; }
  function field(at) { var s = ''; (at || []).forEach(function (p) { s += typeof p === 'number' ? '[' + p + ']' : (s ? '.' : '') + p; }); return s; }
  function lineBtn(n) { return '<button class="rv-ln" type="button" data-line="' + n + '" title="Marcar la línea en el texto">línea ' + n + '</button>'; }
  function review() {
    var text = $('rv-text').value, out = $('rv-out');
    if (!text.trim()) { out.innerHTML = '<p class="small">Pega un <code>config.pbtxt</code> (el de la carpeta de tu modelo en el model repository) y toca Revisar.</p>'; return; }
    var r;
    try { r = pbParse(text); }
    catch (e) {
      if (!e || !e.pb) throw e;
      var L = text.replace(/\r\n?/g, '\n').split('\n'), lo = Math.max(1, e.line - 1), hi = Math.min(L.length, e.line + 1), snip = [], w = String(hi).length;
      for (var i = lo; i <= hi; i++) {
        var nn = String(i); while (nn.length < w) nn = ' ' + nn;
        snip.push(nn + ' | ' + (L[i - 1] || ''));
        if (i === e.line) snip.push(new Array(w + 1).join(' ') + ' | ' + new Array(Math.max(1, e.col)).join(' ') + '^');
      }
      out.innerHTML = '<div class="rv-err" role="alert" id="rv-error"><p class="rv-err__t">El config.pbtxt no es válido: no pude leerlo</p><p><b>Línea ' + e.line + ', columna ' + e.col + ':</b> ' + esc(e.msg) + ' ' + lineBtn(e.line) + '</p><pre class="rv-err__snip">' + esc(snip.join('\n')) + '</pre><p class="small">Mira las llaves y los corchetes sin cerrar, los dos puntos después de un campo con valor simple y las comillas. Triton tampoco lo cargaría: su parser de protobuf fallaría igual.</p></div>';
      return;
    }
    var c = r.cfg;
    var found = pbReview(c, IDS).filter(function (f) { return RULE[f.id]; });
    found.forEach(function (f) { f.line = pbLine(r, f.at); });
    found.sort(function (a, b) { return (RANK[RULE[a.id].severity] - RANK[RULE[b.id].severity]) || ((a.line || 0) - (b.line || 0)); });
    var cnt = { error: 0, warn: 0, info: 0 };
    found.forEach(function (f) { cnt[RULE[f.id].severity]++; });
    var who = typeof c.backend === 'string' && c.backend ? 'backend ' + c.backend : c.platform !== undefined ? 'platform ' + c.platform : 'sin platform ni backend';
    var ni = list(c.input).length, no = list(c.output).length;
    var html = '<p class="rv-sum" id="rv-sum" data-total="' + found.length + '" data-error="' + cnt.error + '" data-warn="' + cnt.warn + '" data-info="' + cnt.info + '">' +
      (found.length ? plural(found.length, 'hallazgo', 'hallazgos') + ': ' + plural(cnt.error, 'error', 'errores') + ' · ' + plural(cnt.warn, 'aviso', 'avisos') + ' · ' + cnt.info + ' info'
        : 'Sin hallazgos: ninguna de las ' + IDS.length + ' reglas encontró algo.') + '</p>' +
      '<p class="rv-objs">Revisé ' + (typeof c.name === 'string' && c.name ? 'el modelo «' + esc(c.name) + '»' : 'un modelo sin name') + ': ' + esc(who) + ', max_batch_size ' + esc(c.max_batch_size === undefined ? 'sin escribir' : c.max_batch_size) + ', ' + plural(ni, 'entrada', 'entradas') + ' y ' + plural(no, 'salida', 'salidas') + '.</p>';
    if (found.length) html += '<ol class="rv-list">' + found.map(function (f) {
      var rr = RULE[f.id], where = [];
      if (f.at) where.push('<code>' + esc(field(f.at)) + '</code>');
      else if (f.miss) where.push('falta <code>' + esc(f.miss) + '</code>');
      if (f.line) where.push(lineBtn(f.line));
      if (f.detail) where.push(esc(String(f.detail).slice(0, 160)));
      return '<li class="sev-' + rr.severity + '" data-rule="' + rr.id + '"' + (f.line ? ' data-line="' + f.line + '"' : '') + '><div class="rv-h"><span class="sev ' + rr.severity + '">' + NAME[rr.severity] + '</span><span class="rv-msg">' + esc(rr.message) + '</span></div>' +
        '<p class="rv-obj">' + where.join(' · ') + '</p><p>' + esc(rr.why) + '</p><p><span class="k">Arreglo:</span> ' + esc(rr.fix) + '</p></li>';
    }).join('') + '</ol>';
    out.innerHTML = html;
  }
  // marcar una línea del textarea
  $('rv-out').addEventListener('click', function (ev) {
    var b = ev.target && ev.target.closest ? ev.target.closest('.rv-ln') : null;
    if (!b) return;
    var ta = $('rv-text'), n = +b.getAttribute('data-line'), lines = ta.value.split('\n'), start = 0;
    for (var i = 0; i < n - 1 && i < lines.length; i++) start += lines[i].length + 1;
    var end = start + (lines[n - 1] || '').length;
    ta.focus();
    try { ta.setSelectionRange(start, end); } catch (e) {}
    var lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
    ta.scrollTop = Math.max(0, (n - 4) * lh);
    if (ta.scrollIntoView) ta.scrollIntoView({ block: 'nearest' });
  });
  function setLabel(t, cls) { var l = $('rv-label'); l.textContent = t; l.className = 'rv-label' + (cls ? ' ' + cls : ''); }
  function load(k) { var s = D.samples[k]; $('rv-text').value = s.text; setLabel(s.label, s.cls); review(); }
  $('rv-run').addEventListener('click', function () { var t = $('rv-text').value; var cur = Object.keys(D.samples).filter(function (k) { return D.samples[k].text === t; })[0]; if (!cur) setLabel('Tu config.pbtxt', 'mine'); review(); });
  $('rv-bad').addEventListener('click', function () { load('bad'); });
  D.btns.forEach(function (b) { var el = $(b[0]); if (el) el.addEventListener('click', function () { load(b[1]); }); });
  $('rv-clear').addEventListener('click', function () { $('rv-text').value = ''; setLabel('Tu config.pbtxt', 'mine'); $('rv-out').innerHTML = ''; $('rv-text').focus(); });
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
    a.innerHTML = '<p class="tag">Qué significa</p><p>' + esc(e.meaning) + '</p><p class="tag">Corre primero</p><p>' + e.first + '</p><p class="tag">Dónde está</p><p><a href="#' + e.sec + '">' + esc(e.lab) + '</a></p>';
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
const NAV = [...ORDER.map((id) => [id, NAVL[id]]), ['diagnosticador', 'Diagnosticador'], ['revisor', 'Revisor de config.pbtxt']];
const TITLE = 'De PyTorch a Triton';
const HEAD = `<title>${TITLE}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&family=JetBrains+Mono:wght@400;600;700&family=Source+Serif+4:ital,opsz,wght@0,8..60,400..700;1,8..60,400..700&display=swap">
<style>${CSS}</style>`;
// Versiones del pie: salen del contenido. Si el contenido cambia, el pie cambia con él.
const VER = (() => {
  const all = JSON.stringify([W1, W2, W3]);
  const torch = (all.match(/torch (\d+\.\d+)(?:\.\d+)?\b/) || [])[1];
  const triton = (all.match(/Triton (\d+\.\d+\.\d+) con TensorRT/) || [])[1];
  if (!torch) aviso('el pie no encontró la versión de torch');
  return { torch, triton };
})();
const WRAP = `<div class="wrap">
  <header class="hero">
    <p class="kicker">Ronda de Diseño ML · Serving de modelos · ejemplos de C01</p>
    <h1>${TITLE}</h1>
    <p class="lead">Para llevar un modelo entrenado en PyTorch a un servicio rápido y medido con la documentación abierta, y para diagnosticar por qué va lento, predice distinto o no carga. El modelo se exporta a ONNX, se compara con el original, se compila con TensorRT para la GPU donde va a correr y se sirve con Triton, que junta los requests en batches; al final se mide. Cada sección trae la sintaxis como plantilla con variables, las piezas, un ejemplo real del curso, una figura, un truco para recordarla, la trampa típica y, cuando se puede sin GPU, un laboratorio opcional. En la versión web, al final hay un diagnosticador de síntomas, un revisor de config.pbtxt y un quiz de errores.</p>
    <p class="legendrow"><span><i class="dot" style="background:var(--hi-soft);outline:1px solid var(--hi)"></i>Cómo recordarla</span><span><i class="dot" style="background:var(--warn-soft);outline:1px solid var(--warn)"></i>Trampa típica</span><span><var class="ph">variable</var>la cambias tú</span><span><i class="dot" style="background:var(--accent2)"></i>Ejemplos en verde</span></p>
    <p class="legendrow"><span class="lgk">En las figuras:</span><span><i class="dot" style="background:var(--cpu)"></i>CPU</span><span><i class="dot" style="background:var(--gpu)"></i>la GPU y su trabajo</span><span><i class="dot" style="background:var(--hi)"></i>espera y latencia</span><span><i class="dot" style="background:var(--fp32)"></i><i class="dot" style="background:var(--fp16)"></i><i class="dot" style="background:var(--int8);outline:1px solid var(--fp16)"></i>precisión: FP32 · FP16 · INT8</span><span><i class="dot" style="background:var(--warn)"></i>falla, se rechaza o no carga</span><span><i class="dot" style="border:1.6px dashed var(--muted)"></i>se ignora o es un ejemplo</span></p>
  </header>
  <nav class="toc" aria-label="Secciones"><ul>${NAV.map(([id, l]) => `<li><a href="#${id}">${esc(l)}</a></li>`).join('')}</ul></nav>
  ${ORDER.map(sectionHtml).join('\n')}
  ${toolsHtml()}
  <footer>Comandos, campos, flags y mensajes revisados en octubre de 2026 contra la documentación oficial de PyTorch, ONNX, ONNX Runtime, NVIDIA TensorRT, Triton Inference Server y tritonclient, y contra los archivos de <code>reference/c01</code> del curso. Las versiones son las del C01${VER.torch ? `: torch ${VER.torch}` : ''}${FACT.ngc ? `, NGC ${FACT.ngc}` : ''}${FACT.trt ? ` (TensorRT ${FACT.trt}${VER.triton ? ` y Triton ${VER.triton}` : ''})` : ''}; cuando la versión actual cambia algo, como TensorRT 11, la sección lo dice. Ningún laboratorio necesita GPU: los marcados como probados se corrieron de verdad en un Mac; los demás se verificaron contra la documentación. Si tu terminal dice otra cosa, créele a tu terminal.</footer>
</div>`;

const KATEX = '<script src="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.11/katex.min.js"></script><script id="render-math">document.querySelectorAll("[data-tex]").forEach(function (el) { katex.render(el.dataset.tex, el, { displayMode: el.classList.contains("mb"), output: "mathml", throwOnError: false, strict: "ignore" }); }); window.__math = document.querySelectorAll("[data-tex] math").length;</script>';

function writeSrc(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'head.html'), HEAD);
  writeFileSync(join(dir, 'wrap.html'), WRAP);
  writeFileSync(join(dir, 'script.js'), JS);
  writeFileSync(join(dir, 'revisor.js'), REVISOR_SRC + `\nvar REVISOR_IDS = ${JSON.stringify(REVIEW_IDS)};\nvar REVISOR_SAMPLES = ${jsonForScript(Object.fromEntries(Object.entries(SAMPLES).map(([k, v]) => [k, v.text])))};\nif (typeof module !== 'undefined') module.exports = { pbParse: pbParse, pbReview: pbReview, pbLine: pbLine, REVISOR_IDS: REVISOR_IDS, REVISOR_SAMPLES: REVISOR_SAMPLES };\n`);
  // src.html: sin el script de la página, para que el .wrap que se captura quede intacto (solo con el TeX renderizado).
  writeFileSync(join(dir, 'src.html'), '<!doctype html>\n<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' + HEAD + '</head><body>' + WRAP + KATEX + '</body></html>');
  const texN = (WRAP.match(/data-tex=/g) || []).length;
  console.log('src ok ·', (HEAD + WRAP + JS).length, 'bytes ·', texN, 'fórmulas ·', ORDER.length, 'secciones');
  console.log(`datos: ${ORDER.length} secciones · diagnosticador ${W3.diagnosticador.length} síntomas · revisor ${W2.revisor.length} reglas (${RULE_IDS.length} implementadas) · errores ${ERRS.length} mensajes · contenido de ${CONTENT}`);
  console.log(`revisor: C01 ${REV_CHECK.c01} hallazgos · ejemplo con problemas ${REV_CHECK.bad} hallazgos (${REV_CHECK.badIds.length} reglas: ${REV_CHECK.badIds.join(', ')}) · example_bad que disparan ${REV_CHECK.ex.fired}/${W2.revisor.length} · example_good en silencio ${REV_CHECK.ex.quiet}/${W2.revisor.length}`);
  return texN;
}
function report() {
  if (AVISOS.length) { console.log(`avisos del contenido (${AVISOS.length}):`); AVISOS.forEach((a) => console.log('  - ' + a)); }
  else console.log('avisos del contenido: ninguno');
}
function pdf(pagePath) {
  const out = join(HERE, '..', 'cheatsheet-triton.pdf');
  const prof = mkdtempSync(join(tmpdir(), 'triton-pdf-'));
  const r = spawnSync(CHROME, ['--headless=new', '--no-pdf-header-footer', '--virtual-time-budget=10000', `--print-to-pdf=${out}`, `--user-data-dir=${prof}`, pathToFileURL(pagePath).href], { encoding: 'utf8', timeout: 180000 });
  try { rmSync(prof, { recursive: true, force: true }); } catch (e) { /* no importa */ }
  if (r.status !== 0 || !existsSync(out)) { console.error(r.stdout, r.stderr); throw new Error('Chrome no pudo imprimir el PDF'); }
  console.log('cheatsheet-triton.pdf listo');
}

const mode = process.argv[2] || 'build';
if (mode === 'cmds') {
  // para revisar a ojo cómo se parte cada texto con comandos: [código] y «nota»
  const show = (h) => h.replace(/<button[^>]*>Copiar<\/button>/g, '').replace(/<code class="cmd">([\s\S]*?)<\/code>/g, '[$1]').replace(/<span class="cmdn">([\s\S]*?)<\/span>/g, '«$1»').replace(/<span class="sep"> · <\/span>/g, ' · ').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  for (const g of W3.diagnosticador) { console.log(`\n# ${g.id}\n  first: ${show(cmdHtml(g.first))}`); g.causes.forEach((c) => console.log(`  check: ${show(cmdHtml(c.check))}`)); }
  console.log('\n# errores'); ERRS.forEach((e) => console.log(`  first: ${show(cmdHtml(e.first))}`));
  console.log('\n# figuras'); ALL.forEach((x) => ((x.figure.data || {}).steps || []).forEach((s) => { if (s.cmd) console.log(`  ${x.id}: ${show(codeChips(s.cmd))}`); }));
  if (byId.tensorrt && byId.tensorrt.figure.data.inspect) console.log(`  inspect: ${show(cmdHtml(byId.tensorrt.figure.data.inspect))}`);
  process.exit(0);
}
if (mode === 'src') { writeSrc(process.argv[3] || join(HERE, 'out')); report(); }
else if (mode === 'build' || mode === 'pdf') {
  const out = join(HERE, 'out');
  writeSrc(out);
  const evalJs = "(async () => { for (let i = 0; i < 150 && !window.__math; i++) await new Promise(r => setTimeout(r, 100)); const errs = [...document.querySelectorAll('.katex-error')].map(e => e.getAttribute('title') || e.textContent).slice(0, 10); return JSON.stringify({ n: window.__math || 0, total: document.querySelectorAll('[data-tex]').length, errors: errs, html: document.querySelector('.wrap').outerHTML }); })()";
  const r = spawnSync('node', [join(APP, 'tools/browser-check.mjs'), '--url', join(out, 'src.html'), '--wait', '1500', '--timeout', '120000', '--light', '--eval', evalJs], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const lineE = (r.stdout || '').split('\n').find((l) => l.startsWith('[eval] '));
  if (!lineE) { console.error(r.stdout, r.stderr); throw new Error('sin resultado del render'); }
  const v = JSON.parse(JSON.parse(lineE.slice(7)));
  console.log('math', v.n, 'de', v.total, '· errores', v.errors.length, v.errors);
  (r.stdout || '').split('\n').filter((l) => !l.startsWith('[eval] ')).forEach((l) => l && console.log('  ' + l));
  if (v.n !== v.total || v.errors.length) throw new Error('hay fórmulas sin renderizar');
  const page = HEAD + '\n' + v.html + '\n<script>' + JS + '</script>';
  writeFileSync(join(out, 'artifact.html'), page);
  const pagePath = join(HERE, '..', 'cheatsheet-triton.html');
  writeFileSync(pagePath, '<!doctype html>\n<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' + HEAD + '</head><body>' + v.html + '\n<script>' + JS + '</script></body></html>');
  console.log('final', page.length, 'bytes');
  if (mode === 'pdf') pdf(pagePath);
  report();
} else { console.error('modo desconocido: ' + mode + ' (usa src, build o pdf)'); process.exit(2); }
